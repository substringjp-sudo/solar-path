/**
 * 추천 (docs/SANDBOX_MODE_PLAN.md 4 장 · 5.1, 목업 3번 "주제 추천과 후보") — 화면에서 떨어진 순수 계산.
 *
 *  - `themesFor`        고른 대상의 모양에서 어울리는 주제(규칙). 지금 계산해 주는 주제는 "달 걸기"와 "해 걸기"입니다.
 *  - `sizeChoices`      해·달 원반이 가릴 대상 부분의 길이 선택(꼭대기 50 m / 전체 높이 …).
 *  - `neededDistanceKm` · `neededFocalMm`   그 크기로 걸 때 필요한 거리와 렌즈(35mm 환산).
 *  - `forecastAt`       그 시각의 구름 예보 상태(맑음 / 보통 / 많음 / 모름). 예보가 없는 시각은 지어내지 않고 "모름"입니다.
 *  - `rankStands`       서 있을 자리 후보(`standFinder`)에 점수를 매겨 순서를 정합니다.
 *
 * ## 점수 (0~1, 곱)
 *
 *   점수 = 달 모양 × 하늘 밝기 × 예보
 *
 *  - 달 모양(달만): 밝은 비율 < 5% 는 보이지 않아 0, 그 위로는 0.2 + 0.8 × 밝은 비율(보름에 가까울수록 높음).
 *  - 하늘 밝기(달): 해가 떠 있으면 달이 희미해 0.45, 해가 지평선 밑 0~12° 황혼이면 1.0(달과 풍경이 같이 보임), 그보다 깊은 밤은 0.85.
 *  - 하늘 밝기(해): 원반이 지평선 위 8° 안이면 1.0(노을빛), 20° 안 0.75, 40° 안 0.5, 그 위 0.3. 지평선(−0.9°) 아래면 0.
 *  - 예보: 맑음 1.0 · 모름 0.65 · 구름 보통 0.6 · 구름 많음 0.15. "모름"을 "보통"보다 아주 조금 높게 둔 것은 정보가 없다는 뜻이지 나쁘다는 뜻이 아니기 때문입니다.
 *  - 땅이 대상을 가리는 자리(`visible: false`)는 기본으로 뺍니다. `includeHidden` 이면 점수는 그대로 두고 순위에 끼우되 추천으로는 세지 않습니다
 *    (맨 뒤로 보내면 후보가 많을 때 목록에 아예 안 보여 "포함" 이 아무 일도 안 합니다. 화면이 "지형에 가림" 표시를 붙입니다).
 *
 * 점수가 `RECOMMEND_SCORE`(0.5) 이상이고 보이는 후보를 "추천"이라 부릅니다.
 *
 * 예보는 **대상 위치의 시간별 구름**입니다. 서 있을 자리는 대상에서 몇 km~60 km 떨어져 있지만 예보 격자(10~25 km)와 같은 규모라
 * 한 지점의 값으로 매깁니다. 구름이 서 있을 자리와 해·달 사이에 있는지까지는 보지 않습니다.
 */
import SunCalc from 'suncalc';
import { bodySky, type AlignBody } from './alignSearch';
import { neededSlantDistanceM, type StandGroup, type StandHit, type StandQuery } from './standFinder';
import { apparentHeightDeg, type BuildingInfo, type PickedTarget, type TargetPoint, type HeightSampler } from './demPick';

// ── 주제 ────────────────────────────────────────────────────────────────

export type ThemeId = 'moonOnTop' | 'sunOnTop' | 'milkyBehind' | 'polarisTrails';

export interface Theme {
  id: ThemeId;
  /** 해·달을 거는 주제의 천체. 아닌 주제는 null. */
  body: AlignBody | null;
  /** 지금 앱이 자리와 날짜를 계산해 주는가. false 면 칩만 보이고 누를 수 없습니다. */
  ready: boolean;
}

/** 높고 좁은 건물의 기준: 높이가 이 값 이상이고 짧은 변의 이 배 이상. */
export const TALL_MIN_HEIGHT_M = 60;
export const TALL_MIN_RATIO = 1.5;

export const isTallNarrow = (t: Pick<PickedTarget, 'kind' | 'building'>): boolean =>
  t.kind === 'building' && !!t.building && t.building.heightM >= TALL_MIN_HEIGHT_M && t.building.heightM >= TALL_MIN_RATIO * Math.max(1, t.building.shortM);

