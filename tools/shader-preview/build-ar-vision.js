/**
 * **AR 화면 보정 자** (`src/utils/arVision.ts`) — 정답 자세로 카메라 화면을 그립니다.
 *
 * > "카메라에서 산이나 태양, 달이 인식되면 그걸 기준으로 보정하는 기능은 어떨까?"
 *
 * 기기가 없으니 앱의 렌더러가 카메라 대신입니다. 장소마다 **정답 자세**(방위·앙각·기울기)
 * 로 하늘·해·DEM 지형을 세로 화면(240×320, 가로 화각 60°)에 그려 `ar-vision.html` 로
 * 내보냅니다. 판정(`verify-ar-vision.js`)은 이 화면에 **일부러 틀린 센서 자세**를 붙여
 * 넘기고, 보정이 틀린 만큼을 되돌려 놓는지 잽니다.
 *
 * 장소:
 *   - 요네자와 분지(사방이 산) · 구례(지리산 골짜기) · 서울 도곡동(낮은 산과 도시)
 *   - 덕유산 정상(먼 능선이 지평선 **아래**)
 *   - 해운대(바다 — 지평선이 밋밋해 **방위를 못 푸는 것이 정답**인 대조)
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-ar-vision.js   (DEM 타일이 없으면 받습니다)
 *       node tools/shader-preview/verify-ar-vision.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { makeCpuDem, demZoomForRadius, lonLatToTileFloat, pickBlockOrigin } = require('./dem-cpu');

const BLOCK = 3, FINE_M = 3000, FAR_M = 60000, EYE_M = 1.6;
const W = 240, H = 320, HFOV = 60;

/**
 * 장소와 보는 자세들. `sun` 은 그 장면의 태양(고도, 방위) — 몇 장면은 화면 안에 둡니다.
 * 자세는 [방위, 앙각, 기울기].
 */
const SITES = [
  { key: 'yonezawa', name: '요네자와 분지', lat: 37.9116, lon: 140.1047,
    views: [[93, 2, 0], [200, 1, 3], [320, 3, -2], [30, 0, 1]], sun: [6, 100] },
  { key: 'gurye', name: '구례', lat: 35.2025, lon: 127.4630,
    views: [[60, 4, 0], [180, 3, -3], [300, 5, 2]], sun: [12, 175] },
  { key: 'dogok', name: '서울 도곡동', lat: 37.4863, lon: 127.0443,
    views: [[180, 2, 0], [0, 1, 2], [250, 2, -1]], sun: [3, 250] },
  { key: 'deogyu', name: '덕유산 정상', lat: 35.859745, lon: 127.746211,
    views: [[0, -3, 0], [120, -3, 2], [240, -4, -2]], sun: [8, 118] },
  { key: 'haeundae', name: '해운대 바다', lat: 35.1587, lon: 129.1604,
    // 방위 145~165° 는 ±35° 안이 모두 수평선(기복 0.01°)입니다 — 바다만 보이는 대조.
    views: [[155, 1, 0], [165, 0, 2]], sun: [8, 150] },
];

const get = (url) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode}`)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

async function fetchBlock(site, radiusM) {
  const zoom = demZoomForRadius(radiusM, site.lat, BLOCK);
  const t = lonLatToTileFloat(site.lon, site.lat, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);
  const dir = path.join(PREVIEW, `dem-arv-${site.key}`);
  fs.mkdirSync(dir, { recursive: true });
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const f = path.join(dir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (fs.existsSync(f)) continue;
    let buf;
    for (let tr = 0; tr < 4; tr++) {
      try { buf = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`); break; }
      catch (e) { if (tr === 3) throw e; await new Promise(r => setTimeout(r, 2000 * 2 ** tr)); }
    }
    fs.writeFileSync(f, buf);
  }
  return zoom;
}

