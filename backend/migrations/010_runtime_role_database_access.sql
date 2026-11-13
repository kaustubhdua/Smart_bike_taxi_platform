BEGIN;
-- Migration 009 originally granted CONNECT on the database named postgres.
-- Compose and CI use other database names, and managed Postgres may revoke
-- CONNECT from PUBLIC. Grant the runtime role access to this actual database.
ALTER ROLE rideforge_app
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
DO $block$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO rideforge_app', current_database());
END
$block$;
GRANT USAGE ON SCHEMA public TO rideforge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rideforge_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rideforge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rideforge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO rideforge_app;
INSERT INTO public.schema_migrations (version)
VALUES ('010_runtime_role_database_access')
ON CONFLICT (version) DO NOTHING;
COMMIT;
