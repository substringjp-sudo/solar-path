#!/usr/bin/env python3
"""
pairmetar.py — RULER-metar 짝짓기: raw/{KR,JP}.csv(Iowa Mesonet ASOS METAR) 정시 보고 ↔ Open-Meteo 예보(공항 좌표, 같은 시각) → pairs_metar.jsonl
  python3 pairmetar.py [--start 2026-10-10 --end 2026-10-23]
공항 10 곳씩 한 요청. 429 Daily 면 멈추고 다음 실행에 이어서(이미 받은 공항은 건너뜀).
정답 열: low_pct(2 km 아래 누적 운량 %), base_m_agl(가장 낮은 2 km 아래 운저, 없으면 null), precip(비·눈 bool), layers, wx, raw.
"""
import csv, json, sys, os, time, glob, urllib.request, urllib.error, collections

OKTA = {'FEW': 19, 'SCT': 44, 'BKN': 75, 'OVC': 100, 'VV': 100}
CLEAR = ('CAVOK', 'NCD', 'NSC', 'SKC', 'CLR')
LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700]
HOURLY = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'cloud_cover', 'precipitation', 'temperature_2m', 'dew_point_2m',
          'boundary_layer_height', 'weather_code', 'relative_humidity_2m'] + \
         [f'cloud_cover_{p}hPa' for p in LEVELS] + [f'geopotential_height_{p}hPa' for p in LEVELS]
FT = 0.3048

def truth_rows(here):
    out = collections.defaultdict(dict); coords = {}
    for f in glob.glob(os.path.join(here, 'raw', '*.csv')):
        for r in csv.DictReader(open(f)):
            mm = int(r['valid'][14:16])
            if not (mm <= 5 or mm >= 55): continue
            hh = int(r['valid'][11:13]); day = r['valid'][:10]
            if mm >= 55: hh = (hh + 1) % 24
            if mm >= 55 and hh == 0:   # 다음 날 00시
                from datetime import date, timedelta
                y, m, d = map(int, day.split('-')); day = (date(y, m, d) + timedelta(days=1)).isoformat()
            t = f'{day}T{hh:02d}:00'
            toks = r['metar'].split()
            has = r['skyc1'] != 'M'; isclear = any(k in toks for k in CLEAR)
            if not has and not isclear: continue
            layers = []
            for i in range(1, 5):
                c, l = r[f'skyc{i}'], r[f'skyl{i}']
                if c in OKTA and l != 'M': layers.append((c, float(l) * FT))
            lows = [(c, h) for c, h in layers if h < 2000]
            low_pct = max((OKTA[c] for c, _ in lows), default=0) if (lows or isclear or has) else None
            base = min((h for _, h in lows), default=None) if lows else None
            wx = r['wxcodes'] if r['wxcodes'] != 'M' else ''
            # 현재 날씨만: 근처(VC…)·최근(RE…) 토큰은 제외
            precip = any(k in tok for tok in wx.split() if not tok.startswith(('VC', 'RE')) for k in ('RA', 'DZ', 'SN', 'SG', 'PL'))
            tf = lambda v: (float(v) - 32) * 5 / 9 if v not in ('M', '') else None
            coords[r['station']] = (float(r['lat']), float(r['lon']))
            out[r['station']][t] = dict(low_pct=low_pct, base_m_agl=base, precip=precip, wx=wx, layers=[[c, round(h)] for c, h in layers],
                                        raw=r['metar'], obs_t=tf(r['tmpf']), obs_td=tf(r['dwpf']))
    return out, coords

def main(argv):
    def opt(k, d): return argv[argv.index(k) + 1] if k in argv else d
    start, end = opt('--start', '2026-10-10'), opt('--end', '2026-10-23')
    here = os.path.dirname(os.path.abspath(__file__))
    obs, C = truth_rows(here)
    stations = sorted(obs)
    out_path = os.path.join(here, 'pairs_metar.jsonl'); done = set()
    if os.path.exists(out_path):
        for l in open(out_path):
            try: done.add(json.loads(l)['st'])
            except Exception: pass
    todo = [s for s in stations if s not in done]
    print('stations', len(stations), 'done', len(done), 'todo', len(todo), 'reports', sum(len(v) for v in obs.values()), file=sys.stderr)
    out = open(out_path, 'a')
    for i in range(0, len(todo), 10):
        batch = todo[i:i + 10]
        lat = ','.join(str(C[s][0]) for s in batch); lon = ','.join(str(C[s][1]) for s in batch)
        url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly={",".join(HOURLY)}'
               f'&start_date={start}&end_date={end}&timezone=UTC&models=best_match')
        data = None
        for k in range(3):
            try:
                with urllib.request.urlopen(url, timeout=120) as r: data = json.loads(r.read()); break
            except urllib.error.HTTPError as e:
                body = e.read()[:200]; print('HTTP', e.code, body, file=sys.stderr)
                if e.code == 429 and b'Daily' in body: print('일일 한도 — 멈춤', file=sys.stderr); out.close(); return 2
                time.sleep(60)
            except Exception as e: print('ERR', str(e)[:120], file=sys.stderr); time.sleep(30)
        if data is None: out.close(); return 2
        if isinstance(data, dict): data = [data]
        for s, d in zip(batch, data):
            h = d.get('hourly') or {}; idx = {t: j for j, t in enumerate(h.get('time') or [])}; n = 0
            for t, r in obs[s].items():
                j = idx.get(t)
                if j is None: continue
                row = {'st': s, 't': t, 'lat': C[s][0], 'lon': C[s][1], 'model_elev': d.get('elevation'), **r}
                for k in HOURLY:
                    v = h.get(k); row[k] = v[j] if v is not None and j < len(v) else None
                out.write(json.dumps(row) + '\n'); n += 1
            print(s, 'paired', n, file=sys.stderr)
        out.flush(); time.sleep(2)
    out.close(); print('done', file=sys.stderr); return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
