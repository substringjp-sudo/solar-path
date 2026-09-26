/**
 * **카메라 화면으로 AR 자세를 바로잡습니다** — 산 능선 · 해 · 달.
 *
 * > "기기 센서만으로 완벽하게 맞추는건 불가능한거같으니까 카메라에서 산이나 태양,
 * >  달이 인식되면 그걸 기준으로 보정하는 기능은 어떨까?"
 *
 * ## 왜
 *
 * 방위는 자기계가 정합니다. 자기계는 폰 케이스 자석·철근·차 안에서 수~수십 도
 * 틀리고(`headingFusion.ts` 머리말), 사용자가 할 수 있는 보정은 해를 화면 한가운데
 * 두고 누르는 것뿐이었습니다(방위만, 해가 떠 있을 때만). 그런데 화면에는 이미
 * **정답이 찍혀 있습니다** — 산 능선은 DEM 으로, 해·달은 천문 계산으로 어디 있어야
 * 하는지 압니다. 둘을 맞추면 방위 · 앙각 · 기울기를 한꺼번에 풉니다.
 *
 * ## 이 파일이 하는 일 (전부 순수 함수 — 기기 없이 판정합니다)
 *
 *  1. `horizonProfile` — DEM 에서 방위마다 지평선 앙각(곡률·굴절 포함).
 *  2. `detectSkyline` — 화면에서 열마다 하늘/땅 경계(동적 계획법).
 *  3. `detectBrightDisc` — 화면에서 해·달(밝고 둥근 덩어리).
 *  4. `solveAttitude` — 센서 자세에 더할 (방위, 앙각, 기울기) 보정.
 *  5. `createVisionCalibrator` — 프레임마다 나오는 풀이를 모아 믿을 만할 때만 적용.
 *
 * ## 좌표 규약
 *
 * 월드: x=동, y=북, z=위 (`devicePose.ts` 와 같음). 자세는 카메라 전방의
 * 방위(yaw, 북=0 시계방향)·앙각(pitch)과 전방 축 둘레의 기울기(roll).
 * roll 이 양수면 폰 윗변이 오른쪽으로 기운 것입니다(화면 속 지평선은 반시계로 돕니다).
 * 화소는 왼쪽 위가 원점, x 오른쪽, y 아래.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** 지구 반지름(m). `earth.ts` 와 같은 값. */
const EARTH_R_M = 6371008.8;
/** 표준 굴절계수 — 빛이 휘는 만큼 지구가 덜 굽어 보입니다. */
const REFRACTION_K = 0.13;

export const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
export const wrap360 = (d: number): number => ((d % 360) + 360) % 360;

// ─────────────────────────────────────────────────────────────────────────────
// 카메라 모형
// ─────────────────────────────────────────────────────────────────────────────

export interface Attitude {
  /** 카메라 전방의 방위(도, 북=0, 시계방향). */
  yawDeg: number;
  /** 카메라 전방의 앙각(도). */
  pitchDeg: number;
  /** 전방 축 둘레 기울기(도). 양수 = 폰 윗변이 오른쪽으로. */
  rollDeg: number;
}

export interface Intrinsics {
  width: number;
  height: number;
  /** 초점거리(화소). */
  fx: number;
  fy: number;
  /** 주점(화소). */
  cx: number;
  cy: number;
}

/** 가로 화각(도)에서 핀홀 내부변수. 정사각 화소, 주점은 가운데. */
export function intrinsicsFromHfov(width: number, height: number, hfovDeg: number): Intrinsics {
  const fx = width / 2 / Math.tan((hfovDeg * D2R) / 2);
  return { width, height, fx, fy: fx, cx: width / 2, cy: height / 2 };
}

/**
 * 35mm 환산 초점거리에서 화각. 35mm 필름의 **대각선**(43.27mm)을 화면 대각선에
 * 맞추는 정의를 씁니다 — 가로세로비가 3:2 가 아닌 폰 화면에서도 맞습니다.
 * @returns 이 화면 **가로** 화각(도).
 */
export function hfovFromFocal35(focal35mm: number, width: number, height: number): number {
  const diag = Math.hypot(width, height);
  const sensorW = (43.2666 * width) / diag;
  return 2 * Math.atan(sensorW / (2 * focal35mm)) * R2D;
}

type V3 = [number, number, number];

interface Basis { r: V3; u: V3; f: V3 }

export function cameraBasis(a: Attitude): Basis {
  const sy = Math.sin(a.yawDeg * D2R), cy = Math.cos(a.yawDeg * D2R);
  const sp = Math.sin(a.pitchDeg * D2R), cp = Math.cos(a.pitchDeg * D2R);
  const sr = Math.sin(a.rollDeg * D2R), cr = Math.cos(a.rollDeg * D2R);
  const f: V3 = [cp * sy, cp * cy, sp];
  const r0: V3 = [cy, -sy, 0];
  const u0: V3 = [-sy * sp, -cy * sp, cp];
  const r: V3 = [r0[0] * cr - u0[0] * sr, r0[1] * cr - u0[1] * sr, r0[2] * cr - u0[2] * sr];
  const u: V3 = [u0[0] * cr + r0[0] * sr, u0[1] * cr + r0[1] * sr, u0[2] * cr + r0[2] * sr];
  return { r, u, f };
}

/**
 * 기기 회전행렬의 열(월드 좌표)에서 자세. `devicePose.ts` 의 규약 그대로 —
 * 기기 +X(화면 오른쪽) · +Y(화면 위) · 카메라 전방 = −Z.
 */
export function attitudeFromDeviceAxes(xAxis: V3, yAxis: V3, zAxis: V3): Attitude {
  const f: V3 = [-zAxis[0], -zAxis[1], -zAxis[2]];
  const horiz = Math.hypot(f[0], f[1]);
  const yawDeg = wrap360(Math.atan2(f[0], f[1]) * R2D);
  const pitchDeg = Math.atan2(f[2], horiz) * R2D;
  const b0 = cameraBasis({ yawDeg, pitchDeg, rollDeg: 0 });
  const dr = xAxis[0] * b0.r[0] + xAxis[1] * b0.r[1] + xAxis[2] * b0.r[2];
  const du = xAxis[0] * b0.u[0] + xAxis[1] * b0.u[1] + xAxis[2] * b0.u[2];
  return { yawDeg, pitchDeg, rollDeg: Math.atan2(-du, dr) * R2D };
}

/** W3C (α, β, γ) 라디안에서 자세 — `DeviceMotion.rotation` 을 그대로 받습니다. */
export function attitudeFromEuler(alphaRad: number, betaRad: number, gammaRad: number): Attitude {
  const sa = Math.sin(alphaRad), ca = Math.cos(alphaRad);
  const sb = Math.sin(betaRad), cb = Math.cos(betaRad);
  const sg = Math.sin(gammaRad), cg = Math.cos(gammaRad);
  // R = Rz(α)Rx(β)Ry(γ) 의 열.
  const x: V3 = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
  const y: V3 = [-sa * cb, ca * cb, sb];
  const z: V3 = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg];
  return attitudeFromDeviceAxes(x, y, z);
}

