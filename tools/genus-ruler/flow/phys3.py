#!/usr/bin/env python3
"""
phys3.py — RULER-physics3(§138) 지표: 구름 **안쪽** 그늘의 푸름(shadeBlue) + phys.py 의 밝기비·어두움비 그대로.

fm.py(그림 읽기·마스크)·phys.py(밝기비·어두움비)·phys2.py(interior·제외·부트스트랩 CI·문턱 세 벌·톤 배율)를 **그대로** 가져다 씁니다 — 셋 다 고치지 않습니다.

  shadeBlue   (B/R)_그늘 ÷ (B/R)_밝은 곳.  interior 화소 중 휘도 하위 30 % 의 평균 B/R ÷ 상위 30 % 의 평균 B/R(선형 RGB).
              interior = 렌더: 알파 ≥ 0.9 이고 5×5 창이 전부 / 사진: NRBR 마스크를 3 화소 더 깎음(phys2 §2 와 같음).
              ⚠ 설계 검토(§138.1): 마스크 전체로 재면 하위 30 % 가 그늘이 아니라 **반투명 테두리**(사진 AcCc·Ci 에서 절반 이상이 하늘 경계 2 px 안)였음.
              사진 NRBR 은 색 기준 마스크라 푸른 꼬리를 자르므로, 양쪽 모두 "얇은 테두리를 뺀 안쪽" 에서만 잽니다 — 이것이 interior 정의의 이유.
              화이트밸런스는 채널 이득이 톤 곡선 **앞** 에 걸리므로 비율에서 근사적으로만 지워집니다 → ln shadeBlue 에 톤 배율 {0.85, 1, 1.2} 를 곱해
              ○/× 가 뒤집히는 칸은 무효(phys2 와 같은 규칙). 1 = 그늘이 밝은 곳과 같은 색, > 1 = 더 푸름.
  shadeBlueTop 같은 지표를 위 60 % 그림에서(보고만).
  darkRatio · brightRatio   phys.py 그대로(렌더 알파 ≥ 0.15, 사진 NRBR).
  사진 제외(phys2 §2): interior 의 0.1 × 중앙값 미만 화소 > 2 %(비구름 물체) 또는 포화(≥ 250) > 1 % → 제외, 사유 기록.
  사진 사분위 + 부트스트랩 90 % CI(4000 회, 고정 씨앗) → 문턱 세 벌(기본·넓게·좁게).

쓰는 법:
  phys3.py --photos [--root REPO] [--out phys3-photo-quartiles.json]
  phys3.py --renders DIR [--out phys3-renders.json] [--glob '*.png']
  phys3.py --gate phys3-photo-quartiles.json phys3-renders.json [--ref L0] [--cands L1,L2,L3] [--out phys3-gate.json]
    RC(그늘 색): 칸 = (장면 7(ci 제외), 방위), ○ = shadeBlue ∈ [q25, q75]; 톤 배율로 뒤집히는 칸은 무효. 세 문턱 벌 모두에서 점수 ≥ 기준 ∧ 기본에서 점수 ≥ 0.5|V|
       → '통과'; 기본에서만 → '불확정(문턱 CI)'; |V| < 11 → '평가 불가'. 짝 비교(같은 칸의 D 차 ±0.1 로 개선/악화/동률)는 보고.
    G4(면적): 장면별(같은 방위끼리) cloudFrac 상대 변화 |Δ| ≤ 25 %(기준 면적 ≥ 0.02 인 장면만).
"""

import sys, os, json, glob, hashlib, datetime
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm, phys, phys2  # noqa: E402

KEYS = ['shadeBlue', 'shadeBlueTop', 'darkRatio', 'brightRatio', 'cloudFrac']
# 장면 → 사진 종류(RULER-physics3 §2)
SCENE_GENUS = {'cu': 'Cu', 'ac': 'AcCc', 'ci': 'Ci', 'sc25': 'StSc', 'sc85': 'StSc', 'st': 'St', 'as': 'As', 'ns': 'Ns'}
# RC 칸에서 ci 는 뺍니다(렌더 전 결정): 성긴 권운은 interior(알파 ≥ 0.9 + 5×5)가 400 화소에 못 미쳐 NaN 이고(개발 집합 3/3), 후보가 바꾸는 D 도 ≈ 0 입니다.
RC_SCENES = ('cu', 'ac', 'sc25', 'sc85', 'st', 'as', 'ns')
# 유효 칸 하한: 21 칸의 반(올림). 개발 집합(시드 4242)에서 P1 vs P0 의 |V| 는 기본 14 · 넓게 17 · 좁게 14 였음(톤 배율 필터가 As·St·Ns 의 좁은 IQR 가장자리 칸을 무효로 냄).
RC_MIN_VALID = 11


