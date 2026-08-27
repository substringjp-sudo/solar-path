/**
 * SceneComposer.ts
 *
 * **층마다 다른 해상도로 그려서 합성합니다.**
 *
 * ## 왜
 *
 * 배율 훑기(`tools/shader-preview/build-scale-sweep.js`)에서 나온 결론:
 * 내부 렌더 해상도를 절반으로 낮추면 구름 덱의 잔 파편이 읽히는 덩어리로
 * 뭉치고(경계밀도 3.26% → 2.42%), **예보 운량은 ±0.05%p 안에서 보존**
 * 됩니다. 게다가 프래그먼트 부하가 1/4입니다.
 *
 * 그런데 화면 전체를 낮추면 **별이 대가를 치릅니다.** 별은 8,355개의 점
 * 광원이라 픽셀이 줄면 흐려지고 화면을 돌릴 때 깜빡입니다.
 *
 * 다행히 낮춰야 할 것과 지켜야 할 것이 깔끔하게 갈립니다:
 *
 *   낮춰도 되는 것   스카이돔, 구름 덱      — 크고 부드러운 것
 *   지켜야 할 것     별·은하수·태양·달·지형·빌보드 — 작고 날카로운 것
 *
 * ## 왜 이 네 층인가
 *
 * 씬은 깊이 버퍼가 아니라 **renderOrder(화가 알고리즘)** 로 쌓입니다.
 * 그 순서를 그대로 지켜야 하므로 부드러운 것과 날카로운 것이 번갈아
 * 나옵니다 — 별은 하늘 위·구름 아래니까요. 그래서 두 덩어리가 아니라
 * 네 층입니다:
 *
 *   1 SOFT_SKY    스카이돔                    저해상도 (불투명)
 *   2 MID         은하수·별·지면·지형·태양     원해상도
 *   3 SOFT_CLOUD  구름 덱                     저해상도 (투명)
 *   4 FRONT       빌보드·천체경로·달           원해상도
 *
 * **빌보드는 일부러 원해상도에 둡니다.** 잔 파편을 만드는 것은 덱의 문턱
 * 절단이지 빌보드가 아니고, 빌보드는 `depthTest: true`라 지형과 깊이
 * 비교를 합니다 — 별도 버퍼로 빼면 그 깊이 정보를 잃습니다. 덱과 스카이돔은
 * 둘 다 `depthTest: false`라 이 문제가 없습니다.
 *
 * ## 알파 합성
 *
 * 구름을 투명 버퍼에 그린 뒤 화면에 얹으려면 **알파가 제대로 쌓여야**
 * 합니다. Three의 기본 NormalBlending은 색만 맞고 알파는
 * `a_src·a_src + (1−a_src)·a_dst` 로 틀립니다. 알파 쪽만 `(One,
 * OneMinusSrcAlpha)` 로 바꾸면 색은 미리곱해진(premultiplied) 형태로,
 * 알파는 올바른 누적으로 쌓입니다. 그래서 합성 패스는 미리곱 over
 * `(One, OneMinusSrcAlpha)` 를 씁니다.
 *
 * 기본 프레임버퍼에 직접 그릴 때는 목적지 알파가 무시되므로, 이 설정은
 * 합성을 안 쓰는 경로에서도 동작이 같습니다.
 */
import * as THREE from 'three';

/** 기본값 — 어느 층에도 배정되지 않은 물체 (합성 시 그려지지 않습니다) */
export const LAYER_DEFAULT = 0;
/** 저해상도 · 불투명 배경 */
export const LAYER_SOFT_SKY = 1;
/** 원해상도 · 구름 아래 (별·은하수·지형·태양) */
export const LAYER_MID = 2;
/** 저해상도 · 투명 (구름 덱) */
export const LAYER_SOFT_CLOUD = 3;
/** 원해상도 · 구름 위 (빌보드·경로·달) */
export const LAYER_FRONT = 4;

/**
 * 저해상도 배율의 기본값.
 *
 * 배율 훑기에서 고른 값입니다 (기준 폰 23.2 px/°):
 *
 *   ×1    23.2 px/°   경계밀도 3.26%   잔 파편이 흩뿌려짐
 *   ×2    11.6 px/°   경계밀도 2.42%   덩어리로 읽힘, 형태는 살아 있음  ← 채택
 *   ×3     7.7 px/°   경계밀도 2.19%   더 회화적이나 파란 틈이 무뎌짐
 *   ×4     5.8 px/°   경계밀도 1.85%   뭉갬
 */
export const DEFAULT_SOFT_SCALE = 2;

