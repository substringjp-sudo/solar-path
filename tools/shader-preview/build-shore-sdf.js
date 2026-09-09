/**
 * **물가를 부호거리장으로 다시 세우면 경계가 덜 각지는가** — 순수 자료 A/B.
 *
 * 사용자 물음: "등고선 데이터를 기반으로 만들면 특히 수면과 이어지는 부분이
 * 이쁘게 그려지지 않을까?"
 *
 * ## 무엇을 견주나
 *
 * **렌더러는 한 줄도 안 건드립니다.** 같은 셰이더·같은 카메라·같은 자로,
 * DEM 타일만 바꿔 두 번 잽니다:
 *
 *   원본     `dem/`      Terrarium 원본 (먼바다가 정확히 0 인 고원 41.38%)
 *   거리장   `dem-sdf/`  물가를 부호거리장으로 다시 세운 것 (bake-shore-sdf.js)
 *
 * 나아진다면 원인은 **자료 구조**입니다 — 렌더링으로 더 짜낼 것이 아니라.
 *
 * ⚠ 자는 `build-shorepatch.js` 의 것을 그대로 씁니다 (같은 자리·같은 카메라·
 * 같은 갈래 나누기·같은 2차 차분). 그래야 거기서 못 박은 값과 곧바로 견줄
 * 수 있습니다 — 첫 칸 '앱 그대로' 가 **1.634** 로 그것과 같아야 두 자가 같은
 * 것을 재고 있다고 말할 수 있습니다. 자를 새로 만들면 견줌이 거짓말을 합니다.
 *
 * ⚠ 대조가 필요합니다: 경계 각짐만 보면 **"물을 다 지우기"** 가 만점을
 * 받습니다. 그래서 뭍·물·포말 화소 수도 함께 보고, 해안선이 통째로
 * 옮겨가지 않았는지 확인합니다.
 *
 * 사용: node tools/shader-preview/bake-shore-sdf.js
 *       node tools/shader-preview/build-shore-sdf.js
 *       node tools/shader-preview/verify-shore-sdf.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

/** 대부도 서안 — 갯벌이 넓게 드러나는 자리. 타일은 이미 받아 두었습니다. */
const LAT = 37.24102, LON = 126.55969, MASK_DIR = 'wide-daebu';
/**
 * 견줄 경우들 — [이름, 근거리 자료, 고리, 살].
 *
 * ⚠ **자료만 바꿔 보는 것으로는 모자랍니다.** 물가에서 격자가 자료보다
 * 성길 수 있고, 그러면 계단은 자료가 아니라 격자가 만든 것입니다. 살 간격은
 * 2πd/256 이라 500m 에서 12.3m(자료 15.2m 보다 촘촘), 2km 에서 49m(3.2배
 * 성김), 3km 에서 74m(4.8배 성김) — 거리에 따라 병목이 바뀝니다.
 *
 * 그래서 **같은 자료로 격자만 늘린 대조**를 반드시 함께 잽니다. 그것이
 * 안 줄면 자료 탓이고, 줄면 자료를 바꾸기 전에 격자부터입니다.
 */
// ⚠ 첫 칸이 **앱 그대로**입니다. 해수면 격자의 기본값은 96 고리라, 아래
//   밀도 훑기처럼 지형과 같은 값을 넣으면 앱이 아닌 설정을 재게 됩니다.
//   이 칸이 `verify-shorepatch` 의 값과 같아야 두 자가 서로를 확인합니다.
const CASES = [
  ['앱 그대로', 'dem', 152, 256, 'app'],
  ['원본 기본', 'dem', 152, 256],
  // ⚠ **겹침 0 대조.** 해수면 한쪽 겹침(uShoreOverlapM)이 들어간 뒤로 위 두
  //   칸이 **같은 값**을 냅니다 — 해수면 격자 밀도가 경계에 영향을 안 줍니다.
  //   그게 겹침 때문이라는 것을 논증이 아니라 측정으로 보이려고, 같은 두 칸을
  //   겹침만 0 으로 두고 한 번 더 잽니다. 거기서는 밀도 의존이 돌아와야 합니다.
  ['겹침0 앱', 'dem', 152, 256, 'app0'],
  ['겹침0 기본', 'dem', 152, 256, 'plain0'],
  ['원본 살2배', 'dem', 152, 512],
  ['원본 살4배', 'dem', 152, 1024],
  ['원본 고리살2배', 'dem', 304, 512],
  ['거리장 기본', 'dem-sdf', 152, 256],
  ['거리장 살4배', 'dem-sdf', 152, 1024],
  // 대조 — 같은 띠·같은 σ 로 **고도장을** 흐린 것. "거리장은 고도 흐리기와
  // 다른 물건" 이 논증이 아니라 측정이 되게 합니다.
  ['고도흐림 기본', 'dem-blur', 152, 256],
];
const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>물가를 거리장으로 다시 세우면 경계가 덜 각지는가 (대부도 · 자료만 A/B)</h3>
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

