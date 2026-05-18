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

/** Sæmundsson 1986 atmospheric refraction correction. */
export const getApparentAltitude = (altDeg: number): number => {
  if (altDeg <= -6.0) return altDeg;
  const safeAlt = Math.max(altDeg, -4.2);
  const tanArg = ((safeAlt + 10.3 / (safeAlt + 5.11)) * Math.PI) / 180;
  const R_arcmin = 1.02 / Math.tan(tanArg);
  const R_deg = R_arcmin / 60.0;

  // Smoothly fade refraction effect to zero between -4.2 and -6.0 degrees to prevent discontinuity
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
 * attenuated by Rayleigh + Mie scattering, altitude-based air density scale, and ozone absorption.
 */
export const directBeamRGB = (
  altDeg: number,
  observerElevationM: number = 0,
  latitude: number = 37.5665,
  aerosolBetaVal?: number
): RGB => {
  if (isNaN(altDeg)) return NIGHT;

  // 1) Apply Sæmundsson atmospheric refraction
  const apparentAlt = getApparentAltitude(altDeg);
  const altRad = (apparentAlt * Math.PI) / 180;
  const sinAlt = Math.max(Math.sin(altRad), 0.015);

  // 2) Kasten-Young airmass calculation
  const safeAltForAirMass = Math.max(apparentAlt, -3.8);
  const airMassVal = 1.0 / (sinAlt + 0.15 * Math.pow(safeAltForAirMass + 3.885, -1.253));

  // 3) Altitude-based density scale (Rayleigh scale height ~8km)
  const altScale = Math.exp(-Math.max(0, observerElevationM) / 8000.0);
  const effectiveAirMass = airMassVal * altScale;

  // 4) Latitude-dependent Ozone layer thickness (Dobson Units)
  const latRad = (latitude * Math.PI) / 180;
  const ozoneDu = 300.0 + 80.0 * Math.pow(Math.sin(latRad), 2);
  
  // Ozone center layer altitude is ~22km, use high-altitude ozone airmass formula
  const r_ozone = 22.0 / EARTH_RADIUS_KM;
  const ozoneAirMass = (1.0 + r_ozone) / Math.sqrt(Math.max(0.001, Math.sin(altRad) * Math.sin(altRad) + 2.0 * r_ozone));

  // Chappuis band ozone absorption coefficients for R, G, B channels
  const ozoneTrans = {
    r: Math.exp(-0.015 * (ozoneDu / 300.0) * ozoneAirMass),
    g: Math.exp(-0.030 * (ozoneDu / 300.0) * ozoneAirMass),
    b: Math.exp(-0.002 * (ozoneDu / 300.0) * ozoneAirMass),
  };

  // 5) Scattering coefficients (Rayleigh + Mie) combined with Ozone absorption
  const rayleigh = {
    r: Math.exp(-0.07 * effectiveAirMass) * ozoneTrans.r,
    g: Math.exp(-0.18 * effectiveAirMass) * ozoneTrans.g,
    b: Math.exp(-0.38 * effectiveAirMass) * ozoneTrans.b,
  };

  // Use dynamic aerosol Angstrom turbidity beta for Mie scattering
  const beta = aerosolBetaVal ?? 0.08;
  const mie = Math.exp(-beta * effectiveAirMass);

  // Perceived intensity boost for sunset reds, dynamically scaled by aerosol beta
  // Clean atmosphere (low beta) has extremely mild red boost, dusty/humid has strong red dispersion
  const betaFactor = clamp01((beta - 0.04) / 0.25);
  const redBoost = apparentAlt < 10 && apparentAlt > -6 
    ? 1.0 + Math.pow(Math.max(0, 10 - apparentAlt), 1.25) * (0.01 + betaFactor * 0.06) 
    : 1.0;

  // Darken everything as the sun goes below horizon to simulate twilight fade
  const nightFade = apparentAlt < 0 ? Math.exp(apparentAlt / 2.5) : 1.0;

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
export const beamPathTransmittance = (path: CloudData[], sunAltDeg: number = 0.5): number => {
  if (!path || path.length < 4) return 1;

  // 1) Sæmundsson atmospheric refraction correction
  const apparentAlt = getApparentAltitude(sunAltDeg);
  const apparentAltRad = (apparentAlt * Math.PI) / 180;

  // path[0]: 0km, path[1]: 80km, path[2]: 200km, path[3]: 350km
  const distances = [0, 80, 200, 350];
  const weights = [0.1, 0.2, 0.35, 0.35];

  let totalOpticalDepth = 0;

  for (let i = 0; i < path.length; i++) {
    const x = distances[i];
    const s = path[i];
    const w = weights[i];

    // Calculate actual ray altitude considering Earth's curvature (km)
    // H(x) = x * tan(apparentAlt) + x^2 / (2 * R_E)
    const hRay = x * Math.tan(apparentAltRad) + (x * x) / (2 * EARTH_RADIUS_KM);

    if (hRay < 0) {
      // Ray dips below horizon -> completely blocked
      totalOpticalDepth += 5.0 * w;
      continue;
    }

    // Determine matching cloud layers (low/mid/high) with soft transitions
    let wLow = 0;
    let wMid = 0;
    let wHigh = 0;

    if (hRay <= 2.0) {
      if (hRay > 1.5) {
        const t = (hRay - 1.5) / 0.5;
        wLow = 1.0 - t;
        wMid = t;
      } else {
        wLow = 1.0;
      }
    } else if (hRay <= 6.0) {
      if (hRay < 2.5) {
        const t = (hRay - 2.0) / 0.5;
        wLow = 1.0 - t;
        wMid = t;
      } else if (hRay > 5.0) {
        const t = (hRay - 5.0) / 1.0;
        wMid = 1.0 - t;
        wHigh = t;
      } else {
        wMid = 1.0;
      }
    } else if (hRay <= 12.0) {
      if (hRay < 7.0) {
        const t = (hRay - 6.0) / 1.0;
        wMid = 1.0 - t;
        wHigh = t;
      } else {
        wHigh = 1.0;
      }
    } else {
      wHigh = 0;
    }

    // Layer-specific extinction coefficients (low clouds are highly opaque, high clouds are thin)
    const extLow = 4.0;
    const extMid = 2.0;
    const extHigh = 0.5;

    // Convert cloud cover percentages (0..100) to fractions (0..1)
    const cLow = s.low / 100;
    const cMid = s.mid / 100;
    const cHigh = s.high / 100;

    // Accumulate optical depth: cloud fraction * extinction * path weight
    const sectorExtinction = extLow * cLow * wLow + extMid * cMid * wMid + extHigh * cHigh * wHigh;
    const tau = sectorExtinction * w;
    totalOpticalDepth += tau;
  }

  // Beer-Lambert Law: T = exp(-totalOpticalDepth)
  const transmittance = Math.exp(-totalOpticalDepth);
  return clamp01(transmittance);
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
  latitude?: number,
  observerElevationM?: number,
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
  const latVal = latitude ?? 37.5665;
  const elevVal = observerElevationM ?? 0;

  const dip = getHorizonDip(elevVal);
  const apparentAlt = getApparentAltitude(sunAltDeg);
  const effectiveSunAlt = apparentAlt + dip;

  const beta = aerosolBeta(visibilityM, rhPct);
  const localPath = getInterpolatedWeather(pathData, targetTime);
  // Sunset mode should only apply when sun is near or just below horizon
  const isSunsetMode = effectiveSunAlt < 10 && effectiveSunAlt > -6;

  // Pass dynamically computed aerosol beta to directBeamRGB!
  const currentBeam = directBeamRGB(sunAltDeg, elevVal, latVal, beta);
  const pathClarity = beamPathTransmittance(localPath, sunAltDeg);

  // Remove artificial 1.2x boost on incident beam red channel, make it clean and physical
  const incidentBeam: RGB = {
    r: currentBeam.r * pathClarity,
    g: currentBeam.g * pathClarity,
    b: currentBeam.b * pathClarity,
  };
  const beamRedness =
    incidentBeam.r > 0
      ? Math.max(0, (incidentBeam.r - incidentBeam.g) / Math.max(incidentBeam.r, 0.001))
      : 0;

  const illumLow = cloudIllumination(effectiveSunAlt, CLOUD_ALT_LOW_KM);
  const illumMid = cloudIllumination(effectiveSunAlt, CLOUD_ALT_MID_KM);
  const illumHigh = cloudIllumination(effectiveSunAlt, CLOUD_ALT_HIGH_KM);

  const overheadMid = localPath[0].mid / 100;
  const overheadHigh = localPath[0].high / 100;
  // The actual canvas the reddened beam paints: illuminated mid+high cover.
  const overheadGlow = clamp01(overheadHigh * illumHigh + overheadMid * illumMid * 0.7);
  const overheadOvercast = clamp01(localPath[0].low / 100);

  // --- Horizon Blockage Detection ---
  // If the sun is low (effectiveSunAlt < 3.0) and there is thick cloud cover along the low-altitude horizon beam path
  // leading to extremely low transmittance (pathClarity < 0.15), the sun will be completely blocked.
  const isHorizonBlocked =
    effectiveSunAlt < 3.0 &&
    pathClarity < 0.15 &&
    (localPath[0].low > 40 || localPath[1].low > 40 || localPath[2].mid > 40);

  // --- Score -------------------------------------------------------------
  // Horizon glow band exists whenever the path is clear and the sun is
  // within ~8 of the geometric horizon, even without overhead clouds.
  const horizonProximity = clamp01(1 - Math.abs(effectiveSunAlt) / 8);
  // Reddened beam x cloud canvas is the main contributor when conditions
  // are favorable.
  const cloudShow = pathClarity * overheadGlow * (0.5 + 0.5 * beamRedness);

  let raw = 25 * pathClarity * horizonProximity + 70 * cloudShow;
  // Thick low cloud directly above the observer kills the view.
  raw *= 1 - 0.85 * overheadOvercast;

  // Strongly penalize score if horizon is blocked by thick clouds
  if (isHorizonBlocked) {
    raw *= 0.3;
  }

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // --- Quality label & description --------------------------------------
  let quality: SunsetPrediction['quality'];
  let description: string;
  if (isHorizonBlocked) {
    quality = 'Muted';
    description =
      '일몰 방향 수평선 부근에 두꺼운 구름 장벽이 깔려 있어, 해가 구름에 완전히 가려져 노을을 보기 어렵습니다.';
  } else if (overheadOvercast > 0.7 && pathClarity < 0.35) {
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
  const sunWeight = clamp01((effectiveSunAlt + 1) / 9); 
  // twilightWeight: Mixes in twilight purple/blue as sun dips below horizon
  const twilightWeight = clamp01(1 - (effectiveSunAlt + 6) / 10);

  // Dynamic sky base colors
  const skyZenith = mixRgb(
    mixRgb(ZENITH_TWILIGHT, NIGHT, clamp01(-effectiveSunAlt / 12)),
    ZENITH_DAY,
    sunWeight
  );

  const muted = (c: RGB): RGB => {
    // At night (sunWeight -> 0), the sky shouldn't turn gray even if overcast
    const overcastWeight = overheadOvercast * 0.7 * sunWeight;
    return mixRgb(c, OVERCAST, overcastWeight);
  };

  // 4. Horizon & Sky Gradients - Dynamically computed based on aerosol beta
  // Clear day (low beta) has natural orange-yellow gradients; dusty day (high beta) has deep red gradients
  const redMult = 1.04 + clamp01(beta * 1.1) * 0.36; // Scales between ~1.08 to 1.45 based on atmospheric haze
  const greenMult = 1.01 + clamp01(beta * 0.8) * 0.24; // Scales between ~1.04 to 1.25
  const sunsetOffsetR = isSunsetMode ? (0.04 + clamp01(beta * 0.7) * 0.2) * sunWeight : 0;
  const sunsetOffsetG = isSunsetMode ? (0.01 + clamp01(beta * 0.4) * 0.08) * sunWeight : 0;

  const horizonRGB: RGB = {
    r: clamp01(currentBeam.r * redMult + sunsetOffsetR),
    g: clamp01(currentBeam.g * greenMult + sunsetOffsetG),
    b: clamp01(currentBeam.b * 1.04),
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
  const glowVisibility = pathClarity * clamp01(1 - Math.abs(effectiveSunAlt + 1) / 20);
  
  for (const offset of glowSamples) {
    // Map offset to scattering angle. Inner halo is much tighter.
    const theta = (offset * 30 * Math.PI) / 180;
    const phase = henyeyGreenstein(Math.cos(theta), g);
    
    // Multi-stage glow based dynamically on aerosol beta
    const coreBoost = isSunsetMode ? 1.3 : 1.15;
    const vibrancy = isSunsetMode ? 1.15 : 1.0;
    
    // Clean atmosphere = golden/yellow glow; hazy atmosphere = wider red/orange glow
    const glowRedFactor = 1.1 + clamp01(beta * 1.8) * 0.9;   // ~1.18 to 2.0 based on haze
    const glowGreenFactor = 1.0 + clamp01(beta * 1.1) * 0.5; // ~1.05 to 1.5

    const glowRGB: RGB = {
      r: clamp01(currentBeam.r * coreBoost * glowRedFactor * vibrancy),
      g: clamp01(currentBeam.g * coreBoost * glowGreenFactor),
      b: clamp01(currentBeam.b * coreBoost * 1.08),
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
  // Extracted cloud cover proportions (0.0 ~ 1.0)
  const coverLow = (localPath[0]?.low ?? 0) / 100;
  const coverMid = (localPath[0]?.mid ?? 0) / 100;
  const coverHigh = (localPath[0]?.high ?? 0) / 100;

  // Cloud Optical Thickness (tau) modeled realistically based on altitude layer
  const tauLow = 0.5 + 11.5 * coverLow;   // Thick low-layer clouds (up to 12.0)
  const tauMid = 0.3 + 3.7 * coverMid;    // Medium thickness mid-layer clouds (up to 4.0)
  const tauHigh = 0.1 + 1.4 * coverHigh;  // Thin high-layer clouds (up to 1.5)

  const ambientSky = muted(skyZenith);

  const physicalCloudColor = (
    illum: number,
    tau: number,
    baseAlbedo: number
  ): RGB => {
    // Light transmission inside the cloud layer using Beer-Lambert Law
    const tInternal = Math.exp(-tau * 0.25);
    
    // Direct beam scattered component
    const directScatter: RGB = {
      r: incidentBeam.r * tInternal * baseAlbedo,
      g: incidentBeam.g * tInternal * baseAlbedo,
      b: incidentBeam.b * tInternal * baseAlbedo,
    };

    // Shadowed component incorporating red horizon bounce and blue sky ambient
    // This synthesizes the beautiful deep purple/magenta colors of shadowed twilight clouds
    const ambientInfluence = clamp01(1.0 - tInternal);
    const purpleGlow: RGB = {
      r: lerp(SHADOWED_CLOUD.r, horizonRGB.r * 0.28, ambientInfluence),
      g: lerp(SHADOWED_CLOUD.g, horizonRGB.g * 0.15, ambientInfluence),
      b: lerp(SHADOWED_CLOUD.b, ambientSky.b * 0.45, ambientInfluence),
    };

    // Interpolate direct scattering and shadowed color by cloud illumination
    const mixedCloud = mixRgb(purpleGlow, directScatter, illum);

    // Fade to night as twilight settles
    return mixRgb(NIGHT, mixedCloud, sunWeight * 0.85 + 0.15);
  };

  const highCloudRGB = physicalCloudColor(illumHigh, tauHigh, 0.95);
  const midCloudRGB = physicalCloudColor(illumMid, tauMid, 0.8);
  const lowCloudRGB = physicalCloudColor(illumLow, tauLow, 0.55);

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
      // Dynamically scaled sun disk color based on beta, avoiding extreme pitch-red
      r: clamp01(currentBeam.r * (2.2 + clamp01(beta * 1.5) * 2.0) + (isSunsetMode ? (0.05 + clamp01(beta) * 0.2) : 0)),
      g: clamp01(currentBeam.g * (1.8 + clamp01(beta * 1.0) * 1.0) + (isSunsetMode ? 0.02 : 0)),
      b: clamp01(currentBeam.b * 1.5),
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
