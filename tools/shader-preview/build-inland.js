/**
 * **내륙에서도 물이 보이는가** (사용자가 실기에서 잡아낸 결함).
 *
 * 실기 화면(서울 도곡동, 37.489130/127.043169, 해발 70m)에서 사방에 물이
 * 고여 보인다는 보고가 있었습니다. 그런데 이 저장소의 해안선 판정들은
 * **하나같이 바닷가 관측점(대부도)만** 썼습니다. "물이 없는 곳에서 물을
 * 그리지 않는가" 는 아무도 묻지 않았고, 그래서 이 결함은 판정을 전부
 * 통과한 채 실기까지 갔습니다. 이 하네스가 그 빠진 질문입니다.
 *
 * ## 재는 법 — 해수면 메쉬가 화면에서 이긴 화소를 셉니다
 *
 * 같은 장면을 두 번 찍습니다: ① 그대로, ② `seaPlane.visible=false`.
 * 두 장이 다른 화소가 곧 **해수면이 보이는 화소** 입니다. 색으로 "물 같다"
 * 를 추측하지 않고 깊이 겨루기 결과를 직접 읽는 것이라, 물색 조정에
 * 휘둘리지 않습니다.
 *
 * ## 대조 — 이 지표가 뜻이 있으려면
 *
 * 같은 자를 **바닷가(대부도 서안)** 에도 댑니다. 내륙에서 0 을 만들려고
 * 바다를 아예 지워 버리면 이 대조가 무너집니다. 즉 합격 조건은
 * "내륙 ≈ 0 **이면서** 바닷가는 여전히 큼" 입니다.
 *
 * 능선 띠는 합성입니다(수평선 아래로는 접히는 보수적인 값). 실제 서울은
 * 사방이 산이라 더 가려지겠지만, 여기서는 **가려 주는 것이 없을 때**
 * 해수면이 어디까지 비어져 나오는지를 봐야 하므로 이쪽이 맞습니다.
 *
 * 사용: node tools/shader-preview/build-inland.js
 *       node tools/shader-preview/shoot.js inland.html inland.png 30000
 *       node tools/shader-preview/verify-inland.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { makeCpuDem, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin } = require('./dem-cpu');

const BLOCK = 3;
const FIELD_FAR_M = 3000;
const EYE_M = 1.6;
const BAND_DIST_KM = [5, 15, 40];
const SAMPLES = 31;

/** 내륙(도곡동)과 바닷가(대부도 서안). 뒤쪽이 대조입니다. */
const SITES = [
  { key: '내륙', lat: 37.489130, lon: 127.043169, dir: 'dem-dogok', wide: 'wide-dogok' },
  { key: '바닷가', lat: 37.24102, lon: 126.55969, dir: 'dem', wide: 'wide-daebu' },
  // 강화 마니산 — **높은 바닷가**. 바다가 대부분 3km 격자 **밖**에 있어서,
  // "패치 가장자리 한 점만 보고 잇는" 식으로 고쳤다면 여기서 바다가
  // 통째로 사라졌을 자리입니다. 성긴 마스크가 진짜로 필요한 이유.
  { key: '높은바닷가', lat: 37.61553, lon: 126.4300, dir: 'dem-mani', wide: 'wide-mani' },
];

/** 물 마스크(성긴 60km 패치)도 같이 받아 둡니다 — 앱이 쓰는 것과 같은 반경. */
const SEA_MASK_RADIUS_M = 60000;

