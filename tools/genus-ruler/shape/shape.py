#!/usr/bin/env python3
"""
shape.py — RULER-shape(§139) 지표·판정(검토 반영판, §1.5). fm.py 의 자르기(폭 320)·마스크·스펙트럼/응집 함수를 가져오고, 조각 지표는 **모두 20 px 문턱**으로
여기서 다시 잽니다. 뼈대 서명: baseTopRough(아래/위 경계 MAD 비) · nnReg(Clark–Evans R) · areaExp(보고, 장면 합산).

  python3 -I shape.py --photos <repo root> --out shape-photo-quartiles.json
  python3 -I shape.py --renders <폴더> --out <json> [--glob '*.png'] [--top 0.567]
  python3 -I shape.py --gate shape-photo-quartiles.json <renders json> --ref K0h --cands K1,K2 [--null K0hn7171,K0hn8181] [--also K0] --out <json>
"""
import glob
import hashlib
import json
import math
import os
import sys
from collections import deque

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'flow'))
import fm  # noqa: E402
import phys2  # noqa: E402  (quart_ci — 부트스트랩 CI, 같은 시드)

# ───────── 설정(렌더 전 고정) ─────────
PHOTO_TOP = 0.85           # 사진: 하늘 비율 × 0.85(지평선 띠 제외)
RENDER_TOP = 0.567         # 렌더: 위 56.7 %(시선 20°·시야 60° 에서 고도 ≳ 16°)
MIN_AREA = 20              # 조각 최소 면적(px) — 모든 조각 지표
BT_MIN_AREA, BT_MIN_H, BT_MIN_COLS, BT_MIN_COMPS = 150, 12, 24, 2
NN_MIN_COMPS, AE_MIN_N = 8, 30
SAT_MAX = 0.05
CF_COMP = (0.05, 0.9)      # 조각 군 유효 운량(cu·cg); sc 는 ≤ 0.6
CF_GAP = (0.6, 0.98)       # 덮개 군(sc) 유효 운량
SC_SPLIT = 0.6
TIE_IQR = 0.1
MARGIN_MIN = 3
MIN_V = 6                  # 종류 판정에 필요한 최소 유효 칸 수(아니면 판정 불가)
REF_SEED, NULL_SEEDS = 5151, (7171, 8181)   # 영가설 시드 짝짓기(jobs-shape.json)
G4_REPORT = 0.05           # 장면 |Δ cloudFrac| 보고 문턱(역표 재측정 필요)
G4_INVALID = 0.15          # 이 위면 운량 약속이 깨진 것 — 그 장면의 조각 칸 무효(사진 층화가 5 %p 수준의 운량 차는 흡수)
BOOT_N, BOOT_SEED = 2000, 20261015

COMP_KEYS = ['areaCV', 'largestFrac', 'perimPerArea', 'flatMed', 'elongIQR', 'nnReg']
# baseTopRough: 사진 Cu q75 = 1.154 ≥ 1 (동결 전 측정, 2026-10-15) → RULER-shape §2 의 규칙대로 S 에서 빼고 보고(서명 P 에는 남김).
CU_KEYS = COMP_KEYS
GAP_KEYS = ['gapFlatMed', 'gapAreaCV', 'gapNPer1e4', 'slope8_40', 'coh20', 'hBand']
REPORT_KEYS = ['baseTopRough', 'nnSpacing', 'areaExp']
GROUP = {'areaCV': 'size', 'largestFrac': 'size', 'perimPerArea': 'size', 'flatMed': 'form', 'elongIQR': 'form', 'nnReg': 'place', 'baseTopRough': 'base',
         'gapFlatMed': 'gap', 'gapAreaCV': 'gap', 'gapNPer1e4': 'gap', 'slope8_40': 'lum', 'coh20': 'lum', 'hBand': 'lum'}
