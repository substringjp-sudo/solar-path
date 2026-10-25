#!/usr/bin/env python3
"""
evalmetar.py — RULER-metar 평가. pairs_metar.jsonl 에서 후보 C0~C2(덮개)·B0~B4(밑면)·P0~P2(강수)를 홀수 날로 정해 짝수 날로 보고 → metar-results.json
numpy 만 씁니다. lowDeck·LCL 은 src/utils/cloudProfile.ts 와 같은 식.
"""
import json, os, sys, collections, itertools
import numpy as np

LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700]
LOW_TOP_M = 2000

def low_deck(lv):
    """cloudProfile.lowDeck 그대로: lv = [(heightM, coverPct)] 오름차순."""
    peak = -1
    for i, (h, c) in enumerate(lv):
        if h >= LOW_TOP_M: break
        if c > 0 and (peak < 0 or c > lv[peak][1]): peak = i
    if peak < 0: return None
    half = lv[peak][1] / 2; lo = hi = peak
    while lo > 0 and lv[lo - 1][1] >= half: lo -= 1
    while hi < len(lv) - 1 and lv[hi + 1][1] >= half: hi += 1
    base = (lv[lo - 1][0] + lv[lo][0]) / 2 if lo > 0 else max(0, lv[lo][0] - 125)
    top = (lv[hi][0] + lv[hi + 1][0]) / 2 if hi < len(lv) - 1 else lv[hi][0] + 125
    return base, top

def lcl_m(t, td):
    if t is None or td is None: return None
    return max(0.0, 125 * (t - td))

def features(r):
    lv = sorted((r[f'geopotential_height_{p}hPa'], r[f'cloud_cover_{p}hPa']) for p in LEVELS
                if r.get(f'geopotential_height_{p}hPa') is not None and r.get(f'cloud_cover_{p}hPa') is not None)
    deck = low_deck(lv) if lv else None
    ground = r.get('model_elev') or 0
    lcl = lcl_m(r.get('temperature_2m'), r.get('dew_point_2m'))
    code = r.get('weather_code')
    return dict(
        day=int(r['t'][8:10]), st=r['st'],
        cl=r.get('cloud_cover_low') or 0, cm=r.get('cloud_cover_mid') or 0, ct=r.get('cloud_cover') or 0,
        precip=r.get('precipitation') or 0, pbl=r.get('boundary_layer_height') or 0, rh2=r.get('relative_humidity_2m'),
        code_wet=(code is not None and (51 <= code <= 67 or 71 <= code <= 77 or 80 <= code <= 99)),
        deck_base_agl=(deck[0] - ground) if deck else None, lcl_agl=lcl,
        # 앱 B0: 덱 있으면 덱 밑면, 없으면 LCL(둘 다 AGL m)
        b0=(deck[0] - ground) if deck else lcl,
        obs_low=r['low_pct'], obs_base=r['base_m_agl'], obs_precip=bool(r['precip']),
    )

# ── 덮개 ──
def cover_pred(f, cand, T):
    if cand == 'C0': return f['cl'] >= T
    if cand == 'C1': return f['cl'] >= T or f['precip'] >= 0.3
    raise ValueError

def binary_score(items, y, p):
    y = np.array(y, bool); p = np.array(p, bool); n = len(y)
    maj = max(y.mean(), 1 - y.mean())
    acc = (p == y).mean(); rec = p[y].mean() if y.any() else 0.0; prec = y[p].mean() if p.any() else 0.0
    return dict(n=int(n), acc=float(acc), majority=float(maj), recall=float(rec), precision=float(prec), pos_rate=float(y.mean()))

def logistic(X, y, iters=500, lr=0.1):
    mu = X.mean(0); sd = X.std(0) + 1e-9; Z = (X - mu) / sd
    w = np.zeros(Z.shape[1]); b = 0.0
    for _ in range(iters):
        z = Z @ w + b; p = 1 / (1 + np.exp(-z)); g = p - y
        w -= lr * Z.T @ g / len(y); b -= lr * g.mean()
    return lambda Xn: 1 / (1 + np.exp(-(((Xn - mu) / sd) @ w + b)))

# ── 밑면 ──
def base_pred(f, cand, clim, bias):
    if cand == 'B0': return f['b0']
    if cand == 'B1': return f['lcl_agl']
    if cand == 'B2': return clim
    if cand == 'B3':
        a, b = f['b0'], f['lcl_agl']
        if a is None: return b
        if b is None: return a
        return min(a, b)
    if cand == 'B4': return None if f['b0'] is None else f['b0'] - bias
    raise ValueError

def base_score(items, cand, clim, bias):
    err = []
    for f in items:
        p = base_pred(f, cand, clim, bias)
        if p is None: continue
        err.append(p - f['obs_base'])
    e = np.array(err)
    if not len(e): return None
    return dict(n=int(len(e)), mae=float(np.abs(e).mean()), median_err=float(np.median(e)), within300=float((np.abs(e) <= 300).mean()), coverage=float(len(e) / len(items)))

# ── 강수 ──
def precip_pred(f, cand, T):
    if cand == 'P0': return f['precip'] >= 0.3
    if cand == 'P1': return f['precip'] >= T
    if cand == 'P2': return f['precip'] >= T or f['code_wet']
    raise ValueError

