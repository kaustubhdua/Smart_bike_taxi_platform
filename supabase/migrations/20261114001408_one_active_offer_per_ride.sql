-- Enforce one active offer per ride; retries only advance after decline/expiry.
BEGIN;

CREATE OR REPLACE FUNCTION public.rideforge_dispatch_ride(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  r public.rides%ROWTYPE;
  d public.driver_profiles%ROWTYPE;
  active_offer public.ride_offers%ROWTYPE;
  offer_id bigint;
  attempts integer;
  old_status public.ride_status;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id=p_ride_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('requested','matching') OR r.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('offered',false,'reason','ride_not_dispatchable');
  END IF;
  old_status := r.status;

  UPDATE public.ride_offers SET status='expired',responded_at=now()
    WHERE ride_id=r.id AND status='offered' AND expires_at<=now();

  SELECT * INTO active_offer FROM public.ride_offers
    WHERE ride_id=r.id AND status='offered' AND expires_at>now()
    ORDER BY offered_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'offered',false,'reason','offer_pending',
      'offerId',active_offer.id,'expiresAt',active_offer.expires_at
    );
  END IF;

  SELECT count(*) INTO attempts FROM public.ride_offers WHERE ride_id=r.id;
  IF attempts >= 5 THEN
    UPDATE public.rides SET status='failed',updated_at=now() WHERE id=r.id;
    INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
      VALUES(r.id,NULL,old_status,'failed','{"source":"dispatch","reason":"offer_attempts_exhausted"}'::jsonb);
    RETURN jsonb_build_object('offered',false,'reason','attempts_exhausted');
  END IF;

  SELECT dp.* INTO d
  FROM public.driver_profiles dp
  JOIN public.accounts a ON a.id=dp.account_id AND a.is_active
  WHERE dp.is_approved AND dp.is_online
    AND dp.last_location_at >= now()-interval '2 minutes'
    AND dp.current_latitude IS NOT NULL AND dp.current_longitude IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.ride_offers ro WHERE ro.driver_id=dp.account_id AND ro.status='offered' AND ro.expires_at>now())
    AND NOT EXISTS (SELECT 1 FROM public.rides ar WHERE ar.driver_id=dp.account_id AND ar.status IN ('assigned','driver_arriving','in_progress'))
    AND NOT EXISTS (SELECT 1 FROM public.driver_ride_declines dd WHERE dd.ride_id=r.id AND dd.driver_id=dp.account_id)
    AND NOT EXISTS (SELECT 1 FROM public.ride_offers prior WHERE prior.ride_id=r.id AND prior.driver_id=dp.account_id)
    AND 6371000 * 2 * asin(sqrt(
      power(sin(radians(dp.current_latitude-r.pickup_latitude)/2),2) +
      cos(radians(r.pickup_latitude))*cos(radians(dp.current_latitude))*
      power(sin(radians(dp.current_longitude-r.pickup_longitude)/2),2)
    )) <= 20000
  ORDER BY
    6371000 * 2 * asin(sqrt(
      power(sin(radians(dp.current_latitude-r.pickup_latitude)/2),2) +
      cos(radians(r.pickup_latitude))*cos(radians(dp.current_latitude))*
      power(sin(radians(dp.current_longitude-r.pickup_longitude)/2),2)
    )), dp.account_id
  LIMIT 1 FOR UPDATE OF dp SKIP LOCKED;

  IF NOT FOUND THEN
    IF old_status='requested' THEN
      UPDATE public.rides SET status='matching',updated_at=now() WHERE id=r.id;
      INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
        VALUES(r.id,NULL,'requested','matching','{"source":"dispatch","reason":"waiting_for_driver"}'::jsonb);
    END IF;
    RETURN jsonb_build_object('offered',false,'reason','no_eligible_driver');
  END IF;

  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
    VALUES(r.id,d.account_id,'offered',now(),now()+interval '45 seconds')
    RETURNING id INTO offer_id;
  IF old_status='requested' THEN
    UPDATE public.rides SET status='matching',updated_at=now() WHERE id=r.id;
    INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
      VALUES(r.id,NULL,'requested','matching','{"source":"dispatch","reason":"driver_offer_created"}'::jsonb);
  END IF;
  RETURN jsonb_build_object('offered',true,'offerId',offer_id,'driverId',d.account_id,'expiresAt',now()+interval '45 seconds');
END;
$function$;

REVOKE ALL ON FUNCTION public.rideforge_dispatch_ride(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_dispatch_ride(uuid) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('023_one_active_offer_per_ride')
ON CONFLICT(version) DO NOTHING;
COMMIT;
