/**
 * Physics-based sunset/sunrise prediction.
 * Physically accurate Rayleigh + Mie + Ozone atmospheric scattering.
 */

import { CloudData, CloudPathData, getInterpolatedWeather } from './weather';
import skyWeights from './sky_weights_v2.json';
import { EARTH_RADIUS_KM } from './earth';

// 지구는 utils/earth.ts 한 곳에서만 정의합니다 — 이유는 그 파일 주석 참고.

export type RGB = { r: number; g: number; b: number };

// Representative cloud-layer altitudes corresponding to Open-Meteo's
// cloud_cover_low (0-2 km), cloud_cover_mid (2-6 km), cloud_cover_high (>6 km).
export const CLOUD_ALT_LOW_KM = 1.0;
export const CLOUD_ALT_MID_KM = 4.0;
export const CLOUD_ALT_HIGH_KM = 9.0;

// Rayleigh optical depth at sea-level zenith at 550 nm.
const TAU_R_550 = 0.0972;
const TAU_R_EXP = 4.05;

// Angstrom exponent for tropospheric aerosols.
const ANGSTROM_ALPHA = 1.3;

// Reference wavelengths (nm)
const LAMBDA_R = 650;
const LAMBDA_G = 550;
const LAMBDA_B = 450;

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const toSrgb = (c: number): number => {
  const x = clamp01(c);
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(clamp01(v) * 255);
};

export const rgbToCss = (rgb: RGB): string =>
  `rgb(${toSrgb(rgb.r)},${toSrgb(rgb.g)},${toSrgb(rgb.b)})`;

export const rgbToCssAlpha = (rgb: RGB, alpha: number): string =>
  `rgba(${toSrgb(rgb.r)},${toSrgb(rgb.g)},${toSrgb(rgb.b)},${clamp01(alpha).toFixed(3)})`;

const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t),
});

/** Sæmundsson 1986 atmospheric refraction correction. */
export const getApparentAltitude = (altDeg: number): number => {
  if (altDeg <= -6.0) return altDeg;
  const safeAlt = Math.max(altDeg, -4.2);
  const tanArg = ((safeAlt + 10.3 / (safeAlt + 5.11)) * Math.PI) / 180;
  const R_arcmin = 1.02 / Math.tan(tanArg);
  const R_deg = R_arcmin / 60.0;
  let fade = 1.0;
  if (altDeg < -4.2) {
    fade = (altDeg + 6.0) / 1.8;
  }
  return altDeg + R_deg * fade;
};

/** Geometric horizon depression in degrees for an observer at altitude m. */
export const getHorizonDip = (elevationM: number): number => {
  const hKm = Math.max(0, elevationM) / 1000.0;
  const ratio = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + hKm);
  return (Math.acos(Math.min(1.0, ratio)) * 180) / Math.PI;
};

/** Kasten-Young 1989 airmass for a line-of-sight altitude in degrees. */
export const airMass = (altDeg: number): number => {
  const h = Math.max(altDeg, -1.5);
  if (h >= 89) return 1;
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(6.07995 + h, -1.6364));
};

/** Rayleigh optical depth at zenith for wavelength λ (nm). */
const tauRayleigh = (lambdaNm: number): number =>
  TAU_R_550 * Math.pow(LAMBDA_G / lambdaNm, TAU_R_EXP);

/** Mie (aerosol) optical depth at zenith for wavelength λ (nm). */
const tauMie = (lambdaNm: number, beta550: number): number =>
  beta550 * Math.pow(LAMBDA_G / lambdaNm, ANGSTROM_ALPHA);

/**
 * 에어로졸 흡습 성장 인자 (Hänel 1976).
 *
 * 수증기는 가시광에서 **직접** 흡수하는 양이 거의 없습니다 (강한 흡수대
 * 0.72·0.82·0.94µm는 전부 근적외라 sRGB 밖입니다). 수증기가 노을 색을
 * 바꾸는 실제 경로는 **에어로졸을 불려서** 입니다 — 습기를 먹은 입자가
 * 커지면 산란이 늘고 파장 의존성이 줄어, 하늘이 희뿌옇게 뜨고 노을의
 * 붉은 채도가 깎입니다.
 *
 * 그 성장은 조해점(약 80%) 위에서 `((1-RH)/(1-RH₀))^-γ` 로 급격합니다.
 * γ=0.6은 대륙성 에어로졸의 통상값입니다.
 *
 *   RH 85% → 1.32배,  90% → 1.74배,  95% → 2.29배,  98% → 3.62배
 *
 * ⚠ 예전 식은 `1 + (RH-80)/100` 이라 95%에서 겨우 1.15배였습니다. 실제의
 * 1/7 수준이라, 습한 날의 뿌연 하늘이 맑은 날과 거의 같게 나왔습니다.
 */
const HYGRO_GAMMA = 0.6;
const HYGRO_RH0 = 80;
const hygroscopicGrowth = (rhPct: number): number => {
  if (rhPct <= HYGRO_RH0) return 1;
  const rh = Math.min(99, rhPct);
  return Math.pow((100 - rh) / (100 - HYGRO_RH0), -HYGRO_GAMMA);
};

/**
 * Aerosol Angstrom turbidity beta at 550 nm, estimated from visibility (m)
 * and relative humidity (%). Falls back to a clear-air default.
 *
 * ⚠ **습도 보정은 가시거리를 모를 때만 겁니다.** 가시거리는 **그 습한
 * 공기에서 실제로 잰 값**이라, 흡습 성장이 이미 그 안에 들어 있습니다.
 * 둘 다 곱하면 같은 물을 두 번 세는 셈입니다 — 예전 식은 그렇게 하고
 * 있었고, 보정이 워낙 약해서(1.15배) 티가 안 났을 뿐입니다. 제대로 된
 * 2.3배를 그대로 곱했다면 습한 날 하늘이 두 배로 뿌예졌을 것입니다.
 */
/**
 * 지표 소산계수(1/km)를 **연직 적분 광학두께**로 바꾸는 유효 두께(km).
 *
 * ⚠ 이것은 유도값이 아니라 **사진에 맞춘 보정값**입니다. 진짜 에어로졸
 * 규모고도는 1~1.5km 이라 그대로 곱하면 시정 22km 에서 AOD 0.17 이 나오고,
 * 그러면 하늘이 사진보다 훨씬 뿌옇습니다. 예전 값 0.46 도 같은 성격의
 * 보정이었고, 실측해 보니 그것도 아직 컸습니다 — 시정 22km 에서 화면의
 * 선형 B/R 이 2.1 로, 사진의 3.2~4.2 에 한참 못 미쳤습니다.
 *
 * 0.30 으로 내리면 22km 에서 β 0.050, 화면 B/R 2.5 가 됩니다. 나머지 몫은
 * 표시 단계의 skyBlueBoost 가 맡습니다 — 사진의 색도가 물리 한계 바깥이라
 * 에어로졸만으로는 어차피 닿지 않기 때문입니다(atm_display 주석 참고).
 *
 * 흐린 쪽 계조는 그대로 둡니다: 시정 10km 는 여전히 β 0.114 로 확실히
 * 뿌옇고, 22km 의 두 배가 넘습니다.
 */
