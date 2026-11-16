/**
 * astroForecast.ts
 *
 * UI 없이 동작하는 야간 장노출 촬영 판단 엔진:
 *  1) 현재 카메라 방향(az, el, fov)에서 향후 N분간 구름 유입·별 가림 위험 예측
 *  2) 촬영 방위·고도·초점거리·허용 흔들림(px) 기반 고정 삼각대 서브셔터 상한 계산
 *
 * Pure TypeScript 모듈이라 Node 검증 스크립트에서 그대로 테스트됩니다.
 */
import { LAYER_ALTITUDE_KM, type LayerKey, type LayerSample } from './skyColumn';
import { sampleTimeline, type SkyTimeline } from './skyTimeline';
import type { LayerWinds } from './weather';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 항성일 기준 하늘의 각속도 (360° / 86164.09s ≈ 15.04107″/s). */
export const SIDEREAL_DEG_PER_SEC = 360 / 86164.0905;

/**
 * 층별 구름이 별·은하수 관측을 가리는 유효 차폐 계수.
 * 저층운은 거의 불투명하고, 고층 권운은 희미한 별은 지우되 밝은 별은 일부 투과합니다.
 */
const LAYER_STAR_OPACITY: Record<LayerKey, number> = {
  low: 0.95,
  mid: 0.78,
  high: 0.42,
};

export interface SubExposureInput {
  /** 35mm 환산 초점거리 (mm). 예: 광각 24mm, 초광각 14mm. */
  focal35mm: number;
  /** 센서 가로 해상도 (px). 예: 4000. 기본 4000. */
  sensorWidthPx?: number;
  /** 허용 가능한 별 궤적 길이 (px). 1.5px ≈ 점상, 3.0px ≈ 관용. 기본 1.5. */
  maxTrailPx?: number;
  /** 관측 지향 적위(도, -90..90). 없으면 latDeg/azDeg/elDeg에서 계산. */
  declinationDeg?: number;
  /** 관측자 위도(도). declinationDeg가 없을 때 사용. */
  latitudeDeg?: number;
  /** 지향 방위각(도, 북=0 시계방향). */
  azDeg?: number;
  /** 지향 고도각(도, 0..90). */
  elDeg?: number;
  /** 기기 하드웨어 단일 프레임 최대 셔터(초). 기본 30초. */
  deviceMaxExposureSec?: number;
}

export interface SubExposureRecommendation {
  /** 천구 적위(도). 극에 가까울수록(|dec|→90°) 일주운동 속도가 느려집니다. */
  declinationDeg: number;
  /** 점상(기본 1.5px 허용) 기준 1장당 권장 최대 셔터 (초). */
  pinpointSec: number;
  /** 500 룰 기반 완화된 1장당 상한 (초). */
  rule500Sec: number;
  /** 기기 최대 셔터를 반영해 실제 촬영에 바로 쓸 클램프 값 (초). */
  recommendedSec: number;
  /** 해당 총 노출 시간 동안 추적 없이 고정했을 때 별이 그리는 궤적 각도(도). */
  trailDegAtExposure: (totalExposureSec: number) => number;
}

export interface AstroWindowInput {
  timeline: SkyTimeline | null;
  view: {
    azDeg: number;
    elDeg: number;
    hfovDeg: number;
    vfovDeg: number;
  };
  /** 촬영 시작 시각 (epoch ms). */
  startMs: number;
  /** 총 목표 노출 시간 (초). 예: 240(4분) ~ 600(10분). */
  exposureSec: number;
  /** 앞으로 얼마나 길게 구름 유입을 감시할지 (분). 기본 30분. */
  lookaheadMin?: number;
  /** 구름 방해로 판정할 유효 차폐율 임계치 (%, 0~100). 기본 25%. */
  blockThresholdPct?: number;
  /** (선택) 층별 바람 정보 — 노출 중 구름이 시야를 가로지르는 각속도 추정용. */
  layerWinds?: LayerWinds;
}

export interface AstroWindowPoint {
  offsetMin: number;
  tMs: number;
  /** 0~100%, 층별 불투명도와 운량을 결합한 시야 내 별 차폐율. */
  effectiveBlockPct: number;
  /** 0~1, 맑게 뚫린 하늘 비율 (1 - effectiveBlockPct / 100). */
  clearFrac: number;
  lowPct: number;
  midPct: number;
  highPct: number;
}

export type InterferenceRisk = 'low' | 'moderate' | 'high';

