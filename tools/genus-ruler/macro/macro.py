#!/usr/bin/env python3
"""
macro.py — RULER-macro 지표(§156). numpy + PIL 만.

  macro.py --truth <sceneDir> [--out sat-quartiles.json]        위성 참값 격자의 사분위(β·부분 운량 비율·띠 분산 비) — 렌더(합성) 전에 굳힘
  macro.py --gate <sceneDir> <synDir> [--out gate.json] [--group dev|held|all]
                                                                합성 결과 ○/× 표(RULER-macro.md §4)

지표(장면마다, 256² × 3 km):
  betaTrue / betaSyn / betaC0 : 가운데 64²(192 km, Hanning) 고리 평균 1-D 스펙트럼 기울기, λ 24~96 km.
  ringRmse  : 고리 90 자리에서 표본이 대표하는 넓이(이웃 간격, 최소 7 km) 로 상자 평균한 합성 운량 − 예보 값 의 RMSE(평균 보존).
  meanErr   : 전체 평균 차(합성 − 참).
  corr50    : 50 km 상자 평균 뒤 참값과의 상관(큰 규모 배치) — syn / barnes(base) / c0 모두.
  corr12    : 12 km 상자 평균 뒤 상관(가운데 ±90 km 만) — 고리가 촘촘한 안쪽의 중간 규모.
  bandRatio : 띠(6–12, 12–24, 24–48 km) 분산 비 syn/true (고리 평균 스펙트럼, 가운데 128²).
  partial   : 운량 0.1~0.9 인 칸 비율(3 km 에서는 참값이 거의 0/1 — 합성이 뿌연 중간값으로 덮지 않는가).
  range     : 0~1 밖·NaN 개수.
"""
import sys, os, json, base64, math
import numpy as np

def load_u8(b64, n):
    return np.frombuffer(base64.b64decode(b64), dtype=np.uint8).reshape(n, n).astype(np.float64) / 255.0

def box_mean(a, k):
    H, W = a.shape
    c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), axis=0), axis=1)
    r = k // 2
    y0 = np.clip(np.arange(H) - r, 0, H); y1 = np.clip(np.arange(H) + k - r, 0, H)
    x0 = np.clip(np.arange(W) - r, 0, W); x1 = np.clip(np.arange(W) + k - r, 0, W)
    s = c[y1[:, None], x1[None, :]] - c[y0[:, None], x1[None, :]] - c[y1[:, None], x0[None, :]] + c[y0[:, None], x0[None, :]]
    return s / ((y1 - y0)[:, None] * (x1 - x0)[None, :])

def ring_spectrum(F, cell_km, m=None):
    """가운데 m² (Hanning) 의 고리 평균 파워 — (lam_km, P1d) ; P1d = 고리 합(1-D 에너지 스펙트럼 ∝)."""
    n = F.shape[0]
    if m is None: m = n
    off = (n - m) // 2
    sub = F[off:off + m, off:off + m] - F[off:off + m, off:off + m].mean()
    w = np.hanning(m + 2)[1:-1]
    sub = sub * w[:, None] * w[None, :]
    P = np.abs(np.fft.fft2(sub)) ** 2
    ky = np.fft.fftfreq(m) * m; kx = np.fft.fftfreq(m) * m
    kr = np.sqrt(kx[None, :] ** 2 + ky[:, None] ** 2)
    b = np.round(kr).astype(int)
    nb = m // 2
    pw = np.bincount(b.ravel(), weights=P.ravel(), minlength=nb)[:nb]
    cnt = np.bincount(b.ravel(), minlength=nb)[:nb]
    lam = np.full(nb, np.inf); lam[1:] = (m * cell_km) / np.arange(1, nb)
    return lam, pw, cnt

def beta_of(F, cell_km, m=128, lo=24, hi=96):
    lam, pw, cnt = ring_spectrum(F, cell_km, m)
    sel = (lam >= lo) & (lam <= hi) & (cnt > 0) & (pw > 0)
    if sel.sum() < 3 or F.var() < 1e-5: return None
    x = np.log(1.0 / lam[sel]); y = np.log(pw[sel])
    A = np.vstack([x, np.ones_like(x)]).T
    slope = np.linalg.lstsq(A, y, rcond=None)[0][0]
    return float(-slope)

def band_var(F, cell_km, lo, hi, m=128):
    lam, pw, cnt = ring_spectrum(F, cell_km, m)
    sel = (lam >= lo) & (lam < hi)
    return float(pw[sel].sum() / (m * m) ** 2 * 1.0)

def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = math.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0

def ring_spacing(ring):
    """macroField.sampleSpacingKm 과 같은 규칙: 고리 방위 간격·이웃 고리 반 간격 중 큰 것(최소 2.5)."""
    ds = sorted(set(round(r['dist']) for r in ring))
    cnt = {d: sum(1 for r in ring if round(r['dist']) == d) for d in ds}
    sp = {}
    for j, d in enumerate(ds):
        az = 2 * math.pi * d / cnt[d] if d > 0.5 else 0
        prev = ds[j - 1] if j > 0 else 0
        nxt = ds[j + 1] if j < len(ds) - 1 else d + (d - prev)
        sp[d] = max(az, max(d - prev, nxt - d) * 0.5, 2.5)
    return [sp[round(r['dist'])] for r in ring]

