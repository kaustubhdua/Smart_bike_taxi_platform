-- Cover foreign-key lookups used by admin history, idempotency cleanup,
-- dispatch/outbox history, and support-report triage.
CREATE INDEX IF NOT EXISTS admin_audit_events_actor_id_idx
  ON public.admin_audit_events (actor_id);
CREATE INDEX IF NOT EXISTS booking_idempotency_ride_id_idx
  ON public.booking_idempotency (ride_id)
  WHERE ride_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_profiles_approved_by_idx
  ON public.driver_profiles (approved_by)
  WHERE approved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ride_event_outbox_ride_id_idx
  ON public.ride_event_outbox (ride_id);
CREATE INDEX IF NOT EXISTS ride_events_actor_id_idx
  ON public.ride_events (actor_id)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_reports_resolved_by_idx
  ON public.support_reports (resolved_by)
  WHERE resolved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_reports_ride_id_idx
  ON public.support_reports (ride_id)
  WHERE ride_id IS NOT NULL;
