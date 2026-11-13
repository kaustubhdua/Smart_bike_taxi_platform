BEGIN;

-- The runtime role is a trusted API identity, not a schema administrator or
-- retention/cleanup worker. No application code deletes rows; audit/event and
-- migration-ledger records are append-only. Remove unused mutation rights.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM rideforge_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.schema_migrations FROM rideforge_app;
REVOKE UPDATE, DELETE ON TABLE public.admin_audit_events FROM rideforge_app;
REVOKE UPDATE, DELETE ON TABLE public.ride_events FROM rideforge_app;
REVOKE UPDATE, DELETE ON TABLE public.driver_ride_declines FROM rideforge_app;

-- Keep future tables from inheriting the broad DELETE grant introduced by the
-- original role bootstrap migrations. Explicit per-table grants can be added
-- later if a reviewed feature genuinely requires deletion.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE DELETE ON TABLES FROM rideforge_app;

INSERT INTO public.schema_migrations (version)
VALUES ('012_runtime_role_least_privilege')
ON CONFLICT (version) DO NOTHING;

COMMIT;