const get = (url) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode} ${url}`)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

(async () => {
  const prepared = [];
  for (const s of SITES) {
    const zoom = demZoomForRadius(FIELD_FAR_M, s.lat, BLOCK);
    const t = lonLatToTileFloat(s.lon, s.lat, zoom);
    const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);
    const demDir = path.join(PREVIEW, s.dir);
    fs.mkdirSync(demDir, { recursive: true });
    for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
      const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
      if (fs.existsSync(f)) continue;
      fs.writeFileSync(f, await get(
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
    }
    const wideZoom = demZoomForRadius(SEA_MASK_RADIUS_M, s.lat, BLOCK);
    const wt = lonLatToTileFloat(s.lon, s.lat, wideZoom);
    const wo = pickBlockOrigin(wt.x, wt.y, BLOCK);
    const wideDir = path.join(PREVIEW, s.wide);
    fs.mkdirSync(wideDir, { recursive: true });
    for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
      const f = path.join(wideDir, `${wideZoom}_${wo.originX + dx}_${wo.originY + dy}.png`);
      if (fs.existsSync(f)) continue;
      fs.writeFileSync(f, await get(
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${wideZoom}/${wo.originX + dx}/${wo.originY + dy}.png`));
    }
    const dem = makeCpuDem({ demDir, zoom, lat: s.lat, lon: s.lon });
    const obs = dem.elevAtGround(0, 0);
    console.log(`${s.key}: 줌 ${zoom} (마스크 줌 ${wideZoom}) · 발밑 ${obs.toFixed(2)}m`);
    prepared.push({ ...s, zoom, wideZoom, obs });
  }

  // 능선 띠는 수평선 아래로 접히는 보수적 합성값 (가려 주는 것이 없는 경우).
  const bandAngles = BAND_DIST_KM.map(() => Array(SAMPLES).fill(-999));
  const waterFrac = Array(SAMPLES).fill(0);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:960px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:3px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>내륙에서 물이 보이는가 — 해수면 메쉬가 이긴 화소</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';
import {
  createGroundPlane, setGroundHorizon, createTerrainBands, updateGroundColors, updateTerrainBands,
} from './app/components/SkyScene3D/TerrainRing.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const SITES=${JSON.stringify(prepared)};
const BAND_DIST=${JSON.stringify(BAND_DIST_KM)};
const BANDS=${JSON.stringify(bandAngles)}, WATER=${JSON.stringify(waterFrac)};
const FAR=${FIELD_FAR_M}, EYE=${EYE_M}, BLOCK=${BLOCK}, MASK_R=${SEA_MASK_RADIUS_M};

const W=256, H=512, FOV=70, PITCH=-8;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const bufA=new Uint8Array(W*H*4), bufB=new Uint8Array(W*H*4);

const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

/** 화면 행 → 고도각(도). 카메라를 PITCH 만큼 숙인 원근 투영 그대로. */
function rowElevDeg(y){
  const ty=Math.tan(FOV*Math.PI/360)*(2*(y+0.5)/H-1);
  const p=PITCH*Math.PI/180;
  const yy=ty*Math.cos(p)+Math.sin(p);
  return Math.asin(yy/Math.sqrt(ty*ty+1))*180/Math.PI;
}
const ELEV=[]; for(let y=0;y<H;y++) ELEV.push(rowElevDeg(y));

