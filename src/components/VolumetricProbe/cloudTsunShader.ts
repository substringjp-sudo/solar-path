/**
 * cloudTsunShader.ts — §179 T_sun · 아치 빛 셰이더 글자(하네스 전용, 기본 끔). §179 검토 반영(회귀 1, 2026-10-29): cloudTsun.ts 에서 떼어 냄 —
 * 앱 묶음에 셰이더 글자가 실리지 않게(cloudTsun.ts 는 옵션·점검·균일변수·주입 등록만). 결정 목록(D1~D14)·형식은 cloudTsun.ts 머리말.
 * 하네스(entry-tsun)·시험은 installTsunShader() 를 한 번 불러 cloudTsun.ts 의 주입 등록에 injectTsunText 를 겁니다.
 * 이 모듈은 cloudTsun.ts 의 모든 것을 다시 내보냄(시험이 한 곳에서 상수·앵커를 읽도록).
 */
import { DIFFUSE_G } from './cloudDiffuse';
import {
  ARCH_AZ_DEG, ARCH_AZ_WIDTH_DEG, ARCH_GL2, ARCH_OCTAVES, TSUN_COND_HF, TSUN_COND_HF_STEP, TSUN_COND_LEN, TSUN_COND_REACH_KM, TSUN_GL4_W, TSUN_GL4_X,
  TSUN_MARK, TSUN_PROF_N, TSUN_SLICE_HF, registerTsunShader, type TsunShaderConfig,
} from './cloudTsun';

export * from './cloudTsun';

// ───── 셰이더 글자 ─────
/** 앵커(구름 패스 정확히 한 번 · 그림자 패스 0 번 — U4a). three-clouds 0.7.6 clouds.frag 줄 번호. */
/** 파일 범위 선언 자리(v2.1 eng m4) — clouds.frag 출력 선언, 구름 패스만. */
export const TSUN_DECL_ANCHOR = 'layout(location = 0) out vec4 outputColor;';
/** 도움 함수 자리(phaseFunction·GetSkyRadiance·getGlobeUv 뒤) — marchClouds 정의 바로 앞(얼음·확산 주입도 이 글자 앞에 넣지만 글자는 남음). */
export const TSUN_HELPER_ANCHOR = 'vec4 marchClouds(';
/** I-0 (main, clouds.frag:870) — grain 앵커와 겹치지 않음. */
export const TSUN_I0_ANCHOR = '    vec3 rayOrigin = rayNearFar.x * rayDirection + cameraPosition;';
/** I-1 (marchClouds, :536–538) — 2차 행진 호출의 방향 인자. */
export const TSUN_I1_ANCHOR = '      float opticalDepth = marchOpticalDepth(\n        position,\n        sunDirection,';
/** I-2 (:558, 얼음 무리 ICE_RAD 와 같은 줄) — 이 줄 **앞**에 넣음. */
export const TSUN_I2_ANCHOR = '      vec3 radiance = sunIrradiance * approximateMultipleScattering(opticalDepth, cosTheta);';
/** I-T — 종류 thru 줄(cloudGenus.ts THRU_BLOCK, 구름 패스만). */
export const TSUN_IT_ANCHOR = '        radiance += sunIrradiance * RECIPROCAL_PI4 * dot(gThru, media.weight);';
/** I-4 (:579) — 이 줄 **앞**에 넣음. */
export const TSUN_I4_ANCHOR = '      radiance *= media.scattering;';
/** 비용 셈 줄(WP8 entry-tsun 이 바로 뒤에 `++gCostTsun;` 을 붙임, ruler-delta B1) — 해 블록 읽기 하나. */
export const TSUN_COUNT_LINE = '          vec4 gTsunTexel = textureLod(gTsunTex, gTsunUv, 0.0);';
/** §179 WP8 비용 셈 줄(아치 팔만) — 노드 캐시 채우기의 하늘 LUT 호출 하나(노드마다, n_archLUT)와 I-4 의 아치 블록 읽기 둘. entry-tsun 이 바로 뒤에 셈을 붙임. */
export const TSUN_ARCH_LUT_LINE = '      vec3 Lw = GetSkyRadiance(p * METER_TO_LENGTH_UNIT, w, 0.0, sunDirection, tr) * dOm;';
/**
 * §179 고침(검토 물리 4): 아치 블록은 네 조각(줄 1~4) — hf 를 감싸는 두 줄만 읽음(여전히 읽기 둘). 섞기는 투과율 공간(τ_own·τ_rest 따로
 * −ln(mix(e^−τ_A, e^−τ_B, t))): P3B 임의 높이 U2d′ dT p95 τ 선형 0.257 · 투과율 0.177 [computed, scratchpad tsunimpl/fix/u2dp3].
 */
export const TSUN_ARCH_FETCH_LINE = '          vec4 gArchAB = -log(max(mix(exp(-textureLod(gTsunTex, gTsunUvOf(gArchEnd, gArchBlk, 1.0 + gArchK), 0.0)), exp(-textureLod(gTsunTex, gTsunUvOf(gArchEnd, gArchBlk, 2.0 + gArchK), 0.0)), gArchT), vec4(1e-30)));';

