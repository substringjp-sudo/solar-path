/**
 * **건물 자리 고도 깎기** (2026-11-18, 사용자 요청: 지형과 건물이 겹침).
 *
 * ## 왜
 *
 * Terrarium 고도 타일은 도시에서 대부분 위성 레이더(SRTM 계열) 값이라 **건물 높이가 섞인 표면 고도(DSM)** 입니다.
 * 나고야역 타일(z15 한 장 넓이)에서 Terrarium 은 −29~24 m, 표준편차 5.4 m 인데, 국토지리원 레이저 맨땅 자료(DEM5A)는
 * −6~9 m, 표준편차 1.2 m 였습니다. 그 '언덕' 위에 지도 건물을 또 세우니 지형과 건물이 겹치거나 떠 보였습니다.
 *
 * ## 어떻게
 *
 * 1. 촘촘한 DEM 패치를 GPU 에서 읽어(readRenderTargetPixels) 고도로 풉니다.
 * 2. 지도 건물 덮개(mvtTiles 의 `bld`)로 DEM 칸마다 **건물 밀도**(둘레 약 100 m 평균 덮개 비율)를 냅니다.
 *    밀도가 낮은 곳(교외 단독주택 드문 곳·산)은 손대지 않습니다 — 진짜 언덕과 봉우리를 지키려고.
 * 3. 건물이 빽빽한 둘레에서만 **열기 다음 닫기**(최솟값→최댓값, 최댓값→최솟값) 회색조 형태학 필터를 겁니다.
 *    창 한 변 약 110 m 보다 작은 솟음(건물)과 꺼짐(레이더 잡음 구멍)은 지워지고 그보다 큰 지형은 남습니다.
 * 4. 원래 고도와 걸러낸 고도를 밀도 가중으로 섞어 다시 Terrarium 으로 싸고, 새 텍스처로 패치를 바꿉니다.
 *
 * 지형 격자·건물 바닥·바다판·하늘 보임(AO) 굽기가 모두 같은 패치를 읽으므로, 바꾼 뒤 setPatch 를 다시 부르면 함께 맞춰집니다.
 * 실측이 아닌 추정이라 맨땅 자료보다는 덜 정확합니다.
 */
import * as THREE from 'three';
import type { DemPatch } from './demTiles';
import { smoothstep } from './math';

/** demTiles.ts 의 DEM_TILE_SIZE_PX 와 같음(그 모듈은 앱 의존성을 끌어와 시험에서 못 읽으므로 값만). */
const DEM_TILE_SIZE_PX = 256;

/** 건물 덮개 격자(0/255). 행 = +Z 남, 열 = +X 동, 관측자 중심 ±halfM. */
export interface BuildingCover {
  size: number;
  halfM: number;
  data: Uint8Array;
  /**
   * 2026-11-19 건물 발자국 바깥 고리(동 x, 남 z, m 쌍). 있으면 건물마다 발자국 아래 고도를 **한 높이의 바닥**으로 맞춥니다.
   * 건물은 중심점 지반 고도를 바닥으로 쓰므로(BuildingField), 발자국 아래 지형이 그 한 값이면 떠 보이거나 파묻히지 않습니다.
   */
  footprints?: Float32Array[];
  /**
   * 2026-11-19 물 덮개(0~255, 관측자 둘레 ±halfM), 촘촘한 것 먼저. 있으면 강·호수 자리 고도를 평평한 수면으로 맞춥니다
   * (사용자: 내륙의 물이 땅 위에 씌워져 강이 오르락내리락함). 표면 고도 자료는 수면 위 다리·배·둑 높이와 레이더 잡음이 섞여 있습니다.
   */
  water?: Array<{ size: number; halfM: number; data: Uint8Array }>;
  /**
   * 포장·도로 덮개(stride 2: [시멘트, 아스팔트], 0~255, 관측자 둘레 ±halfM).
   * 있으면 도로 노면 아래의 국소 고도 요철(인접 건물·수목 레이더 반사 잔여분)을 완만하게 다림질해
   * 직선 도로가 위아래·좌우로 구불거리거나 도로 한가운데 가짜 언덕 그림자가 생기는 것을 막습니다.
   */
  pave?: { size: number; halfM: number; data: Uint8Array };
}

