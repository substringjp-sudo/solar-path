#!/usr/bin/env python3
"""grain2.py — RULER-grain2: RULER-grain 의 가드 두 개(G2 하늘 조항 · G3)만 바꿔 다시 판정합니다.

나머지(알갱이 판정·G0·G1·G2 의 구름·포화 조항·G4~G11·비용·채택·멈춤)는 동결된 grain/grain.py 가 만든 값을 그대로 씁니다.
  python3 tools/genus-ruler/grain2/grain2.py --rejudge --old OLD_GATE.json --scenes S --renders R --out NEW_GATE.json [--cache C]
  python3 tools/genus-ruler/grain2/grain2.py --g2s --scenes S --renders R --base ARM[:TAG] --cand ARM[:TAG]
  python3 tools/genus-ruler/grain2/grain2.py --g3 --renders R --base ARM[:TAG] --cand ARM[:TAG] [--cache C]
  python3 tools/genus-ruler/grain2/grain2.py --aa --scenes S --renders R --out REPORT.json [--cache C] [--near-out NEAR.json]
팔 이름 'C0:AA777' = 잡 이름 'C0__<장면>__<방위>__std__AA777'.
"""
import argparse, hashlib, json, math, os, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
GRAIN = os.path.abspath(os.path.join(HERE, '..', 'grain'))
CLIPDIR = os.path.abspath(os.path.join(HERE, '..', 'clip'))
NEAR_FILE = os.path.join(HERE, 'g3-near.json')
sys.path.insert(0, GRAIN)
import grain as G  # noqa: E402  (동결 판정 코드 — 고치지 않고 함수만 씀)
import fm  # noqa: E402  (grain.py 가 sys.path 에 넣은 flow/fm.py)

# ═════════ 미리 정한 수(RULER-grain2 §2·§3) ═════════
SKY_ALPHA = 0.02          # 하늘 = 알파 < 0.02 (RULER-grain §2.4 의 문턱 그대로)
SKY_MIN_PX = 200          # 행·띠 최소 화소(RULER-grain photo_metrics 와 같음)
SKY_EL_MIN = 0.0          # 화소 고도 > 0° (지평선 아래 땅 빼기; 0 ~ −0.33° 의 굽은 지평선 띠도 일부러 뺌)
BANDS = ((0.0, 5.0), (5.0, 15.0), (15.0, 90.0))
G2S_TOL, G2S_SHARE, G2S_CAP, G2S_MIN_SCENES = 0.01, 0.95, 0.02, 24
SHARED_FAIL = 1e9         # 하늘이 있는 행인데 공유 하늘이 < 200 화소 → 이 값(상한에서 실패)
MEM_EDT, MEM_TOL, MEM_SHARE, MEM_CAP = 8.0, 0.02, 0.90, 0.05
G3_K, G3_SEED0, G3_TOP = 16, 1000, 0.78
G3_NEAR_FLOOR, G3_NEAR_MAX = 0.30, 0.60
G3_UNITS = [('ac60', 'AcCc'), ('ci60', 'Ci')]
G3_TIMES = ('e20', 'e45')
G3_OK = {'AcCc': {'AcCc'}, 'Ci': {'Ci', 'Cs'}}
PFF_MAX, PFF_N, PFF_SEED, POWER_SHIFT, POWER_MIN = 0.10, 200000, 20261030, 1.0, 0.95
CHI2_10_24 = 15.6587      # χ²(0.10; 24) — σ 의 90 % 위 한계


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def arm_tag(s):
    a, _, t = s.partition(':')
    return a, (t or None)


def job_paths(root, arm, tag, scene, az, frame='std'):
    """잡 폴더의 그림·알파·카메라. meta.json 이 없거나 captureOk 가 아니거나 그림이 없으면 None(빠진 행)."""
    d = os.path.join(root, G.job_name(arm, scene, az, frame, tag))
    mp = os.path.join(d, 'meta.json')
    if not os.path.exists(mp):
        return None
    meta = json.load(open(mp))
    p, a = os.path.join(d, 'mean.png'), os.path.join(d, 'mean.alpha.png')
    if not meta.get('captureOk') or not (os.path.exists(p) and os.path.exists(a)):
        return None
    inp = meta['input'] if 'input' in meta else meta['job']['input']
    cr = meta.get('canvasCropRows')
    return {'png': p, 'alpha': a, 'el': inp['el'], 'fov': inp['fov'], 'rows': cr, 'W': meta.get('W'), 'H': meta.get('H')}


def load_rgb(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.float64)


def load_alpha(p):
    return np.asarray(Image.open(p).convert('L')).astype(np.float64) / 255.0


# ═════════ G2 하늘 조항(§2) ═════════
def _edt(sky):
    """하늘 화소에서 가장 가까운 비하늘(알파 ≥ 0.02) 화소까지 거리(화소). 비하늘이 없으면 무한."""
    from scipy.ndimage import distance_transform_edt
    if sky.all():
        return np.full(sky.shape, np.inf)
    return distance_transform_edt(sky)


