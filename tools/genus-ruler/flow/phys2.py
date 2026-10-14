#!/usr/bin/env python3
"""
RULER-physics2(§137) 지표·판정 — 알갱이(grain)와 구조(structure)를 가른 구름 안 밝기, 해 둘레 무리 이득, 조명 진단. numpy + PIL 만 씁니다.

fm.py(그림 읽기·마스크·상자 평균)·phys.py(밝기비·조각 간 밝기 차·사분위)를 **그대로** 가져다 씁니다 — 둘은 고치지 않습니다(사진 사분위가 각자 해시에 묶임).
이 파일의 수학·판정 규칙을 고치면 phys2-photo-quartiles.json 의 phys2Sha256 이 맞지 않으므로 사진 사분위를 다시 재야 하고, 렌더 뒤에는 고치지 않습니다.

── 지표(구름 안쪽 interior, 포화 화소 제외) ──
  로그 휘도 logL 을 세 성분으로 가릅니다(폭 320 화소 그림):
    coarse = box_blur(logL, R_SMALL=2)        5 화소 창 — 이보다 작은 무늬 = 알갱이
    large  = 마스크 정규화 box_blur(logL, R_LARGE=16)   33 화소 창 — 화면 전체 밝기 기울기·프레이밍(구조가 아님)
    mid    = coarse − large                     5~33 화소 대역 = 구름 얼룩(구조)
    fine   = logL − coarse                      알갱이
  structMid     std(mid)            대역통과 구조량 — 0 에 가까우면 "무늬 없는 판". (§137 검토: 처음 정의 coarse 의 분산 86~99% 가 기울기였음)
  grainSD       std(fine)           화소 단위 잡음량
  grainShareMid grainSD² / (grainSD² + structMid²)   노출·톤 곡선 기울기에 무관(로그 척도 배율이 약분됨)
  interior: 렌더는 알파 ≥ 0.9(반투명 가장자리 림 제외)이고 5×5 창이 전부 구름 안, 사진은 NRBR 마스크를 3 화소 더 깎음. nInt < 400 이면 모두 NaN.
  사진 제외 규칙(렌더 전 동결): interior 에서 0.1 × 중앙값보다 어두운 화소 > 2 % 이거나(비구름 물체 — 1 % 는 층적운·난층운의 진짜 어두운 영역까지 걸러 완화함) 포화 화소가 구름 마스크의 1 % 초과면 제외, 사유를 json 에 기록.
  사분위의 부트스트랩 90 % 신뢰구간(4000 회, 고정 씨앗)도 json 에 기록 — 판정 칸의 신뢰도 필터에 씀.

── 해 둘레 무리 이득 haloGain ──
  시선 = 해 중심. 해에서의 각 θ = atan(r/f)(f = (H/2)/tan(세로시야/2)), 위쪽 부채꼴(연직 위에서 ±50°, 22°·바깥 날개가 화면에 다 들어오는 구역)의 구름(알파 ≥ 0.15) 화소 휘도의 0.25° 칸 평균 프로파일을
  15.5~21.0° ∪ 24.0~28.0° 에서 2 차식으로 맞춰 21.7~23.0° 창에 외삽한 매끈한 기준선과 견줍니다: haloGain = 실제 / 기준선 − 1. 칸마다 화소 30 개 미만이면 빠짐, 맞춤 칸 12 개·링 칸 4 개 미만이면 NaN.

쓰는 법:
  phys2.py --photos [--root REPO] [--out phys2-photo-quartiles.json]
  phys2.py --renders DIR [--out phys2-renders.json] [--top 0.78] [--glob '*.png'] [--width 320]
  phys2.py --gate Q2.json R.json [--ref P0] [--cands P1,P2] [--out gate.json]    R1·R2·R3c·G4 (칸 단위, 유효 칸 규칙)
  phys2.py --halo DIR [--fov 60]                                                  halo 장면(<후보>_<장면>_0.png) 이득 표와 HA·H·대조 판정
  phys2.py --diag R.json                                                          D1 조명 진단 표(설명 몫 f)
"""
import sys, os, json, math, glob, hashlib, datetime
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm      # noqa: E402
import phys    # noqa: E402

