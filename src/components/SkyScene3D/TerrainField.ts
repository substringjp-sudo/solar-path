/**
 * **지형 높이장 메시** — 실루엣을 자료가 정하게 합니다 (docs/COASTLINE_PLAN.md 2단계).
 *
 * 1단계에서 진짜 높이장(`utils/demTiles.ts`)이 생겼습니다. 여기서 그걸
 * **기하**로 바꿉니다. 지금까지 지면은 평평한 원반이었고 능선은 31방위짜리
 * 빌보드 띠였습니다 — 방위 해상도가 12° 라 곶도 만도 섬도 못 그립니다.
 *
 * ## 왜 미터 평면이 아니라 **각도 격자**인가
 *
 * 이 씬은 반경 500 짜리 돔에 **각도**로 그립니다. 구름도 능선 띠도 나침반도
 * 천체도 전부 그 규약 위에 있습니다. 여기에만 미터 좌표계를 들이면 3km 지점이
 * 돔(500) 밖으로 나가 깊이 순서가 통째로 깨집니다.
 *
 * 그래서 격자를 **시선 구면 위**에 놓습니다. 지상 거리 d, 고도 h 인 점은
 *
 *     낙차   = d² / 2R          (지구 곡률)
 *     고도각 = atan2(h − 눈높이 − 낙차, d)
 *
 * 로 **실제로 보이는 각도**에 놓입니다. 눈높이가 식 안에 들어가므로 관측
 * 고도도 여기서 자동으로 반영됩니다.
 *
 * ## 가림(occlusion)은 반경이 정합니다
 *
 * 모든 정점을 같은 반경에 놓으면 가까운 능선과 먼 산이 같은 깊이라 z-fighting
 * 이 납니다. 대신 반경을 **거리의 단조 증가 함수**로 둡니다. 카메라가 메시
 * 원점에 있으므로 깊이 = 반경이고, 따라서
 *
 *     가까운 것이 항상 앞  ⇔  d 가 작으면 R 도 작다
 *
 * 가 공짜로 성립합니다. 반경은 오직 **깊이 순서**만 나르고, 보이는 자리는
 * 전부 위의 고도각이 정합니다.
 *
 * ⚠ 그래서 이 메시는 **카메라 위치에 원점을 두어야** 합니다. 원점이 씬
 * 원점에 있으면 눈높이 1.6 만큼 어긋나, 가장 가까운 고리에서 각도가 0.9°
 * 까지 틀립니다. `updateTerrainFieldEye` 로 매 프레임 맞춥니다.
 */
import * as THREE from 'three';
import { DEM_GLSL, makeDemUniforms, type DemPatch } from '../../utils/demTiles';
import {
  EARTH_RADIUS_M, FIELD_NEAR_M, FIELD_FAR_M,
  GROUND_PROJECT_GLSL, createConcentricGeometry, ringDistanceM, ringRadius,
} from './groundProjection';

export { FIELD_NEAR_M, FIELD_FAR_M };

/**
 * 고리 수 × 살 수.
 *
 * 살(방위)이 실루엣을 정합니다 — 256 이면 1.41°, 지금 띠의 12° 보다
 * 8.5배 촘촘합니다. 고리는 로그 간격이라 가까울수록 촘촘합니다.
 */
// 발밑 24 + 바깥 128. 발밑 고리를 바깥에서 빼내면 먼 쪽 실루엣이 나빠집니다
// (최대오차 0.119° → 0.161°). 새로 덮는 구간이므로 **더합니다**.
export const FIELD_RINGS = 152;
export const FIELD_SPOKES = 256;

/**
 * 고리 k 의 지상 거리 (m). 판정(`verify-terrain-field.js`)의 CPU 참조도
 * **같은 거리**를 씁니다 — 안 그러면 표본 간격 차이를 결함으로 잘못 읽습니다.
 */
export function fieldRingDistanceM(k: number, rings: number = FIELD_RINGS): number {
  return ringDistanceM(k, rings, FIELD_FAR_M);
}

/** 동심원 격자. 배치와 규약은 `groundProjection.ts` 에 있습니다. */
export function createFieldGeometry(
  rings: number = FIELD_RINGS,
  spokes: number = FIELD_SPOKES,
): THREE.BufferGeometry {
  return createConcentricGeometry(rings, spokes, FIELD_FAR_M);
}

