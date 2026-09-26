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
import { directBeamRGB, aerosolBeta, airMass, clamp01, getApparentAltitude, type RGB } from './sunsetPhysics';
import { EARTH_RADIUS_KM } from './earth';
import { EARTH_RADIUS_KM_GLSL } from './earth';
import { getTuning } from './skyTuning';

// ── 물리 상수 (TS·GLSL 공용) ───────────────────────────────────────────────
/** 대표 파장 (nm) — sunsetPhysics와 동일 */
export const LAMBDA_RGB: [number, number, number] = [650, 550, 450];
/** 해수면 천정 방향 550nm Rayleigh 광학두께 */
export const TAU_R_550 = 0.0972;
/** Rayleigh 파장 지수 (이론값 4, 실측 보정 4.05) */
export const TAU_R_EXP = 4.05;
/**
 * 오존 Chappuis 흡수 계수 (R/G/B, 300DU 연직 기준).
 *
 * **밴드 적분값입니다. 단일 파장 샘플이 아닙니다.**
 *
 * Why: 이전에는 LAMBDA_RGB(650/550/450nm)에서 σ를 한 점씩 읽어
 * [0.024, 0.034, 0.003]을 썼습니다. 그런데 Chappuis 대역의 정점은 **602nm** —
 * sRGB 적색 채널 한가운데입니다. 650nm는 정점에서 이미 40% 내려온 자락이라,
 * 한 점 샘플링은 적색 흡수를 절반 가까이 과소평가합니다.
 *
 * 그 결과가 τ_R(0.024) < τ_G(0.034) 이었고, 박명에 오존 경로가 20~40배로
 * 늘어나면 **녹색만 깎이고 적·청이 남아 하늘이 자홍색**이 됐습니다.
 * 실제 박명 하늘은 파랗습니다 — 오존이 녹색만이 아니라 500~700nm **전체**를
 * 걷어내고 청색만 남기기 때문입니다.
 *
 * 여기 값은 σ(λ)를 CIE 등색함수(Wyman et al. 2013 해석 근사) × D65 × sRGB
 * 변환에 걸어 적분한 **채널 유효 τ**입니다. slant 배수 1~50에서 거의 일정합니다
 * (τ_R 0.041→0.047, τ_G 0.0237→0.0231). 박명 대표 배수 20에서의 값을 씁니다.
 * 유도 스크립트는 `tools/shader-preview/derive-ozone-tau.js`, 배경은
 * docs/TWILIGHT.md §5.
 *
 * 청색만 예외입니다. 적분값은 0.0000 부근으로 나오는데, 그 대역에서는
 * XYZ→sRGB 변환의 음의 로브가 결과를 지배해 신뢰할 수 없습니다. 청색은
 * 흡수가 원래 미미하므로 단일파장(450nm, σ≈0.17e-21) 값을 그대로 씁니다.
 */
export const OZONE_TAU: [number, number, number] = [0.043, 0.0233, 0.0014];
/** Mie 위상함수 비대칭 인자 (에어로졸: 전방산란 우세) */
export const MIE_G = 0.80;
/** 구름 물방울 위상함수 비대칭 인자 (강한 전방산란) */
export const CLOUD_G = 0.85;

/** 산란 이득 — 물리량을 화면 밝기로 옮기는 노출 상수 (아트 디렉션 지점) */
export const RAYLEIGH_GAIN = 1.0;
export const MIE_GAIN = 1.0;
/** 최종 노출 (물리 복사휘도 → 화면 밝기) */
export const SKY_EXPOSURE = 22.0;

// 표시 노출·채도·대비·눈 순응은 **skyTuning.ts 가 유일한 출처**입니다.
//
// 여기에 `DISPLAY_SATURATION` 이 있었는데 아무도 import 하지 않는 죽은
// 상수였습니다. 나중에 훑어 보니 **같은 부류가 넷 더** 있었습니다 —
// `DISPLAY_EXPOSURE`(0.62) · `ADAPT_MAX`(16.0) · `ADAPT_START_ALT`(6.0) ·
// `ADAPT_END_ALT`(-14.0). 값이 그때는 DEFAULT_TUNING 과 정확히 같았지만
// **아무것도 둘을 묶어 두지 않았습니다.** 실제로 화면에 나가는 값은 GLSL
// uniform(`DISP_EXPO`·`ADAPT_MAX`·`ADAPT_HI`·`ADAPT_LO`)이고 그 값은
// `t.displayExposure` 등에서 옵니다.
//
// ⚠ `ADAPT_MAX` 는 **쓰이는 것처럼 보였습니다** — GLSL 원문에 같은 이름의
//   uniform 이 있어 이름 검색에 걸렸기 때문입니다. 조율 화면에서 값을 바꿔도
//   TS 상수는 그대로이니, 둘이 다르다는 것을 알아차릴 방법이 없었습니다.
//   전부 지웠습니다.

// 같은 값을 두 곳에 적어 두지 않습니다.

/**
 * 박명 시 오존층 접선 통과 배율.
 *
 * Why: 태양이 지평선 아래면 햇빛이 오존층(약 22km)을 거의 접선 방향으로
 * 길게 통과합니다. Chappuis 대역이 주황~적색을 걷어내기 때문에 살아남는 빛이
 * 푸르게 되고, 이것이 박명 상공이 짙은 파랑으로 남는 이유입니다.
 * 기하 공식만으로는 이 경로 증가가 표현되지 않아 별도 항을 둡니다.
 *
 * 값이 0.55 → 0.30으로 내려온 이유: 예전 배율은 **틀린 τ에 맞춰** 튜닝된
 * 값이었습니다. τ_R을 밴드 적분값으로 고치자 같은 경로 길이가 적색을 3배 더
 * 먹어 태양 -4°에서 R 채널이 0으로 눌렸습니다. 경로 자체를 현실적인 범위
 * (태양 -4°에서 slant 배수 26 안팎)로 되돌립니다.
 */
/**
 * 박명 지평선(태양 방향)을 다중산란의 등방적 색 대신 얼마나 "잔광"(따뜻한
 * 색) 쪽으로 기울일지 (0~1). 실측·사진·docs/TWILIGHT.md 5-E/5-G 근거는
 * `skyRadiance`의 `twilightWarmMix` 주석 참고.
 */
export const TWILIGHT_WARM_MIX = 1.0;
export const OZONE_TWILIGHT_MAX = 2.4;

/**
 * 다중산란 성분에 박명 오존 경로를 얼마나 걸 것인가 (0~1).
 *
 * Why: MS_AIRMASS_FRACTION과 **같은 이유**입니다. 단일산란은 태양광이 산란점까지
 * 오는 실제 경로로 감쇠해야 하지만, 다중산란으로 들어오는 빛은 하늘 전역에서
 * 오고 그 상당 부분은 오존층(22km)보다 위에서 튕겨 온 빛이라 접선 경로를
 * 통째로 겪지 않습니다.
 *
 * 이 항이 없으면(=1.0) 태양 -8°에서 지평선 띠가 **초록**이 됩니다. 그 고도에서는
 * sunLit 0.008 : sunLitMS 0.225 로 다중산란이 거의 전부인데, 거기에 접선 오존
 * 경로를 그대로 걸면 적색만 남김없이 걷혀 녹색이 남기 때문입니다.
 * 실제 심박명의 서쪽 하늘은 탁한 주황~황토색입니다.
 */
export const MS_OZONE_TWILIGHT_FRACTION = 0.4;

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

/**
 * 투과율 계산에 쓸 태양 고도의 하한.
 *
 * Why: 태양이 지평선 아래로 가면 Kasten-Young 대기질량이 포화되어 투과율이
 * 0으로 떨어집니다. 하지만 박명은 **상층 대기가 아직 햇빛을 받아** 생기는
 * 현상이라 색은 남아 있어야 합니다. 색은 이 하한에서 고정하고, 밝기만
 * `earthShadowLit`으로 줄입니다.
 *
 * **왜 -1이 아니라 0인가** (일몰 직후 급격한 암전 수정):
 * Kasten-Young은 지표 관측자용 식이라 0° 부근에서 폭발합니다 —
 * 0° → 37.9, -1° → 55.8. 하한이 -1이면 이 구간이 살아 있어서
 * 지평선을 넘는 **1도 사이에 지평선 글로우가 5.1배** 떨어집니다.
 * 그 뒤로는 하한에 걸려 도당 0.7배로 완만해집니다. 절벽 다음 평지 —
 * 실제 박명(완만하게 시작해 점점 가팔라짐)과 정확히 반대 모양입니다.
 *
 * 애초에 해가 진 뒤의 하늘을 밝히는 빛은 지표 대기를 통과하지 않습니다.
 * 관측자보다 **위**로 들어와 고층을 스치는 경로라, 지표 대기질량 식을
 * 지평선 아래로 외삽하는 것 자체가 무의미합니다. 0에서 얼리는 것이 맞습니다.
 */
export const TRANSMITTANCE_MIN_SUN_ALT = 0.0;

/** 지구 반경 (km) — 지구 그림자 높이 계산용 */
const EARTH_RADIUS_KM_ATM = EARTH_RADIUS_KM;

/**
 * 태양이 지평선 아래 δ도일 때, 아직 햇빛이 닿는 **최저 고도** (km).
 *
 * 해가 지면 지구 그림자가 대기를 아래에서 위로 쓸고 올라갑니다.
 * 기하는 단순합니다 — 관측자 접선 방향으로 나아간 빛이 지구를 스치는 높이는
 * `R(sec δ − 1)` 입니다.
 *
 *   δ=1° → 0.97km,  δ=2° → 3.9km,  δ=4° → 15.5km,  δ=6° → 34.9km
 *
 * 6°(시민박명 끝)에서 이미 산란 대기 대부분을 지나갑니다. 관측과 맞습니다.
 */
export function earthShadowHeightKm(sunDepressionDeg: number): number {
  const d = (Math.max(0, sunDepressionDeg) * Math.PI) / 180;
  return EARTH_RADIUS_KM_ATM * (1 / Math.cos(d) - 1);
}

/**
 * 박명 조명의 **유효 척도고도** (km).
 *
 * 지표 척도고도(8.4km)가 아닙니다. 박명을 만드는 빛은 대기를 **접선으로**
 * 지나며 고층에서 산란되고, 다중산란이 그 빛을 아래로 퍼뜨립니다. 그래서
 * 유효 발광 고도가 지표 밀도 분포보다 높게 잡힙니다 (오존층 22km도 참여).
 *
 * 8.4km를 그대로 쓰면 너무 빨리 죽습니다 — 측정: 시민박명(-6°) 하늘이
 * 밤하늘 바닥의 2.1배까지 떨어져, 해 지고 20분 만에 한밤중이 됐습니다.
 * 13km는 0→-6° 감소폭을 실측 천정휘도 감소(약 40배)에 맞춘 값입니다.
 */
export const TWILIGHT_SCALE_HEIGHT_KM = 13.0;

