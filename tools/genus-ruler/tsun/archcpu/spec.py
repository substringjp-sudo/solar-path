"""Spectral inputs exactly as the app uses them (src/components/VolumetricProbe/spectralTables.ts + spectralAtmosphere.ts)."""
import re, numpy as np
# §179 archcpu 복사본 — 사전 시험 spec.py(sha256 b8ee5b798bf0…)에서 이 경로 줄만 저장소 기준 상대 경로로 바꿈(나머지 글자 그대로).
import os as _os
SRC = open(_os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..', '..', '..', 'src/components/VolumetricProbe/spectralTables.ts'))).read()
def arr(name):
    m = re.search(r'export const ' + name + r'\s*=\s*\[(.*?)\];', SRC, re.S)
    body = re.sub(r'//.*', '', m.group(1))
    return np.array([float(x) for x in re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', body)])
SOLAR = arr('SOLAR_IRRADIANCE'); OZONE = arr('OZONE_CROSS_SECTION'); CIE = arr('CIE_2DEG').reshape(-1, 4); XYZ2SRGB = arr('XYZ_TO_SRGB').reshape(3, 3)
LMIN, LMAX = 360.0, 830.0
assert len(SOLAR) == 48 and len(OZONE) == 48, (len(SOLAR), len(OZONE))
def table10(t, lam):
    x = (np.asarray(lam, float) - LMIN) / 10
    x = np.clip(x, 0, len(t) - 1); i = np.minimum(np.floor(x).astype(int), len(t) - 2); u = x - i
    return t[i] * (1 - u) + t[i + 1] * u
def cmf(lam):
    lam = np.asarray(lam, float)
    x = (lam - LMIN) / 5; row = np.clip(np.floor(x).astype(int), 0, len(CIE) - 2); u = x - row
    out = CIE[row, 1:] * (1 - u)[..., None] + CIE[row + 1, 1:] * u[..., None]
    return np.where(((lam <= LMIN) | (lam >= LMAX))[..., None], 0.0, out)
MAX_OZONE_ND = 300 * 2.687e20 / 15000
def params(lams):
    lams = np.asarray(lams, float)
    return dict(lams=lams, solar=table10(SOLAR, lams), rayleigh=1.24062e-6 * (lams * 1e-3) ** -4 * 1000,
                ozone=MAX_OZONE_ND * table10(OZONE, lams) * 1000,
                mie_sca=np.full(len(lams), 0.003996), mie_ext=np.full(len(lams), 0.00444))
def app_lambdas(n=15):
    dl = (LMAX - LMIN) / n
    return LMIN + (np.arange(n) + 0.5) * dl, dl
def srgb_coeff(lams, dl):
    """(n_lambda, 3): radiance at lambda -> linear sRGB (x dl, 683 omitted) — Model::Init coeff / srgbCoeff."""
    return (cmf(lams) @ XYZ2SRGB.T) * dl
if __name__ == '__main__':
    p3 = params([680, 550, 440]); print('3-lambda check vs takram defaults', p3['rayleigh'], p3['ozone'], p3['solar'])
    l, dl = app_lambdas(); print(l, dl); print(srgb_coeff(l, dl).sum(0))
