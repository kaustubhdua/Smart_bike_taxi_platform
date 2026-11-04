-- Keep application data accessible only to the trusted backend PostgreSQL connection.
-- The browser must use the RideForge API; it must never access these tables through PostgREST.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_ride_declines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_offers ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Apply default privilege restrictions to objects created by the current
-- migration owner, whether that owner is postgres (Supabase) or the CI role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

-- The trigger still needs to enqueue events when a backend transaction inserts
-- a ride event. Use a fixed search_path and fully-qualified target table.
CREATE OR REPLACE FUNCTION public.enqueue_ride_event_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.ride_event_outbox (ride_event_id, ride_id)
  VALUES (NEW.id, NEW.ride_id)
  ON CONFLICT (ride_event_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_ride_event_notification() FROM PUBLIC, anon, authenticated;
