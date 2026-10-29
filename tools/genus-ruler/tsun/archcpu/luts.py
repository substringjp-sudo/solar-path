"""numpy port of the Bruneton (2017) runtime lookups as used by takram three-atmosphere 0.19.x
(src/shaders/bruneton/common.glsl + runtime.glsl), reading node_modules/@takram/three-atmosphere/assets/*.bin.

Table facts (verified from src/constants.ts, PrecomputedTexturesLoader.ts and the file sizes):
  transmittance.bin            256 (mu) x 64 (r)                     RGBA float16 little-endian, linear T (no log)
  irradiance.bin               64 (mu_s) x 16 (r)                    RGBA float16 (rgb = indirect sky irradiance only)
  scattering.bin               256 (= 8 nu x 32 mu_s) x 128 (mu) x 32 (r)  RGBA float16, rgb = Rayleigh+multiple,
                               alpha = single-Mie red  (COMBINED_SCATTERING_TEXTURES layout)
  single_mie_scattering.bin    same layout, rgb = single Mie (alpha = 1)
  higher_order_scattering.bin  same layout, rgb = orders >= 2 (only used with shadow_length > 0)
Length unit km (METER_TO_LENGTH_UNIT = 1/1000). Values are spectral radiance at 680/550/440 nm per unit
solar spectral irradiance scaled by solarIrradiance (Bruneton 3-wavelength mode); the renderer multiplies by
SKY_SPECTRAL_RADIANCE_TO_LUMINANCE (= skyRadianceToRelativeLuminance) to get linear-sRGB relative luminance.
Sampling: three.js LinearFilter + ClampToEdge (texel centres at (i+0.5)/N).
"""
import numpy as np

# §179 archcpu 복사본 — 사전 시험 luts.py(sha256 6c95cc015ce3…)에서 이 경로 줄만 저장소 기준 상대 경로로 바꿈(나머지 글자 그대로).
import os as _os
ASSETS = _os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..', '..', '..', 'node_modules/@takram/three-atmosphere/assets'))

# ---- AtmosphereParameters defaults (src/AtmosphereParameters.ts) ----
SOLAR_IRRADIANCE = np.array([1.474, 1.8504, 1.91198])
SUN_ANGULAR_RADIUS = 0.004675
BOTTOM = 6360.0
TOP = 6420.0
RAYLEIGH_SCATTERING = np.array([0.005802, 0.013558, 0.0331])     # /km at density 1
MIE_SCATTERING = np.array([0.003996] * 3)
MIE_EXTINCTION = np.array([0.00444] * 3)
MIE_G = 0.8
ABSORPTION_EXTINCTION = np.array([0.00065, 0.001881, 0.000085])
GROUND_ALBEDO = 0.1
MU_S_MIN = np.cos(np.radians(120.0))
SUN_RAD_TO_LUM = np.array([98242.786222, 69954.398112, 66475.012354])
SKY_RAD_TO_LUM = np.array([114974.916437, 71305.954816, 65310.548555])
LUMA = np.array([0.2126, 0.7152, 0.0722])
SUN_LUMINANCE = LUMA @ SUN_RAD_TO_LUM
SKY_RAD_TO_REL_LUM = SKY_RAD_TO_LUM / SUN_LUMINANCE       # what the takram renderer multiplies by
LAMBDAS = (680.0, 550.0, 440.0)

TW, TH = 256, 64
IW, IH = 64, 16
R_SIZE, MU_SIZE, MU_S_SIZE, NU_SIZE = 32, 128, 32, 8
H_ATM = np.sqrt(TOP * TOP - BOTTOM * BOTTOM)


def _load(name, shape):
    a = np.fromfile(f'{ASSETS}/{name}', dtype='<f2').astype(np.float64)
    return a.reshape(shape)


class Tables:
    """takram float16 assets (3-lambda radiance). K = per-channel radiance -> linear sRGB relative luminance."""
    def __init__(self):
        self.name = 'takram-3lambda-f16'
        self.K = SKY_RAD_TO_REL_LUM.copy()
        self.T = _load('transmittance.bin', (TH, TW, 4))[..., :3]
        self.I = _load('irradiance.bin', (IH, IW, 4))[..., :3]
        s = _load('scattering.bin', (R_SIZE, MU_SIZE, NU_SIZE * MU_S_SIZE, 4))
        self.S = s[..., :3]
        self.S_alpha = s[..., 3]
        self.M = _load('single_mie_scattering.bin', (R_SIZE, MU_SIZE, NU_SIZE * MU_S_SIZE, 4))[..., :3]
        self.H = _load('higher_order_scattering.bin', (R_SIZE, MU_SIZE, NU_SIZE * MU_S_SIZE, 4))[..., :3]


