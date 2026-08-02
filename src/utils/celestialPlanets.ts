/**
 * celestialPlanets.ts
 *
 * Why: 기존 코드는 황경(L)을 직접 적경(RA)으로 사용하고 적위(Dec)를 극히 작은 값으로
 * 근사해, 실제 황도 경사(ε≈23.44°)가 전혀 반영되지 않았습니다.
 * 결과적으로 행성이 적도면에만 몰려 달/별과 전혀 다른 궤도에 찍혔습니다.
 *
 * 수정: Jean Meeus "Astronomical Algorithms" Ch.33 기반
 * 케플러 원소 → 황도 좌표(태양중심→지심) → 적도 좌표 변환 파이프라인.
 * 오차 약 1° 이내 (시각화 용도로 충분).
 */
import { EquatorialCoord, equatorialToHorizontal } from './celestialCoords';

export type PlanetKey = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn';

export interface PlanetData {
  key: PlanetKey;
  nameKo: string;
  nameEn: string;
  symbol: string;
  magnitude: number;
}

export const PLANETS_METADATA: Record<PlanetKey, PlanetData> = {
  mercury: { key: 'mercury', nameKo: '수성',       nameEn: 'Mercury', symbol: '☿', magnitude: -0.4 },
  venus:   { key: 'venus',   nameKo: '금성 (샛별)', nameEn: 'Venus',   symbol: '♀', magnitude: -4.4 },
  mars:    { key: 'mars',    nameKo: '화성',        nameEn: 'Mars',    symbol: '♂', magnitude: -1.5 },
  jupiter: { key: 'jupiter', nameKo: '목성',        nameEn: 'Jupiter', symbol: '♃', magnitude: -2.7 },
  saturn:  { key: 'saturn',  nameKo: '토성',        nameEn: 'Saturn',  symbol: '♄', magnitude:  0.2 },
};

// ── 황도 경사 (J2000 기준) ──────────────────────────────────────────────────
const ECLIPTIC_OBL_RAD = (23.4392911 * Math.PI) / 180;

function toRad(d: number): number { return (d * Math.PI) / 180; }
function toDeg(r: number): number { return (r * 180) / Math.PI; }
function mod360(x: number): number { return ((x % 360) + 360) % 360; }

/** J2000.0 기준 율리우스 경과일 */
function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
}

/** 케플러 방정식 반복 풀이 → 이심 근점이각 E (라디안) */
function solveKepler(M_deg: number, e: number): number {
  const M = toRad(mod360(M_deg));
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let k = 0; k < 12; k++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

/** 황도 좌표 (λ°, β°) → 적도 좌표 (RA h, Dec °) */
function eclToEq(lambdaDeg: number, betaDeg: number): EquatorialCoord {
  const lam = toRad(lambdaDeg);
  const bet = toRad(betaDeg);
  const eps = ECLIPTIC_OBL_RAD;
  const sinDec = Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam);
  const decRad = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const y = Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps);
  const raDeg = mod360(toDeg(Math.atan2(y, Math.cos(lam))));
  return { raHours: raDeg / 15, decDeg: toDeg(decRad) };
}

// ── 케플러 원소 (Meeus App.II, J2000.0, T=율리우스세기) ──────────────────────
interface Elem {
  a0: number; aT: number;  // 장반경 (AU)
  e0: number; eT: number;  // 이심률
  i0: number; iT: number;  // 궤도 경사 (°)
  O0: number; OT: number;  // 승교점 경도 Ω (°)
  w0: number; wT: number;  // 근일점 경도 ϖ = Ω+ω (°)
  L0: number; LT: number;  // 평균 경도 (°)
}

