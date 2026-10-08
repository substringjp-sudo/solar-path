/**
 * cloudFlow.ts — 가벼운 대기 흐름 구름 모형의 **수학부**(문서 §130, 2026-10-07). three.js 를 쓰지 않습니다.
 *
 * 날씨 타일의 원시장 f 를 "정적 원시 도형의 합집합"이 아니라 **하나의 2-D 순압 와도 흐름이 변형시킨 속별 템플릿 +
 * 대규모 수분장 + 전단파** 로 만듭니다. 사용자가 기억하던 "기압 변화를 삼각함수로 합성한 흐름"을 유선함수 ψ₀ 로
 * 명시하고 오일러 방정식(Dζ/Dt = 0)으로 한 번 더 굴린 것입니다. 모든 층이 한 라벨맵 D 를 공유하므로 sc·ac 가
 * 같은 골에 정렬되고, 셀이 수렴선에서 압축·병합되고 발산에서 늘어납니다(설계 flow-design §2).
 *
 * 평문 수식(타일 좌표 x ∈ [0,1)², L = 타일 한 변 m, N = 동역학 격자):
 *   (1) ψ₀(x) = Σ_{1≤|k|≤kmax} a_k cos(2π k·x + φ_k),  a_k = |k|^(−specPow)·g_k / (1 + aniso·(k̂·ŵ)²),  g_k~N(0,1), φ_k~U(0,2π)
 *       — ŵ 는 층 바람(+rollDeg 회전) 단위벡터. 진폭은 rms|u| = vrms 가 되도록 사후 정규화.
 *   (2) ζ₀ = ∇²ψ₀ = −Σ (2π|k|/L)² a_k cos(·)   (스펙트럼, 정확)
 *   (3) Dζ/Dt = 0  (2-D 오일러, β·f 없음 — 24 km 에서 Rossby 수 ≈ 0.8 이라 QG 는 과잉)
 *   (4) 라벨맵: DX/Dt = 0, X(x,0) = x, D = x − X.
 *       D(x, t+dt) = dt·u_m + D(x_d, t),  x_d = x − dt·u_m,  u_m = u(x − ½dt·u(x))  (중점 역궤적, 쌍선형 주기 보간)
 *   (5) ζ(x,t) = ζ₀(X(x,t)),  ∇²ψ = ζ 를 FFT 로(ψ_k = −ζ_k/(2π|k|/L)², 평균 0), u = −∂ψ/∂y, v = ∂ψ/∂x (중앙차분),
 *       psiEvery 걸음마다 갱신(반라그랑주라 CFL > 1 에서도 안정)
 *   (6) 수분 q₀: |q̂₀| ∝ |k|^(−qPow), |k| ≤ kq, ζ̂₀ 와 상관 qCorr(저기압 = 습함). 전단파 W = cos(2π k_w·X + φ_w),
 *       k_w = 전단 방향의 정수 파수(|k_w| ≈ L/λ_w), 진폭 wW·clamp((|S| − S0)/S1, 0, 1), S = m/s per km
 *   (7) 합성(기존 파이프라인에 넘기는 유일한 값):
 *       f(x) = wQ·q₀(X) + wZ·ζ̂₀(X) + wT·T(x − lag·D(x)) + wW·cos(2π k_w·X + φ_w),  X = x − D(x) mod 1
 *   (8) 커버 문턱은 기존 그대로: th = quantile(f, 1 − cover), top = quantile(f, topQuantile) → area(d>0) = cover 정확.
 *
 * 규칙: 모든 산술은 typed array 고정 순서(동기/비동기 바이트 동일, §127), Date.now() 없음(시간은 호출자가 잼),
 * 정수 파수 모드 + 주기 보간뿐이라 f 는 **정확히** 주기적(§2.7). 셰이더 패치는 이 파일의 다른 부분(WP3)에 둡니다.
 * 시제품: scratchpad/flowB/flowcore.js(승자 B 핵)를 그대로 옮겼습니다.
 */
import type { GenusKey } from './cloudGenus';

const TWO_PI = 2 * Math.PI;

// ───── 매개변수 형 ─────

/** 장면당 하나인 흐름 핵의 매개변수(설계 §6.1). VolumetricOptions 의 flowN/Steps/Hours/Vrms/PsiEvery 가 여기로 옵니다. */
export interface FlowSceneParams {
  /** flowSeed — 앱은 flowSeedOf(lat, lon, date), 하네스는 7 */
  seed: number;
  /** 동역학 격자 한 변(64: dx 375 m) */
  n: 64 | 128;
  /** 반라그랑주 걸음 수 */
  steps: number;
  /** 의사시간(h). 0.5 h 에서 최대 변위 7–9 km; > 0.7 은 대리석 무늬 */
  hours: number;
  /** rms 풍속(m/s) = 1 + 0.08·|U| (1–3) */
  vrms: number;
  /** |ψ̂| ∝ |k|^−specPow */
  specPow: number;
  /** ψ₀ 최대 파수(8 → 최소 에디 3 km) */
  kmax: number;
  /** Poisson 갱신 간격(걸음) */
  psiEvery: number;
  /** 층 바람이 부는 방향(기상 방위, 0 = 북 = +v, 90 = 동 = +u) — 비등방 축 */
  windDeg: number;
  /** 스펙트럼 비등방 = anisoFloor_g + clamp((|U| − 6 m/s)/6, 0, 3) */
  aniso: number;
  /** 비등방 축 회전: 0 = 바람 따라 긴 구조(street), 90 = 횡파(undulatus) */
  rollDeg: number;
  /** 수분 GRF |q̂| ∝ |k|^−qPow, |k| ≤ kq, ζ̂₀ 와 상관 qCorr */
  qPow: number;
  kq: number;
  qCorr: number;
  /**
   * §131 수분장 모드: 0 = 1회차(동역학 격자 n² 가우스, |q̂| ∝ |k|^−qPow, |k| ≤ kq), 1 = 가우스 분수 적분(qN², |q̂| ∝ |k|^−(1+qH)),
   * 2 = 로그정규 곱셈 캐스케이드 ε 에 분수 적분(qN², F⁻¹[|k|^−qH·F(ε^qA)]). 없으면 0.
   */
  qMode?: 0 | 1 | 2;
  /** 모드 1·2 의 q₀ 격자(128: 188 m). 모드 0 은 n. */
  qN?: 64 | 128;
  /** 분수 적분 지수 H(윤곽 D ≈ (3 − H)/2) */
  qH?: number;
  /** 캐스케이드 간헐성 C1(옥타브마다 ln ε 분산 2 ln2·C1) */
  qC1?: number;
  /** 분수 적분에 넣는 ε 의 지수 a(ln ε 에 걸면 가우스로 무너짐 — 조사서 A6) */
  qA?: number;
  /** 로그 장에 더하는 ζ̂₀ 가중(저기압 = 습함) */
  qLog?: number;
  /** §131 변형 게이트: > 0 이면 J = I − ∇D 의 특이값비 90 분위가 이 값에 닿을 때 적분을 멈춤(의사시간 [hoursMin, hoursMax]) */
  s90?: number;
  hoursMin?: number;
  hoursMax?: number;
}

