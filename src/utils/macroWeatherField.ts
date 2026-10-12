/**
 * macroWeatherField.ts — 주변 좌표(CloudPathData) 기반 2D 거시 상태장 및 해석적 빔 투과율
 *
 * Why: 관측점 1점만으로 구름을 그리면 하늘 전체가 같은 패턴으로 채워져 "서쪽은 비고 동쪽은 흐린"
 * 실제 하늘 배치가 불가능하고, 해 쪽 수백 km의 구름 차폐를 계산하지 못해 노을빛 적중률이 떨어집니다.
 * 이 모듈은 주변 10~30여 개 샘플점들로부터 공간 운량 기울기와 해 방향 직달광 투과율을 계산합니다.
 */

import type { CloudData } from './weather';
import { EARTH_RADIUS_KM } from './earth';

export interface LayerMacroGradient {
  /** 동쪽(+x) 방향 100km당 운량 변화율 (-1 ~ +1) */
  gradXPer100Km: number;
  /** 북쪽(+y) 방향 100km당 운량 변화율 (-1 ~ +1) */
  gradYPer100Km: number;
  /** 동서남북 4개 방향 대표 운량 (0 ~ 1) */
  quadrantCover: {
    east: number;
    west: number;
    north: number;
    south: number;
  };
}

export interface MacroWeatherField {
  low: LayerMacroGradient;
  mid: LayerMacroGradient;
  high: LayerMacroGradient;
  /**
   * 태양 방향 직달광 유효 투과율 (0 ~ 1)
   * 해 쪽 50~350km 전방의 구름 차폐를 적분한 결과.
   * 1에 가까울수록 먼 구름에 가리지 않고 강한 적화 광선이 관측자 구름 밑면에 도달합니다.
   */
  beamTransmittance: {
    low: number;
    mid: number;
    high: number;
  };
  /** 태양 쪽 하늘의 빛 틈 비율 (0 ~ 1) */
  sunGap: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * 주변 샘플점들로부터 평면 좌표 (x, y [km]) 및 층별 운량을 추출하여
 * 관측점 기준 1차 공간 기울기(Ridge regression)를 계산합니다.
 */
function solveLayerGradient(
  points: { x: number; y: number; cover: number; weight: number }[],
  obsCover: number,
): LayerMacroGradient {
  // 기본값 (주변 데이터가 없거나 0일 때)
  const defaultQuad = { east: obsCover, west: obsCover, north: obsCover, south: obsCover };
  if (!points.length) {
    return { gradXPer100Km: 0, gradYPer100Km: 0, quadrantCover: defaultQuad };
  }

  // 1. 사분면별 평균 운량
  let eSum = 0, eW = 0, wSum = 0, wW = 0, nSum = 0, nW = 0, sSum = 0, sW = 0;
  for (const p of points) {
    const dist = Math.hypot(p.x, p.y);
    if (dist < 1) continue;
    const w = 1 / Math.max(20, dist);
    if (p.x > 0) { eSum += p.cover * w; eW += w; }
    else { wSum += p.cover * w; wW += w; }
    if (p.y > 0) { nSum += p.cover * w; nW += w; }
    else { sSum += p.cover * w; sW += w; }
  }

  const quadrantCover = {
    east: eW > 0 ? eSum / eW : obsCover,
    west: wW > 0 ? wSum / wW : obsCover,
    north: nW > 0 ? nSum / nW : obsCover,
    south: sW > 0 ? sSum / sW : obsCover,
  };

  // 2. Ridge Regression: Δc = gx * x + gy * y
  // (A^T W A + λ I) g = A^T W Δc
  let sXX = 0, sYY = 0, sXY = 0, sXC = 0, sYC = 0;
  const lambda = 400; // 정규화 (100km² 스케일)

  for (const p of points) {
    const dist = Math.hypot(p.x, p.y);
    if (dist < 2) continue; // 관측점 자체는 차이 0
    const w = p.weight / Math.max(30, dist);
    const dc = p.cover - obsCover; // 운량 차이 (-1 ~ +1)

    sXX += w * p.x * p.x;
    sYY += w * p.y * p.y;
    sXY += w * p.x * p.y;
    sXC += w * p.x * dc;
    sYC += w * p.y * dc;
  }

  sXX += lambda;
  sYY += lambda;
  const det = sXX * sYY - sXY * sXY;
  if (Math.abs(det) < 1e-5) {
    return { gradXPer100Km: 0, gradYPer100Km: 0, quadrantCover };
  }

  // 단위: km당 변화율 -> 100km당 변화율로 변환 (* 100)
  const gx = ((sYY * sXC - sXY * sYC) / det) * 100;
  const gy = ((sXX * sYC - sXY * sXC) / det) * 100;

  // 최대 100km당 ±0.6 (60%)로 클램프
  return {
    gradXPer100Km: Math.max(-0.6, Math.min(0.6, gx)),
    gradYPer100Km: Math.max(-0.6, Math.min(0.6, gy)),
    quadrantCover,
  };
}

/**
 * 태양 방향으로의 수평 광선 차폐율 계산
 *
 * 고도 h(km)의 구름 입장에서 해 방향 거리 s(km) 지점의 광선 고도:
 * z(s) ≈ h + s * tan(e) + s² / (2 * R)
 * 이 광선이 해 쪽의 먼 구름 층들을 뚫고 도달할 수 있는지 투과율 T_beam을 적분합니다.
 */
function solveRayBeamTransmittance(
  cloudPoints: { x: number; y: number; low: number; mid: number; high: number }[],
  sunAzDeg: number,
  sunAltDeg: number,
  hKm: number,
): number {
  const azRad = sunAzDeg * DEG_TO_RAD;
  const sunDirX = Math.sin(azRad);
  const sunDirY = Math.cos(azRad);
  const tanElev = Math.tan(sunAltDeg * DEG_TO_RAD);
  const R = EARTH_RADIUS_KM;

  // 태양 고도가 음수일 때, 지구 본체에 의한 차폐 검사
  // 최저점 거리 s_min = -R * tan(e)
  if (sunAltDeg < 0) {
    const sMin = -R * tanElev;
    const zMin = hKm + sMin * tanElev + (sMin * sMin) / (2 * R);
    // 지표 또는 연무층(0.5km) 아래로 내려가면 광선이 완전히 차단됨
    if (zMin < 0.5) return 0.0;
  }

  // 해 방향 50~350km 전방의 구름들을 검사하여 광학두께 누적
  let accumulatedTau = 0;

  for (const p of cloudPoints) {
    // 해 방향으로의 투영 거리 s 및 직교 거리 d_perp
    const s = p.x * sunDirX + p.y * sunDirY;
    if (s < 15 || s > 360) continue; // 전방 15km~360km 구간만 탐색

    const perpX = p.x - s * sunDirX;
    const perpY = p.y - s * sunDirY;
    const dPerp = Math.hypot(perpX, perpY);

    // 해 방향 축에서 너무 벗어난 점은 가중치 감소 (가우시안 빔 너비)
    const beamRadius = 20 + s * 0.15; // 거리에 따라 확산
    if (dPerp > beamRadius * 2) continue;
    const lateralWeight = Math.exp(-0.5 * (dPerp / beamRadius) ** 2);

    // 거리 s에서의 광선 높이
    const rayZ = hKm + s * tanElev + (s * s) / (2 * R);

    // 각 층의 고도와 광선 높이의 근접도에 따라 차폐 기여도 계산
    // 저층: 0.8~2.5km, 중층: 2.5~6.5km, 상층: 6.5~12km
    let layerCover = 0;
    if (rayZ >= 0.5 && rayZ <= 2.5) {
      layerCover = p.low;
    } else if (rayZ > 2.5 && rayZ <= 6.5) {
      layerCover = p.mid;
    } else if (rayZ > 6.5 && rayZ <= 12.0) {
      layerCover = p.high;
    }

    if (layerCover > 0.05) {
      // 운량 0.8(80%)이면 광학두께 크게 부여
      const tauContribution = (layerCover / 100) * 1.5 * lateralWeight;
      accumulatedTau += tauContribution;
    }
  }

  return Math.exp(-Math.min(10, accumulatedTau));
}

/**
 * 전체 macro weather field 분석
 */
export function buildMacroWeatherField(
  interpolatedPoints: CloudData[],
  sunAzDeg: number,
  sunAltDeg: number,
): MacroWeatherField {
  if (!interpolatedPoints.length) {
    const zeroGrad = { gradXPer100Km: 0, gradYPer100Km: 0, quadrantCover: { east: 0, west: 0, north: 0, south: 0 } };
    return {
      low: zeroGrad,
      mid: zeroGrad,
      high: zeroGrad,
      beamTransmittance: { low: 1, mid: 1, high: 1 },
      sunGap: 1,
    };
  }

  const obs = interpolatedPoints[0];
  const obsLow = (obs?.low ?? 0) / 100;
  const obsMid = (obs?.mid ?? 0) / 100;
  const obsHigh = (obs?.high ?? 0) / 100;

  const lowPts: { x: number; y: number; cover: number; weight: number }[] = [];
  const midPts: { x: number; y: number; cover: number; weight: number }[] = [];
  const highPts: { x: number; y: number; cover: number; weight: number }[] = [];
  const rawPts: { x: number; y: number; low: number; mid: number; high: number }[] = [];

  let sunDirCoverSum = 0;
  let sunDirWeightSum = 0;
  const sunAzRad = sunAzDeg * DEG_TO_RAD;

  for (const p of interpolatedPoints) {
    const dist = p.distance ?? 0;
    const az = p.azimuthOffset ?? 0;
    const azRad = az * DEG_TO_RAD;
    const x = dist * Math.sin(azRad);
    const y = dist * Math.cos(azRad);

    const cLow = (p.low ?? 0) / 100;
    const cMid = (p.mid ?? 0) / 100;
    const cHigh = (p.high ?? 0) / 100;

    lowPts.push({ x, y, cover: cLow, weight: 1 });
    midPts.push({ x, y, cover: cMid, weight: 1 });
    highPts.push({ x, y, cover: cHigh, weight: 1 });
    rawPts.push({ x, y, low: p.low ?? 0, mid: p.mid ?? 0, high: p.high ?? 0 });

    // 해 쪽 방위각 ±30도 이내 점들의 운량 가중합
    const angleDiff = Math.abs((((az - sunAzDeg + 180) % 360) + 360) % 360 - 180);
    if (angleDiff <= 45 && dist > 10) {
      const w = 1 / Math.max(30, dist);
      const totalC = Math.max(cLow, Math.max(cMid, cHigh));
      sunDirCoverSum += totalC * w;
      sunDirWeightSum += w;
    }
  }

  const lowGrad = solveLayerGradient(lowPts, obsLow);
  const midGrad = solveLayerGradient(midPts, obsMid);
  const highGrad = solveLayerGradient(highPts, obsHigh);

  // 층별 대표 고도(km)
  const altLow = obs.layerAltLowKm ?? 1.5;
  const altMid = obs.layerAltMidKm ?? 4.5;
  const altHigh = obs.layerAltHighKm ?? 9.5;

  const tLow = solveRayBeamTransmittance(rawPts, sunAzDeg, sunAltDeg, altLow);
  const tMid = solveRayBeamTransmittance(rawPts, sunAzDeg, sunAltDeg, altMid);
  const tHigh = solveRayBeamTransmittance(rawPts, sunAzDeg, sunAltDeg, altHigh);

  const sunDirCover = sunDirWeightSum > 0 ? sunDirCoverSum / sunDirWeightSum : Math.max(obsLow, obsMid, obsHigh);
  const sunGap = Math.max(0, Math.min(1, 1 - sunDirCover));

  return {
    low: lowGrad,
    mid: midGrad,
    high: highGrad,
    beamTransmittance: {
      low: tLow,
      mid: tMid,
      high: tHigh,
    },
    sunGap,
  };
}