def phys3_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


def interior_mask(rgb, lin, L, alpha, mask_mode):
    """phys2 와 같은 interior: 렌더 알파 ≥ 0.9 + 5×5 창 전부, 사진 NRBR + 3 화소 더 깎음. 포화 화소 제외."""
    if mask_mode == 'alpha' and alpha is not None:
        mask, extra = (alpha >= 0.9), 0
    else:
        mask, _ = fm.cloud_mask(rgb, lin, L, alpha, mask_mode); extra = 3
    sat = (rgb[..., 0] >= 250) & (rgb[..., 1] >= 250) & (rgb[..., 2] >= 250)
    ok = mask & ~sat
    interior = fm.box_blur(ok.astype(np.float64), phys2.R_SMALL + extra) > 0.999
    return interior, mask, sat


def shade_blue(lin, L, interior):
    m = interior & (lin[..., 0] > 1e-4) & (lin[..., 2] > 1e-4)
    if m.sum() < 400:
        return float('nan')
    Lc = L[m]
    lo, hi = np.quantile(Lc, 0.3), np.quantile(Lc, 0.7)
    dark, bright = m & (L <= lo), m & (L >= hi)
    if dark.sum() < 100 or bright.sum() < 100:
        return float('nan')
    br = lambda sel: float(lin[..., 2][sel].mean() / lin[..., 0][sel].mean())   # 평균의 비(중앙값 비와 차이 < 0.02, 검토에서 확인) — 화소 수가 적은 칸에서 안정
    return br(dark) / br(bright)


def metrics_of(path, y0=0.0, y1=1.0, alpha_path=None, mask_mode='nrbr'):
    rgb, alpha = fm.load_crop(path, y0, y1, 0.0, 1.0, alpha_path)
    L, lin = fm.luminance(rgb)
    interior, mask, sat = interior_mask(rgb, lin, L, alpha, mask_mode)
    out = phys.phys_metrics(rgb, alpha, mask_mode)
    out['nInt'] = int(interior.sum())
    Li = L[interior]
    out['darkObj'] = float((Li < 0.1 * np.median(Li)).mean()) if out['nInt'] else float('nan')
    out['satFrac'] = float((sat & mask).sum() / max(mask.sum(), 1))
    out['shadeBlue'] = shade_blue(lin, L, interior)
    H = L.shape[0]
    top = slice(0, max(1, int(round(H * 0.6))))
    out['shadeBlueTop'] = shade_blue(lin[top], L[top], interior[top])
    return out


def excluded(m):
    """사진 제외 사유(phys2 §2): 비구름 물체 > 2 % · 포화 > 1 %. 없으면 None."""
    if fm.isnum(m.get('darkObj')) and m['darkObj'] > 0.02: return 'darkObj>2%%(%.3f)' % m['darkObj']
    if fm.isnum(m.get('satFrac')) and m['satFrac'] > 0.01: return 'sat>1%%(%.3f)' % m['satFrac']
    return None


