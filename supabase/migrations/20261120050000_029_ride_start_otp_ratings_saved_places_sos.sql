-- Ride-start OTP, two-way ratings, saved places and SOS events.
-- All new tables are private: RLS is enabled with deny-all policies and client roles have no
-- grants. Only the Edge API (service role) reaches them, through SECURITY DEFINER functions.
BEGIN;

-- ---------------------------------------------------------------- start OTP
CREATE TABLE IF NOT EXISTS public.ride_start_codes (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ride_start_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rideforge_start_codes_deny ON public.ride_start_codes;
CREATE POLICY rideforge_start_codes_deny ON public.ride_start_codes
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.ride_start_codes FROM PUBLIC, anon, authenticated;

-- A code is issued each time a ride becomes assigned. gen_random_uuid() draws from the
-- server's strong random source, unlike random().
CREATE OR REPLACE FUNCTION public.rideforge_issue_start_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.ride_start_codes(ride_id, code)
  VALUES (NEW.id,
          lpad((('x' || substr(gen_random_uuid()::text, 1, 8))::bit(32)::bigint % 10000)::text, 4, '0'))
  ON CONFLICT (ride_id) DO UPDATE
    SET code = EXCLUDED.code, failed_attempts = 0, created_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.rideforge_issue_start_code() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rideforge_issue_start_code ON public.rides;
CREATE TRIGGER rideforge_issue_start_code
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW
  WHEN (NEW.status = 'assigned' AND OLD.status IS DISTINCT FROM 'assigned')
  EXECUTE FUNCTION public.rideforge_issue_start_code();

-- Rides already assigned or arriving when this migration runs get a code too.
INSERT INTO public.ride_start_codes(ride_id, code)
SELECT id, lpad((('x' || substr(gen_random_uuid()::text, 1, 8))::bit(32)::bigint % 10000)::text, 4, '0')
FROM public.rides WHERE status IN ('assigned', 'driver_arriving')
ON CONFLICT (ride_id) DO NOTHING;

-- The three-argument form is replaced: starting a ride now needs the passenger's code.
-- A wrong code is counted and returned as a result (not raised) so the counter survives.
DROP FUNCTION IF EXISTS public.rideforge_advance_ride(uuid, uuid, text);
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

-- ------------------------------------------------------------------ ratings
CREATE TABLE IF NOT EXISTS public.ride_ratings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  rater_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ratee_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, rater_id),
  CHECK (rater_id <> ratee_id)
);
CREATE INDEX IF NOT EXISTS ride_ratings_ratee_idx ON public.ride_ratings(ratee_id);
CREATE INDEX IF NOT EXISTS ride_ratings_rater_idx ON public.ride_ratings(rater_id);
ALTER TABLE public.ride_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rideforge_ratings_deny ON public.ride_ratings;
CREATE POLICY rideforge_ratings_deny ON public.ride_ratings
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.ride_ratings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rideforge_rate_ride(
  p_rater_id uuid, p_ride_id uuid, p_stars integer, p_comment text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE r public.rides%ROWTYPE; ratee uuid; note text;
BEGIN
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'stars must be 1 to 5' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND OR r.status <> 'completed' OR r.driver_id IS NULL
     OR p_rater_id NOT IN (r.passenger_id, r.driver_id) THEN
    RAISE EXCEPTION 'ride cannot be rated' USING ERRCODE = 'P0001';
  END IF;
  ratee := CASE WHEN p_rater_id = r.passenger_id THEN r.driver_id ELSE r.passenger_id END;
  note := left(nullif(trim(coalesce(p_comment, '')), ''), 500);
  INSERT INTO public.ride_ratings(ride_id, rater_id, ratee_id, stars, comment)
    VALUES (p_ride_id, p_rater_id, ratee, p_stars, note);
  RETURN jsonb_build_object('rideId', p_ride_id, 'stars', p_stars);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rideforge_rating_summary(p_account_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'count', count(*),
    'average', CASE WHEN count(*) = 0 THEN NULL ELSE round(avg(stars)::numeric, 2) END)
  FROM public.ride_ratings WHERE ratee_id = p_account_id;
$function$;
REVOKE ALL ON FUNCTION public.rideforge_rate_ride(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rideforge_rating_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_rate_ride(uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rideforge_rating_summary(uuid) TO service_role;

-- ------------------------------------------------------------- saved places
CREATE TABLE IF NOT EXISTS public.saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  address text NOT NULL CHECK (length(trim(address)) BETWEEN 3 AND 240),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, label)
);
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rideforge_saved_places_deny ON public.saved_places;
CREATE POLICY rideforge_saved_places_deny ON public.saved_places
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.saved_places FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rideforge_limit_saved_places()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('saved_places:' || NEW.account_id::text, 0));
  IF (SELECT count(*) FROM public.saved_places WHERE account_id = NEW.account_id) >= 20 THEN
    RAISE EXCEPTION 'saved place limit reached' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.rideforge_limit_saved_places() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rideforge_limit_saved_places ON public.saved_places;
CREATE TRIGGER rideforge_limit_saved_places
  BEFORE INSERT ON public.saved_places
  FOR EACH ROW EXECUTE FUNCTION public.rideforge_limit_saved_places();

-- ---------------------------------------------------------------------- SOS
CREATE TABLE IF NOT EXISTS public.sos_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  handled_by uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX IF NOT EXISTS sos_events_open_idx ON public.sos_events(created_at DESC) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS sos_events_ride_idx ON public.sos_events(ride_id);
CREATE INDEX IF NOT EXISTS sos_events_account_idx ON public.sos_events(account_id);
CREATE INDEX IF NOT EXISTS sos_events_handled_by_idx ON public.sos_events(handled_by);
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rideforge_sos_deny ON public.sos_events;
CREATE POLICY rideforge_sos_deny ON public.sos_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.sos_events FROM PUBLIC, anon, authenticated;

-- A repeat press by the same person on the same ride within five minutes returns the
-- existing unresolved alert instead of creating a flood.
CREATE OR REPLACE FUNCTION public.rideforge_raise_sos(
  p_account_id uuid, p_ride_id uuid,
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL,
  p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE r public.rides%ROWTYPE; existing public.sos_events%ROWTYPE; created public.sos_events%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND OR p_account_id NOT IN (r.passenger_id, coalesce(r.driver_id, r.passenger_id))
     OR r.status NOT IN ('assigned', 'driver_arriving', 'in_progress') THEN
    RAISE EXCEPTION 'sos not available for this ride' USING ERRCODE = 'P0001';
  END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'latitude and longitude must be given together' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO existing FROM public.sos_events
    WHERE ride_id = p_ride_id AND account_id = p_account_id AND status <> 'resolved'
      AND created_at > now() - interval '5 minutes'
    ORDER BY id DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', existing.id::text, 'status', existing.status, 'duplicate', true);
  END IF;
  INSERT INTO public.sos_events(ride_id, account_id, latitude, longitude, note)
    VALUES (p_ride_id, p_account_id, p_latitude, p_longitude,
            left(nullif(trim(coalesce(p_note, '')), ''), 500))
    RETURNING * INTO created;
  RETURN jsonb_build_object('id', created.id::text, 'status', created.status, 'duplicate', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.rideforge_raise_sos(uuid, uuid, double precision, double precision, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_raise_sos(uuid, uuid, double precision, double precision, text) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('029_ride_start_otp_ratings_saved_places_sos')
ON CONFLICT(version) DO NOTHING;

COMMIT;
