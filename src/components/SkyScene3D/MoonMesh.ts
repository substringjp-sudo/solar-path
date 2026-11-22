/**
 * MoonMesh.ts
 *
 * 달의 실제 물리 각반지름(0.259°, 시직경 ~0.518°)으로 카메라 화각과 1:1 일치시키며,
 * 태양→달 실제 3D 방향 벡터 투영 · Lommel-Seeliger 구면 산란 · 3D 구면 바다/분화구 질감 ·
 * AdditiveBlending 기반 대기 투과/지구조(Earthshine)를 적용합니다.
 */
import * as THREE from 'three';
import { getMoonPosition, getSunPosition } from '../../utils/celestial';
import { getMoonPositionPrecise } from '../../utils/moonPosition';
import { beamAtAltitude, type AtmosphereParams } from '../../utils/atmosphere';

/** 태양(0.267°)과 동일한 순수 각반지름 기준(실제 평균 각반지름 0.259°, 시직경 ~0.518°) */
export const MOON_ANGULAR_RADIUS_DEG = 0.259;
const MOON_DISTANCE = 490;
const SUN_DISTANCE_KM = 149_598_000;

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz += cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = `
precision highp float;

uniform vec3  uLightDir;    // 달 원반 로컬 좌표 기준 달→태양 단위벡터 (+X=오른쪽, +Y=위, +Z=관측자 쪽)
uniform vec3  uColorBright; // 대기 투과·고도 반영 햇빛 면 색 (Additive)
uniform vec3  uEarthshine;  // 밤 하늘 어두운 면 은은한 지구반사광 (낮에는 0)
uniform float uEdgeSoft;    // 가장자리 안티앨리어싱 폭
varying vec2  vUv;

float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * noise3(p);
    p = p * 2.07 + vec3(1.3, 2.1, 0.7);
    a *= 0.5;
  }
  return s;
}

// 3D 구면 법선 기반 달 표면 반사율(albedo)과 기복 높이(relief)
vec2 lunarSurface(vec3 n) {
  vec3 q = n * 2.4 + vec3(0.6, -0.3, 1.2);
  float warp = fbm3(q * 0.9);
  float basin = fbm3(q + warp * 0.85);
  float fine = fbm3(n * 8.5 + vec3(3.1, 1.7, 2.4));
  // 어두운 현무암 바다(Mare)와 밝은 고지대 대비 (외곽에서도 구체 곡면 원근이 유지됨)
  float mare = smoothstep(0.41, 0.64, basin * 0.72 + fine * 0.28);
  // 다중 크기 분화구 림·함몰 패턴
  float cA = abs(noise3(n * 11.0 + 4.2) - 0.5) * 2.0;
  float cB = abs(noise3(n * 21.0 + 9.1) - 0.5) * 2.0;
  float craterBowl = smoothstep(0.18, 0.65, cA) * 0.55 + smoothstep(0.15, 0.6, cB) * 0.45;
  float albedo = mix(0.56, 1.02, mare) * (0.86 + 0.18 * fine) * (0.90 + 0.12 * craterBowl);
  float relief = mare * 0.35 + fine * 0.45 - (1.0 - craterBowl) * 0.35;
  return vec2(albedo, relief);
}

void main() {
  vec2 st = (vUv - 0.5) * 2.0;
  float r2 = dot(st, st);
  if (r2 > 1.0) discard;

  float d = sqrt(r2);
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 normal = vec3(st.x, st.y, z);
  vec3 L = normalize(uLightDir);

  // 표면 기복 기울기로 터미네이터(명암 경계) 법선 미세 요철 계산 (구면 위 접평면 미분)
  vec2 surf = lunarSurface(normal);
  float eps = 0.025;
  vec3 nDx = normalize(normal + vec3(eps, 0.0, 0.0));
  vec3 nDy = normalize(normal + vec3(0.0, eps, 0.0));
  float hX = lunarSurface(nDx).y - surf.y;
  float hY = lunarSurface(nDy).y - surf.y;
  vec3 bumpedN = normalize(normal + vec3(-hX, -hY, 0.0) * 1.6);

  // 달 레골리스 Lommel-Seeliger 구면 산란 + 충효과(Opposition Surge)
  float cosI0 = dot(normal, L);
  float cosI = max(0.0, dot(bumpedN, L));
  float cosE = max(0.04, normal.z);
  float termMask = smoothstep(-0.045, 0.065, cosI0);
  float lommel = (2.0 * cosI) / (cosI + cosE + 0.07);
  float opp = 0.80 + 0.24 * smoothstep(0.55, 1.0, max(0.0, L.z));
  float lit = clamp(lommel * opp * termMask, 0.0, 1.15);

  // 외곽 가장자리 미세 감쇠 + 부드러운 안티앨리어싱
  float limb = 0.90 + 0.10 * cosE;
  float alpha = smoothstep(1.0, max(0.82, 1.0 - uEdgeSoft), d);

  vec3 bright = uColorBright * surf.x * lit * limb;
  vec3 dark = uEarthshine * (0.72 + 0.28 * surf.x) * (1.0 - clamp(lit * 1.2, 0.0, 1.0));
  vec3 finalCol = (bright + dark) * alpha;

  gl_FragColor = vec4(finalCol, 1.0);
}
`;

