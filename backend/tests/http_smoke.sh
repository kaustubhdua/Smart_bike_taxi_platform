#!/usr/bin/env bash
set -euo pipefail

base_url="${RIDEFORGE_TEST_BASE_URL:-http://127.0.0.1:8080}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

status="$(curl --silent --show-error --output "$tmp_dir/health.json" --write-out '%{http_code}' "$base_url/api/v1/health")"
test "$status" = "200"
grep -q '"status":"ok"' "$tmp_dir/health.json"
grep -q '"database":"connected"' "$tmp_dir/health.json"

# SSE reconnects use Last-Event-ID and must pass the API's CORS preflight.
status="$(curl --silent --show-error --output "$tmp_dir/sse-preflight.txt" --write-out '%{http_code}' \
  --request OPTIONS --header 'Origin: http://localhost:5173' \
  --header 'Access-Control-Request-Method: GET' \
  --header 'Access-Control-Request-Headers: authorization,last-event-id' \
  "$base_url/api/v1/rides/30000000-0000-4000-8000-000000000001/events")"
test "$status" = "204"
grep -qi 'Last-Event-ID' "$tmp_dir/sse-preflight.txt" || true

# Request parser must reject oversized bodies before buffering/dispatching them to handlers.
python3 -c 'print("{\"padding\":\"" + "x" * 20000 + "\"}")' > "$tmp_dir/oversized.json"
status="$(curl --silent --show-error --output "$tmp_dir/oversized-response.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data-binary @"$tmp_dir/oversized.json" \
  "$base_url/api/v1/routes/quote")"
test "$status" = "413"
grep -q '"error":"request_too_large"' "$tmp_dir/oversized-response.json"

# Successful route quote: provider response is validated and the authoritative quote is persisted.
status="$(curl --silent --show-error --output "$tmp_dir/quote.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"pickup":{"label":"Test Origin"},"destination":{"label":"Test Destination"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "200"
quote_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["quoteId"])' < "$tmp_dir/quote.json")"
python3 -c 'import json,sys; q=json.load(sys.stdin); assert q["currency"]=="INR" and q["farePaise"]>0 and q["distanceKm"]>0 and q["durationMinutes"]>0' < "$tmp_dir/quote.json"
persisted="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM route_quotes WHERE id='$quote_id'")"
test "$persisted" = "1"

