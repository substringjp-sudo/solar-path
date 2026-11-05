"""Scene-level calibration of the RULER-oro c2 rule (median > 0 and date-block percentile L95 > 0).
Scenes: the 6 mountain-likely held sites x 13 dates (key layout from modis-times.json keys only).
rho_i = mu + u_site + v_date + e_i.  Compare date-block bootstrap vs two-way (site x date) bootstrap,
and leave-one-site-out.  Usage: python3 -I sim2.py <modis_times_json> <out_json>
"""
import sys, json
import numpy as np

keys = list(json.load(open(sys.argv[1])).keys())
SITES = ['busan', 'denver', 'osaka', 'sapporo', 'sydney', 'lisbon']
P_APPLY = {'denver': 0.5, 'sapporo': 0.4, 'busan': 0.3, 'osaka': 0.3, 'sydney': 0.3, 'lisbon': 0.2}
cells = [(k.rsplit('_', 1)[0], k.rsplit('_', 1)[1]) for k in keys if k.rsplit('_', 1)[0] in SITES]
dates = sorted({d for _, d in cells}); si = {s: i for i, s in enumerate(SITES)}; di = {d: i for i, d in enumerate(dates)}
S_IDX = np.array([si[s] for s, _ in cells]); D_IDX = np.array([di[d] for _, d in cells])
PA = np.array([P_APPLY[s] for s, _ in cells])
rng = np.random.default_rng(20261104)
B = 1000

def wmedian(vals, W):
    """vals (n,), W (B, n) integer multiplicities -> np.median of each multiset."""
    o = np.argsort(vals); v = vals[o]; W = W[:, o]
    cw = np.cumsum(W, axis=1); T = cw[:, -1]
    ok = T > 0
    r0 = (T - 1) // 2; r1 = T // 2
    i0 = np.argmax(cw > r0[:, None], axis=1); i1 = np.argmax(cw > r1[:, None], axis=1)
    m = 0.5 * (v[i0] + v[i1])
    return m[ok]

def one(mu, tau_s, tau_d, sig, min_n=20):
    while True:
        a = rng.random(len(cells)) < PA
        if a.sum() >= min_n:
            break
    s, d = S_IDX[a], D_IDX[a]
    u = rng.normal(0, tau_s, len(SITES)); v = rng.normal(0, tau_d, len(dates))
    rho = np.clip(mu + u[s] + v[d] + rng.normal(0, sig, a.sum()), -1, 1)
    med = np.median(rho)
    # date-block: multiplicity of each date
    cd = rng.multinomial(len(dates), np.full(len(dates), 1 / len(dates)), size=B)
    m1 = wmedian(rho, cd[:, d])
    # two-way pigeonhole: site counts x date counts
    cs = rng.multinomial(len(SITES), np.full(len(SITES), 1 / len(SITES)), size=B)
    m2 = wmedian(rho, cs[:, s] * cd[:, d])
    L1 = np.percentile(m1, 2.5); L2 = np.percentile(m2, 2.5)
    loso = all(np.median(rho[s != k]) > 0 for k in np.unique(s))
    top = np.bincount(s, minlength=len(SITES)).max() / a.sum()
    return med > 0 and L1 > 0, med > 0 and L2 > 0, med > 0 and L1 > 0 and loso, int(a.sum()), top, len(np.unique(s)), len(np.unique(d))

out = {}
REPS = 1500
for sig in (0.15, 0.25):
    for tau_s in (0.0, 0.05, 0.10):
        for mu in (0.0, 0.05, 0.10, 0.15):
            r = [one(mu, tau_s, 0.03, sig) for _ in range(REPS)]
            out[f'sig{sig}_tauS{tau_s}_mu{mu}'] = {
                'P_pass_dateblock': round(np.mean([x[0] for x in r]), 3),
                'P_pass_twoway': round(np.mean([x[1] for x in r]), 3),
                'P_pass_dateblock_and_LOSO': round(np.mean([x[2] for x in r]), 3),
                'n_med': float(np.median([x[3] for x in r])),
                'topSiteShare_med': round(float(np.median([x[4] for x in r])), 2),
                'nSites_med': float(np.median([x[5] for x in r])), 'nDates_med': float(np.median([x[6] for x in r]))}
            print(f'sig{sig}_tauS{tau_s}_mu{mu}', out[f'sig{sig}_tauS{tau_s}_mu{mu}'], flush=True)
json.dump(out, open(sys.argv[2], 'w'), indent=1)
