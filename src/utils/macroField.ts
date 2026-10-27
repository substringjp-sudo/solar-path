/**
 * macroField.ts — 고리 예보(관측점 둘레 90 점, 5~380 km)에서 **연속 운량 격자**(기본 256² × 3 km = 768 km)를 만드는 확률적 스펙트럼
 * 다운스케일러(문서 §156). three.js 없는 순수 함수 — 하네스(tools/genus-ruler/macro)와 앱이 같은 코드를 씁니다.
 *
 * 왜: 예전 거시 상태장(macroWeatherField.ts)은 90 점을 **기울기 두 수**로 줄여 "서쪽이 더 흐리다" 정도만 남겼습니다. 하늘 자리마다
 * 운량이 다른 배치(먼 비구름 띠, 한쪽만 갠 하늘)는 그 두 수로는 나오지 않습니다.
 *
 * 단계(RainFARM·Spectral Fusion·STEPS 를 우리 자료에 맞춘 것):
 *  1. **가변 반경 Barnes 객관분석**(Barnes 1964): 고리 점을 격자로. 가우스 가중 평균이라 0~1 밖으로 안 나가고, 커널 폭을 그 점이 속한 고리의
 *     이웃 간격에 비례시켜 바깥 고리의 동심원 무늬(bullseye)를 막습니다. 두 번 지나(잔차 γ 0.35) 안쪽의 세부를 되살립니다.
 *  2. **분해능 지도** λ_res(x): 그 자리에서 고리가 해상하는 가장 짧은 파장(2 × 이웃 간격). 가운데 10 km, 300 km 밖 250 km.
 *  3. **스펙트럼 기울기 β**: 가운데 192 km 상자(Hanning 창)의 고리 평균 1-D 에너지 스펙트럼 E(k) ∝ k^−β 를 λ 24~96 km 에서 맞추고
 *     0.8~2.0 으로 잠급니다(위성 마스크 사분위 0.86/1.25/1.50 — 문헌 5/3 은 연속 수분량의 값). 사전값과 반씩 섞습니다(자 G10 이 유무를 가립니다).
 *  4. **고주파 합성**: 백색 가우스 잡음의 2-D 계수에 |k|^−(β+1)/2 (1-D 스펙트럼 k^−β 의 2-D 진폭 — 차원 보정 +1) × 종류 필터를 곱하고,
 *     옥타브 띠 6 개로 나눠 **자리마다** λ < λ_res(x) 인 띠만 더합니다(반지름별 차단 파수 = Spectral Fusion). 그 뒤 자리마다 분산 1 로 정규화.
 *  5. **절단 가우스 아나모포시스**: 잠재 Y = μ(x) + Z(x), μ = g⁻¹(C̄(x)) 로 두면 부드러운 경계 c = clamp(½ + Y/w) 의 **기대값이 정확히 C̄** —
 *     예보 30 % 면 화면 평균도 30 %, 0 % 는 깨끗이 0.
 *  6. **시간**(STEPS, Seed 2003): 잡음 계수를 AR(1) 로 — ρ(k) = exp(−Δt/τ(k)), τ(k) ∝ k^−2/3(콜모고로프 회전 시간, 10 km 에 20 분).
 *     큰 규모는 거의 그대로, 6 km 세포는 15 분이면 딴 모양. 이류(바람)는 셰이더가 uv 를 밀어서 합니다(층마다 바람이 다름).
 *
 * 평균 보존의 뜻: 기대값(5)은 자리마다 맞지만 한 실현의 작은 창 평균은 잡음만큼 흔들립니다. 표본이 대표하는 넓이(이웃 간격 ≈ λ_res/2)로
 * 평균하면 표본 값으로 돌아옵니다 — 그 안쪽 규모는 예보가 모르는 것이라 잡음이 채웁니다. 7 km 창으로 표본마다 못 박는 조건화는
 * 넓은 커널로는 수렴하지 않고(전체 평균이 밀림) 좁은 커널로는 표본 자리마다 점 무늬를 남겨 넣지 않았습니다(단위 테스트로 확인).
 */
