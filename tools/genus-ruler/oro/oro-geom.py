#!/usr/bin/env python3
"""
oro-geom.py: RULER-oro A8 (seam) and m3 (cross-track distance) from CMR granule metadata only (S3-design §2).
CMR 메타(시각·폴리곤·주야 깃발)만 씁니다. 위성 값·장면 JSON·PNG 는 열지 않습니다.

  python3 -I tools/genus-ruler/oro/oro-geom.py [--banks orig[,ext|,pre2]] [--sat-times tools/genus-ruler/regime/sat-times.json.gz]
                                              [--fetch-missing] [--cache .harness/oro/cmr-extra.json]
                                              [--out tools/genus-ruler/oro/cmr-geom.json]

  R-G1 pass: regroup modis-times `times` (granule starts, gap > 1800 s = new pass); the pass whose mid == modisTimeUtc.
  R-G3 polygons: sat-times.json.gz (CMR point= queries, Terra MOD03, DAY) — only granules containing the site are there.
  R-G4 a corner outside the known polygons while the pass has granules missing from sat-times → with --fetch-missing ask CMR
       (temporal = start .. start + 299 s, ≥ 1 s apart, 3 failures → exit 2, cached); without it → status missing-granules.
  R-G5/G6 A8 = all four window corners (±90 km equirectangular) inside the union of the pass polygons (L296).
  R-G7 cross-track km: site granule quad, track = great circle through the midpoints of the two more east–west edges (Q-24).
Stdout: counts per status only (no corner coordinates).
"""
import sys
sys.dont_write_bytecode = True

import os, json, gzip, math, time, importlib.util, urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('oro_ref', os.path.join(HERE, 'oro_ref.py'))
oro_ref = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(oro_ref)

R_EARTH_KM = 6371.0
PASS_GAP_S = 1800
GRANULE_MIN = 5
WIN_HALF_KM = 90.0
CMR_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD03&temporal={a},{b}&page_size=50'


# ── R-G2: verbatim copy of fetch-modis-time.py point_in_poly (never imported; U-GEOM0 compares the text) ──
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


def _t(s):
    return datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)


def pass_granules(entry):
    """R-G1: granule start strings of the pass whose mid == modisTimeUtc, or None (solar source or no match)."""
    if entry.get('source') == 'solar' or not entry.get('times'):
        return None
    ts = sorted(entry['times'], key=_t)
    groups = [[ts[0]]]
    for s in ts[1:]:
        if (_t(s) - _t(groups[-1][-1])).total_seconds() > PASS_GAP_S:
            groups.append([s])
        else:
            groups[-1].append(s)
    for g in groups:
        a, b = _t(g[0]), _t(g[-1])
        mid = a + (b + timedelta(minutes=GRANULE_MIN) - a) / 2
        if mid.strftime('%Y-%m-%dT%H:%M:%SZ') == entry['modisTimeUtc']:
            return g
    return None


def window_corners(lat0, lon0):
    """R-G5: SW, SE, NE, NW corners of the ±90 km judging window (fetch-sat equirectangular)."""
    dla = WIN_HALF_KM / 111.32
    dlo = WIN_HALF_KM / (111.32 * math.cos(math.radians(lat0)))
    return [(lat0 - dla, lon0 - dlo), (lat0 - dla, lon0 + dlo), (lat0 + dla, lon0 + dlo), (lat0 + dla, lon0 - dlo)]


# ── spherical helpers (R-G7) ──
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


# ── sat-times index and the CMR cache ──
def sat_times_index(path):
    """{(site, start): {'end', 'polygons'}} for Terra DAY granules, plus the periods of every (site) query."""
    with gzip.open(path, 'rt') as f:
        d = json.load(f)
    idx, periods = {}, {}
    for q in d['queries']:
        if q.get('sat') != 'terra':
            continue
        p0, p1 = d['periods'][q['period']]
        periods.setdefault(q['site'], []).append((p0, p1))
        for g in q.get('granules') or []:
            if g.get('day_night_flag') != 'DAY':
                continue
            key = (q['site'], q['period'], g['time_start'])
            if key not in idx:
                idx[key] = {'end': g.get('time_end'), 'polygons': parse_polygons(g.get('polygons'))}
    return idx, {s: sorted(v) for s, v in periods.items()}, d['periods']