def sky_row(rgb_b, al_b, rgb_e, al_e, el):
    """한 행. 반환: scope(하늘이 있는 행인지) · d(띠별 평균 휘도 |ln 비|의 최대; 공유 하늘 < 200 이면 SHARED_FAIL) · mem(열린 하늘 소속 변화).
    rgb 는 0..255, 알파는 0..1, el 은 화소 고도(°)."""
    up = el > SKY_EL_MIN
    sb, se = (al_b < SKY_ALPHA) & up, (al_e < SKY_ALPHA) & up
    out = {'nB': int(sb.sum()), 'nE': int(se.sum())}
    if out['nB'] < SKY_MIN_PX and out['nE'] < SKY_MIN_PX:
        out.update({'scope': False, 'd': None, 'mem': None})
        return out
    out['scope'] = True
    S = sb & se; n = int(S.sum()); out['n'] = n
    Lb, _ = fm.luminance(rgb_b); Le, _ = fm.luminance(rgb_e)
    if n < SKY_MIN_PX:
        out['d'] = SHARED_FAIL; out['note'] = '공유 하늘 < 200'
    else:
        bands = {}
        for lo, hi in BANDS:
            m = S & (el > lo) & (el <= hi)
            if m.sum() >= SKY_MIN_PX:
                mb, me = float(Lb[m].mean()), float(Le[m].mean())
                bands['%g-%g' % (lo, hi)] = abs(math.log(me / mb)) if mb > 0 and me > 0 else (0.0 if mb == me == 0 else SHARED_FAIL)
        if bands:
            out['d'] = float(max(bands.values()))
        else:
            mb, me = float(Lb[S].mean()), float(Le[S].mean())
            out['d'] = abs(math.log(me / mb)) if mb > 0 and me > 0 else (0.0 if mb == me == 0 else SHARED_FAIL)
        out['bands'] = bands
        mdb, mde = float(np.median(Lb[S])), float(np.median(Le[S]))
        out['medianD'] = abs(math.log(mde / mdb)) if mdb > 0 and mde > 0 else None   # 기록(옛 꼴의 중앙값 비)
    # 소속 조항: 구름에서 8 화소 넘게 떨어진 열린 하늘이 상대 그림에서 알파 ≥ 0.02 가 된 몫
    ob = sb & (_edt(al_b < SKY_ALPHA) > MEM_EDT); oe = se & (_edt(al_e < SKY_ALPHA) > MEM_EDT)
    lost = float((ob & (al_e >= SKY_ALPHA)).sum() / ob.sum()) if ob.sum() >= SKY_MIN_PX else None
    gained = float((oe & (al_b >= SKY_ALPHA)).sum() / oe.sum()) if oe.sum() >= SKY_MIN_PX else None
    vals = [v for v in (lost, gained) if v is not None]
    out.update({'lost': lost, 'gained': gained, 'nOB': int(ob.sum()), 'nOE': int(oe.sum()), 'mem': float(max(vals)) if vals else None})
    return out


def scene_values(per):
    """장면 값 = 방위 최대(한 방위만의 변화도 잡음)."""
    return {k: float(max(v)) for k, v in per.items() if v}


def g2s(S, root, base, cand, scenes=None, perturb=None, full=True):
    """G2 하늘 조항. perturb = 동결 전 대조용 콜백(장면, 방위, rgbB, aB, rgbE, aE, el) → 같은 넷(판정에는 안 씀).
    full = 모든 non-record 장면의 세 방위가 다 있어야 함(빠지면 평가 불가)."""
    (ba, bt), (ea, et) = arm_tag(base), arm_tag(cand)
    rows, per, mem, missing = [], {}, {}, []
    keys = [k for k, s in S['scenes'].items() if not s.get('record') and (not scenes or k in scenes)]
    for key in keys:
        for az in ('t', 's', 'a'):
            B, E = job_paths(root, ba, bt, key, az), job_paths(root, ea, et, key, az)
            if B is None or E is None:
                missing.append(key + ':' + az); continue
            if (B['el'], B['fov'], B['rows'], B['W'], B['H']) != (E['el'], E['fov'], E['rows'], E['W'], E['H']):
                raise ValueError('카메라·캔버스가 다름 %s:%s' % (key, az))
            rgb_b, al_b, rgb_e, al_e = load_rgb(B['png']), load_alpha(B['alpha']), load_rgb(E['png']), load_alpha(E['alpha'])
            h, w = al_b.shape
            W, H = (B['W'] or w), (B['H'] or h)
            rr = np.arange(*B['rows']) if B.get('rows') else None
            el = G.pixel_elevation(W, H, B['el'], B['fov'], rr)
            if el.shape != al_b.shape:
                raise ValueError('고도 격자와 그림 크기가 다름 %s:%s' % (key, az))
            if perturb is not None:
                rgb_b, al_b, rgb_e, al_e = perturb(key, az, rgb_b, al_b, rgb_e, al_e, el)
            r = sky_row(rgb_b, al_b, rgb_e, al_e, el)
            r.update({'scene': key, 'az': az})
            rows.append(r)
            if r['scope']:
                per.setdefault(key, []).append(r['d'])
                if r['mem'] is not None:
                    mem.setdefault(key, []).append(r['mem'])
    sv, mv = scene_values(per), scene_values(mem)
    out = {'rows': rows, 'scene': sv, 'memScene': mv, 'nScenes': len(sv), 'nMemScenes': len(mv), 'nRows': len(rows),
           'nRowsValid': sum(r['scope'] for r in rows), 'missing': missing, 'expectedRows': 3 * len(keys)}
    out.update(g2s_decide(sv, mv, missing if full else []))
    return out


def g2s_decide(sv, mv, missing=()):
    """G2 하늘 조항의 판정(순수 함수). sv = 장면별 휘도 값, mv = 장면별 소속 값."""
    if missing:
        return {'pass': None, 'note': '행 빠짐 %d — 평가 불가' % len(missing)}
    if len(sv) < G2S_MIN_SCENES or len(mv) < G2S_MIN_SCENES:
        return {'pass': None, 'note': '유효 장면 < %d — 평가 불가' % G2S_MIN_SCENES}
    vals, mvals = list(sv.values()), list(mv.values())
    o = {'share': float(np.mean([v <= G2S_TOL for v in vals])), 'max': float(max(vals)),
         'memShare': float(np.mean([v <= MEM_TOL for v in mvals])), 'memMax': float(max(mvals))}
    o['lumPass'] = bool(o['share'] >= G2S_SHARE and o['max'] <= G2S_CAP)
    o['memPass'] = bool(o['memShare'] >= MEM_SHARE and o['memMax'] <= MEM_CAP)
    o['pass'] = bool(o['lumPass'] and o['memPass'])
    return o


