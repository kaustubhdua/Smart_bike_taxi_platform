#!/usr/bin/env bash
set -Eeuo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/build-runtime-database-url.sh
source "$script_dir/../scripts/build-runtime-database-url.sh"

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
RIDEFORGE_APP_PASSWORD='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+/'
rideforge_build_runtime_database_url
expected='postgresql://rideforge_app.projectref:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%2B%2F@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
[ "$DATABASE_URL" = "$expected" ]

RIDEFORGE_APP_PASSWORD='B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk='
rideforge_build_runtime_database_url
expected='postgresql://rideforge_app.projectref:B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk%3D@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
[ "$DATABASE_URL" = "$expected" ]

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:no-placeholder@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected a missing password placeholder to fail." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?again=__RIDEFORGE_PASSWORD__'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected duplicate password placeholders to fail." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:plain-password@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?value=__RIDEFORGE_PASSWORD__'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected a placeholder outside the URI password component to fail." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected a placeholder in the URI username to fail." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@db.projectref.supabase.co:5432/postgres'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected an IPv6-only direct Supabase endpoint to be rejected for Render." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:6543/postgres'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected the transaction pooler port to be rejected for the persistent backend." >&2
  exit 1
fi

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
RIDEFORGE_APP_PASSWORD='not-base64-password'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected an invalid generated password to fail." >&2
  exit 1
fi

RIDEFORGE_APP_PASSWORD='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected a base64 value with invalid length to fail." >&2
  exit 1
fi

echo "Render runtime database URL construction tests passed."
