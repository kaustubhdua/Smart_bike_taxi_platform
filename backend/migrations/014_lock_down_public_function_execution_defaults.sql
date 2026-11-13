BEGIN;

-- RideForge exposes no application RPC surface: all database access is
-- mediated by the trusted API connection. Revoke function execution from
-- browser/API gateway roles and service_role; trigger invocation remains
-- governed by PostgreSQL's trigger privileges and the function owner.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $block$
DECLARE
  grantee text;
BEGIN
  FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
      EXECUTE format(
        'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I',
        grantee
      );
    END IF;
  END LOOP;
END
$block$;

-- New functions created by the migration owner must be opt-in too. Use the
-- current migration owner so the same file works in Supabase and plain
-- PostgreSQL CI/Compose environments.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $block$
DECLARE
  grantee text;
BEGIN
  FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
        grantee
      );
    END IF;
  END LOOP;
END
$block$;

INSERT INTO public.schema_migrations (version)
VALUES ('014_lock_down_public_function_execution_defaults')
ON CONFLICT (version) DO NOTHING;

COMMIT;
