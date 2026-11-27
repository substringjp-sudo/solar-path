/**
 * metar.ts — 가장 가까운 공항의 METAR(실링미터 운저·층별 운량·현재 날씨)로 **지금 시각**의 저층을 덮어씁니다(§160, 2026-10-25).
 *
 * 왜: 예보 → 구름 종류는 어떤 방법으로도 관측자 종류를 다수 찍기 +10 %p 안에 못 맞힙니다(RULER-genus2 §7.1). 그러나 "밑면이 몇 m 인가,
 * 몇 옥타가 덮였나, 비가 오는가" 는 공항이 매시간 기계로 재서 공개합니다(aviationweather.gov, 공개 JSON). 관측이 있는 시각·자리에서는
 * 예보 저층 운량·덱 밑면·강수를 그 관측으로 바꿉니다. 미래·먼 과거·60 km 밖·90 분 넘은 보고에는 손대지 않습니다.
 *
 * METAR 층 운량은 **누적**(그 높이까지 덮인 하늘 비율)입니다: SCT015 BKN030 은 1,500 ft 까지 3~4 옥타, 3,000 ft 까지 5~7 옥타.
 * 저층(지상 2 km 미만) 누적 운량은 그대로 저층 운량으로, 중층(2~6.5 km) 은 누적에서 저층을 무작위 겹침으로 벗겨 그 층만의 운량으로 씁니다.
 * CAVOK 는 1,500 m 아래 구름 없음·적란운 없음(그 위는 모름), CLR·SKC·NSC·NCD 는 구름 없음(자동 관측은 3,660 m 아래)입니다.
 *
 * 판정: `tools/shader-preview/verify-observation-override.js`.
 */
import type { CloudData } from './weather';
import { gridBucket } from './weatherCacheKey';

export type MetarCover = 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV';
export interface MetarLayer { cover: MetarCover; baseFtAgl: number | null }
export interface MetarObs {
  icao: string;
  lat: number; lon: number;
  distanceKm: number;
  /** 관측 시각(ms) */
  timeMs: number;
  raw: string;
  layers: MetarLayer[];
  /** CAVOK·CLR·SKC·NSC·NCD — 구름 없음 표시(아래 clearBelowM 까지) */
  clearBelowM: number | null;
  wx: string | null;
  tempC?: number; dewC?: number;
  /** 지상 시정(m). 측정이 "N 이상"(예 6+ SM, 9999)이면 visCapped. 없으면 undefined. */
  visM?: number;
  visCapped?: boolean;
}

/** 옥타 → 운량(%): FEW 1~2 · SCT 3~4 · BKN 5~7 · OVC 8 · VV(수직시정, 하늘 안 보임) 8 */
export const OKTA_PCT: Record<MetarCover, number> = { FEW: 19, SCT: 44, BKN: 75, OVC: 100, VV: 100 };
export const METAR_MAX_AGE_MIN = 90;
export const METAR_MAX_KM = 60;
/** 창 밖의 서서히 줄어드는 꼬리(2026-11-27): 보고 ±90 분 · 공항 60 km 안은 무게 1, 각각 240 분 · 120 km 에서 0 — 문턱에서 한 번에 끊기지 않게. */
export const METAR_FADE_END_MIN = 240;
export const METAR_FADE_END_KM = 120;
export function metarWindowWeight(diffMin: number, distKm: number, fullMin = METAR_MAX_AGE_MIN, fullKm = METAR_MAX_KM): number {
  const d = Math.abs(diffMin);
  const wT = d <= fullMin ? 1 : d >= METAR_FADE_END_MIN ? 0 : (METAR_FADE_END_MIN - d) / (METAR_FADE_END_MIN - fullMin);
  const wD = distKm <= fullKm ? 1 : distKm >= METAR_FADE_END_KM ? 0 : (METAR_FADE_END_KM - distKm) / (METAR_FADE_END_KM - fullKm);
  return wT * wD;
}
const LOW_TOP_M = 2000, MID_TOP_M = 6500;
const FT = 0.3048;

