#!/usr/bin/env python3
"""grain2-test.py — RULER-grain2 합성 시험(렌더 없이, 그리고 R1 게이트 파일로 상태 규칙 대조).
  python3 tools/genus-ruler/grain2/grain2-test.py [--r1 DIR_WITH_gate-R1-*.json] [--clip]
결과 JSON 한 줄(통과·실패 수와 시험별 값)을 마지막 줄에 찍고, 실패가 있으면 종료 코드 1.
"""
import json, math, os, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grain2 as G2  # noqa: E402
G = G2.G
res = []


def check(name, ok, **v):
    res.append({'name': name, 'ok': bool(ok), **v})


def lin2srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.clip(np.round(255 * np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)), 0, 255).astype(np.uint8)


def make_scene(W=390, H=584, el=20, fov=60, rim=0.012, seed=0):
    """하늘(위로 갈수록 밝기 기울기) + 지평선 아래 검은 땅 + 구름 덩어리와 얇은 테두리(알파 rim)."""
    rng = np.random.default_rng(seed)
    e = G.pixel_elevation(W, H, el, fov)
    sky = 0.05 + 0.5 * np.clip(e / 40.0, 0, 1)
    L = np.where(e > 0, sky, 0.004)
    a = np.zeros((H, W))
    yy, xx = np.mgrid[0:H, 0:W]
    for cy, cx, r in ((120, 100, 60), (200, 290, 70), (330, 180, 50)):
        d = np.hypot(yy - cy, xx - cx)
        a = np.maximum(a, np.where(d < r, 0.9, np.where(d < r + 6, rim, 0)))
    Lc = np.where(a >= 0.15, 0.6 + 0.02 * rng.standard_normal((H, W)), L)
    return Lc, a


def save(d, name, L, a):
    p = os.path.join(d, name + '.png'); q = os.path.join(d, name + '.alpha.png')
    Image.fromarray(np.stack([lin2srgb(L)] * 3, -1)).save(p)
    Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8)).save(q)
    return p, q


with tempfile.TemporaryDirectory() as d:
    Lb, ab = make_scene(rim=0.012)
    Le, ae = make_scene(rim=0.043)          # E: 테두리 알파만 0.012 → 0.043(문턱 0.02 를 넘음), 하늘 화소는 같음
    pb, qb = save(d, 'b', Lb, ab); pe, qe = save(d, 'e', Le, ae)
    r = G2.sky_row(pb, qb, pe, qe, 20, 60)
    check('T1 테두리만 바뀐 그림 — 새 하늘 값 0', r['d'] is not None and r['d'] < 1e-9, d=r['d'], n=r['n'])
    # 옛 정의(그림마다 따로 잡는 전체 화면 마스크)로는 차이가 남을 보임(대조)
    def old_sky(p, q):
        rgb = np.asarray(Image.open(p).convert('RGB')).astype(np.float64); al = np.asarray(Image.open(q).convert('L')) / 255.0
        L, _ = G2.fm.luminance(rgb); return float(np.median(L[al < 0.02]))
    od = abs(math.log(old_sky(pe, qe) / old_sky(pb, qb)))
    check('T2 같은 그림을 옛 정의로 재면 0 이 아님(대조)', od > 1e-4, oldD=od)
    # 지평선 아래 화소가 마스크에 안 들어감
    e = G.pixel_elevation(390, 584, 20, 60)
    check('T3 고도 > 0 행이 위쪽(땅 제외)', (e[:470] > 0).all() and (e[490:] <= 0).all(), firstGroundRow=int(np.argmax(e[:, 195] <= 0)))
    # 노출 1.5 % → 새 하늘 값 ≈ ln 1.015
    pg = G2._gain_png(pb, 1.015)
    r2 = G2.sky_row(pb, qb, pg, qb, 20, 60)
    check('T4 선형 ×1.015 → d ≈ 0.0149(±0.002)', r2['d'] is not None and abs(r2['d'] - math.log(1.015)) < 0.002, d=r2['d'])
    pg2 = G2._gain_png(pb, 1.005)
    r3 = G2.sky_row(pb, qb, pg2, qb, 20, 60)
    check('T5 선형 ×1.005 → d < 0.01', r3['d'] is not None and r3['d'] < 0.01, d=r3['d'])
    # 화소 < 200 이면 행 무효
    a_full = np.ones_like(ab) * 0.9; pf, qf = save(d, 'f', Lb, a_full)
    r4 = G2.sky_row(pf, qf, pf, qf, 20, 60)
    check('T6 하늘 화소 < 200 → 행 무효', r4['d'] is None, n=r4['n'])


