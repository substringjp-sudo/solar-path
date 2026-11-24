/**
 * liveScene.ts — 앱의 **지금 예보**로 볼륨 장면 입력을 만듭니다(§126 D2).
 *
 * 관측점·시각·캐시된 예보(CloudPathData)에서 그 시각의 관측점 구름(CloudData)을 뽑고, 예보 → 종류 규칙
 * (`cloudGenusForecast.ts`)으로 층별 종류를 정해 `VolumetricSceneInput` 으로 옮깁니다. 시험 화면과 (다음 단계)
 * 하늘 화면이 같은 함수를 씁니다.
 */
import { sunPosition } from '../../utils/solarPosition';
import { getInterpolatedWeather, PROFILE_LEVELS, THERMO_RH_LEVELS, type CloudData, type CloudPathData } from '../../utils/weather';
import { classifyGenus, type ForecastGenus, type GenusForecast } from '../../utils/cloudGenusForecast';
import { FALLBACK_ALT_KM, type ProfileLevel } from '../../utils/cloudProfile';
import { GENUS, type GenusKey } from './cloudGenus';
import { flowSeedOf, GENUS_FLOW } from './cloudFlow';
import { resolveLayerWinds } from '../../utils/skyColumn';
import { aerosolOpticsFromObs, hazeLayerRh } from '../../utils/sunVisibility';
import { cloudOpticalDepthFromDni } from '../../utils/dniOpticalDepth';
import { pickDni } from '../../utils/satelliteIrradiance';
import { clearSkyGHIMean } from '../../utils/satelliteBias';
import { DIFFUSE_G, DIFFUSE_G_ICE, DIFFUSE_K, diffuseTransmittance } from './cloudDiffuse';
import { applyMetarToObs, type MetarObs } from '../../utils/metar';
import type { HazeInput, VolumetricLayerInput, VolumetricSceneInput } from './volumetricScene';
import { GENUS_MICRO, lclBaseKm, particleCloudState, thermoAt, type ThermoInput } from './cloudPhysics';

/**
 * 예보 종류 → 렌더 종류. 아직 렌더에 없는 종류는 가장 가까운 것으로 물러나고(§126 D3 에서 채움),
 * null 은 takram 기본 잡음입니다.
 */
export function renderGenusFor(g: ForecastGenus | null): GenusKey | null {
  return g ?? null;   // §126 D3 부터 예보 종류와 렌더 종류가 같은 이름을 씁니다.
}
/** 적란운 꼭대기 높이(km, 해발) — 중위도 가을 권계면 근처. 아직 예보에서 받지 않아 상수입니다. */
export const CB_TOP_KM = 10;
export const CB_ANVIL_THICK_M = 1500;
/** §139.4 적운(cu) 층 두께 상한(m) — 세포 폭(≈ 1.4 km) 수준. 사용자 눈 판정: 뼈대 후보보다 K0 이 자연스럽고, 남은 결함은 세로로 늘어난 기둥. */
/**
 * §141 덩어리 가로 크기를 층 두께에 맞춤. 종류별 손값(GENUS.spacingKm 또는 생성기 기본값)은 기준 두께(GENUS.height)에서 사진으로 고른
 * 것이라, 예보 덱이 더 두꺼우면 같은 폭의 덩어리를 위로 늘린 꼴이 되어 비스듬히 올려다볼 때 '기둥·버섯'으로 읽힙니다(기기 캡처 10/16
 * 13:33: sc 1.07 km). 두께는 예보값 그대로 두고 칸 간격을 두께 비례로 키웁니다(폭:높이 비 유지). §139.4 의 cu 두께 상한은 이것으로 대체.
 */
const DEFAULT_SPACING_KM: Partial<Record<GenusKey, number>> = { cu: 2.4, sc: 1.8 };
export const aspectSpacingKm = (g: GenusKey, thicknessM: number): number | undefined => {
  const base = GENUS[g].spacingKm ?? DEFAULT_SPACING_KM[g];
  const ref = GENUS[g].height;
  if (base == null || !ref || !(thicknessM > 0)) return undefined;
  return base * clamp(thicknessM / ref, 0.5, 4);
};

/** CloudData 의 기압면 단면 → ProfileLevel[] (PROFILE_LEVELS 순서) */
export function profileOf(obs: CloudData): ProfileLevel[] {
  const hs = obs.profileHeightM, cs = obs.profileCoverPct;
  if (!hs || !cs) return [];
  const out: ProfileLevel[] = [];
  for (let i = 0; i < Math.min(hs.length, cs.length, PROFILE_LEVELS.length); i++) {
    if (Number.isFinite(hs[i]) && Number.isFinite(cs[i])) out.push({ pressureHPa: PROFILE_LEVELS[i], heightM: hs[i], coverPct: cs[i] });
  }
  return out.sort((a, b) => a.heightM - b.heightM);
}

export interface LiveSceneArgs {
  lat: number; lon: number; heightM: number;
  date: Date;
  pathData?: CloudPathData[];
  /** 이미 보간된 관측점 구름(하늘 화면은 이것을 넘김). */
  obs?: CloudData | null;
  /** 이미 보간된 주변 좌표 구름 목록(SkyScene3D의 weatherRef.current). */
  interpolatedWeather?: CloudData[] | null;
  /** 시선 방위(°). 없으면 해 쪽. */
  az?: number;
  el?: number;
  fov?: number;
  altitudeM?: number;
  /** §160 가장 가까운 공항 METAR — 장면 시각이 보고 ±90 분·60 km 안이면 저층 운량·밑면·강수를 관측으로 바꿉니다. */
  metar?: MetarObs | null;
  /** 흐린 날 높이별 채우기(docs/WAVE_FIELD_DESIGN.md §9). 기본 켬 — 조건이 맞을 때만 저·중층을 파동 장 한 층으로 바꿉니다. */
  fill?: boolean;
}

/** 흐린 날 채우기 조건: 7.5 km 아래 기압면 운량 최대 80 % 이상 · 50 % 이상인 면 2 개 이상 · CAPE 300 미만(대류 날 아님). */
/**
 * 흐린 날 채우기 층의 소광 배율(2026-11-12). 난층운 값 0.28 을 빌려 쓰면 1~7 km 덱의 기둥 광학두께가 커서 두-흐름 확산광이 거의 0(덱 평균 43/255).
 * 0.02~0.04 에서 회색 덱(80~100/255) — 0.03.
 */
export /** 비구름 밑 조각구름(편운). 덱 아래 빛(cloudGenus §L4 gUnderJ)을 고친 뒤 켬 */
const FRACTUS_ON = true;
const FRACTUS_OPTS = { densityScale: 0.06, shapeAmount: 1, shapeDetailAmount: 1, edge: 1.2 } as const;
const FILL_DENSITY_SCALE = 0.03;

/**
 * 관측 일사로 흐린 날 덱의 기둥 광학두께(2026-11-12). 위성 GHI(직전 한 시간 평균을 보간한 값)를 같은 창의 맑은 하늘 GHI(Haurwitz)로 나눈
 * 투과율 T 를 두-흐름 T = 1/(1 + K(1−g)τ) 로 되짚음. 11월 8일 13:43 서울 비: 154/520 → T 0.30 → τ ≈ 21 (모형 기본값은 약 2 배 두꺼움).
 * 위성 값이 없거나(미래·결측) 해가 10° 아래면 null — 기본 밀도 그대로. τ 는 5~150 으로 자름.
 */
export function deckTauFromGhi(obs: CloudData, date: Date, lat: number, lon: number): { tau: number; T: number } | null {
  const ghi = obs.satShortwaveRadiation;
  if (ghi == null || !Number.isFinite(ghi)) return null;
  const cosZAt = (ms: number) => Math.sin(sunPosition(new Date(ms), lat, lon).altitude);
  if (cosZAt(date.getTime()) < Math.sin((10 * Math.PI) / 180)) return null;
  const clear = clearSkyGHIMean(date.getTime() + 30 * 60_000, cosZAt);
  if (!(clear > 50)) return null;
  const T = clamp(ghi / clear, 0.05, 0.9);
  const tau = clamp((1 / T - 1) / (DIFFUSE_K * (1 - DIFFUSE_G)), 5, 150);
  return { tau: Math.round(tau * 10) / 10, T: Math.round(T * 1000) / 1000 };
}

/**
 * 비구름 거칠기(2026-11-12). 매끈한 난층운 = 안정·약한 바람·구름 아래 포화, 거친 비구름 = 대류(CAPE·소나기)·센 바람(돌풍)·구름 아래 건조.
 *   conv = max(CAPE/600, 소나기 0/1) · wind = (돌풍 m/s − 8)/12(돌풍 없으면 저층 바람 × 1.3) · dry = (기온 − 이슬점 − 1.5)/5, 모두 0~1
 *   r = 1 − (1 − conv)(1 − 0.7·wind)(1 − 0.4·dry)
 */
export function rainRoughness(obs: CloudData, windLowKmh: [number, number]): { r: number; conv: number; wind: number; dry: number } {
  const c01 = (v: number) => Math.min(1, Math.max(0, v));
  const fin = (v: number | undefined): v is number => v != null && Number.isFinite(v);
  const conv = Math.max(fin(obs.capeJkg) ? c01(obs.capeJkg / 600) : 0, fin(obs.showers) && obs.showers >= 0.5 ? 1 : 0);
  const gustMs = fin(obs.gustKmh) ? obs.gustKmh / 3.6 : (Math.hypot(windLowKmh[0], windLowKmh[1]) / 3.6) * 1.3;
  const wind = c01((gustMs - 8) / 12);
  const dry = fin(obs.t2mC) && fin(obs.td2mC) ? c01((obs.t2mC - obs.td2mC - 1.5) / 5) : 0;
  const r = c01(1 - (1 - conv) * (1 - 0.7 * wind) * (1 - 0.4 * dry));
  return { r, conv, wind, dry };
}
export const FILL_RULE = { maxZ: 7500, peak: 80, wetPct: 50, wetLevels: 2, capeMax: 300 } as const;

