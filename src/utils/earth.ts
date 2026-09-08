/**
 * **지구 하나** — 반지름 상수의 유일한 자리.
 *
 * ## 왜 이 파일이 있나
 *
 * 이 저장소에는 `6371` 이 **열여덟 군데** 흩어져 있었습니다. 값이 같으니
 * 문제가 없어 보이지만, 이 상수는 **서로 맞아야만 뜻이 있는** 종류입니다.
 *
 * 44절에서 지면과 구름이 서로 다른 지평선을 쓰다가 0.79° 짜리 띠가
 * 벌어졌습니다. 48절에서는 지형각에 곡률이 빠져 15km·40km 바다가 산으로
 * 오인됐습니다. 둘 다 "같은 지구를 쓰지 않아서" 생긴 결함입니다.
 *
 * 그래서 값을 한 곳에 두고 전부 여기서 가져다 씁니다. 앞으로 굴절 보정
 * (유효 반지름 7/6 R) 을 넣게 되면 **여기 한 줄**만 바뀝니다 — 지금처럼
 * 흩어져 있으면 몇 군데는 반드시 빠집니다.
 *
 * ## 값
 *
 * 6371 km 는 IUGG 평균 반지름(R₁ = (2a + b)/3 = 6371.0088 km)입니다.
 * 적도 6378.137, 극 6356.752 사이라 어느 위도에서도 0.1% 안입니다.
 */

/** 지구 평균 반지름 (km). */
export const EARTH_RADIUS_KM = 6371;

/** 지구 평균 반지름 (m). */
export const EARTH_RADIUS_M = EARTH_RADIUS_KM * 1000;

/**
 * GLSL 에 박아 넣을 때 쓰는 float 리터럴.
 *
 * 셰이더 문자열 안에서도 상수가 갈라지지 않게 **보간해서** 씁니다:
 * `const float R = ${EARTH_RADIUS_KM_GLSL};`
 */
export const EARTH_RADIUS_KM_GLSL = `${EARTH_RADIUS_KM}.0`;
export const EARTH_RADIUS_M_GLSL = `${EARTH_RADIUS_M}.0`;

/**
 * 눈높이 `elevM` 에서 **바다 수평선**이 내려앉는 각 (도, 양수).
 *
 * `acos(R / (R + h))`. 30m 에서 0.176°, 100m 에서 0.32° 입니다. 지형선과 달리
 * 수평선은 완벽하게 평평하고 이 각도 하나로 정해집니다.
 */
export function seaHorizonDipDeg(elevM: number): number {
  const h = Math.max(0, elevM);
  return (Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + h)) * 180) / Math.PI;
}

/** 눈높이 `elevM` 에서 수평선까지의 지상 거리 (m). `sqrt(2Rh)`. */
export function seaHorizonDistM(elevM: number): number {
  return Math.sqrt(2 * EARTH_RADIUS_M * Math.max(0, elevM));
}

/**
 * 거리 `dM` 에서의 곡률 낙차 (m). `d² / 2R`.
 *
 * 5km 에서 2m, 40km 면 108m 입니다. 48절에서 이 항이 빠져 먼 바다가 산으로
 * 오인됐습니다.
 */
export function curvatureDropM(dM: number): number {
  return (dM * dM) / (2 * EARTH_RADIUS_M);
}
