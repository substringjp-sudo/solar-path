/**
 * dragGuard.ts — 끌기가 끝난 직후의 "누름"을 걸러 냅니다.
 * 손가락이 칩 위에서 시작해 끌린 뒤 떨어질 때, 밑에 깔린 단추의 누름이 같이 일어나 방금 바꾼 것이 되돌아가는 일을 막습니다(웹 하네스에서 확인: 모드 줄을 끌면 사진으로 갔다가 샌드박스로 되돌아갔다).
 */
let lastDragEnd = 0;
/** 이 시간(ms) 안의 누름은 끌기의 끝으로 보고 무시합니다. */
export const DRAG_GUARD_MS = 300;

export const markDragEnd = (): void => { lastDragEnd = Date.now(); };
export const isRecentDrag = (): boolean => Date.now() - lastDragEnd < DRAG_GUARD_MS;
