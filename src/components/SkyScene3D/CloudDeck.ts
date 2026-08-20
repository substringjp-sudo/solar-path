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
import { ATMOSPHERE_GLSL, makeTuningUniforms } from '../../utils/atmosphere';
import { CELL_FIELD_GLSL } from '../../utils/cloudCellField';
import {
  createCloudCellTexture,
  CELL_CHANNEL_MASK,
  type CloudCellTexture,
} from './cloudCellTexture';
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
${CELL_FIELD_GLSL}

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

// ── 조각 무늬 (docs/CLOUD_TEXTURE_PLAN.md 2단계) ──────────────────────────
uniform sampler2D uCellTex;      // 구운 셀 필드 (RGBA = 씨앗 4개)
uniform vec4  uCellMaskA;        // 이 층이 읽을 채널
uniform vec4  uCellMaskB;        // 두 번째 탭이 읽을 채널
uniform float uCellUvScale;      // 1 / (셀크기km × 타일당셀수)
uniform float uPatchUvScale;     // 패치용 — 훨씬 큰 스케일
uniform float uCellStrength;     // 0이면 조각 없는 연속 베일
uniform float uAltKm;            // 이 층의 고도
uniform float uMaxDistKm;        // 지상거리 상한 (지평선에서 발산 방지)
uniform float uPixelAngleRad;    // 화면 픽셀 하나의 각크기
uniform float uMaxAniso;         // 이방성 필터 최대 배율
uniform float uCellTexSize;      // 텍스처 한 변 (텍셀)

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
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  if (vCover <= 0.005) discard;

  // ── 투영: 고도 선형 → **지상거리 선형** ─────────────────────────────────
  //
  // 예전에는 uv 반지름이 시선 고도에 선형이었습니다(방위각 등거리).
  // 그러면 원근 단축이 없어 구름이 지평선까지 같은 크기로 깔립니다 —
  // 하늘이 벽지처럼 보이던 이유입니다.
  //
  // 실제 구름층은 고도 h의 평면이고, 시선이 닿는 지점의 지상거리는
  // d = h / tan(ε) 입니다. 고도 45°와 8° 사이에 이 값이 7배 차이납니다.
  vec2 hdir = vDir.xz;
  float hlen = max(1e-4, length(hdir));
  vec2 dirXZ = hdir / hlen;

  float elevRad = radians(max(vElevDeg, 0.05));
  float sinE = max(sin(elevRad), 1e-3);
  float cosE = max(cos(elevRad), 1e-3);
  // 지평선에서 d가 발산하므로 상한을 둡니다. 그 너머는 어차피 연무입니다.
  float d = min(uAltKm * cosE / sinE, uMaxDistKm);

  // 바람에 따른 이동은 **km 단위**여야 합니다 — uv 단위로 밀면 층마다
  // 셀 크기가 달라 이동 속도가 제각각이 됩니다.
  vec2 driftKm = vec2(uTime * 0.0040, uTime * 0.0016);

  vec2 uvCell  = (dirXZ * d + driftKm) * uCellUvScale;
  vec2 uvPatch = (dirXZ * d + driftKm * 0.6) * uPatchUvScale;

  // ── 화면 픽셀 하나가 덮는 텍셀 수 (해석적으로) ─────────────────────────
  //
  // uv 변화율은 방향마다 다릅니다. 접선 방향은 d/cos ε, 반경 방향은
  // d/(sin ε · cos ε) — 비율이 정확히 1/sin ε 입니다. 지평선 쪽에서 반경
  // 방향이 훨씬 빨리 변하므로 무늬가 그 방향으로 눌립니다.
  //
  // 이방성 필터가 있으면 LOD는 **짧은 축** 기준으로 잡히므로 접선 쪽을 쓰되,
  // 비율이 필터 한계를 넘으면 그만큼 되돌립니다.
  float tangential = uCellTexSize * uPixelAngleRad * d * uCellUvScale / cosE;
  float aniso = 1.0 / sinE;
  float tpp = tangential * max(1.0, aniso / max(1.0, uMaxAniso));

  // ── 두 스케일 ──────────────────────────────────────────────────────────
  //
  // 큰 스케일은 **합성하지 않습니다.** 576방향 기상 격자가 이미 방향마다
  // 다른 운량(vCover)을 주고 있고, 그게 진짜 데이터로 된 패치입니다.
  //
  // 한동안 그 위에 합성 패치를 하나 더 얹어 국소 운량을 흔들었는데, 렌더에서
  // 잡혔습니다: 지상거리 투영은 천정에서 d → 0 이라 **패치 uv가 한 점으로
  // 수축**합니다. 그러면 천정 부근 넓은 영역이 텍스처의 한 값을 공유해
  // 운량이 통째로 밀립니다 (측정 -5.2%p). 셀 쪽은 uv 배율이 8배 커서 그
  // 특이점이 눈에 안 띌 만큼 작습니다.
  //
  // 격자는 통계를, 텍스처는 모양을 — 계획의 원칙 그대로가 맞았습니다.
  float cellV = cell_sample(uCellTex, uvCell, uCellMaskA, uCellMaskB);
  float t = cell_threshold(vCover, tpp);
  // 문턱 램프는 대칭이라 면적을 바꾸지 않습니다. 축소가 클수록 넓혀
  // 계단이 지글거리지 않게 합니다.
  float w = clamp(0.025 * max(1.0, tpp), 0.02, 0.40);
  float cellCut = smoothstep(t - w, t + w, cellV);

  // 층운계(cellStrength = 0)는 조각을 내지 않습니다 — WMO 정의상 요소가
  // 없는 구름입니다. 그때는 운량이 그대로 알파가 됩니다.
  float coverAlpha = mix(vCover, cellCut, uCellStrength);

  // 지평선 부근의 덱 페이드 (4단계에서 대기 투시로 대체)
  float horizonFade = smoothstep(1.5, 14.0, vElevDeg);
  float deckAlpha = coverAlpha * horizonFade;

  // 두께 얼룩 — 덱이 균일한 판때기로 보이지 않게 합니다.
  float thickVar = 0.72 + 0.56 * fbm(uvPatch * 6.0 + 17.0);

  if (deckAlpha <= 0.004) discard;

  // 아래쪽 코드가 쓰는 이름들을 맞춰 둡니다.
  float holeCut = cellCut;
  float merge = vCover;

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
  /** 구운 조각 무늬 — 검증 하네스가 크기·타일 수를 읽습니다 */
  cell: CloudCellTexture;
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

