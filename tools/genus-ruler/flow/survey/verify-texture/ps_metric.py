# Portilla-Simoncelli cross-scale magnitude correlation as a ruler metric: does it separate a structured field
# (deformed sharp cells + trough) from its phase-randomized twin (same power spectrum, Gaussian)? Also per-band skew.
import numpy as np
rng = np.random.default_rng(3)
n = 256
pts = rng.random((60, 2))
yy, xx = np.mgrid[0:n, 0:n]; x = (xx + 0.5) / n; y = (yy + 0.5) / n
d = []
for p in pts:
    dx = x - p[0]; dx -= np.round(dx); dy = y - p[1]; dy -= np.round(dy); d.append(np.hypot(dx, dy))
d = np.sort(np.array(d), axis=0)
f = (d[1] - d[0]) * 8 + 0.8 * np.cos(2 * np.pi * (x + 0.3 * y))
# Gaussianize by rank (what the pipeline's rank map does to the marginal)
r = np.argsort(f.ravel()); g = np.empty(n * n); g[r] = np.arange(n * n)
from math import sqrt
def erfinv(p):
    a = 0.147; ln = np.log(1 - p * p); t = 2 / (np.pi * a) + ln / 2
    return np.sign(p) * np.sqrt(np.sqrt(t * t - ln / a) - t)
g = sqrt(2) * erfinv(2 * (g + 0.5) / (n * n) - 1); g = g.reshape(n, n)
# phase-randomized twin
F = np.fft.fft2(g); ph = np.exp(1j * 2 * np.pi * rng.random((n, n)))
# enforce Hermitian symmetry by taking real part of inverse (halves power but keeps shape) then standardize
tw = np.real(np.fft.ifft2(np.abs(F) * ph)); tw = (tw - tw.mean()) / tw.std()
def box(a, rr):
    k = 2 * rr + 1; c = np.cumsum(np.cumsum(np.pad(a, rr, mode='wrap'), 0), 1); c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
def bands(a):
    G = [a, box(a, 1), box(a, 3), box(a, 7), box(a, 15)]
    return [G[i] - G[i + 1] for i in range(4)]
def ps(a):
    B = bands(a)
    C = [np.corrcoef(np.abs(B[s]).ravel(), np.abs(B[s + 1]).ravel())[0, 1] for s in range(3)]
    sk = [float(((b - b.mean()) ** 3).mean() / b.std() ** 3) for b in B]
    ku = [float(((b - b.mean()) ** 4).mean() / b.std() ** 4 - 3) for b in B]
    return np.round(C, 3), np.round(sk, 2), np.round(ku, 2)
for name, a in [('structured (deformed cells, rank-Gaussianized)', g), ('phase-randomized twin (same spectrum)', tw)]:
    C, sk, ku = ps(a); print(name, '\n  cross-scale |B| corr C_s,s+1 =', C, '\n  band skew =', sk, ' band kurt =', ku)
# cost at 512^2 numpy
import time; a = rng.standard_normal((512, 512)); t = time.time(); ps(a); print('cost 512^2 numpy: %.1f ms' % ((time.time() - t) * 1e3))
