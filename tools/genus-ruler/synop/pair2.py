#!/usr/bin/env python3
"""
pair2.py — RULER-genus2 짝짓기: raw2/ 의 SYNOP(유인·8그룹) ↔ Open-Meteo past_days 예보(두께·습도 단면 포함) → pairs2.jsonl.
  python3 pair2.py [--start 2026-10-10 --end 2026-10-23] [--max-batches N]
관측소 10 곳씩 한 요청. 429(일일 한도)·시간 초과면 60 초 쉬고 3 번까지 다시; 그래도 안 되면 멈추고 다음 실행에 이어서(이미 받은 관측소는 건너뜀).
"""
import glob, json, re, sys, time, os, urllib.request, urllib.error, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse import rows
from pair import coords

LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300]
HOURLY = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'cape', 'lifted_index', 'weather_code',
          'temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'is_day', 'direct_normal_irradiance', 'shortwave_radiation',
          'boundary_layer_height'] + \
         [f'cloud_cover_{p}hPa' for p in LEVELS] + [f'geopotential_height_{p}hPa' for p in LEVELS] + [f'relative_humidity_{p}hPa' for p in LEVELS]

def main(argv):
    def opt(k, d):
        return argv[argv.index(k) + 1] if k in argv else d
    start, end = opt('--start', '2026-10-10'), opt('--end', '2026-10-23')
    max_batches = int(opt('--max-batches', '100000'))
    here = os.path.dirname(os.path.abspath(__file__))
    C = coords(os.path.join(here, 'nsd_bbsss.txt'))
    obs = collections.defaultdict(dict)
    for f in glob.glob(os.path.join(here, 'raw2', 'b*.csv')):
        for st, t, r in rows(f):
            if r['ix'] not in '123' or not r['cl'] or r['cl'][1] == '/': continue
            if st not in C: continue
            obs[st][t] = r
    stations = sorted(obs)
    out_path = os.path.join(here, 'pairs2.jsonl')
    done = set()
    if os.path.exists(out_path):
        for l in open(out_path):
            try: done.add(json.loads(l)['st'])
            except Exception: pass
    todo = [s for s in stations if s not in done]
    print('stations', len(stations), 'done', len(done), 'todo', len(todo), 'reports', sum(len(v) for v in obs.values()), file=sys.stderr)
    out = open(out_path, 'a')
    B = 10; nb = 0
    for i in range(0, len(todo), B):
        if nb >= max_batches: break
        batch = todo[i:i + B]
        lat = ','.join(str(C[s][0]) for s in batch); lon = ','.join(str(C[s][1]) for s in batch)
        url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly={",".join(HOURLY)}'
               f'&start_date={start}&end_date={end}&timezone=UTC&models=best_match')
        data = None
        for k in range(3):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    data = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                body = e.read()[:200]
                print('HTTP', e.code, body, file=sys.stderr)
                if e.code == 429 and b'Daily' in body:
                    print('일일 한도 — 멈춤(다음 실행에 이어서)', file=sys.stderr); out.close(); return 2
                time.sleep(60)
            except Exception as e:
                print('ERR', str(e)[:120], file=sys.stderr); time.sleep(60)
        if data is None:
            print('batch failed', batch, file=sys.stderr); out.close(); return 2
        if isinstance(data, dict): data = [data]
        for s, d in zip(batch, data):
            h = d.get('hourly') or {}
            times = h.get('time') or []
            idx = {t: j for j, t in enumerate(times)}
            n = 0
            for t, r in obs[s].items():
                j = idx.get(t)
                if j is None: continue
                row = {'st': s, 't': t, 'lat': C[s][0], 'lon': C[s][1], 'elev': C[s][2], 'model_elev': d.get('elevation'), 'cl': r['cl'], 'ww': r['ww'], 'N': r['N']}
                for k in HOURLY:
                    v = h.get(k)
                    row[k] = v[j] if v is not None and j < len(v) else None
                out.write(json.dumps(row) + '\n'); n += 1
            print(s, 'paired', n, file=sys.stderr)
        out.flush(); nb += 1
        time.sleep(2)
    out.close()
    print('done', file=sys.stderr)
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