# ── 동결 전 대조용 교란(판정에는 안 씀) ──
def _lin(u):
    c = np.clip(u, 0, 255) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _enc(lin):
    lin = np.clip(lin, 0, 1)
    return np.clip(np.round(255 * np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)), 0, 255)


def _row_seed(seed, key, az):
    return int(hashlib.sha1(('%d|%s|%s' % (seed, key, az)).encode()).hexdigest()[:8], 16)


def pert_gain(gain, seed=0, az_set='tsa', scene_set=None, el_lo=None, el_hi=None, dequant=True):
    """선형 휘도 × gain(고도 띠·방위·장면 한정 가능). dequant: B·E 둘 다 코드 + 같은 U(−½, ½) 로 되돌린 뒤 다시 부호화(E 에만 gain)."""
    def f(key, az, rb, ab, re_, ae, el):
        u = np.random.default_rng(_row_seed(seed, key, az)).uniform(-0.5, 0.5, rb.shape) if dequant else 0.0
        lb, le = _lin(rb + u), _lin(re_ + u)
        g = np.ones(el.shape)
        if az in az_set and (scene_set is None or key in scene_set):
            m = np.ones(el.shape, bool)
            if el_lo is not None:
                m &= el > el_lo
            if el_hi is not None:
                m &= el <= el_hi
            g[m] = gain
        return _enc(lb), ab, _enc(le * g[..., None]), ae
    return f


def pert_veil(alpha_to=0.05, lgain=1.10, el_hi=20.0, scene_set=None):
    """열린 하늘(알파_B < 0.02, 0 < 고도 ≤ el_hi)에 얇은 막: 알파_E → alpha_to, 휘도 × lgain."""
    def f(key, az, rb, ab, re_, ae, el):
        if scene_set is not None and key not in scene_set:
            return rb, ab, re_, ae
        m = (ab < SKY_ALPHA) & (el > 0) & (el <= el_hi)
        ae2 = ae.copy(); ae2[m] = np.maximum(ae2[m], alpha_to)
        lin = _lin(re_); lin[m] *= lgain
        return rb, ab, _enc(lin), ae2
    return f


def pert_alpha_add(add=0.01, below=0.01):
    """알파_E = 알파_B + add (알파_B < below 인 화소) — 하늘 소속이 안 바뀌는 작은 변화(통과해야 함)."""
    def f(key, az, rb, ab, re_, ae, el):
        ae2 = ae.copy(); m = ab < below; ae2[m] = ab[m] + add
        return rb, ab, re_, ae2
    return f


def pert_ring(width=2.0, lgain=1.10):
    """구름(알파_B ≥ 0.02) 바깥 width 화소 고리의 휘도 × lgain — 기록용."""
    def f(key, az, rb, ab, re_, ae, el):
        m = (ab < SKY_ALPHA) & (_edt(ab < SKY_ALPHA) <= width)
        lin = _lin(re_); lin[m] *= lgain
        return rb, ab, _enc(lin), ae
    return f


# ═════════ G3 CLIP 라벨(§3) ═════════
_J2 = None
_CFG = None


def _judge2():
    global _J2
    if _J2 is None:
        sys.path.insert(0, CLIPDIR)
        import judge2  # noqa: E402  (동결 판정기 — prep·vis·class_embeds·probs 를 그대로)
        names, C = judge2.class_embeds('genus')
        _J2 = (judge2, names, C)
    return _J2


def clip_cfg():
    """CLIP 점수에 영향을 주는 것 전부의 해시(코드·무게·문장·판·설정). 캐시 열쇠와 기록에 씀."""
    global _CFG
    if _CFG is None:
        import onnxruntime
        import PIL
        import tokenizers
        f = lambda n: sha256(os.path.join(CLIPDIR, n))  # noqa: E731
        import inspect
        code = hashlib.sha256(inspect.getsource(clip_smooth).encode()).hexdigest()   # 점수 코드만(다른 곳을 고쳐도 캐시 유지)
        parts = {'clipSmoothSrc': code, 'judge2': f('judge2.py'), 'vision': f('vision_model_quantized.onnx'),
                 'text': f('text_model_quantized.onnx'), 'tokenizer': f('tokenizer.json'), 'prompts2': f('prompts2.json'),
                 'ort': onnxruntime.__version__, 'numpy': np.__version__, 'PIL': PIL.__version__, 'cpu': os.cpu_count(),
                 'affinity': sorted(os.sched_getaffinity(0)), 'tokenizers': tokenizers.__version__, 'python': sys.version.split()[0],
                 'K': G3_K, 'seed0': G3_SEED0, 'top': G3_TOP}
        _CFG = (hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest(), parts)
    return _CFG


def load_cache(p):
    if not p or not os.path.exists(p):
        return {'cfg': clip_cfg()[0], 'entries': {}}
    c = json.load(open(p))
    if c.get('cfg') != clip_cfg()[0]:
        return {'cfg': clip_cfg()[0], 'entries': {}, 'discarded': c.get('cfg')}
    return c


def save_cache(p, c):
    if p and c is not None:
        tmp = '%s.%d.tmp' % (p, os.getpid()); json.dump({'cfg': c['cfg'], 'entries': c['entries']}, open(tmp, 'w')); os.replace(tmp, p)


