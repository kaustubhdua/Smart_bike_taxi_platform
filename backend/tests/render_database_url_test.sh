#!/usr/bin/env bash
set -Eeuo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/build-runtime-database-url.sh
source "$script_dir/../scripts/build-runtime-database-url.sh"

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-7-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
RIDEFORGE_APP_PASSWORD='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+/'
rideforge_build_runtime_database_url
expected='postgresql://rideforge_app.projectref:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%2B%2F@aws-7-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
[ "$DATABASE_URL" = "$expected" ]

RIDEFORGE_APP_PASSWORD='B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk='
rideforge_build_runtime_database_url
expected='postgresql://rideforge_app.projectref:B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk%3D@aws-7-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
[ "$DATABASE_URL" = "$expected" ]

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:no-placeholder@host:5432/postgres'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected a missing password placeholder to fail." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@host:5432/postgres?again=__RIDEFORGE_PASSWORD__'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected duplicate password placeholders to fail." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@host:5432/postgres'
RIDEFORGE_APP_PASSWORD='not-base64-password'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected an invalid generated password to fail." >&2
  exit 1
fi

echo "Render runtime database URL construction tests passed."