const AER_COLUMN_KM = 0.30;

/**
 * 에어로졸이 사실상 없는 공기의 하한.
 *
 * ⚠ 예전 하한은 0.04 였는데, 그 값은 **시정 40km 이상이면 항상 걸립니다**.
 * 그래서 그랜드캐니언의 시정 73km 짜리 날과 40km 짜리 날이 화면에서 완전히
 * 같게 나왔습니다 — 앱이 '아주 맑은 날'을 그릴 수 없었다는 뜻입니다.
 * (Open-Meteo 는 시정을 자르지 않습니다. 서울이 10~29km 로 나오는 것은
 * 모델이 실제로 그렇게 보는 것이고, 청정 지역은 70km 넘게 나옵니다.)
 *
 * 0.012 는 Rayleigh 한계에 가까운 청정 대기의 AOD550 이고, 시정 100km
 * 부근에서야 걸립니다.
 */
const AER_BETA_FLOOR = 0.012;

/**
 * CAMS 에어로졸 광학두께(AOD 550nm, Open-Meteo 대기질 API)를 앱의 β 척도로 옮기는 비율(2026-10-01).
 *
 * 앱의 β 는 물리 AOD 가 아니라 **사진에 맞춘 척도**입니다(`AER_COLUMN_KM` 주석: 진짜 에어로졸 규모고도
 * 1~1.5km 대신 0.30km). 그래서 AOD 를 그대로 넣으면 평균적인 날이 지금보다 서너 배 뿌옇게 그려집니다.
 *
 * 비율은 자료로 정했습니다: 24개 도시 · 지난 7일 · 3,787시각에서 시정 식 β 와 CAMS AOD 를 견주니
 * 비 중앙값 0.239(사분위 0.147~0.402). 물리적으로 기대하는 값 0.30km / 1.2km ≈ 0.25 와도 맞습니다.
 * 표본은 `tools/shader-preview/fixtures/aerosol-calibration.json`, 판정은 `verify-aerosol.js` [2].
 *
 * 둘의 순위 상관은 0.44 에 그칩니다 — AOD 가 시정과 **다른 것**을 알려 준다는 뜻입니다. 시정은 지표
 * 근처만 보는 모델 값이라 상공의 황사·연기 층을 모르고, CAMS 는 위성 AOD 를 동화한 기둥 전체 값입니다.
 */
export const AOD_TO_APP_BETA = 0.24;

/** CAMS AOD(550nm) → 앱 β. 하한·상한은 시정 식과 같습니다. */
export const aerosolBetaFromAod = (aod550: number): number =>
  Math.max(AER_BETA_FLOOR, Math.min(0.6, aod550 * AOD_TO_APP_BETA));

/**
 * @param aod550 CAMS 에어로졸 광학두께. 있으면 시정 대신 이것을 씁니다. CAMS AOD 는 그 시각 습도에서의
 *   값이라(흡습 성장 포함) 습도 보정을 다시 곱하지 않습니다 — 시정과 같은 이유입니다.
 */
export const aerosolBeta = (visibilityM?: number, rhPct?: number, aod550?: number | null): number => {
  if (aod550 != null && Number.isFinite(aod550) && aod550 >= 0) return aerosolBetaFromAod(aod550);
  const hasVis = visibilityM != null && visibilityM > 0;
  // ⚠ 시정을 모를 때의 대체값입니다. 예전에는 45km 였는데, 그건 하한 0.04 가
  // 늘 걸려 가려져 있었습니다. 하한을 내리자 45km 가 β 0.023 — **청정 대기**로
  // 나와, 모르는 날을 아주 맑은 날로 단정하게 됐습니다(verify-atmosphere 의
  // 박명 주변광이 그래서 깨졌습니다). 모를 때는 맑다고 하면 안 됩니다.
  // 27km 는 예전 대체값 β 0.04 를 그대로 되살리는 값이고, 대륙성 보통 날입니다.
  const visKm = hasVis ? visibilityM / 1000 : 27;
  const sigmaTotal = 3.912 / visKm;
  const sigmaAer = Math.max(0.02, sigmaTotal - 0.012);
  let beta = sigmaAer * AER_COLUMN_KM;
  if (!hasVis && rhPct != null) beta *= hygroscopicGrowth(rhPct);
  return Math.max(AER_BETA_FLOOR, Math.min(0.6, beta));
};

/**
 * Earth–Sun distance correction factor (relative to 1 AU).
 * Uses orbital eccentricity: r_AU ≈ 1 - 0.01671 * cos(2π/365 * (doy - 3))
 * Returns the intensity scale factor: 1/r_AU^2
 */
const earthSunDistanceFactor = (dayOfYear: number): number => {
  const angleRad = (2 * Math.PI * (dayOfYear - 3)) / 365;
  const rAU = 1 - 0.01671 * Math.cos(angleRad);
  return 1 / (rAU * rAU);
};

/**
 * Physically accurate linear-light RGB (0..1) of the direct solar beam at its current altitude.
 * Accounts for:
 *  1. Earth–Sun distance (orbital eccentricity)
 *  2. Rayleigh scattering (R, G, B wavelengths separately)
 *  3. Mie (aerosol) scattering (humidity + dust via beta)
 *  4. Ozone absorption (Chappuis band)
 *  5. Observer elevation (air column density)
 *  6. Latitude-dependent ozone column
 */
