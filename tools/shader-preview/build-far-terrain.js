/**
 * **먼 산이 제 높이로 그려지는가** (실기 보고: "산의 높이나 기울기가 실제보다
 * 조금 과장돼 보여").
 *
 * 처음엔 기하가 부풀려졌나 싶었는데, 재 보니 **반대**였습니다. 3km 밖 지형은
 * 아직 옛 능선 띠가 맡고 있고, 그 띠는 방위마다 **5·15·40km 딱 세 점**의
 * 고도만 봅니다. 진짜 실루엣의 봉우리는 그 사이 아무 데나 있으므로
 * (도곡동에서 재 보면 2.6·6.7·8.1·12.9·19.6km …) 대부분 통째로 놓칩니다.
 *
 * 그래서 먼 산이 **낮게** 깔립니다. 그러면 3km 안(진짜 높이장으로 그리는
 * `TerrainField`)의 앞산만 제 높이로 서고 뒤가 납작해져서, 앞산이 실제보다
 * 훨씬 우뚝해 보입니다 — 사용자가 본 "과장"은 앞산이 커진 게 아니라
 * **뒷산이 주저앉은 것**입니다.
 *
 * ## 재는 법
 *
 * 참조는 넓은 DEM(줌 10, 5×5, 화소 121m) 하나입니다. 방위마다 200m~40km 를
 * 100m 간격으로 훑어 **고도각의 최댓값** — 그게 진짜 실루엣입니다.
 *
 * 화면 쪽은 방위마다 좁은 화각(20°)으로 한 장씩 찍어 가운데 열의 맨 위
 * 지면 화소를 각도로 되돌립니다. 좁은 화각을 쓰는 이유는 넓은 화각의
 * 가장자리에서 원근 왜곡이 각을 흔들기 때문입니다.
 *
 * ⚠ 능선 띠에 넣는 값은 **같은 DEM 을 weather.ts 와 같은 식으로** 뽑아
 * 씁니다(31방위 × 5/15/40km, 곡률 낙차 포함). Open-Meteo 를 부르면 "자료가
 * 다른 것"과 "표현이 성긴 것"이 섞여, 재고 싶은 것을 못 잽니다.
 *
 * 사용: node tools/shader-preview/build-far-terrain.js
 *       node tools/shader-preview/verify-far-terrain.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

/** 서울 도곡동 — 실기 보고가 온 자리. 사방에 2.6~20km 산이 있습니다. */
const LAT = 37.489130, LON = 127.043169;
const R_EARTH = 6371000, EYE_M = 1.6;
const WIDE_ZOOM = 10, WIDE_BLOCK = 5, WIDE_DIR = 'wide10';
/** 앱이 먼 지형·물마스크에 쓰는 성긴 패치 (60km 반경). */
const MASK_RADIUS_M = 60000, MASK_BLOCK = 3, MASK_DIR = 'wide-dogok';
const NEAR_BLOCK = 3, FIELD_FAR_M = 3000, NEAR_DIR = 'dem-dogok';
const BAND_DIST_KM = [5, 15, 40];
const BAND_SAMPLES = 31;          // weather.ts 와 같은 값
const AZIMUTHS = 24;              // 판정이 재는 방위 수