def clip_smooth(png, cache=None, top=G3_TOP):
    """그림 하나: K 개 ±1 LSB 떨림 복사본을 하나씩(배치 1) 넣은 확률(float64). 반환 (평균 확률, 이름, 복사본별 확률 K×C).
    top = 위쪽 자름(렌더 0.78; 사진 검증은 사진마다의 자름)."""
    j2, names, C = _judge2()
    key = sha256(png) + ('' if top == G3_TOP else '|top%.4f' % top)
    ent = cache['entries'] if cache is not None else None
    if ent is not None and key in ent:
        P = np.array(ent[key]['P'], dtype=np.float64)
        return P.mean(0), names, P
    a = np.asarray(Image.open(png).convert('RGB')).astype(np.int16)
    P = []
    for k in range(G3_K):
        rng = np.random.default_rng(G3_SEED0 + k)
        x = np.clip(a + rng.integers(-1, 2, size=a.shape), 0, 255).astype(np.uint8)
        e = j2.vis().run(None, {'pixel_values': np.stack([j2.prep(Image.fromarray(x), top)])})[0]
        e = e / np.linalg.norm(e, axis=1, keepdims=True)
        P.append(j2.probs(e, C)[0])
    P = np.array([[float(v) for v in row] for row in P], dtype=np.float64)   # 캐시와 같은 수(float32 → float64 → JSON 이 되돌아옴)
    if ent is not None:
        ent[key] = {'P': [[float(v) for v in row] for row in P], 'png': png}
    return P.mean(0), names, P


def margin_of(p, names, gen):
    ok = G3_OK[gen]
    pc = max(p[i] for i, n in enumerate(names) if n in ok)
    po = max(p[i] for i, n in enumerate(names) if n not in ok)
    return float(math.log(pc / po))


def score_image(png, gen, cache=None):
    p, names, P = clip_smooth(png, cache)
    m = margin_of(p, names, gen)
    md = [margin_of(P[k], names, gen) for k in range(len(P))]
    se = float(np.std(md, ddof=1) / math.sqrt(len(md))) if len(md) > 1 else None
    lab = names[int(np.argmax(p))]
    return {'label': lab, 'hit': bool(lab in G3_OK[gen]), 'margin': round(m, 5), 'se': None if se is None else round(se, 5),
            'near': bool(se is not None and abs(m) < 2 * se)}


def load_near():
    """동결된 δ. CLIP 설정 해시가 동결 때와 다르면 None(G3 평가 불가)."""
    if not os.path.exists(NEAR_FILE):
        return None
    d = json.load(open(NEAR_FILE))
    return d.get('near') if d.get('clipCfg') == clip_cfg()[0] else None


def provenance(clip=True):
    """보고서가 어느 코드로 만들어졌는지(동결 때 대조)."""
    f = lambda n: sha256(os.path.join(HERE, n))  # noqa: E731
    p = {'grain2Sha256': f('grain2.py'), 'testSha256': f('grain2-test.py'), 'photosSha256': f('grain2-photos.py')}
    if clip:
        p['clipCfg'] = clip_cfg()[0]
    return p


def g3_lost(mB, mE, scenes=('ac60_e20', 'ac60_e45', 'ci60_e20', 'ci60_e45')):
    """여백 [4 × 3] 두 벌 → 종류별 잃은 그림 목록(맞음 ⇔ 여백 > 0). 시험·검산용 순수 함수."""
    lost = {'AcCc': [], 'Ci': []}
    for i, sc in enumerate(scenes):
        gen = 'AcCc' if sc.startswith('ac60') else 'Ci'
        for j, az in enumerate('tsa'):
            if mB[i][j] > 0 and not mE[i][j] > 0:
                lost[gen].append({'scene': sc, 'az': az, 'mB': float(mB[i][j]), 'mE': float(mE[i][j])})
    return lost


def g3_rule(lost, near):
    """종류마다: 잃은 그림(B 맞음 → E 틀림)이 없거나, 하나이고 그 그림의 B 여백 ≤ near. 얻은 것은 잃은 것을 메우지 않음."""
    if near is None:
        return None
    return bool(all(len(L) == 0 or (len(L) == 1 and L[0]['mB'] <= near) for L in lost.values()))


def g3(root, base, cand, cache=None, swap=None, transform=None, near='frozen'):
    """G3. swap = 대조용 {층 또는 장면: 다른 층}(E 쪽 그림을 바꿔 넣음), transform = 대조용 E 그림 변환(경로 → 경로). 판정에는 안 씀."""
    if near == 'frozen':
        near = load_near()
    (ba, bt), (ea, et) = arm_tag(base), arm_tag(cand)
    out = {'scenes': {}, 'near': near}
    lost = {g: [] for _, g in G3_UNITS}
    missing = False
    for layer, gen in G3_UNITS:
        for time in G3_TIMES:
            sc = layer + '_' + time
            rec = {}
            for tag, arm, t in (('B', ba, bt), ('E', ea, et)):
                lay = ((swap or {}).get(sc) or (swap or {}).get(layer) or layer) if tag == 'E' else layer
                labs = []
                for az in ('t', 's', 'a'):
                    jp = job_paths(root, arm, t, lay + '_' + time, az)
                    if jp is None:
                        labs = None; break
                    png = jp['png']
                    if tag == 'E' and transform is not None:
                        png = transform(png, sc, az)
                    s = score_image(png, gen, cache); s['az'] = az
                    labs.append(s)
                rec[tag] = None if labs is None else {'hits': sum(x['hit'] for x in labs), 'labels': labs}
            out['scenes'][sc] = rec
            if rec['B'] is None or rec['E'] is None:
                missing = True; continue
            for lb, le in zip(rec['B']['labels'], rec['E']['labels']):
                if lb['hit'] and not le['hit']:
                    lost[gen].append({'scene': sc, 'az': lb['az'], 'mB': lb['margin'], 'mE': le['margin']})
    out['lost'] = lost
    if not missing:
        for _, gen in G3_UNITS:
            sc_g = [k for k in out['scenes'] if k.startswith('ac60' if gen == 'AcCc' else 'ci60')]
            out.setdefault('sumB', {})[gen] = sum(out['scenes'][k]['B']['hits'] for k in sc_g)
            out.setdefault('sumE', {})[gen] = sum(out['scenes'][k]['E']['hits'] for k in sc_g)
            dm = [le['margin'] - lb['margin'] for k in sc_g for lb, le in zip(out['scenes'][k]['B']['labels'], out['scenes'][k]['E']['labels']) if lb['hit']]
            out.setdefault('dMarginHitB', {})[gen] = float(np.mean(dm)) if dm else None
    if missing:
        out['pass'] = None; out['note'] = '그림 없음 — 평가 불가'
    elif near is None:
        out['pass'] = None; out['note'] = 'g3-near.json 없음(동결 전) — 평가 불가'
    else:
        out['pass'] = g3_rule(lost, near)
    out['clipCfg'] = clip_cfg()[0]
    return out


