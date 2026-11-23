/**
 * opticalFilters.ts — 천체 좌표 · 대기 산란 · 3D 차폐 기반 물리 광학 필터 알고리즘.
 *
 * 포함 기능:
 *  1) 역광 렌즈 고스트·플레어 위치 예측(광축 점대칭)
 *  2) 3D 능선 차폐 반응형 선스타(Sunstar) · 2.39:1 아나모픽 플레어 · Black Pro-Mist 파라미터
 *  3) 90° 물리 레일리 편광 필터(CPL) 어둡기·채도 맵 (초광각 밴딩 완화 포함)
 *  4) 안셀 아담스식 흑백 광학 필터(Red 25A / Orange / Yellow) & Zone 0~X 히스토그램
 *  5) 도심 광해 노치 필터(Neodymium / Astro-Clear) 고도별 감쇠 그리드
 */
import {
  cameraBasis,
  dirFromAzEl,
  horizonAt,
  project,
  unproject,
  type Attitude,
  type HorizonProfile,
  type Intrinsics,
} from '../arVision';

const D2R = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ─────────────────────────────────────────────────────────────────────────────
// 1. 역광 고스트 위치 예측 (광축 점대칭)
// ─────────────────────────────────────────────────────────────────────────────

export interface GhostSpot {
  /** 정규화 화면 UV (0..1). */
  u: number;
  v: number;
  /** 정규화 반경(화면 폭 비율). */
  radiusNorm: number;
  /** 예상 고스트 상대 강도(0..1). */
  intensity: number;
  /** 대표 고스트 색조(멀티코팅 렌즈 반사: 녹/청/마젠타). */
  tintRgb: [number, number, number];
}

export interface BacklightGhostResult {
  sunUv: [number, number] | null;
  sunInFrame: boolean;
  /** 화면 중심(광축) 대칭선 상의 렌즈 고스트 후보들. */
  ghosts: GhostSpot[];
}

/**
 * 태양(또는 강한 점광원)이 화면 안팎에 있을 때, 다중 렌즈 요소의 내부 반사로 생기는
 * 광축 대칭선(P_ghost = C + k * (C - P_sun)) 위의 고스트 위치와 반경을 예측합니다.
 */
