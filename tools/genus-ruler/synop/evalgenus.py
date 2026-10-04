# RULER-genus-forecast.md 평가 — cloudGenusForecast.ts 의 규칙을 그대로 옮긴 파이썬 판(특징 미리 계산 → 격자 탐색).
# 사용: python3 evalgenus.py            초안 문턱으로 전체 보고
#       python3 evalgenus.py tune       홀수 날로 문턱 격자 탐색 → 짝수 날 보고, tuned-thresholds.json
import json, sys, itertools, collections
LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300]
LOW_TOP_M, MID_TOP_M = 2000, 7000
T0 = dict(minCover=20, cbCape=400, cbLi=-2, nsPrecip=0.3, nsCover=80, stBaseKm=0.4, stCover=70, cuCape=50, cuLi=2,
          cuThickKm=0.6, cuCover=70, cgThickKm=2.0, asCover=80, asLevels=3, csCover=80)
SHOWER = {80, 81, 82, 85, 86, 95, 96, 99}
CLMAP = {'0': None, '1': 'cu', '2': 'cu', '3': 'cb', '9': 'cb', '4': 'sc', '5': 'sc', '8': 'sc', '6': 'st', '7': 'st'}
CMMAP = {'0': None, '1': 'as', '2': 'as', **{str(i): 'ac' for i in range(3, 10)}}
CHMAP = {'0': None, **{str(i): 'ci' for i in range(1, 5)}, **{str(i): 'cs' for i in range(5, 9)}, '9': 'ci'}

def profile(r):
    out = []
    for p in LEVELS:
        h, c = r.get(f'geopotential_height_{p}hPa'), r.get(f'cloud_cover_{p}hPa')
        if h is not None and c is not None: out.append((h, c))
    return sorted(out)

def low_deck(levels):
    peak = -1
    for i, (h, c) in enumerate(levels):
        if h >= LOW_TOP_M: break
        if c > 0 and (peak < 0 or c > levels[peak][1]): peak = i
    if peak < 0: return None
    half = levels[peak][1] / 2; lo = hi = peak
    while lo > 0 and levels[lo - 1][1] >= half: lo -= 1
    while hi < len(levels) - 1 and levels[hi + 1][1] >= half: hi += 1
    base = (levels[lo - 1][0] + levels[lo][0]) / 2 if lo > 0 else max(0, levels[lo][0] - 125)
    top = (levels[hi][0] + levels[hi + 1][0]) / 2 if hi < len(levels) - 1 else levels[hi][0] + 125
    return base / 1000, top / 1000

def features(r):
    lv = profile(r); deck = low_deck(lv) if lv else None
    ground = (r.get('elev') if r.get('elev') is not None else r.get('model_elev')) or 0
    t, td = r.get('temperature_2m'), r.get('dew_point_2m')
    lcl = max(0.0, 125 * (t - td) / 1000) if (t is not None and td is not None) else None
    cl = r['cl']
    return dict(
        cl=r.get('cloud_cover_low') or 0, cm=r.get('cloud_cover_mid') or 0, ch=r.get('cloud_cover_high') or 0,
        precip=r.get('precipitation') or 0, cape=r.get('cape'), li=r.get('lifted_index'), shower=(r.get('weather_code') in SHOWER),
        thick=(deck[1] - deck[0]) if deck else None,
        base_agl=(max(0, deck[0] - ground / 1000) if deck else lcl),
        wet=sum(1 for h, c in lv if LOW_TOP_M <= h < MID_TOP_M and c >= 10),
        isday=r.get('is_day', 1), day=int(r['t'][8:10]),
        tl=CLMAP.get(cl[1]), tm=CMMAP.get(cl[2]), th=CHMAP.get(cl[3]),
    )

