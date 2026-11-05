import type { SupabaseClient } from "@supabase/supabase-js";
import { deduplicateOverturePlaces } from "./overture/deduplicate";
import type { InternalVenueCandidate } from "./overture/deduplicate";
import type { OvertureSearchRecord } from "./overture/search";

type NearVenueBase = {
  name: string;
  city: string;
  address_text: string | null;
  cover_photo_path: string | null;
  lat: number | null;
  lon: number | null;
  distance_km: number;
  avg_score?: number | null;
  ratings_count?: number | null;
};
export type NearInternalVenue = NearVenueBase & { kind: "internal"; id: string };
export type NearOvertureVenue = NearVenueBase & { kind: "overture"; externalId: string };
export type NearVenue = NearInternalVenue | NearOvertureVenue;
type NearbyResponse = {
  nearby: Omit<NearInternalVenue, "kind">[];
  identity_candidates: InternalVenueCandidate[];
};

function distanceKm(lat: number, lon: number, other: OvertureSearchRecord): number {
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(other.lat - lat) / 2) ** 2
    + Math.cos(rad(lat)) * Math.cos(rad(other.lat)) * Math.sin(rad(other.lon - lon) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Fetch bounded display rows and complete, geographically relevant deduplication evidence. */
export async function loadNearbyVenues(
  client: Pick<SupabaseClient, "rpc" | "from">,
  lat: number,
  lon: number,
  overtureIndex: readonly OvertureSearchRecord[] = [],
): Promise<NearVenue[]> {
  const external = overtureIndex.map((record) => ({ record, distance_km: distanceKm(lat, lon, record) }))
    .sort((a, b) => a.distance_km - b.distance_km || a.record.id.localeCompare(b.record.id)).slice(0, 100);

  const [response, aliases] = await Promise.all([
    client.rpc("get_nearby_venues_v1", {
      p_lat: lat, p_lon: lon,
      p_overture_candidates: external.map(({ record }) => ({ lat: record.lat, lon: record.lon })),
    }),
    external.length ? Promise.resolve(client.rpc("get_materialized_external_ids_v1", {
      p_provider: "overture", p_external_ids: external.map(({ record }) => record.id),
    })).catch(() => ({ data: [], error: { message: "External references unavailable" } }))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (response.error) throw new Error(response.error.message);
  const data = response.data as NearbyResponse | null;
  if (!data || !Array.isArray(data.nearby) || !Array.isArray(data.identity_candidates)) {
    throw new Error("Invalid nearby RPC response");
  }
  const internal: NearInternalVenue[] = data.nearby.map((v) => ({
    ...v, kind: "internal", avg_score: 0, ratings_count: 0,
  }));
  // Alias failures suppress virtual results, while canonical venues remain usable.
  const knownIds = new Set<string>(((aliases.data ?? []) as { external_id: string }[]).map((v) => v.external_id));
  const visibleIds = new Set(aliases.error ? [] : deduplicateOverturePlaces(
    external.map(({ record }) => record), data.identity_candidates, knownIds,
  ).map((record) => record.id));
  const virtual: NearOvertureVenue[] = external.filter(({ record }) => visibleIds.has(record.id))
    .map(({ record, distance_km }) => ({
      kind: "overture", externalId: record.id, name: record.name, city: record.city,
      address_text: record.address, cover_photo_path: null, lat: record.lat, lon: record.lon,
      distance_km, avg_score: null, ratings_count: null,
    }));
  // Resolve identity against the full relevant set before selecting any visible row.
  const visible = [...internal, ...virtual].sort((a, b) => a.distance_km - b.distance_km).slice(0, 10);
  const ids = visible.filter((v): v is NearInternalVenue => v.kind === "internal").map((v) => v.id);
  if (ids.length) {
    const stats = await client.from("vw_venue_stats_all_time_current")
      .select("venue_id,avg_score,ratings_count").in("venue_id", ids);
    if (!stats.error) {
      const byId = new Map<string, { avg_score: number; ratings_count: number }>(
        (stats.data ?? []).map((v) => [v.venue_id, {
          avg_score: Number(v.avg_score ?? 0), ratings_count: Number(v.ratings_count ?? 0),
        }]),
      );
      for (const venue of visible) {
        if (venue.kind === "internal") Object.assign(venue, byId.get(venue.id));
      }
    }
  }
  return visible;
}
