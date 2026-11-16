/**
 * astroStackMath.ts
 *
 * 야간 다중 프레임(4~10분 분할 촬영)의 지구 자전 역투영 · 별 미세 정합 · 구름 프레임 필터링 순수 엔진.
 *
 * Why 순수 TS인가:
 *  - React Native / Native Camera2 없이도 Node 하네스(`verify-astro-stack.js`)에서
 *    천구 3D 회전 호모그래피, 별 중심점 검출·RANSAC 정합, 구름 탈락 판정을
 *    수치적으로 0.1px 이하 오차까지 검증할 수 있습니다.
 *  - 네이티브 누적기(`AstroStackAccumulator.kt`)에는 화소 좌표와 무관한 정규화 UV 3×3
 *    행렬(9개 float)과 열별 지평선 Y만 넘겨 JS 힙에 고해상도 이미지를 올리지 않습니다.
 */
import {
  attitudeFromDeviceAxes,
  cameraBasis,
  predictSkyline,
  type Attitude,
  type HorizonProfile,
  type Intrinsics,
} from './arVision';
import { getLMSTDeg } from './celestialCoords';

const D2R = Math.PI / 180;

export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type Vec3 = [number, number, number];

export interface StarPeak {
  x: number;
  y: number;
  /** 배경을 뺀 순수 플럭스 (연속 비교용). */
  flux: number;
  /** 주변 잡음 대비 SNR. */
  snr: number;
}

export interface FrameQualityResult {
  weight: number;
  accepted: boolean;
  starCount: number;
  matchedRatio: number;
  skyMedian: number;
  reason: 'ok' | 'cloud_blocked' | 'too_few_stars' | 'excess_drift';
}

export interface AlignmentResult {
  /** 정규화 UV (0..1) 공간에서 기준 프레임0 → 프레임k 샘플링 3×3 행렬 (row-major). */
  homographyUv0ToK: Mat3;
  /** 기준 프레임0 픽셀 → 프레임k 픽셀 호모그래피 (row-major). */
  homographyPx0ToK: Mat3;
  /** 잔차 미세 보정량 (기준 프레임 픽셀·도). */
  residualDxPx: number;
  residualDyPx: number;
  residualRotDeg: number;
  matchedStars: number;
  meanErrorPx: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function mat3Identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function mat3Transpose(a: Mat3): Mat3 {
  return [
    a[0], a[3], a[6],
    a[1], a[4], a[7],
    a[2], a[5], a[8],
  ];
}

export function mat3Inv(m: Mat3): Mat3 {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return mat3Identity();
  const invDet = 1 / det;
  return [
    A * invDet, D * invDet, G * invDet,
    B * invDet, E * invDet, H * invDet,
    C * invDet, F * invDet, I * invDet,
  ];
}

export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function applyHomography2D(
  h: Mat3,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const z = h[6] * x + h[7] * y + h[8];
  if (Math.abs(z) <= 1e-6) return null;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / z,
    y: (h[3] * x + h[4] * y + h[5]) / z,
  };
}

/**
 * 적도좌표 단위벡터 → 지평 ENU (+X=East, +Y=North, +Z=Up) 회전 행렬.
 * `StarField.ts`의 fillEquToHorizon과 같은 항성시·위도 정의를 따르며
 * det = +1 인 직교행렬이므로 역행렬 = 전치행렬입니다.
 */
export function equToEnuMatrix(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): Mat3 {
  const lst = getLMSTDeg(date, longitudeDeg) * D2R;
  const lat = latitudeDeg * D2R;
  const sinL = Math.sin(lst);
  const cosL = Math.cos(lst);
  const sinP = Math.sin(lat);
  const cosP = Math.cos(lat);

  return [
    -sinL, cosL, 0,
    -sinP * cosL, -sinP * sinL, cosP,
    cosP * cosL, cosP * sinL, sinP,
  ];
}