R_SMALL = 2
R_LARGE = 16
PHOTO_ERODE_EXTRA = 3
MIN_INT = 400
DARK_OBJ_MAX = 0.02      # 사진 제외: interior 의 0.1×중앙값 미만 화소 비율 상한
SAT_MAX = 0.01           # 사진 제외: 구름 마스크의 포화 화소 비율 상한
KEYS = ['structMid', 'grainSD', 'grainShareMid', 'nInt']
FACTORS = (0.85, 1.0, 1.2)       # 톤 곡선 기울기 민감도: 로그 척도 지표(structMid·grainSD)에 곱하는 배율
BOOT_N = 4000
BOOT_SEED = 20261014


def phys2_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


# ───────── 지표 ─────────
def struct_metrics(rgb, alpha, mask_mode, erode_extra=0):
    L, lin = fm.luminance(rgb)
    logL = np.log(np.maximum(L, 1e-5))
    if mask_mode == 'alpha9':
        mask, all_cloud = (alpha >= 0.9), False
    else:
        mask, all_cloud = fm.cloud_mask(rgb, lin, L, alpha, mask_mode)
    sat = (rgb[..., 0] >= 250) & (rgb[..., 1] >= 250) & (rgb[..., 2] >= 250)
    ok = mask & ~sat
    interior = fm.box_blur(ok.astype(np.float64), R_SMALL + erode_extra) > 0.999
    nan = float('nan')
    out = {'structMid': nan, 'grainSD': nan, 'grainShareMid': nan, 'nInt': int(interior.sum()), 'darkObj': nan, 'satFrac': float((sat & mask).sum() / max(mask.sum(), 1))}
    if out['nInt'] < MIN_INT:
        return out
    coarse = fm.box_blur(logL, R_SMALL)
    num = fm.box_blur(np.where(ok, logL, 0.0), R_LARGE)
    den = fm.box_blur(ok.astype(np.float64), R_LARGE)
    large = num / np.maximum(den, 1e-6)
    mid = (coarse - large)[interior]
    fine = (logL - coarse)[interior]
    sm, sf = float(mid.std()), float(fine.std())
    out['structMid'], out['grainSD'] = sm, sf
    out['grainShareMid'] = sf * sf / max(sf * sf + sm * sm, 1e-12)
    Li = L[interior]
    out['darkObj'] = float((Li < 0.1 * np.median(Li)).mean())
    return out


def all_metrics2(path, y0, y1, alpha_path):
    rgb, alpha = fm.load_crop(path, y0, y1, 0.0, 1.0, alpha_path)
    m = struct_metrics(rgb, alpha, 'alpha9', 0)
    m.update({k: v for k, v in phys.phys_metrics(rgb, alpha, 'alpha').items() if k in ('cloudFrac', 'brightRatio', 'darkRatio', 'pieceLogSD', 'pieceN')})
    return m


def quart_ci(a):
    a = np.array([v for v in a if fm.isnum(v)], float)
    if len(a) < 4:
        return None
    rng = np.random.default_rng(BOOT_SEED)
    idx = rng.integers(0, len(a), size=(BOOT_N, len(a)))
    s = a[idx]
    q25 = np.quantile(s, 0.25, axis=1); q75 = np.quantile(s, 0.75, axis=1)
    out = {'q25': float(np.quantile(a, .25)), 'q50': float(np.quantile(a, .5)), 'q75': float(np.quantile(a, .75)), 'n': int(len(a)),
           'ci25': [float(np.quantile(q25, .05)), float(np.quantile(q25, .95))], 'ci75': [float(np.quantile(q75, .05)), float(np.quantile(q75, .95))]}
    return out


