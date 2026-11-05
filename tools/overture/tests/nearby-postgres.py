"""Explicit local-only integration/performance test; psycopg must already be available.

Run: python3 tools/overture/tests/nearby-postgres.py --local-advisoret-test
Creates fixtures/roles/function inside ONE transaction and rolls everything back.
Never reads .env or connects to any other database/server.
"""
import argparse
import getpass
import hashlib
import json
from pathlib import Path
import statistics
import time
import psycopg

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--local-advisoret-test', required=True, action='store_true')
parser.parse_args()
root = Path(__file__).resolve().parents[3]
migration = root / 'supabase/migrations/20261104130000_nearby_venues_read_rpc.sql'
guard = root / 'supabase/migrations/20261104120000_materialize_venue_identity_guard.sql'
guard_hash = hashlib.sha256(guard.read_bytes()).hexdigest()
sql = migration.read_text()
report = {'tests': [], 'performance': []}
lat, lon = 39.8376443050948, -0.26861508855148
uid = '390b32e6-7be9-4aea-aa53-da01458b7679'
rpc_sql = 'SELECT public.get_nearby_venues_v1(%s,%s,%s::jsonb)'
c = psycopg.connect(host='127.0.0.1', port=5432, dbname='advisoret_test', user=getpass.getuser(), connect_timeout=5, autocommit=True)
assert c.execute('SELECT current_database(),host(inet_server_addr()),inet_server_port()').fetchone() == ('advisoret_test', '127.0.0.1', 5432)
report['server'] = c.execute('SELECT version()').fetchone()[0]
initial_roles = c.execute("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY rolname").fetchall()
initial_counts = c.execute('SELECT (SELECT count(*) FROM venues),(SELECT count(*) FROM ratings),(SELECT count(*) FROM venue_external_refs)').fetchone()

def check(name, action):
    action()
    report['tests'].append(name)
    print('PASS:', name, flush=True)

def rpc(points=None, user_lat=lat, user_lon=lon):
    return c.execute(rpc_sql, (user_lat, user_lon, json.dumps(points or []))).fetchone()[0]

def expect_error(code, action):
    c.execute('SAVEPOINT expected_error')
    try:
        action()
    except psycopg.Error as e:
        assert e.sqlstate == code, (e.sqlstate, str(e))
    else:
        raise AssertionError('Expected SQLSTATE '+code)
    finally:
        c.execute('ROLLBACK TO SAVEPOINT expected_error')
        c.execute('RELEASE SAVEPOINT expected_error')

