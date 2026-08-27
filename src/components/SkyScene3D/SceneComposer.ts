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

/**
 * 밝은 부분만 뽑아내기 — 부드러운 무릎(soft knee).
 *
 * 딱딱한 문턱으로 자르면 밝기가 문턱을 넘나드는 경계에서 블룸이 **깜빡입니다**
 * (구름이 흐르거나 시각이 바뀔 때). 무릎 구간에서 이차로 올라오게 하면
 * 그 전이가 매끄럽습니다.
 *
 * ⚠ **이 파이프라인은 톤매핑 뒤(LDR)에서 블룸합니다.** 물리적으로는 톤매핑
 * 전 HDR에서 하는 것이 맞지만, 그러려면 렌더 타깃이 half-float 이어야 하고
 * GLES2 기기에서 색 버퍼로 쓸 수 있는지가 갈립니다. 대가는 태양 원반처럼
 * 이미 1.0에 포화된 것과 거의 흰 구름이 **같은 세기로** 번진다는 점입니다.
 * 문턱을 높게 잡아 정말 밝은 것만 걸리게 해 그 대가를 줄입니다.
 */
const BRIGHT_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contrib = max(soft, l - uThreshold) / max(l, 1e-5);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

/**
 * 분리 가능 가우시안 — 선형 표본 5탭으로 9픽셀 폭을 냅니다.
 *
 * 텍스처 필터가 두 텍셀을 섞어 주므로, 오프셋을 텍셀 중간에 두면 표본
 * 하나가 두 개 몫을 합니다. 블룸 버퍼는 어차피 1/4 해상도라 이 정도면
 * 화면에서 충분히 넓게 번집니다.
 */
