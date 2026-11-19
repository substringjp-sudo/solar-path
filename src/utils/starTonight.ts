/**
 * 별 보기 계산 과정의 입력을 모읍니다 (`calcSteps.buildStarCards` 의 인자). 순수 함수입니다.
 *
 * 하는 일은 셋입니다.
 *  1. **어느 시각의 별인가**(`starTimeFor`): 그 시각 해가 지평선 아래 12° 보다 깊으면 그대로, 아니면 그날 천문 박명이 끝난 30분 뒤
 *     (앱의 "은하수" 추천 시각과 같습니다). 해가 18° 아래로 안 내려가는 날(고위도 여름)에는 해가 가장 낮은 때(남중 12시간 뒤)를 씁니다.
 *     그 시각의 박명 몫이 카드에 그대로 나오므로 "그날 가장 어두운 밤도 이만큼 밝다"가 거짓 없이 보입니다.
 *  2. **그 시각의 해·달**: 해 고도, 달 고도(시차·굴절 포함 `getMoonPositionPrecise`)와 밝은 비율(SunCalc).
 *  3. **달이 지는 시각**: `findMoonSet`. 달이 이미 없으면 null. 그때의 해 고도도 함께(달이 새벽 박명에 지면 "진 뒤" 등급이 박명에 막힙니다).
 *
 * 날씨와 빛 지도는 이 파일이 가져오지 않고 부르는 쪽이 넘깁니다 — 날씨는 `weatherAt(시각)`, 빛 지도는 이미 추정한 한계등급(3.0~6.5)입니다.
 * 그래서 네트워크 · 자산 없이 판정 스크립트(`verify-star-tonight.js`)가 그대로 돌립니다.
 */
import SunCalc from 'suncalc';
import { getMoonPositionPrecise } from './moonPosition';
import { sunPosition, sunTimes } from './solarPosition';
import { findMoonSet, type StarInput } from './starVisibility';
import type { BuildStarArgs } from './calcSteps';

const DEG = 180 / Math.PI;
const HOUR_MS = 3600e3;
const isValid = (d: Date) => Number.isFinite(d.getTime());

/** 이 시각의 해가 이만큼(°) 아래면 그 시각을 그대로 "별을 보는 시각"으로 씁니다. */
export const DARK_ENOUGH_SUN_DEG = -12;
/** 천문 박명이 끝난 뒤 이만큼(분) 지나서 봅니다 — 앱의 "은하수" 추천(`skyEvents`)과 같은 값. */
export const AFTER_NIGHT_MIN = 30;

/** 별을 볼 시각. 위 머리말 1 번. */
export function starTimeFor(date: Date, lat: number, lon: number): Date {
  const alt = sunPosition(date, lat, lon).altitude * DEG;
  if (alt < DARK_ENOUGH_SUN_DEG) return date;
  const tm = sunTimes(date, lat, lon);
  if (isValid(tm.night)) return new Date(tm.night.getTime() + AFTER_NIGHT_MIN * 60e3);
  return new Date(tm.solarNoon.getTime() + 12 * HOUR_MS);
}

/** 별을 볼 시각의 날씨(관측점). 모르는 값은 null/undefined — 지어내지 않습니다. */
export interface StarWeather {
  /** 하늘 전체 운량(%). 예보가 없으면 null. */
  cloudPct: number | null;
  humidityPct?: number | null;
  aod550?: number | null;
  visibilityM?: number | null;
  pm25?: number | null;
}

/**
 * 시간별 자료의 시각 목록(ms)이 `whenMs` 를 덮는가(첫 시각 ≤ whenMs ≤ 마지막 시각).
 * 보간 함수는 범위 밖에서 가장자리 값을 그대로 돌려주므로, 덮지 않는 시각은 부르는 쪽이 "예보 없음" 으로 둡니다(가장자리 값을 지어 쓰지 않음).
 */
export function hourlyCovers(times: ArrayLike<number> | null | undefined, whenMs: number): boolean {
  if (!times || times.length === 0 || !Number.isFinite(whenMs)) return false;
  return whenMs >= times[0] && whenMs <= times[times.length - 1];
}

/** 보간한 관측점 날씨(앱의 `CloudData` 중 쓰는 칸). */
export interface ObsLike {
  low?: number; mid?: number; high?: number; total?: number;
  humidity?: number; aod550?: number; visibility?: number; pm25?: number;
}

/**
 * 보간한 관측점 날씨 → 별 보기 입력. 운량은 모델의 총운량(`total`)을 쓰고, 없으면 층 가운데 가장 큰 값(총운량의 하한, 앱의 다른 화면과 같은 규칙)이며
 * 0~100 으로 자릅니다. 구름 값이 하나도 없으면 null(모름). 받지 못한 연무 항목도 null 로 둡니다.
 */
export function starWeatherOf(w: ObsLike | null | undefined): StarWeather | null {
  if (!w) return null;
  const finite = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x);
  const layers = [w.low, w.mid, w.high].filter(finite);
  // 구름 값이 하나도 없으면 맑다고 세지 않고 모름(null)으로 둡니다.
  const raw = finite(w.total) ? w.total : layers.length ? Math.max(...layers) : null;
  return {
    cloudPct: raw == null ? null : Math.max(0, Math.min(100, raw)),
    humidityPct: w.humidity ?? null,
    aod550: w.aod550 ?? null,
    visibilityM: w.visibility ?? null,
    pm25: w.pm25 ?? null,
  };
}

export interface StarArgsInput {
  /** 사용자가 보고 있는 날짜·시각 */
  date: Date;
  lat: number;
  lon: number;
  /** 관측점 해발(m) — 달 시차에 씁니다. */
  elevM?: number;
  /** 별을 볼 시각의 날씨. 그 시각의 예보가 없으면 null. */
  weatherAt: (when: Date) => StarWeather | null;
  /** 밤 불빛 지도 기준 한계등급(3.0~6.5). 지도를 못 읽었으면 null. */
  lightPollutionMag: number | null;
}

export function starArgsFor(o: StarArgsInput): Omit<BuildStarArgs, 'language' | 'fmtTime'> {
  const when = starTimeFor(o.date, o.lat, o.lon);
  const ms = when.getTime();
  const elev = o.elevM ?? 0;
  const moonAlt = (t: number) => getMoonPositionPrecise(new Date(t), o.lat, o.lon, elev).altitude * DEG;
  const sunAlt = (t: number) => sunPosition(new Date(t), o.lat, o.lon).altitude * DEG;

  const w = o.weatherAt(when);
  const cloudKnown = !!w && w.cloudPct != null && Number.isFinite(w.cloudPct);
  const input: StarInput = {
    cloudPct: cloudKnown ? (w!.cloudPct as number) : 0,
    sunAltDeg: sunAlt(ms),
    moonAltDeg: moonAlt(ms),
    moonIllum: SunCalc.getMoonIllumination(when).fraction,
    lightPollutionMag: o.lightPollutionMag,
    aod550: w?.aod550 ?? null,
    visibilityM: w?.visibilityM ?? null,
    humidityPct: w?.humidityPct ?? null,
    pm25: w?.pm25 ?? null,
  };
  // 달이 떠 있을 때만 "언제 지나" 를 찾습니다(모델이 달을 "떠 있음"으로 보는 기준 고도 0° 와 맞춤).
  const moonSetMs = input.moonAltDeg > 0 ? findMoonSet(ms, moonAlt) : null;
  return {
    timeMs: ms,
    input,
    cloudKnown,
    moonSetMs,
    sunAltAtMoonSetDeg: moonSetMs != null ? sunAlt(moonSetMs) : undefined,
  };
}
