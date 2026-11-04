"""v3 sim E: RULER-regime P1 null — 재검토가 권한 '사이트 공통 시간 이동(모든 날)' 이 ROLL 날의 바람 축이 다른 날보다 몰려 있을 때도 맞는가,
그리고 이동한 날을 같은 사이트의 ROLL 날(탐측만으로 정함)로 한정하면 고쳐지는가.  MODIS 없음, 합성 각만.
모형(재검토 simB3 에 하나를 더함) [estimate]:
- 8 사이트 x 153 일. ROLL 날: 2 상태 Markov(평형 비율 0.14, 머무름 p_stay). P1 = ROLL 날 가운데 0.18(기하·예보·품질·A 문턱 통과 가정) -> n ~ 30.
- theta_CBL(s,t) = b_s + R*(t/T - 0.5) + e_t, e: AR(1)(phi), SD 35 deg.  conc=True 이면 ROLL 이 아닌 날에는 축에 넓은 떨림(doubled-angle vM kappa 0.4)을 더함
  (약풍 날·시어 축 대체 날의 축은 ROLL 날보다 흩어짐).
- theta_sat(H0) = 30 % 주사 축(vM 90, kappa 4), 나머지 b_s + R*(t/T-0.5) + g_t(+ vM kappa 8), g 는 e 와 독립 AR(1).  H1: 확률 q 로 theta_CBL + vM(kappa 4).
- 검정(한쪽 p <= 0.025, 각 P 번):
  (i) 사이트 안 순열(2판), (ii) 사이트 공통 시간 이동 ±10~45 일, 모든 날(재검토 고칠 글),
  (iii) 사이트 공통 시간 이동, 이동한 날을 그 사이트 ROLL 날로 한정: t_i+u 에서 7 일 안의 가장 가까운 ROLL 날 d(|d - t_i| >= 10), 없으면 t_i-u, 그래도 없으면 자기 축(보수적),
  (iv) 장면마다 따로: 그 사이트 ROLL 날 가운데 10 <= |d - t_i| <= 45 에서 고르게(없으면 자기 축).
Usage: python3 -I simE_p1_rollpool.py <out_json> [reps] [P]
"""
import sys, json
import numpy as np
rng = np.random.default_rng(20261104)
REPS = int(sys.argv[2]) if len(sys.argv) > 2 else 400
P = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
T, NS = 153, 8
SH = np.array([u for u in range(-45, 46) if abs(u) >= 10])

def ar1(phi, sd, n):
    x = np.empty(n); x[0] = rng.normal(0, sd)
    for t in range(1, n): x[t] = phi * x[t - 1] + np.sqrt(1 - phi ** 2) * rng.normal(0, sd)
    return x

def avm(mu, k, size):
    return (np.degrees(rng.vonmises(np.radians(2 * np.asarray(mu, float)), k, size)) / 2) % 180

def cos2(a, b):
    return np.cos(np.radians(2 * (a - b)))

def world(q, phi, R, p_stay, conc):
    tc = np.empty((NS, T)); ts = np.empty((NS, T)); roll = np.zeros((NS, T), bool)
    pi = 0.14; p01 = pi * (1 - p_stay) / (1 - pi)
    tt = np.arange(T) / T - 0.5
    for s in range(NS):
        st = rng.random() < pi
        for t in range(T):
            st = (rng.random() < p_stay) if st else (rng.random() < p01)
            roll[s, t] = st
        b = rng.uniform(0, 180)
        base = (b + R * tt + ar1(phi, 35, T)) % 180
        if conc:
            wide = avm(base, 0.4, T)
            base = np.where(roll[s], base, wide)
        tc[s] = base
        art = avm((b + R * tt + ar1(phi, 35, T)) % 180, 8.0, T)
        locked = rng.random(T) < 0.3
        h0 = np.where(locked, avm(np.full(T, 90.0), 4.0, T), art)
        fol = rng.random(T) < q
        ts[s] = np.where(fol, avm(tc[s], 4.0, T), h0)
    sel = roll & (rng.random((NS, T)) < 0.18)
    return tc, ts, roll, sel

def pval(Vn, V):
    return (1 + np.sum(Vn >= V)) / (len(Vn) + 1)