/** 흐름 핵 결과 — 모든 층이 공유. 배열은 n² (행 j = 북쪽 v, 열 i = 동쪽 u, 셀 중심 (i+0.5)/n). */
export interface FlowCore {
  n: number;
  /** 변위 D = x − X (타일 단위) */
  dx: Float32Array;
  dy: Float32Array;
  /** ζ̂₀ — 평균 0·분산 1 로 표준화한 초기 소용돌이도 */
  z0n: Float32Array;
  /** 대규모 수분(평균 0·분산 1) — qn² 격자(모드 0 은 n) */
  q0: Float32Array;
  /** q0 격자 한 변 */
  qn: number;
  /** 끝난 라벨맵의 왜곡 J = I − ∇D 특이값비 90 분위(진단·게이트) */
  s90: number;
  /** 실제로 적분한 의사시간(h) — 변형 게이트가 켜지면 장면마다 다름 */
  hoursUsed: number;
  /** 적분 중 쓰인 속도장들의 최대 |u| (m/s) — 변위 상한 steps·umax·dt 가 정확히 성립 */
  umax: number;
  /** umax·dt/dx */
  cfl: number;
  /** 호출자가 잰 시간(ms) — 핵은 Date.now() 를 쓰지 않습니다 */
  ms?: number;
}

/** 층별 합성 가중(식 7) */
export interface FlowLayerWeights {
  wQ: number;
  wZ: number;
  wT: number;
  /** 템플릿을 변위의 몇 배로 이류할지(< 1 = 셀 재생: 셀 나이 / 에디 회전 시간) */
  lag: number;
  /** 전단파 진폭(발단 적용 후) */
  wW: number;
  /** 전단파 정수 파수(타일당 주기 수) */
  waveK: [number, number];
  wavePhase: number;
}

/**
 * 층 opts 로 들어오는 흐름 손잡이(전부 숫자 → JSON 캐시 키 자동 포함). GENUS_FLOW 의 속별 기본값 위에 덮어씁니다.
 * 셰이더 쪽 값(flowMode/flowTop/densPow/flowDensityScale/flowEdge/flowErode/flowTilt/flowShapeAmount…)도 여기 두어
 * weatherPlan 이 `{...GENUS_FLOW[g], ...L.opts, flow: 1}` 한 번으로 병합하게 합니다(설계 §2.9).
 */
export interface FlowLayerParams {
  /** 1 = 이 층은 흐름 경로, 0 = 기존 경로(cbanvil) */
  flow?: number;
  flowQ?: number;
  flowZ?: number;
  flowT?: number;
  flowLag?: number;
  /** 전단파 최대 진폭·파장(km) */
  flowWave?: number;
  flowWaveKm?: number;
  /** 템플릿 격자(256; ac 512) */
  flowTemplateRes?: number;
  /** 셰이더 단면: 0 돔·1 렌즈·2 LWP 돔(√d) */
  flowMode?: number;
  flowTop?: number;
  /** 밀도 ∝ d^densPow */
  densPow?: number;
  flowDensityScale?: number;
  flowEdge?: number;
  flowErode?: number;
  flowTilt?: number;
  /** sc 시트 바닥(Voronoi 틈 가중 gap_eff = sheet + (1 − sheet)·gap) */
  sheet?: number;
  /** 층 바람(km/h, 동·북 성분, 부는 방향) */
  windU?: number;
  windV?: number;
  /** 위층 바람 − 이 층 바람(km/h) — 고도 차는 flowLayerWeightsOf 가 나눕니다 */
  shearU?: number;
  shearV?: number;
  flowSeed?: number;
  /** 비등방 바닥값 */
  flowAniso?: number;
  rollDeg?: number;
  flowShapeAmount?: number;
  flowShapeDetailAmount?: number;
  topQuantile?: number;
  /** d = 구름 화소 순위^flowDPow (rankNormalize). 기본 FLOW_D_POW. */
  flowDPow?: number;
}

/**
 * d = 순위^FLOW_D_POW 의 지수. 렌더 전 타일 자(RULER-flow T3·T4, 4 씨앗)에서 1.5/1.75/2.0/2.5 를 재어 T3(엔트로피 ≥ 2.8, d<0.2 비율 0.25~0.5)와
 * T4(가장자리 상승길이 ≥ 1.5 × 층 두께: sc ≥ 0.9 km)를 모두 넘는 가장 작은 값 — 1.5·1.75 는 sc 상승길이 0.64~0.87 km 로 모자랐고 2.5 는 d<0.2 가 52 %.
 */
export const FLOW_D_POW = 2.0;

/** 전단파 발단(식 6): A_w = wW·clamp((|S| − S0)/S1, 0, 1), S 단위 m/s per km (Richardson 식 발단) */
export const FLOW_WAVE_S0 = 2;
export const FLOW_WAVE_S1 = 4;

/** 설계 §6.1 기본값. windDeg/aniso/rollDeg 는 WP2 가 주도 층(가장 넓은 층) 바람으로 덮어씁니다. */
export const FLOW_DEFAULTS: FlowSceneParams = {
  seed: 7, n: 64, steps: 20, hours: 0.5, vrms: 2, specPow: 2.5, kmax: 8, psiEvery: 2,
  windDeg: 260, aniso: 1.0, rollDeg: 0, qPow: 2.0, kq: 12, qCorr: 0.5,
  qMode: 0, qH: 0.5, qC1: 0.1, qA: 0.6, qLog: 0.5, s90: 0, hoursMin: 0.25, hoursMax: 1.2,
};

/**
 * 속별 흐름 가중·덮어쓰기(설계 §2.9·§6.2). GENUS 표는 편집하지 않고 `opt.flow` 일 때만 opts 에 병합됩니다.
 * cu/cg/cb 의 "hours 0.3" 은 공유 핵(0.5 h)에서 lag 0.6 으로 실현(0.6 × 0.5 h). densityScale 이 "불변"인 속은
 * flowDensityScale 을 두지 않아 genusLayerShape 가 GENUS.densityScale 로 내려갑니다(cu 가드).
 */
