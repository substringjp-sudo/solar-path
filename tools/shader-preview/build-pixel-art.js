/**
 * **도트 모드** (§97) — 합성기가 내부 해상도로 그리고 최근접으로 늘리는가.
 *
 * > "이 분석용으로 사용하는 도트 이미지 되게 느낌이 좋은거같은데 도트 옵션을 줘서
 * >  저해상도일때 이렇게 도트로 보여주면 어떨까"
 *
 * 256×256 화면에 하늘·구름(두 번에 나눠)·태양을 앱과 같은 층으로 올려, 도트 끔 / 도트 64줄 /
 * 다시 끔 을 찍습니다. 해 질 녘(해 4°) 서쪽 — 색이 가장 많이 도는 장면입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-pixel-art.js
 *       node tools/shader-preview/verify-pixel-art.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const { DEFAULT_ATMOS } = require('./app-lighting');

const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import * as SC from './app/components/SkyScene3D/SceneComposer.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
const die = (m) => { errors.push(String(m)); window.__errors = errors; document.title = 'DONE::ERR'; };
window.addEventListener('error', e => die(e.message));
window.addEventListener('unhandledrejection', e => die(e.reason && e.reason.message || e.reason));
try {
const W=256, H=256, ROWS=64, SUN_ALT=4, SUN_AZ=265;
const D2R=Math.PI/180;
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false});
r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const atmosphere=makeAtmosphereParams({latitude:37.9,observerElevM:250,dayOfYear:268,humidityPct:70,visibilityM:25000});
const scene=new THREE.Scene();
const sky=createSkydome(); scene.add(sky.mesh); updateSkydome(sky,SUN_ALT,SUN_AZ,atmosphere);
const sun=createSun(); scene.add(sun.mesh); updateSun(sun,SUN_ALT,SUN_AZ,${JSON.stringify(DEFAULT_ATMOS)},1);
const slab=createCloudSlab(); scene.add(slab.mesh);
bakeCloudSlabCoverage(slab,()=>({low:0.3,mid:0.4,high:0.3,confidence:1}));
SC.assignLayer(sky.mesh,SC.LAYER_SOFT_SKY);
SC.assignLayer(sun.mesh,SC.LAYER_CELESTIAL);
SC.assignLayer(slab.mesh,SC.LAYER_SOFT_CLOUD);
slab.setSplitPasses(true); slab.mesh.renderOrder=-0.49; slab.meshBelow.renderOrder=0.5;
scene.add(slab.meshBelow); SC.assignLayer(slab.meshBelow,SC.LAYER_SOFT_CLOUD_BELOW);
const cam=new THREE.PerspectiveCamera(50,W/H,0.1,1000); cam.position.set(0,0,0);
{ const v=dirOf(12,SUN_AZ); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true); }
const composer=SC.createSceneComposer(W,H);
composer.setGodRays({strength:0});
composer.setSun(dirOf(SUN_ALT,SUN_AZ),SUN_ALT);
const buf=new Uint8Array(W*H*4);
function shot(){
  const isSoft=composer.softActive(), s=composer.softSize(), rs=composer.renderSize();
  const wd={speedKmh:0,bearingDeg:0};
  updateCloudSlab(slab,{camera:cam,widthPx:isSoft?s.width:rs.width,heightPx:isSoft?s.height:rs.height,
    sunDir:dirOf(SUN_ALT,SUN_AZ),sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,beamFor:k=>beamAtAltitude(SUN_ALT,k,atmosphere),
    atmosphere,layerWinds:{low:wd,mid:wd,high:wd},driftHours:0,visible:true});
  composer.render(r,scene,cam);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return Array.from(buf);
}
const R={};
R.off1=shot();
composer.setPixelArt(ROWS);
R.size=composer.renderSize();
R.pix=shot();
composer.setPixelArt(0);
R.off2=shot();
R.sizeOff=composer.renderSize();
// 기준 — 같은 장면을 **64×64 캔버스**에 그대로 그린 것(저해상도 층 경로 없이, 도트 모드와 같게).
// 도트 모드는 "작은 화면에 그린 것을 네모로 키운 것" 이어야 합니다.
{
  const c64=document.createElement('canvas'); c64.width=W*ROWS/H; c64.height=ROWS;
  const r64=new THREE.WebGLRenderer({canvas:c64,antialias:false,alpha:false});
  r64.setPixelRatio(1); r64.setSize(c64.width,c64.height,false);
  const comp64=SC.createSceneComposer(c64.width,c64.height,1);
  comp64.setGodRays({strength:0}); comp64.setSun(dirOf(SUN_ALT,SUN_AZ),SUN_ALT);
  const wd={speedKmh:0,bearingDeg:0};
  updateCloudSlab(slab,{camera:cam,widthPx:c64.width,heightPx:c64.height,
    sunDir:dirOf(SUN_ALT,SUN_AZ),sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,beamFor:k=>beamAtAltitude(SUN_ALT,k,atmosphere),
    atmosphere,layerWinds:{low:wd,mid:wd,high:wd},driftHours:0,visible:true});
  comp64.render(r64,scene,cam);
  const g=r64.getContext(); const b=new Uint8Array(c64.width*c64.height*4);
  g.readPixels(0,0,c64.width,c64.height,g.RGBA,g.UNSIGNED_BYTE,b);
  R.ref64=Array.from(b);
}
window.__stats={glError:gl.getError(),W,H,ROWS,R};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'pixel-art.html'), html);
console.log('생성 완료: pixel-art.html');