import { fft2 } from '../components/VolumetricProbe/cloudFlow';

export interface MacroSample {
  /** 관측점 기준 동(+)·북(+) km */
  xKm: number; yKm: number;
  /** 운량 0~1 */
  cover: number;
}
export interface MacroGenusFilter {
  /** 고리 필터 파장(km) — 고적운 세포·구름열 간격. 없으면 필터 없음. */
  ringLambdaKm?: number;
  /** 고리 필터 세기(0 = 없음, 1 = 진폭 2 배) */
  ringGain?: number;
  /** 방향성(0~1): 전단 방향에 수직인 마루(구름열)를 세웁니다. */
  anisoGain?: number;
  /** 전단 방향(동=0°, 북=90°, 수학 각) */
  anisoDirDeg?: number;
}
export interface MacroFieldOptions {
  /** 격자 변(2 의 거듭제곱) */
  n?: number;
  /** 칸 크기 km */
  cellKm?: number;
  seed?: number;
  /** 스펙트럼 기울기 사전값(종류별). 맞춤값과 반씩 섞음. */
  betaPrior?: number;
  /** 맞춤값을 쓰지 않고 사전값만(자 M1b 비교용) */
  betaFromPriorOnly?: boolean;
  /** 부드러운 경계 폭(잠재 σ 단위). 클수록 반투명 가장자리가 넓음. */
  edgeWidth?: number;
  filter?: MacroGenusFilter;
  /** 2차 Barnes 잔차 가중 */
  barnesGamma?: number;
  /** Barnes 커널 폭 σ_i = max(sigmaMinKm, sigmaFactor × 이웃 간격) */
  sigmaMinKm?: number;
  sigmaFactor?: number;
  /** 띠 넣기 경사: 띠 중심 파장이 λ_res 보다 짧을 때 (λ_res − λ_c)/(fusionRamp·λ_c) 로 0→1 */
  fusionRamp?: number;
  /** false 면 잡음 없이 Barnes 장을 그대로 운량으로(RULER-macro 후보 B). 기본 true(V). */
  noise?: boolean;
}
export interface MacroState {
  n: number; cellKm: number; beta: number;
  /** 백색 잡음 계수(복소, 행우선 n²) — AR(1) 가 돌립니다. 진폭 필터는 매번 다시 곱합니다. */
  re: Float64Array; im: Float64Array;
  /** 결정론적 난수 상태 */
  rng: number;
  /** 흐른 시간(초) — 보고용 */
  tSec: number;
}
export interface MacroField {
  n: number; cellKm: number;
  /** 운량 0~1, 행 0 = 남쪽(y 작음)… **행 = 북쪽으로 증가**, 열 = 동쪽으로 증가. 관측점은 (n/2, n/2). */
  cover: Float32Array;
  /** Barnes 저주파 장(아나모포시스 전) */
  base: Float32Array;
  /** 분해능 지도 λ_res(km) */
  lambdaRes: Float32Array;
  beta: number;
  betaFit: number | null;
  state: MacroState;
  ms: { barnes: number; synth: number; total: number };
}

/**
 * β 사전값·잠금 범위는 **위성 참값**(tools/genus-ruler/macro/sat-quartiles.json, MODIS 진색 3 km 구름 마스크 121 장면, λ 24~96 km)의
 * 사분위 0.86 / 1.25 / 1.50 에서: 문헌의 5/3 은 수분량(연속 장)의 값이고, 0/1 **운량 마스크**는 그보다 완만합니다. 잠금 [0.8, 2.0].
 */
/** σ_min 6 km·0.6 배: dev 24 장면에서 4 km·0.45 배는 5·10 km 고리의 표본마다 점 무늬(bullseye)를 남겼고 corr50 0.774 → 0.785(RULER-macro §7). */
export const MACRO_DEFAULTS = { n: 256, cellKm: 3, seed: 7, betaPrior: 1.25, edgeWidth: 1.0, barnesGamma: 0.35, sigmaMinKm: 6, sigmaFactor: 0.6, fusionRamp: 0.5 };
export const BETA_MIN = 0.8, BETA_MAX = 2.0;
/** 콜모고로프 수명: τ(λ) = TAU_REF_MIN · (λ / LAMBDA_REF_KM)^(2/3) */
export const TAU_REF_MIN = 30, LAMBDA_REF_KM = 10;

