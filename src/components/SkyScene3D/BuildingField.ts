/**
 * BuildingField.ts — 반경 1 km LOD1 건물 고도 매스 메시 (구면 투영 + 지형 3패스 호환).
 *
 * TerrainField / SeaPlane 과 동일한 `GROUND_PROJECT_GLSL` 및 `ringRadius` 깊이 규약을 쓰므로,
 * 산·언덕·지평선·구름·해·달과의 앞뒤 가림(depth)이 정확히 일치하며
 * 볼륨 하늘의 `LAYER_TERRAIN_DIST`(구름 차단) · `LAYER_TERRAIN_LIT`(하늘/태양/연무 조도)에도 함께 들어갑니다.
 */
import * as THREE from 'three';
import { DEM_GLSL, demGlsl, makeDemUniforms, type DemPatch } from '../../utils/demTiles';
import { ATMOSPHERE_GLSL, GROUND_DISPLAY_GLSL, makeTuningUniforms } from '../../utils/atmosphere';
import {
  GROUND_PROJECT_GLSL,
  RADIUS_FAR,
  RADIUS_NEAR,
  RADIUS_REF_FAR_M,
  RADIUS_REF_NEAR_M,
} from './groundProjection';
import { LAYER_TERRAIN_DIST, LAYER_TERRAIN_LIT, TERRAIN_DIST_GLSL } from './SceneComposer';
import { LIT2_ENCODE_GLSL } from './terrainLook';
import { createBuildingThreeGeometry, WINDOW_CELL_M, type BuildingMeshData } from '../../utils/buildingTiles';

/** 중성 밝은 석재/콘크리트 회색 건축 매스 알베도 (도시 포장 지반보다 밝게 구분) */
const BUILDING_ALBEDO = { r: 0.125, g: 0.130, b: 0.140 };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth01 = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * 현지 시각(0~24h)에 따른 야간 창문 점등 비율 (0~1).
 * - 저녁(16:00~21:30): 약 46% 점등
 * - 늦은 밤~자정(21:30~24:00): 46% -> 22% 점진 감소
 * - 심야(00:00~02:00): 22% -> 1% 감소
 * - 새벽 2시 이후(02:00~05:30): 1%(0.01) 유지 (건물당 floor 내림으로 소형 시골 건물은 완전 소등)
 */
export function computeNightWindowRate(localHour: number): number {
  const h = ((localHour % 24) + 24) % 24;
  if (h >= 2 && h < 5.5) return 0.01;
  if (h < 2) return 0.22 - (0.22 - 0.01) * smooth01(h / 2.0);
  if (h >= 21.5) return 0.46 - (0.46 - 0.22) * smooth01((h - 21.5) / 2.5);
  if (h >= 16) return 0.46;
  if (h < 8.5) return 0.01 + (0.24 - 0.01) * smooth01((h - 5.5) / 3.0);
  return 0.24 + (0.46 - 0.24) * smooth01((h - 8.5) / 7.5);
}

/** 태양 고도(°), 도시 불빛 옵션 및 지역 빛지도 밝기(localNorm)에 따른 창문 발광 세기. */
export function computeNightWindowGlow(sunAltDeg: number, cityLightsEnabled: boolean = true, localNorm: number = 1): number {
  if (!cityLightsEnabled || !Number.isFinite(sunAltDeg)) return 0;
  const regionScale = 0.25 + 0.75 * Math.max(0, Math.min(1, localNorm));
  return smooth01((2.0 - sunAltDeg) / 8.0) * regionScale;
}

const BUILDING_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
${demGlsl('demEye')}
${demGlsl('demFar')}
${GROUND_PROJECT_GLSL}

attribute vec2 aGroundPos;
attribute vec4 aWallCoord;

uniform float uObsElevM;
uniform float uEyeHeightM;
uniform float uBlendInner;

varying vec3  vNormalW;
varying float vDistM;
varying float vSlantM;
varying vec3  vViewDir;
varying vec2  vBuildPos;
#ifdef TERRAIN_WINDOW_OUT
varying vec4  vWallCoord;
#endif

float bf_groundAtEye() {
  if (uDemEyeValid > 0.5) return demEye_elevationAt(vec2(0.0));
  return uDemValid > 0.5 ? dem_elevationAt(vec2(0.0)) : uObsElevM;
}

