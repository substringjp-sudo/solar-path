#!/usr/bin/env python3
"""
fetch-nwp-ring.py — RULER-ringtruth §2 Q1/Q3/Q1-b 입력: 사이트별 1 요청으로 고리 91 점의 보관 예보 운량을 받아(2026-09-01~10-19),
장면마다 MODIS 시각(modis-times.json)에 앞뒤 정시 선형 보간한 총운량을 `ring[].cover`(0~1) 로 넣은 장면 사본을 만든다.
  python3 tools/genus-ruler/ring/fetch-nwp-ring.py --tag blend                      # historical, models=ecmwf_ifs025,icon_seamless (Q1)
  python3 tools/genus-ruler/ring/fetch-nwp-ring.py --tag jma --models jma_msm        # Q3 (JMA 영역 사이트만: --sites osaka,busan,sapporo,shanghai)
  python3 tools/genus-ruler/ring/fetch-nwp-ring.py --tag archive --endpoint archive  # Q1-b B0 (모델 미지정)
  python3 tools/genus-ruler/ring/fetch-nwp-ring.py --tag era5 --endpoint archive --models era5
옵션: --scenes <dir>(기본 .harness/macro/sat) --sites a,b,c --start 2026-09-01 --end 2026-10-19 --sleep 60
      --times <json>(기본 modis-times.json; --rule latest 로 만든 modis-times-latest.json 을 주면 latest 사본) --shift-hours ±1(민감도 사본)
      --raw-tag <tag>(원자료 폴더를 다른 tag 와 공유 — 같은 모델이면 다시 받지 않음)
출력: ring/nwp/<tag>/<site>.json(원자료, gitignore), <scenes>-nwp-<tag>/<site>_<date>.json(총운량 사본), <scenes>-nwp-<tag>-lm/(저+중 무작위 겹침 사본)
429 Daily 면 멈추고 다음 실행에 이어서(사이트 단위 resume). 손잡이(시각·σ·β)는 바꾸지 않는다.
"""
import sys, os, json, math, glob, time, urllib.request, urllib.error
from datetime import datetime, timezone

RING = [(5, [0, 60, 120, 180, -120, -60])] + [(d, [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30]) for d in (10, 30, 70, 130, 200, 280, 380)]
VARS = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']
R_EARTH = 6371.0

def dest(lat, lon, dist_km, bearing_deg):
    """weather.ts calculateDestination 과 같은 구면 공식."""
    if dist_km == 0: return lat, lon
    br = math.radians(bearing_deg); d = dist_km / R_EARTH
    la1 = math.radians(lat); lo1 = math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(br))
    lo2 = lo1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), ((math.degrees(lo2) + 540) % 360) - 180

def ring_points(lat, lon):
    pts = [(0, 0, lat, lon)]
    for d, azs in RING:
        for az in azs:
            la, lo = dest(lat, lon, d, az); pts.append((d, az, la, lo))
    return pts

def blend(h, var, models):
    """두 모델 시각별 산술평균(blendHourly 와 같게). 한 모델만 있으면 그 값, 둘 다 null 이면 None. 모델 미지정이면 평문 키."""
    if not models:
        return h.get(var)
    cols = [h.get(f'{var}_{m}') for m in models if h.get(f'{var}_{m}') is not None]
    # 모델이 하나뿐이면 Open-Meteo 는 접미사 없이 평문 키로 준다(jma_msm, 2026-10-26 확인) — 그 값을 쓴다.
    if not cols: return h.get(var)
    n = len(cols[0]); out = []
    for i in range(n):
        vs = [c[i] for c in cols if c[i] is not None]
        out.append(sum(vs) / len(vs) if vs else None)
    return out

