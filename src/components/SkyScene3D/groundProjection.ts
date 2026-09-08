/**
 * **지면과 해수면이 함께 쓰는 하나의 투영** (docs/COASTLINE_PLAN.md 2·4단계).
 *
 * 해안선을 "그리지 말고 만나게" 하려면 땅과 물이 **같은 자로 재야** 합니다.
 * 44절에서 지면과 구름이 서로 다른 지평선을 쓰다가 0.79° 짜리 띠가 벌어진
 * 적이 있습니다. 그래서 투영을 여기 한 곳에 두고 양쪽이 import 합니다 —
 * 복사해 두면 언젠가 반드시 갈라집니다.
 *
 * ## 왜 각도인가
 *
 * 이 씬은 반경 500 돔에 **각도**로 그립니다(구름·능선 띠·나침반·천체가 전부
 * 그 규약 위). 미터 좌표계를 들이면 3km 지점이 돔 밖으로 나가 깊이 순서가
 * 통째로 깨집니다. 그래서 정점을 **실제로 보이는 고도각**에 놓습니다.
 *
 * ## 반경은 깊이 순서만 나릅니다
 *
 * 반경을 거리의 **단조 증가** 함수로 두면, 카메라가 메시 원점에 있으므로
 * 깊이 = 반경이고 "가까운 것이 항상 앞"이 공짜로 성립합니다. 땅과 물이 같은
 * 반경 함수를 쓰면 둘 사이의 가림도 저절로 맞습니다:
 *
 * - 물 위의 땅은 같은 거리에서 각이 더 높고, 그 각을 갖는 바다는 **더 먼**
 *   곳이라 반경이 큽니다 → 땅이 이깁니다. 육지가 뒤의 바다를 가립니다. ✓
 * - 물 아래의 땅은 각이 더 낮고, 그 각을 갖는 바다는 **더 가까운** 곳이라
 *   반경이 작습니다 → 바다가 이깁니다. 물이 수중 지형을 덮습니다. ✓
 *
 * 즉 해안선은 **두 면이 실제로 만나는 자리**이고, 마스크가 아닙니다.
 */
import * as THREE from 'three';
import { EARTH_RADIUS_M, EARTH_RADIUS_M_GLSL, seaHorizonDipDeg, seaHorizonDistM } from '../../utils/earth';

/** 지구는 `utils/earth.ts` 한 곳에서만 정의합니다. 여기서는 재수출만 합니다. */
export { EARTH_RADIUS_M, seaHorizonDipDeg, seaHorizonDistM };

/**
 * 격자의 **발밑** 거리 (m).
 *
 * ⚠ 여기를 12m 로 뒀다가 발밑에 각도 구멍이 났습니다. 눈높이 2.77m 에서
 * 12m 앞 지면은 −6.3° 이고, **그보다 아래는 지면이 아예 없었습니다.**
 * 그 구멍을 (더 낮은 각까지 뻗는) 해수면이 메워서, 물가에 선 관측자가
 * 발밑에 물을 밟고 선 것처럼 그려졌습니다.
 *
 * 0.6m 면 눈높이 1.6m 에서 −69° 까지 내려갑니다.
 */
export const FIELD_FOOT_M = 0.6;

/**
 * **경첩 거리.** 안쪽은 각도만 채우면 되므로 성기게, 바깥쪽은 실루엣이
 * 걸리므로 촘촘하게 나눕니다. 한 구간으로 로그 간격을 주면 발밑까지
 * 덮으려다 먼 쪽 해상도를 같이 잃습니다 (Δd/d 4.3% → 6.9%).
 */
export const FIELD_HINGE_M = 12;

/** 경첩 안쪽에 배정하는 고리 수. 발밑은 고리당 1~2° 면 충분합니다. */
export const FIELD_INNER_RINGS = 24;

/** 지면 격자 바깥 거리 (m). DEM 패치 반경과 맞춥니다. */
export const FIELD_FAR_M = 3000;

/** 이전 이름 — 경첩 거리와 같습니다. */
export const FIELD_NEAR_M = FIELD_HINGE_M;

/** 깊이 순서용 반경. 스카이돔(500)·능선 띠(480) 안쪽에 둡니다. */
export const RADIUS_NEAR = 120;
export const RADIUS_FAR = 470;

/**
 * 반경 매핑의 기준 거리.
 *
 * ⚠ 땅과 물이 **같은 기준**을 써야 위의 가림 논리가 성립합니다. 바다가
 * 지면보다 훨씬 멀리 뻗으므로 기준은 **바다 쪽 범위**로 잡습니다.
 */
export const RADIUS_REF_NEAR_M = FIELD_FOOT_M;
export const RADIUS_REF_FAR_M = 30000;

/** 한 구간 로그 간격. Δd/d 가 일정합니다. */
const logStep = (k: number, n: number, a: number, b: number): number =>
  a * Math.pow(b / a, n <= 1 ? 0 : k / (n - 1));

