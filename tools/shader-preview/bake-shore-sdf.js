/**
 * **물가를 부호거리장(SDF)으로 다시 세워 DEM 타일을 굽습니다.**
 *
 * 사용자 물음: "등고선 데이터를 기반으로 만들면 특히 수면과 이어지는 부분이
 * 이쁘게 그려지지 않을까?"
 *
 * ## 왜 지금 각지나
 *
 * 대부도 근거리 DEM(줌 13, 화소 15.21m) 78.6만 화소 중 **41.38% 가 정확히
 * 0** 입니다 — Terrarium 이 먼바다를 그렇게 자릅니다. 그 고원 안에서는
 * 기울기가 정확히 0 이라 **텍셀 안 어디에 물가가 있는지에 대한 정보가
 * 아예 없습니다.** 그래서 0 등고선이 곡선이 아니라 텍셀 모서리를 따라갑니다.
 *
 * ⚠ 예전에 **고도를 매끄럽게** 해서 물가를 갈라 봤습니다. 2.286 → 2.571 로
 * 오히려 나빠졌습니다. 고원 위에서 고도를 흐려 봐야 여전히 0 이라 등고선이
 * 다른 모서리로 옮겨갈 뿐입니다.
 *
 * ## 거리장은 다른 물건입니다
 *
 * 고도장은 고원 위에서 기울기가 0 이지만 **거리장은 어디서나 기울기가 1**
 * 입니다. 그리고 계단은 매끄러운 곡선을 텍셀로 양자화한 결과이므로, 거리장을
 * 저역통과시키면 그 **곡선이 되살아납니다** (디더링을 흐려 원 신호를 되찾는
 * 것과 같은 이치). 고도를 흐리는 것과 근본적으로 다릅니다.
 *
 * ## 하는 일
 *
 * 1. 3×3 타일을 하나의 768×768 고도판으로 합칩니다.
 * 2. 뭍(h > 0) / 물(h ≤ 0) 로 갈라 **정확한 유클리드 거리변환**(Felzenszwalb)
 *    을 양쪽으로 돌려 부호거리장을 만듭니다.
 * 3. 가우시안으로 저역통과시킵니다 — 여기서 계단이 곡선으로 돌아옵니다.
 * 4. 물가 띠(|sdf| ≤ R) 안에서만 고도를 `s·sdf` 로 다시 세웁니다. s 는
 *    그 띠의 실제 고도-거리 관계를 최소제곱으로 맞춘 값이라 **수심이 그대로
 *    물리적입니다** — 0 교차만 옮기고 깊이는 지어내지 않습니다.
 * 5. Terrarium 인코딩 그대로 타일로 다시 씁니다.
 *
 * 렌더러는 **한 줄도 안 건드립니다.** 자료만 바꿔 A/B 하려는 것이므로,
 * 나아진다면 그것은 자료 구조가 원인이었다는 뜻입니다.
 *
 * 사용: node tools/shader-preview/bake-shore-sdf.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

const LAT = 37.24102, LON = 126.55969, BLOCK = 3, FIELD_FAR_M = 3000;
const SRC = 'dem', DST = 'dem-sdf';
/** 물가 띠 반폭 (m). 이 밖은 원래 고도 그대로입니다. */
const BAND_M = 90;
/** 거리장 저역통과 폭 (텍셀). 계단 한 칸이 1 텍셀이므로 그 언저리로 잡습니다. */
const SIGMA_TX = 1.6;
const TILE = 256;

/** Felzenszwalb & Huttenlocher (2012) 1차원 제곱거리 변환. 정확하고 O(n). */
function edt1d(f, n) {
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  return d;
}

/** 씨앗(seed[i] === true)까지의 유클리드 거리 (텍셀). */
function edt2d(seed, W, H) {
  const INF = 1e20;
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = seed[i] ? 0 : INF;
  const col = new Float64Array(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = g[y * W + x];
    const d = edt1d(col, H);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  const row = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) row[x] = g[y * W + x];
    const d = edt1d(row, W);
    for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(d[x]);
  }
  return g;
}

/** 분리 가능한 가우시안. 가장자리는 값을 물고 늘립니다(clamp). */
function blur(src, W, H, sigma) {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float64Array(W * H), out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * src[y * W + Math.min(W - 1, Math.max(0, x + i))];
    tmp[y * W + x] = a;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += k[i + r] * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x];
    out[y * W + x] = a;
  }
  return out;
}

const zoom = D.demZoomForRadius(FIELD_FAR_M, LAT, BLOCK);
const t = D.lonLatToTileFloat(LON, LAT, zoom);
const { originX, originY } = D.pickBlockOrigin(t.x, t.y, BLOCK);
const pxM = D.tileSpanMetres(zoom, LAT) / TILE;
const W = BLOCK * TILE, H = BLOCK * TILE;

const srcDir = path.join(PREVIEW, SRC), dstDir = path.join(PREVIEW, DST);
fs.mkdirSync(dstDir, { recursive: true });

// ── 1. 합치기 ──────────────────────────────────────────────────────────────
const elev = new Float64Array(W * H);
for (let ty = 0; ty < BLOCK; ty++) for (let tx = 0; tx < BLOCK; tx++) {
  const f = path.join(srcDir, `${zoom}_${originX + tx}_${originY + ty}.png`);
  const p = PNG.sync.read(fs.readFileSync(f));
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const o = (y * TILE + x) * 4;
    elev[(ty * TILE + y) * W + (tx * TILE + x)] =
      p.data[o] * 256 + p.data[o + 1] + p.data[o + 2] / 256 - 32768;
  }
}