export const GENUS_FLOW: Partial<Record<GenusKey, Partial<FlowLayerParams>>> = {
  sc: { flow: 1, flowQ: 1.0, flowZ: 0.4, flowT: 0.4, flowLag: 0.4, flowWave: 0.3, flowWaveKm: 8, flowAniso: 1.0, flowTemplateRes: 256,
    flowMode: 2, flowTop: 2, densPow: 0.5, flowEdge: 1.5, flowDensityScale: 0.03, flowErode: 0.5, flowTilt: 0.3, sheet: 0.3,
    flowShapeAmount: 0.35, flowShapeDetailAmount: 0.2 },
  ac: { flow: 1, flowQ: 1.0, flowZ: 0.4, flowT: 0.5, flowLag: 0.6, flowWave: 0.5, flowWaveKm: 3, flowAniso: 1.5, flowTemplateRes: 512,
    flowMode: 1, flowTop: 2, densPow: 0.5, flowEdge: 2, flowDensityScale: 0.04, flowErode: 0.6, flowTilt: 0.3,
    flowShapeAmount: 0.25, flowShapeDetailAmount: 0.3 },
  cu: { flow: 1, flowQ: 0.5, flowZ: 0.2, flowT: 1.2, flowLag: 0.6, flowWave: 0, flowAniso: 0.5, flowTemplateRes: 256,
    flowMode: 2, flowTop: 2, densPow: 0.3, flowEdge: 1, flowErode: 1.0, flowTilt: 0 },
  cg: { flow: 1, flowQ: 0.5, flowZ: 0.2, flowT: 1.2, flowLag: 0.6, flowWave: 0, flowAniso: 0.5, flowTemplateRes: 256,
    flowMode: 2, flowTop: 2, densPow: 0.3, flowEdge: 1, flowErode: 1.0, flowTilt: 0 },
  cb: { flow: 1, flowQ: 0.5, flowZ: 0.2, flowT: 1.2, flowLag: 0.6, flowWave: 0, flowAniso: 0.5, flowTemplateRes: 256,
    flowMode: 2, flowTop: 2, densPow: 0.3, flowEdge: 1.5, flowErode: 1.0, flowTilt: 0 },
  // 권운: mode/top 0/0.5 와 densityScale 은 불변(GENUS 로 내려감). 섬유 축 = high−mid 전단, 기울임 2.5(낙하 줄무늬).
  ci: { flow: 1, flowQ: 1.0, flowZ: 0.2, flowT: 0.7, flowLag: 1.0, flowWave: 0.2, flowWaveKm: 6, flowAniso: 3.0, flowTemplateRes: 256,
    densPow: 1.0, flowEdge: 1.5, flowErode: 0.3, flowTilt: 2.5 },
  cs: { flow: 1, flowQ: 1.0, flowZ: 0.2, flowT: 0.3, flowLag: 1.0, flowWave: 0.2, flowWaveKm: 8, flowAniso: 2.0, flowTemplateRes: 256,
    flowMode: 1, flowTop: 2, densPow: 0.5, flowEdge: 3, flowErode: 0.1, flowTilt: 1.0 },
  // 시트(st/as/ns): topQuantile 0.5/0.7/0.8 → 0.997 로 0/255 마스크 소멸.
  st: { flow: 1, flowQ: 1.0, flowZ: 0.3, flowT: 0.2, flowLag: 1.0, flowWave: 0.2, flowWaveKm: 8, flowAniso: 0.3, flowTemplateRes: 256,
    flowMode: 1, flowTop: 2, densPow: 0.5, flowEdge: 2, flowDensityScale: 0.05, flowErode: 0.15, flowTilt: 0.2, topQuantile: 0.997 },
  as: { flow: 1, flowQ: 1.0, flowZ: 0.3, flowT: 0.2, flowLag: 1.0, flowWave: 0.2, flowWaveKm: 8, flowAniso: 0.3, flowTemplateRes: 256,
    flowMode: 1, flowTop: 2, densPow: 0.5, flowEdge: 2, flowDensityScale: 0.02, flowErode: 0.2, flowTilt: 0.2, topQuantile: 0.997 },
  ns: { flow: 1, flowQ: 1.0, flowZ: 0.3, flowT: 0.2, flowLag: 1.0, flowWave: 0.2, flowWaveKm: 8, flowAniso: 0.3, flowTemplateRes: 256,
    flowMode: 1, flowTop: 2, densPow: 0.5, flowEdge: 2, flowDensityScale: 0.08, flowErode: 0.4, flowTilt: 0.2, topQuantile: 0.997 },
  // 모루: 흐름 끔(absolute 유지, 탑 위에 고정). 셰이더 쪽 값만.
  cbanvil: { flow: 0, flowDensityScale: 0.03, flowErode: 0.3, flowTilt: 0 },
};

// ───── 난수(mulberry32, cloudGenus.ts 와 동일) ─────
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (r: () => number) => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v); };

/**
 * 장소·날짜 시드(설계 §2.6): hash(round(lat·4), round(lon·4), dayOfYear). 하루는 경도 기준 평균 태양일(UTC + lon/15 h)로
 * 끊어 기기 시간대와 무관하게 결정적이면서 그 장소의 자정 즈음에 바뀝니다.
 */
export function flowSeedOf(lat: number, lon: number, date: Date): number {
  const DAY = 86400000;
  const t = date.getTime() + (lon / 360) * DAY;
  const d = new Date(t);
  const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
  const la = Math.round(lat * 4) | 0, lo = Math.round(lon * 4) | 0;
  let h = Math.imul(la + 0x3779, 0x9E3779B1) ^ Math.imul(lo + 0x7F4A, 0x85EBCA77) ^ Math.imul(doy + 0x1B3, 0xC2B2AE3D);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
  // 24 비트로 줄여 seed·104729 등 부시드 곱이 2^53 안에 머물게 합니다.
  return ((h >>> 8) & 0xFFFFFF) + 1;
}

// ───── radix-2 복소 FFT(제자리). 2-D = 행 다음 열. inverse 는 1/n 씩(합계 1/n²) 나눕니다. ─────
function fft1(re: Float64Array, im: Float64Array, off: number, stride: number, n: number, inverse: boolean): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? TWO_PI : -TWO_PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = off + (i + j) * stride, b = off + (i + j + half) * stride;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[off + i * stride] /= n; im[off + i * stride] /= n; }
}
/** n×n 복소 FFT(제자리, 행우선 re/im 길이 n²). n 은 2 의 거듭제곱. inverse 는 1/n² 정규화 포함. */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`cloudFlow.fft2: n must be a power of two (got ${n})`);
  if (re.length < n * n || im.length < n * n) throw new Error('cloudFlow.fft2: re/im shorter than n*n');
  for (let y = 0; y < n; y++) fft1(re, im, y * n, 1, n, inverse);
  for (let x = 0; x < n; x++) fft1(re, im, x, n, n, inverse);
}

