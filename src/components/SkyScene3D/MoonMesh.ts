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
import { seaHorizonDipDeg } from '../../utils/earth';

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
uniform float uParallactic; // 시차각(rad) — 천정 기준 달 북극 회전
varying vec2  vUv;

float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  vec3 q = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(q) * 43758.5453123);
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

// 3D 구면 심리스 2x2x2 격자 기반 원형 크레이터 (림 + 오목한 사발 + 중앙봉)
float craterLayer(vec3 p, float scale, float depth, float hasPeak) {
  vec3 sp = p * scale;
  vec3 base = floor(sp - 0.5);
  float acc = 0.0;
  for (int ix = 0; ix <= 1; ix++) {
    for (int iy = 0; iy <= 1; iy++) {
      for (int iz = 0; iz <= 1; iz++) {
        vec3 cell = base + vec3(float(ix), float(iy), float(iz));
        vec3 h = hash33(cell);
        vec3 center = cell + vec3(0.26) + h * 0.48;
        float r = 0.24 + 0.28 * hash3(cell + 17.3);
        float d = length(sp - center) / r;
        if (d < 1.45) {
          // 오목한 사발 (d < 1) + 바깥 림 융기 (d ~ 0.92..1.35)
          float bowl = -depth * (1.0 - smoothstep(0.0, 0.96, d * d));
          float rim = depth * 0.42 * exp(-pow((d - 0.96) / 0.16, 2.0));
          float peak = hasPeak * depth * 0.36 * exp(-pow(d / 0.17, 2.0));
          acc += bowl + rim + peak;
        }
      }
    }
  }
  return acc;
}

// 개별 원형 크레이터 (지정 위치·반경·깊이)
float singleCrater(vec3 n, vec3 center, float rad, float depth, float hasPeak) {
  float d = length(n - center) / rad;
  if (d > 1.5) return 0.0;
  float bowl = -depth * (1.0 - smoothstep(0.0, 0.96, d * d));
  float rim = depth * 0.45 * exp(-pow((d - 0.96) / 0.15, 2.0));
  float peak = hasPeak * depth * 0.38 * exp(-pow(d / 0.16, 2.0));
  return bowl + rim + peak;
}

// 방사형 분출 광조 (Tycho, Copernicus 등)
float ejectaRays(vec3 n, vec3 c, float rad, float strength) {
  vec3 d = n - c * dot(n, c);
  float dist = length(n - c);
  if (dist > rad || dot(n, c) < 0.0) return 0.0;
  vec3 u = normalize(cross(abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), c));
  vec3 v = cross(c, u);
  float ang = atan(dot(d, v), dot(d, u));
  float rayNoise = 0.5 + 0.5 * sin(ang * 11.0 + noise3(n * 18.0) * 3.2) * cos(ang * 7.0 - 1.1);
  float streaks = smoothstep(0.45, 0.92, rayNoise);
  float falloff = (1.0 - smoothstep(0.03, rad, dist)) * smoothstep(0.015, 0.07, dist);
  float halo = 1.0 - smoothstep(0.0, 0.085, dist);
  return strength * (halo * 0.85 + streaks * falloff * 0.65);
}

