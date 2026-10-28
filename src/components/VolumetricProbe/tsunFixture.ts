/**
 * tsunFixture.ts — §179 WP1 T_sun 빈틈 법칙 고정표 읽기·평가(하네스 전용, 앱 경로 없음 — 2026-10-28 사용자 결정).
 *
 * 표는 tools/genus-ruler/tsun/fixture/build-fixture.mjs 가 만듭니다(tsun-fixture.json 머리말 + tsun-fixture.bin). 앱 종류 타일
 * (makeGenusWeather, 씨앗 7)을 렌더러 밀도식(종류 단면 × shape.bin 침식, mip 0)으로 다시 세워 수평선마다 무차별 적분한 것:
 *   τ_칸(L) = −ln⟨T(0, L)⟩      칸 = (항목(종류, 레인), 운량 c, 높이 비율 hf, 방위 φ), L 격자 12 점
 *   λ₁₀(칸) = τ(L*)/L*           명목 소광률(L* = τ ≤ ln 1e4 인 가장 긴 격자 L ≤ 10 km)
 *   G(Λ; 칸) = τ_칸(Λ/λ₁₀)        성장 곡선(curve of growth) — 빌더는 줄을 따라 Λ = ∫ λ₁₀(c(x), hf, φ) ds 를 쌓고 끝에서 τ = G(Λ)
 *   τ_c(c, hf, reach)            구름 안 표본에서 2차 행진 도달(reach) 뒤의 추가 광학두께(방위 평균)
 * 사이 값은 c·hf·φ 의 다중 선형 무게(최대 8 칸)로 ε 기하 평균, G 는 같은 Λ 에서 칸마다 τ_칸(Λ/λ₁₀_칸) 를 섞습니다(design v2.1 §2 M6).
 * 경계: hf 0·1 과 c 0 은 0 칸(구름 없음), φ 는 mod 180, c ≥ 0.999 는 1.0 칸만(생성기 불연속), L 은 0 에서 τ = 0, 마지막 격자 너머는
 * 마지막 마디 기울기.
 * 순수 함수(three·DOM 없음) — 시험(fixture-test.mjs)이 esbuild 로 묶어 C 무차별 적분과 맞대 봅니다(U1b·U1e).
 */

export interface TsunFixtureEntry {
  genus: string;
  lane: number;
  covers: number[];
  tauOffset: number;
  tauCOffset: number;
  profile: { densityScale: number; [k: string]: number };
}
export interface TsunFixtureHeader {
  name: string;
  version: number;
  grids: { L: number[]; reach: number[]; hf: number[]; phi: number[]; covers: number[]; condL: number[]; fullCover: number };
  layout: { tau: { offsetBytes: number; count: number; scale: number }; tauC: { offsetBytes: number; count: number; scale: number } };
  entries: TsunFixtureEntry[];
  binSha256: string;
  binBytes: number;
  [k: string]: unknown;
}
export interface TsunFixture {
  header: TsunFixtureHeader;
  tau: Uint16Array;
  tauC: Int16Array;
  /** 항목마다 [c][hf][φ] 의 λ₁₀ (1/km) */
  lam10: Float32Array[];
}

/** λ₁₀ 규칙의 문턱: τ ≤ ln(1e4) 인 가장 긴 L ≤ 10 km (머리말 rules.lambda10 과 같은 값) */
const LAM_TAU_OK = Math.log(1e4);
const LAM_L_MAX = 10;

export function parseTsunFixture(header: TsunFixtureHeader, bytes: Uint8Array): TsunFixture {
  if (bytes.byteLength !== header.binBytes) throw new Error(`tsunFixture: bin 길이 ${bytes.byteLength} ≠ 머리말 ${header.binBytes}`);
  const { tau: lt, tauC: lc } = header.layout;
  // 정렬된 복사본(바이트 오프셋이 2 의 배수가 아닐 수 있음)
  const buf = bytes.slice().buffer;
  const tau = new Uint16Array(buf, lt.offsetBytes, lt.count);
  const tauC = new Int16Array(buf, lc.offsetBytes, lc.count);
  const { L, hf, phi } = header.grids;
  const nL = L.length, nH = hf.length, nP = phi.length;
  const lam10 = header.entries.map(E => {
    const out = new Float32Array(E.covers.length * nH * nP);
    for (let k = 0; k < out.length; k++) {
      const base = E.tauOffset + k * nL;
      let lam = 0;
      for (let l = nL - 1; l >= 0; l--) {
        if (L[l] > LAM_L_MAX) continue;
        const t = tau[base + l] * lt.scale;
        if (t <= LAM_TAU_OK || l === 0) { lam = t / L[l]; break; }
      }
      out[k] = lam;
    }
    return out;
  });
  return { header, tau, tauC, lam10 };
}