export const dirFromAzEl = (azDeg: number, elDeg: number): V3 => {
  const ce = Math.cos(elDeg * D2R);
  return [ce * Math.sin(azDeg * D2R), ce * Math.cos(azDeg * D2R), Math.sin(elDeg * D2R)];
};

/** 방향 → 화소. 카메라 뒤면 null. */
export function project(dir: V3, a: Attitude, k: Intrinsics, basis?: Basis): { x: number; y: number } | null {
  const b = basis ?? cameraBasis(a);
  const Z = dir[0] * b.f[0] + dir[1] * b.f[1] + dir[2] * b.f[2];
  if (Z <= 1e-6) return null;
  const X = dir[0] * b.r[0] + dir[1] * b.r[1] + dir[2] * b.r[2];
  const Y = dir[0] * b.u[0] + dir[1] * b.u[1] + dir[2] * b.u[2];
  return { x: k.cx + (k.fx * X) / Z, y: k.cy - (k.fy * Y) / Z };
}

/** 화소 → (방위, 앙각) 도. */
export function unproject(px: number, py: number, a: Attitude, k: Intrinsics, basis?: Basis): { az: number; el: number } {
  const b = basis ?? cameraBasis(a);
  const X = (px - k.cx) / k.fx;
  const Y = -(py - k.cy) / k.fy;
  const d0 = b.r[0] * X + b.u[0] * Y + b.f[0];
  const d1 = b.r[1] * X + b.u[1] * Y + b.f[1];
  const d2 = b.r[2] * X + b.u[2] * Y + b.f[2];
  const n = Math.hypot(d0, d1, d2);
  return { az: wrap360(Math.atan2(d0, d1) * R2D), el: Math.asin(d2 / n) * R2D };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DEM 지평선
// ─────────────────────────────────────────────────────────────────────────────

export interface HorizonProfile {
  /** 방위 칸 간격(도). */
  stepDeg: number;
  /** 칸마다 지평선 앙각(도). 방위 0 에서 시작. */
  elevDeg: Float32Array;
}

/**
 * 관측자 기준 지상 좌표(+동, +남, m)의 고도(m). 모르는 곳이면 null.
 * `dem-cpu.js` 의 `elevAtGround` 와 같은 뜻입니다.
 */
export type GroundElevation = (eastM: number, southM: number) => number | null;

export interface HorizonOptions {
  /** 방위 칸(도). 기본 0.25. */
  stepDeg?: number;
  /** 가장 가까운 표본 거리(m). 기본 30. */
  nearM?: number;
  /** 가장 먼 표본 거리(m). 기본 55,000 — 앱의 지형 격자 끝(`FAR_FIELD_FAR_M`). */
  farM?: number;
  /** 거리 간격을 늘리는 비. 기본 1.015. */
  growth?: number;
  /** 이 칸부터 `binCount` 칸만 구합니다(나머지는 −90). `horizonProfileAsync` 가 나눠 부릅니다. */
  startBin?: number;
  binCount?: number;
}

/**
 * 방위마다 지평선 앙각. 지구 곡률과 표준 굴절을 넣습니다 — 50km 밖 능선은 곡률만
 * 으로 0.2° 내려앉습니다. 모르는 칸(자료 밖)은 −90 으로 두어 "하늘" 로 읽힙니다.
 */
export function horizonProfile(elev: GroundElevation, eyeElevM: number, opts: HorizonOptions = {}): HorizonProfile {
  const stepDeg = opts.stepDeg ?? 0.25;
  const nearM = opts.nearM ?? 30;
  const farM = opts.farM ?? 55000;
  const growth = opts.growth ?? 1.015;
  const n = Math.round(360 / stepDeg);
  const out = new Float32Array(n);
  const dists: number[] = [];
  for (let d = nearM; d <= farM; d = Math.max(d * growth, d + 15)) dists.push(d);
  const drop = dists.map(d => (d * d * (1 - REFRACTION_K)) / (2 * EARTH_R_M));
  out.fill(-90);
  const i0 = opts.startBin ?? 0, i1 = Math.min(n, i0 + (opts.binCount ?? n));
  for (let i = i0; i < i1; i++) {
    const az = i * stepDeg * D2R;
    const se = Math.sin(az), ce = Math.cos(az);
    let best = -90;
    for (let j = 0; j < dists.length; j++) {
      const d = dists[j];
      const h = elev(d * se, -d * ce);
      if (h == null) continue;
      const e = Math.atan2(h - drop[j] - eyeElevM, d) * R2D;
      if (e > best) best = e;
    }
    out[i] = best;
  }
  return { stepDeg, elevDeg: out };
}

/** 지평선 앙각(도) — 방위 사이 선형. */
export function horizonAt(p: HorizonProfile, azDeg: number): number {
  const n = p.elevDeg.length;
  const t = wrap360(azDeg) / p.stepDeg;
  const i0 = Math.floor(t) % n, i1 = (i0 + 1) % n;
  const w = t - Math.floor(t);
  return p.elevDeg[i0] * (1 - w) + p.elevDeg[i1] * w;
}

/**
 * 이 자세·화면에서 DEM 능선이 놓이는 행(열마다). 위가 전부 땅이면 −1, 아래까지
 * 전부 하늘이면 height. 열을 따라 "앙각 − 지평선" 이 부호를 바꾸는 곳을 이분법으로.
 */
export function predictSkyline(p: HorizonProfile, a: Attitude, k: Intrinsics, columns?: number[]): Float32Array {
  const b = cameraBasis(a);
  const cols = columns ?? Array.from({ length: k.width }, (_, i) => i + 0.5);
  const out = new Float32Array(cols.length);
  const g = (x: number, y: number) => { const d = unproject(x, y, a, k, b); return d.el - horizonAt(p, d.az); };
  for (let c = 0; c < cols.length; c++) {
    const x = cols[c];
    let lo = 0, hi = k.height;
    const gLo = g(x, lo), gHi = g(x, hi);
    if (gLo <= 0) { out[c] = -1; continue; }
    if (gHi > 0) { out[c] = k.height; continue; }
    for (let it = 0; it < 18; it++) {
      const m = (lo + hi) / 2;
      if (g(x, m) > 0) lo = m; else hi = m;
    }
    out[c] = (lo + hi) / 2;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 화면의 하늘/땅 경계
// ─────────────────────────────────────────────────────────────────────────────

export interface RgbFrame {
  width: number;
  height: number;
  /** RGB 또는 RGBA (채널 수 `channels`), 행 우선, 위에서부터. */
  data: Uint8Array | Uint8ClampedArray;
  channels: 3 | 4;
}

export interface Skyline {
  /** 열마다 경계 행(화소, 소수). 경계를 못 믿는 열은 NaN. */
  row: Float32Array;
  /** 열마다 경계의 세기(0~1). */
  strength: Float32Array;
  /**
   * 열마다 **두 번째 후보** — 위에서부터 처음 나오는 뚜렷한 경계가 `row` 보다 위에 따로
   * 있으면 그 행, 없으면 NaN. 먼 능선은 연무에 흐려 경계가 약하고, 그 아래 가까운 산·
   * 지면의 경계가 더 셉니다. 어느 쪽이 DEM 능선인지는 화면만으로 못 가르므로 풀이가
   * 고릅니다(`solveAttitude` 는 열마다 DEM 에 가까운 후보를 씁니다).
   */
  alt?: Float32Array;
}

/**
 * 두 번째 후보(위에서 처음 나오는 경계)의 문턱 — 절대 · 그 열 최댓값 대비.
 * 0.01/0.10 · 0.006/0.06 으로 낮춰 봤지만 흐린 먼 능선을 더 찾지 못하고, 엉뚱한 장소의 DEM 에
 * 방위를 맞추거나(1/13) 렌더 화면에서 3.3° 틀린 확신이 생겨 이 값에 둡니다.
 */
const ALT_FLOOR = 0.02, ALT_REL = 0.15;

export interface SkylineOptions {
  /** 이 열들은 건너뜁니다(해 둘레 번짐 등) — [x0, x1) 구간들. */
  maskColumns?: Array<[number, number]>;
  /** 한 열에서 옆 열로 넘어갈 때 행이 바뀌는 비용(화소당). 기본 0.6. */
  smoothness?: number;
  /** 이보다 약한 경계는 NaN. 기본 0.06. */
  minStrength?: number;
}

/**
 * 열마다 하늘(위)과 땅(아래)의 경계를 찾습니다.
 *
 * 경계의 점수는 "위쪽 몇 화소가 아래쪽보다 밝고 푸르다" 입니다. 해질녘 역광 능선
 * (밝은 하늘 · 어두운 산)과 낮의 푸른 하늘 · 녹색 산이 모두 이 부호입니다. 반대
 * 부호(아래가 더 밝음 — 흰 구름 윗면, 눈 덮인 산 위 푸른 하늘의 일부)는 경계로
 * 안 씁니다. 열 사이는 동적 계획법으로 이어, 한 열의 잡음이 튀지 못하게 합니다.
 */
export function detectSkyline(frame: RgbFrame, opts: SkylineOptions = {}): Skyline {
  const { width: w, height: h, data, channels: ch } = frame;
  const smooth = opts.smoothness ?? 0.6;
  const minStrength = opts.minStrength ?? 0.06;
  // 밝기·푸름 (0~1)
  const L = new Float32Array(w * h), Bl = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += ch) {
    const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
    L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    Bl[i] = b - 0.5 * (r + g);
  }
  // 경계 점수: 위 K 화소 평균 − 아래 K 화소 평균 (밝기 + 푸름). `score` 는 위가 밝은 쪽만,
  // `absScore` 는 부호와 상관없이 — 연무 낀 먼 산은 바로 위 하늘보다 **밝게** 보이기도 합니다
  // (덕유산 북쪽 판정 화면: 그 경계를 못 봐 가까운 능선을 2.9화소 아래에서 잡았습니다).
  const K = Math.max(2, Math.round(h / 80));
  const score = new Float32Array(w * h);
  const absScore = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = K; y < h - K; y++) {
      let la = 0, lb = 0, ba = 0, bb = 0;
      for (let t = 1; t <= K; t++) {
        const ia = (y - t) * w + x, ib = (y + t - 1) * w + x;
        la += L[ia]; lb += L[ib]; ba += Bl[ia]; bb += Bl[ib];
      }
      const s = (la - lb) / K + 0.5 * (ba - bb) / K;
      score[y * w + x] = s > 0 ? s : 0;
      absScore[y * w + x] = Math.abs(s);
    }
  }
  const masked = new Uint8Array(w);
  for (const [x0, x1] of opts.maskColumns ?? []) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) masked[x] = 1;
  }
  // 동적 계획법: 비용 = −점수 + smooth·|Δy|/h·?  (행 변화 한 화소마다 smooth/h... 비율로)
  // 행 변화 비용은 "점수 단위" 로 둡니다 — 한 화소 이동이 점수 smooth·0.01 과 맞바꿈.
  const stepCost = smooth * 0.01;
  const INF = 1e9;
  let prev = new Float32Array(h).fill(0);
  const back = new Int16Array(w * h);
  const cur = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    // prev 의 "거리 변환"(L1) — 이동 비용이 |Δy|·stepCost 인 최소화를 O(h) 로.
    const best = new Float32Array(h), arg = new Int16Array(h);
    for (let y = 0; y < h; y++) { best[y] = prev[y]; arg[y] = y; }
    for (let y = 1; y < h; y++) if (best[y - 1] + stepCost < best[y]) { best[y] = best[y - 1] + stepCost; arg[y] = arg[y - 1]; }
    for (let y = h - 2; y >= 0; y--) if (best[y + 1] + stepCost < best[y]) { best[y] = best[y + 1] + stepCost; arg[y] = arg[y + 1]; }
    for (let y = 0; y < h; y++) {
      const s = masked[x] ? 0 : score[y * w + x];
      cur[y] = best[y] - s;
      back[x * h + y] = arg[y];
    }
    prev = Float32Array.from(cur);
  }
  let yEnd = 0, vEnd = INF;
  for (let y = 0; y < h; y++) if (prev[y] < vEnd) { vEnd = prev[y]; yEnd = y; }
  // 다듬기 — 창(K 화소) 평균으로 잡은 경계를 **한 화소 차**의 최대로 옮깁니다. 능선에 두께 1~2화소
  // 짜리 어두운 선(역광 나무·렌더의 실루엣)이 있으면 창 평균의 극대가 2~3화소 위로 밀립니다
  // (덕유산 북쪽 판정 화면). `sign` +1 은 위가 밝은 경계, 0 은 부호 무관.
  const refine = (x: number, y0: number, sign: number): number => {
    let bestY = y0, bestG = -Infinity;
    const g = (yy: number) => {
      const a = (yy - 1) * w + x, b2 = yy * w + x;
      const d = (L[a] - L[b2]) + 0.5 * (Bl[a] - Bl[b2]);
      return sign > 0 ? d : Math.abs(d);
    };
    for (let yy = Math.max(1, y0 - K); yy <= Math.min(h - 1, y0 + K); yy++) {
      const v = g(yy);
      if (v > bestG) { bestG = v; bestY = yy; }
    }
    // 이웃으로 소수 위치
    if (bestY > 1 && bestY < h - 1) {
      const gm = g(bestY - 1), g0 = bestG, gp = g(bestY + 1);
      const den = gm - 2 * g0 + gp;
      if (den < 0) return bestY + Math.max(-0.5, Math.min(0.5, 0.5 * (gm - gp) / den));
    }
    return bestY;
  };
  const row = new Float32Array(w), strength = new Float32Array(w), alt = new Float32Array(w).fill(NaN);
  let y = yEnd;
  for (let x = w - 1; x >= 0; x--) {
    const s = score[y * w + x];
    // 점수는 y 행 위·아래 K 화소를 가르는 선에 대한 것 — 경계 = y. 한 화소 차로 다듬습니다.
    row[x] = masked[x] || s < minStrength ? NaN : refine(x, y, 1);
    strength[x] = masked[x] ? 0 : Math.min(1, s / 0.3);
    if (!masked[x]) {
      // 위에서부터 처음 나오는 극대 — 이 열 최댓값의 15% 이상, 절대 0.02 이상.
      let colMax = 0;
      for (let yy = K; yy < h - K; yy++) colMax = Math.max(colMax, absScore[yy * w + x]);
      const thr2 = Math.max(ALT_FLOOR, ALT_REL * colMax);
      for (let yy = K + 1; yy < h - K - 1; yy++) {
        const v = absScore[yy * w + x];
        if (v < thr2 || v < absScore[(yy - 1) * w + x] || v < absScore[(yy + 1) * w + x]) continue;
        const ry = refine(x, yy, 0);
        if (Number.isFinite(row[x]) ? ry < row[x] - 2 : true) alt[x] = ry;
        break;
      }
    }
    y = back[x * h + y];
  }
  return { row, strength, alt };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 해·달