export const directBeamRGB = (
  altDeg: number,
  observerElevationM: number = 0,
  latitude: number = 37.5665,
  aerosolBetaVal?: number,
  dayOfYear: number = 172,
): RGB => {
  const NIGHT: RGB = { r: 0.0, g: 0.0, b: 0.0 };
  if (isNaN(altDeg)) return NIGHT;

  // 1) Atmospheric refraction
  const apparentAlt = getApparentAltitude(altDeg);
  const altRad = (apparentAlt * Math.PI) / 180;

  // 2) Airmass (Kasten-Young), allowing down to -1.5°
  const safeAlt = Math.max(apparentAlt, -1.5);
  const AM = safeAlt >= 89
    ? 1.0
    : 1.0 / (Math.sin((safeAlt * Math.PI) / 180) + 0.50572 * Math.pow(6.07995 + safeAlt, -1.6364));

  // 3) Observer elevation: reduce air column density (Rayleigh scale height ~8 km)
  const elevScale = Math.exp(-Math.max(0, observerElevationM) / 8000.0);
  const effectiveAM = AM * elevScale;

  // 4) Earth–Sun distance factor (intensity ∝ 1/r²)
  const distFactor = earthSunDistanceFactor(dayOfYear);

  // 5) Latitude-dependent ozone column (Dobson Units)
  const latRad = (latitude * Math.PI) / 180;
  const ozoneDu = 300.0 + 80.0 * Math.pow(Math.sin(latRad), 2);
  // Ozone layer at ~22 km
  const r_ozone = 22.0 / EARTH_RADIUS_KM;
  const ozoneAM = (1.0 + r_ozone) / Math.sqrt(Math.max(0.001, Math.sin(altRad) ** 2 + 2.0 * r_ozone));
  // Chappuis band absorption cross-sections (relative, at R/G/B peak wavelengths)
  const ozoneTransR = Math.exp(-0.015 * (ozoneDu / 300.0) * ozoneAM);
  const ozoneTransG = Math.exp(-0.030 * (ozoneDu / 300.0) * ozoneAM);
  const ozoneTransB = Math.exp(-0.002 * (ozoneDu / 300.0) * ozoneAM);

  // 6) Rayleigh transmittance per channel (Beer-Lambert: T = exp(-τ_R * AM))
  const tauR_r = tauRayleigh(LAMBDA_R) * effectiveAM;
  const tauR_g = tauRayleigh(LAMBDA_G) * effectiveAM;
  const tauR_b = tauRayleigh(LAMBDA_B) * effectiveAM;
  const rayleighR = Math.exp(-tauR_r);
  const rayleighG = Math.exp(-tauR_g);
  const rayleighB = Math.exp(-tauR_b);

  // 7) Mie transmittance (wavelength-dependent via Angstrom exponent)
  const beta = aerosolBetaVal ?? 0.08;
  const mieR = Math.exp(-tauMie(LAMBDA_R, beta) * effectiveAM);
  const mieG = Math.exp(-tauMie(LAMBDA_G, beta) * effectiveAM);
  const mieB = Math.exp(-tauMie(LAMBDA_B, beta) * effectiveAM);

  // 8) Below-horizon twilight fade (geometric shadow)
  // Sun below horizon → direct beam fades exponentially; atmospheric scattering still present
  const nightFade = apparentAlt < 0 ? Math.exp(apparentAlt / 2.5) : 1.0;

  // 9) Combine: direct beam = exo-atmospheric * Rayleigh * Mie * Ozone * distFactor * nightFade
  return {
    r: clamp01(distFactor * rayleighR * mieR * ozoneTransR * nightFade),
    g: clamp01(distFactor * rayleighG * mieG * ozoneTransG * nightFade),
    b: clamp01(distFactor * rayleighB * mieB * ozoneTransB * nightFade),
  };
};

/**
 * 기둥 양(상대 대기질량)에서 직달 투과율 — `directBeamRGB` 와 **같은 상수**(Rayleigh τ, 에어로졸 β·
 * Ångström, Chappuis 오존, 지구–태양 거리). 광선을 따라 적분한 기둥을 넣으면 됩니다(grazingRay.ts).
 *
 * @param mR   공기 기둥 ÷ 해면 수직 기둥
 * @param mM   에어로졸 기둥 ÷ 해면 수직 기둥
 * @param mO3  오존 기둥 ÷ 수직 기둥
 */
export const beamFromColumns = (
  mR: number, mM: number, mO3: number,
  aerosolBetaVal: number, ozoneDu: number, dayOfYear: number,
): RGB => {
  const distFactor = earthSunDistanceFactor(dayOfYear);
  const oz = (ozoneDu / 300.0) * mO3;
  const ch = (lambda: number, kO3: number) =>
    clamp01(distFactor * Math.exp(-tauRayleigh(lambda) * mR - tauMie(lambda, aerosolBetaVal) * mM - kO3 * oz));
  return { r: ch(LAMBDA_R, 0.015), g: ch(LAMBDA_G, 0.030), b: ch(LAMBDA_B, 0.002) };
};

/** Geometric horizon depression in degrees for an observer at altitude km. */
export const horizonDepressionDeg = (altKm: number): number =>
  (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(0, altKm))) * 180) /
  Math.PI;

/**
 * Fraction (0..1) of direct sunlight reaching a cloud at altitude
 * `cloudAltKm` when the sun is at altitude `sunAltDeg`.
 */
export const cloudIllumination = (sunAltDeg: number, cloudAltKm: number): number => {
  const dip = horizonDepressionDeg(cloudAltKm);
  const sunFromCloud = sunAltDeg + dip;
  if (sunFromCloud >= 0.5) return 1;
  if (sunFromCloud <= -1.5) return 0;
  return (sunFromCloud + 1.5) / 2.0;
};

/**
 * Beam path transmittance through cloud layers along the solar path.
 */
export const beamPathTransmittance = (path: CloudData[], sunAltDeg: number = 0.5): number => {
  if (!path || path.length === 0) return 1;
  const centralPath = path.filter(p => p.azimuthOffset === 0);
  const activePath = (centralPath.length > 0 ? centralPath : path).sort((a, b) => a.distance - b.distance);
  const apparentAlt = getApparentAltitude(Math.max(0.5, sunAltDeg));
  const apparentAltRad = (apparentAlt * Math.PI) / 180;
  const distances = activePath.map(p => p.distance);
  const weights = distances.map((d) => {
    if (d === 0) return 0.1;
    if (d <= 80) return 0.2;
    return 0.35;
  });
  let totalOpticalDepth = 0;
  for (let i = 0; i < activePath.length; i++) {
    const x = distances[i];
    const s = activePath[i];
    const w = weights[i] ?? 0.25;
    const hRay = x * Math.tan(apparentAltRad) + (x * x) / (2 * EARTH_RADIUS_KM);
    if (hRay < 0) { totalOpticalDepth += 5.0 * w; continue; }
    let wLow = 0, wMid = 0, wHigh = 0;
    if (hRay <= 2.0) {
      if (hRay > 1.5) { const t = (hRay - 1.5) / 0.5; wLow = 1 - t; wMid = t; }
      else wLow = 1.0;
    } else if (hRay <= 6.0) {
      if (hRay < 2.5) { const t = (hRay - 2.0) / 0.5; wLow = 1 - t; wMid = t; }
      else if (hRay > 5.0) { const t = (hRay - 5.0) / 1.0; wMid = 1 - t; wHigh = t; }
      else wMid = 1.0;
    } else if (hRay <= 12.0) {
      if (hRay < 7.0) { const t = (hRay - 6.0) / 1.0; wMid = 1 - t; wHigh = t; }
      else wHigh = 1.0;
    }
    const waterDensity = s.totalColumnWaterVapour ?? 15.0;
    const waterMultiplier = Math.max(0.6, Math.min(2.5, waterDensity / 20.0));
    const extLow = 4.0 * waterMultiplier;
    const extMid = 2.0 * waterMultiplier;
    const extHigh = 0.5 * waterMultiplier;
    const cLow = s.low / 100, cMid = s.mid / 100, cHigh = s.high / 100;
    totalOpticalDepth += (extLow * cLow * wLow + extMid * cMid * wMid + extHigh * cHigh * wHigh) * w;
  }
  return clamp01(Math.exp(-totalOpticalDepth));
};