export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** aviationweather.gov `/api/data/metar?format=json` 항목 하나 → MetarObs. 쓸 수 없는 항목은 null. */
export function parseMetarItem(it: any, lat: number, lon: number): MetarObs | null {
  if (!it || typeof it.icaoId !== 'string' || typeof it.lat !== 'number' || typeof it.lon !== 'number') return null;
  const timeMs = typeof it.obsTime === 'number' ? it.obsTime * 1000 : it.reportTime ? Date.parse(String(it.reportTime).replace(' ', 'T') + (String(it.reportTime).endsWith('Z') ? '' : 'Z')) : NaN;
  if (!Number.isFinite(timeMs)) return null;
  const layers: MetarLayer[] = [];
  let clearBelowM: number | null = null;
  for (const c of Array.isArray(it.clouds) ? it.clouds : []) {
    const cov = String(c?.cover ?? '').toUpperCase();
    if (cov === 'FEW' || cov === 'SCT' || cov === 'BKN' || cov === 'OVC' || cov === 'VV') {
      layers.push({ cover: cov as MetarCover, baseFtAgl: typeof c.base === 'number' && Number.isFinite(c.base) ? c.base : null });
    } else if (cov === 'CAVOK') clearBelowM = 1524;
    else if (cov === 'CLR' || cov === 'SKC' || cov === 'NSC' || cov === 'NCD') clearBelowM = Math.max(clearBelowM ?? 0, 3660);
  }
  const raw = typeof it.rawOb === 'string' ? it.rawOb : '';
  if (!layers.length && clearBelowM == null && /\bCAVOK\b/.test(raw)) clearBelowM = 1524;
  if (!layers.length && clearBelowM == null && /\b(CLR|SKC|NSC|NCD)\b/.test(raw)) clearBelowM = 3660;
  if (!layers.length && clearBelowM == null) return null;   // 구름 정보가 없는 보고는 쓰지 않음
  return {
    icao: it.icaoId, lat: it.lat, lon: it.lon, distanceKm: haversineKm(lat, lon, it.lat, it.lon), timeMs, raw, layers, clearBelowM,
    wx: typeof it.wxString === 'string' && it.wxString ? it.wxString : null,
    tempC: typeof it.temp === 'number' ? it.temp : undefined, dewC: typeof it.dewp === 'number' ? it.dewp : undefined,
    ...metarVisibility(it, raw),
  };
}

const SM_M = 1609.344;
/**
 * 시정(m). aviationweather.gov JSON 의 `visib`(법정 마일, 숫자 또는 "6+")를 쓰고, 없으면 원문에서(미터 4 자리 · "8SM" · CAVOK) 읽습니다.
 * "N 이상"(9999 · 6+SM · CAVOK)은 상한 보고라 visCapped — 박무 · 안개 판정에는 못 쓰고 "그 이상 맑음"으로만 둡니다.
 */
export function metarVisibility(it: any, raw: string): { visM?: number; visCapped?: boolean } {
  const v = it?.visib;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { visM: v * SM_M, visCapped: false };
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= 0) return { visM: n * SM_M, visCapped: /\+/.test(v) };
  }
  if (/\bCAVOK\b/.test(raw)) return { visM: 10000, visCapped: true };
  const mSm = raw.match(/\b(\d{1,2})(?:\/(\d))?SM\b/);
  if (mSm) return { visM: (mSm[2] ? Number(mSm[1]) / Number(mSm[2]) : Number(mSm[1])) * SM_M, visCapped: false };
  const mM = raw.match(/\b(\d{4})\b(?=\s)/);
  if (mM) { const n = Number(mM[1]); return { visM: n, visCapped: n >= 9999 }; }
  return {};
}

/** 여러 항목 중 가장 가까운 공항의 **가장 최근** 보고. */
export function pickNearestMetar(items: any[], lat: number, lon: number): MetarObs | null {
  const parsed = items.map(it => parseMetarItem(it, lat, lon)).filter((m): m is MetarObs => !!m);
  if (!parsed.length) return null;
  parsed.sort((a, b) => a.distanceKm - b.distanceKm || b.timeMs - a.timeMs);
  const icao = parsed[0].icao;
  return parsed.filter(m => m.icao === icao).sort((a, b) => b.timeMs - a.timeMs)[0];
}

export interface MetarSky {
  /** 저층(지상 2 km 미만) 운량(%). 정보 없으면 null. */
  lowCoverPct: number | null;
  /** 중층(2~6.5 km) 그 층만의 운량(%). 정보 없으면 null. */
  midCoverPct: number | null;
  /** 가장 낮은 층 밑면(지상 위 km) */
  lowBaseKmAgl: number | null;
  raining: boolean; snowing: boolean; thunder: boolean;
}