const M = TSUN_MARK;
const f6 = (x: number) => x.toFixed(10);
const DECL_T = [
  `// ${M} T_sun 선언(cloudTsun.ts — 하네스 전용, 기본 끔, 해 ≤ shadowMinSunDeg 에서만 주입)`,
  'uniform float gTsunOn;          // 1 = 아틀라스 유효, 0 = 없음(C0ps 빛 그대로)',
  'uniform sampler2D gTsunTex;     // 해 블록(+ 아치 블록 둘), 레인 블록은 가로로',
  'uniform vec4 gTsunFrame;        // 줄 방향(동, 북) · 반폭 km · 텍셀 km',
  'uniform vec4 gTsunLaneBlock;    // 레인 → 블록(−1 = 없음)',
  'uniform vec4 gTsunEpoch;        // 아틀라스 중심(종류 평면 동·북 km) · 적분 끝 km · 0',
  `uniform vec4 gTsunCond[${TSUN_COND_LEN / 4}];     // τ_c [hf ${TSUN_COND_HF.join('/')} × 도달 ${TSUN_COND_REACH_KM.join('/')} km], 성분 = 레인`,
  `uniform vec4 gTsunProf[${TSUN_PROF_N}];      // λ̂(c̄, hf k/16) [1/km], 성분 = 레인 — 위 조각 쌍의 보간 좌표`,
];
const DECL_A = [
  `// ${M} 아치 빛 선언`,
  'uniform float gArchW;           // archLight · smoothstep(−1°, −2°, θ_sun)',
  'uniform float gArchNoT;         // H0: τ_rest ≡ 0',
  `vec3 gArchC[${2 * ARCH_OCTAVES}];                // [그룹·${ARCH_OCTAVES} + 옥타브] Σ_방위 aⁱ·p(cos; cⁱ)·L·dΩ — 광선마다 채움`,
  'vec3 gArchCP = vec3(0.0);',
  'float gArchCH = 0.0;',
  'float gArchCS = 1.0;            // 채울 때의 sin(dip) — 노드 dΩ ∝ sin(dip(h)) 를 지금 높이로 다시 맞춤',
  'float gArchCL = -1.0;',
  'bool gArchCOk = false;',
];
/** §179 WP6 REF 선언 — 아틀라스·샘플러 없음(gTsunTex 없음 — WP0 샘플러 수 그대로). */
const DECL_R = [
  `// ${M} T_sun 선언(cloudTsun.ts — REF 기준 렌더, 하네스 전용: 아틀라스 없음, 해 줄 무차별 행진)`,
  'uniform float gTsunOn;          // REF 는 늘 1(아틀라스 유효 여부와 무관)',
  'uniform vec4 gTsunRef;          // 보폭 m · 적분 끝 m · T_top 보폭 m · 0',
];
/** §179 D-1 진단(tsunDebug 1, R-A_T — design v2.1 §5.4) 선언 — 화소마다 Σ wᵢ·T_beyond,i / Σ wᵢ (빛 받는 표본). */
const DECL_D = [
  `// ${M} D-1 진단 선언(tsunDebug 1 — R-A_T): 빛 받는 표본의 행진 끝 너머 투과율을 적분 무게로 평균`,
  'float gTsunDbgT = -1.0;         // 지금 표본의 T_beyond(−1 = 빛 없음·T_sun 없음)',
  'float gTsunDbgW = 0.0;          // Σ wᵢ',
  'float gTsunDbgWT = 0.0;         // Σ wᵢ·T_beyond,i',
  'float gTsunDbgWM = 0.0;         // Σ wᵢ·mipLevel (§179 고침, 검토 물리 5 — R-A_T 창마다 빛 받는 표본의 평균 mip)',
];
const S = TSUN_SLICE_HF;
// 도움 함수 조각 — T 팔은 아래 순서 그대로 모두(HELPERS_T, WP4 글자와 바이트 같음), REF 팔(WP6)은 레인·Eddington·도달·무차별 행진만(HELPERS_R).
const H_HEAD_T = [`// ${M} T_sun 도움 함수(cloudTsun.ts)`];
const H_LANE = [
  '// 가장 무거운 레인(첫 최댓값)의 원핫.',
  'vec4 gTsunLaneSel(const vec4 w) {',
  '  float m = max(max(w.x, w.y), max(w.z, w.w));',
  '  return w.x >= m ? vec4(1.0, 0.0, 0.0, 0.0) : w.y >= m ? vec4(0.0, 1.0, 0.0, 0.0) : w.z >= m ? vec4(0.0, 0.0, 1.0, 0.0) : vec4(0.0, 0.0, 0.0, 1.0);',
  '}',
];
const H_PATH = [
  '// u_true: 높이 h0(km)에서 국소 해 고도 사인 sinE 로 곧게 D km 가는 선이 구면 껍질 [hb, ht] 안에 머무는 길이(km) — 닫힌 꼴, 모든 부호(v2.1 phys M2).',
  '// ρ² − r0² 를 (ρ − r0)(ρ + r0) 로 높이 차에서 셈(단정밀 상쇄를 피함).',
  'float gTsunPath(const float h0, const float sinE, const float hb, const float ht, const float D) {',
  '  float Rb = bottomRadius * 1e-3;',
  '  float b = (Rb + h0) * sinE;',
  '  float discT = b * b + (ht - h0) * (2.0 * Rb + ht + h0);',
  '  if (discT <= 0.0) return 0.0;',
  '  float qT = sqrt(discT);',
  '  float len = max(0.0, min(-b + qT, D) - max(-b - qT, 0.0));',
  '  float discB = b * b + (hb - h0) * (2.0 * Rb + hb + h0);',
  '  if (discB > 0.0) {',
  '    float qB = sqrt(discB);',
  '    len -= max(0.0, min(-b + qB, D) - max(-b - qB, 0.0));',
  '  }',
  '  return max(len, 0.0);',
  '}',
];
const H_UV = [
  '// 아틀라스 uv — 종류 평면 km → 줄(해 방위)·가로 좌표 → 블록 안 텍셀(반 텍셀 안쪽으로 고정, 레인끼리 새지 않게).',
  'vec2 gTsunUvOf(const vec3 p, const float blk, const float row) {',
  '  vec2 km = getGlobeUv(p) * genusTileM * 1e-3 - gTsunEpoch.xy;',
  '  vec2 ax = gTsunFrame.xy;',
  '  vec2 g = (vec2(dot(km, ax), dot(km, vec2(-ax.y, ax.x))) + gTsunFrame.z) / gTsunFrame.w;',
  '  float n = floor(2.0 * gTsunFrame.z / gTsunFrame.w + 0.5);',
  '  g = clamp(g, vec2(0.5), vec2(n - 0.5));',
  '  vec2 sz = vec2(textureSize(gTsunTex, 0));',
  '  return vec2(blk * n + g.x, row * n + g.y) / sz;',
  '}',
];
/**
 * §179 고침(검토 물리 1) — λ 무게 층 안 경로 W(h0) = ∫ λ̂(hf(s)) ds: 높이 h0 에서 국소 해 고도 사인 sinE 로 곧게 D km 가는 선이 [hb, ht] 안에 있는
 * 구간(최대 둘 — 층 밑 껍질 구간을 뺀 꼭대기 껍질 구간, 땅에 닿으면 거기서 끝)마다 Gauss–Legendre 4 점. 높이는 상쇄 없는 꼴
 * Δh = s(2b + s) / (√(r0² + s(2b + s)) + r0). λ̂ 는 gTsunProf(hf k/16 마디 선형, 가장 무거운 레인 sel). CPU 거울: tsunAtlas.ts tsunPathWKm.
 */
