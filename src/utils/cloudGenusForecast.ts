/**
 * cloudGenusForecast.ts — 예보 한 시각 → 층별 **구름 종류** (문서 §126, 2026-10-04).
 *
 * 볼륨 구름(§124 `cloudGenus.ts`)은 종류마다 다른 무늬·단면을 그립니다. 그 종류를 예보에서 정하는 규칙이
 * 여기입니다. 입력은 앱이 이미 받는 변수만 씁니다(운량 3층·기압면 단면·강수·습도·기온/이슬점) — CAPE·LI 는
 * 아직 받지 않으므로 선택 입력입니다(없으면 대류 판정은 단면 두께로 대신합니다).
 *
 * 자(tools/genus-ruler/synop/RULER-genus-forecast.md): 유럽 유인 관측소의 SYNOP 구름 종류 보고(CL/CM/CH)와
 * Open-Meteo 같은 시각 예보를 짝지어, 홀수 날로 문턱을 정하고 짝수 날로 보고합니다. 결과는 §126 에 있습니다.
 *
 * 종류 기호: cu 적운 · cg 웅대적운 · cb 적란운 · sc 층적운 · st 층운 · ns 난층운 · ac 고적운 · as 고층운 ·
 * ci 권운 · cs 권층운. 렌더 쪽 GenusKey 와 이름을 맞춥니다(아직 없는 종류는 렌더에서 가장 가까운 것으로 물러남).
 */
import { LAYER_BAND_KM, lclKm, lowDeck, type ProfileLevel } from './cloudProfile';

export type LowGenus = 'cu' | 'cg' | 'cb' | 'sc' | 'st' | 'ns';
export type MidGenus = 'ac' | 'as';
export type HighGenus = 'ci' | 'cs';
export type ForecastGenus = LowGenus | MidGenus | HighGenus;

export interface GenusForecastInput {
  /** 층 운량 0~100(%) */
  low: number; mid: number; high: number;
  /** 기압면 단면(없으면 빈 배열) — 높이(m)·운량(%) */
  profile: ProfileLevel[];
  /** 관측점 지면 높이(m, 해발) */
  groundM: number;
  /** 시간 강수(mm) */
  precipitationMm?: number | null;
  /** 2m 상대습도(%)·기온·이슬점(°C) */
  humidityPct?: number | null;
  tempC?: number | null;
  dewC?: number | null;
  /** 대류(선택) */
  capeJkg?: number | null;
  liftedIndex?: number | null;
  /** WMO 날씨 코드(선택) */
  weatherCode?: number | null;
  /** 낮인가(해 고도 > 0) */
  isDay?: boolean;
}

export interface GenusForecast {
  low: LowGenus | null;
  mid: MidGenus | null;
  high: HighGenus | null;
  /** 저층 덱 밑면·윗면(km, 해발) — 단면이 있을 때 */
  lowBaseKm: number | null;
  lowTopKm: number | null;
  /** 판정 근거(디버그·시험 화면 표시용) */
  why: string;
}

/**
 * 문턱 — 홀수 날 SYNOP(유럽 유인 관측소 7,302 보고)로 격자 탐색한 값(§126.4). 이름을 바꾸지 말 것: 자 스크립트가 같은 이름을 씁니다.
 *
 * ⚠ 짝수 날 보고: 저층 4분류 0.518 대 다수 찍기 0.515(+0.3%p), 중·상층은 다수 찍기와 같음 — **자(+10%p)를 못 넘었습니다.**
 * 그래서 이 규칙은 "예보로 종류를 맞힌다"가 아니라 "그럴듯한 기본값을 고른다"로 읽어야 합니다. 조정이 고른 값의 뜻:
 *  - cuCape 9999: CAPE 는 적운 판정에 도움이 안 됐고 LI ≤ 2 와 덱 두께가 남았습니다.
 *  - asCover·csCover 101: 관측자는 중층 90% 도 고적운, 상층 90% 도 권운이라 부릅니다 — 운량으로 as/cs 를 가르면 틀립니다.
 */
