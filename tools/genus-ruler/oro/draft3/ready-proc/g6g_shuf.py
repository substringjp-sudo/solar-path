"""G6(g) G-shuf clauses (i) mean > (ii) mean + 0.2 and |(ii) mean| <= 0.05, over W, one B per site/set. MODIS-free.
Usage: python3 -I g6g_shuf.py <stat_dir> <bench_dir> <dem_png>"""
import sys, json, math
import numpy as np
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
import sim1_lib as L
import oro_core as oc
hS = L.load_dem(sys.argv[3]); n = hS.shape[0]
hY = oc.synth_terrain(n, 6000.0, rms=400.0, seed=7); hY = hY - hY.min()
box = lambda a: L.blocks(a, n)
q = lambda T, B: box((np.round(np.kron(np.clip(T, 0, 1), np.ones((2, 2))) * 255) / 255).reshape(n, 2, n, 2).mean(axis=(1, 3)) - B)
SETS = {'even': (list(range(0, 360, 45)), 0), 'skew': ([270, 285, 300, 315, 330, 345, 105, 150], 300)}
uv = lambda f: (-8 * math.sin(math.radians(f)), -8 * math.cos(math.radians(f)))
res = {}
for site, h in (('seoul', hS), ('synth', hY)):
    B = 1 / (1 + np.exp(-1.2 * L.smooth_field(n, 100, 11 if site == 'seoul' else 12)))
    for sname, (dirs, kstar) in SETS.items():
        dC = {}
        for frm in dirs:
            U, V = uv(frm); F, _ = L.forcing(h, U, V); dC[frm] = oc.combine(B, F, iters=10)[1]
        for mode in ('i', 'ii'):
            ds = []
            for j in dirs:
                r = q(B + (dC[j] if mode == 'i' else dC[kstar]), B)
                a = L.corr(box(dC[j]), r); b = np.mean([L.corr(box(dC[k]), r) for k in dirs if k != j]); ds.append(a - b)
            res[f'{site}/{sname}/{mode}'] = {'mean': round(float(np.mean(ds)), 4), 'median': round(float(np.median(ds)), 4)}
print(json.dumps(res, indent=1))