/** 옥타브 띠(파장 km, 하한 포함~상한 제외). 6 km 는 3 km 칸의 나이퀴스트. */
const BANDS_KM: Array<[number, number]> = [[6, 12], [12, 24], [24, 48], [48, 96], [96, 192], [192, 1e9]];

// ───────── 난수(결정론) ─────────
function mulberry32(s: number): () => number {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────── 1. 가변 반경 Barnes ─────────
/**
 * 표본마다 커널 폭: 같은 반지름 고리의 이웃 간격 s_i(방위 간격과 반지름 간격 중 큰 것)의 0.45 배, 최소 4 km.
 * 반지름 간격은 이웃 고리까지의 거리 절반(그 사이가 비어 있으므로).
 */
export function sampleSpacingKm(samples: MacroSample[]): Float64Array {
  const r = samples.map(s => Math.hypot(s.xKm, s.yKm));
  // 고리 묶기(반지름 1 km 눈금)
  const rings = new Map<number, number[]>();
  r.forEach((ri, i) => { const key = Math.round(ri); if (!rings.has(key)) rings.set(key, []); rings.get(key)!.push(i); });
  const radii = [...rings.keys()].sort((a, b) => a - b);
  const out = new Float64Array(samples.length);
  radii.forEach((rk, j) => {
    const idx = rings.get(rk)!;
    const az = rk > 0.5 ? (2 * Math.PI * rk) / idx.length : 0;
    const prev = j > 0 ? radii[j - 1] : 0, next = j < radii.length - 1 ? radii[j + 1] : rk + (rk - prev);
    const rad = Math.max(rk - prev, next - rk) * 0.5;
    const s = Math.max(az, rad, 2.5);
    for (const i of idx) out[i] = s;
  });
  return out;
}

function barnesPass(samples: MacroSample[], values: Float64Array, sigma: Float64Array, n: number, cellKm: number, out: Float32Array, wsum: Float32Array): void {
  out.fill(0); wsum.fill(0);
  const half = (n * cellKm) / 2;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], sg = sigma[i], v = values[i];
    const reach = 3 * sg;
    const x0 = Math.max(0, Math.floor((s.xKm - reach + half) / cellKm)), x1 = Math.min(n - 1, Math.ceil((s.xKm + reach + half) / cellKm));
    const y0 = Math.max(0, Math.floor((s.yKm - reach + half) / cellKm)), y1 = Math.min(n - 1, Math.ceil((s.yKm + reach + half) / cellKm));
    const inv = -0.5 / (sg * sg);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5) * cellKm - half - s.yKm;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5) * cellKm - half - s.xKm;
        const w = Math.exp((dx * dx + dy * dy) * inv);
        const k = y * n + x;
        out[k] += w * v; wsum[k] += w;
      }
    }
  }
}

