/**
 * **배율 훑기** — 폰 실제 픽셀 수에서 내부 렌더 해상도를 얼마나 낮출 것인가.
 *
 * ## 앞 습작에서 넘어온 질문
 *
 * `build-register-study.js`가 "블러가 아니라 저해상도가 맞다"까지는
 * 보여줬지만, 거기서 쓴 배율(330px → 110px)은 **폰에서 실제로 일어날 일보다
 * 훨씬 거칩니다.** 폰은 3배율에서 같은 화각에 1000px 넘게 씁니다. 그래서
 * 배율은 처음부터 다시 골라야 합니다.
 *
 * ## 어떻게 폰과 같은 조건으로 재나
 *
 * 기준 폰: 하늘 영역 **1080 × 1440 물리 픽셀** (3배율 × 360×480pt),
 * 세로 화각 62°. 즉 **23.2 px/°**.
 *
 * 그 화면을 통째로 렌더하면 1.5M 픽셀이라 SwiftShader에서 느리고, 어차피
 * 보여줄 때는 잘라 봐야 합니다. 그래서 **잘라낼 영역만** 같은 각해상도로
 * 렌더합니다 — 560×420 px 창에 세로 화각 18.1°를 담으면 23.2 px/° 로
 * 전체 화면을 렌더한 뒤 잘라낸 것과 **픽셀 단위로 같습니다.**
 *
 * 그리고 화면에 1:1 물리 픽셀로 보여줍니다. 논리 크기로 줄여 보여주면
 * 재려는 차이 자체가 사라집니다.
 *
 * ## 무엇을 재나
 *
 *  - **운량** — 배율이 예보를 밀면 안 됩니다.
 *  - **경계 밀도** — 표시 크기에서 알파가 0.5를 넘나드는 픽셀의 비율.
 *    "색종이 조각 → 읽히는 덩어리"가 정확히 이 값이 줄어드는 것입니다.
 *    저해상도의 효과를 숫자로 잡는 유일한 지표라, 눈과 함께 봅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-scale-sweep.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

// 기준 폰 (3배율 × 360×480pt 하늘 영역)
const PHONE_W = 1080, PHONE_H = 1440, PHONE_FOV = 62;
// 잘라 볼 창 (물리 픽셀). 이 창의 화각은 위 각해상도에서 역산합니다.
const CW = 560, CH = 420;
const PX_PER_DEG = PHONE_H / PHONE_FOV;
const CROP_FOV = CH / PX_PER_DEG;

const SCALES = [1, 1.5, 2, 3, 4];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0e1319;font-family:sans-serif;color:#dde}
 #wrap{position:relative;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.82);
   padding:5px 8px;border-radius:5px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>내부 렌더 배율 훑기 — 기준 폰 ${PHONE_W}×${PHONE_H} 물리픽셀 / 화각 ${PHONE_FOV}° (= ${PX_PER_DEG.toFixed(1)} px/°)</h3>
<p class="sub">각 칸은 <b>1:1 물리 픽셀</b>입니다. 화면에서 보이는 그대로가 폰에서 보일 것입니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS, blendedOpticsFromWeather } from './app/utils/cloudPresets.js';
import { WeatherFan, buildSkyColumns, solveColumnOptics, solveDirectionalShade,
         PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, skyRadiance, applyCloudDimming,
         angularSeparationDeg } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const CW=${CW}, CH=${CH}, CROP_FOV=${CROP_FOV}, PX_PER_DEG=${PX_PER_DEG};
const SCALES = ${JSON.stringify(SCALES)};

const canvas = document.getElementById('c');
canvas.width = CW*SCALES.length; canvas.height = CH;
const ctx2d = canvas.getContext('2d');

const glCanvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

// 앞 습작과 **같은 하늘**이어야 비교가 이어집니다.
const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
function ring() {
  const one = (d, az) => ({ distance:d, azimuthOffset:az,
    low: 22, mid: 48, high: 40, humidity: 66, precipitation: 0, visibility: 22000 });
  const out = [one(0,0)];
  for (const az of RING_AZ) for (const d of RING_D) out.push(one(d,az));
  return out;
}
const SUN_ALT = 3.5, SUN_AZ = 268;
// 태양 정면은 과노출이라 배율 차이가 안 보입니다. 조각과 파란 하늘이
// 대비되는 쪽 — 태양에서 옆으로 비킨 중고도 — 을 봅니다.
const VIEW_AZ = 238, VIEW_ELEV = 27;
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), SUN_AZ), driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});
const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240, betaMie: 0.09, humidityPct: 66,
});
const wx = { precipitation:0, humidity:66, lowPct:22, highPct:40 };
const tauFor = (l) => blendedOpticsFromWeather(l, l==='low'?0.22:l==='mid'?0.48:0.40, wx, 0.5).tau;
const optics = solveColumnOptics(samples, SUN_AZ, SUN_ALT, tauFor);
const shade  = solveDirectionalShade(samples, SUN_AZ, SUN_ALT, tauFor);

const sA = SUN_ALT*Math.PI/180, sZ = SUN_AZ*Math.PI/180;
const sunDir = new THREE.Vector3(
  Math.cos(sA)*Math.sin(sZ), Math.sin(sA), -Math.cos(sA)*Math.cos(sZ)).normalize();

// 잘라낼 창의 화각. 전체 화면을 렌더한 뒤 자른 것과 픽셀 단위로 같습니다.
const cam = new THREE.PerspectiveCamera(CROP_FOV, CW/CH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');
const tmpCanvas = document.createElement('canvas');
const tmpCtx = tmpCanvas.getContext('2d');

function render(scale, bg) {
  const w = Math.max(1, Math.round(CW/scale)), h = Math.max(1, Math.round(CH/scale));
  renderer.setSize(w, h, false);
  cam.aspect = w/h;
  cam.updateProjectionMatrix();
  updateCloudDeck(deck, {
    samples,
    beamFor: (altKm) => beamAtAltitude(SUN_ALT, altKm, atmosphere),
    beamShade: shade,
    ambientFor: (layer, azDeg) => {
      const f = optics.diffuseFactor[layer];
      const gU = angularSeparationDeg(azDeg, 70, SUN_AZ, SUN_ALT);
      const gD = angularSeparationDeg(azDeg, 15, SUN_AZ, SUN_ALT);
      return {
        up: applyCloudDimming(skyRadiance(70, gU, SUN_ALT, atmosphere), f),
        down: applyCloudDimming(skyRadiance(15, gD, SUN_ALT, atmosphere), f),
      };
    },
    sunDir, sunAltDeg: SUN_ALT,
    tauFor, shadowFor: (l) => blendedOpticsFromWeather(l, 0.4, wx, 0.5).shadowContrast,
    cellFor: (l) => PRESET_OPTICS[l==='high'?'Cirrus':l==='mid'?'Altocumulus':'Cumulus'],
    genusFor: (layer, at) => blendedOpticsFromWeather(layer, at.cover,
      { precipitation:at.precipMmH, humidity:at.humidityPct, lowPct:0, highPct:at.highPct }, 0.5),
    // 픽셀당 각크기는 **실제 렌더 높이**에서 나와야 합니다. 이게 밉 보정을
    // 함께 넓혀 주어, 결과가 "초점 안 맞은 사진"이 아니라 "덜 그린 그림"이
    // 됩니다.
    pixelAngleRad: (CROP_FOV*Math.PI/180)/h,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom,
    elevScale: atmosphere.elevScale, timeSeconds: 0, visible: true,
  });
  renderer.setClearColor(bg, 1);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*w*h);
  gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return { buf, w, h };
}

function toImageData({ buf, w, h }) {
  const img = ctx2d.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h-1-y)*w*4, dst = y*w*4;
    for (let i = 0; i < w*4; i++) img.data[dst+i] = buf[src+i];
  }
  return img;
}

/** 표시 크기(CW×CH)에서의 알파 지도. 배율이 달라도 같은 축척에서 비교됩니다. */
function alphaAtDisplaySize(scale) {
  const a = render(scale, 0x000000), b = render(scale, 0xffffff);
  const ia = toImageData(a), ib = toImageData(b);
  const up = (im) => {
    tmpCanvas.width = im.width; tmpCanvas.height = im.height;
    tmpCtx.putImageData(im, 0, 0);
    const c2 = document.createElement('canvas');
    c2.width = CW; c2.height = CH;
    const x2 = c2.getContext('2d');
    x2.imageSmoothingEnabled = true;
    x2.drawImage(tmpCanvas, 0, 0, im.width, im.height, 0, 0, CW, CH);
    return x2.getImageData(0, 0, CW, CH).data;
  };
  const da = up(ia), db = up(ib);
  const alpha = new Float32Array(CW*CH);
  for (let p = 0; p < CW*CH; p++) {
    alpha[p] = Math.max(0, Math.min(1, 1 - (db[p*4+1]-da[p*4+1])/255));
  }
  return alpha;
}