/** n×n 주기 격자(셀 중심 (i+0.5)/n)를 타일 좌표 (u, v) 에서 쌍선형 보간. 어떤 u, v 든 mod 1 로 감쌉니다. */
export function bilinearPeriodic(F: ArrayLike<number>, n: number, u: number, v: number): number {
  const x = (u - Math.floor(u)) * n - 0.5, y = (v - Math.floor(v)) * n - 0.5;
  let x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  x0 = ((x0 % n) + n) % n; y0 = ((y0 % n) + n) % n;
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const a = F[y0 * n + x0], b = F[y0 * n + x1], c = F[y1 * n + x0], d = F[y1 * n + x1];
  const ab = a + (b - a) * fx;
  return ab + (c + (d - c) * fx - ab) * fy;
}

/** 배열을 평균 0·표준편차 1 로(제자리). 상수 배열이면 평균만 뺍니다. */
function standardize(A: Float32Array): void {
  const n = A.length; let m = 0;
  for (let i = 0; i < n; i++) m += A[i];
  m /= n;
  let s = 0;
  for (let i = 0; i < n; i++) { const d = A[i] - m; s += d * d; }
  s = Math.sqrt(s / n) || 1;
  for (let i = 0; i < n; i++) A[i] = (A[i] - m) / s;
}
/**
 * 템플릿 T 를 평균 0·표준편차 1 로 정규화(제자리). 합성(식 7)에서 q₀·ζ̂₀ 가 단위 분산이므로 wT 가 같은 척도의 가중이
 * 되게 합니다 — 템플릿의 원래 범위(0..1, 또는 속별 지수)가 가중을 몰래 바꾸지 못합니다. 표준편차 0 이면 평균만 뺍니다.
 */
export function normalizeTemplate(T: Float32Array): void { standardize(T); }

/** (2π|k|/L)² 표(스펙트럼 색인 순) */
function laplacianTable(n: number, L: number): Float64Array {
  const KK = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n;
    const k = Math.sqrt(kx * kx + ky * ky);
    KK[j * n + i] = (TWO_PI * k / L) * (TWO_PI * k / L);
  }
  return KK;
}
/** ∇²ψ = ζ 를 주기 FFT 로(평균 모드 0). re/im 은 n² 작업 버퍼. */
function poissonInto(zeta: ArrayLike<number>, n: number, KK: Float64Array, re: Float64Array, im: Float64Array, psi: Float32Array): void {
  const n2 = n * n;
  for (let i = 0; i < n2; i++) { re[i] = zeta[i]; im[i] = 0; }
  fft2(re, im, n, false);
  for (let i = 0; i < n2; i++) { const kk = KK[i]; if (kk > 0) { re[i] /= -kk; im[i] /= -kk; } else { re[i] = 0; im[i] = 0; } }
  fft2(re, im, n, true);
  for (let i = 0; i < n2; i++) psi[i] = re[i];
}
/** u = −∂ψ/∂y, v = ∂ψ/∂x (주기 중앙차분, dx 는 격자 간격 m) */
function velocityOf(psi: Float32Array, n: number, dx: number, U: Float32Array, V: Float32Array): void {
  for (let j = 0; j < n; j++) {
    const jp = (j + 1) % n, jm = (j + n - 1) % n;
    for (let i = 0; i < n; i++) {
      const ip = (i + 1) % n, im = (i + n - 1) % n;
      U[j * n + i] = -(psi[jp * n + i] - psi[jm * n + i]) / (2 * dx);
      V[j * n + i] = (psi[j * n + ip] - psi[j * n + im]) / (2 * dx);
    }
  }
}
/** 테스트·진단용: 주기 Poisson ∇²ψ = ζ (ζ 평균은 버림). psi 는 n² Float32Array. */
export function poissonSolve(zeta: ArrayLike<number>, n: number, tileKm: number, psi: Float32Array): void {
  if (psi.length < n * n) throw new Error('cloudFlow.poissonSolve: psi shorter than n*n');
  const KK = laplacianTable(n, tileKm * 1000);
  poissonInto(zeta, n, KK, new Float64Array(n * n), new Float64Array(n * n), psi);
}
/** 테스트·진단용: ψ → (u, v) m/s, 주기 중앙차분. */
export function velocityFromPsi(psi: Float32Array, n: number, tileKm: number, U: Float32Array, V: Float32Array): void {
  velocityOf(psi, n, (tileKm * 1000) / n, U, V);
}

/** FlowCore 버퍼를 n 에 맞게 마련(없거나 크기가 다르면 새로 만듭니다) */
export function newFlowCore(n: number, into?: Partial<FlowCore>, qn = n): FlowCore {
  const n2 = n * n;
  const out = (into ?? {}) as FlowCore;
  out.n = n; out.qn = qn;
  if (!out.dx || out.dx.length !== n2) out.dx = new Float32Array(n2);
  if (!out.dy || out.dy.length !== n2) out.dy = new Float32Array(n2);
  if (!out.z0n || out.z0n.length !== n2) out.z0n = new Float32Array(n2);
  if (!out.q0 || out.q0.length !== qn * qn) out.q0 = new Float32Array(qn * qn);
  out.umax = 0; out.cfl = 0; out.s90 = 1; out.hoursUsed = 0;
  return out;
}

/**
 * §131 라벨맵 왜곡: X = x − D 이므로 J = ∇X = I − ∇D(주기 중앙차분, 타일 단위). 칸마다 특이값비 s = σ₁/σ₂ 를 out 에 —
 * 2×2 닫힌 꼴 σ = |Q ± R|(Q = ½√((a+d)² + (c−b)²), R = ½√((a−d)² + (c+b)²)). 접힌 칸(det < 0)도 σ₂ > 0 이면 유한.
 */
export function distortionRatios(DX: ArrayLike<number>, DY: ArrayLike<number>, n: number, out: Float32Array): void {
  const h = n / 2;
  for (let j = 0; j < n; j++) {
    const jp = ((j + 1) % n) * n, jm = ((j + n - 1) % n) * n, jr = j * n;
    for (let i = 0; i < n; i++) {
      const ip = (i + 1) % n, im = (i + n - 1) % n;
      const a = 1 - (DX[jr + ip] - DX[jr + im]) * h, b = -(DX[jp + i] - DX[jm + i]) * h;
      const c = -(DY[jr + ip] - DY[jr + im]) * h, d = 1 - (DY[jp + i] - DY[jm + i]) * h;
      const Q = 0.5 * Math.sqrt((a + d) * (a + d) + (c - b) * (c - b)), R = 0.5 * Math.sqrt((a - d) * (a - d) + (c + b) * (c + b));
      out[jr + i] = (Q + R) / Math.max(1e-6, Math.abs(Q - R));
    }
  }
}

