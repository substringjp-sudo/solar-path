#!/usr/bin/env python3
"""
evalgenus2.py — RULER-genus2 평가. pairs2.jsonl(pair2.py) 에서 특징을 만들고 후보 R0·R1·R2·R3 를 홀수 날로 정해 짝수 날로 보고합니다.
  python3 evalgenus2.py            R0(지금 TS 규칙)·R1·R2 를 홀수 날 격자 탐색 → 짝수 날 보고, R3 결정나무 참고 → genus2-results.json
numpy 만 씁니다.
"""
import json, sys, os, math, itertools, collections
import numpy as np

LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300]
LOW_TOP_M, MID_TOP_M = 2000, 7000
SHOWER = {80, 81, 82, 85, 86, 95, 96, 99}
CLMAP = {'0': None, '1': 'cu', '2': 'cu', '3': 'cb', '9': 'cb', '4': 'sc', '5': 'sc', '8': 'sc', '6': 'st', '7': 'st'}
CMMAP = {'0': None, '1': 'as', '2': 'as', **{str(i): 'ac' for i in range(3, 10)}}
CHMAP = {'0': None, **{str(i): 'ci' for i in range(1, 5)}, **{str(i): 'cs' for i in range(5, 9)}, '9': 'ci'}
NORM_LOW = {'cg': 'cu', 'ns': 'st'}

# ── §157 DNI 광학두께(dniOpticalDepth.ts 와 같은 식) ──
def airmass(h):
    h = max(0.1, h); return 1 / (math.sin(math.radians(h)) + 0.50572 * (h + 6.07995) ** -1.6364)
def clear_dni(h, aod=0.12):
    if h <= 0: return 0.0
    am = airmass(h); return 1000 * 0.7 ** (am ** 0.678) * math.exp(-max(0, aod - 0.12) * am)
def tau_dni(dni, h):
    if dni is None or h is None or h < 5: return None
    c = clear_dni(h)
    if c <= 1: return None
    T = max(0, dni) / c
    if T >= 0.98: return 0.0
    if T < 0.03: return 4.0
    return min(4.0, -math.log(T))

def sun_alt(t, lat, lon):
    """해 고도(도) — 단순 천문식(±0.5°)."""
    y, mo, d = int(t[0:4]), int(t[5:7]), int(t[8:10]); hh = int(t[11:13])
    # 일수(2000-01-01 12:00 기준)
    a = (14 - mo) // 12; yy = y + 4800 - a; mm = mo + 12 * a - 3
    jdn = d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045
    jd = jdn + (hh - 12) / 24
    n = jd - 2451545.0
    L = (280.460 + 0.9856474 * n) % 360; g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    dec = math.asin(math.sin(eps) * math.sin(lam))
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    gmst = (18.697374558 + 24.06570982441908 * n) % 24
    ha = math.radians((gmst * 15 + lon) % 360) - ra
    phi = math.radians(lat)
    return math.degrees(math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(ha)))

def profile(r):
    out = []
    for p in LEVELS:
        h, c, rh = r.get(f'geopotential_height_{p}hPa'), r.get(f'cloud_cover_{p}hPa'), r.get(f'relative_humidity_{p}hPa')
        if h is not None and c is not None: out.append((h, c, rh))
    return sorted(out)

def low_deck(lv):
    peak = -1
    for i, (h, c, _) in enumerate(lv):
        if h >= LOW_TOP_M: break
        if c > 0 and (peak < 0 or c > lv[peak][1]): peak = i
    if peak < 0: return None
    half = lv[peak][1] / 2; lo = hi = peak
    while lo > 0 and lv[lo - 1][1] >= half: lo -= 1
    while hi < len(lv) - 1 and lv[hi + 1][1] >= half: hi += 1
    base = (lv[lo - 1][0] + lv[lo][0]) / 2 if lo > 0 else max(0, lv[lo][0] - 125)
    top = (lv[hi][0] + lv[hi + 1][0]) / 2 if hi < len(lv) - 1 else lv[hi][0] + 125
    return base / 1000, top / 1000

