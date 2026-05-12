/**
 * Physics-based sunset/sunrise prediction.
 *
 * The model combines four ingredients:
 *
 *   1. Kasten-Young airmass for the slant path through the atmosphere when
 *      the sun is near the horizon.
 *   2. Wavelength-dependent extinction (Rayleigh + Mie/Angstrom) on three
 *      RGB primaries, producing the reddened color of the direct beam.
 *   3. Earth-curvature horizon depression that determines, per cloud layer
 *      altitude, whether the sun is still above that layer's local horizon
 *      and can therefore illuminate it.
 *   4. Path-integrated cloud blockage sampled along the sun's azimuth at
 *      0/80/200/350 km, which models how much of the direct beam survives
 *      to reach the observer and the clouds above the observer.
 *
 * The result is a `SunsetPrediction` carrying a 0-100 score, a quality
 * label, a human-readable explanation, an SVG-ready vertical sky gradient,
 * and physically-derived tinting colors for the cloud and sun layers.
 */

import { CloudData, CloudPathData, getInterpolatedWeather } from './weather';

const EARTH_RADIUS_KM = 6371;

export type RGB = { r: number; g: number; b: number };

// Representative cloud-layer altitudes corresponding to Open-Meteo's
// cloud_cover_low (0-2 km), cloud_cover_mid (2-6 km), cloud_cover_high (>6 km).
export const CLOUD_ALT_LOW_KM = 1.0;
export const CLOUD_ALT_MID_KM = 4.0;
export const CLOUD_ALT_HIGH_KM = 9.0;

const LAMBDA_R = 650;
const LAMBDA_G = 550;
const LAMBDA_B = 450;

// Rayleigh optical depth at sea-level zenith at 550 nm.
const TAU_R_550 = 0.0972;
const TAU_R_EXP = 4.05;

// Angstrom exponent for tropospheric aerosols.
const ANGSTROM_ALPHA = 1.3;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
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

/** Kasten-Young 1989 airmass for line-of-sight altitude in degrees. */
export const airMass = (altDeg: number): number => {
  const h = Math.max(altDeg, -1);
  if (h >= 89) return 1;
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(6.07995 + h, -1.6364));
};

const tauRayleigh = (lambdaNm: number): number =>
  TAU_R_550 * Math.pow(LAMBDA_G / lambdaNm, TAU_R_EXP);

const tauMie = (lambdaNm: number, beta550: number): number =>
  beta550 * Math.pow(LAMBDA_G / lambdaNm, ANGSTROM_ALPHA);

/**
 * Aerosol Angstrom turbidity beta at 550 nm, estimated from visibility (m)
 * and relative humidity (%). Falls back to a clear-air default.
 */
export const aerosolBeta = (visibilityM?: number, rhPct?: number): number => {
  const visKm = visibilityM != null && visibilityM > 0 ? visibilityM / 1000 : 25;
  // Koschmieder-style inversion at 550 nm, minus the Rayleigh contribution.
  const sigmaTotal = 3.912 / visKm;
  const sigmaAer = Math.max(0.02, sigmaTotal - 0.012);
  // Aerosol scale height ~1.2 km gives a column optical depth.
  let beta = sigmaAer * 1.2;
  // Hygroscopic swelling above 80% RH inflates the effective extinction.
  if (rhPct != null && rhPct > 80) beta *= 1 + (rhPct - 80) / 100;
  return Math.max(0.04, Math.min(0.6, beta));
};

/**
 * Linear-light RGB (0..1) of the direct solar beam at the observer along a
 * line of sight at altitude `altDeg`, attenuated by Rayleigh + Mie only.
 */
export const directBeamRGB = (altDeg: number, beta: number): RGB => {
  const m = airMass(altDeg);
  const t = (lambda: number): number =>
    Math.exp(-(tauRayleigh(lambda) + tauMie(lambda, beta)) * m);
  return {
    r: 1.0 * t(LAMBDA_R),
    g: 0.96 * t(LAMBDA_G),
    b: 0.92 * t(LAMBDA_B),
  };
};

/** Geometric horizon depression in degrees for an observer at altitude km. */
export const horizonDepressionDeg = (altKm: number): number =>
  (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(0, altKm))) * 180) /
  Math.PI;

/**
 * Fraction (0..1) of direct sunlight reaching a cloud at altitude
 * `cloudAltKm` when the sun is at altitude `sunAltDeg` as seen from a
 * sea-level observer. Smoothed across the sun's apparent diameter so the
 * transition from "lit" to "in shadow" isn't a binary cliff.
 */
export const cloudIllumination = (sunAltDeg: number, cloudAltKm: number): number => {
  const dip = horizonDepressionDeg(cloudAltKm);
  const sunFromCloud = sunAltDeg + dip;
  if (sunFromCloud >= 0.5) return 1;
  if (sunFromCloud <= -1.5) return 0;
  return (sunFromCloud + 1.5) / 2.0;
};

