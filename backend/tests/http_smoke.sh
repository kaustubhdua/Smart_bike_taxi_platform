#!/usr/bin/env bash
set -euo pipefail

base_url="${SAARTHI_TEST_BASE_URL:-http://127.0.0.1:8080}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

status="$(curl --silent --show-error --output "$tmp_dir/health.json" --write-out '%{http_code}' "$base_url/api/v1/health")"
test "$status" = "200"
grep -q '"status":"ok"' "$tmp_dir/health.json"
grep -q '"database":"connected"' "$tmp_dir/health.json"

status="$(curl --silent --show-error --output "$tmp_dir/invalid.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{"pickup":{"label":"A"},"destination":{"label":"B"}}' \
  "$base_url/api/v1/routes/quote")"
test "$status" = "422"
grep -q '"error"' "$tmp_dir/invalid.json"

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
  --header 'Content-Type: application/json' --data '{"status":"completed"}' \
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
psql -v ON_ERROR_STOP=1 -c "INSERT INTO driver_profiles (account_id,vehicle_registration,is_online) VALUES ('$driver_id','CI-DRIVER-001',false)" >/dev/null

status="$(curl --silent --show-error --output "$tmp_dir/driver-login.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data '{"email":"smoke-driver@example.test","password":"a-long-ci-password-123"}' \
  "$base_url/api/v1/auth/login")"
test "$status" = "200"
driver_token="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])' < "$tmp_dir/driver-login.json")"

status="$(curl --silent --show-error --output "$tmp_dir/driver-online.json" --write-out '%{http_code}' \
  --request PUT --header 'Content-Type: application/json' --header "Authorization: Bearer $driver_token" \
  --data '{"online":true,"latitude":28.53,"longitude":77.35}' \
  "$base_url/api/v1/driver/availability")"
test "$status" = "200"

status="$(curl --silent --show-error --output "$tmp_dir/accept.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $driver_token" --request POST \
  "$base_url/api/v1/driver/rides/$ride_id/accept")"
test "$status" = "200"
grep -q '"status":"assigned"' "$tmp_dir/accept.json"

status="$(curl --silent --show-error --output "$tmp_dir/history.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides")"
test "$status" = "200"
grep -q "$ride_id" "$tmp_dir/history.json"

status="$(curl --silent --show-error --output "$tmp_dir/detail.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$ride_id")"
test "$status" = "200"
grep -q '"status":"assigned"' "$tmp_dir/detail.json"

status="$(curl --silent --show-error --output "$tmp_dir/cancel.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" --request POST "$base_url/api/v1/rides/$ride_id/cancel")"
test "$status" = "200"
grep -q '"status":"cancelled"' "$tmp_dir/cancel.json"

echo "PASS: health, validation, auth, persisted booking, history, detail, and cancellation, idempotent replay/conflict, and expired quote rejection"
