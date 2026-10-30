#!/usr/bin/env python3
"""grain2.py — RULER-grain2: RULER-grain 의 가드 두 개(G2 하늘 조항 · G3)만 바꿔 다시 판정합니다.

나머지(알갱이 판정·G0·G1·G2 의 구름·포화 조항·G4~G11·비용·채택·멈춤)는 동결된 grain/grain.py 가 만든 값을 그대로 씁니다.
  python3 tools/genus-ruler/grain2/grain2.py --rejudge --old OLD_GATE.json --scenes S --renders R --out NEW_GATE.json [--cache C]
  python3 tools/genus-ruler/grain2/grain2.py --g2s --scenes S --renders R --base ARM[:TAG] --cand ARM[:TAG] [--rows-root R2]
  python3 tools/genus-ruler/grain2/grain2.py --g3 --renders R --base ARM[:TAG] --cand ARM[:TAG] [--cache C] [--swap ci60=sc85,...]
  python3 tools/genus-ruler/grain2/grain2.py --aa --scenes S --renders R --out AA.json [--cache C]
팔 이름 'C0:AA777' = 잡 이름 'C0__<장면>__<방위>__std__AA777'.
"""
import argparse, hashlib, json, math, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GRAIN = os.path.abspath(os.path.join(HERE, '..', 'grain'))
CLIPDIR = os.path.abspath(os.path.join(HERE, '..', 'clip'))
sys.path.insert(0, GRAIN)
import grain as G  # noqa: E402  (동결 판정 코드 — 고치지 않고 함수만 씀)
import fm  # noqa: E402  (grain.py 가 sys.path 에 넣은 flow/fm.py)

# ═════════ 미리 정한 수(§2·§3) ═════════
SKY_ALPHA = 0.02          # 하늘 = 두 그림 모두 알파 < 0.02 (RULER-grain §2.4 의 문턱 그대로)
SKY_MIN_PX = 200          # 행 유효 최소 화소(RULER-grain photo_metrics 와 같음)
SKY_EL_MIN = 0.0          # 화소 고도 > 0° (지평선 아래 땅 빼기)
G2S_TOL, G2S_SHARE, G2S_CAP, G2S_MIN_SCENES = 0.01, 0.90, 0.02, 24
G3_K, G3_SEED0, G3_TOP = 16, 1000, 0.78
G3_UNITS = [('ac60', 'AcCc'), ('ci60', 'Ci')]
G3_TIMES = ('e20', 'e45')
G3_OK = {'AcCc': {'AcCc'}, 'Ci': {'Ci', 'Cs'}}


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def arm_tag(s):
    a, _, t = s.partition(':')
    return a, (t or None)


# ═════════ G2 하늘 조항(§2) ═════════
def sky_row(pb, ab, pe, ae, el_deg, vfov_deg):
    """한 행: 공유 마스크(두 알파 < 0.02, 고도 > 0°)에서 중앙 선형 휘도의 |ln 비|. 화소 < 200 이면 None."""
    rb = np.asarray(Image.open(pb).convert('RGB')).astype(np.float64)
    re_ = np.asarray(Image.open(pe).convert('RGB')).astype(np.float64)
    al_b = np.asarray(Image.open(ab).convert('L')).astype(np.float64) / 255.0
    al_e = np.asarray(Image.open(ae).convert('L')).astype(np.float64) / 255.0
    H, W = al_b.shape
    el = G.pixel_elevation(W, H, el_deg, vfov_deg)
    m = (al_b < SKY_ALPHA) & (al_e < SKY_ALPHA) & (el > SKY_EL_MIN)
    n = int(m.sum())
    if n < SKY_MIN_PX:
        return {'n': n, 'd': None}
    Lb, _ = fm.luminance(rb); Le, _ = fm.luminance(re_)
    mb, me = float(np.median(Lb[m])), float(np.median(Le[m]))
    d = abs(math.log(me / mb)) if mb > 0 and me > 0 else None
    return {'n': n, 'Lb': mb, 'Le': me, 'd': d}