float bf_fineWeight(vec2 g) {
  if (uDemValid < 0.5) return 0.0;
  float rp = dem_probeRadiusM();
  return 1.0 - smoothstep(rp * uBlendInner, rp * 0.98, length(g));
}

float bf_groundElev(vec2 g) {
  bool hasFine = uDemValid > 0.5;
  bool hasFar = uDemFarValid > 0.5;
  if (!hasFine && !hasFar) return uObsElevM;
  if (!hasFar) return dem_elevationAt(g);
  if (!hasFine) return demFar_elevationDespiked(g);
  float w = bf_fineWeight(g);
  if (w <= 0.001) return demFar_elevationDespiked(g);
  if (w >= 0.999) return dem_elevationAt(g);
  return mix(demFar_elevationDespiked(g), dem_elevationAt(g), w);
}

float bf_ringRadius(float distM) {
  float t = log(max(distM, ${RADIUS_REF_NEAR_M.toFixed(1)}) / ${RADIUS_REF_NEAR_M.toFixed(1)})
          / log(${RADIUS_REF_FAR_M.toFixed(1)} / ${RADIUS_REF_NEAR_M.toFixed(1)});
  return ${RADIUS_NEAR.toFixed(1)} + ${(RADIUS_FAR - RADIUS_NEAR).toFixed(1)} * clamp(t, 0.0, 1.0);
}

void main() {
  vec2 g = vec2(position.x, position.z);
  float d = max(length(g), 0.1);
  float r = bf_ringRadius(d);

  // 건물 중심 지반 고도에 상대 높이(position.y)를 더해 경사지 위에서도 옥상이 수평을 유지
  float baseElevM = bf_groundElev(aGroundPos);
  float h = baseElevM + position.y;
  float eyeElevM = bf_groundAtEye() + uEyeHeightM;

  vec3 p = gp_project(g, h, eyeElevM, r);
  float dzM = h - eyeElevM - gp_drop(d);
  vSlantM = sqrt(d * d + dzM * dzM);
  vDistM = d;
  vNormalW = normalize(normal);
  vViewDir = normalize(p);
  vBuildPos = aGroundPos;
#ifdef TERRAIN_WINDOW_OUT
  vWallCoord = aWallCoord;
#endif

  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * 2026-11-18 가로등 머리(사용자 제안: 큰 도로에 가로등). 건물과 같은 지반 고도·투영 규약(BUILDING_VERT 머리)을 쓰고,
 * 땅 위 position.y(9 m) 자리에 화면 크기 점으로 그립니다. 멀수록 작아지고(1.5~9 px) 대기에 잠깁니다.
 */
const LAMP_VERT = BUILDING_VERT.slice(0, BUILDING_VERT.indexOf('void main() {')) + /* glsl */ `
uniform float uLampPx;
void main() {
  vec2 g = vec2(position.x, position.z);
  float d = max(length(g), 0.1);
  float r = bf_ringRadius(d);
  float h = bf_groundElev(g) + position.y;
  float eyeElevM = bf_groundAtEye() + uEyeHeightM;
  vec3 p = gp_project(g, h, eyeElevM, r);
  vDistM = d;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_PointSize = clamp(uLampPx * 160.0 / d, 2.0 * uLampPx, 12.0 * uLampPx);
}
`;
const LAMP_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
varying float vDistM;
uniform float uLampGlow;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float rr = dot(q, q);
  if (rr > 1.0 || uLampGlow <= 0.001) discard;
  float a = exp(-rr * 4.5);
  vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
  float fade = 1.0 - smoothstep(1350.0, 1580.0, vDistM);
  gl_FragColor = vec4(vec3(1.00, 0.90, 0.72) * a * uLampGlow * T * fade, 1.0);
}
`;

const BUILDING_FRAG = /* glsl */ `
precision highp float;

varying vec3  vNormalW;
varying float vDistM;
varying float vSlantM;
varying vec3  vViewDir;
// 건물 자리(건물마다 다른 씨앗). 창문·빛 판·기본 세 갈래가 모두 씁니다 — 2026-11-18 전에는 창문 갈래에만 선언돼
// 빛 판·기본 갈래 셰이더가 컴파일되지 않아(bSeed 미선언) 외벽이 통째로 안 그려졌습니다.
varying vec2  vBuildPos;

#ifdef TERRAIN_DIST_OUT
${TERRAIN_DIST_GLSL}
void main() {
  gl_FragColor = terrainDistEncode(vSlantM / 1000.0);
}
#elif defined(TERRAIN_WINDOW_OUT)
${ATMOSPHERE_GLSL}

