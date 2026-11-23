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

  const colPx: number[] = new Array(cols);
  for (let i = 0; i < cols; i++) {
    colPx[i] = ((i + 0.5) / cols) * intrinsics.width;
  }
  const skyPx = predictSkyline(horizon, attitude, intrinsics, colPx);
  const horizonYNorm = new Float32Array(cols);
  const invH = 1 / Math.max(1, intrinsics.height);
  for (let i = 0; i < cols; i++) {
    horizonYNorm[i] = Number.isFinite(skyPx[i]) ? skyPx[i] * invH : Number.NaN;
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

      // 3D 점 P = (rx, ry, rz) * distM 과 초점 평면 사이의 부호 있는 거리
      const signedErr = (nx * rx + ny * ry + nz * rz) * distM - planeD;
      // 원거리 풍경에서도 미니어처/대구경 공간감이 드러나도록 상대 거리 편차 반영
      const relErr = signedErr / Math.max(1, distM * focusD);
      const coc = relErr * cocScale * 180;
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
      // 하늘(Infinity/0)은 최원경으로 취급해 해·달·구름도 산 능선과 함께 압축
      const t = !Number.isFinite(d) || d <= 0
        ? 1
        : smoothstep(logNear, logFar, Math.log(Math.max(1, d)));
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

      // 지평선 아래인데 정밀 DEM 미로드/바다/범위 밖인 경우 평면 + 능선 각거리 기반 추정 거리
      const hEl = horizon ? horizonAt(horizon, az) : 0;
      if (el <= hEl + 0.08) {
        const depRad = Math.max(0.0025, (hEl + 0.5 - el) * D2R);
        const fallbackEye = Math.max(25, Math.min(350, eyeM > 15 ? eyeM : 60));
        out[i] = clamp(fallbackEye / Math.tan(depRad), 80, 42000);
      } else {
        out[i] = Number.POSITIVE_INFINITY;
      }
    }
  }

  return out;
}
