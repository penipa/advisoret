-- Read-only proximity search using exactly the view already accessible to callers.
-- Does not change the view, its grants/RLS, or materialization/identity functions.
CREATE OR REPLACE FUNCTION public.get_nearby_venues_v1(
  p_lat double precision,
  p_lon double precision,
  p_overture_candidates jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_lat IS NULL OR NOT (p_lat BETWEEN -90 AND 90)
    OR p_lon IS NULL OR NOT (p_lon BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid user coordinates';
  END IF;
  IF p_overture_candidates IS NULL OR jsonb_typeof(p_overture_candidates) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidates must be an array';
  END IF;
  IF jsonb_array_length(p_overture_candidates) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'at most 100 candidates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_overture_candidates) AS e
    WHERE jsonb_typeof(e->'lat') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e->'lon') IS DISTINCT FROM 'number'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid candidate coordinates';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_overture_candidates) AS p(lat double precision, lon double precision)
    WHERE NOT (p.lat BETWEEN -90 AND 90 AND p.lon BETWEEN -180 AND 180)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid candidate coordinates';
  END IF;

  RETURN (
    -- BEGIN NEARBY QUERY (also exercised with EXPLAIN ANALYZE in local tests)
    WITH nearest AS MATERIALIZED (
      SELECT v.id, v.name, v.city, v.address_text, v.cover_photo_path, v.lat, v.lon,
        power(sin(radians(v.lat - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(v.lat))
          * power(sin(radians(v.lon - p_lon) / 2), 2) AS h
      FROM public.vw_venues_with_coords AS v
      WHERE v.lat BETWEEN -90 AND 90 AND v.lon BETWEEN -180 AND 180
      ORDER BY h, v.id
      LIMIT 10
    ), points AS MATERIALIZED (
      SELECT DISTINCT p.lat, p.lon,
        CASE WHEN abs(p.lat) >= 89.999 THEN 360.0
          ELSE 0.001 / cos(radians(abs(p.lat) + 0.001)) END AS lon_margin
      FROM jsonb_to_recordset(p_overture_candidates) AS p(lat double precision, lon double precision)
    ), point_bins AS MATERIALIZED (
      -- A 30 m match is always in the same or an adjacent 0.001-degree latitude
      -- band. Equality allows a hash join instead of venues x 100 comparisons,
      -- even when no spatial/coordinate index is available through the view.
      SELECT p.*, floor(p.lat * 1000) + delta AS lat_bin
      FROM points AS p CROSS JOIN generate_series(-1, 1) AS delta
    ), identity AS (
      -- The box admits an index-backed lookup if the existing view exposes one.
      -- The spherical check retains every candidate within the client's 30 m rule.
      SELECT DISTINCT v.id, v.name, v.city, v.address_text, v.lat, v.lon
      FROM point_bins AS p
      JOIN public.vw_venues_with_coords AS v
        ON floor(v.lat * 1000) = p.lat_bin
       AND v.lat BETWEEN greatest(-90.0, p.lat - 0.001) AND least(90.0, p.lat + 0.001)
       AND (abs(v.lon - p.lon) <= p.lon_margin OR abs(v.lon - p.lon) >= 360 - p.lon_margin)
      WHERE v.lat BETWEEN -90 AND 90 AND v.lon BETWEEN -180 AND 180
        AND power(sin(radians(v.lat - p.lat) / 2), 2)
          + cos(radians(p.lat)) * cos(radians(v.lat))
          * power(sin(radians(v.lon - p.lon) / 2), 2)
            <= power(sin(0.030000001 / 12742.0), 2)
    )
    SELECT jsonb_build_object(
      'nearby', coalesce((SELECT jsonb_agg(
        (to_jsonb(n) - 'h') || jsonb_build_object('distance_km',
          12742.0 * asin(sqrt(least(1.0, greatest(0.0, n.h)))))
        ORDER BY n.h, n.id) FROM nearest AS n), '[]'::jsonb),
      'identity_candidates', CASE WHEN jsonb_array_length(p_overture_candidates) = 0 THEN '[]'::jsonb
        ELSE coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM identity AS i), '[]'::jsonb) END
    )
    -- END NEARBY QUERY
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_nearby_venues_v1(double precision, double precision, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_venues_v1(double precision, double precision, jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_nearby_venues_v1(double precision, double precision, jsonb) IS
  'Read-only, caller-visible nearest 10 venues plus all internal identity candidates within 30 m of up to 100 external coordinates. No global 200-row cap.';
