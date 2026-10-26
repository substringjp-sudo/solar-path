#!/usr/bin/env python3
"""
lead-curve.py — RULER-ringtruth Q2: 리드 0~7 일(previous-runs `_previous_dayN`, 실제 리드 24N~24N+6 h)의 GHI 투과율·총운량(τ 화) 기술을
위성 관측 GHI(satellite-api) 에 대해 잰다. 9 곳(denver 제외), 2026-08-01~10-23, 보고 기간 9/16~10/23.
  python3 tools/genus-ruler/ring/lead-curve.py [--fetch-only] [--eval-only]
원자료: ring/lead/<site>-prev.json, <site>-sat.json(gitignore, resume). 결과: ring/lead-curve.json + 표.
규약(§3): 표본 = 위성 τ 와 8 리드 × 2 모델 모두 non-null, 창 가운데 해 ≥ 15°, 맑은 GHI 창 평균 ≥ 226; 곳별 맑음 배율 = 위성 τ p95 하나;
기후값 = 보고 기간 그 곳의 τ_sat 평균(상수); 지속성 = 전날 같은 시각 τ_sat; 총운량은 (H−1,H) 평균 → Kasten–Czeplak 정방향 τ;
skill 에 단조 비증가(PAV) 맞춤 → 0.5·0.2 교차 시각(24L+3 중앙, 선형 보간); 날 블록(달력 날짜, 모든 곳) 부트스트랩 95 %.
"""
import sys, os, json, math, time, urllib.request, urllib.error
import numpy as np
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from solar_util import sun_alt_deg, clear_sky_ghi_mean, tau_from_cover, parse_utc, MIN_CLEAR_GHI, MIN_SUN_ALT

SITES = {'seoul': (37.5, 127.0), 'kanazawa': (36.5679, 136.6774), 'osaka': (34.69, 135.5), 'busan': (35.18, 129.08), 'shanghai': (31.23, 121.47),
         'sapporo': (43.06, 141.35), 'lisbon': (38.72, -9.14), 'sydney': (-33.87, 151.21), 'hamburg': (53.55, 9.99)}
MODELS = ['ecmwf_ifs025', 'icon_seamless']
LEADS = list(range(8))
START, END = '2026-08-01', '2026-10-23'
REPORT_START = '2026-09-16'
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = os.path.join(HERE, 'lead'); os.makedirs(RAW, exist_ok=True)

def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r: return json.loads(r.read()), 200
        except urllib.error.HTTPError as e:
            body = e.read()[:200]; print('HTTP', e.code, body, file=sys.stderr)
            if e.code in (403, 429): return None, e.code
            time.sleep(30)
        except Exception as e:
            print('ERR', str(e)[:100], file=sys.stderr); time.sleep(20)
    return None, 0

def fetch():
    for site, (lat, lon) in SITES.items():
        pp = os.path.join(RAW, f'{site}-prev.json'); sp = os.path.join(RAW, f'{site}-sat.json')
        if not os.path.exists(pp):
            vars_ = [f'shortwave_radiation_previous_day{L}' for L in LEADS] + [f'cloud_cover_previous_day{L}' for L in LEADS]
            url = (f'https://previous-runs-api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly={",".join(vars_)}'
                   f'&models={",".join(MODELS)}&start_date={START}&end_date={END}&timezone=GMT')
            d, code = get(url)
            if d is None:
                if code == 403: print('previous-runs 403 — Q2 축소(보고)', file=sys.stderr); return 3
                print('previous-runs 실패 — 멈춤(resume)', file=sys.stderr); return 2
            json.dump(d, open(pp, 'w')); print(site, 'prev ok', file=sys.stderr); time.sleep(5)
        if not os.path.exists(sp):
            url = (f'https://satellite-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&hourly=shortwave_radiation'
                   f'&start_date={START}&end_date={END}&timezone=GMT&models=satellite_radiation_seamless')
            d, code = get(url)
            if d is None: print('satellite 실패 — 멈춤(resume)', file=sys.stderr); return 2
            json.dump(d, open(sp, 'w')); print(site, 'sat ok', file=sys.stderr); time.sleep(2)
    return 0

def blend(h, var):
    cols = [h.get(f'{var}_{m}') for m in MODELS if h.get(f'{var}_{m}') is not None]
    if not cols: cols = [h[var]] if h.get(var) is not None else []
    if not cols: return None
    out = []
    for i in range(len(cols[0])):
        vs = [c[i] for c in cols if c[i] is not None]
        out.append(sum(vs) / len(vs) if vs else None)
    return out