/**
 * Path-integrated transmittance through low and mid clouds along the sun's
 * azimuth. Distance weights favor the 200-350 km samples because a near-
 * horizon beam grazes the boundary layer at exactly those distances.
 */
export const beamPathTransmittance = (path: CloudData[]): number => {
  if (path.length < 4) return 1;
  const sectors = [
    { lo: path[0].low, mi: path[0].mid, w: 0.1 },
    { lo: path[1].low, mi: path[1].mid, w: 0.2 },
    { lo: path[2].low, mi: path[2].mid, w: 0.35 },
    { lo: path[3].low, mi: path[3].mid, w: 0.35 },
  ];
  let t = 1;
  for (const s of sectors) {
    const blockLow = (s.lo / 100) * s.w;
    const blockMid = (s.mi / 100) * s.w * 0.5;
    t *= 1 - Math.min(0.95, blockLow + blockMid);
  }
  return clamp01(t);
};

export interface SkyStop {
  offset: number;
  color: string;
}

export interface SunsetPrediction {
  /** 0-100 quality estimate. */
  score: number;
  quality: 'Overcast' | 'Muted' | 'Fair' | 'Great' | 'Epic';
  description: string;
  /** Vertical gradient stops. offset=0 is zenith, offset=1 is horizon. */
  skyGradient: SkyStop[];
  highCloudColor: string;
  midCloudColor: string;
  lowCloudColor: string;
  /** Direct-beam color of the sun disk at its current altitude. */
  sunDiskColor: string;
  factors: {
    beamRedness: number;
    pathClarity: number;
    overheadGlow: number;
    overheadOvercast: number;
    aerosolBeta: number;
    illumLow: number;
    illumMid: number;
    illumHigh: number;
  };
}

const NIGHT: RGB = { r: 0.015, g: 0.02, b: 0.06 };
const ZENITH_DAY: RGB = { r: 0.18, g: 0.36, b: 0.62 };
const ZENITH_TWILIGHT: RGB = { r: 0.06, g: 0.09, b: 0.26 };
const OVERCAST: RGB = { r: 0.42, g: 0.44, b: 0.48 };
const SHADOWED_CLOUD: RGB = { r: 0.22, g: 0.24, b: 0.3 };
const NEUTRAL_CLOUD: RGB = { r: 0.55, g: 0.55, b: 0.58 };

