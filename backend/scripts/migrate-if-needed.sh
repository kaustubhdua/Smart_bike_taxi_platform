#!/bin/sh
set -eu

db_host="${PGHOST:-db}"
db_user="${PGUSER:-rideforge}"
db_name="${PGDATABASE:-rideforge}"
migrations_dir="${RIDEFORGE_MIGRATIONS_DIR:-/migrations}"
schema_file="${RIDEFORGE_SCHEMA_FILE:-}"

psql_db() {
  psql -h "$db_host" -U "$db_user" -d "$db_name" "$@"
}

migration_table="$(psql_db -tAc "SELECT to_regclass('public.schema_migrations')")"
accounts_table="$(psql_db -tAc "SELECT to_regclass('public.accounts')")"

if [ "$migration_table" != "schema_migrations" ] && [ "$accounts_table" = "accounts" ]; then
  echo "Existing unversioned schema detected; refusing unsafe automatic migration. Back up the database and baseline schema_migrations deliberately." >&2
  exit 1
fi

if [ -n "$schema_file" ]; then
  set -- "$schema_file"
elif [ -d "$migrations_dir" ]; then
  set -- "$migrations_dir"/*.sql
else
  echo "Migration directory not found: $migrations_dir" >&2
  exit 1
fi

if [ "$#" -eq 0 ] || [ ! -f "$1" ]; then
  echo "No SQL migration files found." >&2
  exit 1
fi

for file do
  [ -f "$file" ] || continue
  version="$(basename "$file" .sql)"
  if [ "$migration_table" = "schema_migrations" ] &&
     psql_db -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'" | grep -Fqx 1; then
    echo "Migration $version already applied"
    continue
  fi
  echo "Applying migration $version"
  psql_db -v ON_ERROR_STOP=1 -f "$file"
  migration_table="schema_migrations"
done
