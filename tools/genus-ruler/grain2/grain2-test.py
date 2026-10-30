#!/usr/bin/env python3
"""grain2-test.py — RULER-grain2 합성 시험(렌더 없이, 그리고 R1 게이트 파일로 상태 규칙 대조).
  python3 tools/genus-ruler/grain2/grain2-test.py [--r1 DIR_WITH_gate-R1-*.json] [--clip]
마지막 줄 = 결과 JSON(통과·실패 수). 실패가 있으면 종료 코드 1. 모든 판정은 grain2.py 의 실제 함수를 부릅니다.
"""
import json, math, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grain2 as G2  # noqa: E402
G = G2.G
res = []


def check(name, ok, **v):
    res.append({'name': name, 'ok': bool(ok), **v})


def make_scene(W=390, H=584, el=20, fov=60, rim=0.012, seed=0, clouds=True):
    """하늘(고도 기울기) + 지평선 아래 검은 땅 + 구름 덩어리(알파 0.9)와 6 화소 테두리(알파 rim). 반환 rgb(0..255) · 알파 · 고도."""
    rng = np.random.default_rng(seed)
    e = G.pixel_elevation(W, H, el, fov)
    L = np.where(e > 0, 0.05 + 0.5 * np.clip(e / 40.0, 0, 1), 0.004)
    a = np.zeros((H, W))
    if clouds:
        yy, xx = np.mgrid[0:H, 0:W]
        for cy, cx, r in ((120, 100, 60), (200, 290, 70), (330, 180, 50)):
            d = np.hypot(yy - cy, xx - cx)
            a = np.maximum(a, np.where(d < r, 0.9, np.where(d < r + 6, rim, 0)))
    L = np.where(a >= 0.15, 0.6 + 0.02 * rng.standard_normal((H, W)), L)
    rgb = np.repeat(G2._enc(L)[..., None], 3, -1)
    return rgb, np.round(a * 255) / 255.0, e


# ── G2s 행 ──
rb, ab, el = make_scene(rim=0.012)
re_, ae, _ = make_scene(rim=0.043)            # E: 테두리 알파만 0.012 → 0.043(문턱 0.02 를 넘음), 하늘 화소는 같음
rim = (ae >= 0.02) & (ae < 0.15)
re_ = np.repeat(G2._enc(G2._lin(re_[..., 0]) * np.where(rim, 1.2, 1.0))[..., None], 3, -1)   # E 의 테두리(0.02 ≤ 알파 < 0.15)만 × 1.2
r = G2.sky_row(rb, ab, re_, ae, el)
Lb_, _ = G2.fm.luminance(rb); Le_, _ = G2.fm.luminance(re_); own = (ab < 0.02) & (el > 0)
alt = abs(math.log(Le_[own].mean() / Lb_[own].mean()))
check('T1 테두리만 바뀜(알파·밝기) → 공유 마스크 하늘 값 0 · 소속 값 0, B 만의 마스크라면 0 아님', r['scope'] and r['d'] < 1e-12 and r['mem'] == 0.0 and alt > 1e-3,
      d=r['d'], mem=r['mem'], n=r['n'], altOwnMask=alt)


def old_sky(rgb, al):
    L, _ = G2.fm.luminance(rgb); return float(np.median(L[al < 0.02]))