const H_PATHW = [
  `// ${M} λ̂(hf) — 레인 단면 gTsunProf(hf k/${TSUN_PROF_N - 1} 마디) 선형, 성분 = 레인(sel).`,
  'float gTsunLam(const float hf, const vec4 sel) {',
  `  float x = clamp(hf, 0.0, 1.0) * ${(TSUN_PROF_N - 1).toFixed(1)};`,
  `  int i = min(int(x), ${TSUN_PROF_N - 2});`,
  '  return dot(mix(gTsunProf[i], gTsunProf[i + 1], x - float(i)), sel);',
  '}',
  '// 한 구간 [a, c] 의 ∫ λ̂ ds — Gauss–Legendre 4 점(곧은 선 높이 h(s), 층 [hb, hb + H]).',
  'float gTsunGL4(const float a, const float c, const float r0, const float b, const float h0, const float hb, const float H, const vec4 sel) {',
  '  float L = c - a;',
  '  if (L <= 0.0) return 0.0;',
  `  const vec4 X = vec4(${TSUN_GL4_X.join(', ')});`,
  `  const vec4 Wt = vec4(${TSUN_GL4_W.join(', ')});`,
  '  float acc = 0.0;',
  '  for (int k = 0; k < 4; ++k) {',
  '    float s = a + X[k] * L;',
  '    float q = s * (2.0 * b + s);',
  '    acc += Wt[k] * gTsunLam((h0 + q / (sqrt(r0 * r0 + q) + r0) - hb) / H, sel);',
  '  }',
  '  return acc * L;',
  '}',
  '// W(h0) — 위 두 조각 쌍의 보간 좌표(gTsunPath 의 λ 무게 판). 땅(h < 0)에 닿으면 끝.',
  'float gTsunPathW(const float h0, const float sinE, const float hb, const float ht, const float D, const vec4 sel) {',
  '  float Rb = bottomRadius * 1e-3;',
  '  float r0 = Rb + h0;',
  '  float b = r0 * sinE;',
  '  float discT = b * b + (ht - h0) * (2.0 * Rb + ht + h0);',
  '  if (discT <= 0.0) return 0.0;',
  '  float qT = sqrt(discT);',
  '  float a0 = max(-b - qT, 0.0), a1 = min(-b + qT, D);',
  '  float discG = b * b - h0 * (2.0 * Rb + h0);',
  '  if (discG > 0.0 && -b - sqrt(discG) > 0.0) a1 = min(a1, -b - sqrt(discG));',
  '  if (a1 <= a0) return 0.0;',
  '  float c0 = a1, c1 = a1;',
  '  float discB = b * b + (hb - h0) * (2.0 * Rb + hb + h0);',
  '  if (discB > 0.0) {',
  '    float qB = sqrt(discB);',
  '    c0 = clamp(-b - qB, a0, a1);',
  '    c1 = clamp(-b + qB, a0, a1);',
  '  }',
  '  float H = max(ht - hb, 1e-3);',
  '  return gTsunGL4(a0, c0, r0, b, h0, hb, H, sel) + gTsunGL4(c1, a1, r0, b, h0, hb, H, sel);',
  '}',
];
const H_SLICE = [
  `// 조각 τ 보간(조각 hf ${S.join('/')}): 가장 낮은 쌍은 층 안 경로 u_true, 위 두 쌍은 λ 무게 경로 W(§179 고침 — 검토 물리 1의 'hybrid').`,
  '// 좌표 차 < 1e-3 이면 hf 선형. 보간 계수는 [−1, 2] 로(D8).',
  'float gTsunSliceTau(const vec4 t, const float he, const float hb, const float ht, const float sinE, const float D, const vec4 sel) {',
  '  float H = max(ht - hb, 1e-3);',
  '  float f = clamp((he - hb) / H, 0.0, 1.0);',
  `  vec2 fk = f < ${S[1].toFixed(2)} ? vec2(${S[0].toFixed(2)}, ${S[1].toFixed(2)}) : f < ${S[2].toFixed(2)} ? vec2(${S[1].toFixed(2)}, ${S[2].toFixed(2)}) : vec2(${S[2].toFixed(2)}, ${S[3].toFixed(2)});`,
  `  vec2 tk = f < ${S[1].toFixed(2)} ? t.xy : f < ${S[2].toFixed(2)} ? t.yz : t.zw;`,
  '  float u0, u1, ue;',
  `  if (f < ${S[1].toFixed(2)}) {`,
  '    u0 = gTsunPath(hb + fk.x * H, sinE, hb, ht, D);',
  '    u1 = gTsunPath(hb + fk.y * H, sinE, hb, ht, D);',
  '    ue = gTsunPath(he, sinE, hb, ht, D);',
  '  } else {',
  '    u0 = gTsunPathW(hb + fk.x * H, sinE, hb, ht, D, sel);',
  '    u1 = gTsunPathW(hb + fk.y * H, sinE, hb, ht, D, sel);',
  '    ue = gTsunPathW(he, sinE, hb, ht, D, sel);',
  '  }',
  '  float du = u1 - u0;',
  '  float s = abs(du) < 1e-3 ? (f - fk.x) / (fk.y - fk.x) : (ue - u0) / du;',
  '  return max(0.0, mix(tk.x, tk.y, clamp(s, -1.0, 2.0)));',
  '}',
];
if (TSUN_COND_HF.some((x, i) => Math.abs(x - (TSUN_COND_HF[0] + i * TSUN_COND_HF_STEP)) > 1e-9)) throw new Error('cloudTsun: TSUN_COND_HF must be evenly spaced by TSUN_COND_HF_STEP');
const H_COND = [
  `// τ_c(hf, 도달) — 절점 hf ${TSUN_COND_HF.join('/')}(등간격 ${TSUN_COND_HF_STEP}) × 도달 ${TSUN_COND_REACH_KM.join('/')} km 의 쌍선형(끝에서 고정), 성분 = 레인.`,
  'vec3 gTsunTent(const float x, const vec3 k) {',
  '  float w0 = clamp((k.y - x) / (k.y - k.x), 0.0, 1.0), w2 = clamp((x - k.y) / (k.z - k.y), 0.0, 1.0);',
  '  return vec3(w0, 1.0 - w0 - w2, w2);',
  '}',
  'vec4 gTsunCondAt(const float hf, const float reachKm) {',
  `  float x = clamp((hf - ${TSUN_COND_HF[0].toFixed(2)}) / ${TSUN_COND_HF_STEP.toFixed(2)}, 0.0, ${(TSUN_COND_HF.length - 1).toFixed(1)});`,
  `  int i = min(int(x), ${TSUN_COND_HF.length - 2});`,
  `  vec3 r = gTsunTent(reachKm, vec3(${TSUN_COND_REACH_KM.map(x => x.toFixed(2)).join(', ')}));`,
  '  vec4 c0 = r.x * gTsunCond[i * 3] + r.y * gTsunCond[i * 3 + 1] + r.z * gTsunCond[i * 3 + 2];',
  '  vec4 c1 = r.x * gTsunCond[i * 3 + 3] + r.y * gTsunCond[i * 3 + 4] + r.z * gTsunCond[i * 3 + 5];',
  '  return mix(c0, c1, x - float(i));',
  '}',
];
const H_EDD = [
  `// Eddington 확산 투과(보존 산란, g ${DIFFUSE_G} = cloudDiffuse.ts) — 확산 몫만: max(1 − R − e^(−τ/μ), 0).`,
  'vec4 gTsunEddDiff(const vec4 tau, const float mu) {',
  '  float m = max(mu, 1e-3);',
  '  vec4 e = exp(-tau / m);',
  `  vec4 R = (${(1 - DIFFUSE_G).toFixed(4)} * tau + (2.0 / 3.0 - mu) * (vec4(1.0) - e)) / (4.0 / 3.0 + ${(1 - DIFFUSE_G).toFixed(4)} * tau);`,
  '  return max(vec4(1.0) - R - e, vec4(0.0));',
  '}',
];
/**
 * 2차 행진이 덮은 거리(m) — marchOpticalDepth 와 같은 걸음 식. §179 고침(검토 물리 3): 표본 i 는 Σ_{k<i} step_k + s0·jitter 에 있고 무게 step_i 라
 * 고른 σ 에서 기댓값이 정확히 σ·Σ_k step_k — 행진의 실제 끝은 **jitter 없는** Σ_k step_k(= sunRayDistance + 마지막 걸음 − s0·jitter).
 * 처음 판(sunRayDistance + 마지막 걸음)은 s0·jitter(평균 125/n m) 너머에서 아틀라스·REF 를 시작해 그 틈의 τ(n = 1 에서 0.07~0.37)를 빠뜨렸음.
 * τ_c 의 도달 인자도 이 값(WP1 의 r 은 표본에서 잰 거리). 걸음 0(퍼지 τ 0.5)이면 0 — sunRayDistance(out, 그때 안 씀)를 읽지 않고, τ_c 는
 * 도달 0.25 km 마디로 고정됨(sc hf 0.5 τ_c(0) 3.8~4.1 대 τ_c(0.25) 0.49~0.87 [computed] — 드묾: 광선 들머리에서 78 km 너머, REF 도 같은 규칙).
 * float(max(n, 1)): 고르지 않는 가지의 0 나누기(+inf)가 어느 드라이버에서도 NaN 섞음이 되지 않게(검토 물리 9a).
 */
