/**
 * **덱이 운형을 구분할 수 있는가** — 10종의 표현 폭 측정.
 *
 * ## 왜 재나
 *
 * `PRESET_OPTICS`에는 10종의 광학이 다 들어 있습니다. 하지만 덱은 층마다
 * **하나의** 운형만 받습니다(`cellFor`/`tauFor`/`shadowFor` 전부 스칼라).
 * 그리고 `tauFor`/`shadowFor`는 그 층에서 뽑힌 **빌보드의 중앙값**인데,
 * 5단계에서 빌보드를 적운·적란운으로 제한한 뒤로 중·상층 빌보드는
 * 하나도 나오지 않습니다 — 그래서 두 층은 항상 폴백 τ=25 / 그늘 0.5 로
 * 그려집니다.
 *
 * 이 미리보기는 두 가지를 따로 봅니다:
 *
 *  (A) **표현 폭**: 같은 운량·같은 태양·같은 카메라에서 10종의 광학을
 *      하나씩 먹였을 때 화면이 실제로 달라지는가. 달라지지 않는다면
 *      운형을 방향마다 배분해 봐야 소용이 없습니다.
 *
 *  (B) **지금 앱이 쓰는 값**: 상층을 도감 권운(τ=3.0/그늘 0.12)으로 그린 것과
 *      현재 폴백(τ=25/그늘 0.5)으로 그린 것의 차이.
 *
 * 알파는 검정·흰 두 배경으로 두 번 그려 분리합니다. 색 문턱으로 재면
 * 가장자리 반투명과 그늘이 섞입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-genus-range-preview.js
 *       node tools/shader-preview/shoot.js genus-range.html genus-range.png
 *       node tools/shader-preview/verify-genus-range.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 260, TH = 260, COLS = 6, ROWS = 3;
const VIEW_AZ = 270, VIEW_ELEV = 20, FOV_DEG = 55;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.35}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>1·2행: 운형 10종 (같은 운량 55%·태양 12°·같은 카메라) + 상층 폴백 비교 &nbsp;|&nbsp; 3행: 지금 앱이 관측 기상에서 실제로 보내는 값</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS, representativePresetForObserver } from './app/utils/cloudPresets.js';
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
const COVER_PCT = 55;

function ringFor(layer) {
  const one = (d, az) => {
    const e = { distance:d, azimuthOffset:az, low:0, mid:0, high:0 };
    e[layer] = COVER_PCT;
    return e;
  };
  const out = [one(0,0)];
  for (const az of RING_AZ) for (const d of RING_D) out.push(one(d,az));
  return out;
}
// 층마다 같은 값을 다시 만들 필요가 없습니다 — 한 번 만들어 재사용합니다.
const samplesByLayer = {};
for (const L of ['low','mid','high']) {
  samplesByLayer[L] = buildSkyColumns({
    fan: new WeatherFan(ringFor(L), 270),
    driftMinutes: 0,
    windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
  });
}

const layerOf = (n) =>
  (n==='Cirrus'||n==='Cirrocumulus'||n==='Cirrostratus') ? 'high'
  : (n==='Altocumulus'||n==='Altostratus') ? 'mid' : 'low';

// 태양 12°, 방위 270 (정면). 저녁빛에 가까운 따뜻한 직달광.
const SUN_ALT = 12, SUN_AZ = 270;
const beam = { r: 1.55, g: 1.12, b: 0.72 };
const ambUp = { r: 0.42, g: 0.52, b: 0.78 };
const ambDown = { r: 0.50, g: 0.46, b: 0.50 };

const sAlt = SUN_ALT*Math.PI/180, sAz = SUN_AZ*Math.PI/180;
const sunDir = new THREE.Vector3(
  Math.cos(sAlt)*Math.sin(sAz), Math.sin(sAlt), -Math.cos(sAlt)*Math.cos(sAz)).normalize();

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

/** 한 칸을 그리고 잽니다. optics는 {tau, shadowContrast, cellSizeKm, ...}. */
function shoot(name, layer, optics, col, row, caption) {
  const x = col*TW, y = (ROWS-1-row)*TH;   // WebGL 뷰포트는 아래가 y=0
  updateCloudDeck(deck, {
    samples: samplesByLayer[layer],
    beamFor: () => beam,
    ambientFor: () => ({ up: ambUp, down: ambDown }),
    sunDir, sunAltDeg: SUN_ALT,
    tauFor: () => optics.tau,
    shadowFor: () => optics.shadowContrast,
    cellFor: () => ({ cellSizeKm: optics.cellSizeKm, cellStrength: optics.cellStrength,
                      cellVariant: optics.cellVariant, cellAspect: optics.cellAspect }),
    pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: 0.08, angstrom: 1.3, elevScale: 1.0,
    timeSeconds: 0, visible: true,
  });

  const grab = (bg) => {
    renderer.setClearColor(bg,1);
    renderer.setViewport(x,y,TW,TH);
    renderer.setScissor(x,y,TW,TH);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, cam);
    const b = new Uint8Array(4*TW*TH);
    gl.readPixels(x,y,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,b);
    return b;
  };
  const kb = grab(0x000000), kw = grab(0xffffff);

  // 구름 픽셀만 골라 재야 합니다 — 빈 하늘이 섞이면 운량 차이가
  // 밝기 차이로 둔갑합니다.
  let n=0, sumL=0, sumL2=0, sumA=0, sumR=0, sumG=0, sumB=0;
  for (let p=0; p<TW*TH; p++) {
    const a = Math.max(0, Math.min(1, 1 - (kw[p*4+1]-kb[p*4+1])/255));
    sumA += a;
    if (a < 0.5) continue;                      // 반투명 가장자리 제외
    // 검정 배경에서 읽은 값 = a × 구름색. a로 되돌립니다.
    const r = kb[p*4]/a, g = kb[p*4+1]/a, b = kb[p*4+2]/a;
    const L = 0.2126*r + 0.7152*g + 0.0722*b;
    sumL += L; sumL2 += L*L; sumR += r; sumG += g; sumB += b; n++;
  }
  const meanL = n ? sumL/n : 0;
  const rms = n ? Math.sqrt(Math.max(0, sumL2/n - meanL*meanL)) : 0;
  const mR = n? sumR/n:0, mG = n? sumG/n:0, mB = n? sumB/n:0;
  const warm = mG > 0.5 ? mR/mG : 0;           // 붉은기 (1보다 크면 따뜻)

  renderer.setClearColor(0x1d4f77,1);
  renderer.setViewport(x,y,TW,TH);
  renderer.setScissor(x,y,TW,TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const d = document.createElement('div');
  d.className='lbl';
  d.style.left = (col*TW+8+12)+'px';
  d.style.top  = (row*TH+8+34)+'px';
  d.innerHTML = (caption||name) + '<br>τ' + optics.tau + ' 그늘' + optics.shadowContrast +
    '<br>밝기 ' + meanL.toFixed(0) + '  결 ' + rms.toFixed(1) +
    '<br>운량 ' + (sumA/(TW*TH)*100).toFixed(0) + '%  R/G ' + warm.toFixed(2);
  labels.appendChild(d);
  return { name, layer, tau:optics.tau, 그늘:optics.shadowContrast,
           밝기:+meanL.toFixed(1), 결:+rms.toFixed(2),
           운량:+(sumA/(TW*TH)).toFixed(4), 붉은기:+warm.toFixed(3) };
}