export interface AstroWindowAnalysis {
  hasData: boolean;
  startMs: number;
  exposureSec: number;
  /** 촬영 노출 시간 [startMs, startMs + exposureSec] 동안 평균 별 차폐율 (%). */
  exposureMeanBlockPct: number;
  /** 촬영 노출 시간 동안 최대 별 차폐율 (%). */
  exposurePeakBlockPct: number;
  /** 감시 창 전체([startMs, startMs + lookaheadMin])의 최대 별 차폐율 (%). */
  lookaheadPeakBlockPct: number;
  /** 촬영 시작 시점부터 구름 임계치를 넘기까지 확보된 맑은 시간 (분). */
  clearWindowMin: number;
  /** 처음으로 임계치를 넘는 시점 (시작 후 분). 끝까지 맑으면 null. */
  firstInterferenceMin: number | null;
  /** 방해 기여가 가장 큰 구름 층. */
  worstLayer: LayerKey | 'none';
  interferenceRisk: InterferenceRisk;
  /** 노출 시간 중 대표 구름층이 하늘을 스쳐 지나가는 각도(도, 바람 정보 없으면 null). */
  cloudSweepDegDuringExposure: number | null;
  series: AstroWindowPoint[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function unitVecHorizonEnu(azDeg: number, elDeg: number): [number, number, number] {
  const az = azDeg * D2R;
  const el = elDeg * D2R;
  const ce = Math.cos(el);
  return [ce * Math.sin(az), ce * Math.cos(az), Math.sin(el)];
}

/**
 * 지평좌표(위도 φ, 방위 A, 고도 a) → 적위 δ (도).
 * 극축 근처를 볼수록 cos(δ)가 작아져 별의 겉보기 이동 속도가 줄어듭니다.
 */
export function horizonToDeclinationDeg(
  latitudeDeg: number,
  azDeg: number,
  elDeg: number,
): number {
  const lat = latitudeDeg * D2R;
  const az = azDeg * D2R;
  const el = elDeg * D2R;
  const sinDec =
    Math.sin(lat) * Math.sin(el) +
    Math.cos(lat) * Math.cos(el) * Math.cos(az);
  return Math.asin(clamp(sinDec, -1, 1)) * R2D;
}

/**
 * 고정 삼각대 1장 촬영 시 별이 점으로 찍히는 최대 서브셔터 시간 계산.
 * pixelTrail 기반 정밀값과 전통적인 500룰 값을 함께 돌려줍니다.
 */
export function recommendedSubExposureSec(
  input: SubExposureInput,
): SubExposureRecommendation {
  const focal = Math.max(8, input.focal35mm);
  const sensorWidthPx = Math.max(640, input.sensorWidthPx ?? 4000);
  const maxTrailPx = clamp(input.maxTrailPx ?? 1.5, 0.5, 6);
  const deviceMax = Math.max(1, input.deviceMaxExposureSec ?? 30);

  const decDeg =
    input.declinationDeg !== undefined
      ? clamp(input.declinationDeg, -90, 90)
      : input.latitudeDeg !== undefined &&
          input.azDeg !== undefined &&
          input.elDeg !== undefined
        ? horizonToDeclinationDeg(input.latitudeDeg, input.azDeg, input.elDeg)
        : 0;

  // 천구 극 바로 옆은 cos(dec)가 0에 수렴해 무한대가 되므로 최소 하한(0.15) 적용
  const cosDec = Math.max(0.15, Math.abs(Math.cos(decDeg * D2R)));
  const hfovDeg = 2 * Math.atan(36 / (2 * focal)) * R2D;
  const degPerPx = hfovDeg / sensorWidthPx;
  const angularBudgetDeg = degPerPx * maxTrailPx;

  const pinpointSec = angularBudgetDeg / (SIDEREAL_DEG_PER_SEC * cosDec);
  const rule500Sec = 500 / (focal * cosDec);
  const recommendedSec = clamp(pinpointSec, 0.5, deviceMax);

  return {
    declinationDeg: decDeg,
    pinpointSec: Number(pinpointSec.toFixed(2)),
    rule500Sec: Number(rule500Sec.toFixed(2)),
    recommendedSec: Number(recommendedSec.toFixed(2)),
    trailDegAtExposure: (totalExposureSec: number) =>
      Math.max(0, totalExposureSec) * SIDEREAL_DEG_PER_SEC * cosDec,
  };
}

interface ConeLayerCovers {
  low: number;
  mid: number;
  high: number;
  precipMmH: number;
}

/**
 * 3D 원뿔 거리 기반으로 시야(fov) 안에 들어오는 층별 운량을 가중 평균합니다.
 * 북쪽 0°/360° 경계나 천정 부근에서도 왜곡이 없도록 벡터 내적으로 각거리를 잽니다.
 */
function sampleViewConeCovers(
  samples: LayerSample[],
  azDeg: number,
  elDeg: number,
  hfovDeg: number,
  vfovDeg: number,
): ConeLayerCovers {
  const viewDir = unitVecHorizonEnu(azDeg, elDeg);
  const halfDiagDeg = Math.max(12, 0.55 * Math.hypot(hfovDeg, vfovDeg));
  const softCutDeg = Math.min(90, halfDiagDeg * 1.35);

  const num: Record<LayerKey, number> = { low: 0, mid: 0, high: 0 };
  const den: Record<LayerKey, number> = { low: 0, mid: 0, high: 0 };
  const nearest: Record<LayerKey, { ang: number; cover: number }> = {
    low: { ang: 999, cover: 0 },
    mid: { ang: 999, cover: 0 },
    high: { ang: 999, cover: 0 },
  };
  let pNum = 0;
  let pDen = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const dir = unitVecHorizonEnu(s.azimuthDeg, s.elevationDeg);
    const dot = clamp(
      dir[0] * viewDir[0] + dir[1] * viewDir[1] + dir[2] * viewDir[2],
      -1,
      1,
    );
    const angDeg = Math.acos(dot) * R2D;
    if (angDeg < nearest[s.layer].ang) {
      nearest[s.layer] = { ang: angDeg, cover: s.cover };
    }
    if (angDeg > softCutDeg) continue;

    // 중심부 가중치 1.0 → 외곽 0.25로 부드럽게 감쇠
    const t = clamp(angDeg / softCutDeg, 0, 1);
    const w = (1 - 0.75 * t * t) * Math.max(0.1, s.confidence);
    num[s.layer] += clamp(s.cover, 0, 1) * w;
    den[s.layer] += w;
    pNum += Math.max(0, s.precipMmH) * w;
    pDen += w;
  }

  return {
    low: den.low > 0 ? num.low / den.low : nearest.low.cover,
    mid: den.mid > 0 ? num.mid / den.mid : nearest.mid.cover,
    high: den.high > 0 ? num.high / den.high : nearest.high.cover,
    precipMmH: pDen > 0 ? pNum / pDen : 0,
  };
}

function effectiveBlockFraction(c: ConeLayerCovers): number {
  const tLow = 1 - LAYER_STAR_OPACITY.low * clamp(c.low, 0, 1);
  const tMid = 1 - LAYER_STAR_OPACITY.mid * clamp(c.mid, 0, 1);
  const tHigh = 1 - LAYER_STAR_OPACITY.high * clamp(c.high, 0, 1);
  // 0.3 mm/h 이상의 비가 내리면 산란·물방울로 별 관측 불가에 가깝게 가산
  const tPrecip = c.precipMmH > 0.05 ? Math.exp(-c.precipMmH * 2.5) : 1;
  return clamp(1 - tLow * tMid * tHigh * tPrecip, 0, 1);
}

function dominantCloudLayer(points: AstroWindowPoint[]): LayerKey | 'none' {
  if (points.length === 0) return 'none';
  let sumLow = 0;
  let sumMid = 0;
  let sumHigh = 0;
  for (const p of points) {
    sumLow += (p.lowPct / 100) * LAYER_STAR_OPACITY.low;
    sumMid += (p.midPct / 100) * LAYER_STAR_OPACITY.mid;
    sumHigh += (p.highPct / 100) * LAYER_STAR_OPACITY.high;
  }
  const best = Math.max(sumLow, sumMid, sumHigh);
  if (best / points.length < 0.04) return 'none';
  if (sumLow >= sumMid && sumLow >= sumHigh) return 'low';
  if (sumMid >= sumHigh) return 'mid';
  return 'high';
}

function estimateCloudSweepDeg(
  layerWinds: LayerWinds | undefined,
  dominant: LayerKey | 'none',
  elDeg: number,
  exposureSec: number,
): number | null {
  if (!layerWinds || exposureSec <= 0) return null;
  const layer: LayerKey = dominant === 'none' ? 'mid' : dominant;
  const speedKmh = layerWinds[layer].speedKmh;
  const altKm = LAYER_ALTITUDE_KM[layer];
  // 고도 angle 에 따른 시선 거리 d ≈ altKm / sin(max(12°, el))
  const sinEl = Math.sin(Math.max(12, elDeg) * D2R);
  const slantKm = altKm / sinEl;
  const moveKm = (speedKmh * exposureSec) / 3600;
  return Number((Math.atan2(moveKm, slantKm) * R2D).toFixed(2));
}

/**
 * 타임라인 기반 장노출 창 구름 방해 예측.
 * 4~10분 노출 중 구름 차폐뿐 아니라, 이후 lookaheadMin 분 안에 구름이 밀려오는지 판정합니다.
 */
export function analyzeAstroWindow(input: AstroWindowInput): AstroWindowAnalysis {
  const exposureSec = Math.max(1, input.exposureSec);
  const lookaheadMin = Math.max(exposureSec / 60, input.lookaheadMin ?? 30);
  const blockThresholdPct = clamp(input.blockThresholdPct ?? 25, 5, 95);

  if (!input.timeline || input.timeline.frames.length === 0) {
    return {
      hasData: false,
      startMs: input.startMs,
      exposureSec,
      exposureMeanBlockPct: 0,
      exposurePeakBlockPct: 0,
      lookaheadPeakBlockPct: 0,
      clearWindowMin: lookaheadMin,
      firstInterferenceMin: null,
      worstLayer: 'none',
      interferenceRisk: 'low',
      cloudSweepDegDuringExposure: estimateCloudSweepDeg(
        input.layerWinds,
        'none',
        input.view.elDeg,
        exposureSec,
      ),
      series: [],
    };
  }

  const stepMin = Math.min(2.5, Math.max(1, input.timeline.stepMinutes / 2));
  const totalSteps = Math.max(2, Math.ceil(lookaheadMin / stepMin) + 1);
  const series: AstroWindowPoint[] = [];

  for (let i = 0; i < totalSteps; i++) {
    const offsetMin = Math.min(lookaheadMin, i * stepMin);
    const tMs = input.startMs + offsetMin * 60_000;
    const sampled = sampleTimeline(input.timeline, tMs);
    if (!sampled) continue;

    const covers = sampleViewConeCovers(
      sampled.samples,
      input.view.azDeg,
      input.view.elDeg,
      input.view.hfovDeg,
      input.view.vfovDeg,
    );
    const blockPct = effectiveBlockFraction(covers) * 100;
    series.push({
      offsetMin: Number(offsetMin.toFixed(2)),
      tMs,
      effectiveBlockPct: Number(blockPct.toFixed(1)),
      clearFrac: Number((1 - blockPct / 100).toFixed(3)),
      lowPct: Number((covers.low * 100).toFixed(1)),
      midPct: Number((covers.mid * 100).toFixed(1)),
      highPct: Number((covers.high * 100).toFixed(1)),
    });
  }

  const exposureMin = exposureSec / 60;
  const inExp = series.filter((p) => p.offsetMin <= exposureMin + 1e-6);
  const expPts = inExp.length > 0 ? inExp : series.slice(0, 1);

  const exposureMeanBlockPct =
    expPts.reduce((acc, p) => acc + p.effectiveBlockPct, 0) /
    Math.max(1, expPts.length);
  const exposurePeakBlockPct = expPts.reduce(
    (m, p) => Math.max(m, p.effectiveBlockPct),
    0,
  );
  const lookaheadPeakBlockPct = series.reduce(
    (m, p) => Math.max(m, p.effectiveBlockPct),
    0,
  );

  let firstInterferenceMin: number | null = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i].effectiveBlockPct >= blockThresholdPct) {
      if (i === 0) {
        firstInterferenceMin = 0;
      } else {
        // 직전 맑은 점과 임계치 점 사이 선형 보간으로 분 단위 시점 추정
        const prev = series[i - 1];
        const cur = series[i];
        const span = Math.max(1e-3, cur.effectiveBlockPct - prev.effectiveBlockPct);
        const frac = clamp((blockThresholdPct - prev.effectiveBlockPct) / span, 0, 1);
        firstInterferenceMin = Number(
          (prev.offsetMin + (cur.offsetMin - prev.offsetMin) * frac).toFixed(1),
        );
      }
      break;
    }
  }

  const clearWindowMin =
    firstInterferenceMin === null ? lookaheadMin : firstInterferenceMin;
  const worstLayer = dominantCloudLayer(series);

  let interferenceRisk: InterferenceRisk = 'low';
  if (
    exposurePeakBlockPct >= blockThresholdPct * 1.4 ||
    exposureMeanBlockPct >= blockThresholdPct
  ) {
    interferenceRisk = 'high';
  } else if (
    (firstInterferenceMin !== null && firstInterferenceMin <= exposureMin + 10) ||
    lookaheadPeakBlockPct >= blockThresholdPct
  ) {
    interferenceRisk = 'moderate';
  }

  return {
    hasData: true,
    startMs: input.startMs,
    exposureSec,
    exposureMeanBlockPct: Number(exposureMeanBlockPct.toFixed(1)),
    exposurePeakBlockPct: Number(exposurePeakBlockPct.toFixed(1)),
    lookaheadPeakBlockPct: Number(lookaheadPeakBlockPct.toFixed(1)),
    clearWindowMin: Number(clearWindowMin.toFixed(1)),
    firstInterferenceMin,
    worstLayer,
    interferenceRisk,
    cloudSweepDegDuringExposure: estimateCloudSweepDeg(
      input.layerWinds,
      worstLayer,
      input.view.elDeg,
      exposureSec,
    ),
    series,
  };
}
