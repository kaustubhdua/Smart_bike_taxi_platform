-- Driver self-registration and private verification-document metadata.
BEGIN;

CREATE TABLE IF NOT EXISTS public.driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('driving_license','vehicle_rc','insurance')),
  object_path text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','verified','rejected')),
  review_note text,
  reviewed_by uuid REFERENCES public.accounts(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_documents_driver_status_idx
  ON public.driver_documents(driver_id,review_status,document_type);

ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.driver_documents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.driver_documents TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('driver-verification','driver-verification',false,10485760,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png'];

-- No browser Storage policies are granted: all document reads/writes go through
-- the authenticated Edge Function, which checks the driver's account or admin role.

INSERT INTO public.schema_migrations(version)
VALUES ('027_driver_self_registration_documents')
ON CONFLICT(version) DO NOTHING;

COMMIT;