/**
 * 기준 시각 t0의 하늘 방향(ENU)을 시각 tk의 하늘 방향(ENU)으로 옮기는 회전 행렬 R(t0 → tk).
 */
export function skyRotationEnu(
  t0: Date,
  tk: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): Mat3 {
  const r0 = equToEnuMatrix(t0, latitudeDeg, longitudeDeg);
  const rk = equToEnuMatrix(tk, latitudeDeg, longitudeDeg);
  return mat3Mul(rk, mat3Transpose(r0));
}

/**
 * 3D 시뮬레이터 적도의 추적 모드용: 기준 시각 t0의 카메라 자세를 지구 자전에 맞춰
 * 시각 tk로 따라가게 회전시킨 지평 자세 { yawDeg, pitchDeg, rollDeg } 계산.
 */
export function computeTrackedAttitudeAt(
  refAttitude: Attitude,
  t0: Date,
  tk: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): Attitude {
  const rSky = skyRotationEnu(t0, tk, latitudeDeg, longitudeDeg);
  const b0 = cameraBasis(refAttitude);
  const rk = mat3MulVec(rSky, b0.r);
  const uk = mat3MulVec(rSky, b0.u);
  const fk = mat3MulVec(rSky, b0.f);
  // attitudeFromDeviceAxes 규약: zAxis = -forward
  return attitudeFromDeviceAxes(rk, uk, [-fk[0], -fk[1], -fk[2]]);
}

function basisColsToMat3(b: { r: Vec3; u: Vec3; f: Vec3 }): Mat3 {
  return [
    b.r[0], b.u[0], b.f[0],
    b.r[1], b.u[1], b.f[1],
    b.r[2], b.u[2], b.f[2],
  ];
}

function intrinsicsMat(k: Intrinsics): Mat3 {
  return [
    k.fx, 0, k.cx,
    0, -k.fy, k.cy,
    0, 0, 1,
  ];
}

function intrinsicsInvMat(k: Intrinsics): Mat3 {
  return [
    1 / k.fx, 0, -k.cx / k.fx,
    0, -1 / k.fy, k.cy / k.fy,
    0, 0, 1,
  ];
}

/**
 * 기준 프레임0 픽셀 (x0, y0) → 촬영 프레임k 픽셀 (xk, yk) 로 매핑하는 정확한 천구 3D 호모그래피.
 * 별·은하수는 무한대에 놓여 카메라 중심 순수 회전에 대해 평면 사영변환이 엄밀히 성립합니다.
 */
export function computeCelestialHomographyPx(params: {
  t0: Date;
  tk: Date;
  latitudeDeg: number;
  longitudeDeg: number;
  attitude0: Attitude;
  attitudeK?: Attitude;
  intrinsics0: Intrinsics;
  intrinsicsK?: Intrinsics;
}): Mat3 {
  const attK = params.attitudeK ?? params.attitude0;
  const k0 = params.intrinsics0;
  const kK = params.intrinsicsK ?? k0;

  const rSky0ToK = skyRotationEnu(
    params.t0,
    params.tk,
    params.latitudeDeg,
    params.longitudeDeg,
  );
  const c0 = basisColsToMat3(cameraBasis(params.attitude0));
  const ckT = mat3Transpose(basisColsToMat3(cameraBasis(attK)));

  // M_cam = C_k^T * R_sky(t0->tk) * C_0
  const mCam = mat3Mul(ckT, mat3Mul(rSky0ToK, c0));
  return mat3Mul(intrinsicsMat(kK), mat3Mul(mCam, intrinsicsInvMat(k0)));
}

/**
 * 픽셀 호모그래피 H_px(w0×h0 → wk×hk)를 해상도와 무관한 정규화 UV(0..1) 호모그래피로 변환합니다.
 */
export function homographyPxToUv(
  hPx: Mat3,
  w0: number,
  h0: number,
  wk = w0,
  hk = h0,
): Mat3 {
  const toPx0: Mat3 = [w0, 0, 0, 0, h0, 0, 0, 0, 1];
  const fromPxK: Mat3 = [1 / wk, 0, 0, 0, 1 / hk, 0, 0, 0, 1];
  return mat3Mul(fromPxK, mat3Mul(hPx, toPx0));
}

