import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deduplicateOverturePlaces,
  loadInternalDeduplicationCandidates,
  normalizeVenueName,
  normalizeVenueText,
  venueNameSimilarity,
} from "../../../src/lib/overture/deduplicate.ts";
import { searchOverturePlaces } from "../../../src/lib/overture/search.ts";

const internal = {
  id: "390b32e6-7be9-4aea-aa53-da01458b7679",
  name: "Ca Mario", city: "Alfondeguilla",
  address_text: "Pl. de l'Ajuntament, 2B",
  lat: 39.8376443050948, lon: -0.26861508855148,
  cover_photo_path: "original/cover.jpg", avg_score: 4.775, ratings_count: 4,
};
const external = {
  id: "fa3298cc-8e1b-4ca6-84b9-5cb124577de0",
  name: "Ca Mario (Alfondeguilla)", city: "Alfondeguilla",
  address: "Plaça de l'Ajuntament, 2",
  lat: 39.83762814596327, lon: -0.268619520274177, primary: "pub",
};

test("Ca Mario a 1,84 m conserva exclusivamente la identidad Advisoret intacta", () => {
  const original = structuredClone(internal);
  const originals = Object.freeze([Object.freeze({ ...internal })]);
  const result = [...originals, ...deduplicateOverturePlaces([external], originals)];
  assert.equal(result.length, 1);
  assert.strictEqual(result[0], originals[0]);
  assert.deepEqual(result[0], original);
});

test("normaliza acentos, puntuación, mayúsculas y espacios", () => {
  assert.equal(normalizeVenueText("  CÀ,   MÁRIO!  "), "ca mario");
  assert.equal(normalizeVenueName(" CÀ MÁRIO (ALFONDEGUILLA) ", "Alfondeguilla"), "ca mario");
});

test("solo elimina paréntesis que identifican el municipio", () => {
  assert.equal(normalizeVenueName("Ca Mario (Terraza)", "Alfondeguilla"), "ca mario terraza");
  assert.equal(normalizeVenueName("Ca Mario (Moncada)", "Alfondeguilla"), "ca mario moncada");
  assert.equal(deduplicateOverturePlaces([{ ...external, name: "Ca Mario (Terraza)" }], [internal]).length, 1);
});

test("Les Cholines / Bar Las Cholinas a 8,21 m son similares pero con dirección incompatible", () => {
  const venue = { ...internal, name: "Les Cholines", address_text: "Plaça Castro, 1", lat: 39.8370519770003, lon: -0.269927089844922 };
  const record = { ...external, name: "Bar Las Cholinas", address: "C.A.P. de Alfondeguilla, Carrer Séquia, 18", lat: 39.83698004076797, lon: -0.2699486048358225 };
  assert.ok(venueNameSimilarity(venue.name, record.name) >= 0.8);
  assert.deepEqual(deduplicateOverturePlaces([record], [venue]), [record]);
});

test("variantes similares necesitan dirección completa coincidente y proximidad estricta", () => {
  const venue = { ...internal, name: "Les Cholines", address_text: "Plaça Castro, 1" };
  const record = { ...external, name: "Bar Las Cholinas", address: "Pl. Castro, 1" };
  assert.deepEqual(deduplicateOverturePlaces([record], [venue]), []);
  assert.equal(deduplicateOverturePlaces([{ ...record, address: null }], [venue]).length, 1);
  assert.equal(deduplicateOverturePlaces([{ ...record, lat: record.lat + 0.00015 }], [venue]).length, 1);
});

test("dos bares similares próximos con direcciones distintas siguen visibles", () => {
  const venue = { ...internal, name: "Bar Central", address_text: "Carrer Major, 1" };
  const record = { ...external, name: "Bar Centralet", address: "Carrer Major, 3" };
  assert.deepEqual(deduplicateOverturePlaces([record], [venue]), [record]);
});

test("la proximidad y dirección no bastan con nombres diferentes", () => {
  assert.equal(deduplicateOverturePlaces([{ ...external, name: "Casa Pepe" }], [internal]).length, 1);
});

test("identificadores ya materializados se excluyen incluso sin candidato interno", () => {
  assert.deepEqual(deduplicateOverturePlaces([external], [], new Set([external.id.toUpperCase()])), []);
});

