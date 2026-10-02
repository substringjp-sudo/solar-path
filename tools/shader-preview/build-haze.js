/**
 * **먼 산이 제 뒤 하늘색으로 잦아드는가** (실기 보고: "앞쪽의 산이
 * 원인불명으로 파랗고 밝게 보여져", 새벽 06:46 · 해 쪽을 봄).
 *
 * 공기원근의 끝색은 **그 방향의 하늘**이어야 합니다. 아주 멀리 있는 지형은
 * 결국 제 뒤 하늘과 같은 색이 됩니다 — 그것이 대기 투시입니다. 그런데 새
 * 지형은 방위 여섯 곳을 평균한 **한 값**을 하늘 전체에 썼습니다. 새벽에
 * 해 쪽 지평선은 주황이고 반대쪽은 어두운 파랑인데, 그 둘을 섞은 값을
 * 양쪽에 다 발랐던 것입니다. (옛 능선 띠는 이미 방향별 하늘색을 씁니다 —
 * 새 지형만 뒤처져 있었습니다.)
 *
 * ## 재는 법 — 능선 **바로 아래**와 **바로 위**를 짝지어 견줍니다
 *
 * 방위마다 하늘과 지형의 경계를 찾아, 그 위 몇 줄(하늘)과 아래 몇 줄(먼
 * 지형)의 색을 잽니다. 지형이 충분히 멀면 둘의 **색조**가 비슷해야 합니다.
 * 밝기는 다를 수 있지만(지형은 어둡습니다) 색이 반대로 가면 안 됩니다.
 *
 * 색조는 `파랑/빨강` 비로 봅니다. 새벽 해 쪽 하늘은 이 값이 1 보다 훨씬
 * 작고(주황), 반대쪽은 1 보다 큽니다(파랑). 지형이 하늘을 안 따라가면
 * 이 비가 하늘과 크게 어긋납니다.
 *
 * ## 대조
 *
 * `uHazeDirectional` 로 옛 평균 한 값과 방향별 하늘색을 A/B 합니다. 옛
 * 방식에서 어긋남이 크고 새 방식에서 작아야 합니다 — 안 그러면 이 자가
 * 무엇을 재는지 모르는 것입니다.
 *
 * (2026-10-02) 연무의 노출(`uHazeSkyScale`)과 산 그림자(`uHazeShadow`)가 생긴 뒤로 "옛"은 그때 코드
 * 경로 그대로(셋 다 0), "새"는 지금 앱(셋 다 1)입니다. 노출 고침만 새로 켜 둔 채 방향만 끄면 옛 증상이
 * 재현되지 않습니다 — 파랗게 뜨던 앞산의 상당 몫이 지면 노출·순응(해 3° 에서 ×2.6)을 먹은 연무였습니다.
 *
 * 사용: node tools/shader-preview/build-haze.js
 *       node tools/shader-preview/verify-haze.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

/** 도곡동 — 사방에 3~20km 산이 있어 먼 지형이 하늘과 맞닿습니다. */
const LAT = 37.489130, LON = 127.043169;
const NEAR_DIR = 'dem-dogok', MASK_DIR = 'wide-dogok';
const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;
/** 새벽 — 실기 넷째 사진의 자리. 해는 동남쪽 낮게. */
const SUN_ALT = 3, SUN_AZ = 100;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:920px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>먼 산이 제 뒤 하늘색으로 잦아드는가 (도곡동, 새벽)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye,
         FAR_FIELD_FAR_M, FAR_FIELD_RINGS, FIELD_RINGS, FIELD_SPOKES }
  from './app/components/SkyScene3D/TerrainField.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, NEAR_DIR='${NEAR_DIR}', MASK_DIR='${MASK_DIR}';
const BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, MASK_R=${MASK_RADIUS_M}, EYE=${EYE_M};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};

const W=256, H=256, FOV=30, PITCH=0;
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

const atmosphere={betaMie:0.08, angstrom:1.3, elevScale:1.0, ozoneDU:330};
const scene=new THREE.Scene();
const skydome=createSkydome(); scene.add(skydome.mesh);
updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
const cam=new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000); cam.position.set(0,0,0);
// 앱(SkyScene3D)과 같은 **격자 하나** — 발밑부터 55km, 촘촘한 패치에서 성긴 패치로 섞어 읽습니다.
// (예전 판정은 근거리·먼 지형 두 격자였습니다. 앱이 하나로 합친 뒤에도 그대로였던 것을 맞춥니다, 2026-10-02.)
const field=createTerrainField({patch, eyePatch:patch, farPatch:maskPatch, eyeHeightM:EYE,
  farM:FAR_FIELD_FAR_M, rings:FIELD_RINGS+FAR_FIELD_RINGS, spokes:FIELD_SPOKES});
field.mesh.renderOrder=-0.48; scene.add(field.mesh); updateTerrainFieldEye(field, cam);