/**
 * 아직 햇빛을 받고 있는 산란 대기의 비율 (0~1).
 *
 * 대기 밀도가 척도고도 H로 지수 감소하므로, 그림자가 높이 h까지 올라오면
 * 남은 산란 질량은 `exp(-h/H)` 입니다. 이 항 **하나가** 지평선 아래의
 * 어두워짐을 전부 담당합니다.
 *
 * 이전 구현은 `pow((alt+16)/16, 2.2)` 라는 임의 램프였는데, 고도에 선형인
 * 값을 거듭제곱한 것이라 물리적 근거가 없었고, 위 대기질량 절벽과 겹쳐
 * "쿵 떨어지고 나서 한참 안 어두워지는" 곡선을 만들었습니다.
 *
 *   δ=0° → 1.00,  δ=1° → 0.93,  δ=2° → 0.74,  δ=4° → 0.30,  δ=6° → 0.067
 *
 * **완만하게 시작해 점점 가팔라지는** 실제 박명의 모양입니다.
 */
export function earthShadowLit(sunAltDeg: number): number {
  if (sunAltDeg >= 0) return 1;
  if (sunAltDeg <= TWILIGHT_END_DEG) return 0;
  return Math.exp(-earthShadowHeightKm(-sunAltDeg) / getTuning().twilightScaleKm);
}

/**
 * 다중산란 성분의 유효 척도고도 (km).
 *
 * 단일산란보다 큽니다. 다중산란 빛은 내 머리 위 기둥이 아니라 **아직 햇빛을
 * 받고 있는 먼 상층 대기**에서 여러 번 튕겨 오기 때문에, 그림자가 내 위를
 * 덮어도 바로 사라지지 않습니다.
 *
 * 이 항이 없으면 박명이 -5° 근처에서 뚝 끊깁니다 — 렌더로 확인했습니다:
 * 화면 밝기가 -4°에서 23/255, -6°에서 2.7/255, -8°에서 0. 일몰 절벽을
 * 고치고 나서 **그 절벽을 5도 뒤로 옮긴 것**뿐이었습니다.
 *
 * **42는 "어느 고도에서도 기존보다 어두워지지 않는" 최소값입니다.**
 * 렌더한 화면 밝기를 수정 전과 나눈 값 (서쪽 지평선 띠):
 *
 *   H_MS   -1°    -2°    -4°    -6°    -8°
 *   22    2.15x  2.23x  2.37x  0.77x  0.02x  ← 늦은 박명이 기존보다 **어두워짐**
 *   30    2.17x  2.28x  2.69x  1.11x  0.48x
 *   34    2.18x  2.30x  2.79x  1.42x  0.65x
 *   42    2.20x  2.32x  2.95x  2.38x  0.94x  ← 선택. 회귀 없음
 *
 * 22가 실측 천정휘도(0°→-6° 약 40배 감소)에는 더 가깝습니다(20.9배 vs 10.8배).
 * 그런데 그 값을 쓰면 -6°/-8°가 **지금 배포된 앱보다 어두워집니다.**
 * 사용자가 재보지도 않을 측광비를 맞추려고 이미 나가 있는 화면을 퇴화시키는
 * 것은 잘못된 거래입니다. 일몰 절벽을 고치면서 늦은 박명을 건드리지 않는
 * 쪽을 택했습니다.
 *
 * **알려진 한계**: 그래서 늦은 박명의 **천정**이 실제보다 밝게 남습니다.
 * 근본 원인은 이 항이 스칼라라는 것입니다 — 실제로는 시선 방향마다 그림자에
 * 들어가는 시점이 다릅니다. 천정 기둥은 일찍 그늘에 들어가고, 태양 쪽
 * 지평선을 따라가는 경로는 훨씬 오래 빛을 받습니다. `sunLitMS`를 시선
 * 의존으로 만들면 두 관측을 동시에 만족시킬 수 있습니다. 기기 확인 후
 * 손대는 것이 맞다고 봅니다.
 */
export const TWILIGHT_MS_SCALE_HEIGHT_KM = 42.0;

/** 다중산란 성분에 적용할 지구 그림자 감쇠 — 단일산란보다 훨씬 완만합니다. */
export function earthShadowLitMS(sunAltDeg: number): number {
  if (sunAltDeg >= 0) return 1;
  if (sunAltDeg <= TWILIGHT_END_DEG) return 0;
  return Math.exp(-earthShadowHeightKm(-sunAltDeg) / getTuning().twilightMsScaleKm);
}

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

/** GLSL smoothstep과 같은 식 — TS/셰이더 게이트가 갈라지지 않게 */
function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
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
function ozoneAirMass(
  altDeg: number,
  trueSunAltDeg: number = altDeg
): { single: number; multi: number } {
  const altRad = (altDeg * Math.PI) / 180;
  const rOzone = 22.0 / EARTH_RADIUS_KM;
  const base = (1 + rOzone) / Math.sqrt(Math.max(0.001, Math.sin(altRad) ** 2 + 2 * rOzone));
  const twilight = trueSunAltDeg < 0
    ? 1 + Math.min(OZONE_TWILIGHT_MAX, -trueSunAltDeg * getTuning().ozoneTwilightGain)
    : 1;
  return {
    single: base * twilight,
    multi: base * (1 + (twilight - 1) * MS_OZONE_TWILIGHT_FRACTION),
  };
}

/**
 * 두 (방위, 고도) 방향 사이의 각거리 — `skyRadiance`의 `gammaDeg` 인자를
 * 만드는 데 씁니다.
 *
 * 구면 코사인 법칙입니다. 빌보드 조명(`cloudPlacement.ts`)이 이미 인라인으로
 * 같은 식을 쓰고 있었는데, 덱 조명(3단계)에도 같은 식이 필요해져 여기로
 * 올렸습니다 — 두 곳이 따로 구현하면 하늘색이 갈라집니다.
 */