const LAT=${LAT}, LON=${LON}, MASK_DIR='${MASK_DIR}';
const CASES=${JSON.stringify(CASES)};
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

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000); cam.position.set(0,0,0);
const pr=PITCH*Math.PI/180, ar=LOOK_AZ*Math.PI/180;
cam.up.set(0,1,0);
cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr));
cam.updateMatrixWorld(true);
const sky={r:0.83,g:1.03,b:1.27};

// 먼 패치(수역 마스크)는 **둘이 같은 것을 씁니다** — 근거리 자료만 바꿔야
// 차이가 자료 구조에서 온 것임이 분명해집니다.
const maskPatch=await loadDemPatch(LAT, LON, MASK_R, {renderer, loadTexture, block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${MASK_DIR}/\${z}_\${x}_\${y}.png\`});
if(!maskPatch) errors.push('먼 패치 없음');

let ground=null, field=null, sea=null;
async function build(nearDir, rings, spokes, mode){
  clearDemCache();
  const patch=await loadDemPatch(LAT, LON, FAR, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${nearDir}/\${z}_\${x}_\${y}.png\`});
  if(!patch){ errors.push(nearDir+' 패치 없음'); return; }
  ground=createGroundPlane(); setGroundHorizon(ground, 1.2); scene.add(ground);
  field=createTerrainField({patch, eyePatch:patch, eyeHeightM:EYE_TOWER_M, rings, spokes});
  field.mesh.renderOrder=-0.48; scene.add(field.mesh); updateTerrainFieldEye(field, cam);
  // 해수면도 같은 밀도로 — 경계는 두 면의 교선이라 한쪽만 늘리면 못 읽습니다.
  // 다만 'app' 칸에서는 해수면을 **기본값 그대로**(96 고리) 둡니다.
  const 앱해수면 = mode==='app' || mode==='app0';
  sea = 앱해수면
    ? createSeaPlane({patch, maskPatch, eyeHeightM:EYE_TOWER_M})
    : createSeaPlane({patch, maskPatch, eyeHeightM:EYE_TOWER_M, rings, spokes});
  sea.mesh.renderOrder=-0.47; scene.add(sea.mesh); updateSeaPlaneEye(sea, cam);
  updateGroundColors(ground, 30, 0, {skyMean:sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
  for (const m of [field.material, sea.material]) {
    m.uniforms.uSurfaceIrr.value.set(sky.r, sky.g, sky.b);
    m.uniforms.uSunRadiance.value.set(0.78, 0.66, 0.52);
    m.uniforms.uSunAltDeg.value=30; m.uniforms.uSunAltRad.value=30*Math.PI/180;
    m.uniforms.uSunAzRad.value=200*Math.PI/180;
    m.uniforms.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85);
    m.uniforms.uAerial.value=0;   // 거리로 색이 변하면 갈래 나누기가 흐려집니다
  }
  sea.material.uniforms.uShoreLegacy.value=0;   // 지금 규칙 하나만 봅니다
  if(mode==='app0'||mode==='plain0'){
    // 겹침을 끕니다 — 지형과 해수면이 각자 0 등고선을 계산해 딱 맞닿던 옛 상태.
    sea.material.uniforms.uShoreOverlapM.value=0;
    field.material.uniforms.uShoreOverlapM.value=0;
  }
}
function teardown(){
  if(ground) scene.remove(ground);
  if(field){ scene.remove(field.mesh); field.dispose?.(); }
  if(sea){ scene.remove(sea.mesh); sea.dispose?.(); }
  ground=field=sea=null;
}

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

const 결과={};
for (const [key, dir, rings, spokes, mode] of CASES) {
  await build(dir, rings, spokes, mode);
  결과[key]=measure(key+' ('+rings+'×'+spokes+')');
  결과[key].고리=rings; 결과[key].살=spokes;
  teardown();
}
document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'shore-sdf.html'), html);
console.log('생성 완료: shore-sdf.html');
