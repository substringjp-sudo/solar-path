#!/usr/bin/env python3
"""
RULER-tsun 판정 코드 합성 시험(절차 검토 #6) — 손으로 만든 그림·기록을 규칙에 통과시켜 정의가 뜻대로 도는지.

  PYTHONDONTWRITEBYTECODE=1 nice -n 19 python3 -I tsun-test.py [--out tsun-test.json]

T1 ACES 왕복 · T2 두 노출 합침 · T3 D1m(틈 섞임에 안 흔들림, 같은 고도 맞춤) · T4 R-A 단위 · T5 반사실 규칙 · T6 띠 가드 ·
T7 R-A 팔 규칙(변별·가족) · T8 여유 공식 · T9 H1 규칙. 모두 통과해야 동결.
"""
import importlib.util, json, math, os, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('tsun_photo', os.path.join(HERE, 'tsun_photo.py'))
T = importlib.util.module_from_spec(spec); spec.loader.exec_module(T)
RES = {}


def check(name, ok, **kw):
    RES[name] = dict(ok=bool(ok), **{k: (round(v, 5) if isinstance(v, float) else v) for k, v in kw.items()})
    print(('PASS ' if ok else 'FAIL ') + name, json.dumps(RES[name], ensure_ascii=False, default=str))


def to8(S, k=1.0):
    return np.round(T.srgb_oetf8(T.aces_fwd(S, k))).astype(np.uint8)


def save(path, rgb8, alpha=None):
    Image.fromarray(rgb8).save(path)
    if alpha is not None:
        Image.fromarray(np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)).save(path[:-4] + '.alpha.png')


def t1():
    rng = np.random.default_rng(1)
    S = np.exp(rng.uniform(np.log(0.01), np.log(2.0), (20000, 3)))
    c8 = to8(S)
    back, ok = T.scene_from_rgb8(c8.astype(float))
    e = np.abs(back[ok] @ T.LUM / (S[ok] @ T.LUM) - 1)
    check('T1_aces_roundtrip', ok.mean() > 0.5 and np.median(e) < 0.01, valid=float(ok.mean()), med_rel_err=float(np.median(e)), p95=float(np.percentile(e, 95)))


def p1_geom():
    c = T.RENDER_CAM['P1']; W, H = c['W'], c['H']
    f = (H / 2) / math.tan(math.radians(c['vfov']) / 2)
    U, V = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    az, el = T.pix2azel(U, V, W, H, c['az'], c['el'], c['roll'], f)
    return az, el, W, H


def synth_P1(d1=2.0, gap_frac=0.4, seed=2):
    """맑은 하늘 장면 선형 (0.30, 0.25, 0.25)·고도 감쇠, 덮개 상자 안 구름 (R/B = d1 × 맑은 R/B, 밝기 0.3 배), 덮개의 gap_frac 은 틈(맑은 색, α 0)."""
    az, el, W, H = p1_geom()
    rng = np.random.default_rng(seed)
    grad = np.exp(-(el - 6) / 30.0)[..., None]
    clear = np.array([0.30, 0.25, 0.25]) * grad
    S = clear.copy()
    ee = T.p1_edge(az)
    with np.errstate(invalid='ignore'):
        deck = (el > ee + 0.5) & (az >= 230) & (az <= 305)
    gap = rng.random(el.shape) < gap_frac
    cloud = deck & ~gap
    deckcol = np.array([0.30 * d1, 0.25, 0.25]) * 0.3 * grad
    S = np.where(cloud[..., None], deckcol, S)
    al = cloud.astype(float)
    return S, al


def t2_t3(tmp):
    S, al = synth_P1()
    lo, hi = os.path.join(tmp, 'p1.png'), os.path.join(tmp, 'p1h.png')
    k = 1.2
    save(lo, to8(S, k), al); save(hi, to8(S, k * 16), al)
    I = T.load_render('P1', lo, None, None, hi, None, check=True)
    check('T2_merge', I.merge and I.merge['ok'] and abs(I.merge['median_ratio_hi_over_lo'] - 1) < 0.03, merge=I.merge)
    m = T.METRICS['P1'](I.scene)
    d1m = m['D1m']; d1b = m['D1box']
    ok = all(v is not None and abs(v / 2.0 - 1) < 0.03 for v in d1m)
    check('T3_D1m_alpha_clean', ok and all(b is not None and b < 1.9 for b in d1b), D1m_scene=d1m, D1box_scene=d1b,
          note='틈 40 % 가 섞인 상자 D1 은 2 보다 작고, 알파로 거른 D1m 은 2 를 되찾음')
    # 같은 고도 맞춤: 맑은 하늘에 고도 따라 강한 색 기울기를 주면 D1box 는 흔들려도 D1m 은 그대로
    az, el, W, H = p1_geom()
    S2 = S.copy()
    tilt = np.exp(-(el - 6) / 4.0)
    S2[..., 0] = np.where(al > 0, S2[..., 0] * tilt, S2[..., 0] * tilt)
    save(lo, to8(S2, k), al); save(hi, to8(S2, k * 16), al)
    I = T.load_render('P1', lo, None, None, hi, None, check=True)
    m = T.METRICS['P1'](I.scene)
    ok = all(v is not None and abs(v / 2.0 - 1) < 0.05 for v in m['D1m'])
    check('T3b_D1m_elevation_matched', ok, D1m_scene=m['D1m'], D1box_scene=m['D1box'])