export interface MoonHandle {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  dispose: () => void;
}

export interface MoonUpdateOptions {
  atmosphere?: AtmosphereParams;
  sunAltDeg?: number;
  fovDeg?: number;
}

/**
 * 실제 3D 태양·달 위치로 달 원반 로컬 기저(+X=화면 오른쪽, +Y=위, +Z=관측자 쪽) 기준 달→태양 단위벡터 계산
 */
export function computeMoonLocalLightDir(
  date: Date,
  lat: number,
  lng: number,
  precomputedMoonPos?: { azimuth: number; altitude: number; distanceKm?: number },
): THREE.Vector3 {
  const mp: { azimuth: number; altitude: number; distanceKm?: number } =
    precomputedMoonPos ?? getMoonPosition(date, lat, lng);
  const sp = getSunPosition(date, lat, lng);

  const mAlt = (mp.altitude * Math.PI) / 180;
  const mAz = (mp.azimuth * Math.PI) / 180;
  const moonDir = new THREE.Vector3(
    Math.cos(mAlt) * Math.sin(mAz),
    Math.sin(mAlt),
    -Math.cos(mAlt) * Math.cos(mAz),
  ).normalize();

  const sAlt = (sp.altitude * Math.PI) / 180;
  const sAz = (sp.azimuth * Math.PI) / 180;
  const sunDir = new THREE.Vector3(
    Math.cos(sAlt) * Math.sin(sAz),
    Math.sin(sAlt),
    -Math.cos(sAlt) * Math.cos(sAz),
  ).normalize();

  const parallax = (mp.distanceKm ?? 384_400) / SUN_DISTANCE_KM;
  const moonToSun = sunDir.addScaledVector(moonDir, -parallax).normalize();

  // group.lookAt(0, 0, 0) 와 동일한 원반 로컬 기저 (+Z=관측자 쪽, +X=오른쪽, +Y=위)
  const front = moonDir.clone().negate();
  const worldUp = Math.hypot(moonDir.x, moonDir.z) > 1e-5
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3().crossVectors(worldUp, front).normalize();
  const upDisk = new THREE.Vector3().crossVectors(front, right).normalize();

  return new THREE.Vector3(
    moonToSun.dot(right),
    moonToSun.dot(upDisk),
    moonToSun.dot(front),
  ).normalize();
}

/**
 * 3D 스카이씬 달 메쉬 및 위상 셰이더 생성
 */
