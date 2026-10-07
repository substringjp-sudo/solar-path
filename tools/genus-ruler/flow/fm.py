#!/usr/bin/env python3
"""
RULER-flow 측면(렌더·사진) 지표 — §130. numpy + PIL 만 씁니다(scipy 없음).

수학은 설계 때 쓴 시제품(scratch flowmetrics/fm.py)과 **같습니다**(함수 본문을 옮기기만 함) — 사진 사분위를
이 파일로 다시 재어 photo-flow-quartiles.json 에 이 파일의 sha256 과 함께 굳힙니다. 수학을 고치면 해시가 바뀌고
사분위도 다시 재야 합니다(RULER-flow.md 에 해시 기록).

입력: 하늘 자른 그림을 폭 320 으로 줄여(box) 선형 휘도 L 로. 구름 마스크는 사진 = NRBR(metrics.js 규칙),
렌더 = volsky `out:'both'` 의 <name>.alpha.png ≥ 0.15, 박명 = Otsu(어두운 쪽이 구름).

쓰는 법(폴더 README.md):
  fm.py path[:y0:y1[:x0:x1]][@nrbr|alpha|dark] ...          낱장(JSON 한 줄씩)
  fm.py --photos [--root REPO] [--out photo-flow-quartiles.json]  사진 7종 사분위 + 사진 자체 실패 수 사분위
  fm.py --renders DIR [--out renders.json] [--top 0.78] [--glob 'C*_*_*.png']
                                                             volsky 출력(<cand>_<scene>_<az>.png + .alpha.png)
  fm.py --gate photo-flow-quartiles.json cand.json [--ref c0.json] [--out gate.json]
                                                             ○/× 표 + 불만 군별 실패 수(RULER-flow.md §5.2·§5.6)
"""
import sys, os, json, math, glob, hashlib, datetime
import numpy as np
from PIL import Image
from collections import deque

W0 = 320

# ───────── 그림 읽기 ─────────
def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def load_crop(path, y0=0.0, y1=1.0, x0=0.0, x1=1.0, alpha_path=None):
    im = Image.open(path).convert('RGBA')
    Wi, Hi = im.size
    box = (int(Wi * x0), int(Hi * y0), int(Wi * x1), int(Hi * y1))
    im = im.crop(box)
    h = max(16, round(im.size[1] * W0 / im.size[0]))
    im = im.resize((W0, h), Image.BOX)
    a = np.asarray(im).astype(np.float64)
    rgb = a[..., :3]
    alpha = None
    if alpha_path:
        al = Image.open(alpha_path).convert('L').crop(box).resize((W0, h), Image.BOX)
        alpha = np.asarray(al).astype(np.float64) / 255.0
    return rgb, alpha

def luminance(rgb):
    lin = srgb_to_lin(rgb)
    L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    return L, lin

def cloud_mask(rgb, lin, L, alpha=None, mode='nrbr'):
    """mode: 'nrbr' (metrics.js 규칙), 'alpha' (렌더 불투명도 ≥ 0.15), 'dark' (logL Otsu, 어두운 쪽 = 구름 — 박명)."""
    if mode == 'alpha' and alpha is not None:
        return alpha >= 0.15, False
    if mode == 'dark':
        x = np.log(np.maximum(L, 1e-5)).ravel()
        hist, edges = np.histogram(x, bins=128)
        c = edges[:-1] + np.diff(edges) / 2
        w1 = np.cumsum(hist); w2 = w1[-1] - w1
        m1 = np.cumsum(hist * c) / np.maximum(w1, 1); m2 = (np.cumsum((hist * c)[::-1])[::-1]) / np.maximum(w2, 1)
        between = w1[:-1] * w2[:-1] * (m1[:-1] - m2[:-1]) ** 2
        t = c[np.argmax(between)]
        return (np.log(np.maximum(L, 1e-5)) < t), False
    r, b = lin[..., 0], lin[..., 2]
    nrbr = (b - r) / np.maximum(1e-6, b + r)
    p95 = np.quantile(nrbr, 0.95)
    all_cloud = p95 < 0.15
    if all_cloud:
        return np.ones_like(L, bool), True
    return nrbr < 0.5 * p95, False

def box_blur(a, r):
    # 가장자리 정규화 분리형 box blur (metrics.js boxBlur 와 같음)
    H, W = a.shape
    k = 2 * r + 1
    cs = np.cumsum(np.pad(a, ((0, 0), (1, 0))), axis=1)
    idx1 = np.minimum(np.arange(W) + r + 1, W); idx0 = np.maximum(np.arange(W) - r, 0)
    t = (cs[:, idx1] - cs[:, idx0]) / (idx1 - idx0)
    cs = np.cumsum(np.pad(t, ((1, 0), (0, 0))), axis=0)
    idx1 = np.minimum(np.arange(H) + r + 1, H); idx0 = np.maximum(np.arange(H) - r, 0)
    return (cs[idx1, :] - cs[idx0, :]) / (idx1 - idx0)[:, None]