/** 대상 모양에서 어울리는 주제(계획 4 장). 해·달 걸기는 어떤 대상에도, 은하수·북극성은 높고 좁은 건물에만. */
export function themesFor(t: Pick<PickedTarget, 'kind' | 'building'>): Theme[] {
  const list: Theme[] = [
    { id: 'moonOnTop', body: 'moon', ready: true },
    { id: 'sunOnTop', body: 'sun', ready: true },
  ];
  if (isTallNarrow(t)) {
    list.push({ id: 'milkyBehind', body: null, ready: false });
    list.push({ id: 'polarisTrails', body: null, ready: false });
  }
  return list;
}

// ── 크기와 거리 · 렌즈 ───────────────────────────────────────────────────

export type SizeId = 'top50' | 'top200' | 'whole';
export interface SizeChoice { id: SizeId; lengthM: number }

/** "꼭대기" 부분의 길이(m). */
export const TOP_PART_M = 50;

/** 해·달 원반이 가릴 대상 부분의 길이 선택. 건물은 꼭대기 50 m 와 전체 높이(꼭대기가 50 m 보다 낮으면 전체만), 땅은 50 m · 200 m. */
export function sizeChoices(t: Pick<PickedTarget, 'kind' | 'building'>): SizeChoice[] {
  if (t.kind === 'building' && t.building) {
    const out: SizeChoice[] = [];
    if (t.building.heightM > TOP_PART_M * 1.2) out.push({ id: 'top50', lengthM: TOP_PART_M });
    out.push({ id: 'whole', lengthM: t.building.heightM });
    return out;
  }
  return [{ id: 'top50', lengthM: TOP_PART_M }, { id: 'top200', lengthM: 200 }];
}

/** 해·달 원반의 평균 지름(°). 거리 안내용 대표값 — 찾을 때는 그때그때 달 거리로 구합니다. */
export const NOMINAL_DISK_DEG = 0.52;

/** 그 길이를 원반과 같은 크기로 보려면 필요한 비스듬한 거리(km). */
export const neededDistanceKm = (lengthM: number, ratio = 1): number => neededSlantDistanceM(lengthM, NOMINAL_DISK_DEG, ratio) / 1000;

/**
 * 원반이 필름(36×24 mm) 짧은 변의 1/3 을 차지하게 담는 35mm 환산 초점거리(mm): f = 12 / tan(1.5 × 원반). 0.52° 면 약 880 mm.
 * 대상 부분이 원반과 같은 크기로 걸리므로 대상 크기와 상관없이 같은 값입니다(`ratio` 가 1 이 아니면 원반 크기에 따라).
 */
export const FRAME_SHORT_FRACTION = 1 / 3;
export function neededFocalMm(diskDeg = NOMINAL_DISK_DEG): number {
  return 12 / Math.tan((diskDeg * Math.PI) / 180 / (2 * FRAME_SHORT_FRACTION));
}

// ── 대상 점 · 찾기 질의 ──────────────────────────────────────────────────

/**
 * 해·달을 걸 대상 점. 건물은 "꼭대기에 걸기"이므로 대상 점 칩이 "누른 곳"이어도 지붕 한가운데(`topPoint`), 땅은 고른 점 그대로.
 * 위경도를 모르면 null(질의를 만들 수 없음).
 */
export function suggestTargetPoint(t: PickedTarget): (TargetPoint & { latitude: number; longitude: number }) | null {
  const p: TargetPoint = t.kind === 'building' && t.building ? t.building.topPoint : t;
  return p.latitude != null && p.longitude != null ? (p as TargetPoint & { latitude: number; longitude: number }) : null;
}

export interface StandQueryArgs {
  target: PickedTarget;
  body: AlignBody;
  sizeM: number;
  fromMs: number;
  days: number;
  /** 지반 표본과 물 판정이 쓰는 틀의 원점(그 장면의 눈 위치)과, 그 틀의 지반 표본(장면). */
  origin: { latitude: number; longitude: number };
  ground: HeightSampler;
  isWater?: (eastM: number, southM: number) => boolean;
  eyeAboveGroundM?: number;
  epsDeg?: number;
  sizeRatio?: number;
}

