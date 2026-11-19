/**
 * 렌즈 정보 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 2.2) — 샌드박스의 화각을 사진 찍는 사람의 말로 바꿉니다.
 *
 * 하늘 화면의 시야각은 세로 시야각입니다(three.js). 사진의 35mm 환산 초점거리는 **긴 변**의 화각으로 셉니다.
 * 필름 36 × 24 mm 의 긴 변 36 mm 가 기준이라 f = 18 / tan(긴 변 화각 / 2).
 * 세로로 든 폰 화면(가로 < 세로)은 세로가 긴 변이라 세로 시야각을 그대로 씁니다.
 */

/** 폰 카메라의 흔한 렌즈(35mm 환산 mm). 내 폰의 실제 렌즈는 모르므로 대표값입니다. */
export const GENERIC_PHONE_LENSES: ReadonlyArray<{ label: string; mm: number }> = [
  { label: '0.5x', mm: 13 },
  { label: '1x', mm: 24 },
  { label: '3x', mm: 70 },
  { label: '5x', mm: 120 },
];

const RAD = Math.PI / 180;

/** 화면 비율 w/h 와 세로 시야각(°)에서 긴 변의 시야각(°). */
export function longEdgeFovDeg(verticalFovDeg: number, aspectWH: number): number {
  const a = Number.isFinite(aspectWH) && aspectWH > 0 ? aspectWH : 1;
  if (a <= 1) return verticalFovDeg;
  return 2 * Math.atan(a * Math.tan((verticalFovDeg * RAD) / 2)) / RAD;
}

/** 35mm 환산 초점거리(mm). 시야각이 0 에 가까우면 큰 값, 180° 이상이면 0. */
export function equivalentFocalMm(verticalFovDeg: number, aspectWH: number): number {
  const lf = longEdgeFovDeg(Math.max(0.01, Math.min(179.9, verticalFovDeg)), aspectWH);
  return 18 / Math.tan((lf * RAD) / 2);
}

export interface LensSuggestion {
  /** 35mm 환산 초점거리(mm) */
  mm: number;
  /** 쓰기 알맞은 대표 렌즈(이 화각을 넘지 않는 가장 긴 렌즈; 그보다 넓으면 가장 넓은 렌즈) */
  lens: { label: string; mm: number };
  /** 그 렌즈에서 더 당겨야 하는 디지털 배율(1 이하면 렌즈 하나로 충분) */
  digitalZoom: number;
}

export function suggestLens(mm: number, lenses: ReadonlyArray<{ label: string; mm: number }> = GENERIC_PHONE_LENSES): LensSuggestion {
  let pick = lenses[0];
  for (const l of lenses) if (l.mm <= mm * 1.02) pick = l;
  return { mm, lens: pick, digitalZoom: Math.max(1, mm / pick.mm) };
}

/** 화면 한 줄 글: "≈ 900 mm · 5x 렌즈 + 디지털 7.5x". */
export function lensLine(verticalFovDeg: number, aspectWH: number): { mmText: string; lensText: string } {
  const mm = equivalentFocalMm(verticalFovDeg, aspectWH);
  const s = suggestLens(mm);
  const mmText = `≈ ${mm >= 100 ? Math.round(mm / 10) * 10 : Math.round(mm)} mm`;
  const lensText = s.digitalZoom > 1.15 ? `${s.lens.label} + 디지털 ${s.digitalZoom.toFixed(1)}x` : s.lens.label;
  return { mmText, lensText };
}
