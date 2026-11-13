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
cp "$temporary_dir/source.dump" "$temporary_dir/source.expected.dump"
if DATABASE_URL="$DATABASE_URL" sh backend/scripts/backup.sh "$temporary_dir/source.dump"; then
  echo "backup script unexpectedly overwrote an existing backup" >&2
  exit 1
fi
cmp "$temporary_dir/source.expected.dump" "$temporary_dir/source.dump"
# Keep the password in libpq's environment rather than interpolating it into a URI.
# PostgreSQL passwords may contain URI-reserved characters such as @, /, ?, or #.
restore_url="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${target_db}"
DATABASE_URL="$restore_url" sh backend/scripts/restore.sh "$temporary_dir/source.dump"
source_versions="$(psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -Atqc "SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations")"
restored_versions="$(psql -v ON_ERROR_STOP=1 -d "$restore_url" -Atqc "SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations")"
test -n "$source_versions"
test "$source_versions" = "$restored_versions"
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT to_regclass('public.support_reports') IS NOT NULL AND to_regclass('public.ride_offers') IS NOT NULL AND to_regclass('public.ride_offers_one_active_per_ride') IS NOT NULL" | grep -Fx 't'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT version FROM schema_migrations WHERE version = '015_create_readonly_backup_role'" | grep -Fx '015_create_readonly_backup_role'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT NOT rolcanlogin AND rolbypassrls AND NOT rolsuper AND rolpassword IS NULL FROM pg_authid WHERE rolname = 'rideforge_backup'" | grep -Fx 't'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT has_table_privilege('rideforge_app','public.accounts','SELECT,INSERT,UPDATE') AND NOT has_table_privilege('rideforge_app','public.accounts','DELETE,TRUNCATE') AND NOT has_sequence_privilege('rideforge_app','public.ride_events_id_seq','UPDATE')" | grep -Fx 't'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT has_table_privilege('rideforge_backup','public.accounts','SELECT') AND NOT has_table_privilege('rideforge_backup','public.accounts','INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_sequence_privilege('rideforge_backup','public.ride_events_id_seq','UPDATE')" | grep -Fx 't'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT NOT has_function_privilege('anon','public.enqueue_ride_event_notification()','EXECUTE') AND NOT has_function_privilege('authenticated','public.enqueue_ride_event_notification()','EXECUTE')" | grep -Fx 't'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity" | grep -Fx '0'
psql -v ON_ERROR_STOP=1 -d "$target_db" -tAc "SELECT count(*) FROM pg_tables t WHERE schemaname='public' AND (has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))" | grep -Fx '0'
echo "PASS: backup and restore scripts restore schema and migration history into an empty database"