export function metarSky(m: MetarObs): MetarSky {
  let lowCum: number | null = null, midCum: number | null = null, lowBase: number | null = null;
  for (const l of m.layers) {
    const baseM = l.baseFtAgl != null ? l.baseFtAgl * FT : null;
    const pct = OKTA_PCT[l.cover];
    if (baseM == null || baseM < LOW_TOP_M) { lowCum = Math.max(lowCum ?? 0, pct); if (baseM != null) lowBase = Math.min(lowBase ?? Infinity, baseM / 1000); }
    else if (baseM < MID_TOP_M) midCum = Math.max(midCum ?? 0, pct);
  }
  if (m.clearBelowM != null) {
    if (lowCum == null) lowCum = 0;
    if (m.clearBelowM >= MID_TOP_M * 0.5 && midCum == null) midCum = 0;   // CLR(3,660 m 아래 없음)은 중층 아래 절반까지만 말함 → 중층 0 으로 둠
  }
  // 중층 누적에서 저층을 무작위 겹침으로 벗김: cum = 1 − (1−low)(1−mid) → mid = 1 − (1−cum)/(1−low)
  let midOnly: number | null = midCum;
  if (midCum != null && lowCum != null && lowCum < 100) midOnly = Math.max(0, Math.min(100, 100 * (1 - (1 - midCum / 100) / (1 - lowCum / 100))));
  else if (midCum != null && lowCum != null && lowCum >= 100) midOnly = null;   // 저층이 다 덮으면 중층은 알 수 없음
  const wx = m.wx ?? '';
  return {
    lowCoverPct: lowCum, midCoverPct: midOnly, lowBaseKmAgl: lowBase,
    raining: /(^|[^A-Z])(SH)?(RA|DZ)|TSRA/.test(wx) && !/FZ/.test(wx) || /FZRA|FZDZ/.test(wx),
    snowing: /SN|SG|PL|GS|GR/.test(wx),
    thunder: /TS/.test(wx),
  };
}

export interface MetarOverride { obs: CloudData; note: string; sky: MetarSky }

/**
 * 장면 시각이 보고 ±maxAgeMin 안이고 공항이 maxKm 안일 때만 저층(중층)·밑면·강수를 관측으로 바꿉니다. 아니면 null(예보 그대로).
 * 바뀐 obs 는 복사본입니다.
 */
export function applyMetarToObs(obs: CloudData, m: MetarObs | null | undefined, sceneMs: number, groundM: number,
  opts: { maxAgeMin?: number; maxKm?: number } = {}): MetarOverride | null {
  if (!m) return null;
  // 창 안(±90 분 · 60 km)은 무게 1 — 예전과 똑같이 덮어씀. 창 밖은 무게가 0 까지 서서히 줄고, 숫자(운량)는 무게만큼만 섞음(밑면 높이 · 강수 문장은 무게 ≥ ½ 일 때).
  const w = metarWindowWeight((sceneMs - m.timeMs) / 60_000, m.distanceKm, opts.maxAgeMin ?? METAR_MAX_AGE_MIN, opts.maxKm ?? METAR_MAX_KM);
  if (!(w > 0)) return null;
  const sky = metarSky(m);
  const out: CloudData = { ...obs };
  const parts: string[] = [];
  const mixPct = (cur: number | undefined, target: number) => (w >= 1 || cur == null || !Number.isFinite(cur) ? target : cur + (target - cur) * w);
  if (sky.lowCoverPct != null) {
    // 비·눈 관측과 함께 공항 METAR 가 BKN(5~7 옥타 = 62.5~87.5%)이고 원 예보가 이미 흐림(>= 85% / 총운량 >= 90%)이면
    // 최대 60 km 떨어진 공항의 BKN 대푯값 75%로 내려 비구름 채우기가 깨지지 않도록 하한(88%)을 유지합니다.
    const keepOvercastRain =
      (sky.raining || sky.snowing) &&
      sky.lowCoverPct === OKTA_PCT.BKN &&
      (obs.low ?? 0) >= 85 &&
      (obs.total ?? obs.low ?? 0) >= 90;
    const effectiveLow = keepOvercastRain ? Math.max(88, Math.min(95, obs.low)) : sky.lowCoverPct;
    out.low = mixPct(obs.low, effectiveLow); parts.push(`저 ${Math.round(out.low)}%`);
    if (w >= 0.5 && sky.lowBaseKmAgl != null && effectiveLow > 0) {
      const base = groundM / 1000 + sky.lowBaseKmAgl;
      const oldThick = obs.lowDeckBaseKm != null && obs.lowDeckTopKm != null ? obs.lowDeckTopKm - obs.lowDeckBaseKm : NaN;
      out.lowDeckBaseKm = base;
      out.lowDeckTopKm = base + (Number.isFinite(oldThick) ? Math.max(0.3, oldThick) : 0.8);
      parts.push(`밑면 ${Math.round(sky.lowBaseKmAgl * 1000)} m`);
    }
    // 단면 운량은 예보 것이라 METAR 와 어긋날 수 있음 — 저층이 0 이면 2 km 아래 단면도 비움(lowDeck 이 다시 생기지 않게)
    if (w >= 0.5 && sky.lowCoverPct === 0 && out.profileHeightM && out.profileCoverPct) {
      out.profileCoverPct = out.profileCoverPct.map((c, i) => (out.profileHeightM![i] - groundM < LOW_TOP_M ? 0 : c));
      out.lowDeckBaseKm = undefined; out.lowDeckTopKm = undefined;
    }
  }
  if (sky.midCoverPct != null) { out.mid = mixPct(obs.mid, sky.midCoverPct); parts.push(`중 ${Math.round(out.mid)}%`); }
  if (w < 0.5) { /* 약한 무게에서는 강수 문장은 건드리지 않음 */ }
  else if (sky.raining || sky.snowing) { out.precipitation = Math.max(obs.precipitation ?? 0, 0.5); parts.push(sky.snowing ? '눈' : '비'); }
  else if (out.precipitation != null && out.precipitation >= 0.3 && m.wx == null && sky.lowCoverPct != null) {
    // 보고에 날씨가 없으면 지금 비는 안 옴 — 예보 강수를 0.1 아래로 내려 ns 가 되지 않게
    out.precipitation = Math.min(out.precipitation, 0.05); parts.push('강수 없음');
  }
  const hhmm = new Date(m.timeMs).toISOString().slice(11, 16) + 'Z';
  return { obs: out, sky, note: `METAR ${m.icao} ${Math.round(m.distanceKm)} km ${hhmm}${w < 1 ? ` (${Math.round(w * 100)}%)` : ''}: ${parts.join(' · ')}` };
}