/** 고른 대상과 설정으로 `findStandPoints` 질의를 만듭니다. 위경도를 모르는 대상이면 null. */
export function standQueryFor(a: StandQueryArgs): StandQuery | null {
  const p = suggestTargetPoint(a.target);
  if (!p) return null;
  return {
    body: a.body,
    target: { latitude: p.latitude, longitude: p.longitude, elevM: p.elevM },
    targetXZ: { eastM: p.eastM, southM: p.southM },
    origin: a.origin,
    sizeM: a.sizeM,
    sizeRatio: a.sizeRatio,
    fromMs: a.fromMs,
    days: a.days,
    eyeAboveGroundM: a.eyeAboveGroundM,
    epsDeg: a.epsDeg,
    ground: a.ground,
    isWater: a.isWater,
  };
}

// ── 서 있을 수 있는 땅인가 ────────────────────────────────────────────────

/** 지도 자료의 물 격자(`UrbanMaskResult.water` / `waterHi`): 눈 위치 둘레 ±halfM, size×size 칸, 128 이상이 물. */
export interface WaterGrid { size: number; halfM: number; data: Uint8Array }

/** 해수면 근처로 보는 높이(m): 이 이하의 땅은 바다·갯벌로 봅니다. */
export const SEA_LEVEL_WATER_M = 0.5;

/**
 * 서 있을 자리가 물인가(틀 좌표: 동 x, 남 z). 지도의 물 격자가 덮는 곳은 가장 촘촘한 격자부터 그 값을 따르고
 * (칸 열 = floor((x + halfM) × size / 2halfM), 행도 같은 식 — 건물 자리 깎기의 물 덮개와 같은 대응),
 * 격자가 덮지 않는 곳은 해수면 근처(해발 ≤ `seaLevelM`)면 물로 봅니다. 땅 자료가 없으면 물이 아닙니다(모르는 곳을 물로 막지 않음).
 * 지도 격자는 눈 위치 둘레 3 km 남짓이라 그 밖의 강·호수는 거르지 못하고, 바다는 해발로 걸러집니다.
 */
export function waterTest(grids: readonly WaterGrid[] | undefined, ground: HeightSampler, seaLevelM = SEA_LEVEL_WATER_M): (eastM: number, southM: number) => boolean {
  return (e, s) => {
    if (grids) {
      for (const g of grids) {
        const sc = g.size / (2 * g.halfM);
        const cx = Math.floor((e + g.halfM) * sc), cy = Math.floor((s + g.halfM) * sc);
        if (cx < 0 || cy < 0 || cx >= g.size || cy >= g.size) continue;
        return g.data[cy * g.size + cx] >= 128;
      }
    }
    const h = ground(e, s);
    return h != null && h <= seaLevelM;
  };
}

/**
 * 서 있을 자리로 옮긴 뒤 같은 대상을 새 자리 기준으로 다시 만듭니다(자리를 옮기면 고른 대상은 옛 눈 기준이라 지워지기 때문).
 * `tp` 는 새 눈에서 본 그 점(방위·앙각·거리·가림). 건물은 꼭대기를 대상 점으로 삼아(지붕 한가운데 = 누른 곳) 높이각만 새 거리로 다시 셉니다.
 */
export function rebuildPicked(kind: PickedTarget['kind'], building: BuildingInfo | undefined, tp: TargetPoint & { eyeElevM: number }): PickedTarget {
  if (kind === 'building' && building) {
    return {
      kind: 'building',
      ...tp,
      building: { ...building, topPoint: tp, hitPoint: tp, snapped: true, angularHeightDeg: apparentHeightDeg(tp.eyeElevM, tp.distM, building.baseElevM, building.topElevM) },
    };
  }
  return { kind: 'terrain', ...tp };
}

// ── 구름 예보 ────────────────────────────────────────────────────────────

/** 시간별 구름 예보(대상 위치). 시각은 UTC ms 오름차순, 구름은 총운량 %. 모델이 끝난 시각은 null 입니다. */
export interface CloudOutlook {
  timeMs: number[];
  cloudPct: (number | null)[];
}

export type ForecastState = 'clear' | 'partly' | 'cloudy' | 'unknown';
export interface Forecast { state: ForecastState; cloudPct: number | null }

