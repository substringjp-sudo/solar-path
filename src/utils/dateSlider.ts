/**
 * dateSlider.ts
 *
 * 1년(365~366일) 날짜 슬라이더와 퍼센트(0~100) 간 상호 변환 및 현지 시간대 오프셋 처리.
 */
import { getSeasonMarkers } from './celestial';

export const shiftTz = (d: Date, tz: number) => new Date(d.getTime() + tz * 3600000);
export const unshiftTz = (ms: number, tz: number) => new Date(ms - tz * 3600000);

export const daysInYear = (year: number) =>
  Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000);

export const getDayOfYear = (local: Date) => {
  const start = Date.UTC(local.getUTCFullYear(), 0, 1);
  return Math.floor((local.getTime() - start) / 86400000) + 1;
};

export const dateToDatePercent = (date: Date, tz: number) => {
  const local = shiftTz(date, tz);
  const total = daysInYear(local.getUTCFullYear());
  return ((getDayOfYear(local) - 1) / (total - 1)) * 100;
};

export const datePercentToDate = (
  percent: number,
  year: number,
  hour: number,
  minute: number,
  tz: number
) => {
  const total = daysInYear(year);
  const dayIndex = Math.round((Math.max(0, Math.min(100, percent)) / 100) * (total - 1));
  const base = Date.UTC(year, 0, 1, hour, minute, 0, 0);
  return unshiftTz(base + dayIndex * 86400000, tz);
};

export const formatMonthDay = (date: Date, tz: number) => {
  const l = shiftTz(date, tz);
  return `${l.getUTCMonth() + 1}/${l.getUTCDate()}`;
};

export { getSeasonMarkers };
