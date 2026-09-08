/**
 * **해수면 — 따로 있는 면** (docs/COASTLINE_PLAN.md 4단계).
 *
 * 해안선을 마스크로 그리는 대신, 물을 **진짜 면**으로 두고 땅과 만나게
 * 합니다. 그러면 만·곶·섬이 따로 손대지 않아도 제 모양으로 나옵니다.
 * 방위 해상도 12° 라는 한계 자체가 사라집니다 — 30m 격자가 정하니까요.
 *
 * ## 땅과 **같은 투영**을 씁니다
 *
 * `groundProjection.ts` 의 `gp_project` 하나를 양쪽이 씁니다. 44절에서 지면과
 * 구름이 서로 다른 지평선을 쓰다가 0.79° 짜리 띠가 벌어진 적이 있습니다.
 * 눈높이도 **DEM 이 정한 같은 값**을 씁니다 — 어긋나면 해안선이 교선이
 * 아니게 됩니다.
 *
 * ## 왜 지면 격자보다 훨씬 멀리 가는가
 *
 * 지면 격자는 3km 에서 끝나는데, 눈높이 43.6m 의 진짜 수평선은 **23.6km**
 * 밖입니다. 2단계 판정에서 그 사이 **0.634°** 가 안 덮이는 것을 쟀습니다.
 * 바다가 그 자리를 이어받아야 물 위에 하늘이 새지 않습니다.
 *
 * ## 수평선 너머는 접습니다
 *
 * 구면에서 눈높이 h 의 수평선 거리는 `sqrt(2Rh)` 이고, 그 지점의 고도각이
 * 정확히 `−dip` 입니다. 그보다 먼 바다는 **안 보입니다.** 포물선 근사를
 * 그대로 두면 각이 다시 내려가 면이 접히므로, 거리를 수평선 거리로
 * 잘라 정점을 수평선 위에 모읍니다.
 */
import * as THREE from 'three';
import { DEM_GLSL, makeDemUniforms, type DemPatch } from '../../utils/demTiles';
import {
  GROUND_PROJECT_GLSL, createConcentricGeometry, seaHorizonDistM,
} from './groundProjection';
import {
  ATMOSPHERE_GLSL, GROUND_DISPLAY_GLSL, makeTuningUniforms,
} from '../../utils/atmosphere';

/**
 * 바다 격자가 뻗는 거리 (m).
 *
 * 눈높이 1.6m 면 수평선이 4.5km, 100m 산이면 35.7km 입니다. 셰이더가 실제
 * 수평선 거리로 자르므로 여기는 **넉넉하게** 잡으면 됩니다.
 */
export const SEA_FAR_M = 60000;

export const SEA_RINGS = 96;
export const SEA_SPOKES = 256;

export const SEA_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
${GROUND_PROJECT_GLSL}
uniform float uObsElevM;
uniform float uEyeHeightM;
varying float vDistM;
varying float vDepthM;   // 수심 (m) — 물가 표현의 재료 (5단계)
varying vec3  vGround;

/** ⚠ TerrainField 의 groundAtEye 와 **같은 식**이어야 합니다. */
float groundAtEye() {
  return uDemValid > 0.5 ? dem_elevationAt(vec2(0.0)) : uObsElevM;
}

void main() {
  vec2  g = vec2(position.x, position.z);
  float r = position.y;
  float eye = groundAtEye() + uEyeHeightM;

  // 수평선 너머는 안 보입니다 — 거리를 잘라 정점을 수평선에 모읍니다.
  float dHor = sqrt(2.0 * GP_R_EARTH * max(eye, 0.01));
  float d = length(g);
  vec2 gc = d > dHor ? g * (dHor / max(d, 1e-4)) : g;

  vDistM = min(d, dHor);

  // ── 수심 ────────────────────────────────────────────────────────────────
  // ⚠ 여기에 함정이 둘 있고 **둘 다 "0 을 0m 로 믿는 것"** 입니다.
  //
  //  ① 패치 **밖**을 0 으로 두면 수심 0m, 즉 온 바다가 물가가 되어 포말이
  //     수평선까지 깔립니다.
  //  ② 패치 **안**이라도 Terrarium 은 **먼바다를 정확히 0 으로 자릅니다**
  //     (조사 때 표본 1024개 중 406개가 정확히 0). 그걸 0m 로 믿으면 바닥이
  //     그대로 다 비치고 포말이 1 이 되어, 만 전체가 밝은 모래펄로 그려집니다.
  //
  // 그래서 **모르는 곳은 깊다**고 둡니다. 쌍선형 보간 덕에 물가 근처는 0 이
  // 아닌 작은 값이 나오므로, 정확히 0 인 곳만 "자료 없음"으로 갈립니다.
  float hs = dem_elevationAt(gc);
  bool known = uDemValid > 0.5 && dem_inside(gc) > 0.5 && hs < 0.0;
  vDepthM = known ? -hs : 999.0;
  vGround = vec3(gc.x, 0.0, gc.y);

  // 해수면 고도는 0 — 정의상 이것이 기준면입니다.
  vec3 p = gp_project(gc, 0.0, eye, r);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * 4단계의 판정은 **해안선이 교선인가** 입니다. 그래서 칠은 물과 뭍이
 * 확실히 갈리게만 둡니다 — 49절에서 물리로 되돌린 물빛(조도 × 알베도,
 * 진짜 프레넬, Cox-Munk 윤슬)은 5단계에서 이 위에 얹힙니다.
 */
/**
 * 물빛 — **수심 하나**에서 물가가 전부 따라옵니다 (5단계).
 *
 * 49절에서 물빛을 조도 × 알베도로 되돌렸습니다. 여기에 수심이 붙으면
 * 계획서의 표가 그대로 나옵니다:
 *
 * | 보이는 것 | 수심에서 |
 * |---|---|
 * | 얕은 물의 청록 | 흡수 `exp(−k·2d)` — 붉은빛이 먼저 먹힙니다 |
 * | 바닥이 비침 | 같은 투과율로 바닥 알베도가 올라옵니다 |
 * | 물가 포말 띠 | 수심 < `uFoamDepthM` |
 * | **포말 폭이 지형마다 다름** | 거리가 아니라 **수심**으로 재니 저절로 |
 *
 * 마지막 줄이 핵심입니다. 완만한 모래밭은 얕은 구간이 길어 띠가 넓고,
 * 절벽은 바로 깊어져 띠가 좁습니다. 폭을 거리로 재면 이게 안 나옵니다.
 *
 * 흡수계수는 청정 해수의 실측 근사입니다 (1/m):
 * 빨강 0.45 · 초록 0.09 · 파랑 0.035. 붉은빛이 몇 m 안에 사라지고 청록만
 * 남는다는 사실이 그대로 들어갑니다.
 */
export const SEA_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}
uniform vec3  uSurfaceIrr;
uniform vec3  uWaterAlbedo;
uniform vec3  uBedAlbedo;     // 바닥(모래·펄) 알베도
uniform float uFoamDepthM;
uniform float uExposure;
uniform float uSaturation;
uniform float uSunAltDeg;
uniform vec3  uHazeRadiance;
uniform float uAerial;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
varying float vDistM;
varying float vDepthM;

