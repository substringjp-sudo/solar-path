"""Per-scene null spread of rho_res and the G-rev pairing, MODIS-free.
Terrain: synthetic (oro_core.synth_terrain) and the probed Seoul Terrarium tile (terrain only).
R = T - B is replaced by independent surrogate fields (null) -> SD(rho) and n_eff.
Usage: python3 -I sim1.py <bench_dir> <dem_png> <out_json>
"""
import sys, json, math
import numpy as np
sys.path.insert(0, sys.argv[1])
import oro_core as oc
from PIL import Image

DX = 6000.0
rng = np.random.default_rng(20261104)

def tukey(n, edge=16):
    w = np.ones(n)
    for i in range(edge):
        w[i] = w[n - 1 - i] = 0.5 * (1 - math.cos(math.pi * i / edge))
    return np.outer(w, w)

def forcing(h, U, V, N=0.01, Hw=2230.0, kappa=5.53e-4 / 0.15, s=10e3):
    n = h.shape[0]
    h = np.maximum(h, 0.0); h = h - h.mean(); h = h * tukey(n, 16 if n >= 128 else 8)
    kx, ky = oc.kgrid(n, DX)
    hh = oc.highpass(np.fft.fft2(h), kx, ky, s)
    hs = np.real(np.fft.ifft2(hh))
    lim = math.hypot(U, V) / N
    he = np.clip(hs, -lim, lim)
    m, sig = oc.vertical_m(kx, ky, U, V, N, f=2 * 7.2921e-5 * math.sin(math.radians(37.5)))
    D = oc.damp_lowsigma(sig, U, V)
    eh = np.fft.fft2(he) * D * oc.vweight(m, 'col', Hw=Hw); eh[0, 0] = 0
    return kappa * np.real(np.fft.ifft2(eh)), hs

def smooth_field(n, L_km, seed):
    r = np.random.default_rng(seed)
    kx, ky = oc.kgrid(n, DX); K2 = kx * kx + ky * ky
    L = L_km * 1e3
    a = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((n, n))) * np.exp(-K2 * L * L / 4)))
    return (a - a.mean()) / a.std()

def blocks(a, n, half_cells=15):
    c = n // 2
    w = a[c - half_cells:c + half_cells, c - half_cells:c + half_cells]
    return w.reshape(half_cells, 2, half_cells, 2).mean(axis=(1, 3)).ravel()

def corr(x, y):
    x = x - x.mean(); y = y - y.mean(); d = math.sqrt((x * x).sum() * (y * y).sum())
    return float((x * y).sum() / d) if d > 0 else 0.0

def scene(h, U, V, Bseed, n):
    F, hs = forcing(h, U, V)
    Fr, _ = forcing(h, -U, -V)
    B = 1 / (1 + np.exp(-1.2 * smooth_field(n, 100, Bseed)))   # Barnes-like, 0..1
    _, dC, _ = oc.combine(B, F, iters=10)
    _, dCr, _ = oc.combine(B, Fr, iters=10)
    hsub_rms = float(np.sqrt((hs[n//2-15:n//2+15, n//2-15:n//2+15] ** 2).mean()))
    return blocks(dC, n), blocks(dCr, n), B, hsub_rms, blocks(F, n), blocks(Fr, n), blocks(hs, n)

def surrogate_R(n, kind, seed):
    if kind.startswith('gauss'):
        return smooth_field(n, float(kind[5:]), seed)
    r = np.random.default_rng(seed)
    kx, ky = oc.kgrid(n, DX); K = np.hypot(kx, ky); K[0, 0] = np.inf
    beta = float(kind[3:])
    a = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((n, n))) * K ** (-beta / 2)))
    return (a - a.mean()) / a.std()

def load_dem(png):
    a = np.asarray(Image.open(png).convert('RGB')).astype(float)
    e = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    # tile ~1.9 km/px; average 3x3 px -> ~5.8 km cells, crop 64x64 around the east-centre (Taebaek side)
    n3 = (e.shape[0] // 3) * 3
    e = e[:n3, :n3].reshape(n3 // 3, 3, n3 // 3, 3).mean(axis=(1, 3))[::-1]  # row 0 = south
    c0 = e.shape[0] // 2
    return e[c0 - 32:c0 + 32, c0 - 32 + 6:c0 + 32 + 6]

