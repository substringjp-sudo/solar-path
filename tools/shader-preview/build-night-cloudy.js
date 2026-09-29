/**
 * **흐린 보름밤에 하늘이 새카맣고 땅이 하얗던 것** — 마쓰모토 2026-09-26 재현.
 *
 * 사용자 화면(해발 545m, 저·중·상층 53/41/95%, 보름달 고도 54°): 밤하늘과 별이 새카맣고, 땅이
 * 하얗게 탔습니다. 16:49 에는 역광 쪽 먼 능선이 흰 띠로 빛났습니다. 원인 둘:
 *
 *  1. 구름 속 판정(`cloudAround`)이 관측 고도 운량 15~19% 를 구름 속으로 봐 안개를 씌웠습니다.
 *     → `fogAtObserver`(관측 고도 운량 ≥ 50%).
 *  2. 지면 달빛이 예전 가짜 상수(보름 고도 54° 에서 0.036)였습니다. → 하늘·구름과 같은 달빛.
 *
 * 앱과 같은 합성기(구름 두 판, 저해상도 경로)로 하늘·구름·지면을 그려 **옛 동작 / 고친 동작**을 찍습니다.
 * 옛 동작은 옛 판정(`cloudAround`)과 옛 상수를 그대로 흉내 냅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-night-cloudy.js
 *       node tools/shader-preview/verify-night-cloudy.js
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
import { cloudAround, fogAtObserver } from './app/utils/cloudProfile.js';
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
{ const oe=console.error; console.error=(...a)=>{errors.push(a.map(String).join(' ').slice(0,200)); oe(...a);}; }
try {
const W=180, H=240, D2R=Math.PI/180, OBS=545;
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const atmosphere=makeAtmosphereParams({latitude:36.3,observerElevM:OBS,dayOfYear:269,humidityPct:85,visibilityM:3600});
const lv=a=>a.map(([h,c])=>({pressureHPa:0,heightM:h,coverPct:c}));
// 실제 예보 단면(Open-Meteo, 마쓰모토 36.3039N 137.9128E) — 16시·18시·23시
const PROF={
 16: lv([[98,0],[314,0],[539,15],[765,27],[1000,39],[1481,58],[1991,100],[2518,100],[3089,100],[4335,42],[5776,0],[7470,53],[9569,7]]),
 18: lv([[98,0],[314,0],[539,19],[765,32],[1000,49],[1481,70],[1991,80],[2524,100],[3089,81],[4335,0],[5776,35],[7482,42],[9569,11]]),
 23: lv([[108,0],[324,0],[549,19],[775,32],[1000,54],[1491,49],[1991,38],[2523,15],[3099,35],[4344,18],[5786,0],[7470,0],[9569,11]]),
};
// 앱 화면과 같은 시각·방향. 해·달은 SunCalc 값(마쓰모토).
const CASES=[
 {name:'16:49 서쪽', hr:16, cover:[0.45,0.71,0.49], sun:[6.5,258], moon:[-2,95], look:[10,258]},
 {name:'18:11 북동', hr:18, cover:[0.63,0.61,0.88], sun:[-8.5,282], moon:[13.5,98], look:[17,47]},
 {name:'23:59 서쪽', hr:23, cover:[0.53,0.41,0.95], sun:[-52.8,340], moon:[54.4,197], look:[6,263]},
];
const oldMoonGround=(moonAlt)=>{ const s=Math.max(0,Math.sin(moonAlt*D2R)); const k=s*(1.0*0.038+0.006); return {r:k*0.7,g:k*0.85,b:k*1.15}; };
const newMoonGround=(sunAlt,moonAlt,moonAz,overcast)=>{
  const g=moonLight(sunAlt,moonAlt,1.0,atmosphere).gain; if(!(g>0)||moonAlt<=0) return null;
  let sr=0,sg=0,sb=0,sw=0;
  for(const e of [10,30,50,75]){ const w=Math.sin(e*D2R); for(let a=0;a<6;a++){ const az=a*60; const L=skyRadiance(e,angularSeparationDeg(az,e,moonAz,moonAlt),moonAlt,atmosphere); sr+=L.r*w; sg+=L.g*w; sb+=L.b*w; sw+=w; } }
  const bm=beamAtAltitude(moonAlt,0,atmosphere), d=Math.sin(moonAlt*D2R)/Math.PI;
  const t=1-overcast;   // 앱과 같게 — 직사 몫만 운량만큼 가림
  return {r:(sr/sw+bm.r*d*t)*g, g:(sg/sw+bm.g*d*t)*g, b:(sb/sw+bm.b*d*t)*g};
};
const out=[];
for (const mode of ['old','new']) for (const C of CASES) {
  const scene=new THREE.Scene();
  const sky=createSkydome(); scene.add(sky.mesh);
  const ml=moonLight(C.sun[0], C.moon[0], 1.0, atmosphere);
  updateSkydome(sky, C.sun[0], C.sun[1], atmosphere, 1.0, {altDeg:C.moon[0], azDeg:C.moon[1], gain:ml.gain});
  const ground=createGroundPlane(); setGroundHorizon(ground, OBS); scene.add(ground);
  let skyMean={r:0,g:0,b:0}, sw=0;
  for(const e of [10,30,50,75]){ const w=Math.sin(e*D2R); for(let a=0;a<6;a++){ const L=skyRadiance(e,angularSeparationDeg(a*60,e,C.sun[1],C.sun[0]),C.sun[0],atmosphere); skyMean.r+=L.r*w; skyMean.g+=L.g*w; skyMean.b+=L.b*w; sw+=w; } }
  skyMean={r:skyMean.r/sw,g:skyMean.g/sw,b:skyMean.b/sw};
  updateGroundColors(ground, C.sun[0], 0, { skyMean, beam: beamAtAltitude(C.sun[0],0,atmosphere), sunAzimuthDeg:C.sun[1],
    moonAltitudeDeg:C.moon[0], moonAzimuthDeg:C.moon[1], moonFraction:1.0,
    moonIrradiance: mode==='old' ? oldMoonGround(C.moon[0]) : newMoonGround(C.sun[0], C.moon[0], C.moon[1], 1-(1-C.cover[0])*(1-C.cover[1])*(1-C.cover[2])) });
  const slab=createCloudSlab(); scene.add(slab.mesh);
  bakeCloudSlabCoverage(slab,()=>({low:C.cover[0],mid:C.cover[1],high:C.cover[2],confidence:1}));
  slab.setLayerAltitudesKm(1.2, 2.5, 7.5);
  const fog = mode==='old' ? cloudAround(PROF[C.hr], OBS/1000) : fogAtObserver(PROF[C.hr], OBS/1000);
  slab.setInCloud(fog);
  // 앱과 같이(§117) — 구름은 한 번에, 지형 다음에(지형 거리 판). 옛 코드면 §96 나눠 그리기.
  const APP117 = !!slab.setTerrainDistance;
  if (!APP117) { slab.setSplitPasses(true); slab.meshBelow.renderOrder=0.5; scene.add(slab.meshBelow); SC.assignLayer(slab.meshBelow,SC.LAYER_SOFT_CLOUD_BELOW); }
  slab.mesh.renderOrder=-0.49;
  SC.assignLayer(sky.mesh,SC.LAYER_SOFT_SKY); SC.assignLayer(ground,SC.LAYER_MID);
  SC.assignLayer(slab.mesh,SC.LAYER_SOFT_CLOUD);
  const cam=new THREE.PerspectiveCamera(60,W/H,0.1,1000); const v=dirOf(C.look[0],C.look[1]); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true);
  const comp=SC.createSceneComposer(W,H,2);
  if (APP117) { comp.setTerrainDistance(true); slab.setTerrainDistance(comp.terrainDistanceTexture()); }
  setSceneCityLight(0.3);
  scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
  const s=comp.softSize(), wd={speedKmh:0,bearingDeg:0};
  updateCloudSlab(slab,{camera:cam,widthPx:s.width,heightPx:s.height,sunDir:dirOf(C.sun[0],C.sun[1]),sunAltDeg:C.sun[0],sunAzDeg:C.sun[1],
    beamFor:k=>beamAtAltitude(C.sun[0],k,atmosphere),atmosphere,layerWinds:{low:wd,mid:wd,high:wd},driftHours:0,visible:true,
    moonDir:dirOf(C.moon[0],C.moon[1]),moonAltDeg:C.moon[0],moonIllum:1.0,cityLight:0.3});
  comp.render(r,scene,cam);
  const b=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);
  const rows=(y0,y1)=>{ let L=0,n=0; for(let y=y0;y<y1;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4; L+=0.2126*b[i]+0.7152*b[i+1]+0.0722*b[i+2]; n++; } return L/n; };
  // readPixels 는 아래가 0행. 시선 앙각과 세로 화각 60° 로 지평선 행을 구합니다.
  const tanV=Math.tan(30*D2R), yHor=Math.round(H*(0.5 + 0.5*Math.tan(-C.look[0]*D2R)/tanV));
  const img=[]; for(let y=H-1;y>=0;y--) for(let x=0;x<W;x++){ const i=(y*W+x)*4; img.push(b[i],b[i+1],b[i+2]); }
  out.push({mode, name:C.name, fog:!!fog, fogCover: fog? +fog.cover.toFixed(2): 0,
    skyL: rows(Math.min(H-1,yHor+Math.round(H*0.15)), H), groundL: rows(0, Math.max(1,yHor-Math.round(H*0.08))), yHor, img});
  comp.dispose && comp.dispose();
}
window.__stats={glError:gl.getError(), W, H, out};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'night-cloudy.html'), html);
console.log('생성 완료: night-cloudy.html');