od = abs(math.log(old_sky(re_, ae) / old_sky(rb, ab)))
check('T2 같은 그림을 옛 정의(전체 화면·그림마다 마스크·중앙값)로 재면 0 아님(대조)', od > 1e-4, oldD=od)
check('T3 고도 > 0 = 지평선 위만(행 476 부터 땅)', (el[:470] > 0).all() and (el[490:] <= 0).all(), firstGroundRow=int(np.argmax(el[:, 195] <= 0)))
f15 = G2.pert_gain(1.015, seed=3)
b2, a2, e2, a3 = f15('x', 't', rb, ab, rb, ab, el)
r = G2.sky_row(b2, a2, e2, a3, el)
check('T4 되양자화 × 1.015 → d ≈ ln 1.015(±0.001)', abs(r['d'] - math.log(1.015)) < 0.001, d=r['d'])
f05 = G2.pert_gain(1.005, seed=3)
b2, a2, e2, a3 = f05('x', 't', rb, ab, rb, ab, el)
r = G2.sky_row(b2, a2, e2, a3, el)
check('T5 되양자화 × 1.005 → d ≈ 0.005(< 0.01)', abs(r['d'] - math.log(1.005)) < 0.001, d=r['d'])
fb = G2.pert_gain(1.05, seed=3, el_lo=0, el_hi=5)
b2, a2, e2, a3 = fb('x', 't', rb, ab, rb, ab, el)
r = G2.sky_row(b2, a2, e2, a3, el)
check('T5b 0~5° 띠만 × 1.05 → d ≈ 0.049(띠 평균이 잡음)', abs(r['d'] - math.log(1.05)) < 0.002 and r['medianD'] < 0.01, d=r['d'], medianD=r['medianD'], bands=r['bands'])
# 하늘이 있는 행인데 공유 하늘 < 200 → 실패 값, 하늘이 없는 행 → 범위 밖
a_all = np.where(el > 0, 0.05, 0.0)            # E: 하늘 전체가 알파 0.05
r = G2.sky_row(rb, ab, rb, np.maximum(ab, a_all), el)
check('T6a 하늘 있는 행에서 공유 하늘 < 200 → 실패 값(빠지지 않음)', r['scope'] and r['d'] == G2.SHARED_FAIL and r['mem'] > 0.9, d=r['d'], mem=r['mem'])
r = G2.sky_row(rb, np.full_like(ab, 0.9), rb, np.full_like(ab, 0.9), el)
check('T6b 온통 구름(하늘 없음) → 범위 밖', r['scope'] is False and r['d'] is None)
# 소속: 열린 하늘에 얇은 막(알파 0.05) → 잃음
fv = G2.pert_veil(0.05, 1.10, 20.0)
b2, a2, e2, a3 = fv('x', 't', rb, ab, rb, ab, el)
r = G2.sky_row(b2, a2, e2, a3, el)
check('T7a 열린 하늘(고도 ≤ 20°) 얇은 막 → 소속 값 > 0.05', r['mem'] is not None and r['mem'] > 0.05, mem=r['mem'], lost=r['lost'])
fa = G2.pert_alpha_add(0.01, 0.01)
b2, a2, e2, a3 = fa('x', 't', rb, ab, rb, ab, el)
r = G2.sky_row(b2, a2, e2, a3, el)
check('T7b 알파 + 0.01(알파 < 0.01 화소) → 하늘 값 0 · 소속 값 0', r['d'] < 1e-12 and r['mem'] == 0.0, d=r['d'], mem=r['mem'])
rc, ac, _ = make_scene(clouds=False)
r = G2.sky_row(rc, ac, rc, ac, el)
check('T7c 구름 없는 하늘(EDT 무한) → 소속 값 0', r['mem'] == 0.0 and r['d'] < 1e-12, mem=r['mem'])

# ── G2s 장면 판정(순수 함수) ──
sv = lambda vals: {'s%02d' % i: v for i, v in enumerate(vals)}  # noqa: E731
z33 = [0.005] * 33
check('T8a 33 장면 0.005 → 통과', G2.g2s_decide(sv(z33), sv([0.0] * 33))['pass'] is True)
check('T8b 1 장면 0.015 (3 %) → 통과', G2.g2s_decide(sv([0.005] * 32 + [0.015]), sv([0.0] * 33))['pass'] is True)
check('T8c 2 장면 0.015 (6 %) → 실패(비율 0.95)', G2.g2s_decide(sv([0.005] * 31 + [0.015] * 2), sv([0.0] * 33))['pass'] is False)
check('T8d 1 장면 0.025 > 상한 0.02 → 실패', G2.g2s_decide(sv([0.005] * 32 + [0.025]), sv([0.0] * 33))['pass'] is False)
check('T8e 공유 하늘 < 200 장면(실패 값) → 실패', G2.g2s_decide(sv([0.0] * 32 + [G2.SHARED_FAIL]), sv([0.0] * 33))['pass'] is False)
check('T8f 소속 1 장면 0.06 > 0.05 → 실패', G2.g2s_decide(sv(z33), sv([0.0] * 32 + [0.06]))['pass'] is False)
check('T8g 소속 4 장면 0.03 (12 %) → 실패(비율 0.90)', G2.g2s_decide(sv(z33), sv([0.0] * 29 + [0.03] * 4))['pass'] is False)
check('T8h 유효 장면 23 → 평가 불가', G2.g2s_decide(sv([0.0] * 23), sv([0.0] * 23))['pass'] is None)
check('T8i 행 빠짐 → 평가 불가', G2.g2s_decide(sv(z33), sv(z33), missing=['a:t'])['pass'] is None)
check('T8j 장면 값 = 방위 최대', G2.scene_values({'a': [0.001, 0.02, 0.0]}) == {'a': 0.02})

