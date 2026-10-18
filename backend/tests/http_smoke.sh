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

echo "PASS: database health, invalid quote validation, and unknown-route handling"
