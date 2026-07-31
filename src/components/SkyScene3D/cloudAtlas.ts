/**
 * cloudAtlas.ts
 *
 * Why: 기존 CLOUD_TEMPLATES(10종 구름 SVG)를 구름 하나당 ShapeGeometry로 삼각분할하면
 * 구름 개수만큼 draw call이 늘고, 폴리곤 경계가 칼같이 잘려 "종이를 오려 붙인" 느낌이 납니다.
 *
 * 대신 앱 시작 시 GPU로 딱 한 번 텍스처 아틀라스를 구워둡니다.
 *  - 구름 하나 = quad 2삼각형 (아틀라스 UV만 다름) → InstancedMesh로 draw call 1개
 *  - 알파 채널에 블러를 먹여 가장자리가 부드러워짐 → 종이 느낌 제거
 *
 * 각 셀은 모양을 셀 전체로 늘려 채우고(텍셀 낭비 방지), 원본 종횡비는 rect.aspect로
 * 따로 돌려줍니다. 배치 시 quad 크기를 (h * aspect, h)로 잡으면 늘어짐이 상쇄됩니다.
 */
import * as THREE from 'three';
import { svgPathToShapes } from './svgPathToShape';
import {
  CLOUD_TEMPLATES,
  CLOUD_TEMPLATES_HORIZONTAL,
  type CloudPresetName,
} from '../SunsetSimulation/Visualizer';

/** 셀 한 변의 픽셀 수. 구름은 형태가 뭉툭해 128이면 충분합니다. */
const CELL = 128;
/** 가로 셀 개수 (아틀라스 폭 = COLS * CELL = 1024, POT 유지) */
const COLS = 8;
/** 블러가 셀 밖으로 번지지 않도록 남겨두는 안쪽 여백 (셀 크기 대비 비율) */
const INNER_PADDING = 0.18;
/** 알파 블러 반경 (픽셀) */
const BLUR_RADIUS = 3.0;

export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 원본 SVG 바운딩박스의 가로/세로 비율 */
  aspect: number;
}

export interface CloudAtlas {
  texture: THREE.Texture;
  rects: Map<string, AtlasRect>;
  /** 아틀라스에 실제로 구워진 키 목록 */
  keys: string[];
  dispose: () => void;
}

