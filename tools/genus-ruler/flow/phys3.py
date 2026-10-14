#!/usr/bin/env python3
"""
phys3.py — RULER-physics3(§138) 지표: 구름 그늘의 **푸름**(화이트밸런스에 무관) + phys.py 의 밝기비·어두움비를 그대로.

fm.py(그림 읽기·마스크)·phys.py(밝기비·어두움비)를 **그대로** 가져다 씁니다 — 둘 다 고치지 않습니다.

  shadeBlue   (B/R)_그늘 ÷ (B/R)_밝은 곳.  구름 안 휘도 하위 30 % 화소의 평균 B/R 을 상위 30 % 의 평균 B/R 로 나눔(선형 RGB).
              카메라 화이트밸런스는 채널별 이득이라 비율에서 지워집니다 — 사진과 렌더를 바로 견줄 수 있습니다.
              1 이면 그늘이 밝은 곳과 같은 색, > 1 이면 그늘이 더 푸름(하늘빛만 받는 밑면), < 1 이면 더 붉음.
  shadeBlueTop 같은 지표를 위 60 % 그림(흐린 하늘·§126.6 B1 의 영역)에서.
  darkRatio · brightRatio   phys.py 그대로(렌더 알파 ≥ 0.15, 사진 NRBR).

쓰는 법:
  phys3.py --photos [--root REPO] [--out phys3-photo-quartiles.json]
  phys3.py --renders DIR [--out phys3-renders.json] [--glob '*.png']
"""
import sys, os, json, glob, hashlib, datetime
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm, phys  # noqa: E402

KEYS = ['shadeBlue', 'shadeBlueTop', 'darkRatio', 'brightRatio', 'cloudFrac']


def phys3_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


def shade_blue(lin, L, mask):
    m = mask & (lin[..., 0] > 1e-4) & (lin[..., 2] > 1e-4)
    if m.sum() < 400:
        return float('nan')
    Lc = L[m]
    lo, hi = np.quantile(Lc, 0.3), np.quantile(Lc, 0.7)
    dark, bright = m & (L <= lo), m & (L >= hi)
    if dark.sum() < 100 or bright.sum() < 100:
        return float('nan')
    br = lambda sel: float(lin[..., 2][sel].mean() / lin[..., 0][sel].mean())
    return br(dark) / br(bright)


def metrics_of(path, y0=0.0, y1=1.0, alpha_path=None, mask_mode='nrbr'):
    rgb, alpha = fm.load_crop(path, y0, y1, 0.0, 1.0, alpha_path)
    L, lin = fm.luminance(rgb)
    mask, all_cloud = fm.cloud_mask(rgb, lin, L, alpha, mask_mode)
    out = phys.phys_metrics(rgb, alpha, mask_mode)
    out['shadeBlue'] = shade_blue(lin, L, mask)
    H = L.shape[0]
    top = slice(0, max(1, int(round(H * 0.6))))
    out['shadeBlueTop'] = shade_blue(lin[top], L[top], mask[top])
    return out


def run_photos(root, out):
    rows = []
    for sub, sel, genera in fm.PHOTO_SETS:
        S = json.load(open(os.path.join(root, 'tools/genus-ruler', sub, sel)))
        for g in genera:
            for idx, frac in S[g].items():
                f = os.path.join(root, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                if not os.path.exists(f):
                    continue
                rows.append(dict(genus=g, name='%s/%s' % (g, idx), **metrics_of(f, 0, min(1.0, float(frac)) * 0.97)))
    genera = [g for _, _, gs in fm.PHOTO_SETS for g in gs]
    Q = {g: {k: fm.qs([r[k] for r in rows if r['genus'] == g]) for k in KEYS} for g in genera}
    doc = {
        'phys3Sha256': phys3_sha256(), 'physSha256': phys.phys_sha256(), 'fmSha256': fm.fm_sha256(),
        'date': datetime.date.today().isoformat(),
        'crop': {'width': fm.W0, 'photoTop': 'selection sky fraction x 0.97', 'mask': 'nrbr', 'shade': 'L quantile 0.3 / 0.7, min 100 px each'},
        'counts': {g: sum(1 for r in rows if r['genus'] == g) for g in genera},
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('phys3.py sha256', doc['phys3Sha256'])
    print('photos', doc['counts'])
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


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == '--photos':
        root = a[a.index('--root') + 1] if '--root' in a else os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
        out = a[a.index('--out') + 1] if '--out' in a else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phys3-photo-quartiles.json')
        run_photos(root, out)
    elif a and a[0] == '--renders':
        out = a[a.index('--out') + 1] if '--out' in a else 'phys3-renders.json'
        pat = a[a.index('--glob') + 1] if '--glob' in a else '*.png'
        top = float(a[a.index('--top') + 1]) if '--top' in a else 0.78
        run_renders(a[1], out, top, pat)
    else:
        print(__doc__)
