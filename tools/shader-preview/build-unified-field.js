/**
 * **두 격자를 하나로 합치면 무엇이 달라지나** (구조 개편 ②).
 *
 * 지금은 지형 격자가 둘입니다 — 근거리(0.6m~3km, 줌 13)와 먼 지형
 * (3km~55km, 줌 9). 3km 에서 **두 메시가 딱 맞닿고**, 그 자리가 서로 다른
 * 자료로 그려진 하드 이음매입니다.
 *
 * 합친 격자는 한 메시가 발밑부터 55km 까지 맡고, 촘촘한 패치가 보장하는
 * 반지름 안쪽 4분의 3 까지는 촘촘한 것만 쓰다가 가장자리까지 부드럽게
 * 넘깁니다 — 이음매가 선이 아니라 띠가 됩니다.
 *
 * ## 재는 것 둘
 *
 * ① **실루엣 정확도.** CPU 참조와 견줍니다. 참조는 **앱과 같은 자료를 같은
 *    자리에서** 씁니다 — 촘촘한 패치 안은 촘촘한 것으로, 밖은 성긴 것으로.
 *    (전부 성긴 것으로 만들었다가 자료 차이를 결함으로 읽은 적이 있습니다:
 *    남서쪽 +4.4°.) 합친 쪽이 나빠지면 안 됩니다.
 *
 * ② **이음매.** 3km 를 가로지르는 **반지름 방향**으로 밝기를 훑어 2차 차분을
 *    냅니다. 하드 경계면 그 자리에 뾰족한 값이 서고, 띠로 섞이면 안 섭니다.
 *    ⚠ 화면 전체가 아니라 **이음매 언저리(2.4~3.6km)만** 봅니다 — 전체를
 *    평균 내면 지형 자체의 굴곡에 묻힙니다.
 *
 * 사용: node tools/shader-preview/build-unified-field.js
 *       node tools/shader-preview/verify-unified-field.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');
const LIGHT = require('./app-lighting').appLighting(25, 135);

/** 도곡동 — 3km 안팎으로 산이 이어져 이음매가 드러나는 자리. */
const LAT = 37.489130, LON = 127.043169, NEAR_DIR = 'dem-dogok', WIDE_DIR = 'wide-dogok';
const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;
const AZIMUTHS = 72, R_EARTH = 6371000;

const nearZoom = D.demZoomForRadius(FIELD_FAR_M, LAT, BLOCK);
const wideZoom = D.demZoomForRadius(MASK_RADIUS_M, LAT, BLOCK);
const near = D.makeCpuDem({ demDir: path.join(PREVIEW, NEAR_DIR), zoom: nearZoom, lat: LAT, lon: LON });
const wide = D.makeCpuDem({ demDir: path.join(PREVIEW, WIDE_DIR), zoom: wideZoom, lat: LAT, lon: LON });
const obs = near.elevAtGround(0, 0);
if (obs === null) throw new Error('발밑 고도를 못 읽었습니다');
const eye = obs + EYE_M;

const nearReachM = ((BLOCK - 1) / 2) * D.tileSpanMetres(nearZoom, LAT) * 0.98;
const elevAt = (e2, s2) => {
  const d = Math.hypot(e2, s2);
  if (d <= nearReachM) { const h = near.elevAtGround(e2, s2); if (h !== null) return h; }
  return wide.elevAtGround(e2, s2);
};

const 참조 = [];
for (let i = 0; i < AZIMUTHS; i++) {
  const a = (i * 360) / AZIMUTHS, r = (a * Math.PI) / 180;
  const se = Math.sin(r), sn = -Math.cos(r);
  let best = -90;
  for (let d = 30; d <= 55000; d += (d < 3000 ? 20 : 100)) {
    const h = elevAt(se * d, sn * d);
    if (h === null) continue;
    const e = (Math.atan2(h - eye - (d * d) / (2 * R_EARTH), d) * 180) / Math.PI;
    if (e > best) best = e;
  }
  참조.push(+best.toFixed(4));
}
console.log(`발밑 ${obs.toFixed(1)}m · 촘촘 패치 반경 ${nearReachM.toFixed(0)}m`);
console.log(`참조 실루엣 ${Math.min(...참조).toFixed(2)}° ~ ${Math.max(...참조).toFixed(2)}°`);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>두 격자 대 한 격자 (도곡동)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye,
         FAR_FIELD_NEAR_M, FAR_FIELD_FAR_M, FAR_FIELD_RINGS, FIELD_RINGS, FIELD_SPOKES }
  from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, NEAR_DIR='${NEAR_DIR}', WIDE_DIR='${WIDE_DIR}';
const BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, MASK_R=${MASK_RADIUS_M}, EYE=${EYE_M};
const 참조=${JSON.stringify(참조)}, AZIMUTHS=${AZIMUTHS};
const IRR=${JSON.stringify(LIGHT.surfaceIrr)}, SUNR=${JSON.stringify(LIGHT.sunRadiance)};
const EXPO=${LIGHT.exposure};

