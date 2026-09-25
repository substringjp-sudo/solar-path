/**
 * **해 뜨는 능선 위에 구름이 사라지는가** (§94) — 사용자 화면 1번의 재현.
 *
 * > "아침에 지평선 너머까지 구름이 가득 찼고 … 해가 구름보다 앞에 위치하고 그 부분도
 * >  마치 태양이 구름 아래에 있는 것처럼 빛이 생겨."   — 2026-09-25 05:48, 요네자와
 *
 * 그 시각 예보는 해 뜨는 쪽(방위 93°) 0~360km 가 상층 70~100%, 100km 까지 중층
 * 77~100% 였습니다(ecmwf·icon 둘 다). 해(2.85°)는 가려져야 하는데 화면은 능선 바로
 * 위에 금빛으로 트인 띠가 있고 해가 그 안에 떠 있었습니다.
 *
 * 요네자와 동쪽은 오우 산맥이라 능선이 고도각 2~3° 로 솟습니다. 그 능선 바로 위의
 * 하늘 화소는 셰이더가 지형을 걸어 **구름이 지형보다 멀면 안 그립니다**(§84). 여기
 * 거짓 가림이 있으면 능선 위에 트인 띠가 생깁니다.
 *
 * 이 판은 해 쪽을 보고(방위 93°, 피치 3°, 세로 20°) 가림 켬·끔의 광학두께를 화소마다
 * 냅니다. CPU 로 DEM 을 따로 걸어 각 화소 시선이 **실제로** 지형에 막히는지도 냅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-sunrise-ridge.js
 *       node tools/shader-preview/verify-sunrise-ridge.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { makeCpuDem, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin } = require('./dem-cpu');

/** 요네자와 시내. 관측자는 이 자리 DEM 위 1.6m. */
const LAT = 37.9220, LON = 140.1170, DIR = 'dem-yonezawa';
const BLOCK = 3, FINE_M = 3000, FAR_M = 60000, EYE_M = 1.6;
const SUN_ALT = 2.85, SUN_AZ = 92.9;
const CAM_AZ = 93, CAM_PITCH = 3;
const W = 240, H = 160, FOV = 20, STRIDE = 2;

const get = (url) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode}`)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

async function fetchBlock(radiusM) {
  const zoom = demZoomForRadius(radiusM, LAT, BLOCK);
  const t = lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);
  const demDir = path.join(PREVIEW, DIR);
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, await get(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
  }
  return zoom;
}

(async () => {
  const zFine = await fetchBlock(FINE_M);
  const zFar = await fetchBlock(FAR_M);
  const fine = makeCpuDem({ demDir: path.join(PREVIEW, DIR), zoom: zFine, lat: LAT, lon: LON });
  const eyeM = fine.elevAtGround(0, 0) + EYE_M;
  console.log(`줌 ${zFine}/${zFar} · 눈높이 ${eyeM.toFixed(1)}m`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
try {
const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK}, EYE_M=${eyeM};
const W=${W}, H=${H}, FOV=${FOV}, STRIDE=${STRIDE};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ}, CAM_AZ=${CAM_AZ}, CAM_PITCH=${CAM_PITCH};
const glCanvas = document.createElement('canvas'); glCanvas.width=W; glCanvas.height=H;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:true, premultipliedAlpha:true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
const gl = renderer.getContext();
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
clearDemCache();
const opts = { renderer, loadTexture, block: BLOCK, tileUrl:(z,x,y)=>\`./\${DIR}/\${z}_\${x}_\${y}.png\` };
const fine = await loadDemPatch(LAT, LON, ${FINE_M}, opts);
const far  = await loadDemPatch(LAT, LON, ${FAR_M}, opts);
if (!fine || !far) errors.push('패치 없음');
const atmosphere = makeAtmosphereParams({ latitude: LAT, observerElevM: EYE_M, dayOfYear: 268, humidityPct: 70, visibilityM: 25000 });
const D = Math.PI/180;
const dirOf = (alt, az) => new THREE.Vector3(Math.cos(alt*D)*Math.sin(az*D), Math.sin(alt*D), -Math.cos(alt*D)*Math.cos(az*D)).normalize();
const cam = new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000); cam.position.set(0,0,0);
{ const v = dirOf(CAM_PITCH, CAM_AZ); cam.lookAt(v.x*100, v.y*100, v.z*100); cam.updateMatrixWorld(true); }

function shoot(occludeSky, cover){
  const scene = new THREE.Scene();
  const slab = createCloudSlab(); scene.add(slab.mesh);
  slab.setLayerAltitudesKm(1.5, 4.5, 10.0);
  slab.setDemPatches(fine, far, renderer);
  slab.material.uniforms.uTerrainOccludeSky.value = occludeSky ? 1 : 0;
  bakeCloudSlabCoverage(slab, () => ({ low: cover[0], mid: cover[1], high: cover[2], confidence: 1 }));
  const wd = { speedKmh: 0, bearingDeg: 0 };
  updateCloudSlab(slab, { camera: cam, widthPx: W, heightPx: H, sunDir: dirOf(SUN_ALT, SUN_AZ),
    sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor: (k) => beamAtAltitude(SUN_ALT, k, atmosphere), atmosphere,
    layerWinds: { low: wd, mid: wd, high: wd }, driftHours: 0, visible: true, dataOut: 2 });
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*W*H);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  slab.dispose?.();
  return buf;
}
const COVER = [0.2, 0.9, 0.95];
const on = shoot(true, COVER), off = shoot(false, COVER);
const samples = [];
for (let y = STRIDE/2; y < H; y += STRIDE) for (let x = STRIDE/2; x < W; x += STRIDE) {
  const ndc = new THREE.Vector3((x+0.5)/W*2-1, (y+0.5)/H*2-1, 0.5).unproject(cam).normalize();
  const i = (y*W+x)*4;
  samples.push([+ndc.x.toFixed(6), +ndc.y.toFixed(6), +ndc.z.toFixed(6), on[i+3]/255, off[i+3]/255]);
}
// 해 자리 화소
const sp = dirOf(SUN_ALT, SUN_AZ).clone().project(cam);
const sx = Math.round((sp.x+1)/2*W - 0.5), sy = Math.round((sp.y+1)/2*H - 0.5);
const si = (sy*W+sx)*4;
window.__stats = { glError: gl.getError(), eyeM: EYE_M, samples, 해: { x: sx, y: sy, 켬: on[si+3]/255, 끔: off[si+3]/255 } };
} catch (e) { errors.push('예외: ' + (e && e.stack || e)); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

  fs.writeFileSync(path.join(PREVIEW, 'sunrise-ridge.html'), html);
  fs.writeFileSync(path.join(PREVIEW, 'sunrise-ridge.json'),
    JSON.stringify({ LAT, LON, DIR, zFine, zFar, eyeM, FINE_M, FAR_M, BLOCK }));
  console.log('생성 완료: sunrise-ridge.html');
})();
