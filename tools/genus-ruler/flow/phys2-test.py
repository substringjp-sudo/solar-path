#!/usr/bin/env python3
"""
phys2-test.py — RULER-physics2(§137) 지표의 합성 이미지 시험. 설계 검토가 찾은 허점이 막혔는지 확인합니다.
  python3 tools/genus-ruler/flow/phys2-test.py [phys2-photo-quartiles.json]
검사:
  1 무늬 없는 판(평평한 회색·매끈한 세로 기울기·기울기 + 화소 잡음)은 어떤 흐린 하늘 종류의 구조 칸(structMid ∈ [q25, q75])도 통과하지 못함 — 검토에서 단측 문턱은 4/4 를 공짜로 줌.
  2 순수 백색 잡음은 grainShareMid ≈ 1, 저역 얼룩(10~20 화소)은 grainShareMid ≈ 0.
  3 전체 밝기 기울기 불변: 같은 얼룩에 세로 이득 램프(1 → 0.35)를 곱해도 structMid·grainShareMid 가 거의 같음(검토에서 처음 정의는 램프만으로 점수가 뒤집힘).
  4 톤 곡선 배율: structMid 는 로그 척도라 L^γ 에 γ 배, grainShareMid 는 γ 에 무관.
  5 얼룩 이미지가 구조 칸을 통과할 수 있는 크기가 있음(지표가 항상 ×가 아님).
"""
import sys, os, json, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fm, phys2  # noqa: E402

QF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'phys2-photo-quartiles.json')
Q = json.load(open(QF))
W, H = 390, 584
rng = np.random.default_rng(7)
results = []


def check(name, ok, detail=''):
    results.append(bool(ok)); print('%s  %s  %s' % ('PASS' if ok else 'FAIL', name, detail))


def metrics_of(gray_lin):
    """선형 휘도 [0,1] 그림(H×W) → 표시 sRGB PNG + 알파 1 → phys2.all_metrics2."""
    g = np.clip(gray_lin, 1e-4, 1)
    srgb = np.where(g <= 0.0031308, g * 12.92, 1.055 * np.power(g, 1 / 2.4) - 0.055)
    rgb = np.repeat(np.clip(srgb * 255, 0, 249)[..., None], 3, axis=2).astype(np.uint8)   # 포화(≥250) 피함
    with tempfile.TemporaryDirectory() as d:
        p, a = os.path.join(d, 'x.png'), os.path.join(d, 'x.alpha.png')
        Image.fromarray(rgb).save(p); Image.fromarray(np.full((H, W), 255, np.uint8)).save(a)
        return phys2.all_metrics2(p, 0, 0.78, a)


def lowpass_noise(scale, amp, seed):
    r = np.random.default_rng(seed)
    n = r.standard_normal((H // scale + 3, W // scale + 3))
    big = np.kron(n, np.ones((scale, scale)))[:H, :W]
    k = fm.box_blur(big, max(1, scale // 2)); k = k / k.std()
    return amp * k


DECKS = ('St', 'As', 'Ns', 'StSc')


def struct_pass(m, g):
    """기본 문턱에서 톤 배율 0.85~1.2 모두 ○ 인 칸(= 신뢰할 수 있게 통과)."""
    q = Q['quartiles'][g]['structMid']
    lo, hi = phys2.thresholds(q, 'nominal')
    return phys2.tone_outcomes('two', m['structMid'], lo, hi, True) == {True}


def struct_any(m, g):
    q = Q['quartiles'][g]['structMid']
    lo, hi = phys2.thresholds(q, 'nominal')
    return True in phys2.tone_outcomes('two', m['structMid'], lo, hi, True)


base = 0.45
flat = metrics_of(np.full((H, W), base))
grad = metrics_of(np.tile(np.linspace(0.62, 0.25, H)[:, None], (1, W)))
gradn = metrics_of(np.tile(np.linspace(0.62, 0.25, H)[:, None], (1, W)) * np.exp(0.10 * rng.standard_normal((H, W))))
for name, m in (('평평한 회색', flat), ('매끈한 세로 기울기', grad), ('기울기 + 화소 잡음(σ 0.10)', gradn)):
    check('구조 칸 불합격(무늬 없는 판): ' + name, not any(struct_any(m, g) for g in DECKS), 'structMid %.4f grainShare %.3f' % (m['structMid'], m['grainShareMid']))

noise = metrics_of(base * np.exp(0.15 * rng.standard_normal((H, W))))
blot = metrics_of(base * np.exp(lowpass_noise(14, 0.25, 11)))
check('백색 잡음: grainShareMid ≥ 0.9', noise['grainShareMid'] >= 0.9, 'grainShare %.3f structMid %.4f' % (noise['grainShareMid'], noise['structMid']))
check('저역 얼룩(14 화소): grainShareMid ≤ 0.15', blot['grainShareMid'] <= 0.15, 'grainShare %.3f structMid %.3f' % (blot['grainShareMid'], blot['structMid']))

ramp = np.tile(np.linspace(1.0, 0.35, H)[:, None], (1, W))
tex = base * np.exp(lowpass_noise(14, 0.25, 11))
m0, m1 = metrics_of(tex), metrics_of(tex * ramp)
rel = abs(m1['structMid'] / m0['structMid'] - 1)
check('전체 밝기 기울기 불변: structMid 변화 < 15 %', rel < 0.15, '%.3f → %.3f (%+.1f %%)' % (m0['structMid'], m1['structMid'], 100 * rel))
check('전체 밝기 기울기 불변: grainShareMid 변화 < 0.05', abs(m1['grainShareMid'] - m0['grainShareMid']) < 0.05, '%.3f → %.3f' % (m0['grainShareMid'], m1['grainShareMid']))

g13 = metrics_of(np.power(tex, 1.3)); g08 = metrics_of(np.power(tex, 0.8))
check('톤 곡선 L^γ: structMid 가 γ 배(±8 %), grainShareMid 불변(±0.03)',
      abs(g13['structMid'] / m0['structMid'] / 1.3 - 1) < 0.08 and abs(g08['structMid'] / m0['structMid'] / 0.8 - 1) < 0.08 and abs(g13['grainShareMid'] - m0['grainShareMid']) < 0.03,
      'γ1.3 ×%.2f γ0.8 ×%.2f grainShare %.3f/%.3f' % (g13['structMid'] / m0['structMid'], g08['structMid'] / m0['structMid'], g13['grainShareMid'], m0['grainShareMid']))

# 5 구조 칸을 통과할 수 있는 얼룩 크기가 존재(진폭을 바꿔 가며) — 지표가 항상 ×가 아님
passing = {g: any(struct_pass(metrics_of(base * np.exp(lowpass_noise(14, a, 3))), g) for a in np.geomspace(0.03, 0.6, 60)) for g in DECKS}
check('흐린 하늘 네 종류 모두 통과 가능한 얼룩 진폭이 있음', all(passing.values()), str(passing))

pass_n = sum(results)
print('\n%d/%d 통과' % (pass_n, len(results)))
sys.exit(0 if pass_n == len(results) else 1)