varying vec4 vWallCoord;

uniform float uWinRate;
uniform float uWinGlow;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;

float bf_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  if (uWinGlow <= 0.001 || uWinRate <= 0.0) discard;
  if (vWallCoord.x < 0.0 || vWallCoord.y < 0.0 || abs(vNormalW.y) > 0.5) discard;

  float cellU = vWallCoord.x / ${WINDOW_CELL_M.toFixed(1)};
  float cellV = vWallCoord.y / ${WINDOW_CELL_M.toFixed(1)};
  float colIdx = floor(cellU);
  float rowIdx = floor(cellV);
  if (colIdx < 0.0 || colIdx >= vWallCoord.z || rowIdx < 0.0 || rowIdx >= vWallCoord.w) discard;

  // 건물 전체 창문 개수에 내림(floor) 적용 → 2시 이후 1%일 때 소형 시골 건물(<100칸)은 0개로 완전 소등
  float totalWin = vWallCoord.z * vWallCoord.w;
  float litQuota = floor(totalWin * clamp(uWinRate, 0.0, 1.0));
  if (litQuota < 0.5) discard;

  vec2 bSeed = fract(vBuildPos * 0.0173) * 97.0;
  float seedZ = bSeed.x * 1.31 + bSeed.y * 2.17;
  float rLit = bf_hash13(vec3(colIdx + 1.0, rowIdx + 1.0, seedZ));
  if (rLit >= litQuota / max(1.0, totalWin)) discard;

  float uF = fract(cellU);
  float vF = fract(cellV);
  float aa = clamp(vDistM * 0.00055, 0.02, 0.21);
  float wx = smoothstep(0.25 - aa, 0.25 + aa, uF) * (1.0 - smoothstep(0.75 - aa, 0.75 + aa, uF));
  float wy = smoothstep(0.30 - aa, 0.30 + aa, vF) * (1.0 - smoothstep(0.74 - aa, 0.74 + aa, vF));
  float winShape = wx * wy;
  if (winShape < 0.01) discard;

  float rTone = bf_hash13(vec3(colIdx + 19.0, rowIdx + 7.0, seedZ * 1.37 + 5.0));
  vec3 colWarm = vec3(1.00, 0.68, 0.30);
  vec3 colSoft = vec3(1.00, 0.86, 0.62);
  vec3 colCool = vec3(0.84, 0.91, 1.00);
  vec3 winTint = rTone < 0.58 ? mix(colWarm, colSoft, rTone / 0.58)
                              : mix(colSoft, colCool, ((rTone - 0.58) / 0.42) * 0.65);

  float lum = (0.48 + 0.34 * rTone) * uWinGlow * (0.82 + 0.24 * vF);
  vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
  float distFade = 1.0 - smoothstep(650.0, 1020.0, vDistM);
  gl_FragColor = vec4(winTint * winShape * lum * T * distFade, 1.0);
}
#elif defined(TERRAIN_LIT_OUT)
${TERRAIN_DIST_GLSL}
${LIT2_ENCODE_GLSL}

uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uOvercast;

layout(location = 1) out highp vec4 pc_fragColor1;
layout(location = 2) out highp vec4 pc_fragColor2;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                  sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));
  float cloudT = clamp(1.0 - uOvercast, 0.05, 1.0);
  float skyHemi = 0.60 + 0.40 * n.y;
  float fillGeo = clamp((dot(n, sun) + 0.6) / 1.6, 0.0, 1.0);
  float fillFlat = clamp((sin(uSunAltRad) + 0.6) / 1.6, 0.05, 1.0);
  float fill = (1.0 - cloudT) * 0.45 * clamp(fillGeo / fillFlat, 0.0, 2.0);
  vec2 bSeed = fract(vBuildPos * 0.0173) * 97.0;
  float bTone = fract(sin(dot(bSeed, vec2(127.1, 311.7))) * 43758.5453);
  float bWarm = fract(sin(dot(bSeed, vec2(269.5, 183.3))) * 43758.5453);
  vec3 grayShift = vec3(0.88 + 0.24 * bTone) * vec3(1.0 + (bWarm - 0.5) * 0.06, 1.0, 1.0 - (bWarm - 0.5) * 0.06);
  vec3 litAlb = vec3(${BUILDING_ALBEDO.r.toFixed(4)}, ${BUILDING_ALBEDO.g.toFixed(4)}, ${BUILDING_ALBEDO.b.toFixed(4)}) * (0.90 + 0.16 * n.y) * grayShift;
  gl_FragColor = vec4(sqrt(clamp(litAlb, 0.0, 1.0)), clamp(ndl * cloudT, 0.0, 1.0));
  pc_fragColor1 = lit2Encode(skyHemi, 0.0, fill, 1.0 - cloudT);
  pc_fragColor2 = terrainDistEncode(vSlantM / 1000.0);
}
#else