def _lin_idx(u, n):
    x = np.asarray(u, dtype=np.float64) * n - 0.5
    i0 = np.floor(x)
    f = x - i0
    i0 = i0.astype(np.int64)
    return np.clip(i0, 0, n - 1), np.clip(i0 + 1, 0, n - 1), f


def tex2d(tex, u, v):
    h, w = tex.shape[:2]
    x0, x1, fx = _lin_idx(u, w)
    y0, y1, fy = _lin_idx(v, h)
    fx = fx[..., None]; fy = fy[..., None]
    a = tex[y0, x0] * (1 - fx) + tex[y0, x1] * fx
    b = tex[y1, x0] * (1 - fx) + tex[y1, x1] * fx
    return a * (1 - fy) + b * fy


def tex3d(tex, u, v, w):
    d, h, wd = tex.shape[:3]
    x0, x1, fx = _lin_idx(u, wd)
    y0, y1, fy = _lin_idx(v, h)
    z0, z1, fz = _lin_idx(w, d)
    fx = fx[..., None] if tex.ndim == 4 else fx
    fy = fy[..., None] if tex.ndim == 4 else fy
    fz = fz[..., None] if tex.ndim == 4 else fz
    def plane(z):
        a = tex[z, y0, x0] * (1 - fx) + tex[z, y0, x1] * fx
        b = tex[z, y1, x0] * (1 - fx) + tex[z, y1, x1] * fx
        return a * (1 - fy) + b * fy
    return plane(z0) * (1 - fz) + plane(z1) * fz


# ---------------- common.glsl ----------------
def safe_sqrt(a):
    return np.sqrt(np.maximum(a, 0.0))


def dist_top(r, mu):
    return np.maximum(-r * mu + safe_sqrt(r * r * (mu * mu - 1.0) + TOP * TOP), 0.0)


def dist_bottom(r, mu):
    return np.maximum(-r * mu - safe_sqrt(r * r * (mu * mu - 1.0) + BOTTOM * BOTTOM), 0.0)


def ray_intersects_ground(r, mu):
    return (mu < 0.0) & (r * r * (mu * mu - 1.0) + BOTTOM * BOTTOM >= 0.0)


def unit_to_coord(x, n):
    return 0.5 / n + x * (1.0 - 1.0 / n)


def transmittance_uv(r, mu):
    rho = safe_sqrt(r * r - BOTTOM * BOTTOM)
    d = dist_top(r, mu)
    d_min = TOP - r
    d_max = rho + H_ATM
    x_mu = (d - d_min) / (d_max - d_min)
    x_r = rho / H_ATM
    return unit_to_coord(x_mu, TW), unit_to_coord(x_r, TH)


def transmittance_to_top(tb, r, mu):
    u, v = transmittance_uv(r, mu)
    return tex2d(tb.T, u, v)


def clamp_r(r):
    return np.clip(r, BOTTOM, TOP)


def transmittance(tb, r, mu, d, hits_ground):
    r_d = clamp_r(np.sqrt(d * d + 2.0 * r * mu * d + r * r))
    mu_d = np.clip((r * mu + d) / r_d, -1, 1)
    hg = np.asarray(hits_ground)[..., None]
    a = transmittance_to_top(tb, r_d, -mu_d) / np.maximum(transmittance_to_top(tb, r, -mu), 1e-30)
    b = transmittance_to_top(tb, r, mu) / np.maximum(transmittance_to_top(tb, r_d, mu_d), 1e-30)
    return np.minimum(np.where(hg, a, b), 1.0)


def transmittance_to_sun(tb, r, mu_s):
    sin_h = BOTTOM / r
    cos_h = -np.sqrt(np.maximum(1 - sin_h * sin_h, 0))
    lo = -sin_h * SUN_ANGULAR_RADIUS; hi = sin_h * SUN_ANGULAR_RADIUS
    t = np.clip((mu_s - cos_h - lo) / (hi - lo), 0, 1)
    return transmittance_to_top(tb, r, mu_s) * (t * t * (3 - 2 * t))[..., None]


def rayleigh_phase(nu):
    return 3.0 / (16.0 * np.pi) * (1.0 + nu * nu)


def mie_phase(g, nu):
    k = 3.0 / (8.0 * np.pi) * (1.0 - g * g) / (2.0 + g * g)
    return k * (1.0 + nu * nu) / np.power(1.0 + g * g - 2.0 * g * nu, 1.5)


