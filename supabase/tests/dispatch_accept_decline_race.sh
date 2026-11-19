#!/usr/bin/env bash
set -Eeuo pipefail

DB_URL="${RIDEFORGE_TEST_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
workdir="$(mktemp -d)"
passenger_id=""
driver_id=""
ride_id=""
offer_id=""

cleanup() {
  if [[ -n "$ride_id" ]]; then
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || true
DELETE FROM public.driver_ride_declines WHERE ride_id='$ride_id';
DELETE FROM public.ride_offers WHERE ride_id='$ride_id';
DELETE FROM public.ride_events WHERE ride_id='$ride_id';
DELETE FROM public.rides WHERE id='$ride_id';
DELETE FROM public.driver_profiles WHERE account_id='$driver_id';
DELETE FROM public.accounts WHERE id IN ('$passenger_id','$driver_id');
SQL
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

read -r passenger_id driver_id ride_id < <(
  psql "$DB_URL" -X -At -F ' ' -c "SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid()"
)

psql "$DB_URL" -X -v ON_ERROR_STOP=1 >/dev/null <<SQL
INSERT INTO public.accounts(id,email,display_name,role,password_hash)
VALUES
  ('$passenger_id','race-passenger-$passenger_id@example.invalid','Race Passenger','passenger','test-only'),
  ('$driver_id','race-driver-$driver_id@example.invalid','Race Driver','driver','test-only');

INSERT INTO public.driver_profiles(account_id,vehicle_registration,is_approved,is_online,current_latitude,current_longitude,last_location_at)
VALUES('$driver_id','RACE-'||substr('$driver_id',1,8),true,true,28.6139,77.2090,now());

INSERT INTO public.rides(id,passenger_id,status,pickup_label,pickup_latitude,pickup_longitude,
  destination_label,destination_latitude,destination_longitude,route_distance_m,quoted_fare_paise,idempotency_key)
VALUES('$ride_id','$passenger_id','matching','Race pickup',28.6139,77.2090,
  'Race destination',28.6200,77.2150,1000,3100,'race-'||substr('$ride_id',1,8));

SQL
offer_id="$(psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at) VALUES('$ride_id','$driver_id','offered',now(),now()+interval '45 seconds') RETURNING id")"

set +e
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "SELECT public.rideforge_accept_offer('$driver_id','$ride_id')" >"$workdir/accept.log" 2>&1 &
accept_pid=$!
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "SELECT public.rideforge_decline_offer('$driver_id','$ride_id')" >"$workdir/decline.log" 2>&1 &
decline_pid=$!
wait "$accept_pid"; accept_rc=$?
wait "$decline_pid"; decline_rc=$?
set -e

success_count=0
[[ "$accept_rc" -eq 0 ]] && success_count=$((success_count+1))
[[ "$decline_rc" -eq 0 ]] && success_count=$((success_count+1))
if [[ "$success_count" -ne 1 ]]; then
  echo "Expected exactly one of accept/decline to win; accept=$accept_rc decline=$decline_rc" >&2
  cat "$workdir/accept.log" "$workdir/decline.log" >&2
  exit 1
fi

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v ride_id="$ride_id" -v offer_id="$offer_id" -v driver_id="$driver_id" <<'SQL'
SELECT set_config('rideforge.test.ride_id', :'ride_id', false);
SELECT set_config('rideforge.test.offer_id', :'offer_id', false);
SELECT set_config('rideforge.test.driver_id', :'driver_id', false);
DO $verify$
DECLARE
  v_ride_id uuid := current_setting('rideforge.test.ride_id')::uuid;
  v_offer_id bigint := current_setting('rideforge.test.offer_id')::bigint;
  v_driver_id uuid := current_setting('rideforge.test.driver_id')::uuid;
  ride_status text;
  assigned_driver uuid;
  offer_status text;
  declined_count integer;
  online boolean;
BEGIN
  SELECT status::text,driver_id INTO ride_status,assigned_driver
  FROM public.rides WHERE id=v_ride_id;
  SELECT status INTO offer_status FROM public.ride_offers WHERE id=v_offer_id;
  SELECT count(*) INTO declined_count FROM public.driver_ride_declines
  WHERE ride_id=v_ride_id AND driver_id=v_driver_id;
  SELECT is_online INTO online FROM public.driver_profiles WHERE account_id=v_driver_id;

  IF offer_status='accepted' THEN
    IF ride_status<>'assigned' OR assigned_driver IS DISTINCT FROM v_driver_id OR declined_count<>0 OR online THEN
      RAISE EXCEPTION 'accept winner left inconsistent state';
    END IF;
  ELSIF offer_status='declined' THEN
    IF ride_status NOT IN ('requested','matching') OR assigned_driver IS NOT NULL OR declined_count<>1 OR NOT online THEN
      RAISE EXCEPTION 'decline winner left inconsistent state';
    END IF;
  ELSE
    RAISE EXCEPTION 'unexpected terminal offer state: %',offer_status;
  END IF;
END
$verify$;
SQL

echo "Concurrent accept-vs-decline race passed: exactly one transition committed."
