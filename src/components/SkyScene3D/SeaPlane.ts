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
// 눈(메시 원점)에서 이 점으로 가는 단위 방향. 하늘 되비침의 거울 방향을
// 여기서 뒤집어 씁니다 (프래그먼트 셰이더 주석 참고).
varying vec3  vViewDir;

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
  // ⚠ 눈은 메시 원점(로컬 좌표계 원점)에 있습니다 — p 자체가 이미 "눈에서
  //   이 점으로"인 방향이라, normalize(p) 가 바로 시선 방향입니다. 카메라의
  //   실제 world Y(구 화면단위 dip 트릭 값)를 여기서 다시 읽으면 안
  //   됩니다 — 그러면 물리 눈높이(uEyeHeightM, 미터)와 화면단위 트릭이
  //   섞여 이중으로 셉니다.
  vViewDir = normalize(p);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * 물빛 — **수심**과 **프레넬**에서 물가가 전부 따라옵니다 (5단계 + 3단계 연결).
 *
 * 49절에서 물빛을 조도 × 알베도로, 진짜 프레넬로 되돌렸습니다. 그때 고친
 * 로직(`TerrainRing.ts` 의 물 갈래)이 이 씬에는 아직 없었으므로, 여기서
 * **그 물리를 그대로 옮겨** 옵니다 — 옮기지 않으면 새 지형에 씬을 연결하는
 * 순간 노을에 하늘을 비추던 물이 다시 상수색 평면으로 되돌아갑니다.
 *
 * | 보이는 것 | 수심/각도에서 |
 * |---|---|
 * | 얕은 물의 청록 | 흡수 `exp(−k·2d)` — 붉은빛이 먼저 먹힙니다 |
 * | 바닥이 비침 | 같은 투과율로 바닥 알베도가 올라옵니다 |
 * | 물가 포말 띠 | 수심 < `uFoamDepthM` — 거리가 아니라 수심으로 재므로 폭이 경사를 따릅니다 |
 * | **노을 하늘이 비침 · 발밑은 짙은 청록** | `waterFresnel(cosV)` — 스치는 각(지평선 쪽)일수록 하늘이 이깁니다 |
 *
 * ## 시선 방향은 `vViewDir` 하나로 풉니다
 *
 * 거울 방향은 시선을 평균면(법선 = 수직) 기준으로 뒤집은 것뿐입니다 —
 * `reflect(dir,(0,1,0)) = (dir.x, −dir.y, dir.z)`. `vViewDir` 는 이미
 * "눈에서 이 점으로"인 단위벡터(버텍스 셰이더의 `normalize(p)`)라 그대로
 * 씁니다. **카메라의 world Y 는 여기서 절대 다시 읽지 않습니다** — 그건
 * 화면단위 dip 트릭 값이라, 물리 눈높이(미터)와 섞이면 이중으로 셉니다.
 *
 * 파도 잔물결(Cox-Munk 윤슬)은 아직 안 옮겼습니다 — 이 메시는 아직 파도
 * 없는 평균면이라 미세면 분포를 걸 표면 법선이 없습니다. 다음에 파도를
 * 넣을 때 같이 옵니다.
 */
export const SEA_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}
uniform vec3  uSurfaceIrr;
uniform vec3  uSunRadiance;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform vec3  uWaterAlbedo;
uniform vec3  uBedAlbedo;     // 바닥(모래·펄) 알베도
uniform float uFoamDepthM;
uniform float uExposure;
uniform float uSaturation;
uniform float uSunAltDeg;
uniform vec3  uHazeRadiance;
uniform float uAerial;
uniform float uFresnel;       // 0 이면 하늘 되비침을 끕니다 (기하 판정용)
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;
varying float vDistM;
varying float vDepthM;
varying vec3  vViewDir;

/** 청정 해수 흡수계수 (1/m). 붉은빛이 먼저 먹힙니다. */
const vec3 SEA_ABSORB = vec3(0.45, 0.09, 0.035);

/** 프레넬 반사율 (Schlick, 물 n=1.33 → F0 = 0.02). TerrainRing.ts 와 같은 식. */
float waterFresnel(float cosTheta) {
  float f = pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
  return 0.02 + 0.98 * f;
}