/**
 * §131 수분장 q₀(모드 1·2, qn² 격자). 결과는 평균 0·분산 1.
 *  모드 1(가우스 분수 적분): |q̂| ∝ |k|^−(1+H)·g, 1 ≤ |k| < qn/2, 난수 위상 → ζ̂₀(qn 으로 쌍선형) 와 상관 qCorr 로 섞음.
 *  모드 2(로그정규 캐스케이드 + 분수 적분): G = Σ 옥타브 가우스(|k| ∈ [2^l, 2^(l+1)) 마다 분산 2 ln2·C1, |k| < 2 는 σ 반감) + qLog·ζ̂₀,
 *    ε = e^G / ⟨e^G⟩, q₀ = 표준화(F⁻¹[|k|^−H·F(ε^a)]). 분수 적분을 ln ε 가 아니라 ε^a 에 걸어야 간헐성(첨도)이 남습니다(조사서 A6).
 *  모드 2 의 옥타브 분산은 실현값으로 맞춥니다(정수 격자 껍질의 모드 수 편차를 지움). 모든 FFT 는 fft2(radix-2, 결정론).
 */
function* qFieldSteps(p: FlowSceneParams, mode: 1 | 2, qn: number, Z0n: Float32Array, n: number, Q0: Float32Array): Generator<void> {
  const q2 = qn * qn, H = p.qH ?? 0.5, kTop = qn / 2;
  const re = new Float64Array(q2), im = new Float64Array(q2);
  const Zq = new Float32Array(q2);
  for (let j = 0; j < qn; j++) for (let i = 0; i < qn; i++) Zq[j * qn + i] = bilinearPeriodic(Z0n, n, (i + 0.5) / qn, (j + 0.5) / qn);
  const kOf = (i: number, j: number) => { const kx = i <= qn / 2 ? i : i - qn, ky = j <= qn / 2 ? j : j - qn; return [kx, ky, Math.sqrt(kx * kx + ky * ky)]; };
  const r2 = rng(p.seed * 104729 + 29 + mode * 7);
  if (mode === 1) {
    for (let j = 0; j < qn; j++) for (let i = 0; i < qn; i++) {
      const [kx, ky, k] = kOf(i, j);
      if (k < 1 || k >= kTop) continue;
      if (ky < 0 || (ky === 0 && kx < 0)) continue;
      const amp = Math.pow(k, -(1 + H)) * gauss(r2), ph = r2() * TWO_PI;
      const i2 = ((-kx % qn) + qn) % qn, j2 = ((-ky % qn) + qn) % qn;
      re[j * qn + i] = amp * Math.cos(ph); im[j * qn + i] = amp * Math.sin(ph); re[j2 * qn + i2] = amp * Math.cos(ph); im[j2 * qn + i2] = -amp * Math.sin(ph);
    }
    fft2(re, im, qn, true);
    for (let i = 0; i < q2; i++) Q0[i] = re[i];
    standardize(Q0);
    const c = Math.max(-1, Math.min(1, p.qCorr || 0)), cq = Math.sqrt(1 - c * c);
    for (let i = 0; i < q2; i++) Q0[i] = c * Zq[i] + cq * Q0[i];
    standardize(Q0);
    yield;
    return;
  }
  // 모드 2: 옥타브별 가우스(같은 스펙트럼 모양 k^−1 진폭 = 옥타브당 같은 분산)를 따로 만들어 실현 분산을 맞춘 뒤 더합니다.
  const C1 = Math.max(0, p.qC1 ?? 0.1), a = p.qA ?? 0.6, cLog = p.qLog ?? 0.5;
  const sig2 = 2 * Math.LN2 * C1;
  const G = new Float64Array(q2);
  const nOct = Math.max(1, Math.floor(Math.log2(kTop - 1e-9)) + 1);
  for (let l = 0; l < nOct; l++) {
    re.fill(0); im.fill(0);
    const lo = Math.pow(2, l), hi = Math.min(kTop, Math.pow(2, l + 1));
    for (let j = 0; j < qn; j++) for (let i = 0; i < qn; i++) {
      const [kx, ky, k] = kOf(i, j);
      if (k < lo || k >= hi) continue;
      if (ky < 0 || (ky === 0 && kx < 0)) continue;
      const amp = gauss(r2) / k, ph = r2() * TWO_PI;
      const i2 = ((-kx % qn) + qn) % qn, j2 = ((-ky % qn) + qn) % qn;
      re[j * qn + i] = amp * Math.cos(ph); im[j * qn + i] = amp * Math.sin(ph); re[j2 * qn + i2] = amp * Math.cos(ph); im[j2 * qn + i2] = -amp * Math.sin(ph);
    }
    fft2(re, im, qn, true);
    let m = 0, v = 0;
    for (let i = 0; i < q2; i++) m += re[i];
    m /= q2;
    for (let i = 0; i < q2; i++) { const d = re[i] - m; v += d * d; }
    const target = sig2 * (l === 0 ? 0.25 : 1), sc = v > 0 ? Math.sqrt(target / (v / q2)) : 0;
    for (let i = 0; i < q2; i++) G[i] += (re[i] - m) * sc;
    yield;
  }
  // ε = e^(G + c·ζ̂₀) / 평균, 그 뒤 ε^a 에 |k|^−H 분수 적분.
  let mE = 0;
  for (let i = 0; i < q2; i++) { G[i] = Math.exp(G[i] + cLog * Zq[i]); mE += G[i]; }
  mE /= q2;
  for (let i = 0; i < q2; i++) { re[i] = Math.pow(G[i] / mE, a); im[i] = 0; }
  fft2(re, im, qn, false);
  for (let j = 0; j < qn; j++) for (let i = 0; i < qn; i++) {
    const k = kOf(i, j)[2], idx = j * qn + i;
    if (k < 1) { re[idx] = 0; im[idx] = 0; continue; }
    const w = Math.pow(k, -H); re[idx] *= w; im[idx] *= w;
  }
  fft2(re, im, qn, true);
  for (let i = 0; i < q2; i++) Q0[i] = re[i];
  standardize(Q0);
  yield;
}

/**
 * 흐름 핵(식 1–6): ψ₀ 스펙트럼 → ζ₀ → Poisson·vrms 정규화 → q₀ → 반라그랑주 라벨맵 적분. 결과는 out 에.
 * yield: 초기화 단계마다(ψ₀, 속도, q₀) + 걸음마다(n ≥ 128 은 걸음을 4 행 블록으로 나눠 각 블록 뒤에, Poisson 갱신 뒤에도).
 * 결정론: 호출자가 yield 를 어떻게 끊어 소비하든 바이트 동일(상태는 전부 지역 typed array).
 */
