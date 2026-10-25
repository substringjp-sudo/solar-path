#!/usr/bin/env python3
"""pairsat.py — pairs2.jsonl 의 관측소·시각에 위성 **관측** 일사(Open-Meteo satellite archive, MSG/MTG 유럽)를 붙임 → pairs_sat.jsonl"""
import json, sys, os, time, urllib.request, urllib.error, collections
V = ['shortwave_radiation', 'direct_normal_irradiance', 'direct_radiation', 'diffuse_radiation']
def main():
    here = os.path.dirname(os.path.abspath(__file__))
    rows = collections.defaultdict(list)
    for l in open(os.path.join(here, 'pairs2.jsonl')):
        r = json.loads(l); rows[r['st']].append(r)
    out_path = os.path.join(here, 'pairs_sat.jsonl'); done = set()
    if os.path.exists(out_path):
        for l in open(out_path):
            try: done.add(json.loads(l)['st'])
            except Exception: pass
    todo = [s for s in sorted(rows) if s not in done]; print('todo', len(todo), file=sys.stderr)
    out = open(out_path, 'a')
    for i in range(0, len(todo), 10):
        batch = todo[i:i+10]
        lat = ','.join(str(rows[s][0]['lat']) for s in batch); lon = ','.join(str(rows[s][0]['lon']) for s in batch)
        url = (f'https://satellite-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&hourly={",".join(V)}'
               f'&start_date=2026-10-10&end_date=2026-10-23&timezone=UTC&models=satellite_radiation_seamless')
        data = None
        for k in range(4):
            try:
                with urllib.request.urlopen(url, timeout=120) as r: data = json.loads(r.read()); break
            except urllib.error.HTTPError as e:
                body = e.read()[:200]; print('HTTP', e.code, body, file=sys.stderr)
                if e.code == 429 and b'Daily' in body: out.close(); return 2
                time.sleep(60)
            except Exception as e: print('ERR', str(e)[:100], file=sys.stderr); time.sleep(20)
        if data is None: out.close(); return 2
        if isinstance(data, dict): data = [data]
        for s, d in zip(batch, data):
            h = d.get('hourly') or {}; idx = {t: j for j, t in enumerate(h.get('time') or [])}
            for r in rows[s]:
                j = idx.get(r['t'])
                if j is None: continue
                o = {'st': s, 't': r['t']}
                for k in V:
                    v = h.get(k); o['sat_' + k] = v[j] if v is not None and j < len(v) else None
                out.write(json.dumps(o) + '\n')
            print(s, 'ok', file=sys.stderr)
        out.flush(); time.sleep(1)
    out.close(); print('done', file=sys.stderr); return 0
if __name__ == '__main__': sys.exit(main())
