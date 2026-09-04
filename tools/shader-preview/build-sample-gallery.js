/**
 * **샘플 갤러리** — 날씨 × 시각, 그리고 각도 × 화각을 한 번에 훑어봅니다.
 *
 * 41절까지의 변경(2-stream 조명 · 문턱형 모양 · fbm 회전)을 적용한 지금
 * 상태를 넓게 눈으로 확인하려고 만들었습니다. 판정 스크립트가 아니라
 * 사람이 보는 갤러리이므로 지표는 라벨에 몇 개만 곁들입니다.
 *
 * 두 장을 냅니다.
 *  - gallery-weather-time.png — 날씨 5 × 시각 5 (25칸), 고정 화각·고정 시선.
 *  - gallery-angle-fov.png    — 시선고도 3 × 화각 3 (9칸), 고정 날씨·고정 시각.
 *
 * 사용: node tools/shader-preview/build-sample-gallery.js
 *       node tools/shader-preview/shoot.js gallery-weather-time.html gallery-weather-time.png 90000
 *       node tools/shader-preview/shoot.js gallery-angle-fov.html gallery-angle-fov.png 40000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const COMMON_IMPORTS = `
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
`;

function makeScene(SUN_AZ) {
  return `
const scene=new THREE.Scene();
const skydome=createSkydome(); scene.add(skydome.mesh);
const angles=[]; for(let i=0;i<72;i++) angles.push(0.35+0.5*Math.sin(i*0.21)+0.3*Math.sin(i*0.07+1.3));
const terrain=createTerrainRing(angles); scene.add(terrain);
const ground=createGroundPlane(); setGroundHorizon(ground,24); scene.add(ground);
const slab=createCloudSlab(); slab.mesh.renderOrder=10; scene.add(slab.mesh);

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a,seed)=>Math.max(0,Math.min(100, v+16*Math.sin(d*0.031+a*0.017+seed)+11*Math.cos(d*0.017-a*0.026+seed)));
function bake(w){
  const pts=[{distance:0,azimuthOffset:0,low:w.low,mid:w.mid,high:w.high,
              humidity:w.hum,precipitation:w.precip||0,visibility:w.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,
      low:jit(w.low,d,off,0), mid:jit(w.mid,d,off+40,1), high:jit(w.high,d,off+80,2),
      humidity:w.hum,precipitation:w.precip||0});
  const fan=new WeatherFan(pts,${SUN_AZ});
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:data.high/100,
            confidence:Math.max(0,Math.min(1,confidence))};});
}
`;
}

// ───────────────────────── 1. 날씨 × 시각 ─────────────────────────

const TW1 = 210, TH1 = 210;
const FOV1 = 70;
const SUN_AZ1 = 200;
const VIEW_AZ1 = SUN_AZ1 - 55; // 태양을 살짝 옆에 두고 봅니다 — 노을에서 흔한 구도
const VIEW_ELEV1 = 18;

const WEATHERS = [
  { name: '맑음',       low: 6,  mid: 4,  high: 8,  hum: 40, vis: 35000 },
  { name: '옅은 적운',  low: 22, mid: 8,  high: 5,  hum: 50, vis: 28000 },
  { name: '뭉게구름',   low: 45, mid: 20, high: 10, hum: 60, vis: 22000 },
  { name: '흐림',       low: 88, mid: 85, high: 60, hum: 88, vis: 9000 },
  { name: '비',         low: 95, mid: 90, high: 70, hum: 96, vis: 4000, precip: 6 },
];
const TIMES = [
  { name: '아침 +10°',  alt: 10 },
  { name: '한낮 +55°',  alt: 55 },
  { name: '노을 0°',    alt: 0 },
  { name: '박명 -4°',   alt: -4 },
  { name: '밤 -25°',    alt: -25 },
];

const html1 = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW1 * TIMES.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.35;background:rgba(6,10,16,.78);
   padding:3px 6px;border-radius:4px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px}
</style></head><body>
<div id="wrap">
<h3>샘플 갤러리 — 날씨 × 시각 (화각 ${FOV1}°, 시선고도 ${VIEW_ELEV1}°, 태양에서 55° 옆)</h3>
<p class="sub">가로: ${TIMES.map(t=>t.name).join(' · ')}　·　세로: ${WEATHERS.map(w=>w.name).join(' · ')}</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">${COMMON_IMPORTS}

const TW=${TW1}, TH=${TH1}, FOV_DEG=${FOV1};
const SUN_AZ=${SUN_AZ1}, VIEW_AZ=${VIEW_AZ1}, VIEW_ELEV=${VIEW_ELEV1};
const WEATHERS=${JSON.stringify(WEATHERS)};
const TIMES=${JSON.stringify(TIMES)};

const canvas=document.getElementById('c');
canvas.width=TW*TIMES.length; canvas.height=TH*WEATHERS.length;
const ctx2d=canvas.getContext('2d');
const glCanvas=document.createElement('canvas'); glCanvas.width=TW; glCanvas.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();
${makeScene(SUN_AZ1)}
const labels=document.getElementById('labels');

function shoot(w, sunAlt){
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:172,
    humidityPct:w.hum,visibilityM:w.vis});
  const cam=new THREE.PerspectiveCamera(FOV_DEG,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,sunAlt,SUN_AZ,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,sunAlt,SUN_AZ,atm);
  updateGroundColors(ground,sunAlt,SUN_AZ,atm);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:sunAlt,sunAzDeg:SUN_AZ,cityLight: sunAlt < -2 ? 1 : 0,
    beamFor:(altKm)=>beamAtAltitude(sunAlt,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:14,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},
                high:{speedKmh:70,bearingDeg:220}},
    driftHours:0,visible:true,
    moonDir:new THREE.Vector3(0.3,0.55,-0.7).normalize(),moonAltDeg:35,moonIllum:0.55});
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

WEATHERS.forEach((w,row)=>{
  bake(w);
  TIMES.forEach((t,col)=>{
    const img=shoot(w, t.alt);
    const im=ctx2d.createImageData(TW,TH); im.data.set(img); ctx2d.putImageData(im,col*TW,row*TH);
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(canvas.offsetLeft+col*TW+6)+'px'; d.style.top=(canvas.offsetTop+row*TH+6)+'px';
    d.innerHTML=w.name+' · '+t.name;
    labels.appendChild(d);
  });
});

window.__stats={glError:gl.getError()};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'gallery-weather-time.html'), html1);
console.log('생성 완료: gallery-weather-time.html');

// ───────────────────────── 2. 시선고도 × 화각 ─────────────────────────

const TW2 = 260, TH2 = 260;
const SUN_AZ2 = 200;
const SUN_ALT2 = 14; // 아침~노을 사이, 구름 음영 대비가 잘 보이는 고도

const ANGLES = [
  { name: '천정 78°', elev: 78 },
  { name: '중간 40°', elev: 40 },
  { name: '지평 8°',  elev: 8 },
];
const FOVS = [
  { name: '표준 50°', fov: 50 },
  { name: '보통 70°', fov: 70 },
  { name: '광각 100°', fov: 100 },
];

const WFIX = { name: '뭉게구름', low: 42, mid: 22, high: 8, hum: 58, vis: 22000 };

const html2 = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW2 * FOVS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.35;background:rgba(6,10,16,.78);
   padding:3px 6px;border-radius:4px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px}
</style></head><body>
<div id="wrap">
<h3>샘플 갤러리 — 시선고도 × 화각 (뭉게구름, 태양고도 ${SUN_ALT2}°, 태양 방향으로 봄)</h3>
<p class="sub">가로: ${FOVS.map(f=>f.name).join(' · ')}　·　세로: ${ANGLES.map(a=>a.name).join(' · ')}</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">${COMMON_IMPORTS}

const TW=${TW2}, TH=${TH2};
const SUN_AZ=${SUN_AZ2}, SUN_ALT=${SUN_ALT2};
const ANGLES=${JSON.stringify(ANGLES)};
const FOVS=${JSON.stringify(FOVS)};
const W=${JSON.stringify(WFIX)};

const canvas=document.getElementById('c');
canvas.width=TW*FOVS.length; canvas.height=TH*ANGLES.length;
const ctx2d=canvas.getContext('2d');
const glCanvas=document.createElement('canvas'); glCanvas.width=TW; glCanvas.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();
${makeScene(SUN_AZ2)}
const labels=document.getElementById('labels');

const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:172,
  humidityPct:W.hum,visibilityM:W.vis});
bake(W);

function shoot(elev, fov){
  const cam=new THREE.PerspectiveCamera(fov,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=SUN_AZ*Math.PI/180, er=elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,SUN_ALT,SUN_AZ,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,SUN_ALT,SUN_AZ,atm);
  updateGroundColors(ground,SUN_ALT,SUN_AZ,atm);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:14,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},
                high:{speedKmh:70,bearingDeg:220}},
    driftHours:0,visible:true});
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

ANGLES.forEach((a,row)=>{
  FOVS.forEach((f,col)=>{
    const img=shoot(a.elev, f.fov);
    const im=ctx2d.createImageData(TW,TH); im.data.set(img); ctx2d.putImageData(im,col*TW,row*TH);
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(canvas.offsetLeft+col*TW+6)+'px'; d.style.top=(canvas.offsetTop+row*TH+6)+'px';
    d.innerHTML=a.name+' · '+f.name;
    labels.appendChild(d);
  });
});

window.__stats={glError:gl.getError()};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'gallery-angle-fov.html'), html2);
console.log('생성 완료: gallery-angle-fov.html');