/** 격자 (x, y) 칸에서 표본 값을 읽음(1차 결과를 표본 자리에서 되읽어 잔차를 냄) */
function sampleGrid(F: Float32Array, n: number, cellKm: number, xKm: number, yKm: number): number {
  const half = (n * cellKm) / 2;
  const fx = Math.min(n - 1, Math.max(0, (xKm + half) / cellKm - 0.5)), fy = Math.min(n - 1, Math.max(0, (yKm + half) / cellKm - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = F[y0 * n + x0], b = F[y0 * n + x1], c = F[y1 * n + x0], d = F[y1 * n + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * 두 번 지나는 가변 반경 Barnes. 2차는 1차 잔차를 γ 배 좁은 커널로 더합니다(Barnes 1973). 결과는 [0, 1].
 * 표본이 미치지 않는 칸(가중합 0)은 가장 가까운 표본 값 대신 전체 가중 평균으로 채웁니다.
 */
export function barnesGrid(samples: MacroSample[], n: number, cellKm: number, gamma = MACRO_DEFAULTS.barnesGamma, sigmaMinKm = MACRO_DEFAULTS.sigmaMinKm, sigmaFactor = MACRO_DEFAULTS.sigmaFactor): { grid: Float32Array; lambdaRes: Float32Array; sigma: Float64Array } {
  const spacing = sampleSpacingKm(samples);
  const sigma = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) sigma[i] = Math.max(sigmaMinKm, sigmaFactor * spacing[i]);
  const vals = new Float64Array(samples.length);
  let mean = 0;
  for (let i = 0; i < samples.length; i++) { vals[i] = Math.min(1, Math.max(0, samples[i].cover)); mean += vals[i]; }
  mean /= Math.max(1, samples.length);
  const grid = new Float32Array(n * n), wsum = new Float32Array(n * n);
  barnesPass(samples, vals, sigma, n, cellKm, grid, wsum);
  for (let k = 0; k < n * n; k++) grid[k] = wsum[k] > 1e-6 ? grid[k] / wsum[k] : mean;
  if (gamma > 0) {
    const resid = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i++) resid[i] = vals[i] - sampleGrid(grid, n, cellKm, samples[i].xKm, samples[i].yKm);
    const sig2 = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i++) sig2[i] = Math.max(3, sigma[i] * Math.sqrt(gamma));
    const g2 = new Float32Array(n * n), w2 = new Float32Array(n * n);
    barnesPass(samples, resid, sig2, n, cellKm, g2, w2);
    for (let k = 0; k < n * n; k++) if (w2[k] > 1e-6) grid[k] = Math.min(1, Math.max(0, grid[k] + g2[k] / w2[k]));
  }
  // 분해능 지도: 가장 가까운 표본의 이웃 간격 × 2
  const lambdaRes = new Float32Array(n * n);
  const half = (n * cellKm) / 2;
  for (let y = 0; y < n; y++) {
    const py = (y + 0.5) * cellKm - half;
    for (let x = 0; x < n; x++) {
      const px = (x + 0.5) * cellKm - half;
      let best = Infinity, bs = 10;
      for (let i = 0; i < samples.length; i++) {
        const d2 = (samples[i].xKm - px) ** 2 + (samples[i].yKm - py) ** 2;
        if (d2 < best) { best = d2; bs = spacing[i]; }
      }
      lambdaRes[y * n + x] = 2 * bs;
    }
  }
  return { grid, lambdaRes, sigma };
}

// ───────── 3. 스펙트럼 기울기 ─────────
/**
 * 가운데 m×m 칸(Hanning 창)의 고리 평균 1-D 에너지 스펙트럼 E(k) = Σ_ring |F|² · k 를 λ ∈ [lamLo, lamHi] km 에서 log-log 직선 맞춤.
 * 분산이 거의 없으면(맑음·온통 흐림) null.
 */
export function fitBeta(F: Float32Array, n: number, cellKm: number, m = 64, lamLo = 24, lamHi = 96): number | null {
  const off = (n - m) >> 1;
  const re = new Float64Array(m * m), im = new Float64Array(m * m);
  let mean = 0;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) mean += F[(y + off) * n + x + off];
  mean /= m * m;
  let varSum = 0;
  for (let y = 0; y < m; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / m);
    for (let x = 0; x < m; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / m);
      const v = (F[(y + off) * n + x + off] - mean) * wx * wy;
      re[y * m + x] = v; varSum += v * v;
    }
  }
  if (varSum / (m * m) < 1e-5) return null;
  fft2(re, im, m, false);
  const L = m * cellKm;
  const nb = m >> 1;
  const pow = new Float64Array(nb), cnt = new Int32Array(nb);
  for (let y = 0; y < m; y++) {
    const ky = y < m / 2 ? y : y - m;
    for (let x = 0; x < m; x++) {
      const kx = x < m / 2 ? x : x - m;
      const kr = Math.sqrt(kx * kx + ky * ky);
      const b = Math.round(kr);
      if (b < 1 || b >= nb) continue;
      const p = re[y * m + x] ** 2 + im[y * m + x] ** 2;
      pow[b] += p; cnt[b]++;
    }
  }
  const xs: number[] = [], ys: number[] = [];
  for (let b = 1; b < nb; b++) {
    if (cnt[b] === 0) continue;
    const lam = L / b;
    if (lam < lamLo || lam > lamHi) continue;
    // E(k) ∝ 고리 합(= 평균 × 고리 둘레 ∝ k) → 1-D 스펙트럼
    xs.push(Math.log(b / L)); ys.push(Math.log(pow[b] + 1e-30));
  }
  if (xs.length < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const N = xs.length, den = N * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return null;
  const slope = (N * sxy - sx * sy) / den;
  return -slope;
}