/** 격자 정점을 실제로 보이는 각도에 놓는 버텍스 셰이더. */
export const FIELD_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
${GROUND_PROJECT_GLSL}
uniform float uObsElevM;    // DEM 이 없을 때만 쓰는 발밑 고도 (m)
uniform float uEyeHeightM;  // 발밑에서 눈까지 (m)
varying float vDistM;
varying float vElevM;
varying vec3  vNormal;

/**
 * 관측자 **발밑** 고도 — 반드시 DEM 자신이 정합니다.
 *
 * ⚠ 여기에 바깥에서 받은 고도(Open-Meteo 등)를 쓰면 안 됩니다. 자료가 서로
 * 몇 m 만 달라도 눈이 그려지는 면에서 떠오르거나 파묻히고, 가장 가까운
 * 고리(12m)에서는 5m 차이가 **22°** 로 벌어집니다. 실제로 판정을 처음
 * 돌렸을 때 바깥 고도 0m 를 믿었다가 DEM 이 말하는 42m 에 파묻혀 지평선각이
 * 72° 로 나왔습니다.
 *
 * ⚠ **해수면(SeaPlane)도 같은 값을 씁니다.** 눈높이가 어긋나면 해안선이
 * 두 면의 교선이 아니게 됩니다.
 */
float groundAtEye() {
  return uDemValid > 0.5 ? dem_elevationAt(vec2(0.0)) : uObsElevM;
}

/** 그 지상 좌표의 고도 (m). 자료가 없으면 발밑 높이로 평평하게. */
float fieldElev(vec2 g) {
  return uDemValid > 0.5 ? dem_elevationAt(g) : uObsElevM;
}

void main() {
  vec2  g = vec2(position.x, position.z);   // (동, 남) m
  float r = position.y;                     // 깊이 순서용 반경
  float d = max(length(g), 0.001);

  float h = fieldElev(g);
  vElevM = h;
  vDistM = d;

  // 법선은 실제 지상 간격으로 낸 유한차분입니다. 고리 간격에 비례해 떨어져야
  // 가까이서 너무 잘고 멀리서 너무 뭉개지는 것을 피합니다.
  float e = max(8.0, d * 0.03);
  float hx = fieldElev(g + vec2(e, 0.0)) - fieldElev(g - vec2(e, 0.0));
  float hz = fieldElev(g + vec2(0.0, e)) - fieldElev(g - vec2(0.0, e));
  // (동, 남) 평면에서의 기울기 → 씬 좌표 법선 (+x 동, +z 남, +y 위)
  vNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));

  vec3 p = gp_project(g, h, groundAtEye() + uEyeHeightM, r);

  // ⚠ 가장자리를 알파로 흐리지 **않습니다.** 예전에는 바깥 고리를 페이드로
  //   넘겼는데, 해수면(4단계)이 생긴 지금 그러면 물가의 땅이 하늘로 사라져
  //   구멍이 남습니다. 격자는 자기 끝까지 불투명하고, 그 너머는 바다가
  //   이어받습니다.
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * 2단계에서는 **실루엣이 맞는가**가 판정입니다. 그래서 칠은 자료를 읽을 수
 * 있을 만큼만 합니다 — 조도 × 알베도에 램버트, 그리고 물은 해수면 아래로
 * 표시만 해 둡니다(진짜 물은 4단계에서 별도의 면으로 옵니다).
 */
export const FIELD_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uSurfaceIrr;    // 수평면이 받는 조도 (하늘 + 직달)
uniform vec3  uSunRadiance;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform vec3  uAlbedo;
uniform float uExposure;
uniform float uDemValid;
varying float vDistM;
varying float vElevM;
varying vec3  vNormal;

