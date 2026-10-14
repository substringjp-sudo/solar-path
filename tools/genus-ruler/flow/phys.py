#!/usr/bin/env python3
"""
RULER-physics(§136) 지표 — 종류별 구름 밝기비·구름 조각 사이 밝기 차·22° 무리 대비. numpy + PIL 만 씁니다.

fm.py 의 그림 읽기(load_crop·luminance)·마스크(cloud_mask)·조각 라벨(label)을 **그대로** 가져다 씁니다 — fm.py 는 고치지
않습니다(photo-flow-quartiles.json 이 fm.py 해시에 묶여 있음). 이 파일의 수학을 고치면 phys-photo-quartiles.json 의
physSha256 이 맞지 않으므로 사진 사분위를 다시 재야 합니다.

지표(사진 = NRBR 마스크, 하늘 비율 × 0.97 자름 / 렌더 = 알파 ≥ 0.15, 위 78 %):
  brightRatio  구름 휘도 p90 ÷ 맑은 하늘 휘도 중앙값   (genus/skyratio.js 와 같은 정의 — 노출에 무관)
  darkRatio    구름 휘도 p10 ÷ 맑은 하늘 휘도 중앙값   (구름 밑면·두꺼운 곳이 하늘보다 얼마나 어두운가)
  pieceLogSD   면적 ≥ 30 화소 조각마다 log(휘도 중앙값) 을 구해 그 표준편차 — 구름마다 밀도(밝기)가 다른가(조각 4개 이상)
  pieceN       그 조각 수
  cloudFrac    구름 화소 비율(운량 면적 가드)
  하늘·구름 화소가 각각 300 개 미만이면(온통 구름 등) 비율 지표는 NaN.

무리(--halo): 화면 가운데 = 해 방향으로 그린 렌더에서 해와의 각거리 고리별 선형 휘도 평균을 내고
  E22 = L[21.7°, 23.0°] ÷ ½(L[19.0°, 20.5°] + L[24.5°, 26.0°])   (해 둘레 밝기가 각도에 따라 매끄럽게 줄면 1 근처)
  화소 각 = atan(r / f), f = (H/2) / tan(세로 시야/2).

쓰는 법:
  phys.py --photos [--root REPO] [--out phys-photo-quartiles.json]
  phys.py --renders DIR [--out phys-renders.json] [--top 0.78] [--glob '*.png']
  phys.py --halo PNG [PNG …] [--fov 60]
  phys.py --gate phys-photo-quartiles.json phys-renders.json [--ref P0] [--out phys-gate.json]
"""
import sys, os, json, math, glob, hashlib, datetime
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fm  # noqa: E402  (load_crop · luminance · cloud_mask · label · PHOTO_SETS · scene_genus · isnum · qs)

MIN_PIECE = 30
MIN_PIECES = 4
RATIO_GENERA = ['Cu', 'AcCc', 'Ci', 'StSc']
KEYS = ['cloudFrac', 'brightRatio', 'darkRatio', 'pieceLogSD', 'pieceN']


def phys_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


def phys_metrics(rgb, alpha, mask_mode):
    L, lin = fm.luminance(rgb)
    mask, all_cloud = fm.cloud_mask(rgb, lin, L, alpha, mask_mode)
    out = {'cloudFrac': float(mask.mean()), 'allCloud': bool(all_cloud)}
    sky = ~mask
    nan = float('nan')
    if all_cloud or mask.sum() < 300 or sky.sum() < 300:
        out.update(brightRatio=nan, darkRatio=nan)
    else:
        s = float(np.median(L[sky]))
        c = L[mask]
        out['brightRatio'] = float(np.quantile(c, 0.9) / max(s, 1e-9))
        out['darkRatio'] = float(np.quantile(c, 0.1) / max(s, 1e-9))
    cf = mask.mean()
    if cf < 0.02 or cf > 0.98:
        out.update(pieceLogSD=nan, pieceN=0)
        return out
    lab, comps = fm.label(mask)
    logL = np.log(np.maximum(L, 1e-5))
    meds = [float(np.median(logL[lab == i])) for i, c in enumerate(comps) if c['area'] >= MIN_PIECE]
    out['pieceN'] = len(meds)
    out['pieceLogSD'] = float(np.std(meds)) if len(meds) >= MIN_PIECES else nan
    return out


