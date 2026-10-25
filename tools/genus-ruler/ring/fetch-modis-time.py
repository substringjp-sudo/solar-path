#!/usr/bin/env python3
"""
fetch-modis-time.py — RULER-ringtruth §2 Q1 시각: 장면마다 NASA CMR(키 없음)에서 MOD03 **DAY granule 시작 시각(UTC)** 을 받아 기록.
  python3 tools/genus-ruler/ring/fetch-modis-time.py [--scenes .harness/macro/sat] [--out tools/genus-ruler/ring/modis-times.json]
출력: { "<site>_<date>": { "modisTimeUtc": "2026-09-01T01:07:30Z", "times": [...], "seam": bool, "source": "cmr"|"solar" } }
- DAY granule 이 둘 이상 서로 다른 시각이면 seam=true(768 km 상자를 두 궤도가 덮음), 시각은 중앙값.
- CMR 실패·granule 없음이면 평균 태양시 10:30 → UTC 10:30 − lon/15 h 로 대신(source "solar").
Open-Meteo 한도를 쓰지 않습니다.
"""
import sys, os, json, math, glob, time, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone

HALF_KM = 384.0

def cmr_day_times(lat, lon, date):
    dlat = HALF_KM / 111.32; dlon = HALF_KM / (111.32 * math.cos(math.radians(lat)))
    bbox = f"{lon-dlon:.3f},{lat-dlat:.3f},{lon+dlon:.3f},{lat+dlat:.3f}"
    url = ("https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD03"
           f"&temporal={date}T00:00:00Z,{date}T23:59:59Z&bounding_box={bbox}&page_size=50")
    for k in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as r: d = json.load(r)
            ents = d['feed']['entry']
            # DAY granule 의 시작 시각과 폴리곤(위도 경도 쌍 나열) — 상자 중심·네 모서리가 어느 granule 안에 드는지 보려고 함께 돌려줌
            out = []
            for e in ents:
                if e.get('day_night_flag') != 'DAY': continue
                polys = []
                for ring in (e.get('polygons') or []):
                    for pstr in ring:
                        nums = [float(x) for x in pstr.split()]
                        polys.append([(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)])
                out.append((e['time_start'], polys))
            return out
        except Exception as e:
            if k == 2: print('CMR ERR', date, str(e)[:80], file=sys.stderr); return None
            time.sleep(3 * (k + 1))

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

def main(argv):
    def opt(k, d): return argv[argv.index(k) + 1] if k in argv else d
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, '..', '..', '..'))
    scenes = opt('--scenes', os.path.join(root, '.harness', 'macro', 'sat'))
    out_path = opt('--out', os.path.join(here, 'modis-times.json'))
    rule = opt('--rule', 'closest')
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    if '--refresh' in argv: out = {}
    files = sorted(f for f in glob.glob(os.path.join(scenes, '*.json')) if not f.endswith('index.json'))
    for f in files:
        sc = json.load(open(f)); name = f"{sc['site']}_{sc['date']}"
        if name in out and out[name].get('source') == 'cmr' and out[name].get('rule') == rule: continue
        grans = cmr_day_times(sc['lat'], sc['lon'], sc['date'])
        if grans:
            # granule 은 5 분 조각 — 같은 궤도의 연속 조각(간격 ≤ 30 분)을 한 '통과(pass)' 로 묶는다. 통과마다 상자 **중심**(관측점)과 네 모서리가
            # 그 통과의 어느 granule 폴리곤 안에 드는지 세어, 중심을 덮는 통과만 후보로 둔다(상자 모서리만 스치는 먼 궤도 제외).
            # UTC 하루 안에 중심을 덮는 DAY 통과가 둘이면(동아시아·호주: 00~01Z 와 22~23Z — Terra 궤도가 2020 년부터 이른 쪽으로 밀려 현지 ≈ 09:40)
            # GIBS 일일 합성이 어느 통과를 보이는지에 따라 참값 시각이 달라지므로 multiPass 로 표시하고 --rule 로 고른다:
            #   closest = 평균 태양시 10:30 에 가장 가까운 통과(기본) · latest = 가장 늦은 통과(합성이 '최근 granule 을 위에' 둘 때).
            exp = datetime.strptime(sc['date'], '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(hours=10.5 - sc['lon'] / 15.0)
            dlat = HALF_KM / 111.32; dlon = HALF_KM / (111.32 * math.cos(math.radians(sc['lat'])))
            probes = [(sc['lat'], sc['lon']), (sc['lat'] + dlat, sc['lon'] - dlon), (sc['lat'] + dlat, sc['lon'] + dlon), (sc['lat'] - dlat, sc['lon'] - dlon), (sc['lat'] - dlat, sc['lon'] + dlon)]
            items = sorted(((datetime.strptime(t[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc), polys) for t, polys in grans), key=lambda x: x[0])
            passes = [[items[0]]]
            for it in items[1:]:
                if (it[0] - passes[-1][-1][0]).total_seconds() <= 1800: passes[-1].append(it)
                else: passes.append([it])
            info = []
            for p in passes:
                mid = p[0][0] + (p[-1][0] + timedelta(minutes=5) - p[0][0]) / 2
                cov = [any(point_in_poly(la, lo, poly) for _, polys in p for poly in polys) for la, lo in probes]
                info.append({'mid': mid, 'center': cov[0], 'cornerFrac': sum(cov[1:]) / 4})
            cands = [i for i in info if i['center']] or info
            pick = max(cands, key=lambda i: i['mid']) if rule == 'latest' else min(cands, key=lambda i: abs((i['mid'] - exp).total_seconds()))
            out[name] = {'modisTimeUtc': pick['mid'].strftime('%Y-%m-%dT%H:%M:%SZ'), 'times': sorted({t for t, _ in grans}),
                         'passes': [{'mid': i['mid'].strftime('%Y-%m-%dT%H:%M:%SZ'), 'center': i['center'], 'cornerFrac': i['cornerFrac']} for i in info],
                         'multiPass': len(cands) > 1, 'seam': len(cands) > 1 or pick['cornerFrac'] < 1.0, 'rule': rule, 'source': 'cmr', 'expectedSolar': exp.strftime('%Y-%m-%dT%H:%M:%SZ')}
        else:
            h = 10.5 - sc['lon'] / 15.0
            base = datetime.strptime(sc['date'], '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(hours=h)
            out[name] = {'modisTimeUtc': base.strftime('%Y-%m-%dT%H:%M:%SZ'), 'times': [], 'seam': False, 'source': 'solar'}
        print(name, out[name]['modisTimeUtc'], 'seam' if out[name]['seam'] else '', out[name]['source'], file=sys.stderr)
        json.dump(out, open(out_path, 'w'), indent=1)
        time.sleep(0.5)
    n = len(out); mp = sum(1 for v in out.values() if v.get('multiPass')); solar = sum(1 for v in out.values() if v['source'] == 'solar')
    print(f'done {n} scenes, multiPass {mp}, solar-fallback {solar}', file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1:])
