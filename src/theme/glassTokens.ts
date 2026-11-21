/**
 * glassTokens.ts — 유리 재질과 위아래 어두운 막의 값(목업 "4차 b", 2026-11-21). 순수 값과 계산이라 판정 스크립트로 잽니다.
 *
 * 하늘 위에 떠 있는 조작부는 테두리 없는 옅은 유리(흐림 + 어두운 칠)이고, 시간 자와 모드 줄은 상자 없이 글자만 둡니다.
 * 밝은 하늘에서도 읽히도록 위쪽과 아래쪽에 어두운 막을 깔고, 글자는 모두 #F1F5F9 입니다(하늘색 글자는 밝은 배경에서 대비가 모자랍니다).
 * 값은 가장 밝은 배경(연무 #E9E2D6)에서 글자 대비가 보통 글자 4.5, 큰 글자 3 을 넘도록 손계산으로 정했습니다.
 *
 * 판정: `tools/shader-preview/verify-glass-tokens.js`
 */
export type RGB = readonly [number, number, number];
/** [위치 0~1, 검정 알파] 정지점 */
export type ScrimStops = ReadonlyArray<readonly [number, number]>;

export const TEXT = '#F1F5F9';
/** 켜진 칩의 글자도 같은 색입니다. 하늘색 글자는 밝은 배경에서 대비가 2.95 로 모자라 쓰지 않습니다. */
export const ACTIVE_CHIP_TEXT = TEXT;

export const GLASS = {
  fillRGB: [18, 22, 34] as RGB,
  /** 흐림이 있을 때 칠 알파. */
  fillAlpha: 0.44,
  /** 흐림이 없을 때(대체) 칠 알파. 흐림이 없으면 뒤가 그대로 비쳐서 조금 더 짙게. */
  flatAlpha: 0.5,
  blurPx: 22,
  saturate: 1.5,
  /** 켜진 칩 덧칠(하늘색). 이보다 짙으면 흰 글자 대비가 4.5 밑으로 떨어집니다. */
  tintRGB: [56, 189, 248] as RGB,
  tintAlpha: 0.2,
  /** 위 가장자리 안쪽 선(테두리 대신). */
  highlight: 'rgba(255,255,255,0.16)',
  textShadow: { x: 0, y: 1, blur: 3, color: 'rgba(0,0,0,0.65)' },
} as const;

/** 아래 막: 아래 묶음 높이에서의 위치(위 0 → 아래 1)별 검정 알파. */
export const SCRIM_BOTTOM: ScrimStops = [[0, 0], [0.18, 0.3], [0.55, 0.58], [1, 0.72]];
/** 위 막: 위 가장자리에서 아래로 150 px. */
export const SCRIM_TOP = { stops: [[0, 0.55], [1, 0]] as ScrimStops, heightPx: 150 } as const;

/** 정지점 사이를 직선으로 이은 알파. 범위 밖은 양 끝 값, 숫자가 아니면 0. */
export function scrimAlpha(stops: ScrimStops, pos: number): number {
  if (!Number.isFinite(pos) || stops.length === 0) return 0;
  if (pos <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p0, a0] = stops[i - 1];
    const [p1, a1] = stops[i];
    if (pos <= p1) return a0 + ((a1 - a0) * (pos - p0)) / (p1 - p0);
  }
  return stops[stops.length - 1][1];
}

/** SVG 그라데이션용 { offset, opacity } 목록(offset 0 ~ 1 을 count 개로 나눔). */
export function scrimStops(stops: ScrimStops, count: number = 5): Array<{ offset: number; opacity: number }> {
  const n = Math.max(2, Math.floor(count));
  return Array.from({ length: n }, (_, i) => {
    const offset = i / (n - 1);
    return { offset, opacity: scrimAlpha(stops, offset) };
  });
}

/** 바탕에 색을 알파로 섞기(sRGB 값에서, CSS 와 같게). */
export function blendRGB(base: RGB, color: RGB, alpha: number): [number, number, number] {
  return [0, 1, 2].map(i => base[i] * (1 - alpha) + color[i] * alpha) as [number, number, number];
}

const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (c: RGB): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

/** WCAG 2 대비(1 ~ 21). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 유리 칠 CSS 색. */
export function glassFill(blur: boolean): string {
  const [r, g, b] = GLASS.fillRGB;
  return `rgba(${r}, ${g}, ${b}, ${blur ? GLASS.fillAlpha : GLASS.flatAlpha})`;
}

/** 바탕 → 검정 막 → 유리 칠 순서로 섞인 색. */
export function glassBackdrop(backdrop: RGB, scrim: number, blur: boolean): [number, number, number] {
  return blendRGB(blendRGB(backdrop, [0, 0, 0], scrim), GLASS.fillRGB, blur ? GLASS.fillAlpha : GLASS.flatAlpha);
}
