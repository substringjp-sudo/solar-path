#!/usr/bin/env python3
"""
regime_ref.py — RULER-regime (3판 고침 1) reference selector and S5a list builder (design: regime/S5-design.md §1).
Pure module + CLI. The app's `blRegime.ts` must equal `select()` (G7). English comments; `Lnnn` = RULER-regime.md line.

  python3 -I tools/genus-ruler/regime/regime_ref.py count --shear-def zi01|sfc --f1-variant solar|solar+utc
                                    [--sounding .harness/oro/sounding.json] [--sounding-ext .harness/oro/sounding-regime-ext.json]
                                    [--sat-times tools/genus-ruler/regime/sat-times.json.gz] [--test-record tools/genus-ruler/regime/regime-test.txt]
  python3 -I tools/genus-ruler/regime/regime_ref.py list  --shear-def … --f1-variant … [--sounding …] [--sounding-ext …] [--sat-times …]
                                    [--test-record …] [--provisional] [--out tools/genus-ruler/regime/regime-list.json]
                                    [--axes-out tools/genus-ruler/regime/regime-shift-axes.json]
  python3 -I tools/genus-ruler/regime/regime_ref.py summary [--list tools/genus-ruler/regime/regime-list.json]

Exit codes: 0 ok · 2 bad argument · 3 extension needed and missing/partial (list without --provisional; count with a partial
extension) · 4 precondition (§0.5 step 0) failed. Stdout: COUNT/NR/WROTE/SUMMARY lines only (counts, statuses, sha256 —
all MODIS-free). `count` writes no file. `--provisional` (S5-design §Q-43): the L633 provisional list — p2026 rows (plus
p2025 when a complete extension is given and the period rule needs it), written even when the rule needs a missing extension.

Contamination (§0.1): no satellite image is requested or opened; CMR metadata (times, polygons, day flag), the best_match
sounding, the DEM grid and the frozen oro code are the only inputs. The S5a open guard is installed by the CLI and by
regime-test.py (never at import).
"""
import sys
sys.dont_write_bytecode = True

import ast
import gzip
import hashlib
import json
import math
import os
import types
from datetime import date as Date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

# ───────────────────────── §1.2 constants (exact values) ─────────────────────────
PERIODS = {'p2026': ('2026-06-01', '2026-10-31'), 'p2025': ('2025-06-01', '2025-10-31')}       # L93, L145
SAT_ORDER = ('aqua', 'terra')                       # L147 (Aqua first)
PASS_GAP_S = 1800                                   # L152 (start-to-start, Q-4)
CT_MAX_KM = 430.0                                   # L85, L196 (inclusive)
F2_HIGH_LT = 0.5
F2_PRECIP_LE = 0.5                                  # L197
PL = (1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500)    # selector profile levels (Q-9)
UV_LEVELS = (925, 850, 700)
Z10_M = 10.0                                        # L255, L254
SUN_MIN = 20.0
SW_MIN = 300.0
DTHV_MIN = -0.5                                     # L75 (all >=)
CAPE_NONE = 1000.0
PRECIP_NONE = 0.5
LCL_ZI_NONE = 300.0                                 # L76, L280
LOW_MIN = 0.05
LCL_LOW_LT = 3000.0                                 # L272
ZI_DISORG = 1100.0                                  # L74, L281
U_ROLL = 6.0
SHEAR_ROLL = 2e-3                                   # L73, L282
U_AXIS = 2.0                                        # L77, L264
PARCEL_DTHV = 0.5
ZI_CLIP = (100.0, 3000.0)                           # L251-L252
MARGIN = {'U6': 0.01, 'shear': 1e-6, 'zi1100': 1.0, 'lclZi300': 1.0, 'sun20': 0.01, 'sw300': 0.5,
          'dthv': 0.001, 'cape1000': 1.0, 'precip05': 0.001, 'low005': 0.0005, 'axis2': 0.01}   # L78
NR_MIN = 60                                         # L215
SHIFT_U = tuple(range(-45, -9)) + tuple(range(10, 46))   # 72 values, L88, L362
SHIFT_WIN = 7
SHIFT_MIN_GAP = 10                                  # L363
SUNSET_ALT = (-2.0, 8.0)
SUNSET_DESC_MIN = 30                                # L209; oro Q-42
NONE_SAMPLE = 0.2
NONE_SEED = '20261103'                              # L180
SHEAR_DEFS = ('zi01', 'sfc')                        # L258 / L259-L261; no default (§O-1)
F1_VARIANTS = ('solar', 'solar+utc')                # L152-L153 / §O-2 candidate; no default
GIBS_EDGE_H = 2.0                                   # §O-2
CT_SENS_KM = (300.0, 520.0)                         # §7 L537 arms (inclusive)
LCL_M_PER_K = 125
LCL_MIN_M = 150
LCL_MAX_M = 3500
ML_DEPTH_M = 600
MAGNUS_A = 17.625
MAGNUS_B = 243.04                                   # cloudSkeleton SK, dewPointC
ORO_REF_SHA256 = '88a600ba7f3df178ca9e46437826e19354f84dd13c9dcd7c4f5e87f9a01576f2'
REGIMES = ('NA', 'NONE', 'DISORG', 'ROLL', 'CELL')
CONVECTIVE = ('DISORG', 'CELL', 'ROLL')
R_EARTH_KM = 6371.0

# ── paths (repo-relative, §0.4) ──
P_ORO_REF = 'tools/genus-ruler/oro/oro_ref.py'
P_ORO_GEOM = 'tools/genus-ruler/oro/oro-geom.py'
P_ORO_FROZEN = 'tools/genus-ruler/oro/FROZEN.json'
P_DEM_GRIDS = 'tools/genus-ruler/oro/dem-grids.json'
P_ORO_APPLY = 'tools/genus-ruler/oro/oro-apply.json'
P_ORO_INPUTS = 'tools/genus-ruler/oro/oro-inputs.json'
P_SND_MAN = 'tools/genus-ruler/oro/sounding-manifest.json'
P_EXT_MAN = 'tools/genus-ruler/oro/sounding-regime-ext-manifest.json'
P_FETCH_SND = 'tools/genus-ruler/oro/fetch-sounding.py'
P_FETCH_SAT = 'tools/genus-ruler/macro/fetch-sat.py'
P_FETCH_SAT_TIMES = 'tools/genus-ruler/regime/fetch-sat-times.py'
P_SAT_TIMES = 'tools/genus-ruler/regime/sat-times.json.gz'
P_SND = '.harness/oro/sounding.json'
P_SND_EXT = '.harness/oro/sounding-regime-ext.json'
P_LIST = 'tools/genus-ruler/regime/regime-list.json'
P_AXES = 'tools/genus-ruler/regime/regime-shift-axes.json'
P_TEST_TXT = 'tools/genus-ruler/regime/regime-test.txt'
P_SELF = 'tools/genus-ruler/regime/regime_ref.py'
FROZEN_CHECK = (P_ORO_REF, P_DEM_GRIDS, P_FETCH_SND, P_SND_MAN, P_ORO_GEOM, P_ORO_APPLY)   # §0.5 step 0(b)


def absp(relpath):
    return relpath if os.path.isabs(relpath) else os.path.join(ROOT, *relpath.split('/'))


def relp(path):
    return os.path.relpath(os.path.abspath(path), ROOT).replace(os.sep, '/')


# ───────────────────────── §1.1 frozen oro code (executed from its bytes) ─────────────────────────
def load_frozen(name, relpath, sha256):
    """Read the bytes, require their sha256, compile and exec into a fresh module (no .pyc read or written)."""
    p = absp(relpath)
    with open(p, 'rb') as f:
        b = f.read()
    h = hashlib.sha256(b).hexdigest()
    if h != sha256:
        raise RuntimeError(f'{relpath}: sha256 {h} != frozen {sha256}')
    m = types.ModuleType(name)
    m.__file__ = p
    exec(compile(b, p, 'exec'), m.__dict__)
    return m


O = None
ORO_LOAD_ERROR = None
try:
    O = load_frozen('oro_ref', P_ORO_REF, ORO_REF_SHA256)
except Exception as _e:  # noqa: BLE001 — reported as precondition (c) by the CLI
    ORO_LOAD_ERROR = f'{type(_e).__name__}: {_e}'


# ───────────────────────── §0.1 S5a open guard ─────────────────────────
_READ_FILES = frozenset([
    'tools/genus-ruler/regime/regime_ref.py', 'tools/genus-ruler/regime/regime-test.py', 'tools/genus-ruler/regime/regime-test.txt',
    'tools/genus-ruler/regime/fetch-sat-times.py', 'tools/genus-ruler/regime/sat-times.json.gz',
    'tools/genus-ruler/regime/regime-list.json', 'tools/genus-ruler/regime/regime-shift-axes.json',
    'tools/genus-ruler/oro/oro_ref.py', 'tools/genus-ruler/oro/oro-geom.py', 'tools/genus-ruler/oro/FROZEN.json',
    'tools/genus-ruler/oro/dem-grids.json', 'tools/genus-ruler/oro/oro-apply.json', 'tools/genus-ruler/oro/oro-inputs.json',
    'tools/genus-ruler/oro/sounding-manifest.json', 'tools/genus-ruler/oro/sounding-regime-ext-manifest.json',
    'tools/genus-ruler/oro/fetch-sounding.py', 'tools/genus-ruler/macro/fetch-sat.py',
    '.harness/oro/sounding.json', '.harness/oro/sounding-regime-ext.json',
])
_WRITE_FILES = frozenset([
    'tools/genus-ruler/regime/regime-list.json', 'tools/genus-ruler/regime/regime-shift-axes.json',
    'tools/genus-ruler/regime/regime-test.txt',
])
# read + write trees; `.harness/regime/provisional/` is the provisional-list location of this task (S5-design §Q-43)
_RW_DIRS = ('.harness/regime/test-tmp/', '.harness/regime/lcl-bundle/', '.harness/regime/provisional/')
_FORBIDDEN_ABS = ('/scratchpad/restore/',)
_s5a_installed = False


def _allowed(r, mode):
    if any(r.startswith(d) for d in _RW_DIRS):
        return True
    if mode == 'w':
        return r in _WRITE_FILES
    return r in _READ_FILES or r in _WRITE_FILES


