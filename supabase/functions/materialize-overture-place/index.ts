import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const PROVIDER = "overture";
const REGION = "comunitat_valenciana";
const BUCKET = "overture-private";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

type ErrorLike = {
  message?: unknown;
  code?: unknown;
};

type ProviderConfig = {
  key: string;
  enabled: boolean;
  active_release: string | null;
  active_pipeline_version: string | null;
};

type ShardManifestEntry = {
  name: string;
  record_count: number;
  byte_size: number;
  sha256: string;
};

type PrivateManifest = {
  release: string;
  pipeline_version: string;
  region: string;
  record_count: number;
  shards: Record<string, ShardManifestEntry>;
};

type OvertureRecord = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number;
  lon: number;
  primary: string | null;
  confidence: number;
};

type StorageDownloader = {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{
        data: Blob | null;
        error: unknown;
      }>;
    };
  };
};

function json(status: number, body: Record<string, unknown>, req?: Request) {
  const origin = req?.headers.get("Origin");
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function optionsResponse(req: Request): Response {
  const origin = req.headers.get("Origin");
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers });
}

function errorMessage(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as ErrorLike).message ?? "unknown error")
    : error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]/g, " ").slice(0, 240);
}

function fail(stage: string, error: unknown, externalId?: string): void {
  console.error("materialize-overture-place failed", {
    stage,
    message: errorMessage(error),
    ...(externalId ? { external_id: externalId } : {}),
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isValidRecord(value: unknown, externalId: string): value is OvertureRecord {
  if (!isObject(value)) return false;
  return value.id === externalId
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.city)
    && (value.address === null || typeof value.address === "string")
    && isFiniteNumber(value.lat) && value.lat >= -90 && value.lat <= 90
    && isFiniteNumber(value.lon) && value.lon >= -180 && value.lon <= 180
    && (value.primary === null || typeof value.primary === "string")
    && isFiniteNumber(value.confidence) && value.confidence >= 0.7;
}

async function downloadBytes(
  admin: StorageDownloader,
  path: string,
  externalId: string,
): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) {
    fail("storage_download", error ?? new Error("empty storage response"), externalId);
    throw new Error("artifact unavailable");
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function validateManifest(value: unknown, release: string, pipelineVersion: string): PrivateManifest {
  if (!isObject(value)
    || value.release !== release
    || value.pipeline_version !== pipelineVersion
    || value.region !== REGION
    || !isNonNegativeInteger(value.record_count)
    || !isObject(value.shards)) {
    throw new Error("invalid private manifest");
  }

  const shards: Record<string, ShardManifestEntry> = {};
  for (const [prefix, entry] of Object.entries(value.shards)) {
    if (!/^[0-9a-f]{2}$/.test(prefix)
      || !isObject(entry)
      || entry.name !== `${prefix}.json`
      || !isNonNegativeInteger(entry.record_count)
      || !isNonNegativeInteger(entry.byte_size)
      || typeof entry.sha256 !== "string"
      || !SHA256_RE.test(entry.sha256)) {
      throw new Error("invalid shard manifest entry");
    }
    shards[prefix] = {
      name: entry.name,
      record_count: entry.record_count,
      byte_size: entry.byte_size,
      sha256: entry.sha256,
    };
  }

  return {
    release,
    pipeline_version: pipelineVersion,
    region: REGION,
    record_count: value.record_count,
    shards,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" }, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    fail("environment", new Error("missing Supabase environment variables"));
    return json(500, { error: "Server configuration unavailable" }, req);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { error: "Unauthorized" }, req);
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return json(401, { error: "Unauthorized" }, req);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return json(401, { error: "Unauthorized" }, req);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    fail("request_json", error);
    return json(400, { error: "Invalid JSON" }, req);
  }

  if (!isObject(body)
    || typeof body.external_id !== "string"
    || !body.external_id.trim()
    || typeof body.release !== "string"
    || !body.release.trim()) {
    return json(400, { error: "Invalid request" }, req);
  }

  const externalId = body.external_id.trim().toLowerCase();
  const requestedRelease = body.release.trim();
  if (!UUID_RE.test(externalId)) {
    return json(400, { error: "Invalid external_id" }, req);
  }

  const { data: config, error: configError } = await admin
    .from("place_provider_config")
    .select("key, enabled, active_release, active_pipeline_version")
    .eq("key", PROVIDER)
    .maybeSingle();

  if (configError || !config) {
    fail("provider_config", configError ?? new Error("missing provider configuration"), externalId);
    return json(500, { error: "Provider unavailable" }, req);
  }

  const providerConfig = config as ProviderConfig;
  const activeRelease = typeof providerConfig.active_release === "string" ? providerConfig.active_release.trim() : "";
  const pipelineVersion = typeof providerConfig.active_pipeline_version === "string"
    ? providerConfig.active_pipeline_version.trim()
    : "";
  if (providerConfig.key !== PROVIDER
    || providerConfig.enabled !== true
    || !activeRelease
    || !pipelineVersion
    || requestedRelease !== activeRelease) {
    fail("provider_config", new Error("provider configuration is disabled or inconsistent"), externalId);
    return json(500, { error: "Provider unavailable" }, req);
  }

  const basePath = `releases/${activeRelease}/${pipelineVersion}/${REGION}`;
  let manifest: PrivateManifest;
  try {
    const manifestBytes = await downloadBytes(admin, `${basePath}/manifest.json`, externalId);
    manifest = validateManifest(parseJson(manifestBytes), activeRelease, pipelineVersion);
  } catch (error) {
    fail("manifest", error, externalId);
    return json(500, { error: "Provider artifact unavailable" }, req);
  }

  const prefix = externalId.slice(0, 2);
  const shardEntry = manifest.shards[prefix];
  if (!shardEntry) {
    fail("manifest", new Error("requested shard is missing"), externalId);
    return json(500, { error: "Provider artifact unavailable" }, req);
  }

  const shardPath = `${basePath}/shards/${prefix}.json`;
  let records: unknown;
  try {
    const shardBytes = await downloadBytes(admin, shardPath, externalId);
    if (shardBytes.byteLength !== shardEntry.byte_size || await sha256(shardBytes) !== shardEntry.sha256) {
      throw new Error("shard integrity validation failed");
    }
    records = parseJson(shardBytes);
    if (!Array.isArray(records) || records.length !== shardEntry.record_count) {
      throw new Error("invalid shard records");
    }
  } catch (error) {
    fail("shard", error, externalId);
    return json(500, { error: "Provider artifact unavailable" }, req);
  }

  const record = records.find((candidate) => isObject(candidate) && candidate.id === externalId);
  if (!record) {
    return json(404, { error: "Overture place not found" }, req);
  }
  if (!isValidRecord(record, externalId)) {
    fail("record", new Error("canonical record is inconsistent"), externalId);
    return json(500, { error: "Provider artifact unavailable" }, req);
  }

  const { data: venueId, error: rpcError } = await admin.rpc("materialize_external_venue_v1", {
    p_provider: PROVIDER,
    p_external_id: externalId,
    p_release: activeRelease,
    p_pipeline_version: pipelineVersion,
    p_name: record.name,
    p_city: record.city,
    p_address_text: record.address,
    p_lat: record.lat,
    p_lon: record.lon,
  });

  if (rpcError || typeof venueId !== "string" || !UUID_RE.test(venueId)) {
    fail("materialization_rpc", rpcError ?? new Error("RPC returned an invalid venue id"), externalId);
    return json(500, { error: "Venue materialization unavailable" }, req);
  }

  return json(200, { venue_id: venueId }, req);
});
