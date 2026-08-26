/**
 * **지형 표현 전/후 A/B** (docs/GROUND_PLAN.md 3단계).
 *
 * ## 왜 A/B인가
 *
 * `build-horizon-preview.js`는 요소를 하나씩 빼가며 "무엇이 그려지는지" 캐는
 * 진단용이라, 화면만 봐서는 **무엇이 나아졌는지** 읽히지 않습니다. 여기서는
 * 같은 장면·같은 카메라로 **예전 방식과 지금 방식을 나란히** 놓습니다.
 *
 *   왼쪽  예전: `createTerrainRing` — 5·15·40km 지형각을 최댓값 하나로 뭉갠
 *               띠 하나, 8°로 잘림, 대기 투시 없음
 *   오른쪽 지금: `createTerrainBands` — 거리대마다 링 하나, 25°까지, 각각
 *               자기 거리의 대기 투시
 *
 * 카메라는 진단용(-6°로 내려다보기)이 아니라 **실제로 하늘을 볼 때의 시점**
 * 입니다 — 지평선이 화면 아래쪽 1/3에 오도록.
 *
 * ## 합성 지형
 *
 * 겹침이 보이려면 거리대마다 다른 능선이 있어야 합니다. 실제 지형이 그렇듯
 * 가까울수록 낮고(언덕) 멀수록 높게(산맥) 둡니다 — 가까운 언덕이 낮으면
 * 뒤의 산이 보이고, 그 겹침이 곧 깊이 단서입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-terrain-ab-preview.js
 *       node tools/shader-preview/shoot.js terrain-ab.html terrain-ab.png
 *       node tools/shader-preview/verify-terrain-bands.js
 */
const fs = require('fs');
const path = require('path');
const PREVIEW =
  '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';

const SUN_ALT = 5;
const SUN_AZ = 270;
// ⚠ 화각을 좁게 잡습니다. 실제 지형각은 **몇 도**뿐입니다 — 1000m 산이
// 5km에서 11.3°, 15km에서 3.8°, 40km에서 1.4°. 넓은 화각으로 찍으면
// 능선이 몇 픽셀이라 아무것도 안 보입니다. 그게 거짓이라서가 아니라 실제로
// 그만큼 작기 때문이고, 여기서는 **보이는 배율로** 확대해 보여 줍니다.
const VIEW_ELEV = 1.2;
const FOV_DEG = 14;
const TW = 420, TH = 380;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 3 + 30}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>지형 표현 전/후 — 지평선 확대 (화각 ${FOV_DEG}°, 태양 고도 ${SUN_ALT}°, 서쪽)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, createTerrainBands,
         updateTerrainColors, updateGroundColors, updateTerrainBands }
  from './app/components/SkyScene3D/TerrainRing.js';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, angularSeparationDeg }
  from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const SUN_ALT = ${SUN_ALT}, SUN_AZ = ${SUN_AZ}, VIEW_ELEV = ${VIEW_ELEV};
const FOV_DEG = ${FOV_DEG}, TW = ${TW}, TH = ${TH};

const canvas = document.getElementById('c');
canvas.width = TW * 3; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(TW * 3, TH, false);

const atmosphere = makeAtmosphereParams({
  visibilityM: 25000, humidityPct: 60, latitude: 37.5, dayOfYear: 214 });

// ── 합성 지형 ───────────────────────────────────────────────────────────────
//
// ⚠ **각도가 아니라 높이에서 출발해야 합니다.** 처음에 거리대별 각도를 손으로
// 정했더니 40km에 8.9°(= 높이 6.3km)짜리 산이 생겼습니다. 실제로는 먼 산일수록
// 각이 **작습니다** — 1000m 산이 5km에서 11.3°, 15km에서 3.8°, 40km에서 1.4°.
//
// 그래서 실제 지평선은 비슷한 각도의 낮은 능선이 여러 겹 겹친 모습이고,
// 겹침은 **크기가 아니라 연무 대비**로 읽힙니다. 그게 3단계의 주장입니다.
const SAMPLES = 31;
const DIST = [5, 15, 40];
// 높이(m): 가까운 언덕, 중간 산, 먼 산맥
const HEIGHT = [
  (t) => 140 + 110 * Math.sin(t * 7.0 + 0.4),   // 가까운 언덕 (5km)
  (t) => 520 + 320 * Math.sin(t * 4.0 + 1.9),   // 중간 산 (15km)
  (t) => 1300 + 600 * Math.sin(t * 2.0 + 2.7),  // 먼 산맥 (40km)
];
const bandAngles = DIST.map((d, j) => {
  const out = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const h = Math.max(0, HEIGHT[j](t));
    out.push(Math.atan2(h, d * 1000) * 180 / Math.PI);
  }
  return out;
});
// 예전 방식이 쓰던 입력: 거리대 최댓값 하나
const panoramic = [];
for (let i = 0; i < SAMPLES; i++) {
  panoramic.push(Math.max(bandAngles[0][i], bandAngles[1][i], bandAngles[2][i]));
}

