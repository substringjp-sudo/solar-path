"""P1: dichotomous f(<=30 deg) vs axial V = mean cos(2*dtheta), both against a within-site permutation null.
Alternative: mixture, with prob q the satellite axis follows theta_CBL (axial vM kappa=4), else independent.
Marginals non-uniform: wind axis concentrated per site (kappa 1.5 around a site axis), 30 % of satellite axes locked to E-W.
Usage: python3 -I sim3b.py <out_json>
"""
import sys, json
import numpy as np
rng = np.random.default_rng(5)

def avm(mu, k, size):
    return (np.degrees(rng.vonmises(np.radians(2 * np.asarray(mu)), k, size)) / 2) % 180

def dth(a, b):
    d = np.abs((a - b) % 180); return np.minimum(d, 180 - d)

def scenes(n, q, nsite=8):
    site = rng.integers(0, nsite, n)
    site_axis = rng.uniform(0, 180, nsite)
    tc = avm(site_axis[site], 1.5, n)
    locked = rng.random(n) < 0.3
    ts_ind = np.where(locked, avm(np.full(n, 90.0), 4.0, n), rng.uniform(0, 180, n))
    follow = rng.random(n) < q
    ts = np.where(follow, avm(tc, 4.0, n), ts_ind)
    return site, tc, ts

def perm_null(site, tc, ts, stat, P=400):
    vals = []
    for _ in range(P):
        tcp = tc.copy()
        for s in np.unique(site):
            idx = np.where(site == s)[0]; tcp[idx] = tc[rng.permutation(idx)]
        vals.append(stat(dth(ts, tcp)))
    return np.array(vals)

f_stat = lambda d: np.mean(d <= 30)
v_stat = lambda d: np.mean(np.cos(np.radians(2 * d)))

def once(n, q):
    site, tc, ts = scenes(n, q)
    d = dth(ts, tc)
    res = {}
    res['naive_f'] = None
    # naive: iid bootstrap L95(f) > 1/3 (the draft's null)
    bs = rng.integers(0, n, (600, n))
    res['naive_f'] = np.percentile((d[bs] <= 30).mean(axis=1), 2.5) > 1 / 3
    for nm, st in (('perm_f', f_stat), ('perm_V', v_stat)):
        nul = perm_null(site, tc, ts, st)
        res[nm] = np.mean(nul >= st(d)) <= 0.025
    return res

out = {}
for n in (15, 30):
    for q in (0.0, 0.15, 0.27, 0.40):
        rr = [once(n, q) for _ in range(400)]
        out[f'n{n}_q{q}'] = {k: round(float(np.mean([r[k] for r in rr])), 3) for k in ('naive_f', 'perm_f', 'perm_V')}
        out[f'n{n}_q{q}']['f_expected_vs_uniform'] = round(0.95 * q + (1 - q) / 3, 3)
        print(f'n{n}_q{q}', out[f'n{n}_q{q}'], flush=True)
json.dump(out, open(sys.argv[1], 'w'), indent=1)
