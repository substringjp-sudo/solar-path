"""Check: with truth T = B + dC_rot, median rho_res (unrotated dC) is > 0.3 below median rho_rot (catches 'forgot to rotate').
Usage: python3 -I g6g_rot_drop.py <stat_dir> <bench_dir> <dem_png>"""
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
res = {}
for site, h in (('seoul', hS), ('synth', hY)):
    B = 1 / (1 + np.exp(-1.2 * L.smooth_field(n, 100, 11 if site == 'seoul' else 12))); hr = np.rot90(h, 2)
    for sname, dirs in SETS.items():
        ro, rr = [], []
        for frm in dirs:
            U, V = uv(frm)
            F, _ = L.forcing(h, U, V); Fr, _ = L.forcing(h, -U, -V); Fo, _ = L.forcing(hr, U, V)
            _, dC, _ = oc.combine(B, F, iters=10); _, dCr, _ = oc.combine(B, Fr, iters=10); _, dCo, _ = oc.combine(B, Fo, iters=10)
            Su = (np.abs(box(dC)) >= 0.02) | (np.abs(box(dCr)) >= 0.02); S = np.abs(box(dC)) >= 0.02
            T = np.clip(B + dCo, 0, 1); r = box((np.round(np.kron(T, np.ones((2, 2))) * 255) / 255).reshape(n, 2, n, 2).mean(axis=(1, 3)) - B)
            ro.append(L.corr(box(dCo)[Su], r[Su])); rr.append(L.corr(box(dC)[S], r[S]))
        res[f'{site}/{sname}'] = {'med_rho_rot': round(float(np.median(ro)), 3), 'med_rho_res': round(float(np.median(rr)), 3), 'max_rho_res': round(float(np.max(rr)), 3)}
print(json.dumps(res, indent=1))
