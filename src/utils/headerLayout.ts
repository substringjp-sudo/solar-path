/**
 * headerLayout.ts — 앱 머리줄이 **하늘 화면 위에 떠 있을 때**의 자리와 재질(docs/SANDBOX_MODE_PLAN.md 19 · 20절). 순수 값과 함수.
 *
 * 하늘 탭: 머리줄이 3D 하늘 위에 유리로 떠 있고 하늘은 머리줄 뒤까지 이어집니다(위 어두운 막이 그 뒤를 깔아 글자 대비를 지킴).
 * 학습 · 기록 탭: 불투명한 화면이라 내용이 머리줄 아래에서 시작하고 머리줄은 기존 테마 상자를 씁니다(유리 + 밝은 테마 = 흰 글자 대비 3.21 로 모자람).
 * 판정: `tools/shader-preview/verify-header-layout.js`
 */
export const HEADER_PAD_TOP = 4;
export const HEADER_ROW = 40;
export const HEADER_PAD_BOTTOM = 4;
/** 머리줄이 차지하는 높이(위 여백 + 줄 + 아래 여백). */
export const HEADER_HEIGHT = HEADER_PAD_TOP + HEADER_ROW + HEADER_PAD_BOTTOM;

export type HeaderMaterial = 'glass' | 'solid';

/** 하늘 탭만 유리, 나머지(모르는 탭 포함)는 불투명 테마 상자. */
export function headerMaterial(tab: string | undefined | null): HeaderMaterial {
  return tab === 'sky' ? 'glass' : 'solid';
}

/** 탭 내용이 머리줄 때문에 내려가야 하는 높이: 하늘 0(하늘이 머리줄 뒤까지), 나머지 `HEADER_HEIGHT`. */
export function contentInsetTop(tab: string | undefined | null): number {
  return tab === 'sky' ? 0 : HEADER_HEIGHT;
}

/** 하늘 화면 위에 떠 있는 것의 기준 top 에 머리줄 높이를 더한 값. 숫자가 아니면 `HEADER_HEIGHT`. */
export function belowHeader(baseTop: number): number {
  return (typeof baseTop === 'number' && Number.isFinite(baseTop) ? baseTop : 0) + HEADER_HEIGHT;
}
