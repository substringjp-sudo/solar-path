/**
 * 별 보기 조건 (docs/SANDBOX_MODE_PLAN.md 9 장 "계산 과정: 별 보기 조건", 목업 CalcStars).
 *
 * 맨눈으로 보이는 **가장 어두운 별의 등급(한계등급)** 을 하늘 밝기에서 구합니다. 구름은 등급을 바꾸지 않고 "하늘의 몇 %가 가려지는가"로,
 * 나머지(박명 · 달빛 · 빛 공해 · 연무)는 하늘이 밝아지거나 빛이 줄어 한계등급을 깎습니다.
 *
 * ## 모델
 *
 *  1. 한계등급 ↔ 천정 하늘 밝기(V 등급/arcsec², SB): `NELM = 7.93 − 5·log10(10^(4.316 − SB/5) + 1)` (Schaefer 1990 의 맨눈 한계 식을
 *     Unihedron SQM 대응으로 정리한 것). 자연 암천은 `SB = 21.733` 이 정확히 6.5 등급이 되게 잡았습니다(앱의 빛 지도가 쓰는 6.5 상한과 같음).
 *  2. 밝기는 **선형 단위(nanoLambert)** 로 더합니다: `B = 34.08·exp(20.7233 − 0.92104·SB)` (Krisciunas & Schaefer 1991). 등급을 그대로 더하면
 *     두 광원이 겹칠 때 깎임을 부풀리므로, 광원을 선형으로 더한 뒤 등급으로 되돌립니다.
 *  3. 달빛: Krisciunas & Schaefer(1991)의 달빛 하늘 밝기. 천정 방향 하늘점에서 달까지의 각거리 ρ = 달의 천정거리,
 *     `B = f(ρ)·10^(−0.4·(3.84 + 0.026|α| + 4e−9·α⁴))·10^(−0.4·k·X(Z_달))·(1 − 10^(−0.4·k))`,
 *     `f(ρ) = 10^5.36·(1.06 + cos²ρ) + 10^(6.15 − ρ/40)`, `X(Z) = (1 − 0.96 sin²Z)^(−1/2)`, α = 위상각(보름 0°, 삭 180°). 달이 지평선 아래면 0.
 *  4. 빛 공해: 앱의 밤 불빛 지도(`cityLightMap.estimateLightPollution`)가 낸 "빛 공해만 있을 때의 한계등급"(3.0~6.5)을 하늘 밝기로 되돌려
 *     자연 하늘을 뺀 인공광으로 씁니다(달은 인공광을 안 바꿉니다).
 *  5. 박명: 해가 지평선 아래 18° 보다 얕으면 하늘이 아직 밝습니다. 천정 밝기를 관측에 맞춘 근사 표(깊이 0°→5, 6°→11.5, 12°→17.5, 15°→19.5,
 *     18°→21.7)에서 구간 보간합니다.
 *  6. 연무: 대기 소광계수 k = 0.20 + 1.086·(AOD − 0.05)(맑은 날 0.20). 별 빛이 평균 대기 질량 1.5(고도 약 40°)를 지나므로
 *     한계등급이 `(k − 0.20)·1.5` 만큼 줄고, k 는 달빛 식에도 들어갑니다. AOD(550 nm)가 없으면 시정(코시미더, 경계층 높이 1.5 km)으로 어림하고,
 *     둘 다 없으면 맑은 대기로 가정합니다(그렇다고 알립니다).
 *
 * 단계 카드의 "줄어든 등급"은 **차례로 하나씩 더했을 때** 줄어든 만큼(박명 → 달빛 → 빛 공해 → 연무)이라 합이 처음 6.5 와 마지막 한계등급의 차와
 * 정확히 같습니다. 순서가 바뀌면 단계별 몫은 바뀌어도 마지막 값은 같습니다.
 *
 * 순수 함수입니다. 달이 지는 시각은 부르는 쪽이 고도 함수를 넘겨 `findMoonSet` 으로 찾습니다.
 */

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** 자연 암천의 한계등급(앱의 빛 지도 상한과 같음) */
export const NELM_DARK = 6.5;

/** 한계등급 → 천정 하늘 밝기(V 등급/arcsec²). 위 1 번 식의 거꾸로. */
export function nelmToSb(nelm: number): number {
  const x = Math.pow(10, (7.93 - nelm) / 5) - 1;
  return x <= 1e-12 ? 99 : 5 * (4.316 - Math.log10(x));
}
/** 천정 하늘 밝기 → 한계등급. */
export const sbToNelm = (sb: number): number => 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - sb / 5) + 1);

/** 자연 암천의 천정 밝기(= 6.5 등급) */
export const SKY_NATURAL_SB = nelmToSb(NELM_DARK);

