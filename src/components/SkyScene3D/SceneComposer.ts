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
 * ⚠ **실제 합성 순서는 위 목록과 다릅니다**(§94). 산 능선이 구름 앞을 가리게
 *   하려고 구름을 MID **앞에** 얹도록 바뀌었는데(하늘 → 구름 → MID → FRONT), 그러면서
 *   MID 에 있던 해·달·별이 구름 위로 올라갔습니다. 그래서 천체만 따로
 *   `LAYER_CELESTIAL`(5)로 떼어 하늘과 구름 사이에 그립니다:
 *
 *     하늘 → 천체(해·달·별·은하수) → 구름 → MID(지면·지형) → FRONT
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
/** 저해상도 · 불투명 배경 */
export const LAYER_SOFT_SKY = 1;
/** 원해상도 · 구름 아래 (별·은하수·지형·태양) */
export const LAYER_MID = 2;
/** 저해상도 · 투명 (구름 덱) */
export const LAYER_SOFT_CLOUD = 3;
/** 원해상도 · 구름 위 (빌보드·경로·달) */
export const LAYER_FRONT = 4;
/**
 * 원해상도 · **구름 아래** 천체 (해·달·별·은하수) — §94.
 *
 * 저해상도 경로는 하늘 → 구름 → MID 순서로 합성합니다(산이 구름 앞을 가리도록). 그런데
 * 해·달·별도 MID 에 있어서 **구름 위에** 그려졌습니다 — 흐린 새벽 해가 불투명한 구름(τ > 40)
 * 을 뚫고 보이고, 달이 구름 앞에 떴습니다. 천체는 하늘 바로 다음, 구름 전에 그립니다.
 * 한 번에 그리는 경로(배율 1)는 renderOrder(해 −0.55 · 별 −0.5 < 구름 0)가 이미 그 순서입니다.
 */
export const LAYER_CELESTIAL = 5;
/**
 * 저해상도 · 투명 · **산 다음** — 발밑 운해와 구름 속 안개(§96, `CloudSlab.meshBelow`).
 *
 * 구름을 산 앞에 얹으면(하늘 → 구름 → 산) 하늘 구름은 산 뒤로 잘 가지만 발밑 운해를 지형
 * 격자가 통째로 덮습니다. 산 뒤에 얹으면 반대입니다. 그래서 관측자 아래 층만 따로 떼어 산
 * 다음에 얹습니다 — 먼 골짜기 앞의 운해는 보이고, 가까운 사면은 슬랩의 DEM 가림(§83)이 비웁니다.
 */
export const LAYER_SOFT_CLOUD_BELOW = 6;
/**
 * **지형 거리 판** (§117) — 지형의 쌍둥이 메시(`TerrainField.distMesh`)만 여기 둡니다. 합성기가 구름 해상도로
 * 따로 그려, 화소마다 "눈에서 지형까지 거리(km)" 를 `TERRAIN_DIST_GLSL` 로 적습니다. 구름 슬랩은 그 값과 층마다
 * 구름까지 거리를 견줘 스스로 가립니다 — 그리는 순서로 겹침을 흉내 낼 필요가 없어집니다(§94·§96·§116 대체).
 * 화면에 직접 그려지면 안 되므로 어떤 합성 패스에도 이 층은 켜지 않습니다.
 */
export const LAYER_TERRAIN_DIST = 7;
/**
 * **지형 빛 판** (§129) — 볼륨 하늘이 켜졌을 때만 씁니다. 지형의 쌍둥이 메시(`TerrainField.litMesh`)가 화소마다
 * 알베도(선형 rgb)와 햇빛 몫(a = ndl × 산·구름 그림자)을 적고, 볼륨 하늘(takram)이 그 위에 해·하늘 조도와 대기 원근,
 * 하늘과 같은 노출·표시 곡선을 입혀 지형 화소를 통째로 칠합니다. 거리 판처럼 화면에 직접 그리지 않습니다.
 */
export const LAYER_TERRAIN_LIT = 8;

/**
 * 지형 거리의 부호화(§117). 8비트 RGBA 두 칸(R·G)에 16비트로 log2 거리를 담습니다 — 1m ~ 1048km 를
 * 20옥타브로, 한 칸 0.02%. 부동소수 렌더 타깃은 GLES2 기기에서 갈리므로 쓰지 않습니다. 지운 값(1,1)은
 * "지형 없음" 입니다(`terrainDistDecodeKm` 가 1e9 를 냄).
 */
