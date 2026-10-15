#!/usr/bin/env python3
"""
shape.py — RULER-shape(§139) 지표·판정. fm.py 의 자르기(폭 320)·NRBR/알파 마스크·조각 라벨을 그대로 가져와(같은 계산) 조각 지표에
뼈대 서명 세 가지(baseTopRough · nnSpacing · areaExp)를 더합니다. 초안 — 검토(§1.5) 뒤 고정하고 해시를 사분위 파일에 적습니다.

  python3 -I shape.py --photos <repo root> --out shape-photo-quartiles.json
  python3 -I shape.py --renders <폴더> --out <json> [--glob '*.png'] [--top 0.78]
  python3 -I shape.py --gate shape-photo-quartiles.json <renders json> --ref K0 --cands K1,K2 --out <json>
"""
import glob
import hashlib
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'flow'))
import fm  # noqa: E402
import phys2  # noqa: E402  (quart_ci — 부트스트랩 CI, 같은 시드)

KEYS_COMMON = ['flatMed', 'areaCV', 'largestFrac', 'elongIQR', 'perimPerArea', 'nnSpacing', 'areaExp']
KEYS_CU = KEYS_COMMON + ['baseTopRough']
KEYS_BY_GENUS = {'Cu': KEYS_CU, 'Cg': KEYS_CU, 'StSc': KEYS_COMMON}
PHOTO_SETS = [('genus', 'selection.json', ['Cu', 'StSc']), ('genus2', 'selection2.json', ['Cg'])]
SCENE_GENUS = {'cu': 'Cu', 'cg': 'Cg', 'sc': 'StSc'}
MIN_AREA = 20          # 조각 최소 면적(px, fm 과 같음 — fm 은 4 지만 라벨 지표는 20 이상에서 안정)
BT_MIN_AREA = 150      # baseTopRough 조각 최소 면적
BT_MIN_H = 12          # baseTopRough 조각 최소 높이(px)
SAT_MAX = 0.05         # 포화(255,255,255) 비율 상한 — 넘으면 무효
CF_RANGE = (0.05, 0.9)


def shape_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


def components(mask):
    """fm.label 과 같은 4-이웃 라벨 + 조각마다 화소 좌표(y, x) — baseTopRough·nnSpacing 에 필요."""
    H, W = mask.shape
    lab = np.full((H, W), -1, np.int32)
    comps = []
    from collections import deque
    for y0 in range(H):
        for x0 in range(W):
            if not mask[y0, x0] or lab[y0, x0] >= 0:
                continue
            cid = len(comps)
            lab[y0, x0] = cid
            q = deque([(y0, x0)]); pts = []; edge = False
            while q:
                cy, cx = q.popleft(); pts.append((cy, cx))
                if cy == 0 or cx == 0 or cy == H - 1 or cx == W - 1:
                    edge = True
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and lab[ny, nx] < 0:
                        lab[ny, nx] = cid; q.append((ny, nx))
            comps.append({'pts': np.array(pts), 'edge': edge})
    return lab, comps


def base_top_rough(comps):
    """조각(면적 ≥ BT_MIN_AREA · 높이 ≥ BT_MIN_H · 가장자리 안 닿음)의 열별 아래 경계 y(max) 와 위 경계 y(min)의 1 차 추세 제거 잔차 표준편차 비(아래 ÷ 위). 중앙값."""
    r = []
    for c in comps:
        p = c['pts']
        if c['edge'] or len(p) < BT_MIN_AREA:
            continue
        hgt = p[:, 0].max() - p[:, 0].min() + 1
        if hgt < BT_MIN_H:
            continue
        xs = np.unique(p[:, 1])
        if len(xs) < 8:
            continue
        top = np.array([p[p[:, 1] == x, 0].min() for x in xs], float)
        bot = np.array([p[p[:, 1] == x, 0].max() for x in xs], float)
        def resid(v):
            A = np.vstack([xs, np.ones_like(xs)]).T.astype(float)
            coef, *_ = np.linalg.lstsq(A, v, rcond=None)
            return float(np.std(v - A @ coef))
        st, sb = resid(top), resid(bot)
        if st < 1e-6:
            continue
        r.append(sb / st)
    return float(np.median(r)) if r else float('nan'), len(r)


def nn_spacing(comps):
    """조각(면적 ≥ MIN_AREA) 중심의 최근접 이웃 거리 ÷ 둘 중 큰 쪽 등가 지름 2√(A/π). 중앙값(조각 ≥ 5)."""
    big = [c for c in comps if len(c['pts']) >= MIN_AREA]
    if len(big) < 5:
        return float('nan'), len(big)
    cen = np.array([c['pts'].mean(0) for c in big])
    dia = np.array([2 * math.sqrt(len(c['pts']) / math.pi) for c in big])
    d2 = ((cen[:, None, :] - cen[None, :, :]) ** 2).sum(-1)
    np.fill_diagonal(d2, np.inf)
    j = d2.argmin(1)
    ratio = np.sqrt(d2[np.arange(len(big)), j]) / np.maximum(dia, dia[j])
    return float(np.median(ratio)), len(big)


