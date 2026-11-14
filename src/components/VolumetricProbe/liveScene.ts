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
import { flowSeedOf } from './cloudFlow';
import { resolveLayerWinds } from '../../utils/skyColumn';
import { aerosolOpticsFromObs } from '../../utils/sunVisibility';
import { cloudOpticalDepthFromDni } from '../../utils/dniOpticalDepth';
import { pickDni } from '../../utils/satelliteIrradiance';
import { clearSkyGHIMean } from '../../utils/satelliteBias';
import { DIFFUSE_G, DIFFUSE_K } from './cloudDiffuse';
import { applyMetarToObs, type MetarObs } from '../../utils/metar';
import type { HazeInput, VolumetricLayerInput, VolumetricSceneInput } from './volumetricScene';
import { lclBaseKm, type ThermoInput } from './cloudPhysics';

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

/** 기압면 단면에서 높이별 운량(0~1)을 뽑습니다. 조건이 안 맞으면 null. */
export function fillProfileOf(obs: CloudData): { zM: number; cover: number }[] | null {
  const hs = obs.profileHeightM, cs = obs.profileCoverPct;
  if (!hs || !cs || hs.length !== cs.length) return null;
  if (obs.capeJkg != null && Number.isFinite(obs.capeJkg) && obs.capeJkg >= FILL_RULE.capeMax) return null;
  const lv = hs.map((z, i) => ({ zM: z, c: cs[i] })).filter(q => Number.isFinite(q.zM) && Number.isFinite(q.c) && q.zM <= FILL_RULE.maxZ).sort((a, b) => a.zM - b.zM);
  if (!lv.length) return null;
  const peak = Math.max(...lv.map(q => q.c)), wet = lv.filter(q => q.c >= FILL_RULE.wetPct).length;
  if (peak < FILL_RULE.peak || wet < FILL_RULE.wetLevels) return null;
  // 비가 오면(시간당 0.1 mm 이상) 덱의 주요 높이(운량 50 % 이상)는 다 덮인 것으로 — 실제 난층운 아래는 거의 다 덮여 보임(2026-11-12).
  const raining = (obs.precipitation ?? 0) >= 0.1;
  return lv.map(q => {
    const c = Math.round(Math.min(100, Math.max(0, q.c))) / 100;
    return { zM: Math.round(q.zM), cover: raining && c >= 0.5 ? 1 : c };
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
export function hazeFromObs(o: { aod550?: number; pm25?: number; pm10?: number; dust?: number; visibility?: number; humidity?: number; profileRhPct?: number[] }): HazeInput | undefined {
  const op = aerosolOpticsFromObs(o);
  if (!op) return undefined;
  const extra = op.aod - HAZE_BACKGROUND_AOD;
  if (extra < 0.02) return undefined;
  return { aod: Math.min(3, extra), alpha: op.alpha, g: op.g, omega: op.omega };
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
  const dayWindOf = (band: 'low' | 'mid' | 'high'): [number, number] | null => {
    const pts = a.pathData ?? [];
    if (!pts.length) return null;
    let obsPt = pts[0];
    for (const q of pts) if (Number.isFinite(q.distance) && (!obsPt || q.distance < obsPt.distance)) obsPt = q;
    const h = obsPt?.hourly;
    const ts = h?.timeMs;
    const key = band === 'low' ? 'Low' : band === 'mid' ? 'Mid' : 'High';
    const us = h?.[`windU${key}` as const], vs = h?.[`windV${key}` as const];
    if (!ts || !us || !vs || ts.length === 0) return null;
    const DAY = 86400000, lonMs = (a.lon / 360) * DAY;
    const t0 = Math.floor((a.date.getTime() + lonMs) / DAY) * DAY - lonMs;
    const t1 = t0 + DAY;
    let su = 0, sv = 0, cnt = 0;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] >= t0 && ts[i] <= t1 && Number.isFinite(us[i]) && Number.isFinite(vs[i])) {
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
  const driftKm = (band: 'low' | 'mid' | 'high'): [number, number] => integratedDriftKm(a, band, W[band]);
  const NBAND: Record<'low' | 'mid' | 'high', [number, number]> = { low: [1000, 2500], mid: [3000, 6000], high: [7000, 11000] };
  const flowOpts = (band: 'low' | 'mid' | 'high') => {
    const [u, v] = Wpat[band], [su, sv] = shearOf(band);
    const nB = hasDayWind ? 0.012 : bruntN(thermo, NBAND[band][0], NBAND[band][1]);
    const mGrad = macro[band];
    return {
      windU: q5(u), windV: q5(v), shearU: su, shearV: sv, flowSeed,
      ...(nB != null ? { flowN: nB } : {}),
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
  const thermo = thermoOf(obs, a.heightM);
  const lclKm = lclBaseKm(thermo);
  // 저층: 단면 덱이 있으면 밑면·두께를 그대로, 없으면 층 높이(가운데)에서 두께의 반을 뺀 밑면.
  if (obs.low > 0) {
    const thick = forecast.lowBaseKm != null && forecast.lowTopKm != null ? (forecast.lowTopKm - forecast.lowBaseKm) * 1000 : NaN;
    const thicknessM = Number.isFinite(thick) ? clamp(thick, 300, 3000) : undefined;
    const centerKm = obs.layerAltLowKm ?? FALLBACK_ALT_KM.low;
    const baseKm = forecast.lowBaseKm ?? Math.max(a.heightM / 1000 + 0.2, centerKm - (thicknessM ?? 1200) / 2000);
    if (forecast.low === 'cb') {
      // 적란운: 탑은 밑면~권계면 한 층, 모루는 4번째 채널에 같은 씨앗으로 — 바람 방향은 중층 바람.
      const topKm = Math.max(baseKm + 4, CB_TOP_KM);
      const windDeg = obs.windUMid != null && obs.windVMid != null ? ((Math.atan2(obs.windUMid, obs.windVMid) * 180) / Math.PI + 360) % 360 : 30;
      const opts = { seed: 7, windDeg, ...flowOpts('low') };
      layers.push({ genus: 'cb', cover: obs.low / 100, baseKm, thicknessM: (topKm - baseKm) * 1000, band: 'low', opts, physBaseKm: lclKm ?? undefined });
      anvil = { genus: 'cbanvil', cover: 1, baseKm: topKm - CB_ANVIL_THICK_M / 1000 * 0.8, thicknessM: CB_ANVIL_THICK_M, band: 'high', opts };
    } else if (forecast.low === 'cg') {
      layers.push({ genus: 'cg', cover: obs.low / 100, baseKm, thicknessM: Math.max(thicknessM ?? 0, 2500), band: 'low', opts: flowOpts('low'), physBaseKm: lclKm ?? undefined });
    } else {
      const g = renderGenusFor(forecast.low);
      // §141 적운·층적운은 두께를 예보 덱 그대로 쓰고 덩어리 가로 크기를 두께에 비례시킴(§139.4 의 cu 두께 상한 1000 m 를 대체).
      const spacingKm = g === 'cu' || g === 'sc' ? aspectSpacingKm(g, thicknessM ?? GENUS[g].height) : undefined;
      // §144·§147 층운(st)·난층운(ns)은 운량 보정표가 없어 예보 84% 가 화면 21~30%(머리 위)로 그려졌음 — 덮임 80% 이상이면 구름 한 장(관측 용어 '흐림')으로 그림.
      const lowCover = (g === 'st' || g === 'ns') && obs.low >= 80 ? Math.max(obs.low / 100, 0.99) : obs.low / 100;
      layers.push({ genus: g, cover: lowCover, baseKm, thicknessM: thicknessM, band: 'low', opts: { ...flowOpts('low'), ...(spacingKm != null ? { spacingKm } : {}) }, physBaseKm: g === 'cu' ? lclKm ?? undefined : undefined });
    }
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.low, band: 'low' });
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
    const midGenus = promoteMid ? 'as' : renderGenusFor(forecast.mid);
    const baseKm = Math.max(2.2, forecast.midBaseKm ?? (centerKm - 0.3));
    layers.push({ genus: midGenus, cover: midGenus === 'as' && obs.mid >= 80 ? Math.max(obs.mid / 100, 0.99) : obs.mid / 100, baseKm, thicknessM: midThicknessM, band: 'mid', opts: flowOpts('mid') });
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.mid, band: 'mid' });
  if (obs.high > 0) {
    const centerKm = obs.layerAltHighKm ?? FALLBACK_ALT_KM.high;
    const baseKm = Math.max(7.2, forecast.highBaseKm ?? (centerKm - 0.2));
    if (promoteHigh) {
      // τ_render ≈ 57 × densityScale 는 1,000 m 층에서 잰 값 — 덱 두께가 다르면 같은 τ 가 되도록 두께에 반비례.
      const densityScale = Math.min(DNI_VEIL_MAX_DENSITY, Math.max(0.0015, (tauDni! / 57) * (1000 / (highThicknessM ?? 1000))));
      layers.push({ genus: 'cs', cover: Math.max(obs.high / 100, 0.99), baseKm, thicknessM: highThicknessM, band: 'high', opts: { ...flowOpts('high'), densityScale, ao: 1.5 } });
    } else {
      layers.push({ genus: renderGenusFor(forecast.high), cover: obs.high / 100, baseKm, thicknessM: highThicknessM, band: 'high', opts: flowOpts('high') });
    }
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.high, band: 'high' });

  // 흐린 날 높이별 채우기(docs/WAVE_FIELD_DESIGN.md §9): 저·중층 두 종류 층 대신 파동 장 한 층. 적란운 날은 쓰지 않음.
  const fillProf = a.fill !== false && !anvil ? fillProfileOf(obs) : null;
  let fillOn = false;
  let fillRough = 0;
  let deckTau: { tau: number; T: number } | null = null;
  if (fillProf) {
    const rr = rainRoughness(obs, W.low);
    const q2 = (v: number) => Math.round(v * 100) / 100;
    // 거친 비구름(2026-11-12): 밑면이 평평한 판으로 끝나 아래에서 거칠기가 안 보였음 → 밑면 아래로 운량이 줄어드는 자락(깊이 500·r m)을 붙여
    // 덱 밑에 늘어진 덩어리·틈이 생기게 함. 자락 안의 원래 높이 칸은 자락 값으로 바꿈.
    // 자락은 덱 본체(운량 0.5 이상) 밑면에서 — 그 아래 얇은 칸(예: 0.09)은 자락으로 바뀜.
    const z0 = fillProf.find(q => q.cover >= 0.5)?.zM;
    let prof = fillProf;
    if (z0 != null && rr.r > 0.15 && z0 - a.heightM > 500) {
      // 땅에서 400 m 위까지만(레인 바닥은 자락 아래 300 m).
      const d = Math.round(Math.max(0, Math.min(500 * rr.r, z0 - a.heightM - 400)));
      prof = [
        ...fillProf.filter(q => q.zM >= z0 || q.zM < z0 - d - 100),
        { zM: z0 - d, cover: q2(0.2 * rr.r) }, { zM: z0 - Math.round(d / 2), cover: q2(0.6 * rr.r) },
      ].sort((a, b) => a.zM - b.zM);
    }
    const on = prof.filter(q => q.cover > 0.02);
    if (on.length) {
      const zLo = on[0].zM, zHi = on[on.length - 1].zM;
      const [lu, lv] = W.low, [mu, mv] = W.mid, dz = Math.max(500, ((obs.layerAltMidKm ?? FALLBACK_ALT_KM.mid) - (obs.layerAltLowKm ?? FALLBACK_ALT_KM.low)) * 1000);
      const shear = Math.hypot(mu - lu, mv - lv) / 3.6 / dz;
      const shearDeg = Math.round(((Math.atan2(mu - lu, mv - lv) * 180) / Math.PI + 360) % 360 / 10) * 10;
      fillRough = rr.r;
      deckTau = deckTauFromGhi(obs, a.date, a.lat, a.lon);
      // 거칠기 r(0 매끈한 난층운 ~ 1 거친 비구름): 작은 혹·표면 깎기(χ), 3차원 섞임, 가장자리 선명도는 키우고 흐림은 줄임.
      const wave = {
        ziM: 3200, baseM: zLo, thickM: Math.max(300, zHi - zLo), cover: Math.max(...on.map(q => q.cover)), chi: q2(0.1 + 0.5 * rr.r),
        shear: Math.round(shear * 1e4) / 1e4, shearDeg, edge: q2(1.5 + 1.5 * rr.r), spec: 1.6, vstretch: 1.5, mix3d: q2(0.3 + 0.4 * rr.r),
        fillM: 1500, smoothM: Math.round(800 - 500 * rr.r), smoothZ: rr.r > 0.5 ? 1 : 2, profile: prof, baseBump: q2(rr.r), tauTarget: deckTau?.tau,
        seed: flowSeed % 997, nxy: 128, nz: 32,
      };
      const zMin = zLo - 300, zMax = zHi + 400;
      layers[0] = { genus: 'ns', cover: wave.cover, baseKm: zMin / 1000, thicknessM: zMax - zMin, band: 'low', opts: { ...flowOpts('low'), wave, densityScale: FILL_DENSITY_SCALE } as VolumetricLayerInput['opts'] };
      layers[1] = { genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.mid, band: 'mid' };
      // 편운(밑면 아래 조각구름): 비가 오고 바람이 세며 구름 아래가 건조할 때 — 빗방울 증발로 식은 공기가 밑면 아래에 낮고 빠른 조각을 만듦.
      if (FRACTUS_ON && (obs.precipitation ?? 0) >= 0.1 && rr.wind > 0.3 && rr.dry > 0.15) {
        const fBase = Math.max(a.heightM / 1000 + 0.15, zLo / 1000 - 0.45);
        // 옅고 찢어진 조각: 밀도 sc 의 약 1/4, 표면 깎기·잔무늬 최대, 가장자리 무르게(edge 1.2), 얇게(250 m).
        layers[1] = { genus: 'sc', cover: q2(0.15 + 0.2 * rr.wind), baseKm: fBase, thicknessM: 250, band: 'low', opts: { ...flowOpts('low'), ...FRACTUS_OPTS } };
      }
      fillOn = true;
    }
  }
  // 습한 막(2026-11-13 수원 11:52): 역전층 아래 갇힌 습한 연무·걷히는 안개. 예보 운량은 포화가 아니라 0 % 지만 해가 젖빛 유리 너머처럼 보이고
  // 하늘이 어느 쪽이나 고른 회색 — 연무 셰이더(한 번 산란)로는 해 둘레만 넓게 희어져 못 그림. 구름 패스(다중산란)의 얇은 층운으로 그림.
  const mist = !fillOn && !anvil ? mistLayerOf(thermo, a.heightM, obs, sunAltDeg, dniPick.dni) : null;
  if (mist) layers[0] = { genus: 'st', cover: 1, baseKm: mist.baseKm, thicknessM: mist.thicknessM, band: 'low', opts: { densityScale: mist.densityScale } };
  if (anvil) layers.push(anvil);
  for (const L of layers) if (L && L.genus) L.driftKm = driftKm(L.band ?? (L.baseKm >= 7 ? 'high' : L.baseKm >= 2 ? 'mid' : 'low'));
  const name = (g: ForecastGenus | null, cover: number) => (g ? `${g} ${Math.round(cover)}%` : '—');
  const beamPct = Math.round((macro.beamTransmittance.low * 0.5 + macro.beamTransmittance.mid * 0.5) * 100);
  const summary = `${fillOn ? `채우기 r${fillRough.toFixed(1)}${deckTau ? ` τ${Math.round(deckTau.tau)}(일사 ${Math.round(deckTau.T * 100)}%)` : ''} · ` : ''}저 ${name(forecast.low, obs.low)} · 중 ${name(promoteMid ? 'as' : forecast.mid, obs.mid)} · 상 ${name(promoteHigh ? 'cs' : forecast.high, obs.high)} · 해 ${sunAltDeg.toFixed(1)}° · 빔 ${beamPct}%${tauDni != null ? ` · τ ${tauDni.toFixed(1)}${dniPick.source === 'sat' ? '(위성)' : ''}` : ''}${mist ? ` · 습한 막 τ${mist.tau.toFixed(2)} ~${Math.round(mist.topAglM)}m` : ''}${metarOv ? ` · ${metarOv.note}` : ''}${(() => { const o = a.pathData?.[0]?.origin; return o && o !== 'forecast' ? ` · 출처 ${o}` : ''; })()}`;
  // 습한 막이 있으면 그 막이 곧 습한 에어로졸층(직달일사 감소 전체로 두께를 정함) — 연무를 따로 더하면 두 번 셈.
  const haze = mist ? undefined : hazeFromObs(obs);
  // §156 거시 운량 격자 입력 — 고리 점들의 층별 운량(관측점 포함). 고리가 없으면(관측점 하나) 넣지 않음.
  const ringPts = dropSeamCopies(interpolatedList.filter(q => Number.isFinite(q.distance) && Number.isFinite(q.azimuthOffset)));
  const macroRing = ringPts.length >= 20 ? {
    low: ringPts.map(q => ({ distance: q.distance ?? 0, azimuthOffset: q.azimuthOffset ?? 0, cover: Math.min(1, Math.max(0, (q.low ?? 0) / 100)) })),
    mid: ringPts.map(q => ({ distance: q.distance ?? 0, azimuthOffset: q.azimuthOffset ?? 0, cover: Math.min(1, Math.max(0, (q.mid ?? 0) / 100)) })),
    high: ringPts.map(q => ({ distance: q.distance ?? 0, azimuthOffset: q.azimuthOffset ?? 0, cover: Math.min(1, Math.max(0, (q.high ?? 0) / 100)) })),
  } : undefined;
  const genus = { low: forecast.low, mid: promoteMid ? 'as' as const : forecast.mid, high: promoteHigh ? 'cs' as const : forecast.high };
  return { input: { ...base, layers, thermo, ...(haze ? { haze } : {}), ...(macroRing ? { macro: macroRing } : {}) }, forecast, obs, summary, tauDni, genus };
}
