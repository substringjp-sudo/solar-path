/**
 * **옛 원반이 높은 곳에서 하늘을 지면으로 칠하는가**
 * (사용자 의심: "발밑 원판은 내가 경사진 곳이나 산꼭대기일 때 잘 안 그려질 것 같은데").
 *
 * ## 왜 의심할 만한가 — setGroundHorizon 이 무력화돼 있습니다
 *
 * `setGroundHorizon` 은 원반을 `y = -480·tan(수평선 처짐)` 으로 내립니다.
 * 관측지가 높을수록 수평선이 더 처지니 원반도 더 내려가야 맞습니다.
 *
 * 그런데 앱은 카메라도 `groundY + 1.6` 으로 **같이** 내립니다. 그러면 원반과
 * 카메라의 상대 높이가 늘 1.6 이라, 원반 테두리가 보이는 각은
 * `atan(-1.6/480) = -0.191°` 로 **관측지 고도와 무관하게 고정**됩니다.
 * 내린 만큼 눈도 내려가서 서로 지웁니다.
 *
 * 한편 진짜 수평선은 고도와 함께 처집니다 (350m 에서 0.601°,
 * 1,950m 에서 1.417°). 그 사이 띠는 **하늘이어야 하는데 원반이 지면으로
 * 칠합니다.** 지형·해수면 격자는 55/60km 에서 끝나 그보다 아래를 덮으므로
 * 이 띠를 가려 주지 못합니다.
 *
 * ## 재는 법
 *
 * 수평 시선에 **세로 화각 4°** 를 씌워 지평선 언저리만 확대해 봅니다
 * (화소당 0.008°). 원반만 껐다 켜고, 달라진 화소의 고도각 범위를 잽니다.
 * 그 위쪽 끝이 곧 "원반이 칠한 가장 높은 자리" 입니다.
 *
 * ⚠ 대조가 둘 필요합니다:
 *   ① 해수면 관측지 — 여기서는 띠가 거의 없어야 합니다. 어디서나 띠가
 *      나온다면 자가 지형·해수면 격자의 끝을 잘못 읽는 것입니다.
 *   ② DEM 없음 — 그때는 원반이 지면의 전부이므로 띠 이야기가 무의미합니다.
 *
 * 사용: node tools/shader-preview/build-disc-horizon.js
 *       node tools/shader-preview/verify-disc-horizon.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const LIGHT = require('./app-lighting').appLighting(25, 135);
const D = require('./dem-cpu');

const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;
/** 고도가 다른 세 자리. 발밑 고도는 DEM 이 정하므로 여기 숫자는 참고값입니다. */
/** 물가 겹침 폭 훑기 (m). 0 은 지금(딱 맞닿음). */
const OVERLAPS = [0, 1, 3, 10];
const SITES = [
  { key: '바닷가', lat: 37.24102, lon: 126.55969, near: 'dem', wide: 'wide-daebu' },
  { key: '내륙', lat: 37.489130, lon: 127.043169, near: 'dem-dogok', wide: 'wide-dogok' },
  { key: '산꼭대기', lat: 37.61553, lon: 126.4300, near: 'dem-mani', wide: 'wide-mani' },
];

/**
 * 발밑 고도는 **DEM 자신**이 정합니다 — 앱과 같은 규약입니다. 바깥 자료를
 * 쓰면 몇 m 만 어긋나도 눈이 지면에 파묻히거나 떠오릅니다(계획서 2단계).
 * 브라우저 쪽에서는 패치가 이 값을 내주지 않으므로 여기서 미리 짚습니다.
 */
for (const s of SITES) {
  const dem = D.makeCpuDem({
    demDir: path.join(PREVIEW, s.near),
    zoom: D.demZoomForRadius(FIELD_FAR_M, s.lat, BLOCK),
    lat: s.lat, lon: s.lon,
  });
  const h = dem.elevAtGround(0, 0);
  if (h === null) throw new Error(s.key + ' 발밑 고도를 못 읽었습니다 — 타일이 없습니다');
  s.obsM = +h.toFixed(2);
  console.log(`${s.key} 발밑 ${s.obsM}m`);
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>옛 원반이 수평선 위(하늘)를 지면으로 칠하는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye,
         FAR_FIELD_NEAR_M, FAR_FIELD_FAR_M, FAR_FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';
import { createGroundPlane, setGroundHorizon, updateGroundColors }
  from './app/components/SkyScene3D/TerrainRing.js';
import { seaHorizonDipDeg } from './app/utils/earth.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const SITES=${JSON.stringify(SITES)};
const OVERLAPS=${JSON.stringify(OVERLAPS)};
const BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, MASK_R=${MASK_RADIUS_M}, EYE=${EYE_M};
const IRR=${JSON.stringify(LIGHT.surfaceIrr)}, SUNR=${JSON.stringify(LIGHT.sunRadiance)};
const EXPO=${LIGHT.exposure};

// 지평선 언저리만 확대해 봅니다 — 세로 4° 를 512화소로 (화소당 0.0078°).
const W=256,H=512,FOVY=4, AZ=[0,45,90,135,180,225,270,315];
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true});
r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
const bufA=new Uint8Array(W*H*4), bufB=new Uint8Array(W*H*4);
const tanV=Math.tan(FOVY*Math.PI/360);
const rowElev=y=>Math.atan(tanV*(2*(y+0.5)/H-1))*180/Math.PI;
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});

