#!/usr/bin/env python3
"""
fetch-sounding.py: RULER-oro §2.3 관측점 탐측(RULER-regime 과 공유). Open-Meteo historical-forecast-api,
모델 미지정(best_match), 사이트당 1 요청. 앱 관측점 요청과 같은 길입니다.

  python3 tools/genus-ruler/oro/fetch-sounding.py [--sites all|dev|held|name,name] [--start 2026-06-01] [--end 2026-10-31]
                                                  [--out .harness/oro/sounding.json] [--manifest tools/genus-ruler/oro/sounding-manifest.json]
                                                  [--models ecmwf_ifs025] [--sleep 10] [--dry]

  - 변수: 기압면 T 15 면(THERMO_TEMP_LEVELS), RH 13 면(THERMO_RH_LEVELS), Z 15 면(PROFILE_LEVELS),
          바람 925/850/700/600/500/250 hPa, 지상(T2m, Td2m, 지상 기압, CAPE, BLH, SHF, 10 m 바람, 강수, 일사,
          freezing_level_height(보관만, 판정에 안 씀)), 운량(전체·저·중·상). 모두 70 개.
  - timezone=GMT, wind_speed_unit=ms. 요청 사이 --sleep 초(기본 10, 분당 600 한도).
  - 429: 본문에 'Daily' 가 있으면 멈추고 코드 3. 아니면 60 s × 3 다시, 그래도 안 되면 코드 2.
    이미 받은 사이트는 --out 파일에서 건너뜁니다(사이트 단위로 이어 받기).
  - --out 에는 사이트별 원응답(hourly 그대로)을 둡니다(.harness, 커밋하지 않음).
    --manifest 에는 사이트마다 요청 URL, 받은 시각, 원응답 sha256, 변수별 null 수, 응답 elevation, X-RateLimit-Cost 를 적습니다.
  - --start/--end/--out/--manifest 로 확장 기간(RULER-regime R10)을 스크립트를 고치지 않고 받습니다.
  - --models 를 주면 그 모델만 받습니다(RULER-oro §2.5 ④ 의 ecmwf 탐측, 계획 R11). 주지 않으면 best_match(모델 미지정).
  - --out 이 디렉터리 없는 이름이면 .harness/oro/ 아래에 둡니다. --manifest 를 주지 않으면 --out 이름에서
    만듭니다(sounding.json → tools/genus-ruler/oro/sounding-manifest.json, sounding-ecmwf.json → sounding-ecmwf-manifest.json).
    그래서 확장·R11 이 원래 목록을 덮지 않습니다.
"""
import sys, os, json, time, hashlib, urllib.request, urllib.error

SITES = {
    'dev': {'seoul': (37.5, 127.0), 'kanazawa': (36.5679, 136.6774)},
    'held': {'osaka': (34.69, 135.5), 'busan': (35.18, 129.08), 'shanghai': (31.23, 121.47), 'sapporo': (43.06, 141.35),
             'lisbon': (38.72, -9.14), 'denver': (39.74, -104.99), 'sydney': (-33.87, 151.21), 'hamburg': (53.55, 9.99)},
}
BASE = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
TEMP_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200]  # weather.ts THERMO_TEMP_LEVELS
RH_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300]  # weather.ts THERMO_RH_LEVELS
Z_LEVELS = TEMP_LEVELS  # weather.ts PROFILE_LEVELS (같은 15 면)
WIND_LEVELS = [925, 850, 700, 600, 500, 250]
SURFACE = ['temperature_2m', 'dew_point_2m', 'surface_pressure', 'cape', 'boundary_layer_height', 'sensible_heat_flux',
           'wind_speed_10m', 'wind_direction_10m', 'precipitation', 'shortwave_radiation', 'freezing_level_height',
           'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']
