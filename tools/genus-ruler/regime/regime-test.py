#!/usr/bin/env python3
"""
regime-test.py — S5a tests of regime_ref.py (S5-design §2) → tools/genus-ruler/regime/regime-test.txt.

  python3 -I tools/genus-ruler/regime/regime-test.py --pre-count --shear-def zi01|sfc --f1-variant solar|solar+utc
  python3 -I tools/genus-ruler/regime/regime-test.py --full --shear-def … --f1-variant … [--list <regime-list.json>] [--axes <axes.json>]
                                                    [--emit-vectors <path>]

Stages (§0.5): --pre-count runs every test except R-DATA, R-SCHEMA and the real-file half of R-DET (none of them computes or
prints N_R; tests that need a full list build use a synthetic context); --full runs all, against the list given by --list
(default tools/genus-ruler/regime/regime-list.json). Output: header (sha256 of regime_ref.py and this file, stage, shearDef,
f1Variant), one line per test `id PASS|FAIL detail`, last line `ALL PASS n/n` or `FAIL k/n`. Details are counts, statuses
and hashes only — never an oro scene name or a satellite value. Synthetic data lives in .harness/regime/test-tmp/.
"""
import sys
sys.dont_write_bytecode = True

import ast
import copy
import gzip
import hashlib
import importlib.util
import json
import math
import os
import subprocess
from datetime import date as Date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
REF_PATH = os.path.join(HERE, 'regime_ref.py')
_spec = importlib.util.spec_from_file_location('regime_ref', REF_PATH)
R = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R)
O = R.O
UTC = timezone.utc
TMP = os.path.join(ROOT, '.harness', 'regime', 'test-tmp')
TESTS = []
VECTORS = []
STATE = {}


def test(tid, stages=('pre-count', 'full')):
    def deco(fn):
        TESTS.append((tid, fn, stages))
        return fn
    return deco