// 실제 달 앞면(Nearside) 바다(Mare) 분포와 다중 크기 크레이터 지형
// x: 반사율(albedo), y: 지형 높이(height)
vec2 lunarSurface(vec3 n) {
  vec3 w = vec3(
    fbm3(n * 4.2 + vec3(1.1, 2.3, 0.7)) - 0.5,
    fbm3(n * 4.2 + vec3(5.2, 1.4, 3.8)) - 0.5,
    fbm3(n * 4.2 + vec3(2.9, 6.1, 4.3)) - 0.5
  );
  vec3 nw = normalize(n + w * 0.11);

  // 주요 달의 바다 위치 (월면 경도·위도 근사 단위벡터)
  float m = 0.0;
  // 비의 바다 (Mare Imbrium)
  m = max(m, 1.0 - smoothstep(0.18, 0.34, length(nw - normalize(vec3(-0.23,  0.54,  0.81)))));
  // 평온의 바다 (Mare Serenitatis)
  m = max(m, 1.0 - smoothstep(0.12, 0.24, length(nw - normalize(vec3( 0.27,  0.47,  0.84)))));
  // 고요의 바다 (Mare Tranquillitatis)
  m = max(m, 1.0 - smoothstep(0.13, 0.26, length(nw - normalize(vec3( 0.51,  0.15,  0.85)))));
  // 위난의 바다 (Mare Crisium — 동쪽 독립 타원)
  vec3 dCris = nw - normalize(vec3(0.82, 0.29, 0.49));
  m = max(m, 1.0 - smoothstep(0.08, 0.15, length(dCris * vec3(1.15, 0.92, 1.0))));
  // 풍요의 바다 (Mare Fecunditatis)
  m = max(m, 1.0 - smoothstep(0.11, 0.23, length(nw - normalize(vec3( 0.77, -0.14,  0.62)))));
  // 감로의 바다 (Mare Nectaris)
  m = max(m, 1.0 - smoothstep(0.08, 0.16, length(nw - normalize(vec3( 0.55, -0.26,  0.79)))));
  // 폭풍의 대양 (Oceanus Procellarum — 서쪽 광역)
  m = max(m, (1.0 - smoothstep(0.22, 0.44, length(nw - normalize(vec3(-0.63,  0.31,  0.71))))) * 0.92);
  m = max(m, (1.0 - smoothstep(0.16, 0.34, length(nw - normalize(vec3(-0.61, -0.09,  0.79))))) * 0.85);
  // 구름의 바다 & 습기의 바다 (Mare Nubium / Humorum)
  m = max(m, (1.0 - smoothstep(0.12, 0.24, length(nw - normalize(vec3(-0.27, -0.36,  0.89))))) * 0.86);
  m = max(m, (1.0 - smoothstep(0.08, 0.17, length(nw - normalize(vec3(-0.56, -0.41,  0.72))))) * 0.90);
  // 추위의 바다 (Mare Frigoris — 북쪽 띠)
  vec3 dFrig = nw - normalize(vec3(-0.04, 0.83, 0.56));
  m = max(m, (1.0 - smoothstep(0.07, 0.16, length(dFrig * vec3(0.42, 1.45, 1.0)))) * 0.78);

  float mareTex = fbm3(n * 10.5 + vec3(2.1, 4.3, 1.7));
  float fine = fbm3(n * 24.0 + vec3(3.1, 1.7, 2.4));
  float mare = clamp(m * (0.78 + 0.32 * mareTex), 0.0, 1.0);

  // 대표 실제 크레이터 (Tycho, Copernicus, Kepler, Aristarchus, Plato)
  vec3 cTycho = normalize(vec3(-0.14, -0.68, 0.72));
  vec3 cCop   = normalize(vec3(-0.34,  0.17, 0.92));
  vec3 cKep   = normalize(vec3(-0.61,  0.14, 0.78));
  vec3 cArist = normalize(vec3(-0.67,  0.41, 0.62));
  vec3 cPlato = normalize(vec3(-0.10,  0.78, 0.62));

  float hCrater = 0.0;
  hCrater += singleCrater(n, cTycho, 0.055, 0.55, 1.0);
  hCrater += singleCrater(n, cCop,   0.060, 0.52, 1.0);
  hCrater += singleCrater(n, cKep,   0.032, 0.40, 0.5);
  hCrater += singleCrater(n, cPlato, 0.058, 0.48, 0.0);
  // 다중 스케일 절차적 크레이터 (대형 분지 + 중형 + 미세 크레이터, 고지대에 더 조밀)
  float highlandMask = 1.0 - 0.55 * mare;
  hCrater += craterLayer(n + vec3(0.3, -0.2, 0.5), 7.5,  0.34, 0.8) * highlandMask;
  hCrater += craterLayer(n + vec3(1.7,  2.1, 0.9), 16.0, 0.24, 0.3) * (0.65 + 0.35 * highlandMask);
  hCrater += craterLayer(n + vec3(4.1, -3.3, 2.2), 38.0, 0.14, 0.0);

  float rays = 0.0;
  rays += ejectaRays(n, cTycho, 0.78, 0.38);
  rays += ejectaRays(n, cCop,   0.46, 0.32);
  rays += ejectaRays(n, cKep,   0.26, 0.22);
  rays += (1.0 - smoothstep(0.0, 0.045, length(n - cArist))) * 0.35;

  float platoDark = 1.0 - 0.28 * (1.0 - smoothstep(0.02, 0.048, length(n - cPlato)));
  float highlandAlb = 0.94 + 0.16 * fine;
  float mareAlb = 0.46 + 0.14 * mareTex;
  float albedo = mix(highlandAlb, mareAlb, mare) * platoDark * (0.94 + 0.14 * hCrater) + rays;
  albedo = clamp(albedo, 0.34, 1.25);

  float height = (1.0 - mare) * 0.38 + (fine - 0.5) * 0.14 + hCrater * 0.65;
  return vec2(albedo, height);
}

