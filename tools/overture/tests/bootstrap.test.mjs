import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mock, test } from 'node:test';

const execFileAsync = promisify(execFile);
const cacheModule = new URL('../../../src/lib/overture/cache.ts', import.meta.url).href;
const supabaseModule = new URL('../../../src/lib/supabase.ts', import.meta.url).href;
const expectedManifestPath = 'releases/2026-09-23.1/advisoret-overture-pilot-1/comunitat_valenciana/manifest.json';
const expectedSearchIndexPath = 'releases/2026-09-23.1/advisoret-overture-pilot-1/comunitat_valenciana/search-index.json';
const records = [{
  address: null,
  city: 'Valencia',
  id: '123e4567-e89b-12d3-a456-426614174000',
  lat: 39.4699,
  lon: -0.3763,
  name: 'Lugar',
  primary: null,
}];
const manifest = {
  provider: 'overture',
  release: '2026-09-23.1',
  schema_version: 'v2.0.0',
  pipeline_version: 'advisoret-overture-pilot-1',
  region: 'comunitat_valenciana',
  record_count: 1,
  search_artifact: {
    path: expectedSearchIndexPath,
    format: 'json',
    byte_size: 1,
    sha256: 'a'.repeat(64),
  },
};

test('flag OFF no importa caché/supabase ni hace fetch', async () => {
  const script = [
    "let calls = 0;",
    "globalThis.fetch = async () => { calls += 1; throw new Error('fetch must not run'); };",
    "const { loadOvertureSearchIndex } = await import('./src/lib/overture/bootstrap.ts');",
    "const result = await loadOvertureSearchIndex();",
    "if (result !== null || calls !== 0) process.exit(1);",
  ].join(' ');

  await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, EXPO_PUBLIC_OVERTURE_PLACES_ENABLED: '' },
  });
});

test('manifest válido usa paths esperados y devuelve el índice cacheado', async () => {
  process.env.EXPO_PUBLIC_OVERTURE_PLACES_ENABLED = 'true';
  const urls = new Map([
    [expectedManifestPath, `https://storage.test/${expectedManifestPath}`],
    [expectedSearchIndexPath, `https://storage.test/${expectedSearchIndexPath}`],
  ]);
  const requestedPaths = [];
  let ensured;

  mock.module(cacheModule, {
    exports: {
      ensureOvertureSearchArtifact: async (value, url) => {
        ensured = { value, url };
        return { local_uri: 'file:///cached/search-index.json', metadata: {} };
      },
      readCachedOvertureSearchIndex: async () => records,
    },
  });
  mock.module(supabaseModule, {
    exports: {
      storagePublicUrl: (bucket, path) => {
        assert.equal(bucket, 'overture-public');
        requestedPaths.push(path);
        return urls.get(path) ?? null;
      },
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, urls.get(expectedManifestPath));
    return { ok: true, json: async () => manifest };
  };

  try {
    const { loadOvertureSearchIndex } = await import('../../../src/lib/overture/bootstrap.ts');
    assert.deepEqual(await loadOvertureSearchIndex(), records);
    assert.deepEqual(requestedPaths, [expectedManifestPath, expectedSearchIndexPath]);
    assert.equal(ensured.url, urls.get(expectedSearchIndexPath));
    assert.deepEqual(ensured.value, manifest);
  } finally {
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

for (const [name, change] of [
  ['release incorrecto', { release: 'other' }],
  ['pipeline incorrecto', { pipeline_version: 'other' }],
  ['region incorrecta', { region: 'other' }],
]) {
  test(`manifest con ${name} devuelve null`, async () => {
    process.env.EXPO_PUBLIC_OVERTURE_PLACES_ENABLED = 'true';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...manifest, ...change }) });
    mock.module(cacheModule, { exports: { ensureOvertureSearchArtifact: async () => { throw new Error('no debe cachear'); }, readCachedOvertureSearchIndex: async () => records } });
    mock.module(supabaseModule, { exports: { storagePublicUrl: (bucket, path) => `https://storage.test/${path}` } });

    try {
      const { loadOvertureSearchIndex } = await import('../../../src/lib/overture/bootstrap.ts');
      assert.equal(await loadOvertureSearchIndex(), null);
    } finally {
      globalThis.fetch = originalFetch;
      mock.restoreAll();
    }
  });
}

test('manifest con search_artifact.path inesperado devuelve null', async () => {
  process.env.EXPO_PUBLIC_OVERTURE_PLACES_ENABLED = 'true';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    ...manifest,
    search_artifact: { ...manifest.search_artifact, path: 'arbitrary.json' },
  }) });
  mock.module(cacheModule, { exports: { ensureOvertureSearchArtifact: async () => { throw new Error('no debe cachear'); }, readCachedOvertureSearchIndex: async () => records } });
  mock.module(supabaseModule, { exports: { storagePublicUrl: (bucket, path) => `https://storage.test/${path}` } });

  try {
    const { loadOvertureSearchIndex } = await import('../../../src/lib/overture/bootstrap.ts');
    assert.equal(await loadOvertureSearchIndex(), null);
  } finally {
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

test('error HTTP o JSON inválido devuelve null', async (t) => {
  process.env.EXPO_PUBLIC_OVERTURE_PLACES_ENABLED = 'true';
  mock.module(cacheModule, { exports: { ensureOvertureSearchArtifact: async () => { throw new Error('no debe cachear'); }, readCachedOvertureSearchIndex: async () => records } });
  mock.module(supabaseModule, { exports: { storagePublicUrl: (bucket, path) => `https://storage.test/${path}` } });
  const originalFetch = globalThis.fetch;

  for (const response of [{ ok: false }, { ok: true, json: async () => { throw new SyntaxError('invalid json'); } }]) {
    globalThis.fetch = async () => response;
    const { loadOvertureSearchIndex } = await import('../../../src/lib/overture/bootstrap.ts?case=' + t.name);
    assert.equal(await loadOvertureSearchIndex(), null);
  }

  globalThis.fetch = originalFetch;
  mock.restoreAll();
});
