/**
 * **올려다본 구름을 가까운 산이 가리는가** (§84).
 *
 * 구름은 깊이 없이 지형 **위에** 합성됩니다(§64·§83). 그래서 지평선 위로 솟은
 * 능선 **뒤**의 저층운이 능선 **앞**에 그려질 수 있었습니다. 셰이더가 이제
 * 위로 향한 시선도 지형 높이장과 견줍니다. 이 판이 그 결과를 CPU 참조와
 * 대조합니다 — `build-cloud-sea-terrain.js` 와 같은 틀입니다.
 *
 * ## 자리 — 구례읍(분지)
 *
 * 북동 약 8km 에 지리산 노고단(1,507m)이 고도각 10° 가까이 솟습니다. 저층
 * 1.5km 구름은 고도 5° 에서 17km 밖이라 그 능선 **뒤**입니다.
 *
 * 운량 100% · 저층만 — 틈이 있으면 "구름이 없다" 가 가림인지 틈인지 모릅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-ridge.js
 *       node tools/shader-preview/verify-cloud-ridge.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { makeCpuDem, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin } = require('./dem-cpu');

/** 구례읍. 관측자는 이 자리 DEM 위 1.6m. */
const LAT0 = 35.2050, LON0 = 127.4640, DIR = 'dem-gurye';
const BLOCK = 3, FINE_M = 3000, FAR_M = 60000, EYE_M = 1.6;
/** 저층 높이 (km). 덱 정보는 주지 않습니다(올려다보는 하늘은 1.6km 판). */
const LOW_KM = 1.5;
const W = 200, H = 200, FOV = 40, STRIDE = 4;
/** (방위, 피치) — 여덟 방위를 지평선 조금 위로. */
const VIEWS = [[0, 8], [45, 8], [90, 8], [135, 8], [180, 8], [225, 8], [270, 8], [315, 8]];

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
  const zFine = await fetchBlock(FINE_M);
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
<div id="wrap"><h3>올려다본 구름 × 능선 가림 — 구례</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
// ⚠ three.js 는 셰이더 컴파일 실패를 **console.error** 로만 알립니다. 이걸 안 잡으면
//   구름이 통째로 안 그려져도 제목이 OK 가 되고, "굽은 판 = 안 굽은 판" 같은 대조가
//   빈 화면끼리 같아서 통과합니다(한 번 그랬습니다).
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
try {
const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK};
const EYE_M=${eyeM}, LOW_KM=${LOW_KM};
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

function shoot(az, pitch, occludeSky, bake = true){
  const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
  slab.setLayerAltitudesKm(LOW_KM, 4.5, 10.0);
  // bake=false 면 지평선을 안 굽습니다 — 셰이더가 모든 하늘 화소를 걷습니다(§84 대조).
  slab.setDemPatches(fine, far, bake ? renderer : undefined);
  // 패치는 늘 줍니다 — 끈 판과 켠 판이 **이 스위치 하나만** 다릅니다.
  slab.material.uniforms.uTerrainOccludeSky.value = occludeSky ? 1 : 0;
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

function cam0(az, pitch){
  const cam = new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const ar=az*Math.PI/180, er=pitch*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  return cam;
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
  const noBake = shoot(az, pitch, true, false);
  paint(on.buf, '가림 켬 ' + az + '° ' + pitch + '°');
  paint(off.buf, '가림 끔');
  // 지평선 굽기는 **속도만** 바꿔야 합니다 — 굽지 않은 판과 화소가 하나라도 다르면 결함.
  let diff = 0;
  for (let i = 0; i < on.buf.length; i++) if (on.buf[i] !== noBake.buf[i]) diff++;
  // §94 — 굽기가 그려진 격자 능선을 실어 오면서 속도만의 일이 아니게 됐습니다. 다른 화소가
  // **어디**인지 싣습니다(판정이 능선 근처인지 봅니다). 많으면 솎습니다.
  const diffDirs = [];
  for (let px = 0; px < W*H; px++) {
    const i = px*4;
    if (on.buf[i] === noBake.buf[i] && on.buf[i+1] === noBake.buf[i+1] && on.buf[i+2] === noBake.buf[i+2] && on.buf[i+3] === noBake.buf[i+3]) continue;
    const x = px % W, y = Math.floor(px / W);
    const ndc = new THREE.Vector3((x+0.5)/W*2-1, (y+0.5)/H*2-1, 0.5).unproject(cam0(az, pitch)).normalize();
    diffDirs.push([+ndc.x.toFixed(6), +ndc.y.toFixed(6), +ndc.z.toFixed(6)]);
  }
  const keep = diffDirs.filter((_, k) => k % Math.max(1, Math.ceil(diffDirs.length / 600)) === 0);
  판.push({ az, pitch, on: on.samples, off: off.samples.map(s => s[3]), 굽기차이: diff, 굽기차이방향: keep });
}

// ── 비용 — 하늘을 올려다본 판(피치 15°, 400×400)을 세 방식으로 ─────────
function timeIt(occludeSky, bake){
  const TW = 400, TH = 400;
  renderer.setSize(TW, TH, false);
  const slab = createCloudSlab(); scene.add(slab.mesh);
  slab.setLayerAltitudesKm(LOW_KM, 4.5, 10.0);
  slab.setDemPatches(fine, far, bake ? renderer : undefined);
  slab.material.uniforms.uTerrainOccludeSky.value = occludeSky ? 1 : 0;
  bakeCloudSlabCoverage(slab, () => ({ low: 0.6, mid: 0.4, high: 0.3, confidence: 1 }));
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000); cam.position.set(0,0,0);
  cam.lookAt(Math.sin(225*Math.PI/180)*100, Math.tan(15*Math.PI/180)*100, -Math.cos(225*Math.PI/180)*100);
  cam.updateMatrixWorld(true);
  const sunDir = new THREE.Vector3(0, Math.sin(0.35), -Math.cos(0.35)).normalize();
  const wd = { speedKmh: 0, bearingDeg: 0 };
  const px = new Uint8Array(4);
  const draw = () => {
    updateCloudSlab(slab, { camera: cam, widthPx: TW, heightPx: TH, sunDir, sunAltDeg: 20, sunAzDeg: 0,
      beamFor: (altKm) => beamAtAltitude(20, altKm, atmosphere), atmosphere,
      layerWinds: { low: wd, mid: wd, high: wd }, driftHours: 0, visible: true });
    renderer.render(scene, cam);
    // ⚠ 읽어야 끝납니다 — 안 읽으면 소프트웨어 GL 이 0.1ms 를 돌려줍니다.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };
  draw();
  const t0 = performance.now();
  for (let k = 0; k < 6; k++) draw();
  const dt = (performance.now() - t0) / 6;
  scene.remove(slab.mesh); slab.dispose?.();
  renderer.setSize(W, H, false);
  return +dt.toFixed(1);
}
const 비용 = { 가림끔: timeIt(false, true), 굽기없음: timeIt(true, false), 굽기: timeIt(true, true) };
window.__stats = { glError: gl.getError(), eyeM: EYE_M, lowKm: LOW_KM, 판, 비용 };
} catch (e) { errors.push('예외: ' + (e && e.message)); document.getElementById('out').textContent = String(e && e.stack); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

  fs.writeFileSync(path.join(PREVIEW, 'cloud-ridge.html'), html);
  fs.writeFileSync(path.join(PREVIEW, 'cloud-ridge.json'),
    JSON.stringify({ LAT, LON, DIR, zFine, zFar, eyeM, LOW_KM, FINE_M, FAR_M, BLOCK }));
  console.log('생성 완료: cloud-ridge.html');
})();