# ───────── (a) 방사 스펙트럼 기울기, (b) 알갱이, (e2) 비등방 ─────────
def spectrum(logL, periodic=False):
    H, W = logL.shape
    x = logL - logL.mean()
    if not periodic:
        wy = np.hanning(H)[:, None]; wx = np.hanning(W)[None, :]
        x = x * wy * wx
    F = np.fft.fft2(x)
    P = np.abs(F) ** 2
    fy = np.fft.fftfreq(H)[:, None]; fx = np.fft.fftfreq(W)[None, :]
    k = np.sqrt(fx ** 2 + fy ** 2)
    return P, k, np.abs(fx) + 0 * fy, np.abs(fy) + 0 * fx

def radial_slope(P, k, lam_lo, lam_hi, nb=12):
    """log10 P(k) 대 log10 k 의 기울기, k = cycles/px, 파장 [lam_lo, lam_hi] px (log 등간격 bin)."""
    klo, khi = 1.0 / lam_hi, 1.0 / lam_lo
    edges = np.geomspace(klo, khi, nb + 1)
    xs, ys = [], []
    for i in range(nb):
        m = (k >= edges[i]) & (k < edges[i + 1])
        if m.sum() < 4: continue
        xs.append(math.log10(math.sqrt(edges[i] * edges[i + 1]))); ys.append(math.log10(P[m].mean() + 1e-30))
    if len(xs) < 4: return float('nan')
    xs, ys = np.array(xs), np.array(ys)
    return float(np.polyfit(xs, ys, 1)[0])

def band_power(P, k, lam_lo, lam_hi):
    m = (k >= 1.0 / lam_hi) & (k < 1.0 / lam_lo)
    return float(P[m].sum()), int(m.sum())

def granularity_spectral(P, k):
    """파장 < 4 px 의 분산 비율, 그리고 2–4 px 측정 파워 ÷ 6–40 px 멱법칙 외삽(기하 중간) = speckle excess."""
    tot = P[k > 0].sum()
    hf, _ = band_power(P, k, 2.0, 4.0)
    frac = hf / max(tot, 1e-30)
    klo, khi = 1 / 40.0, 1 / 6.0
    edges = np.geomspace(klo, khi, 10)
    xs, ys = [], []
    for i in range(9):
        m = (k >= edges[i]) & (k < edges[i + 1])
        if m.sum() < 4: continue
        xs.append(math.log10(math.sqrt(edges[i] * edges[i + 1]))); ys.append(math.log10(P[m].mean() + 1e-30))
    s, b = np.polyfit(xs, ys, 1)
    m = (k >= 1 / 4.0) & (k < 1 / 2.0)
    kmid = math.log10(math.sqrt(0.25 * 0.5))
    excess = P[m].mean() / (10 ** (s * kmid + b))
    edges = np.geomspace(1 / 40.0, 1 / 10.0, 9); xs, ys = [], []
    for i in range(8):
        mm = (k >= edges[i]) & (k < edges[i + 1])
        if mm.sum() < 4: continue
        xs.append(math.log10(math.sqrt(edges[i] * edges[i + 1]))); ys.append(math.log10(P[mm].mean() + 1e-30))
    s2, b2 = np.polyfit(xs, ys, 1)
    mm = (k >= 1 / 8.0) & (k < 1 / 4.0); kmid = math.log10(math.sqrt((1 / 8.0) * (1 / 4.0)))
    excess48 = P[mm].mean() / (10 ** (s2 * kmid + b2))
    return float(frac), float(excess), float(excess48)

def band_ratio_gran(logL, mask):
    """4–10 px 띠(DoB r2−r5) 분산(마스크 안, 잡음 바닥 뺌) ÷ 10–40 px 띠(DoB r5−r20) 분산."""
    b1 = box_blur(logL, 2) - box_blur(logL, 5)
    b2 = box_blur(logL, 5) - box_blur(logL, 20)
    if mask.sum() < 200: return float('nan'), float('nan')
    H, W = logL.shape
    bl = [b1[y:y + 8, x:x + 8].var() for y in range(0, H - 8, 8) for x in range(0, W - 8, 8)]
    floor = float(np.quantile(bl, 0.10)) if bl else 0.0
    v1 = b1[mask].var(); v2 = b2[mask].var()
    return float(max(0.0, v1 - floor) / max(v2, 1e-12)), float(v1 / max(v2, 1e-12))

