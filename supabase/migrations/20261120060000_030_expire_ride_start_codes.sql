BEGIN;

ALTER TABLE public.ride_start_codes
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.ride_start_codes
SET expires_at = now() + interval '60 minutes'
WHERE expires_at IS NULL;

ALTER TABLE public.ride_start_codes
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 minutes'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.rideforge_issue_start_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.ride_start_codes(ride_id, code, expires_at)
  VALUES (
    NEW.id,
    lpad((('x' || substr(gen_random_uuid()::text, 1, 8))::bit(32)::bigint % 10000)::text, 4, '0'),
    now() + interval '60 minutes'
  )
  ON CONFLICT (ride_id) DO UPDATE
    SET code = EXCLUDED.code,
        failed_attempts = 0,
        created_at = now(),
        expires_at = now() + interval '60 minutes';
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.rideforge_issue_start_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rideforge_advance_ride(
  p_driver_id uuid, p_ride_id uuid, p_status text, p_otp text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  r public.rides%ROWTYPE;
  next_status public.ride_status;
  sc public.ride_start_codes%ROWTYPE;
BEGIN
  IF p_status NOT IN ('driver_arriving', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'invalid ride transition' USING ERRCODE = '22023';
  END IF;
  next_status := p_status::public.ride_status;

  IF next_status = 'in_progress' THEN
    SELECT * INTO r FROM public.rides
      WHERE id = p_ride_id AND driver_id = p_driver_id AND status = 'driver_arriving'
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ride transition is not allowed' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO sc FROM public.ride_start_codes WHERE ride_id = p_ride_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ride transition is not allowed' USING ERRCODE = 'P0001';
    END IF;
    IF sc.expires_at <= now() THEN
      RETURN jsonb_build_object('rideId', r.id, 'status', r.status,
                                'otpExpired', true, 'attemptsRemaining', 0);
    END IF;
    IF sc.failed_attempts >= 5 THEN
      RETURN jsonb_build_object('rideId', r.id, 'status', r.status,
                                'otpRejected', true, 'attemptsRemaining', 0);
    END IF;
    IF p_otp IS NULL OR p_otp <> sc.code THEN
      UPDATE public.ride_start_codes SET failed_attempts = failed_attempts + 1
        WHERE ride_id = p_ride_id;
      RETURN jsonb_build_object('rideId', r.id, 'status', r.status,
                                'otpRejected', true,
                                'attemptsRemaining', 4 - sc.failed_attempts);
    END IF;
  END IF;

  UPDATE public.rides
    SET status = next_status,
        started_at = CASE WHEN next_status = 'in_progress' THEN now() ELSE started_at END,
        completed_at = CASE WHEN next_status = 'completed' THEN now() ELSE completed_at END,
        final_fare_paise = CASE WHEN next_status = 'completed' THEN quoted_fare_paise ELSE final_fare_paise END,
        updated_at = now()
    WHERE id = p_ride_id AND driver_id = p_driver_id
      AND ((status = 'assigned' AND next_status = 'driver_arriving') OR
           (status = 'driver_arriving' AND next_status = 'in_progress') OR
           (status = 'in_progress' AND next_status = 'completed'))
    RETURNING * INTO r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ride transition is not allowed' USING ERRCODE = 'P0001';
  END IF;
  IF next_status = 'completed' THEN
    UPDATE public.driver_profiles SET is_online = false WHERE account_id = p_driver_id;
  END IF;
  INSERT INTO public.ride_events(ride_id, actor_id, previous_status, new_status, details)
    VALUES (r.id, p_driver_id,
      CASE next_status WHEN 'driver_arriving' THEN 'assigned'::public.ride_status
                       WHEN 'in_progress' THEN 'driver_arriving'::public.ride_status
                       ELSE 'in_progress'::public.ride_status END,
      next_status,
      CASE WHEN next_status = 'in_progress'
           THEN '{"source":"driver_status","otp_verified":true}'::jsonb
           ELSE '{"source":"driver_status"}'::jsonb END);
  RETURN jsonb_build_object('rideId', r.id, 'status', r.status);
END;
$function$;
REVOKE ALL ON FUNCTION public.rideforge_advance_ride(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_advance_ride(uuid, uuid, text, text) TO service_role;

COMMIT;