/** 발자국 둘레에서 바닥 높이를 재는 고리 폭(m). */
export const FOOTPRINT_RING_M = 10;
/** 바닥 = 고리 고도의 이 분위수(0 = 가장 낮은 쪽). 비탈에서는 낮은 쪽 땅에 맞춥니다. */
export const FOOTPRINT_LOW_Q = 0.25;

/** 수면 고도: 물 칸만의 최솟값 창 반폭(m) — 다리(대개 폭 40 m 아래)·배·잡음 솟음을 지움. */
export const WATER_MIN_HALF_M = 60;
/** 수면 고도: 물 칸만의 평균 반폭(m) — 강을 따라 천천히 내려가는 수면만 남김. */
export const WATER_MEAN_HALF_M = 250;
/** 넓은 물 판정 반폭(m). 이보다 좁은 물길(개울·도랑)은 수면을 맞추지 않음. */
export const WATER_WIDE_HALF_M = 20;

/** 형태학 창 반폭(m). 창 한 변 ≈ 2·이 값 + 칸 하나. 도심 건물(대개 한 변 100 m 아래)보다 크게. */
export const FLATTEN_WINDOW_HALF_M = 70;
/** 건물 밀도를 재는 둘레 반폭(m). */
export const FLATTEN_DENSITY_HALF_M = 100;
/** 건물 밀도(덮개 비율) → 깎는 정도. 이 사이에서 0 → 1. */
export const FLATTEN_DENSITY_RAMP: [number, number] = [0.06, 0.2];