def area_exp(comps):
    """면적 멱법칙 지수 b(MLE, 연속 파레토: 1 + n / Σ ln(a / a_min)), a_min = MIN_AREA, n ≥ 8."""
    a = np.array([len(c['pts']) for c in comps if len(c['pts']) >= MIN_AREA], float)
    if len(a) < 8:
        return float('nan'), len(a)
    return float(1 + len(a) / np.log(a / MIN_AREA).sum()), len(a)


def metrics_of(path, y0=0.0, y1=1.0, alpha_path=None, mask_mode='nrbr'):
    rgb, alpha = fm.load_crop(path, y0, y1, alpha_path=alpha_path)
    L, lin = fm.luminance(rgb)
    mask, all_cloud = fm.cloud_mask(rgb, lin, L, alpha, mask_mode)
    sat = float(((rgb[..., 0] >= 250) & (rgb[..., 1] >= 250) & (rgb[..., 2] >= 250)).mean())
    out = {'H': int(L.shape[0]), 'cloudFrac': float(mask.mean()), 'allCloud': bool(all_cloud), 'satFrac': sat}
    out.update(fm.component_stats(mask))
    _, comps = components(mask)
    out['baseTopRough'], out['nBT'] = base_top_rough(comps)
    out['nnSpacing'], out['nNN'] = nn_spacing(comps)
    out['areaExp'], out['nAE'] = area_exp(comps)
    return out


def valid(m):
    return (CF_RANGE[0] <= m['cloudFrac'] <= CF_RANGE[1]) and m['satFrac'] <= SAT_MAX and not m['allCloud']


def run_photos(root, out):
    rows = []
    for sub, sel, genera in PHOTO_SETS:
        S = json.load(open(os.path.join(root, 'tools/genus-ruler', sub, sel)))
        for g in genera:
            for idx, frac in S[g].items():
                f = os.path.join(root, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                if not os.path.exists(f):
                    continue
                m = metrics_of(f, 0, min(1.0, float(frac)) * 0.97)
                rows.append(dict(genus=g, name='%s/%s' % (g, idx), valid=valid(m), **m))
    genera = [g for _, _, gs in PHOTO_SETS for g in gs]
    kept = [r for r in rows if r['valid']]
    keys = sorted(set(k for ks in KEYS_BY_GENUS.values() for k in ks))
    Q = {g: {k: (phys2.quart_ci([r[k] for r in kept if r['genus'] == g and fm.isnum(r.get(k))]) or fm.qs([])) for k in keys} for g in genera}
    doc = {
        'shapeSha256': shape_sha256(), 'fmSha256': fm.fm_sha256(), 'phys2Sha256': phys2.phys2_sha256(),
        'crop': {'width': fm.W0, 'photoTop': 'selection sky fraction x 0.97', 'mask': 'nrbr', 'minArea': MIN_AREA,
                 'valid': 'cloudFrac %s-%s, satFrac <= %s, not allCloud' % (CF_RANGE[0], CF_RANGE[1], SAT_MAX),
                 'ci': 'bootstrap 90 %%, %d draws, seed %d' % (phys2.BOOT_N, phys2.BOOT_SEED)},
        'counts': {g: sum(1 for r in rows if r['genus'] == g) for g in genera},
        'invalid': {g: [r['name'] for r in rows if r['genus'] == g and not r['valid']] for g in genera},
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('shape.py sha256', doc['shapeSha256'])
    print('photos', doc['counts'], 'invalid', {g: len(v) for g, v in doc['invalid'].items()})
    print('%-13s' % 'metric', ' '.join('%-26s' % g for g in genera))
    for k in keys:
        cols = []
        for g in genera:
            q = Q[g][k]
            cols.append(('%.3f/%.3f/%.3f n%d' % (q['q25'], q['q50'], q['q75'], q['n'])) if q.get('n') else 'nan')
        print('%-13s' % k, ' '.join('%-26s' % c for c in cols))
    print('wrote', out)


def run_renders(d, out, top=0.78, pattern='*.png'):
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
        m = metrics_of(f, 0, top, alpha_path=ap, mask_mode='alpha')
        m['valid'] = valid(m)
        g = next((v for k, v in SCENE_GENUS.items() if scene.startswith(k)), None)
        res.setdefault(cand, {}).setdefault(scene, {'genus': g, 'az': {}})['az'][az] = m
        print(name, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items() if k in KEYS_CU + ['cloudFrac', 'valid']}))
    json.dump({'shapeSha256': shape_sha256(), 'dir': os.path.abspath(d), 'top': top, 'mask': 'alpha>=0.15', 'renders': res}, open(out, 'w'), indent=1)
    print('wrote', out)