export function predictBacklightGhosts(
  sunAzDeg: number,
  sunElDeg: number,
  attitude: Attitude,
  intrinsics: Intrinsics,
  opts: { sunStrength?: number } = {},
): BacklightGhostResult {
  const dir = dirFromAzEl(sunAzDeg, sunElDeg);
  const pt = project(dir, attitude, intrinsics);
  if (!pt) return { sunUv: null, sunInFrame: false, ghosts: [] };

  const su = pt.x / Math.max(1, intrinsics.width);
  const sv = pt.y / Math.max(1, intrinsics.height);
  const cu = intrinsics.cx / Math.max(1, intrinsics.width);
  const cv = intrinsics.cy / Math.max(1, intrinsics.height);

  const sunInFrame = su >= -0.2 && su <= 1.2 && sv >= -0.2 && sv <= 1.2;
  const distFromCenter = Math.hypot(su - cu, sv - cv);
  // 화면 밖 너무 멀면 고스트 무시
  if (distFromCenter > 1.35) {
    return { sunUv: [su, sv], sunInFrame, ghosts: [] };
  }

  const strength = clamp(opts.sunStrength ?? 1.0, 0, 1);
  // 스마트폰 멀티렌즈 반사 비율(대칭 계수 k, 반경, 상대 강도, 코팅 색조)
  const elements: ReadonlyArray<{ k: number; r: number; w: number; tint: [number, number, number] }> = [
    { k: -0.35, r: 0.022, w: 0.45, tint: [0.55, 0.95, 0.72] },
    { k: -0.78, r: 0.036, w: 0.62, tint: [0.45, 0.88, 0.95] },
    { k: -1.0,  r: 0.052, w: 0.85, tint: [0.65, 1.0, 0.75] }, // 주 점대칭 고스트
    { k: -1.42, r: 0.075, w: 0.40, tint: [0.92, 0.62, 0.88] },
    { k: 0.48,  r: 0.028, w: 0.30, tint: [0.98, 0.84, 0.55] }, // 태양 쪽 전방 반사
  ];

  const du = su - cu;
  const dv = sv - cv;
  const ghosts: GhostSpot[] = [];

  for (const el of elements) {
    const gu = cu + du * el.k;
    const gv = cv + dv * el.k;
    if (gu < -0.15 || gu > 1.15 || gv < -0.15 || gv > 1.15) continue;
    // 중심에 가까울수록 고스트가 작고 약해지며, 중외곽(0.25~0.75)에서 가장 뚜렷함
    const offAxisGain = clamp(distFromCenter / 0.25, 0.2, 1.0);
    ghosts.push({
      u: gu,
      v: gv,
      radiusNorm: el.r * (0.85 + 0.35 * distFromCenter),
      intensity: clamp(el.w * offAxisGain * strength, 0, 1),
      tintRgb: el.tint,
    });
  }

  return { sunUv: [su, sv], sunInFrame, ghosts };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 3D 차폐 반응형 선스타(Sunstar) · 아나모픽 플레어 · Black Pro-Mist
// ─────────────────────────────────────────────────────────────────────────────

export interface SunstarFlareParams {
  visible: boolean;
  sunUv: [number, number] | null;
  /** 3D 능선에 의해 가려진 비율(0=완전 노출, 1=완전 차폐). 0.2~0.85 구간에서 선스타 극대화. */
  occludedFraction: number;
  /** 선스타(빛갈라짐) 광선 수(짝수: 6, 8, 10, 12 등). */
  rayCount: number;
  /** 선스타 강도(0..1). */
  sunstarIntensity: number;
  /** 선스타 광선 길이(화면 폭 비율). */
  sunstarLengthNorm: number;
  /** 2.39:1 아나모픽 수평 플레어 강도(0..1) 및 반폭(화면 폭 비율). */
  anamorphicIntensity: number;
  anamorphicHalfWidthNorm: number;
  /** Black Pro-Mist 할레이션/글로우 반경(화면 폭 비율)과 세기(0..1). */
  proMistRadiusNorm: number;
  proMistStrength: number;
}

/**
 * 태양/달의 3D 지평선 차폐율과 대기 탁도(AOD)를 계산해
 * 선스타(회절 스파이크), 아나모픽 수평 플레어, Black Pro-Mist 글로우 파라미터를 산출합니다.
 */
export function computeSunstarAndFlareParams(
  sunAzDeg: number,
  sunElDeg: number,
  attitude: Attitude,
  intrinsics: Intrinsics,
  opts: {
    horizon?: HorizonProfile | null;
    sunAngularRadiusDeg?: number;
    aod?: number;
    apertureBlades?: number;
    proMistGrade?: 0.125 | 0.25 | 0.5 | 1;
  } = {},
): SunstarFlareParams {
  const dir = dirFromAzEl(sunAzDeg, sunElDeg);
  const pt = project(dir, attitude, intrinsics);
  const blades = opts.apertureBlades ?? 8;
  // 짝수 조리개 날 → 날 수만큼 광선, 홀수 날 → 2배 광선(광학 회절 법칙)
  const rayCount = blades % 2 === 0 ? blades : blades * 2;

  if (!pt) {
    return {
      visible: false,
      sunUv: null,
      occludedFraction: 1,
      rayCount,
      sunstarIntensity: 0,
      sunstarLengthNorm: 0,
      anamorphicIntensity: 0,
      anamorphicHalfWidthNorm: 0,
      proMistRadiusNorm: 0,
      proMistStrength: 0,
    };
  }

  const su = pt.x / Math.max(1, intrinsics.width);
  const sv = pt.y / Math.max(1, intrinsics.height);
  const rDeg = opts.sunAngularRadiusDeg ?? 0.266;
  const horizonEl = opts.horizon ? horizonAt(opts.horizon, sunAzDeg) : 0;

  // 태양 원반이 능선에 걸린 비율 계산 (0=완전 위, 1=완전 아래)
  const dEl = sunElDeg - horizonEl;
  const occludedFraction = clamp((rDeg - dEl) / (2 * rDeg), 0, 1);
  const visible = occludedFraction < 0.995;

  // 능선 모서리에 살짝 걸려 점광원화될 때(occluded 0.3~0.85) 선스타가 가장 선명해짐
  const grazingBoost = Math.exp(-Math.pow((occludedFraction - 0.62) / 0.28, 2));
  const exposed = 1 - occludedFraction;
  const aod = clamp(opts.aod ?? 0.2, 0.02, 1.2);
  const clarity = clamp(1 - aod * 0.55, 0.25, 1);

  const sunstarIntensity = visible ? clamp((0.35 * exposed + 0.65 * grazingBoost) * clarity, 0, 1) : 0;
  const sunstarLengthNorm = 0.10 + 0.18 * sunstarIntensity;

  // 아나모픽 수평 스트릭은 광원이 밝고 노출될수록 강함
  const anamorphicIntensity = visible ? clamp(Math.pow(exposed, 0.6) * (0.7 + 0.3 * grazingBoost), 0, 1) : 0;
  const anamorphicHalfWidthNorm = 0.22 + 0.45 * anamorphicIntensity;

  // Pro-Mist 글로우는 필터 등급(1/8 ~ 1)과 대기 탁도(AOD)에 비례
  const grade = opts.proMistGrade ?? 0.25;
  const proMistStrength = visible ? clamp(grade * (0.55 + 0.7 * aod) * exposed, 0, 1) : 0;
  const proMistRadiusNorm = 0.04 + 0.12 * grade * (1 + 0.5 * aod);

  return {
    visible,
    sunUv: [su, sv],
    occludedFraction,
    rayCount,
    sunstarIntensity,
    sunstarLengthNorm,
    anamorphicIntensity,
    anamorphicHalfWidthNorm,
    proMistRadiusNorm,
    proMistStrength,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 물리 레일리 편광 필터 (3D Rayleigh CPL)
// ─────────────────────────────────────────────────────────────────────────────

export interface RayleighCplOptions {
  /** 편광 필터 회전 강도(0=꺼짐, 1=최대 편광 차단). 기본 0.75. */
  strength?: number;
  /**
   * 초광각 밴딩 완화(0=실물 CPL의 90° 얼룩 그대로 재현, 1=초광각에서도 균일하게 보정).
   * 기본 0.55.
   */
  wideUniformity?: number;
  /** 최대 감광 스톱(EV). 기본 1.6 EV. */
  maxStops?: number;
}

/**
 * 모든 그리드 픽셀의 태양 각거리 γ에서 레일리 편광도 P(γ) = sin²γ / (1 + cos²γ)를 계산해
 * 가상 CPL의 하늘 감광 게인(0..1) 그리드를 생성합니다.
 */
export function computeRayleighCplGrid(
  sunAzDeg: number,
  sunElDeg: number,
  attitude: Attitude,
  intrinsics: Intrinsics,
  gridW = 48,
  gridH = 36,
  opts: RayleighCplOptions = {},
): Float32Array {
  const strength = clamp(opts.strength ?? 0.75, 0, 1);
  const uniformity = clamp(opts.wideUniformity ?? 0.55, 0, 1);
  const maxStops = clamp(opts.maxStops ?? 1.6, 0, 3.0);

  const sunDir = dirFromAzEl(sunAzDeg, sunElDeg);
  const basis = cameraBasis(attitude);
  const out = new Float32Array(gridW * gridH);

  // 화면 중심의 평균 편광도 계산(초광각 밴딩 완화 시 기준값)
  const center = unproject(intrinsics.cx, intrinsics.cy, attitude, intrinsics, basis);
  const cDir = dirFromAzEl(center.az, center.el);
  const cCos = clamp(cDir[0] * sunDir[0] + cDir[1] * sunDir[1] + cDir[2] * sunDir[2], -1, 1);
  const cSin2 = Math.max(0, 1 - cCos * cCos);
  const centerPol = cSin2 / (1 + cCos * cCos);

  for (let y = 0; y < gridH; y++) {
    const py = ((y + 0.5) / gridH) * intrinsics.height;
    for (let x = 0; x < gridW; x++) {
      const px = ((x + 0.5) / gridW) * intrinsics.width;
      const { az, el } = unproject(px, py, attitude, intrinsics, basis);
      const d = dirFromAzEl(az, el);
      const cosG = clamp(d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2], -1, 1);
      const sin2G = Math.max(0, 1 - cosG * cosG);
      const rawPol = sin2G / (1 + cosG * cosG);

      // 지평선 아래(el < 0)는 하늘 레일리 편광 대상이 아니므로 부드럽게 감쇠
      const skyFactor = clamp((el + 2) / 10, 0, 1);
      const effPol = rawPol * (1 - uniformity) + centerPol * uniformity;
      const stops = maxStops * strength * effPol * skyFactor;
      out[y * gridW + x] = Math.pow(2, -stops);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 안셀 아담스 흑백 광학 필터 & Zone System (Zone 0~X)
// ─────────────────────────────────────────────────────────────────────────────

export type MonochromeOpticalFilter = 'neutral' | 'yellow8' | 'orange21' | 'red25A' | 'deepSky';

export interface MonochromeFilterResult {
  /** 흑백 변환 선형 RGB 채널 가중치(합 ≈ 1.0, Red 25A는 B가 음수여도 가능 → 파란 하늘 깊은 흑화). */
  channelWeights: [number, number, number];
  /** 3D 표면 법선(n · l) 양지/음지 마이크로 콘트라스트 권장 계수. */
  reliefContrastBoost: number;
  /** 하늘(단파장) 추가 감쇠 스톱(EV). */
  skyDarkenStops: number;
}

/**
 * 레일리/미 산란 비율(AOD·태양 고도)에 맞춰 실제 흑백 광학 필터의 스펙트럼 투과를 재현합니다.
 * Red 25A 필터는 단파장(청색 하늘)을 강하게 차단해 하늘을 Zone I~II로 가라앉히고 구름·암석을 띄웁니다.
 */
export function computeMonochromeFilterWeights(
  filter: MonochromeOpticalFilter,
  sunAltDeg: number,
  aod: number,
): MonochromeFilterResult {
  const clarity = clamp(1 - clamp(aod, 0.02, 1) * 0.5, 0.35, 1);
  const lowSun = clamp(1 - Math.abs(sunAltDeg - 15) / 45, 0, 1);

  switch (filter) {
    case 'yellow8':
      return {
        channelWeights: [0.42, 0.52, 0.06],
        reliefContrastBoost: 1.15 + 0.1 * lowSun,
        skyDarkenStops: 0.45 * clarity,
      };
    case 'orange21':
      return {
        channelWeights: [0.64, 0.40, -0.04],
        reliefContrastBoost: 1.28 + 0.15 * lowSun,
        skyDarkenStops: 1.05 * clarity,
      };
    case 'red25A':
      return {
        channelWeights: [0.88, 0.24, -0.12],
        reliefContrastBoost: 1.42 + 0.18 * lowSun,
        skyDarkenStops: 1.85 * clarity,
      };
    case 'deepSky':
      // 적외선 느낌의 초고대비 하늘 흑화 (물리적 IR 근사)
      return {
        channelWeights: [1.05, 0.15, -0.20],
        reliefContrastBoost: 1.55 + 0.2 * lowSun,
        skyDarkenStops: 2.35 * clarity,
      };
    default:
      return {
        channelWeights: [0.2126, 0.7152, 0.0722],
        reliefContrastBoost: 1.0,
        skyDarkenStops: 0,
      };
  }
}

export interface ZoneHistogramResult {
  /** Zone 0(순수 블랙) ~ Zone X(순수 화이트) 11개 구간의 픽셀 비율(합=1.0). */
  zones: Float32Array;
  /** Zone 0(암부 클리핑) 비율. */
  blackClipRatio: number;
  /** Zone X(명부 클리핑) 비율. */
  whiteClipRatio: number;
  /** 평균 존 위치(0..10). 5.0이 18% 미들 그레이(Zone V). */
  meanZone: number;
}

/**
 * 0..1 정규화 휘도(luma) 버퍼에서 안셀 아담스 11단계 Zone System 분포를 계산합니다.
 */
export function computeZoneSystemHistogram(luma: Float32Array): ZoneHistogramResult {
  const zones = new Float32Array(11);
  const n = luma.length;
  if (n === 0) {
    return { zones, blackClipRatio: 0, whiteClipRatio: 0, meanZone: 5 };
  }

  let sumZone = 0;
  for (let i = 0; i < n; i++) {
    const v = clamp(luma[i], 0, 1);
    const z = Math.min(10, Math.floor(v * 11));
    zones[z] += 1;
    sumZone += v * 10;
  }

  const inv = 1 / n;
  for (let z = 0; z < 11; z++) zones[z] *= inv;

  return {
    zones,
    blackClipRatio: zones[0],
    whiteClipRatio: zones[10],
    meanZone: sumZone * inv,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 도심 광해 노치 필터 (Neodymium / Astro-Clear)
// ─────────────────────────────────────────────────────────────────────────────

export interface LightPollutionNotchResult {
  /** 그리드별 광해 감쇠 강도(0=천정 맑음, 1=지평선 광해 최대). */
  pollutionWeightGrid: Float32Array;
  /** 나트륨등(570~600nm 황색) 노치 제거용 RGB 감산 색조(정규화). */
  sodiumCastRgb: [number, number, number];
  gridW: number;
  gridH: number;
}

/**
 * 고도각(대기질량 Air Mass)과 Bortle 등급(1~9)을 결합해 지평선 근처에 깔리는
 * 도심 황색 광해(나트륨등)만 선택적으로 걷어내는 공간 가중치 그리드를 계산합니다.
 */
export function computeLightPollutionNotchGrid(
  attitude: Attitude,
  intrinsics: Intrinsics,
  gridW = 48,
  gridH = 36,
  opts: {
    /** Bortle 광해 등급(1=최상 암흑 ~ 9=도심 중심). 기본 7. */
    bortleClass?: number;
    aod?: number;
    horizon?: HorizonProfile | null;
    strength?: number;
  } = {},
): LightPollutionNotchResult {
  const bortle = clamp(opts.bortleClass ?? 7, 1, 9);
  const aod = clamp(opts.aod ?? 0.25, 0.05, 1.2);
  const strength = clamp(opts.strength ?? 0.75, 0, 1);

  // Bortle 1→0.05, 5→0.45, 9→1.0
  const bortleFactor = clamp((bortle - 1) / 8, 0.05, 1);
  const basis = cameraBasis(attitude);
  const grid = new Float32Array(gridW * gridH);

  for (let y = 0; y < gridH; y++) {
    const py = ((y + 0.5) / gridH) * intrinsics.height;
    for (let x = 0; x < gridW; x++) {
      const px = ((x + 0.5) / gridW) * intrinsics.width;
      const { az, el } = unproject(px, py, attitude, intrinsics, basis);
      const hEl = opts.horizon ? horizonAt(opts.horizon, az) : 0;
      if (el < hEl - 0.5) {
        // 지상 영역은 광해 노치 제외(가로등 야경 자체 색 보존)
        grid[y * gridW + x] = 0;
        continue;
      }
      const effEl = Math.max(1.0, el);
      // 저고도일수록 광해 산란층 경로(Air Mass)가 급격히 길어짐
      const airMass = 1 / (Math.sin(effEl * D2R) + 0.15 * Math.pow(effEl + 3.885, -1.253));
      const lowAltGlow = clamp((airMass - 1) / 8.5, 0, 1);
      grid[y * gridW + x] = clamp((0.25 + 0.75 * lowAltGlow) * bortleFactor * (0.7 + 0.5 * aod) * strength, 0, 1);
    }
  }

  return {
    pollutionWeightGrid: grid,
    // 고압 나트륨등(HPS) 황색 피크 성분 (R=1.0, G=0.74, B=0.22)
    sodiumCastRgb: [1.0, 0.74, 0.22],
    gridW,
    gridH,
  };
}
