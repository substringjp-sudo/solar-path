/**
 * **DEM 이 없을 때 구름이 능선 앞에 칠해지지 않는가** (§87).
 *
 * DEM 타일을 못 받으면 지형은 옛 능선 밴드(방위 31점 × 거리 5·15·40km)로
 * 그려집니다. 구름 셰이더는 그 밴드를 한 줄 텍스처로 구워, 화소가 능선 아래이고
 * 구름이 **그 밴드 거리보다 멀 때만** 가립니다.
 *
 * 자는 밴드 메시 **자신**입니다 — 진짜 `createTerrainBands` 를 따로 그려 "산이
 * 칠한 화소" 가림판을 만들고, 슬랩의 τ 와 겹쳐 봅니다.
 *
 *   가까운 능선 5km · 8°  — 저층 1.5km 는 8° 아래에서 늘 10.7km 넘게 멀다
 *                          → 능선 아래 전부 가려져야 함
 *   먼 능선 40km · 3°     — 능선 아래라도 구름이 40km 보다 가까우면 남아야 함
 *                          (고도 약 2.1° 위)
 *
 * 대조: 밴드를 안 준 판(예전) · DEM 이 있을 때 밴드를 준 판과 안 준 판(같아야 함).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-cloud-ridge.js   (DEM 타일 dem-gurye 를 받아 둠)
 * 사용: node tools/shader-preview/build-cloud-bands.js
 *       node tools/shader-preview/verify-cloud-bands.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const W = 240, H = 240, FOV = 30;
const OBS_M = 40, LOW_KM = 1.5;
/** 방위 10° 간격 37점(0°~360°) — 앱의 밴드 배열과 같은 꼴. */
const ridge = (peakDeg, az0, az1) => Array.from({ length: 37 }, (_, i) => {
  const az = i * 10;
  return az >= az0 && az <= az1 ? peakDeg : -5;
});
const CASES = {
  가까운능선: { bands: [ridge(8, 40, 140)], dists: [5], az: 90, pitch: 5 },
  먼능선:     { bands: [ridge(3, 40, 140)], dists: [40], az: 90, pitch: 2 },
};

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px} canvas{border:1px solid #345;margin:2px} .cap{font:10px monospace;color:#9ab}
</style></head><body><div id="wrap"><h3>DEM 없을 때 — 능선 밴드가 구름을 가리는가</h3><div id="shots"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { createTerrainBands, seaHorizonDipDeg, TERRAIN_MAX_ANGLE_DEG }
  from './app/components/SkyScene3D/TerrainRing.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
try {
const W=${W}, H=${H}, FOV=${FOV}, OBS_M=${OBS_M}, LOW_KM=${LOW_KM};
const CASES=${JSON.stringify(CASES)};
const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
const gl = renderer.getContext();
const atmosphere = makeAtmosphereParams({ latitude: 35.2, observerElevM: OBS_M, dayOfYear: 264, humidityPct: 65, visibilityM: 25000 });
const dip = seaHorizonDipDeg(OBS_M);

function camFor(c){
  const cam = new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000); cam.position.set(0,0,0);
  const ar=c.az*Math.PI/180, er=c.pitch*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true); return cam;
}
function read(){ const b=new Uint8Array(4*W*H); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b); return b; }

/** 밴드 메시만 — "산이 칠한 화소" 가림판. */
function bandMask(c){
  const scene = new THREE.Scene();
  const h = createTerrainBands(c.bands, c.dists, undefined, null, OBS_M);
  scene.add(h.group);
  renderer.setClearColor(0x000000, 1); renderer.render(scene, camFor(c));
  const b = read(); h.dispose?.();
  const m = new Uint8Array(W*H);
  for (let i=0;i<W*H;i++) m[i] = (b[i*4] + b[i*4+1] + b[i*4+2]) > 6 ? 1 : 0;
  return m;
}
/** 슬랩 τ. bands 를 줄지, DEM 을 줄지. */
function slabTau(c, withBands, dem){
  const scene = new THREE.Scene();
  const slab = createCloudSlab(); scene.add(slab.mesh);
  slab.setLayerAltitudesKm(LOW_KM, 4.5, 10.0);
  if (dem) slab.setDemPatches(dem.fine, dem.far, renderer);
  if (withBands) slab.setBandHorizon(c.bands, c.dists, TERRAIN_MAX_ANGLE_DEG, dip);
  bakeCloudSlabCoverage(slab, () => ({ low: 1, mid: 0, high: 0, confidence: 1 }));
  const cam = camFor(c);
  const sunDir = new THREE.Vector3(0, Math.sin(0.5), -Math.cos(0.5)).normalize();
  const wd = { speedKmh: 0, bearingDeg: 0 };
  updateCloudSlab(slab, { camera: cam, widthPx: W, heightPx: H, sunDir, sunAltDeg: 28, sunAzDeg: 0,
    beamFor: (a) => beamAtAltitude(28, a, atmosphere), atmosphere,
    layerWinds: { low: wd, mid: wd, high: wd }, driftHours: 0, visible: true, dataOut: 2 });
  renderer.setClearColor(0x000000, 1); renderer.render(scene, cam);
  const b = read(); slab.dispose?.();
  const t = new Float32Array(W*H); for (let i=0;i<W*H;i++) t[i] = b[i*4] / 255 * 40;
  return { t, raw: b };
}
function paint(buf, label){
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const x=c.getContext('2d'); const img=x.createImageData(W,H);
  for(let y=0;y<H;y++){ const s=(H-1-y)*W*4, d=y*W*4; for(let i=0;i<W*4;i++) img.data[d+i]=buf[s+i]; }
  x.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t); document.getElementById('shots').appendChild(c);
}

const 판 = {};
for (const [name, c] of Object.entries(CASES)) {
  const mask = bandMask(c);
  const on = slabTau(c, true, null), off = slabTau(c, false, null);
  paint(on.raw, name + ' 밴드 가림');
  // 표본: 화소 방향과 가림판·τ
  const cam = camFor(c);
  const S = [];
  for (let y = 1; y < H; y += 3) for (let x = 1; x < W; x += 3) {
    const d = new THREE.Vector3((x+0.5)/W*2-1, (y+0.5)/H*2-1, 0.5).unproject(cam).normalize();
    const i = y*W + x;
    S.push([+d.x.toFixed(6), +d.y.toFixed(6), +d.z.toFixed(6), mask[i], +on.t[i].toFixed(2), +off.t[i].toFixed(2)]);
  }
  판[name] = { dist: c.dists[0], S };
}

// DEM 이 있으면 밴드는 쓰이지 않아야 합니다 — 구례 패치로 두 판을 견줍니다.
let demSame = null;
{
  clearDemCache();
  const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
  const opts = { renderer, loadTexture, block: 3, tileUrl:(z,x,y)=>\`./dem-gurye/\${z}_\${x}_\${y}.png\` };
  const fine = await loadDemPatch(35.2050, 127.4640, 3000, opts);
  const far  = await loadDemPatch(35.2050, 127.4640, 60000, opts);
  if (fine && far) {
    const c = CASES.가까운능선;
    const a = slabTau(c, true, { fine, far }).raw, b = slabTau(c, false, { fine, far }).raw;
    let diff = 0, cloud = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    for (let i = 0; i < W*H; i++) if (a[i*4] > 0) cloud++;
    demSame = { diff, cloud };
  }
}
window.__stats = { glError: gl.getError(), 판, demSame, dip, lowKm: LOW_KM, obsM: OBS_M };
} catch (e) { errors.push('예외: ' + (e && e.message)); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'cloud-bands.html'), html);
console.log('생성 완료: cloud-bands.html');
