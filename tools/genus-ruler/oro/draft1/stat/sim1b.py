"""Selection asymmetry S vs S_rev, wind-even share, and corr(dC, B) on S (regression-to-mean channel).
Usage: python3 -I sim1b.py <bench_dir> <dem_png> <stat_dir> <out_json>
"""
import sys, json, math
import numpy as np
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[3])
import oro_core as oc
import importlib.util
spec = importlib.util.spec_from_file_location('sim1', sys.argv[3] + '/sim1_lib.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)

out = {'rows': []}
terrains = [('seoulTile', L.load_dem(sys.argv[2]), 64)]
for sd in range(1, 7):
    terrains.append(('synth%d' % sd, oc.synth_terrain(128, L.DX, beta=3.0, rms=900.0, seed=sd), 128))
winds = [(10, 0), (0, 10), (-7, 7), (6, 0), (0, -6), (5, -5), (14, 4)]
for name, h, n in terrains:
    for (U, V) in winds:
        for Bs in (1, 2):
            b, br, B, hr, Fb, Frb, hb = L.scene(h, float(U), float(V), 100 * Bs + len(name), n)
            Bb = L.blocks(B, n)
            S = np.abs(b) >= 0.02; Sr = np.abs(br) >= 0.02; Su = S | Sr
            out['rows'].append({'t': name, 'U': U, 'V': V, 'Bseed': Bs, 'hsub_rms': round(hr, 1),
                'nS': int(S.sum()), 'nSrev': int(Sr.sum()), 'nU': int(Su.sum()),
                'c_F_h': round(L.corr(Fb, hb), 3), 'c_Frev_h': round(L.corr(Frb, hb), 3),
                'c_dC_B_S': round(L.corr(b[S], Bb[S]), 3) if S.sum() > 2 else None,
                'c_dCrev_B_Sr': round(L.corr(br[Sr], Bb[Sr]), 3) if Sr.sum() > 2 else None,
                'c_dC_dCrev_U': round(L.corr(b[Su], br[Su]), 3) if Su.sum() > 2 else None})
rows = out['rows']
app = [r for r in rows if r['hsub_rms'] >= 100 and r['nS'] >= 20]
out['summary'] = {
  'n_rows': len(rows), 'n_applicable_like': len(app),
  'frac_app_with_nSrev_lt20': round(sum(r['nSrev'] < 20 for r in app) / max(1, len(app)), 3),
  'median_abs_nS_minus_nSrev_over_nS': round(float(np.median([abs(r['nS'] - r['nSrev']) / r['nS'] for r in app])), 3) if app else None,
  'median_c_F_h': round(float(np.median([r['c_F_h'] for r in app])), 3) if app else None,
  'median_c_Frev_h': round(float(np.median([r['c_Frev_h'] for r in app])), 3) if app else None,
  'q_c_dC_B_S': [round(float(np.percentile([r['c_dC_B_S'] for r in app], q)), 3) for q in (10, 50, 90)] if app else None,
  'median_c_dC_dCrev_U': round(float(np.median([r['c_dC_dCrev_U'] for r in app])), 3) if app else None,
}
json.dump(out, open(sys.argv[4], 'w'), indent=1)
print(json.dumps(out['summary'], indent=1))
