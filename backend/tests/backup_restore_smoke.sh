#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
temporary_dir=$(mktemp -d)
target_db="rideforge_backup_target_$$"
cleanup() {
  dropdb --if-exists "$target_db" >/dev/null 2>&1 || true
  rm -rf "$temporary_dir"
}
trap cleanup EXIT HUP INT TERM

createdb "$target_db"
DATABASE_URL="$DATABASE_URL" sh backend/scripts/backup.sh "$temporary_dir/source.dump"
restore_url="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${target_db}"
DATABASE_URL="$restore_url" sh backend/scripts/restore.sh "$temporary_dir/source.dump"
source_versions="$(psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -Atqc "SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations")"
restored_versions="$(psql -v ON_ERROR_STOP=1 -d "$restore_url" -Atqc "SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations")"
test -n "$source_versions"
test "$source_versions" = "$restored_versions"
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT to_regclass('public.support_reports') IS NOT NULL AND to_regclass('public.ride_offers') IS NOT NULL AND to_regclass('public.ride_offers_one_active_per_ride') IS NOT NULL" | grep -Fx 't'
echo "PASS: backup and restore scripts restore schema and migration history into an empty database"
