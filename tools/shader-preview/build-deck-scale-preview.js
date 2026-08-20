/**
 * 덱을 **실제로 렌더해서 조각 각크기를 잽니다**
 * (docs/CLOUD_TEXTURE_PLAN.md 2단계).
 *
 * ## 이게 2단계의 합격 판정입니다
 *
 * 1단계는 무늬를 굽기만 했고 조각 각크기는 42.4° 그대로였습니다. 2단계는
 * 그 무늬를 **지상거리 투영**으로 하늘에 붙여 각크기를 1~3°로 내리는 일입니다.
 * 그게 됐는지는 셰이더 식을 옮겨 적어 재면 안 됩니다 — 앱과 같은 코드가
 * 그린 픽셀에서 재야 합니다. 그래서 `CloudDeck.ts`를 그대로 임포트해
 * `createCloudDeck`/`updateCloudDeck`으로 씬을 만들고 화면을 읽습니다.
 *
 * ## 어떻게 재나
 *
 * 카메라를 특정 시선 고도로 고정하고 렌더한 뒤, **화면 중앙 가로줄**에서
 * 알파가 0↔1을 넘나드는 횟수를 셉니다. 그 줄이 덮는 각도를 교차 수로 나누면
 * 조각 하나의 평균 각크기가 나옵니다.
 *
 * 시선 고도를 여러 개 훑는 이유: 2단계의 핵심 주장이 "원근 단축이 생긴다"
 * 이므로, **고도가 낮을수록 조각이 작아져야** 합니다. 예전 투영은 고도에
 * 무관하게 같은 크기였습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-deck-scale-preview.js
 *       node tools/shader-preview/shoot.js deck-scale.html deck-scale.png
 *       node tools/shader-preview/verify-deck-scale.js
 */
const fs = require('fs');
const path = require('path');
const PREVIEW =
  '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';

// 카메라가 바라볼 시선 고도. 낮을수록 구름이 멀어 조각이 작아져야 합니다.
const VIEW_ELEVS = [60, 45, 30, 20, 12, 8];
const COVER = 0.39;
const FOV_DEG = 60;      // 세로 화각
const TW = 384, TH = 384;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:1176px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>덱을 실제로 렌더 — 시선 고도별 조각 각크기 (고적운, 운량 ${COVER})</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const VIEW_ELEVS = ${JSON.stringify(VIEW_ELEVS)};
const COVER = ${COVER}, FOV_DEG = ${FOV_DEG};
const TW = ${TW}, TH = ${TH}, COLS = 3, ROWS = 2;

const canvas = document.getElementById('c');
canvas.width = COLS * TW; canvas.height = ROWS * TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(COLS * TW, ROWS * TH, false);
// 반투명 층의 **알파를 정확히** 재려고 두 배경으로 두 번 그립니다.
// 색 문턱으로 재면 가장자리 반투명 픽셀과 그늘진 구름이 뒤섞여
// 운량이 과소 계상됩니다 (처음에 그렇게 재서 0.39가 0.25로 나왔습니다).
//   over_black = C·a,  over_white = C·a + (1-a)
//   ⇒ a = 1 - (over_white - over_black)
const BG = [0x000000, 0xffffff];

const maxAniso = renderer.capabilities.getMaxAnisotropy();
const t0 = performance.now();
const deck = createCloudDeck({ maxAnisotropy: maxAniso });
const bakeMs = performance.now() - t0;

const scene = new THREE.Scene();
scene.add(deck.group);

// 격자와 같은 방향 목록으로 합성 샘플을 만듭니다 (방위 24 × 고도 8).
// 운량을 **모든 방향에 동일**하게 줍니다 — 조각 크기만 보려는 것이라
// 운량 변화가 섞이면 측정이 흐려집니다.
const ELEVS = [];
for (let i = 0; i < 8; i++) {
  // skyColumn의 등입체각 격자와 같은 형태 (sin 균등)
  const t = (i + 0.5) / 8;
  ELEVS.push(Math.asin(t) * 180 / Math.PI);
}
const samples = [];
for (const layer of ['low', 'mid', 'high']) {
  for (let a = 0; a < 24; a++) {
    for (const e of ELEVS) {
      samples.push({
        layer, azimuthDeg: (a * 360) / 24, elevationDeg: e,
        distanceKm: 10, confidence: 1,
        // 중층만 그립니다. 저·상층은 0으로 두어 한 겹만 재게 합니다.
        cover: layer === 'mid' ? COVER : 0,
      });
    }
  }
}

