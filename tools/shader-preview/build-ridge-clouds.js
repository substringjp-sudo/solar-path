/**
 * **구름이 산을 덮는가** (§116) — 합성기째. `verify-ridge-clouds.js` 의 짝.
 *
 * 사용자(스와 호숫가 2026-09-27 밤, 사진 두 장): "구름이 산을 덮는걸 구현을 못했어." 앱은 하늘 구름을 산보다
 * **먼저** 그려서(§96 나눠 그리기), 시선이 산에 막히는 방향의 산 앞 구름도 산이 덮었습니다. 구름 밑면보다
 * 높은 산등성이가 늘 구름 앞으로 나왔습니다.
 *
 * 장면: 스와 호숫가(관측 759m + 1.6m). 저층 밑면 1.06km · 운해 0.66~2.27km(그날 QR 의 앱 값), 저층 100%.
 * 시선 셋: 255.5°(그날 QR — 가까운 산등성이 1.0~1.1km 로 **밑면과 거의 같음**), 330°(1.36~1.59km), 45°(1.48km).
 * 시선마다 네 번 그립니다: 지형 끔 · 구름 없음 · 새 코드 · 옛 동작(uRidgeClouds 0, 두 번째 판 꺼짐).
 * 산 화소는 "지형 켬 대 끔"(구름 없음)의 차로 가립니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-ridge-clouds.js   (DEM 타일을 curl 로 받습니다)
 *       node tools/shader-preview/verify-ridge-clouds.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PREVIEW } = require('./paths');
const { makeCpuDem, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin } = require('./dem-cpu');

const LAT = 36.0464, LON = 138.109, DIR = 'dem-suwa';
const BLOCK = 3, FINE_M = 3000, FAR_M = 60000, EYE_M = 1.6;

function fetchBlock(radiusM) {
  const zoom = demZoomForRadius(radiusM, LAT, BLOCK);
  const t = lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);
  const demDir = path.join(PREVIEW, DIR);
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
    // curl 은 환경의 프록시를 따릅니다(Node https 는 안 따름).
    execFileSync('curl', ['-sSfL', '--retry', '4', '-o', f,
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`]);
  }
  return zoom;
}

const zFine = fetchBlock(FINE_M);
fetchBlock(FAR_M);
const fine = makeCpuDem({ demDir: path.join(PREVIEW, DIR), zoom: zFine, lat: LAT, lon: LON });
const groundM = fine.elevAtGround(0, 0);
const OBS_M = +groundM.toFixed(1);
console.log(`스와 호숫가 지면 ${OBS_M}m`);
fs.writeFileSync(path.join(PREVIEW, 'ridge-clouds.json'), JSON.stringify({ LAT, LON, DIR, zoomFar: demZoomForRadius(FAR_M, LAT, BLOCK), eyeM: OBS_M + EYE_M, baseKm: 1.06 }));

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainField, updateTerrainFieldEye, FAR_FIELD_FAR_M, FAR_FIELD_RINGS, FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createGroundPlane, setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage } from './app/components/SkyScene3D/CloudSlab.js';
import * as SC from './app/components/SkyScene3D/SceneComposer.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
const errors=[];
{ const oe=console.error; console.error=(...a)=>{ errors.push(a.map(String).join(' ').slice(0,300)); oe(...a); }; }
const die=(m)=>{ errors.push(String(m)); window.__errors=errors; document.title='DONE::ERR'; };
window.addEventListener('error',e=>die(e.message));
window.addEventListener('unhandledrejection',e=>die(e.reason&&e.reason.message||e.reason));
const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK}, OBS_M=${OBS_M};
const W=320, H=240, FOVY=40, EYE=${EYE_M}, SUN_ALT=25, SUN_AZ=150, VIEW_EL=4, VIEWS=[255.5,330,45];
const D2R=Math.PI/180;
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0,1);
const gl=r.getContext();
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});
clearDemCache();
const opts={renderer:r,loadTexture,block:BLOCK,tileUrl:(z,x,y)=>\`./\${DIR}/\${z}_\${x}_\${y}.png\`};
const patch=await loadDemPatch(LAT,LON,${FINE_M},opts);
const farPatch=await loadDemPatch(LAT,LON,${FAR_M},opts);
if(!patch||!farPatch) die('패치 없음');
const atmosphere=makeAtmosphereParams({latitude:LAT,observerElevM:OBS_M,dayOfYear:270,humidityPct:90,visibilityM:20000});
const scene=new THREE.Scene();
const sky=createSkydome(); scene.add(sky.mesh); updateSkydome(sky,SUN_ALT,SUN_AZ,atmosphere);
const ground=createGroundPlane(); setGroundHorizon(ground,OBS_M); scene.add(ground);
const field=createTerrainField({eyeHeightM:EYE,farM:FAR_FIELD_FAR_M,rings:FIELD_RINGS+FAR_FIELD_RINGS,patch,eyePatch:patch,farPatch});
field.mesh.renderOrder=-0.48; scene.add(field.mesh);
const slab=createCloudSlab(); scene.add(slab.mesh);
slab.setLayerAltitudesKm(1.06,3.04,10.0); slab.setLowDeckKm(0.66,2.27);
slab.setDemPatches(patch,farPatch,r);
bakeCloudSlabCoverage(slab,()=>({low:1,mid:0,high:0,confidence:1}));
SC.assignLayer(sky.mesh,SC.LAYER_SOFT_SKY);
for(const o of [ground,field.mesh]) SC.assignLayer(o,SC.LAYER_MID);
SC.assignLayer(slab.mesh,SC.LAYER_SOFT_CLOUD);
slab.setSplitPasses(true); slab.mesh.renderOrder=-0.49; slab.meshBelow.renderOrder=0.5;
scene.add(slab.meshBelow); SC.assignLayer(slab.meshBelow,SC.LAYER_SOFT_CLOUD_BELOW);
const composer=SC.createSceneComposer(W,H); composer.setGodRays({strength:0}); composer.setBloom({strength:0}); composer.setSoftScale(1);
const cam=new THREE.PerspectiveCamera(FOVY,W/H,0.1,1000);
const wd={speedKmh:0,bearingDeg:0};
const buf=new Uint8Array(W*H*4);
function shot(mode){   // 'none' | 'new' | 'old' | 'noterrain'
  updateCloudSlab(slab,{camera:cam,widthPx:W,heightPx:H,sunDir:dirOf(SUN_ALT,SUN_AZ),sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,
    beamFor:k=>beamAtAltitude(SUN_ALT,k,atmosphere),atmosphere,layerWinds:{low:wd,mid:wd,high:wd},driftHours:0,visible:true});
  field.mesh.visible = mode!=='noterrain';
  if (mode==='none'||mode==='noterrain') { slab.mesh.visible=false; slab.meshBelow.visible=false; }
  if (mode==='old') { slab.material.uniforms.uRidgeClouds.value=0; slab.meshBelow.visible=false; }
  composer.render(r,scene,cam);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  slab.mesh.visible=true; field.mesh.visible=true;
  return Array.from(buf);
}
const views=[];
for (const az of VIEWS) {
  const v=dirOf(VIEW_EL,az); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true); updateTerrainFieldEye(field,cam);
  const out={};
  for (const m of ['noterrain','none','new']) out[m]=shot(m);
  out.flagNew=slab.material.uniforms.uRidgeClouds.value;
  out.old=shot('old');
  views.push({az,out});
}
window.__stats={W,H,FOVY,VIEW_EL,views,glError:gl.getError()};
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'ridge-clouds.html'), html);
console.log('생성 완료: ridge-clouds.html');