test("un local sin equivalente conserva su objeto e ID para materializarse", () => {
  const record = Object.freeze({ ...external, name: "La Tasca Nueva" });
  const result = deduplicateOverturePlaces([record], [internal]);
  assert.strictEqual(result[0], record);
  assert.equal(result[0].id, external.id);
});

test("múltiples identidades internas compatibles impiden deduplicar", () => {
  assert.deepEqual(deduplicateOverturePlaces([external], [internal, { ...internal, id: "another-uuid" }]), [external]);
  assert.deepEqual(deduplicateOverturePlaces([external], [internal, internal]), []);
});

test("direcciones incompatibles, incluidos números y letras explícitas, impiden deduplicar", () => {
  for (const address of ["Plaça de l'Ajuntament, 3", "Plaça de l'Ajuntament, 2A", "Carrer Major, 2B", "Plaça de l'Ajuntament, 2B local 2"]) {
    assert.equal(deduplicateOverturePlaces([{ ...external, address }], [internal]).length, 1, address);
  }
});

test("direcciones normalizadas coincidentes admiten hasta 30 m con nombre exacto", () => {
  const record = { ...external, address: "PLAZA DE L AJUNTAMENT 2 B", lat: internal.lat + 0.0002 };
  assert.deepEqual(deduplicateOverturePlaces([record], [internal]), []);
  assert.equal(deduplicateOverturePlaces([{ ...record, lat: internal.lat + 0.0004 }], [internal]).length, 1);
});

test("sin dirección requiere nombre exacto distintivo a menos de 10 m", () => {
  assert.deepEqual(deduplicateOverturePlaces([{ ...external, address: null }], [internal]), []);
  assert.equal(deduplicateOverturePlaces([{ ...external, address: null, name: "Bar Central" }], [{ ...internal, name: "Bar Central" }]).length, 1);
  assert.equal(deduplicateOverturePlaces([{ ...external, address: null, lat: internal.lat + 0.0002 }], [internal]).length, 1);
});

test("municipios diferentes y coordenadas ausentes o inválidas no establecen identidad", () => {
  for (const changes of [{ city: "Moncada" }, { lat: null }, { lon: NaN }]) {
    assert.equal(deduplicateOverturePlaces([external], [{ ...internal, ...changes }]).length, 1);
  }
});

test("compara con candidatos internos fuera de los diez visibles", () => {
  const pool = Array.from({ length: 10 }, (_, i) => ({ ...internal, id: `other-${i}`, name: `Otro ${i}` })).concat(internal);
  assert.deepEqual(deduplicateOverturePlaces([external], pool), []);
});

test("Explore rellena diez resultados después de deduplicar sus candidatos", () => {
  const records = [external, ...Array.from({ length: 12 }, (_, i) => ({ ...external, id: `new-${i}`, name: `Nuevo ${i}` }))];
  const candidates = searchOverturePlaces(records, "Alfondeguilla", { limit: 100 });
  const visible = deduplicateOverturePlaces(candidates, [internal]).slice(0, 10);
  assert.equal(visible.length, 10);
  assert.ok(visible.every((v) => v.id !== external.id));
});

test("Explore carga todas las páginas internas antes de resolver coincidencias ambiguas", async () => {
  const first = Array.from({ length: 200 }, (_, i) => ({ ...internal, id: `other-${i}`, name: `Otro ${i}` }));
  first[0] = internal;
  const requests = [];
  const candidates = await loadInternalDeduplicationCandidates([external], async (bounds, from, to) => {
    requests.push([from, to]);
    assert.ok(bounds.minLat < internal.lat && bounds.maxLat > internal.lat);
    assert.ok(bounds.minLon < internal.lon && bounds.maxLon > internal.lon);
    return { data: from === 0 ? first : [{ ...internal, id: "ambiguous-second-page" }], error: null };
  });
  assert.deepEqual(requests, [[0, 199], [200, 399]]);
  assert.equal(candidates.length, 201);
  assert.equal(deduplicateOverturePlaces([external], candidates).length, 1);
});

test("una página fallida no permite deduplicar con información parcial", async () => {
  await assert.rejects(loadInternalDeduplicationCandidates([external], async () => ({ data: null, error: { message: "unavailable" } })), /unavailable/);
});

test("sin candidatos externos no consulta Supabase", async () => {
  assert.deepEqual(await loadInternalDeduplicationCandidates([], () => { throw new Error("unexpected read"); }), []);
});
