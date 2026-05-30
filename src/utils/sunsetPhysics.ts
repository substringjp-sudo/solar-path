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
  const airMassVal = 1.0 / (sinAlt + 0.15 * Math.pow(Math.max(0.001, safeAltForAirMass + 3.885), -1.253));

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
  if (!path || path.length === 0) return 1;

  // Filter central ray for transmittance calculation (azimuthOffset === 0)
  const centralPath = path.filter(p => p.azimuthOffset === 0);
  // Sort central path by distance to ensure [0, 80, 200, 350] order
  const activePath = (centralPath.length > 0 ? centralPath : path).sort((a, b) => a.distance - b.distance);

  // 1) Sæmundsson atmospheric refraction correction
  const apparentAlt = getApparentAltitude(sunAltDeg);
  const apparentAltRad = (apparentAlt * Math.PI) / 180;

  // We map the active path elements to distances
  const distances = activePath.map(p => p.distance);
  // Dynamic weights based on distance
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

    // Calculate actual ray altitude considering Earth's curvature (km)
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

    // Scale extinction coefficients by totalColumnWaterVapour if available (physical thickness scaling)
    const waterDensity = s.totalColumnWaterVapour ?? 15.0; // default nominal value in kg/m2
    const waterMultiplier = Math.max(0.6, Math.min(2.5, waterDensity / 20.0)); // scale factor

    // Layer-specific extinction coefficients (low clouds are highly opaque, high clouds are thin)
    const extLow = 4.0 * waterMultiplier;
    const extMid = 2.0 * waterMultiplier;
    const extHigh = 0.5 * waterMultiplier;

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
    dynamicHaloScale: number;
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

/**
 * Calculates physically-based sky color using Rayleigh scattering, Mie scattering,
 * atmospheric refraction, and chromatic aberration (color dispersion).
 */