def job_paths(root, arm, tag, scene, az, frame='std'):
    d = os.path.join(root, G.job_name(arm, scene, az, frame, tag))
    if not os.path.exists(os.path.join(d, 'meta.json')):
        return None
    meta = json.load(open(os.path.join(d, 'meta.json')))
    inp = meta['input'] if 'input' in meta else meta['job']['input']
    return {'png': os.path.join(d, 'mean.png'), 'alpha': os.path.join(d, 'mean.alpha.png'), 'el': inp['el'], 'fov': inp['fov'], 'ok': bool(meta.get('captureOk'))}


def g2s(S, root, base, cand, scenes=None, gain=None):
    """G2 하늘 조항. gain = 양성 대조용(E 의 선형 휘도에 곱하는 수, 판정에는 안 씀)."""
    (ba, bt), (ea, et) = arm_tag(base), arm_tag(cand)
    rows, per = [], {}
    for key, s in S['scenes'].items():
        if s.get('record') or (scenes and key not in scenes):
            continue
        for az in ('t', 's', 'a'):
            B, E = job_paths(root, ba, bt, key, az), job_paths(root, ea, et, key, az)
            if B is None or E is None:
                continue
            pe = E['png']
            if gain is not None:
                pe = _gain_png(E['png'], gain)
            r = sky_row(B['png'], B['alpha'], pe, E['alpha'], B['el'], B['fov'])
            r.update({'scene': key, 'az': az})
            rows.append(r)
            if r['d'] is not None:
                per.setdefault(key, []).append(r['d'])
    sv = {k: float(np.median(v)) for k, v in per.items()}
    out = {'rows': rows, 'scene': sv, 'nScenes': len(sv), 'nRows': len(rows), 'nRowsValid': sum(r['d'] is not None for r in rows)}
    if len(sv) < G2S_MIN_SCENES:
        out.update({'share': None, 'max': None, 'pass': None, 'note': '유효 장면 < %d — 평가 불가' % G2S_MIN_SCENES})
        return out
    vals = list(sv.values())
    out['share'] = float(np.mean([v <= G2S_TOL for v in vals])); out['max'] = float(max(vals))
    out['pass'] = bool(out['share'] >= G2S_SHARE and out['max'] <= G2S_CAP)
    return out


_GAIN_CACHE = {}


def _gain_png(p, gain):
    """양성 대조: sRGB 디코드 → 선형 × gain → 인코드(8 비트 반올림). 임시 파일 경로."""
    key = (p, gain)
    if key in _GAIN_CACHE:
        return _GAIN_CACHE[key]
    rgb = np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
    lin = fm.srgb_to_lin(rgb) * gain
    lin = np.clip(lin, 0, 1)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    out = np.clip(np.round(srgb * 255), 0, 255).astype(np.uint8)
    d = os.environ.get('GRAIN2_TMP', '/tmp/grain2-gain'); os.makedirs(d, exist_ok=True)
    q = os.path.join(d, hashlib.sha1(('%s|%r' % key).encode()).hexdigest() + '.png')
    Image.fromarray(out).save(q)
    _GAIN_CACHE[key] = q
    return q


# ═════════ G3 CLIP 라벨(§3) ═════════
_J2 = None


def _judge2():
    global _J2
    if _J2 is None:
        sys.path.insert(0, CLIPDIR)
        import judge2  # noqa: E402  (동결 판정기 — prep·vis·class_embeds·probs 를 그대로)
        names, C = judge2.class_embeds('genus')
        _J2 = (judge2, names, C)
    return _J2


