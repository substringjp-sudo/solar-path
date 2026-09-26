/**
 * **DEM 타일을 CPU 로 풉니다** — AR 화면 보정(`arVision.ts`)이 지평선을 구하는 데 씁니다.
 *
 * 앱의 지형은 타일 PNG 를 GPU 텍스처로 올려 셰이더에서 풉니다(`demTiles.ts`). 그런데 AR 보정은
 * 방위마다 지평선 앙각을 **JS 에서** 알아야 합니다. 여기서는 디코드를 바깥에서 받습니다 —
 * 앱은 Skia(`Skia.Image.MakeImageFromEncoded(...).readPixels()`), 판정은 pngjs. 그래서 이 파일은
 * 플랫폼에 기대지 않고, 판정이 `tools/shader-preview/dem-cpu.js` 와 **값이 같음**을 직접 잽니다.
 *
 * 좌표는 `demTiles.ts` · `dem-cpu.js` 와 같습니다 — 전역 타일화소 `타일좌표·256 − 0.5` 에서 쌍선형,
 * Terrarium `R·256 + G + B/256 − 32768`.
 */
import { demTileUrl, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin, tileSpanMetres, DEM_BLOCK_TILES } from './demTiles';
import type { GroundElevation } from './arVision';

const TILE_PX = 256;

/** 타일 하나의 RGBA 화소(256×256×4, 위에서부터). 못 받았으면 null. */
export type TileDecoder = (url: string) => Promise<Uint8Array | null>;

export interface CpuDemBlock {
  zoom: number;
  /** 관측자 기준 지상 좌표(+동, +남, m)의 고도. 블록 밖이면 null. */
  elevAtGround: GroundElevation;
  /** 받은 타일 수 / 요청한 타일 수. */
  coverage: number;
}

/** 이미 푼 타일들로 고도 함수를 만듭니다. `tiles` 의 키는 `${z}_${x}_${y}`. */
export function makeTerrariumSampler(
  tiles: Map<string, Uint8Array>, zoom: number, lat: number, lon: number,
): GroundElevation {
  const span = tileSpanMetres(zoom, lat);
  const t = lonLatToTileFloat(lon, lat, zoom);
  const pixel = (px: number, py: number): number | null => {
    const tx = Math.floor(px / TILE_PX), ty = Math.floor(py / TILE_PX);
    const d = tiles.get(`${zoom}_${tx}_${ty}`);
    if (!d) return null;
    const o = ((py - ty * TILE_PX) * TILE_PX + (px - tx * TILE_PX)) * 4;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  return (east, south) => {
    const gx = (t.x + east / span) * TILE_PX - 0.5;
    const gy = (t.y + south / span) * TILE_PX - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const ax = gx - x0, ay = gy - y0;
    const p00 = pixel(x0, y0), p10 = pixel(x0 + 1, y0), p01 = pixel(x0, y0 + 1), p11 = pixel(x0 + 1, y0 + 1);
    if (p00 === null || p10 === null || p01 === null || p11 === null) return null;
    return p00 * (1 - ax) * (1 - ay) + p10 * ax * (1 - ay) + p01 * (1 - ax) * ay + p11 * ax * ay;
  };
}

/** `loadDemPatch` 와 같은 블록(같은 줌 · 같은 원점)을 CPU 로 받습니다. */
export async function loadCpuDemBlock(
  lat: number, lon: number, radiusM: number, decode: TileDecoder,
  opts: { block?: number; tileUrl?: (z: number, x: number, y: number) => string } = {},
): Promise<CpuDemBlock | null> {
  const block = opts.block ?? DEM_BLOCK_TILES;
  const zoom = demZoomForRadius(radiusM, lat, { block });
  const t = lonLatToTileFloat(lon, lat, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, block);
  const tiles = new Map<string, Uint8Array>();
  let got = 0;
  const jobs: Promise<void>[] = [];
  for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) {
    const x = originX + dx, y = originY + dy;
    jobs.push((async () => {
      try {
        const px = await decode((opts.tileUrl ?? demTileUrl)(zoom, x, y));
        if (px && px.length >= TILE_PX * TILE_PX * 4) { tiles.set(`${zoom}_${x}_${y}`, px); got++; }
      } catch { /* 한 장 실패는 구멍으로 둡니다 */ }
    })());
  }
  await Promise.all(jobs);
  if (got === 0) return null;
  return { zoom, elevAtGround: makeTerrariumSampler(tiles, zoom, lat, lon), coverage: got / (block * block) };
}

/** 촘촘한 블록(발밑~수 km) → 없으면 성긴 블록(~60km). 앱의 지형 격자와 같은 배치입니다. */
export function combineSamplers(fine: GroundElevation | null, coarse: GroundElevation | null): GroundElevation {
  return (e, s) => (fine ? fine(e, s) : null) ?? (coarse ? coarse(e, s) : null);
}