def classify(f, T, use_conv=True):
    cape = f['cape'] if use_conv else None; li = f['li'] if use_conv else None
    low = mid = high = None
    if f['cl'] >= T['minCover']:
        convective = (cape is not None and cape >= T['cbCape']) or (li is not None and li <= T['cbLi'])
        weak = (cape is not None and cape >= T['cuCape']) or (li is not None and li <= T['cuLi']) or \
               (cape is None and li is None and f['thick'] is not None and f['thick'] >= T['cuThickKm'])
        if (convective and (f['precip'] > 0 or f['shower'])) or (f['shower'] and cape is not None and cape >= T['cuCape']): low = 'cb'
        elif f['precip'] >= T['nsPrecip'] and f['cl'] >= T['nsCover'] and f['cm'] >= T['minCover']: low = 'ns'
        elif f['base_agl'] is not None and f['base_agl'] <= T['stBaseKm'] and f['cl'] >= T['stCover'] and not weak: low = 'st'
        elif weak and f['isday'] != 0 and f['cl'] < T['cuCover']: low = 'cg' if (f['thick'] is not None and f['thick'] >= T['cgThickKm']) else 'cu'
        else: low = 'sc'
    if f['cm'] >= T['minCover']:
        mid = 'as' if (f['cm'] >= T['asCover'] and (f['precip'] > 0 or f['wet'] >= T['asLevels'])) else 'ac'
    if f['ch'] >= T['minCover']:
        high = 'cs' if f['ch'] >= T['csCover'] else 'ci'
    return low, mid, high

NORM_LOW = {'cg': 'cu', 'ns': 'st'}

def score(F, T, use_conv=True):
    res = {}
    for band, idx, cov, tk in (('low', 0, 'cl', 'tl'), ('mid', 1, 'cm', 'tm'), ('high', 2, 'ch', 'th')):
        conf = collections.Counter(); n = ok = 0; tr = collections.Counter(); hit = collections.Counter()
        for f in F:
            t = f[tk]
            if t is None or f[cov] < T['minCover']: continue
            p = classify(f, T, use_conv)[idx]
            if p is None: continue
            if band == 'low': p = NORM_LOW.get(p, p)
            n += 1; conf[(t, p)] += 1; tr[t] += 1
            if t == p: ok += 1; hit[t] += 1
        if n == 0: res[band] = None; continue
        res[band] = dict(n=n, acc=ok / n, majority=max(tr.values()) / n, recall={k: hit[k] / v for k, v in tr.items()}, conf={f'{a}->{b}': c for (a, b), c in conf.items()})
    return res

def report(tag, res):
    for b, v in res.items():
        if not v: print(tag, b, '표본 없음'); continue
        rec = ' '.join(f'{k}:{x:.2f}' for k, x in sorted(v['recall'].items()))
        print(f"{tag} {b}: n={v['n']} 정확도 {v['acc']:.3f} 다수찍기 {v['majority']:.3f} ({(v['acc']-v['majority'])*100:+.1f}p) 재현율 {rec}")

if __name__ == '__main__':
    F = [features(json.loads(l)) for l in open('pairs.jsonl')]
    odd = [f for f in F if f['day'] % 2 == 1]; even = [f for f in F if f['day'] % 2 == 0]
    print('전체', len(F), '홀수 날', len(odd), '짝수 날', len(even))
    if len(sys.argv) > 1 and sys.argv[1] == 'tune':
        grid = dict(stBaseKm=[0.15, 0.25, 0.4, 0.6], stCover=[70, 85, 95], cuCape=[50, 100, 200, 400, 9999], cuCover=[40, 55, 70, 85],
                    cbCape=[400, 800, 1500, 9999], asCover=[80, 90, 101], asLevels=[2, 3, 4], csCover=[80, 90, 95, 101])
        best = None; keys = list(grid)
        for combo in itertools.product(*grid.values()):
            T = dict(T0); T.update(zip(keys, combo))
            s = score(odd, T)
            if not all(s.values()): continue
            rl = s['low']['recall']
            obj = (s['low']['acc'] - s['low']['majority']) + 0.5 * ((s['mid']['acc'] - s['mid']['majority']) + (s['high']['acc'] - s['high']['majority'])) \
                  - 0.5 * max(0, 0.3 - rl.get('cu', 0)) - 0.5 * max(0, 0.3 - rl.get('st', 0))
            if best is None or obj > best[0]: best = (obj, T)
        tuned = {k: best[1][k] for k in keys}
        print('홀수 날 최적 문턱:', tuned)
        report('홀수(조정)', score(odd, best[1])); report('짝수(보고)', score(even, best[1]))
        print('짝수 저층 혼동:', score(even, best[1])['low']['conf'])
        json.dump({'thresholds': tuned, 'even': score(even, best[1]), 'odd': score(odd, best[1])}, open('tuned-thresholds.json', 'w'), indent=1)
    else:
        report('초안 전체', score(F, T0)); report('초안(대류 없이)', score(F, T0, use_conv=False))
        print('저층 혼동:', score(F, T0)['low']['conf'])