const H_REACH = [
  '// 2차 행진이 덮은 거리(m) = Σ 걸음(jitter 없음, §179 고침) — marchOpticalDepth 와 같은 걸음 식. 걸음 0(퍼지 τ 0.5)이면 0(sunRayDistance 를 읽지 않음).',
  'float gTsunReach(const float mipLevel, const float jitter, const float sunRayDistance) {',
  '  int n = int(max(0.0, remap(mipLevel, 0.0, 1.0, float(maxIterationCountToSun + 1), 1.0) - jitter));',
  '  float s0 = minSecondaryStepSize / float(max(n, 1));',
  '  return n > 0 ? sunRayDistance + s0 * pow(secondaryStepScale, float(n - 1)) - s0 * jitter : 0.0;',
  '}',
];
const HELPERS_T = [...H_HEAD_T, ...H_LANE, ...H_PATH, ...H_PATHW, ...H_UV, ...H_SLICE, ...H_COND, ...H_EDD, ...H_REACH];
/**
 * §179 WP6 REF 무차별 행진 함수(ruler-delta C1·C2, design v2.1 §5.3) — REF_v2·REF_val 이 **같은 글자**(U6d). 결정(요약에도 적음):
 *  (R1) 밀도 = 1차·2차 행진과 같은 sampleWeather·sampleMedia. mip 인자는 부르는 쪽이 줌 — §179 결정(검토 물리 5): REF 의 행진 끝 너머 행진과
 *       T_top 행진은 **mip 0**(I2_REF·I2_VAL 이 0.0 을 넘김). 아틀라스 법칙(WP1 고정표)이 mip 0 이고(U1f: mip 1 의 λ 는 mip 0 의 0.68~0.93 배
 *       [from doc]), 해 줄이 지나는 구름장은 보는 이의 LOD 와 무관 — 표본 mip(critic-eng m12)이면 R-A_T 에 거리에 따른 LOD 치우침이 섞임.
 *       takram 의 가까운 행진 [0, reach] 는 그대로 표본 mip. D-1 진단이 빛 받는 표본의 평균 mip 을 함께 냄(창마다 기록).
 *       날씨 밀도가 minDensity 이하인 빈 하늘은 1차 행진의 빈 칸 규칙 그대로 0(모양 fetch 를 건너뜀 — 400 km 행진 비용).
 *  (R2) 표본 거리 (i + jitter)·보폭(2차 행진처럼 프레임마다 층화), 걸음 수 = ceil(거리/보폭), 상한 TSUN_REF_MAX_STEPS(200 m·400 km = 2000 — 설계의
 *       '≤ 2000 걸음'; REF100 은 같은 400 km 에 4000 걸음이라 상한을 4096 으로 — '≤ 2000' 을 보폭 200 m 의 값으로 읽음).
 *  (R3) 땅(h < 0)에 닿으면 끝 — 그 표본의 지구 그림자는 takram 해 조도(표본별 GetSunAndSkyIrradiance)가 이미 셈('표본별 지구 그림자').
 *       밀도 있는 레인(densityScales > 0) 꼭대기 중 가장 높은 것 위에서 위로 가면(dot(p, dir) > 0 — 곧은 선의 고도는 그 뒤로 늘기만 함) 끝
 *       ('가장 높은 층 꼭대기 위로 나가면'). §179 고침(검토 물리 11): 처음 판은 빈 레인(앱이 남겨 두는 7.5~11 km 꼭대기)까지 넣어 거의 늘 400 km 를
 *       다 걸었음 — densityScales 0 인 레인은 밀도가 0(takram sampleWeather 의 density × densityScales)이라 결과는 같고 비용만 줄어듦.
 *  (R4) 비용 변형 COST_PATCH 의 2차 행진 앵커('    MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter);\n    opticalDepth +=')와
 *       글자가 겹치지 않게 지역 이름을 gTsun… 로(U6c — 앵커 6 개가 모든 팔에서 정확히 한 번). 모양 fetch 는 sampleMedia 안이라 y 에 저절로 셈.
 */
