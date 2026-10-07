#!/usr/bin/env python3
"""
tile.py — 위에서 본 날씨 타일 자(§130 RULER-flow T0~T5·T8). GPU 없이 d 채널 PNG(8비트, 주기)만 잽니다.

  python3 tile.py --tile-km 24 [--out tile-results.json] a.png b.png …
  (tile-gen.mjs 가 만든 <name>.L<k>.png 를 넣습니다. 타일 한 변 km 는 **인자** — 48 km 후보도 같은 자로.)

지표(설계 §5.2): T0 areaTop(=위에서 본 운량) · T1 0.5~6 km 방사 스펙트럼 기울기(+0.14~0.5 km) · orientRatio(0.5~6 km 12방향 파워 최대/최소)
· T2 조각(≥4 px): /100 km², areaCV, largestFrac, 중앙 면적, elongMed/IQR, 둘레/면적, 면적 멱지수 · T4 riseLenKm_edge(경계 1/|∇d|)
· T3 d 히스토그램(p10/50/90, thinFrac, satFrac, 엔트로피 bit) · T5 coh1km(∇d 방향 일관성, 1 km 창) · T8 quad12km(12×12 km 창의 최대 구름 면적
비율, 주기) — 24 km 반복이 보이는지. numpy·PIL 만 씁니다.
"""
import sys, os, json, math
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fm import label, box_blur


