/**
 * **격자를 더 잘게 나누면 지형이 부드러워지는가** (사용자 물음).
 *
 * "지형 폴리곤을 테셀레이션해서 좀 부드럽고 완만하게 만드는건 안되나?"
 *
 * ## 먼저 자를 대 봐야 합니다 — 지금 격자가 자료보다 성긴가, 촘촘한가
 *
 * 근거리 격자(고리 152 × 살 256, 0.6m~3km)의 간격을 줌 13 DEM 화소(15.1m)와
 * 견주면:
 *
 *     거리     고리간격  살간격   병목
 *      10m       1.2m    0.2m   자료가 성김 (격자가 더 촘촘)
 *     200m       8.6m    4.9m   자료가 성김
 *     500m      21.5m   12.3m   **격자가 성김 ×1.4**
 *    2000m      86.3m   49.1m   **격자가 성김 ×5.7**
 *    3000m     127.6m   73.6m   **격자가 성김 ×8.5**
 *
 * 즉 500m 밖에서는 격자가 자료를 **덜 찍고** 있습니다. 그러니 더 잘게 나누면
 * 지금 놓치고 있던 굴곡이 **되살아납니다** — 부드러워지는 게 아니라
 * **더 우툴두툴해집니다.** 이 하네스는 그 예상이 맞는지 재서 확인합니다.
 *
 * ## 재는 것
 *
 * 같은 자리·같은 조명에서 격자 밀도만 바꿔 가며
 *
 * - **실루엣 정확도**: 방위별 능선 고도각을 CPU 참조와 견줍니다. 격자가
 *   성기면 봉우리를 놓쳐 낮게 깔립니다.
 * - **거칠기**: 지면 화소 밝기의 표준편차. 잘게 나눌수록 커지면 "더
 *   우툴두툴해진다"가 맞는 것입니다.
 * - **비용**: 삼각형 수.
 *
 * ⚠ WebGL2 에는 테셀레이션·지오메트리 셰이더 단계가 **없습니다**. 그러니
 * "테셀레이션"은 CPU 에서 정점을 더 만드는 것뿐이고, 비용이 그대로 정점
 * 수와 대역폭으로 옵니다.
 *
 * 사용: node tools/shader-preview/build-tessellation.js
 *       node tools/shader-preview/verify-tessellation.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

/** 마니산 정상 — 3km 안에 455m 기복. 타일은 이미 받아 두었습니다. */
const LAT = 37.61553, LON = 126.4300, DIR = 'dem-mani';
const BLOCK = 3, FIELD_FAR_M = 3000, EYE_M = 1.6;
const R_EARTH = 6371000;
const AZIMUTHS = 24;
/** [고리, 살] — 지금 값과 그 두 배·네 배. */
const LEVELS = [[152, 256], [304, 512], [608, 1024]];

const SUN_ALT = 25;
const SKY_MEAN = { r: 0.83, g: 1.03, b: 1.27 };
const BEAM = { r: 0.78, g: 0.66, b: 0.52 };

/**
 * ⚠ 조명 배선은 **앱에서 가져옵니다**. 손으로 적으면 앱이 바뀔 때 하네스만
 * 옛 배선을 재게 됩니다 — 실제로 그렇게 됐습니다. 이 시험이 처음 잰 것은
 * "직달을 물리 비율로 올리면 어떻게 되나" 였고, 그 답이 앱에 들어간 뒤로는
 * 하드코딩한 7.56 이 옛 값이 되어 판정이 거꾸로 뒤집혔습니다.
 */
const ATM = require('/tmp/skybuild/atmosphere.js');
const LIT = ATM.groundLighting(SUN_ALT, SKY_MEAN, BEAM, 1);
const IRR = [LIT.surfaceIrr.r, LIT.surfaceIrr.g, LIT.surfaceIrr.b];
const SUNR = [LIT.sunRadiance.r, LIT.sunRadiance.g, LIT.sunRadiance.b];
const EXPO = LIT.exposure;

/** 대조 — 직달 눈금만 1 로 되돌린 같은 셰이더. */
const S1 = Math.max(0, Math.sin((SUN_ALT * Math.PI) / 180)) / Math.PI;
const OLD_IRR = [SKY_MEAN.r + BEAM.r * S1, SKY_MEAN.g + BEAM.g * S1, SKY_MEAN.b + BEAM.b * S1];
const OLD_SUN = [BEAM.r, BEAM.g, BEAM.b];