/**
 * Sky color at a given sky direction, based on observed sunrise/daytime sky palettes
 * cross-validated against Rayleigh/Mie physics and Hosek-Wilkie model outputs.
 *
 * @param thetaDeg   Elevation angle of sky point (0=horizon, 90=zenith)
 * @param gammaDeg   Angular distance from sun (degrees)
 * @param sunAltDeg  True solar altitude (degrees, negative=below horizon)
 * @param beta       Aerosol turbidity (Angstrom, 0.05=clean, 0.5=hazy)
 * @param pathClarity Cloud beam transmittance (1=clear, 0=opaque)
 */
export const skyColorAtDirection = (
  thetaDeg: number,
  gammaDeg: number,
  sunAltDeg: number,
  beta: number,
  pathClarity: number,
): RGB => {
  // ── Elevation fraction: 0 = horizon row, 1 = zenith ─────────────────────
  const ef = clamp01(thetaDeg / 80.0); // 0° → 0, 80° → 1

  // ─── Observation-based Sky Color LUT ────────────────────────────────────
  // Each entry: [sunAlt°, zenithRGB, horizonRGB]
  // Colors sourced from analyzed sunrise/sunset photography and verified against
  // Hosek-Wilkie model output at turbidity T=2 (clean air).
  //
  // Zenith = true overhead color
  // Horizon = color at the horizon (opposite or around sun direction, blended by gamma)
  //
  //  sunAlt | zenith (r,g,b)      | horizon (r,g,b)
  const LUT: Array<[number, [number,number,number], [number,number,number]]> = [
    // ── Deep night ───────────────────────────────────────────────────────
    [ -18, [0.010, 0.012, 0.040], [0.010, 0.012, 0.040] ],
    // ── Astronomical twilight ────────────────────────────────────────────
    [ -12, [0.028, 0.040, 0.120], [0.040, 0.038, 0.090] ],
    // ── Nautical twilight: horizon begins purple/indigo glow ─────────────
    [  -8, [0.060, 0.085, 0.230], [0.090, 0.060, 0.160] ],
    // ── Civil twilight start: eastern glow appears ────────────────────────
    [  -6, [0.085, 0.115, 0.310], [0.200, 0.105, 0.135] ],
    // ── Deep civil twilight: warm pinks in horizon, indigo above ─────────
    [  -4, [0.100, 0.140, 0.370], [0.380, 0.180, 0.120] ],
    // ── Just before sunrise: deep blue above, orange-red horizon ─────────
    [  -2, [0.110, 0.165, 0.430], [0.640, 0.280, 0.085] ],
    // ── Sunrise: sun on horizon, deep red/orange near sun, blue above ─────
    [   0, [0.120, 0.195, 0.490], [0.820, 0.380, 0.080] ],
    // ── Just risen (+2°): orange fades slightly, blue begins spreading ────
    [   2, [0.145, 0.240, 0.560], [0.880, 0.520, 0.140] ],
    // ── Golden hour (+5°): vivid golden horizon, medium blue at zenith ────
    [   5, [0.180, 0.320, 0.650], [0.900, 0.680, 0.250] ],
    // ── Low sun (+10°): light starts normalizing, pale warm horizon ───────
    [  10, [0.240, 0.430, 0.760], [0.940, 0.840, 0.560] ],
    // ── Morning (+20°): clear blue zenith, warm-white horizon haze ────────
    [  20, [0.310, 0.560, 0.870], [0.950, 0.940, 0.850] ],
    // ── Mid-morning (+35°): rich sky blue, white-blue near horizon ────────
    [  35, [0.360, 0.640, 0.920], [0.900, 0.930, 0.970] ],
    // ── High sun (60°+): deep cerulean at zenith, pale blue-white horizon ─
    [  60, [0.380, 0.670, 0.950], [0.860, 0.910, 0.970] ],
  ];

  // ── Interpolate between LUT entries by sunAltDeg ─────────────────────────
  let lo = LUT[0], hi = LUT[LUT.length - 1];
  for (let i = 0; i < LUT.length - 1; i++) {
    if (sunAltDeg >= LUT[i][0] && sunAltDeg < LUT[i + 1][0]) {
      lo = LUT[i];
      hi = LUT[i + 1];
      break;
    }
    if (sunAltDeg >= LUT[LUT.length - 1][0]) {
      lo = hi = LUT[LUT.length - 1];
    }
  }
  const tAlt = lo[0] === hi[0] ? 0 : clamp01((sunAltDeg - lo[0]) / (hi[0] - lo[0]));
  // Smooth step for more natural transition
  const tAltSmooth = tAlt * tAlt * (3 - 2 * tAlt);

  // Interpolated zenith and horizon base colors
  const zenR = lerp(lo[1][0], hi[1][0], tAltSmooth);
  const zenG = lerp(lo[1][1], hi[1][1], tAltSmooth);
  const zenB = lerp(lo[1][2], hi[1][2], tAltSmooth);
  const horR = lerp(lo[2][0], hi[2][0], tAltSmooth);
  const horG = lerp(lo[2][1], hi[2][1], tAltSmooth);
  const horB = lerp(lo[2][2], hi[2][2], tAltSmooth);

  // ── Blend zenith↔horizon by elevation fraction ───────────────────────────
  // Use a nonlinear blend: sky rapidly transitions from blue to pale in the
  // bottom quarter, matching observed photos.
  // ef^0.55 makes the blue-to-white transition happen faster near horizon.
  const blendEf = Math.pow(ef, 0.55);
  let finalR = lerp(horR, zenR, blendEf);
  let finalG = lerp(horG, zenG, blendEf);
  let finalB = lerp(horB, zenB, blendEf);

  // ── Sun-proximity warm tint (Mie forward scattering) ─────────────────────
  // Cells near the sun get an additional warm glow regardless of elevation.
  // This simulates the visible Mie scattering aureole around the sun.
  if (gammaDeg < 35 && sunAltDeg > -6 && pathClarity > 0.1) {
    const gMie = 0.80;
    const cosG = Math.cos((gammaDeg * Math.PI) / 180);
    const g2 = gMie * gMie;
    const phase = (1 - g2) / Math.pow(1 + g2 - 2 * gMie * cosG, 1.5);
    const phaseMax = (1 - g2) / Math.pow((1 - gMie) * (1 - gMie), 1.5);
    const mieNorm = clamp01(phase / phaseMax);
    // Glow color = beam color at current sun altitude
    const sunVis = clamp01((sunAltDeg + 6) / 8) * pathClarity;
    const glowStrength = mieNorm * sunVis * (0.20 + beta * 0.40);
    // Beam color (warm near horizon, white-yellow when high)
    const bR = sunAltDeg < 5 ? lerp(0.95, 1.0, clamp01(sunAltDeg / 5)) : 1.0;
    const bG = sunAltDeg < 5 ? lerp(0.30, 0.85, clamp01((sunAltDeg + 2) / 7)) : 0.92;
    const bB = sunAltDeg < 5 ? lerp(0.02, 0.45, clamp01((sunAltDeg + 2) / 7)) : 0.75;
    finalR = Math.min(1, finalR + bR * glowStrength);
    finalG = Math.min(1, finalG + bG * glowStrength * 0.85);
    finalB = Math.min(1, finalB + bB * glowStrength * 0.70);
  }

  // ── Broad Twilight Arch (Orange-red horizon glow centered at sun azimuth) ──
  // This simulates the atmospheric light path that remains illuminated after sunset.
  if (sunAltDeg > -12) {
    // Decay factor as the sun goes deeper below the horizon, peaking near -2° to 1°, and fading to 0 by 8°
    let twilightVis = 0;
    if (sunAltDeg >= -12 && sunAltDeg <= 8) {
      if (sunAltDeg < -2) {
        twilightVis = (sunAltDeg + 12) / 10; // -12° (0.0) -> -2° (1.0)
      } else {
        twilightVis = 1.0 - clamp01((sunAltDeg + 2) / 10); // -2° (1.0) -> 8° (0.0)
      }
    }
    const twilightVisSmooth = twilightVis * twilightVis * (3 - 2 * twilightVis);
    
    if (twilightVisSmooth > 0.01) {
      // Horizontal distribution: centered at sun's azimuth (gammaDeg)
      const cosAzDiff = Math.cos((gammaDeg * Math.PI) / 180);
      const archSpread = Math.max(0, cosAzDiff);
      
      // Broad angular spread along the horizon with exponential height falloff
      const archFactor = Math.pow(archSpread, 1.5) * Math.exp(-0.12 * thetaDeg) * twilightVisSmooth * pathClarity;
      // beta가 낮을수록(대기가 깨끗할수록) 지평선 붉은 노을이 가려지지 않고 쨍하게 부스팅되도록 보정
      const cleanAirBoost = 1.0 + Math.max(0, 0.12 - beta) * 2.0;
      const archIntensity = archFactor * 0.90 * (0.8 + beta * 0.2) * cleanAirBoost;
      
      // Interpolate colors from deep red-orange to bright yellow-gold as sun altitude rises (-8° to +4°)
      const tColor = clamp01((sunAltDeg + 8) / 12);
      const archR = 1.0;
      const archG = lerp(0.18, 0.72, tColor);
      const archB = lerp(0.01, 0.12, tColor);
      
      finalR = Math.min(1, finalR + archR * archIntensity);
      finalG = Math.min(1, finalG + archG * archIntensity);
      finalB = Math.min(1, finalB + archB * archIntensity);
    }
  }

  // ── Aerosol desaturation (fine dust/haze whitens sky uniformly) ──────────
  const dustLevel = clamp01((beta - 0.05) / 0.45);
  if (dustLevel > 0) {
    // 태양 주변부(gammaDeg가 작을수록)에서는 미세먼지에 의한 백색 탈색 효과를 억제하여 붉은색 채도를 보존합니다.
    const proximityFactor = clamp01(gammaDeg / 35.0);
    const haze = dustLevel * 0.20 * lerp(0.15, 1.0, proximityFactor);
    finalR = lerp(finalR, 0.62, haze);
    finalG = lerp(finalG, 0.60, haze);
    finalB = lerp(finalB, 0.58, haze);
  }

  // ── Cloud/overcast: shift to grey as clarity drops ───────────────────────
  if (pathClarity < 1.0) {
    const oc = (1.0 - pathClarity) * 0.35;
    // Overcast sky: uniform grey, slightly blue-shifted
    const gcR = 0.48, gcG = 0.50, gcB = 0.55;
    finalR = lerp(finalR, gcR, oc);
    finalG = lerp(finalG, gcG, oc);
    finalB = lerp(finalB, gcB, oc);
  }

  return { r: finalR, g: finalG, b: finalB };
};