export const TSUN_REF_MAX_STEPS = 4096;
/** REF 무차별 행진 함수 머리(U6d 가 이 글자로 함수를 꺼냄). */
export const TSUN_REF_MARCH_HEAD = 'float gTsunRefMarch(';
const H_REFMARCH = [
  `// REF 무차별 행진(cloudTsun.ts TSUN_REF_MARCH_HEAD 머리말 R1~R4): p0 에서 dir 로 보폭 stepM, rangeM 까지·땅·가장 높은 층 위에서 끝, 걸음 ≤ ${TSUN_REF_MAX_STEPS}.`,
  'float gTsunRefMarch(const vec3 p0, const vec3 dir, const float stepM, const float rangeM, const float mipLevel, const float jitter) {',
  '  vec4 gTsunTops = maxLayerHeights * step(vec4(1e-9), densityScales);',
  '  float gTsunHTop = max(max(gTsunTops.x, gTsunTops.y), max(gTsunTops.z, gTsunTops.w));',
  `  int gTsunN = min(int(ceil(rangeM / stepM)), ${TSUN_REF_MAX_STEPS});`,
  '  float gTsunTau = 0.0;',
  '  for (int gTsunI = 0; gTsunI < gTsunN; ++gTsunI) {',
  '    vec3 gTsunP = p0 + dir * ((float(gTsunI) + jitter) * stepM);',
  '    float gTsunH = length(gTsunP) - bottomRadius;',
  '    if (gTsunH < 0.0) break;',
  '    if (gTsunH > gTsunHTop && dot(gTsunP, dir) > 0.0) break;',
  '    vec2 gTsunUv = getGlobeUv(gTsunP);',
  '    WeatherSample gTsunWs = sampleWeather(gTsunUv, gTsunH, mipLevel);',
  '    if (!any(greaterThan(gTsunWs.density, vec4(minDensity)))) continue;',
  '    MediaSample gTsunMs = sampleMedia(gTsunWs, gTsunP, gTsunUv, mipLevel, jitter);',
  '    gTsunTau += gTsunMs.extinction * stepM;',
  '  }',
  '  return gTsunTau;',
  '}',
];
const HELPERS_R = [`// ${M} T_sun 도움 함수(cloudTsun.ts — REF: 아틀라스 없음, 무차별 행진; Eddington·도달 글자는 T 팔과 같음)`, ...H_LANE, ...H_EDD, ...H_REACH, ...H_REFMARCH];
const HELPERS_A = [
  `// ${M} 아치 빛 도움 함수 — GetTransmittanceToSun 의 지구 그림자 smoothstep 을 ALU 로 옮긴 것(vis).`,
  `// 정적 단언(검토 물리 12): 아치 옥타브 ${ARCH_OCTAVES} 이 takram MULTI_SCATTERING_OCTAVES 와 다르면 컴파일 실패(조용히 다른 옥타브 합이 되지 않게).`,
  `#if defined(MULTI_SCATTERING_OCTAVES) && MULTI_SCATTERING_OCTAVES != ${ARCH_OCTAVES}`,
  `#error T_sun arch octave count ${ARCH_OCTAVES} differs from MULTI_SCATTERING_OCTAVES`,
  '#endif',
  'float gArchVis(const vec3 p) {',
  '  float r = length(p) * METER_TO_LENGTH_UNIT;',
  '  float sh = ATMOSPHERE.bottom_radius / r;',
  '  float ch = -sqrt(max(1.0 - sh * sh, 0.0));',
  '  float a = sh * ATMOSPHERE.sun_angular_radius;',
  '  return smoothstep(-a, a, dot(normalize(p), sunDirection) - ch);',
  '}',
  'float gArchDip(const vec3 p) {',
  '  return acos(clamp(ATMOSPHERE.bottom_radius / (length(p) * METER_TO_LENGTH_UNIT), 0.0, 1.0));',
  '}',
  '// 아치 방위 = 아틀라스 줄 방향(구축 시 해 방위)을 그 자리 접평면에.',
  'vec3 gArchRowAxis(const vec3 n) {',
  '  vec3 a = genusEast * gTsunFrame.x + genusNorth * gTsunFrame.y;',
  '  return normalize(a - n * dot(n, a));',
  '}',
  '// 방향 바꾸기의 끝 방향 — 고도 −dip/2, 줄 방향.',
  'vec3 gArchDirMid(const vec3 p) {',
  '  vec3 n = normalize(p);',
  '  float e = -0.5 * gArchDip(p);',
  '  return cos(e) * gArchRowAxis(n) + sin(e) * n;',
  '}',
  `// 노드 6 개(고도 GL2 ${ARCH_GL2.map(f6).join('/')} × dip, 방위 ${ARCH_AZ_DEG.join('/')}°, 노드 폭 ${ARCH_AZ_WIDTH_DEG}°) — dΩ = sin(dip)/2 × 폭.`,
  '// gArchC[g·8 + i] = Σ_방위 aⁱ·phaseFunction(cos, cⁱ)·L·dΩ (a = c = 0.5, takram 옥타브와 같음).',
  'void gArchFill(const vec3 p, const vec3 rayDir) {',
  '  vec3 n = normalize(p), a = gArchRowAxis(n), b = cross(n, a);',
  '  float dip = gArchDip(p);',
  `  float dOm = sin(dip) * 0.5 * radians(${ARCH_AZ_WIDTH_DEG.toFixed(1)});`,
  `  for (int k = 0; k < ${2 * ARCH_OCTAVES}; ++k) gArchC[k] = vec3(0.0);`,
  '  for (int g = 0; g < 2; ++g) {',
  `    float e = -dip * (g == 0 ? ${f6(ARCH_GL2[0])} : ${f6(ARCH_GL2[1])});`,
  '    for (int j = 0; j < 3; ++j) {',
  `      float az = radians(${ARCH_AZ_DEG[0].toFixed(1)} + ${ARCH_AZ_WIDTH_DEG.toFixed(1)} * float(j));`,
  '      vec3 w = cos(e) * (cos(az) * a + sin(az) * b) + sin(e) * n;',
  '      vec3 tr;',
  TSUN_ARCH_LUT_LINE,
  '      float cv = dot(w, rayDir);',
  '      float ai = 1.0;',
  `      for (int i = 0; i < ${ARCH_OCTAVES}; ++i) {`,
  `        gArchC[g * ${ARCH_OCTAVES} + i] += ai * phaseFunction(cv, ai) * Lw;`,
  '        ai *= 0.5;',
  '      }',
  '    }',
  '  }',
  '}',
];
/** I-0 — 아치 팔만(D3). */
const I0 = [TSUN_I0_ANCHOR, `    gArchCOk = false;   // ${M} I-0 아치 노드 캐시(광선마다)`];
/** I-1 — 아치 팔만: vis·r·gMarchDir 선언, 2차 행진 방향 인자를 gMarchDir 로. */
const I1 = [
  `      // ${M} I-1 아치 빛 방향 바꾸기(연속, v2.1 eng M7) — r = w(θ)·(1 − vis); r = 0 이면 sunDirection 그대로(비트 같음). 아틀라스가 없으면 r = 0.`,
  '      float gVis = gArchVis(position);',
  '      float gArchR = gTsunOn > 0.5 ? gArchW * (1.0 - gVis) : 0.0;',
  '      vec3 gMarchDir = sunDirection;',
  '      if (gArchR > 0.0) gMarchDir = normalize(mix(sunDirection, gArchDirMid(position), gArchR));',
  '      float opticalDepth = marchOpticalDepth(\n        position,\n        gMarchDir,',
];
/** I-2 — MS 줄 앞. T 팔은 여기서 gMarchDir 을 선언(eng M1), 아치 팔은 I-1 이 선언. */
const I2 = (arch: boolean, dbg = false) => [
  `      // ${M} I-2 T_sun — 행진 끝 너머 해 줄 τ(아틀라스 한 번 + u_true 보간 + τ_c)를 직달 햇빛에 Beer 로(MS 옥타브·무리). opticalDepth 에는 안 더함.`,
  ...(arch ? [] : ['      vec3 gMarchDir = sunDirection;']),
  '      vec3 gTsunIrrUncut = sunIrradiance;',
  '      float gTsunTtop = 1.0;',
  '      float gTsunW = 0.0;',
  '      float gTsunMu0 = dot(surfaceNormal, sunDirection);',
  ...(dbg ? [D_RESET] : []),
  '      if (gTsunOn > 0.5 && max(sunIrradiance.r, max(sunIrradiance.g, sunIrradiance.b)) > 0.0) {',
  ...(dbg ? [`        gTsunDbgT = 1.0;   // ${M} D-1 빛 받음 — 레인 블록이 없으면 너머 τ 0(오늘 빛)`] : []),
  '        vec4 gTsunSel = gTsunLaneSel(media.weight);',
  '        float gTsunBlk = dot(gTsunLaneBlock, gTsunSel);',
  '        if (gTsunBlk >= 0.0) {',
  '          float gTsunReachM = gTsunReach(mipLevel, jitter, sunRayDistance);',
  '          vec3 gTsunEnd = position + gMarchDir * gTsunReachM;',
  '          vec2 gTsunUv = gTsunUvOf(gTsunEnd, gTsunBlk, 0.0);',
  TSUN_COUNT_LINE,
  '          float gTsunHb = dot(minLayerHeights, gTsunSel) * 1e-3;',
  '          float gTsunHt = dot(maxLayerHeights, gTsunSel) * 1e-3;',
  '          float gTsunHe = (length(gTsunEnd) - bottomRadius) * 1e-3;',
  '          float gTsunTau = gTsunSliceTau(gTsunTexel, gTsunHe, gTsunHb, gTsunHt, dot(normalize(gTsunEnd), sunDirection), gTsunEpoch.z, gTsunSel);',
  '          float gTsunHf = (gTsunHe - gTsunHb) / max(gTsunHt - gTsunHb, 1e-3);',
  '          float gTsunOwn = step(0.0, gTsunHf) * step(gTsunHf, 1.0);',
  '          gTsunTau = max(0.0, gTsunTau + dot(gTsunCondAt(clamp(gTsunHf, 0.0, 1.0), gTsunReachM * 1e-3), gTsunSel) * gTsunOwn);',
  '          sunIrradiance *= exp(-gTsunTau);',
  ...(dbg ? [`          gTsunDbgT = exp(-gTsunTau);   // ${M} D-1`] : []),
  `          gTsunTtop = exp(-(gTsunMu0 >= 0.0 ? gTsunTexel.a : gTsunTexel.x));   // ${M} 해가 표본 지평선 아래(μ0 < 0)면 빛은 밑면으로 — 가장 낮은 조각(검토 물리 7)`,
  '          gTsunW = 1.0 - exp(-gTsunTau);',
  '        }',
  '      }',
  TSUN_I2_ANCHOR,
];
/** D-1 표본마다 되돌림(I-2 머리). */
const D_RESET = `      gTsunDbgT = -1.0;   // ${M} D-1 표본마다 되돌림`;
/**
 * §179 WP6 I-2 REF_v2(tsunRef 1, ruler-delta C1) — takram 2차 행진 [0, reach] 그대로, p_end 너머는 무차별 행진 τ 를 직달 햇빛에 Beer.
 * V10b(I-T)는 T 팔과 **같은 글자**(U6b): τ_far = 무차별 τ, T_top = p_end 위 레인 꼭대기에서 1000 m 보폭 행진. 그림자 지도·아틀라스 안 읽음.
 */
