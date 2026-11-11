"""Joint power of c2 & c3 & c6 and LOSO-L95 variant.  rho_rev_i = -0.8*mu + e2, corr(e1,e2) = -0.79 (sim1b).
multiPass flags from modis-times.json (missing -> single pass).  Usage: python3 -I sim2c.py <stat_dir> <modis_times_json> <out_json>
"""
import sys, json
import numpy as np
src = open(sys.argv[1] + '/sim2.py').read().split('out = {}')[0]
mt = json.load(open(sys.argv[2]))
sys.argv = [sys.argv[0], sys.argv[2], sys.argv[3]]
g = {'__name__': 's2lib'}; exec(compile(src, 'sim2lib', 'exec'), g)
cells, S_IDX, D_IDX, PA, SITES, dates, wmedian = g['cells'], g['S_IDX'], g['D_IDX'], g['PA'], g['SITES'], g['dates'], g['wmedian']
SINGLE = np.array([not mt[f'{s}_{d}'].get('multiPass', False) for s, d in cells])
rng = np.random.default_rng(11)
B = 1000
C = np.array([[1, -0.79], [-0.79, 1]])
Lc = np.linalg.cholesky(C)

def L95(x, d):
    cd = rng.multinomial(len(dates), np.full(len(dates), 1 / len(dates)), size=B)
    return np.percentile(wmedian(x, cd[:, d]), 2.5)

def one(mu, sig, tau_s):
    while True:
        a = rng.random(len(cells)) < PA
        if a.sum() >= 20:
            break
    s, d, sp = S_IDX[a], D_IDX[a], SINGLE[a]
    u = rng.normal(0, tau_s, len(SITES))
    e = (rng.standard_normal((a.sum(), 2)) @ Lc.T) * sig
    r1 = np.clip(mu + u[s] + e[:, 0], -1, 1); r2 = np.clip(-0.8 * mu - 0.8 * u[s] + e[:, 1], -1, 1)
    dd = r1 - r2
    c2 = np.median(r1) > 0 and L95(r1, d) > 0
    c3 = np.median(dd) > 0 and L95(dd, d) > 0
    c6 = (sp.sum() < 8) or np.median(r1[sp]) >= 0
    loso95 = all(L95(r1[s != k], d[s != k]) > 0 for k in np.unique(s))
    return c2, c3, c6, c2 and c3 and c6, c2 and loso95

out = {}
for mu in (0.0, 0.05, 0.10, 0.15):
    for sig in (0.15, 0.2):
        r = np.array([one(mu, sig, 0.05) for _ in range(800)])
        out[f'mu{mu}_sig{sig}_tau0.05'] = dict(zip(['c2', 'c3', 'c6', 'c2&c3&c6', 'c2&LOSO95'], [round(float(x), 3) for x in r.mean(axis=0)]))
        print(f'mu{mu}_sig{sig}', out[f'mu{mu}_sig{sig}_tau0.05'], flush=True)
json.dump(out, open(sys.argv[2], 'w'), indent=1)
