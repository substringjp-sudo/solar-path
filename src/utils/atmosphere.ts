/**
 * atmosphere.ts
 *
 * 하늘 · 태양 · 구름의 색을 하나의 물리 모델에서 일관되게 계산합니다.
 *
 * Why: 기존 3D는 하늘을 회귀 근사(getApproximatedSkyColor)로, 태양을 별도 halo 원판으로,
 * 구름을 단색으로 칠했습니다. 세 가지가 서로 다른 근거로 계산되니 색이 따로 놀고 과포화됐습니다.
 * 여기서는 셋 다 같은 대기 상태(광학 두께 · 습도 · 미세먼지)에서 유도합니다.
 *
 * 구성
 *  1) 대기 파라미터: 가시거리/습도/PM 농도 → Mie 혼탁도(β)와 Ångström 지수
 *  2) 하늘: 단일산란 + 다중산란 근사 (Rayleigh λ⁻⁴ + Mie HG 위상함수 + 오존 Chappuis)
 *  3) 태양: 같은 광학 두께로 감쇠한 직달광 (sunsetPhysics.directBeamRGB 재사용)
 *  4) 구름: 광학 두께 τ 기반 2-stream 근사 — 얇으면 투과·전방산란으로 빛나고,
 *     두꺼우면 다중산란이 포화되어 윗면은 희고 아랫면은 회색으로 어두워짐
 *
 * TS 구현과 GLSL 구현이 **같은 상수**를 공유하도록, 상수를 TS에서 정의하고
 * GLSL 문자열에 주입합니다. 두 구현이 갈라지는 것을 구조적으로 막습니다.
 */
import { directBeamRGB, aerosolBeta, airMass, clamp01, type RGB } from './sunsetPhysics';

// ── 물리 상수 (TS·GLSL 공용) ───────────────────────────────────────────────
/** 대표 파장 (nm) — sunsetPhysics와 동일 */
export const LAMBDA_RGB: [number, number, number] = [650, 550, 450];
/** 해수면 천정 방향 550nm Rayleigh 광학두께 */
export const TAU_R_550 = 0.0972;
/** Rayleigh 파장 지수 (이론값 4, 실측 보정 4.05) */
export const TAU_R_EXP = 4.05;
/** 오존 Chappuis 흡수 계수 (R/G/B, 300DU 기준) */
export const OZONE_TAU: [number, number, number] = [0.015, 0.03, 0.002];
/** Mie 위상함수 비대칭 인자 (에어로졸: 전방산란 우세) */
export const MIE_G = 0.76;
/** 구름 물방울 위상함수 비대칭 인자 (강한 전방산란) */
export const CLOUD_G = 0.85;

/** 산란 이득 — 물리량을 화면 밝기로 옮기는 노출 상수 (아트 디렉션 지점) */
export const RAYLEIGH_GAIN = 1.0;
export const MIE_GAIN = 1.0;
/** 다중산란(하늘 전체가 서로 빛을 주고받는 성분) 이득 */
export const MULTI_SCATTER_GAIN = 0.42;
/** 최종 노출 */
export const SKY_EXPOSURE = 22.0;

/** 대기광이 완전히 사라지는 태양 고도 (천문박명) */
export const TWILIGHT_END_DEG = -16.0;
/** 밤하늘 바닥 색 (별빛 + 대기광, linear) */
export const NIGHT_SKY: RGB = { r: 0.0008, g: 0.0011, b: 0.0026 };

/**
 * 다중산란 항에 적용할 태양 대기질량 상한.
 *
 * Why: 단일산란은 태양광이 산란점까지 오는 실제 경로로 감쇠시켜야 하지만,
 * 다중산란으로 들어오는 빛은 하늘 전역에서 오므로 그렇게 감쇠하지 않습니다.
 * 이 상한이 없으면 일몰에 파랑이 완전히 죽어 하늘 전체가 단색 빨강이 됩니다.
 * (실제 노을 하늘은 지평선만 붉고 천정은 파랗게 남습니다.)
 */