def gate_cells(Q, R, cand):
    """종류별 칸(지표 × 장면 × 방위) → inside / wide / valid 수와 짝 비교 재료."""
    out = {}
    for scene, s in R.get(cand, {}).items():
        g = s['genus']
        if g not in KEYS_BY_GENUS:
            continue
        for az, m in s['az'].items():
            for k in KEYS_BY_GENUS[g]:
                q = Q[g][k]
                v = m.get(k)
                ok = m.get('valid', True) and fm.isnum(v) and q.get('n', 0) >= 8
                cell = {'v': v, 'valid': bool(ok), 'inside': bool(ok and q['q25'] <= v <= q['q75']),
                        'wide': bool(ok and q['q10'] <= v <= q['q90']), 'dev': (abs(v - q['q50']) if ok else None)}
                out.setdefault(g, {})['%s|%s|%s' % (k, scene, az)] = cell
    return out


def run_gate(qfile, rfile, ref, cands, out):
    Q = json.load(open(qfile))['quartiles']
    R = json.load(open(rfile))['renders']
    cells = {c: gate_cells(Q, R, c) for c in [ref] + cands}
    doc = {'ref': ref, 'cands': cands, 'perGenus': {}}
    for g in sorted(set(k for c in cells.values() for k in c)):
        base = cells[ref].get(g, {})
        row = {}
        for c in [ref] + cands:
            cc = cells[c].get(g, {})
            n_in = sum(1 for x in cc.values() if x['inside']); n_w = sum(1 for x in cc.values() if x['wide'])
            n_v = sum(1 for x in cc.values() if x['valid'])
            better = worse = 0
            sig = {'better': 0, 'worse': 0}
            if c != ref:
                for key, x in cc.items():
                    b = base.get(key)
                    if not b or x['dev'] is None or b['dev'] is None:
                        continue
                    if x['dev'] < b['dev'] - 1e-9: better += 1
                    elif x['dev'] > b['dev'] + 1e-9: worse += 1
                    if key.split('|')[0] in ('baseTopRough', 'nnSpacing'):
                        if x['dev'] < b['dev'] - 1e-9: sig['better'] += 1
                        elif x['dev'] > b['dev'] + 1e-9: sig['worse'] += 1
            row[c] = {'cells': len(cc), 'valid': n_v, 'inside': n_in, 'wide': n_w, 'better': better, 'worse': worse, 'signature': sig}
        b = row[ref]
        for c in cands:
            r = row[c]
            r['S'] = bool(r['inside'] >= b['inside'] + 2 and r['wide'] >= b['wide'])
        doc['perGenus'][g] = row
    for c in cands:
        passed = [g for g, row in doc['perGenus'].items() if row[c]['S']]
        rest_ok = all(row[c]['inside'] >= row[ref]['inside'] for g, row in doc['perGenus'].items() if g not in passed)
        doc.setdefault('verdict', {})[c] = {'passedGenera': passed, 'adopt': bool(len(passed) >= 2 and rest_ok)}
    json.dump(doc, open(out, 'w'), indent=1)
    for g, row in doc['perGenus'].items():
        print(g, ' | '.join('%s: in %d wide %d valid %d/%d%s' % (c, r['inside'], r['wide'], r['valid'], r['cells'],
              ('' if c == ref else ' better %d worse %d sig %d/%d S %s' % (r['better'], r['worse'], r['signature']['better'], r['signature']['worse'], 'PASS' if r['S'] else 'fail')))
              for c, r in row.items()))
    print('verdict', json.dumps(doc.get('verdict')))
    print('wrote', out)


def main(argv):
    if '--photos' in argv:
        run_photos(argv[argv.index('--photos') + 1], argv[argv.index('--out') + 1])
    elif '--renders' in argv:
        pat = argv[argv.index('--glob') + 1] if '--glob' in argv else '*.png'
        top = float(argv[argv.index('--top') + 1]) if '--top' in argv else 0.78
        run_renders(argv[argv.index('--renders') + 1], argv[argv.index('--out') + 1], top, pat)
    elif '--gate' in argv:
        i = argv.index('--gate')
        run_gate(argv[i + 1], argv[i + 2], argv[argv.index('--ref') + 1], argv[argv.index('--cands') + 1].split(','), argv[argv.index('--out') + 1])
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