def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    F = [features(json.loads(l)) for l in open(os.path.join(here, 'pairs_metar.jsonl'))]
    F = [f for f in F if f['obs_low'] is not None]
    odd = [f for f in F if f['day'] % 2 == 1]; even = [f for f in F if f['day'] % 2 == 0]
    print('전체', len(F), '홀수', len(odd), '짝수', len(even), '공항', len({f['st'] for f in F}))
    R = {}
    # 덮개
    print('── 덮개(METAR 저층 ≥ 75 %)')
    def obj(s): return s['acc'] - 0.5 * max(0, 0.5 - s['recall']) - 0.5 * max(0, 0.5 - s['precision'])
    for cand in ('C0', 'C1'):
        best = max(((obj(binary_score(odd, [f['obs_low'] >= 75 for f in odd], [cover_pred(f, cand, T) for f in odd])), T) for T in (40, 50, 60, 70, 80)))
        T = best[1]; s = binary_score(even, [f['obs_low'] >= 75 for f in even], [cover_pred(f, cand, T) for f in even])
        print(f"{cand} T={T}: n={s['n']} 정확도 {s['acc']:.3f} 다수 {s['majority']:.3f} ({(s['acc']-s['majority'])*100:+.1f}p) 재현 {s['recall']:.2f} 정밀 {s['precision']:.2f} 덮개 비율 {s['pos_rate']:.2f}")
        R[cand] = dict(T=T, even=s)
    X = lambda fs: np.array([[f['cl'], f['cm'], f['ct'], f['pbl'], f['precip'], f['rh2'] or 0] for f in fs], float)
    model = logistic(X(odd), np.array([f['obs_low'] >= 75 for f in odd], float))
    s = binary_score(even, [f['obs_low'] >= 75 for f in even], list(model(X(even)) >= 0.5))
    print(f"C2 로지스틱: 정확도 {s['acc']:.3f} ({(s['acc']-s['majority'])*100:+.1f}p) 재현 {s['recall']:.2f} 정밀 {s['precision']:.2f}")
    R['C2'] = dict(even=s)
    # 운량 MAE
    e = np.array([f['cl'] - f['obs_low'] for f in even]); print(f"저층 운량 MAE {np.abs(e).mean():.1f} %p, 중앙 편향 {np.median(e):+.1f} %p, 상관 {np.corrcoef([f['cl'] for f in even],[f['obs_low'] for f in even])[0,1]:.3f}")
    R['cover_mae'] = dict(mae=float(np.abs(e).mean()), median_bias=float(np.median(e)))
    # 밑면
    print('── 밑면(METAR 운저 있음·예보 저층 ≥ 20 %)')
    bo = [f for f in odd if f['obs_base'] is not None and f['cl'] >= 20]; be = [f for f in even if f['obs_base'] is not None and f['cl'] >= 20]
    clim = float(np.median([f['obs_base'] for f in bo]))
    bias = float(np.median([f['b0'] - f['obs_base'] for f in bo if f['b0'] is not None]))
    print(f'홀수 날 기후 운저 중앙값 {clim:.0f} m, B0 중앙 편향 {bias:+.0f} m')
    R['base'] = dict(clim=clim, bias=bias)
    for cand in ('B0', 'B1', 'B2', 'B3', 'B4'):
        s = base_score(be, cand, clim, bias)
        if s: print(f"{cand}: n={s['n']} MAE {s['mae']:.0f} m 중앙오차 {s['median_err']:+.0f} m ±300 m {s['within300']:.2f} 적용률 {s['coverage']:.2f}"); R['base'][cand] = s
    # 강수
    print('── 강수(METAR 비·눈)')
    for cand in ('P0', 'P1', 'P2'):
        Ts = [0.3] if cand == 'P0' else [0.05, 0.1, 0.2, 0.3, 0.5]
        best = max(((obj(binary_score(odd, [f['obs_precip'] for f in odd], [precip_pred(f, cand, T) for f in odd])), T) for T in Ts))
        T = best[1]; s = binary_score(even, [f['obs_precip'] for f in even], [precip_pred(f, cand, T) for f in even])
        print(f"{cand} T={T}: 정확도 {s['acc']:.3f} 다수 {s['majority']:.3f} ({(s['acc']-s['majority'])*100:+.1f}p) 재현 {s['recall']:.2f} 정밀 {s['precision']:.2f} 비 비율 {s['pos_rate']:.2f}")
        R[cand] = dict(T=T, even=s)
    # METAR 가 그림을 바꾸는 비율
    chg = 0
    for f in even:
        dcov = abs(f['cl'] - f['obs_low']) > 30
        dbase = f['obs_base'] is not None and f['b0'] is not None and abs(f['b0'] - f['obs_base']) > 500
        dp = f['obs_precip'] != (f['precip'] >= 0.3)
        chg += dcov or dbase or dp
    print(f'METAR 가 그림을 바꾸는 시각 비율(짝수 날): {chg/len(even):.3f}')
    R['change_rate'] = chg / len(even)
    json.dump(R, open(os.path.join(here, 'metar-results.json'), 'w'), indent=1)

if __name__ == '__main__':
    main(sys.argv[1:])