${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}

uniform float uDepthOnly;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uSunAltDeg;
uniform float uMoonAzRad;
uniform float uMoonAltRad;
uniform vec3  uSurfaceIrr;
uniform vec3  uSunRadiance;
uniform vec3  uMoonRadiance;
uniform float uExposure;
uniform float uSaturation;
uniform vec3  uHazeRadiance;
uniform float uAerial;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;
uniform float uOvercast;
uniform float uDiagRaw;
uniform float uCityWallGain;
uniform vec2  uCityDirXZ;

void main() {
  if (uDepthOnly > 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 n = normalize(vNormalW);
  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                  sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));
  float cloudT = clamp(1.0 - uOvercast, 0.05, 1.0);

  vec3 moon = vec3(cos(uMoonAltRad) * sin(uMoonAzRad),
                   sin(uMoonAltRad),
                  -cos(uMoonAltRad) * cos(uMoonAzRad));
  float ndlMoon = max(0.0, dot(n, moon)) * cloudT;
  float sunUp = max(0.0, sin(uSunAltRad));
  float moonUp = max(0.0, sin(uMoonAltRad));
  vec3 directFlat = (uSunRadiance * sunUp + uMoonRadiance * moonUp) / 3.14159265;
  vec3 skyIrr = max(vec3(0.0), uSurfaceIrr - directFlat);
  vec3 directLit = (uSunRadiance * ndl * cloudT + uMoonRadiance * ndlMoon) / 3.14159265;

  // 벽면 방향에 따른 은은한 반구 음영 + 건물별 미세 회색 톤 편차
  vec2 bSeed = fract(vBuildPos * 0.0173) * 97.0;
  float bTone = fract(sin(dot(bSeed, vec2(127.1, 311.7))) * 43758.5453);
  float bWarm = fract(sin(dot(bSeed, vec2(269.5, 183.3))) * 43758.5453);
  vec3 grayShift = vec3(0.88 + 0.24 * bTone) * vec3(1.0 + (bWarm - 0.5) * 0.06, 1.0, 1.0 - (bWarm - 0.5) * 0.06);
  float hemi = 0.72 + 0.28 * n.y;
  vec3 alb = vec3(0.20, 0.205, 0.215) * hemi * grayShift;
  vec3 col = alb * (skyIrr + directLit);

  // 지역 빛지도 기반 야간 건물 외벽 방향성 반사 (2900~3100K 도시광)
  if (uCityWallGain > 1e-5) {
    float cDir = 0.35 + 0.65 * max(0.0, dot(normalize(vec2(n.x, n.z) + vec2(1e-5)), normalize(uCityDirXZ + vec2(1e-5))));
    float wallSlope = 0.40 + 0.60 * (1.0 - abs(n.y));
    col += alb * vec3(1.00, 0.787, 0.573) * (uCityWallGain * cDir * wallSlope);
  }

  if (uAerial > 0.5) {
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
    vec3 dir = normalize(vViewDir);
    float elevDeg = degrees(asin(clamp(dir.y, -1.0, 1.0)));
    float cosG = clamp(dot(dir, sun), -1.0, 1.0);
    vec3 haze = max(atm_skyRadianceLit(max(0.5, elevDeg), cosG, uSunAltDeg,
      max(0.001, uBeta), max(0.1, uAngstrom), max(0.1, uElevScale), max(50.0, uOzoneDU), vec3(1.0)), vec3(0.0));
    float hazeScale = 1.0 / max(1e-4, uExposure * atm_groundEyeAdapt(uSunAltDeg));
    col = col * T + haze * (1.0 - T) * hazeScale;
  }

  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg), 1.0);
  if (uDiagRaw > 0.5) gl_FragColor = vec4(0.85, 0.85, 0.90, 1.0);
}
#endif
`;

export interface BuildingFieldHandle {
  mesh: THREE.Mesh;
  distMesh: THREE.Mesh;
  litMesh: THREE.Mesh;
  windowMesh: THREE.Mesh;
  /** 2026-11-18 가로등 머리 점(더하기). 부르는 쪽이 씬의 LAYER_MID 에 넣습니다. */
  lampPoints: THREE.Points;
  /** 가로등 자리(동 x, 남 z, m) 쌍. null 이면 지웁니다. */
  setLamps: (xz: Float32Array | null | undefined) => void;
  /** 가로등 밝기(0 = 끔)와 화면 배율(점 크기). */
  setLampGlow: (glow: number, pixelRatio?: number) => void;
  material: THREE.ShaderMaterial;
  setBuildings: (data: BuildingMeshData | null) => void;
  setPatch: (patch: DemPatch | null, eyePatch?: DemPatch | null, farPatch?: DemPatch | null) => void;
  setVisible: (v: boolean) => void;
  setWindowLighting: (rate: number, glow: number) => void;
  hasGeometry: () => boolean;
  geomSerial: () => number;
  dispose: () => void;
}

export function createBuildingField(opts: { observerElevM?: number; eyeHeightM?: number } = {}): BuildingFieldHandle {
  const uniforms: Record<string, THREE.IUniform> = {
    ...makeTuningUniforms(),
    ...makeDemUniforms(null),
    ...makeDemUniforms(null, 'demEye'),
    ...makeDemUniforms(null, 'demFar'),
    uObsElevM: { value: opts.observerElevM ?? 0 },
    uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
    uBlendInner: { value: 0.30 },
    uDepthOnly: { value: 0 },
    uSunAzRad: { value: 0 },
    uSunAltRad: { value: 0.5 },
    uSunAltDeg: { value: 30 },
    uMoonAzRad: { value: 0 },
    uMoonAltRad: { value: -0.5 },
    uSurfaceIrr: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
    uSunRadiance: { value: new THREE.Vector3(1.5, 1.4, 1.2) },
    uMoonRadiance: { value: new THREE.Vector3(0, 0, 0) },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uHazeRadiance: { value: new THREE.Vector3(0.3, 0.4, 0.6) },
    uAerial: { value: 1 },
    uBeta: { value: 0.08 },
    uAngstrom: { value: 1.3 },
    uElevScale: { value: 1 },
    uOzoneDU: { value: 300 },
    uOvercast: { value: 0 },
    uDiagRaw: { value: 0 },
    uCityWallGain: { value: 0 },
    uCityDirXZ: { value: new THREE.Vector2(0, -1) },
    uWinRate: { value: 0.46 },
    uWinGlow: { value: 0 },
    uLampGlow: { value: 0 },
    uLampPx: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
  });

  const distMaterial = material.clone();
  distMaterial.uniforms = material.uniforms;
  distMaterial.defines = { TERRAIN_DIST_OUT: 1 };
  distMaterial.transparent = false;
  distMaterial.blending = THREE.NoBlending;

  const litMaterial = material.clone();
  litMaterial.uniforms = material.uniforms;
  litMaterial.defines = { TERRAIN_LIT_OUT: 1 };
  litMaterial.transparent = false;
  litMaterial.blending = THREE.NoBlending;

  const windowMaterial = material.clone();
  windowMaterial.uniforms = material.uniforms;
  windowMaterial.defines = { TERRAIN_WINDOW_OUT: 1 };
  windowMaterial.transparent = true;
  windowMaterial.blending = THREE.AdditiveBlending;
  windowMaterial.depthWrite = false;
  windowMaterial.depthTest = true;
  windowMaterial.depthFunc = THREE.LessEqualDepth;
  windowMaterial.polygonOffset = true;
  windowMaterial.polygonOffsetFactor = -1;
  windowMaterial.polygonOffsetUnits = -1;

  const emptyGeo = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(emptyGeo, material);
  mesh.name = 'buildingField';
  mesh.frustumCulled = false;
  mesh.visible = false;

  const distMesh = new THREE.Mesh(emptyGeo, distMaterial);
  distMesh.name = 'buildingFieldDist';
  distMesh.frustumCulled = false;
  distMesh.visible = false;
  distMesh.layers.set(LAYER_TERRAIN_DIST);

  const litMesh = new THREE.Mesh(emptyGeo, litMaterial);
  litMesh.name = 'buildingFieldLit';
  litMesh.frustumCulled = false;
  litMesh.visible = false;
  litMesh.layers.set(LAYER_TERRAIN_LIT);

  const windowMesh = new THREE.Mesh(emptyGeo, windowMaterial);
  windowMesh.name = 'buildingFieldWindows';
  windowMesh.frustumCulled = false;
  windowMesh.visible = false;

  // 2026-11-18 가로등 머리 점(건물 켬·끔과 상관없이 밤에 보임).
  const lampMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: LAMP_VERT,
    fragmentShader: LAMP_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const lampPoints = new THREE.Points(new THREE.BufferGeometry(), lampMaterial);
  lampPoints.name = 'streetLamps';
  lampPoints.frustumCulled = false;
  lampPoints.visible = false;
  let hasLamps = false;

  let currentGeo = emptyGeo;
  let hasData = false;
  let enabled = false;
  let serial = 0;

  const syncVisibility = () => {
    const show = enabled && hasData;
    mesh.visible = show;
    distMesh.visible = show;
    litMesh.visible = show;
    windowMesh.visible = show && Number(uniforms.uWinGlow.value) > 0.001 && Number(uniforms.uWinRate.value) > 0;
    lampPoints.visible = hasLamps && Number(uniforms.uLampGlow.value) > 0.001;
  };

  return {
    mesh,
    distMesh,
    litMesh,
    windowMesh,
    lampPoints,
    material,
    setLamps: (xz) => {
      const old = lampPoints.geometry;
      const geo = new THREE.BufferGeometry();
      const n = xz ? Math.floor(xz.length / 2) : 0;
      if (n > 0) {
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { pos[i * 3] = xz![i * 2]; pos[i * 3 + 1] = 9; pos[i * 3 + 2] = xz![i * 2 + 1]; }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      }
      lampPoints.geometry = geo;
      old.dispose();
      hasLamps = n > 0;
      syncVisibility();
    },
    setLampGlow: (glow, pixelRatio) => {
      uniforms.uLampGlow.value = Math.max(0, Math.min(1.5, Number.isFinite(glow) ? glow : 0));
      if (pixelRatio != null && Number.isFinite(pixelRatio)) uniforms.uLampPx.value = Math.max(1, pixelRatio);
      syncVisibility();
    },
    setBuildings: (data) => {
      serial++;
      const nextGeo = data ? createBuildingThreeGeometry(data) : new THREE.BufferGeometry();
      mesh.geometry = nextGeo;
      distMesh.geometry = nextGeo;
      litMesh.geometry = nextGeo;
      windowMesh.geometry = nextGeo;
      if (currentGeo !== nextGeo) currentGeo.dispose();
      currentGeo = nextGeo;
      hasData = !!data && data.vertexCount > 0;
      syncVisibility();
    },
    setPatch: (patch, eyePatch, farPatch) => {
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      put(makeDemUniforms(patch));
      if (eyePatch !== undefined) put(makeDemUniforms(eyePatch, 'demEye'));
      if (farPatch !== undefined) {
        put(makeDemUniforms(farPatch, 'demFar'));
        if (material.uniforms.uDemFarDespike) material.uniforms.uDemFarDespike.value = 1;
      }
    },
    setVisible: (v) => {
      enabled = v;
      syncVisibility();
    },
    setWindowLighting: (rate, glow) => {
      uniforms.uWinRate.value = clamp01(rate);
      uniforms.uWinGlow.value = clamp01(glow);
      syncVisibility();
    },
    hasGeometry: () => hasData,
    geomSerial: () => serial,
    dispose: () => {
      currentGeo.dispose();
      material.dispose();
      distMaterial.dispose();
      litMaterial.dispose();
      windowMaterial.dispose();
      lampPoints.geometry.dispose();
      lampMaterial.dispose();
    },
  };
}

/**
 * `TerrainField.updateTerrainFieldEye` 와 동일하게 카메라 원점 맞추기.
 */
export function updateBuildingFieldEye(handle: BuildingFieldHandle, camera: THREE.Camera): void {
  handle.mesh.position.copy(camera.position);
  handle.distMesh.position.copy(camera.position);
  handle.litMesh.position.copy(camera.position);
  handle.windowMesh.position.copy(camera.position);
  handle.lampPoints.position.copy(camera.position);
  handle.distMesh.visible = handle.mesh.visible;
  handle.litMesh.visible = handle.mesh.visible;
}