SIGNATURE = ('baseTopRough', 'nnReg')
PHOTO_SETS = [('genus', 'selection.json', ['Cu', 'StSc']), ('genus2', 'selection2.json', ['Cg'])]
# 장면 이름 → 종류·공칭 운량. held-out: cu25s5151 … / 개발: S1_1505(sc 0.33) S2_0809(cu 0.32) S3_1308(sc 0.25)
DEV_SCENES = {'S1': ('StSc', 0.33), 'S2': ('Cu', 0.32), 'S3': ('StSc', 0.25)}


def shape_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


def scene_meta(scene):
    for k, v in DEV_SCENES.items():
        if scene.startswith(k + '_'):
            return v
    g = {'cu': 'Cu', 'cg': 'Cg', 'sc': 'StSc'}.get(scene[:2])
    digits = ''.join(ch for ch in scene[2:4] if ch.isdigit())
    return (g, int(digits) / 100 if digits else None)


def keys_for(genus, cover):
    """종류·공칭 운량 → S 에 드는 지표 군."""
    if genus in ('Cu', 'Cg'):
        return CU_KEYS
    if genus == 'StSc':
        return GAP_KEYS if (cover is not None and cover > SC_SPLIT) else COMP_KEYS
    return []


# ───────── 조각 ─────────
def components(mask):
    H, W = mask.shape
    lab = np.full((H, W), -1, np.int32)
    comps = []
    for y0 in range(H):
        for x0 in range(W):
            if not mask[y0, x0] or lab[y0, x0] >= 0:
                continue
            cid = len(comps)
            lab[y0, x0] = cid
            q = deque([(y0, x0)]); pts = []
            while q:
                cy, cx = q.popleft(); pts.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and lab[ny, nx] < 0:
                        lab[ny, nx] = cid; q.append((ny, nx))
            comps.append(np.array(pts))
    return lab, [p for p in comps if len(p) >= MIN_AREA]


def comp_stats(mask, comps):
    H, W = mask.shape
    out = {k: float('nan') for k in ['areaCV', 'largestFrac', 'perimPerArea', 'flatMed', 'elongIQR', 'nPer1e4']}
    out['nComp'] = len(comps)
    if not comps:
        return out
    areas = np.array([len(p) for p in comps], float)
    out['nPer1e4'] = float(len(comps) / (H * W) * 1e4)
    out['areaCV'] = float(areas.std() / areas.mean())
    out['largestFrac'] = float(areas.max() / areas.sum())
    nb = np.zeros_like(mask)
    nb[:, 1:] |= ~mask[:, :-1]; nb[:, :-1] |= ~mask[:, 1:]; nb[1:, :] |= ~mask[:-1, :]; nb[:-1, :] |= ~mask[1:, :]
    out['perimPerArea'] = float((mask & nb).sum() / max(1, mask.sum()))
    fl, el = [], []
    for p in comps:
        fl.append((p[:, 1].max() - p[:, 1].min() + 1) / (p[:, 0].max() - p[:, 0].min() + 1))
        c = p - p.mean(0); cov = c.T @ c / len(p); ev = np.linalg.eigvalsh(cov)
        el.append(math.sqrt(max(ev[1], 1e-9) / max(ev[0], 1e-9)))
    out['flatMed'] = float(np.median(fl))
    out['elongIQR'] = float(np.quantile(el, .75) - np.quantile(el, .25)) if len(el) >= 4 else float('nan')
    return out