def interp(times, series, t_iso):
    """정시 시계열(UTC 문자열 'YYYY-MM-DDTHH:MM')을 t(UTC) 에 선형 보간. 둘 중 하나가 None 이면 None."""
    t = datetime.strptime(t_iso[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
    h0 = t.replace(minute=0, second=0); frac = (t - h0).total_seconds() / 3600.0
    from datetime import timedelta
    k0 = h0.strftime('%Y-%m-%dT%H:%M'); k1 = (h0 + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M')
    idx = {x: i for i, x in enumerate(times)}
    i0, i1 = idx.get(k0), idx.get(k1)
    if i0 is None or i1 is None: return None
    a, b = series[i0], series[i1]
    if a is None or b is None: return None
    return a * (1 - frac) + b * frac

def main(argv):
    def opt(k, d): return argv[argv.index(k) + 1] if k in argv else d
    here = os.path.dirname(os.path.abspath(__file__)); root = os.path.abspath(os.path.join(here, '..', '..', '..'))
    scenes = opt('--scenes', os.path.join(root, '.harness', 'macro', 'sat'))
    tag = opt('--tag', 'blend'); endpoint = opt('--endpoint', 'historical')
    models_s = opt('--models', 'ecmwf_ifs025,icon_seamless' if endpoint == 'historical' else '')
    models = [m for m in models_s.split(',') if m]
    start, end = opt('--start', '2026-09-01'), opt('--end', '2026-10-19'); sleep_s = float(opt('--sleep', '60'))
    sites_filter = opt('--sites', '').split(',') if '--sites' in argv else None
    mt = json.load(open(opt('--times', os.path.join(here, 'modis-times.json'))))
    shift_h = float(opt('--shift-hours', '0'))
    raw_dir = os.path.join(here, 'nwp', opt('--raw-tag', tag)); os.makedirs(raw_dir, exist_ok=True)
    out_dir = f'{scenes}-nwp-{tag}'; out_lm = f'{scenes}-nwp-{tag}-lm'; os.makedirs(out_dir, exist_ok=True); os.makedirs(out_lm, exist_ok=True)
    files = sorted(f for f in glob.glob(os.path.join(scenes, '*.json')) if not f.endswith('index.json'))
    by_site = {}
    for f in files:
        sc = json.load(open(f)); by_site.setdefault(sc['site'], []).append(sc)
    base = 'https://historical-forecast-api.open-meteo.com/v1/forecast' if endpoint == 'historical' else 'https://archive-api.open-meteo.com/v1/archive'
    for site, scs in sorted(by_site.items()):
        if sites_filter and site not in sites_filter: continue
        raw_path = os.path.join(raw_dir, f'{site}.json')
        lat, lon = scs[0]['lat'], scs[0]['lon']; pts = ring_points(lat, lon)
        if not os.path.exists(raw_path):
            lats = ','.join(f'{p[2]:.5f}' for p in pts); lons = ','.join(f'{p[3]:.5f}' for p in pts)
            url = (f'{base}?latitude={lats}&longitude={lons}&hourly={",".join(VARS)}&start_date={start}&end_date={end}&timezone=GMT'
                   + (f'&models={",".join(models)}' if models else ''))
            data = None
            for k in range(3):
                try:
                    with urllib.request.urlopen(url, timeout=180) as r: data = json.loads(r.read()); break
                except urllib.error.HTTPError as e:
                    body = e.read()[:200]; print('HTTP', e.code, body, file=sys.stderr)
                    if e.code == 429 and b'Daily' in body: print('일일 한도 — 멈춤(사이트 단위 이어서)', file=sys.stderr); return 2
                    if e.code == 403: print('403 — 권한 없음, 중단·보고', file=sys.stderr); return 3
                    time.sleep(60)
                except Exception as e: print('ERR', str(e)[:120], file=sys.stderr); time.sleep(30)
            if data is None: return 2
            if isinstance(data, dict): data = [data]
            if len(data) != len(pts): print('지점 수 불일치', len(data), len(pts), file=sys.stderr); return 4
            json.dump({'site': site, 'models': models, 'endpoint': endpoint, 'points': [{'dist': p[0], 'az': p[1], 'lat': p[2], 'lon': p[3]} for p in pts], 'data': data}, open(raw_path, 'w'))
            print(site, 'fetched', len(data), 'points', file=sys.stderr)
            time.sleep(sleep_s)
        raw = json.load(open(raw_path))
        for sc in scs:
            name = f"{sc['site']}_{sc['date']}"
            if name not in mt: print(name, 'no time', file=sys.stderr); continue
            t_iso = mt[name]['modisTimeUtc']
            if shift_h:
                from datetime import timedelta as _td
                t_iso = (datetime.strptime(t_iso[:19], '%Y-%m-%dT%H:%M:%S') + _td(hours=shift_h)).strftime('%Y-%m-%dT%H:%M:%SZ')
            covers = []; covers_lm = []; missing = 0
            for j, d in enumerate(raw['data']):
                h = d.get('hourly') or {}; times = h.get('time') or []
                tot = interp(times, blend(h, 'cloud_cover', models) or [None] * len(times), t_iso) if times else None
                lo = interp(times, blend(h, 'cloud_cover_low', models) or [None] * len(times), t_iso) if times else None
                mi = interp(times, blend(h, 'cloud_cover_mid', models) or [None] * len(times), t_iso) if times else None
                covers.append(None if tot is None else tot / 100.0)
                covers_lm.append(None if (lo is None or mi is None) else 1 - (1 - lo / 100.0) * (1 - mi / 100.0))
                if tot is None: missing += 1
            if missing > len(covers) * 0.10:
                print(name, 'excluded: missing', missing, file=sys.stderr); continue
            # 장면 고리 순서는 fetch-sat.py RING 과 같다(관측점 + 90). 지점 수가 같을 때만.
            if len(sc['ring']) != len(covers): print(name, 'ring length mismatch', len(sc['ring']), len(covers), file=sys.stderr); continue
            for out_path, cv in ((os.path.join(out_dir, f'{name}.json'), covers), (os.path.join(out_lm, f'{name}.json'), covers_lm)):
                cp = dict(sc)
                # 결측 지점은 **빼고**(위성 대용값으로 채우지 않음 — 참값이 입력에 섞이면 안 됨). 관측점(dist 0)이 결측이면 장면 제외.
                if cv[0] is None: print(name, 'excluded: observer point missing', file=sys.stderr); break
                cp['ring'] = [dict(r, cover=c) for r, c in zip(sc['ring'], cv) if c is not None]
                cp['nwp'] = {'tag': tag, 'endpoint': endpoint, 'models': models, 'modisTimeUtc': t_iso, 'shiftHours': shift_h, 'seam': mt[name].get('seam'), 'multiPass': mt[name].get('multiPass'), 'rule': mt[name].get('rule'), 'timeSource': mt[name]['source'], 'missing': missing}
                json.dump(cp, open(out_path, 'w'))
        print(site, 'scenes written', len(scs), file=sys.stderr)
    print('done', file=sys.stderr); return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