export const TERRAIN_DIST_GLSL = `
vec4 terrainDistEncode(float km){
  float t = clamp(log2(max(km, 1e-3) / 1e-3) / 20.0, 0.0, 0.9999);
  float v = floor(t * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec4(hi / 255.0, (v - hi * 256.0) / 255.0, 0.0, 1.0);
}
float terrainDistDecodeKm(vec4 c){
  float t = (floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5)) / 65535.0;
  return t > 0.99995 ? 1e9 : 1e-3 * exp2(t * 20.0);
}
`;

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

/**
 * **Catmull-Rom 재구성 (5탭)** — 저해상도 버퍼를 원해상도로 늘릴 때 씁니다.
 *
 * 왜 필요한가: 하늘과 구름은 절반 해상도로 그린 뒤 확대합니다. 그동안
 * 확대는 `texture2D` 한 번, 곧 **이중선형**이었습니다. 2배 확대에서
 * 이중선형은 삼각형 커널이라 원본에 있던 잔결을 그대로 뭉갭니다.
 *
 * 재봤습니다 (`build-app-vs-harness.js`, 세부 = 이웃 화소 밝기차 평균):
 *
 *   태양   원해상도   절반+이중선형   손실
 *    +25°    1.419        0.987       -30%
 *     +2°    1.834        1.355       -26%
 *      0°    2.145        1.532       -29%
 *     -3°    2.156        1.511       -30%
 *
 * 색·휘도·채도는 소수점까지 같았습니다. 앱 그림이 하네스 그림과 다른 것은
 * **오직 이 선명도 손실**이었습니다 (블룸·박명광선·디더는 거의 무해).
 *
 * Catmull-Rom 은 음의 로브가 있어 가장자리를 되살립니다. 5탭 근사는
 * 4×4 바이큐빅의 모서리 넷을 버리고 남은 무게로 정규화한 것으로,
 * 게임 엔진의 TAA 업스케일러가 쓰는 표준형입니다.
 *
 * ⚠ **highp 가 필요합니다.** 좌표 계산이 텍셀 단위(수백)로 올라가는데
 * mediump 는 그 크기에서 해상도가 0.5 텍셀이라 `floor(p - 0.5)` 가
 * 깨집니다.
 *
 * ⚠ 음의 로브 때문에 결과가 음수가 될 수 있습니다. 구름 버퍼는 **미리곱된**
 * 알파라 음수 알파가 그대로 합성에 들어가면 검은 테가 생깁니다. 0으로
 * 잘라 내보냅니다.
 */
const CATMULL_GLSL = `
uniform float uCatmull;   // 0 이면 이중선형 — 하네스가 기준선을 재는 스위치
vec4 catmullRom(sampler2D tex, vec2 uv, vec2 texSize){
  if (uCatmull < 0.5) return max(vec4(0.0), texture2D(tex, uv));
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  vec2 w12 = w1 + w2;
  vec2 off12 = w2 / w12;

  vec2 p0  = (texPos1 - 1.0) / texSize;
  vec2 p3  = (texPos1 + 2.0) / texSize;
  vec2 p12 = (texPos1 + off12) / texSize;

  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float wa = w12.x * w0.y;  acc += texture2D(tex, vec2(p12.x, p0.y))  * wa; wsum += wa;
  float wb = w0.x  * w12.y; acc += texture2D(tex, vec2(p0.x,  p12.y)) * wb; wsum += wb;
  float wc = w12.x * w12.y; acc += texture2D(tex, vec2(p12.x, p12.y)) * wc; wsum += wc;
  float wd = w3.x  * w12.y; acc += texture2D(tex, vec2(p3.x,  p12.y)) * wd; wsum += wd;
  float we = w12.x * w3.y;  acc += texture2D(tex, vec2(p12.x, p3.y))  * we; wsum += we;

  return max(vec4(0.0), acc / max(1e-4, wsum));
}
`;

const BLIT_FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
/**
 * §117 깊이를 아는 확대. 구름은 절반 해상도로, 지형 거리 판은 원해상도로 그립니다. 그냥 늘리면 능선에서
 * "산 뒤라 구름 없음" 표본이 하늘 쪽으로 번져 틈이 생기고(요네자와 해돋이: 능선 위로 해가 42화소 샘),
 * 하늘 쪽 구름은 산 쪽으로 번집니다. 이 화소와 **같은 쪽**(지형 거리가 비슷한) 저해상도 표본만 섞습니다
 * — 이웃 넷이 다 같은 쪽이면 예전 재구성 그대로입니다.
 */