def base_top_rough(mask, comps):
    """조각(≥150 px·높이 ≥12·유효 열 ≥24)마다 열별 아래 경계 y(max) 와 위 경계 y(min) 의 1 차 추세 잔차 **MAD** 비(아래 ÷ 위). 자른 테두리에 닿는 열만 뺌. 조각 ≥ 2 의 중앙값."""
    H, W = mask.shape
    r = []
    for p in comps:
        if len(p) < BT_MIN_AREA or (p[:, 0].max() - p[:, 0].min() + 1) < BT_MIN_H:
            continue
        xs = np.unique(p[:, 1]); top = []; bot = []; keep = []
        for x in xs:
            col = p[p[:, 1] == x, 0]
            t, b = col.min(), col.max()
            if t == 0 or b == H - 1 or x == 0 or x == W - 1:
                continue
            keep.append(x); top.append(t); bot.append(b)
        if len(keep) < BT_MIN_COLS:
            continue
        xs = np.array(keep, float); top = np.array(top, float); bot = np.array(bot, float)
        A = np.vstack([xs, np.ones_like(xs)]).T
        def mad(v):
            coef, *_ = np.linalg.lstsq(A, v, rcond=None); res = v - A @ coef
            return float(np.median(np.abs(res - np.median(res))))
        mt, mb = mad(top), mad(bot)
        if mt < 0.25:
            continue
        r.append(mb / mt)
    return (float(np.median(r)) if len(r) >= BT_MIN_COMPS else float('nan')), len(r)


def nn_metrics(mask, comps):
    """nnReg = Clark–Evans R(평균 최근접 거리 ÷ 0.5/√밀도; 1 무작위 · >1 격자 · <1 군집), nnSpacing = 최근접 거리 ÷ 둘 중 큰 등가 지름(보고). 조각 ≥ 8."""
    if len(comps) < NN_MIN_COMPS:
        return float('nan'), float('nan')
    H, W = mask.shape
    cen = np.array([p.mean(0) for p in comps]); dia = np.array([2 * math.sqrt(len(p) / math.pi) for p in comps])
    d2 = ((cen[:, None, :] - cen[None, :, :]) ** 2).sum(-1); np.fill_diagonal(d2, np.inf)
    j = d2.argmin(1); d = np.sqrt(d2[np.arange(len(comps)), j])
    dens = len(comps) / (H * W)
    return float(d.mean() / (0.5 / math.sqrt(dens))), float(np.median(d / np.maximum(dia, dia[j])))


def area_exp_pooled(areas):
    a = np.array([x for x in areas if x >= MIN_AREA], float)
    if len(a) < AE_MIN_N:
        return float('nan')
    return float(1 + len(a) / np.log(a / MIN_AREA).sum())


def metrics_for_mask(rgb, lin, L, mask, all_cloud):
    logL = np.log(np.maximum(L, 1e-5))
    out = {'cloudFrac': float(mask.mean()), 'allCloud': bool(all_cloud)}
    _, comps = components(mask)
    out.update(comp_stats(mask, comps))
    out['baseTopRough'], out['nBT'] = base_top_rough(mask, comps)
    out['nnReg'], out['nnSpacing'] = nn_metrics(mask, comps)
    out['areas'] = [int(len(p)) for p in comps]
    out['areaExp'] = area_exp_pooled(out['areas'])
    # 덮개 군(sc > 0.6): 구멍 조각 + 휘도 구조(fm)
    if CF_GAP[0] < out['cloudFrac'] < CF_GAP[1]:
        _, gaps = components(~mask)
        gs = comp_stats(~mask, gaps)
        out['gapFlatMed'], out['gapAreaCV'], out['gapNPer1e4'] = gs['flatMed'], gs['areaCV'], gs['nPer1e4']
    else:
        out['gapFlatMed'] = out['gapAreaCV'] = out['gapNPer1e4'] = float('nan')
    P, k, kx, ky = fm.spectrum(logL)
    out['slope8_40'] = fm.radial_slope(P, k, 8, 40)
    out['coh20'] = fm.coherence(logL, mask, 20)
    out['hBand'] = fm.anisotropy(P, kx, ky, k)
    return out


