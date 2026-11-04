"""(1) exact date-block sign-flip test for the median vs date-block percentile L95;
(2) one-site artifact scenario (denver u=+0.25, others 0) with and without leave-one-site-out.
Usage: python3 -I sim2b.py <stat_dir> <modis_times_json> <out_json>
"""
import sys, json, itertools
import numpy as np
import importlib.util
spec = importlib.util.spec_from_file_location('s2', sys.argv[1] + '/sim2.py')
src = open(sys.argv[1] + '/sim2.py').read().split('out = {}')[0]
sys.argv = [sys.argv[0], sys.argv[2], sys.argv[3]]
g = {'__name__': 's2lib'}; exec(compile(src, 'sim2lib', 'exec'), g)
cells, S_IDX, D_IDX, PA, SITES, dates, wmedian = g['cells'], g['S_IDX'], g['D_IDX'], g['PA'], g['SITES'], g['dates'], g['wmedian']
rng = np.random.default_rng(7)
SIGNS = np.array(list(itertools.product((1, -1), repeat=len(dates))))  # 8192 x 13
B = 1000

def draw(mu, tau_s, sig, site_art=None):
    while True:
        a = rng.random(len(cells)) < PA
        if a.sum() >= 20:
            break
    s, d = S_IDX[a], D_IDX[a]
    u = rng.normal(0, tau_s, len(SITES))
    if site_art is not None:
        u[:] = 0; u[SITES.index(site_art[0])] = site_art[1]
    rho = np.clip(mu + u[s] + rng.normal(0, 0.03, len(dates))[d] + rng.normal(0, sig, a.sum()), -1, 1)
    return rho, s, d

def tests(rho, s, d):
    med = np.median(rho)
    cd = rng.multinomial(len(dates), np.full(len(dates), 1 / len(dates)), size=B)
    L = np.percentile(wmedian(rho, cd[:, d]), 2.5)
    flip = np.median(SIGNS[:, d] * rho[None, :], axis=1)
    p = (np.sum(flip >= med)) / len(flip)
    loso = all(np.median(rho[s != k]) > 0 for k in np.unique(s))
    return med > 0 and L > 0, med > 0 and p <= 0.025, med > 0 and L > 0 and loso

out = {}
for name, kw in [('null_tau0_sig0.2', dict(mu=0, tau_s=0, sig=0.2)),
                 ('null_tau0.05_sig0.2', dict(mu=0, tau_s=0.05, sig=0.2)),
                 ('mu0.10_tau0_sig0.2', dict(mu=0.10, tau_s=0, sig=0.2)),
                 ('mu0.10_tau0.05_sig0.2', dict(mu=0.10, tau_s=0.05, sig=0.2)),
                 ('denverArtifact+0.25_mu0', dict(mu=0, tau_s=0, sig=0.2, site_art=('denver', 0.25))),
                 ('denverArtifact+0.40_mu0', dict(mu=0, tau_s=0, sig=0.2, site_art=('denver', 0.40)))]:
    r = np.array([tests(*draw(**kw)) for _ in range(1500)])
    out[name] = {'P_pass_dateblockL95': round(float(r[:, 0].mean()), 3), 'P_pass_signflip': round(float(r[:, 1].mean()), 3),
                 'P_pass_dateblock_LOSO': round(float(r[:, 2].mean()), 3)}
    print(name, out[name], flush=True)
json.dump(out, open(sys.argv[2], 'w'), indent=1)