export function angularSeparationDeg(
  az1Deg: number,
  elev1Deg: number,
  az2Deg: number,
  elev2Deg: number
): number {
  const azDiffRad = ((az2Deg - az1Deg + 540) % 360 - 180) * (Math.PI / 180);
  const e1 = (elev1Deg * Math.PI) / 180;
  const e2 = (elev2Deg * Math.PI) / 180;
  const cosGamma = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(azDiffRad);
  return (Math.acos(Math.max(-1, Math.min(1, cosGamma))) * 180) / Math.PI;
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
  p: AtmosphereParams,
  /**
   * 관측 지점의 고도 (km). 0이면 지상 — 스카이돔·지형이 쓰는 값입니다.
   *
   * **구름의 주변광에는 반드시 그 층의 고도를 넘겨야 합니다.** 10km 권운이
   * 보는 하늘은 지상에서 보는 하늘이 아닙니다. 두 가지가 다릅니다.
   *
   *  - **지평선이 내려앉습니다** (`acos(R/(R+h))`, 10km에서 3.2°). 그 구름에는
   *    해가 아직 떠 있는데 지상 하늘을 주면 이미 깊은 박명입니다.
   *  - **위쪽 공기가 얇습니다.** 산란할 질량이 줄어듭니다.
   *
   * 이걸 안 넘겨서 실제로 회귀가 났습니다: 박명 조명을 물리대로 파랗게
   * 고쳤더니, 상층 구름이 **지상의** 깊은 파란 하늘을 주변광으로 받아
   * "높은 층이 늦게까지 붉게 남는" 성질이 사라졌습니다 (붉은기 봉우리
   * 상층 -6° → -1°). 빔은 그대로 붉은데 주변광이 이긴 것입니다.
   */
  observerAltKm: number = 0
): RGB {
  const cosGamma = Math.cos((gammaDeg * Math.PI) / 180);

  // 고도가 있으면 그 지점에서 본 태양 고도로 바꿉니다 (지평선 내려앉음).
  const dipDeg = observerAltKm > 0
    ? (Math.acos(EARTH_RADIUS_KM_ATM / (EARTH_RADIUS_KM_ATM + observerAltKm)) * 180) / Math.PI
    : 0;
  const sunAltHere = sunAltDeg + dipDeg;
  // 그 고도 위에 남은 공기 기둥.
  const elevScaleHere = observerAltKm > 0
    ? p.elevScale * Math.exp(-observerAltKm / SCALE_HEIGHT_KM)
    : p.elevScale;

  // 시선 방향 대기 두께 — 지평선으로 갈수록 급증(공기가 두꺼워짐)
  const mView = airMass(Math.max(viewElevDeg, -0.8));
  // 태양광이 산란 지점까지 오는 경로의 두께.
  // 지평선 아래에서는 상층 대기가 조명되므로 색은 하한에서 고정합니다.
  const sunAltForT = Math.max(sunAltHere, TRANSMITTANCE_MIN_SUN_ALT);
  /**
   * 박명 조명이 지나는 **공기의 얇기**.
   *
   * 해가 지면 지구 그림자가 아래에서 위로 올라오고, 하늘을 밝히는 빛은
   * 그림자 위 — 즉 훨씬 **얇은 공기** — 를 지나 들어옵니다. 그런데 오존층은
   * 22km에 있어서 그 높이까지는 온전히 통과합니다.
   *
   * 이 비대칭이 **박명 하늘이 파란 이유**입니다. 공기(Rayleigh)는 청색을
   * 가장 많이 걷어내는데 그 공기가 얇아지고, 적색을 걷어내는 오존은 그대로
   * 남습니다. 그래서 조명 자체가 파래집니다.
   *
   * 예전에는 태양 경로 대기질량을 지평선 값에 얼려 두기만 했습니다
   * (`TRANSMITTANCE_MIN_SUN_ALT`). 그러면 조명이 언제까지나 지표를 스치는
   * 붉은 빛으로 남아, 박명 하늘이 파래지지 못하고 **올리브색**이 됩니다.
   *
   *   δ=2° → 0.63,  δ=4° → 0.16,  δ=6° → 0.016
   */
  const litAirFrac = sunAltHere >= 0
    ? 1
    : Math.exp(-earthShadowHeightKm(-sunAltHere) / SCALE_HEIGHT_KM);
  // 시선 고도가 높을수록 산란점이 높아 → 햇빛이 통과하는 대기가 얇아집니다.
  const t = clamp01(viewElevDeg / getTuning().scatterHeightKneeDeg);
  const smooth = t * t * (3 - 2 * t);
  const shZen = getTuning().scatterHeightZenith;
  const hFrac = SCATTER_HEIGHT_HORIZON + (shZen - SCATTER_HEIGHT_HORIZON) * smooth;
  const mSun = airMass(sunAltForT) * Math.exp(-hFrac);
  // 다중산란은 하늘 전역에서 오므로 훨씬 약하게 감쇠시킵니다.
  const mSunMS = Math.min(mSun, Math.max(getTuning().msAirmassCap, mSun * getTuning().msAirmassFrac));

  const tR = tauRayleighRGB(elevScaleHere);
  const tM = tauMieRGB(p.betaMie, p.angstrom, elevScaleHere);
  const ozAM = ozoneAirMass(Math.max(sunAltForT, 0.5), sunAltHere);
  const ozScale = p.ozoneDU / 300;
  /**
   * **시선 방향** 오존 경로.
   *
   * 오랫동안 오존은 태양 경로에만 걸려 있었습니다. 그런데 지평선을 볼 때
   * 내 눈까지 오는 빛도 오존층을 거의 접선으로 통과합니다 — 여기서 배수가
   * 10을 넘고, τ가 [0.48, 0.26, 0.02]입니다. 적색만 28% 깎이는 크기인데
   * 통째로 빠져 있었습니다.
   *
   * 그래서 박명 지평선이 **올리브색**이 됐습니다. 산란광은 원래 붉게
   * 물든 빛인데, 그 붉은 쪽을 걷어낼 항이 없으니 R과 G가 비슷해지고
   * B만 낮은 누런 초록이 남습니다 (2G/(R+B)가 천정 0.9 대 지평선 1.44).
   * 실제 박명 지평선이 파란 것은 이 흡수 때문입니다.
   *
   * 태양 경로 쪽의 `twilight` 배율은 여기 쓰지 않습니다. 그것은 해가
   * 지평선 아래로 내려가며 **햇빛이** 접선으로 길어지는 기하이고, 관측자의
   * 시선이 길어지는 것과는 다른 사정입니다.
   */
  const ozAMView = Math.max(0, ozoneAirMass(viewElevDeg, 0).single - ozoneAirMass(90, 0).single);

  const pR = rayleighPhase(cosGamma) * RAYLEIGH_GAIN;
  const pM = hgPhase(cosGamma, MIE_G) * MIE_GAIN;

  /**
   * 조명 투과율 — **색은 얇은 공기 경로에서, 밝기는 예전 경로에서** 가져옵니다.
   *
   * 두 항을 그냥 곱하면 고도를 두 번 셉니다. 그림자가 h까지 오르면 빛이
   * 지나는 공기도 `exp(-h/H)`로 얇아지고(소광 감소 → **밝아짐**), 산란할
   * 공기 질량도 같은 `exp(-h/H)`로 줄어듭니다(→ 어두워짐). 앞의 것만
   * 넣으면 청색 소광이 e^3.9 = 49배나 풀려서, 재 보니 해가 진 **뒤에**
   * 지평선이 더 밝아졌습니다 (0° 대비 -2°에서 1.2배).
   *
   * 그래서 역할을 나눕니다.
   *
   *  - **밝기**는 `earthShadowLit`/`earthShadowLitMS`가 전담합니다. 이 둘은
   *    실제 렌더 화면에 맞춰 척도고도를 고른 값이라(위 주석의 표) 건드리면
   *    이미 검증된 박명 밝기 곡선이 통째로 흔들립니다.
   *  - **색**만 얇은 공기 경로에서 가져옵니다. 휘도를 옛 경로에 맞춰
   *    정규화하므로 밝기는 그대로이고 색상만 바뀝니다.
   *
   * 이 분리가 박명 하늘을 파랗게 만듭니다. 얇아지는 것은 공기뿐이고
   * 오존층(22km)은 그림자 위에 남아 그대로 통과하므로, 적색을 걷어내는
   * 항만 살아남습니다.
   */
  const LUM_W = [0.2126, 0.7152, 0.0722];
  const tSunRGB: number[] = [];
  const tSunMsRGB: number[] = [];
  /** 두꺼운 경로(그림자 높이를 안 뺀) 투과율. 정규화용 휘도 말고 색 자체를
   *  아래 다중산란 물듦 항에 씁니다. */
  const tSunThickRGB: number[] = [];
  let lumThin = 0, lumThick = 0, lumThinMS = 0, lumThickMS = 0;
  for (let c = 0; c < 3; c++) {
    const tauZ = tR[c] + tM[c];
    const oz = OZONE_TAU[c] * ozScale * ozAM.single;
    const ozMS = OZONE_TAU[c] * ozScale * ozAM.multi;
    const thin = Math.exp(-tauZ * mSun * litAirFrac - oz);
    const thick = Math.exp(-tauZ * mSun - oz);
    const thinMS = Math.exp(-tauZ * mSunMS * litAirFrac - ozMS);
    const thickMS = Math.exp(-tauZ * mSunMS - ozMS);
    tSunRGB.push(thin);
    tSunMsRGB.push(thinMS);
    tSunThickRGB.push(thick);
    lumThin += LUM_W[c] * thin;
    lumThick += LUM_W[c] * thick;
    lumThinMS += LUM_W[c] * thinMS;
    lumThickMS += LUM_W[c] * thickMS;
  }
  const normS = lumThick / Math.max(1e-12, lumThin);
  const normMS = lumThickMS / Math.max(1e-12, lumThinMS);

  // 태양이 지평선 아래로 내려가면 하층 대기가 지구 그림자에 들어갑니다.
  // 지평선 아래의 어두워짐은 **전부** 이 항이 담당합니다 — 위의 mSun은
  // TRANSMITTANCE_MIN_SUN_ALT=0 에서 얼어 색만 유지합니다.
  const sunLit = earthShadowLit(sunAltHere);
  const sunLitMS = earthShadowLitMS(sunAltHere);

  /**
   * 박명 지평선의 "따뜻한 원천" 혼합 비율.
   *
   * 다중산란 항(`multi`)은 등방적이라 원래 천정 파랑을 지킵니다. 문제는
   * 그 색을 지평선 근처, 시민박명(-1°~-6°)에서도 그대로 쓰면 **하늘 자체가
   * 초록으로 뜬다는 것**입니다 (실측: 태양 -3°, 시선 1°에서 색상각 146°).
   *
   * 실제로는 해가 진 뒤에도 태양 쪽 지평선은 한동안 따뜻한 색으로 남습니다
   * — 서쪽 멀리서 대기를 접선으로 길게 통과해 온 빛(잔광, afterglow)이기
   * 때문입니다. 사진 3장(EXIF로 확인한 태양고도 -1.9°~+1.4°, 전부 태양
   * 방향)이 전부 따뜻한 색이고, `docs/TWILIGHT.md` 5-E절도 태양 -4°
   * 지평선의 목표를 `rgb(241,199,0)`(금색)로 적어 뒀습니다. 5-G절은
   * -8°에서도 목표가 "탁한 주황"이라고 남겨 뒀습니다 — 파란 것은 태양
   * **반대편**(지구 그림자대)이지 태양 쪽이 아닙니다.
   *
   * 시선이 지평선에 가까울수록, 해가 낮을수록 커집니다. `sunAltDeg`(지상
   * 기준)를 쓰는 이유는 `sunAltHere`(관측 고도에서 본 태양고도)를 쓰면
   * 고도가 높을수록 혼합비가 작아져 "높은 곳 공기가 더 오래 따뜻하다"는
   * 성질이 뒤집히기 때문입니다.
   *
   * ⚠ 시선 고도 문턱은 **12°**입니다. 30°로 뒀더니 "10km 위에서 내려다본
   * 공기가 지상보다 따뜻하다"는 별개의 성질(고도별 주변광 검사, elev=15°)
   * 과 충돌했습니다 — mSun 이 관측 고도에 따라 갈리는데(높은 관측자는
   * 태양이 덜 가라앉아 mSun 이 작음) 혼합비는 지상 기준으로 고정해 두니,
   * 지상 쪽만 크게 데워지고 10km 쪽은 거의 안 데워져 비율이 뒤집혔습니다.
   * 실제 사진·이 앱의 렌더가 이 항을 필요로 하는 곳은 시선이 지평선에
   * 바짝 붙은 곳(카메라 FOV 하단)이라, 문턱을 좁혀도 목표는 그대로
   * 맞습니다.
   */
  const twilightWarmMix =
    clamp01((-sunAltDeg - 1) / 5) * clamp01(1 - viewElevDeg / 12) * TWILIGHT_WARM_MIX;
  // multi 의 색을 이 쪽으로 기울일 때 쓸 원천. tSunThickRGB(그림자 높이를
  // 안 뺀 감쇠, 즉 단일산란과 같은 성격의 "길게 물든" 색)를 multi 와 같은
  // 휘도로 맞춥니다 — 섞어도 밝기(박명 밝기 곡선)는 그대로고 색만 바뀝니다.
  const warmScale = lumThickMS / Math.max(1e-12, lumThick);

  // ── 다중산란 색의 방위각 감쇠 ──────────────────────────────────────
  //
  // 세 채널을 먼저 구한 뒤 휘도 쪽으로 섞습니다 — 채널 하나만 보고는
  // 중성이 뭔지 알 수 없기 때문입니다. ATMOSPHERE_GLSL 의 같은 자리와
  // **같은 식이어야 합니다.**
  const msWashed = [0, 0, 0];
  {
    for (let c = 0; c < 3; c++) {
      const cold = tSunMsRGB[c] * normMS;
      const warm = tSunThickRGB[c] * warmScale;
      msWashed[c] = cold + (warm - cold) * twilightWarmMix;
    }
    const away = 0.5 * (1 - Math.cos(gammaDeg * Math.PI / 180));
    const wash = away * getTuning().msAzimWash;
    const luma = 0.2126 * msWashed[0] + 0.7152 * msWashed[1] + 0.0722 * msWashed[2];
    for (let c = 0; c < 3; c++) msWashed[c] += (luma - msWashed[c]) * wash;
  }

  const out: number[] = [];
  const tauViewTotal = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const tauZenith = tR[c] + tM[c];

    // 산란 지점에 도달하는 햇빛의 투과율 — 위에서 색만 바꿔 만든 값입니다.
    const tSun = tSunRGB[c] * normS;
    // 다중산란용 — 하늘 전역에서 오는 빛이라 훨씬 덜 감쇠. 위에서 세 채널을
    // 함께 구하고 방위각 감쇠까지 먹인 값입니다.
    const tSunMS = msWashed[c];

    // 시선 경로의 총 광학두께 — 산란(공기+에어로졸)과 흡수(오존)를 나눕니다.
    const tauViewScat = tauZenith * mView;
    const tauViewAbs = OZONE_TAU[c] * ozScale * ozAMView;
    const scatterFrac = 1 - Math.exp(-(tauViewScat + tauViewAbs)); // 포화형

    /**
     * 단일산란 알베도 ω₀ = 산란 / (산란 + 흡수).
     *
     * 두꺼운 대기에서 눈에 도달하는 airlight는 τ에 비례하지 않고 ω₀에
     * 수렴합니다. 흡수가 없으면 1이라 예전 식과 같고, 지평선 오존 경로에서는
     * [0.72, 0.89, 1.00]이 되어 적색을 골라 깎습니다.
     */
    const w0 = tauViewScat / Math.max(1e-6, tauViewScat + tauViewAbs);

    // Rayleigh / Mie 산란 기여 비율
    const rW = (tR[c] * mView) / Math.max(1e-6, tauViewScat);
    const mW = 1 - rW;

    // 단일산란 — 태양 방향의 붉은 노을을 만듭니다.
    const single = tSun * (pR * rW + pM * mW) * w0 * scatterFrac;
    // 다중산란 — 등방적. 천정의 파랑과 지평선 airlight를 유지시킵니다.
    const multi = tSunMS * w0 * scatterFrac * getTuning().msGain * (1 / (4 * Math.PI));

    // 지구 그림자를 두 성분에 **다르게** 겁니다.
    //
    // 단일산란은 시선 기둥이 직접 햇빛을 받아야 생기므로, 그림자가 그 기둥을
    // 덮으면 그대로 사라집니다. 반면 다중산란으로 들어오는 빛은 아직 햇빛을
    // 받고 있는 **먼 상층 대기**에서 여러 번 튕겨 옵니다 — 내 머리 위가
    // 그늘에 들어갔다고 사라지지 않습니다. 이게 박명의 긴 꼬리입니다.
    // (파일 위쪽에서 mSun/mSunMS를 나눈 것과 같은 이유입니다.)
    out.push((single * sunLit + multi * sunLitMS) * getTuning().skyExposure);
    tauViewTotal[c] = tauViewScat + tauViewAbs;
  }

  // 두꺼운 시선 경로에서 색이 씻깁니다 — ATMOSPHERE_GLSL 의 atm_pathWash 와
  // **같은 식이어야 합니다.** 여기가 갈라지면 하늘돔과 구름 조명색이 어긋납니다.
  {
    const LW = [0.2126, 0.7152, 0.0722];
    const tau = LW[0] * tauViewTotal[0] + LW[1] * tauViewTotal[1] + LW[2] * tauViewTotal[2];
    const wash = (1 - Math.exp(-tau * 0.35)) * getTuning().airWash;
    const luma = LW[0] * out[0] + LW[1] * out[1] + LW[2] * out[2];
    for (let c = 0; c < 3; c++) out[c] += (luma - out[c]) * wash;
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
  const dip =
    (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(0, cloudAltKm))) * 180) /
    Math.PI;
  const hAlt = sunAltDeg + dip;
  const b = directBeamRGB(
    hAlt,
    p.observerElevM + cloudAltKm * 1000,
    p.latitude,
    p.betaMie,
    p.dayOfYear
  );
  // ── 해 원반이 이 높이의 지평선 위에 얼마나 남았나 (§104) ──────────────
  //
  // directBeamRGB 는 지평선 아래에서 직달을 exp(겉보기고도/2.5) 로 **천천히** 꺼 갑니다
  // ("산란은 남는다" 는 주석과 함께). 그런데 산란(하늘빛)은 skyRadiance 가 따로 맡고, 직달은
  // 원반이 지평선에 가리면 그걸로 끝입니다. 예전 눈금(직달이 26배 작음)에서는 그 꼬리가 안
  // 보였지만, 눈금을 맞추자 해 −3° 에 이미 지구 그림자에 든 저층이 샛노랗게 탔습니다.
  // 원반(반지름 0.267°) 중 겉보기 지평선 위에 남은 **넓이 비율**로 바꿉니다.
  const app = getApparentAltitude(hAlt);
  const R_SUN = 0.267;
  if (app >= R_SUN) return b;
  const x = Math.max(-1, Math.min(1, app / R_SUN));
  const vis = (Math.PI - Math.acos(x) + x * Math.sqrt(1 - x * x)) / Math.PI;
  const tail = app < 0 ? Math.exp(app / 2.5) : 1;   // directBeamRGB 가 곱한 꼬리를 되돌립니다
  const k = vis / tail;
  return { r: b.r * k, g: b.g * k, b: b.b * k };
}

