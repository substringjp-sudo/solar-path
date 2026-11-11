"""G6(g) last clause: does a CORRECT implementation meet '|median rho_rot| <= 0.05' on pure-noise truth?
MODIS-free. Terrain: Seoul Terrarium tile (terrain only) + one synthetic terrain. B: one synthetic field per site/set.
Truth r: spatially correlated noise, independent per scene. rho_rot = Pearson over S-union of (dC_rot, r).
Usage: python3 -I g6g_rot.py <stat_dir> <bench_dir> <dem_png> <out_json>"""
import sys, json, math
import numpy as np
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
import sim1_lib as L
import oro_core as oc
hS = L.load_dem(sys.argv[3]); n = hS.shape[0]
hY = oc.synth_terrain(n, 6000.0, rms=400.0, seed=7); hY = hY - hY.min()
box = lambda a: L.blocks(a, n)
SETS = {'even': list(range(0, 360, 45)), 'skew': [270, 285, 300, 315, 330, 345, 105, 150]}
def uv(frm):  # from-direction -> toward vector (U east, V north)
    return -8 * math.sin(math.radians(frm)), -8 * math.cos(math.radians(frm))
pre = {}
for site, h in (('seoul', hS), ('synth', hY)):
    B = 1 / (1 + np.exp(-1.2 * L.smooth_field(n, 100, 11 if site == 'seoul' else 12)))
    hr = np.rot90(h, 2)
    for sname, dirs in SETS.items():
        rows = []
        for frm in dirs:
            U, V = uv(frm)
            F, _ = L.forcing(h, U, V, N=0.01); Fr, _ = L.forcing(h, -U, -V, N=0.01); Fo, _ = L.forcing(hr, U, V, N=0.01)
            _, dC, _ = oc.combine(B, F, iters=10); _, dCr, _ = oc.combine(B, Fr, iters=10); _, dCo, _ = oc.combine(B, Fo, iters=10)
            x, xr, xo = box(dC), box(dCr), box(dCo)
            Su = (np.abs(x) >= 0.02) | (np.abs(xr) >= 0.02)
            rows.append((xo, Su))
        pre[(site, sname)] = rows
res = {}
for kind in ('gauss20', 'gauss50', 'pow3'):
    seed = 0; pass_all = 0; R = 400; meds = {k: [] for k in pre}; sds = {k: [] for k in pre}
    for rep in range(R):
        ok = True
        for key, rows in pre.items():
            vals = []
            for xo, Su in rows:
                seed += 1; r = box(L.surrogate_R(n, kind, 100000 + seed))
                vals.append(L.corr(xo[Su], r[Su]) if Su.sum() >= 3 else 0.0)
            m = float(np.median(vals)); meds[key].append(m); sds[key].append(float(np.std(vals)))
            ok = ok and abs(m) <= 0.05
        pass_all += ok
    res[kind] = {'P_pass_all4': round(pass_all / R, 3),
                 'per_set': {f'{k[0]}/{k[1]}': {'P_pass': round(float(np.mean(np.abs(meds[k]) <= 0.05)), 3),
                                               'sd_median': round(float(np.std(meds[k])), 3), 'mean_sd_scene': round(float(np.mean(sds[k])), 3),
                                               'nSu': [int(Su.sum()) for _, Su in pre[k]]} for k in pre}}
json.dump(res, open(sys.argv[4], 'w'), indent=1); print(json.dumps(res, indent=1))
