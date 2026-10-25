#!/usr/bin/env python3
"""
measure-source.py — RULER-source §3 S0~S4 측정(오프라인). Open-Meteo 세 끝점(forecast·historical·archive) + satellite-api.
  python3 tools/genus-ruler/source/measure-source.py [--today 2026-10-26] [--skip S2] [--eval-only]
원자료: source/raw/*.json(gitignore, resume). 결과: source/source-results.json + 표.
자료원 규칙은 src/utils/weatherSource.ts 와 같다(여기서는 끝점을 명시적으로 고른다).
"""
import sys, os, json, math, time, urllib.request, urllib.error
import numpy as np
from datetime import datetime, timedelta, timezone, date as ddate
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ring'))
from solar_util import sun_alt_deg, clear_sky_ghi_mean, parse_utc, MIN_CLEAR_GHI, MIN_SUN_ALT

SITES = {'seoul': (37.5, 127.0), 'kanazawa': (36.5679, 136.6774), 'osaka': (34.69, 135.5), 'busan': (35.18, 129.08), 'shanghai': (31.23, 121.47),
         'sapporo': (43.06, 141.35), 'lisbon': (38.72, -9.14), 'denver': (39.74, -104.99), 'sydney': (-33.87, 151.21), 'hamburg': (53.55, 9.99)}
SAT_SITES = [s for s in SITES if s != 'denver']
FC = 'https://api.open-meteo.com/v1/forecast'; HF = 'https://historical-forecast-api.open-meteo.com/v1/forecast'; AR = 'https://archive-api.open-meteo.com/v1/archive'
SAT = 'https://satellite-api.open-meteo.com/v1/archive'
BLEND = 'ecmwf_ifs025,icon_seamless'; MODELS = BLEND.split(',')
RING_VARS = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,direct_normal_irradiance,total_column_integrated_water_vapour,precipitation'
ARCH_RING_VARS = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,direct_normal_irradiance,precipitation'
T_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200]; RH_LEVELS = T_LEVELS[:13]
THERMO_VARS = ['temperature_2m', 'dew_point_2m', 'cape', 'freezing_level_height', 'boundary_layer_height'] + [f'temperature_{p}hPa' for p in T_LEVELS] + [f'relative_humidity_{p}hPa' for p in RH_LEVELS]
WINDS_VARS = ['wind_speed_850hPa', 'wind_direction_850hPa', 'wind_speed_600hPa', 'wind_direction_600hPa', 'wind_speed_250hPa', 'wind_direction_250hPa', 'visibility'] + \
             [v for p in T_LEVELS for v in (f'cloud_cover_{p}hPa', f'geopotential_height_{p}hPa')]
GROUPS = {'(a) CAPE·결빙고도': ['cape', 'freezing_level_height'], '(b) 기압면 기온·RH': [f'temperature_{p}hPa' for p in T_LEVELS] + [f'relative_humidity_{p}hPa' for p in RH_LEVELS],
          '(c) 기압면 운량·지오포텐셜': [v for p in T_LEVELS for v in (f'cloud_cover_{p}hPa', f'geopotential_height_{p}hPa')],
          '(d) 층별 바람': ['wind_speed_850hPa', 'wind_direction_850hPa', 'wind_speed_600hPa', 'wind_direction_600hPa', 'wind_speed_250hPa', 'wind_direction_250hPa'],
          '(e) 경계층·지상': ['boundary_layer_height', 'temperature_2m', 'dew_point_2m'], '(f) 시정': ['visibility']}
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = os.path.join(HERE, 'raw'); os.makedirs(RAW, exist_ok=True)
LOG = []

def get(url, tag):
    """캐시(raw/<tag>.json) → 없으면 요청. 돌려줌 (json|None, status)."""
    p = os.path.join(RAW, tag + '.json')
    if os.path.exists(p): return json.load(open(p)), 200
    t0 = time.time()
    for k in range(3):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                d = json.loads(r.read()); json.dump(d, open(p, 'w')); LOG.append((tag, 200, round(time.time() - t0, 1))); return d, 200
        except urllib.error.HTTPError as e:
            body = e.read()[:160]; LOG.append((tag, e.code, body.decode('utf8', 'ignore'))); print('HTTP', e.code, tag, body, file=sys.stderr)
            if e.code in (400, 403, 429): return None, e.code
            time.sleep(20)
        except Exception as e:
            print('ERR', tag, str(e)[:100], file=sys.stderr); time.sleep(15)
    return None, 0

