/**
 * CloudField.ts
 *
 * Why: 구름 하나당 Mesh+Material을 만들면 draw call이 구름 개수만큼 늘고(기존 최대 105개),
 * 업데이트마다 전량 dispose/재생성하느라 GC가 튑니다.
 *
 * 여기서는 InstancedMesh 하나 + 아틀라스 텍스처 하나로 모든 구름을 그립니다.
 *  - draw call: 구름이 몇 개든 1개
 *  - 업데이트: 지오메트리 생성 없이 인스턴스 속성 배열에 숫자만 씀
 *  - 빌보드 회전도 CPU lookAt이 아니라 vertex shader에서 처리
 *
 * 셰이딩은 라이팅 없이 lit/shadow 2색을 태양 방향으로 보간 + 가장자리 림라이트.
 * (기존처럼 두 색을 하나로 뭉개지 않기 때문에 부피감이 살아납니다.)
 */
import * as THREE from 'three';
import type { CloudAtlas } from './cloudAtlas';
import { CLOUD_SHELL_RADIUS, type CloudInstanceData } from './cloudPlacement';
import { ATMOSPHERE_GLSL } from '../../utils/atmosphere';

export interface CloudField {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  capacity: number;
  dispose: () => void;
}

const VERT = `
precision highp float;

attribute vec4 aUvRect;    // (u0, v0, u1, v1)
attribute vec3 aBeam;      // 구름 고도에서의 직달광 (linear)
attribute vec3 aAmbient;   // 구름 방향 하늘색 (linear)
attribute vec4 aGeom;      // (sizeX, sizeY, sunDirX, sunDirY)
attribute vec4 aOptics;    // (opacity, horizontal, tau, distanceKm)
attribute vec3 aCloudDb;   // 도감 광학 속성 (shadowContrast, rimSharpness, altitudeKm)

uniform vec3 uSunDir;

varying vec2  vUv;
varying vec2  vQuad;
varying vec3  vBeam;
varying vec3  vAmbient;
varying vec4  vOptics;
varying vec3  vCloudDb;
varying vec2  vSunDir2D;
varying float vCosView;

void main() {
  vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  vec2 corner = position.xy;   // PlaneGeometry(1,1) → -0.5..0.5

  vec3 worldPos;
  if (aOptics.y < 0.5) {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    worldPos = center + right * (corner.x * aGeom.x) + up * (corner.y * aGeom.y);
  } else {
    worldPos = center + vec3(corner.x * aGeom.x, 0.0, corner.y * aGeom.y);
  }

  // 구름을 보는 방향과 태양 방향의 각도. +1이면 역광 → 실버라이닝.
  vCosView = clamp(dot(normalize(center), uSunDir), -1.0, 1.0);

  vUv       = mix(aUvRect.xy, aUvRect.zw, corner + 0.5);
  vQuad     = corner;
  vBeam     = aBeam;
  vAmbient  = aAmbient;
  vOptics   = aOptics;
  vCloudDb  = aCloudDb;
  vSunDir2D = aGeom.zw;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

uniform sampler2D uAtlas;
uniform float uShadeContrast;
uniform vec3  uHorizonGlow;  // 지평선 노을빛 — 황혼 자색광 합성용
uniform vec3  uZenithSky;    // 천공 푸른빛 — 황혼 자색광 합성용
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;

varying vec2  vUv;
varying vec2  vQuad;
varying vec3  vBeam;
varying vec3  vAmbient;
varying vec4  vOptics;
varying vec3  vCloudDb;
varying vec2  vSunDir2D;
varying float vCosView;

void main() {
  float a = texture2D(uAtlas, vUv).a;
  if (a < 0.004) discard;

  float tau            = vOptics.z;
  float distanceKm     = vOptics.w;
  float shadowContrast = vCloudDb.x;   // 도감: 그림자 대비
  float rimSharpness   = vCloudDb.y;   // 도감: 림라이트 날카로움
  float altitudeKm     = vCloudDb.z;

  // ── 구름 광학 (2-stream) ────────────────────────────────────────────────
  // R = 확산반사(윗면이 희어짐), T = 확산투과(아래로 새는 빛)
  // T는 도감에 적힌 "투과율"과 일치하도록 tau를 역산해 넣었습니다.
  vec2 rt = atm_cloudRT(tau);
  float R = rt.x;
  float T = rt.y;

  // 얇은 구름의 역광 실버라이닝
  float silver = atm_cloudSilver(tau, vCosView);

  // ── 면 내 조명 ───────────────────────────────────────────────────────────
  float t = clamp(dot(vSunDir2D, vQuad) * uShadeContrast + 0.5, 0.0, 1.0);

  // 밝은 면: 반사 + 실버라이닝
  vec3 litCol = vBeam * (R + silver) + vAmbient * (1.0 - R) * 0.55;

  // 그늘 면: 통과한 확산광 + 주변 하늘. 도감의 shadowContrast가 깊이를 정합니다.
  float ambientKeep = 0.30 + T * 0.45;
  float depth = 1.0 - shadowContrast * 0.55;
  vec3 shadowCol = (vBeam * T * 0.35 + vAmbient * ambientKeep) * depth;

  // 황혼 자색광 — 그늘진 구름이 검게 죽지 않고 자주색을 띱니다.
  shadowCol = atm_twilightPurple(shadowCol, uHorizonGlow, uZenithSky, T);

  vec3 col = mix(shadowCol, litCol, t);

  // 가장자리는 광학적으로 얇아 빛이 샙니다. 도감의 rimSharpness가 폭을 정합니다.
  float rimWidth = mix(0.55, 0.12, rimSharpness);
  float edgeThin = smoothstep(0.85, 0.85 - rimWidth, a);
  col += vBeam * edgeThin * silver * 0.6;

  // ── 원경 대기 투시 ───────────────────────────────────────────────────────
  // 멀리 있는 구름일수록 사이 대기에 가려져 하늘색에 잠깁니다.
  vec3 Tpath = atm_aerialTransmittance(distanceKm, altitudeKm, uBeta, uAngstrom, uElevScale);
  col = col * Tpath + vAmbient * (1.0 - Tpath);

  // 하늘과 같은 톤매핑
  col = 1.0 - exp(-col);
  col = atm_toSrgb(col);

  gl_FragColor = vec4(col, a * vOptics.x);
}
`;

