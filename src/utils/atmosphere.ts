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
export const OZONE_TAU: [number, number, number] = [0.024, 0.034, 0.003];
/** Mie 위상함수 비대칭 인자 (에어로졸: 전방산란 우세) */
export const MIE_G = 0.80;
/** 구름 물방울 위상함수 비대칭 인자 (강한 전방산란) */
export const CLOUD_G = 0.85;

/** 산란 이득 — 물리량을 화면 밝기로 옮기는 노출 상수 (아트 디렉션 지점) */
export const RAYLEIGH_GAIN = 1.0;
export const MIE_GAIN = 1.0;
/** 다중산란(하늘 전체가 서로 빛을 주고받는 성분) 이득 */
export const MULTI_SCATTER_GAIN = 0.42;
/** 최종 노출 (물리 복사휘도 → 화면 밝기) */
export const SKY_EXPOSURE = 22.0;

/**
 * 디스플레이 변환 — "물리적으로 맞지만 안 예쁜" 문제를 푸는 부분입니다.
 *
 * 선형 복사휘도를 그냥 1-exp(-x)로 누르면 밝은 영역이 전부 흰색으로 뭉개져
 * 지평선이 날아가고 하늘 전체가 우윳빛이 됩니다. ACES 필름 커브는 하이라이트를
 * 훨씬 완만하게 굴려서 밝은 곳에도 색이 남습니다.
 *
 * 채도 보정은 톤매핑 **이후**에 겁니다. 톤 압축이 채도를 깎아내리므로
 * 그 뒤에 되살려야 합니다.
 */
export const DISPLAY_EXPOSURE = 0.62;

/**
 * 눈의 순응(adaptation).
 *
 * Why: 정오 하늘과 박명 하늘은 휘도가 200배 차이납니다. 절대 노출 하나로는
 * 정오를 맞추면 박명이 새까맣게 죽고, 박명을 맞추면 정오가 흰색으로 날아갑니다.
 * 실제로는 사람 눈이 어두워질수록 순응해 더 밝게 봅니다. 그래서 태양이 낮아질수록
 * 노출을 올립니다. 물리 복사휘도는 그대로 두고 표시 단계에서만 보정하므로
 * 상대적인 밝기 관계(지평선이 천정보다 밝다 등)는 유지됩니다.
 */
export const ADAPT_MAX = 16.0;
export const ADAPT_START_ALT = 6.0;
export const ADAPT_END_ALT = -14.0;
export const DISPLAY_SATURATION = 1.22;
/** 하단 대비 S커브 강도 — 어두운 쪽을 살짝 눌러 탁함을 걷어냅니다 */
export const DISPLAY_CONTRAST = 1.06;

/**
 * 박명 시 오존층 접선 통과 배율.
 *
 * Why: 태양이 지평선 아래면 햇빛이 오존층(약 22km)을 거의 접선 방향으로
 * 길게 통과합니다. Chappuis 대역이 주황~적색을 걷어내기 때문에 살아남는 빛이
 * 푸르게 되고, 이것이 박명 상공이 짙은 파랑으로 남는 이유입니다.
 * 기하 공식만으로는 이 경로 증가가 표현되지 않아 별도 항을 둡니다.
 */
export const OZONE_TWILIGHT_GAIN = 0.55;
export const OZONE_TWILIGHT_MAX = 3.2;

/**
 * 지평선 아래 감광.
 *
 * Why: 스카이돔은 구 전체라 지평선 아래에도 하늘색이 칠해집니다. 그대로 두면
 * 화면 하단이 형광색 단색 벽이 되어 가장 먼저 눈에 거슬립니다. 실제로 그 방향을
 * 보면 하늘이 아니라 지면과 지면 부근 연무를 보게 되므로, 더 어둡고 채도가
 * 낮은 색으로 부드럽게 깔아줍니다. (지형 링이 덮지 못하는 틈도 이걸로 메워집니다)
 */
export const GROUND_DARKEN: RGB = { r: 0.20, g: 0.185, b: 0.175 };
export const GROUND_FADE_DEG = 5.5;

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

/**
 * 오존층(약 22km) 통과 경로 배율.
 * 지평선 아래에서는 접선 통과로 경로가 크게 늘어납니다(박명 파랑의 원인).
 */
