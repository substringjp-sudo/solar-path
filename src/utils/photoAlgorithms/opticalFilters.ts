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
    /** 이미지 기반 추론된 건물·능선 스카이라인(0..1 정규화 Y). 전달되면 건물 차폐까지 반영합니다. */
    skylineYNorm?: Float32Array | null;
    /** 렌더링된 장면에서 실측된 광원 점광속(0..1). 구름·건물에 가려 광속이 없으면 플레어를 억제합니다. */
    measuredSourceFlux?: number;
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
  const cu = intrinsics.cx / Math.max(1, intrinsics.width);
  const cv = intrinsics.cy / Math.max(1, intrinsics.height);

  // 렌즈 경통/후드 입사 허용 각도 밖이면 전면 렌즈에 직접 입사하지 않음
  const offAxisDist = Math.hypot(su - cu, sv - cv);
  if (offAxisDist > 1.08) {
    return {
      visible: false,
      sunUv: [su, sv],
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

  const rDeg = opts.sunAngularRadiusDeg ?? 0.266;
  const horizonEl = opts.horizon ? horizonAt(opts.horizon, sunAzDeg) : 0;

  // 1) 3D DEM 능선 차폐율
  const dEl = sunElDeg - horizonEl;
  let occludedFraction = clamp((rDeg - dEl) / (2 * rDeg), 0, 1);

  // 2) 이미지 스카이라인(높은 건물·나무·능선) 차폐 반영
  if (opts.skylineYNorm && opts.skylineYNorm.length > 0 && su >= 0 && su <= 1) {
    const col = clamp(Math.floor(su * opts.skylineYNorm.length), 0, opts.skylineYNorm.length - 1);
    const skyY = opts.skylineYNorm[col];
    if (Number.isFinite(skyY)) {
      const rNorm = Math.max(0.008, (rDeg * D2R * intrinsics.fy) / Math.max(1, intrinsics.height));
      // sv > skyY 이면 건물/능선 아래로 가려진 상태
      const bldgOccl = clamp((sv - (skyY - rNorm)) / (2 * rNorm), 0, 1);
      occludedFraction = Math.max(occludedFraction, bldgOccl);
    }
  }

  // 3) 실측 광속(구름 차폐 등) 반영: 광원이 두꺼운 구름이나 건물에 막혀 있으면 0
  const fluxGate = opts.measuredSourceFlux !== undefined ? clamp(opts.measuredSourceFlux, 0, 1) : 1;
  const visible = occludedFraction < 0.98 && fluxGate > 0.05;

  // 능선·건물 모서리에 살짝 걸려 점광원(슬릿)화될 때(occluded 0.25~0.85) 프레넬-키르히호프 회절이 극대화됨
  const grazingBoost = Math.exp(-Math.pow((occludedFraction - 0.58) / 0.26, 2));
  const exposed = 1 - occludedFraction;
  const aod = clamp(opts.aod ?? 0.2, 0.02, 1.2);
  const clarity = clamp(1 - aod * 0.55, 0.25, 1);

  // 4) 광축 입사각(θ_i)에 따른 프레넬(Fresnel) 내부 반사 게인:
  // 정중앙(offAxisDist ≈ 0)에서는 AR 멀티코팅 투과율이 가장 높고,
  // 비축 입사(offAxisDist 0.15~0.65)에서 렌즈 요소 간 내부 반사 및 실린더 산란이 강해집니다.
  const cosTheta = 1 / Math.hypot(1, offAxisDist * 0.95);
  const fresnelGain = clamp(0.42 + 2.8 * Math.pow(1 - cosTheta, 1.35), 0.42, 1.25);
  const hoodVignette = 1 - clamp((offAxisDist - 0.72) / 0.36, 0, 1);
  const opticalGain = fresnelGain * hoodVignette * fluxGate;

  const sunstarIntensity = visible
    ? clamp((0.28 * exposed + 0.72 * grazingBoost) * clarity * fluxGate * hoodVignette, 0, 1)
    : 0;
  const sunstarLengthNorm = 0.09 + 0.18 * sunstarIntensity;

  // 아나모픽 플레어는 실제 입사 광속 × 비축 프레넬 게인 × 모서리 회절에 비례
  const anamorphicIntensity = visible
    ? clamp(Math.pow(exposed, 0.55) * (0.55 + 0.45 * grazingBoost) * opticalGain, 0, 1)
    : 0;
  const anamorphicHalfWidthNorm = 0.18 + 0.46 * anamorphicIntensity;

  // Pro-Mist 글로우는 필터 등급(1/8 ~ 1)과 대기 탁도(AOD)에 비례
  const grade = opts.proMistGrade ?? 0.25;
  const proMistStrength = visible ? clamp(grade * (0.55 + 0.7 * aod) * exposed * fluxGate, 0, 1) : 0;
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
  /** 이미지 기반 추론된 건물·능선 스카이라인(0..1 정규화 Y). 전달되면 건물·산을 제외한 하늘만 편광 감광합니다. */
  skylineYNorm?: Float32Array | null;
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
  const skyLine = opts.skylineYNorm;

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
    const v = (y + 0.5) / gridH;
    const py = v * intrinsics.height;
    for (let x = 0; x < gridW; x++) {
      const u = (x + 0.5) / gridW;
      const px = u * intrinsics.width;
      const { az, el } = unproject(px, py, attitude, intrinsics, basis);
      const d = dirFromAzEl(az, el);
      const cosG = clamp(d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2], -1, 1);
      const sin2G = Math.max(0, 1 - cosG * cosG);
      const rawPol = sin2G / (1 + cosG * cosG);

      // 스카이라인(건물 옥상·산 능선)이 있으면 그 위쪽 하늘만 편광 적용, 없으면 고도각 폴백
      let skyFactor = clamp((el + 2) / 10, 0, 1);
      if (skyLine && skyLine.length > 0) {
        const col = clamp(Math.floor(u * skyLine.length), 0, skyLine.length - 1);
        const hy = skyLine[col];
        if (Number.isFinite(hy)) {
          skyFactor = clamp((hy + 0.015 - v) / 0.035, 0, 1);
        }
      }
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
    /** 이미지 기반 추론된 건물·능선 스카이라인(0..1 정규화 Y). 전달되면 건물 야경 조명 색을 보존하고 하늘 광해만 제거합니다. */
    skylineYNorm?: Float32Array | null;
    strength?: number;
  } = {},
): LightPollutionNotchResult {
  const bortle = clamp(opts.bortleClass ?? 7, 1, 9);
  const aod = clamp(opts.aod ?? 0.25, 0.05, 1.2);
  const strength = clamp(opts.strength ?? 0.75, 0, 1);
  const skyLine = opts.skylineYNorm;

  // Bortle 1→0.05, 5→0.45, 9→1.0
  const bortleFactor = clamp((bortle - 1) / 8, 0.05, 1);
  const basis = cameraBasis(attitude);
  const grid = new Float32Array(gridW * gridH);

  for (let y = 0; y < gridH; y++) {
    const v = (y + 0.5) / gridH;
    const py = v * intrinsics.height;
    for (let x = 0; x < gridW; x++) {
      const u = (x + 0.5) / gridW;
      const px = u * intrinsics.width;
      const { az, el } = unproject(px, py, attitude, intrinsics, basis);

      if (skyLine && skyLine.length > 0) {
        const col = clamp(Math.floor(u * skyLine.length), 0, skyLine.length - 1);
        const hy = skyLine[col];
        if (Number.isFinite(hy)) {
          if (v > hy + 0.01) {
            // 실제 건물·능선 실루엣 아래(지상·건물 창문 야경)는 광해 노치에서 제외
            grid[y * gridW + x] = 0;
            continue;
          }
          const skyGate = clamp((hy + 0.01 - v) / 0.025, 0, 1);
          const aboveSkylineNorm = Math.max(0, hy - v);
          const horizonGlow = Math.exp(-aboveSkylineNorm / 0.26);
          const effEl = Math.max(1.0, el);
          const airMass = 1 / (Math.sin(effEl * D2R) + 0.15 * Math.pow(effEl + 3.885, -1.253));
          const lowAltGlow = Math.max(horizonGlow, clamp((airMass - 1) / 8.5, 0, 1));
          grid[y * gridW + x] = clamp((0.25 + 0.75 * lowAltGlow) * bortleFactor * (0.7 + 0.5 * aod) * strength * skyGate, 0, 1);
          continue;
        }
      }

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
