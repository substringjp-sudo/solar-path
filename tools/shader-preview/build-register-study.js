/**
 * **레지스터 습작** — 같은 하늘을 다른 "매체"로 그려 봅니다.
 *
 * ## 무엇을 묻는 것인가
 *
 * 이건 정확도 실험이 아닙니다. 기상값·카메라·태양이 다섯 칸 모두 **완전히
 * 같고**, 다른 것은 그리는 방식뿐입니다. 질문은 "어느 것이 맞는가"가 아니라
 * **"어느 것이 나가서 하늘을 보고 싶게 하는가"** 입니다.
 *
 * ## 다섯 칸이 각각 무엇을 분리하는가
 *
 *   1 현재              기준선
 *   2 균일 블러         "그린 뒤 뭉갠다" — 저역 통과 필터 (대조군)
 *   3 저해상도 ×3       "덜 그린다" — 렌더 자체를 1/3로, 쌍선형 확대
 *   4 저해상도 + 결     3 + 화면 좌표계 그레인(= 매체)
 *   5 끊긴 윤곽 + 결    원해상도, 윤곽만 비확정적으로
 *
 * 2와 3의 차이가 이 습작의 핵심입니다. 둘 다 "덜 선명"하지만 하나는 그린
 * 뒤 뭉갠 것이고 하나는 애초에 덜 그린 것입니다. 저해상도는 픽셀당 각크기가
 * 커져 밉 보정까지 따라 넓어지므로, 결과가 "초점이 안 맞은 사진"이 아니라
 * "해상도가 낮은 그림"으로 읽히는지가 관건입니다.
 *
 * ⚠ 1차 시도에서 끊는 잡음을 조각의 37배로 잡았더니 화면에서 픽셀 얼룩이
 * 됐지 윤곽이 울퉁불퉁해지지 않았습니다. 지금은 4배입니다.
 *
 * ## 통제
 *
 * 칸마다 **운량**을 함께 잽니다. 표현을 바꾸다 예보 운량이 밀리면 그건
 * 취향 문제가 아니라 정확도 손실이므로 숫자로 보여야 합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-register-study.js
 *       node tools/shader-preview/shoot.js register-study.html register-study.png
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 330, TH = 400, COLS = 5;
const VIEW_AZ = 268, VIEW_ELEV = 12, FOV_DEG = 62;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0e1319;font-family:sans-serif;color:#dde}
 #wrap{position:relative;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.4}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>레지스터 습작 — 기상값·카메라·태양이 전부 같습니다. 그리는 방식만 다릅니다.</h3>
<p class="sub">판단 기준: "정확한가"가 아니라 <b>"나가서 하늘을 보고 싶은가"</b></p>
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

const TW=${TW}, TH=${TH}, COLS=${COLS};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, FOV_DEG=${FOV_DEG};

// 화면 합성용 2D 캔버스 (블러·그레인은 **화면 후처리**가 맞습니다 —
// 실제로 적용한다면 전체 화면 패스가 될 것이므로).
const canvas = document.getElementById('c');
canvas.width = TW*COLS; canvas.height = TH;
const ctx2d = canvas.getContext('2d');

// 렌더는 오프스크린에서 한 칸씩.
const gl3 = document.createElement('canvas');
gl3.width = TW; gl3.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: gl3, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW, TH, false);

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

// 노을 직전, 중·상층이 섞인 하늘. 사진 ①에 가까운 배치입니다.
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
const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

// 저해상도 업스케일용 임시 캔버스
const tmpCanvas = document.createElement('canvas');
const tmpCtx = tmpCanvas.getContext('2d');

function renderDeck({ edgeSoften = 0, edgeBreak = 0, scale = 1 }, bg) {
  // **해상도를 실제로 낮춥니다.** 블러와 다른 점: 렌더 자체가 거칠어지고
  // 픽셀당 각크기가 커져서 밉 보정도 따라 넓어집니다. 즉 "덜 그린" 것이지
  // "그린 뒤 뭉갠" 것이 아닙니다.
  const w = Math.max(1, Math.round(TW/scale)), h = Math.max(1, Math.round(TH/scale));
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
    edgeSoften, edgeBreak,
    pixelAngleRad: (FOV_DEG*Math.PI/180)/h,
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

/** 알파(=운량)는 검정·흰 두 배경으로 분리합니다. 표현이 예보를 밀었는지 봅니다. */
function measureCover(opts) {
  const a = renderDeck(opts, 0x000000);
  const b = renderDeck(opts, 0xffffff);
  let s = 0;
  const n = a.w * a.h;
  for (let p = 0; p < n; p++) {
    s += Math.max(0, Math.min(1, 1 - (b.buf[p*4+1]-a.buf[p*4+1])/255));
  }
  return s / n;
}

