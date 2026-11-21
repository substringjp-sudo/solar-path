/**
 * layoutOverlap.ts — 화면 요소 사각형이 서로 겹치는지 재는 순수 계산(2026-11-21, UI 정리).
 * 웹 하네스가 그린 요소의 위치를 읽어 이 함수로 겹침을 찾습니다. 부모와 자식(조상 포함)은 겹쳐도 세지 않습니다.
 *
 * 판정: `tools/shader-preview/verify-dock-stages.js`
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface LayoutItem { id: string; rect: Rect; parent?: string }

/** 이 값(px) 이하로 겹치는 것은 반올림 오차로 보고 겹침으로 세지 않습니다. */
export const OVERLAP_TOL_PX = 0.5;

export function overlaps(a: Rect, b: Rect): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > OVERLAP_TOL_PX && h > OVERLAP_TOL_PX;
}

export function findOverlaps(items: readonly LayoutItem[]): Array<[string, string]> {
  const byId = new Map(items.map(i => [i.id, i]));
  const isAncestor = (anc: string, id: string): boolean => {
    let cur = byId.get(id)?.parent;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === anc) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parent;
    }
    return false;
  };
  const out: Array<[string, string]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) continue;
      if (overlaps(a.rect, b.rect)) out.push([a.id, b.id]);
    }
  }
  return out;
}
