#!/usr/bin/env python3
"""pair3.py — pairs2.jsonl 에 열역학·바람 변수를 덧붙임(기압면 기온·풍속, 10 m 풍속, 시정, 총운량) → pairs3.jsonl. 관측소 10 곳씩, 429 Daily 면 멈추고 이어서."""
import json, sys, os, time, urllib.request, urllib.error, collections
LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300]
EXTRA = [f'temperature_{p}hPa' for p in LEVELS] + [f'wind_speed_{p}hPa' for p in [1000, 925, 850, 700, 500]] + ['wind_speed_10m', 'visibility', 'cloud_cover', 'surface_pressure']
def main():
    here = os.path.dirname(os.path.abspath(__file__))
    rows = collections.defaultdict(list)
    for l in open(os.path.join(here, 'pairs2.jsonl')):
        r = json.loads(l); rows[r['st']].append(r)
    out_path = os.path.join(here, 'pairs3.jsonl'); done = set()
    if os.path.exists(out_path):
        for l in open(out_path):
            try: done.add(json.loads(l)['st'])
            except Exception: pass
    todo = [s for s in sorted(rows) if s not in done]
    print('todo', len(todo), file=sys.stderr)
    out = open(out_path, 'a')
    for i in range(0, len(todo), 10):
        batch = todo[i:i+10]
        lat = ','.join(str(rows[s][0]['lat']) for s in batch); lon = ','.join(str(rows[s][0]['lon']) for s in batch)
        url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly={",".join(EXTRA)}'
               f'&start_date=2026-10-10&end_date=2026-10-23&timezone=UTC&models=best_match')
        data = None
        for k in range(4):
            try:
                with urllib.request.urlopen(url, timeout=120) as r: data = json.loads(r.read()); break
            except urllib.error.HTTPError as e:
                body = e.read()[:200]; print('HTTP', e.code, body, file=sys.stderr)
                if e.code == 429 and b'Daily' in body: out.close(); return 2
                time.sleep(60)
            except Exception as e: print('ERR', str(e)[:100], file=sys.stderr); time.sleep(30)
        if data is None: out.close(); return 2
        if isinstance(data, dict): data = [data]
        for s, d in zip(batch, data):
            h = d.get('hourly') or {}; idx = {t: j for j, t in enumerate(h.get('time') or [])}
            for r in rows[s]:
                j = idx.get(r['t'])
                if j is None: continue
                for k in EXTRA:
                    v = h.get(k); r[k] = v[j] if v is not None and j < len(v) else None
                out.write(json.dumps(r) + '\n')
            print(s, 'ok', file=sys.stderr)
        out.flush(); time.sleep(2)
    out.close(); print('done', file=sys.stderr); return 0
if __name__ == '__main__': sys.exit(main())
