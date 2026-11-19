-- Disposable integration tests for atomic offer transitions.
-- Every fixture is rolled back; no production data is touched.
BEGIN;

DO $test$
DECLARE
  passenger_id uuid := gen_random_uuid();
  driver_one uuid := gen_random_uuid();
  driver_two uuid := gen_random_uuid();
  driver_three uuid := gen_random_uuid();
  decline_ride uuid := gen_random_uuid();
  accept_ride uuid := gen_random_uuid();
  expired_ride uuid := gen_random_uuid();
  decline_offer_id bigint;
  accept_offer_id bigint;
  expired_offer_id bigint;
  result jsonb;
  rejected boolean;
BEGIN
  INSERT INTO public.accounts(id,email,display_name,role,password_hash)
  VALUES
    (passenger_id, 'dispatch-test-'||passenger_id||'@example.invalid', 'Dispatch Test Passenger', 'passenger', 'test-only'),
    (driver_one, 'dispatch-test-'||driver_one||'@example.invalid', 'Dispatch Test Driver One', 'driver', 'test-only'),
    (driver_two, 'dispatch-test-'||driver_two||'@example.invalid', 'Dispatch Test Driver Two', 'driver', 'test-only'),
    (driver_three, 'dispatch-test-'||driver_three||'@example.invalid', 'Dispatch Test Driver Three', 'driver', 'test-only');

  INSERT INTO public.driver_profiles(account_id,vehicle_registration,is_approved,is_online,current_latitude,current_longitude,last_location_at)
  VALUES(driver_one,'TEST-'||substr(driver_one::text,1,8),true,true,28.6139,77.2090,now());

  INSERT INTO public.rides(id,passenger_id,status,pickup_label,pickup_latitude,pickup_longitude,
    destination_label,destination_latitude,destination_longitude,route_distance_m,quoted_fare_paise,idempotency_key)
  VALUES
    (decline_ride,passenger_id,'matching','Test pickup',28.6139,77.2090,'Test destination',28.6200,77.2150,1000,3100,'decline-'||substr(decline_ride::text,1,8)),
    (accept_ride,passenger_id,'matching','Test pickup 2',28.6139,77.2090,'Test destination 2',28.6200,77.2150,1000,3100,'accept-'||substr(accept_ride::text,1,8)),
    (expired_ride,passenger_id,'matching','Test pickup 3',28.6139,77.2090,'Test destination 3',28.6200,77.2150,1000,3100,'expired-'||substr(expired_ride::text,1,8));

  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
  VALUES(decline_ride,driver_one,'offered',now(),now()+interval '45 seconds')
  RETURNING id INTO decline_offer_id;

  result := public.rideforge_decline_offer(driver_one,decline_ride);
  IF result->>'status' <> 'declined' THEN
    RAISE EXCEPTION 'decline RPC did not return declined: %', result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ride_offers WHERE id=decline_offer_id AND status='declined' AND responded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'decline did not persist offer decision';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_ride_declines WHERE ride_id=decline_ride AND driver_id=driver_one) THEN
    RAISE EXCEPTION 'decline exclusion row was not committed with offer decision';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id=decline_ride AND driver_id IS NULL AND status IN ('requested','matching')) THEN
    RAISE EXCEPTION 'decline changed or assigned the passenger ride';
  END IF;

  INSERT INTO public.driver_profiles(account_id,vehicle_registration,is_approved,is_online,current_latitude,current_longitude,last_location_at)
  VALUES
    (driver_two,'TEST-'||substr(driver_two::text,1,8),true,true,28.6140,77.2091,now()),
    (driver_three,'TEST-'||substr(driver_three::text,1,8),true,true,28.6141,77.2092,now());

  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
  VALUES(accept_ride,driver_two,'offered',now(),now()+interval '45 seconds')
  RETURNING id INTO accept_offer_id;

  result := public.rideforge_accept_offer(driver_two,accept_ride);
  IF result->>'status' <> 'assigned' THEN
    RAISE EXCEPTION 'accept RPC did not return assigned: %', result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rides WHERE id=accept_ride AND driver_id=driver_two AND status='assigned') THEN
    RAISE EXCEPTION 'accept did not assign the ride';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ride_offers WHERE id=accept_offer_id AND status='accepted') THEN
    RAISE EXCEPTION 'accept did not persist accepted offer';
  END IF;
  IF EXISTS (SELECT 1 FROM public.driver_profiles WHERE account_id=driver_two AND is_online) THEN
    RAISE EXCEPTION 'accepted driver remained online';
  END IF;

  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
  VALUES(expired_ride,driver_three,'offered',now()-interval '2 minutes',now()-interval '1 minute')
  RETURNING id INTO expired_offer_id;

  rejected := false;
  BEGIN
    PERFORM public.rideforge_accept_offer(driver_three,expired_ride);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'expired offer was accepted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ride_offers WHERE id=expired_offer_id AND status='offered') THEN
    RAISE EXCEPTION 'failed acceptance unexpectedly changed the expired offer';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rides WHERE id=expired_ride AND driver_id IS NOT NULL) THEN
    RAISE EXCEPTION 'expired offer assigned a driver';
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.rideforge_decline_offer(driver_three,expired_ride);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'expired offer was declined';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ride_offers WHERE id=expired_offer_id AND status='offered') THEN
    RAISE EXCEPTION 'failed decline unexpectedly changed the expired offer';
  END IF;
  IF EXISTS (SELECT 1 FROM public.driver_ride_declines WHERE ride_id=expired_ride AND driver_id=driver_three) THEN
    RAISE EXCEPTION 'failed decline wrote a driver exclusion row';
  END IF;
END
$test$;

ROLLBACK;