def ring_values(F, ring, n, cell_km):
    """표본이 대표하는 넓이(이웃 간격 ≈ λ_res/2, 최소 7 km)의 상자 평균 — 표본마다 창이 다릅니다."""
    sp = ring_spacing(ring)
    half = n * cell_km / 2
    cache = {}
    out = []
    for r, s in zip(ring, sp):
        k = max(1, int(round(max(7.0, s) / cell_km)))
        if k not in cache: cache[k] = box_mean(F, k)
        x = r['dist'] * math.sin(math.radians(r['az'])); y = r['dist'] * math.cos(math.radians(r['az']))
        col = int(min(n - 1, max(0, (x + half) / cell_km))); row = int(min(n - 1, max(0, (y + half) / cell_km)))
        out.append(cache[k][row, col])
    return np.array(out)

def truth_grid(sc):
    n = sc['grid']
    g = load_u8(sc['trueGrid'], n)
    # fetch 는 행 0 = 북쪽. macroField 는 행 = 북쪽으로 증가 → 뒤집어 맞춥니다.
    return g[::-1, :]

def scene_truth_metrics(sc):
    n = sc['grid']; cell = sc['cellKm']
    T = truth_grid(sc)
    b = beta_of(T, cell)
    partial = float(((T > 0.1) & (T < 0.9)).mean())
    v6 = band_var(T, cell, 6, 12); v12 = band_var(T, cell, 12, 24); v24 = band_var(T, cell, 24, 48); v48 = band_var(T, cell, 48, 96)
    return {'betaTrue': b, 'partialTrue': partial, 'cover': float(T.mean()),
            'bandRatio12_6': v12 / v6 if v6 > 0 else None, 'bandRatio24_12': v24 / v12 if v12 > 0 else None, 'bandRatio48_24': v48 / v24 if v24 > 0 else None}

def qs(a):
    a = np.array([x for x in a if x is not None and np.isfinite(x)])
    if len(a) == 0: return None
    return {'q25': float(np.quantile(a, .25)), 'q50': float(np.quantile(a, .5)), 'q75': float(np.quantile(a, .75)), 'n': int(len(a))}

def load_scenes(d):
    out = []
    for f in sorted(os.listdir(d)):
        if f.endswith('.json') and f != 'index.json':
            out.append(json.load(open(os.path.join(d, f))))
    return out

GROUP = {'seoul': 'dev', 'kanazawa': 'dev'}

def run_truth(d, out):
    rows = []
    for sc in load_scenes(d):
        m = scene_truth_metrics(sc); m['name'] = sc['site'] + '_' + sc['date']; m['group'] = GROUP.get(sc['site'], 'held')
        rows.append(m)
    doc = {'n': len(rows), 'quartiles': {k: qs([r[k] for r in rows]) for k in ('betaTrue', 'partialTrue', 'cover', 'bandRatio12_6', 'bandRatio24_12', 'bandRatio48_24')},
           'byGroup': {g: {k: qs([r[k] for r in rows if r['group'] == g]) for k in ('betaTrue', 'partialTrue')} for g in ('dev', 'held')},
           'rows': rows}
    json.dump(doc, open(out, 'w'), indent=1)
    print(json.dumps({k: v for k, v in doc['quartiles'].items()}, indent=1))