const BLIT_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  // 전체화면 사각형 — 변환 없이 클립 공간에 그대로 놓습니다.
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLIT_FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}
`;

export interface SceneComposerHandle {
  /** 저해상도 배율. 1이면 합성을 건너뛰고 한 번에 그립니다. */
  softScale: number;
  setSoftScale: (s: number) => void;
  /** 화면 크기가 바뀌면 호출 — 렌더 타깃을 다시 만듭니다. */
  setSize: (width: number, height: number) => void;
  render: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;
  dispose: () => void;
  /** 검증용 — 실제로 쓰인 저해상도 버퍼 크기 */
  softSize: () => { width: number; height: number };
}

/**
 * 물체와 그 자손을 한 층에 배정합니다.
 *
 * `layers.set`은 **덮어쓰기**입니다(기본 층 0에서 빠집니다). 합성 경로는
 * 카메라 층을 하나씩 켜므로, 배정되지 않은 물체는 아무 패스에서도 그려지지
 * 않습니다 — 새 물체를 씬에 넣을 때 여기에 함께 등록해야 합니다.
 */
export function assignLayer(obj: THREE.Object3D, layer: number): void {
  obj.traverse(o => o.layers.set(layer));
}

export function createSceneComposer(
  width: number,
  height: number,
  softScale: number = DEFAULT_SOFT_SCALE
): SceneComposerHandle {
  let w = Math.max(1, Math.floor(width));
  let h = Math.max(1, Math.floor(height));
  let scale = Math.max(1, softScale);

  const rtOptions: THREE.RenderTargetOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  };

  const softW = () => Math.max(1, Math.round(w / scale));
  const softH = () => Math.max(1, Math.round(h / scale));

  let rtSky = new THREE.WebGLRenderTarget(softW(), softH(), rtOptions);
  let rtCloud = new THREE.WebGLRenderTarget(softW(), softH(), rtOptions);

  const quad = new THREE.PlaneGeometry(2, 2);
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 배경 blit — 그대로 덮어씁니다.
  const opaqueMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null as THREE.Texture | null } },
    vertexShader: BLIT_VERT,
    fragmentShader: BLIT_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  // 구름 blit — **미리곱해진** 색을 얹습니다 (파일 상단 알파 합성 주석).
  const overMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null as THREE.Texture | null } },
    vertexShader: BLIT_VERT,
    fragmentShader: BLIT_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const opaqueQuad = new THREE.Mesh(quad, opaqueMat);
  const overQuad = new THREE.Mesh(quad, overMat);
  opaqueQuad.frustumCulled = false;
  overQuad.frustumCulled = false;
  const blitScene = new THREE.Scene();

  const blit = (renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, tex: THREE.Texture) => {
    (mesh.material as THREE.ShaderMaterial).uniforms.uTex.value = tex;
    blitScene.clear();
    blitScene.add(mesh);
    // blit 자체는 층과 무관합니다 — 전용 씬이라 카메라 층 마스크를 되돌려 둡니다.
    blitCam.layers.enableAll();
    renderer.render(blitScene, blitCam);
    blitScene.remove(mesh);
  };

  const resize = () => {
    rtSky.setSize(softW(), softH());
    rtCloud.setSize(softW(), softH());
  };

  const render = (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) => {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevMask = camera.layers.mask;

    if (scale <= 1.0001) {
      // 합성을 건너뜁니다 — 저해상도 이득이 없으므로 패스 비용만 늘어납니다.
      camera.layers.enableAll();
      renderer.autoClear = true;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      camera.layers.mask = prevMask;
      renderer.autoClear = prevAutoClear;
      return;
    }

    // ── 1) 배경 (저해상도, 불투명) ───────────────────────────────────────
    camera.layers.set(LAYER_SOFT_SKY);
    renderer.autoClear = true;
    renderer.setRenderTarget(rtSky);
    renderer.render(scene, camera);

    // ── 2) 구름 덱 (저해상도, 투명) ──────────────────────────────────────
    //
    // 투명 검정으로 지웁니다. 덱 재질의 알파 블렌딩이 (One, 1−SrcAlpha)라
    // 여기 쌓인 결과가 미리곱해진 형태가 됩니다.
    camera.layers.set(LAYER_SOFT_CLOUD);
    renderer.setRenderTarget(rtCloud);
    renderer.setClearAlpha(0);
    renderer.clear(true, true, true);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.setClearAlpha(1);

    // ── 3) 화면 합성 ─────────────────────────────────────────────────────
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    blit(renderer, opaqueQuad, rtSky.texture);

    renderer.autoClear = false;
    // 별·은하수·지형·태양 — 원해상도, 구름 아래.
    camera.layers.set(LAYER_MID);
    renderer.render(scene, camera);

    // 구름을 얹습니다.
    blit(renderer, overQuad, rtCloud.texture);

    // 빌보드·경로·달 — 원해상도, 구름 위.
    camera.layers.set(LAYER_FRONT);
    renderer.render(scene, camera);

    camera.layers.mask = prevMask;
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  };

  return {
    get softScale() {
      return scale;
    },
    set softScale(s: number) {
      scale = Math.max(1, s);
      resize();
    },
    setSoftScale: (s: number) => {
      scale = Math.max(1, s);
      resize();
    },
    setSize: (width: number, height: number) => {
      w = Math.max(1, Math.floor(width));
      h = Math.max(1, Math.floor(height));
      resize();
    },
    render,
    softSize: () => ({ width: softW(), height: softH() }),
    dispose: () => {
      rtSky.dispose();
      rtCloud.dispose();
      quad.dispose();
      opaqueMat.dispose();
      overMat.dispose();
    },
  };
}