/** 등급/arcsec² ↔ nanoLambert (Krisciunas & Schaefer 1991) */
export const sbToNl = (sb: number): number => 34.08 * Math.exp(20.7233 - 0.92104 * sb);
export const nlToSb = (nl: number): number => (20.7233 - Math.log(nl / 34.08)) / 0.92104;

/** 대기 질량 X(Z) — Krisciunas & Schaefer 식. Z 는 천정거리(°). */
export const airmass = (zenithDistDeg: number): number => {
  const s = Math.sin(zenithDistDeg * D2R);
  return 1 / Math.sqrt(1 - 0.96 * s * s);
};

/** 달 밝은 비율(0~1) → 위상각(°, 보름 0 · 삭 180) */
export const phaseAngleDeg = (illum: number): number => Math.acos(clamp(2 * illum - 1, -1, 1)) * R2D;

/** 천정 방향 하늘점의 달빛 밝기(nL). 달이 지평선 아래면 0. */
export function moonSkyBrightnessNl(phaseAngle: number, moonAltDeg: number, k: number): number {
  if (!(moonAltDeg > 0)) return 0;
  const alpha = Math.abs(phaseAngle);
  const zMoon = 90 - moonAltDeg;
  const rho = zMoon;
  const c = Math.cos(rho * D2R);
  const f = Math.pow(10, 5.36) * (1.06 + c * c) + Math.pow(10, 6.15 - rho / 40);
  const i = Math.pow(10, -0.4 * (3.84 + 0.026 * alpha + 4e-9 * Math.pow(alpha, 4)));
  return f * i * Math.pow(10, -0.4 * k * airmass(zMoon)) * (1 - Math.pow(10, -0.4 * k));
}

/** 박명의 천정 하늘 밝기 근사 표: [해가 지평선 아래로 내려간 각(°), SB] */
const TWILIGHT_TABLE: ReadonlyArray<readonly [number, number]> = [[0, 5], [6, 11.5], [12, 17.5], [15, 19.5], [18, SKY_NATURAL_SB]];

/** 박명 하늘의 천정 밝기(SB). 해가 18° 넘게 내려가 어두우면 null. */
export function twilightSb(sunAltDeg: number): number | null {
  const d = -sunAltDeg;
  if (d >= 18) return null;
  if (d <= 0) return TWILIGHT_TABLE[0][1];
  for (let i = 1; i < TWILIGHT_TABLE.length; i++) {
    if (d <= TWILIGHT_TABLE[i][0]) {
      const [d0, s0] = TWILIGHT_TABLE[i - 1], [d1, s1] = TWILIGHT_TABLE[i];
      return s0 + ((s1 - s0) * (d - d0)) / (d1 - d0);
    }
  }
  return null;
}

/** 맑은 날의 소광계수 k 와 AOD, 별이 지나는 평균 대기 질량 */
export const EXTINCTION_CLEAN = 0.2;
export const AOD_CLEAN = 0.05;
export const AIRMASS_STAR = 1.5;

/** 시정(m)으로 어림한 AOD(550 nm): 코시미더 σ = 3.912/V 에서 공기 분자 몫 0.012/km 를 빼고 경계층 높이 1.5 km 를 곱함. */
export const aodFromVisibility = (visM: number): number => clamp((3.912 / Math.max(0.1, visM / 1000) - 0.012) * 1.5, 0, 2);

/** 소광계수 k(V, 대기 질량당 등급). AOD 가 없으면 맑은 대기. */
export const extinctionK = (aod: number | null | undefined): number =>
  clamp(EXTINCTION_CLEAN + 1.086 * Math.max(0, (aod ?? AOD_CLEAN) - AOD_CLEAN), EXTINCTION_CLEAN, 1.5);

export type CloudRating = 'good' | 'fair' | 'bad';
/** 하늘 전체 운량 % → 별 보기 판정: 20% 이하 좋음, 50% 이하 보통, 그 위 나쁨(하늘 대부분이 가려짐) */
export const cloudRating = (pct: number): CloudRating => (pct <= 20 ? 'good' : pct <= 50 ? 'fair' : 'bad');

export interface StarInput {
  /** 하늘 전체 운량(%) */
  cloudPct: number;
  /** 해의 겉보기 고도(°) */
  sunAltDeg: number;
  /** 달의 겉보기 고도(°)와 밝은 비율(0~1) */
  moonAltDeg: number;
  moonIllum: number;
  /** 빛 지도 기준 한계등급(3.0~6.5). 지도를 못 읽었으면 null(빛 공해를 셈에 안 넣고 그렇다고 알림). */
  lightPollutionMag: number | null;
  /** 연무 자료: 에어로졸 광학두께(550 nm)·지표 시정(m). 설명용으로 습도(%)와 PM2.5(µg/m³)도 받습니다. */
  aod550?: number | null;
  visibilityM?: number | null;
  humidityPct?: number | null;
  pm25?: number | null;
}

