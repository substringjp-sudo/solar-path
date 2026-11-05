"""Reference transfer functions for the RULER-oro method note (numpy only).
Conventions (fixed here, tested in oro_test.py):
  grid rows = north-increasing (macroField: row 0 = south), cols = east-increasing.
  wind (U, V) = (eastward, northward) m/s, blowing TOWARD.  sigma = U*kx + V*ky (= -intrinsic freq).
  inverse FFT uses e^{+i(kx x + ky y)} (numpy).  eta_hat(z) = h_hat * exp(i m z).
  m: propagating (f^2 < s^2 < N^2): m = sgn(s) * sqrt((N^2-s^2)/(s^2-f^2)) * K   (upward energy)
     evanescent  (s^2 >= N^2):       m = +i sqrt((s^2-N^2)/(s^2-f^2)) * K          (decays upward)
     rotational  (s^2 <= f^2):       m = +i sqrt((N^2-s^2)/(f^2-s^2)) * K          (decays upward)
"""
import numpy as np

def kgrid(n, dx_m):
    k1 = 2 * np.pi * np.fft.fftfreq(n, d=dx_m)
    kx = np.tile(k1[None, :], (n, 1))   # varies along columns (east)
    ky = np.tile(k1[:, None], (1, n))   # varies along rows (north)
    return kx, ky

def vertical_m(kx, ky, U, V, N, f=0.0):
    s = U * kx + V * ky
    K = np.hypot(kx, ky)
    s2, N2, f2 = s * s, N * N, f * f
    m = np.zeros(kx.shape, dtype=complex)
    prop = (s2 > f2) & (s2 < N2)
    m[prop] = np.sign(s[prop]) * np.sqrt((N2 - s2[prop]) / (s2[prop] - f2)) * K[prop]
    ev = s2 >= N2
    m[ev] = 1j * np.sqrt((s2[ev] - N2) / np.maximum(s2[ev] - f2, 1e-30)) * K[ev]
    rot = (s2 <= f2) & (K > 0)
    m[rot] = 1j * np.sqrt((N2 - s2[rot]) / np.maximum(f2 - s2[rot], 1e-30)) * K[rot]
    return m, s

def highpass(hhat, kx, ky, s_m):
    K2 = kx * kx + ky * ky
    return hhat * (1 - np.exp(-K2 * s_m * s_m / 2))

def damp_lowsigma(s, U, V, lam_m=200e3):
    smin = 2 * np.pi * np.hypot(U, V) / lam_m
    return s * s / (s * s + smin * smin)

def eta_level(hhat, m, z):
    """displacement at height z (m) above the reference surface."""
    return np.real(np.fft.ifft2(hhat * np.exp(1j * m * z)))

def vweight(m, kind, z_levels=(1500., 3000.), Hw=2500.):
    if kind == 'two':
        return sum(np.exp(1j * m * z) for z in z_levels) / len(z_levels)
    if kind == 'col':      # S&B moisture-weighted column: (1/Hw) int_0^inf e^{imz} e^{-z/Hw} dz
        return 1.0 / (1.0 - 1j * m * Hw)
    if isinstance(kind, (int, float)):
        return np.exp(1j * m * float(kind))
    raise ValueError(kind)

def conv_lag(s, tau_c):
    """S&B cloud-water lag in displacement units: i s tau/(1+ i s tau); tau=inf -> 1."""
    if tau_c is None or not np.isfinite(tau_c):
        return 1.0
    return 1j * s * tau_c / (1 + 1j * s * tau_c)

def sb_precip_transfer(hhat, s, m, Cw, Hw, tau_c, tau_f):
    """Smith & Barstad 2004 / fastscape form (before ifft, before clipping at 0): kg m^-2 s^-1."""
    return Cw * 1j * s * hhat / ((1 - 1j * m * Hw) * (1 + 1j * s * tau_c) * (1 + 1j * s * tau_f))

def synth_terrain(n, dx_m, beta=3.0, rms=300.0, seed=1):
    rng = np.random.default_rng(seed)
    kx, ky = kgrid(n, dx_m)
    K = np.hypot(kx, ky); K[0, 0] = np.inf
    amp = K ** (-beta / 2)
    ph = np.fft.fft2(rng.standard_normal((n, n)))
    h = np.real(np.fft.ifft2(ph * amp))
    h -= h.mean(); h *= rms / h.std()
    return h

def Phi(x):
    from math import erf, sqrt
    return 0.5 * (1 + np.vectorize(erf)(np.asarray(x) / sqrt(2)))

def Phinv(p):
    from statistics import NormalDist
    nd = NormalDist()
    return np.vectorize(nd.inv_cdf)(np.asarray(p))

def gsmooth(a, sigma_cells, mask=None):
    """separable Gaussian, non-periodic, normalized by the in-domain weight (edge-correct)."""
    r = int(np.ceil(3 * sigma_cells))
    x = np.arange(-r, r + 1); w = np.exp(-0.5 * (x / sigma_cells) ** 2); w /= w.sum()
    def conv(b):
        b = np.apply_along_axis(lambda v: np.convolve(v, w, mode='same'), 0, b)
        return np.apply_along_axis(lambda v: np.convolve(v, w, mode='same'), 1, b)
    one = np.ones_like(a) if mask is None else mask.astype(float)
    return conv(a * one) / np.maximum(conv(one), 1e-12)

def combine(B, F, sigma_cells=20/6, iters=3, qclip=2.5, dmax=1.5):
    """coverage-preserving combiner, difference form.  Returns C, dC, residual G*dC."""
    if not np.any(F):
        return B.copy(), np.zeros_like(B), np.zeros_like(B)
    q0 = Phinv(np.clip(B, Phi(-qclip), Phi(qclip)))
    base = Phi(q0)
    delta = np.zeros_like(B)
    for _ in range(iters):
        dC = Phi(q0 + F + delta) - base
        dens = np.exp(-0.5 * (q0 + F + delta) ** 2) / np.sqrt(2 * np.pi)
        delta = np.clip(delta - gsmooth(dC, sigma_cells) / np.maximum(gsmooth(dens, sigma_cells), 1e-6), -dmax, dmax)
    dC = Phi(q0 + F + delta) - base
    C = np.clip(B + dC, 0.0, 1.0)
    dC = C - B
    return C, dC, gsmooth(dC, sigma_cells)
