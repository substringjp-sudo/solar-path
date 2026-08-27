/**
 * **박명광선 훑기** — 세기를 고르고, 광선이 실제로 *방향을 가지는지* 잽니다.
 *
 * 방사형 블러는 눈으로 보면 늘 "뭔가 밝아졌다"로 보입니다. 그것만으로는
 * 광선인지 그냥 화면을 밝힌 것인지 구분되지 않습니다. 그래서 **이방성**을
 * 잽니다 — 태양 둘레 고리에서 밝기가 지름 방향으로는 완만하고 접선 방향으로는
 * 급하게 변해야 살이 선 것입니다. 등방적으로 밝아졌다면 비는 1 근처입니다.
 *
 * 밤 두 칸은 **광선이 밤을 건드리지 않는지**를 봅니다. 별은 점이라 조금만
 * 번져도 티가 나고, 달은 밝아서 마스크가 없으면 태양 쪽으로 끌려옵니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-godray-sweep.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 460, TH = 440;
const VIEW_AZ = 268, VIEW_ELEV = 10, FOV_DEG = 58;
const SUN_AZ = 268;
const SUN_NIGHT = -14;
const SUN_HIGH = 16;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 6 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.8);
   padding:5px 8px;border-radius:5px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>박명광선 — 1~4칸: 세기 훑기 (태양 +2°) &nbsp;|&nbsp; 5칸: 해가 높을 때 &nbsp;|&nbsp; 6칸: 밤 — 뒤 두 칸은 <b>꺼져 있어야</b> 합니다</h3>
<p class="sub">그늘을 <b>곱합니다</b>. 더하는 교과서식은 이 파이프라인(LDR)에서 포화만 늘렸습니다 — 이방성 1.075→0.991, 포화 6.1%→12.9%.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createStarField, updateStarField, computeEquToHorizon }
  from './app/components/SkyScene3D/StarField.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { createMoonGroup, updateMoonPosition } from './app/components/SkyScene3D/MoonMesh.js';
import {
  createSceneComposer, assignLayer, DEFAULT_BLOOM, DEFAULT_GOD_RAYS,
  LAYER_SOFT_SKY, LAYER_MID, LAYER_SOFT_CLOUD, LAYER_FRONT,
} from './app/components/SkyScene3D/SceneComposer.js';
import { PRESET_OPTICS, blendedOpticsFromWeather } from './app/utils/cloudPresets.js';
import { WeatherFan, buildSkyColumns, solveColumnOptics, solveDirectionalShade,
         PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, skyRadiance, applyCloudDimming,
         angularSeparationDeg } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV};
const SUN_AZ=${SUN_AZ}, SUN_NIGHT=${SUN_NIGHT}, SUN_HIGH=${SUN_HIGH};
const SUN_DAY = 2.0;

const canvas = document.getElementById('c');
canvas.width = TW*6; canvas.height = TH;
const ctx2d = canvas.getContext('2d');

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();

// ── 하늘 ────────────────────────────────────────────────────────────────
const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240, betaMie: 0.09, humidityPct: 66,
});
const skydome = createSkydome();
scene.add(skydome.mesh);
assignLayer(skydome.mesh, LAYER_SOFT_SKY);

// ── 별 ──────────────────────────────────────────────────────────────────
const stars = createStarField();
scene.add(stars.points);
assignLayer(stars.points, LAYER_MID);

// ── 태양 ────────────────────────────────────────────────────────────────
//
// ⚠ 처음 이 습작을 짤 때 태양 원반을 빼먹었습니다. 하늘·별·구름만 있는
// 화면에서 방사형 블러를 돌리니 밝은 구름밭이 통째로 번져 "광선이 아니라
// 그냥 밝아졌다"가 나왔습니다. 광선의 원천은 태양 원반입니다.
const sun = createSun();
scene.add(sun.mesh);
assignLayer(sun.mesh, LAYER_MID);

// ── 달 ──────────────────────────────────────────────────────────────────
//
// 밤 칸에서 **끌려오지 않는지** 보려고 넣습니다. 달은 밝고 태양과 멀리
// 떨어져 있어서, 거리 마스크가 없으면 태양 쪽으로 늘어집니다.
const moon = createMoonGroup();
scene.add(moon.group);
assignLayer(moon.group, LAYER_FRONT);
updateMoonPosition(moon, new Date('2026-08-26T13:00:00Z'), 37.5, 127.0);
// 위상만 쓰고 자리는 손으로 잡습니다 — 날짜에 맡기면 구도가 흔들립니다.
{
  const ma = 24*Math.PI/180, mz = 205*Math.PI/180;
  moon.group.position.set(
    900*Math.cos(ma)*Math.sin(mz), 900*Math.sin(ma), -900*Math.cos(ma)*Math.cos(mz));
  moon.group.lookAt(0,0,0);
  moon.group.visible = true;
}

// ── 구름 ────────────────────────────────────────────────────────────────
const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
function ring() {
  const one = (d, az) => ({ distance:d, azimuthOffset:az,
    low: 22, mid: 52, high: 30, humidity: 68, precipitation: 0, visibility: 20000 });
  const out = [one(0,0)];
  for (const az of RING_AZ) for (const d of RING_D) out.push(one(d,az));
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), SUN_AZ), driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});
const wx = { precipitation:0, humidity:68, lowPct:22, highPct:30 };
const tauFor = (l) => blendedOpticsFromWeather(l, l==='low'?0.22:l==='mid'?0.52:0.30, wx, 0.5).tau;

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
scene.add(deck.group);
assignLayer(deck.group, LAYER_SOFT_CLOUD);

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);

const equ = new THREE.Matrix3();
computeEquToHorizon(new Date('2026-08-26T11:20:00Z'), 37.5, 127.0, equ);

/** 태양 고도를 바꿔 씬 전체를 다시 세팁니다. */
function setSun(sunAlt) {
  const a = sunAlt*Math.PI/180, z = SUN_AZ*Math.PI/180;
  const sunDir = new THREE.Vector3(
    Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  const optics = solveColumnOptics(samples, SUN_AZ, sunAlt, tauFor);
  const shade  = solveDirectionalShade(samples, SUN_AZ, sunAlt, tauFor);

  // 합성기에도 같은 태양을 넘깁니다. 앱에서는 렌더 루프가 매 프레임 합니다.
  composer.setSun(sunDir, sunAlt);

  updateSkydome(skydome, sunAlt, SUN_AZ, atmosphere);
  updateSun(sun, sunAlt, SUN_AZ, atmosphere);
  updateStarField(stars, {
    equToHorizon: equ, sunAltDeg: sunAlt, brightness: 1.0,
    // 박명이라 밝은 별만 보입니다 — 도시 하늘 수준.
    magLimit: 5.5, pixelRatio: 1, showStars: true, showPlanets: true,
  });
  updateCloudDeck(deck, {
    samples,
    beamFor: (altKm) => beamAtAltitude(sunAlt, altKm, atmosphere),
    beamShade: shade,
    ambientFor: (layer, azDeg) => {
      const f = optics.diffuseFactor[layer];
      const gU = angularSeparationDeg(azDeg, 70, SUN_AZ, sunAlt);
      const gD = angularSeparationDeg(azDeg, 15, SUN_AZ, sunAlt);
      return {
        up: applyCloudDimming(skyRadiance(70, gU, sunAlt, atmosphere), f),
        down: applyCloudDimming(skyRadiance(15, gD, sunAlt, atmosphere), f),
      };
    },
    sunDir, sunAltDeg: sunAlt,
    tauFor, shadowFor: (l) => blendedOpticsFromWeather(l, 0.4, wx, 0.5).shadowContrast,
    cellFor: (l) => PRESET_OPTICS[l==='high'?'Cirrus':l==='mid'?'Altocumulus':'Cumulus'],
    genusFor: (layer, at) => blendedOpticsFromWeather(layer, at.cover,
      { precipitation:at.precipMmH, humidity:at.humidityPct, lowPct:0, highPct:at.highPct }, 0.5),
    pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom,
    elevScale: atmosphere.elevScale, timeSeconds: 0, visible: true,
  });
}

// 블룸은 앱 기본값 그대로 켠 채로 훑습니다 — 광선만 따로 보면 실제 화면과
// 다른 것을 고르게 됩니다. 두 효과는 같은 밝은 부분을 나눠 씁니다.
const composer = createSceneComposer(TW, TH, 2, DEFAULT_BLOOM,
  { ...DEFAULT_GOD_RAYS, strength: 0 });
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(rayStrength) {
  composer.setGodRays({ ...DEFAULT_GOD_RAYS, strength: rayStrength });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  composer.render(renderer, scene, cam);
  const buf = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

function paint(buf, x) {
  const img = ctx2d.createImageData(TW, TH);
  for (let y = 0; y < TH; y++) {
    const src = (TH-1-y)*TW*4, dst = y*TW*4;
    for (let i = 0; i < TW*4; i++) img.data[dst+i] = buf[src+i];
  }
  ctx2d.putImageData(img, x, 0);
}

const lum = (b, p) => 0.2126*b[p*4] + 0.7152*b[p*4+1] + 0.0722*b[p*4+2];

/**
 * 밝기 분포 + 포화. 광선도 결국 더하기라, 블룸과 같은 대가를 냅니다.
 */
function brightnessProfile(buf) {
  const vals = [];
  for (let p = 0; p < TW*TH; p++) vals.push(lum(buf, p));
  vals.sort((a,b) => a-b);
  const at = (q) => vals[Math.floor(vals.length * q)];
  let sat = 0;
  for (const v of vals) if (v >= 250) sat++;
  return { 하위10: +at(0.10).toFixed(1), 중앙: +at(0.50).toFixed(1),
           상위10: +at(0.90).toFixed(1),
           포화: +(100 * sat / vals.length).toFixed(2) };
}

/**
 * **이방성** — 이 습작의 핵심 지표.
 *
 * 광선은 태양에서 뻗은 살입니다. 그러니 태양 둘레의 고리에서, 밝기는
 * **지름 방향으로는 완만하고**(살을 따라가므로) **접선 방향으로는 급하게**
 * 변해야 합니다(살과 틈을 가로지르므로). 그 비가 이방성입니다.
 *
 * ⚠ 이 지표가 필요한 이유: 방사형 블러를 켜면 화면은 언제나 밝아집니다.
 * 밝기만 재면 "광선이 생겼다"와 "그냥 밝아졌다"가 구분되지 않습니다.
 * 등방적으로 밝아졌다면 이 비는 1 근처에 머뭅니다.
 *
 * 고리로 재는 것도 이유가 있습니다. 태양 원반 자체는 포화되어 있어
 * 기울기가 0이고, 화면 끝은 광선이 닿지 않습니다.
 */
const RING_IN = 0.10, RING_OUT = 0.42; // 화면 높이 기준
function anisotropy(buf, sunUv) {
  const sx = sunUv[0] * TW, sy = sunUv[1] * TH;
  let rad = 0, tan = 0, n = 0;
  for (let y = 2; y < TH-2; y++) {
    for (let x = 2; x < TW-2; x++) {
      const dx = (x - sx) / TH, dy = (y - sy) / TH;
      const r = Math.hypot(dx, dy);
      if (r < RING_IN || r > RING_OUT) continue;
      const ux = dx / r, uy = dy / r;
      const L = lum(buf, y*TW+x);
      // 1픽셀 앞을 최근접으로 집습니다. 쌍선형 보간을 하면 그 자체가
      // 저역통과라 재려는 기울기를 깎습니다.
      const rp = (Math.round(y + uy)*TW + Math.round(x + ux));
      const tp = (Math.round(y + ux)*TW + Math.round(x - uy));
      const Lr = lum(buf, rp), Lt = lum(buf, tp);
      // ⚠ 포화된 픽셀은 기울기가 구조적으로 0입니다. 빼지 않으면 "밝게 해서
      // 다 붙어버린" 화면이 "매끈해서 이방성이 낮은" 것으로 잘못 읽힙니다.
      // 처음에 이걸 안 빼서 광선을 켤수록 이방성이 떨어지는 결과가 나왔습니다.
      if (L >= 250 || Lr >= 250 || Lt >= 250) continue;
      rad += Math.abs(L - Lr);
      tan += Math.abs(L - Lt);
      n++;
    }
  }
  if (n === 0) return { 지름: 0, 접선: 0, 이방성: 0, 표본: 0 };
  return { 지름: +(rad/n).toFixed(3), 접선: +(tan/n).toFixed(3),
           이방성: +((tan/n) / Math.max(1e-4, rad/n)).toFixed(3), 표본: n };
}

/** 두 화면이 픽셀 단위로 같은가 — 밤이 안 건드려졌는지 보는 데 씁니다. */
function maxDiff(a, b) {
  let m = 0;
  for (let p = 0; p < TW*TH; p++) {
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a[p*4+c] - b[p*4+c]));
  }
  return m;
}