/** (종류, 레인) → 항목 번호. 없으면 같은 종류의 첫 항목(다른 타일 실현 — §179 결정), 종류도 없으면 −1. */
export function tsunFixtureEntry(fx: TsunFixture, genus: string, lane: number): number {
  const es = fx.header.entries;
  const exact = es.findIndex(E => E.genus === genus && E.lane === lane);
  return exact >= 0 ? exact : es.findIndex(E => E.genus === genus);
}

type W = [number, number][]; // [첨자(−1 = 0 칸), 무게]

function bracket(grid: number[], x: number): W {
  const n = grid.length;
  if (x <= grid[0]) return [[0, 1]];
  if (x >= grid[n - 1]) return [[n - 1, 1]];
  let i = 0;
  while (grid[i + 1] < x) i++;
  const t = (x - grid[i]) / (grid[i + 1] - grid[i]);
  return t === 0 ? [[i, 1]] : [[i, 1 - t], [i + 1, t]];
}
/**
 * 운량 무게. 생성기는 c ≥ fullCover(0.999)에서 문턱을 끈 다른 장을 만들므로(불연속) 그 위는 1.0 칸만, 아래는 fullCover 아래 칸끼리만
 * (마지막 칸에서 자름) 섞습니다. 운량 칸이 하나뿐인 항목(모루 — 운량을 안 씀)은 늘 그 칸.
 */
function coverW(E: TsunFixtureEntry, c: number, full: number, zeroCell: boolean): W {
  const g = E.covers;
  if (g.length === 1) return [[0, 1]];
  if (c >= full) { const i = g.findIndex(x => x >= full); return [[i >= 0 ? i : g.length - 1, 1]]; }
  const below = g.filter(x => x < full);
  if (!(c > 0)) return zeroCell ? [[-1, 1]] : [[0, 1]];
  if (c < below[0]) return zeroCell ? [[-1, 1 - c / below[0]], [0, c / below[0]]] : [[0, 1]];
  return bracket(below, c);
}
function hfW(grid: number[], h: number): W {
  if (!(h > 0) || !(h < 1)) return [[-1, 1]];
  const ext = [0, ...grid, 1];
  return bracket(ext, h).map(([i, w]) => [i === 0 || i === ext.length - 1 ? -1 : i - 1, w] as [number, number]);
}
function phiW(grid: number[], phiDeg: number): W {
  const p = ((phiDeg % 180) + 180) % 180, n = grid.length;
  if (p >= grid[n - 1]) {
    const t = (p - grid[n - 1]) / (180 - grid[n - 1]);
    return [[n - 1, 1 - t], [0, t]];
  }
  return bracket(grid, p);
}

/** 칸의 τ(L) — 선형, τ(0) = 0, 마지막 격자 너머는 마지막 마디 기울기 */
function cellTau(fx: TsunFixture, base: number, Lkm: number): number {
  const L = fx.header.grids.L, s = fx.header.layout.tau.scale, n = L.length, T = fx.tau;
  if (!(Lkm > 0)) return 0;
  if (Lkm <= L[0]) return (T[base] * s * Lkm) / L[0];
  if (Lkm >= L[n - 1]) {
    const a = T[base + n - 2] * s, b = T[base + n - 1] * s;
    return b + (Math.max(0, b - a) * (Lkm - L[n - 1])) / (L[n - 1] - L[n - 2]);
  }
  let i = 0;
  while (L[i + 1] < Lkm) i++;
  const t = (Lkm - L[i]) / (L[i + 1] - L[i]);
  return (T[base + i] * (1 - t) + T[base + i + 1] * t) * s;
}

/**
 * 이웃 칸(최대 8)을 돌며 0 칸(hf 끝·c 0)의 무게 w0 를 따로 셉니다. 섞기는 0 이 아닌 칸끼리 ε 기하 평균(log(τ + ε) 선형) 뒤 (1 − w0) 배:
 * 개발 측정에서 τ 는 hf·c 에 대해 지수에 가깝게 변해(ac hf 0.3 → 0.4 에서 τ(10 km) 2.2 → 5.3) τ 선형은 과대(+0.5 ln), T 선형은 과소였고
 * 기하 평균이 무차별 값에 가장 가까웠습니다 [measured, fixture-test 개발 diag2]. ε = 0.01 은 τ → 0 근처에서 선형으로 넘어가게 합니다.
 */