void main() {
  // 왕복 경로라 수심의 두 배를 지납니다.
  vec3 thru = exp(-SEA_ABSORB * 2.0 * clamp(vDepthM, 0.0, 40.0));

  // 수체가 되돌리는 몫 + 바닥이 비치는 몫. 둘 다 조도 × 알베도입니다.
  vec3 body = uSurfaceIrr * (uWaterAlbedo + uBedAlbedo * thru);

  // ── 하늘 되비침 (프레넬) ─────────────────────────────────────────────────
  //
  // ⚠ uFresnel 로 끌 수 있습니다. 4단계 판정(verify-coastline.js)은
  // 화소를 R/B 우열로 땅/물을 가르는 **기하** 시험이라, 이 항을 켜 두면
  // 지평선 쪽 물이 하늘색(스치는 각 → Fv→1)으로 넘어가 파랑이 죽고 측정이
  // 무너집니다(다중 전환 측정이 986 → 821 로 떨어졌습니다). 색을 보는
  // 판정에서만 켭니다.
  vec3 col = body;
  if (uFresnel > 0.5) {
    vec3 dir = normalize(vViewDir);
    vec3 L = vec3(cos(uSunAltRad) * sin(uSunAzRad), sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
    // 평균면(법선 수직) 기준 거울 방향 — y 성분만 뒤집습니다.
    vec3 mirrorDir = vec3(dir.x, -dir.y, dir.z);
    float mirrorElevDeg = degrees(asin(clamp(mirrorDir.y, -1.0, 1.0)));
    float cosG = clamp(dot(mirrorDir, L), -1.0, 1.0);
    vec3 skyRefl = atm_skyRadiance(max(1.0, mirrorElevDeg), cosG, uSunAltDeg,
      max(0.001, uBeta), max(0.1, uAngstrom), max(0.1, uElevScale), max(50.0, uOzoneDU));
    // 바닥값은 가드이지 기여가 아닙니다 — 하늘 복사휘도가 이상할 때만
    // 검게 죽는 것을 막습니다 (49절: 상수를 깔면 태양 반대쪽 물이
    // 육지보다 밝아지는 결함이 났습니다).
    float sunWarmth = smoothstep(-2.0, 12.0, uSunAltDeg);
    vec3 skyFallback = uSurfaceIrr * 0.05 * mix(vec3(1.2, 0.8, 0.6), vec3(0.7, 0.95, 1.4), sunWarmth);
    skyRefl = clamp(max(skyFallback, skyRefl), vec3(0.0), vec3(12.0));

    // 반사와 수체의 몫은 프레넬이 정합니다 — 발밑(cosV↑)은 수체, 지평선
    // 쪽(cosV↓)은 하늘이 이깁니다. 그 대비가 물을 물로 보이게 합니다.
    float cosV = max(0.02, -dir.y);
    float Fv = waterFresnel(cosV);
    col = mix(body, skyRefl, Fv);
  }

  // 포말 — 수심으로 재므로 폭이 지형 경사를 따릅니다. 프레넬보다 위에 얹어
  // 거품은 반사와 무관하게 항상 보이게 합니다.
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
      uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uSunAzRad: { value: 0 },
      uSunAltRad: { value: 0.5 },
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
      uFresnel: { value: 1.0 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      uOzoneDU: { value: 330 },
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

/**
 * 지면 격자와 **같이** 눈에 맞춥니다. 하나만 옮기면 교선이 어긋납니다.
 *
 * ⚠ Y 는 0 으로 고정합니다 — `TerrainField.updateTerrainFieldEye` 와 같은
 * 이유입니다. 카메라의 `position.y` 는 이 씬에서 화면단위 dip 트릭 값이라
 * (실제 미터가 아님), 메시에 그대로 더하면 셰이더가 이미 미터로 계산한
 * 눈높이와 겹쳐 이중으로 셉니다.
 */
export function updateSeaPlaneEye(handle: SeaPlaneHandle, camera: THREE.Camera): void {
  handle.mesh.position.set(camera.position.x, 0, camera.position.z);
}

/** 눈높이에서 수평선까지의 지상 거리 (m) — 판정이 같이 씁니다. */
export { seaHorizonDistM };
