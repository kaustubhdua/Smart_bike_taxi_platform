#!/usr/bin/env bash
# Source this file and call rideforge_build_runtime_database_url. The generated
# Render password is kept out of logs and only exported into DATABASE_URL.
rideforge_require_sslmode() {
  case "$1" in
    *[?&]sslmode=require*|*[?&]sslmode=verify-ca*|*[?&]sslmode=verify-full*) ;;
    *)
      echo "Database connection URI must set sslmode=require, verify-ca, or verify-full." >&2
      return 1
      ;;
  esac
}

rideforge_validate_migration_database_url() {
  local url="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
  local scheme authority userinfo hostport owner_password
  local runtime_scheme runtime_authority runtime_userinfo runtime_hostport
  local runtime_project_ref owner_project_ref

  case "$url" in
    postgresql://*) scheme="postgresql://" ;;
    postgres://*) scheme="postgres://" ;;
    *)
      echo "MIGRATION_DATABASE_URL must be a PostgreSQL URI." >&2
      return 1
      ;;
  esac
  authority=${url#"$scheme"}
  case "$authority" in
    *@*) ;;
    *)
      echo "MIGRATION_DATABASE_URL must include an owner username and password." >&2
      return 1
      ;;
  esac
  userinfo=${authority%%@*}
  case "$userinfo" in
    postgres.*:*) ;;
    *)
      echo "MIGRATION_DATABASE_URL must use the postgres.PROJECT_REF owner username." >&2
      return 1
      ;;
  esac
  owner_password=${userinfo#*:}
  if [ -z "$owner_password" ]; then
    echo "MIGRATION_DATABASE_URL must include the owner password." >&2
    return 1
  fi
  hostport=${authority#*@}
  hostport=${hostport%%/*}
  case "$hostport" in
    aws-*.pooler.supabase.com:5432) ;;
    *)
      echo "MIGRATION_DATABASE_URL must use the Supabase shared Session pooler host on port 5432." >&2
      return 1
      ;;
  esac

  case "${DATABASE_URL_TEMPLATE:?DATABASE_URL_TEMPLATE is required}" in
    postgresql://*) runtime_scheme="postgresql://" ;;
    postgres://*) runtime_scheme="postgres://" ;;
    *) echo "DATABASE_URL_TEMPLATE must be a PostgreSQL URI." >&2; return 1 ;;
  esac
  runtime_authority=${DATABASE_URL_TEMPLATE#"$runtime_scheme"}
  runtime_userinfo=${runtime_authority%%@*}
  runtime_hostport=${runtime_authority#*@}
  runtime_hostport=${runtime_hostport%%/*}
  runtime_project_ref=${runtime_userinfo#rideforge_app.}
  runtime_project_ref=${runtime_project_ref%%:*}
  owner_project_ref=${userinfo#postgres.}
  owner_project_ref=${owner_project_ref%%:*}
  if [ -z "$runtime_project_ref" ] || [ "$runtime_project_ref" != "$owner_project_ref" ]; then
    echo "DATABASE_URL_TEMPLATE and MIGRATION_DATABASE_URL must target the same Supabase project." >&2
    return 1
  fi
  if [ "$runtime_hostport" != "$hostport" ]; then
    echo "DATABASE_URL_TEMPLATE and MIGRATION_DATABASE_URL must use the same Session-pooler host and port." >&2
    return 1
  fi
  rideforge_require_sslmode "$url"
}

rideforge_build_runtime_database_url() {
  local template="${DATABASE_URL_TEMPLATE:?DATABASE_URL_TEMPLATE is required}"
  local password="${RIDEFORGE_APP_PASSWORD:?RIDEFORGE_APP_PASSWORD is required}"
  local scheme authority userinfo password_body password_padding encoded

  case "$template" in
    postgresql://*__RIDEFORGE_PASSWORD__*) scheme="postgresql://" ;;
    postgres://*__RIDEFORGE_PASSWORD__*) scheme="postgres://" ;;
    *)
      echo "DATABASE_URL_TEMPLATE must be a PostgreSQL URI containing __RIDEFORGE_PASSWORD__." >&2
      return 1
      ;;
  esac
  case "$template" in
    *__RIDEFORGE_PASSWORD__*__RIDEFORGE_PASSWORD__*)
      echo "DATABASE_URL_TEMPLATE must contain the password placeholder exactly once." >&2
      return 1
      ;;
  esac
  authority=${template#"$scheme"}
  case "$authority" in
    *@*) ;;
    *)
      echo "DATABASE_URL_TEMPLATE must include a PostgreSQL URI authority." >&2
      return 1
      ;;
  esac
  userinfo=${authority%%@*}
  case "$userinfo" in
    rideforge_app.*:__RIDEFORGE_PASSWORD__) ;;
    *)
      echo "DATABASE_URL_TEMPLATE must use the rideforge_app.<PROJECT_REF> pooler username and put the placeholder in its password component." >&2
      return 1
      ;;
  esac
  # Render's outbound network is IPv4-only and Supabase direct DB endpoints
  # are IPv6-only on the free tier. Require the shared Session pooler rather
  # than letting a direct/transaction-pooler URI fail only at runtime.
  local hostport
  hostport=${authority#*@}
  hostport=${hostport%%/*}
  case "$hostport" in
    aws-*.pooler.supabase.com:5432) ;;
    *)
      echo "DATABASE_URL_TEMPLATE must use the Supabase shared Session pooler host on port 5432." >&2
      return 1
      ;;
  esac
  rideforge_require_sslmode "$template"

  password_body=${password%%=*}
  password_padding=${password#"$password_body"}
  case "$password_body" in
    ""|*[!A-Za-z0-9+/]*)
      echo "RIDEFORGE_APP_PASSWORD must be a standard base64 value." >&2
      return 1
      ;;
  esac
  case "$password_padding" in
    ""|"="|"==") ;;
    *)
      echo "RIDEFORGE_APP_PASSWORD must be a standard base64 value." >&2
      return 1
      ;;
  esac
  if [ $((${#password} % 4)) -ne 0 ]; then
    echo "RIDEFORGE_APP_PASSWORD must be valid padded base64." >&2
    return 1
  fi
  if [ "${#password}" -lt 32 ]; then
    echo "RIDEFORGE_APP_PASSWORD must contain at least 32 characters." >&2
    return 1
  fi

  # Percent-encode base64 reserved characters before substituting into URI.
  encoded="$(printf '%s' "$password" | sed -e 's/+/%2B/g' -e 's,/,%2F,g' -e 's/=/%3D/g')"
  DATABASE_URL="${template//__RIDEFORGE_PASSWORD__/$encoded}"
  export DATABASE_URL
}
