/**
 * captureMode.ts — 촬영 모드 고르기(docs/SANDBOX_MODE_PLAN.md 10.3, 목업 16)의 순수 계산.
 *
 * 카메라 화면 위 모드 이름을 누르면 올라오는 시트가 쓰는 값입니다: 맨 위 "지금 권하는 것" 하나, 아래로 일반 · 천체 장노출 · 타임랩스 · 이벤트(별 일주는 타임랩스의 "궤적 누적" 종류로 합쳤습니다).
 * 지금 앱에 있는 모드는 일반(카메라 탭 "노을"), 천체 장노출(탭 "천체"), 타임랩스(탭이 아니라 자체 패널)이고, 이벤트는 흐린 "준비 중" 줄입니다.
 * 권하는 모드는 그때 해 고도로 정합니다: 고도 > −6°(시민 박명 끝 전)이면 일반, 그 아래면 천체 장노출. 샌드박스에서 "이 장면 찍기"로 넘어오면 그 장면의 시각 기준입니다.
 *
 * 판정: `tools/shader-preview/verify-capture-mode.js`
 */
import { sunPosition } from './solarPosition';

export type CaptureModeKey = 'normal' | 'astro' | 'timelapse' | 'event';
export type CameraTab = 'sunset' | 'astro';
type Lang = 'ko' | 'en' | 'ja';

export interface CaptureModeInfo { key: CaptureModeKey; ready: boolean }

export const CAPTURE_MODES: readonly CaptureModeInfo[] = [
  { key: 'normal', ready: true },
  { key: 'astro', ready: true },
  { key: 'timelapse', ready: true },
  { key: 'event', ready: false },
];

/** 이 고도(°) 이하면 하늘이 어두워진 것으로 보고 천체 장노출을 권합니다(시민 박명 끝). */
export const DARK_SUN_ALT_DEG = -6;

export function tabForMode(k: CaptureModeKey): CameraTab | null {
  return k === 'normal' ? 'sunset' : k === 'astro' ? 'astro' : null;
}

export function recommendMode(sunAltDeg: number | null | undefined): CaptureModeKey {
  if (typeof sunAltDeg !== 'number' || !Number.isFinite(sunAltDeg)) return 'normal';
  return sunAltDeg <= DARK_SUN_ALT_DEG ? 'astro' : 'normal';
}

/** 장면의 시각 · 자리에서 해 고도로 권하는 모드. 숫자가 아니면 일반. */
export function modeForScene(s: { timeMs: number; latitude: number; longitude: number }): CaptureModeKey {
  if (![s.timeMs, s.latitude, s.longitude].every(Number.isFinite)) return 'normal';
  const alt = sunPosition(new Date(s.timeMs), s.latitude, s.longitude).altitude * (180 / Math.PI);
  return recommendMode(alt);
}

const pick = (l: Lang, ko: string, en: string, ja: string): string => (l === 'en' ? en : l === 'ja' ? ja : ko);

export function modeLabel(k: CaptureModeKey, l: Lang): string {
  switch (k) {
    case 'normal': return pick(l, '일반', 'Normal', '通常');
    case 'astro': return pick(l, '천체 장노출', 'Long exposure', '天体長時間露光');
    case 'timelapse': return pick(l, '타임랩스', 'Timelapse', 'タイムラプス');
    default: return pick(l, '이벤트', 'Event', 'イベント');
  }
}

/** 결과물 종류 한 줄. */
export function modeDesc(k: CaptureModeKey, l: Lang): string {
  switch (k) {
    case 'normal': return pick(l, '노을 · 일출 사진 한 장', 'A sunset or sunrise photo', '夕焼け・日の出の写真');
    case 'astro': return pick(l, '달 · 별 · 은하수를 길게 노출한 한 장', 'Moon, stars or Milky Way in one long exposure', '月・星・天の川の長時間露光');
    case 'timelapse': return pick(l, '시간이 흐르는 짧은 영상 · 밝게 합성 · 별 궤적 누적', 'A short video of time passing, with bright stacking and star trails', '時間の流れの動画・明るく合成・星の軌跡の累積');
    default: return pick(l, '월식 같은 하늘 이벤트', 'Sky events such as a lunar eclipse', '月食などの天体イベント');
  }
}

/** 모드 줄 오른쪽의 결과물 종류 글(목업 16). 타임랩스는 이 앱이 아직 영상을 만들지 않아 "사진 묶음"이라고 사실대로 적습니다. */
export function modeResultTag(k: CaptureModeKey, l: Lang): string {
  switch (k) {
    case 'normal': return pick(l, '사진', 'Photo', '写真');
    case 'astro': return pick(l, '쌓은 사진', 'Stacked photo', '積み重ね写真');
    case 'timelapse': return pick(l, '사진 묶음', 'Photo set', '写真の束');
    default: return pick(l, '준비 중', 'Coming soon', '準備中');
  }
}

/** 권하는 이유. 일반과 천체 장노출에만 있고 나머지는 권하지 않으므로 null. */
export function recommendReason(k: CaptureModeKey, l: Lang): string | null {
  if (k === 'normal') return pick(l, '해가 아직 지평선 가까이예요', 'The sun is still near the horizon', '太陽はまだ地平線の近くです');
  if (k === 'astro') return pick(l, '해가 진 뒤라 달 · 별 촬영에 알맞아요', 'The sun has set, good for moon and stars', '日没後で月・星の撮影に向いています');
  return null;
}

export interface SheetRow extends CaptureModeInfo { recommended: boolean }
export interface SheetRows { recommended: CaptureModeKey; rows: SheetRow[] }

export function sheetRows(recommended: CaptureModeKey): SheetRows {
  return { recommended, rows: CAPTURE_MODES.map(m => ({ ...m, recommended: m.key === recommended })) };
}
