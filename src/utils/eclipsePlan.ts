/**
 * eclipsePlan.ts — **월식 촬영 계획**(이벤트 모드의 바탕, docs/SANDBOX_MODE_PLAN.md 목업 13). 순수 함수.
 *
 *  - 단계 시간표: `lunarEclipse` 의 접촉 시각을 시간 순서의 단계(반그림자 · 부분 · 개기)로 나눕니다.
 *  - 관측지 가시성: 달의 보이는 고도(`getMoonPositionPrecise`, 굴절 포함)가 0 보다 큰 때를 2 분 간격으로 보고 경계는 이분법으로 다듬습니다.
 *  - 단계별 노출 지침: 달 밝기를 EV100 로 놓고(보름달 14, 개기 가장자리 8, 개기 한가운데 4) 조리개 f/1.8 에서 ISO 는 낮은 값부터 올려 셔터를 0.5 초 이하로 둡니다.
 *    카메라를 조종하지는 않고 안내만 합니다(expo-camera 는 ISO · 셔터를 못 정함).
 *  - 지금 단계: 식 앞 · 안 · 뒤와 다음 단계까지 남은 시간.
 * 판정: `tools/shader-preview/verify-eclipse-plan.js`
 */
import type { LunarEclipse } from './lunarEclipse';
import { getMoonPositionPrecise } from './moonPosition';
import { APERTURE_N, ISO_STEPS, SHUTTER_STEPS, shutterLabel } from './exposureAdvice';

export type EclipseStageKey = 'penumbral' | 'partial' | 'total';
export interface EclipseStage { key: EclipseStageKey; startMs: number; endMs: number; visible: boolean }
export interface EclipsePlan {
  stages: EclipseStage[];
  visible: boolean;
  visibleFromMs: number | null;
  visibleToMs: number | null;
}

const RAD = Math.PI / 180;
const MIN = 60000;
const SAMPLE_MS = 2 * MIN;

export function planEclipse(e: LunarEclipse | null, latDeg: number, lonDeg: number): EclipsePlan | null {
  if (!e || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || !Number.isFinite(e.p1Ms) || !Number.isFinite(e.p4Ms)) return null;
  const up = (ms: number) => getMoonPositionPrecise(new Date(ms), latDeg, lonDeg).altitude / RAD > 0;

  const cuts: Array<[EclipseStageKey, number, number]> = [];
  if (e.u2Ms != null && e.u3Ms != null && e.u1Ms != null && e.u4Ms != null) {
    cuts.push(['penumbral', e.p1Ms, e.u1Ms], ['partial', e.u1Ms, e.u2Ms], ['total', e.u2Ms, e.u3Ms], ['partial', e.u3Ms, e.u4Ms], ['penumbral', e.u4Ms, e.p4Ms]);
  } else if (e.u1Ms != null && e.u4Ms != null) {
    cuts.push(['penumbral', e.p1Ms, e.u1Ms], ['partial', e.u1Ms, e.u4Ms], ['penumbral', e.u4Ms, e.p4Ms]);
  } else {
    cuts.push(['penumbral', e.p1Ms, e.p4Ms]);
  }

  // 식 구간 전체를 2 분 간격으로 훑어 달이 떠 있는 때를 모은다(양 끝 포함).
  const times: number[] = [];
  for (let t = e.p1Ms; t < e.p4Ms; t += SAMPLE_MS) times.push(t);
  times.push(e.p4Ms);
  const ups = times.map(up);

  const refine = (a: number, b: number): number => { // up(a) !== up(b) 인 경계를 ~10 초로
    const ua = up(a);
    for (let i = 0; i < 14 && b - a > 10000; i++) { const m = (a + b) / 2; if (up(m) === ua) a = m; else b = m; }
    return (a + b) / 2;
  };
  let fromMs: number | null = null, toMs: number | null = null;
  const firstUp = ups.indexOf(true);
  if (firstUp >= 0) {
    fromMs = firstUp === 0 ? e.p1Ms : refine(times[firstUp - 1], times[firstUp]);
    const lastUp = ups.lastIndexOf(true);
    toMs = lastUp === ups.length - 1 ? e.p4Ms : refine(times[lastUp], times[lastUp + 1]);
  }

  // 달은 식 구간(6 시간 안) 안에서 한 번 뜨거나 지므로, 보이는 구간 [fromMs, toMs] 와 겹치는 단계가 보이는 단계.
  const stages: EclipseStage[] = cuts.map(([key, startMs, endMs]) => ({
    key, startMs, endMs,
    visible: fromMs != null && toMs != null && fromMs <= endMs && toMs >= startMs,
  }));
  return { stages, visible: stages.some(s => s.visible), visibleFromMs: fromMs, visibleToMs: toMs };
}

export interface MoonExposure { iso: number; shutterS: number; shutterText: string }

/** 달 밝기(EV100) → ISO · 셔터 추천. 셔터 0.5 초 이하가 되는 가장 낮은 ISO(없으면 최대 ISO). */
export function adviseMoonExposure(ev100: number): MoonExposure {
  const t0 = (APERTURE_N * APERTURE_N) / Math.pow(2, ev100);
  const iso = ISO_STEPS.find(i => (t0 * 100) / i <= 0.5) ?? ISO_STEPS[ISO_STEPS.length - 1];
  const t = (t0 * 100) / iso;
  let best = SHUTTER_STEPS[0], bd = Infinity;
  for (const s of SHUTTER_STEPS) { const d = Math.abs(Math.log(t / s)); if (d < bd) { bd = d; best = s; } }
  return { iso, shutterS: best, shutterText: shutterLabel(best) };
}

export interface StageExposure { brightEv: number; darkEv: number; bright: MoonExposure; dark: MoonExposure }
const STAGE_EV: Record<EclipseStageKey, [number, number]> = { penumbral: [14, 14], partial: [14, 14], total: [8, 4] };
export function stageExposure(key: EclipseStageKey): StageExposure {
  const [b, d] = STAGE_EV[key];
  return { brightEv: b, darkEv: d, bright: adviseMoonExposure(b), dark: adviseMoonExposure(d) };
}

export interface StageNow { phase: 'before' | 'in' | 'after'; stage: EclipseStage | null; next: EclipseStage | null; remainingMs: number }
export function stageAt(plan: EclipsePlan, nowMs: number): StageNow {
  const s = plan.stages;
  if (nowMs < s[0].startMs) return { phase: 'before', stage: null, next: s[0], remainingMs: s[0].startMs - nowMs };
  for (let i = 0; i < s.length; i++) {
    if (nowMs >= s[i].startMs && nowMs < s[i].endMs) return { phase: 'in', stage: s[i], next: s[i + 1] ?? null, remainingMs: s[i].endMs - nowMs };
  }
  return { phase: 'after', stage: null, next: null, remainingMs: 0 };
}
