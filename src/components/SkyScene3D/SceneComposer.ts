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
 * 디더 — 8비트로 내려앉을 때 생기는 **밴딩**을 흩습니다.
 *
 * 넓고 완만한 그라데이션(노을 하늘이 정확히 그것입니다)에서는 인접한
 * 두 픽셀의 참값 차이가 1/255보다 작습니다. 그러면 여러 픽셀이 같은
 * 정수로 내려앉아 평평한 띠가 되고, 띠와 띠 사이에 눈에 띄는 계단이
 * 생깁니다. 양자화 직전에 1단계 미만의 잡음을 얹으면 그 경계가 픽셀마다
 * 다른 곳에서 갈려 계단이 흩어집니다.
 *
 * ⚠ **마지막 패스에서 해야 합니다.** 예전에는 스카이돔 셰이더가 자기
 * 디더를 뿌렸는데, 분리 해상도 합성이 들어오면서 스카이돔이 절반
 * 해상도로 그려지게 됐습니다. 절반에서 뿌린 디더는 쌍선형 확대에 섞여
 * 2×2 덩어리 잡음이 되고, 정작 화면 양자화는 확대 **뒤**에 일어나므로
 * 밴딩은 그대로 남습니다. 잡음만 얹고 문제는 못 잡는 상태였습니다.
 *
 * 해시는 sin 대신 Jimenez의 interleaved gradient noise를 씁니다. GLES2
 * mediump에서 `fract(sin(...))`는 기기마다 값이 갈려 디더가 줄무늬로
 * 뭉치는 일이 있습니다.
 */
