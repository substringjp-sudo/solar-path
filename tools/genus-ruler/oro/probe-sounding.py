#!/usr/bin/env python3
"""
probe-sounding.py: 복원 R4 탐침(RULER-oro §2.3, 계획 §2.1). Open-Meteo historical-forecast-api 에 서울(dev) 두 요청.

  python3 tools/genus-ruler/oro/probe-sounding.py [--out tools/genus-ruler/oro/probe-r4.json]

  요청 1(가중 ≈ 1.6): 2026-09-05, hourly=boundary_layer_height,sensible_heat_flux,cape,temperature_850hPa,
                      models=best_match,ecmwf_ifs025,icon_seamless,gfs_seamless → 모델마다 변수가 있는지(null 수).
  요청 2(가중 ≈ 1): 같은 날 best_match 만, temperature_850hPa·geopotential_height_700hPa·wind_speed_700hPa·
                      wind_direction_700hPa → 00~05Z 매시 값이 유한한지(검토 p2).
두 응답의 X-RateLimit 머리, 변수별 null 수, 00~05Z 유한 여부만 적습니다. 원값은 저장하지 않습니다(관측점 날씨라 판정 참값은 아님).
"""
import sys, os, json, time, urllib.request, urllib.error

BASE = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
LAT, LON = 37.5, 127.0
DAY = '2026-09-05'


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return r.status, {k: v for k, v in r.headers.items() if k.lower().startswith('x-ratelimit') or k.lower() == 'x-cost'}, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), {'error': e.read().decode('utf8', 'replace')[:300]}


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    out = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(here, 'probe-r4.json')
    rep = {'site': 'seoul', 'lat': LAT, 'lon': LON, 'date': DAY, 'requestedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}

    v1 = ['boundary_layer_height', 'sensible_heat_flux', 'cape', 'temperature_850hPa']
    m1 = ['best_match', 'ecmwf_ifs025', 'icon_seamless', 'gfs_seamless']
    u1 = f'{BASE}?latitude={LAT}&longitude={LON}&hourly={",".join(v1)}&models={",".join(m1)}&start_date={DAY}&end_date={DAY}&timezone=GMT'
    st, hdr, js = get(u1)
    h = js.get('hourly', {})
    avail = {}
    for m in m1:
        for v in v1:
            k = f'{v}_{m}'
            col = h.get(k)
            avail[k] = None if col is None else {'n': len(col), 'null': sum(1 for x in col if x is None)}
    rep['req1'] = {'url': u1, 'status': st, 'headers': hdr, 'availability': avail, 'error': js.get('error')}
    time.sleep(10)

    v2 = ['temperature_850hPa', 'geopotential_height_700hPa', 'wind_speed_700hPa', 'wind_direction_700hPa']
    u2 = f'{BASE}?latitude={LAT}&longitude={LON}&hourly={",".join(v2)}&start_date={DAY}&end_date={DAY}&timezone=GMT&wind_speed_unit=ms'
    st, hdr, js = get(u2)
    h = js.get('hourly', {})
    fin = {}
    for v in v2:
        col = h.get(v)
        fin[v] = None if col is None else [col[i] is not None for i in range(6)]
    rep['req2'] = {'url': u2, 'status': st, 'headers': hdr, 'finite00to05Z': fin,
                   'nullAllDay': {v: (None if h.get(v) is None else sum(1 for x in h[v] if x is None)) for v in v2},
                   'elevation': js.get('elevation'), 'error': js.get('error')}
    with open(out, 'w') as f:
        json.dump(rep, f, indent=1)
        f.write('\n')
    print(json.dumps({'req1': rep['req1']['status'], 'req2': rep['req2']['status'],
                      'cost': [rep['req1']['headers'], rep['req2']['headers']]}))
    for k, v in avail.items():
        print(f'  {k:40s} {v}')
    for k, v in fin.items():
        print(f'  {k:32s} 00-05Z finite {v}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
