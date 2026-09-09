/**
 * **옛 능선 띠가 아직 화면에 남는가.**
 *
 * `TerrainField` 의 먼 지형 격자(3~55km)를 넣을 때 주석에 "옛 능선 띠를
 * 대신합니다" 라고 적어 놓고 **띠를 지우지는 않았습니다.** 지금도 다섯 층 중
 * 하나로 매 프레임 그려집니다.
 *
 * ## 재는 법 — 원반과 같은 자
 *
 * 띠만 껐다 켠 두 장의 차이 화소를 셉니다. 색으로 "띠 같다" 를 추측하지 않고
 * 띠가 실제로 이긴 화소만 셉니다 (`build-disc-need.js` 와 같은 방식).
 *
 * ## 띠에 유리하게 세웁니다
 *
 * 띠의 지형각은 앱과 **같은 식**으로 DEM 에서 직접 냅니다 —
 * `atan2(고도 − 눈높이 − d²/2R, d)`, 방위 31 곳 × 거리 5·15·40km
 * (`weather.ts` 의 bandAngles 와 같은 계산). 어림으로 낮게 깔면 "안 보인다"
 * 가 그냥 하네스 결함이 됩니다.
 *
 * ⚠ **DEM 이 없을 때**도 따로 잽니다. 그때는 띠가 유일한 능선 실루엣이므로,
 * "지금은 안 보인다" 가 곧 "지워도 된다" 는 뜻이 아닙니다 — 원반에서 배운 것.
 *
 * 사용: node tools/shader-preview/build-bands-need.js
 *       node tools/shader-preview/verify-bands-need.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');
const LIGHT = require('./app-lighting').appLighting(30, 200);

const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;
const R_EARTH = 6371000;
/** 앱과 같은 표본 수·거리 (weather.ts 의 SAMPLES · DISTANCES). */
const SAMPLES = 31, BAND_DIST_KM = [5, 15, 40];
const SITES = [
  { key: '내륙', lat: 37.489130, lon: 127.043169, near: 'dem-dogok', wide: 'wide-dogok' },
  { key: '바닷가', lat: 37.24102, lon: 126.55969, near: 'dem', wide: 'wide-daebu' },
  { key: '높은곳', lat: 37.61553, lon: 126.4300, near: 'dem-mani', wide: 'wide-mani' },
];

// ── 띠의 지형각을 앱과 같은 식으로 DEM 에서 냅니다 ─────────────────────────
for (const s of SITES) {
  const zNear = D.demZoomForRadius(FIELD_FAR_M, s.lat, BLOCK);
  const near = D.makeCpuDem({ demDir: path.join(PREVIEW, s.near), zoom: zNear, lat: s.lat, lon: s.lon });
  const obs = near.elevAtGround(0, 0);
  if (obs === null) throw new Error(s.key + ' 발밑 고도를 못 읽었습니다');
  s.obsM = +obs.toFixed(2);
  const eye = obs + EYE_M;

  const zWide = D.demZoomForRadius(MASK_RADIUS_M, s.lat, BLOCK);
  const wide = D.makeCpuDem({ demDir: path.join(PREVIEW, s.wide), zoom: zWide, lat: s.lat, lon: s.lon });

  s.bandAngles = BAND_DIST_KM.map(() => []);
  s.waterFrac = [];
  for (let i = 0; i < SAMPLES; i++) {
    const az = (i * 360) / (SAMPLES - 1);
    const r = (az * Math.PI) / 180, se = Math.sin(r), sn = -Math.cos(r);
    let water = 0, counted = 0;
    for (let j = 0; j < BAND_DIST_KM.length; j++) {
      const d = BAND_DIST_KM[j] * 1000;
      const h = wide.elevAtGround(se * d, sn * d);
      if (h === null) { s.bandAngles[j].push(0); continue; }
      // ⚠ 곡률 낙차를 빼야 합니다 — 40km 에서 108m 입니다.
      const ang = (Math.atan2(h - eye - (d * d) / (2 * R_EARTH), d) * 180) / Math.PI;
      s.bandAngles[j].push(+ang.toFixed(4));
      if (h <= 0) water++;
      counted++;
    }
    s.waterFrac.push(counted ? water / counted : 0);
  }
  const top = Math.max(...s.bandAngles.flat());
  console.log(`${s.key} 발밑 ${s.obsM}m · 띠 지형각 최대 ${top.toFixed(2)}°`);
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:920px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>옛 능선 띠가 아직 화면에 남는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye,
         FAR_FIELD_NEAR_M, FAR_FIELD_FAR_M, FAR_FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';
import { createGroundPlane, setGroundHorizon, createTerrainBands,
         updateGroundColors, updateTerrainBands } from './app/components/SkyScene3D/TerrainRing.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const SITES=${JSON.stringify(SITES)};
const BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, MASK_R=${MASK_RADIUS_M}, EYE=${EYE_M};
const BAND_DIST=${JSON.stringify(BAND_DIST_KM)};
const IRR=${JSON.stringify(LIGHT.surfaceIrr)}, SUNR=${JSON.stringify(LIGHT.sunRadiance)};
const EXPO=${LIGHT.exposure};

const W=384,H=384,FOV=70;
const PITCHES=[-3, 3];   // 능선 띠는 지평선 언저리에 삽니다
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true});
r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
const bufA=new Uint8Array(W*H*4), bufB=new Uint8Array(W*H*4);
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});
const sky={r:IRR[0],g:IRR[1],b:IRR[2]};