const DITHER_GLSL = `
float ditherNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

/**
 * 저해상도 배경을 원해상도로 올리면서 디더를 겁니다.
 *
 * ⚠ **여기가 유일하게 맞는 자리입니다.** 세 군데를 재 보고 알았습니다.
 *
 *  - **후처리 마지막 패스**: 아무 일도 안 합니다. 중간 렌더 타깃이 8비트라
 *    합성이 읽는 값은 이미 정수로 내려앉아 있고, 거기에 ±0.5단계를 얹고
 *    다시 반올림하면 같은 정수로 돌아옵니다 (평탄구간 30.37 → 30.36).
 *  - **스카이돔 셰이더 안**: 듣기는 듣지만(30.37 → 5.85) 절반 해상도에서
 *    뿌린 잡음이라 쌍선형 확대에 절반쯤 깎이고, 세기를 3배로 올려도
 *    평탄구간이 3.13에서 더 안 내려갑니다. 원해상도 두 픽셀이 같은
 *    텍셀 쌍에서 나오는 한 구조적으로 못 내려갑니다.
 *  - **확대하는 이 패스**: 쌍선형 보간이 두 텍셀을 섞어 준 **연속값**을
 *    원해상도로 다시 양자화하는 지점입니다. 값이 아직 연속이고 해상도가
 *    이미 원해상도인 곳은 여기뿐입니다.
 */
const UPSCALE_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uDither;
varying vec2 vUv;
${DITHER_GLSL}
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  c += (ditherNoise(gl_FragCoord.xy) - 0.5) * uDither / 255.0;
  gl_FragColor = vec4(c, 1.0);
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

/**
 * 박명광선 — **빛을 더하지 않고 그늘을 뺍니다.**
 *
 * 처음에는 교과서대로 짰습니다: 밝은 부분을 뽑아 태양에서 바깥으로 방사형
 * 블러를 걸고 더하기. 재어 보니 살이 서지 않았습니다.
 *
 *   태양 +2°, 세기 0.5 → 이방성 1.075 → 0.991 (**떨어짐**), 포화 6.1% → 12.9%
 *
 * 이유가 둘 다 구조적이었습니다.
 *
 *  - 이 파이프라인은 **톤매핑 뒤(LDR)** 입니다. 태양 둘레는 이미 1.0에
 *    붙어 있어서, 무엇을 더하든 남는 것은 포화뿐입니다.
 *  - 노을에서 **태양 둘레에는 구름이 없습니다.** 덱은 위쪽에 뜨고 태양은
 *    그 아래 트인 띠에 놓입니다. 뚫을 구멍이 없으니 매끈한 밝은 판을
 *    흐린 결과, 즉 그냥 넓은 글로우가 나옵니다 — 그건 블룸이 이미 합니다.
 *
 * 그런데 실제 사진에서 빛내림이 읽히는 것은 밝은 살보다 **어두운 쐐기**
 * 쪽입니다. 그래서 뒤집었습니다. 구름 덱의 알파(=가림)를 태양에서 바깥으로
 * 방사형으로 번지게 해 **그늘 지도**를 만들고, 화면에 곱합니다.
 *
 * 더하기가 아니라 곱하기라 포화가 늘지 않습니다. 그리고 그늘은 하늘이
 * 밝을수록 뚜렷해지므로, 정작 필요한 노을에서 가장 잘 보입니다.
 *
 * ⚠ 두 가지를 셰이더 안에서 막습니다.
 *
 *  - **화면 밖 표본.** 렌더 타깃 랩이 ClampToEdge라 밖을 읽으면 가장자리
 *    픽셀이 복제되어 화면 끝에서 굵은 줄무늬가 뻗습니다.
 *  - **가림물 자신을 어둡게 하기.** 그늘은 구름과 눈 사이의 공기에 지는
 *    것입니다. 구름 자체를 또 어둡게 하면 덱이 두 번 그늘집니다. 도착
 *    픽셀의 가림값으로 나누듯 빼서, 트인 하늘에만 그늘이 앉게 합니다.
 */
const RAY_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uSunUv;
uniform vec2 uAspect;
uniform float uDensity;
uniform float uDecay;
uniform float uMaskInner;
uniform float uMaskOuter;
varying vec2 vUv;

const int RAY_SAMPLES = 12;

void main() {
  vec2 delta = (vUv - uSunUv) * (uDensity / float(RAY_SAMPLES));
  vec2 uv = vUv;
  float illum = 1.0;
  float acc = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < RAY_SAMPLES; i++) {
    uv -= delta;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0)
                 * step(0.0, uv.y) * step(uv.y, 1.0);
    acc += texture2D(uTex, uv).a * illum * inside;
    wsum += illum;
    illum *= uDecay;
  }
  float shade = acc / max(wsum, 1e-4);
  // 태양에서 멀어지면 잦아듭니다 — 화면 반대편까지 그늘이 가면 그건
  // 광선이 아니라 비네팅입니다.
  float d = length((vUv - uSunUv) * uAspect);
  shade *= 1.0 - smoothstep(uMaskInner, uMaskOuter, d);
  // 구름 자신은 빼둡니다.
  shade *= 1.0 - texture2D(uTex, vUv).a;
  gl_FragColor = vec4(vec3(shade), 1.0);
}
`;

/** (원본 + 블룸) × 그늘. 디더는 여기가 아니라 확대 패스가 겁니다. */
const BLOOM_COMPOSITE_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform sampler2D uRay;
uniform float uStrength;
uniform float uRayStrength;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(uTex, vUv).rgb;
  vec3 glow = texture2D(uBloom, vUv).rgb;
  float shade = texture2D(uRay, vUv).r;
  // 그늘은 **곱합니다**. 더하기였다면 이미 1.0에 붙은 노을 하늘에서
  // 포화만 늘었습니다 (파일 위 RAY_FRAG 주석의 측정값).
  gl_FragColor = vec4((base + glow * uStrength) * (1.0 - shade * uRayStrength), 1.0);
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
  // 세기·문턱을 함께 훑어서 골랐습니다(`build-bloom-sweep.js`, 태양 +2°).
  //
  // ⚠ **대기 흡수를 고친 뒤 다시 골랐습니다.** 시선 경로 오존과 고도별
  // 주변광이 들어오면서 하늘이 더 밝고 **평평해졌습니다** — 포화가 2.99%에서
  // 0.12%로 떨어진 대신 하위10이 129에서 147로 올라갔습니다. 그러면 화면
  // 대부분이 옛 문턱(0.72) 바로 아래에 몰려서, 블룸이 밝은 곳만 고르지
  // 못하고 통째로 들어올립니다 (선택도 23배 → 6배).
  //
  // 문턱을 0.88로 올려 다시 정말 밝은 것만 걸리게 했습니다. 태양 +2°에서
  // 세기 0.5일 때 상위10 +9.9 / 하위10 +0.8 / 포화 4.3% — 옛 하늘에서
  // 고른 지점과 같은 거래입니다.
  strength: 0.5,
  threshold: 0.88,
  knee: 0.22,
  scale: 4,
};

