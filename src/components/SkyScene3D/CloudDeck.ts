/**
 * CloudDeck.ts
 *
 * 층별 **연속 구름층(deck)** 을 돔 캡 메시로 그립니다.
 *
 * Why 빌보드만으로는 안 되나: 빌보드는 개별 스프라이트라 아무리 많이 뿌려도
 * 경계가 보이는 조각들이지 이어진 구름층이 되지 않습니다. 그런데 흐린 날의
 * 핵심 실루엣은 바로 그 "이어짐"입니다.
 *
 * 기상학의 옥타 척도가 그대로 렌더 전략이 됩니다:
 *
 *   0~1/8 SKC/FEW  고립된 적운          → 빌보드만
 *   2~4/8 SCT      적운 field           → 빌보드, 간격 좁게
 *   5~7/8 BKN      적운→층적운 병합 시작 → 빌보드 + 덱 알파 램프 인
 *     8/8 OVC      층운/난층운          → 덱이 주체
 *
 * 물리적 근거: 적운 field에서 구름 지름 D, 간격 L일 때 운량 ≈ (D/L)².
 * 운량이 0.5를 넘으면 개별 적운이 서로 닿기 시작하고, 이것이 실제
 * 적운→층적운 전이입니다. mergeFactor 하나로 두 표현을 잇습니다.
 */
import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from '../../utils/atmosphere';
import {
  LAYER_ALTITUDE_KM,
  elevationGrid,
  type LayerKey,
  type LayerSample,
} from '../../utils/skyColumn';

/** 층별 덱 반지름 — 빌보드 셸 바로 안쪽에 둡니다. */
const DECK_RADIUS: Record<LayerKey, number> = {
  low: 396,
  mid: 426,
  high: 456,
};

/** 덱 메시 해상도 (방위 × 고도). 샘플 격자보다 촘촘해야 보간이 매끄럽습니다. */
const MESH_AZ = 72;
const MESH_ELEV = 32;