const 결과={};
for (const site of SITES) {
  clearDemCache();
  const patch=await loadDemPatch(site.lat, site.lon, FAR, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.dir}/\${z}_\${x}_\${y}.png\`});
  const maskPatch=await loadDemPatch(site.lat, site.lon, MASK_R, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.wide}/\${z}_\${x}_\${y}.png\`});
  if (!patch || !maskPatch) { errors.push(site.key+' 패치 없음'); continue; }

  const ground=createGroundPlane(); setGroundHorizon(ground, site.obs);
  const field=createTerrainField({patch, eyeHeightM:EYE}); field.mesh.renderOrder=-0.48;
  const sea=createSeaPlane({patch, maskPatch, eyeHeightM:EYE}); sea.mesh.renderOrder=-0.47;
  const scene=new THREE.Scene(); scene.add(ground); scene.add(field.mesh); scene.add(sea.mesh);
  const b=createTerrainBands(BANDS, BAND_DIST, undefined, WATER, site.obs);
  scene.add(b.group);

  const cam=new THREE.PerspectiveCamera(FOV, W/H, 0.1, 200000);
  cam.position.set(0,0,0);
  updateTerrainFieldEye(field, cam); updateSeaPlaneEye(sea, cam);

  const sky={r:0.30,g:0.34,b:0.44};
  updateGroundColors(ground, 30, 0, {skyMean:sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
  updateTerrainBands(b, 30, {skyMean:sky, hazeAt:()=>sky, betaMie:0.08, angstrom:1.3, elevScale:1.0});
  for (const m of [field.material, sea.material]) {
    m.uniforms.uSurfaceIrr.value.set(sky.r, sky.g, sky.b);
    m.uniforms.uSunAltDeg.value=30;
    m.uniforms.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85);
  }

  function shoot(azDeg){
    const a=azDeg*Math.PI/180, p=PITCH*Math.PI/180;
    cam.up.set(0,1,0);
    cam.lookAt(Math.sin(a)*Math.cos(p), Math.sin(p), -Math.cos(a)*Math.cos(p));
    cam.updateMatrixWorld(true);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
    renderer.readRenderTargetPixels(rt,0,0,W,H,bufA);
    sea.mesh.visible=false;
    renderer.clear(); renderer.render(scene,cam);
    renderer.readRenderTargetPixels(rt,0,0,W,H,bufB);
    sea.mesh.visible=true;
    renderer.setRenderTarget(null); renderer.render(scene,cam);
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    c.style.width='96px'; c.style.height='192px';
    c.getContext('2d').drawImage(canvas,0,0);
    document.getElementById('shots').appendChild(c);

    let 화소=0, 최대띠=0, 위=-90, 아래=90;
    for (let x=0;x<W;x++){
      let lo=1e9, hi=-1e9, n=0;
      for (let y=0;y<H;y++){
        const o=(y*W+x)*4;
        const diff = Math.abs(bufA[o]-bufB[o])+Math.abs(bufA[o+1]-bufB[o+1])
                   + Math.abs(bufA[o+2]-bufB[o+2])+Math.abs(bufA[o+3]-bufB[o+3]);
        if (diff>6){ n++; const e=ELEV[y]; if(e<lo) lo=e; if(e>hi) hi=e; }
      }
      화소+=n;
      if (n>0){ 최대띠=Math.max(최대띠, hi-lo); 위=Math.max(위,hi); 아래=Math.min(아래,lo); }
    }
    return {화소, 최대띠:+최대띠.toFixed(3), 위:+위.toFixed(3), 아래:+아래.toFixed(3)};
  }

  const shots=[0,90,180,270].map(shoot);
  // ⚠ 옛 지면 원반을 뺀 같은 장면. 원반은 눈 아래 0.5 에 놓인 **평평한 판**
  // 이라, 내려다보는 각에서는 깊이가 아주 작습니다(각 θ 에서 0.5/sin θ).
  // 새 지형·해수면은 반지름 120~470 에 있으므로 원반이 늘 더 가깝습니다 —
  // 즉 원반이 새 지형을 덮고 있을 수 있습니다. 덮고 있다면 이 둘의 차이가
  // 크게 납니다.
  ground.visible=false;
  const shotsNoDisc=[0,90,180,270].map(shoot);
  ground.visible=true;
  결과[site.key]={
    발밑: +site.obs.toFixed(2),
    총화소: shots.reduce((a,s)=>a+s.화소,0),
    전체화소: W*H*shots.length,
    최대띠: +Math.max(...shots.map(s=>s.최대띠)).toFixed(3),
    방위: shots,
    원반없이_총화소: shotsNoDisc.reduce((a,s)=>a+s.화소,0),
    원반없이_최대띠: +Math.max(...shotsNoDisc.map(s=>s.최대띠)).toFixed(3),
  };
  scene.remove(b.group); b.dispose(); field.dispose?.(); sea.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'inland.html'), html);
  console.log('생성 완료: inland.html');
})();