export const MS_AIRMASS_CAP = 4.0;

/**
 * 다중산란 경로 길이를 직달 경로의 몇 배로 볼지.
 *
 * Why: 상한을 상수로만 두면 해가 지평선에 걸렸을 때 문제가 생깁니다. 그 순간에는
 * 대기로 들어오는 빛 자체가 이미 붉기 때문에 다중산란 성분도 붉어야 하는데,
 * 상한이 낮으면 파랑이 과하게 살아남아 오히려 덜 붉어집니다.
 * 그래서 태양이 낮을수록 다중산란 경로도 함께 길어지도록 비례항을 둡니다.
 */
export const MS_AIRMASS_FRACTION = 0.35;

/**
 * 유효 산란 고도 — 시선 고도에 따른 대기 척도고도(scale height) 배수.
 *
 * Why: 하늘 전체에 태양 대기질량 하나를 쓰면, 해가 지평선에 걸렸을 때 천정까지
 * 빨갛게 물듭니다. 실제로는 시선 방향마다 산란이 일어나는 대표 고도가 다릅니다.
 *  - 지평선을 보면 관측자 근처의 짙은 저고도 대기를 봅니다 → 햇빛이 두꺼운 대기를
 *    통과해 와서 붉습니다.
 *  - 천정을 보면 머리 위 기둥의 고고도를 봅니다 → 그 높이의 공기를 비추는 햇빛은
 *    훨씬 얇은 대기만 지나므로 파랑이 살아남습니다.
 * 이것이 일몰에 지평선만 붉고 천정은 푸르게 남는 이유(박명 아치)입니다.
 */
export const SCATTER_HEIGHT_HORIZON = 0.15;
export const SCATTER_HEIGHT_ZENITH = 1.6;

/**
 * 투과율 계산에 쓸 태양 고도의 하한.
 *
 * Why: 태양이 지평선 아래로 가면 Kasten-Young 대기질량이 포화되어 투과율이
 * 0으로 떨어집니다. 하지만 박명은 **상층 대기가 아직 햇빛을 받아** 생기는
 * 현상이라 색은 남아 있어야 합니다. 색은 이 하한에서 고정하고, 밝기만
 * TWILIGHT_END_DEG까지 램프로 줄입니다.
 */
export const TRANSMITTANCE_MIN_SUN_ALT = -1.0;

// ── 1) 대기 파라미터 ───────────────────────────────────────────────────────

export interface AtmosphereParams {
  /** 550nm 에어로졸 광학두께 (혼탁도) */
  betaMie: number;
  /** Ångström 지수 — 입자 크기 지표. 작을수록 큰 입자(황사/안개) */
  angstrom: number;
  /** 관측자 고도에 따른 공기 기둥 밀도 배율 */
  elevScale: number;
  /** 위도 기반 오존 컬럼 (DU) */
  ozoneDU: number;
  /** 연중 일수 (지구-태양 거리 보정) */
  dayOfYear: number;
  /** 관측자 고도 (m) */
  observerElevM: number;
  /** 위도 */
  latitude: number;
}

export interface AtmosphereInput {
  visibilityM?: number;
  humidityPct?: number;
  /** 미세먼지 PM2.5 (µg/m³). 있으면 혼탁도에 가산 */
  pm25?: number;
  observerElevM?: number;
  latitude?: number;
  dayOfYear?: number;
}

/**
 * 관측 가능한 기상값에서 대기 광학 파라미터를 유도합니다.
 *
 * - 가시거리 → Koschmieder 관계로 소산계수 → β
 * - 습도 → 에어로졸 흡습 성장 (80% 이상에서 급증)
 * - PM2.5 → β에 직접 가산하고, 큰 입자가 늘어나므로 Ångström 지수를 낮춤
 *   (Ångström 지수가 낮아지면 파장 의존성이 줄어 하늘이 희뿌옇게 변합니다)
 */