// ───────── 5. 아나모포시스 ─────────
/** c = clamp(½ + Y/w, 0, 1) 의 기대값 g(μ), Y = μ + Z, Z ~ N(0,1). 수치 적분. */
function expectedSoftCover(mu: number, w: number): number {
  let s = 0, ws = 0;
  for (let i = -40; i <= 40; i++) {
    const z = i * 0.1, p = Math.exp(-0.5 * z * z);
    s += p * Math.min(1, Math.max(0, 0.5 + (mu + z) / w)); ws += p;
  }
  return s / ws;
}
const MU_LUT_N = 513;
const muLutCache = new Map<number, Float64Array>();
/** g⁻¹: 목표 평균 C̄ → μ (이분법, 512 칸 표) */
function muForCover(w: number): Float64Array {
  let lut = muLutCache.get(w);
  if (lut) return lut;
  lut = new Float64Array(MU_LUT_N);
  for (let i = 0; i < MU_LUT_N; i++) {
    const c = i / (MU_LUT_N - 1);
    if (c <= 0) { lut[i] = -6; continue; }
    if (c >= 1) { lut[i] = 6; continue; }
    let lo = -6, hi = 6;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (expectedSoftCover(mid, w) < c) lo = mid; else hi = mid; }
    lut[i] = (lo + hi) / 2;
  }
  muLutCache.set(w, lut);
  return lut;
}