// ─────────────────────────────────────────────────────────────────────────────

export interface BrightDisc {
  x: number;
  y: number;
  /** 덩어리 넓이(화소). */
  area: number;
  /** 둥근 정도 0~1. */
  roundness: number;
  /** 덩어리 평균 밝기 − 둘레 고리 밝기 중앙값 (0~1 단위). */
  contrast: number;
  /**
   * 둘레의 일부가 훨씬 어둡습니다 — 능선·구름에 **걸린** 원반. 보이는 부분의 무게중심은
   * 원반 중심에서 치우치므로 자세 보정에는 쓰지 않습니다.
   */
  partial: boolean;
}

export interface DiscOptions {
  /** 밝기 문턱(0~1). 기본은 max(0.6, 가장 밝은 값 − 0.025) — 포화된 가운데만. */
  threshold?: number;
  /** 가장 큰 넓이(화소) — 이보다 크면 구름·하늘 전체가 밝은 것. */
  maxArea?: number;
  /** 가장 작은 넓이(화소). 기본 1. */
  minArea?: number;
  /** 이 점 둘레 반경(화소) 안의 덩어리만 봅니다(예측 위치 + 센서 오차). */
  near?: { x: number; y: number; radius: number };
}

/**
 * 가장 밝고 작고 둥근 덩어리 하나 — 해 또는 달.
 *
 * 해는 사진에서 **포화된 원반 + 후광**입니다. 둘레 하늘도 거의 포화(230~250)라 밝기
 * **비**로는 안 갈립니다 — 처음엔 비 1.25 를 요구해 합성 화면의 해를 하나도 못 찾았습니다
 * (원반 254, 둘레 236). 그래서 "가장 밝은 값 바로 밑까지만" 을 덩어리로 잡고, 둘레보다
 * **조금이라도**(0.03) 밝으면 받습니다. 달은 어두운 하늘의 작은 밝은 원이라 어느 쪽이든
 * 잘 갈립니다.
 */
