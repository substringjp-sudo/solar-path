/**
 * tabLabels.ts — 머리줄 탭 이름(2026-11-21, 사용자 결정): 숫자를 붙이지 않고, 학습 탭은 "데이터"입니다.
 * 판정: `tools/shader-preview/verify-tab-labels.js`
 */
export type TabId = 'sky' | 'learn' | 'log';
type Lang = 'ko' | 'en' | 'ja';

export function tabLabel(id: TabId, lang: Lang): string {
  switch (id) {
    case 'sky': return lang === 'en' ? 'SKY' : lang === 'ja' ? '空' : '하늘';
    case 'learn': return lang === 'en' ? 'DATA' : lang === 'ja' ? 'データ' : '데이터';
    default: return lang === 'en' ? 'LOG' : lang === 'ja' ? '記録' : '기록';
  }
}
