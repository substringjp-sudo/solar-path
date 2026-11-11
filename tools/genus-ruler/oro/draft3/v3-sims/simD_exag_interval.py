"""v3 sim D: RULER-regime J3 '과장 없음' 을 구간 + 여유로 바꿀 때 여유 tau 를 고르는 모의. MODIS 없음, 합성 ln A* 만.
모형 [estimate] (재검토 simC 를 넓힘):
- held 8 사이트, dev 2 사이트, 153 일 = 22 ISO 주. 장면은 사이트·날을 고르게 뽑음.
- ln A*_sat,i = m + u_site(SD 0.10) + w_week(SD 0.05, 그 주 모든 사이트 공통) + e(SD s).
- ln A*_render,i(a) = ln a + 렌더 잡음(SD 0.10).  (r1 렌더는 위성 무늬와 무관한 앱 타일)
- a 고르기(dev, n_dev 장면): N = log 로 가장 가까운 a(2판), D = dev 중앙 A*_render(a) <= dev 중앙 A*_sat 인 가장 큰 a(없으면 1.25). n_dev < 5 이면 1.25.
- held: delta_i = ln A*_C4,i - ln A*_sat,i.  중앙 delta, 주 블록 부트스트랩(B 회) 백분위 U95.
- 규칙: R0 = 2판(중앙 A*_C4 <= 중앙 A*_sat), Rp125 = 중앙 delta <= ln 1.25(통계 재검토), Rp110 = 중앙 delta <= ln 1.10(타당성 재검토),
        U(tau) = U95(중앙 delta) <= tau.  모두 중앙 A*_C4 >= 1.1 을 함께 요구.
- '맞는 생성기' = 위 a 고르기 그대로.  '과장' = a 를 강제(참 과장 비 = a / exp(m)).
Usage: python3 -I simD_exag_interval.py <out_json> [reps] [boot]
"""
import sys, json
import numpy as np
rng = np.random.default_rng(20261104)
REPS = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
B = int(sys.argv[3]) if len(sys.argv) > 3 else 500
GRID = np.array([1.25, 1.5, 2.0])
LG = np.log(GRID)
TAUS = [1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.50]
NW, ND = 22, 153

def scenes(m, s, n, nsite, wk_eff):
    site = rng.integers(0, nsite, n); u = rng.normal(0, 0.10, nsite)
    day = rng.integers(0, ND, n); wk = np.minimum(day // 7, NW - 1)
    return m + u[site] + wk_eff[wk] + rng.normal(0, s, n), wk

def pick(dev, rule):
    n = len(dev)
    if n < 5: return 1.25
    rd = np.median(LG[:, None] + rng.normal(0, 0.10, (3, n)), axis=1)
    md = np.median(dev)
    if rule == 'N':
        return GRID[np.argmin(np.abs(rd - md))]
    ok = np.where(rd <= md)[0]
    return GRID[ok.max()] if len(ok) else 1.25

def wmedian_boot(d, wk):
    o = np.argsort(d); ds = d[o]; ws = wk[o]
    present = np.unique(wk)
    # 주 블록: 있는 주들을 복원 추출 -> 주마다 뽑힌 횟수
    draws = rng.integers(0, len(present), (B, len(present)))
    cnt = np.zeros((B, NW))
    np.add.at(cnt, (np.repeat(np.arange(B), len(present)), present[draws].ravel()), 1)
    W = cnt[:, ws]
    cw = np.cumsum(W, axis=1); tot = cw[:, -1:]
    idx = np.argmax(cw >= tot / 2.0, axis=1)
    return ds[idx]

def one(m_dev, m_held, s, n_dev, n_held, rule, force=None):
    wk_eff = rng.normal(0, 0.05, NW)
    dev, _ = scenes(m_dev, s, n_dev, 2, wk_eff)
    a = force if force is not None else pick(dev, rule)
    held, wk = scenes(m_held, s, n_held, 8, wk_eff)
    c4 = np.log(a) + rng.normal(0, 0.10, n_held)
    d = c4 - held
    med = np.median(d); lo = np.exp(np.median(c4)) >= 1.1
    bm = wmedian_boot(d, wk)
    U = np.percentile(bm, 97.5)
    res = {'R0': lo and (np.median(c4) <= np.median(held)),
           'Rp125': lo and med <= np.log(1.25),
           'Rp110': lo and med <= np.log(1.10)}
    for t in TAUS: res[f'U{t:.2f}'] = lo and U <= np.log(t)
    res['a'] = a; res['U'] = U; res['med'] = med
    return res

def summarize(rr):
    keys = ['R0', 'Rp125', 'Rp110'] + [f'U{t:.2f}' for t in TAUS]
    out = {f'fail_{k}': round(1 - float(np.mean([r[k] for r in rr])), 3) for k in keys}
    out['a_share'] = {str(g): round(float(np.mean([r['a'] == g for r in rr])), 2) for g in GRID}
    out['U95_med'] = round(float(np.median([r['U'] for r in rr])), 3)
    out['U95_minus_med_med'] = round(float(np.median([r['U'] - r['med'] for r in rr])), 3)
    return out

out = {'model': __doc__.split('Usage')[0], 'reps': REPS, 'boot': B, 'correct': {}, 'shift': {}, 'forced': {}}
for rule in ('N', 'D'):
    for A in (1.3, 1.4, 1.5, 1.7, 1.9):
        for s in (0.20, 0.35):
            for n_dev in (8, 15):
                for n_held in (30, 45):
                    key = f'{rule}_A{A}_s{s}_ndev{n_dev}_nheld{n_held}'
                    rr = [one(np.log(A), np.log(A), s, n_dev, n_held, rule) for _ in range(REPS)]
                    out['correct'][key] = summarize(rr); print(key, out['correct'][key], flush=True)
    # dev-held 차: held 가 dev 보다 덜 비등방(ln 0.15) — 맞는 생성기지만 held 에서 과장 ~16 %
    for A in (1.5, 1.7):
        for s in (0.20, 0.35):
            key = f'{rule}_devA{A}_heldA{A/np.exp(0.15):.2f}_s{s}_ndev8_nheld30'
            rr = [one(np.log(A), np.log(A) - 0.15, s, 8, 30, rule) for _ in range(REPS)]
            out['shift'][key] = summarize(rr); print(key, out['shift'][key], flush=True)
# 강제 과장: (참 A*_sat, 강제 a)
for A, a in ((1.3, 2.0), (1.5, 2.0), (1.6, 2.0), (1.25, 1.5), (1.15, 1.5), (1.1, 1.25), (1.2, 1.25)):
    for s in (0.20, 0.35):
        for n_held in (30, 45):
            key = f'A{A}_force{a}_ratio{a/A:.2f}_s{s}_nheld{n_held}'
            rr = [one(np.log(A), np.log(A), s, 8, n_held, 'D', force=a) for _ in range(REPS)]
            out['forced'][key] = summarize(rr); print(key, out['forced'][key], flush=True)
json.dump(out, open(sys.argv[1], 'w'), indent=1, ensure_ascii=False)
