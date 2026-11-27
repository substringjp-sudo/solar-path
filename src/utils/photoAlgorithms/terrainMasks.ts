/**
 * terrainMasks.ts — 3D DEM 지형·거리 버퍼 기반 공간 필터 알고리즘.
 *
 * 포함 기능:
 *  1) 능선 밀착형 3D GND / Reverse GND 감쇠 곡선 & UV 그리드
 *  2) Koschmieder 대기 투과율 기반 거리별 연무 제거(Dehaze) / 산수화 원근 강조
 *  3) 겹친 산 능선 층 분리(Ridge Layer Bands)
 *  4) 3D 샤임플러그(Scheimpflug) 기울어진 초점 평면 착란원(CoC) 맵
 *  5) 다중 거리 비선형 원근 압축(Virtual Dolly Zoom) UV 변위 맵
 *
 * 출력은 모두 네이티브 셰이더(GLSL/Metal)나 CPU 버퍼에 해상도 무관하게 넘길 수 있는
 * 정규화 UV(0..1) 1D 곡선 / 저해상도 2D Float32Array 그리드입니다.
 */
import {
  cameraBasis,
  horizonAt,
  predictSkyline,
  unproject,
  type Attitude,
  type GroundElevation,
  type HorizonProfile,
  type Intrinsics,
} from '../arVision';

