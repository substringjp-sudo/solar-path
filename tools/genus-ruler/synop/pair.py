# SYNOP 유인 관측(CL/CM/CH) ↔ Open-Meteo past_days 예보 짝짓기 → pairs.jsonl
import glob, json, re, sys, time, urllib.request, collections
from parse import rows
LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300]
HOURLY = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'cape', 'lifted_index', 'weather_code',
          'temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'is_day'] + \
         [f'cloud_cover_{p}hPa' for p in LEVELS] + [f'geopotential_height_{p}hPa' for p in LEVELS]

def coords(path='nsd_bbsss.txt'):
    out = {}
    for line in open(path, encoding='latin-1'):
        p = line.rstrip('\n').split(';')
        if len(p) < 12 or not p[0].isdigit(): continue
        m1 = re.match(r'(\d+)-(\d+)(?:-(\d+))?([NS])', p[7]); m2 = re.match(r'(\d+)-(\d+)(?:-(\d+))?([EW])', p[8])
        if not m1 or not m2: continue
        lat = int(m1[1]) + int(m1[2]) / 60 + (int(m1[3]) if m1[3] else 0) / 3600; lat *= -1 if m1[4] == 'S' else 1
        lon = int(m2[1]) + int(m2[2]) / 60 + (int(m2[3]) if m2[3] else 0) / 3600; lon *= -1 if m2[4] == 'W' else 1
        try: elev = float(p[11])
        except: elev = None
        out[p[0] + p[1]] = (round(lat, 4), round(lon, 4), elev)
    return out

def main():
    C = coords()
    obs = collections.defaultdict(dict)   # station -> time -> report
    for f in glob.glob('raw/b*.csv'):
        for st, t, r in rows(f):
            if r['ix'] not in '123' or not r['cl']: continue
            if st not in C: continue
            obs[st][t] = r
    stations = sorted(obs)
    print('stations', len(stations), 'reports', sum(len(v) for v in obs.values()), file=sys.stderr)
    out = open('pairs.jsonl', 'w')
    B = 10
    for i in range(0, len(stations), B):
        batch = stations[i:i + B]
        lat = ','.join(str(C[s][0]) for s in batch); lon = ','.join(str(C[s][1]) for s in batch)
        url = (f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly={",".join(HOURLY)}'
               f'&start_date=2026-09-26&end_date=2026-10-03&timezone=UTC')
        for k in range(5):
            try:
                with urllib.request.urlopen(url, timeout=120) as r: data = json.load(r); break
            except Exception as e:
                print('retry', i, e, file=sys.stderr); time.sleep(5 * 2 ** k)
        else: continue
        if isinstance(data, dict): data = [data]
        for s, d in zip(batch, data):
            h = d.get('hourly', {}); times = h.get('time', [])
            idx = {t: j for j, t in enumerate(times)}
            for t, r in obs[s].items():
                j = idx.get(t)
                if j is None: continue
                rec = {'st': s, 't': t, 'lat': C[s][0], 'lon': C[s][1], 'elev': C[s][2], 'model_elev': d.get('elevation'), 'ix': r['ix'], 'h': r['h'], 'N': r['N'], 'ww': r['ww'], 'cl': r['cl']}
                for k in HOURLY: rec[k] = h.get(k, [None] * len(times))[j]
                out.write(json.dumps(rec) + '\n')
        out.flush(); time.sleep(1.5)
        print('batch', i // B + 1, '/', (len(stations) + B - 1) // B, file=sys.stderr)
    out.close()

if __name__ == '__main__': main()