void main() {
  // ⚠ **해수면 아래는 그리지 않습니다.** 거기서 보이는 것은 땅이 아니라
  //    물이고, 물은 SeaPlane 이 그립니다.
  //
  //    이걸 안 하면 Terrarium 이 **먼바다를 정확히 0 으로 자른다**는 성질에
  //    걸립니다 (조사 때 표본 1024개 중 406개가 정확히 0). 그러면 지면
  //    메시가 해수면과 **똑같은 높이**에 면을 깔고, 깊이 동률에서 지면이
  //    이겨서 먼바다가 통째로 뭍으로 그려집니다. 실측: 맨 위 물이 이론
  //    −0.053° 대신 평균 −0.48° (약 320m 앞)에서 잘렸습니다.
  //
  //    알려진 한계: 고도가 정확히 0m 인 **간척지·갯벌**도 물로 읽힙니다.
  //    자료가 그 둘을 구분해 주지 않습니다.
  //
  // ⚠ **자료가 있을 때만** 자릅니다. DEM 을 못 받으면 대비책 지면이 고도 0 인
  //    평평한 판인데, 조건 없이 자르면 그 판이 통째로 사라져 지면이 아예 안
  //    그려집니다 (판정의 평판 대조가 0/1536 으로 잡았습니다).
  if (uDemValid > 0.5 && vElevM <= 0.0) discard;

  vec3 n = normalize(vNormal);
  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                  sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));

  // 조도 × 알베도. 하늘 몫은 등방이라 각도가 없고, 직달 몫만 방향을 탑니다.
  vec3 lit = uAlbedo * (uSurfaceIrr + uSunRadiance * ndl);
  gl_FragColor = vec4(lit * uExposure, 1.0);
}
`;

export interface TerrainFieldHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** DEM 패치를 갈아 끼웁니다. `null` 이면 평평하게 물러납니다. */
  setPatch: (patch: DemPatch | null) => void;
  dispose: () => void;
}

export function createTerrainField(opts: {
  patch?: DemPatch | null;
  /** DEM 이 없을 때만 쓰이는 대비책. 있으면 DEM 이 정합니다. */
  observerElevM?: number;
  eyeHeightM?: number;
  albedo?: { r: number; g: number; b: number };
  rings?: number;
  spokes?: number;
}): TerrainFieldHandle {
  const alb = opts.albedo ?? { r: 0.22, g: 0.17, b: 0.13 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeDemUniforms(opts.patch ?? null),
      uObsElevM: { value: opts.observerElevM ?? 0 },
      uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
      uSurfaceIrr: { value: new THREE.Vector3(0.05, 0.06, 0.08) },
      uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uSunAzRad: { value: 0 },
      uSunAltRad: { value: 0.5 },
      uAlbedo: { value: new THREE.Vector3(alb.r, alb.g, alb.b) },
      uExposure: { value: 1.0 },
    },
    vertexShader: FIELD_VERT,
    fragmentShader: FIELD_FRAG,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(
    createFieldGeometry(opts.rings ?? FIELD_RINGS, opts.spokes ?? FIELD_SPOKES),
    material,
  );
  mesh.name = 'terrainField';
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
 * ⚠ 메시 원점을 **눈**에 맞춥니다. 매 프레임 카메라가 움직이면 같이 옮겨야
 * 각도가 안 어긋납니다 (씬 원점에 두면 가장 가까운 고리에서 0.9° 틀립니다).
 */
export function updateTerrainFieldEye(
  handle: TerrainFieldHandle,
  camera: THREE.Camera,
): void {
  handle.mesh.position.copy(camera.position);
}

/**
 * 어느 방위의 **지평선 각도**(도) — 그 방위에서 가장 높이 보이는 지형.
 *
 * 셰이더와 **같은 식**입니다. 판정이 이걸 CPU 로 다시 구해 화면에서 잰
 * 실루엣과 견줍니다. 여기서 쓰는 고도 표본은 호출부가 넘깁니다(앱은 DEM
 * 텍스처를, 판정은 PNG 를 직접 푼 값을 씁니다) — 그래야 두 구현이
 * 진짜로 독립입니다.
 */
export function horizonAngleDeg(
  azRad: number,
  elevAt: (east: number, south: number) => number,
  opts: { eyeHeightM: number; rings?: number },
): number {
  const rings = opts.rings ?? FIELD_RINGS;
  // ⚠ 지상 좌표는 (동, **남**) 입니다. 방위 A 는 북에서 시계방향이므로
  //   동 = sin A, 남 = −cos A. 부호를 놓치면 180° − A 의 거울상을 읽습니다.
  // ⚠ 발밑도 **같은 자료**에서 읽습니다 — 셰이더의 `groundAtEye` 와 같은 규약.
  const eye = elevAt(0, 0) + opts.eyeHeightM;
  let best = -Infinity;
  for (let k = 0; k < rings; k++) {
    const d = fieldRingDistanceM(k, rings);
    const h = elevAt(Math.sin(azRad) * d, -Math.cos(azRad) * d);
    const drop = (d * d) / (2 * EARTH_RADIUS_M);
    const a = Math.atan2(h - eye - drop, d);
    if (a > best) best = a;
  }
  return (best * 180) / Math.PI;
}
