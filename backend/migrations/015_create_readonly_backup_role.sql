BEGIN;

-- A backup credential must be read-only and disabled until an operator
-- deliberately provisions it. BYPASSRLS is needed to export every row from
-- the backend-only schema; NOLOGIN prevents this role being used by default.
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rideforge_backup') THEN
    CREATE ROLE rideforge_backup NOLOGIN BYPASSRLS;
  END IF;
END
$block$;
ALTER ROLE rideforge_backup NOLOGIN BYPASSRLS PASSWORD NULL;

DO $block$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO rideforge_backup', current_database());
END
$block$;

GRANT USAGE ON SCHEMA public TO rideforge_backup;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM rideforge_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rideforge_backup;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM rideforge_backup;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rideforge_backup;

-- Future app-owned tables/sequences stay readable to the backup identity,
-- without granting any write or schema-management privileges.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM rideforge_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO rideforge_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM rideforge_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rideforge_backup;

INSERT INTO public.schema_migrations (version)
VALUES ('015_create_readonly_backup_role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