/** 제자리 Hoare Quickselect (O(R) 평균으로 단일 분위수 추출). */
function quickSelect(arr: number[], len: number, k: number): number {
  let lo = 0, hi = len - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const pivot = arr[mid];
    let i = lo, j = hi;
    while (i <= j) {
      while (arr[i] < pivot) i++;
      while (arr[j] > pivot) j--;
      if (i <= j) {
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        i++; j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return arr[k];
}

/** 분리 가능한 정사각형 창 최솟값/최댓값(반폭 r 칸). 경계는 안쪽 값만. */
function rankFilter(src: Float32Array, n: number, r: number, useMin: boolean, y0: number, y1: number, x0: number, x1: number): Float32Array {
  const tmp = new Float32Array(src);
  const out = new Float32Array(src);
  const pick = useMin ? Math.min : Math.max;
  for (let y = y0; y <= y1; y++) {
    const row = y * n;
    for (let x = x0; x <= x1; x++) {
      let v = src[row + x];
      const a = Math.max(0, x - r), b = Math.min(n - 1, x + r);
      for (let k = a; k <= b; k++) v = pick(v, src[row + k]);
      tmp[row + x] = v;
    }
  }
  for (let y = y0; y <= y1; y++) {
    const a = Math.max(0, y - r), b = Math.min(n - 1, y + r);
    for (let x = x0; x <= x1; x++) {
      let v = tmp[y * n + x];
      for (let k = a; k <= b; k++) v = pick(v, tmp[k * n + x]);
      out[y * n + x] = v;
    }
  }
  return out;
}

/** 분리 가능한 상자 평균(반폭 r 칸). */
function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    let acc = 0, cnt = 0;
    for (let x = -r; x < n + r; x++) {
      if (x + r < n && x + r >= 0) { acc += src[y * n + x + r]; cnt++; }
      if (x - r - 1 >= 0 && x - r - 1 < n) { acc -= src[y * n + x - r - 1]; cnt--; }
      if (x >= 0 && x < n) tmp[y * n + x] = cnt > 0 ? acc / cnt : 0;
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0, cnt = 0;
    for (let y = -r; y < n + r; y++) {
      if (y + r < n && y + r >= 0) { acc += tmp[(y + r) * n + x]; cnt++; }
      if (y - r - 1 >= 0 && y - r - 1 < n) { acc -= tmp[(y - r - 1) * n + x]; cnt--; }
      if (y >= 0 && y < n) out[y * n + x] = cnt > 0 ? acc / cnt : 0;
    }
  }
  return out;
}

export interface FlattenStats {
  /** 손댄 칸 수(가중 > 0.01) */
  touched: number;
  /** 손댄 칸에서 낮아진 평균·최대(m), 높아진 최대(m) */
  meanDropM: number;
  maxDropM: number;
  maxRaiseM: number;
}

/**
 * 고도 배열(행 = 남쪽으로, 열 = 동쪽으로, 칸 texelM)을 건물 밀도 가중으로 깎습니다. 순수 함수 — 시험용으로도 씁니다.
 * `coverAt(i, j)` 는 그 칸의 건물 덮개 비율(0~1)을 돌려줍니다(범위 밖이면 0).
 */
export function flattenHeights(
  h: Float32Array,
  n: number,
  texelM: number,
  coverAt: (i: number, j: number) => number,
): { heights: Float32Array; stats: FlattenStats } {
  const cover = new Float32Array(n * n);
  let any = false;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = coverAt(i, j);
    cover[j * n + i] = c;
    if (c > 0) any = true;
  }
  const stats: FlattenStats = { touched: 0, meanDropM: 0, maxDropM: 0, maxRaiseM: 0 };
  if (!any) return { heights: h, stats };
  const density = boxBlur(cover, n, Math.max(1, Math.round(FLATTEN_DENSITY_HALF_M / texelM)));
  const w = new Float32Array(n * n);
  let x0 = n, x1 = -1, y0 = n, y1 = -1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = smoothstep(FLATTEN_DENSITY_RAMP[0], FLATTEN_DENSITY_RAMP[1], density[j * n + i]);
    w[j * n + i] = v;
    if (v > 0.001) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  }
  if (x1 < 0) return { heights: h, stats };
  const r = Math.max(1, Math.round(FLATTEN_WINDOW_HALF_M / texelM));
  // 거르는 범위: 가중이 있는 상자 + 창 두 번 몫의 여유(가장자리 값이 바르게 나오게).
  const m = 4 * r;
  const bx0 = Math.max(0, x0 - m), bx1 = Math.min(n - 1, x1 + m), by0 = Math.max(0, y0 - m), by1 = Math.min(n - 1, y1 + m);
  // 열기(솟음 지움) → 닫기(꺼짐 메움).
  let f = rankFilter(h, n, r, true, by0, by1, bx0, bx1);
  f = rankFilter(f, n, r, false, by0, by1, bx0, bx1);
  f = rankFilter(f, n, r, false, by0, by1, bx0, bx1);
  f = rankFilter(f, n, r, true, by0, by1, bx0, bx1);
  // 창 모양 계단을 풀려고 칸 하나 반폭 평균.
  f = boxBlur(f, n, 1);
  const out = new Float32Array(h);
  let sumDrop = 0;
  for (let k = 0; k < n * n; k++) {
    const wk = w[k];
    if (wk <= 0.001) continue;
    const v = h[k] + wk * (f[k] - h[k]);
    const d = h[k] - v;
    out[k] = v;
    if (wk > 0.01) {
      stats.touched++;
      sumDrop += d;
      if (d > stats.maxDropM) stats.maxDropM = d;
      if (-d > stats.maxRaiseM) stats.maxRaiseM = -d;
    }
  }
  stats.meanDropM = stats.touched ? sumDrop / stats.touched : 0;
  return { heights: out, stats };
}

/**
 * 건물마다 발자국 아래를 한 높이로 맞춥니다. 순수 함수 — 시험용으로도 씁니다.
 * `polys` 는 고도 격자 칸 좌표(칸 i 의 중심 = i + 0.5)의 꼭짓점 쌍 (열, 행) 입니다.
 *
 * 건물 하나의 바닥 = 발자국 바로 바깥 고리(다른 건물 칸은 뺌)에서 고도의 낮은 분위수.
 * 고리가 거의 비는 빽빽한 곳(건물이 맞붙음)은 건드리지 않습니다(그곳은 동네 단위 깎기가 맡음).
 * 바닥이 발자국 안의 가장 높은 값보다 높으면 그 높이로 자릅니다(구덩이 위에 짓지 않음).
 */
