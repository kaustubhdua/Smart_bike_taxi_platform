#!/usr/bin/env bash
set -euo pipefail

base_url="${RIDEFORGE_TEST_BASE_URL:-http://127.0.0.1:8080}"
tmp_dir="$(mktemp -d)"
restore_readiness_migration() {
  psql -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations(version) VALUES ('002_driver_approval_and_outbox') ON CONFLICT (version) DO NOTHING" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap restore_readiness_migration EXIT

status="$(curl --silent --show-error --dump-header "$tmp_dir/health.headers" --output "$tmp_dir/health.json" --write-out '%{http_code}' "$base_url/api/v1/health")"
test "$status" = "200"
status="$(curl --silent --show-error --output "$tmp_dir/readiness.json" --write-out '%{http_code}' "$base_url/api/v1/ready")"
test "$status" = "200"
grep -q '"status":"ready"' "$tmp_dir/readiness.json"
grep -q '"status":"ok"' "$tmp_dir/health.json"
grep -q '"database":"connected"' "$tmp_dir/health.json"
grep -qi '^X-Request-ID: [A-Za-z0-9_-]\{8,\}' "$tmp_dir/health.headers"
grep -qi '^Cache-Control: no-store' "$tmp_dir/health.headers"
grep -qi '^X-Content-Type-Options: nosniff' "$tmp_dir/health.headers"
grep -qi '^Referrer-Policy: no-referrer' "$tmp_dir/health.headers"

# Readiness must fail closed if the current migration ledger is incomplete.
psql -v ON_ERROR_STOP=1 -c "DELETE FROM schema_migrations WHERE version = '002_driver_approval_and_outbox'" >/dev/null
status="$(curl --silent --show-error --output "$tmp_dir/not-ready.json" --write-out '%{http_code}' "$base_url/api/v1/ready")"
test "$status" = "503"
grep -q '"status":"not_ready"' "$tmp_dir/not-ready.json"
psql -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations(version) VALUES ('002_driver_approval_and_outbox') ON CONFLICT (version) DO NOTHING" >/dev/null
status="$(curl --silent --show-error --output "$tmp_dir/readiness-restored.json" --write-out '%{http_code}' "$base_url/api/v1/ready")"
test "$status" = "200"


# SSE reconnects use Last-Event-ID and must pass the API's CORS preflight.
status="$(curl --silent --show-error --output "$tmp_dir/sse-preflight.txt" --dump-header "$tmp_dir/sse-preflight-headers.txt" --write-out '%{http_code}' \
  --request OPTIONS --header 'Origin: http://localhost:5173' \
  --header 'Access-Control-Request-Method: GET' \
  --header 'Access-Control-Request-Headers: authorization,last-event-id' \
  "$base_url/api/v1/rides/30000000-0000-4000-8000-000000000001/events")"
test "$status" = "204"
grep -qi 'Last-Event-ID' "$tmp_dir/sse-preflight-headers.txt"
grep -qi '^Access-Control-Allow-Origin: http://localhost:5173' "$tmp_dir/sse-preflight-headers.txt"

# The exact driver origin is also allowed; arbitrary origins are never reflected.
status="$(curl --silent --show-error --output "$tmp_dir/driver-preflight.txt" --dump-header "$tmp_dir/driver-preflight-headers.txt" --write-out '%{http_code}' \
  --request OPTIONS --header 'Origin: http://driver.localhost:5173' \
  --header 'Access-Control-Request-Method: GET' \
  --header 'Access-Control-Request-Headers: authorization,last-event-id' \
  "$base_url/api/v1/rides/30000000-0000-4000-8000-000000000001/events")"
test "$status" = "204"
grep -qi '^Access-Control-Allow-Origin: http://driver.localhost:5173' "$tmp_dir/driver-preflight-headers.txt"

status="$(curl --silent --show-error --output "$tmp_dir/untrusted-preflight.txt" --dump-header "$tmp_dir/untrusted-preflight-headers.txt" --write-out '%{http_code}' \
  --request OPTIONS --header 'Origin: https://untrusted.example' \
  --header 'Access-Control-Request-Method: GET' \
  --header 'Access-Control-Request-Headers: authorization,last-event-id' \
  "$base_url/api/v1/rides/30000000-0000-4000-8000-000000000001/events")"
test "$status" = "204"
if grep -qi '^Access-Control-Allow-Origin: https://untrusted.example' "$tmp_dir/untrusted-preflight-headers.txt"; then
  echo "Untrusted origin was reflected by CORS" >&2
  exit 1
fi

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

status="$(curl --silent --show-error --output "$tmp_dir/admin-metrics.json" --write-out '%{http_code}' --header "Authorization: Bearer $admin_token" "$base_url/api/v1/admin/metrics")"
test "$status" = "200"
grep -q 'pendingOutboxEvents' "$tmp_dir/admin-metrics.json"
grep -q 'deadLetteredOutboxEvents' "$tmp_dir/admin-metrics.json"
grep -q 'oldestPendingOutboxAgeSeconds' "$tmp_dir/admin-metrics.json"




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
status="$(curl --silent --show-error --output "$tmp_dir/events-unauthenticated.json" --write-out '%{http_code}' \
  "$base_url/api/v1/rides/$other_ride_id/events")"
test "$status" = "401"
status="$(curl --silent --show-error --output "$tmp_dir/events-admin-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$other_ride_id/events")"
test "$status" = "404"
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

# A passenger can create and read a support report only for a ride they participated in.
status="$(curl --silent --show-error --output "$tmp_dir/support-create.json" --write-out '%{http_code}' \
  --request POST --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --data "{\"rideId\":\"$ride_id\",\"category\":\"technical\",\"description\":\"The booking status did not refresh after reconnecting.\"}" \
  "$base_url/api/v1/support/reports")"
test "$status" = "201"
support_report_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' < "$tmp_dir/support-create.json")"
test -n "$support_report_id"
for attempt in 1 2 3 4; do
  status="$(curl --silent --show-error --output "$tmp_dir/support-extra-$attempt.json" --write-out '%{http_code}' \
    --request POST --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
    --data "{\"category\":\"other\",\"description\":\"Automated rate limit fixture report $attempt.\"}" \
    "$base_url/api/v1/support/reports")"
  test "$status" = "201"
