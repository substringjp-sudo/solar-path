/**
 * **운해가 앱 화면에서 보이는가** (§96) — 합성기째.
 *
 * 운해 판정들(§81~§85)은 구름 슬랩만 그려서 잽니다. 그런데 앱의 저해상도 합성 경로는
 * 하늘 → 천체 → 구름 → **산** 순서라, 발밑 운해를 지형 격자가 통째로 덮을 수 있습니다.
 * 이 판은 앱과 같은 층 배정·같은 합성기로 덕유산 정상(눈 1,605m)에서 발밑 덱(0.8~1.2km,
 * 저층 100%)을 내려다보고, 두 경로(배율 2 · 1)에서 운해가 보이는지 잽니다.
 *
 * 잽니다:
 *   - **보여야 할 운해** — 슬랩만(한 번에 다, 자료 2 알파 > 0.5)으로 그린 지평선 아래 화소.
 *     슬랩의 DEM 가림(§83)이 가까운 사면은 이미 뺀 것입니다.
 *   - 그중 합성 화면에서 구름을 켰다 끄면 한 채널이라도 8 넘게 바뀌는 비율.
 *
 * 옛 코드(두 번째 판이 없음)는 슬랩 하나를 LAYER_SOFT_CLOUD 에 둡니다 — 음성 대조.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       (덕유산 DEM · 설정이 없으면 build-cloud-sea-terrain.js 를 먼저 부릅니다)
 * 사용: node tools/shader-preview/build-cloud-sea-app.js
 *       node tools/shader-preview/verify-cloud-sea-app.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const cfgPath = path.join(PREVIEW, 'cloud-sea-terrain.json');
// run-all 은 build-* 를 이름순으로 돌려 이 판이 build-cloud-sea-terrain 보다 먼저 옵니다 — 없으면 직접 부릅니다.
if (!fs.existsSync(cfgPath)) {
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-cloud-sea-terrain.js')], { stdio: 'inherit' });
}
if (!fs.existsSync(cfgPath)) throw new Error('build-cloud-sea-terrain.js 가 설정을 못 만들었습니다(덕유산 DEM)');
const CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const OBS_M = +(CFG.eyeM - 1.6).toFixed(2);

const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainField, updateTerrainFieldEye, FAR_FIELD_FAR_M, FAR_FIELD_RINGS, FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createGroundPlane, setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
// 이름공간으로 — 옛 코드(음성 대조)에는 LAYER_SOFT_CLOUD_BELOW 가 없습니다.
import * as SC from './app/components/SkyScene3D/SceneComposer.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
const die = (m) => { errors.push(String(m)); window.__errors = errors; document.title = 'DONE::ERR'; };
window.addEventListener('error', e => die(e.message));
window.addEventListener('unhandledrejection', e => die(e.reason && e.reason.message || e.reason));

const CFG=${JSON.stringify(CFG)}, OBS_M=${OBS_M};
const W=240, H=240, FOVY=50, EYE=1.6, SUN_ALT=20, SUN_AZ=150;
const VIEWS=[[0,-12],[200,-30],[120,-6]];
const D2R=Math.PI/180;
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();

const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false});
r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0x000000,1);
const gl=r.getContext();
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});
clearDemCache();
const opts={renderer:r,loadTexture,block:CFG.BLOCK,tileUrl:(z,x,y)=>\`./\${CFG.DIR}/\${z}_\${x}_\${y}.png\`};
const patch=await loadDemPatch(CFG.LAT,CFG.LON,CFG.FINE_M,opts);
const maskPatch=await loadDemPatch(CFG.LAT,CFG.LON,CFG.FAR_M,opts);
if(!patch||!maskPatch) die('패치 없음');

const atmosphere=makeAtmosphereParams({latitude:CFG.LAT,observerElevM:OBS_M,dayOfYear:268,humidityPct:85,visibilityM:25000});
const scene=new THREE.Scene();
const sky=createSkydome(); scene.add(sky.mesh); updateSkydome(sky,SUN_ALT,SUN_AZ,atmosphere);
const ground=createGroundPlane(); setGroundHorizon(ground,OBS_M); scene.add(ground);
const field=createTerrainField({eyeHeightM:EYE,farM:FAR_FIELD_FAR_M,rings:FIELD_RINGS+FAR_FIELD_RINGS,
  patch,eyePatch:patch,farPatch:maskPatch});
field.mesh.renderOrder=-0.48; scene.add(field.mesh);
if (field.distMesh) scene.add(field.distMesh);   // §117 지형 거리 판의 쌍둥이
const slab=createCloudSlab(); scene.add(slab.mesh);
slab.setLayerAltitudesKm(1.0,4.5,10.0);
slab.setLowDeckKm(CFG.DECK[0],CFG.DECK[1]);
slab.setDemPatches(patch,maskPatch,r);
bakeCloudSlabCoverage(slab,()=>({low:1,mid:0,high:0,confidence:1}));
SC.assignLayer(sky.mesh,SC.LAYER_SOFT_SKY);
for(const o of [ground,field.mesh]) SC.assignLayer(o,SC.LAYER_MID);
SC.assignLayer(slab.mesh,SC.LAYER_SOFT_CLOUD);
// 앱(SkyScene3D)과 같이 — §117 코드면 한 번에 지형 다음에(지형 거리 판), §96 코드면 두 번에 나눠.
const APP117 = !!slab.setTerrainDistance;
const split = !APP117 && !!(slab.setSplitPasses && SC.LAYER_SOFT_CLOUD_BELOW);
if (split) {
  slab.setSplitPasses(true);
  slab.mesh.renderOrder=-0.49; slab.meshBelow.renderOrder=0.5;
  scene.add(slab.meshBelow); SC.assignLayer(slab.meshBelow,SC.LAYER_SOFT_CLOUD_BELOW);
}
const composer=SC.createSceneComposer(W,H);
composer.setGodRays({strength:0}); composer.setBloom({strength:0});
if (APP117) { slab.mesh.renderOrder=-0.49; composer.setTerrainDistance(true); slab.setTerrainDistance(composer.terrainDistanceTexture()); }

const buf=new Uint8Array(W*H*4);
function camFor(az,pitch){
  const cam=new THREE.PerspectiveCamera(FOVY,W/H,0.1,1000); cam.position.set(0,0,0);
  const v=dirOf(pitch,az); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true);
  updateTerrainFieldEye(field,cam); return cam;
}
function slabUpd(cam,wpx,hpx,dataOut){
  const wd={speedKmh:0,bearingDeg:0};
  updateCloudSlab(slab,{camera:cam,widthPx:wpx,heightPx:hpx,sunDir:dirOf(SUN_ALT,SUN_AZ),sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,
    beamFor:k=>beamAtAltitude(SUN_ALT,k,atmosphere),atmosphere,layerWinds:{low:wd,mid:wd,high:wd},driftHours:0,visible:true,dataOut});
}
function shot(cam,cloudsOn){
  const s=composer.softSize();
  slabUpd(cam, composer.softScale>1.0001?s.width:W, composer.softScale>1.0001?s.height:H, 0);
  if(!cloudsOn){ slab.mesh.visible=false; if(split) slab.meshBelow.visible=false; }
  composer.render(r,scene,cam);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf.slice();
}
// 보여야 할 운해 — 슬랩만, 한 번에 다(uPassMode 0), 자료 2 알파.
function expectMask(cam){
  const only=new THREE.Scene(); only.add(slab.mesh);
  const pm = slab.material.uniforms.uPassMode ? slab.material.uniforms.uPassMode.value : null;
  const dt = slab.material.depthTest;
  if (pm!==null) slab.material.uniforms.uPassMode.value=0;
  // 기준은 합성기와 독립이어야 합니다 — 지형 거리 판(§117) 대신 슬랩 자신의 DEM 가림(§83)으로.
  if (APP117) slab.setTerrainDistance(null);
  slab.material.depthTest=false; slab.material.needsUpdate=true;
  slabUpd(cam,W,H,2); slab.mesh.visible=true;
  const rt=new THREE.WebGLRenderTarget(W,H);
  const mask=cam.layers.mask; cam.layers.enableAll();
  r.setRenderTarget(rt); r.setClearColor(0x000000,0); r.clear(); r.render(only,cam);
  cam.layers.mask=mask;
  const b=new Uint8Array(W*H*4); r.readRenderTargetPixels(rt,0,0,W,H,b);
  r.setRenderTarget(null); r.setClearColor(0x000000,1); rt.dispose();
  if (pm!==null) slab.material.uniforms.uPassMode.value=pm;
  slab.material.depthTest=dt; slab.material.needsUpdate=true;
  if (APP117) slab.setTerrainDistance(composer.terrainDistanceTexture());
  scene.add(slab.mesh);
  return b;
}
const tanV=Math.tan(FOVY*D2R/2);
const R={split};
for (const scale of [2,1]) {
  composer.setSoftScale(scale);
  let exp=0, seen=0;
  const imgs=[];
  for (const [az,pitch] of VIEWS){
    const cam=camFor(az,pitch);
    const m=expectMask(cam);
    const on=shot(cam,true), off=shot(cam,false);
    for(let y=0;y<H;y++){
      const elev=Math.atan(tanV*((2*(y+0.5)/H)-1))/D2R+pitch;   // readPixels 행(아래 0)
      if (elev > -0.5) continue;                                  // 지평선 아래만
      for(let x=0;x<W;x++){
        const i=(y*W+x)*4;
        if (m[i+3] < 128) continue;
        exp++;
        if (Math.max(Math.abs(on[i]-off[i]),Math.abs(on[i+1]-off[i+1]),Math.abs(on[i+2]-off[i+2])) > 8) seen++;
      }
    }
    if (az===200) imgs.push(Array.from(on));
  }
  R['배율'+scale]={보여야할:exp, 보임:seen};
  window['__img'+scale]=imgs[0];
}
window.__stats={glError:gl.getError(), R};
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'cloud-sea-app.html'), html);
console.log(`생성 완료: cloud-sea-app.html (발밑 ${OBS_M}m)`);