def colour_density_corr(L, lin, mask):
    """구름 안 corr(log L, log(B/R)) — 두꺼운 구름은 어둡고 푸르스름, 얇은 가장자리는 밝고 따뜻(진단용)."""
    m = mask & (lin[..., 0] > 1e-4) & (lin[..., 2] > 1e-4)
    if m.sum() < 200: return float('nan')
    a = np.log(np.maximum(L[m], 1e-5)); b = np.log(lin[..., 2][m] / lin[..., 0][m])
    if a.std() < 1e-6 or b.std() < 1e-6: return float('nan')
    return float(np.corrcoef(a, b)[0, 1])

def granularity_spatial(logL, mask):
    """2 px box blur 잔차(파장 ≲ 5 px)의 분산 비율(마스크 안), 잡음 바닥 = 8×8 블록 잔차 분산의 10% 분위."""
    hf = logL - box_blur(logL, 2)
    tot = logL[mask].var() if mask.sum() > 200 else float('nan')
    H, W = logL.shape
    bl = []
    for y in range(0, H - 8, 8):
        for x in range(0, W - 8, 8):
            bl.append(hf[y:y + 8, x:x + 8].var())
    floor = float(np.quantile(bl, 0.10)) if bl else 0.0
    hfv = hf[mask].var() if mask.sum() > 200 else float('nan')
    return float(max(0.0, hfv - floor) / max(tot, 1e-12)), float(floor), float(hfv)

def anisotropy(P, kx, ky, k, lam_lo=8, lam_hi=40):
    """수평 띠 지수: |ky| > 2|kx| 파워(세로로 변함 → 가로 띠) ÷ |kx| > 2|ky| 파워, 8–40 px."""
    band = (k >= 1 / lam_hi) & (k < 1 / lam_lo)
    v = P[band & (ky > 2 * kx)].sum(); h = P[band & (kx > 2 * ky)].sum()
    return float(v / max(h, 1e-30))

# ───────── (c) 연결 성분 ─────────
def label(mask):
    H, W = mask.shape
    lab = -np.ones((H, W), np.int32)
    comps = []
    m = mask
    for s in zip(*np.nonzero(m)):
        y, x = s
        if lab[y, x] >= 0: continue
        cid = len(comps); lab[y, x] = cid
        q = deque([(y, x)]); pts = []
        edge = False
        while q:
            cy, cx = q.popleft(); pts.append((cy, cx))
            if cy == 0 or cx == 0 or cy == H - 1 or cx == W - 1: edge = True
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and lab[ny, nx] < 0:
                    lab[ny, nx] = cid; q.append((ny, nx))
        pts = np.array(pts)
        area = len(pts)
        flat = (pts[:, 1].max() - pts[:, 1].min() + 1) / (pts[:, 0].max() - pts[:, 0].min() + 1)
        if area >= 2:
            c = pts - pts.mean(0)
            cov = c.T @ c / area
            ev = np.linalg.eigvalsh(cov)
            elong = math.sqrt(max(ev[1], 1e-9) / max(ev[0], 1e-9))
        else:
            elong = 1.0
        comps.append({'area': area, 'edge': edge, 'elong': elong, 'flat': flat})
    return lab, comps

def component_stats(mask, min_area=4):
    H, W = mask.shape
    cf = mask.mean()
    if cf < 0.02 or cf > 0.98:
        return {'nPer1e4': float('nan'), 'areaCV': float('nan'), 'largestFrac': float('nan'), 'elongMed': float('nan'), 'elongIQR': float('nan'), 'nComp': 0, 'flatMed': float('nan'), 'perimPerArea': float('nan')}
    _, comps = label(mask)
    ok = [c for c in comps if c['area'] >= min_area]
    if not ok:
        return {'nPer1e4': 0.0, 'areaCV': float('nan'), 'largestFrac': float('nan'), 'elongMed': float('nan'), 'elongIQR': float('nan'), 'nComp': 0, 'flatMed': float('nan'), 'perimPerArea': float('nan')}
    areas = np.array([c['area'] for c in ok], float)
    el = np.array([c['elong'] for c in ok])
    big = [c for c in ok if c['area'] >= 20]
    fl = np.array([c['flat'] for c in big]) if big else np.array([float('nan')])
    tot = areas.sum()
    nb = np.zeros_like(mask)
    nb[:, 1:] |= ~mask[:, :-1]; nb[:, :-1] |= ~mask[:, 1:]; nb[1:, :] |= ~mask[:-1, :]; nb[:-1, :] |= ~mask[1:, :]
    per = float((mask & nb).sum())
    return {'nPer1e4': float(len(ok) / (H * W) * 1e4), 'areaCV': float(areas.std() / areas.mean()),
            'largestFrac': float(areas.max() / tot), 'elongMed': float(np.median(el)),
            'elongIQR': float(np.quantile(el, .75) - np.quantile(el, .25)), 'nComp': len(ok),
            'flatMed': float(np.nanmedian(fl)), 'perimPerArea': per / max(mask.sum(), 1)}