/**
 * DEM 지평선 기반으로 분석/누적 프레임 각 열(column)의 하늘·지상 경계 Y(0..height) 계산.
 * 지평선 아래(건물·가로등·산)가 별 정렬에 섞이지 않도록 마스킹할 때 씁니다.
 */
export function computeSkyMaskRows(
  horizon: HorizonProfile | null,
  attitude0: Attitude,
  intrinsics0: Intrinsics,
  marginPx = 4,
): Float32Array {
  const out = new Float32Array(intrinsics0.width);
  if (!horizon) {
    out.fill(intrinsics0.height);
    return out;
  }
  const rows = predictSkyline(horizon, attitude0, intrinsics0);
  for (let i = 0; i < out.length; i++) {
    // marginPx만큼 능선 위를 보수적으로 비워 나무·건물 실루엣 오차를 피합니다.
    out[i] = rows[i] < 0 ? 0 : Math.max(0, rows[i] - marginPx);
  }
  return out;
}

/**
 * 2D 썸네일 루마 배열에서 별(점 광원) 피크를 추출합니다.
 * 국소 배경(주변 링)을 빼므로 광공해나 은하수 띠 그라데이션 위에서도 별을 잘 분리합니다.
 */
export function detectStarPeaks(params: {
  luma: Float32Array | Uint8Array;
  width: number;
  height: number;
  /** 열별 최대 Y (지평선 위만 탐색). 없으면 전체 높이. */
  skyLimitY?: Float32Array;
  maxStars?: number;
  /** 배경 + nSigma * MAD 이상만 채택. 기본 5.0. */
  sigma?: number;
  /** 1픽셀 단독 핫픽셀 배제 여부. 기본 false(합성/저해상도 호환). */
  rejectSinglePixelSpike?: boolean;
}): StarPeak[] {
  const {
    luma,
    width,
    height,
    skyLimitY,
    maxStars = 36,
    sigma = 5.0,
    rejectSinglePixelSpike = false,
  } = params;
  if (width < 16 || height < 16) return [];

  // 1) 하늘 영역 표본으로 전역 배경 중앙값 및 MAD(노이즈 척도) 추정
  const samples: number[] = [];
  const stepX = Math.max(2, Math.floor(width / 48));
  const stepY = Math.max(2, Math.floor(height / 36));
  for (let x = 4; x < width - 4; x += stepX) {
    const maxY = Math.min(height - 4, skyLimitY ? Math.floor(skyLimitY[x]) : height - 4);
    for (let y = 4; y < maxY; y += stepY) {
      samples.push(luma[y * width + x]);
    }
  }
  if (samples.length < 16) return [];
  samples.sort((a, b) => a - b);
  const bgMed = samples[samples.length >> 1];
  const devs = samples.map((v) => Math.abs(v - bgMed)).sort((a, b) => a - b);
  const mad = Math.max(1e-3, devs[devs.length >> 1] * 1.4826);

  const candidates: StarPeak[] = [];
  const rInner = 4;

  // 2) 3×3 국소 극댓값 + 반경 4px 국소 링 배경 차감
  for (let x = rInner; x < width - rInner; x++) {
    const limY = skyLimitY ? Math.min(height - rInner, Math.floor(skyLimitY[x])) : height - rInner;
    for (let y = rInner; y < limY; y++) {
      const idx = y * width + x;
      const v = luma[idx];
      if (v <= bgMed + sigma * mad) continue;

      if (
        v < luma[idx - 1] || v <= luma[idx + 1] ||
        v < luma[idx - width] || v <= luma[idx + width] ||
        v < luma[idx - width - 1] || v <= luma[idx - width + 1] ||
        v < luma[idx + width - 1] || v <= luma[idx + width + 1]
      ) {
        continue;
      }

      // 8방위 반경 4px 링 평균으로 국소 배경 추정
      const localBg =
        (luma[(y - 4) * width + x] +
          luma[(y + 4) * width + x] +
          luma[y * width + (x - 4)] +
          luma[y * width + (x + 4)] +
          luma[(y - 3) * width + (x - 3)] +
          luma[(y - 3) * width + (x + 3)] +
          luma[(y + 3) * width + (x - 3)] +
          luma[(y + 3) * width + (x + 3)]) /
        8;
      const net = v - localBg;
      if (net <= sigma * mad) continue;

      if (rejectSinglePixelSpike) {
        const n4Max = Math.max(
          luma[idx - 1] - localBg,
          luma[idx + 1] - localBg,
          luma[idx - width] - localBg,
          luma[idx + width] - localBg,
        );
        if (n4Max < net * 0.05) continue;
      }

      // 3×3 포물선/무게중심 보간으로 서브픽셀 중심 구하기
      let wx = 0;
      let wy = 0;
      let wSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const d = Math.max(0, luma[(y + dy) * width + (x + dx)] - localBg);
          wx += dx * d;
          wy += dy * d;
          wSum += d;
        }
      }
      if (wSum <= 0) continue;

      candidates.push({
        x: x + wx / wSum,
        y: y + wy / wSum,
        flux: wSum,
        snr: net / mad,
      });
    }
  }

  candidates.sort((a, b) => b.flux - a.flux);

  // 인접 중복(반경 5px 내 같은 성단/이중봉) 제거
  const picked: StarPeak[] = [];
  for (const c of candidates) {
    if (picked.some((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < 25)) continue;
    picked.push(c);
    if (picked.length >= maxStars) break;
  }
  return picked;
}

