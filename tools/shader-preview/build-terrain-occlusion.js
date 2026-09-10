/**
 * **지형이 지평선 아래를 칠하는가, 그리고 태양을 가리는가**
 * (사용자 보고 1번: "지평선 아래로 땅 아래에 반투명하게 산의 계곡들도 보여.
 *  태양과 달이 산 뒤에서 떠올라야 하는데 산보다 위에서 보여").
 *
 * ## 왜 자부터 만드는가
 *
 * 씬은 깊이 버퍼가 아니라 **renderOrder(화가 알고리즘)** 로 정렬합니다:
 *
 * ```
 *   태양·달        -0.55   depthWrite: false
 *   groundPlane    -0.50   depthWrite: false  ("산 능선 메쉬를 가리지 않도록")
 *   지형 링        -0.40 ~ -0.30   depthWrite: true
 * ```
 *
 * 곧 땅을 먼저 칠하고 지형을 그 위에 덧칠합니다. 순서를 바꾸면 저 주석이
 * 막으려던 것(산 능선이 땅에 가려지는 것)이 되살아납니다. **어느 쪽이든
 * 한쪽을 고치고 다른 쪽을 깨기 쉬우므로 재는 자가 먼저입니다.**
 *
 * ## 재는 법
 *
 * 진짜 `SceneComposer` 를 태웁니다 — 앱과 같은 층 배정(`assignLayer`)과 같은
 * 합성 경로입니다. 지금까지 천정 부챗살 자 셋이 실패한 남은 구조적 차이가
 * 그것이었으므로, 이번에는 그 차이를 없앱니다.
 *
 * 1. **먼 지형이 가까운 땅을 뚫고 보이는가** — 사용자가 말한 "반투명한 계곡"
 *    입니다.
 *
 *    ⚠ **첫 판은 틀렸습니다.** 처음에는 "지평선 아래에 지형 화소가 있는가" 를
 *    셌는데, 발밑 땅이 거기 있는 것은 **당연합니다**(1,768화소가 나왔지만
 *    그건 정상입니다). 그 자는 결함이 아니라 정상을 세고 있었습니다.
 *
 *    고친 자는 셋을 견줍니다: ① 근거리+원거리 ② 근거리만 ③ 지형 없음.
 *    ②와 ③이 다른 화소는 **근거리 지형이 덮고 있는 자리**입니다. 그 자리에서
 *    ①과 ②가 다르면 **원거리 지형이 근거리 지형을 뚫고 나온 것**입니다.
 *    그게 0 이어야 합니다.
 *    ⚠ **양방향 대조**: 켬 → 끔 → 켬. 없으면 "두 번째 렌더라 달라졌다" 를
 *    못 가릅니다.
 *
 * 2. **태양 가림** — 능선 꼭대기를 먼저 화면에서 재고, 태양을 그보다 **아래**
 *    와 **위**에 각각 두어 태양을 껐다 켭니다. 아래면 밝기가 안 변해야 하고
 *    (가려짐), 위면 변해야 합니다(양성 대조). 두 짝이 다 있어야 "가려진다"
 *    를 주장할 수 있습니다.
 *
 * 3. **후처리가 태양을 산 위로 번지게 하는가** — 2 가 통과하면 씬 안에서는
 *    가려진다는 뜻이므로, 남은 곳은 **합성 뒤**입니다. 블룸·박명광선을 껐다
 *    켜고 **지형인 화소**의 밝기 변화를 잽니다. 능선 아래 태양인데 지형이
 *    밝아지면 후처리가 산 위로 새는 것입니다.
 *
 *    ⚠ 박명광선의 그늘 지도는 `rtCloud`(구름 덱 버퍼)에서만 나옵니다 —
 *    **지형은 그 안에 없습니다**(`SceneComposer` 771행 `blit(..., rtCloud.texture)`).
 *    곧 산은 광선을 못 가립니다. 이 자에는 구름이 없으므로 광선 쪽 기여는
 *    거의 0 일 수 있고, 그때 잡히는 것은 블룸입니다. 둘을 갈라 잽니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-terrain-occlusion.js
 *       node tools/shader-preview/verify-terrain-occlusion.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const { DEFAULT_ATMOS } = require('./app-lighting');
const LIGHT = require('./app-lighting').appLighting(5, 90);
const D = require('./dem-cpu');

const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;
const SITE = { key: '내륙(도곡동)', lat: 37.489130, lon: 127.043169, near: 'dem-dogok', wide: 'wide-dogok' };

{
  const dem = D.makeCpuDem({
    demDir: path.join(PREVIEW, SITE.near),
    zoom: D.demZoomForRadius(FIELD_FAR_M, SITE.lat, BLOCK),
    lat: SITE.lat, lon: SITE.lon,
  });
  const h = dem.elevAtGround(0, 0);
  if (h === null) throw new Error('발밑 고도를 못 읽었습니다 — 타일이 없습니다');
  SITE.obsM = +h.toFixed(2);
  console.log(`${SITE.key} 발밑 ${SITE.obsM}m`);
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:940px} canvas{border:1px solid #345;margin:2px}
 pre{font:11px monospace;white-space:pre-wrap}
</style></head><body>
<div id="wrap"><h3>지형이 지평선 아래를 칠하는가 · 태양을 가리는가</h3>
<div id="shots"></div><pre id="out"></pre></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';
import { createGroundPlane, setGroundHorizon, seaHorizonDipDeg, createTerrainBands }
  from './app/components/SkyScene3D/TerrainRing.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { createSceneComposer, assignLayer, LAYER_MID, LAYER_SOFT_CLOUD }
  from './app/components/SkyScene3D/SceneComposer.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
// ⚠ 모듈에서 예외가 터지면 아래 코드가 통째로 안 돌아 **제목이 안 세워집니다**.
//   그러면 판정이 5분을 기다리다 죽고, 무엇이 틀렸는지 한 줄도 안 남습니다.
//   실제로 그렇게 한 번 날렸습니다. 예외를 잡아 제목과 #out 에 남깁니다.
const die=(msg)=>{
  errors.push(String(msg));
  document.getElementById('out').textContent=JSON.stringify({fatal:String(msg),errors},null,1);
  document.title='DONE::ERR';
};
window.addEventListener('error', e=>die(e.message));
window.addEventListener('unhandledrejection', e=>die(e.reason && e.reason.message || e.reason));

const SITE=${JSON.stringify(SITE)};
const BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, MASK_R=${MASK_RADIUS_M}, EYE=${EYE_M};
const ATMOS=${JSON.stringify(DEFAULT_ATMOS)};

const W=320,H=320,FOVY=24, AZ=90;
const azR=AZ*Math.PI/180;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
document.getElementById('shots').appendChild(canvas);
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false});
r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0x000000,1);
const buf=new Uint8Array(W*H*4);
const tanV=Math.tan(FOVY*Math.PI/360);
/** 화면 행 → 고도각(도). 카메라 앙각 0 기준. */
const rowElev=y=>Math.atan(tanV*(1-2*(y+0.5)/H))*180/Math.PI;
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});

