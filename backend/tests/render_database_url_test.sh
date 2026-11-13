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

# Supabase's current Connect examples may use the equivalent postgres:// alias.
DATABASE_URL_TEMPLATE='postgres://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
RIDEFORGE_APP_PASSWORD='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+/'
rideforge_build_runtime_database_url
expected='postgres://rideforge_app.projectref:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%2B%2F@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
[ "$DATABASE_URL" = "$expected" ]

DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
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


# Runtime and migration-owner URIs must both require TLS.
DATABASE_URL_TEMPLATE='postgresql://rideforge_app.projectref:__RIDEFORGE_PASSWORD__@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
RIDEFORGE_APP_PASSWORD='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
if rideforge_build_runtime_database_url >/dev/null 2>&1; then
  echo "Expected a runtime URI without sslmode to fail." >&2
  exit 1
fi

MIGRATION_DATABASE_URL='postgresql://postgres.projectref:owner-password@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
rideforge_validate_migration_database_url

MIGRATION_DATABASE_URL='postgres://postgres.projectref:owner-password@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full'
rideforge_validate_migration_database_url

MIGRATION_DATABASE_URL='postgresql://rideforge_app.projectref:owner-password@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
if rideforge_validate_migration_database_url >/dev/null 2>&1; then
  echo "Expected a runtime-role URI to be rejected as the migration owner." >&2
  exit 1
fi

MIGRATION_DATABASE_URL='postgresql://postgres.projectref:owner-password@db.projectref.supabase.co:5432/postgres?sslmode=require'
if rideforge_validate_migration_database_url >/dev/null 2>&1; then
  echo "Expected the direct IPv6 endpoint to be rejected for Render." >&2
  exit 1
fi

MIGRATION_DATABASE_URL='postgresql://postgres.projectref:owner-password@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require'
if rideforge_validate_migration_database_url >/dev/null 2>&1; then
  echo "Expected the transaction pooler to be rejected for migrations." >&2
  exit 1
fi

MIGRATION_DATABASE_URL='postgresql://postgres.projectref:owner-password@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
if rideforge_validate_migration_database_url >/dev/null 2>&1; then
  echo "Expected a migration URI without sslmode to fail." >&2
  exit 1
fi

MIGRATION_DATABASE_URL='postgresql://postgres.projectref@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require'
if rideforge_validate_migration_database_url >/dev/null 2>&1; then
  echo "Expected a migration URI without a password to fail." >&2
  exit 1
fi

echo "Render runtime database URL construction tests passed."