def blend(h, var):
    cols = [h.get(f'{var}_{m}') for m in MODELS if h.get(f'{var}_{m}') is not None]
    if not cols: return h.get(var)
    out = []
    for i in range(len(cols[0])):
        vs = [c[i] for c in cols if c[i] is not None]; out.append(sum(vs) / len(vs) if vs else None)
    return out

def url_for(base, lat, lon, hourly, start, end, models=None, tz='GMT'):
    return f'{base}?latitude={lat}&longitude={lon}&hourly={hourly}&start_date={start}&end_date={end}&timezone={tz}' + (f'&models={models}' if models else '')

def s0(today):
    R = {}
    lat, lon = SITES['seoul']
    # ④ 한도 풀: 세 끝점 각 1 요청의 상태
    for name, base in (('fc', FC), ('hf', HF), ('ar', AR)):
        d, code = get(url_for(base, lat, lon, 'cloud_cover', '2026-10-10', '2026-10-10', BLEND if name != 'ar' else None), f's0_pool_{name}'); R[f'pool_{name}'] = code
    # ③ 보관 최신일
    latest = None
    for n in range(1, 8):
        day = (today - timedelta(days=n)).isoformat()
        d, code = get(url_for(HF, lat, lon, 'cloud_cover', day, day, BLEND), f's0_latest_{n}')
        if d and any(v is not None for v in (blend(d['hourly'], 'cloud_cover') or [])): latest = n; break
    R['historicalLatestDays'] = latest
    # ② icon_seamless 2022-11-24
    d, code = get(url_for(HF, lat, lon, 'cloud_cover', '2022-11-24', '2022-11-24', 'icon_seamless'), 's0_icon_start')
    R['iconSeamless2022'] = bool(d and any(v is not None for v in (d['hourly'].get('cloud_cover') or d['hourly'].get('cloud_cover_icon_seamless') or [])))
    # ① 91 점 블렌드 고리 요청
    sys.path.insert(0, os.path.join(HERE, '..', 'ring'))
    from importlib import import_module
    fnr = import_module('fetch-nwp-ring') if False else None
    import importlib.util
    spec = importlib.util.spec_from_file_location('fnr', os.path.join(HERE, '..', 'ring', 'fetch-nwp-ring.py')); fnr = importlib.util.module_from_spec(spec); spec.loader.exec_module(fnr)
    pts = fnr.ring_points(lat, lon); lats = ','.join(f'{p[2]:.5f}' for p in pts); lons = ','.join(f'{p[3]:.5f}' for p in pts)
    t0 = time.time(); d, code = get(f'{HF}?latitude={lats}&longitude={lons}&hourly={RING_VARS}&start_date=2026-10-10&end_date=2026-10-10&timezone=auto&models={BLEND}', 's0_ring91')
    R['ring91'] = {'status': code, 'n': len(d) if isinstance(d, list) else (1 if d else 0), 'suffixed': bool(d and isinstance(d, list) and any(k.endswith('_ecmwf_ifs025') for k in d[0]['hourly'])), 'sec': round(time.time() - t0, 1)}
    return R