// ── 2. 부호거리장 ──────────────────────────────────────────────────────────
const land = new Uint8Array(W * H), water = new Uint8Array(W * H);
let nLand = 0;
for (let i = 0; i < W * H; i++) { const l = elev[i] > 0; land[i] = l ? 1 : 0; water[i] = l ? 0 : 1; if (l) nLand++; }
if (nLand === 0 || nLand === W * H) throw new Error('물가가 없습니다 — 이 블록은 통째로 한 갈래입니다');
const dToWater = edt2d(water, W, H);   // 뭍 화소에서 물까지
const dToLand = edt2d(land, W, H);     // 물 화소에서 뭍까지
const sdfTx = new Float64Array(W * H);
// 반 텍셀을 빼서 등고선을 두 갈래의 **사이**에 놓습니다.
for (let i = 0; i < W * H; i++) sdfTx[i] = land[i] ? (dToWater[i] - 0.5) : -(dToLand[i] - 0.5);

// ── 3. 저역통과 — 여기서 계단이 곡선으로 돌아옵니다 ────────────────────────
const sdfBlurTx = blur(sdfTx, W, H, SIGMA_TX);

// ── 4. 띠 안에서만 고도를 다시 세웁니다 ────────────────────────────────────
//
// s 는 지어낸 값이 아니라 **그 띠의 실제 고도-거리 관계**를 최소제곱으로
// 맞춘 기울기입니다. 그래야 0 교차만 옮기고 수심은 물리 그대로 남습니다.
let sxy = 0, sxx = 0, nBand = 0;
for (let i = 0; i < W * H; i++) {
  const dM = sdfBlurTx[i] * pxM;
  if (Math.abs(dM) > BAND_M) continue;
  sxy += elev[i] * dM; sxx += dM * dM; nBand++;
}
const slope = sxx > 0 ? sxy / sxx : 0.02;

const out = new Float64Array(W * H);
let moved = 0, maxMove = 0;
for (let i = 0; i < W * H; i++) {
  const dM = sdfBlurTx[i] * pxM;
  const a = Math.abs(dM);
  if (a >= BAND_M) { out[i] = elev[i]; continue; }
  const tt = a / BAND_M;
  const w = tt * tt * (3 - 2 * tt);          // 띠 가장자리에서 원래 고도로 매끄럽게
  out[i] = w * elev[i] + (1 - w) * (slope * dM);
  const d = Math.abs(out[i] - elev[i]);
  if (d > 0.01) moved++;
  if (d > maxMove) maxMove = d;
}

// 갈래가 바뀐 화소 — 0 교차가 실제로 옮겨간 양
let flipped = 0;
for (let i = 0; i < W * H; i++) if ((elev[i] > 0) !== (out[i] > 0)) flipped++;

// ── 5. Terrarium 으로 되쓰기 ───────────────────────────────────────────────
const enc = (e) => {
  let v = Math.min(65535.996, Math.max(0, e + 32768));
  let R = Math.floor(v / 256);
  let rem = v - R * 256;
  let G = Math.floor(rem);
  let B = Math.round((rem - G) * 256);
  if (B > 255) { B = 0; G++; }
  if (G > 255) { G = 0; R++; }
  return [Math.min(255, R), G, B];
};
for (let ty = 0; ty < BLOCK; ty++) for (let tx = 0; tx < BLOCK; tx++) {
  const png = new PNG({ width: TILE, height: TILE });
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const [R, G, B] = enc(out[(ty * TILE + y) * W + (tx * TILE + x)]);
    const o = (y * TILE + x) * 4;
    png.data[o] = R; png.data[o + 1] = G; png.data[o + 2] = B; png.data[o + 3] = 255;
  }
  fs.writeFileSync(path.join(dstDir, `${zoom}_${originX + tx}_${originY + ty}.png`), PNG.sync.write(png));
}

// 되읽어 인코딩이 무손실인지 확인합니다 — 여기서 어긋나면 A/B 가 거짓말입니다.
let encErr = 0;
for (let ty = 0; ty < BLOCK; ty++) for (let tx = 0; tx < BLOCK; tx++) {
  const p = PNG.sync.read(fs.readFileSync(path.join(dstDir, `${zoom}_${originX + tx}_${originY + ty}.png`)));
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const o = (y * TILE + x) * 4;
    const e = p.data[o] * 256 + p.data[o + 1] + p.data[o + 2] / 256 - 32768;
    encErr = Math.max(encErr, Math.abs(e - out[(ty * TILE + y) * W + (tx * TILE + x)]));
  }
}

console.log(`줌 ${zoom} · ${BLOCK}×${BLOCK} 타일 · 화소 ${pxM.toFixed(2)}m`);
console.log(`뭍 ${(100 * nLand / (W * H)).toFixed(2)}% · 물가 띠(±${BAND_M}m) ${nBand} 화소`);
console.log(`띠의 고도-거리 기울기 s = ${slope.toFixed(5)} m/m (1:${(1 / slope).toFixed(0)} 경사)`);
console.log(`고도가 바뀐 화소 ${moved} (${(100 * moved / (W * H)).toFixed(2)}%) · 최대 ${maxMove.toFixed(2)}m`);
console.log(`뭍↔물 갈래가 바뀐 화소 ${flipped} (${(100 * flipped / (W * H)).toFixed(3)}%)`);
console.log(`인코딩 왕복 오차 ${encErr.toFixed(5)}m`);
console.log(`생성: ${dstDir}`);
