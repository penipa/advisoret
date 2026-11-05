import type { OvertureSearchRecord } from "./search";

export type InternalVenueCandidate = {
  id: string;
  name: string;
  city: string;
  address_text: string | null;
  lat: number | null;
  lon: number | null;
};

export function normalizeVenueText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalizeVenueName(name: string, city: string): string {
  const suffix = name.match(/\s*\(([^()]*)\)\s*$/);
  const withoutCity = suffix && normalizeVenueText(suffix[1]) === normalizeVenueText(city)
    ? name.slice(0, suffix.index) : name;
  return normalizeVenueText(withoutCity);
}

// Similar names alone never establish identity. Generic prefixes only help
// compare variants when the complete address also agrees.
export function venueNameSimilarity(left: string, right: string): number {
  const clean = (s: string) => normalizeVenueText(s).replace(/^(bar|restaurante|restaurant|pub)\s+/, "");
  const a = clean(left);
  const b = clean(right);
  if (!a || !b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    }
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

function normalizeAddress(value: string): string {
  return normalizeVenueText(value)
    .replace(/\b(pl|placa|plaza)\b/g, "plaza")
    .replace(/\b(c|carrer|calle)\b/g, "calle")
    .replace(/\b(av|avda|avinguda|avenida)\b/g, "avenida")
    .replace(/\b(\d+)\s+([a-z])\b/g, "$1$2");
}

function distanceMeters(a: InternalVenueCandidate, b: OvertureSearchRecord): number {
  if (typeof a.lat !== "number" || typeof a.lon !== "number"
    || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)
    || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return Infinity;
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isMatch(internal: InternalVenueCandidate, external: OvertureSearchRecord): boolean {
  if (normalizeVenueText(internal.city) !== normalizeVenueText(external.city)) return false;
  const distance = distanceMeters(internal, external);
  if (distance > 30) return false;
  const a = normalizeVenueName(internal.name, internal.city);
  const b = normalizeVenueName(external.name, external.city);
  if (!a || !b) return false;
  const exactName = a === b;
  if (!exactName && venueNameSimilarity(a, b) < 0.8) return false;
  const addressA = normalizeAddress(internal.address_text ?? "");
  const addressB = normalizeAddress(external.address ?? "");

  if (addressA && addressB) {
    // Full street and house number agreement is required for fuzzy names.
    if (addressA === addressB && /\d/.test(addressA)) return exactName || distance <= 10;
    // An omitted building letter (2 versus 2B) is weaker evidence: accept only
    // identical names within 10 m, never different explicit letters/units.
    const houseA = addressA.match(/^(.*\s)(\d+)([a-z]?)$/);
    const houseB = addressB.match(/^(.*\s)(\d+)([a-z]?)$/);
    return exactName && distance <= 10 && !!houseA && !!houseB
      && houseA[1] === houseB[1] && houseA[2] === houseB[2]
      && (!houseA[3] || !houseB[3]);
  }

  // With missing addresses only an exact, non-generic name very close by is
  // sufficient. Multiple plausible internal identities remain visible below.
  return exactName && distance <= 10 && a.split(" ").length >= 2
    && !/^(bar|restaurante|restaurant|pub|cafe|cafeteria)\s/.test(a);
}

/** Only filters virtual records; canonical Advisoret objects are never changed. */
export function deduplicateOverturePlaces<T extends OvertureSearchRecord>(
  external: readonly T[],
  internal: readonly InternalVenueCandidate[],
  materializedIds: ReadonlySet<string> = new Set(),
): T[] {
  const knownIds = new Set(Array.from(materializedIds, (id) => id.trim().toLowerCase()));
  return external.filter((record) => {
    if (knownIds.has(record.id.trim().toLowerCase())) return false;
    const matches = new Set(internal.filter((venue) => isMatch(venue, record)).map((venue) => venue.id));
    return matches.size !== 1;
  });
}

export type CandidateBounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };

/** Fetch independently of Explore's text filter and visible pagination. */
export async function loadInternalDeduplicationCandidates(
  external: readonly OvertureSearchRecord[],
  readPage: (bounds: CandidateBounds, from: number, to: number) => PromiseLike<{
    data: InternalVenueCandidate[] | null;
    error: { message: string } | null;
  }>,
): Promise<InternalVenueCandidate[]> {
  if (!external.length) return [];
  // A generous box encloses the 30 m matching radius in the pilot region.
  const bounds = {
    minLat: Math.min(...external.map((v) => v.lat)) - 0.001,
    maxLat: Math.max(...external.map((v) => v.lat)) + 0.001,
    minLon: Math.min(...external.map((v) => v.lon)) - 0.001,
    maxLon: Math.max(...external.map((v) => v.lon)) + 0.001,
  };
  const candidates: InternalVenueCandidate[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await readPage(bounds, from, from + 199);
    if (error) throw new Error(error.message);
    candidates.push(...(data ?? []));
    if ((data?.length ?? 0) < 200) return candidates;
  }
}