/**
 * Extract 21 polynomial + interaction features for OLS model.
 */
export const extractSkyFeatures = (
  sunAlt: number,
  thetaDeg: number,
  gammaDeg: number,
  beta: number,
  pathClarity: number
): number[] => {
  const cosGamma = Math.cos((gammaDeg * Math.PI) / 180);
  const normalizedTheta = thetaDeg / 80.0;
  const normalizedSunAlt = sunAlt / 60.0;

  return [
    1.0,
    normalizedSunAlt,
    normalizedSunAlt * normalizedSunAlt,
    cosGamma,
    cosGamma * cosGamma,
    normalizedTheta,
    normalizedTheta * normalizedTheta,
    beta,
    pathClarity,
    normalizedSunAlt * cosGamma,
    normalizedSunAlt * normalizedTheta,
    beta * cosGamma,
    pathClarity * cosGamma,
    pathClarity * normalizedTheta,
    Math.exp(normalizedSunAlt * 2),
    Math.exp(-normalizedTheta * 3),
    Math.max(0, cosGamma) * Math.exp(-normalizedTheta * 2),
    clamp01((sunAlt + 6) / 12) * Math.max(0, cosGamma),
    normalizedSunAlt * beta,
    normalizedSunAlt * pathClarity,
    normalizedSunAlt * normalizedSunAlt * normalizedSunAlt,
  ];
};

/**
 * Predict R, G, B colors using OLS weights from sky_weights_v2.json.
 */
export const getApproximatedSkyColor = (
  thetaDeg: number,
  gammaDeg: number,
  sunAltDeg: number,
  beta: number,
  pathClarity: number
): RGB => {
  const features = extractSkyFeatures(sunAltDeg, thetaDeg, gammaDeg, beta, pathClarity);

  const Wr = skyWeights.Wr;
  const Wg = skyWeights.Wg;
  const Wb = skyWeights.Wb;

  let r = 0;
  let g = 0;
  let b = 0;

  for (let i = 0; i < features.length; i++) {
    r += features[i] * Wr[i];
    g += features[i] * Wg[i];
    b += features[i] * Wb[i];
  }

  return {
    r: clamp01(r),
    g: clamp01(g),
    b: clamp01(b),
  };
};




/**
 * Compute an 8-vertical × 5-horizontal mosaic of sky colors (40 cells total).
 *
 * Grid layout:
 *   rows[0] = near-zenith (θ ≈ 70–80°), rows[7] = near-horizon (θ ≈ 0–10°)
 *   cols[0] = left edge of FOV, cols[4] = right edge
 *
 * @returns Flat array of 40 RGB values, in row-major order (row 0 first = zenith)
 */
