/**
 * **분리 해상도 합성** 판정용 미리보기 (`SceneComposer.ts`).
 *
 * ## 무엇을 확인해야 하는가
 *
 * 배율 훑기가 "구름을 절반 해상도로 그리면 잔 파편이 뭉친다"까지 보여줬고,
 * 남은 걱정은 **별이 대가를 치르지 않는가** 였습니다. 합성기는 층마다 다른
 * 해상도를 쓰므로 둘을 동시에 얻어야 합니다. 그래서 한 화면에 **별과 구름을
 * 함께** 놓고 두 경로를 비교합니다.
 *
 *   왼쪽  직접 그리기 (합성 없음, 전부 원해상도)
 *   오른쪽 분리 해상도 합성 (하늘·덱만 ×2, 별·태양은 원해상도)
 *
 * 세 가지를 잽니다:
 *
 *  - **구름 경계밀도** — 내려가야 합니다 (파편이 뭉쳤다는 뜻).
 *  - **별 선명도** — 유지돼야 합니다. 별 픽셀의 밝기 분산으로 잽니다.
 *    저해상도로 흐려지면 봉우리가 뭉개져 분산이 떨어집니다.
 *  - **운량** — 보존돼야 합니다. 합성의 알파 처리가 틀리면 여기서 걸립니다.
 *
 * 별을 밤하늘에만 두면 구름과 같은 화면에 못 놓으므로, **태양을 지평선
 * 아래로** 내려 박명 상태로 찍습니다 — 별과 구름이 동시에 보이는 실제
 * 시각이기도 합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-composer-preview.js
 *       node tools/shader-preview/verify-composer.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 460, TH = 420;
const VIEW_AZ = 262, VIEW_ELEV = 20, FOV_DEG = 58;
const SUN_ALT = -6.5, SUN_AZ = 268;

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
<h3>1·2칸 구름 (태양 +2°) &nbsp;|&nbsp; 3·4칸 별만, 덱 숨김 (태양 ${SUN_ALT}°) &nbsp;|&nbsp; 5·6칸 블룸 (태양 +2° / 별)</h3>
<p class="sub">두 질문을 <b>따로</b> 봅니다. 한 화면에 섞으면 밝은 구름이 별 측정을 오염시킵니다 (실제로 한 번 그랬습니다).</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createStarField, updateStarField, computeEquToHorizon }
  from './app/components/SkyScene3D/StarField.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
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
const SUN_TWILIGHT=${SUN_ALT}, SUN_AZ=${SUN_AZ};
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

const composer = createSceneComposer(TW, TH, 2, { ...DEFAULT_BLOOM, strength: 0 });
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(scale, bloomStrength = 0) {
  composer.setSoftScale(scale);
  composer.setBloom({ ...DEFAULT_BLOOM, strength: bloomStrength });
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
 * 구름 경계밀도 — 이웃과 밝기가 뚜렷이 다른 픽셀의 비율.
 *
 * ⚠ **절대 밝기 문턱으로는 못 잽니다.** 처음에 "밝기 90을 넘느냐"로 갈랐다가
 * 태양 +2°에서 하늘도 구름도 전부 90을 넘어 양쪽 다 0%가 나왔습니다.
 * 시각에 따라 화면 전체 밝기가 통째로 움직이기 때문입니다.
 *
 * 이웃 간 **차이**로 재면 그 의존이 사라집니다. 잔 파편이 뭉치면 뚜렷한
 * 경계의 수가 줄어드는 것이 그대로 잡힙니다.
 */
const EDGE_DELTA = 12;
function edgeDensity(buf) {
  let n = 0, tot = 0;
  for (let y = 0; y < TH-1; y++) {
    for (let x = 0; x < TW-1; x++) {
      const i = y*TW+x;
      const L = lum(buf, i);
      if (Math.abs(L - lum(buf, i+1)) > EDGE_DELTA) n++;
      if (Math.abs(L - lum(buf, i+TW)) > EDGE_DELTA) n++;
      tot++;
    }
  }
  return n / tot;
}

/**
 * 별 선명도 — **덱을 숨긴 화면에서만** 잽니다.
 *
 * 처음에는 구름과 별을 한 화면에 놓고 위쪽 띠에서 상위 픽셀을 뽑았는데,
 * 그 띠에 구름이 걸려 있으면 재는 것이 별인지 구름인지 알 수 없습니다.
 * 밝은 구름이 있는 화면에서는 상위 픽셀이 통째로 구름일 수도 있습니다.
 *
 * 별은 어두운 배경 위의 밝은 점이므로, 흐려지면 봉우리가 낮아지고 퍼져
 * 상위 픽셀 평균이 떨어집니다. 배경 중앙값과의 차(대비)가 지표입니다.
 */
