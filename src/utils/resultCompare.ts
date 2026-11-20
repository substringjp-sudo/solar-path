/**
 * resultCompare.ts — 촬영 결과 비교(docs/SANDBOX_MODE_PLAN.md 8.7, 목업 5)의 순수 계산.
 *
 *  - `zoneStats`: 작게 줄인 그림(RGBA)을 왼쪽 · 가운데 · 오른쪽(+ 선택으로 해 근처)으로 나눠 평균 밝기와 붉기를 냅니다.
 *  - `diffLines`: 사진과 예측의 영역별 차이를 "해 근처 하늘이 예측보다 어두움" 같은 짧은 줄(최대 3)로 말합니다.
 *  - `clampSplit`: "반씩 보기" 손잡이 위치(0.05 ~ 0.95).
 *  - `forecastLine`: "맑음 · 해 고도 8° · 방위 245°" 한 줄.
 *  - `sunFractionInPhoto`: 해가 사진의 어디인지(가로 · 세로 비율). 있으면 "해 근처" 비교가 들어갑니다.
 *
 * 판정: `tools/shader-preview/verify-result-compare.js`
 */
import { dirFromAzEl, intrinsicsFromHfov, project, type Attitude } from './arVision';

type Lang = 'ko' | 'en' | 'ja';
const pick = (l: Lang, ko: string, en: string, ja: string): string => (l === 'en' ? en : l === 'ja' ? ja : ko);

export interface ZoneValue { lum: number; red: number }
export interface Zones { left: ZoneValue; center: ZoneValue; right: ZoneValue; sun?: ZoneValue }

/** 해 근처로 보는 반지름(그림 너비 대비). */
export const SUN_RADIUS_FRAC = 0.2;
/** 이만큼(0~1) 넘게 다르면 짚습니다(경계 포함). */
export const DIFF_THRESHOLD = 0.08;
export const MAX_LINES = 3;

const lumOf = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function zoneStats(rgba: ArrayLike<number>, w: number, h: number, sun?: { x: number; y: number }): Zones | null {
  if (!(w >= 1) || !(h >= 1) || rgba.length !== w * h * 4) return null;
  const acc = { left: [0, 0, 0], center: [0, 0, 0], right: [0, 0, 0], sun: [0, 0, 0] };
  const sx = sun ? sun.x * w : 0, sy = sun ? sun.y * h : 0, rad = SUN_RADIUS_FRAC * w;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      const lum = lumOf(rgba[k], rgba[k + 1], rgba[k + 2]);
      const red = (rgba[k] - rgba[k + 2]) / 255;
      const z = (i * 3) / w < 1 ? acc.left : (i * 3) / w < 2 ? acc.center : acc.right;
      z[0] += lum; z[1] += red; z[2] += 1;
      if (sun && Math.hypot(i + 0.5 - sx, j + 0.5 - sy) <= rad) { acc.sun[0] += lum; acc.sun[1] += red; acc.sun[2] += 1; }
    }
  }
  const avg = (a: number[]): ZoneValue => ({ lum: a[0] / a[2], red: a[1] / a[2] });
  const out: Zones = { left: avg(acc.left), center: avg(acc.center), right: avg(acc.right) };
  if (sun && acc.sun[2] > 0) out.sun = avg(acc.sun);
  return out;
}

const ZONE_ORDER = ['left', 'center', 'right', 'sun'] as const;
const zoneName = (z: (typeof ZONE_ORDER)[number], l: Lang): string =>
  z === 'left' ? pick(l, '왼쪽', 'Left', '左') : z === 'center' ? pick(l, '가운데', 'Middle', '中央') : z === 'right' ? pick(l, '오른쪽', 'Right', '右') : pick(l, '해 근처', 'Near-sun', '太陽付近');

