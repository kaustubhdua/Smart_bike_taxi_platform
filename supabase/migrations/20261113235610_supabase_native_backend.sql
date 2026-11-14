-- Supabase-native RideForge backend.
-- Authentication is Supabase Auth; the account UUID is the auth.users UUID.
-- The Edge Function uses service_role only after validating the caller's JWT.
BEGIN;

ALTER TABLE public.accounts
  ALTER COLUMN password_hash SET DEFAULT 'supabase-auth-managed';

CREATE OR REPLACE FUNCTION public.rideforge_sync_auth_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.accounts (id, email, display_name, password_hash, role, is_active)
  VALUES (
    NEW.id,
    lower(trim(NEW.email)),
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), ''), split_part(lower(NEW.email), '@', 1)),
    'supabase-auth-managed',
    'passenger',
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = CASE
          WHEN public.accounts.display_name = '' THEN EXCLUDED.display_name
          ELSE public.accounts.display_name
        END,
        updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rideforge_auth_user_created ON auth.users;
CREATE TRIGGER rideforge_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.rideforge_sync_auth_account();

REVOKE ALL ON FUNCTION public.rideforge_sync_auth_account() FROM PUBLIC, anon, authenticated, service_role;

-- Minimal authenticated reads required by Supabase Realtime. All mutations and
-- privileged queries continue through the authenticated Edge Function.
DROP POLICY IF EXISTS rideforge_accounts_self_read ON public.accounts;
CREATE POLICY rideforge_accounts_self_read ON public.accounts
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS rideforge_rides_participant_read ON public.rides;
CREATE POLICY rideforge_rides_participant_read ON public.rides
  FOR SELECT TO authenticated USING (passenger_id = auth.uid() OR driver_id = auth.uid());

DROP POLICY IF EXISTS rideforge_events_participant_read ON public.ride_events;
CREATE POLICY rideforge_events_participant_read ON public.ride_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_events.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS rideforge_driver_profile_self_read ON public.driver_profiles;
CREATE POLICY rideforge_driver_profile_self_read ON public.driver_profiles
  FOR SELECT TO authenticated USING (account_id = auth.uid());

DROP POLICY IF EXISTS rideforge_support_reporter_read ON public.support_reports;
CREATE POLICY rideforge_support_reporter_read ON public.support_reports
  FOR SELECT TO authenticated USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS rideforge_offer_driver_read ON public.ride_offers;
CREATE POLICY rideforge_offer_driver_read ON public.ride_offers
  FOR SELECT TO authenticated USING (driver_id = auth.uid());

DROP POLICY IF EXISTS rideforge_decline_driver_read ON public.driver_ride_declines;
CREATE POLICY rideforge_decline_driver_read ON public.driver_ride_declines
  FOR SELECT TO authenticated USING (driver_id = auth.uid());

DROP POLICY IF EXISTS rideforge_admin_audit_read ON public.admin_audit_events;
CREATE POLICY rideforge_admin_audit_read ON public.admin_audit_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = auth.uid() AND a.role = 'admin' AND a.is_active)
  );

-- Explicit deny policies document the intentional absence of browser access
-- to internal tables and silence the no-policy security lint without granting
-- browser table privileges.
DROP POLICY IF EXISTS rideforge_schema_migrations_deny ON public.schema_migrations;
CREATE POLICY rideforge_schema_migrations_deny ON public.schema_migrations FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rideforge_quotes_deny ON public.route_quotes;
CREATE POLICY rideforge_quotes_deny ON public.route_quotes FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rideforge_idempotency_deny ON public.booking_idempotency;
CREATE POLICY rideforge_idempotency_deny ON public.booking_idempotency FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS rideforge_outbox_deny ON public.ride_event_outbox;
CREATE POLICY rideforge_outbox_deny ON public.ride_event_outbox FOR ALL TO authenticated USING (false) WITH CHECK (false);

GRANT SELECT ON public.rides, public.ride_events TO authenticated;
GRANT SELECT ON public.accounts, public.driver_profiles, public.support_reports,
  public.ride_offers, public.driver_ride_declines, public.admin_audit_events TO authenticated;