# ───────── --photos ─────────
def run_photos(root, out):
    rows, excluded = [], {}
    for sub, sel, genera in fm.PHOTO_SETS:
        S = json.load(open(os.path.join(root, 'tools/genus-ruler', sub, sel)))
        for g in genera:
            for idx, frac in S[g].items():
                f = os.path.join(root, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                if not os.path.exists(f):
                    continue
                rgb, alpha = fm.load_crop(f, 0, min(1.0, float(frac)) * 0.97, 0.0, 1.0, None)
                m = struct_metrics(rgb, alpha, 'nrbr', PHOTO_ERODE_EXTRA)
                row = dict(genus=g, name='%s/%s' % (g, idx), **m)
                why = []
                if fm.isnum(m['darkObj']) and m['darkObj'] > DARK_OBJ_MAX: why.append('darkObj %.3f' % m['darkObj'])
                if m['satFrac'] > SAT_MAX: why.append('sat %.3f' % m['satFrac'])
                row['excluded'] = '; '.join(why) or None
                if why: excluded.setdefault(g, []).append('%s: %s' % (row['name'], row['excluded']))
                rows.append(row)
    genera = [g for _, _, gs in fm.PHOTO_SETS for g in gs]
    Q = {g: {k: quart_ci([x[k] for x in rows if x['genus'] == g and not x['excluded']]) for k in KEYS if k != 'nInt'} for g in genera}
    doc = {
        'phys2Sha256': phys2_sha256(), 'fmSha256': fm.fm_sha256(), 'physSha256': phys.phys_sha256(), 'date': datetime.date.today().isoformat(),
        'params': {'width': fm.W0, 'rSmall': R_SMALL, 'rLarge': R_LARGE, 'photoErodeExtra': PHOTO_ERODE_EXTRA, 'minInterior': MIN_INT, 'bootN': BOOT_N, 'bootSeed': BOOT_SEED,
                   'photoTop': 'selection sky fraction x 0.97', 'photoMask': 'nrbr', 'renderInterior': 'alpha>=0.9', 'exclude': 'darkObj>%.2f or satFrac>%.2f' % (DARK_OBJ_MAX, SAT_MAX)},
        'counts': {g: sum(1 for x in rows if x['genus'] == g) for g in genera},
        'countsUsed': {g: sum(1 for x in rows if x['genus'] == g and not x['excluded']) for g in genera},
        'excluded': excluded,
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in x.items()} for x in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('phys2.py sha256', doc['phys2Sha256'])
    print('photos', doc['counts'], 'used', doc['countsUsed'])
    print('%-14s' % 'metric', ' '.join('%-26s' % g for g in genera))
    for k in ('structMid', 'grainSD', 'grainShareMid'):
        cols = []
        for g in genera:
            q = Q[g][k]
            cols.append(('%.3f/%.3f/%.3f n%d' % (q['q25'], q['q50'], q['q75'], q['n'])) if q else 'nan')
        print('%-14s' % k, ' '.join('%-26s' % c for c in cols))
    print('excluded:', {g: len(v) for g, v in excluded.items()})
    print('wrote', out)


# ───────── --renders ─────────
def run_renders(d, out, top, pattern, width):
    old = fm.W0
    fm.W0 = width
    try:
        files = sorted(f for f in glob.glob(os.path.join(d, pattern)) if not f.endswith('.alpha.png'))
        res = {}
        for f in files:
            name = os.path.basename(f)[:-4]
            parts = name.split('_')
            if len(parts) < 3:
                continue
            cand, scene, az = parts[0], '_'.join(parts[1:-1]), parts[-1]
            ap = f[:-4] + '.alpha.png'
            if not os.path.exists(ap):
                continue
            res.setdefault(cand, {}).setdefault(scene, {'genus': fm.scene_genus(scene), 'az': {}})['az'][az] = all_metrics2(f, 0, top, ap)
    finally:
        fm.W0 = old
    json.dump({'phys2Sha256': phys2_sha256(), 'dir': os.path.abspath(d), 'top': top, 'width': width, 'mask': 'struct: alpha>=0.9 interior; ratios: alpha>=0.15',
               'renders': res}, open(out, 'w'), indent=1)
    print('wrote', out, {c: sum(len(s['az']) for s in v.values()) for c, v in res.items()}, 'width', width)


# ───────── 판정(칸 단위) ─────────
GENUS_OF = {'st': 'St', 'as': 'As', 'ns': 'Ns', 'sc85': 'StSc'}
TSETS = ('nominal', 'liberal', 'conservative')


def thresholds(q, tset):
    """문턱 세 벌: 기본 = 사진 사분위, 넓게 = [q25 CI 하한, q75 CI 상한], 좁게 = [q25 CI 상한, q75 CI 하한](부트스트랩 90 %)."""
    if tset == 'nominal': return q['q25'], q['q75']
    if tset == 'liberal': return q['ci25'][0], q['ci75'][1]
    return q['ci25'][1], q['ci75'][0]


def tone_outcomes(kind, v, lo, hi, scaled):
    """한 칸의 ○/× 가 톤 곡선 기울기(로그 척도 지표에 곱하는 배율 0.85~1.2)에 흔들리는지. 돌려줌: 가능한 결과 집합(원소 하나면 신뢰할 수 있음)."""
    outs = set()
    for f in (FACTORS if scaled else (1.0,)):
        x = v * f
        outs.add(bool(lo <= x <= hi) if kind == 'two' else bool(x <= hi))
    return outs


def struct_cells(Q2, R, cand, metric, kind, scaled, tset, scenes=('st', 'as', 'ns', 'sc85')):
    cells = {}
    for sc in scenes:
        if sc not in R.get(cand, {}): continue
        q = Q2['quartiles'].get(GENUS_OF[sc], {}).get(metric)
        for az, m in R[cand][sc]['az'].items():
            v = m.get(metric)
            if q is None or not fm.isnum(v):
                cells[(sc, az)] = None; continue
            lo, hi = thresholds(q, tset)
            o = tone_outcomes(kind, v, lo, hi, scaled)
            cells[(sc, az)] = {'value': v, 'reliable': len(o) == 1, 'ok': (next(iter(o)) if len(o) == 1 else None)}
    return cells


def score_pair(c1, c0):
    """후보·기준 모두 유한하고 신뢰할 수 있는 칸 V 위의 (후보 ○ 수, 기준 ○ 수, |V|, 전체 칸 수)."""
    keys = [k for k in c0 if k in c1]
    V = [k for k in keys if c0[k] and c1[k] and c0[k]['reliable'] and c1[k]['reliable']]
    return sum(1 for k in V if c1[k]['ok']), sum(1 for k in V if c0[k]['ok']), len(V), len(keys), V


def robust_verdict(Q2, R, cand, ref, metric, kind, scaled, need_half, nmin):
    """세 문턱 벌에서 모두 통과해야 '통과', 기본에서만 통과면 '불확정', 유효 칸이 nmin 미만이면 '평가 불가'."""
    per = {}
    for ts in TSETS:
        a, b, nV, nAll, V = score_pair(struct_cells(Q2, R, cand, metric, kind, scaled, ts), struct_cells(Q2, R, ref, metric, kind, scaled, ts))
        per[ts] = {'cand': a, 'ref': b, 'valid': nV, 'cells': nAll, 'pass': a >= b and (a >= 0.5 * nV if need_half else True)}
    nom = per['nominal']
    if nom['valid'] < nmin: v = '평가 불가'
    elif all(per[t]['pass'] and per[t]['valid'] >= nmin for t in TSETS): v = '통과'
    elif nom['pass']: v = '불확정(문턱 CI)'
    else: v = '불합격'
    return {'verdict': v, 'perThreshold': per}


def verdict(passed, nV, nmin):
    return '평가 불가' if nV < nmin else ('통과' if passed else '불합격')


def run_gate(q2file, rfile, ref, cands, out):
    Q2 = json.load(open(q2file)); Q1 = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phys-photo-quartiles.json')))['quartiles']
    R = json.load(open(rfile))['renders']
    rep = {}
    for cand in cands:
        r = {}
        # R3c-struct: structMid ∈ [q25, q75] (양측), 톤 곡선 배율 필터 + 문턱 세 벌(기본·넓게·좁게)
        r['R3c_struct'] = robust_verdict(Q2, R, cand, ref, 'structMid', 'two', True, True, 6)
        # R3c-grain: grainShareMid ≤ q75 (단측, 톤 곡선 무관) — 기준보다 나빠지지 않을 것
        r['R3c_grain'] = robust_verdict(Q2, R, cand, ref, 'grainShareMid', 'le75', False, False, 6)
        # R1: 밝기비·어두움비 [q25, q75], 칸 = (장면, 방위, 지표); D = |ln(v/q50)| / ln(q75/q25) 평균
        cells1, cells0, D1, D0 = {}, {}, [], []
        for sc in ('cu', 'ac', 'ci', 'sc25', 'sc85'):
            g = phys.fm.scene_genus(sc)
            for met in ('brightRatio', 'darkRatio'):
                q = Q1.get(g, {}).get(met)
                for az in R.get(cand, {}).get(sc, {}).get('az', {}):
                    v1 = R[cand][sc]['az'][az].get(met); v0 = R.get(ref, {}).get(sc, {}).get('az', {}).get(az, {}).get(met)
                    if q and fm.isnum(v1) and fm.isnum(v0):
                        cells1[(sc, az, met)] = q['q25'] <= v1 <= q['q75']; cells0[(sc, az, met)] = q['q25'] <= v0 <= q['q75']
                        D1.append(phys.logdist(v1, q)); D0.append(phys.logdist(v0, q))
        nV = len(cells1); a = sum(cells1.values()); b = sum(cells0.values())
        d1 = float(np.mean(D1)) if D1 else float('nan'); d0 = float(np.mean(D0)) if D0 else float('nan')
        r['R1'] = {'cand': a, 'ref': b, 'valid': nV, 'Dcand': d1, 'Dref': d0, 'verdict': verdict(a >= b and d1 <= 0.85 * d0 and a >= 0.5 * nV, nV, 18)}
        # R2: pieceLogSD ≥ q25 (StSc 규칙은 phys.py 와 같음), 칸 = (장면, 방위), 조각 4 개 이상(NaN 아님)인 칸만
        a = b = nV = 0
        for sc in ('cu', 'ac', 'ci', 'sc25'):
            q = Q1.get(phys.fm.scene_genus(sc), {}).get('pieceLogSD')
            for az in R.get(cand, {}).get(sc, {}).get('az', {}):
                v1 = R[cand][sc]['az'][az].get('pieceLogSD'); v0 = R.get(ref, {}).get(sc, {}).get('az', {}).get(az, {}).get('pieceLogSD')
                if q and fm.isnum(v1) and fm.isnum(v0):
                    nV += 1; a += v1 >= q['q25']; b += v0 >= q['q25']
        r['R2'] = {'cand': int(a), 'ref': int(b), 'valid': nV, 'verdict': verdict(a >= b, nV, 4)}
        # G4: 장면별 방위 평균 cloudFrac 상대 변화 |Δ| ≤ 25 % (기준 면적 ≥ 0.02 인 장면만)
        bad, ch = [], {}
        for sc, s0 in R.get(ref, {}).items():
            if sc not in R.get(cand, {}): continue
            f0 = [m['cloudFrac'] for m in s0['az'].values() if fm.isnum(m.get('cloudFrac'))]
            f1 = [m['cloudFrac'] for m in R[cand][sc]['az'].values() if fm.isnum(m.get('cloudFrac'))]
            if not f0 or not f1 or np.mean(f0) < 0.02: continue
            ch[sc] = float(np.mean(f1) / np.mean(f0) - 1)
            if abs(ch[sc]) > 0.25: bad.append(sc)
        r['G4'] = {'change': ch, 'failed': bad, 'verdict': '통과' if not bad else '불합격'}
        rep[cand] = r
    for cand, r in rep.items():
        print('=== %s vs %s' % (cand, ref))
        for k in ('R1', 'R2'):
            x = r[k]
            extra = '  D %.2f vs %.2f' % (x['Dcand'], x['Dref']) if k == 'R1' else ''
            print('  %-11s %s  후보 %d · 기준 %d (유효 %d)%s' % (k, x['verdict'], x['cand'], x['ref'], x['valid'], extra))
        for k in ('R3c_struct', 'R3c_grain'):
            x = r[k]
            print('  %-11s %s  ' % (k, x['verdict']) + ' | '.join('%s 후보 %d·기준 %d(유효 %d/%d)' % (t[:3], v['cand'], v['ref'], v['valid'], v['cells']) for t, v in x['perThreshold'].items()))
        print('  G4          %s  %s' % (r['G4']['verdict'], ' '.join('%s %+.0f%%' % (sc, 100 * v) for sc, v in sorted(r['G4']['change'].items()))))
    if out:
        json.dump({'phys2Sha256': phys2_sha256(), 'quartiles': os.path.abspath(q2file), 'renders': os.path.abspath(rfile), 'ref': ref, 'report': rep}, open(out, 'w'), indent=1, default=lambda o: None)
        print('wrote', out)


# ───────── 해 둘레 무리 이득 ─────────
def halo_gain(path, alpha_path, fov=60.0, sector_half=50.0):
    from PIL import Image
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    al = np.asarray(Image.open(alpha_path).convert('L')).astype(np.float64) / 255.0
    lin = fm.srgb_to_lin(a)
    L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    H, W = L.shape
    f = (H / 2) / math.tan(math.radians(fov / 2))
    yy, xx = np.mgrid[0:H, 0:W]
    dx, dy = xx + 0.5 - W / 2, yy + 0.5 - H / 2
    th = np.degrees(np.arctan(np.hypot(dx, dy) / f))
    phi = np.degrees(np.arctan2(dx, -dy))
    m = (np.abs(phi) <= sector_half) & (al >= 0.15)
    edges = np.arange(15.0, 28.75, 0.25); cen = (edges[:-1] + edges[1:]) / 2
    prof = np.array([L[m & (th >= lo) & (th < hi)].mean() if (m & (th >= lo) & (th < hi)).sum() >= 30 else np.nan for lo, hi in zip(edges[:-1], edges[1:])])
    fitm = (((cen >= 15.5) & (cen <= 21.0)) | ((cen >= 24.0) & (cen <= 28.0))) & np.isfinite(prof)
    ring = (cen >= 21.7) & (cen <= 23.0) & np.isfinite(prof)
    if fitm.sum() < 12 or ring.sum() < 4:
        return {'gain': float('nan'), 'nFit': int(fitm.sum()), 'nRing': int(ring.sum())}
    coef = np.polyfit(cen[fitm], prof[fitm], 2)
    return {'gain': float(prof[ring].mean() / np.polyval(coef, cen[ring]).mean() - 1), 'nFit': int(fitm.sum()), 'nRing': int(ring.sum())}


def run_halo(d, fov):
    scenes = ['hcsH', 'hcsL', 'hciH', 'hciL']
    cands = sorted({os.path.basename(f).split('_')[0] for f in glob.glob(os.path.join(d, '*_h[cs][si][HL]_0.png')) if not f.endswith('.alpha.png')})
    G = {}
    for c in cands:
        for s in scenes:
            f = os.path.join(d, '%s_%s_0.png' % (c, s))
            if os.path.exists(f) and os.path.exists(f[:-4] + '.alpha.png'):
                G.setdefault(c, {})[s] = halo_gain(f, f[:-4] + '.alpha.png', fov)['gain']
    print('haloGain (위쪽 부채꼴 ±50°, 기준선 대비)  ' + '  '.join('%-7s' % s for s in scenes))
    for c, g in G.items():
        print('  %-4s ' % c + '  '.join('%+.4f ' % g.get(s, float('nan')) for s in scenes))
    ok = lambda v, lo: fm.isnum(v) and v >= lo
    near0 = lambda v: fm.isnum(v) and abs(v) <= 0.01
    rep = {}
    for c in ('H1', 'P2'):
        if c not in G: continue
        g = G[c]
        rep[c] = {'cs>=0.02': ok(g.get('hcsH'), 0.02) and ok(g.get('hcsL'), 0.02), 'ci>=0.02': ok(g.get('hciH'), 0.02) and ok(g.get('hciL'), 0.02)}
    ctrl = {c: all(near0(G[c].get(s)) or not fm.isnum(G[c].get(s)) for s in scenes) for c in ('P0', 'P1', 'H2') if c in G}
    print('판정: H(P2, 채움 ≥ 0.02 cs 두 장면) / HA(H1, cs·ci 네 장면 ≥ 0.02): ', {c: r for c, r in rep.items()})
    print('대조(|gain| ≤ 0.01, NaN 은 빠짐):', ctrl)
    return G


# ───────── D1 조명 진단 ─────────
def run_diag(rfile):
    Q1 = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phys-photo-quartiles.json')))['quartiles']
    R = json.load(open(rfile))['renders']
    ARMS = {'F': 'floors [0,0]', 'K': 'skyLightScale 0', 'G': 'groundBounceScale 0', 'T': 'thru 0'}
    AO = {'cu': 1.5, 'sc25': 3.5, 'sc85': 3.5, 'ac': 0.0}
    print('D1: 어두움비 사진 거리 D(=|ln(v/q50)|/ln(q75/q25)), 방위 290. 유효 칸 = 바닥 기준 D ≥ 0.5(사진 사분위 밖); F 팔은 ao > 0 종류만.')
    rep = {}
    for b in ('0', '1'):
        base = 'P' + b
        print(' 기준 %s (P0 = 물리 끔, P1 = 물리 켬)' % base)
        for arm, desc in ARMS.items():
            fs, rows = [], []
            for sc in ('cu', 'sc25', 'sc85', 'ac'):
                q = Q1.get(phys.fm.scene_genus(sc), {}).get('darkRatio')
                v0 = R.get(base, {}).get(sc, {}).get('az', {}).get('290', {}).get('darkRatio'); v1 = R.get(arm + b, {}).get(sc, {}).get('az', {}).get('290', {}).get('darkRatio')
                if not q or not fm.isnum(v0) or not fm.isnum(v1): continue
                d0, d1 = phys.logdist(v0, q), phys.logdist(v1, q)
                valid = d0 >= 0.5 and (arm != 'F' or AO[sc] > 0)
                f = (d0 - d1) / d0 if d0 > 0 else float('nan')
                rows.append('%s %.2f→%.2f%s' % (sc, v0, v1, '' if valid else '(무효)'))
                if valid: fs.append(f)
            med = float(np.median(fs)) if fs else float('nan')
            read = '평가 불가(유효 칸 < 3)' if len(fs) < 3 else ('주된 제한(f ≥ 0.5)' if med >= 0.5 else ('부분(0.2 ≤ f < 0.5)' if med >= 0.2 else '제한 아님(f < 0.2)'))
            print('   %s %-20s f 중앙 %+.2f (유효 %d)  %s   | %s' % (arm, desc, med, len(fs), read, '  '.join(rows)))
            rep[base + arm] = {'f_median': med, 'valid': len(fs), 'reading': read}
    return rep


def main(argv):
    def opt(name, default=None):
        if name in argv:
            i = argv.index(name); v = argv[i + 1]; del argv[i:i + 2]; return v
        return default
    here = os.path.dirname(os.path.abspath(__file__))
    if '--photos' in argv:
        argv.remove('--photos')
        return run_photos(opt('--root', os.path.abspath(os.path.join(here, '../../..'))), opt('--out', os.path.join(here, 'phys2-photo-quartiles.json')))
    if '--renders' in argv:
        i = argv.index('--renders'); d = argv[i + 1]; del argv[i:i + 2]
        return run_renders(d, opt('--out', os.path.join(d, 'phys2-renders.json')), float(opt('--top', '0.78')), opt('--glob', '*.png'), int(opt('--width', '320')))
    if '--gate' in argv:
        i = argv.index('--gate'); q, r = argv[i + 1], argv[i + 2]; del argv[i:i + 3]
        return run_gate(q, r, opt('--ref', 'P0'), opt('--cands', 'P1,P2').split(','), opt('--out'))
    if '--halo' in argv:
        i = argv.index('--halo'); d = argv[i + 1]; del argv[i:i + 2]
        return run_halo(d, float(opt('--fov', '60')))
    if '--diag' in argv:
        i = argv.index('--diag'); r = argv[i + 1]; del argv[i:i + 2]
        return run_diag(r)
    print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
