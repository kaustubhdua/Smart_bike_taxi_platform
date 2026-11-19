-- Serialize acceptance, decline, expiry and redispatch with one lock order:
-- ride -> driver profile -> offer. Decline and its exclusion record commit atomically.
BEGIN;

CREATE OR REPLACE FUNCTION public.rideforge_accept_offer(p_driver_id uuid,p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  r public.rides%ROWTYPE;
  d public.driver_profiles%ROWTYPE;
  o public.ride_offers%ROWTYPE;
  old_status public.ride_status;
BEGIN
  -- Every ride transition locks the ride first. This matches dispatch/expiry
  -- and cancellation, preventing offer->ride vs ride->offer deadlock cycles.
  SELECT * INTO r
  FROM public.rides
  WHERE id=p_ride_id
  FOR UPDATE;

  IF NOT FOUND OR r.status NOT IN ('requested','matching') OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION 'ride is no longer available' USING ERRCODE='P0001';
  END IF;
  old_status := r.status;

  -- Revalidate and lock the driver so going offline/suspension cannot race
  -- between eligibility validation and assignment.
  SELECT dp.* INTO d
  FROM public.driver_profiles dp
  JOIN public.accounts a ON a.id=dp.account_id
  WHERE dp.account_id=p_driver_id
    AND dp.is_approved
    AND dp.is_online
    AND dp.last_location_at >= now()-interval '2 minutes'
    AND a.role='driver'
    AND a.is_active
  FOR UPDATE OF dp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'driver is offline, no longer approved or location is stale' USING ERRCODE='42501';
  END IF;

  SELECT * INTO o
  FROM public.ride_offers
  WHERE ride_id=p_ride_id AND driver_id=p_driver_id AND status='offered'
  FOR UPDATE;

  IF NOT FOUND OR o.expires_at<=now() THEN
    -- Do not UPDATE then RAISE: the exception would roll that update back.
    -- The next dispatch pass expires stale offers under the same ride-first lock.
    RAISE EXCEPTION 'ride offer expired or unavailable' USING ERRCODE='P0001';
  END IF;

  UPDATE public.rides
  SET driver_id=p_driver_id,status='assigned',assigned_at=now(),updated_at=now()
  WHERE id=p_ride_id AND status IN ('requested','matching') AND driver_id IS NULL
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ride was accepted by another driver' USING ERRCODE='23505';
  END IF;

  UPDATE public.ride_offers SET status='accepted',responded_at=now() WHERE id=o.id;
  UPDATE public.ride_offers SET status='superseded',responded_at=now()
  WHERE ride_id=p_ride_id AND id<>o.id AND status='offered';
  UPDATE public.driver_profiles SET is_online=false WHERE account_id=p_driver_id;

  INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
  VALUES(p_ride_id,p_driver_id,old_status,'assigned','{"source":"driver_accept"}'::jsonb);

  RETURN jsonb_build_object('rideId',r.id,'status',r.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rideforge_decline_offer(p_driver_id uuid,p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  r public.rides%ROWTYPE;
  d public.driver_profiles%ROWTYPE;
  o public.ride_offers%ROWTYPE;
  dispatch_result jsonb;
BEGIN
  SELECT * INTO r
  FROM public.rides
  WHERE id=p_ride_id
  FOR UPDATE;

  IF NOT FOUND OR r.status NOT IN ('requested','matching') OR r.driver_id IS NOT NULL THEN
    RAISE EXCEPTION 'ride is no longer available' USING ERRCODE='P0001';
  END IF;

  SELECT dp.* INTO d
  FROM public.driver_profiles dp
  JOIN public.accounts a ON a.id=dp.account_id
  WHERE dp.account_id=p_driver_id
    AND a.role='driver'
    AND a.is_active
  FOR UPDATE OF dp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active driver account required' USING ERRCODE='42501';
  END IF;

  SELECT * INTO o
  FROM public.ride_offers
  WHERE ride_id=p_ride_id AND driver_id=p_driver_id AND status='offered'
  FOR UPDATE;

  IF NOT FOUND OR o.expires_at<=now() THEN
    RAISE EXCEPTION 'ride offer expired or unavailable' USING ERRCODE='P0001';
  END IF;

  UPDATE public.ride_offers
  SET status='declined',responded_at=now()
  WHERE id=o.id;

  INSERT INTO public.driver_ride_declines(ride_id,driver_id)
  VALUES(p_ride_id,p_driver_id)
  ON CONFLICT(ride_id,driver_id) DO NOTHING;

  -- Try the next eligible driver before releasing the ride lock. The declined
  -- driver is excluded by driver_ride_declines; all writes remain one commit.
  dispatch_result := public.rideforge_dispatch_ride(p_ride_id);

  RETURN jsonb_build_object(
    'rideId',p_ride_id,
    'status','declined',
    'dispatch',dispatch_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rideforge_accept_offer(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rideforge_decline_offer(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_accept_offer(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rideforge_decline_offer(uuid,uuid) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('025_atomic_driver_offer_transitions')
ON CONFLICT(version) DO NOTHING;

COMMIT;
