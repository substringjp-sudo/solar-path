#!/usr/bin/env python3
"""
RULER-physics2(§137) 지표 — 알갱이(grain)와 구조(structure)를 가른 구름 안 밝기 지표. numpy + PIL 만 씁니다.

§136 의 흐린 하늘 밀도 군(R3)은 구름 안 밝기 퍼짐·어두운 비율을 화소 단위로 세어, 렌더의 알갱이 잡음(1~2 화소의 반짝이·어두운 점)을 "밀도 변화"로 셌습니다
(육안으로 나아진 고층운이 지표로는 나빠짐). 여기서는 로그 휘도를 (2R+1)² 상자 평균으로 거른 **굵은 성분(coarse)** 과 나머지 **잔 성분(fine)** 으로 가릅니다:

  coarse = box_blur(logL, R)           R = 2 → 5 화소 창(폭 320 화소 그림의 1.6 %, 이보다 작은 무늬는 알갱이로 취급)
  fine   = logL − coarse
  interior = 구름 마스크에서 포화(R·G·B ≥ 250) 화소를 빼고 R 만큼 깎은 안쪽(상자 창이 전부 구름 안인 화소)

  structSD   interior 의 coarse 표준편차 — 알갱이를 걷어낸 구름 안 밝기 얼룩(0 에 가까우면 "무늬 없는 판")
  grainSD    interior 의 fine 표준편차 — 화소 단위 잡음 양
  grainShare grainSD² / (grainSD² + structSD²) — 분산 가운데 알갱이 몫(노출에 무관)
  coarseDark exp(coarse) < 0.5 · 중앙값 인 interior 화소 비율 — 굵은 규모의 어두운 부분
  coarseRange exp(coarse) 의 p10 / p90
  coarseIQR  coarse 의 사분위 범위(로그)
  nInt       interior 화소 수(400 미만이면 모두 NaN)

fm.py 의 그림 읽기·마스크·상자 평균을 그대로 가져다 씁니다(fm.py·phys.py 는 고치지 않음 — 사진 사분위가 각자의 해시에 묶여 있음).
이 파일의 수학을 고치면 phys2-photo-quartiles.json 의 phys2Sha256 이 맞지 않으므로 사진 사분위를 다시 재야 합니다.

쓰는 법:
  phys2.py --photos [--root REPO] [--out phys2-photo-quartiles.json] [--r 2]
  phys2.py --renders DIR [--out phys2-renders.json] [--top 0.78] [--glob '*.png'] [--r 2]
"""
import sys, os, json, glob, hashlib, datetime
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm      # noqa: E402  (load_crop · luminance · cloud_mask · box_blur · PHOTO_SETS · scene_genus · isnum · qs)
import phys    # noqa: E402  (phys_metrics: brightRatio · darkRatio · pieceLogSD — 렌더 R1 재사용)

R_DEFAULT = 2
MIN_INT = 400
KEYS = ['structSD', 'grainSD', 'grainShare', 'coarseDark', 'coarseRange', 'coarseIQR', 'nInt']


def phys2_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


def struct_metrics(rgb, alpha, mask_mode, r=R_DEFAULT):
    L, lin = fm.luminance(rgb)
    logL = np.log(np.maximum(L, 1e-5))
    mask, all_cloud = fm.cloud_mask(rgb, lin, L, alpha, mask_mode)
    sat = (rgb[..., 0] >= 250) & (rgb[..., 1] >= 250) & (rgb[..., 2] >= 250)
    ok = mask & ~sat
    interior = fm.box_blur(ok.astype(np.float64), r) > 0.999
    nan = float('nan')
    out = {k: nan for k in KEYS}
    out['nInt'] = int(interior.sum())
    if out['nInt'] < MIN_INT:
        return out
    coarse = fm.box_blur(logL, r)
    fine = logL - coarse
    c, f = coarse[interior], fine[interior]
    sc, sf = float(c.std()), float(f.std())
    out['structSD'], out['grainSD'] = sc, sf
    out['grainShare'] = sf * sf / max(sf * sf + sc * sc, 1e-12)
    lc = np.exp(c)
    med = float(np.median(lc))
    out['coarseDark'] = float((lc < 0.5 * med).mean())
    out['coarseRange'] = float(np.quantile(lc, 0.1) / max(np.quantile(lc, 0.9), 1e-9))
    out['coarseIQR'] = float(np.quantile(c, 0.75) - np.quantile(c, 0.25))
    return out


