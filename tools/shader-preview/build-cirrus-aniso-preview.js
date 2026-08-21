/**
 * 권운 **결의 방향성(이방성)**을 실제로 렌더해서 잽니다
 * (docs/CLOUD_TEXTURE_PLAN.md 6단계).
 *
 * ## 무엇을 확인하나
 *
 * 6단계는 권운 조각을 바람 방향으로 늘립니다 — 얼음 결정이 시어에 끌려
 * 생기는 낙하줄(fall streak)이라 실제 권운은 등방이 아니라 한 방향으로
 * 20:1 정도로 길쭉합니다. 셰이더는 지상좌표를 바람축으로 회전시킨 뒤
 * 축마다 다른 배율을 먹입니다:
 *
 *     alignedKm = (dot(groundKm, across), dot(groundKm, along))
 *     uvCell    = alignedKm * vec2(1/L, 1/(L*aspect))
 *
 * 그래서 **바람 방위를 90° 돌리면 무늬의 결도 90° 돌아야** 합니다.
 * 여기서 재는 게 그것입니다.
 *
 * ## 어떻게 재나
 *
 * 카메라·운량·층을 모두 고정한 채 `windBearingDeg`만 0° / 90°로 바꿔
 * 두 번 렌더합니다. 각 컷에서 알파장의 **방향별 기울기 에너지**를 냅니다:
 *
 *     Gx = mean|a(x+1,y) - a(x,y)|      (화면 가로)
 *     Gy = mean|a(x,y+1) - a(x,y)|      (화면 세로)
 *
 * 결이 가로로 누우면 가로로는 변화가 느려 Gx가 작고 Gy가 큽니다. 결이
 * 세로로 서면 반대가 됩니다. 즉 **비 Gx/Gy가 두 컷 사이에서 뒤집혀야**
 * 합니다.
 *
 * 화면 세로축은 지상거리 쪽이라 원근 단축을 크게 먹지만, 그 편향은 두
 * 컷에 **똑같이** 걸리므로 비의 비(ratioA/ratioB)에서 상쇄됩니다. 그래서
 * 투영을 따로 보정하지 않아도 됩니다.
 *
 * 대조군으로 권적운(등방, cellAspect = 1)을 같은 방식으로 찍습니다.
 * 등방이면 두 배율이 같아 회전이 무의미하므로 비가 **거의 안 변해야**
 * 합니다 — 이게 없으면 "바람을 돌렸더니 뭔가 달라졌다"가 이방성 때문인지
 * 그냥 다른 무늬가 걸린 것인지 구분할 수 없습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cirrus-aniso-preview.js
 *       node tools/shader-preview/shoot.js cirrus-aniso.html cirrus-aniso.png
 *       node tools/shader-preview/verify-cirrus-aniso.js
 */
const fs = require('fs');
const path = require('path');
const PREVIEW =
  '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';

const VIEW_ELEV = 40;      // 상층(10km)이 11.9km 앞에 오는 시선 고도
const COVER = 0.5;
const FOV_DEG = 60;
const TW = 384, TH = 384;
const WINDS = [0, 90];     // 이 두 방위만 다르고 나머지는 전부 같습니다

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>권운 결 방향 — 바람 0° vs 90° (위: 권운 이방성, 아래: 권적운 등방)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS } from './app/utils/cloudPresets.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const VIEW_ELEV = ${VIEW_ELEV}, COVER = ${COVER}, FOV_DEG = ${FOV_DEG};
const TW = ${TW}, TH = ${TH};
const WINDS = ${JSON.stringify(WINDS)};

const canvas = document.getElementById('c');
canvas.width = TW * 2; canvas.height = TH * 2;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(TW * 2, TH * 2, false);

const maxAniso = renderer.capabilities.getMaxAnisotropy();
const deck = createCloudDeck({ maxAnisotropy: maxAniso });
const scene = new THREE.Scene();
scene.add(deck.group);

// 상층만 그립니다. 저·중층을 0으로 두어야 한 겹만 재집니다.
const ELEVS = [];
for (let i = 0; i < 8; i++) ELEVS.push(Math.asin((i + 0.5) / 8) * 180 / Math.PI);
const samples = [];
for (const layer of ['low', 'mid', 'high']) {
  for (let a = 0; a < 24; a++) {
    for (const e of ELEVS) {
      samples.push({ layer, azimuthDeg: (a * 360) / 24, elevationDeg: e,
        distanceKm: 20, confidence: 1, cover: layer === 'high' ? COVER : 0 });
    }
  }
}

