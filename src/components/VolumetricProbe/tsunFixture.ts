/**
 * tsunFixture.ts — §179 WP1 T_sun 빈틈 법칙 고정표 읽기·평가(하네스 전용, 앱 경로 없음 — 2026-10-28 사용자 결정).
 *
 * 표는 tools/genus-ruler/tsun/fixture/fixture-build.mjs 가 만듭니다(tsun-fixture.json 머리말 + tsun-fixture.bin). 앱 종류 타일
 * (makeGenusWeather, 씨앗 7)을 렌더러 밀도식(종류 단면 × shape.bin 침식, mip 0)으로 다시 세워 수평선마다 무차별 적분한 것:
 *   τ_칸(L) = −ln⟨T(0, L)⟩      칸 = (항목(종류, 레인), 운량 c, 높이 비율 hf, 방위 φ), L 격자 12 점
 *   τ_x(L)                       자리 x = (c, hf, φ) 의 곡선 = 이웃 칸 τ_칸(L) 의 섞음(아래 blendOf)
 *   λ₁₀(x) = τ_x(10)/10          명목 소광률(τ_x(10) > ln 1e4 이면 τ_x(L_K) = ln 1e4 인 L_K 로 ln 1e4 / L_K — 연속)
 *   G(Λ; x) = τ_x(Λ/λ₁₀(x))       성장 곡선(curve of growth) — 빌더는 줄을 따라 Λ = ∫ λ₁₀(c(x), hf, φ) ds 를 쌓고 끝에서 τ = G(Λ)
 *   τ_c(c, hf, reach[, L[, φ]])  구름 안 표본에서 2차 행진 도달(reach) 뒤의 추가 광학두께 — 상수(방위 평균)·L 별·방위(360°)·L 별.
 *                                조건부 창은 뒤집기 대칭이 아니라(같은 선의 앞·뒤가 0.4 까지 다름) φ 는 해 쪽 방향 그대로 0~360°.
 * 사이 값은 c·hf·φ 의 다중 선형 무게(최대 8 칸)로 같은 L 에서 ε 기하 평균합니다. 칸마다 다른 λ₁₀ 로 Λ 를 나누면(처음 판) λ 규칙의 L*
 * 가 칸마다 달라질 때 곡선이 어긋나(ac c 0.98 hf 0.4: +0.7 ln) 섞은 곡선 하나에서 λ 를 다시 셉니다 [measured, 개발 diag4].
 * 경계: hf 0·1 과 c 0 은 0 칸(구름 없음), τ 의 φ 는 mod 180(τ_c 는 360), c ≥ 0.999 는 1.0 칸만(생성기 불연속), L 은 0 에서 τ = 0,
 * 마지막 격자 너머는 마지막 마디 기울기. φ 는 북에서 시계 방향의 해 쪽 선 방향, 평면 (동, 북) = 종류 타일 uv(cloudGenus 평면 틀).
 * 순수 함수(three·DOM 없음) — 시험(fixture-test.mjs)이 esbuild 로 묶어 C 무차별 적분과 맞대 봅니다(U1b·U1e).
 *
 * 싣기(§179 결정): 표는 하네스가 읽는 자산 tools/genus-ruler/tsun/fixture/tsun-fixture.{json,bin} 입니다(bin ≈ 9.8 MB — 앱 묶음에
 * import 하기엔 큼). 이 모듈은 fetch·파일 읽기를 하지 않고 (머리말, 바이트)만 받습니다 — 바이트의 sha256 을 머리말 binSha256 과 맞추는
 * 일은 부르는 쪽(하네스 run-tsun.js, node crypto)이 하고, 여기서는 길이만 확인합니다.
 */

