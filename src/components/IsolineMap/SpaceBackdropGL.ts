/**
 * SpaceBackdropGL.ts — 우주 모드 전용 WebGL 심우주 배경 (은하수 · 6.5등급 8,355개 항성 · 5대 행성).
 *
 * - 은하수는 J2000 은하좌표 (l, b) 기저로 360° 고리 메시를 생성하고, 궁수자리 팽대부,
 *   방패-백조 나선팔, Great Rift 암흑성운 균열, 고주파 성운 얼룩을 셰이더로 표현합니다.
 * - 별과 행성은 포그슨 광속비(10^-0.4m)와 카메라 동적 노출(uExposure), 태양 주변 글레어
 *   감쇠를 적용해 실제 우주 카메라 촬영 특성에 가깝게 보입니다.
 */
import * as THREE from 'three';
import { getStarCatalog, bvToLinearRGB, STAR_MAG_LIMIT } from '../../utils/starCatalog';
import { getGMSTDeg } from '../../utils/celestialCoords';
import { PLANETS_METADATA, getPlanetEquatorialCoord, type PlanetKey } from '../../utils/celestialPlanets';

const BAND_RADIUS = 468;
const STAR_RADIUS = 470;
const BAND_HALF_WIDTH_DEG = 24;
const SEGMENTS = 360;
const ROWS = 20;

const NGP_RA_DEG = 192.85948;
const NGP_DEC_DEG = 27.12825;
const GC_RA_DEG = 266.405;
const GC_DEC_DEG = -28.936;

function fromRaDec(raDeg: number, decDeg: number): THREE.Vector3 {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cd = Math.cos(dec);
  return new THREE.Vector3(cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec));
}

const GAL_Z = fromRaDec(NGP_RA_DEG, NGP_DEC_DEG).normalize();
const GAL_X = (() => {
  const x = fromRaDec(GC_RA_DEG, GC_DEC_DEG);
  return x.addScaledVector(GAL_Z, -x.dot(GAL_Z)).normalize();
})();
const GAL_Y = new THREE.Vector3().crossVectors(GAL_Z, GAL_X).normalize();

function galacticToEquatorial(lDeg: number, bDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  const cb = Math.cos(b);
  return out
    .set(0, 0, 0)
    .addScaledVector(GAL_X, cb * Math.cos(l))
    .addScaledVector(GAL_Y, cb * Math.sin(l))
    .addScaledVector(GAL_Z, Math.sin(b))
    .normalize();
}

function foldLongitude(lDeg: number): number {
  const x = ((lDeg % 360) + 360) % 360;
  return x > 180 ? 360 - x : x;
}

function longitudeBrightness(lDeg: number): number {
  const L = foldLongitude(lDeg);
  const bulge = Math.exp(-Math.pow(L / 20, 2));
  const arm = 0.52 * Math.exp(-Math.pow((L - 60) / 44, 2));
  const carina = 0.34 * Math.exp(-Math.pow((L - 288 > 0 ? L - 288 : foldLongitude(lDeg - 288)) / 26, 2));
  const base = 0.16 - 0.09 * Math.min(1, Math.max(0, (L - 90) / 90));
  return bulge + arm + carina * 0.55 + base;
}

function longitudeWidth(lDeg: number): number {
  const L = foldLongitude(lDeg);
  return 9.2 - 4.8 * Math.min(1, L / 150);
}

/**
 * J2000 적도 단위벡터 -> 지구본 카메라 공간(X=우, Y=상, Z=카메라쪽) 3x3 회전 행렬.
 * EarthGlobeGL의 camDirOf / MapGlobe의 투영과 1:1로 일치합니다.
 */
