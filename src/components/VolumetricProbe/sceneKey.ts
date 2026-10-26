/**
 * sceneKey.ts — 볼륨 장면을 **다시 만들지** 정하는 키(§165). 순수 함수 — `tools/shader-preview/verify-scene-key.js`.
 *
 * 왜: 키는 시각(시간 버킷)·자리·운량(5 % 눈금)·덱·바람으로만 만들어졌고 **DNI 광학두께 τ 와 비 0.3 mm 문턱이 없었습니다.**
 * 그래서 해가 5° 아래일 때 만든 ac 장면이, 해가 올라 τ 가 3 을 넘어도(§158 as 승격) 같은 시간 버킷 안에서는 그대로 남았습니다
 * (수원 2026-10-26 07:27 카드의 틈 원인 후보). 이제 τ 구간(없음·< 1.5·< 3·≥ 3)과 비 0.3 플래그, 중·상층 덱(0.5 km 눈금)이 키에 들어갑니다.
 */
import SunCalc from 'suncalc';
import type { CloudData } from '../../utils/weather';
import { METAR_MAX_AGE_MIN } from '../../utils/metar';
import { LAYER_BAND_KM, bandDeck } from '../../utils/cloudProfile';
import { GENUS_THRESHOLDS } from '../../utils/cloudGenusForecast';
import { cloudOpticalDepthFromDni } from '../../utils/dniOpticalDepth';
import { pickDni } from '../../utils/satelliteIrradiance';
import { profileOf, DNI_VEIL_TAU, DNI_SHEET_TAU } from './liveScene';

export type TauBucket = 'n' | '0' | '1' | '2';

/** τ → 승격 구간: n 없음(해 5° 아래·DNI 없음) · 0 얇음 · 1 베일(≥ DNI_VEIL_TAU) · 2 시트(≥ DNI_SHEET_TAU). */
export function tauBucket(tau: number | null | undefined): TauBucket {
  if (tau == null || !Number.isFinite(tau)) return 'n';
  if (tau >= DNI_SHEET_TAU) return '2';
  if (tau >= DNI_VEIL_TAU) return '1';
  return '0';
}

export interface SceneKeyInput {
  /** 장면 시각(ms) — 1 시간 버킷 */
  sceneMs: number;
  lat: number; lon: number; elevM: number;
  /** METAR 식별(icao@time) 또는 '' */
  metarId: string;
  /** METAR 보고 시각(ms) — 장면 시각이 ±METAR_MAX_AGE_MIN 창을 드나들 때 키가 바뀌게(덮어쓰기 발동 여부, metar.ts) */
  metarTimeMs?: number | null;
  /** 관측점 예보(없으면 null) */
  obs: CloudData | null | undefined;
  /** 고리 표본(5 번째 점) — 거시 장 변화 감지용 */
  sample: { low?: number; mid?: number; high?: number } | null | undefined;
}

const qCover = (v?: number | null) => (v != null ? Math.round(v / 5) * 5 : '');
const qAlt = (v?: number | null) => (v != null ? (Math.round(v * 2) / 2).toFixed(1) : '');
const qWind = (w?: number | null) => (w != null ? Math.round(w / 10) * 10 : '');

export function volSceneKey(i: SceneKeyInput): string {
  const o = i.obs ?? null;
  const bHour = Math.floor(i.sceneMs / 3600000);
  const precip = o?.precipitation ?? 0;
  // τ 의 태양 고도는 liveScene 과 **같은** SunCalc·같은 장면 시각으로 — 화면의 sunAltRef(solarPosition·5 분 보간)와 0.02~0.07° 어긋나
  // 5° 경계에서 키는 '2' 인데 장면은 τ 없음으로 만들어지는 틈(§165 검토 지적)을 막습니다.
  const sunAltDeg = (SunCalc.getPosition(new Date(i.sceneMs), i.lat, i.lon).altitude * 180) / Math.PI;
  const tau = o ? cloudOpticalDepthFromDni(pickDni(o).dni, sunAltDeg, o.aod550) : null;
  const metarActive = i.metarTimeMs != null && Math.abs(i.sceneMs - i.metarTimeMs) <= METAR_MAX_AGE_MIN * 60_000 ? 1 : 0;
  const prof = o ? profileOf(o) : [];
  const midDeck = prof.length ? bandDeck(prof, LAYER_BAND_KM.lowTop, LAYER_BAND_KM.midTop) : null;
  const highDeck = prof.length ? bandDeck(prof, LAYER_BAND_KM.midTop, 25) : null;
  return [
    bHour,
    i.lat.toFixed(2), i.lon.toFixed(2), Math.round(i.elevM / 100) * 100,
    i.metarId, metarActive,
    qCover(o?.low), qCover(o?.mid), qCover(o?.high),
    qAlt(o?.lowDeckBaseKm), qAlt(o?.lowDeckTopKm),
    qAlt(o?.layerAltMidKm), qAlt(o?.layerAltHighKm),
    qAlt(midDeck?.baseKm), qAlt(midDeck?.topKm), qAlt(highDeck?.baseKm), qAlt(highDeck?.topKm),
    precip >= 0.1 ? 1 : 0, precip >= GENUS_THRESHOLDS.nsPrecip ? 1 : 0,
    tauBucket(tau),
    qCover(i.sample?.low), qCover(i.sample?.mid), qCover(i.sample?.high),
    ...[o?.windULow, o?.windVLow, o?.windUMid, o?.windVMid, o?.windUHigh, o?.windVHigh].map(qWind),
  ].join('|');
}
