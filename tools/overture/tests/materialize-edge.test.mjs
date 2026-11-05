import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadModule } from "./materialize-harness.mjs";

const externalId = "fa3298cc-8e1b-4ca6-84b9-5cb124577de0";
const venueId = "390b32e6-7be9-4aea-aa53-da01458b7679";
const record = {
  id: externalId, name: "Ca Mario (Alfondeguilla)", city: "Alfondeguilla",
  address: "Plaça de l'Ajuntament, 2", lat: 39.83762814596327, lon: -0.268619520274177,
  primary: "pub", confidence: 0.9,
};

async function invokeEdge(result, authorized = true) {
  let handler;
  const calls = [];
  const shard = JSON.stringify([record]);
  const manifest = {
    release: "2026-09-23.1", pipeline_version: "pilot-1", region: "comunitat_valenciana", record_count: 1,
    shards: { fa: { name: "fa.json", record_count: 1, byte_size: Buffer.byteLength(shard), sha256: createHash("sha256").update(shard).digest("hex") } },
  };
  const admin = {
    auth: { getUser: async () => ({ data: { user: authorized ? { id: "test-user" } : null }, error: null }) },
    from: (table) => {
      assert.equal(table, "place_provider_config");
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { key: "overture", enabled: true, active_release: manifest.release, active_pipeline_version: manifest.pipeline_version }, error: null,
      }) }) }) };
    },
    storage: { from: (bucket) => {
      assert.equal(bucket, "overture-private");
      return { download: async (path) => ({ data: new Blob([path.endsWith("manifest.json") ? JSON.stringify(manifest) : shard]), error: null }) };
    } },
    rpc: async (name, args) => { calls.push({ name, args }); return result; },
  };
  await loadModule("../../../supabase/functions/materialize-overture-place/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2.57.4": { createClient: () => admin },
  }, {
    Deno: { env: { get: (key) => ({ SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "local-test-only" })[key] }, serve: (callback) => { handler = callback; } },
    console: { error() {} },
  });
  const response = await handler(new Request("https://test.invalid/materialize-overture-place", {
    method: "POST", headers: { Authorization: "Bearer local-test-token", Origin: "https://app.test" },
    body: JSON.stringify({ external_id: externalId, release: manifest.release, name: "Untrusted client name" }),
  }));
  return { response, body: await response.json(), calls };
}

test("RPC ambiguity maps to HTTP 409 with stable code and no venue ID", async () => {
  const { response, body, calls } = await invokeEdge({ data: null, error: { code: "PAV01", message: "venue_match_ambiguous" } });
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  assert.equal(body.code, "venue_match_ambiguous");
  assert.equal(body.venue_id, undefined);
  assert.equal(calls.length, 1);
});

test("success returns the canonical UUID using only authoritative source metadata", async () => {
  const { response, body, calls } = await invokeEdge({ data: venueId, error: null });
  assert.equal(response.status, 200);
  assert.equal(body.venue_id, venueId);
  assert.equal(calls[0].name, "materialize_external_venue_v1");
  assert.equal(calls[0].args.p_name, record.name);
  assert.equal(calls[0].args.p_address_text, record.address);
});

test("other RPC errors and invalid UUIDs fail closed", async () => {
  for (const result of [{ data: null, error: { code: "XX000" } }, { data: "invalid", error: null }]) {
    const { response, body } = await invokeEdge(result);
    assert.equal(response.status, 500);
    assert.equal(body.venue_id, undefined);
    assert.equal(body.code, undefined);
  }
});

test("unauthenticated requests never invoke the materialization RPC", async () => {
  const { response, calls } = await invokeEdge({ data: venueId, error: null }, false);
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});