done
status="$(curl --silent --show-error --output "$tmp_dir/support-rate-limit.json" --write-out '%{http_code}' \
  --request POST --header 'Content-Type: application/json' --header "Authorization: Bearer $token" \
  --data '{"category":"other","description":"This sixth report should be rate limited."}' \
  "$base_url/api/v1/support/reports")"
test "$status" = "429"
grep -q '"error":"support_rate_limited"' "$tmp_dir/support-rate-limit.json"
status="$(curl --silent --show-error --output "$tmp_dir/support-list.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/support/reports")"
test "$status" = "200"
grep -q "\"id\":\"$support_report_id\"" "$tmp_dir/support-list.json"
status="$(curl --silent --show-error --output "$tmp_dir/support-other-list.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $other_token" "$base_url/api/v1/support/reports")"
test "$status" = "200"
! grep -q "$support_report_id" "$tmp_dir/support-other-list.json"

status="$(curl --silent --show-error --output "$tmp_dir/support-cross-account.json" --write-out '%{http_code}' \
  --request POST --header 'Content-Type: application/json' --header "Authorization: Bearer $other_token" \
  --data "{\"rideId\":\"$ride_id\",\"category\":\"other\",\"description\":\"Trying to report a ride owned by someone else.\"}" \
  "$base_url/api/v1/support/reports")"
test "$status" = "404"

status="$(curl --silent --show-error --output "$tmp_dir/admin-support-list.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $admin_token" "$base_url/api/v1/admin/support-reports")"
test "$status" = "200"
grep -q "$support_report_id" "$tmp_dir/admin-support-list.json"

