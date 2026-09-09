/**
 * **물가가 화소마다 엉키지 않는가** (실기 보고: 대부도).
 *
 * "물가와 바닷가가 엉켜서 보여", "바닷가와 땅 사이 경계에 이상하게 상자
 * 모양으로 각진 모양이 발생해."
 *
 * ## 자료가 이렇게 생겼습니다
 *
 * 대부도 근거리 DEM(줌 13, 화소 15m) 58만 화소를 세어 보면:
 *
 *     물 h < −0.5      2.43%
 *     −0.5 < h < 0    10.21%   ← 옛 규칙에서 **포말**
 *     정확히 0        38.55%   ← 옛 규칙에서 **깊은 바다(999m)**
 *     0 < h < 0.5      9.04%   ← **뭍**
 *
 * Terrarium 이 먼바다를 정확히 0 으로 자르기 때문에, 갯벌에서는 이 넷이
 * 화소 한 칸 차이로 뒤섞입니다. 화면에서는 「깊은 바다 · 흰 포말 · 갈색 뭍」
 * 이 격자무늬로 번갈아 찍히고, 경계가 화소 모서리를 따라 각집니다.
 *
 * ## 재는 법 — 가로 한 줄을 훑으며 **갈래가 몇 번 바뀌는가**
 *
 * 화소를 색으로 세 갈래(뭍 · 포말 · 물)로 나누고, 가로줄을 따라가며 갈래가
 * 바뀌는 횟수를 셉니다. 매끄러운 해안이면 한 줄에 두어 번, 격자무늬면
 * 수십 번입니다. **무엇이 예쁜가가 아니라 몇 번 뒤집히는가**를 세므로
 * 색조 취향에 안 휘둘립니다.
 *
 * ## 대조
 *
 * ① **포말 면적**도 같이 봅니다. 뒤집힘만 세면 "포말을 다 지우기" 가 만점을
 *    받습니다. 갯벌의 흰 판은 줄이되 0 이 되면 안 됩니다.
 * ② **바다는 그대로 있어야** 합니다(`verify-inland.js` 와 같은 이유).
 *
 * 사용: node tools/shader-preview/build-shorepatch.js
 *       node tools/shader-preview/verify-shorepatch.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

/** 대부도 서안 — 갯벌이 넓게 드러나는 자리. 타일은 이미 받아 두었습니다. */
const LAT = 37.24102, LON = 126.55969, NEAR_DIR = 'dem', MASK_DIR = 'wide-daebu';
const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>물가가 화소마다 엉키지 않는가 (대부도)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';
import { createGroundPlane, setGroundHorizon, updateGroundColors }
  from './app/components/SkyScene3D/TerrainRing.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, NEAR_DIR='${NEAR_DIR}', MASK_DIR='${MASK_DIR}';
const BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, MASK_R=${MASK_RADIUS_M}, EYE=${EYE_M};

// 갯벌을 내려다보려면 눈이 높아야 합니다 — 눈높이 1.6m 로는 3km 앞 갯벌이
// 내려본각 0.03° 라 수평선의 실 한 오라기입니다. 30m 전망대에서 봅니다.
const EYE_TOWER_M=30;
const W=384, H=384, FOV=60, PITCH=-14, LOOK_AZ=270;

const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