def run_gate(sceneDir, synDir, out, group):
    rows = []
    for sc in load_scenes(sceneDir):
        name = sc['site'] + '_' + sc['date']
        g = GROUP.get(sc['site'], 'held')
        if group != 'all' and g != group: continue
        p = os.path.join(synDir, name + '.syn.json')
        if not os.path.exists(p): continue
        sy = json.load(open(p))
        n = sc['grid']; cell = sc['cellKm']
        T = truth_grid(sc); S = load_u8(sy['syn'], n); B = load_u8(sy['base'], n); C0 = load_u8(sy['c0'], n)
        ring_fc = np.array([r['cover'] for r in sc['ring']])
        rv = ring_values(S, sc['ring'], n, cell)
        k50 = int(round(50 / cell)); k12 = int(round(12 / cell))
        c = n // 2; h = int(90 / cell)
        sl = (slice(c - h, c + h), slice(c - h, c + h))
        row = {'name': name, 'group': g, 'cover': float(T.mean()), 'betaTrue': beta_of(T, cell), 'betaSyn': beta_of(S, cell), 'betaFit': sy.get('betaFit'), 'betaUsed': sy['beta'],
               'betaC0': beta_of(C0, cell),
               'ringRmse': float(np.sqrt(((rv - ring_fc) ** 2).mean())), 'meanErr': float(S.mean() - T.mean()),
               'corr50Syn': corr(box_mean(S, k50), box_mean(T, k50)), 'corr50Base': corr(box_mean(B, k50), box_mean(T, k50)), 'corr50C0': corr(box_mean(C0, k50), box_mean(T, k50)),
               'corr12Syn': corr(box_mean(S, k12)[sl], box_mean(T, k12)[sl]), 'corr12C0': corr(box_mean(C0, k12)[sl], box_mean(T, k12)[sl]),
               'partialSyn': float(((S > 0.1) & (S < 0.9)).mean()), 'partialTrue': float(((T > 0.1) & (T < 0.9)).mean()),
               'rangeBad': int(((S < 0) | (S > 1) | ~np.isfinite(S)).sum()), 'ms': sy['ms']}
        for lo, hi in ((6, 12), (12, 24), (24, 48)):
            vt = band_var(T, cell, lo, hi); vs = band_var(S, cell, lo, hi)
            row[f'band{lo}'] = vs / vt if vt > 0 else None
        if sy.get('syn15'):
            S2 = load_u8(sy['syn15'][0], n)
            row['step15meanDiff'] = float(S2.mean() - S.mean())
            for lo, hi in ((6, 12), (48, 96)):
                a = band_pass(S, cell, lo, hi); b = band_pass(S2, cell, lo, hi)
                row[f'step15corr{lo}'] = corr(a, b)
        rows.append(row)
    keys = [k for k in rows[0] if k not in ('name', 'group')] if rows else []
    doc = {'group': group, 'n': len(rows), 'quartiles': {k: qs([r[k] for r in rows]) for k in keys}, 'rows': rows}
    doc['gates'] = gates(rows)
    json.dump(doc, open(out, 'w'), indent=1)
    for k, v in doc['quartiles'].items():
        if v: print(f"{k:14s} q25 {v['q25']:8.3f} q50 {v['q50']:8.3f} q75 {v['q75']:8.3f}")
    print(json.dumps(doc['gates'], indent=1))

def band_pass(F, cell_km, lo, hi):
    n = F.shape[0]
    P = np.fft.fft2(F - F.mean())
    k = np.fft.fftfreq(n) * n
    kr = np.sqrt(k[None, :] ** 2 + k[:, None] ** 2)
    lam = np.where(kr > 0, (n * cell_km) / np.maximum(kr, 1e-9), np.inf)
    P[(lam < lo) | (lam >= hi)] = 0
    return np.real(np.fft.ifft2(P))

def gates(rows):
    """RULER-macro.md §4 — 장면마다 ○/×, 전체 통과율."""
    g = {}
    def frac(name, cond):
        vals = [cond(r) for r in rows if cond(r) is not None]
        g[name] = {'pass': sum(1 for v in vals if v), 'n': len(vals)}
    frac('G1 betaSyn in [betaTrue-0.35, betaTrue+0.35]', lambda r: None if r['betaTrue'] is None or r['betaSyn'] is None else abs(r['betaSyn'] - r['betaTrue']) <= 0.35)
    frac('G2 ringRmse <= 0.08', lambda r: r['ringRmse'] <= 0.08)
    frac('G3 |meanErr| <= 0.03', lambda r: abs(r['meanErr']) <= 0.03)
    frac('G4 corr50Syn >= corr50C0 + 0.10', lambda r: r['corr50Syn'] >= r['corr50C0'] + 0.10)
    frac('G5 corr50Syn >= 0.60', lambda r: r['corr50Syn'] >= 0.60)
    frac('G6 band ratios 6/12/24 in [0.5, 2.0]', lambda r: all(r[f'band{b}'] is not None and 0.5 <= r[f'band{b}'] <= 2.0 for b in (6, 12, 24)))
    frac('G7 partialSyn <= partialTrue + 0.15', lambda r: r['partialSyn'] <= r['partialTrue'] + 0.15)
    frac('G8 rangeBad == 0', lambda r: r['rangeBad'] == 0)
    frac('G9 ms <= 400', lambda r: r['ms'] <= 400)
    frac('G10 betaFit closer than prior (|fit-true| < |5/3-true|)', lambda r: None if r['betaTrue'] is None or r['betaFit'] is None else abs(r['betaFit'] - r['betaTrue']) < abs(5 / 3 - r['betaTrue']))
    if rows and 'step15corr6' in rows[0]:
        frac('G11 step15: |meanDiff| <= 0.02', lambda r: abs(r['step15meanDiff']) <= 0.02)
        frac('G12 step15: corr6 < corr48 (small scales change faster)', lambda r: r['step15corr6'] < r['step15corr48'])
    return g

def main(argv):
    def opt(k, d=None):
        return argv[argv.index(k) + 1] if k in argv else d
    if '--truth' in argv:
        return run_truth(opt('--truth'), opt('--out', 'tools/genus-ruler/macro/sat-quartiles.json'))
    if '--gate' in argv:
        i = argv.index('--gate')
        return run_gate(argv[i + 1], argv[i + 2], opt('--out', 'gate.json'), opt('--group', 'all'))
    print(__doc__)

if __name__ == '__main__':
    main(sys.argv[1:])
