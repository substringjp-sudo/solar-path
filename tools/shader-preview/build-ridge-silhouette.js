/**
 * **해 쪽 능선은 제 뒤 하늘보다 어둡다** (2026-10-02) — `verify-ridge-silhouette.js` 의 짝.
 *
 * 사용자(후쿠이, 2026-10-02 17:28·17:31 일몰 사진): "해가 완전히 저무는 시점에서 태양을 가리는 산이 빛나는
 * 것처럼 발광해. 보통은 어느정도 더 밝긴 해도 사진처럼 검게 나오고". 같은 장소·시각을 앱으로 그리면 해 쪽 먼
 * 산이 하얀 띠로 하늘만큼(밝기 비 ≈ 1.0) 빛났습니다.
 *
 * ## 지형은 그 자리의 것을 씁니다
 *
 * 처음엔 다른 판정과 같은 도곡동 붙박이 타일(동쪽 3~20km 산)로 쟀는데, 대조(예전 방식)가 증상을 못
 * 봤습니다(중앙값 0.77). 거기 산은 가까워 연무 몫이 작습니다. 후쿠이 해 쪽 능선은 단잔(丹生) 산지로
 * **22~26km** 밖 520~630m — 연무가 대부분인 거리입니다. 그래서 그 자리 타일을 받아 씁니다
 * (`dem-fukui` 줌 13 · `wide-fukui` 줌 9 · 참조 `ref12-fukui` 줌 12, 없으면 이 스크립트가 받습니다).
 *
 * ## 능선은 **기하로** 찾습니다
 *
 * 처음엔 열마다 "밝기가 가장 크게 떨어지는 곳"을 능선으로 봤는데, 증상이 있으면 그 자가 틀립니다 —
 * 먼 능선이 하늘만큼 빛나면 가장 큰 낙차는 능선이 아니라 **그 아래 가까운 땅과의 경계**로 옮겨 갑니다.
 * 그래서 하늘돔을 끈 채 한 번 더 찍어(지형만, 알파) 열마다 맨 위 지형 화소를 능선으로 씁니다.
 * (사진에는 이 문제가 없습니다 — 사진의 능선은 어두워서 가장 큰 낙차가 곧 능선입니다.)
 *
 * 재는 것:
 *  - 비: 해 고도 1° 에서 해 쪽(265°)을 보고 능선 아래 3~8줄(산) ÷ 위 3~8줄(하늘)의 화면 밝기(sRGB 휘도).
 *    사진에서 같은 식(가장 큰 낙차)으로 잰 값은 17:28 중앙값 0.52 · 17:31 0.56(사분위 0.48~0.60).
 *  - 능선 높이: 좁은 화각(8°)으로 해 방위 ±4° 를 찍어 열마다 능선의 고도각. 참값은 판정이 줌 12 타일로
 *    CPU 에서 냅니다(곡률 낙차 포함, 앱과 같은 눈높이).
 *
 * 대조: 예전(`uHazeSkyScale` 0 · `uHazeShadow` 0 — 연무가 지면 노출·순응을 먹고 산 그림자를 모름),
 * 노출만(1 · 0, 참고용), 지금(1 · 1).
 *
 * 준비: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-ridge-silhouette.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

/** 후쿠이 — 사용자가 사진을 찍고 앱 기록(QR)을 남긴 자리 (2026-10-02 17:28 기록). */
const LAT = 36.0209, LON = 136.2894;
const SUN_ALT = 1, SUN_AZ = 265;
const NEAR_DIR = 'dem-fukui', WIDE_DIR = 'wide-fukui', REF_DIR = 'ref12-fukui';
const NEAR_M = 3000, WIDE_M = 60000, BLOCK = 3;
/** 참조(줌 12)는 해 쪽 부채꼴(서쪽 0~45km)만 덮습니다. */
const REF_ZOOM = 12, REF_BOX = { lon0: 135.75, lon1: 136.32, lat0: 35.85, lat1: 36.20 };

