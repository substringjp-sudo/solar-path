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
  // 수심은 DEM 이 있는 데까지만 뜻이 있습니다. 밖은 0(모름)으로 둡니다.
  vDepthM = (uDemValid > 0.5 && dem_inside(gc) > 0.5)
    ? max(0.0, -dem_elevationAt(gc)) : 0.0;
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
export const SEA_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uSurfaceIrr;
uniform vec3  uWaterAlbedo;
uniform float uExposure;
varying float vDistM;
varying float vDepthM;

void main() {
  // 조도 × 알베도. 49절과 같은 식입니다.
  vec3 lit = uSurfaceIrr * uWaterAlbedo;
  gl_FragColor = vec4(lit * uExposure, 1.0);
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
      uExposure: { value: 1.0 },
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