const I2_REF = (dbg: boolean) => [
  `      // ${M} I-2 REF_v2 — 행진 끝 너머 해 줄 τ 를 무차별 행진(보폭 gTsunRef.x m, gTsunRef.y m 까지)으로, 직달 햇빛에 Beer(MS 옥타브·무리). opticalDepth 에는 안 더함.`,
  '      vec3 gMarchDir = sunDirection;',
  '      vec3 gTsunIrrUncut = sunIrradiance;',
  '      float gTsunTtop = 1.0;',
  '      float gTsunW = 0.0;',
  '      float gTsunMu0 = dot(surfaceNormal, sunDirection);',
  ...(dbg ? [D_RESET] : []),
  '      if (gTsunOn > 0.5 && max(sunIrradiance.r, max(sunIrradiance.g, sunIrradiance.b)) > 0.0) {',
  '        float gTsunReachM = gTsunReach(mipLevel, jitter, sunRayDistance);',
  '        vec3 gTsunEnd = position + gMarchDir * gTsunReachM;',
  '        float gTsunTau = gTsunRefMarch(gTsunEnd, sunDirection, gTsunRef.x, gTsunRef.y, 0.0, jitter);   // mip 0(R1 결정)',
  `        // T_top: p_end 위(같은 연직) 가장 무거운 레인의 꼭대기 점(μ0 < 0 이면 hf ${TSUN_SLICE_HF[0]} 조각 — 밑면으로 들어오는 빛)에서 gTsunRef.z m 보폭 행진(T 팔의 조각과 같은 뜻).`,
  `        vec3 gTsunTopP = normalize(gTsunEnd) * (bottomRadius + dot(mix(minLayerHeights, maxLayerHeights, gTsunMu0 >= 0.0 ? 1.0 : ${TSUN_SLICE_HF[0].toFixed(2)}), gTsunLaneSel(media.weight)));`,
  '        sunIrradiance *= exp(-gTsunTau);',
  ...(dbg ? [`        gTsunDbgT = exp(-gTsunTau);   // ${M} D-1`] : []),
  '        gTsunTtop = exp(-gTsunRefMarch(gTsunTopP, sunDirection, gTsunRef.z, gTsunRef.y, 0.0, jitter));',
  '        gTsunW = 1.0 - exp(-gTsunTau);',
  '      }',
  TSUN_I2_ANCHOR,
];
/**
 * §179 WP6 I-2 REF_val(tsunRef 2, ruler-delta C2) — 같은 무차별 행진 τ 를 opticalDepth 에 더함(옥타브·§168 역광 어둡게 — BSM 같은 규칙).
 * BSM 처럼 해 조도와 무관하게 더함(REF 검증 (i) HS 45·30·15° 전용). thru 줄은 그대로(I-T 없음).
 */