export function diffLines(photo: Zones, sim: Zones, lang: Lang): string[] {
  const items: Array<{ mag: number; order: number; kind: number; text: string }> = [];
  ZONE_ORDER.forEach((z, order) => {
    const a = photo[z], b = sim[z];
    if (!a || !b) return;
    const name = zoneName(z, lang);
    const dl = a.lum - b.lum, dr = a.red - b.red;
    if (Math.abs(dl) >= DIFF_THRESHOLD - 1e-9) {
      items.push({ mag: Math.round(Math.abs(dl) * 1e6) / 1e6, order, kind: 0, text: dl < 0
        ? pick(lang, `${name} 하늘이 예측보다 어두움`, `${name} sky is darker than predicted`, `${name}の空は予測より暗い`)
        : pick(lang, `${name} 하늘이 예측보다 밝음`, `${name} sky is brighter than predicted`, `${name}の空は予測より明るい`) });
    }
    if (Math.abs(dr) >= DIFF_THRESHOLD - 1e-9) {
      items.push({ mag: Math.round(Math.abs(dr) * 1e6) / 1e6, order, kind: 1, text: dr < 0
        ? pick(lang, `${name} 하늘이 예측보다 덜 붉음`, `${name} sky is less red than predicted`, `${name}の空は予測より赤みが弱い`)
        : pick(lang, `${name} 하늘이 예측보다 더 붉음`, `${name} sky is redder than predicted`, `${name}の空は予測より赤みが強い`) });
    }
  });
  if (items.length === 0) return [pick(lang, '예측과 비슷해요', 'Close to the prediction', '予測に近いです')];
  items.sort((x, y) => y.mag - x.mag || x.order - y.order || x.kind - y.kind);
  return items.slice(0, MAX_LINES).map(i => i.text);
}

export const SPLIT_RANGE = { min: 0.05, max: 0.95 } as const;

export function clampSplit(x: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(x)) return 0.5;
  return Math.min(SPLIT_RANGE.max, Math.max(SPLIT_RANGE.min, x / width));
}

export function forecastLine(desc: string, sunAltDeg: number, sunAzDeg: number, lang: Lang): string | null {
  const parts: string[] = [];
  if (desc) parts.push(desc);
  if (Number.isFinite(sunAltDeg)) parts.push(`${pick(lang, '해 고도', 'Sun alt', '太陽高度')} ${Math.round(sunAltDeg)}°`);
  if (Number.isFinite(sunAzDeg)) parts.push(`${pick(lang, '방위', 'az', '方位')} ${((Math.round(sunAzDeg) % 360) + 360) % 360}°`);
  return parts.length ? parts.join(' · ') : null;
}

/** 사진(세로로 든 3:4)의 가로 : 세로. */
const PHOTO_W = 3;
const PHOTO_H = 4;

/**
 * 해가 사진의 어디인지(왼쪽 위 0, 0 ~ 오른쪽 아래 1, 1). 촬영 때의 자세 · 센서 짧은 변 화각 · 배율로 핀홀 투영합니다.
 * 해가 카메라 뒤거나 사진 밖이거나 입력이 숫자가 아니면 null(그러면 해 근처 비교가 빠집니다).
 */
export function sunFractionInPhoto(
  sunAzDeg: number,
  sunAltDeg: number,
  att: Attitude,
  sensorShortFovDeg: number,
  magnification: number,
): { x: number; y: number } | null {
  if (![sunAzDeg, sunAltDeg, att.yawDeg, att.pitchDeg, att.rollDeg, sensorShortFovDeg, magnification].every(Number.isFinite)) return null;
  const tanShort = Math.tan((sensorShortFovDeg * Math.PI) / 360) / Math.max(1, magnification);
  const k = intrinsicsFromHfov(PHOTO_W, PHOTO_H, (2 * Math.atan(tanShort) * 180) / Math.PI);
  const q = project(dirFromAzEl(sunAzDeg, sunAltDeg), att, k);
  if (!q) return null;
  const x = q.x / PHOTO_W, y = q.y / PHOTO_H;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
