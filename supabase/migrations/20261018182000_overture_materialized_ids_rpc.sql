CREATE OR REPLACE FUNCTION public.get_materialized_external_ids_v1(
  p_provider text,
  p_external_ids text[]
)
RETURNS TABLE (external_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider text := lower(btrim(p_provider));
BEGIN
  IF v_provider IS NULL OR v_provider = '' THEN
    RAISE EXCEPTION 'provider must be non-empty';
  END IF;

  IF p_external_ids IS NULL OR cardinality(p_external_ids) = 0 THEN
    RETURN;
  END IF;

  IF cardinality(p_external_ids) > 100 THEN
    RAISE EXCEPTION 'too many external ids';
  END IF;

  RETURN QUERY
  SELECT r.external_id
  FROM public.venue_external_refs r
  WHERE r.provider = v_provider
    AND r.external_id = ANY (p_external_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_materialized_external_ids_v1(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_materialized_external_ids_v1(text, text[]) TO anon, authenticated;

COMMENT ON FUNCTION public.get_materialized_external_ids_v1(text, text[]) IS
  'Returns only external IDs that are already materialized, without exposing venue_external_refs directly.';
