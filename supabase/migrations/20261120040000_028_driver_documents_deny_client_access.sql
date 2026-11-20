-- Make the no-direct-client-access posture explicit while service_role remains the only writer.
BEGIN;
CREATE POLICY "driver_documents_no_direct_client_access"
ON public.driver_documents
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
INSERT INTO public.schema_migrations(version)
VALUES ('028_driver_documents_deny_client_access')
ON CONFLICT(version) DO NOTHING;
COMMIT;