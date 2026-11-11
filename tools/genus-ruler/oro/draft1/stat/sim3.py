"""RULER-regime P1: (a) chance match rate when theta_sat and theta_CBL are independent but not uniform;
(b) power / false pass of 'percentile L95(f) > 1/3' for n = 15, 30, 50 with site-date clustering;
(c) Aqua+Terra double counting (same site-date) effect.  Usage: python3 -I sim3.py <out_json>
"""
import sys, json
import numpy as np
rng = np.random.default_rng(3)

def axial_vm(mu_deg, kappa, size):
    # axial von Mises on [0,180): draw on doubled angle
    return (np.degrees(rng.vonmises(np.radians(2 * mu_deg), kappa, size)) / 2) % 180

def dtheta(a, b):
    d = np.abs((a - b) % 180); return np.minimum(d, 180 - d)

out = {'chance': {}}
M = 200000
for kc in (0.0, 1.0, 2.0):          # wind-axis concentration (prevailing westerly -> E-W axis = 90 deg)
    for w in (0.0, 0.3, 0.5):        # share of satellite axes locked to scan / coast direction (E-W)
        tc = axial_vm(90, kc, M) if kc > 0 else rng.uniform(0, 180, M)
        locked = rng.random(M) < w
        ts = np.where(locked, axial_vm(90, 4.0, M), rng.uniform(0, 180, M))
        out['chance'][f'kCBL{kc}_wLocked{w}'] = round(float(np.mean(dtheta(ts, tc) <= 30)), 3)

def p1_once(n, f, n_dates, B=1000, null_f=1 / 3):
    d = rng.integers(0, n_dates, n)
    date_eff = rng.normal(0, 0.0, n_dates)
    hit = rng.random(n) < np.clip(f + date_eff[d], 0, 1)
    dates = np.unique(d)
    cnt = np.array([[np.sum(hit[d == k]), np.sum(d == k)] for k in dates])
    draws = rng.integers(0, len(dates), (B, len(dates)))
    num = cnt[draws, 0].sum(axis=1); den = cnt[draws, 1].sum(axis=1)
    L = np.percentile(num / den, 2.5)
    return L > null_f

out['P1_pass'] = {}
for n in (15, 30, 50):
    for f in (1 / 3, 0.40, 0.45, 0.50, 0.60):
        r = [p1_once(n, f, n_dates=max(10, n // 2)) for _ in range(1500)]
        out['P1_pass'][f'n{n}_f{f:.2f}'] = round(float(np.mean(r)), 3)

# persistence: one site-week shares wind regime -> clusters of 3 scenes with common hit propensity
def p1_cluster(n, f, k, B=1000):
    g = n // k
    pr = np.clip(f + rng.normal(0, 0.25, g), 0, 1)
    hit = rng.random((g, k)) < pr[:, None]
    cnt = np.stack([hit.sum(axis=1), np.full(g, k)], axis=1)
    # date-block bootstrap with daily blocks treats each scene as its own block
    flat = hit.ravel().astype(float)
    draws = rng.integers(0, n, (B, n))
    L_daily = np.percentile(flat[draws].mean(axis=1), 2.5)
    draws = rng.integers(0, g, (B, g))
    L_week = np.percentile(cnt[draws, 0].sum(axis=1) / cnt[draws, 1].sum(axis=1), 2.5)
    return L_daily > 1 / 3, L_week > 1 / 3

out['P1_null_persistence'] = {}
for n, k in ((30, 3), (30, 5)):
    r = np.array([p1_cluster(n, 1 / 3, k) for _ in range(2000)])
    out['P1_null_persistence'][f'n{n}_clusterSize{k}'] = {'falsePass_dailyBlocks': round(float(r[:, 0].mean()), 3),
                                                         'falsePass_weekBlocks': round(float(r[:, 1].mean()), 3)}
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print(json.dumps(out, indent=1))
