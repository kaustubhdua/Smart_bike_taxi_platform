#!/bin/sh
set -eu

psql_base="psql -h db -U saarthi -d saarthi"
migration_table="$(psql -tAc "SELECT to_regclass('public.schema_migrations')" -h db -U saarthi -d saarthi)"

if [ "$migration_table" = "schema_migrations" ]; then
  if psql -tAc "SELECT 1 FROM schema_migrations WHERE version = '001_initial_schema'" -h db -U saarthi -d saarthi | grep -Fqx 1; then
    echo "Migration 001_initial_schema already applied"
    exit 0
  fi
fi

accounts_table="$(psql -tAc "SELECT to_regclass('public.accounts')" -h db -U saarthi -d saarthi)"
if [ "$accounts_table" = "accounts" ]; then
  echo "Existing unversioned schema detected; refusing unsafe automatic migration. Back up the database and baseline schema_migrations deliberately." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 -h db -U saarthi -d saarthi -f /schema.sql