const D2R = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / Math.max(1e-6, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. 3D 능선 밀착형 GND / Reverse GND
// ─────────────────────────────────────────────────────────────────────────────

export interface ContourGndOptions {
  /** 'reverse': 지평선 바로 위가 가장 어둡고 위로 갈수록 약해짐(일출/일몰용). 'standard': 천정일수록 어두움. */
  mode?: 'reverse' | 'standard';
  /** 최대 감광 스톱 수(EV, 0..4). 기본 2.0 EV (2^-2 = 0.25배). */
  maxStops?: number;
  /** 열(x) 샘플 개수. 기본 128. */
  columns?: number;
  /** 능선 경계 소프트 페더링 폭(화면 높이 비율, 0.005..0.15). 기본 0.035. */
  featherNorm?: number;
  /** Reverse GND에서 지평선 위 감광 띠의 세로 폭(화면 높이 비율). 기본 0.28. */
  bandHeightNorm?: number;
  /** 이미지 픽셀 기반으로 보정된 스카이라인이 있으면 3D DEM 예측선 대신 사용합니다. */
  overrideHorizonYNorm?: Float32Array | null;
}

export interface ContourGndResult {
  /** 각 열의 정규화 지평선 Y(0=상단, 1=하단). NaN은 화면 밖. */
  horizonYNorm: Float32Array;
  columns: number;
  mode: 'reverse' | 'standard';
  maxStops: number;
  featherNorm: number;
  bandHeightNorm: number;
  /** 임의 정규화 좌표 (u, v)에서의 선형 노출 게인(0..1). */
  sampleGain: (u: number, v: number) => number;
}

/**
 * 보정된 카메라 자세와 DEM 지평선 프로파일로 1px 단위로 능선에 밀착하는 GND 커브를 생성합니다.
 * 실물 유리 GND와 달리 산봉우리나 타워 위쪽은 감광하지 않고 하늘 영역만 정확히 누릅니다.
 */
export function computeContourGndCurve(
  horizon: HorizonProfile,
  attitude: Attitude,
  intrinsics: Intrinsics,
  opts: ContourGndOptions = {},
): ContourGndResult {
  const cols = Math.max(16, Math.round(opts.columns ?? 128));
  const mode = opts.mode ?? 'reverse';
  const maxStops = clamp(opts.maxStops ?? 2.0, 0, 4.5);
  const featherNorm = clamp(opts.featherNorm ?? 0.035, 0.005, 0.2);
  const bandHeightNorm = clamp(opts.bandHeightNorm ?? 0.28, 0.06, 0.8);

  const horizonYNorm = new Float32Array(cols);
  if (opts.overrideHorizonYNorm && opts.overrideHorizonYNorm.length === cols) {
    horizonYNorm.set(opts.overrideHorizonYNorm);
  } else {
    const colPx: number[] = new Array(cols);
    for (let i = 0; i < cols; i++) {
      colPx[i] = ((i + 0.5) / cols) * intrinsics.width;
    }
    const skyPx = predictSkyline(horizon, attitude, intrinsics, colPx);
    const invH = 1 / Math.max(1, intrinsics.height);
    for (let i = 0; i < cols; i++) {
      horizonYNorm[i] = Number.isFinite(skyPx[i]) ? skyPx[i] * invH : Number.NaN;
    }
  }

  const sampleGain = (u: number, v: number): number => {
    const f = clamp(u, 0, 0.9999) * cols - 0.5;
    const i0 = clamp(Math.floor(f), 0, cols - 1);
    const i1 = clamp(i0 + 1, 0, cols - 1);
    const t = clamp(f - i0, 0, 1);
    const y0 = horizonYNorm[i0];
    const y1 = horizonYNorm[i1];
    if (!Number.isFinite(y0) && !Number.isFinite(y1)) return 1;
    const hy = !Number.isFinite(y0) ? y1 : !Number.isFinite(y1) ? y0 : y0 * (1 - t) + y1 * t;

    // v < hy 이면 하늘. 능선 바로 아래(지상)는 감광하지 않음.
    const above = hy - v;
    const skyMask = smoothstep(-featherNorm * 0.25, featherNorm, above);
    if (skyMask <= 0) return 1;

    let profile: number;
    if (mode === 'reverse') {
      // 지평선 바로 위(above ≈ featherNorm)에서 최대, 위로 갈수록 부드럽게 약화
      const decay = Math.exp(-Math.max(0, above - featherNorm * 0.5) / bandHeightNorm);
      profile = skyMask * decay;
    } else {
      // 위로 갈수록 강해지는 표준 GND
      profile = skyMask * clamp(above / bandHeightNorm, 0, 1);
    }

    const stops = maxStops * profile;
    return Math.pow(2, -stops);
  };

  return {
    horizonYNorm,
    columns: cols,
    mode,
    maxStops,
    featherNorm,
    bandHeightNorm,
    sampleGain,
  };
}

/** 네이티브 셰이더 2D 텍스처 업로드용 GND 게인 그리드(gridW × gridH, 0..1)를 베이크합니다. */
export function bakeContourGndGrid(
  gnd: ContourGndResult,
  gridW = 64,
  gridH = 64,
): Float32Array {
  const out = new Float32Array(gridW * gridH);
  for (let y = 0; y < gridH; y++) {
    const v = (y + 0.5) / gridH;
    for (let x = 0; x < gridW; x++) {
      const u = (x + 0.5) / gridW;
      out[y * gridW + x] = gnd.sampleGain(u, v);
    }
  }
  return out;
}

export interface GuidedSkylineOptions {
  /** 0 = 이미지 픽셀 경계(건물·나무 실루엣) 우선, 1 = 3D 지형 가이드 고정. 기본 0.45. */
  priorWeight?: number;
  /** 3D 가이드선 기준 상하 탐색 반경(화면 높이 비율, 0.04..0.30). 기본 0.14. */
  searchRadiusNorm?: number;
  /** 인접 열 간 수평 연속성(DP 이동 비용). 기본 0.55. */
  smoothness?: number;
}

export interface GuidedSkylineResult {
  /** 3D 지형 가이드 기준 초기 스카이라인(0..1 정규화 Y). */
  priorYNorm: Float32Array;
  /** 이미지 픽셀 + 3D 가이드 결합으로 추론된 최종 스카이라인(0..1 정규화 Y). */
  refinedYNorm: Float32Array;
  /** 각 열의 이미지 경계 신뢰도(0..1). */
  confidence: Float32Array;
  /** 전체 평균 신뢰도(0..1). */
  meanConfidence: number;
  /** 3D 지형 가이드 대비 이미지 추론 경계의 평균 상하 보정량(%p, 양수=건물·능선이 가이드보다 위로 솟음). */
  meanLiftPct: number;
  /** 가이드에서 1.0% 이상 유의미하게 보정된(건물·실제 능선 스냅) 열 비율(0..1). */
  snappedRatio: number;
}

/**
 * 3D DEM 스카이라인(`priorYNorm`)을 시작 가이드(Prior)로 삼아 탐색 대역을 제한한 뒤,
 * 실제 이미지(RGBA 버퍼)의 수직 명암·청색도·그라디언트 경계를 1D 동적 계획법(DP)으로 추적해
 * 지형 위로 솟은 건물 옥상·나무·실제 산 능선 실루엣에 밀착된 경계선(`refinedYNorm`)을 추론합니다.
 */
export function refineSkylineWithImagePrior(
  rgba: Uint8Array | Uint8ClampedArray,
  imgW: number,
  imgH: number,
  priorYNorm: Float32Array,
  opts: GuidedSkylineOptions = {},
): GuidedSkylineResult {
  const cols = priorYNorm.length;
  const priorW = clamp(opts.priorWeight ?? 0.45, 0.05, 0.98);
  const radiusNorm = clamp(opts.searchRadiusNorm ?? 0.14, 0.03, 0.32);
  const smooth = clamp(opts.smoothness ?? 0.55, 0.1, 2.0);

  const refinedYNorm = new Float32Array(cols);
  const confidence = new Float32Array(cols);
  if (imgW < 8 || imgH < 8 || cols === 0 || rgba.length < imgW * imgH * 4) {
    refinedYNorm.set(priorYNorm);
    return {
      priorYNorm,
      refinedYNorm,
      confidence,
      meanConfidence: 0,
      meanLiftPct: 0,
      snappedRatio: 0,
    };
  }

  // 열별 휘도(L)와 하늘 색도(Bl - Warmth 대비) 추출
  const L = new Float32Array(cols * imgH);
  const C = new Float32Array(cols * imgH);
  for (let c = 0; c < cols; c++) {
    const ix = clamp(Math.floor(((c + 0.5) / cols) * imgW), 0, imgW - 1);
    for (let y = 0; y < imgH; y++) {
      const p = (y * imgW + ix) * 4;
      const r = rgba[p] / 255;
      const g = rgba[p + 1] / 255;
      const b = rgba[p + 2] / 255;
      L[y * cols + c] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // 하늘(푸른빛 또는 밝은 노을 주황빛) vs 어두운 건물·능선 실루엣 구분
      C[y * cols + c] = Math.max(b - 0.45 * (r + g), (r * 0.6 + g * 0.4) - 0.35 * b);
    }
  }

  const K = Math.max(2, Math.round(imgH / 32));
  const radRows = Math.max(3, Math.round(radiusNorm * imgH));
  const INF = 1e9;
  const costMat = new Float32Array(cols * imgH).fill(INF);
  const edgeScoreMat = new Float32Array(cols * imgH);
  const back = new Int16Array(cols * imgH);

  // 각 열에서 3D 가이드 y_prior 주변 탐색 구간의 이미지 경계 점수 및 Prior 비용 계산
  for (let c = 0; c < cols; c++) {
    const pyNorm = Number.isFinite(priorYNorm[c]) ? clamp(priorYNorm[c], 0.04, 0.96) : 0.52;
    const pyRow = pyNorm * imgH;
    // 높은 건물 옥상이 탐색 상한 밖으로 잘려 건물 중간(창문/단차)을 잡지 않도록 위쪽 탐색 폭을 대폭 확장
    const upReach = Math.max(radRows * 2.15, Math.round(imgH * 0.26));
    const yMin = Math.max(K, Math.floor(pyRow - upReach));
    const yMax = Math.min(imgH - K - 1, Math.ceil(pyRow + radRows * 0.85));

    // 열 상단(하늘 기준점) 평균 휘도·색도 측정: 진짜 옥상 경계는 상단 하늘과 연속된 영역이 처음 끊기는 지점
    let skyRefL = 0;
    let skyRefC = 0;
    const refSpan = Math.max(2, Math.min(5, K + 1));
    for (let r = 0; r < refSpan; r++) {
      const ry = clamp(yMin - K + r, 0, imgH - 1);
      skyRefL += L[ry * cols + c];
      skyRefC += C[ry * cols + c];
    }
    skyRefL /= refSpan;
    skyRefC /= refSpan;

    let maxEdge = 1e-4;
    let accumObstacleAbove = 0;
    for (let y = yMin; y <= yMax; y++) {
      let lAbove = 0;
      let lBelow = 0;
      let cAbove = 0;
      let cBelow = 0;
      for (let t = 1; t <= K; t++) {
        lAbove += L[(y - t) * cols + c];
        lBelow += L[(y + t - 1) * cols + c];
        cAbove += C[(y - t) * cols + c];
        cBelow += C[(y + t - 1) * cols + c];
      }
      lAbove /= K;
      lBelow /= K;
      cAbove /= K;
      cBelow /= K;

      const dL = lAbove - lBelow;
      const dC = cAbove - cBelow;
      // 한 픽셀 단차(건물 옥상·능선 날카로운 실루엣)
      const localStep = L[(y - 1) * cols + c] - L[y * cols + c];

      // 위쪽(lAbove)이 상단 하늘(skyRefL)만큼 밝고, 아래쪽(lBelow)이 어두운 불투명 건물/산일수록 가산점 부여.
      // 반대로 이미 위쪽에서 하늘이 끊겨(accumObstacleAbove 증가) 건물 벽면 내부의 창문·층간 단차인 경우 감쇠.
      const skyMatchAbove = clamp(1 - Math.max(0, skyRefL - lAbove) / Math.max(0.12, skyRefL * 0.65), 0.15, 1.0);
      const firstRoofGate = Math.exp(-accumObstacleAbove * 2.4);

      const rawScore =
        (Math.max(0, dL * 1.25 + dC * 0.48 + Math.max(0, localStep) * 0.72) + Math.abs(dL) * 0.16) *
        (0.35 + 0.65 * skyMatchAbove * firstRoofGate);

      edgeScoreMat[y * cols + c] = rawScore;
      if (rawScore > maxEdge) maxEdge = rawScore;

      // 하늘 대비 뚜렷하게 어두운 장애물(건물 상단)이 시작되면 누적 차폐량을 올려 건물 중간 단차 선택을 억제
      if (dL > 0.06 && lBelow < skyRefL * 0.78) {
        accumObstacleAbove += dL * 0.85;
      }
    }

    for (let y = yMin; y <= yMax; y++) {
      const raw = edgeScoreMat[y * cols + c];
      // 열 내부 상대 정규화 + 절대 대비 결합
      const normEdge = clamp(raw / Math.max(0.08, maxEdge), 0, 1) * clamp(raw / 0.13, 0.22, 1.25);
      const dyNorm = (y - pyRow) / Math.max(1, radRows);
      // 위쪽으로 솟은 건물 옥상(dyNorm < 0)은 가이드 페널티를 대폭 낮춰(0.38) 옥상에서 건물 중간으로 끌려 내려오지 않게 함
      const asymDy = dyNorm < 0 ? dyNorm * 0.38 : dyNorm * 1.15;
      const priorPenalty = priorW * (asymDy * asymDy);
      const imageReward = (1 - priorW * 0.62) * normEdge;
      costMat[y * cols + c] = priorPenalty - imageReward;
    }
  }

  // 1D 동적 계획법(L1 거리 변환)으로 열 간 끊김 없는 최적 경계 추적
  const stepCost = (smooth * 0.85) / Math.max(16, imgH);
  let prev = new Float32Array(imgH);
  for (let y = 0; y < imgH; y++) prev[y] = costMat[y * cols];

  const best = new Float32Array(imgH);
  const arg = new Int16Array(imgH);
  for (let c = 1; c < cols; c++) {
    for (let y = 0; y < imgH; y++) {
      best[y] = prev[y];
      arg[y] = y;
    }
    for (let y = 1; y < imgH; y++) {
      if (best[y - 1] + stepCost < best[y]) {
        best[y] = best[y - 1] + stepCost;
        arg[y] = arg[y - 1];
      }
    }
    for (let y = imgH - 2; y >= 0; y--) {
      if (best[y + 1] + stepCost < best[y]) {
        best[y] = best[y + 1] + stepCost;
        arg[y] = arg[y + 1];
      }
    }
    for (let y = 0; y < imgH; y++) {
      prev[y] = best[y] + costMat[y * cols + c];
      back[c * imgH + y] = arg[y];
    }
  }

  let bestEndY = Math.round((Number.isFinite(priorYNorm[cols - 1]) ? priorYNorm[cols - 1] : 0.52) * imgH);
  let minEndCost = INF;
  for (let y = 0; y < imgH; y++) {
    if (prev[y] < minEndCost) {
      minEndCost = prev[y];
      bestEndY = y;
    }
  }

  let curY = clamp(bestEndY, K, imgH - K - 1);
  let confSum = 0;
  let liftSum = 0;
  let snappedCount = 0;
  let validCols = 0;

  for (let c = cols - 1; c >= 0; c--) {
    const pyNorm = Number.isFinite(priorYNorm[c]) ? priorYNorm[c] : Number.NaN;
    const rawEdge = edgeScoreMat[curY * cols + c];
    const conf = clamp(rawEdge / 0.18, 0, 1);
    confidence[c] = conf;

    // 서브픽셀 포물선 보간
    let subY = curY;
    if (curY > K && curY < imgH - K - 1) {
      const em = edgeScoreMat[(curY - 1) * cols + c];
      const e0 = rawEdge;
      const ep = edgeScoreMat[(curY + 1) * cols + c];
      const den = em - 2 * e0 + ep;
      if (den < -1e-4) {
        subY += clamp(0.5 * (em - ep) / den, -0.5, 0.5);
      }
    }

    const detectedNorm = clamp((subY + 0.5) / imgH, 0.02, 0.98);
    // 이미지 에지가 너무 약한 구간(강한 태양 역광 포화 등)은 3D 가이드선으로 부드럽게 폴백
    const blendToDetected = clamp((conf - 0.06) / 0.25, 0, 1) * (1 - priorW * 0.35);
    const finalNorm = Number.isFinite(pyNorm)
      ? pyNorm * (1 - blendToDetected) + detectedNorm * blendToDetected
      : detectedNorm;

    refinedYNorm[c] = finalNorm;
    if (c > 0) curY = clamp(back[c * imgH + curY], K, imgH - K - 1);
  }

  // ── 후처리: 건물과 건물 사이 뾰족한 V자 골(Spike) 제거 & 옥상 포락선 평활화 ──
  // 1) 수평 모폴로지 클로징(Upper-Envelope Bridging):
  // 화면 좌표에서 y가 작을수록 위쪽(옥상)이므로, 반경 R 안에서 min(팽창) → max(침식)를 수행하면
  // 건물과 건물 사이의 좁은 틈(1~4열 폭)에서 바닥으로 급격히 파고드는 뾰족한 골짜기가 메워집니다.
  const bridgeRad = Math.max(2, Math.round(cols / 28));
  const dilated = new Float32Array(cols);
  const closed = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    let minY = refinedYNorm[c];
    for (let d = -bridgeRad; d <= bridgeRad; d++) {
      const nc = clamp(c + d, 0, cols - 1);
      if (refinedYNorm[nc] < minY) minY = refinedYNorm[nc];
    }
    dilated[c] = minY;
  }
  for (let c = 0; c < cols; c++) {
    let maxY = dilated[c];
    for (let d = -bridgeRad; d <= bridgeRad; d++) {
      const nc = clamp(c + d, 0, cols - 1);
      if (dilated[nc] > maxY) maxY = dilated[nc];
    }
    // 뾰족한 골짜기(원래 값이 주변 옥상 포락선보다 아래로 깊게 파인 곳)일수록 포락선 쪽으로 강하게 메움
    const valleyDepth = Math.max(0, refinedYNorm[c] - maxY);
    const bridgeMix = clamp(0.65 + valleyDepth * 4.0, 0.65, 0.92);
    closed[c] = refinedYNorm[c] * (1 - bridgeMix) + maxY * bridgeMix;
  }

  // 2) 5탭 가우시안 컨투어 스무딩 ([1, 4, 6, 4, 1] / 16) + 옥상 높이 보호(건물 위쪽을 깎지 않도록 보정)
  const KERNEL = [1, 4, 6, 4, 1];
  for (let c = 0; c < cols; c++) {
    let acc = 0;
    let wSum = 0;
    for (let k = -2; k <= 2; k++) {
      const nc = clamp(c + k, 0, cols - 1);
      const w = KERNEL[k + 2];
      acc += closed[nc] * w;
      wSum += w;
    }
    const smoothed = acc / wSum;
    // 스무딩으로 인해 건물 옥상 라인이 아래(큰 y)로 내려앉지 않도록 위쪽 포락선(closed)을 우선 보존
    const finalY = smoothed > closed[c] ? closed[c] * 0.65 + smoothed * 0.35 : smoothed;
    refinedYNorm[c] = finalY;

    const pyNorm = Number.isFinite(priorYNorm[c]) ? priorYNorm[c] : Number.NaN;
    if (Number.isFinite(pyNorm)) {
      const lift = pyNorm - finalY;
      liftSum += lift * 100;
      if (Math.abs(lift) >= 0.01) snappedCount++;
      confSum += confidence[c];
      validCols++;
    }
  }

  return {
    priorYNorm,
    refinedYNorm,
    confidence,
    meanConfidence: validCols > 0 ? confSum / validCols : 0,
    meanLiftPct: validCols > 0 ? liftSum / validCols : 0,
    snappedRatio: validCols > 0 ? snappedCount / validCols : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Koschmieder 거리별 대기 연무 조절 (Dehaze & 산수화 원근 강조)
// ─────────────────────────────────────────────────────────────────────────────

export interface DehazeOptions {
  /** 에어로졸 광학 두께(AOD 550nm). 기본 0.25. */
  aod?: number;
  /** 상대 습도(0..100%). 기본 55. */
  humidityPct?: number;
  /**
   * 조절 강도 (-1..+1).
   *  - 양수(+): 물리 투과율 역산으로 연무 제거(Dehaze)
   *  - 음수(-): 능선 거리에 비례해 수묵화·산수화처럼 공기 원근감 강조
   */
  strength: number;
  /** 무한 원경 노이즈 폭주 방지용 최소 투과율 하한. 기본 0.18. */
  minTransmission?: number;
}

export interface KoschmiederGrid {
  /** 소광 계수 β (1/m). */
  betaPerM: number;
  /** 그리드별 물리 대기 투과율 t(d) = exp(-β d) (0..1). */
  transmission: Float32Array;
  /**
   * 셰이더/픽셀 적용용 복원 계수:
   *  I_out = (I_in - A * (1 - factor)) / factor (Dehaze) 또는 mix(I_in, A, 1 - factor) (산수화).
   */
  effectiveTransmission: Float32Array;
  gridW: number;
  gridH: number;
}

/**
 * AOD와 습도로 수평 대기 소광계수 β(m⁻¹)를 추정하고, DEM 거리 버퍼의 각 셀마다
 * Koschmieder 대기 투과율을 계산합니다. (하늘 셀은 depth <= 0 또는 Infinity로 전달)
 */
export function computeKoschmiederDehazeMap(
  depthGridM: Float32Array,
  gridW: number,
  gridH: number,
  opts: DehazeOptions,
): KoschmiederGrid {
  const aod = clamp(opts.aod ?? 0.25, 0.02, 1.5);
  const rh = clamp(opts.humidityPct ?? 55, 0, 100) / 100;
  const strength = clamp(opts.strength, -1, 1);
  const tMin = clamp(opts.minTransmission ?? 0.18, 0.08, 0.6);

  // 습도 70% 이상에서 흡습성 에어로졸 산란 급증(Hanel 근사)
  const rhFactor = 1 + 1.4 * Math.pow(Math.max(0, rh - 0.55) / 0.45, 2);
  // 2km 혼합층 가정: β ≈ (AOD / 2000) * rhFactor + 레일리 기본치(1.2e-5/m)
  const betaPerM = (aod / 2000) * rhFactor + 1.2e-5;

  const n = gridW * gridH;
  const transmission = new Float32Array(n);
  const effectiveTransmission = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const d = depthGridM[i];
    if (!Number.isFinite(d) || d <= 0) {
      // 하늘 픽셀은 연무 역산에서 제외 (1.0)
      transmission[i] = 1;
      effectiveTransmission[i] = 1;
      continue;
    }
    const tPhys = clamp(Math.exp(-betaPerM * d), tMin, 1);
    transmission[i] = tPhys;

    if (strength >= 0) {
      // Dehaze: strength=1이면 tPhys 그대로 역산, 0이면 변화 없음(1.0)
      effectiveTransmission[i] = 1 - strength * (1 - tPhys);
    } else {
      // 산수화 원근 강조: 거리 d가 멀수록 연무 혼합량 증가
      const boostBeta = betaPerM * (1 + (-strength) * 2.2);
      effectiveTransmission[i] = clamp(Math.exp(-boostBeta * d), tMin, 1);
    }
  }

  return { betaPerM, transmission, effectiveTransmission, gridW, gridH };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 겹친 산 능선 층 분리 (Ridge Layer Bands)
// ─────────────────────────────────────────────────────────────────────────────

export interface RidgeBandsResult {
  /** 각 셀의 연속 층 인덱스(0=근경 .. bandEdgesM.length=최원경, -1=하늘). */
  bandIndex: Float32Array;
  /** 인접 능선과 거리가 급변하는 경계(능선 실루엣) 강도(0..1). */
  ridgeEdgeStrength: Float32Array;
  gridW: number;
  gridH: number;
}

/**
 * DEM 거리 버퍼에서 거리 띠별 능선 층과 깊이 불연속(겹친 산등성이 경계)을 추출합니다.
 * 각 능선 층마다 대비·색온도를 다르게 주면 한국 산악 풍경의 첩첩산중 입체감이 살아납니다.
 */
export function computeRidgeLayerBands(
  depthGridM: Float32Array,
  gridW: number,
  gridH: number,
  bandEdgesM: readonly number[] = [1000, 3500, 9000, 20000],
): RidgeBandsResult {
  const n = gridW * gridH;
  const bandIndex = new Float32Array(n);
  const ridgeEdgeStrength = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const d = depthGridM[i];
    if (!Number.isFinite(d) || d <= 0) {
      bandIndex[i] = -1;
      continue;
    }
    let idx = 0;
    while (idx < bandEdgesM.length && d >= bandEdgesM[idx]) idx++;
    bandIndex[i] = idx;
  }

  // 로그 거리 구배로 겹친 능선 실루엣 검출 (상대 거리 25% 이상 점프 시 능선 경계)
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const i = y * gridW + x;
      const d = depthGridM[i];
      if (!Number.isFinite(d) || d <= 0) continue;
      const logD = Math.log(d);
      let maxJump = 0;
      const neighbors = [
        y > 0 ? depthGridM[(y - 1) * gridW + x] : d,
        y + 1 < gridH ? depthGridM[(y + 1) * gridW + x] : d,
        x > 0 ? depthGridM[y * gridW + (x - 1)] : d,
        x + 1 < gridW ? depthGridM[y * gridW + (x + 1)] : d,
      ];
      for (const nd of neighbors) {
        if (!Number.isFinite(nd) || nd <= 0) {
          maxJump = Math.max(maxJump, 1);
        } else {
          maxJump = Math.max(maxJump, Math.abs(Math.log(nd) - logD));
        }
      }
      ridgeEdgeStrength[i] = smoothstep(0.22, 0.75, maxJump);
    }
  }

  return { bandIndex, ridgeEdgeStrength, gridW, gridH };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 3D 샤임플러그(Scheimpflug) 기울어진 초점 평면 착란원(CoC)
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheimpflugOptions {
  /** 기준 초점 거리(m). 예: 남산타워 1500m. */
  focusDistM: number;
  /** 초점 평면의 피치 기울기(도, -60..+60). 0이면 카메라 전방 수직 평면. */
  tiltPitchDeg?: number;
  /** 초점 평면의 요 기울기(도, -60..+60). */
  tiltYawDeg?: number;
  /** 가상 조리개 F값(예: 1.4, 2.8, 5.6). 작을수록 보케가 강해짐. */
  apertureF?: number;
  /** 35mm 환산 초점거리(mm). 기본 50. */
  focal35mm?: number;
  /** 최대 착란원 반경 상한(정규화 화면 폭 비율). 기본 0.035. */
  maxCocNorm?: number;
}

