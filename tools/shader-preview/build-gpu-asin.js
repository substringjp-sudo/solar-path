/**
 * **천정 꽃잎 — 폰 GPU 의 부정확한 asin** (§114). `verify-gpu-asin.js` 의 짝.
 *
 * 기기(마쓰모토 근처 785m, 운해 0.66~2.27km 속, 2026-09-27 QR 네 장)에서만 천정으로 모이는 꽃잎이
 * 나오고, 같은 입력의 하네스(SwiftShader)와 앱 컴포넌트 웹 재현(§112)은 못 그렸습니다. 폰 GPU 는
 * asin 을 흔히 근사식(Abramowitz–Stegun 4.4.45: π/2 − √(1−x)·다항식, 절대 오차 ~5e-5)으로 풉니다.
 * `slab_sphereIntersect` 의 asin(x) 에서 x 는 천정 둘레에서 1e-5 안팎이라 오차가 값보다 크고,
 * 그것을 cosE(→0)로 나눠 지상 위치가 수 km 틀어졌습니다.
 *
 * 스테이징한 CloudSlab.js 에서 변형 셋을 만들어 같은 장면을 넷으로 그립니다:
 *   옛 식 · 정확한 asin / 옛 식 · GPU 식 asin / 새 식 · 정확한 asin / 새 식 · GPU 식 asin
 * 장면은 기기 QR 그대로(층 1.06 · 3.04 · 10km, 운해 0.66~2.27km, 관측 785m, 시선 268.9° · +80.3°, 화각 60°).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-gpu-asin.js
 *       node tools/shader-preview/verify-gpu-asin.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const D = path.join(PREVIEW, 'app/components/SkyScene3D');
const src = fs.readFileSync(path.join(D, 'CloudSlab.js'), 'utf8');
const NEW_A = '  float x = clamp(s * cosE / A, 0.0, 1.0);';
const NEW_B = ': asin(x) / max(cosE, 1e-4);';
if (!src.includes(NEW_A) || !src.includes(NEW_B)) throw new Error('스테이징한 CloudSlab.js 에 §114 식이 없습니다 — stage-esm 을 먼저 돌리세요');
const i = src.indexOf(NEW_A), j = src.indexOf(NEW_B) + NEW_B.length;
const oldSrc = src.slice(0, i)
  + '  float angle = asin(clamp(s * cosE / A, 0.0, 1.0));\n  float safeRatio = (cosE > 1e-4) ? (angle / cosE) : (s / A);'
  + src.slice(j);
// 폰 GPU 식 asin — slab_sphereIntersect 안의 asin 만 바꿉니다.
const GPU_ASIN = 'float gpu_asin(float x){ float ax=abs(x); float r=1.5707288-0.2121144*ax+0.0742610*ax*ax-0.0187293*ax*ax*ax; return sign(x)*(1.5707963-sqrt(1.0-ax)*r); }\n';
const gpu = (s) => {
  const a = s.indexOf('SlabGeom slab_sphereIntersect('), b = s.indexOf('\n}\n', a);
  return s.slice(0, a) + GPU_ASIN + s.slice(a, b).replace(/\basin\(/g, 'gpu_asin(') + s.slice(b);
};
fs.writeFileSync(path.join(D, 'CloudSlabV_oldExact.js'), oldSrc);
fs.writeFileSync(path.join(D, 'CloudSlabV_oldGpu.js'), gpu(oldSrc));
fs.writeFileSync(path.join(D, 'CloudSlabV_newExact.js'), src);
fs.writeFileSync(path.join(D, 'CloudSlabV_newGpu.js'), gpu(src));

const TW = 320, TH = 240;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import * as V0 from './app/components/SkyScene3D/CloudSlabV_oldExact.js';
import * as V1 from './app/components/SkyScene3D/CloudSlabV_oldGpu.js';
import * as V2 from './app/components/SkyScene3D/CloudSlabV_newExact.js';
import * as V3 from './app/components/SkyScene3D/CloudSlabV_newGpu.js';
import { WeatherFan, buildSkyColumns } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
try {
const TW=${TW}, TH=${TH}, SUN_ALT=-25, SUN_AZ=288, VIEW_AZ=268.9, VIEW_EL=80.3;
const atmosphere=makeAtmosphereParams({latitude:36.07,observerElevM:785,dayOfYear:270,humidityPct:94,visibilityM:10000});
const canvas=document.createElement('canvas'); canvas.width=TW; canvas.height=TH;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(TW,TH,false);
const gl=r.getContext();
const k=(v,w)=>Math.max(0,Math.min(100,v+w));
const pts=[{distance:0,azimuthOffset:0,low:47,mid:71,high:100,humidity:94,precipitation:0.1,visibility:10000}];
for (const o of [-20,-10,0,10,20]) for (const d of [10,30,70,130,200,280,380]) { const w=Math.sin(d/60+o*0.11), v=Math.cos(d/45-o*0.07);
  pts.push({distance:d,azimuthOffset:o,low:k(47,20*w),mid:k(71,20*v),high:k(100,-10*Math.abs(w*v)),humidity:94,precipitation:0.1}); }
const samples=buildSkyColumns({fan:new WeatherFan(pts,SUN_AZ),driftMinutes:640,windSpeedKmh:31.1,windBearingDeg:198});
const V=(e,s)=>({speedKmh:Math.hypot(e,s),bearingDeg:(Math.atan2(e,-s)*180/Math.PI+360)%360});
const winds={low:V(-10,30),mid:V(-65,20),high:V(-156,54)};
const cam=new THREE.PerspectiveCamera(60,TW/TH,0.1,2000);
{ const ar=VIEW_AZ*Math.PI/180, er=VIEW_EL*Math.PI/180; cam.lookAt(100*Math.cos(er)*Math.sin(ar),100*Math.sin(er),-100*Math.cos(er)*Math.cos(ar)); cam.updateMatrixWorld(true); }
const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z));
const shots=[];
for (const [key,M] of [['oldExact',V0],['oldGpu',V1],['newExact',V2],['newGpu',V3]]) {
  const scene=new THREE.Scene(); const sky=createSkydome(); sky.material.uniforms.uDither.value=0; updateSkydome(sky,SUN_ALT,SUN_AZ,atmosphere); scene.add(sky.mesh);
  const slab=M.createCloudSlab(); scene.add(slab.mesh);
  slab.setLayerAltitudesKm(1.06,3.04,10); slab.setLowDeckKm(0.66,2.27);
  M.bakeCloudSlabCoverage(slab, M.coverageFromSamples(samples));
  M.updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,
    beamFor:k=>beamAtAltitude(SUN_ALT,k,atmosphere),atmosphere,layerWinds:winds,driftHours:10.7,visible:true});
  r.setClearColor(0,1); r.render(scene,cam);
  const b=new Uint8Array(TW*TH*4); gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,b);
  shots.push({key,px:Array.from(b)});
}
window.__stats={shots,TW,TH};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'gpu-asin.html'), html);
console.log('생성 완료: gpu-asin.html (변형 4개 스테이징)');
