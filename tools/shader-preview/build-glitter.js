/**
 * **윤슬이 물처럼 좁은가** (사용자가 실기에서 잡아낸 둘째 결함).
 *
 * "물도 하나같이 파도 진폭이 어마어마하게 큰지 윤슬의 폭이 너무 넓어서
 * 물같이 느껴지지 않아." — 맞는 지적입니다. 새 `SeaPlane` 에는 **윤슬 항이
 * 아예 없습니다.** 태양 쪽이 밝은 것은 프레넬 × 하늘 복사휘도 뿐이고,
 * 거기에 `max(1.0, mirrorElevDeg)` 가 걸려 있어 수평선 쪽 물이 **전부 같은
 * 1° 하늘**을 봅니다. 그러면 태양 둘레가 통째로 뭉근하게 밝아질 뿐,
 * 진짜 바다의 좁고 반짝이는 길이 안 생깁니다.
 *
 * ## 재는 것 — 태양 쪽 밝은 길의 **가로 폭**
 *
 * 바다만 놓고(DEM 없이) 태양 방위를 봅니다. 화소마다 카메라 기하로 **진짜
 * 방위각과 내려본각**을 계산해(셰이더가 아니라 여기서), 내려본각 띠마다
 * 방위 방향 밝기 곡선을 만듭니다. 그 곡선의 **반높이 폭(FWHM)** 이 윤슬
 * 폭입니다.
 *
 *     바탕 = 그 띠의 중앙값 · 봉우리 = 최댓값
 *     폭   = 밝기 ≥ 바탕 + (봉우리−바탕)/2 인 방위 구간의 길이
 *
 * ## 그리고 더 날카로운 자 — **물이 제가 비추는 하늘보다 밝은가**
 *
 * 폭만 재면 톤 곡선 꼭대기에서 길을 잃습니다(실제로 잃었습니다 — 봉우리도
 * 바탕도 220~255 라 어떤 항을 더해도 폭이 안 움직였습니다). 그래서 물리로
 * 못을 박습니다: **거울은 제가 비추는 것보다 밝을 수 없습니다.** 프레넬
 * 반사율은 1 이하이고, 내려본각 θ 의 잔잔한 수면은 고도각 θ 의 하늘을
 * 비춥니다. 그러니 같은 화면에서
 *
 *     수면(−θ) 밝기  ≤  하늘(+θ) 밝기
 *
 * 여야 합니다. 하늘돔을 같이 넣고 지평선 위아래를 짝지어 재면, 톤 곡선이
 * 어디에 있든 상관없이 이 부등식은 성립해야 합니다.
 *
 * ## 대조 — 이 자가 진짜 윤슬을 재는지
 *
 * ① **풍속 응답**: Cox-Munk 는 경사 분산이 `σ² = 0.003 + 0.00512·U` 이므로
 *    폭이 풍속과 함께 **커져야** 합니다. 안 커지면 그 항이 폭을 정하는 게
 *    아니라는 뜻입니다(예전에 `TerrainRing` 에서 고정 로브 둘이 물리항을
 *    덮어 2→8m/s 에 폭이 29.8° 로 꿈쩍 않던 적이 있습니다).
 * ② **윤슬을 끈 채로**: `uGlitter=0` 이면 폭이 풍속에 **반응하면 안 됩니다.**
 *    이게 없으면 "하늘 되비침이 우연히 넓어졌다"를 윤슬로 읽습니다.
 * ③ **봉우리 대비**: 폭만 보면 "윤슬을 지우기" 가 만점입니다. 태양 쪽
 *    봉우리가 바탕보다 뚜렷이 밝아야 합니다.
 *
 * 사용: node tools/shader-preview/build-glitter.js
 *       node tools/shader-preview/shoot.js glitter.html glitter.png 20000
 *       node tools/shader-preview/verify-glitter.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const OBS_ELEV_M = 50, EYE_M = 1.6;
const SUN_ALT_DEG = 6;      // 노을 근처 — 윤슬이 가장 길게 눕는 때
const SUN_AZ_DEG = 180;     // 남쪽. 카메라도 같은 쪽을 봅니다.
const W = 768, H = 128;
const FOV_Y_DEG = 26;       // 가로 화각 ≈ 108° (종횡비 6)
const PITCH_DEG = -3;
/** 풍속 (m/s). Cox-Munk σ² = 0.003 + 0.00512·U */
const WINDS = [1, 4, 8];
/**
 * 내려본각 띠 (도) — 수평선 가까이부터 발치까지.
 *
 * ⚠ 0.3° 는 뺐습니다. 그 자리는 태양 쪽 하늘 되비침이 톤 곡선 천장에
 * 붙어 있어 윤슬을 켜나 끄나 화소값이 같습니다(차이 0). 잴 수 없는 자리를
 * 넣어 두면 "폭 108°" 같은 뜻 없는 수가 나옵니다.
 */