def scattering_uvwz(r, mu, mu_s, nu, hits_ground):
    rho = safe_sqrt(r * r - BOTTOM * BOTTOM)
    u_r = unit_to_coord(rho / H_ATM, R_SIZE)
    r_mu = r * mu
    disc = r_mu * r_mu - r * r + BOTTOM * BOTTOM
    # ground branch
    d_g = -r_mu - safe_sqrt(disc)
    dmin_g = r - BOTTOM
    dmax_g = rho
    xg = np.where(dmax_g == dmin_g, 0.0, (d_g - dmin_g) / np.where(dmax_g == dmin_g, 1.0, dmax_g - dmin_g))
    u_mu_g = 0.5 - 0.5 * unit_to_coord(xg, MU_SIZE // 2)
    # sky branch
    d_s = -r_mu + safe_sqrt(disc + H_ATM * H_ATM)
    dmin_s = TOP - r
    dmax_s = rho + H_ATM
    u_mu_s_ = 0.5 + 0.5 * unit_to_coord((d_s - dmin_s) / (dmax_s - dmin_s), MU_SIZE // 2)
    u_mu = np.where(hits_ground, u_mu_g, u_mu_s_)
    d = dist_top(BOTTOM, mu_s)
    d_min = TOP - BOTTOM
    d_max = H_ATM
    a = (d - d_min) / (d_max - d_min)
    D = dist_top(BOTTOM, MU_S_MIN)
    A = (D - d_min) / (d_max - d_min)
    u_mus = unit_to_coord(np.maximum(1.0 - a / A, 0.0) / (1.0 + a), MU_S_SIZE)
    u_nu = (nu + 1.0) / 2.0
    return u_nu, u_mus, u_mu, u_r


def _lookup4d(tex, r, mu, mu_s, nu, hits_ground):
    u_nu, u_mus, u_mu, u_r = scattering_uvwz(r, mu, mu_s, nu, hits_ground)
    tcx = u_nu * (NU_SIZE - 1)
    tx = np.floor(tcx)
    lerp = tcx - tx
    s0 = tex3d(tex, (tx + u_mus) / NU_SIZE, u_mu, u_r)
    s1 = tex3d(tex, (tx + 1.0 + u_mus) / NU_SIZE, u_mu, u_r)
    if s0.ndim > np.ndim(lerp):
        lerp = lerp[..., None]
    return s0 * (1 - lerp) + s1 * lerp


def combined_scattering(tb, r, mu, mu_s, nu, hits_ground, mie_mode='separate'):
    """returns (scattering rgb, single_mie rgb). mie_mode 'separate' reads single_mie_scattering.bin,
    'combined' extrapolates from the alpha channel exactly as GetExtrapolatedSingleMieScattering."""
    sc = _lookup4d(tb.S, r, mu, mu_s, nu, hits_ground)
    if mie_mode == 'separate':
        mie = _lookup4d(tb.M, r, mu, mu_s, nu, hits_ground)
    else:
        a = _lookup4d(tb.S_alpha, r, mu, mu_s, nu, hits_ground)
        mie = extrapolated_mie(sc, a)
    return sc, mie


def extrapolated_mie(sc, a):
    fac = (RAYLEIGH_SCATTERING[0] / MIE_SCATTERING[0]) * (MIE_SCATTERING / RAYLEIGH_SCATTERING)
    out = sc * (a / np.maximum(sc[..., 0], 1e-30))[..., None] * fac
    return np.where((sc[..., 0] < 1e-5)[..., None], 0.0, out)


def sky_radiance(tb, cam, view, sun, ground=True, mie_mode='separate'):
    """GetSkyRadiance with shadow_length = 0. cam (...,3) km from planet centre, view/sun unit vectors.
    ground=True is takram's GROUND define (lower half of the texture for ground-hitting rays).
    Returns (radiance rgb, transmittance rgb)."""
    cam = np.asarray(cam, float); view = np.asarray(view, float); sun = np.asarray(sun, float)
    r = np.linalg.norm(cam, axis=-1)
    rmu = np.sum(cam * view, axis=-1)
    d_top = -rmu - safe_sqrt(rmu * rmu - r * r + TOP * TOP)
    inside = ~(d_top > 0)
    cam = np.where((d_top > 0)[..., None], cam + view * d_top[..., None], cam)
    r = np.where(d_top > 0, TOP, r)
    rmu = np.where(d_top > 0, rmu + d_top, rmu)
    mu = rmu / r
    mu_s = np.sum(cam * sun, axis=-1) / r
    nu = np.sum(view * sun, axis=-1)
    hg = ray_intersects_ground(r, mu) if ground else np.zeros_like(mu, bool)
    T = np.where(hg[..., None], 0.0, transmittance_to_top(tb, r, mu))
    sc, mie = combined_scattering(tb, r, mu, mu_s, nu, hg, mie_mode)
    L = sc * rayleigh_phase(nu)[..., None] + mie * mie_phase(MIE_G, nu)[..., None]
    return L, T


def sky_radiance_to_point(tb, cam, point, sun, mie_mode='separate', mie_hack=True):
    """GetSkyRadianceToPoint (shadow_length = 0), incl. takram's horizon eps hack and the
    single-Mie smoothstep(0, 0.01, mu_s) hack. Returns (in-scatter rgb, transmittance rgb)."""
    cam = np.asarray(cam, float); point = np.asarray(point, float); sun = np.asarray(sun, float)
    view = point - cam
    view = view / np.linalg.norm(view, axis=-1, keepdims=True)
    r = np.linalg.norm(cam, axis=-1)
    rmu = np.sum(cam * view, axis=-1)
    mu = rmu / r
    mu_s = np.sum(cam * sun, axis=-1) / r
    nu = np.sum(view * sun, axis=-1)
    d = np.linalg.norm(point - cam, axis=-1)
    hg = ray_intersects_ground(r, mu)
    mu_h = -safe_sqrt(1.0 - BOTTOM * BOTTOM / (r * r))
    mu = np.where(~hg, np.maximum(mu, mu_h + 0.004), mu)
    T = transmittance(tb, r, mu, d, hg)
    sc, mie = combined_scattering(tb, r, mu, mu_s, nu, hg, mie_mode)
    r_p = clamp_r(np.sqrt(d * d + 2.0 * r * mu * d + r * r))
    mu_p = (r * mu + d) / r_p
    mu_s_p = (r * mu_s + d * nu) / r_p
    sc_p, mie_p = combined_scattering(tb, r_p, mu_p, mu_s_p, nu, hg, mie_mode)
    sc_out = sc - T * sc_p
    mie_out = mie - T * mie_p
    if mie_mode == 'combined':
        mie_out = extrapolated_mie(sc_out, mie_out[..., 0])
    if mie_hack:
        t = np.clip(mu_s / 0.01, 0, 1)
        mie_out = mie_out * (t * t * (3 - 2 * t))[..., None]
    L = sc_out * rayleigh_phase(nu)[..., None] + mie_out * mie_phase(MIE_G, nu)[..., None]
    return L, T


def irradiance(tb, r, mu_s):
    """GetIrradiance: indirect (sky) irradiance on a horizontal surface."""
    x_r = (r - BOTTOM) / (TOP - BOTTOM)
    x_mu_s = mu_s * 0.5 + 0.5
    return tex2d(tb.I, unit_to_coord(x_mu_s, IW), unit_to_coord(x_r, IH))


def to_srgb(rad):
    """radiance -> linear sRGB relative luminance as the takram renderer does (constant per channel)."""
    return np.asarray(rad) * SKY_RAD_TO_REL_LUM


def rb(rgb_lin):
    rgb_lin = np.asarray(rgb_lin)
    return rgb_lin[..., 0] / rgb_lin[..., 2]


def luma(rgb_lin):
    return np.asarray(rgb_lin) @ LUMA


class CpuTables:
    """Tables from code/precompute.c (float32). kind='3l' (one batch, radiance) or an assembled spectral set."""
    def __init__(self, T, I, S, M, H, K, name):
        self.T, self.I, self.S, self.M, self.H, self.K, self.name = T, I, S, M, H, np.asarray(K, float), name
        self.S_alpha = M[..., 0]


def load_cpu_batch(d):
    f = lambda n, sh: np.fromfile(f'{d}/{n}', dtype='<f4').astype(np.float64).reshape(sh)
    return dict(T=f('transmittance.f32', (TH, TW, 3)), I=f('irradiance.f32', (IH, IW, 3)),
                S=f('scattering.f32', (R_SIZE, MU_SIZE, NU_SIZE * MU_S_SIZE, 3)),
                M=f('mie.f32', (R_SIZE, MU_SIZE, NU_SIZE * MU_S_SIZE, 3)),
                H=f('higher.f32', (R_SIZE, MU_SIZE, NU_SIZE * MU_S_SIZE, 3)))


def srgb(tb, rad):
    return np.asarray(rad) * tb.K


def SOLAR_IRRADIANCE_OF(tb):
    return getattr(tb, 'solar', SOLAR_IRRADIANCE)
