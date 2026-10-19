#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
driver_id="50000000-0000-4000-8000-000000000001"
email="deadlock-smoke-driver@example.test"
tmp_dir="$(mktemp -d)"
cleanup() {
  psql -v ON_ERROR_STOP=1 -v driver_id="$driver_id" -c "DELETE FROM driver_profiles WHERE account_id = :'driver_id'::uuid" >/dev/null 2>&1 || true
  psql -v ON_ERROR_STOP=1 -v driver_id="$driver_id" -c "DELETE FROM accounts WHERE id = :'driver_id'::uuid" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

psql -v ON_ERROR_STOP=1 -v driver_id="$driver_id" -v email="$email" <<'SQL'
INSERT INTO accounts (id, email, display_name, role, password_hash)
VALUES (:'driver_id'::uuid, :'email', 'Deadlock Smoke Driver', 'driver', 'test-hash')
ON CONFLICT (id) DO NOTHING;
INSERT INTO driver_profiles (account_id, vehicle_registration, is_approved, is_online)
VALUES (:'driver_id'::uuid, 'LOCK-SMOKE-001', true, true)
ON CONFLICT (account_id) DO NOTHING;
SQL

# Each session locks the same two rows in opposite order. PostgreSQL must detect
# the cycle, abort one transaction, and allow the survivor to commit.
psql -v ON_ERROR_STOP=1 -v driver_id="$driver_id" >"$tmp_dir/session-a.log" 2>&1 <<'SQL' &
BEGIN;
SELECT id FROM accounts WHERE id = :'driver_id'::uuid FOR UPDATE;
SELECT pg_sleep(1.0);
SELECT account_id FROM driver_profiles WHERE account_id = :'driver_id'::uuid FOR UPDATE;
COMMIT;
SQL
pid_a=$!

psql -v ON_ERROR_STOP=1 -v driver_id="$driver_id" >"$tmp_dir/session-b.log" 2>&1 <<'SQL' &
BEGIN;
SELECT account_id FROM driver_profiles WHERE account_id = :'driver_id'::uuid FOR UPDATE;
SELECT pg_sleep(1.0);
SELECT id FROM accounts WHERE id = :'driver_id'::uuid FOR UPDATE;
COMMIT;
SQL
pid_b=$!

set +e
wait "$pid_a"
status_a=$?
wait "$pid_b"
status_b=$?
set -e

if ! { test "$status_a" -eq 0 && test "$status_b" -ne 0; } &&
   ! { test "$status_a" -ne 0 && test "$status_b" -eq 0; }; then
  echo "Expected exactly one deadlock victim; session A=$status_a session B=$status_b"
  cat "$tmp_dir/session-a.log" "$tmp_dir/session-b.log"
  exit 1
fi

if test "$status_a" -ne 0; then victim_log="$tmp_dir/session-a.log"; else victim_log="$tmp_dir/session-b.log"; fi
if ! grep -qi "deadlock detected" "$victim_log"; then
  echo "The losing transaction did not fail for the expected deadlock reason"
  cat "$tmp_dir/session-a.log" "$tmp_dir/session-b.log"
  exit 1
fi

psql -v ON_ERROR_STOP=1 -tAc "SELECT 1" | grep -Fx '1'
echo "PASS: PostgreSQL detects a real row-lock deadlock, aborts one transaction, commits the other, and remains usable."