// ── 3b) 달빛 (§92) ─────────────────────────────────────────────────────────
//
// 달빛은 햇빛을 되비춘 것이라 **색과 방향 분포가 햇빛과 같고 세기만 다릅니다.**
// 그래서 하늘도 구름도 "해를 달 자리에 둔 낮" 을 그대로 계산해 이득만 곱합니다.
//
// 예전에는 구름에만 상수 달빛 `(0.045, 0.068, 0.098) × 조도 × 2.5` 를 더했습니다.
// 보름에 대낮 하늘 복사휘도와 맞먹는 값이라, 밤 순응(16배)을 거치면 얇은 상층운이
// 대낮 하늘처럼 하늘색으로 빛났습니다. 하늘에는 달빛이 아예 없어 틈은 새까맸습니다
// (2026-09-25 21:37 요네자와, 달 98%). 달 아래 구름 ÷ 하늘 비가 낮의 28배였습니다.

/**
 * 이득의 닻 — **보름달 하늘은 해가 이만큼 내려간 박명 하늘과 밝기가 같습니다.**
 *
 * 보름달 밤 천정 하늘은 V 17.5~18 등급/초² 안팎이고, 박명 천정이 그 밝기가 되는 것은
 * 해가 −10~−11° 일 때입니다(대략값). 이 렌더의 밝기 단위는 박명을 눈 순응 쪽으로
 * 눌러 둔 것이라(낮 ÷ −10° 가 물리로는 수십만 배, 여기서는 160배) 물리 비
 * (보름달 ÷ 해 ≈ 2.5×10⁻⁶)를 그대로 쓰면 안 보입니다. 대신 **같은 물리 밝기는 같은
 * 화면 밝기**가 되도록 이 렌더의 박명 하늘에 붙입니다.
 */
export const MOON_SKY_ANCHOR_SUN_DEG = -10.5;
/** 닻을 잰 달의 고도. 달 고도가 바뀌면 낮 하늘이 해 고도로 바뀌는 만큼 바뀝니다. */
export const MOON_REF_ALT_DEG = 45;

/** 하늘 반구 조도의 6점 구적 — CloudSlab 셰이더의 `ambHemi` 와 같은 마디입니다. */
const HEMI_NODES: ReadonlyArray<readonly [number, number]> = [
  [22, 28], [22, 70], [22, 145], [56, 28], [56, 70], [56, 145],
];
const lumOf = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** 해가 `sunAltDeg` 에 있을 때 하늘 반구 조도(휘도, 6점 평균). */
export function hemiSkyLuminance(sunAltDeg: number, p: AtmosphereParams): number {
  const D = Math.PI / 180;
  const sS = Math.sin(sunAltDeg * D), cS = Math.cos(sunAltDeg * D);
  let s = 0;
  for (const [e, az] of HEMI_NODES) {
    const cg = Math.sin(e * D) * sS + Math.cos(e * D) * cS * Math.cos(az * D);
    s += lumOf(skyRadiance(e, Math.acos(Math.max(-1, Math.min(1, cg))) / D, sunAltDeg, p, 0));
  }
  return s / HEMI_NODES.length;
}

const moonGainCache = new WeakMap<AtmosphereParams, number>();
/** 보름달의 이득 K — 닻에서 한 번 구해 대기마다 기억합니다. */
export function moonSkyGain(p: AtmosphereParams): number {
  const hit = moonGainCache.get(p);
  if (hit !== undefined) return hit;
  const k = Math.max(0, hemiSkyLuminance(MOON_SKY_ANCHOR_SUN_DEG, p) - lumOf(NIGHT_SKY))
    / Math.max(1e-9, hemiSkyLuminance(MOON_REF_ALT_DEG, p));
  moonGainCache.set(p, k);
  return k;
}

/**
 * 위상에 따른 달 밝기(보름 = 1). Allen 의 등급식 Δm = 0.026|α| + 4×10⁻⁹α⁴,
 * α 는 위상각(°) — 조명 비율 f 에서 α = acos(2f − 1).
 */
export function moonPhaseFactor(fraction: number): number {
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return 0;
  const a = (Math.acos(2 * f - 1) * 180) / Math.PI;
  return Math.pow(10, -0.4 * (0.026 * a + 4e-9 * a ** 4));
}

/** 밤이 깊은 정도 — CloudSlab 셰이더의 `nightFactor` 와 같은 식(−2° 에서 0, −12° 에서 1). */
export function nightFactorOf(sunAltDeg: number): number {
  return Math.max(0, Math.min(1, (-sunAltDeg - 2) / 10));
}

export interface MoonLight {
  /** 달 자리에 둔 해의 하늘·직달에 곱할 이득. 낮이면 0. */
  gain: number;
  /**
   * 구름을 달로 비출지. 구름 셰이더는 광원을 하나만 계산하므로, 박명과 달빛 중
   * 하늘을 더 밝히는 쪽을 고릅니다. 밤하늘 바닥의 2% 도 안 되는 달(초승·지고 난 뒤)은
   * 고르지 않습니다 — 그 밤은 예전과 바이트 단위로 같습니다.
   */
  useMoon: boolean;
}

