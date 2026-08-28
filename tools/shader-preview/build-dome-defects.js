/**
 * **실기기 캡처에서 보고된 돔 결함 4종을 재현합니다.**
 *
 * 실기기 캡처(QR 디코드: 태양 25.92°/262.82°, 저 12% 중 22% 상 14%,
 * 시정 5284m, 습도 63%)에서 네 가지가 보고됐습니다.
 *
 *  1. 지평선 쪽으로 갈수록 **격자무늬**가 보인다
 *  2. 땅과 하늘 사이에 **여백**이 생긴다
 *  3. 천정에 **구멍**이 있고 주변이 기괴하게 왜곡된다
 *  4. 돔의 구름이 **너무 땅에 가깝다**
 *
 * 넷을 한 화면에 놓으면 무엇이 무엇의 원인인지 섞입니다. 시선 고도만
 * 바꿔 네 칸으로 나눠 봅니다 — 같은 씬, 같은 기상값입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-dome-defects.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 440, TH = 440;
const FOV_DEG = 60;
// QR에서 읽은 실제 값입니다.
const SUN_ALT = 25.92, SUN_AZ = 262.82;
const LAT = 37.4864, LON = 127.0442, ELEV_M = 29;
const OBS = { low: 12, mid: 22, high: 14, humidity: 63, precip: 0, vis: 5284 };
// 캡처의 나침반은 221°였습니다.
const VIEW_AZ = 221;
const PANELS = [
  { elev: 84, name: '천정 84°' },
  { elev: 45, name: '중간 45°' },
  { elev: 10, name: '지평선 10°' },
  { elev: -4, name: '접합 -4°' },
];

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
<h3>실기기 결함 재현 — QR 실측값 (태양 ${SUN_ALT}°/${SUN_AZ}°, 저 ${OBS.low}% 중 ${OBS.mid}% 상 ${OBS.high}%, 시정 ${OBS.vis}m)</h3>
<p class="sub">시선 고도만 바꿉니다. 1칸 천정 구멍·왜곡 / 3칸 격자무늬 / 4칸 땅-하늘 여백.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon }
  from './app/components/SkyScene3D/TerrainRing.js';
import { LAYER_ALTITUDE_KM } from './app/components/SkyScene3D/cloudPlacement.js';
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
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ}, VIEW_AZ=${VIEW_AZ};
const OBS=${JSON.stringify(OBS)};
const PANELS=${JSON.stringify(PANELS)};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
const ctx2d = canvas.getContext('2d');

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW, TH, false);
renderer.autoClear = true;

const scene = new THREE.Scene();
const atmosphere = makeAtmosphereParams({
  latitude: ${LAT}, observerElevM: ${ELEV_M}, dayOfYear: 239,
  humidityPct: OBS.humidity, visibilityM: OBS.vis,
});

const skydome = createSkydome();
scene.add(skydome.mesh);

// 지형·지면 — 4칸의 "여백"을 보려면 반드시 같이 있어야 합니다.
// 평지에 가까운 도심 관측점 (build-horizon-preview 와 같은 형상).
const angles = [];
for (let i = 0; i < 72; i++) {
  angles.push(0.4 + 0.9 * Math.sin(i * 0.21) + 0.5 * Math.sin(i * 0.07 + 1.3));
}
const terrain = createTerrainRing(angles);
scene.add(terrain);
const ground = createGroundPlane();
setGroundHorizon(ground, ${ELEV_M});
scene.add(ground);

// ── 구름 ────────────────────────────────────────────────────────────────
const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
function ring() {
  const one = (d, az) => ({ distance:d, azimuthOffset:az,
    low: OBS.low, mid: OBS.mid, high: OBS.high,
    humidity: OBS.humidity, precipitation: 0, visibility: OBS.vis });
  const out = [one(0,0)];
  for (const az of RING_AZ) for (const d of RING_D) out.push(one(d,az));
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), SUN_AZ), driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});
const wx = { precipitation:0, humidity:OBS.humidity, lowPct:OBS.low, highPct:OBS.high };
const tauFor = (l) => blendedOpticsFromWeather(
  l, l==='low'?OBS.low/100:l==='mid'?OBS.mid/100:OBS.high/100, wx, 0.5).tau;

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
scene.add(deck.group);

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);

const sunA = SUN_ALT*Math.PI/180, sunZ = SUN_AZ*Math.PI/180;
const sunDir = new THREE.Vector3(
  Math.cos(sunA)*Math.sin(sunZ), Math.sin(sunA), -Math.cos(sunA)*Math.cos(sunZ)).normalize();
const optics = solveColumnOptics(samples, SUN_AZ, SUN_ALT, tauFor);
const shade  = solveDirectionalShade(samples, SUN_AZ, SUN_ALT, tauFor);

updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
updateTerrainColors(terrain, SUN_ALT, SUN_AZ, atmosphere);
updateGroundColors(ground, SUN_ALT, SUN_AZ, atmosphere);
updateCloudDeck(deck, {
  samples,
  beamFor: (altKm) => beamAtAltitude(SUN_ALT, altKm, atmosphere),
  beamShade: shade,
  ambientFor: (layer, azDeg) => {
    const f = optics.diffuseFactor[layer];
    const gU = angularSeparationDeg(azDeg, 70, SUN_AZ, SUN_ALT);
    const gD = angularSeparationDeg(azDeg, 15, SUN_AZ, SUN_ALT);
    return {
      up: applyCloudDimming(skyRadiance(70, gU, SUN_ALT, atmosphere, LAYER_ALTITUDE_KM[layer]), f),
      down: applyCloudDimming(skyRadiance(15, gD, SUN_ALT, atmosphere, LAYER_ALTITUDE_KM[layer]), f),
    };
  },
  sunDir, sunAltDeg: SUN_ALT,
  tauFor, shadowFor: (l) => blendedOpticsFromWeather(l, 0.4, wx, 0.5).shadowContrast,
  cellFor: (l) => PRESET_OPTICS[l==='high'?'Cirrus':l==='mid'?'Altocumulus':'Cumulus'],
  genusFor: (layer, at) => blendedOpticsFromWeather(layer, at.cover,
    { precipitation:at.precipMmH, humidity:at.humidityPct, lowPct:0, highPct:at.highPct }, 0.5),
  pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
  windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
  betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom,
  elevScale: atmosphere.elevScale, timeSeconds: 0, visible: true,
});

// 원인 분리용 손잡이. ?only=high 로 한 층만, ?cells=0 으로 조각 무늬를 끕니다.
const Q = new URLSearchParams(location.search);
const ONLY = Q.get('only');
const CELLS = Q.get('cells');
if (ONLY) {
  for (const l of deck.layers) l.mesh.visible = (l.layer === ONLY);
}
if (Q.get('relief') === '0') {
  for (const l of deck.layers) l.material.uniforms.uAnyCells.value = 0;
}
if (CELLS === '0') {
  // ⚠ uAnyCells 는 **입체 음영만** 끕니다 — 조각 모양은 그대로 남습니다.
  // 조각의 기여를 진짜로 없애려면 uv 배율을 0으로 만들어 텍스처가 한 점을
  // 읽게 해야 합니다 (처음에 uAnyCells 로 껐다가 헛다리를 짚었습니다).
  for (const l of deck.layers) l.material.uniforms.uCellUvScale.value.set(0, 0);
}

const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(viewElev) {
  const ar = VIEW_AZ*Math.PI/180, er = viewElev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0xff00ff, 1); // 아무것도 안 그려진 곳을 눈에 띄게
  renderer.clear(true, true, true);
  renderer.render(scene, cam);
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

/** 아무것도 안 그려진(마젠타로 남은) 픽셀 비율 — "여백"의 정의입니다. */
function magentaFrac(buf) {
  let n = 0;
  for (let p = 0; p < TW*TH; p++) {
    if (buf[p*4] > 240 && buf[p*4+1] < 20 && buf[p*4+2] > 240) n++;
  }
  return +(100 * n / (TW*TH)).toFixed(3);
}

