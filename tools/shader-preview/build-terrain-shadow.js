/**
 * **산이 제 뒤 땅에 그림자를 드리우는가** (실기 보고).
 *
 * "땅에는 태양에 의한 물리적 그림자가 생기지 않아. 산에 의해 산 뒤쪽 땅에
 * 그림자같은게 안생겨." — 맞습니다. 지금까지 지면 조명은 램버트 `ndl`
 * 하나였습니다. 그건 **제 사면이 해를 등졌는가**만 답합니다. 산이 그 뒤
 * 땅을 가리는지는 전혀 다른 질문이고, 아무도 묻지 않고 있었습니다.
 *
 * ## 재는 법 — 그림자를 켜고 끈 두 장의 차이
 *
 * `uShadow` 로 드리운 그림자만 껐다 켤 수 있게 해 두고, 같은 장면을 두 번
 * 찍어 **어두워진 화소**를 셉니다. 색으로 "그늘 같다"를 추측하지 않고
 * 그 항이 실제로 한 일만 봅니다.
 *
 * ## 대조 넷 — 이게 진짜 지형 그림자인지
 *
 * ① **해를 머리 위로 올리면 사라져야 합니다.** 해가 높을수록 가리는 것이
 *    없습니다. 고도 5° → 80° 로 올리며 그늘 면적이 **단조 감소**해야 합니다.
 * ② **해 방위를 180° 돌리면 자리가 바뀌어야 합니다.** 두 그늘 집합의
 *    겹침(IoU)이 작아야 합니다. 이게 없으면 "어디든 어두워지는" 결함이
 *    그림자로 통과합니다.
 * ③ **평평한 땅에는 안 생겨야 합니다.** DEM 없이(`patch:null`) 그리면
 *    지면이 고도 0 인 평판입니다. 거기 그늘이 지면 지형이 아니라 다른
 *    무언가가 원인입니다.
 * ④ **하늘 몫은 남아야 합니다.** 그늘이 새까매지면(0) 직달만이 아니라
 *    조도를 통째로 깎은 것입니다. 그늘 화소의 밝기가 0 보다 뚜렷이 커야
 *    합니다.
 *
 * 사용: node tools/shader-preview/build-terrain-shadow.js
 *       node tools/shader-preview/verify-terrain-shadow.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { makeCpuDem, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin } = require('./dem-cpu');

/** 마니산 정상 — 3km 안에 455m 의 진짜 기복이 있습니다. */
const LAT = 37.61553, LON = 126.4300, DIR = 'dem-mani';
const BLOCK = 3, FIELD_FAR_M = 3000, EYE_M = 1.6;
/** 해 고도 훑기 (도). 낮을수록 그늘이 길어야 합니다. */
const SUN_ALTS = [5, 15, 40, 80];
const SUN_AZ = 135;