/** 합성기와 **같은 방법으로** 태양의 화면 좌표를 구합니다. */
function sunScreenUv(sunAlt) {
  const a = sunAlt*Math.PI/180, z = SUN_AZ*Math.PI/180;
  const v = new THREE.Vector3(
    Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z))
    .normalize().multiplyScalar(1e4).add(cam.position);
  v.project(cam);
  return [v.x*0.5+0.5, v.y*0.5+0.5];
}

const STRENGTHS = [0, 0.2, 0.35, 0.5];

function label(i, lines) {
  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (i*TW + 8 + 12) + 'px';
  d.style.top = '58px';
  d.innerHTML = lines.join('<br>');
  labels.appendChild(d);
}

// ── 1~4칸: 노을. 이 효과가 사는 곳입니다 ────────────────────────────────
setSun(SUN_DAY);
deck.group.visible = true;
const sunUvDay = sunScreenUv(SUN_DAY);
const 노을기준 = shoot(0);

const 낮 = STRENGTHS.map((st, i) => {
  const buf = shoot(st);
  paint(buf, i*TW);
  const prof = brightnessProfile(buf);
  const an = anisotropy(buf, sunUvDay);
  label(i, [
    st === 0 ? '광선 없음' : '세기 ' + st,
    '이방성 ' + an.이방성,
    '상위10 ' + prof.상위10,
    '중앙 ' + prof.중앙,
    '포화 ' + prof.포화 + '%',
  ]);
  return { 세기: st, 이방성: an.이방성, ...prof, 최대변화: maxDiff(노을기준, buf) };
});