def tests(tc, ts, roll, sel):
    S, Tt = np.nonzero(sel); n = len(S)
    a_sat = ts[S, Tt]; own = tc[S, Tt]
    V = cos2(a_sat, own).mean()
    # (i) site permutation
    tot = np.zeros(P)
    for s in range(NS):
        ix = np.where(S == s)[0]
        if len(ix) == 0: continue
        perm = np.argsort(rng.random((P, len(ix))), axis=1)
        tot += cos2(a_sat[ix][None, :], own[ix][perm]).sum(axis=1)
    p1 = pval(tot / n, V)
    # shift tables: n x len(SH)
    tabA = np.empty((n, len(SH))); tabR = np.empty((n, len(SH)))
    for i in range(n):
        s, t = S[i], Tt[i]
        rd = np.where(roll[s])[0]
        for k, u in enumerate(SH):
            t2 = t + u
            if t2 < 0 or t2 >= T: t2 = t - u
            tabA[i, k] = tc[s, t2]
            val = None
            for uu in (u, -u):
                tgt = t + uu
                c = rd[(np.abs(rd - tgt) <= 7) & (np.abs(rd - t) >= 10)]
                if len(c):
                    d = c[np.argmin(np.abs(c - tgt) + 1e-3 * (c > tgt))]
                    val = tc[s, d]; break
            tabR[i, k] = own[i] if val is None else val
    draw = rng.integers(0, len(SH), (P, NS))[:, S]  # P x n, site-common u
    rows = np.arange(n)[None, :]
    p2 = pval(cos2(a_sat[None, :], tabA[rows, draw]).mean(axis=1), V)
    p3 = pval(cos2(a_sat[None, :], tabR[rows, draw]).mean(axis=1), V)
    # (iv) independent ROLL-pool draw
    rep = np.empty((P, n))
    for i in range(n):
        s, t = S[i], Tt[i]
        rd = np.where(roll[s])[0]
        c = rd[(np.abs(rd - t) >= 10) & (np.abs(rd - t) <= 45)]
        rep[:, i] = own[i] if len(c) == 0 else tc[s, c[rng.integers(0, len(c), P)]]
    p4 = pval(cos2(a_sat[None, :], rep).mean(axis=1), V)
    keep_own = float(np.mean(tabR == own[:, None]))
    a = 0.025
    return [p1 <= a, p2 <= a, p3 <= a, p4 <= a, (p1 <= a) and (p2 <= a), (p1 <= a) and (p3 <= a), (p1 <= a) and (p4 <= a), n, keep_own]

SC = [
    ('H0_iid_noconc', dict(q=0.0, phi=0.0, R=0.0, p_stay=0.3, conc=False)),
    ('H0_iid_conc', dict(q=0.0, phi=0.0, R=0.0, p_stay=0.3, conc=True)),
    ('H0_persist0.85_conc', dict(q=0.0, phi=0.85, R=0.0, p_stay=0.6, conc=True)),
    ('H0_season60_conc', dict(q=0.0, phi=0.0, R=60.0, p_stay=0.3, conc=True)),
    ('H0_season60_persist0.7_conc', dict(q=0.0, phi=0.7, R=60.0, p_stay=0.5, conc=True)),
    ('H0_season60_persist0.7_noconc', dict(q=0.0, phi=0.7, R=60.0, p_stay=0.5, conc=False)),
    ('H1_q0.27_iid_conc', dict(q=0.27, phi=0.0, R=0.0, p_stay=0.3, conc=True)),
    ('H1_q0.27_season60_persist0.7_conc', dict(q=0.27, phi=0.7, R=60.0, p_stay=0.5, conc=True)),
    ('H1_q0.40_season60_persist0.7_conc', dict(q=0.40, phi=0.7, R=60.0, p_stay=0.5, conc=True)),
]
names = ['i_sitePerm', 'ii_shiftAllDays', 'iii_shiftRollPool', 'iv_indepRollPool', 'i_and_ii', 'i_and_iii', 'i_and_iv']
out = {'model': __doc__.split('Usage')[0], 'reps': REPS, 'P': P}
for nm, kw in SC:
    rr = np.array([tests(*world(**kw)) for _ in range(REPS)], float)
    out[nm] = {k: round(float(rr[:, j].mean()), 3) for j, k in enumerate(names)}
    out[nm]['nP1_med'] = float(np.median(rr[:, 7])); out[nm]['keepOwn_share'] = round(float(rr[:, 8].mean()), 3)
    print(nm, out[nm], flush=True)
json.dump(out, open(sys.argv[1], 'w'), indent=1, ensure_ascii=False)
