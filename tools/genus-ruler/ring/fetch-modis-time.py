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
            times = sorted({e['time_start'] for e in ents if e.get('day_night_flag') == 'DAY'})
            return times
        except Exception as e:
            if k == 2: print('CMR ERR', date, str(e)[:80], file=sys.stderr); return None
            time.sleep(3 * (k + 1))

def main(argv):
    def opt(k, d): return argv[argv.index(k) + 1] if k in argv else d
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, '..', '..', '..'))
    scenes = opt('--scenes', os.path.join(root, '.harness', 'macro', 'sat'))
    out_path = opt('--out', os.path.join(here, 'modis-times.json'))
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    files = sorted(f for f in glob.glob(os.path.join(scenes, '*.json')) if not f.endswith('index.json'))
    for f in files:
        sc = json.load(open(f)); name = f"{sc['site']}_{sc['date']}"
        if name in out and out[name].get('source') == 'cmr': continue
        times = cmr_day_times(sc['lat'], sc['lon'], sc['date'])
        if times:
            # granule 5 분 — 시작 + 2.5 분을 대표 시각으로. 상자를 스치는 먼 궤도(스와스 가장자리, 다른 현지 시각)도 DAY 로 잡히므로
            # 평균 태양시 10:30(UTC 10:30 − lon/15 h) 에 **가장 가까운** granule 을 고르고, 그 ±2 h 안에 다른 DAY granule 이 있으면 seam.
            exp = datetime.strptime(sc['date'], '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(hours=10.5 - sc['lon'] / 15.0)
            ts = [datetime.strptime(t[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc) + timedelta(seconds=150) for t in times]
            pick = min(ts, key=lambda x: abs((x - exp).total_seconds()))
            seam = any(x != pick and abs((x - pick).total_seconds()) <= 7200 for x in ts)
            out[name] = {'modisTimeUtc': pick.strftime('%Y-%m-%dT%H:%M:%SZ'), 'times': times, 'seam': seam, 'source': 'cmr', 'expectedSolar': exp.strftime('%Y-%m-%dT%H:%M:%SZ')}
        else:
            h = 10.5 - sc['lon'] / 15.0
            base = datetime.strptime(sc['date'], '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(hours=h)
            out[name] = {'modisTimeUtc': base.strftime('%Y-%m-%dT%H:%M:%SZ'), 'times': [], 'seam': False, 'source': 'solar'}
        print(name, out[name]['modisTimeUtc'], 'seam' if out[name]['seam'] else '', out[name]['source'], file=sys.stderr)
        json.dump(out, open(out_path, 'w'), indent=1)
        time.sleep(0.5)
    n = len(out); seams = sum(1 for v in out.values() if v['seam']); solar = sum(1 for v in out.values() if v['source'] == 'solar')
    print(f'done {n} scenes, seam {seams}, solar-fallback {solar}', file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1:])
