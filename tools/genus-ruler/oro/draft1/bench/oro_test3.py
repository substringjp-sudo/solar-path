import sys, json
import numpy as np
sys.path.insert(0, sys.argv[1]); import oro_core as oc
def corr(a, b):
    a = a.ravel() - a.mean(); b = b.ravel() - b.mean(); return float((a @ b) / np.sqrt((a @ a) * (b @ b)))
out = {}
f37 = 2 * 7.2921e-5 * np.sin(np.radians(37.0))
# branch difference (ours vs fastscape-style m) AFTER s=10 km high-pass + sigma_min damping, 6 km grid, column forcing
n, dx = 128, 6000.0
pad = 64; nn = n + 2 * pad; kx, ky = oc.kgrid(nn, dx)
h = np.pad(oc.synth_terrain(n, dx, beta=3.0, rms=600.0, seed=4), pad)
hs = oc.highpass(np.fft.fft2(h), kx, ky, 10e3)
U, V, N = 10 / np.sqrt(2), 10 / np.sqrt(2), 0.01
m, s = oc.vertical_m(kx, ky, U, V, N, f37); D = oc.damp_lowsigma(s, U, V)
s2 = s * s; num = np.maximum(N**2 - s2, 0); den = s2 - f37**2; eps = np.finfo(float).eps
den = np.where((den < eps) & (den >= 0), eps, den); den = np.where((den > -eps) & (den < 0), -eps, den)
mfs = np.where(s >= 0, 1, -1) * np.sqrt(np.abs(num / den * (kx**2 + ky**2)))
a = np.real(np.fft.ifft2(hs * D * oc.vweight(m, 'col')))[pad:-pad, pad:-pad]
b = np.real(np.fft.ifft2(hs * D * oc.vweight(mfs, 'col')))[pad:-pad, pad:-pad]
c = np.real(np.fft.ifft2(hs * oc.vweight(m, 'col')))[pad:-pad, pad:-pad]
out['branch_diff_after_filters'] = {'relrms(ours-fsbranch)': round(float(np.std(a - b) / np.std(a)), 4),
                                    'relrms(with-without sigma_min damping)': round(float(np.std(a - c) / np.std(a)), 4)}
# upslope-limit check: column forcing vs (sigma/(N K Hw)) * i h  (m Hw >> 1 limit)
K = np.hypot(kx, ky); K[0, 0] = 1
lim = np.real(np.fft.ifft2(hs * D * (1j * s / (N * K * 2500.))))[pad:-pad, pad:-pad]
out['col_vs_upslope_limit_corr'] = round(corr(a, lim), 3)
# combiner convergence vs iterations
kx2, ky2 = oc.kgrid(n, dx)
rng = np.random.default_rng(5)
Braw = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * np.exp(-(kx2**2 + ky2**2) * (40e3) ** 2 / 2)))
B = np.clip(0.5 + 0.3 * Braw / Braw.std(), 0, 1)
hs2 = oc.highpass(np.fft.fft2(oc.synth_terrain(n, dx, beta=3.0, rms=1500.0, seed=1)), kx2, ky2, 10e3)
m2, s2_ = oc.vertical_m(kx2, ky2, 10.0, 0.0, 0.01, f37)
eta = np.real(np.fft.ifft2(hs2 * oc.damp_lowsigma(s2_, 10.0, 0.0) * oc.vweight(m2, 'col')))
F = (5.55e-4 / 0.15) * eta
conv = {}
for it in (1, 2, 3, 5, 8):
    C, dC, res = oc.combine(B, F, iters=it)
    conv[str(it)] = {'max|G*dC|': round(float(np.abs(res).max()), 5), 'p99|G*dC|': round(float(np.quantile(np.abs(res), 0.99)), 5)}
conv['rms_eta_m'] = round(float(eta.std()), 1); conv['rms_F'] = round(float(F.std()), 3)
C, dC, res = oc.combine(B, F, iters=3)
conv['corr(dC, F)'] = round(corr(dC, F), 3)
conv['corr(dC, F - G*F)'] = round(corr(dC, F - oc.gsmooth(F, 20 / 6)), 3)
out['combiner_iters'] = conv
print(json.dumps(out, indent=1))
