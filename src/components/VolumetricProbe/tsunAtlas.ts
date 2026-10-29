/**
 * tsunAtlas.ts — §179 WP2 T_sun 아틀라스 구축기(LP3) — **하네스 전용, 기본 끔**(2026-10-28 사용자 결정: 앱 길·스케줄러(WP3)·GPU 구축(WP2b) 없음).
 *
 * 설계: scratchpad `tsun2/design-v2.md` §4.3·§6.1·§8(WP2) 를 `design-v2.1.md` §4.4·§8 이 고친 것. 시제품 `tsun2/builder/tsun-lp2.cjs`(LP3)·
 * `tsun2/v21/bld/`(레인·조각 일반화)를 옮겨, 적분하는 양을 디스크 빈틈 법칙 κ 에서 WP1 고정표(tsunFixture.ts)의 명목 소광률 λ₁₀ 과
 * 성장 곡선 G 로 바꿈. 셰이더 쪽 읽기는 cloudTsun.ts(WP4) 의 I-2·I-4 — 텍스처 배치·틀은 그 파일의 `TsunAtlas` 설명이 기준입니다.
 *
 * 무엇을 하나(텍셀마다, 레인 블록마다):
 *  - 틀: 종류 평면 틀(셰이더 getGlobeUv × genusTileM — genusOrigin 에서 동·북 km, §173 고도 보정 원점, weatherOffsetKm 포함)을 그대로 씀.
 *    줄 방향 = clouds.sunDirection 을 genusEast·genusNorth 에 투영한 단위 벡터(v2.1 eng m9). 해 광선은 3-D 에서 평행이라 평면 투영이
 *    정확히 줄과 평행 — 텍셀의 해 쪽 적분이 그 줄을 벗어나지 않음(LP3 의 전제, 근사 아님). 에포크 틀(v2.1 eng M8): 한 아틀라스 안에서 고정,
 *    하네스는 잡마다 한 번 동기로 지음(스케줄러 없음 — 에포크 재사용도 없음).
 *  - 줄마다·레인마다 운량 c(x) 를 dq 간격으로 한 번 읽어, 높이 칸 j(K 개, 해 < 0° 면 16)마다 λ 의 선형 맞춤 A_j(c) + B_j(c)(hf − hf_j) 의
 *    Float64 누적합 넷(A·B·Bq·Bq²)과 운량 무게용 Σ A_j(c)·c 를 쌓음. 광선 조각(구면 레인·높이 칸 구간, 닫힌 꼴)마다 hf(q) 를 세 점 2차식으로
 *    맞춰 Λ = ∫ λ ds 를 누적합 차 몇 개로 셈(시제품 LP3 와 같은 수식).
 *  - 성장 곡선(v2.1 §4.4): 레인마다 **이어진 구간**(한 단조 구간 안의 레인 높이 띠 — 근지점이 레인 안이면 두 구간을 이음)의 Λ 를 모아
 *    τ = G(Λ; c_eff, hf_eff, φ). c_eff·hf_eff 는 Λ 무게 평균([decision] — 설계는 "줄 끝 자리"라고만 함; 줄이 hf·c 를 가로지르므로 무게 평균이
 *    덜 자의적). 떨어진 구간(해 아래 지평 쪽으로 내려갔다 올라오는 선의 두 번째 통과)은 상관이 없어 따로 G 후 합(Beer).
 *  - 해 블록 네 조각 hf 0.02/0.35/0.68/1.0(A = 꼭대기 = T_top), 거리 rangeKm(옵션, 400 — v2 §4.1 D16: 500 아님), 땅에 닿으면 거기서 끊고
 *    지구 그림자 표시(earthShadow 비트 — 셰이더는 sunIrradiance = 0 이라 읽지 않음, 값은 땅까지의 τ 로 연속).
 *  - 아치 블록(archLight): 층 밑(hf 0)·꼭대기(hf 1)에서 고도 −f_g·dip(h)(f = GL2 (3 ∓ √3)/6, cloudTsun D9) × 줄 방향(그 자리 접평면) 두 광선,
 *    (τ_own,1 · τ_rest,1 · τ_own,2 · τ_rest,2): own = 자기 레인 D_L 안(G(Λ_near)), rest = 나머지 모두(자기 레인 첫 구간의 G(Λ) − own + 다른 구간·레인).
 *    아치 광선의 평면 투영은 줄에서 옆으로 조금 흐름 — LP3 는 무시(U2d 가 잼, 설계 v2 §6.1 "≤ 0.021").
 *  - 운량장: 거시 격자(macroShader — RGBA8 두 장 A·B 를 mix, 선형 필터·가장자리 고정)를 셰이더와 같은 식으로 읽고 c = min(C, 타일 운량)
 *    (C ≥ 타일 운량이면 문턱 0 = 타일 그대로). 격자 밖(±extent/2 너머)은 **부채꼴 평균**(바깥 30 km 고리 × 해 방위 ±20°, 결코 1.0 아님 — v2 §6.1
 *    가장자리 규칙). 거시 격자가 없으면 레인 운량 그대로(v2.1 eng m11 스칼라 길).
 *  - τ_c 표(gTsunCond[9], v2.1 §4.3): hf 0.1/0.5/0.9 × 도달 0.25/0.5/1.1 km × 레인 — WP1 의 방위(360°)·L 별 표를 구축 시 해 방위로 읽고
 *    (WP1 열린 문제: 방위 평균 상수형은 U1e 334/2146 실패), L = 관측점 국소 해에서 그 hf 부터의 층 안 경로 u_true(셰이더에 L 축이 없어
 *    구축 쪽에서 고름 — [decision]), 운량 = 운량 무게 평균 c(Σc²/Σc, 아틀라스 원판 안).
 *
 * 결정(설계가 모호하거나 틀렸다고 본 것 — 요약에도 적음):
 *  (A1) G 의 (c, hf) 는 구간의 Λ 무게 평균: c_eff = Σ A_j(c)·c / Σ A_j(c)(칸 평균 몫만 — 처음 판은 분모에 B 항이 든 Λ 를 써서 hf 기울기가
 *       큰 ac 에서 c_eff 가 0.948·1.0(가득 칸!)으로 튀었음 [measured, RA1 +4°]), hf_eff = Σ λ·hf / Λ(조각마다 심프슨 평균, A·B 는 조각 안 고르게).
 *  (A2) 고정표 법칙은 (c, hf) 마디 표로 미리 셈: 마디 = 고정표 운량·hf 격자 ∪ 1/32 간격, 마디마다 평가기(tsunFixture.ts)와 같은 섞음으로
 *       τ_마디(L_k)(L 격자 12 점)·λ₁₀_마디. 사이 (c, hf)는 같은 L 에서 기하 섞음(평가기와 같은 규칙, 0 칸 무게 따로), λ 는 선형 섞음 —
 *       평가기의 λ(섞은 곡선에서 다시 셈)와 조금 다르지만 같은 λ 를 적분과 G 에 함께 써서 균일선에서 G(λL) = τ(L) 은 그대로 [U2 law 보고].
 *  (A3) 운량축 c 의 1/256 격자는 c = 1.0(생성기 불연속, fullCover 0.999) 칸과 255/256 칸 사이를 선형으로 이음(0.004 폭 번짐) — 기록.
 *  (A4) 아치 D_L(종류별 타일 길이 중앙값, WP1 이 내지 않음 — v2.1 이 WP1 에서 뺌): sc 1.12 · ac 0.94 km [from doc, archk P1B] · 그 밖 1.0 km [estimate].
 *  (A5) 고정표에 없는 종류(레인)는 법칙이 없어 그 레인은 τ 에 0 을 더하고 블록 −1(그 레인 표본은 오늘 빛) — meta.warnings 에 남김.
 *       종류 층이 아닌 레인(genus 없음)도 같음. 층 밀도(densityScale)가 고정표 단면과 다르면(physics·debugDensityMul 등) 경고만.
 *  (A6) halfKm = maxRayKm + 4(v2 §4.3). maxRayKm 이 없으면(takram 기본 거리) 400 km 로 자르고 경고.
 *  (A7) 높이 칸 K: 설계의 "해 < 0° 면 16" 을 "아틀라스 어느 텍셀의 국소 해라도 < 0°" 로(tsunKFor) — 관측점 해 +1.33° 아래(반폭 104 km)면 16.
 *
 * 순수 계산(THREE 는 makeTsunAtlas 의 DataTexture 만). 시험: tools/shader-preview/verify-tsun-atlas.js(U2a~U2g, 브라우저 없음).
 */
import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat } from 'three';
import { ARCH_GL2, TSUN_COND_HF, TSUN_COND_REACH_KM, TSUN_SLICE_HF, type TsunAtlas } from './cloudTsun';
import { tsunFixtureEntry, tsunTauCond, type TsunFixture } from './tsunFixture';

export const TSUN_ATLAS_MARK = '§179';
/** 구축기 판(meta.builder) — 수식·격자가 바뀌면 올립니다. */
export const TSUN_ATLAS_BUILDER = 'LP3-fixture-v1';
/** LP3 설정 [from doc: 설계 v2 §6.1 K 8 (해 < 0° 16) · 시제품 dq 1 km · nc 256 · 칸 안 표본 16] — 이 단계에서 손잡이로 열지 않음. */
export const TSUN_LP3 = { K: 8, Klow: 16, dqKm: 1, nc: 256, fitSub: 16, clampTau: 60 } as const;
/** 가장자리 규칙(설계 v2 §6.1 시제품 edgeCover): 바깥 30 km 고리 × 해 방위 ±20° 의 평균 운량. */
export const TSUN_EDGE_ANNULUS_KM = 30;
export const TSUN_EDGE_SECTOR_DEG = 20;
/** 아치 자기 레인 길이 D_L(km) — 결정 A4. */
export const TSUN_ARCH_DL_KM: Readonly<Record<string, number>> = { sc: 1.12, ac: 0.94 };
export const TSUN_ARCH_DL_DEFAULT_KM = 1.0;

