/**
 * dockStages.ts — 접었다 펼치는 아래 막대의 단계 계산(목업 "4차 b", 애플 카메라 참고, 2026-11-21).
 *
 * 단계는 접힘(min) · 펼침(mid) · 전체(full). 손잡이를 누르면 다음 단계(끝에서는 처음으로), 위로 밀면 펼치고 아래로 밀면 접습니다.
 * 많이 밀거나(160 px) 빠르게 밀면(1800 px/s) 두 단계를 한꺼번에 갑니다. 밀기 값은 위로 가는 쪽이 음수입니다.
 *
 * 판정: `tools/shader-preview/verify-dock-stages.js`
 */
export type DockStage = 'min' | 'mid' | 'full';
export const STAGES: readonly DockStage[] = ['min', 'mid', 'full'];

const idx = (s: DockStage): number => STAGES.indexOf(s);
const at = (i: number): DockStage => STAGES[Math.max(0, Math.min(STAGES.length - 1, i))];

export const tapNext = (s: DockStage): DockStage => STAGES[(idx(s) + 1) % STAGES.length];
export const expand = (s: DockStage): DockStage => at(idx(s) + 1);
export const collapse = (s: DockStage): DockStage => at(idx(s) - 1);

/** 이 거리(px) 이상 밀면 방향이 정해집니다. */
export const DRAG_MIN_PX = 40;
/** 이 속도(px/s) 이상이면 거리가 짧아도 방향이 정해집니다. */
export const DRAG_MIN_VEL = 600;
/** 이만큼(px) 밀거나 이 속도(px/s)면 두 단계. */
export const DRAG_TWO_PX = 160;
export const DRAG_TWO_VEL = 1800;

export function dragStage(stage: DockStage, dy: number, vy: number): DockStage {
  if (!Number.isFinite(dy) || !Number.isFinite(vy)) return stage;
  let dir = 0;
  if (Math.abs(dy) >= DRAG_MIN_PX) dir = dy < 0 ? 1 : -1;
  else if (Math.abs(vy) >= DRAG_MIN_VEL) dir = vy < 0 ? 1 : -1;
  if (dir === 0) return stage;
  const steps = Math.abs(dy) >= DRAG_TWO_PX || Math.abs(vy) >= DRAG_TWO_VEL ? 2 : 1;
  return at(idx(stage) + dir * steps);
}

export interface DockHeights { min: number; mid: number; full: number }

export const DOCK_MIN_PX = 232;
const STEP_MIN_GAP = 96;

/** 단계별 막대 높이(px). 화면이 낮아도 min < mid < full 이 지켜집니다. */
export function dockHeights(screenH: number): DockHeights {
  const H = Number.isFinite(screenH) && screenH > 0 ? screenH : 844;
  const min = DOCK_MIN_PX;
  const mid = Math.round(Math.max(min + STEP_MIN_GAP, Math.min(432, 0.55 * H)));
  const full = Math.round(Math.max(mid + STEP_MIN_GAP, 0.78 * H));
  return { min, mid, full };
}
