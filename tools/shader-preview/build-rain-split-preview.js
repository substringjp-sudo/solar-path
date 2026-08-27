/**
 * **서쪽에 비, 동쪽은 맑음** — 방향별 기상이 운형까지 가는가
 * (docs/CLOUD_VARIETY_PLAN.md 3단계).
 *
 * ## 무엇이 문제였나
 *
 * 2단계에서 운형을 방향마다 정하게 됐지만, 판정 입력 중 **운량만** 방향별이고
 * 강수·습도·상층 운량은 여전히 관측점 값 하나였습니다. 그래서 서쪽 30km에
 * 비가 와도 그 방향이 비구름이 되지 않았습니다.
 *
 * 이건 없는 데이터를 지어내는 문제가 아닙니다. Open-Meteo 팬은 **모든 지점**에서
 * `precipitation`과 `relative_humidity_2m`을 이미 받고 있습니다
 * (weather.ts의 원격 지점 변수 목록). 화면까지 오지 않고 있었을 뿐입니다.
 *
 * ## 어떻게 재나
 *
 * 저층 운량은 **어디나 80%로 같게** 두고 서쪽에만 강수 1.5mm/h를 줍니다.
 * 운량이 같으므로 화면 차이는 오직 강수에서 온 것입니다 — 이 통제가 없으면
 * "구름이 더 많아서 어두운 것"과 구분되지 않습니다.
 *
 *   왼쪽 패널: 판정 입력이 관측점 값 (강수 0) → 양쪽 다 층적운 τ35
 *   오른쪽   : 방향별 값 → 서쪽 난층운 τ110, 동쪽 층적운 τ35
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-rain-split-preview.js
 *       node tools/shader-preview/verify-rain-split.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const VIEW_AZ = 0, VIEW_ELEV = 20, FOV_DEG = 64;
const TW = 520, TH = 420;
const RAIN_MMH = 1.5;
const COVER_PCT = 80;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.4}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>저층 운량 어디나 ${COVER_PCT}% · 서쪽에만 비 ${RAIN_MMH}mm/h — 왼쪽: 판정 입력이 관측점 값 &nbsp;|&nbsp; 오른쪽: 방향별 값(3단계)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS, resolvePresetFromWeather, blendedOpticsFromWeather } from './app/utils/cloudPresets.js';
import { WeatherFan, buildSkyColumns,
         PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, FOV_DEG=${FOV_DEG};
const TW=${TW}, TH=${TH}, RAIN=${RAIN_MMH}, COVER=${COVER_PCT};

const canvas = document.getElementById('c');
canvas.width = TW*2; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW*2, TH, false);

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
// 관측점은 비가 안 옵니다 — 그래야 "관측점 값" 경로가 층적운을 고릅니다.
function ring() {
  const out = [{ distance:0, azimuthOffset:0, low:COVER, mid:0, high:0,
                 precipitation:0, humidity:70 }];
  for (const az of RING_AZ) for (const d of RING_D) {
    const a = (az+360)%360;
    const east = a > 0 && a < 180;
    out.push({ distance:d, azimuthOffset:az, low:COVER, mid:0, high:0,
               precipitation: east ? 0 : RAIN, humidity:70 });
  }
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), 0),
  driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH,
  windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});

const SUN_ALT = 14, SUN_AZ = 300;
const beam = { r: 1.48, g: 1.15, b: 0.80 };
const ambUp = { r: 0.42, g: 0.52, b: 0.78 };
const ambDown = { r: 0.50, g: 0.47, b: 0.52 };
const sA = SUN_ALT*Math.PI/180, sZ = SUN_AZ*Math.PI/180;
const sunDir = new THREE.Vector3(
  Math.cos(sA)*Math.sin(sZ), Math.sin(sA), -Math.cos(sA)*Math.cos(sZ)).normalize();

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');
const 층대표 = PRESET_OPTICS.Stratocumulus;

function shoot(label, x, wxOf) {
  updateCloudDeck(deck, {
    samples,
    beamFor: () => beam,
    ambientFor: () => ({ up: ambUp, down: ambDown }),
    sunDir, sunAltDeg: SUN_ALT,
    tauFor: () => 층대표.tau,
    shadowFor: () => 층대표.shadowContrast,
    cellFor: () => 층대표,
    genusFor: (layer, at) => blendedOpticsFromWeather(layer, at.cover, wxOf(at), 0.5),
    pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: 0.08, angstrom: 1.3, elevScale: 1.0,
    timeSeconds: 0, visible: true,
  });

  const grab = (bg) => {
    renderer.setClearColor(bg,1);
    renderer.setViewport(x,0,TW,TH);
    renderer.setScissor(x,0,TW,TH);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, cam);
    const b = new Uint8Array(4*TW*TH);
    gl.readPixels(x,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,b);
    return b;
  };
  const kb = grab(0x000000), kw = grab(0xffffff);

  // 경계 ±15°(격자 한 칸)는 두 운형이 섞이는 전이 띠라 뺍니다.
  const quarter = Math.floor(TW/4);
  const band = (x0,x1) => {
    let n=0, sumL=0, sumA=0, nA=0;
    for (let py=0; py<TH; py++) for (let px=x0; px<x1; px++) {
      const p = py*TW+px;
      const a = Math.max(0, Math.min(1, 1 - (kw[p*4+1]-kb[p*4+1])/255));
      sumA += a; nA++;
      if (a < 0.5) continue;
      const L = 0.2126*(kb[p*4]/a) + 0.7152*(kb[p*4+1]/a) + 0.0722*(kb[p*4+2]/a);
      sumL += L; n++;
    }
    return { 밝기: +(n ? sumL/n : 0).toFixed(1), 운량: +(sumA/nA).toFixed(4) };
  };
  const 서쪽 = band(0, quarter);
  const 동쪽 = band(TW-quarter, TW);

  renderer.setClearColor(0x1d4f77,1);
  renderer.setViewport(x,0,TW,TH);
  renderer.setScissor(x,0,TW,TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const d = document.createElement('div');
  d.className='lbl';
  d.style.left=(x+10+12)+'px'; d.style.top='34px';
  d.innerHTML = label +
    '<br>서(비)  밝기 ' + 서쪽.밝기 + '  운량 ' + (서쪽.운량*100).toFixed(0) + '%' +
    '<br>동(맑음) 밝기 ' + 동쪽.밝기 + '  운량 ' + (동쪽.운량*100).toFixed(0) + '%' +
    '<br>밝기차 ' + (동쪽.밝기-서쪽.밝기).toFixed(1);
  labels.appendChild(d);
  return { 서쪽, 동쪽 };
}

// 관측점 값(강수 0)만 쓰는 경로 — 3단계 이전.
const 관측점 = shoot('판정 입력 = 관측점 값', 0,
  () => ({ precipitation: 0, humidity: 70, lowPct: COVER, highPct: 0 }));
// 방향별 값 — 3단계.
const wxDir = (at) => ({ precipitation: at.precipMmH, humidity: at.humidityPct,
                         lowPct: 0, highPct: at.highPct });
const 방향별 = shoot('판정 입력 = 방향별 값 (3단계)', TW, wxDir);


// 판정 자체 — 화면 차이의 원인.
const lowS = samples.filter(s => s.layer === 'low');
const 분포 = {};
let pMin = 1e9, pMax = -1e9;
for (const s of lowS) {
  const n = resolvePresetFromWeather('low', s.cover,
    { precipitation:s.precipMmH, humidity:s.humidityPct, lowPct:s.lowPct, highPct:s.highPct }, 0.5);
  분포[n] = (분포[n]||0)+1;
  if (s.precipMmH < pMin) pMin = s.precipMmH;
  if (s.precipMmH > pMax) pMax = s.precipMmH;
}
const 판정 = { 방향수: lowS.length, 분포, 강수최소:+pMin.toFixed(3), 강수최대:+pMax.toFixed(3) };

const glErr = gl.getError();
window.__stats = { glError: glErr, 관측점, 방향별, 판정 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length?'SHADER_ERR':'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'rain-split.html'), html);
console.log('생성 완료: rain-split.html');
