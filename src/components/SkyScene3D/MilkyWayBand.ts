/**
 * MilkyWayBand.ts
 *
 * 은하수를 **띠(band)**로 렌더합니다.
 *
 * Why: 이전 구현은 은하 적도를 따라 점만 찍었습니다. 실제 은하수는 폭이 있는
 * 뿌연 광대(光帶)이고, 궁수자리 방향(은하 중심)이 훨씬 밝고 두꺼우며,
 * 중앙에는 암흑성운에 의한 검은 균열(Great Rift)이 있습니다.
 * 점이나 선으로는 그 어느 것도 표현되지 않습니다.
 *
 * Why 24개 노드 테이블을 안 쓰나: 은하 적도를 15° 간격 표에서 선형보간하면
 * 노드마다 꺾이고, 무엇보다 각 정점의 **은하 경도 l·위도 b를 모릅니다.**
 * l과 b를 모르면 팽대부가 어디인지, Great Rift가 어디에 걸리는지 계산할 수 없어
 * 결국 셰이더에서 눈대중 상수로 때우게 됩니다. 여기서는 은하 좌표계 기저를
 * 적도좌표로 한 번 세워두고 (l, b)에서 직접 정점을 만듭니다 — 정확하고,
 * 매끄럽고, 모든 밝기 항이 실제 은하 경도의 함수가 됩니다.
 *
 * 별과 같은 회전 행렬을 공유하므로 매 프레임 CPU 비용은 0입니다.
 */
import * as THREE from 'three';

const BAND_RADIUS = 468; // 별(470) 바로 안쪽 — 별이 은하수 위에 찍히도록
/** 은하 위도 방향 반폭 (도). 실제 밝기 감쇠는 이보다 좁고, 이 값은 그리는 범위입니다. */
const BAND_HALF_WIDTH_DEG = 20;
/** 은하 경도 방향 분할 (1° 간격) */
const SEGMENTS = 360;
/** 은하 위도 방향 분할 — 가로 단면 감쇠가 각지지 않으려면 넉넉해야 합니다 */
const ROWS = 16;

