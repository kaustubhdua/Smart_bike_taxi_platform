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
echo "Restore completed: $input"