# ───────── (d) 구름 안 휘도 분포 ─────────
def shade_stats(L, rgb, mask):
    sat = (rgb[..., 0] >= 250) & (rgb[..., 1] >= 250) & (rgb[..., 2] >= 250)
    m = mask & ~sat
    if m.sum() < 200:
        return {'shadeRange': float('nan'), 'logIQR': float('nan'), 'bimod': float('nan'), 'darkFrac': float('nan')}
    v = L[m]; lv = np.log(np.maximum(v, 1e-5))
    p10, p50, p90 = np.quantile(v, [.1, .5, .9])
    q1, q3 = np.quantile(lv, [.25, .75])
    z = (lv - lv.mean()); s = z.std() + 1e-12
    g = (z ** 3).mean() / s ** 3; kurt = (z ** 4).mean() / s ** 4 - 3
    n = len(lv)
    bc = (g * g + 1) / (kurt + 3 * (n - 1) ** 2 / ((n - 2) * (n - 3)))
    return {'shadeRange': float(p10 / max(p90, 1e-9)), 'logIQR': float(q3 - q1), 'bimod': float(bc), 'darkFrac': float((v < 0.5 * p50).mean())}

# ───────── (e) 구조 텐서 결맞음 (metrics.js M5 + 넓은 창) ─────────
def coherence(logL, mask, r=6):
    s2 = box_blur(logL, 1)
    gx = np.zeros_like(s2); gy = np.zeros_like(s2)
    gx[:, 1:-1] = (s2[:, 2:] - s2[:, :-2]) / 2; gy[1:-1, :] = (s2[2:, :] - s2[:-2, :]) / 2
    Jxx = box_blur(gx * gx, r); Jyy = box_blur(gy * gy, r); Jxy = box_blur(gx * gy, r)
    tr = Jxx + Jyy; disc = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2)
    m = mask & (tr > 1e-8)
    if m.sum() < 200: return float('nan')
    return float(disc[m].sum() / tr[m].sum())

# ───────── (f) 가장자리 부드러움 ─────────
def edge_stats(L, mask, all_cloud):
    cf = mask.mean()
    if all_cloud or cf < 0.02 or cf > 0.95:
        return {'edgeSharp': float('nan'), 'edgeP90': float('nan'), 'edgeWidthPx': float('nan')}
    contrast = abs(L[mask].mean() - L[~mask].mean())
    gx = np.zeros_like(L); gy = np.zeros_like(L)
    gx[:, 1:-1] = (L[:, 2:] - L[:, :-2]) / 2; gy[1:-1, :] = (L[2:, :] - L[:-2, :]) / 2
    gm = np.hypot(gx, gy)
    inner = mask.copy()
    nb = np.zeros_like(mask)
    nb[:, 1:] |= ~mask[:, :-1]; nb[:, :-1] |= ~mask[:, 1:]; nb[1:, :] |= ~mask[:-1, :]; nb[:-1, :] |= ~mask[1:, :]
    b = inner & nb
    b[0, :] = b[-1, :] = b[:, 0] = b[:, -1] = False
    if b.sum() < 50 or contrast < 1e-4:
        return {'edgeSharp': float('nan'), 'edgeP90': float('nan'), 'edgeWidthPx': float('nan')}
    g = gm[b] / contrast
    return {'edgeSharp': float(np.median(g)), 'edgeP90': float(np.quantile(g, .9)), 'edgeWidthPx': float(1.0 / max(np.median(g), 1e-6))}

