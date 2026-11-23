/**
 * SceneComposerShaders.ts
 * SceneComposer가 쓰는 2D 합성 · 확대 · 블룸 · 박명광선 · 디더 · 장노출 누적 GLSL 셰이더 모음.
 * (CATMULL_GLSL · DENOISE_GLSL 원문은 capture-test.mjs 정합 검사를 위해 SceneComposer.ts에 유지합니다.)
 */

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

export const BLIT_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  // 전체화면 사각형 — 변환 없이 클립 공간에 그대로 놓습니다.
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const makeBlitFrag = (catmullGlsl: string) => `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform sampler2D uDist;
uniform float uDistOn;
varying vec2 vUv;
${catmullGlsl}
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

/** §127 선형 → sRGB 부호화. */
export const SRGB_ENCODE_GLSL = `
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;

export const makeExtMaskFrag = (catmullGlsl: string, denoiseGlsl: string) => `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
varying vec2 vUv;
${catmullGlsl}
${denoiseGlsl}
${SRGB_ENCODE_GLSL}
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(linearToSrgb(t.rgb), clamp(t.a, 0.0, 1.0));
}
`;

export const makeExtFrontFrag = (catmullGlsl: string, denoiseGlsl: string) => `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform sampler2D uDist;
varying vec2 vUv;
${TERRAIN_DIST_GLSL}
${catmullGlsl}
${denoiseGlsl}
${SRGB_ENCODE_GLSL}
void main() {
  if (terrainDistDecodeKm(texture2D(uDist, vUv)) > 1e8) discard;
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(linearToSrgb(t.rgb), clamp(t.a, 0.0, 1.0));
}
`;

/** 디더 — 8비트로 내려앉을 때 생기는 밴딩을 흩습니다 (Jimenez interleaved gradient noise). */
export const DITHER_GLSL = `
float ditherNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

export const makeUpscaleFrag = (catmullGlsl: string, denoiseGlsl: string) => `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform float uDither;
/** 1 이면 선형 값을 sRGB 로 부호화(§127 볼륨 하늘 텍스처). 하늘돔 버퍼는 이미 표시 값이라 0. */
uniform float uEncodeSrgb;
varying vec2 vUv;
${DITHER_GLSL}
${catmullGlsl}
${denoiseGlsl}
${SRGB_ENCODE_GLSL}
void main() {
  vec3 c = (uEncodeSrgb > 0.5 && uDenoise < 0.5)
    ? texture2D(uTex, vUv).rgb
    : skyDenoise(uTex, vUv, uTexSize).rgb;
  if (uEncodeSrgb > 0.5) c = linearToSrgb(c);
  c += (ditherNoise(gl_FragCoord.xy) - 0.5) * uDither / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** 밝은 부분만 뽑아내기 — 부드러운 무릎(soft knee). */
export const BRIGHT_FRAG = `
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

/** 분리 가능 가우시안 — 선형 표본 5탭으로 9픽셀 폭을 냅니다. */
export const BLUR_FRAG = `
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

/** 박명광선 — 빛을 더하지 않고 그늘을 뺍니다. */
export const RAY_FRAG = `
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
  // 태양에서 멀어지면 잦아듭니다 — 화면 반대편까지 그늘이 가면 그건 광선이 아니라 비네팅입니다.
  float d = length((vUv - uSunUv) * uAspect);
  shade *= 1.0 - smoothstep(uMaskInner, uMaskOuter, d);
  // 구름 자신은 빼둡니다.
  shade *= 1.0 - texture2D(uTex, vUv).a;
  gl_FragColor = vec4(vec3(shade), 1.0);
}
`;

/** (원본 + 블룸) × 그늘. 디더는 여기가 아니라 확대 패스가 겁니다. */
export const BLOOM_COMPOSITE_FRAG = `
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
  gl_FragColor = vec4((base + glow * uStrength) * (1.0 - shade * uRayStrength), 1.0);
}
`;

export const PIXEL_COPY_FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform float uFactor;
void main() {
  vec2 t = (floor(gl_FragCoord.xy / uFactor) + 0.5) / uTexSize;
  gl_FragColor = texture2D(uTex, t);
}
`;

export const ACCUM_BLEND_FRAG = `
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uTex;
uniform sampler2D uDist;
uniform float uAlpha;
uniform float uEncodePrev;
uniform float uPackGroundMask;
uniform float uLighten;
varying vec2 vUv;
float decodeDistKm(vec4 c) {
  float t = (floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5)) / 65535.0;
  return t > 0.99995 ? 1e9 : 1e-3 * exp2(t * 20.0);
}
void main() {
  vec3 pRaw = texture2D(uPrev, vUv).rgb;
  vec3 cRaw = texture2D(uTex, vUv).rgb;
  if (uPackGroundMask > 0.5) {
    float isGround = decodeDistKm(texture2D(uDist, vUv)) < 5e8 ? 1.0 : 0.0;
    gl_FragColor = vec4(cRaw, isGround);
    return;
  }
  vec3 pLin = uEncodePrev > 0.5 ? pRaw : pow(max(pRaw, vec3(0.0)), vec3(2.2));
  vec3 cLin = pow(max(cRaw, vec3(0.0)), vec3(2.2));
  vec3 outLin = uLighten > 0.5 ? max(pLin, cLin) : mix(pLin, cLin, clamp(uAlpha, 0.0, 1.0));
  vec3 enc = uEncodePrev > 0.5 ? outLin : pow(clamp(outLin, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(enc, 1.0);
}
`;

export const ACCUM_RESOLVE_FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uBase;
uniform float uEncodeAccum;
uniform float uGain;
uniform float uAsinhK;
uniform float uShadowLift;
uniform float uUseFixedGround;
uniform float uDither;
varying vec2 vUv;
${DITHER_GLSL}
float asinhS(float x) { return log(x + sqrt(x * x + 1.0)); }
vec3 asinhV(vec3 x) { return log(x + sqrt(x * x + 1.0)); }
vec3 acesFilm(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec3 accRaw = texture2D(uTex, vUv).rgb;
  vec3 lin = uEncodeAccum > 0.5 ? accRaw : pow(max(accRaw, vec3(0.0)), vec3(2.2));
  lin *= uGain;
  // 암부 리프트(미약한 은하수·지상 윤곽을 블랙 위에서 살림)
  lin = lin + uShadowLift * (1.0 - exp(-lin * 4.0));
  vec3 displaySrgb = uAsinhK > 0.0
    ? pow(clamp(asinhV(uAsinhK * lin) / asinhS(uAsinhK), 0.0, 1.0), vec3(1.0 / 2.2))
    : pow(acesFilm(lin), vec3(1.0 / 2.2));
  if (uUseFixedGround > 0.5) {
    vec4 baseTex = texture2D(uBase, vUv);
    if (baseTex.a > 0.5) {
      vec3 baseLin = pow(max(baseTex.rgb, vec3(0.0)), vec3(2.2));
      baseLin = baseLin * max(1.0, uGain * 0.55) + uShadowLift * 0.5 * (1.0 - exp(-baseLin * 4.0));
      displaySrgb = uAsinhK > 0.0
        ? pow(clamp(asinhV(uAsinhK * baseLin) / asinhS(uAsinhK), 0.0, 1.0), vec3(1.0 / 2.2))
        : pow(acesFilm(baseLin), vec3(1.0 / 2.2));
    }
  }
  displaySrgb += (ditherNoise(gl_FragCoord.xy) - 0.5) * uDither / 255.0;
  gl_FragColor = vec4(displaySrgb, 1.0);
}
`;