export function makeAtmosphereParams(input: AtmosphereInput = {}): AtmosphereParams {
  const {
    visibilityM,
    humidityPct,
    pm25,
    observerElevM = 0,
    latitude = 37.5665,
    dayOfYear = 172,
  } = input;

  // 가시거리 + 습도 기반 기본 혼탁도 (기존 엔진 재사용)
  let beta = aerosolBeta(visibilityM, humidityPct);

  // 미세먼지 가산: PM2.5 25µg/m³당 약 β +0.05 (경험적 스케일)
  let angstrom = 1.3;
  if (pm25 != null && pm25 > 0) {
    beta += Math.min(0.35, (pm25 / 25) * 0.05);
    // 고농도일수록 조대입자 비중이 커져 파장 의존성이 약해짐
    angstrom = 1.3 - Math.min(0.85, (pm25 / 80) * 0.85);
  }
  // 고습도에서도 입자가 커져 Ångström이 내려감 (안개/연무의 흰 하늘)
  if (humidityPct != null && humidityPct > 85) {
    angstrom -= Math.min(0.35, (humidityPct - 85) / 15 * 0.35);
  }

  beta = Math.max(0.02, Math.min(0.9, beta));
  angstrom = Math.max(0.15, Math.min(1.6, angstrom));

  const latRad = (latitude * Math.PI) / 180;

  return {
    betaMie: beta,
    angstrom,
    elevScale: Math.exp(-Math.max(0, observerElevM) / 8000),
    ozoneDU: 300 + 80 * Math.pow(Math.sin(latRad), 2),
    dayOfYear,
    observerElevM,
    latitude,
  };
}

// ── 2) 하늘 복사휘도 ───────────────────────────────────────────────────────

/** Rayleigh 위상함수 */
export function rayleighPhase(cosGamma: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosGamma * cosGamma);
}

/** Henyey-Greenstein 위상함수 */
export function hgPhase(cosGamma: number, g: number): number {
  const gg = g * g;
  const denom = 1 + gg - 2 * g * cosGamma;
  return (1 - gg) / (4 * Math.PI * Math.pow(Math.max(1e-4, denom), 1.5));
}

/** 천정 방향 Rayleigh 광학두께 (채널별) */
function tauRayleighRGB(elevScale: number): [number, number, number] {
  return LAMBDA_RGB.map(
    l => TAU_R_550 * Math.pow(550 / l, TAU_R_EXP) * elevScale
  ) as [number, number, number];
}

/** 천정 방향 Mie 광학두께 (채널별) */
function tauMieRGB(beta: number, angstrom: number, elevScale: number): [number, number, number] {
  return LAMBDA_RGB.map(
    l => beta * Math.pow(550 / l, angstrom) * elevScale
  ) as [number, number, number];
}

/** 오존층(약 22km) 통과 경로 배율 */
function ozoneAirMass(altDeg: number): number {
  const altRad = (altDeg * Math.PI) / 180;
  const rOzone = 22.0 / 6371;
  return (1 + rOzone) / Math.sqrt(Math.max(0.001, Math.sin(altRad) ** 2 + 2 * rOzone));
}

/**
 * 임의의 시선 방향에 대한 하늘 복사휘도 (linear RGB).
 *
 * @param viewElevDeg 시선 고도각 (지평선 0, 천정 90)
 * @param gammaDeg    시선과 태양 사이 각거리
 * @param sunAltDeg   태양 고도
 */