def tile_metrics(d, tile_km):
    S = d.shape[0]; px_km = tile_km / S
    out = {'tileKm': tile_km, 'S': S}
    m = d > 0
    out['areaTop'] = float(m.mean())
    # T1 주기 방사 스펙트럼(창 없음) — 파장을 km 로 받아 px 로 바꿉니다.
    F = np.fft.fft2(d - d.mean()); P = np.abs(F) ** 2
    fy = np.fft.fftfreq(S)[:, None]; fx = np.fft.fftfreq(S)[None, :]; k = np.sqrt(fx ** 2 + fy ** 2)

    def slope(lam_lo_km, lam_hi_km, nb=12):
        lo, hi = lam_lo_km / px_km, lam_hi_km / px_km
        edges = np.geomspace(1 / hi, 1 / lo, nb + 1); xs, ys = [], []
        for i in range(nb):
            mm = (k >= edges[i]) & (k < edges[i + 1])
            if mm.sum() < 4: continue
            xs.append(math.log10(math.sqrt(edges[i] * edges[i + 1]))); ys.append(math.log10(P[mm].mean() + 1e-30))
        return float(np.polyfit(xs, ys, 1)[0]) if len(xs) >= 4 else float('nan')
    out['slope_0.5_6km'] = slope(0.5, 6.0)
    out['slope_0.14_0.5km'] = slope(0.14, 0.5)
    out['slope_0.14_6km'] = slope(0.14, 6.0)
    band = (k >= px_km / 6.0) & (k < px_km / 0.5)
    ang = np.arctan2(fy + 0 * fx, fx + 0 * fy) % np.pi
    sec = np.floor(ang / (np.pi / 12)).astype(int) % 12
    ps = np.array([P[band & (sec == s)].sum() for s in range(12)])
    out['orientRatio'] = float(ps.max() / max(ps.min(), 1e-30))
    out['orientDeg'] = float((np.argmax(ps) + 0.5) * 15.0)   # 파워가 가장 큰 파수 방향(= 구조에 수직인 방향, 동쪽 0° 반시계)
    # T2 조각(비주기 라벨링 — 경계를 넘는 조각은 그대로 둠)
    if 0.01 < m.mean() < 0.99:
        _, comps = label(m)
        ok = [c for c in comps if c['area'] >= 4]
        areas = np.array([c['area'] for c in ok], float) * px_km ** 2
        el = np.array([c['elong'] for c in ok])
        out['nPer100km2'] = float(len(ok) / tile_km ** 2 * 100)
        out['areaCV'] = float(areas.std() / areas.mean()) if len(areas) else float('nan')
        out['largestFrac'] = float(areas.max() / areas.sum()) if len(areas) else float('nan')
        out['medAreaKm2'] = float(np.median(areas)) if len(areas) else float('nan')
        out['elongMed'] = float(np.median(el)); out['elongIQR'] = float(np.quantile(el, .75) - np.quantile(el, .25))
        a = np.sort(areas[areas >= 0.05])[::-1]
        out['areaPowExp'] = float(np.polyfit(np.log10(a), np.log10(np.arange(1, len(a) + 1)), 1)[0]) if len(a) >= 8 else float('nan')
        nb = np.zeros_like(m)
        nb[:, 1:] |= ~m[:, :-1]; nb[:, :-1] |= ~m[:, 1:]; nb[1:, :] |= ~m[:-1, :]; nb[:-1, :] |= ~m[1:, :]
        bd = m & nb
        out['perimPerArea'] = float(bd.sum() / max(m.sum(), 1))
        gx = np.zeros_like(d); gy = np.zeros_like(d)
        gx[:, 1:-1] = (d[:, 2:] - d[:, :-2]) / 2; gy[1:-1, :] = (d[2:, :] - d[:-2, :]) / 2
        gm = np.hypot(gx, gy) / px_km
        inner = m & ~bd
        out['riseLenKm_edge'] = float(1.0 / max(gm[bd].mean(), 1e-9))
        out['gradP50_inside'] = float(np.median(gm[inner])) if inner.sum() else float('nan')
    else:
        for kk in ['nPer100km2', 'areaCV', 'largestFrac', 'medAreaKm2', 'elongMed', 'elongIQR', 'areaPowExp', 'perimPerArea', 'riseLenKm_edge', 'gradP50_inside']:
            out[kk] = float('nan')
    # T3 d 히스토그램
    v = d[m]
    if len(v) > 100:
        p10, p50, p90 = np.quantile(v, [.1, .5, .9])
        out['d_p10'], out['d_p50'], out['d_p90'] = float(p10), float(p50), float(p90)
        out['thinFrac'] = float((v < 0.2).mean()); out['satFrac'] = float((v >= 0.99).mean())
        hist, _ = np.histogram(v, bins=10, range=(0, 1)); p = hist / hist.sum(); p = p[p > 0]
        out['dEntropyBits'] = float(-(p * np.log2(p)).sum())
    else:
        for kk in ['d_p10', 'd_p50', 'd_p90', 'thinFrac', 'satFrac', 'dEntropyBits']: out[kk] = float('nan')
    # T5 1 km 창 방향 일관성(창 반지름 = 0.5 km / px_km)
    r = max(2, int(round(0.5 / px_km)))
    gx = np.zeros_like(d); gy = np.zeros_like(d)
    s2 = box_blur(d, 1); gx[:, 1:-1] = (s2[:, 2:] - s2[:, :-2]) / 2; gy[1:-1, :] = (s2[2:, :] - s2[:-2, :]) / 2
    Jxx = box_blur(gx * gx, r); Jyy = box_blur(gy * gy, r); Jxy = box_blur(gx * gy, r)
    tr = Jxx + Jyy; disc = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2); mm = m & (tr > 1e-10)
    out['coh1km'] = float(disc[mm].sum() / tr[mm].sum()) if mm.sum() > 100 else float('nan')
    # T8 12×12 km 창(주기)의 최대 구름 면적 비율 — 낮은 운량이 한 골에 몰려 24 km 마다 반복되는지.
    w = max(1, int(round(12.0 / px_km)))
    mf = m.astype(np.float64)
    cs = np.cumsum(np.cumsum(np.pad(np.tile(mf, (2, 2)), ((1, 0), (1, 0))), axis=0), axis=1)
    tot = cs[w:w + S, w:w + S] - cs[:S, w:w + S] - cs[w:w + S, :S] + cs[:S, :S]
    out['quad12km'] = float(tot.max() / max(mf.sum(), 1.0)) if mf.sum() > 0 else float('nan')
    return out


def main(argv):
    tile_km = 24.0; out_path = None; files = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--tile-km': tile_km = float(argv[i + 1]); i += 2; continue
        if a == '--out': out_path = argv[i + 1]; i += 2; continue
        files.append(a); i += 1
    if not files:
        print(__doc__); return 2
    rows = {}
    for f in files:
        name = os.path.basename(f).rsplit('.', 1)[0]
        a = np.asarray(Image.open(f).convert('L')).astype(np.float64) / 255.0
        if a.shape[1] != a.shape[0]:
            N = a.shape[0]; a = a[:, 2 * (N + 4):2 * (N + 4) + N]; name += '(d)'
        rows[name] = tile_metrics(a, tile_km)
    keys = list(next(iter(rows.values())).keys())
    print('%-18s' % 'metric', ' '.join('%-13s' % n[:13] for n in rows))
    for k in keys:
        print('%-18s' % k, ' '.join('%-13s' % ('%.3f' % r[k] if isinstance(r.get(k), float) and r[k] == r[k] else str(r.get(k))) for r in rows.values()))
    if out_path:
        json.dump(rows, open(out_path, 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