const I2_VAL = (dbg: boolean) => [
  `      // ${M} I-2 REF_val — 행진 끝 너머 무차별 행진 τ 를 opticalDepth 에 더함(BSM 같은 규칙: 옥타브·역광 어둡게). thru 줄은 그대로.`,
  ...(dbg ? [D_RESET] : []),
  '      if (gTsunOn > 0.5) {',
  '        float gTsunTauV = gTsunRefMarch(position + sunDirection * gTsunReach(mipLevel, jitter, sunRayDistance), sunDirection, gTsunRef.x, gTsunRef.y, 0.0, jitter);   // mip 0(R1 결정)',
  '        opticalDepth += gTsunTauV;',
  ...(dbg ? [`        if (max(sunIrradiance.r, max(sunIrradiance.g, sunIrradiance.b)) > 0.0) gTsunDbgT = exp(-gTsunTauV);   // ${M} D-1`] : []),
  '      }',
  TSUN_I2_ANCHOR,
];
/** D-1 누적 앵커(marchClouds 적분 줄, 구름 패스 1 번) — 이 줄 **앞**에 wᵢ 누적. */
export const TSUN_DBG_ACC_ANCHOR = '      radianceIntegral += transmittanceIntegral * scatteringIntegral;';
/** D-1 출력 앵커(main 끝) — 마지막 색 쓰기 뒤에 진단 값으로 덮어씀. */
export const TSUN_DBG_OUT_ANCHOR = '  outputColor = ((any(isnan(color)) || any(isinf(color))) ? vec4(0.0) : color);';
const D_ACC = [
  `      // ${M} D-1 진단 누적 — wᵢ = T_앞·(1 − e^(−σΔs)): 이 표본이 화소에 들어가는 적분 무게(빛 받는 표본만).`,
  '      if (gTsunDbgT >= 0.0) {',
  '        float gTsunDbgWi = transmittanceIntegral * (1.0 - transmittance);',
  '        gTsunDbgW += gTsunDbgWi;',
  '        gTsunDbgWT += gTsunDbgWi * gTsunDbgT;',
  '        gTsunDbgWM += gTsunDbgWi * mipLevel;',
  '      }',
  TSUN_DBG_ACC_ANCHOR,
];
const D_OUT = [
  TSUN_DBG_OUT_ANCHOR,
  `  // ${M} D-1 진단 출력 — R = √T̄(T̄ = Σw·T / Σw), G = Σw, B = Σw·T, A = Σw·mip(빛 받는 표본의 평균 mip = A/G, 검토 물리 5). 하네스(entry-tsun)가 구름 패스 출력(해석 전)을 바로 읽음 — 대기·안개·톤 안 거침.`,
  '  outputColor = vec4(sqrt(clamp(gTsunDbgWT / max(gTsunDbgW, 1e-6), 0.0, 1.0)), gTsunDbgW, gTsunDbgWT, gTsunDbgWM);',
];
/** I-T — V10b. else 가지에 원래 줄 그대로(U4e). */
const IT = [
  `        // ${M} I-T V10b — mix(오늘 thru, Eddington 확산 투과 × T_top × |μ0|/π, 1 − e^(−τ_far)). 해 쪽 기둥: μ0 ≥ 0 이면 위, 아니면 아래(D7).`,
  '        if (gTsunOn > 0.5) {',
  '          vec4 gTsunTauBelow = media.extinction * max(weather.heightFraction, vec4(0.0)) * gLayerH;',
  '          float gTsunMuA = abs(gTsunMu0);',
  '          vec4 gTsunTd = gTsunEddDiff(gTsunMu0 >= 0.0 ? gTau : gTsunTauBelow, gTsunMuA);',
  '          radiance += mix(gTsunIrrUncut * RECIPROCAL_PI4 * dot(gThru, media.weight),',
  '                          gTsunIrrUncut * gTsunTtop * (gTsunMuA * RECIPROCAL_PI) * dot(genusThru * genusOn * gTsunTd, media.weight),',
  '                          gTsunW);',
  '        } else {',
  TSUN_IT_ANCHOR,
  '        }',
];
/** I-4 — 아치 팔만, `radiance *= media.scattering;` 앞(§168 역광 어둡게 뒤, 어둡게 하지 않음). */
const I4 = [
  `      // ${M} I-4 아치 빛 — S = Σ_g [Σ_i C_g,i·exp(−bⁱ(τ_mid + τ_own,g))]·exp(−τ_rest,g), radiance += r·S (r = w(θ)·(1 − vis)).`,
  `      // 아치 블록은 조각 hf ${S.join('/')}(줄 1~4) — 행진 끝 hf 를 감싸는 두 줄을 hf 계수로 투과율 공간에서 섞음(계수 [0, 1] 고정, 밖은 끝 조각 값). 노드 캐시는 1 km 마다 채우고`,
  '      // 그 사이 dΩ ∝ sin(dip(h)) 를 지금 높이로 다시 맞춤(검토 물리 8: 1 km 안에서 ×1.26 까지 흐름).',
  '      if (gArchR > 0.0) {',
  '        vec4 gArchSel = gTsunLaneSel(media.weight);',
  '        float gArchBlk = dot(gTsunLaneBlock, gArchSel);',
  '        if (gArchBlk >= 0.0) {',
  '          float gArchL = dot(gArchSel, vec4(0.0, 1.0, 2.0, 3.0));',
  '          if (!gArchCOk || gArchL != gArchCL || abs(height - gArchCH) > 1000.0 || distance(position, gArchCP) > 10000.0) {',
  '            gArchFill(position, rayDirection);',
  '            gArchCOk = true;',
  '            gArchCL = gArchL;',
  '            gArchCH = height;',
  '            gArchCP = position;',
  '            gArchCS = max(sin(gArchDip(position)), 1e-6);',
  '          }',
  '          vec3 gArchEnd = position + gMarchDir * gTsunReach(mipLevel, jitter, sunRayDistance);',
  '          float gArchHb = dot(minLayerHeights, gArchSel), gArchHt = dot(maxLayerHeights, gArchSel);',
  `          float gArchHf = clamp((length(gArchEnd) - bottomRadius - gArchHb) / max(gArchHt - gArchHb, 1.0), ${S[0].toFixed(2)}, ${S[3].toFixed(2)});`,
  `          float gArchK = gArchHf < ${S[1].toFixed(2)} ? 0.0 : gArchHf < ${S[2].toFixed(2)} ? 1.0 : 2.0;`,
  `          vec2 gArchFk = gArchHf < ${S[1].toFixed(2)} ? vec2(${S[0].toFixed(2)}, ${S[1].toFixed(2)}) : gArchHf < ${S[2].toFixed(2)} ? vec2(${S[1].toFixed(2)}, ${S[2].toFixed(2)}) : vec2(${S[2].toFixed(2)}, ${S[3].toFixed(2)});`,
  '          float gArchT = clamp((gArchHf - gArchFk.x) / (gArchFk.y - gArchFk.x), 0.0, 1.0);',
  TSUN_ARCH_FETCH_LINE,
  '          if (gArchNoT > 0.5) gArchAB.yw = vec2(0.0);',
  '          vec3 gArchS = vec3(0.0);',
  '          float gArchB = 1.0;',
  `          for (int gArchI = 0; gArchI < ${ARCH_OCTAVES}; ++gArchI) {`,
  '            gArchS += gArchC[gArchI] * exp(-gArchB * (opticalDepth + gArchAB.x) - gArchAB.y)',
  `                    + gArchC[${ARCH_OCTAVES} + gArchI] * exp(-gArchB * (opticalDepth + gArchAB.z) - gArchAB.w);`,
  '            gArchB *= 0.5;',
  '          }',
  '          radiance += gArchR * (sin(gArchDip(position)) / gArchCS) * gArchS;',
  '        }',
  '      }',
  TSUN_I4_ANCHOR,
];