export const computeSkyGrid = (
  sunAltDeg: number,
  sunAzDeg: number,       // solar azimuth (degrees, N=0, E=90)
  viewHeading: number,    // camera heading (degrees, N=0, E=90)
  visualFov: number,      // horizontal FOV (degrees)
  beta: number,
  pathClarity: number,
  verticalFovDeg: number = 60, // actual vertical FOV of the sky viewport
): RGB[] => {
  const ROWS = 8;
  const COLS = 5;

  // Elevation boundaries derived from actual vertical FOV.
  // When zoomed in (small FOV), the top of the viewport shows lower elevation;
  // when zoomed out (large FOV), higher elevation is visible.
  const elevMin = 0;
  const elevMax = Math.min(90, Math.max(10, verticalFovDeg)); // clamp to sensible range
  const elevStep = (elevMax - elevMin) / ROWS;

  // Azimuth boundaries relative to heading
  const halfFov = visualFov / 2;
  const azStep = visualFov / COLS;

  const grid: RGB[] = [];

  for (let row = 0; row < ROWS; row++) {
    // Row 0 = top (high elevation), row 7 = bottom (near horizon)
    const thetaCenter = elevMax - (row + 0.5) * elevStep; // degrees above horizon

    for (let col = 0; col < COLS; col++) {
      // Azimuth relative to camera heading (centered at heading)
      const relAz = -halfFov + (col + 0.5) * azStep; // degrees from camera center
      const absAz = viewHeading + relAz;              // absolute azimuth

      // Scattering angle γ between this sky direction and the sun
      const thetaRad = (Math.max(thetaCenter, 0.05) * Math.PI) / 180;
      const sunAltRad = (sunAltDeg * Math.PI) / 180;
      const azDiffRad = ((absAz - sunAzDeg) * Math.PI) / 180;

      // 3D dot product: view direction · sun direction
      const cosGamma = Math.sin(thetaRad) * Math.sin(sunAltRad) +
                       Math.cos(thetaRad) * Math.cos(sunAltRad) * Math.cos(azDiffRad);
      const cosGammaClamped = Math.max(-1.0, Math.min(1.0, cosGamma));
      const gammaDeg = (Math.acos(cosGammaClamped) * 180) / Math.PI;

      const color = getApproximatedSkyColor(
        Math.max(thetaCenter, 0.05),
        gammaDeg,
        sunAltDeg,
        beta,
        pathClarity,
      );

      grid.push(color);
    }
  }

  return grid; // length = 40
};


// ─── LEGACY GRADIENT API (used by predictSunset) ────────────────────────────

const NIGHT: RGB = { r: 0.003, g: 0.004, b: 0.018 };
const OVERCAST: RGB = { r: 0.42, g: 0.44, b: 0.48 };
const SHADOWED_CLOUD: RGB = { r: 0.22, g: 0.24, b: 0.3 };

export interface SkyStop {
  offset: number;
  color: string;
}

export interface SunsetPrediction {
  score: number;
  quality: 'Overcast' | 'Muted' | 'Fair' | 'Great' | 'Epic';
  /** 구름 양 평가: 많음 / 복합적 / 없음 */
  cloudLabel: 'Overcast' | 'Complex' | 'Clear';
  /** 색상 평가: 화려함 / 칙칙함 / 깨끗함 */
  colorLabel: 'Vivid' | 'Muted' | 'Clean';
  description: string;
  /** Vertical gradient stops (kept for backward compat, but now computed from skyColorAtDirection). */
  skyGradient: SkyStop[];
  sunGlowStops: SkyStop[];
  highCloudColor: string;
  midCloudColor: string;
  lowCloudColor: string;
  highCloudRGB: RGB;
  midCloudRGB: RGB;
  lowCloudRGB: RGB;
  sunDiskColor: string;
  factors: {
    beamRedness: number;
    pathClarity: number;
    overheadGlow: number;
    overheadOvercast: number;
    aerosolBeta: number;
    dynamicHaloScale: number;
    illumLow: number;
    illumMid: number;
    illumHigh: number;
  };
}