# T7 장면 묶음 규칙(진리표): g2s 의 집계 부분을 같은 식으로
def agg(vals):
    if len(vals) < G2.G2S_MIN_SCENES:
        return None
    share = np.mean([v <= G2.G2S_TOL for v in vals]); return bool(share >= G2.G2S_SHARE and max(vals) <= G2.G2S_CAP)
check('T7a 30 장면 모두 0.005 → 통과', agg([0.005] * 30) is True)
check('T7b 30 장면 중 3 개 0.015 (10 %) → 통과', agg([0.005] * 27 + [0.015] * 3) is True)
check('T7c 30 장면 중 4 개 0.015 (13 %) → 실패', agg([0.005] * 26 + [0.015] * 4) is False)
check('T7d 한 장면 0.025 > 상한 0.02 → 실패', agg([0.005] * 29 + [0.025]) is False)
check('T7e 유효 장면 23 → 평가 불가', agg([0.005] * 23) is None)


# T8 G3 규칙(진리표)
def g3rule(B, E):
    ok = all(e >= b - 1 for b, e in zip(B, E)); return bool(ok and sum(E) >= sum(B) - 1)
check('T8a 같음 → 통과', g3rule([3, 1, 2, 1], [3, 1, 2, 1]))
check('T8b 한 장면 −1 → 통과', g3rule([3, 1, 2, 1], [2, 1, 2, 1]))
check('T8c 두 장면 −1 → 실패', not g3rule([3, 1, 2, 1], [2, 0, 2, 1]))
check('T8d 한 장면 −2·다른 장면 +1 → 실패(장면 조건)', not g3rule([3, 1, 2, 1], [1, 2, 2, 1]))
check('T8e 늘기만 → 통과', g3rule([1, 1, 1, 1], [3, 3, 3, 3]))

# T9 상태 규칙 대조: R1 게이트 파일의 옛 가드 값을 그대로 넣으면 옛 상태·실패 목록이 나옴
r1 = None
if '--r1' in sys.argv:
    r1 = sys.argv[sys.argv.index('--r1') + 1]
if r1:
    for arm in ('E1a.3', 'E1a.0', 'E1b'):
        p = os.path.join(r1, 'gate-R1-%s.json' % arm)
        if not os.path.exists(p):
            check('T9 %s 게이트 파일' % arm, False, missing=p); continue
        doc = json.load(open(p))
        gf, gn, st = G2.restatus(doc)
        check('T9 %s 옛 값 → 옛 상태(%s)' % (arm, doc['status']), st == doc['status'] and gf == doc['guardFail'] and gn == doc['guardUnknown'], status=st, gfail=gf)
    # 합성: 가드를 모두 통과로 바꾸면 비용(G8)만 남아 '비용 보류'
    doc = json.load(open(os.path.join(r1, 'gate-R1-E1a.3.json')))
    for k, v in doc['guards'].items():
        if isinstance(v, dict) and 'pass' in v and k != 'G8':
            v['pass'] = True
    check('T9b E1a.3 가드 모두 통과로 → 비용 보류', G2.restatus(doc)[2] == '비용 보류', status=G2.restatus(doc)[2])
    doc['guards']['G8']['pass'] = True
    check('T9c 비용도 통과 → 채택 후보', G2.restatus(doc)[2] == '채택 후보')
    doc['guards']['G3']['pass'] = None
    check('T9d G3 평가 불가 → 가드 미평가', G2.restatus(doc)[2] == '가드 미평가')

# T10 CLIP 결정성(무게가 있을 때만, --clip): 같은 그림 두 번 → 같은 확률, 캐시 열쇠가 설정을 담음
if '--clip' in sys.argv:
    with tempfile.TemporaryDirectory() as d:
        Lb, ab = make_scene(); pb, _ = save(d, 'c', Lb, ab)
        old_k = G2.G3_K; G2.G3_K = 2
        p1, names = G2.clip_smooth(pb, None); p2, _ = G2.clip_smooth(pb, None)
        c = {}; G2.clip_smooth(pb, c)
        G2.G3_K = old_k
        check('T10 CLIP 떨림 평균 결정성(K=2)', np.array_equal(p1, p2) and abs(sum(p1) - 1) < 1e-4 and any('K2|' in k for k in c), p=[round(float(x), 4) for x in p1])

npass = sum(r['ok'] for r in res)
for r in res:
    print(('PASS ' if r['ok'] else 'FAIL ') + r['name'], {k: v for k, v in r.items() if k not in ('name', 'ok')})
print(json.dumps({'pass': npass, 'fail': len(res) - npass, 'grain2Sha256': G2.sha256(os.path.join(HERE, 'grain2.py'))}))
sys.exit(0 if npass == len(res) else 1)