clearDemCache();
const patch=await loadDemPatch(SITE.lat,SITE.lon,FAR,{renderer:r,loadTexture,block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${SITE.near}/\${z}_\${x}_\${y}.png\`});
const maskPatch=await loadDemPatch(SITE.lat,SITE.lon,MASK_R,{renderer:r,loadTexture,block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${SITE.wide}/\${z}_\${x}_\${y}.png\`});
if(!patch||!maskPatch) errors.push('패치 없음');

const obs=SITE.obsM;
const dip=seaHorizonDipDeg(obs+EYE);      // 도, 양수. 지평선은 −dip 에 있습니다.
const scene=new THREE.Scene();

const ground=createGroundPlane(); setGroundHorizon(ground,obs); scene.add(ground);
const near=createTerrainField({patch,eyePatch:patch,eyeHeightM:EYE});
const far =createTerrainField({patch:maskPatch,eyePatch:patch,eyeHeightM:EYE});
scene.add(near.mesh); scene.add(far.mesh);
// ⚠ 도곡동 DEM 은 방위 90° 에 지평선 위로 솟은 산이 **없습니다**(능선 −0.72°).
//   그러면 "산이 태양을 가리는가" 를 물을 수가 없습니다. 사진 1 에 나오는 것도
//   DEM 근거리가 아니라 **원경 산줄기 밴드**이므로, 8° 능선을 세워 둡니다.
const RIDGE_DEG=8;
const bandAngles=[new Array(64).fill(RIDGE_DEG)];
const bands=createTerrainBands(bandAngles,[30],undefined,null,obs);
scene.add(bands.group);

const sun=createSun(); scene.add(sun.mesh);

// 박명광선의 그늘 지도는 **구름 덱 버퍼**에서 나옵니다. 구름이 하나도 없으면
// 그 버퍼가 비어 광선이 아무것도 안 만들고, 그러면 "광선이 안 샌다" 는 판정이
// **공허하게 통과**합니다. 하늘에 판을 하나 띄워 버퍼를 채웁니다.
const cloudMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,side:THREE.DoubleSide});
const cloudQuad=new THREE.Mesh(new THREE.PlaneGeometry(400,120),cloudMat);
cloudQuad.position.set(Math.sin(azR)*300,120,-Math.cos(azR)*300);
cloudQuad.lookAt(0,0,0);
scene.add(cloudQuad);

for(const o of [ground,near.mesh,far.mesh,bands.group,sun.mesh]) assignLayer(o,LAYER_MID);
assignLayer(cloudQuad,LAYER_SOFT_CLOUD);

// ⚠ near/far 는 **앱과 같아야 합니다**(SkyScene3D: 0.1, 1000). 처음에 far 를
//   4e7 로 두었다가 깊이 정밀도가 무너져 "산이 태양을 안 가린다" 는 가짜
//   결과를 얻을 뻔했습니다. 태양(490)과 지형 링(480)은 10 단위 차이라
//   far 를 키우면 그 차이가 깊이 버퍼에서 사라집니다.
const cam=new THREE.PerspectiveCamera(FOVY,W/H,0.1,1000);
cam.position.set(0,0,0);
cam.lookAt(Math.sin(azR),0,-Math.cos(azR));
cam.updateMatrixWorld(true);
for(const h of [near,far]) updateTerrainFieldEye(h,cam);

const composer=createSceneComposer(W,H);
composer.setGodRays({strength:0});         // 이 자는 광선을 안 봅니다 — 별건입니다.

function shot(){
  composer.render(r,scene,cam);
  r.readRenderTargetPixels ? null : null;
  const gl=r.getContext();
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf.slice();
}
/** readPixels 는 아래가 0행입니다 — 화면 행으로 뒤집어 읽습니다. */
const at=(b,x,yScreen)=>{const y=H-1-yScreen; const i=(y*W+x)*4; return (b[i]+b[i+1]+b[i+2])/3;};

const differs=(a,b,x,y)=>Math.abs(at(a,x,y)-at(b,x,y))>6;
function countDiff(a,b){ let n=0; for(let y=0;y<H;y++)for(let x=0;x<W;x++) if(differs(a,b,x,y)) n++; return n; }
/**
 * 원거리 지형이 **근거리 지형이 덮은 자리**를 뚫고 나온 화소 수.
 * bothOn 대 nearOnly 가 다르면서, nearOnly 대 noTerrain 도 다른 자리입니다.
 */
function farLeak(bothOn,nearOnly,noTerrain){
  let leak=0, nearCovered=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const covered=differs(nearOnly,noTerrain,x,y);
    if(covered){ nearCovered++; if(differs(bothOn,nearOnly,x,y)) leak++; }
  }
  return {leak,nearCovered};
}

const R={site:SITE.key,obsM:obs,dipDeg:+dip.toFixed(4),W,H,FOVY,AZ};

// ── 1) 원거리 지형이 근거리 지형을 뚫고 나오는가 (양방향 대조) ──────────────
sun.mesh.visible=false;
cloudQuad.visible=false;
near.mesh.visible=true;  far.mesh.visible=true;  bands.group.visible=true;  const onA=shot();
near.mesh.visible=true;  far.mesh.visible=false; bands.group.visible=false; const nearOnly=shot();
near.mesh.visible=false; far.mesh.visible=false; bands.group.visible=false; const off =shot();
near.mesh.visible=true;  far.mesh.visible=true;  bands.group.visible=true;  const onB=shot();
R.sameTwice   = countDiff(onA,onB);            // 대조: 같은 조건이니 0 이어야 합니다
R.terrainSeen = countDiff(onA,off);            // 양성 대조: 자가 지형을 보는가
R.far         = farLeak(onA,nearOnly,off);

// ── 2) 능선 꼭대기를 화면에서 잰다 ─────────────────────────────────────────
// 화면 중앙 열에서 지형을 껐을 때와 달라지는 가장 높은 행.
let ridgeTopDeg=-90;
{
  const x=Math.floor(W/2);
  for(let y=0;y<H;y++){
    if(Math.abs(at(onA,x,y)-at(off,x,y))>6){ ridgeTopDeg=rowElev(y); break; }
  }
}
R.ridgeTopDeg=+ridgeTopDeg.toFixed(3);

// ── 3) 태양 가림 (아래 = 가려져야, 위 = 보여야) ────────────────────────────
function sunDelta(altDeg){
  updateSun(sun,altDeg,AZ,ATMOS,1);
  sun.mesh.visible=false; const noSun=shot();
  sun.mesh.visible=true;  const withSun=shot();
  // 태양이 있어야 할 화면 자리 둘레 9×9
  const yc=Math.round((1-Math.tan(altDeg*Math.PI/180)/tanV)*H/2-0.5);
  const xc=Math.floor(W/2);
  let s=0,n=0,peak=0;
  for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
    const x=xc+dx,y=yc+dy; if(x<0||x>=W||y<0||y>=H) continue;
    const d=at(withSun,x,y)-at(noSun,x,y); s+=d; n++; peak=Math.max(peak,d);
  }
  return {altDeg,rowY:yc,meanDelta:n?+(s/n).toFixed(2):null,peakDelta:+peak.toFixed(2)};
}
// ── 3b) 밴드가 태양을 가리는가 — 네 조합을 직접 잰다 ────────────────────────
// [3]과 [4]가 서로 안 맞아서 넣었습니다. 추론 대신 네 경우를 그대로 봅니다.
function boxMean(b,altDeg){
  const yc=Math.round((1-Math.tan(altDeg*Math.PI/180)/tanV)*H/2-0.5), xc=Math.floor(W/2);
  let s=0,n=0;
  for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
    const x=xc+dx,y=yc+dy; if(x<0||x>=W||y<0||y>=H) continue; s+=at(b,x,y); n++;
  }
  return n?+(s/n).toFixed(2):null;
}
{
  const a=ridgeTopDeg-2.0;
  updateSun(sun,a,AZ,ATMOS,1);
  cloudQuad.visible=false;
  const set=(bandsOn,sunOn)=>{ bands.group.visible=bandsOn; sun.mesh.visible=sunOn; return boxMean(shot(),a); };
  R.grid={
    alt:+a.toFixed(2),
    bandsOn_sunOff : set(true ,false),
    bandsOn_sunOn  : set(true ,true ),
    bandsOff_sunOff: set(false,false),
    bandsOff_sunOn : set(false,true ),
  };
  bands.group.visible=true;
}

const belowAlt=ridgeTopDeg-2.0;
const aboveAlt=ridgeTopDeg+4.0;
R.sunBelowRidge=sunDelta(belowAlt);
R.sunAboveRidge=sunDelta(aboveAlt);

// ── 4) 후처리(블룸·광선)가 태양을 지형 위로 번지게 하는가 ────────────────────
// 능선 **아래** 태양으로 둡니다 — 씬 안에서는 3)이 "안 보인다" 고 했습니다.
updateSun(sun,belowAlt,AZ,ATMOS,1);
sun.mesh.visible=true;
cloudQuad.visible=true;
// ⚠ **이걸 안 부르면 광선이 아예 안 켜집니다.** 처음에 빠뜨려 광선 세기 0 으로
//   "안 샌다" 가 공허하게 통과했습니다. 판정에서 세기 > 0 을 못 박습니다.
{
  const a=belowAlt*Math.PI/180;
  composer.setSun(new THREE.Vector3(Math.sin(azR)*Math.cos(a),Math.sin(a),-Math.cos(azR)*Math.cos(a)),belowAlt);
}
function postLeak(setup){
  setup();
  const withSun=shot();
  sun.mesh.visible=false; const noSun=shot(); sun.mesh.visible=true;
  // 지형인 화소(= 지형을 끄면 달라지는 자리)에서만 잽니다.
  let s=0,n=0,peak=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    if(!differs(onA,off,x,y)) continue;
    const d=at(withSun,x,y)-at(noSun,x,y);
    s+=d; n++; peak=Math.max(peak,d);
  }
  // 화면 어디서든 달라졌는가 — 그 패스가 정말 일하고 있는지 보는 양성 대조.
  let anyChanged=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) if(differs(withSun,noSun,x,y)) anyChanged++;
  return {n,mean:n?+(s/n).toFixed(3):null,peak:+peak.toFixed(2),
          anyChanged,rayGain:+composer.lastRayGain().toFixed(4)};
}
R.postOff   = postLeak(()=>{ composer.setBloom({strength:0}); composer.setGodRays({strength:0}); });
R.postBloom = postLeak(()=>{ composer.setBloom({strength:0.6}); composer.setGodRays({strength:0}); });
R.postRays  = postLeak(()=>{ composer.setBloom({strength:0}); composer.setGodRays({strength:0.35}); });
composer.setBloom({strength:0}); composer.setGodRays({strength:0});

R.errors=errors;
R.glError=r.getContext().getError();
document.getElementById('out').textContent=JSON.stringify(R,null,1);
document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'terrain-occlusion.html'), html);
console.log('생성: terrain-occlusion.html');