for (const h of [field]) {
  const u=h.material.uniforms;
  u.uSurfaceIrr.value.set(0.169, 0.180, 0.154);
  u.uSunRadiance.value.set(0.12, 0.03, 0.00);
  u.uSunAltDeg.value=SUN_ALT; u.uSunAltRad.value=SUN_ALT*Math.PI/180;
  u.uSunAzRad.value=SUN_AZ*Math.PI/180;
  u.uBeta.value=atmosphere.betaMie; u.uAngstrom.value=atmosphere.angstrom;
  u.uElevScale.value=atmosphere.elevScale; u.uOzoneDU.value=atmosphere.ozoneDU;
  u.uAerial.value=1;
  // 옛 평균 한 값 — 방위 여섯 곳의 평균을 흉내 냅니다.
  u.uHazeRadiance.value.set(0.36, 0.30, 0.28);
}

/** 방위 하나를 찍고, 하늘/지형 경계 위아래의 색을 잽니다. */
function shoot(azDeg, label){
  const ar=azDeg*Math.PI/180, pr=PITCH*Math.PI/180;
  cam.up.set(0,1,0);
  cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr));
  cam.updateMatrixWorld(true);
  field.bakeSunShadow(renderer);   // 앱처럼 해 쪽 산 그림자 경계를 굽습니다(해·지형이 그대로면 건너뜀)
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
  if(label){ renderer.render(scene,cam);
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    c.style.width='128px'; c.style.height='128px';
    c.getContext('2d').drawImage(canvas,0,0);
    const t=document.createElement('div'); t.style.font='10px monospace'; t.textContent=label;
    document.getElementById('shots').appendChild(t);
    document.getElementById('shots').appendChild(c); }

  // 하늘돔은 늘 그려지므로 알파로는 못 가릅니다. 대신 열마다 **위에서
  // 아래로** 내려오며 색이 크게 꺾이는 자리를 능선으로 봅니다.
  let sky=[0,0,0], gnd=[0,0,0], n=0;
  for(let x=0;x<W;x++){
    let edge=-1;
    for(let y=H-2;y>=1;y--){          // y=H-1 이 화면 위
      const o=(y*W+x)*4, o2=((y-1)*W+x)*4;
      const d=Math.abs(buf[o]-buf[o2])+Math.abs(buf[o+1]-buf[o2+1])+Math.abs(buf[o+2]-buf[o2+2]);
      if(d>24){ edge=y; break; }
    }
    if(edge<8 || edge>H-8) continue;
    for(let k=2;k<=6;k++){
      const a=((edge+k)*W+x)*4, b=((edge-k)*W+x)*4;
      sky[0]+=buf[a]; sky[1]+=buf[a+1]; sky[2]+=buf[a+2];
      gnd[0]+=buf[b]; gnd[1]+=buf[b+1]; gnd[2]+=buf[b+2];
    }
    n+=5;
  }
  if(n===0) return null;
  const S=sky.map(v=>v/n), G=gnd.map(v=>v/n);
  const hue=(c)=>c[2]/Math.max(1,c[0]);       // 파랑/빨강
  return { 열:n/5, 하늘:S.map(v=>+v.toFixed(1)), 지형:G.map(v=>+v.toFixed(1)),
           하늘색조:+hue(S).toFixed(3), 지형색조:+hue(G).toFixed(3),
           색조어긋남:+Math.abs(hue(G)-hue(S)).toFixed(3) };
}

const AZ=[SUN_AZ, (SUN_AZ+90)%360, (SUN_AZ+180)%360, (SUN_AZ+270)%360];
const 이름=['해 쪽', '해 옆', '해 반대', '해 옆2'];
const 결과={};
// 옛 = 그때 코드 경로 그대로: 평균 한 값 · 연무가 지면 노출·순응을 먹음 · 산 그림자 없음.
// 새 = 지금 앱: 방향별 하늘색 · 연무는 하늘 노출(uHazeSkyScale) · 산 그림자(uHazeShadow).
for (const [mode, key] of [[0,'옛 평균 한 값'], [1,'방향별 하늘색']]) {
  for (const h of [field]) { const u=h.material.uniforms;
    u.uHazeDirectional.value = mode; u.uHazeSkyScale.value = mode; u.uHazeShadow.value = mode; }
  const rows={};
  AZ.forEach((az,i)=>{ const r=shoot(az, key+' · '+이름[i]+' ('+az+'°)'); if(r) rows[이름[i]]=r; });
  const ds=Object.values(rows).map(r=>r.색조어긋남);
  결과[key]={ 방위:rows, 평균어긋남:+(ds.reduce((a,b)=>a+b,0)/Math.max(1,ds.length)).toFixed(3),
              최대어긋남:+Math.max(...ds, 0).toFixed(3) };
}
for (const h of [field]) { const u=h.material.uniforms; u.uHazeDirectional.value = 1; u.uHazeSkyScale.value = 1; u.uHazeShadow.value = 1; }

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'haze.html'), html);
console.log('생성 완료: haze.html');