def all_metrics(path, y0=0.0, y1=1.0, x0=0.0, x1=1.0, alpha_path=None, mask_mode='nrbr'):
    rgb, alpha = load_crop(path, y0, y1, x0, x1, alpha_path)
    L, lin = luminance(rgb)
    logL = np.log(np.maximum(L, 1e-5))
    mask, all_cloud = cloud_mask(rgb, lin, L, alpha, mask_mode)
    P, k, kx, ky = spectrum(logL)
    out = {'H': L.shape[0], 'cloudFrac': float(mask.mean()), 'allCloud': bool(all_cloud)}
    out['slope3_40'] = radial_slope(P, k, 3, 40)
    out['slope8_40'] = radial_slope(P, k, 8, 40)
    out['slope3_8'] = radial_slope(P, k, 3, 8)
    out['hfFrac'], out['speckleExcess'], out['excess4_8'] = granularity_spectral(P, k)
    out['slope4_10'] = radial_slope(P, k, 4, 10, 6)
    out['grainRatio'], out['grainRatioRaw'] = band_ratio_gran(logL, mask)
    out['colorDensCorr'] = colour_density_corr(L, lin, mask)
    out['granSpatial'], out['noiseFloor'], out['hfVar'] = granularity_spatial(logL, mask)
    out['hBand'] = anisotropy(P, kx, ky, k)
    out.update(component_stats(mask))
    # 틈(여집합) — 운량이 높으면 구름은 한 판이고 *구멍*이 모양 정보를 가짐
    gap = component_stats(~mask) if (0.6 < mask.mean() < 0.995) else {}
    for kk in ['nPer1e4', 'areaCV', 'largestFrac', 'elongIQR', 'flatMed']:
        out['gap' + kk[0].upper() + kk[1:]] = gap.get(kk, float('nan'))
    out.update(shade_stats(L, rgb, mask))
    out['coh6'] = coherence(logL, mask, 6)
    out['coh20'] = coherence(logL, mask, 20)
    out.update(edge_stats(L, mask, all_cloud))
    return out

# ═════════ 자(RULER-flow.md §5.2) — 동결 게이트 목록 ═════════
# (지표, 불만 군, 종류, 조건) — 종류: ge25 = ≥ 사진 q25, le75 = ≤ 사진 q75, iqr = 사진 [q25, q75] 안(양측).
# 조건: 'gap' = 그 그림의 cloudFrac > 0.6 일 때만(틈 통계가 있을 때), 'ac' = AcCc(ac 장면)만.
# 판별력이 있던 지표만(설계 §5.2); 측면 스펙트럼 기울기·excess·띠비·sparkle·nPer1e4·colorDensCorr 는 기록만.
GATES = [
    ('hBand', 'flow', 'ge25', None),
    ('coh20', 'flow', 'ge25', None),
    ('flatMed', 'fat', 'ge25', None),
    ('gapFlatMed', 'fat', 'ge25', 'gap'),
    ('largestFrac', 'merge', 'ge25', None),
    ('elongIQR', 'variety', 'ge25', None),
    ('areaCV', 'variety', 'ge25', None),
    ('perimPerArea', 'variety', 'iqr', None),
    ('shadeRange', 'density', 'iqr', None),
    ('logIQR', 'density', 'ge25', None),
    ('darkFrac', 'density', 'ge25', None),
    ('edgeWidthPx', 'density', 'ge25', None),
    ('bimod', 'density', 'ge25', 'ac'),
    ('granSpatial', 'grain', 'le75', None),
    ('slope3_40', 'blur', 'iqr', None),
]
GROUPS = ['grain', 'fat', 'merge', 'variety', 'flow', 'density', 'blur']
GROUP_KO = {'grain': '1 알갱이', 'fat': '2 뚱뚱', 'merge': '3 병합', 'variety': '4 다양성', 'flow': '5 흐름', 'density': '6 밀도', 'blur': '블러 방지'}
# 후보가 고친다고 주장한 불만 군(설계 §1 표의 후보 열; C2 ⊃ C1, C3 ⊃ C2).
CLAIMS = {
    'C0': [],
    'C1': ['grain', 'merge', 'variety', 'flow'],
    'C2': ['grain', 'merge', 'variety', 'flow', 'fat', 'density'],
    'C3': ['grain', 'merge', 'variety', 'flow', 'fat', 'density'],
}
# 하네스 장면 이름 → 사진 종류
SCENE_GENUS = {'cu': 'Cu', 'ac': 'AcCc', 'ci': 'Ci', 'sc': 'StSc', 'st': 'St', 'as': 'As', 'ns': 'Ns', 'cs': 'Ci', 'cg': 'Cu', 'cb': 'Cu'}
PHOTO_SETS = [('genus', 'selection.json', ['Cu', 'AcCc', 'Ci', 'StSc']), ('genus2', 'selection2.json', ['As', 'St', 'Ns'])]
METRIC_KEYS = ['cloudFrac', 'slope3_40', 'slope8_40', 'slope4_10', 'excess4_8', 'grainRatio', 'granSpatial', 'hBand', 'coh6', 'coh20',
               'nPer1e4', 'areaCV', 'largestFrac', 'elongMed', 'elongIQR', 'flatMed', 'perimPerArea',
               'gapNPer1e4', 'gapAreaCV', 'gapLargestFrac', 'gapElongIQR', 'gapFlatMed', 'shadeRange', 'logIQR', 'bimod', 'darkFrac', 'colorDensCorr',
               'edgeSharp', 'edgeP90', 'edgeWidthPx']