export const predictSunset = (
  pathData: CloudPathData[],
  targetTime: Date,
  sunAltDeg: number,
  visibilityM?: number,
  rhPct?: number,
): SunsetPrediction => {
  const beta = aerosolBeta(visibilityM, rhPct);
  const localPath = getInterpolatedWeather(pathData, targetTime);

  // The sun disk itself: use its current line-of-sight altitude.
  const sunDiskBeam = directBeamRGB(Math.max(sunAltDeg, -0.5), beta);
  // The reddened beam that bathes overhead clouds: always evaluated at
  // grazing horizon, since the sun is on or below the geometric horizon
  // when this matters and the high-cloud illumination path is still
  // close to horizontal.
  const horizonBeam = directBeamRGB(0, beta);
  const pathClarity = beamPathTransmittance(localPath);

  const incidentBeam: RGB = {
    r: horizonBeam.r * pathClarity,
    g: horizonBeam.g * pathClarity,
    b: horizonBeam.b * pathClarity,
  };
  const beamRedness =
    incidentBeam.r > 0
      ? Math.max(0, (incidentBeam.r - incidentBeam.g) / Math.max(incidentBeam.r, 0.001))
      : 0;

  const illumLow = cloudIllumination(sunAltDeg, CLOUD_ALT_LOW_KM);
  const illumMid = cloudIllumination(sunAltDeg, CLOUD_ALT_MID_KM);
  const illumHigh = cloudIllumination(sunAltDeg, CLOUD_ALT_HIGH_KM);

  const overheadMid = localPath[0].mid / 100;
  const overheadHigh = localPath[0].high / 100;
  // The actual canvas the reddened beam paints: illuminated mid+high cover.
  const overheadGlow = clamp01(overheadHigh * illumHigh + overheadMid * illumMid * 0.7);
  const overheadOvercast = clamp01(localPath[0].low / 100);

  // --- Score -------------------------------------------------------------
  // Horizon glow band exists whenever the path is clear and the sun is
  // within ~8 of the geometric horizon, even without overhead clouds.
  const horizonProximity = clamp01(1 - Math.abs(sunAltDeg) / 8);
  // Reddened beam x cloud canvas is the main contributor when conditions
  // are favorable.
  const cloudShow = pathClarity * overheadGlow * (0.5 + 0.5 * beamRedness);

  let raw = 25 * pathClarity * horizonProximity + 70 * cloudShow;
  // Thick low cloud directly above the observer kills the view.
  raw *= 1 - 0.85 * overheadOvercast;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // --- Quality label & description --------------------------------------
  let quality: SunsetPrediction['quality'];
  let description: string;
  if (overheadOvercast > 0.7 && pathClarity < 0.35) {
    quality = 'Overcast';
    description =
      '두꺼운 저층운이 머리 위와 광원 방향을 동시에 덮고 있어 노을 자체가 가려질 가능성이 높습니다.';
  } else if (score >= 75) {
    quality = 'Epic';
    description =
      '수평선 방향이 깨끗하고 중·고층운이 적절히 자리해 강렬한 노을이 예상됩니다.';
  } else if (score >= 55) {
    quality = 'Great';
    description =
      '광선 경로가 비교적 맑고 윗하늘에 빛을 받아 줄 구름이 있어 좋은 노을이 예상됩니다.';
  } else if (score >= 30) {
    quality = 'Fair';
    description =
      '평범한 수준. 수평선 부근의 옅은 붉은 띠 정도가 관측될 수 있습니다.';
  } else {
    quality = 'Muted';
    if (pathClarity < 0.35) {
      description =
        '광원 방향의 저·중층운이 빛을 차단해 노을이 거의 보이지 않을 수 있습니다.';
    } else if (overheadGlow < 0.1) {
      description =
        '윗하늘에 빛을 받아 줄 구름이 부족해 색감 없는 옅은 수평선 빛만 보일 것입니다.';
    } else {
      description = '색감이 약한 노을이 예상됩니다.';
    }
  }

  // --- Sky gradient ------------------------------------------------------
  const twilight = clamp01((10 - sunAltDeg) / 16);
  const dayToTwi = mixRgb(ZENITH_DAY, ZENITH_TWILIGHT, twilight);
  const nightT = clamp01((-sunAltDeg - 6) / 6);
  const zenithRGB = mixRgb(dayToTwi, NIGHT, nightT);

  const beamGlow: RGB = {
    r: clamp01(incidentBeam.r * 1.6 + 0.05),
    g: clamp01(incidentBeam.g * 1.6 + 0.02),
    b: clamp01(incidentBeam.b * 1.6),
  };
  const horizonBlendT = clamp01(pathClarity * (0.6 + 0.4 * horizonProximity));
  let horizonRGB = mixRgb(zenithRGB, beamGlow, horizonBlendT);
  if (sunAltDeg < -6) horizonRGB = mixRgb(horizonRGB, NIGHT, nightT * 0.6);

  // Mid-altitude band: where overhead clouds catch the reddened beam.
  const midBandRGB = mixRgb(
    zenithRGB,
    beamGlow,
    clamp01(overheadGlow * pathClarity * 0.9),
  );

  const overcastBlend = overheadOvercast * 0.7;
  const muted = (c: RGB) => mixRgb(c, OVERCAST, overcastBlend);

  const skyGradient: SkyStop[] = [
    { offset: 0, color: rgbToCss(muted(zenithRGB)) },
    {
      offset: 0.5,
      color: rgbToCss(muted(mixRgb(zenithRGB, midBandRGB, 0.7))),
    },
    { offset: 0.82, color: rgbToCss(muted(midBandRGB)) },
    { offset: 1, color: rgbToCss(muted(horizonRGB)) },
  ];

  // --- Cloud tints -------------------------------------------------------
  const litColor = (illum: number, baseLit: number): RGB => {
    const target = mixRgb(NEUTRAL_CLOUD, beamGlow, baseLit);
    return mixRgb(SHADOWED_CLOUD, target, illum * (0.4 + 0.6 * pathClarity));
  };
  const highCloudRGB = litColor(illumHigh, 1.0);
  const midCloudRGB = litColor(illumMid, 0.85);
  const lowCloudRGB = mixRgb(
    SHADOWED_CLOUD,
    beamGlow,
    illumLow * pathClarity * 0.35,
  );

  return {
    score,
    quality,
    description,
    skyGradient,
    highCloudColor: rgbToCssAlpha(highCloudRGB, 0.6),
    midCloudColor: rgbToCssAlpha(midCloudRGB, 0.55),
    lowCloudColor: rgbToCssAlpha(lowCloudRGB, 0.65),
    sunDiskColor: rgbToCss({
      r: clamp01(sunDiskBeam.r * 1.2),
      g: clamp01(sunDiskBeam.g * 1.2),
      b: clamp01(sunDiskBeam.b * 1.2),
    }),
    factors: {
      beamRedness,
      pathClarity,
      overheadGlow,
      overheadOvercast,
      aerosolBeta: beta,
      illumLow,
      illumMid,
      illumHigh,
    },
  };
};
