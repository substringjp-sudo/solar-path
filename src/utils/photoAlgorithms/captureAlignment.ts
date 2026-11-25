/**
 * captureAlignment.ts — 다중 프레임 정합 · 시프트 원근 교정 · 럭키 이미징 · 구름 장노출 · 시간차 자동 셔터.
 *
 * 포함 기능:
 *  1) 건축 시프트(Shift / PC-E) 수직선 교정 3×3 UV 호모그래피 + 내접 크롭 박스
 *  2) 핸드헬드 지상 고정 IMU 3×3 UV 호모그래피 (야간 이중 스태킹 · 구름 장노출 공용)
 *  3) 망원 럭키 이미징(Laplacian Variance 선명도 선별 + 서브픽셀 Drizzle 시프트 추정)
 *  4) 가상 ND 구름 장노출(850/500/300hPa 3D 풍향·풍속 → 2D 화면 방향성 모션 커널)
 *  5) 블루아워+야간 시간차 하이브리드 촬영(1D 능선 시그니처 위상 상관 매칭 + 자동 셔터)
 */
import {
  cameraBasis,
  wrap180,
  type Attitude,
  type Intrinsics,
} from '../arVision';
import { mat3Mul, mat3Transpose, type Mat3 } from '../astroStackMath';
import { D2R, clamp } from '../math';

// ─────────────────────────────────────────────────────────────────────────────
// 내부 3×3 행렬·UV 유틸
// ─────────────────────────────────────────────────────────────────────────────

function applyMat3Uv(h: Mat3, u: number, v: number): [number, number] {
  const x = h[0] * u + h[1] * v + h[2];
  const y = h[3] * u + h[4] * v + h[5];
  const w = h[6] * u + h[7] * v + h[8];
  const inv = Math.abs(w) > 1e-8 ? 1 / w : 1;
  return [x * inv, y * inv];
}

/**
 * 월드→카메라 회전 행렬 R (카메라 좌표: x=우, y=하, z=전방).
 * `arVision.ts`의 basis.up은 위(+z 방향)이므로 화면 y-아래와 맞추기 위해 -up을 2행에 둡니다.
 */
function worldToCamMat3(a: Attitude): Mat3 {
  const b = cameraBasis(a);
  return [
    b.r[0], b.r[1], b.r[2],
    -b.u[0], -b.u[1], -b.u[2],
    b.f[0], b.f[1], b.f[2],
  ];
}