export type Vec3 = [number, number, number];

// ───── 입력 ─────
/** 거시 운량 격자 한 레인(셰이더 genusMacroCoverAt 이 읽는 것 그대로). */
export interface TsunMacroLaneInput {
  /** 격자 한 변 칸 수(macroN) · 덮는 폭(km, 768). */
  n: number;
  extentKm: number;
  /** RGBA8 바이트(행 = 북쪽으로 증가, flipY 없음 — macroShader.makeMacroTexture). B 가 없으면 A 만. */
  dataA: ArrayLike<number>;
  dataB: ArrayLike<number> | null;
  /** genusMacroMix(0~1). */
  mix: number;
  /** 이 레인의 채널(R 저 · G 중 · B 상 · A = 1 → 타일 그대로). */
  channel: 0 | 1 | 2 | 3;
  /** 거시 격자 이류(km) — genusMacroDriftU/V 의 이 레인 성분. */
  driftKm: [number, number];
}
export interface TsunLaneInput {
  genus: string;
  /** 타일 운량 = makeGenusWeather 입력(genusCoverIn 뒤) — 고정표 운량축과 같은 값(tsunFixture.ts 머리말). */
  tileCover: number;
  /** 층 밑·꼭대기(km, 구 R_b 위 — 셰이더 minLayerHeights·maxLayerHeights). */
  baseKm: number;
  topKm: number;
  macro: TsunMacroLaneInput | null;
  /** 기록·경고용(셰이더 densityScales). */
  densityScale?: number;
}
/** 종류 평면 틀(셰이더 genusOrigin·genusEast·genusNorth·genusTileM, 고도 보정 공간 ECEF m). */
export interface TsunFrameInput { originM: Vec3; eastM: Vec3; northM: Vec3; tileM: number }
export interface TsunBuildInput {
  frame: TsunFrameInput;
  /** 아틀라스 중심(종류 평면 km) — 관측점. */
  centerKm: [number, number];
  /** clouds.sunDirection(ECEF, 단위). */
  sunDir: Vec3;
  /** takram bottom_radius(km, 6360). */
  bottomRadiusKm: number;
  /** 한 블록 텍셀 수(tsunN) · 반폭 km · 적분 끝 km(tsunRangeKm) · 아치 블록. */
  n: number;
  halfKm: number;
  rangeKm: number;
  arch: boolean;
  /** 레인 0~3(없으면 null). */
  lanes: (TsunLaneInput | null)[];
  /** 기록용. */
  warnings?: string[];
}

// ───── 법칙(레인마다) ─────
export interface TsunLaneLaw {
  label: string;
  /** 명목 소광률 λ(c, hf) [1/km] — 줄을 따라 Λ = ∫ λ ds. */
  lambda(c: number, hf: number): number;
  /** 성장 곡선 τ = G(Λ; c, hf). */
  G(Lambda: number, c: number, hf: number): number;
  /** 구름 안 표본의 도달 뒤 추가 τ_c(c, hf, reach, L). */
  tauCond(c: number, hf: number, reachKm: number, Lkm: number): number;
  /** 아치 D_L(km). */
  dlKm: number;
  /** 고정표 단면 밀도(경고용). */
  densityScale?: number;
}

/** 시험용 균일 법칙: λ 상수, G = 항등(Beer), τ_c 0 — U2b·U2c. */
export function tsunUniformLaw(lam: number, dlKm = TSUN_ARCH_DL_DEFAULT_KM): TsunLaneLaw {
  return { label: `uniform λ=${lam}`, lambda: () => lam, G: L => (L > 0 ? L : 0), tauCond: () => 0, dlKm };
}

