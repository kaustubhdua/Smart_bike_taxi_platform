-- Distributed rate limiting for public geocoding/routing quote requests.
BEGIN;

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key_hash text PRIMARY KEY CHECK (length(key_hash) = 64),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rideforge_rate_limits_deny ON public.api_rate_limits;
CREATE POLICY rideforge_rate_limits_deny ON public.api_rate_limits
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.api_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rideforge_consume_rate_limit(
  p_key_hash text,
  p_limit integer DEFAULT 10,
  p_window_seconds integer DEFAULT 60
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  current_count integer;
BEGIN
  IF p_key_hash IS NULL OR length(p_key_hash) <> 64 OR
     p_limit NOT BETWEEN 1 AND 100 OR p_window_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid rate-limit parameters' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.api_rate_limits(key_hash,window_started_at,request_count,updated_at)
    VALUES(p_key_hash,now(),1,now())
  ON CONFLICT(key_hash) DO UPDATE
    SET window_started_at = CASE
          WHEN public.api_rate_limits.window_started_at <= now()-make_interval(secs => p_window_seconds)
          THEN now() ELSE public.api_rate_limits.window_started_at END,
        request_count = CASE
          WHEN public.api_rate_limits.window_started_at <= now()-make_interval(secs => p_window_seconds)
          THEN 1 ELSE public.api_rate_limits.request_count+1 END,
        updated_at=now()
  RETURNING request_count INTO current_count;

  RETURN current_count <= p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.rideforge_consume_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rideforge_consume_rate_limit(text,integer,integer) TO service_role;

INSERT INTO public.schema_migrations(version)
VALUES ('018_quote_rate_limits')
ON CONFLICT(version) DO NOTHING;
COMMIT;
