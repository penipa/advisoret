Local materialization regression tests
======================================

Requires Node 24+. The SQL tests run the historical migration and the new guard
against a fresh, in-memory PostgreSQL database using PGlite. The minimal fixture
schema is local to the tests. They do not load `.env` or connect to Supabase.

Install the optional test engine outside the repository:

```sh
npm install --prefix /private/tmp/advisoret-backend-tests --no-save --package-lock=false @electric-sql/pglite
```

Run all Overture tests, including the SQL tests:

```sh
ADVISORET_PGLITE_MODULE=/private/tmp/advisoret-backend-tests/node_modules/@electric-sql/pglite/dist/index.js \
  node --experimental-vm-modules --experimental-test-module-mocks --test tools/overture/tests/*.test.mjs
```

Without `ADVISORET_PGLITE_MODULE`, the SQL integration group is explicitly skipped.
The Edge Function and client tests execute the actual TypeScript modules with
isolated SDK/service boundaries and require no external services.

The guard keeps the existing UUID return contract. SQLSTATE `PAV01` means identity
is ambiguous: the entire statement is rolled back and no venue or alias is
created. The Edge Function maps this to HTTP 409 with
`{"code":"venue_match_ambiguous","error":"..."}` and no `venue_id`.
The client throws `OvertureMatchAmbiguousError`; both entry points show a message
and do not navigate, retry creation, or choose an arbitrary candidate.

Concurrency and rollout checks
------------------------------

The RPC takes a transaction-level global advisory lock before reading aliases or
scanning candidates. This deliberately serializes all materializations, including
different external IDs/providers for the same physical place. A transaction at
an isolation level other than READ COMMITTED is rejected with `40001`, avoiding
resolution against a stale snapshot. Existing candidate rows are locked while
checking them; alias uniqueness and venue/alias creation share one transaction.

PGlite uses one database session. The Promise.all tests cover simultaneous callers
and idempotence, but cannot prove blocking/visibility across independent PostgreSQL
connections. Before deployment, run the new migration on a disposable Supabase
or PostgreSQL staging database matching production and verify with two connections:

1. Connection A: BEGIN; materialize a new test record and leave the transaction open.
2. Connection B: materialize the same record. It must wait until A commits and then
   return the same UUID, with one venue and one external reference.
3. Repeat with a different external ID and slightly shifted coordinates inside
   the matching radius. Expect one venue and two aliases after commit.
4. Repeat rolling A back: B must create exactly one venue and its own alias.
5. Confirm the existing grants/RLS, RPC latency, and 409 handling in the mobile app.

Manual/admin inserts that do not call this RPC do not acquire its advisory lock;
they are outside its concurrency guarantee. Existing aliases remain authoritative
and are not repaired or reassigned. Missing coordinates, municipality aliases,
or source errors beyond the conservative radii can still evade detection.
The global lock trades throughput for simplicity and safety. No production
migration, Edge deployment or application build is performed by these tests.