status="$(curl --silent --show-error --output "$tmp_dir/support-review.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $admin_token" \
  --data '{"status":"in_review"}' "$base_url/api/v1/admin/support-reports/$support_report_id")"
test "$status" = "200"
status="$(curl --silent --show-error --output "$tmp_dir/support-resolve.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $admin_token" \
  --data '{"status":"resolved","resolutionNote":"Confirmed issue and documented a workaround for the passenger."}' \
  "$base_url/api/v1/admin/support-reports/$support_report_id")"
test "$status" = "200"
grep -q '"status":"resolved"' "$tmp_dir/support-resolve.json"
status="$(curl --silent --show-error --output "$tmp_dir/support-terminal-update.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $admin_token" \
  --data '{"status":"in_review"}' "$base_url/api/v1/admin/support-reports/$support_report_id")"
test "$status" = "409"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM admin_audit_events WHERE actor_id='$admin_id' AND action='support_report.status_changed' AND target_id='$support_report_id'")" = "2"

# Admin ride search is bounded, filtered and inaccessible to passenger identities.
status="$(curl --silent --show-error --output "$tmp_dir/admin-ride-search.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $admin_token" "$base_url/api/v1/admin/rides?q=$ride_id")"
test "$status" = "200"
grep -q "$ride_id" "$tmp_dir/admin-ride-search.json"
status="$(curl --silent --show-error --output "$tmp_dir/admin-ride-search-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/admin/rides?q=$ride_id")"
test "$status" = "403"
status="$(curl --silent --show-error --output "$tmp_dir/admin-ride-search-invalid.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $admin_token" "$base_url/api/v1/admin/rides?status=not-a-status")"
test "$status" = "400"

grep -q '"status":"requested"' "$tmp_dir/booking.json"

# SSE must authorize the ride owner and replay persisted events before live notifications.
status="$(curl --silent --show-error --output "$tmp_dir/events-unauthorized.json" --write-out '%{http_code}' \
  "$base_url/api/v1/rides/$ride_id/events")"
test "$status" = "401"

status="$(curl --silent --show-error --output "$tmp_dir/events-invalid-cursor.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" --header 'Last-Event-ID: -1' \
  "$base_url/api/v1/rides/$ride_id/events")"
test "$status" = "400"
grep -q 'invalid_last_event_id' "$tmp_dir/events-invalid-cursor.json"
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

# An explicit zero cursor replays persisted history; the latest cursor must not replay it twice.
first_event_id="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT id FROM ride_events WHERE ride_id='$ride_id' ORDER BY id LIMIT 1")"
test -n "$first_event_id"
if curl --silent --show-error --no-buffer --max-time 2 --header "Authorization: Bearer $token" \
  --header 'Last-Event-ID: 0' "$base_url/api/v1/rides/$ride_id/events" > "$tmp_dir/events-replay-zero.txt"; then
  :
else
  curl_status=$?
  test "$curl_status" = "28"
fi
grep -q 'event: ride-status' "$tmp_dir/events-replay-zero.txt"
grep -q '"status":"requested"' "$tmp_dir/events-replay-zero.txt"

if curl --silent --show-error --no-buffer --max-time 2 --header "Authorization: Bearer $token" \
  --header "Last-Event-ID: $first_event_id" "$base_url/api/v1/rides/$ride_id/events" > "$tmp_dir/events-after-cursor.txt"; then
  :
else
  curl_status=$?
  test "$curl_status" = "28"
fi
if grep -q 'event: ride-status' "$tmp_dir/events-after-cursor.txt"; then
  echo "Latest Last-Event-ID unexpectedly replayed a duplicate ride event" >&2
  exit 1
fi

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

# Create a far-away request; an online driver should not see its pickup/drop-off data.
status="$(curl --silent --show-error --output "$tmp_dir/far-booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $other_token" \
  --header 'Idempotency-Key: smoke-far-ride-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000015"}' "$base_url/api/v1/rides")"