const 기준 = 낮[0];
낮.forEach(r => {
  r.이방성차 = +(r.이방성 - 기준.이방성).toFixed(3);
  r.상위10차 = +(r.상위10 - 기준.상위10).toFixed(1);
  r.포화차 = +(r.포화 - 기준.포화).toFixed(2);
});

/**
 * 게이트 두 개. 광선은 **박명광선**이라, 해가 높을 때와 밤에는 아무것도
 * 하면 안 됩니다.
 *
 * 코드로만 믿지 않고 화면으로 잽니다. 고도 램프는 나중에 누가 건드릴 수
 * 있는 숫자이고, 그때 이 두 칸이 소리를 냅니다.
 */
function gate(sunAlt, panel, name) {
  setSun(sunAlt);
  const off = shoot(0);
  const on = shoot(DEFAULT_GOD_RAYS.strength);
  paint(on, panel*TW);
  const diff = maxDiff(off, on);
  label(panel, [name, '광선세기 ' + composer.lastRayGain().toFixed(3),
                '픽셀 최대차 ' + diff]);
  return { 픽셀최대차: diff, 광선세기: +composer.lastRayGain().toFixed(4) };
}

const 높은해 = gate(SUN_HIGH, 4, '해 +' + SUN_HIGH + '° · 광선 켬');
const 밤 = gate(SUN_NIGHT, 5, '밤 ' + SUN_NIGHT + '° · 광선 켬');

window.__stats = {
  glError: gl.getError(),
  설정: DEFAULT_GOD_RAYS,
  태양화면좌표: sunUvDay.map(v => +v.toFixed(3)),
  낮,
  높은해,
  밤,
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'godray-sweep.html'), html);
console.log('생성 완료: godray-sweep.html');