def fm_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()

def isnum(v):
    return v is not None and isinstance(v, (int, float)) and v == v

def scene_genus(scene):
    key = scene.rstrip('0123456789').lower()
    return SCENE_GENUS.get(key)

def gate_eval(metric_of, genus, Q, is_ac):
    """metric_of: 지표 → 값(또는 NaN). 돌려줌: [(metric, group, threshold 문자열, value, ok|None)] — None = 해당 없음."""
    rows = []
    cf = metric_of('cloudFrac')
    for m, grp, kind, cond in GATES:
        if cond == 'ac' and not is_ac: continue
        if cond == 'gap' and not (isnum(cf) and cf > 0.6): continue
        q = Q.get(genus, {}).get(m)
        v = metric_of(m)
        if q is None or not isnum(q.get('q25')) or not isnum(q.get('q75')):
            rows.append((m, grp, 'n/a', v, None)); continue
        if kind == 'ge25': th = '>= %.3g' % q['q25']; ok = v >= q['q25'] if isnum(v) else None
        elif kind == 'le75': th = '<= %.3g' % q['q75']; ok = v <= q['q75'] if isnum(v) else None
        else: th = '[%.3g, %.3g]' % (q['q25'], q['q75']); ok = (q['q25'] <= v <= q['q75']) if isnum(v) else None
        rows.append((m, grp, th, v, ok))
    return rows

def fail_counts(rows):
    tot = {'fail': 0, 'n': 0}; per = {g: {'fail': 0, 'n': 0} for g in GROUPS}
    for m, grp, th, v, ok in rows:
        if ok is None: continue
        tot['n'] += 1; per[grp]['n'] += 1
        if not ok: tot['fail'] += 1; per[grp]['fail'] += 1
    return tot, per

def qs(a):
    a = np.array([v for v in a if isnum(v)], float)
    if not len(a): return {'q25': None, 'q50': None, 'q75': None, 'n': 0}
    return {'q25': float(np.quantile(a, .25)), 'q50': float(np.quantile(a, .5)), 'q75': float(np.quantile(a, .75)), 'n': int(len(a))}