export function skyRadiance(
  viewElevDeg: number,
  gammaDeg: number,
  sunAltDeg: number,
  p: AtmosphereParams
): RGB {
  const cosGamma = Math.cos((gammaDeg * Math.PI) / 180);

  // 시선 방향 대기 두께 — 지평선으로 갈수록 급증(공기가 두꺼워짐)
  const mView = airMass(Math.max(viewElevDeg, -0.8));
  // 태양광이 산란 지점까지 오는 경로의 두께.
  // 지평선 아래에서는 상층 대기가 조명되므로 색은 하한에서 고정합니다.
  const sunAltForT = Math.max(sunAltDeg, TRANSMITTANCE_MIN_SUN_ALT);
  // 시선 고도가 높을수록 산란점이 높아 → 햇빛이 통과하는 대기가 얇아집니다.
  const t = clamp01(viewElevDeg / 70);
  const smooth = t * t * (3 - 2 * t);
  const hFrac = SCATTER_HEIGHT_HORIZON + (SCATTER_HEIGHT_ZENITH - SCATTER_HEIGHT_HORIZON) * smooth;
  const mSun = airMass(sunAltForT) * Math.exp(-hFrac);
  // 다중산란은 하늘 전역에서 오므로 훨씬 약하게 감쇠시킵니다.
  const mSunMS = Math.min(mSun, Math.max(MS_AIRMASS_CAP, mSun * MS_AIRMASS_FRACTION));

  const tR = tauRayleighRGB(p.elevScale);
  const tM = tauMieRGB(p.betaMie, p.angstrom, p.elevScale);
  const ozAM = ozoneAirMass(Math.max(sunAltForT, 0.5));
  const ozScale = p.ozoneDU / 300;

  const pR = rayleighPhase(cosGamma) * RAYLEIGH_GAIN;
  const pM = hgPhase(cosGamma, MIE_G) * MIE_GAIN;

  // 태양이 지평선 아래로 내려가면 하층 대기가 지구 그림자에 들어갑니다.
  const twilight = clamp01((sunAltDeg - TWILIGHT_END_DEG) / (0 - TWILIGHT_END_DEG));
  const sunLit = sunAltDeg >= 0 ? 1 : Math.pow(twilight, 2.2);

  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const tauZenith = tR[c] + tM[c];
    const ozone = OZONE_TAU[c] * ozScale * ozAM;

    // 산란 지점에 도달하는 햇빛의 투과율 (단일산란용 — 실제 경로)
    const tSun = Math.exp(-tauZenith * mSun - ozone);
    // 다중산란용 — 하늘 전역에서 오는 빛이라 훨씬 덜 감쇠
    const tSunMS = Math.exp(-tauZenith * mSunMS - ozone);

    // 시선 경로의 총 광학두께
    const tauView = tauZenith * mView;
    const scatterFrac = 1 - Math.exp(-tauView); // 포화형 — 두꺼워도 발산하지 않음

    // Rayleigh / Mie 산란 기여 비율
    const rW = (tR[c] * mView) / Math.max(1e-6, tauView);
    const mW = 1 - rW;

    // 단일산란 — 태양 방향의 붉은 노을을 만듭니다.
    const single = tSun * (pR * rW + pM * mW) * scatterFrac;
    // 다중산란 — 등방적. 천정의 파랑과 지평선 airlight를 유지시킵니다.
    const multi = tSunMS * scatterFrac * MULTI_SCATTER_GAIN * (1 / (4 * Math.PI));

    out.push((single + multi) * SKY_EXPOSURE * sunLit);
  }

  return {
    r: Math.max(NIGHT_SKY.r, out[0]),
    g: Math.max(NIGHT_SKY.g, out[1]),
    b: Math.max(NIGHT_SKY.b, out[2]),
  };
}

// ── 3) 태양 ────────────────────────────────────────────────────────────────

/**
 * 현재 대기 상태에서 본 태양 원반의 색 (linear RGB).
 * 하늘과 완전히 같은 β·Ångström을 쓰므로 노을이 붉어질 때 하늘도 함께 변합니다.
 */
export function sunDiskColor(sunAltDeg: number, p: AtmosphereParams): RGB {
  return directBeamRGB(sunAltDeg, p.observerElevM, p.latitude, p.betaMie, p.dayOfYear);
}

/**
 * 구름 고도에서 본 직달광. 구름은 관측자보다 위에 있으므로 대기를 덜 통과합니다.
 * (그래서 해가 진 뒤에도 높은 구름만 붉게 타오릅니다.)
 */