def t4(tmp):
    rng = np.random.default_rng(3)
    H, W = 300, 400
    S = np.exp(rng.normal(np.log(0.3), 0.3, (H, W, 3)))
    al = np.ones((H, W))
    a, b, c = (os.path.join(tmp, f'ra{i}.png') for i in range(3))
    save(a, to8(S), al); save(b, to8(S), al); save(c, to8(S * 1.3), al)
    r0 = T.ra_unit(a, b); r1 = T.ra_unit(c, b)
    tol = T.ra_tol(None)
    check('T4_ra_identical_pass', r0['valid'] and T.ra_unit_pass(r0, tol) and r0['e'] == 0.0, r=r0)
    check('T4b_ra_scaled_fail', r1['valid'] and not T.ra_unit_pass(r1, tol) and abs(r1['b'] - math.log(1.3)) < 0.02, r=r1)
    S2 = S.copy(); S2[:, :120] *= 30.0   # 한 팔만 잘림
    save(c, to8(S2), al)
    r2 = T.ra_unit(c, b)
    check('T4c_ra_clip_asym_fail', (not r2.get('valid')) or (r2['clip_asym'] > 0.05 and not T.ra_unit_pass(r2, tol)), r=r2)


def t5():
    ok1, _ = T.cf_rule([0.5, 0.6, 0.4, 0.3], [0.1, 0.2, 0.1, 0.0], [0.45, 0.55, 0.38, 0.3])
    ok2, _ = T.cf_rule([0.5, 0.6, 0.4, 0.3], [0.5, 0.6, 0.4, 0.3], [0.5, 0.6, 0.4, 0.3])     # H0: 벽이 못 막음
    ok3, _ = T.cf_rule([0.5, 0.6, 0.4, 0.3], [0.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0])     # 등방 가짜: 동쪽 벽도 막음
    ok4, _ = T.cf_rule([0.05, 0.02, 0.0, 0.08], [0, 0, 0, 0], [0, 0, 0, 0])                  # 붉힘 없음 → na
    check('T5_cf_rule', ok1 is True and ok2 is False and ok3 is False and ok4 is None, good=ok1, h0=ok2, iso=ok3, none=ok4)


def t6():
    photo = {'photos': {'P1': {'metrics': {'D3m': [0.26, 0.45, 1.06, 1.96], 'D4': 0.362, 'D5': 4.135},
                               'metrics_icc_ignored': {'D3m': [0.26, 0.446, 1.052, 1.951], 'D4': 0.362}}}}
    base = {'metrics': {'D3m': [0.03, 0.30, 0.54, 0.69], 'D4': 0.573}}
    good = {'metrics': {'D1m': [1.4] * 4, 'D3m': [0.2, 0.6, 1.2, 1.5], 'D4': 0.60, 'D2_pooled_8_18': 1.5},
            'metrics_scene': {'D1m': [1.35] * 4, 'D2_pooled_8_18': 1.4}}
    bad = {'metrics': {'D1m': [1.4] * 4, 'D3m': [0.2, 0.9, 1.2, 1.5], 'D4': 0.75, 'D2_pooled_8_18': 1.5},
           'metrics_scene': {'D1m': [1.35, 1.2, 1.4, 1.4], 'D2_pooled_8_18': 1.4}}
    Vg = T.judge_one('P1', photo, good, base); Vb = T.judge_one('P1', photo, bad, base)
    ok = (Vg['D1m']['verdict'] == 'pass' and Vg['D3_band']['verdict'] == 'pass' and Vg['D4_band']['verdict'] == 'pass' and Vg['D2']['verdict'] == 'pass'
          and Vb['D1m']['verdict'] == 'fail' and Vb['D3_band']['verdict'] == 'fail' and Vb['D4_band']['verdict'] == 'fail')
    check('T6_band_guards', ok, good={k: v['verdict'] for k, v in Vg.items()}, bad={k: v['verdict'] for k, v in Vb.items()},
          note='D1m 은 장면 공간 한 칸 1.2 로 실패; D3 칸 2 는 0.9 > 0.45·e^(max(0.41,0.405)+0.05) = 0.71')


