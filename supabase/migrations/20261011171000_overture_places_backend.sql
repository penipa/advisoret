-- Overture backend materialization primitives.

CREATE TABLE IF NOT EXISTS public.venue_external_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  release text,
  pipeline_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_external_refs_provider_check
    CHECK (provider <> '' AND provider = lower(btrim(provider))),
  CONSTRAINT venue_external_refs_external_id_check
    CHECK (btrim(external_id) <> ''),
  CONSTRAINT venue_external_refs_provider_external_id_key
    UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS venue_external_refs_venue_id_idx
  ON public.venue_external_refs (venue_id);

ALTER TABLE public.venue_external_refs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.venue_external_refs FROM anon, authenticated;
GRANT ALL ON TABLE public.venue_external_refs TO service_role;

COMMENT ON TABLE public.venue_external_refs IS
  'Canonical external-provider aliases for internal public.venues identities.';

CREATE TABLE IF NOT EXISTS public.place_provider_config (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  active_release text,
  active_pipeline_version text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_provider_config_key_check
    CHECK (key <> '' AND key = lower(btrim(key))),
  CONSTRAINT place_provider_config_enabled_fields_check
    CHECK (
      NOT enabled
      OR (
        active_release IS NOT NULL
        AND btrim(active_release) <> ''
        AND active_pipeline_version IS NOT NULL
        AND btrim(active_pipeline_version) <> ''
      )
    )
);

ALTER TABLE public.place_provider_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.place_provider_config FROM anon, authenticated;
GRANT ALL ON TABLE public.place_provider_config TO service_role;

INSERT INTO public.place_provider_config (
  key,
  enabled,
  active_release,
  active_pipeline_version
)
VALUES ('overture', false, NULL, NULL)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.place_provider_config IS
  'Backend-only provider activation and pipeline metadata.';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('overture-public', 'overture-public', true, 10485760),
  ('overture-private', 'overture-private', false, 10485760)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider text := lower(btrim(p_provider));
  v_external_id text := btrim(p_external_id);
  v_release text := btrim(p_release);
  v_pipeline_version text := btrim(p_pipeline_version);
  v_name text := btrim(p_name);
  v_city text := btrim(p_city);
  v_venue_id uuid;
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
  'Backend-only idempotent materialization of an external venue into public.venues.';