export interface TsunFixtureEntry {
  genus: string;
  lane: number;
  covers: number[];
  /** 항목의 hf 격자(기본 grids.hf + 덧붙인 마디). 없으면 grids.hf */
  hf?: number[];
  tauOffset: number;
  tauCOffset: number;
  tauCPhiOffset: number;
  profile: { densityScale: number; [k: string]: number };
}
export interface TsunFixtureHeader {
  name: string;
  version: number;
  grids: { L: number[]; reach: number[]; hf: number[]; phi: number[]; phi360: number[]; covers: number[]; condL: number[]; fullCover: number };
  layout: {
    tau: { offsetBytes: number; count: number; scale: number };
    tauC: { offsetBytes: number; count: number; scale: number };
    tauCL: { offsetBytes: number; count: number; scale: number };
    tauCPhi: { offsetBytes: number; count: number; scale: number; offset: number };
  };
  entries: TsunFixtureEntry[];
  binSha256: string;
  binBytes: number;
  [k: string]: unknown;
}
export interface TsunFixture {
  header: TsunFixtureHeader;
  tau: Uint16Array;
  tauC: Int16Array;
  /** τ_c 의 L 별 표 [entry][cover][hf][reach][condL] */
  tauCL: Int16Array;
  /** τ_c 의 방위(360°)·도달·L 별 표 [entry][cover][hf][phi360][reach][condL] (uint8: offset + scale·b) */
  tauCPhi: Uint8Array;
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
  const tauCL = new Int16Array(buf, header.layout.tauCL.offsetBytes, header.layout.tauCL.count);
  const tauCPhi = new Uint8Array(buf, header.layout.tauCPhi.offsetBytes, header.layout.tauCPhi.count);
  const { L, phi } = header.grids;
  const nL = L.length, nP = phi.length;
  const lam10 = header.entries.map(E => {
    const out = new Float32Array(E.covers.length * (E.hf ?? header.grids.hf).length * nP);
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
  return { header, tau, tauC, tauCL, tauCPhi, lam10 };
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
/** 원형 격자(주기 period) 무게 — τ 는 180, τ_c 는 360 */
function phiW(grid: number[], phiDeg: number, period = 180): W {
  const p = ((phiDeg % period) + period) % period, n = grid.length;
  if (p >= grid[n - 1] || p < grid[0]) {
    const span = grid[0] + period - grid[n - 1], x = p >= grid[n - 1] ? p - grid[n - 1] : p + period - grid[n - 1];
    const t = x / span;
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
 * 이웃 칸(최대 8)을 돌며 0 칸(hf 끝·c 0·구름 없는 칸)의 무게 w0 를 따로 셉니다. 섞기는 0 이 아닌 칸끼리 같은 L 에서 ε 기하 평균
 * (log(τ + ε) 선형) 뒤 (1 − w0) 배: 개발 측정에서 τ 는 hf·c 에 대해 지수에 가깝게 변해(ac hf 0.3 → 0.4 에서 τ(10 km) 2.2 → 5.3)
 * τ 선형은 과대(+0.5 ln), T 선형은 과소였고 기하 평균이 무차별 값에 가장 가까웠습니다 [measured, fixture-test 개발 diag2].
 * ε = 0.01 은 τ → 0 근처에서 선형으로 넘어가게 합니다.
 */
const GEO_EPS = 0.01;
interface Blend { w0: number; cells: [number, number][] } // [칸 첨자, 0 아닌 칸 안에서 정규화한 무게]
function blendOf(fx: TsunFixture, e: number, cover: number, hf: number, phiDeg: number): Blend {
  const E = fx.header.entries[e], g = fx.header.grids, hfG = E.hf ?? g.hf, nH = hfG.length, nP = g.phi.length;
  let w0 = 0;
  const cells: [number, number][] = [];
  for (const [ci, wc] of coverW(E, cover, g.fullCover, true)) {
    if (wc === 0) continue;
    for (const [hi, wh] of hfW(hfG, hf)) {
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
function blendTau(fx: TsunFixture, e: number, b: Blend, Lkm: number): number {
  if (!b.cells.length || b.w0 >= 1 || !(Lkm > 0)) return 0;
  const base = fx.header.entries[e].tauOffset, nL = fx.header.grids.L.length;
  let s = 0;
  for (const [k, w] of b.cells) s += w * Math.log(cellTau(fx, base + k * nL, Lkm) + GEO_EPS);
  return (1 - b.w0) * Math.max(0, Math.exp(s) - GEO_EPS);
}
/** 섞은 곡선에서 λ₁₀ 규칙(연속형): τ(10) ≤ K 면 τ(10)/10, 아니면 τ(L_K) = K 인 L_K 로 K/L_K (K = ln 1e4) */
function blendLambda(fx: TsunFixture, e: number, b: Blend): number {
  const t10 = blendTau(fx, e, b, LAM_L_MAX);
  if (!(t10 > 0)) return 0;
  if (t10 <= LAM_TAU_OK) return t10 / LAM_L_MAX;
  let lo = 0, hi = LAM_L_MAX;
  for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (blendTau(fx, e, b, m) > LAM_TAU_OK) hi = m; else lo = m; }
  return LAM_TAU_OK / Math.max(hi, 1e-6);
}

/** 균일 운량 수평선 L km 의 법칙 τ_x(L) — 칸 곡선의 같은 L 에서의 섞음(위 규칙). */
export function tsunLawTau(fx: TsunFixture, e: number, Lkm: number, cover: number, hf: number, phiDeg: number): number {
  return blendTau(fx, e, blendOf(fx, e, cover, hf, phiDeg), Lkm);
}

/** 명목 소광률 λ₁₀(c, hf, φ) [1/km] — 빌더가 줄을 따라 Λ = ∫ λ₁₀ ds 로 쌓는 값(섞은 곡선에서 연속 규칙) */
export function tsunLambda10(fx: TsunFixture, e: number, cover: number, hf: number, phiDeg: number): number {
  return blendLambda(fx, e, blendOf(fx, e, cover, hf, phiDeg));
}

/**
 * 성장 곡선 G(Λ; c, hf, φ) = τ_x(Λ/λ_x): 명목 지수 Λ → 유효 광학두께 τ. 빌더는 줄 끝 자리의 (c, hf, φ)로 부릅니다.
 * 균일 수평선이면 Λ = λ_x·L 이라 정확히 tsunLawTau 와 같습니다(같은 곡선) — 다른 운량이 섞인 줄은 Λ 로 "같은 명목 지수의 등가 길이"를 씀.
 */
export function tsunCurveOfGrowth(fx: TsunFixture, e: number, Lambda: number, cover: number, hf: number, phiDeg: number): number {
  if (!(Lambda > 0)) return 0;
  const b = blendOf(fx, e, cover, hf, phiDeg);
  const lam = blendLambda(fx, e, b);
  return lam > 0 ? blendTau(fx, e, b, Lambda / lam) : 0;
}

/**
 * 구름 안 표본의 도달 뒤 추가 광학두께 τ_c(c, hf, reach[, L[, φ]]) — c·hf 는 격자 끝에서 자름(0 칸 없음), reach 선형·자름.
 *  - Lkm 없음: 설계의 상수(방위 평균, L 2~10 km 의 minimax) — 셰이더 균일 변수 표 형태(design v2.1 §4.3).
 *  - Lkm 있음: 방위 평균 L 별 표(condL 사이 선형, L < 2 km 는 0 에서 선형, L > 10 km 는 10 km 값).
 *  - Lkm·phiDeg 있음: 방위(360°, 해 쪽 선 방향)·L 별 표 — 빌더가 해 방위로 읽음.
 */
export function tsunTauCond(fx: TsunFixture, e: number, cover: number, hf: number, reachKm: number, Lkm?: number, phiDeg?: number): number {
  const E = fx.header.entries[e], g = fx.header.grids, hfG = E.hf ?? g.hf, nH = hfG.length, nR = g.reach.length, s = fx.header.layout.tauC.scale;
  const cw = coverW(E, cover, g.fullCover, false);
  const CL = g.condL, nCL = CL.length;
  const ramp = (): [W, number] => (Lkm! < CL[0] ? [[[0, 1]], Math.max(0, Lkm!) / CL[0]] : [bracket(CL, Lkm!), 1]);
  let v = 0;
  if (Lkm !== undefined && phiDeg !== undefined) {
    const nP2 = g.phi360.length, sp = fx.header.layout.tauCPhi.scale, so = fx.header.layout.tauCPhi.offset;
    const [lw, rmp] = ramp();
    for (const [ci, wc] of cw) for (const [hi, wh] of bracket(hfG, hf)) for (const [pi, wp] of phiW(g.phi360, phiDeg, 360))
      for (const [ri, wr] of bracket(g.reach, reachKm)) for (const [li, wl] of lw) {
        v += wc * wh * wp * wr * wl * (so + fx.tauCPhi[E.tauCPhiOffset + (((ci * nH + hi) * nP2 + pi) * nR + ri) * nCL + li] * sp);
      }
    return v * rmp;
  }
  const [lw, rmp] = Lkm !== undefined ? ramp() : [null, 1];
  for (const [ci, wc] of cw) for (const [hi, wh] of bracket(hfG, hf)) for (const [ri, wr] of bracket(g.reach, reachKm)) {
    const k = E.tauCOffset + (ci * nH + hi) * nR + ri;
    if (!lw) { v += wc * wh * wr * fx.tauC[k] * s; continue; }
    for (const [li, wl] of lw) v += wc * wh * wr * wl * fx.tauCL[k * nCL + li] * s;
  }
  return v * rmp;
}
