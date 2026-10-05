import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  arrayBufferToHex,
  isOvertureCacheMetadata,
  isSearchIndex,
  overtureMetadataMatchesManifest,
  versionedOvertureArtifactParts,
} from '../../../src/lib/overture/cache-contract.ts';

const searchIndex = JSON.parse(
  await readFile(new URL('../fixtures/sample-search-index.json', import.meta.url), 'utf8'),
);

const manifest = {
  provider: 'overture',
  release: '2026/09/23.1',
  schema_version: 'v2.0.0',
  pipeline_version: 'pipeline 1',
  region: 'comunitat_valenciana',
  record_count: 1,
  search_artifact: {
    path: 'unused',
    format: 'json',
    byte_size: 3,
    sha256: 'a'.repeat(64),
  },
};

const metadata = {
  release: manifest.release,
  schema_version: manifest.schema_version,
  pipeline_version: manifest.pipeline_version,
  region: manifest.region,
  sha256: manifest.search_artifact.sha256,
  byte_size: manifest.search_artifact.byte_size,
  local_uri: 'file:///documents/search-index.json',
  downloaded_at: '2026-10-05T00:00:00.000Z',
};

test('genera una identidad de artefacto determinista y segura por versión', () => {
  assert.deepEqual(versionedOvertureArtifactParts(manifest), [
    '2026%2F09%2F23.1',
    'pipeline%201',
    'comunitat_valenciana',
  ]);
});

test('valida metadata y la ata al manifest completo', () => {
  assert.equal(isOvertureCacheMetadata(metadata), true);
  assert.equal(isOvertureCacheMetadata({ ...metadata, byte_size: 0 }), false);
  assert.equal(overtureMetadataMatchesManifest(metadata, manifest), true);
  assert.equal(
    overtureMetadataMatchesManifest({ ...metadata, region: 'otro' }, manifest),
    false,
  );
});

test('convierte bytes a SHA hexadecimal lowercase', () => {
  assert.equal(arrayBufferToHex(Uint8Array.from([0, 15, 255]).buffer), '000fff');
});

test('valida un search index fixture', () => {
  assert.equal(isSearchIndex(searchIndex), true);
});

test('rechaza un valor que no es array', () => {
  assert.equal(isSearchIndex({}), false);
});

test('rechaza un registro sin name', () => {
  const invalid = searchIndex.map((record, index) => index === 0
    ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'name'))
    : record);
  assert.equal(isSearchIndex(invalid), false);
});

test('rechaza un UUID inválido', () => {
  assert.equal(isSearchIndex([{ ...searchIndex[0], id: 'not-a-uuid' }, ...searchIndex.slice(1)]), false);
});

test('rechaza IDs duplicados', () => {
  assert.equal(isSearchIndex([searchIndex[0], { ...searchIndex[1], id: searchIndex[0].id }]), false);
});

test('rechaza latitudes fuera de rango', () => {
  assert.equal(isSearchIndex([{ ...searchIndex[0], lat: 90.1 }, ...searchIndex.slice(1)]), false);
});

test('acepta address null', () => {
  assert.equal(isSearchIndex(searchIndex), true);
});

test('rechaza claves extra', () => {
  assert.equal(isSearchIndex([{ ...searchIndex[0], extra: true }, ...searchIndex.slice(1)]), false);
});