/**
 * 경계 밀도 — 이웃과 0.5 선을 사이에 둔 픽셀의 비율.
 * 조각이 잘게 흩어질수록 큽니다. 저해상도가 하는 일이 정확히 이걸 줄이는 것.
 */
function edgeDensity(alpha) {
  let n = 0;
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW-1; x++) {
      const i = y*CW+x;
      if ((alpha[i] > 0.5) !== (alpha[i+1] > 0.5)) n++;
    }
  }
  for (let y = 0; y < CH-1; y++) {
    for (let x = 0; x < CW; x++) {
      const i = y*CW+x;
      if ((alpha[i] > 0.5) !== (alpha[i+CW] > 0.5)) n++;
    }
  }
  return n / (CW*CH);
}

const 결과 = [];
SCALES.forEach((s, i) => {
  const alpha = alphaAtDisplaySize(s);
  let cover = 0;
  for (let p = 0; p < CW*CH; p++) cover += alpha[p];
  cover /= CW*CH;
  const edges = edgeDensity(alpha);

  const shot = render(s, 0x2b4d70);
  const img = toImageData(shot);
  tmpCanvas.width = shot.w; tmpCanvas.height = shot.h;
  tmpCtx.putImageData(img, 0, 0);
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.drawImage(tmpCanvas, 0, 0, shot.w, shot.h, i*CW, 0, CW, CH);

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (i*CW + 8 + 12) + 'px';
  d.style.top = '56px';
  d.innerHTML =
    '×' + s + (s === 1 ? ' (현재)' : s === 3 ? ' (논리 해상도)' : '') +
    '<br>' + shot.w + '×' + shot.h + ' px  ' + (PX_PER_DEG/s).toFixed(1) + ' px/°' +
    '<br>운량 ' + (cover*100).toFixed(1) + '%' +
    '<br>경계밀도 ' + (edges*100).toFixed(2) + '%';
  labels.appendChild(d);

  결과.push({
    배율: s, 렌더: shot.w + '×' + shot.h,
    'px/도': +(PX_PER_DEG/s).toFixed(1),
    운량: +(cover*100).toFixed(2),
    경계밀도: +(edges*100).toFixed(3),
    '픽셀 부하': +(1/(s*s)).toFixed(3),
  });
});

const base = 결과[0];
window.__stats = {
  glError: gl.getError(),
  기준폰: { 물리픽셀: '${PHONE_W}×${PHONE_H}', 화각: ${PHONE_FOV}, 'px/도': +PX_PER_DEG.toFixed(1) },
  잘라본창: { px: CW + '×' + CH, 화각: +CROP_FOV.toFixed(1) },
  결과: 결과.map(r => ({
    ...r,
    운량차: +(r.운량 - base.운량).toFixed(2),
    경계밀도비: +(r.경계밀도 / base.경계밀도).toFixed(3),
  })),
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'scale-sweep.html'), html);
console.log('생성 완료: scale-sweep.html');
console.log(`  기준 폰 ${PHONE_W}×${PHONE_H} / 화각 ${PHONE_FOV}° = ${PX_PER_DEG.toFixed(1)} px/°`);
console.log(`  잘라 본 창 ${CW}×${CH} px = 화각 ${CROP_FOV.toFixed(1)}°`);