const EL: Record<string, Elem> = {
  earth: {
    a0:1.000001018,  aT:0,
    e0:0.01670862,   eT:-0.000042037,
    i0:0,            iT:0,
    O0:0,            OT:0,
    w0:102.937348,   wT:0.3225557,
    L0:100.466449,   LT:35999.3728519,
  },
  mercury: {
    a0:0.387098310,  aT:0,
    e0:0.20563175,   eT:0.000020406,
    i0:7.004986,     iT:-0.0059516,
    O0:48.330893,    OT:-0.1254229,
    w0:77.456119,    wT:0.1588643,
    L0:252.250906,   LT:149472.6746358,
  },
  venus: {
    a0:0.723329820,  aT:0,
    e0:0.00677188,   eT:-0.000047766,
    i0:3.394662,     iT:-0.0008568,
    O0:76.679920,    OT:-0.2780080,
    w0:131.563707,   wT:0.0048646,
    L0:181.979801,   LT:58517.8156760,
  },
  mars: {
    a0:1.523679342,  aT:0,
    e0:0.09340062,   eT:0.000090483,
    i0:1.849726,     iT:-0.0081477,
    O0:49.558093,    OT:-0.2949846,
    w0:336.060234,   wT:0.4439016,
    L0:355.433275,   LT:19140.2993313,
  },
  jupiter: {
    a0:5.202603191,  aT:0.0000001913,
    e0:0.04849485,   eT:0.000163244,
    i0:1.303270,     iT:-0.0019872,
    O0:100.464441,   OT:0.1766828,
    w0:14.331309,    wT:0.2155525,
    L0:34.351484,    LT:3034.9056746,
  },
  saturn: {
    a0:9.554909596,  aT:-0.0000021389,
    e0:0.05550825,   eT:-0.000346641,
    i0:2.488878,     iT:0.0025515,
    O0:113.665524,   OT:-0.2566649,
    w0:93.056787,    wT:0.8357205,
    L0:50.077444,    LT:1222.1138488,
  },
};

/** 케플러 원소 → 태양 중심 황도 직교좌표 (AU) */
function helioEcl(el: Elem, T: number): { x: number; y: number; z: number } {
  const a = el.a0 + el.aT * T;
  const e = el.e0 + el.eT * T;
  const inc = toRad(el.i0 + el.iT * T);
  const bigO = toRad(mod360(el.O0 + el.OT * T)); // Ω
  const bigW = toRad(mod360(el.w0 + el.wT * T)); // ϖ
  const bigL = toRad(mod360(el.L0 + el.LT * T)); // 평균 경도

  // 평균 근점이각 M = L - ϖ, 근일점 편각 ω = ϖ - Ω
  const M_deg = mod360(toDeg(bigL - bigW));
  const omega = bigW - bigO;

  const E = solveKepler(M_deg, e);
  const v = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2),
  );
  const r = a * (1 - e * Math.cos(E));

  const xOrb = r * Math.cos(v);
  const yOrb = r * Math.sin(v);

  const cosO = Math.cos(bigO), sinO = Math.sin(bigO);
  const cosW = Math.cos(omega), sinW = Math.sin(omega);
  const cosI = Math.cos(inc),  sinI = Math.sin(inc);

  return {
    x: (cosO * cosW - sinO * sinW * cosI) * xOrb + (-cosO * sinW - sinO * cosW * cosI) * yOrb,
    y: (sinO * cosW + cosO * sinW * cosI) * xOrb + (-sinO * sinW + cosO * cosW * cosI) * yOrb,
    z: (sinW * sinI) * xOrb + (cosW * sinI) * yOrb,
  };
}

/**
 * 5대 행성의 지심 적도 좌표 (RA h, Dec °).
 * 태양 중심 황도 → 지심 변환 → 황도→적도 변환.
 */
export function getPlanetEquatorialCoord(planetKey: PlanetKey, date: Date): EquatorialCoord {
  const T = julianDay(date) / 36525;
  const earth  = helioEcl(EL.earth, T);
  const planet = helioEcl(EL[planetKey], T);

  const dx = planet.x - earth.x;
  const dy = planet.y - earth.y;
  const dz = planet.z - earth.z;
  const rGeoc = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const lambdaDeg = mod360(toDeg(Math.atan2(dy, dx)));
  const betaDeg   = toDeg(Math.asin(Math.max(-1, Math.min(1, dz / rGeoc))));

  return eclToEq(lambdaDeg, betaDeg);
}

/**
 * 5대 주요 행성 전체의 실시간 방위각, 고도각 계산
 */
export function getCalculatedPlanets(lat: number, lon: number, date: Date) {
  const planetKeys: PlanetKey[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];
  return planetKeys.map((key) => {
    const meta  = PLANETS_METADATA[key];
    const eq    = getPlanetEquatorialCoord(key, date);
    const horiz = equatorialToHorizontal(eq, lat, lon, date);
    return {
      ...meta,
      raHours:  eq.raHours,
      decDeg:   eq.decDeg,
      azimuth:  horiz.azimuthDeg,
      altitude: horiz.altitudeDeg,
      isVisible: horiz.altitudeDeg > 0,
    };
  });
}