const get = (url) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode}`)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

(async () => {
  const zoom = demZoomForRadius(FIELD_FAR_M, LAT, BLOCK);
  const t = lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);
  const demDir = path.join(PREVIEW, DIR);
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, await get(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
  }
  const dem = makeCpuDem({ demDir, zoom, lat: LAT, lon: LON });
  const obs = dem.elevAtGround(0, 0);
  console.log(`줌 ${zoom} · 발밑 ${obs.toFixed(1)}m`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:3px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>산이 제 뒤 땅에 그림자를 드리우는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, EYE=${EYE_M};
const SUN_ALTS=${JSON.stringify(SUN_ALTS)}, SUN_AZ=${SUN_AZ};

const W=384, H=384, FOV=70, PITCH=-22;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

clearDemCache();
const patch=await loadDemPatch(LAT, LON, FAR, {renderer, loadTexture, block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${DIR}/\${z}_\${x}_\${y}.png\`});
if(!patch) errors.push('패치 없음');

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000);
cam.position.set(0,0,0);

function makeField(p){
  const f=createTerrainField({patch:p, eyeHeightM:EYE});
  scene.add(f.mesh); updateTerrainFieldEye(f, cam);
  const u=f.material.uniforms;
  // ⚠ 이 값은 **앱이 실제로 쓰는 것보다 직달이 훨씬 셉니다**(비 24:1).
  //   앱의 대기 모형은 해 25° 에서 하늘 1.03 · 직달 0.66 — 비가 0.27:1 로
  //   거꾸로입니다. 그림자는 **직달만** 깎으므로, 직달이 전체 빛의 21%
  //   뿐이면 그늘이 아무리 짙어도 화면은 그만큼밖에 안 어두워집니다.
  //   아래 조도대조 가 그 차이를 잽니다.
  u.uSurfaceIrr.value.set(0.10, 0.11, 0.14);   // 하늘 몫 (그늘도 이건 받습니다)
  u.uSunRadiance.value.set(2.4, 2.1, 1.7);
  u.uAerial.value=0;                            // 공기원근은 면적 측정에 방해
  u.uSunAzRad.value=SUN_AZ*Math.PI/180;
  return f;
}

function look(azDeg){
  const a=azDeg*Math.PI/180, p=PITCH*Math.PI/180;
  cam.up.set(0,1,0);
  cam.lookAt(Math.sin(a)*Math.cos(p), Math.sin(p), -Math.cos(a)*Math.cos(p));
  cam.updateMatrixWorld(true);
}

function grab(label){
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
  renderer.render(scene,cam);
  if (label){ const c=document.createElement('canvas'); c.width=W; c.height=H;
    c.style.width='192px'; c.style.height='192px';
    c.getContext('2d').drawImage(canvas,0,0);
    const d=document.createElement('div'); d.style.font='10px monospace'; d.textContent=label;
    document.getElementById('shots').appendChild(d);
    document.getElementById('shots').appendChild(c); }
  const lum=new Float32Array(W*H), alpha=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){ lum[i]=0.2126*buf[i*4]+0.7152*buf[i*4+1]+0.0722*buf[i*4+2];
    alpha[i]=buf[i*4+3]; }
  return {lum, alpha};
}

/** 그림자를 켜고 끈 차이 → 어두워진 화소 집합. */
function shadowSet(f, sunAltDeg, sunAzDeg, label){
  const u=f.material.uniforms;
  u.uSunAltDeg.value=sunAltDeg; u.uSunAltRad.value=sunAltDeg*Math.PI/180;
  u.uSunAzRad.value=sunAzDeg*Math.PI/180;
  u.uShadow.value=1; const on=grab(label);
  u.uShadow.value=0; const off=grab(null);
  u.uShadow.value=1;
  const mask=new Uint8Array(W*H);
  let n=0, ground=0, shadeLumSum=0, litLumSum=0, lit=0;
  for(let i=0;i<W*H;i++){
    if(off.alpha[i]<128) continue;
    ground++;
    if(off.lum[i]-on.lum[i] > 3){ mask[i]=1; n++; shadeLumSum+=on.lum[i]; }
    else { lit++; litLumSum+=on.lum[i]; }
  }
  return {mask, 그늘화소:n, 지면화소:ground,
    그늘비율:+(ground?100*n/ground:0).toFixed(2),
    그늘평균밝기:+(n?shadeLumSum/n:0).toFixed(1),
    양지평균밝기:+(lit?litLumSum/lit:0).toFixed(1)};
}

const iou=(a,b)=>{ let inter=0, uni=0;
  for(let i=0;i<a.length;i++){ if(a[i]&&b[i])inter++; if(a[i]||b[i])uni++; }
  return uni? inter/uni : 0; };

const 결과={};
if (patch) {
  const f=makeField(patch);
  look(SUN_AZ);   // 해 쪽을 봅니다 — 그늘이 이쪽으로 뻗어옵니다

  결과.고도훑기 = SUN_ALTS.map(alt => {
    const s=shadowSet(f, alt, SUN_AZ, '해 '+alt+'° · 방위 '+SUN_AZ+'°');
    return {고도:alt, 그늘비율:s.그늘비율, 그늘화소:s.그늘화소, 지면화소:s.지면화소,
            그늘평균밝기:s.그늘평균밝기, 양지평균밝기:s.양지평균밝기};
  });

  // 대조 ②: 해 방위를 180° 돌리면 그늘 자리가 바뀌어야 합니다.
  const a1=shadowSet(f, 12, SUN_AZ, '해 12° · 방위 '+SUN_AZ+'°');
  const a2=shadowSet(f, 12, (SUN_AZ+180)%360, '해 12° · 방위 '+((SUN_AZ+180)%360)+'°');
  결과.방위대조={ 앞:a1.그늘화소, 뒤:a2.그늘화소, IoU:+iou(a1.mask,a2.mask).toFixed(4) };

  // ── 조도 대조: 앱이 실제로 쓰는 직달/확산 비에서 그림자가 얼마나 짙은가 ──
  {
    const u2=f.material.uniforms;
    const 재기=(irr, sun, label)=>{
      u2.uSurfaceIrr.value.set(irr[0],irr[1],irr[2]);
      u2.uSunRadiance.value.set(sun[0],sun[1],sun[2]);
      const r=shadowSet(f, 12, SUN_AZ, label);
      return { 그늘화소:r.그늘화소, 그늘평균밝기:r.그늘평균밝기, 양지평균밝기:r.양지평균밝기,
               그늘대양지:+(r.그늘평균밝기/Math.max(1,r.양지평균밝기)).toFixed(3) };
    };
    결과.조도대조={
      앱값: 재기([0.83,1.03,1.27], [0.78,0.66,0.52], '앱 조도 (하늘 1.03 · 직달 0.66)'),
      물리비: 재기([0.83,1.03,1.27], [7.56*0.78/0.66, 7.56, 7.56*0.52/0.66], '물리 비 (직달 ×11.5)'),
      하네스값: 재기([0.10,0.11,0.14], [2.4,2.1,1.7], '하네스 조도 (직달이 24배)'),
    };
    u2.uSurfaceIrr.value.set(0.10,0.11,0.14); u2.uSunRadiance.value.set(2.4,2.1,1.7);
  }

  scene.remove(f.mesh); f.dispose?.();

  // 대조 ③: 평평한 땅 (DEM 없음)
  const flat=makeField(null);
  look(SUN_AZ);
  const fs2=shadowSet(flat, 12, SUN_AZ, '평판 (DEM 없음)');
  결과.평판={ 그늘화소:fs2.그늘화소, 지면화소:fs2.지면화소 };
  scene.remove(flat.mesh); flat.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'terrain-shadow.html'), html);
  console.log('생성 완료: terrain-shadow.html');
})();