export function moonLight(
  sunAltDeg: number,
  moonAltDeg: number,
  moonFraction: number,
  p: AtmosphereParams,
): MoonLight {
  const nf = nightFactorOf(sunAltDeg);
  const ph = moonPhaseFactor(moonFraction);
  if (nf <= 0 || ph <= 0) return { gain: 0, useMoon: false };
  const gain = moonSkyGain(p) * ph * nf;
  const moonPart = gain * hemiSkyLuminance(moonAltDeg, p);
  // 밤하늘 바닥의 2% 도 못 밝히는 달(진 달·초승)은 하늘에도 더하지 않습니다 — 예전에는
  // 하늘에만 더해 두었는데, 밤 암순응(§95)이 그 미세한 빛을 화면에 드러냈습니다.
  if (moonPart <= 0.02 * lumOf(NIGHT_SKY)) return { gain: 0, useMoon: false };
  const twiPart = Math.max(0, hemiSkyLuminance(sunAltDeg, p) - lumOf(NIGHT_SKY));
  return { gain, useMoon: moonPart > twiPart };
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
 * 그늘진 구름이 황혼에 받는 두 환경광의 비중 (docs/CLOUD_PHYSICS.md §5).
 *
 * 구름 아랫면·그늘면은 반구를 봅니다. 그 반구의 절반쯤은 지평선 노을빛이고
 * 절반쯤은 머리 위 천공빛이라, 두 광원을 각각 이 비중으로 더합니다.
 *
 * **채널별 가중치가 아닙니다.** 예전에는 `[R,G,B] = [0.28, 0.15, 0.45]`로
 * 지평선빛의 R·G와 천공빛의 B만 뽑아 섞었는데, 녹색 가중치가 적·청의 절반이라
 * **없는 자홍색을 만들어 냈습니다** — 태양 -4°에서 층적운 그늘면의 72%가
 * rgb(193,0,93)으로 덮였습니다. 실제 황혼 구름 그늘은 회보라·회갈색이지
 * 마젠타가 아닙니다.
 *
 * 지금은 두 광원의 **RGB 전체**를 더합니다. 색은 광원이 정하고, 여기 상수는
 * 세기만 정합니다.
 */
export const TWILIGHT_TINT_HORIZON = 0.22;
export const TWILIGHT_TINT_ZENITH = 0.38;

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
 * **직달광을 하늘과 같은 눈금으로 올리는 배수.**
 *
 * ## 왜 필요한가 — 직달에는 태양 상수가 빠져 있었습니다
 *
 * directBeamRGB 가 돌려주는 것은 **투과율**입니다 (0~1). 대기가 얼마나
 * 깎아 먹는지만 있고, 깎이기 전의 절대 밝기가 없습니다. 반면 하늘 쪽
 * skyRadiance 는 사진에 맞춰 눈금이 잡힌 복사휘도입니다. 둘을 그대로
 * 더하면 **직달이 확산보다 어두운** 세상이 됩니다:
 *
 *   해 30° 에서 하늘 L̄ = 0.74, 수평면 직달 = beam·sin/π = 0.10
 *   → 직달/확산 = 0.14. 실제 맑은 하늘은 3.7 입니다.
 *
 * 스물여섯 배가 통째로 빠져 있었던 것이고, 이것이 낮 지형에 입체감이 없던
 * 진짜 원인입니다 — 사면이 향을 바꿔도 움직이는 몫이 전체의 12% 뿐이라
 * 어느 쪽을 보든 같은 밝기가 나옵니다.
 *
 * ## 값의 근거 — 하나의 상수로 맞는가
 *
 * 필요한 배수는 "물리 직달/확산 비"를 우리 눈금으로 되돌린 값입니다:
 *
 *   S(고도) = ρ(고도) · π · L̄ / (beam · sin(고도))
 *
 * ρ 는 이 파일이 이미 쓰는 Meinel & Meinel 짝: 직달 0.7^(AM^0.678),
 * 확산 0.3·(1 − 0.7^AM). 태양 고도 6°~80° 에서 재면
 *
 *   80° 35.7 · 60° 25.7 · 40° 24.8 · 20° 22.7 · 10° 25.7 · 6° 30.2
 *
 * 중앙값 26, 폭 22.7~35.7. **상수 하나로 −12%/+37% 안에 듭니다** — 빠져
 * 있던 것이 고도에 따라 변하는 무엇이 아니라 그냥 눈금이었다는 뜻입니다.
 *
 * ⚠ 4° 아래에서는 S 가 발산합니다 (3° 45, 1° 110). Meinel 의 확산 근사가
 * 큰 대기질량에서 무너지기 때문입니다. 그 자리에서는 sin(고도) 가 작아
 * 직달 항 자체가 거의 0 이라 화면에 안 나타납니다. 억지로 맞추려고 고도별
 * 곡선을 넣지 않습니다 — 근거가 없는 자리입니다.
 */
export const SOLAR_BEAM_SCALE = 26;

/** groundLighting 이 지형 셰이더에 넘길 한 벌. */
export interface GroundLighting {
  /** 수평면 총조도 / π (하늘 + 직달의 수평면 몫). uSurfaceIrr 로 갑니다. */
  surfaceIrr: RGB;
  /** 직달 복사휘도 × 태양 가림률. uSunRadiance 로 갑니다. */
  sunRadiance: RGB;
  /** 평균 밝기를 그대로 지키는 노출 보정. uExposure 에 곱합니다. */
  exposure: number;
}

/**
 * 지형 조명 한 벌 — **직달을 물리 비율로 올리고, 노출로 되맞춥니다.**
 *
 * 배수만 올리면 낮 화면이 통째로 날아갑니다. 그래서 같은 자리에서 노출을
 * 나눕니다: 평평하고 위를 보는 지면의 밝기는 **정확히 그대로**이고, 기울어진
 * 곳만 밝고 어두워집니다. 바꾸려던 것이 딱 그것입니다.
 *
 *   보정 = (L̄ + beam·sin/π) / (L̄ + S·beam·sin/π)
 *
 * 휘도로 한 번만 계산해 세 채널에 같이 겁니다 — 채널마다 따로 하면 노출이
 * 색을 바꿔 버립니다.
 */
export function groundLighting(
  sunAltDeg: number,
  skyMean: RGB,
  beam: RGB,
  sunTransmittance = 1
): GroundLighting {
  const sunT = clamp01(sunTransmittance);
  const sinAlt = Math.max(0, Math.sin((sunAltDeg * Math.PI) / 180));
  const direct = (sinAlt * sunT) / Math.PI;
  const lum = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const S = SOLAR_BEAM_SCALE;

  const before = lum(skyMean) + lum(beam) * direct;
  const after = lum(skyMean) + S * lum(beam) * direct;

  return {
    surfaceIrr: {
      r: skyMean.r + S * beam.r * direct,
      g: skyMean.g + S * beam.g * direct,
      b: skyMean.b + S * beam.b * direct,
    },
    sunRadiance: { r: S * beam.r * sunT, g: S * beam.g * sunT, b: S * beam.b * sunT },
    exposure: before / Math.max(1e-6, after),
  };
}

/** 구름 아래에서 하늘빛이 잃는 채도 비율 */
export const CLOUD_DIM_DESAT = 0.85;
/** 구름이 완전히 덮었을 때 남는 하늘빛 밝기 */
export const CLOUD_DIM_FLOOR = 0.30;

/**
 * 구름층 아래로 들어간 하늘빛.
 *
 * 두꺼운 구름 아래에서는 노을이 보이지 않습니다. 빛이 구름 안에서 여러 번
 * 산란되며 방향성과 색을 모두 잃기 때문입니다. 이 보정이 없으면 스카이돔과
 * 구름 ambient가 맑은 날의 복사휘도를 그대로 쓰고, 8/8 일몰이 시뻘겋게 탑니다.
 *
 * 스카이돔(GLSL)과 구름 배치(TS)가 **같은 식**을 써야 하므로 여기 한 번만 둡니다.
 *
 * @param diffuseFactor 구름 기둥의 확산 투과율 (1 = 맑음, 0 = 완전 차폐)
 */
export function applyCloudDimming(c: RGB, diffuseFactor: number): RGB {
  const blocked = Math.max(0, Math.min(1, 1 - diffuseFactor));
  if (blocked <= 0) return c;
  const grey = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const tune = getTuning();
  const desat = blocked * tune.cloudDimDesat;
  const scale = 1 + (tune.cloudDimFloor - 1) * blocked;
  return {
    r: (c.r + (grey - c.r) * desat) * scale,
    g: (c.g + (grey - c.g) * desat) * scale,
    b: (c.b + (grey - c.b) * desat) * scale,
  };
}

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

// ── 5) GLSL — 위 TS 구현과 같은 상수를 주입해 생성 ─────────────────────────

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * 하늘/구름 셰이더가 공유하는 GLSL 함수 모음.
 * 상수는 위 TS 정의에서 주입되므로 두 구현이 갈라지지 않습니다.
 */
export const WB_SUN_MIN_DEG = -12;
export const WB_STEP_DEG = 3;
/** §89 광원 이득표(r,g,b) — 태양 −12°~30°. `verify-white-balance.js` 가 다시 뽑아 견줍니다. */
export const WB_GAINS: ReadonlyArray<readonly [number, number, number]> = [[1.2818, 0.9696, 0.4718], [1.575, 0.8872, 0.4238], [1.5626, 0.8899, 0.4336], [1.4682, 0.9026, 0.5858], [1.0897, 0.9627, 1.1052], [1.1221, 0.9647, 0.9902], [1.0895, 0.9772, 0.9622], [1.0631, 0.9852, 0.9611], [1.0456, 0.9899, 0.9658], [1.0332, 0.9929, 0.9721], [1.0236, 0.9951, 0.9787], [1.016, 0.9968, 0.9848], [1.0098, 0.9981, 0.9904], [1.0045, 0.9991, 0.9954], [1, 1, 1]] as const;
const WB_LAST = WB_GAINS.length - 1;
const WB_GLSL_ROWS = WB_GAINS.map((g, i) =>
  `if (i == ${i}) return vec3(${g.map(v => v.toFixed(4)).join(', ')});`).join('\n  ') + '\n  return vec3(1.0);';

export const ATMOSPHERE_GLSL = `
const vec3  LAMBDA      = vec3(${f(LAMBDA_RGB[0])}, ${f(LAMBDA_RGB[1])}, ${f(LAMBDA_RGB[2])});
const float TAU_R_550   = ${f(TAU_R_550)};
const float TAU_R_EXP   = ${f(TAU_R_EXP)};
const vec3  OZONE_TAU   = vec3(${f(OZONE_TAU[0])}, ${f(OZONE_TAU[1])}, ${f(OZONE_TAU[2])});
const float MIE_G       = ${f(MIE_G)};
const float CLOUD_G     = ${f(CLOUD_G)};
const float RAY_GAIN    = ${f(RAYLEIGH_GAIN)};
const float MIE_GAIN    = ${f(MIE_GAIN)};
uniform float MS_GAIN;
const float TW_WARM_MIX = ${f(TWILIGHT_WARM_MIX)};
uniform float SKY_EXPOSURE;
const float TWILIGHT_END= ${f(TWILIGHT_END_DEG)};
const vec3  NIGHT_SKY   = vec3(${f(NIGHT_SKY.r)}, ${f(NIGHT_SKY.g)}, ${f(NIGHT_SKY.b)});
uniform float CLOUD_DIM_DESAT;
uniform float CLOUD_DIM_FLOOR;
uniform float MS_AM_CAP;
uniform float MS_AZIM_WASH;
uniform float MS_AM_FRAC;
const float SH_HORIZON  = ${f(SCATTER_HEIGHT_HORIZON)};
uniform float SH_ZENITH;
uniform float SH_KNEE;
const float T_MIN_SUNALT= ${f(TRANSMITTANCE_MIN_SUN_ALT)};
const float TW_TINT_H   = ${f(TWILIGHT_TINT_HORIZON)};
const float TW_TINT_Z   = ${f(TWILIGHT_TINT_ZENITH)};
uniform float TW_TINT;
const float SCALE_H_KM  = ${f(SCALE_HEIGHT_KM)};
uniform float TW_SCALE_H;
uniform float TW_MS_SCALE;
const float AERIAL_STR  = ${f(AERIAL_STRENGTH)};
uniform float OZ_TW_GAIN;
const float OZ_TW_MAX   = ${f(OZONE_TWILIGHT_MAX)};
const float OZ_TW_MSFRAC= ${f(MS_OZONE_TWILIGHT_FRACTION)};
uniform float DISP_EXPO;
uniform float ADAPT_MAX;
uniform float ADAPT_HI;
uniform float ADAPT_LO;
uniform float ADAPT_ROD;   // §95 간상체 암순응 배율
uniform float ROD_DESAT;   // §95 밤의 색 빠짐
uniform float DISP_SAT;
uniform float DISP_CONTR;
uniform float DISP_BLUE;
uniform float DISP_WB;   // §89 카메라 화이트밸런스 정도
uniform float DISP_BLUE_CAP;
uniform float AIR_WASH;
uniform float TONEMAP;
const vec3  GROUND_DARK = vec3(${f(GROUND_DARKEN.r)}, ${f(GROUND_DARKEN.g)}, ${f(GROUND_DARKEN.b)});
const float GROUND_FADE = ${f(GROUND_FADE_DEG)};
const float PI_         = 3.14159265359;

// Kasten-Young 대기 질량 — 지평선으로 갈수록 대기가 두꺼워지는 정도
float atm_airMass(float altDeg) {
  float h = max(altDeg, -1.5);
  if (h >= 89.0) return 1.0;
  return 1.0 / (sin(radians(h)) + 0.50572 * pow(6.07995 + h, -1.6364));
}

// 지구 그림자 높이 (km) — 태양 복각 δ에서 아직 햇빛이 닿는 최저 고도.
// TS의 earthShadowHeightKm과 같은 식이어야 합니다.
float atm_earthShadowHeightKm(float depressionDeg) {
  return ${EARTH_RADIUS_KM_GLSL} * (1.0 / cos(radians(max(0.0, depressionDeg))) - 1.0);
}

// 아직 햇빛을 받는 산란 대기 비율. 지평선 아래 어두워짐을 전부 담당합니다.
// TS의 earthShadowLit과 같은 식이어야 합니다.
float atm_earthShadowLit(float sunAltDeg) {
  if (sunAltDeg >= 0.0) return 1.0;
  if (sunAltDeg <= TWILIGHT_END) return 0.0;
  return exp(-atm_earthShadowHeightKm(-sunAltDeg) / TW_SCALE_H);
}

// 다중산란 성분용 — 훨씬 완만합니다. TS의 earthShadowLitMS와 같은 식.
float atm_earthShadowLitMS(float sunAltDeg) {
  if (sunAltDeg >= 0.0) return 1.0;
  if (sunAltDeg <= TWILIGHT_END) return 0.0;
  return exp(-atm_earthShadowHeightKm(-sunAltDeg) / TW_MS_SCALE);
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

// x = 단일산란용 경로, y = 다중산란용 경로 (TS ozoneAirMass와 같아야 합니다)
vec2 atm_ozoneAirMass(float altDeg, float trueSunAlt) {
  float s = sin(radians(altDeg));
  float rO = 22.0 / ${EARTH_RADIUS_KM_GLSL};
  float base = (1.0 + rO) / sqrt(max(0.001, s * s + 2.0 * rO));
  // 박명에는 오존층을 접선 방향으로 길게 통과 → 주황이 걷히고 파랑이 남음
  float tw = trueSunAlt < 0.0 ? 1.0 + min(OZ_TW_MAX, -trueSunAlt * OZ_TW_GAIN) : 1.0;
  return vec2(base * tw, base * (1.0 + (tw - 1.0) * OZ_TW_MSFRAC));
}

/**
 * **두꺼운 시선 경로에서 색이 씻기는 것** — 단일산란 근사의 보정입니다.
 *
 * 우리 식은 airlight 를 "한 번 산란된 햇빛"으로 칩니다. 그래서 광로가
 * 길어져도 색은 태양 투과색 그대로 짙게 남습니다. 실제로는 광로가 길수록
 * 광자가 **여러 번** 산란되고, 산란마다 파장이 섞여 emergent radiance 가
 * 중성 쪽으로 끌려갑니다. 지평선 근처 하늘이 늘 뿌연 이유입니다.
 *
 * 실제 하늘 사진 9장에서 **예외 없이** 아래쪽 채도가 위쪽보다 낮았는데
 * (0.25~0.97배), 우리 노을은 1.36배로 **거꾸로** 였습니다 (계획 20절).
 *
 * 휘도는 그대로 두고 색만 중성으로 끕니다 — vec3(luma) 로 섞으면 휘도가
 * 정확히 보존되므로, 애써 맞춰 둔 박명 밝기 곡선을 건드리지 않습니다.
 *
 * K = 0.35 는 모양만 정합니다: 맑은 날 천정(τ≈0.1)에서 3%, 지평선(τ≈5)에서
 * 83% 가 되도록. 세기는 AIR_WASH 로 조절합니다.
 */
vec3 atm_pathWash(vec3 col, vec3 tauView) {
  vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  float tau = dot(LW, tauView);
  float wash = (1.0 - exp(-tau * 0.35)) * AIR_WASH;
  return mix(col, vec3(dot(LW, col)), wash);
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
  float hFrac = mix(SH_HORIZON, SH_ZENITH, smoothstep(0.0, SH_KNEE, viewElevDeg));
  float mSun   = atm_airMass(sunAltForT) * exp(-hFrac);
  float mSunMS = min(mSun, max(MS_AM_CAP, mSun * MS_AM_FRAC));
  // 박명 조명이 지나는 공기의 얇기 — 오존층(22km)은 그림자 위에 남습니다.
  // TS skyRadiance의 litAirFrac과 같은 식이어야 합니다.
  float litAirFrac = sunAltDeg >= 0.0
    ? 1.0
    : exp(-atm_earthShadowHeightKm(-sunAltDeg) / SCALE_H_KM);

  vec3 tR = atm_tauRayleigh(elevScale);
  vec3 tM = atm_tauMie(beta, angstrom, elevScale);
  vec2 ozAM = atm_ozoneAirMass(max(sunAltForT, 0.5), sunAltDeg);
  // 시선 방향 오존 경로 — 지평선에서 배수 10을 넘습니다. TS와 같은 식.
  float ozAMView = max(0.0,
    atm_ozoneAirMass(viewElevDeg, 0.0).x - atm_ozoneAirMass(90.0, 0.0).x);
  float ozScale = ozoneDU / 300.0;

  float pR = atm_rayleighPhase(cosGamma) * RAY_GAIN;
  float pM = atm_hgPhase(cosGamma, MIE_G) * MIE_GAIN;

  // 태양이 지평선 아래면 하층 대기가 지구 그림자에 들어감
  float sunLit   = atm_earthShadowLit(sunAltDeg);
  float sunLitMS = atm_earthShadowLitMS(sunAltDeg);

  vec3 tauZenith = tR + tM;
  vec3 ozone   = OZONE_TAU * ozScale * ozAM.x;
  vec3 ozoneMS = OZONE_TAU * ozScale * ozAM.y;

  // 조명 투과율 — 색은 얇은 공기 경로에서, 밝기는 옛 경로에서.
  // 둘을 그냥 곱하면 고도를 두 번 세어 해가 진 뒤 오히려 밝아집니다.
  // TS skyRadiance의 normS/normMS와 같은 식이어야 합니다.
  vec3 tSunThin   = exp(-tauZenith * mSun   * litAirFrac - ozone);
  vec3 tSunThick  = exp(-tauZenith * mSun   - ozone);
  vec3 tSunMsThin = exp(-tauZenith * mSunMS * litAirFrac - ozoneMS);
  vec3 tSunMsThick= exp(-tauZenith * mSunMS - ozoneMS);
  vec3 LUM_W = vec3(0.2126, 0.7152, 0.0722);
  vec3 tSun     = tSunThin   * (dot(LUM_W, tSunThick)  / max(1e-12, dot(LUM_W, tSunThin)));
  vec3 tSunMSCold = tSunMsThin * (dot(LUM_W, tSunMsThick)/ max(1e-12, dot(LUM_W, tSunMsThin)));
  // 박명 지평선(태양 방향)의 잔광. TS skyRadiance의 twilightWarmMix/tSunMSWarm
  // 과 같은 식이어야 합니다 — 근거는 그쪽 주석 참고.
  float twilightWarmMix =
    clamp(-sunAltDeg - 1.0, 0.0, 5.0) / 5.0 *
    clamp(1.0 - viewElevDeg / 12.0, 0.0, 1.0) * TW_WARM_MIX;
  vec3 tSunMSWarm = tSunThick * (dot(LUM_W, tSunMsThick) / max(1e-12, dot(LUM_W, tSunThick)));
  vec3 tSunMS = mix(tSunMSCold, tSunMSWarm, twilightWarmMix);

  // 방위각 감쇠 — 다중산란은 산란을 거듭할수록 태양 방향의 기억을 잃습니다.
  // 태양에서 멀어질수록 그 색이 중성으로 돌아가야, 노을이 반대편 지평선까지
  // 번지지 않습니다. 휘도는 보존합니다.
  // TS skyRadiance 와 같은 식이어야 합니다.
  {
    float away = 0.5 * (1.0 - cosGamma);            // 0 태양쪽 ~ 1 반대편
    tSunMS = mix(tSunMS, vec3(dot(LUM_W, tSunMS)), away * MS_AZIM_WASH);
  }

  // 시선 경로 — 산란(공기+에어로졸)과 흡수(오존)를 나눕니다.
  vec3 tauViewScat = tauZenith * mView;
  vec3 tauViewAbs  = OZONE_TAU * ozScale * ozAMView;
  vec3 scatterFrac = 1.0 - exp(-(tauViewScat + tauViewAbs));
  // 단일산란 알베도 — 두꺼운 대기의 airlight는 τ가 아니라 여기에 수렴합니다.
  vec3 w0 = tauViewScat / max(vec3(1e-6), tauViewScat + tauViewAbs);

  vec3 rW = (tR * mView) / max(vec3(1e-6), tauViewScat);
  vec3 mW = 1.0 - rW;

  vec3 single = tSun   * (pR * rW + pM * mW) * w0 * scatterFrac;
  vec3 multi  = tSunMS * w0 * scatterFrac * MS_GAIN * (1.0 / (4.0 * PI_));

  // 지구 그림자를 두 성분에 다르게 적용 — TS skyRadiance와 같아야 합니다.
  vec3 col = (single * sunLit + multi * sunLitMS) * SKY_EXPOSURE;

  // 두꺼운 시선 경로에서 색이 씻깁니다 — TS skyRadiance 와 같은 식이어야 합니다.
  col = atm_pathWash(col, tauViewScat + tauViewAbs);

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
 * 그늘진 구름의 황혼 환경광 합성 (docs/CLOUD_PHYSICS.md §5, docs/TWILIGHT.md §5-C).
 * 차폐도가 클수록 지평선 붉은빛(R,G)과 천공 푸른빛(B)을 받아 자주색을 띱니다.
 */
/**
 * 구름층 아래로 들어간 하늘빛 (TS의 applyCloudDimming과 같은 식).
 * 상수는 TS에서 주입되므로 두 구현이 어긋날 수 없습니다.
 */
vec3 atm_cloudDim(vec3 c, float diffuseFactor) {
  float blocked = clamp(1.0 - diffuseFactor, 0.0, 1.0);
  float grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 d = mix(c, vec3(grey), blocked * CLOUD_DIM_DESAT);
  return d * mix(1.0, CLOUD_DIM_FLOOR, blocked);
}

vec3 atm_twilightTint(vec3 shadowBase, vec3 horizonGlow, vec3 zenithSky, float T, float sunAltDeg) {
  // **황혼에만** 작동해야 합니다.
  //
  // 이 항은 해가 진 뒤 그늘진 구름이 검게 죽지 않고 지평선 노을빛과 천공
  // 푸른빛을 함께 받는 현상을 만듭니다. 그런데 고도 게이트가 없으면 한낮에도
  // 걸립니다. 태양 45°에서 horizonGlow는 (25.2, 19.1, 12.3) — 태양 옆 5°의
  // 눈부신 연무라, 그 색이 그늘 면의 72%를 덮어써서 한낮 구름이 노랗게 탔습니다.
  //
  // 두 광원의 RGB 전체를 더합니다. 예전에는 지평선빛의 R·G와 천공빛의 B만
  // 채널별 가중치로 뽑아 섞었는데, 그 가중치(0.28/0.15/0.45)가 녹색을 눌러
  // **없는 자홍색을 만들어 냈습니다**. 색은 광원이 정하고 상수는 세기만 정합니다.
  float twilight = 1.0 - smoothstep(-2.0, 8.0, sunAltDeg);
  float influence = clamp(1.0 - T, 0.0, 1.0) * twilight * TW_TINT;
  if (influence <= 0.0) return shadowBase;
  vec3 target = horizonGlow * TW_TINT_H + zenithSky * TW_TINT_Z;
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

/**
 * **AgX 톤매핑** (Blender 4.0 / three.js r160+ 가 ACES 를 대신해 쓰는 것).
 *
 * 왜 바꾸는가 — ACES 는 밝고 채도 높은 색의 **색상을 밉니다**(빨강→주황,
 * 파랑→보라). 노을은 정확히 "밝고 채도 높은 빨강·주황"이라 그 약점을
 * 정면으로 맞습니다. Blender 가 4.0 에서 ACES 를 버린 이유가 그것입니다.
 *
 * 그리고 실측하면 어깨에서 **계조가 통째로 사라집니다.** 태양 10도·이격
 * 15도에서 고도 1~12도의 선형 휘도는 3.39 → 2.44 로 1.4배 차이인데,
 * ACES 를 지나면 0.93 → 0.88 로 거의 같아집니다. 채도도 0.06~0.08 —
 * 사용자 화면의 "회백색으로 뭉갠 지평선"이 이것입니다.
 *
 * AgX 는 로그 공간에서 훨씬 긴 구간(-12.5 ~ +4.0 EV)을 편 뒤 시그모이드를
 * 걸어, 밝은 쪽에서도 계조와 색상이 남습니다. 대신 중간 채도가 낮아지므로
 * 뒤의 채도 복원(DISP_SAT)이 그만큼 더 일합니다.
 *
 * 행렬은 Benjamin Wrensch 의 최소 구현(선형 sRGB 직접)입니다.
 */
// ⚠ 이 행렬은 **중성색을 보존해야** 합니다 — 행 합이 1 이어야 (1,1,1) 이
// (1,1,1) 로 갑니다. 처음에 다른 변종의 값을 적었다가 행 합이 1.106 / 0.845
// 가 되어, 아무리 밝아도 흰색이 **0.68 에서 천장**을 쳤습니다. 태양 원반이
// 회색이 되고 블룸이 아예 안 걸렸습니다(verify-bloom 포화 0%).
// 아래는 Benjamin Wrensch 의 표준값이고 두 행렬 모두 행 합이 1.0000 입니다.
const mat3 AGX_IN = mat3(
  0.842479062253094,  0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772,  0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104
);
const mat3 AGX_OUT = mat3(
   1.19687900512017,   -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,
  -0.0990297440797205, -0.0989611768448433,  1.15107367264116
);
const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

vec3 atm_agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2
       - 40.14 * x4 * x
       + 31.96 * x4
       - 6.868 * x2 * x
       + 0.4298 * x2
       + 0.1191 * x
       - 0.00232;
}

vec3 atm_tonemapAgX(vec3 x) {
  vec3 c = AGX_IN * max(x, vec3(0.0));
  c = clamp(log2(max(c, vec3(1e-10))), AGX_MIN_EV, AGX_MAX_EV);
  c = (c - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  c = atm_agxContrast(c);
  c = AGX_OUT * c;
  // AgX 는 2.2 감마가 실린 표시 공간으로 나옵니다. 뒤에 sRGB OETF 가
  // 한 번 더 걸리므로 여기서 선형으로 되돌립니다.
  return clamp(pow(max(c, vec3(0.0)), vec3(2.2)), 0.0, 1.0);
}

/**
 * **카메라 화이트밸런스** (§89) — 광원 색을 DISP_WB 만큼 지웁니다.
 *
 * 표는 태양 −12°~30°, 3° 간격. 광원 = 수평면에 내리는 직달 + 하늘 반구,
 * 휘도 보존 이득, 태양 30° 기준(그 위는 1). 값은 WB_GAINS(아래 TS)와 같고
 * verify-white-balance.js 가 대기 모형에서 다시 뽑아 어긋나면 깨집니다.
 */
vec3 atm_wbTable(int i) {
  ${WB_GLSL_ROWS}
}
vec3 atm_whiteBalance(float sunAltDeg) {
  if (DISP_WB <= 0.0) return vec3(1.0);
  float x = clamp((sunAltDeg + 12.0) / 3.0, 0.0, ${WB_LAST}.0);
  int i0 = int(floor(x));
  int i1 = i0 + 1 > ${WB_LAST} ? ${WB_LAST} : i0 + 1;
  vec3 g = mix(atm_wbTable(i0), atm_wbTable(i1), x - float(i0));
  // ⚠ 표는 **박명까지**입니다. 밤의 광원은 달·도시광이지 하늘이 아니므로 −12° 에서
  //   −18°(천문박명 끝)까지 보정을 걷습니다. 처음엔 −12° 값을 밤까지 끌고 가서
  //   청정한 밤하늘의 파랑까지 걷었습니다(verify-device-repro R/B 0.83, 기준 < 0.55).
  float k = DISP_WB * smoothstep(-18.0, -12.0, sunAltDeg);
  return pow(g, vec3(k));
}

/** 태양이 낮아질수록 노출을 올립니다 (눈의 순응) */
float atm_adaptation(float sunAltDeg) {
  // §95 — 원추체 순응(위) 다음 간상체 암순응이 해 −12° → −18° 에 들어옵니다.
  float rod = 1.0 - smoothstep(-18.0, -12.0, sunAltDeg);
  return (1.0 + (ADAPT_MAX - 1.0) * smoothstep(ADAPT_HI, ADAPT_LO, sunAltDeg))
    * mix(1.0, ADAPT_ROD, rod);
}

/**
 * **밤의 색 빠짐** (§95) — 간상체는 색을 못 보고 507nm 근처에 가장 예민합니다(푸르키녜).
 * 달빛·도시광 밤에는 색이 흐려지고 약간 푸르스름해집니다. 휘도는 그대로 두고 색만
 * 그쪽으로 옮깁니다. 간상체 암순응과 같은 구간(해 −12° → −18°)에서 들어옵니다.
 */
vec3 atm_rodVision(vec3 c, float sunAltDeg) {
  float k = ROD_DESAT * (1.0 - smoothstep(-18.0, -12.0, sunAltDeg));
  if (k <= 0.0) return c;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // 휘도 1 로 맞춘 푸르스름한 회색 (0.88, 0.98, 1.20) / 0.9748
  vec3 rodCol = l * vec3(0.9028, 1.0053, 1.2310);
  return mix(c, rodCol, k);
}

/**
 * 물리 복사휘도 → 화면 색. 순응 노출 → ACES → 채도 복원 → 대비 순서입니다.
 * 채도를 톤매핑 뒤에 거는 것이 핵심입니다(압축으로 깎인 색을 되살림).
 */
vec3 atm_display(vec3 radiance, float saturation, float sunAltDeg) {
  vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  vec3 hdr = radiance * DISP_EXPO * atm_adaptation(sunAltDeg) * atm_whiteBalance(sunAltDeg);
  // TONEMAP 0 = ACES(예전) · 1 = AgX (계획 42절 0단계)
  vec3 c = TONEMAP > 0.5 ? atm_tonemapAgX(hdr) : atm_tonemapACES(hdr);
  float luma = dot(c, LW);
  c = mix(vec3(luma), c, DISP_SAT * saturation);

  // **푸른 하늘에만** 채도를 더 밉니다.
  //
  // 사진의 하늘 색도 [1, 1.65, 4.07] 은 에어로졸을 0 으로 둔 순수 Rayleigh
  // [1, 1.92, 3.55] 보다도 파랗습니다 — 물리로는 닿지 않는 값이고, 사진이
  // 휴대폰에서 이미 채도가 올라간 JPEG 이기 때문입니다. 그래서 물리를
  // 비틀지 않고 여기 표시 단계에서 카메라 응답으로 따로 겁니다.
  //
  // 전역 채도를 올리면 노을이 원색으로 뜹니다(20절에서 한 번 고친 결함).
  // 파랑 우세도로 가중하면 노을·구름·태양은 B<=R 이라 가중치가 정확히 0 이고,
  // 낮 하늘만 움직입니다.
  //
  // ⚠ 그리고 **천장이 필요합니다.** 파랑 우세도만 쓰면 이미 짙푸른 곳
  // — 천정, 그리고 박명 — 이 가장 세게 밀립니다. 재 보니 천정의 HSV 채도
  // 0.60 초과 화소가 0.2%(사진) 대 17.3%(우리)까지 갔습니다. 사진에 아예
  // 없는 색 영역이라 형광 파랑으로 보입니다.
  //
  // 그래서 결과 채도를 DISP_BLUE_CAP 아래로 묶습니다. mix 는 luma 로부터의
  // 편차를 배율만큼 늘리므로 채도도 대략 그 배율로 늘어납니다 — 배율을
  // CAP/현재채도 로 깎으면 넘지 않습니다(선형 근사라 보수적입니다).
  // 태양에서 먼 낮 하늘은 보정 전 채도가 0.35 라 천장에 안 닿고 그대로
  // 다 받습니다. 깎이는 것은 천정과 박명뿐입니다.
  // ⚠ 채도는 **sRGB 로 인코딩한 뒤**의 값으로 재야 합니다. 판정이 보는
  // 화소는 감마가 실린 값이고, 인코딩은 어두운 쪽을 더 들어올려 min/max
  // 비를 바꿉니다 — 같은 색이 선형에서 0.59, sRGB 에서 0.35 입니다. 처음에
  // 선형 채도로 재고 sRGB 문턱과 비교했더니 낮 하늘에서도 천장이 걸려
  // 보정이 통째로 꺼졌습니다(선형 B/R 3.4 → 2.46). 2.2 감마로 근사합니다.
  float blueness = clamp((c.b - c.r) / max(1e-4, c.b), 0.0, 1.0);
  vec3 g = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  float mxg = max(g.r, max(g.g, g.b));
  float chroma = (mxg - min(g.r, min(g.g, g.b))) / max(1e-4, mxg);
  float want = 1.0 + blueness * (DISP_BLUE - 1.0);
  float cap = chroma > 1e-4 ? DISP_BLUE_CAP / chroma : want;
  c = mix(vec3(luma), c, min(want, max(1.0, cap)));

  // 대비는 **휘도에만** 겁니다.
  //
  // 예전에는 clamp((c - 0.5) * DISP_CONTR + 0.5) 를 채널마다 따로 걸었습니다.
  // 0.5 를 중심으로 채널을 각각 벌리면 밝은 채널은 더 밝아지고 어두운 채널은
  // 더 어두워지므로 **채도가 같이 올라갑니다** — 톤 커브가 색까지 건드린
  // 것입니다. 노을이 원색으로 뜨던 원인의 절반이 여기였습니다(계획 20절).
  //
  // 휘도만 옮기고 그 비율로 세 채널을 같이 곱하면 색상·채도는 정확히
  // 그대로고 밝기 관계만 바뀝니다. 사용자가 꼽은 "지평선쪽만 빛나면서"
  // (명암폭)와 깊은 황혼에 저층이 꺼지는 것은 둘 다 **휘도** 현상이라
  // 그대로 남습니다.
  //
  // ⚠ **대비 곡선은 0 과 1 을 지나는 S 자입니다.** 예전 직선 (l0 − 0.5)·C + 0.5 는 C = 1.06 에서
  //   l0 < 0.028(sRGB 약 46/255)을 **전부 0 으로 잘랐습니다.** 해 −8° 박명(7.9)은 문턱 바로 위라
  //   살고 −9° 는 0.4 로 새카맣게 떨어졌습니다 — 선형 밝기는 1.5배밖에 안 줄었는데(3.9e−3 → 2.6e−3).
  //   흐린 보름밤·항해박명의 하늘과 별이 통째로 검던 것이 이것입니다(마쓰모토 2026-09-26,
  //   verify-night-cloudy). 가운데(0.5) 기울기는 그대로 C 라 낮 화면은 거의 같고, 어두운 쪽만
  //   잘리지 않고 0 으로 내려갑니다.
  float l0 = dot(c, LW);
  float l1 = l0 < 0.5
    ? 0.5 * pow(max(2.0 * l0, 0.0), DISP_CONTR)
    : 1.0 - 0.5 * pow(max(2.0 * (1.0 - l0), 0.0), DISP_CONTR);
  l1 = clamp(l1, 0.0, 1.0);
  // 배율이 채널을 천장 위로 밀면 그 채널만 잘려 색이 밀립니다 — 방금 없앤
  // 것과 같은 종류의 결함입니다. 밝은 화소에서는 배율을 천장에 맞춰 깎아
  // 잘림 자체를 만들지 않습니다(하이라이트 롤오프).
  float maxc = max(c.r, max(c.g, c.b));
  float k = min(l1 / max(1e-4, l0), 1.0 / max(1e-4, maxc));
  c = clamp(c * k, 0.0, 1.0);
  return atm_toSrgb(atm_rodVision(c, sunAltDeg));
}
`;

// ── 개발자 튜닝 uniform ─────────────────────────────────────────────────────
//
// 위 GLSL에서 `uniform float`로 선언한 값들입니다. ATMOSPHERE_GLSL을 포함하는
// 머티리얼은 전부 이 선언을 함께 받으므로, 여기 한 곳에서 만들고 밀어 넣으면
// 스카이돔·태양·구름·덱이 같은 값을 씁니다.
//
// 셰이더가 안 쓰는 uniform은 GLSL 컴파일러가 지우고 three가 조용히 건너뜁니다.

/** 머티리얼 생성 시 uniforms에 펼쳐 넣습니다. */
/**
 * **지면·수면용 표시 변환.**
 *
 * 하늘의 `atm_display` 와 같은 톤매핑·순응을 쓰되, 지면에만 필요한 두 가지가
 * 더 있습니다:
 *
 * - `eyeAdapt` — 해가 지면 눈이 어두운 지면 쪽으로 더 순응합니다. 이게 없으면
 *   노을에 지면이 검은 띠가 됩니다.
 * - `minGlow` — 노을·야간에 지면이 완전히 뭉개지지 않게 하는 최소 밝기.
 *
 * ⚠ 이 함수는 `TerrainRing` 의 두 셰이더에 **복사되어** 있었습니다. 값은 같고
 * 주석 한 줄만 달랐는데, 그대로 뒀으면 언젠가 갈라졌을 자리입니다 (44절이
 * 정확히 그렇게 났습니다). 지면·수면·높이장이 전부 여기 하나를 씁니다.
 *
 * `ATMOSPHERE_GLSL` 이 먼저 들어가 있어야 합니다.
 */
export const GROUND_DISPLAY_GLSL = /* glsl */ `
uniform float GROUND_MIN_GLOW;   // 최소 밝기 바닥의 배율 (0 이면 바닥 없음)

/**
 * 지면용 **눈 순응** 배수 (1 ~ 3).
 *
 * 해가 지면 눈이 어두운 지면 쪽으로 순응합니다 — 이게 없으면 노을에
 * 지면이 검은 띠가 됩니다. 하늘 표시(atm_display)에는 없는 항입니다.
 *
 * ⚠ 지면이 **아닌** 것을 이 함수로 표시할 때는 이 배수를 미리 나눠야
 * 합니다. 수면의 하늘 되비침이 그렇습니다 — 거울인데 지면용 순응을
 * 그대로 먹어 **제가 비추는 하늘보다 1.20배 밝아졌습니다**(측정).
 */
float atm_groundEyeAdapt(float sunAltDeg) {
  return 1.0 + 2.0 * smoothstep(18.0, -3.0, sunAltDeg);
}

vec3 atm_display_ground(vec3 radiance, float saturation, float sunAltDeg) {
  vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  float adapt = atm_adaptation(sunAltDeg);
  float eyeAdapt = atm_groundEyeAdapt(sunAltDeg);
  vec3 hdr = radiance * DISP_EXPO * adapt * eyeAdapt * atm_whiteBalance(sunAltDeg);
  vec3 c = TONEMAP > 0.5 ? atm_tonemapAgX(hdr) : atm_tonemapACES(hdr);
  float luma = dot(c, LW);
  c = mix(vec3(luma), c, DISP_SAT * saturation);

  float l0 = dot(c, LW);
  float l1 = pow(max(1e-4, l0), 0.92);
  float maxc = max(c.r, max(c.g, c.b));
  float k = min(l1 / max(1e-4, l0), 1.0 / max(1e-4, maxc));
  c = clamp(c * k, 0.0, 1.0);

  // ── 노을·야간 최소 가시성 ────────────────────────────────────────────────
  //
  // ⚠ 이건 **바닥**입니다. 이보다 어두운 것은 전부 한 색으로 뭉갭니다.
  // 어두운 장면에서 지형 음영을 지우는 게 아닌지 의심해 들어 올려 봤지만, 앱이 실제로 쓰는 조도(해 1° 에서 하늘 0.18, 눈 순응
  // ×16)로 재 보니 지형 밝기가 155 라 **바닥(54)이 애초에 안 물립니다.**
  // 근거 없이 튜닝된 상수를 건드리지 않으려고 원래대로 두고, 껐다 켜는
  // 유니폼만 남깁니다(판정이 씁니다).
  vec3 minGlow = mix(vec3(0.048, 0.035, 0.028), vec3(0.028, 0.038, 0.058), clamp((sunAltDeg + 6.0) / 16.0, 0.0, 1.0));
  // ⚠ 밤에는 이 바닥을 걷습니다(해 −4° → −10°). 하늘이 대비 곡선에 잘려 새카맣던 동안에는 이 바닥
  //   덕에 지형이 보였지만, 하늘이 제대로 나오자 반사율 0.2 인 땅이 박명·달빛 하늘보다 두 배 밝게
  //   떴습니다(마쓰모토 18:11, verify-night-cloudy). 밤의 땅은 위의 물리값(대기광·달빛)이 맡습니다.
  float glowFade = smoothstep(-10.0, -4.0, sunAltDeg);
  c = max(c, minGlow * GROUND_MIN_GLOW * glowFade);

  return atm_toSrgb(atm_rodVision(c, sunAltDeg));
}
`;

/**
 * 그 자리의 광공해(0 청정 ~ 1 대도시) — §95. 도시 불빛이 밝은 곳에서는 눈이 간상체
 * 순응까지 가지 못하므로, 밤 암순응 배율을 이만큼 1 쪽으로 되돌립니다. 앱은 구름 슬랩에
 * 넘기는 `cityLight` 와 같은 값을 매 프레임 넣습니다.
 */
let sceneCityLight = 0;
export function setSceneCityLight(v: number): void {
  sceneCityLight = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}
const rodGainOf = (t: { rodAdaptGain: number }) =>
  t.rodAdaptGain + (1 - t.rodAdaptGain) * sceneCityLight;

export function makeTuningUniforms(): Record<string, { value: number }> {
  const t = getTuning();
  return {
    SKY_EXPOSURE: { value: t.skyExposure },
    CLOUD_DIM_DESAT: { value: t.cloudDimDesat },
    CLOUD_DIM_FLOOR: { value: t.cloudDimFloor },
    DISP_EXPO: { value: t.displayExposure },
    ADAPT_MAX: { value: t.adaptMax },
    ADAPT_HI: { value: t.adaptStartAlt },
    ADAPT_LO: { value: t.adaptEndAlt },
    ADAPT_ROD: { value: rodGainOf(t) },
    ROD_DESAT: { value: t.rodDesat },
    DISP_SAT: { value: t.displaySaturation },
    DISP_CONTR: { value: t.displayContrast },
    AIR_WASH: { value: t.airWash },
    SLAB_FBM_GAIN: { value: t.fbmGain },
    SLAB_RELIEF_EPS: { value: t.reliefEps },
    SH_ZENITH: { value: t.scatterHeightZenith },
    SH_KNEE: { value: t.scatterHeightKneeDeg },
    MS_AM_FRAC: { value: t.msAirmassFrac },
    MS_AM_CAP: { value: t.msAirmassCap },
    MS_AZIM_WASH: { value: t.msAzimWash },
    MS_GAIN: { value: t.msGain },
    TW_SCALE_H: { value: t.twilightScaleKm },
    TW_MS_SCALE: { value: t.twilightMsScaleKm },
    TW_TINT: { value: t.twilightTint },
    OZ_TW_GAIN: { value: t.ozoneTwilightGain },
    DISP_BLUE: { value: t.skyBlueBoost },
    DISP_BLUE_CAP: { value: t.skyBlueCap },
    DISP_WB: { value: t.whiteBalanceDegree },
    TONEMAP: { value: t.tonemap === 'agx' ? 1 : 0 },
    // 지면 표시의 최소 밝기 바닥 배율. 판정이 0 으로 껐다 켭니다.
    GROUND_MIN_GLOW: { value: 1 },
  };
}

/** 매 프레임(또는 튜닝 변경 시) 값을 갱신합니다. */
export function applyTuningUniforms(uniforms: Record<string, any> | undefined | null): void {
  if (!uniforms) return;
  const t = getTuning();
  const set = (k: string, v: number) => { if (uniforms[k]) uniforms[k].value = v; };
  set('SKY_EXPOSURE', t.skyExposure);
  set('CLOUD_DIM_DESAT', t.cloudDimDesat);
  set('CLOUD_DIM_FLOOR', t.cloudDimFloor);
  set('DISP_EXPO', t.displayExposure);
  set('ADAPT_MAX', t.adaptMax);
  set('ADAPT_HI', t.adaptStartAlt);
  set('ADAPT_LO', t.adaptEndAlt);
  set('ADAPT_ROD', rodGainOf(t));
  set('ROD_DESAT', t.rodDesat);
  set('DISP_SAT', t.displaySaturation);
  set('DISP_CONTR', t.displayContrast);
  set('DISP_BLUE', t.skyBlueBoost);
  set('DISP_BLUE_CAP', t.skyBlueCap);
  set('DISP_WB', t.whiteBalanceDegree);
  set('AIR_WASH', t.airWash);
  set('SLAB_FBM_GAIN', t.fbmGain);
  set('SLAB_RELIEF_EPS', t.reliefEps);
  set('SH_ZENITH', t.scatterHeightZenith);
  set('SH_KNEE', t.scatterHeightKneeDeg);
  set('MS_AM_FRAC', t.msAirmassFrac);
  set('MS_AM_CAP', t.msAirmassCap);
  set('MS_AZIM_WASH', t.msAzimWash);
  set('MS_GAIN', t.msGain);
  set('TW_SCALE_H', t.twilightScaleKm);
  set('TW_MS_SCALE', t.twilightMsScaleKm);
  set('TW_TINT', t.twilightTint);
  set('OZ_TW_GAIN', t.ozoneTwilightGain);
  set('TONEMAP', t.tonemap === 'agx' ? 1 : 0);
}
