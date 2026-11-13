BEGIN;

-- The API only needs nextval/currval access for generated bigserial IDs.
-- UPDATE also permits setval(), which the application never calls. Retain
-- USAGE and SELECT while removing this unnecessary capability from existing
-- and future public-schema sequences.
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM rideforge_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE UPDATE ON SEQUENCES FROM rideforge_app;

INSERT INTO public.schema_migrations (version)
VALUES ('013_runtime_role_sequence_least_privilege')
ON CONFLICT (version) DO NOTHING;

COMMIT;