export function flattenFootprints(
  h: Float32Array,
  n: number,
  texelM: number,
  polys: Float32Array[],
): { heights: Float32Array; stats: FlattenStats } {
  const stats: FlattenStats = { touched: 0, meanDropM: 0, maxDropM: 0, maxRaiseM: 0 };
  if (!polys.length) return { heights: h, stats };
  const own = new Int32Array(n * n);
  const bb = new Int32Array(polys.length * 4); // x0 x1 y0 y1 (칸, 닫힌 구간); 비면 x1 < x0
  const xs: number[] = [];
  for (let k = 0; k < polys.length; k++) {
    const P = polys[k], m = P.length / 2;
    let minY = Infinity, maxY = -Infinity;
    for (let q = 0; q < m; q++) { const y = P[2 * q + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const j0 = Math.max(0, Math.ceil(minY - 0.5)), j1 = Math.min(n - 1, Math.floor(maxY - 0.5));
    let bx0 = n, bx1 = -1, by0 = n, by1 = -1;
    for (let j = j0; j <= j1; j++) {
      const yc = j + 0.5;
      xs.length = 0;
      for (let q = 0; q < m; q++) {
        const r = (q + 1) % m;
        const ax = P[2 * q], ay = P[2 * q + 1], bx = P[2 * r], by = P[2 * r + 1];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil(xs[q] - 0.5)), i1 = Math.min(n - 1, Math.floor(xs[q + 1] - 0.5));
        for (let i = i0; i <= i1; i++) {
          own[j * n + i] = k + 1;
          if (i < bx0) bx0 = i;
          if (i > bx1) bx1 = i;
          if (j < by0) by0 = j;
          if (j > by1) by1 = j;
        }
      }
    }
    bb[4 * k] = bx0; bb[4 * k + 1] = bx1; bb[4 * k + 2] = by0; bb[4 * k + 3] = by1;
  }
  const R = Math.max(2, Math.round(FOOTPRINT_RING_M / texelM));
  const pads = new Float32Array(polys.length).fill(NaN);
  const ring: number[] = [];
  for (let k = 0; k < polys.length; k++) {
    const x0 = bb[4 * k], x1 = bb[4 * k + 1], y0 = bb[4 * k + 2], y1 = bb[4 * k + 3];
    if (x1 < x0) continue;
    ring.length = 0;
    let inMax = -Infinity;
    for (let j = Math.max(0, y0 - R); j <= Math.min(n - 1, y1 + R); j++) {
      for (let i = Math.max(0, x0 - R); i <= Math.min(n - 1, x1 + R); i++) {
        const o = own[j * n + i];
        if (o === k + 1) { if (h[j * n + i] > inMax) inMax = h[j * n + i]; }
        else if (o === 0) ring.push(h[j * n + i]);
      }
    }
    if (ring.length < 6) continue;
    const pad = quickSelect(ring, ring.length, Math.min(ring.length - 1, Math.floor(ring.length * FOOTPRINT_LOW_Q)));
    pads[k] = Math.min(pad, inMax);
  }
  const out = new Float32Array(h);
  let sumDrop = 0;
  for (let k = 0; k < polys.length; k++) {
    const pad = pads[k];
    if (!Number.isFinite(pad)) continue;
    for (let j = bb[4 * k + 2]; j <= bb[4 * k + 3]; j++) {
      for (let i = bb[4 * k]; i <= bb[4 * k + 1]; i++) {
        const idx = j * n + i;
        if (own[idx] !== k + 1) continue;
        const d = h[idx] - pad;
        out[idx] = pad;
        stats.touched++;
        sumDrop += d;
        if (d > stats.maxDropM) stats.maxDropM = d;
        if (-d > stats.maxRaiseM) stats.maxRaiseM = -d;
      }
    }
  }
  stats.meanDropM = stats.touched ? sumDrop / stats.touched : 0;
  return { heights: out, stats };
}

/**
 * 물 칸을 평평한 수면 고도로 맞춥니다. 순수 함수 — 시험용으로도 씁니다. `waterAt(i, j)` 는 그 칸의 물 비율(0~1).
 * 수면 = 물 칸만으로 창 최솟값(다리·배 지움) → 물 칸만의 넓은 평균 두 번(강을 따라 완만히). 물 칸은 그 값으로 바꿉니다.
 */
export function flattenWaterHeights(
  h: Float32Array,
  n: number,
  texelM: number,
  waterAt: (i: number, j: number) => number,
): { heights: Float32Array; stats: FlattenStats } {
  const frac = new Float32Array(n * n);
  const wm = new Float32Array(n * n);
  let x0 = n, x1 = -1, y0 = n, y1 = -1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const f = waterAt(i, j);
    frac[j * n + i] = f;
    if (f >= 0.5 && Number.isFinite(h[j * n + i])) {
      wm[j * n + i] = 1;
      if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
    }
  }
  const stats: FlattenStats = { touched: 0, meanDropM: 0, maxDropM: 0, maxRaiseM: 0 };
  if (x1 < 0) return { heights: h, stats };
  // 넓은 물만(둘레 반폭 WATER_WIDE_HALF_M 의 60 % 이상이 물) — 산골 개울·도랑은 물길이 경사를 따라 흐르므로 건드리지 않음.
  {
    const rw = Math.max(1, Math.round(WATER_WIDE_HALF_M / texelM));
    const core = boxBlur(wm, n, rw);
    for (let k = 0; k < n * n; k++) core[k] = core[k] >= 0.6 ? 1 : 0;
    // 속(core)을 다시 같은 폭만큼 넓혀 굽은 강의 가장자리 칸도 되살림(열기).
    const keep = rankFilter(core, n, rw + 1, false, 0, n - 1, 0, n - 1);
    x0 = n; x1 = -1; y0 = n; y1 = -1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (wm[k] && !keep[k]) wm[k] = 0;
      if (wm[k]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    }
    if (x1 < 0) return { heights: h, stats };
  }
  const BIG = 1e9;
  const src = new Float32Array(n * n).fill(BIG);
  for (let k = 0; k < n * n; k++) if (wm[k]) src[k] = h[k];
  const rMin = Math.max(1, Math.round(WATER_MIN_HALF_M / texelM));
  const mn = rankFilter(src, n, rMin, true, Math.max(0, y0 - 1), Math.min(n - 1, y1 + 1), Math.max(0, x0 - 1), Math.min(n - 1, x1 + 1));
  const rMean = Math.max(1, Math.round(WATER_MEAN_HALF_M / texelM));
  let level = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) level[k] = wm[k] ? mn[k] : 0;
  const wb = boxBlur(wm, n, rMean);
  for (let pass = 0; pass < 2; pass++) {
    const num = boxBlur(level, n, rMean);
    const next = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) next[k] = wm[k] && wb[k] > 1e-6 ? num[k] / wb[k] : 0;
    level = next;
  }
  const out = new Float32Array(h);
  let sumDrop = 0;
  for (let k = 0; k < n * n; k++) {
    if (!wm[k]) continue;
    const wk = smoothstep(0.5, 0.8, frac[k]);
    const v = h[k] + wk * (level[k] - h[k]);
    const d = h[k] - v;
    out[k] = v;
    stats.touched++;
    sumDrop += d;
    if (d > stats.maxDropM) stats.maxDropM = d;
    if (-d > stats.maxRaiseM) stats.maxRaiseM = -d;
  }
  stats.meanDropM = stats.touched ? sumDrop / stats.touched : 0;
  return { heights: out, stats };
}