const smooth01 = (v: number, e0: number, e1: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / Math.max(1e-6, e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * 대기 기둥의 습윤 포화도(강수 플럭스 · 상대습도 · 이슬점차 · 타층 습윤 중첩)로부터
 * NWP 부분 운량(rawPct)이 전천 과포화 시트(1.0)로 닫히는 연속 운량(0~1)을 계산합니다.
 * 조건문 분기 없이 관측점 레이어와 768 km 거시 고리(toMacroRing)에 동일하게 적용됩니다.
 */
export function closedBandCoverOf(
  rawPct: number,
  otherBandPct: number,
  precipMm = 0,
  rhPct = 70,
  dewSpreadC = Infinity,
  totalPct = 0,
): number {
  const c0 = Math.min(1, Math.max(0, rawPct / 100));
  if (c0 <= 0) return 0;
  const precipW = Math.min(1, Math.max(0, precipMm / 0.25));
  const rhW = smooth01(rhPct, 82, 97);
  const dewW = Number.isFinite(dewSpreadC) ? smooth01(3.2 - dewSpreadC, 0, 2.4) : 0;
  const multiW = Math.max(smooth01(otherBandPct, 50, 88), smooth01(totalPct, 90, 98));
  const wetSheetW = Math.min(1, Math.max(0, Math.max(precipW * 0.85, Math.max(rhW, dewW) * (0.45 + 0.55 * multiW) + 0.35 * precipW)));
  const closeW = Math.max(
    smooth01(rawPct, 92, 98),
    wetSheetW * smooth01(rawPct, 72, 86),
    precipW * smooth01(rawPct, 80, 91),
    smooth01(totalPct, 93, 99) * smooth01(rawPct, 84, 92) * (0.35 + 0.65 * Math.max(precipW, rhW)),
  );
  return c0 * (1 - closeW) + 1.0 * closeW;
}

/** 기압면 단면에서 높이별 운량(0~1)을 뽑습니다. 조건이 안 맞으면 null. */
export function fillProfileOf(obs: CloudData): { zM: number; cover: number }[] | null {
  const hs = obs.profileHeightM, cs = obs.profileCoverPct;
  if (!hs || !cs || hs.length !== cs.length) return null;
  const lv = hs.map((z, i) => ({ zM: z, c: cs[i] })).filter(q => Number.isFinite(q.zM) && Number.isFinite(q.c) && q.zM <= FILL_RULE.maxZ).sort((a, b) => a.zM - b.zM);
  if (!lv.length) return null;
  const precipW = Math.min(1, Math.max(0, (obs.precipitation ?? 0) / 0.1));
  const effLowPct = Math.max(obs.low ?? 0, ((obs.low ?? 0) >= 85 && (obs.total ?? 0) >= 93) ? 92 : (obs.low ?? 0));
  const lowCovW = smooth01(effLowPct, 78, 92);
  const rhW = smooth01(obs.humidity ?? 70, 82, 96);
  const wetSatW = Math.min(1, Math.max(0, precipW * lowCovW + 0.45 * rhW * lowCovW * precipW));
  // 습윤 종관 강수장(wetSatW -> 1)에서는 대류 불안정(CAPE)이 있어도 층상 비구름 덱이 공존하므로 대류 상한이 연속 확장됩니다.
  const effCapeMax = FILL_RULE.capeMax + 750 * wetSatW;
  if (obs.capeJkg != null && Number.isFinite(obs.capeJkg) && obs.capeJkg >= effCapeMax) return null;
  const minPeak = FILL_RULE.peak - (FILL_RULE.peak - FILL_RULE.wetPct) * wetSatW;
  const minWet = Math.max(1, Math.round(FILL_RULE.wetLevels - (FILL_RULE.wetLevels - 1) * wetSatW));
  const peak = Math.max(...lv.map(q => q.c)), wet = lv.filter(q => q.c >= FILL_RULE.wetPct).length;
  if (peak < minPeak || wet < minWet) return null;
  // 대기 습윤 포화도(wetSatW)와 기압면 운량(c)의 연속 결합으로 주요 습윤 고도가 빈틈없이 포화 시트로 수렴합니다.
  return lv.map(q => {
    const c = Math.round(Math.min(100, Math.max(0, q.c))) / 100;
    const liftW = wetSatW * smooth01(c, 0.38, 0.50);
    return { zM: Math.round(q.zM), cover: Math.round((c + (1 - c) * liftW) * 100) / 100 };
  });
}

export interface LiveScene {
  input: VolumetricSceneInput;
  forecast: GenusForecast | null;
  obs: CloudData | null;
  /** 시험 화면 표시용 한 줄 */
  summary: string;
  /** §158 DNI 광학두께(해 5° 아래·DNI 없음이면 null) — QR 장면 상태·캐시 키가 읽습니다(§165). */
  tauDni: number | null;
  /** 층별 종류 — §158 승격(ac → as, ci → cs)까지 적용한 **그려진** 종류. 예보 없음이면 null. */
  genus: { low: ForecastGenus | null; mid: ForecastGenus | null; high: ForecastGenus | null } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** §136 관측점 예보의 열역학 입력 → cloudPhysics 형식(기압면 높이·기온이 둘 다 있는 면만). */
/**
 * 층(zLo~zHi m, 해발)의 부력 진동수 N(1/s) — 기압면 기온으로 온위 θ = T·(1000/p)^0.286 을 만들고 N² = g/θ·dθ/dz.
 * 그 높이 범위를 걸치는 두 면(없으면 가장 가까운 두 면)으로. 0.002 눈금(날씨 캐시가 자주 안 바뀌게). 자료가 없으면 null.
 */
export function bruntN(th: ThermoInput, zLo: number, zHi: number): number | null {
  const lv = (th.levels ?? []).filter(l => Number.isFinite(l.zM) && Number.isFinite(l.tC) && l.pHPa > 0).sort((a, b) => a.zM - b.zM);
  if (lv.length < 2) return null;
  const mid = (zLo + zHi) / 2;
  let i = lv.findIndex(l => l.zM >= mid);
  if (i <= 0) i = i === 0 ? 1 : lv.length - 1;
  const a = lv[i - 1], b = lv[i];
  const th1 = (a.tC + 273.15) * Math.pow(1000 / a.pHPa, 0.286), th2 = (b.tC + 273.15) * Math.pow(1000 / b.pHPa, 0.286);
  const dz = b.zM - a.zM;
  if (!(dz > 50)) return null;
  const n2 = (9.81 / ((th1 + th2) / 2)) * ((th2 - th1) / dz);
  const n = Math.sqrt(Math.max(n2, 1e-6));
  return Math.round(n / 0.002) * 0.002;
}

export function thermoOf(obs: CloudData, groundM: number): ThermoInput {
  const hs = obs.profileHeightM, ts = obs.profileTempC;
  const levels: ThermoInput['levels'] = [];
  if (hs && ts) {
    for (let i = 0; i < Math.min(hs.length, ts.length, PROFILE_LEVELS.length); i++) {
      if (Number.isFinite(hs[i]) && Number.isFinite(ts[i])) levels.push({ zM: hs[i], tC: ts[i], pHPa: PROFILE_LEVELS[i] });
    }
  }
  // §139 뼈대 입력 — 경계층 높이·CAPE·영하고도·상대습도 단면(기압면 높이는 운량 단면의 같은 기압면에서)·850/600 바람(km/h → m/s)·강수.
  const rhLevels: NonNullable<ThermoInput['rhLevels']> = [];
  if (hs && obs.profileRhPct) {
    THERMO_RH_LEVELS.forEach((p, j) => {
      const i = (PROFILE_LEVELS as readonly number[]).indexOf(p), rh = obs.profileRhPct![j];
      if (i >= 0 && Number.isFinite(hs[i]) && Number.isFinite(rh)) rhLevels.push({ zM: hs[i], rhPct: rh });
    });
  }
  const mps = (u?: number, v?: number): [number, number] | undefined => (u != null && v != null && Number.isFinite(u) && Number.isFinite(v) ? [u / 3.6, v / 3.6] : undefined);
  return {
    groundM, t2mC: obs.t2mC, td2mC: obs.td2mC, levels,
    pblM: obs.pblM, capeJkg: obs.capeJkg, freezingLevelM: obs.freezingLevelM, rhLevels: rhLevels.length ? rhLevels : undefined,
    windLowMps: mps(obs.windULow, obs.windVLow), windMidMps: mps(obs.windUMid, obs.windVMid), precipMm: obs.precipitation,
  };
}

import { buildMacroWeatherField } from '../../utils/macroWeatherField';
import { dropSeamCopies } from '../../utils/macroField';

/**
 * §146 예보의 에어로졸 → 연무 입력. 대기 표(takram)에는 에어로졸이 거의 없으므로 모형의 기준(HAZE_BACKGROUND_AOD, 사진으로 맞춘 노출·색이
 * 이미 전제한 깨끗한 날 값)을 넘는 만큼만 더합니다. AOD(CAMS)가 없으면 PM, 그것도 없으면 시정으로 환산합니다.
 * 초미세먼지 비중(PM2.5/PM10)이 클수록 Ångström 지수가 크고(푸른빛 산란 → 해가 붉고 하늘이 누런 회색) 앞산란이 약하며,
 * 먼지·조대 입자가 많으면 지수가 작고(하얗게 흐림) 해 둘레가 넓게 번집니다.
 */
export const HAZE_BACKGROUND_AOD = 0.12;
/** 습한 막 문턱: 역전층 아래 습도, 그 위 마른 공기, 막을 켜는 최소 연직 광학두께, 해 둘레 구름이 이미 해를 가린다고 볼 운량. */
/** 적운 그리기 두께 상한(m) */
export const CU_MAX_THICK_M = 1500;
export const MIST_RH_MOIST = 75;
export const MIST_RH_DRY = 50;
export const MIST_MIN_TAU = 0.1;
export const MIST_TAU_PER_DENSITY_KM = 670;
/**
 * 역전층 아래 습한 층(지면 위 2.5 km 안) + 직달일사 감소 → 하늘을 덮는 얇은 층운 막. 없으면 null.
 * - 꼭대기: 지면 위 가장 낮은 기압면부터 습도 ≥ MIST_RH_MOIST 가 이어지다 습도 < MIST_RH_DRY 로 30 %p 넘게 뚝 떨어지는 곳(두 면 가운데).
 * - 두께: 직달일사(위성 > 예보)를 배경 에어로졸(0.12)만 있는 맑은 하늘과 견준 기울기 τ × sin(해 고도) = 연직 τ. 해가 5° 아래면 null.
 * - 중층 30 %·상층 50 % 이상이면 직달일사 감소를 그 구름 몫으로 보고 끔. 저층 60 % 이상이면 저층 구름이 맡으므로 끔.
 * densityScale = τ / (MIST_TAU_PER_DENSITY_KM × 두께 km) — 층운(st)은 cs 의 τ ≈ 57 × densityScale 보다 훨씬 짙어 따로 잼:
 *   하네스 수원 11:52(두께 1,219 m, 해 34.5°) densityScale 0.0007 에서 해 쪽 불투명도 0.635 → 기울기 τ 1.01 → 연직 τ 0.57 → 670/km.
 */
export function mistLayerOf(thermo: ThermoInput, groundM: number, obs: CloudData, sunAltDeg: number, dni: number | undefined):
  { baseKm: number; thicknessM: number; densityScale: number; tau: number; topAglM: number } | null {
  if ((obs.mid ?? 0) >= 30 || (obs.high ?? 0) >= 50 || (obs.low ?? 0) >= 60) return null;
  const rl = (thermo.rhLevels ?? []).filter(q => q.zM > groundM + 20).sort((p, q) => p.zM - q.zM);
  if (rl.length < 2 || rl[0].rhPct < MIST_RH_MOIST) return null;
  let topM: number | null = null;
  for (let i = 1; i < rl.length; i++) {
    if (rl[i].zM - groundM > 2500) break;
    if (rl[i].rhPct >= MIST_RH_MOIST) continue;
    if (rl[i].rhPct < MIST_RH_DRY && rl[i - 1].rhPct - rl[i].rhPct >= 30) topM = (rl[i - 1].zM + rl[i].zM) / 2;
    break;
  }
  if (topM == null) return null;
  const tauSlant = cloudOpticalDepthFromDni(dni, sunAltDeg);
  if (tauSlant == null) return null;
  const tau = Math.min(6, tauSlant * Math.sin((sunAltDeg * Math.PI) / 180));
  if (tau < MIST_MIN_TAU) return null;
  const baseM = groundM + 50;
  const thicknessM = Math.max(200, topM - baseM);
  return { baseKm: baseM / 1000, thicknessM, densityScale: tau / (MIST_TAU_PER_DENSITY_KM * (thicknessM / 1000)), tau, topAglM: topM - groundM };
}

/** §158 DNI 광학두께 문턱: 이 위면 상층 100 % 를 권운이 아닌 시트(cs)로, 더 두꺼우면 중층도 고층운(as)으로. */
export const DNI_VEIL_TAU = 1.5;
export const DNI_SHEET_TAU = 3;
export const DNI_VEIL_MAX_DENSITY = 0.07;

export interface CirrusVeilInput {
  highPct: number;
  midPct?: number;
  lowPct?: number;
  shearU?: number;
  shearV?: number;
  rhLevels?: { zM: number; rhPct: number }[];
  tauDni?: number | null;
  thicknessM?: number;
}

/**
 * 상층 기상 상태(상층 운량 · 상-중층 연직 시어 · 상층 습도 · 약한 직달일사 감쇠 τ)로부터
 * 권운(가닥) ↔ 빙정 베일 연속 전이 손잡이(flowVeil, 단면, 순위 감마, 소광)를 산출합니다.
 * flowVeil 은 시간 스크럽 캐시 안정을 위해 0.1 눈금으로 양자화합니다.
 */
export function cirrusVeilKnobs(i: CirrusVeilInput) {
  const highPct = clamp(i.highPct, 0, 100);
  const midPct = clamp(i.midPct ?? 0, 0, 100);
  const lowPct = clamp(i.lowPct ?? 0, 0, 100);
  const cover = highPct / 100;
  const coverVeil = clamp((cover - 0.35) / 0.55, 0, 1) * 0.85;
  const upperRh = (i.rhLevels ?? []).filter(q => q.zM >= 6000 && Number.isFinite(q.rhPct));
  const maxUpperRh = upperRh.length ? Math.max(...upperRh.map(q => q.rhPct)) : null;
  // 얼음 포화수증기압은 물보다 낮아 상층 물 기준 상대습도 50~80% 구간에서 빙정 베일이 급격히 퍼집니다.
  const rhBonus = maxUpperRh != null ? clamp((maxUpperRh - 50) / 30, 0, 1) * 0.15 : 0;
  const shearMps = Math.hypot(i.shearU ?? 0, i.shearV ?? 0) / 3.6;
  const shearDamp = clamp((shearMps - 6) / 10, 0, 1) * 0.2;
  const highShare = highPct / Math.max(1, highPct + midPct + lowPct);
  const tauDni = i.tauDni != null && Number.isFinite(i.tauDni) ? i.tauDni : null;
  const tauVeil = tauDni != null && tauDni > 0.05 ? clamp(tauDni / DNI_VEIL_TAU, 0, 1) * 0.3 * highShare : 0;
  const flowVeil = Math.round(clamp(coverVeil + rhBonus + tauVeil - shearDamp, 0, 1.0) * 10) / 10;

  const q1 = (v: number) => Math.round(v * 10) / 10;
  const q2 = (v: number) => Math.round(v * 100) / 100;
  const refThick = i.thicknessM ?? 800;
  const baseDensity = (0.003 + 0.0022 * flowVeil) * (800 / refThick);
  const tauDensity = tauDni != null && tauDni > 0.05
    ? ((tauDni * highShare) / 57) * (1000 / (i.thicknessM ?? 1000))
    : 0;
  const densityScale = Math.round(Math.min(DNI_VEIL_MAX_DENSITY, Math.max(baseDensity, tauDensity)) * 1e4) / 1e4;

  return {
    flowLaminar: 1,
    flowVeil,
    flowMode: 1,
    flowTop: q1(1.0 + 1.4 * flowVeil),
    flowDPow: q1(1.6 - 0.75 * flowVeil),
    densPow: q2(0.95 - 0.45 * flowVeil),
    flowEdge: q1(1.3 + 0.5 * flowVeil),
    flowTilt: q1(0.8 - 0.55 * flowVeil),
    flowErode: q2(0.32 - 0.06 * flowVeil),
    ao: q1(1.5 * flowVeil),
    densityScale,
  };
}
export function hazeFromObs(o: { aod550?: number; pm25?: number; pm10?: number; dust?: number; visibility?: number; humidity?: number; profileRhPct?: number[]; precipitation?: number; t2mC?: number; td2mC?: number; freezingLevelM?: number }): HazeInput | undefined {
  const op = aerosolOpticsFromObs(o);
  if (!op) return undefined;
  const rh = clamp(hazeLayerRh(o) ?? o.humidity ?? 50, 0, 98);
  // 맑고 시정이 30~60km 인 날에도 해안·저층 수증기/해염에 의한 옅은 지평선 글로우(0.015~0.035 AOD)가 남도록 바닥을 부드럽게 둡니다.
  const rhFloor = rh >= 40 ? 0.015 + 0.02 * ((rh - 40) / 55) : 0.01;
  const precip = Math.max(0, o.precipitation ?? 0);
  // 1) 눈·진눈깨비(지상 기온 <= 2.5°C 또는 영하고도 <= 650m): 낙하하는 눈송이·빙정의 기하광학 산란
  const coldSnowFrac = precip > 0
    ? clamp(
        Math.max(
          o.t2mC != null && Number.isFinite(o.t2mC) ? (2.5 - o.t2mC) / 4.5 : 0,
          o.freezingLevelM != null && Number.isFinite(o.freezingLevelM) ? (650 - o.freezingLevelM) / 550 : 0,
        ),
        0,
        1,
      ) * (1 - Math.exp(-precip / 0.15))
    : 0;
  const snowExtra = coldSnowFrac * clamp(precip / 0.8, 0.15, 1.0) * 0.75;
  // 2) 액체 강수 샤프트(Marshall-Palmer β_rain ∝ R^0.75) 및 구름 밑 증발 포화 수막(Virga / Pannus / Sub-cloud mist):
  //    비는 미세먼지 에어로졸을 세정하지만, 동시에 낙하 빗방울과 포화된 하층 습윤 수막이 파장 중립(회백색) 소광을 더해 구름 틈의 파란 하늘 노출을 가립니다.
  const warmRainDrive = (1 - coldSnowFrac) * (1 - Math.exp(-precip / 0.45));
  const dewSpread = o.t2mC != null && o.td2mC != null && Number.isFinite(o.t2mC - o.td2mC) ? Math.max(0, o.t2mC - o.td2mC) : Infinity;
  const subCloudSat = Math.max(smooth01(rh, 85, 97), Number.isFinite(dewSpread) ? smooth01(2.2 - dewSpread, 0, 1.8) : 0);
  const rainMistExtra = warmRainDrive * (0.18 + 0.34 * clamp(Math.pow(precip, 0.72) / 2.4, 0, 1)) + subCloudSat * (0.04 + 0.14 * warmRainDrive);
  const hydrometeorW = clamp(coldSnowFrac + 0.85 * warmRainDrive + 0.45 * subCloudSat * warmRainDrive, 0, 1);
  const extra = Math.max(op.aod - HAZE_BACKGROUND_AOD, op.aod >= 0.05 ? rhFloor : 0) + snowExtra + rainMistExtra;
  if (extra < 0.01) return undefined;
  const cap = precip >= 0.05 ? (0.65 + 0.75 * coldSnowFrac + 0.25 * warmRainDrive) : 3;
  // 빗방울·눈송이·구름 밑 수막(D >> λ)은 기하광학 Mie 산란이므로 파장 의존성(Ångström alpha)이 작아 하늘을 중성 회백색으로 뿌옇게 메웁니다.
  const alpha = op.alpha * (1 - 0.70 * hydrometeorW) + 0.20 * (0.70 * hydrometeorW);
  const g = op.g + (0.80 - op.g) * (0.65 * hydrometeorW);
  const omega = Math.max(op.omega, 0.98 * hydrometeorW);
  return { aod: Math.min(cap, extra), alpha, g, omega };
}

/**
 * 그날 지방 태양시 자정부터 장면 시각까지 층 바람(동·북 km/h)을 시간별 예보로 적분한 이동(km, 동·북). 관측점(거리가 가장 짧은 경로 점)의
 * 시간별 층 바람(windU·VLow/Mid/High)을 선형 보간해 10 분 걸음으로 더함. 그 시각 바람이 없으면 fallback(지금 바람)을 씀.
 * 시각이 바뀌어도 이동이 이어지므로 시간 막대를 움직이면 구름이 바람 따라 연속으로 흘러감.
 */
function integratedDriftKm(a: LiveSceneArgs, band: 'low' | 'mid' | 'high', fallback: [number, number]): [number, number] {
  const DAY = 86400000, t = a.date.getTime(), lonMs = (a.lon / 360) * DAY;
  const t0 = Math.floor((t + lonMs) / DAY) * DAY - lonMs;
  const pts = a.pathData ?? [];
  let obsPt = pts[0];
  for (const q of pts) if (Number.isFinite(q.distance) && (!obsPt || q.distance < obsPt.distance)) obsPt = q;
  const h = obsPt?.hourly;
  const key = band === 'low' ? 'Low' : band === 'mid' ? 'Mid' : 'High';
  const us = h?.[`windU${key}` as const], vs = h?.[`windV${key}` as const], ts = h?.timeMs;
  const windAt = (tm: number): [number, number] => {
    if (!ts || !us || !vs || ts.length < 2) return fallback;
    let i = 0;
    while (i + 1 < ts.length && ts[i + 1] < tm) i++;
    if (i + 1 >= ts.length || tm < ts[0]) return fallback;
    const f = Math.min(1, Math.max(0, (tm - ts[i]) / Math.max(1, ts[i + 1] - ts[i])));
    const u = us[i] + (us[i + 1] - us[i]) * f, v = vs[i] + (vs[i + 1] - vs[i]) * f;
    return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : fallback;
  };
  const STEP = 600000;
  let x = 0, y = 0;
  for (let tm = t0; tm < t; tm += STEP) {
    const dt = Math.min(STEP, t - tm) / 3600000, [u, v] = windAt(tm + Math.min(STEP, t - tm) / 2);
    x += u * dt; y += v * dt;
  }
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

const macroKnotCache = new Map<string, Partial<Record<'low' | 'mid' | 'high', { distance: number; azimuthOffset: number; cover: number }[]>>>();
const MACRO_KNOT_CACHE_MAX = 24;

function toMacroRing(list: CloudData[]): Partial<Record<'low' | 'mid' | 'high', { distance: number; azimuthOffset: number; cover: number }[]>> | undefined {
  const ringPts = dropSeamCopies(list.filter(q => Number.isFinite(q.distance) && Number.isFinite(q.azimuthOffset)));
  if (ringPts.length < 20) return undefined;
  const dewOf = (q: CloudData) => (q.t2mC != null && q.td2mC != null && Number.isFinite(q.t2mC - q.td2mC) ? q.t2mC - q.td2mC : Infinity);
  return {
    low: ringPts.map(q => ({
      distance: q.distance ?? 0,
      azimuthOffset: q.azimuthOffset ?? 0,
      cover: closedBandCoverOf(q.low ?? 0, q.mid ?? 0, q.precipitation ?? 0, q.humidity ?? 70, dewOf(q), q.total ?? 0),
    })),
    mid: ringPts.map(q => ({
      distance: q.distance ?? 0,
      azimuthOffset: q.azimuthOffset ?? 0,
      cover: closedBandCoverOf(q.mid ?? 0, Math.max(q.low ?? 0, q.high ?? 0), q.precipitation ?? 0, q.humidity ?? 70, dewOf(q), q.total ?? 0),
    })),
    high: ringPts.map(q => ({ distance: q.distance ?? 0, azimuthOffset: q.azimuthOffset ?? 0, cover: Math.min(1, Math.max(0, (q.high ?? 0) / 100)) })),
  };
}

function getCachedMacroKnot(pathData: CloudPathData[], knotMs: number): Partial<Record<'low' | 'mid' | 'high', { distance: number; azimuthOffset: number; cover: number }[]>> | undefined {
  const p0 = pathData[0];
  const sig = `${pathData.length}|${p0?.hourly?.time?.[0] ?? ''}|${p0?.hourly?.low?.[0] ?? ''}|${p0?.hourly?.low?.[12] ?? ''}|${knotMs}`;
  const hit = macroKnotCache.get(sig);
  if (hit) {
    macroKnotCache.delete(sig);
    macroKnotCache.set(sig, hit);
    return hit;
  }
  const wx = getInterpolatedWeather(pathData, new Date(knotMs));
  const ring = toMacroRing(wx);
  if (ring) {
    macroKnotCache.set(sig, ring);
    if (macroKnotCache.size > MACRO_KNOT_CACHE_MAX) {
      const oldest = macroKnotCache.keys().next().value;
      if (oldest !== undefined) macroKnotCache.delete(oldest);
    }
  }
  return ring;
}

export function buildLiveScene(a: LiveSceneArgs): LiveScene {
  // §175 해 위치는 엔진(NOAA, solarPosition)으로 — 렌더(takram)와 0.003° 안. 예전 SunCalc 는 0.19~0.21° 높아 요약 패널·빔·τ 가 렌더와 어긋났음.
  const sun = sunPosition(a.date, a.lat, a.lon);
  const sunAz = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360;
  const sunAltDeg = (sun.altitude * 180) / Math.PI;
  const obsRaw = a.obs ?? (a.interpolatedWeather?.[0] ?? (a.pathData?.length ? getInterpolatedWeather(a.pathData, a.date)[0] ?? null : null));
  // §160 관측 덮어쓰기 1 — METAR(실링미터). 창 밖이면 null → 예보 그대로.
  const metarOv = obsRaw ? applyMetarToObs(obsRaw, a.metar, a.date.getTime(), a.heightM) : null;
  const obs = metarOv?.obs ?? obsRaw;
  const base: VolumetricSceneInput = {
    lat: a.lat, lon: a.lon, heightM: a.heightM, date: a.date,
    az: a.az ?? sunAz, el: a.el ?? 15, fov: a.fov ?? 60,
    altitudeM: a.altitudeM,
    layers: [],
  };
  if (!obs) return { input: base, forecast: null, obs: null, summary: '예보 없음', tauDni: null, genus: null };

  // §132 거시 상태장: 주변 10여개 좌표로부터 동서/남북 1차 운량 기울기와 해 방향 직달광 차폐율 계산
  const interpolatedList = (a.interpolatedWeather && a.interpolatedWeather.length > 1)
    ? a.interpolatedWeather
    : (a.pathData?.length ? getInterpolatedWeather(a.pathData, a.date) : [obs]);
  const macro = buildMacroWeatherField(dropSeamCopies(interpolatedList), sunAz, sunAltDeg);

  const forecast = classifyGenus({
    low: obs.low, mid: obs.mid, high: obs.high,
    profile: profileOf(obs), groundM: a.heightM,
    precipitationMm: obs.precipitation, humidityPct: obs.humidity,
    isDay: sunAltDeg > 0,
  });
  // 0 < 운량 < 20% 구간에서 classifyGenus 기본 문턱(minCover=20) 때문에 genus 가 null(takram 기본 잡음)로 빠져
  // 20% 경계를 넘을 때 구름 형태가 통째로 튀는 현상을 막기 위해 렌더용 보조 분류는 최소 운량 바닥을 20%로 올려 판정합니다.
  const renderForecast = classifyGenus({
    low: Math.max(obs.low, 20), mid: Math.max(obs.mid, 20), high: Math.max(obs.high, 20),
    profile: profileOf(obs), groundM: a.heightM,
    precipitationMm: obs.precipitation, humidityPct: obs.humidity,
    isDay: sunAltDeg > 0,
  });

  // §130 층별 바람(부는 방향 성분, km/h, 동·북) — 예보 기압면 바람(850/600/250 hPa)이 있으면 그것, 없으면 대용값(skyColumn).
  // 5 km/h 눈금, 전단 방향 10° 눈금으로 묶습니다 — 10분 예보 보간마다 날씨 타일(수 초)을 다시 만들지 않게. 흐름 시드는 자리·날짜 해시.
  const { winds } = resolveLayerWinds(obs);
  const q5 = (v: number) => Math.round(v / 5) * 5;
  const windOf = (band: 'low' | 'mid' | 'high'): [number, number] => {
    const u = band === 'low' ? obs.windULow : band === 'mid' ? obs.windUMid : obs.windUHigh;
    const v = band === 'low' ? obs.windVLow : band === 'mid' ? obs.windVMid : obs.windVHigh;
    if (u != null && v != null && Number.isFinite(u) && Number.isFinite(v)) return [u, v];
    const w = winds[band], to = ((w.bearingDeg + 180) * Math.PI) / 180;   // bearing 은 불어오는 쪽
    return [w.speedKmh * Math.sin(to), w.speedKmh * Math.cos(to)];
  };
  const W = { low: windOf('low'), mid: windOf('mid'), high: windOf('high') };
  const ptsAll = a.pathData ?? [];
  let obsPt = ptsAll[0];
  for (const q of ptsAll) if (Number.isFinite(q.distance) && (!obsPt || q.distance < obsPt.distance)) obsPt = q;
  const DAY = 86400000, lonMs = (a.lon / 360) * DAY;
  const dayT0 = Math.floor((a.date.getTime() + lonMs) / DAY) * DAY - lonMs;
  const dayT1 = dayT0 + DAY;

  const dayWindOf = (band: 'low' | 'mid' | 'high'): [number, number] | null => {
    if (!ptsAll.length) return null;
    const h = obsPt?.hourly;
    const ts = h?.timeMs;
    const key = band === 'low' ? 'Low' : band === 'mid' ? 'Mid' : 'High';
    const us = h?.[`windU${key}` as const], vs = h?.[`windV${key}` as const];
    if (!ts || !us || !vs || ts.length === 0) return null;
    let su = 0, sv = 0, cnt = 0;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] >= dayT0 && ts[i] <= dayT1 && Number.isFinite(us[i]) && Number.isFinite(vs[i])) {
        su += us[i]; sv += vs[i]; cnt++;
      }
    }
    if (cnt === 0) {
      for (let i = 0; i < ts.length; i++) {
        if (Number.isFinite(us[i]) && Number.isFinite(vs[i])) {
          su += us[i]; sv += vs[i]; cnt++;
        }
      }
    }
    return cnt > 0 ? [su / cnt, sv / cnt] : null;
  };
  const dLow = dayWindOf('low'), dMid = dayWindOf('mid'), dHigh = dayWindOf('high');
  const hasDayWind = !!(dLow && dMid && dHigh);
  const Wpat = hasDayWind ? { low: dLow!, mid: dMid!, high: dHigh! } : W;

  // 하루 전체 고리 예보에서 띠별 최대 운량 상한과 주간 대표 대류/상층 상태를 구해,
  // 정시(13:00 등)를 넘을 때 2D 베이스 타일이 다른 문턱이나 종류(cu↔sc)로 재합성되어 구름 형태가 튀는 현상을 막습니다.
  const dayBandMax: Record<'low' | 'mid' | 'high', number> = { low: 0, mid: 0, high: 0 };
  if (ptsAll.length >= 20) {
    for (const p of ptsAll) {
      if (!Number.isFinite(p.distance) || (p.distance ?? 0) > 400) continue;
      const h = p.hourly;
      const ts = h?.timeMs;
      if (!h) continue;
      const n = ts?.length ?? h.low?.length ?? 0;
      for (let i = 0; i < n; i++) {
        if (ts && ts.length === n && (ts[i] < dayT0 - 3600000 || ts[i] > dayT1 + 3600000)) continue;
        const lv = (h.low?.[i] ?? 0) / 100;
        const mv = (h.mid?.[i] ?? 0) / 100;
        const hv = (h.high?.[i] ?? 0) / 100;
        if (lv > dayBandMax.low) dayBandMax.low = lv;
        if (mv > dayBandMax.mid) dayBandMax.mid = mv;
        if (hv > dayBandMax.high) dayBandMax.high = hv;
      }
    }
  }
  const envCoverOf = (m: number) => (m >= 0.82 ? Math.round((0.96 + 0.04 * smooth01(m, 0.82, 0.92)) * 100) / 100 : m >= 0.02 ? 0.96 : 0);
  const tileCoverEnvelope: Partial<Record<'low' | 'mid' | 'high', number>> | undefined = ptsAll.length >= 20 ? {
    low: envCoverOf(dayBandMax.low),
    mid: envCoverOf(dayBandMax.mid),
    high: envCoverOf(dayBandMax.high),
  } : undefined;

  const dayFairLowGenus = ((): 'cu' | 'sc' | null => {
    if (!hasDayWind || !obsPt?.hourly) return null;
    const h = obsPt.hourly;
    const ts = h.timeMs;
    const db = h.lowDeckBaseKm, dt = h.lowDeckTopKm;
    if (!ts || !db || !dt) return null;
    let sumLow = 0, cntLow = 0, sumThick = 0, cntThick = 0;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] < dayT0 + 8 * 3600000 || ts[i] > dayT0 + 18 * 3600000) continue;
      const c = h.low?.[i] ?? 0;
      if (c >= 5) { sumLow += c; cntLow++; }
      const b = db[i], t = dt[i];
      if (Number.isFinite(b) && Number.isFinite(t) && t > b) { sumThick += (t - b); cntThick++; }
    }
    if (cntLow === 0 || cntThick === 0) return null;
    return (sumLow / cntLow) < 55 && (sumThick / cntThick) >= 0.6 ? 'cu' : 'sc';
  })();

  const dayHighMeanPct = ((): number | null => {
    if (!hasDayWind || !obsPt?.hourly?.high) return null;
    const h = obsPt.hourly;
    const ts = h.timeMs;
    let s = 0, c = 0;
    for (let i = 0; i < h.high.length; i++) {
      if (ts && (ts[i] < dayT0 || ts[i] > dayT1)) continue;
      const v = h.high[i] ?? 0;
      if (v > 5) { s += v; c++; }
    }
    return c > 0 ? s / c : 50;
  })();

  const shearOf = (band: 'low' | 'mid' | 'high'): [number, number] => {
    const [au, av] = band === 'low' ? Wpat.mid : Wpat.high, [bu, bv] = band === 'low' ? Wpat.low : Wpat.mid;
    const su = au - bu, sv = av - bv, m = Math.hypot(su, sv);
    if (m < 1e-6) return [0, 0];
    const ang = ((Math.round((Math.atan2(su, sv) * 180) / Math.PI / 10) * 10) * Math.PI) / 180, mq = q5(m);
    return [mq * Math.sin(ang), mq * Math.cos(ang)];
  };
  // 2026-11-13 무늬 씨앗은 하루 하나(지방 태양시 자정에 바뀜) — 한 시간마다 바뀌면 시간 막대가 정시를 넘을 때마다 구름 배치가 통째로 새로 나왔음.
  // 운량·종류가 바뀌면 같은 무늬에서 문턱만 달라져 구름이 자라거나 줄어듦. 자리는 아래 driftKm(바람 적분)이 옮김.
  const flowSeed = flowSeedOf(a.lat, a.lon, a.date, 24);
  const driftKm = (band: 'low' | 'mid' | 'high'): [number, number] => {
    if (hasDayWind) {
      // setGenusDrift 가 q5(Wpat) 속도로 장면 시각 이후 드리프트를 외삽하므로, 자정(dayT0)부터 장면 시각까지의 누적 이동도
      // 동일한 q5(Wpat) 속도로 적분해야 장면 시각(버킷)이 바뀔 때 위상 단차(UV 점프)가 0이 됩니다.
      const dtH = (a.date.getTime() - dayT0) / 3600000;
      return [q5(Wpat[band][0]) * dtH, q5(Wpat[band][1]) * dtH];
    }
    return integratedDriftKm(a, band, W[band]);
  };
  const thermo = thermoOf(obs, a.heightM);
  const lowBaseEstM = Math.max(a.heightM + 300, (forecast.lowBaseKm ?? (obs.layerAltLowKm ?? FALLBACK_ALT_KM.low)) * 1000);
  const midBaseEstM = Math.max(a.heightM + 1000, (forecast.midBaseKm ?? (obs.layerAltMidKm ?? FALLBACK_ALT_KM.mid)) * 1000);
  const highBaseEstM = Math.max(7200, (forecast.highBaseKm ?? (obs.layerAltHighKm ?? FALLBACK_ALT_KM.high)) * 1000);
  const [shLowU, shLowV] = shearOf('low');
  const [shMidU, shMidV] = shearOf('mid');
  const [shHighU, shHighV] = shearOf('high');
  const pStateLow = particleCloudState({
    tCloudC: thermoAt(lowBaseEstM + 400, thermo).tC,
    t2mC: obs.t2mC,
    rhPct: obs.humidity ?? 75,
    precipMm: obs.precipitation ?? 0,
    windSpeedMps: Math.hypot(Wpat.low[0], Wpat.low[1]) / 3.6,
    shearPerSec: Math.hypot(shLowU, shLowV) / 3.6 / 2500,
    freezingLevelM: obs.freezingLevelM,
    cloudBaseM: lowBaseEstM,
  });
  const pStateMid = particleCloudState({
    tCloudC: thermoAt(midBaseEstM + 500, thermo).tC,
    t2mC: obs.t2mC,
    rhPct: obs.humidity ?? 70,
    precipMm: obs.precipitation ?? 0,
    windSpeedMps: Math.hypot(Wpat.mid[0], Wpat.mid[1]) / 3.6,
    shearPerSec: Math.hypot(shMidU, shMidV) / 3.6 / 3500,
    freezingLevelM: obs.freezingLevelM,
    cloudBaseM: midBaseEstM,
  });
  const pStateHigh = particleCloudState({
    tCloudC: thermoAt(highBaseEstM + 500, thermo).tC,
    t2mC: obs.t2mC,
    rhPct: Math.max(60, obs.humidity ?? 65),
    precipMm: 0,
    windSpeedMps: Math.hypot(Wpat.high[0], Wpat.high[1]) / 3.6,
    shearPerSec: Math.hypot(shHighU, shHighV) / 3.6 / 4000,
    freezingLevelM: obs.freezingLevelM,
    cloudBaseM: highBaseEstM,
  });

  const NBAND: Record<'low' | 'mid' | 'high', [number, number]> = { low: [1000, 2500], mid: [3000, 6000], high: [7000, 11000] };
  const flowOpts = (band: 'low' | 'mid' | 'high') => {
    const [u, v] = Wpat[band], [su, sv] = shearOf(band);
    const nB = !hasDayWind ? bruntN(thermo, NBAND[band][0], NBAND[band][1]) : (band === 'high' ? 0.014 : 0.012);
    const mGrad = macro[band];
    const pBand = band === 'low' ? pStateLow : band === 'mid' ? pStateMid : pStateHigh;
    return {
      windU: q5(u), windV: q5(v), shearU: su, shearV: sv, flowSeed,
      ...(nB != null ? { flowN: nB } : {}),
      ...(pBand && pBand.spectralSigmaKm > 0 ? { spectralSigmaKm: pBand.spectralSigmaKm } : {}),
      ...(pBand ? { flowLifeSec: pBand.lifeSec, effectiveG: pBand.effectiveG } : {}),
      ...(hasDayWind ? {
        shearDzKm: band === 'low' ? 2.5 : 4.0,
        flowCoreWindU: q5(Wpat.low[0]),
        flowCoreWindV: q5(Wpat.low[1]),
        flowCoreAniso: 1.0,
      } : {}),
      macroGradX: mGrad?.gradXPer100Km ?? 0,
      macroGradY: mGrad?.gradYPer100Km ?? 0,
      beamTransmittance: macro.beamTransmittance[band] ?? 1,
      sunGap: macro.sunGap,
    };
  };

  const layers: VolumetricLayerInput[] = [];
  // 2026-11-19 먼 구름만 있는 층(서울 일출: 관측점 저층 0~11 %, 동쪽 70~130 km 저층 47~76 %). 관측점 운량이 0 이면 레인이 없어
  // 테두리 덱(50~385 km)이 그 층을 아예 그리지 못했음 → 고리 400 km 안 상위 분위수(p90)가 15 % 이상이거나 하루 중 그 띠에 구름이 있으면 작은 운량 레인을 유지합니다.
  // 타일 운량은 volumetricScene 의 macroTileCover 가 고리 값으로 올리고, 가까운 하늘은 거시 문턱이 관측점 운량(≈0)으로 깎습니다.
  const farRing = interpolatedList.filter(q => Number.isFinite(q.distance) && (q.distance ?? 0) > 0 && (q.distance ?? 0) <= 400);
  const farCap = (band: 'low' | 'mid' | 'high') => {
    if (tileCoverEnvelope && (tileCoverEnvelope[band] ?? 0) > 0) return Math.max(0.2, tileCoverEnvelope[band]!);
    if (farRing.length < 12) return 0;
    const v = farRing.map(q => Math.min(100, Math.max(0, q[band] ?? 0)) / 100).sort((x, y) => x - y);
    return v[Math.min(v.length - 1, Math.floor(v.length * 0.9))];
  };
  const FAR_ONLY_MIN = 0.15, FAR_ONLY_COVER = 0.001;
  const farOnlyLayer = (band: 'low' | 'mid' | 'high'): VolumetricLayerInput | null => {
    if (farCap(band) < FAR_ONLY_MIN) return null;
    if (band === 'low') {
      const gLow = dayFairLowGenus ?? 'sc';
      const baseKm = Math.max(groundKm + 0.15, forecast.lowBaseKm ?? (obs.layerAltLowKm ?? FALLBACK_ALT_KM.low) - 0.3);
      return { genus: gLow, cover: FAR_ONLY_COVER, baseKm, thicknessM: 550, band, opts: { ...flowOpts('low'), tileGenus: gLow, spacingKm: aspectSpacingKm(gLow, 550) } };
    }
    if (band === 'mid') {
      const baseKm = Math.max(groundKm + 0.5, 2.2, forecast.midBaseKm ?? (obs.layerAltMidKm ?? FALLBACK_ALT_KM.mid) - 0.3);
      return { genus: 'ac', cover: FAR_ONLY_COVER, baseKm, band, opts: { ...flowOpts('mid'), tileGenus: 'ac' } };
    }
    const baseKm = Math.max(7.2, forecast.highBaseKm ?? (obs.layerAltHighKm ?? FALLBACK_ALT_KM.high) - 0.2);
    const baseOpts = flowOpts('high');
    const ciKnobs = dayHighMeanPct != null
      ? cirrusVeilKnobs({ highPct: dayHighMeanPct, midPct: 25, lowPct: 25, shearU: baseOpts.shearU, shearV: baseOpts.shearV, thicknessM: 1000 })
      : {};
    return { genus: 'ci', cover: FAR_ONLY_COVER, baseKm, band, opts: { ...baseOpts, ...ciKnobs, tileGenus: 'ci' } };
  };
  let anvil: VolumetricLayerInput | null = null;
  /**
   * §158 직달일사(DNI)가 말하는 구름 두께. 운량 규칙은 상층 100 % 를 얇은 권운으로, 중층을 고적운으로 그리는데 DNI 가 맑은 날의 5 % 아래면
   * (해가 가려짐) 그 층은 두꺼운 **시트**입니다 — 상층 ci → cs(소광을 τ 에 맞춤), 중층 ac → as. 10/24 서울 "상층 100 %·DNI 29 W/m²"
   * 가 맑게 그려진 일에서. 하네스로 잰 cs 소광 ↔ 아래에서 본 불투명도: τ_render ≈ 57 × densityScale(1000 m 층) → densityScale = τ/57.
   */
  // §160 관측 덮어쓰기 2 — 위성 관측 DNI 가 그 시각에 있으면 예보 DNI 대신(관측 없는 시각·밤·미래는 예보).
  const dniPick = pickDni(obs);
  const tauDni = cloudOpticalDepthFromDni(dniPick.dni, sunAltDeg, obs.aod550);
  const thickVeil = tauDni != null && tauDni >= DNI_VEIL_TAU;
  const promoteHigh = thickVeil && forecast.high === 'ci' && obs.high >= 80;
  // 상층이 두꺼운 시트를 다 맡으면 중층은 그대로; 상층이 모자라면(80 % 미만) 중층 50 % 이상을 고층운으로.
  const promoteMid = thickVeil && tauDni! >= DNI_SHEET_TAU && forecast.mid === 'ac' && obs.mid >= 50 && !(promoteHigh && obs.high >= 95);
  // §136 적운류 밑면 = 지면 + 응결고도(물리를 켰을 때만 volumetricScene 이 씀). 지상 이슬점이 없으면 없음.
  const lclKm = lclBaseKm(thermo);
  const groundKm = a.heightM / 1000;
  const rhAtGround = (() => {
    const rl = thermo.rhLevels;
    if (!rl?.length) return obs.humidity ?? 0;
    const sorted = [...rl].sort((p, q) => p.zM - q.zM);
    if (a.heightM <= sorted[0].zM) return Math.max(sorted[0].rhPct, obs.humidity ?? 0);
    for (let i = 1; i < sorted.length; i++) {
      if (a.heightM <= sorted[i].zM) {
        const span = Math.max(1, sorted[i].zM - sorted[i - 1].zM);
        const f = (a.heightM - sorted[i - 1].zM) / span;
        return sorted[i - 1].rhPct * (1 - f) + sorted[i].rhPct * f;
      }
    }
    return obs.humidity ?? sorted[sorted.length - 1].rhPct;
  })();
  const dewSpread = obs.t2mC != null && obs.td2mC != null ? obs.t2mC - obs.td2mC : Infinity;
  const inMountainCloud =
    forecast.lowBaseKm != null &&
    groundKm >= forecast.lowBaseKm - 0.05 &&
    (forecast.lowTopKm == null || groundKm <= forecast.lowTopKm) &&
    (rhAtGround >= 95 || dewSpread <= 1.5);
  const smoothStep01 = (v: number, e0: number, e1: number) => {
    const t = clamp((v - e0) / Math.max(1e-6, e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const q05 = (x: number) => Math.round(x * 20) / 20;
  // 저층: 단면 덱이 있으면 밑면·두께를 그대로, 없으면 층 높이(가운데)에서 두께의 반을 뺀 밑면.
  if (obs.low > 0) {
    const thick = forecast.lowBaseKm != null && forecast.lowTopKm != null ? (forecast.lowTopKm - forecast.lowBaseKm) * 1000 : NaN;
    let thicknessM = Number.isFinite(thick) ? clamp(thick, 300, 3000) : undefined;
    const centerKm = obs.layerAltLowKm ?? FALLBACK_ALT_KM.low;
    const minBaseKm = inMountainCloud ? Math.max(0, groundKm - 0.05) : groundKm + 0.15;
    const baseKm = Math.max(
      minBaseKm,
      forecast.lowBaseKm ?? centerKm - (thicknessM ?? 1200) / 2000,
    );
    const rawLowGenus = forecast.low ?? renderForecast.low ?? 'sc';
    const convCover = closedBandCoverOf(obs.low, obs.mid ?? 0, obs.precipitation ?? 0, obs.humidity ?? 75, dewSpread, obs.total ?? 0);
    const convSatW = smoothStep01(convCover, 0.78, 0.98);
    const convRainW = clamp((obs.precipitation ?? 0) / 0.25, 0, 1);
    const convSheetW = convSatW * Math.max(0.55 * convSatW, convRainW, pStateLow.largeDropFrac + pStateLow.snowFlakeFrac);
    const convFloor = q05(clamp(convSheetW * 0.36 + pStateLow.satFloor * convSatW, 0, 0.42));
    const convMode = q05(2.0 - 0.9 * convSheetW);
    if (rawLowGenus === 'cb') {
      // 적란운: 탑은 밑면~권계면 한 층, 모루는 4번째 채널에 같은 씨앗으로 — 바람 방향은 중층 바람.
      const topKm = Math.max(baseKm + 4, CB_TOP_KM);
      const windDeg = obs.windUMid != null && obs.windVMid != null ? ((Math.atan2(obs.windUMid, obs.windVMid) * 180) / Math.PI + 360) % 360 : 30;
      const opts = { seed: 7, windDeg, ...flowOpts('low'), flowMode: convMode, flowFloor: convFloor, powderWeight: pStateLow.powderScale, haloWeight: GENUS_MICRO.cbanvil.halo * pStateHigh.haloScale };
      layers.push({ genus: 'cb', cover: convCover, baseKm, thicknessM: (topKm - baseKm) * 1000, band: 'low', opts, physBaseKm: lclKm ?? undefined });
      anvil = { genus: 'cbanvil', cover: 1, baseKm: topKm - CB_ANVIL_THICK_M / 1000 * 0.8, thicknessM: CB_ANVIL_THICK_M, band: 'high', opts };
    } else if (rawLowGenus === 'cg') {
      layers.push({ genus: 'cg', cover: convCover, baseKm, thicknessM: Math.max(thicknessM ?? 0, 2500), band: 'low', opts: { ...flowOpts('low'), flowMode: convMode, flowFloor: convFloor, powderWeight: pStateLow.powderScale, haloWeight: 0 }, physBaseKm: lclKm ?? undefined });
    } else {
      const g = ((rawLowGenus === 'cu' || rawLowGenus === 'sc') && dayFairLowGenus ? dayFairLowGenus : renderGenusFor(rawLowGenus)) ?? 'sc';
      // ── 확장 2: 구름 종류(cu ↔ sc ↔ st/ns) 전환 경계의 연속 형태·단면·광학 보간 ──
      // 운량·두께·강수·입자 구성비로부터 대류성(convW: cu 쪽)과 층운/시트성(sheetW: st/ns 쪽)을 연속 가중치로 계산해,
      // 문턱(54→55% 등)을 넘을 때 단면·조명·결이 튀지 않고 2D 베이스 타일(tileGenus)도 하루 동안 재사용됩니다.
      const coverFrac = clamp(obs.low / 100, 0.05, 1);
      const rainWeight = clamp((obs.precipitation ?? 0) / 0.25, 0, 1);
      const capeW = obs.capeJkg != null && Number.isFinite(obs.capeJkg) ? smoothStep01(obs.capeJkg, 40, 500) : 0;
      const thickEstM = Number.isFinite(thick) ? thick : (g === 'cu' ? 900 : 650);
      const convW = clamp(
        (0.55 * smoothStep01(58, 25, obs.low) + 0.30 * smoothStep01(450, 1100, thickEstM) + 0.15 * capeW)
          * (1 - 0.75 * rainWeight) * (0.5 + 0.5 * pStateLow.smallDropFrac),
        0,
        1,
      );
      const rhSatW = Math.max(smoothStep01(rhAtGround, 83, 97), Number.isFinite(dewSpread) ? smoothStep01(2.8 - dewSpread, 0, 2.2) : 0);
      const sheetW = clamp(
        Math.max(
          smoothStep01(obs.low, 68, 94) * (0.45 + 0.55 * (1 - convW)),
          rainWeight * 0.8 + pStateLow.snowFlakeFrac * 0.75 + pStateLow.largeDropFrac * 0.45 + rhSatW * smoothStep01(obs.low, 72, 92) * 0.55,
        ),
        0,
        1,
      );
      const fairCapCu = 360 + 940 * Math.pow(coverFrac, 0.75);
      const fairCapSc = 320 + 680 * Math.pow(coverFrac, 0.75);
      const fairCapBlend = Math.round(((fairCapSc + (fairCapCu - fairCapSc) * convW) * (1 + 0.35 * sheetW)) / 50) * 50;
      if (g === 'cu' || g === 'sc') {
        thicknessM = thicknessM != null ? Math.min(thicknessM, fairCapBlend, CU_MAX_THICK_M) : fairCapBlend;
      }
      const tileGenusLow: GenusKey = hasDayWind ? (dayFairLowGenus ?? 'sc') : g;
      const spacingKm = aspectSpacingKm(tileGenusLow, thicknessM ?? GENUS[g].height);
      const closeWeight = Math.max(
        smoothStep01(obs.low, 92, 98),
        sheetW * smoothStep01(obs.low, 72, 86),
        rainWeight * smoothStep01(obs.low, 80, 91),
      );
      const lowCover = Math.max(
        (obs.low / 100) * (1 - closeWeight) + 1.0 * closeWeight,
        closedBandCoverOf(obs.low, obs.mid ?? 0, obs.precipitation ?? 0, rhAtGround, dewSpread, obs.total ?? 0),
      );

      // cu ↔ sc ↔ st/ns 단면·조명·흐름 결·과포화 바닥 연속 보간
      const lerp3 = (vCu: number, vSc: number, vSt: number) => {
        const cuSc = vSc + (vCu - vSc) * convW;
        return cuSc + (vSt - cuSc) * sheetW;
      };
      const lowSatClose = smoothStep01(lowCover, 0.75, 0.98);
      const lowFlowMode = q05(lerp3(2.0, 2.0 - 0.55 * lowSatClose, 1.0));
      const lowFlowFloor = q05(clamp(lowSatClose * (0.16 + 0.26 * sheetW) + pStateLow.satFloor * lowSatClose, 0, 0.45));
      const lowBase = q05(lerp3(GENUS.cu.base, GENUS.sc.base, 0.08));
      const lowTop = q05(lerp3(GENUS.cu.top, GENUS.sc.top, 1.8));
      const lowFlowTop = q05(lerp3(GENUS_FLOW.cu?.flowTop ?? 1.8, GENUS_FLOW.sc?.flowTop ?? 1.6, 2.2));
      const baseLowEdge = lerp3(GENUS.cu.edge, GENUS.sc.edge, 1.8);
      const lowEdge = q05(baseLowEdge * pStateLow.edgeScale);
      const lowAO = q05(lerp3(GENUS.cu.ao, GENUS.sc.ao, 3.2) * pStateLow.aoScale);
      const lowThru = q05(clamp(lerp3(0, 0, 0.65) + pStateLow.thruBoost, 0, 1));
      const lowDensPow = q05(lerp3(GENUS_FLOW.cu?.densPow ?? 0.8, GENUS_FLOW.sc?.densPow ?? 0.65, 0.55));
      const baseLowCarve = lerp3(GENUS_FLOW.cu?.flowCarve ?? 0.68, GENUS_FLOW.sc?.flowCarve ?? 0.55, 0.18);
      const lowCarve = q05(baseLowCarve * pStateLow.carveScale * (1 - 0.65 * sheetW));
      const baseLowWisp = lerp3(GENUS_FLOW.cu?.flowWisp ?? 0.5, GENUS_FLOW.sc?.flowWisp ?? 0.42, 0.32);
      const lowWisp = q05(clamp(baseLowWisp + pStateLow.wispBoost, 0, 1));
      const baseLowTilt = lerp3(GENUS_FLOW.cu?.flowTilt ?? 0.35, GENUS_FLOW.sc?.flowTilt ?? 0.2, 0.25);
      const lowTilt = q05(baseLowTilt + pStateLow.tiltBoost);

      layers.push({
        genus: g,
        cover: lowCover,
        baseKm,
        thicknessM,
        band: 'low',
        opts: {
          ...flowOpts('low'),
          tileGenus: tileGenusLow,
          flowMode: lowFlowMode,
          flowFloor: lowFlowFloor,
          base: lowBase,
          top: lowTop,
          flowTop: lowFlowTop,
          edge: lowEdge,
          flowEdge: lowEdge,
          ao: lowAO,
          thru: lowThru,
          densPow: lowDensPow,
          flowCarve: lowCarve,
          flowWisp: lowWisp,
          flowTilt: lowTilt,
          powderWeight: pStateLow.powderScale,
          haloWeight: 0,
          ...(spacingKm != null ? { spacingKm } : {}),
        },
        physBaseKm: g === 'cu' ? lclKm ?? undefined : undefined,
      });
    }
  } else layers.push(farOnlyLayer('low') ?? { genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.low, band: 'low' });
  // §165 중·상층 밑면·두께 — 단면 덱(반값 폭, `bandDeck`)이 있으면 저층과 같은 규칙(밑면 = 덱 밑면, 두께 = 덱 두께 300~3,000 m).
  // 없으면 예전대로: 밑면 = 운량 가중 평균 높이 − 0.3/0.2 km, 두께 = 종류 상수(GENUS.height).
  // 두께는 덱이 **두 면 이상**에 걸칠 때만 자료로 본다 — 한 면짜리 덱의 두께는 면 간격(700 → 600 hPa 1.2 km)의 산물이라, 얇은 고적운(상수 400 m)이
  // 1 km 덩어리로 두꺼워진다(검토 지적). 그때는 밑면만 덱에서 가져오고 두께는 종류 상수.
  const midDeckThick = forecast.midBaseKm != null && forecast.midTopKm != null && forecast.midDeckLevels >= 2 ? (forecast.midTopKm - forecast.midBaseKm) * 1000 : NaN;
  const midThicknessM = Number.isFinite(midDeckThick) ? clamp(midDeckThick, 300, 3000) : undefined;
  const highDeckThick = forecast.highBaseKm != null && forecast.highTopKm != null && forecast.highDeckLevels >= 2 ? (forecast.highTopKm - forecast.highBaseKm) * 1000 : NaN;
  const highThicknessM = Number.isFinite(highDeckThick) ? clamp(highDeckThick, 300, 3000) : undefined;
  if (obs.mid > 0) {
    const centerKm = obs.layerAltMidKm ?? FALLBACK_ALT_KM.mid;
    const midGenus = (promoteMid ? 'as' : renderGenusFor(forecast.mid ?? renderForecast.mid ?? 'ac')) ?? 'ac';
    const baseKm = Math.max(a.heightM / 1000 + 0.5, 2.2, forecast.midBaseKm ?? (centerKm - 0.3));
    // ── 확장 2: 중층 고적운(ac) ↔ 고층운(as) 전환 경계의 연속 형태·광학 블렌딩 ──
    const tauMidW = tauDni != null && !(promoteHigh && obs.high >= 95) ? smoothStep01(tauDni, 1.2, DNI_SHEET_TAU + 0.4) : 0;
    const coverMidW = smoothStep01(obs.mid, 52, 88);
    const iceMidW = clamp(pStateMid.snowFlakeFrac * 0.85 + pStateMid.iceCrystalFrac * 0.45, 0, 1);
    const midSheetW = clamp(
      midGenus === 'as'
        ? Math.max(0.65, 0.5 * coverMidW + 0.5 * Math.max(tauMidW, iceMidW))
        : 0.45 * coverMidW * Math.max(tauMidW, iceMidW * 0.8),
      0,
      1,
    );
    const lerpMid = (vAc: number, vAs: number) => vAc + (vAs - vAc) * midSheetW;
    const midTop = q05(lerpMid(GENUS.ac.top, GENUS.as.top));
    const midFlowTop = q05(lerpMid(GENUS_FLOW.ac?.flowTop ?? 1.5, 2.8));
    const baseMidEdge = lerpMid(GENUS.ac.edge, GENUS.as.edge);
    const midEdge = q05(baseMidEdge * pStateMid.edgeScale);
    const midAO = q05(lerpMid(GENUS.ac.ao, GENUS.as.ao) * pStateMid.aoScale);
    const midThru = q05(clamp(lerpMid(0, 1) + pStateMid.thruBoost * 0.6, 0, 1));
    const midDensPow = q05(lerpMid(GENUS_FLOW.ac?.densPow ?? 0.72, 0.55));
    const midCarve = q05(lerpMid(GENUS_FLOW.ac?.flowCarve ?? 0.45, 0.08) * pStateMid.carveScale);
    const midWisp = q05(clamp(lerpMid(GENUS_FLOW.ac?.flowWisp ?? 0.35, 0.25) + pStateMid.wispBoost, 0, 1));
    const midTilt = q05(lerpMid(GENUS_FLOW.ac?.flowTilt ?? 0.2, 0.25) + pStateMid.tiltBoost);
    const midCloseW = midSheetW * smoothStep01(obs.mid, 76, 92);
    const midCover = Math.max(
      (obs.mid / 100) * (1 - midCloseW) + Math.max(obs.mid / 100, 0.99) * midCloseW,
      closedBandCoverOf(obs.mid, Math.max(obs.low ?? 0, obs.high ?? 0), obs.precipitation ?? 0, obs.humidity ?? 70, dewSpread, obs.total ?? 0),
    );
    const midSatClose = smoothStep01(midCover, 0.78, 0.98);
    const midFlowFloor = q05(clamp(midSatClose * (0.14 + 0.20 * midSheetW) + pStateMid.satFloor * midSatClose, 0, 0.38));

    layers.push({
      genus: midGenus,
      cover: midCover,
      baseKm,
      thicknessM: midThicknessM,
      band: 'mid',
      opts: {
        ...flowOpts('mid'),
        tileGenus: 'ac',
        flowFloor: midFlowFloor,
        top: midTop,
        flowTop: midFlowTop,
        edge: midEdge,
        flowEdge: midEdge,
        ao: midAO,
        thru: midThru,
        densPow: midDensPow,
        flowCarve: midCarve,
        flowWisp: midWisp,
        flowTilt: midTilt,
        powderWeight: pStateMid.powderScale,
        haloWeight: Math.round(pStateMid.iceCrystalFrac * 0.35 * pStateMid.haloScale * 20) / 20,
      },
    });
  } else layers.push(farOnlyLayer('mid') ?? { genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.mid, band: 'mid' });
  if (obs.high > 0) {
    const centerKm = obs.layerAltHighKm ?? FALLBACK_ALT_KM.high;
    const baseKm = Math.max(7.2, forecast.highBaseKm ?? (centerKm - 0.2));
    const highGenus = (renderGenusFor(forecast.high ?? renderForecast.high ?? 'ci')) ?? 'ci';
    const baseOpts = flowOpts('high');
    const liveCiKnobs = highGenus === 'ci'
      ? cirrusVeilKnobs({
          highPct: obs.high,
          midPct: obs.mid ?? 0,
          lowPct: obs.low ?? 0,
          shearU: baseOpts.shearU,
          shearV: baseOpts.shearV,
          rhLevels: thermo.rhLevels,
          tauDni,
          thicknessM: highThicknessM,
        })
      : {};
    // 2D 타일 생성에 쓰이는 flowVeil·flowDPow 는 하루 평균 상층 운량으로 고정해 정시마다 타일이 재합성되지 않게 하고,
    // 셰이더 유니폼(densityScale·flowTop·flowEdge·densPow 등)은 실시간 보간 값을 그대로 반영합니다.
    const tileCiKnobs = highGenus === 'ci' && dayHighMeanPct != null
      ? cirrusVeilKnobs({
          highPct: dayHighMeanPct,
          midPct: 25,
          lowPct: 25,
          shearU: baseOpts.shearU,
          shearV: baseOpts.shearV,
          thicknessM: 1000,
        })
      : null;
    const ciKnobs = tileCiKnobs
      ? { ...liveCiKnobs, flowVeil: tileCiKnobs.flowVeil, flowDPow: tileCiKnobs.flowDPow }
      : liveCiKnobs;
    const highCover = promoteHigh ? Math.max(obs.high / 100, 0.99) : obs.high / 100;
    const baseHighHalo = promoteHigh ? GENUS_MICRO.cs.halo : GENUS_MICRO[highGenus].halo;
    const highHalo = Math.round(baseHighHalo * pStateHigh.haloScale * 20) / 20;
    layers.push({
      genus: highGenus,
      cover: highCover,
      baseKm,
      thicknessM: highThicknessM,
      band: 'high',
      opts: {
        ...baseOpts,
        ...ciKnobs,
        tileGenus: 'ci',
        haloWeight: highHalo,
        powderWeight: 0,
      },
    });
  } else layers.push(farOnlyLayer('high') ?? { genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.high, band: 'high' });

  // 흐린 날 높이별 채우기(docs/WAVE_FIELD_DESIGN.md §9): 저·중층 두 종류 층 대신 파동 장 한 층. 적란운 날은 쓰지 않음.
  const fillProf = a.fill !== false && !anvil ? fillProfileOf(obs) : null;
  let fillOn = false;
  let fillRough = 0;
  let deckTau: { tau: number; T: number } | null = null;
  if (fillProf) {
    const rr = rainRoughness(obs, Wpat.low);
    const rEff = hasDayWind ? Math.round(rr.r * 4) / 4 : rr.r;
    const q2 = (v: number) => Math.round(v * 100) / 100;
    const baseProf = hasDayWind
      ? fillProf.map(q => ({
          zM: Math.round(q.zM / 200) * 200,
          cover: q.cover <= 0.02 ? 0 : q.cover >= 0.9 ? 1 : Math.round(q.cover * 4) / 4,
        }))
      : fillProf;
    // 거친 비구름(2026-11-12): 밑면이 평평한 판으로 끝나 아래에서 거칠기가 안 보였음 → 밑면 아래로 운량이 줄어드는 자락(깊이 500·r m)을 붙여
    // 덱 밑에 늘어진 덩어리·틈이 생기게 함. 자락 안의 원래 높이 칸은 자락 값으로 바꿈.
    // 자락은 덱 본체(운량 0.5 이상) 밑면에서 — 그 아래 얇은 칸(예: 0.09)은 자락으로 바뀜.
    const z0 = baseProf.find(q => q.cover >= 0.5)?.zM;
    const c0 = baseProf.find(q => q.cover >= 0.5)?.cover ?? 1;
    const snowCurtainW = clamp(pStateLow.snowFlakeFrac * 1.15 + pStateLow.iceCrystalFrac * 0.5, 0, 1);
    // 입자 물리 기반 하단 낙하·승화 커튼 깊이: 거친 비구름 자락(500·rEff)과 눈송이·빙정 낙하 커튼(fallScaleM)의 연속 결합
    const curtainTargetM = Math.max(500 * rEff, pStateLow.fallScaleM);
    let prof = baseProf;
    if (z0 != null && curtainTargetM > 75 && z0 - a.heightM > 420) {
      const minClearM = snowCurtainW > 0.25 ? 260 : 400;
      const d = Math.round(Math.max(0, Math.min(curtainTargetM, z0 - a.heightM - minClearM)));
      if (d >= 60) {
        // 눈송이·빙정 비율이 높을수록 밑면 아래 커튼이 더 완만하고 뿌옇게(높은 운량 비율로) 이어집니다.
        const botCover = q2(c0 * (0.45 + 0.22 * snowCurtainW));
        const midCover = q2(c0 * (0.78 + 0.12 * snowCurtainW));
        prof = [
          ...baseProf.filter(q => q.zM >= z0 || q.zM < z0 - d - 100),
          { zM: z0 - d, cover: botCover },
          { zM: z0 - Math.round(d / 2), cover: midCover },
        ].sort((a, b) => a.zM - b.zM);
      }
    }
    const on = prof.filter(q => q.cover > 0.02);
    if (on.length) {
      const zLo = on[0].zM, zHi = on[on.length - 1].zM;
      const [lu, lv] = Wpat.low, [mu, mv] = Wpat.mid;
      const dz = hasDayWind ? 2500 : Math.max(500, ((obs.layerAltMidKm ?? FALLBACK_ALT_KM.mid) - (obs.layerAltLowKm ?? FALLBACK_ALT_KM.low)) * 1000);
      const shear = Math.hypot(mu - lu, mv - lv) / 3.6 / dz;
      const shearDeg = Math.round(((Math.atan2(mu - lu, mv - lv) * 180) / Math.PI + 360) % 360 / 10) * 10;
      fillRough = rr.r;
      deckTau = deckTauFromGhi(obs, a.date, a.lat, a.lon);
      // 거칠기 r 과 입자 물리 상태(pStateLow)의 연속 결합:
      // 눈송이·빙정 비중이 클수록 가장자리 선명도(edge)와 대류성 요철(chi, baseBump)은 낮아지고 3차원 공간 흐림(smoothM)은 넓어집니다.
      const waveEdge = q2(Math.max(0.65, (1.5 + 1.5 * rEff) * pStateLow.edgeScale));
      const waveSmoothM = Math.round(clamp((450 - 300 * rEff) + 380 * snowCurtainW, 120, 850) / 25) * 25;
      const waveChi = q05((0.1 + 0.5 * rEff) * (1 - 0.55 * snowCurtainW));
      const waveBaseBump = q2(rEff * (1 - 0.65 * snowCurtainW));
      const wave = {
        ziM: 3200, baseM: zLo, thickM: Math.max(300, zHi - zLo), cover: Math.max(...on.map(q => q.cover)), chi: waveChi,
        shear: Math.round(shear * 1e3) / 1e3, shearDeg, edge: waveEdge, spec: 1.6, vstretch: 1.5, mix3d: q05(0.55 + 0.35 * rEff),
        fillM: 1500, smoothM: waveSmoothM, smoothZ: (rEff > 0.5 && snowCurtainW < 0.35) ? 1 : 2, profile: prof, baseBump: waveBaseBump, tauTarget: deckTau?.tau,
        seed: flowSeed % 997, nxy: 96, nz: 24,
      };
      const minFillM = inMountainCloud ? Math.max(0, a.heightM - 50) : a.heightM + 350;
      const zMin = Math.max(minFillM, zLo - 300), zMax = zHi + 400;
      layers[0] = { genus: 'ns', cover: wave.cover, baseKm: zMin / 1000, thicknessM: zMax - zMin, band: 'low', opts: { ...flowOpts('low'), wave, densityScale: FILL_DENSITY_SCALE, powderWeight: pStateLow.powderScale } as VolumetricLayerInput['opts'] };
      layers[1] = { genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.mid, band: 'mid' };
      // 편운(밑면 아래 조각구름): 강수·강풍·건조도의 연속 곱으로 운량을 부드럽게 올려 경계 점프를 없앱니다.
      const fractusW = FRACTUS_ON
        ? clamp((obs.precipitation ?? 0) / 0.15, 0, 1) * clamp((rr.wind - 0.2) / 0.25, 0, 1) * clamp((rr.dry - 0.1) / 0.2, 0, 1)
        : 0;
      if (fractusW > 0.01) {
        const fBase = Math.max(a.heightM / 1000 + 0.15, zLo / 1000 - 0.45);
        // 옅고 찢어진 조각: 밀도 sc 의 약 1/4, 표면 깎기·잔무늬 최대, 가장자리 무르게(edge 1.2), 얇게(250 m).
        layers[1] = { genus: 'sc', cover: q2((0.15 + 0.2 * rr.wind) * fractusW), baseKm: fBase, thicknessM: 250, band: 'low', opts: { ...flowOpts('low'), ...FRACTUS_OPTS, powderWeight: pStateLow.powderScale } };
      }
      fillOn = true;
    }
  }
  // 습한 막(2026-11-13 수원 11:52): 역전층 아래 갇힌 습한 연무·걷히는 안개. 예보 운량은 포화가 아니라 0 % 지만 해가 젖빛 유리 너머처럼 보이고
  // 하늘이 어느 쪽이나 고른 회색 — 연무 셰이더(한 번 산란)로는 해 둘레만 넓게 희어져 못 그림. 구름 패스(다중산란)의 얇은 층운으로 그림.
  const mist = !fillOn && !anvil ? mistLayerOf(thermo, a.heightM, obs, sunAltDeg, dniPick.dni) : null;
  if (mist) layers[0] = { genus: 'st', cover: 1, baseKm: mist.baseKm, thicknessM: mist.thicknessM, band: 'low', opts: { densityScale: mist.densityScale, powderWeight: 0.35 } };
  if (anvil) layers.push(anvil);
  // 위층 덮개 구름이 아래층으로 내려오는 직달 햇빛을 가릴 때(거시 15~360km 외 국지 다층 겹침) 두-흐름 확산광에 반영합니다.
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (!L || !L.genus) continue;
    let upperT = 1;
    for (let j = 0; j < layers.length; j++) {
      if (i === j) continue;
      const U = layers[j];
      if (!U || !U.genus || !(U.cover > 0.05) || U.baseKm <= L.baseKm + 0.3) continue;
      if ((U.opts as { wave?: unknown } | undefined)?.wave) continue;
      const dsU = U.opts?.densityScale ?? GENUS[U.genus].densityScale;
      const thickU = U.thicknessM ?? GENUS[U.genus].height;
      const gU = (U.opts as { effectiveG?: number } | undefined)?.effectiveG
        ?? (U.genus === 'ci' || U.genus === 'cs' || U.genus === 'cbanvil' ? DIFFUSE_G_ICE : DIFFUSE_G);
      const tLayer = diffuseTransmittance(0.057 * dsU * thickU, gU);
      upperT *= 1 - U.cover + U.cover * tLayer;
    }
    if (upperT < 0.995) {
      L.opts = { ...L.opts, beamTransmittance: Math.round((L.opts?.beamTransmittance ?? 1) * upperT * 1000) / 1000 };
    }
  }
  for (const L of layers) if (L && L.genus) L.driftKm = driftKm(L.band ?? (L.baseKm >= 7 ? 'high' : L.baseKm >= 2 ? 'mid' : 'low'));
  const name = (g: ForecastGenus | null, cover: number) => (g ? `${g} ${Math.round(cover)}%` : '—');
  const beamPct = Math.round((macro.beamTransmittance.low * 0.5 + macro.beamTransmittance.mid * 0.5) * 100);
  const summary = `${fillOn ? `채우기 r${fillRough.toFixed(1)}${deckTau ? ` τ${Math.round(deckTau.tau)}(일사 ${Math.round(deckTau.T * 100)}%)` : ''} · ` : ''}저 ${name(forecast.low, obs.low)} · 중 ${name(promoteMid ? 'as' : forecast.mid, obs.mid)} · 상 ${name(promoteHigh ? 'cs' : forecast.high, obs.high)} · 해 ${sunAltDeg.toFixed(1)}° · 빔 ${beamPct}%${tauDni != null ? ` · τ ${tauDni.toFixed(1)}${dniPick.source === 'sat' ? '(위성)' : ''}` : ''}${mist ? ` · 습한 막 τ${mist.tau.toFixed(2)} ~${Math.round(mist.topAglM)}m` : ''}${metarOv ? ` · ${metarOv.note}` : ''}${(() => { const o = a.pathData?.[0]?.origin; return o && o !== 'forecast' ? ` · 출처 ${o}` : ''; })()}`;
  // 습한 막이 있으면 그 막이 곧 습한 에어로졸층(직달일사 감소 전체로 두께를 정함) — 연무를 따로 더하면 두 번 셈.
  const haze = mist ? undefined : hazeFromObs(obs);
  // §156 거시 운량 격자 입력 — 30분 간격 에르미트 곡선 매듭([K0, K1])을 전후로 잡아 GPU에서 연속 블렌딩합니다.
  const MACRO_KNOT_MS = 1800000;
  const k0Ms = Math.floor(a.date.getTime() / MACRO_KNOT_MS) * MACRO_KNOT_MS;
  const k1Ms = k0Ms + MACRO_KNOT_MS;
  const macroRing = ptsAll.length >= 20
    ? (getCachedMacroKnot(ptsAll, k0Ms) ?? toMacroRing(interpolatedList))
    : toMacroRing(interpolatedList);
  const macroRingNext = ptsAll.length >= 20
    ? getCachedMacroKnot(ptsAll, k1Ms)
    : undefined;
  const genus = { low: forecast.low, mid: promoteMid ? 'as' as const : forecast.mid, high: promoteHigh ? 'cs' as const : forecast.high };
  return {
    input: {
      ...base,
      layers,
      thermo,
      ...(haze ? { haze } : {}),
      ...(macroRing ? { macro: macroRing } : {}),
      ...(macroRingNext ? { macroNext: macroRingNext, macroSpanMs: [k0Ms, k1Ms] as [number, number] } : {}),
      ...(tileCoverEnvelope ? { tileCoverEnvelope } : {}),
    },
    forecast,
    obs,
    summary,
    tauDni,
    genus,
  };
}
