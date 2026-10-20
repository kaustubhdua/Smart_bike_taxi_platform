#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must point to the database to back up}"
output="${1:-}"
if [ -z "$output" ]; then
  echo "Usage: DATABASE_URL=... sh backend/scripts/backup.sh <output.dump>" >&2
  exit 2
fi
case "$output" in
  *.dump) ;;
  *) echo "Backup output must use the .dump suffix (custom pg_dump format)" >&2; exit 2 ;;
esac
umask 077
parent=$(dirname "$output")
mkdir -p "$parent"
temporary="$output.tmp.$$"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
pg_dump --format=custom --no-owner --no-acl --file="$temporary" "$DATABASE_URL"
test -s "$temporary"
mv "$temporary" "$output"
trap - EXIT HUP INT TERM
echo "Backup created: $output"