// ─── 고정표 평가기의 섞음 규칙(tsunFixture.ts 와 같은 식 — 그 파일은 내부 함수를 내보내지 않아 옮김; 시험이 마디에서 1e-12 로 대조) ───
type FW = [number, number][];
function fxBracket(grid: ArrayLike<number>, x: number): FW {
  const n = grid.length;
  if (x <= grid[0]) return [[0, 1]];
  if (x >= grid[n - 1]) return [[n - 1, 1]];
  let i = 0;
  while (grid[i + 1] < x) i++;
  const t = (x - grid[i]) / (grid[i + 1] - grid[i]);
  return t === 0 ? [[i, 1]] : [[i, 1 - t], [i + 1, t]];
}
function fxCoverW(covers: number[], c: number, full: number, zeroCell: boolean): FW {
  if (covers.length === 1) return [[0, 1]];
  if (c >= full) { const i = covers.findIndex(x => x >= full); return [[i >= 0 ? i : covers.length - 1, 1]]; }
  const below = covers.filter(x => x < full);
  if (!(c > 0)) return zeroCell ? [[-1, 1]] : [[0, 1]];
  if (c < below[0]) return zeroCell ? [[-1, 1 - c / below[0]], [0, c / below[0]]] : [[0, 1]];
  return fxBracket(below, c);
}
function fxHfW(grid: number[], h: number): FW {
  if (!(h > 0) || !(h < 1)) return [[-1, 1]];
  const ext = [0, ...grid, 1];
  return fxBracket(ext, h).map(([i, w]) => [i === 0 || i === ext.length - 1 ? -1 : i - 1, w] as [number, number]);
}
function fxPhiW(grid: number[], phiDeg: number, period: number): FW {
  const p = ((phiDeg % period) + period) % period, n = grid.length;
  if (p >= grid[n - 1] || p < grid[0]) {
    const span = grid[0] + period - grid[n - 1], x = p >= grid[n - 1] ? p - grid[n - 1] : p + period - grid[n - 1];
    const t = x / span;
    return [[n - 1, 1 - t], [0, t]];
  }
  return fxBracket(grid, p);
}
const FX_GEO_EPS = 0.01;
const FX_LAM_TAU_OK = Math.log(1e4);
const FX_LAM_L_MAX = 10;
function fxCellTau(fx: TsunFixture, base: number, Lkm: number): number {
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
interface FxBlend { w0: number; cells: [number, number][] }
function fxBlendOf(fx: TsunFixture, e: number, cover: number, hf: number, phiDeg: number): FxBlend {
  const E = fx.header.entries[e], g = fx.header.grids, hfG = E.hf ?? g.hf, nH = hfG.length, nP = g.phi.length;
  let w0 = 0;
  const cells: [number, number][] = [];
  for (const [ci, wc] of fxCoverW(E.covers, cover, g.fullCover, true)) {
    if (wc === 0) continue;
    for (const [hi, wh] of fxHfW(hfG, hf)) {
      if (wh === 0) continue;
      for (const [pi, wp] of fxPhiW(g.phi, phiDeg, 180)) {
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
function fxBlendTau(fx: TsunFixture, e: number, b: FxBlend, Lkm: number): number {
  if (!b.cells.length || b.w0 >= 1 || !(Lkm > 0)) return 0;
  const base = fx.header.entries[e].tauOffset, nL = fx.header.grids.L.length;
  let s = 0;
  for (const [k, w] of b.cells) s += w * Math.log(fxCellTau(fx, base + k * nL, Lkm) + FX_GEO_EPS);
  return (1 - b.w0) * Math.max(0, Math.exp(s) - FX_GEO_EPS);
}
function fxBlendLambda(fx: TsunFixture, e: number, b: FxBlend): number {
  const t10 = fxBlendTau(fx, e, b, FX_LAM_L_MAX);
  if (!(t10 > 0)) return 0;
  if (t10 <= FX_LAM_TAU_OK) return t10 / FX_LAM_L_MAX;
  let lo = 0, hi = FX_LAM_L_MAX;
  for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (fxBlendTau(fx, e, b, m) > FX_LAM_TAU_OK) hi = m; else lo = m; }
  return FX_LAM_TAU_OK / Math.max(hi, 1e-6);
}
/** 시험용: 평가기와 같은 규칙의 마디 값(λ₁₀, τ(L)) — verify-tsun-atlas 가 tsunLambda10·tsunLawTau 와 대조. */
export function tsunFixtureNodeValues(fx: TsunFixture, e: number, cover: number, hf: number, phiDeg: number, Lkm: number): { lam: number; tau: number } {
  const b = fxBlendOf(fx, e, cover, hf, phiDeg);
  return { lam: fxBlendLambda(fx, e, b), tau: fxBlendTau(fx, e, b, Lkm) };
}

const uniqSorted = (xs: number[]) => [...new Set(xs.map(x => +x.toFixed(9)))].sort((a, b) => a - b);
/** 정렬된 격자에서 x 를 감싸는 [i, t] (끝에서 고정). */
function locate(grid: Float64Array | number[], x: number): [number, number] {
  const n = grid.length;
  if (x <= grid[0]) return [0, 0];
  if (x >= grid[n - 1]) return [n - 2, 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (grid[m] <= x) lo = m; else hi = m; }
  return [lo, (x - grid[lo]) / (grid[lo + 1] - grid[lo])];
}

/**
 * 고정표 → 레인 법칙(결정 A2). φ = 해 쪽 선 방향(북에서 시계, 종류 평면). 마디 표: 행 = c 마디(0 = 0 칸, 고정표 운량 < fullCover ∪ 1/32 간격),
 * 별도 한 행 = c ≥ fullCover(생성기 불연속 위), 열 = hf 마디(0·1 = 0 칸). 마디마다 τ(L_k)·λ₁₀ 를 평가기 규칙 그대로.
 */
export function tsunFixtureLaw(fx: TsunFixture, e: number, phiDeg: number, dlKm: number): TsunLaneLaw {
  const E = fx.header.entries[e], g = fx.header.grids, Lg = g.L, nL = Lg.length, full = g.fullCover;
  const hfE = E.hf ?? g.hf;
  const single = E.covers.length === 1;
  const below = E.covers.filter(x => x < full);
  const cMax = single ? 0 : below[below.length - 1];
  const step32 = Array.from({ length: 31 }, (_, k) => (k + 1) / 32);
  const cNodes = Float64Array.from(single ? [E.covers[0]] : uniqSorted([0, ...below, ...step32.filter(x => x < cMax)]));
  const hNodes = Float64Array.from(uniqSorted([0, ...hfE, ...step32, 1]));
  const nc = cNodes.length, nh = hNodes.length, rows = nc + 1;   // 마지막 행 = 가득(c ≥ fullCover)
  const lam = new Float64Array(rows * nh), logT = new Float64Array(rows * nh * nL), tauEnd = new Float64Array(rows * nh * 2);
  for (let r = 0; r < rows; r++) {
    const c = r < nc ? cNodes[r] : 1.0;
    for (let h = 0; h < nh; h++) {
      const o = r * nh + h;
      const b = fxBlendOf(fx, e, single ? E.covers[0] : c, hNodes[h], phiDeg);
      lam[o] = fxBlendLambda(fx, e, b);
      for (let l = 0; l < nL; l++) logT[o * nL + l] = Math.log(fxBlendTau(fx, e, b, Lg[l]) + FX_GEO_EPS);
      tauEnd[o * 2] = fxBlendTau(fx, e, b, Lg[nL - 2]); tauEnd[o * 2 + 1] = fxBlendTau(fx, e, b, Lg[nL - 1]);
    }
  }
  const Lf = Float64Array.from(Lg);
  // 마디 곡선 τ_o(L): L 격자 사이 선형(τ 공간), L < L₀ 는 0 에서 선형, 끝 너머는 마지막 마디 기울기(평가기 cellTau 와 같은 꼴)
  const nodeTau = (o: number, Lkm: number, li: number, lt: number): number => {
    if (Lkm <= Lf[0]) return (Math.exp(logT[o * nL]) - FX_GEO_EPS) * Lkm / Lf[0];
    if (Lkm >= Lf[nL - 1]) {
      const a = tauEnd[o * 2], b = tauEnd[o * 2 + 1];
      return b + (Math.max(0, b - a) * (Lkm - Lf[nL - 1])) / (Lf[nL - 1] - Lf[nL - 2]);
    }
    const a = Math.exp(logT[o * nL + li]) - FX_GEO_EPS, b = Math.exp(logT[o * nL + li + 1]) - FX_GEO_EPS;
    return a + (b - a) * lt;
  };
  // (c, hf) → 마디 넷과 무게(0 칸 포함). 결과를 재사용 버퍼에.
  const nodeIdx = new Int32Array(4), nodeW = new Float64Array(4);
  const weights = (c: number, hf: number): number => {
    if (!(hf > 0 && hf < 1)) return 0;
    const [hi, ht] = locate(hNodes, hf);
    let r0: number, r1: number, ct: number;
    if (single) { r0 = 0; r1 = 0; ct = 0; }
    else if (c >= full) { r0 = nc; r1 = nc; ct = 0; }
    else { const [ci, t] = locate(cNodes, Math.min(Math.max(c, 0), cMax)); r0 = ci; r1 = ci + 1; ct = t; }
    nodeIdx[0] = r0 * nh + hi; nodeW[0] = (1 - ct) * (1 - ht);
    nodeIdx[1] = r0 * nh + hi + 1; nodeW[1] = (1 - ct) * ht;
    nodeIdx[2] = r1 * nh + hi; nodeW[2] = ct * (1 - ht);
    nodeIdx[3] = r1 * nh + hi + 1; nodeW[3] = ct * ht;
    return 4;
  };
  const lambdaAt = (c: number, hf: number): number => {
    if (!weights(c, hf)) return 0;
    let s = 0;
    for (let k = 0; k < 4; k++) s += nodeW[k] * lam[nodeIdx[k]];
    return s;
  };
  const tauAt = (c: number, hf: number, Lkm: number): number => {
    if (!(Lkm > 0) || !weights(c, hf)) return 0;
    const [li, lt] = locate(Lf, Lkm);
    let w0 = 0, sw = 0, s = 0;
    for (let k = 0; k < 4; k++) {
      const w = nodeW[k];
      if (w === 0) continue;
      const o = nodeIdx[k];
      if (!(lam[o] > 0)) { w0 += w; continue; }
      s += w * Math.log(Math.max(0, nodeTau(o, Lkm, li, lt)) + FX_GEO_EPS); sw += w;
    }
    if (!(sw > 0)) return 0;
    return (1 - w0) * Math.max(0, Math.exp(s / sw) - FX_GEO_EPS);
  };
  return {
    label: `fixture ${E.genus}@${E.lane} φ ${phiDeg.toFixed(3)}°`,
    lambda: lambdaAt,
    G: (Lambda, c, hf) => {
      if (!(Lambda > 0)) return 0;
      const l = lambdaAt(c, hf);
      return l > 0 ? tauAt(c, hf, Lambda / l) : 0;
    },
    tauCond: (c, hf, reachKm, Lkm) => tsunTauCond(fx, e, c, hf, reachKm, Lkm, phiDeg),
    dlKm,
    densityScale: E.profile?.densityScale,
  };
}

/** 고정표에서 장면 레인마다 법칙(없는 종류는 null — 결정 A5). */
export function tsunLawsFromFixture(fx: TsunFixture, input: TsunBuildInput): { laws: (TsunLaneLaw | null)[]; warnings: string[]; entries: number[] } {
  const g = tsunFrameGeom(input);
  const warnings: string[] = [];
  const entries: number[] = [];
  const laws = input.lanes.slice(0, 4).map((L, i) => {
    entries[i] = -1;
    if (!L) return null;
    const e = tsunFixtureEntry(fx, L.genus, i);
    entries[i] = e;
    if (e < 0) { warnings.push(`lane ${i} genus ${L.genus}: no fixture entry — lane contributes 0, block −1`); return null; }
    const E = fx.header.entries[e];
    if (E.lane !== i) warnings.push(`lane ${i} genus ${L.genus}: fixture entry ${E.genus}@${E.lane} used (other tile realisation)`);
    if (L.densityScale != null && E.profile && Math.abs(L.densityScale - E.profile.densityScale) > 1e-6 * Math.max(1, E.profile.densityScale)) {
      warnings.push(`lane ${i} genus ${L.genus}: layer densityScale ${L.densityScale} != fixture profile ${E.profile.densityScale} (law not rescaled)`);
    }
    return tsunFixtureLaw(fx, e, g.phiDeg, TSUN_ARCH_DL_KM[L.genus] ?? TSUN_ARCH_DL_DEFAULT_KM);
  });
  while (laws.length < 4) { laws.push(null); entries.push(-1); }
  return { laws, warnings, entries };
}

// ───── 틀·기하 ─────
const dot3 = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: ArrayLike<number>): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * 국소 직교 틀: 구 중심 = 원점, 축 (E, N, U) — 종류 평면 좌표 (x, y) = ((P − O)·E, (P − O)·N) 이 셰이더 getGlobeUv × tileM 과 같음.
 * O_loc = 원점을 이 축에 투영(km). sun = 해 방향을 같은 축에. a = 줄 방향(해 방위, 평면), φ = 북에서 시계(°).
 */
export interface TsunFrameGeom { R: number; E: Vec3; N: Vec3; U: Vec3; O: Vec3; sun: Vec3; a: [number, number]; phiDeg: number; sunElCenterDeg: number; orthoErr: number }
export function tsunFrameGeom(input: Pick<TsunBuildInput, 'frame' | 'sunDir' | 'bottomRadiusKm' | 'centerKm'>): TsunFrameGeom {
  const E = norm3(input.frame.eastM), N = norm3(input.frame.northM);
  let U = norm3(cross3(E, N));
  const Okm = [input.frame.originM[0] / 1000, input.frame.originM[1] / 1000, input.frame.originM[2] / 1000];
  if (dot3(Okm, U) < 0) U = [-U[0], -U[1], -U[2]];
  const O: Vec3 = [dot3(Okm, E), dot3(Okm, N), dot3(Okm, U)];
  const s = norm3(input.sunDir);
  const sun: Vec3 = [dot3(s, E), dot3(s, N), dot3(s, U)];
  const hz = Math.hypot(sun[0], sun[1]);
  if (!(hz > 1e-9)) throw new Error('tsunAtlas: sun at the zenith of the genus frame — no row direction');
  const a: [number, number] = [sun[0] / hz, sun[1] / hz];
  const phiDeg = ((Math.atan2(a[0], a[1]) * 180) / Math.PI + 360) % 360;
  const R = input.bottomRadiusKm;
  const cx = O[0] + input.centerKm[0], cy = O[1] + input.centerKm[1];
  const cz = Math.sqrt(Math.max(0, R * R - cx * cx - cy * cy));
  const r = Math.hypot(cx, cy, cz);
  const sunElCenterDeg = (Math.asin((sun[0] * cx + sun[1] * cy + sun[2] * cz) / r) * 180) / Math.PI;
  return { R, E, N, U, O, sun, a, phiDeg, sunElCenterDeg, orthoErr: Math.abs(dot3(input.frame.eastM, input.frame.northM)) / (Math.hypot(...input.frame.eastM) * Math.hypot(...input.frame.northM)) };
}
/** ECEF(m, 고도 보정 공간) → 종류 평면 km — 셰이더 getGlobeUv(p) × genusTileM × 1e-3 과 같은 식. */
export function tsunPlanarOfEcef(frame: TsunFrameInput, pM: ArrayLike<number>): [number, number] {
  const d = [pM[0] - frame.originM[0], pM[1] - frame.originM[1], pM[2] - frame.originM[2]];
  return [dot3(d, frame.eastM) / 1000, dot3(d, frame.northM) / 1000];
}
/** 종류 평면 km + 구 위 높이 km → ECEF m(고도 보정 공간). 그 점의 평면 좌표는 정확히 (x, y). */
export function tsunEcefOfPlanar(geom: TsunFrameGeom, xKm: number, yKm: number, hKm: number): Vec3 {
  const X = geom.O[0] + xKm, Y = geom.O[1] + yKm, r = geom.R + hKm;
  const Z = Math.sqrt(Math.max(0, r * r - X * X - Y * Y));
  return [(X * geom.E[0] + Y * geom.N[0] + Z * geom.U[0]) * 1000, (X * geom.E[1] + Y * geom.N[1] + Z * geom.U[1]) * 1000, (X * geom.E[2] + Y * geom.N[2] + Z * geom.U[2]) * 1000];
}
/** 텍셀 (i 줄 방향, j 가로) 의 중심 평면 km — cloudTsun.ts TsunAtlas 설명과 같은 식. */
export function tsunTexelPlanar(a: { centerKm: [number, number]; rowAxisEN: [number, number]; halfKm: number; n: number }, i: number, j: number): [number, number] {
  const tex = (2 * a.halfKm) / a.n, u = -a.halfKm + (i + 0.5) * tex, v = -a.halfKm + (j + 0.5) * tex;
  const [ax, ay] = a.rowAxisEN;
  return [a.centerKm[0] + u * ax - v * ay, a.centerKm[1] + u * ay + v * ax];
}

// ───── 운량장 ─────
/** 레인 운량 함수 c(x, y)(평면 km) — 셰이더 genusMacroCoverAt + LUT 문턱과 같은 면적, 격자 밖은 부채꼴 평균. */
export function tsunCoverFn(L: TsunLaneInput, phiDeg: number): { at: (x: number, y: number) => number; edge: number } {
  const c0 = Math.min(1, Math.max(0, L.tileCover));
  const M = L.macro;
  if (!M) return { at: () => c0, edge: c0 };
  const n = M.n, ext = M.extentKm, ch = M.channel, A = M.dataA, B = M.dataB ?? M.dataA, mix = Math.min(1, Math.max(0, M.mix));
  const [dx, dy] = M.driftKm;
  const texel = (ix: number, iy: number) => { const o = (iy * n + ix) * 4 + ch; return (A[o] * (1 - mix) + B[o] * mix) / 255; };
  // 부채꼴 평균(격자 칸 중심, 격자 중심 기준)
  let s = 0, k = 0;
  const half = ext / 2;
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const X = ((ix + 0.5) / n - 0.5) * ext, Y = ((iy + 0.5) / n - 0.5) * ext, rr = Math.hypot(X, Y);
    if (rr < half - TSUN_EDGE_ANNULUS_KM || rr > half) continue;
    let d = ((Math.atan2(X, Y) * 180) / Math.PI - phiDeg) % 360;
    if (d > 180) d -= 360; if (d < -180) d += 360;
    if (Math.abs(d) > TSUN_EDGE_SECTOR_DEG) continue;
    s += Math.min(texel(ix, iy), c0); k++;
  }
  const edge = k ? s / k : c0;
  const at = (x: number, y: number): number => {
    const ux = (x + dx) / ext + 0.5, uy = (y + dy) / ext + 0.5;
    if (ux < 0 || ux > 1 || uy < 0 || uy > 1) return edge;
    let fx = ux * n - 0.5, fy = uy * n - 0.5;
    if (fx < 0) fx = 0; if (fy < 0) fy = 0; if (fx > n - 1) fx = n - 1; if (fy > n - 1) fy = n - 1;
    let i0 = fx | 0, j0 = fy | 0; if (i0 > n - 2) i0 = n - 2; if (j0 > n - 2) j0 = n - 2;
    const tx = fx - i0, ty = fy - j0;
    const C = (texel(i0, j0) * (1 - tx) + texel(i0 + 1, j0) * tx) * (1 - ty) + (texel(i0, j0 + 1) * (1 - tx) + texel(i0 + 1, j0 + 1) * tx) * ty;
    return C < c0 ? C : c0;
  };
  return { at, edge };
}

// ───── 셰이더 읽기의 CPU 거울(WP7 P1 대조·U2c·U2g) ─────
/** u_true — cloudTsun.ts gTsunPath 와 같은 식(f64). */
export function tsunPathKm(h0: number, sinE: number, hb: number, ht: number, D: number, Rkm: number): number {
  const b = (Rkm + h0) * sinE;
  const discT = b * b + (ht - h0) * (2 * Rkm + ht + h0);
  if (discT <= 0) return 0;
  const qT = Math.sqrt(discT);
  let len = Math.max(0, Math.min(-b + qT, D) - Math.max(-b - qT, 0));
  const discB = b * b + (hb - h0) * (2 * Rkm + hb + h0);
  if (discB > 0) { const qB = Math.sqrt(discB); len -= Math.max(0, Math.min(-b + qB, D) - Math.max(-b - qB, 0)); }
  return Math.max(len, 0);
}
/** gTsunSliceTau 의 거울. */
export function tsunSliceTauCpu(t: ArrayLike<number>, he: number, hb: number, ht: number, sinE: number, D: number, Rkm: number): number {
  const S = TSUN_SLICE_HF;
  const H = Math.max(ht - hb, 1e-3);
  const f = Math.min(1, Math.max(0, (he - hb) / H));
  const k = f < S[1] ? 0 : f < S[2] ? 1 : 2;
  const fk0 = S[k], fk1 = S[k + 1];
  const u0 = tsunPathKm(hb + fk0 * H, sinE, hb, ht, D, Rkm), u1 = tsunPathKm(hb + fk1 * H, sinE, hb, ht, D, Rkm);
  const du = u1 - u0;
  const s = Math.abs(du) < 1e-3 ? (f - fk0) / (fk1 - fk0) : (tsunPathKm(he, sinE, hb, ht, D, Rkm) - u0) / du;
  const ss = Math.min(2, Math.max(-1, s));
  return Math.max(0, t[k] + (t[k + 1] - t[k]) * ss);
}
/** gTsunCondAt 의 거울(한 레인). */
export function tsunCondAtCpu(cond: ArrayLike<number>, hf: number, reachKm: number, lane: number): number {
  const tent = (x: number, k: readonly number[]) => {
    const w0 = Math.min(1, Math.max(0, (k[1] - x) / (k[1] - k[0]))), w2 = Math.min(1, Math.max(0, (x - k[1]) / (k[2] - k[1])));
    return [w0, 1 - w0 - w2, w2];
  };
  const a = tent(hf, TSUN_COND_HF), r = tent(reachKm, TSUN_COND_REACH_KM);
  let v = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) v += a[i] * r[j] * cond[(i * 3 + j) * 4 + lane];
  return v;
}
/**
 * 아틀라스 읽기의 거울 — gTsunUvOf + 하드웨어 선형 필터(가장자리 고정, 반 텍셀 안쪽 고정). half = true 면 텍스처의 half float 값.
 * 돌려줌: RGBA 네 값.
 */
export function tsunAtlasSampleCpu(d: TsunAtlasData, xKm: number, yKm: number, blk: number, row: number, half = true): [number, number, number, number] {
  const n = d.n, tex = (2 * d.halfKm) / n, [ax, ay] = d.rowAxisEN;
  const kx = xKm - d.centerKm[0], ky = yKm - d.centerKm[1];
  let gx = (kx * ax + ky * ay + d.halfKm) / tex, gy = (-kx * ay + ky * ax + d.halfKm) / tex;
  gx = Math.min(n - 0.5, Math.max(0.5, gx)); gy = Math.min(n - 0.5, Math.max(0.5, gy));
  const fx = blk * n + gx - 0.5, fy = row * n + gy - 0.5;
  const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
  const i1 = Math.min(i0 + 1, d.width - 1), j1 = Math.min(j0 + 1, d.height - 1);
  const v = (i: number, j: number, c: number) => { const o = (j * d.width + i) * 4 + c; return half ? DataUtils.fromHalfFloat(d.half[o]) : d.tau[o]; };
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) out[c] = (v(i0, j0, c) * (1 - tx) + v(i1, j0, c) * tx) * (1 - ty) + (v(i0, j1, c) * (1 - tx) + v(i1, j1, c) * tx) * ty;
  return out;
}
/**
 * I-2 의 CPU 거울: 행진 끝 p_end(국소 틀 km 점)·레인·도달(km) → 셰이더가 sunIrradiance 에 곱할 τ(조각 보간 + τ_c). 레인 블록이 없으면 null.
 */
