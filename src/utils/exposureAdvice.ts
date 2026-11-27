/**
 * exposureAdvice.ts — 카메라의 **노출 추천 칸**(ISO · 셔터 · WB, docs/SANDBOX_MODE_PLAN.md 16절 표 4). 순수 함수.
 *
 * 카메라를 조종하지 않습니다(expo-camera 는 사진 모드의 ISO · 셔터 · WB 를 못 정함). 해 고도에서 **맑은 하늘**의 밝기(`exposureCurve.sceneLux`)를 어림해
 * "이 정도 밝기면 이렇게 찍는 게 보통"이라는 값을 알려 줍니다. 구름 · 지형은 반영하지 않습니다.
 *
 *  - EV100 = log2(lux ÷ 2.5)(입사광 노출계 상수 C = 250), 조리개 N = 1.8 고정, ISO 100 의 셔터 t0 = N² ÷ 2^EV100.
 *  - 손에 들면 셔터가 1/30 초보다 느려지지 않게 ISO 를 올립니다(필요 ISO = 100 × t0 × 30 이상인 가장 작은 표준 ISO, 100 ~ 3200).
 *  - 단계: ok(셔터 ≤ 1/30 s, 삼각대는 ≤ 1 s) · tripod(손으로는 느림) · astro(1 s 넘음 — 천체 탭 권장).
 *  - WB 는 통념에 따른 설계 값(노을에 자동 WB 는 붉은 색을 누르는 일이 흔해 고정을 권함): ≥ 6° 자동 · [−6°, 6°) 일광 고정 · < −6° 야간 4000K.
 * 판정은 `tools/shader-preview/verify-exposure-advice.js`(손계산 기준).
 */
import { sceneLux } from './exposureCurve';

export const APERTURE_N = 1.8;
const HANDHELD_MAX_S = 1 / 30;
const TRIPOD_OK_S = 1;
export const ISO_STEPS: readonly number[] = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200];
/** 1/3 단 표준 셔터(초). */
export const SHUTTER_STEPS: readonly number[] = [
  1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40,
  1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30,
];

export type ExposureLevel = 'ok' | 'tripod' | 'astro';
export type WbAdvice = 'auto' | 'daylight' | 'night';

export interface ExposureAdvice {
  ev100: number;
  iso: number;
  shutterS: number;
  shutterText: string;
  level: ExposureLevel;
  wb: WbAdvice;
}

const nearestLog = (steps: readonly number[], v: number): number => {
  let best = steps[0], bd = Infinity;
  for (const s of steps) { const d = Math.abs(Math.log(v / s)); if (d < bd) { bd = d; best = s; } }
  return best;
};

/** 셔터(초) → "1/50" · 1 초 이상 "2.5s". */
export function shutterLabel(s: number): string {
  if (s >= 1) return `${Math.round(s * 10) / 10}s`;
  return `1/${Math.round(1 / s)}`;
}

/** 해 고도(°) → 노출 추천. 숫자가 아니면 null. */
export function adviseExposure(altDeg: number, opts: { handheld?: boolean; maxShutterS?: number } = {}): ExposureAdvice | null {
  const lux = sceneLux(altDeg);
  if (lux == null) return null;
  const handheld = opts.handheld !== false;
  const ev100 = Math.log2(lux / 2.5);
  const t0 = (APERTURE_N * APERTURE_N) / Math.pow(2, ev100);
  let iso = 100;
  if (handheld) {
    const need = (100 * t0) / HANDHELD_MAX_S;
    iso = ISO_STEPS.find(i => i >= need) ?? ISO_STEPS[ISO_STEPS.length - 1];
  }
  const t = (t0 * 100) / iso;
  const rawShutterS = nearestLog(SHUTTER_STEPS, t);
  const shutterS = opts.maxShutterS != null ? Math.min(opts.maxShutterS, rawShutterS) : rawShutterS;
  const level: ExposureLevel = t > TRIPOD_OK_S ? 'astro' : handheld && t > HANDHELD_MAX_S ? 'tripod' : 'ok';
  const wb: WbAdvice = altDeg >= 6 ? 'auto' : altDeg >= -6 ? 'daylight' : 'night';
  return { ev100, iso, shutterS, shutterText: shutterLabel(shutterS), level, wb };
}

export function wbLabel(wb: WbAdvice, lang: 'ko' | 'en' | 'ja'): string {
  if (wb === 'auto') return lang === 'en' ? 'Auto' : lang === 'ja' ? 'オート' : '자동';
  if (wb === 'daylight') return lang === 'en' ? 'Daylight lock' : lang === 'ja' ? '太陽光固定' : '일광 고정';
  return lang === 'en' ? 'Night 4000K' : lang === 'ja' ? '夜 4000K' : '야간 4000K';
}

export type PhotoWbPreset = 'auto' | 3200 | 4000 | 5200 | 6500 | 7500;

export const PHOTO_ISO_CHOICES: readonly number[] = [100, 200, 400, 800, 1600, 3200];
export const PHOTO_SHUTTER_CHOICES: readonly number[] = [
  1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 0.5, 1, 2, 4,
];
export const PHOTO_WB_CHOICES: readonly PhotoWbPreset[] = ['auto', 3200, 4000, 5200, 6500, 7500];

const WB_GAINS_MAP: Record<Exclude<PhotoWbPreset, 'auto'>, [number, number, number]> = {
  3200: [0.82, 1.0, 1.38],
  4000: [0.91, 1.0, 1.18],
  5200: [1.0, 1.0, 1.0],
  6500: [1.16, 1.0, 0.86],
  7500: [1.30, 1.0, 0.74],
};

const WB_TINT_MAP: Record<Exclude<PhotoWbPreset, 'auto'>, string | null> = {
  3200: 'rgba(96, 165, 250, 0.16)',
  4000: 'rgba(147, 197, 253, 0.09)',
  5200: null,
  6500: 'rgba(251, 191, 36, 0.10)',
  7500: 'rgba(249, 115, 22, 0.16)',
};

export function photoWbLabel(wb: PhotoWbPreset | null, lang: 'ko' | 'en' | 'ja'): string {
  if (wb == null || wb === 'auto') return lang === 'en' ? 'Auto' : lang === 'ja' ? 'オート' : '자동';
  if (wb === 5200) return lang === 'en' ? '5200K Day' : lang === 'ja' ? '5200K 太陽' : '5200K 일광';
  return `${wb}K`;
}

export function wbGainsForPreset(wb: PhotoWbPreset | null): [number, number, number] | undefined {
  if (wb == null || wb === 'auto') return undefined;
  return WB_GAINS_MAP[wb];
}

export function wbTintColor(wb: PhotoWbPreset | null): string | null {
  if (wb == null || wb === 'auto') return null;
  return WB_TINT_MAP[wb];
}

export function computeManualEvOffset(
  advice: ExposureAdvice | null,
  manualIso: number | null,
  manualShutterS: number | null,
): number {
  if (!advice || (manualIso == null && manualShutterS == null)) return 0;
  const baseShutter = Math.min(1, advice.shutterS);
  const effIso = manualIso ?? advice.iso;
  const effShutter = manualShutterS ?? baseShutter;
  const delta = Math.log2(Math.max(1, effIso) / Math.max(1, advice.iso))
    + Math.log2(Math.max(1e-5, effShutter) / Math.max(1e-5, baseShutter));
  return Math.max(-6, Math.min(6, delta));
}

export function shutterLevelFor(shutterS: number): ExposureLevel {
  if (shutterS > TRIPOD_OK_S) return 'astro';
  if (shutterS > HANDHELD_MAX_S) return 'tripod';
  return 'ok';
}