const BANDS = [0.6, 1.2, 2.4, 5.0];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:820px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:3px;image-rendering:pixelated}
 p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>윤슬 폭 — 태양 쪽 밝은 길의 반높이 폭</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const W=${W}, H=${H}, FOVY=${FOV_Y_DEG}, PITCH=${PITCH_DEG};
const SUN_ALT=${SUN_ALT_DEG}, SUN_AZ=${SUN_AZ_DEG};
const OBS=${OBS_ELEV_M}, EYE=${EYE_M};
const WINDS=${JSON.stringify(WINDS)}, BANDS=${JSON.stringify(BANDS)};

const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);

// DEM 없이 — 평평한 바다 하나만 남깁니다 (판정이 재구성이 되도록).
const sea=createSeaPlane({patch:null, maskPatch:null, observerElevM:OBS, eyeHeightM:EYE});
const scene=new THREE.Scene(); scene.add(sea.mesh);
// 하늘돔도 같이 — 물이 제가 비추는 하늘보다 밝은지 **같은 화면에서** 봅니다.
const atmosphere={betaMie:0.08, angstrom:1.3, elevScale:1.0, ozoneDU:330};
const skydome=createSkydome(); scene.add(skydome.mesh);
updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
const cam=new THREE.PerspectiveCamera(FOVY, W/H, 0.1, 200000);
cam.position.set(0,0,0);
updateSeaPlaneEye(sea, cam);

const sky={r:0.42,g:0.40,b:0.46};
const u=sea.material.uniforms;
u.uSurfaceIrr.value.set(sky.r, sky.g, sky.b);
u.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85);
u.uSunAltDeg.value=SUN_ALT;
u.uSunAltRad.value=SUN_ALT*Math.PI/180;
u.uSunAzRad.value=SUN_AZ*Math.PI/180;
u.uSunRadiance.value.set(3.2, 2.2, 1.3);
u.uAerial.value=0;      // 공기원근은 폭을 재는 데 방해만 됩니다.
u.uFresnel.value=1;

// 카메라를 태양 방위로. 화소마다 **진짜** 방위·내려본각을 여기서 계산합니다.
const az=SUN_AZ*Math.PI/180, p=PITCH*Math.PI/180;
cam.up.set(0,1,0);
cam.lookAt(Math.sin(az)*Math.cos(p), Math.sin(p), -Math.cos(az)*Math.cos(p));
cam.updateMatrixWorld(true);

const tanY=Math.tan(FOVY*Math.PI/360), aspect=W/H;
const dirs=[];  // 화소별 {방위차(도), 내려본각(도)}
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  const nx=(2*(x+0.5)/W-1)*tanY*aspect;
  const ny=(2*(y+0.5)/H-1)*tanY;
  const v=new THREE.Vector3(nx, ny, -1).normalize().applyQuaternion(cam.quaternion);
  const dep=-Math.asin(Math.max(-1,Math.min(1,v.y)))*180/Math.PI;
  let a=Math.atan2(v.x, -v.z)*180/Math.PI - SUN_AZ;
  while (a>180) a-=360; while (a<-180) a+=360;
  dirs.push({a, dep});
}

