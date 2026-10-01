/**
 * airQuality.ts — 대기질을 알림 한 줄로(2026-10-01).
 *
 * 노을·일출 예보 알림에 "공기가 나빠 색이 흐릴 수 있다"를 붙일지 정합니다. 기준은 새로 지어내지 않고
 * 한국 환경부 대기질 예보의 '나쁨' 하한을 그대로 씁니다:
 *  - 먼지(CAMS 지표 dust) 81µg/m³ 이상 → 황사. PM10 '나쁨' 하한(81~150)을 먼지 성분에 적용합니다.
 *  - PM2.5 36µg/m³ 이상 → 미세먼지. PM2.5 '나쁨' 하한(36~75).
 * 둘 다 넘으면 황사를 알립니다 — 조대 입자가 노을 채도를 더 크게 깎습니다(`atmosphere.ts` Ångström 주석).
 * 자료가 없거나 기준 아래면 빈 문자열입니다. 깨끗하다고 단정하지 않습니다.
 *
 * 판정: `tools/shader-preview/verify-aerosol.js` [7].
 */
import type { Language } from './i18n';

export const DUST_BAD_UGM3 = 81;
export const PM25_BAD_UGM3 = 36;

const L3 = (lang: Language, ko: string, en: string, ja: string) => (lang === 'ko' ? ko : lang === 'ja' ? ja : en);

export function airQualityNote(obs: { dust?: number | null; pm25?: number | null } | null | undefined, lang: Language): string {
  if (!obs) return '';
  const dust = obs.dust;
  const pm25 = obs.pm25;
  if (dust != null && Number.isFinite(dust) && dust >= DUST_BAD_UGM3) {
    return L3(lang, '황사가 짙어 하늘빛이 흐릴 수 있어요.', 'Dusty air may dull the colors.', '黄砂で空の色がくすむかもしれません。');
  }
  if (pm25 != null && Number.isFinite(pm25) && pm25 >= PM25_BAD_UGM3) {
    return L3(lang, '미세먼지가 많아 하늘이 뿌열 수 있어요.', 'Fine-dust haze may wash out the colors.', 'PM2.5で空がかすむかもしれません。');
  }
  return '';
}