def s5a_verdict(path, mode):
    """Pure decision (no open): 'read' | 'write' | 'outside' | 'forbidden'. abspath and realpath must both be allowed."""
    a = os.path.abspath(os.fsdecode(path))
    cands = [a]
    try:
        r = os.path.realpath(a)
        if r != a:
            cands.append(r)
    except (OSError, ValueError):
        pass
    inside = False
    for p in cands:
        if any(s in p for s in _FORBIDDEN_ABS):
            return 'forbidden'
        rp = os.path.relpath(p, ROOT).replace(os.sep, '/')
        if rp == '..' or rp.startswith('../'):
            continue
        inside = True
        if not _allowed(rp, mode):
            return 'forbidden'
    if not inside:
        return 'outside'
    return 'write' if mode == 'w' else 'read'


_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC


def _s5a_hook(event, args):
    if event != 'open' or not args:
        return
    p = args[0]
    if p is None or isinstance(p, int):
        return
    try:
        p = os.fsdecode(p)
    except (TypeError, ValueError):
        return
    mode = args[1] if len(args) > 1 else None
    flags = args[2] if len(args) > 2 else 0
    if isinstance(mode, str):
        w = any(c in mode for c in 'wax+')
    else:
        w = bool((flags or 0) & _WRITE_FLAGS)
    if s5a_verdict(p, 'w' if w else 'r') == 'forbidden':
        raise PermissionError(f'regime guard: {relp(p)}')


def install_guard_s5a():
    """oro_ref.install_guard() (frozen deny list) + the S5a allow-list hook. Called first by the CLI and regime-test.py."""
    global _s5a_installed
    if O is not None:
        O.install_guard()
    if not _s5a_installed:
        sys.addaudithook(_s5a_hook)
        _s5a_installed = True


def guard_installed():
    return _s5a_installed


# ───────────────────────── §1.1 verbatim copies of oro-geom.py (R-GEOM0 compares the text) ─────────────────────────
def point_in_poly(lat, lon, poly):
    """(lat, lon) 가 폴리곤 안인가 — 경도 ±180 경계는 폴리곤 경도를 기준점 근처로 감아서 처리."""
    pts = [(la, ((lo - lon + 540) % 360) - 180 + lon) for la, lo in poly]
    inside = False; n = len(pts)
    for i in range(n):
        la1, lo1 = pts[i]; la2, lo2 = pts[(i + 1) % n]
        if (lo1 > lon) != (lo2 > lon):
            t = (lon - lo1) / (lo2 - lo1) if lo2 != lo1 else 0
            if lat < la1 + t * (la2 - la1): inside = not inside
    return inside


def parse_polygons(polys):
    """CMR `polygons` (list of rings of 'lat lon lat lon …' strings) → list of [(lat, lon), …] (same parse as fetch-modis-time)."""
    out = []
    for ring in (polys or []):
        for pstr in ring:
            nums = [float(x) for x in pstr.split()]
            out.append([(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)])
    return out


def _gc_dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


def _bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.degrees(math.atan2(y, x)) % 360.0


def _midpoint(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    bx = math.cos(la2) * math.cos(lo2 - lo1)
    by = math.cos(la2) * math.sin(lo2 - lo1)
    la = math.atan2(math.sin(la1) + math.sin(la2), math.sqrt((math.cos(la1) + bx) ** 2 + by ** 2))
    lo = lo1 + math.atan2(by, math.cos(la1) + bx)
    return math.degrees(la), ((math.degrees(lo) + 540.0) % 360.0) - 180.0


def _ns_dist(bearing):
    """Angular distance of a bearing from the north–south axis (0 = N–S, 90 = E–W)."""
    b = bearing % 180.0
    return min(b, 180.0 - b)


def cross_track_km(poly, site):
    """R-G7: (km | None, status). The closing vertex is dropped first (D8); ≠ 4 distinct vertices → 'nonquad'."""
    pts = list(poly)
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) != 4 or len(set(pts)) != 4:
        return None, 'nonquad'
    e = [(pts[i], pts[(i + 1) % 4]) for i in range(4)]
    pairs = [(e[0], e[2]), (e[1], e[3])]
    score = [0.5 * (_ns_dist(_bearing(*a)) + _ns_dist(_bearing(*b))) for a, b in pairs]
    ca, cb = pairs[0] if score[0] >= score[1] else pairs[1]
    m1, m2 = _midpoint(*ca), _midpoint(*cb)
    d13 = _gc_dist(m1, site) / R_EARTH_KM
    th13 = math.radians(_bearing(m1, site))
    th12 = math.radians(_bearing(m1, m2))
    return abs(math.asin(math.sin(d13) * math.sin(th13 - th12))) * R_EARTH_KM, 'ok'


def _centroid(poly):
    pts = poly[:-1] if (len(poly) >= 2 and poly[0] == poly[-1]) else poly
    la = sum(p[0] for p in pts) / len(pts)
    lo0 = pts[0][1]
    lo = sum(((p[1] - lo0 + 540) % 360) - 180 + lo0 for p in pts) / len(pts)
    return la, ((lo + 540) % 360) - 180


GEOM_COPIES = ('point_in_poly', 'parse_polygons', '_gc_dist', '_bearing', '_midpoint', '_ns_dist', 'cross_track_km', '_centroid')


