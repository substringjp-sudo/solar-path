/**
 * **구름 속** (§93) — 산 위가 구름 속이면 안개처럼 보이는가.
 *
 * > "이날 이 산에 윗쪽에 구름이 걸려서 이 고도는 구름 안이라 안개처럼 보일텐데"
 *
 * 단면(`cloudProfile.cloudAround`)을 그대로 태웁니다 — 1530m·2030m 100%, 2560m 30%,
 * 1049m·3138m 0% 이면 반값 규칙으로 밑면 1.29km · 윗면 2.30km.
 *
 * 경우 (해 30°·방위 200°, DEM 없음 — 발밑은 눈높이 평지):
 *   fogH    1.6km, 수평(방위 90°)            — 멀리 못 본다
 *   fogDn   1.6km, 아래 −30°                 — 발밑 땅은 보인다
 *   fogUp   1.6km, 위 80°
 *   top     2.25km (윗면 50m 아래), 수평     — 윗면 가까이는 밝다
 *   bot     1.35km (밑면 60m 위), 수평       — 밑면 가까이는 어둡다
 *   under   1.20km (밑면 아래, 구름 밖), 위 80° — 밑면을 올려다본 구름(참고)
 *   off     1.6km, 수평, 안개 끔 / never     — 끄면 예전과 바이트 동일
 *   outside 1.6km, 수평, 관측자가 덩어리 밖(윗면 1.5km) — 예전과 바이트 동일
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-fog.js
 *       node tools/shader-preview/verify-cloud-fog.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const W = 160, H = 160, FOV = 40;

const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import * as A from './app/utils/atmosphere.js';
import * as P from './app/utils/cloudProfile.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
try {
const W=${W}, H=${H}, FOV=${FOV};
const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:true, premultipliedAlpha:true });
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
const gl = renderer.getContext();
const D = Math.PI/180;
const dirOf = (alt, az) => new THREE.Vector3(Math.cos(alt*D)*Math.sin(az*D), Math.sin(alt*D), -Math.cos(alt*D)*Math.cos(az*D)).normalize();

const LEVELS = [
  { pressureHPa: 900, heightM: 1049, coverPct: 0 },
  { pressureHPa: 850, heightM: 1530, coverPct: 100 },
  { pressureHPa: 800, heightM: 2030, coverPct: 100 },
  { pressureHPa: 750, heightM: 2560, coverPct: 30 },
  { pressureHPa: 700, heightM: 3138, coverPct: 0 },
];

function shoot({ obsKm, elev, az = 90, fog = 'profile', runOverride = null }, dataOut, withSky){
  const atmosphere = A.makeAtmosphereParams({ latitude: 37.9, observerElevM: obsKm*1000, dayOfYear: 268, humidityPct: 90, visibilityM: 20000 });
  const scene = new THREE.Scene();
  if (withSky) { const sky = createSkydome(); scene.add(sky.mesh); updateSkydome(sky, 30, 200, atmosphere); }
  const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
  slab.setLayerAltitudesKm(1.8, 4.5, 10.0);
  bakeCloudSlabCoverage(slab, () => ({ low: 1, mid: 0, high: 0, confidence: 1 }));
  if (fog === 'profile') slab.setInCloud(runOverride ?? P.cloudAround(LEVELS, obsKm));
  else if (fog === 'null') slab.setInCloud(null);
  const cam = new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000); cam.position.set(0,0,0);
  const v = dirOf(elev, az); cam.lookAt(v.x*100, v.y*100, v.z*100); cam.updateMatrixWorld(true);
  const wd = { speedKmh: 20, bearingDeg: 250 };
  updateCloudSlab(slab, { camera: cam, widthPx: W, heightPx: H,
    sunDir: dirOf(30, 200), sunAltDeg: 30, sunAzDeg: 200,
    beamFor: (k) => A.beamAtAltitude(30, k, atmosphere), atmosphere,
    layerWinds: { low: wd, mid: wd, high: wd }, driftHours: 0, visible: true, dataOut });
  renderer.setClearColor(0x000000, withSky ? 1 : 0); renderer.render(scene, cam);
  const b = new Uint8Array(4*W*H); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);
  return b;
}
const lin8 = v => { v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
function stats(sc){
  const d0 = shoot(sc, 0, true), d2 = shoot(sc, 2, false), d3 = shoot(sc, 3, false);
  let a = 0, aMin = 1, aUpMin = 1, lin = 0, nL = 0, disp = 0, disp2 = 0;
  for (let p = 0; p < W*H; p++){
    const i = p*4, al = d2[i+3]/255;
    a += al; aMin = Math.min(aMin, al);
    // 지평선 위(readPixels 는 아래가 0 행 — 위 절반)만 따로: 아래 절반은 몇 m 앞 땅입니다.
    if (sc.elev === 0 && Math.floor(p / W) >= H/2) aUpMin = Math.min(aUpMin, al);
    if (d3[i+3] > 0) { lin += Math.pow(2, d3[i]/255*16 - 12); nL++; }
    const dl = 0.2126*lin8(d0[i]) + 0.7152*lin8(d0[i+1]) + 0.0722*lin8(d0[i+2]);
    disp += dl; disp2 += dl*dl;
  }
  const n = W*H, m = disp/n;
  return { 알파: a/n, 알파최소: aMin, 위알파최소: aUpMin, 선형: nL ? lin/nL : null, 표시: m,
           표시편차: Math.sqrt(Math.max(0, disp2/n - m*m)), 바이트: Array.from(d0) };
}

const run = P.cloudAround(LEVELS, 1.6);
const R = {
  fogH:  stats({ obsKm: 1.6,  elev: 0 }),
  fogDn: stats({ obsKm: 1.6,  elev: -30 }),
  fogUp: stats({ obsKm: 1.6,  elev: 80 }),
  top:   stats({ obsKm: 2.25, elev: 0 }),
  bot:   stats({ obsKm: 1.35, elev: 0 }),
  under: stats({ obsKm: 1.20, elev: 80 }),
  offNull:  stats({ obsKm: 1.6, elev: 0, fog: 'null' }),
  offNever: stats({ obsKm: 1.6, elev: 0, fog: 'never' }),
  outside:  stats({ obsKm: 1.6, elev: 0, runOverride: { cover: 1, baseKm: 1.0, topKm: 1.5 } }),
};
const slab = createCloudSlab();
slab.setInCloud(run);
const beta = slab.material.uniforms.uFogBeta.value;
window.__stats = { glError: gl.getError(), R, run, beta,
  runAt: { top: P.cloudAround(LEVELS, 2.25), bot: P.cloudAround(LEVELS, 1.35), under: P.cloudAround(LEVELS, 1.2) } };
} catch (e) { errors.push('예외: ' + (e && e.stack || e)); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cloud-fog.html'), html);
console.log('생성 완료: cloud-fog.html');
