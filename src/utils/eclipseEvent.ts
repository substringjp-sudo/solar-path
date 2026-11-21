/**
 * eclipseEvent.ts — **월식 이벤트 모드가 켜지는 때**와 화면 글(docs/SANDBOX_MODE_PLAN.md 목업 13). 순수 함수.
 *
 * 켜짐: 그 시각 앞뒤의 월식에 대해 (a) 지금이 `p1 − 24 시간` ~ `p4`, (b) 그 자리에서 달이 식 중 뜨고, (c) 달이 지는 때가 아직 오지 않았을 때만.
 * 판정: `tools/shader-preview/verify-eclipse-event.js`
 */
import { nextLunarEclipse, type LunarEclipse } from './lunarEclipse';
import { planEclipse, stageAt, type EclipsePlan, type EclipseStageKey, type StageNow } from './eclipsePlan';

const HOUR = 3600000;
/** 식 시작(p1) 이 이만큼 남으면 이벤트 모드가 나타납니다(촬영 준비용). */
export const EVENT_LEAD_MS = 24 * HOUR;
/** 진행 중인 식을 찾으려고 거슬러 보는 시간(식은 가장 깊은 때 ± 3.5 시간 안에 끝남). */
const LOOKBACK_MS = 6 * HOUR;

export interface EclipseEvent { eclipse: LunarEclipse; plan: EclipsePlan; now: StageNow }

export function eclipseEventFor(nowMs: number, latDeg: number, lonDeg: number): EclipseEvent | null {
  if (![nowMs, latDeg, lonDeg].every(Number.isFinite)) return null;
  const eclipse = nextLunarEclipse(nowMs - LOOKBACK_MS);
  if (!eclipse) return null;
  if (nowMs < eclipse.p1Ms - EVENT_LEAD_MS || nowMs > eclipse.p4Ms) return null;
  const plan = planEclipse(eclipse, latDeg, lonDeg);
  if (!plan || !plan.visible || plan.visibleToMs == null || plan.visibleToMs <= nowMs) return null;
  return { eclipse, plan, now: stageAt(plan, nowMs) };
}

export function stageName(key: EclipseStageKey, lang: 'ko' | 'en' | 'ja'): string {
  if (key === 'penumbral') return lang === 'en' ? 'Penumbral' : lang === 'ja' ? '半影' : '반그림자';
  if (key === 'partial') return lang === 'en' ? 'Partial' : lang === 'ja' ? '部分食' : '부분식';
  return lang === 'en' ? 'Total' : lang === 'ja' ? '皆既食' : '개기식';
}

/** 남은 시간 글: 1 시간 미만 "m:ss", 이상 "h:mm:ss". */
export function formatRemain(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
}