export function detectBrightDisc(frame: RgbFrame, opts: DiscOptions = {}): BrightDisc | null {
  const { width: w, height: h, data, channels: ch } = frame;
  const L = new Float32Array(w * h);
  const inNear = (i: number) => {
    if (!opts.near) return true;
    const x = i % w, y = (i / w) | 0;
    return Math.hypot(x - opts.near.x, y - opts.near.y) <= opts.near.radius;
  };
  let maxL = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += ch) {
    const v = Math.max(data[p], data[p + 1], data[p + 2]) / 255;
    L[i] = v;
    if (v > maxL && inNear(i)) maxL = v;
  }
  if (maxL < 0.25) return null;
  const thr = opts.threshold ?? Math.max(0.6, maxL - 0.025);
  const maxArea = opts.maxArea ?? Math.max(16, (w * h) / 40);
  const minArea = opts.minArea ?? 1;
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  let best: BrightDisc | null = null, bestScore = -1;
  for (let s = 0; s < w * h; s++) {
    if (label[s] !== -1 || L[s] < thr || !inNear(s)) continue;
    let area = 0, sx = 0, sy = 0, sumL = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    stack.length = 0; stack.push(s); label[s] = s;
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w, y = (i / w) | 0;
      area++; sx += x; sy += y; sumL += L[i];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (area > maxArea + 1) continue; // 너무 큰 덩어리는 끝까지 안 채웁니다(버릴 것)
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || L[j] < thr) continue;
        if (label[j] === -1) { label[j] = s; stack.push(j); }
      }
    }
    if (area < minArea || area > maxArea) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    const fill = Math.min(1, (area / (bw * bh)) * (4 / Math.PI));
    const roundness = area <= 4 ? aspect : aspect * fill;
    const cx = sx / area, cy = sy / area;
    const rad = Math.max(1.5, Math.sqrt(area / Math.PI));
    // 둘레 고리(반경 2.5배)
    const ring: number[] = [];
    for (let t = 0; t < 32; t++) {
      const ang = (t / 32) * 2 * Math.PI;
      const xx = Math.round(cx + Math.cos(ang) * rad * 2.5), yy = Math.round(cy + Math.sin(ang) * rad * 2.5);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      ring.push(L[yy * w + xx]);
    }
    if (ring.length < 8) continue;
    const sorted = [...ring].sort((a, b) => a - b);
    const ringMed = sorted[sorted.length >> 1];
    const mean = sumL / area;
    const contrast = mean - ringMed;
    const dark = ring.filter(v => v < mean * 0.6).length / ring.length;
    if (roundness < 0.45 || contrast < 0.03) continue;
    const score = roundness * contrast * mean;
    if (score > bestScore) {
      bestScore = score;
      best = { x: cx + 0.5, y: cy + 0.5, area, roundness, contrast, partial: dark > 0.15 };
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 자세 풀이
// ─────────────────────────────────────────────────────────────────────────────

export interface PointObservation {
  /** 화면에서 찾은 자리(화소). */
  x: number;
  y: number;
  /** 천문 계산이 말하는 방위·앙각(도, 대기 굴절 포함 겉보기). */
  azDeg: number;
  elDeg: number;
  /** 무게(화소 단위 오차의 역수 느낌). 기본 1. */
  weight?: number;
}

export interface SolveInput {
  intrinsics: Intrinsics;
  /** 센서가 말하는 자세(이 프레임을 찍은 순간). */
  sensor: Attitude;
  horizon?: HorizonProfile | null;
  skyline?: Skyline | null;
  points?: PointObservation[];
  /** 방위 보정을 찾을 범위(±도). 기본 30. */
  yawRangeDeg?: number;
  /** 앙각·기울기 보정 한계(±도). 기본 8. */
  tiltRangeDeg?: number;
  /** 센서 앙각·기울기를 얼마나 믿나(표준편차, 도). 기본 1.5. */
  tiltSigmaDeg?: number;
  /** 판정용 — 방위 후보별 비용을 결과에 싣습니다. */
  debug?: boolean;
}

const opts_tiltSigma = (inp: SolveInput) => inp.tiltSigmaDeg ?? 1.5;

export interface SolveResult {
  /** 센서 자세에 **더할** 보정(도). */
  dYaw: number;
  dPitch: number;
  dRoll: number;
  /** 방위를 믿을 수 있는가 — 능선에 특징이 있거나 해·달을 봤을 때만. */
  yawObservable: boolean;
  /** 앙각·기울기를 믿을 수 있는가. */
  tiltObservable: boolean;
  /** 0~1. 0.5 넘으면 쓸 만합니다. */
  confidence: number;
  /** 능선 표본 수·인라이어 비·잔차(도). */
  samples: number;
  inlierFrac: number;
  residualDeg: number;
  /** 두 번째로 좋은 방위 후보와의 비용 차(비). 작으면 헷갈림. */
  yawDistinct: number;
  /** 같은 차의 **절대값**(표본당 코시 비용). 가림으로 비용 전체가 부푼 화면에서도 안 줄어듭니다. */
  yawGap?: number;
  /** 무엇으로 풀었나. */
  source: 'skyline' | 'point' | 'skyline+point' | 'none';
  reason?: string;
  /** `debug` 일 때 — 방위 후보별 (앙각·기울기를 푼 뒤) 비용. */
  profile?: { dy: number[]; cost: number[] };
  /** 방위가 풀린 값(관측 가능 여부와 상관없이) — 판정용. */
  rawYaw?: number;
}

interface SkyCand { az: number; el: number; a: number; b: number; y: number }
interface SkySample { c: SkyCand[]; w: number; x: number }

const cauchy = (r: number, s: number) => Math.log(1 + (r / s) * (r / s));

/**
 * 센서 자세에 더할 (방위, 앙각, 기울기) 보정을 찾습니다.
 *
 * 능선: 화면 경계를 센서 자세로 (방위, 앙각)으로 펴고, 보정 후보마다 "그 앙각 −
 * DEM 지평선" 을 강건하게(코시) 줄입니다. 방위는 격자로 훑고(주기적인 능선의 가짜
 * 최소를 피하려고), 앙각·기울기는 방위마다 반복 재가중 최소제곱으로 풉니다.
 *
 * ⚠ 화면의 경계는 DEM 과 양쪽으로 어긋납니다 — 나무·건물은 경계를 **높이고**, 연무에
 * 묻힌 먼 능선은 **낮춥니다**. 처음에는 한쪽만 가볍게 셌는데 부호를 거꾸로 넣었고,
 * 합성 화면(덕유산 연무)에서 반대쪽도 흔하다는 것을 보고 대칭 코시로 바꿨습니다.
 */
export function solveAttitude(inp: SolveInput): SolveResult {
  const k = inp.intrinsics;
  const yawRange = inp.yawRangeDeg ?? 30;
  const tiltRange = inp.tiltRangeDeg ?? 8;
  const none = (reason: string): SolveResult => ({
    dYaw: 0, dPitch: 0, dRoll: 0, yawObservable: false, tiltObservable: false, confidence: 0,
    samples: 0, inlierFrac: 0, residualDeg: NaN, yawDistinct: 0, source: 'none', reason,
  });
  const pxDeg = (k.fx * D2R); // 화소/도 (가운데)
  const b0 = cameraBasis(inp.sensor);
  // 능선 표본
  const sky: SkySample[] = [];
  if (inp.horizon && inp.skyline) {
    const { row, strength, alt } = inp.skyline;
    const step = Math.max(1, Math.round(row.length / 160));
    const cand = (px: number, y: number): SkyCand => {
      const d = unproject(px, y, inp.sensor, k, b0);
      // 앙각이 자세 보정에 얼마나 민감한가(수치 미분)
      const dp = unproject(px, y, { ...inp.sensor, pitchDeg: inp.sensor.pitchDeg + 0.5 }, k);
      const dr = unproject(px, y, { ...inp.sensor, rollDeg: inp.sensor.rollDeg + 0.5 }, k);
      return { az: d.az, el: d.el, a: (dp.el - d.el) / 0.5, b: (dr.el - d.el) / 0.5, y };
    };
    const usable = (y: number) => Number.isFinite(y) && y > 1 && y < k.height - 2;
    for (let x = 0; x < row.length; x += step) {
      const px = x + 0.5;
      const c: SkyCand[] = [];
      if (usable(row[x])) c.push(cand(px, row[x]));
      if (alt && usable(alt[x])) c.push(cand(px, alt[x]));
      if (!c.length) continue;
      sky.push({ c, w: 0.3 + strength[x], x: px });
    }
  }
  const pts = (inp.points ?? []).map(p => {
    const d = unproject(p.x, p.y, inp.sensor, k, b0);
    return { ...p, az0: d.az, el0: d.el, weight: p.weight ?? 1 };
  });
  const minSamples = Math.max(12, Math.round(0.15 * Math.min(160, k.width)));
  const useSky = sky.length >= minSamples;
  if (!useSky && pts.length === 0) return none(sky.length ? `능선 표본 부족(${sky.length})` : '능선도 해·달도 없음');

  // 코시 척도(도). 잔차는 양쪽 다 생깁니다 — 나무·건물은 경계를 **높이고**(하늘을 가림),
  // 연무에 묻힌 먼 능선은 경계를 **낮춥니다**. 그래서 대칭으로 둥글립니다.
  const S_EL = 0.3;
  // 앙각·기울기의 사전값(도). 가속도계가 주는 기울기는 원래 1° 안쪽으로 맞습니다 —
  // 틀리는 것은 주로 방위(자기계)입니다. 약한 사전값이 "방위를 옮기는 것 ≈ 비탈을
  // 기울이는 것" 의 바꿔치기를 막습니다.
  const TILT_SIGMA = opts_tiltSigma(inp);
  const pointTerm = (dy: number, dp: number) => {
    let c = 0;
    for (const p of pts) {
      const ea = wrap180(p.az0 + dy - p.azDeg) * Math.cos(p.elDeg * D2R);
      const ee = p.el0 + dp - p.elDeg;
      c += p.weight * 4 * (cauchy(ea, 0.15) + cauchy(ee, 0.15));
    }
    return c;
  };
  // 열의 후보 중 이 보정에서 DEM 에 가장 가까운 것.
  const pick = (sm: SkySample, dy: number, dp: number, dr: number): SkyCand => {
    if (sm.c.length === 1) return sm.c[0];
    let best = sm.c[0], bestAbs = Infinity;
    for (const c of sm.c) {
      const r = Math.abs(c.el + c.a * dp + c.b * dr - horizonAt(inp.horizon as HorizonProfile, c.az + dy));
      if (r < bestAbs) { bestAbs = r; best = c; }
    }
    return best;
  };
  // 방위 dy 에서 앙각·기울기를 풉니다(IRLS). 반환: 비용, dp, dr, 인라이어 비, 잔차
  const fitTilt = (dy: number, dp0 = 0, dr0 = 0) => {
    let dp = dp0, dr = dr0;
    const res = new Float64Array(sky.length);
    for (let it = 0; it < 6; it++) {
      // 가중 최소제곱  el + a dp + b dr − H(az+dy) = 0
      let saa = 0, sab = 0, sbb = 0, sar = 0, sbr = 0;
      let wsum = 0;
      for (let i = 0; i < sky.length; i++) {
        const sm = sky[i];
        const s = pick(sm, dy, dp, dr);
        const H = horizonAt(inp.horizon as HorizonProfile, s.az + dy);
        const r = s.el + s.a * dp + s.b * dr - H;
        res[i] = r;
        const wi = sm.w / (1 + (r / S_EL) * (r / S_EL));
        const r0 = s.el - H; // dp=dr=0 기준 잔차
        saa += wi * s.a * s.a; sab += wi * s.a * s.b; sbb += wi * s.b * s.b;
        sar += wi * s.a * r0; sbr += wi * s.b * r0; wsum += wi;
      }
      // 점 관측은 앙각에만 (기울기는 점 하나로 못 풂)
      let pa = 0, pr = 0;
      for (const p of pts) { const wp = p.weight * 20; pa += wp; pr += wp * (p.el0 - p.elDeg); }
      const lam = wsum * (S_EL / TILT_SIGMA) * (S_EL / TILT_SIGMA) * 0.15;
      const A11 = saa + pa + lam + 1e-6, A12 = sab, A22 = sbb + lam + 1e-6;
      const B1 = -(sar + pr), B2 = -sbr;
      const det = A11 * A22 - A12 * A12;
      if (Math.abs(det) < 1e-12) break;
      dp = Math.max(-tiltRange, Math.min(tiltRange, (B1 * A22 - B2 * A12) / det));
      dr = Math.max(-tiltRange, Math.min(tiltRange, (A11 * B2 - A12 * B1) / det));
    }
    let cost = 0, inl = 0, sq = 0, wsum = 0;
    for (let i = 0; i < sky.length; i++) {
      const sm = sky[i];
      const s = pick(sm, dy, dp, dr);
      const r = s.el + s.a * dp + s.b * dr - horizonAt(inp.horizon as HorizonProfile, s.az + dy);
      cost += sm.w * cauchy(r, S_EL); wsum += sm.w;
      if (Math.abs(r) < 0.35) { inl++; sq += r * r; }
    }
    const prior = 0.5 * ((dp / TILT_SIGMA) ** 2 + (dr / TILT_SIGMA) ** 2) * 0.006;
    cost = (wsum ? cost / wsum : 0) + prior + pointTerm(dy, dp);
    return { cost, dp, dr, inlierFrac: sky.length ? inl / sky.length : 1, rms: inl ? Math.sqrt(sq / inl) : NaN };
  };

  if (!useSky) {
    // 해·달만 — 방위·앙각을 바로. 기울기는 못 풉니다.
    let sw = 0, sy = 0, sp = 0;
    for (const p of pts) { sw += p.weight; sy += p.weight * wrap180(p.azDeg - p.az0); sp += p.weight * (p.elDeg - p.el0); }
    const dYaw = sy / sw, dPitch = sp / sw;
    if (Math.abs(dYaw) > yawRange || Math.abs(dPitch) > tiltRange) return none('해·달 위치가 센서와 너무 다름');
    return {
      dYaw, dPitch, dRoll: 0, yawObservable: true, tiltObservable: false, confidence: 0.7,
      samples: 0, inlierFrac: 1, residualDeg: 0, yawDistinct: 1, source: 'point',
    };
  }

  // 방위 격자
  const coarse = 0.5;
  const grid: Array<{ dy: number; cost: number; dp: number; dr: number }> = [];
  for (let dy = -yawRange; dy <= yawRange + 1e-9; dy += coarse) {
    const f = fitTilt(dy);
    grid.push({ dy, cost: f.cost, dp: f.dp, dr: f.dr });
  }
  let bi = 0;
  for (let i = 1; i < grid.length; i++) if (grid[i].cost < grid[bi].cost) bi = i;
  // 1.5° 밖의 **모든** 방위 후보 중 가장 좋은 것. 극소만 보면 넓고 얕은 골짜기(모양 없는
  // 비탈)에서 "다른 극소가 없으니 뚜렷하다" 고 잘못 말합니다.
  let second = Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (Math.abs(grid[i].dy - grid[bi].dy) < 1.5) continue;
    second = Math.min(second, grid[i].cost);
  }
  // 세밀하게
  let best = { dy: grid[bi].dy, ...fitTilt(grid[bi].dy, grid[bi].dp, grid[bi].dr) };
  for (let dy = grid[bi].dy - coarse; dy <= grid[bi].dy + coarse + 1e-9; dy += 0.05) {
    const f = fitTilt(dy, best.dp, best.dr);
    if (f.cost < best.cost) best = { dy, ...f };
  }
  // 정확한 모형으로 마무리(선형화를 걷어 냄): 작은 좌표 하강
  const exactCost = (dy: number, dp: number, dr: number) => {
    const a = { yawDeg: inp.sensor.yawDeg + dy, pitchDeg: inp.sensor.pitchDeg + dp, rollDeg: inp.sensor.rollDeg + dr };
    const bb = cameraBasis(a);
    let c = 0, wsum = 0;
    for (const s of sky) {
      let rBest = Infinity;
      for (const cd of s.c) {
        const d = unproject(s.x, cd.y, a, k, bb);
        const r = d.el - horizonAt(inp.horizon as HorizonProfile, d.az);
        if (Math.abs(r) < Math.abs(rBest)) rBest = r;
      }
      c += s.w * cauchy(rBest, S_EL); wsum += s.w;
    }
    c += 0.5 * ((dp / TILT_SIGMA) ** 2 + (dr / TILT_SIGMA) ** 2) * 0.006;
    let cp = 0;
    for (const p of pts) {
      const pr = project(dirFromAzEl(p.azDeg, p.elDeg), a, k, bb);
      if (!pr) { cp += 50; continue; }
      const e = Math.hypot(pr.x - p.x, pr.y - p.y) / pxDeg;
      cp += p.weight * 8 * cauchy(e, 0.15);
    }
    return c / Math.max(1e-9, wsum) + cp;
  };
  let cur = { dy: best.dy, dp: best.dp, dr: best.dr, c: exactCost(best.dy, best.dp, best.dr) };
  for (const st of [0.2, 0.08, 0.03, 0.01]) {
    for (let rep = 0; rep < 4; rep++) {
      let moved = false;
      for (const [ky, kp, kr] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const c = exactCost(cur.dy + ky * st, cur.dp + kp * st, cur.dr + kr * st);
        if (c < cur.c) { cur = { dy: cur.dy + ky * st, dp: cur.dp + kp * st, dr: cur.dr + kr * st, c }; moved = true; }
      }
      if (!moved) break;
    }
  }
  const fin = fitTilt(cur.dy, cur.dp, cur.dr);

  // 관측 가능성 — 보이는 방위 범위 안의 지평선에 **직선 말고** 모양이 있는가.
  // (고른 비탈은 방위를 옮기는 것과 앙각·기울기를 바꾸는 것이 구별되지 않습니다.)
  const azs = sky.map(s => s.c[0].az + cur.dy);
  const Hs = azs.map(a => horizonAt(inp.horizon as HorizonProfile, a));
  const xs = azs.map(a => wrap180(a - azs[0]));
  const mx = xs.reduce((p, v) => p + v, 0) / xs.length, my = Hs.reduce((p, v) => p + v, 0) / Hs.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (Hs[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  let detr = 0;
  for (let i = 0; i < xs.length; i++) detr += (Hs[i] - my - slope * (xs[i] - mx)) ** 2;
  const shapeStd = Math.sqrt(detr / xs.length);
  const yawDistinct = Number.isFinite(second) ? (second - grid[bi].cost) / Math.max(1e-6, grid[bi].cost) : 1;
  const residual = fin.rms;
  // 앙각·기울기는 **방위와 따로** 믿을 수 있어야 합니다. 방위가 헷갈리는 화면(비용이 비슷한
  // 방위 후보가 여럿)에서 그 후보들이 서로 다른 앙각·기울기를 말하면, 어느 하나를 고른 기울기는
  // 방위를 잘못 고른 만큼 틀립니다 — 처음 판에서 방위를 유보하고도 기울기를 1~3° 틀리게 냈습니다.
  const bestCost = grid[bi].cost;
  // ⚠ 문턱을 "두 번째 후보와의 차" 에 비례시켰다가, 차가 0 인(가장 헷갈리는) 화면에서 가까운
  //   후보가 하나도 안 들어가 "안정" 이라고 잘못 말했습니다. 최소 비용의 15% 안은 다 봅니다.
  const near = grid.filter(g => g.cost <= bestCost * 1.15 + 1e-4);
  const spreadP = Math.max(...near.map(g => g.dp)) - Math.min(...near.map(g => g.dp));
  const spreadR = Math.max(...near.map(g => g.dr)) - Math.min(...near.map(g => g.dr));
  const tiltStable = spreadP <= 0.3 && spreadR <= 0.4;
  // 산 능선에서 푼 앙각·기울기는 쓰지 않습니다 — 판정(verify-ar-vision)에서 기울기는 데이터가
  // 약해 센서 쪽으로 끌려 절반쯤만 고쳐졌고(1.0° → 0.38°), 연무에 묻힌 먼 능선 대신 가까운 능선을
  // 잡은 화면은 앙각을 0.8° 틀리게 냈습니다. 가속도계 기울기는 원래 1° 안쪽이라 이득보다 위험이
  // 큽니다. **곧은 수평선**(바다·평야 — 보이는 방위 안의 지평선 기복 < 0.2°)에서만 씁니다.
  let hMin = Infinity, hMax = -Infinity;
  for (const hv of Hs) { if (hv < hMin) hMin = hv; if (hv > hMax) hMax = hv; }
  const flatHorizon = hMax - hMin < 0.2;
  const tiltObservable = flatHorizon && fin.inlierFrac >= 0.75 && residual < 0.25 && tiltStable;
  // 방위를 믿는 조건. "두 번째 후보와의 비용 차" 를 **비**와 **절대값** 둘로 봅니다 — 나무·건물이
  // 열의 일부를 가리면 가린 열의 비용이 최소 비용을 부풀려 비가 작아지지만(0.06~0.16), 절대 차는
  // 그대로입니다(0.11~0.26). 문턱은 판정 화면에서 잰 값으로 골랐습니다(verify-ar-vision):
  //   맞게 푼 화면        비 0.31~32 · 차 0.13~18
  //   가림 속 맞게 푼 화면 비 0.06~0.16 · 차 0.11~0.26
  //   헷갈리는 능선        차 ≤ 0.053
  //   엉뚱한 장소의 DEM    차 ≤ 0.129 (그중 인라이어 ≥ 0.55 인 것은 ≤ 0.111)
  // ⚠ 마지막 줄과 문턱(0.15)의 여유가 얇습니다. 앱에서는 모으기(`createVisionCalibrator`)가
  //   **연속 세 프레임**이 1° 안에서 맞아야 적용하므로, 한 프레임의 우연한 일치는 걸러집니다.
  const yawGap = Number.isFinite(second) ? second - grid[bi].cost : Infinity;
  const yawBySky = fin.inlierFrac >= 0.55 && residual < 0.25 && shapeStd >= 0.12 && yawGap >= 0.1
    && (yawDistinct >= 0.3 || yawGap >= 0.15);
  const yawObservable = yawBySky || pts.length > 0;
  const conf = Math.max(0, Math.min(1,
    (fin.inlierFrac - 0.3) / 0.5 * (residual < 0.3 ? 1 : 0.3) * (yawObservable ? 1 : 0.6)));
  return {
    dYaw: yawObservable ? cur.dy : 0,
    dPitch: tiltObservable || pts.length ? cur.dp : 0,
    dRoll: tiltObservable ? cur.dr : 0,
    yawObservable, tiltObservable, confidence: conf,
    samples: sky.length, inlierFrac: fin.inlierFrac, residualDeg: residual, yawDistinct,
    source: pts.length ? 'skyline+point' : 'skyline',
    profile: inp.debug ? { dy: grid.map(g => g.dy), cost: grid.map(g => g.cost) } : undefined,
    rawYaw: cur.dy,
    yawGap,
    reason: !yawObservable ? `능선이 밋밋함(모양 ${shapeStd.toFixed(2)}°, 구별 ${yawDistinct.toFixed(2)})` : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 프레임을 모아 적용
// ─────────────────────────────────────────────────────────────────────────────

export interface Correction { dYaw: number; dPitch: number; dRoll: number }

export interface VisionCalibrator {
  /** 한 프레임의 풀이를 넣습니다. `angularSpeedDegS` 는 그 순간 자이로 속도. */
  push(r: SolveResult, angularSpeedDegS: number, nowMs: number): void;
  /** 지금 적용할 보정. */
  correction(): Correction;
  status(): { accepted: number; rejected: number; lastReason: string; locked: boolean };
  reset(): void;
}

/**
 * 풀이를 곧장 적용하지 않습니다 — 한 프레임은 틀릴 수 있습니다(구름 밑면을 능선으로
 * 읽음 등). 폰이 멈춰 있을 때(자이로 속도가 작을 때) 나온, 믿을 만한 풀이만 받고,
 * 최근 몇 개의 **중앙값**이 서로 맞을 때 그쪽으로 옮겨 갑니다.
 */
export function createVisionCalibrator(opts: { window?: number; agreeDeg?: number; maxSpeedDegS?: number; minConfidence?: number } = {}): VisionCalibrator {
  const N = opts.window ?? 5;
  const agree = opts.agreeDeg ?? 1.0;
  const maxSpeed = opts.maxSpeedDegS ?? 8;
  const minConf = opts.minConfidence ?? 0.5;
  let yawHist: number[] = [], pitchHist: number[] = [], rollHist: number[] = [];
  let corr: Correction = { dYaw: 0, dPitch: 0, dRoll: 0 };
  let accepted = 0, rejected = 0, lastReason = '', locked = false;
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  return {
    push(r, speed) {
      if (speed > maxSpeed) { rejected++; lastReason = '움직이는 중'; return; }
      if (r.confidence < minConf) { rejected++; lastReason = r.reason ?? '믿기 어려움'; return; }
      accepted++;
      // 풀이는 "그 프레임의 센서 + 지금 보정" 기준이 아니라 **센서 원값** 기준 총 보정입니다.
      if (r.yawObservable) { yawHist.push(r.dYaw); if (yawHist.length > N) yawHist.shift(); }
      if (r.tiltObservable) {
        pitchHist.push(r.dPitch); rollHist.push(r.dRoll);
        if (pitchHist.length > N) { pitchHist.shift(); rollHist.shift(); }
      }
      const k = 3;
      if (yawHist.length >= k && spread(yawHist.slice(-k)) <= agree) {
        const target = med(yawHist);
        corr = { ...corr, dYaw: corr.dYaw + wrap180(target - corr.dYaw) * 0.5 };
        locked = true;
      }
      if (pitchHist.length >= k && spread(pitchHist.slice(-k)) <= agree && spread(rollHist.slice(-k)) <= agree) {
        corr = { ...corr, dPitch: corr.dPitch + (med(pitchHist) - corr.dPitch) * 0.5, dRoll: corr.dRoll + (med(rollHist) - corr.dRoll) * 0.5 };
      }
      lastReason = '';
    },
    correction: () => corr,
    status: () => ({ accepted, rejected, lastReason, locked }),
    reset() { yawHist = []; pitchHist = []; rollHist = []; corr = { dYaw: 0, dPitch: 0, dRoll: 0 }; accepted = 0; rejected = 0; lastReason = ''; locked = false; },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 한 장 분석 — 앱이 부르는 입구
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 해의 **겉보기** 고도(도). 천문 계산(SunCalc)은 기하 고도를 주는데, 카메라가 보는 것은 대기
 * 굴절로 떠오른 해입니다 — 고도 5° 에서 0.16°, 1° 에서 0.4°. 보정 정밀도(0.15°)보다 커서 넣습니다.
 * (Sæmundsson 식. 달은 SunCalc 가 이미 굴절을 더해 줍니다.)
 */
export function apparentAltitude(geometricAltDeg: number): number {
  const h = geometricAltDeg;
  if (h < -1.5) return h;
  const R = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R); // 각분
  return h + R / 60;
}

/**
 * 화면 밖 넓게 — 해·달을 찾아볼 범위. 센서 방위가 ±30° 틀릴 수 있으니 화면 가장자리 밖까지 봅니다.
 */
const BODY_SEARCH_DEG = 35;

export interface CelestialBody {
  /** 겉보기 방위·고도(도). */
  azDeg: number;
  altDeg: number;
  kind: 'sun' | 'moon';
}

export interface FrameAnalysis {
  result: SolveResult;
  skyline: Skyline;
  /** 찾아서 **쓴** 해·달(없으면 null). */
  body: (BrightDisc & { kind: 'sun' | 'moon' }) | null;
  /** 해·달을 찾았지만 능선 풀이와 1° 넘게 달라 버린 경우. */
  bodyRejected: boolean;
}

/**
 * 카메라 한 장으로 센서 자세 보정을 풉니다.
 *
 * 해·달은 **능선과 맞을 때만** 씁니다 — 밝은 구름 조각을 해로 읽으면 점 하나가 방위를 통째로
 * 끌고 가기 때문입니다. 능선이 방위를 가려 주는 화면에서 해·달 없이 푼 방위와 1° 넘게 다르면
 * 해·달을 버립니다. 능선이 없거나 밋밋하면(바다) 해·달이 유일한 근거라 그대로 씁니다.
 */
export function analyzeFrame(inp: {
  frame: RgbFrame;
  intrinsics: Intrinsics;
  sensor: Attitude;
  horizon: HorizonProfile | null;
  bodies: CelestialBody[];
}): FrameAnalysis {
  const k = inp.intrinsics;
  // 1. 해·달 — 센서 자세로 투영한 자리 둘레(방위 오차 여유만큼)에서
  let body: FrameAnalysis['body'] = null;
  for (const b of inp.bodies) {
    if (b.altDeg < -1) continue;
    const dir = dirFromAzEl(b.azDeg, b.altDeg);
    const f = cameraBasis(inp.sensor).f;
    const cosAng = dir[0] * f[0] + dir[1] * f[1] + dir[2] * f[2];
    if (cosAng < Math.cos((HFOV_GUARD(k) / 2 + BODY_SEARCH_DEG) * D2R)) continue;
    const p = project(dir, inp.sensor, k);
    const center = p ?? { x: k.width / 2, y: k.height / 2 };
    const radius = k.fx * Math.tan(BODY_SEARCH_DEG * D2R);
    const d = detectBrightDisc(inp.frame, { near: { x: center.x, y: center.y, radius } });
    if (!d || d.partial) continue;
    // 해는 둘레 하늘까지 거의 포화된 **후광**을 두릅니다(카메라가 노출을 줄여도). 흰 구름 조각은
    // 둘레가 푸른 하늘이라 어둡습니다 — 판정의 "가짜 해" 가 그것이었습니다(능선이 모호한 화면에서
    // 방위를 3° 끌고 감). 달은 반대로 어두운 하늘 속 작은 원입니다.
    const ringMed = Math.max(0, maxLum(inp.frame, d) - d.contrast);
    if (b.kind === 'sun' && ringMed < 0.75) continue;
    if (b.kind === 'moon' && ringMed > 0.5) continue;
    body = { ...d, kind: b.kind };
    break;
  }
  // 2. 능선
  const mask: Array<[number, number]> = body ? [[body.x - Math.sqrt(body.area) * 2, body.x + Math.sqrt(body.area) * 2]] : [];
  const skyline = detectSkyline(inp.frame, { maskColumns: mask });
  const base = { intrinsics: k, sensor: inp.sensor, horizon: inp.horizon, skyline };
  const skyOnly = solveAttitude(base);
  if (!body) return { result: skyOnly, skyline, body: null, bodyRejected: false };
  const bdef = inp.bodies.find(b => b.kind === body!.kind)!;
  const withBody = solveAttitude({ ...base, points: [{ x: body.x, y: body.y, azDeg: bdef.azDeg, elDeg: bdef.altDeg }] });
  if (skyOnly.yawObservable && Math.abs(wrap180(withBody.dYaw - skyOnly.dYaw)) > 1) {
    return { result: skyOnly, skyline, body: null, bodyRejected: true };
  }
  return { result: withBody, skyline, body, bodyRejected: false };
}

const HFOV_GUARD = (k: Intrinsics) => 2 * Math.atan(k.width / 2 / k.fx) * R2D;

/** 덩어리 가운데 화소의 밝기(0~1, RGB 최댓값). `contrast` 가 평균 − 둘레이므로 둘레 ≈ 이것 − contrast. */
function maxLum(frame: RgbFrame, d: BrightDisc): number {
  const x = Math.min(frame.width - 1, Math.max(0, Math.round(d.x - 0.5)));
  const y = Math.min(frame.height - 1, Math.max(0, Math.round(d.y - 0.5)));
  const p = (y * frame.width + x) * frame.channels;
  return Math.max(frame.data[p], frame.data[p + 1], frame.data[p + 2]) / 255;
}

/**
 * `horizonProfile` 과 같되 방위 몇 칸마다 **쉬어 가며**(앱의 JS 스레드를 막지 않게) 구합니다.
 * 휴대폰에서는 1,440칸 × 거리 400개가 1~3초 걸려, 한 번에 돌리면 화면이 멈춥니다.
 */
export async function horizonProfileAsync(
  elev: GroundElevation, eyeElevM: number, opts: HorizonOptions = {}, binsPerSlice = 48,
): Promise<HorizonProfile> {
  const stepDeg = opts.stepDeg ?? 0.25;
  const n = Math.round(360 / stepDeg);
  const out = new Float32Array(n);
  for (let i0 = 0; i0 < n; i0 += binsPerSlice) {
    const part = horizonProfile(elev, eyeElevM, { ...opts, stepDeg, startBin: i0, binCount: Math.min(binsPerSlice, n - i0) } as HorizonOptions);
    out.set(part.elevDeg.subarray(i0, i0 + Math.min(binsPerSlice, n - i0)), i0);
    await new Promise<void>(r => setTimeout(r, 0));
  }
  return { stepDeg, elevDeg: out };
}
