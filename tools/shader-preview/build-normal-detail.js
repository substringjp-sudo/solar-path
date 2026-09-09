/**
 * **법선을 B-스플라인으로 다시 내고(①), 자료 아래 결을 얹으면(②) 무엇이 변하나.**
 *
 * 사용자 요청: "1번에 법선에만 더하고 2번을 추가하는 걸로."
 *
 * ## 왜 둘을 갈라 재야 하나
 *
 * 둘 다 켜고 재면 음영의 퍼짐 σ 가 크게 오릅니다. 그런데 σ 는 **잡음을 얹어도**
 * 오릅니다 — 갈라 재지 않으면 "입체감이 늘었다" 와 "지직거린다" 를 구분할 수
 * 없습니다. 그래서 세 가지를 나란히 놓습니다:
 *
 *   옛 방식   정점 법선 보간 (이중선형 · 유한차분 ε = max(8, d·0.03))
 *   ①        프래그먼트에서 3차 B-스플라인 해석 기울기
 *   ①+②     거기에 자료 아래 규모의 결
 *
 * ## 자
 *
 * - **꺾임**: 밝기의 2차 차분. 텍셀 경계에서 법선이 튀면 커집니다. ① 이 줄여야 합니다.
 * - **결**: 이웃 화소 밝기 차. ② 가 늘려야 합니다.
 * - **실루엣**: 알파 마스크. 셋이 **한 화소도 달라선 안 됩니다** — 높이를 안
 *   건드렸다는 증거입니다. 이게 깨지면 나머지 수치는 볼 것도 없습니다.
 * - **거리에 따른 결**: 먼 곳일수록 잔 옥타브가 꺼져 결이 옅어져야 합니다.
 * - **평평한 땅**: DEM 이 없으면 기울기가 0 이라 ② 의 진폭도 0 이어야 합니다.
 *   결이 그 자리에 생기면 그건 자료가 아니라 잡음을 그린 것입니다.
 *
 * 사용: node tools/shader-preview/build-normal-detail.js
 *       node tools/shader-preview/verify-normal-detail.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const LIGHT = require('./app-lighting').appLighting(25, 135);

/** 마니산 정상 — 3km 안에 455m 기복. */
const LAT = 37.61553, LON = 126.4300, DIR = 'dem-mani';
const BLOCK = 3, FIELD_FAR_M = 3000, EYE_M = 1.6;
const LOOK_AZ = 45, SUN_AZ = 135, SUN_ALT = 25;
/** [이름, 세배 법선, 결 세기] */
const CASES = [
  ['옛 방식', 0, 0.0],
  ['① B-스플라인', 1, 0.0],
  // ② 의 세기 훑기. 결은 **자료 아래 규모의 질감**이지 다른 면이 아니므로,
  // 평균 밝기를 크게 옮기면 그건 결이 아니라 표면을 바꾼 것입니다.
  // (법선을 세게 흔들면 ndl 이 0 에서 잘려 화면이 통째로 어두워집니다.)
  ['①+② 0.10 (기본)', 1, 0.10],
  ['①+② 0.20', 1, 0.20],
  ['①+② 0.35', 1, 0.35],
  ['①+② 0.60', 1, 0.60],
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>법선을 다시 내고(①) 자료 아래 결을 얹으면(②)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, EYE=${EYE_M};
const CASES=${JSON.stringify(CASES)};
const IRR=${JSON.stringify(LIGHT.surfaceIrr)}, SUNR=${JSON.stringify(LIGHT.sunRadiance)};
const EXPO=${LIGHT.exposure}, SUN_AZ=${SUN_AZ}, SUN_ALT=${SUN_ALT}, LOOK_AZ=${LOOK_AZ};

const W=384,H=384,FOV=55,PITCH=-20;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true});
r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
const buf=new Uint8Array(W*H*4);
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});