/**
 * 박명광선 설정. `strength: 0`이면 방사형 블러 패스를 건너뜁니다.
 *
 * 이 효과는 **태양이 화면 안(또는 근처)에 있고 충분히 높을 때만** 켜집니다.
 * 그 판정은 설정이 아니라 `render`가 매 프레임 카메라를 보고 합니다 —
 * 호출자가 잊어버릴 수 있는 것을 설정으로 두면 언젠가 잊습니다.
 */
export interface GodRayConfig {
  /** 더할 세기. 0 = 끔 */
  strength: number;
  /** 표본을 태양 쪽으로 얼마나 당길 것인가 (0~1). 광선의 길이입니다. */
  density: number;
  /** 표본마다 줄어드는 비율. 1에 가까울수록 멀리까지 뻗습니다. */
  decay: number;
  /** 태양에서 이 거리(화면 높이 기준)까지는 온전히 기여합니다 */
  maskInner: number;
  /** 이 거리를 넘으면 기여가 0 — 달·반대편 노을을 끌어오지 않게 합니다 */
  maskOuter: number;
}

export const DEFAULT_GOD_RAYS: GodRayConfig = {
  // 세기를 훑어서 골랐습니다(`build-godray-sweep.js`, 태양 +2°).
  // 이방성 1.129 → 1.144(0.2) → 1.148(0.35) → 1.153(0.5),
  // 포화 2.40% → 1.94% → 1.73% → 1.65%.
  // 0.35 위로는 이방성이 거의 안 오르는데 하늘 전체가 눈에 띄게 죽습니다
  // (중앙 190.3 → 188.8). 0.35가 그 무릎입니다.
  strength: 0.35,
  density: 0.6,
  decay: 0.94,
  maskInner: 0.12,
  maskOuter: 0.55,
};

/**
 * 광선이 사는 태양 고도 구간.
 *
 * 이름 그대로 **박명**광선입니다. 해가 낮을 때 대기를 길게 통과한 빛이
 * 구름에 잘려 생기는 현상이고, 그때만 살아 있어야 합니다. 측정도 같은
 * 말을 했습니다 — 태양이 6° 위로 올라가면 그늘 지도가 태양 둘레를 통째로
 * 덮어 광선이 아니라 **어두운 비네팅**이 되고, 화면에 고리 자국이 남습니다
 * (`build-godray-sweep.js`의 고도 훑기).
 *
 * 네 점 모두 램프로 넘깁니다. 문턱으로 자르면 시각이 흐를 때 광선이 한
 * 프레임에 툭 나타나거나 사라집니다.
 */
const RAY_ALT_OFF = -8;
const RAY_ALT_FULL = -2;
const RAY_ALT_HIGH_FULL = 6;
const RAY_ALT_HIGH_OFF = 12;

/**
 * 태양이 화면 밖으로 나가도 광선은 남습니다 — 실제로 화면 밖 태양의 광선이
 * 가장 흔한 구도입니다. 다만 무한정 두면 태양이 등 뒤로 갈 때까지 남으므로,
 * NDC로 이만큼 벗어나는 동안 잦아들게 합니다 (1.0 = 반화면).
 */
const RAY_OFFSCREEN_MARGIN = 1.0;

