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
import { createBuildingThreeGeometry, type BuildingMeshData } from '../../utils/buildingTiles';

/** 중성 밝은 석재/콘크리트 회색 건축 매스 알베도 (도시 포장 지반보다 밝게 구분) */
const BUILDING_ALBEDO = { r: 0.125, g: 0.130, b: 0.140 };

const BUILDING_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
${demGlsl('demEye')}
${demGlsl('demFar')}
${GROUND_PROJECT_GLSL}

attribute vec2 aGroundPos;

uniform float uObsElevM;
uniform float uEyeHeightM;
uniform float uBlendInner;

varying vec3  vNormalW;
varying float vDistM;
varying float vSlantM;
varying vec3  vViewDir;

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

  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BUILDING_FRAG = /* glsl */ `
precision highp float;

varying vec3  vNormalW;
varying float vDistM;
varying float vSlantM;
varying vec3  vViewDir;

#ifdef TERRAIN_DIST_OUT
${TERRAIN_DIST_GLSL}
void main() {
  gl_FragColor = terrainDistEncode(vSlantM / 1000.0);
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
  vec3 litAlb = vec3(${BUILDING_ALBEDO.r.toFixed(4)}, ${BUILDING_ALBEDO.g.toFixed(4)}, ${BUILDING_ALBEDO.b.toFixed(4)}) * (0.90 + 0.16 * n.y);
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

  // 벽면 방향에 따른 은은한 반구 음영으로 매스감만 살림
  float hemi = 0.72 + 0.28 * n.y;
  vec3 alb = vec3(0.20, 0.205, 0.215) * hemi;
  vec3 col = alb * (skyIrr + directLit);

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
  material: THREE.ShaderMaterial;
  setBuildings: (data: BuildingMeshData | null) => void;
  setPatch: (patch: DemPatch | null, eyePatch?: DemPatch | null, farPatch?: DemPatch | null) => void;
  setVisible: (v: boolean) => void;
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

  let currentGeo = emptyGeo;
  let hasData = false;
  let enabled = false;
  let serial = 0;

  const syncVisibility = () => {
    const show = enabled && hasData;
    mesh.visible = show;
    distMesh.visible = show;
    litMesh.visible = show;
  };

  return {
    mesh,
    distMesh,
    litMesh,
    material,
    setBuildings: (data) => {
      serial++;
      const nextGeo = data ? createBuildingThreeGeometry(data) : new THREE.BufferGeometry();
      mesh.geometry = nextGeo;
      distMesh.geometry = nextGeo;
      litMesh.geometry = nextGeo;
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
    hasGeometry: () => hasData,
    geomSerial: () => serial,
    dispose: () => {
      currentGeo.dispose();
      material.dispose();
      distMaterial.dispose();
      litMaterial.dispose();
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
  handle.distMesh.visible = handle.mesh.visible;
  handle.litMesh.visible = handle.mesh.visible;
}