def metrics_of(path, y0=0.0, y1=1.0, alpha_path=None, mask_mode='nrbr'):
    rgb, alpha = fm.load_crop(path, y0, y1, 0.0, 1.0, alpha_path)
    return phys_metrics(rgb, alpha, mask_mode)


# ───────── --photos ─────────
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
        'physSha256': phys_sha256(), 'fmSha256': fm.fm_sha256(), 'date': datetime.date.today().isoformat(),
        'crop': {'width': fm.W0, 'photoTop': 'selection sky fraction x 0.97', 'mask': 'nrbr', 'minPiece': MIN_PIECE, 'minPieces': MIN_PIECES},
        'counts': {g: sum(1 for r in rows if r['genus'] == g) for g in genera},
        'quartiles': Q,
        'rows': [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
    }
    json.dump(doc, open(out, 'w'), indent=1)
    print('phys.py sha256', doc['physSha256'])
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
def run_renders(d, out, top=0.78, pattern='*.png'):
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
        m = metrics_of(f, 0, top, alpha_path=ap, mask_mode='alpha')
        res.setdefault(cand, {}).setdefault(scene, {'genus': fm.scene_genus(scene), 'az': {}})['az'][az] = m
        print(name, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items()}))
    for cand in res:
        for scene, s in res[cand].items():
            s['median'] = {k: (float(np.nanmedian([m[k] for m in s['az'].values() if fm.isnum(m.get(k))]))
                               if any(fm.isnum(m.get(k)) for m in s['az'].values()) else float('nan')) for k in KEYS}
    json.dump({'physSha256': phys_sha256(), 'dir': os.path.abspath(d), 'top': top, 'mask': 'alpha>=0.15',
               'statistic': 'nanmedian over azimuths', 'renders': res}, open(out, 'w'), indent=1)
    print('wrote', out)


# ───────── --halo ─────────
def halo(path, fov=60.0):
    from PIL import Image
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    lin = fm.srgb_to_lin(a)
    L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    H, W = L.shape
    f = (H / 2) / math.tan(math.radians(fov / 2))
    yy, xx = np.mgrid[0:H, 0:W]
    th = np.degrees(np.arctan(np.hypot(xx + 0.5 - W / 2, yy + 0.5 - H / 2) / f))

    def ring(lo, hi, ch=None):
        m = (th >= lo) & (th < hi)
        v = L if ch is None else lin[..., ch]
        return float(v[m].mean()) if m.any() else float('nan')
    l22, lin_, lout = ring(21.7, 23.0), ring(19.0, 20.5), ring(24.5, 26.0)
    e22 = l22 / max(0.5 * (lin_ + lout), 1e-12)
    # 안쪽 가장자리 붉음(기록만): 21.0–21.9° 의 R/B ÷ 23.0–24.0° 의 R/B
    rb = lambda lo, hi: ring(lo, hi, 0) / max(ring(lo, hi, 2), 1e-12)
    return {'E22': e22, 'L22': l22, 'Lin': lin_, 'Lout': lout, 'redInner': rb(21.0, 21.9) / max(rb(23.0, 24.0), 1e-12)}


# ───────── --gate ─────────
def logdist(v, q):
    """사진 중앙값에서의 log 거리 ÷ log(q75/q25) — IQR 단위."""
    if not fm.isnum(v) or v <= 0 or not q or not fm.isnum(q.get('q50')):
        return float('nan')
    w = math.log(max(q['q75'], 1e-9) / max(q['q25'], 1e-9))
    return abs(math.log(v / q['q50'])) / max(w, 1e-6)


def gate_scene(s, Q):
    g = s['genus']
    rows = []
    if g in RATIO_GENERA:
        for k in ('brightRatio', 'darkRatio'):
            q = Q.get(g, {}).get(k)
            v = s['median'].get(k)
            ok = (q['q25'] <= v <= q['q75']) if (q and q['n'] and fm.isnum(v)) else None
            rows.append({'metric': k, 'rule': 'R1', 'kind': 'iqr', 'value': v, 'q': q, 'ok': ok, 'dist': logdist(v, q)})
        q = Q.get(g, {}).get('pieceLogSD')
        v = s['median'].get('pieceLogSD')
        ok = (v >= q['q25']) if (q and q['n'] and fm.isnum(v)) else None
        rows.append({'metric': 'pieceLogSD', 'rule': 'R2', 'kind': 'ge25', 'value': v, 'q': q, 'ok': ok})
    return rows


