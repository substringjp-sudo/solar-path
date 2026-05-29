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
import { CloudGenus } from '../types/simulation';

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
  
  // Wavelength-dependent extinction
  const t = (lambda: number): number => {
    const tau = tauRayleigh(lambda) + tauMie(lambda, beta);
    return Math.exp(-tau * m);
  };

  const r = t(LAMBDA_R);
  const g = t(LAMBDA_G) * 0.96;
  const b = t(LAMBDA_B) * 0.92;

  // Enhance vibrancy: prevent it from going "gray/black" by adding a 
  // small ambient/scattered component that keeps the color saturated.
  const floor = 0.06; // Keep it bright
  const saturationBoost = clamp01(1 - altDeg / 12);
  
  // Stronger R boost
  const rBoost = 1.0 + saturationBoost * 3.0; 
  
  return {
    r: Math.max(floor, r * rBoost),
    g: Math.max(floor * 0.45, g * (1 - saturationBoost * 0.45)),
    b: Math.max(floor * 0.25, b * (1 - saturationBoost * 0.75)),
  };
};

/**
 * Calculates physically-based sky color using Rayleigh scattering, Mie scattering,
 * atmospheric refraction, and chromatic aberration (color dispersion).
 */
export const calculateRefractedSkyColor = (
  theta: number,
  sunAlt: number,
  beta: number,
  pathClarity: number
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

  const getChannelColor = (th: number, channel: 'r' | 'g' | 'b'): number => {
    const m = airMass(th);
    const sunLight = directBeamRGB(Math.max(sunAlt, -0.5), beta);

    // 1. Rayleigh Scattering (dominant at high elevations, scatters blue most)
    const rayleighStrength = Math.exp(-0.055 * m);
    let rayleigh = 0;
    if (channel === 'r') rayleigh = 0.075 * rayleighStrength;
    if (channel === 'g') rayleigh = 0.185 * rayleighStrength;
    if (channel === 'b') rayleigh = 0.42 * rayleighStrength;

    // 2. Mie Scattering (forward scattering by aerosols, white/gray light)
    // Increases at lower elevations where aerosol layer thickness is large
    const mieStrength = 0.18 * (m - 1) * beta;
    let mie = 0;
    if (channel === 'r') mie = sunLight.r * mieStrength;
    if (channel === 'g') mie = sunLight.g * mieStrength;
    if (channel === 'b') mie = sunLight.b * mieStrength;

    // 3. Horizon Extinction & Reddened Scatter (near the horizon, blue/green are blocked)
    const horizonWeight = Math.exp(-0.35 * th);
    const horizonStrength = horizonWeight * pathClarity * 2.2;
    let horizon = 0;
    if (channel === 'r') horizon = sunLight.r * horizonStrength;
    if (channel === 'g') horizon = sunLight.g * horizonStrength * 0.42;
    if (channel === 'b') horizon = sunLight.b * horizonStrength * 0.05;

    return rayleigh + mie + horizon;
  };

  const ambientNight = { r: 0.003, g: 0.003, b: 0.010 };
  return {
    r: (getChannelColor(thetaR, 'r') + 0.008) * sunBrightness + ambientNight.r * (1 - sunBrightness),
    g: (getChannelColor(thetaG, 'g') + 0.008) * sunBrightness + ambientNight.g * (1 - sunBrightness),
    b: (getChannelColor(thetaB, 'b') + 0.010) * sunBrightness + ambientNight.b * (1 - sunBrightness),
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
export const beamPathTransmittance = (path: CloudData[], sunAltDeg: number): number => {
  if (path.length === 0) return 1;

  // Filter 2D grid points to only calculate transmittance along the central sun direction (azimuthOffset === 0)
  const centerPoints = path.filter(p => {
    const offset = (p as any).azimuthOffset;
    return offset === undefined || offset === 0;
  });

  const activePoints = centerPoints.length > 0 ? centerPoints : path;
  
  const getWeight = (d: number) => {
    if (d <= 10) return 0.1;
    if (d <= 90) return 0.2;
    if (d <= 220) return 0.35;
    return 0.35;
  };

  const altRad = (Math.max(-2, sunAltDeg) * Math.PI) / 180;
  let totalTau = 0;
  let hasClassified = false;

  for (const p of activePoints) {
    if (p.classifiedClouds && p.classifiedClouds.length > 0) {
      hasClassified = true;
      const d = p.distance;
      const w = getWeight(d);

      let H = 0;
      if (d === 0) {
        H = 0;
      } else {
        const dRad = d / EARTH_RADIUS_KM;
        const cosAngle = Math.cos(altRad + dRad);
        if (cosAngle > 0.01) {
          H = EARTH_RADIUS_KM * (Math.cos(altRad) / cosAngle - 1);
        } else {
          H = 999;
        }
      }

      for (const cloud of p.classifiedClouds) {
        if (cloud.genus === 'clear') continue;

        const midAlt = (cloud.baseAltKm + cloud.topAltKm) / 2;
        const thickness = Math.max(0.4, cloud.topAltKm - cloud.baseAltKm);
        const distToCenter = Math.abs(H - midAlt);

        // Soft overlap check
        const range = thickness / 2 + 0.6;
        const overlap = Math.max(0, 1 - distToCenter / range);

        if (overlap > 0) {
          // Beer-Lambert calculation based on estimated optical thickness
          const tau = overlap * (cloud.opticalThickness / 30) * cloud.coverage * w;
          totalTau += tau;
        }
      }
    }
  }

  if (hasClassified) {
    return clamp01(Math.exp(-totalTau));
  }

  // Fallback: Low/Mid/High interpolation logic if pressure level data is missing
  const findPoint = (dTarget: number) => {
    let best = activePoints[0];
    let bestDiff = Math.abs((best?.distance ?? 0) - dTarget);
    for (const p of activePoints) {
      const diff = Math.abs(p.distance - dTarget);
      if (diff < bestDiff) {
        best = p;
        bestDiff = diff;
      }
    }
    return best;
  };

  const p0 = findPoint(0);
  const p80 = findPoint(80);
  const p200 = findPoint(200);
  const p350 = findPoint(350);

  const sectors = [
    { lo: p0.low, mi: p0.mid, hi: p0.high, d: 0, w: 0.1 },
    { lo: p80.low, mi: p80.mid, hi: p80.high, d: 80, w: 0.2 },
    { lo: p200.low, mi: p200.mid, hi: p200.high, d: 200, w: 0.35 },
    { lo: p350.low, mi: p350.mid, hi: p350.high, d: 350, w: 0.35 },
  ];

  let t = 1;
  for (const s of sectors) {
    const dRad = s.d / EARTH_RADIUS_KM;
    let H = 0;
    if (s.d === 0) {
      H = 0;
    } else {
      const cosAngle = Math.cos(altRad + dRad);
      if (cosAngle > 0.01) {
        H = EARTH_RADIUS_KM * (Math.cos(altRad) / cosAngle - 1);
      } else {
        H = 999;
      }
    }

    const overlapLow = H <= 2 ? Math.max(0, 1 - Math.abs(H - 1.0) / 1.0) : 0;
    const overlapMid = H >= 2 && H <= 6 ? Math.max(0, 1 - Math.abs(H - 4.0) / 2.0) : 0;
    const overlapHigh = H >= 6 && H <= 12 ? Math.max(0, 1 - Math.abs(H - 9.0) / 3.0) : 0;

    const blockLow = (s.lo / 100) * s.w * overlapLow;
    const blockMid = (s.mi / 100) * s.w * 0.5 * overlapMid;
    const blockHigh = (s.hi / 100) * s.w * 0.2 * overlapHigh;
    
    t *= 1 - Math.min(0.95, blockLow + blockMid + blockHigh);
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

const NIGHT: RGB = { r: 0.005, g: 0.005, b: 0.015 };
const ZENITH_DAY: RGB = { r: 0.18, g: 0.36, b: 0.62 };
const ZENITH_TWILIGHT: RGB = { r: 0.08, g: 0.12, b: 0.28 }; // More blue, less black
const OVERCAST: RGB = { r: 0.42, g: 0.44, b: 0.48 };
const SHADOWED_CLOUD: RGB = { r: 0.18, g: 0.20, b: 0.28 };
const NEUTRAL_CLOUD: RGB = { r: 0.55, g: 0.55, b: 0.58 };

import { getSunPosition } from './celestial';

export const getSunPositionInSim = (date: Date, lat: number, lon: number) => {
  return getSunPosition(date, lat, lon);
};

export const getSunsetColors = (sunAltDeg: number): string[] => {
  // Simple color model based on altitude
  const t = clamp01((sunAltDeg + 6) / 20); // -6 to 14 degrees
  
  if (sunAltDeg > 10) {
    return ['#4A90E2', '#87CEEB', '#B0E2FF', '#E0F7FF']; // Bright day
  } else if (sunAltDeg > 2) {
    return ['#2C3E50', '#4A90E2', '#FFD700', '#FFFACD']; // Golden hour
  } else if (sunAltDeg > -2) {
    return ['#1A237E', '#4A148C', '#FF4500', '#FF8C00']; // Sunset
  } else if (sunAltDeg > -6) {
    return ['#0D1117', '#1A237E', '#4A148C', '#880E4F']; // Twilight
  } else {
    return ['#050508', '#0D1117', '#1A1A2E', '#16213E']; // Night
  }
};

export const getSunsetPrediction = (
  pathData: CloudPathData[],
  targetTime: Date,
  offset: number,
  lat: number,
  lon: number,
): SunsetPrediction => {
  const { altitude } = getSunPosition(targetTime, lat, lon);
  const sunAltDeg = altitude + offset;

  const localPath = getInterpolatedWeather(pathData, targetTime);
  // Extract visibility and humidity from the observer point (first element in the path)
  const visibilityM = localPath[0]?.visibility ?? 24140; 
  const rhPct = localPath[0]?.humidity ?? 50;

  const beta = aerosolBeta(visibilityM, rhPct);

  const sunDiskBeam = directBeamRGB(Math.max(sunAltDeg, -0.5), beta);
  // The reddened beam that bathes overhead clouds:
  // - If sun is above horizon (alt > 0°), use its actual altitude (direct beam)
  // - If sun is below horizon (alt <= 0°), evaluate at grazing horizon (0°)
  //   since the beam comes from that geometry and scattered light dominates
  const horizonBeam = directBeamRGB(Math.max(sunAltDeg, 0), beta);
  const pathClarity = beamPathTransmittance(localPath, sunAltDeg);

  const horizonProximity = clamp01(1 - Math.abs(sunAltDeg) / 10);
  const beamPower = pathClarity * (0.7 + 0.3 * horizonProximity);

  const incidentBeam: RGB = {
    r: horizonBeam.r * beamPower * 1.5,
    g: horizonBeam.g * beamPower * 1.1,
    b: horizonBeam.b * beamPower * 0.9,
  };
  const beamRedness =
    incidentBeam.r > 0
      ? Math.max(0, (incidentBeam.r - incidentBeam.g * 0.8) / Math.max(incidentBeam.r, 0.001))
      : 0;

  const illumLow = cloudIllumination(sunAltDeg, CLOUD_ALT_LOW_KM);
  const illumMid = cloudIllumination(sunAltDeg, CLOUD_ALT_MID_KM);
  const illumHigh = cloudIllumination(sunAltDeg, CLOUD_ALT_HIGH_KM);

  const overheadMid = localPath[0].mid / 100;
  const overheadHigh = localPath[0].high / 100;
  const overheadGlow = clamp01(overheadHigh * illumHigh + overheadMid * illumMid * 0.7);
  const overheadOvercast = clamp01(localPath[0].low / 100);

  const cloudShow = pathClarity * overheadGlow * (0.5 + 0.5 * beamRedness);

  let raw = 25 * pathClarity * horizonProximity + 70 * cloudShow;
  raw *= 1 - 0.85 * overheadOvercast;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

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

  const overcastBlend = overheadOvercast * 0.6;
  const muted = (c: RGB) => mixRgb(c, OVERCAST, overcastBlend);

  const skyGradient: SkyStop[] = [0, 0.25, 0.5, 0.7, 0.85, 1.0].map(y => {
    // Map y offset to an elevation angle theta in degrees
    // We use a quadratic mapping to cluster more gradient stops near the horizon
    const theta = 0.05 + 35 * Math.pow(1.0 - y, 2.0);
    const physicalColor = calculateRefractedSkyColor(theta, sunAltDeg, beta, pathClarity);
    return {
      offset: y,
      color: rgbToCss(muted(physicalColor)),
    };
  });

  const litColor = (illum: number, baseLit: number, isIce: boolean = false, genus?: CloudGenus): RGB => {
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
    let mixFactor = clamp01(illum * baseLit * (pathClarity * 0.5 + 0.5));
    if (genus === 'cumulonimbus') {
      mixFactor *= 0.45; // Cumulonimbus gets heavy shadows
    }
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

  return {
    score,
    quality,
    description,
    skyGradient,
    highCloudColor: rgbToCssAlpha(highCloudRGB, 0.9),
    midCloudColor: rgbToCssAlpha(midCloudRGB, 0.85),
    lowCloudColor: rgbToCssAlpha(lowCloudRGB, 0.9),
    sunDiskColor: rgbToCss(finalSunRGB),
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
