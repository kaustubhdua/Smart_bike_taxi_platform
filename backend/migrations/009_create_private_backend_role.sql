BEGIN;
-- The API authenticates users and enforces ownership/roles itself. It is the
-- only trusted application client allowed to bypass table RLS. Keep it
-- non-superuser and do not grant TRUNCATE, CREATE, or role-management rights.
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rideforge_app') THEN
    CREATE ROLE rideforge_app LOGIN BYPASSRLS;
  END IF;
END
$block$;

GRANT CONNECT ON DATABASE postgres TO rideforge_app;
GRANT USAGE ON SCHEMA public TO rideforge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rideforge_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rideforge_app;

-- Future tables and sequences created by the migration owner are accessible
-- to the private backend role, but not to browser roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rideforge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO rideforge_app;

INSERT INTO public.schema_migrations (version) VALUES ('009_create_private_backend_role')
ON CONFLICT (version) DO NOTHING;
COMMIT;