def s1_s3(today):
    R = {'S1': {}, 'S1b': {}, 'S3': {}}; days = [(today - timedelta(days=n)).isoformat() for n in (3, 4, 5)]
    cov_ok = cov_n = dni_ok = dni_n = pr_ok = pr_n = nulls = total = 0
    diffs = {}  # var → list |Δ|
    fin = {'fc': {}, 'hf': {}, 'ar': {}}; cnt = {'fc': {}, 'hf': {}, 'ar': {}}
    for site, (lat, lon) in SITES.items():
        for day in days:
            a, _ = get(url_for(FC, lat, lon, RING_VARS, day, day, BLEND), f's1_ring_fc_{site}_{day}')
            b, _ = get(url_for(HF, lat, lon, RING_VARS, day, day, BLEND), f's1_ring_hf_{site}_{day}')
            if a and b:
                ha, hb = a['hourly'], b['hourly']
                for v in ('cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'):
                    xa, xb = blend(ha, v), blend(hb, v)
                    for i in range(min(len(xa), len(xb))):
                        total += 1
                        if xa[i] is None or xb[i] is None: nulls += 1; continue
                        cov_n += 1; cov_ok += abs(xa[i] - xb[i]) <= 1.0
                xa, xb = blend(ha, 'direct_normal_irradiance'), blend(hb, 'direct_normal_irradiance')
                for i, t in enumerate(ha['time']):
                    if xa[i] is None or xb[i] is None: continue
                    if sun_alt_deg(parse_utc(t), lat, lon) < 15: continue
                    dni_n += 1; dni_ok += abs(xa[i] - xb[i]) <= max(5.0, 0.01 * max(xa[i], xb[i]))
                xa, xb = blend(ha, 'precipitation'), blend(hb, 'precipitation')
                for i in range(len(xa)):
                    if xa[i] is None or xb[i] is None: continue
                    if max(xa[i], xb[i]) < 0.1: continue
                    pr_n += 1; pr_ok += abs(xa[i] - xb[i]) <= 0.1
            # S1-b / S3: thermo + winds (모델 미지정), 세 끝점
            for kind, vars_ in (('thermo', THERMO_VARS), ('winds', WINDS_VARS)):
                res = {}
                for name, base in (('fc', FC), ('hf', HF), ('ar', AR)):
                    d, _ = get(url_for(base, lat, lon, ','.join(vars_), day, day), f's1_{kind}_{name}_{site}_{day}')
                    res[name] = d['hourly'] if d else None
                    if d:
                        for v in vars_:
                            col = d['hourly'].get(v) or []
                            fin[name][v] = fin[name].get(v, 0) + sum(1 for x in col if x is not None); cnt[name][v] = cnt[name].get(v, 0) + max(1, len(col))
                if res['fc'] and res['hf']:
                    for v in vars_:
                        xa, xb = res['fc'].get(v) or [], res['hf'].get(v) or []
                        for i in range(min(len(xa), len(xb))):
                            if xa[i] is None or xb[i] is None: continue
                            diffs.setdefault(v, []).append(abs(xa[i] - xb[i]))
    R['S1'] = {'cover_eq1pp': cov_ok / cov_n if cov_n else None, 'cover_n': cov_n, 'null_ratio': nulls / total if total else None,
               'dni_ok': dni_ok / dni_n if dni_n else None, 'dni_n': dni_n, 'precip_ok': pr_ok / pr_n if pr_n else None, 'precip_n': pr_n}
    allv = [d for v, ds in diffs.items() for d in ds]
    R['S1b'] = {'eq0.1_ratio': float(np.mean([d <= 0.1 for d in allv])) if allv else None, 'n': len(allv),
                'worst_vars': sorted(((float(np.mean([d > 0.1 for d in ds])), v) for v, ds in diffs.items()), reverse=True)[:8]}
    for g, vars_ in GROUPS.items():
        row = {}
        for name in ('fc', 'hf', 'ar'):
            f = sum(fin[name].get(v, 0) for v in vars_); c = sum(cnt[name].get(v, 0) for v in vars_); row[name] = f / c if c else None
        row['pass'] = (row['hf'] is not None and row['fc'] is not None and row['hf'] >= row['fc'] - 0.02)
        R['S3'][g] = row
    return R

