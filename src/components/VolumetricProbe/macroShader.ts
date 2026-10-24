/**
 * macroShader.ts — 거시 운량 격자(§156, `utils/macroField.ts`)를 셰이더에 겁니다. patchFlowShader **뒤**에 겁니다.
 *
 * 타일(24 km 주기, 채널마다 d ∈ [0, 1], 면적(d > 0) = 타일 운량 C₀)은 그대로 두고, 자리마다 **문턱**을 올려 운량을 깎습니다:
 *   C(x) = 거시 격자(768 km, 층마다 한 채널)의 그 자리 운량, s = LUT_lane(C) = "d > s 인 면적이 C 가 되는 문턱"(타일 바이트 히스토그램에서 CPU 가 셈),
 *   d' = (d − s) / (1 − s). C ≥ C₀ 면 s = 0(타일 그대로 — 타일에 없는 구름은 못 만듭니다; liveScene 이 C₀ 를 격자의 상위 분위수로 잡아 드뭅니다).
 * 두꺼운 핵부터 남기므로 운량이 낮은 자리에는 덩어리의 가운데만 남습니다(순위 d 에서는 정확히 "두꺼운 순").
 *
 * 시간: 격자는 1 분마다 AR(1) 로 새로 만들어(CPU) 두 장 A→B 를 `genusMacroMix` 로 섞어 읽습니다(툭 바뀌지 않게). 이류는 층 바람으로
 * 격자 uv 를 밉니다(km 단위, 타일 드리프트와 같은 부호·속도).
 *
 * 균일변수: genusMacroOn, genusMacroTexA/B(sampler2D, R 저·G 중·B 상, 없는 층은 1), genusMacroMix, genusMacroExtentKm, genusMacroLane(mat4, 레인별 채널 one-hot),
 *   genusMacroLut(sampler2D 64×1 RGBA, 채널 = 레인), genusMacroDriftU/V(vec4, km).
 * 기준 문자열이 없으면 throw(§124 규칙).
 */
import { DataTexture, LinearFilter, Matrix4, NoColorSpace, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType, Vector4 } from 'three';
import type { GenusLayer } from './cloudGenus';
import { flowParam } from './cloudFlowShader';

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };

export const MACRO_LUT_N = 64;

