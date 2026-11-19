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
 * 표준 대기 굴절 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 6.1).
 *
 * 땅 가까운 빛은 공기 밀도가 아래로 갈수록 커서 땅 쪽으로 휩니다. 휘는 정도는 지구 곡률의 k 배(표준 k ≈ 1/7)라서,
 * 땅 위 시선은 **반지름이 R / (1 − k) = 7/6 R 인 지구**를 본 것과 같습니다. 곡률 낙차 d²/2R 이 6/7 로 줄고,
 * 먼 산·섬이 조금 떠 보이며 수평선이 조금 멀어집니다. 50 km 밖이면 낙차 196 m 가 168 m 로 28 m 줄어듭니다.
 *
 * **땅 위 시선에만** 씁니다(지형·건물·해수면 메시, 지형각, 수평선 내림각). 높은 하늘의 구름·대기 산란은 실제 지구를 그대로 씁니다.
 * 이 값은 날씨(기온 단면)에 따라 달라지지만 표준 값으로 둡니다. 날씨에 따른 정밀 굴절은 따로 옵션으로 둘 계획입니다.
 */
export const REFRACTION_K = 1 / 7;

/** 땅 위 시선의 유효 지구 반지름 (m) = 7/6 R. 곡률 낙차·수평선·지형각이 모두 이 값을 씁니다. */
export const EARTH_RADIUS_EFFECTIVE_M = EARTH_RADIUS_M / (1 - REFRACTION_K);

/** 저장한 지형각이 어느 곡률 모델로 계산됐는지 표시. 다르면 저장 자료를 버리고 다시 받습니다. */
export const TERRAIN_CURVATURE_MODEL = 'refr-k1/7';

/**
 * GLSL 에 박아 넣을 때 쓰는 float 리터럴.
 *
 * 셰이더 문자열 안에서도 상수가 갈라지지 않게 **보간해서** 씁니다:
 * `const float R = ${EARTH_RADIUS_KM_GLSL};`
 */
export const EARTH_RADIUS_KM_GLSL = `${EARTH_RADIUS_KM}.0`;
export const EARTH_RADIUS_M_GLSL = `${EARTH_RADIUS_M}.0`;
/** 땅 위 시선용(굴절 포함) 유효 반지름의 GLSL 리터럴. */
export const EARTH_RADIUS_EFFECTIVE_M_GLSL = EARTH_RADIUS_EFFECTIVE_M.toFixed(1);

/**
 * 눈높이 `elevM` 에서 **바다 수평선**이 내려앉는 각 (도, 양수).
 *
 * `acos(R′ / (R′ + h))`, R′ = 유효 반지름(굴절 포함). 30m 에서 0.163°, 100m 에서 0.30° 입니다(굴절 없이는 0.176°, 0.32°).
 * 지형선과 달리 수평선은 완벽하게 평평하고 이 각도 하나로 정해집니다.
 */
export function seaHorizonDipDeg(elevM: number): number {
  const h = Math.max(0, elevM);
  return (Math.acos(EARTH_RADIUS_EFFECTIVE_M / (EARTH_RADIUS_EFFECTIVE_M + h)) * 180) / Math.PI;
}

/** 눈높이 `elevM` 에서 수평선까지의 지상 거리 (m). `sqrt(2R′h)`, 굴절 포함. */
export function seaHorizonDistM(elevM: number): number {
  return Math.sqrt(2 * EARTH_RADIUS_EFFECTIVE_M * Math.max(0, elevM));
}

/**
 * 거리 `dM` 에서의 곡률 낙차 (m). `d² / 2R′`, 굴절 포함.
 *
 * 5km 에서 1.7m, 40km 면 108m 입니다(굴절 없이는 2.0m, 126m). 48절에서 이 항이 빠져 먼 바다가 산으로
 * 오인됐습니다.
 */
export function curvatureDropM(dM: number): number {
  return (dM * dM) / (2 * EARTH_RADIUS_EFFECTIVE_M);
}