export function beamAtAltitude(
  sunAltDeg: number,
  cloudAltKm: number,
  p: AtmosphereParams
): RGB {
  const dip = (Math.acos(6371 / (6371 + Math.max(0, cloudAltKm))) * 180) / Math.PI;
  return directBeamRGB(
    sunAltDeg + dip,
    p.observerElevM + cloudAltKm * 1000,
    p.latitude,
    p.betaMie,
    p.dayOfYear
  );
}

// ── 4) 구름 ────────────────────────────────────────────────────────────────

/** 구름 종류별 기하학적 두께 (km) → 광학두께 환산에 사용 */
export const CLOUD_GEOMETRIC_THICKNESS_KM: Record<string, number> = {
  Cirrus: 0.4,
  Cirrocumulus: 0.4,
  Cirrostratus: 0.6,
  Altocumulus: 0.8,
  Altostratus: 1.4,
  Nimbostratus: 3.5,
  Stratocumulus: 1.0,
  Stratus: 0.6,
  Cumulus: 1.6,
  Cumulonimbus: 8.0,
};

/**
 * 구름 광학두께 τ.
 * 물방울 구름의 소산계수는 대략 20~60 km⁻¹ 범위이고, 얼음 결정(권운)은 훨씬 작습니다.
 */
export function cloudOpticalDepth(
  presetName: string,
  density01: number,
  isIce: boolean
): number {
  const thickness = CLOUD_GEOMETRIC_THICKNESS_KM[presetName] ?? 1.0;
  // 얼음운은 입자 밀도가 낮아 광학두께가 한 자릿수에 머무릅니다.
  const extinctionPerKm = isIce ? 1.6 : 26.0;
  return Math.max(0.05, thickness * extinctionPerKm * clamp01(density01));
}

export interface CloudShadingResult {
  /** 태양을 향한 면 */
  lit: RGB;
  /** 그늘진 면 */
  shadow: RGB;
  /** 2-stream 확산 반사율 (윗면이 얼마나 흰가) */
  diffuseReflectance: number;
  /** 확산 투과율 (아래에서 볼 때 얼마나 빛이 새어나오는가) */
  diffuseTransmittance: number;
}

/**
 * 구름 색을 광학두께로부터 계산합니다.
 *
 * 물리 근거
 *  - 가시광에서 물방울은 거의 흡수하지 않습니다(단일산란 알베도 ≈ 0.9999).
 *    즉 구름이 회색으로 보이는 건 "빛을 먹어서"가 아니라 **빛이 그 지점까지
 *    도달하지 못해서**입니다. 그래서 얇은 구름은 희고, 두꺼운 구름은 윗면만
 *    희고 아랫면이 어두워집니다.
 *  - 2-stream 근사(보존 산란): 유효 광학두께 τ' = τ(1-g)에 대해
 *      반사율 R = τ' / (τ' + 2),  투과율 T = 2 / (τ' + 2)
 *    τ가 커질수록 R→1(흰 윗면), T→0(어두운 아랫면)로 자연히 갈라집니다.
 *  - 직달 투과 exp(-τ)는 얇은 구름이 역광에서 빛나는 실버라이닝을 만듭니다.
 *
 * @param tau       구름 광학두께
 * @param cosView   시선과 태양 방향의 코사인 (역광이면 +1에 가까움)
 * @param beam      구름 고도에서의 직달광 색
 * @param ambient   구름 주변 하늘색
 */