def clip_smooth(png, cache=None):
    """그림 하나: K 개 ±1 LSB 떨림 복사본을 하나씩(배치 1) 넣은 확률의 평균. 캐시 열쇠 = PNG sha256 + 설정."""
    j2, names, C = _judge2()
    key = '%s|K%d|s%d|top%.2f' % (sha256(png), G3_K, G3_SEED0, G3_TOP)
    if cache is not None and key in cache:
        return np.array(cache[key]['p']), names
    a = np.asarray(Image.open(png).convert('RGB')).astype(np.int16)
    P = []
    for k in range(G3_K):
        rng = np.random.default_rng(G3_SEED0 + k)
        x = np.clip(a + rng.integers(-1, 2, size=a.shape), 0, 255).astype(np.uint8)
        e = j2.vis().run(None, {'pixel_values': np.stack([j2.prep(Image.fromarray(x), G3_TOP)])})[0]
        e = e / np.linalg.norm(e, axis=1, keepdims=True)
        P.append(j2.probs(e, C)[0])
    p = np.mean(P, axis=0)
    if cache is not None:
        cache[key] = {'p': [float(v) for v in p], 'png': png, 'sd': [float(v) for v in np.std(P, axis=0)]}
    return p, names


def g3_label(p, names, gen):
    ok = G3_OK[gen]
    lab = names[int(np.argmax(p))]
    pc = max(p[i] for i, n in enumerate(names) if n in ok)
    po = max(p[i] for i, n in enumerate(names) if n not in ok)
    return lab, bool(lab in ok), float(math.log(pc / po))


def g3(root, base, cand, cache=None, swap=None):
    """G3: 장면(ac60·ci60 × e20·e45)마다 맞는 방위 수 h. 통과 = 모든 장면 h_E ≥ h_B − 1 그리고 Σh_E ≥ Σh_B − 1.
    swap = 양성 대조용 {'ci60': 'sc85'} — E 쪽 그림을 다른 층 그림으로 바꿔 넣음(판정에는 안 씀)."""
    (ba, bt), (ea, et) = arm_tag(base), arm_tag(cand)
    out, hb, he, ok_all = {}, 0, 0, True
    for layer, gen in G3_UNITS:
        for time in G3_TIMES:
            sc = layer + '_' + time
            rec = {}
            for tag, arm, t in (('B', ba, bt), ('E', ea, et)):
                lay = (swap or {}).get(layer, layer) if tag == 'E' else layer
                h, labs = 0, []
                for az in ('t', 's', 'a'):
                    jp = job_paths(root, arm, t, lay + '_' + time, az)
                    if jp is None:
                        rec[tag] = None; break
                    p, names = clip_smooth(jp['png'], cache)
                    lab, hit, mg = g3_label(p, names, gen)
                    labs.append({'az': az, 'label': lab, 'hit': hit, 'margin': round(mg, 4)})
                    h += hit
                else:
                    rec[tag] = {'hits': h, 'labels': labs}
            out[sc] = rec
            if rec.get('B') is None or rec.get('E') is None:
                ok_all = None
                continue
            hb += rec['B']['hits']; he += rec['E']['hits']
            if rec['E']['hits'] < rec['B']['hits'] - 1:
                ok_all = False if ok_all is not None else None
    out['sumB'], out['sumE'] = hb, he
    if ok_all is None:
        out['pass'] = None; out['note'] = '그림 없음 — 평가 불가'
    else:
        out['pass'] = bool(ok_all and he >= hb - 1)
    return out


# ═════════ 상태 다시 매기기(grain.py run_gate 의 마지막 부분과 같은 규칙) ═════════
def restatus(doc):
    """grain.py:969-993 의 상태 규칙을 그대로 옮김(가드 이름 목록·실패·미평가·비용·상태)."""
    gd, arm = doc['guards'], doc['cand']
    gnames = ['G1b', 'G2', 'G5', 'G11'] + ([] if gd.get('G1c', {}).get('recordOnly') else ['G1c', 'G7']) + ([] if arm in G.JITTER_ARMS else ['G10']) \
        + (['G6'] if arm in G.DENSITY_ARMS else []) + ['G0', 'G3', 'G4', 'G9']
    gfail = [k for k in gnames if k in gd and gd[k].get('pass') is False]
    gnone = [k for k in gnames if k in gd and gd[k].get('pass') is None]
    cum = doc.get('cumCost')
    costOk = bool(gd.get('G8', {}).get('pass')) and (cum is None or cum['pass'])
    st = doc['verdict']
    if st == '통과' and gnone:
        status = '가드 미평가'
    elif st == '통과' and not gfail and costOk:
        status = '채택 후보'
    elif st == '통과' and not gfail and not costOk:
        status = '비용 보류'
    elif st == '통과' and set(gfail) <= {'G1b', 'G1c'} and gfail:
        status = '면적 재맞춤 필요'
    else:
        status = st if st != '통과' else '가드 실패'
    if arm == 'E3c':
        status = '진단(채택 안 함)'
    return gfail, gnone, status


