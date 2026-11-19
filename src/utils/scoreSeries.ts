/**
 * scoreSeries.ts — 01 하늘의 **시간대별 점수 그래프**(docs/SANDBOX_MODE_PLAN.md 2.4, 목업 1번).
 *
 * 화면은 "높은 곳을 누르면 그 시간으로" 가는 작은 면 그래프입니다. 이 파일은 그리는 데 필요한 계산만 합니다(순수 함수).
 * 점수 자체는 새로 세지 않습니다 — 부르는 쪽이 하늘 화면과 **같은 예측**(`scenePrediction`)을 시각마다 불러 `predict` 로 넘깁니다.
 * 그래서 그래프의 높이와 하늘 그림 · 요약 줄의 점수가 어긋날 수 없습니다.
 *
 *  - **창**: 9시간. 일몰이면 출몰 5시간 전부터(일몰 17:04 → 12:00~21:00, 목업과 같음), 일출이면 4시간 전부터(07:21 → 03:00~12:00).
 *    시작은 관측지 현지 정시로 맞춰 눈금이 3시간 배수 정시에 놓입니다. 출몰은 늘 창 안쪽(앞에서 5~6시간 · 4~5시간)에 들어옵니다.
 *  - **표본**: 창 안을 일정 간격(기본 10분)으로 훑습니다. 예측을 못 하는 시각(날씨 없음)은 `null` 이고 선이 거기서 끊깁니다
 *    (없는 값을 0 이나 이웃 값으로 메우지 않음).
 *  - **점수가 높은 때**(`peak`): 점수가 1 이상인 표본 가운데 가장 높은 것(같으면 먼저 오는 시각). 흐려서 내내 1 미만이면 없음.
 */
import { L3 } from './i18n';

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export type GlowSide = 'sunset' | 'sunrise';
type Lang = 'ko' | 'en' | 'ja';

export const WINDOW_HOURS = 9;
/** 창이 출몰보다 이만큼(시간) 앞에서 시작합니다(그 뒤 관측지 현지 정시로 내림). */
export const LEAD_HOURS: Record<GlowSide, number> = { sunset: 5, sunrise: 4 };
/** 이 점수 미만은 "높은 때" 로 치지 않습니다. */
export const PEAK_MIN_SCORE = 1;

/**
 * 노을 점수가 0 이 아닐 수 있는 해 고도 범위(°). 이 밖에서는 예측을 부르지 않고 0 으로 칩니다 — 9시간 창의 표본 55 개 가운데 예측이 필요한 것은 13 개 안팎이라
 * 느린 기기에서 시트가 멈추지 않습니다. 값은 `predictSunset` 을 여러 하늘(낮은·중간·높은 구름 48 가지)로 돌려 얻었습니다: +14° 이상과 −7° 이하는 모두 정확히 0 이고,
 * 문턱은 1° 여유를 둔 것입니다(관측 고도의 지평선 내림 · 굴절). 예측이 바뀌어 이 밖에서 점수가 생기면 `verify-score-series.js` 가 먼저 깨집니다.
 */
export const GLOW_ALT_MIN_DEG = -8;
export const GLOW_ALT_MAX_DEG = 15;
export const canGlow = (sunAltDeg: number): boolean => sunAltDeg >= GLOW_ALT_MIN_DEG && sunAltDeg <= GLOW_ALT_MAX_DEG;

export interface ScoreWindow { fromMs: number; toMs: number }

/** 출몰 시각 `eventMs` 둘레의 9시간 창. `tzHours` 는 관측지의 UTC 오프셋(시간, 소수 가능). */
export function scoreWindow(eventMs: number, side: GlowSide, tzHours: number): ScoreWindow {
  const offset = tzHours * MS_HOUR;
  const fromMs = Math.floor((eventMs - LEAD_HOURS[side] * MS_HOUR + offset) / MS_HOUR) * MS_HOUR - offset;
  return { fromMs, toMs: fromMs + WINDOW_HOURS * MS_HOUR };
}

export interface ScorePoint { t: number; score: number | null }

/** 창 안을 `stepMin` 분 간격으로 훑어 점수를 모읍니다. `predict` 가 숫자가 아닌 것을 주면 그 시각은 `null`, 범위 밖은 0~100 으로 자릅니다. */
export function sampleScores(win: ScoreWindow, stepMin: number, predict: (t: Date) => number | null | undefined): ScorePoint[] {
  const out: ScorePoint[] = [];
  const step = Math.max(1, stepMin) * MS_MIN;
  for (let t = win.fromMs; t <= win.toMs + 1; t += step) {
    const s = predict(new Date(t));
    out.push({ t, score: typeof s === 'number' && Number.isFinite(s) ? clamp(s, 0, 100) : null });
  }
  return out;
}

