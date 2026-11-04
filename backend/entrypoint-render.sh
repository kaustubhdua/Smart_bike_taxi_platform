#!/usr/bin/env bash
set -Eeuo pipefail

# Render runs the API and both durable background workers in one web-service
# container because its free web-service tier does not provide background
# workers. If any process exits, stop the others so the platform restarts the
# whole service rather than silently losing dispatch or outbox processing.

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
# accepting bookings while offers/outbox events are no longer processed.
set +e
wait -n "${pids[@]}"
status=$?
set -e
shutdown "$status"