def g3_margins(root, arm, tag, cache):
    """G3 12 장의 여백 [4 장면 × 3 방위] (장면 순서 ac60_e20, ac60_e45, ci60_e20, ci60_e45)."""
    M = []
    for layer, gen in G3_UNITS:
        for time in G3_TIMES:
            row = []
            for az in ('t', 's', 'a'):
                jp = job_paths(root, arm, tag, layer + '_' + time, az)
                if jp is None:
                    return None
                row.append(score_image(jp['png'], gen, cache)['margin'])
            M.append(row)
    return np.array(M)


def g3_pff(mB, sigma, near, n=PFF_N, seed=PFF_SEED, shift=None):
    """규칙이 실패할 확률: E_i ~ N(m_B,i (+ shift), 2σ²), 그림끼리 독립. shift = {종류: 더할 값}(검정력)."""
    rng = np.random.default_rng(seed)
    mB = np.asarray(mB, float).reshape(4, 3)
    gens = ['AcCc', 'AcCc', 'Ci', 'Ci']
    mu = mB.copy()
    if shift:
        for i, g in enumerate(gens):
            mu[i] += shift.get(g, 0.0)
    E = mu[None] + rng.standard_normal((n, 4, 3)) * math.sqrt(2) * sigma
    hitB = mB > 0
    lostm = hitB[None] & (E <= 0)
    fail = np.zeros(n, bool)
    for rows in ((0, 1), (2, 3)):
        L = lostm[:, rows, :].reshape(n, -1)
        mb = mB[list(rows), :].reshape(-1)
        cnt = L.sum(1)
        one_near = (cnt == 1) & (L & (mb[None] <= near)).any(1)
        fail |= ~((cnt == 0) | one_near)
    return float(fail.mean())


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


def combine_g2(g2old, sky):
    """G2 = 새 하늘 조항 ∧ 옛 구름 조항 ∧ 옛 포화 조항. 구름·포화가 실패면 실패, 아니면 하늘 조항(None 이면 None)."""
    cs, cm, sm = g2old.get('cloudShare'), g2old.get('cloudMax'), g2old.get('satMax')
    num = lambda x: isinstance(x, (int, float)) and not (isinstance(x, float) and math.isnan(x))  # noqa: E731
    cloud_ok = bool(num(cs) and cs >= 0.9 and num(cm) and cm <= G.G2_CLOUD_MAX and num(sm) and sm <= G.G2_SAT)
    if not cloud_ok:
        return False
    return None if sky.get('pass') is None else bool(sky['pass'])


def rejudge(old, S, root, cache=None):
    """옛 게이트 문서 + 새 G2 하늘·G3 → 새 게이트 문서."""
    doc = json.loads(json.dumps(old))
    base, cand = doc['base'], doc['cand']
    g2old = doc['guards']['G2']
    sky = g2s(S, root, base, cand)
    g2 = {'old': g2old, 'sky': {k: sky[k] for k in sky if k != 'rows'}, 'skyRows': sky['rows'],
          'cloudShare': g2old.get('cloudShare'), 'cloudMax': g2old.get('cloudMax'), 'satMax': g2old.get('satMax')}
    g2['pass'] = combine_g2(g2old, sky)
    doc['guards']['G2'] = g2
    g3old = doc['guards'].get('G3')
    g3new = g3(root, base, cand, cache)
    g3new['old'] = g3old
    doc['guards']['G3'] = g3new
    gfail, gnone, status = restatus(doc)
    doc.update({'ruler': 'RULER-grain2', 'grainSha256': G.grain_sha256(), 'grain2Sha256': sha256(os.path.abspath(__file__)),
                'clipCfg': clip_cfg()[0], 'near': g3new.get('near'),
                'oldStatus': old.get('status'), 'oldGuardFail': old.get('guardFail'), 'oldGuardUnknown': old.get('guardUnknown'),
                'rejudgeDate': __import__('datetime').date.today().isoformat(), 'guardFail': gfail, 'guardUnknown': gnone, 'status': status})
    return doc


# ═════════ 동결 전 검증(§4) ═════════
def _strip(r):
    return {k: r[k] for k in r if k != 'rows'}


def _tmp_png(arr, tag):
    d = os.environ.get('GRAIN2_TMP', '/tmp/grain2-ctl'); os.makedirs(d, exist_ok=True)
    a = np.clip(np.round(arr), 0, 255).astype(np.uint8)
    q = os.path.join(d, hashlib.sha1(a.tobytes() + tag.encode()).hexdigest() + '.png')
    if not os.path.exists(q):
        Image.fromarray(a).save(q)
    return q


