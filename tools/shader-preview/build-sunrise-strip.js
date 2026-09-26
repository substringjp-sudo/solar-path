/**
 * **해 뜨는 능선 위의 트인 띠** (§94) — 앱 합성기째 재현.
 *
 * > "아침에 지평선 너머까지 구름이 가득 찼고 … 해가 구름보다 앞에 위치하고 그 부분도
 * >  마치 태양이 구름 아래에 있는 것처럼 빛이 생겨."   — 2026-09-25 05:48, 요네자와
 *
 * `build-sunrise-ridge.js` 는 구름 슬랩만 그려서 "구름은 멀쩡하다" 까지만 말합니다. 화면에서
 * 띠가 생기려면 **구름은 잘렸는데 그 앞을 가릴 산이 안 그려진** 자리가 있어야 합니다. 그래서
 * 앱과 같은 층 배정·같은 합성기(`SceneComposer`)로 하늘·근거리/원거리 지형 격자·능선 밴드·
 * 태양·구름 슬랩을 함께 그립니다.
 *
 * 잽니다:
 *   - **그려진 능선** — 열마다 지형을 껐다 켜서 달라지는 가장 높은 행.
 *   - **트인 띠** — 그려진 능선 **위**에서, 슬랩 가림 끔이면 구름(알파 > 0.5)인데 켬이면
 *     비는(알파 < 0.1) 화소. 구름이 땅에 잘렸는데 그 땅이 화면에 없는 자리입니다.
 *   - **태양** — 태양을 껐다 켜서 그 자리 밝기가 바뀌면 보이는 것.
 *
 * 경우: 해 2.85°/92.9°(그 시각), 운량 저 20 · 중 90 · 상 95%(그 시각 예보), 카메라 방위 93°·
 * 피치 2°·세로 16°. 밴드는 앱처럼 31방위 × 5·15·40km 점 표본을 CPU DEM 으로 냅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-sunrise-ridge.js   (요네자와 DEM 타일을 받습니다)
 * 사용: node tools/shader-preview/build-sunrise-strip.js
 *       node tools/shader-preview/verify-sunrise-strip.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const { DEFAULT_ATMOS } = require('./app-lighting');
const D = require('./dem-cpu');

const cfgPath = path.join(PREVIEW, 'sunrise-ridge.json');
if (!fs.existsSync(cfgPath)) throw new Error('먼저 build-sunrise-ridge.js 를 돌리세요(DEM 타일)');
const CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const far = D.makeCpuDem({ demDir: path.join(PREVIEW, CFG.DIR), zoom: CFG.zFar, lat: CFG.LAT, lon: CFG.LON });
const fine = D.makeCpuDem({ demDir: path.join(PREVIEW, CFG.DIR), zoom: CFG.zFine, lat: CFG.LAT, lon: CFG.LON });
const OBS_M = +fine.elevAtGround(0, 0).toFixed(2);

// 앱과 같은 능선 밴드 — 31방위(0~360) × 5·15·40km **점** 표본, 곡률 빼고(weather.ts).
const R_EARTH = 6371000;
const DIST_KM = [5, 15, 40], N_AZ = 31;
const bandAngles = DIST_KM.map(() => []);
for (let i = 0; i < N_AZ; i++) {
  const az = (i * 360) / (N_AZ - 1);
  DIST_KM.forEach((dk, j) => {
    const d = dk * 1000, a = (az * Math.PI) / 180;
    const e = far.elevAtGround(Math.sin(a) * d, -Math.cos(a) * d) ?? 0;
    bandAngles[j].push((Math.atan2(e - OBS_M - (d * d) / (2 * R_EARTH), d) * 180) / Math.PI);
  });
}

const SUN_ALT = 2.85, SUN_AZ = 92.9, CAM_AZ = 93, CAM_PITCH = 2;
const COVER = [0.2, 0.9, 0.95];

const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainField, updateTerrainFieldEye, FAR_FIELD_FAR_M, FAR_FIELD_RINGS, FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createGroundPlane, setGroundHorizon, createTerrainBands, seaHorizonDipDeg, TERRAIN_MAX_ANGLE_DEG }
  from './app/components/SkyScene3D/TerrainRing.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
// 이름공간으로 가져옵니다 — 옛 코드(음성 대조)에는 LAYER_CELESTIAL 이 없습니다.
import * as SC from './app/components/SkyScene3D/SceneComposer.js';
const { createSceneComposer, assignLayer, LAYER_SOFT_SKY, LAYER_MID, LAYER_SOFT_CLOUD } = SC;
const LAYER_CELESTIAL = SC.LAYER_CELESTIAL;
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
const die = (m) => { errors.push(String(m)); window.__errors = errors; document.title = 'DONE::ERR'; };
window.addEventListener('error', e => die(e.message));
window.addEventListener('unhandledrejection', e => die(e.reason && e.reason.message || e.reason));

const CFG=${JSON.stringify(CFG)}, OBS_M=${OBS_M};
const BAND_ANGLES=${JSON.stringify(bandAngles)}, BAND_DIST=${JSON.stringify(DIST_KM)};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ}, CAM_AZ=${CAM_AZ}, CAM_PITCH=${CAM_PITCH};
const COVER=${JSON.stringify(COVER)}, ATMOS=${JSON.stringify(DEFAULT_ATMOS)};
const W=320, H=320, FOVY=16, EYE=1.6;
const D2R = Math.PI/180;
const dirOf = (alt, az) => new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R), Math.sin(alt*D2R), -Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();

const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0x000000,1);
const gl = r.getContext();
const loadTexture = u => new Promise((res,rej) => { new THREE.TextureLoader().load(u,res,undefined,rej); });
clearDemCache();
const opts = { renderer: r, loadTexture, block: CFG.BLOCK, tileUrl:(z,x,y)=>\`./\${CFG.DIR}/\${z}_\${x}_\${y}.png\` };
const patch = await loadDemPatch(CFG.LAT, CFG.LON, CFG.FINE_M, opts);
const maskPatch = await loadDemPatch(CFG.LAT, CFG.LON, CFG.FAR_M, opts);
if (!patch || !maskPatch) die('패치 없음');

const atmosphere = makeAtmosphereParams({ latitude: CFG.LAT, observerElevM: OBS_M, dayOfYear: 268, humidityPct: 70, visibilityM: 25000 });
const scene = new THREE.Scene();
const sky = createSkydome(); scene.add(sky.mesh); updateSkydome(sky, SUN_ALT, SUN_AZ, atmosphere);
const ground = createGroundPlane(); setGroundHorizon(ground, OBS_M); scene.add(ground);
// 앱(SkyScene3D)과 같은 짝: 촘촘한 것 · 발밑용 · 성긴 것(먼 지형 격자).
// 앱(SkyScene3D 858행)과 같은 격자 하나 — 발밑부터 55km, 고리 FIELD_RINGS + FAR_FIELD_RINGS.
const field = createTerrainField({ eyeHeightM: EYE, farM: FAR_FIELD_FAR_M, rings: FIELD_RINGS + FAR_FIELD_RINGS,
  patch, eyePatch: patch, farPatch: maskPatch });
field.mesh.renderOrder = -0.48;
scene.add(field.mesh);
const bands = createTerrainBands(BAND_ANGLES, BAND_DIST, undefined, null, OBS_M); scene.add(bands.group);
const sun = createSun(); scene.add(sun.mesh); updateSun(sun, SUN_ALT, SUN_AZ, ATMOS, 1);
const slab = createCloudSlab(); scene.add(slab.mesh);
slab.setLayerAltitudesKm(1.5, 4.5, 10.0);
slab.setDemPatches(patch, maskPatch, r);
slab.setBandHorizon(BAND_ANGLES, BAND_DIST, TERRAIN_MAX_ANGLE_DEG, seaHorizonDipDeg(OBS_M));
bakeCloudSlabCoverage(slab, () => ({ low: COVER[0], mid: COVER[1], high: COVER[2], confidence: 1 }));

assignLayer(sky.mesh, LAYER_SOFT_SKY);
for (const o of [ground, field.mesh, bands.group]) assignLayer(o, LAYER_MID);
// 앱과 같이 — 천체는 구름 아래 층(§94). 옛 코드에는 이 층이 없어 MID 로 갑니다(대조용).
assignLayer(sun.mesh, LAYER_CELESTIAL ?? LAYER_MID);
assignLayer(slab.mesh, LAYER_SOFT_CLOUD);
// 앱(SkyScene3D)과 같이 — 새 코드면 구름을 두 번에 나눠 그립니다(§96).
if (slab.setSplitPasses && SC.LAYER_SOFT_CLOUD_BELOW) {
  slab.setSplitPasses(true);
  slab.mesh.renderOrder = -0.49; slab.meshBelow.renderOrder = 0.5;
  scene.add(slab.meshBelow); assignLayer(slab.meshBelow, SC.LAYER_SOFT_CLOUD_BELOW);
}

const cam = new THREE.PerspectiveCamera(FOVY, W/H, 0.1, 1000); cam.position.set(0,0,0);
{ const v = dirOf(CAM_PITCH, CAM_AZ); cam.lookAt(v.x, v.y, v.z); cam.updateMatrixWorld(true); }
updateTerrainFieldEye(field, cam);
const composer = createSceneComposer(W, H);
// ?scale=1 이면 한 번에 그리는 경로(빠른 기기)로 — 판정이 두 경로를 다 봅니다.
const SCALE = Number(new URLSearchParams(location.search).get('scale') || 2);
composer.setSoftScale(SCALE);
composer.setGodRays({ strength: 0 });
composer.setSun(dirOf(SUN_ALT, SUN_AZ), SUN_ALT);

function slabUpdate(dataOut, occludeSky){
  slab.material.uniforms.uTerrainOccludeSky.value = occludeSky ? 1 : 0;
  const s = composer.softScale > 1.0001 ? composer.softSize() : { width: W, height: H };
  const wd = { speedKmh: 0, bearingDeg: 0 };
  updateCloudSlab(slab, { camera: cam, widthPx: dataOut ? W : s.width, heightPx: dataOut ? H : s.height,
    sunDir: dirOf(SUN_ALT, SUN_AZ), sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor: (k) => beamAtAltitude(SUN_ALT, k, atmosphere), atmosphere,
    layerWinds: { low: wd, mid: wd, high: wd }, driftHours: 0, visible: true, dataOut });
}
const buf = new Uint8Array(W*H*4);
function shot(){ composer.render(r, scene, cam); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf); return buf.slice(); }
// 슬랩만, 알파 자료(자료 2)로 — 합성기 없이 원해상도.
function slabAlpha(occludeSky){
  const only = new THREE.Scene(); only.add(slab.mesh);
  const pm = slab.material.uniforms.uPassMode ? slab.material.uniforms.uPassMode.value : null;
  if (pm !== null) slab.material.uniforms.uPassMode.value = 0;
  slabUpdate(2, occludeSky);
  const rt = new THREE.WebGLRenderTarget(W, H);
  // ⚠ 슬랩은 LAYER_SOFT_CLOUD 에 배정돼 있어 카메라 기본 레이어(0)로는 **안 그려집니다**.
  //   처음에 이걸 빠뜨려 알파가 전부 0 이었고, "트인 띠 0" 이 헛돌았습니다.
  const mask = cam.layers.mask; cam.layers.enableAll();
  r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(only, cam);
  cam.layers.mask = mask;
  const b = new Uint8Array(W*H*4); r.readRenderTargetPixels(rt, 0, 0, W, H, b);
  r.setRenderTarget(null); r.setClearColor(0x000000, 1); rt.dispose();
  if (pm !== null) slab.material.uniforms.uPassMode.value = pm;
  scene.add(slab.mesh);
  return b;
}
const lum = (b, i) => (b[i] + b[i+1] + b[i+2]) / 3;
const tanV = Math.tan(FOVY * D2R / 2);
const rowElev = yRead => Math.atan(tanV * ((2*(yRead+0.5)/H) - 1)) / D2R + CAM_PITCH;  // readPixels 행(아래 0)

// 1) 그려진 능선 — 열마다 (지형 켬 − 끔) 이 다른 가장 높은 행. 구름·태양은 끕니다.
slab.mesh.visible = false; sun.mesh.visible = false;
field.mesh.visible = true; bands.group.visible = true; ground.visible = true;
const withT = shot();
field.mesh.visible = false; bands.group.visible = false; ground.visible = false;
const noT = shot();
field.mesh.visible = true; bands.group.visible = true; ground.visible = true;
const ridgeRow = new Int32Array(W).fill(-1);
for (let x = 0; x < W; x++) for (let y = H-1; y >= 0; y--) {
  const i = (y*W+x)*4;
  if (Math.abs(lum(withT, i) - lum(noT, i)) > 4) { ridgeRow[x] = y; break; }
}

// 2) 트인 띠 — 그려진 능선 위에서 구름이 땅에 잘렸는데(가림 끔 알파 > 0.5, 켬 < 0.1) 화면엔 땅이 없는 자리.
slab.mesh.visible = true;
const aOn = slabAlpha(true), aOff = slabAlpha(false);
let strip = 0, above = 0, stripCols = 0;
const stripTopDeg = [];
for (let x = 0; x < W; x++) {
  let colStrip = 0, top = -90;
  for (let y = Math.max(0, ridgeRow[x] + 1); y < H; y++) {
    const i = (y*W+x)*4; above++;
    if (aOff[i+3] > 127 && aOn[i+3] < 26) { colStrip++; top = Math.max(top, rowElev(y)); }
  }
  if (colStrip) { stripCols++; strip += colStrip; stripTopDeg.push(top - rowElev(ridgeRow[x])); }
}

// 3) 태양 — 구름·지형 다 켠 합성 화면에서 태양을 껐다 켭니다.
slabUpdate(0, true);
sun.mesh.visible = false; const noSun = shot();
sun.mesh.visible = true;  const withSun = shot();
const sp = dirOf(SUN_ALT, SUN_AZ).clone().project(cam);
const sx = Math.round((sp.x+1)/2*W - 0.5), sy = Math.round((sp.y+1)/2*H - 0.5);
let sunDelta = 0;
for (let dy=-3; dy<=3; dy++) for (let dx=-3; dx<=3; dx++) {
  const x=sx+dx, y=sy+dy; if (x<0||x>=W||y<0||y>=H) continue;
  sunDelta = Math.max(sunDelta, lum(withSun,(y*W+x)*4) - lum(noSun,(y*W+x)*4));
}
// 태양이 밝히는 화소(켬 − 끔 > 8) — 그 자리의 구름 알파·고도·그려진 능선
const sunLit = [];
for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
  const i=(y*W+x)*4, d=Math.max(Math.abs(withSun[i]-noSun[i]),Math.abs(withSun[i+1]-noSun[i+1]),Math.abs(withSun[i+2]-noSun[i+2]));
  if (d > 8) sunLit.push([+rowElev(y).toFixed(2), aOn[i+3], +(aOn[i]/255*40).toFixed(1), +d.toFixed(0), ridgeRow[x]>=0 ? +rowElev(ridgeRow[x]).toFixed(2) : null]);
}
const sunCol = Math.min(W-1, Math.max(0, sx));
const ridgeAtSun = ridgeRow[sunCol] >= 0 ? rowElev(ridgeRow[sunCol]) : null;

stripTopDeg.sort((a,b)=>a-b);
window.__stats = { glError: gl.getError(), obsM: OBS_M,
  띠화소: strip, 띠열: stripCols, 능선위화소: above,
  띠높이_중앙: stripTopDeg.length ? stripTopDeg[Math.floor(stripTopDeg.length/2)] : 0,
  띠높이_최대: stripTopDeg.length ? stripTopDeg[stripTopDeg.length-1] : 0,
  태양화소: sunLit.length, 태양화소_표본: sunLit.filter((_,k)=>k%Math.max(1,Math.floor(sunLit.length/12))===0),
  해: { x: sx, y: sy, 밝기차: sunDelta, 그려진능선: ridgeAtSun, 해고도: SUN_ALT } };
// 눈으로 볼 판 — 합성 화면(태양 켬 · 태양 끔 · 구름 끔)
window.__image = Array.from(withSun);
window.__imageNoSun = Array.from(noSun);
slab.mesh.visible = false; sun.mesh.visible = true;
window.__imageNoCloud = Array.from(shot());
sun.mesh.visible = false;
window.__imageNoCloudNoSun = Array.from(shot());
slab.mesh.visible = true; sun.mesh.visible = true;
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'sunrise-strip.html'), html);
console.log(`생성 완료: sunrise-strip.html (발밑 ${OBS_M}m)`);
