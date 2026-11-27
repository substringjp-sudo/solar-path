/**
 * metarRing.ts — 근처 공항 여러 곳의 관측(METAR)으로 **거시 운량 고리**(예보)를 보정합니다(2026-11-27).
 *
 * 왜: 앱은 METAR 로 관측점의 저층 운량을 바꾸지만(`applyMetarToObs`), 구름을 하늘에 까는 거시 격자는 예보 고리 그대로였습니다.
 * 격자가 타일 운량을 "그 자리 고리 운량"까지 깎으므로, 관측이 75 % 여도 예보가 7 % 면 화면엔 1 % 만 남았습니다(07:13 서울 사진, 하네스 1.2 % ↔ 고리도 보정 28 %).
 *
 * 방법(조건문으로 켜고 끄지 않고 값으로 이어지게):
 *   1. 공항(보고)마다 "관측 − 그 자리 예보 고리 값"(잔차)을 구합니다. 예보 값은 그 공항 둘레 고리 점 4 개의 거리 역제곱 평균.
 *   2. 고리 점마다 잔차를 거리 · 시간 무게로 모아 더합니다(Barnes 식): Δ = Σ w·r / (Σ w + W0), w = 시간무게 × exp(−½(d/L)²).
 *      관측이 없는 곳은 Σ w 가 0 에 가까워 Δ → 0 (예보 그대로). 공항이 여럿이면 가까운 쪽이 더 많이 끌어당깁니다.
 *   3. 시간 무게: 보고 ±90 분은 1, 240 분에서 0 으로 서서히(보고 시각이 지나도 한 번에 끊기지 않음).
 *   층은 METAR 가 말하는 만큼만: 저층(2 km 아래)은 거의 항상, 중층(2~6.5 km)은 그 층 운량이 있을 때만. 상층은 METAR 가 못 보므로 손대지 않음.
 *
 * 판정: `tools/shader-preview/verify-metar-ring.js`.
 */
import { metarSky, haversineKm, type MetarObs } from './metar';

export interface RingPt { distance: number; azimuthOffset: number; cover: number }
export type MacroRingBands = Partial<Record<'low' | 'mid' | 'high', RingPt[]>>;

/** 관측 하나가 영향을 주는 수평 거리 척도(km) — 저층운 상관 길이 수십 km. */
export const METAR_RING_L_KM = 50;
/** 사전(예보) 무게 — 관측이 하나도 가깝지 않을 때 Δ 를 0 으로 되돌립니다. 관측 바로 위에서는 잔차의 W/(W+W0) = 91 %. */
export const METAR_RING_W0 = 0.1;
/** 보고 시각 ±이 만큼은 무게 1, 이 뒤로 METAR_FADE_END_MIN 에서 0. */
export const METAR_FULL_MIN = 90;
export const METAR_FADE_END_MIN = 240;
/** 이보다 먼 공항은 안 씁니다(고리 반지름 안). */
export const METAR_RING_MAX_KM = 360;

/** 보고와 장면 시각 차(분) → 시간 무게 0~1. */
export function metarTimeWeight(diffMin: number): number {
  const d = Math.abs(diffMin);
  if (d <= METAR_FULL_MIN) return 1;
  if (d >= METAR_FADE_END_MIN) return 0;
  return (METAR_FADE_END_MIN - d) / (METAR_FADE_END_MIN - METAR_FULL_MIN);
}

const toXY = (distance: number, azDeg: number): [number, number] => {
  const a = (azDeg * Math.PI) / 180;
  return [distance * Math.sin(a), distance * Math.cos(a)];
};

/** 공항별로 장면 시각에 가장 가까운 보고 하나만. */
export function nearestReportPerStation(reports: readonly MetarObs[], sceneMs: number): MetarObs[] {
  const best = new Map<string, MetarObs>();
  for (const r of reports) {
    const cur = best.get(r.icao);
    if (!cur || Math.abs(r.timeMs - sceneMs) < Math.abs(cur.timeMs - sceneMs)) best.set(r.icao, r);
  }
  return [...best.values()];
}

/** 고리 한 층에서 (x, y) km 자리의 값 — 가까운 점 4 개의 거리 역제곱 평균. 점이 150 km 안에 없으면 null. */
function ringValueAt(pts: readonly RingPt[], x: number, y: number): number | null {
  const near: { d: number; c: number }[] = [];
  for (const p of pts) {
    const [px, py] = toXY(p.distance, p.azimuthOffset);
    const d = Math.hypot(px - x, py - y);
    if (near.length < 4) { near.push({ d, c: p.cover }); near.sort((a, b) => a.d - b.d); }
    else if (d < near[3].d) { near[3] = { d, c: p.cover }; near.sort((a, b) => a.d - b.d); }
  }
  if (!near.length || near[0].d > 150) return null;
  let sw = 0, sv = 0;
  for (const n of near) { const w = 1 / (n.d * n.d + 25); sw += w; sv += w * n.c; }
  return sv / sw;
}