const VERT = `
precision highp float;

attribute float aLongT;    // 은하 경도 0~1 (노이즈 좌표용)
attribute float aLatDeg;   // 은하 위도 (도)
attribute float aBright;   // 그 경도의 상대 표면 밝기 (CPU에서 계산)
attribute float aWidthDeg; // 그 경도의 밝기 감쇠 폭 (도)

uniform mat3 uEquToHorizon;

varying float vLongT;
varying float vLatDeg;
varying float vBright;
varying float vWidthDeg;
varying float vAltDeg;

void main() {
  vec3 h = uEquToHorizon * normalize(position);
  vLongT = aLongT;
  vLatDeg = aLatDeg;
  vBright = aBright;
  vWidthDeg = aWidthDeg;
  vAltDeg = degrees(asin(clamp(h.y, -1.0, 1.0)));
  gl_Position = projectionMatrix * viewMatrix * vec4(h * ${BAND_RADIUS}.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform float uBrightness;
uniform float uSunAltDeg;
uniform float uMagLimit;   // 하늘 상태 (한계 등급) — 광공해에 가장 먼저 지워집니다

varying float vLongT;
varying float vLatDeg;
varying float vBright;
varying float vWidthDeg;
varying float vAltDeg;

// 값 노이즈 — 은하수의 얼룩덜룩한 성운/암흑대 질감
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  // ── 은하 위도 방향 밝기 감쇠 ──────────────────────────────────────────────
  // 폭이 경도에 따라 달라집니다: 팽대부는 두껍고 반중심 방향은 얇습니다.
  float t = vLatDeg / max(1.0, vWidthDeg);
  float profile = exp(-t * t);

  // ── 얼룩 ────────────────────────────────────────────────────────────────
  // 경도 방향으로 촘촘하고 위도 방향으로도 변해야 세로 줄무늬로 보이지 않습니다.
  // 주파수가 낮으면 확대했을 때 연기처럼 뭉게뭉게 보입니다 — 은하수는 수많은
  // 별의 합이라 훨씬 잘게 얼룩져야 합니다.
  vec2 uv = vec2(vLongT * 260.0, vLatDeg * 0.9);
  float mottle = 0.60 + 0.62 * fbm(uv);
  // 성운 규모의 큰 덩어리는 아주 약하게만 (강하면 연기가 됩니다)
  mottle *= 0.86 + 0.30 * fbm(uv * 0.14 + 11.3);

  // ── Great Rift ──────────────────────────────────────────────────────────
  // 백조자리(l≈80°)에서 궁수자리(l≈0°)까지 이어지는 암흑성운 띠.
  // 은하 적도보다 약간 남쪽(b ≈ -1°)에 놓입니다.
  //
  // 깊이와 폭에 주의: 너무 깊고 넓으면 띠가 **두 줄로 쪼개져** 나란한 리본
  // 두 개처럼 보입니다. 실제 Great Rift는 띠를 갈라놓는 게 아니라 한 줄 안에
  // 어두운 실개천을 낸 정도로 보입니다.
  float riftLon = smoothstep(0.26, 0.19, vLongT) + smoothstep(0.76, 0.83, vLongT);
  float riftLat = exp(-pow((vLatDeg + 1.2) / 2.1, 2.0));
  float rift = 1.0 - 0.40 * riftLat * clamp(riftLon, 0.0, 1.0);

  // ── 관측 조건 ───────────────────────────────────────────────────────────
  // 은하수는 별보다 훨씬 어두워서 박명이 조금만 남아도 사라집니다.
  float night = smoothstep(-10.0, -16.0, uSunAltDeg);
  // 지평선 근처는 대기 소광에 묻힙니다.
  float horizonFade = smoothstep(-1.0, 18.0, vAltDeg);
  // 광공해: 은하수는 별보다 훨씬 먼저 지워집니다. 도시에서 4등성은 보여도
  // 은하수는 전혀 보이지 않는 것이 실제 경험과 맞습니다.
  float pollution = smoothstep(4.8, 6.0, uMagLimit);

  float a = profile * vBright * mottle * rift * night * horizonFade * pollution * uBrightness * 0.095;
  if (a <= 0.002) discard;

  // 수많은 별빛의 합 — 팽대부 쪽은 성간 적색화로 조금 더 따뜻합니다.
  float warm = smoothstep(0.22, 0.0, min(vLongT, 1.0 - vLongT));
  vec3 col = mix(vec3(0.66, 0.72, 0.86), vec3(0.94, 0.88, 0.76), warm);

  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

export interface MilkyWayHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dispose: () => void;
}

// ── 은하 좌표계 기저 (J2000) ────────────────────────────────────────────────
// 북은하극: RA 12h51m26.28s (192.85948°), Dec +27.12825°
// 은하 중심(l=0, b=0): RA 17h45m37.2s (266.405°), Dec −28.936°
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

/**
 * xg = 은하 중심, zg = 북은하극, yg = zg × xg.
 *
 * 위 두 방향은 문헌값을 반올림한 것이라 정확히 직교하지 않습니다(약 0.0001° 어긋남).
 * 그대로 쓰면 기저가 미세하게 비직교가 되므로 극축 성분을 빼서 직교화합니다.
 */
const GAL_Z = fromRaDec(NGP_RA_DEG, NGP_DEC_DEG).normalize();
const GAL_X = (() => {
  const x = fromRaDec(GC_RA_DEG, GC_DEC_DEG);
  return x.addScaledVector(GAL_Z, -x.dot(GAL_Z)).normalize();
})();
const GAL_Y = new THREE.Vector3().crossVectors(GAL_Z, GAL_X).normalize();

/** 은하 좌표 (l, b) → 적도좌표 단위벡터 */
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

/** l을 은하 중심으로부터의 각거리 0~180°로 접습니다 */
function foldLongitude(lDeg: number): number {
  const x = ((lDeg % 360) + 360) % 360;
  return x > 180 ? 360 - x : x;
}

/**
 * 은하 경도별 상대 표면 밝기.
 *
 * 실제 은하수는 균일한 띠가 아닙니다. 궁수자리 방향(l≈0°)의 팽대부가 압도적으로
 * 밝고, 방패-백조 팔 방향(l≈30~80°)이 그 다음, 마차부 쪽 반중심(l=180°)이 가장
 * 어둡습니다. 이 대비가 없으면 하늘을 한 바퀴 두른 균일한 흰 띠가 되어
 * 즉시 가짜처럼 보입니다.
 */
function longitudeBrightness(lDeg: number): number {
  const L = foldLongitude(lDeg);
  const bulge = Math.exp(-Math.pow(L / 26, 2));
  const arm = 0.52 * Math.exp(-Math.pow((L - 55) / 46, 2));
  const base = 0.16 - 0.09 * Math.min(1, Math.max(0, (L - 90) / 90));
  return bulge + arm + base;
}

/** 은하 경도별 밝기 감쇠 폭(도) — 팽대부는 두껍고 반중심은 얇습니다 */
function longitudeWidth(lDeg: number): number {
  const L = foldLongitude(lDeg);
  return 8.5 - 4.6 * Math.min(1, L / 150);
}

export function createMilkyWayBand(): MilkyWayHandle {
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
      uEquToHorizon: { value: new THREE.Matrix3() },
      uBrightness: { value: 1.0 },
      uSunAltDeg: { value: -20 },
      uMagLimit: { value: 6.5 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'milkyWay';
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.6; // 별(-0.5)보다 뒤

  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function updateMilkyWay(
  handle: MilkyWayHandle,
  equToHorizon: THREE.Matrix3,
  sunAltDeg: number,
  brightness: number,
  magLimit: number
): void {
  const u = handle.material.uniforms;
  (u.uEquToHorizon.value as THREE.Matrix3).copy(equToHorizon);
  u.uSunAltDeg.value = sunAltDeg;
  u.uBrightness.value = brightness;
  u.uMagLimit.value = magLimit;
}
