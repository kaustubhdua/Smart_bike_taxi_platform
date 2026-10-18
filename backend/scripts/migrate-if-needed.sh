#!/bin/sh
set -eu
if psql -tAc "SELECT to_regclass('public.accounts')" -h db -U saarthi -d saarthi | grep -Fqx accounts; then
  echo "Schema already present"
else
  psql -v ON_ERROR_STOP=1 -h db -U saarthi -d saarthi -f /schema.sql
fi