def all_metrics2(path, y0=0.0, y1=1.0, alpha_path=None, mask_mode='nrbr', r=R_DEFAULT):
    rgb, alpha = fm.load_crop(path, y0, y1, 0.0, 1.0, alpha_path)
    m = struct_metrics(rgb, alpha, mask_mode, r)
    m.update({k: v for k, v in phys.phys_metrics(rgb, alpha, mask_mode).items() if k in ('cloudFrac', 'brightRatio', 'darkRatio', 'pieceLogSD', 'pieceN')})
    return m


# ───────── --photos ─────────
def run_photos(root, out, r):
    rows = []
    for sub, sel, genera in fm.PHOTO_SETS:
        S = json.load(open(os.path.join(root, 'tools/genus-ruler', sub, sel)))
        for g in genera:
            for idx, frac in S[g].items():
                f = os.path.join(root, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                if not os.path.exists(f):
                    continue
                rgb, alpha = fm.load_crop(f, 0, min(1.0, float(frac)) * 0.97, 0.0, 1.0, None)
                rows.append(dict(genus=g, name='%s/%s' % (g, idx), **struct_metrics(rgb, alpha, 'nrbr', r)))
    genera = [g for _, _, gs in fm.PHOTO_SETS for g in gs]
    Q = {g: {k: fm.qs([x[k] for x in rows if x['genus'] == g]) for k in KEYS} for g in genera}
    doc = {
        'phys2Sha256': phys2_sha256(), 'fmSha256': fm.fm_sha256(), 'physSha256': phys.phys_sha256(), 'date': datetime.date.today().isoformat(),
        'crop': {'width': fm.W0, 'photoTop': 'selection sky fraction x 0.97', 'mask': 'nrbr', 'blurRadius': r, 'minInterior': MIN_INT},
        'counts': {g: sum(1 for x in rows if x['genus'] == g) for g in genera},
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in x.items()} for x in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('phys2.py sha256', doc['phys2Sha256'], ' blur radius', r)
    print('photos', doc['counts'])
    print('%-12s' % 'metric', ' '.join('%-24s' % g for g in genera))
    for k in KEYS:
        cols = []
        for g in genera:
            q = Q[g][k]
            cols.append(('%.3f/%.3f/%.3f n%d' % (q['q25'], q['q50'], q['q75'], q['n'])) if q['n'] else 'nan')
        print('%-12s' % k, ' '.join('%-24s' % c for c in cols))
    print('wrote', out)


# ───────── --renders ─────────
def run_renders(d, out, top, pattern, r):
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
        m = all_metrics2(f, 0, top, ap, 'alpha', r)
        res.setdefault(cand, {}).setdefault(scene, {'genus': fm.scene_genus(scene), 'az': {}})['az'][az] = m
    allk = KEYS + ['cloudFrac', 'brightRatio', 'darkRatio', 'pieceLogSD', 'pieceN']
    for cand in res:
        for scene, s in res[cand].items():
            s['median'] = {k: (float(np.nanmedian([m[k] for m in s['az'].values() if fm.isnum(m.get(k))]))
                               if any(fm.isnum(m.get(k)) for m in s['az'].values()) else float('nan')) for k in allk}
    json.dump({'phys2Sha256': phys2_sha256(), 'dir': os.path.abspath(d), 'top': top, 'mask': 'alpha>=0.15', 'blurRadius': r,
               'statistic': 'nanmedian over azimuths', 'renders': res}, open(out, 'w'), indent=1)
    print('wrote', out, {c: len(v) for c, v in res.items()})


def main(argv):
    def opt(name, default=None):
        if name in argv:
            i = argv.index(name); v = argv[i + 1]; del argv[i:i + 2]; return v
        return default
    here = os.path.dirname(os.path.abspath(__file__))
    r = int(opt('--r', str(R_DEFAULT)))
    if '--photos' in argv:
        argv.remove('--photos')
        root = opt('--root', os.path.abspath(os.path.join(here, '../../..')))
        return run_photos(root, opt('--out', os.path.join(here, 'phys2-photo-quartiles.json')), r)
    if '--renders' in argv:
        i = argv.index('--renders'); d = argv[i + 1]; del argv[i:i + 2]
        return run_renders(d, opt('--out', os.path.join(d, 'phys2-renders.json')), float(opt('--top', '0.78')), opt('--glob', '*.png'), r)
    print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