def run_gate(qfile, rfile, ref=None, out=None):
    Qd = json.load(open(qfile))
    if Qd.get('physSha256') != phys_sha256():
        print('⚠ phys.py 해시가 사분위 파일과 다릅니다 — 수학이 바뀌었으면 --photos 로 다시 재야 합니다')
    Q = Qd['quartiles']
    R = json.load(open(rfile))['renders']
    rep = {}
    for cand, scenes in sorted(R.items()):
        tot = {'R1': [0, 0], 'R2': [0, 0], 'D': 0.0, 'Dn': 0}
        for scene, s in sorted(scenes.items()):
            rows = gate_scene(s, Q)
            for r in rows:
                if r['ok'] is None:
                    continue
                tot[r['rule']][1] += 1
                tot[r['rule']][0] += 1 if r['ok'] else 0
                if r['rule'] == 'R1' and fm.isnum(r.get('dist')):
                    tot['D'] += r['dist']; tot['Dn'] += 1
            rep.setdefault(cand, {})[scene] = rows
            print('%-4s %-6s %-5s ' % (cand, scene, s['genus'] or '?') + '  '.join(
                '%s %s %s' % (r['metric'], ('%.3f' % r['value']) if fm.isnum(r['value']) else 'nan',
                              '○' if r['ok'] else ('×' if r['ok'] is not None else '—')) for r in rows)
                  + '  cf %.3f' % s['median'].get('cloudFrac', float('nan')))
        rep[cand]['_total'] = tot
        print('%-4s 합계  R1 %d/%d  R2 %d/%d  D %.2f (n %d)' % (cand, tot['R1'][0], tot['R1'][1], tot['R2'][0], tot['R2'][1], tot['D'], tot['Dn']))
    if ref and ref in R:
        print('\n운량 면적(cloudFrac) 기준 %s 대비 상대 변화:' % ref)
        for cand, scenes in sorted(R.items()):
            if cand == ref:
                continue
            ch = {sc: (s['median']['cloudFrac'] / R[ref][sc]['median']['cloudFrac'] - 1) for sc, s in scenes.items()
                  if sc in R[ref] and fm.isnum(s['median'].get('cloudFrac')) and R[ref][sc]['median'].get('cloudFrac', 0) > 0}
            print('  %-4s ' % cand + '  '.join('%s %+.0f%%' % (sc, 100 * v) for sc, v in sorted(ch.items())))
            rep[cand]['_areaVsRef'] = ch
    if out:
        json.dump({'physSha256': phys_sha256(), 'quartiles': os.path.abspath(qfile), 'renders': os.path.abspath(rfile), 'ref': ref, 'report': rep},
                  open(out, 'w'), indent=1, default=lambda o: None)
        print('wrote', out)


def main(argv):
    def opt(name, default=None):
        if name in argv:
            i = argv.index(name); v = argv[i + 1]; del argv[i:i + 2]; return v
        return default
    here = os.path.dirname(os.path.abspath(__file__))
    if '--photos' in argv:
        argv.remove('--photos')
        root = opt('--root', os.path.abspath(os.path.join(here, '../../..')))
        return run_photos(root, opt('--out', os.path.join(here, 'phys-photo-quartiles.json')))
    if '--renders' in argv:
        i = argv.index('--renders'); d = argv[i + 1]; del argv[i:i + 2]
        return run_renders(d, opt('--out', os.path.join(d, 'phys-renders.json')), float(opt('--top', '0.78')), opt('--glob', '*.png'))
    if '--halo' in argv:
        argv.remove('--halo')
        fov = float(opt('--fov', '60'))
        for p in argv:
            print(os.path.basename(p), json.dumps({k: round(v, 4) for k, v in halo(p, fov).items()}))
        return
    if '--gate' in argv:
        i = argv.index('--gate'); qf, rf = argv[i + 1], argv[i + 2]; del argv[i:i + 3]
        return run_gate(qf, rf, opt('--ref'), opt('--out'))
    print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