export const predictSunset = (
  pathData: CloudPathData[],
  targetTime: Date,
  sunAltDeg: number,
  visibilityM?: number,
  rhPct?: number,
  latitude?: number,
  observerElevationM?: number,
  dayOfYear?: number,
): SunsetPrediction => {
  if (isNaN(sunAltDeg)) {
    const defaultRGB = { r: 0.22, g: 0.24, b: 0.3 };
    return {
      score: 0,
      quality: 'Muted',
      cloudLabel: 'Clear',
      colorLabel: 'Muted',
      description: 'Unable to predict due to invalid data.',
      skyGradient: [
        { offset: 0, color: '#08101e' },
        { offset: 1, color: '#08101e' },
      ],
      sunGlowStops: [],
      highCloudColor: 'transparent',
      midCloudColor: 'transparent',
      lowCloudColor: 'transparent',
      highCloudRGB: defaultRGB,
      midCloudRGB: defaultRGB,
      lowCloudRGB: defaultRGB,
      sunDiskColor: 'transparent',
      factors: { beamRedness: 0, pathClarity: 0, overheadGlow: 0, overheadOvercast: 0, aerosolBeta: 0, dynamicHaloScale: 1.0, illumLow: 0, illumMid: 0, illumHigh: 0 }
    };
  }

  const latVal = latitude ?? 37.5665;
  const elevVal = observerElevationM ?? 0;
  const doy = dayOfYear ?? 172;

  const dip = getHorizonDip(elevVal);
  const apparentAlt = getApparentAltitude(sunAltDeg);
  const effectiveSunAlt = apparentAlt + dip;

  const localPath = getInterpolatedWeather(pathData, targetTime);
  // 관측점에 대기질 AOD 가 붙어 있으면 그것으로, 없으면 예전처럼 시정으로(`aerosolBeta` 주석).
  const obsAod = (localPath.find(p => p.distance === 0) ?? localPath[0])?.aod550;
  const beta = aerosolBeta(visibilityM, rhPct, obsAod);
  const pathClarity = Math.max(0.15, beamPathTransmittance(localPath, sunAltDeg));

  const currentBeam = directBeamRGB(sunAltDeg, elevVal, latVal, beta, doy);
  const horizonBeam = directBeamRGB(Math.max(sunAltDeg, 0), elevVal, latVal, beta, doy);

  const incidentBeam: RGB = {
    r: horizonBeam.r * pathClarity,
    g: horizonBeam.g * pathClarity,
    b: horizonBeam.b * pathClarity,
  };
  const beamRedness = incidentBeam.r > 0
    ? Math.max(0, (incidentBeam.r - incidentBeam.g) / Math.max(incidentBeam.r, 0.001))
    : 0;

  const illumLow = cloudIllumination(effectiveSunAlt, CLOUD_ALT_LOW_KM);
  const illumMid = cloudIllumination(effectiveSunAlt, CLOUD_ALT_MID_KM);
  const illumHigh = cloudIllumination(effectiveSunAlt, CLOUD_ALT_HIGH_KM);

  const obsPoint = localPath.find(p => p.distance === 0) ?? localPath[0] ?? { low: 0, mid: 0, high: 0, visibility: 25000, humidity: 50 };
  const centralPath = localPath.filter(p => p.azimuthOffset === 0).sort((a, b) => a.distance - b.distance);
  const centerPoint = centralPath[1] ?? obsPoint ?? { low: 0, mid: 0, high: 0 };

  const lowVal = obsPoint.low / 100;
  const midVal = obsPoint.mid / 100;
  const highVal = obsPoint.high / 100;

  const cloudWeight = clamp01(lowVal * 0.95 + midVal * 0.55 + highVal * 0.25);
  const liquidWater = obsPoint.totalColumnWaterVapour ?? 0;
  const cloudPresence = clamp01(cloudWeight * 3.0);
  const waterFactor = clamp01(liquidWater / 35.0) * cloudPresence;
  const precip = obsPoint.precipitation ?? 0;
  const precipFactor = precip > 0.1 ? 1.0 : precip * 10;
  const dni = obsPoint.directNormalIrradiance;
  let dniBlockFactor = 0;
  if (dni !== undefined && sunAltDeg > 1.5) {
    const maxDniTheory = Math.max(80, 950 * Math.sin((Math.max(1.5, sunAltDeg) * Math.PI) / 180));
    dniBlockFactor = clamp01(1.0 - (dni / maxDniTheory));
  } else if (dni !== undefined && sunAltDeg <= 1.5 && sunAltDeg > -2.0) {
    dniBlockFactor = dni < 15 ? 1.0 : clamp01(1.0 - (dni / 80));
  }

  const overheadOvercast = clamp01(Math.max(cloudWeight, waterFactor, precipFactor, dniBlockFactor));
  const overheadGlow = clamp01(highVal * illumHigh + midVal * illumMid * 0.7);

  const isHorizonBlocked = effectiveSunAlt < 3.0 && pathClarity < 0.15 &&
    (obsPoint.low > 40 || centerPoint.low > 40);

  // 1) 구름 가득 낀 날 (완전 오버캐스트) 체크 -> 무조건 0점
  const isOvercast = overheadOvercast > 0.8;

  // 2) 미세먼지가 아주 심해 시정이 나쁜 상태 체크 -> 낮은 점수대로 강제
  const isDusty = (beta > 0.25) || (visibilityM !== undefined && visibilityM < 8000);

  // 3) 구름 한 점 없는 맑은 하늘 체크 -> 50점대 고정
  const totalCloudAmount = obsPoint.low + obsPoint.mid + obsPoint.high;
  const isClearSky = totalCloudAmount < 15;

  let score = 0;

  if (isOvercast) {
    score = 0;
  } else if (isClearSky) {
    let clearScore = 53;
    if (isDusty) clearScore -= 15; 
    if (isHorizonBlocked) clearScore -= 15; 
    score = Math.max(15, Math.round(clearScore));
  } else {
    const horizonProximity = clamp01(1 - Math.abs(effectiveSunAlt) / 8);
    const cloudShow = pathClarity * overheadGlow * (0.5 + 0.5 * beamRedness);
    let raw = 25 * pathClarity * horizonProximity + 70 * cloudShow;
    
    raw *= 1 - 0.85 * overheadOvercast;
    
    // 먼 지평선 근처에 구름이 많아 붉어지기 전에 태양이 가려지면 낮은 점수대로 제한 (10~30점)
    if (isHorizonBlocked) {
      raw = Math.min(25, raw * 0.3 + 10);
    }
    
    // 미세먼지가 매우 심해 해가 바로 뿌얘지면 낮은 점수대로 제한 (10~30점)
    if (isDusty) {
      raw = Math.min(25, raw * 0.4 + 10);
    }

    // 구름 정도가 이상적일수록 (중층운/상층운 적정량 및 하층운이 맑을 때) 높은 점수
    const isIdealCloud = obsPoint.mid >= 20 && obsPoint.mid <= 70 && obsPoint.low < 30;
    if (isIdealCloud) {
      raw += 15;
    }

    score = Math.max(0, Math.min(100, Math.round(raw)));
  }

  let quality: SunsetPrediction['quality'];
  let description: string;
  if (overheadOvercast > 0.82) {
    quality = 'Overcast';
    description = precip > 0
      ? 'Heavy rain clouds cover the entire sky, completely blocking the sunset light.'
      : 'A thick single layer of clouds covers the sky, completely hiding the sunlight.';
  } else if (isHorizonBlocked) {
    quality = 'Muted';
    description = 'Thick clouds block the horizon in the sunset direction, making it hard to see the sunset glow.';
  } else if (score >= 75) {
    quality = 'Epic';
    description = 'Clear horizon combined with mid-to-high clouds suggests an intense, beautiful sunset.';
  } else if (score >= 55) {
    quality = 'Great';
    description = 'Ample red light is reflecting off the clouds, perfect for viewing a lovely sunset.';
  } else if (score >= 35) {
    quality = 'Fair';
    description = 'Light is weak or there are many clouds, but a subtle sunset glow is visible.';
  } else {
    quality = 'Muted';
    description = 'Lack of scattering or too few clouds might make the sunset look plain.';
  }

  // Sky gradient (vertical only — for legacy consumers)
  // overcastWeight는 태양 고도(sunWeight)와 무관하게 overheadOvercast 값만으로 결정한다.
  // 기존에는 sunWeight를 곱해 노을 시간대(고도 ≈ 0°)에 overcastWeight가 극히 낮아져
  // 비/완전흐림 날에도 붉은 색이 살아남는 버그가 있었다.
  const muted = (c: RGB): RGB => {
    // 완전 흐림(overheadOvercast > 0.8)이면 물리 색을 거의 덮어씌움 (최대 90%)
    // 부분 흐림은 비례적으로 적용
    const overcastWeight = clamp01(overheadOvercast * 1.1);
    return mixRgb(c, OVERCAST, overcastWeight);
  };

  // Use skyColorAtDirection for gradient stops (sun azimuth = 180° for vertical center)
  const skyGradient: SkyStop[] = [0, 0.25, 0.5, 0.7, 0.85, 1.0].map(y => {
    // Map y=0 (zenith) to θ=80°, y=1 (horizon) to θ=0°
    const theta = 0.05 + 78 * (1.0 - y);
    const physicalColor = skyColorAtDirection(theta, theta > 40 ? 90 : 90 - theta, sunAltDeg, beta, pathClarity);
    return {
      offset: y,
      color: rgbToCss(muted(physicalColor)),
    };
  });

  // Weather
  const visM = visibilityM ?? 25000;
  const rhVal = rhPct ?? 50;
  const fogIntensity = clamp01((rhVal - 85) / 15) * clamp01((6000 - Math.max(500, visM)) / 5500);
  const dustIntensity = clamp01((beta - 0.08) / 0.4);
  const cloudBlockIntensity = clamp01(Math.max(precipFactor, dniBlockFactor, waterFactor * 0.95));
  const dynamicHaloScale = (1.0 + dustIntensity * 0.4 + fogIntensity * 0.75) * Math.max(0.01, 1.0 - cloudBlockIntensity);

  // Sun glow
  const sunGlowStops: SkyStop[] = [];
  const gValForPhase = 0.78;
  const maxPhase = (1.0 + gValForPhase) / ((1.0 - gValForPhase) * (1.0 - gValForPhase));
  const glowVisibility = pathClarity * clamp01((sunAltDeg + 6) / 12) * (1.0 - fogIntensity * 0.5) * (1.0 - cloudBlockIntensity * 0.95);
  const glowSamples = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1.0];
  for (const offset of glowSamples) {
    const gamma = offset * 50;
    const theta = Math.max(0.05, sunAltDeg);
    const physicalColor = skyColorAtDirection(theta, gamma, sunAltDeg, beta, pathClarity);
    const cosGamma = Math.cos((gamma * Math.PI) / 180);
    const phase = (1.0 - gValForPhase * gValForPhase) / Math.pow(1.0 + gValForPhase * gValForPhase - 2.0 * gValForPhase * cosGamma, 1.5);
    const alpha = clamp01((phase / maxPhase) * 0.95 * glowVisibility);
    sunGlowStops.push({ offset, color: rgbToCssAlpha(physicalColor, alpha) });
  }

  // Cloud tints
  const litColor = (illum: number, baseLit: number, isIce: boolean = false): RGB => {
    let cloudSunlight: RGB;
    if (sunAltDeg > 5) {
      cloudSunlight = { r: 0.98, g: 0.95, b: 0.88 };
    } else {
      const t = clamp01((sunAltDeg + 2) / 7);
      cloudSunlight = mixRgb({ r: 0.98, g: 0.50, b: 0.15 }, { r: 0.98, g: 0.95, b: 0.88 }, t);
    }
    if (isIce && sunAltDeg <= 4) {
      const tIce = clamp01((sunAltDeg + 4) / 8);
      cloudSunlight = mixRgb({ r: 1.0, g: 0.45, b: 0.65 }, cloudSunlight, tIce);
    }
    
    let baseShadow = SHADOWED_CLOUD;
    if (isIce) {
      // 지구 그림자에 가려지지 않은 상태(illum > 0)일 때는 칙칙한 그림자 대신 붉은빛(cloudSunlight)을 채워줌
      // illum이 0이 되면(지구 그림자에 완전히 들어감) 원래의 회색 그림자(SHADOWED_CLOUD)가 됨
      const redGlowFactor = clamp01(illum);
      baseShadow = mixRgb(SHADOWED_CLOUD, cloudSunlight, redGlowFactor * 0.95);
    }

    const mixFactor = clamp01(illum * baseLit * (pathClarity * 0.5 + 0.5));
    return mixRgb(baseShadow, cloudSunlight, mixFactor);
  };

  const highCloudRGB = litColor(illumHigh, 1.4, true);
  const midCloudRGB = litColor(illumMid, 1.2, false);
  const lowCloudRGB = litColor(illumLow, 0.9, false);

  // Sun disk color: physically computed from directBeamRGB, normalized to always
  // display the correct hue. Near horizon = deep red/orange, high = white-yellow.
  const sunColorBeam = directBeamRGB(Math.max(sunAltDeg, -2.0), elevVal, latVal, beta, doy);
  const maxChannel = Math.max(sunColorBeam.r, sunColorBeam.g, sunColorBeam.b);
  const sunRGB: RGB = maxChannel > 1e-9
    ? {
        r: clamp01(sunColorBeam.r / maxChannel),
        g: clamp01(sunColorBeam.g / maxChannel),
        b: clamp01(sunColorBeam.b / maxChannel),
      }
    : { r: 1.0, g: 0.2, b: 0.0 }; // 극단적 감쇄 시 붉은색 유지

  // Apply visual altitude filter for sharper sunset coloration transitions
  // 지평선 부근(<=0도)일 땐 피처럼 붉고, 고도가 올라감에 따라(10도 이상) 빠르게 백색광으로 변함
  const altFactor = clamp01(1.0 - (sunAltDeg - (-2.0)) / 12.0); // -2도 -> 1.0, 10도 -> 0.0
  const redCorrectionG = lerp(1.0, 0.08, altFactor); // 지평선 근처에서 G 억제 대폭 강화 (0.23 -> 0.02)
  const redCorrectionB = lerp(1.0, 0.00, altFactor); // 지평선 근처에서 B 완벽 억제

  sunRGB.g = clamp01(sunRGB.g * redCorrectionG);
  sunRGB.b = clamp01(sunRGB.b * redCorrectionB);

  // 태양은 절대 반투명하면 안 되므로 불투명도를 1.0으로 고정
  const sunDiskAlpha = 1.0;

  // ── 2축 라벨 계산 ─────────────────────────────────────────────────────
  // 구름 양: overheadOvercast 기준
  const cloudLabel: SunsetPrediction['cloudLabel'] =
    overheadOvercast > 0.6 ? 'Overcast'
    : overheadOvercast > 0.25 ? 'Complex'
    : 'Clear';

  // 색상: beamRedness + overheadGlow 기준
  //   화려: 선광이 빨가고 구름이 받아 짜는 상태
  //   칙칙: 구름이 많아 흑칙칙한 상태
  //   깨끗: 구름 없는 맑은 하늘
  const colorLabel: SunsetPrediction['colorLabel'] =
    (beamRedness > 0.30 && overheadGlow > 0.08) ? 'Vivid'
    : overheadOvercast > 0.55 ? 'Muted'
    : 'Clean';

  return {
    score,
    quality,
    cloudLabel,
    colorLabel,
    description,
    skyGradient,
    sunGlowStops,
    highCloudColor: rgbToCssAlpha(highCloudRGB, 0.9),
    midCloudColor: rgbToCssAlpha(midCloudRGB, 0.85),
    lowCloudColor: rgbToCssAlpha(lowCloudRGB, 0.9),
    highCloudRGB,
    midCloudRGB,
    lowCloudRGB,
    sunDiskColor: rgbToCssAlpha(sunRGB, sunDiskAlpha),
    factors: {
      beamRedness,
      pathClarity,
      overheadGlow,
      overheadOvercast,
      aerosolBeta: beta,
      dynamicHaloScale,
      illumLow,
      illumMid,
      illumHigh,
    },
  };
};