def metrics_of(path, y0=0.0, y1=1.0, alpha_path=None):
    """사진: NRBR 마스크 하나. 렌더(alpha_path): 알파 ≥ 0.15 와 NRBR 둘 다 — 'alt' 에 NRBR 판."""
    rgb, alpha = fm.load_crop(path, y0, y1, alpha_path=alpha_path)
    L, lin = fm.luminance(rgb)
    sat = float(((rgb[..., 0] >= 250) & (rgb[..., 1] >= 250) & (rgb[..., 2] >= 250)).mean())
    if alpha_path:
        m1, a1 = fm.cloud_mask(rgb, lin, L, alpha, 'alpha')
        out = metrics_for_mask(rgb, lin, L, m1, a1)
        m2, a2 = fm.cloud_mask(rgb, lin, L, None, 'nrbr')
        out['alt'] = {k: v for k, v in metrics_for_mask(rgb, lin, L, m2, a2).items() if k != 'areas'}
    else:
        m, a = fm.cloud_mask(rgb, lin, L, None, 'nrbr')
        out = metrics_for_mask(rgb, lin, L, m, a)
    out['satFrac'] = sat; out['H'] = int(L.shape[0])
    return out


def valid_for(m, key):
    if m.get('allCloud') or m.get('satFrac', 0) > SAT_MAX or not fm.isnum(m.get(key)):
        return False
    cf = m['cloudFrac']
    if key in GAP_KEYS:
        return CF_GAP[0] < cf < CF_GAP[1]
    return CF_COMP[0] <= cf <= CF_COMP[1]


# ───────── --photos ─────────
def quart(a):
    q = phys2.quart_ci(a)
    if not q:
        return {'n': len([v for v in a if fm.isnum(v)])}
    arr = np.array([v for v in a if fm.isnum(v)], float)
    q['q10'] = float(np.quantile(arr, .10)); q['q90'] = float(np.quantile(arr, .90))
    return q


def run_photos(root, out):
    rows = []
    for sub, sel, genera in PHOTO_SETS:
        S = json.load(open(os.path.join(root, 'tools/genus-ruler', sub, sel)))
        for g in genera:
            for idx, frac in S[g].items():
                f = os.path.join(root, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                if not os.path.exists(f):
                    continue
                m = metrics_of(f, 0, min(1.0, float(frac)) * PHOTO_TOP)
                m.pop('areas', None)
                rows.append(dict(genus=g, name='%s/%s' % (g, idx), **m))
    genera = [g for _, _, gs in PHOTO_SETS for g in gs]
    keys = CU_KEYS + GAP_KEYS + REPORT_KEYS
    Q, strata = {}, {}
    for g in genera:
        rg = [r for r in rows if r['genus'] == g]
        cfs = np.array([r['cloudFrac'] for r in rg if not r['allCloud']])
        edges = [float(np.quantile(cfs, 1 / 3)), float(np.quantile(cfs, 2 / 3))] if len(cfs) >= 9 else [0.0, 1.0]
        strata[g] = edges
        Q[g] = {}
        for k in keys:
            vals = [r[k] for r in rg if valid_for(r, k)]
            Q[g][k] = quart(vals)
            by = []
            for t in range(3):
                lo = -1 if t == 0 else edges[t - 1]; hi = edges[t] if t < 2 else 2
                by.append(quart([r[k] for r in rg if valid_for(r, k) and lo < r['cloudFrac'] <= hi]))
            Q[g][k]['byCf'] = by
    doc = {
        'shapeSha256': shape_sha256(), 'fmSha256': fm.fm_sha256(), 'phys2Sha256': phys2.phys2_sha256(),
        'crop': {'width': fm.W0, 'photoTop': 'selection sky fraction x %s' % PHOTO_TOP, 'renderTop': RENDER_TOP, 'mask': 'nrbr', 'minArea': MIN_AREA,
                 'valid': 'component keys cloudFrac %s-%s, gap keys %s-%s, satFrac <= %s, not allCloud' % (CF_COMP + CF_GAP + (SAT_MAX,)),
                 'ci': 'bootstrap 90 %%, %d draws, seed %d' % (phys2.BOOT_N, phys2.BOOT_SEED), 'cfStrata': strata},
        'counts': {g: sum(1 for r in rows if r['genus'] == g) for g in genera},
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('shape.py sha256', doc['shapeSha256'])
    print('photos', doc['counts'], 'cf strata', {g: [round(e, 2) for e in v] for g, v in strata.items()})
    print('%-13s' % 'metric', ' '.join('%-30s' % g for g in genera))
    for k in keys:
        cols = []
        for g in genera:
            q = Q[g][k]
            cols.append(('%.3f/%.3f/%.3f n%d' % (q['q25'], q['q50'], q['q75'], q['n'])) if q.get('n') and 'q25' in q else 'n%d' % q.get('n', 0))
        print('%-13s' % k, ' '.join('%-30s' % c for c in cols))
    print('wrote', out)


# ───────── --renders ─────────
def run_renders(d, out, top=RENDER_TOP, pattern='*.png'):
    files = sorted(f for f in glob.glob(os.path.join(d, pattern)) if not f.endswith('.alpha.png'))
    res = {}
    for f in files:
        name = os.path.basename(f)[:-4]
        parts = name.split('_')
        if len(parts) < 3:
            print('skip (name is not <cand>_<scene>_<az>):', name); continue
        cand, scene, az = parts[0], '_'.join(parts[1:-1]), parts[-1]
        ap = f[:-4] + '.alpha.png'
        if not os.path.exists(ap):
            print('skip (no alpha):', name); continue
        m = metrics_of(f, 0, top, alpha_path=ap)
        g, cover = scene_meta(scene)
        res.setdefault(cand, {}).setdefault(scene, {'genus': g, 'cover': cover, 'az': {}})['az'][az] = m
        print(name, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items() if k in CU_KEYS + GAP_KEYS + REPORT_KEYS + ['cloudFrac', 'satFrac']}))
    json.dump({'shapeSha256': shape_sha256(), 'dir': os.path.abspath(d), 'top': top, 'mask': 'alpha>=0.15 (+nrbr alt)', 'renders': res}, open(out, 'w'), indent=1)
    print('wrote', out)