/** 총운량 % 의 경계: 이 값 이하면 맑음, 이 값 이하면 보통, 그 위는 많음. */
export const CLEAR_MAX_PCT = 25;
export const PARTLY_MAX_PCT = 60;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 시간별 층 운량으로 예보 자료를 만듭니다. 총운량이 있으면 그것을, 없으면 세 층 중 가장 큰 값(최대 겹침)을 씁니다.
 * 세 값이 모두 비면 그 시각은 null.
 */
export function outlookFromHourly(h: { timeMs: number[]; total?: (number | null | undefined)[]; low?: (number | null | undefined)[]; mid?: (number | null | undefined)[]; high?: (number | null | undefined)[] }): CloudOutlook {
  const cloudPct = h.timeMs.map((_, i) => {
    const t = h.total?.[i];
    if (isNum(t)) return t;
    const layers = [h.low?.[i], h.mid?.[i], h.high?.[i]].filter(isNum);
    return layers.length === 3 ? Math.max(...layers) : null;
  });
  return { timeMs: h.timeMs, cloudPct };
}

const classify = (pct: number): Forecast => ({ state: pct <= CLEAR_MAX_PCT ? 'clear' : pct <= PARTLY_MAX_PCT ? 'partly' : 'cloudy', cloudPct: pct });

/**
 * 그 시각의 구름 예보. 시각 사이는 앞뒤 두 값의 1 차 보간(둘 다 있어야 함), 정각이면 그 값 하나면 됩니다.
 * 값이 비었거나 범위 밖이거나 자료가 없으면 "모름" — 맑다고 지어내지 않습니다.
 */
export function forecastAt(o: CloudOutlook | null | undefined, ms: number): Forecast {
  const unknown: Forecast = { state: 'unknown', cloudPct: null };
  const t = o?.timeMs;
  if (!o || !t?.length || ms < t[0] || ms > t[t.length - 1]) return unknown;
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= ms) lo = mid; else hi = mid; }
  const iB = Math.min(lo + 1, t.length - 1);
  const a = o.cloudPct[lo], b = o.cloudPct[iB];
  const span = t[iB] - t[lo];
  const f = span > 0 ? (ms - t[lo]) / span : 0;
  if (f <= 0) return isNum(a) ? classify(a) : unknown;
  if (f >= 1) return isNum(b) ? classify(b) : unknown;
  return isNum(a) && isNum(b) ? classify(a + (b - a) * f) : unknown;
}

// ── 순위 ─────────────────────────────────────────────────────────────────

export type SkyKind = 'day' | 'twilight' | 'night';
/** 그때 해의 겉보기 고도로 낮 · 황혼(0 ~ −12°) · 밤. */
export const skyKind = (sunAltDeg: number): SkyKind => (sunAltDeg > 0 ? 'day' : sunAltDeg > -12 ? 'twilight' : 'night');

export type EventPhase = 'rising' | 'setting' | 'high';
export type MoonShape = 'new' | 'crescent' | 'quarter' | 'gibbous' | 'full';
export interface MoonInfo { illum: number; waxing: boolean; shape: MoonShape }

export const moonShape = (illum: number): MoonShape =>
  illum >= 0.97 ? 'full' : illum <= 0.03 ? 'new' : illum < 0.4 ? 'crescent' : illum <= 0.6 ? 'quarter' : 'gibbous';

export interface StandCandidate {
  /** 같은 저녁·밤의 묶음 */
  group: StandGroup;
  /** 묶음의 대표 후보 */
  hit: StandHit;
  /** 찾기 시작한 시각에서 며칠 뒤 */
  days: number;
  forecast: Forecast;
  sky: SkyKind;
  /** 해·달이 하늘에서 지금 막 뜨는/지는 쪽(고도 20° 안)인가, 높이 떠 있는가 */
  phase: EventPhase;
  moon?: MoonInfo;
  score: number;
  recommended: boolean;
}

export const RECOMMEND_SCORE = 0.5;

const FORECAST_FACTOR: Record<ForecastState, number> = { clear: 1, unknown: 0.65, partly: 0.6, cloudy: 0.15 };

