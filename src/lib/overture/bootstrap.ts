import { isOvertureSearchManifest, type OvertureSearchManifest } from "./cache-contract.ts";
import {
  OVERTURE_MANIFEST_PATH,
  OVERTURE_PIPELINE_VERSION,
  OVERTURE_PLACES_ENABLED,
  OVERTURE_PROVIDER,
  OVERTURE_PUBLIC_BUCKET,
  OVERTURE_REGION,
  OVERTURE_RELEASE,
  OVERTURE_SEARCH_INDEX_PATH,
} from "./config.ts";
import type { OvertureSearchRecord } from "./search";

export async function loadOvertureSearchIndex(): Promise<OvertureSearchRecord[] | null> {
  if (!OVERTURE_PLACES_ENABLED) return null;

  try {
    const [{ ensureOvertureSearchArtifact, readCachedOvertureSearchIndex }, { storagePublicUrl }] = await Promise.all([
      import("./cache.ts"),
      import("../supabase.ts"),
    ]);
    const manifestUrl = storagePublicUrl(OVERTURE_PUBLIC_BUCKET, OVERTURE_MANIFEST_PATH);
    if (!manifestUrl) return null;

    const response = await fetch(manifestUrl);
    if (!response.ok) return null;

    const value: unknown = await response.json();
    if (!isOvertureSearchManifest(value)) return null;

    const manifest = value as OvertureSearchManifest;
    if (
      manifest.provider !== OVERTURE_PROVIDER
      || manifest.release !== OVERTURE_RELEASE
      || manifest.pipeline_version !== OVERTURE_PIPELINE_VERSION
      || manifest.region !== OVERTURE_REGION
      || manifest.search_artifact.path !== OVERTURE_SEARCH_INDEX_PATH
    ) return null;

    const searchIndexUrl = storagePublicUrl(OVERTURE_PUBLIC_BUCKET, OVERTURE_SEARCH_INDEX_PATH);
    if (!searchIndexUrl) return null;
    if (!await ensureOvertureSearchArtifact(manifest, searchIndexUrl)) return null;

    return await readCachedOvertureSearchIndex();
  } catch {
    return null;
  }
}