const white = { r: 1.2, g: 1.2, b: 1.25 };
updateCloudDeck(deck, {
  samples,
  beamFor: () => white,
  ambientFor: () => ({ up: white, down: { r: 0.55, g: 0.6, b: 0.7 } }),
  sunDir: new THREE.Vector3(0, 0.6, -0.8).normalize(),
  sunAltDeg: 37,
  tauFor: () => 16,
  shadowFor: () => 0.48,
  cellFor: () => ({ cellSizeKm: 0.5, cellStrength: 0.95, cellVariant: 'billow' }),
  pixelAngleRad: (FOV_DEG * Math.PI / 180) / TH,
  timeSeconds: 0,
  visible: true,
});

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);

const gl = renderer.getContext();
const labels = document.getElementById('labels');
const stats = [];

VIEW_ELEVS.forEach((viewElev, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x = col * TW, y = (ROWS - 1 - row) * TH;

  const er = viewElev * Math.PI / 180;
  cam.up.set(0, 1, 0);
  cam.lookAt(100 * Math.cos(er), 100 * Math.sin(er), 0);

  const shot = (bg) => {
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
  const onBlack = shot(BG[0]);
  const onWhite = shot(BG[1]);

  // 픽셀별 알파 (초록 채널 기준 — 휘도 기여가 가장 큽니다)
  const alpha = new Float32Array(TW * TH);
  for (let p = 0; p < TW * TH; p++) {
    alpha[p] = Math.max(0, Math.min(1, 1 - (onWhite[p * 4 + 1] - onBlack[p * 4 + 1]) / 255));
  }

  // 화면 중앙 가로줄에서 조각 경계 교차 (알파 0.5 기준)
  const midRow = TH >> 1;
  let crossings = 0, prev = null;
  for (let px = 0; px < TW; px++) {
    const on = alpha[midRow * TW + px] > 0.5;
    if (prev !== null && on !== prev) crossings++;
    prev = on;
  }
  const rowFovDeg = 2 * Math.atan(Math.tan(FOV_DEG * Math.PI / 360) * (TW / TH)) * 180 / Math.PI;
  // 교차 두 번이 조각 하나 + 틈 하나 = 한 주기입니다.
  const periodDeg = crossings > 0 ? (2 * rowFovDeg) / crossings : Infinity;

  // 화면 전체 평균 알파 = 실제 운량
  let sumA = 0;
  for (let p = 0; p < TW * TH; p++) sumA += alpha[p];
  const screenCover = sumA / (TW * TH);

  // **조각 하나의 각크기** = 주기 × 운량. WMO가 정의하는 것이 이쪽입니다.
  const elementDeg = crossings > 0 ? periodDeg * screenCover : null;

  stats.push({
    시선고도: viewElev,
    교차: crossings,
    주기각크기: crossings > 0 ? +periodDeg.toFixed(2) : null,
    조각각크기: elementDeg !== null ? +elementDeg.toFixed(2) : null,
    화면운량: +screenCover.toFixed(3),
  });

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 10) + 'px';
  d.style.top = (row * TH + 34) + 'px';
  d.textContent = '시선 ' + viewElev + '°  조각 ' +
    (elementDeg !== null ? elementDeg.toFixed(2) + '°' : '—') +
    '  운량 ' + screenCover.toFixed(3);
  labels.appendChild(d);

  // 보이는 그림은 하늘색 배경으로 한 번 더
  renderer.setClearColor(0x2e6d96, 1);
  renderer.setViewport(x, y, TW, TH);
  renderer.setScissor(x, y, TW, TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);
});

