import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Optional local PostgreSQL engine. See backend-materialize.md; never connects
// to Supabase, reads .env, or uses production credentials.
const engine = process.env.ADVISORET_PGLITE_MODULE;
test("materialization RPC against ephemeral PostgreSQL", {
  skip: engine ? false : "Set ADVISORET_PGLITE_MODULE to a local PGlite module (see backend-materialize.md)",
}, async (t) => {
  const { PGlite } = await import(engine);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit integer);
    CREATE TABLE public.venues (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, city text, address_text text,
      lat double precision, lon double precision, status text, source text, source_id text,
      cover_photo_path text, created_at timestamptz DEFAULT now(), historical_data jsonb
    );
    CREATE TABLE public.ratings (
      venue_id uuid REFERENCES public.venues(id), score numeric
    );
  `);
  for (const migration of [
    "20261011171000_overture_places_backend.sql",
    "20261104120000_materialize_venue_identity_guard.sql",
  ]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
  t.beforeEach(() => db.exec("TRUNCATE public.venues, public.venue_external_refs, public.ratings"));

  const mario = {
    name: "Ca Mario", city: "Alfondeguilla", address: "Pl. de l'Ajuntament, 2B",
    lat: 39.8376443050948, lon: -0.26861508855148,
  };
  const overtureMario = {
    ...mario, name: "Ca Mario (Alfondeguilla)", address: "Plaça de l'Ajuntament, 2",
    lat: 39.83762814596327, lon: -0.268619520274177,
  };
  async function insert(venue) {
    const result = await db.query(`INSERT INTO public.venues
      (name,city,address_text,lat,lon,status,cover_photo_path,historical_data)
      VALUES ($1,$2,$3,$4,$5,'active','original/cover.jpg','{"unchanged":true}') RETURNING id`,
    [venue.name, venue.city, venue.address, venue.lat, venue.lon]);
    return result.rows[0].id;
  }
  async function materialize(venue, externalId = "external-1") {
    const result = await db.query(`SELECT public.materialize_external_venue_v1(
      'overture',$1,'2026-09-23.1','pilot-1',$2,$3,$4,$5,$6) AS id`,
    [externalId, venue.name, venue.city, venue.address, venue.lat, venue.lon]);
    return result.rows[0].id;
  }
  async function counts() {
    return (await db.query(`SELECT (SELECT count(*)::int FROM venues) AS venues,
      (SELECT count(*)::int FROM venue_external_refs) AS refs`)).rows[0];
  }
  async function assertAmbiguous(venue) {
    const before = await counts();
    await assert.rejects(materialize(venue), (error) => error.code === "PAV01" && error.message === "venue_match_ambiguous");
    assert.deepEqual(await counts(), before);
  }

  await t.test("Ca Mario reuses UUID, creates only the alias and preserves all history", async () => {
    const id = await insert(mario);
    await db.query("INSERT INTO ratings VALUES ($1,4.7),($1,4.8),($1,4.8),($1,4.8)", [id]);
    const before = await db.query("SELECT * FROM venues WHERE id=$1", [id]);
    const ratings = await db.query("SELECT * FROM ratings WHERE venue_id=$1", [id]);
    assert.equal(await materialize(overtureMario), id);
    assert.deepEqual(await db.query("SELECT * FROM venues WHERE id=$1", [id]), before);
    assert.deepEqual(await db.query("SELECT * FROM ratings WHERE venue_id=$1", [id]), ratings);
    assert.deepEqual(await counts(), { venues: 1, refs: 1 });
    assert.equal((await db.query("SELECT venue_id FROM venue_external_refs")).rows[0].venue_id, id);
  });

  await t.test("Les Cholines / Bar Las Cholinas blocks creation without linking incompatible addresses", async () => {
    await insert({ ...mario, name: "Les Cholines", address: "Plaça Castro, 1", lat: 39.8370519770003, lon: -0.269927089844922 });
    await assertAmbiguous({ ...overtureMario, name: "Bar Las Cholinas", address: "C.A.P. de Alfondeguilla, Carrer Séquia, 18", lat: 39.83698004076797, lon: -0.2699486048358225 });
  });

  await t.test("unequivocal normalized name/address and nearby coordinates reuse the existing venue", async () => {
    const venue = { ...mario, name: "CAFÉ L'ÀVIA", city: "València", address: "Carrer Major, 10 B" };
    const id = await insert(venue);
    assert.equal(await materialize({ ...venue, name: "Café L Avia (VALENCIA)", city: "Valencia", address: "C. Major, 10B", lat: venue.lat + 0.0002 }), id);
  });

  await t.test("different nearby establishments, even similar names, receive distinct UUIDs", async () => {
    const id = await insert({ ...mario, name: "Bar Central", address: "Carrer Major, 1" });
    const other = await materialize({ ...overtureMario, name: "Bar Centralet", address: "Carrer Major, 3" });
    assert.notEqual(other, id);
    assert.deepEqual(await counts(), { venues: 2, refs: 1 });
  });

  await t.test("no equivalent creates a new venue and an external reference atomically", async () => {
    const id = await materialize(overtureMario);
    assert.equal((await db.query("SELECT name FROM venues WHERE id=$1", [id])).rows[0].name, overtureMario.name);
    assert.deepEqual(await counts(), { venues: 1, refs: 1 });
  });

  await t.test("an alias insertion failure rolls back the new venue too", async () => {
    await db.exec(`CREATE FUNCTION public.reject_test_alias() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated alias failure'; END; $$;
      CREATE TRIGGER reject_test_alias BEFORE INSERT ON venue_external_refs
      FOR EACH ROW EXECUTE FUNCTION public.reject_test_alias();`);
    try {
      await assert.rejects(materialize(overtureMario), /simulated alias failure/);
      assert.deepEqual(await counts(), { venues: 0, refs: 0 });
    } finally {
      await db.exec("DROP TRIGGER reject_test_alias ON venue_external_refs; DROP FUNCTION public.reject_test_alias()");
    }
  });

  await t.test("repeated materialization is idempotent even when the source snapshot changes", async () => {
    const id = await materialize(overtureMario);
    const before = await db.query("SELECT * FROM venues");
    assert.equal(await materialize({ ...overtureMario, name: "Source renamed", lat: 40 }), id);
    assert.deepEqual(await db.query("SELECT * FROM venues"), before);
    assert.deepEqual(await counts(), { venues: 1, refs: 1 });
  });

  await t.test("an authoritative existing reference wins even if a similar historical venue exists", async () => {
    const id = await materialize(overtureMario);
    await insert(mario);
    assert.equal(await materialize(overtureMario), id);
    assert.deepEqual(await counts(), { venues: 2, refs: 1 });
  });

  await t.test("different external IDs for one physical venue reuse its canonical UUID", async () => {
    const id = await materialize(overtureMario, "external-1");
    assert.equal(await materialize(overtureMario, "external-2"), id);
    assert.deepEqual(await counts(), { venues: 1, refs: 2 });
  });

  await t.test("simultaneous calls with the same ID remain idempotent (single-session engine)", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => materialize(overtureMario)));
    assert.equal(new Set(ids).size, 1);
    assert.deepEqual(await counts(), { venues: 1, refs: 1 });
  });

  await t.test("simultaneous calls with different IDs resolve one venue (single-session engine)", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, (_, i) => materialize(overtureMario, `external-${i}`)));
    assert.equal(new Set(ids).size, 1);
    assert.deepEqual(await counts(), { venues: 1, refs: 5 });
  });

  await t.test("two possible internal identities block even if one is a strong match", async () => {
    await insert(mario);
    await insert({ ...mario, address: "Plaça de l'Ajuntament, 3" });
    await assertAmbiguous(overtureMario);
  });

  await t.test("an exact name with conflicting explicit unit letters never merges", async () => {
    await insert(mario);
    await assertAmbiguous({ ...overtureMario, address: "Plaça de l'Ajuntament, 2A" });
  });

  await t.test("missing addresses and a fuzzy/generic name require review", async () => {
    await insert({ ...mario, name: "Bar Central", address: null });
    await assertAmbiguous({ ...overtureMario, name: "Bar Central", address: null });
  });

  await t.test("missing addresses allow only a unique exact distinctive name within 10 m", async () => {
    const id = await insert({ ...mario, address: null });
    assert.equal(await materialize({ ...overtureMario, address: null }), id);
  });

  await t.test("a possible identity 40 m away is blocked, beyond 50 m it is distinct", async () => {
    const id = await insert(mario);
    await assertAmbiguous({ ...overtureMario, lat: mario.lat + 0.00036 });
    assert.notEqual(await materialize({ ...overtureMario, lat: mario.lat + 0.0006 }), id);
  });

  await t.test("different municipalities do not establish equivalence", async () => {
    const id = await insert(mario);
    assert.notEqual(await materialize({ ...overtureMario, city: "Moncada" }), id);
  });

  await t.test("invalid coordinates are rejected without writing", async () => {
    for (const lat of [NaN, Infinity, 91, null]) {
      await assert.rejects(materialize({ ...overtureMario, lat }));
      assert.deepEqual(await counts(), { venues: 0, refs: 0 });
    }
  });

  await t.test("non read-committed isolation fails safely rather than using a stale snapshot", async () => {
    await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await assert.rejects(materialize(overtureMario), (error) => error.code === "40001");
    } finally { await db.exec("ROLLBACK"); }
    assert.deepEqual(await counts(), { venues: 0, refs: 0 });
  });

  await t.test("RPC and matching helpers remain inaccessible to mobile roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query(`SELECT bool_or(has_function_privilege($1, p.oid, 'EXECUTE')) AS allowed
        FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
        WHERE n.nspname='public' AND (p.proname LIKE 'venue_identity_%' OR p.proname='materialize_external_venue_v1')`, [role]);
      assert.equal(result.rows[0].allowed, false);
    }
  });

  await t.test("service_role can execute the guarded RPC without direct fixture table grants", async () => {
    const id = await insert(mario);
    await db.exec("SET ROLE service_role");
    try {
      assert.equal(await materialize(overtureMario), id);
    } finally { await db.exec("RESET ROLE"); }
    assert.deepEqual(await counts(), { venues: 1, refs: 1 });
  });
});