export function computeEqToCamMatrix(
  date: Date,
  rotate: readonly [number, number] | readonly [number, number, number],
  out: THREE.Matrix3,
): THREE.Matrix3 {
  const RAD = Math.PI / 180;
  const gmst = getGMSTDeg(date) * RAD;
  const sinG = Math.sin(gmst);
  const cosG = Math.cos(gmst);

  const r0 = rotate[0] * RAD;
  const r1 = rotate[1] * RAD;
  const r2 = (rotate[2] ?? 0) * RAD;
  const c0 = Math.cos(r0);
  const s0 = Math.sin(r0);
  const c1 = Math.cos(r1);
  const s1 = Math.sin(r1);
  const c2 = Math.cos(r2);
  const s2 = Math.sin(r2);

  const xformBasis = (ex: number, ey: number, ez: number): [number, number, number] => {
    const gx = -sinG * ex + cosG * ey;
    const gy = ez;
    const gz = cosG * ex + sinG * ey;

    const sx = gx * c0 + gz * s0;
    const sz0 = -gx * s0 + gz * c0;
    const sy0 = c1 * gy + s1 * sz0;
    const sz = -s1 * gy + c1 * sz0;

    return [sx * c2 - sy0 * s2, sx * s2 + sy0 * c2, sz];
  };

  const cX = xformBasis(1, 0, 0);
  const cY = xformBasis(0, 1, 0);
  const cZ = xformBasis(0, 0, 1);

  out.set(
    cX[0], cY[0], cZ[0],
    cX[1], cY[1], cZ[1],
    cX[2], cY[2], cZ[2],
  );
  return out;
}

const MW_VERT = /* glsl */ `
precision highp float;

attribute float aLongT;
attribute float aLatDeg;
attribute float aBright;
attribute float aWidthDeg;

uniform mat3 uEqToCam;

varying float vLongT;
varying float vLatDeg;
varying float vBright;
varying float vWidthDeg;
varying vec3 vCamDir;

void main() {
  vec3 c = normalize(uEqToCam * normalize(position));
  vLongT = aLongT;
  vLatDeg = aLatDeg;
  vBright = aBright;
  vWidthDeg = aWidthDeg;
  vCamDir = c;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c * ${BAND_RADIUS}.0, 1.0);
}
`;

const MW_FRAG = /* glsl */ `
precision highp float;

uniform float uExposure;
uniform float uOpacity;
uniform vec3 uSunCamDir;
uniform float uSunVisible;

varying float vLongT;
varying float vLatDeg;
varying float vBright;
varying float vWidthDeg;
varying vec3 vCamDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  if (uOpacity <= 0.005) discard;

  float t = vLatDeg / max(1.0, vWidthDeg);
  float profile = exp(-t * t);

  // 고주파 성운 · 미분해 별빛 입자감 + 중규모 성운 덩어리
  vec2 uv = vec2(vLongT * 280.0, vLatDeg * 1.1);
  float mottle = 0.56 + 0.68 * fbm(uv);
  mottle *= 0.85 + 0.34 * fbm(uv * 0.14 + 11.3);
  float grain = 0.88 + 0.24 * noise(uv * 2.8 + 4.1);
  mottle *= grain;

  // Great Rift 암흑성운 균열 (백조자리 l≈80° ~ 궁수자리 l≈20°) + 미세 암흑 필라멘트
  float riftCore = smoothstep(0.04, 0.18, vLongT) * smoothstep(0.96, 0.82, vLongT);
  float riftShell = smoothstep(0.18, 0.10, vLongT) + smoothstep(0.82, 0.90, vLongT);
  float riftLon = max(riftCore, riftShell * 0.55);
  float riftWarp = (fbm(vec2(vLongT * 42.0, vLatDeg * 0.35)) - 0.5) * 2.4;
  float riftLat = exp(-pow((vLatDeg + 1.1 + riftWarp) / 2.2, 2.0));
  float rift = 1.0 - 0.54 * riftLat * clamp(riftLon, 0.0, 1.0);

  // 태양 주변 글레어 감쇠 (태양이 시야에 있을 때 주변 은하수 묻힘)
  float sunCos = dot(normalize(vCamDir), normalize(uSunCamDir));
  float sunGlareFade = 1.0 - uSunVisible * smoothstep(0.90, 0.996, sunCos) * 0.85;

  float expGain = clamp(uExposure, 0.15, 1.5);
  float a = profile * vBright * mottle * rift * expGain * sunGlareFade * uOpacity * 0.135;
  if (a <= 0.002) discard;

  float warm = smoothstep(0.14, 0.0, min(vLongT, 1.0 - vLongT));
  vec3 col = mix(vec3(0.62, 0.72, 0.92), vec3(0.98, 0.88, 0.72), warm);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

export interface SpaceMilkyWayHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dispose: () => void;
}

export function createSpaceMilkyWay(): SpaceMilkyWayHandle {
  const positions: number[] = [];
  const longT: number[] = [];
  const latDeg: number[] = [];
  const bright: number[] = [];
  const widthDeg: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();

  for (let c = 0; c <= SEGMENTS; c++) {
    const t = c / SEGMENTS;
    const l = t * 360;
    const w = longitudeBrightness(l);
    const sigma = longitudeWidth(l);
    for (let r = 0; r <= ROWS; r++) {
      const b = ((r / ROWS) * 2 - 1) * BAND_HALF_WIDTH_DEG;
      galacticToEquatorial(l, b, v);
      positions.push(v.x, v.y, v.z);
      longT.push(t);
      latDeg.push(b);
      bright.push(w);
      widthDeg.push(sigma);
    }
  }

  const stride = ROWS + 1;
  for (let c = 0; c < SEGMENTS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const a = c * stride + r;
      const bIdx = (c + 1) * stride + r;
      indices.push(a, bIdx, a + 1, bIdx, bIdx + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLongT', new THREE.Float32BufferAttribute(longT, 1));
  geometry.setAttribute('aLatDeg', new THREE.Float32BufferAttribute(latDeg, 1));
  geometry.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1));
  geometry.setAttribute('aWidthDeg', new THREE.Float32BufferAttribute(widthDeg, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uEqToCam: { value: new THREE.Matrix3() },
      uExposure: { value: 1.0 },
      uOpacity: { value: 1.0 },
      uSunCamDir: { value: new THREE.Vector3(0, 0, 1) },
      uSunVisible: { value: 0.0 },
    },
    vertexShader: MW_VERT,
    fragmentShader: MW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;

  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

const STAR_VERT = /* glsl */ `
precision highp float;