# ── G3 규칙(C0 의 여백으로, 실제 함수) ──
MB = [[-0.760, 0.222, 0.121], [-0.408, -0.343, 0.699], [-0.858, 0.891, 0.104], [-0.114, -0.220, 0.715]]
NEAR = 0.30


def e_from(changes):
    E = [row[:] for row in MB]
    for (i, j), v in changes.items():
        E[i][j] = v
    return E


def rule(E):
    return G2.g3_rule(G2.g3_lost(MB, E), NEAR)
check('T9a E = B → 통과', rule(MB) is True)
check('T9b 경계 근처 하나 뒤집힘(ac60_e20 a 0.121) → 통과', rule(e_from({(0, 2): -0.05})) is True)
check('T9c 다른 종류 둘에서 경계 근처 하나씩 → 통과', rule(e_from({(0, 2): -0.05, (2, 2): -0.02})) is True)
check('T9d ci60_e45 를 모두 잃음(a 0.715) → 실패', rule(e_from({(3, 2): -0.3})) is False)
check('T9e AcCc 셋 잃고 Ci 하나 얻음 → 실패(메우지 않음)', rule(e_from({(0, 1): -0.1, (0, 2): -0.1, (1, 2): -0.1, (2, 0): 0.4})) is False)
check('T9f 한 종류에서 경계 근처 둘 → 실패', rule(e_from({(0, 1): -0.05, (0, 2): -0.05})) is False)
check('T9g 강한 맞음(ci60_e20 s 0.891) 잃음 → 실패', rule(e_from({(2, 1): -0.1})) is False)
check('T9h 방위 바꿔치기(ac60_e45 a 잃고 t 얻음) → 실패', rule(e_from({(1, 2): -0.2, (1, 0): 0.3})) is False)
check('T9i R1 E1a.0 꼴(ci60_e45 a 0.72 → −0.27) → 실패', rule(e_from({(3, 2): -0.27})) is False)
check('T9j near 없음(동결 전) → 평가 불가', G2.g3_rule(G2.g3_lost(MB, MB), None) is None)
# 실패율 계산기
check('T10a P_FF(σ=0) = 0', G2.g3_pff(MB, 0.0, NEAR, n=2000) == 0.0)
p_big = G2.g3_pff(MB, 1.0, NEAR, n=20000)
check('T10b P_FF(σ=1) 큼', p_big > 0.5, pff=p_big)
pw = G2.g3_pff(MB, 0.1, NEAR, n=20000, shift={'Ci': -1.0})
check('T10c Ci 여백 −1 → 실패율 ≈ 1', pw > 0.99, power=pw)

# ── G3 끝에서 끝: job_paths·score_image 를 바꿔 끼움 ──
fake_m = {'C0': MB, 'X': e_from({(3, 2): -0.27})}
real_jp, real_si = G2.job_paths, G2.score_image
scn = ['ac60_e20', 'ac60_e45', 'ci60_e20', 'ci60_e45']
try:
    G2.job_paths = lambda root, arm, tag, scene, az, frame='std': {'png': '%s|%s|%s' % (arm, scene, az), 'alpha': None, 'el': 20, 'fov': 60, 'rows': None}
    def fake_score(png, gen, cache=None):
        arm, scene, az = png.split('|'); m = fake_m[arm][scn.index(scene)]['tsa'.index(az)]
        return {'label': 'x', 'hit': m > 0, 'margin': m, 'se': 0.01, 'near': False}
    G2.score_image = fake_score
    r1 = G2.g3('R', 'C0', 'C0', near=NEAR); r2 = G2.g3('R', 'C0', 'X', near=NEAR)
    check('T11 g3() 끝에서 끝: 같음 통과 · E1a.0 꼴 실패 · 잃은 목록', r1['pass'] is True and r2['pass'] is False and len(r2['lost']['Ci']) == 1,
          lost=r2['lost'])