def features(r):
    lv = profile(r); deck = low_deck(lv) if lv else None
    ground = (r.get('elev') if r.get('elev') is not None else r.get('model_elev')) or 0
    t, td = r.get('temperature_2m'), r.get('dew_point_2m')
    lcl = max(0.0, 125 * (t - td) / 1000) if (t is not None and td is not None) else None
    cl = r['cl']
    h = sun_alt(r['t'], r['lat'], r['lon'])
    mid_lv = [(hh, c, rh) for hh, c, rh in lv if LOW_TOP_M <= hh < MID_TOP_M]
    high_lv = [(hh, c, rh) for hh, c, rh in lv if hh >= MID_TOP_M]
    return dict(
        cl=r.get('cloud_cover_low') or 0, cm=r.get('cloud_cover_mid') or 0, ch=r.get('cloud_cover_high') or 0,
        precip=r.get('precipitation') or 0, cape=r.get('cape'), li=r.get('lifted_index'), shower=(r.get('weather_code') in SHOWER),
        code=r.get('weather_code'), rh2=r.get('relative_humidity_2m'), pbl=(r.get('boundary_layer_height') or 0) / 1000,
        thick=(deck[1] - deck[0]) if deck else None, base_agl=(max(0, deck[0] - ground / 1000) if deck else lcl),
        wet=sum(1 for _, c, _ in mid_lv if c >= 10), wet_rh=sum(1 for _, _, rh in mid_lv if rh is not None and rh >= 85),
        high_lvls=sum(1 for _, c, _ in high_lv if c >= 10), high_rh=sum(1 for _, _, rh in high_lv if rh is not None and rh >= 80),
        sun=h, tau=tau_dni(r.get('direct_normal_irradiance'), h), isday=(h > 0),
        day=int(r['t'][8:10]), tl=CLMAP.get(cl[1]), tm=CMMAP.get(cl[2]), th=CHMAP.get(cl[3]),
    )

# ── 후보 ──
T_R0 = dict(minCover=20, cbCape=1500, cbLi=-2, nsPrecip=0.3, nsCover=80, stBaseKm=0.4, stCover=70, stOvercast=80, cuCape=9999, cuLi=2,
            cuThickKm=0.6, cuCover=55, cgThickKm=2.0, asCover=101, asLevels=2, asRainCover=80, csCover=101)
T_R1 = dict(T_R0, tauAs=2.0, tauCs=1.5, asNightWet=3, csNightLvls=2)
T_R2 = dict(T_R1, cuPblKm=0.8, stRh=95, cuThickKm=0.6, cuCover=70)

def classify(f, T, variant):
    """variant: 'R0'(지금 TS, 앱 입력 = CAPE·LI 없음) · 'R1' · 'R2'."""
    low = mid = high = None
    cape = li = None   # 앱은 classifyGenus 에 CAPE·LI 를 넘기지 않음(liveScene) — 자도 같게
    if f['cl'] >= T['minCover']:
        raining = f['precip'] >= 0.1 or (f['code'] is not None and (51 <= f['code'] <= 67 or 71 <= f['code'] <= 77 or 80 <= f['code'] <= 99))
        if variant == 'R0':
            weak = f['thick'] is not None and f['thick'] >= T['cuThickKm']
            if f['shower'] and False: low = 'cb'
            elif raining: low = 'ns'
            elif f['base_agl'] is not None and f['base_agl'] <= T['stBaseKm'] and f['cl'] >= T['stCover'] and (not weak or f['cl'] >= T['stOvercast']): low = 'st'
            elif weak and f['isday'] and f['cl'] < T['cuCover']: low = 'cg' if f['thick'] >= T['cgThickKm'] else 'cu'
            else: low = 'sc'
        else:
            inPbl = f['base_agl'] is not None and f['pbl'] >= T.get('cuPblKm', 99) and f['base_agl'] <= f['pbl'] + 0.3
            weak = (f['thick'] is not None and f['thick'] >= T['cuThickKm']) or (variant == 'R2' and inPbl) or \
                   (f['li'] is not None and f['li'] <= T['cuLi']) or (f['cape'] is not None and f['cape'] >= T['cuCape'])
            convective = (f['cape'] is not None and f['cape'] >= T['cbCape']) or (f['li'] is not None and f['li'] <= T['cbLi'])
            if f['shower'] and (convective or (f['cape'] or 0) >= 200): low = 'cb'
            elif f['precip'] >= T['nsPrecip'] and f['cl'] >= T['nsCover']: low = 'ns'
            elif (f['base_agl'] is not None and f['base_agl'] <= T['stBaseKm'] and f['cl'] >= T['stCover']) or \
                 (variant == 'R2' and f['rh2'] is not None and f['rh2'] >= T['stRh'] and f['cl'] >= T['stCover']): low = 'st'
            elif weak and f['isday'] and f['cl'] < T['cuCover']: low = 'cg' if (f['thick'] or 0) >= T['cgThickKm'] else 'cu'
            else: low = 'sc'
    if f['cm'] >= T['minCover']:
        if variant == 'R0':
            mid = 'as' if (f['cm'] >= T['asCover'] and (f['precip'] > 0 or f['wet'] >= T['asLevels'])) or (f['cm'] >= T['asRainCover'] and f['precip'] >= T['nsPrecip']) else 'ac'
        else:
            if f['tau'] is not None: mid = 'as' if f['tau'] >= T['tauAs'] and f['cm'] >= T['asRainCover'] else 'ac'
            else: mid = 'as' if (f['wet_rh'] >= T['asNightWet'] and f['cm'] >= T['asRainCover']) or (f['cm'] >= T['asRainCover'] and f['precip'] >= T['nsPrecip']) else 'ac'
    if f['ch'] >= T['minCover']:
        if variant == 'R0': high = 'cs' if f['ch'] >= T['csCover'] else 'ci'
        else:
            if f['tau'] is not None: high = 'cs' if f['tau'] >= T['tauCs'] and f['ch'] >= 80 else 'ci'
            else: high = 'cs' if f['high_lvls'] >= T['csNightLvls'] and f['ch'] >= 80 else 'ci'
    return low, mid, high