clearDemCache();
const patch=await loadDemPatch(LAT,LON,FAR,{renderer:r,loadTexture,block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${DIR}/\${z}_\${x}_\${y}.png\`});
if(!patch) errors.push('패치 없음');

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(FOV,1,0.1,2000); cam.position.set(0,0,0);
const pr=PITCH*Math.PI/180, ar=LOOK_AZ*Math.PI/180;
cam.up.set(0,1,0);
cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr));
cam.updateMatrixWorld(true);

function setup(f){
  const u=f.material.uniforms;
  u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
  u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
  u.uExposure.value=EXPO; u.uAerial.value=0; u.uShadow.value=0;   // 그림자는 결과 섞이므로 끕니다
  u.uSunAltDeg.value=SUN_ALT; u.uSunAltRad.value=SUN_ALT*Math.PI/180;
  u.uSunAzRad.value=SUN_AZ*Math.PI/180;
}

/** 밝기판과 알파(실루엣)를 함께 돌려줍니다. */
function shoot(f, label){
  r.setRenderTarget(rt); r.clear(); r.render(scene,cam);
  r.readRenderTargetPixels(rt,0,0,W,H,buf); r.setRenderTarget(null);
  r.render(scene,cam);
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  c.style.width='230px'; c.style.height='230px';
  c.getContext('2d').drawImage(canvas,0,0);
  const d=document.createElement('div'); d.style.font='10px monospace'; d.textContent=label;
  document.getElementById('shots').appendChild(d);
  document.getElementById('shots').appendChild(c);
  const lum=new Float32Array(W*H), a=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){ a[i]=buf[i*4+3]>128?1:0;
    lum[i]=0.2126*buf[i*4]+0.7152*buf[i*4+1]+0.0722*buf[i*4+2]; }
  return {lum,a};
}

/** 꺾임(2차 차분) · 결(1차 차분) · 퍼짐(σ). 가로줄로만 재 화면 세로 기울기와 안 섞습니다. */
function stats(p){
  let d1=0,d2=0,n1=0,n2=0,s=0,m=0,nn=0;
  for(let i=0;i<W*H;i++) if(p.a[i]){ m+=p.lum[i]; nn++; }
  m/=Math.max(1,nn);
  for(let i=0;i<W*H;i++) if(p.a[i]){ s+=(p.lum[i]-m)**2; }
  for(let y=0;y<H;y++) for(let x=1;x<W-1;x++){
    const i=y*W+x;
    if(!p.a[i]||!p.a[i-1]||!p.a[i+1]) continue;
    d1+=Math.abs(p.lum[i]-p.lum[i-1]); n1++;
    d2+=Math.abs(p.lum[i+1]-2*p.lum[i]+p.lum[i-1]); n2++;
  }
  return { 지면화소:nn, 평균:+m.toFixed(2), 퍼짐:+Math.sqrt(s/Math.max(1,nn)).toFixed(3),
           결:+(d1/Math.max(1,n1)).toFixed(4), 꺾임:+(d2/Math.max(1,n2)).toFixed(4) };
}

/** 화면 위/아래 절반 = 먼 곳/가까운 곳. 결이 거리에 따라 옅어지는지 봅니다. */
function byBand(p){
  const out=[];
  for(const [k,y0,y1] of [['먼쪽',0,H>>1],['가까운쪽',H>>1,H]]){
    let d1=0,n=0;
    for(let y=y0;y<y1;y++) for(let x=1;x<W;x++){
      const i=y*W+x; if(!p.a[i]||!p.a[i-1]) continue;
      d1+=Math.abs(p.lum[i]-p.lum[i-1]); n++; }
    out.push([k,+(d1/Math.max(1,n)).toFixed(4)]);
  }
  return Object.fromEntries(out);
}

const 결과={}; const masks={};
for (const [key, bic, det] of CASES) {
  const f=createTerrainField({patch, eyePatch:patch, eyeHeightM:EYE});
  scene.add(f.mesh); updateTerrainFieldEye(f, cam); setup(f);
  f.material.uniforms.uBicubicNormal.value=bic;
  f.material.uniforms.uDetail.value=det;
  const p=shoot(f, key);
  결과[key]=stats(p); 결과[key].띠=byBand(p);
  masks[key]=p.a;
  scene.remove(f.mesh); f.dispose?.();
}

// 실루엣이 셋 다 같은가 — 높이를 안 건드렸다는 증거
const base=masks[CASES[0][0]];
for (const [key] of CASES) {
  let diff=0; const m=masks[key];
  for(let i=0;i<W*H;i++) if(m[i]!==base[i]) diff++;
  결과[key].실루엣차이=diff;
}

// 대조: DEM 없이 평평한 땅에서는 ② 가 아무것도 만들면 안 됩니다.
{
  const flat=createTerrainField({patch:null, observerElevM:0, eyeHeightM:EYE});
  scene.add(flat.mesh); updateTerrainFieldEye(flat, cam); setup(flat);
  flat.material.uniforms.uBicubicNormal.value=1;
  flat.material.uniforms.uDetail.value=0.6;
  결과['평판 · ①+②']=stats(shoot(flat,'평판 (DEM 없음) · ①+②'));
  scene.remove(flat.mesh); flat.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError:r.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+r.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'normal-detail.html'), html);
console.log('생성 완료: normal-detail.html');