export function tsunShaderTauCpu(d: TsunAtlasData, geom: TsunFrameGeom, pEnd: ArrayLike<number>, lane: number, laneBaseKm: number, laneTopKm: number, reachKm: number, half = true): number | null {
  const blk = d.laneBlock[lane];
  if (blk < 0) return null;
  const x = pEnd[0] - geom.O[0], y = pEnd[1] - geom.O[1];
  const t = tsunAtlasSampleCpu(d, x, y, blk, 0, half);
  const r = Math.hypot(pEnd[0], pEnd[1], pEnd[2]), he = r - geom.R;
  const sinE = (pEnd[0] * geom.sun[0] + pEnd[1] * geom.sun[1] + pEnd[2] * geom.sun[2]) / r;
  let tau = tsunSliceTauCpu(t, he, laneBaseKm, laneTopKm, sinE, d.rangeKm, geom.R);
  const hf = (he - laneBaseKm) / Math.max(laneTopKm - laneBaseKm, 1e-3);
  const own = hf >= 0 && hf <= 1 ? 1 : 0;
  tau = Math.max(0, tau + tsunCondAtCpu(d.tauCond, Math.min(1, Math.max(0, hf)), reachKm, lane) * own);
  return tau;
}

/**
 * 높이 칸 수 K(결정 A7): 설계 v2 §8 의 "K 8 (해 < 0° 면 16)" 을 **아틀라스 어느 텍셀의 국소 해라도 0° 아래면** 으로 읽음 — 관측점 해 고도에서
 * 발자국 모서리까지의 기울기 √2·halfKm/R(°)를 뺀 값이 0 아래면 16. 중심 해 +0.3° 의 P3B 에서 K 8 은 U2a p95 0.0108(> 0.01)이었음 [measured].
 */
