/**
 * **한 화면 안에서** 기상 수치만으로 한쪽은 맑고 한쪽은 흐릴 수 있는가.
 *
 * ## 왜 따로 재나
 *
 * `verify-region-cover.js`는 **360° 하늘 전체**에 대해 지역 예보가 보존되는지
 * 봅니다. 그건 "동쪽을 보면 흐리고 서쪽을 보면 맑다"는 뜻이지, **한 화면
 * 안에서** 좌우가 갈린다는 뜻이 아닙니다.
 *
 * 화각 60° 안에는 기상 링의 방위가 2~3개밖에 안 들어옵니다 (링이 30° 간격).
 * 그래서 따로 확인해야 합니다 — 데이터 해상도가 한 프레임 안의 대비를
 * 만들어 낼 만큼 촘촘한가?
 *
 * ## 어떻게 재나
 *
 * 서쪽 절반은 맑고(0%) 동쪽 절반은 흐린(95%) 링을 넣고, **그 경계를 정면으로**
 * 보게 카메라를 둡니다. 한 프레임을 렌더해 화면 왼쪽 1/3과 오른쪽 1/3의
 * 운량(알파)을 각각 잽니다.
 *
 * 알파는 검정·흰 두 배경으로 두 번 그려 분리합니다 — 색 문턱으로 재면
 * 가장자리 반투명과 그늘진 구름이 섞여 과소 계상됩니다.
 *
 * 비교군으로 **경계가 없는** 균일 링(둘 다 48%)을 같은 방식으로 찍습니다.
 * 그게 없으면 좌우 차이가 기상 때문인지 그냥 노이즈 때문인지 구분이 안 됩니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-one-screen-preview.js
 *       node tools/shader-preview/shoot.js one-screen.html one-screen.png
 *       node tools/shader-preview/verify-one-screen.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

// 경계를 정면으로 보는 방위. 링에서 동/서를 가르는 선이 여기입니다.
const VIEW_AZ = 0;
const VIEW_ELEV = 22;
const FOV_DEG = 60;
const TW = 480, TH = 480;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>한 화면 안의 좌우 대비 — 왼쪽: 서쪽 맑음/동쪽 흐림 경계, 오른쪽: 균일 대조군</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { WeatherFan, buildSkyColumns, LAYER_ALTITUDE_KM,
         PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const VIEW_AZ = ${VIEW_AZ}, VIEW_ELEV = ${VIEW_ELEV}, FOV_DEG = ${FOV_DEG};
const TW = ${TW}, TH = ${TH};

const canvas = document.getElementById('c');
canvas.width = TW * 2; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(TW * 2, TH, false);

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

// 실제 앱이 쓰는 링 형태 (12방위 × 7거리 + 관측점).
const RING_AZ = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
const RING_D = [10, 30, 70, 130, 200, 280, 380];

// 방위 0°을 경계로 동쪽(0~180)은 흐리고 서쪽(180~360)은 맑은 링.
function splitRing() {
  const out = [{ distance: 0, azimuthOffset: 0, low: 3, mid: 48, high: 3 }];
  for (const az of RING_AZ) {
    for (const d of RING_D) {
      const a = (az + 360) % 360;
      const east = a > 0 && a < 180;
      out.push({ distance: d, azimuthOffset: az, low: 3, high: 3,
        mid: east ? 95 : 0 });
    }
  }
  return out;
}
function flatRing() {
  const out = [{ distance: 0, azimuthOffset: 0, low: 3, mid: 48, high: 3 }];
  for (const az of RING_AZ) {
    for (const d of RING_D) out.push({ distance: d, azimuthOffset: az, low: 3, mid: 48, high: 3 });
  }
  return out;
}

const white = { r: 1.2, g: 1.2, b: 1.25 };
const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);
cam.up.set(0, 1, 0);
const ar = VIEW_AZ * Math.PI / 180, er = VIEW_ELEV * Math.PI / 180;
cam.lookAt(100 * Math.cos(er) * Math.sin(ar), 100 * Math.sin(er), -100 * Math.cos(er) * Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(ring, label, x) {
  const samples = buildSkyColumns({
    fan: new WeatherFan(ring, 0),
    driftMinutes: 0,
    windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
  });
  updateCloudDeck(deck, {
    samples,
    beamFor: () => white,
    ambientFor: () => ({ up: white, down: { r: 0.55, g: 0.6, b: 0.7 } }),
    sunDir: new THREE.Vector3(0, 0.4, -0.9).normalize(),
    sunAltDeg: 24,
    tauFor: () => 16,
    shadowFor: () => 0.45,
    cellFor: () => ({ cellSizeKm: 0.5, cellStrength: 0.95,
                      cellVariant: 'billow', cellAspect: 1 }),
    pixelAngleRad: (FOV_DEG * Math.PI / 180) / TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: 0.08, angstrom: 1.3, elevScale: 1.0,
    timeSeconds: 0, visible: true,
  });

  const grab = (bg) => {
    renderer.setClearColor(bg, 1);
    renderer.setViewport(x, 0, TW, TH);
    renderer.setScissor(x, 0, TW, TH);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, cam);
    const b = new Uint8Array(4 * TW * TH);
    gl.readPixels(x, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return b;
  };
  const kb = grab(0x000000), kw = grab(0xffffff);
  const alpha = new Float32Array(TW * TH);
  for (let p = 0; p < TW * TH; p++) {
    alpha[p] = Math.max(0, Math.min(1, 1 - (kw[p * 4 + 1] - kb[p * 4 + 1]) / 255));
  }

  // 화면을 세로로 3등분해 바깥 두 조각만 잽니다. 가운데는 경계가 지나가는
  // 전이 구간이라 어느 쪽으로도 셀 수 없습니다.
  const third = Math.floor(TW / 3);
  // 화면 세로도 나눠 봅니다. 위아래가 보는 **거리**가 크게 다르기 때문입니다.
  // 시선 22° · 화각 60° 이므로 프레임은 고도 -8°~52° 를 담고, 중층(4.5km)
  // 기준 거리로는 위쪽 3.5~11km, 아래쪽 25km~지평선입니다.
  //
  // 위쪽이 링의 첫 고리(10km)에 걸쳐 있어 방위 분해가 약할 수 있으므로
  // 따로 봅니다. **진짜 천정(70° 이상)은 갈리지 않는 것이 맞습니다** —
  // 머리 위 구름은 1~2km 앞이라 어느 방위로 올려다봐도 물리적으로 같은
  // 지점이고, 거기서 방위마다 다른 값이 나오면 그게 오히려 모순입니다.
  const band = (x0, x1, y0, y1) => {
    let s = 0, n = 0;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) { s += alpha[py * TW + px]; n++; }
    }
    return s / n;
  };
  // WebGL 읽기는 아래가 y=0 입니다. 화면 위쪽(천정 쪽)이 y 큰 쪽.
  const yTop = [Math.floor(TH * 0.62), TH];      // 화면 위 38% = 고도 높음
  const yBot = [0, Math.floor(TH * 0.38)];       // 화면 아래 38% = 고도 낮음
  const left = band(0, third, 0, TH);
  const right = band(TW - third, TW, 0, TH);
  const topL = band(0, third, yTop[0], yTop[1]);
  const topR = band(TW - third, TW, yTop[0], yTop[1]);
  const botL = band(0, third, yBot[0], yBot[1]);
  const botR = band(TW - third, TW, yBot[0], yBot[1]);

  renderer.setClearColor(0x2e6d96, 1);
  renderer.setViewport(x, 0, TW, TH);
  renderer.setScissor(x, 0, TW, TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 10) + 'px'; d.style.top = '34px';
  d.textContent = label + '  왼쪽 ' + (left * 100).toFixed(1) + '%  오른쪽 ' +
    (right * 100).toFixed(1) + '%  차이 ' + ((right - left) * 100).toFixed(1) + '%p';
  labels.appendChild(d);
  return { left, right, diff: right - left,
           천정쪽: { left: topL, right: topR, diff: topR - topL },
           지평선쪽: { left: botL, right: botR, diff: botR - botL } };
}

const 경계 = shoot(splitRing(), '경계', 0);
const 균일 = shoot(flatRing(), '균일', TW);

const glErr = gl.getError();
window.__stats = { glError: glErr, 경계, 균일 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'one-screen.html'), html);
console.log('생성 완료: one-screen.html');