CREATE OR REPLACE FUNCTION public.rideforge_create_booking(
  p_passenger_id uuid,
  p_quote_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  q public.route_quotes%ROWTYPE;
  existing public.booking_idempotency%ROWTYPE;
  new_ride public.rides%ROWTYPE;
  inserted integer;
BEGIN
  IF p_passenger_id IS NULL OR p_quote_id IS NULL OR
     p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'invalid booking request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id=p_passenger_id AND a.role='passenger' AND a.is_active) THEN
    RAISE EXCEPTION 'passenger account unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.booking_idempotency(passenger_id,idempotency_key,request_fingerprint)
  VALUES (p_passenger_id,p_idempotency_key,p_quote_id::text)
  ON CONFLICT (passenger_id,idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  SELECT * INTO existing FROM public.booking_idempotency
    WHERE passenger_id=p_passenger_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF existing.request_fingerprint <> p_quote_id::text THEN
    RAISE EXCEPTION 'idempotency key reused with a different quote' USING ERRCODE = '23505';
  END IF;
  IF existing.ride_id IS NOT NULL THEN
    SELECT * INTO new_ride FROM public.rides WHERE id=existing.ride_id;
    RETURN jsonb_build_object('rideId',new_ride.id,'status',new_ride.status,'replayed',true);
  END IF;

  SELECT * INTO q FROM public.route_quotes WHERE id=p_quote_id FOR UPDATE;
  IF NOT FOUND OR q.expires_at <= now() OR q.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'quote unavailable or expired' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.rides(
    passenger_id,status,pickup_label,pickup_latitude,pickup_longitude,
    destination_label,destination_latitude,destination_longitude,
    route_distance_m,quoted_fare_paise,currency,idempotency_key
  ) VALUES (
    p_passenger_id,'requested',q.pickup_label,q.pickup_latitude,q.pickup_longitude,
    q.destination_label,q.destination_latitude,q.destination_longitude,
    q.route_distance_m,q.fare_paise,'INR',p_idempotency_key
  ) RETURNING * INTO new_ride;

  UPDATE public.route_quotes SET consumed_at=now() WHERE id=q.id;
  UPDATE public.booking_idempotency SET ride_id=new_ride.id
    WHERE passenger_id=p_passenger_id AND idempotency_key=p_idempotency_key;
  INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
    VALUES(new_ride.id,p_passenger_id,NULL,'requested','{"source":"supabase-edge"}'::jsonb);
  RETURN jsonb_build_object('rideId',new_ride.id,'status',new_ride.status,'replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rideforge_update_driver_availability(
  p_driver_id uuid,
  p_online boolean,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE updated public.driver_profiles%ROWTYPE;
BEGIN
  IF p_online AND (p_latitude IS NULL OR p_longitude IS NULL OR
      p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'valid coordinates are required to go online' USING ERRCODE='22023';
  END IF;
  UPDATE public.driver_profiles dp
    SET is_online=p_online,
        current_latitude=CASE WHEN p_online THEN p_latitude ELSE dp.current_latitude END,
        current_longitude=CASE WHEN p_online THEN p_longitude ELSE dp.current_longitude END,
        last_location_at=CASE WHEN p_online THEN now() ELSE dp.last_location_at END
    WHERE dp.account_id=p_driver_id AND dp.is_approved=true
      AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id=p_driver_id AND a.role='driver' AND a.is_active)
    RETURNING * INTO updated;
  IF NOT FOUND THEN RAISE EXCEPTION 'approved driver profile required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('online',updated.is_online);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rideforge_dispatch_ride(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  r public.rides%ROWTYPE;
  d public.driver_profiles%ROWTYPE;
  offer_id bigint;
BEGIN
  SELECT * INTO r FROM public.rides WHERE id=p_ride_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('requested','matching') OR r.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('offered',false,'reason','ride_not_dispatchable');
  END IF;
  UPDATE public.ride_offers SET status='expired',responded_at=now()
    WHERE ride_id=r.id AND status='offered' AND expires_at<=now();

  SELECT dp.* INTO d
  FROM public.driver_profiles dp
  JOIN public.accounts a ON a.id=dp.account_id AND a.is_active
  WHERE dp.is_approved AND dp.is_online
    AND dp.last_location_at >= now()-interval '2 minutes'
    AND dp.current_latitude IS NOT NULL AND dp.current_longitude IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.ride_offers ro WHERE ro.driver_id=dp.account_id AND ro.status='offered' AND ro.expires_at>now())
    AND NOT EXISTS (SELECT 1 FROM public.rides ar WHERE ar.driver_id=dp.account_id AND ar.status IN ('assigned','driver_arriving','in_progress'))
    AND NOT EXISTS (SELECT 1 FROM public.driver_ride_declines dd WHERE dd.ride_id=r.id AND dd.driver_id=dp.account_id)
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
    UPDATE public.rides SET status='matching',updated_at=now() WHERE id=r.id AND status='requested';
    RETURN jsonb_build_object('offered',false,'reason','no_eligible_driver');
  END IF;

  INSERT INTO public.ride_offers(ride_id,driver_id,status,offered_at,expires_at)
    VALUES(r.id,d.account_id,'offered',now(),now()+interval '45 seconds')
    RETURNING id INTO offer_id;
  UPDATE public.rides SET status='matching',updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('offered',true,'offerId',offer_id,'driverId',d.account_id,'expiresAt',now()+interval '45 seconds');
END;
$function$;

CREATE OR REPLACE FUNCTION public.rideforge_accept_offer(p_driver_id uuid,p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE o public.ride_offers%ROWTYPE; r public.rides%ROWTYPE;
BEGIN
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

CREATE OR REPLACE FUNCTION public.rideforge_advance_ride(p_driver_id uuid,p_ride_id uuid,p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE r public.rides%ROWTYPE; next_status public.ride_status;
BEGIN
  IF p_status NOT IN ('driver_arriving','in_progress','completed') THEN
    RAISE EXCEPTION 'invalid ride transition' USING ERRCODE='22023';
  END IF;
  next_status := p_status::public.ride_status;
  UPDATE public.rides
    SET status=next_status,
        started_at=CASE WHEN next_status='in_progress' THEN now() ELSE started_at END,
        completed_at=CASE WHEN next_status='completed' THEN now() ELSE completed_at END,
        final_fare_paise=CASE WHEN next_status='completed' THEN quoted_fare_paise ELSE final_fare_paise END,
        updated_at=now()
    WHERE id=p_ride_id AND driver_id=p_driver_id
      AND ((status='assigned' AND next_status='driver_arriving') OR
           (status='driver_arriving' AND next_status='in_progress') OR
           (status='in_progress' AND next_status='completed'))
    RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'ride transition is not allowed' USING ERRCODE='P0001'; END IF;
  IF next_status='completed' THEN
    UPDATE public.driver_profiles SET is_online=false WHERE account_id=p_driver_id;
  END IF;
  INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
    VALUES(r.id,p_driver_id,
      CASE next_status WHEN 'driver_arriving' THEN 'assigned'::public.ride_status
                       WHEN 'in_progress' THEN 'driver_arriving'::public.ride_status
                       ELSE 'in_progress'::public.ride_status END,
      next_status,'{"source":"driver_status"}'::jsonb);
  RETURN jsonb_build_object('rideId',r.id,'status',r.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rideforge_cancel_ride(p_passenger_id uuid,p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE r public.rides%ROWTYPE;
BEGIN
  UPDATE public.rides SET status='cancelled',cancelled_at=now(),updated_at=now()
    WHERE id=p_ride_id AND passenger_id=p_passenger_id
      AND status IN ('requested','matching','assigned')
    RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'ride cannot be cancelled' USING ERRCODE='P0001'; END IF;
  UPDATE public.ride_offers SET status='superseded',responded_at=now()
    WHERE ride_id=p_ride_id AND status='offered';
  INSERT INTO public.ride_events(ride_id,actor_id,previous_status,new_status,details)
    VALUES(r.id,p_passenger_id,
      CASE WHEN r.driver_id IS NULL THEN 'matching'::public.ride_status ELSE 'assigned'::public.ride_status END,
      'cancelled','{"source":"passenger_cancel"}'::jsonb);
  RETURN jsonb_build_object('rideId',r.id,'status',r.status);
END;
$function$;

REVOKE ALL ON FUNCTION public.rideforge_create_booking(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rideforge_update_driver_availability(uuid,boolean,double precision,double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rideforge_dispatch_ride(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rideforge_accept_offer(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rideforge_advance_ride(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rideforge_cancel_ride(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_create_booking(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rideforge_update_driver_availability(uuid,boolean,double precision,double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.rideforge_dispatch_ride(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rideforge_accept_offer(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rideforge_advance_ride(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rideforge_cancel_ride(uuid,uuid) TO service_role;

-- Supabase Realtime is used only for participant-visible ride state.
DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='rides') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ride_events') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_events;
    END IF;
  END IF;
END
$publication$;

INSERT INTO public.schema_migrations(version)
VALUES ('016_supabase_native_backend')
ON CONFLICT(version) DO NOTHING;

COMMIT;