const VERT = `
precision highp float;

attribute float aCover;      // 이 방향 층 운량 0~1
attribute float aElevDeg;
attribute float aAzDeg;

varying float vCover;
varying float vElevDeg;
varying float vAzDeg;
varying vec3  vDir;

void main() {
  vCover   = aCover;
  vElevDeg = aElevDeg;
  vAzDeg   = aAzDeg;
  vDir     = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

uniform vec3  uBeam;        // 이 층 고도에서의 직달광 (위층 감쇠 반영됨)
uniform vec3  uAmbientUp;   // 덱 윗면이 받는 하늘빛
uniform vec3  uAmbientDown; // 덱 아랫면 주변 확산광
uniform vec3  uSunDir;
uniform float uTau;         // 층 대표 광학두께
uniform float uShadowContrast;
uniform float uSunAltDeg;
uniform float uSaturation;
uniform float uOpacity;     // 레이어 전체 페이드
uniform float uTime;        // 바람에 따른 무늬 이동

varying float vCover;
varying float vElevDeg;
varying float vAzDeg;
varying vec3  vDir;

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
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
  return v;
}

void main() {
  // ── 병합 계수 ───────────────────────────────────────────────────────────
  // 0.45 아래에서는 덱이 아예 없습니다(개별 적운의 영역).
  // 0.85 위에서 완전히 닫힙니다(OVC).
  float merge = smoothstep(0.45, 0.85, vCover);
  if (merge <= 0.001) discard;

  // ── 덱 무늬 ────────────────────────────────────────────────────────────
  // 덱을 평면에 투영해 노이즈를 읽습니다. 고도각이 낮을수록 원근으로 늘어나
  // 자연스럽게 지평선 쪽이 촘촘해집니다.
  //
  // 투영은 **유계**여야 합니다.
  //
  // 처음엔 cot(ε)로 지면에 투영했는데, 그러면 고도각이 낮을수록 UV가 발산해
  // 노이즈 셀을 한 프래그먼트 안에서 여러 개 가로지릅니다. 결과는 지평선 쪽에
  // 부채꼴로 퍼지는 세로 줄무늬였습니다(측정: 해당 영역 가로 변동 0.58 대 정상 0.27).
  // 클램프를 조여도 클램프 경계에서 기울기가 급변해 남았습니다.
  //
  // 방향 벡터의 수평 성분은 |xz| ≤ 1로 유계이고 돔 전체에서 매끄럽습니다.
  // 지평선 쪽 원근 압축이 실제보다 약해지지만, 줄무늬가 생기는 것보다 낫습니다.
  // **방위각 등거리 투영** (azimuthal equidistant).
  //
  // 이전에는 vDir.xz(= cos ε · (sin az, cos az))를 그대로 썼습니다. 그런데
  // d(cos ε)/dε = -sin ε 이라 **지평선 근처에서 0으로 갑니다** — 고도각이
  // 변해도 uv가 거의 안 움직이니 노이즈가 세로로 늘어나, 지평선 쪽으로
  // 수렴하는 방사형 줄무늬가 생깁니다. 덱이 반투명일 때는 빌보드와 구멍에
  // 가려 잘 안 보였는데, OVC에서 덱을 완전히 닫고 나니 드러났습니다.
  //
  // 반지름을 고도각에 **선형**으로 두면 그 늘어짐이 사라집니다.
  // (cot(ε)는 반대로 지평선에서 발산해서 더 나빴습니다 — 이미 겪은 실패입니다.)
  vec2 hdir = vDir.xz;
  float hlen = max(1e-4, length(hdir));
  float rad = (90.0 - vElevDeg) / 90.0;
  vec2 uv = (hdir / hlen) * rad * 6.0;
  uv += vec2(uTime * 0.06, uTime * 0.021);

  float holes = fbm(uv * 1.7);
  // BKN에서는 구멍이 뚫리고 OVC에서 닫힙니다.
  // 임계를 운량으로 밀어 올려서, 운량이 오를수록 구멍이 작아지게 합니다.
  float holeCut = smoothstep(0.72 - vCover * 0.55, 0.94 - vCover * 0.55, holes);

  // **여기서 실제로 닫아야 합니다.** 위 식만으로는 운량 100%에서도
  // 임계가 smoothstep(0.17, 0.39, holes) 라서, holes가 0.17 아래인 프래그먼트는
  // 그대로 뚫립니다. 측정: 운량 100%에서 holeCut 평균 0.710 —
  // **하늘의 29%가 설계상 뚫려 있었습니다.** 그래서 아무리 두꺼운 비구름을
  // 만들어도 그 틈으로 하늘이 새어 나오고, 흐린 날이 되지 않았습니다.
  //
  // 기상학적으로도 이게 맞습니다: 구멍은 BKN(5~7 옥타)의 특징이고,
  // OVC(8 옥타)는 정의상 틈이 없습니다.
  float ovc = smoothstep(0.82, 0.97, vCover);
  holeCut = mix(holeCut, 1.0, ovc);

  // 지평선 부근의 덱은 연무에 잠겨 실루엣이 사라집니다.
  // (남겨두면 원근이 무한대로 늘어나 띠처럼 보입니다.)
  float horizonFade = smoothstep(2.0, 13.0, vElevDeg);

  float deckAlpha = merge * holeCut * horizonFade;

  // 두께 얼룩 — 덱이 균일한 판때기로 보이지 않게 합니다.
  float thickVar = 0.72 + 0.56 * fbm(uv * 3.3 + 17.0);

  if (deckAlpha <= 0.004) discard;

  // ── 광학 ────────────────────────────────────────────────────────────────
  float tau = uTau * thickVar;
  vec2 rt = atm_cloudRT(tau);
  float R = rt.x;
  float T = rt.y;

  // 덱을 아래에서 올려다보므로 기본은 **바닥면**입니다.
  // 바닥면 밝기는 위에서 통과해 내려온 확산광(T)이 지배합니다.
  // 이것이 흐린 날의 평평한 회색입니다 — 직달광이 도달하지 않으므로
  // 밝은 면/그늘 면 대비가 생기지 않습니다.
  vec3 baseCol = uBeam * T * 0.42 + uAmbientDown * (0.35 + T * 0.4);

  // 덱이 얇으면 태양 방향이 비쳐 밝은 얼룩이 생깁니다 (구름 사이 밝음).
  float sunAlign = clamp(dot(normalize(vDir), uSunDir), 0.0, 1.0);
  float bright = pow(sunAlign, 6.0) * T;
  baseCol += uBeam * bright * 0.5;

  // 구멍 가장자리는 위쪽 밝은 면이 살짝 보입니다.
  float edge = (1.0 - holeCut) * merge;
  baseCol += (uBeam * R + uAmbientUp * (1.0 - R)) * edge * 0.35;

  // 그늘 깊이 — 두꺼울수록 어둡습니다.
  baseCol *= 1.0 - uShadowContrast * 0.42 * smoothstep(8.0, 60.0, tau);

  gl_FragColor = vec4(atm_display(baseCol, uSaturation, uSunAltDeg), deckAlpha * uOpacity);
}
`;

