#!/usr/bin/env bash
set -Eeuo pipefail

# Render runs the API and both durable background workers in one web-service
# container because its free web-service tier does not provide background
# workers. Migrations use a separate owner connection; the API/workers use the
# non-superuser rideforge_app role. If any child exits, stop siblings so the
# platform restarts the whole service instead of silently losing a worker.

database_url_template="${DATABASE_URL_TEMPLATE:?DATABASE_URL_TEMPLATE (session-pooler URI with __RIDEFORGE_PASSWORD__ placeholder) is required}"
migration_database_url="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL (migration owner) is required}"
: "${RIDEFORGE_APP_PASSWORD:?RIDEFORGE_APP_PASSWORD is required to provision the runtime role}"

case "$database_url_template" in
  *__RIDEFORGE_PASSWORD__*) ;;
  *)
    echo "DATABASE_URL_TEMPLATE must contain the __RIDEFORGE_PASSWORD__ placeholder." >&2
    exit 1
    ;;
esac
case "$database_url_template" in
  *__RIDEFORGE_PASSWORD__*__RIDEFORGE_PASSWORD__*)
    echo "DATABASE_URL_TEMPLATE must contain the password placeholder exactly once." >&2
    exit 1
    ;;
esac

# Render generates standard base64. Percent-encode its reserved URI characters
# before substituting the password; never print the resulting connection string.
encoded_runtime_password="$(printf '%s' "$RIDEFORGE_APP_PASSWORD" | sed -e 's/+/%2B/g' -e 's,/,%2F,g' -e 's/=/%3D/g')"
runtime_database_url="${database_url_template//__RIDEFORGE_PASSWORD__/$encoded_runtime_password}"

export DATABASE_URL="$migration_database_url"
export RIDEFORGE_MIGRATIONS_DIR=/opt/rideforge/migrations
/usr/local/bin/rideforge_migrate
export DATABASE_URL="$runtime_database_url"
unset MIGRATION_DATABASE_URL

pids=()
shutdown() {
  local code=${1:-0}
  trap - TERM INT EXIT
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  exit "$code"
}
trap 'shutdown 0' TERM INT

/usr/local/bin/rideforge_outbox_worker &
pids+=("$!")
/usr/local/bin/rideforge_dispatch_worker &
pids+=("$!")
/usr/local/bin/rideforge_api &
pids+=("$!")

# Wait until one service exits; a worker crash must not leave a degraded API
# accepting bookings while offers/outbox processing are no longer running.
set +e
wait -n "${pids[@]}"
status=$?
set -e
shutdown "$status"
