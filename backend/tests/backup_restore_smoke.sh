#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
temporary_dir=$(mktemp -d)
source_db="rideforge_backup_source_$$"
target_db="rideforge_backup_target_$$"
cleanup() {
  dropdb --if-exists "$source_db" >/dev/null 2>&1 || true
  dropdb --if-exists "$target_db" >/dev/null 2>&1 || true
  rm -rf "$temporary_dir"
}
trap cleanup EXIT HUP INT TERM

createdb "$source_db"
createdb "$target_db"
pg_dump --format=custom --no-owner --no-acl --file="$temporary_dir/source.dump" "$DATABASE_URL"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$source_db" "$temporary_dir/source.dump"
pg_dump --format=custom --no-owner --no-acl --file="$temporary_dir/source-db.dump" "$source_db"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$target_db" "$temporary_dir/source-db.dump"
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT count(*) FROM schema_migrations WHERE version IN ('001_initial_schema','002_driver_approval_and_outbox')" | grep -Fx '2'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT to_regclass('public.ride_event_outbox') IS NOT NULL" | grep -Fx 't'
echo "PASS: custom-format backup restores schema and migration history into an empty database"
