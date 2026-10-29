/**
 * §180 L7irrprobe 셰이더 조립 — 순수 함수(브라우저 entry gpuwin-irrentry.ts 와 node 마른 시험 gpuwin-irrtest.js 가 같은 글자를 씀).
 *
 * 왜: L3twilight 은 구름 덮개 평균 휘도(깊은 박명 ~1e−7, 일부 0 으로 잘림, 화소 마스크가 걸음마다 바뀜)의 ln 잔차로 출렁임을 재서
 * 잡음이 지배했습니다(−10..−6° rms 끔 0.60 · 켬 0.66, 이웃 0.2° 걸음 ×3 뜀). 그래서 구름 패스의 GetIrradiance(r, μs) 자체를 텍셀마다 바로 읽습니다.
 *
 * 무엇을 붙이나: 앱이 실제로 쓰는 구름 패스 조각 셰이더 글자(clouds.cloudsPass.currentMaterial.fragmentShader — 앱 패치·§178 주입까지 들어간 것)에서
 * 대기 함수 앞부분만 잘라(precision 줄 ~ takram bruneton runtime 끝의 `#define GetSunAndSkyScalarIrradiance …` 줄) 그 뒤에 탐침 함수
 * probeValue(ij) + main 을 붙입니다. 그래서 GetIrradiance·GetSkyRadianceToPoint·균일변수 선언·정의(defines)가 구름 패스와 같은 글자입니다.
 *   - irr   : GetIrradiance(ATMOSPHERE, irradiance_texture, bottom_radius + h, μs) — μs 는 N×1 RGBA32F 텍스처(probeMu.r), h 는 probeH[행].
 *             logμ 끔/켬은 끔/켬 구름 패스 글자의 앞부분을 그대로 씀(켬 앞부분 = injectIrradianceLogMu(끔 앞부분) 인지 따로 봄).
 *   - table : texelFetch(irradiance_texture) — GPU 표 그대로(필터 없음). CPU 이식이 이 표로 같은 식을 계산.
 *   - aerial: 구름 패스 applyAerialPerspective 와 같은 줄(INSCATTER_CLOUDS_ANCHOR)을 담은 함수에 앱 주입 함수 injectInscatterClampClouds 를
 *             끔/켬으로 걸어(검은 불투명 덮개 color = (0,0,0,1) → 결과 = 산란 또는 max(산란, 0)) · raw = 산란 rgb + 투과율 평균 · sky = 같은 선의 맑은 하늘.
 * 출력: PROBE_PACK 정의가 없으면 RGBA32F 에 그대로, 있으면 한 채널(probeChan)의 float 비트를 RGBA8 네 바이트로(부동 RT 를 못 쓰는 기기 — 정확한 값).
 */
import { INSCATTER_CLOUDS_ANCHOR, IRRADIANCE_ANCHOR, injectInscatterClampClouds, injectIrradianceLogMu } from '../../../src/components/VolumetricProbe/lightingFix';

/** takram runtime.glsl 의 마지막 줄 — 대기 함수 앞부분의 끝(구름 패스 글자에 한 번). */
export const PREFIX_END = '#define GetSunAndSkyScalarIrradiance GetSunAndSkyScalarIlluminance';
export const PROBE_MARK = '§180 L7irrprobe';
export const GET_IRRADIANCE_SIG = 'IrradianceSpectrum GetIrradiance(';

const countOf = (s: string, a: string) => s.split(a).length - 1;