export function createMoonGroup(): MoonHandle {
  const group = new THREE.Group();
  group.name = 'moonGroup';

  // 순수 각반지름(0.259°) 기반 기하 크기 (화면 비율 배율 없음)
  const radius = MOON_DISTANCE * Math.tan((MOON_ANGULAR_RADIUS_DEG * Math.PI) / 180);
  const moonGeo = new THREE.PlaneGeometry(radius * 2, radius * 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: { value: new THREE.Vector3(0, 0, 1) },
      uColorBright: { value: new THREE.Color(0xf4f3ef) },
      uEarthshine: { value: new THREE.Color(0x090f1d) },
      uEdgeSoft: { value: 0.08 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const moonMesh = new THREE.Mesh(moonGeo, material);
  moonMesh.name = 'moonDisk';
  // 지면(-0.45) 및 지형(-0.48)보다 뒤에 그려져 일출/월몰 시 지형 뒤로 가려지도록 설정
  moonMesh.renderOrder = -0.55;
  moonMesh.frustumCulled = false;
  group.add(moonMesh);

  return {
    group,
    material,
    dispose: () => {
      moonGeo.dispose();
      material.dispose();
    },
  };
}

/**
 * 실시간 달 위치 · 3D 태양 기준 위상 · 대기 소광 색 갱신
 */
export function updateMoonPosition(
  moonHandle: MoonHandle,
  date: Date,
  lat: number,
  lng: number,
  fovDegOrOpts?: number | MoonUpdateOptions,
  optsMaybe?: MoonUpdateOptions,
): void {
  const { group, material } = moonHandle;
  const opts: MoonUpdateOptions | undefined =
    typeof fovDegOrOpts === 'object' ? fovDegOrOpts : optsMaybe;
  const fovDeg = typeof fovDegOrOpts === 'number' ? fovDegOrOpts : opts?.fovDeg;

  const rawPos = getMoonPositionPrecise(date, lat, lng);
  const moonAltDeg = (rawPos.altitude * 180) / Math.PI;
  const moonAzDeg = (rawPos.azimuth * 180) / Math.PI + 180;

  const altRad = rawPos.altitude;
  const azRad = (moonAzDeg * Math.PI) / 180;

  // 3D 구면 좌표계 변환 (Y=up, -Z=North, X=East)
  const x = MOON_DISTANCE * Math.cos(altRad) * Math.sin(azRad);
  const y = MOON_DISTANCE * Math.sin(altRad);
  const z = -MOON_DISTANCE * Math.cos(altRad) * Math.cos(azRad);

  group.position.set(x, y, z);
  group.lookAt(0, 0, 0);
  // 카메라 화각과 1:1 비교 가능한 고정 물리 각반지름(0.259°)
  group.scale.setScalar(1);

  // 달 원반(-4.5° 이하, 고도 상승 시 수평선 낙차 감안) 완전히 지평선 아래로 내려가면 숨김
  group.visible = moonAltDeg > -4.5;

  const localLight = computeMoonLocalLightDir(date, lat, lng, {
    azimuth: moonAzDeg,
    altitude: moonAltDeg,
    distanceKm: rawPos.distance,
  });
  (material.uniforms.uLightDir.value as THREE.Vector3).copy(localLight);

  // FOV 에 맞춘 미세 가장자리 안티앨리어싱 폭
  if (fovDeg != null && Number.isFinite(fovDeg)) {
    material.uniforms.uEdgeSoft.value = Math.min(0.16, Math.max(0.04, (fovDeg / 67) * 0.08));
  }

  // 대기 투과 색(월출/월몰 주황~고고도 은백) 및 낮/밤 지구조(Earthshine) 조절
  const brightCol = material.uniforms.uColorBright.value as THREE.Color;
  if (opts?.atmosphere) {
    const beamM = beamAtAltitude(moonAltDeg, 0, opts.atmosphere);
    const mMax = Math.max(beamM.r, beamM.g, beamM.b, 1e-6);
    const tintR = beamM.r / mMax;
    const tintG = beamM.g / mMax;
    const tintB = beamM.b / mMax;
    const atten =
      Math.min(1, 0.34 + 0.66 * Math.pow(Math.min(1, mMax / 0.75), 0.5)) *
      Math.min(1, Math.max(0, (moonAltDeg + 0.35) / 0.9));
    // 달 자체 고유 반사색(중성 은백)과 대기 투과 색 결합
    brightCol.setRGB(
      0.97 * (0.25 + 0.75 * tintR) * atten,
      0.96 * (0.22 + 0.78 * tintG) * atten,
      0.93 * (0.18 + 0.82 * tintB) * atten,
    );
  } else {
    const atten = Math.min(1, Math.max(0.15, (moonAltDeg + 0.4) / 3.0));
    brightCol.setRGB(0.96 * atten, 0.95 * atten, 0.92 * atten);
  }

  // 지구조(Earthshine)는 밤에만 은은히 더함 — 낮·박명 하늘에는 0이라 어두운 원판 스티커가 생기지 않음
  const sunAlt = opts?.sunAltDeg;
  const nightW = sunAlt == null
    ? 0.4
    : Math.min(1, Math.max(0, (-3.5 - sunAlt) / 5.5));
  const esCol = material.uniforms.uEarthshine.value as THREE.Color;
  esCol.setRGB(0.016 * nightW, 0.025 * nightW, 0.044 * nightW);
}