export interface GraphGeom {
  width: number;
  height: number;
  /** 점수 100 이 놓이는 위쪽 여백 · 0 이 놓이는 아래쪽 여백(px). 선 굵기가 잘리지 않게. */
  padTop?: number;
  padBottom?: number;
}

const padTopOf = (g: GraphGeom) => g.padTop ?? 3;
const padBottomOf = (g: GraphGeom) => g.padBottom ?? 2;

export const xAtTime = (win: ScoreWindow, g: GraphGeom, t: number): number => ((t - win.fromMs) / (win.toMs - win.fromMs)) * g.width;
/** 가로 위치(0~폭) → 시각(ms). 범위 밖은 창 끝으로 자릅니다. */
export const timeAtX = (win: ScoreWindow, g: GraphGeom, x: number): number => win.fromMs + clamp(x / g.width, 0, 1) * (win.toMs - win.fromMs);
export const yAtScore = (g: GraphGeom, score: number): number => padTopOf(g) + (1 - clamp(score, 0, 100) / 100) * (g.height - padTopOf(g) - padBottomOf(g));

export interface ScorePeak { t: number; score: number; x: number; y: number }
export interface ScorePaths {
  /** 선 경로(SVG `d`). 끊긴 구간마다 `M` 으로 새로 시작. 그릴 것이 없으면 빈 글자. */
  line: string;
  /** 면 경로 — 구간마다 바닥까지 닫습니다. */
  area: string;
  /** 점이 둘 이상 이어진 구간의 수(그려진 구간) */
  segments: number;
  peak: ScorePeak | null;
}

const num = (n: number) => String(Math.round(n * 10) / 10);

/** 표본 → 선·면 경로와 "점수가 높은 때". 점 하나뿐인 구간은 선이 안 되므로 그리지 않지만 `peak` 에는 셉니다. */
export function scorePaths(points: readonly ScorePoint[], win: ScoreWindow, g: GraphGeom): ScorePaths {
  const base = g.height - padBottomOf(g);
  let line = '', area = '', segments = 0;
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length >= 2) {
      segments++;
      line += `${line ? ' ' : ''}M${num(run[0].x)} ${num(run[0].y)}${run.slice(1).map(p => ` L${num(p.x)} ${num(p.y)}`).join('')}`;
      area += `${area ? ' ' : ''}M${num(run[0].x)} ${num(base)} L${num(run[0].x)} ${num(run[0].y)}${run.slice(1).map(p => ` L${num(p.x)} ${num(p.y)}`).join('')} L${num(run[run.length - 1].x)} ${num(base)} Z`;
    }
    run = [];
  };
  let peak: ScorePeak | null = null;
  for (const p of points) {
    if (p.score == null) { flush(); continue; }
    const x = xAtTime(win, g, p.t), y = yAtScore(g, p.score);
    run.push({ x, y });
    if (p.score >= PEAK_MIN_SCORE && (!peak || p.score > peak.score)) peak = { t: p.t, score: p.score, x, y };
  }
  flush();
  return { line, area, segments, peak };
}

export interface AxisTick { t: number; x: number; /** 관측지 현지 "HH:00" */ label: string }

/** 창 안에서 관측지 현지 시각이 `everyHours` 배수인 정시들(창 끝 포함). */
export function axisTicks(win: ScoreWindow, g: GraphGeom, tzHours: number, everyHours = 3): AxisTick[] {
  const out: AxisTick[] = [];
  for (let t = win.fromMs; t <= win.toMs + 1; t += MS_HOUR) {
    const local = new Date(t + tzHours * MS_HOUR);
    const h = local.getUTCHours();
    if (local.getUTCMinutes() === 0 && h % everyHours === 0) out.push({ t, x: xAtTime(win, g, t), label: `${String(h).padStart(2, '0')}:00` });
  }
  return out;
}

/** 스크린리더 글. 가장 높은 때는 가까운 정시로 말합니다("17시 무렵"). */
export function graphLabel(peak: Pick<ScorePeak, 't'> | null, tzHours: number, language: Lang): string {
  if (!peak) {
    return L3(language, '시간대별 점수 그래프, 점수가 높은 때가 없음', 'Score by time of day, no high-scoring time', '時間帯別スコアのグラフ、高いスコアの時間帯はなし');
  }
  const hh = Math.round((peak.t + tzHours * MS_HOUR) / MS_HOUR);
  const h = ((hh % 24) + 24) % 24;
  return L3(language, `시간대별 점수 그래프, ${h}시 무렵이 가장 높음`, `Score by time of day, highest around ${h}:00`, `時間帯別スコアのグラフ、${h}時ごろが最も高い`);
}

/** 표본 가운데 점수가 있는 것이 하나라도 있는가(없으면 그래프를 그리지 않습니다). */
export const hasAnyScore = (points: readonly ScorePoint[]): boolean => points.some(p => p.score != null);