export function patchMacroShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  const decl = 'uniform float genusMacroOn;';
  // patchFlowShader 가 넣은 거시 기울기 블록의 끝(그 뒤에 문턱을 겁니다)
  const anchor = '    localWeather = min(localWeather * clamp(vec4(1.0) + gMacroDelta, vec4(0.0), vec4(1.35)), vec4(1.0));\n  }';
  for (const a of [decl, anchor]) {
    if (!src.includes(a)) throw new Error('macroShader: shader anchor missing — ' + a.trim().slice(0, 48));
  }
  src = src.replace(decl, decl + [
    '',
    'uniform float genusMacroTexOn;',
    'uniform sampler2D genusMacroTexA;',
    'uniform sampler2D genusMacroTexB;',
    'uniform float genusMacroMix;',
    'uniform float genusMacroExtentKm;',
    'uniform mat4 genusMacroLane;',
    'uniform sampler2D genusMacroLut;',
    'uniform vec4 genusMacroDriftU;',
    'uniform vec4 genusMacroDriftV;',
    'float genusMacroCoverAt(const vec2 km, const vec4 lane) {',
    '  vec2 muv = km / genusMacroExtentKm + 0.5;',
    '  if (muv.x < 0.0 || muv.x > 1.0 || muv.y < 0.0 || muv.y > 1.0) return 1.0;   // 격자 밖(380 km 너머 모서리)은 타일 그대로',
    '  vec4 c = mix(texture(genusMacroTexA, muv), texture(genusMacroTexB, muv), genusMacroMix);',
    '  return dot(c, lane);',
    '}',
    'float genusMacroLutAt(const float cover, const int lane) {',
    '  vec4 s = texture(genusMacroLut, vec2((cover * 63.0 + 0.5) / 64.0, 0.5));',
    '  return lane == 0 ? s.x : lane == 1 ? s.y : lane == 2 ? s.z : s.w;',
    '}',
  ].join('\n'));
  src = src.replace(anchor, anchor + [
    '',
    '  // §156 거시 운량 격자: 자리마다 문턱을 올려 타일 운량을 그 자리의 운량으로',
    '  if (genusMacroTexOn > 0.5) {',
    '    vec2 gMKm = uv * (genusTileM * 0.001);',
    '    vec4 gMC = vec4(',
    '      genusMacroCoverAt(gMKm + vec2(genusMacroDriftU.x, genusMacroDriftV.x), genusMacroLane[0]),',
    '      genusMacroCoverAt(gMKm + vec2(genusMacroDriftU.y, genusMacroDriftV.y), genusMacroLane[1]),',
    '      genusMacroCoverAt(gMKm + vec2(genusMacroDriftU.z, genusMacroDriftV.z), genusMacroLane[2]),',
    '      genusMacroCoverAt(gMKm + vec2(genusMacroDriftU.w, genusMacroDriftV.w), genusMacroLane[3]));',
    '    vec4 gMS = vec4(genusMacroLutAt(gMC.x, 0), genusMacroLutAt(gMC.y, 1), genusMacroLutAt(gMC.z, 2), genusMacroLutAt(gMC.w, 3));',
    '    gMS = pow(gMS, weatherExponents);',
    '    localWeather = clamp((localWeather - gMS) / max(vec4(1.0) - gMS, vec4(1e-3)), 0.0, 1.0);',
    '  }',
  ].join('\n'));
  mat.fragmentShader = src;
  mat.uniforms.genusMacroTexOn = { value: 0 };
  mat.uniforms.genusMacroTexA = { value: null };
  mat.uniforms.genusMacroTexB = { value: null };
  mat.uniforms.genusMacroMix = { value: 0 };
  mat.uniforms.genusMacroExtentKm = { value: 768 };
  mat.uniforms.genusMacroLane = { value: new Matrix4() };
  mat.uniforms.genusMacroLut = { value: null };
  mat.uniforms.genusMacroDriftU = { value: new Vector4() };
  mat.uniforms.genusMacroDriftV = { value: new Vector4() };
  mat.needsUpdate = true;
}