export interface CloudDeckLayer {
  layer: LayerKey;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  coverAttr: THREE.BufferAttribute;
}

export interface CloudDeckHandle {
  group: THREE.Group;
  layers: CloudDeckLayer[];
  dispose: () => void;
}

function buildDeckGeometry(layer: LayerKey): {
  geometry: THREE.BufferGeometry;
  coverAttr: THREE.BufferAttribute;
  dirs: { azDeg: number; elevDeg: number }[];
} {
  const radius = DECK_RADIUS[layer];
  const positions: number[] = [];
  const cover: number[] = [];
  const elevA: number[] = [];
  const azA: number[] = [];
  const indices: number[] = [];
  const dirs: { azDeg: number; elevDeg: number }[] = [];

  // 고도각은 1.5° ~ 89°. 지평선에 딱 붙이면 무한 원근으로 늘어납니다.
  for (let e = 0; e <= MESH_ELEV; e++) {
    const t = e / MESH_ELEV;
    const elevDeg = 1.5 + t * 87.5;
    const er = (elevDeg * Math.PI) / 180;

    for (let a = 0; a <= MESH_AZ; a++) {
      const azDeg = (a * 360) / MESH_AZ;
      const ar = (azDeg * Math.PI) / 180;

      positions.push(
        radius * Math.cos(er) * Math.sin(ar),
        radius * Math.sin(er),
        -radius * Math.cos(er) * Math.cos(ar)
      );
      cover.push(0);
      elevA.push(elevDeg);
      azA.push(azDeg);
      dirs.push({ azDeg, elevDeg });
    }
  }

  const stride = MESH_AZ + 1;
  for (let e = 0; e < MESH_ELEV; e++) {
    for (let a = 0; a < MESH_AZ; a++) {
      const i0 = e * stride + a;
      const i1 = i0 + 1;
      const i2 = (e + 1) * stride + a;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const coverAttr = new THREE.Float32BufferAttribute(cover, 1);
  coverAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCover', coverAttr);
  geometry.setAttribute('aElevDeg', new THREE.Float32BufferAttribute(elevA, 1));
  geometry.setAttribute('aAzDeg', new THREE.Float32BufferAttribute(azA, 1));
  geometry.setIndex(indices);

  return { geometry, coverAttr, dirs };
}

/** 층 → 메시 정점 방향 목록 (샘플 보간에 재사용) */
const deckDirs = new Map<LayerKey, { azDeg: number; elevDeg: number }[]>();

export function createCloudDeck(): CloudDeckHandle {
  const group = new THREE.Group();
  group.name = 'cloudDeck';

  const layers: CloudDeckLayer[] = [];

  // 상층부터 그려야 아래층이 위에 얹힙니다.
  (['high', 'mid', 'low'] as LayerKey[]).forEach((layer, idx) => {
    const { geometry, coverAttr, dirs } = buildDeckGeometry(layer);
    deckDirs.set(layer, dirs);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uBeam: { value: new THREE.Vector3(1, 1, 1) },
        uAmbientUp: { value: new THREE.Vector3(0.4, 0.5, 0.7) },
        uAmbientDown: { value: new THREE.Vector3(0.3, 0.33, 0.38) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uTau: { value: 30 },
        uShadowContrast: { value: 0.6 },
        uSunAltDeg: { value: 30 },
        uSaturation: { value: 1 },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `cloudDeck_${layer}`;
    mesh.frustumCulled = false;
    // 빌보드(2)보다 뒤, 하늘(-1)보다 앞. 상층이 더 뒤에 옵니다.
    mesh.renderOrder = 1 + idx * 0.1;
    group.add(mesh);

    layers.push({ layer, mesh, material, coverAttr });
  });

  return {
    group,
    layers,
    dispose: () => {
      for (const l of layers) {
        l.mesh.geometry.dispose();
        l.material.dispose();
      }
    },
  };
}

/**
 * 샘플 격자(방위 24 × 고도 8)를 덱 메시 정점(72 × 32)으로 보간합니다.
 * 최근접 4점 이중선형 — 격자가 규칙적이라 인덱스로 바로 찾습니다.
 */
function sampleCoverAt(
  samples: LayerSample[],
  layer: LayerKey,
  azSteps: number,
  elevs: number[],
  azDeg: number,
  elevDeg: number
): number {
  const layerSamples = samples.filter(s => s.layer === layer);
  if (layerSamples.length === 0) return 0;

  // 방위 인덱스 (순환)
  const aF = (azDeg / 360) * azSteps;
  const a0 = Math.floor(aF) % azSteps;
  const a1 = (a0 + 1) % azSteps;
  const at = aF - Math.floor(aF);

  // 고도 인덱스 (elevs는 오름차순)
  let e0 = 0;
  while (e0 < elevs.length - 2 && elevs[e0 + 1] < elevDeg) e0++;
  const e1 = Math.min(elevs.length - 1, e0 + 1);
  const span = Math.max(1e-6, elevs[e1] - elevs[e0]);
  const et = Math.max(0, Math.min(1, (elevDeg - elevs[e0]) / span));

  const at00 = layerSamples[a0 * elevs.length + e0]?.cover ?? 0;
  const at01 = layerSamples[a0 * elevs.length + e1]?.cover ?? 0;
  const at10 = layerSamples[a1 * elevs.length + e0]?.cover ?? 0;
  const at11 = layerSamples[a1 * elevs.length + e1]?.cover ?? 0;

  return (
    (at00 * (1 - et) + at01 * et) * (1 - at) + (at10 * (1 - et) + at11 * et) * at
  );
}

export interface DeckUpdate {
  samples: LayerSample[];
  beamFor: (altKm: number) => { r: number; g: number; b: number };
  /**
   * 층별 환경광. **층마다 달라야 합니다.**
   *
   * Why: 예전에는 `ambientUp`/`ambientDown` 하나를 모든 층에 썼고, 그 값이
   * `applyCloudDimming`을 거치지 않은 **맑은 하늘 복사휘도**였습니다.
   * 빌보드(cloudPlacement)는 감광되는데 덱만 안 되고 있었고, 하필 8/8에서는
   * 화면을 덮는 것이 덱입니다. 그래서 운량을 올릴수록 오히려 밝아졌습니다 —
   * 측정: 태양 45°에서 6/8이 화면밝기 181, 8/8이 207.
   */
  ambientFor: (layer: LayerKey) => {
    up: { r: number; g: number; b: number };
    down: { r: number; g: number; b: number };
  };
  sunDir: THREE.Vector3;
  sunAltDeg: number;
  tauFor: (layer: LayerKey) => number;
  shadowFor: (layer: LayerKey) => number;
  timeSeconds: number;
  visible: boolean;
}

export function updateCloudDeck(handle: CloudDeckHandle, u: DeckUpdate): void {
  const elevs = elevationGrid();
  const azSteps = 24;

  for (const l of handle.layers) {
    const dirs = deckDirs.get(l.layer);
    if (!dirs) continue;

    const arr = l.coverAttr.array as Float32Array;
    let maxCover = 0;
    for (let i = 0; i < dirs.length; i++) {
      const c = sampleCoverAt(u.samples, l.layer, azSteps, elevs, dirs[i].azDeg, dirs[i].elevDeg);
      arr[i] = c;
      if (c > maxCover) maxCover = c;
    }
    l.coverAttr.needsUpdate = true;

    const uni = l.material.uniforms;
    const beam = u.beamFor(LAYER_ALTITUDE_KM[l.layer]);
    (uni.uBeam.value as THREE.Vector3).set(beam.r, beam.g, beam.b);
    const amb = u.ambientFor(l.layer);
    (uni.uAmbientUp.value as THREE.Vector3).set(amb.up.r, amb.up.g, amb.up.b);
    (uni.uAmbientDown.value as THREE.Vector3).set(amb.down.r, amb.down.g, amb.down.b);
    (uni.uSunDir.value as THREE.Vector3).copy(u.sunDir);
    uni.uTau.value = u.tauFor(l.layer);
    uni.uShadowContrast.value = u.shadowFor(l.layer);
    uni.uSunAltDeg.value = u.sunAltDeg;
    uni.uTime.value = u.timeSeconds;

    // 최대 운량이 병합 임계에 못 미치면 그 층 덱은 통째로 끕니다.
    l.mesh.visible = u.visible && maxCover > 0.45;
  }
}
