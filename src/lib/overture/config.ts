export const OVERTURE_PROVIDER = "overture" as const;
export const OVERTURE_RELEASE = "2026-09-23.1";
export const OVERTURE_PIPELINE_VERSION = "advisoret-overture-pilot-1";
export const OVERTURE_REGION = "comunitat_valenciana";
export const OVERTURE_PUBLIC_BUCKET = "overture-public";

export const OVERTURE_MANIFEST_PATH = [
  "releases",
  OVERTURE_RELEASE,
  OVERTURE_PIPELINE_VERSION,
  OVERTURE_REGION,
  "manifest.json",
].join("/");

export const OVERTURE_SEARCH_INDEX_PATH = [
  "releases",
  OVERTURE_RELEASE,
  OVERTURE_PIPELINE_VERSION,
  OVERTURE_REGION,
  "search-index.json",
].join("/");

export const OVERTURE_PLACES_ENABLED = process.env.EXPO_PUBLIC_OVERTURE_PLACES_ENABLED === "true";