const sky = createSkydome();
const ground = createGroundPlane();
const oldRing = createTerrainRing(panoramic);              // 예전 (8° 상한)
// **출하 상태 재현**: 예전 재질은 FrontSide 였고, 안쪽에서 보는 원통이라
// 통째로 컬링돼 한 번도 안 보였습니다. 그 상태를 그대로 한 컷 남깁니다.
const shipped = createTerrainRing(panoramic);
shipped.material = new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.FrontSide, depthWrite: true });
shipped.geometry = oldRing.geometry;
const newBands = createTerrainBands(bandAngles, DIST);     // 지금

updateSkydome(sky, SUN_ALT, SUN_AZ, atmosphere, 1.0);
updateTerrainColors(oldRing, SUN_ALT, SUN_AZ, 0, atmosphere.betaMie);

// 하늘 조도 (코사인 가중) — 앱과 같은 방식
let sr = 0, sg = 0, sb = 0, sw = 0;
for (const e of [10, 30, 50, 75]) {
  const w = Math.sin(e * Math.PI / 180);
  for (let a = 0; a < 6; a++) {
    const az = (a * 360) / 6;
    const L = skyRadiance(e, angularSeparationDeg(az, e, SUN_AZ, SUN_ALT), SUN_ALT, atmosphere);
    sr += L.r * w; sg += L.g * w; sb += L.b * w; sw += w;
  }
}
const skyMean = { r: sr / sw, g: sg / sw, b: sb / sw };
const beam = beamAtAltitude(SUN_ALT, 0, atmosphere);
// 연무 색 = **방위별** 지평선 하늘. 먼 능선이 자기 뒤 하늘에 잠깁니다.
const hazeAt = (az, elev) =>
  skyRadiance(elev, angularSeparationDeg(az, elev, SUN_AZ, SUN_ALT), SUN_ALT, atmosphere);

updateGroundColors(ground, SUN_ALT, 0, {
  skyMean, beam, sunTransmittance: 1, sunAzimuthDeg: SUN_AZ });
updateTerrainBands(newBands, SUN_ALT, {
  skyMean, hazeAt, beam, sunTransmittance: 1,
  betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom, elevScale: atmosphere.elevScale });

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);
cam.up.set(0, 1, 0);
const er = VIEW_ELEV * Math.PI / 180, ar = SUN_AZ * Math.PI / 180;
cam.lookAt(100 * Math.cos(er) * Math.sin(ar), 100 * Math.sin(er), -100 * Math.cos(er) * Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

const tanHalf = Math.tan(FOV_DEG * Math.PI / 360);
const m = cam.matrixWorld.elements;
const up = new THREE.Vector3(m[4], m[5], m[6]);
const fwd = new THREE.Vector3(-m[8], -m[9], -m[10]);
const elevOfRow = (py) => {
  const ny = ((py + 0.5) / TH) * 2 - 1;
  const d = fwd.clone().addScaledVector(up, ny * tanHalf).normalize();
  return Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
};

function shoot(build, label, x, bare, skyOnly) {
  const scene = new THREE.Scene();
  if (!bare) { if (!skyOnly) scene.add(ground); scene.add(sky.mesh); }
  build(scene);

  renderer.setClearColor(0x000000, 1);
  renderer.setViewport(x, 0, TW, TH);
  renderer.setScissor(x, 0, TW, TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);
  const b = new Uint8Array(4 * TW * TH);
  gl.readPixels(x, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, b);

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 10) + 'px'; d.style.top = '34px';
  d.textContent = label;
  labels.appendChild(d);
  return b;
}

