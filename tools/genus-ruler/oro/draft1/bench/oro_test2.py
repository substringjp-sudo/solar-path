import sys, json, importlib.util
import numpy as np
sys.path.insert(0, sys.argv[1]); import oro_core as oc
spec = importlib.util.spec_from_file_location('fsop', sys.argv[2]); fsop = importlib.util.module_from_spec(spec); spec.loader.exec_module(fsop)
def corr(a, b):
    a = a.ravel() - a.mean(); b = b.ravel() - b.mean(); return float((a @ b) / np.sqrt((a @ a) * (b @ b)))
out = {}
f37 = 2 * 7.2921e-5 * np.sin(np.radians(37.0))
h = oc.synth_terrain(128, 2000.0, beta=3.0, rms=400.0, seed=7); h -= h.min()
BASE = 1e4
for name, (U_, Nm, wdir, dx) in {'W_dx6km': (10.0, 0.01, 270.0, 6000.0), 'S_dx6km': (10.0, 0.01, 180.0, 6000.0), 'SW_dx6km': (10.0, 0.01, 225.0, 6000.0),
                                 'W_dx2km_evan': (10.0, 0.01, 270.0, 2000.0), 'W_strong_evan': (25.0, 0.003, 270.0, 6000.0)}.items():
    par = dict(latitude=37.0, precip_base=BASE, precip_min=0.0, wind_speed=U_, wind_dir=wdir, conv_time=1000., fall_time=1000., nm=Nm, hw=2500., cw=0.004)
    Pfs = (fsop.compute_orographic_precip(h[::-1], dx, dx, **par)[::-1] - BASE) / 3600.0
    pad = min(int(np.ceil(sum(h.shape) / 2)), 200); hp = np.pad(h, pad); nn = hp.shape[0]
    kx, ky = oc.kgrid(nn, dx)
    th = np.radians(wdir); Uv = (-np.sin(th) * U_, -np.cos(th) * U_)
    m, s = oc.vertical_m(kx, ky, Uv[0], Uv[1], Nm, f37)
    P = np.real(np.fft.ifft2(oc.sb_precip_transfer(np.fft.fft2(hp), s, m, 0.004, 2500., 1000., 1000.)))[pad:-pad, pad:-pad]
    # fastscape-style m (evanescent -> 0, rotational -> abs) to isolate the branch difference
    s2 = s * s; num = np.maximum(Nm**2 - s2, 0); den = s2 - f37**2
    den = np.where((den < np.finfo(float).eps) & (den >= 0), np.finfo(float).eps, den); den = np.where((den > -np.finfo(float).eps) & (den < 0), -np.finfo(float).eps, den)
    mfs = np.where(s >= 0, 1, -1) * np.sqrt(np.abs(num / den * (kx**2 + ky**2)))
    Pb = np.real(np.fft.ifft2(oc.sb_precip_transfer(np.fft.fft2(hp), s, mfs, 0.004, 2500., 1000., 1000.)))[pad:-pad, pad:-pad]
    mV, sV = oc.vertical_m(kx, ky, Uv[0], -Uv[1], Nm, f37)
    PV = np.real(np.fft.ifft2(oc.sb_precip_transfer(np.fft.fft2(hp), sV, mV, 0.004, 2500., 1000., 1000.)))[pad:-pad, pad:-pad]
    out[name] = {'frac_evan': round(float(np.mean(s2 >= Nm**2)), 3),
                 'ours_vs_fs_corr': round(corr(P, Pfs), 5), 'ours_vs_fs_relrms': round(float(np.std(P - Pfs) / np.std(Pfs)), 4),
                 'fsbranch_vs_fs_relrms': round(float(np.std(Pb - Pfs) / np.std(Pfs)), 6),
                 'V_flipped_vs_fs_corr': round(corr(PV, Pfs), 3)}
# robustness of the forcing pattern to forecast U/N errors (6 km grid, s=10 km, synthetic beta=3)
n, dx = 128, 6000.0; kx, ky = oc.kgrid(n, dx)
rob = {}
for seed in (1, 2, 3):
    hs = oc.highpass(np.fft.fft2(oc.synth_terrain(n, dx, beta=3.0, rms=600.0, seed=seed)), kx, ky, 10e3)
    def F(kind, U, N, Hw=2500.):
        m, s = oc.vertical_m(kx, ky, U, 0.0, N, f37); D = oc.damp_lowsigma(s, U, 0.0)
        if kind == 'two': return np.real(np.fft.ifft2(hs * D * oc.vweight(m, 'two')))
        return np.real(np.fft.ifft2(hs * D * oc.vweight(m, 'col', Hw=Hw)))
    for U in (7.0, 10.0):
        for kind in ('two', 'col'):
            ref = F(kind, U, 0.01)
            r = rob.setdefault(f'{kind}_U{U:g}', [])
            r.append({'U*1.25': corr(ref, F(kind, U * 1.25, 0.01)), 'U*0.8': corr(ref, F(kind, U * 0.8, 0.01)),
                      'N*1.2': corr(ref, F(kind, U, 0.012)), 'N*0.6(moist)': corr(ref, F(kind, U, 0.006)),
                      'Hw2.0': corr(ref, F(kind, U, 0.01, 2000.)) if kind == 'col' else float('nan'),
                      'dir+20deg': corr(ref, (lambda m_s: np.real(np.fft.ifft2(hs * oc.damp_lowsigma(m_s[1], U*np.cos(0.349), U*np.sin(0.349)) * oc.vweight(m_s[0], 'two' if kind=='two' else 'col'))))(oc.vertical_m(kx, ky, U*np.cos(0.349), U*np.sin(0.349), 0.01, f37)))})
out['robust_corr_to_ref'] = {k: {kk: round(float(np.mean([d[kk] for d in v])), 3) for kk in v[0]} for k, v in rob.items()}
print(json.dumps(out, indent=1))