const white = { r: 1.2, g: 1.2, b: 1.25 };
const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);
cam.up.set(0, 1, 0);
const er = VIEW_ELEV * Math.PI / 180;
cam.lookAt(0, 100 * Math.sin(er), -100 * Math.cos(er));   // 방위 0° (북)
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

// **셰이더가 아니라 프리셋이 실제로 들고 있는 값**을 씁니다.
// 여기서 상수를 다시 적으면 프리셋이 바뀌어도 이 검사가 눈치채지 못합니다.
function cellOf(name) {
  const o = PRESET_OPTICS[name];
  return { cellSizeKm: o.cellSizeKm, cellStrength: o.cellStrength,
           cellVariant: o.cellVariant, cellAspect: o.cellAspect };
}

function shoot(name, windDeg, x, y) {
  updateCloudDeck(deck, {
    samples,
    beamFor: () => white,
    ambientFor: () => ({ up: white, down: { r: 0.55, g: 0.6, b: 0.7 } }),
    sunDir: new THREE.Vector3(0, 0.6, -0.8).normalize(),
    sunAltDeg: 37,
    tauFor: () => PRESET_OPTICS[name].tau,
    shadowFor: () => 0.3,
    cellFor: () => cellOf(name),
    pixelAngleRad: (FOV_DEG * Math.PI / 180) / TH,
    windBearingDeg: windDeg,
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
  const a = new Float32Array(TW * TH);
  for (let p = 0; p < TW * TH; p++) {
    a[p] = Math.max(0, Math.min(1, 1 - (kw[p * 4 + 1] - kb[p * 4 + 1]) / 255));
  }

  // 방향별 기울기 에너지. 가장자리 24px는 버립니다 — 화면 위쪽은 지평선
  // 근처라 tpp가 폭주해 무늬가 뭉개지고, 그게 방향 비를 흐립니다.
  const M = 24;
  let gx = 0, gy = 0, n = 0, sum = 0;
  for (let py = M; py < TH - M; py++) {
    for (let px = M; px < TW - M; px++) {
      const p = py * TW + px;
      gx += Math.abs(a[p + 1] - a[p]);
      gy += Math.abs(a[p + TW] - a[p]);
      sum += a[p];
      n++;
    }
  }
  const stat = { Gx: gx / n, Gy: gy / n, 운량: sum / n };
  stat.비 = stat.Gx / Math.max(1e-6, stat.Gy);

  // 눈으로 볼 컷은 하늘색 배경으로 한 번 더
  renderer.setClearColor(0x2e6d96, 1);
  renderer.setViewport(x, y, TW, TH);
  renderer.setScissor(x, y, TW, TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 10) + 'px';
  d.style.top = ((y === TH ? 0 : 1) * TH + 34) + 'px';
  d.textContent = name + '  바람 ' + windDeg + '°  Gx/Gy=' + stat.비.toFixed(3) +
    '  운량 ' + stat.운량.toFixed(3);
  labels.appendChild(d);
  return stat;
}

// 위 줄(y = TH)이 권운, 아래 줄(y = 0)이 대조군 권적운입니다.
const 권운 = WINDS.map((w, i) => shoot('Cirrus', w, i * TW, TH));
const 권적운 = WINDS.map((w, i) => shoot('Cirrocumulus', w, i * TW, 0));

const glErr = gl.getError();
window.__stats = {
  이방성: maxAniso, glError: glErr,
  프리셋: { 권운: PRESET_OPTICS.Cirrus.cellAspect,
            권적운: PRESET_OPTICS.Cirrocumulus.cellAspect },
  권운: { 바람0: 권운[0], 바람90: 권운[1],
          비의비: +(권운[0].비 / 권운[1].비).toFixed(4) },
  권적운: { 바람0: 권적운[0], 바람90: 권적운[1],
            비의비: +(권적운[0].비 / 권적운[1].비).toFixed(4) },
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cirrus-aniso.html'), html);
console.log('생성 완료: cirrus-aniso.html');
