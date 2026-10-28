/**
 * archQuad.ts — §179 WP5 아치 빛 계약 적분의 **노드·가중치**(셰이더가 쓸 구적)와 takram 옥타브 식. three.js 없음, 순수 함수.
 * **하네스 전용**(2026-10-28 사용자 결정: 앱 경로 없음, 기본 끔). 셰이더 쪽 글자는 cloudTsun.ts(WP4) 의 gArchFill·I-4 가 같은 식을 씁니다.
 * CPU 기준 적분기는 tools/genus-ruler/tsun/archcpu/(archquad.py 가 이 파일의 파이썬 거울 — archquad-test.mjs 가 둘을 1e-12 로 견줌).
 *
 * 계약(ruler-delta A2(c)(d) · design v2 §3.2 · v2.1 §4.5) — 그늘 표본 x 의 아치 항:
 *   Ω = [−dip, 0] × (줄 방향 ± 30°),  dip(h) = acos(R_b / (R_b + h)),  R_b = 6360 km(Bruneton 표와 같은 구).
 *   노드 6 개 = 고도 GL2 두 점 × 방위 셋:
 *     e_g = −f_g · dip,  f = (3 ∓ √3)/6 = 0.2113… / 0.7887…  ([0, 1] 위 2 점 Gauss–Legendre 절점),
 *     방위 −20° · 0° · +20°(줄 방향 = 아틀라스 구축 때의 해 방위를 그 자리 접평면에 — 셰이더 gArchRowAxis 와 같음).
 *   가중치 dΩ = sin(dip)/2 × 20°(라디안) — **띠의 정확한 입체각** sin(dip)·60° 를 여섯 등분(U5a: 합 = sin(dip)·π/3 sr).
 *     (결정 D-q1) GL 본래 가중치 (dip/2)·cos e_g 가 아니라 정확한 입체각을 고도마다 반씩: 설계 v2 §3.2 그대로. 둘의 차는
 *     dip ≤ 3.05°(9 km) 에서 상대 ≤ 1e−7 [computed] 이라 노드 값에는 무관하고, 합이 띠의 입체각과 정확히 같아짐.
 *   옥타브(takram approximateMultipleScattering, a = b = c = 0.5, 8 옥타브 — qualityPresets 의 multiScatteringOctaves 8):
 *     C_{g,i} = Σ_방위 aⁱ · p(ω_k·v; cⁱ) · L_k · dΩ_k             (광선마다 채우는 캐시, v = 시선 방향 rayDirection)
 *     S       = Σ_g [ Σ_i C_{g,i} · exp(−bⁱ(τ_mid + τ_own,g)) ] · exp(−τ_rest,g)   (archNoT 면 τ_rest ≡ 0)
 *   p = takram 이중 HG(ACCURATE_PHASE_FUNCTION 끔): (1 − m)·HG(g₁·c) + m·HG(g₂·c), g₁ 0.7 · g₂ −0.2 · m 0.5(CloudsMaterial 기본, 앱이 안 바꿈).
 *   aⁱ 는 C 안에서만 한 번(v2.1 phys m3). 셰이더는 S 에 w(θ)(1 − vis) 를 곱해 내산란에 더함(cloudTsun.ts I-4 — §168 역광 어둡게 뒤, 어둡게 안 함).
 *
 * 세 가지 '아치 세기'(G-A 탐침에서 무엇과 견줄지 고를 수 있게 모두 냄 — 결정 D-q2):
 *   raw    = Σ L dΩ                       (위상 없는 띠 하늘빛 — 입체각 점검용)
 *   phase  = Σ_g C_{g,0} = Σ L·p(cos; 1)·dΩ   (자 §1 의 E_arch 정의: ∫_Ω L Φ dω, Φ 정규화 이중 HG, T_arch = 1)
 *   octave = Σ_g Σ_i C_{g,i}             (셰이더 S 의 τ = 0 값 — tsunDebug 5 "E_arch(T = 1)" 가 내는 양)
 *
 * 단위: L 은 호출자가 주는 하늘 복사휘도(셰이더 GetSkyRadiance = 표 값 × SKY_SPECTRAL_RADIANCE_TO_LUMINANCE). 이 파일은 단위를 바꾸지 않음.
 * 정밀도: 셰이더는 float32 이고 GL2 비율을 소수 6 자리 글자로 씀(0.211325 / 0.788675 — 고도 차 ≤ 1.4e−7·dip) → WP7 대조 허용폭은 그만큼 넓게.
 */