def s2():
    rows = []
    for site in SAT_SITES:
        lat, lon = SITES[site]
        hf, _ = get(url_for(HF, lat, lon, 'shortwave_radiation', '2026-09-01', '2026-09-30', BLEND), f's2_hf_{site}')
        b0, _ = get(url_for(AR, lat, lon, 'shortwave_radiation', '2026-09-01', '2026-09-30'), f's2_ar_{site}')
        b1, _ = get(url_for(AR, lat, lon, 'shortwave_radiation', '2026-09-01', '2026-09-30', 'era5'), f's2_era5_{site}')
        sat, _ = get(f'{SAT}?latitude={lat}&longitude={lon}&hourly=shortwave_radiation&start_date=2026-09-01&end_date=2026-09-30&timezone=GMT&models=satellite_radiation_seamless', f's2_sat_{site}')
        if not (hf and b0 and sat): print(site, 'S2 자료 부족', file=sys.stderr); continue
        H = blend(hf['hourly'], 'shortwave_radiation'); A0 = b0['hourly'].get('shortwave_radiation') or b0['hourly'].get('shortwave_radiation_era5')
        A1 = (b1['hourly'].get('shortwave_radiation') or b1['hourly'].get('shortwave_radiation_era5')) if b1 else None
        st = {t: i for i, t in enumerate(sat['hourly']['time'])}; S = sat['hourly']['shortwave_radiation']
        for i, t in enumerate(hf['hourly']['time']):
            j = st.get(t)
            if j is None or S[j] is None or H[i] is None or A0 is None or A0[i] is None: continue
            end = parse_utc(t); alt = sun_alt_deg(end - timedelta(minutes=30), lat, lon)
            cs = clear_sky_ghi_mean(end, lat, lon)
            if cs < MIN_CLEAR_GHI: continue
            rows.append(dict(site=site, date=t[:10], alt=alt, sat=S[j] / cs, hf=H[i] / cs, b0=A0[i] / cs, b1=(A1[i] / cs if A1 and A1[i] is not None else None)))
    if not rows: return {'n': 0}
    scale = {s: float(np.percentile([r['sat'] for r in rows if r['site'] == s and r['alt'] >= MIN_SUN_ALT], 95)) for s in SAT_SITES if any(r['site'] == s for r in rows)}
    for r in rows:
        k = scale[r['site']]
        for key in ('sat', 'hf', 'b0', 'b1'):
            if r[key] is not None: r[key] = min(1.2, r[key] / k)
    main = [r for r in rows if r['alt'] >= MIN_SUN_ALT]; low = [r for r in rows if 5 <= r['alt'] < MIN_SUN_ALT]
    def mae(rs, key): return float(np.mean([abs(r[key] - r['sat']) for r in rs if r[key] is not None]) * 100)
    def dark_bias(rs, key): d = [r[key] - r['sat'] for r in rs if r[key] is not None and r['sat'] < 0.45]; return float(np.mean(d) * 100) if d else None
    def corr(rs, key): a = np.array([r[key] for r in rs if r[key] is not None]); b = np.array([r['sat'] for r in rs if r[key] is not None]); return float(np.corrcoef(a, b)[0, 1])
    R = {'n': len(main), 'n_low': len(low), 'scale': scale}
    for key in ('hf', 'b0', 'b1'):
        if not any(r[key] is not None for r in main): continue
        R[key] = {'mae': mae(main, key), 'dark_bias': dark_bias(main, key), 'r': corr(main, key), 'mae_5_15': mae(low, key) if low else None}
    dates = sorted({r['date'] for r in main}); byd = {d: [r for r in main if r['date'] == d] for d in dates}
    rng = np.random.default_rng(7); dm = []
    for _ in range(1000):
        samp = [r for d in rng.choice(dates, size=len(dates), replace=True) for r in byd[d]]
        dm.append(mae(samp, 'hf') - mae(samp, 'b0'))
    R['delta_mae_hf_minus_b0'] = {'point': R['hf']['mae'] - R['b0']['mae'], 'ci95': [float(np.percentile(dm, 2.5)), float(np.percentile(dm, 97.5))], 'day_blocks': len(dates)}
    R['per_site_mae'] = {s: {k: mae([r for r in main if r['site'] == s], k) for k in ('hf', 'b0')} for s in scale}
    return R