def build_rows():
    rows = []
    for site, (lat, lon) in SITES.items():
        pp = os.path.join(RAW, f'{site}-prev.json'); sp = os.path.join(RAW, f'{site}-sat.json')
        if not (os.path.exists(pp) and os.path.exists(sp)): continue
        P = json.load(open(pp))['hourly']; S = json.load(open(sp))['hourly']
        st = {t: i for i, t in enumerate(S['time'])}
        # previous-runs 응답은 리드 0(현재 런)을 접미사 없이 `shortwave_radiation_<model>` 로 준다(2026-10-26 확인) — `_previous_day0` 키는 없다.
        ghi = {L: blend(P, f'shortwave_radiation_previous_day{L}' if L else 'shortwave_radiation') for L in LEADS}
        cc = {L: blend(P, f'cloud_cover_previous_day{L}' if L else 'cloud_cover') for L in LEADS}
        if any(v is None for v in ghi.values()) or any(v is None for v in cc.values()): print(site, 'variables missing', file=sys.stderr); continue
        sat = S['shortwave_radiation']
        for i, t in enumerate(P['time']):
            j = st.get(t)
            if j is None or sat[j] is None: continue
            if any(ghi[L][i] is None or cc[L][i] is None for L in LEADS): continue
            if i == 0 or any(cc[L][i - 1] is None for L in LEADS): continue
            end = parse_utc(t)
            alt = sun_alt_deg(end - timedelta(minutes=30), lat, lon)
            if alt < MIN_SUN_ALT: continue
            cs = clear_sky_ghi_mean(end, lat, lon)
            if cs < MIN_CLEAR_GHI: continue
            row = dict(site=site, t=t, date=t[:10], tau_sat=sat[j] / cs, alt=alt)
            for L in LEADS:
                row[f'ghi{L}'] = ghi[L][i] / cs
                row[f'cc{L}'] = tau_from_cover(0.5 * (cc[L][i] + cc[L][i - 1]))
            rows.append(row)
    return rows

def pav_decreasing(y):
    """pool-adjacent-violators: 단조 비증가 맞춤."""
    blocks = [[v, 1] for v in y]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] < blocks[i + 1][0]:
            a, b = blocks[i], blocks[i + 1]
            blocks[i] = [(a[0] * a[1] + b[0] * b[1]) / (a[1] + b[1]), a[1] + b[1]]; del blocks[i + 1]
            i = max(0, i - 1)
        else: i += 1
    out = []
    for v, n in blocks: out += [v] * n
    return out

def crossing_hour(skill_fit, thr):
    """h(L) = 24L + 3 에서 skill 이 thr 를 아래로 지나는 시각(선형 보간). 안 지나면 None."""
    hs = [24 * L + 3 for L in LEADS]
    if skill_fit[0] < thr: return hs[0]
    for L in range(len(LEADS) - 1):
        a, b = skill_fit[L], skill_fit[L + 1]
        if a >= thr > b:
            return hs[L] + (hs[L + 1] - hs[L]) * (a - thr) / (a - b) if a != b else hs[L]
    return None

def metrics(rows, key, clim, pers):
    """rows: 보고 기간. key: 'ghi'|'cc'. clim: site→mean tau_sat. pers: (site,t)→tau_sat 24h 전."""
    out = {}
    ys = np.array([r['tau_sat'] for r in rows])
    for L in LEADS:
        xs = np.array([r[f'{key}{L}'] for r in rows])
        clim_arr = np.array([clim[r['site']] for r in rows])
        mse = np.mean((xs - ys) ** 2); mse_c = np.mean((clim_arr - ys) ** 2)
        m = dict(r=float(np.corrcoef(xs, ys)[0, 1]) if len(xs) > 2 else float('nan'), mae=float(np.mean(np.abs(xs - ys)) * 100), skill_clim=float(1 - mse / mse_c) if mse_c > 0 else float('nan'))
        pidx = [k for k, r in enumerate(rows) if (r['site'], r['t']) in pers]
        if len(pidx) > 30:
            pa = np.array([pers[(rows[k]['site'], rows[k]['t'])] for k in pidx]); mse_p = np.mean((pa - ys[pidx]) ** 2); mse_l = np.mean((xs[pidx] - ys[pidx]) ** 2)
            m['skill_pers'] = float(1 - mse_l / mse_p) if mse_p > 0 else float('nan'); m['n_pers'] = len(pidx)
        out[L] = m
    return out