/** 구름 패스 조각 글자 → 대기 함수 앞부분(끝 줄 포함). 앞부분에 main·out 선언이 없고, GetIrradiance 정의·조도 표·ATMOSPHERE 선언이 한 번씩 있어야 함. */
export function cutAtmospherePrefix(frag: string): string {
  const n = countOf(frag, PREFIX_END);
  if (n !== 1) throw new Error(`irrshader: prefix end marker count ${n} (takram runtime changed?)`);
  const pre = frag.slice(0, frag.indexOf(PREFIX_END) + PREFIX_END.length) + '\n';
  if (/\bvoid\s+main\s*\(/.test(pre)) throw new Error('irrshader: prefix contains main()');
  // 전역 출력 선언(… out vec4 이름;)만 — 함수 인자 'out vec4 x,' 는 아님
  if (/(^|\n)[ \t]*(layout\s*\([^)]*\)\s*)?out\s+(highp\s+|mediump\s+|lowp\s+)?(vec[234]|float|int|uint|ivec[234]|uvec[234])\s+\w+\s*;/.test(pre)) throw new Error('irrshader: prefix declares a fragment output');
  for (const [k, want] of [[GET_IRRADIANCE_SIG, 1], ['uniform sampler2D irradiance_texture;', 1], ['uniform AtmosphereParameters ATMOSPHERE;', 1],
    ['#define GetSkyRadianceToPoint GetSkyLuminanceToPoint', 1], ['#define GetSkyRadiance GetSkyLuminance', 1]] as const) {
    const c = countOf(pre, k);
    if (c !== want) throw new Error(`irrshader: prefix has ${c} × '${k}' (want ${want})`);
  }
  if (pre.includes(PROBE_MARK)) throw new Error('irrshader: prefix already contains a probe');
  return pre;
}

/** 글자에서 sig 로 시작하는 함수 하나(첫 '{' 부터 짝 맞는 '}' 까지). 없으면 null. */
export function functionText(src: string, sig: string): string | null {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  const b = src.indexOf('{', i);
  if (b < 0) return null;
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}

/** 끔/켬 두 앞부분의 관계: 켬 = injectIrradianceLogMu(끔, true) 이고, 끔의 GetIrradiance 몸통 = takram 원문 앵커. */
export function checkPrefixPair(preOff: string, preOn: string): { offHasAnchor: boolean; onEqualsInjected: boolean; onMarks: number; offMarks: number } {
  let inj: string | null = null;
  try { inj = injectIrradianceLogMu(preOff, true); } catch { inj = null; }
  return { offHasAnchor: countOf(preOff, IRRADIANCE_ANCHOR) === 1, onEqualsInjected: inj !== null && inj === preOn,
    onMarks: countOf(preOn, '§178 irradianceLogMu'), offMarks: countOf(preOff, '§178 irradianceLogMu') };
}

/** 탐침 출력 꼬리 — probeValue(ij) 를 RGBA32F 로, 또는(PROBE_PACK) probeChan 채널의 float 비트를 RGBA8 로. */
const OUT_TAIL = [
  `// ${PROBE_MARK} — 출력`,
  'uniform int probeChan;',
  'layout(location = 0) out vec4 probeOut;',
  'void main() {',
  '  vec4 v = probeValue(ivec2(gl_FragCoord.xy));',
  '#ifdef PROBE_PACK',
  '  uint b = floatBitsToUint(v[probeChan]);',
  '  probeOut = vec4(float(b & 255u), float((b >> 8u) & 255u), float((b >> 16u) & 255u), float(b >> 24u)) / 255.0;',
  '#else',
  '  probeOut = v;',
  '#endif',
  '}',
].join('\n');

/** 조도 탐침: 열 i = μs(probeMu.r), 행 j = 높이 probeH[j](대기 길이 단위 = km) — 구름 패스와 같은 GetIrradiance. */
export function irrProbeFragment(prefix: string): string {
  return [prefix,
    `// ${PROBE_MARK} — GetIrradiance(r, μs) 격자`,
    'uniform highp sampler2D probeMu;',
    'uniform vec4 probeH;',
    'vec4 probeValue(ivec2 ij) {',
    '  float mu_s = texelFetch(probeMu, ivec2(ij.x, 0), 0).r;',
    '  float r = ATMOSPHERE.bottom_radius + probeH[ij.y];',
    '  return vec4(GetIrradiance(ATMOSPHERE, irradiance_texture, r, mu_s), 1.0);',
    '}',
    OUT_TAIL].join('\n');
}

/** 표 읽기: 텍셀 그대로(필터 없음). 출력 크기 = 표 크기. */
export function tableProbeFragment(prefix: string): string {
  return [prefix,
    `// ${PROBE_MARK} — 조도 표 텍셀`,
    'vec4 probeValue(ivec2 ij) { return texelFetch(irradiance_texture, ij, 0); }',
    OUT_TAIL].join('\n');
}