/**
 * 고리(저 · 중 · 상)를 공항 관측으로 보정한 **복사본**과 쓴 공항 수. 원본은 바꾸지 않습니다(캐시된 고리를 그대로 두기 위해).
 * `sceneMs` 는 이 고리가 가리키는 시각(30 분 매듭마다 따로 부르면 시간에 따라 이어집니다).
 */
export function correctMacroRing(
  ring: MacroRingBands, reports: readonly MetarObs[] | null | undefined, sceneMs: number, lat: number, lon: number,
): { ring: MacroRingBands; used: number } {
  if (!reports?.length) return { ring, used: 0 };
  type St = { x: number; y: number; wT: number; low: number | null; mid: number | null };
  const stations: St[] = [];
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const r of nearestReportPerStation(reports, sceneMs)) {
    const wT = metarTimeWeight((sceneMs - r.timeMs) / 60_000);
    if (!(wT > 0)) continue;
    if (haversineKm(lat, lon, r.lat, r.lon) > METAR_RING_MAX_KM) continue;
    const sky = metarSky(r);
    if (sky.lowCoverPct == null && sky.midCoverPct == null) continue;
    stations.push({
      x: (r.lon - lon) * 111.32 * cosLat, y: (r.lat - lat) * 110.57, wT,
      low: sky.lowCoverPct != null ? sky.lowCoverPct / 100 : null,
      mid: sky.midCoverPct != null ? sky.midCoverPct / 100 : null,
    });
  }
  if (!stations.length) return { ring, used: 0 };

  const out: MacroRingBands = { ...ring };
  let usedAny = false;
  for (const band of ['low', 'mid'] as const) {
    const pts = ring[band];
    if (!pts?.length) continue;
    // 공항별 잔차(관측 − 그 자리 예보 고리)
    const res: { x: number; y: number; wT: number; r: number }[] = [];
    for (const s of stations) {
      const obs = s[band];
      if (obs == null) continue;
      const f = ringValueAt(pts, s.x, s.y);
      if (f == null) continue;
      res.push({ x: s.x, y: s.y, wT: s.wT, r: obs - f });
    }
    if (!res.length) continue;
    out[band] = pts.map(p => {
      const [px, py] = toXY(p.distance, p.azimuthOffset);
      let sw = 0, sr = 0;
      for (const q of res) {
        const d = Math.hypot(px - q.x, py - q.y);
        const w = q.wT * Math.exp(-0.5 * (d / METAR_RING_L_KM) ** 2);
        sw += w; sr += w * q.r;
      }
      const delta = sr / (sw + METAR_RING_W0);
      return { ...p, cover: Math.min(1, Math.max(0, p.cover + delta)) };
    });
    usedAny = true;
  }
  return usedAny ? { ring: out, used: stations.length } : { ring, used: 0 };
}

/** 시정 모으기: 이 무게 합 아래면(가까운 공항 없음) 쓰지 않음. 공항 한 곳이 20 km 안이면 합 ≈ 0.9. */
export const VIS_MIN_WEIGHT = 0.15;
/** 시정의 공간 규모(km) — 박무 · 안개 덩어리는 구름 고리보다 좁게 봅니다. */
export const VIS_L_KM = 40;

/**
 * 장면 위치의 지상 시정(m): 공항별 가장 가까운 시각 보고의 시정을 로그 영역에서 거리 · 시간 무게로 평균.
 * "N 이상" 상한 보고(9999 · 6+SM · CAVOK)는 그 값 이상이라는 뜻이라 더 탁한 보고가 하나라도 있으면 탁한 쪽이 이김(상한 보고는 무게 반).
 * 쓸 보고가 없거나 무게 합이 VIS_MIN_WEIGHT 미만이면 null(예보 시정 그대로).
 */
export function visibilityFromReports(reports: readonly MetarObs[], sceneMs: number, lat: number, lon: number): { visM: number; used: number } | null {
  let sw = 0, sl = 0, used = 0;
  for (const r of nearestReportPerStation(reports, sceneMs)) {
    if (r.visM == null || !(r.visM > 0)) continue;
    const d = haversineKm(lat, lon, r.lat, r.lon);
    if (d > 150) continue;
    const wT = metarTimeWeight((sceneMs - r.timeMs) / 60_000);
    let w = wT * Math.exp(-0.5 * (d / VIS_L_KM) ** 2);
    if (r.visCapped) w *= 0.5;
    if (!(w > 1e-4)) continue;
    sw += w; sl += w * Math.log(r.visM); used++;
  }
  if (sw < VIS_MIN_WEIGHT) return null;
  return { visM: Math.exp(sl / sw), used };
}
