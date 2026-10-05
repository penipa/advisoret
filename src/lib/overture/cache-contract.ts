import type { OvertureSearchRecord } from "./search";

export type OvertureSearchManifest = {
  provider: "overture";
  release: string;
  schema_version: string;
  pipeline_version: string;
  region: string;
  record_count: number;
  search_artifact: {
    path: string;
    format: "json";
    byte_size: number;
    sha256: string;
  };
};

export type OvertureCacheMetadata = {
  release: string;
  schema_version: string;
  pipeline_version: string;
  region: string;
  sha256: string;
  byte_size: number;
  local_uri: string;
  downloaded_at: string;
};

export type CachedOvertureSearchArtifact = {
  metadata: OvertureCacheMetadata;
  local_uri: string;
};

export function versionedOvertureArtifactParts(
  manifest: Pick<OvertureSearchManifest, "release" | "pipeline_version" | "region">,
): string[] {
  return [manifest.release, manifest.pipeline_version, manifest.region].map(encodePathSegment);
}

export function overtureMetadataMatchesManifest(
  metadata: OvertureCacheMetadata,
  manifest: OvertureSearchManifest,
): boolean {
  return metadata.release === manifest.release
    && metadata.schema_version === manifest.schema_version
    && metadata.pipeline_version === manifest.pipeline_version
    && metadata.region === manifest.region
    && metadata.sha256 === manifest.search_artifact.sha256
    && metadata.byte_size === manifest.search_artifact.byte_size;
}

export function isOvertureCacheMetadata(value: unknown): value is OvertureCacheMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const metadata = value as Partial<OvertureCacheMetadata>;
  const hasValidByteSize = typeof metadata.byte_size === "number"
    && Number.isInteger(metadata.byte_size)
    && metadata.byte_size > 0;
  return [
    metadata.release,
    metadata.schema_version,
    metadata.pipeline_version,
    metadata.region,
    metadata.local_uri,
    metadata.downloaded_at,
  ].every((field) => typeof field === "string" && field.length > 0)
    && typeof metadata.sha256 === "string"
    && /^[0-9a-f]{64}$/.test(metadata.sha256)
    && hasValidByteSize;
}

export function arrayBufferToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isSearchIndex(value: unknown): value is OvertureSearchRecord[] {
  if (!Array.isArray(value)) return false;

  const ids = new Set<string>();
  return value.every((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;

    const keys = Object.keys(record).sort();
    if (keys.join("\0") !== SEARCH_INDEX_KEYS.join("\0")) return false;

    const candidate = record as Partial<OvertureSearchRecord>;
    if (
      typeof candidate.id !== "string"
      || candidate.id.length === 0
      || !UUID_PATTERN.test(candidate.id)
      || candidate.id !== candidate.id.toLowerCase()
      || ids.has(candidate.id)
    ) return false;
    ids.add(candidate.id);

    return typeof candidate.name === "string"
      && candidate.name.length > 0
      && typeof candidate.city === "string"
      && candidate.city.length > 0
      && (typeof candidate.address === "string" || candidate.address === null)
      && typeof candidate.lat === "number"
      && Number.isFinite(candidate.lat)
      && candidate.lat >= -90
      && candidate.lat <= 90
      && typeof candidate.lon === "number"
      && Number.isFinite(candidate.lon)
      && candidate.lon >= -180
      && candidate.lon <= 180
      && (typeof candidate.primary === "string" || candidate.primary === null);
  });
}

const SEARCH_INDEX_KEYS = ["address", "city", "id", "lat", "lon", "name", "primary"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