/** 청정 해수 흡수계수 (1/m). 붉은빛이 먼저 먹힙니다. */
const vec3 SEA_ABSORB = vec3(0.45, 0.09, 0.035);

void main() {
  // 왕복 경로라 수심의 두 배를 지납니다.
  vec3 thru = exp(-SEA_ABSORB * 2.0 * clamp(vDepthM, 0.0, 40.0));

  // 수체가 되돌리는 몫 + 바닥이 비치는 몫. 둘 다 조도 × 알베도입니다.
  vec3 col = uSurfaceIrr * (uWaterAlbedo + uBedAlbedo * thru);

  // 포말 — 수심으로 재므로 폭이 지형 경사를 따릅니다.
  float foam = 1.0 - smoothstep(0.0, max(0.02, uFoamDepthM), vDepthM);
  col = mix(col, uSurfaceIrr * vec3(0.70, 0.71, 0.72), foam);

  if (uAerial > 0.5) {
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0,
                                     uBeta, uAngstrom, uElevScale);
    col = col * T + uHazeRadiance * (1.0 - T);
  }

  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg), 1.0);
}
`;

export interface SeaPlaneHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  setPatch: (patch: DemPatch | null) => void;
  dispose: () => void;
}

export function createSeaPlane(opts: {
  patch?: DemPatch | null;
  observerElevM?: number;
  eyeHeightM?: number;
  waterAlbedo?: { r: number; g: number; b: number };
  rings?: number;
  spokes?: number;
} = {}): SeaPlaneHandle {
  const a = opts.waterAlbedo ?? { r: 0.005, g: 0.038, b: 0.055 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeDemUniforms(opts.patch ?? null),
      uObsElevM: { value: opts.observerElevM ?? 0 },
      uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
      uSurfaceIrr: { value: new THREE.Vector3(0.05, 0.06, 0.08) },
      uWaterAlbedo: { value: new THREE.Vector3(a.r, a.g, a.b) },
      // 서해안 갯벌·모래 바닥. 얕은 데서만 보입니다.
      uBedAlbedo: { value: new THREE.Vector3(0.26, 0.22, 0.17) },
      // 부서지는 자리 — 수심 0.5m 안쪽.
      uFoamDepthM: { value: 0.5 },
      uExposure: { value: 1.0 },
      uSaturation: { value: 1.0 },
      uSunAltDeg: { value: 30 },
      uHazeRadiance: { value: new THREE.Vector3(0.05, 0.06, 0.09) },
      uAerial: { value: 1.0 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      ...makeTuningUniforms(),
    },
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    // 해수면 고도(0)에서 땅과 정확히 겹칩니다 — 물가가 반짝이지 않게
    // 바다를 아주 살짝 뒤로 밉니다. 땅의 가장자리가 해안선입니다.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const mesh = new THREE.Mesh(
    createConcentricGeometry(
      opts.rings ?? SEA_RINGS, opts.spokes ?? SEA_SPOKES, SEA_FAR_M),
    material,
  );
  mesh.name = 'seaPlane';
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    setPatch: (patch) => {
      const u = makeDemUniforms(patch);
      Object.entries(u).forEach(([k, v]) => {
        if (material.uniforms[k]) material.uniforms[k].value = v.value;
      });
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/** 지면 격자와 **같이** 눈에 맞춥니다. 하나만 옮기면 교선이 어긋납니다. */
export function updateSeaPlaneEye(handle: SeaPlaneHandle, camera: THREE.Camera): void {
  handle.mesh.position.copy(camera.position);
}

/** 눈높이에서 수평선까지의 지상 거리 (m) — 판정이 같이 씁니다. */
export { seaHorizonDistM };
