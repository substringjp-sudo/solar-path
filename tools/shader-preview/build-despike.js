/**
 * **바다 한복판에 첨탑이 서지 않는가** (실기 보고: 대부도에 기괴하게 솟은 지형).
 *
 * 저줌 Terrarium 타일에는 R 채널이 한두 단계 어긋난 **화소 한 폭짜리 줄**이
 * 있습니다. 대부도 서쪽 6.6km 바다에서 이웃이 전부 0~31m 인데 한 열만
 * R = 128 → 125·134 로 튀어 −648m 와 **+1572m** 가 나왔고, 화면에는 고도각
 * **8.96°** 짜리 첨탑으로 섰습니다. 같은 방위의 99.9% 값은 0.87° 입니다.
 *
 * ## 재는 법
 *
 * 먼 지형 격자만 놓고 대부도에서 한 바퀴 돌며 **가장 높이 잡히는 고도각**을
 * 봅니다. 첨탑이 있으면 그 하나가 최댓값을 통째로 끌어올립니다.
 *
 * ## 대조 — "높은 것을 다 깎기" 가 통과하지 못하게
 *
 * ① **끄고 켠 짝.** `uDemDespike` 로 걷어내기를 껐다 켜서 같은 장면을 두 번
 *    찍습니다. 끄면 첨탑이 있어야 하고 켜면 없어야 합니다.
 * ② **진짜 산은 그대로.** 도곡동 24방위 실루엣(`verify-far-terrain.js` 와
 *    같은 자·같은 참조)을 걷어내기를 켠 채로 다시 재서, 오차가 안 나빠졌는지
 *    봅니다. 중앙값으로 늘 뭉개면 여기서 바로 걸립니다.
 *
 * 사용: node tools/shader-preview/build-despike.js
 *       node tools/shader-preview/verify-despike.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

const MASK_RADIUS_M = 60000, BLOCK = 3, EYE_M = 1.6, R_EARTH = 6371000;
const SITES = [
  { key: '대부도', lat: 37.24102, lon: 126.55969, near: 'dem', wide: 'wide-daebu' },
  { key: '도곡동', lat: 37.489130, lon: 127.043169, near: 'dem-dogok', wide: 'wide-dogok' },
];
const AZIMUTHS = 24;

const get = (u) => new Promise((res, rej) => {
  https.get(u, r => {
    if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

async function fetchBlock(lat, lon, zoom, block, dir) {
  const t = D.lonLatToTileFloat(lon, lat, zoom);
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
  const prepared = [];
  for (const s of SITES) {
    const nearZoom = D.demZoomForRadius(3000, s.lat, BLOCK);
    const wideZoom = D.demZoomForRadius(MASK_RADIUS_M, s.lat, BLOCK);
    await fetchBlock(s.lat, s.lon, nearZoom, BLOCK, s.near);
    const wideDir = await fetchBlock(s.lat, s.lon, wideZoom, BLOCK, s.wide);
    const near = D.makeCpuDem({ demDir: path.join(PREVIEW, s.near), zoom: nearZoom, lat: s.lat, lon: s.lon });
    const wide = D.makeCpuDem({ demDir: wideDir, zoom: wideZoom, lat: s.lat, lon: s.lon });
    const obs = near.elevAtGround(0, 0);
    const eye = obs + EYE_M;
    const ang = (d, h) => (Math.atan2(h - eye - (d * d) / (2 * R_EARTH), d) * 180) / Math.PI;

    // 참조: 이 방위에서 **성한 자료가 말하는** 가장 높은 고도각.
    // 튀는 화소를 CPU 쪽에서도 같은 규칙으로 걷어냅니다 — 대각선 중앙값에서
    // 200m 넘게 벗어나면 갈아 끼웁니다. 두 길이 독립이어야 뜻이 있으므로
    // 셰이더 코드를 부르지 않고 여기서 따로 구현합니다.
    const texel = D.tileSpanMetres(wideZoom, s.lat) / 256;
    const clean = (e2, s2) => {
      const h = wide.elevAtGround(e2, s2);
      if (h === null) return null;
      const q = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        .map(([a, b]) => wide.elevAtGround(e2 + a * texel, s2 + b * texel))
        .filter((v) => v !== null);
      if (q.length < 4) return h;
      q.sort((a, b) => a - b);
      const m = 0.5 * (q[1] + q[2]);
      return Math.abs(h - m) > 200 ? m : h;
    };
    // ⚠ 15° 간격 스물넷으로는 **첨탑을 놓칩니다.** 결함은 방위 280° 에
    // 있는데 15° 격자에는 270·285 밖에 없고, 좁은 화각으로 가운데 열만
    // 읽으면 5° 떨어진 첨탑이 화면 밖입니다. 처음에 그렇게 짜서 걷어내기를
    // 켜나 끄나 같은 값이 나왔습니다. 방위를 촘촘히(0.5°) 훑습니다.
    let 참조최대 = -90, 원본최대 = -90, 참조방위 = 0, 원본방위 = 0;
    for (let a = 0; a < 360; a += 0.5) {
      const r = (a * Math.PI) / 180, se = Math.sin(r), sn = -Math.cos(r);
      for (let d = 3000; d <= 55000; d += 150) {
        const raw = wide.elevAtGround(se * d, sn * d);
        if (raw !== null) { const e = ang(d, raw); if (e > 원본최대) { 원본최대 = e; 원본방위 = a; } }
        const h = clean(se * d, sn * d);
        if (h !== null) { const e = ang(d, h); if (e > 참조최대) { 참조최대 = e; 참조방위 = a; } }
      }
    }
    console.log(`${s.key}: 발밑 ${obs.toFixed(1)}m · 성긴 줌 ${wideZoom}`
      + ` · 원본 최대 ${원본최대.toFixed(2)}° @${원본방위}° · 걷어낸 최대 ${참조최대.toFixed(2)}° @${참조방위}°`);
    prepared.push({ ...s, nearZoom, wideZoom, obs,
      참조최대: +참조최대.toFixed(3), 참조방위, 원본최대: +원본최대.toFixed(3), 원본방위 });
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>바다 한복판에 첨탑이 서지 않는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye,
         FAR_FIELD_NEAR_M, FAR_FIELD_FAR_M, FAR_FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const SITES=${JSON.stringify(prepared)};
const MASK_R=${MASK_RADIUS_M}, BLOCK=${BLOCK}, EYE=${EYE_M}, AZIMUTHS=${AZIMUTHS};

// 넓은 화면으로 방위를 겹쳐 가며 훑고, **화면 전체**에서 가장 높은 지면
// 화소를 찾습니다. 화소마다 진짜 고도각을 카메라 기하로 계산합니다.
const W=384, H=384, FOV=24, SHOTS=18;   // 가로 화각 24° × 18장 = 432° (겹침)
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
const tanY=Math.tan(FOV*Math.PI/360);

const 결과={};
for (const site of SITES) {
  clearDemCache();
  const nearPatch=await loadDemPatch(site.lat, site.lon, 3000, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.near}/\${z}_\${x}_\${y}.png\`});
  const widePatch=await loadDemPatch(site.lat, site.lon, MASK_R, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.wide}/\${z}_\${x}_\${y}.png\`});
  if(!nearPatch||!widePatch){ errors.push(site.key+' 패치 없음'); continue; }

  const scene=new THREE.Scene();
  const cam=new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000); cam.position.set(0,0,0);
  const far=createTerrainField({patch:widePatch, eyePatch:nearPatch, eyeHeightM:EYE,
    nearM:FAR_FIELD_NEAR_M, farM:FAR_FIELD_FAR_M, rings:FAR_FIELD_RINGS, despike:true});
  scene.add(far.mesh); updateTerrainFieldEye(far, cam);
  const u=far.material.uniforms;
  u.uSurfaceIrr.value.set(0.30,0.34,0.44); u.uSunAltDeg.value=30; u.uAerial.value=0;
  u.uShadow.value=0;   // 그림자는 실루엣과 무관합니다

  function sweep(despike, label){
    u.uDemDespike.value = despike ? 1 : 0;
    let best=-90, bestAz=0;
    for (let i=0;i<SHOTS;i++){
      const azDeg=(i*360)/SHOTS, ar=azDeg*Math.PI/180;
      cam.up.set(0,1,0); cam.lookAt(Math.sin(ar), 0, -Math.cos(ar)); cam.updateMatrixWorld(true);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
      renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
      for (let x=0;x<W;x++){
        let top=-1;
        for(let y=H-1;y>=0;y--){ if(buf[(y*W+x)*4+3]>128){ top=y; break; } }
        if(top<0) continue;
        // 화소 → 카메라 로컬 방향 → 진짜 고도각 (원근 왜곡을 그대로 반영)
        const nx=(2*(x+0.5)/W-1)*tanY, ny=(2*(top+0.5)/H-1)*tanY;
        const e=Math.atan2(ny, Math.sqrt(nx*nx+1))*180/Math.PI;
        if(e>best){ best=e; bestAz=azDeg + Math.atan(nx)*180/Math.PI; }
      }
      if(i%6===0){ renderer.render(scene,cam);
        const c=document.createElement('canvas'); c.width=W; c.height=H;
        c.style.width='128px'; c.style.height='128px';
        c.getContext('2d').drawImage(canvas,0,0);
        const t=document.createElement('div'); t.style.font='10px monospace';
        t.textContent=site.key+' '+label+' 방위'+azDeg.toFixed(0)+'°';
        document.getElementById('shots').appendChild(t);
        document.getElementById('shots').appendChild(c); }
    }
    return { 최대:+best.toFixed(3), 방위:+((bestAz%360+360)%360).toFixed(1) };
  }

  const 끔=sweep(false,'끔'), 켬=sweep(true,'켬');
  결과[site.key]={
    발밑:+site.obs.toFixed(1),
    원본최대:site.원본최대, 원본방위:site.원본방위,
    참조최대:site.참조최대, 참조방위:site.참조방위,
    끔, 켬,
  };
  scene.remove(far.mesh); far.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'despike.html'), html);
  console.log('생성 완료: despike.html');
})();