# ───────── --photos ─────────
def run_photos(root, out):
    rows = []
    for sub, sel, genera in PHOTO_SETS:
        S = json.load(open(os.path.join(root, 'tools/genus-ruler', sub, sel)))
        for g in genera:
            for idx, frac in S[g].items():
                f = os.path.join(root, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                if not os.path.exists(f): continue
                # photo-metrics.js 와 같은 자름: 하늘 비율 × 0.97, 위에서부터
                rows.append(dict(genus=g, name='%s/%s' % (g, idx), **all_metrics(f, 0, min(1.0, float(frac)) * 0.97)))
    genera = [g for _, _, gs in PHOTO_SETS for g in gs]
    Q = {g: {k: qs([r[k] for r in rows if r['genus'] == g]) for k in METRIC_KEYS} for g in genera}
    Q['ALL'] = {k: qs([r[k] for r in rows]) for k in METRIC_KEYS}
    # 사진 자체의 게이트 실패 수(자기 종류 사분위에 대해) — 판정 규칙 1 의 "사진 q75 실패 수".
    # 온통 구름(allCloud)인 사진은 성분·가장자리 지표가 NaN 이라 게이트가 2개뿐 → 실패 수가 작게 나와 후보에게 지나치게
    # 엄격해짐. 렌더(알파 마스크)는 언제나 거의 모든 게이트가 적용되므로 게이트 10개 이상 적용된 사진만 셉니다.
    MIN_GATES = 10
    pf = {}
    for g in genera:
        cnts, dens, nall = [], [], 0
        for r in rows:
            if r['genus'] != g: continue
            nall += 1
            gr = gate_eval(lambda m: r.get(m, float('nan')), g, Q, g == 'AcCc')
            tot, _ = fail_counts(gr)
            if tot['n'] < MIN_GATES: continue
            cnts.append(tot['fail']); dens.append(tot['n'])
        a = np.array(cnts, float)
        pf[g] = {'q25': float(np.quantile(a, .25)), 'q50': float(np.quantile(a, .5)), 'q75': float(np.quantile(a, .75)), 'q90': float(np.quantile(a, .9)),
                 'n': len(cnts), 'nAll': nall, 'minGates': MIN_GATES, 'gatesMin': int(min(dens)), 'gatesMax': int(max(dens))} if cnts else {'n': 0, 'nAll': nall, 'minGates': MIN_GATES}
    doc = {
        'fmSha256': fm_sha256(), 'date': datetime.date.today().isoformat(),
        'crop': {'width': W0, 'photoTop': 'selection sky fraction x 0.97', 'mask': 'nrbr'},
        'counts': {g: sum(1 for r in rows if r['genus'] == g) for g in genera},
        'gates': [{'metric': m, 'group': grp, 'kind': kind, 'cond': cond} for m, grp, kind, cond in GATES],
        'photoFail': pf,
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('fm.py sha256', doc['fmSha256'])
    print('photos', doc['counts'])
    print('%-14s' % 'metric', ' '.join('%-22s' % g for g in ['ALL'] + genera))
    for k in METRIC_KEYS:
        cols = []
        for g in ['ALL'] + genera:
            q = Q[g][k]
            cols.append('%6.2f/%6.2f/%6.2f' % (q['q25'], q['q50'], q['q75']) if q['n'] else '   nan')
        print('%-14s' % k, ' '.join('%-22s' % c for c in cols))
    print('photo self-fail q25/50/75/90 (n used/all, gates):', {g: ('%.1f/%.1f/%.1f/%.1f (%d/%d, %d-%d)' % (v['q25'], v['q50'], v['q75'], v['q90'], v['n'], v['nAll'], v['gatesMin'], v['gatesMax']) if v['n'] else 'n/a') for g, v in pf.items()})
    print('wrote', out)

# ───────── --renders ─────────
def run_renders(d, out, top=0.78, pattern='*.png'):
    files = sorted(f for f in glob.glob(os.path.join(d, pattern)) if not f.endswith('.alpha.png'))
    res = {}
    for f in files:
        name = os.path.basename(f)[:-4]
        parts = name.split('_')
        if len(parts) < 3: print('skip (name is not <cand>_<scene>_<az>):', name); continue
        cand, scene, az = parts[0], '_'.join(parts[1:-1]), parts[-1]
        ap = f[:-4] + '.alpha.png'
        if not os.path.exists(ap): print('skip (no alpha):', name); continue
        m = all_metrics(f, 0, top, alpha_path=ap, mask_mode='alpha')
        res.setdefault(cand, {}).setdefault(scene, {'genus': scene_genus(scene), 'az': {}})['az'][az] = m
        print(name, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items() if k in ('cloudFrac', 'hBand', 'coh20', 'flatMed', 'largestFrac', 'elongIQR', 'shadeRange', 'darkFrac', 'edgeWidthPx', 'granSpatial', 'slope3_40')}))
    for cand in res:
        for scene, s in res[cand].items():
            keys = set(k for m in s['az'].values() for k in m if k != 'allCloud')
            s['median'] = {k: (float(np.nanmedian([m[k] for m in s['az'].values() if isnum(m.get(k))])) if any(isnum(m.get(k)) for m in s['az'].values()) else float('nan')) for k in keys}
    json.dump({'fmSha256': fm_sha256(), 'dir': os.path.abspath(d), 'top': top, 'mask': 'alpha>=0.15', 'statistic': 'nanmedian over azimuths', 'renders': res}, open(out, 'w'), indent=1)
    print('wrote', out)