# ───────── --gate ─────────
def band(q, which):
    """문턱 벌: base [q25,q75]/[q10,q90] · wide [ci25 lo, ci75 hi] · narrow [ci25 hi, ci75 lo]."""
    if which == 'base':
        return (q['q25'], q['q75']), (q['q10'], q['q90'])
    if which == 'wide':
        return (q['ci25'][0], q['ci75'][1]), (q['q10'], q['q90'])
    return (q['ci25'][1], q['ci75'][0]), (q['q10'], q['q90'])


def pick_q(Q, g, k, cf, strata):
    q = Q[g][k]
    if not q.get('n') or 'q25' not in q:
        return None
    t = 0 if cf <= strata[g][0] else (1 if cf <= strata[g][1] else 2)
    qb = q.get('byCf', [None, None, None])[t]
    return qb if (qb and qb.get('n', 0) >= 10 and 'q25' in qb) else q


def cells_of(R, cand, Q, strata):
    """후보의 칸 = 지표 × 장면 × 방위. 값·유효·z(IQR 단위 편차)·세 벌 inside/wide·마스크 뒤집힘."""
    cells = {}
    for scene, s in R.get(cand, {}).items():
        g, cover = s['genus'], s['cover']
        keys = keys_for(g, cover)
        if not keys:
            continue
        for az, m in s['az'].items():
            # 사진 층(cloudFrac 3 분위)은 **그 렌더 자신의** 운량으로 고릅니다 — 사진 통계는 운량 조건부(개발 렌더: K0h 0.12 vs K1 0.45 가 같은 층을 쓰면 틀림).
            for k in keys:
                q = pick_q(Q, g, k, m['cloudFrac'], strata)
                v = m.get(k)
                ok = q is not None and valid_for(m, k)
                cell = {'v': v, 'valid': bool(ok), 'genus': g, 'scene': scene, 'az': az, 'k': k}
                if ok:
                    iqr = max(1e-9, q['q75'] - q['q25'])
                    cell['z'] = abs(v - q['q50']) / iqr
                    cell['iqr'] = iqr
                    for w in ('base', 'wide', 'narrow'):
                        (lo, hi), (wlo, whi) = band(q, w)
                        cell['in_' + w] = bool(lo <= v <= hi)
                        cell['wide_' + w] = bool(wlo <= v <= whi)
                    alt = m.get('alt')
                    if alt is not None and fm.isnum(alt.get(k)):
                        (lo, hi), _ = band(q, 'base')
                        cell['maskFlip'] = bool((lo <= alt[k] <= hi) != cell['in_base'])
                    else:
                        cell['maskFlip'] = False
                cells[(k, scene, az)] = cell
    return cells


