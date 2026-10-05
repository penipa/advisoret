import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const fixturesDirectory = fileURLToPath(new URL('../fixtures/', import.meta.url));
const manifestPath = path.join(fixturesDirectory, 'sample-manifest.json');
const searchIndexPath = path.join(fixturesDirectory, 'sample-search-index.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8'));
assert.ok(Array.isArray(searchIndex));

const allowedRecordKeys = ['address', 'city', 'id', 'lat', 'lon', 'name', 'primary'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shardForGersId(id) {
  assert.equal(typeof id, 'string');
  const normalizedId = id.toLowerCase();

  assert.match(normalizedId, uuidPattern);
  return normalizedId.slice(0, 2);
}

test('valida el contrato de los artefactos Overture', () => {
  assert.equal(manifest.provider, 'overture');
  assert.equal(typeof manifest.release, 'string');
  assert.notEqual(manifest.release, '');
  assert.equal(typeof manifest.schema_version, 'string');
  assert.notEqual(manifest.schema_version, '');
  assert.equal(typeof manifest.pipeline_version, 'string');
  assert.notEqual(manifest.pipeline_version, '');
  assert.equal(typeof manifest.region, 'string');
  assert.notEqual(manifest.region, '');
  assert.ok(Number.isInteger(manifest.record_count));
  assert.ok(manifest.record_count > 0);
  assert.equal(manifest.record_count, searchIndex.length);

  const searchArtifact = manifest.search_artifact;
  assert.equal(searchArtifact.format, 'json');
  assert.equal(typeof searchArtifact.path, 'string');
  assert.ok(!path.isAbsolute(searchArtifact.path));
  assert.doesNotMatch(searchArtifact.path, /^[a-z][a-z\d+.-]*:/i);
  const expectedSearchArtifactPath = [
    'releases',
    manifest.release,
    manifest.pipeline_version,
    manifest.region,
    'search-index.json',
  ].join('/');
  assert.equal(searchArtifact.path, expectedSearchArtifactPath);

  const searchIndexBytes = fs.readFileSync(searchIndexPath);
  const searchIndexSha256 = crypto
    .createHash('sha256')
    .update(searchIndexBytes)
    .digest('hex');

  assert.equal(searchArtifact.byte_size, searchIndexBytes.byteLength);
  assert.equal(searchArtifact.sha256, searchIndexSha256);
  assert.match(searchArtifact.sha256, /^[0-9a-f]{64}$/);
});

test('valida todos los registros del search index', () => {
  const ids = new Set();

  for (const record of searchIndex) {
    assert.equal(typeof record, 'object');
    assert.notEqual(record, null);
    assert.ok(!Array.isArray(record));
    assert.deepEqual(Object.keys(record).sort(), allowedRecordKeys);

    assert.equal(typeof record.id, 'string');
    assert.notEqual(record.id, '');
    assert.match(record.id, uuidPattern);
    assert.equal(record.id, record.id.toLowerCase());
    assert.ok(!ids.has(record.id));
    ids.add(record.id);

    assert.equal(typeof record.name, 'string');
    assert.notEqual(record.name, '');
    assert.equal(typeof record.city, 'string');
    assert.notEqual(record.city, '');
    assert.ok(typeof record.address === 'string' || record.address === null);
    assert.equal(typeof record.lat, 'number');
    assert.ok(Number.isFinite(record.lat));
    assert.ok(record.lat >= -90 && record.lat <= 90);
    assert.equal(typeof record.lon, 'number');
    assert.ok(Number.isFinite(record.lon));
    assert.ok(record.lon >= -180 && record.lon <= 180);
    assert.ok(typeof record.primary === 'string' || record.primary === null);
  }

  assert.equal(ids.size, searchIndex.length);
});

test('calcula el shard esperado para los cuatro Gers IDs', () => {
  const expectedShards = ['0a', '3f', 'b7', 'e2'];

  assert.deepEqual(
    searchIndex.map((record) => shardForGersId(record.id)),
    expectedShards,
  );
});