/** 정규화 UV(0..1) 기준 카메라 내부 행렬 K_uv 와 그 역행렬 K_uv⁻¹. */
function uvIntrinsics(k: Intrinsics): { kUv: Mat3; kUvInv: Mat3 } {
  const fx = k.fx / Math.max(1, k.width);
  const fy = k.fy / Math.max(1, k.height);
  const cx = k.cx / Math.max(1, k.width);
  const cy = k.cy / Math.max(1, k.height);
  return {
    kUv: [fx, 0, cx, 0, fy, cy, 0, 0, 1],
    kUvInv: [1 / fx, 0, -cx / fx, 0, 1 / fy, -cy / fy, 0, 0, 1],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 건축 시프트(Shift) 수직선 원근 교정
// ─────────────────────────────────────────────────────────────────────────────

export interface VerticalShiftResult {
  /** 출력 UV → 원본 UV 역방향 샘플링 3×3 호모그래피(네이티브 셰이더 바로 전달용). */
  dstToSrcUv: Mat3;
  /** 원본 UV → 출력 UV 순방향 호모그래피. */
  srcToDstUv: Mat3;
  /** 왜곡 보정 후 검은 여백이 생기지 않는 최대 내접 크롭 박스(정규화 UV). */
  cropBox: { u0: number; v0: number; u1: number; v1: number };
}

/**
 * 카메라를 위로 올려다보거나(pitch ≠ 0) 기울여서(roll ≠ 0) 건물이 뒤로 쓰러지는
 * 키스톤 왜곡을 수평 광축(pitch=0, roll=0) 가상 카메라로 재투영해 반듯하게 폅니다.
 */
export function computeVerticalShiftHomography(
  attitude: Attitude,
  intrinsics: Intrinsics,
  opts: {
    /** 교정 강도(0=원본, 1=완전 수직). 기본 0.85(과도한 상단 늘어짐 방지). */
    strength?: number;
    /** 최대 허용 교정 피치(도). 기본 30°. */
    maxPitchDeg?: number;
  } = {},
): VerticalShiftResult {
  const s = clamp(opts.strength ?? 0.85, 0, 1);
  const maxP = clamp(opts.maxPitchDeg ?? 30, 5, 45);
  const clampedPitch = clamp(attitude.pitchDeg, -maxP, maxP);

  // 목표 자세: yaw는 유지하고 pitch·roll만 0 쪽으로 보정
  const target: Attitude = {
    yawDeg: attitude.yawDeg,
    pitchDeg: attitude.pitchDeg - clampedPitch * s,
    rollDeg: attitude.rollDeg * (1 - s),
  };

  const rSrc = worldToCamMat3(attitude);
  const rDst = worldToCamMat3(target);
  // dst 카메라 광선 → 월드 → src 카메라 광선: R_src * R_dst^T
  const rDstToSrc = mat3Mul(rSrc, mat3Transpose(rDst));
  const rSrcToDst = mat3Transpose(rDstToSrc);

  const { kUv, kUvInv } = uvIntrinsics(intrinsics);
  const dstToSrcUv = mat3Mul(mat3Mul(kUv, rDstToSrc), kUvInv);
  const srcToDstUv = mat3Mul(mat3Mul(kUv, rSrcToDst), kUvInv);

  // 원본 4개 모서리를 출력 공간으로 투영해 초기 내접 크롭 사각형 산출
  const c00 = applyMat3Uv(srcToDstUv, 0, 0);
  const c10 = applyMat3Uv(srcToDstUv, 1, 0);
  const c01 = applyMat3Uv(srcToDstUv, 0, 1);
  const c11 = applyMat3Uv(srcToDstUv, 1, 1);

  let u0 = clamp(Math.max(c00[0], c01[0]), 0.01, 0.42);
  let u1 = clamp(Math.min(c10[0], c11[0]), 0.58, 0.99);
  let v0 = clamp(Math.max(c00[1], c10[1]), 0.01, 0.42);
  let v1 = clamp(Math.min(c01[1], c11[1]), 0.58, 0.99);

  // 출력 크롭 박스의 네 모서리가 역투영(dstToSrcUv) 시 모두 원본 [0.008, 0.992] 안에 들어오도록 수축해
  // 상단/하단 클램핑 늘어짐 아티팩트를 원천 차단합니다.
  const cornersInside = (scale: number): boolean => {
    const cu0 = 0.5 + (u0 - 0.5) * scale;
    const cu1 = 0.5 + (u1 - 0.5) * scale;
    const cv0 = 0.5 + (v0 - 0.5) * scale;
    const cv1 = 0.5 + (v1 - 0.5) * scale;
    const pts: Array<[number, number]> = [
      applyMat3Uv(dstToSrcUv, cu0, cv0),
      applyMat3Uv(dstToSrcUv, cu1, cv0),
      applyMat3Uv(dstToSrcUv, cu0, cv1),
      applyMat3Uv(dstToSrcUv, cu1, cv1),
    ];
    return pts.every(([su, sv]) => su >= 0.008 && su <= 0.992 && sv >= 0.008 && sv <= 0.992);
  };

  if (!cornersInside(1)) {
    let lo = 0.35;
    let hi = 1.0;
    for (let iter = 0; iter < 10; iter++) {
      const mid = (lo + hi) * 0.5;
      if (cornersInside(mid)) lo = mid;
      else hi = mid;
    }
    u0 = 0.5 + (u0 - 0.5) * lo;
    u1 = 0.5 + (u1 - 0.5) * lo;
    v0 = 0.5 + (v0 - 0.5) * lo;
    v1 = 0.5 + (v1 - 0.5) * lo;
  }

  return { dstToSrcUv, srcToDstUv, cropBox: { u0, v0, u1, v1 } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 핸드헬드 지상 고정 IMU 3×3 호모그래피
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 기준 프레임(refAttitude) 대비 현재 프레임(curAttitude)의 손떨림 회전을 되돌려
 * 지상(산·건물)을 제자리에 고정하는 정규화 UV 역방향 호모그래피(refUV → curUV)를 계산합니다.
 */
export function computeGroundStabilizationHomography(
  refAttitude: Attitude,
  curAttitude: Attitude,
  intrinsics: Intrinsics,
): Mat3 {
  const rRef = worldToCamMat3(refAttitude);
  const rCur = worldToCamMat3(curAttitude);
  const rRefToCur = mat3Mul(rCur, mat3Transpose(rRef));
  const { kUv, kUvInv } = uvIntrinsics(intrinsics);
  return mat3Mul(mat3Mul(kUv, rRefToCur), kUvInv);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 망원 럭키 이미징(Laplacian 선명도 선별 + 서브픽셀 Drizzle 시프트)
// ─────────────────────────────────────────────────────────────────────────────

export interface LuckySelectionResult {
  /** 선별된 프레임 인덱스(선명도 내림차순). */
  selectedIndices: number[];
  /** 전체 프레임 길이의 가중치 배열(탈락=0, 합=1.0). */
  weights: Float32Array;
  thresholdScore: number;
}

/**
 * 0..1 휘도 썸네일에서 3×3 라플라시안 분산(Laplacian Variance)으로 프레임 선명도를 계산합니다.
 * 대기 아지랑이가 순간적으로 멎은 프레임을 고르는 럭키 이미징의 표준 지표입니다.
 */
export function scoreFrameSharpness(
  luma: Float32Array,
  width: number,
  height: number,
  roi?: { x0: number; y0: number; x1: number; y1: number },
): number {
  const x0 = Math.max(1, Math.floor(roi?.x0 ?? 1));
  const y0 = Math.max(1, Math.floor(roi?.y0 ?? 1));
  const x1 = Math.min(width - 2, Math.floor(roi?.x1 ?? width - 2));
  const y1 = Math.min(height - 2, Math.floor(roi?.y1 ?? height - 2));

  let count = 0;
  let sum = 0;
  let sumSq = 0;

  for (let y = y0; y <= y1; y++) {
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const c = luma[row + x];
      const lap =
        luma[row - width + x] +
        luma[row + width + x] +
        luma[row + x - 1] +
        luma[row + x + 1] -
        4 * c;
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

/** 선명도 점수 배열에서 상위 keepRatio(예: 0.35 = 상위 35%)만 골라 가중치를 부여합니다. */
export function selectLuckyFrames(
  scores: readonly number[],
  keepRatio = 0.35,
): LuckySelectionResult {
  const n = scores.length;
  const weights = new Float32Array(n);
  if (n === 0) return { selectedIndices: [], weights, thresholdScore: 0 };

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const keepCount = Math.max(1, Math.round(n * clamp(keepRatio, 0.05, 1)));
  const selectedIndices = order.slice(0, keepCount);
  const thresholdScore = scores[selectedIndices[selectedIndices.length - 1]];

  let wSum = 0;
  for (const idx of selectedIndices) {
    const w = Math.max(1e-6, scores[idx]);
    weights[idx] = w;
    wSum += w;
  }
  for (const idx of selectedIndices) weights[idx] /= wSum;

  return { selectedIndices, weights, thresholdScore };
}

export interface SubpixelShiftResult {
  /** cur 프레임이 ref 대비 이동한 서브픽셀 오프셋 (px). */
  dx: number;
  dy: number;
  /** 정규화 상관 신뢰도(0..1). */
  confidence: number;
}

/**
 * 기준 프레임(ref)과 현재 프레임(cur) 사이의 정수 시프트를 탐색한 뒤,
 * 3×3 SAD 곡면 포물선 피팅으로 0.1px 이하의 서브픽셀 위상차(Drizzle 입력)를 추정합니다.
 */
export function estimateSubpixelShift(
  refLuma: Float32Array,
  curLuma: Float32Array,
  width: number,
  height: number,
  maxShiftPx = 6,
): SubpixelShiftResult {
  const R = Math.max(1, Math.round(maxShiftPx));
  const margin = R + 1;
  const wSpan = width - 2 * margin;
  const hSpan = height - 2 * margin;
  if (wSpan <= 4 || hSpan <= 4) return { dx: 0, dy: 0, confidence: 0 };

  const sadAt = (sx: number, sy: number): number => {
    let err = 0;
    for (let y = margin; y < height - margin; y += 2) {
      const rRow = y * width;
      const cRow = (y + sy) * width;
      for (let x = margin; x < width - margin; x += 2) {
        err += Math.abs(refLuma[rRow + x] - curLuma[cRow + x + sx]);
      }
    }
    return err;
  };

  let bestX = 0;
  let bestY = 0;
  let bestErr = Number.POSITIVE_INFINITY;
  let worstErr = 0;

  for (let sy = -R; sy <= R; sy++) {
    for (let sx = -R; sx <= R; sx++) {
      const e = sadAt(sx, sy);
      if (e < bestErr) {
        bestErr = e;
        bestX = sx;
        bestY = sy;
      }
      if (e > worstErr) worstErr = e;
    }
  }

  // 1D 포물선 정점 보간으로 서브픽셀 정밀화
  const refine = (ePrev: number, eMid: number, eNext: number): number => {
    const denom = 2 * (ePrev - 2 * eMid + eNext);
    if (Math.abs(denom) < 1e-8) return 0;
    return clamp((ePrev - eNext) / denom, -0.5, 0.5);
  };

  const subX = bestX > -R && bestX < R
    ? refine(sadAt(bestX - 1, bestY), bestErr, sadAt(bestX + 1, bestY))
    : 0;
  const subY = bestY > -R && bestY < R
    ? refine(sadAt(bestX, bestY - 1), bestErr, sadAt(bestX, bestY + 1))
    : 0;

  const confidence = worstErr > 1e-6 ? clamp(1 - bestErr / worstErr, 0, 1) : 0;
  return { dx: bestX + subX, dy: bestY + subY, confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 가상 ND 구름 장노출 (Directional Cloud Flow Integration)
// ─────────────────────────────────────────────────────────────────────────────

export interface WindLayerInput {
  /** 구름 고도(m, 예: 하층 1500m, 중층 5500m, 상층 9500m). */
  altitudeM: number;
  /** 바람이 불어오는 기상 방위각(도, 북=0 시계방향: 270=서풍 → 동쪽으로 이동). */
  windFromDeg: number;
  /** 풍속(m/s). */
  speedMs: number;
  /** 해당 층 운량 가중치(0..1). */
  weight: number;
}

export interface CloudFlowTap {
  du: number;
  dv: number;
  weight: number;
}

export interface CloudFlowKernelResult {
  /** 화면 중심 기준 총 구름 이동 벡터(정규화 UV). */
  flowUv: [number, number];
  /** 방향성 모션 적분용 샘플 탭 목록(가중치 합=1.0). */
  taps: CloudFlowTap[];
  /** 원하는 구름 결 길이(화면 폭 비율)에 도달하기 위한 권장 노출 시간(초). */
  recommendedDurationSec: number;
}

/**
 * 850/500/300hPa 3D 풍향·풍속 벡터를 카메라 화면 2D UV 이동 벡터로 투영해
 * 네이티브 셰이더에서 ND1000 구름 결을 적분할 방향성 모션 커널 탭을 생성합니다.
 */
export function computeCloudFlowKernel(
  windLayers: readonly WindLayerInput[],
  attitude: Attitude,
  intrinsics: Intrinsics,
  opts: {
    /** 시뮬레이션 장노출 시간(초). 기본 15초. */
    durationSec?: number;
    /** 커널 샘플 탭 수(홀수 권장, 5..31). 기본 15. */
    taps?: number;
    /** 권장 노출 시간 계산용 목표 줄무늬 길이(화면 폭 비율). 기본 0.08. */
    targetStreakNorm?: number;
  } = {},
): CloudFlowKernelResult {
  const duration = Math.max(0.5, opts.durationSec ?? 15);
  const tapCount = Math.max(3, Math.min(31, Math.round(opts.taps ?? 15)));
  const targetStreak = clamp(opts.targetStreakNorm ?? 0.08, 0.01, 0.4);

  const basis = cameraBasis(attitude);
  // 카메라가 바라보는 하늘의 유효 고도각(최소 8°로 수평 무한대 발산 방지)
  const effElRad = Math.max(8, attitude.pitchDeg) * D2R;
  const sinEl = Math.sin(effElRad);

  let vxWorld = 0; // 동(+)
  let vyWorld = 0; // 북(+)
  let distSum = 0;
  let wSum = 0;

  for (const layer of windLayers) {
    if (layer.weight <= 0 || layer.speedMs <= 0) continue;
    // 기상 풍향(불어오는 방향) → 구름 이동 방향(+180°)
    const moveAz = (layer.windFromDeg + 180) * D2R;
    vxWorld += Math.sin(moveAz) * layer.speedMs * layer.weight;
    vyWorld += Math.cos(moveAz) * layer.speedMs * layer.weight;
    distSum += (Math.max(500, layer.altitudeM) / sinEl) * layer.weight;
    wSum += layer.weight;
  }

  if (wSum <= 1e-6) {
    return {
      flowUv: [0, 0],
      taps: [{ du: 0, dv: 0, weight: 1 }],
      recommendedDurationSec: duration,
    };
  }

  vxWorld /= wSum;
  vyWorld /= wSum;
  const cloudDistM = Math.max(800, distSum / wSum);

  // 월드 수평 속도(vxWorld, vyWorld, 0)를 카메라 평면(r, -u)으로 투영
  const vRight = vxWorld * basis.r[0] + vyWorld * basis.r[1];
  const vDown = -(vxWorld * basis.u[0] + vyWorld * basis.u[1]);

  const fxNorm = intrinsics.fx / Math.max(1, intrinsics.width);
  const fyNorm = intrinsics.fy / Math.max(1, intrinsics.height);
  const duPerSec = (vRight / cloudDistM) * fxNorm;
  const dvPerSec = (vDown / cloudDistM) * fyNorm;

  const speedUvPerSec = Math.hypot(duPerSec, dvPerSec);
  const recommendedDurationSec = speedUvPerSec > 1e-6
    ? clamp(targetStreak / speedUvPerSec, 1, 240)
    : duration;

  let flowU = clamp(duPerSec * duration, -0.35, 0.35);
  let flowV = clamp(dvPerSec * duration, -0.35, 0.35);
  const flowMag = Math.hypot(flowU, flowV);
  const minVisualMag = clamp(0.022 * (duration / 10), 0.012, 0.16);
  if (flowMag < minVisualMag) {
    if (flowMag > 1e-5) {
      const scale = minVisualMag / flowMag;
      flowU *= scale;
      flowV *= scale;
    } else {
      flowU = minVisualMag;
      flowV = -minVisualMag * 0.18;
    }
  }

  // 가우시안-테이퍼 방향성 커널 탭 생성(양 끝단 계단 아티팩트 방지)
  const taps: CloudFlowTap[] = [];
  let tapWSum = 0;
  for (let i = 0; i < tapCount; i++) {
    const s = tapCount === 1 ? 0 : i / (tapCount - 1) - 0.5; // -0.5 .. +0.5
    const w = Math.exp(-Math.pow(s / 0.42, 2));
    taps.push({ du: flowU * s, dv: flowV * s, weight: w });
    tapWSum += w;
  }
  for (const t of taps) t.weight /= tapWSum;

  return { flowUv: [flowU, flowV], taps, recommendedDurationSec };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 시간차 하이브리드 촬영 (블루아워 앵커 + 야간 자동 셔터 매칭)
// ─────────────────────────────────────────────────────────────────────────────

export interface SkylineAnchor {
  /** 정규화 열별 능선 Y 시그니처(평균 0, 표준편차 1로 정규화된 1D 기울기/고도 벡터). */
  signature: Float32Array;
  rawSkylineYNorm: Float32Array;
  attitude: Attitude;
  capturedAtMs: number;
}

export interface AnchorMatchResult {
  /** 1D 정규화 상호상관(NCC) 매칭 점수(0..1). 0.95+ 이상이면 고정밀 정렬. */
  matchScore: number;
  /** 최적 수평 시프트(열 단위, 음수=왼쪽으로 돌리기 필요, 양수=오른쪽). */
  shiftCols: number;
  /** 합성 시 앵커 프레임에 맞추기 위한 정규화 UV 오프셋 [du, dv]. */
  alignOffsetUv: [number, number];
  /** 자세 오차(도). */
  dYawDeg: number;
  dPitchDeg: number;
  dRollDeg: number;
  /** 자동 셔터(Auto-Trigger) 발동 여부. */
  shouldTrigger: boolean;
}

/** 1D 능선 곡선을 평균-제거·표준화 시그니처로 변환(조명/수직 오프셋 불변). */
function normalizeSkylineSignature(yNorm: Float32Array): Float32Array {
  const n = yNorm.length;
  const out = new Float32Array(n);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(yNorm[i])) {
      sum += yNorm[i];
      valid++;
    }
  }
  if (valid < 4) return out;
  const mean = sum / valid;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(yNorm[i]) ? yNorm[i] - mean : 0;
    out[i] = v;
    sq += v * v;
  }
  const std = Math.sqrt(sq / valid);
  if (std > 1e-6) {
    for (let i = 0; i < n; i++) out[i] /= std;
  }
  return out;
}

/** 블루아워에 촬영한 기준 프레임의 능선 앵커를 저장합니다. */
export function createSkylineAnchor(
  skylineYNorm: Float32Array,
  attitude: Attitude,
  capturedAtMs = Date.now(),
): SkylineAnchor {
  return {
    signature: normalizeSkylineSignature(skylineYNorm),
    rawSkylineYNorm: new Float32Array(skylineYNorm),
    attitude: { ...attitude },
    capturedAtMs,
  };
}

/**
 * 재방문 야간 촬영 시 실시간 능선과 앵커를 1D 상호상관(NCC)으로 대조해
 * 정렬 가이드 오차와 자동 셔터 트리거 여부를 계산합니다.
 */
export function matchSkylineAnchor(
  anchor: SkylineAnchor,
  liveSkylineYNorm: Float32Array,
  liveAttitude: Attitude,
  opts: {
    /** 자동 셔터 발동 NCC 임계값. 기본 0.96. */
    triggerMatchThreshold?: number;
    /** 자동 셔터 허용 최대 자세 오차(도). 기본 1.5°. */
    maxAttitudeErrDeg?: number;
    /** 탐색할 최대 수평 시프트(열 수). 기본 n/4. */
    maxShiftCols?: number;
  } = {},
): AnchorMatchResult {
  const aSig = anchor.signature;
  const lSig = normalizeSkylineSignature(liveSkylineYNorm);
  const n = Math.min(aSig.length, lSig.length);
  const maxShift = Math.min(Math.floor(n / 3), Math.max(1, Math.round(opts.maxShiftCols ?? n / 4)));

  let bestCorr = -1;
  let bestShift = 0;

  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let dot = 0;
    let aNorm = 0;
    let lNorm = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const j = i + shift;
      if (j < 0 || j >= n) continue;
      dot += aSig[i] * lSig[j];
      aNorm += aSig[i] * aSig[i];
      lNorm += lSig[j] * lSig[j];
      count++;
    }
    if (count < 4) continue;
    const denom = Math.sqrt(aNorm * lNorm);
    const corr = denom > 1e-8 ? dot / denom : 0;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestShift = shift;
    }
  }

  // 최적 수평 시프트 위치에서의 평균 수직 오프셋(dv) 계산
  let dvSum = 0;
  let dvCount = 0;
  for (let i = 0; i < n; i++) {
    const j = i + bestShift;
    if (j < 0 || j >= n) continue;
    const ay = anchor.rawSkylineYNorm[i];
    const ly = liveSkylineYNorm[j];
    if (Number.isFinite(ay) && Number.isFinite(ly)) {
      dvSum += ly - ay;
      dvCount++;
    }
  }

  const matchScore = clamp(bestCorr, 0, 1);
  const du = n > 0 ? bestShift / n : 0;
  const dv = dvCount > 0 ? dvSum / dvCount : 0;

  const dYawDeg = wrap180(liveAttitude.yawDeg - anchor.attitude.yawDeg);
  const dPitchDeg = liveAttitude.pitchDeg - anchor.attitude.pitchDeg;
  const dRollDeg = wrap180(liveAttitude.rollDeg - anchor.attitude.rollDeg);

  const thresh = clamp(opts.triggerMatchThreshold ?? 0.96, 0.7, 0.999);
  const maxDeg = Math.max(0.2, opts.maxAttitudeErrDeg ?? 1.5);
  const shouldTrigger =
    matchScore >= thresh &&
    Math.abs(bestShift) <= 1 &&
    Math.abs(dYawDeg) <= maxDeg &&
    Math.abs(dPitchDeg) <= maxDeg &&
    Math.abs(dRollDeg) <= maxDeg;

  return {
    matchScore,
    shiftCols: bestShift,
    alignOffsetUv: [du, dv],
    dYawDeg,
    dPitchDeg,
    dRollDeg,
    shouldTrigger,
  };
}