const dem = D.makeCpuDem({
  demDir: path.join(PREVIEW, DIR), zoom: D.demZoomForRadius(FIELD_FAR_M, LAT, BLOCK),
  lat: LAT, lon: LON,
});
const obs = dem.elevAtGround(0, 0);
const eye = obs + EYE_M;
const ang = (d, h) => (Math.atan2(h - eye - (d * d) / (2 * R_EARTH), d) * 180) / Math.PI;

// 참조 실루엣 — 자료가 허락하는 한 촘촘히(10m 간격) 훑은 고도각 최댓값.
const 참조 = [];
for (let i = 0; i < AZIMUTHS; i++) {
  const a = (i * 360) / AZIMUTHS, r = (a * Math.PI) / 180;
  const se = Math.sin(r), sn = -Math.cos(r);
  let best = -90;
  for (let d = 30; d <= FIELD_FAR_M; d += 10) {
    const h = dem.elevAtGround(se * d, sn * d);
    if (h === null) continue;
    const e = ang(d, h);
    if (e > best) best = e;
  }
  참조.push(+best.toFixed(4));
}
console.log(`발밑 ${obs.toFixed(1)}m · 참조 실루엣 ${Math.min(...참조).toFixed(2)}~${Math.max(...참조).toFixed(2)}°`);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>격자를 더 잘게 나누면 지형이 어떻게 달라지는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, EYE=${EYE_M};
const LEVELS=${JSON.stringify(LEVELS)}, 참조=${JSON.stringify(참조)}, AZIMUTHS=${AZIMUTHS};
const IRR=${JSON.stringify(IRR)}, SUNR=${JSON.stringify(SUNR)}, EXPO=${EXPO};
const OLD_IRR=${JSON.stringify(OLD_IRR)}, OLD_SUN=${JSON.stringify(OLD_SUN)};

const WS=64, HS=512, FOVS=24;      // 실루엣용 좁은 화각
const WR=320, HR=320, FOVR=70;     // 거칠기용 넓은 화각
const canvas=document.createElement('canvas');
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setClearColor(0x000000,0);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