/**
 * 천문 계산으로 구한 사전 호모그래피(H_prior: frame0 → frameK) 위에
 * 실제 사진 속 별 점들(refStars, frameStars)로 나침반/자이로 잔차 오차를 미세 정합합니다.
 */
export function estimateResidualAlignment(params: {
  priorPx0ToK: Mat3;
  refStars: StarPeak[];
  frameStars: StarPeak[];
  width: number;
  height: number;
  searchRadiusPx?: number;
}): AlignmentResult {
  const {
    priorPx0ToK,
    refStars,
    frameStars,
    width,
    height,
    searchRadiusPx = 12,
  } = params;

  const invPrior = mat3Inv(priorPx0ToK);

  // 1) frameK 별들을 사전 역투영으로 frame0 좌표계로 데려와 초기 쌍 후보 찾기
  const projFrame0 = frameStars
    .map((s) => {
      const p = applyHomography2D(invPrior, s.x, s.y);
      return p ? { src: s, p0: p } : null;
    })
    .filter((v): v is { src: StarPeak; p0: { x: number; y: number } } => v !== null);

  interface Pair {
    rx: number;
    ry: number;
    kx: number;
    ky: number;
    dx: number;
    dy: number;
  }
  const pairs: Pair[] = [];
  const r2 = searchRadiusPx * searchRadiusPx;

  for (const r of refStars) {
    let best: { d2: number; item: (typeof projFrame0)[number] } | null = null;
    for (const item of projFrame0) {
      const d2 = (item.p0.x - r.x) ** 2 + (item.p0.y - r.y) ** 2;
      if (d2 <= r2 && (!best || d2 < best.d2)) {
        best = { d2, item };
      }
    }
    if (best) {
      pairs.push({
        rx: r.x,
        ry: r.y,
        kx: best.item.p0.x,
        ky: best.item.p0.y,
        dx: best.item.p0.x - r.x,
        dy: best.item.p0.y - r.y,
      });
    }
  }

  if (pairs.length === 0) {
    return {
      homographyPx0ToK: priorPx0ToK,
      homographyUv0ToK: homographyPxToUv(priorPx0ToK, width, height),
      residualDxPx: 0,
      residualDyPx: 0,
      residualRotDeg: 0,
      matchedStars: 0,
      meanErrorPx: searchRadiusPx,
    };
  }

  // 2) 중앙값(median) 기반 이상치 제거 → 강건한 평행이동 + 회전 (2D Kabsch / Procrustes)
  const sortedDx = pairs.map((p) => p.dx).sort((a, b) => a - b);
  const sortedDy = pairs.map((p) => p.dy).sort((a, b) => a - b);
  const medDx = sortedDx[sortedDx.length >> 1];
  const medDy = sortedDy[sortedDy.length >> 1];
  const inliers = pairs.filter(
    (p) => Math.hypot(p.dx - medDx, p.dy - medDy) <= Math.max(2.5, searchRadiusPx * 0.35),
  );
  const active = inliers.length >= 2 ? inliers : pairs;

  let meanRx = 0, meanRy = 0, meanKx = 0, meanKy = 0;
  for (const p of active) {
    meanRx += p.rx; meanRy += p.ry;
    meanKx += p.kx; meanKy += p.ky;
  }
  meanRx /= active.length; meanRy /= active.length;
  meanKx /= active.length; meanKy /= active.length;

  let num = 0, den = 0;
  if (active.length >= 3) {
    for (const p of active) {
      const arx = p.rx - meanRx, ary = p.ry - meanRy;
      const akx = p.kx - meanKx, aky = p.ky - meanKy;
      // ref -> proj0 회전: rot = atan2(Σ(arx*aky - ary*akx), Σ(arx*akx + ary*aky))
      num += arx * aky - ary * akx;
      den += arx * akx + ary * aky;
    }
  }
  // 나침반 잔차 회전은 물리적으로 ±4°를 넘지 않으므로 과적합 클램프
  const maxRotRad = 4 * D2R;
  const rotRad =
    active.length >= 3 && Math.hypot(num, den) > 1e-4
      ? clamp(Math.atan2(num, den), -maxRotRad, maxRotRad)
      : 0;

  // 중심 (meanRx, meanRy) 기준: T(r) = R(rot)*(r - meanR) + meanK
  // 동일하게 화면 중심 (cx, cy) 대신 원점식으로 바로 구성:
  const c = Math.cos(rotRad);
  const s = Math.sin(rotRad);
  const tx = meanKx - (c * meanRx - s * meanRy);
  const ty = meanKy - (s * meanRx + c * meanRy);
  const tRefToProj0: Mat3 = [
    c, -s, tx,
    s, c, ty,
    0, 0, 1,
  ];

  // priorPx0ToK * tRefToProj0 : 기준 프레임0(r) → 보정된 proj0 → 프레임k
  const refinedPx = mat3Mul(priorPx0ToK, tRefToProj0);
  const refinedInv = mat3Inv(refinedPx);

  let errSum = 0;
  let directMatched = 0;
  for (const r of refStars) {
    let bestErr = 1e9;
    for (const sPeak of frameStars) {
      const mapped = applyHomography2D(refinedInv, sPeak.x, sPeak.y);
      if (!mapped) continue;
      const e = Math.hypot(mapped.x - r.x, mapped.y - r.y);
      if (e < bestErr) bestErr = e;
    }
    if (bestErr <= Math.max(3, searchRadiusPx * 0.5)) {
      errSum += bestErr;
      directMatched++;
    }
  }

  // 화면 중심 기준 이동량 보고
  const centerShift = applyHomography2D(tRefToProj0, width / 2, height / 2);
  const cxShift = centerShift ? centerShift.x - width / 2 : medDx;
  const cyShift = centerShift ? centerShift.y - height / 2 : medDy;

  return {
    homographyPx0ToK: refinedPx,
    homographyUv0ToK: homographyPxToUv(refinedPx, width, height),
    residualDxPx: Number(cxShift.toFixed(3)),
    residualDyPx: Number(cyShift.toFixed(3)),
    residualRotDeg: Number(((rotRad * 180) / Math.PI).toFixed(4)),
    matchedStars: Math.max(directMatched, active.length),
    meanErrorPx:
      directMatched > 0
        ? Number((errSum / directMatched).toFixed(3))
        : Number(Math.hypot(medDx, medDy).toFixed(3)),
  };
}