export const calculateRefractedSkyColor = (
  theta: number,
  gamma: number,
  sunAlt: number,
  beta: number,
  pathClarity: number,
  observerElevationM: number = 0,
  latitude: number = 37.5665
): RGB => {
  // Sky brightness factor based on sun altitude (twilight/night transitions)
  // Decays exponentially as the sun dips below the horizon
  let sunBrightness = 1.0;
  if (sunAlt < 2) {
    const t = clamp01((sunAlt + 6) / 8); // 0 at -6 deg, 1 at 2 deg
    sunBrightness = lerp(0.02, 1.0, t * t);
    if (sunAlt < -6) {
      const tNight = clamp01((-sunAlt - 6) / 10); // 0 at -6, 1 at -16
      sunBrightness = lerp(0.02, 0.0, tNight);
    }
  }

  // Chromatic dispersion (color separation/aberration near the horizon)
  // The atmosphere refracts shorter wavelengths (blue) more than longer (red)
  const refractBase = 0.35 / (Math.tan((theta + 1.2) * Math.PI / 180) + 0.08); // in degrees
  
  // Wavelength-specific elevation shifts (aberration)
  const thetaR = Math.max(0.01, theta - refractBase * 0.12);
  const thetaG = Math.max(0.01, theta);
  const thetaB = Math.max(0.01, theta + refractBase * 0.12);

  // Phase functions based on the scattering phase angle (gamma)
  const cosGamma = Math.cos((gamma * Math.PI) / 180);
  
  // 1. Rayleigh Phase Function: 3 / (16 * PI) * (1 + cos^2(gamma))
  const rayleighPhase = 0.05968 * (1.0 + cosGamma * cosGamma);

  // 2. Mie Phase Function (Henyey-Greenstein model for aerosol forward scattering)
  // g represents the aerosol asymmetry factor. 0.78 is a standard value for rural/continental aerosols
  const g = 0.78;
  const g2 = g * g;
  const miePhase = 0.07957 * (1.0 - g2) / Math.pow(1.0 + g2 - 2.0 * g * cosGamma, 1.5);

  const getChannelColor = (th: number, channel: 'r' | 'g' | 'b'): number => {
    const m = airMass(th);
    
    // Evaluate sunLight at Rayleigh/Mie/Horizon specific effective altitudes
    // Rayleigh scale height is ~8km -> horizon dip is 2.8°, average scattering altitude is ~12km
    const sunLightRayleigh = directBeamRGB(Math.max(sunAlt + 2.8, -2.0), 12000, latitude, beta);
    // Mie scale height is ~1.2km -> horizon dip is 1.1°, average scattering altitude is ~2.5km
    const sunLightMie = directBeamRGB(Math.max(sunAlt + 1.1, -1.5), 2500, latitude, beta);
    // Horizon is observer level
    const sunLightHorizon = directBeamRGB(Math.max(sunAlt, -0.5), observerElevationM, latitude, beta);

    // Rayleigh Scattering (dominant at high elevations, scatters blue most)
    // Multiplied by sunLight color to reflect dynamic sunset reddening and Rayleigh phase
    // Unified transmittance (Rayleigh + Mie extinction along the path to the observer)
    const transmit = Math.exp(-(0.055 + beta) * m);
    const rayleighStrength = transmit * rayleighPhase;
    let rayleigh = 0;
    if (channel === 'r') rayleigh = sunLightRayleigh.r * 0.18 * rayleighStrength;
    if (channel === 'g') rayleigh = sunLightRayleigh.g * 0.42 * rayleighStrength;
    if (channel === 'b') rayleigh = sunLightRayleigh.b * 0.85 * rayleighStrength;

    // Mie Scattering (forward scattering by aerosols, white/gray glare)
    // Strongly dependent on the phase angle (gamma) and aerosol beta coefficient
    // Evaluated with unified transmittance and path airmass m
    const mieStrength = 0.14 * m * beta * miePhase * transmit;
    let mie = 0;
    if (channel === 'r') mie = sunLightMie.r * mieStrength;
    if (channel === 'g') mie = sunLightMie.g * mieStrength;
    if (channel === 'b') mie = sunLightMie.b * mieStrength;

    // Horizon Extinction & Reddened Scatter (near the horizon, blue/green are blocked)
    const horizonWeight = Math.exp(-0.35 * th);
    // 대낮에도 수평선 부근이 맑고 뽀얀 연청색을 유지하도록 0.32 하한선 적용
    const sunLowFactor = Math.max(0.32, clamp01((15.0 - sunAlt) / 15.0));
    const horizonStrength = horizonWeight * pathClarity * 2.2 * sunLowFactor;
    let horizon = 0;
    if (channel === 'r') horizon = sunLightHorizon.r * horizonStrength;
    if (channel === 'g') horizon = sunLightHorizon.g * horizonStrength * 0.42;
    if (channel === 'b') horizon = sunLightHorizon.b * horizonStrength * 0.05;

    // Apply exposure multiplier (12.0) and Rayleigh weight (2.2) to match AGSL shader
    return (rayleigh * 2.2 + mie + horizon) * 12.0;
  };

  const ambientNight = { r: 0.003, g: 0.003, b: 0.010 };
  
  // Sky brightness multiplier based on sun altitude to prevent dark skies in the afternoon
  const dayMultiplier = 1.0 + 1.25 * Math.pow(clamp01(sunAlt / 40), 0.3);

  // skyRGB(getChannelColor 결과)는 이미 nightFade와 물리적 산란량이 적용되어 있으므로 sunBrightness의 이중 감쇠를 적용하지 않습니다.
  let finalR = getChannelColor(thetaR, 'r') * dayMultiplier + 0.015 * sunBrightness * dayMultiplier + ambientNight.r * (1 - sunBrightness);
  let finalG = getChannelColor(thetaG, 'g') * dayMultiplier + 0.055 * sunBrightness * dayMultiplier + ambientNight.g * (1 - sunBrightness);
  let finalB = getChannelColor(thetaB, 'b') * dayMultiplier + 0.115 * sunBrightness * dayMultiplier + ambientNight.b * (1 - sunBrightness);

  // Apply fine dust graying/whitening to the blue sky dome in high aerosol conditions
  const dustLevel = clamp01((beta - 0.04) / 0.46);
  const dustySkyColor = { r: 0.48, g: 0.45, b: 0.40 };
  finalR = lerp(finalR, dustySkyColor.r, dustLevel * 0.45 * sunBrightness);
  finalG = lerp(finalG, dustySkyColor.g, dustLevel * 0.45 * sunBrightness);
  finalB = lerp(finalB, dustySkyColor.b, dustLevel * 0.45 * sunBrightness);

  return {
    r: finalR,
    g: finalG,
    b: finalB
  };
};

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
      description: 'Unable to predict due to invalid data.',
      skyGradient: [
        { offset: 0, color: '#08101e' },
        { offset: 1, color: '#08101e' },
      ],
      sunGlowStops: [],
      highCloudColor: 'transparent',
      midCloudColor: 'transparent',
      lowCloudColor: 'transparent',
      sunDiskColor: 'transparent',
      factors: { beamRedness: 0, pathClarity: 0, overheadGlow: 0, overheadOvercast: 0, aerosolBeta: 0, dynamicHaloScale: 1.0, illumLow: 0, illumMid: 0, illumHigh: 0 }
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
  
  // The reddened beam that bathes overhead clouds:
  // - If sun is above horizon (alt > 0°), use its actual altitude (direct beam)
  // - If sun is below horizon (alt <= 0°), evaluate at grazing horizon (0°)
  //   since the beam comes from that geometry and scattered light dominates
  const horizonBeam = directBeamRGB(Math.max(sunAltDeg, 0), elevVal, latVal, beta);
  
  const pathClarity = beamPathTransmittance(localPath, sunAltDeg);

  // Remove artificial 1.2x boost on incident beam red channel, make it clean and physical
  const incidentBeam: RGB = {
    r: horizonBeam.r * pathClarity,
    g: horizonBeam.g * pathClarity,
    b: horizonBeam.b * pathClarity,
  };
  const beamRedness =
    incidentBeam.r > 0
      ? Math.max(0, (incidentBeam.r - incidentBeam.g) / Math.max(incidentBeam.r, 0.001))
      : 0;

  const illumLow = cloudIllumination(effectiveSunAlt, CLOUD_ALT_LOW_KM);
  const illumMid = cloudIllumination(effectiveSunAlt, CLOUD_ALT_MID_KM);
  const illumHigh = cloudIllumination(effectiveSunAlt, CLOUD_ALT_HIGH_KM);

  // Observer point is always the element at distance === 0
  const obsPoint = localPath.find(p => p.distance === 0) ?? localPath[0];
  const centralPath = localPath.filter(p => p.azimuthOffset === 0).sort((a, b) => a.distance - b.distance);
  const centerPoint = centralPath[1] ?? obsPoint; // next point along central path (e.g. 80km)

  const lowVal = obsPoint.low / 100;
  const midVal = obsPoint.mid / 100;
  const highVal = obsPoint.high / 100;
  
  // 1) Weighted layer combinations (higher weights for low/mid clouds)
  const cloudWeight = clamp01(lowVal * 0.95 + midVal * 0.55 + highVal * 0.25);
  
  // 2) Integrated Water column density factor (using Precipitable Water Vapour)
  // Water vapour exists even on clear days, so we must scale it by active cloud presence to prevent false overcast.
  const liquidWater = obsPoint.totalColumnWaterVapour ?? 0;
  const cloudPresence = clamp01(cloudWeight * 3.0); // Suppress water factor if there are no clouds
  const waterFactor = clamp01(liquidWater / 35.0) * cloudPresence;
  
  // 3) Precipitation factor (strongly forces overcast)
  const precip = obsPoint.precipitation ?? 0;
  const precipFactor = precip > 0.1 ? 1.0 : precip * 10;
  
  // 4) Direct Normal Irradiance (DNI) attenuation factor
  const dni = obsPoint.directNormalIrradiance;
  let dniBlockFactor = 0;
  if (dni !== undefined && sunAltDeg > 1.5) {
    const maxDniTheory = Math.max(80, 950 * Math.sin((Math.max(1.5, sunAltDeg) * Math.PI) / 180));
    dniBlockFactor = clamp01(1.0 - (dni / maxDniTheory));
  } else if (dni !== undefined && sunAltDeg <= 1.5 && sunAltDeg > -2.0) {
    dniBlockFactor = dni < 15 ? 1.0 : clamp01(1.0 - (dni / 80));
  }

  // Combined Overcast Metric for backdrop darkening/slate gray shading
  const overheadOvercast = clamp01(
    Math.max(cloudWeight, waterFactor, precipFactor, dniBlockFactor)
  );

  // The actual canvas the reddened beam paints: illuminated mid+high cover.
  const overheadGlow = clamp01(highVal * illumHigh + midVal * illumMid * 0.7);

  // --- Horizon Blockage Detection ---
  const isHorizonBlocked =
    effectiveSunAlt < 3.0 &&
    pathClarity < 0.15 &&
    (obsPoint.low > 40 || centerPoint.low > 40);

  // --- Score -------------------------------------------------------------
  const horizonProximity = clamp01(1 - Math.abs(effectiveSunAlt) / 8);
  const cloudShow = pathClarity * overheadGlow * (0.5 + 0.5 * beamRedness);

  let raw = 25 * pathClarity * horizonProximity + 70 * cloudShow;
  // Heavy overcast kills color scattering visibility
  raw *= 1 - 0.85 * overheadOvercast;

  // Strongly penalize score if horizon is blocked by thick clouds
  if (isHorizonBlocked) {
    raw *= 0.3;
  }

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // --- Quality label & description --------------------------------------
  let quality: SunsetPrediction['quality'];
  let description: string;
  
  if (overheadOvercast > 0.82) {
    quality = 'Overcast';
    description = precip > 0 
      ? 'Heavy rain clouds cover the entire sky, completely blocking the sunset light.'
      : 'A thick single layer of clouds covers the sky, completely hiding the sunlight.';
  } else if (isHorizonBlocked) {
    quality = 'Muted';
    description =
      'Thick clouds block the horizon in the sunset direction, making it hard to see the sunset glow.';
  } else if (score >= 75) {
    quality = 'Epic';
    description =
      'Clear horizon combined with mid-to-high clouds suggests an intense, beautiful sunset.';
  } else if (score >= 55) {
    quality = 'Great';
    description =
      'Ample red light is reflecting off the clouds, perfect for viewing a lovely sunset.';
  } else if (score >= 35) {
    quality = 'Fair';
    description = 'Light is weak or there are many clouds, but a subtle sunset glow is visible.';
  } else {
    quality = 'Muted';
    description = 'Lack of scattering or too few clouds might make the sunset look plain.';
  }

  // --- Sky Gradient ------------------------------------------------------
  const sunWeight = clamp01((effectiveSunAlt + 1) / 9); 

  const muted = (c: RGB): RGB => {
    const overcastWeight = overheadOvercast * 0.7 * sunWeight;
    return mixRgb(c, OVERCAST, overcastWeight);
  };

  const horizonRGB = calculateRefractedSkyColor(0.05, 90, sunAltDeg, beta, pathClarity, elevVal, latVal);

  const skyGradient: SkyStop[] = [0, 0.25, 0.5, 0.7, 0.85, 1.0].map(y => {
    // Map y offset to an elevation angle theta in degrees
    // We use a quadratic mapping to cluster more gradient stops near the horizon, extending to 85 deg at the zenith
    const theta = 0.05 + 85 * Math.pow(1.0 - y, 2.0);
    const physicalColor = calculateRefractedSkyColor(theta, 90, sunAltDeg, beta, pathClarity, elevVal, latVal);
    return {
      offset: y,
      color: rgbToCss(muted(physicalColor)),
    };
  });

  // --- Weather Specific Adjustments ----------
  const visM = visibilityM ?? 25000;
  const rhVal = rhPct ?? 50;
  const fogIntensity = clamp01((rhVal - 85) / 15) * clamp01((6000 - Math.max(500, visM)) / 5500);
  const dustIntensity = clamp01((beta - 0.08) / 0.4);

  // Cloud blockage incorporates DNI block, precipitation and high water density
  const cloudBlockIntensity = clamp01(
    Math.max(1.0 - pathClarity, precipFactor, dniBlockFactor, waterFactor * 0.95)
  );

  const dynamicHaloScale = (1.0 + dustIntensity * 0.4 + fogIntensity * 0.75) * Math.max(0.01, 1.0 - cloudBlockIntensity);

  // --- Sun Glow (Mie Scattering Halo) ------------------------------------
  const sunGlowStops: SkyStop[] = [];
  const glowSamples = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1.0];
  
  // Outer halo opacity scales down to near 0 under heavy clouds, fades when sun is deep below horizon
  const glowVisibility = pathClarity * clamp01((sunAltDeg + 6) / 12) * (1.0 - fogIntensity * 0.5) * (1.0 - cloudBlockIntensity * 0.95);
  
  const gValForPhase = 0.78;
  const maxPhase = (1.0 + gValForPhase) / ((1.0 - gValForPhase) * (1.0 - gValForPhase)); // phase at gamma = 0
  
  for (const offset of glowSamples) {
    const gamma = offset * 50; // 0 to 50 degrees spatial sweep from the sun
    const theta = Math.max(0.05, sunAltDeg); // Approximate local elevation near the sun
    
    // Calculate the physical scattering color at this angular distance from the sun
    const physicalColor = calculateRefractedSkyColor(theta, gamma, sunAltDeg, beta, pathClarity, elevVal, latVal);
    
    // Alpha transparency based on Mie phase density (strong forward scattering glare near core)
    const cosGamma = Math.cos((gamma * Math.PI) / 180);
    const phase = (1.0 - gValForPhase * gValForPhase) / Math.pow(1.0 + gValForPhase * gValForPhase - 2.0 * gValForPhase * cosGamma, 1.5);
    const phaseNorm = phase / maxPhase;
    
    const alpha = clamp01(phaseNorm * 0.95 * glowVisibility);
    
    sunGlowStops.push({
      offset,
      color: rgbToCssAlpha(physicalColor, alpha),
    });
  }

  // --- Cloud tints -------------------------------------------------------
  const litColor = (illum: number, baseLit: number, isIce: boolean = false, genus?: string): RGB => {
    // Determine the color of the sunlight hitting the cloud
    let cloudSunlight: RGB;
    if (sunAltDeg > 5) {
      cloudSunlight = { r: 0.98, g: 0.95, b: 0.88 }; // Warm white
    } else {
      const t = clamp01((sunAltDeg + 2) / 7);
      cloudSunlight = mixRgb({ r: 0.98, g: 0.50, b: 0.15 }, { r: 0.98, g: 0.95, b: 0.88 }, t); // Transition to gold/orange
    }
    
    // Ice crystals (Cirrus) refraction / prism coloring effect (vibrant pink/orange-red)
    if (isIce && sunAltDeg <= 4) {
      const tIce = clamp01((sunAltDeg + 4) / 8); // -4 to 4 degrees
      const iceColor = { r: 1.0, g: 0.45, b: 0.65 }; // Prism rose/magenta tint
      cloudSunlight = mixRgb(iceColor, cloudSunlight, tIce);
    }

    const shadowColor = SHADOWED_CLOUD;
    
    // Mix shadow and sunlight based on illumination and pathClarity
    const mixFactor = clamp01(illum * baseLit * (pathClarity * 0.5 + 0.5));
    return mixRgb(shadowColor, cloudSunlight, mixFactor);
  };
  
  const highCloudRGB = litColor(illumHigh, 1.4, true, 'cirrus');
  const midCloudRGB = litColor(illumMid, 1.2, false, 'altocumulus');
  const lowCloudRGB = litColor(illumLow, 0.9, false, 'stratocumulus');

  // Compute realistic sun disk color (bright white/yellow during day, transitions near horizon)
  let sunRGB: RGB;
  if (sunAltDeg > 6) {
    sunRGB = { r: 1.0, g: 0.98, b: 0.92 }; // White-yellow
  } else if (sunAltDeg > 1.5) {
    const t = (sunAltDeg - 1.5) / 4.5;
    sunRGB = mixRgb({ r: 1.0, g: 0.72, b: 0.28 }, { r: 1.0, g: 0.98, b: 0.92 }, t); // Golden orange to white-yellow
  } else if (sunAltDeg > -2) {
    const t = (sunAltDeg + 2) / 3.5;
    sunRGB = mixRgb({ r: 0.96, g: 0.22, b: 0.08 }, { r: 1.0, g: 0.72, b: 0.28 }, t); // Crimson to golden orange
  } else {
    sunRGB = { r: 0.85, g: 0.12, b: 0.05 }; // Crimson below horizon
  }

  // Adjust for path clarity
  const finalSunRGB = mixRgb({ r: 0.96, g: 0.22, b: 0.08 }, sunRGB, clamp01(pathClarity * 0.7 + 0.3));

  // Fully extinguish sun disk alpha when block intensity reaches 0.99
  const sunDiskAlpha = clamp01((1.0 - cloudBlockIntensity * 0.99) * (1.0 - fogIntensity * 0.82));

  return {
    score,
    quality,
    description,
    skyGradient,
    sunGlowStops,
    highCloudColor: rgbToCssAlpha(highCloudRGB, 0.9),
    midCloudColor: rgbToCssAlpha(midCloudRGB, 0.85),
    lowCloudColor: rgbToCssAlpha(lowCloudRGB, 0.9),
    sunDiskColor: rgbToCssAlpha({ r: finalSunRGB.r, g: finalSunRGB.g, b: finalSunRGB.b }, sunDiskAlpha),
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