export function tsunKFor(sunElCenterDeg: number, halfKm: number, Rkm: number): number {
  const tilt = (Math.SQRT2 * halfKm / Rkm) * 180 / Math.PI;
  return sunElCenterDeg - tilt < 0 ? TSUN_LP3.Klow : TSUN_LP3.K;
}

// ───── LP3 핵 ─────
interface LaneCtx {
  k: number; law: TsunLaneLaw; base: number; top: number; th: number; cover: (x: number, y: number) => number; edge: number;
  A: Float64Array; B: Float64Array; P: Float64Array; cellH: Float64Array; cellR2: Float64Array;
}
/** 레인마다 높이 칸 j 의 λ 선형 맞춤 A_j(c), B_j(c) (c 격자 nc+1, 칸 안 sub 표본 최소제곱). */
function fitLane(law: TsunLaneLaw, K: number, nc: number, sub: number): { A: Float64Array; B: Float64Array } {
  const A = new Float64Array(K * (nc + 1)), B = new Float64Array(K * (nc + 1));
  for (let j = 0; j < K; j++) {
    const e0 = j / K, e1 = (j + 1) / K, mid = 0.5 * (e0 + e1);
    for (let i = 0; i <= nc; i++) {
      const c = i / nc;
      let sk = 0, sxk = 0, sxx = 0;
      for (let u = 0; u < sub; u++) {
        const hf = e0 + ((u + 0.5) / sub) * (e1 - e0), k = law.lambda(c, hf), x = hf - mid;
        sk += k; sxk += x * k; sxx += x * x;
      }
      A[j * (nc + 1) + i] = sk / sub; B[j * (nc + 1) + i] = sxx > 0 ? sxk / sxx : 0;
    }
  }
  return { A, B };
}

/**
 * 광선 추적기 — 한 줄(가로 v)의 누적합을 쌓고(buildRow), 그 줄 위 점에서 시작하는 광선의 레인별 Λ·Λc·Λhf 를 단조 구간마다 모읍니다(trace).
 * 자기 레인 D_L 나눔(아치)은 split > 0 일 때.
 */
