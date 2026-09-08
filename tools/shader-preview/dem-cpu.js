/**
 * **DEM 을 CPU 로 직접 푸는 참조 구현** (판정 전용).
 *
 * 앱은 PNG 를 텍스처로 올려 셰이더에서 풉니다. 여기서는 Node 가 PNG 를 풀어
 * 경위도 → 전역 타일화소 → 쌍선형 → Terrarium 을 **따로** 구현합니다. 두 길이
 * 겹치는 데가 없어야 판정이 뜻을 갖습니다 — 실제로 이 비교가 합성 뒤집기
 * 결함(최대 137m)을 잡았습니다.
 *
 * ⚠ GPU 와 같은 화소를 짚어야 합니다. 합친 텍스처의 texel 좌표는
 * `블록내좌표 · 256 − 0.5` 이고, 그건 전역 타일화소 `타일좌표 · 256 − 0.5`
 * 와 같습니다. 그래서 블록 배치를 아예 안 거치고 전역 좌표로만 셉니다.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const EARTH_C = 40075016.686;
const TILE_PX = 256;

const tileSpanMetres = (z, lat) =>
  (EARTH_C * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

function lonLatToTileFloat(lon, lat, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

/** 블록 한 변이 홀수일 때 관측자 타일이 정중앙에 오는 원점. */
function pickBlockOrigin(tx, ty, block) {
  const half = (block - 1) / 2;
  return { originX: Math.floor(tx) - half, originY: Math.floor(ty) - half };
}

/**
 * 보장되는 여유는 블록 한 변이 아니라 **(한 변 − 1) / 2 타일** 입니다.
 * `src/utils/demTiles.ts` 와 같은 식이어야 합니다.
 */
function demZoomForRadius(radiusM, lat, block, maxZoom = 14) {
  const margin = (block - 1) / 2;
  for (let z = maxZoom; z >= 4; z--) {
    if (tileSpanMetres(z, lat) * margin >= radiusM) return z;
  }
  return 4;
}

/**
 * `demDir` 에 받아 둔 `{z}_{x}_{y}.png` 들을 읽어 고도를 재는 함수들을 만듭니다.
 *
 * 반환하는 `elevAtGround(east, south)` 는 셰이더의 `dem_elevationAt` 과 같은
 * 뜻입니다 — 관측자를 원점으로 한 지상 미터 좌표(+동, +남).
 */
function makeCpuDem({ demDir, zoom, lat, lon }) {
  const span = tileSpanMetres(zoom, lat);
  const t = lonLatToTileFloat(lon, lat, zoom);
  const cache = {};

  const pixel = (px, py) => {
    const tx = Math.floor(px / TILE_PX);
    const ty = Math.floor(py / TILE_PX);
    const k = `${zoom}_${tx}_${ty}`;
    if (!cache[k]) {
      const f = path.join(demDir, k + '.png');
      if (!fs.existsSync(f)) return null;
      cache[k] = PNG.sync.read(fs.readFileSync(f));
    }
    const p = cache[k];
    const o = ((py - ty * TILE_PX) * TILE_PX + (px - tx * TILE_PX)) * 4;
    const d = p.data;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };

  const elevAtTileFloat = (fx, fy) => {
    const gx = fx * TILE_PX - 0.5;
    const gy = fy * TILE_PX - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const ax = gx - x0;
    const ay = gy - y0;
    const p00 = pixel(x0, y0);
    const p10 = pixel(x0 + 1, y0);
    const p01 = pixel(x0, y0 + 1);
    const p11 = pixel(x0 + 1, y0 + 1);
    if (p00 === null || p10 === null || p01 === null || p11 === null) return null;
    return (
      p00 * (1 - ax) * (1 - ay) +
      p10 * ax * (1 - ay) +
      p01 * (1 - ax) * ay +
      p11 * ax * ay
    );
  };

  return {
    tileSpanM: span,
    observerTile: t,
    /** 지상 m (동, 남) → 고도 m. 블록 밖이면 null. */
    elevAtGround: (east, south) =>
      elevAtTileFloat(t.x + east / span, t.y + south / span),
    /** 경위도 → 고도 m. */
    elevAtLonLat: (lo, la) => {
      const q = lonLatToTileFloat(lo, la, zoom);
      return elevAtTileFloat(q.x, q.y);
    },
    /** 지상 m → 경위도 (표본점을 다른 자료원에 물어볼 때). */
    groundToLonLat: (east, south) => {
      const n = 2 ** zoom;
      const tx = t.x + east / span;
      const ty = t.y + south / span;
      return {
        lon: (tx / n) * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI,
      };
    },
  };
}

module.exports = {
  EARTH_C, TILE_PX, tileSpanMetres, lonLatToTileFloat,
  pickBlockOrigin, demZoomForRadius, makeCpuDem,
};