const get = (u) => new Promise((res, rej) => {
  https.get(u, r => {
    if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

async function fetchBlock(zoom, block, dir) {
  const t = D.lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = D.pickBlockOrigin(t.x, t.y, block);
  const demDir = path.join(PREVIEW, dir);
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) {
    const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, await get(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
  }
  return demDir;
}

(async () => {
  const nearZoom = D.demZoomForRadius(FIELD_FAR_M, LAT, NEAR_BLOCK);
  await fetchBlock(nearZoom, NEAR_BLOCK, NEAR_DIR);
  const wideDir = await fetchBlock(WIDE_ZOOM, WIDE_BLOCK, WIDE_DIR);
  const maskZoom = D.demZoomForRadius(MASK_RADIUS_M, LAT, MASK_BLOCK);
  await fetchBlock(maskZoom, MASK_BLOCK, MASK_DIR);

  const wide = D.makeCpuDem({ demDir: wideDir, zoom: WIDE_ZOOM, lat: LAT, lon: LON });
  const near = D.makeCpuDem({
    demDir: path.join(PREVIEW, NEAR_DIR), zoom: nearZoom, lat: LAT, lon: LON });
  // ⚠ 발밑은 앱과 같이 **촘촘한** DEM 이 정합니다 (TerrainField.groundAtEye).
  const obs = near.elevAtGround(0, 0);
  const eye = obs + EYE_M;
  const ang = (d, h) => (Math.atan2(h - eye - (d * d) / (2 * R_EARTH), d) * 180) / Math.PI;

  // ── 참조 실루엣 ────────────────────────────────────────────────────────────
  //
  // ⚠ **앱과 같은 자료를 같은 자리에서** 써야 합니다. 처음엔 참조를 전부
  // 성긴 DEM(줌 10, 화소 121m)으로 만들었는데, 화면의 3km 안은 촘촘한
  // DEM(줌 13, 화소 15m)으로 그립니다. 성긴 쪽은 봉우리를 깎으므로
  // (같은 자리 발밑이 59.8m 대 70.7m) 그 차이가 통째로 "결함"으로 나왔습니다
  // — 남서쪽에서 +4.4° 라는 값이 그것이었습니다. 자료 차이를 우리 결함으로
  // 읽는 전형적인 함정입니다.
  //
  // 그래서 촘촘한 패치 안(가장자리 여유 = (블록−1)/2 타일)은 촘촘한 것으로,
  // 그 밖만 성긴 것으로 짚습니다.
  const nearReachM = ((NEAR_BLOCK - 1) / 2) * D.tileSpanMetres(nearZoom, LAT) * 0.98;
  const elevAt = (e2, s2) => {
    const d = Math.hypot(e2, s2);
    if (d <= nearReachM) {
      const h = near.elevAtGround(e2, s2);
      if (h !== null) return h;
    }
    return wide.elevAtGround(e2, s2);
  };

  const 참조 = [];
  for (let i = 0; i < AZIMUTHS; i++) {
    const a = (i * 360) / AZIMUTHS, r = (a * Math.PI) / 180;
    const se = Math.sin(r), sn = -Math.cos(r);
    let best = -90;
    // 가까운 데는 촘촘히 훑습니다 — 25m 격자를 100m 간격으로 훑으면 봉우리를
    // 지나칠 수 있습니다.
    for (let d = 30; d <= 40000; d += (d < 3000 ? 20 : 100)) {
      const h = elevAt(se * d, sn * d);
      if (h === null) continue;
      const e = ang(d, h);
      if (e > best) best = e;
    }
    참조.push(+best.toFixed(4));
  }

  // ── 능선 띠에 넣을 값 — weather.ts 와 **같은 식** ──────────────────────────
  const bandAngles = BAND_DIST_KM.map(() => []);
  const waterFrac = [];
  for (let i = 0; i < BAND_SAMPLES; i++) {
    const a = (i * 360) / (BAND_SAMPLES - 1), r = (a * Math.PI) / 180;
    const se = Math.sin(r), sn = -Math.cos(r);
    for (let j = 0; j < BAND_DIST_KM.length; j++) {
      const d = BAND_DIST_KM[j] * 1000;
      const h = elevAt(se * d, sn * d);
      bandAngles[j].push(h === null ? 0 : +ang(d, h).toFixed(4));
    }
    waterFrac.push(0);
  }

  console.log(`발밑 ${obs.toFixed(1)}m · 눈 ${eye.toFixed(1)}m · 성긴 패치 줌 ${maskZoom}`);
  console.log(`참조 실루엣 ${Math.min(...참조).toFixed(2)}° ~ ${Math.max(...참조).toFixed(2)}°`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px}
 p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>먼 산이 제 높이로 그려지는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye,
         FAR_FIELD_NEAR_M, FAR_FIELD_FAR_M, FAR_FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createGroundPlane, setGroundHorizon, createTerrainBands,
         updateGroundColors, updateTerrainBands } from './app/components/SkyScene3D/TerrainRing.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, NEAR_DIR='${NEAR_DIR}', NEAR_BLOCK=${NEAR_BLOCK};
const FAR=${FIELD_FAR_M}, EYE=${EYE_M}, OBS=${obs};
const BAND_DIST=${JSON.stringify(BAND_DIST_KM)};
const BANDS=${JSON.stringify(bandAngles)}, WATER=${JSON.stringify(waterFrac)};
const 참조=${JSON.stringify(참조)}, AZIMUTHS=${AZIMUTHS};
const MASK_DIR='${MASK_DIR}', MASK_RADIUS_M=${MASK_RADIUS_M}, MASK_BLOCK=${MASK_BLOCK};

const W=64, H=512, FOV=20;   // 좁은 화각 — 세로 20° 에 512행 ≈ 25.6행/도
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

clearDemCache();
const patch=await loadDemPatch(LAT, LON, FAR, {renderer, loadTexture, block:NEAR_BLOCK,
  tileUrl:(z,x,y)=>\`./\${NEAR_DIR}/\${z}_\${x}_\${y}.png\`});
if(!patch) errors.push('패치 없음');

const scene=new THREE.Scene();
const ground=createGroundPlane(); setGroundHorizon(ground, OBS); scene.add(ground);
const maskPatch=await loadDemPatch(LAT, LON, MASK_RADIUS_M, {renderer, loadTexture,
  block:MASK_BLOCK, tileUrl:(z,x,y)=>\`./\${MASK_DIR}/\${z}_\${x}_\${y}.png\`});
if(!maskPatch) errors.push('성긴 패치 없음');

const field=createTerrainField({patch, eyePatch:patch, eyeHeightM:EYE});
field.mesh.renderOrder=-0.48; scene.add(field.mesh);

// 앱과 같은 배치 — 먼 지형은 성긴 패치, 발밑만 촘촘한 패치.
const far=createTerrainField({patch:maskPatch, eyePatch:patch, eyeHeightM:EYE,
  nearM:FAR_FIELD_NEAR_M, farM:FAR_FIELD_FAR_M, rings:FAR_FIELD_RINGS});
far.mesh.renderOrder=-0.49; scene.add(far.mesh);

// 옛 능선 띠도 그대로 둡니다 — 먼 지형이 없는 자리를 아직 얘가 받습니다.
const bands=createTerrainBands(BANDS, BAND_DIST, undefined, WATER, OBS);
scene.add(bands.group);

const cam=new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000);
cam.position.set(0,0,0);
updateTerrainFieldEye(field, cam);
const sky={r:0.30,g:0.34,b:0.44};
updateGroundColors(ground, 30, 0, {skyMean:sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
updateTerrainBands(bands, 30, {skyMean:sky, hazeAt:()=>sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
for (const h of [field, far]) { const u=h.material.uniforms;
  u.uSurfaceIrr.value.set(sky.r, sky.g, sky.b); u.uSunAltDeg.value=30;
  u.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85);
  updateTerrainFieldEye(h, cam); }

/** 행 → 고도각 (도). 카메라 기하로 손수 — 셰이더와 별개의 길입니다. */
const tanV=Math.tan(FOV*Math.PI/360);
function rowElev(y){ return Math.atan(tanV*(2*(y+0.5)/H-1))*180/Math.PI; }

const 측정=[];
for (let i=0;i<AZIMUTHS;i++){
  const a=(i*360)/AZIMUTHS, ar=a*Math.PI/180;
  cam.up.set(0,1,0); cam.lookAt(Math.sin(ar), 0, -Math.cos(ar)); cam.updateMatrixWorld(true);
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
  // ⚠ readRenderTargetPixels 는 아래에서 위로 줍니다. 행 y 의 고도각은
  //   rowElev(y) 그대로입니다(y=0 이 화면 아래 = 낮은 각).
  const x=W>>1;
  let top=-1;
  for(let y=H-1;y>=0;y--){ if(buf[(y*W+x)*4+3]>128){ top=y; break; } }
  측정.push(top<0 ? null : +rowElev(top).toFixed(4));
  if (i%6===0){ renderer.render(scene,cam);
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    c.style.width='32px'; c.style.height='256px';
    c.getContext('2d').drawImage(canvas,0,0);
    document.getElementById('shots').appendChild(c); }
}

const 오차=[];
for(let i=0;i<AZIMUTHS;i++) if(측정[i]!==null) 오차.push(측정[i]-참조[i]);
const mean=오차.reduce((a,b)=>a+b,0)/(오차.length||1);
const abs=오차.map(Math.abs).sort((a,b)=>a-b);
const 결과={ 방위수:AZIMUTHS, 잰방위:오차.length,
  치우침:+mean.toFixed(4),
  절대중앙값:+(abs[Math.floor(abs.length/2)]??0).toFixed(4),
  최대:+(abs[abs.length-1]??0).toFixed(4),
  참조, 측정 };

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'far-terrain.html'), html);
  console.log('생성 완료: far-terrain.html');
})();