export function cloudShading(
  tau: number,
  cosView: number,
  beam: RGB,
  ambient: RGB
): CloudShadingResult {
  const tauEff = tau * (1 - CLOUD_G);
  const R = tauEff / (tauEff + 2);
  const T = 2 / (tauEff + 2);

  // 직달 투과 — 얇을수록 강하게 남습니다.
  const direct = Math.exp(-tau);
  // 전방 산란 피크 (실버라이닝)
  const forward = hgPhase(cosView, CLOUD_G) * 4 * Math.PI; // 정규화하여 1 부근이 등방
  const silver = direct * clamp01(forward * 0.25);

  const lit: RGB = {
    r: beam.r * (R + silver) + ambient.r * (1 - R) * 0.55,
    g: beam.g * (R + silver) + ambient.g * (1 - R) * 0.55,
    b: beam.b * (R + silver) + ambient.b * (1 - R) * 0.55,
  };

  // 그늘면: 구름 내부를 통과해 확산된 빛 + 주변 하늘의 재조명
  const shadow: RGB = {
    r: beam.r * T * 0.35 + ambient.r * (0.30 + T * 0.45),
    g: beam.g * T * 0.35 + ambient.g * (0.30 + T * 0.45),
    b: beam.b * T * 0.35 + ambient.b * (0.30 + T * 0.45),
  };

  return { lit, shadow, diffuseReflectance: R, diffuseTransmittance: T };
}

// ── 5) GLSL — 위 TS 구현과 같은 상수를 주입해 생성 ─────────────────────────

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * 하늘/구름 셰이더가 공유하는 GLSL 함수 모음.
 * 상수는 위 TS 정의에서 주입되므로 두 구현이 갈라지지 않습니다.
 */