test "$status" = "201"
far_ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/far-booking.json")"
status="$(curl --silent --show-error --output "$tmp_dir/busy-booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $other_token" \
  --header 'Idempotency-Key: smoke-busy-ride-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000016"}' "$base_url/api/v1/rides")"
test "$status" = "201"
busy_ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/busy-booking.json")"
status="$(curl --silent --show-error --output "$tmp_dir/midrange-booking.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --header "Authorization: Bearer $other_token" \
  --header 'Idempotency-Key: smoke-midrange-ride-0001' \
  --data '{"quoteId":"40000000-0000-4000-8000-000000000017"}' "$base_url/api/v1/rides")"
test "$status" = "201"
midrange_ride_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rideId"])' < "$tmp_dir/midrange-booking.json")"

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
status=""
for attempt in $(seq 1 20); do
  status="$(curl --silent --show-error --output "$tmp_dir/driver-queue-online.json" --write-out '%{http_code}' \
    --header "Authorization: Bearer $driver_token" "$base_url/api/v1/driver/rides")"
  test "$status" = "200"
  if python3 -c 'import json,sys; ids={r["rideId"] for r in json.load(sys.stdin)["rides"]}; required=set(sys.argv[1:]); raise SystemExit(0 if required.issubset(ids) else 1)' "$ride_id" "$busy_ride_id" "$far_ride_id" < "$tmp_dir/driver-queue-online.json"; then
    break
  fi
  sleep 0.25
done
test "$status" = "200"
radius_meters="$((${RIDEFORGE_DISPATCH_RADIUS_KM:-20} * 1000))"
python3 -c 'import json,sys; rides=json.load(sys.stdin)["rides"]; ids={r["rideId"] for r in rides}; radius=int(sys.argv[4]); midrange=sys.argv[5]; km=int(sys.argv[6]); assert sys.argv[1] in ids and sys.argv[2] in ids and sys.argv[3] not in ids, "required nearby/far IDs mismatch: " + repr(ids); assert all(0 <= r["pickupDistanceMeters"] <= radius for r in rides), "out-of-radius queue entries: " + repr([(r.get("rideId"),r.get("pickupDistanceMeters")) for r in rides]) + " radius=" + str(radius); assert all(r["farePaise"] > 0 for r in rides); assert (midrange in ids) == (km >= 10), "midrange visibility mismatch: present=" + str(midrange in ids) + " radius_km=" + str(km) + " distances=" + repr([(r.get("rideId"),r.get("pickupDistanceMeters")) for r in rides])' "$ride_id" "$busy_ride_id" "$far_ride_id" "$radius_meters" "$midrange_ride_id" "${RIDEFORGE_DISPATCH_RADIUS_KM:-20}" < "$tmp_dir/driver-queue-online.json"
if [ "${RIDEFORGE_DISPATCH_RADIUS_KM:-20}" -lt 10 ]; then
  status="$(curl --silent --show-error --output "$tmp_dir/midrange-accept.json" --write-out '%{http_code}' \
    --header "Authorization: Bearer $driver_token" --request POST "$base_url/api/v1/driver/rides/$midrange_ride_id/accept")"
  test "$status" = "409"
  grep -q '"error":"ride_outside_dispatch_radius"' "$tmp_dir/midrange-accept.json"
fi
status="$(curl --silent --show-error --output "$tmp_dir/midrange-cancel.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $other_token" --request POST "$base_url/api/v1/rides/$midrange_ride_id/cancel")"
test "$status" = "200"
status="$(curl --silent --show-error --output "$tmp_dir/far-accept.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST "$base_url/api/v1/driver/rides/$far_ride_id/accept")"
test "$status" = "409"
grep -q '"error":"ride_outside_dispatch_radius"' "$tmp_dir/far-accept.json"
status="$(curl --silent --show-error --output "$tmp_dir/far-cancel.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $other_token" --request POST "$base_url/api/v1/rides/$far_ride_id/cancel")"
test "$status" = "200"

