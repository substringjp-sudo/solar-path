"""Recheck sim C: RULER-regime 2판 J3 '과장 없음'(중앙 A*_C4 <= 중앙 A*_sat, 점 추정)이 a 를 dev 중앙에 맞춘 구성에서
자료와 무관하게 몇 번 떨어지나.  MODIS 없음, 가정 [estimate]:
- ln A*_sat(장면) = m + 사이트(SD 0.10) + 장면(SD s).  dev 2 사이트 n_dev, held 6 사이트 n_held.
- ln A*_render(a, 장면) = ln a + 렌더 잡음(SD 0.10).  a = {1.25,1.5,2.0} 가운데 dev 중앙이 log 로 가장 가까운 것(같으면 작은 쪽, n_dev < 5 이면 1.25).
- 규칙: (2판) 1.1 <= 중앙 A*_C4 <= 중앙 A*_sat.  (대안 alt) 중앙 A*_C4 >= 1.1, 중앙 delta <= ln 1.25, 그리고 '과장 입증'(L95(중앙 delta) > 0) 이 아님.
  (point) 중앙 A*_C4 >= 1.1 이고 중앙 delta <= ln 1.25.  (U95) 중앙 A*_C4 >= 1.1 이고 U95(중앙 delta) <= ln 1.25. delta_i = ln A*_C4,i - ln A*_sat,i, iid 부트스트랩 1000.
- '참 과장' 대조: a 를 2.0 으로 고정.
Usage: python3 -I simC_exag.py <out_json>
"""
import sys, json
import numpy as np
rng = np.random.default_rng(20261106)
GRID = np.array([1.25, 1.5, 2.0])

def scene(m, s, n, nsite):
    site = rng.integers(0, nsite, n); u = rng.normal(0, 0.10, nsite)
    return m + u[site] + rng.normal(0, s, n)

def one(m, s, n_dev, n_held, force=None):
    dev = scene(m, s, n_dev, 2)
    if force is not None: a = force
    elif n_dev < 5: a = 1.25
    else:
        rd = np.log(GRID)[:, None] + rng.normal(0, 0.10, (3, n_dev))
        a = GRID[np.argmin(np.abs(np.median(rd, axis=1) - np.median(dev)))]
    held = scene(m, s, n_held, 6)
    c4 = np.log(a) + rng.normal(0, 0.10, n_held)
    draft_ok = (np.exp(np.median(c4)) >= 1.1) and (np.median(c4) <= np.median(held))
    dlt = c4 - held
    bs = rng.integers(0, n_held, (1000, n_held))
    L = np.percentile(np.median(dlt[bs], axis=1), 2.5)
    U = np.percentile(np.median(dlt[bs], axis=1), 97.5)
    lo = np.exp(np.median(c4)) >= 1.1
    alt_ok = lo and (np.median(dlt) <= np.log(1.25)) and not (L > 0)
    alt2_ok = lo and (np.median(dlt) <= np.log(1.25))
    alt3_ok = lo and (U <= np.log(1.25))
    return draft_ok, alt_ok, a, alt2_ok, alt3_ok

out = {}
for m in (np.log(1.3), np.log(1.5)):
    for s in (0.20, 0.35):
        for n_dev in (8, 15):
            for n_held in (30, 45):
                rr = [one(m, s, n_dev, n_held) for _ in range(2000)]
                key = f'A{np.exp(m):.1f}_s{s}_ndev{n_dev}_nheld{n_held}'
                out[key] = {'P_fail_draft': round(1 - float(np.mean([r[0] for r in rr])), 3),
                            'P_fail_alt': round(1 - float(np.mean([r[1] for r in rr])), 3),
                            'P_fail_point_ln1.25': round(1 - float(np.mean([r[3] for r in rr])), 3),
                            'P_fail_U95_ln1.25': round(1 - float(np.mean([r[4] for r in rr])), 3),
                            'a_share': {str(g): round(float(np.mean([r[2] == g for r in rr])), 2) for g in GRID}}
                print(key, out[key], flush=True)
        rr = [one(m, s, 15, 30, force=2.0) for _ in range(2000)]
        key = f'A{np.exp(m):.1f}_s{s}_FORCED_a2.0'
        out[key] = {'P_fail_draft': round(1 - float(np.mean([r[0] for r in rr])), 3), 'P_fail_alt': round(1 - float(np.mean([r[1] for r in rr])), 3),
                    'P_fail_point_ln1.25': round(1 - float(np.mean([r[3] for r in rr])), 3), 'P_fail_U95_ln1.25': round(1 - float(np.mean([r[4] for r in rr])), 3)}
        print(key, out[key], flush=True)
json.dump(out, open(sys.argv[1], 'w'), indent=1)
