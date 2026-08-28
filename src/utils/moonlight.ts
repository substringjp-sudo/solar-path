/**
 * moonlight.ts
 *
 * 달빛이 별의 한계 등급을 얼마나 깎아먹는지.
 *
 * 육안 한계 등급은 새 달·암소(6.5등급 근처)에서 보름달이 중천에 뜬 밤
 * (2~3등급)까지 4등급 가까이 떨어집니다 — 광공해 슬라이더(사용자가 설정한
 * "이 장소는 대체로 이 정도"인 상수)와는 다른, **그날 밤 그 시각**에만
 * 걸리는 항입니다. 둘을 더해 쓰면 됩니다: 실효 한계등급 = 광공해 기준값 −
 * 달빛 손실.
 *
 * 참고 지도(광공해맵) 기반 절대 밝기까지는 아직 없습니다 — 전 지구 래스터를
 * 이 앱에 들여오는 일이라 따로 결정할 문제입니다 (docs 참고). 이 파일은 그
 * 결정과 무관하게 성립하는 물리량(달)만 다룹니다.
 */

/** 보름달이 중천(고도 90°)에 떴을 때 최대로 깎이는 등급. */
const MAX_MAG_LOSS = 4.0;

/**
 * 달의 밝기가 위상에 얼마나 급격히 반응하는가.
 *
 * 달 표면은 반사보다 후방산란(opposition surge)이 강해, 조명받은 넓이가
 * 절반이어도 밝기는 절반보다 훨씬 위입니다. 지수를 1보다 작게 두면
 * 반달(illum≈0.5) 근처에서도 보름에 가까운 밝기를 냅니다.
 */
const ILLUM_GAMMA = 0.65;

/**
 * 달빛으로 인한 한계등급 손실 (뺄 값, ≥0).
 *
 * moonAltDeg: 달의 고도(도). 지평선 아래(<-2°)면 손실 없음.
 * illumFraction: SunCalc.getMoonIllumination(date).fraction — 조명 분율(0~1).
 */
export function moonMagLoss(moonAltDeg: number, illumFraction: number): number {
  // 지평선 근처에서 항성 소광에 쓰는 것과 같은 대기 모델을 재사용합니다
  // (StarField.ts의 airmass/extinction과 동일한 상수) — 달빛도 별빛과
  // 같은 공기층을 지나오므로 다른 모델을 쓸 이유가 없습니다.
  const moonUp = smoothstep(-2, 8, moonAltDeg);
  if (moonUp <= 0) return 0;

  const airmass = 1 / Math.max(0.09, Math.sin(degToRad(Math.max(moonAltDeg, 3))));
  const extinction = Math.exp(-0.16 * (airmass - 1));

  const illum = Math.max(0, Math.min(1, illumFraction));
  const brightness = Math.pow(illum, ILLUM_GAMMA) * extinction * moonUp;

  return MAX_MAG_LOSS * brightness;
}

/**
 * 광공해 기준값(사용자 설정)에 달빛 손실을 얹은 **실효** 한계 등급.
 * 바닥(3.0 — 도심 하늘)보다 아래로는 내려가지 않습니다 — 이미 광공해가
 * 그 밝기를 만들고 있는데 달빛까지 이중으로 빼면 과합니다.
 */
export function effectiveMagLimit(baseMagLimit: number, moonAltDeg: number, illumFraction: number, floor = 3.0): number {
  const loss = moonMagLoss(moonAltDeg, illumFraction);
  return Math.max(floor, baseMagLimit - loss);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