clearDemCache();
const patch=await loadDemPatch(LAT, LON, FAR, {renderer, loadTexture, block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${NEAR_DIR}/\${z}_\${x}_\${y}.png\`});
const maskPatch=await loadDemPatch(LAT, LON, MASK_R, {renderer, loadTexture, block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${MASK_DIR}/\${z}_\${x}_\${y}.png\`});
if(!patch||!maskPatch) errors.push('패치 없음');

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000); cam.position.set(0,0,0);
const ground=createGroundPlane(); setGroundHorizon(ground, 1.2); scene.add(ground);
const field=createTerrainField({patch, eyePatch:patch, eyeHeightM:EYE_TOWER_M});
field.mesh.renderOrder=-0.48; scene.add(field.mesh); updateTerrainFieldEye(field, cam);
const sea=createSeaPlane({patch, maskPatch, eyeHeightM:EYE_TOWER_M});
sea.mesh.renderOrder=-0.47; scene.add(sea.mesh); updateSeaPlaneEye(sea, cam);

const sky={r:0.83,g:1.03,b:1.27};
updateGroundColors(ground, 30, 0, {skyMean:sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
for (const m of [field.material, sea.material]) {
  m.uniforms.uSurfaceIrr.value.set(sky.r, sky.g, sky.b);
  m.uniforms.uSunRadiance.value.set(0.78, 0.66, 0.52);
  m.uniforms.uSunAltDeg.value=30; m.uniforms.uSunAltRad.value=30*Math.PI/180;
  m.uniforms.uSunAzRad.value=200*Math.PI/180;
  m.uniforms.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85);
  m.uniforms.uAerial.value=0;   // 거리로 색이 변하면 갈래 나누기가 흐려집니다
}

const pr=PITCH*Math.PI/180, ar=LOOK_AZ*Math.PI/180;
cam.up.set(0,1,0);
cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr));
cam.updateMatrixWorld(true);

function measure(label){
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
  renderer.render(scene,cam);
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  c.style.width='256px'; c.style.height='256px';
  c.getContext('2d').drawImage(canvas,0,0);
  const d=document.createElement('div'); d.style.font='10px monospace'; d.textContent=label;
  document.getElementById('shots').appendChild(d);
  document.getElementById('shots').appendChild(c);

  // 갈래: 0 = 하늘, 1 = 뭍(붉은끼), 2 = 포말(밝고 무채색), 3 = 물(푸른끼)
  const cls=new Uint8Array(W*H);
  let 포말=0, 물=0, 뭍=0;
  for(let i=0;i<W*H;i++){
    if(buf[i*4+3]<128){ cls[i]=0; continue; }
    const r=buf[i*4], g=buf[i*4+1], b=buf[i*4+2];
    const lum=0.2126*r+0.7152*g+0.0722*b;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    const chroma=(mx-mn)/Math.max(1,mx);
    if (lum>170 && chroma<0.14){ cls[i]=2; 포말++; }
    else if (b>r){ cls[i]=3; 물++; }
    else { cls[i]=1; 뭍++; }
  }
  // 가로줄마다 갈래가 바뀌는 횟수 (하늘은 건너뜁니다)
  let flips=0, rows=0, worst=0;
  for(let y=0;y<H;y++){
    let prev=0, n=0;
    for(let x=0;x<W;x++){
      const v=cls[y*W+x];
      if(v===0) continue;
      if(prev!==0 && v!==prev) n++;
      prev=v;
    }
    if(prev!==0){ flips+=n; rows++; worst=Math.max(worst,n); }
  }
  // ── 경계가 얼마나 각졌는가 ──────────────────────────────────────────────
  // 줄마다 **뭍에서 물로 넘어가는 첫 자리**를 찾아 x 를 적고, 이웃 세 줄의
  // 2차 차분 |x(y+1) − 2x(y) + x(y−1)| 을 평균 냅니다. 매끄럽게 휘는 경계는
  // 이 값이 작고, 화소 모서리를 따라가는 계단은 큽니다 — 실기에서 "상자
  // 모양으로 각진다"고 한 것이 곧 이 값입니다.
  // ⚠ **예전 자는 너무 얇았습니다.** 줄마다 "뭍에서 물로 넘어가는 **첫**
  //   자리" 하나만 적었더니 384줄 중 **29~37줄**만 쓰였습니다. 그 표본으로는
  //   1.4 와 2.5 를 못 가릅니다 — 실제로 격자를 촘촘히 할수록 값이 오르락
  //   내리락 해서 결론을 못 냈습니다.
  //
  //   이제 **모든 경계**를 적습니다. 뭍↔물이 바뀌는 자리를 방향 가리지 않고
  //   전부 모으고, 이웃 줄에서 8화소 안에 있는 것끼리 짝지어 2차 차분을
  //   냅니다. 만이 여럿이어도 각자 제 갈래로 이어집니다.
  const isLand=v=>v===1, isWet=v=>v===2||v===3;
  const rowsX=[];
  for(let y=0;y<H;y++){
    const xs=[];
    for(let x=1;x<W;x++){
      const a=cls[y*W+x-1], b=cls[y*W+x];
      if((isLand(a)&&isWet(b))||(isWet(a)&&isLand(b))) xs.push(x);
    }
    rowsX.push(xs);
  }
  const nearest=(arr,v)=>{ let best=-1,bd=1e9;
    for(const x of arr){ const d=Math.abs(x-v); if(d<bd){bd=d;best=x;} }
    return bd<=8?best:-1; };
  let jag=0, jn=0;
  for(let y=1;y<H-1;y++){
    for(const x of rowsX[y]){
      const xm=nearest(rowsX[y-1],x), xp=nearest(rowsX[y+1],x);
      if(xm<0||xp<0) continue;
      jag+=Math.abs(xp-2*x+xm); jn++;
    }
  }

  return { 지면화소:뭍+포말+물, 뭍, 포말, 물,
           경계각짐:+(jag/Math.max(1,jn)).toFixed(3), 경계줄:jn,
           포말비율:+(100*포말/Math.max(1,뭍+포말+물)).toFixed(2),
           줄당뒤집힘:+(flips/Math.max(1,rows)).toFixed(2), 최악줄:worst, 줄수:rows };
}

sea.material.uniforms.uShoreLegacy.value=1;
const 옛규칙=measure('옛 규칙 (정확히 0 = 깊은 바다 · 포말은 수심만)');
sea.material.uniforms.uShoreLegacy.value=0;
const 지금=measure('지금 (물가 근처만 얕음 · 포말은 바닥 기울기)');
const 결과={ 옛규칙, 지금 };
document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'shorepatch.html'), html);
console.log('생성 완료: shorepatch.html');
