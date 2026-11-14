-- Revalidate driver approval and freshness at offer acceptance, not only offer creation.
BEGIN;

CREATE OR REPLACE FUNCTION public.rideforge_accept_offer(p_driver_id uuid,p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE o public.ride_offers%ROWTYPE; r public.rides%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    JOIN public.accounts a ON a.id=dp.account_id
    WHERE dp.account_id=p_driver_id AND dp.is_approved
      AND dp.last_location_at >= now()-interval '2 minutes'
      AND a.role='driver' AND a.is_active
  ) THEN
    RAISE EXCEPTION 'driver is no longer approved or location is stale' USING ERRCODE='42501';
  END IF;

  SELECT * INTO o FROM public.ride_offers
    WHERE ride_id=p_ride_id AND driver_id=p_driver_id AND status='offered'
    FOR UPDATE;
  IF NOT FOUND OR o.expires_at<=now() THEN
    IF FOUND THEN UPDATE public.ride_offers SET status='expired',responded_at=now() WHERE id=o.id; END IF;
    RAISE EXCEPTION 'ride offer expired or unavailable' USING ERRCODE='P0001';
  END IF;
  UPDATE public.rides SET driver_id=p_driver_id,status='assigned',assigned_at=now(),updated_at=now()
    WHERE id=p_ride_id AND status IN ('requested','matching') AND driver_id IS NULL
    RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'ride was accepted by another driver' USING ERRCODE='23505'; END IF;
  UPDATE public.ride_offers SET status='accepted',responded_at=now() WHERE id=o.id;
  UPDATE public.ride_offers SET status='superseded',responded_at=now()
    WHERE ride_id=p_ride_id AND id<>o.id AND status='offered';
  UPDATE public.driver_profiles SET is_online=false WHERE account_id=p_driver_id;
  INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
    VALUES(p_ride_id,p_driver_id,'matching','assigned','{"source":"driver_accept"}'::jsonb);
  RETURN jsonb_build_object('rideId',r.id,'status',r.status);
END;
$function$;

REVOKE ALL ON FUNCTION public.rideforge_accept_offer(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_accept_offer(uuid,uuid) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('020_revalidate_driver_at_acceptance')
ON CONFLICT(version) DO NOTHING;
COMMIT;