uniform sampler2D uDist;
uniform float uDistOn;
varying vec2 vUv;
${CATMULL_GLSL}
${TERRAIN_DIST_GLSL}
float distClass(vec2 uv){
  float km = terrainDistDecodeKm(texture2D(uDist, uv));
  return km > 1e8 ? 40.0 : log2(km);          // 하늘(지형 없음)은 멀리 떨어진 한 값
}
void main() {
  vec4 base = catmullRom(uTex, vUv, uTexSize);
  if (uDistOn < 0.5) { gl_FragColor = base; return; }
  float here = distClass(vUv);
  vec2 p = vUv * uTexSize - 0.5;
  vec2 f = fract(p), i0 = floor(p);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  bool mismatch = false;
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(mod(float(k), 2.0), floor(float(k) / 2.0));
    vec2 uvT = (i0 + o + 0.5) / uTexSize;
    bool same = abs(distClass(uvT) - here) < 0.5;   // 거리 41% 안 — 같은 사면·같은 하늘
    if (!same) mismatch = true;
    float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y) * (same ? 1.0 : 0.0);
    acc += w * texture2D(uTex, uvT);
    wsum += w;
  }
  if (!mismatch) { gl_FragColor = base; return; }
  gl_FragColor = wsum > 1e-4 ? acc / wsum : texture2D(uTex, (floor(vUv * uTexSize) + 0.5) / uTexSize);
}
`;

/**
 * §127 선형 → sRGB 부호화. 볼륨 하늘 텍스처(postprocessing 의 반정밀도 버퍼)는 톤매핑 뒤 **선형** 값입니다 — 화면에 바로
 * 그릴 때만 postprocessing 이 sRGB 로 바꿉니다. §126.8 은 그것을 표시 값으로 그대로 깔아 하늘 화면의 볼륨 하늘이 어둡고
 * 채도가 높았습니다(같은 장면 바로 그리기와 최대 135 단계 차, 노을 '가장 붉은 곳' G/R 0.43 대 0.72).
 */
const SRGB_ENCODE_GLSL = `
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;

/**
 * §127 볼륨 하늘(밖에서 그린 하늘 텍스처) 전용 두 패스. 그 텍스처는 rgb = 선형 색(하늘 + 구름, 톤매핑 뒤),
 * **알파 = 구름 불투명도**(`volumetricScene.renderToTexture`)이고, 지형 화소에서는 하늘을 검게 비우고 지형 앞 구름만 담습니다.
 * 두 패스 모두 sRGB 로 부호화해 얹습니다.
 *
 * - 천체 가리기(EXT_MASK): 천체(해·달·별·은하수)를 하늘 위에 그린 뒤, 같은 하늘 텍스처를 알파(불투명도)만큼 다시
 *   덮습니다 — 결과 = 천체가 얹힌 하늘 × 투과율 + 하늘 × 불투명도. 천체가 더하기로 그려졌든 덮어 그려졌든
 *   "천체가 보탠 몫 × 투과율" 이 됩니다(해 원반이 두꺼운 구름을 뚫던 것, 별이 구름 위에 뜨던 것).
 * - 지형 앞 구름(EXT_FRONT): 지형을 그린 뒤 지형 화소에만 그 텍스처를 미리곱 over 로 다시 얹습니다.
 *   구름 행진은 지형 거리에서 멈췄으므로 여기 담긴 것은 지형 **앞** 구름뿐입니다.
 */