export function moonFactor(illum: number): number {
  return illum < 0.05 ? 0 : 0.2 + 0.8 * illum;
}
export function skyFactor(body: AlignBody, sunAltDeg: number, bodyAltDeg: number): number {
  if (body === 'moon') return sunAltDeg > 0 ? 0.45 : sunAltDeg > -12 ? 1 : 0.85;
  if (bodyAltDeg < -0.9) return 0;
  return bodyAltDeg <= 8 ? 1 : bodyAltDeg <= 20 ? 0.75 : bodyAltDeg <= 40 ? 0.5 : 0.3;
}

/** 해·달이 3 분 뒤에 더 높은가로 뜨는 중/지는 중을 가르고, 고도 20° 이상이면 높이 떠 있음. */
export function eventPhase(body: AlignBody, timeMs: number, latitude: number, longitude: number, elevM: number, altDeg: number): EventPhase {
  if (altDeg > 20) return 'high';
  const later = bodySky(body, timeMs + 3 * 60e3, latitude, longitude, elevM).altDeg;
  return later >= altDeg ? 'rising' : 'setting';
}

export interface RankOptions {
  body: AlignBody;
  /** 대상 위치(해·달 위치를 구하는 곳) */
  latitude: number;
  longitude: number;
  elevM: number;
  outlook?: CloudOutlook | null;
  /** "N 일 뒤"의 기준(찾기 시작한 시각) */
  searchFromMs: number;
  includeHidden?: boolean;
}

/** 묶음마다 점수를 매겨 점수 높은 순(비슷하면 이른 날짜)으로 정렬합니다. 점수 0 인 것(안 보이는 달·지평선 아래 해)과 가려진 자리(`includeHidden` 이 아니면)는 뺍니다. */
export function rankStands(groups: StandGroup[], o: RankOptions): StandCandidate[] {
  const out: StandCandidate[] = [];
  for (const g of groups) {
    const h = g.best;
    if (!h.visible && !o.includeHidden) continue;
    const forecast = forecastAt(o.outlook, h.timeMs);
    const sky = skyKind(h.sunAltDeg);
    let moon: MoonInfo | undefined;
    let mf = 1;
    if (o.body === 'moon') {
      const illum = h.illum ?? SunCalc.getMoonIllumination(new Date(h.timeMs)).fraction;
      const waxing = SunCalc.getMoonIllumination(new Date(h.timeMs)).phase < 0.5;
      moon = { illum, waxing, shape: moonShape(illum) };
      mf = moonFactor(illum);
    }
    const score = mf * skyFactor(o.body, h.sunAltDeg, h.altDeg) * FORECAST_FACTOR[forecast.state];
    if (score <= 0) continue;
    out.push({
      group: g,
      hit: h,
      days: Math.round((h.timeMs - o.searchFromMs) / 86400e3),
      forecast,
      sky,
      phase: eventPhase(o.body, h.timeMs, o.latitude, o.longitude, o.elevM, h.altDeg),
      moon,
      score,
      recommended: h.visible && score >= RECOMMEND_SCORE,
    });
  }
  return sortStands(out, 'score');
}

/**
 * 순위를 위에서부터 훑으며 고르되, 같은 쪽(뜨는/지는/높음)의 이미 고른 것과 `minGapDays` 안이면 건너뜁니다.
 * 달은 하루에 한 번 뜨고 한 번 져서 후보가 날마다 하나씩 있으므로, 거르지 않으면 보름 전후 사흘이 목록을 채웁니다.
 * 같은 날이라도 뜨는 쪽과 지는 쪽은 서로 다른 장면(동쪽·서쪽)이라 따로 셉니다. 순서는 `ranked` 그대로입니다.
 */
export function pickDistinct(ranked: StandCandidate[], max: number, minGapDays = 2): StandCandidate[] {
  const out: StandCandidate[] = [];
  for (const c of ranked) {
    if (out.length >= max) break;
    if (out.some(p => p.phase === c.phase && Math.abs(p.hit.timeMs - c.hit.timeMs) < minGapDays * 86400e3)) continue;
    out.push(c);
  }
  return out;
}

/** 점수 순(비슷하면 날짜순) 또는 날짜순. */
export function sortStands(list: StandCandidate[], by: 'score' | 'date'): StandCandidate[] {
  const copy = [...list];
  if (by === 'date') return copy.sort((a, b) => a.hit.timeMs - b.hit.timeMs);
  return copy.sort((a, b) => (Math.abs(b.score - a.score) > 0.02 ? b.score - a.score : a.hit.timeMs - b.hit.timeMs));
}