const EYE_TOWER=300;   // 이음매를 보려면 눈이 높아야 합니다 (위 주석)
const WS=192, HS=192, FOVS=8;        // 실루엣용 — 좁은 화각으로 고도각을 정밀히
const WR=320, HR=320, FOVR=60;       // 이음매용 — 내려다보며 반지름 방향 훑기
const canvas=document.createElement('canvas');
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true});
r.setPixelRatio(1); r.setClearColor(0,0);
const rtS=new THREE.WebGLRenderTarget(WS,HS,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
const rtR=new THREE.WebGLRenderTarget(WR,HR,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
const bufS=new Uint8Array(WS*HS*4), bufR=new Uint8Array(WR*HR*4);
const tanS=Math.tan(FOVS*Math.PI/360);
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});

clearDemCache();
const patch=await loadDemPatch(LAT,LON,FAR,{renderer:r,loadTexture,block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${NEAR_DIR}/\${z}_\${x}_\${y}.png\`});
const maskPatch=await loadDemPatch(LAT,LON,MASK_R,{renderer:r,loadTexture,block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${WIDE_DIR}/\${z}_\${x}_\${y}.png\`});
if(!patch||!maskPatch) errors.push('패치 없음');

const scene=new THREE.Scene();
function light(f){ const u=f.material.uniforms;
  u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
  u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
  u.uExposure.value=EXPO; u.uAerial.value=0; u.uShadow.value=0; u.uDetail.value=0;
  u.uSunAltDeg.value=25; u.uSunAltRad.value=25*Math.PI/180; u.uSunAzRad.value=135*Math.PI/180; }

/** 두 격자 (지금) */
function buildTwo(cam, eyeM){
  const E=eyeM||EYE;
  const a=createTerrainField({patch, eyePatch:patch, eyeHeightM:E});
  a.mesh.renderOrder=-0.48; scene.add(a.mesh); updateTerrainFieldEye(a,cam); light(a);
  const b=createTerrainField({patch:maskPatch, eyePatch:patch, eyeHeightM:E,
    nearM:FAR_FIELD_NEAR_M, farM:FAR_FIELD_FAR_M, rings:FAR_FIELD_RINGS, despike:true});
  b.mesh.renderOrder=-0.49; scene.add(b.mesh); updateTerrainFieldEye(b,cam); light(b);
  return [a,b];
}
/** 한 격자 (합친 것) — 고리 수는 둘의 합. */
function buildOne(cam, eyeM){
  const E=eyeM||EYE;
  const a=createTerrainField({patch, eyePatch:patch, farPatch:maskPatch, eyeHeightM:E,
    farM:FAR_FIELD_FAR_M, rings:FIELD_RINGS+FAR_FIELD_RINGS, spokes:FIELD_SPOKES});
  a.mesh.renderOrder=-0.48; scene.add(a.mesh); updateTerrainFieldEye(a,cam); light(a);
  return [a];
}

/** 방위마다 가운데 열의 가장 위 불투명 화소 → 실루엣 고도각. */
function silhouette(cam){
  r.setSize(WS,HS,false); canvas.width=WS; canvas.height=HS;
  cam.fov=FOVS; cam.aspect=WS/HS; cam.updateProjectionMatrix();
  const out=[];
  for(let i=0;i<AZIMUTHS;i++){
    const ar=(i*360/AZIMUTHS)*Math.PI/180;
    cam.up.set(0,1,0); cam.lookAt(Math.sin(ar),0,-Math.cos(ar)); cam.updateMatrixWorld(true);
    r.setRenderTarget(rtS); r.clear(); r.render(scene,cam);
    r.readRenderTargetPixels(rtS,0,0,WS,HS,bufS); r.setRenderTarget(null);
    const x=WS>>1; let top=-1;
    for(let y=HS-1;y>=0;y--) if(bufS[(y*WS+x)*4+3]>128){top=y;break;}
    out.push(top<0?null:Math.atan(tanS*(2*(top+0.5)/HS-1))*180/Math.PI);
  }
  return out;
}

/**
 * 이음매 — 내려다보며 화면 세로 한 줄을 훑습니다. 화면 세로는 곧 거리이고,
 * 3km 언저리만 잘라 2차 차분을 냅니다.
 */
/**
 * ⚠ 이음매는 **높은 눈**으로 봐야 합니다. 눈높이 1.6m 에서 3km 지면은
 *   내려본각 0.03° 라 내려다봐도 한 줄도 안 잡힙니다 — 처음에 그렇게 재서
 *   "이음매 0" 이 나왔는데 그건 차이가 없어서가 아니라 **자가 포화한 것**
 *   이었습니다(구름 그림자 하네스에서 똑같이 밟았습니다). 300m 탑에서
 *   보면 3km 가 −5.7° 로 화면 한복판에 옵니다.
 */
function seam(cam, eyeM){
  r.setSize(WR,HR,false); canvas.width=WR; canvas.height=HR;
  cam.fov=FOVR; cam.aspect=1; cam.updateProjectionMatrix();
  // ⚠ **한 방위 열두 줄로는 못 정합니다.** 처음에 그렇게 쟀더니 같은 구성의
  //   기준선이 실행마다 0.39 ↔ 0.24 로 흔들렸습니다(SwiftShader 편차).
  //   물가 각짐 자에서 똑같이 밟은 함정입니다. 방위 넷 × 넓힌 띠로 봅니다.
  let jagAll=0, nAll=0, mxAll=0;
  for (const azDeg of [140, 200, 260, 320]) {
  const pr=-8*Math.PI/180, ar=azDeg*Math.PI/180;
  cam.up.set(0,1,0);
  cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr));
  cam.updateMatrixWorld(true);
  r.setRenderTarget(rtR); r.clear(); r.render(scene,cam);
  r.readRenderTargetPixels(rtR,0,0,WR,HR,bufR); r.setRenderTarget(null);
  if (azDeg===200) { r.render(scene,cam);
    const c=document.createElement('canvas'); c.width=WR; c.height=HR;
    c.style.width='200px'; c.style.height='200px';
    c.getContext('2d').drawImage(canvas,0,0);
    document.getElementById('shots').appendChild(c); }
  // 화면 세로 → 내려본각 → 거리. 눈높이 eyeM 의 평지 근사로 충분합니다
  // (이음매가 어느 줄에 오는지만 알면 되니까).
  const tanV=Math.tan(FOVR*Math.PI/360);
  const rows=[];
  for(let y=0;y<HR;y++){
    const dy=Math.atan(tanV*(2*(y+0.5)/HR-1))*180/Math.PI;
    const elev=-8+dy;
    if(elev>=-0.5) { rows.push(null); continue; }
    rows.push(eyeM/Math.tan(-elev*Math.PI/180));
  }
  // ⚠ 평균만 보면 **한 줄짜리 뾰족한 계단**과 **여러 줄에 걸친 완만한 휨**을
  //   구분 못 합니다. 이음매는 전자이므로 최댓값을 함께 봅니다.
  let jag=0,n=0,mx=0;
  for(let y=1;y<HR-1;y++){
    const d=rows[y]; if(d===null||d<1800||d>4400) continue;
    let a=0,b=0,c2=0,na=0;
    for(let x=0;x<WR;x++){
      const i0=((y-1)*WR+x)*4, i1=(y*WR+x)*4, i2=((y+1)*WR+x)*4;
      if(bufR[i0+3]<128||bufR[i1+3]<128||bufR[i2+3]<128) continue;
      const L=o=>0.2126*bufR[o]+0.7152*bufR[o+1]+0.0722*bufR[o+2];
      a+=L(i0); b+=L(i1); c2+=L(i2); na++;
    }
    if(na<10) continue;
    const v=Math.abs(c2/na-2*b/na+a/na);
    jag+=v; n++; if(v>mx) mx=v;
  }
  jagAll+=jag; nAll+=n; if(mx>mxAll) mxAll=mx;
  }
  return { 이음매각짐:+(jagAll/Math.max(1,nAll)).toFixed(4),
           이음매최대:+mxAll.toFixed(4), 줄:nAll };
}

const 결과={};
const 경우들=[['두 격자', buildTwo, 0]];
for (const bi of [0.20, 0.30, 0.75])
  경우들.push(['한 격자 폭'+bi, (c,e)=>{ const h=buildOne(c,e);
    h[0].material.uniforms.uBlendInner.value=bi; return h; }, bi]);

for (const [key, build] of 경우들) {
  const cam=new THREE.PerspectiveCamera(FOVS,1,0.1,2000); cam.position.set(0,0,0);
  const hs=build(cam);
  const 측정=silhouette(cam);
  const 오차=[]; for(let i=0;i<AZIMUTHS;i++) if(측정[i]!==null) 오차.push(측정[i]-참조[i]);
  const abs=오차.map(Math.abs).sort((a,b)=>a-b);
  let tri=0; for(const h of hs){ const g=h.mesh.geometry;
    tri += (g.index ? g.index.count : g.attributes.position.count)/3; }
  for(const h of hs){ scene.remove(h.mesh); h.dispose?.(); }

  // 이음매는 300m 탑에서 따로 세워 봅니다.
  const camT=new THREE.PerspectiveCamera(FOVR,1,0.1,2000); camT.position.set(0,0,0);
  const ht=build(camT, EYE_TOWER);
  const s=seam(camT, EYE_TOWER);
  for(const h of ht){ scene.remove(h.mesh); h.dispose?.(); }
  결과[key]={ 메시:hs.length, 삼각형:tri,
    실루엣치우침:+(오차.reduce((a,b)=>a+b,0)/(오차.length||1)).toFixed(4),
    실루엣절대중앙값:+(abs[abs.length>>1]??0).toFixed(4),
    실루엣최대:+(abs[abs.length-1]??0).toFixed(4),
    표본:오차.length, ...s };
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError:r.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+r.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'unified-field.html'), html);
console.log('생성 완료: unified-field.html');