export function* flowCoreSteps(p: FlowSceneParams, tileKm: number, out: FlowCore): Generator<void> {
  const n = p.n | 0;
  if (n < 8 || (n & (n - 1)) !== 0) throw new Error(`cloudFlow: n must be a power of two >= 8 (got ${n})`);
  const qMode = p.qMode ?? 0;
  const qn = qMode === 0 ? n : (p.qN ?? 128) | 0;
  if (qn < 8 || (qn & (qn - 1)) !== 0) throw new Error(`cloudFlow: qN must be a power of two >= 8 (got ${qn})`);
  newFlowCore(n, out, qn);
  const n2 = n * n, L = tileKm * 1000, dx = L / n;
  const steps = Math.max(1, p.steps | 0), dt = (p.hours * 3600) / steps, dtu = dt / L;
  const psiEvery = Math.max(1, p.psiEvery | 0);
  const DX = out.dx, DY = out.dy, Z0n = out.z0n, Q0 = out.q0;
  DX.fill(0); DY.fill(0);
  const KK = laplacianTable(n, L);
  const re = new Float64Array(n2), im = new Float64Array(n2);

  // 1) ψ₀ = 난수 위상 트리그 모드(바람 방향 비등방) → ζ₀ 스펙트럼(정확) → 격자. 에르미트 쌍은 반평면만 뽑습니다.
  const r = rng(p.seed * 7919 + 13);
  const wang = ((p.windDeg + (p.rollDeg || 0)) * Math.PI) / 180, wx = Math.sin(wang), wy = Math.cos(wang);
  const aniso = Math.max(0, p.aniso || 0), kmax = p.kmax, specPow = p.specPow;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n, k = Math.sqrt(kx * kx + ky * ky);
    if (k < 1 || k > kmax) continue;
    if (ky < 0 || (ky === 0 && kx < 0)) continue;
    const khat = (kx * wx + ky * wy) / k;
    const amp = Math.pow(k, -specPow) * gauss(r) / (1 + aniso * khat * khat), ph = r() * TWO_PI;
    const i2 = ((-kx % n) + n) % n, j2 = ((-ky % n) + n) % n;
    const kk = KK[j * n + i], zr = -kk * amp * Math.cos(ph), zi = -kk * amp * Math.sin(ph);
    re[j * n + i] = zr; im[j * n + i] = zi; re[j2 * n + i2] = zr; im[j2 * n + i2] = -zi;
  }
  fft2(re, im, n, true);
  const Z0 = new Float32Array(n2);
  for (let i = 0; i < n2; i++) Z0[i] = re[i];
  yield;

  // 2) ∇²ψ = ζ₀, u = −ψ_y, v = ψ_x; rms|u| = vrms 로 정규화. umax 는 적분 중 최대(변위 상한의 근거).
  const psi = new Float32Array(n2), U = new Float32Array(n2), V = new Float32Array(n2);
  poissonInto(Z0, n, KK, re, im, psi);
  velocityOf(psi, n, dx, U, V);
  {
    let s = 0;
    for (let i = 0; i < n2; i++) s += U[i] * U[i] + V[i] * V[i];
    const rms = Math.sqrt(s / n2), sc = p.vrms / Math.max(1e-9, rms);
    for (let i = 0; i < n2; i++) { Z0[i] *= sc; U[i] *= sc; V[i] *= sc; psi[i] *= sc; }
  }
  let umax = 0;
  for (let i = 0; i < n2; i++) { const m = Math.sqrt(U[i] * U[i] + V[i] * V[i]); if (m > umax) umax = m; }
  yield;

  // 3) q₀. ζ̂₀ 는 먼저 표준화해 둡니다(합성 항이자 수분 상관의 기준).
  for (let i = 0; i < n2; i++) Z0n[i] = Z0[i];
  standardize(Z0n);
  if (qMode === 0) {
    // 1회차: |k| ≤ kq 의 k^−qPow GRF 를 ζ̂₀ 와 상관 qCorr 로 섞음(저기압 = 습함).
    const r2 = rng(p.seed * 104729 + 29);
    re.fill(0); im.fill(0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n, k = Math.sqrt(kx * kx + ky * ky);
      if (k < 1 || k > p.kq) continue;
      if (ky < 0 || (ky === 0 && kx < 0)) continue;
      const amp = Math.pow(k, -p.qPow) * gauss(r2), ph = r2() * TWO_PI;
      const i2 = ((-kx % n) + n) % n, j2 = ((-ky % n) + n) % n;
      const qr = amp * Math.cos(ph), qi = amp * Math.sin(ph);
      re[j * n + i] = qr; im[j * n + i] = qi; re[j2 * n + i2] = qr; im[j2 * n + i2] = -qi;
    }
    fft2(re, im, n, true);
    for (let i = 0; i < n2; i++) Q0[i] = re[i];
    standardize(Q0);
    const c = Math.max(-1, Math.min(1, p.qCorr || 0)), cq = Math.sqrt(1 - c * c);
    for (let i = 0; i < n2; i++) Q0[i] = c * Z0n[i] + cq * Q0[i];
    standardize(Q0);   // 섞은 뒤 다시 평균 0·분산 1(wQ 가 '단위 분산 수분' 가중이 되게)
  } else {
    yield* qFieldSteps(p, qMode, qn, Z0n, n, Q0);
  }
  yield;

  // 4) 시간 루프: ζ = ζ₀(X) 로 ψ 갱신(psiEvery), 중점 역궤적으로 D 이류. 블록으로 나눠도 읽기(DX/DY)·쓰기(DX2/DY2)가 갈려 결과 동일.
  //    §131 변형 게이트(s90 > 0): 걸음마다 J = I − ∇D 의 특이값비 90 분위 s 를 세고, hoursMin 뒤 s 가 목표에 닿으면 직전 걸음과 선형 보간해 멈춤.
  //    dt 는 그대로라 hoursMax 까지 걸음을 늘립니다. 게이트가 꺼지면 걸음 수·바이트는 1회차와 같습니다.
  let dxA: Float32Array = DX, dyA: Float32Array = DY, dxB: Float32Array = new Float32Array(n2), dyB: Float32Array = new Float32Array(n2);
  const zeta = new Float32Array(n2);
  const blocks = n >= 128 ? 4 : 1, rowsPerBlock = n / blocks;
  const gate = (p.s90 ?? 0) > 0;
  const hoursMax = gate ? Math.max(p.hours, p.hoursMax ?? 1.2) : p.hours;
  const maxSteps = gate ? Math.max(1, Math.ceil((hoursMax * 3600) / dt - 1e-9)) : steps;
  const minSteps = gate ? Math.max(1, Math.ceil(((p.hoursMin ?? 0.25) * 3600) / dt - 1e-9)) : steps;
  const sBuf = new Float32Array(n2);
  let sPrev = 1, hoursUsed = (steps * dt) / 3600;
  for (let st = 0; st < maxSteps; st++) {
    if (st > 0 && st % psiEvery === 0) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        zeta[idx] = bilinearPeriodic(Z0, n, (i + 0.5) / n - dxA[idx], (j + 0.5) / n - dyA[idx]);
      }
      poissonInto(zeta, n, KK, re, im, psi);
      velocityOf(psi, n, dx, U, V);
      for (let i = 0; i < n2; i++) { const m = Math.sqrt(U[i] * U[i] + V[i] * V[i]); if (m > umax) umax = m; }
      if (blocks > 1) yield;
    }
    for (let b = 0; b < blocks; b++) {
      const j0 = b * rowsPerBlock, j1 = j0 + rowsPerBlock;
      for (let j = j0; j < j1; j++) for (let i = 0; i < n; i++) {
        const idx = j * n + i, u = (i + 0.5) / n, v = (j + 0.5) / n;
        const um = u - 0.5 * dtu * U[idx], vm = v - 0.5 * dtu * V[idx];
        const uu = bilinearPeriodic(U, n, um, vm), vv = bilinearPeriodic(V, n, um, vm);
        const ud = u - dtu * uu, vd = v - dtu * vv;
        // X(x, t+dt) = X(x_d, t) ⇒ D(x) = (x − x_d) + D(x_d)
        dxB[idx] = dtu * uu + bilinearPeriodic(dxA, n, ud, vd);
        dyB[idx] = dtu * vv + bilinearPeriodic(dyA, n, ud, vd);
      }
      if (b < blocks - 1) yield;
    }
    let t: Float32Array = dxA; dxA = dxB; dxB = t; t = dyA; dyA = dyB; dyB = t;
    if (gate) {
      // dxA/dyA = 이번 걸음, dxB/dyB = 직전 걸음.
      distortionRatios(dxA, dyA, n, sBuf);
      const sCur = quantileHist(sBuf, 0.9);
      if (st + 1 >= minSteps && sCur >= p.s90!) {
        const w = sCur > sPrev ? Math.max(0, Math.min(1, (p.s90! - sPrev) / (sCur - sPrev))) : 1;
        for (let i = 0; i < n2; i++) { dxA[i] = dxB[i] + w * (dxA[i] - dxB[i]); dyA[i] = dyB[i] + w * (dyA[i] - dyB[i]); }
        hoursUsed = ((st + w) * dt) / 3600;
        yield;
        break;
      }
      sPrev = sCur;
      hoursUsed = ((st + 1) * dt) / 3600;
    }
    yield;
  }
  // 걸음 수가 홀수면 최신 D 가 임시 버퍼에 있으므로 out 으로 복사합니다.
  if (dxA !== DX) { DX.set(dxA); DY.set(dyA); }
  distortionRatios(DX, DY, n, sBuf);
  out.s90 = quantileHist(sBuf, 0.9);
  out.hoursUsed = hoursUsed;
  out.umax = umax;
  out.cfl = (umax * dt) / dx;
}