/** 지상거리 상한 — 층 고도의 몇 배까지 볼 것인가 (시선 고도 약 1.4°) */
const MAX_DIST_FACTOR = 40;
/**
 * 두께 얼룩용 무늬의 물리 크기 (km).
 *
 * **운량에는 관여하지 않습니다.** τ를 ±28% 흔들어 덱이 균일한 판때기로
 * 보이지 않게 하는 밝기 얼룩일 뿐입니다. 예전에 여기에 운량 변조를 얹었다가
 * 천정 특이점으로 운량이 -5.2%p 밀렸습니다 (셰이더 주석 참고).
 */
const PATCH_SIZE_KM = 4;

export function createCloudDeck(opts: {
  /** 이방성 필터 최대 배율. `renderer.capabilities.getMaxAnisotropy()` */
  maxAnisotropy?: number;
} = {}): CloudDeckHandle {
  const group = new THREE.Group();
  group.name = 'cloudDeck';

  // 조각 무늬는 날씨·시각과 무관한 정적 텍스처라 한 번만 굽습니다.
  const cell = createCloudCellTexture();
  const maxAniso = Math.max(1, opts.maxAnisotropy ?? 1);
  cell.texture.anisotropy = maxAniso;
  cell.texture.needsUpdate = true;

  const layers: CloudDeckLayer[] = [];

  // 상층부터 그려야 아래층이 위에 얹힙니다.
  (['high', 'mid', 'low'] as LayerKey[]).forEach((layer, idx) => {
    const { geometry, coverAttr, dirs } = buildDeckGeometry(layer);
    deckDirs.set(layer, dirs);

    const material = new THREE.ShaderMaterial({
      uniforms: {
      ...makeTuningUniforms(),
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

        uCellTex: { value: cell.texture },
        uCellMaskA: { value: new THREE.Vector4(1, 0, 0, 0) },
        uCellMaskB: { value: new THREE.Vector4(0, 1, 0, 0) },
        // 기본값은 고적운 기준. updateCloudDeck이 운형에서 다시 넣습니다.
        uCellUvScale: { value: 1 / (0.5 * cell.tileCells) },
        uPatchUvScale: { value: 1 / (PATCH_SIZE_KM * cell.tileCells) },
        uCellStrength: { value: 0.9 },
        uAltKm: { value: LAYER_ALTITUDE_KM[layer] },
        uMaxDistKm: { value: LAYER_ALTITUDE_KM[layer] * MAX_DIST_FACTOR },
        uPixelAngleRad: { value: 0.002 },
        uMaxAniso: { value: maxAniso },
        uCellTexSize: { value: cell.size },
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
      // 텍스처는 모듈 캐시가 갖고 있으므로 여기서 버리지 않습니다.
    },
    cell,
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
  /**
   * 층별 대표 운형의 조각 기하.
   *
   * **광학두께와 같은 운형에서 나와야 합니다.** 두 값이 갈라지면
   * "권운처럼 얇은데 층적운처럼 큰 조각"이 나옵니다.
   */
  cellFor: (layer: LayerKey) => {
    cellSizeKm: number;
    cellStrength: number;
    cellVariant: 'billow' | 'fbm';
  };
  /** 화면 픽셀 하나의 각크기 (rad) — 밉 필터 보정에 씁니다 */
  pixelAngleRad: number;
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

    const cellCfg = u.cellFor(l.layer);
    const mask = CELL_CHANNEL_MASK[cellCfg.cellVariant];
    (uni.uCellMaskA.value as THREE.Vector4).fromArray(mask.a);
    (uni.uCellMaskB.value as THREE.Vector4).fromArray(mask.b);
    // 셀 크기가 0인 운형(층운계)은 조각이 없습니다. 0으로 나누지 않도록
    // 배율은 아무 값이나 넣고 uCellStrength가 결과를 지웁니다.
    const sizeKm = cellCfg.cellSizeKm > 0.001 ? cellCfg.cellSizeKm : 1;
    uni.uCellUvScale.value = 1 / (sizeKm * handle.cell.tileCells);
    uni.uCellStrength.value = cellCfg.cellStrength;
    uni.uPixelAngleRad.value = u.pixelAngleRad;
    uni.uSunAltDeg.value = u.sunAltDeg;
    uni.uTime.value = u.timeSeconds;

    // 운량이 사실상 0인 층만 끕니다.
    //
    // 예전 문턱은 0.45였습니다. 덱이 "BKN/OVC에서만 얹는 보조"였을 때는
    // 맞는 값이었지만(merge가 0.20에서 시작해 0.85에서 차므로 그 아래는
    // 기여가 거의 없었습니다), 2단계부터 덱이 층상운의 **주역**이라
    // 그 문턱은 운량 45% 미만의 하늘을 통째로 지워 버립니다.
    // 기준 사진(고적운 39%)이 정확히 여기 걸렸습니다.
    l.mesh.visible = u.visible && maxCover > 0.02;
  }
}
