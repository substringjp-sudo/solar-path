/**
 * **얇은 중층운을 얇게** — 도코나메 2026-10-01 22:25 재현(사용자 사진). `verify-thin-layer.js` 의 짝.
 *
 * 앱과 같은 합성기(하늘·지면·구름 슬랩)로 같은 하늘을 두 번 그립니다:
 *  - old: 층 광학두께 배율 1 (예전)
 *  - new: 단면이 말하는 배율(`cloudProfile.layerTauScale`) — 600hPa 한 면이라 중층 3.75/16
 * 대조로 낮(해 40°) 같은 하늘도 그리고, 두꺼운 단면(배율 1)은 old 와 같아야 합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-thin-layer.js && node tools/shader-preview/verify-thin-layer.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage } from './app/components/SkyScene3D/CloudSlab.js';
import { createGroundPlane, setGroundHorizon, updateGroundColors } from './app/components/SkyScene3D/TerrainRing.js';
import * as SC from './app/components/SkyScene3D/SceneComposer.js';
import { makeAtmosphereParams, beamAtAltitude, moonLight, setSceneCityLight, applyTuningUniforms, skyRadiance, angularSeparationDeg } from './app/utils/atmosphere.js';
import { layerTauScale } from './app/utils/cloudProfile.js';
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
try {
const W=160, H=200, D2R=Math.PI/180, OBS=5;
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const atmosphere=makeAtmosphereParams({latitude:34.88,observerElevM:OBS,dayOfYear:274,humidityPct:73,visibilityM:32000});
// 실제 단면(Open-Meteo best_match, 34.8763N 136.8506E, 2026-10-01 22시 JST) — 600hPa 한 면만 13%
const H_M=[98,314,539,775,1010,1491,2010,2548,3128,4393,5845,7567,9696,10965,12452];
const THIN=[0,0,0,0,0,0,0,0,0,13,0,0,0,0,0];
const THICK=[0,0,0,0,0,0,0,0,40,60,35,0,0,0,0];
const CASES=[
 {name:'night-thin', sun:[-53.5,326], moon:[22.6,72], illum:0.73, prof:THIN},
 {name:'night-thick',sun:[-53.5,326], moon:[22.6,72], illum:0.73, prof:THICK},
 {name:'day-thin',   sun:[40,200],    moon:[-30,0],   illum:0.0,  prof:THIN},
 // 진단: 중층만(상층 0) · 구름 없음
 {name:'night-midonly', sun:[-53.5,326], moon:[22.6,72], illum:0.73, prof:THIN, cover:[0,0.20,0]},
 {name:'night-clear',   sun:[-53.5,326], moon:[22.6,72], illum:0.73, prof:THIN, cover:[0,0,0]},
 // 비교: 2026-10-01 이전 모양장 상수(한 자리에 맞춘 값)
 {name:'night-orig',    sun:[-53.5,326], moon:[22.6,72], illum:0.73, prof:THIN, orig:true},
];
const COVER=[0.0,0.20,0.17], LOOK=[35,65];
const out=[];
for (const C of CASES) for (const mode of ['old','new']) {
  const scale = mode==='old' ? {low:1,mid:1,high:1}
    : {low:layerTauScale('low',{profileHeightM:H_M,profileCoverPct:C.prof}), mid:layerTauScale('mid',{profileHeightM:H_M,profileCoverPct:C.prof}), high:layerTauScale('high',{profileHeightM:H_M,profileCoverPct:C.prof})};
  const scene=new THREE.Scene();
  const sky=createSkydome(); scene.add(sky.mesh);
  const ml=moonLight(C.sun[0], C.moon[0], C.illum, atmosphere);
  updateSkydome(sky, C.sun[0], C.sun[1], atmosphere, 1.0, {altDeg:C.moon[0], azDeg:C.moon[1], gain:ml.gain});
  const ground=createGroundPlane(); setGroundHorizon(ground, OBS); scene.add(ground);
  updateGroundColors(ground, C.sun[0], 0, { skyMean:skyRadiance(45,90,C.sun[0],atmosphere), beam: beamAtAltitude(C.sun[0],0,atmosphere), sunAzimuthDeg:C.sun[1],
    moonAltitudeDeg:C.moon[0], moonAzimuthDeg:C.moon[1], moonFraction:C.illum, moonIrradiance:null });
  const slab=C.orig ? createCloudSlab({shapeMean:{low:0.597,mid:0.377,high:0.515}, shapeSigRatio:{low:0.654,mid:0.652,high:0.986}}) : createCloudSlab(); scene.add(slab.mesh);
  const CV=C.cover||COVER; bakeCloudSlabCoverage(slab,()=>({low:CV[0],mid:CV[1],high:CV[2],confidence:1}));
  slab.setLayerAltitudesKm(1.5, 4.39, 10.0);
  if (slab.setLayerTauScale) slab.setLayerTauScale(scale.low, scale.mid, scale.high);
  slab.mesh.renderOrder=-0.49;
  SC.assignLayer(sky.mesh,SC.LAYER_SOFT_SKY); SC.assignLayer(ground,SC.LAYER_MID); SC.assignLayer(slab.mesh,SC.LAYER_SOFT_CLOUD);
  const cam=new THREE.PerspectiveCamera(60,W/H,0.1,1000); const v=dirOf(LOOK[0],LOOK[1]); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true);
  const comp=SC.createSceneComposer(W,H,2);
  if (slab.setTerrainDistance) { comp.setTerrainDistance(true); slab.setTerrainDistance(comp.terrainDistanceTexture()); }
  setSceneCityLight(0.3);
  scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
  const s=comp.softSize(), wd={speedKmh:0,bearingDeg:0};
  updateCloudSlab(slab,{camera:cam,widthPx:s.width,heightPx:s.height,sunDir:dirOf(C.sun[0],C.sun[1]),sunAltDeg:C.sun[0],sunAzDeg:C.sun[1],
    beamFor:k=>beamAtAltitude(C.sun[0],k,atmosphere),atmosphere,layerWinds:{low:wd,mid:wd,high:wd},driftHours:0,visible:true,
    moonDir:dirOf(C.moon[0],C.moon[1]),moonAltDeg:C.moon[0],moonIllum:C.illum,cityLight:0.3});
  comp.render(r,scene,cam);
  const b=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);
  // 하늘 부분(위 70%)을 8×8 덩어리로 평균 — 별 점은 뭉개고 구름 무늬만 남깁니다. 대비 = 덩어리 밝기의 표준편차 ÷ 평균.
  const blocks=[]; for(let by=Math.floor(H*0.3); by+8<=H; by+=8) for(let bx=0; bx+8<=W; bx+=8){ let L=0; for(let y=by;y<by+8;y++) for(let x=bx;x<bx+8;x++){ const i=(y*W+x)*4; L+=0.2126*b[i]+0.7152*b[i+1]+0.0722*b[i+2]; } blocks.push(L/64); }
  const mean=blocks.reduce((a,c)=>a+c,0)/blocks.length, sd=Math.sqrt(blocks.reduce((a,c)=>a+(c-mean)**2,0)/blocks.length);
  const img=[]; for(let y=H-1;y>=0;y--) for(let x=0;x<W;x++){ const i=(y*W+x)*4; img.push(b[i],b[i+1],b[i+2]); }
  out.push({name:C.name, mode, scale, mean, cv: sd/Math.max(1e-6,mean), img});
  comp.dispose && comp.dispose();
}
window.__stats={glError:gl.getError(), W, H, out};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'thin-layer.html'), html);
console.log('생성 완료: thin-layer.html');