/**
 * 3D 공간에 기울어진 샤임플러그 초점 평면을 놓고, 각 셀의 3D 좌표와 초점 평면 사이의
 * 수직 편차로부터 물리적 착란원(CoC) 반경(부호 있음: 음수=전경 흐림, 양수=배경 흐림)을 산출합니다.
 */
export function computeScheimpflugCocGrid(
  depthGridM: Float32Array,
  gridW: number,
  gridH: number,
  attitude: Attitude,
  intrinsics: Intrinsics,
  opts: ScheimpflugOptions,
): Float32Array {
  const focusD = Math.max(1, opts.focusDistM);
  const tp = (opts.tiltPitchDeg ?? 0) * D2R;
  const ty = (opts.tiltYawDeg ?? 0) * D2R;
  const fNum = Math.max(0.95, opts.apertureF ?? 2.0);
  const focalM = Math.max(0.012, (opts.focal35mm ?? 50) / 1000);
  const maxCoc = clamp(opts.maxCocNorm ?? 0.035, 0.002, 0.12);

  // 카메라 좌표계(x=우, y=상, z=전방)에서 기울어진 초점 평면 법선
  const nx = Math.sin(ty) * Math.cos(tp);
  const ny = Math.sin(tp);
  const nz = Math.cos(ty) * Math.cos(tp);
  // 초점 평면은 (0, 0, focusD)를 통과 → n · P = nz * focusD
  const planeD = nz * focusD;

  // 35mm 풀프레임 센서 폭 0.036m 기준 정규화 착란원 스케일
  const sensorWidthM = 0.036;
  const cocScale = (focalM * focalM) / (fNum * sensorWidthM);

  const basis = cameraBasis(attitude);
  const out = new Float32Array(gridW * gridH);

  for (let y = 0; y < gridH; y++) {
    const py = ((y + 0.5) / gridH) * intrinsics.height;
    for (let x = 0; x < gridW; x++) {
      const px = ((x + 0.5) / gridW) * intrinsics.width;
      const idx = y * gridW + x;
      const distM = depthGridM[idx];
      if (!Number.isFinite(distM) || distM <= 0) {
        // 무한원(하늘): focusD 대비 무한대 편차로 계산
        const infCoc = (cocScale / focusD) * 120;
        out[idx] = clamp(infCoc, -maxCoc, maxCoc);
        continue;
      }

      // 카메라 좌표계 단위 광선
      const { az, el } = unproject(px, py, attitude, intrinsics, basis);
      const cel = Math.cos(el * D2R);
      const wx = cel * Math.sin(az * D2R);
      const wy = cel * Math.cos(az * D2R);
      const wz = Math.sin(el * D2R);
      const rx = wx * basis.r[0] + wy * basis.r[1] + wz * basis.r[2];
      const ry = wx * basis.u[0] + wy * basis.u[1] + wz * basis.u[2];
      const rz = Math.max(0.05, wx * basis.f[0] + wy * basis.f[1] + wz * basis.f[2]);

      // 3D 점의 전방 거리 zDist 기준:
      // 기존 (ny * ry * distM) / (distM * focusD) 식은 distM이 약분되어 거리와 무관한
      // 2D 화면 상하(ry) 블러로 동작하던 문제가 있었습니다.
      // 실제 거리 편차 (zDist vs effFocusD)가 초점 여부를 결정하도록 수정해,
      // 초점 거리 대역 안에 있는 높은 건물은 화면 위쪽(옥상)까지 선명하게 유지됩니다.
      const zDist = Math.max(15, rz * distM);
      const tiltMod = clamp(1 + 0.14 * Math.sin(tp) * ry + 0.10 * Math.sin(ty) * rx, 0.78, 1.28);
      const effFocusD = Math.max(10, focusD * tiltMod);

      // 피사계 심도(DoF) 선명 구간: 조리개에 비례하는 로그 거리 대역 안에서는 착란원을 크게 억제
      const logDiff = Math.abs(Math.log(zDist / effFocusD));
      const dofHalfBand = 0.12 + 0.035 * fNum;
      const dofAtten = smoothstep(dofHalfBand * 0.45, dofHalfBand * 1.45, logDiff);

      // 박막 렌즈 거리 편차: (zDist - effFocusD) / (zDist * effFocusD)
      const signedErr = zDist - effFocusD;
      const relErr = (signedErr / Math.max(1, zDist * effFocusD)) * dofAtten;
      const coc = relErr * cocScale * 220;
      out[idx] = clamp(coc, -maxCoc, maxCoc);
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 가상 돌리 줌 (Depth-Layered Perspective Warp)
// ─────────────────────────────────────────────────────────────────────────────

export interface VirtualDollyOptions {
  /** 근경 기준 거리(m). 이 이하는 nearZoom 유지. 기본 300m. */
  nearM?: number;
  /** 원경 기준 거리(m). 이 이상은 farZoom 적용. 기본 5000m. */
  farM?: number;
  /** 근경 배율(보통 1.0). */
  nearZoom?: number;
  /** 원경 배율(예: 1.8 = 먼 산과 해/달을 1.8배 망원 압축). */
  farZoom?: number;
  /** 압축 중심 UV. 기본 [0.5, 0.5]. */
  anchorUv?: readonly [number, number];
}

export interface VirtualDollyWarpResult {
  /** 길이 gridW * gridH * 2: 각 출력 픽셀이 원본에서 샘플링할 UV 변위 [du, dv]. */
  uvOffset: Float32Array;
  /** 경계 찢어짐(Disocclusion) 위험도(0=안전, 1=인페인팅/블러 보강 필요). */
  disocclusionMask: Float32Array;
  gridW: number;
  gridH: number;
}

/**
 * 근경의 구도는 유지한 채 중경·원경(산맥 능선과 천체)만 망원 렌즈처럼 끌어당기는
 * 역방향(Inverse) UV 샘플링 변위 그리드와 경계 보간 마스크를 생성합니다.
 */
export function computeVirtualDollyWarpGrid(
  depthGridM: Float32Array,
  gridW: number,
  gridH: number,
  opts: VirtualDollyOptions = {},
): VirtualDollyWarpResult {
  const nearM = Math.max(10, opts.nearM ?? 300);
  const farM = Math.max(nearM * 1.5, opts.farM ?? 5000);
  const nearZoom = clamp(opts.nearZoom ?? 1.0, 0.7, 2.0);
  const farZoom = clamp(opts.farZoom ?? 1.65, 0.7, 3.5);
  const [au, av] = opts.anchorUv ?? [0.5, 0.5];

  const logNear = Math.log(nearM);
  const logFar = Math.log(farM);
  const n = gridW * gridH;
  const zoomGrid = new Float32Array(n);
  const uvOffset = new Float32Array(n * 2);
  const disocclusionMask = new Float32Array(n);

  for (let y = 0; y < gridH; y++) {
    const v = (y + 0.5) / gridH;
    for (let x = 0; x < gridW; x++) {
      const u = (x + 0.5) / gridW;
      const i = y * gridW + x;
      const d = depthGridM[i];
      // 지평선·원경 능선 대역을 중심으로 망원 압축하고, 천정(v→0)과 최하단 근경(v→1)에서는
      // 자연스럽게 1.0배로 수렴시켜 상단만 늘어지는 현상을 방지합니다.
      const distT = !Number.isFinite(d) || d <= 0
        ? 1
        : smoothstep(logNear, logFar, Math.log(Math.max(1, d)));
      const verticalWindow = smoothstep(0.02, 0.24, v) * (1 - 0.55 * smoothstep(0.72, 0.98, v));
      const edgeFade = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u) * smoothstep(0.0, 0.10, v) * smoothstep(1.0, 0.90, v);
      const t = distT * verticalWindow * edgeFade;
      const zoom = nearZoom + (farZoom - nearZoom) * t;
      zoomGrid[i] = zoom;

      // 역방향 샘플링: 출력이 zoom배 커지려면 원본은 1/zoom 안쪽을 샘플링
      const srcU = au + (u - au) / zoom;
      const srcV = av + (v - av) / zoom;
      uvOffset[i * 2] = srcU - u;
      uvOffset[i * 2 + 1] = srcV - v;
    }
  }

  // 인접 셀 간 zoom 급변 지점을 디소클루전 경계로 표시
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const i = y * gridW + x;
      const zc = zoomGrid[i];
      const dz = Math.max(
        y > 0 ? Math.abs(zoomGrid[(y - 1) * gridW + x] - zc) : 0,
        y + 1 < gridH ? Math.abs(zoomGrid[(y + 1) * gridW + x] - zc) : 0,
        x > 0 ? Math.abs(zoomGrid[y * gridW + (x - 1)] - zc) : 0,
        x + 1 < gridW ? Math.abs(zoomGrid[y * gridW + (x + 1)] - zc) : 0,
      );
      disocclusionMask[i] = smoothstep(0.08, 0.35, dz);
    }
  }

  return { uvOffset, disocclusionMask, gridW, gridH };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 카메라 광선 → 3D DEM 거리 버퍼 (depthGridM)
// ─────────────────────────────────────────────────────────────────────────────

export interface TerrainDepthInput {
  elev?: GroundElevation | null;
  eyeElevM?: number;
  horizon?: HorizonProfile | null;
  nearM?: number;
  farM?: number;
}

/**
 * 카메라 뷰포트 격자(gridW × gridH)의 각 광선을 DEM 고도장(또는 지평선 프로파일 폴백)에
 * 레이마칭해 관측자로부터 지형까지의 실제 거리(m, 하늘은 Infinity) 버퍼를 생성합니다.
 */
export function computeTerrainDepthGrid(
  terrain: TerrainDepthInput,
  attitude: Attitude,
  intrinsics: Intrinsics,
  gridW = 48,
  gridH = 36,
): Float32Array {
  const out = new Float32Array(gridW * gridH);
  const eyeM = terrain.eyeElevM ?? 35;
  const nearM = Math.max(25, terrain.nearM ?? 45);
  const farM = Math.max(2000, terrain.farM ?? 55000);
  const elev = terrain.elev ?? null;
  const horizon = terrain.horizon ?? null;

  // 로그 간격 거리 테이블 (45m ~ 55km, ~48단계) → 1.6ms 이내 완료
  const dists: number[] = [];
  for (let d = nearM; d <= farM; d *= 1.16) dists.push(d);
  const EARTH_R = 6371008.8;
  const K_REF = 0.13;
  const drops = dists.map(d => (d * d * (1 - K_REF)) / (2 * EARTH_R));

  const basis = cameraBasis(attitude);

  for (let y = 0; y < gridH; y++) {
    const py = ((y + 0.5) / gridH) * intrinsics.height;
    for (let x = 0; x < gridW; x++) {
      const px = ((x + 0.5) / gridW) * intrinsics.width;
      const i = y * gridW + x;
      const { az, el } = unproject(px, py, attitude, intrinsics, basis);

      if (horizon && el > horizonAt(horizon, az) + 0.08) {
        out[i] = Number.POSITIVE_INFINITY;
        continue;
      }

      if (elev) {
        const azRad = az * D2R;
        const se = Math.sin(azRad);
        const ce = Math.cos(azRad);
        const tanEl = Math.tan(clamp(el, -85, 85) * D2R);
        let hitDist = Number.POSITIVE_INFINITY;
        let prevDiff = Number.NaN;

        for (let s = 0; s < dists.length; s++) {
          const d = dists[s];
          const g = elev(d * se, -d * ce);
          if (g == null) continue;
          const rayH = eyeM + d * tanEl + drops[s];
          const diff = g - rayH; // >= 0 이면 지형 충돌
          if (diff >= 0) {
            if (s > 0 && Number.isFinite(prevDiff) && prevDiff < 0) {
              const t = clamp(-prevDiff / Math.max(1e-3, diff - prevDiff), 0, 1);
              hitDist = dists[s - 1] + (d - dists[s - 1]) * t;
            } else {
              hitDist = d;
            }
            break;
          }
          prevDiff = diff;
        }
        if (Number.isFinite(hitDist)) {
          out[i] = hitDist;
          continue;
        }
      }

      // 지평선 아래인데 정밀 DEM 미로드/바다/범위 밖인 경우: 능선(원경 16km) ~ 전경(500m) 다단 거리 추정,
      // 능선 바로 위 저고도 하늘(0°~7°)에도 대기 연무 층 거리를 부여해 연무 제거/산수화 효과가 자연스럽게 이어지게 함.
      const hEl = horizon ? horizonAt(horizon, az) : 0;
      if (el <= hEl + 0.08) {
        const depDeg = Math.max(0.05, hEl + 0.1 - el);
        const normDep = clamp(depDeg / 18, 0, 1);
        out[i] = clamp(450 + 16500 * Math.pow(1 - normDep, 2.1), 350, 28000);
      } else if (el <= hEl + 7.5) {
        const aboveDeg = el - hEl;
        out[i] = clamp(9000 * Math.exp(-aboveDeg / 2.8), 0, 12000);
      } else {
        out[i] = Number.POSITIVE_INFINITY;
      }
    }
  }

  return out;
}