const EXT_MASK_FRAG = `
precision highp float;
uniform sampler2D uTex;
varying vec2 vUv;
${SRGB_ENCODE_GLSL}
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(linearToSrgb(t.rgb), clamp(t.a, 0.0, 1.0));
}
`;
const EXT_FRONT_FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uDist;
varying vec2 vUv;
${TERRAIN_DIST_GLSL}
${SRGB_ENCODE_GLSL}
void main() {
  if (terrainDistDecodeKm(texture2D(uDist, vUv)) > 1e8) discard;
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(linearToSrgb(t.rgb), clamp(t.a, 0.0, 1.0));
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
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform float uDither;
/** 1 이면 선형 값을 sRGB 로 부호화(§127 볼륨 하늘 텍스처). 하늘돔 버퍼는 이미 표시 값이라 0. */
uniform float uEncodeSrgb;
varying vec2 vUv;
${DITHER_GLSL}
${CATMULL_GLSL}
${SRGB_ENCODE_GLSL}
void main() {
  vec3 c = catmullRom(uTex, vUv, uTexSize).rgb;
  if (uEncodeSrgb > 0.5) c = linearToSrgb(c);
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
  //
  // ⚠ 이 문턱은 **표시 공간**의 값입니다. 톤매핑을 바꾸면 같은 복사휘도가
  // 다른 표시값이 되므로 반드시 같이 옮겨야 합니다 — ACES(노출0.62)의
  // 0.88 은 AgX(노출0.90)에서 0.764 입니다. 42절에서 AgX 로 갈면서 이걸
  // 안 옮겼더니 블룸이 전 장면에서 한 번도 안 걸렸습니다(포화 0%).
  // (AgX 는 되돌렸으므로 값은 0.88 로 돌아왔습니다.)
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
  /**
   * 도트 모드(§97). `rows` 는 내부 세로 화소 수 — 0 이면 끕니다. 화면에는 최근접으로 늘립니다.
   */
  setPixelArt: (rows: number) => void;
  /** 실제로 그리는 내부 크기 — 도트 모드면 화면보다 작습니다. 구름 슬랩 해상도가 이걸 씁니다. */
  renderSize: () => { width: number; height: number };
  /** 이번 설정에서 저해상도 층 경로를 쓰는가 — 구름 슬랩 해상도를 고를 때 씁니다. */
  softActive: () => boolean;
  render: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;
  /**
   * §117 — 지형 거리 판을 켭니다. 켜면 매 프레임 `LAYER_TERRAIN_DIST` 를 원해상도로 그리고, 구름을
   * 지형 **다음에** 한 번 얹습니다(하늘 → 천체 → 지형 → 구름 → 앞). 구름 슬랩에는
   * `terrainDistanceTexture()` 를 넘겨 스스로 가리게 해야 합니다. 끄면 예전 순서(§94·§96) 그대로입니다.
   */
  setTerrainDistance: (on: boolean) => void;
  /**
   * §126.7 — 하늘 층을 밖에서 그린 텍스처(takram 볼륨 하늘+구름, **선형** 색 — 합성기가 sRGB 로 부호화, §127)로 바꿉니다. null 이면 하늘돔.
   * 켜져 있으면 LAYER_SOFT_SKY 를 그리지 않고 이 텍스처를 배경으로 깝니다(구름 슬랩 층은 호출자가 숨깁니다).
   */
  setExternalSky: (tex: THREE.Texture | null) => void;
  /**
   * §127 지형 거리 판을 **지금** 그립니다(합성 전에 다른 패스가 같은 프레임의 판을 읽어야 할 때 — 볼륨 하늘의 구름
   * 행진). 그린 프레임에는 `render` 가 다시 그리지 않습니다. 지형 거리 판이 꺼져 있으면 아무것도 안 합니다.
   */
  prepareTerrainDistance: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;
  /** 지형 거리 판의 텍스처(원해상도 — 구름 슬랩은 제 화소 가운데를 정규화 좌표로 읽습니다). */
  terrainDistanceTexture: () => THREE.Texture;
  /**
   * §129 지형 빛 판(`LAYER_TERRAIN_LIT`)을 거리 판과 함께 그립니다 — 볼륨 하늘이 지형 화소를 칠할 때만 켭니다.
   * 거리 판이 켜져 있어야 그려집니다.
   */
  setTerrainLit: (on: boolean) => void;
  /** 지형 빛 판의 텍스처(켜져 있을 때만, 아니면 null). */
  terrainLitTexture: () => THREE.Texture | null;
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
   * 저해상도 버퍼를 원해상도로 되돌릴 때 쓰는 재구성 필터.
   *
   * 앱은 늘 'catmull' 입니다 — 이 스위치는 하네스가 **기준선을 재기 위해**
   * 씁니다. "카트멀롬이 이중선형보다 세부를 몇 % 더 살리는가"를 상수로
   * 적어 두면 셰이더를 손볼 때마다 그 상수가 낡습니다. 두 경로를 같은
   * 프레임에서 나란히 재면 낡을 일이 없습니다.
   */
  setReconstruct: (mode: 'catmull' | 'bilinear') => void;
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
  // 화면(드로잉 버퍼) 크기와, 실제로 그리는 **내부** 크기. 도트 모드(§97)가 꺼져 있으면 같습니다.
  let fullW = Math.max(1, Math.floor(width));
  let fullH = Math.max(1, Math.floor(height));
  let pixelRows = 0;
  let pixelFactor = 1;
  let w = fullW;
  let h = fullH;
  // 도트 한 칸 = 화면 **정수** 화소(pixelFactor). 화면 높이가 줄 수의 배수가 아니면 그냥 늘릴 때
  // 도트가 4·5화소로 섞여 줄무늬가 생깁니다. 줄 수는 요청에 가장 가까운 정수 배율에서 나옵니다.
  const fitInternal = () => {
    if (pixelRows > 0 && pixelRows < fullH) {
      pixelFactor = Math.max(2, Math.round(fullH / pixelRows));
      h = Math.ceil(fullH / pixelFactor);
      w = Math.ceil(fullW / pixelFactor);
    } else {
      pixelFactor = 1;
      w = fullW; h = fullH;
    }
  };
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
  const rtCloudBelow = new THREE.WebGLRenderTarget(softW(), softH(), rtOptions);
  // §117 지형 거리 판 — 부호화한 거리를 담으므로 걸러 섞으면 안 됩니다(최근접). 지형 격자는 한 메시 안에서
  // 앞뒤 능선이 겹치므로 깊이 버퍼로 가장 가까운 것을 남깁니다. **원해상도**입니다 — 구름(저해상도)은 제 화소
  // 가운데에서 읽고, 구름을 늘리는 합성이 원해상도 화소마다 같은 쪽 표본을 고를 때도 씁니다.
  const rtDist = new THREE.WebGLRenderTarget(w, h, {
    ...rtOptions, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
  });
  let terrainDistOn = false;
  // §129 지형 빛 판(알베도·햇빛 몫, 8비트 — 값이 0~1). 거리 판과 같은 원해상도·최근접·깊이 버퍼(앞 능선이 이김).
  const rtLit = new THREE.WebGLRenderTarget(w, h, {
    ...rtOptions, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
  });
  let terrainLitOn = false;
  /** §126.7 밖에서 그린 하늘(선형 색 + 알파 = 구름 불투명도, §127). null 이면 하늘돔 층을 그립니다. */
  let externalSky: THREE.Texture | null = null;
  /**
   * 블룸을 켜면 씬을 화면이 아니라 여기에 그립니다 — 밝은 부분을 뽑으려면
   * 완성된 그림을 **다시 읽어야** 하는데, 기본 프레임버퍼는 그럴 수
   * 없습니다. 블룸이 꺼져 있으면 이 버퍼는 쓰이지 않습니다.
   */
  /**
   * ⚠ **씬 버퍼만 깊이를 가집니다.**
   *
   * 나머지 버퍼는 전면 사각형을 한 번 칠할 뿐이라 깊이가 필요 없습니다.
   * 그런데 씬 버퍼는 다릅니다 — 여기에 지형·태양·달·별이 함께 그려집니다.
   *
   * 깊이 없이 두면 순서가 **화가 알고리즘뿐**인데, three.js 는 불투명을
   * 전부 그린 뒤 투명을 그리고 `renderOrder` 는 각 큐 안에서만 정렬합니다.
   * 태양은 `transparent: true` 이고 지형은 불투명이므로, 태양의
   * `renderOrder = -0.55`("지형보다 뒤에 그려야 땅 뒤에서 솟아오릅니다")가
   * **의도대로 동작한 적이 없었습니다.** 태양의 `depthTest: true` 도 깊이
   * 버퍼가 없어 무의미했습니다.
   *
   * 잰 것(`verify-terrain-occlusion.js`, 8° 능선 아래 5.98° 태양):
   * 산이 있으나 없으나 태양 밝기가 248.25 로 **같았습니다.**
   *
   * 깊이를 켜면 `depthTest: true` 인 것들(태양·달·빌보드·천체경로)이 지형과
   * 제대로 겨룹니다 — 이 파일 머리말이 원래 그렇게 적고 있습니다
   * ("빌보드는 `depthTest: true`라 지형과 깊이 비교를 합니다").
   */
  const rtSceneOptions: THREE.RenderTargetOptions = { ...rtOptions, depthBuffer: true };
  const rtScene = new THREE.WebGLRenderTarget(w, h, rtSceneOptions);
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
      uTexSize: { value: new THREE.Vector2(1, 1) },
      uCatmull: { value: 1 },
      uDither: { value: dither },
      uEncodeSrgb: { value: 0 },
    },
    vertexShader: BLIT_VERT,
    fragmentShader: UPSCALE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  // 구름 blit — **미리곱해진** 색을 얹습니다 (파일 상단 알파 합성 주석).
  const overMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uTexSize: { value: new THREE.Vector2(1, 1) },
      uCatmull: { value: 1 },
      uDist: { value: null as THREE.Texture | null },
      uDistOn: { value: 0 },
    },
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

  // §127 볼륨 하늘 — 천체 가리기(보통 알파 합성, 목적지 알파는 그대로)와 지형 앞 구름(미리곱 over).
  const extMaskMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null as THREE.Texture | null } },
    vertexShader: BLIT_VERT,
    fragmentShader: EXT_MASK_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const extFrontMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null as THREE.Texture | null }, uDist: { value: null as THREE.Texture | null } },
    vertexShader: BLIT_VERT,
    fragmentShader: EXT_FRONT_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
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
  const extMaskQuad = new THREE.Mesh(quad, extMaskMat);
  const extFrontQuad = new THREE.Mesh(quad, extFrontMat);
  extMaskQuad.frustumCulled = false;
  extFrontQuad.frustumCulled = false;

  /**
   * **도트 모드**(§97) — 장면 전체를 세로 `pixelRows` 화소로 그리고, 화면에는 **최근접**으로
   * 늘려 네모 화소 그대로 올립니다. 분석용 판(320px)을 크게 볼 때의 그 느낌입니다.
   * 합성 경로의 마지막 출력(원래 화면)을 이 버퍼로 돌리고, 끝에서 한 번 늘립니다.
   * 지형·태양이 여기 직접 그려질 수 있으므로 깊이가 필요합니다.
   */
  const rtPixel = new THREE.WebGLRenderTarget(w, h, {
    ...rtOptions, depthBuffer: true,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const copyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null },
      uTexSize: { value: new THREE.Vector2(1, 1) },
      uFactor: { value: 1 },
    },
    vertexShader: BLIT_VERT,
    // 화면 화소를 배율로 나눈 칸의 **가운데**를 읽습니다 — 모든 도트가 정확히 배율 × 배율.
    fragmentShader: `
      precision highp float;
      uniform sampler2D uTex;
      uniform vec2 uTexSize;
      uniform float uFactor;
      void main() {
        vec2 t = (floor(gl_FragCoord.xy / uFactor) + 0.5) / uTexSize;
        gl_FragColor = texture2D(uTex, t);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const copyQuad = new THREE.Mesh(quad, copyMat);
  copyQuad.frustumCulled = false;
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
    const uni = (mesh.material as THREE.ShaderMaterial).uniforms;
    uni.uTex.value = tex;
    // 재구성 필터가 텍셀 격자를 알아야 합니다. 렌더 타깃 텍스처는
    // `image` 에 크기를 들고 있으므로 크기 변경에도 저절로 따라갑니다.
    if (uni.uTexSize) {
      const img = tex.image as { width?: number; height?: number } | undefined;
      (uni.uTexSize.value as THREE.Vector2).set(
        Math.max(1, img?.width ?? 1),
        Math.max(1, img?.height ?? 1)
      );
    }
    blitScene.clear();
    blitScene.add(mesh);
    // blit 자체는 층과 무관합니다 — 전용 씬이라 카메라 층 마스크를 되돌려 둡니다.
    blitCam.layers.enableAll();
    renderer.render(blitScene, blitCam);
    blitScene.remove(mesh);
  };

  const resize = () => {
    fitInternal();
    rtPixel.setSize(w, h);
    rtSky.setSize(softW(), softH());
    rtCloud.setSize(softW(), softH());
    rtCloudBelow.setSize(softW(), softH());
    rtDist.setSize(w, h);
    rtLit.setSize(w, h);
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
    renderer.setRenderTarget(pixelRows > 0 ? rtPixel : null);
    bloomMat.uniforms.uBloom.value = rtBloomA.texture;
    // 꺼져 있어도 샘플러는 묶어 둡니다 — 안 묶인 sampler2D 는 기기에 따라
    // 경고나 검정 이상의 것을 냅니다. 세기 0이라 결과에는 영향이 없습니다.
    bloomMat.uniforms.uRay.value = rtRay.texture;
    bloomMat.uniforms.uStrength.value = bloomOn ? bloom.strength : 0;
    bloomMat.uniforms.uRayStrength.value = rayGain;
    blit(renderer, bloomQuad, rtScene.texture);
  };

  /** §117 지형 거리 판을 그립니다(원해상도). 렌더 타깃·카메라 층·지움 색은 호출자가 되돌립니다(render·prepare). */
  let distPrepared = false;
  const distClear = new THREE.Color();
  const drawTerrainDistance = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    if (rtDist.width !== w || rtDist.height !== h) rtDist.setSize(w, h);
    camera.layers.set(LAYER_TERRAIN_DIST);
    renderer.setRenderTarget(rtDist);
    renderer.getClearColor(distClear);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, true);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    if (terrainLitOn) {
      if (rtLit.width !== w || rtLit.height !== h) rtLit.setSize(w, h);
      camera.layers.set(LAYER_TERRAIN_LIT);
      renderer.setRenderTarget(rtLit);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    }
    renderer.setClearColor(distClear, prevClearAlpha);
  };

  const prepareTerrainDistance = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    if (!terrainDistOn) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevMask = camera.layers.mask;
    drawTerrainDistance(renderer, scene, camera);
    distPrepared = true;
    camera.layers.mask = prevMask;
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
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
    // 도트 모드는 내부 해상도가 이미 작으므로 저해상도 층을 또 줄이지 않습니다 — 구름을 절반으로
    // 그려 늘리면 도트 안에서 번집니다(§97).
    const softPath = scale > 1.0001 && pixelRows === 0;
    const postOn =
      bloom.strength > 0.001 ||
      (softPath && rays.strength > 0.001 && sunDirWorld !== null);
    // 도트 모드면 화면 대신 도트 버퍼가 마지막 출력입니다(끝에서 최근접으로 늘림).
    const finalTarget = pixelRows > 0 ? rtPixel : null;
    const sceneTarget = postOn ? rtScene : finalTarget;

    // §117 — 지형 거리 판(원해상도). 이번 프레임에 이미 그렸으면(prepareTerrainDistance) 건너뜁니다.
    if (terrainDistOn && !distPrepared) drawTerrainDistance(renderer, scene, camera);
    distPrepared = false;

    if (!softPath) {
      // 층을 나눌 이득이 없으면 한 번에 그립니다 (패스 비용만 늘어납니다).
      // 지형 거리 판의 쌍둥이 메시는 화면에 그리면 안 됩니다.
      camera.layers.enableAll();
      camera.layers.disable(LAYER_TERRAIN_DIST);
      camera.layers.disable(LAYER_TERRAIN_LIT);
      renderer.setRenderTarget(sceneTarget);
      if (externalSky) {
        // 밖에서 그린 하늘을 먼저 깔고 → 천체 → 구름 불투명도로 천체 가리기(§127) → 하늘돔·천체·앞 층을 뺀 나머지
        // → 지형 앞 구름 → 앞 층(빌보드·경로).
        renderer.autoClear = true;
        renderer.clear(true, true, true);
        renderer.autoClear = false;
        opaqueMat.uniforms.uDither.value = dither;
        opaqueMat.uniforms.uEncodeSrgb.value = 1;
        blit(renderer, opaqueQuad, externalSky);
        opaqueMat.uniforms.uEncodeSrgb.value = 0;
        camera.layers.set(LAYER_CELESTIAL);
        renderer.render(scene, camera);
        extMaskMat.uniforms.uTex.value = externalSky;
        blit(renderer, extMaskQuad, externalSky);
        camera.layers.enableAll();
        camera.layers.disable(LAYER_TERRAIN_DIST);
        camera.layers.disable(LAYER_TERRAIN_LIT);
        camera.layers.disable(LAYER_SOFT_SKY);
        camera.layers.disable(LAYER_CELESTIAL);
        camera.layers.disable(LAYER_FRONT);
        renderer.render(scene, camera);
        if (terrainDistOn) {
          extFrontMat.uniforms.uDist.value = rtDist.texture;
          blit(renderer, extFrontQuad, externalSky);
        }
        camera.layers.set(LAYER_FRONT);
        renderer.render(scene, camera);
        renderer.autoClear = true;
      } else {
        renderer.autoClear = true;
        renderer.render(scene, camera);
      }
    } else {
      // ── 1) 배경 (저해상도, 불투명) ───────────────────────────────────
      if (!externalSky) {
        camera.layers.set(LAYER_SOFT_SKY);
        renderer.autoClear = true;
        renderer.setRenderTarget(rtSky);
        renderer.render(scene, camera);
      }

      // ── 2) 구름 덱 (저해상도, 투명) ──────────────────────────────────
      //
      // 투명 검정으로 지웁니다. 덱 재질의 알파 블렌딩이 (One, 1−SrcAlpha)라
      // 여기 쌓인 결과가 미리곱해진 형태가 됩니다.
      // 볼륨 하늘(§126.7)이면 구름은 밖의 하늘 텍스처에 있고 슬랩은 숨겨져 있습니다 — 빈 판을 지우고 얹는 일을 건너뜁니다.
      // (광선 그늘은 이 판의 알파에서 나오므로 볼륨 하늘에서는 예전처럼 비어 있게 지워 둡니다.)
      renderer.setRenderTarget(rtCloud);
      renderer.setClearAlpha(0);
      renderer.clear(true, true, true);
      renderer.autoClear = false;
      if (!externalSky) {
        camera.layers.set(LAYER_SOFT_CLOUD);
        renderer.render(scene, camera);
      }
      renderer.setClearAlpha(1);

      // ── 3) 합성 ──────────────────────────────────────────────────────
      renderer.setRenderTarget(sceneTarget);
      renderer.autoClear = true;
      opaqueMat.uniforms.uDither.value = dither;
      opaqueMat.uniforms.uEncodeSrgb.value = externalSky ? 1 : 0;
      blit(renderer, opaqueQuad, externalSky ?? rtSky.texture);
      opaqueMat.uniforms.uEncodeSrgb.value = 0;

      renderer.autoClear = false;

      // 3-0) 해·달·별·은하수 — 구름 **아래**(§94). 원해상도.
      camera.layers.set(LAYER_CELESTIAL);
      renderer.render(scene, camera);
      // §127 볼륨 하늘: 하늘 텍스처에 구름이 이미 있으므로, 천체가 보탠 몫을 구름 투과율만큼만 남깁니다.
      if (externalSky) {
        extMaskMat.uniforms.uTex.value = externalSky;
        blit(renderer, extMaskQuad, externalSky);
      }

      if (externalSky) {
        // §127 — 지형을 그린 뒤 지형 화소에만 지형 앞 구름을 다시 얹습니다(구름 행진이 지형 거리에서 멈춤).
        camera.layers.set(LAYER_MID);
        renderer.render(scene, camera);
        if (terrainDistOn) {
          extFrontMat.uniforms.uDist.value = rtDist.texture;
          blit(renderer, extFrontQuad, externalSky);
        }
      } else if (!terrainDistOn) {
        // 3-1) 구름 덱을 하늘 위에 먼저 얹습니다.
        blit(renderer, overQuad, rtCloud.texture);

        // 3-2) 별·은하수·태양·달·지면·산 능선(지형) — 원해상도.
        // ⚠ 산 능선이 불투명하게 구름 앞을 가려야 하므로 구름 위에 산을 그립니다.
        camera.layers.set(LAYER_MID);
        renderer.render(scene, camera);
      } else {
        // §117 — 지형을 먼저, 구름은 그 **다음에** 한 번. 구름 슬랩이 지형 거리 판으로 산 뒤 구름을
        // 스스로 비우므로, 산 앞 구름은 산 위에, 산 뒤 구름은 산 뒤에 저절로 놓입니다.
        camera.layers.set(LAYER_MID);
        renderer.render(scene, camera);
        overMat.uniforms.uDist.value = rtDist.texture;
        overMat.uniforms.uDistOn.value = 1;
        blit(renderer, overQuad, rtCloud.texture);
        overMat.uniforms.uDistOn.value = 0;
      }

      // 3-2b) 발밑 운해·구름 속 안개 — 산 **다음**(§96). 그릴 것이 없으면 판을 건너뜁니다.
      let belowVisible = false;
      scene.traverseVisible(o => { if (!belowVisible && o.layers.isEnabled(LAYER_SOFT_CLOUD_BELOW)) belowVisible = true; });
      if (belowVisible) {
        camera.layers.set(LAYER_SOFT_CLOUD_BELOW);
        renderer.setRenderTarget(rtCloudBelow);
        renderer.setClearAlpha(0);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        renderer.setClearAlpha(1);
        renderer.setRenderTarget(sceneTarget);
        blit(renderer, overQuad, rtCloudBelow.texture);
      }

      // 3-3) 최상위 가이드/경로 — 원해상도.
      camera.layers.set(LAYER_FRONT);
      renderer.render(scene, camera);
    }

    if (postOn) {
      renderer.autoClear = false;
      runPost(renderer, camera, softPath);
    } else {
      rayGain = 0;
    }

    // 도트 모드 — 내부 해상도 그림을 최근접으로 화면에 늘립니다.
    if (pixelRows > 0) {
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      copyMat.uniforms.uFactor.value = pixelFactor;
      blit(renderer, copyQuad, rtPixel.texture);
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
      fullW = Math.max(1, Math.floor(width));
      fullH = Math.max(1, Math.floor(height));
      resize();
    },
    setPixelArt: (rows: number) => {
      const next = Number.isFinite(rows) && rows > 0 ? Math.round(rows) : 0;
      if (next === pixelRows) return;
      pixelRows = next;
      resize();
    },
    renderSize: () => ({ width: w, height: h }),
    softActive: () => scale > 1.0001 && pixelRows === 0,
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
    setReconstruct: (mode: 'catmull' | 'bilinear') => {
      const v = mode === 'bilinear' ? 0 : 1;
      opaqueMat.uniforms.uCatmull.value = v;
      overMat.uniforms.uCatmull.value = v;
    },
    lastRayGain: () => rayGain,
    setTerrainDistance: (on: boolean) => { terrainDistOn = !!on; },
    setTerrainLit: (on: boolean) => { terrainLitOn = !!on; },
    terrainLitTexture: () => (terrainLitOn ? rtLit.texture : null),
    setExternalSky: (tex: THREE.Texture | null) => { externalSky = tex; },
    prepareTerrainDistance,
    terrainDistanceTexture: () => rtDist.texture,
    dispose: () => {
      rtDist.dispose();
      rtLit.dispose();
      rtSky.dispose();
      rtCloud.dispose();
      rtCloudBelow.dispose();
      rtPixel.dispose();
      copyMat.dispose();
      rtScene.dispose();
      rtBloomA.dispose();
      rtBloomB.dispose();
      rtRay.dispose();
      quad.dispose();
      opaqueMat.dispose();
      overMat.dispose();
      extMaskMat.dispose();
      extFrontMat.dispose();
      brightMat.dispose();
      blurMat.dispose();
      rayMat.dispose();
      bloomMat.dispose();
    },
  };
}