class Lp3Tracer {
  readonly lanes: LaneCtx[];
  readonly R: number; readonly K: number; readonly dq: number; readonly invDq: number; readonly nc: number;
  readonly qMin: number; readonly Nq: number; readonly stride: number;
  readonly cx: number; readonly cy: number; readonly aE: number; readonly aN: number;
  /** 레인·단조 구간(slot = 레인·2 + 구간)마다 Λ · Σ A·c(운량 무게, A 몫만) · Σ A(c 무게의 분모) · Σ λ·hf(높이 무게). */
  readonly accL = new Float64Array(8); readonly accC = new Float64Array(8); readonly accA = new Float64Array(8); readonly accH = new Float64Array(8);
  readonly tF = new Float64Array(8); readonly tL = new Float64Array(8);
  nearL = 0; nearC = 0; nearA = 0; nearH = 0; ground = false; pieces = 0;
  private pc = 0; private pa = 0; private ph = 0;
  constructor(lanes: LaneCtx[], R: number, K: number, dq: number, nc: number, W: number, range: number, cx: number, cy: number, a: [number, number]) {
    this.lanes = lanes; this.R = R; this.K = K; this.dq = dq; this.invDq = 1 / dq; this.nc = nc;
    this.qMin = -W - 2 * dq; this.Nq = Math.ceil((W + range + 2 * dq - this.qMin) / dq); this.stride = this.Nq + 1;
    this.cx = cx; this.cy = cy; this.aE = a[0]; this.aN = a[1];
    for (const L of lanes) {
      L.P = new Float64Array(K * this.stride * 5);
      L.cellH = new Float64Array(K + 1); L.cellR2 = new Float64Array(K + 1);
      for (let j = 0; j <= K; j++) { const h = L.base + (L.th * j) / K; L.cellH[j] = h; L.cellR2[j] = (R + h) * (R + h); }
    }
  }
  /** 가로 좌표 v(km) 의 줄 누적합 — 레인마다 칸마다 (A, B, B·q, B·q², A·c). */
  buildRow(v: number): void {
    const { K, dq, nc, Nq, stride, qMin, cx, cy, aE, aN } = this;
    const invDq = this.invDq;
    for (const L of this.lanes) {
      const P = L.P, FA = L.A, FB = L.B;
      for (let j = 0; j < K; j++) { const o = j * stride * 5; P[o] = 0; P[o + 1] = 0; P[o + 2] = 0; P[o + 3] = 0; P[o + 4] = 0; }
      for (let m = 0; m < Nq; m++) {
        const q = qMin + (m + 0.5) * dq;
        const c = L.cover(cx + q * aE - v * aN, cy + q * aN + v * aE);
        let fi = c * nc; if (fi < 0) fi = 0; if (fi > nc) fi = nc;
        let i0 = fi | 0; if (i0 > nc - 1) i0 = nc - 1; const tt = fi - i0;
        const qa = m * dq, qb = qa + dq, m1 = (qb * qb - qa * qa) * 0.5 * invDq, m2 = ((qb * qb * qb - qa * qa * qa) / 3) * invDq;
        for (let j = 0; j < K; j++) {
          const o = j * (nc + 1) + i0, w = (j * stride + m) * 5;
          const av = (FA[o] + (FA[o + 1] - FA[o]) * tt) * dq, bv = (FB[o] + (FB[o + 1] - FB[o]) * tt) * dq;
          P[w + 5] = P[w] + av; P[w + 6] = P[w + 1] + bv; P[w + 7] = P[w + 2] + bv * m1; P[w + 8] = P[w + 3] + bv * m2; P[w + 9] = P[w + 4] + av * c;
        }
      }
    }
  }
  /** 조각 하나(레인 L, 칸 j, t1..t2, 끝 높이 h1·h2)의 Λ(∫λ ds). this.pc = Λc(운량 무게). */
  private piece(L: LaneCtx, j: number, t1: number, t2: number, h1: number, h2: number, r0sq: number, b: number, q0: number, dqdt: number): number {
    const R = this.R, invDq = this.invDq, dq = this.dq, Nq = this.Nq, stride = this.stride, qMin = this.qMin, P = L.P;
    const tm = 0.5 * (t1 + t2), hm = Math.sqrt(r0sq + 2 * b * tm + tm * tm) - R;
    const ith = 1 / L.th, f1 = (h1 - L.base) * ith, fm = (hm - L.base) * ith, f2 = (h2 - L.base) * ith;
    const ql1 = q0 + t1 * dqdt - qMin, ql2 = q0 + t2 * dqdt - qMin, qlm = 0.5 * (ql1 + ql2);
    const D = ql2 - ql1;
    // 1 mm 보다 짧은 조각(시작 높이가 레인 경계와 1e-12 km 차로 걸친 것)은 버림 — 세 점 2차식이 D ≈ 1e-11 에서 터져 Λ 33 을 냈음 [measured, P3B
    // sc 꼭대기 조각]. 1 m 보다 짧으면 2차식 대신 가운데 점 꼴.
    if (!(t2 - t1 > 1e-6)) { this.pc = 0; this.pa = 0; this.ph = 0; return 0; }
    let g1 = ql1 * invDq; if (g1 < 0) g1 = 0; if (g1 > Nq) g1 = Nq; let m1 = g1 | 0; if (m1 > Nq - 1) m1 = Nq - 1;
    let g2 = ql2 * invDq; if (g2 < 0) g2 = 0; if (g2 > Nq) g2 = Nq; let m2 = g2 | 0; if (m2 > Nq - 1) m2 = Nq - 1;
    const o1 = (j * stride + m1) * 5, o2 = (j * stride + m2) * 5, e1 = g1 - m1, e2 = g2 - m2;
    const Bm1 = (P[o1 + 6] - P[o1 + 1]) * invDq, Bm2 = (P[o2 + 6] - P[o2 + 1]) * invDq;
    const qa1 = m1 * dq, qa2 = m2 * dq;
    const A1 = P[o1] + (P[o1 + 5] - P[o1]) * e1, A2 = P[o2] + (P[o2 + 5] - P[o2]) * e2;
    const B1 = P[o1 + 1] + (P[o1 + 6] - P[o1 + 1]) * e1, B2 = P[o2 + 1] + (P[o2 + 6] - P[o2 + 1]) * e2;
    const M11 = P[o1 + 2] + (Bm1 * (ql1 * ql1 - qa1 * qa1)) * 0.5, M12 = P[o2 + 2] + (Bm2 * (ql2 * ql2 - qa2 * qa2)) * 0.5;
    const M21 = P[o1 + 3] + (Bm1 * (ql1 * ql1 * ql1 - qa1 * qa1 * qa1)) / 3, M22 = P[o2 + 3] + (Bm2 * (ql2 * ql2 * ql2 - qa2 * qa2 * qa2)) / 3;
    const C1 = P[o1 + 4] + (P[o1 + 9] - P[o1 + 4]) * e1, C2 = P[o2 + 4] + (P[o2 + 9] - P[o2 + 4]) * e2;
    const hc = (j + 0.5) / this.K;
    const idq = 1 / dqdt;
    const dA = A2 - A1, dB = B2 - B1;
    let alp = fm, bet = 0, gam = 0;
    if (D > 1e-3) {
      const s1 = (fm - f1) / (qlm - ql1), s12 = (f2 - fm) / (ql2 - qlm), s2 = (s12 - s1) / D;
      gam = s2; bet = s1 - s2 * (ql1 + qlm); alp = f1 - s1 * ql1 + s2 * ql1 * qlm;
    }
    // 참 피적분 λ ≥ 0 — 칸 안 선형 맞춤이 거시 가장자리에서 조각 Λ 를 조금 음수로 만들 수 있어 0 에서 자름(그런 조각끼리 상쇄해 Λ ≈ 0 인데
    // hf 무게만 남아 G 가 76 까지 튄 일이 있었음 [measured, P3B sc 꼭대기 → ac 레인, 해 12°])
    const lam = Math.max(0, (dA + (alp - hc) * dB + bet * (M12 - M11) + gam * (M22 - M21)) * idq);
    // 운량 무게: Σ A·c / Σ A(칸 평균 λ 몫만 — 늘 [0, 1]). B 몫(λ − A)까지 조각 평균 운량으로 나눠 주는 판은 A ≈ 0 인 거시 가장자리 조각에서
    // c_eff 가 튀어 G 가 76 까지 갔음 [measured, P3B sc 꼭대기 조각] — 되돌림(결정 A1).
    this.pc = (C2 - C1) * idq;
    this.pa = dA * idq;
    // 높이 무게: 조각 안 λ 무게 평균 hf = [ΔA·⟨hf⟩ + ΔB·(⟨hf²⟩ − hc·⟨hf⟩)] / [ΔA + ΔB·(⟨hf⟩ − hc)](A·B 를 조각 안에서 고르게, hf(q) 2차 평균은
    // 심프슨)를 조각의 hf 범위로 자르고 정확한 Λ(누적합)에 곱함 — 처음 판은 분자만 더해 거시 가장자리를 지나는 긴 스치는 조각에서 hf_eff 가 1 을
    // 넘었음 [measured, P3B −1° 꼭대기 조각](결정 A1).
    const hm1 = (f1 + 4 * fm + f2) / 6, hm2 = (f1 * f1 + 4 * fm * fm + f2 * f2) / 6;
    const den = dA + dB * (hm1 - hc);
    let hw = den > 1e-12 ? (dA * hm1 + dB * (hm2 - hc * hm1)) / den : hm1;
    const flo = Math.min(f1, fm, f2), fhi = Math.max(f1, fm, f2);
    if (!(hw >= flo)) hw = flo; else if (hw > fhi) hw = fhi;
    this.ph = lam * hw;
    this.pieces++;
    return lam;
  }
  /**
   * 광선 P0 + t·d(국소 틀 km, |d| = 1), 0 ≤ t ≤ min(range, 땅). q0 = P0 의 줄 좌표, dqdt = d 의 줄 방향 성분.
   * own ≥ 0 · split > 0 이면 그 레인의 t ≤ split 부분을 near 로 따로 셈.
   */
  trace(X: number, Y: number, Z: number, dx: number, dy: number, dz: number, q0: number, dqdt: number, range: number, own: number, split: number): void {
    const R = this.R, R2 = R * R, K = this.K;
    const accL = this.accL, accC = this.accC, accA = this.accA, accH = this.accH, tF = this.tF, tL = this.tL;
    accL.fill(0); accC.fill(0); accA.fill(0); accH.fill(0); tF.fill(Infinity); tL.fill(-Infinity);
    this.nearL = 0; this.nearC = 0; this.nearA = 0; this.nearH = 0;
    const r0sq = X * X + Y * Y + Z * Z, b = X * dx + Y * dy + Z * dz, rminSq = r0sq - b * b, tStar = -b;
    let tEnd = range;
    this.ground = false;
    if (b < 0 && rminSq < R2) { const tg = -b - Math.sqrt(R2 - rminSq); if (tg < tEnd) { tEnd = tg; this.ground = true; } }
    for (let sg = 0; sg < 2; sg++) {
      let ta: number, tb: number, desc: boolean;
      if (tStar > 0 && tStar < tEnd) { if (sg === 0) { ta = 0; tb = tStar; desc = true; } else { ta = tStar; tb = tEnd; desc = false; } }
      else { if (sg === 1) break; ta = 0; tb = tEnd; desc = tStar >= tEnd; }
      if (!(tb > ta)) continue;
      const ha = Math.sqrt(r0sq + 2 * b * ta + ta * ta) - R, hb = Math.sqrt(r0sq + 2 * b * tb + tb * tb) - R;
      const hlo = ha < hb ? ha : hb, hhi = ha < hb ? hb : ha;
      for (let li = 0; li < this.lanes.length; li++) {
        const L = this.lanes[li];
        const lo = hlo > L.base ? hlo : L.base, hi = hhi < L.top ? hhi : L.top;
        if (!(lo < hi)) continue;
        const dh = L.th / K;
        let j0 = Math.floor((lo - L.base) / dh), j1 = Math.floor((hi - L.base) / dh);
        if (j0 < 0) j0 = 0; if (j1 > K - 1) j1 = K - 1;
        const slot = L.k * 2 + sg;
        for (let j = j0; j <= j1; j++) {
          const cl = L.cellH[j], cu = L.cellH[j + 1];
          const hcl = lo > cl ? lo : cl, hch = hi < cu ? hi : cu;
          if (!(hcl < hch)) continue;
          const rl2 = hcl === cl ? L.cellR2[j] : (R + hcl) * (R + hcl), rh2 = hch === cu ? L.cellR2[j + 1] : (R + hch) * (R + hch);
          const sl = Math.sqrt(rl2 > rminSq ? rl2 - rminSq : 0), sh = Math.sqrt(rh2 > rminSq ? rh2 - rminSq : 0);
          let t1: number, t2: number, h1: number, h2: number;
          if (desc) { t1 = -b - sh; t2 = -b - sl; h1 = hch; h2 = hcl; } else { t1 = -b + sl; t2 = -b + sh; h1 = hcl; h2 = hch; }
          if (t1 < ta) { t1 = ta; h1 = Math.sqrt(r0sq + 2 * b * t1 + t1 * t1) - R; }
          if (t2 > tb) { t2 = tb; h2 = Math.sqrt(r0sq + 2 * b * t2 + t2 * t2) - R; }
          if (!(t1 < t2)) continue;
          if (L.k === own && split > 0 && t1 < split) {
            // 자기 레인 D_L 나눔 — 걸치면 두 조각
            const tsp = t2 < split ? t2 : split, hsp = tsp === t2 ? h2 : Math.sqrt(r0sq + 2 * b * tsp + tsp * tsp) - R;
            const vN = this.piece(L, j, t1, tsp, h1, hsp, r0sq, b, q0, dqdt);
            this.nearL += vN; this.nearC += this.pc; this.nearA += this.pa; this.nearH += this.ph;
            accL[slot] += vN; accC[slot] += this.pc; accA[slot] += this.pa; accH[slot] += this.ph;
            if (tsp < t2) {
              const vF = this.piece(L, j, tsp, t2, hsp, h2, r0sq, b, q0, dqdt);
              accL[slot] += vF; accC[slot] += this.pc; accA[slot] += this.pa; accH[slot] += this.ph;
            }
          } else {
            const v = this.piece(L, j, t1, t2, h1, h2, r0sq, b, q0, dqdt);
            accL[slot] += v; accC[slot] += this.pc; accA[slot] += this.pa; accH[slot] += this.ph;
          }
          if (t1 < tF[slot]) tF[slot] = t1;
          if (t2 > tL[slot]) tL[slot] = t2;
        }
      }
    }
  }
}

/**
 * 레인 k 의 구간들 → τ = Σ G(Λ; c_eff = ΣA·c / ΣA, hf_eff = Σλ·hf / Λ). near 가 있으면(아치 자기 레인) [τ_own, τ_rest_own] 을 돌려줌
 * (첫 구간 = near 를 포함하는 구간).
 */
type Acc4 = [number, number, number, number];   // Λ, ΣA·c, ΣA, Σλ·hf
function laneTau(acc: { accL: Float64Array; accC: Float64Array; accA: Float64Array; accH: Float64Array; tF: Float64Array; tL: Float64Array }, k: number, law: TsunLaneLaw, near: Acc4 | null): [number, number] {
  const Gm = (a: Acc4) => (a[0] > 1e-9 ? law.G(a[0], a[2] > 0 ? Math.min(1, Math.max(0, a[1] / a[2])) : 0, Math.min(1 - 1e-6, Math.max(1e-6, a[3] / a[0]))) : 0);
  const s0 = k * 2, s1 = k * 2 + 1;
  const a0 = acc.tF[s0] < Infinity, a1 = acc.tF[s1] < Infinity;
  const A0: Acc4 = [acc.accL[s0], acc.accC[s0], acc.accA[s0], acc.accH[s0]], A1: Acc4 = [acc.accL[s1], acc.accC[s1], acc.accA[s1], acc.accH[s1]];
  let first: Acc4 | null = null, second: Acc4 | null = null;
  if (a0 && a1 && Math.abs(acc.tL[s0] - acc.tF[s1]) < 1e-6) first = [A0[0] + A1[0], A0[1] + A1[1], A0[2] + A1[2], A0[3] + A1[3]];   // 근지점이 레인 안 — 한 구간
  else { if (a0) first = A0; if (a1) { if (first) second = A1; else first = A1; } }
  const tFirst = first ? Gm(first) : 0;
  const tSecond = second ? Gm(second) : 0;
  if (!near) return [tFirst + tSecond, 0];
  const own = Gm(near);
  return [own, Math.max(0, tFirst - own) + tSecond];
}