finally:
    G2.job_paths, G2.score_image = real_jp, real_si

# ── g2s 끝에서 끝(가짜 잡 폴더) ──
def fake_job(root, name, rgb, al, el=20, fov=60, ok=True, W=390, H=584):
    d = os.path.join(root, name); os.makedirs(d, exist_ok=True)
    Image.fromarray(rgb.astype(np.uint8)).save(os.path.join(d, 'mean.png'))
    Image.fromarray(np.round(al * 255).astype(np.uint8)).save(os.path.join(d, 'mean.alpha.png'))
    json.dump({'name': name, 'captureOk': ok, 'W': W, 'H': H, 'canvasCropRows': [0, H], 'input': {'el': el, 'fov': fov}}, open(os.path.join(d, 'meta.json'), 'w'))
with tempfile.TemporaryDirectory() as root:
    S_ = {'scenes': {'p1': {'bundle': 'L'}, 'p2': {'bundle': 'L'}, 'rec': {'bundle': 'L', 'record': True}}}
    for sc in ('p1', 'p2'):
        for az in 'tsa':
            fake_job(root, 'C0__%s__%s__std' % (sc, az), rb, ab); fake_job(root, 'E9__%s__%s__std' % (sc, az), rb, ab, ok=not (sc == 'p2' and az == 'a'))
    rr = G2.g2s(S_, root, 'C0', 'E9')
    check('T11a g2s: captureOk 거짓 행 → 빠진 행 → 평가 불가 · record 장면 뺌', rr['pass'] is None and rr['missing'] == ['p2:a'] and rr['expectedRows'] == 6, missing=rr['missing'])
    fake_job(root, 'E9__p2__a__std', rb, ab, el=21)
    try:
        G2.g2s(S_, root, 'C0', 'E9'); raised = False
    except ValueError:
        raised = True
    check('T11b g2s: 카메라 고도가 다르면 멈춤', raised)
# g3_margins 순서 = g3_pff 의 종류 행
try:
    G2.job_paths = lambda root, arm, tag, scene, az, frame='std': {'png': '%s|%s|%s' % (arm, scene, az), 'alpha': None, 'el': 20, 'fov': 60, 'rows': None}
    G2.score_image = lambda png, gen, cache=None: {'margin': MB[scn.index(png.split('|')[1])]['tsa'.index(png.split('|')[2])]}
    mm = G2.g3_margins('R', 'C0', None, None)
    check('T11c g3_margins 순서(ac60_e20, ac60_e45, ci60_e20, ci60_e45 × t·s·a)', np.allclose(mm, MB))
finally:
    G2.job_paths, G2.score_image = real_jp, real_si
same = 0
for sd in range(200):
    f = G2.g3_pff(MB, 0.2, NEAR, n=1, seed=sd)
    Ed = np.asarray(MB)[None] + np.random.default_rng(sd).standard_normal((1, 4, 3)) * math.sqrt(2) * 0.2
    same += int(f == (0.0 if G2.g3_rule(G2.g3_lost(MB, Ed[0]), NEAR) else 1.0))
check('T11d g3_pff 한 번씩 = g3_rule(g3_lost) (200 씨앗)', same == 200, same=same)

# ── G2 결합·상태 규칙 ──
ok_old = {'cloudShare': 0.95, 'cloudMax': 0.1, 'satMax': 0.0}
check('T12a 구름 조항 실패 → G2 실패(하늘 무엇이든)', G2.combine_g2({**ok_old, 'cloudShare': 0.8}, {'pass': True}) is False)
check('T12b 구름 통과 · 하늘 미평가 → 미평가', G2.combine_g2(ok_old, {'pass': None}) is None)
check('T12c 구름 통과 · 하늘 통과 → 통과', G2.combine_g2(ok_old, {'pass': True}) is True)
check('T12d 구름 비율 NaN → 실패', G2.combine_g2({**ok_old, 'cloudShare': float('nan')}, {'pass': True}) is False)
r1d = None
if '--r1' in sys.argv:
    r1d = sys.argv[sys.argv.index('--r1') + 1]
