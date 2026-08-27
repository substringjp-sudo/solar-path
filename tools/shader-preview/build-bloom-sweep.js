/**
 * **블룸 세기 훑기** — 취향을 고르기 위한 습작.
 *
 * 블룸의 세기는 물리가 정해주지 않습니다. 톤매핑 뒤(LDR)에서 더하는
 * 것이라 더욱 그렇습니다. 그래서 같은 하늘을 세기만 바꿔 나란히 놓고
 * 눈으로 고릅니다.
 *
 * 칸마다 **밝기 분포**를 함께 찍습니다. 블룸이 제대로면 어두운 곳은
 * 그대로 두고 밝은 곳만 올라가야 합니다 — 하위10이 같이 오르면 그건
 * 번짐이 아니라 그냥 화면을 밝게 칠한 것입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-bloom-sweep.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 400;
const VIEW_AZ = 262, VIEW_ELEV = 20, FOV_DEG = 58;
const SUN_AZ = 268;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.8);
   padding:5px 8px;border-radius:5px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>블룸 세기 훑기 — 분리 해상도 합성 ×2 위에서 세기만 다릅니다 (태양 +2°)</h3>
<p class="sub">판단 기준: 어두운 곳(하위10)은 그대로이면서 밝은 곳만 올라가는가 — 그리고 <b>눈에 좋은가</b>.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createStarField, updateStarField, computeEquToHorizon }
  from './app/components/SkyScene3D/StarField.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { LAYER_ALTITUDE_KM } from './app/components/SkyScene3D/cloudPlacement.js';
import {
  createSceneComposer, assignLayer, DEFAULT_BLOOM,
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
const SUN_AZ=${SUN_AZ};
const SUN_DAY = 2.0;

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
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

// ── 구름 ────────────────────────────────────────────────────────────────
const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
function ring() {
  const one = (d, az) => ({ distance:d, azimuthOffset:az,
    low: 18, mid: 44, high: 36, humidity: 64, precipitation: 0, visibility: 22000 });
  const out = [one(0,0)];
  for (const az of RING_AZ) for (const d of RING_D) out.push(one(d,az));
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), SUN_AZ), driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});
const wx = { precipitation:0, humidity:64, lowPct:18, highPct:36 };
const tauFor = (l) => blendedOpticsFromWeather(l, l==='low'?0.18:l==='mid'?0.44:0.36, wx, 0.5).tau;

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

  updateSkydome(skydome, sunAlt, SUN_AZ, atmosphere);
  updateStarField(stars, {
    equToHorizon: equ, sunAltDeg: sunAlt, brightness: 1.0,
    // 박명이라 밝은 별만 보입니다 — 도시 하늘 수준.
    magLimit: 4.5, pixelRatio: 1, showStars: true, showPlanets: false,
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
        up: applyCloudDimming(skyRadiance(70, gU, sunAlt, atmosphere, LAYER_ALTITUDE_KM[layer]), f),
        down: applyCloudDimming(skyRadiance(15, gD, sunAlt, atmosphere, LAYER_ALTITUDE_KM[layer]), f),
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

const composer = createSceneComposer(TW, TH, 2, { ...DEFAULT_BLOOM, strength: 0 });
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(scale, bloomStrength = 0) {
  composer.setSoftScale(scale);
  composer.setBloom({ ...DEFAULT_BLOOM, threshold: THRESH, strength: bloomStrength });
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
 * 밝기 분포. 블룸이 **밝은 곳만** 건드렸는지 보려면 어두운 쪽과 밝은 쪽을
 * 따로 봐야 합니다. 전체 평균만 보면 "화면을 밝게 칠한 것"과 구분이 안 됩니다.
 */
function brightnessProfile(buf) {
  const vals = [];
  for (let p = 0; p < TW*TH; p++) vals.push(lum(buf, p));
  vals.sort((a,b) => a-b);
  const at = (q) => vals[Math.floor(vals.length * q)];
  // 포화 = 밝기 250 이상. 블룸의 **대가**는 여기에 있습니다. 상위10이
  // 올라가는 것은 의도한 효과지만, 포화가 늘면 그 영역의 구름 구조가
  // 통째로 흰색으로 뭉개져 사라집니다. 세기를 고르는 실제 기준입니다.
  let sat = 0;
  for (const v of vals) if (v >= 250) sat++;
  return { 하위10: +at(0.10).toFixed(1), 중앙: +at(0.50).toFixed(1),
           상위10: +at(0.90).toFixed(1), 상위1: +at(0.99).toFixed(1),
           포화: +(100 * sat / vals.length).toFixed(2) };
}

/**
 * 문턱은 ?t=0.82 처럼 쿼리로 덮어쓸 수 있습니다.
 *
 * 대기 흡수를 고쳐 하늘 밝기 분포가 바뀌었을 때, 세기만 훑어서는 답이
 * 안 나왔습니다 — 화면이 평평해지면 옛 문턱으로는 블룸이 밝은 곳을
 * **고르지 못합니다**. 두 값을 함께 훑어야 해서 넣은 손잡이입니다.
 */
const THRESH = Number(new URLSearchParams(location.search).get('t') || DEFAULT_BLOOM.threshold);
const STRENGTHS = [0, 0.3, 0.5, 0.8];

setSun(SUN_DAY);
deck.group.visible = true;

const 결과 = STRENGTHS.map((st, i) => {
  const buf = shoot(2, st);
  paint(buf, i*TW);
  const prof = brightnessProfile(buf);
  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (i*TW + 8 + 12) + 'px';
  d.style.top = '58px';
  d.innerHTML = (st === 0 ? '블룸 없음' : '세기 ' + st) +
    '<br>하위10 ' + prof.하위10 +
    '<br>중앙 ' + prof.중앙 +
    '<br>상위10 ' + prof.상위10 +
    '<br>포화 ' + prof.포화 + '%';
  labels.appendChild(d);
  return { 세기: st, ...prof };
});

const base = 결과[0];
결과.forEach(r => {
  r.하위10차 = +(r.하위10 - base.하위10).toFixed(1);
  r.중앙차 = +(r.중앙 - base.중앙).toFixed(1);
  r.상위10차 = +(r.상위10 - base.상위10).toFixed(1);
  r.포화차 = +(r.포화 - base.포화).toFixed(2);
});

window.__stats = { glError: gl.getError(), 설정: { ...DEFAULT_BLOOM, threshold: THRESH }, 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'bloom-sweep.html'), html);
console.log('생성 완료: bloom-sweep.html');
