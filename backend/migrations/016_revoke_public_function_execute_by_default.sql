BEGIN;

-- Migration 014 ran "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON
-- FUNCTIONS FROM PUBLIC". A schema-scoped default ACL can only add to PostgreSQL's
-- built-in global default (PUBLIC may EXECUTE every new function); it cannot remove
-- it, so on plain PostgreSQL a function created later was still executable by
-- anon, authenticated and service_role through PUBLIC. Revoking the global default
-- for the migration owner (no IN SCHEMA clause) is what actually makes new
-- functions opt-in. Existing functions were already revoked by 014.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

INSERT INTO public.schema_migrations (version)
VALUES ('016_revoke_public_function_execute_by_default')
ON CONFLICT (version) DO NOTHING;

COMMIT;
