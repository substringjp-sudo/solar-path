/**
 * **덱 방향별 광학의 어느 성분이 이음매를 만드는가** (진단 전용).
 *
 * 같은 하늘·같은 카메라를 여섯 번 그립니다. 다른 것은 방향별로 흔드는
 * 성분 하나뿐입니다:
 *
 *   1 상수        전부 층 대표 (기준선)
 *   2 τ           광학두께만 방향별
 *   3 그늘        그늘 대비만
 *   4 조각 세기   cellStrength만
 *   5 조각 크기   cellSizeKm만
 *   6 전부
 *
 * 이렇게 나누지 않으면 "뭔가 이음매가 있다"까지만 말할 수 있습니다.
 * 실제로 처음 두 번의 추측(uv 배율 어긋남 / 성긴 격자)이 모두 절반만
 * 맞았고, 이 분해를 하고 나서야 원인이 잡혔습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-deck-tear-diag.js
 *       node /tmp/shoot-wide.js deck-tear.html deck-tear.png
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 340, TH = 300, COLS = 3, ROWS = 2;
const VIEW_AZ = 0, VIEW_ELEV = 20, FOV_DEG = 64;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>이음매 원인 분해 — 방향별로 흔드는 성분을 하나씩만</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS, blendedOpticsFromWeather } from './app/utils/cloudPresets.js';
import { WeatherFan, buildSkyColumns,
         PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, COLS=${COLS}, ROWS=${ROWS};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, FOV_DEG=${FOV_DEG};

const canvas = document.getElementById('c');
canvas.width = TW*COLS; canvas.height = TH*ROWS;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW*COLS, TH*ROWS, false);
const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
function ring() {
  const out = [{ distance:0, azimuthOffset:0, low:80, mid:0, high:0, precipitation:0, humidity:70 }];
  for (const az of RING_AZ) for (const d of RING_D) {
    const a = (az+360)%360;
    const east = a > 0 && a < 180;
    out.push({ distance:d, azimuthOffset:az, low:80, mid:0, high:0,
               precipitation: east ? 0 : 1.5, humidity:70 });
  }
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), 0), driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});

const SUN_ALT = 14, SUN_AZ = 300;
const beam = { r: 1.48, g: 1.15, b: 0.80 };
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

const 기준 = PRESET_OPTICS.Stratocumulus;
const dirOptics = (at) => blendedOpticsFromWeather('low', at.cover,
  { precipitation: at.precipMmH, humidity: at.humidityPct, lowPct: 0, highPct: at.highPct }, 0.5);

function shoot(label, col, row, pick) {
  const x = col*TW, y = (ROWS-1-row)*TH;
  updateCloudDeck(deck, {
    samples,
    beamFor: () => beam,
    ambientFor: () => ({ up:{r:0.42,g:0.52,b:0.78}, down:{r:0.50,g:0.47,b:0.52} }),
    sunDir, sunAltDeg: SUN_ALT,
    tauFor: () => 기준.tau, shadowFor: () => 기준.shadowContrast, cellFor: () => 기준,
    genusFor: (layer, at) => pick(dirOptics(at)),
    pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: 0.08, angstrom: 1.3, elevScale: 1.0, timeSeconds: 0, visible: true,
  });
  renderer.setClearColor(0x1d4f77,1);
  renderer.setViewport(x,y,TW,TH);
  renderer.setScissor(x,y,TW,TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);
  const d = document.createElement('div');
  d.className='lbl';
  d.style.left=(col*TW+8+12)+'px'; d.style.top=(row*TH+8+34)+'px';
  d.textContent = label;
  labels.appendChild(d);
}

const B = 기준;
shoot('1 상수 (기준선)',        0, 0, () => B);
shoot('2 τ만 방향별',           1, 0, o => ({ ...B, tau: o.tau }));
shoot('3 그늘만',               2, 0, o => ({ ...B, shadowContrast: o.shadowContrast }));
shoot('4 조각 세기만',          0, 1, o => ({ ...B, cellStrength: o.cellStrength }));
shoot('5 조각 크기만',          1, 1, o => ({ ...B, cellSizeKm: o.cellSizeKm }));
shoot('6 전부',                 2, 1, o => o);

const glErr = gl.getError();
window.__stats = { glError: glErr };
window.__errors = errors;
document.title = 'DONE::' + (errors.length?'SHADER_ERR':'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'deck-tear.html'), html);
console.log('생성 완료: deck-tear.html');