/**
 * 고리 k 의 지상 거리 (m) — **두 구간** 로그 간격.
 *
 * 안쪽 `FIELD_INNER_RINGS` 개가 발밑(`FIELD_FOOT_M`)에서 경첩까지, 나머지가
 * 경첩에서 `farM` 까지입니다. 발밑 구멍을 막으면서 먼 쪽 Δd/d 를 안 잃습니다.
 */
export function ringDistanceM(
  k: number,
  rings: number,
  farM: number,
  nearM: number = FIELD_FOOT_M,
): number {
  // ⚠ 발밑에서 시작하지 **않는** 격자(먼 지형 3km~)는 두 구간이 필요
  // 없습니다. 발밑 구멍이 없으니 한 구간 로그로 균일하게 나눕니다.
  if (nearM > FIELD_HINGE_M) return logStep(k, rings, nearM, farM);
  const inner = Math.min(FIELD_INNER_RINGS, Math.max(0, rings - 2));
  if (k < inner) return logStep(k, inner + 1, nearM, FIELD_HINGE_M);
  return logStep(k - inner, rings - inner, FIELD_HINGE_M, farM);
}

/** 그 거리에 주는 씬 반경 — **깊이 순서 전용**, d 에 단조 증가. */
export function ringRadius(distM: number): number {
  const t =
    Math.log(Math.max(distM, RADIUS_REF_NEAR_M) / RADIUS_REF_NEAR_M) /
    Math.log(RADIUS_REF_FAR_M / RADIUS_REF_NEAR_M);
  return RADIUS_NEAR + (RADIUS_FAR - RADIUS_NEAR) * Math.min(1, Math.max(0, t));
}

/**
 * 동심원 격자.
 *
 * `position.xz` 에 **지상 좌표(동, 남) m**, `position.y` 에 깊이 순서용 반경을
 * 담습니다. 버텍스 셰이더가 이 셋으로 실제 자리를 계산합니다.
 */
export function createConcentricGeometry(
  rings: number,
  spokes: number,
  farM: number,
  nearM: number = FIELD_FOOT_M,
): THREE.BufferGeometry {
  const count = rings * spokes;
  const pos = new Float32Array(count * 3);
  for (let k = 0; k < rings; k++) {
    const d = ringDistanceM(k, rings, farM, nearM);
    const r = ringRadius(d);
    for (let j = 0; j < spokes; j++) {
      const az = (j / spokes) * Math.PI * 2; // 북에서 시계방향
      // 씬 규약: +x = 동, **−z = 북** — 그러므로 남 = −cos(az).
      // ⚠ 부호를 빠뜨리면 격자 자체는 (한 바퀴를 반대로 돌 뿐이라) 멀쩡해
      //   보이지만, 같은 실수를 참조 쪽에서 하면 방위가 180° − A 로
      //   거울상이 됩니다. 2단계에서 실루엣 중앙오차 1.34° 로 나왔습니다.
      const i = (k * spokes + j) * 3;
      pos[i] = Math.sin(az) * d;
      pos[i + 1] = r;
      pos[i + 2] = -Math.cos(az) * d;
    }
  }

  const idx = new Uint32Array((rings - 1) * spokes * 6);
  let o = 0;
  for (let k = 0; k < rings - 1; k++) {
    for (let j = 0; j < spokes; j++) {
      const j1 = (j + 1) % spokes;
      const a = k * spokes + j;
      const b = k * spokes + j1;
      const c = (k + 1) * spokes + j;
      const dI = (k + 1) * spokes + j1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = dI;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // 정점을 셰이더가 옮기므로 자동 바운딩은 뜻이 없습니다.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), RADIUS_FAR * 2);
  return g;
}

/**
 * 땅과 물이 **함께 쓰는** 투영 GLSL.
 *
 * ⚠ 한쪽만 고치면 그 순간 해안선이 교선이 아니게 됩니다.
 */
export const GROUND_PROJECT_GLSL = /* glsl */ `
const float GP_R_EARTH = ${EARTH_RADIUS_M_GLSL};

/** 지구 곡률 낙차 (m). 5km 에서 2m, 40km 면 108m 입니다. */
float gp_drop(float d) { return (d * d) / (2.0 * GP_R_EARTH); }

/** 그 거리·고도가 눈에 보이는 각 (rad). */
float gp_elevAngle(float d, float h, float eyeM) {
  return atan(h - eyeM - gp_drop(d), d);
}

/**
 * 지상 좌표 g(동, 남) · 고도 h · 눈높이 eyeM · 깊이순서 반경 radius
 * → 씬 좌표.
 */
vec3 gp_project(vec2 g, float h, float eyeM, float radius) {
  float d = max(length(g), 0.001);
  float e = gp_elevAngle(d, h, eyeM);
  vec3 dir = vec3(g.x, 0.0, g.y) / d;
  float c = cos(e);
  return vec3(dir.x * c * radius, sin(e) * radius, dir.z * c * radius);
}
`;