void main() {
  vec2 st = (vUv - 0.5) * 2.0;
  float r2 = dot(st, st);
  if (r2 > 1.0) discard;

  float d = sqrt(r2);
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 viewN = vec3(st.x, st.y, z);
  vec3 L = normalize(uLightDir);

  // 시차각 회전 적용 (달 본체 좌표 normal)
  float cp = cos(uParallactic);
  float sp = sin(uParallactic);
  vec3 normal = vec3(viewN.x * cp - viewN.y * sp, viewN.x * sp + viewN.y * cp, viewN.z);
  vec3 mL = vec3(L.x * cp - L.y * sp, L.x * sp + L.y * cp, L.z);

  // 고해상도 구면 접평면 법선 요철 (줌인 시 미세 크레이터 경사 음영)
  vec2 surf = lunarSurface(normal);
  float eps = 0.0045;
  vec3 tx = normalize(cross(abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), normal));
  vec3 ty = cross(normal, tx);
  float hX = lunarSurface(normalize(normal + tx * eps)).y - surf.y;
  float hY = lunarSurface(normalize(normal + ty * eps)).y - surf.y;
  vec3 bumpedN = normalize(normal - (tx * (hX / eps) + ty * (hY / eps)) * 0.032);

  // 태양 방향 크레이터 자체 그림자 (4-step 높이장 레이마칭, 터미네이터 부근 극대화)
  vec3 lTan = mL - normal * dot(mL, normal);
  float lTanLen = length(lTan);
  float selfShadow = 1.0;
  float sinElev = max(0.0, dot(normal, mL));
  if (lTanLen > 1e-4 && sinElev > 0.0 && sinElev < 0.72) {
    vec3 lDirT = lTan / lTanLen;
    float raySlope = sinElev / lTanLen;
    float maxOcc = 0.0;
    for (int s = 1; s <= 4; s++) {
      float stepDist = float(s) * 0.011;
      float hAhead = lunarSurface(normalize(normal + lDirT * stepDist)).y;
      float occ = (hAhead - surf.y) * 0.055 - raySlope * stepDist;
      maxOcc = max(maxOcc, occ);
    }
    selfShadow = 1.0 - smoothstep(0.0, 0.006, maxOcc) * 0.90;
  }

  // 달 레골리스 Lommel-Seeliger + Hapke 충효과(Opposition Surge)
  float cosI0 = dot(normal, mL);
  float cosI = max(0.0, dot(bumpedN, mL));
  float cosE = max(0.04, viewN.z);
  float termMask = smoothstep(-0.04, 0.055, cosI0);
  float lommel = (2.0 * cosI) / (cosI + cosE + 0.07);
  float opp = 0.80 + 0.24 * smoothstep(0.55, 1.0, max(0.0, L.z));
  float lit = clamp(lommel * opp * termMask * selfShadow, 0.0, 1.22);

  // 외곽 가장자리 미세 감쇠 + 부드러운 안티앨리어싱
  float limb = 0.90 + 0.10 * cosE;
  float alpha = smoothstep(1.0, max(0.84, 1.0 - uEdgeSoft), d);

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
      uParallactic: { value: 0 },
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

  const elevM = opts?.atmosphere?.observerElevM ?? 0;
  const horizonDipDeg = seaHorizonDipDeg(elevM);
  const rawPos = getMoonPositionPrecise(date, lat, lng, elevM);
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
  material.uniforms.uParallactic.value = Number.isFinite(rawPos.parallacticAngle) ? rawPos.parallacticAngle : 0;

  // FOV 에 맞춘 미세 가장자리 안티앨리어싱 폭 (고배율 줌에서는 선명한 원반 경계 유지)
  if (fovDeg != null && Number.isFinite(fovDeg)) {
    material.uniforms.uEdgeSoft.value = Math.min(0.14, Math.max(0.008, (fovDeg / 67) * 0.06));
  }

  // 대기 투과 색(월출/월몰 주황~고고도 은백) 및 낮/밤 지구조(Earthshine) 조절
  const brightCol = material.uniforms.uColorBright.value as THREE.Color;
  if (opts?.atmosphere) {
    const beamM = beamAtAltitude(moonAltDeg + horizonDipDeg, 0, opts.atmosphere);
    const mMax = Math.max(beamM.r, beamM.g, beamM.b, 1e-6);
    const tintR = beamM.r / mMax;
    const tintG = beamM.g / mMax;
    const tintB = beamM.b / mMax;
    const atten =
      Math.min(1, 0.34 + 0.66 * Math.pow(Math.min(1, mMax / 0.75), 0.5)) *
      Math.min(1, Math.max(0, (moonAltDeg + horizonDipDeg + 0.35) / 0.9));
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
