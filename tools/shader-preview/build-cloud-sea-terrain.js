/**
 * **운해를 땅이 가리는가** (§83) — 산 위에서 내려다볼 때.
 *
 * 구름은 지형 **위에** 합성됩니다(깊이 없음). 그래서 운해를 켜자 발밑 사면과
 * 덱 위로 솟은 이웃 봉우리까지 구름이 덮었습니다. 셰이더가 이제 운해 화소마다
 * 시선을 지형 높이장과 견줍니다. 이 판이 그 결과를 **CPU 참조**와 대조합니다.
 *
 * ## 자리 — 덕유산 향적봉(1,614m)
 *
 * 사용자의 상황(해발 1,600m 산 위)과 같은 높이의 진짜 봉우리입니다. 주능선
 * (중봉 1,594m · 무룡산 1,492m)이 덱 위로 솟고, 골짜기는 500~900m 입니다.
 * 덱은 0.8~1.2km — 골짜기는 잠기고 능선은 남습니다.
 *
 * ## 자
 *
 * 슬랩만 그립니다(지형 메시 없음) — 자료 출구(dataOut 2)의 τ 로 "이 화소에
 * 운해가 있는가" 를 읽습니다. 표본 화소마다 **시선 방향**을 같이 내보내고,
 * 판정 쪽(Node)이 같은 DEM 타일을 **독립 구현**(dem-cpu.js)으로 풀어 시선을
 * 촘촘히(400걸음) 따라가며 "땅이 먼저인가 덱이 먼저인가" 를 냅니다.
 *
 * 운량은 100% 입니다 — 구멍이 있으면 "구름이 없다" 가 가림인지 틈인지 모릅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-sea-terrain.js
 *       node tools/shader-preview/verify-cloud-sea-terrain.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { makeCpuDem, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin } = require('./dem-cpu');

/**
 * 덕유산 향적봉 부근. ⚠ 이 좌표의 DEM 은 1,602m 로 **정상 옆 사면**이었고,
 * 눈높이 1.6m 에서는 10~20m 앞 땅이 낮은 시선을 전부 막았습니다. 산 위에
 * 서 있는 장면을 재려고 150m 안의 **DEM 최고점**으로 옮겨 섭니다(아래).
 */
const LAT0 = 35.8597, LON0 = 127.7461, DIR = 'dem-deogyu';
const BLOCK = 3, FINE_M = 3000, FAR_M = 60000, EYE_M = 1.6;
/** 덱 밑면·윗면 (km). 가중 평균(lowKm)은 그 가운데. */
const DECK = [0.8, 1.2];
const W = 200, H = 200, FOV = 60, STRIDE = 4;
/** (방위, 피치). 발밑 사면·골짜기·먼 능선이 다 들어오도록. */
const VIEWS = [[0, -12], [90, -12], [180, -12], [270, -12], [200, -45], [30, -4],
  [0, -3], [120, -3], [240, -3]];

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

let LAT = LAT0, LON = LON0;

