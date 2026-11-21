/**
 * modeStrip.ts — 모드 줄(셔터 아래, 좌우로 밀어 고르는 줄)의 순수 계산(목업 "5차: 모드 줄", 2026-11-21).
 *
 * 시뮬레이션이 앱의 시작이고, 샌드박스는 자유 비행 · 넓은 날짜 · 무거운 계산입니다. 사진 · 천체 · 타임랩스(월식 같은 날은 이벤트)는 카메라 쪽입니다. 노을은 모드가 아니라 사진에 합쳤습니다.
 * 시뮬레이션이나 샌드박스에서 카메라 쪽으로 들어가면 먼저 사진 모드에 내리고, 보던 방향이 촬영 가이드가 됩니다.
 * 밀기 값은 손가락이 움직인 거리 dx(px)와 속도 vx(px/s), 왼쪽으로 가는 쪽이 음수입니다(왼쪽으로 밀면 다음 모드가 가운데로 옵니다).
 *
 * 판정: `tools/shader-preview/verify-mode-strip.js`
 */
import type { CaptureModeKey } from './captureMode';

export type AppMode = 'simulation' | 'sandbox' | 'photo' | 'astro' | 'timelapse' | 'event';
type Lang = 'ko' | 'en' | 'ja';

const BASE_MODES: readonly AppMode[] = ['simulation', 'sandbox', 'photo', 'astro', 'timelapse'];

/** 모드 줄에 놓일 모드들. 이벤트는 월식 같은 날에만 맨 끝에 붙습니다. */
export function modeList(eventAvailable: boolean = false): AppMode[] {
  return eventAvailable === true ? [...BASE_MODES, 'event'] : [...BASE_MODES];
}

/** 카메라 쪽 모드인가(시뮬레이션과 샌드박스는 하늘 쪽). */
export const isCamera = (m: AppMode): boolean => m !== 'simulation' && m !== 'sandbox';

/** 기존 촬영 모드 키로 옮김. 하늘 쪽 모드는 null. */
export function captureKeyFor(m: AppMode): CaptureModeKey | null {
  switch (m) {
    case 'photo': return 'normal';
    case 'astro': return 'astro';
    case 'timelapse': return 'timelapse';
    case 'event': return 'event';
    default: return null;
  }
}

const pick = (l: Lang, ko: string, en: string, ja: string): string => (l === 'en' ? en : l === 'ja' ? ja : ko);

export function modeName(m: AppMode, l: Lang): string {
  switch (m) {
    case 'simulation': return pick(l, '시뮬레이션', 'Simulation', 'シミュレーション');
    case 'sandbox': return pick(l, '샌드박스', 'Sandbox', 'サンドボックス');
    case 'photo': return pick(l, '사진', 'Photo', '写真');
    case 'astro': return pick(l, '천체', 'Astro', '天体');
    case 'timelapse': return pick(l, '타임랩스', 'Timelapse', 'タイムラプス');
    default: return pick(l, '이벤트', 'Event', 'イベント');
  }
}

/** 목록에서 칸 수만큼(음수는 뒤로) 옮깁니다. 양 끝에서 멈추고 돌아가지 않습니다. 지금이 목록에 없으면 첫 모드에서 셉니다. */
export function stepBy(list: readonly AppMode[], current: AppMode, steps: number): AppMode {
  const n = Number.isFinite(steps) ? Math.trunc(steps) : 0;
  const i = Math.max(0, list.indexOf(current));
  return list[Math.max(0, Math.min(list.length - 1, i + n))];
}

/** 하늘 쪽에서 카메라 쪽으로 처음 들어올 때는 사진에 내립니다. 그 밖에는 목표 그대로. */
export function landing(from: AppMode, target: AppMode): AppMode {
  return !isCamera(from) && isCamera(target) && target !== 'photo' ? 'photo' : target;
}

/** 글자를 눌러 고르기. 목록에 없는 목표는 지금 그대로. */
export function pickMode(list: readonly AppMode[], current: AppMode, target: AppMode): AppMode {
  return list.includes(target) ? landing(current, target) : current;
}

/** 이 거리(px) 이상 밀면 방향이 정해집니다. */
export const DRAG_MIN_PX = 40;
/** 이 속도(px/s) 이상이면 거리가 짧아도 방향이 정해집니다. */
export const DRAG_MIN_VEL = 600;
/** 이만큼(px) 밀거나 이 속도(px/s)면 두 칸. */
export const DRAG_TWO_PX = 160;
export const DRAG_TWO_VEL = 1800;

