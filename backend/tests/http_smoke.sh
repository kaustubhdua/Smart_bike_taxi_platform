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

status="$(curl --silent --show-error --output "$tmp_dir/history.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides")"
test "$status" = "200"
grep -q "$ride_id" "$tmp_dir/history.json"

status="$(curl --silent --show-error --output "$tmp_dir/detail.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" "$base_url/api/v1/rides/$ride_id")"
test "$status" = "200"
grep -q '"status":"requested"' "$tmp_dir/detail.json"

status="$(curl --silent --show-error --output "$tmp_dir/cancel.json" --write-out '%{http_code}' \
  --header "Authorization: Bearer $token" --request POST "$base_url/api/v1/rides/$ride_id/cancel")"
test "$status" = "200"
grep -q '"status":"cancelled"' "$tmp_dir/cancel.json"

echo "PASS: health, validation, auth, persisted booking, history, detail, and cancellation, idempotent replay/conflict, and expired quote rejection"