const BLUR_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  c += texture2D(uTex, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(uTex, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** 원본 + 블룸. 더하기라 어두운 곳은 그대로 두고 밝은 곳만 번집니다. */
const BLOOM_COMPOSITE_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(uTex, vUv).rgb;
  vec3 glow = texture2D(uBloom, vUv).rgb;
  gl_FragColor = vec4(base + glow * uStrength, 1.0);
}
`;

/** 블룸 설정. `strength: 0`이면 체인 전체를 건너뜁니다. */
export interface BloomConfig {
  /** 더할 세기. 0 = 끔 */
  strength: number;
  /** 이 밝기를 넘는 부분만 번집니다 (0~1, 톤매핑 뒤 기준) */
  threshold: number;
  /** 문턱 전이 폭. 0이면 경계에서 깜빡입니다 */
  knee: number;
  /** 블룸 버퍼를 화면의 몇 분의 1로 잡을 것인가 */
  scale: number;
}

export const DEFAULT_BLOOM: BloomConfig = {
  // 세기를 훑어서 골랐습니다(`build-bloom-sweep.js`). 밝기 백분위만 보면
  // 더 센 쪽이 좋아 보이지만, 블룸의 대가는 **포화**에 있습니다 — 태양 +2°
  // 화면에서 밝기 250 이상인 픽셀 비율이 0.29% → 3.28%(0.35) → 7.21%(0.55)
  // → 12.85%(0.85)로 늘고, 그 영역의 구름 구조는 흰색으로 뭉개져 사라집니다.
  // 0.35는 봉우리를 확실히 들어올리면서(상위10 +16.4) 포화를 3%대로 묶습니다.
  strength: 0.35,
  // 톤매핑 뒤 기준이라 꽤 높게 잡습니다 — 태양 원반과 지평선 노을,
  // 역광 받은 구름 가장자리만 걸리는 지점입니다.
  threshold: 0.72,
  knee: 0.22,
  scale: 4,
};

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
  /** 블룸 설정. `strength: 0`이면 체인 전체를 건너뜁니다. */
  setBloom: (cfg: Partial<BloomConfig>) => void;
  getBloom: () => BloomConfig;
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
  softScale: number = DEFAULT_SOFT_SCALE,
  bloomCfg: BloomConfig = DEFAULT_BLOOM
): SceneComposerHandle {
  let w = Math.max(1, Math.floor(width));
  let h = Math.max(1, Math.floor(height));
  let scale = Math.max(1, softScale);
  const bloom: BloomConfig = { ...bloomCfg };

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

  const bloomW = () => Math.max(1, Math.round(w / Math.max(1, bloom.scale)));
  const bloomH = () => Math.max(1, Math.round(h / Math.max(1, bloom.scale)));

  const rtSky = new THREE.WebGLRenderTarget(softW(), softH(), rtOptions);
  const rtCloud = new THREE.WebGLRenderTarget(softW(), softH(), rtOptions);
  /**
   * 블룸을 켜면 씬을 화면이 아니라 여기에 그립니다 — 밝은 부분을 뽑으려면
   * 완성된 그림을 **다시 읽어야** 하는데, 기본 프레임버퍼는 그럴 수
   * 없습니다. 블룸이 꺼져 있으면 이 버퍼는 쓰이지 않습니다.
   */
  const rtScene = new THREE.WebGLRenderTarget(w, h, rtOptions);
  const rtBloomA = new THREE.WebGLRenderTarget(bloomW(), bloomH(), rtOptions);
  const rtBloomB = new THREE.WebGLRenderTarget(bloomW(), bloomH(), rtOptions);

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

  const brightMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uThreshold: { value: bloom.threshold },
      uKnee: { value: bloom.knee },
    },
    vertexShader: BLIT_VERT,
    fragmentShader: BRIGHT_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uStep: { value: new THREE.Vector2() },
    },
    vertexShader: BLIT_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const bloomMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uBloom: { value: null as THREE.Texture | null },
      uStrength: { value: bloom.strength },
    },
    vertexShader: BLIT_VERT,
    fragmentShader: BLOOM_COMPOSITE_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const opaqueQuad = new THREE.Mesh(quad, opaqueMat);
  const overQuad = new THREE.Mesh(quad, overMat);
  const brightQuad = new THREE.Mesh(quad, brightMat);
  const blurQuad = new THREE.Mesh(quad, blurMat);
  const bloomQuad = new THREE.Mesh(quad, bloomMat);
  brightQuad.frustumCulled = false;
  blurQuad.frustumCulled = false;
  bloomQuad.frustumCulled = false;
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
    rtScene.setSize(w, h);
    rtBloomA.setSize(bloomW(), bloomH());
    rtBloomB.setSize(bloomW(), bloomH());
  };

  /** 블룸 체인. 완성된 씬(rtScene)을 읽어 화면에 원본+번짐을 씁니다. */
  const runBloom = (renderer: THREE.WebGLRenderer) => {
    // 1) 밝은 부분 뽑기 (1/4 해상도)
    brightMat.uniforms.uThreshold.value = bloom.threshold;
    brightMat.uniforms.uKnee.value = bloom.knee;
    renderer.setRenderTarget(rtBloomA);
    renderer.clear(true, false, false);
    blit(renderer, brightQuad, rtScene.texture);

    // 2) 가로 → 세로 분리 블러
    const bw = bloomW(), bh = bloomH();
    (blurMat.uniforms.uStep.value as THREE.Vector2).set(1 / bw, 0);
    renderer.setRenderTarget(rtBloomB);
    renderer.clear(true, false, false);
    blit(renderer, blurQuad, rtBloomA.texture);

    (blurMat.uniforms.uStep.value as THREE.Vector2).set(0, 1 / bh);
    renderer.setRenderTarget(rtBloomA);
    renderer.clear(true, false, false);
    blit(renderer, blurQuad, rtBloomB.texture);

    // 3) 화면에 원본 + 번짐
    renderer.setRenderTarget(null);
    bloomMat.uniforms.uBloom.value = rtBloomA.texture;
    bloomMat.uniforms.uStrength.value = bloom.strength;
    blit(renderer, bloomQuad, rtScene.texture);
  };

  const render = (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) => {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevMask = camera.layers.mask;

    const bloomOn = bloom.strength > 0.001;
    // 블룸을 켜면 씬을 버퍼에 그립니다 — 밝은 부분을 다시 읽어야 하므로.
    const sceneTarget = bloomOn ? rtScene : null;

    if (scale <= 1.0001) {
      // 층을 나눌 이득이 없으면 한 번에 그립니다 (패스 비용만 늘어납니다).
      camera.layers.enableAll();
      renderer.autoClear = true;
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
    } else {
      // ── 1) 배경 (저해상도, 불투명) ───────────────────────────────────
      camera.layers.set(LAYER_SOFT_SKY);
      renderer.autoClear = true;
      renderer.setRenderTarget(rtSky);
      renderer.render(scene, camera);

      // ── 2) 구름 덱 (저해상도, 투명) ──────────────────────────────────
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

      // ── 3) 합성 ──────────────────────────────────────────────────────
      renderer.setRenderTarget(sceneTarget);
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
    }

    if (bloomOn) {
      renderer.autoClear = false;
      runBloom(renderer);
    }

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
    setBloom: (cfg: Partial<BloomConfig>) => {
      Object.assign(bloom, cfg);
      if (cfg.scale !== undefined) {
        rtBloomA.setSize(bloomW(), bloomH());
        rtBloomB.setSize(bloomW(), bloomH());
      }
    },
    getBloom: () => ({ ...bloom }),
    dispose: () => {
      rtSky.dispose();
      rtCloud.dispose();
      rtScene.dispose();
      rtBloomA.dispose();
      rtBloomB.dispose();
      quad.dispose();
      opaqueMat.dispose();
      overMat.dispose();
      brightMat.dispose();
      blurMat.dispose();
      bloomMat.dispose();
    },
  };
}
