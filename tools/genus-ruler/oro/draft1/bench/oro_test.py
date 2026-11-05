import sys, json, importlib.util
import numpy as np
sys.path.insert(0, sys.argv[1])  # bench dir (our own code)
import oro_core as oc
out = {}

# ---- T1 Witch of Agnesi sign/branch (2-D ridge, U eastward) ----
n, dx = 512, 2000.0
x = (np.arange(n) - n // 2) * dx
a, h0, U, N = 10e3, 100.0, 10.0, 0.01
h = np.tile((h0 * a * a / (x * x + a * a))[None, :], (n, 1))
kx, ky = oc.kgrid(n, dx)
m, s = oc.vertical_m(kx, ky, U, 0.0, N, 0.0)
hh = np.fft.fft2(h)
res = {}
for frac in (0.25, 0.5):
    lz = 2 * np.pi * U / N; z = frac * lz
    num = oc.eta_level(hh, m, z)[n // 2]
    l = N / U
    ana = h0 * a * (a * np.cos(l * z) - x * np.sin(l * z)) / (x * x + a * a)
    sl = slice(n // 2 - 50, n // 2 + 51)
    res[f'z={z:.0f}m'] = {'maxabs_err_m': float(np.abs(num - ana)[sl].max()),
                          'x_of_max_eta_km': float(x[sl][np.argmax(num[sl])] / 1e3)}
out['T1_witch'] = res

# ---- T2 two-level cancellation, 2-D long ridge: |cos(l*dz/2)|, phase l*zbar ----
t2 = {}
for N_ in (0.006, 0.010, 0.012):
    row = {}
    for U_ in (4, 5, 6, 7, 8, 10, 12, 15, 20):
        l = N_ / U_
        row[str(U_)] = {'amp2': round(abs(np.cos(l * 750.0)), 3), 'phase_deg': round(np.degrees(l * 2250.0) % 360, 0),
                        'amp_col_Hw2.5': round(1 / np.sqrt(1 + (l * 2500) ** 2), 3),
                        'phase_col_deg': round(np.degrees(np.arctan(l * 2500)), 0)}
    t2[f'N={N_}'] = row
out['T2_ridge2d'] = t2

# ---- T3 3-D synthetic terrain (128^2 x 6 km), h_sub s=10 km ----
n, dx = 128, 6000.0
kx, ky = oc.kgrid(n, dx)
def blk(a):  # 12 km block means
    return a.reshape(n // 2, 2, n // 2, 2).mean(axis=(1, 3))
def corr(a, b):
    a = a.ravel() - a.mean(); b = b.ravel() - b.mean()
    return float((a @ b) / np.sqrt((a @ a) * (b @ b)))
t3 = {}
for seed in (1, 2, 3):
    h = oc.synth_terrain(n, dx, beta=3.0, rms=600.0, seed=seed)
    hs = oc.highpass(np.fft.fft2(h), kx, ky, 10e3)
    hsub = np.real(np.fft.ifft2(hs))
    for N_ in (0.006, 0.010, 0.012):
        for U_ in (5, 7, 10, 15):
            for wd in ('W', 'NW'):
                Uv = (U_, 0.0) if wd == 'W' else (U_ / np.sqrt(2), -U_ / np.sqrt(2))
                m, s = oc.vertical_m(kx, ky, Uv[0], Uv[1], N_, 2 * 7.2921e-5 * np.sin(np.radians(37)))
                D = oc.damp_lowsigma(s, *Uv)
                e0 = np.real(np.fft.ifft2(hs * D))
                e15 = np.real(np.fft.ifft2(hs * D * oc.vweight(m, 1500.)))
                e30 = np.real(np.fft.ifft2(hs * D * oc.vweight(m, 3000.)))
                e2 = 0.5 * (e15 + e30)
                ec = np.real(np.fft.ifft2(hs * D * oc.vweight(m, 'col', Hw=2500.)))
                eq = np.real(np.fft.ifft2(hs * D * oc.vweight(m, 'col', Hw=2500.) * oc.conv_lag(s, 1000.)))
                key = f'N{N_}_U{U_}_{wd}'
                r = t3.setdefault(key, [])
                r.append({'rms2/rms0': np.std(e2) / np.std(e0), 'rms15/rms0': np.std(e15) / np.std(e0), 'rmscol/rms0': np.std(ec) / np.std(e0),
                          'c(15,30)': corr(blk(e15), blk(e30)), 'c(two,col)': corr(blk(e2), blk(ec)), 'c(two,h)': corr(blk(e2), blk(hsub)),
                          'c(col,h)': corr(blk(ec), blk(hsub)), 'c(15,h)': corr(blk(e15), blk(hsub)), 'c(colq,col)': corr(blk(eq), blk(ec)),
                          'rms0_m': float(np.std(e0)), 'NhU': float(N_ * np.std(hsub) / U_)})
out['T3_3d'] = {k: {kk: round(float(np.mean([d[kk] for d in v])), 3) for kk in v[0]} for k, v in t3.items()}

# ---- T4 fastscape equivalence (propagating and evanescent cases), north-up raster for fastscape ----
spec = importlib.util.spec_from_file_location('fsop', sys.argv[2]); fsop = importlib.util.module_from_spec(spec); spec.loader.exec_module(fsop)
t4 = {}
h = oc.synth_terrain(128, 2000.0, beta=3.0, rms=400.0, seed=7); h -= h.min()
for name, (U_, Nm, wdir) in {'prop_W': (10.0, 0.01, 270.0), 'prop_S': (10.0, 0.01, 180.0), 'evan_W': (25.0, 0.003, 270.0)}.items():
    par = dict(latitude=37.0, precip_base=0.0, precip_min=-1e9, wind_speed=U_, wind_dir=wdir, conv_time=1000., fall_time=1000., nm=Nm, hw=2500., cw=0.004)
    hn = h[::-1]                      # our grid: row 0 = south ; fastscape: row 0 = north
    Pfs = fsop.compute_orographic_precip(hn, 2000.0, 2000.0, **par)[::-1] / 3600.0
    pad = min(int(np.ceil(sum(h.shape) / 2)), 200)
    hp = np.pad(h, pad); nn = hp.shape[0]
    kx, ky = oc.kgrid(nn, 2000.0)
    th = np.radians(wdir); Uv = (-np.sin(th) * U_, -np.cos(th) * U_)   # met 'from' -> toward, north-positive
    m, s = oc.vertical_m(kx, ky, Uv[0], Uv[1], Nm, 2 * 7.2921e-5 * np.sin(np.radians(37.0)))
    P = np.real(np.fft.ifft2(oc.sb_precip_transfer(np.fft.fft2(hp), s, m, 0.004, 2500., 1000., 1000.)))[pad:-pad, pad:-pad]
    t4[name] = {'rel_rms_diff': round(float(np.std(P - Pfs) / np.std(Pfs)), 4), 'corr': round(corr(P, Pfs), 5),
                'frac_evanescent_modes': round(float(np.mean((s * s) >= Nm * Nm)), 3)}
    # wrong-convention check: flip V sign
    m2, s2 = oc.vertical_m(kx, ky, Uv[0], -Uv[1], Nm, 2 * 7.2921e-5 * np.sin(np.radians(37.0)))
    P2 = np.real(np.fft.ifft2(oc.sb_precip_transfer(np.fft.fft2(hp), s2, m2, 0.004, 2500., 1000., 1000.)))[pad:-pad, pad:-pad]
    t4[name]['corr_if_V_flipped'] = round(corr(P2, Pfs), 3)
out['T4_fastscape'] = t4

# ---- T5 combiner: exact zero, conservation, edges ----
n = 128
kx, ky = oc.kgrid(n, 6000.0)
rng = np.random.default_rng(5)
Braw = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * np.exp(-(kx**2 + ky**2) * (40e3) ** 2 / 2)))
B = np.clip(0.5 + 0.6 * Braw / Braw.std() * 0.5, 0, 1).astype(np.float32).astype(np.float64)
h = oc.synth_terrain(n, 6000.0, beta=3.0, rms=600.0, seed=1)
hs = oc.highpass(np.fft.fft2(h), kx, ky, 10e3)
m, s = oc.vertical_m(kx, ky, 10.0, 0.0, 0.01, 8.8e-5)
eta = np.real(np.fft.ifft2(hs * oc.damp_lowsigma(s, 10.0, 0.0) * oc.vweight(m, 'col')))
t5 = {}
C0, d0, _ = oc.combine(B, np.zeros_like(B))
t5['zero_forcing_identical'] = bool(np.array_equal(C0, B))
for srel in (0.10, 0.15, 0.20):
    kappa = 5.55e-4 / srel
    C, dC, res = oc.combine(B, kappa * eta)
    b = lambda a: a.reshape(64, 2, 64, 2).mean(axis=(1, 3))
    t5[f's_rel={srel}'] = {'kappa_per_100m': round(kappa * 100, 3), 'rms_F': round(float(np.std(kappa * eta)), 3),
                           'max|G*dC|': round(float(np.abs(res).max()), 4), 'mean|dC|': round(float(np.abs(dC).mean()), 4),
                           'frac12km|dC|>=0.02': round(float(np.mean(np.abs(b(dC)) >= 0.02)), 3),
                           'boxmean_dC': round(float(dC.mean()), 5), 'frac_B_edge(<.01|>.99)': round(float(np.mean((B < .01) | (B > .99))), 3)}
out['T5_combiner'] = t5
print(json.dumps(out, indent=1))
