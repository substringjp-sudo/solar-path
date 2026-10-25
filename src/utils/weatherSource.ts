/**
 * weatherSource.ts — 날짜 → 날씨 자료원 해석기(§161, RULER-source §2, 2026-10-25).
 *
 * 왜: 과거 재현이 주 기능인데 5 일 넘은 과거는 archive(ERA5·IFS 분석 이어붙임, 모델 미지정)로 떨어져 CAPE·기압면 단면·층별
 * 바람이 전부 없어지고(§135.3), 분기가 밀리초 차라 같은 현지 날짜의 아침과 저녁이 다른 자료원으로 갈렸습니다. Open-Meteo 과거 예보
 * 보관(historical-forecast-api)은 같은 모델·같은 변수·같은 형식으로 "그날의 예보" 를 주므로, 과거도 지금과 같은 입력으로 그립니다.
 *
 * 규칙(fetch 없음, 순수 함수 — `tools/shader-preview/verify-weather-source.js`):
 *  - leadDays = 대상 현지 달력 날짜 − 오늘 현지 달력 날짜(정수, 시각 무시). 하루는 한 자료원.
 *  - leadDays ≥ −5 → forecast(past_days 구간). ≤ −6 → 보관 시작일 검사: ≥ 2024-02-03 historical(ecmwf_ifs025+icon_seamless 블렌드),
 *    2022-11-24 ~ 2024-02-02 historical-icon(icon_seamless 단독), 그 전 archive. 자료원은 now 의 단조 함수(forecast → historical 로 한 번).
 *  - kind: ring/fan 은 블렌드(또는 icon 단독) 모델 파라미터, point(열역학·바람 관측점 요청)는 모델 미지정(지금과 같음).
 *  - 403(요금 플랜) 은 세션 플래그로 기억하고 archive 로 후퇴(`archive-fallback`); 429 는 기억하지 않는다(RULER-source §2).
 */
import { BLEND_MODELS_PARAM } from './modelBlend';

export type WeatherOrigin = 'forecast' | 'historical' | 'historical-icon' | 'archive' | 'archive-fallback' | 'synthetic' | 'legacy';
export type WeatherRequestKind = 'ring' | 'point' | 'fan';

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const HISTORICAL_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
export const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
/** leadDays 가 이 값 이상이면 forecast(past_days). Open-Meteo forecast 는 past_days 최대 92 지만 5 일 뒤부터는 보관이 같은 자료를 줍니다. */
export const FORECAST_MIN_LEAD_DAYS = -5;
/** 보관 시작일(Open-Meteo historical-forecast 문서, 2026-10-25 확인) */
export const HISTORICAL_BLEND_START = '2024-02-03';   // ecmwf_ifs025
export const HISTORICAL_ICON_START = '2022-11-24';    // icon global/eu/d2
export const ICON_ONLY_PARAM = '&models=icon_seamless';

export interface WeatherSource {
  origin: WeatherOrigin;
  baseUrl: string;
  /** URL 에 그대로 붙이는 `&models=…`(없으면 빈 문자열) */
  modelParam: string;
  leadDays: number;
}

const dayNumber = (dateStr: string): number => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400_000);
};

/** 대상 날짜 − 오늘(정수 일). 둘 다 'YYYY-MM-DD'(기기 현지 날짜, `localDateString`). */
export const leadDaysBetween = (targetDateStr: string, todayDateStr: string): number => dayNumber(targetDateStr) - dayNumber(todayDateStr);

export interface WeatherSourceOptions {
  /** 이 세션에서 보관 API 가 403 을 냈음 → 보관 대신 archive-fallback */
  historicalForbidden?: boolean;
  /** forecast/historical 에 쓸 모델 파라미터(기본 블렌드). 팬 경로의 국지 모델 지정용. */
  modelParam?: string;
}

export function weatherSourceFor(targetDateStr: string, todayDateStr: string, kind: WeatherRequestKind, opts: WeatherSourceOptions = {}): WeatherSource {
  const leadDays = leadDaysBetween(targetDateStr, todayDateStr);
  const blend = kind === 'point' ? '' : (opts.modelParam ?? BLEND_MODELS_PARAM);
  if (leadDays >= FORECAST_MIN_LEAD_DAYS) return { origin: 'forecast', baseUrl: FORECAST_URL, modelParam: blend, leadDays };
  if (targetDateStr >= HISTORICAL_BLEND_START) {
    if (opts.historicalForbidden) return { origin: 'archive-fallback', baseUrl: ARCHIVE_URL, modelParam: '', leadDays };
    return { origin: 'historical', baseUrl: HISTORICAL_URL, modelParam: blend, leadDays };
  }
  if (targetDateStr >= HISTORICAL_ICON_START) {
    if (opts.historicalForbidden) return { origin: 'archive-fallback', baseUrl: ARCHIVE_URL, modelParam: '', leadDays };
    return { origin: 'historical-icon', baseUrl: HISTORICAL_URL, modelParam: kind === 'point' ? '' : ICON_ONLY_PARAM, leadDays };
  }
  return { origin: 'archive', baseUrl: ARCHIVE_URL, modelParam: '', leadDays };
}

/** 보관 요청이 403 을 냈을 때의 후퇴 자료원 */
export const archiveFallbackOf = (src: WeatherSource): WeatherSource => ({ origin: 'archive-fallback', baseUrl: ARCHIVE_URL, modelParam: '', leadDays: src.leadDays });

/** archive 계열인가(변수 집합이 다름 — 모델 접미사 없음, TCWV 없음, 시정 있음) */
export const isArchiveOrigin = (o: WeatherOrigin): boolean => o === 'archive' || o === 'archive-fallback';

let historicalForbidden = false;
export const isHistoricalForbidden = (): boolean => historicalForbidden;
export const setHistoricalForbidden = (v: boolean): void => { historicalForbidden = v; };