def tf_blur(sigma):
    def f(png, sc, az):
        im = Image.open(png).convert('RGB').filter(ImageFilter.GaussianBlur(sigma))
        return _tmp_png(np.asarray(im).astype(np.float64), 'blur%g' % sigma)
    return f


def tf_blend(root, other_arm, other_tag, other_layer, w):
    """선형 빛에서 다른 층 그림과 섞음(기록용 용량-반응)."""
    def f(png, sc, az):
        jp = job_paths(root, other_arm, other_tag, other_layer + '_' + sc.split('_')[1], az)
        a, b = _lin(load_rgb(png)), _lin(load_rgb(jp['png']))
        return _tmp_png(_enc((1 - w) * a + w * b), 'blend%s%g' % (other_layer, w))
    return f


G2S_CTL_FAIL = {   # 이름 → (지켜야 할 조항, 만드는 법) — 반드시 실패
    'gain1.015': 'lum', 'gain1.015_t': 'lum', 'gain1.015_s': 'lum', 'gain1.015_a': 'lum',
    'T_gain1.05_el0-5': 'lum', 'T_gain1.03_el0-10': 'lum', 't_gain1.03': 'lum', 't_gain1.05_el0-15': 'lum', '3scenes_gain1.02': 'lum',
    'veil_el0-20': 'mem', 'veil_el0-12_a0.03': 'mem', 'veil_all_9scenes': 'any'}
G2S_CTL_PASS = ('gain1.005_dq', 'alpha_add0.01')
G2S_CTL_REC = ('ring2_1.10',)
G2S_CTL_BASES = ('C0', 'C0:AA777')
G2S_RATES = {'gain1.0025': (1.0025, 'ge', 0.95), 'gain1.01': (1.01, 'le', 0.05)}
G3_CTL_FAIL = ('swap ci60→sc85', 'swap ac60→cu35', 'swap ci60_e45→sc85', 'swap ci60_e20→sc85', 'swap ac60_e45→cu35', 'swap ac60_e20→cu35',
               'swap ci60→ac60', 'swap ac60→sc25', 'blur2 ci60', 'blur2 ac60')


def g2s_controls(S, open_sky):
    T = [k for k, s in S['scenes'].items() if s['bundle'] in ('T', 'T4') and not s.get('record')]
    nine, three = open_sky[:9], open_sky[:3]
    f = {
        'gain1.015': pert_gain(1.015, seed=1), 'gain1.015_t': pert_gain(1.015, seed=1, az_set='t'),
        'gain1.015_s': pert_gain(1.015, seed=1, az_set='s'), 'gain1.015_a': pert_gain(1.015, seed=1, az_set='a'),
        'T_gain1.05_el0-5': pert_gain(1.05, seed=1, scene_set=T, el_lo=0, el_hi=5),
        'T_gain1.03_el0-10': pert_gain(1.03, seed=1, scene_set=T, el_lo=0, el_hi=10),
        't_gain1.03': pert_gain(1.03, seed=1, az_set='t'), 't_gain1.05_el0-15': pert_gain(1.05, seed=1, az_set='t', el_lo=0, el_hi=15),
        '3scenes_gain1.02': pert_gain(1.02, seed=1, scene_set=three),
        'veil_el0-20': pert_veil(0.05, 1.10, 20.0), 'veil_el0-12_a0.03': pert_veil(0.03, 1.10, 12.0),
        'veil_all_9scenes': pert_veil(0.05, 1.0, 90.0, scene_set=nine),
        'gain1.005_dq': pert_gain(1.005, seed=1), 'alpha_add0.01': pert_alpha_add(0.01, 0.01), 'ring2_1.10': pert_ring(2.0, 1.10)}
    assert set(f) == set(G2S_CTL_FAIL) | set(G2S_CTL_PASS) | set(G2S_CTL_REC)
    return f


