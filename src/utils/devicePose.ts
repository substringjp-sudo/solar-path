/**
 * 기기 자세에서 **카메라가 어디를 보는가**와 **나침반 값을 어떻게 읽어야 하는가**
 * 를 갈라 내는 순수 모듈.
 *
 * ## 고치는 결함
 *
 * `Location.watchHeadingAsync` 가 주는 `magHeading`/`trueHeading` 은
 * Android `SensorManager.getOrientation(...)[0]` 을 **그대로** 넘긴 값입니다
 * (`expo-location/LocationModule.kt`: `magHeading = calcMagNorth(orientation[0])`,
 * `remapCoordinateSystem` 없음). 그것은 **기기 상단 모서리(+Y축)의 방위**이지
 * 카메라가 보는 방위가 아닙니다.
 *
 * 폰을 수직보다 더 젖혀 **카메라가 지평선 위를 보면** 상단 모서리는 뒤로 넘어가
 * 수평 성분의 부호가 뒤집힙니다. 곧 나침반 값이 **180° 뒤집힙니다.**
 * 자이로 쪽(카메라 전방 벡터)은 안 뒤집힙니다.
 *
 * 실제로 잰 것 (방위 90°=동 을 겨눈 채 폰을 젖혀 감):
 *
 * | 카메라 앙각 | 자이로 방위 | 나침반 방위 |
 * |---|---|---|
 * | −1° (지평선 아래) | 90.0° | 90.0° |
 * | **+1° (지평선 위)** | **90.0°** | **270.0°** |
 *
 * 융합은 이 둘을 같은 것으로 알고 섞으므로, 하늘을 겨누는 순간부터 오프셋이
 * 뒤집힌 값 쪽으로 끌려갑니다. 눕혀 놓으면(앙각 −90°) 안 뒤집히니 맞고,
 * 세우면 틀리며, 끌리는 방향이 늘 같으니 "거의 항상" 같은 쪽으로 틀립니다.
 *
 * ## 두 번째 결함 — 세우면 나침반 자체가 특이점입니다
 *
 * 상단 모서리의 수평 성분 길이는 `|cos β|` 입니다. 폰을 정확히 세우면 그 길이가
 * 0 이 되어 **나침반 방위가 정의되지 않습니다**(0/0). 그 근처 값은 잡음입니다.
 * 그래서 짧으면 아예 안 씁니다.
 */

/** 기기 자세에서 뽑아낸, 방위 판단에 필요한 것들. */
export interface DevicePose {
  /** 카메라 전방(−Z)의 방위 (도, 북=0, 시계방향). */
  camAzDeg: number;
  /** 카메라 전방의 **수평 길이** (0~1). 짧으면 방위가 무의미합니다. */
  camHoriz: number;
  /** 카메라 전방의 앙각 (도). */
  camElevDeg: number;
  /** 기기 상단 모서리(+Y)의 방위 (도) — 나침반이 말하는 것이 이것입니다. */
  topAzDeg: number;
  /** 상단 모서리의 **수평 길이** = `|cos β|`. 짧으면 나침반이 특이점입니다. */
  topHoriz: number;
}

const R2D = 180 / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * W3C 회전각(라디안)에서 자세를 뽑습니다. `R = Rz(α)Rx(β)Ry(γ)`, 월드축은
 * X=동 Y=북 Z=상이며 열이 기기축입니다.
 *
 * ⚠ expo 가 돌려주는 (α,β,γ) 는 Android `getOrientation` 이 pitch 를 ±90°로
 * 가둔 탓에 참값과 다른 가지를 고를 수 있습니다(참 β=95° → expo β=85°,
 * γ=−180°). 그래도 **행렬은 같은 행렬로 복원됩니다** — 왕복 오차 0.0°로
 * 확인했습니다. 그래서 여기서는 그대로 써도 됩니다.
 */
export function poseFromRotation(alphaRad: number, betaRad: number, gammaRad: number): DevicePose {
  const sa = Math.sin(alphaRad), ca = Math.cos(alphaRad);
  const sb = Math.sin(betaRad), cb = Math.cos(betaRad);
  const sg = Math.sin(gammaRad), cg = Math.cos(gammaRad);

  // 카메라 전방 = −(3번째 열)
  const fx = -(ca * sg + sa * sb * cg);
  const fy = -(sa * sg - ca * sb * cg);
  const fz = -(cb * cg);

  // 기기 상단(+Y) = 2번째 열
  const ux = -sa * cb;
  const uy = ca * cb;

  const camHoriz = Math.hypot(fx, fy);
  return {
    camAzDeg: norm360(Math.atan2(fx, fy) * R2D),
    camHoriz,
    camElevDeg: Math.atan2(fz, camHoriz) * R2D,
    topAzDeg: norm360(Math.atan2(ux, uy) * R2D),
    topHoriz: Math.hypot(ux, uy),
  };
}

/**
 * 나침반이 상단 모서리 기준으로 준 방위를 **카메라 기준**으로 옮깁니다.
 *
 * 자세 행렬이 두 방위의 차이를 알려 주므로 그만큼 더합니다. 기울기(roll)가
 * 있어도 맞습니다 — 차이를 상수로 박지 않고 매번 자세에서 꺼내기 때문입니다.
 *
 * @returns 카메라 기준 방위(도). 나침반이 특이점이면 `null`.
 */
export function compassToCameraHeading(
  compassHeadingDeg: number,
  pose: DevicePose,
  minTopHoriz = 0.20,
): number | null {
  if (!Number.isFinite(compassHeadingDeg)) return null;
  // 상단 모서리가 거의 수직(폰을 정확히 세움)이면 나침반 값이 잡음입니다.
  if (pose.topHoriz < minTopHoriz) return null;
  // 카메라 전방이 거의 수직(천정·바닥)이면 옮겨 봐야 쓸 데가 없습니다.
  if (pose.camHoriz < 0.05) return null;
  return norm360(compassHeadingDeg + (pose.camAzDeg - pose.topAzDeg));
}