const GEO_EPS = 0.01;
interface Blend { w0: number; cells: [number, number][] } // [칸 첨자, 0 아닌 칸 안에서 정규화한 무게]
function blendOf(fx: TsunFixture, e: number, cover: number, hf: number, phiDeg: number): Blend {
  const E = fx.header.entries[e], g = fx.header.grids, nH = g.hf.length, nP = g.phi.length;
  let w0 = 0;
  const cells: [number, number][] = [];
  for (const [ci, wc] of coverW(E, cover, g.fullCover, true)) {
    if (wc === 0) continue;
    for (const [hi, wh] of hfW(g.hf, hf)) {
      if (wh === 0) continue;
      for (const [pi, wp] of phiW(g.phi, phiDeg)) {
        if (wp === 0) continue;
        const w = wc * wh * wp;
        const k = ci < 0 || hi < 0 ? -1 : (ci * nH + hi) * nP + pi;
        if (k < 0 || !(fx.lam10[e][k] > 0)) w0 += w; else cells.push([k, w]);
      }
    }
  }
  const sw = 1 - w0;
  if (sw > 0) for (const c of cells) c[1] /= sw;
  return { w0, cells };
}

/** 명목 소광률 λ₁₀(c, hf, φ) [1/km] = (1 − w0) × 0 아닌 칸 λ₁₀ 의 기하 평균 — 빌더가 줄을 따라 Λ = ∫ λ₁₀ ds 로 쌓는 값 */
export function tsunLambda10(fx: TsunFixture, e: number, cover: number, hf: number, phiDeg: number): number {
  const b = blendOf(fx, e, cover, hf, phiDeg);
  if (!b.cells.length || b.w0 >= 1) return 0;
  let s = 0;
  for (const [k, w] of b.cells) s += w * Math.log(fx.lam10[e][k]);
  return (1 - b.w0) * Math.exp(s);
}

/**
 * 성장 곡선 G(Λ; c, hf, φ): 명목 지수 Λ → 유효 광학두께 τ. 칸마다 실효 λ = (1 − w0)·λ₁₀_칸 으로 L_칸 = Λ/λ 를 정하고
 * τ = (1 − w0)·[exp(Σ w ln(τ_칸(L_칸) + ε)) − ε]. 균일 수평선이면 Λ = λ₁₀(c, hf, φ)·L 이라 L_칸 = L·λ_기하/λ_칸.
 */
export function tsunCurveOfGrowth(fx: TsunFixture, e: number, Lambda: number, cover: number, hf: number, phiDeg: number): number {
  if (!(Lambda > 0)) return 0;
  const b = blendOf(fx, e, cover, hf, phiDeg);
  if (!b.cells.length || b.w0 >= 1) return 0;
  const E = fx.header.entries[e], nL = fx.header.grids.L.length, f = 1 - b.w0;
  let s = 0;
  for (const [k, w] of b.cells) s += w * Math.log(cellTau(fx, E.tauOffset + k * nL, Lambda / (f * fx.lam10[e][k])) + GEO_EPS);
  return f * Math.max(0, Math.exp(s) - GEO_EPS);
}

/** 균일 운량 수평선 L km 의 법칙 τ = G(λ₁₀·L) */
export function tsunLawTau(fx: TsunFixture, e: number, Lkm: number, cover: number, hf: number, phiDeg: number): number {
  return tsunCurveOfGrowth(fx, e, tsunLambda10(fx, e, cover, hf, phiDeg) * Lkm, cover, hf, phiDeg);
}

/** 구름 안 표본의 도달 뒤 추가 광학두께 τ_c(c, hf, reach) — c·hf 는 격자 끝에서 자름(0 칸 없음), reach 선형·자름 */
export function tsunTauCond(fx: TsunFixture, e: number, cover: number, hf: number, reachKm: number): number {
  const E = fx.header.entries[e], g = fx.header.grids, nH = g.hf.length, nR = g.reach.length, s = fx.header.layout.tauC.scale;
  const cw = coverW(E, cover, g.fullCover, false);
  let v = 0;
  for (const [ci, wc] of cw) for (const [hi, wh] of bracket(g.hf, hf)) for (const [ri, wr] of bracket(g.reach, reachKm)) {
    v += wc * wh * wr * fx.tauC[E.tauCOffset + (ci * nH + hi) * nR + ri] * s;
  }
  return v;
}