# ───────────────────────── small helpers ─────────────────────────
def fmt_utc(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_utc(s):
    """CMR / list time string → aware UTC datetime; sub-second parts must be zero."""
    t = datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
    tail = s[19:].rstrip('Z')
    if tail and tail.strip('.0') != '':
        raise ValueError(f'non-zero sub-second time {s!r}')
    return t


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def dumps_json(obj):
    return O.dumps_json(obj)


def period_dates(period):
    a, b = (Date.fromisoformat(x) for x in PERIODS[period])
    return [(a + timedelta(days=k)).isoformat() for k in range((b - a).days + 1)]


def period_of(d):
    for p in sorted(PERIODS):
        a, b = PERIODS[p]
        if a <= d <= b:
            return p
    return None


def day_index(d, period):
    return (Date.fromisoformat(d) - Date.fromisoformat(PERIODS[period][0])).days


def _median(v):
    s = sorted(v)
    n = len(s)
    if n == 0:
        return None
    return float(s[n // 2]) if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


# ───────────────────────── §1.3 sites ─────────────────────────
_SITES = None


def sites():
    """{site: (lat, lon, group)} sorted (fetch-sat SITES through the frozen oro_ref.sites_table)."""
    global _SITES
    if _SITES is None:
        _SITES = O.sites_table()
    return dict(_SITES)


def sites_from_source(relpath):
    """SITES dict literal of a fetcher script, read with ast (no execution) → {site: (lat, lon, group)} (R-SITES)."""
    with open(absp(relpath), encoding='utf-8') as f:
        tree = ast.parse(f.read())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SITES' for t in node.targets):
            S = ast.literal_eval(node.value)
            out = {}
            for g in ('dev', 'held'):
                for s, (la, lo) in S[g].items():
                    out[s] = (la, lo, g)
            return {k: out[k] for k in sorted(out)}
    raise ValueError(f'{relpath}: no SITES')


def site_class(a1):
    """§6.1 split (Q-36): mountain ⇔ A1 rms h_sub ≥ 100 m."""
    return 'mountain' if a1 is not None and a1 >= O.A1_RMS_M else 'flat'


# ───────────────────────── §1.4 CMR passes, scene time, filter 1 ─────────────────────────
def load_sat_times(path):
    with gzip.open(path, 'rt') as f:
        return json.load(f)


def cmr_check(doc, site_names, periods=('p2026', 'p2025')):
    """Every used query (site × sat × period) present exactly once with hits == nReturned (L651). → (ok, problems)."""
    probs = []
    for site in sorted(site_names):
        for sat in SAT_ORDER:
            for per in periods:
                qs = [q for q in doc.get('queries', []) if q.get('site') == site and q.get('sat') == sat and q.get('period') == per]
                if len(qs) != 1:
                    probs.append(f'{site}/{sat}/{per}: {len(qs)} queries')
                elif qs[0].get('hits') != qs[0].get('nReturned'):
                    probs.append(f'{site}/{sat}/{per}: hits {qs[0].get("hits")} != nReturned {qs[0].get("nReturned")}')
    return (not probs), probs


def solar_date(t, lon):
    """Mean-solar date (L150): (t + lon/15 h).date()."""
    return (t + timedelta(hours=lon / 15.0)).date().isoformat()


def day_granules(q):
    """DAY granules of one query (Q-2), duplicates by time_start collapsed: {start, end, polygons:[all copies' rings]}."""
    seen = {}
    for g in q.get('granules') or []:
        s = g['time_start']
        if s in seen:
            if seen[s]['end'] != g['time_end'] or seen[s]['flag'] != g['day_night_flag']:
                raise ValueError(f'CMR duplicate {s} differs in end/flag')
        else:
            seen[s] = {'end': g['time_end'], 'flag': g['day_night_flag'], 'rings': []}
        seen[s]['rings'].extend(parse_polygons(g.get('polygons')))
    out = [{'start': s, 'end': v['end'], 'polygons': v['rings']} for s, v in seen.items() if v['flag'] == 'DAY']
    out.sort(key=lambda g: parse_utc(g['start']))
    return out


def group_passes(grans, lon):
    """Q-4/Q-5: start-to-start gap ≤ 1800 s joins; pass = {start, end, mid, solarDate, grans}."""
    groups = []
    prev = None
    for g in grans:
        st = parse_utc(g['start'])
        if groups and (st - prev).total_seconds() <= PASS_GAP_S:
            groups[-1].append(g)
        else:
            groups.append([g])
        prev = st
    out = []
    for gs in groups:
        a = min(parse_utc(g['start']) for g in gs)
        b = max(parse_utc(g['end']) for g in gs)
        mid = a + (b - a) / 2
        if mid.microsecond != 0:
            raise ValueError(f'pass mid not whole seconds: {gs[0]["start"]}')
        out.append({'start': a, 'end': b, 'mid': mid, 'solarDate': solar_date(mid, lon), 'grans': gs})
    return out


def site_polygon(pas, lat, lon):
    """First ring (granules by start, copies in file order) containing the site → ('pip', ring); else the ring with the nearest
    centroid → ('centroid', ring) (oro-geom R-G7 rule)."""
    for g in pas['grans']:
        for ring in g['polygons']:
            if point_in_poly(lat, lon, ring):
                return 'pip', ring
    best = None
    for g in pas['grans']:
        for ring in g['polygons']:
            d = _gc_dist(_centroid(ring), (lat, lon))
            if best is None or d < best[0]:
                best = (d, ring)
    return ('centroid', best[1]) if best else (None, None)


def _track_mids(poly):
    """m1, m2 of cross_track_km (same edge choice), or None for a non-quad."""
    pts = list(poly)
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) != 4 or len(set(pts)) != 4:
        return None
    e = [(pts[i], pts[(i + 1) % 4]) for i in range(4)]
    pairs = [(e[0], e[2]), (e[1], e[3])]
    score = [0.5 * (_ns_dist(_bearing(*a)) + _ns_dist(_bearing(*b))) for a, b in pairs]
    ca, cb = pairs[0] if score[0] >= score[1] else pairs[1]
    return _midpoint(*ca), _midpoint(*cb)


def _destination(p, bearing_rad, dist_rad):
    la1, lo1 = math.radians(p[0]), math.radians(p[1])
    la2 = math.asin(math.sin(la1) * math.cos(dist_rad) + math.cos(la1) * math.sin(dist_rad) * math.cos(bearing_rad))
    lo2 = lo1 + math.atan2(math.sin(bearing_rad) * math.sin(dist_rad) * math.cos(la1),
                           math.cos(dist_rad) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), ((math.degrees(lo2) + 540.0) % 360.0) - 180.0


def norm_axis(a):
    a = a % 180.0
    return 0.0 if a >= 180.0 else a


def scan_axis_deg(ring, site):
    """Axis (math convention, [0, 180)) of the cross-track (scan) direction at the point of the track nearest the site."""
    mm = _track_mids(ring)
    if mm is None:
        return None
    m1, m2 = mm
    d13 = _gc_dist(m1, site) / R_EARTH_KM
    th13 = math.radians(_bearing(m1, site))
    th12 = math.radians(_bearing(m1, m2))
    dat = math.atan2(math.sin(d13) * math.cos(th13 - th12), math.cos(d13))
    if abs(dat) < 1e-9:
        beta = math.degrees(th12)
    else:
        P = _destination(m1, th12, dat)
        if _gc_dist(P, m2) < 1e-6:
            beta = (_bearing(P, m1) + 180.0) % 360.0
        else:
            beta = _bearing(P, m2)
    return norm_axis(-beta)


def ct_ok(ct, limit):
    return ct is not None and ct <= limit


def build_passes(q, lon):
    """(all passes of the query, {solarDate: [passes]} for every solar date)."""
    allp = group_passes(day_granules(q), lon)
    by = {}
    for p in allp:
        by.setdefault(p['solarDate'], []).append(p)
    return allp, by


def pass_info_from(allp, by_day, d, period, lat, lon, f1_variant):
    """§1.4 pass_info for (site, sat, date)."""
    ps = by_day.get(d, [])
    n = len(ps)
    base = {'nPasses': n, 'passMidUtc': None, 'granuleStarts': None, 'ctKm': None, 'ctStatus': None, 'ctPolyHow': None,
            'scanAxisDeg': None, 'filter1': False, 'f1Reason': None, 'gibsDate': None, 'utcDayPasses': None,
            'gibsAmbiguous': None, 'ctSens': {'300': False, '520': False}}
    if n == 0:
        base['f1Reason'] = 'none'
        return base
    if n >= 2:
        base['f1Reason'] = 'multiPass'
        return base
    pas = ps[0]
    how, ring = site_polygon(pas, lat, lon)
    if ring is None:
        ct, st = None, 'nopoly'
    else:
        ct, st = cross_track_km(ring, (lat, lon))
    mid = pas['mid']
    gd = mid.date()
    others = sum(1 for q in allp if q is not pas and q['mid'].date() == gd)
    if others > 0:
        amb = True
    else:
        first, last = PERIODS[period]
        m0 = datetime(gd.year, gd.month, gd.day, tzinfo=timezone.utc)
        near = min(mid - m0, m0 + timedelta(days=1) - mid) <= timedelta(hours=GIBS_EDGE_H)
        amb = None if (d in (first, last) and near) else False
    gibs_ok = (amb is False) if f1_variant == 'solar+utc' else True
    geo_ok = st == 'ok'
    f1 = bool(geo_ok and ct_ok(ct, CT_MAX_KM) and gibs_ok)
    reason = None
    if not f1:
        reason = 'ct' if not (geo_ok and ct_ok(ct, CT_MAX_KM)) else 'gibs'
    base.update({'passMidUtc': fmt_utc(mid), 'granuleStarts': [g['start'] for g in pas['grans']],
                 'ctKm': ct, 'ctStatus': st, 'ctPolyHow': how,
                 'scanAxisDeg': scan_axis_deg(ring, (lat, lon)) if st == 'ok' else None,
                 'filter1': f1, 'f1Reason': reason, 'gibsDate': gd.isoformat(), 'utcDayPasses': others,
                 'gibsAmbiguous': amb,
                 'ctSens': {str(int(k)): bool(geo_ok and ct_ok(ct, k) and gibs_ok) for k in CT_SENS_KM}})
    return base


# ───────────────────────── §1.5 sounding access and interpolation ─────────────────────────
INTERP_OK = ('exact', 'linear', 'fallback2')


def load_soundings(path):
    return O.load_soundings(path)


def _interp_list(snd, arr, t):
    v, how = O.interp_fallback(snd.times, arr, t, snd.index)
    return float(v) if how in INTERP_OK and v is not None else None


def interp_na(snd, var, t):
    """§2.2 (L170-L171): both bracketing sides (nearest valid hour within ±3 h, inclusive) or NA (oro 'fallback1' refused)."""
    return _interp_list(snd, snd.series(var), t)


def _w10(snd):
    c = getattr(snd, '_regime_w10', None)
    if c is None:
        U, V = [], []
        for a, d in zip(snd.series('wind_speed_10m'), snd.series('wind_direction_10m')):
            if a is None or d is None:
                U.append(None)
                V.append(None)
            else:
                u, v = O.wind_to_uv(a, d)
                U.append(u)
                V.append(v)
        c = (U, V)
        snd._regime_w10 = c
    return c


def uv_na(snd, level, t):
    """(u, v) at t (components interpolated separately) or None."""
    U, V = _w10(snd) if level == '10m' else snd.wind(level)
    u = _interp_list(snd, U, t)
    v = _interp_list(snd, V, t)
    return None if (u is None or v is None) else (u, v)


def read_vars():
    """The Open-Meteo hourly keys inputs_at reads (§1.6 key map; R-VARS, regimeNulls)."""
    v = ['temperature_2m', 'dew_point_2m', 'cape', 'boundary_layer_height', 'precipitation', 'shortwave_radiation',
         'cloud_cover_low', 'cloud_cover_high', 'wind_speed_10m', 'wind_direction_10m']
    for p in PL:
        v += [f'geopotential_height_{p}hPa', f'temperature_{p}hPa', f'relative_humidity_{p}hPa']
    for p in UV_LEVELS:
        v += [f'wind_speed_{p}hPa', f'wind_direction_{p}hPa']
    return sorted(v)


def inputs_at(snd, site, t, latlon=None):
    """§1.6 selector input vector at UTC t (the G7 interface)."""
    lat, lon = latlon if latlon is not None else sites()[site][:2]

    def f(var):
        return interp_na(snd, var, t)
    low = f('cloud_cover_low')
    high = f('cloud_cover_high')
    w10 = uv_na(snd, '10m', t)
    levels = []
    for p in PL:
        e = {'p': p, 'zM': f(f'geopotential_height_{p}hPa'), 'tC': f(f'temperature_{p}hPa'),
             'rhPct': f(f'relative_humidity_{p}hPa'), 'u': None, 'v': None}
        if p in UV_LEVELS:
            w = uv_na(snd, p, t)
            if w is not None:
                e['u'], e['v'] = w
        levels.append(e)
    return {'tUtc': fmt_utc(t), 'site': site, 'zSfcM': None if snd.elevation is None else float(snd.elevation),
            'sunAltDeg': float(O.sun_alt_deg(t, lat, lon)),
            't2mC': f('temperature_2m'), 'td2mC': f('dew_point_2m'), 'capeJkg': f('cape'), 'blhM': f('boundary_layer_height'),
            'precipMm': f('precipitation'), 'swWm2': f('shortwave_radiation'),
            'lowFrac': None if low is None else low / 100.0, 'highFrac': None if high is None else high / 100.0,
            'wind10': None if w10 is None else [w10[0], w10[1]], 'levels': levels}


# ───────────────────────── §1.7 thermodynamics ─────────────────────────
def profile(inp):
    """(kept levels p-descending, NA names). Deep-underground levels (z_std(p) < z_sfc − 500 m) with a null are dropped."""
    zs = inp.get('zSfcM')
    kept, na = [], []
    for e in sorted((x for x in inp['levels'] if x['p'] in PL), key=lambda x: -x['p']):
        p, z, t, rh = e['p'], e['zM'], e['tC'], e['rhPct']
        deep = zs is not None and O.z_std(p) < zs - O.UNDERGROUND_MARGIN_M
        if deep and (z is None or t is None or rh is None):
            continue
        miss = [nm for nm, v in (('Z', z), ('T', t), ('RH', rh)) if v is None]
        if miss:
            na += [f'{nm}{p}' for nm in miss]
            continue
        kept.append(e)
    for a, b in zip(kept, kept[1:]):
        if not b['zM'] > a['zM']:
            na.append('Zorder')
            break
    return kept, na


def p_sfc(kept, zs):
    """ln p linear in z through the Z profile, extrapolating with the end pair (L239). Needs ≥ 2 kept levels."""
    Z = [e['zM'] for e in kept]
    L = [math.log(e['p']) for e in kept]
    n = len(Z)
    if zs < Z[0]:
        i = 0
    elif zs >= Z[-1]:
        i = n - 2
    else:
        i = 0
        for j in range(n - 1):
            if Z[j] <= zs < Z[j + 1]:
                i = j
                break
    return math.exp(L[i] + (zs - Z[i]) * (L[i + 1] - L[i]) / (Z[i + 1] - Z[i]))


def theta_v_level(T, RH, p):
    return O.theta_v(T, RH, p)


def theta_v_2m(T2m, Td2m, psfc):
    e = O.e_s(Td2m)
    q = 0.622 * e / (psfc - 0.378 * e)
    return O.theta(T2m, psfc) * (1.0 + (O.RV / O.RD - 1.0) * q)


def first_level(kept, zs):
    for e in kept:
        if e['zM'] > zs:
            return e
    return None


def dew_point_c(tC, rhPct):
    """cloudSkeleton.dewPointC (Magnus inverse)."""
    a, b = MAGNUS_A, MAGNUS_B
    g = math.log(max(1, min(100, rhPct)) / 100) + (a * tC) / (b + tC)
    return (b * g) / (a - g)


def _fin(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def lcl_agl_th(th):
    """Verbatim port of cloudSkeleton.lclAglM (115fbe2) on a ThermoInput-like dict; sums left to right (no fsum)."""
    if not th or not _fin(th.get('t2mC')) or not _fin(th.get('td2mC')):
        return None
    g = th['groundM'] if _fin(th.get('groundM')) else 0
    pts = [(0, max(0, th['t2mC'] - th['td2mC']))]
    rh = th.get('rhLevels') or []
    for l in th.get('levels') or []:
        z = l['zM'] - g
        if not _fin(z) or z <= 10 or z > ML_DEPTH_M:
            continue
        r = None
        for x in rh:
            if abs(x['zM'] - l['zM']) < 1 and _fin(x['rhPct']):
                r = x
                break
        if r is None:
            continue
        pts.append((z, max(0, l['tC'] - dew_point_c(l['tC'], r['rhPct']))))
    sz = 0
    sd = 0
    for z, _ in pts:
        sz = sz + z
    for _, d in pts:
        sd = sd + d
    z0 = sz / len(pts)
    dep = sd / len(pts)
    return min(LCL_MAX_M, max(LCL_MIN_M, z0 + LCL_M_PER_K * dep))


def thermo_input(zs, T2m, Td2m, kept):
    return {'groundM': zs, 't2mC': T2m, 'td2mC': Td2m,
            'levels': [{'zM': e['zM'], 'tC': e['tC'], 'pHPa': e['p']} for e in kept],
            'rhLevels': [{'zM': e['zM'], 'rhPct': e['rhPct']} for e in kept]}


def lcl_agl(zs, T2m, Td2m, kept):
    """LCL (m AGL) = lclAglM on the ThermoInput the app builds from the same profile (Q-11)."""
    return float(lcl_agl_th(thermo_input(zs, T2m, Td2m, kept)))


# ───────────────────────── §1.8 zi ─────────────────────────
def zi_of(inp, kept, thv2m):
    """(zi m, source). BLH finite → BLH unclipped (Q-12); else parcel θ_v > θ_v(2 m) + 0.5 K, clipped to [100, 3000]."""
    blh = inp.get('blhM')
    if blh is not None:
        return float(blh), 'blh'
    zs = inp['zSfcM']
    nodes = [(zs + 2.0, thv2m)] + [(e['zM'], theta_v_level(e['tC'], e['rhPct'], e['p'])) for e in kept if e['zM'] > zs + 2.0]
    return parcel_zi(nodes, zs, thv2m + PARCEL_DTHV)


def parcel_zi(nodes, zs, thr):
    """First segment whose upper θ_v exceeds thr (strict), linear crossing height, AGL clipped to [100, 3000]; none → 3000."""
    for (z0, t0), (z1, t1) in zip(nodes, nodes[1:]):
        if t1 > thr:
            zst = z0 + (z1 - z0) * (thr - t0) / (t1 - t0)
            agl = zst - zs
            if agl < ZI_CLIP[0]:
                return ZI_CLIP[0], 'parcel-clip-lo'
            if agl > ZI_CLIP[1]:
                return ZI_CLIP[1], 'parcel-clip-hi'
            return agl, 'parcel'
    return ZI_CLIP[1], 'parcel-none'


# ───────────────────────── §1.9 wind profile, U_CBL, shear ─────────────────────────
def wind_levels(inp, kept, zs):
    """[(Z, (u, v) | None, name)] for kept p ∈ {925, 850, 700} with Z > z_sfc + 10 (Q-14), increasing Z."""
    lv = {e['p']: e for e in inp['levels']}
    keptp = {e['p'] for e in kept}
    out = []
    for p in UV_LEVELS:
        if p not in keptp:
            continue
        e = lv[p]
        if e['zM'] > zs + Z10_M:
            w = None if (e.get('u') is None or e.get('v') is None) else (e['u'], e['v'])
            out.append((e['zM'], w, f'wind{p}'))
    out.sort(key=lambda x: x[0])
    return out


def wind_nodes(inp, kept, zs, zi):
    """(nodes [(z, (u, v))], NA names). Required: V10 and every node level up to and including the first above z_sfc + zi."""
    w10 = inp['wind10']
    nodes = [(zs + Z10_M, (w10[0], w10[1]))]
    na = []
    for Z, w, nm in wind_levels(inp, kept, zs):
        if w is None:
            na.append(nm)
        else:
            nodes.append((Z, w))
        if Z > zs + zi:
            break
    return nodes, na


def V_at(nodes, z):
    """Piecewise linear in z; below the first node → V10; at/above the last node → held (Q-15)."""
    if z <= nodes[0][0]:
        return nodes[0][1]
    if z >= nodes[-1][0]:
        return nodes[-1][1]
    for (z0, v0), (z1, v1) in zip(nodes, nodes[1:]):
        if z < z1:
            f = (z - z0) / (z1 - z0)
            return (v0[0] + (v1[0] - v0[0]) * f, v0[1] + (v1[1] - v0[1]) * f)
    return nodes[-1][1]


def u_cbl(nodes, zs, zi):
    """((u, v), speed, degenerate): trapezoid mean over [z_sfc + 10, z_sfc + zi] (L254)."""
    zb, zt = zs + Z10_M, zs + zi
    v10 = nodes[0][1]
    if zt <= zb:
        return (v10[0], v10[1]), math.hypot(v10[0], v10[1]), True
    pts = [(zb, v10)] + [(z, v) for z, v in nodes[1:] if zb < z < zt] + [(zt, V_at(nodes, zt))]
    su = 0.0
    sv = 0.0
    for (z0, a), (z1, b) in zip(pts, pts[1:]):
        su += (z1 - z0) * (a[0] + b[0]) / 2.0
        sv += (z1 - z0) * (a[1] + b[1]) / 2.0
    D = zt - zb
    u, v = su / D, sv / D
    return (u, v), math.hypot(u, v), False


def shear(nodes, zs, zi, defn):
    """(s⁻¹, (Su, Sv), degenerate). zi01 = |V(zi) − V(0.1 zi)|/(0.9 zi) (L258); sfc = |V(zi) − V10|/zi (L259, L261)."""
    if defn not in SHEAR_DEFS:
        raise ValueError(f'shear definition {defn!r}')
    if zi <= 0:
        return 0.0, (0.0, 0.0), True
    vt = V_at(nodes, zs + zi)
    if defn == 'zi01':
        vb = V_at(nodes, zs + 0.1 * zi)
        den = 0.9 * zi
    else:
        vb = nodes[0][1]
        den = zi
    S = (vt[0] - vb[0], vt[1] - vb[1])
    return math.hypot(S[0], S[1]) / den, S, False


def s01_vec(nodes, zs, zi):
    """The L264 weak-wind axis vector V(z_sfc + zi) − V(z_sfc + 0.1 zi), whatever the shear definition (Q-33)."""
    if zi <= 0:
        return (0.0, 0.0)
    a = V_at(nodes, zs + zi)
    b = V_at(nodes, zs + 0.1 * zi)
    return (a[0] - b[0], a[1] - b[1])


# ───────────────────────── §1.10 θ_CBL ─────────────────────────
def axis_deg(u, v):
    a = math.degrees(math.atan2(v, u)) % 180.0
    if a >= 180.0:
        a = 0.0
    return a


def theta_cbl(U, S01):
    if math.hypot(U[0], U[1]) >= U_AXIS:
        return axis_deg(U[0], U[1]), 'wind'
    if math.hypot(S01[0], S01[1]) > 0:
        return axis_deg(S01[0], S01[1]), 'shear'
    return 0.0, 'none'


# ───────────────────────── §1.11–§1.14 the tree ─────────────────────────
def convective_of(sun, sw, dthv):
    return bool(sun >= SUN_MIN and sw >= SW_MIN and dthv >= DTHV_MIN)


def low_cloud_of(low, lcl):
    return bool(low >= LOW_MIN and lcl < LCL_LOW_LT)


def decide(d):
    """The tree (L276-L283) on derived scalars: keys na, convective, lclM, zi, lowCloud, capeJkg, precipMm, ucblSpeed, shear."""
    if d['na']:
        return 'NA'
    if ((not d['convective']) or d['lclM'] > d['zi'] + LCL_ZI_NONE or (not d['lowCloud'])
            or (d['capeJkg'] is not None and d['capeJkg'] >= CAPE_NONE) or d['precipMm'] > PRECIP_NONE):
        return 'NONE'
    if d['zi'] < ZI_DISORG:
        return 'DISORG'
    if d['ucblSpeed'] >= U_ROLL or d['shear'] >= SHEAR_ROLL:
        return 'ROLL'
    return 'CELL'


def margins_of(d, inp):
    """§1.14: |x − threshold| ≤ margin on the reference value, every key, whichever condition decided."""
    vals = {'U6': (d['ucblSpeed'], U_ROLL), 'shear': (d['shear'], SHEAR_ROLL), 'zi1100': (d['zi'], ZI_DISORG),
            'lclZi300': (d['lclM'] - d['zi'], LCL_ZI_NONE), 'sun20': (inp['sunAltDeg'], SUN_MIN), 'sw300': (inp['swWm2'], SW_MIN),
            'dthv': (d['dThvK'], DTHV_MIN), 'cape1000': (inp.get('capeJkg'), CAPE_NONE), 'precip05': (inp['precipMm'], PRECIP_NONE),
            'low005': (inp['lowFrac'], LOW_MIN), 'axis2': (d['ucblSpeed'], U_AXIS)}
    return {k: (False if x is None else bool(abs(x - th) <= MARGIN[k])) for k, (x, th) in sorted(vals.items())}


_NA_RESULT_KEYS = ('thetaCblDeg', 'axisSource', 'zi', 'ziSource', 'pSfcHPa', 'thetaV2mK', 'thetaV1K', 'firstLevelP', 'dThvK',
                   'lclM', 'convective', 'lowCloud', 'capeSkipped', 'ucbl', 'ucblSpeed', 'shear', 'shearVec', 'axisVec',
                   'degenerate', 'nodes')


def _na_result(na):
    r = {k: None for k in _NA_RESULT_KEYS}
    r.update({'regime': 'NA', 'na': sorted(set(na)), 'margins': {}, 'nearBoundary': False})
    return r


def derive(inp, shear_def):
    """Everything the tree needs, or the NA result. Pure function of the §1.6 input object."""
    if shear_def not in SHEAR_DEFS:
        raise ValueError(f'shear definition {shear_def!r}')
    na = [k for k in ('zSfcM', 't2mC', 'td2mC', 'precipMm', 'swWm2', 'lowFrac') if inp.get(k) is None]
    if inp.get('wind10') is None:
        na.append('wind10')
    kept, na_p = profile(inp)
    na += na_p
    zs = inp.get('zSfcM')
    psfc = fl = None
    if zs is not None:
        if len(kept) < 2:
            na.append('psfc')
        else:
            psfc = p_sfc(kept, zs)
        fl = first_level(kept, zs)
        if fl is None:
            na.append('firstLevel')
    if na:
        return None, _na_result(na)
    T2m, Td2m = inp['t2mC'], inp['td2mC']
    thv2m = theta_v_2m(T2m, Td2m, psfc)
    thv1 = theta_v_level(fl['tC'], fl['rhPct'], fl['p'])
    dthv = thv2m - thv1
    lcl = lcl_agl(zs, T2m, Td2m, kept)
    zi, zsrc = zi_of(inp, kept, thv2m)
    nodes, na_w = wind_nodes(inp, kept, zs, zi)
    if na_w:
        return None, _na_result(na_w)
    U, spd, degu = u_cbl(nodes, zs, zi)
    sh, svec, degs = shear(nodes, zs, zi, shear_def)
    S01 = s01_vec(nodes, zs, zi)
    th, src = theta_cbl(U, S01)
    d = {'na': [], 'zi': zi, 'ziSource': zsrc, 'pSfcHPa': psfc, 'thetaV2mK': thv2m, 'thetaV1K': thv1, 'firstLevelP': fl['p'],
         'dThvK': dthv, 'lclM': lcl, 'convective': convective_of(inp['sunAltDeg'], inp['swWm2'], dthv),
         'lowCloud': low_cloud_of(inp['lowFrac'], lcl), 'capeSkipped': inp.get('capeJkg') is None,
         'capeJkg': inp.get('capeJkg'), 'precipMm': inp['precipMm'],
         'ucbl': [U[0], U[1]], 'ucblSpeed': spd, 'shear': sh, 'shearVec': [svec[0], svec[1]], 'axisVec': [S01[0], S01[1]],
         'degenerate': {'ucbl': degu, 'shear': degs}, 'nodes': [[z, v[0], v[1]] for z, v in nodes],
         'thetaCblDeg': th, 'axisSource': src, '_kept': kept, '_nodes': nodes}
    return d, None


def select(inp, shear_def, variant='main'):
    """§1.13 the selector (main) and the §1.22 sensitivity arms ('blhOnly', 'u850', 'ed1')."""
    d, na_res = derive(inp, shear_def)
    if variant == 'blhOnly' and inp.get('blhM') is None:
        return {'regime': 'NA*', 'thetaCblDeg': None}
    if d is None:
        return na_res if variant == 'main' else {'regime': 'NA', 'thetaCblDeg': None}
    if variant in ('main', 'blhOnly'):
        r = {k: v for k, v in d.items() if not k.startswith('_') and k not in ('capeJkg', 'precipMm')}
        r['regime'] = decide(d)
        r['margins'] = margins_of(d, inp)
        r['nearBoundary'] = any(r['margins'].values())
        return r
    zs, zi = inp['zSfcM'], d['zi']
    if variant == 'u850':
        lv = {e['p']: e for e in inp['levels']}
        e = lv.get(850)
        if e is None or e.get('u') is None or e.get('v') is None:
            return {'regime': 'NA*', 'thetaCblDeg': None}
        U = (e['u'], e['v'])
        th, _ = theta_cbl(U, tuple(d['axisVec']))
        dd = dict(d, ucblSpeed=math.hypot(U[0], U[1]))
        return {'regime': decide(dd), 'thetaCblDeg': th}
    if variant == 'ed1':
        w10 = inp['wind10']
        cand = [(e['zM'], e) for e in d['_kept'] if e['p'] in UV_LEVELS]
        layer = [e for Z, e in cand if zs < Z <= zs + zi]
        if not layer:
            above = [e for Z, e in sorted(cand, key=lambda x: x[0]) if Z > zs]
            layer = above[:1]
            if not layer:
                return {'regime': 'NA*', 'thetaCblDeg': None}
        if any(e.get('u') is None or e.get('v') is None for e in layer):
            return {'regime': 'NA*', 'thetaCblDeg': None}
        vs = [(w10[0], w10[1])] + [(e['u'], e['v']) for e in sorted(layer, key=lambda e: e['zM'])]
        su = sv = 0.0
        for a, b in vs:
            su += a
            sv += b
        U = (su / len(vs), sv / len(vs))
        if zi <= 0:
            sh = 0.0
        else:
            vt = V_at(d['_nodes'], zs + zi)
            sh = math.hypot(vt[0] - w10[0], vt[1] - w10[1]) / zi
        dd = dict(d, ucblSpeed=math.hypot(U[0], U[1]), shear=sh)
        return {'regime': decide(dd), 'thetaCblDeg': axis_deg(U[0], U[1])}
    raise ValueError(f'variant {variant!r}')


# ───────────────────────── §1.15 filter 2 ─────────────────────────
def filter2(inp):
    if inp is None or inp.get('highFrac') is None or inp.get('precipMm') is None:
        return None
    return bool(inp['highFrac'] < F2_HIGH_LT and inp['precipMm'] <= F2_PRECIP_LE)


# ───────────────────────── §1.16 terrain flag (frozen oro_ref functions) ─────────────────────────
def terrain(site, t, osnd, cache, dg):
    lat = dg['sites'][site]['lat']
    ent = cache.get(site)
    a1 = None if ent is None else float(ent['a1'])
    a1ok = bool(ent is not None and ent['a1'] >= O.A1_RMS_M)
    ref = O.ref_values(osnd, t, dg['sites'][site]['zRefM'], lat, None, None)
    usable = not ref['refEmpty']
    a2 = bool(usable and ref['speedRef'] is not None and ref['speedRef'] >= O.A2_SPEED)
    a3 = bool(usable and ref['N2'] is not None and ref['N2'] >= O.A3_N2)
    return {'a1RmsM': a1, 'a1': a1ok, 'speedRef': None if ref['speedRef'] is None else float(ref['speedRef']), 'a2': a2,
            'N2': None if ref['N2'] is None else float(ref['N2']), 'a3': a3, 'refEmpty': bool(ref['refEmpty']),
            'missing': list(ref['missing']), 'flag': bool(a1ok and a2 and a3)}


# ───────────────────────── build context ─────────────────────────
class Ctx:
    """Everything a build reads: sites, CMR doc, soundings per period, DEM grids; definitions from the CLI."""
    def __init__(self, sat_doc, snd, shear_def, f1_variant, dg, sites_tab=None):
        if shear_def not in SHEAR_DEFS or f1_variant not in F1_VARIANTS:
            raise ValueError('definitions')
        self.sites = sites_tab if sites_tab is not None else sites()
        self.doc = sat_doc
        self.q = {}
        for q in sat_doc.get('queries', []):
            self.q[(q['site'], q['sat'], q['period'])] = q
        self.snd = snd
        self.shear_def = shear_def
        self.f1_variant = f1_variant
        self.dg = dg
        self.cache = O.SiteCache(dg) if dg is not None else None
        self._passes = {}

    def passes(self, site, sat, period):
        k = (site, sat, period)
        if k not in self._passes:
            q = self.q.get(k)
            self._passes[k] = build_passes(q, self.sites[site][1]) if q is not None else ([], {})
        return self._passes[k]

    def pass_info(self, site, sat, period, d):
        allp, by = self.passes(site, sat, period)
        la, lo, _ = self.sites[site]
        return pass_info_from(allp, by, d, period, la, lo, self.f1_variant)

    def a1(self, site):
        if self.cache is None:
            return None
        ent = self.cache.get(site)
        return None if ent is None else float(ent['a1'])

    def row_sites(self, period):
        """Sites with a row in this period: all 10 for p2026; held only for p2025 (L165). Sites without a sounding have none."""
        out = []
        for s in sorted(self.sites):
            if period == 'p2025' and self.sites[s][2] != 'held':
                continue
            if s in (self.snd.get(period) or {}):
                out.append(s)
        return out


def _choose(pis, evs, ok_of):
    for sat in SAT_ORDER:
        if ok_of(pis[sat]) and evs[sat] is not None and evs[sat]['f2'] is True:
            return sat, None
    return None, ('filter2' if any(ok_of(pis[s]) for s in SAT_ORDER) else 'filter1')


def scene_row(ctx, site, d, period, with_terrain=True):
    """One (site, date) row of regime-list.json (§1.18)."""
    lat, lon, group = ctx.sites[site]
    snd = ctx.snd[period][site]
    pis, evs = {}, {}
    for sat in SAT_ORDER:
        pi = ctx.pass_info(site, sat, period, d)
        ev = None
        if pi['nPasses'] == 1:
            t = parse_utc(pi['passMidUtc'])
            inp = inputs_at(snd, site, t, (lat, lon))
            ev = {'t': t, 'inp': inp, 'f2': filter2(inp), 'res': select(inp, ctx.shear_def)}
        pis[sat], evs[sat] = pi, ev
    sat, excl = _choose(pis, evs, lambda p: p['filter1'])
    passes = {}
    for s in SAT_ORDER:
        ev = evs[s]
        passes[s] = dict(pis[s], filter2=None if ev is None else ev['f2'],
                         highFrac=None if ev is None else ev['inp']['highFrac'],
                         precipMm=None if ev is None else ev['inp']['precipMm'],
                         regime=None if ev is None else ev['res']['regime'])
    a1 = ctx.a1(site)
    row = {'site': site, 'date': d, 'group': group, 'siteClass': site_class(a1), 'period': period, 'passes': passes,
           'sat': sat, 'excluded': excl, 'passUtc': None, 'crossTrackKm': None, 'sunAltDeg': None, 'inputs': None,
           'regime': None, 'thetaCblDeg': None, 'axisSource': None, 'derived': None, 'na': [], 'margins': {},
           'nearBoundary': False, 'terrain': None, 'other': None, 'sens': None, 'variants': {}, 'fetch': None}
    if sat is not None:
        ev = evs[sat]
        res = ev['res']
        row.update({'passUtc': pis[sat]['passMidUtc'], 'crossTrackKm': pis[sat]['ctKm'], 'sunAltDeg': ev['inp']['sunAltDeg'],
                    'inputs': ev['inp'], 'regime': res['regime'], 'thetaCblDeg': res['thetaCblDeg'],
                    'axisSource': res['axisSource'], 'derived': res, 'na': list(res['na']), 'margins': res['margins'],
                    'nearBoundary': res['nearBoundary']})
        if with_terrain and ctx.dg is not None:
            row['terrain'] = terrain(site, ev['t'], snd, ctx.cache, ctx.dg)
        o = SAT_ORDER[1] if sat == SAT_ORDER[0] else SAT_ORDER[0]
        oe = evs[o]
        row['other'] = {'sat': o, 'filter12': bool(pis[o]['filter1'] and oe is not None and oe['f2'] is True),
                        'regime': None if oe is None else oe['res']['regime'],
                        'thetaCblDeg': None if oe is None else oe['res']['thetaCblDeg']}
        sens = {}
        for arm in ('blhOnly', 'u850', 'ed1'):
            rr = select(ev['inp'], ctx.shear_def, arm)
            sens[arm] = rr['regime']
            if arm != 'blhOnly':
                sens[arm + 'Theta'] = rr['thetaCblDeg']
        row['sens'] = sens
    for k in ('300', '520'):
        vs, vx = _choose(pis, evs, lambda p, k=k: p['ctSens'][k])
        if vs is None:
            row['variants']['ct' + k] = {'sat': None, 'excluded': vx, 'passUtc': None, 'regime': None, 'thetaCblDeg': None}
        else:
            r = evs[vs]['res']
            row['variants']['ct' + k] = {'sat': vs, 'excluded': None, 'passUtc': pis[vs]['passMidUtc'],
                                         'regime': r['regime'], 'thetaCblDeg': r['thetaCblDeg']}
    return row


def build_rows(ctx, period, with_terrain=True):
    rows = {}
    for site in ctx.row_sites(period):
        for d in period_dates(period):
            rows[f'{site}_{d}'] = scene_row(ctx, site, d, period, with_terrain)
    return rows


# ───────────────────────── §1.17 N_R and the period rule ─────────────────────────
def n_r(rows, periods):
    return sum(1 for r in rows.values() if r['group'] == 'held' and r['period'] in periods and r['sat'] is not None
               and r['regime'] == 'ROLL')


class ExtensionNeeded(Exception):
    pass


def choose_periods(nr2026, ext_complete, provisional):
    """L213-L219 → (periods, status). Raises ExtensionNeeded (exit 3) when 2025 is needed and missing, unless provisional."""
    if nr2026 >= NR_MIN:
        return ['p2026'], 'final'
    if ext_complete:
        return ['p2026', 'p2025'], 'final'
    if provisional:
        return ['p2026'], 'extension needed (R10) and missing'
    raise ExtensionNeeded('N_R(p2026) < 60 and the extension sounding is missing or partial')


def ext_status(snd_ext, manifest):
    """(complete, sites): all 8 held sites present in the file and the manifest, manifest period = p2025 (L651)."""
    held = sorted(s for s, v in sites().items() if v[2] == 'held')
    have = sorted(s for s in (snd_ext or {}) if s in held)
    man_sites = sorted((manifest or {}).get('sites', {}))
    per_ok = bool(manifest) and manifest.get('start') == PERIODS['p2025'][0] and manifest.get('end') == PERIODS['p2025'][1]
    complete = bool(per_ok and have == held and all(s in man_sites for s in held))
    return complete, have


# ───────────────────────── §1.19 fetch flags and the NONE sample ─────────────────────────
def none_sample(rows):
    out = set()
    for g in ('dev', 'held'):
        keys = sorted(k for k, r in rows.items() if r['group'] == g and r['sat'] is not None and r['regime'] == 'NONE')
        keys.sort(key=lambda k: hashlib.sha256(f'{NONE_SEED}:{k}'.encode('utf-8')).hexdigest())
        k_ = (2 * len(keys) + 5) // 10          # = ⌊0.2 n + 0.5⌋ exactly
        out.update(keys[:k_])
    return out


def set_fetch_flags(rows):
    samp = none_sample(rows)
    for k in sorted(rows):
        r = rows[k]
        primary = bool(r['sat'] is not None and (r['regime'] in CONVECTIVE or k in samp))
        other = bool(r['sat'] is not None and r['regime'] in CONVECTIVE and r['other'] is not None and r['other']['filter12'])
        imgs = set()
        if primary:
            imgs.add(r['sat'])
        if other:
            imgs.add(r['other']['sat'])
        fl = {'primary': primary, 'other': other, 'noneSample': k in samp}
        for v in ('ct300', 'ct520'):
            vv = r['variants'][v]
            fl[v] = bool(vv['sat'] is not None and vv['regime'] in CONVECTIVE and vv['sat'] not in imgs)
        r['fetch'] = fl


# ───────────────────────── §1.20 shift axes ─────────────────────────
def shift_pick(day_i, pool, u):
    """Nearest pool day to day_i + u within ±7 with |d − day_i| ≥ 10 (ties → earlier); else the same for −u; else None."""
    def find(w):
        tgt = day_i + w
        c = [d for d in pool if abs(d - tgt) <= SHIFT_WIN and abs(d - day_i) >= SHIFT_MIN_GAP]
        return min(c, key=lambda d: (abs(d - tgt), d)) if c else None
    r = find(u)
    return find(-u) if r is None else r


def shift_axes(ctx, rows):
    scenes = {}
    for key in sorted(rows):
        r = rows[key]
        if r['group'] != 'held' or r['sat'] is None or r['regime'] != 'ROLL':
            continue
        P = r['period']
        lat, lon, _ = ctx.sites[r['site']]
        snd = ctx.snd[P][r['site']]
        ti = parse_utc(r['passUtc'])
        di = day_index(r['date'], P)
        n = len(period_dates(P))
        reg, f2s, th = [], [], []
        for dd in range(n):
            inp = inputs_at(snd, r['site'], ti + timedelta(days=dd - di), (lat, lon))
            res = select(inp, ctx.shear_def)
            reg.append(res['regime'])
            f2s.append(filter2(inp))
            th.append(res['thetaCblDeg'])
        pool = [dd for dd in range(n) if reg[dd] == 'ROLL' and f2s[dd] is True]
        scenes[key] = {'site': r['site'], 'date': r['date'], 'period': P, 'sat': r['sat'], 'passUtc': r['passUtc'],
                       'dayIndex': di, 'days': {'regime': reg, 'filter2': f2s, 'thetaCblDeg': th}, 'pool': pool}
    per = {}
    for s in sorted({v['site'] for v in scenes.values()}):
        sc = [v for v in scenes.values() if v['site'] == s]
        shares = [sum(1 for u in SHIFT_U if shift_pick(v['dayIndex'], v['pool'], u) is None) / len(SHIFT_U) for v in sc]
        per[s] = {'nScenes': len(sc), 'poolMedian': _median([len(v['pool']) for v in sc]),
                  'selfAxisShareExpected': sum(shares) / len(shares)}
    return scenes, per


# ───────────────────────── §1.21 sunset ratios ─────────────────────────
def sun_phase(t, lat, lon):
    """'evening' | 'morning' | None: −2° ≤ alt ≤ 8° (inclusive) and descending/ascending against t − 30 min (oro Q-42)."""
    a = O.sun_alt_deg(t, lat, lon)
    if not (SUNSET_ALT[0] <= a <= SUNSET_ALT[1]):
        return None
    return phase_of(a, O.sun_alt_deg(t - timedelta(minutes=SUNSET_DESC_MIN), lat, lon))


def phase_of(a, b):
    """a = altitude at t, b = altitude at t − 30 min."""
    if not (SUNSET_ALT[0] <= a <= SUNSET_ALT[1]):
        return None
    if a < b:
        return 'evening'
    if a > b:
        return 'morning'
    return None


def _ratio(regs):
    n = len(regs)
    nna = sum(1 for x in regs if x == 'NA')
    nroll = sum(1 for x in regs if x == 'ROLL')
    return {'n': n, 'nNA': nna, 'nROLL': nroll, 'frac': (nroll / (n - nna)) if n - nna > 0 else None}


def sunset_hours(ctx, site, period):
    lat, lon, _ = ctx.sites[site]
    snd = ctx.snd[period][site]
    a, b = PERIODS[period]
    out = {'evening': [], 'morning': []}
    for hk in snd.times:
        if not (a <= hk[:10] <= b):
            continue
        t = O.parse_hour(hk)
        ph = sun_phase(t, lat, lon)
        if ph is None:
            continue
        out[ph].append(select(inputs_at(snd, site, t, (lat, lon)), ctx.shear_def)['regime'])
    return out


def sunset_summary(ctx, rows, periods):
    res = {}
    for P in periods:
        for site in ctx.row_sites(P):
            hrs = sunset_hours(ctx, site, P)
            rs = [r for r in rows.values() if r['site'] == site and r['period'] == P]
            res.setdefault(site, {})[P] = {
                'evening': _ratio(hrs['evening']), 'morning': _ratio(hrs['morning']),
                'pass': _ratio([r['regime'] for r in rs if r['sat'] is not None]),
                'passAll': _ratio([r['passes']['aqua']['regime'] for r in rs if r['passes']['aqua']['nPasses'] == 1])}
    return res


# ───────────────────────── §1.18 summary (recomputable from scenes) ─────────────────────────
def _cnt_block():
    return {'rows': 0, 'f1Aqua': 0, 'f1Terra': 0, 'f1Either': 0, 'f12Aqua': 0, 'f12Terra': 0,
            'scene': {'aqua': 0, 'terra': 0}, 'excluded': {'filter1': 0, 'filter2': 0},
            'regime': {k: 0 for k in REGIMES}, 'naNames': {}, 'nearBoundary': 0, 'capeSkipped': 0, 'parcelZi': 0, 'NR': 0}


def _add(c, r):
    pa, pt = r['passes']['aqua'], r['passes']['terra']
    c['rows'] += 1
    c['f1Aqua'] += int(pa['filter1'])
    c['f1Terra'] += int(pt['filter1'])
    c['f1Either'] += int(pa['filter1'] or pt['filter1'])
    c['f12Aqua'] += int(pa['filter1'] and pa['filter2'] is True)
    c['f12Terra'] += int(pt['filter1'] and pt['filter2'] is True)
    if r['sat'] is None:
        c['excluded'][r['excluded']] += 1
        return
    c['scene'][r['sat']] += 1
    c['regime'][r['regime']] += 1
    for nm in r['na']:
        c['naNames'][nm] = c['naNames'].get(nm, 0) + 1
    c['nearBoundary'] += int(r['nearBoundary'])
    if r['regime'] != 'NA':
        c['capeSkipped'] += int(r['derived']['capeSkipped'])
        c['parcelZi'] += int(r['derived']['ziSource'] != 'blh')
    c['NR'] += int(r['group'] == 'held' and r['regime'] == 'ROLL')


def summary_from_scenes(scenes):
    counts, per_site = {}, {}
    f1r = {'multiPass': 0, 'ct': 0, 'gibs': 0, 'none': 0}
    gibs = {}
    fetch = {'primary': 0, 'other': 0, 'ct300': 0, 'ct520': 0, 'union': 0}
    roll_t = {g: {'n': 0, 'terrainTrue': 0, 'share': None} for g in ('dev', 'held')}
    per_roll = {}
    for k in sorted(scenes):
        r = scenes[k]
        gp = f'{r["group"]}/{r["period"]}'
        c = counts.setdefault(gp, _cnt_block())
        _add(c, r)
        _add(per_site.setdefault(r['site'], {}).setdefault(r['period'], _cnt_block()), r)
        for s in SAT_ORDER:
            rs = r['passes'][s]['f1Reason']
            if rs is not None:
                f1r[rs] += 1
        gb = gibs.setdefault(gp, {x: {'true': 0, 'null': 0} for x in ('aqua', 'terra', 'scene', 'other')})
        for s in SAT_ORDER:
            p = r['passes'][s]
            if p['filter1']:
                gb[s]['true'] += int(p['gibsAmbiguous'] is True)
                gb[s]['null'] += int(p['gibsAmbiguous'] is None)
        if r['sat'] is not None:
            p = r['passes'][r['sat']]
            gb['scene']['true'] += int(p['gibsAmbiguous'] is True)
            gb['scene']['null'] += int(p['gibsAmbiguous'] is None)
            if r['other']['filter12']:
                p = r['passes'][r['other']['sat']]
                gb['other']['true'] += int(p['gibsAmbiguous'] is True)
                gb['other']['null'] += int(p['gibsAmbiguous'] is None)
            if r['regime'] == 'ROLL':
                roll_t[r['group']]['n'] += 1
                roll_t[r['group']]['terrainTrue'] += int(bool(r['terrain'] and r['terrain']['flag']))
                per_roll.setdefault(r['site'], {}).setdefault(r['period'], 0)
                per_roll[r['site']][r['period']] += 1
        fl = r['fetch'] or {}
        imgs = set()
        for f in ('primary', 'other', 'ct300', 'ct520'):
            fetch[f] += int(bool(fl.get(f)))
        if fl.get('primary'):
            imgs.add(r['sat'])
        if fl.get('other'):
            imgs.add(r['other']['sat'])
        for v in ('ct300', 'ct520'):
            if fl.get(v):
                imgs.add(r['variants'][v]['sat'])
        fetch['union'] += len(imgs)
    for g in roll_t:
        if roll_t[g]['n']:
            roll_t[g]['share'] = roll_t[g]['terrainTrue'] / roll_t[g]['n']
    for c in list(counts.values()) + [x for v in per_site.values() for x in v.values()]:
        c['naNames'] = dict(sorted(c['naNames'].items()))
    return {'counts': counts, 'perSiteCounts': per_site, 'f1Reasons': f1r, 'gibsUtcAmbiguous': gibs,
            'fetchImages': fetch, 'rollTerrain': roll_t, 'perSiteRoll': per_roll}


# ───────────────────────── list assembly ─────────────────────────
def constants():
    return {'PERIODS': {k: list(v) for k, v in sorted(PERIODS.items())}, 'SAT_ORDER': list(SAT_ORDER), 'PASS_GAP_S': PASS_GAP_S,
            'CT_MAX_KM': CT_MAX_KM, 'F2_HIGH_LT': F2_HIGH_LT, 'F2_PRECIP_LE': F2_PRECIP_LE, 'PL': list(PL),
            'UV_LEVELS': list(UV_LEVELS), 'Z10_M': Z10_M, 'SUN_MIN': SUN_MIN, 'SW_MIN': SW_MIN, 'DTHV_MIN': DTHV_MIN,
            'CAPE_NONE': CAPE_NONE, 'PRECIP_NONE': PRECIP_NONE, 'LCL_ZI_NONE': LCL_ZI_NONE, 'LOW_MIN': LOW_MIN,
            'LCL_LOW_LT': LCL_LOW_LT, 'ZI_DISORG': ZI_DISORG, 'U_ROLL': U_ROLL, 'SHEAR_ROLL': SHEAR_ROLL, 'U_AXIS': U_AXIS,
            'PARCEL_DTHV': PARCEL_DTHV, 'ZI_CLIP': list(ZI_CLIP), 'MARGIN': dict(sorted(MARGIN.items())), 'NR_MIN': NR_MIN,
            'SHIFT_U': list(SHIFT_U), 'SHIFT_WIN': SHIFT_WIN, 'SHIFT_MIN_GAP': SHIFT_MIN_GAP, 'SUNSET_ALT': list(SUNSET_ALT),
            'SUNSET_DESC_MIN': SUNSET_DESC_MIN, 'NONE_SAMPLE': NONE_SAMPLE, 'NONE_SEED': NONE_SEED, 'GIBS_EDGE_H': GIBS_EDGE_H,
            'CT_SENS_KM': list(CT_SENS_KM), 'LCL_M_PER_K': LCL_M_PER_K, 'LCL_MIN_M': LCL_MIN_M, 'LCL_MAX_M': LCL_MAX_M,
            'ML_DEPTH_M': ML_DEPTH_M, 'MAGNUS_A': MAGNUS_A, 'MAGNUS_B': MAGNUS_B, 'ORO_REF_SHA256': ORO_REF_SHA256,
            'UNDERGROUND_MARGIN_M': O.UNDERGROUND_MARGIN_M, 'FALLBACK_H': O.FALLBACK_H}


def build_list(ctx, sources, provisional, ext_complete, ext_info=None):
    """(list doc, axes doc without regimeListSha256). ext_info = {'manifestSha256', 'sites'} when an extension is loaded."""
    rows = build_rows(ctx, 'p2026')
    nr26 = n_r(rows, ('p2026',))
    periods, status = choose_periods(nr26, ext_complete, provisional)
    if 'p2025' in periods:
        rows.update(build_rows(ctx, 'p2025'))
    nr_all = n_r(rows, tuple(periods)) if 'p2025' in periods else None
    set_fetch_flags(rows)
    axes_scenes, axes_per = shift_axes(ctx, rows)
    summ = summary_from_scenes(rows)
    summ['NR'] = {'p2026': nr26, 'p2026+p2025': nr_all}
    summ['sunset'] = sunset_summary(ctx, rows, periods)
    used = 'p2025' in periods
    period = {'chosen': periods if status == 'final' else None, 'status': status, 'periodsInList': periods,
              'NR': {'p2026': nr26, 'p2026+p2025': nr_all}, 'threshold': NR_MIN,
              'extension': {'used': used, 'manifestSha256': (ext_info or {}).get('manifestSha256') if used else None,
                            'sites': (ext_info or {}).get('sites') if used else None},
              'note': 'P1 미결 가능성 큼' if (used and nr_all is not None and nr_all < NR_MIN) else None}
    doc = {'schema': 'regime-list/1', 'sources': sources, 'constants': constants(), 'shearDefinition': ctx.shear_def,
           'f1Variant': ctx.f1_variant, 'truthInstrument': 'aqua',
           'build': {'provisional': bool(provisional), 'soundingExt': (ext_info or {}).get('path')},
           'period': period, 'scenes': dict(sorted(rows.items())), 'summary': summ}
    axes = {'schema': 'regime-shift-axes/1',
            'sources': {'regimeListSha256': None, 'code': dict(sources.get('code', {}).items()) if sources else {},
                        'env': (sources or {}).get('env')},
            'constants': {'shiftU': list(SHIFT_U), 'window': SHIFT_WIN, 'minGap': SHIFT_MIN_GAP},
            'periods': {P: {'start': PERIODS[P][0], 'end': PERIODS[P][1], 'nDays': len(period_dates(P))} for P in periods},
            'scenes': axes_scenes, 'summary': {'perSite': axes_per}}
    return doc, axes


def serialize(doc, axes):
    s_list = dumps_json(doc)
    axes = dict(axes)
    axes['sources'] = dict(axes['sources'], regimeListSha256=sha256_text(s_list))
    return s_list, dumps_json(axes)


def regime_nulls(snds, manifest):
    """Null counts of every mapped key from the hourly arrays, asserted = manifest `nulls` where the manifest has them (m5)."""
    out = {}
    msites = (manifest or {}).get('sites', {})
    for s in sorted(snds):
        sd = snds[s]
        mn = (msites.get(s) or {}).get('nulls') or {}
        c = {}
        for v in read_vars():
            ser = sd.hourly.get(v)
            n = len(sd.times) if ser is None else sum(1 for x in ser if x is None)
            if v in mn and mn[v] is not None and int(mn[v]) != n:
                raise ValueError(f'{s} {v}: hourly nulls {n} != manifest {mn[v]}')
            c[v] = n
        out[s] = c
    return out


def code_hashes():
    return {'regime_ref.py': sha256_file(absp(P_SELF)), 'oro_ref.py': sha256_file(absp(P_ORO_REF)),
            'oro-geom.py': sha256_file(absp(P_ORO_GEOM)), 'fetch-sat.py': sha256_file(absp(P_FETCH_SAT))}


def file_sources(sat_path, snd_path, snd26, ext_path, snd25, ext_man_path):
    with open(absp(P_SND_MAN)) as f:
        man26 = json.load(f)
    man25 = None
    if ext_path is not None and os.path.exists(ext_man_path):
        with open(ext_man_path) as f:
            man25 = json.load(f)
    return {'satTimesSha256': sha256_file(sat_path), 'fetchSatTimesSha256': sha256_file(absp(P_FETCH_SAT_TIMES)),
            'demGridsSha256': sha256_file(absp(P_DEM_GRIDS)), 'oroFrozenSha256': sha256_file(absp(P_ORO_FROZEN)),
            'code': code_hashes(),
            'sounding': {'p2026': O.sounding_source(snd_path, snd26, absp(P_SND_MAN)),
                         'p2025': O.sounding_source(ext_path, snd25, ext_man_path) if snd25 else None},
            'regimeNulls': {'p2026': regime_nulls(snd26, man26), 'p2025': regime_nulls(snd25, man25) if snd25 else None},
            'env': O.env_record()}


# ───────────────────────── CLI ─────────────────────────
def parse_record(path):
    """regime-test.txt header → dict or None."""
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        lines = [x.rstrip('\n') for x in f]
    hd = {}
    for x in lines[:5]:
        parts = x.split(' ')
        if x.startswith('regime_ref.py sha256 '):
            hd['ref'] = parts[-1]
        elif x.startswith('regime-test.py sha256 '):
            hd['test'] = parts[-1]
        elif x.startswith('stage '):
            hd['stage'] = parts[-1]
        elif x.startswith('shearDef '):
            hd['shearDef'] = parts[-1]
        elif x.startswith('f1Variant '):
            hd['f1Variant'] = parts[-1]
    hd['last'] = lines[-1] if lines else ''
    return hd


def preconditions(opts, need_record):
    """§0.5 step 0 (a)–(d), (g) → None or 'letter: reason'."""
    if not os.path.exists(absp(P_ORO_FROZEN)):
        return '(a) oro/FROZEN.json missing'
    with open(absp(P_ORO_FROZEN)) as f:
        fz = json.load(f)
    for p in FROZEN_CHECK:
        want = (fz.get('files') or {}).get(p)
        if want is None or sha256_file(absp(p)) != want:
            return f'(b) {p} differs from oro/FROZEN.json'
    if ORO_LOAD_ERROR is not None or sha256_file(absp(P_ORO_REF)) != ORO_REF_SHA256:
        return '(c) oro_ref.py != ORO_REF_SHA256'
    try:
        doc = load_sat_times(opts['sat'])
    except (OSError, ValueError) as e:
        return f'(d) sat-times unreadable: {type(e).__name__}'
    ok, probs = cmr_check(doc, sites())
    if not ok:
        return f'(d) CMR queries: {len(probs)} problem(s)'
    if need_record:
        hd = parse_record(opts['record'])
        if hd is None:
            return '(g) regime-test.txt missing'
        if hd.get('ref') != sha256_file(absp(P_SELF)):
            return '(g) regime-test.txt regime_ref.py sha256 differs'
        if hd.get('shearDef') != opts['shear'] or hd.get('f1Variant') != opts['f1']:
            return '(g) regime-test.txt definitions differ from the CLI'
        if hd.get('stage') not in ('pre-count', 'full'):
            return '(g) regime-test.txt stage'
        last = hd.get('last', '')
        if not last.startswith('ALL PASS '):
            return '(g) regime-test.txt last line is not ALL PASS'
    return None


def _parse_args(argv):
    o = {'shear': None, 'f1': None, 'snd': absp(P_SND), 'ext': None, 'sat': absp(P_SAT_TIMES), 'record': absp(P_TEST_TXT),
         'out': absp(P_LIST), 'axes': absp(P_AXES), 'provisional': False, 'list': absp(P_LIST)}
    keys = {'--shear-def': 'shear', '--f1-variant': 'f1', '--sounding': 'snd', '--sounding-ext': 'ext', '--sat-times': 'sat',
            '--test-record': 'record', '--out': 'out', '--axes-out': 'axes', '--list': 'list'}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--provisional':
            o['provisional'] = True
            i += 1
            continue
        if a not in keys or i + 1 >= len(argv):
            raise ValueError(f'bad argument {a!r}')
        v = argv[i + 1]
        o[keys[a]] = v if keys[a] in ('shear', 'f1') else absp(v)
        i += 2
    return o


def count_line(nr26, nr_all, opts, snd_sha):
    rule = 'keep p2026' if nr26 >= NR_MIN else 'extension needed (R10)'
    s = f'COUNT N_R p2026 = {nr26}; rule = {rule}'
    if nr_all is not None:
        s += f'; N_R p2026+p2025 = {nr_all}'
    s += (f'; regime_ref.py {sha256_file(absp(P_SELF))}; shearDef {opts["shear"]}; f1Variant {opts["f1"]}; '
          f'satTimesSha256 {sha256_file(opts["sat"])}; soundingFileSha256 {snd_sha}')
    if nr_all is not None:
        s += f'; soundingExtFileSha256 {sha256_file(opts["ext"])}'
    return s


def _load_ext(opts):
    """(snd25 dict, complete, ext_info) for --sounding-ext."""
    if opts['ext'] is None:
        return {}, False, None
    snd25 = load_soundings(opts['ext'])
    man_path = O.default_sounding_manifest(opts['ext'])
    man = None
    if os.path.exists(man_path):
        with open(man_path) as f:
            man = json.load(f)
    complete, have = ext_status(snd25, man)
    info = {'path': relp(opts['ext']), 'manifestSha256': sha256_file(man_path) if man is not None else None, 'sites': have,
            'manifestPath': man_path}
    return snd25, complete, info


def cmd_count(opts):
    snd26 = load_soundings(opts['snd'])
    snd25, complete, info = _load_ext(opts)
    if opts['ext'] is not None and not complete:
        print('EXTENSION partial or missing: count refused', file=sys.stderr)
        return 3
    with open(absp(P_DEM_GRIDS)) as f:
        dg = json.load(f)
    snd = {'p2026': snd26}
    if complete:
        snd['p2025'] = snd25
    ctx = Ctx(load_sat_times(opts['sat']), snd, opts['shear'], opts['f1'], dg)
    rows = build_rows(ctx, 'p2026', with_terrain=False)
    nr26 = n_r(rows, ('p2026',))
    nr_all = None
    if complete and nr26 < NR_MIN:
        rows.update(build_rows(ctx, 'p2025', with_terrain=False))
        nr_all = n_r(rows, ('p2026', 'p2025'))
    print(count_line(nr26, nr_all, opts, sha256_file(opts['snd'])))
    return 0


def cmd_list(opts):
    snd26 = load_soundings(opts['snd'])
    snd25, complete, info = _load_ext(opts)
    with open(absp(P_DEM_GRIDS)) as f:
        dg = json.load(f)
    snd = {'p2026': snd26}
    if complete:
        snd['p2025'] = snd25
    ctx = Ctx(load_sat_times(opts['sat']), snd, opts['shear'], opts['f1'], dg)
    src = file_sources(opts['sat'], opts['snd'], snd26, opts['ext'] if complete else None, snd25 if complete else None,
                       info['manifestPath'] if info else None)
    try:
        doc, axes = build_list(ctx, src, opts['provisional'], complete, info and {k: info[k] for k in ('path', 'manifestSha256', 'sites')})
    except ExtensionNeeded as e:
        print(f'EXTENSION needed: {e}', file=sys.stderr)
        return 3
    nr = doc['period']['NR']
    print(count_line(nr['p2026'], nr['p2026+p2025'], opts, sha256_file(opts['snd'])))
    print(f'NR p2026 = {nr["p2026"]}; p2026+p2025 = {nr["p2026+p2025"]}; status = {doc["period"]["status"]}')
    s_list, s_axes = serialize(doc, axes)
    for path, s in ((opts['out'], s_list), (opts['axes'], s_axes)):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(s)
        print(f'WROTE {relp(path)} sha256 {sha256_text(s)}')
    return 0


def _fmt_c(c):
    rg = ' '.join(f'{k} {c["regime"][k]}' for k in REGIMES)
    return (f'rows {c["rows"]} f1Aqua {c["f1Aqua"]} f1Terra {c["f1Terra"]} f1Either {c["f1Either"]} '
            f'f12Aqua {c["f12Aqua"]} f12Terra {c["f12Terra"]} scenes(f1∧f2) {c["scene"]["aqua"] + c["scene"]["terra"]} '
            f'(aqua {c["scene"]["aqua"]} terra {c["scene"]["terra"]}) excluded f1 {c["excluded"]["filter1"]} '
            f'f2 {c["excluded"]["filter2"]} | {rg} | heldROLL {c["NR"]}')


def cmd_summary(opts):
    with open(opts['list'], encoding='utf-8') as f:
        doc = json.load(f)
    s = doc['summary']
    print(f'SUMMARY list {relp(opts["list"])} shearDef {doc["shearDefinition"]} f1Variant {doc["f1Variant"]} '
          f'provisional {doc["build"]["provisional"]} status {doc["period"]["status"]}')
    for gp in sorted(s['counts']):
        print(f'GROUP {gp} {_fmt_c(s["counts"][gp])}')
    for site in sorted(s['perSiteCounts']):
        for P in sorted(s['perSiteCounts'][site]):
            print(f'SITE {site} {P} {_fmt_c(s["perSiteCounts"][site][P])}')
    print(f'NR p2026 = {s["NR"]["p2026"]}; p2026+p2025 = {s["NR"]["p2026+p2025"]}')
    for site in sorted(s['sunset']):
        for P in sorted(s['sunset'][site]):
            x = s['sunset'][site][P]
            def f(r):
                fr = 'null' if r['frac'] is None else f'{r["frac"]:.4f}'
                return f'{r["nROLL"]}/{r["n"] - r["nNA"]} = {fr} (n {r["n"]}, NA {r["nNA"]})'
            print(f'SUNSET {site} {P} evening {f(x["evening"])} | pass {f(x["pass"])} | passAllAqua {f(x["passAll"])} '
                  f'| morning {f(x["morning"])}')
    rt = s['rollTerrain']
    print('ROLLTERRAIN ' + ' '.join(f'{g} {rt[g]["terrainTrue"]}/{rt[g]["n"]}' for g in sorted(rt)))
    print('F1REASONS ' + ' '.join(f'{k} {v}' for k, v in sorted(s['f1Reasons'].items())))
    print('FETCH ' + ' '.join(f'{k} {v}' for k, v in sorted(s['fetchImages'].items())))
    return 0


def main(argv):
    if not argv or argv[0] not in ('count', 'list', 'summary'):
        print('usage: regime_ref.py count|list|summary …', file=sys.stderr)
        return 2
    cmd = argv[0]
    try:
        opts = _parse_args(argv[1:])
    except ValueError as e:
        print(f'regime_ref: {e}', file=sys.stderr)
        return 2
    if cmd in ('count', 'list'):
        if opts['shear'] not in SHEAR_DEFS:
            print('regime_ref: --shear-def zi01|sfc is required (no default)', file=sys.stderr)
            return 2
        if opts['f1'] not in F1_VARIANTS:
            print('regime_ref: --f1-variant solar|solar+utc is required (no default)', file=sys.stderr)
            return 2
    install_guard_s5a()
    if cmd == 'summary':
        return cmd_summary(opts)
    bad = preconditions(opts, need_record=True)
    if bad is not None:
        print(f'PRECONDITION {bad}', file=sys.stderr)
        return 4
    return cmd_count(opts) if cmd == 'count' else cmd_list(opts)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