def near(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def run_cli(args, timeout=1800):
    p = subprocess.run([sys.executable, '-I', REF_PATH] + args, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def tmp(name):
    os.makedirs(TMP, exist_ok=True)
    return os.path.join(TMP, name)


# ───────────────────────── synthetic soundings and inputs ─────────────────────────
T0 = datetime(2026, 7, 1, 3, 0, tzinfo=UTC)


def hour_keys(t0, n):
    return [(t0 + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(n)]


def period_hours(period):
    a, b = R.PERIODS[period]
    n = ((Date.fromisoformat(b) - Date.fromisoformat(a)).days + 1) * 24
    return hour_keys(datetime.fromisoformat(a).replace(tzinfo=UTC), n)


def sd_of(u, v):
    """(u, v) toward east/north → Open-Meteo (speed, from-direction)."""
    return math.hypot(u, v), math.degrees(math.atan2(-u, -v)) % 360.0


def base_vals(zs, T2m=25.0, Td2m=17.0, blh=1500.0, cape=300.0, precip=0.0, sw=600.0, low=20.0, high=10.0,
              w10=(5.0, 270.0), winds=None, Z=None, lapse_off=1.0, rh_low=60.0, rh_high=30.0):
    """Hourly values (Open-Meteo keys, %, from-direction) of one synthetic convective profile."""
    winds = winds or {925: (9.0, 270.0), 850: (11.0, 270.0), 700: (13.0, 270.0)}
    v = {'temperature_2m': T2m, 'dew_point_2m': Td2m, 'cape': cape, 'boundary_layer_height': blh, 'precipitation': precip,
         'shortwave_radiation': sw, 'cloud_cover_low': low, 'cloud_cover_high': high,
         'wind_speed_10m': w10[0], 'wind_direction_10m': w10[1]}
    for p in R.PL:
        z = (Z or {}).get(p, O.z_std(p))
        v[f'geopotential_height_{p}hPa'] = z
        v[f'temperature_{p}hPa'] = None if z is None else T2m - 0.0098 * (z - zs) - lapse_off
        v[f'relative_humidity_{p}hPa'] = rh_low if p >= 700 else rh_high
    for p in R.UV_LEVELS:
        v[f'wind_speed_{p}hPa'], v[f'wind_direction_{p}hPa'] = winds[p]
    return v


def make_snd(name, zs, times, fn):
    hourly = {'time': list(times)}
    keys = R.read_vars()
    for k in keys:
        hourly[k] = []
    for i, hk in enumerate(times):
        vals = fn(i, hk)
        for k in keys:
            hourly[k].append(vals.get(k))
    return O.Sounding(name, {'elevation': zs, 'hourly': hourly})


def const_snd(name, zs, vals, t0=T0 - timedelta(hours=3), n=7):
    return make_snd(name, zs, hour_keys(t0, n), lambda i, hk: vals)


def inp_of(vals, zs=40.0, site='seoul', t=T0, sun=50.0):
    """§1.6 input built through inputs_at on a constant 7-hour sounding; sun altitude overridden for tree tests."""
    snd = const_snd(site, zs, vals)
    inp = R.inputs_at(snd, site, t)
    if sun is not None:
        inp['sunAltDeg'] = sun
    return inp


def derived(**kw):
    d = {'na': [], 'convective': True, 'lclM': 1000.0, 'zi': 1500.0, 'lowCloud': True, 'capeJkg': 100.0, 'precipMm': 0.0,
         'ucblSpeed': 8.0, 'shear': 1e-3}
    d.update(kw)
    return d


# ───────────────────────── synthetic CMR ─────────────────────────
def gstr(t):
    return t.strftime('%Y-%m-%dT%H:%M:%S') + '.000Z'


def quad_ring(lat, lon_t, dl=0.0):
    pts = [(lat - 8 + dl, lon_t - 12), (lat - 8 + dl, lon_t + 12), (lat + 8, lon_t + 12), (lat + 8, lon_t - 12), (lat - 8 + dl, lon_t - 12)]
    return [' '.join(f'{a:.3f} {b:.3f}' for a, b in pts)]


def granule(start, end, ring, flag='DAY', lon=0.0):
    return {'time_start': gstr(start), 'time_end': gstr(end), 'day_night_flag': flag, 'polygons': [ring],
            'solarDate': R.solar_date(start, lon)}


def utc_of(d, lmst_h, lon):
    return datetime.fromisoformat(d).replace(tzinfo=UTC) + timedelta(seconds=round(lmst_h * 3600) - round(lon / 15 * 3600))


def syn_cmr(sites_tab, periods_by_site):
    """Synthetic sat-times doc: daily Aqua (15:10 LMST) and Terra (09:00) passes with varying cross-track offsets, some
    two-granule passes, duplicates, BOTH night granules, multi-pass and missing days."""
    qs = []
    for site in sorted(periods_by_site):
        lat, lon, _ = sites_tab[site]
        for per in periods_by_site[site]:
            for sat, lmst, mul in (('aqua', 15 + 10 / 60, 97), ('terra', 9.0, 61)):
                gs = []
                for k, d in enumerate(R.period_dates(per)):
                    if sat == 'terra' and k % 17 == 3:
                        continue
                    off = ((k * mul) % 900) - 450.0
                    lon_t = lon + off / (111.32 * math.cos(math.radians(lat)))
                    mids = [utc_of(d, lmst, lon)]
                    if sat == 'aqua' and k % 11 == 5:
                        mids.append(utc_of(d, lmst + 100 / 60, lon))
                    for mid in mids:
                        if k % 3 == 0:
                            parts = [(mid - timedelta(seconds=300), mid), (mid, mid + timedelta(seconds=300))]
                        else:
                            parts = [(mid - timedelta(seconds=150), mid + timedelta(seconds=150))]
                        for a, b in parts:
                            gs.append(granule(a, b, quad_ring(lat, lon_t), 'DAY', lon))
                            gs.append(granule(a, b, quad_ring(lat, lon_t, 0.001), 'DAY', lon))     # second collection copy
                    n3 = utc_of(d, 3.0, lon)
                    gs.append(granule(n3, n3 + timedelta(seconds=300), quad_ring(lat, lon + 30), 'BOTH', lon))
                qs.append({'site': site, 'sat': sat, 'period': per, 'url': 'synthetic', 'hits': len(gs), 'pages': 1,
                           'nReturned': len(gs), 'nDay': len(gs), 'granules': gs})
    return {'queries': qs, 'periods': {k: list(v) for k, v in R.PERIODS.items()}}


def syn_day_vals(zs, k, h):
    pat = k % 6
    dirn = (k * 23) % 360
    T2m = 24.0 + 0.1 * h
    kw = {'T2m': T2m, 'Td2m': T2m - 8.0}
    if pat in (0, 1):
        sp = (5.0, 9.0, 11.0, 13.0)
    elif pat == 2:
        sp = (1.0, 1.5, 2.0, 2.5)
    elif pat == 3:
        sp = (3.0, 4.0, 4.5, 5.0)
        kw['blh'] = 950.0
    elif pat == 4:
        sp = (5.0, 9.0, 11.0, 13.0)
        kw['low'] = 0.0
    else:
        sp = (5.0, 9.0, 11.0, 13.0)
        kw['high'] = 80.0
    kw['w10'] = (sp[0], float(dirn))
    kw['winds'] = {925: (sp[1], float(dirn)), 850: (sp[2], float(dirn)), 700: (sp[3], float(dirn))}
    return base_vals(zs, **kw)


def syn_snd(site, zs, period):
    return make_snd(site, zs, period_hours(period), lambda i, hk: syn_day_vals(zs, i // 24, i % 24))


SYN_SITES = {'osaka': (34.69, 135.5, 'held'), 'seoul': (37.5, 127.0, 'dev')}


def syn_ctx(shear_def, f1_variant, reverse=False):
    """Synthetic context: seoul (dev, p2026) and osaka (held, p2026 + p2025). reverse=True shuffles key/list order."""
    if 'dg' not in STATE:
        with open(R.absp(R.P_DEM_GRIDS)) as f:
            STATE['dg'] = json.load(f)
    if 'syn_snd' not in STATE:
        STATE['syn_snd'] = {'p2026': {s: syn_snd(s, 40.0, 'p2026') for s in SYN_SITES},
                            'p2025': {'osaka': syn_snd('osaka', 40.0, 'p2025')}}
        STATE['syn_cmr'] = syn_cmr(SYN_SITES, {'seoul': ['p2026'], 'osaka': ['p2026', 'p2025']})
    doc = STATE['syn_cmr']
    snd = STATE['syn_snd']
    sites_tab = dict(SYN_SITES)
    if reverse:
        doc = json.loads(json.dumps(doc))
        doc['queries'] = list(reversed(doc['queries']))
        doc = {k: doc[k] for k in reversed(list(doc))}
        snd = {P: {s: O.Sounding(s, {'hourly': {k: m[s].hourly[k] for k in reversed(list(m[s].hourly))}, 'elevation': m[s].elevation})
                   for s in reversed(list(m))} for P, m in reversed(list(snd.items()))}
        sites_tab = {k: sites_tab[k] for k in reversed(list(sites_tab))}
    return R.Ctx(doc, snd, shear_def, f1_variant, STATE['dg'], sites_tab)


def syn_build(shear_def, f1_variant, reverse=False):
    ctx = syn_ctx(shear_def, f1_variant, reverse)
    src = {'code': {'regime_ref.py': 'synthetic'}, 'env': None}
    doc, axes = R.build_list(ctx, src, provisional=True, ext_complete=True,
                             ext_info={'path': 'synthetic', 'manifestSha256': None, 'sites': ['osaka']})
    return ctx, doc, axes


# ═════════════════════════ tests ═════════════════════════
@test('R-OLD')
def t_old():
    with open(R.absp(R.P_ORO_FROZEN)) as f:
        fz = json.load(f)
    bad = [p for p in R.FROZEN_CHECK if R.sha256_file(R.absp(p)) != fz['files'].get(p)]
    ok = (not bad and R.sha256_file(R.absp(R.P_ORO_REF)) == R.ORO_REF_SHA256 == fz['files'][R.P_ORO_REF]
          and O.__spec__ is None and O.__file__ == R.absp(R.P_ORO_REF) and R.ORO_LOAD_ERROR is None)
    return ok, f'frozen files equal {len(R.FROZEN_CHECK) - len(bad)}/{len(R.FROZEN_CHECK)}; oro_ref executed from bytes'


@test('R-GEOM0')
def t_geom0():
    def segs(path):
        with open(path, encoding='utf-8') as f:
            src = f.read()
        tree = ast.parse(src)
        return {n.name: ast.get_source_segment(src, n) for n in tree.body if isinstance(n, ast.FunctionDef)}
    a = segs(R.absp(R.P_ORO_GEOM))
    b = segs(REF_PATH)
    same = [n for n in R.GEOM_COPIES if a.get(n) is not None and a.get(n) == b.get(n)]
    ok = len(same) == len(R.GEOM_COPIES) and R.R_EARTH_KM == 6371.0
    return ok, f'{len(same)}/{len(R.GEOM_COPIES)} functions text-equal; oro-geom sha {R.sha256_file(R.absp(R.P_ORO_GEOM))[:12]}'


@test('R-SITES')
def t_sites():
    t1 = R.sites_from_source(R.P_FETCH_SAT_TIMES)
    t2 = R.sites_from_source(R.P_FETCH_SND)
    t3 = R.sites_from_source(R.P_FETCH_SAT)
    t4 = O.sites_table()
    t5 = R.sites()
    ok = t1 == t2 == t3 == t4 == t5 and len(t5) == 10 and sum(1 for v in t5.values() if v[2] == 'held') == 8
    return ok, f'5 tables equal: {ok}; sites {len(t5)}'


@test('R-GUARD')
def t_guard():
    forb = ['tools/genus-ruler/macro/jobs-macro.json', '.harness/macro/sat/x.png', '.harness/regime/sat/x.png',
            'tools/genus-ruler/regime/S5-design.md', 'tools/genus-ruler/regime/texture-manifest.json']
    v1 = [R.s5a_verdict(R.absp(p), 'r') for p in forb]
    okf = all(v == 'forbidden' for v in v1)
    allow = [(R.P_SAT_TIMES, 'r', 'read'), (R.P_LIST, 'w', 'write'), ('.harness/regime/test-tmp/a.json', 'w', 'write'),
             ('.harness/regime/provisional/regime-list.json', 'w', 'write'), (R.P_SND, 'r', 'read'),
             (R.P_SND, 'w', 'forbidden'), (R.P_SAT_TIMES, 'w', 'forbidden')]
    oka = all(R.s5a_verdict(R.absp(p), m) == want for p, m, want in allow)
    okx = R.s5a_verdict('/usr/lib/python3/os.py', 'r') == 'outside' and R.s5a_verdict('/tmp/x/scratchpad/restore/a', 'r') == 'forbidden'
    probes = [R.absp(p) for p in ('.harness/regime/sat/__probe__.png', '.harness/macro/sat/__probe__.png',
                                  'tools/genus-ruler/macro/__probe__.json')]
    if any(os.path.exists(p) for p in probes):
        return False, 'a probe path exists'
    code = f"""
import sys, json, importlib.util
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('regime_ref', {REF_PATH!r})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.install_guard_s5a()
res = []
for p in {probes!r}:
    try:
        open(p).close(); res.append('opened')
    except PermissionError as e:
        res.append('perm:' + str(e).split(':')[0])
    except FileNotFoundError:
        res.append('fnf')
try:
    open({R.absp(R.P_SAT_TIMES)!r}, 'rb').close(); res.append('read-ok')
except Exception as e:
    res.append('read-' + type(e).__name__)
try:
    with open({tmp('guard-probe.txt')!r}, 'w') as f: f.write('x')
    res.append('write-ok')
except Exception as e:
    res.append('write-' + type(e).__name__)
try:
    open({R.absp('tools/genus-ruler/regime/__probe__.txt')!r}, 'w').close(); res.append('opened-w')
except PermissionError as e:
    res.append('perm:' + str(e).split(':')[0])
print(json.dumps(res))
"""
    p = subprocess.run([sys.executable, '-I', '-c', code], cwd=ROOT, capture_output=True, text=True, timeout=300)
    try:
        res = json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return False, f'subprocess failed rc {p.returncode}'
    ok2 = (res[0].startswith('perm') and res[1].startswith('perm') and res[2] == 'perm:regime guard'
           and res[3] == 'read-ok' and res[4] == 'write-ok' and res[5] == 'perm:regime guard')
    return okf and oka and okx and ok2, f'verdict forbidden {sum(v == "forbidden" for v in v1)}/{len(forb)}, allow-list {oka}, subprocess {res}'


def bad_record():
    p = tmp('record-badsha.txt')
    with open(p, 'w') as f:
        f.write('\n'.join(['regime_ref.py sha256 ' + '0' * 64, 'regime-test.py sha256 x', 'stage pre-count', 'shearDef zi01',
                           'f1Variant solar', 'X PASS', 'ALL PASS 1/1']) + '\n')
    return p


@test('R-PRECOUNT')
def t_precount():
    c1, _, _ = run_cli(['count', '--f1-variant', 'solar'])
    c2, _, _ = run_cli(['count', '--shear-def', 'zi01'])
    c3, _, _ = run_cli(['list', '--shear-def', 'zi01'])
    head = ['regime_ref.py sha256 ' + '0' * 64, 'regime-test.py sha256 x', 'stage pre-count', 'shearDef zi01', 'f1Variant solar',
            'X PASS', 'ALL PASS 1/1']
    p1 = tmp('record-badsha.txt')
    with open(p1, 'w') as f:
        f.write('\n'.join(head) + '\n')
    head2 = list(head)
    head2[0] = 'regime_ref.py sha256 ' + R.sha256_file(REF_PATH)
    head2[-1] = 'FAIL 1/2'
    p2 = tmp('record-fail.txt')
    with open(p2, 'w') as f:
        f.write('\n'.join(head2) + '\n')
    c4, _, e4 = run_cli(['count', '--shear-def', 'zi01', '--f1-variant', 'solar', '--test-record', p1])
    c5, _, e5 = run_cli(['count', '--shear-def', 'zi01', '--f1-variant', 'solar', '--test-record', p2])
    c6, _, e6 = run_cli(['list', '--shear-def', 'zi01', '--f1-variant', 'solar', '--test-record', p2, '--out', tmp('x.json'),
                         '--axes-out', tmp('y.json')])
    ok = (c1, c2, c3) == (2, 2, 2) and (c4, c5, c6) == (4, 4, 4) and all('(g)' in e for e in (e4, e5, e6))
    return ok, f'no-def exits {(c1, c2, c3)}; bad record exits {(c4, c5, c6)} at (g)'


@test('R-CMR')
def t_cmr():
    doc = R.load_sat_times(R.absp(R.P_SAT_TIMES))
    ok1, probs = R.cmr_check(doc, R.sites())
    n = sum(1 for q in doc['queries'] if q['period'] in ('p2026', 'p2025'))
    d1 = copy.deepcopy(doc)
    d1['queries'] = [q for q in d1['queries'] if not (q['site'] == 'busan' and q['sat'] == 'terra' and q['period'] == 'p2026')]
    d2 = copy.deepcopy(doc)
    for q in d2['queries']:
        if q['site'] == 'lisbon' and q['sat'] == 'aqua' and q['period'] == 'p2025':
            q['hits'] += 1
    codes = []
    for i, dd in enumerate((d1, d2)):
        p = tmp(f'sat-times-bad{i}.json.gz')
        with gzip.open(p, 'wt') as f:
            json.dump(dd, f)
        c, _, e = run_cli(['count', '--shear-def', 'zi01', '--f1-variant', 'solar', '--sat-times', p, '--test-record', bad_record()])
        codes.append((c, '(d)' in e))
    ok = ok1 and n == 40 and codes == [(4, True), (4, True)]
    return ok, f'used queries {n} complete {ok1}; synthetic missing/hits-mismatch exits {codes}'


@test('R-SOLAR')
def t_solar():
    doc = R.load_sat_times(R.absp(R.P_SAT_TIMES))
    st = R.sites()
    n = bad = 0
    for q in doc['queries']:
        lon = st[q['site']][1]
        for g in q['granules']:
            n += 1
            bad += int(R.solar_date(R.parse_utc(g['time_start']), lon) != g['solarDate'])
    return bad == 0 and n == 18647, f'{n - bad}/{n} granules'


@test('R-SAT-SUM')
def t_satsum():
    doc = R.load_sat_times(R.absp(R.P_SAT_TIMES))
    held = [s for s, v in R.sites().items() if v[2] == 'held']
    res = {}
    for sat in R.SAT_ORDER:
        by = {}
        for q in doc['queries']:
            if q['period'] != 'p2026' or q['sat'] != sat or q['site'] not in held:
                continue
            for d in {g['solarDate'] for g in q['granules'] if g['day_night_flag'] in ('DAY', 'BOTH')}:
                by[d[:7]] = by.get(d[:7], 0) + 1
        res[sat] = (min(by.values()), max(by.values()))
    ok = res['aqua'] == (239, 248) and res['terra'] == (228, 247)
    return ok, f'aqua {res["aqua"]} terra {res["terra"]}'


@test('R-PASS')
def t_pass():
    t = datetime(2026, 6, 10, 5, 0, tzinfo=UTC)
    ring = quad_ring(0, 0)

    def g(a_s, b_s, flag='DAY', dl=0.0):
        return granule(t + timedelta(seconds=a_s), t + timedelta(seconds=b_s), quad_ring(0, 0, dl), flag)
    out = []
    q = {'granules': [g(0, 300), g(300, 600), g(600, 900)]}
    ps = R.group_passes(R.day_granules(q), 0.0)
    out.append(len(ps) == 1 and ps[0]['mid'] == t + timedelta(seconds=450))
    q = {'granules': [g(0, 300), g(1800, 2100)]}
    out.append(len(R.group_passes(R.day_granules(q), 0.0)) == 1)
    q = {'granules': [g(0, 300), g(1801, 2101)]}
    out.append(len(R.group_passes(R.day_granules(q), 0.0)) == 2)
    q = {'granules': [g(0, 300), g(0, 300, dl=0.001), g(0, 300, dl=0.002)]}
    dg_ = R.day_granules(q)
    out.append(len(dg_) == 1 and len(dg_[0]['polygons']) == 3)
    q = {'granules': [g(0, 300), g(3600, 3900, 'BOTH'), g(7200, 7500, 'NIGHT')]}
    out.append(len(R.group_passes(R.day_granules(q), 0.0)) == 1)
    # 0/1/2 passes per solar day through pass_info
    q = {'granules': [g(0, 300), g(7200, 7500)]}
    allp, by = R.build_passes(q, 0.0)
    pi2 = R.pass_info_from(allp, by, '2026-06-10', 'p2026', 0.0, 0.0, 'solar')
    pi0 = R.pass_info_from(allp, by, '2026-06-11', 'p2026', 0.0, 0.0, 'solar')
    q = {'granules': [g(0, 300)]}
    allp, by = R.build_passes(q, 0.0)
    pi1 = R.pass_info_from(allp, by, '2026-06-10', 'p2026', 0.0, 0.0, 'solar')
    out.append(pi2['nPasses'] == 2 and pi2['f1Reason'] == 'multiPass' and pi2['passMidUtc'] is None)
    out.append(pi0['nPasses'] == 0 and pi0['f1Reason'] == 'none' and not pi0['filter1'])
    out.append(pi1['nPasses'] == 1 and pi1['passMidUtc'] == '2026-06-10T05:02:30Z')
    # window edges: Denver lon −104.99 (solar day = UTC − 7 h), Sydney 151.21 (Terra 09:00 LMST = previous UTC date)
    td = datetime(2026, 6, 2, 3, 0, tzinfo=UTC)
    out.append(R.solar_date(td, -104.99) == '2026-06-01')
    ts = datetime(2026, 6, 14, 22, 55, tzinfo=UTC)
    out.append(R.solar_date(ts, 151.21) == '2026-06-15')
    edge = datetime(2026, 6, 1, 0, 0, tzinfo=UTC) - timedelta(hours=151.21 / 15)
    out.append(R.solar_date(edge, 151.21) == '2026-06-01' and R.solar_date(edge - timedelta(seconds=1), 151.21) == '2026-05-31')
    return all(out), f'{sum(out)}/{len(out)} cases'


def equator_site_km(km):
    return (0.0, math.degrees(km / R.R_EARTH_KM))


def eq_ring():
    return [(-1.0, -10.0), (-1.0, 10.0), (1.0, 10.0), (1.0, -10.0), (-1.0, -10.0)]


@test('R-CT')
def t_ct():
    out = []
    ring = eq_ring()
    ct, st = R.cross_track_km(ring, equator_site_km(430.0))
    out.append(st == 'ok' and near(ct, 430.0, 1e-6))
    out.append(R.ct_ok(430.0, R.CT_MAX_KM) and not R.ct_ok(430.0000001, R.CT_MAX_KM))
    t = datetime(2026, 6, 10, 12, 0, tzinfo=UTC)
    rs = ' '.join(f'{a} {b}' for a, b in ring)

    def pinfo(site, rings_list):
        gs = [{'time_start': gstr(t), 'time_end': gstr(t + timedelta(seconds=300)), 'day_night_flag': 'DAY',
               'polygons': [[r] for r in rings_list], 'solarDate': ''}]
        allp, by = R.build_passes({'granules': gs}, 0.0)
        return R.pass_info_from(allp, by, '2026-06-10', 'p2026', site[0], site[1], 'solar')
    a = pinfo(equator_site_km(429.9999), [rs])
    b = pinfo(equator_site_km(430.5), [rs])
    out.append(a['filter1'] and a['ctPolyHow'] == 'pip' and not b['filter1'] and b['f1Reason'] == 'ct')
    # centroid branch: the site outside both rings → nearest centroid ring
    far = ' '.join(f'{x} {y + 40}' for x, y in ring)
    nearr = ' '.join(f'{x} {y + 13}' for x, y in ring)
    c = pinfo((0.0, 24.0), [far, nearr])
    out.append(c['ctPolyHow'] == 'centroid' and c['ctStatus'] == 'ok' and near(c['ctKm'], 11.0 * math.pi / 180 * R.R_EARTH_KM, 1.0))
    s300 = pinfo(equator_site_km(299.9999), [rs])
    s520 = pinfo(equator_site_km(519.9999), [rs])
    out.append(s300['ctSens'] == {'300': True, '520': True} and s520['ctSens'] == {'300': False, '520': True}
               and not s520['filter1'] and R.ct_ok(300.0, 300.0) and R.ct_ok(520.0, 520.0))
    return all(out), f'{sum(out)}/{len(out)} cases; equator ct(430) − 430 = {ct - 430.0:.2e} km'


def track_quad(a, bearing_deg, length_km=500.0, half_km=300.0):
    b = R._destination(a, math.radians(bearing_deg), length_km / R.R_EARTH_KM)
    l, r_ = math.radians(bearing_deg - 90), math.radians(bearing_deg + 90)
    h = half_km / R.R_EARTH_KM
    c1, c2 = R._destination(a, l, h), R._destination(a, r_, h)
    c3, c4 = R._destination(b, r_, h), R._destination(b, l, h)
    return [c1, c2, c3, c4, c1]


@test('R-CT-AXIS')
def t_ct_axis():
    out = []
    v0 = R.scan_axis_deg(eq_ring(), (0.0, 1.0))
    out.append(near(v0, 0.0, 1e-9) or near(v0, 180.0, 1e-9))
    vals = {}
    for brg, want in ((40.0, 140.0), (140.0, 40.0), (0.0, 0.0), (20.0, 160.0)):
        a0 = (35.0, 135.0)
        q = track_quad(a0, brg)
        bb = R._destination(a0, math.radians(brg), 500.0 / R.R_EARTH_KM)
        mid = R._destination(a0, math.radians(brg), 250.0 / R.R_EARTH_KM)
        beta = R._bearing(mid, bb)                    # track bearing at the point nearest the site (great-circle drift)
        site = R._destination(mid, math.radians(beta + 90), 100.0 / R.R_EARTH_KM)
        v = R.scan_axis_deg(q, site)
        exact = R.norm_axis(-beta)
        vals[brg] = v
        out.append(v is not None and 0.0 <= v < 180.0 and near(exact, want, 2.0)
                   and (near(v, exact, 0.05) or near(abs(v - exact), 180.0, 0.05)))
    return all(out), ('initial track bearing → scan axis at the nearest track point ' + ', '.join(f'{k:g}→{v:.2f}' for k, v in vals.items())
                      + ' (45° is the frozen edge-rule tie; 40/140 used)')


def gibs_doc():
    lon = 150.0
    rs = quad_ring(-30.0, lon)
    gs = []
    for d, lm in (('2026-06-10', 9.0), ('2026-06-09', 15.0), ('2026-06-11', 9.0), ('2026-06-01', 9.0), ('2026-10-31', 15.0),
                  ('2026-10-30', 9.0 + 0.5)):
        mid = utc_of(d, lm, lon)
        gs.append(granule(mid - timedelta(seconds=150), mid + timedelta(seconds=150), rs, 'DAY', lon))
    return {'granules': gs}, lon


@test('R-GIBS')
def t_gibs():
    q, lon = gibs_doc()
    allp, by = R.build_passes(q, lon)

    def pi(d, var='solar'):
        return R.pass_info_from(allp, by, d, 'p2026', -30.0, lon, var)
    a, b, c, f = pi('2026-06-10'), pi('2026-06-09'), pi('2026-06-11'), pi('2026-06-01')
    out = [a['utcDayPasses'] == 1 and a['gibsAmbiguous'] is True and a['gibsDate'] == '2026-06-09',
           b['gibsAmbiguous'] is True, c['utcDayPasses'] == 0 and c['gibsAmbiguous'] is False,
           f['gibsAmbiguous'] is None and f['gibsDate'] == '2026-05-31']
    lastd = pi('2026-10-31')
    out.append(lastd['gibsAmbiguous'] is False)
    av = pi('2026-06-10', 'solar+utc')
    fv = pi('2026-06-01', 'solar+utc')
    cv = pi('2026-06-11', 'solar+utc')
    out.append(not av['filter1'] and av['f1Reason'] == 'gibs' and not fv['filter1'] and cv['filter1'] == c['filter1'])
    # real Aqua: no filter-1 pass shares its UTC day with another covering DAY pass
    doc = R.load_sat_times(R.absp(R.P_SAT_TIMES))
    st = R.sites()
    ctx = R.Ctx(doc, {}, 'zi01', 'solar', None, st)
    n_true = n_f1 = 0
    for site in st:
        for per in ('p2026', 'p2025'):
            for d in R.period_dates(per):
                p = ctx.pass_info(site, 'aqua', per, d)
                if p['filter1']:
                    n_f1 += 1
                    n_true += int(p['gibsAmbiguous'] is True)
    out.append(n_true == 0 and n_f1 > 0)
    return all(out), f'{sum(out)}/{len(out)} cases; real Aqua filter-1 passes with gibsAmbiguous true: {n_true}'


@test('R-F1')
def t_f1():
    t = datetime(2026, 6, 10, 12, 0, tzinfo=UTC)
    rs = ' '.join(f'{a} {b}' for a, b in eq_ring())

    def pinfo(km, n=1, var='solar'):
        gs = []
        for k in range(n):
            tt = t + timedelta(hours=3 * k)
            gs.append({'time_start': gstr(tt), 'time_end': gstr(tt + timedelta(seconds=300)), 'day_night_flag': 'DAY',
                       'polygons': [[rs]], 'solarDate': ''})
        allp, by = R.build_passes({'granules': gs}, 0.0)
        return R.pass_info_from(allp, by, '2026-06-10', 'p2026', *equator_site_km(km), var)
    cases = [(pinfo(200.0), True, None), (pinfo(500.0), False, 'ct'), (pinfo(200.0, 2), False, 'multiPass'),
             (pinfo(200.0, var='solar+utc'), True, None)]
    out = [p['filter1'] == want and p['f1Reason'] == why for p, want, why in cases]
    return all(out), f'{sum(out)}/{len(out)} cases (gibs clause in R-GIBS)'


class Spy(O.Sounding):
    def __init__(self, name, rec):
        super().__init__(name, rec)
        self.read = set()

    def series(self, var):
        self.read.add(var)
        return super().series(var)


@test('R-VARS')
def t_vars():
    vals = base_vals(40.0)
    for k in ('surface_pressure', 'sensible_heat_flux', 'freezing_level_height', 'cloud_cover', 'cloud_cover_mid',
              'wind_speed_600hPa', 'wind_direction_600hPa', 'temperature_400hPa', 'geopotential_height_300hPa'):
        vals[k] = 1.0
    times = hour_keys(T0 - timedelta(hours=3), 7)
    hourly = {'time': times}
    for k, v in vals.items():
        hourly[k] = [v] * len(times)
    spy = Spy('seoul', {'elevation': 40.0, 'hourly': hourly})
    R.inputs_at(spy, 'seoul', T0 + timedelta(minutes=17))
    ok = spy.read == set(R.read_vars())
    never = {'surface_pressure', 'sensible_heat_flux', 'freezing_level_height', 'cloud_cover', 'cloud_cover_mid'} & spy.read
    return ok and not never, f'keys read {len(spy.read)} = map {len(R.read_vars())}: {ok}; never-read touched {len(never)}'


@test('R-SND-SAME')
def t_snd_same():
    snds = R.load_soundings(R.absp(R.P_SND))
    src = O.sounding_source(R.absp(R.P_SND), snds, R.absp(R.P_SND_MAN))
    with open(R.absp(R.P_ORO_INPUTS)) as f:
        oi = json.load(f)
    bm = oi['sources']['sounding']['bestMatch']['sites']
    eq = sum(1 for s in snds if src['sites'][s]['hourlySha256'] == bm.get(s, {}).get('hourlySha256'))
    with open(R.absp(R.P_SND_MAN)) as f:
        man = json.load(f)
    try:
        nulls = R.regime_nulls(snds, man)
        nok = all(set(v) == set(R.read_vars()) for v in nulls.values())
    except ValueError:
        nok = False
    return eq == len(snds) == 10 and nok, f'hourlySha256 equal {eq}/{len(snds)}; regimeNulls = manifest: {nok}'


def interp_snd():
    times = hour_keys(datetime(2026, 6, 1, 0, 0, tzinfo=UTC), 13)
    vals = [None if h in (3, 4, 5) else float(h * 10) for h in range(13)]
    return O.Sounding('x', {'elevation': 0.0, 'hourly': {'time': times, 'cape': vals,
                                                         'temperature_2m': [float(h * 10) for h in range(13)]}})


@test('R-INTERP')
def t_interp():
    s = interp_snd()
    t = lambda h, m=0: datetime(2026, 6, 1, h, m, tzinfo=UTC)
    out = []
    out.append(R.interp_na(s, 'temperature_2m', t(2, 30)) == O.interp_fallback(s.times, s.series('temperature_2m'), t(2, 30))[0] == 25.0)
    out.append(R.interp_na(s, 'cape', t(2)) == 20.0)
    v = R.interp_na(s, 'cape', t(3))
    out.append(near(v, 30.0, 1e-12) and v == O.interp_fallback(s.times, s.series('cape'), t(3))[0])
    out.append(R.interp_na(s, 'cape', t(2, 59)) is None)                  # after side 06:00 is 3 h 01 m away
    out.append(R.interp_na(s, 'cape', t(0) - timedelta(minutes=30)) is None)   # one side only (before the file)
    out.append(R.interp_na(s, 'cape', t(12, 30)) is None)
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-UV')
def t_uv():
    times = hour_keys(datetime(2026, 6, 1, 0, 0, tzinfo=UTC), 3)
    s = O.Sounding('x', {'elevation': 0.0, 'hourly': {'time': times, 'wind_speed_10m': [5.0, 5.0, 5.0],
                                                      'wind_direction_10m': [350.0, 10.0, None]}})
    w = R.uv_na(s, '10m', datetime(2026, 6, 1, 0, 30, tzinfo=UTC))
    w2 = R.uv_na(s, '10m', datetime(2026, 6, 1, 1, 30, tzinfo=UTC))
    ok = w is not None and abs(w[0]) < 1e-12 and w[1] < 0 and near(math.hypot(*w), 5 * math.cos(math.radians(10)), 1e-12) and w2 is None
    return ok, f'midway speed {math.hypot(*w):.6f} toward south; null direction → None'


@test('R-INPUTS')
def t_inputs():
    inp = inp_of(base_vals(40.0, low=37.0, high=12.0), sun=None)
    keys = {'tUtc', 'site', 'zSfcM', 'sunAltDeg', 't2mC', 'td2mC', 'capeJkg', 'blhM', 'precipMm', 'swWm2', 'lowFrac', 'highFrac',
            'wind10', 'levels'}
    ok = set(inp) == keys and len(inp['levels']) == len(R.PL) and [e['p'] for e in inp['levels']] == list(R.PL)
    ok = ok and inp['lowFrac'] == 0.37 and inp['highFrac'] == 0.12
    ok = ok and all((e['u'] is not None) == (e['p'] in R.UV_LEVELS) for e in inp['levels'])
    ok = ok and all(set(e) == {'p', 'zM', 'tC', 'rhPct', 'u', 'v'} for e in inp['levels']) and inp['tUtc'] == '2026-07-01T03:00:00Z'
    return ok, f'schema keys {len(keys)}, levels {len(inp["levels"])}, % → fraction'


@test('R-PSFC')
def t_psfc():
    out = []
    kept = [{'p': 1000, 'zM': 100.0}, {'p': 900, 'zM': 1000.0}]
    out.append(near(R.p_sfc(kept, 550.0), math.sqrt(1000.0 * 900.0), 1e-9))
    std = [{'p': p, 'zM': O.z_std(p)} for p in R.PL]
    zs = 300.0
    inv = 1013.25 * (1 - zs / 44330.8) ** (1 / 0.190263)
    out.append(near(R.p_sfc(std, zs), inv, 0.05))
    ext = R.p_sfc(std, 0.0)
    l0, l1 = math.log(1000), math.log(975)
    z0, z1 = O.z_std(1000), O.z_std(975)
    out.append(near(ext, math.exp(l0 + (0.0 - z0) * (l1 - l0) / (z1 - z0)), 1e-9) and ext > 1000)
    den = [{'p': 850, 'zM': 1480.0}, {'p': 800, 'zM': 1960.0}, {'p': 700, 'zM': 3150.0}]
    v = R.p_sfc(den, 1597.0)
    out.append(800 < v < 850 and near(v, math.exp(math.log(850) + 117.0 * (math.log(800) - math.log(850)) / 480.0), 1e-9))
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-THV')
def t_thv():
    T, RH, p = 20.0, 50.0, 900.0
    es = 6.112 * math.exp(17.67 * T / (T + 243.5))
    e = RH / 100.0 * es
    q = 0.622 * e / (p - 0.378 * e)
    want = (T + 273.15) * (1000.0 / p) ** (287.04 / 1004.7) * (1 + (461.5 / 287.04 - 1) * q)
    a = R.theta_v_level(T, RH, p)
    T2, Td, ps = 25.0, 15.0, 1005.0
    e2 = 6.112 * math.exp(17.67 * Td / (Td + 243.5))
    q2 = 0.622 * e2 / (ps - 0.378 * e2)
    want2 = (T2 + 273.15) * (1000.0 / ps) ** (287.04 / 1004.7) * (1 + (461.5 / 287.04 - 1) * q2)
    b = R.theta_v_2m(T2, Td, ps)
    return near(a, want, 1e-9) and near(b, want2, 1e-9), f'θv level {a:.6f} K, θv 2 m {b:.6f} K'


def lv(z, t, rh, p=900):
    return {'p': p, 'zM': z, 'tC': t, 'rhPct': rh}


@test('R-LCL')
def t_lcl():
    out = []
    out.append(R.lcl_agl(0.0, 25.0, 15.0, [lv(5000.0, -10.0, 50.0)]) == 1250.0)
    t1, r1 = 20.0, 70.0
    dep = t1 - R.dew_point_c(t1, r1)
    out.append(near(R.lcl_agl(100.0, 25.0, 15.0, [lv(400.0, t1, r1)]), (0 + 300.0) / 2 + 125 * (10.0 + dep) / 2, 1e-9))
    v10 = R.lcl_agl(0.0, 25.0, 15.0, [lv(10.0, t1, r1)])
    v600 = R.lcl_agl(0.0, 25.0, 15.0, [lv(600.0, t1, r1)])
    out.append(v10 == 1250.0 and near(v600, 300.0 + 125 * (10.0 + dep) / 2, 1e-9))
    out.append(R.lcl_agl(0.0, 25.0, 25.0, []) == 150.0 and R.lcl_agl(0.0, 45.0, 5.0, []) == 3500.0)
    return all(out), f'{sum(out)}/{len(out)} cases'


def lcl_random_inputs(n=500):
    import numpy as np
    rng = np.random.default_rng(20261105)
    out = []
    for i in range(n):
        g = float(rng.uniform(0, 2000))
        t2 = float(rng.uniform(-10, 40))
        td = t2 - float(rng.uniform(-2, 25))
        levels, rh = [], []
        for p in R.PL:
            z = g + float(rng.uniform(-300, 900)) if p >= 850 else g + float(rng.uniform(800, 6000))
            if i % 50 == 0 and p == 925:
                z = g + 10.0
            if i % 50 == 1 and p == 925:
                z = g + 600.0
            t = t2 - float(rng.uniform(-3, 15))
            r = float(rng.uniform(-5, 105))
            levels.append({'zM': z, 'tC': t, 'pHPa': p})
            if not (i % 7 == 3 and p == 950):
                rh.append({'zM': z + float(rng.uniform(-0.9, 0.9)), 'rhPct': r})
        th = {'groundM': g, 't2mC': t2, 'td2mC': td, 'levels': levels, 'rhLevels': rh}
        if i % 97 == 5:
            th['groundM'] = None
        out.append(th)
    return out


@test('R-LCL-TS')
def t_lcl_ts():
    rel = 'src/components/VolumetricProbe/cloudSkeleton.ts'
    k0 = subprocess.run(['git', 'rev-parse', '--quiet', '--verify', '115fbe2^{commit}'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    a = subprocess.run(['git', 'show', f'{k0}:{rel}'], cwd=ROOT, capture_output=True).stdout
    b = subprocess.run(['git', 'show', f'HEAD:{rel}'], cwd=ROOT, capture_output=True).stdout
    if len(k0) != 40 or not a or a != b:
        return False, 'cloudSkeleton.ts differs between 115fbe2 and HEAD (or missing)'
    d = os.path.join(ROOT, '.harness', 'regime', 'lcl-bundle', k0)
    os.makedirs(os.path.join(d, os.path.dirname(rel)), exist_ok=True)
    with open(os.path.join(d, rel), 'wb') as f:
        f.write(a)
    for nm in ('tsconfig.json', 'package.json'):
        with open(os.path.join(d, nm), 'w') as f:
            f.write('{}\n')
    with open(os.path.join(d, 'entry.ts'), 'w') as f:
        f.write("import { lclAglM } from './src/components/VolumetricProbe/cloudSkeleton';\n"
                "declare const require: any; declare const process: any;\n"
                "const fs = require('fs');\n"
                "const inp = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));\n"
                "process.stdout.write(JSON.stringify(inp.map((th: any) => lclAglM(th))));\n")
    try:
        ver = subprocess.run(['npx', '--yes', 'esbuild@0.28.2', '--version'], cwd=d, capture_output=True, text=True, timeout=300).stdout.strip()
        if ver != '0.28.2':
            return False, f'esbuild version {ver!r}'
        subprocess.run(['npx', '--yes', 'esbuild@0.28.2', 'entry.ts', '--bundle', '--format=cjs', '--platform=node',
                        '--outfile=lcl.cjs', '--log-level=warning'], cwd=d, check=True, capture_output=True, timeout=300)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f'esbuild unavailable: {type(e).__name__}'
    ths = lcl_random_inputs()
    pin = tmp('lcl-inputs.json')
    with open(pin, 'w') as f:
        json.dump(ths, f)
    p = subprocess.run(['node', os.path.join(d, 'lcl.cjs'), pin], capture_output=True, text=True, timeout=300)
    if p.returncode != 0:
        return False, f'node failed rc {p.returncode}'
    js = json.loads(p.stdout)
    py = [R.lcl_agl_th(th) for th in ths]
    dmax = max(abs(x - y) for x, y in zip(js, py))
    with open(os.path.join(d, 'lcl.cjs'), 'rb') as f:
        bsha = hashlib.sha256(f.read()).hexdigest()
    return len(js) == len(py) == 500 and dmax <= 1e-9, f'500 inputs, max |Δ| {dmax:.2e} m; bundle sha {bsha[:12]}; node {subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()}'


@test('R-ZI')
def t_zi():
    out = []
    inp = {'zSfcM': 0.0, 'blhM': 3500.0}
    out.append(R.zi_of(inp, [], 300.0) == (3500.0, 'blh'))
    inp['blhM'] = 50.0
    out.append(R.zi_of(inp, [], 300.0) == (50.0, 'blh'))
    nodes = [(2.0, 300.0), (500.0, 300.2), (1500.0, 301.0)]
    thr = 300.5
    want = 500.0 + 1000.0 * (thr - 300.2) / (301.0 - 300.2)
    out.append(R.parcel_zi(nodes, 0.0, thr) == (want, 'parcel'))
    out.append(R.parcel_zi([(2.0, 300.0), (118.0, 301.0)], 0.0, 300.5) == (100.0, 'parcel-clip-lo'))     # crossing 60 m AGL
    out.append(R.parcel_zi([(2.0, 300.0), (6798.0, 301.0)], 0.0, 300.5) == (3000.0, 'parcel-clip-hi'))   # crossing 3,400 m AGL
    out.append(R.parcel_zi([(2.0, 300.0), (1000.0, 300.4), (2000.0, 300.3)], 0.0, 300.5) == (3000.0, 'parcel-none'))
    out.append(R.parcel_zi([(2.0, 300.0), (1000.0, 300.5), (2000.0, 300.5)], 0.0, 300.5) == (3000.0, 'parcel-none'))
    # BLH null through the selector → parcel source
    v = base_vals(40.0)
    v['boundary_layer_height'] = None
    r = R.select(inp_of(v), 'zi01')
    out.append(r['regime'] != 'NA' and r['ziSource'].startswith('parcel'))
    return all(out), f'{sum(out)}/{len(out)} cases'


def nodes_simple():
    return [(10.0, (3.0, 0.0)), (1000.0, (8.0, 0.0))]


@test('R-UCBL')
def t_ucbl():
    out = []
    n = [(10.0, (6.0, 0.0)), (510.0, (6.0, 0.0)), (2000.0, (6.0, 0.0))]
    U, s, deg = R.u_cbl(n, 0.0, 1010.0)
    out.append(U == (6.0, 0.0) and s == 6.0 and not deg)
    n = [(10.0, (1.0, 2.0)), (800.0, (1.0 + 0.004 * 790, 2.0 - 0.001 * 790)), (3000.0, (1.0 + 0.004 * 2990, 2.0 - 0.001 * 2990))]
    zt = 1500.0
    vb, vt = R.V_at(n, 10.0), R.V_at(n, zt)
    U, s, _ = R.u_cbl(n, 0.0, zt)
    out.append(near(U[0], (vb[0] + vt[0]) / 2, 1e-12) and near(U[1], (vb[1] + vt[1]) / 2, 1e-12))
    dn = [(1607.0, (2.0, 1.0)), (3150.0, (10.0, 4.0))]
    U, s, _ = R.u_cbl(dn, 1597.0, 2000.0)
    want = ((3150 - 1607) * (2 + 10) / 2 + (3597 - 3150) * (10 + 10) / 2) / (3597 - 1607)
    out.append(near(U[0], want, 1e-12) and R.V_at(dn, 3597.0) == (10.0, 4.0))
    U, s, deg = R.u_cbl(nodes_simple(), 0.0, 8.0)
    out.append(U == (3.0, 0.0) and deg)
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-SHEAR')
def t_shear():
    a, _, _ = R.shear(nodes_simple(), 0.0, 1000.0, 'zi01')
    b, _, _ = R.shear(nodes_simple(), 0.0, 1000.0, 'sfc')
    c, sv, deg = R.shear(nodes_simple(), 0.0, 0.0, 'zi01')
    want = (8.0 - (3.0 + 90.0 / 990.0 * 5.0)) / 900.0
    ok = near(a, want, 1e-15) and near(a, 5.0505e-3, 1e-7) and near(b, 5e-3, 1e-15) and c == 0.0 and sv == (0.0, 0.0) and deg
    return ok, f'zi01 {a:.6e} s⁻¹, sfc {b:.6e} s⁻¹, zi 0 → 0'


@test('R-AXIS')
def t_axis():
    out = []
    out.append(R.axis_deg(1.0, 0.0) == 0.0 and R.axis_deg(0.0, 1.0) == 90.0)
    u, v = O.wind_to_uv(5.0, 315.0)
    out.append(near(R.axis_deg(u, v), 135.0, 1e-9))
    u, v = O.wind_to_uv(5.0, 45.0)
    out.append(near(R.axis_deg(u, v), 45.0, 1e-9))
    out.append(R.theta_cbl((1.999, 0.0), (0.0, 1.0)) == (90.0, 'shear') and R.theta_cbl((2.0, 0.0), (0.0, 1.0)) == (0.0, 'wind'))
    out.append(R.theta_cbl((0.0, 0.0), (0.0, 0.0)) == (0.0, 'none'))
    w = R.axis_deg(-1.0, -1e-17)
    out.append(0.0 <= w < 180.0)
    v = base_vals(40.0, w10=(0.5, 270.0), winds={925: (1.0, 270.0), 850: (1.0, 180.0), 700: (3.0, 180.0)})
    inp = inp_of(v)
    ra, rb = R.select(inp, 'zi01'), R.select(inp, 'sfc')
    out.append(ra['axisSource'] == 'shear' and ra['thetaCblDeg'] == rb['thetaCblDeg'] and ra['shear'] != rb['shear'])
    return all(out), f'{sum(out)}/{len(out)} cases'


def roll_inp():
    return inp_of(base_vals(40.0))


@test('R-TREE')
def t_tree():
    out = []
    out.append(R.decide(derived(na=['t2mC'], convective=False)) == 'NA')
    out.append(R.decide(derived(convective=False, zi=500.0)) == 'NONE')
    out.append(R.decide(derived(lclM=1900.0, zi=1500.0)) == 'NONE')
    out.append(R.decide(derived(lowCloud=False)) == 'NONE')
    out.append(R.decide(derived(capeJkg=1500.0)) == 'NONE' and R.decide(derived(capeJkg=None)) == 'ROLL')
    out.append(R.decide(derived(precipMm=0.6, zi=500.0)) == 'NONE')
    out.append(R.decide(derived(zi=900.0, ucblSpeed=12.0)) == 'DISORG')
    out.append(R.decide(derived(ucblSpeed=6.5, shear=0.0)) == 'ROLL' and R.decide(derived(ucblSpeed=1.0, shear=3e-3)) == 'ROLL')
    out.append(R.decide(derived(ucblSpeed=5.0, shear=1e-3)) == 'CELL')
    regs = {}
    for nm, v in (('ROLL', base_vals(40.0)), ('NONE', base_vals(40.0, precip=1.0)), ('DISORG', base_vals(40.0, blh=950.0)),
                  ('CELL', base_vals(40.0, w10=(1.0, 270.0), winds={925: (1.5, 270.0), 850: (2.0, 270.0), 700: (2.5, 270.0)})),
                  ('NA', base_vals(40.0, T2m=25.0)), ('NONE-sun', base_vals(40.0))):
        if nm == 'NA':
            v['temperature_2m'] = None
            v['dew_point_2m'] = 17.0
        inp = inp_of(v, sun=10.0 if nm == 'NONE-sun' else 50.0)
        r = R.select(inp, 'zi01')
        regs[nm] = r['regime']
        VECTORS.append({'name': f'tree-{nm}', 'input': inp, 'shearDef': 'zi01', 'regime': r['regime'], 'thetaCblDeg': r['thetaCblDeg'],
                        'axisSource': r['axisSource']})
    out.append(regs == {'ROLL': 'ROLL', 'NONE': 'NONE', 'DISORG': 'DISORG', 'CELL': 'CELL', 'NA': 'NA', 'NONE-sun': 'NONE'})
    return all(out), f'{sum(out)}/{len(out)} cases; end-to-end {regs}'


@test('R-EQ')
def t_eq():
    out = []
    out.append(R.decide(derived(ucblSpeed=6.0, shear=0.0)) == 'ROLL')
    out.append(R.decide(derived(shear=2e-3, ucblSpeed=0.0)) == 'ROLL')
    out.append(R.decide(derived(zi=1100.0, ucblSpeed=0.0, shear=0.0)) == 'CELL')
    out.append(R.decide(derived(lclM=1400.0, zi=1100.0)) != 'NONE')
    out.append(R.convective_of(20.0, 300.0, -0.5) and not R.convective_of(19.99, 300.0, 0.0))
    out.append(R.decide(derived(capeJkg=1000.0)) == 'NONE')
    out.append(R.decide(derived(precipMm=0.5)) != 'NONE')
    out.append(R.low_cloud_of(0.05, 1000.0) and not R.low_cloud_of(0.05, 3000.0) and not R.low_cloud_of(0.0499, 1000.0))
    # end-to-end exact inputs: no level in (10, 600] m AGL → LCL = 125 (T2m − Td2m) exactly
    Z = {p: 700.0 + 300.0 * i for i, p in enumerate(R.PL)}
    v = base_vals(40.0, T2m=25.0, Td2m=15.0, blh=950.0, Z=Z)
    r = R.select(inp_of(v), 'zi01')
    out.append(r['lclM'] == 1250.0 and r['zi'] == 950.0 and r['regime'] == 'DISORG')
    v = base_vals(40.0, T2m=25.0, Td2m=1.0, blh=2900.0, Z=Z)
    r2 = R.select(inp_of(v), 'zi01')
    out.append(r2['lclM'] == 3000.0 and r2['lowCloud'] is False and r2['regime'] == 'NONE')
    v = base_vals(40.0, T2m=25.0, Td2m=15.0, blh=1500.0, Z=Z, cape=1000.0)
    out.append(R.select(inp_of(v), 'zi01')['regime'] == 'NONE')
    v = base_vals(40.0, T2m=25.0, Td2m=15.0, blh=1500.0, Z=Z, precip=0.5, low=5.0, sw=300.0)
    r3 = R.select(inp_of(v, sun=20.0), 'zi01')
    out.append(r3['regime'] == 'ROLL' and r3['convective'] and r3['lowCloud'])
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-NA')
def t_na():
    out = []
    names = {}
    for key, nm in (('temperature_2m', 't2mC'), ('dew_point_2m', 'td2mC'), ('precipitation', 'precipMm'),
                    ('shortwave_radiation', 'swWm2'), ('cloud_cover_low', 'lowFrac'), ('wind_speed_10m', 'wind10'),
                    ('geopotential_height_850hPa', 'Z850'), ('temperature_700hPa', 'T700'), ('relative_humidity_500hPa', 'RH500')):
        v = base_vals(40.0)
        v[key] = None
        r = R.select(inp_of(v), 'zi01')
        names[nm] = r['na']
        out.append(r['regime'] == 'NA' and r['na'] == [nm])
    snd = const_snd('seoul', None, base_vals(40.0))
    r = R.select(R.inputs_at(snd, 'seoul', T0), 'zi01')
    out.append(r['regime'] == 'NA' and r['na'] == ['zSfcM'])
    v = base_vals(40.0)
    v['cape'] = None
    r = R.select(inp_of(v), 'zi01')
    out.append(r['regime'] != 'NA' and r['capeSkipped'] is True)
    v = base_vals(40.0)
    v['boundary_layer_height'] = None
    out.append(R.select(inp_of(v), 'zi01')['regime'] != 'NA')
    v = base_vals(1600.0, T2m=30.0, Td2m=10.0, blh=2500.0)
    v['temperature_1000hPa'] = None
    v['geopotential_height_975hPa'] = None
    out.append(R.select(inp_of(v, zs=1600.0), 'zi01')['regime'] != 'NA')
    v = base_vals(40.0, blh=500.0)
    v['wind_speed_700hPa'] = None
    v['wind_speed_850hPa'] = None
    out.append(R.select(inp_of(v), 'zi01')['regime'] != 'NA')
    v = base_vals(40.0, blh=1500.0)
    v['wind_direction_850hPa'] = None
    r = R.select(inp_of(v), 'zi01')
    out.append(r['regime'] == 'NA' and r['na'] == ['wind850'])
    snd = const_snd('seoul', 40.0, base_vals(40.0))
    r = R.select(R.inputs_at(snd, 'seoul', T0 - timedelta(hours=3, minutes=30)), 'zi01')
    out.append(r['regime'] == 'NA')
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-MARGIN')
def t_margin():
    base_d = {'ucblSpeed': 4.0, 'shear': 1e-3, 'zi': 1500.0, 'lclM': 1000.0, 'dThvK': 1.0}
    base_i = {'sunAltDeg': 50.0, 'swWm2': 600.0, 'capeJkg': 100.0, 'precipMm': 0.0, 'lowFrac': 0.2}
    setters = {'U6': ('d', 'ucblSpeed', 6.0), 'shear': ('d', 'shear', 2e-3), 'zi1100': ('d', 'zi', 1100.0),
               'lclZi300': ('lcl', None, 300.0), 'sun20': ('i', 'sunAltDeg', 20.0), 'sw300': ('i', 'swWm2', 300.0),
               'dthv': ('d', 'dThvK', -0.5), 'cape1000': ('i', 'capeJkg', 1000.0), 'precip05': ('i', 'precipMm', 0.5),
               'low005': ('i', 'lowFrac', 0.05), 'axis2': ('d', 'ucblSpeed', 2.0)}
    out = []
    for k, (where, key, th) in setters.items():
        for mult, want in ((0.5, True), (-0.5, True), (2.0, False), (-2.0, False)):
            d, i = dict(base_d), dict(base_i)
            x = th + mult * R.MARGIN[k]
            if where == 'd':
                d[key] = x
            elif where == 'i':
                i[key] = x
            else:
                d['lclM'] = d['zi'] + x
            out.append(R.margins_of(d, i)[k] is want)
    i = dict(base_i, capeJkg=None)
    out.append(R.margins_of(base_d, i)['cape1000'] is False and not any(R.margins_of(base_d, base_i).values()))
    return all(out), f'{sum(out)}/{len(out)} cases over {len(setters)} keys'


DENVER_Z = {1000: None, 975: None, 950: None, 925: 760.0, 900: 990.0, 850: 1480.0, 800: 1960.0, 750: 2480.0, 700: 3150.0,
            600: 4400.0, 500: 5850.0}


def denver_vals(strong, **kw):
    sp = (6.0, 8.0, 10.0, 14.0) if strong else (1.0, 1.2, 1.3, 1.4)
    v = base_vals(1597.0, T2m=30.0, Td2m=12.0, blh=2000.0, Z=DENVER_Z, rh_low=45.0, rh_high=20.0,
                  w10=(sp[0], 250.0), winds={925: (sp[1], 250.0), 850: (sp[2], 250.0), 700: (sp[3], 250.0)}, **kw)
    for p in (1000, 975, 950):
        v[f'temperature_{p}hPa'] = None
        v[f'relative_humidity_{p}hPa'] = None
    return v


@test('R-DENVER')
def t_denver():
    out = []
    snd = make_snd('denver', 1597.0, hour_keys(datetime(2026, 7, 1, 18, tzinfo=UTC), 4), lambda i, hk: denver_vals(True))
    t = datetime(2026, 7, 1, 19, 40, tzinfo=UTC)
    inp = R.inputs_at(snd, 'denver', t)
    kept, na = R.profile(inp)
    out.append(not na and [e['p'] for e in kept] == [925, 900, 850, 800, 750, 700, 600, 500])
    ps = R.p_sfc(kept, 1597.0)
    out.append(800 < ps < 850 and R.first_level(kept, 1597.0)['p'] == 800)
    nodes, nw = R.wind_nodes(inp, kept, 1597.0, 2000.0)
    out.append(not nw and [round(z) for z, _ in nodes] == [1607, 3150])
    r = R.select(inp, 'zi01')
    out.append(r['regime'] == 'ROLL' and inp['sunAltDeg'] >= 20)
    snd2 = make_snd('denver', 1597.0, hour_keys(datetime(2026, 7, 1, 18, tzinfo=UTC), 4), lambda i, hk: denver_vals(False))
    r2 = R.select(R.inputs_at(snd2, 'denver', t), 'zi01')
    out.append(r2['regime'] == 'CELL')
    v = denver_vals(True)
    v['geopotential_height_850hPa'] = None
    snd3 = make_snd('denver', 1597.0, hour_keys(datetime(2026, 7, 1, 18, tzinfo=UTC), 4), lambda i, hk: v)
    r3 = R.select(R.inputs_at(snd3, 'denver', t), 'zi01')
    out.append(r3['regime'] == 'NA' and r3['na'] == ['Z850'])
    for nm, rr, ii in (('denver-roll', r, inp), ('denver-cell', r2, R.inputs_at(snd2, 'denver', t))):
        VECTORS.append({'name': nm, 'input': ii, 'shearDef': 'zi01', 'regime': rr['regime'], 'thetaCblDeg': rr['thetaCblDeg'],
                        'axisSource': rr['axisSource']})
    return all(out), f'{sum(out)}/{len(out)} cases; ROLL/CELL/NA {r["regime"]}/{r2["regime"]}/{r3["regime"]}, p_sfc {ps:.2f} hPa'


@test('R-SYDNEY')
def t_sydney():
    out = []
    lat, lon, _ = R.sites()['sydney']
    times = hour_keys(datetime(2026, 6, 1, 0, tzinfo=UTC), 30 * 24)

    def fn(i, hk):
        v = base_vals(40.0, w10=(5.0, 315.0), winds={925: (9.0, 315.0), 850: (11.0, 315.0), 700: (13.0, 315.0)})
        v['temperature_2m'] = 10.0 + 0.01 * i
        v['dew_point_2m'] = v['temperature_2m'] - 8.0
        return v
    snd = make_snd('sydney', 40.0, times, fn)
    rs = quad_ring(lat, lon)
    gs = []
    for d, lm in (('2026-06-15', 9.0), ('2026-06-01', 9.0 - 0.13)):
        mid = utc_of(d, lm, lon)
        gs.append(granule(mid - timedelta(seconds=150), mid + timedelta(seconds=150), rs, 'DAY', lon))
    allp, by = R.build_passes({'granules': gs}, lon)
    p15 = R.pass_info_from(allp, by, '2026-06-15', 'p2026', lat, lon, 'solar')
    t15 = R.parse_utc(p15['passMidUtc'])
    inp = R.inputs_at(snd, 'sydney', t15)
    i_exp = (t15 - datetime(2026, 6, 1, tzinfo=UTC)).total_seconds() / 3600.0
    out.append(p15['gibsDate'] == '2026-06-14' and inp['tUtc'].startswith('2026-06-14') and near(inp['t2mC'], 10.0 + 0.01 * i_exp, 1e-9))
    ta = utc_of('2026-06-21', 15 + 10 / 60, lon)
    ia = R.inputs_at(snd, 'sydney', ta)
    ra = R.select(ia, 'zi01')
    out.append(ia['sunAltDeg'] < 20.0 and ra['regime'] == 'NONE')
    r15 = R.select(inp, 'zi01')
    north = dict(inp, site='seoul', sunAltDeg=50.0)
    rn = R.select(north, 'zi01')
    out.append(near(r15['thetaCblDeg'], 135.0, 1e-6) and r15['thetaCblDeg'] == rn['thetaCblDeg'])
    p01 = R.pass_info_from(allp, by, '2026-06-01', 'p2026', lat, lon, 'solar')
    r01 = R.select(R.inputs_at(snd, 'sydney', R.parse_utc(p01['passMidUtc'])), 'zi01')
    out.append(p01['passMidUtc'] < '2026-06-01T00:00:00Z' and r01['regime'] == 'NA')
    VECTORS.append({'name': 'sydney-low-sun', 'input': ia, 'shearDef': 'zi01', 'regime': ra['regime'], 'thetaCblDeg': ra['thetaCblDeg'],
                    'axisSource': ra['axisSource']})
    return all(out), f'{sum(out)}/{len(out)} cases; low-sun Aqua altitude {ia["sunAltDeg"]:.1f}°'


@test('R-EDGE')
def t_edge():
    out = []
    snd = const_snd('seoul', 40.0, base_vals(40.0))
    last = O.parse_hour(snd.times[-1])
    out.append(R.select(R.inputs_at(snd, 'seoul', last + timedelta(minutes=20)), 'zi01')['regime'] == 'NA')
    doc = R.load_sat_times(R.absp(R.P_SAT_TIMES))
    snds = R.load_soundings(R.absp(R.P_SND))
    ext = R.load_soundings(R.absp(R.P_SND_EXT)) if os.path.exists(R.absp(R.P_SND_EXT)) else {}
    st = R.sites()
    ctx = R.Ctx(doc, {'p2026': snds, 'p2025': ext}, 'zi01', 'solar', None, st)
    before = []
    for per, sd in (('p2026', snds), ('p2025', ext)):
        first = R.PERIODS[per][0]
        for site in sorted(sd):
            if per == 'p2025' and st[site][2] != 'held':
                continue
            f0 = O.parse_hour(sd[site].times[0])
            for sat in R.SAT_ORDER:
                p = ctx.pass_info(site, sat, per, first)
                if p['nPasses'] == 1 and R.parse_utc(p['passMidUtc']) < f0:
                    before.append((site, sat, per))
    want = [('sydney', 'terra', 'p2026')] + ([('sydney', 'terra', 'p2025')] if ext else [])
    out.append(sorted(before) == sorted(want))
    syd = ctx.pass_info('sydney', 'terra', 'p2026', R.PERIODS['p2026'][0])
    out.append(R.select(R.inputs_at(snds['sydney'], 'sydney', R.parse_utc(syd['passMidUtc'])), 'zi01')['regime'] == 'NA')
    if ext:
        sy5 = ctx.pass_info('sydney', 'terra', 'p2025', R.PERIODS['p2025'][0])
        out.append(R.select(R.inputs_at(ext['sydney'], 'sydney', R.parse_utc(sy5['passMidUtc'])), 'zi01')['regime'] == 'NA')
    nn = 0
    for site in ('kanazawa', 'osaka', 'sapporo'):
        p = ctx.pass_info(site, 'terra', 'p2026', R.PERIODS['p2026'][0])
        inp = R.inputs_at(snds[site], site, R.parse_utc(p['passMidUtc']))
        ok = p['passMidUtc'].startswith('2026-06-01T00:') and all(inp[k] is not None for k in
                                                                  ('t2mC', 'td2mC', 'precipMm', 'swWm2', 'lowFrac', 'highFrac', 'wind10'))
        nn += int(ok)
    out.append(nn == 3)
    return all(out), f'{sum(out)}/{len(out)} cases; real first-day passes before the file start: {len(before)}; kanazawa/osaka/sapporo Terra inputs complete {nn}/3'


@test('R-F2')
def t_f2():
    cases = [({'highFrac': 0.5, 'precipMm': 0.0}, False), ({'highFrac': 0.49999, 'precipMm': 0.0}, True),
             ({'highFrac': 0.1, 'precipMm': 0.5}, True), ({'highFrac': 0.1, 'precipMm': 0.5001}, False),
             ({'highFrac': None, 'precipMm': 0.0}, None), ({'highFrac': 0.1, 'precipMm': None}, None)]
    out = [R.filter2(i) is w for i, w in cases]
    return all(out), f'{sum(out)}/{len(out)} cases'


def pi_stub(f1, ct300=None, ct520=None):
    return {'filter1': f1, 'ctSens': {'300': f1 if ct300 is None else ct300, '520': f1 if ct520 is None else ct520}}


@test('R-SAT')
def t_sat():
    ev = lambda f2: {'f2': f2}
    f1 = lambda p: p['filter1']
    out = []
    out.append(R._choose({'aqua': pi_stub(True), 'terra': pi_stub(True)}, {'aqua': ev(True), 'terra': ev(True)}, f1) == ('aqua', None))
    out.append(R._choose({'aqua': pi_stub(True), 'terra': pi_stub(True)}, {'aqua': ev(False), 'terra': ev(True)}, f1) == ('terra', None))
    out.append(R._choose({'aqua': pi_stub(False), 'terra': pi_stub(True)}, {'aqua': None, 'terra': ev(True)}, f1) == ('terra', None))
    out.append(R._choose({'aqua': pi_stub(True), 'terra': pi_stub(False)}, {'aqua': ev(None), 'terra': ev(True)}, f1) == (None, 'filter2'))
    out.append(R._choose({'aqua': pi_stub(False), 'terra': pi_stub(False)}, {'aqua': None, 'terra': None}, f1) == (None, 'filter1'))
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-VARIANT')
def t_variant():
    ev = {'aqua': {'f2': True}, 'terra': {'f2': True}}
    a480 = {'aqua': pi_stub(False, False, True), 'terra': pi_stub(True, True, True)}
    main = R._choose(a480, ev, lambda p: p['filter1'])
    v3 = R._choose(a480, ev, lambda p: p['ctSens']['300'])
    v5 = R._choose(a480, ev, lambda p: p['ctSens']['520'])
    a350 = {'aqua': pi_stub(True, False, True), 'terra': pi_stub(True, True, True)}
    m2 = R._choose(a350, ev, lambda p: p['filter1'])
    v32 = R._choose(a350, ev, lambda p: p['ctSens']['300'])
    a350b = {'aqua': pi_stub(True, False, True), 'terra': pi_stub(False, False, False)}
    v33 = R._choose(a350b, ev, lambda p: p['ctSens']['300'])
    ok = main[0] == 'terra' and v3[0] == 'terra' and v5[0] == 'aqua' and m2[0] == 'aqua' and v32[0] == 'terra' and v33 == (None, 'filter1')
    return ok, f'main {main[0]} ct300 {v3[0]} ct520 {v5[0]}; 350 km main {m2[0]} ct300 {v32[0]}/{v33[0]}'


def terrain_vals(strong=True, z850=None):
    v = base_vals(40.0, winds={925: (9.0, 270.0), 850: (11.0 if strong else 1.0, 270.0), 700: (13.0 if strong else 1.0, 270.0)})
    if z850 is not None:
        v['geopotential_height_850hPa'] = z850
        v['geopotential_height_700hPa'] = z850 + 100.0
    for p in (600, 500):
        v[f'wind_speed_{p}hPa'] = 15.0
        v[f'wind_direction_{p}hPa'] = 270.0
    for p in (400, 300, 250, 200):
        v[f'temperature_{p}hPa'] = -30.0
        v[f'geopotential_height_{p}hPa'] = O.z_std(p)
    v['temperature_700hPa'] = v['temperature_850hPa'] - 4.0      # stable 850–700 layer (N² > 1e-5)
    return v


@test('R-TERRAIN')
def t_terrain():
    if 'dg' not in STATE:
        with open(R.absp(R.P_DEM_GRIDS)) as f:
            STATE['dg'] = json.load(f)
    dg = STATE['dg']
    cache = O.SiteCache(dg)
    out = []
    times = hour_keys(T0 - timedelta(hours=3), 7)
    for site, strong, z850, want in (('osaka', True, None, True), ('osaka', False, None, False), ('busan', True, None, False),
                                     ('osaka', True, 100.0, False)):
        vals = terrain_vals(strong, z850)
        hourly = {'time': times}
        for k, x in vals.items():
            hourly[k] = [x] * len(times)
        snd = O.Sounding(site, {'elevation': 40.0, 'hourly': hourly})
        tr = R.terrain(site, T0, snd, cache, dg)
        exp_flag = tr['a1'] and tr['a2'] and tr['a3']
        out.append(tr['flag'] is want and tr['flag'] == exp_flag)
        if z850 is not None:
            out.append(tr['refEmpty'] is True)
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-TERRAIN-ORO')
def t_terrain_oro():
    with open(R.absp(R.P_ORO_APPLY)) as f:
        ap = json.load(f)
    with open(R.absp(R.P_ORO_INPUTS)) as f:
        oi = json.load(f)
    if 'dg' not in STATE:
        with open(R.absp(R.P_DEM_GRIDS)) as f:
            STATE['dg'] = json.load(f)
    dg = STATE['dg']
    cache = O.SiteCache(dg)
    snds = R.load_soundings(R.absp(R.P_SND))
    eq = n = 0
    for name in sorted(ap['scenes']):
        row = ap['scenes'][name]
        sc = oi['scenes'][name]
        t = R.parse_utc(sc['times']['closest']['utc'])
        tr = R.terrain(sc['site'], t, snds[sc['site']], cache, dg)
        n += 1
        same = (tr['a1'] == row['A1']['ok'] and tr['a1RmsM'] == row['A1']['rmsM'] and tr['a2'] == row['A2']['ok']
                and tr['speedRef'] == row['A2']['speed'] and tr['a3'] == row['A3']['ok'] and tr['N2'] == row['A3']['N2'])
        eq += int(same)
    return eq == n == 145, f'{eq} equal / {n}'


def fake_rows(n_roll, extra=True):
    rows = {}
    for i in range(n_roll):
        rows[f'osaka_x{i:03d}'] = {'group': 'held', 'period': 'p2026', 'sat': 'aqua', 'regime': 'ROLL'}
    if extra:
        rows['seoul_a'] = {'group': 'dev', 'period': 'p2026', 'sat': 'aqua', 'regime': 'ROLL'}
        rows['osaka_n'] = {'group': 'held', 'period': 'p2026', 'sat': 'aqua', 'regime': 'NONE'}
        rows['osaka_e'] = {'group': 'held', 'period': 'p2026', 'sat': None, 'regime': None}
        rows['osaka_y'] = {'group': 'held', 'period': 'p2025', 'sat': 'terra', 'regime': 'ROLL'}
    return rows


@test('R-NR')
def t_nr():
    out = []
    for k in (59, 60, 61):
        out.append(R.n_r(fake_rows(k), ('p2026',)) == k)
    out.append(R.n_r(fake_rows(59), ('p2026', 'p2025')) == 60)
    out.append(R.choose_periods(60, False, False) == (['p2026'], 'final'))
    out.append(R.choose_periods(61, True, False) == (['p2026'], 'final'))
    out.append(R.choose_periods(59, True, False) == (['p2026', 'p2025'], 'final'))
    out.append(R.choose_periods(59, False, True)[0] == ['p2026'])
    try:
        R.choose_periods(59, False, False)
        out.append(False)
    except R.ExtensionNeeded:
        out.append(True)
    held = sorted(s for s, v in R.sites().items() if v[2] == 'held')
    man = {'start': '2025-06-01', 'end': '2025-10-31', 'sites': {s: {} for s in held}}
    out.append(R.ext_status({s: 1 for s in held}, man)[0] is True)
    out.append(R.ext_status({s: 1 for s in held[:-1]}, man)[0] is False)
    out.append(R.ext_status({s: 1 for s in held}, dict(man, start='2026-06-01'))[0] is False)
    out.append(R.ext_status({s: 1 for s in held}, None)[0] is False)
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-SAMPLE')
def t_sample():
    out = []
    for n in (0, 1, 2, 3, 7, 12, 13, 101):
        rows = {f'osaka_2026-06-{i:03d}': {'group': 'held', 'sat': 'aqua', 'regime': 'NONE'} for i in range(n)}
        rows.update({f'seoul_2026-06-{i:03d}': {'group': 'dev', 'sat': 'aqua', 'regime': 'NONE'} for i in range(n + 3)})
        s = R.none_sample(rows)
        rev = {k: rows[k] for k in reversed(list(rows))}
        s2 = R.none_sample(rev)
        kh = sum(1 for k in s if k.startswith('osaka'))
        kd = sum(1 for k in s if k.startswith('seoul'))
        out.append(s == s2 and kh == math.floor(0.2 * n + 0.5) and kd == math.floor(0.2 * (n + 3) + 0.5))
    return all(out), f'{sum(out)}/{len(out)} sizes'


@test('R-SHIFT')
def t_shift():
    out = []
    pool = [5, 30, 37, 38, 60, 80, 100]
    out.append(R.shift_pick(50, pool, 10) == 60)                  # exact hit
    out.append(R.shift_pick(50, pool, 17) == 60 and R.shift_pick(50, [68], 25) == 68)   # window edge 7 in
    out.append(R.shift_pick(50, [68], 26) is None)                  # window edge 8 out (and −u far)
    out.append(R.shift_pick(50, [59, 60], 10) == 60 and R.shift_pick(50, [59], 10) is None)  # gap 9 out, 10 in
    out.append(R.shift_pick(50, [58, 62], 10) == 62 and R.shift_pick(50, [66, 72], 19) == 66)  # nearest; tie → earlier
    out.append(R.shift_pick(50, [64, 76], 20) == 64)                # tie at distance 6 → earlier
    out.append(R.shift_pick(50, [20], 30) == 20)                    # −u fallback
    out.append(R.shift_pick(50, [], 30) is None and R.shift_pick(50, [52], 10) is None)   # own-axis fallback
    out.append(R.shift_pick(150, [140], 10) == 140)                 # +u beyond the period → −u inside
    return all(out), f'{sum(out)}/{len(out)} cases'


def get_syn():
    if 'syn' not in STATE:
        STATE['syn'] = syn_build(STATE['shear'], STATE['f1'])
    return STATE['syn']


@test('R-SHIFT-SELF')
def t_shift_self():
    ctx, doc, axes = get_syn()
    n = eq = 0
    for k, a in axes['scenes'].items():
        r = doc['scenes'][k]
        di = a['dayIndex']
        n += 1
        eq += int(a['days']['regime'][di] == r['regime'] and a['days']['thetaCblDeg'][di] == r['thetaCblDeg']
                  and a['days']['filter2'][di] is r['passes'][r['sat']]['filter2'] and di in a['pool'])
    ok = n > 0 and eq == n
    det = f'synthetic {eq}/{n}'
    if STATE['stage'] == 'full' and STATE.get('list_doc') is not None:
        L, A = STATE['list_doc'], STATE['axes_doc']
        m = me = 0
        for k, a in A['scenes'].items():
            r = L['scenes'][k]
            di = a['dayIndex']
            m += 1
            me += int(a['days']['regime'][di] == r['regime'] and a['days']['thetaCblDeg'][di] == r['thetaCblDeg']
                      and a['days']['filter2'][di] is r['passes'][r['sat']]['filter2'])
        ok = ok and me == m
        det += f'; list file {me}/{m}'
    return ok, det


@test('R-SUNSET')
def t_sunset():
    out = []
    out.append(R.phase_of(-2.0, -1.5) == 'evening' and R.phase_of(8.0, 8.5) == 'evening')
    out.append(R.phase_of(-2.01, -1.5) is None and R.phase_of(8.01, 8.5) is None)
    out.append(R.phase_of(-2.0, -2.5) == 'morning' and R.phase_of(5.0, 5.0) is None)
    st = R.sites()
    ev_ok = cnt = 0
    for site in ('seoul', 'denver', 'sydney'):
        lat, lon, _ = st[site]
        for k in range(10):
            d0 = datetime(2026, 6, 1, tzinfo=UTC) + timedelta(days=15 * k)
            for h in range(24):
                t = d0 + timedelta(hours=h)
                ph = R.sun_phase(t, lat, lon)
                if ph is None:
                    continue
                lmst = ((t + timedelta(hours=lon / 15)).hour + (t + timedelta(hours=lon / 15)).minute / 60)
                cnt += 1
                ev_ok += int((ph == 'evening') == (lmst > 12))
    out.append(cnt > 0 and ev_ok == cnt)
    ctx, doc, _ = get_syn()
    nr = sum(x['evening']['nROLL'] for s in doc['summary']['sunset'].values() for x in s.values())
    nn = sum(x['evening']['n'] - x['evening']['nNA'] for s in doc['summary']['sunset'].values() for x in s.values())
    out.append(nr == 0 and nn > 0)
    det = f'{sum(out)}/{len(out)} cases; phase checks {ev_ok}/{cnt}; synthetic evening ROLL {nr}/{nn}'
    if STATE['stage'] == 'full' and STATE.get('list_doc') is not None:
        sun = STATE['list_doc']['summary']['sunset']
        rr = sum(x['evening']['nROLL'] for s in sun.values() for x in s.values())
        out.append(rr == 0)
        det += f'; list evening ROLL {rr}'
    return all(out), det


@test('R-SENS')
def t_sens():
    out = []
    v = base_vals(40.0)
    v['boundary_layer_height'] = None
    out.append(R.select(inp_of(v), 'zi01', 'blhOnly')['regime'] == 'NA*')
    inp = roll_inp()
    out.append(R.select(inp, 'zi01', 'blhOnly')['regime'] == R.select(inp, 'zi01')['regime'])
    r = R.select(inp, 'zi01', 'u850')
    u, vv = O.wind_to_uv(11.0, 270.0)
    out.append(r['regime'] == 'ROLL' and near(r['thetaCblDeg'], R.axis_deg(u, vv), 1e-12))
    # z_sfc 1600 m: 850 hPa (z_std 1457 m) is underground — the main U ignores it, the u850 arm uses it as given
    v = base_vals(1600.0, w10=(1.0, 270.0), winds={925: (1.5, 270.0), 850: (7.0, 180.0), 700: (2.5, 270.0)})
    iu = inp_of(v, zs=1600.0)
    out.append(R.select(iu, 'zi01', 'u850')['regime'] == 'ROLL' and R.select(iu, 'zi01')['regime'] == 'CELL')
    # ed1: levels in the layer (925 and 850 for BLH 1500 at z_sfc 40)
    r = R.select(inp, 'zi01', 'ed1')
    w = [O.wind_to_uv(5.0, 270.0), O.wind_to_uv(9.0, 270.0), O.wind_to_uv(11.0, 270.0)]
    Ux = sum(x[0] for x in w) / 3
    out.append(r['regime'] == 'ROLL' and near(r['thetaCblDeg'], R.axis_deg(Ux, 0.0 * Ux), 1e-9))
    # ed1 "no level in layer": zi 100 m below the 925 hPa level → V10 and the first level above ground
    v = base_vals(40.0, blh=1200.0, Z={1000: 111.0, 975: 2500.0, 950: 2600.0, 925: 2700.0, 900: 2800.0, 850: 2900.0, 800: 3000.0,
                                         750: 3100.0, 700: 3200.0, 600: 4300.0, 500: 5700.0},
                  w10=(1.0, 180.0), winds={925: (3.0, 270.0), 850: (20.0, 270.0), 700: (20.0, 270.0)})
    ii = inp_of(v)
    r = R.select(ii, 'zi01', 'ed1')
    a = O.wind_to_uv(1.0, 180.0)
    b = O.wind_to_uv(3.0, 270.0)
    U = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    out.append(near(r['thetaCblDeg'], R.axis_deg(*U), 1e-9) and r['regime'] in ('CELL', 'ROLL', 'NONE', 'DISORG'))
    return all(out), f'{sum(out)}/{len(out)} cases'


@test('R-DET')
def t_det():
    ctx, doc, axes = get_syn()
    s1 = R.serialize(doc, axes)
    _, doc2, axes2 = syn_build(STATE['shear'], STATE['f1'], reverse=True)
    s2 = R.serialize(doc2, axes2)
    ok = s1 == s2
    det = f'synthetic list twice (second with reversed key/query order) identical: {ok}; sha {R.sha256_text(s1[0])[:12]}'
    if STATE['stage'] == 'full':
        args = STATE['list_args']
        outs = []
        for i in (1, 2):
            c, so, se = run_cli(args + ['--out', tmp(f'det{i}-list.json'), '--axes-out', tmp(f'det{i}-axes.json')])
            outs.append(c)
        same = all(R.sha256_file(tmp(f'det1-{x}.json')) == R.sha256_file(tmp(f'det2-{x}.json')) for x in ('list', 'axes'))
        ok = ok and outs == [0, 0] and same
        det += f'; real list twice exits {outs} identical {same}'
    return ok, det


@test('R-SCHEMA', stages=('full',))
def t_schema():
    L, A = STATE['list_doc'], STATE['axes_doc']
    out = []
    out.append(L['shearDefinition'] == STATE['shear'] and L['f1Variant'] == STATE['f1'] and L['schema'] == 'regime-list/1')
    req = {'site', 'date', 'group', 'siteClass', 'period', 'passes', 'sat', 'excluded', 'passUtc', 'crossTrackKm', 'sunAltDeg',
           'inputs', 'regime', 'thetaCblDeg', 'axisSource', 'derived', 'na', 'margins', 'nearBoundary', 'terrain', 'other', 'sens',
           'variants', 'fetch'}
    out.append(all(set(r) == req for r in L['scenes'].values()))
    out.append(all((r['sat'] is None) == (r['regime'] is None) and (r['sat'] is None) == (r['terrain'] is None) for r in L['scenes'].values()))
    rec = R.summary_from_scenes(L['scenes'])
    stored = {k: L['summary'][k] for k in rec}
    out.append(json.dumps(rec, sort_keys=True) == json.dumps(stored, sort_keys=True))
    nr = R.n_r(L['scenes'], ('p2026',))
    out.append(nr == L['summary']['NR']['p2026'] == L['period']['NR']['p2026'])
    sun = L['summary']['sunset']
    okp = True
    for site, pp in sun.items():
        for P, x in pp.items():
            rs = [r for r in L['scenes'].values() if r['site'] == site and r['period'] == P]
            okp = okp and x['pass'] == R._ratio([r['regime'] for r in rs if r['sat'] is not None])
            okp = okp and x['passAll'] == R._ratio([r['passes']['aqua']['regime'] for r in rs if r['passes']['aqua']['nPasses'] == 1])
    out.append(okp)
    imgs = set()
    union_ok = True
    for k, r in L['scenes'].items():
        f = r['fetch']
        here = []
        if f['primary']:
            here.append(r['sat'])
        if f['other']:
            here.append(r['other']['sat'])
        for v in ('ct300', 'ct520'):
            if f[v]:
                here.append(r['variants'][v]['sat'])
        union_ok = union_ok and len(here) == len(set(here))
        imgs.update((r['site'], r['date'], s) for s in here)
    out.append(union_ok and len(imgs) == L['summary']['fetchImages']['union'])
    out.append(A['sources']['regimeListSha256'] == R.sha256_file(STATE['list_path']))
    return all(out), f'{sum(out)}/{len(out)} checks; rows {len(L["scenes"])}; images {len(imgs)}'


@test('R-DATA', stages=('full',))
def t_data():
    c, so, se = run_cli(STATE['list_args'] + ['--out', tmp('data-list.json'), '--axes-out', tmp('data-axes.json')])
    same = (c == 0 and R.sha256_file(tmp('data-list.json')) == R.sha256_file(STATE['list_path'])
            and R.sha256_file(tmp('data-axes.json')) == R.sha256_file(STATE['axes_path']))
    cnt = STATE['list_doc']['summary']['counts']
    det = '; '.join(f'{gp} rows {v["rows"]} scenes {v["scene"]["aqua"] + v["scene"]["terra"]}' for gp, v in sorted(cnt.items()))
    return same, f'rebuild exit {c} byte-identical {same}; {det}'


# ───────────────────────── runner ─────────────────────────
def main(argv):
    def opt(k, d=None):
        return argv[argv.index(k) + 1] if k in argv else d
    stage = 'full' if '--full' in argv else ('pre-count' if '--pre-count' in argv else None)
    shear, f1 = opt('--shear-def'), opt('--f1-variant')
    if stage is None or shear not in R.SHEAR_DEFS or f1 not in R.F1_VARIANTS:
        print('usage: regime-test.py --pre-count|--full --shear-def zi01|sfc --f1-variant solar|solar+utc', file=sys.stderr)
        return 2
    R.install_guard_s5a()
    STATE.update({'stage': stage, 'shear': shear, 'f1': f1})
    if stage == 'full':
        lp = R.absp(opt('--list', R.P_LIST))
        ap = R.absp(opt('--axes', R.P_AXES))
        with open(lp, encoding='utf-8') as f:
            STATE['list_doc'] = json.load(f)
        with open(ap, encoding='utf-8') as f:
            STATE['axes_doc'] = json.load(f)
        STATE['list_path'], STATE['axes_path'] = lp, ap
        L = STATE['list_doc']
        args = ['list', '--shear-def', L['shearDefinition'], '--f1-variant', L['f1Variant']]
        if L['build']['provisional']:
            args.append('--provisional')
        if L['build']['soundingExt']:
            args += ['--sounding-ext', L['build']['soundingExt']]
        STATE['list_args'] = args
    lines = []
    nfail = 0
    run = [(tid, fn) for tid, fn, st in TESTS if stage in st]
    for tid, fn in run:
        try:
            ok, det = fn()
        except Exception as e:  # noqa: BLE001 — a crash is a FAIL with its type only
            ok, det = False, f'exception {type(e).__name__}: {str(e)[:160]}'
        nfail += int(not ok)
        line = f'{tid} {"PASS" if ok else "FAIL"} {det}'
        lines.append(line)
        print(line, flush=True)
    head = [f'regime_ref.py sha256 {R.sha256_file(REF_PATH)}', f'regime-test.py sha256 {R.sha256_file(os.path.abspath(__file__))}',
            f'stage {stage}', f'shearDef {shear}', f'f1Variant {f1}']
    if stage == 'full':
        head.append(f'list {R.relp(STATE["list_path"])} sha256 {R.sha256_file(STATE["list_path"])}')
    last = f'ALL PASS {len(run)}/{len(run)}' if nfail == 0 else f'FAIL {nfail}/{len(run)}'
    with open(R.absp(R.P_TEST_TXT), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(head + lines + [last]) + '\n')
    print(last)
    ev = opt('--emit-vectors')
    if ev:
        with open(R.absp(ev), 'w', encoding='utf-8') as f:
            f.write(R.dumps_json({'schema': 'regime-g7-vectors/1', 'vectors': VECTORS}))
    return 0 if nfail == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
