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

/** demTiles.ts 의 DEM_TILE_SIZE_PX 와 같음(그 모듈은 앱 의존성을 끌어와 시험에서 못 읽으므로 값만). */
const DEM_TILE_SIZE_PX = 256;

/** 건물 덮개 격자(0/255). 행 = +Z 남, 열 = +X 동, 관측자 중심 ±halfM. */
export interface BuildingCover {
  size: number;
  halfM: number;
  data: Uint8Array;
}

/** 형태학 창 반폭(m). 창 한 변 ≈ 2·이 값 + 칸 하나. 도심 건물(대개 한 변 100 m 아래)보다 크게. */
export const FLATTEN_WINDOW_HALF_M = 70;
/** 건물 밀도를 재는 둘레 반폭(m). */
export const FLATTEN_DENSITY_HALF_M = 100;
/** 건물 밀도(덮개 비율) → 깎는 정도. 이 사이에서 0 → 1. */
export const FLATTEN_DENSITY_RAMP: [number, number] = [0.06, 0.2];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
  const { heights, stats } = flattenHeights(h, n, texelM, coverAt);
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