/**
 * 합성(식 7): f(x) = wQ·q₀(X) + wZ·ζ̂₀(X) + wT·T(x − lag·D(x)) + wW·cos(2π k_w·X + φ_w), X = x − D(x).
 * T 는 TS×TS 주기 템플릿(정규화된 것), f 는 S×S. 8 행마다 yield. 가중 0 인 항은 표본을 뽑지 않습니다(값 동일, 시간 절약).
 */
export function* flowComposeSteps(core: FlowCore, T: Float32Array, TS: number, S: number, w: FlowLayerWeights, f: Float32Array): Generator<void> {
  if (f.length < S * S) throw new Error('cloudFlow.flowComposeSteps: f shorter than S*S');
  if (w.wT !== 0 && T.length < TS * TS) throw new Error('cloudFlow.flowComposeSteps: T shorter than TS*TS');
  const n = core.n, DX = core.dx, DY = core.dy, Q0 = core.q0, Z0n = core.z0n, qn = core.qn ?? n;
  const wQ = w.wQ, wZ = w.wZ, wT = w.wT, wW = w.wW, lag = w.lag;
  const kwx = w.waveK[0], kwy = w.waveK[1], ph = w.wavePhase;
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const dX = bilinearPeriodic(DX, n, u, v), dY = bilinearPeriodic(DY, n, u, v);
      const X = u - dX, Y = v - dY;
      let val = 0;
      if (wQ !== 0) val += wQ * bilinearPeriodic(Q0, qn, X, Y);
      if (wZ !== 0) val += wZ * bilinearPeriodic(Z0n, n, X, Y);
      if (wT !== 0) val += wT * bilinearPeriodic(T, TS, u - lag * dX, v - lag * dY);
      if (wW !== 0) val += wW * Math.cos(TWO_PI * (kwx * X + kwy * Y) + ph);
      f[y * S + x] = val;
    }
    if (y % 8 === 7) yield;
  }
}

/**
 * 정확한 순위 분위수 — cloudGenus.ts 의 정렬 분위수 sorted[min(len−1, max(0, floor(q·(len−1))))] 와 값이 같습니다.
 * 4096 칸 히스토그램으로 목표 순위가 든 칸만 추려 정렬(칸이 크면 재귀) — 512² 에서 정렬 60–75 ms → ~10–20 ms.
 * 칸 나누기 floor((v − min)·scale) 는 v 에 단조라 칸 안 순서 = 전체 순서. NaN 은 정렬과 같이 맨 뒤로 보냅니다.
 */