/** 아틀라스 조회 키 */
export function cloudAtlasKey(
  name: CloudPresetName,
  variant: number,
  horizontal: boolean
): string {
  return `${horizontal ? 'H' : 'V'}:${name}:${variant}`;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

interface BakeEntry {
  key: string;
  path: string;
  horizontal: boolean;
}

function collectEntries(): BakeEntry[] {
  const entries: BakeEntry[] = [];
  const names = Object.keys(CLOUD_TEMPLATES) as CloudPresetName[];

  for (const name of names) {
    (CLOUD_TEMPLATES[name] ?? []).forEach((path, i) => {
      entries.push({ key: cloudAtlasKey(name, i, false), path, horizontal: false });
    });
    (CLOUD_TEMPLATES_HORIZONTAL[name] ?? []).forEach((path, i) => {
      entries.push({ key: cloudAtlasKey(name, i, true), path, horizontal: true });
    });
  }

  return entries;
}

const BLUR_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 1차원 가우시안 블러. alpha만 의미가 있으므로 RGB는 흰색으로 고정하고
 * alpha만 누적합니다(프리멀티플라이 없이 색 번짐 방지).
 */
const BLUR_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;

void main() {
  float w[5];
  w[0] = 0.227027; w[1] = 0.194594; w[2] = 0.121621; w[3] = 0.054054; w[4] = 0.016216;

  float a = texture2D(uTex, vUv).a * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uStep * float(i);
    a += texture2D(uTex, vUv + off).a * w[i];
    a += texture2D(uTex, vUv - off).a * w[i];
  }
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}
`;

/**
 * 10종 구름 템플릿을 텍스처 아틀라스 한 장으로 굽습니다.
 * GLView 컨텍스트가 만들어진 뒤(renderer 확보 후) 1회만 호출하세요.
 */
export function bakeCloudAtlas(renderer: THREE.WebGLRenderer): CloudAtlas {
  const entries = collectEntries();
  const rows = Math.max(1, Math.ceil(entries.length / COLS));

  const atlasW = COLS * CELL;
  const atlasH = nextPowerOfTwo(rows * CELL);

  const rtOptions: THREE.RenderTargetOptions = {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  };

  const rtA = new THREE.WebGLRenderTarget(atlasW, atlasH, rtOptions);
  const rtB = new THREE.WebGLRenderTarget(atlasW, atlasH, rtOptions);

  // 픽셀 좌표를 그대로 쓰는 정사영 카메라 (좌하단 원점)
  const camera = new THREE.OrthographicCamera(0, atlasW, atlasH, 0, -1, 1);
  const scene = new THREE.Scene();

  const rects = new Map<string, AtlasRect>();
  const shapeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });

  const disposables: THREE.BufferGeometry[] = [];
  const inner = CELL * (1 - INNER_PADDING * 2);

  entries.forEach((entry, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);

    const shapes = svgPathToShapes(entry.path, 1);
    if (shapes.length === 0) return;

    const geometry = new THREE.ShapeGeometry(shapes);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) {
      geometry.dispose();
      return;
    }

    const w = Math.max(1e-6, bb.max.x - bb.min.x);
    const h = Math.max(1e-6, bb.max.y - bb.min.y);

    // 셀 안쪽 박스를 가득 채우도록 늘림 (종횡비는 aspect로 따로 보존)
    const sx = inner / w;
    const sy = inner / h;

    // 셀 좌하단 픽셀 좌표. row는 위에서부터 세지만 ortho는 아래가 0이므로 뒤집습니다.
    const cellX = col * CELL;
    const cellY = atlasH - (row + 1) * CELL;

    geometry.translate(-bb.min.x, -bb.min.y, 0);
    geometry.scale(sx, sy, 1);
    geometry.translate(cellX + CELL * INNER_PADDING, cellY + CELL * INNER_PADDING, 0);

    const mesh = new THREE.Mesh(geometry, shapeMaterial);
    scene.add(mesh);
    disposables.push(geometry);

    rects.set(entry.key, {
      u0: cellX / atlasW,
      v0: cellY / atlasH,
      u1: (cellX + CELL) / atlasW,
      v1: (cellY + CELL) / atlasH,
      aspect: w / h,
    });
  });

  // ── 1) 하드 엣지 실루엣을 rtA에 렌더 ────────────────────────────────────
  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(rtA);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  renderer.render(scene, camera);

  // ── 2) 알파 블러 2패스 (가로 → 세로) ────────────────────────────────────
  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uStep: { value: new THREE.Vector2() },
    },
    vertexShader: BLUR_VERT,
    fragmentShader: BLUR_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeometry, blurMaterial);
  const blurScene = new THREE.Scene();
  blurScene.add(quad);
  const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  // 가로 블러: rtA → rtB
  blurMaterial.uniforms.uTex.value = rtA.texture;
  blurMaterial.uniforms.uStep.value.set(BLUR_RADIUS / atlasW, 0);
  renderer.setRenderTarget(rtB);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  renderer.render(blurScene, blurCamera);

  // 세로 블러: rtB → rtA
  blurMaterial.uniforms.uTex.value = rtB.texture;
  blurMaterial.uniforms.uStep.value.set(0, BLUR_RADIUS / atlasH);
  renderer.setRenderTarget(rtA);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  renderer.render(blurScene, blurCamera);

  // 렌더러 상태 복구
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);

  // 임시 리소스 정리 (rtA.texture는 계속 사용하므로 유지)
  disposables.forEach(g => g.dispose());
  shapeMaterial.dispose();
  quadGeometry.dispose();
  blurMaterial.dispose();
  rtB.dispose();

  const texture = rtA.texture;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  return {
    texture,
    rects,
    keys: Array.from(rects.keys()),
    dispose: () => {
      rtA.dispose();
    },
  };
}
