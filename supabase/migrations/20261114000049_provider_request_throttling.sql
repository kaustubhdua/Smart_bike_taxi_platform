-- Serialize public Nominatim usage across concurrent Edge Function instances.
BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_throttles (
  provider text PRIMARY KEY CHECK (length(provider) BETWEEN 1 AND 64),
  next_allowed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_throttles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rideforge_provider_throttles_deny ON public.provider_throttles;
CREATE POLICY rideforge_provider_throttles_deny ON public.provider_throttles
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.provider_throttles FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rideforge_reserve_provider_slot(
  p_provider text,
  p_interval_ms integer DEFAULT 1100
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  reserved_at timestamptz;
BEGIN
  IF p_provider IS NULL OR length(p_provider) NOT BETWEEN 1 AND 64 OR
     p_interval_ms NOT BETWEEN 500 AND 5000 THEN
    RAISE EXCEPTION 'invalid provider throttle parameters' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.provider_throttles(provider,next_allowed_at,updated_at)
    VALUES(p_provider,now(),now())
  ON CONFLICT(provider) DO UPDATE
    SET next_allowed_at = GREATEST(now(),public.provider_throttles.next_allowed_at)
                         + make_interval(secs => p_interval_ms / 1000.0),
        updated_at=now()
  RETURNING next_allowed_at INTO reserved_at;
  RETURN reserved_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.rideforge_reserve_provider_slot(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_reserve_provider_slot(text,integer) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('019_provider_request_throttling')
ON CONFLICT(version) DO NOTHING;
COMMIT;