def aa_report(S, root, cache, cache_path=None, log=print):
    """A/A 쌍과 합성 대조. 후보 팔 렌더는 읽지 않음."""
    import scipy
    rep = {'provenance': provenance(), 'clipCfg': clip_cfg()[0], 'clipCfgParts': clip_cfg()[1], 'scipy': scipy.__version__,
           'g2s': {}, 'g2sCtl': {}, 'g2sRate': {}, 'g3': {}, 'g3Ctl': {}, 'g3Rec': {}}
    # ── G2s A/A ──
    r = g2s(S, root, 'C0', 'C0:AA777'); rep['g2s']['C0|C0:AA777'] = _strip(r); log('g2s C0|AA777', r.get('pass'), r.get('max'), r.get('memMax'))
    for b, e in (('C0:P8A', 'C0:P8B'), ('C0:P8A', 'C0:P8n777'), ('C0:P8A', 'C0:P8n4242'), ('C0:P8n777', 'C0:P8n4242')):
        r = g2s(S, root, b, e, full=False); x = _strip(r)
        x['devMax'] = float(max(r['scene'].values())) if r['scene'] else None
        x['devMemMax'] = float(max(r['memScene'].values())) if r['memScene'] else None
        rep['g2s'][b + '|' + e] = x; log('g2s', b, e, x['devMax'], x['devMemMax'])
    # ── G2s 대조(반드시 실패 / 반드시 통과 / 기록), C0 와 AA777 위에서 둘 다 ──
    ctl = g2s_controls(S, sorted(rep['g2s']['C0|C0:AA777']['scene']))
    for base_e in G2S_CTL_BASES:
        for nm, f in ctl.items():
            r = g2s(S, root, 'C0', base_e, perturb=f)
            x = {k: r.get(k) for k in ('pass', 'lumPass', 'memPass', 'share', 'max', 'memShare', 'memMax', 'nScenes', 'note')}
            x['want'] = 'fail' if nm in G2S_CTL_FAIL else ('pass' if nm in G2S_CTL_PASS else 'record')
            x['wantClause'] = G2S_CTL_FAIL.get(nm)
            rep['g2sCtl'][base_e + '|' + nm] = x; log('g2s ctl', base_e, nm, x['pass'], x['lumPass'], x['memPass'], x['max'], x['memMax'])
    for base_e in G2S_CTL_BASES:
        for nm, (gain, _, _) in G2S_RATES.items():
            ps = [g2s(S, root, 'C0', base_e, perturb=pert_gain(gain, seed=100 + sd)).get('pass') is True for sd in range(20)]
            rep['g2sRate'][base_e + '|' + nm] = {'passRate': float(np.mean(ps)), 'n': len(ps)}; log('g2s rate', base_e, nm, np.mean(ps))
    # ── G3 A/A: 여백 36 개 · σ · near · 6 순서쌍 · P_FF · 검정력 ──
    reals = {'C0': 'C0', 'AA777': 'C0:AA777', 'AA4242': 'C0:AA4242'}
    M = {}
    for k, armtag in reals.items():
        a_, t_ = arm_tag(armtag)
        M[k] = g3_margins(root, a_, t_, cache); save_cache(cache_path, cache)
        log('g3 margins', k, None if M[k] is None else np.round(M[k], 3).tolist())
    rep['g3']['margins'] = {k: (None if v is None else v.tolist()) for k, v in M.items()}
    if all(v is not None for v in M.values()):
        X = np.stack([M['C0'], M['AA777'], M['AA4242']])           # 3 × 4 × 3
        s2 = float(((X - X.mean(0)) ** 2).sum() / (12 * (3 - 1)))  # 그림 안 분산을 모음(자유도 24)
        sig = math.sqrt(s2); sigU = sig * math.sqrt(24 / CHI2_10_24)
        dmax = float(max(np.abs(X[i] - X[j]).max() for i in range(3) for j in range(3) if i < j))
        near = max(G3_NEAR_FLOOR, dmax)
        rep['g3'].update({'sigma': sig, 'sigmaU': sigU, 'aaMaxAbsDm': dmax, 'near': near})
        rep['g3']['pff'] = g3_pff(M['C0'], sigU, near)
        rep['g3']['power'] = {g: float(g3_pff(M['C0'], sigU, near, shift={g: -POWER_SHIFT})) for g in ('AcCc', 'Ci')}   # 한 종류 여백 −1 일 때 실패율
        log('g3 sigma', sig, 'sigmaU', sigU, 'near', near, 'pff', rep['g3']['pff'], 'power(fail rate)', rep['g3']['power'])
        for i in reals:
            for j in reals:
                if i != j:
                    r = g3(root, reals[i], reals[j], cache, near=near)
                    rep['g3']['pair %s|%s' % (i, j)] = {'pass': r['pass'], 'lost': r['lost'], 'sumB': r.get('sumB'), 'sumE': r.get('sumE')}
                    log('g3 pair', i, j, r['pass'])
        save_cache(cache_path, cache)
        # ── G3 대조(반드시 실패): B = C0, E 는 AA777 그림에서 ──
        spec = {
            'swap ci60→sc85': ({'ci60': 'sc85'}, None), 'swap ac60→cu35': ({'ac60': 'cu35'}, None),
            'swap ci60_e45→sc85': ({'ci60_e45': 'sc85'}, None), 'swap ci60_e20→sc85': ({'ci60_e20': 'sc85'}, None),
            'swap ac60_e45→cu35': ({'ac60_e45': 'cu35'}, None), 'swap ac60_e20→cu35': ({'ac60_e20': 'cu35'}, None),
            'swap ci60→ac60': ({'ci60': 'ac60'}, None), 'swap ac60→sc25': ({'ac60': 'sc25'}, None),
            'blur2 ci60': ({}, ('ci60', tf_blur(2.0))), 'blur2 ac60': ({}, ('ac60', tf_blur(2.0))),
        }
        assert tuple(spec) == G3_CTL_FAIL
        for nm, (sw, tf) in spec.items():
            trans = None
            if tf:
                lay, fn = tf; trans = (lambda fn_, lay_: (lambda png, sc, az: fn_(png, sc, az) if sc.startswith(lay_) else png))(fn, lay)
            r = g3(root, 'C0', 'C0:AA777', cache, swap=sw, transform=trans, near=near)
            rep['g3Ctl'][nm] = {'pass': r['pass'], 'lost': r['lost'], 'want': 'fail'}; log('g3 ctl', nm, r['pass']); save_cache(cache_path, cache)
        for nm, tf in (('blur1 all', tf_blur(1.0)), ('blur2 all', tf_blur(2.0)), ('blend sc85 0.25 ci60', tf_blend(root, 'C0', 'AA777', 'sc85', 0.25)),
                       ('blend sc85 0.5 ci60', tf_blend(root, 'C0', 'AA777', 'sc85', 0.5))):
            trans = tf if not nm.endswith('ci60') else (lambda fn_: (lambda png, sc, az: fn_(png, sc, az) if sc.startswith('ci60') else png))(tf)
            r = g3(root, 'C0', 'C0:AA777', cache, transform=trans, near=near)
            rep['g3Rec'][nm] = {'pass': r['pass'], 'lost': r['lost'], 'dMarginHitB': r.get('dMarginHitB')}; log('g3 rec', nm, r['pass']); save_cache(cache_path, cache)
    rep['accept'] = aa_accept(rep)
    return rep