def _period_of(periods_def, date):
    for name in sorted(periods_def):
        a, b = periods_def[name]
        if a <= date <= b:
            return name
    return None


class CmrCache:
    def __init__(self, path, fetch):
        self.path = path
        self.fetch = fetch
        self.data = {}
        if os.path.exists(path):
            with open(path) as f:
                self.data = json.load(f)
        self.failures = 0
        self.last = 0.0
        self.dirty = False

    def get(self, start):
        """Cached CMR DAY entries for granule `start` (list of {start, end, polygons}); None if absent and not fetching."""
        if start in self.data:
            return self.data[start]['entries']
        if not self.fetch:
            return None
        t0 = _t(start)
        url = CMR_URL.format(a=t0.strftime('%Y-%m-%dT%H:%M:%SZ'), b=(t0 + timedelta(seconds=299)).strftime('%Y-%m-%dT%H:%M:%SZ'))
        while True:
            wait = 1.0 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    body = json.loads(r.read())
                break
            except Exception as e:  # noqa: BLE001 — network: count and retry
                self.failures += 1
                print(f'CMR failure {self.failures}: {type(e).__name__}', file=sys.stderr)
                if self.failures >= 3:
                    raise SystemExit(2)
        ents = []
        for e in body.get('feed', {}).get('entry', []):
            if e.get('day_night_flag') != 'DAY' or e.get('time_start') != start:
                continue
            ents.append({'start': e['time_start'], 'end': e.get('time_end'), 'polygons': e.get('polygons') or []})
        self.data[start] = {'url': url, 'entries': ents}
        self.dirty = True
        return ents

    def save(self):
        if self.dirty:
            oro_ref.dump_json(self.data, self.path)


# ── per scene ──
def scene_geom(name, entry, site_ll, idx, periods_def, cache, bank):
    site, date = name.rsplit('_', 1)
    lat0, lon0 = site_ll
    corners = window_corners(lat0, lon0)
    out = {'site': site, 'date': date, 'bank': bank, 'modisTimeUtc': entry['modisTimeUtc'], 'passMid': None,
           'granules': [], 'corners': [list(c) for c in corners], 'cornersInside': [False] * 4, 'A8': False,
           'siteGranule': None, 'crossTrackKm': None, 'crossTrackStatus': 'none', 'status': 'no-pass'}
    g = pass_granules(entry)
    if g is None:
        return out
    out['passMid'] = entry['modisTimeUtc']
    period = _period_of(periods_def, date)
    grans, missing = [], []
    for s in g:
        hit = idx.get((site, period, s))
        if hit is not None:
            grans.append({'start': s, 'end': hit['end'], 'polygons': hit['polygons'], 'source': 'sat-times'})
        else:
            grans.append({'start': s, 'end': None, 'polygons': [], 'source': 'missing'})
            missing.append(len(grans) - 1)

    def inside_all():
        polys = [p for gr in grans for p in gr['polygons']]
        return [any(point_in_poly(la, lo, p) for p in polys) for la, lo in corners]

    ins = inside_all()
    if not all(ins) and missing:
        for i in missing:
            ents = cache.get(grans[i]['start'])
            if ents is None:
                out['granules'] = _jsonable(grans)
                out['cornersInside'] = ins
                out['A8'] = None
                out['status'] = 'missing-granules'
                return out
            polys = [p for e in ents for p in parse_polygons(e['polygons'])]
            grans[i] = {'start': grans[i]['start'], 'end': ents[0]['end'] if ents else None, 'polygons': polys,
                        'source': 'cmr' if ents else 'missing'}
        ins = inside_all()
    out['granules'] = _jsonable(grans)
    out['cornersInside'] = ins
    out['A8'] = all(ins)
    out['status'] = 'ok'
    # R-G7: the pass granule containing the site (first by time), else the nearest polygon centroid
    sg = None
    for gr in grans:
        for p in gr['polygons']:
            if point_in_poly(lat0, lon0, p):
                sg = (gr, p)
                break
        if sg:
            break
    if sg is None:
        best = None
        for gr in grans:
            for p in gr['polygons']:
                d = _gc_dist(_centroid(p), (lat0, lon0))
                if best is None or d < best[0]:
                    best = (d, gr, p)
        if best:
            sg = (best[1], best[2])
    if sg is not None:
        out['siteGranule'] = sg[0]['start']
        out['crossTrackKm'], out['crossTrackStatus'] = cross_track_km(sg[1], (lat0, lon0))
    return out