VARS = (SURFACE
        + [f'temperature_{p}hPa' for p in TEMP_LEVELS]
        + [f'relative_humidity_{p}hPa' for p in RH_LEVELS]
        + [f'geopotential_height_{p}hPa' for p in Z_LEVELS]
        + [f'wind_{k}_{p}hPa' for p in WIND_LEVELS for k in ('speed', 'direction')])


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            body = r.read()
            return r.status, dict(r.headers.items()), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()
    except (urllib.error.URLError, OSError) as e:  # 연결 끊김(SSL EOF 등): 상태 0 으로 돌려 60 s 뒤 다시
        return 0, {}, str(e).encode()


def main(argv):
    def opt(k, d):
        return argv[argv.index(k) + 1] if k in argv else d
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, '..', '..', '..'))
    start, end = opt('--start', '2026-06-01'), opt('--end', '2026-10-31')
    out = opt('--out', 'sounding.json')
    if os.path.dirname(out) == '':
        out = os.path.join(root, '.harness', 'oro', out)
    stem = os.path.basename(out)[:-5] if out.endswith('.json') else os.path.basename(out)
    manifest_path = opt('--manifest', os.path.join(here, f'{stem}-manifest.json'))
    models = opt('--models', '')
    sleep_s = float(opt('--sleep', '10'))
    which = opt('--sites', 'all')
    allsites = {**SITES['dev'], **SITES['held']}
    sites = allsites if which == 'all' else SITES[which] if which in SITES else {k: allsites[k] for k in which.split(',')}
    print(f'vars {len(VARS)}  sites {len(sites)}  {start}..{end}  model {models or "best_match"}  '
          f'out {os.path.relpath(out, root)}  manifest {os.path.relpath(manifest_path, root)}')
    if '--dry' in argv:
        print(','.join(VARS))
        return 0

    data = json.load(open(out)) if os.path.exists(out) else {}
    man = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    man.update({'endpoint': BASE, 'model': models or 'best_match', 'start': start, 'end': end, 'timezone': 'GMT', 'windSpeedUnit': 'ms',
                'vars': VARS, 'scriptSha256': hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()})
    man.setdefault('sites', {})
    os.makedirs(os.path.dirname(out), exist_ok=True)
    first = True
    for name, (lat, lon) in sorted(sites.items()):
        if name in data and name in man['sites']:
            print(f'  {name}: cached')
            continue
        if not first:
            time.sleep(sleep_s)
        first = False
        url = (f'{BASE}?latitude={lat:.5f}&longitude={lon:.5f}&hourly={",".join(VARS)}&start_date={start}&end_date={end}'
               f'&timezone=GMT&wind_speed_unit=ms' + (f'&models={models}' if models else ''))
        body = None
        for k in range(4):
            st, hdr, raw = get(url)
            if st == 200:
                body = raw
                break
            txt = raw.decode('utf8', 'replace')[:300]
            if st == 429 and 'Daily' in txt:
                print(f'  {name}: daily 429, stop')
                return 3
            print(f'  {name}: HTTP {st} {txt[:120]}; retry in 60 s')
            if k < 3:
                time.sleep(60)
        if body is None:
            print(f'  {name}: giving up')
            return 2
        js = json.loads(body)
        h = js.get('hourly', {})
        data[name] = {'lat': lat, 'lon': lon, 'elevation': js.get('elevation'), 'hourly': h}
        man['sites'][name] = {'url': url, 'fetchedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                              'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body),
                              'elevation': js.get('elevation'), 'nHours': len(h.get('time', [])),
                              'rateLimitCost': hdr.get('X-RateLimit-Cost') or hdr.get('x-ratelimit-cost'),
                              'nulls': {v: (None if h.get(v) is None else sum(1 for x in h[v] if x is None)) for v in VARS}}
        with open(out, 'w') as f:
            json.dump(data, f)
        with open(manifest_path, 'w') as f:
            json.dump(man, f, indent=1)
            f.write('\n')
        nn = man['sites'][name]['nulls']
        missing = [v for v in VARS if nn[v] is None]
        print(f'  {name}: {man["sites"][name]["nHours"]} h  cost {man["sites"][name]["rateLimitCost"]}  '
              f'missing vars {len(missing)}  max nulls {max((x for x in nn.values() if x is not None), default=0)}')
    print(f'done {len(man["sites"])}/{len(sites)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
