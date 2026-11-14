-- Retire the C++ worker's notification outbox; Supabase Realtime and the
-- authenticated SSE compatibility route read durable ride_events directly.
BEGIN;
DROP TRIGGER IF EXISTS ride_event_notification_outbox ON public.ride_events;
INSERT INTO public.schema_migrations(version)
VALUES ('024_retire_legacy_outbox_trigger')
ON CONFLICT(version) DO NOTHING;
COMMIT;
