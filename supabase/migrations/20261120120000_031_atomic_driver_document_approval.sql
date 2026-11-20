-- Serialize driver approval against document replacement and require the latest
-- upload for each required type to be explicitly verified.
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_driver_if_documents_verified(
  p_driver_id uuid,
  p_admin_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
    FROM public.driver_profiles
   WHERE account_id = p_driver_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES ('driving_license'::text), ('vehicle_rc'::text), ('insurance'::text)) AS required(document_type)
      LEFT JOIN LATERAL (
        SELECT d.review_status
          FROM public.driver_documents AS d
         WHERE d.driver_id = p_driver_id
           AND d.document_type = required.document_type
         ORDER BY d.created_at DESC, d.id DESC
         LIMIT 1
      ) AS latest ON true
     WHERE latest.review_status IS DISTINCT FROM 'verified'
  ) THEN
    RAISE EXCEPTION 'driver_documents_not_verified';
  END IF;

  UPDATE public.driver_profiles
     SET is_approved = true,
         approved_at = now(),
         approved_by = p_admin_id,
         is_online = false
   WHERE account_id = p_driver_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.suspend_driver_for_document_reverification(p_driver_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.driver_profiles
     SET is_approved = false,
         approved_at = NULL,
         approved_by = NULL,
         is_online = false
   WHERE account_id = p_driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_driver_if_documents_verified(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suspend_driver_for_document_reverification(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_driver_if_documents_verified(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.suspend_driver_for_document_reverification(uuid) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('031_atomic_driver_document_approval')
ON CONFLICT (version) DO NOTHING;


CREATE OR REPLACE FUNCTION public.review_driver_document(
  p_driver_id uuid,
  p_document_id uuid,
  p_review_status text,
  p_note text,
  p_admin_id uuid
)
RETURNS TABLE(id uuid, document_type text, review_status text, review_note text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $
BEGIN
  IF p_review_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'invalid_document_review_status';
  END IF;
  IF p_review_status = 'rejected' AND length(btrim(coalesce(p_note, ''))) < 8 THEN
    RAISE EXCEPTION 'document_rejection_reason_required';
  END IF;

  PERFORM 1
    FROM public.driver_profiles
   WHERE account_id = p_driver_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'driver_not_found';
  END IF;

  RETURN QUERY
    UPDATE public.driver_documents AS d
       SET review_status = p_review_status,
           review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = p_admin_id,
           reviewed_at = now(),
           updated_at = now()
     WHERE d.id = p_document_id
       AND d.driver_id = p_driver_id
     RETURNING d.id, d.document_type, d.review_status, d.review_note;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'driver_document_not_found';
  END IF;

  IF p_review_status = 'rejected' THEN
    UPDATE public.driver_profiles
       SET is_approved = false,
           approved_at = NULL,
           approved_by = NULL,
           is_online = false
     WHERE account_id = p_driver_id;
  END IF;
END;
$;

REVOKE ALL ON FUNCTION public.review_driver_document(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_driver_document(uuid, uuid, text, text, uuid) TO service_role;

COMMIT;
