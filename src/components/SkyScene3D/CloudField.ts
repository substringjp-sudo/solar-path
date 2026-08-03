/**
 * CloudField.ts
 *
 * Why: 3D 구름 렌더링 시 수평 눕힘 옵션을 제거하고 카메라를 향하는 정교한 3D 빌보드로 통일하여,
 * 거대한 사각형 덮개 폴리곤이 화면을 가리는 증상 및 좌우 찌그러짐 현상을 해결합니다.
 * 고도층별 구면 반지름(c.shellRadius)을 사용하여 상/중/하층 구름의 물리적 고도감을 구현합니다.
 */
import * as THREE from 'three';
import type { CloudAtlas } from './cloudAtlas';
import { type CloudInstanceData } from './cloudPlacement';
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

  // 항상 카메라 시선 방향을 바라보는 spherical billboard 정렬
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldPos = center + right * (corner.x * aGeom.x) + up * (corner.y * aGeom.y);

  // 구름을 보는 방향과 태양 방향의 각도. +1이면 역광 → 실버라이닝
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
uniform float uSunAlt;       // 태양 고도 (라디안) — 노을 틴트 강도 제어

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
  vec2 rt = atm_cloudRT(tau);
  float R = rt.x;
  float T = rt.y;

  // 얇은 구름의 역광 실버라이닝
  float silver = atm_cloudSilver(tau, vCosView);

  // ── 노을 틴트 계산 (Sunset/Sunrise Cloud Illumination Tint) ─────────────
  // beam 색온도: R채널이 B보다 강할수록 노을 상태 (0=낮 흰빛, 1=완전 노을 주홍)
  float sunsetStrength = clamp((vBeam.r - vBeam.b) * 2.2, 0.0, 1.0);

  // 태양 고도에 따른 틴트 활성 범위: -6° ~ +10° 사이에서만 강하게 작용
  // uSunAlt가 이미 라디안이므로 -0.105 ~ 0.175 범위
  float altFade = 1.0 - clamp((uSunAlt - 0.175) / 0.14, 0.0, 1.0);
  altFade *= 1.0 - clamp((-uSunAlt - 0.105) / 0.07, 0.0, 1.0);
  sunsetStrength *= altFade;

  // 태양을 향한 면(vCosView > 0)에 핑크→주황 스펙트럼 틴트 적용
  // 두꺼운 구름(tau 큼)은 태양 방향 외벽이 선명하게 물드는 효과
  float frontFacing = clamp(vCosView * 0.5 + 0.5, 0.0, 1.0); // 0=역광, 1=순광
  float tintWeight  = frontFacing * sunsetStrength;

  // 광학두께에 따른 틴트 채도 스케일:
  // 얇은 구름(tau<6): 투과가 많아 전체가 물듦 (T가 높음 → 틴트 약화)
  // 두꺼운 구름(tau>20): 앞면만 진하게 물듦
  float thickFactor = clamp((tau - 4.0) / 30.0, 0.0, 1.0); // 0=얇음, 1=두꺼움

  // 노을 색상 팔레트: 태양 고도에 따라 주황(낮은 각도)→핑크(지평선 아래)→마젠타 스펙트럼
  // vBeam의 G/R 비율로 시간대 감지 (황혼 초입엔 오렌지, 박명엔 핑크)
  float greenRatio   = clamp(vBeam.g / max(vBeam.r, 0.001), 0.0, 1.0);
  // greenRatio 높음 = 오렌지/황색, 낮음 = 핑크/마젠타
  vec3 orangeTint = vec3(1.0, 0.55, 0.15);    // 오렌지-적색
  vec3 pinkTint   = vec3(1.0, 0.38, 0.55);    // 핑크-마젠타
  vec3 sunsetTint = mix(pinkTint, orangeTint, greenRatio);

  // 앞면 틴트: 두꺼운 구름은 선명하게, 얇은 구름은 연하게
  float tintMag = tintWeight * mix(0.28, 0.68, thickFactor);

  // ── 면 내 조명 ───────────────────────────────────────────────────────────
  float t = clamp(dot(vSunDir2D, vQuad) * uShadeContrast + 0.5, 0.0, 1.0);

  // 밝은 면: 반사 + 실버라이닝 + 노을 틴트
  vec3 tintedBeam = mix(vBeam, vBeam * sunsetTint * 1.35, tintMag);
  vec3 litCol = tintedBeam * (R + silver) + vAmbient * (1.0 - R) * 0.55;

  // 그늘 면: 통과한 확산광 + 주변 하늘 (그늘도 약하게 노을빛 받음)
  float ambientKeep = 0.30 + T * 0.45;
  float depth = 1.0 - shadowContrast * 0.55;
  // 얇은 구름은 역광 면에도 노을빛이 투과해 물듦
  vec3 shadowBeam = mix(vBeam, vBeam * sunsetTint * 1.1, sunsetStrength * (1.0 - thickFactor) * 0.4);
  vec3 shadowCol = (shadowBeam * T * 0.35 + vAmbient * ambientKeep) * depth;

  // 황혼 자색광
  shadowCol = atm_twilightPurple(shadowCol, uHorizonGlow, uZenithSky, T);

  vec3 col = mix(shadowCol, litCol, t);

  // 가장자리는 광학적으로 얇아 빛이 샙니다. (림라이트도 틴트 색상 반영)
  float rimWidth = mix(0.55, 0.12, rimSharpness);
  float edgeThin = smoothstep(0.85, 0.85 - rimWidth, a);
  col += tintedBeam * edgeThin * silver * 0.6;

  // ── 밤하늘 달빛 및 은은한 대기광 (Night Cloud Airglow Ambient) ───────────────────
  vec3 nightCloudAmbient = vec3(0.014, 0.020, 0.038) * (0.45 + T * 0.55);
  col = max(col, nightCloudAmbient);

  // ── 원경 대기 투시 ───────────────────────────────────────────────────────
  vec3 Tpath = atm_aerialTransmittance(distanceKm, altitudeKm, uBeta, uAngstrom, uElevScale);
  col = col * Tpath + vAmbient * (1.0 - Tpath);

  // 하늘과 같은 톤매핑
  col = 1.0 - exp(-col);
  col = atm_toSrgb(col);

  gl_FragColor = vec4(col, a * vOptics.x);
}
`;


export function createCloudField(atlas: CloudAtlas, capacity: number = 320): CloudField {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.deleteAttribute('normal');

  const addInstanced = (name: string, itemSize: number) => {
    const arr = new Float32Array(capacity * itemSize);
    const attr = new THREE.InstancedBufferAttribute(arr, itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    return attr;
  };

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
      uSunAlt: { value: 0.0 },
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
  mesh.renderOrder = 2; // 지형(0) 및 스카이돔(-1)보다 위에 렌더
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

export function updateCloudField(
  field: CloudField,
  atlas: CloudAtlas,
  instances: CloudInstanceData[],
  sunAzDeg: number,
  sunAltDeg: number,
  env: {
    horizonGlow: { r: number; g: number; b: number };
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
  // 태양 고도 라디안 → 셰이더 노을 틴트 강도 제어
  u.uSunAlt.value = (sunAltDeg * Math.PI) / 180;

  // 원경 구름부터 근경 구름 순서로 뒤에서 앞으로 렌더링 정렬
  const sorted = instances.slice(0, capacity).sort((a, b) => b.distanceKm - a.distanceKm);

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];

    if (c.isOverheadLowCloud && c.worldX !== undefined && c.worldY !== undefined && c.worldZ !== undefined) {
      // 머리 위 3D 대기 공간 좌표 (Overhead 3D World Space)
      _pos.set(c.worldX, c.worldY, c.worldZ);
    } else {
      // 고고도 / 원거리 구름: 스카이돔 구면 좌표계 (Spherical Shell Dome)
      const altRad = (c.elevationDeg * Math.PI) / 180;
      const azRad = (c.azimuthDeg * Math.PI) / 180;
      const radius = c.shellRadius || 430;

      _pos.set(
        radius * Math.cos(altRad) * Math.sin(azRad),
        radius * Math.sin(altRad),
        -radius * Math.cos(altRad) * Math.cos(azRad)
      );
    }
    _mat.makeTranslation(_pos.x, _pos.y, _pos.z);
    mesh.setMatrixAt(i, _mat);

    const rect = atlas.rects.get(c.atlasKey);
    if (rect) {
      uvRect.setXYZW(i, rect.u0, rect.v0, rect.u1, rect.v1);
    } else {
      uvRect.setXYZW(i, 0, 0, 1, 1);
    }

    beam.setXYZ(i, c.beam.r, c.beam.g, c.beam.b);
    ambient.setXYZ(i, c.ambient.r, c.ambient.g, c.ambient.b);

    const azDiff = ((sunAzDeg - c.azimuthDeg + 540) % 360) - 180;
    const sx = Math.sin((azDiff * Math.PI) / 180);
    // 태양 방향 화면 투영도 **그려지는 위치**의 고도각을 써야 합니다.
    // elevationDeg를 쓰면 머리 위 구름의 명암 축이 실제 태양 방향과 어긋납니다.
    const sy = Math.sin(((sunAltDeg - c.lightingElevDeg) * Math.PI) / 180);
    const len = Math.hypot(sx, sy) || 1;

    const sizeX = c.sizeY * c.aspect;
    geom.setXYZW(i, sizeX, c.sizeY, sx / len, sy / len);
    optics.setXYZW(i, c.opacity, 0.0, c.tau, c.distanceKm);
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