export const GENUS_THRESHOLDS = {
  /** 층을 "있다"고 보는 최소 운량(%) */
  minCover: 20,
  /** 적란운: CAPE(J/kg) 또는 LI */
  cbCape: 1500, cbLi: -2,
  /** 소나기·뇌우 날씨 코드 */
  showerCodes: [80, 81, 82, 85, 86, 95, 96, 99],
  /** 난층운: 강수(mm/h) 이상 + 저층 덮임 이상 + 중층도 덮임 */
  nsPrecip: 0.3, nsCover: 80,
  /** 층운: 밑면(지면 위 km) 이하 + 운량 이상 (§144: 0.25 → 0.4 km, 기기 캡처 10/16 08:01 밑면 0.264 km) */
  stBaseKm: 0.4, stCover: 70,
  /** 저층 운량이 이 이상(%)이면 두께 대용 대류 판정(weakConv)이 층운을 막지 못함 — 덮개 구름은 적운 판정 대상이 아님(§144) */
  stOvercast: 80,
  /** 적운: 대류(CAPE 이상 또는 LI 이하) 또는 (대류 자료 없을 때) 덱 두께 이상 + 낮 + 운량 미만 */
  cuCape: 9999, cuLi: 2, cuThickKm: 0.6, cuCover: 55,
  /** 웅대적운: 덱 두께 이상 */
  cgThickKm: 2.0,
  /** 고층운: 중층 운량 이상 이고(강수 있음 또는 습윤 면 수 이상) */
  asCover: 101, asLevels: 2,
  /** 비가 올 때(nsPrecip 이상) 중층이 이 이상(%)이면 고층운(as) — 비구름 위의 중층은 흩어진 고적운이 아니라 덮개(§147) */
  asRainCover: 80,
  /** 권층운: 상층 운량 이상 */
  csCover: 101,
} as const;

function midLevels(profile: ProfileLevel[]): ProfileLevel[] {
  return profile.filter(l => l.heightM >= LAYER_BAND_KM.lowTop * 1000 && l.heightM < LAYER_BAND_KM.midTop * 1000);
}

/** 예보 한 시각의 층별 종류. 운량이 minCover 미만인 층은 null 입니다. */
export function classifyGenus(x: GenusForecastInput, T = GENUS_THRESHOLDS): GenusForecast {
  const why: string[] = [];
  const deck = x.profile.length ? lowDeck(x.profile) : null;
  const lcl = lclKm(x.tempC, x.dewC);
  const precip = x.precipitationMm ?? 0;
  const cape = x.capeJkg ?? null, li = x.liftedIndex ?? null;
  const code = x.weatherCode ?? null;
  const thickKm = deck ? deck.topKm - deck.baseKm : null;
  // 밑면(지면 위): 단면 덱이 있으면 그것, 없으면 LCL
  const baseAglKm = deck ? Math.max(0, deck.baseKm - x.groundM / 1000) : lcl;

  let low: LowGenus | null = null;
  if (x.low >= T.minCover) {
    const convective = (cape != null && cape >= T.cbCape) || (li != null && li <= T.cbLi);
    const shower = code != null && (T.showerCodes as readonly number[]).includes(code);
    const weakConv = (cape != null ? cape >= T.cuCape : false) || (li != null ? li <= T.cuLi : false)
      || (cape == null && li == null && thickKm != null && thickKm >= T.cuThickKm);
    const isRaining = precip >= 0.1 || (code != null && ((code >= 51 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 99)));
    if ((convective && (precip > 0 || shower)) || (shower && cape != null && cape >= T.cuCape)) {
      low = 'cb'; why.push('cb: 대류+강수');
    } else if (isRaining) {
      // 강수 발생 시 층적운 대신 실감나는 난층운(비구름)으로 정확히 분류
      low = 'ns'; why.push(`ns: 강수(${precip.toFixed(1)}mm)`);
    } else if (baseAglKm != null && baseAglKm <= T.stBaseKm && x.low >= T.stCover && (!weakConv || x.low >= T.stOvercast)) {
      low = 'st'; why.push(`st: 밑면 ${baseAglKm.toFixed(2)}km`);
    } else if (weakConv && x.isDay !== false && x.low < T.cuCover) {
      low = thickKm != null && thickKm >= T.cgThickKm ? 'cg' : 'cu';
      why.push(`${low}: 대류 두께 ${thickKm?.toFixed(1) ?? '?'}km`);
    } else {
      low = 'sc'; why.push('sc: 나머지');
    }
  }

  let mid: MidGenus | null = null;
  if (x.mid >= T.minCover) {
    const wet = midLevels(x.profile).filter(l => l.coverPct >= 10).length;
    mid = (x.mid >= T.asCover && (precip > 0 || wet >= T.asLevels)) || (x.mid >= T.asRainCover && precip >= T.nsPrecip) ? 'as' : 'ac';
    why.push(`${mid}: 중층 ${x.mid}% 습윤면 ${wet}`);
  }

  let high: HighGenus | null = null;
  if (x.high >= T.minCover) {
    high = x.high >= T.csCover ? 'cs' : 'ci';
    why.push(`${high}: 상층 ${x.high}%`);
  }

  return { low, mid, high, lowBaseKm: deck?.baseKm ?? null, lowTopKm: deck?.topKm ?? null, why: why.join(' · ') };
}