// ⚠ 진단 컷을 **먼저** 찍습니다. 같은 뷰포트에 그리므로 나중 것이 화면에
// 남는데, 사람이 보는 것은 합성 컷이어야 합니다.
const 출하만 = shoot(s => s.add(shipped), '', 0, true);
const 예전만 = shoot(s => s.add(oldRing), '', TW, true);
const 지금만 = shoot(s => s.add(newBands.group), '', TW * 2, true);

const 출하 = shoot(s => s.add(shipped), '출하 상태 — 지형이 컬링돼 안 보임', 0);
const 예전 = shoot(s => s.add(oldRing), '컬링만 고침 — 띠 하나, 8° 상한', TW);
const 지금 = shoot(s => s.add(newBands.group), '지금 — 거리대 3개, 25°까지, 대기 투시', TW * 2);
const nonBlack = (buf) => { let n = 0; for (let i = 0; i < TW * TH; i++) if (buf[i*4] + buf[i*4+1] + buf[i*4+2] > 6) n++; return n; };

// ── 무엇이 달라졌는지 수치로 ───────────────────────────────────────────────
//
// 3단계의 주장은 "먼 능선일수록 하늘색에 가깝다"입니다. 그러니 거리대마다
// **혼자 그린 컷**과 **하늘만 그린 컷**의 색 차이를 재면 그대로 검증됩니다.
// 먼 거리대일수록 차이가 작아야 합니다.
const lum = (buf, px, py) => {
  const p = (py * TW + px) * 4;
  return 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2];
};

// 하늘만 (지형·지면 없이)
const 하늘만 = shoot(() => {}, '', 0, false, true);

function bandContrast(buf) {
  // ⚠ **지평선 위만** 봅니다. 띠는 셋 다 -30°까지 내려오므로, 전체를 재면
  // 지평선 아래(하늘만 컷에서는 스카이돔 아래쪽 반구)가 측정을 지배해
  // 거리 순서가 거꾸로 나옵니다 — 실제로 그렇게 나왔습니다 (40km가 가장
  // 대비 높음). 능선이 사는 곳은 지평선 바로 위입니다.
  let sum = 0, n = 0;
  for (let py = 0; py < TH; py++) {
    if (elevOfRow(py) < 0.2) continue;
    for (let px = 0; px < TW; px += 3) {
      const a = lum(buf, px, py), b = lum(하늘만, px, py);
      if (Math.abs(a - b) < 1) continue;
      sum += Math.abs(a - b); n++;
    }
  }
  return { 평균대비: n ? +(sum / n).toFixed(1) : 0, 픽셀: n };
}

// 거리대를 하나씩만 그려 봅니다.
//
// ⚠ scene.add(band.mesh) 로 하면 안 됩니다. THREE는 메시를 새 부모에
// 붙이면서 **원래 그룹에서 떼어냅니다.** 그러면 이 루프가 끝난 뒤
// newBands.group 이 비어, 마지막 합성 컷에 지형이 하나도 안 나옵니다
// (실제로 그렇게 나왔습니다). 부모는 그대로 두고 가시성만 토글합니다.
const perBand = newBands.bands.map(target => {
  for (const b of newBands.bands) b.mesh.visible = (b === target);
  const buf = shoot(s => s.add(newBands.group), '', TW * 2, false);
  return { 거리km: target.distanceKm, ...bandContrast(buf) };
});
for (const b of newBands.bands) b.mesh.visible = true;

// 화면에 남을 컷은 마지막에 다시 찍습니다.
shoot(s => s.add(shipped), '출하 상태 — 지형이 컬링돼 안 보임', 0);
shoot(s => s.add(oldRing), '컬링만 고침 — 띠 하나, 8° 상한', TW);
shoot(s => s.add(newBands.group), '지금 — 거리대 3개, 25°까지, 대기 투시', TW * 2);

const glErr = gl.getError();
window.__stats = {
  glError: glErr,
  입력최고지형각: +Math.max(...panoramic).toFixed(2),
  거리대별입력최고각: bandAngles.map((a, j) => ({ 거리km: DIST[j], 최고각: +Math.max(...a).toFixed(2) })),
  검은배경_출하만_픽셀: nonBlack(출하만),
  검은배경_예전만_픽셀: nonBlack(예전만),
  검은배경_지금만_픽셀: nonBlack(지금만),
  거리대별_하늘대비: perBand,
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'terrain-ab.html'), html);
console.log('생성 완료: terrain-ab.html');