function ozoneAirMass(altDeg: number, trueSunAltDeg: number = altDeg): number {
  const altRad = (altDeg * Math.PI) / 180;
  const rOzone = 22.0 / 6371;
  const base = (1 + rOzone) / Math.sqrt(Math.max(0.001, Math.sin(altRad) ** 2 + 2 * rOzone));
  const twilight = trueSunAltDeg < 0
    ? 1 + Math.min(OZONE_TWILIGHT_MAX, -trueSunAltDeg * OZONE_TWILIGHT_GAIN)
    : 1;
  return base * twilight;
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
  const ozAM = ozoneAirMass(Math.max(sunAltForT, 0.5), sunAltDeg);
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

  // 지평선 아래로 갈수록 지면 쪽이므로 어둡게 깔아줍니다.
  const belowT = clamp01(-viewElevDeg / GROUND_FADE_DEG);
  const below = belowT * belowT * (3 - 2 * belowT);
  const gr = 1 + (GROUND_DARKEN.r - 1) * below;
  const gg = 1 + (GROUND_DARKEN.g - 1) * below;
  const gb = 1 + (GROUND_DARKEN.b - 1) * below;

  return {
    r: Math.max(NIGHT_SKY.r, out[0] * gr),
    g: Math.max(NIGHT_SKY.g, out[1] * gg),
    b: Math.max(NIGHT_SKY.b, out[2] * gb),
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

/** 대기 척도고도 (km) — 수평 경로의 공기 밀도 감소에 사용 */
export const SCALE_HEIGHT_KM = 8.4;

/**
 * 원경 대기 투시(aerial perspective) 세기. 1.0 = 물리 그대로.
 * 관측자와 구름 사이의 대기가 구름을 흐리게 하고 하늘색을 덧씌웁니다.
 * 200km 밖 구름이 지평선 연무에 잠겨 실루엣만 남는 현상이 여기서 나옵니다.
 */
export const AERIAL_STRENGTH = 1.0;

/**
 * 황혼 자색광 합성 가중치 (docs/CLOUD_PHYSICS.md §5).
 * 그늘진 구름이 검게 죽지 않고, 지평선 붉은빛(R,G)과 천공 푸른빛(B)을 함께 받아
 * 황혼 특유의 자주색을 띠게 하는 채널별 가중치입니다.
 */
export const TWILIGHT_PURPLE_WEIGHTS: [number, number, number] = [0.28, 0.15, 0.45];

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

/**
 * 구름 도감(CloudPreset)의 scattering 값에서 광학두께를 역산합니다.
 *
 * Why: 도감에는 종류별 "투과율"이 적혀 있고(예: 권운 95%), 사용자에게도 그렇게
 * 보여줍니다. 2-stream 투과율 T = 2/(τ(1-g)+2)를 τ에 대해 풀면, 도감에 적힌
 * 그 숫자가 화면에서 실제로 성립합니다. 즉 도감과 렌더가 어긋나지 않습니다.
 *
 * docs/CLOUD_PHYSICS.md의 τ 공식과도 정합합니다. 문서는 τ에 k=0.25를 곱해
 * 쓰는데, 여기서는 (1-g)=0.15가 같은 역할을 하므로 유효 광학두께가 비슷합니다.
 *
 * @param scattering 도감의 투과율 (0~1)
 * @param cover      구름량 (0~1) — 부분적으로 낀 구름은 더 얇게
 */
export function cloudOpticalDepthFromDb(scattering: number, cover: number): number {
  const s = Math.max(0.02, Math.min(0.98, scattering));
  const tauEff = 2 / s - 2;              // 2-stream 역산
  const tau = tauEff / (1 - CLOUD_G);
  // 구름량이 적으면 광학적으로도 얇아집니다.
  return Math.max(0.03, tau * (0.25 + 0.75 * clamp01(cover)));
}

/** 태양 상수 (W/m²) */
export const SOLAR_CONSTANT = 1361;

/**
 * 맑은 하늘 직달일사(DNI) 근사 — Meinel & Meinel (1976).
 *
 *   DNI_clear = S0 · 0.7^(AM^0.678)
 *
 * 간단하지만 실측과 10% 내로 맞고, 무엇보다 **절대값**을 줍니다.
 * 이게 있어야 API가 주는 DNI를 "구름이 얼마나 가렸나"로 번역할 수 있습니다.
 */
export function clearSkyDNI(sunAltDeg: number): number {
  if (sunAltDeg <= 0.5) return 0;
  const am = airMass(sunAltDeg);
  return SOLAR_CONSTANT * Math.pow(0.7, Math.pow(am, 0.678));
}

/** DNI 측정이 의미를 갖는 최대 경사 광학두께. 이 위는 직달광이 0으로 죽습니다. */
export const DNI_TAU_CEILING = 6.5;

export interface DniTauResult {
  /** 역산한 연직 광학두께 */
  tauVert: number;
  /**
   * 측정 한계에 닿았는가.
   *
   * `true`면 "τ가 최소 이만큼은 된다"는 **하한**일 뿐 정확한 값이 아닙니다.
   * 이때는 도감 τ를 그대로 쓰고, `false`일 때만 관측을 신뢰해 값을 끌어옵니다.
   */
  saturated: boolean;
}

/**
 * 관측된 DNI에서 **구름 기둥의 광학두께**를 역산합니다.
 *
 *   T_beam  = DNI / DNI_clear        (구름을 통과한 직달 투과율)
 *   τ_slant = −ln(T_beam)            (경사 경로 광학두께)
 *   τ_vert  = τ_slant · sin(고도각)   (연직 환산)
 *
 * **분해능 한계를 반드시 이해하고 쓰십시오.** 직달광은 Beer-Lambert로 죽으므로
 * τ가 조금만 커져도 DNI가 0에 붙습니다. 태양 45°에서:
 *
 *   τ=3(권운)   → 직달 1.4e-2      ← 측정 가능
 *   τ=30(고층운) → 직달 3.8e-19     ← 이미 0
 *   τ=110(난층운)→ 직달 2.8e-68     ← 완전히 0
 *
 * 즉 DNI는 τ ≲ 5까지만 분해합니다. 그 위는 전부 "0"으로 같아 보입니다.
 * 따라서 DNI의 쓸모는 **"예보는 흐림인데 실제로는 해가 비친다"** 를 잡아내는
 * 것이지, 두꺼운 구름의 두께를 재는 것이 아닙니다.
 */
export function cloudTauFromDNI(
  observedDNI: number | undefined,
  sunAltDeg: number
): DniTauResult | null {
  if (observedDNI == null || !isFinite(observedDNI)) return null;
  // 태양이 낮으면 DNI 자체가 작아 잡음이 지배합니다.
  if (sunAltDeg < 5) return null;

  const clear = clearSkyDNI(sunAltDeg);
  if (clear <= 1) return null;

  const ratio = Math.min(1, observedDNI / clear);
  const floor = Math.exp(-DNI_TAU_CEILING);
  const saturated = ratio <= floor;

  const T = Math.max(floor, ratio);
  if (T >= 0.995) return { tauVert: 0, saturated: false }; // 완전한 맑음

  const tauSlant = -Math.log(T);
  const tauVert = tauSlant * Math.sin(Math.max(5, sunAltDeg) * (Math.PI / 180));
  return { tauVert: Math.max(0, tauVert), saturated };
}

/**
 * 관측자와 대상 사이 대기의 투과율 (원경 대기 투시).
 *
 * 수평 경로의 광학두께는 천정 광학두께를 척도고도로 나눈 지표 소산계수에
 * 경로 길이를 곱해 구합니다. 대상이 고고도면 경로 평균 밀도가 낮아지므로
 * 그만큼 보정합니다.
 */
export function aerialTransmittance(
  distanceKm: number,
  targetAltKm: number,
  p: AtmosphereParams
): RGB {
  const tR = tauRayleighRGB(p.elevScale);
  const tM = tauMieRGB(p.betaMie, p.angstrom, p.elevScale);

  // 경로가 상승하며 지나는 공기의 평균 밀도비
  const h = Math.max(0.01, targetAltKm);
  const avgDensity = (SCALE_HEIGHT_KM / h) * (1 - Math.exp(-h / SCALE_HEIGHT_KM));
  const pathScale = (distanceKm / SCALE_HEIGHT_KM) * avgDensity * AERIAL_STRENGTH;

  return {
    r: Math.exp(-(tR[0] + tM[0]) * pathScale),
    g: Math.exp(-(tR[1] + tM[1]) * pathScale),
    b: Math.exp(-(tR[2] + tM[2]) * pathScale),
  };
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
  ambient: RGB,
  opts: {
    /** 도감의 그림자 대비 (0~1) — 클수록 그늘면이 깊게 어두워짐 */
    shadowContrast?: number;
    /** 지평선 노을빛 — 황혼 자색광 합성용 */
    horizonGlow?: RGB;
    /** 천공 푸른빛 — 황혼 자색광 합성용 */
    zenithSky?: RGB;
  } = {}
): CloudShadingResult {
  const { shadowContrast = 0.5, horizonGlow, zenithSky } = opts;

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

  // 그늘면 기저: 구름 내부를 통과해 확산된 빛 + 주변 하늘의 재조명.
  // 도감의 shadowContrast가 클수록 더 깊게 어두워집니다.
  const ambientKeep = 0.30 + T * 0.45;
  const depth = 1 - shadowContrast * 0.55;
  let shadow: RGB = {
    r: (beam.r * T * 0.35 + ambient.r * ambientKeep) * depth,
    g: (beam.g * T * 0.35 + ambient.g * ambientKeep) * depth,
    b: (beam.b * T * 0.35 + ambient.b * ambientKeep) * depth,
  };

  // ── 황혼 자색광 합성 (docs/CLOUD_PHYSICS.md §5) ──────────────────────────
  // 그늘진 구름은 검게 죽지 않습니다. 빛이 통과하지 못할수록(=차폐도가 클수록)
  // 대신 두 환경광을 받습니다: 지평선의 붉은 노을빛과 머리 위 천공의 푸른빛.
  // 이 상반된 두 파장이 구름 안에서 섞이며 황혼 특유의 자주색이 나옵니다.
  if (horizonGlow && zenithSky) {
    const influence = clamp01(1 - T);
    const [wR, wG, wB] = TWILIGHT_PURPLE_WEIGHTS;
    shadow = {
      r: shadow.r + (horizonGlow.r * wR - shadow.r) * influence,
      g: shadow.g + (horizonGlow.g * wG - shadow.g) * influence,
      b: shadow.b + (zenithSky.b * wB - shadow.b) * influence,
    };
  }

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
const vec3  TWILIGHT_W  = vec3(${f(TWILIGHT_PURPLE_WEIGHTS[0])}, ${f(TWILIGHT_PURPLE_WEIGHTS[1])}, ${f(TWILIGHT_PURPLE_WEIGHTS[2])});
const float SCALE_H_KM  = ${f(SCALE_HEIGHT_KM)};
const float AERIAL_STR  = ${f(AERIAL_STRENGTH)};
const float OZ_TW_GAIN  = ${f(OZONE_TWILIGHT_GAIN)};
const float OZ_TW_MAX   = ${f(OZONE_TWILIGHT_MAX)};
const float DISP_EXPO   = ${f(DISPLAY_EXPOSURE)};
const float ADAPT_MAX   = ${f(ADAPT_MAX)};
const float ADAPT_HI    = ${f(ADAPT_START_ALT)};
const float ADAPT_LO    = ${f(ADAPT_END_ALT)};
const float DISP_SAT    = ${f(DISPLAY_SATURATION)};
const float DISP_CONTR  = ${f(DISPLAY_CONTRAST)};
const vec3  GROUND_DARK = vec3(${f(GROUND_DARKEN.r)}, ${f(GROUND_DARKEN.g)}, ${f(GROUND_DARKEN.b)});
const float GROUND_FADE = ${f(GROUND_FADE_DEG)};
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

float atm_ozoneAirMass(float altDeg, float trueSunAlt) {
  float s = sin(radians(altDeg));
  float rO = 22.0 / 6371.0;
  float base = (1.0 + rO) / sqrt(max(0.001, s * s + 2.0 * rO));
  // 박명에는 오존층을 접선 방향으로 길게 통과 → 주황이 걷히고 파랑이 남음
  float tw = trueSunAlt < 0.0 ? 1.0 + min(OZ_TW_MAX, -trueSunAlt * OZ_TW_GAIN) : 1.0;
  return base * tw;
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
  float ozAM = atm_ozoneAirMass(max(sunAltForT, 0.5), sunAltDeg);
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

  // 지평선 아래는 지면 쪽 — 어둡고 채도 낮게 깔아 형광 벽이 되지 않게 합니다.
  float below = smoothstep(0.0, -GROUND_FADE, viewElevDeg);
  col *= mix(vec3(1.0), GROUND_DARK, below);

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

/**
 * 그늘진 구름의 황혼 자색광 합성 (docs/CLOUD_PHYSICS.md §5).
 * 차폐도가 클수록 지평선 붉은빛(R,G)과 천공 푸른빛(B)을 받아 자주색을 띱니다.
 */
vec3 atm_twilightPurple(vec3 shadowBase, vec3 horizonGlow, vec3 zenithSky, float T, float sunAltDeg) {
  // **황혼에만** 작동해야 합니다.
  //
  // 이 항은 해가 진 뒤 그늘진 구름이 검게 죽지 않고 지평선 붉은빛과 천공
  // 푸른빛을 함께 받아 자주색을 띠는 현상을 만듭니다. 그런데 고도 게이트가
  // 없으면 한낮에도 걸립니다. 태양 45°에서 horizonGlow는 (25.2, 19.1, 12.3) —
  // 태양 옆 5°의 눈부신 연무라 target이 (7.05, 2.86, 0.18), R/B = 38이 됩니다.
  // 그 색이 그늘 면의 72%를 덮어써서 한낮 구름이 노랗게 탔습니다.
  float twilight = 1.0 - smoothstep(-2.0, 8.0, sunAltDeg);
  float influence = clamp(1.0 - T, 0.0, 1.0) * twilight;
  if (influence <= 0.0) return shadowBase;
  vec3 target = vec3(horizonGlow.r, horizonGlow.g, zenithSky.b) * TWILIGHT_W;
  return mix(shadowBase, target, influence);
}

/**
 * 원경 대기 투시 — 관측자와 구름 사이 대기의 투과율.
 * 멀리 있는 구름일수록 하늘색에 잠겨 실루엣만 남습니다.
 */
vec3 atm_aerialTransmittance(
  float distanceKm, float targetAltKm,
  float beta, float angstrom, float elevScale
) {
  vec3 tau = atm_tauRayleigh(elevScale) + atm_tauMie(beta, angstrom, elevScale);
  float h = max(0.01, targetAltKm);
  float avgDensity = (SCALE_H_KM / h) * (1.0 - exp(-h / SCALE_H_KM));
  float pathScale = (distanceKm / SCALE_H_KM) * avgDensity * AERIAL_STR;
  return exp(-tau * pathScale);
}

// linear → sRGB
vec3 atm_toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

/**
 * ACES 필름 톤매핑 (Narkowicz 2015 근사).
 * 1-exp(-x) 대비 하이라이트 롤오프가 완만해 밝은 하늘에도 색이 남습니다.
 */
vec3 atm_tonemapACES(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

/** 태양이 낮아질수록 노출을 올립니다 (눈의 순응) */
float atm_adaptation(float sunAltDeg) {
  return 1.0 + (ADAPT_MAX - 1.0) * smoothstep(ADAPT_HI, ADAPT_LO, sunAltDeg);
}

/**
 * 물리 복사휘도 → 화면 색. 순응 노출 → ACES → 채도 복원 → 대비 순서입니다.
 * 채도를 톤매핑 뒤에 거는 것이 핵심입니다(압축으로 깎인 색을 되살림).
 */
vec3 atm_display(vec3 radiance, float saturation, float sunAltDeg) {
  vec3 c = atm_tonemapACES(radiance * DISP_EXPO * atm_adaptation(sunAltDeg));
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, DISP_SAT * saturation);
  c = clamp((c - 0.5) * DISP_CONTR + 0.5, 0.0, 1.0);
  return atm_toSrgb(c);
}
`;