export const ARCH_QUAD_MARK = '§179';
/** takram ATMOSPHERE.bottom_radius(km) — dip 과 LUT 가 같은 구를 씀. */
export const ARCH_BOTTOM_RADIUS_KM = 6360;
/** [0, 1] 위 2 점 Gauss–Legendre 절점 — 고도 e_g = −f_g·dip. g = 0 이 위쪽(지평에 가까운) 노드. */
export const ARCH_GL2_FRACTIONS: readonly [number, number] = [(3 - Math.sqrt(3)) / 6, (3 + Math.sqrt(3)) / 6];
/** 방위 노드(줄 방향 기준, °)와 노드 하나가 맡는 방위 폭(°). 셋 × 20° = Ω 의 방위 폭 60°(± 30°). */
export const ARCH_AZ_NODES_DEG: readonly [number, number, number] = [-20, 0, 20];
export const ARCH_AZ_NODE_WIDTH_DEG = 20;
export const ARCH_AZ_HALF_WIDTH_DEG = 30;
/** takram 다중 산란 옥타브 수와 감쇠(a 기여 · b 광학두께 · c 위상 비대칭, 모두 0.5). */
export const ARCH_OCTAVES = 8;
export const ARCH_OCTAVE_ATTENUATION = 0.5;
/** takram 이중 HG(CloudsMaterial 기본 scatterAnisotropy1/2/Mix). */
export const ARCH_PHASE = { g1: 0.7, g2: -0.2, mix: 0.5 } as const;
/** 노드 수 · 고도 무리 수. */
export const ARCH_GROUPS = 2;
export const ARCH_NODE_COUNT = ARCH_GROUPS * ARCH_AZ_NODES_DEG.length;

export type Vec3 = [number, number, number];

export interface ArchNode {
  /** 고도 무리(0 = e₁ = −0.2113·dip, 1 = e₂ = −0.7887·dip) — 아틀라스 τ_own,g·τ_rest,g 채널 쌍. */
  group: 0 | 1;
  /** 방위 노드 번호 0..2(−20 · 0 · +20°). */
  az: 0 | 1 | 2;
  elevationRad: number;
  azimuthRad: number;
  /** 입체각 가중치(sr). */
  dOmega: number;
}

const DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** 표본 높이 h(km, 구 R_b 위)에서 지평 내림(라디안). 셰이더 gArchDip 과 같은 식. */
export const archDipRad = (heightKm: number, bottomRadiusKm = ARCH_BOTTOM_RADIUS_KM): number =>
  Math.acos(clamp(bottomRadiusKm / (bottomRadiusKm + Math.max(0, heightKm)), 0, 1));

/** 띠 [−dip, 0] × 방위 폭의 정확한 입체각 = ∫∫ cos e de dφ = sin(dip)·Δφ(sr). 기본 Δφ = 60°. */
export const archBandSolidAngle = (dipRad: number, azWidthRad = 2 * ARCH_AZ_HALF_WIDTH_DEG * DEG): number => Math.sin(dipRad) * azWidthRad;

/**
 * 노드 6 개. fractions 는 시험용(사전 계산 arch/nodes.json 은 4 자리 0.2113/0.7887 을 씀 — U5b 에서 같은 기하로 견줄 때만 바꿈).
 * 순서: 무리 g 바깥, 방위 안쪽(셰이더 gArchFill 의 이중 고리와 같음).
 */
export function archNodes(dipRad: number, fractions: readonly [number, number] = ARCH_GL2_FRACTIONS): ArchNode[] {
  const dOmega = (Math.sin(dipRad) / 2) * (ARCH_AZ_NODE_WIDTH_DEG * DEG);
  const out: ArchNode[] = [];
  for (let g = 0; g < ARCH_GROUPS; g++) {
    for (let j = 0; j < ARCH_AZ_NODES_DEG.length; j++) {
      out.push({ group: g as 0 | 1, az: j as 0 | 1 | 2, elevationRad: -fractions[g] * dipRad, azimuthRad: ARCH_AZ_NODES_DEG[j] * DEG, dOmega });
    }
  }
  return out;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** 접평면 기저: a = rowAxis 를 up 에 수직으로 투영해 정규화, b = up × a(셰이더 gArchFill 의 b = cross(n, a) 와 같은 손). */
export function archTangentFrame(up: Vec3, rowAxis: Vec3): { up: Vec3; a: Vec3; b: Vec3 } {
  const n = norm(up);
  const k = dot(n, rowAxis);
  const a = norm([rowAxis[0] - n[0] * k, rowAxis[1] - n[1] * k, rowAxis[2] - n[2] * k]);
  return { up: n, a, b: cross(n, a) };
}

/** 노드 방향 ω = cos e (cos φ a + sin φ b) + sin e n. */
export function archNodeDirection(node: Pick<ArchNode, 'elevationRad' | 'azimuthRad'>, up: Vec3, rowAxis: Vec3): Vec3 {
  const { up: n, a, b } = archTangentFrame(up, rowAxis);
  const ce = Math.cos(node.elevationRad), se = Math.sin(node.elevationRad);
  const ca = Math.cos(node.azimuthRad), sa = Math.sin(node.azimuthRad);
  return [ce * (ca * a[0] + sa * b[0]) + se * n[0], ce * (ca * a[1] + sa * b[1]) + se * n[1], ce * (ca * a[2] + sa * b[2]) + se * n[2]];
}

/** 방향 바꾸기(redirect)의 끝 방향 — 고도 −dip/2, 줄 방향(셰이더 gArchDirMid). */
export const archMidDirection = (up: Vec3, rowAxis: Vec3, dipRad: number): Vec3 => archNodeDirection({ elevationRad: -0.5 * dipRad, azimuthRad: 0 }, up, rowAxis);

/** takram henyeyGreenstein(clouds.frag:298) — 분모 pow 를 1e−7 로 바닥. 1/(4π) 포함(∫ dω = 1). */
export const henyeyGreenstein = (g: number, cosTheta: number): number =>
  (1 - g * g) / (4 * Math.PI * Math.max(1e-7, Math.pow(1 + g * g - 2 * g * cosTheta, 1.5)));

/** takram phaseFunction(cosθ, attenuation)(ACCURATE_PHASE_FUNCTION 끔) — 이중 HG, 비대칭에 감쇠를 곱함. */
export const archPhase = (cosTheta: number, attenuation = 1): number =>
  (1 - ARCH_PHASE.mix) * henyeyGreenstein(ARCH_PHASE.g1 * attenuation, cosTheta) + ARCH_PHASE.mix * henyeyGreenstein(ARCH_PHASE.g2 * attenuation, cosTheta);

/** takram approximateMultipleScattering(opticalDepth, cosθ)(clouds.frag:397) — 시험에서 옥타브 캐시 길과 견주는 원식. */
export function takramMultipleScattering(opticalDepth: number, cosTheta: number, octaves = ARCH_OCTAVES): number {
  let a = 1, b = 1, c = 1, s = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * Math.exp(-opticalDepth * b) * archPhase(cosTheta, c);
    a *= ARCH_OCTAVE_ATTENUATION; b *= ARCH_OCTAVE_ATTENUATION; c *= ARCH_OCTAVE_ATTENUATION;
  }
  return s;
}