/**
 * 구름 통과 · 삼각대 흔들림 프레임을 자동 감쇠·탈락시키는 품질 가중치 판별.
 * 구름이 스쳐 별이 사라지거나 하늘 배경이 갑자기 뿌옇게 올라간 프레임은 가중치를 0으로 떨어뜨립니다.
 */
export function evaluateFrameQuality(params: {
  refStars: StarPeak[];
  refSkyMedian: number;
  frameStars: StarPeak[];
  frameSkyMedian: number;
  alignment: AlignmentResult;
  maxMeanErrorPx?: number;
}): FrameQualityResult {
  const {
    refStars,
    refSkyMedian,
    frameStars,
    frameSkyMedian,
    alignment,
    maxMeanErrorPx = 3.0,
  } = params;

  if (frameStars.length < 3 || (refStars.length >= 6 && frameStars.length < refStars.length * 0.15)) {
    return {
      weight: 0,
      accepted: false,
      starCount: frameStars.length,
      matchedRatio: refStars.length > 0 ? alignment.matchedStars / refStars.length : 0,
      skyMedian: frameSkyMedian,
      reason: frameStars.length < refStars.length * 0.4 ? 'cloud_blocked' : 'too_few_stars',
    };
  }

  const matchedRatio =
    refStars.length > 0
      ? clamp(alignment.matchedStars / Math.min(refStars.length, 24), 0, 1)
      : 1;

  if (matchedRatio < 0.35) {
    return {
      weight: 0,
      accepted: false,
      starCount: frameStars.length,
      matchedRatio: Number(matchedRatio.toFixed(3)),
      skyMedian: frameSkyMedian,
      reason: 'cloud_blocked',
    };
  }

  if (alignment.meanErrorPx > maxMeanErrorPx && alignment.matchedStars > 0) {
    return {
      weight: 0,
      accepted: false,
      starCount: frameStars.length,
      matchedRatio: Number(matchedRatio.toFixed(3)),
      skyMedian: frameSkyMedian,
      reason: 'excess_drift',
    };
  }

  // 도심/달빛 구름은 하늘 바닥 밝기(skyMedian)가 기준보다 크게 올라감
  const bgJumpRatio = refSkyMedian > 1e-4 ? frameSkyMedian / refSkyMedian : 1;
  const bgPenalty = bgJumpRatio > 1.35 ? clamp(1 - (bgJumpRatio - 1.35) * 1.4, 0, 1) : 1;
  const alignScore = clamp(1 - alignment.meanErrorPx / (maxMeanErrorPx * 1.2), 0.2, 1);
  const weight = clamp(matchedRatio * bgPenalty * alignScore, 0, 1);

  return {
    weight: Number(weight.toFixed(3)),
    accepted: weight >= 0.2,
    starCount: frameStars.length,
    matchedRatio: Number(matchedRatio.toFixed(3)),
    skyMedian: frameSkyMedian,
    reason: weight < 0.2 ? 'cloud_blocked' : 'ok',
  };
}

/**
 * 1차원 루마 배열(하늘 영역 기준)에서 중앙값을 뽑는 경량 유틸.
 */
export function medianSkyBrightness(
  luma: Float32Array | Uint8Array,
  width: number,
  height: number,
  skyLimitY?: Float32Array,
): number {
  const vals: number[] = [];
  const stepX = Math.max(2, Math.floor(width / 32));
  const stepY = Math.max(2, Math.floor(height / 24));
  for (let x = 2; x < width - 2; x += stepX) {
    const lim = Math.min(height - 2, skyLimitY ? Math.floor(skyLimitY[x]) : height - 2);
    for (let y = 2; y < lim; y += stepY) {
      vals.push(luma[y * width + x]);
    }
  }
  if (vals.length === 0) return 0;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}