def run_photos(root, out):
    rows = []
    for sub, sel, genera in fm.PHOTO_SETS:
        S = json.load(open(os.path.join(root, 'tools/genus-ruler', sub, sel)))
        for g in genera:
            for idx, frac in S[g].items():
                f = os.path.join(root, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                if not os.path.exists(f):
                    continue
                m = metrics_of(f, 0, min(1.0, float(frac)) * 0.97)
                rows.append(dict(genus=g, name='%s/%s' % (g, idx), excluded=excluded(m), **m))
    genera = [g for _, _, gs in fm.PHOTO_SETS for g in gs]
    kept = [r for r in rows if not r['excluded']]
    Q = {g: {k: (phys2.quart_ci([r[k] for r in kept if r['genus'] == g]) or fm.qs([])) for k in KEYS} for g in genera}
    doc = {
        'phys3Sha256': phys3_sha256(), 'physSha256': phys.phys_sha256(), 'phys2Sha256': phys2.phys2_sha256(), 'fmSha256': fm.fm_sha256(),
        'date': datetime.date.today().isoformat(),
        'crop': {'width': fm.W0, 'photoTop': 'selection sky fraction x 0.97', 'mask': 'nrbr interior (+3 px erosion)', 'shade': 'L quantile 0.3 / 0.7 of interior, min 400 / 100 px',
                 'exclude': 'darkObj > 2 % or sat > 1 %', 'ci': 'bootstrap 90 %%, %d draws, seed %d' % (phys2.BOOT_N, phys2.BOOT_SEED), 'toneFactors': list(phys2.FACTORS)},
        'counts': {g: sum(1 for r in rows if r['genus'] == g) for g in genera},
        'excluded': {g: [(r['name'], r['excluded']) for r in rows if r['genus'] == g and r['excluded']] for g in genera},
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('phys3.py sha256', doc['phys3Sha256'])
    print('photos', doc['counts'], 'excluded', {g: len(v) for g, v in doc['excluded'].items()})
    print('%-13s' % 'metric', ' '.join('%-26s' % g for g in genera))
    for k in KEYS:
        cols = []
        for g in genera:
            q = Q[g][k]
            cols.append(('%.3f/%.3f/%.3f n%d' % (q['q25'], q['q50'], q['q75'], q['n'])) if q['n'] else 'nan')
        print('%-13s' % k, ' '.join('%-26s' % c for c in cols))
    print('wrote', out)


def run_renders(d, out, top=0.78, pattern='*.png'):
    files = sorted(f for f in glob.glob(os.path.join(d, pattern)) if not f.endswith('.alpha.png'))
    res = {}
    for f in files:
        name = os.path.basename(f)[:-4]
        cand, _, rest = name.partition('_')
        scene, _, az = rest.rpartition('_')
        a = f[:-4] + '.alpha.png'
        m = metrics_of(f, 0, top, a if os.path.exists(a) else None, 'alpha')
        res.setdefault(cand, {}).setdefault(scene, {})[az] = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in m.items()}
    doc = {'phys3Sha256': phys3_sha256(), 'dir': os.path.abspath(d), 'top': top, 'renders': res}
    json.dump(doc, open(out, 'w'), indent=1)
    print('wrote', out, {c: sum(len(v) for v in s.values()) for c, s in res.items()})


def verdict(passed, nV, nmin):
    return '평가 불가' if nV < nmin else ('통과' if passed else '불합격')


def rc_cells(Q, R, cand, tset):
    """RC 칸 → {(장면, 방위): {'value','reliable','ok','D'} | None}. 톤 배율로 ○/× 가 뒤집히면 reliable = False."""
    cells = {}
    for sc in RC_SCENES:
        g = SCENE_GENUS[sc]
        q = Q['quartiles'].get(g, {}).get('shadeBlue')
        if not q or not q.get('n') or 'ci25' not in q:
            continue
        for az, m in R.get(cand, {}).get(sc, {}).items():
            v = m.get('shadeBlue')
            if not fm.isnum(v) or v <= 0:
                cells[(sc, az)] = None; continue
            lo, hi = phys2.thresholds(q, tset)
            outs = set(bool(lo <= v ** f <= hi) for f in phys2.FACTORS)   # 로그 척도 지표: ln v 에 배율 = v^f
            cells[(sc, az)] = {'value': v, 'reliable': len(outs) == 1, 'ok': (next(iter(outs)) if len(outs) == 1 else None), 'D': phys.logdist(v, q)}
    return cells


def rc_verdict(Q, R, cand, ref):
    per = {}
    for ts in phys2.TSETS:
        a, b, nV, nAll, V = phys2.score_pair(rc_cells(Q, R, cand, ts), rc_cells(Q, R, ref, ts))
        per[ts] = {'cand': a, 'ref': b, 'valid': nV, 'cells': nAll, 'pass': a >= b and (a >= 0.5 * nV if ts == 'nominal' else True)}
    nom = per['nominal']
    if nom['valid'] < RC_MIN_VALID: v = '평가 불가'
    elif all(per[t]['pass'] and per[t]['valid'] >= RC_MIN_VALID for t in phys2.TSETS): v = '통과'
    elif nom['pass']: v = '불확정(문턱 CI)'
    else: v = '불합격'
    # 짝 비교(보고): 같은 칸에서 D 차 < −0.1 개선, > +0.1 악화
    c1, c0 = rc_cells(Q, R, cand, 'nominal'), rc_cells(Q, R, ref, 'nominal')
    better = worse = same = 0; rows = []
    for k in c0:
        if k in c1 and c0[k] and c1[k]:
            d = c1[k]['D'] - c0[k]['D']
            better += d < -0.1; worse += d > 0.1; same += -0.1 <= d <= 0.1
            rows.append({'scene': k[0], 'az': k[1], 'cand': round(c1[k]['value'], 4), 'ref': round(c0[k]['value'], 4), 'dD': round(d, 3), 'reliable': c1[k]['reliable'] and c0[k]['reliable']})
    return {'verdict': v, 'perThreshold': per, 'paired': {'better': better, 'worse': worse, 'same': same}, 'cells': rows}


def run_gate(qfile, rfile, ref, cands, out):
    Q = json.load(open(qfile)); RR = json.load(open(rfile))
    if RR.get('phys3Sha256') != Q.get('phys3Sha256') or Q.get('phys3Sha256') != phys3_sha256():
        print('⚠ phys3.py 해시가 사분위·렌더 json 과 다릅니다 — 규칙 고정 뒤 바뀜')
    R = RR['renders']
    res = {}
    for cand in cands:
        rc = rc_verdict(Q, R, cand, ref)
        ch = {}; bad = []
        for sc in SCENE_GENUS:
            # 같은 방위끼리만(후보에 없는 방위를 기준 평균에 넣으면 방위 차가 면적 차로 보임)
            c1, c0 = R.get(cand, {}).get(sc, {}), R.get(ref, {}).get(sc, {})
            common = [az for az in c1 if az in c0 and fm.isnum(c1[az].get('cloudFrac')) and fm.isnum(c0[az].get('cloudFrac'))]
            f1 = [c1[az]['cloudFrac'] for az in common]; f0 = [c0[az]['cloudFrac'] for az in common]
            if not f1 or not f0 or np.mean(f0) < 0.02:
                continue
            ch[sc] = float(np.mean(f1) / np.mean(f0) - 1)
            if abs(ch[sc]) > 0.25:
                bad.append(sc)
        res[cand] = {'RC': rc, 'G4': {'change': ch, 'failed': bad, 'verdict': '통과' if not bad else '불합격'}}
        print('=== %s vs %s' % (cand, ref))
        print('  RC          %s  ' % rc['verdict'] + ' | '.join('%s 후보 %d·기준 %d(유효 %d/%d)' % (t[:3], x['cand'], x['ref'], x['valid'], x['cells']) for t, x in rc['perThreshold'].items())
              + '  짝 개선 %d·악화 %d·동률 %d' % (rc['paired']['better'], rc['paired']['worse'], rc['paired']['same']))
        print('  G4          %s  %s' % (res[cand]['G4']['verdict'], ' '.join('%s %+.0f%%' % (sc, 100 * v) for sc, v in sorted(ch.items()))))
    json.dump({'phys3Sha256': phys3_sha256(), 'ref': ref, 'results': res}, open(out, 'w'), indent=1)
    print('wrote', out)


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == '--photos':
        root = a[a.index('--root') + 1] if '--root' in a else os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
        out = a[a.index('--out') + 1] if '--out' in a else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phys3-photo-quartiles.json')
        run_photos(root, out)
    elif a and a[0] == '--gate':
        ref = a[a.index('--ref') + 1] if '--ref' in a else 'L0'
        cands = (a[a.index('--cands') + 1] if '--cands' in a else 'L1,L2,L3').split(',')
        out = a[a.index('--out') + 1] if '--out' in a else 'phys3-gate.json'
        run_gate(a[1], a[2], ref, cands, out)
    elif a and a[0] == '--renders':
        out = a[a.index('--out') + 1] if '--out' in a else 'phys3-renders.json'
        pat = a[a.index('--glob') + 1] if '--glob' in a else '*.png'
        top = float(a[a.index('--top') + 1]) if '--top' in a else 0.78
        run_renders(a[1], out, top, pat)
    else:
        print(__doc__)
