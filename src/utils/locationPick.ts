/**
 * locationPick.ts
 *
 * **지도에서 바로 위치를 옮기기 위한 문과 자리 계산.**
 *
 * ## 왜 탭의 뜻이 축척에 따라 달라지나
 *
 * 지도 한가운데를 집어 옮기려면 그 한 점이 **뜻이 있을 만큼 정밀**해야 합니다.
 * 화면이 넓으면 중앙이 수백 km 짜리 덩어리라 고르는 의미가 없습니다.
 *
 * 그래서 버튼 하나가 축척에 따라 둘로 굽니다:
 *
 * ```
 *   고를 수 있는 축척   탭 → 한가운데로 이동   (십자선이 같이 뜸)
 *   넓은 축척           탭 → 메뉴             (한가운데가 뜻이 없으므로)
 *   꾹 누르기           어디서나 메뉴
 * ```
 *
 * ⚠ 이 규칙은 보기 좋으라고 만든 게 아닙니다. **숨은 롱프레스를 몰라도 메뉴를
 * 발견하게** 하고(줌을 빼고 한 번 누르면 나옵니다), 십자선이 같이 떠서 **어디로
 * 갈지 보고 누르게** 합니다. 십자선 없이 "한가운데로" 를 누르면 장님 탭입니다.
 *
 * ## 문턱 40km 의 근거는 예보가 아니라 **지형**입니다
 *
 * 위치에 가장 민감한 자료가 지형입니다 — `fetchTerrainProfile` 이
 * **5 · 15 · 40km** 에서 표본합니다. 화면이 그보다 넓으면 중앙 한 점이 지형
 * 표본보다 거칠어져 고르는 뜻이 없어집니다. (예보 격자는 약 25km 로 더 굵어서
 * 그쪽을 기준 삼으면 지형을 잃습니다.)
 *
 * ⚠ **경도 도수가 아니라 km 입니다.** `longitudeDelta` 1° 는 적도에서 111km,
 * 위도 60°에서 56km 입니다. `cloudRadar` 에서 도수로 박았다가 걸린 것과 같은
 * 부류라 여기서는 처음부터 환산합니다.
 */

/** 지형 표본의 가장 바깥 고리(km). 이보다 넓은 화면에서는 안 고릅니다. */
export const PICK_MAX_VIEW_KM = 40;

/** 경도 1° 가 이 위도에서 몇 km 인가. */
export const kmPerLonDeg = (lat: number): number =>
  111.32 * Math.cos(lat * (Math.PI / 180));

/** 이 축척에서 한가운데를 집는 것이 뜻이 있는가. */
export const canPickLocation = (longitudeDeltaDeg: number, lat: number): boolean =>
  longitudeDeltaDeg * kmPerLonDeg(lat) <= PICK_MAX_VIEW_KM;

export type LocationTapAction = 'move' | 'menu';

/**
 * 📍 버튼을 **그냥 눌렀을 때** 무엇이 일어나야 하는가.
 *
 * 꾹 누르기는 축척과 무관하게 늘 메뉴이므로 여기서 다루지 않습니다.
 */
export const locationTapAction = (
  longitudeDeltaDeg: number, lat: number,
): LocationTapAction => (canPickLocation(longitudeDeltaDeg, lat) ? 'move' : 'menu');

/* ── 상단 줄 자리 ────────────────────────────────────────────────────
 *
 * 오른쪽 위에 버튼이 줄지어 있고(안내 · 투영 · 위치), 왼쪽 위에 태양 배지가
 * 있습니다. 배지에 너비 제한이 없어서 **작은 기기에서 부딪힙니다.**
 *
 * 실측(목업을 앱과 같은 치수로 그려 재니): 배지가 **213px**.
 *
 * ```
 *   폭 360px → 버튼 시작 242, 배지 끝 223   여유 19px   빠듯함
 *   폭 320px → 버튼 시작 202, 배지 끝 223   겹침 21px   부딪힘
 * ```
 */

/** 상단 버튼 한 변(px). `guideBtn` 과 같아야 합니다. */
export const TOP_BTN_SIZE = 32;
/** 버튼 사이 간격(px). 오른쪽에서 10 · 48 · 86 이므로 간격 6 입니다. */
export const TOP_BTN_GAP = 6;
/** 화면 가장자리 여백(px). */
export const TOP_EDGE = 10;
/** 배지와 버튼 줄 사이에 최소한 남겨 둘 틈(px). */
export const TOP_MIN_CLEARANCE = 8;

/** 버튼 `n` 개가 오른쪽에서 차지하는 폭(px). */
export const topButtonsWidth = (n: number): number =>
  n <= 0 ? 0 : TOP_EDGE + n * TOP_BTN_SIZE + (n - 1) * TOP_BTN_GAP;

/**
 * 태양 배지에 걸어야 하는 **최대 너비**(px).
 *
 * ⚠ 이 값을 안 걸면 작은 기기에서 배지가 버튼 밑으로 파고듭니다. 계산이
 * 아니라 잘라 내야 하는 이유는, 배지 내용(고도/방위·일출·일몰)이 값에 따라
 * 길어지기 때문입니다.
 */
export const solarBadgeMaxWidth = (screenWidth: number, buttonCount: number): number =>
  Math.max(
    80,
    screenWidth - topButtonsWidth(buttonCount) - TOP_EDGE - TOP_MIN_CLEARANCE,
  );

/* ── 왼쪽 아래 줄 ────────────────────────────────────────────────────
 *
 * ⚠ **여기에 제가 만든 겹침이 있었습니다.** 구름 읽기값을 `left:10, bottom:10`
 * 에 놓으면서, 범례가 이미 `left:10, bottom:8` 에 있는 걸 안 봤습니다. 둘이
 * 같은 자리라 읽기값이 범례를 덮었습니다.
 *
 * 고침은 자리를 조금 옮기는 게 아니라 **둘을 한 세로줄에 넣는 것**입니다.
 * 절대 좌표 두 개를 손으로 맞추면 한쪽 높이가 바뀔 때 또 부딪힙니다.
 *
 * 그 세로줄은 오른쪽 아래 극좌표 인셋과도 안 부딪혀야 합니다. 인셋 크기는
 * `SunAzimuthView` 가 **화면 폭**에서 정하고(compact: 화면 폭의 1/3, 96~132px),
 * 세로줄이 놓이는 곳은 **지도 몸통 폭**입니다 — 둘이 다른 값이라 둘 다 받습니다.
 */

/** 극좌표 인셋이 차지하는 폭(px) — `SunAzimuthView` compact + 테두리/여백. */
export const polarInsetWidth = (screenWidth: number): number =>
  Math.max(96, Math.min(132, screenWidth * 0.33)) + 10; // padding 4×2 + border 1×2

/**
 * 왼쪽 아래 세로줄(구름 읽기값 · 범례)에 걸어야 하는 **최대 너비**(px).
 *
 * 인셋이 떠 있을 때만 그만큼 물러섭니다 — 늘 물러서면 넓은 축척에서
 * 범례가 공연히 줄바꿈합니다.
 */
export const bottomLeftMaxWidth = (
  mapWidth: number, screenWidth: number, hasPolarInset: boolean,
): number => {
  const right = hasPolarInset
    ? polarInsetWidth(screenWidth) + TOP_EDGE + TOP_MIN_CLEARANCE
    : TOP_EDGE;
  return Math.max(120, mapWidth - TOP_EDGE - right);
};
