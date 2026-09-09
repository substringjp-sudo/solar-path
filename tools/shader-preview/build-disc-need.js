/**
 * **옛 지면 원반이 아직 필요한가** (사용자 물음: "일단 옛 원반은 없애도 되지 않을까?").
 *
 * 원반(`createGroundPlane`)은 DEM 지형이 생기기 전의 지면이었습니다. 지금은
 * 배경으로 먼저 칠해지고 그 위에 근거리 지형(3km) · 먼 지형(55km) · 해수면이
 * 그려집니다. 그러면 원반이 실제로 **화면에 남는 자리**가 있는가?
 *
 * ## 재는 법 — 원반만 껐다 켠 두 장의 차이
 *
 * 색으로 "원반 같다"를 추측하지 않고, 원반을 끄면 달라지는 화소를 셉니다.
 * 그 화소가 곧 "원반이 보이는 자리"입니다.
 *
 * ⚠ 예전 `verify-handoff.js` 는 **하늘 구멍**만 봤고, 원반을 통째로 빼도
 * 구멍이 0 이었습니다 — 그 자는 이 물음에 무딥니다. 여기서는 원반이 이긴
 * 화소를 직접 셉니다.
 *
 * ## 어디를 보나
 *
 * 세 자리 × 여덟 방위 × 두 내려본각. 자리마다 성격이 다릅니다:
 * 내륙(도곡동)은 3km 밖이 전부 뭍, 바닷가(대부도)는 갯벌과 바다가 섞이고,
 * 높은 곳(마니산)은 발밑부터 수십 km 까지 한눈에 들어옵니다.
 *
 * ⚠ **DEM 이 없을 때**도 따로 잽니다. 그때는 원반이 지면의 전부이므로,
 * "지금은 안 보인다"가 곧 "지워도 된다"는 뜻이 아닙니다.
 *
 * 사용: node tools/shader-preview/build-disc-need.js
 *       node tools/shader-preview/verify-disc-need.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;
/** 조명은 앱에서 가져옵니다 — 하네스가 지어낸 조도는 세 번 판정을 망쳤습니다. */
const LIGHT = require('./app-lighting').appLighting(30, 200);
const SITES = [
  { key: '내륙', lat: 37.489130, lon: 127.043169, near: 'dem-dogok', wide: 'wide-dogok' },
  { key: '바닷가', lat: 37.24102, lon: 126.55969, near: 'dem', wide: 'wide-daebu' },
  { key: '높은곳', lat: 37.61553, lon: 126.4300, near: 'dem-mani', wide: 'wide-mani' },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:920px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>옛 지면 원반이 아직 화면에 남는가</h3>
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
const BAND_DIST=[5,15,40], SAMPLES=31;
const IRR=${JSON.stringify(LIGHT.surfaceIrr)}, SUNR=${JSON.stringify(LIGHT.sunRadiance)}, EXPO=${LIGHT.exposure};

const W=256, H=256, FOV=70;
const PITCHES=[-6, -25];
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const bufA=new Uint8Array(W*H*4), bufB=new Uint8Array(W*H*4);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

// 능선 띠는 수평선 아래로 접히는 보수적 합성값 — 원반을 가려 주지 않게.
const BANDS=BAND_DIST.map(()=>Array(SAMPLES).fill(-999));
const WATER=Array(SAMPLES).fill(0);
const sky={r:0.83,g:1.03,b:1.27};

async function run(site, withDem){
  clearDemCache();
  let patch=null, maskPatch=null;
  if (withDem) {
    patch=await loadDemPatch(site.lat, site.lon, FAR, {renderer, loadTexture, block:BLOCK,
      tileUrl:(z,x,y)=>\`./\${site.near}/\${z}_\${x}_\${y}.png\`});
    maskPatch=await loadDemPatch(site.lat, site.lon, MASK_R, {renderer, loadTexture, block:BLOCK,
      tileUrl:(z,x,y)=>\`./\${site.wide}/\${z}_\${x}_\${y}.png\`});
    if(!patch||!maskPatch){ errors.push(site.key+' 패치 없음'); return null; }
  }
  const obs = 0;
  const scene=new THREE.Scene();
  const ground=createGroundPlane(); setGroundHorizon(ground, obs); scene.add(ground);
  // ⚠ 앱과 같이 카메라를 **원반보다 1.6 위**에 둡니다. 처음에 둘 다 y=0 에
  //   뒀더니 원반이 모로 서서 화면에 한 화소도 안 잡혔고(지면 화소 0),
  //   "원반이 안 보인다"는 답이 그냥 하네스 결함이었습니다.
  const cam=new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);
  cam.position.set(0, ground.position.y + 1.6, 0);

  const near=createTerrainField({patch, eyePatch:patch, eyeHeightM:EYE});
  near.mesh.renderOrder=-0.48; near.mesh.visible=!!patch; scene.add(near.mesh);
  const far=createTerrainField({patch:maskPatch, eyePatch:patch, eyeHeightM:EYE,
    nearM:FAR_FIELD_NEAR_M, farM:FAR_FIELD_FAR_M, rings:FAR_FIELD_RINGS, despike:true});
  far.mesh.renderOrder=-0.49; far.mesh.visible=!!maskPatch; scene.add(far.mesh);
  const sea=createSeaPlane({patch, maskPatch, eyeHeightM:EYE});
  sea.mesh.renderOrder=-0.47; sea.mesh.visible=!!patch; scene.add(sea.mesh);
  const bands=createTerrainBands(BANDS, BAND_DIST, undefined, WATER, obs);
  scene.add(bands.group);

  for (const h of [near, far, sea]) { updateTerrainFieldEye(h, cam);
    const u=h.material.uniforms;
    u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
    u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
    u.uExposure.value=EXPO;
    u.uSunAltDeg.value=30; u.uSunAltRad.value=30*Math.PI/180;
    u.uSunAzRad.value=200*Math.PI/180;
    u.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85); }
  updateSeaPlaneEye(sea, cam);
  updateGroundColors(ground, 30, 0, {skyMean:sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
  updateTerrainBands(bands, 30, {skyMean:sky, hazeAt:()=>sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});

  let 원반화소=0, 지면화소=0, 총=0, 최악=0;
  for (const pitch of PITCHES) {
    for (let i=0;i<8;i++){
      const az=(i*360)/8, ar=az*Math.PI/180, pr=pitch*Math.PI/180;
      cam.up.set(0,1,0);
      cam.lookAt(cam.position.x + Math.sin(ar)*Math.cos(pr),
                 cam.position.y + Math.sin(pr),
                 cam.position.z - Math.cos(ar)*Math.cos(pr));
      cam.updateMatrixWorld(true);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
      renderer.readRenderTargetPixels(rt,0,0,W,H,bufA);
      ground.visible=false;
      renderer.clear(); renderer.render(scene,cam);
      renderer.readRenderTargetPixels(rt,0,0,W,H,bufB);
      ground.visible=true; renderer.setRenderTarget(null);
      let n=0;
      for(let k=0;k<W*H;k++){
        const o=k*4;
        const d=Math.abs(bufA[o]-bufB[o])+Math.abs(bufA[o+1]-bufB[o+1])
               +Math.abs(bufA[o+2]-bufB[o+2])+Math.abs(bufA[o+3]-bufB[o+3]);
        if(d>6) n++;
        if(bufA[o+3]>128) 지면화소++;
      }
      원반화소+=n; 총+=W*H; 최악=Math.max(최악,n);
      if(i===0){ renderer.render(scene,cam);
        const c=document.createElement('canvas'); c.width=W; c.height=H;
        c.style.width='110px'; c.style.height='110px';
        c.getContext('2d').drawImage(canvas,0,0);
        const t=document.createElement('div'); t.style.font='10px monospace';
        t.textContent=site.key+(withDem?' · DEM 있음':' · DEM 없음')+' 내려본각'+pitch;
        document.getElementById('shots').appendChild(t);
        document.getElementById('shots').appendChild(c); }
    }
  }
  scene.remove(bands.group); bands.dispose();
  for (const h of [near, far, sea]) { scene.remove(h.mesh); h.dispose?.(); }
  return { 원반화소, 지면화소, 총화소:총, 최악한장:최악,
           비율:+(100*원반화소/총).toFixed(3) };
}

const 결과={};
for (const s of SITES) 결과[s.key]=await run(s, true);
결과['DEM 없음']=await run(SITES[0], false);

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'disc-need.html'), html);
console.log('생성 완료: disc-need.html');