def t7():
    units = []
    fams = ['in'] * 6 + ['far'] * 4 + ['es'] * 2 + ['ctrl'] * 4
    for i, f in enumerate(fams):
        units.append(dict(name=f'u{i}', geo=dict(family=f, disc=f != 'ctrl')))
    good = {u['name']: dict(valid=True, e=0.05, b=0.01, c=0.01, p75=0.08, f03=0.0, clip_asym=0.0) for u in units}
    c0 = {u['name']: (dict(valid=True, e=0.4, b=-0.3, c=0.2, p75=0.6, f03=0.6, clip_asym=0.0) if u['geo']['disc'] else
                      dict(valid=True, e=0.08, b=0.0, c=0.0, p75=0.1, f03=0.0, clip_asym=0.0)) for u in units}
    r_good = T.ra_arm(units, good, c0)
    bad = dict(good); bad['u6'] = bad['u7'] = dict(valid=True, e=0.35, b=-0.3, c=0.1, p75=0.5, f03=0.5, clip_asym=0.0)   # 먼 그늘 둘 실패
    r_bad = T.ra_arm(units, bad, c0)
    c0_easy = {k: dict(v, e=0.05, b=0.0, c=0.0, p75=0.08, f03=0.0) for k, v in c0.items()}
    r_na = T.ra_arm(units, good, c0_easy)
    check('T7_ra_arm', r_good['verdict'] == 'pass' and r_bad['verdict'] == 'fail' and r_na['verdict'] == 'na',
          good=r_good['verdict'], bad=r_bad['verdict'], bad_checks=r_bad.get('checks'), no_disc=r_na['verdict'])


def t8():
    r1 = {'pid': 'P1', 'metrics': {'D3m': [0.03, 0.30, 0.54, 0.69], 'D4': 0.573, 'D1m': [1.1, 0.9, 1.0, 1.2]}, 'metrics_scene': {'D1m': [1.0, 0.9, 1.0, 1.2], 'D3m': [0.1, 0.4, 0.6, 0.8]}}
    r2 = {'pid': 'P1', 'metrics': {'D3m': [0.03, 0.33, 0.54, 0.69], 'D4': 0.60, 'D1m': [1.1, 0.9, 1.0, 1.2]}, 'metrics_scene': {'D1m': [1.0, 0.9, 1.0, 1.2], 'D3m': [0.1, 0.4, 0.6, 0.8]}}
    m, A, V = T.margins_from([(r1, r2)], [])
    want = max(0.05, 3 * math.log(0.33 / 0.30))
    check('T8_margins', abs(m['D3'] - want) < 1e-9 and abs(m['D4'] - max(0.03, 3 * 0.027)) < 1e-9, margins=m)


def t9():
    ok_t, _ = T.h1_rule(dict(magenta=0.05, blue=0.3), dict(magenta=0.09, blue=0.3), 'T')
    na_t, _ = T.h1_rule(dict(magenta=0.05, blue=0.3), dict(magenta=0.12, blue=0.3), 'T')
    ok_a, _ = T.h1_rule(dict(magenta=0.18, blue=0.2), dict(magenta=0.09, blue=0.3), 'A', 0.2)
    bad_a, _ = T.h1_rule(dict(magenta=0.18, blue=0.2), dict(magenta=0.09, blue=0.3), 'A', 2.0)
    check('T9_h1', ok_t is True and na_t is None and ok_a is True and bad_a is False, t=ok_t, t_c0fail=na_t, a=ok_a, a_clear_changed=bad_a)


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as tmp:
        t1(); t2_t3(tmp); t4(tmp); t5(); t6(); t7(); t8(); t9()
    allok = all(v['ok'] for v in RES.values())
    print('ALL', 'PASS' if allok else 'FAIL', f'{sum(v["ok"] for v in RES.values())}/{len(RES)}')
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    if out:
        json.dump(dict(all_ok=allok, tests=RES), open(out, 'w'), indent=1, ensure_ascii=False, default=str)
    sys.exit(0 if allok else 1)