export type AerialMode = 'raw' | 'off' | 'on' | 'sky';
/** 구름 패스 applyAerialPerspective 와 같은 몸통(그림자 길이 0). 마지막 줄 = INSCATTER_CLOUDS_ANCHOR(앱 주입이 그 줄을 바꿈). */
export function aerialTemplate(): string {
  return [
    'void probeAerial(const vec3 camPos, const vec3 frontPos, inout vec4 color) {',
    '  vec3 transmittance;',
    '  vec3 inscatter = GetSkyRadianceToPoint(camPos * METER_TO_LENGTH_UNIT, frontPos * METER_TO_LENGTH_UNIT, 0.0 * METER_TO_LENGTH_UNIT, probeSun, transmittance);',
    INSCATTER_CLOUDS_ANCHOR,
    '}',
  ].join('\n');
}
/** 산란 자르기 탐침. probeEnd 텍셀 = 덮개 밑면 끝점 ECEF(m, w = 1 이면 덮개에 닿음) · probeCam = 구름 패스 카메라(ECEF + 고도 보정, m) · probeSun = 해 방향(ECEF). */
export function aerialProbeFragment(prefix: string, mode: AerialMode): string {
  let fn: string;
  if (mode === 'off' || mode === 'on') fn = injectInscatterClampClouds(aerialTemplate(), mode === 'on');   // 앱 주입 함수 그대로(끔 = 원문 줄)
  else if (mode === 'raw') fn = aerialTemplate().replace(INSCATTER_CLOUDS_ANCHOR, () => '  color = vec4(inscatter, dot(transmittance, vec3(1.0 / 3.0)));');
  else fn = '';
  const body = mode === 'sky'
    ? ['vec4 probeValue(ivec2 ij) {', '  vec4 p = texelFetch(probeEnd, ij, 0);', '  if (p.w < 0.5) return vec4(0.0);', '  vec3 tr;',
      '  vec3 L = GetSkyRadiance(probeCam * METER_TO_LENGTH_UNIT, normalize(p.xyz - probeCam), 0.0, probeSun, tr);', '  return vec4(L, 1.0);', '}']
    : ['vec4 probeValue(ivec2 ij) {', '  vec4 p = texelFetch(probeEnd, ij, 0);', '  if (p.w < 0.5) return vec4(0.0);', '  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);',
      '  probeAerial(probeCam, p.xyz, color);', '  return color;', '}'];
  return [prefix,
    `// ${PROBE_MARK} — 덮개 대기 산란(${mode})`,
    'uniform highp sampler2D probeEnd;',
    'uniform vec3 probeCam;',
    'uniform vec3 probeSun;',
    fn, ...body, OUT_TAIL].join('\n');
}

/** 정점 글자(GLSL3 RawShaderMaterial — three 가 '#version 300 es' 와 defines 만 붙임). */
export const PROBE_VERT = 'precision highp float;\nin vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** 조립한 글자의 정적 점검(컴파일 전 — 마른 시험·페이지 둘 다): 괄호 짝 · main 하나 · probeValue 하나 · 출력 하나 · 표지. */
export function staticCheck(src: string): string[] {
  const bad: string[] = [];
  const bal = (o: string, c: string) => countOf(src, o) === countOf(src, c);
  if (!bal('{', '}')) bad.push('unbalanced braces');
  if (!bal('(', ')')) bad.push('unbalanced parentheses');
  if ((src.match(/\bvoid\s+main\s*\(/g) ?? []).length !== 1) bad.push('main() count != 1');
  if ((src.match(/\bvec4\s+probeValue\s*\(/g) ?? []).length !== 1) bad.push('probeValue count != 1');
  if (countOf(src, 'out vec4 probeOut;') !== 1) bad.push('probeOut decl count != 1');
  if (!src.includes(PROBE_MARK)) bad.push('probe mark missing');
  if (/\bgl_FragColor\b/.test(src.slice(src.indexOf(PROBE_MARK)))) bad.push('gl_FragColor in probe (GLSL3)');
  return bad;
}