const GENERA = ['Cirrus','Cirrocumulus','Cirrostratus','Altocumulus','Altostratus',
                'Stratocumulus','Stratus','Cumulus','Cumulonimbus','Nimbostratus'];
const 표현폭 = [];
GENERA.forEach((g,i) => {
  표현폭.push(shoot(g, layerOf(g), PRESET_OPTICS[g], i%COLS, Math.floor(i/COLS)));
});

// (B) 상층 폴백 비교 — 같은 권운 무늬, τ·그늘만 다릅니다.
const ci = PRESET_OPTICS.Cirrus;
const 도감권운 = shoot('Cirrus', 'high', ci, 4, 1, '권운 도감값');
const 현재폴백 = shoot('Cirrus', 'high',
  { ...ci, tau: 25, shadowContrast: 0.5 }, 5, 1, '권운 <b>현재 앱</b>');

// ── (C) 지금 앱이 실제로 보내는 값 ─────────────────────────────────────
//
// representativePresetForObserver 가 관측 기상에서 층 대표 운형을 뽑고,
// 1단계 수정 뒤로는 τ·그늘·조각이 **모두 그 운형 하나**에서 나옵니다.
// 관측 운량을 바꿔 가며 실제로 다른 하늘이 나오는지 봅니다.
const 관측예 = [
  { 라벨: '상층 20%', layer: 'high', obs: { high: 20, mid: 0, low: 0 } },
  { 라벨: '상층 80%', layer: 'high', obs: { high: 80, mid: 0, low: 0 } },
  { 라벨: '중층 40%', layer: 'mid',  obs: { high: 0, mid: 40, low: 0 } },
  { 라벨: '중층 85%', layer: 'mid',  obs: { high: 0, mid: 85, low: 0 } },
  { 라벨: '저층 40%', layer: 'low',  obs: { high: 0, mid: 0, low: 40 } },
  { 라벨: '저층 85%', layer: 'low',  obs: { high: 0, mid: 0, low: 85, humidity: 60 } },
];
const 앱경로 = 관측예.map((c, i) => {
  const name = representativePresetForObserver(c.layer, c.obs);
  const o = PRESET_OPTICS[name];
  const r = shoot(name, c.layer, o, i, 2, c.라벨 + ' → ' + name);
  r.라벨 = c.라벨;
  return r;
});

const glErr = gl.getError();
window.__stats = { glError: glErr, 표현폭, 도감권운, 현재폴백, 앱경로 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length?'SHADER_ERR':'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'genus-range.html'), html);
console.log('생성 완료: genus-range.html');
