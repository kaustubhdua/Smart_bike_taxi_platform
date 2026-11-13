#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must point to the restore target database}"
input="${1:-}"
if [ -z "$input" ] || [ ! -s "$input" ]; then
  echo "Usage: DATABASE_URL=... sh backend/scripts/restore.sh <backup.dump>" >&2
  exit 2
fi
existing_objects="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')")"
if [ "$existing_objects" != "0" ]; then
  echo "Restore target is not empty ($existing_objects user relations found); refusing to modify it." >&2
  exit 2
fi
echo "Restore target is empty. No existing objects will be dropped."
pg_restore --no-owner --no-acl --exit-on-error --dbname="$DATABASE_URL" "$input"

# Logical dumps intentionally omit global roles and ACLs. Reapply the
# reviewed role/privilege migrations so a restored database is usable without
# restoring cluster-wide credentials or broad grants from the source cluster.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
migrations_dir="${RIDEFORGE_MIGRATIONS_DIR:-$script_dir/../migrations}"
for migration in \
  009_create_private_backend_role \
  010_runtime_role_database_access \
  012_runtime_role_least_privilege \
  013_runtime_role_sequence_least_privilege \
  014_lock_down_public_function_execution_defaults \
  015_create_readonly_backup_role
do
  migration_file="$migrations_dir/$migration.sql"
  if [ ! -s "$migration_file" ]; then
    echo "Required role migration is missing: $migration_file" >&2
    exit 1
  fi
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration_file"
done

# The normal migration runner skips already-recorded schema versions and,
# when provided, validates/applies the runtime password without logging it.
RIDEFORGE_MIGRATIONS_DIR="$migrations_dir" sh "$script_dir/migrate-if-needed.sh"
if [ -z "${RIDEFORGE_APP_PASSWORD:-}" ]; then
  echo "WARNING: RIDEFORGE_APP_PASSWORD was not supplied; verify/configure the runtime role credential before starting the API." >&2
fi
echo "Restore completed and database roles re-provisioned: $input"
