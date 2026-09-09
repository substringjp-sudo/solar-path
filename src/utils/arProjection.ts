/**
 * AR 화면의 **방위각 ↔ 화소** 사상을 한 곳에 모읍니다.
 *
 * ## 왜 필요한가
 *
 * `SunCamera.tsx` 는 한 화면에서 방위각을 **두 규약**으로 그리고 있었습니다:
 *
 *  - 시뮬레이터 상자 — `camera.fov = currentFov`. three.js 의 `fov` 는
 *    **세로** 화각이므로, 상자 가로세로비 4:3 에서 가로 화각은
 *    `2·atan(tan(30°)·4/3) = 75.18°` 입니다. 그리고 원근 투영이라 화소는
 *    각이 아니라 **탄젠트**에 비례합니다.
 *  - 나침반 눈금자 — `pxPerDeg = (BOX_WIDTH - 24) / 70`. **70° 상수**를
 *    선형으로 폈고, `currentFov` 를 아예 안 봤습니다.
 *
 * 재 보면(`build-ar-azimuth.js`) 눈금자가 가리키는 각과 그 화소에 실제로
 * 그려진 각이 이만큼 다릅니다:
 *
 *   배율 1배 — 어긋남 20° 자리에서 **2.68°**, ±35° 구간 내내 1~2.7°
 *   배율 2배 — 20° 자리에서 **−8.2°**
 *   배율 5배 — 5° 자리에서 이미 **−3.8°**, 20° 자리에서 −15.2°
 *
 * 배율이 커질수록 벌어지는 이유는 눈금자가 줌을 아예 안 보기 때문입니다.
 *
 * 두 곳이 각자 계산하는 한 언제든 다시 갈라집니다. 그래서 사상을 **함수
 * 하나**로 모으고, 하네스가 렌더된 화소와 이 함수를 직접 견줍니다.
 *
 * ⚠ 여기서 다루는 것은 **화면 안쪽 규약**뿐입니다. 실제 카메라의 화각이
 * 몇 도인지는 이 파일이 모릅니다 — `SunCamera.tsx` 의 `BASE_CAMERA_FOV_DEG`
 * 주석을 보십시오.
 */

/** 세로 화각과 가로세로비(가로/세로)에서 가로 화각을 냅니다. 단위는 도. */
export function horizontalFovDeg(verticalFovDeg: number, aspect: number): number {
  const halfV = (verticalFovDeg * Math.PI) / 180 / 2;
  return (2 * Math.atan(Math.tan(halfV) * aspect) * 180) / Math.PI;
}

/**
 * 화면 중앙에서 `offsetDeg` 만큼 벗어난 방위가 놓이는 화소 x (중앙 기준 상대).
 *
 * 원근 투영이므로 **선형이 아닙니다** — `x ∝ tan θ`. 화각의 절반을 넘어서면
 * 화면 밖이므로 `null` 을 돌립니다(발산하는 값을 그리지 않게).
 */
export function azimuthOffsetToPx(
  offsetDeg: number,
  widthPx: number,
  horizontalFov: number,
): number | null {
  const halfH = (horizontalFov * Math.PI) / 180 / 2;
  const t = (offsetDeg * Math.PI) / 180;
  // 90° 를 넘으면 탄젠트가 뒤집혀 반대편에 그려집니다 — 먼저 막습니다.
  if (Math.abs(offsetDeg) >= 90) return null;
  const x = (widthPx / 2) * (Math.tan(t) / Math.tan(halfH));
  if (Math.abs(x) > widthPx / 2) return null;
  return x;
}

/** 위의 역 — 화소 x(중앙 기준 상대)가 뜻하는 방위 어긋남(도). */
export function pxToAzimuthOffset(
  px: number,
  widthPx: number,
  horizontalFov: number,
): number {
  const halfH = (horizontalFov * Math.PI) / 180 / 2;
  return (Math.atan((px / (widthPx / 2)) * Math.tan(halfH)) * 180) / Math.PI;
}