def s4(today):
    """날 경계(23→00) 3 층 운량 점프: 같은 자료원 연속 이틀 vs 자료원 교차."""
    LAY = ('cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high')
    def jumps(ha, hb):
        out = []
        for v in LAY:
            xa, xb = blend(ha, v), blend(hb, v)
            if xa and xb and xa[-1] is not None and xb[0] is not None: out.append(abs(xb[0] - xa[-1]))
        return out
    same = {'hf': [], 'ar': []}; cross = {'fc/hf': [], 'hf/ar': [], 'hfi/ar': []}
    dst_skip = {'lisbon': {'2026-10-25'}, 'hamburg': {'2026-10-25'}, 'denver': {'2026-11-01'}}
    for site, (lat, lon) in SITES.items():
        # 같은 자료원: 9/10~9/19 연속 이틀 쌍(하루씩 요청, auto 시간대 = 앱과 같음)
        for base, name in ((HF, 'hf'), (AR, 'ar')):
            prev = None
            for n in range(10, 20):
                day = f'2026-09-{n:02d}'
                d, _ = get(url_for(base, lat, lon, 'cloud_cover_low,cloud_cover_mid,cloud_cover_high', day, day, BLEND if name == 'hf' else None, tz='auto'), f's4_{name}_{site}_{day}')
                if d and prev: same[name] += jumps(prev['hourly'], d['hourly'])
                prev = d
        # 교차: 오늘 −6(hf) → −5(fc)
        d6, d5 = (today - timedelta(days=6)).isoformat(), (today - timedelta(days=5)).isoformat()
        if d5 not in dst_skip.get(site, set()):
            a, _ = get(url_for(HF, lat, lon, 'cloud_cover_low,cloud_cover_mid,cloud_cover_high', d6, d6, BLEND, tz='auto'), f's4_x_hf_{site}_{d6}')
            b, _ = get(url_for(FC, lat, lon, 'cloud_cover_low,cloud_cover_mid,cloud_cover_high', d5, d5, BLEND, tz='auto'), f's4_x_fc_{site}_{d5}')
            if a and b: cross['fc/hf'] += jumps(a['hourly'], b['hourly'])
        a, _ = get(url_for(AR, lat, lon, 'cloud_cover_low,cloud_cover_mid,cloud_cover_high', '2024-02-02', '2024-02-02', tz='auto'), f's4_x_ar_{site}_2024-02-02')
        b, _ = get(url_for(HF, lat, lon, 'cloud_cover_low,cloud_cover_mid,cloud_cover_high', '2024-02-03', '2024-02-03', BLEND, tz='auto'), f's4_x_hf_{site}_2024-02-03')
        if a and b: cross['hf/ar'] += jumps(a['hourly'], b['hourly'])
        a, _ = get(url_for(AR, lat, lon, 'cloud_cover_low,cloud_cover_mid,cloud_cover_high', '2022-11-23', '2022-11-23', tz='auto'), f's4_x_ar_{site}_2022-11-23')
        b, _ = get(url_for(HF, lat, lon, 'cloud_cover_low,cloud_cover_mid,cloud_cover_high', '2022-11-24', '2022-11-24', 'icon_seamless', tz='auto'), f's4_x_hfi_{site}_2022-11-24')
        if a and b: cross['hfi/ar'] += jumps(a['hourly'], b['hourly'])
    med = lambda a: float(np.median(a)) if a else None
    R = {'same_median': {k: med(v) for k, v in same.items()}, 'same_n': {k: len(v) for k, v in same.items()}, 'cross_median': {k: med(v) for k, v in cross.items()}, 'cross_n': {k: len(v) for k, v in cross.items()}}
    base = med(same['hf']) or med(same['ar']) or 1.0
    R['ratio'] = {k: (med(v) / base if med(v) is not None and base else None) for k, v in cross.items()}
    rng = np.random.default_rng(7)
    R['ratio_ci'] = {}
    for k, v in cross.items():
        if len(v) < 6: continue
        bs = [np.median(rng.choice(v, size=len(v))) / max(1e-6, np.median(rng.choice(same['hf'], size=len(same['hf'])))) for _ in range(1000)]
        R['ratio_ci'][k] = [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]
    return R

def main(argv):
    def opt(k, d): return argv[argv.index(k) + 1] if k in argv else d
    today = ddate.fromisoformat(opt('--today', datetime.now(timezone.utc).date().isoformat()))
    skip = set(opt('--skip', '').split(','))
    R = {'today': today.isoformat()}
    if 'S0' not in skip: R['S0'] = s0(today); print('S0', json.dumps(R['S0'], ensure_ascii=False))
    if 'S1' not in skip: R.update(s1_s3(today)); print('S1', json.dumps(R['S1'])); print('S1b', json.dumps(R['S1b'])); print('S3', json.dumps(R['S3'], ensure_ascii=False, indent=1))
    if 'S2' not in skip: R['S2'] = s2(); print('S2', json.dumps(R['S2'], ensure_ascii=False, indent=1, default=str))
    if 'S4' not in skip: R['S4'] = s4(today); print('S4', json.dumps(R['S4'], ensure_ascii=False, indent=1))
    R['log'] = LOG[-50:]
    json.dump(R, open(os.path.join(HERE, 'source-results.json'), 'w'), indent=1, ensure_ascii=False, default=str)
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
