Local nearby regression and performance tests
===========================================

Client tests (Node 24+, no network, environment files or Supabase credentials):

```sh
node --experimental-vm-modules --experimental-test-module-mocks --test \
  tools/overture/tests/nearby.test.mjs \
  tools/overture/tests/deduplicate.test.mjs \
  tools/overture/tests/materialize.test.mjs
```

Real PostgreSQL tests require the already available Python `psycopg` module and
the tables retained by the previous local materialization validation. No test
installs dependencies. The target is hardcoded to `127.0.0.1:5432/advisoret_test`;
the server-reported address, database and port are checked before any mutation.

```sh
python3 tools/overture/tests/nearby-postgres.py --local-advisoret-test
```

The test refuses to replace an existing `vw_venues_with_coords`. It creates a
representative security-invoker view and SELECT policy locally, then applies the
actual new migration twice. Fixtures, missing NOLOGIN roles, grants, policies and
the RPC all live in one transaction; a final ROLLBACK restores the initial state.
Existing roles are not altered. The materialization identity guard is not changed.

Cases include 251 venues with the nearest inserted last, complete identity
evidence beyond 200 and 1000 rows, candidates outside the display ten, caller RLS,
missing table/view grants, invalid arguments, dateline/pole proximity, historical
data preservation and execution in a READ ONLY transaction.

The performance fixture has 100,000 venues and is queried with zero and 100 external
coordinates, five times each as `authenticated`. The JSON report at
`/private/tmp/advisoret-nearby-postgres-results.json` contains timings, response
sizes and EXPLAIN (ANALYZE, BUFFERS) for the exact query inside the RPC. Explaining
only a PL/pgSQL function call would hide that inner plan. The latency samples
include PL/pgSQL validation and JSON serialization; the inner EXPLAIN does not.

Production prerequisites
------------------------

The repository does not contain the definition of `vw_venues_with_coords` or
the original venue SELECT grants/RLS. Before rollout, inspect those definitions
in an authorized staging environment. This migration deliberately uses the same
view under SECURITY INVOKER, preserving the caller's existing visibility without
granting access to tables or replacing the view. It inherits any existing view
owner/security behavior; it cannot repair that behavior.

The exact global nearest-ten query uses a top-N sort over visible coordinates;
without a known spatial index it remains O(N) on the server. Latitude bands allow
hashing identity lookups instead of comparing each venue with every external
point; box and spherical filters retain all relevant candidates within 30 m.
Identity evidence is returned as one JSON array, so PostgREST's row response cap
cannot silently truncate it. Dense areas can still produce a large identity array.

The app requires this RPC to exist before release, including with the Overture
flag off. It does not fall back to the incorrect 200-row query. No production
migration/deployment is performed by these commands.