def score(F, T, variant, subset=None):
    res = {}
    for band, idx, cov, tk in (('low', 0, 'cl', 'tl'), ('mid', 1, 'cm', 'tm'), ('high', 2, 'ch', 'th')):
        conf = collections.Counter(); n = ok = 0; tr = collections.Counter(); hit = collections.Counter()
        for f in F:
            if subset == 'day' and f['tau'] is None: continue
            t = f[tk]
            if t is None or f[cov] < T['minCover']: continue
            p = classify(f, T, variant)[idx]
            if p is None: continue
            if band == 'low': p = NORM_LOW.get(p, p)
            n += 1; conf[(t, p)] += 1; tr[t] += 1
            if t == p: ok += 1; hit[t] += 1
        if n == 0: res[band] = None; continue
        res[band] = dict(n=n, acc=ok / n, majority=max(tr.values()) / n, recall={k: hit[k] / v for k, v in tr.items()}, conf={f'{a}->{b}': c for (a, b), c in conf.items()})
    return res

def objective(s):
    if not all(s.values()): return -9
    rl = s['low']['recall']; rm = s['mid']['recall']; rh = s['high']['recall']
    return (s['low']['acc'] - s['low']['majority']) + 0.5 * ((s['mid']['acc'] - s['mid']['majority']) + (s['high']['acc'] - s['high']['majority'])) \
        - 0.5 * max(0, 0.3 - rl.get('cu', 0)) - 0.5 * max(0, 0.3 - rl.get('st', 0)) - 0.5 * max(0, 0.3 - rm.get('as', 0)) - 0.5 * max(0, 0.3 - rh.get('cs', 0))

GRIDS = {
    'R0': dict(stBaseKm=[0.25, 0.4, 0.6], stCover=[70, 85], cuThickKm=[0.4, 0.6, 0.9], cuCover=[55, 70, 85]),
    'R1': dict(stBaseKm=[0.25, 0.4, 0.6], cuThickKm=[0.4, 0.6, 0.9], cuCover=[55, 70, 85], tauAs=[1.0, 1.5, 2.0, 3.0], tauCs=[0.7, 1.0, 1.5, 2.0], asRainCover=[50, 70, 80], asNightWet=[2, 3, 4], csNightLvls=[1, 2, 3]),
    'R2': dict(stBaseKm=[0.25, 0.4, 0.6], cuThickKm=[0.4, 0.6, 0.9], cuCover=[55, 70, 85], tauAs=[1.0, 1.5, 2.0, 3.0], tauCs=[0.7, 1.0, 1.5, 2.0], asRainCover=[50, 70, 80], cuPblKm=[0.6, 0.8, 1.2, 99], stRh=[92, 95, 101]),
}
BASE = {'R0': T_R0, 'R1': T_R1, 'R2': T_R2}

def tune(odd, variant):
    grid = GRIDS[variant]; keys = list(grid); best = None
    for combo in itertools.product(*grid.values()):
        T = dict(BASE[variant]); T.update(zip(keys, combo))
        obj = objective(score(odd, T, variant))
        if best is None or obj > best[0]: best = (obj, T)
    return best[1]

def report(tag, res):
    for b, v in res.items():
        if not v: print(tag, b, '표본 없음'); continue
        rec = ' '.join(f'{k}:{x:.2f}' for k, x in sorted(v['recall'].items()))
        print(f"{tag} {b}: n={v['n']} 정확도 {v['acc']:.3f} 다수찍기 {v['majority']:.3f} ({(v['acc']-v['majority'])*100:+.1f}p) 재현율 {rec}")

