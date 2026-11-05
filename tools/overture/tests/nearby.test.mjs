import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadModule } from "./materialize-harness.mjs";
import { deduplicateOverturePlaces } from "../../../src/lib/overture/deduplicate.ts";

const lat = 39.8376443050948, lon = -0.26861508855148;
const canonical = { id: "390b32e6-7be9-4aea-aa53-da01458b7679", name: "Ca Mario", city: "Alfondeguilla",
  address_text: "Pl. de l'Ajuntament, 2B", cover_photo_path: "original/cover.jpg", lat, lon };
const external = { id: "fa3298cc-8e1b-4ca6-84b9-5cb124577de0", name: "Ca Mario (Alfondeguilla)",
  city: canonical.city, address: "Plaça de l'Ajuntament, 2", lat, lon, primary: "pub" };
const fixture = [...Array.from({ length: 250 }, (_, i) => ({ ...canonical, id: `far-${i}`, name: `Far ${i}`, lat: lat + 1 })), canonical];
const km = (v, userLat = lat, userLon = lon) => 12742 * Math.asin(Math.sqrt(Math.sin((v.lat - userLat) * Math.PI / 360) ** 2
  + Math.cos(userLat * Math.PI / 180) * Math.cos(v.lat * Math.PI / 180) * Math.sin((v.lon - userLon) * Math.PI / 360) ** 2));
const load = async () => (await loadModule("../../../src/lib/nearby.ts", {
  "./overture/deduplicate": { deduplicateOverturePlaces },
})).loadNearbyVenues;

function clientFor(rows = fixture, options = {}) {
  const calls = [];
  return { calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "get_materialized_external_ids_v1") {
        if (options.aliasThrow) throw new Error("network unavailable");
        return { data: options.aliases ?? [], error: options.aliasError ?? null };
      }
      assert.equal(name, "get_nearby_venues_v1");
      const ranked = rows.map((v) => ({ ...v, distance_km: km(v, args.p_lat, args.p_lon) })).sort((a, b) => a.distance_km - b.distance_km);
      return { error: options.error ?? null, data: options.invalid ? {} : {
        nearby: ranked.slice(0, 10),
        identity_candidates: rows.filter((v) => args.p_overture_candidates.some((p) =>
          Math.abs(p.lat - v.lat) < 0.0001 && Math.abs(p.lon - v.lon) < 0.0001)),
      } };
    },
    from(name) {
      assert.equal(name, "vw_venue_stats_all_time_current");
      return { select() { return { async in(column, ids) {
        assert.equal(column, "venue_id"); calls.push({ name, ids }); assert.ok(ids.length <= 10);
        return { data: ids.map((venue_id) => ({ venue_id, avg_score: 4.775, ratings_count: 4 })), error: options.statsError ?? null };
      } }; } };
    },
  };
}

test("Inicio detecta el local 251, suprime Overture y conserva UUID, foto y valoraciones", async () => {
  const before = structuredClone(fixture);
  const client = clientFor();
  const rows = await (await load())(client, lat, lon, [external]);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].id, fixture[250].id);
  assert.equal(rows[0].cover_photo_path, canonical.cover_photo_path);
  assert.equal(rows[0].avg_score, 4.775);
  assert.equal(rows[0].ratings_count, 4);
  assert.ok(rows.every((v) => v.kind === "internal"));
  assert.deepEqual(fixture, before);
  assert.deepEqual(client.calls.map((c) => c.name), ["get_nearby_venues_v1", "get_materialized_external_ids_v1", "vw_venue_stats_all_time_current"]);
});

test("deduplica contra candidatos fuera de los diez internos visibles antes de cortar resultados", async () => {
  const closer = Array.from({ length: 10 }, (_, i) => ({ ...canonical, id: `close-${i}`, name: `Otro ${i}` }));
  const beyondTen = { ...canonical, lat: lat + 0.00001 };
  const client = clientFor([...closer, beyondTen]);
  const virtual = { ...external, lat: lat - 0.00001 };
  const rows = await (await load())(client, virtual.lat, lon, [virtual]);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((v) => v.kind === "internal"));
  assert.ok(rows.every((v) => v.id !== canonical.id));
});

test("una segunda identidad después de 200 candidatos conserva la ambigüedad", async () => {
  const candidates = Array.from({ length: 250 }, (_, i) => ({ ...canonical, id: `other-${i}`, name: `Otro ${i}`, lat: lat + 0.00005 }));
  candidates[0] = { ...canonical, lat: lat + 0.00005 };
  candidates.push({ ...canonical, id: "second-identity", lat: lat + 0.00005 });
  const rows = await (await load())(clientFor(candidates), lat, lon, [external]);
  assert.equal(rows[0].kind, "overture");
  assert.equal(rows[0].externalId, external.id);
});

test("flag OFF usa solo proximidad y valoraciones, sin referencias ni candidatos Overture", async () => {
  const client = clientFor();
  const rows = await (await load())(client, lat, lon);
  assert.equal(rows[0].id, canonical.id);
  assert.deepEqual(client.calls.map((c) => c.name), ["get_nearby_venues_v1", "vw_venue_stats_all_time_current"]);
  assert.equal(client.calls[0].args.p_overture_candidates.length, 0);
  const home = await readFile(new URL("../../../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(home, /if \(OVERTURE_PLACES_ENABLED\)\s*\{\s*try\s*\{\s*overtureIndex = \(await loadOvertureSearchIndex\(\)\)/);
  assert.match(home, /setNearRows\(await loadNearbyVenues\(supabase, myLat, myLon, overtureIndex\)\)/);
  assert.match(home, /onPress=\{\(\) => void onNearVenuePress\(v\)\}/);
});

test("referencia materializada y error de referencias no muestran duplicados virtuales", async () => {
  for (const options of [{ aliases: [{ external_id: external.id }] }, { aliasError: { message: "offline" } }, { aliasThrow: true }]) {
    const rows = await (await load())(clientFor(fixture.slice(0, 250), options), lat, lon, [external]);
    assert.ok(rows.every((v) => v.kind === "internal"));
  }
});

test("errores y respuestas incompletas de proximidad no usan datos parciales", async () => {
  const fn = await load();
  await assert.rejects(fn(clientFor(fixture, { error: { message: "RPC unavailable" } }), lat, lon), /RPC unavailable/);
  await assert.rejects(fn(clientFor(fixture, { invalid: true }), lat, lon), /Invalid nearby/);
});

test("limita Overture a cien y no consulta valoraciones si todos los visibles son externos", async () => {
  const client = clientFor([]);
  const pool = Array.from({ length: 251 }, (_, i) => ({ ...external, id: `external-${i}`, name: `New ${i}` }));
  const rows = await (await load())(client, lat, lon, pool);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((v) => v.kind === "overture"));
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].args.p_overture_candidates.length, 100);
  assert.equal(client.calls[1].args.p_external_ids.length, 100);
});