export function dragMode(list: readonly AppMode[], current: AppMode, dx: number, vx: number): AppMode {
  if (!Number.isFinite(dx) || !Number.isFinite(vx)) return current;
  let dir = 0;
  if (Math.abs(dx) >= DRAG_MIN_PX) dir = dx < 0 ? 1 : -1;
  else if (Math.abs(vx) >= DRAG_MIN_VEL) dir = vx < 0 ? 1 : -1;
  if (dir === 0) return current;
  const steps = Math.abs(dx) >= DRAG_TWO_PX || Math.abs(vx) >= DRAG_TWO_VEL ? 2 : 1;
  return landing(current, stepBy(list, current, dir * steps));
}

export interface StripItem { mode: AppMode; x: number; opacity: number; visible: boolean }

const OPACITY_BY_DISTANCE = [1, 0.62, 0.34, 0.16] as const;

/** 줄의 글자 자리(가운데 x)와 불투명도. 가운데에서 멀수록 투명해지고 4칸부터는 숨깁니다. */
export function stripLayout(list: readonly AppMode[], center: AppMode, width: number = 390, itemW: number = 84): StripItem[] {
  const a = Math.max(0, list.indexOf(center));
  return list.map((mode, i) => {
    const d = Math.abs(i - a);
    const opacity = d < OPACITY_BY_DISTANCE.length ? OPACITY_BY_DISTANCE[d] : 0;
    return { mode, x: width / 2 + (i - a) * itemW, opacity, visible: opacity > 0 };
  });
}

export interface CameraGuide { azDeg: number; elDeg: number }

/** 보던 방향을 촬영 가이드로. 방위는 [0, 360), 고도는 −90 ~ 90. 숫자가 아니면 null. */
export function viewGuide(view: { azDeg?: number; elDeg?: number } | null | undefined): CameraGuide | null {
  if (!view || typeof view.azDeg !== 'number' || typeof view.elDeg !== 'number') return null;
  if (!Number.isFinite(view.azDeg) || !Number.isFinite(view.elDeg)) return null;
  const az = ((view.azDeg % 360) + 360) % 360;
  return { azDeg: az === 0 ? 0 : az, elDeg: Math.max(-90, Math.min(90, view.elDeg)) };
}

export type GuideOp = 'set' | 'clear' | 'keep';
export interface ModeSwitch { mode: AppMode; guideOp: GuideOp; guide: CameraGuide | null }

/** 모드를 바꿀 때 어디에 내리고, 촬영 가이드를 걸지 · 지울지 · 둘지. */
export function switchMode(from: AppMode, target: AppMode, view: { azDeg?: number; elDeg?: number } | null | undefined): ModeSwitch {
  const mode = landing(from, target);
  if (mode === from) return { mode, guideOp: 'keep', guide: null };
  if (!isCamera(from) && isCamera(mode)) {
    const guide = viewGuide(view);
    return guide ? { mode, guideOp: 'set', guide } : { mode, guideOp: 'clear', guide: null };
  }
  if (isCamera(from) && isCamera(mode)) return { mode, guideOp: 'keep', guide: null };
  return { mode, guideOp: 'clear', guide: null };
}

export type ChipId = 'yesterday' | 'today' | 'tomorrow' | 'date' | 'move' | 'view' | 'scene' | 'tools';

/** 하늘 쪽 모드의 기초 칩. 카메라 쪽은 칩이 따로라 null. 샌드박스는 높이와 줌을 "보기"로 합쳤습니다. */
export function chipsFor(m: AppMode): ChipId[] | null {
  if (m === 'simulation') return ['yesterday', 'today', 'tomorrow', 'date'];
  if (m === 'sandbox') return ['move', 'view', 'scene', 'tools'];
  return null;
}

export function chipLabel(c: ChipId, l: Lang): string {
  switch (c) {
    case 'yesterday': return pick(l, '어제', 'Yesterday', '昨日');
    case 'today': return pick(l, '오늘', 'Today', '今日');
    case 'tomorrow': return pick(l, '내일', 'Tomorrow', '明日');
    case 'date': return pick(l, '날짜', 'Date', '日付');
    case 'move': return pick(l, '이동', 'Move', '移動');
    case 'view': return pick(l, '보기', 'View', '表示');
    case 'scene': return pick(l, '장면', 'Scenes', 'シーン');
    default: return pick(l, '도구', 'Tools', 'ツール');
  }
}