def scene_cf(R, cand):
    out = {}
    for scene, s in R.get(cand, {}).items():
        for az, m in s['az'].items():
            out[(scene, az)] = m['cloudFrac']
    return out


def g4_scenes(R, ref, cand, genus):
    """장면(방위 평균) Δ cloudFrac(후보 − 기준). > G4_REPORT 보고, > G4_INVALID 면 그 장면의 조각 칸 무효(양쪽)."""
    rep, bad = {}, set()
    for scene in R.get(cand, {}):
        if R[cand][scene]['genus'] != genus:
            continue
        a = [m['cloudFrac'] for m in R[cand][scene]['az'].values()]
        b = [m['cloudFrac'] for m in R.get(ref, {}).get(scene, {}).get('az', {}).values()]
        if not (a and b):
            continue
        d = float(np.mean(a) - np.mean(b))
        if abs(d) > G4_REPORT:
            rep[scene] = round(d, 3)
        if abs(d) > G4_INVALID:
            bad.add(scene)
    return rep, bad


def compare(cr, cc, V):
    out = {}
    for w in ('base', 'wide', 'narrow'):
        out[w] = {'refIn': sum(1 for key in V if cr[key]['in_' + w]), 'candIn': sum(1 for key in V if cc[key]['in_' + w]),
                  'refWide': sum(1 for key in V if cr[key]['wide_' + w]), 'candWide': sum(1 for key in V if cc[key]['wide_' + w])}
    better = worse = tie = 0; sig = {'better': 0, 'worse': 0, 'tie': 0}; grp = {}
    for key in V:
        d = cr[key]['z'] - cc[key]['z']
        tag = 'better' if d > TIE_IQR else ('worse' if d < -TIE_IQR else 'tie')
        if tag == 'better': better += 1
        elif tag == 'worse': worse += 1
        else: tie += 1
        if key[0] in SIGNATURE: sig[tag] += 1
        gname = GROUP[key[0]]; grp.setdefault(gname, {'better': 0, 'worse': 0, 'tie': 0})[tag] += 1
    out['pair'] = {'better': better, 'worse': worse, 'tie': tie, 'signature': sig, 'groups': grp}
    # 서명 보고(S 밖): baseTopRough 의 뷰별 기준/후보 값
    out['signatureReport'] = {k[1] + '|' + k[2]: [cr[k].get('v'), cc[k].get('v')] for k in V if k[0] in SIGNATURE}
    # 뷰 클러스터 부트스트랩: Δz 의 중앙값(뷰 = 장면×방위)
    views = {}
    for key in V:
        views.setdefault((key[1], key[2]), []).append(cr[key]['z'] - cc[key]['z'])
    vl = list(views.values())
    if len(vl) >= 2:
        rng = np.random.default_rng(BOOT_SEED)
        meds = []
        for _ in range(BOOT_N):
            pick = rng.integers(0, len(vl), size=len(vl))
            meds.append(float(np.median(np.concatenate([vl[i] for i in pick]))))
        out['dzMedian'] = float(np.median(np.concatenate(vl)))
        out['dzCI90'] = [float(np.quantile(meds, .05)), float(np.quantile(meds, .95))]
    else:
        out['dzMedian'] = float('nan'); out['dzCI90'] = [float('nan'), float('nan')]
    return out