status="$(curl --silent --show-error --output "$tmp_dir/accept.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$ride_id/accept")"
test "$status" = "200"
grep -q '"status":"assigned"' "$tmp_dir/accept.json"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_offers WHERE ride_id='$ride_id' AND driver_id='$driver_id' AND status='accepted'")" = "1"
status="$(curl --silent --show-error --output "$tmp_dir/driver-queue-busy.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" "$base_url/api/v1/driver/rides")"
test "$status" = "200"
python3 -c 'import json,sys; assert all(r["rideId"] != sys.argv[1] for r in json.load(sys.stdin)["rides"])' "$busy_ride_id" < "$tmp_dir/driver-queue-busy.json"
status="$(curl --silent --show-error --output "$tmp_dir/busy-cancel.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $other_token" --request POST "$base_url/api/v1/rides/$busy_ride_id/cancel")"
test "$status" = "200"

status="$(curl --silent --show-error --output "$tmp_dir/assigned-detail.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$ride_id")"
test "$status" = "200"
python3 -c 'import json,sys; r=json.load(sys.stdin); p=r["driverLocation"]; assert abs(p["latitude"]-28.53)<0.001 and abs(p["longitude"]-77.35)<0.001' < "$tmp_dir/assigned-detail.json"

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
# The asynchronous dispatcher may need a poll cycle to persist this driver offer.
for attempt in $(seq 1 40); do
  offered="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_offers WHERE ride_id='$second_ride_id' AND driver_id='$driver_id' AND status='offered' AND expires_at>now()")"
  test "$offered" = "1" && break
  sleep 0.25
done
test "$offered" = "1"

# Declining hides this request only for this driver; it must not cancel the passenger's ride.
status="$(curl --silent --show-error --output "$tmp_dir/second-decline.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$second_ride_id/decline")"
test "$status" = "200"
grep -q '"status":"declined"' "$tmp_dir/second-decline.json"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_offers WHERE ride_id='$second_ride_id' AND driver_id='$driver_id' AND status='declined'")" = "1"

status="$(curl --silent --show-error --output "$tmp_dir/declined-accept.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$second_ride_id/accept")"
test "$status" = "409"
grep -q '"error":"ride_previously_declined"' "$tmp_dir/declined-accept.json"

status="$(curl --silent --show-error --output "$tmp_dir/declined-queue.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" "$base_url/api/v1/driver/rides")"
test "$status" = "200"
python3 -c 'import json,sys; assert all(r["rideId"] != sys.argv[1] for r in json.load(sys.stdin)["rides"]), "declined request remained in this driver queue"' "$second_ride_id" < "$tmp_dir/declined-queue.json"

status="$(curl --silent --show-error --output "$tmp_dir/declined-passenger-detail.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$second_ride_id")"
test "$status" = "200"
grep -q '"status":"requested"' "$tmp_dir/declined-passenger-detail.json"

status="$(curl --silent --show-error --output "$tmp_dir/driver-history.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" "$base_url/api/v1/driver/rides/history")"
test "$status" = "200"
python3 -c 'import json,sys; d=json.load(sys.stdin); assert int(d["grossCompletedFarePaise"]) > 0 and any(r["rideId"] == sys.argv[1] and r["status"] == "completed" for r in d["rides"]); assert "not a payout" in d["note"]' "$ride_id" < "$tmp_dir/driver-history.json"
status="$(curl --silent --show-error --output "$tmp_dir/driver-history-forbidden.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/driver/rides/history")"
test "$status" = "403"

status="$(curl --silent --show-error --output "$tmp_dir/history.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides")"
test "$status" = "200"
grep -q "$ride_id" "$tmp_dir/history.json"
python3 -c 'import json,sys; rides=json.load(sys.stdin)["rides"]; item=next(r for r in rides if r["rideId"]==sys.argv[1]); assert item["status"]=="completed" and item["finalFarePaise"]>0 and item["completedAt"]' "$ride_id" < "$tmp_dir/history.json"