function render(label){
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
  renderer.render(scene,cam);
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  c.style.width='384px'; c.style.height='64px';
  c.getContext('2d').drawImage(canvas,0,0);
  const t=document.createElement('div'); t.style.font='10px monospace'; t.textContent=label;
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
  // ⚠ 위아래를 맞춰 둡니다. readRenderTargetPixels 는 **아래에서 위로**
  // 주고, 위 dirs 도 y=0 을 ny=−tanY(화면 **아래**)로 만들었으니 둘이 이미
  // 같은 방향입니다. 여기서 한 번 더 뒤집었다가 5° 띠가 하늘(빈 화소)을
  // 읽어 바탕이 0 으로 나왔습니다.
  const out=new Float32Array(W*H);
  for (let i=0;i<W*H;i++) out[i]=0.2126*buf[i*4]+0.7152*buf[i*4+1]+0.0722*buf[i*4+2];
  return out;
}

/** 방위로 묶어 중앙값 곡선을 만듭니다 (칸 폭 0.5°). */
function azCurve(vals, lo, hi, sign){
  const m={};
  for (let i=0;i<W*H;i++){
    const d=dirs[i]; const dep=sign*d.dep;
    if (dep<lo || dep>hi) continue;
    const k=Math.round(d.a*2)/2;
    (m[k]=m[k]||[]).push(vals[i]);
  }
  const ks=Object.keys(m).map(Number).sort((a,b)=>a-b);
  return ks.map(k=>{ const v=m[k].sort((a,b)=>a-b);
    return {a:k, l:v[Math.floor(v.length/2)]}; });
}

/** 곡선의 반높이 폭 (도). 바탕은 중앙값. */
function fwhm(curve){
  if (curve.length<3) return null;
  const ls=curve.map(q=>q.l).slice().sort((a,b)=>a-b);
  const base=ls[Math.floor(ls.length*0.5)], peak=ls[ls.length-1];
  const half=base+(peak-base)*0.5;
  let w=0;
  for (let i=1;i<curve.length;i++)
    if (curve[i].l>=half && curve[i-1].l>=half) w+=Math.abs(curve[i].a-curve[i-1].a);
  return {폭:+w.toFixed(2), 봉우리:+peak.toFixed(2), 바탕:+base.toFixed(2)};
}

const 결과={};
for (const wind of WINDS){
  if (u.uSlopeVar) u.uSlopeVar.value = 0.003 + 0.00512*wind;
  if (u.uGlitter) u.uGlitter.value = 1;
  const on = render('U='+wind+' 윤슬켬');
  if (u.uGlitter) u.uGlitter.value = 0;
  const off = render('U='+wind+' 윤슬끔');
  // 윤슬만 남깁니다 — 넓은 하늘 되비침이 톤 곡선 꼭대기를 채우고 있어서,
  // 화면을 통째로 재면 어떤 항을 더해도 폭이 안 움직입니다(재 봤습니다).
  const diff=new Float32Array(W*H);
  for (let i=0;i<W*H;i++) diff[i]=Math.max(0, on[i]-off[i]);

  const bands={};
  for (const band of BANDS){
    const lo=band*0.8, hi=band*1.25;
    const g=fwhm(azCurve(diff, lo, hi, 1));
    const water=azCurve(off, lo, hi, 1);      // 윤슬을 끈 **순수 거울**
    const sky=azCurve(off, lo, hi, -1);       // 같은 각의 하늘
    const skyMap={}; sky.forEach(q=>{skyMap[q.a]=q.l;});
    let worst=0, worstAz=null, pairs=0;
    for (const q of water){ if (!(q.a in skyMap)) continue; pairs++;
      const r=(q.l+1)/(skyMap[q.a]+1); if (r>worst){worst=r; worstAz=q.a;} }
    bands[band]={ 윤슬: g, 물하늘비:+worst.toFixed(3), 물하늘비방위:worstAz, 짝:pairs };
  }
  결과['U'+wind]=bands;
}
if (u.uGlitter) u.uGlitter.value = 1;

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(),
  유니폼있음: { uSlopeVar: !!u.uSlopeVar, uGlitter: !!u.uGlitter }, 바람: WINDS, 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'glitter.html'), html);
console.log('생성 완료: glitter.html');