function starSharpness(buf) {
  const vals = [];
  for (let p = 0; p < TW*TH; p++) vals.push(lum(buf, p));
  vals.sort((a,b) => b-a);
  const top = vals.slice(0, 300);
  const mean = top.reduce((s,v) => s+v, 0) / top.length;
  const median = vals[Math.floor(vals.length/2)];
  return { 상위평균: +mean.toFixed(1), 배경중앙: +median.toFixed(1),
           대비: +(mean - median).toFixed(1) };
}

/**
 * 밝기 분포. 블룸이 **밝은 곳만** 건드렸는지 보려면 어두운 쪽과 밝은 쪽을
 * 따로 봐야 합니다. 전체 평균만 보면 "화면을 밝게 칠한 것"과 구분이 안 됩니다.
 */
function brightnessProfile(buf) {
  const vals = [];
  for (let p = 0; p < TW*TH; p++) vals.push(lum(buf, p));
  vals.sort((a,b) => a-b);
  const at = (q) => vals[Math.floor(vals.length * q)];
  return { 하위10: +at(0.10).toFixed(1), 중앙: +at(0.50).toFixed(1),
           상위10: +at(0.90).toFixed(1), 상위1: +at(0.99).toFixed(1) };
}

// ── 1·2칸: 구름 (색이 정상인 시각) ──────────────────────────────────────
setSun(SUN_DAY);
deck.group.visible = true;
const 구름직접 = shoot(1); paint(구름직접, 0);
const 구름합성 = shoot(2); paint(구름합성, TW);

// ── 3·4칸: 별만 (덱을 숨겨 오염을 없앰) ────────────────────────────────
setSun(SUN_TWILIGHT);
deck.group.visible = false;
const 별직접 = shoot(1); paint(별직접, TW*2);
const 별합성 = shoot(2); paint(별합성, TW*3);
deck.group.visible = true;

// ── 5·6칸: 블룸 ────────────────────────────────────────────────────────
// 5칸은 구름(태양 +2°), 6칸은 별. 둘 다 합성 ×2 위에 블룸만 켠 것이라
// 앞 칸들과 **한 가지만** 다릅니다.
setSun(SUN_DAY);
deck.group.visible = true;
const 블룸구름 = shoot(2, DEFAULT_BLOOM.strength); paint(블룸구름, TW*4);
setSun(SUN_TWILIGHT);
deck.group.visible = false;
const 블룸별 = shoot(2, DEFAULT_BLOOM.strength); paint(블룸별, TW*5);
deck.group.visible = true;

const soft = composer.softSize();
const 결과 = {
  구름: {
    직접: +(edgeDensity(구름직접)*100).toFixed(3),
    합성: +(edgeDensity(구름합성)*100).toFixed(3),
  },
  별: { 직접: starSharpness(별직접), 합성: starSharpness(별합성) },
  블룸: {
    설정: DEFAULT_BLOOM,
    // 블룸은 밝은 곳만 더합니다 — 화면 평균은 오르고 어두운 곳은 그대로여야
    // 합니다. 어두운 곳까지 오르면 그냥 화면을 밝게 칠한 것입니다.
    구름: brightnessProfile(블룸구름),
    구름기준선: brightnessProfile(구름합성),
    별: brightnessProfile(블룸별),
    별기준선: brightnessProfile(별합성),
  },
  저해상도버퍼: soft.width + '×' + soft.height,
  화면: TW + '×' + TH,
};
결과.구름.감소율 = +(1 - 결과.구름.합성/결과.구름.직접).toFixed(3);

[
  ['1 구름 · 직접', 0, '경계밀도 ' + 결과.구름.직접 + '%'],
  ['2 구름 · 합성 ×2', TW, '경계밀도 ' + 결과.구름.합성 + '%'],
  ['3 별 · 직접', TW*2, '상위평균 ' + 결과.별.직접.상위평균 + '<br>대비 ' + 결과.별.직접.대비],
  ['4 별 · 합성 ×2', TW*3, '상위평균 ' + 결과.별.합성.상위평균 + '<br>대비 ' + 결과.별.합성.대비],
  ['5 구름 · 합성 + 블룸', TW*4,
    '하위10 ' + 결과.블룸.구름.하위10 + ' (기준 ' + 결과.블룸.구름기준선.하위10 + ')' +
    '<br>상위1 ' + 결과.블룸.구름.상위1 + ' (기준 ' + 결과.블룸.구름기준선.상위1 + ')'],
  ['6 별 · 합성 + 블룸', TW*5,
    '하위10 ' + 결과.블룸.별.하위10 + ' (기준 ' + 결과.블룸.별기준선.하위10 + ')' +
    '<br>상위1 ' + 결과.블룸.별.상위1 + ' (기준 ' + 결과.블룸.별기준선.상위1 + ')'],
].forEach(([name, x, txt]) => {
  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 8 + 12) + 'px';
  d.style.top = '58px';
  d.innerHTML = name + '<br>' + txt;
  labels.appendChild(d);
});

window.__stats = { glError: gl.getError(), ...결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'composer.html'), html);
console.log('생성 완료: composer.html');