// ───── 결과 ─────
export interface TsunAtlasData {
  n: number; blocks: number; width: number; height: number;
  laneBlock: [number, number, number, number];
  centerKm: [number, number]; rowAxisEN: [number, number]; halfKm: number; rangeKm: number; arch: boolean;
  /** 아틀라스 τ(f32, half 반올림 전 — RGBA, 행 우선 width × height × 4). */
  tau: Float32Array;
  /** 텍스처 자료(half float 비트, tau 를 clampTau 에서 자른 것). */
  half: Uint16Array;
  /** τ_c 표 36(인덱스 (hfIdx·3 + reachIdx)·4 + lane). */
  tauCond: number[];
  /** 해 줄이 땅에 닿음(지구 그림자) — [j · n·blocks + blk·n + i] 비트 s = 조각 s. */
  earthShadow: Uint8Array;
  phiDeg: number; sunElCenterDeg: number; K: number;
  sha: string;
  meta: TsunAtlasMeta;
}
export interface TsunAtlasMeta {
  builder: string; buildMs: number; msLaw: number; msRows: number; msRays: number; msHalf: number; msSha: number;
  pieces: number; rays: number; earthShadowFrac: number; warnings: string[];
  laneCond: { lane: number; cover: number; L: number[] }[]; edgeCover: (number | null)[];
  sunAzDeg: number; sunAltDeg: number; fixtureSha?: string;
}
export interface TsunBuildOptions {
  /** 시험용 덮어쓰기(기본 TSUN_LP3). */
  K?: number; dqKm?: number; nc?: number; fitSub?: number;
  /** 고정표 sha(meta 기록용). */
  fixtureSha?: string;
  /** 시험용 시계(기본 performance.now / Date.now). */
  now?: () => number;
}
const clockNow = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * 아틀라스를 짓습니다(동기). laws[k] = 레인 k 의 법칙(null = 그 레인 없음). 텍스처 배치·틀은 cloudTsun.ts TsunAtlas.
 */
export function buildTsunAtlasData(input: TsunBuildInput, laws: (TsunLaneLaw | null)[], opts: TsunBuildOptions = {}): TsunAtlasData {
  const now = opts.now ?? clockNow;
  const t0 = now();
  const n = input.n, W = input.halfKm, tex = (2 * W) / n, range = input.rangeKm;
  if (!(Number.isInteger(n) && n >= 2)) throw new Error('tsunAtlas: n must be an integer >= 2');
  if (!(W > 0 && range > 0)) throw new Error('tsunAtlas: halfKm and rangeKm must be > 0');
  const geom = tsunFrameGeom(input);
  const R = geom.R, [aE, aN] = geom.a, sun = geom.sun, hz = Math.hypot(sun[0], sun[1]);
  const K = opts.K ?? tsunKFor(geom.sunElCenterDeg, W, R);
  const dq = opts.dqKm ?? TSUN_LP3.dqKm, nc = opts.nc ?? TSUN_LP3.nc, sub = opts.fitSub ?? TSUN_LP3.fitSub;
  const warnings = [...(input.warnings ?? [])];
  const [cx, cy] = input.centerKm;
  // 레인 문맥
  const lanes: LaneCtx[] = [];
  const laneBlock: [number, number, number, number] = [-1, -1, -1, -1];
  const edgeCover: (number | null)[] = [null, null, null, null];
  for (let k = 0; k < 4; k++) {
    const L = input.lanes[k], law = laws[k];
    if (!L || !law) continue;
    if (!(L.topKm > L.baseKm)) { warnings.push(`lane ${k}: zero thickness — skipped`); continue; }
    const cf = tsunCoverFn(L, geom.phiDeg);
    edgeCover[k] = L.macro ? cf.edge : null;
    const fit = fitLane(law, K, nc, sub);
    laneBlock[k] = lanes.length;
    lanes.push({ k, law, base: L.baseKm, top: L.topKm, th: L.topKm - L.baseKm, cover: cf.at, edge: cf.edge, A: fit.A, B: fit.B, P: new Float64Array(0), cellH: new Float64Array(0), cellR2: new Float64Array(0) });
  }
  const blocks = Math.max(1, lanes.length);
  const width = n * blocks, height = n * (input.arch ? 3 : 1);
  if (Math.max(width, height) > 2048) throw new Error(`tsunAtlas: texture ${width}×${height} exceeds 2048 (WebGL2 MAX_TEXTURE_SIZE minimum)`);
  const tau = new Float32Array(width * height * 4);
  const earthShadow = new Uint8Array(n * width);
  const t1 = now();
  const tr = new Lp3Tracer(lanes, R, K, dq, nc, W, range, cx, cy, [aE, aN]);
  let msRows = 0, rays = 0, nShadow = 0, nSun = 0;
  const O = geom.O;
  const S = TSUN_SLICE_HF;
  for (let jr = 0; jr < n; jr++) {
    const ta = now();
    const v = -W + (jr + 0.5) * tex;
    tr.buildRow(v);
    msRows += now() - ta;
    for (const own of lanes) {
      const blk = laneBlock[own.k];
      for (let i = 0; i < n; i++) {
        const u = -W + (i + 0.5) * tex;
        const X = O[0] + cx + u * aE - v * aN, Y = O[1] + cy + u * aN + v * aE, XY2 = X * X + Y * Y;
        // 해 블록 네 조각
        for (let s = 0; s < 4; s++) {
          const h = own.base + S[s] * own.th, r = R + h, Z = Math.sqrt(Math.max(0, r * r - XY2));
          tr.trace(X, Y, Z, sun[0], sun[1], sun[2], u, hz, range, -1, 0);
          let t = 0;
          for (const L of lanes) t += laneTau(tr, L.k, L.law, null)[0];
          tau[(jr * width + blk * n + i) * 4 + s] = t;
          nSun++;
          if (tr.ground) { earthShadow[jr * width + blk * n + i] |= 1 << s; nShadow++; }
          rays++;
        }
        if (!input.arch) continue;
        // 아치 블록: 층 밑(hf 0) · 꼭대기(hf 1) × GL2 고도 둘
        for (let sl = 0; sl < 2; sl++) {
          const h = sl === 0 ? own.base : own.top, r = R + h, Z = Math.sqrt(Math.max(0, r * r - XY2));
          const ux = X / r, uy = Y / r, uz = Z / r;
          const na = ux * aE + uy * aN;
          let tx = aE - ux * na, ty = aN - uy * na, tz = -uz * na;
          const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
          const dip = Math.acos(Math.min(1, R / r));
          for (let g = 0; g < 2; g++) {
            const e = -ARCH_GL2[g] * dip, ce = Math.cos(e), se = Math.sin(e);
            const dx = ce * tx + se * ux, dy = ce * ty + se * uy, dz = ce * tz + se * uz;
            tr.trace(X, Y, Z, dx, dy, dz, u, dx * aE + dy * aN, range, own.k, own.law.dlKm);
            let tOwn = 0, tRest = 0;
            for (const L of lanes) {
              if (L.k === own.k) { const [o2, r2] = laneTau(tr, L.k, L.law, [tr.nearL, tr.nearC, tr.nearA, tr.nearH]); tOwn += o2; tRest += r2; }
              else tRest += laneTau(tr, L.k, L.law, null)[0];
            }
            const o = (((1 + sl) * n + jr) * width + blk * n + i) * 4 + g * 2;
            tau[o] = tOwn; tau[o + 1] = tRest;
            rays++;
          }
        }
      }
    }
  }
  const t2 = now();
  // τ_c 표(36) — 관측점 국소 해에서 hf 마디부터의 층 안 경로 = L, 운량 = 운량 무게 평균
  const tauCond = new Array<number>(36).fill(0);
  const laneCond: { lane: number; cover: number; L: number[] }[] = [];
  {
    const Xc = O[0] + cx, Yc = O[1] + cy;
    for (const L of lanes) {
      let s1 = 0, s2 = 0;
      const G = 64, rr = Math.max(1, W - 4);
      for (let a = 0; a < G; a++) for (let b2 = 0; b2 < G; b2++) {
        const x = -W + ((a + 0.5) * 2 * W) / G, y = -W + ((b2 + 0.5) * 2 * W) / G;
        if (x * x + y * y > rr * rr) continue;
        const c = L.cover(cx + x, cy + y); s1 += c; s2 += c * c;
      }
      const cc = s1 > 0 ? s2 / s1 : input.lanes[L.k]!.tileCover;
      const Ls: number[] = [];
      for (let hi = 0; hi < 3; hi++) {
        const hf = TSUN_COND_HF[hi], h = L.base + hf * L.th, r = R + h;
        const Zc = Math.sqrt(Math.max(0, r * r - Xc * Xc - Yc * Yc));
        const sinE = (Xc * sun[0] + Yc * sun[1] + Zc * sun[2]) / r;
        const Lk = tsunPathKm(h, sinE, L.base, L.top, range, R);
        Ls.push(Lk);
        for (let ri = 0; ri < 3; ri++) tauCond[(hi * 3 + ri) * 4 + L.k] = L.law.tauCond(cc, hf, TSUN_COND_REACH_KM[ri], Lk);
      }
      laneCond.push({ lane: L.k, cover: cc, L: Ls });
    }
  }
  // half float(텍스처 자료) + sha
  const t3 = now();
  const clampT = TSUN_LP3.clampTau;
  const half = new Uint16Array(tau.length);
  for (let i = 0; i < tau.length; i++) {
    const x = tau[i];
    half[i] = DataUtils.toHalfFloat(x > clampT ? clampT : x < 0 ? 0 : x);
  }
  const t4 = now();
  const hdr = JSON.stringify({ n, blocks, laneBlock, centerKm: input.centerKm, rowAxisEN: [aE, aN], halfKm: W, rangeKm: range, arch: input.arch, tauCond });
  const sha = sha256Hex(concatBytes(new Uint8Array(half.buffer, half.byteOffset, half.byteLength), new TextEncoder().encode(hdr)));
  const t5 = now();
  const sunAltDeg = geom.sunElCenterDeg;
  return {
    n, blocks, width, height, laneBlock, centerKm: [cx, cy], rowAxisEN: [aE, aN], halfKm: W, rangeKm: range, arch: input.arch,
    tau, half, tauCond, earthShadow, phiDeg: geom.phiDeg, sunElCenterDeg: sunAltDeg, K, sha,
    meta: {
      builder: TSUN_ATLAS_BUILDER, buildMs: t5 - t0, msLaw: t1 - t0, msRows, msRays: t2 - t1 - msRows, msHalf: t4 - t3, msSha: t5 - t4,
      pieces: tr.pieces, rays, earthShadowFrac: nSun ? nShadow / nSun : 0, warnings, laneCond, edgeCover,
      sunAzDeg: geom.phiDeg, sunAltDeg, fixtureSha: opts.fixtureSha,
    },
  };
}

