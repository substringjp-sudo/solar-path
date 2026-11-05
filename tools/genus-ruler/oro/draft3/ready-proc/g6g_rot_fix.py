"""Proposed deterministic replacement for the G6(g) rho_rot clause (MODIS-free):
(1) truth T = B + dC_rot (2x2 replicate, u8) -> median rho_rot >= 0.99 per site/set;
(2) 200 pure-noise truths per scene (seed fixed): mean of all scene rho_rot within |.| <= 0.01.
Usage: python3 -I g6g_rot_fix.py <stat_dir> <bench_dir> <dem_png> <out_json>"""
import sys, json, math
import numpy as np
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
import sim1_lib as L
import oro_core as oc
hS = L.load_dem(sys.argv[3]); n = hS.shape[0]
hY = oc.synth_terrain(n, 6000.0, rms=400.0, seed=7); hY = hY - hY.min()
box = lambda a: L.blocks(a, n)
SETS = {'even': list(range(0, 360, 45)), 'skew': [270, 285, 300, 315, 330, 345, 105, 150]}
uv = lambda f: (-8 * math.sin(math.radians(f)), -8 * math.cos(math.radians(f)))
out = {'det': {}, 'noise_mean': {}}
allx = []
for site, h in (('seoul', hS), ('synth', hY)):
    B = 1 / (1 + np.exp(-1.2 * L.smooth_field(n, 100, 11 if site == 'seoul' else 12))); hr = np.rot90(h, 2)
    for sname, dirs in SETS.items():
        vals = []
        for frm in dirs:
            U, V = uv(frm)
            F, _ = L.forcing(h, U, V); Fr, _ = L.forcing(h, -U, -V); Fo, _ = L.forcing(hr, U, V)
            _, dC, _ = oc.combine(B, F, iters=10); _, dCr, _ = oc.combine(B, Fr, iters=10); _, dCo, _ = oc.combine(B, Fo, iters=10)
            Su = (np.abs(box(dC)) >= 0.02) | (np.abs(box(dCr)) >= 0.02)
            T = np.clip(B + dCo, 0, 1); Tj = (np.round(np.kron(T, np.ones((2, 2))) * 255) / 255).reshape(n, 2, n, 2).mean(axis=(1, 3))
            vals.append(L.corr(box(dCo)[Su], box(Tj - B)[Su])); allx.append((box(dCo), Su))
        out['det'][f'{site}/{sname}'] = round(float(np.median(vals)), 4)
for kind in ('gauss20', 'gauss50', 'pow3'):
    for base in (20261103, 1, 2):
        rng_seed = base; acc = []
        for rep in range(200):
            for xo, Su in allx:
                rng_seed += 1; r = box(L.surrogate_R(n, kind, rng_seed)); acc.append(L.corr(xo[Su], r[Su]))
        out['noise_mean'][f'{kind}/seed{base}'] = round(float(np.mean(acc)), 4)
json.dump(out, open(sys.argv[4], 'w'), indent=1); print(json.dumps(out, indent=1))
