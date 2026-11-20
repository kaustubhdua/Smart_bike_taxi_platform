-- Driver-initiated cancellation for rides already assigned to a driver.
-- The ride row is locked first to preserve the dispatch/offer lock order.
BEGIN;

CREATE OR REPLACE FUNCTION public.rideforge_driver_cancel_ride(p_driver_id uuid,p_ride_id uuid,p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r public.rides%ROWTYPE;
  previous public.ride_status;
  reason_text text;
BEGIN
  SELECT * INTO r
  FROM public.rides
  WHERE id=p_ride_id
  FOR UPDATE;

  IF NOT FOUND OR r.driver_id IS DISTINCT FROM p_driver_id
     OR r.status NOT IN ('assigned','driver_arriving') THEN
    RAISE EXCEPTION 'ride cannot be cancelled by this driver' USING ERRCODE='P0001';
  END IF;

  previous := r.status;
  reason_text := left(nullif(trim(coalesce(p_reason,'')),''),240);

  UPDATE public.rides
  SET status='cancelled', cancelled_at=now(), updated_at=now()
  WHERE id=p_ride_id
  RETURNING * INTO r;

  UPDATE public.ride_offers
  SET status='superseded', responded_at=now()
  WHERE ride_id=p_ride_id AND status IN ('offered','accepted');

  INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
  VALUES(
    p_ride_id,p_driver_id,previous,'cancelled',
    jsonb_build_object('source','driver_cancel') ||
      CASE WHEN reason_text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reason',reason_text) END
  );

  RETURN jsonb_build_object('rideId',r.id,'status',r.status);
END;
$function$;

REVOKE ALL ON FUNCTION public.rideforge_driver_cancel_ride(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_driver_cancel_ride(uuid,uuid,text) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('026_driver_cancellation')
ON CONFLICT(version) DO NOTHING;

COMMIT;