export interface StarResult {
  /** 마지막 한계등급(0~6.5) — 구름이 안 낀 하늘 조각에서 */
  limitMag: number;
  /** 시작(자연 암천) */
  startMag: number;
  cloud: { pct: number; rating: CloudRating; clearFraction: number };
  /** 박명이 아닌 어두운 밤이면 null */
  twilight: { sunAltDeg: number; deltaMag: number } | null;
  moon: { illum: number; altDeg: number; up: boolean; deltaMag: number };
  light: { baseMag: number | null; deltaMag: number };
  haze: { k: number; aod: number | null; aodSource: 'aod' | 'visibility' | 'none'; deltaMag: number };
  /** 줄어든 등급이 가장 큰 단계(없으면 null) */
  keyStep: 'twilight' | 'moon' | 'light' | 'haze' | null;
}

export function starLimit(i: StarInput): StarResult {
  const aodSource: 'aod' | 'visibility' | 'none' = i.aod550 != null ? 'aod' : i.visibilityM != null ? 'visibility' : 'none';
  const aod = i.aod550 != null ? i.aod550 : i.visibilityM != null ? aodFromVisibility(i.visibilityM) : null;
  const k = extinctionK(aod);
  const bNat = sbToNl(SKY_NATURAL_SB);
  const twSb = twilightSb(i.sunAltDeg);
  const bTw = twSb == null ? 0 : Math.max(0, sbToNl(twSb) - bNat);
  const bMoon = moonSkyBrightnessNl(phaseAngleDeg(i.moonIllum), i.moonAltDeg, k);
  const lp = i.lightPollutionMag;
  const bLight = lp != null && lp < NELM_DARK ? Math.max(0, sbToNl(nelmToSb(Math.max(1, lp))) - bNat) : 0;
  const nelm = (b: number) => sbToNelm(nlToSb(b));

  const m0 = nelm(bNat);
  const m1 = nelm(bNat + bTw);
  const m2 = nelm(bNat + bTw + bMoon);
  const m3 = nelm(bNat + bTw + bMoon + bLight);
  const hazeRaw = -(k - EXTINCTION_CLEAN) * AIRMASS_STAR;
  const limit = clamp(m3 + hazeRaw, 0, NELM_DARK);

  const deltas = { twilight: m1 - m0, moon: m2 - m1, light: m3 - m2, haze: limit - m3 };
  let keyStep: StarResult['keyStep'] = null, worst = -0.05;
  for (const s of ['twilight', 'moon', 'light', 'haze'] as const) if (deltas[s] < worst) { worst = deltas[s]; keyStep = s; }

  return {
    limitMag: limit,
    startMag: m0,
    cloud: { pct: i.cloudPct, rating: cloudRating(i.cloudPct), clearFraction: clamp(1 - i.cloudPct / 100, 0, 1) },
    twilight: twSb == null ? null : { sunAltDeg: i.sunAltDeg, deltaMag: deltas.twilight },
    moon: { illum: i.moonIllum, altDeg: i.moonAltDeg, up: i.moonAltDeg > 0, deltaMag: deltas.moon },
    light: { baseMag: lp, deltaMag: deltas.light },
    haze: { k, aod, aodSource, deltaMag: deltas.haze },
    keyStep,
  };
}

/** 지금 입력에서 달만 없앤 한계등급 — "달이 진 뒤에는 N 등급까지"에 씁니다. */
export const limitWithoutMoon = (i: StarInput): number => starLimit({ ...i, moonAltDeg: -10 }).limitMag;

/**
 * `fromMs` 뒤 `maxHours` 안에서 달이 처음 지평선 아래(`horizonDeg`, 기본 −0.5°)로 내려가는 시각(ms). 5 분 걸음으로 찾고 1 분 안으로 다듬습니다.
 * `fromMs` 에 이미 지평선 아래이거나 그 안에 안 지면 null.
 */
export function findMoonSet(fromMs: number, altAt: (ms: number) => number, maxHours = 16, horizonDeg = -0.5): number | null {
  if (altAt(fromMs) <= horizonDeg) return null;
  const step = 5 * 60e3;
  let prev = fromMs;
  for (let t = fromMs + step; t <= fromMs + maxHours * 3600e3; t += step) {
    if (altAt(t) <= horizonDeg) {
      let lo = prev, hi = t;
      while (hi - lo > 30e3) { const mid = (lo + hi) / 2; if (altAt(mid) <= horizonDeg) hi = mid; else lo = mid; }
      return Math.round((lo + hi) / 2 / 60e3) * 60e3;
    }
    prev = t;
  }
  return null;
}

/** 한계등급 → 무엇이 보이나(등급 구간) */
export type SeeLevel = 'darkest' | 'milkyway' | 'constellations' | 'bright' | 'few';
export const seeLevel = (mag: number): SeeLevel => (mag >= 6 ? 'darkest' : mag >= 5 ? 'milkyway' : mag >= 4 ? 'constellations' : mag >= 3 ? 'bright' : 'few');