# ───────── --gate ─────────
def run_gate(qfile, cfile, ref=None, out=None):
    Qdoc = json.load(open(qfile)); Q = Qdoc['quartiles']; PF = Qdoc.get('photoFail', {})
    C = json.load(open(cfile))['renders']
    R = json.load(open(ref))['renders'] if ref else None
    report = {}
    def eval_scene(s, genus):
        rows = gate_eval(lambda m: s['median'].get(m, float('nan')), genus, Q, genus == 'AcCc')
        return rows, fail_counts(rows)
    for cand, scenes in C.items():
        claims = CLAIMS.get(cand.split('-')[0], None)
        for scene, s in scenes.items():
            genus = s.get('genus') or scene_genus(scene)
            if genus is None: print('skip (unknown genus):', cand, scene); continue
            rows, (tot, per) = eval_scene(s, genus)
            print('\n== %s %s (사진 %s, 방위 %s) ==' % (cand, scene, genus, ','.join(sorted(s['az'], key=lambda a: -int(a)))))
            print('%-14s %-8s %-16s %-10s %-28s %s' % ('지표', '군', '문턱', '중앙', '방위별', '판정'))
            for m, grp, th, v, ok in rows:
                azv = ' '.join('%s' % ('%.3g' % s['az'][a][m] if isnum(s['az'][a].get(m)) else 'nan') for a in sorted(s['az'], key=lambda a: -int(a)))
                print('%-14s %-8s %-16s %-10s %-28s %s' % (m, grp, th, ('%.3g' % v) if isnum(v) else 'nan', azv, '○' if ok else ('×' if ok is not None else '—')))
            pq = PF.get(genus, {})
            line = '실패 %d/%d' % (tot['fail'], tot['n'])
            if pq: line += '  (사진 q75 %.1f → %s)' % (pq['q75'], '○' if tot['fail'] <= pq['q75'] else '×')
            print(line)
            grp_line = '  군별: ' + ' '.join('%s %d/%d' % (GROUP_KO[g], per[g]['fail'], per[g]['n']) for g in GROUPS if per[g]['n'])
            entry = {'genus': genus, 'rows': [{'metric': m, 'group': grp, 'threshold': th, 'value': v, 'ok': ok} for m, grp, th, v, ok in rows],
                     'fail': tot, 'perGroup': per, 'photoQ75': pq.get('q75'), 'rule1a': (tot['fail'] <= pq['q75']) if pq else None}
            ref_s = None
            if R:
                for rc, rs in R.items():
                    if scene in rs and rs[scene].get('genus', scene_genus(scene)) == genus: ref_s = rs[scene]; break
            if ref_s is not None:
                _, (rtot, rper) = eval_scene(ref_s, genus)
                grp_line += '\n  기준: ' + ' '.join('%s %d/%d' % (GROUP_KO[g], rper[g]['fail'], rper[g]['n']) for g in GROUPS if rper[g]['n'])
                entry['refPerGroup'] = rper; entry['refFail'] = rtot
                if claims:
                    # 규칙 1b: 주장한 군마다 C0 보다 실패가 엄격히 적음(C0 가 0 이면 0 유지)
                    verdict = {}
                    for g in claims:
                        if per[g]['n'] == 0: continue
                        verdict[g] = per[g]['fail'] < rper[g]['fail'] or (rper[g]['fail'] == 0 and per[g]['fail'] == 0)
                    entry['rule1b'] = verdict
                    grp_line += '\n  규칙 1b(주장 군 %s): %s' % (','.join(claims), ' '.join('%s %s' % (GROUP_KO[g], '○' if ok else '×') for g, ok in verdict.items()))
            print(grp_line)
            report.setdefault(cand, {})[scene] = entry
    if out:
        json.dump({'fmSha256': fm_sha256(), 'quartiles': os.path.abspath(qfile), 'candidate': os.path.abspath(cfile), 'ref': os.path.abspath(ref) if ref else None, 'report': report}, open(out, 'w'), indent=1)
        print('wrote', out)

def main(argv):
    def opt(name, default=None):
        if name in argv:
            i = argv.index(name); v = argv[i + 1]; del argv[i:i + 2]; return v
        return default
    if '--photos' in argv:
        argv.remove('--photos')
        root = opt('--root', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..')))
        out = opt('--out', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'photo-flow-quartiles.json'))
        return run_photos(root, out)
    if '--renders' in argv:
        i = argv.index('--renders'); d = argv[i + 1]; del argv[i:i + 2]
        out = opt('--out', os.path.join(d, 'renders.json')); top = float(opt('--top', '0.78')); pat = opt('--glob', '*.png')
        return run_renders(d, out, top, pat)
    if '--gate' in argv:
        i = argv.index('--gate'); qf, cf = argv[i + 1], argv[i + 2]; del argv[i:i + 3]
        return run_gate(qf, cf, opt('--ref'), opt('--out'))
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__); return
    # 낱장: path[:y0:y1[:x0:x1]][@mask_mode]
    for arg in argv:
        mm = 'nrbr'
        if '@' in arg: arg, mm = arg.split('@')
        parts = arg.split(':')
        p = parts[0]; nums = [float(v) for v in parts[1:]]
        y0, y1 = (nums[0], nums[1]) if len(nums) >= 2 else (0.0, 1.0)
        x0, x1 = (nums[2], nums[3]) if len(nums) >= 4 else (0.0, 1.0)
        ap = p[:-4] + '.alpha.png' if mm == 'alpha' else None
        m = all_metrics(p, y0, y1, x0, x1, alpha_path=ap, mask_mode=mm)
        print(p.split('/')[-1], json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items()}))

if __name__ == '__main__':
    main(sys.argv[1:])