def rejudge(old, S, root, cache=None):
    """옛 게이트 문서 + 새 G2 하늘·G3 → 새 게이트 문서."""
    doc = json.loads(json.dumps(old))
    base, cand = doc['base'], doc['cand']
    g2old = doc['guards']['G2']
    sky = g2s(S, root, base, cand)
    g2 = {'old': g2old, 'sky': {k: sky[k] for k in sky if k != 'rows'}, 'skyRows': sky['rows'],
          'cloudShare': g2old.get('cloudShare'), 'cloudMax': g2old.get('cloudMax'), 'satMax': g2old.get('satMax')}
    cloud_ok = bool(isinstance(g2old.get('cloudShare'), (int, float)) and g2old['cloudShare'] >= 0.9 and g2old.get('cloudMax') is not None and g2old['cloudMax'] <= G.G2_CLOUD_MAX
                    and g2old.get('satMax') is not None and g2old['satMax'] <= G.G2_SAT)
    g2['pass'] = None if sky['pass'] is None else bool(sky['pass'] and cloud_ok)
    doc['guards']['G2'] = g2
    g3old = doc['guards'].get('G3')
    g3new = g3(root, base, cand, cache)
    g3new['old'] = g3old
    doc['guards']['G3'] = g3new
    gfail, gnone, status = restatus(doc)
    doc.update({'ruler': 'RULER-grain2', 'grainSha256': G.grain_sha256(), 'grain2Sha256': sha256(os.path.abspath(__file__)),
                'oldStatus': old.get('status'), 'oldGuardFail': old.get('guardFail'), 'guardFail': gfail, 'guardUnknown': gnone, 'status': status})
    return doc


def load_cache(p):
    return json.load(open(p)) if p and os.path.exists(p) else {}


def save_cache(p, c):
    if p:
        tmp = p + '.tmp'; json.dump(c, open(tmp, 'w')); os.replace(tmp, p)