// WebGL 읽기는 아래가 y=0 이라 뒤집어 ImageData 로 옮깁니다.
function toImageData({ buf, w, h }) {
  const img = ctx2d.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h-1-y)*w*4, dst = y*w*4;
    for (let i = 0; i < w*4; i++) img.data[dst+i] = buf[src+i];
  }
  return img;
}

/** 분리 가능한 박스 블러 — 저역 통과. 고주파를 **지웁니다.** */
function blur(img, radius) {
  const { width:w, height:h, data } = img;
  const tmp = new Uint8ClampedArray(data);
  const pass = (src, dst, horizontal) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r=0,g=0,b=0,n=0;
      for (let k = -radius; k <= radius; k++) {
        const xx = horizontal ? Math.min(w-1, Math.max(0, x+k)) : x;
        const yy = horizontal ? y : Math.min(h-1, Math.max(0, y+k));
        const i = (yy*w+xx)*4;
        r+=src[i]; g+=src[i+1]; b+=src[i+2]; n++;
      }
      const o = (y*w+x)*4;
      dst[o]=r/n; dst[o+1]=g/n; dst[o+2]=b/n; dst[o+3]=255;
    }
  };
  const mid = new Uint8ClampedArray(data.length);
  pass(tmp, mid, true);
  pass(mid, data, false);
  return img;
}

/**
 * 화면 좌표계 결 — **매체**.
 *
 * 월드가 아니라 화면에 고정돼 있어야 종이·필름처럼 읽힙니다. 월드에 고정하면
 * 하늘의 성질처럼 보여서 오히려 오류로 읽힙니다.
 */
function grain(img, amount) {
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y*img.width+x)*4;
      // 결정적 해시 — 같은 그림이 매번 같게 나와야 비교가 됩니다.
      const n = (Math.sin((x*127.1 + y*311.7)) * 43758.5453) % 1;
      const v = (n - Math.floor(n) - 0.5) * amount;
      d[i] += v*255; d[i+1] += v*255; d[i+2] += v*255;
    }
  }
  return img;
}

const PANELS = [
  { name: '1 현재',              opts: {} },
  { name: '2 균일 블러',         opts: {},            blur: 4 },
  { name: '3 저해상도 ×3',       opts: { scale: 3 } },
  { name: '4 저해상도 ×3 + 결',  opts: { scale: 3 },  grain: 0.10 },
  { name: '5 끊긴 윤곽 + 결',    opts: { edgeSoften: 0.08, edgeBreak: 0.22 }, grain: 0.10 },
];

const 결과 = [];
PANELS.forEach((p, i) => {
  const cover = measureCover(p.opts);
  const shot = renderDeck(p.opts, 0x2b4d70);
  const img = toImageData(shot);

  // 저해상도는 **쌍선형 확대**로 올립니다 — 기기 화면에서 실제로 일어날 일.
  tmpCanvas.width = shot.w; tmpCanvas.height = shot.h;
  tmpCtx.putImageData(img, 0, 0);
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.drawImage(tmpCanvas, 0, 0, shot.w, shot.h, i*TW, 0, TW, TH);

  // 블러·그레인은 확대 **후** 화면 픽셀에 겁니다 (전체 화면 패스가 될 자리).
  if (p.blur || p.grain) {
    const full = ctx2d.getImageData(i*TW, 0, TW, TH);
    if (p.blur) blur(full, p.blur);
    if (p.grain) grain(full, p.grain);
    ctx2d.putImageData(full, i*TW, 0);
  }

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (i*TW + 8 + 12) + 'px';
  d.style.top = '52px';
  d.innerHTML = p.name + '<br>운량 ' + (cover*100).toFixed(1) + '%';
  labels.appendChild(d);
  결과.push({ 이름: p.name, 운량: +(cover).toFixed(4) });
});

const base = 결과[0].운량;
window.__stats = {
  glError: gl.getError(),
  결과: 결과.map(r => ({ ...r, 기준선대비: +((r.운량 - base) * 100).toFixed(2) })),
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'register-study.html'), html);
console.log('생성 완료: register-study.html');