status="$(curl --silent --show-error --output "$tmp_dir/detail.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$ride_id")"
test "$status" = "200"
grep -q '"status":"completed"' "$tmp_dir/detail.json"
python3 -c 'import json,sys; assert "driverLocation" not in json.load(sys.stdin)' < "$tmp_dir/detail.json"

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

# Both requests need live durable offers before testing the assignment race.
# Booking creation and dispatch are asynchronous; accepting before offer creation
# correctly returns 409 and would not exercise the concurrent-assignment guard.
offers_ready=0
for attempt in $(seq 1 40); do
  third_offered="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_offers WHERE ride_id='$third_ride_id' AND driver_id='$driver_id' AND status='offered' AND expires_at>now()")"
  fourth_offered="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_offers WHERE ride_id='$fourth_ride_id' AND driver_id='$driver_id' AND status='offered' AND expires_at>now()")"
  if test "$third_offered" = "1" && test "$fourth_offered" = "1"; then
    offers_ready=1
    break
  fi
  sleep 0.25
done
test "$offers_ready" = "1"

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

  # Wait until dispatch has persisted both offers; the race must test competing
  # assignments, not the valid 409 response for a ride with no current offer.
  offers_ready=0
  for attempt in $(seq 1 40); do
    race_a_offered="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_offers WHERE ride_id='$race_a_id' AND driver_id='$driver_id' AND status='offered' AND expires_at>now()")"
    race_b_offered="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_offers WHERE ride_id='$race_b_id' AND driver_id='$driver_id' AND status='offered' AND expires_at>now()")"
    if test "$race_a_offered" = "1" && test "$race_b_offered" = "1"; then
      offers_ready=1
      break
    fi
    sleep 0.25
  done
  test "$offers_ready" = "1"

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

# Going offline must not require or retain precise coordinates.
status="$(curl --silent --show-error --output "$tmp_dir/driver-offline.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $driver_token" \
  --data '{"online":false}' "$base_url/api/v1/driver/availability")"
test "$status" = "200"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM driver_profiles WHERE account_id='$driver_id' AND is_online=false AND current_latitude IS NULL AND current_longitude IS NULL AND last_location_at IS NULL")" = "1"

# A stale unassigned request with no eligible drivers must end in a persisted,
# visible no-driver outcome rather than remaining pending forever.
exhausted_ride_id="$(psql -v ON_ERROR_STOP=1 -tAqc "INSERT INTO rides (passenger_id,status,pickup_label,pickup_latitude,pickup_longitude,destination_label,destination_latitude,destination_longitude,route_distance_m,quoted_fare_paise,idempotency_key,created_at) SELECT id,'requested','Exhaustion pickup',28.53,77.35,'Exhaustion destination',28.54,77.36,2500,475,'smoke-dispatch-exhaustion-0001',now()-interval '11 minutes' FROM accounts WHERE email='smoke-passenger@example.test' RETURNING id")"
test -n "$exhausted_ride_id"
exhausted_status=""
for attempt in $(seq 1 30); do
  exhausted_status="$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT status::text FROM rides WHERE id='$exhausted_ride_id'")"
  if test "$exhausted_status" = "failed"; then break; fi
  sleep 0.5
done
test "$exhausted_status" = "failed"
test "$(psql -v ON_ERROR_STOP=1 -tAqc "SELECT count(*) FROM ride_events WHERE ride_id='$exhausted_ride_id' AND new_status='failed' AND details->>'reason'='no_eligible_drivers'")" = "1"

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

echo "PASS: auth, ownership, quote/provider validation, persisted idempotent bookings, history, cancellation, concurrent assignment races, offline location clearing, bounded no-driver exhaustion, and outbox publication"