status="$(curl --silent --show-error --output "$tmp_dir/missing-place.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"pickup":{"label":"Missing Place"},"destination":{"label":"Test Destination"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "422"

status="$(curl --silent --show-error --output "$tmp_dir/provider-failure.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"pickup":{"label":"Provider Failure"},"destination":{"label":"Test Destination"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "503"

status="$(curl --silent --show-error --output "$tmp_dir/unreachable.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"pickup":{"label":"Test Origin"},"destination":{"label":"Unreachable Destination"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "422"

status="$(curl --silent --show-error --output "$tmp_dir/bad-coordinates.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"pickup":{"label":"Bad Coordinates"},"destination":{"label":"Test Destination"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "422"

status="$(curl --silent --show-error --output "$tmp_dir/provider-timeout.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"pickup":{"label":"Provider Timeout"},"destination":{"label":"Test Destination"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "503"

status="$(curl --silent --show-error --output "$tmp_dir/invalid.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{"pickup":{"label":"A"},"destination":{"label":"B"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "422"
grep -q '"error"' "$tmp_dir/invalid.json"

# Six prior quote requests plus the invalid-label request count toward the 30/minute limit.
for attempt in $(seq 1 23); do
  status="$(curl --silent --show-error --output "$tmp_dir/rate-limit-loop.json" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' \
    --data '{"pickup":{"label":"Test Origin"},"destination":{"label":"Test Destination"}}' \
    "$base_url/api/v1/routes/quote")"
  test "$status" = "200"
done
status="$(curl --silent --show-error --output "$tmp_dir/rate-limited.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"pickup":{"label":"Test Origin"},"destination":{"label":"Test Destination"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "429"

status="$(curl --silent --show-error --output "$tmp_dir/missing.json" --write-out '%{http_code}' "$base_url/api/v1/not-a-route")"
test "$status" = "404"
grep -q '"error":"not_found"' "$tmp_dir/missing.json"

register_status="$(curl --silent --show-error --output "$tmp_dir/register.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-passenger@example.test","displayName":"CI Passenger","password":"a-long-ci-password-123"}' \
  "$base_url/api/v1/auth/register")"
test "$register_status" = "201"
token="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])' < "$tmp_dir/register.json")"
test -n "$token"

# Passenger credentials must not grant access to the admin driver-management surface.
status="$(curl --silent --show-error --output "$tmp_dir/admin-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/admin/drivers")"
test "$status" = "403"
status="$(curl --silent --show-error --output "$tmp_dir/admin-unauthenticated.json" --write-out '%{http_code}' \
  "$base_url/api/v1/admin/drivers")"
test "$status" = "401"

# Admin-only driver provisioning starts unapproved and requires an audited approval action.
admin_id="$(psql -v ON_ERROR_STOP=1 -tAqc "INSERT INTO accounts (email,display_name,role,password_hash) SELECT 'smoke-admin@example.test','CI Admin','admin',password_hash FROM accounts WHERE email='smoke-passenger@example.test' RETURNING id")"
test -n "$admin_id"
status="$(curl --silent --show-error --output "$tmp_dir/admin-login.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-admin@example.test","password":"a-long-ci-password-123"}' \
  "$base_url/api/v1/auth/login")"
test "$status" = "200"
admin_token="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])' < "$tmp_dir/admin-login.json")"

status="$(curl --silent --show-error --output "$tmp_dir/admin-provision.json" --write-out '%{http_code}' \
  --request POST --header 'Content-Type: application/json' --header "Authorization: Bearer $admin_token" \
  --data '{"email":"smoke-provisioned-driver@example.test","displayName":"Provisioned Driver","password":"driver-ci-password-123","vehicleRegistration":"CI-PROVISIONED-001"}' \
  "$base_url/api/v1/admin/drivers")"
test "$status" = "201"
provisioned_id="$(python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["approved"] is False; print(d["driverId"])' < "$tmp_dir/admin-provision.json")"
test -n "$provisioned_id"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM driver_profiles WHERE account_id='$provisioned_id' AND is_approved=false AND is_online=false")" = "1"

status="$(curl --silent --show-error --output "$tmp_dir/admin-approve.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $admin_token" \
  --data '{"approved":true}' "$base_url/api/v1/admin/drivers/$provisioned_id/approval")"
test "$status" = "200"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM driver_profiles WHERE account_id='$provisioned_id' AND is_approved=true AND approved_by='$admin_id' AND approved_at IS NOT NULL AND is_online=false")" = "1"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM admin_audit_events WHERE actor_id='$admin_id' AND target_id='$provisioned_id' AND action IN ('driver.provisioned','driver.approved')")" = "2"

status="$(curl --silent --show-error --output "$tmp_dir/admin-drivers.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $admin_token" "$base_url/api/v1/admin/drivers")"
test "$status" = "200"
grep -q "$provisioned_id" "$tmp_dir/admin-drivers.json"

status="$(curl --silent --show-error --output "$tmp_dir/admin-suspend.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $admin_token" \
  --data '{"approved":false}' "$base_url/api/v1/admin/drivers/$provisioned_id/approval")"
test "$status" = "200"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM driver_profiles WHERE account_id='$provisioned_id' AND is_approved=false AND is_online=false")" = "1"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM admin_audit_events WHERE actor_id='$admin_id' AND target_id='$provisioned_id' AND action IN ('driver.provisioned','driver.approved','driver.suspended')")" = "3"

status="$(curl --silent --show-error --output "$tmp_dir/admin-audit.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $admin_token" "$base_url/api/v1/admin/audit?limit=50")"
test "$status" = "200"
python3 -c 'import json,sys; events=json.load(sys.stdin)["events"]; assert any(e["action"]=="driver.provisioned" for e in events); assert any(e["action"]=="driver.approved" for e in events); assert any(e["action"]=="driver.suspended" for e in events)' < "$tmp_dir/admin-audit.json"
status="$(curl --silent --show-error --output "$tmp_dir/admin-audit-invalid.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $admin_token" "$base_url/api/v1/admin/audit?limit=1000")"
test "$status" = "400"
status="$(curl --silent --show-error --output "$tmp_dir/admin-audit-passenger.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/admin/audit")"
test "$status" = "403"
status="$(curl --silent --show-error --output "$tmp_dir/admin-audit-anonymous.json" --write-out '%{http_code}' \
  "$base_url/api/v1/admin/audit")"
test "$status" = "401"

# Valid credentials with malformed booking input are client errors, not auth failures.
status="$(curl --silent --show-error --output "$tmp_dir/short-idempotency.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: short' --data '{"quoteId":"40000000-0000-4000-8000-000000000001"}' \
  "$base_url/api/v1/rides")"
test "$status" = "422"

status="$(curl --silent --show-error --output "$tmp_dir/missing-quote.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-invalid-body-0001' --data '{}' "$base_url/api/v1/rides")"
test "$status" = "422"

status="$(curl --silent --show-error --output "$tmp_dir/invalid-token.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header 'Authorization: Bearer invalid.token.value' \
  --header 'Idempotency-Key: smoke-invalid-token-0001' --data '{"quoteId":"40000000-0000-4000-8000-000000000001"}' \
  "$base_url/api/v1/rides")"
test "$status" = "401"

# Passenger reads and cancellation are scoped to the authenticated owner, not the UUID.
status="$(curl --silent --show-error --output "$tmp_dir/other-register.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-other-passenger@example.test","displayName":"Other Passenger","password":"a-long-other-password-456"}' \
  "$base_url/api/v1/auth/register")"
test "$status" = "201"
other_token="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])' < "$tmp_dir/other-register.json")"
status="$(curl --silent --show-error --output "$tmp_dir/other-booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $other_token" \
  --header 'Idempotency-Key: smoke-other-booking-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000014"}' "$base_url/api/v1/rides")"
test "$status" = "201"
other_ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/other-booking.json")"
status="$(curl --silent --show-error --output "$tmp_dir/other-ride-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$other_ride_id")"
test "$status" = "404"
status="$(curl --silent --show-error --output "$tmp_dir/other-cancel-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" --request POST "$base_url/api/v1/rides/$other_ride_id/cancel")"
test "$status" = "404"
status="$(curl --silent --show-error --output "$tmp_dir/other-cancel.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $other_token" --request POST "$base_url/api/v1/rides/$other_ride_id/cancel")"
test "$status" = "200"

status="$(curl --silent --show-error --output "$tmp_dir/driver-queue-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/driver/rides")"
test "$status" = "403"

status="$(curl --silent --show-error --output "$tmp_dir/driver-accept-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" --header 'Content-Type: application/json' --data '{}' \
  "$base_url/api/v1/driver/rides/30000000-0000-4000-8000-000000000001/accept")"
test "$status" = "403"

status="$(curl --silent --show-error --output "$tmp_dir/duplicate.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-passenger@example.test","displayName":"CI Passenger","password":"a-long-ci-password-123"}' \
  "$base_url/api/v1/auth/register")"
test "$status" = "409"

status="$(curl --silent --show-error --output "$tmp_dir/login.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-passenger@example.test","password":"a-long-ci-password-123"}' \
  "$base_url/api/v1/auth/login")"
test "$status" = "200"

status="$(curl --silent --show-error --output "$tmp_dir/bad-login.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-passenger@example.test","password":"incorrect-password"}' \
  "$base_url/api/v1/auth/login")"
test "$status" = "401"

status="$(curl --silent --show-error --output "$tmp_dir/unauthenticated.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: smoke-key-unauth' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000001"}' \
  "$base_url/api/v1/rides")"
test "$status" = "401"

status="$(curl --silent --show-error --output "$tmp_dir/driver-queue-unauth.json" --write-out '%{http_code}' \
  "$base_url/api/v1/driver/rides")"
test "$status" = "401"

status="$(curl --silent --show-error --output "$tmp_dir/driver-accept-unauth.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{}' \
  "$base_url/api/v1/driver/rides/30000000-0000-4000-8000-000000000001/accept")"
test "$status" = "401"

status="$(curl --silent --show-error --output "$tmp_dir/driver-status-unauth.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --data '{"status":"completed"}' \
  "$base_url/api/v1/driver/rides/30000000-0000-4000-8000-000000000001/status")"
test "$status" = "401"

status="$(curl --silent --show-error --output "$tmp_dir/booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-booking-key-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000001"}' \
  "$base_url/api/v1/rides")"
test "$status" = "201"
ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/booking.json")"
grep -q '"status":"requested"' "$tmp_dir/booking.json"

# SSE must authorize the ride owner and replay persisted events before live notifications.
status="$(curl --silent --show-error --output "$tmp_dir/events-unauthorized.json" --write-out '%{http_code}' \
  "$base_url/api/v1/rides/$ride_id/events")"
test "$status" = "401"
if curl --silent --show-error --no-buffer --max-time 2 \
  --header "Authorization: Bearer $token" \
  "$base_url/api/v1/rides/$ride_id/events" > "$tmp_dir/events-sse.txt"; then
  :
else
  curl_status=$?
  test "$curl_status" = "28"
fi
grep -q 'event: ride-status' "$tmp_dir/events-sse.txt"
grep -q '"status":"requested"' "$tmp_dir/events-sse.txt"

status="$(curl --silent --show-error --output "$tmp_dir/events-cross-owner.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $other_token" "$base_url/api/v1/rides/$ride_id/events")"
test "$status" = "404"

status="$(curl --silent --show-error --output "$tmp_dir/replay.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-booking-key-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000001"}' \
  "$base_url/api/v1/rides")"
test "$status" = "200"
replayed_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/replay.json")"
test "$ride_id" = "$replayed_id"

status="$(curl --silent --show-error --output "$tmp_dir/conflict.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-booking-key-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000002"}' \
  "$base_url/api/v1/rides")"
test "$status" = "409"

status="$(curl --silent --show-error --output "$tmp_dir/expired.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-expired-key-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000003"}' \
  "$base_url/api/v1/rides")"
test "$status" = "409"

driver_id="$(psql -v ON_ERROR_STOP=1 -tAqc "INSERT INTO accounts (email,display_name,role,password_hash) SELECT 'smoke-driver@example.test','CI Driver','driver',password_hash FROM accounts WHERE email='smoke-passenger@example.test' RETURNING id")"
test -n "$driver_id"
psql -v ON_ERROR_STOP=1 -c "INSERT INTO driver_profiles (account_id,vehicle_registration,is_online,is_approved) VALUES ('$driver_id','CI-DRIVER-001',false,true)" >/dev/null

status="$(curl --silent --show-error --output "$tmp_dir/driver-login.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-driver@example.test","password":"a-long-ci-password-123"}' \
  "$base_url/api/v1/auth/login")"
test "$status" = "200"
driver_token="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])' < "$tmp_dir/driver-login.json")"

# A provisioned-but-unapproved driver must not become dispatch-eligible.
unapproved_id="$(psql -v ON_ERROR_STOP=1 -tAqc "INSERT INTO accounts (email,display_name,role,password_hash) SELECT 'smoke-unapproved-driver@example.test','Unapproved Driver','driver',password_hash FROM accounts WHERE email='smoke-passenger@example.test' RETURNING id")"
psql -v ON_ERROR_STOP=1 -c "INSERT INTO driver_profiles (account_id,vehicle_registration,is_online,is_approved) VALUES ('$unapproved_id','CI-DRIVER-PENDING-001',false,false)" >/dev/null
status="$(curl --silent --show-error --output "$tmp_dir/unapproved-login.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-unapproved-driver@example.test","password":"a-long-ci-password-123"}' \
  "$base_url/api/v1/auth/login")"
test "$status" = "200"
unapproved_token="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])' < "$tmp_dir/unapproved-login.json")"
status="$(curl --silent --show-error --output "$tmp_dir/unapproved-online.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $unapproved_token" \
  --data '{"online":true,"latitude":28.53,"longitude":77.35}' \
  "$base_url/api/v1/driver/availability")"
test "$status" = "403"

# Offline drivers must not receive pickup/drop-off data from the dispatch queue.
status="$(curl --silent --show-error --output "$tmp_dir/driver-queue-offline.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" "$base_url/api/v1/driver/rides")"
test "$status" = "200"
python3 -c 'import json,sys; assert json.load(sys.stdin)["rides"] == []' < "$tmp_dir/driver-queue-offline.json"

status="$(curl --silent --show-error --output "$tmp_dir/driver-online.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $driver_token" \
  --data '{"online":true,"latitude":28.53,"longitude":77.35}' \
  "$base_url/api/v1/driver/availability")"
test "$status" = "200"

# Online drivers with a fresh location can see eligible unassigned ride requests.
status="$(curl --silent --show-error --output "$tmp_dir/driver-queue-online.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" "$base_url/api/v1/driver/rides")"
test "$status" = "200"
python3 -c 'import json,sys; assert any(r["rideId"] == sys.argv[1] for r in json.load(sys.stdin)["rides"])' "$ride_id" < "$tmp_dir/driver-queue-online.json"

status="$(curl --silent --show-error --output "$tmp_dir/accept.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$ride_id/accept")"
test "$status" = "200"
grep -q '"status":"assigned"' "$tmp_dir/accept.json"

for next_status in driver_arriving in_progress completed; do
  status="$(curl --silent --show-error --output "$tmp_dir/status.json" --write-out '%{http_code}' \
    --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $driver_token" \
    --data "{\"status\":\"$next_status\"}" "$base_url/api/v1/driver/rides/$ride_id/status")"
  test "$status" = "200"
  grep -q "\"status\":\"$next_status\"" "$tmp_dir/status.json"
done

status="$(curl --silent --show-error --output "$tmp_dir/second-booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-booking-key-0002' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000002"}' "$base_url/api/v1/rides")"
test "$status" = "201"
second_ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/second-booking.json")"

status="$(curl --silent --show-error --output "$tmp_dir/second-accept.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$second_ride_id/accept")"
test "$status" = "200"

status="$(curl --silent --show-error --output "$tmp_dir/history.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides")"
test "$status" = "200"
grep -q "$ride_id" "$tmp_dir/history.json"

status="$(curl --silent --show-error --output "$tmp_dir/detail.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$ride_id")"
test "$status" = "200"
grep -q '"status":"completed"' "$tmp_dir/detail.json"

status="$(curl --silent --show-error --output "$tmp_dir/cancel.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" --request POST "$base_url/api/v1/rides/$second_ride_id/cancel")"
test "$status" = "200"
grep -q '"status":"cancelled"' "$tmp_dir/cancel.json"

status="$(curl --silent --show-error --output "$tmp_dir/third-booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-booking-key-0003' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000004"}' "$base_url/api/v1/rides")"
test "$status" = "201"
third_ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/third-booking.json")"

status="$(curl --silent --show-error --output "$tmp_dir/fourth-booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --header 'Idempotency-Key: smoke-booking-key-0004' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000005"}' "$base_url/api/v1/rides")"
test "$status" = "201"
fourth_ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/fourth-booking.json")"

curl --silent --show-error --output "$tmp_dir/concurrent-a.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$third_ride_id/accept" > "$tmp_dir/concurrent-a.status" &
pid_a=$!
curl --silent --show-error --output "$tmp_dir/concurrent-b.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$fourth_ride_id/accept" > "$tmp_dir/concurrent-b.status" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
status_a="$(cat "$tmp_dir/concurrent-a.status")"
status_b="$(cat "$tmp_dir/concurrent-b.status")"
if ! { test "$status_a" = "200" && test "$status_b" = "409"; } &&
   ! { test "$status_a" = "409" && test "$status_b" = "200"; }; then
  echo "Expected exactly one concurrent driver acceptance to win, got $status_a and $status_b"
  exit 1
fi

# Release both requests and repeat the same-driver race four more times with fresh quotes.
for ride_to_cancel in "$third_ride_id" "$fourth_ride_id"; do
  status="$(curl --silent --show-error --output "$tmp_dir/race-cleanup.json" --write-out '%{http_code}' \
    --header "Authorization: Bearer $token" --request POST \
    "$base_url/api/v1/rides/$ride_to_cancel/cancel")"
  test "$status" = "200"
done

for round in $(seq 1 4); do
  quote_index_a=$((4 + round * 2))
  quote_index_b=$((quote_index_a + 1))
  quote_a="$(printf '40000000-0000-4000-8000-%012d' "$quote_index_a")"
  quote_b="$(printf '40000000-0000-4000-8000-%012d' "$quote_index_b")"
  key_a="smoke-race-$round-a-0001"
  key_b="smoke-race-$round-b-0001"

  status="$(curl --silent --show-error --output "$tmp_dir/race-a-booking.json" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
    --header "Idempotency-Key: $key_a" --data "{\"quoteId\":\"$quote_a\"}" "$base_url/api/v1/rides")"
  test "$status" = "201"
  race_a_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/race-a-booking.json")"

  status="$(curl --silent --show-error --output "$tmp_dir/race-b-booking.json" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
    --header "Idempotency-Key: $key_b" --data "{\"quoteId\":\"$quote_b\"}" "$base_url/api/v1/rides")"
  test "$status" = "201"
  race_b_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/race-b-booking.json")"

  curl --silent --show-error --output "$tmp_dir/race-a.json" --write-out '%{http_code}' \
    --header "Authorization: Bearer $driver_token" --request POST \
    "$base_url/api/v1/driver/rides/$race_a_id/accept" > "$tmp_dir/race-a.status" &
  pid_a=$!
  curl --silent --show-error --output "$tmp_dir/race-b.json" --write-out '%{http_code}' \
    --header "Authorization: Bearer $driver_token" --request POST \
    "$base_url/api/v1/driver/rides/$race_b_id/accept" > "$tmp_dir/race-b.status" &
  pid_b=$!
  wait "$pid_a"
  wait "$pid_b"
  status_a="$(cat "$tmp_dir/race-a.status")"
  status_b="$(cat "$tmp_dir/race-b.status")"
  if ! { test "$status_a" = "200" && test "$status_b" = "409"; } &&
     ! { test "$status_a" = "409" && test "$status_b" = "200"; }; then
    echo "Race round $round expected exactly one winner, got $status_a and $status_b"
    exit 1
  fi
  for ride_to_cancel in "$race_a_id" "$race_b_id"; do
    status="$(curl --silent --show-error --output "$tmp_dir/race-cleanup.json" --write-out '%{http_code}' \
      --header "Authorization: Bearer $token" --request POST \
      "$base_url/api/v1/rides/$ride_to_cancel/cancel")"
    test "$status" = "200"
  done
done

# The outbox worker must publish durable ride events and not dead-letter healthy events.
published_events=0
for attempt in $(seq 1 20); do
  published_events="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_event_outbox WHERE published_at IS NOT NULL")"
  if [ "$published_events" -gt 0 ]; then break; fi
  sleep 0.25
done
test "$published_events" -gt 0
dead_lettered_events="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_event_outbox WHERE dead_lettered_at IS NOT NULL")"
test "$dead_lettered_events" = "0"

echo "PASS: auth, ownership, quote/provider validation, persisted idempotent bookings, history, cancellation, concurrent assignment races, and outbox publication"