def _jsonable(grans):
    return [{'start': g['start'], 'end': g['end'], 'source': g['source'],
             'polygons': [[[la, lo] for la, lo in p] for p in g['polygons']]} for g in grans]


def build(banks, sat_times, fetch_missing, cache_path):
    sites = oro_ref.sites_table()
    idx, _, periods_def = sat_times_index(sat_times)
    cache = CmrCache(cache_path, fetch_missing)
    scenes, tsrc = {}, {}
    for bank in banks:
        bt = oro_ref.bank_table(bank)
        tpath = oro_ref._path(bt['times'])
        with open(tpath) as f:
            times = json.load(f)
        tsrc[bank] = {'path': oro_ref.rel(tpath), 'sha256': oro_ref.sha256_file(tpath)}
        bdir = oro_ref._path(bt['dir'])
        names = [n for n in oro_ref.bank_scene_names(bdir) if n in times] if os.path.isdir(bdir) else []
        for name in names:
            site = name.rsplit('_', 1)[0]
            la, lo, _g = sites[site]
            scenes[name] = scene_geom(name, times[name], (la, lo), idx, periods_def, cache, bank)
    cache.save()
    return {'schema': 'cmr-geom/1',
            'sources': {'times': tsrc, 'satTimesSha256': oro_ref.sha256_file(sat_times),
                        'cmrExtraSha256': oro_ref.sha256_file(cache_path) if os.path.exists(cache_path) else None},
            'rules': {'passGapS': PASS_GAP_S, 'granuleMin': GRANULE_MIN, 'corners': '±90 km equirectangular', 'sat': 'terra/MOD03'},
            'scenes': dict(sorted(scenes.items()))}


def main(argv):
    oro_ref.install_guard()
    o = {'--banks': 'orig', '--sat-times': 'tools/genus-ruler/regime/sat-times.json.gz',
         '--cache': '.harness/oro/cmr-extra.json', '--out': 'tools/genus-ruler/oro/cmr-geom.json'}
    fetch = False
    i = 0
    while i < len(argv):
        if argv[i] == '--fetch-missing':
            fetch = True
            i += 1
            continue
        if argv[i] not in o or i + 1 >= len(argv):
            print(f'oro-geom: bad argument {argv[i]!r}', file=sys.stderr)
            return 2
        o[argv[i]] = argv[i + 1]
        i += 2
    doc = build(oro_ref._csv(o['--banks']), os.path.abspath(o['--sat-times']), fetch, os.path.abspath(o['--cache']))
    s = oro_ref.dump_json(doc, o['--out'])
    st = {}
    for v in doc['scenes'].values():
        k = (v['status'], v['A8'], v['crossTrackStatus'])
        st[k] = st.get(k, 0) + 1
    for (status, a8, cts), n in sorted(st.items(), key=lambda x: str(x[0])):
        print(f'GEOM status {status} A8 {a8} crossTrack {cts}: {n}')
    print(f'WROTE {oro_ref.rel(o["--out"])} scenes {len(doc["scenes"])} sha256 {oro_ref.sha256_bytes(s.encode("utf-8"))}')
    return 1 if any(v['status'] == 'missing-granules' for v in doc['scenes'].values()) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