(async () => {
  const cfg = [];
  for (const s of SITES) {
    const zFine = await fetchBlock(s, FINE_M);
    const zFar = await fetchBlock(s, FAR_M);
    const fine = makeCpuDem({ demDir: path.join(PREVIEW, `dem-arv-${s.key}`), zoom: zFine, lat: s.lat, lon: s.lon });
    const ground = fine.elevAtGround(0, 0);
    // 바다·물가면 DEM 이 음수일 수 있습니다 — 눈높이는 해수면 위로.
    const eyeM = Math.max(0, ground) + EYE_M;
    cfg.push({ ...s, zFine, zFar, eyeM, dir: `dem-arv-${s.key}` });
    console.log(`${s.name}: 줌 ${zFine}/${zFar} · 지면 ${ground.toFixed(1)}m · 눈 ${eyeM.toFixed(1)}m`);
  }
  fs.writeFileSync(path.join(PREVIEW, 'ar-vision.json'), JSON.stringify({ W, H, HFOV, FINE_M, FAR_M, BLOCK, sites: cfg }, null, 1));

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye, FAR_FIELD_NEAR_M, FAR_FIELD_FAR_M, FAR_FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createGroundPlane, setGroundHorizon, updateGroundColors } from './app/components/SkyScene3D/TerrainRing.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { makeAtmosphereParams, applyTuningUniforms } from './app/utils/atmosphere.js';
import { getTuning, setTuning } from './app/utils/skyTuning.js';
import { cameraBasis, intrinsicsFromHfov, project, dirFromAzEl } from './app/utils/arVision.js';

const errors=[];
{ const oe=console.error; console.error=(...a)=>{errors.push(a.map(String).join(' ').slice(0,300)); oe(...a);}; }
window.addEventListener('error', e=>errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e=>errors.push(String(e.reason&&e.reason.message||e.reason)));
const CFG=${JSON.stringify({ W, H, HFOV, FINE_M, FAR_M, BLOCK, sites: cfg })};
const {W,H,HFOV}=CFG;
const K=intrinsicsFromHfov(W,H,HFOV);
const BASE_EXPO=getTuning().displayExposure;
const VFOV=2*Math.atan((H/2)/K.fy)*180/Math.PI;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:false});
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
const gl=renderer.getContext();
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
// ENU → three (x=동, y=위, z=남)
const T=(v)=>new THREE.Vector3(v[0], v[2], -v[1]);
const out=[];
try {
for (const S of CFG.sites) {
  clearDemCache();
  const opts={renderer, loadTexture, block:CFG.BLOCK, tileUrl:(z,x,y)=>\`./\${S.dir}/\${z}_\${x}_\${y}.png\`};
  const patch=await loadDemPatch(S.lat, S.lon, CFG.FINE_M, opts);
  const maskPatch=await loadDemPatch(S.lat, S.lon, CFG.FAR_M, opts);
  if(!patch||!maskPatch){ errors.push(S.key+': 패치 없음'); continue; }
  const scene=new THREE.Scene();
  const atmosphere=makeAtmosphereParams({latitude:S.lat, observerElevM:S.eyeM, dayOfYear:268, humidityPct:60, visibilityM:30000});
  const sky=createSkydome(); scene.add(sky.mesh); updateSkydome(sky, S.sun[0], S.sun[1], atmosphere);
  // 앱은 하늘을 따로 합성해 해가 하늘 돔에 안 가립니다. 한 판에 그리는 여기서는 돔이 깊이를
  // 안 쓰게 해 같은 결과를 냅니다(처음엔 해가 돔 뒤로 숨어 해 찾기가 0/6 이었습니다).
  sky.mesh.material.depthWrite=false; sky.mesh.renderOrder=-10;
  const sun=createSun(); scene.add(sun.mesh); updateSun(sun, S.sun[0], S.sun[1], atmosphere, 1);
  const ground=createGroundPlane(); setGroundHorizon(ground, S.eyeM); scene.add(ground);
  const field=createTerrainField({patch, eyePatch:patch, eyeHeightM:1.6});
  field.mesh.renderOrder=-0.48; scene.add(field.mesh);
  const far=createTerrainField({patch:maskPatch, eyePatch:patch, eyeHeightM:1.6,
    nearM:FAR_FIELD_NEAR_M, farM:FAR_FIELD_FAR_M, rings:FAR_FIELD_RINGS});
  far.mesh.renderOrder=-0.49; scene.add(far.mesh);
  const skyMean={r:0.30,g:0.34,b:0.44};
  updateGroundColors(ground, S.sun[0], 0, {skyMean, betaMie:0.08, angstrom:1.3, elevScale:1.0});
  const cam=new THREE.PerspectiveCamera(VFOV, W/H, 0.1, 2000);
  cam.position.set(0,0,0);
  for (const h of [field, far]) { const u=h.material.uniforms;
    if (u.uSurfaceIrr) u.uSurfaceIrr.value.set(skyMean.r, skyMean.g, skyMean.b);
    if (u.uSunAltDeg) u.uSunAltDeg.value=S.sun[0];
    if (u.uHazeRadiance) u.uHazeRadiance.value.set(skyMean.r*0.7, skyMean.g*0.75, skyMean.b*0.85); }
  for (const [yaw,pitch,roll] of S.views) {
    const att={yawDeg:yaw, pitchDeg:pitch, rollDeg:roll};
    const b=cameraBasis(att);
    const m=new THREE.Matrix4().makeBasis(T(b.r), T(b.u), T(b.f).multiplyScalar(-1));
    cam.quaternion.setFromRotationMatrix(m); cam.updateMatrixWorld(true);
    updateTerrainFieldEye(field, cam); updateTerrainFieldEye(far, cam);
    // 카메라 자동노출 흉내 — 해가 화면 안이면 노출을 줄입니다(실제 폰도 그렇습니다).
    // 앱 표시 노출 그대로면 해 둘레 수십 화소가 전부 255 로 포화돼 원반을 못 가립니다.
    const spv=project(dirFromAzEl(S.sun[1], S.sun[0]), att, K);
    const sunIn=!!spv && spv.x>-20 && spv.x<W+20 && spv.y>-20 && spv.y<H+20;
    setTuning({displayExposure: BASE_EXPO*(sunIn?0.3:1)});
    scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
    renderer.render(scene, cam);
    const buf=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    // 위에서부터로 뒤집고 RGB 만
    const rgb=new Array(W*H*3);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=((H-1-y)*W+x)*4, o=(y*W+x)*3; rgb[o]=buf[i]; rgb[o+1]=buf[i+1]; rgb[o+2]=buf[i+2]; }
    // 지형 마스크 — 하늘·해를 끄고 자홍으로 비운 뒤 다시 그립니다. 판정이 이 마스크로
    // 지형 부분을 DEM 능선에 정확히 옮겨 붙인 화면을 따로 만듭니다(렌더 격자의 능선 오차를 뺀 자).
    sky.mesh.visible=false; sun.mesh.visible=false; renderer.setClearColor(0xff00ff,1);
    renderer.render(scene, cam);
    const mb=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,mb);
    sky.mesh.visible=true; sun.mesh.visible=true; renderer.setClearColor(0x000000,1);
    const mask=new Array(W*H);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=((H-1-y)*W+x)*4; mask[y*W+x]=(mb[i]===255&&mb[i+1]===0&&mb[i+2]===255)?0:1; }
    const sp=project(dirFromAzEl(S.sun[1], S.sun[0]), att, K);
    out.push({site:S.key, att, sun:{alt:S.sun[0], az:S.sun[1]}, sunPx:sp, rgb, mask});
  }
}
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__stats={glError:gl.getError(), frames:out, W, H, HFOV};
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
  fs.writeFileSync(path.join(PREVIEW, 'ar-vision.html'), html);
  console.log('생성 완료: ar-vision.html');
})().catch(e => { console.error(e); process.exit(1); });
