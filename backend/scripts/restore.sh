#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must point to the restore target database}"
input="${1:-}"
if [ -z "$input" ] || [ ! -s "$input" ]; then
  echo "Usage: DATABASE_URL=... sh backend/scripts/restore.sh <backup.dump>" >&2
  exit 2
fi
echo "Restore target must be a dedicated, empty database. This script does not drop existing objects."
pg_restore --no-owner --no-acl --exit-on-error --dbname="$DATABASE_URL" "$input"
echo "Restore completed: $input"
