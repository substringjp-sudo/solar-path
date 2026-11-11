"""Recheck sim B2 (조합 규칙): RULER-regime 2판 P1 의 층 안 순열 null 이 날씨 지속·계절 함께 바뀜에서 맞는가.  MODIS 없음, 합성 각만.
- 8 사이트 x 153 일(6~10 월). 축 각(mod 180).
- theta_CBL(s,t) = b_s + R*(t/T - 0.5) + e_t,  e: AR(1)(phi), SD 35 deg.
- theta_sat(H0) = 30 % 주사 축(vM 90 deg, kappa 4), 나머지 c_s + R_art*(t/T - 0.5) + g_t + 떨림(vM kappa 8). g: e 와 독립 AR(1).
  c_s = b_s (사이트 기후 방향은 같음 - 층 안 순열이 지워야 하는 몫).
- H1: 확률 q 로 theta_sat = theta_CBL + vM(kappa 4).
- ROLL 날: 2 상태 Markov(머무름 p_stay), P1 = ROLL & A 문턱(0.5). 목표 P1 30~40.
- 검정(한쪽 p <= 0.025): (i) 사이트 안 순열(2판 (사이트, 위성) 의 위성 하나), (ii) (사이트, 두 달) 안 순열,
  (iii) 사이트 공통 시간 이동 null: 사이트마다 u in {+-7..+-30} 일 하나, theta_CBL(s, t_i + u)(끝은 반대쪽으로).
Usage: python3 -I simB_p1.py <out_json> [reps]
"""
import sys, json
import numpy as np
rng = np.random.default_rng(20261107)
REPS = int(sys.argv[2]) if len(sys.argv) > 2 else 400
T, NS, P = 153, 8, 1000
SHIFTS = np.array([u for u in range(-30, 31) if abs(u) >= 7])

def ar1(phi, sd, n):
    x = np.empty(n); x[0] = rng.normal(0, sd)
    for t in range(1, n): x[t] = phi * x[t - 1] + np.sqrt(1 - phi ** 2) * rng.normal(0, sd)
    return x

def avm(mu, k, size):
    return (np.degrees(rng.vonmises(np.radians(2 * np.asarray(mu, float)), k, size)) / 2) % 180

def cos2(a, b):
    return np.cos(np.radians(2 * (a - b)))

def world(q, phi, R, p_stay):
    tc = np.empty((NS, T)); ts = np.empty((NS, T)); roll = np.zeros((NS, T), bool)
    pi = 0.05
    p01 = pi * (1 - p_stay) / (1 - pi)
    for s in range(NS):
        b = rng.uniform(0, 180); tt = np.arange(T) / T - 0.5
        tc[s] = (b + R * tt + ar1(phi, 35, T)) % 180
        art = (b + R * tt + ar1(phi, 35, T)) % 180
        art = avm(art, 8.0, T)
        locked = rng.random(T) < 0.3
        h0 = np.where(locked, avm(np.full(T, 90.0), 4.0, T), art)
        fol = rng.random(T) < q
        ts[s] = np.where(fol, avm(tc[s], 4.0, T), h0)
        st = rng.random() < pi
        for t in range(T):
            st = (rng.random() < p_stay) if st else (rng.random() < p01)
            roll[s, t] = st
    sel = roll & (rng.random((NS, T)) < 0.5)
    return tc, ts, sel

def tests(tc, ts, sel):
    S, Tt = np.nonzero(sel)
    a_sat = ts[S, Tt]; a_cbl = tc[S, Tt]
    V = cos2(a_sat, a_cbl).mean()
    # (i) site permutation
    Vp = np.empty(P)
    idx_by = [np.where(S == s)[0] for s in range(NS)]
    for b in range(P):
        perm = np.arange(len(S))
        for ix in idx_by:
            if len(ix) > 1: perm[ix] = rng.permutation(ix)
        Vp[b] = cos2(a_sat, a_cbl[perm]).mean()
    p1 = (1 + np.sum(Vp >= V)) / (P + 1)
    # (ii) site x two-month (61-day bins approx: Jun-Jul, Aug-Sep, Oct)
    blk = np.minimum(Tt // 61, 2)
    idx2 = [np.where((S == s) & (blk == k))[0] for s in range(NS) for k in range(3)]
    for b in range(P):
        perm = np.arange(len(S))
        for ix in idx2:
            if len(ix) > 1: perm[ix] = rng.permutation(ix)
        Vp[b] = cos2(a_sat, a_cbl[perm]).mean()
    p2 = (1 + np.sum(Vp >= V)) / (P + 1)
    # (iii) site-common time shift
    for b in range(P):
        u = rng.choice(SHIFTS, NS)[S]
        t2 = Tt + u; bad = (t2 < 0) | (t2 >= T); t2[bad] = Tt[bad] - u[bad]
        Vp[b] = cos2(a_sat, tc[S, t2]).mean()
    p3 = (1 + np.sum(Vp >= V)) / (P + 1)
    SH2 = np.array([u for u in range(-45, 46) if abs(u) >= 10])
    for b in range(P):
        u = rng.choice(SH2, NS)[S]
        t2 = Tt + u; bad = (t2 < 0) | (t2 >= T); t2[bad] = Tt[bad] - u[bad]
        Vp[b] = cos2(a_sat, tc[S, t2]).mean()
    p4 = (1 + np.sum(Vp >= V)) / (P + 1)
    return p1 <= 0.025, p2 <= 0.025, p3 <= 0.025, len(S), p4 <= 0.025, (p1 <= 0.025) and (p2 <= 0.10), (p1 <= 0.025) and (p2 <= 0.05)

SC = [
    ('H0_persist0.85', dict(q=0.0, phi=0.85, R=0.0, p_stay=0.7)),
    ('H0_season60', dict(q=0.0, phi=0.0, R=60.0, p_stay=0.0)),
    ('H0_season60_persist0.7', dict(q=0.0, phi=0.7, R=60.0, p_stay=0.6)),
    ('H1_q0.27_iid', dict(q=0.27, phi=0.0, R=0.0, p_stay=0.0)),
    ('H1_q0.27_season60_persist0.7', dict(q=0.27, phi=0.7, R=60.0, p_stay=0.6)),
    ('H1_q0.40_season60_persist0.7', dict(q=0.40, phi=0.7, R=60.0, p_stay=0.6)),
]
out = {}
for nm, kw in SC:
    rr = np.array([tests(*world(**kw)) for _ in range(REPS)])
    out[nm] = {'reject_sitePerm(2판)': round(float(rr[:, 0].mean()), 3), 'reject_siteTwoMonthPerm': round(float(rr[:, 1].mean()), 3),
               'reject_timeShift7-30': round(float(rr[:, 2].mean()), 3), 'reject_timeShift10-45': round(float(rr[:, 4].mean()), 3),
               'reject_sitePerm_and_2mo<=0.10': round(float(rr[:, 5].mean()), 3), 'reject_sitePerm_and_2mo<=0.05': round(float(rr[:, 6].mean()), 3),
               'nP1_med': float(np.median(rr[:, 3]))}
    print(nm, out[nm], flush=True)
json.dump(out, open(sys.argv[1], 'w'), indent=1)
