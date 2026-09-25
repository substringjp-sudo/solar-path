/**
 * **두 층 사이의 빛** (§88) — 윗층이 아래층을 가리고, 아래층이 윗층 밑면을 비추는가.
 *
 * 관측 1.6km · 아래 덱 0.8~1.2km(운해) · 위 덱 2.5km. 수평을 세로 40° 로 보고
 * 아래 띠(−15~−5°)는 아래 덱 윗면, 위 띠(+8~+18°)는 위 덱 밑면입니다.
 *
 * 세 출구로 잽니다:
 *   자료 0 — 표시색(사진과 같은 쪽, 톤 곡선 뒤)
 *   자료 2 — B = 직달의 몫
 *   자료 3 — 톤 곡선 **전** 선형 휘도(log2) — 에너지 경계는 이쪽으로 봅니다
 *
 * 경우: 해 0.5·5·20·45° × 위 덱 100%·0% × 층 사이 빛 켬·끔(uInterLayer).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-two-deck.js
 *       node tools/shader-preview/verify-two-deck.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const W = 240, H = 240, FOV = 40;
const SUNS = [0.5, 5, 20, 45];

const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
try {
const W=${W}, H=${H}, FOV=${FOV}, SUNS=${JSON.stringify(SUNS)};
const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
const gl = renderer.getContext();

function shoot({ sunAlt, mid, inter, dataOut, sunAz = 265 }){
  const atmosphere = makeAtmosphereParams({ latitude: 39.0, observerElevM: 1600, dayOfYear: 264, humidityPct: 80, visibilityM: 20000 });
  const scene = new THREE.Scene();
  const slab = createCloudSlab(); scene.add(slab.mesh);
  slab.setLayerAltitudesKm(1.0, 2.5, 10.0);
  slab.setLowDeckKm(0.8, 1.2);
  slab.material.uniforms.uInterLayer.value = inter ? 1 : 0;
  bakeCloudSlabCoverage(slab, () => ({ low: 1, mid, high: 0, confidence: 1 }));
  const cam = new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000); cam.position.set(0,0,0);
  const ar = sunAz*Math.PI/180;
  cam.lookAt(100*Math.sin(ar), 0, -100*Math.cos(ar)); cam.updateMatrixWorld(true);
  const a=sunAlt*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(ar), Math.sin(a), -Math.cos(a)*Math.cos(ar)).normalize();
  const wd={ speedKmh:20, bearingDeg:250 };
  updateCloudSlab(slab, { camera: cam, widthPx: W, heightPx: H, sunDir, sunAltDeg: sunAlt, sunAzDeg: sunAz,
    beamFor:(k)=>beamAtAltitude(sunAlt, k, atmosphere), atmosphere,
    layerWinds:{ low:wd, mid:wd, high:wd }, driftHours:0, visible:true, dataOut });
  renderer.setClearColor(0x000000, 1); renderer.render(scene, cam);
  const b=new Uint8Array(4*W*H); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);
  slab.dispose?.();
  return b;
}
const lin = v => { v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
const t = Math.tan(FOV/2*Math.PI/180);
function band(buf, e0, e1, f){
  let s=0, n=0;
  for (let y=0;y<H;y++){ const e=Math.atan(((y+0.5)/H*2-1)*t)*180/Math.PI; if (e<e0||e>e1) continue;
    for (let x=W/4;x<3*W/4;x++){ s += f(buf, (y*W+x)*4); n++; } }
  return n ? s/n : null;
}
const disp = (b,i) => 0.2126*lin(b[i]) + 0.7152*lin(b[i+1]) + 0.0722*lin(b[i+2]);
const logY = (b,i) => b[i]/255*16 - 12;         // 자료 3 → log2 휘도
const sunB = (b,i) => b[i+2]/255;               // 자료 2 → 직달 몫

const R = {};
for (const sunAlt of SUNS) for (const mid of [1, 0]) for (const inter of [1, 0]) {
  const d0 = shoot({ sunAlt, mid, inter, dataOut: 0 });
  const d2 = shoot({ sunAlt, mid, inter, dataOut: 2 });
  const d3 = shoot({ sunAlt, mid, inter, dataOut: 3 });
  R[[sunAlt, mid, inter].join('/')] = {
    표시_아래: band(d0, -15, -5, disp), 표시_위: band(d0, 8, 18, disp),
    선형_아래: Math.pow(2, band(d3, -15, -5, logY)), 선형_위: Math.pow(2, band(d3, 8, 18, logY)),
    직달_아래: band(d2, -15, -5, sunB),
    바이트: Array.from(d0),   // 대조용 — 판정이 켬/끔을 바이트로 견줍니다
  };
}
window.__stats = { glError: gl.getError(), R };
} catch (e) { errors.push('예외: ' + (e && e.message)); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'two-deck.html'), html);
console.log('생성 완료: two-deck.html');