export function quantileHist(f: Float32Array, q: number, bins = 4096): number {
  const len = f.length;
  if (len === 0) return NaN;
  const rank = Math.min(len - 1, Math.max(0, Math.floor(q * (len - 1))));
  return selectRank(f, rank, Math.max(2, bins | 0));
}
function selectRank(f: Float32Array, rank: number, bins: number): number {
  const len = f.length;
  let lo = Infinity, hi = -Infinity, nan = 0;
  for (let i = 0; i < len; i++) { const v = f[i]; if (v !== v) { nan++; continue; } if (v < lo) lo = v; if (v > hi) hi = v; }
  if (rank >= len - nan) return NaN;
  if (!(hi > lo)) return lo;
  const scale = bins / (hi - lo);
  const counts = new Int32Array(bins);
  for (let i = 0; i < len; i++) {
    const v = f[i]; if (v !== v) continue;
    let b = Math.floor((v - lo) * scale); if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  let cum = 0, b = 0;
  for (; b < bins - 1; b++) { if (cum + counts[b] > rank) break; cum += counts[b]; }
  const sub = new Float32Array(counts[b]);
  let k = 0, smin = Infinity, smax = -Infinity;
  for (let i = 0; i < len; i++) {
    const v = f[i]; if (v !== v) continue;
    let bb = Math.floor((v - lo) * scale); if (bb >= bins) bb = bins - 1;
    if (bb === b) { sub[k++] = v; if (v < smin) smin = v; if (v > smax) smax = v; }
  }
  const r = rank - cum;
  if (!(smax > smin)) return smin;                 // 칸 안이 전부 같은 값(무거운 동률)
  if (sub.length > 4096) return selectRank(sub, r, bins);
  sub.sort();
  return sub[r];
}

/**
 * 전단파 파수(식 6): 전단 방향 ŝ 에 가장 가까운 정수 파수, |k| ≈ tileKm/lambdaKm — 마루가 전단에 수직.
 * 성분별 반올림이라 k=8 에서 ~7°, k=3 에서 ~15° 양자화(자에 "실현 방향 vs 예보 전단" 행으로 보고). 전단 0 이면 [0, 1].
 */
/**
 * §130 흐름 층의 d = **구름 화소 안 순위**^gamma (f > th 인 화소를 f 로 줄 세워 (순위+1)/n, 그 뒤 ^gamma). 가산 원시장은 진폭 분포가
 * 운량·속마다 달라(사례: sc 85 % 에서 d 가 0.09 중앙으로 몰려 엔트로피 2.3 bit, topQuantile 0.9~0.997 어느 값도 못 고침) d 가 '어디가 두껍고
 * 어디가 얇은가'의 **순서**만 뜻하게 둡니다 — 운량과 무관하게 같은 히스토그램(gamma 2.0: 중앙 0.25, d<0.2 44 %, 엔트로피 ≈ 3.0 bit — §124 sc 장의
 * 통계(중앙 0.25~0.34)와 같음). 4096 칸 누적 히스토그램 + 칸 안 선형 보간(정렬 없이 O(N), Hermes 에서도 수십 ms). 면적(d>0) = 운량은 그대로.
 * out[i] = d(0..1), f ≤ th 인 곳은 0.
 */
export function rankNormalize(f: Float32Array, th: number, gamma: number, out: Float32Array, bins = 4096): void {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v > th) { n++; if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (n === 0) { out.fill(0); return; }
  const span = Math.max(hi - lo, 1e-12), cnt = new Int32Array(bins);
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v > th) cnt[Math.min(bins - 1, Math.floor(((v - lo) / span) * bins))]++; }
  const cum = new Float64Array(bins + 1);
  for (let b = 0; b < bins; b++) cum[b + 1] = cum[b] + cnt[b];
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (!(v > th)) { out[i] = 0; continue; }
    const x = ((v - lo) / span) * bins, b = Math.min(bins - 1, Math.floor(x)), fr = x - b;
    const u = (cum[b] + fr * cnt[b] + 0.5) / n;   // 0..1 순위(칸 안 선형)
    out[i] = Math.pow(Math.min(1, Math.max(1e-6, u)), gamma);
  }
}

export function waveVectorFor(shearU: number, shearV: number, lambdaKm: number, tileKm: number): [number, number] {
  const s = Math.sqrt(shearU * shearU + shearV * shearV);
  if (!(s > 0) || !(lambdaKm > 0) || !(tileKm > 0)) return [0, 1];
  const K = tileKm / lambdaKm;
  let kx = Math.round((K * shearU) / s), ky = Math.round((K * shearV) / s);
  if (kx === 0 && ky === 0) { if (Math.abs(shearU) >= Math.abs(shearV)) kx = shearU >= 0 ? 1 : -1; else ky = shearV >= 0 ? 1 : -1; }
  return [kx, ky];
}

/**
 * 층 가중(식 7)을 GENUS_FLOW 기본값 + opts 덮어쓰기로. 전단 S = |(shearU, shearV)| km/h → m/s ÷ (aboveAltKm − layerAltKm)
 * [m/s per km], 파 진폭 = flowWave·clamp((S − S0)/S1, 0, 1). 파 위상 시드 = flowSeed·31 + 5 (설계 §2.6).
 */
export function flowLayerWeightsOf(opts: Partial<FlowLayerParams>, genus: GenusKey, tileKm: number, layerAltKm: number, aboveAltKm: number): FlowLayerWeights {
  const g: Partial<FlowLayerParams> = GENUS_FLOW[genus] ?? {};
  const pick = (k: keyof FlowLayerParams, d: number): number => { const v = opts[k] ?? g[k]; return typeof v === 'number' && v === v ? v : d; };
  const su = pick('shearU', 0), sv = pick('shearV', 0);
  const gapKm = Math.max(0.1, aboveAltKm - layerAltKm);
  const S = Math.sqrt(su * su + sv * sv) / 3.6 / gapKm;
  const onset = Math.max(0, Math.min(1, (S - FLOW_WAVE_S0) / FLOW_WAVE_S1));
  const seed = pick('flowSeed', FLOW_DEFAULTS.seed);
  return {
    wQ: pick('flowQ', 1), wZ: pick('flowZ', 0), wT: pick('flowT', 1), lag: pick('flowLag', 1),
    wW: pick('flowWave', 0) * onset,
    waveK: waveVectorFor(su, sv, pick('flowWaveKm', 8), tileKm),
    wavePhase: rng(seed * 31 + 5)() * TWO_PI,
  };
}

/**
 * §131 카메라 칸 조건화(조사서 A2): g×g 운량 격자 m(0..1, 주기)에서 반지름 r 칸 원판의 국소 운량이 전역 운량에 가장 가까운 칸을 고릅니다.
 * 동률은 원점(타일 uv (0,0) = 관측점의 원래 자리)에 가까운 칸, 그다음 색인 순 — 결정론. 전역 운량이 (0, maxCover] 밖이면 null.
 * 반환: 그 칸 중심의 타일 uv. 타일 바이트는 바꾸지 않고 관측점만 옮깁니다(호출자가 weatherOffsetKm = uv·tileKm 로).
 */
export function camCellOffset(m: Float32Array, g: number, r = 8, maxCover = 0.6): [number, number] | null {
  let tot = 0;
  for (let i = 0; i < g * g; i++) tot += m[i];
  const glob = tot / (g * g);
  if (!(glob > 0) || glob > maxCover) return null;
  const disc: number[] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r) disc.push(di, dj);
  const nd = disc.length / 2;
  let best = -1, bestErr = Infinity, bestDist = Infinity;
  for (let J = 0; J < g; J++) for (let I = 0; I < g; I++) {
    let s = 0;
    for (let q = 0; q < disc.length; q += 2) s += m[((J + disc[q + 1] + g) % g) * g + ((I + disc[q] + g) % g)];
    const err = Math.abs(s / nd - glob);
    const u = (I + 0.5) / g, v = (J + 0.5) / g, du = Math.min(u, 1 - u), dv = Math.min(v, 1 - v), dist = du * du + dv * dv;
    if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) <= 1e-9 && dist < bestDist - 1e-12)) { best = J * g + I; bestErr = err; bestDist = dist; }
  }
  return best < 0 ? null : [((best % g) + 0.5) / g, (Math.floor(best / g) + 0.5) / g];
}