const countOf = (s: string, a: string) => s.split(a).length - 1;
function replaceOnce(src: string, anchor: string, to: string, tag: string): string {
  const n = countOf(src, anchor);
  if (n !== 1) throw new Error(`cloudTsun: ${tag} anchor count ${n} — ${anchor.trim().split('\n')[0].slice(0, 56)}`);
  return src.replace(anchor, () => to);
}

/**
 * 주입 전 글자 → T_sun(+ 아치) 글자. 구름 패스 글자에만 부릅니다(그림자 패스에는 앵커가 없어 throw — 부르는 쪽이 구름 패스만 넘김).
 * 앵커는 모두 정확히 한 번이어야 함(조용히 원문이 되지 않게). cloudGenus refreshVariant 가 얼음·확산 뒤, grain refine·sunLowpass·jitter 앞에 부름.
 */
export function injectTsunText(base: string, cfg: TsunShaderConfig): string {
  const ref = cfg.ref ?? 0, dbg = cfg.debug === 1;
  if (ref && cfg.arch) throw new Error('cloudTsun: REF text has no arch arm');
  const declD = dbg ? DECL_D : [];
  let src: string;
  if (ref) {
    // §179 WP6 REF_v2(1)·REF_val(2): 아틀라스 없음 — 선언·도움 함수·I-2(+ REF_v2 만 I-T, T 팔과 같은 글자).
    src = replaceOnce(base, TSUN_DECL_ANCHOR, [TSUN_DECL_ANCHOR, ...DECL_R, ...declD].join('\n'), 'decl');
    src = replaceOnce(src, TSUN_HELPER_ANCHOR, [...HELPERS_R, TSUN_HELPER_ANCHOR].join('\n'), 'helpers');
    src = replaceOnce(src, TSUN_I2_ANCHOR, (ref === 1 ? I2_REF(dbg) : I2_VAL(dbg)).join('\n'), 'I-2');
    if (ref === 1) src = replaceOnce(src, TSUN_IT_ANCHOR, IT.join('\n'), 'I-T');
  } else {
    src = replaceOnce(base, TSUN_DECL_ANCHOR, [TSUN_DECL_ANCHOR, ...DECL_T, ...(cfg.arch ? DECL_A : []), ...declD].join('\n'), 'decl');
    src = replaceOnce(src, TSUN_HELPER_ANCHOR, [...HELPERS_T, ...(cfg.arch ? HELPERS_A : []), TSUN_HELPER_ANCHOR].join('\n'), 'helpers');
    if (cfg.arch) {
      src = replaceOnce(src, TSUN_I0_ANCHOR, I0.join('\n'), 'I-0');
      src = replaceOnce(src, TSUN_I1_ANCHOR, I1.join('\n'), 'I-1');
    }
    src = replaceOnce(src, TSUN_I2_ANCHOR, I2(cfg.arch, dbg).join('\n'), 'I-2');
    src = replaceOnce(src, TSUN_IT_ANCHOR, IT.join('\n'), 'I-T');
    if (cfg.arch) src = replaceOnce(src, TSUN_I4_ANCHOR, I4.join('\n'), 'I-4');
  }
  if (dbg) {
    // §179 D-1(R-A_T): 적분 줄 앞 누적 + main 끝 출력 덮어쓰기.
    src = replaceOnce(src, TSUN_DBG_ACC_ANCHOR, D_ACC.join('\n'), 'D-1 acc');
    src = replaceOnce(src, TSUN_DBG_OUT_ANCHOR, D_OUT.join('\n'), 'D-1 out');
  }
  return src;
}

/** 표지 줄 — 주입 지점마다 정확히 한 번(U4a 가 셈). */
export const TSUN_MARKS = {
  decl: `// ${M} T_sun 선언`, declArch: `// ${M} 아치 빛 선언`, helpers: `// ${M} T_sun 도움 함수`, helpersArch: `// ${M} 아치 빛 도움 함수`,
  i0: `// ${M} I-0`, i1: `// ${M} I-1`, i2: `// ${M} I-2`, it: `// ${M} I-T`, i4: `// ${M} I-4`,
  // §179 WP6·D-1
  declRef: `// ${M} T_sun 선언(cloudTsun.ts — REF`, helpersRef: `// ${M} T_sun 도움 함수(cloudTsun.ts — REF`, i2ref: `// ${M} I-2 REF_v2`, i2val: `// ${M} I-2 REF_val`,
  dDecl: `// ${M} D-1 진단 선언`, dAcc: `// ${M} D-1 진단 누적`, dOut: `// ${M} D-1 진단 출력`,
} as const;

/** 하네스·시험: cloudTsun.ts 의 주입 등록에 이 글자를 겁니다(여러 번 불러도 같음). */
export function installTsunShader(): void { registerTsunShader(injectTsunText); }
