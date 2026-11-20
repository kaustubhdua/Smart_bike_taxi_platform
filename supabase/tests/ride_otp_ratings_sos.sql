-- Disposable integration tests for migrations 029/030: expiring ride-start OTP, ratings, saved places, SOS.
-- Every fixture is rolled back; no production data is touched.
BEGIN;

DO $test$
DECLARE
  pax uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  drv uuid := gen_random_uuid();
  drv2 uuid := gen_random_uuid();
  ride_a uuid := gen_random_uuid();
  ride_b uuid := gen_random_uuid();
  ride_c uuid := gen_random_uuid();
  secret text;
  wrong text;
  result jsonb;
  failed boolean;
  i integer;
BEGIN
  INSERT INTO public.accounts(id,email,display_name,role,password_hash) VALUES
    (pax,'otp-'||pax||'@example.invalid','OTP Passenger','passenger','test-only'),
    (outsider,'otp-'||outsider||'@example.invalid','OTP Outsider','passenger','test-only'),
    (drv,'otp-'||drv||'@example.invalid','OTP Driver','driver','test-only'),
    (drv2,'otp-'||drv2||'@example.invalid','OTP Driver Two','driver','test-only');
  INSERT INTO public.driver_profiles(account_id,vehicle_registration,is_approved,is_online,current_latitude,current_longitude,last_location_at)
  VALUES (drv,'T-'||substr(drv::text,1,8),true,true,28.6139,77.2090,now()),
         (drv2,'T-'||substr(drv2::text,1,8),true,true,28.6139,77.2090,now());
  INSERT INTO public.rides(id,passenger_id,status,pickup_label,pickup_latitude,pickup_longitude,
    destination_label,destination_latitude,destination_longitude,route_distance_m,quoted_fare_paise,idempotency_key)
  VALUES
    (ride_a,pax,'matching','Pickup A',28.6139,77.2090,'Dest A',28.6200,77.2150,1000,3100,'otp-a-'||substr(ride_a::text,1,8)),
    (ride_b,pax,'matching','Pickup B',28.6139,77.2090,'Dest B',28.6200,77.2150,1000,3100,'otp-b-'||substr(ride_b::text,1,8)),
    (ride_c,pax,'matching','Pickup C',28.6139,77.2090,'Dest C',28.6200,77.2150,1000,3100,'otp-c-'||substr(ride_c::text,1,8));

  -- ---------------------------------------------------------- start code issuance
  IF EXISTS (SELECT 1 FROM public.ride_start_codes WHERE ride_id IN (ride_a,ride_b)) THEN
    RAISE EXCEPTION 'a start code existed before assignment';
  END IF;
  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
    VALUES (ride_a,drv,'offered',now(),now()+interval '45 seconds');
  PERFORM public.rideforge_accept_offer(drv,ride_a);
  SELECT code INTO secret FROM public.ride_start_codes WHERE ride_id=ride_a;
  IF secret IS NULL OR secret !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'assignment did not issue a 4-digit start code (got %)', secret;
  END IF;

  PERFORM public.rideforge_advance_ride(drv,ride_a,'driver_arriving');

  -- Starting without a code, with a wrong code, or as another driver must not start the ride.
  wrong := CASE WHEN secret = '0000' THEN '1111' ELSE '0000' END;
  result := public.rideforge_advance_ride(drv,ride_a,'in_progress');
  IF NOT coalesce((result->>'otpRejected')::boolean,false) OR result->>'status' <> 'driver_arriving' THEN
    RAISE EXCEPTION 'missing code was accepted: %', result;
  END IF;
  result := public.rideforge_advance_ride(drv,ride_a,'in_progress',wrong);
  IF NOT coalesce((result->>'otpRejected')::boolean,false) OR (result->>'attemptsRemaining')::int <> 3 THEN
    RAISE EXCEPTION 'wrong code was accepted or attempts not counted: %', result;
  END IF;
  IF (SELECT failed_attempts FROM public.ride_start_codes WHERE ride_id=ride_a) <> 2 THEN
    RAISE EXCEPTION 'failed attempts were not persisted';
  END IF;
  failed := false;
  BEGIN PERFORM public.rideforge_advance_ride(drv2,ride_a,'in_progress',secret);
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'a different driver started the ride'; END IF;

  result := public.rideforge_advance_ride(drv,ride_a,'in_progress',secret);
  IF result->>'status' <> 'in_progress' OR (result->>'otpRejected') IS NOT NULL THEN
    RAISE EXCEPTION 'correct code did not start the ride: %', result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ride_events WHERE ride_id=ride_a AND new_status='in_progress'
                 AND details->>'otp_verified'='true') THEN
    RAISE EXCEPTION 'start event did not record otp_verified';
  END IF;

  -- Rating is rejected until completion.
  failed := false;
  BEGIN PERFORM public.rideforge_rate_ride(pax,ride_a,5,'too early');
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'rating accepted before completion'; END IF;

  -- SOS: participants only, active rides only, de-duplicated within five minutes.
  result := public.rideforge_raise_sos(pax,ride_a,28.61,77.21,'help');
  IF result->>'status' <> 'open' OR (result->>'duplicate')::boolean THEN
    RAISE EXCEPTION 'SOS was not created: %', result;
  END IF;
  IF (public.rideforge_raise_sos(pax,ride_a,28.61,77.21,'again')->>'duplicate')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'repeat SOS was not de-duplicated';
  END IF;
  IF (SELECT count(*) FROM public.sos_events WHERE ride_id=ride_a AND account_id=pax) <> 1 THEN
    RAISE EXCEPTION 'duplicate SOS created extra rows';
  END IF;
  result := public.rideforge_raise_sos(drv,ride_a,NULL,NULL,NULL);
  IF (result->>'duplicate')::boolean THEN RAISE EXCEPTION 'driver SOS shared the passenger alert'; END IF;
  failed := false;
  BEGIN PERFORM public.rideforge_raise_sos(outsider,ride_a,NULL,NULL,'nope');
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'non-participant raised an SOS'; END IF;
  failed := false;
  BEGIN PERFORM public.rideforge_raise_sos(pax,ride_a,28.61,NULL,NULL);
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'half a coordinate pair was accepted'; END IF;

  -- ----------------------------------------------------------------- completion
  result := public.rideforge_advance_ride(drv,ride_a,'completed');
  IF result->>'status' <> 'completed' THEN RAISE EXCEPTION 'completion failed: %', result; END IF;
  IF (SELECT final_fare_paise FROM public.rides WHERE id=ride_a) <> 3100 THEN
    RAISE EXCEPTION 'final fare was not recorded';
  END IF;
  failed := false;
  BEGIN PERFORM public.rideforge_raise_sos(pax,ride_a,NULL,NULL,'after the ride');
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'SOS accepted on a completed ride'; END IF;

  -- ------------------------------------------------------------------- ratings
  PERFORM public.rideforge_rate_ride(pax,ride_a,4,'  Smooth ride  ');
  PERFORM public.rideforge_rate_ride(drv,ride_a,5,NULL);
  IF (SELECT ratee_id FROM public.ride_ratings WHERE ride_id=ride_a AND rater_id=pax) <> drv
     OR (SELECT ratee_id FROM public.ride_ratings WHERE ride_id=ride_a AND rater_id=drv) <> pax THEN
    RAISE EXCEPTION 'ratee was not the other participant';
  END IF;
  IF (SELECT comment FROM public.ride_ratings WHERE ride_id=ride_a AND rater_id=pax) <> 'Smooth ride' THEN
    RAISE EXCEPTION 'comment was not trimmed';
  END IF;
  failed := false;
  BEGIN PERFORM public.rideforge_rate_ride(pax,ride_a,1,'second try');
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'duplicate rating accepted'; END IF;
  failed := false;
  BEGIN PERFORM public.rideforge_rate_ride(outsider,ride_a,5,'not mine');
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'non-participant rated a ride'; END IF;
  failed := false;
  BEGIN PERFORM public.rideforge_rate_ride(pax,ride_a,6,NULL);
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'out-of-range stars accepted'; END IF;
  result := public.rideforge_rating_summary(drv);
  IF (result->>'count')::int <> 1 OR (result->>'average')::numeric <> 4.00 THEN
    RAISE EXCEPTION 'driver rating summary wrong: %', result;
  END IF;
  IF public.rideforge_rating_summary(outsider)->>'average' IS NOT NULL THEN
    RAISE EXCEPTION 'unrated account should have a null average';
  END IF;

  -- ---------------------------------------------------------- OTP expiry (ride C)
  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
    VALUES (ride_c,drv2,'offered',now(),now()+interval '45 seconds');
  PERFORM public.rideforge_accept_offer(drv2,ride_c);
  SELECT code INTO secret FROM public.ride_start_codes WHERE ride_id=ride_c;
  PERFORM public.rideforge_advance_ride(drv2,ride_c,'driver_arriving');
  UPDATE public.ride_start_codes SET expires_at=now()-interval '1 second' WHERE ride_id=ride_c;
  result := public.rideforge_advance_ride(drv2,ride_c,'in_progress',secret);
  IF NOT coalesce((result->>'otpExpired')::boolean,false)
     OR result->>'status' <> 'driver_arriving'
     OR (SELECT failed_attempts FROM public.ride_start_codes WHERE ride_id=ride_c) <> 0 THEN
    RAISE EXCEPTION 'expired start code was accepted or counted as a wrong attempt: %', result;
  END IF;

  -- --------------------------------------------------------- OTP lockout (ride B)
  UPDATE public.driver_profiles SET is_online=true,last_location_at=now() WHERE account_id=drv2;
  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
    VALUES (ride_b,drv2,'offered',now(),now()+interval '45 seconds');
  PERFORM public.rideforge_accept_offer(drv2,ride_b);
  SELECT code INTO secret FROM public.ride_start_codes WHERE ride_id=ride_b;
  wrong := CASE WHEN secret = '0000' THEN '1111' ELSE '0000' END;
  PERFORM public.rideforge_advance_ride(drv2,ride_b,'driver_arriving');
  FOR i IN 1..5 LOOP
    result := public.rideforge_advance_ride(drv2,ride_b,'in_progress',wrong);
  END LOOP;
  IF (result->>'attemptsRemaining')::int <> 0 THEN
    RAISE EXCEPTION 'fifth wrong code did not exhaust attempts: %', result;
  END IF;
  result := public.rideforge_advance_ride(drv2,ride_b,'in_progress',secret);
  IF NOT coalesce((result->>'otpRejected')::boolean,false)
     OR (SELECT status FROM public.rides WHERE id=ride_b) <> 'driver_arriving' THEN
    RAISE EXCEPTION 'a locked-out ride was started with the correct code: %', result;
  END IF;

  -- ------------------------------------------------------------- saved places
  FOR i IN 1..20 LOOP
    INSERT INTO public.saved_places(account_id,label,address,latitude,longitude)
      VALUES (pax,'Place '||i,'Address number '||i,28.6,77.2);
  END LOOP;
  failed := false;
  BEGIN INSERT INTO public.saved_places(account_id,label,address,latitude,longitude)
    VALUES (pax,'Place 21','Address number 21',28.6,77.2);
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'saved place limit was not enforced'; END IF;
  failed := false;
  BEGIN INSERT INTO public.saved_places(account_id,label,address,latitude,longitude)
    VALUES (outsider,'Home','12 Some Road',28.6,77.2),(outsider,'Home','13 Other Road',28.6,77.2);
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'duplicate saved-place label accepted'; END IF;

  -- ------------------------------------------------ client roles stay locked out
  IF to_regclass('public.ride_start_codes') IS NOT NULL AND (
       has_table_privilege('authenticated','public.ride_start_codes','SELECT') OR
       has_table_privilege('anon','public.ride_start_codes','SELECT') OR
       has_table_privilege('authenticated','public.sos_events','SELECT') OR
       has_table_privilege('authenticated','public.ride_ratings','SELECT') OR
       has_table_privilege('authenticated','public.saved_places','SELECT') OR
       has_function_privilege('authenticated','public.rideforge_advance_ride(uuid,uuid,text,text)','EXECUTE') OR
       has_function_privilege('anon','public.rideforge_raise_sos(uuid,uuid,double precision,double precision,text)','EXECUTE')) THEN
    RAISE EXCEPTION 'browser roles can reach private OTP/rating/SOS objects';
  END IF;
  IF NOT has_function_privilege('service_role','public.rideforge_advance_ride(uuid,uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'service role cannot call the new advance function';
  END IF;
END
$test$;

ROLLBACK;