# ── R3: 작은 결정나무(참고용 상한) ──
FEATS = ['cl', 'cm', 'ch', 'precip', 'thick', 'base_agl', 'wet', 'wet_rh', 'high_lvls', 'high_rh', 'pbl', 'rh2', 'tau', 'sun', 'li', 'cape']
def fvec(f):
    return [(-1 if f[k] is None else (1 if f[k] is True else 0 if f[k] is False else f[k])) for k in FEATS]
def gini(y):
    c = collections.Counter(y); n = len(y); return 1 - sum((v / n) ** 2 for v in c.values())
def build_tree(X, y, depth, min_leaf=40):
    node = {'pred': collections.Counter(y).most_common(1)[0][0], 'n': len(y)}
    if depth == 0 or len(set(y)) == 1 or len(y) < 2 * min_leaf: return node
    best = None; g0 = gini(y)
    for j in range(X.shape[1]):
        col = X[:, j]; vals = np.unique(np.quantile(col, np.linspace(0.05, 0.95, 19)))
        for v in vals:
            m = col <= v; nl = m.sum(); nr = len(y) - nl
            if nl < min_leaf or nr < min_leaf: continue
            yl = [y[i] for i in np.where(m)[0]]; yr = [y[i] for i in np.where(~m)[0]]
            g = (nl * gini(yl) + nr * gini(yr)) / len(y)
            if best is None or g < best[0]: best = (g, j, v, m)
    if best is None or g0 - best[0] < 0.005: return node
    _, j, v, m = best
    node.update(feat=j, thr=float(v), left=build_tree(X[m], [y[i] for i in np.where(m)[0]], depth - 1, min_leaf),
                right=build_tree(X[~m], [y[i] for i in np.where(~m)[0]], depth - 1, min_leaf))
    return node
def predict(node, x):
    while 'feat' in node: node = node['left'] if x[node['feat']] <= node['thr'] else node['right']
    return node['pred']
def tree_eval(odd, even, band, cov, tk, depth=3):
    tr = [f for f in odd if f[tk] is not None and f[cov] >= 20]; te = [f for f in even if f[tk] is not None and f[cov] >= 20]
    if len(tr) < 100 or len(te) < 50: return None
    X = np.array([fvec(f) for f in tr], float); y = [f[tk] for f in tr]
    tree = build_tree(X, y, depth)
    Xe = np.array([fvec(f) for f in te], float); ye = [f[tk] for f in te]
    pred = [predict(tree, x) for x in Xe]
    ok = sum(1 for a, b in zip(pred, ye) if a == b); maj = collections.Counter(ye).most_common(1)[0][1]
    rec = {k: sum(1 for a, b in zip(pred, ye) if a == b == k) / v for k, v in collections.Counter(ye).items()}
    return dict(n=len(ye), acc=ok / len(ye), majority=maj / len(ye), recall=rec, tree=tree)

def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    F = [features(json.loads(l)) for l in open(os.path.join(here, 'pairs2.jsonl'))]
    odd = [f for f in F if f['day'] % 2 == 1]; even = [f for f in F if f['day'] % 2 == 0]
    print('전체', len(F), '홀수 날', len(odd), '짝수 날', len(even), '낮(τ 있음)', sum(1 for f in F if f['tau'] is not None))
    results = {}
    for v in ('R0', 'R1', 'R2'):
        T = tune(odd, v)
        se = score(even, T, v); sd = score(even, T, v, subset='day')
        print(f'── {v} 홀수 날 문턱:', {k: T[k] for k in GRIDS[v]})
        report(f'{v} 짝수', se); report(f'{v} 짝수·낮', sd)
        results[v] = dict(thresholds=T, even=se, evenDay=sd, odd=score(odd, T, v))
    print('── R3 결정나무(깊이 3, 참고)')
    results['R3'] = {}
    for band, cov, tk in (('low', 'cl', 'tl'), ('mid', 'cm', 'tm'), ('high', 'ch', 'th')):
        r = tree_eval(odd, even, band, cov, tk)
        if r:
            rec = ' '.join(f'{k}:{x:.2f}' for k, x in sorted(r['recall'].items()))
            print(f"R3 짝수 {band}: n={r['n']} 정확도 {r['acc']:.3f} 다수찍기 {r['majority']:.3f} ({(r['acc']-r['majority'])*100:+.1f}p) 재현율 {rec}")
            results['R3'][band] = {k: r[k] for k in ('n', 'acc', 'majority', 'recall')}
            results['R3'][band + 'Tree'] = json.loads(json.dumps(r['tree'], default=str))
    json.dump(results, open(os.path.join(here, 'genus2-results.json'), 'w'), indent=1, default=str)

if __name__ == '__main__':
    main(sys.argv[1:])
