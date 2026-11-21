/**
 * lunarEclipse.ts — **월식**의 접촉 시각과 크기(docs/SANDBOX_MODE_PLAN.md 목업 13 · 이벤트 모드의 바탕). 순수 함수.
 *
 * 지심 달 위치는 `moonPosition.ts`(Meeus 47 장), 해는 Meeus 25 장의 저정밀 식(황경 ≲ 0.01°, 거리)을 씁니다.
 * 월식은 달이 지구 그림자 축(해의 반대쪽 점)에서 떨어진 각거리 s 로 정해집니다. 그림자의 반지름은 달 거리에서의 각:
 *   본그림자 r_u = k·(π_달 + π_해 − s_해), 반그림자 r_p = k·(π_달 + π_해 + s_해)   (π = 수평시차, s_해 = 해의 반지름, k = 대기 때문에 키우는 비율)
 * 접촉은 s = r + s_달(바깥 접촉) · s = r − s_달(안쪽 접촉)일 때입니다. 크기(magnitude) = (r + s_달 − s_최소) ÷ (2·s_달)(본그림자 크기는 0~1 이 부분식, 1 이상이 개기).
 * 시각은 UT(ms)입니다. 판정(`tools/shader-preview/verify-lunar-eclipse.js`)은 NASA 월식 목록 값을 기준으로 합니다.
 */
import { moonGeocentric } from './moonPosition';

const RAD = Math.PI / 180;
const MS_DAY = 86400000;
const SYNODIC_DAYS = 29.530588853;
/** 알려진 보름달(2000-01-21 04:40 UT)에서 평균 삭망월씩 짚어 갑니다. */
const FULL_MOON_REF_MS = Date.UTC(2000, 0, 21, 4, 40, 0);
/** 본그림자 · 반그림자를 키우는 비율(지구 대기). 값의 근거는 판정 머리글 · 아래 상수 설명. */
export const SHADOW_ENLARGE = 1.0118;
const EARTH_EQ_RADIUS_KM = 6378.14;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** 해의 지심 겉보기 황경(°)과 거리(AU) — Meeus 25 장 저정밀 식. */
function sunLonAndR(ms: number): { lonDeg: number; r: number } {
  const T = (ms / MS_DAY + 2440587.5 - 2451545) / 36525;
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
  const e = 0.016708634 - 0.000042037 * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const lon = L0 + C;
  const nu = M + C * RAD;
  const r = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu));
  const omega = (125.04 - 1934.136 * T) * RAD;
  return { lonDeg: norm360(lon - 0.00569 - 0.00478 * Math.sin(omega)), r };
}

interface Geom { s: number; ru: number; rp: number; sm: number }

/** 그 시각의 달–그림자 축 각거리 s(°), 본그림자 · 반그림자 반지름(°), 달 반지름(°). */
function geom(ms: number): Geom {
  const m = moonGeocentric(new Date(ms));
  const sun = sunLonAndR(ms);
  const antiLon = (sun.lonDeg + 180) * RAD;
  const lam = m.lonDeg * RAD, bet = m.latDeg * RAD;
  const cosS = Math.cos(bet) * Math.cos(lam - antiLon); // 그림자 축의 황위는 0
  const s = Math.acos(Math.max(-1, Math.min(1, cosS))) / RAD;
  const piMoon = Math.asin(EARTH_EQ_RADIUS_KM / m.distKm) / RAD;
  const piSun = 8.794 / 3600 / sun.r;
  const sSun = 959.63 / 3600 / sun.r;
  const sm = Math.asin(1737.4 / m.distKm) / RAD;
  return { s, ru: SHADOW_ENLARGE * (piMoon + piSun - sSun), rp: SHADOW_ENLARGE * (piMoon + piSun + sSun), sm };
}

export interface LunarEclipse {
  kind: 'total' | 'partial' | 'penumbral';
  greatestMs: number;
  umbralMag: number;
  penumbralMag: number;
  p1Ms: number; u1Ms: number | null; u2Ms: number | null; u3Ms: number | null; u4Ms: number | null; p4Ms: number;
}

/** 구간 [a, b] 에서 f 가 가장 작은 시각(황금비 탐색, 달 · 해가 부드러워 한 골짜기). */
function minimize(f: (t: number) => number, a: number, b: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d);
  while (b - a > 500) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

/** f(t) = 0 인 시각(f 가 a 에서 음, b 에서 양이거나 그 반대) — 이분법. */
function bisect(f: (t: number) => number, a: number, b: number): number {
  let fa = f(a);
  for (let i = 0; i < 60 && b - a > 200; i++) {
    const m = (a + b) / 2, fm = f(m);
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

/**
 * `approxMs` 앞뒤 1.5 일 안에서 달이 그림자 축에 가장 가까운 때를 찾아 월식을 돌려줍니다. 반그림자도 못 지나면 null.
 * 부분 · 개기 접촉은 해당하는 것만 시각이 있고 나머지는 null.
 */
export function lunarEclipseAt(approxMs: number): LunarEclipse | null {
  if (!Number.isFinite(approxMs)) return null;
  const tg = minimize(t => geom(t).s, approxMs - 1.5 * MS_DAY, approxMs + 1.5 * MS_DAY);
  const g = geom(tg);
  if (g.s >= g.rp + g.sm) return null;
  const span = 4 * 3600_000; // 접촉은 가장 깊은 때에서 3~4 시간 안
  const edge = (radius: (x: Geom) => number, sign: 1 | -1) => (t: number) => geom(t).s - (radius(geom(t)) + sign * geom(t).sm);
  const contact = (radius: (x: Geom) => number, sign: 1 | -1): [number, number] | null => {
    const f = edge(radius, sign);
    if (f(tg) >= 0) return null; // 가장 깊은 때에도 그 접촉선에 못 닿음
    return [bisect(f, tg - span, tg), bisect(f, tg, tg + span)];
  };
  const pen = contact(x => x.rp, 1)!;
  const par = contact(x => x.ru, 1);
  const tot = contact(x => x.ru, -1);
  const umbralMag = (g.ru + g.sm - g.s) / (2 * g.sm);
  const penumbralMag = (g.rp + g.sm - g.s) / (2 * g.sm);
  return {
    kind: tot ? 'total' : par ? 'partial' : 'penumbral',
    greatestMs: tg, umbralMag, penumbralMag,
    p1Ms: pen[0], u1Ms: par ? par[0] : null, u2Ms: tot ? tot[0] : null, u3Ms: tot ? tot[1] : null, u4Ms: par ? par[1] : null, p4Ms: pen[1],
  };
}

/** `fromMs` 이후 가장 가까운 월식(보름달을 평균 삭망월씩 짚어 찾음). 80 번(약 6 년) 안에 못 찾으면 null(실제로는 늘 찾음). */
export function nextLunarEclipse(fromMs: number): LunarEclipse | null {
  if (!Number.isFinite(fromMs)) return null;
  let k = Math.ceil((fromMs - FULL_MOON_REF_MS) / (SYNODIC_DAYS * MS_DAY)) - 1;
  for (let i = 0; i < 80; i++, k++) {
    const e = lunarEclipseAt(FULL_MOON_REF_MS + k * SYNODIC_DAYS * MS_DAY);
    if (e && e.greatestMs >= fromMs) return e;
  }
  return null;
}