/**
 * 패치를 제자리에서 깎습니다(텍스처를 새것으로 바꿈). 같은 덮개로 두 번 부르면 아무것도 안 합니다.
 * 성공하면 통계를, 읽기를 못 하거나 건물이 없으면 null 을 돌려줍니다.
 */
export function flattenDemPatchUnderBuildings(
  renderer: THREE.WebGLRenderer,
  patch: DemPatch,
  cover: BuildingCover,
): FlattenStats | null {
  if (patch.flattenedBy === cover) return null;
  const target = patch.target;
  if (!target || typeof renderer.readRenderTargetPixels !== 'function') return null;
  const n = DEM_TILE_SIZE_PX * patch.blockTiles;
  const rgba = new Uint8Array(n * n * 4);
  try {
    renderer.readRenderTargetPixels(target, 0, 0, n, n, rgba);
  } catch {
    return null;
  }
  const h = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) {
    const o = k * 4;
    h[k] = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768;
  }
  const texelM = patch.tileSpanM / DEM_TILE_SIZE_PX;
  const cs = cover.size, ch = cover.halfM, cScale = cs / (2 * ch);
  // DEM 칸 (i, j) 의 지상 좌표: g = ((i + 0.5) / 256 − observerU) · tileSpanM (동), j 는 남쪽.
  // 칸 넓이 안 3×3 점의 덮개 평균.
  const coverAt = (i: number, j: number): number => {
    let acc = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const gx = ((i + (sx + 0.5) / 3) / DEM_TILE_SIZE_PX - patch.observerU) * patch.tileSpanM;
      const gz = ((j + (sy + 0.5) / 3) / DEM_TILE_SIZE_PX - patch.observerV) * patch.tileSpanM;
      const cx = Math.floor((gx + ch) * cScale), cy = Math.floor((gz + ch) * cScale);
      if (cx < 0 || cy < 0 || cx >= cs || cy >= cs) continue;
      if (cover.data[cy * cs + cx] >= 128) acc++;
    }
    return acc / 9;
  };
  const bRes = flattenHeights(h, n, texelM, coverAt);
  let heights = bRes.heights;
  const stats = bRes.stats;
  if (cover.water?.length) {
    const grids = cover.water;
    // 물 덮개: 칸 넓이 안 3×3 점, 점마다 그 점을 담는 가장 촘촘한 격자.
    const waterAt = (i: number, j: number): number => {
      let acc = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const gx = ((i + (sx + 0.5) / 3) / DEM_TILE_SIZE_PX - patch.observerU) * patch.tileSpanM;
        const gz = ((j + (sy + 0.5) / 3) / DEM_TILE_SIZE_PX - patch.observerV) * patch.tileSpanM;
        for (const g of grids) {
          const sc = g.size / (2 * g.halfM);
          const cx = Math.floor((gx + g.halfM) * sc), cy = Math.floor((gz + g.halfM) * sc);
          if (cx < 0 || cy < 0 || cx >= g.size || cy >= g.size) continue;
          if (g.data[cy * g.size + cx] >= 128) acc++;
          break;
        }
      }
      return acc / 9;
    };
    const wRes = flattenWaterHeights(heights, n, texelM, waterAt);
    heights = wRes.heights;
    stats.touched += wRes.stats.touched;
    stats.maxDropM = Math.max(stats.maxDropM, wRes.stats.maxDropM);
    stats.maxRaiseM = Math.max(stats.maxRaiseM, wRes.stats.maxRaiseM);
  }
  // 건물 발자국은 수면을 맞춘 뒤에 — 물가 건물의 바닥을 잴 고리가 출렁이는 원자료가 아니라 평평해진 수면을 보게 합니다.
  if (cover.footprints?.length) {
    // 발자국(동 x, 남 z, m) → 고도 격자 칸 좌표. coverAt 와 같은 대응: g = ((i + 0.5) / 256 − observerU) · tileSpanM.
    const px = DEM_TILE_SIZE_PX / patch.tileSpanM;
    const polys = cover.footprints.map((fp) => {
      const q = new Float32Array(fp.length);
      for (let t = 0; t < fp.length; t += 2) {
        q[t] = fp[t] * px + patch.observerU * DEM_TILE_SIZE_PX;
        q[t + 1] = fp[t + 1] * px + patch.observerV * DEM_TILE_SIZE_PX;
      }
      return q;
    });
    const fRes = flattenFootprints(heights, n, texelM, polys);
    heights = fRes.heights;
    stats.touched += fRes.stats.touched;
    stats.maxDropM = Math.max(stats.maxDropM, fRes.stats.maxDropM);
    stats.maxRaiseM = Math.max(stats.maxRaiseM, fRes.stats.maxRaiseM);
  }
  // 도로·인도 노면 고도 다림질: DEM 칸(약 15~19 m)에 남은 건물·가로수 고도 번짐 때문에 직선 도로가
  // 위아래·좌우로 출렁이거나 도로 한가운데 가짜 언덕 그림자가 생기는 것을 막습니다.
  if (cover.pave) {
    const pv = cover.pave;
    const pScale = pv.size / (2 * pv.halfM);
    const roadW = new Float32Array(n * n);
    let rx0 = n, rx1 = -1, ry0 = n, ry1 = -1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let maxP = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const gx = ((i + (sx + 0.5) / 3) / DEM_TILE_SIZE_PX - patch.observerU) * patch.tileSpanM;
        const gz = ((j + (sy + 0.5) / 3) / DEM_TILE_SIZE_PX - patch.observerV) * patch.tileSpanM;
        const cx = Math.floor((gx + pv.halfM) * pScale), cy = Math.floor((gz + pv.halfM) * pScale);
        if (cx < 0 || cy < 0 || cx >= pv.size || cy >= pv.size) continue;
        const o = (cy * pv.size + cx) * 2;
        const v = Math.max(pv.data[o], pv.data[o + 1]) / 255;
        if (v > maxP) maxP = v;
      }
      const w = smoothstep(0.25, 0.55, maxP);
      roadW[j * n + i] = w;
      if (w > 0.01) {
        if (i < rx0) rx0 = i;
        if (i > rx1) rx1 = i;
        if (j < ry0) ry0 = j;
        if (j > ry1) ry1 = j;
      }
    }
    if (rx1 >= 0) {
      const rRoad = Math.max(2, Math.round(45 / texelM));
      // 도로 주변의 솟은 봉우리(건물·나무 잔여분)를 한 번 더 깎고 넓은 평균으로 노면 경사를 완만하게 이어 줍니다.
      let smoothRoad = rankFilter(
        heights,
        n,
        Math.max(1, Math.round(25 / texelM)),
        true,
        Math.max(0, ry0 - rRoad),
        Math.min(n - 1, ry1 + rRoad),
        Math.max(0, rx0 - rRoad),
        Math.min(n - 1, rx1 + rRoad),
      );
      smoothRoad = rankFilter(
        smoothRoad,
        n,
        Math.max(1, Math.round(25 / texelM)),
        false,
        Math.max(0, ry0 - rRoad),
        Math.min(n - 1, ry1 + rRoad),
        Math.max(0, rx0 - rRoad),
        Math.min(n - 1, rx1 + rRoad),
      );
      smoothRoad = boxBlur(smoothRoad, n, rRoad);
      smoothRoad = boxBlur(smoothRoad, n, Math.max(1, Math.round(rRoad * 0.6)));
      const rwBlur = boxBlur(roadW, n, 1);
      for (let k = 0; k < n * n; k++) {
        const wk = Math.max(roadW[k], rwBlur[k] * 0.75);
        if (wk <= 0.01) continue;
        const v = heights[k] + wk * (smoothRoad[k] - heights[k]);
        const d = heights[k] - v;
        heights[k] = v;
        stats.touched++;
        if (d > stats.maxDropM) stats.maxDropM = d;
        if (-d > stats.maxRaiseM) stats.maxRaiseM = -d;
      }
    }
  }
  if (stats.touched === 0) { patch.flattenedBy = cover; return stats; }
  const out = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const o = k * 4;
    if (rgba[o + 3] === 0) continue;   // 타일이 비었던 자리는 그대로(투명)
    const v = Math.max(0, Math.min(16777215, Math.round((heights[k] + 32768) * 256)));
    out[o] = (v >> 16) & 255;
    out[o + 1] = (v >> 8) & 255;
    out[o + 2] = v & 255;
    out[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  patch.flattenedTexture?.dispose();
  patch.flattenedTexture = tex;
  patch.texture = tex;
  patch.flattenedBy = cover;
  return stats;
}