// ───────── 4·6. 잡음 계수와 AR(1) ─────────
function newState(n: number, cellKm: number, seed: number, beta: number): MacroState {
  const rnd = mulberry32(seed);
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  // 실수 백색 잡음을 FFT → 에르미트 대칭 계수(역변환이 실수)
  for (let i = 0; i < n * n; i += 2) {
    const u1 = Math.max(1e-12, rnd()), u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    re[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n * n) re[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  fft2(re, im, n, false);
  return { n, cellKm, beta, re, im, rng: Math.floor(rnd() * 2 ** 31), tSec: 0 };
}

/**
 * AR(1) 한 걸음(STEPS): F(k) ← ρ(k) F(k) + √(1−ρ²) η(k), ρ = exp(−Δt/τ(k)), τ = TAU_REF·(λ/λ_ref)^(2/3).
 * 새 잡음 η 도 에르미트 대칭(실수 백색 잡음의 FFT)이라 역변환이 실수로 남습니다. k = 0 은 건드리지 않음(평균은 μ 가 정함).
 */
export function stepMacroState(st: MacroState, dtSec: number): void {
  if (!(dtSec > 0)) return;
  const n = st.n;
  const rnd = mulberry32(st.rng);
  const er = new Float64Array(n * n), ei = new Float64Array(n * n);
  for (let i = 0; i < n * n; i += 2) {
    const u1 = Math.max(1e-12, rnd()), u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    er[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n * n) er[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  fft2(er, ei, n, false);
  const L = n * st.cellKm, dtMin = dtSec / 60;
  for (let y = 0; y < n; y++) {
    const ky = y < n / 2 ? y : y - n;
    for (let x = 0; x < n; x++) {
      const kx = x < n / 2 ? x : x - n;
      const kr = Math.sqrt(kx * kx + ky * ky);
      if (kr < 0.5) continue;
      const lam = L / kr;
      const tau = TAU_REF_MIN * Math.pow(lam / LAMBDA_REF_KM, 2 / 3);
      const rho = Math.exp(-dtMin / tau), q = Math.sqrt(Math.max(0, 1 - rho * rho));
      const i = y * n + x;
      st.re[i] = rho * st.re[i] + q * er[i];
      st.im[i] = rho * st.im[i] + q * ei[i];
    }
  }
  st.rng = Math.floor(rnd() * 2 ** 31);
  st.tSec += dtSec;
}

/** 종류 필터 H(k, θ) ≥ 0 */
function genusFilter(f: MacroGenusFilter | undefined, kCyclesPerKm: number, theta: number): number {
  if (!f || !(f.ringGain || f.anisoGain)) return 1;
  let h = 1;
  if (f.ringLambdaKm && f.ringGain) {
    const k0 = 1 / f.ringLambdaKm, sk = 0.25 * k0;
    h += f.ringGain * Math.exp(-0.5 * ((kCyclesPerKm - k0) / sk) ** 2);
  }
  if (f.anisoGain) {
    const th = ((f.anisoDirDeg ?? 0) * Math.PI) / 180;
    // 마루가 전단에 수직 → 파수 벡터가 전단 방향 → cos²(θ − θ_s)
    const c = Math.cos(theta - th);
    h *= 1 - f.anisoGain + f.anisoGain * 2 * c * c;
  }
  return h;
}

/**
 * 잡음 계수에 진폭 필터를 곱해 띠별 공간 장 Z_j 를 만들고, 자리마다 λ_res 보다 짧은 띠만 더한 뒤 분산 1 로 정규화.
 * 반환 Z(n²), 단위 분산(국소 가중 기준).
 */
function synthesizeLatent(st: MacroState, lambdaRes: Float32Array, filter: MacroGenusFilter | undefined, out: Float32Array, ramp = MACRO_DEFAULTS.fusionRamp): void {
  const n = st.n, L = n * st.cellKm, expo = -(st.beta + 1) / 2;
  const bands = BANDS_KM.length;
  const bandField = new Float32Array(n * n * bands);
  const bandVar = new Float64Array(bands);
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let b = 0; b < bands; b++) {
    const [lo, hi] = BANDS_KM[b];
    re.fill(0); im.fill(0);
    for (let y = 0; y < n; y++) {
      const ky = y < n / 2 ? y : y - n;
      for (let x = 0; x < n; x++) {
        const kx = x < n / 2 ? x : x - n;
        const kr = Math.sqrt(kx * kx + ky * ky);
        if (kr < 0.5) continue;
        const lam = L / kr;
        if (lam < lo || lam >= hi) continue;
        const k = kr / L;
        const amp = Math.pow(k, expo) * genusFilter(filter, k, Math.atan2(ky, kx));
        const i = y * n + x;
        re[i] = st.re[i] * amp; im[i] = st.im[i] * amp;
      }
    }
    fft2(re, im, n, true);
    let v = 0;
    for (let i = 0; i < n * n; i++) { const z = re[i]; bandField[b * n * n + i] = z; v += z * z; }
    bandVar[b] = v / (n * n);
  }
  const centers = BANDS_KM.map(([lo, hi]) => (hi > 1e8 ? lo * 1.5 : Math.sqrt(lo * hi)));
  for (let i = 0; i < n * n; i++) {
    const lr = lambdaRes[i];
    let z = 0, v = 0;
    for (let b = 0; b < bands; b++) {
      // 띠 중심 파장이 분해능보다 짧으면 넣음(경계 반 옥타브 완만)
      const w = Math.min(1, Math.max(0, (lr - centers[b]) / (ramp * centers[b])));
      if (w <= 0) continue;
      z += w * bandField[b * n * n + i]; v += w * w * bandVar[b];
    }
    out[i] = v > 1e-12 ? z / Math.sqrt(v) : 0;
  }
}

/**
 * 고리 표본 → 연속 운량 격자. `state` 를 주면(이전 호출의 것) 잡음을 이어 씁니다 — 시간 걸음은 `stepMacroState` 로 미리 돌리세요.
 */
export function buildMacroField(samples: MacroSample[], opts: MacroFieldOptions = {}, state?: MacroState | null): MacroField {
  const t0 = Date.now();
  const n = opts.n ?? MACRO_DEFAULTS.n, cellKm = opts.cellKm ?? MACRO_DEFAULTS.cellKm;
  const w = opts.edgeWidth ?? MACRO_DEFAULTS.edgeWidth;
  const { grid: base, lambdaRes } = barnesGrid(samples, n, cellKm, opts.barnesGamma ?? MACRO_DEFAULTS.barnesGamma, opts.sigmaMinKm, opts.sigmaFactor);
  const t1 = Date.now();
  const prior = opts.betaPrior ?? MACRO_DEFAULTS.betaPrior;
  const fit = opts.betaFromPriorOnly ? null : fitBeta(base, n, cellKm);
  const beta = Math.min(BETA_MAX, Math.max(BETA_MIN, fit == null ? prior : 0.5 * fit + 0.5 * prior));
  let st = state && state.n === n && state.cellKm === cellKm ? state : null;
  if (!st) st = newState(n, cellKm, opts.seed ?? MACRO_DEFAULTS.seed, beta);
  st.beta = beta;
  const Z = new Float32Array(n * n);
  synthesizeLatent(st, lambdaRes, opts.filter, Z, opts.fusionRamp);
  const lut = muForCover(w);
  const muOf = (c: number) => {
    const fi = Math.min(1, Math.max(0, c)) * (MU_LUT_N - 1), i0 = Math.min(MU_LUT_N - 2, Math.floor(fi)), t = fi - i0;
    return lut[i0] + (lut[i0 + 1] - lut[i0]) * t;
  };
  const cover = new Float32Array(n * n);
  if (opts.noise === false) cover.set(base);
  else for (let i = 0; i < n * n; i++) {
    const c = base[i];
    cover[i] = c <= 0.002 ? 0 : c >= 0.998 ? 1 : Math.min(1, Math.max(0, 0.5 + (muOf(c) + Z[i]) / w));
  }
  const t2 = Date.now();
  return { n, cellKm, cover, base, lambdaRes, beta, betaFit: fit, state: st, ms: { barnes: t1 - t0, synth: t2 - t1, total: t2 - t0 } };
}

/**
 * 고리 이음매 복사본을 걸러냅니다. `fetchDayWeatherRing` 은 방위 180° 점마다 −180° 복사본을 하나 더 돌려줍니다
 * (`WeatherFan` 이 감김에 필요). 보간·간격 계산에는 같은 자리가 두 번 들어가 남쪽 표본이 두 배로 세어지고
 * `sampleSpacingKm` 의 방위 간격(2πr/개수)이 줄어듭니다(12 방위 고리 7.7 %, 5 km 6 방위 고리 14 %, §166). 커널 σ = max(6 km, 0.6·간격)
 * 이라 30 km 이상 고리의 Barnes 커널이 그만큼 좁아지고, 5·10 km 고리는 6 km 하한에 걸려 그대로입니다.
 * 같은 거리에서 180° 점이 있을 때만 −180° 점을 뺍니다. 없으면(복사본이 아니라 유일한 점) 둡니다.
 */
export function dropSeamCopies<T extends { distance?: number; azimuthOffset?: number }>(points: T[]): T[] {
  const has180 = new Set<number>();
  for (const p of points) if (p.azimuthOffset === 180) has180.add(Math.round((p.distance ?? 0) * 1000));
  return points.filter(p => !(p.azimuthOffset === -180 && has180.has(Math.round((p.distance ?? 0) * 1000))));
}

/** 고리 자료(거리 km, 방위 북 0° 시계방향, 운량 %) → 표본 */
export function samplesFromRing(points: Array<{ distance: number; azimuthOffset: number; cover: number }>): MacroSample[] {
  return points.map(p => {
    const a = (p.azimuthOffset * Math.PI) / 180;
    return { xKm: p.distance * Math.sin(a), yKm: p.distance * Math.cos(a), cover: Math.min(1, Math.max(0, p.cover / 100)) };
  });
}
