/**
 * recordCompare.ts — 03 기록의 종류 거르기와 "예측이 얼마나 맞았나" 요약의 순수 계산 (docs/SANDBOX_MODE_PLAN.md 8.7, 10.3 목업 17).
 *
 * 사진마다 구름 양(`cloud`)과 색(`color`) 피드백을 한 번 눌러 남기고, 기록 위에 최근 10 장의 요약과 치우침("예측이 구름을 적게 보는 편이에요")을 보입니다.
 * 종류(노을 · 별 · 타임랩스)는 사진에 적혀 있으면 그것을, 없으면 찍은 때의 해 고도(−6° 이하면 별)로 정합니다.
 *
 * 판정: `tools/shader-preview/verify-record-compare.js`
 */
import { sunPosition } from './solarPosition';

export type PhotoKind = 'sunset' | 'astro' | 'timelapse';
export type KindFilter = 'all' | PhotoKind;
export type CloudFeedback = 'more' | 'same' | 'less';
export type ColorFeedback = 'redder' | 'same' | 'weaker';
export interface PhotoCompare { cloud?: CloudFeedback; color?: ColorFeedback }

export interface ComparePhoto {
  id: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  kind?: PhotoKind;
  compare?: PhotoCompare;
}

type Lang = 'ko' | 'en' | 'ja';
const pick = (l: Lang, ko: string, en: string, ja: string): string => (l === 'en' ? en : l === 'ja' ? ja : ko);

/** 요약과 치우침이 보는 최근 사진 수(피드백이 있는 것만 센다). */
export const SUMMARY_WINDOW = 10;
/** 이 값(°) 이하의 해 고도에 찍은 사진은 별 사진으로 봅니다. */
export const DARK_SUN_ALT_DEG = -6;
const BIAS_SHARE = 0.6;
const BIAS_MIN_ANSWERS = 3;

export function photoKind(p: ComparePhoto): PhotoKind {
  if (p.kind === 'sunset' || p.kind === 'astro' || p.kind === 'timelapse') return p.kind;
  if (![p.timestamp, p.latitude, p.longitude].every(Number.isFinite)) return 'sunset';
  const alt = sunPosition(new Date(p.timestamp), p.latitude, p.longitude).altitude * (180 / Math.PI);
  return alt <= DARK_SUN_ALT_DEG ? 'astro' : 'sunset';
}

export function filterByKind<T extends ComparePhoto>(list: readonly T[], f: KindFilter): T[] {
  return f === 'all' ? [...list] : list.filter(p => photoKind(p) === f);
}

const hasCompare = (p: ComparePhoto): boolean => !!p.compare && (p.compare.cloud !== undefined || p.compare.color !== undefined);
const recent = (list: readonly ComparePhoto[]): ComparePhoto[] => list.filter(hasCompare).slice(0, SUMMARY_WINDOW);

export function compareSummary(list: readonly ComparePhoto[], lang: Lang): string | null {
  const r = recent(list);
  if (r.length === 0) return null;
  const a = r.filter(p => p.compare?.cloud === 'same').length;
  const b = r.filter(p => p.compare?.color === 'same').length;
  const n = r.length;
  return pick(lang,
    `최근 ${n}번 중 구름 양 ${a}번 비슷, 색 ${b}번 비슷`,
    `Last ${n}: cloud amount matched ${a}×, color matched ${b}×`,
    `直近${n}回: 雲の量が${a}回一致、色が${b}回一致`);
}

export interface CompareBias { cloud: 'more' | 'less' | null; color: 'redder' | 'weaker' | null }

function lean<T extends string, D extends T>(values: T[], dirs: readonly D[]): D | null {
  if (values.length < BIAS_MIN_ANSWERS) return null;
  for (const d of dirs) if (values.filter(v => v === d).length / values.length >= BIAS_SHARE) return d;
  return null;
}

export function compareBias(list: readonly ComparePhoto[]): CompareBias {
  const r = recent(list);
  const clouds = r.map(p => p.compare?.cloud).filter((v): v is CloudFeedback => v !== undefined);
  const colors = r.map(p => p.compare?.color).filter((v): v is ColorFeedback => v !== undefined);
  return { cloud: lean(clouds, ['more', 'less'] as const), color: lean(colors, ['redder', 'weaker'] as const) };
}

export function biasLine(b: CompareBias, lang: Lang): string | null {
  const parts: string[] = [];
  if (b.cloud === 'more') parts.push(pick(lang, '예측이 구름을 적게 보는 편이에요', 'The forecast tends to underestimate clouds', '予測は雲を少なく見積もりがちです'));
  if (b.cloud === 'less') parts.push(pick(lang, '예측이 구름을 많이 보는 편이에요', 'The forecast tends to overestimate clouds', '予測は雲を多く見積もりがちです'));
  if (b.color === 'redder') parts.push(pick(lang, '예측이 덜 붉게 나오는 편이에요', 'The forecast tends to come out less red', '予測は赤みが弱く出がちです'));
  if (b.color === 'weaker') parts.push(pick(lang, '예측이 더 붉게 나오는 편이에요', 'The forecast tends to come out redder', '予測は赤みが強く出がちです'));
  return parts.length ? parts.join(' · ') : null;
}

/** 새 피드백 값을 합칩니다: 새 값의 칸만 덮어쓰고, 같은 값을 다시 고르면 그 칸이 꺼집니다. */
export function mergeCompare(prev: PhotoCompare | undefined, next: PhotoCompare): PhotoCompare {
  const out: PhotoCompare = { ...(prev ?? {}) };
  if (next.cloud !== undefined) { if (out.cloud === next.cloud) delete out.cloud; else out.cloud = next.cloud; }
  if (next.color !== undefined) { if (out.color === next.color) delete out.color; else out.color = next.color; }
  return out;
}
