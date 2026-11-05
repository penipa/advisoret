-- Conservative identity resolution before external materialization.
-- No existing venue data is updated. Helpers are backend-only.
CREATE OR REPLACE FUNCTION public.venue_identity_text_v1(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT btrim(regexp_replace(
    lower(regexp_replace(normalize(coalesce(p_value, ''), NFD), U&'[\0300-\036f]', '', 'g')),
    '[^[:alnum:]]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.venue_identity_name_v1(p_name text, p_city text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_suffix text[] := regexp_match(p_name, '\s*\(([^()]*)\)\s*$');
BEGIN
  IF v_suffix IS NOT NULL AND public.venue_identity_text_v1(v_suffix[1]) = public.venue_identity_text_v1(p_city) THEN
    RETURN public.venue_identity_text_v1(regexp_replace(p_name, '\s*\([^()]*\)\s*$', ''));
  END IF;
  RETURN public.venue_identity_text_v1(p_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.venue_identity_address_v1(p_address text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    public.venue_identity_text_v1(p_address),
    '\m(pl|placa|plaza)\M', 'plaza', 'g'),
    '\m(c|carrer|calle)\M', 'calle', 'g'),
    '\m(av|avda|avinguda|avenida)\M', 'avenida', 'g'),
    '\m([0-9]+)\s+([a-z])\M', '\1\2', 'g');
$$;

CREATE OR REPLACE FUNCTION public.venue_identity_similarity_v1(p_left text, p_right text)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  a text := regexp_replace(p_left, '^(bar|restaurante|restaurant|pub)\s+', '');
  b text := regexp_replace(p_right, '^(bar|restaurante|restaurant|pub)\s+', '');
  previous integer[];
  current_row integer[];
  i integer;
  j integer;
BEGIN
  IF coalesce(length(a), 0) = 0 OR coalesce(length(b), 0) = 0 THEN RETURN 0; END IF;
  -- Bound quadratic work on malformed source data. Exact names are handled separately.
  IF length(a) > 256 OR length(b) > 256 THEN RETURN 0; END IF;
  previous := ARRAY(SELECT generate_series(0, length(b)));
  FOR i IN 1..length(a) LOOP
    current_row := ARRAY[i];
    FOR j IN 1..length(b) LOOP
      current_row := array_append(current_row, least(
        current_row[j] + 1, previous[j + 1] + 1,
        previous[j] + CASE WHEN substr(a, i, 1) = substr(b, j, 1) THEN 0 ELSE 1 END));
    END LOOP;
    previous := current_row;
  END LOOP;
  RETURN 1 - previous[length(b) + 1]::double precision / greatest(length(a), length(b));
END;
$$;

-- 0 = distinct/no solid evidence, 1 = possible identity requiring review,
-- 2 = strong identity. A conflicting address can never yield 2.
CREATE OR REPLACE FUNCTION public.venue_identity_match_v1(
  p_name_a text, p_city_a text, p_address_a text, p_lat_a double precision, p_lon_a double precision,
  p_name_b text, p_city_b text, p_address_b text, p_lat_b double precision, p_lon_b double precision
)
RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  a text := public.venue_identity_name_v1(p_name_a, p_city_a);
  b text := public.venue_identity_name_v1(p_name_b, p_city_b);
  address_a text := public.venue_identity_address_v1(p_address_a);
  address_b text := public.venue_identity_address_v1(p_address_b);
  house_a text[];
  house_b text[];
  distance_m double precision;
  exact_name boolean := a = b;
BEGIN
  IF a = '' OR b = '' OR public.venue_identity_text_v1(p_city_a) = ''
    OR public.venue_identity_text_v1(p_city_a) <> public.venue_identity_text_v1(p_city_b)
    OR p_lat_a IS NULL OR p_lon_a IS NULL OR p_lat_b IS NULL OR p_lon_b IS NULL
    OR NOT (p_lat_a BETWEEN -90 AND 90 AND p_lat_b BETWEEN -90 AND 90
      AND p_lon_a BETWEEN -180 AND 180 AND p_lon_b BETWEEN -180 AND 180) THEN RETURN 0; END IF;
  distance_m := 12742000 * asin(least(1.0, sqrt(
    power(sin(radians(p_lat_a - p_lat_b) / 2), 2)
    + cos(radians(p_lat_a)) * cos(radians(p_lat_b)) * power(sin(radians(p_lon_a - p_lon_b) / 2), 2))));
  IF distance_m > 50 THEN RETURN 0; END IF;
  IF NOT exact_name AND (distance_m > 15 OR public.venue_identity_similarity_v1(a, b) < 0.8) THEN RETURN 0; END IF;

  IF distance_m <= 30 AND address_a <> '' AND address_b <> '' THEN
    IF address_a = address_b AND address_a ~ '[0-9]' AND (exact_name OR distance_m <= 10) THEN RETURN 2; END IF;
    house_a := regexp_match(address_a, '^(.*\s)([0-9]+)([a-z]?)$');
    house_b := regexp_match(address_b, '^(.*\s)([0-9]+)([a-z]?)$');
    IF exact_name AND distance_m <= 10 AND house_a IS NOT NULL AND house_b IS NOT NULL
      AND house_a[1] = house_b[1] AND house_a[2] = house_b[2]
      AND (house_a[3] = '' OR house_b[3] = '') THEN RETURN 2; END IF;
  ELSIF exact_name AND distance_m <= 10 AND a ~ '\s'
    AND a !~ '^(bar|restaurante|restaurant|pub|cafe|cafeteria)\s' THEN
    RETURN 2;
  END IF;
  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_external_venue_v1(
  p_provider text,
  p_external_id text,
  p_release text,
  p_pipeline_version text,
  p_name text,
  p_city text,
  p_address_text text,
  p_lat double precision,
  p_lon double precision
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_provider text := lower(btrim(p_provider));
  v_external_id text := btrim(p_external_id);
  v_release text := btrim(p_release);
  v_pipeline_version text := btrim(p_pipeline_version);
  v_name text := btrim(p_name);
  v_city text := btrim(p_city);
  v_venue_id uuid;
  v_candidate record;
  v_match integer;
  v_possible_count integer := 0;
  v_strong_count integer := 0;
BEGIN
  IF v_provider IS NULL OR v_provider = '' THEN
    RAISE EXCEPTION 'provider must be non-empty';
  END IF;

  IF v_external_id IS NULL OR v_external_id = '' THEN
    RAISE EXCEPTION 'external_id must be non-empty';
  END IF;

  IF v_release IS NULL OR v_release = '' THEN
    RAISE EXCEPTION 'release must be non-empty';
  END IF;

  IF v_pipeline_version IS NULL OR v_pipeline_version = '' THEN
    RAISE EXCEPTION 'pipeline_version must be non-empty';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'name must be non-empty';
  END IF;

  IF v_city IS NULL OR v_city = '' THEN
    RAISE EXCEPTION 'city must be non-empty';
  END IF;

  IF p_lat IS NULL
     OR p_lat::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_lat < -90
     OR p_lat > 90 THEN
    RAISE EXCEPTION 'lat must be finite and between -90 and 90';
  END IF;

  IF p_lon IS NULL
     OR p_lon::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_lon < -180
     OR p_lon > 180 THEN
    RAISE EXCEPTION 'lon must be finite and between -180 and 180';
  END IF;

  -- Serialize this RPC across ALL external IDs/providers. An ID-only lock
  -- cannot protect two simultaneous requests for the same physical venue.
  -- Default VOLATILE + READ COMMITTED ensures the scan sees the previous commit.
  -- Higher isolation must retry the whole transaction rather than scan an old snapshot.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'materialization requires read committed';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('advisoret:materialize_external_venue_v1', 0));

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_provider || E'\x1f' || v_external_id, 0)
  );

  SELECT venue_id
    INTO v_venue_id
    FROM public.venue_external_refs
   WHERE provider = v_provider
     AND external_id = v_external_id
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.venue_external_refs
       SET release = v_release,
           pipeline_version = v_pipeline_version,
           updated_at = now()
     WHERE provider = v_provider
       AND external_id = v_external_id;

    RETURN v_venue_id;
  END IF;

  -- No display limit or text-search filter: inspect every nearby stored venue.
  -- Row locks also prevent deleting/changing a chosen identity before aliasing it.
  FOR v_candidate IN
    SELECT id, name, city, address_text, lat, lon
    FROM public.venues
    WHERE lat BETWEEN p_lat - 0.001 AND p_lat + 0.001
      AND lon BETWEEN p_lon - 0.001 / greatest(abs(cos(radians(p_lat))), 0.00001)
                  AND p_lon + 0.001 / greatest(abs(cos(radians(p_lat))), 0.00001)
    ORDER BY id
    FOR UPDATE
  LOOP
    v_match := public.venue_identity_match_v1(
      v_candidate.name, v_candidate.city, v_candidate.address_text, v_candidate.lat, v_candidate.lon,
      v_name, v_city, p_address_text, p_lat, p_lon);
    IF v_match > 0 THEN v_possible_count := v_possible_count + 1; END IF;
    IF v_match = 2 THEN
      v_strong_count := v_strong_count + 1;
      v_venue_id := v_candidate.id;
    END IF;
  END LOOP;

  IF v_possible_count > 0 AND NOT (v_possible_count = 1 AND v_strong_count = 1) THEN
    -- Raising aborts the transaction: no venue and no alias is created.
    RAISE EXCEPTION USING ERRCODE = 'PAV01', MESSAGE = 'venue_match_ambiguous';
  END IF;

  IF v_strong_count = 0 THEN
    INSERT INTO public.venues (
      name,
      city,
      address_text,
      lat,
      lon,
      status,
      source,
      source_id
    )
    VALUES (
      v_name,
      v_city,
      p_address_text,
      p_lat,
      p_lon,
      'active',
      NULL,
      NULL
    )
    RETURNING id INTO v_venue_id;
  END IF;

  INSERT INTO public.venue_external_refs (
    venue_id,
    provider,
    external_id,
    release,
    pipeline_version
  )
  VALUES (
    v_venue_id,
    v_provider,
    v_external_id,
    v_release,
    v_pipeline_version
  );

  RETURN v_venue_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.materialize_external_venue_v1(
  text, text, text, text, text, text, text, double precision, double precision
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_external_venue_v1(
  text, text, text, text, text, text, text, double precision, double precision
) TO service_role;

COMMENT ON FUNCTION public.materialize_external_venue_v1(
  text, text, text, text, text, text, text, double precision, double precision
) IS
  'Backend-only identity-safe materialization; PAV01 blocks ambiguous matches without writes.';

REVOKE ALL ON FUNCTION public.venue_identity_text_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_identity_name_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_identity_address_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_identity_similarity_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venue_identity_match_v1(text, text, text, double precision, double precision, text, text, text, double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venue_identity_text_v1(text), public.venue_identity_name_v1(text, text), public.venue_identity_address_v1(text), public.venue_identity_similarity_v1(text, text), public.venue_identity_match_v1(text, text, text, double precision, double precision, text, text, text, double precision, double precision) TO service_role;
