-- Cover the reviewer foreign key used by admin document-review operations.
BEGIN;
CREATE INDEX IF NOT EXISTS driver_documents_reviewed_by_idx
  ON public.driver_documents (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

INSERT INTO public.schema_migrations(version)
VALUES ('030_index_driver_documents_reviewed_by')
ON CONFLICT (version) DO NOTHING;
COMMIT;