/** 거시 격자 텍스처(R 저·G 중·B 상·A 1; 없는 층은 1 = 타일 그대로). 행 = 북쪽으로 증가(macroField 과 같음, flipY 없음). */
export function makeMacroTexture(n: number, bands: { low?: Float32Array | null; mid?: Float32Array | null; high?: Float32Array | null }): DataTexture {
  const data = new Uint8Array(n * n * 4);
  const put = (ch: number, f: Float32Array | null | undefined) => {
    for (let i = 0; i < n * n; i++) data[i * 4 + ch] = f ? Math.round(Math.min(1, Math.max(0, f[i])) * 255) : 255;
  };
  put(0, bands.low); put(1, bands.mid); put(2, bands.high);
  for (let i = 0; i < n * n; i++) data[i * 4 + 3] = 255;
  const t = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.colorSpace = NoColorSpace; t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * 문턱 표: 타일 채널 k 의 바이트 히스토그램에서, 목표 운량 C(64 칸)마다 "d > s 인 면적 = C" 인 s(0~1, 바이트/255 공간). C ≥ 타일 운량이면 0.
 * 표 안에서 선형 보간(바이트 칸 안)은 하지 않고 칸 경계로 둡니다(1/255 단위).
 */
export function macroThresholdTable(tile: Uint8Array, S: number, channel: number, out: Float32Array = new Float32Array(MACRO_LUT_N)): Float32Array {
  const hist = new Int32Array(256);
  for (let i = 0; i < S * S; i++) hist[tile[i * 4 + channel]]++;
  const total = S * S;
  // above[b] = 바이트 > b 인 개수
  const above = new Int32Array(257);
  for (let b = 255; b >= 0; b--) above[b] = above[b + 1] + hist[b];
  // above[b] 는 "> b−1"… 정확히: cnt(d > b) = Σ_{v>b} hist[v] = above[b+1]
  const tileCover = above[1] / total;   // d > 0
  for (let c = 0; c < MACRO_LUT_N; c++) {
    const target = c / (MACRO_LUT_N - 1);
    if (target >= tileCover - 1e-9) { out[c] = 0; continue; }
    if (target <= 0) { out[c] = 1; continue; }
    // 가장 작은 b 로 cnt(d > b)/total ≤ target
    let b = 0;
    while (b < 255 && above[b + 1] / total > target) b++;
    out[c] = b / 255;
  }
  return out;
}

/** 레인(최대 4) 문턱 표를 64×1 RGBA 텍스처로 */
export function makeMacroLutTexture(tables: Array<Float32Array | null>): DataTexture {
  const data = new Uint8Array(MACRO_LUT_N * 4);
  for (let c = 0; c < MACRO_LUT_N; c++) for (let k = 0; k < 4; k++) {
    const t = tables[k];
    data[c * 4 + k] = t ? Math.round(Math.min(1, Math.max(0, t[c])) * 255) : 0;
  }
  const t = new DataTexture(data, MACRO_LUT_N, 1, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = false;
  t.colorSpace = NoColorSpace; t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export interface MacroUniformInput {
  texA: DataTexture; texB: DataTexture; mix: number; extentKm: number;
  /** 레인별 밴드('low'|'mid'|'high'|null) */
  laneBand: Array<'low' | 'mid' | 'high' | null>;
  lut: DataTexture;
}
export function setMacroUniforms(mat: PatchableMaterial, u: MacroUniformInput | null): void {
  mat.uniforms.genusMacroTexOn.value = u ? 1 : 0;
  if (!u) return;
  mat.uniforms.genusMacroTexA.value = u.texA;
  mat.uniforms.genusMacroTexB.value = u.texB;
  mat.uniforms.genusMacroMix.value = Math.min(1, Math.max(0, u.mix));
  mat.uniforms.genusMacroExtentKm.value = u.extentKm;
  mat.uniforms.genusMacroLut.value = u.lut;
  const m = mat.uniforms.genusMacroLane.value as Matrix4;
  const e = m.elements; e.fill(0);
  // 열 i = 레인 i 의 one-hot(열우선 저장: e[i*4 + row]). 없는 밴드는 A 채널(= 1) → 문턱 0.
  u.laneBand.forEach((b, i) => { const row = b === 'low' ? 0 : b === 'mid' ? 1 : b === 'high' ? 2 : 3; e[i * 4 + row] = 1; });
}
export function setMacroMix(mat: PatchableMaterial, mix: number): void {
  mat.uniforms.genusMacroMix.value = Math.min(1, Math.max(0, mix));
}

/** 거시 격자 이류 — 타일 드리프트와 같은 식(uv 를 −U·t 만큼), 단위 km(감싸지 않음). `seconds` 는 **장면(표본) 시각부터** 흐른 초 — 절대 시각을 넣으면 수천만 km 가 됩니다. */
export function setMacroDrift(mat: PatchableMaterial, layers: (GenusLayer | null)[], seconds: number): void {
  const h = seconds / 3600;
  const lane = (k: 'windU' | 'windV') => [0, 1, 2, 3].map(i => (layers[i] ? -flowParam(layers[i] as GenusLayer, k, 0) * h : 0));
  const du = lane('windU'), dv = lane('windV');
  (mat.uniforms.genusMacroDriftU.value as Vector4).set(du[0], du[1], du[2], du[3]);
  (mat.uniforms.genusMacroDriftV.value as Vector4).set(dv[0], dv[1], dv[2], dv[3]);
}