(async () => {
  // 처음 자리로 받아 최고점을 찾고, 그 자리로 옮겨 **다시** 받습니다(블록이 바뀔 수 있음).
  let zFine = await fetchBlock(FINE_M);
  {
    const d0 = makeCpuDem({ demDir: path.join(PREVIEW, DIR), zoom: zFine, lat: LAT, lon: LON });
    let best = { h: -1e9, e: 0, s: 0 };
    for (let e = -150; e <= 150; e += 5) for (let s = -150; s <= 150; s += 5) {
      if (Math.hypot(e, s) > 150) continue;
      const h = d0.elevAtGround(e, s);
      if (h != null && h > best.h) best = { h, e, s };
    }
    const ll = d0.groundToLonLat(best.e, best.s);
    LAT = +ll.lat.toFixed(6); LON = +ll.lon.toFixed(6);
    console.log(`최고점: 동 ${best.e}m · 남 ${best.s}m · ${best.h.toFixed(1)}m → ${LAT}, ${LON}`);
  }
  zFine = await fetchBlock(FINE_M);
  const zFar = await fetchBlock(FAR_M);
  const fine = makeCpuDem({ demDir: path.join(PREVIEW, DIR), zoom: zFine, lat: LAT, lon: LON });
  const eyeM = fine.elevAtGround(0, 0) + EYE_M;
  console.log(`줌 ${zFine}/${zFar} · 눈높이 ${eyeM.toFixed(1)}m`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px} h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px} .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>운해 × 지형 가림 — 덕유산 향적봉</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
try {
const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK};
const EYE_M=${eyeM}, DECK=${JSON.stringify(DECK)};
const W=${W}, H=${H}, FOV=${FOV}, STRIDE=${STRIDE}, VIEWS=${JSON.stringify(VIEWS)};

const glCanvas = document.createElement('canvas'); glCanvas.width=W; glCanvas.height=H;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
const gl = renderer.getContext();
const scene = new THREE.Scene();
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

clearDemCache();
const opts = { renderer, loadTexture, block: BLOCK, tileUrl:(z,x,y)=>\`./\${DIR}/\${z}_\${x}_\${y}.png\` };
const fine = await loadDemPatch(LAT, LON, ${FINE_M}, opts);
const far  = await loadDemPatch(LAT, LON, ${FAR_M}, opts);
if (!fine || !far) errors.push('패치 없음');

const atmosphere = makeAtmosphereParams({ latitude: LAT, observerElevM: EYE_M, dayOfYear: 290,
  humidityPct: 65, visibilityM: 25000 });

function shoot(az, pitch, withDem){
  const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
  slab.setLayerAltitudesKm((DECK[0]+DECK[1])/2, 4.5, 10.0);
  slab.setLowDeckKm(DECK[0], DECK[1]);
  slab.setDemPatches(withDem ? fine : null, withDem ? far : null);
  bakeCloudSlabCoverage(slab, () => ({ low: 1, mid: 0, high: 0, confidence: 1 }));
  const cam = new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const ar=az*Math.PI/180, er=pitch*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  const sunDir = new THREE.Vector3(0, Math.sin(0.35), -Math.cos(0.35)).normalize();
  const wd = { speedKmh: 0, bearingDeg: 0 };
  updateCloudSlab(slab, { camera: cam, widthPx: W, heightPx: H, sunDir, sunAltDeg: 20, sunAzDeg: 0,
    beamFor: (altKm) => beamAtAltitude(20, altKm, atmosphere), atmosphere,
    layerWinds: { low: wd, mid: wd, high: wd }, driftHours: 0, visible: true, dataOut: 2 });
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*W*H);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  scene.remove(slab.mesh); slab.dispose?.();
  // 표본 화소의 시선 방향(월드: +x 동, +y 위, +z 남)과 τ
  const samples = [];
  for (let y = STRIDE/2; y < H; y += STRIDE) for (let x = STRIDE/2; x < W; x += STRIDE) {
    const ndc = new THREE.Vector3((x+0.5)/W*2-1, (y+0.5)/H*2-1, 0.5).unproject(cam).normalize();
    samples.push([+ndc.x.toFixed(6), +ndc.y.toFixed(6), +ndc.z.toFixed(6), buf[(y*W+x)*4]/255*40]);
  }
  return { buf, samples };
}

function paint(buf, label){
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const cx=c.getContext('2d'); const img=cx.createImageData(W,H);
  for(let y=0;y<H;y++){ const s=(H-1-y)*W*4, d=y*W*4; for(let i=0;i<W*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t); document.getElementById('shots').appendChild(c);
}

const 판 = [];
for (const [az, pitch] of VIEWS) {
  const on = shoot(az, pitch, true), off = shoot(az, pitch, false);
  paint(on.buf, '가림 켬 ' + az + '° ' + pitch + '°');
  paint(off.buf, '가림 끔');
  판.push({ az, pitch, on: on.samples, off: off.samples.map(s => s[3]) });
}
window.__stats = { glError: gl.getError(), eyeM: EYE_M, deck: DECK, 판 };
} catch (e) { errors.push('예외: ' + (e && e.message)); document.getElementById('out').textContent = String(e && e.stack); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

  fs.writeFileSync(path.join(PREVIEW, 'cloud-sea-terrain.html'), html);
  fs.writeFileSync(path.join(PREVIEW, 'cloud-sea-terrain.json'),
    JSON.stringify({ LAT, LON, DIR, zFine, zFar, eyeM, DECK, FINE_M, FAR_M, BLOCK }));
  console.log('생성 완료: cloud-sea-terrain.html');
})();