def aa_accept(rep):
    """받아들임(§4, 미리 정함). 순수 함수 — 시험이 직접 부름. 이름이 다 있어야 함(부분 집합은 안 받아들임)."""
    a = {}
    g = rep['g2s'].get('C0|C0:AA777', {})
    a['g2sAA'] = bool(g.get('pass') is True and g.get('nRows') == g.get('expectedRows') == 108 and not g.get('missing')
                      and g.get('max') is not None and g['max'] <= G2S_TOL / 2 and g.get('memMax') is not None and g['memMax'] <= MEM_TOL / 2)
    dev = {k: v for k, v in rep['g2s'].items() if k.startswith('C0:P8')}
    a['g2sAAdev'] = bool(set(dev) == {'C0:P8A|C0:P8B', 'C0:P8A|C0:P8n777', 'C0:P8A|C0:P8n4242', 'C0:P8n777|C0:P8n4242'}
                         and all(v.get('nScenes') == 6 and v.get('nRowsValid') == 18 and v.get('devMax') is not None and v['devMax'] <= G2S_TOL for v in dev.values()))
    pb = dev.get('C0:P8A|C0:P8B', {})
    a['g2sP8Bexact'] = bool(pb.get('devMax') is not None and pb['devMax'] <= 1e-3)
    ctl = rep.get('g2sCtl', {})
    want = {b + '|' + n for b in G2S_CTL_BASES for n in list(G2S_CTL_FAIL) + list(G2S_CTL_PASS) + list(G2S_CTL_REC)}

    def ok_ctl(v):
        if v['want'] == 'record':
            return True
        if v['want'] == 'pass':
            return v['pass'] is True
        cl = v.get('wantClause')
        return v['pass'] is False and (cl == 'any' or (cl == 'lum' and v.get('lumPass') is False) or (cl == 'mem' and v.get('memPass') is False))
    a['g2sCtl'] = bool(set(ctl) == want and all(ok_ctl(v) for v in ctl.values()))
    rt = rep.get('g2sRate', {})
    a['g2sRate'] = bool(set(rt) == {b + '|' + n for b in G2S_CTL_BASES for n in G2S_RATES} and all(
        (rt[k]['passRate'] >= G2S_RATES[k.split('|')[1]][2]) if G2S_RATES[k.split('|')[1]][1] == 'ge' else (rt[k]['passRate'] <= G2S_RATES[k.split('|')[1]][2])
        for k in rt))
    g3_ = rep.get('g3', {})
    a['g3Near'] = bool(g3_.get('near') is not None and g3_['near'] <= G3_NEAR_MAX)
    a['g3Pff'] = bool(g3_.get('pff') is not None and g3_['pff'] <= PFF_MAX)
    a['g3Power'] = bool(set(g3_.get('power') or {}) == {'AcCc', 'Ci'} and all(v >= POWER_MIN for v in g3_['power'].values()))
    c3 = rep.get('g3Ctl', {})
    a['g3Ctl'] = bool(set(c3) == set(G3_CTL_FAIL) and all(v['pass'] is False for v in c3.values()))
    a['all'] = all(a.values())
    return a


def main(argv):
    ap = argparse.ArgumentParser()
    for f in ('--rejudge', '--g2s', '--g3', '--aa'):
        ap.add_argument(f, action='store_true')
    for f in ('--old', '--scenes', '--renders', '--out', '--base', '--cand', '--cache', '--near-out'):
        ap.add_argument(f)
    args = ap.parse_args(argv)
    cache = load_cache(args.cache)
    if args.rejudge:
        if load_near() is None:
            print('g3-near.json 없음 — 동결 전에는 rejudge 를 하지 않음', file=sys.stderr); return 2
        S = json.load(open(args.scenes)); old = json.load(open(args.old))
        doc = rejudge(old, S, args.renders, cache); save_cache(args.cache, cache)
        json.dump(doc, open(args.out, 'w'), indent=1, default=lambda o: None)
        g2, g3_ = doc['guards']['G2'], doc['guards']['G3']
        print('%s vs %s: 알갱이 %s | 상태 %s (옛 %s) | G2 하늘 %s(max %s · 소속 %s) → G2 %s | G3 잃음 %s → %s | 가드 실패 %s' % (
            doc['cand'], doc['base'], doc['verdict'], doc['status'], doc['oldStatus'], g2['sky'].get('pass'), g2['sky'].get('max'), g2['sky'].get('memMax'),
            g2['pass'], {k: len(v) for k, v in g3_['lost'].items()}, g3_['pass'], doc['guardFail']))
    elif args.g2s:
        S = json.load(open(args.scenes)); r = g2s(S, args.renders, args.base, args.cand)
        print(json.dumps(_strip(r), ensure_ascii=False))
    elif args.g3:
        r = g3(args.renders, args.base, args.cand, cache); save_cache(args.cache, cache)
        print(json.dumps(r, ensure_ascii=False))
    elif args.aa:
        S = json.load(open(args.scenes)); rep = aa_report(S, args.renders, cache, args.cache); save_cache(args.cache, cache)
        json.dump(rep, open(args.out, 'w'), indent=1, ensure_ascii=False)
        if args.near_out and rep['g3'].get('near') is not None:
            json.dump({'near': rep['g3']['near'], 'from': os.path.basename(args.out), 'sigmaU': rep['g3'].get('sigmaU'),
                       'aaMaxAbsDm': rep['g3'].get('aaMaxAbsDm'), 'clipCfg': rep['clipCfg']}, open(args.near_out, 'w'), indent=1)
        print(json.dumps(rep['accept'], ensure_ascii=False))
    else:
        ap.print_help(); return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
