/**
 * Physics-based sunset/sunrise prediction.
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
  const h = Math.max(altDeg, -1.5); // Allow slightly below horizon for refraction/dip
  if (h >= 89) return 1;
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(6.07995 + h, -1.6364));
};

/** Henyey-Greenstein phase function for Mie scattering. */
const henyeyGreenstein = (cosTheta: number, g: number): number => {
  const g2 = g * g;
  return (1 - g2) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
};

/** Rayleigh phase function. */
const rayleighPhase = (cosTheta: number): number => {
  return 0.75 * (1 + cosTheta * cosTheta);
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
 * Linear-light RGB (0..1) of the direct solar beam at its current altitude,
 * attenuated by Rayleigh + Mie scattering.
 */
export const directBeamRGB = (altDeg: number): RGB => {
  if (isNaN(altDeg)) return NIGHT;

  const altRad = (altDeg * Math.PI) / 180;
  const sinAlt = Math.max(Math.sin(altRad), 0.015); // Refraction adjustment

  // Air mass calculation (approximate Kasten-Young formula)
  // Clamp altDeg to avoid NaN when base is negative (at altDeg < -3.885)
  const safeAltForAirMass = Math.max(altDeg, -3.8);
  const airMass = 1.0 / (sinAlt + 0.15 * Math.pow(safeAltForAirMass + 3.885, -1.253));

  // Scattering coefficients (Rayleigh + Mie) - Tuned for more vibrant reds
  const rayleigh = {
    r: Math.exp(-0.07 * airMass),
    g: Math.exp(-0.18 * airMass),
    b: Math.exp(-0.38 * airMass),
  };

  const mie = Math.exp(-0.04 * airMass);

  // Perceived intensity boost for sunset reds
  const redBoost = altDeg < 10 && altDeg > -6 
    ? 1.0 + Math.pow(Math.max(0, 10 - altDeg), 1.2) * 0.08 
    : 1.0;

  // Darken everything as the sun goes below horizon to simulate twilight fade
  const nightFade = altDeg < 0 ? Math.exp(altDeg / 2.5) : 1.0;

  return {
    r: clamp01(rayleigh.r * mie * redBoost * nightFade),
    g: clamp01(rayleigh.g * mie * nightFade),
    b: clamp01(rayleigh.b * mie * nightFade),
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
 * Calculates transmittance based on cloud cover sampled at different distances along the sun's 
 * azimuth. Distance weights favor the 200-350 km samples because a near-
 * horizon beam grazes the boundary layer at exactly those distances.
 */
export const beamPathTransmittance = (path: CloudData[]): number => {
  if (!path || path.length < 4) return 1;
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
  /** Radial gradient stops for the sun's aura. */
  sunGlowStops: SkyStop[];
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
  if (isNaN(sunAltDeg)) {
    // Return a safe neutral prediction if input is invalid
    return {
      score: 0,
      quality: 'Muted',
      description: '데이터가 올바르지 않아 예측할 수 없습니다.',
      skyGradient: [
        { offset: 0, color: '#08101e' },
        { offset: 1, color: '#08101e' },
      ],
      sunGlowStops: [],
      highCloudColor: 'transparent',
      midCloudColor: 'transparent',
      lowCloudColor: 'transparent',
      sunDiskColor: 'transparent',
      factors: { beamRedness: 0, pathClarity: 0, overheadGlow: 0, overheadOvercast: 0, aerosolBeta: 0, illumLow: 0, illumMid: 0, illumHigh: 0 }
    };
  }
  const beta = aerosolBeta(visibilityM, rhPct);
  const localPath = getInterpolatedWeather(pathData, targetTime);
  // Sunset mode should only apply when sun is near or just below horizon
  const isSunsetMode = sunAltDeg < 10 && sunAltDeg > -6;

  const currentBeam = directBeamRGB(sunAltDeg);
  const pathClarity = beamPathTransmittance(localPath);

  const incidentBeam: RGB = {
    r: currentBeam.r * pathClarity * 1.2, // Boost red intensity
    g: currentBeam.g * pathClarity,
    b: currentBeam.b * pathClarity,
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
      '충분히 붉은 빛이 구름에 반사되어 아름다운 노을을 감상하기 좋습니다.';
  } else if (score >= 35) {
    quality = 'Fair';
    description = '구름이 다소 많거나 빛이 약하지만 은은한 노을을 볼 수 있습니다.';
  } else {
    quality = 'Muted';
    description = '빛의 산란이 부족하거나 구름이 너무 적어 노을이 밋밋할 수 있습니다.';
  }

  // --- Sky Gradient ------------------------------------------------------
  // sunWeight: 1.0 during day, drops as sun approaches horizon (< 8 deg)
  const sunWeight = clamp01((sunAltDeg + 1) / 9); 
  // twilightWeight: Mixes in twilight purple/blue as sun dips below horizon
  const twilightWeight = clamp01(1 - (sunAltDeg + 6) / 10);

  // Dynamic sky base colors
  const skyZenith = mixRgb(
    mixRgb(ZENITH_TWILIGHT, NIGHT, clamp01(-sunAltDeg / 12)),
    ZENITH_DAY,
    sunWeight
  );

  const muted = (c: RGB): RGB => {
    // At night (sunWeight -> 0), the sky shouldn't turn gray even if overcast
    const overcastWeight = overheadOvercast * 0.7 * sunWeight;
    return mixRgb(c, OVERCAST, overcastWeight);
  };

  // 4. Horizon & Sky Gradients - More vibrant spread
  const horizonRGB: RGB = {
    r: clamp01(currentBeam.r * 1.5 + (isSunsetMode ? 0.3 * sunWeight : 0)),
    g: clamp01(currentBeam.g * 1.3 + (isSunsetMode ? 0.1 * sunWeight : 0)),
    b: clamp01(currentBeam.b * 1.1),
  };

  const midBandRGB = mixRgb(skyZenith, horizonRGB, 0.65);
  const upperMidRGB = mixRgb(skyZenith, midBandRGB, 0.4);

  const skyGradient: SkyStop[] = [
    { offset: 0, color: rgbToCss(muted(skyZenith)) },
    { offset: 0.3, color: rgbToCss(muted(upperMidRGB)) },
    { offset: 0.65, color: rgbToCss(muted(midBandRGB)) },
    { offset: 0.85, color: rgbToCss(muted(mixRgb(midBandRGB, horizonRGB, 0.5))) },
    { offset: 1, color: rgbToCss(muted(horizonRGB)) },
  ];

  // --- Sun Glow (Mie Scattering Halo) ------------------------------------
  const sunGlowStops: SkyStop[] = [];
  const g = 0.88; // Slightly more forward-heavy Mie scattering
  // More samples for a smoother gradient
  const glowSamples = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1.0];
  
  // Boost visibility and add an exponential "core" intensity
  const glowVisibility = pathClarity * clamp01(1 - Math.abs(sunAltDeg + 1) / 20);
  
  for (const offset of glowSamples) {
    // Map offset to scattering angle. Inner halo is much tighter.
    const theta = (offset * 30 * Math.PI) / 180;
    const phase = henyeyGreenstein(Math.cos(theta), g);
    
    // Multi-stage glow for better blending and fire-red edges
    const coreBoost = isSunsetMode ? 1.5 : 1.2;
    const vibrancy = isSunsetMode ? 1.3 : 1.0;

    const glowRGB: RGB = {
      r: clamp01(currentBeam.r * coreBoost * 2.2 * vibrancy),
      g: clamp01(currentBeam.g * coreBoost * 1.6),
      b: clamp01(currentBeam.b * coreBoost * 1.2),
    };

    // Transition from hot center to deep red rim
    const rVal = clamp01(glowRGB.r);
    const gVal = clamp01(glowRGB.g * (1 - offset * 0.8));
    const bVal = clamp01(glowRGB.b * (1 - offset));

    let intensity = (phase / 28) * glowVisibility;
    intensity *= Math.pow(1.0 - offset, 2.0); // Smoother falloff

    // Alpha needs to be high at the center to look like a light source
    const alpha = clamp01(intensity * 1.2);
    sunGlowStops.push({
      offset,
      color: rgbToCssAlpha({ r: rVal, g: gVal, b: bVal }, alpha),
    });
  }

  // --- Cloud tints -------------------------------------------------------
  const litColor = (illum: number, baseLit: number): RGB => {
    const target = mixRgb(NEUTRAL_CLOUD, incidentBeam, baseLit);
    const lit = mixRgb(SHADOWED_CLOUD, target, illum);
    // At night, clouds should fade to the NIGHT color
    return mixRgb(NIGHT, lit, sunWeight * 0.8 + 0.2);
  };

  const highCloudRGB = muted(litColor(illumHigh, 0.9));
  const midCloudRGB = muted(litColor(illumMid, 0.7));
  const lowCloudRGB = muted(litColor(illumLow, 0.3));

  return {
    score,
    quality,
    description,
    skyGradient,
    sunGlowStops,
    highCloudColor: rgbToCssAlpha(highCloudRGB, 0.6),
    midCloudColor: rgbToCssAlpha(midCloudRGB, 0.55),
    lowCloudColor: rgbToCssAlpha(lowCloudRGB, 0.65),
    sunDiskColor: rgbToCss({
      r: clamp01(currentBeam.r * 8.0 + (isSunsetMode ? 0.45 : 0)), // Intense red disk
      g: clamp01(currentBeam.g * 4.0 + (isSunsetMode ? 0.1 : 0)),
      b: clamp01(currentBeam.b * 2.5),
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
