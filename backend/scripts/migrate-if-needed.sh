#!/bin/sh
set -eu

db_host="${PGHOST:-db}"
db_user="${PGUSER:-saarthi}"
db_name="${PGDATABASE:-saarthi}"
schema_file="${SAARTHI_SCHEMA_FILE:-/schema.sql}"

psql_db() {
  psql -h "$db_host" -U "$db_user" -d "$db_name" "$@"
}

migration_table="$(psql_db -tAc "SELECT to_regclass('public.schema_migrations')")"

if [ "$migration_table" = "schema_migrations" ]; then
  if psql_db -tAc "SELECT 1 FROM schema_migrations WHERE version = '001_initial_schema'" | grep -Fqx 1; then
    echo "Migration 001_initial_schema already applied"
    exit 0
  fi
fi

accounts_table="$(psql_db -tAc "SELECT to_regclass('public.accounts')")"
if [ "$accounts_table" = "accounts" ]; then
  echo "Existing unversioned schema detected; refusing unsafe automatic migration. Back up the database and baseline schema_migrations deliberately." >&2
  exit 1
fi

psql_db -v ON_ERROR_STOP=1 -f "$schema_file"
