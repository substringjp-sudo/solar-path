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

/** `utils/weather.ts` · `seaHorizonDipDeg` 와 **같은 지구**여야 합니다. */
const EARTH_RADIUS_M = 6371000;

/** 격자가 덮는 안쪽·바깥쪽 지상 거리 (m). */
export const FIELD_NEAR_M = 12;
export const FIELD_FAR_M = 3000;

/** 깊이 순서용 반경. 스카이돔(500)·능선 띠(480) 안쪽에 둡니다. */
const RADIUS_NEAR = 120;
const RADIUS_FAR = 460;

/**
 * 고리 수 × 살 수.
 *
 * 살(방위)이 실루엣을 정합니다 — 256 이면 1.41°, 지금 띠의 12° 보다
 * 8.5배 촘촘합니다. 고리는 로그 간격이라 가까울수록 촘촘합니다.
 */
export const FIELD_RINGS = 128;
export const FIELD_SPOKES = 256;

/**
 * 고리 k 의 지상 거리 (m). **로그 간격**입니다.
 *
 * 등간격이면 발밑이 성기고 먼 곳이 과하게 촘촘합니다. 로그 간격은 Δd/d 가
 * 일정해서 화면 화소당 삼각형 수가 훨씬 고릅니다. 여기 값이 곧 반지름 방향
 * 표본이므로, 판정(`verify-terrain-field.js`)의 CPU 참조도 **같은 거리**를
 * 씁니다 — 안 그러면 표본 간격 차이를 결함으로 잘못 읽습니다.
 */
export function fieldRingDistanceM(k: number, rings: number = FIELD_RINGS): number {
  const t = rings <= 1 ? 0 : k / (rings - 1);
  return FIELD_NEAR_M * Math.pow(FIELD_FAR_M / FIELD_NEAR_M, t);
}

/** 그 거리에 주는 씬 반경 (깊이 순서 전용, d 에 단조 증가). */
export function fieldRingRadius(distM: number): number {
  const t =
    Math.log(distM / FIELD_NEAR_M) / Math.log(FIELD_FAR_M / FIELD_NEAR_M);
  return RADIUS_NEAR + (RADIUS_FAR - RADIUS_NEAR) * Math.min(1, Math.max(0, t));
}

/**
 * 동심원 격자를 만듭니다.
 *
 * `position.xz` 에 **지상 좌표(동, 남) m** 를 담고, `position.y` 에는 깊이
 * 순서용 반경을 담습니다. 버텍스 셰이더가 이 셋으로 실제 자리를 계산합니다.
 * (미터를 그대로 두는 이유는 셰이더가 DEM 을 그 좌표로 읽기 때문입니다.)
 */
export function createFieldGeometry(
  rings: number = FIELD_RINGS,
  spokes: number = FIELD_SPOKES,
): THREE.BufferGeometry {
  const count = rings * spokes;
  const pos = new Float32Array(count * 3);
  for (let k = 0; k < rings; k++) {
    const d = fieldRingDistanceM(k, rings);
    const r = fieldRingRadius(d);
    for (let j = 0; j < spokes; j++) {
      const az = (j / spokes) * Math.PI * 2;   // 북에서 시계방향
      // 씬 규약: +x = 동, **−z = 북** — 그러므로 남 = −cos(az).
      // ⚠ 여기서 부호를 빠뜨리면 격자 자체는 (한 바퀴를 반대로 돌 뿐이라)
      //   멀쩡해 보이지만, 같은 실수를 `horizonAngleDeg` 나 판정 참조에서
      //   하면 방위가 180° − A 로 **거울상**이 됩니다. 실제로 그렇게 나서
      //   실루엣 중앙오차가 1.34° 로 잡혔습니다.
      const east = Math.sin(az) * d;
      const south = -Math.cos(az) * d;
      const i = (k * spokes + j) * 3;
      pos[i] = east;
      pos[i + 1] = r;
      pos[i + 2] = south;
    }
  }

  // 고리 사이를 잇습니다. 살은 한 바퀴 도므로 마지막과 0 번을 이어 붙입니다.
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
  // 정점을 셰이더가 옮기므로 자동 바운딩은 뜻이 없습니다. 돔을 통째로 덮는
  // 구로 박아 둡니다 — 안 그러면 프러스텀 컬링이 메시를 통째로 지웁니다.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), RADIUS_FAR * 2);
  return g;
}

/** 격자 정점을 실제로 보이는 각도에 놓는 버텍스 셰이더. */
export const FIELD_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
uniform float uObsElevM;    // DEM 이 없을 때만 쓰는 발밑 고도 (m)
uniform float uEyeHeightM;  // 발밑에서 눈까지 (m)
uniform float uFarM;        // 격자 바깥 반경 (m) — 가장자리 페이드용
varying float vDistM;
varying float vElevM;
varying float vFade;
varying vec3  vNormal;

const float R_EARTH = ${EARTH_RADIUS_M}.0;

/**
 * 관측자 **발밑** 고도 — 반드시 DEM 자신이 정합니다.
 *
 * ⚠ 여기에 바깥에서 받은 고도(Open-Meteo 등)를 쓰면 안 됩니다. 자료가 서로
 * 몇 m 만 달라도 눈이 그려지는 면에서 떠오르거나 파묻히고, 가장 가까운
 * 고리(12m)에서는 5m 차이가 **22°** 로 벌어집니다. 실제로 판정을 처음
 * 돌렸을 때 바깥 고도 0m 를 믿었다가 DEM 이 말하는 42m 에 파묻혀 지평선각이
 * 72° 로 나왔습니다.
 *
 * DEM 에서 읽으면 눈은 **항상 그려지는 그 면 위**에 섭니다.
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

  // 실제로 보이는 각도 — 지구 곡률 낙차를 뺍니다.
  float drop = (d * d) / (2.0 * R_EARTH);
  float dy   = h - (groundAtEye() + uEyeHeightM) - drop;
  float elev = atan(dy, d);

  vec3 dir = vec3(g.x, 0.0, g.y) / d;
  vec3 p = vec3(dir.x * cos(elev) * r, sin(elev) * r, dir.z * cos(elev) * r);

  // 바깥 두 고리에서 서서히 넘겨줍니다 — 밖은 기존 능선 띠가 받습니다.
  vFade = 1.0 - smoothstep(uFarM * 0.88, uFarM, d);

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
varying float vDistM;
varying float vElevM;
varying float vFade;
varying vec3  vNormal;

void main() {
  vec3 n = normalize(vNormal);
  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                  sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));

  // 조도 × 알베도. 하늘 몫은 등방이라 각도가 없고, 직달 몫만 방향을 탑니다.
  vec3 alb = uAlbedo;
  // 해수면 아래는 젖은 쪽으로 — 4단계에서 진짜 수면이 덮을 자리입니다.
  alb = mix(alb, vec3(0.012, 0.030, 0.040), step(vElevM, 0.0));

  vec3 lit = alb * (uSurfaceIrr + uSunRadiance * ndl);
  gl_FragColor = vec4(lit * uExposure, vFade);
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
      uFarM: { value: FIELD_FAR_M },
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
    transparent: true,
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