export const ATMOSPHERE_GLSL = `
const vec3  LAMBDA      = vec3(${f(LAMBDA_RGB[0])}, ${f(LAMBDA_RGB[1])}, ${f(LAMBDA_RGB[2])});
const float TAU_R_550   = ${f(TAU_R_550)};
const float TAU_R_EXP   = ${f(TAU_R_EXP)};
const vec3  OZONE_TAU   = vec3(${f(OZONE_TAU[0])}, ${f(OZONE_TAU[1])}, ${f(OZONE_TAU[2])});
const float MIE_G       = ${f(MIE_G)};
const float CLOUD_G     = ${f(CLOUD_G)};
const float RAY_GAIN    = ${f(RAYLEIGH_GAIN)};
const float MIE_GAIN    = ${f(MIE_GAIN)};
const float MS_GAIN     = ${f(MULTI_SCATTER_GAIN)};
const float SKY_EXPOSURE= ${f(SKY_EXPOSURE)};
const float TWILIGHT_END= ${f(TWILIGHT_END_DEG)};
const vec3  NIGHT_SKY   = vec3(${f(NIGHT_SKY.r)}, ${f(NIGHT_SKY.g)}, ${f(NIGHT_SKY.b)});
const float MS_AM_CAP   = ${f(MS_AIRMASS_CAP)};
const float MS_AM_FRAC  = ${f(MS_AIRMASS_FRACTION)};
const float SH_HORIZON  = ${f(SCATTER_HEIGHT_HORIZON)};
const float SH_ZENITH   = ${f(SCATTER_HEIGHT_ZENITH)};
const float T_MIN_SUNALT= ${f(TRANSMITTANCE_MIN_SUN_ALT)};
const float PI_         = 3.14159265359;

// Kasten-Young 대기 질량 — 지평선으로 갈수록 대기가 두꺼워지는 정도
float atm_airMass(float altDeg) {
  float h = max(altDeg, -1.5);
  if (h >= 89.0) return 1.0;
  return 1.0 / (sin(radians(h)) + 0.50572 * pow(6.07995 + h, -1.6364));
}

float atm_rayleighPhase(float cosG) {
  return (3.0 / (16.0 * PI_)) * (1.0 + cosG * cosG);
}

float atm_hgPhase(float cosG, float g) {
  float gg = g * g;
  float d = 1.0 + gg - 2.0 * g * cosG;
  return (1.0 - gg) / (4.0 * PI_ * pow(max(1e-4, d), 1.5));
}

vec3 atm_tauRayleigh(float elevScale) {
  return TAU_R_550 * pow(vec3(550.0) / LAMBDA, vec3(TAU_R_EXP)) * elevScale;
}

vec3 atm_tauMie(float beta, float angstrom, float elevScale) {
  return beta * pow(vec3(550.0) / LAMBDA, vec3(angstrom)) * elevScale;
}

float atm_ozoneAirMass(float altDeg) {
  float s = sin(radians(altDeg));
  float rO = 22.0 / 6371.0;
  return (1.0 + rO) / sqrt(max(0.001, s * s + 2.0 * rO));
}

/**
 * 시선 방향의 하늘 복사휘도.
 * viewElevDeg: 시선 고도, cosGamma: 시선·태양 코사인, sunAltDeg: 태양 고도
 */
vec3 atm_skyRadiance(
  float viewElevDeg, float cosGamma, float sunAltDeg,
  float beta, float angstrom, float elevScale, float ozoneDU
) {
  float mView = atm_airMass(max(viewElevDeg, -0.8));
  // 지평선 아래에서는 상층 대기가 조명되므로 색은 하한에서 고정
  float sunAltForT = max(sunAltDeg, T_MIN_SUNALT);
  // 시선 고도가 높을수록 산란점이 높아 → 햇빛이 통과하는 대기가 얇아짐 (박명 아치)
  float hFrac = mix(SH_HORIZON, SH_ZENITH, smoothstep(0.0, 70.0, viewElevDeg));
  float mSun   = atm_airMass(sunAltForT) * exp(-hFrac);
  float mSunMS = min(mSun, max(MS_AM_CAP, mSun * MS_AM_FRAC));

  vec3 tR = atm_tauRayleigh(elevScale);
  vec3 tM = atm_tauMie(beta, angstrom, elevScale);
  float ozAM = atm_ozoneAirMass(max(sunAltForT, 0.5));
  float ozScale = ozoneDU / 300.0;

  float pR = atm_rayleighPhase(cosGamma) * RAY_GAIN;
  float pM = atm_hgPhase(cosGamma, MIE_G) * MIE_GAIN;

  // 태양이 지평선 아래면 하층 대기가 지구 그림자에 들어감
  float twilight = clamp((sunAltDeg - TWILIGHT_END) / (0.0 - TWILIGHT_END), 0.0, 1.0);
  float sunLit = sunAltDeg >= 0.0 ? 1.0 : pow(twilight, 2.2);

  vec3 tauZenith = tR + tM;
  vec3 ozone = OZONE_TAU * ozScale * ozAM;
  vec3 tSun   = exp(-tauZenith * mSun   - ozone);
  vec3 tSunMS = exp(-tauZenith * mSunMS - ozone);

  vec3 tauView = tauZenith * mView;
  vec3 scatterFrac = 1.0 - exp(-tauView);

  vec3 rW = (tR * mView) / max(vec3(1e-6), tauView);
  vec3 mW = 1.0 - rW;

  vec3 single = tSun   * (pR * rW + pM * mW) * scatterFrac;
  vec3 multi  = tSunMS * scatterFrac * MS_GAIN * (1.0 / (4.0 * PI_));

  vec3 col = (single + multi) * SKY_EXPOSURE * sunLit;
  return max(NIGHT_SKY, col);
}

/**
 * 구름 2-stream 반사/투과. 보존 산란이므로 색이 아니라 밝기만 갈립니다.
 * x = R(반사율), y = T(투과율)
 */
vec2 atm_cloudRT(float tau) {
  float tauEff = tau * (1.0 - CLOUD_G);
  return vec2(tauEff / (tauEff + 2.0), 2.0 / (tauEff + 2.0));
}

/** 얇은 구름의 역광 실버라이닝 */
float atm_cloudSilver(float tau, float cosView) {
  float direct = exp(-tau);
  float forward = atm_hgPhase(cosView, CLOUD_G) * 4.0 * PI_;
  return direct * clamp(forward * 0.25, 0.0, 1.0);
}

// linear → sRGB
vec3 atm_toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;
