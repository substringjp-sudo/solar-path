"""G6(f) feasibility of 'rho_res^vis >= 0' for a CORRECT implementation (MODIS-free).
T_fake is built from the judge path (B_tot + dC_tot), but rho^vis uses the app path (bands, caps).
Terrain: Seoul Terrarium tile (terrain only). B bands: synthetic Barnes-like smooth fields.
Usage: python3 -I g6f_vis.py <stat_dir> <bench_dir> <dem_png> <out_json>"""
import sys, json, math
import numpy as np
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
import sim1_lib as L
import oro_core as oc
h = L.load_dem(sys.argv[3]); n = h.shape[0]; c = n // 2
w = slice(c - 15, c + 15)
box = lambda a: a[w, w].reshape(15, 2, 15, 2).mean(axis=(1, 3)).ravel()
yy, xx = np.mgrid[0:n, 0:n]; disk = np.hypot(yy - c, xx - c) * 6 <= 150
def band(seed, amp, off):
    return 1 / (1 + np.exp(-(amp * L.smooth_field(n, 100, seed) + off)))
def tau(Bb):  # macroTileCover: max(first arg = ring point 0 ~ centre value, p75 within 150 km)
    return max(float(Bb[c, c]), float(np.percentile(Bb[disk], 75)))
rng = np.random.default_rng(20261104)
out = []
for k in range(40):
    s = 1000 + 10 * k
    lo = band(s, 1.5, rng.uniform(-1.5, 0.5)); mid = band(s + 1, 1.5, rng.uniform(-2, 0.5)); hi = band(s + 2, 1.5, rng.uniform(-3, -0.5))
    rand = 1 - (1 - lo) * (1 - mid) * (1 - hi); mx = np.maximum(np.maximum(lo, mid), hi)
    wmix = rng.uniform(0.0, 1.0); Btot = wmix * mx + (1 - wmix) * rand    # NWP total between max and random overlap
    for deg in range(0, 360, 45):
        U = 10 * math.sin(math.radians(deg)); V = 10 * math.cos(math.radians(deg))
        F, _ = L.forcing(h, U, V)
        _, dC, _ = oc.combine(Btot, F, iters=10)
        x = box(dC); S = np.abs(x) >= 0.02
        if S.sum() < 20: continue
        T = np.clip(Btot + dC, 0, 1)
        Tj = (np.round(np.kron(T, np.ones((2, 2))) * 255) / 255).reshape(n, 2, n, 2).mean(axis=(1, 3))
        Clo, _, _ = oc.combine(lo, F, iters=10); Cmid, _, _ = oc.combine(mid, F, iters=10)
        tl, tm, th = tau(lo), tau(mid), tau(hi)
        Bvis = 1 - (1 - np.minimum(lo, tl)) * (1 - np.minimum(mid, tm)) * (1 - np.minimum(hi, th))
        Cvis = 1 - (1 - np.minimum(Clo, tl)) * (1 - np.minimum(Cmid, tm)) * (1 - np.minimum(hi, th))
        X = box(Cvis - Bvis); Y = box(Tj - Bvis)
        rv = L.corr(X[S], Y[S]) if np.ptp(X[S]) > 0 else 0.0
        # alternative: fake truth for the app path built from the app path itself
        Tv = np.clip(Bvis + (Cvis - Bvis), 0, 1)
        Tvj = (np.round(np.kron(Tv, np.ones((2, 2))) * 255) / 255).reshape(n, 2, n, 2).mean(axis=(1, 3))
        rv2 = L.corr(X[S], box(Tvj - Bvis)[S]) if np.ptp(X[S]) > 0 else 0.0
        out.append({'k': k, 'deg': deg, 'nS': int(S.sum()), 'rho_vis': round(rv, 3), 'rho_vis_appT': round(rv2, 3),
                    'sdD': round(float(box(Btot - Bvis).std()), 4), 'sd_dC_S': round(float(x[S].std()), 4)})
neg = [o for o in out if o['rho_vis'] < 0]
res = {'cases': len(out), 'n_rho_vis_neg': len(neg), 'frac_neg': round(len(neg) / max(len(out), 1), 3),
       'rho_vis_quantiles': [round(float(q), 3) for q in np.percentile([o['rho_vis'] for o in out], [0, 5, 25, 50])],
       'rho_vis_appT_min': min(o['rho_vis_appT'] for o in out),
       'by_scene_k_any_neg': len({o['k'] for o in neg}), 'examples_neg': neg[:6]}
json.dump(res, open(sys.argv[4], 'w'), indent=1); print(json.dumps(res, indent=1))