attribute float aMag;
attribute vec3 aColor;
attribute float aKind;

uniform mat3 uEqToCam;
uniform float uExposure;
uniform float uOpacity;
uniform float uPixelRatio;
uniform vec3 uSunCamDir;
uniform float uSunVisible;

varying vec3 vColor;
varying float vAlpha;
varying float vBright;

void main() {
  vec3 c = normalize(uEqToCam * normalize(position));

  // 카메라 앞(-Z) 반구만 투영
  if (c.z > 0.08 || uOpacity <= 0.005 || aMag > 15.0) {
    vAlpha = 0.0;
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // 포그슨 광속비(1등급당 2.512배) + 카메라 동적 노출(uExposure) 압축
  float flux = pow(10.0, -0.4 * (aMag - 1.5));
  float exposed = flux * uExposure;
  float tone = exposed / (1.0 + exposed * 0.48);

  // 노출에 따른 한계 등급 컷오프: 밝은 지구/태양 노출 시 어두운 별(2.5등 이하)부터 소거
  float effMagLimit = clamp(4.8 + log2(max(0.08, uExposure)) * 1.45, 2.2, ${STAR_MAG_LIMIT.toFixed(1)} + 0.2);
  float limitFade = smoothstep(effMagLimit + 0.5, effMagLimit - 0.6, aMag);

  // 태양 주변 렌즈 글레어 억제
  float sunCos = dot(c, normalize(uSunCamDir));
  float sunGlareFade = 1.0 - uSunVisible * smoothstep(0.92, 0.995, sunCos) * 0.92;

  float vis = clamp(pow(tone, 0.68) * limitFade * sunGlareFade * uOpacity, 0.0, 1.0);
  vAlpha = vis;
  vBright = clamp(tone, 0.0, 1.0);
  vColor = mix(aColor, vec3(1.0), clamp(tone * 0.55, 0.0, 0.72));

  float baseSize = 1.15 + 2.65 * pow(vis, 0.58) + aKind * 0.45;
  gl_PointSize = clamp(baseSize * uPixelRatio, 1.0, 9.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c * ${STAR_RADIUS}.0, 1.0);
}
`;

const STAR_FRAG = /* glsl */ `
precision highp float;

varying vec3 vColor;
varying float vAlpha;
varying float vBright;

void main() {
  if (vAlpha <= 0.004) discard;

  vec2 d = (gl_PointCoord - 0.5) * 2.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;

  // 가우시안 광학 PSF 코어 + 미세한 색 헤일로
  float core = exp(-r2 * 6.5);
  float halo = exp(-r2 * 1.8) * 0.28;
  float spike = 0.0;
  if (vBright > 0.72) {
    float sx = exp(-abs(d.y) * 10.0) * exp(-abs(d.x) * 2.4);
    float sy = exp(-abs(d.x) * 10.0) * exp(-abs(d.y) * 2.4);
    spike = (sx + sy) * (vBright - 0.72) * 1.1;
  }

  float a = clamp(vAlpha * (core + halo + spike), 0.0, 1.0);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

export interface SpaceStarFieldHandle {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  starCount: number;
  lastPlanetKey: string;
  dispose: () => void;
}

const PLANET_COLORS: Record<PlanetKey, [number, number, number]> = {
  mercury: [1.0, 0.94, 0.85],
  venus: [1.0, 0.97, 0.90],
  mars: [1.0, 0.58, 0.36],
  jupiter: [1.0, 0.92, 0.78],
  saturn: [1.0, 0.89, 0.68],
};

export function createSpaceStarField(maxPlanets = 8): SpaceStarFieldHandle {
  const cat = getStarCatalog();
  const total = cat.count + maxPlanets;
  const positions = new Float32Array(total * 3);
  const mags = new Float32Array(total);
  const colors = new Float32Array(total * 3);
  const kinds = new Float32Array(total);

  for (let i = 0; i < cat.count; i++) {
    const raRad = (cat.raHours[i] / 24) * Math.PI * 2;
    const decRad = (cat.decDeg[i] * Math.PI) / 180;
    const cd = Math.cos(decRad);
    positions[i * 3] = cd * Math.cos(raRad);
    positions[i * 3 + 1] = cd * Math.sin(raRad);
    positions[i * 3 + 2] = Math.sin(decRad);
    mags[i] = cat.magnitude[i];
    const [r, g, b] = bvToLinearRGB(cat.colorIndex[i]);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    kinds[i] = 0;
  }
  for (let i = cat.count; i < total; i++) {
    mags[i] = 99;
    kinds[i] = 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uEqToCam: { value: new THREE.Matrix3() },
      uExposure: { value: 1.0 },
      uOpacity: { value: 1.0 },
      uPixelRatio: { value: 1.0 },
      uSunCamDir: { value: new THREE.Vector3(0, 0, 1) },
      uSunVisible: { value: 0.0 },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;

  return {
    points,
    material,
    starCount: cat.count,
    lastPlanetKey: '',
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function updateSpacePlanets(handle: SpaceStarFieldHandle, date: Date): void {
  // 행성 위치는 6시간 단위로 캐시 갱신 (성능 최적화)
  const key = String(Math.floor(date.getTime() / (6 * 3600000)));
  if (key === handle.lastPlanetKey) return;
  handle.lastPlanetKey = key;

  const geo = handle.points.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const mag = geo.getAttribute('aMag') as THREE.BufferAttribute;
  const col = geo.getAttribute('aColor') as THREE.BufferAttribute;
  const capacity = pos.count - handle.starCount;
  const planetKeys = Object.keys(PLANETS_METADATA) as PlanetKey[];

  for (let i = 0; i < capacity; i++) {
    const idx = handle.starCount + i;
    const pKey = planetKeys[i];
    if (!pKey) {
      mag.setX(idx, 99);
      continue;
    }
    const eq = getPlanetEquatorialCoord(pKey, date);
    const raRad = (eq.raHours / 24) * Math.PI * 2;
    const decRad = (eq.decDeg * Math.PI) / 180;
    const cd = Math.cos(decRad);
    pos.setXYZ(idx, cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad));
    mag.setX(idx, PLANETS_METADATA[pKey].magnitude);
    const [r, g, b] = PLANET_COLORS[pKey];
    col.setXYZ(idx, r, g, b);
  }
  pos.needsUpdate = true;
  mag.needsUpdate = true;
  col.needsUpdate = true;
}
