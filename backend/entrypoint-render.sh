#!/usr/bin/env bash
set -Eeuo pipefail

# Render runs the API and both durable background workers in one web-service
# container because its free web-service tier does not provide background
# workers. Migrations use a separate owner connection; the API/workers use the
# non-superuser rideforge_app role. If any child exits, stop siblings so the
# platform restarts the whole service instead of silently losing a worker.

export RIDEFORGE_APP_PASSWORD="${RIDEFORGE_RUNTIME_ROLE_PASSWORD:?RIDEFORGE_RUNTIME_ROLE_PASSWORD is required}"
source /usr/local/bin/rideforge_build_runtime_database_url
rideforge_build_runtime_database_url
runtime_database_url="$DATABASE_URL"
migration_database_url="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL (migration owner) is required}"

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