/**
 * 천정 구멍 — 화면 중앙에서 덱이 아니라 **하늘돔이 그대로 비치는** 영역.
 * 덱을 끄고 켠 두 장의 차이가 0인 픽셀이 곧 구멍입니다.
 */
function holeAtCenter(withDeck, withoutDeck, radiusPx) {
  const cx = TW/2, cy = TH/2;
  let same = 0, tot = 0;
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      if (Math.hypot(x-cx, y-cy) > radiusPx) continue;
      const p = (y*TW+x)*4;
      const d = Math.abs(withDeck[p]-withoutDeck[p]) + Math.abs(withDeck[p+1]-withoutDeck[p+1])
              + Math.abs(withDeck[p+2]-withoutDeck[p+2]);
      if (d < 3) same++;
      tot++;
    }
  }
  return +(100 * same / Math.max(1,tot)).toFixed(2);
}

const lum = (b,p) => 0.2126*b[p*4] + 0.7152*b[p*4+1] + 0.0722*b[p*4+2];

/**
 * **격자성** — 무늬가 가로·세로 축에 정렬되어 있는가.
 *
 * 자연스러운 구름은 방향이 없습니다. 타일이 드러나면 이웃 차이가 축 방향에
 * 몰립니다. 축방향 기울기 합을 대각선 기울기 합으로 나눠 봅니다 —
 * 등방이면 1 부근, 격자가 서면 커집니다.
 */
function gridness(buf) {
  let axis = 0, diag = 0;
  for (let y = 2; y < TH-2; y++) {
    for (let x = 2; x < TW-2; x++) {
      const i = y*TW+x, L = lum(buf,i);
      axis += Math.abs(L - lum(buf,i+1)) + Math.abs(L - lum(buf,i+TW));
      diag += Math.abs(L - lum(buf,i+TW+1)) + Math.abs(L - lum(buf,i+TW-1));
    }
  }
  // ⚠ 대각선 이웃은 √2 만큼 멀어 기울기가 구조적으로 큽니다. 나누기 전에
  // 되돌리지 않으면 등방인 화면도 1보다 작게 나옵니다 (처음에 0.69가
  // 나와서 격자가 없는 줄 알았습니다).
  return +(axis / Math.max(1e-6, diag / Math.SQRT2)).toFixed(4);
}

const 결과 = PANELS.map((pn, i) => {
  const withDeck = shoot(pn.elev);
  paint(withDeck, i*TW);
  deck.group.visible = false;
  const noDeck = shoot(pn.elev);
  deck.group.visible = true;

  const mag = magentaFrac(withDeck);
  const hole = holeAtCenter(withDeck, noDeck, 40);
  const grid = gridness(withDeck);

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (i*TW + 8 + 12) + 'px';
  d.style.top = '58px';
  d.innerHTML = pn.name +
    '<br>빈 화면 ' + mag + '%' +
    '<br>중앙 구멍 ' + hole + '%' +
    '<br>격자성 ' + grid;
  labels.appendChild(d);
  return { 이름: pn.name, 고도: pn.elev, 빈화면: mag, 중앙구멍: hole, 격자성: grid };
});

window.__stats = { glError: gl.getError(), 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'dome-defects.html'), html);
console.log('생성 완료: dome-defects.html');