/**
 * 광선마다 채우는 캐시 C[g·8 + i](RGB) = Σ_방위 aⁱ · p(cos_k; cⁱ) · L_k · dΩ_k.
 * radiance[k] = 노드 k 의 하늘 복사휘도(dΩ 곱하기 전), cosView[k] = ω_k · rayDirection. 노드 순서는 archNodes 와 같아야 함.
 */
export function archOctaveCache(nodes: readonly ArchNode[], radiance: readonly Vec3[], cosView: readonly number[]): Vec3[] {
  if (radiance.length !== nodes.length || cosView.length !== nodes.length) throw new Error('archQuad: radiance/cosView length must equal node count');
  const C: Vec3[] = Array.from({ length: ARCH_GROUPS * ARCH_OCTAVES }, () => [0, 0, 0] as Vec3);
  nodes.forEach((nd, k) => {
    const L = radiance[k];
    let ai = 1;
    for (let i = 0; i < ARCH_OCTAVES; i++) {
      const w = ai * archPhase(cosView[k], ai) * nd.dOmega;
      const c = C[nd.group * ARCH_OCTAVES + i];
      c[0] += w * L[0]; c[1] += w * L[1]; c[2] += w * L[2];
      ai *= ARCH_OCTAVE_ATTENUATION;
    }
  });
  return C;
}

/** 아틀라스가 주는 무리별 τ(자기 레인 D_L 안 · 그 너머). */
export interface ArchTau { tauMid: number; own: readonly [number, number]; rest: readonly [number, number]; noT?: boolean }

/** S = Σ_g [Σ_i C_{g,i} exp(−bⁱ(τ_mid + τ_own,g))] · exp(−τ_rest,g) — 셰이더 I-4 의 합(b = 0.5). noT(H0) 면 τ_rest ≡ 0. */
export function archAttenuatedSum(C: readonly Vec3[], t: ArchTau): Vec3 {
  const s: Vec3 = [0, 0, 0];
  for (let g = 0; g < ARCH_GROUPS; g++) {
    const rest = t.noT ? 0 : t.rest[g];
    let bi = 1;
    for (let i = 0; i < ARCH_OCTAVES; i++) {
      const f = Math.exp(-bi * (t.tauMid + t.own[g]) - rest);
      const c = C[g * ARCH_OCTAVES + i];
      s[0] += c[0] * f; s[1] += c[1] * f; s[2] += c[2] * f;
      bi *= ARCH_OCTAVE_ATTENUATION;
    }
  }
  return s;
}

/** 세 가지 아치 세기(raw · phase · octave) — 위 머리말의 정의. */
export function archContractSums(nodes: readonly ArchNode[], radiance: readonly Vec3[], cosView: readonly number[]): { raw: Vec3; phase: Vec3; octave: Vec3 } {
  const C = archOctaveCache(nodes, radiance, cosView);
  const raw: Vec3 = [0, 0, 0], phase: Vec3 = [0, 0, 0], octave: Vec3 = [0, 0, 0];
  nodes.forEach((nd, k) => { for (let c = 0; c < 3; c++) raw[c] += radiance[k][c] * nd.dOmega; });
  for (let g = 0; g < ARCH_GROUPS; g++) {
    for (let i = 0; i < ARCH_OCTAVES; i++) {
      const v = C[g * ARCH_OCTAVES + i];
      for (let c = 0; c < 3; c++) { octave[c] += v[c]; if (i === 0) phase[c] += v[c]; }
    }
  }
  return { raw, phase, octave };
}