/**
 * 디더 세기 (1/255 단위). 1이면 ±0.5단계 — 밴딩을 흩기에는 충분하고
 * 잡음으로 보이기에는 모자란 크기입니다.
 */
export const DEFAULT_DITHER = 1;

/** 0~1 구간으로 부드럽게 올리는 램프. 문턱으로 자르면 툭 튑니다. */
function ramp(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

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
  /** 박명광선 설정. `strength: 0`이면 방사형 블러를 건너뜁니다. */
  setGodRays: (cfg: Partial<GodRayConfig>) => void;
  getGodRays: () => GodRayConfig;
  /**
   * 광선의 기준점. 월드 좌표계의 **태양 방향**(정규화 여부 무관)과 고도를
   * 넘깁니다. `null`이면 광선을 끕니다.
   *
   * 화면 좌표는 여기서 저장만 하고 `render`가 그때의 카메라로 투영합니다 —
   * 카메라가 움직이는 프레임에 호출자가 다시 넣어 주기를 기대하면 언젠가
   * 한 프레임 늦은 광선이 나옵니다.
   */
  setSun: (dirWorld: THREE.Vector3 | null, altitudeDeg: number) => void;
  /**
   * 디더 세기 (1/255 단위). 0이면 끕니다.
   *
   * 저해상도 배경을 원해상도로 확대하는 패스에서 걸립니다 — 값이 아직
   * 연속이면서 해상도가 이미 원해상도인 유일한 지점입니다. 배율 1(한 번에
   * 그리는 경로)에는 그 패스가 없으므로 디더도 없습니다.
   */
  setDither: (amount: number) => void;
  getDither: () => number;
  /**
   * 검증용 — 마지막 프레임에 실제로 들어간 광선 세기. 고도·화면 밖 감쇠가
   * 모두 곱해진 뒤의 값이라, 밤에 0인지 같은 것을 이걸로 잽니다.
   */
  lastRayGain: () => number;
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
  bloomCfg: BloomConfig = DEFAULT_BLOOM,
  rayCfg: GodRayConfig = DEFAULT_GOD_RAYS,
  ditherAmount: number = DEFAULT_DITHER
): SceneComposerHandle {
  let w = Math.max(1, Math.floor(width));
  let h = Math.max(1, Math.floor(height));
  let scale = Math.max(1, softScale);
  const bloom: BloomConfig = { ...bloomCfg };
  const rays: GodRayConfig = { ...rayCfg };
  let dither = Math.max(0, ditherAmount);

  let sunDirWorld: THREE.Vector3 | null = null;
  let sunAltDeg = 90;
  let rayGain = 0;
  const sunPoint = new THREE.Vector3();
  const sunView = new THREE.Vector3();

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
  /**
   * 광선 버퍼. 블룸의 흐리기가 `rtBloomA`를 덮어쓰기 때문에 따로 둡니다 —
   * 광선은 **흐려지기 전의** 밝은 부분에서 뽑아야 살이 살아 있습니다.
   */
  const rtRay = new THREE.WebGLRenderTarget(bloomW(), bloomH(), rtOptions);

  const quad = new THREE.PlaneGeometry(2, 2);
  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 배경 blit — 저해상도 하늘을 원해상도로 올리면서 디더를 겁니다.
  const opaqueMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uDither: { value: dither },
    },
    vertexShader: BLIT_VERT,
    fragmentShader: UPSCALE_FRAG,
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
  const rayMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uDensity: { value: rays.density },
      uDecay: { value: rays.decay },
      uMaskInner: { value: rays.maskInner },
      uMaskOuter: { value: rays.maskOuter },
    },
    vertexShader: BLIT_VERT,
    fragmentShader: RAY_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const bloomMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uBloom: { value: null as THREE.Texture | null },
      uRay: { value: null as THREE.Texture | null },
      uStrength: { value: bloom.strength },
      uRayStrength: { value: 0 },
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
  const rayQuad = new THREE.Mesh(quad, rayMat);
  const bloomQuad = new THREE.Mesh(quad, bloomMat);
  rayQuad.frustumCulled = false;
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
    rtRay.setSize(bloomW(), bloomH());
  };

  /**
   * 이번 프레임에 광선이 실제로 얼마나 들어갈지. 세 가지를 곱합니다:
   * 설정 세기 × 태양 고도 감쇠 × 화면 밖 감쇠. 0이면 방사형 블러 패스를
   * 통째로 건너뜁니다.
   *
   * ⚠ **카메라 뒤의 태양은 반드시 걸러야 합니다.** 투영은 카메라 뒤의 점도
   * 화면 좌표를 내놓는데 그 좌표는 뒤집혀 있어서, 광선이 엉뚱한 점으로
   * 모여드는 그림이 나옵니다. 뷰 공간 z로 먼저 자릅니다.
   */
  const computeRayGain = (camera: THREE.Camera): number => {
    if (!sunDirWorld || rays.strength <= 0.001) return 0;

    const altFade =
      ramp(sunAltDeg, RAY_ALT_OFF, RAY_ALT_FULL) *
      (1 - ramp(sunAltDeg, RAY_ALT_HIGH_FULL, RAY_ALT_HIGH_OFF));
    if (altFade <= 0) return 0;

    sunView.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
    if (sunView.z >= 0) return 0; // 카메라 뒤

    // 카메라 위치에서 태양 방향으로 멀리 찍은 점 — 방향만 쓰므로 거리는
    // 원근에 묻힐 만큼이면 됩니다.
    sunPoint.copy(sunDirWorld).normalize().multiplyScalar(1e4).add(camera.position);
    sunPoint.project(camera);
    (rayMat.uniforms.uSunUv.value as THREE.Vector2).set(
      sunPoint.x * 0.5 + 0.5,
      sunPoint.y * 0.5 + 0.5
    );

    const offX = Math.max(0, Math.abs(sunPoint.x) - 1);
    const offY = Math.max(0, Math.abs(sunPoint.y) - 1);
    const edgeFade = 1 - ramp(Math.hypot(offX, offY), 0, RAY_OFFSCREEN_MARGIN);

    return rays.strength * altFade * edgeFade;
  };

  /**
   * 후처리 체인. 완성된 씬(rtScene)을 읽어 화면에 원본 + 번짐 + 광선을 씁니다.
   *
   * 밝은 부분 뽑기는 **한 번만** 합니다 — 블룸과 광선이 같은 것을 원하기
   * 때문입니다. 다만 광선은 흐려지기 **전**의 것을 써야 살이 살아 있어서,
   * 분리 블러가 `rtBloomA`를 덮어쓰기 전에 먼저 뽑아 둡니다.
   */
  const runPost = (
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    softPathUsed: boolean
  ) => {
    const bloomOn = bloom.strength > 0.001;
    // 그늘 지도는 구름 덱 버퍼에서 나옵니다. 한 번에 그리는 경로(배율 1)에는
    // 그 버퍼가 없으므로 광선도 없습니다 — 틀린 그늘보다 없는 편이 낫습니다.
    rayGain = softPathUsed ? computeRayGain(camera) : 0;

    // 1) 밝은 부분 뽑기 (1/4 해상도) — 둘이 함께 씁니다.
    brightMat.uniforms.uThreshold.value = bloom.threshold;
    brightMat.uniforms.uKnee.value = bloom.knee;
    renderer.setRenderTarget(rtBloomA);
    renderer.clear(true, false, false);
    blit(renderer, brightQuad, rtScene.texture);

    // 2) 광선 — 태양에서 바깥으로 방사형 블러. 블러 전 밝은 부분에서 뽑습니다.
    if (rayGain > 0) {
      rayMat.uniforms.uDensity.value = rays.density;
      rayMat.uniforms.uDecay.value = rays.decay;
      rayMat.uniforms.uMaskInner.value = rays.maskInner;
      rayMat.uniforms.uMaskOuter.value = rays.maskOuter;
      // 마스크를 화면비와 무관한 원으로 만듭니다 — 안 하면 가로로 찌그러진
      // 타원이 되어 좌우 그늘만 길어집니다.
      (rayMat.uniforms.uAspect.value as THREE.Vector2).set(w / Math.max(1, h), 1);
      renderer.setRenderTarget(rtRay);
      renderer.clear(true, false, false);
      // 그늘의 원천은 **구름 덱 버퍼의 알파**입니다. 밝은 부분이 아니라
      // 가린 부분에서 뽑습니다 (파일 위 RAY_FRAG 주석).
      blit(renderer, rayQuad, rtCloud.texture);
    }

    // 3) 블룸 — 가로 → 세로 분리 블러
    if (bloomOn) {
      const bw = bloomW(), bh = bloomH();
      (blurMat.uniforms.uStep.value as THREE.Vector2).set(1 / bw, 0);
      renderer.setRenderTarget(rtBloomB);
      renderer.clear(true, false, false);
      blit(renderer, blurQuad, rtBloomA.texture);

      (blurMat.uniforms.uStep.value as THREE.Vector2).set(0, 1 / bh);
      renderer.setRenderTarget(rtBloomA);
      renderer.clear(true, false, false);
      blit(renderer, blurQuad, rtBloomB.texture);
    }

    // 4) 화면에 원본 + 번짐 + 광선
    renderer.setRenderTarget(null);
    bloomMat.uniforms.uBloom.value = rtBloomA.texture;
    // 꺼져 있어도 샘플러는 묶어 둡니다 — 안 묶인 sampler2D 는 기기에 따라
    // 경고나 검정 이상의 것을 냅니다. 세기 0이라 결과에는 영향이 없습니다.
    bloomMat.uniforms.uRay.value = rtRay.texture;
    bloomMat.uniforms.uStrength.value = bloomOn ? bloom.strength : 0;
    bloomMat.uniforms.uRayStrength.value = rayGain;
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

    // 블룸이든 광선이든 **완성된 그림을 다시 읽어야** 합니다. 기본
    // 프레임버퍼는 읽을 수 없으므로 후처리가 하나라도 켜져 있으면 씬을
    // 버퍼에 그립니다. 둘 다 꺼져 있으면 예전처럼 곧장 화면에 그립니다.
    const softPath = scale > 1.0001;
    const postOn =
      bloom.strength > 0.001 ||
      (softPath && rays.strength > 0.001 && sunDirWorld !== null);
    const sceneTarget = postOn ? rtScene : null;

    if (!softPath) {
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
      opaqueMat.uniforms.uDither.value = dither;
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

    if (postOn) {
      renderer.autoClear = false;
      runPost(renderer, camera, softPath);
    } else {
      rayGain = 0;
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
        rtRay.setSize(bloomW(), bloomH());
      }
    },
    getBloom: () => ({ ...bloom }),
    setGodRays: (cfg: Partial<GodRayConfig>) => {
      Object.assign(rays, cfg);
    },
    getGodRays: () => ({ ...rays }),
    setSun: (dirWorld: THREE.Vector3 | null, altitudeDeg: number) => {
      if (dirWorld) {
        sunDirWorld = (sunDirWorld ?? new THREE.Vector3()).copy(dirWorld);
      } else {
        sunDirWorld = null;
      }
      sunAltDeg = altitudeDeg;
    },
    setDither: (amount: number) => {
      dither = Math.max(0, amount);
    },
    getDither: () => dither,
    lastRayGain: () => rayGain,
    dispose: () => {
      rtSky.dispose();
      rtCloud.dispose();
      rtScene.dispose();
      rtBloomA.dispose();
      rtBloomB.dispose();
      rtRay.dispose();
      quad.dispose();
      opaqueMat.dispose();
      overMat.dispose();
      brightMat.dispose();
      blurMat.dispose();
      rayMat.dispose();
      bloomMat.dispose();
    },
  };
}