if r1d:
    for arm in ('E1a.3', 'E1a.0', 'E1b'):
        p = os.path.join(r1d, 'gate-R1-%s.json' % arm)
        doc = json.load(open(p))
        gf, gn, st = G2.restatus(doc)
        check('T13 %s 옛 가드 값 → 옛 상태(%s)' % (arm, doc['status']), st == doc['status'] and gf == doc['guardFail'] and gn == doc['guardUnknown'], status=st, gfail=gf)
    doc = json.load(open(os.path.join(r1d, 'gate-R1-E1a.3.json')))
    for k, v in doc['guards'].items():
        if isinstance(v, dict) and 'pass' in v and k != 'G8':
            v['pass'] = True
    check('T13b E1a.3 가드 모두 통과로 → 비용 보류', G2.restatus(doc)[2] == '비용 보류')
    doc['guards']['G8']['pass'] = True
    check('T13c 비용도 통과 → 채택 후보', G2.restatus(doc)[2] == '채택 후보')
    doc['guards']['G3']['pass'] = None
    check('T13d G3 평가 불가 → 가드 미평가', G2.restatus(doc)[2] == '가드 미평가')

# ── 받아들임(순수 함수) ──
def good_rep():
    p8 = {'nScenes': 6, 'nRowsValid': 18, 'devMax': 0.0003}
    ctl = {}
    for bse in G2.G2S_CTL_BASES:
        for n, cl in G2.G2S_CTL_FAIL.items():
            ctl[bse + '|' + n] = {'pass': False, 'want': 'fail', 'wantClause': cl, 'lumPass': cl != 'lum' and cl != 'any' and True, 'memPass': cl != 'mem'}
            if cl == 'lum':
                ctl[bse + '|' + n]['lumPass'] = False
            if cl == 'any':
                ctl[bse + '|' + n]['lumPass'] = False
        for n in G2.G2S_CTL_PASS:
            ctl[bse + '|' + n] = {'pass': True, 'want': 'pass', 'wantClause': None}
        for n in G2.G2S_CTL_REC:
            ctl[bse + '|' + n] = {'pass': False, 'want': 'record', 'wantClause': None}
    rates = {bse + '|' + n: {'passRate': (1.0 if n == 'gain1.0025' else 0.0)} for bse in G2.G2S_CTL_BASES for n in G2.G2S_RATES}
    return {'g2s': {'C0|C0:AA777': {'pass': True, 'nRows': 108, 'expectedRows': 108, 'missing': [], 'max': 0.0, 'memMax': 0.0},
                    'C0:P8A|C0:P8B': dict(p8, devMax=0.0), 'C0:P8A|C0:P8n777': dict(p8), 'C0:P8A|C0:P8n4242': dict(p8), 'C0:P8n777|C0:P8n4242': dict(p8)},
            'g2sCtl': ctl, 'g2sRate': rates, 'g3': {'near': 0.3, 'pff': 0.02, 'power': {'AcCc': 1.0, 'Ci': 1.0}},
            'g3Ctl': {n: {'pass': False} for n in G2.G3_CTL_FAIL}}
check('T14a 모두 좋음 → 받아들임', G2.aa_accept(good_rep())['all'] is True, acc=G2.aa_accept(good_rep()))
def bad(fn):
    r = good_rep(); fn(r); return G2.aa_accept(r)['all'] is False