// ── 하늘 전체 평균 운량 ────────────────────────────────────────────────
//
// 운량 보장은 **하늘 전체**에 대한 것이지 한 프레임에 대한 것이 아닙니다.
// 패치가 국소 운량을 흔들므로 60° 창 하나를 잘라 재면 당연히 어긋납니다 —
// 실제 하늘도 그렇습니다. 여러 방위·고도를 훑어 평균해야 의미가 있습니다.
// 두 구간으로 나눠 잽니다.
//  - 높은 구간: 프레임 전체가 horizonFade = 1 인 영역 (시선 ≥ 45°, 화각 60°).
//    2단계의 합격 판정은 **여기**입니다.
//  - 낮은 구간: horizonFade가 깎는 영역. 그 항은 4단계에서 대기 투시로
//    대체되므로 지금 어긋나는 것은 예정된 일입니다.
const SWEEP_AZ = [0, 45, 90, 135, 180, 225, 270, 315];
const SWEEP_HIGH = [50, 65, 80];
const SWEEP_LOW = [15, 25, 35];
let sumAll = 0, nAll = 0;
let sumHigh = 0, nHigh = 0;
// 고도대별 운량 — 천정 특이점이나 지평선 페이드가 어디서 먹는지 봅니다.
const BANDS = [0, 10, 20, 30, 45, 60, 75, 90];
const bandSum = new Float64Array(BANDS.length - 1);
const bandN = new Float64Array(BANDS.length - 1);
// **화면 타일을 덮어쓰지 않도록** 오프스크린 타깃에 그립니다.
const rt = new THREE.WebGLRenderTarget(TW, TH);
const tanHalf = Math.tan(FOV_DEG * Math.PI / 360);
for (const az of SWEEP_AZ) {
  for (const el of SWEEP_HIGH.concat(SWEEP_LOW)) {
    const isHigh = SWEEP_HIGH.indexOf(el) >= 0;
    const ar = az * Math.PI / 180, er2 = el * Math.PI / 180;
    cam.lookAt(
      100 * Math.cos(er2) * Math.sin(ar),
      100 * Math.sin(er2),
      -100 * Math.cos(er2) * Math.cos(ar)
    );
    cam.updateMatrixWorld(true);
    const shot2 = (bg) => {
      renderer.setRenderTarget(rt);
      renderer.setScissorTest(false);
      renderer.setClearColor(bg, 1);
      renderer.clear();
      renderer.render(scene, cam);
      const b = new Uint8Array(4 * TW * TH);
      renderer.readRenderTargetPixels(rt, 0, 0, TW, TH, b);
      renderer.setRenderTarget(null);
      return b;
    };
    const kb = shot2(0x000000), kw = shot2(0xffffff);
    // 픽셀마다 실제 시선 고도를 구해 고도대에 넣습니다.
    const m = cam.matrixWorld.elements;
    const right = new THREE.Vector3(m[0], m[1], m[2]);
    const up = new THREE.Vector3(m[4], m[5], m[6]);
    const fwd = new THREE.Vector3(-m[8], -m[9], -m[10]);
    const dir = new THREE.Vector3();
    for (let py = 0; py < TH; py++) {
      const ny = ((py + 0.5) / TH) * 2 - 1;
      for (let px = 0; px < TW; px++) {
        const nx = ((px + 0.5) / TW) * 2 - 1;
        dir.copy(fwd)
          .addScaledVector(right, nx * tanHalf * (TW / TH))
          .addScaledVector(up, ny * tanHalf)
          .normalize();
        const elevDeg = Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180 / Math.PI;
        const p = py * TW + px;
        const a = Math.max(0, Math.min(1, 1 - (kw[p * 4 + 1] - kb[p * 4 + 1]) / 255));
        sumAll += a; nAll++;
        if (isHigh) { sumHigh += a; nHigh++; }
        for (let bi = 0; bi < BANDS.length - 1; bi++) {
          if (elevDeg >= BANDS[bi] && elevDeg < BANDS[bi + 1]) {
            bandSum[bi] += a; bandN[bi]++; break;
          }
        }
      }
    }
  }
}
const skyCover = sumAll / nAll;
const highCover = sumHigh / nHigh;

const glErr = gl.getError();
window.__stats = {
  굽기ms: Math.round(bakeMs), 이방성: maxAniso, glError: glErr,
  목표운량: COVER,
  하늘전체운량: +skyCover.toFixed(4),
  고도45이상운량: +highCover.toFixed(4),
  고도대: BANDS.slice(0, -1).map((lo, i) => ({
    고도대: lo + '~' + BANDS[i + 1] + '°',
    운량: bandN[i] > 0 ? +(bandSum[i] / bandN[i]).toFixed(4) : null,
    픽셀: bandN[i],
  })),
  // **입체각 가중** 하늘 평균. 픽셀 가중으로 재면 카메라를 어디에 뒀는지에
  // 따라 답이 달라집니다 (천정을 오래 본 스윕은 천정을 과대 반영합니다).
  // 고도대 [lo,hi]가 반구에서 차지하는 몫은 sin(hi) - sin(lo) 입니다.
  ...(() => {
    const rad = (dg) => (dg * Math.PI) / 180;
    let wAll = 0, cAll = 0, wUp = 0, cUp = 0;
    for (let i = 0; i < BANDS.length - 1; i++) {
      if (bandN[i] === 0) continue;
      const w = Math.sin(rad(BANDS[i + 1])) - Math.sin(rad(BANDS[i]));
      const c = bandSum[i] / bandN[i];
      wAll += w; cAll += w * c;
      if (BANDS[i] >= 10) { wUp += w; cUp += w * c; }
    }
    return {
      입체각가중운량: +(cAll / wAll).toFixed(4),
      입체각가중운량_고도10이상: +(cUp / wUp).toFixed(4),
    };
  })(),
  컷: stats,
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'deck-scale.html'), html);
console.log('생성 완료: deck-scale.html');