/**
 * 빈 구름 필드를 만듭니다. 인스턴스 내용은 updateCloudField()로 채웁니다.
 * @param capacity 최대 구름 개수 (버퍼 크기 고정)
 */
export function createCloudField(atlas: CloudAtlas, capacity: number = 320): CloudField {
  // PlaneGeometry를 그대로 사용합니다. InstancedBufferGeometry로 감싸고 attribute를
  // 공유하면, 원본 geometry를 dispose할 때 공유 중인 GPU 버퍼까지 해제되어 위험합니다.
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.deleteAttribute('normal'); // 미사용 — attribute 슬롯 절약

  const addInstanced = (name: string, itemSize: number) => {
    const arr = new Float32Array(capacity * itemSize);
    const attr = new THREE.InstancedBufferAttribute(arr, itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    return attr;
  };

  // 정점 attribute 슬롯을 아끼려고 값들을 vec4로 묶었습니다.
  // (모바일 GLES2는 attribute 개수 상한이 낮습니다)
  addInstanced('aUvRect', 4);
  addInstanced('aBeam', 3);
  addInstanced('aAmbient', 3);
  addInstanced('aGeom', 4);
  addInstanced('aOptics', 4);
  addInstanced('aCloudDb', 3);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uShadeContrast: { value: 1.35 },
      uHorizonGlow: { value: new THREE.Vector3(0, 0, 0) },
      uZenithSky: { value: new THREE.Vector3(0, 0, 0) },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'cloudField';
  mesh.count = 0;
  mesh.frustumCulled = false;
  // 하늘(-1)보다 앞, 지형보다 뒤에 그려지도록
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  return {
    mesh,
    material,
    capacity,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();

/**
 * 구름 인스턴스 목록을 GPU 버퍼에 씁니다.
 * 지오메트리 생성/해제가 없어 매 프레임 호출해도 안전합니다.
 *
 * @param sunAzDeg 태양 방위각 — 화면상 음영 방향 계산용
 * @param sunAltDeg 태양 고도
 */
export function updateCloudField(
  field: CloudField,
  atlas: CloudAtlas,
  instances: CloudInstanceData[],
  sunAzDeg: number,
  sunAltDeg: number,
  env: {
    /** 지평선 노을빛 (linear) — 황혼 자색광 합성용 */
    horizonGlow: { r: number; g: number; b: number };
    /** 천공 푸른빛 (linear) — 황혼 자색광 합성용 */
    zenithSky: { r: number; g: number; b: number };
    betaMie: number;
    angstrom: number;
    elevScale: number;
  }
): void {
  const { mesh, capacity } = field;
  const geometry = mesh.geometry as THREE.BufferGeometry;

  const uvRect  = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute;
  const beam    = geometry.getAttribute('aBeam') as THREE.InstancedBufferAttribute;
  const ambient = geometry.getAttribute('aAmbient') as THREE.InstancedBufferAttribute;
  const geom    = geometry.getAttribute('aGeom') as THREE.InstancedBufferAttribute;
  const optics  = geometry.getAttribute('aOptics') as THREE.InstancedBufferAttribute;
  const cloudDb = geometry.getAttribute('aCloudDb') as THREE.InstancedBufferAttribute;

  const u = field.material.uniforms;

  // 월드 태양 방향 — 셰이더가 역광 여부(실버라이닝)를 판단하는 데 씁니다.
  const sAlt = (sunAltDeg * Math.PI) / 180;
  const sAz = (sunAzDeg * Math.PI) / 180;
  (u.uSunDir.value as THREE.Vector3).set(
    Math.cos(sAlt) * Math.sin(sAz),
    Math.sin(sAlt),
    -Math.cos(sAlt) * Math.cos(sAz)
  );

  (u.uHorizonGlow.value as THREE.Vector3).set(env.horizonGlow.r, env.horizonGlow.g, env.horizonGlow.b);
  (u.uZenithSky.value as THREE.Vector3).set(env.zenithSky.r, env.zenithSky.g, env.zenithSky.b);
  u.uBeta.value = env.betaMie;
  u.uAngstrom.value = env.angstrom;
  u.uElevScale.value = env.elevScale;

  // 반투명 빌보드는 뒤에서 앞으로 그려야 겹침이 자연스럽습니다.
  const sorted = instances.slice(0, capacity).sort((a, b) => b.distanceKm - a.distanceKm);

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];

    const altRad = (c.elevationDeg * Math.PI) / 180;
    const azRad = (c.azimuthDeg * Math.PI) / 180;

    // Three.js 좌표계: Y=up, -Z=North, X=East
    _pos.set(
      CLOUD_SHELL_RADIUS * Math.cos(altRad) * Math.sin(azRad),
      CLOUD_SHELL_RADIUS * Math.sin(altRad),
      -CLOUD_SHELL_RADIUS * Math.cos(altRad) * Math.cos(azRad)
    );
    _mat.makeTranslation(_pos.x, _pos.y, _pos.z);
    mesh.setMatrixAt(i, _mat);

    const rect = atlas.rects.get(c.atlasKey);
    if (rect) {
      uvRect.setXYZW(i, rect.u0, rect.v0, rect.u1, rect.v1);
    } else {
      uvRect.setXYZW(i, 0, 0, 1, 1);
    }

    // 물리 복사휘도(linear). 셰이더가 여기서 2-stream 산란을 계산합니다.
    beam.setXYZ(i, c.beam.r, c.beam.g, c.beam.b);
    ambient.setXYZ(i, c.ambient.r, c.ambient.g, c.ambient.b);

    // quad 로컬 공간에서 태양이 어느 쪽인지 (면 내 음영 그라데이션용)
    const azDiff = ((sunAzDeg - c.azimuthDeg + 540) % 360) - 180;
    let sx: number;
    let sy: number;
    if (c.horizontal) {
      sx = Math.sin((azDiff * Math.PI) / 180);
      sy = Math.cos((azDiff * Math.PI) / 180);
    } else {
      sx = Math.sin((azDiff * Math.PI) / 180);
      sy = Math.sin(((sunAltDeg - c.elevationDeg) * Math.PI) / 180);
    }
    const len = Math.hypot(sx, sy) || 1;

    geom.setXYZW(i, c.sizeY * c.aspect, c.sizeY, sx / len, sy / len);
    optics.setXYZW(i, c.opacity, c.horizontal ? 1 : 0, c.tau, c.distanceKm);
    cloudDb.setXYZ(i, c.shadowContrast, c.rimSharpness, c.altitudeKm);
  }

  mesh.count = sorted.length;
  mesh.instanceMatrix.needsUpdate = true;
  uvRect.needsUpdate = true;
  beam.needsUpdate = true;
  ambient.needsUpdate = true;
  geom.needsUpdate = true;
  optics.needsUpdate = true;
  cloudDb.needsUpdate = true;
}