/**
 * 같은 법칙의 '수렴한 기준 구적'(U2a·U2d) — 참 3-D 광선을 ds 간격 중점으로 걷고(평면 자리는 3-D 점에서 — 아치 옆 흐름 포함), λ(c, hf) 를
 * 그 자리에서 바로 읽어 레인별 이어진 구간마다 G. LP3 의 누적합·칸 맞춤·c 격자·q 간격과 독립. own·split 은 아치 나눔(LP3 와 같은 뜻).
 */
export function tsunReferenceTau(input: TsunBuildInput, laws: (TsunLaneLaw | null)[], geom: TsunFrameGeom, P0: ArrayLike<number>, d: ArrayLike<number>, opt: { dsKm?: number; own?: number; split?: number } = {}): { tau: number; own: number; rest: number; ground: boolean } {
  const ds = opt.dsKm ?? 0.05, own = opt.own ?? -1, split = opt.split ?? 0;
  const R = geom.R, O = geom.O;
  const covers = input.lanes.map((L, k) => (L && laws[k] ? tsunCoverFn(L, geom.phiDeg).at : null));
  const r0sq = dot3(P0, P0), b = dot3(P0, d), rminSq = r0sq - b * b;
  let tEnd = input.rangeKm, ground = false;
  if (b < 0 && rminSq < R * R) { const tg = -b - Math.sqrt(R * R - rminSq); if (tg < tEnd) { tEnd = tg; ground = true; } }
  let tau = 0, ownT = 0, restT = 0;
  for (let k = 0; k < 4; k++) {
    const L = input.lanes[k], law = laws[k], cov = covers[k];
    if (!L || !law || !cov || !(L.topKm > L.baseKm)) continue;
    const th = L.topKm - L.baseKm;
    let runL = 0, runC = 0, runH = 0, inRun = false, nL = 0, nC = 0, nH = 0, firstRun = true;
    let laneSum = 0, laneOwn = 0;
    const close = () => {
      if (!inRun) return;
      const g = runL > 0 ? law.G(runL, runC / runL, Math.min(1 - 1e-6, Math.max(1e-6, runH / runL))) : 0;
      if (k === own && firstRun && split > 0) {
        const gn = nL > 0 ? law.G(nL, nC / nL, Math.min(1 - 1e-6, Math.max(1e-6, nH / nL))) : 0;
        laneOwn += gn; laneSum += Math.max(0, g - gn);
      } else laneSum += g;
      firstRun = false; inRun = false; runL = runC = runH = 0;
    };
    const nStep = Math.ceil(tEnd / ds);
    for (let st = 0; st < nStep; st++) {
      const ta = st * ds, tb = Math.min(tEnd, ta + ds), t = 0.5 * (ta + tb), w = tb - ta;
      const px = P0[0] + t * d[0], py = P0[1] + t * d[1], pz = P0[2] + t * d[2];
      const h = Math.sqrt(px * px + py * py + pz * pz) - R;
      if (h < L.baseKm || h > L.topKm) { close(); continue; }
      inRun = true;
      const hf = (h - L.baseKm) / th, c = cov(px - O[0], py - O[1]);
      const lam = law.lambda(c, hf) * w;
      runL += lam; runC += lam * c; runH += lam * hf;
      if (k === own && firstRun && t < split) { nL += lam; nC += lam * c; nH += lam * hf; }
    }
    close();
    if (k === own) { ownT += laneOwn; restT += laneSum; } else restT += laneSum;
    tau += laneOwn + laneSum;
  }
  return { tau, own: ownT, rest: restT, ground };
}

/**
 * LP3 한 줄 평가(시험·진단): 평면 (x, y) km · 높이 h km 의 점에서 방향 dir(국소 틀, 없으면 해)로 — 그 점의 가로 좌표 줄 하나만 쌓아
 * 아틀라스와 같은 수식으로 τ. own·split 은 아치 나눔. 아틀라스 텍셀 값과 같은 점이면 같은 값(같은 핵).
 */
export function tsunLineTau(input: TsunBuildInput, laws: (TsunLaneLaw | null)[], xKm: number, yKm: number, hKm: number, opt: { dir?: ArrayLike<number>; own?: number; split?: number; K?: number } = {}): { tau: number; own: number; rest: number; ground: boolean; perLane: number[] } {
  const geom = tsunFrameGeom(input);
  const R = geom.R, [aE, aN] = geom.a, W = input.halfKm;
  const K = opt.K ?? tsunKFor(geom.sunElCenterDeg, W, R);
  const lanes: LaneCtx[] = [];
  for (let k = 0; k < 4; k++) {
    const L = input.lanes[k], law = laws[k];
    if (!L || !law || !(L.topKm > L.baseKm)) continue;
    const cf = tsunCoverFn(L, geom.phiDeg), fit = fitLane(law, K, TSUN_LP3.nc, TSUN_LP3.fitSub);
    lanes.push({ k, law, base: L.baseKm, top: L.topKm, th: L.topKm - L.baseKm, cover: cf.at, edge: cf.edge, A: fit.A, B: fit.B, P: new Float64Array(0), cellH: new Float64Array(0), cellR2: new Float64Array(0) });
  }
  const [cx, cy] = input.centerKm;
  const kx = xKm - cx, ky = yKm - cy, u = kx * aE + ky * aN, v = -kx * aN + ky * aE;
  const Wq = Math.max(W, Math.abs(u) + 1);
  const tr = new Lp3Tracer(lanes, R, K, TSUN_LP3.dqKm, TSUN_LP3.nc, Wq, input.rangeKm, cx, cy, [aE, aN]);
  tr.buildRow(v);
  const X = geom.O[0] + xKm, Y = geom.O[1] + yKm, r = R + hKm, Z = Math.sqrt(Math.max(0, r * r - X * X - Y * Y));
  const d = opt.dir ?? geom.sun;
  const own = opt.own ?? -1, split = opt.split ?? 0;
  tr.trace(X, Y, Z, d[0], d[1], d[2], u, d[0] * aE + d[1] * aN, input.rangeKm, own, split);
  let tau = 0, ownT = 0, rest = 0;
  const perLane = [0, 0, 0, 0];
  for (const L of lanes) {
    const [a, b] = laneTau(tr, L.k, L.law, L.k === own && split > 0 ? [tr.nearL, tr.nearC, tr.nearA, tr.nearH] : null);
    perLane[L.k] = a + b; tau += a + b;
    if (L.k === own && split > 0) { ownT += a; rest += b; } else rest += a;
  }
  return { tau, own: ownT, rest, ground: tr.ground, perLane };
}

// ───── 텍스처 ─────
/** 지은 자료 → three 텍스처(RGBA16F, 선형, 가장자리 고정, 밉맵 없음) + TsunAtlas(setTsunAtlas 에 그대로). 텍스처는 부른 쪽 소유. */
export function makeTsunAtlas(d: TsunAtlasData, sceneSerial: number): TsunAtlas {
  const tex = new DataTexture(d.half, d.width, d.height, RGBAFormat, HalfFloatType);
  tex.minFilter = LinearFilter; tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping; tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.flipY = false; tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return {
    texture: tex, n: d.n, blocks: d.blocks, laneBlock: [...d.laneBlock] as [number, number, number, number], centerKm: [...d.centerKm] as [number, number],
    rowAxisEN: [...d.rowAxisEN] as [number, number], halfKm: d.halfKm, rangeKm: d.rangeKm, arch: d.arch, tauCond: d.tauCond.slice(), sceneSerial,
    meta: {
      sha: d.sha, buildMs: d.meta.buildMs, builder: d.meta.builder, fixtureSha: d.meta.fixtureSha, sunAzDeg: d.meta.sunAzDeg, sunAltDeg: d.meta.sunAltDeg,
      K: d.K, earthShadowFrac: d.meta.earthShadowFrac, warnings: d.meta.warnings.slice(),
    },
  };
}

// ───── sha-256(브라우저·node 같은 값 — 하네스 meta 'atlas sha', ruler-delta B1) ─────
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
/** SHA-256(16 진). */
export function sha256Hex(msg: Uint8Array): string {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = msg.length, nBlk = Math.ceil((len + 9) / 64), buf = new Uint8Array(nBlk * 64);
  buf.set(msg); buf[len] = 0x80;
  const bits = len * 8, dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, bits >>> 0); dv.setUint32(buf.length - 8, Math.floor(bits / 0x100000000));
  const w = new Uint32Array(64);
  for (let blk = 0; blk < nBlk; blk++) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(blk * 64 + t * 4);
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15], b = w[t - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3), s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[t] + w[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
}