async function run(site, withDem, overlapM){
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
  const dip = seaHorizonDipDeg(obs + EYE);

  const scene=new THREE.Scene();
  const ground=createGroundPlane(); setGroundHorizon(ground, obs); scene.add(ground);
  const cam=new THREE.PerspectiveCamera(1,1,0.1,2000);
  // 앱과 같은 세로 화각 규약을 쓰지 않고 지평선만 확대합니다.
  cam.fov=FOVY; cam.aspect=W/H; cam.updateProjectionMatrix();
  cam.position.set(0, ground.position.y + EYE, 0);

  const near=createTerrainField({patch,eyePatch:patch,eyeHeightM:EYE});
  near.mesh.renderOrder=-0.48; near.mesh.visible=!!patch; scene.add(near.mesh);
  const far=createTerrainField({patch:maskPatch,eyePatch:patch,eyeHeightM:EYE,
    nearM:FAR_FIELD_NEAR_M,farM:FAR_FIELD_FAR_M,rings:FAR_FIELD_RINGS,despike:true});
  far.mesh.renderOrder=-0.49; far.mesh.visible=!!maskPatch; scene.add(far.mesh);
  const sea=createSeaPlane({patch,maskPatch,eyeHeightM:EYE});
  sea.mesh.renderOrder=-0.47; sea.mesh.visible=!!patch; scene.add(sea.mesh);

  for(const h of [near,far,sea]){ updateTerrainFieldEye(h,cam);
    if(h.material.uniforms.uShoreOverlapM) h.material.uniforms.uShoreOverlapM.value=overlapM||0;
    const u=h.material.uniforms;
    u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
    u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
    if(u.uExposure) u.uExposure.value=EXPO;
    u.uSunAltDeg.value=25; u.uSunAltRad.value=25*Math.PI/180; u.uSunAzRad.value=135*Math.PI/180;
    u.uHazeRadiance.value.set(IRR[0]*0.7,IRR[1]*0.75,IRR[2]*0.85); }
  updateSeaPlaneEye(sea,cam);
  updateGroundColors(ground, 25, 0, {skyMean:{r:IRR[0],g:IRR[1],b:IRR[2]},
    betaMie:0.08, angstrom:1.3, elevScale:1.0});

  // ⚠ **원반 테두리는 따로 재야 합니다.** 아래 "원반이 이긴 화소" 의 위끝은
  //   테두리가 아니라 *지형이 안 덮은 자리* 라, 사방이 뭍인 내륙에서는 땅이
  //   테두리를 가려 버려 엉뚱한 값이 나옵니다 (처음에 그걸 테두리로 읽고
  //   판정을 잘못 짰습니다). 지형·해수면을 숨기고 원반만 그려 잽니다.
  let 물화소=0, 뭍화소=0;
  let 테두리=-90;
  {
    for(const h of [near,far,sea]) h.mesh.visible=false;
    const a=0;
    cam.up.set(0,1,0);
    cam.lookAt(cam.position.x+Math.sin(a), cam.position.y, cam.position.z-Math.cos(a));
    cam.updateMatrixWorld(true);
    r.setRenderTarget(rt); r.clear(); r.render(scene,cam);
    r.readRenderTargetPixels(rt,0,0,W,H,bufA); r.setRenderTarget(null);
    for(let y=H-1;y>=0;y--){ let hit=false;
      for(let x=0;x<W;x++) if(bufA[(y*W+x)*4+3]>128){hit=true;break;}
      if(hit){ 테두리=rowElev(y); break; } }
    near.mesh.visible=!!patch; far.mesh.visible=!!maskPatch; sea.mesh.visible=!!patch;
  }

  let 위끝=-90, 화소=0, 방위별=[];
  for(const az of AZ){
    const a=az*Math.PI/180;
    cam.up.set(0,1,0);
    cam.lookAt(cam.position.x+Math.sin(a), cam.position.y, cam.position.z-Math.cos(a));
    cam.updateMatrixWorld(true);
    r.setRenderTarget(rt); r.clear(); r.render(scene,cam);
    r.readRenderTargetPixels(rt,0,0,W,H,bufA);
    ground.visible=false;
    r.clear(); r.render(scene,cam);
    r.readRenderTargetPixels(rt,0,0,W,H,bufB);
    ground.visible=true; r.setRenderTarget(null);
    let top=-90, n=0;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const o=(y*W+x)*4;
      const d=Math.abs(bufA[o]-bufB[o])+Math.abs(bufA[o+1]-bufB[o+1])
             +Math.abs(bufA[o+2]-bufB[o+2])+Math.abs(bufA[o+3]-bufB[o+3]);
      if(d>6){ n++; const e=rowElev(y); if(e>top) top=e; }
      if(bufA[o+3]>128){ if(bufA[o+2]>bufA[o]) 물화소++; else 뭍화소++; }
    }
    방위별.push(+top.toFixed(4));
    화소+=n; if(top>위끝) 위끝=top;
  }
  { r.render(scene,cam);
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    c.style.width='90px'; c.style.height='180px';
    c.getContext('2d').drawImage(canvas,0,0);
    const t=document.createElement('div'); t.style.font='10px monospace';
    t.textContent=site.key+(withDem?'':' · DEM 없음');
    document.getElementById('shots').appendChild(t);
    document.getElementById('shots').appendChild(c); }

  scene.remove(ground);
  for(const h of [near,far,sea]){ scene.remove(h.mesh); h.dispose?.(); }
  return { 물화소, 뭍화소, 발밑고도:+obs.toFixed(1), 수평선처짐:+dip.toFixed(4),
           원반테두리:+테두리.toFixed(4),
           원반위끝:+위끝.toFixed(4), 원반화소:화소,
           거짓띠:+Math.max(0, 위끝-(-dip)).toFixed(4), 방위별 };
}

const 결과={};
for(const s of SITES) for(const ov of OVERLAPS)
  결과[s.key+' 겹침'+ov+'m']=await run(s,true,ov);
결과['DEM 없음']=await run(SITES[0],false,0);

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError:r.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+r.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'disc-horizon.html'), html);
console.log('생성 완료: disc-horizon.html');