const tile = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
async function get(u) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(u);
      if (r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + u);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise(res => setTimeout(res, 2000 * 2 ** i));
    }
  }
}
async function fetchTiles(dir, list) {
  fs.mkdirSync(path.join(PREVIEW, dir), { recursive: true });
  for (const [z, x, y] of list) {
    const f = path.join(PREVIEW, dir, `${z}_${x}_${y}.png`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, await get(tile(z, x, y)));
  }
}
function blockList(radiusM) {
  const z = D.demZoomForRadius(radiusM, LAT, BLOCK);
  const t = D.lonLatToTileFloat(LON, LAT, z);
  const { originX, originY } = D.pickBlockOrigin(t.x, t.y, BLOCK);
  const out = [];
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) out.push([z, originX + dx, originY + dy]);
  return out;
}
function refList() {
  const a = D.lonLatToTileFloat(REF_BOX.lon0, REF_BOX.lat1, REF_ZOOM);
  const b = D.lonLatToTileFloat(REF_BOX.lon1, REF_BOX.lat0, REF_ZOOM);
  const out = [];
  for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++)
    for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) out.push([REF_ZOOM, x, y]);
  return out;
}

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="shots"></div><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye, FAR_FIELD_FAR_M, FAR_FIELD_RINGS, FIELD_RINGS, FIELD_SPOKES }
  from './app/components/SkyScene3D/TerrainField.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, groundLighting, applyTuningUniforms } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error', e=>errors.push(String(e.message)));
try {
const LAT=${LAT}, LON=${LON}, SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};
const W=256, H=256;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
const buf=new Uint8Array(W*H*4), mbuf=new Uint8Array(W*H*4);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
clearDemCache();
const patch=await loadDemPatch(LAT, LON, ${NEAR_M}, {renderer, loadTexture, block:${BLOCK}, tileUrl:(z,x,y)=>'./${NEAR_DIR}/'+z+'_'+x+'_'+y+'.png'});
const maskPatch=await loadDemPatch(LAT, LON, ${WIDE_M}, {renderer, loadTexture, block:${BLOCK}, tileUrl:(z,x,y)=>'./${WIDE_DIR}/'+z+'_'+x+'_'+y+'.png'});
if(!patch||!maskPatch) errors.push('패치 없음');
// 그날의 대기(앱 기록: 시정 36km · 습도 59%)
const atm=makeAtmosphereParams({latitude:LAT, observerElevM:23, dayOfYear:275, humidityPct:59, visibilityM:36000});
const scene=new THREE.Scene();
const skydome=createSkydome(); scene.add(skydome.mesh); updateSkydome(skydome, SUN_ALT, SUN_AZ, atm);
const cam=new THREE.PerspectiveCamera(24, 1, 0.1, 2000); cam.position.set(0,0,0);
// 앱과 같은 **격자 하나**(발밑~55km, 촘촘한 패치 → 성긴 패치로 섞음 — SkyScene3D 의 createTerrainField)
const field=createTerrainField({patch, eyePatch:patch, farPatch:maskPatch, eyeHeightM:1.6,
  farM:FAR_FIELD_FAR_M, rings:FIELD_RINGS+FAR_FIELD_RINGS, spokes:FIELD_SPOKES});
field.mesh.renderOrder=-0.48; scene.add(field.mesh);
// 앱과 같은 지면 조명(SkyScene3D: groundLighting) — 하늘 평균 · 직달
let sm={r:0,g:0,b:0}, sw=0; for(const e of [10,30,50,75]){ const w=Math.sin(e*Math.PI/180); for(let a=0;a<6;a++){ const az=a*60; const D=Math.PI/180;
  const cg=Math.sin(e*D)*Math.sin(SUN_ALT*D)+Math.cos(e*D)*Math.cos(SUN_ALT*D)*Math.cos((az-SUN_AZ)*D); const L=skyRadiance(e, Math.acos(Math.max(-1,Math.min(1,cg)))/D, SUN_ALT, atm); sm.r+=L.r*w; sm.g+=L.g*w; sm.b+=L.b*w; sw+=w; } }
sm={r:sm.r/sw,g:sm.g/sw,b:sm.b/sw};
const lit=groundLighting(SUN_ALT, sm, beamAtAltitude(SUN_ALT,0,atm), 1);
for (const h of [field]) { const u=h.material.uniforms;
  u.uSurfaceIrr.value.set(lit.surfaceIrr.r, lit.surfaceIrr.g, lit.surfaceIrr.b);
  u.uSunRadiance.value.set(lit.sunRadiance.r, lit.sunRadiance.g, lit.sunRadiance.b);
  u.uExposure.value=lit.exposure;
  u.uSunAltDeg.value=SUN_ALT; u.uSunAltRad.value=SUN_ALT*Math.PI/180; u.uSunAzRad.value=SUN_AZ*Math.PI/180;
  u.uBeta.value=atm.betaMie; u.uAngstrom.value=atm.angstrom; u.uElevScale.value=atm.elevScale; u.uOzoneDU.value=atm.ozoneDU;
  u.uAerial.value=1; u.uHazeDirectional.value=1; }
scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
const lum=(b,o)=>0.2126*b[o]+0.7152*b[o+1]+0.0722*b[o+2];