try:
    c.execute('BEGIN')
    assert c.execute("SELECT to_regclass('public.vw_venues_with_coords')").fetchone()[0] is None, 'Existing view: inspect its definition before using this fixture test'
    for role in ('anon', 'authenticated', 'service_role'):
        if not c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', (role,)).fetchone():
            c.execute('CREATE ROLE '+role+' NOLOGIN')
    # Existing test tables were created by the earlier local materialization validation.
    # All mutations below are rolled back, including TRUNCATE and grants/policies.
    c.execute('TRUNCATE public.venue_external_refs, public.ratings, public.venues')
    c.execute('''CREATE VIEW public.vw_venues_with_coords WITH (security_invoker=true) AS
        SELECT id,name,city,address_text,cover_photo_path,lat,lon FROM public.venues;
        GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
        GRANT SELECT ON public.vw_venues_with_coords, public.venues TO anon,authenticated;
        CREATE POLICY nearby_test_read ON public.venues FOR SELECT TO anon,authenticated USING(status='active');''')
    c.execute(sql)
    c.execute(sql)  # Reapplying must preserve the contract and grants.

    c.execute("""INSERT INTO venues(name,city,lat,lon,status)
        SELECT 'Far '||i,'Alfondeguilla',40.8,-0.2686,'active' FROM generate_series(1,250) i""")
    c.execute("""INSERT INTO venues(id,name,city,address_text,cover_photo_path,lat,lon,status,historical_data)
        VALUES(%s,'Ca Mario','Alfondeguilla','Pl. de l''Ajuntament, 2B','original/cover.jpg',%s,%s,'active','{"kept":true}')""", (uid,lat,lon))
    c.execute("INSERT INTO ratings(venue_id,score,historical_data) VALUES(%s,4.775,'{\"kept\":true}')", (uid,))
    before = c.execute('SELECT * FROM venues ORDER BY id').fetchall(), c.execute('SELECT * FROM ratings ORDER BY id').fetchall()
    def regression():
        assert c.execute('SELECT count(*) FROM venues').fetchone()[0] == 251
        r = rpc([dict(lat=lat,lon=lon)])
        assert len(r['nearby']) == 10 and r['nearby'][0]['id'] == uid
        assert r['nearby'][0]['distance_km'] == 0
        assert r['nearby'][0]['cover_photo_path'] == 'original/cover.jpg'
        assert [v['id'] for v in r['identity_candidates']] == [uid]
        assert before == (c.execute('SELECT * FROM venues ORDER BY id').fetchall(), c.execute('SELECT * FROM ratings ORDER BY id').fetchall())
    check('251 rows: last-inserted nearest UUID, photo, review and history preserved', regression)

    def permissions():
        c.execute("INSERT INTO venues(name,city,lat,lon,status) VALUES('Hidden','Alfondeguilla',%s,%s,'hidden')", (lat,lon))
        for role in ('anon','authenticated'):
            c.execute('SET LOCAL ROLE '+role)
            try:
                r = rpc([dict(lat=lat,lon=lon)])
                assert all(v['name'] != 'Hidden' for group in r.values() for v in group)
                assert r['nearby'][0]['id'] == uid
            finally:
                c.execute('RESET ROLE')
        c.execute('SET LOCAL ROLE service_role')
        try:
            expect_error('42501', lambda: rpc())  # EXECUTE alone cannot bypass missing view/table access.
        finally:
            c.execute('RESET ROLE')
        definition = c.execute("SELECT provolatile,prosecdef,proacl::text FROM pg_proc WHERE oid='public.get_nearby_venues_v1(double precision,double precision,jsonb)'::regprocedure").fetchone()
        assert definition[0:2] == ('s',False)
        assert c.execute("SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid='public.get_nearby_venues_v1(double precision,double precision,jsonb)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'").fetchone()[0] == 0
        c.execute("DELETE FROM venues WHERE name='Hidden'")
    check('SECURITY INVOKER, STABLE, no PUBLIC execute; caller RLS and view/table grants respected', permissions)

    def invalid():
        for invalid_lat, invalid_lon in [(None,lon),(91,lon),(lat,181),(float('nan'),lon),(lat,float('inf'))]:
            expect_error('22023', lambda: c.execute(rpc_sql,(invalid_lat,invalid_lon,'[]')))
        for points in [None, {}, [dict(lat=lat)], [dict(lat='NaN',lon=lon)], [dict(lat=91,lon=lon)], [dict(lat=lat,lon=lon)]*101]:
            expect_error('22023',lambda: c.execute(rpc_sql,(lat,lon,json.dumps(points))))
    check('invalid coordinates, malformed payloads and more than 100 candidates rejected', invalid)

    def complete():
        c.execute("""INSERT INTO venues(name,city,address_text,lat,lon,status)
            SELECT 'Candidate '||i,'Alfondeguilla','Calle 1',%s,%s,'active' FROM generate_series(1,1200) i""",(lat+0.00005,lon))
        r = rpc([dict(lat=lat,lon=lon)])
        assert len(r['identity_candidates']) == 1201
        assert len(r['nearby']) == 10
        assert len(rpc()['identity_candidates']) == 0
    check('complete identity evidence beyond 200 and 1000 rows; no Overture means no identity rows', complete)

    def outside_display():
        # Ten closer, unrelated identities cannot hide an eleventh matching one
        # from the separate identity evidence used by the client.
        point = dict(lat=41.1,lon=0.5)
        c.execute("INSERT INTO venues(name,city,lat,lon,status) SELECT 'Closer '||i,'Test',41.1,0.5,'active' FROM generate_series(1,10) i")
        outside = c.execute("INSERT INTO venues(name,city,lat,lon,status) VALUES('Outside ten','Test',41.1001,0.5,'active') RETURNING id").fetchone()[0]
        r = rpc([point],point['lat'],point['lon'])
        assert str(outside) not in {v['id'] for v in r['nearby']}
        assert str(outside) in {v['id'] for v in r['identity_candidates']}
    check('identity candidates include an equivalent venue outside the nearest ten', outside_display)

    def boundaries():
        # Great-circle proximity wraps longitude and works at the poles.
        c.execute("INSERT INTO venues(name,city,lat,lon,status) VALUES('Dateline','Test',0,-179.99999,'active'),('Pole','Test',90,120,'active'),('Invalid','Test',NULL,NULL,'active')")
        for point, name in [(dict(lat=0,lon=179.99999),'Dateline'),(dict(lat=90,lon=-30),'Pole')]:
            r = rpc([point],point['lat'],point['lon'])
            assert r['nearby'][0]['name'] == name
            assert any(v['name']==name for v in r['identity_candidates'])
    check('distance ordering, dateline, polar bounds and NULL coordinates', boundaries)

    c.execute('TRUNCATE public.venue_external_refs, public.ratings, public.venues')
    c.execute("""INSERT INTO venues(name,city,address_text,lat,lon,status)
        SELECT 'Synthetic '||i,'Test','Calle '||i,38+(i%1000)*0.002,-1+(i/1000)*0.002,'active'
        FROM generate_series(1,100000) i""")
    c.execute('ANALYZE venues')
    # Explain the exact inner query: EXPLAIN of PL/pgSQL alone hides its plan.
    inner = sql.split('-- BEGIN NEARBY QUERY (also exercised with EXPLAIN ANALYZE in local tests)')[1].split('-- END NEARBY QUERY')[0]
    for count in (0,100):
        points = [dict(lat=38+i*.02,lon=-.9) for i in range(count)]
        times = []
        c.execute('SET LOCAL ROLE authenticated')
        try:
            for _ in range(5):
                start = time.perf_counter(); r=rpc(points); times.append((time.perf_counter()-start)*1000)
            explain_sql = inner.replace('p_overture_candidates','%(points)s::jsonb').replace('p_lat','%(lat)s').replace('p_lon','%(lon)s')
            plan = c.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+explain_sql, dict(points=json.dumps(points),lat=lat,lon=lon)).fetchone()[0][0]
        finally:
            c.execute('RESET ROLE')
        item=dict(rows=100000,external_points=count,min_ms=min(times),median_ms=statistics.median(times),max_ms=max(times),response_bytes=len(json.dumps(r).encode()),identity_rows=len(r['identity_candidates']),explain=plan)
        report['performance'].append(item)
        print(json.dumps({k:v for k,v in item.items() if k!='explain'}),flush=True)
    def readonly():
        c.execute('SET LOCAL transaction_read_only=on')
        assert len(rpc()['nearby']) == 10
        expect_error('25006', lambda: c.execute("INSERT INTO venues(name,city,status) VALUES('Forbidden','Test','active')"))
    check('RPC executes successfully inside a READ ONLY transaction', readonly)
    assert hashlib.sha256(guard.read_bytes()).hexdigest() == guard_hash
    report['guard_sha256'] = guard_hash
finally:
    c.execute('ROLLBACK')
    report['rolled_back'] = True
    report['remaining_rpc'] = c.execute("SELECT to_regprocedure('public.get_nearby_venues_v1(double precision,double precision,jsonb)')::text").fetchone()[0]
    report['remaining_test_view'] = c.execute("SELECT to_regclass('public.vw_venues_with_coords')::text").fetchone()[0]
    assert c.execute("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY rolname").fetchall() == initial_roles
    assert c.execute('SELECT (SELECT count(*) FROM venues),(SELECT count(*) FROM ratings),(SELECT count(*) FROM venue_external_refs)').fetchone() == initial_counts
    report['roles_and_data_restored'] = True
    Path('/private/tmp/advisoret-nearby-postgres-results.json').write_text(json.dumps(report,indent=2,default=str))
    c.close()