check('T14b P8 장면 값 0.011 → 안 받아들임', bad(lambda r: r['g2s']['C0:P8A|C0:P8n777'].update(devMax=0.011)))
check('T14c P8 쌍 장면 5 → 안 받아들임', bad(lambda r: r['g2s']['C0:P8A|C0:P8n777'].update(nScenes=5)))
check('T14d P8 쌍 빠짐 → 안 받아들임', bad(lambda r: r['g2s'].pop('C0:P8A|C0:P8n4242')))
check('T14e AA777 행 빠짐 → 안 받아들임', bad(lambda r: r['g2s']['C0|C0:AA777'].update(nRows=100)))
check('T14f AA777 장면 값 0.0051 > tol/2 → 안 받아들임', bad(lambda r: r['g2s']['C0|C0:AA777'].update(max=0.0051)))
check('T14g AA777 소속 0.011 > 0.01 → 안 받아들임', bad(lambda r: r['g2s']['C0|C0:AA777'].update(memMax=0.011)))
check('T14h P_FF 0.11 → 안 받아들임', bad(lambda r: r['g3'].update(pff=0.11)))
check('T14i near 0.61 > 0.60 → 안 받아들임', bad(lambda r: r['g3'].update(near=0.61)))
check('T14j 반드시 실패할 대조가 통과 → 안 받아들임', bad(lambda r: r['g2sCtl']['C0|gain1.015'].update(**{'pass': True})))
check('T14k 소속 대조가 휘도로만 실패(소속 통과) → 안 받아들임', bad(lambda r: r['g2sCtl']['C0|veil_el0-20'].update(memPass=True, lumPass=False)))
check('T14l 대조 하나 빠짐 → 안 받아들임', bad(lambda r: r['g2sCtl'].pop('C0:AA777|gain1.015_t')))
check('T14m G3 대조 평가 불가 → 안 받아들임', bad(lambda r: r['g3Ctl']['swap ci60→sc85'].update(**{'pass': None})))
check('T14n G3 대조 하나 빠짐 → 안 받아들임', bad(lambda r: r['g3Ctl'].pop('blur2 ac60')))
check('T14o × 1.01 통과율 0.10 → 안 받아들임', bad(lambda r: r['g2sRate']['C0:AA777|gain1.01'].update(passRate=0.10)))
check('T14p 통과율 하나 빠짐 → 안 받아들임', bad(lambda r: r['g2sRate'].pop('C0|gain1.0025')))
check('T14q 검정력 0.94 → 안 받아들임', bad(lambda r: r['g3']['power'].update(Ci=0.94)))

# ── CLIP(무게가 있을 때만, --clip): 결정성·프로세스 사이 비트 같음·캐시 설정 ──
if '--clip' in sys.argv:
    with tempfile.TemporaryDirectory() as d:
        rgb, _, _ = make_scene(); pth = os.path.join(d, 'c.png'); Image.fromarray(rgb.astype(np.uint8)).save(pth)
        old_k = G2.G3_K; G2.G3_K = 2
        p1, names, _ = G2.clip_smooth(pth, None); p2, _, _ = G2.clip_smooth(pth, None)
        code = ('import sys; sys.path.insert(0, %r); import grain2 as G2; G2.G3_K = 2; p, n, P = G2.clip_smooth(%r, None); '
                'print(",".join(repr(float(x)) for x in p))') % (HERE, pth)
        outs = [subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=900).stdout.strip() for _ in range(2)]
        mine = ','.join(repr(float(x)) for x in p1)
        G2.G3_K = old_k
        check('T15a CLIP 떨림 평균 결정성(같은 프로세스, K=2)', np.array_equal(p1, p2) and abs(sum(p1) - 1) < 1e-4)
        check('T15b 프로세스 둘에서 비트 같음', outs[0] == outs[1] == mine, a=outs[0][:60], b=outs[1][:60])
        G2.G3_K = 2
        cc = {'cfg': G2.clip_cfg()[0], 'entries': {}}; q1 = G2.clip_smooth(pth, cc)[0]; q2 = G2.clip_smooth(pth, cc)[0]
        G2.G3_K = old_k
        check('T15d 캐시에서 되읽은 확률 = 처음 계산(비트 같음)', np.array_equal(q1, q2))
        c = G2.load_cache(None); c['cfg'] = 'stale'; cp = os.path.join(d, 'cache.json')
        json.dump({'cfg': 'stale', 'entries': {'x': {'P': [[1.0]]}}}, open(cp, 'w'))
        c2 = G2.load_cache(cp)
        check('T15c 설정 해시가 다른 캐시 → 버림', c2['entries'] == {} and c2.get('discarded') == 'stale')

npass = sum(r['ok'] for r in res)
for r in res:
    print(('PASS ' if r['ok'] else 'FAIL ') + r['name'], {k: v for k, v in r.items() if k not in ('name', 'ok')})
print(json.dumps({'pass': npass, 'fail': len(res) - npass, 'clip': '--clip' in sys.argv, 'r1': bool(r1d), 'provenance': G2.provenance(clip='--clip' in sys.argv)}))
sys.exit(0 if npass == len(res) else 1)
