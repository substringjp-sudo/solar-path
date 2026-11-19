/**
 * DEM 패치 → CPU 높이 표본기 (2026-11-19, 샌드박스 고르기).
 *
 * 앱의 고도는 GPU 텍스처(Terrarium RGB)에만 있어서, 한 번 읽어 `HeightSampler`(utils/demPick.ts)로 만듭니다.
 * 건물 자리를 깎은 패치(`flattenedTexture`)가 있으면 그 자료를, 없으면 렌더 타깃을 읽습니다(건물 자리 깎기와 같은 읽기).
 * 패치(또는 깎은 텍스처)가 같은 동안은 다시 읽지 않습니다.
 *
 * 칸 ↔ 지상 좌표는 demBuildingFlatten.ts 와 같습니다: 열 i = 동, 행 j = 남, 칸 중심 = +0.5,
 * g = ((i + 0.5) / 256 − observerU) · tileSpanM.
 */
import type * as THREE from 'three';
import type { DemPatch } from './demTiles';
import type { HeightSampler } from './demPick';

const DEM_TILE_SIZE_PX = 256;

interface Cached { src: object; n: number; rgba: Uint8Array }
const cache = new WeakMap<DemPatch, Cached>();

function readRgba(renderer: THREE.WebGLRenderer, patch: DemPatch): Cached | null {
  const n = DEM_TILE_SIZE_PX * patch.blockTiles;
  const flat = patch.flattenedTexture;
  if (flat && (flat.image as { data?: Uint8Array } | undefined)?.data) {
    return { src: flat, n, rgba: (flat.image as { data: Uint8Array }).data };
  }
  const target = patch.target;
  if (!target || typeof renderer.readRenderTargetPixels !== 'function') return null;
  const rgba = new Uint8Array(n * n * 4);
  try {
    renderer.readRenderTargetPixels(target, 0, 0, n, n, rgba);
  } catch {
    return null;
  }
  return { src: target, n, rgba };
}

/** 패치의 높이 표본기. 읽지 못하면 null. 해발 m, 비어 있는 칸(투명)은 null. */
export function makeDemSampler(renderer: THREE.WebGLRenderer, patch: DemPatch): HeightSampler | null {
  let c = cache.get(patch);
  const want = patch.flattenedTexture ?? patch.target;
  if (!c || c.src !== want) {
    const fresh = readRgba(renderer, patch);
    if (!fresh) return null;
    cache.set(patch, fresh);
    c = fresh;
  }
  const { n, rgba } = c;
  const cell = (i: number, j: number): number | null => {
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    const o = (j * n + i) * 4;
    if (rgba[o + 3] === 0) return null;
    return rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768;
  };
  const span = patch.tileSpanM;
  return (eastM, southM) => {
    // 칸 좌표(소수): 칸 i 의 중심이 정수 + 0.5 이므로 연속 좌표 − 0.5 가 칸 번호.
    const fi = (eastM / span + patch.observerU) * DEM_TILE_SIZE_PX - 0.5;
    const fj = (southM / span + patch.observerV) * DEM_TILE_SIZE_PX - 0.5;
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const a = cell(i0, j0), b = cell(i0 + 1, j0), cc = cell(i0, j0 + 1), d = cell(i0 + 1, j0 + 1);
    if (a == null || b == null || cc == null || d == null) return a ?? b ?? cc ?? d;
    const tx = fi - i0, ty = fj - j0;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
  };
}