/** 방위 az0 · 앙각 pitch 로 찍고, 하늘돔을 끈 판(지형만)도 한 장 더 찍습니다. */
function render(az0, pitch, fov, keep){
  cam.fov=fov; cam.updateProjectionMatrix();
  const ar=az0*Math.PI/180, pr=pitch*Math.PI/180;
  cam.up.set(0,1,0); cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr)); cam.updateMatrixWorld(true);
  updateTerrainFieldEye(field, cam); field.bakeSunShadow(renderer);
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000,1); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf);
  skydome.mesh.visible=false; renderer.setClearColor(0x000000,0); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,mbuf); skydome.mesh.visible=true; renderer.setRenderTarget(null);
  if(keep){ renderer.setClearColor(0x000000,1); renderer.render(scene,cam); const c=document.createElement('canvas'); c.width=W; c.height=H; c.getContext('2d').drawImage(canvas,0,0); document.getElementById('shots').appendChild(c); }
}
/** 열마다 맨 위 지형 화소(y=H-1 이 위). 없으면 -1. */
function skylineRow(x){ for(let y=H-1;y>=0;y--) if(mbuf[(y*W+x)*4+3]>0) return y; return -1; }
const isGround=(x,y)=>mbuf[(y*W+x)*4+3]>0;

/** sky: 연무를 하늘 노출로(uHazeSkyScale) · shadow: 연무 단일산란에 산 그림자(uHazeShadow). */
function ratioShot(sky, shadow){
  const u=field.material.uniforms; u.uHazeSkyScale.value=sky; u.uHazeShadow.value=shadow;
  render(SUN_AZ, 0, 24, true);
  const rs=[];
  for(let x=0;x<W;x++){
    const e=skylineRow(x); if(e<9||e>H-10) continue;
    let okCol=true; for(let k=3;k<=8;k++){ if(!isGround(x,e-k)||isGround(x,e+k)) okCol=false; } if(!okCol) continue;
    let s=0,t=0; for(let k=3;k<=8;k++){ s+=lum(buf,((e+k)*W+x)*4); t+=lum(buf,((e-k)*W+x)*4); }
    s/=6; t/=6; if(s<20) continue; rs.push(t/s);
  }
  rs.sort((a,b)=>a-b);
  const q=(p)=>rs.length?+rs[Math.min(rs.length-1,Math.floor(rs.length*p))].toFixed(3):null;
  return { 열:rs.length, 중앙:q(0.5), 하위25:q(0.25), 상위75:q(0.75), 상위90:q(0.9) };
}

/** 좁은 화각으로 열마다 능선의 (방위, 고도각). 화소 경계(맨 위 지형 화소의 윗변)를 씁니다. */
function skylineProfile(){
  const FOV=8, PITCH=1.0;
  render(SUN_AZ, PITCH, FOV, false);
  const t=Math.tan(FOV*Math.PI/360), ar=SUN_AZ*Math.PI/180, pr=PITCH*Math.PI/180;
  const fwd=[Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr)];
  const right=[Math.cos(ar), 0, Math.sin(ar)];
  const up=[-Math.sin(ar)*Math.sin(pr), Math.cos(pr), Math.cos(ar)*Math.sin(pr)];
  const pts=[];
  for(let x=0;x<W;x+=4){
    const y=skylineRow(x); if(y<0||y>=H-1) continue;
    const u=((x+0.5)/W*2-1)*t, v=((y+1)/H*2-1)*t;
    const d=[fwd[0]+right[0]*u+up[0]*v, fwd[1]+right[1]*u+up[1]*v, fwd[2]+right[2]*u+up[2]*v];
    const az=(Math.atan2(d[0],-d[2])*180/Math.PI+360)%360, el=Math.atan2(d[1],Math.hypot(d[0],d[2]))*180/Math.PI;
    pts.push([+az.toFixed(3), +el.toFixed(3)]);
  }
  return pts;
}

const out={ 예전:ratioShot(0,0), 노출만:ratioShot(1,0), 지금:ratioShot(1,1), exposure:+lit.exposure.toFixed(3), 능선:skylineProfile() };
field.material.uniforms.uHazeSkyScale.value=1; field.material.uniforms.uHazeShadow.value=1;
window.__stats={ glError: renderer.getContext().getError(), out };
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;

(async () => {
  await fetchTiles(NEAR_DIR, blockList(NEAR_M));
  await fetchTiles(WIDE_DIR, blockList(WIDE_M));
  await fetchTiles(REF_DIR, refList());
  fs.writeFileSync(path.join(PREVIEW, 'ridge-silhouette.html'), html);
  console.log('생성 완료: ridge-silhouette.html');
})().catch(e => { console.error(e.message); process.exit(1); });

