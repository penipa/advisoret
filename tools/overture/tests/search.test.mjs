import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  normalizeOvertureSearchText,
  searchOverturePlaces,
} from "../../../src/lib/overture/search.ts";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/sample-search-index.json", import.meta.url), "utf8"),
);

const names = (records) => records.map(({ name }) => name);

test("normaliza Unicode, mayúsculas y espacios", () => {
  assert.equal(normalizeOvertureSearchText("  À  CÁFÉ   "), "a cafe");
});

test("cafe encuentra Café de l'Àvia", () => {
  assert.deepEqual(names(searchOverturePlaces(fixture, "cafe")), ["Café de l'Àvia"]);
});

test("todos los tokens pueden repartirse entre campos, pero son obligatorios", () => {
  assert.deepEqual(names(searchOverturePlaces(fixture, "cafe valencia")), ["Café de l'Àvia"]);
  assert.deepEqual(searchOverturePlaces(fixture, "cafe xativa"), []);
});

test("la búsqueda sin acento encuentra Xàtiva", () => {
  assert.deepEqual(names(searchOverturePlaces(fixture, "xativa")), ["La Plaça d'Anna"]);
});

test("permite buscar por nombre completo", () => {
  assert.deepEqual(names(searchOverturePlaces(fixture, "la plaça d'anna")), ["La Plaça d'Anna"]);
});

test("ignora mayúsculas y espacios repetidos en la query", () => {
  assert.deepEqual(names(searchOverturePlaces(fixture, "  CAFÉ   DE   L'ÀVIA  ")), ["Café de l'Àvia"]);
});

test("query vacía devuelve []", () => {
  assert.deepEqual(searchOverturePlaces(fixture, "   "), []);
});

test("limita resultados", () => {
  assert.equal(searchOverturePlaces(fixture, "a", { limit: 2 }).length, 2);
});

test("el orden es determinista y prioriza el nombre exacto", () => {
  const candidates = [
    { ...fixture[0], id: "z", name: "Cafe" },
    { ...fixture[0], id: "b", name: "Cafe Central" },
    { ...fixture[0], id: "a", name: "Cafe Central" },
  ];
  const first = searchOverturePlaces(candidates, "cafe");
  const second = searchOverturePlaces(candidates, "cafe");

  assert.deepEqual(first.map(({ id }) => id), ["z", "a", "b"]);
  assert.deepEqual(second, first);
});

test("la ciudad participa en la búsqueda", () => {
  assert.deepEqual(names(searchOverturePlaces(fixture, "valencia")), ["Café de l'Àvia"]);
});

test("el límite por defecto es 20 resultados", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({
    ...fixture[0],
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `Lugar ${index + 1}`,
    city: "Valencia",
    address: `Calle ${index + 1}`,
  }));

  assert.equal(searchOverturePlaces(candidates, "valencia").length, 20);
});

test("prioriza la coincidencia en nombre sobre ciudad y dirección", () => {
  const candidates = [
    { ...fixture[0], id: "00000000-0000-4000-8000-000000000101", name: "Valencia", city: "Alzira", address: "Calle Mayor" },
    { ...fixture[0], id: "00000000-0000-4000-8000-000000000102", name: "Mercat", city: "Valencia", address: "Calle Mayor" },
    { ...fixture[0], id: "00000000-0000-4000-8000-000000000103", name: "Forn", city: "Alzira", address: "Valencia" },
  ];

  assert.equal(searchOverturePlaces(candidates, "valencia")[0].name, "Valencia");
});

test("address null no rompe la búsqueda", () => {
  assert.deepEqual(names(searchOverturePlaces(fixture, "castello")), ["Esmorzars El Racó"]);
});

test("no modifica el input original", () => {
  const original = structuredClone(fixture);
  searchOverturePlaces(fixture, "cafe");
  assert.deepEqual(fixture, original);
});