def run_gate(qfile, rfile, ref, cands, nulls, also, out):
    P = json.load(open(qfile)); Q = P['quartiles']; strata = P['crop']['cfStrata']
    R = json.load(open(rfile))['renders']
    cells = {c: cells_of(R, c, Q, strata) for c in [ref] + cands + nulls + also if c in R}
    doc = {'ref': ref, 'cands': cands, 'nulls': nulls, 'marginMin': MARGIN_MIN, 'perGenus': {}}
    genera = sorted(set(c['genus'] for cc in cells.values() for c in cc.values()))
    for g in genera:
        row = {}
        cr = {k: v for k, v in cells[ref].items() if v['genus'] == g}
        # 영가설 여유: 같은 V(기준·영가설 둘 다 유효) 위 inside 차의 최대 + 1, 최소 3
        margin = MARGIN_MIN; nullinfo = {}
        for n in nulls:
            if n not in cells:
                continue
            # 영가설 시드의 장면 이름(cu25s7171)을 기준의 첫 실현(cu25s5151)에 짝지음 — 렌더 뒤 발견한 판정 코드 결함(짝이 안 맞아 V 0 → 여유가 바닥값 3 에 머묾).
            # 고치면 여유는 커질 수만 있음(더 엄격).
            cn = {}
            for k, v in cells[n].items():
                if v['genus'] != g:
                    continue
                scene = k[1]
                for s in NULL_SEEDS:
                    scene = scene.replace('s%d' % s, 's%d' % REF_SEED)
                cn[(k[0], scene, k[2])] = v
            V = [k for k in cr if k in cn and cr[k]['valid'] and cn[k]['valid']]
            d = abs(sum(1 for k in V if cn[k]['in_base']) - sum(1 for k in V if cr[k]['in_base']))
            nullinfo[n] = {'V': len(V), 'dInside': d}
            margin = max(margin, d + 1)
        row['margin'] = margin; row['null'] = nullinfo
        for c in cands + also:
            if c not in cells:
                continue
            cc = {k: v for k, v in cells[c].items() if v['genus'] == g}
            g4rep, bad = g4_scenes(R, ref, c, g)
            V = [k for k in cr if k in cc and cr[k]['valid'] and cc[k]['valid'] and not cc[k].get('maskFlip') and not cr[k].get('maskFlip')
                 and not (k[1] in bad and k[0] not in GAP_KEYS)]
            # 보고 전용 지표(baseTopRough 등)는 V 와 별도로 짝 비교만
            rep = {}
            for rk in ('baseTopRough',):
                pairs = []
                for scene in R.get(c, {}):
                    if R[c][scene]['genus'] != g:
                        continue
                    for az, m in R[c][scene]['az'].items():
                        mr = R.get(ref, {}).get(scene, {}).get('az', {}).get(az)
                        if mr and fm.isnum(m.get(rk)) and fm.isnum(mr.get(rk)):
                            pairs.append([scene, az, mr[rk], m[rk]])
                rep[rk] = pairs
            cmp_ = compare(cr, cc, V)
            cmp_['report'] = rep
            invalid = {'refOnly': sum(1 for k in cr if cr[k]['valid'] and not (k in cc and cc[k]['valid'])),
                       'candOnly': sum(1 for k in cc if cc[k]['valid'] and not (k in cr and cr[k]['valid'])),
                       'maskFlip': sum(1 for k in cr if k in cc and (cc[k].get('maskFlip') or cr[k].get('maskFlip'))), 'g4Invalid': sorted(bad), 'g4Report': g4rep}
            S_sets = {w: bool(cmp_[w]['candIn'] >= cmp_[w]['refIn'] + margin and cmp_[w]['candWide'] >= cmp_[w]['refWide']) for w in ('base', 'wide', 'narrow')}
            ci_ok = bool(cmp_['dzCI90'][0] > 0) if np.isfinite(cmp_['dzCI90'][0]) else False
            S = bool(all(S_sets.values()) and ci_ok)
            inconclusive = bool(S_sets['base'] and not S)
            # notWorse 는 V ≥ MIN_V 일 때만 뜻이 있음(V 가 비면 0 ≥ 0 으로 공허하게 참 — G4 가 sc 칸을 다 지우는 경우). 그 아래면 '판정 불가'.
            row[c] = {'V': len(V), 'sets': cmp_, 'invalid': invalid, 'S_sets': S_sets, 'ciOk': ci_ok, 'S': S, 'inconclusive': inconclusive,
                      'notWorse': bool(len(V) >= MIN_V and cmp_['base']['candIn'] >= cmp_['base']['refIn']), 'judgeable': bool(len(V) >= MIN_V)}
        doc['perGenus'][g] = row
    verdict = {}
    for c in cands:
        cu = doc['perGenus'].get('Cu', {}).get(c); sc = doc['perGenus'].get('StSc', {}).get(c)
        verdict[c] = {'primary_cu_S': bool(cu and cu['S']), 'cu_inconclusive': bool(cu and cu['inconclusive']), 'cu_judgeable': bool(cu and cu['judgeable']),
                      'sc_notWorse': bool(sc and sc['notWorse']), 'sc_S': bool(sc and sc['S']), 'sc_judgeable': bool(sc and sc['judgeable']),
                      'adoptCandidate': bool(cu and cu['S'] and sc and sc['notWorse']), 'eyeChecklist': 'pending (RULER-shape §4)'}
    doc['verdict'] = verdict
    json.dump(doc, open(out, 'w'), indent=1)
    for g, row in doc['perGenus'].items():
        print('== %s  margin %d  null %s' % (g, row['margin'], row['null']))
        for c, r in row.items():
            if c in ('margin', 'null'):
                continue
            b = r['sets']['base']; p = r['sets']['pair']
            print('  %-10s V %3d  inside ref %2d → %2d (wide %2d → %2d) | wide-set %2d→%2d narrow-set %2d→%2d | Δz med %.2f CI [%.2f, %.2f] | better %d worse %d tie %d sig %s | S %s%s' % (
                c, r['V'], b['refIn'], b['candIn'], b['refWide'], b['candWide'], r['sets']['wide']['refIn'], r['sets']['wide']['candIn'], r['sets']['narrow']['refIn'], r['sets']['narrow']['candIn'],
                r['sets']['dzMedian'], r['sets']['dzCI90'][0], r['sets']['dzCI90'][1], p['better'], p['worse'], p['tie'], p['signature'], 'PASS' if r['S'] else 'fail', ' (inconclusive)' if r['inconclusive'] else ''))
            print('             invalid %s groups %s' % (r['invalid'], p['groups']))
    print('verdict', json.dumps(verdict))
    print('wrote', out)


def main(argv):
    if '--photos' in argv:
        run_photos(argv[argv.index('--photos') + 1], argv[argv.index('--out') + 1])
    elif '--renders' in argv:
        pat = argv[argv.index('--glob') + 1] if '--glob' in argv else '*.png'
        top = float(argv[argv.index('--top') + 1]) if '--top' in argv else RENDER_TOP
        run_renders(argv[argv.index('--renders') + 1], argv[argv.index('--out') + 1], top, pat)
    elif '--gate' in argv:
        i = argv.index('--gate')
        nulls = argv[argv.index('--null') + 1].split(',') if '--null' in argv else []
        also = argv[argv.index('--also') + 1].split(',') if '--also' in argv else []
        run_gate(argv[i + 1], argv[i + 2], argv[argv.index('--ref') + 1], argv[argv.index('--cands') + 1].split(','), nulls, also, argv[argv.index('--out') + 1])
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
