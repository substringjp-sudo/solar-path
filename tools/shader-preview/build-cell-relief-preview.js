/**
 * 조각별 **입체 음영**이 실제 픽셀에 나오는지 봅니다.
 *
 * ## 무엇을 확인하나
 *
 * 이 전까지 덱은 한 방향 안에서 모든 조각이 같은 밝기였습니다 — 조각은
 * 알파로만 오려내고 색은 시선·광학두께로만 정해졌으니까요. 그래서 하늘이
 * 오려붙인 종이처럼 보였습니다.
 *
 * 지금은 셀 값을 구름 윗면 높이로 읽고, **태양 쪽으로 한 번 더 뽑아**
 * 기울기를 냅니다. 값이 태양 쪽으로 커지면 그쪽이 더 두껍다 = 여기는 반대
 * 사면 → 어둡게. 그 결과 조각마다 밝은 면과 그늘 면이 생깁니다.
 *
 * ## 어떻게 재나
 *
 * 세기 상수를 끄고 켤 손잡이가 없으므로 **차등 검사**로 잽니다. 입체감은
 * `0.30 + 0.55 × (낮은 태양일수록 1)` 로 스케일되므로:
 *
 *  - 같은 장면을 태양 고도 5°와 70°로 두 번 찍습니다. 낮은 태양 쪽이
 *    구름 픽셀 안의 **밝기 표준편차**가 뚜렷이 커야 합니다.
 *  - 대조군으로 층운(cellStrength = 0, WMO 정의상 요소가 없는 구름)을
 *    같은 방식으로 찍습니다. 조각이 없으니 태양 고도를 바꿔도 조각 규모
 *    밝기 편차가 거의 안 변해야 합니다.
 *
 * 대조군이 없으면 "태양을 낮췄더니 대비가 커졌다"가 입체감 때문인지 그냥
 * 노을빛 때문인지 구분할 수 없습니다.
 *
 * 밝기 편차는 **국소**로 잽니다 (7×7 창 안의 표준편차를 평균). 화면 전체
 * 표준편차로 재면 하늘 전체의 밝기 기울기가 섞여 조각 규모 신호가 묻힙니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cell-relief-preview.js
 *       node tools/shader-preview/shoot.js cell-relief.html cell-relief.png
 *       node tools/shader-preview/verify-cell-relief.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const COVER = 0.62;
const VIEW_ELEV = 35;
const FOV_DEG = 60;
const TW = 384, TH = 384;
const SUN_ALTS = [5, 70];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>조각 입체 음영 — 태양 5° vs 70° (위: 고적운, 아래: 층운 대조군)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS } from './app/utils/cloudPresets.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const COVER = ${COVER}, VIEW_ELEV = ${VIEW_ELEV}, FOV_DEG = ${FOV_DEG};
const TW = ${TW}, TH = ${TH};
const SUN_ALTS = ${JSON.stringify(SUN_ALTS)};

const canvas = document.getElementById('c');
canvas.width = TW * 2; canvas.height = TH * 2;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(TW * 2, TH * 2, false);

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

const ELEVS = [];
for (let i = 0; i < 8; i++) ELEVS.push(Math.asin((i + 0.5) / 8) * 180 / Math.PI);
const samples = [];
for (const layer of ['low', 'mid', 'high']) {
  for (let a = 0; a < 24; a++) {
    for (const e of ELEVS) {
      samples.push({ layer, azimuthDeg: (a * 360) / 24, elevationDeg: e,
        distanceKm: 12, confidence: 1, cover: layer === 'mid' ? COVER : 0 });
    }
  }
}

const white = { r: 1.2, g: 1.2, b: 1.25 };
const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);
cam.up.set(0, 1, 0);
const er = VIEW_ELEV * Math.PI / 180;
// 태양 방위(270°) 쪽을 봅니다 — 입체감이 가장 잘 드러나는 방향입니다.
cam.lookAt(-100 * Math.cos(er), 100 * Math.sin(er), 0);
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(genus, sunAlt, x, y) {
  const o = PRESET_OPTICS[genus];
  const sAlt = sunAlt * Math.PI / 180, sAz = 270 * Math.PI / 180;
  updateCloudDeck(deck, {
    samples,
    beamFor: () => white,
    ambientFor: () => ({ up: white, down: { r: 0.55, g: 0.6, b: 0.7 } }),
    sunDir: new THREE.Vector3(Math.cos(sAlt) * Math.sin(sAz), Math.sin(sAlt),
                             -Math.cos(sAlt) * Math.cos(sAz)).normalize(),
    sunAltDeg: sunAlt,
    tauFor: () => o.tau,
    shadowFor: () => 0.35,
    cellFor: () => ({ cellSizeKm: o.cellSizeKm, cellStrength: o.cellStrength,
                      cellVariant: o.cellVariant, cellAspect: o.cellAspect }),
    pixelAngleRad: (FOV_DEG * Math.PI / 180) / TH,
    windBearingDeg: 260,
    betaMie: 0.08, angstrom: 1.3, elevScale: 1.0,
    timeSeconds: 0, visible: true,
  });

  const grab = (bg) => {
    renderer.setClearColor(bg, 1);
    renderer.setViewport(x, y, TW, TH);
    renderer.setScissor(x, y, TW, TH);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, cam);
    const b = new Uint8Array(4 * TW * TH);
    gl.readPixels(x, y, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return b;
  };
  const kb = grab(0x000000), kw = grab(0xffffff);

  // 알파 (두 배경 분리) 와 휘도.
  const alpha = new Float32Array(TW * TH);
  const lum = new Float32Array(TW * TH);
  for (let p = 0; p < TW * TH; p++) {
    alpha[p] = Math.max(0, Math.min(1, 1 - (kw[p * 4 + 1] - kb[p * 4 + 1]) / 255));
    // 검은 배경 위 색은 C·a 이므로 알파로 나눠 **구름 자체 색**을 복원합니다.
    // 이렇게 안 하면 가장자리 반투명이 어두운 픽셀로 잡혀 가짜 편차가 됩니다.
    const a = Math.max(0.02, alpha[p]);
    lum[p] = (0.2126 * kb[p * 4] + 0.7152 * kb[p * 4 + 1] + 0.0722 * kb[p * 4 + 2]) / 255 / a;
  }

  // 국소(7×7) 표준편차의 평균. 구름이 확실히 덮은 픽셀만 셉니다.
  //
  // 문턱이 0.85면 **층운 대조군이 한 점도 안 잡힙니다** — 조각이 없어
  // 알파가 운량 그대로(0.62)라 절대 0.85를 못 넘습니다. 그러면 대조군 비가
  // 0/0이 되어 비교가 무의미하게 통과합니다. 두 쪽 다 잡히는 값으로 낮추고,
  // 아래 검사에서 대조군에도 표본이 있는지 확인합니다.
  const OPAQUE = 0.50;
  const RAD = 3, M = 24;
  let sdSum = 0, sdN = 0, aSum = 0;
  for (let py = M; py < TH - M; py++) {
    for (let px = M; px < TW - M; px++) {
      const p = py * TW + px;
      aSum += alpha[p];
      if (alpha[p] < OPAQUE) continue;
      let s = 0, s2 = 0, n = 0, ok = true;
      for (let dy = -RAD; dy <= RAD && ok; dy++) {
        for (let dx = -RAD; dx <= RAD; dx++) {
          const q = (py + dy) * TW + (px + dx);
          if (alpha[q] < OPAQUE) { ok = false; break; }
          s += lum[q]; s2 += lum[q] * lum[q]; n++;
        }
      }
      if (!ok || n < 9) continue;
      const m = s / n;
      sdSum += Math.sqrt(Math.max(0, s2 / n - m * m));
      sdN++;
    }
  }

  renderer.setClearColor(0x2e6d96, 1);
  renderer.setViewport(x, y, TW, TH);
  renderer.setScissor(x, y, TW, TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const stat = {
    국소편차: sdN > 0 ? sdSum / sdN : 0,
    표본: sdN,
    운량: aSum / ((TH - 2 * M) * (TW - 2 * M)),
  };
  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 8) + 'px';
  d.style.top = ((y === TH ? 0 : 1) * TH + 34) + 'px';
  d.textContent = genus + '  태양 ' + sunAlt + '°  국소편차 ' +
    stat.국소편차.toFixed(4) + '  (' + stat.표본 + '점)';
  labels.appendChild(d);
  return stat;
}

const 고적운 = SUN_ALTS.map((s, i) => shoot('Altocumulus', s, i * TW, TH));
const 층운 = SUN_ALTS.map((s, i) => shoot('Stratus', s, i * TW, 0));

const glErr = gl.getError();
window.__stats = {
  glError: glErr,
  프리셋: { 고적운: PRESET_OPTICS.Altocumulus.cellStrength,
            층운: PRESET_OPTICS.Stratus.cellStrength },
  고적운: { 낮은태양: 고적운[0], 높은태양: 고적운[1],
            비: 고적운[0].국소편차 / Math.max(1e-9, 고적운[1].국소편차) },
  층운: { 낮은태양: 층운[0], 높은태양: 층운[1],
          비: 층운[0].국소편차 / Math.max(1e-9, 층운[1].국소편차) },
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cell-relief.html'), html);
console.log('생성 완료: cell-relief.html');
