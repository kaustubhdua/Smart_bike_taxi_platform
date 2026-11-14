-- Avoid per-row re-evaluation of auth.uid() in participant RLS policies.
BEGIN;

DROP POLICY IF EXISTS rideforge_accounts_self_read ON public.accounts;
CREATE POLICY rideforge_accounts_self_read ON public.accounts
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS rideforge_rides_participant_read ON public.rides;
CREATE POLICY rideforge_rides_participant_read ON public.rides
  FOR SELECT TO authenticated USING (
    passenger_id = (SELECT auth.uid()) OR driver_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS rideforge_events_participant_read ON public.ride_events;
CREATE POLICY rideforge_events_participant_read ON public.ride_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_events.ride_id
        AND (r.passenger_id = (SELECT auth.uid()) OR r.driver_id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS rideforge_driver_profile_self_read ON public.driver_profiles;
CREATE POLICY rideforge_driver_profile_self_read ON public.driver_profiles
  FOR SELECT TO authenticated USING (account_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS rideforge_support_reporter_read ON public.support_reports;
CREATE POLICY rideforge_support_reporter_read ON public.support_reports
  FOR SELECT TO authenticated USING (reporter_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS rideforge_offer_driver_read ON public.ride_offers;
CREATE POLICY rideforge_offer_driver_read ON public.ride_offers
  FOR SELECT TO authenticated USING (driver_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS rideforge_decline_driver_read ON public.driver_ride_declines;
CREATE POLICY rideforge_decline_driver_read ON public.driver_ride_declines
  FOR SELECT TO authenticated USING (driver_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS rideforge_admin_audit_read ON public.admin_audit_events;
CREATE POLICY rideforge_admin_audit_read ON public.admin_audit_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = (SELECT auth.uid()) AND a.role = 'admin' AND a.is_active)
  );

INSERT INTO public.schema_migrations(version)
VALUES ('022_optimize_auth_rls_initplans')
ON CONFLICT(version) DO NOTHING;
COMMIT;