const reportsCache = new Map<string, { at: number; reports: MetarObs[] }>();
const CACHE_MS = 10 * 60_000;

/** 가장 가까운 공항의 **가장 최근** 보고(이미 파싱한 보고 목록에서). */
export function nearestStationLatest(reports: readonly MetarObs[]): MetarObs | null {
  if (!reports.length) return null;
  const sorted = [...reports].sort((a, b) => a.distanceKm - b.distanceKm || b.timeMs - a.timeMs);
  const icao = sorted[0].icao;
  return sorted.filter(m => m.icao === icao).sort((a, b) => b.timeMs - a.timeMs)[0];
}

/**
 * 주변(±1.5°, 약 165 km 상자) 공항의 최근 6 시간 보고. 상자를 ±2° 이상으로 넓히면 API 가 가까운 군용 공항(성남 RKSM · 평택 RKSG)을 조용히 빼서 ±1.5° 로 둡니다(2026-11-27 측정). 고리 보정은 공항 여러 곳을 · 시간에 따라 서서히 줄이며 씁니다(`metarRing.ts`).
 * 실패·없음 → 빈 배열. 10 분 캐시. 자리마다 거리는 (lat, lon) 기준.
 */
export const fetchMetarReports = async (lat: number, lon: number, signal?: AbortSignal): Promise<MetarObs[]> => {
  const key = `metar_${gridBucket(lat, lon)}`;
  const hit = reportsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.reports;
  const d = 1.5;
  const url = `https://aviationweather.gov/api/data/metar?bbox=${(lat - d).toFixed(2)},${(lon - d).toFixed(2)},${(lat + d).toFixed(2)},${(lon + d).toFixed(2)}&format=json&hours=6`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    const reports = (Array.isArray(items) ? items : []).map(it => parseMetarItem(it, lat, lon)).filter((m): m is MetarObs => !!m);
    reportsCache.set(key, { at: Date.now(), reports });
    return reports;
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('METAR 를 받지 못했습니다. 예보 그대로 갑니다:', error);
    reportsCache.set(key, { at: Date.now(), reports: [] });
    return [];
  } finally {
    clearTimeout(timer);
  }
};

/** 가장 가까운 공항의 최근 보고(관측점 덮어쓰기용). 실패·없음 → null. */
export const fetchNearestMetar = async (lat: number, lon: number, signal?: AbortSignal): Promise<MetarObs | null> =>
  nearestStationLatest(await fetchMetarReports(lat, lon, signal));