async function run(site, withDem){
  clearDemCache();
  let patch=null, maskPatch=null;
  if(withDem){
    patch=await loadDemPatch(site.lat,site.lon,FAR,{renderer:r,loadTexture,block:BLOCK,
      tileUrl:(z,x,y)=>\`./\${site.near}/\${z}_\${x}_\${y}.png\`});
    maskPatch=await loadDemPatch(site.lat,site.lon,MASK_R,{renderer:r,loadTexture,block:BLOCK,
      tileUrl:(z,x,y)=>\`./\${site.wide}/\${z}_\${x}_\${y}.png\`});
    if(!patch||!maskPatch){ errors.push(site.key+' 패치 없음'); return null; }
  }
  const obs = withDem ? site.obsM : 0;
  const scene=new THREE.Scene();
  const ground=createGroundPlane(); setGroundHorizon(ground, obs); scene.add(ground);
  const cam=new THREE.PerspectiveCamera(FOV,1,0.1,2000);
  cam.position.set(0, ground.position.y + EYE, 0);

  const near=createTerrainField({patch,eyePatch:patch,eyeHeightM:EYE});
  near.mesh.renderOrder=-0.48; near.mesh.visible=!!patch; scene.add(near.mesh);
  const far=createTerrainField({patch:maskPatch,eyePatch:patch,eyeHeightM:EYE,
    nearM:FAR_FIELD_NEAR_M,farM:FAR_FIELD_FAR_M,rings:FAR_FIELD_RINGS,despike:true});
  far.mesh.renderOrder=-0.49; far.mesh.visible=!!maskPatch; scene.add(far.mesh);
  const sea=createSeaPlane({patch,maskPatch,eyeHeightM:EYE});
  sea.mesh.renderOrder=-0.47; sea.mesh.visible=!!patch; scene.add(sea.mesh);

  // 앱과 같은 인자로 띠를 세웁니다.
  const bands=createTerrainBands(site.bandAngles, BAND_DIST, undefined, site.waterFrac, obs);
  scene.add(bands.group);

  for(const h of [near,far,sea]){ updateTerrainFieldEye(h,cam);
    const u=h.material.uniforms;
    u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
    u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
    if(u.uExposure) u.uExposure.value=EXPO;
    u.uSunAltDeg.value=30; u.uSunAltRad.value=30*Math.PI/180;
    u.uSunAzRad.value=200*Math.PI/180;
    u.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85); }
  updateSeaPlaneEye(sea,cam);
  updateGroundColors(ground, 30, 0, {skyMean:sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
  updateTerrainBands(bands, 30, {skyMean:sky, hazeAt:()=>sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});

  let 띠화소=0, 지면화소=0, 총=0, 최악=0;
  for(const pitch of PITCHES) for(let i=0;i<8;i++){
    const az=(i*360)/8, ar=az*Math.PI/180, pr=pitch*Math.PI/180;
    cam.up.set(0,1,0);
    cam.lookAt(cam.position.x+Math.sin(ar)*Math.cos(pr), cam.position.y+Math.sin(pr),
               cam.position.z-Math.cos(ar)*Math.cos(pr));
    cam.updateMatrixWorld(true);
    r.setRenderTarget(rt); r.clear(); r.render(scene,cam);
    r.readRenderTargetPixels(rt,0,0,W,H,bufA);
    bands.group.visible=false;
    r.clear(); r.render(scene,cam);
    r.readRenderTargetPixels(rt,0,0,W,H,bufB);
    bands.group.visible=true; r.setRenderTarget(null);
    let n=0;
    for(let k=0;k<W*H;k++){ const o=k*4;
      const d=Math.abs(bufA[o]-bufB[o])+Math.abs(bufA[o+1]-bufB[o+1])
             +Math.abs(bufA[o+2]-bufB[o+2])+Math.abs(bufA[o+3]-bufB[o+3]);
      if(d>6) n++;
      if(bufA[o+3]>128) 지면화소++; }
    띠화소+=n; 총+=W*H; 최악=Math.max(최악,n);
    if(i===0&&pitch===PITCHES[0]){ r.render(scene,cam);
      const c=document.createElement('canvas'); c.width=W; c.height=H;
      c.style.width='150px'; c.style.height='150px';
      c.getContext('2d').drawImage(canvas,0,0);
      const t=document.createElement('div'); t.style.font='10px monospace';
      t.textContent=site.key+(withDem?'':' · DEM 없음');
      document.getElementById('shots').appendChild(t);
      document.getElementById('shots').appendChild(c); }
  }
  scene.remove(bands.group); bands.dispose();
  for(const h of [near,far,sea]){ scene.remove(h.mesh); h.dispose?.(); }
  return { 띠화소, 지면화소, 총화소:총, 최악한장:최악, 비율:+(100*띠화소/총).toFixed(3) };
}

const 결과={};
for(const s of SITES) 결과[s.key]=await run(s,true);
결과['DEM 없음']=await run(SITES[0],false);

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError:r.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+r.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'bands-need.html'), html);
console.log('생성 완료: bands-need.html');