clearDemCache();
const patch=await loadDemPatch(LAT, LON, FAR, {renderer, loadTexture, block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${DIR}/\${z}_\${x}_\${y}.png\`});
if(!patch) errors.push('패치 없음');

function makeRT(W,H){ return new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,
  type:THREE.UnsignedByteType, minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter,
  depthBuffer:true}); }
const rtS=makeRT(WS,HS), rtR=makeRT(WR,HR);
const bufS=new Uint8Array(WS*HS*4), bufR=new Uint8Array(WR*HR*4);
const tanS=Math.tan(FOVS*Math.PI/360);
const rowElev=(y)=>Math.atan(tanS*(2*(y+0.5)/HS-1))*180/Math.PI;

const 결과={};
for (const [rings, spokes] of LEVELS) {
  const key=rings+'×'+spokes;
  const scene=new THREE.Scene();
  const field=createTerrainField({patch, eyePatch:patch, eyeHeightM:EYE, rings, spokes});
  scene.add(field.mesh);
  const u=field.material.uniforms;
  u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
  u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
  u.uExposure.value=EXPO;
  u.uAerial.value=0; u.uShadow.value=1;
  u.uSunAltDeg.value=25; u.uSunAltRad.value=25*Math.PI/180;
  u.uSunAzRad.value=135*Math.PI/180;

  // ── 실루엣 ────────────────────────────────────────────────────────────
  renderer.setSize(WS,HS,false); canvas.width=WS; canvas.height=HS;
  const camS=new THREE.PerspectiveCamera(FOVS, WS/HS, 0.1, 2000); camS.position.set(0,0,0);
  updateTerrainFieldEye(field, camS);
  const 측정=[];
  for (let i=0;i<AZIMUTHS;i++){
    const ar=(i*360/AZIMUTHS)*Math.PI/180;
    camS.up.set(0,1,0); camS.lookAt(Math.sin(ar), 0, -Math.cos(ar)); camS.updateMatrixWorld(true);
    renderer.setRenderTarget(rtS); renderer.clear(); renderer.render(scene,camS);
    renderer.readRenderTargetPixels(rtS,0,0,WS,HS,bufS); renderer.setRenderTarget(null);
    const x=WS>>1; let top=-1;
    for(let y=HS-1;y>=0;y--){ if(bufS[(y*WS+x)*4+3]>128){ top=y; break; } }
    측정.push(top<0?null:+rowElev(top).toFixed(4));
  }
  const errs=[]; for(let i=0;i<AZIMUTHS;i++) if(측정[i]!==null) errs.push(측정[i]-참조[i]);
  const abs=errs.map(Math.abs).sort((a,b)=>a-b);

  // ── 거칠기 ────────────────────────────────────────────────────────────
  // ⚠ 조명을 **두 가지**로 잽니다. 지금 앱의 직달/확산 비(하늘이 직달의
  //   11.5배)와, 맑은 날 물리 비(직달이 수평면에서 하늘의 3.4배)입니다.
  //   격자를 잘게 나눠도 화면이 안 변한다면 그것이 격자 탓인지 **조명이
  //   그 굴곡을 표현할 여력이 없어서**인지 갈라 봐야 합니다.
  renderer.setSize(WR,HR,false); canvas.width=WR; canvas.height=HR;
  const camR=new THREE.PerspectiveCamera(FOVR, 1, 0.1, 2000); camR.position.set(0,0,0);
  updateTerrainFieldEye(field, camR);
  const pr=-20*Math.PI/180, ar2=45*Math.PI/180;
  camR.up.set(0,1,0);
  camR.lookAt(Math.sin(ar2)*Math.cos(pr), Math.sin(pr), -Math.cos(ar2)*Math.cos(pr));
  camR.updateMatrixWorld(true);
  function shootRough(label){
    renderer.setRenderTarget(rtR); renderer.clear(); renderer.render(scene,camR);
    renderer.readRenderTargetPixels(rtR,0,0,WR,HR,bufR); renderer.setRenderTarget(null);
    renderer.render(scene,camR);
    const c=document.createElement('canvas'); c.width=WR; c.height=HR;
    c.style.width='150px'; c.style.height='150px';
    c.getContext('2d').drawImage(canvas,0,0);
    const t=document.createElement('div'); t.style.font='10px monospace'; t.textContent=label;
    document.getElementById('shots').appendChild(t);
    document.getElementById('shots').appendChild(c);
    const ls=[];
    for(let i=0;i<WR*HR;i++){ if(bufR[i*4+3]<128) continue;
      ls.push(0.2126*bufR[i*4]+0.7152*bufR[i*4+1]+0.0722*bufR[i*4+2]); }
    let m=0; for(const v of ls) m+=v; m/=(ls.length||1);
    let s2=0; for(const v of ls) s2+=(v-m)*(v-m);
    // 이웃 화소끼리의 차이 — 잔결이 살아 있으면 커집니다.
    let grad=0, gn=0;
    for(let y=0;y<HR;y++) for(let x=1;x<WR;x++){
      const a=(y*WR+x)*4, b=(y*WR+x-1)*4;
      if(bufR[a+3]<128||bufR[b+3]<128) continue;
      grad+=Math.abs((0.2126*bufR[a]+0.7152*bufR[a+1]+0.0722*bufR[a+2])
                    -(0.2126*bufR[b]+0.7152*bufR[b+1]+0.0722*bufR[b+2])); gn++;
    }
    return { 평균:+m.toFixed(2), 표준편차:+Math.sqrt(s2/(ls.length||1)).toFixed(3),
             이웃차이:+(grad/Math.max(1,gn)).toFixed(4) };
  }

  const 물리눈금=shootRough(key+' · 물리 눈금 (지금 앱)');
  // 대조: 직달 눈금만 1 로. 노출도 그 눈금에 맞춰 1 이 됩니다 — 두 벌의
  // 차이는 SOLAR_BEAM_SCALE 하나뿐입니다.
  u.uSurfaceIrr.value.set(OLD_IRR[0],OLD_IRR[1],OLD_IRR[2]);
  u.uSunRadiance.value.set(OLD_SUN[0],OLD_SUN[1],OLD_SUN[2]);
  u.uExposure.value=1;
  const 옛눈금=shootRough(key+' · 옛 눈금 (S=1)');
  u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
  u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]); u.uExposure.value=EXPO;

  결과[key]={
    고리:rings, 살:spokes, 삼각형:(rings-1)*spokes*2, 정점:rings*spokes,
    실루엣치우침:+(errs.reduce((a,b)=>a+b,0)/(errs.length||1)).toFixed(4),
    실루엣절대중앙값:+(abs[abs.length>>1]??0).toFixed(4),
    실루엣최대:+(abs[abs.length-1]??0).toFixed(4),
    옛눈금, 물리눈금,
  };
  scene.remove(field.mesh); field.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'tessellation.html'), html);
console.log('생성 완료: tessellation.html');
