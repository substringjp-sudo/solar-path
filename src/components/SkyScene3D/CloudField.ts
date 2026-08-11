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
import { ATMOSPHERE_GLSL, applyCloudDimming, makeTuningUniforms } from '../../utils/atmosphere';

export interface CloudField {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  capacity: number;
  dispose: () => void;
}

const VERT = `
precision mediump float;

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
precision mediump float;

${ATMOSPHERE_GLSL}

uniform sampler2D uAtlas;
uniform float uShadeContrast;
uniform vec3  uHorizonGlow;  // 지평선 노을빛 — 황혼 자색광 합성용
uniform vec3  uZenithSky;    // 천공 푸른빛 — 황혼 자색광 합성용
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uSunAltDeg;    // 태양 고도 (도) — 눈 순응 노출에 사용
uniform float uSaturation;   // 아트 디렉션용 채도 보정 (하늘과 공유)

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

  // ── 면 내 조명 ───────────────────────────────────────────────────────────
  //
  // 노을 색은 여기서 만들지 않습니다. vBeam은 beamAtAltitude()가 대기 경로로
  // **이미 물리적으로 붉힌** 값이라, 그 위에 다시 주황 틴트를 곱하면 이중 계상입니다.
  // (이전 구현은 태양고도 10°에서 R/B를 2.08 → 3.28로 1.58배 부풀렸습니다.)
  // 또 그 틴트 세기가 clamp((vBeam.r - vBeam.b) * 2.2)로 **정규화되지 않은
  // 절대 복사휘도의 차**여서, 색이 희어도 밝기만 하면 1.0으로 포화했습니다.
  float t = clamp(dot(vSunDir2D, vQuad) * uShadeContrast + 0.5, 0.0, 1.0);

  // 밝은 면: 반사 + 실버라이닝 + 확산 천공광
  vec3 litCol = vBeam * (R + silver) + vAmbient * (1.0 - R) * 0.55;

  // 그늘 면: 통과한 확산광 + 주변 하늘
  //
  // **두께에 실제로 반응해야 합니다.** 예전 식 (0.30 + T*0.45) 은 바닥이 0.30이라,
  // 아무리 두꺼워도 그늘 면이 주변 하늘빛의 30%를 그대로 유지했습니다.
  // 난층운(τ=110, T=0.11)이 0.349, 얇은 권운(τ=5, T=0.73)이 0.627 —
  // **둘 사이가 겨우 1.8배**였습니다. 두꺼운 비구름의 밑면이 어두워질 수가 없어서,
  // 운량을 8/8까지 올려도 "해가 가려진" 느낌이 나지 않았습니다.
  //
  // 바닥을 낮추고 T의 비중을 키웁니다. τ=110 → 0.236, τ=5 → 0.56 (2.4배 차이).
  // 바닥 0.18을 남기는 이유: 완전히 0이면 다층운 사이에서 구름이 검은 구멍처럼
  // 뚫립니다. 실제 두꺼운 구름 밑면도 지면 반사광을 조금은 받습니다.
  float ambientKeep = 0.18 + T * 0.52;
  float depth = 1.0 - shadowContrast * 0.55;
  vec3 shadowCol = (vBeam * T * 0.35 + vAmbient * ambientKeep) * depth;

  // 황혼 자색광 (태양 고도로 게이트 — 한낮에는 작동하지 않습니다)
  shadowCol = atm_twilightPurple(shadowCol, uHorizonGlow, uZenithSky, T, uSunAltDeg);

  vec3 col = mix(shadowCol, litCol, t);

  // 가장자리는 광학적으로 얇아 빛이 샙니다.
  float rimWidth = mix(0.55, 0.12, rimSharpness);
  float edgeThin = smoothstep(0.85, 0.85 - rimWidth, a);
  col += vBeam * edgeThin * silver * 0.6;

  // ── 밤하늘 달빛 및 은은한 대기광 (Night Cloud Airglow Ambient) ───────────────────
  vec3 nightCloudAmbient = vec3(0.014, 0.020, 0.038) * (0.45 + T * 0.55);
  col = max(col, nightCloudAmbient);

  // ── 원경 대기 투시 ───────────────────────────────────────────────────────
  vec3 Tpath = atm_aerialTransmittance(distanceKm, altitudeKm, uBeta, uAngstrom, uElevScale);
  col = col * Tpath + vAmbient * (1.0 - Tpath);

  // 하늘과 **정말로** 같은 톤매핑.
  // 이전에는 주석만 그렇고 실제로는 1-exp(-x)를 써서, 구름만 DISP_EXPO(0.62)와
  // 최대 16× 눈 순응을 건너뛰었습니다. 그래서 박명에 하늘만 밝아지고
  // 구름은 검게 죽었습니다.
  col = atm_display(col, uSaturation, uSunAltDeg);

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
      ...makeTuningUniforms(),
      uAtlas: { value: atlas.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uShadeContrast: { value: 1.35 },
      uHorizonGlow: { value: new THREE.Vector3(0, 0, 0) },
      uZenithSky: { value: new THREE.Vector3(0, 0, 0) },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      uSunAltDeg: { value: 0.0 },
      uSaturation: { value: 1.0 },
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
    /**
     * 구름 기둥의 확산 투과율 (1 = 맑음).
     * 황혼 자색광의 입력(지평선 노을빛·천공빛)도 구름 아래로 들어가면
     * 감광·탈색되어야 합니다. 이걸 빠뜨리면 8/8 일몰에서 구름만 시뻘겋게 남습니다.
     */
    cloudDiffuse?: number;
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

  // 황혼 자색광 입력도 구름층 아래로 넣습니다 (하늘·ambient와 같은 식).
  const dim = env.cloudDiffuse ?? 1;
  const hg = applyCloudDimming(env.horizonGlow, dim);
  const zs = applyCloudDimming(env.zenithSky, dim);
  (u.uHorizonGlow.value as THREE.Vector3).set(hg.r, hg.g, hg.b);
  (u.uZenithSky.value as THREE.Vector3).set(zs.r, zs.g, zs.b);
  u.uBeta.value = env.betaMie;
  u.uAngstrom.value = env.angstrom;
  u.uElevScale.value = env.elevScale;
  // 하늘과 같은 눈 순응 곡선을 타도록 태양 고도를 도 단위로 넘깁니다.
  u.uSunAltDeg.value = sunAltDeg;

  // 원경 구름부터 근경 구름 순서로 뒤에서 앞으로 렌더링 정렬
  const sorted = instances.slice(0, capacity).sort((a, b) => b.distanceKm - a.distanceKm);

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];

    // 구름은 전부 층별 구면 셸 위에 놓입니다.
    // (이전에는 근거리 저층만 별도 월드 좌표로 다시 배치했는데, 그 좌표가
    //  조명에 쓰인 고도각과 어긋나 머리 위 구름이 노을빛을 뒤집어썼습니다.)
    const altRad = (c.elevationDeg * Math.PI) / 180;
    const azRad = (c.azimuthDeg * Math.PI) / 180;
    const radius = c.shellRadius || 430;

    _pos.set(
      radius * Math.cos(altRad) * Math.sin(azRad),
      radius * Math.sin(altRad),
      -radius * Math.cos(altRad) * Math.cos(azRad)
    );
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
