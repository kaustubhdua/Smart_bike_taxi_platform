#!/usr/bin/env bash
# Source this file and call rideforge_build_runtime_database_url. The generated
# Render password is kept out of logs and only exported into DATABASE_URL.
rideforge_build_runtime_database_url() {
  local template="${DATABASE_URL_TEMPLATE:?DATABASE_URL_TEMPLATE is required}"
  local password="${RIDEFORGE_APP_PASSWORD:?RIDEFORGE_APP_PASSWORD is required}"
  local authority userinfo password_body password_padding encoded

  case "$template" in
    postgresql://*__RIDEFORGE_PASSWORD__*) ;;
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
  authority=${template#postgresql://}
  case "$authority" in
    *@*) ;;
    *)
      echo "DATABASE_URL_TEMPLATE must include a PostgreSQL URI authority." >&2
      return 1
      ;;
  esac
  userinfo=${authority%%@*}
  case "$userinfo" in
    *:__RIDEFORGE_PASSWORD__) ;;
    *)
      echo "DATABASE_URL_TEMPLATE placeholder must occupy the URI password component." >&2
      return 1
      ;;
  esac

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
  if [ "${#password}" -lt 32 ]; then
    echo "RIDEFORGE_APP_PASSWORD must contain at least 32 characters." >&2
    return 1
  fi

  # Percent-encode base64 reserved characters before substituting into URI.
  encoded="$(printf '%s' "$password" | sed -e 's/+/%2B/g' -e 's,/,%2F,g' -e 's/=/%3D/g')"
  DATABASE_URL="${template//__RIDEFORGE_PASSWORD__/$encoded}"
  export DATABASE_URL
}