def evaluate():
    rows_all = build_rows()
    if not rows_all: print('표본 없음', file=sys.stderr); return
    # 곳별 맑음 배율(위성 τ p95, 보고 기간) — 세 자료원(위성·예보 GHI) 모두에 같이
    rep = [r for r in rows_all if r['date'] >= REPORT_START]
    scale = {s: float(np.percentile([r['tau_sat'] for r in rep if r['site'] == s], 95)) for s in SITES if any(r['site'] == s for r in rep)}
    for r in rows_all:
        sc = scale.get(r['site'])
        if not sc: continue
        r['tau_sat'] = min(1.2, r['tau_sat'] / sc)
        for L in LEADS: r[f'ghi{L}'] = min(1.2, r[f'ghi{L}'] / sc)
    rep = [r for r in rows_all if r['date'] >= REPORT_START and r['site'] in scale]
    counts = {s: sum(1 for r in rep if r['site'] == s) for s in SITES}
    rep = [r for r in rep if counts[r['site']] >= 100]
    clim = {s: float(np.mean([r['tau_sat'] for r in rep if r['site'] == s])) for s in SITES if counts.get(s, 0) >= 100}
    clim_pre = {s: float(np.mean([r['tau_sat'] for r in rows_all if r['site'] == s and r['date'] < REPORT_START])) for s in clim}
    byst = {(r['site'], r['t']): r['tau_sat'] for r in rows_all}
    pers = {}
    for r in rep:
        tp = (parse_utc(r['t']) - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M')
        if (r['site'], tp) in byst: pers[(r['site'], r['t'])] = byst[(r['site'], tp)]
    res = {'n': len(rep), 'sites': counts, 'scale': scale, 'clim': clim, 'ghi': metrics(rep, 'ghi', clim, pers), 'cc': metrics(rep, 'cc', clim, pers)}
    res['ghi_clim_pre'] = metrics(rep, 'ghi', clim_pre, pers)   # 부록: 8/1~9/15 기후값 민감도
    for key in ('ghi', 'cc'):
        fit = pav_decreasing([res[key][L]['skill_clim'] for L in LEADS])
        res[key + '_fit'] = fit; res[key + '_cross'] = {'0.5': crossing_hour(fit, 0.5), '0.2': crossing_hour(fit, 0.2)}
    # 날 블록 부트스트랩(달력 날짜, 모든 곳)
    dates = sorted({r['date'] for r in rep}); bydate = {d: [r for r in rep if r['date'] == d] for d in dates}
    rng = np.random.default_rng(7); B = 1000
    boot = {key: {'skill': {L: [] for L in LEADS}, 'cross05': [], 'cross02': [], 'diff': {L: [] for L in LEADS[:-1]}} for key in ('ghi', 'cc')}
    for _ in range(B):
        samp = [r for d in rng.choice(dates, size=len(dates), replace=True) for r in bydate[d]]
        for key in ('ghi', 'cc'):
            m = metrics(samp, key, clim, {})
            sk = [m[L]['skill_clim'] for L in LEADS]; fit = pav_decreasing(sk)
            for L in LEADS: boot[key]['skill'][L].append(sk[L])
            for L in LEADS[:-1]: boot[key]['diff'][L].append(sk[L] - sk[L + 1])
            c5 = crossing_hour(fit, 0.5); c2 = crossing_hour(fit, 0.2)
            boot[key]['cross05'].append(c5 if c5 is not None else 999); boot[key]['cross02'].append(c2 if c2 is not None else 999)
    ci = lambda a: [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]
    for key in ('ghi', 'cc'):
        res[key + '_ci'] = {'skill': {L: ci(boot[key]['skill'][L]) for L in LEADS}, 'cross05': ci(boot[key]['cross05']), 'cross02': ci(boot[key]['cross02']), 'diff': {L: ci(boot[key]['diff'][L]) for L in LEADS[:-1]}}
    json.dump(res, open(os.path.join(HERE, 'lead-curve.json'), 'w'), indent=1, default=str)
    print(f"표본 {len(rep)} 시각, 날 블록 {len(dates)}, 곳 {len(clim)}  배율 {{{', '.join(f'{s}:{v:.2f}' for s, v in scale.items())}}}")
    for key, label in (('ghi', 'GHI 투과율'), ('cc', '총운량 τ')):
        print(f'── {label}')
        print(' L   리드(h)     r    MAE×100  skill_clim   [95% CI]        skill_pers  fit')
        for L in LEADS:
            m = res[key][L]; c = res[key + '_ci']['skill'][L]
            print(f" {L}  {24*L:3d}~{24*L+6:3d}   {m['r']:.3f}   {m['mae']:5.1f}    {m['skill_clim']:+.3f}   [{c[0]:+.3f},{c[1]:+.3f}]   {m.get('skill_pers', float('nan')):+.3f}   {res[key+'_fit'][L]:+.3f}")
        cr = res[key + '_cross']; cc_ = res[key + '_ci']
        print(f"  0.5 교차 {cr['0.5']} h  CI {cc_['cross05']}   ·  0.2 교차 {cr['0.2']} h  CI {cc_['cross02']}   (지금 72 / 168 h)")

def main(argv):
    if '--eval-only' not in argv:
        rc = fetch()
        if rc not in (0, 3): return rc
    if '--fetch-only' not in argv: evaluate()
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