def aa_report(S, root, cache, cache_path=None):
    """동결 전 검증(§4): A/A 쌍과 합성 양성 대조. 후보 팔 렌더는 읽지 않음."""
    rep = {'g2s': {}, 'g3': {}, 'g2sPos': {}, 'g3Pos': {}}
    for b, e in (('C0', 'C0:AA777'),):
        r = g2s(S, root, b, e); rep['g2s'][b + '|' + e] = {k: r[k] for k in r if k != 'rows'}
    # P8 쌍(개발 날씨, 측정 번들): 장면 이름이 held-out 표와 같아(cu35_e5 등) 두 쪽이 다 있는 행만 짝지어짐
    for b, e in (('C0:P8A', 'C0:P8n777'), ('C0:P8A', 'C0:P8n4242'), ('C0:P8n777', 'C0:P8n4242')):
        r = g2s(S, root, b, e); r2 = {k: r[k] for k in r if k != 'rows'}
        r2['note'] = 'P8 쌍은 개발 장면 6 개뿐 — 유효 장면 < 24 라 pass 는 None, 행·장면 값만 봄'
        rep['g2s'][b + '|' + e] = r2
    for gain in (1.005, 1.015):
        r = g2s(S, root, 'C0', 'C0', gain=gain); rep['g2sPos']['C0|C0x%.3f' % gain] = {k: r[k] for k in r if k != 'rows'}
    for b, e in (('C0', 'C0:AA777'), ('C0', 'C0:AA4242'), ('C0:AA777', 'C0:AA4242')):
        rep['g3'][b + '|' + e] = g3(root, b, e, cache); save_cache(cache_path, cache)
    for sw in ({'ci60': 'sc85'}, {'ac60': 'cu35'}):
        k = ','.join('%s=%s' % kv for kv in sw.items())
        rep['g3Pos']['C0|C0 swap ' + k] = g3(root, 'C0', 'C0', cache, swap=sw); save_cache(cache_path, cache)
    rep['accept'] = {
        'g2sAA': all(v['pass'] is True for k, v in rep['g2s'].items() if not k.startswith('C0:P8')),
        'g2sAAdevMax': max((v['max'] for k, v in rep['g2s'].items() if k.startswith('C0:P8') and v.get('max') is not None), default=None),
        'g2sPosFail': rep['g2sPos']['C0|C0x1.015']['pass'] is False,
        'g2sSmallPass': rep['g2sPos']['C0|C0x1.005']['pass'] is True,
        'g3AA': all(v['pass'] is True for v in rep['g3'].values()),
        'g3PosFail': all(v['pass'] is False for v in rep['g3Pos'].values()),
    }
    # P8 쌍(개발 장면)은 장면 수가 모자라 pass 가 None — 장면 값 최대 ≤ 0.01 을 따로 요구
    a = rep['accept']
    a['g2sAAdev'] = a['g2sAAdevMax'] is not None and a['g2sAAdevMax'] <= G2S_TOL
    a['all'] = all(a[k] for k in ('g2sAA', 'g2sAAdev', 'g2sPosFail', 'g2sSmallPass', 'g3AA', 'g3PosFail'))
    return rep


def main(argv):
    ap = argparse.ArgumentParser()
    for f in ('--rejudge', '--g2s', '--g3', '--aa'):
        ap.add_argument(f, action='store_true')
    for f in ('--old', '--scenes', '--renders', '--out', '--base', '--cand', '--cache', '--swap'):
        ap.add_argument(f)
    args = ap.parse_args(argv)
    cache = load_cache(args.cache)
    if args.rejudge:
        S = json.load(open(args.scenes)); old = json.load(open(args.old))
        doc = rejudge(old, S, args.renders, cache); save_cache(args.cache, cache)
        json.dump(doc, open(args.out, 'w'), indent=1, default=lambda o: None)
        g2, g3_ = doc['guards']['G2'], doc['guards']['G3']
        print('%s vs %s: 알갱이 %s | 상태 %s (옛 %s) | G2 하늘 share %s max %s 장면 %d → %s | G3 ΣB %s ΣE %s → %s | 가드 실패 %s' % (
            doc['cand'], doc['base'], doc['verdict'], doc['status'], doc['oldStatus'], g2['sky'].get('share'), g2['sky'].get('max'), g2['sky']['nScenes'], g2['pass'],
            g3_.get('sumB'), g3_.get('sumE'), g3_['pass'], doc['guardFail']))
    elif args.g2s:
        S = json.load(open(args.scenes)); r = g2s(S, args.renders, args.base, args.cand)
        print(json.dumps({k: r[k] for k in r if k != 'rows'}, ensure_ascii=False))
    elif args.g3:
        sw = dict(x.split('=') for x in args.swap.split(',')) if args.swap else None
        r = g3(args.renders, args.base, args.cand, cache, swap=sw); save_cache(args.cache, cache)
        print(json.dumps(r, ensure_ascii=False))
    elif args.aa:
        S = json.load(open(args.scenes)); rep = aa_report(S, args.renders, cache, args.cache); save_cache(args.cache, cache)
        json.dump(rep, open(args.out, 'w'), indent=1, ensure_ascii=False)
        print(json.dumps(rep['accept'], ensure_ascii=False))
    else:
        ap.print_help(); return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
