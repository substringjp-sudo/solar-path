/**
 * **지평선 아래에 실제로 무엇이 그려지는가.**
 *
 * ## 왜 필요한가
 *
 * 화면에서 지평선 아래가 "흐릿한 회색"으로 보이는데, 그게 땅인지 하늘인지
 * 코드만 봐서는 헷갈립니다. 세 가지가 그 영역에 겹쳐 있기 때문입니다:
 *
 *   스카이돔     반지름 500, **완전한 구**, renderOrder −1, depthTest **false**
 *   지면 원반    y = −8 수평 원반, 반지름 480, renderOrder −2, depthWrite false
 *   지형 링      반지름 480, 고도 −2° ~ 지형각(최대 8°), renderOrder 0
 *
 * 여기서는 앱과 **같은 모듈**(`Skydome.ts`, `TerrainRing.ts`)을 임포트해
 * 같은 순서로 씬에 넣고, 지평선을 가로지르는 세로줄의 픽셀을 읽어
 * 고도각마다 무엇이 이겼는지 봅니다.
 *
 * 각 요소를 하나씩 빼면서도 찍습니다 — 빼도 화면이 안 변하면 그 요소는
 * 애초에 안 보이고 있었다는 뜻입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-horizon-preview.js
 *       node tools/shader-preview/shoot.js horizon.html horizon.png
 *       node tools/shader-preview/verify-horizon.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const SUN_ALT = 4;
const SUN_AZ = 270;
const VIEW_ELEV = -6;      // 지평선이 화면 위쪽에 오도록 아래를 봅니다
const FOV_DEG = 50;
const TW = 360, TH = 360;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 30}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>지평선 아래에 무엇이 그려지나 — 요소를 하나씩 빼가며 (태양 고도 ${SUN_ALT}°)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane,
         updateTerrainColors, updateGroundColors }
  from './app/components/SkyScene3D/TerrainRing.js';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, angularSeparationDeg }
  from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const SUN_ALT = ${SUN_ALT}, SUN_AZ = ${SUN_AZ}, VIEW_ELEV = ${VIEW_ELEV};
const FOV_DEG = ${FOV_DEG}, TW = ${TW}, TH = ${TH};

const canvas = document.getElementById('c');
canvas.width = TW * 4; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(TW * 4, TH, false);

const atmosphere = makeAtmosphereParams({
  visibilityM: 30000, humidityPct: 55, latitude: 37.5, dayOfYear: 214 });

// 지형은 평지에 가깝게 (실제 도심 관측점이 대개 이렇습니다).
const SAMPLES = 72;
const angles = [];
for (let i = 0; i < SAMPLES; i++) {
  angles.push(0.4 + 0.9 * Math.sin(i * 0.21) + 0.5 * Math.sin(i * 0.07 + 1.3));
}

const sky = createSkydome();
const terrain = createTerrainRing(angles);
const ground = createGroundPlane();

const sAlt = SUN_ALT * Math.PI / 180, sAz = SUN_AZ * Math.PI / 180;
const sunDir = new THREE.Vector3(
  Math.cos(sAlt) * Math.sin(sAz), Math.sin(sAlt), -Math.cos(sAlt) * Math.cos(sAz)).normalize();
updateSkydome(sky, SUN_ALT, SUN_AZ, atmosphere, 1.0);
updateTerrainColors(terrain, SUN_ALT, SUN_AZ, 0, atmosphere.betaMie);
// 앱과 같은 방식으로 하늘 반구 평균을 뽑아 넘깁니다.
let sr=0,sg=0,sb=0,sw=0;
for (const e of [10,30,50,75]) { const w=Math.sin(e*Math.PI/180);
  for (let a=0;a<6;a++) {
    const az=(a*360)/6;
    const L=skyRadiance(e, angularSeparationDeg(az,e,SUN_AZ,SUN_ALT), SUN_ALT, atmosphere);
    sr+=L.r*w; sg+=L.g*w; sb+=L.b*w; sw+=w;
  } }
const skyMean = { r:sr/sw, g:sg/sw, b:sb/sw };
updateGroundColors(ground, SUN_ALT, 0, {
  skyMean, beam: beamAtAltitude(SUN_ALT, 0, atmosphere),
  sunTransmittance: 1, sunAzimuthDeg: SUN_AZ });
window.__skyMean = skyMean;

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);
cam.up.set(0, 1, 0);
const er = VIEW_ELEV * Math.PI / 180, ar = SUN_AZ * Math.PI / 180;
cam.lookAt(100 * Math.cos(er) * Math.sin(ar), 100 * Math.sin(er), -100 * Math.cos(er) * Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

// 화면 세로줄의 픽셀 고도각. 카메라 행렬에서 직접 뽑습니다.
const tanHalf = Math.tan(FOV_DEG * Math.PI / 360);
const m = cam.matrixWorld.elements;
const up = new THREE.Vector3(m[4], m[5], m[6]);
const fwd = new THREE.Vector3(-m[8], -m[9], -m[10]);
const elevOfRow = (py) => {
  const ny = ((py + 0.5) / TH) * 2 - 1;
  const d = fwd.clone().addScaledVector(up, ny * tanHalf).normalize();
  return Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
};

function shoot(parts, label, x) {
  const scene = new THREE.Scene();
  // **앱과 같은 순서로 넣습니다.** renderOrder가 실제 순서를 정하지만,
  // 추가 순서까지 같게 두어야 재현이라고 할 수 있습니다.
  if (parts.ground) scene.add(ground);
  if (parts.sky) scene.add(sky.mesh);
  if (parts.terrain) scene.add(terrain);

  renderer.setClearColor(0x000000, 1);
  renderer.setViewport(x, 0, TW, TH);
  renderer.setScissor(x, 0, TW, TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);
  const b = new Uint8Array(4 * TW * TH);
  gl.readPixels(x, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, b);

  scene.remove(ground); scene.remove(sky.mesh); scene.remove(terrain);

  // 화면 가운데 세로줄을 고도각과 함께 기록합니다.
  const col = TW >> 1;
  const strip = [];
  for (let py = 0; py < TH; py++) {
    const p = (py * TW + col) * 4;
    strip.push({ elev: +elevOfRow(py).toFixed(2),
                 r: b[p], g: b[p + 1], bl: b[p + 2] });
  }

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 8) + 'px'; d.style.top = '34px';
  d.textContent = label;
  labels.appendChild(d);
  return strip;
}

function aim(azDeg) {
  const a = azDeg * Math.PI / 180;
  cam.lookAt(100 * Math.cos(er) * Math.sin(a), 100 * Math.sin(er), -100 * Math.cos(er) * Math.cos(a));
  cam.updateMatrixWorld(true);
}

const 전부   = shoot({ sky: 1, terrain: 1, ground: 1 }, '전부 (앱과 동일)', 0);
const 지면없이 = shoot({ sky: 1, terrain: 1, ground: 0 }, '지면 원반 뺌', TW);
const 하늘없이 = shoot({ sky: 0, terrain: 1, ground: 1 }, '스카이돔 뺌', TW * 2);
// **태양 반대쪽**을 봅니다. 지면이 램버시안이면 여기가 태양 쪽과 같은
// 밝기여야 하고, 전방산란 광택이 실제로 걸리면 더 어두워야 합니다.
aim((SUN_AZ + 180) % 360);
const 반대쪽 = shoot({ sky: 0, terrain: 0, ground: 1 }, '지면만 · 태양 반대쪽', TW * 3);
aim(SUN_AZ);

// 지면 원반을 빼도 화면이 그대로면, 애초에 안 보이고 있었다는 뜻입니다.
let maxDelta = 0;
for (let i = 0; i < 전부.length; i++) {
  maxDelta = Math.max(maxDelta,
    Math.abs(전부[i].r - 지면없이[i].r),
    Math.abs(전부[i].g - 지면없이[i].g),
    Math.abs(전부[i].bl - 지면없이[i].bl));
}

// 고도대별 대표색 (지평선 아래가 무슨 색인지).
const bandOf = (strip, lo, hi) => {
  const v = strip.filter(s => s.elev >= lo && s.elev < hi);
  if (!v.length) return null;
  const f = k => Math.round(v.reduce((a, b) => a + b[k], 0) / v.length);
  return { r: f('r'), g: f('g'), b: f('bl'), n: v.length };
};
const BANDS = [[2, 10], [0, 2], [-2, 0], [-6, -2], [-15, -6], [-30, -15]];

const glErr = gl.getError();
window.__stats = {
  glError: glErr,
  하늘반구평균: window.__skyMean,
  지면원반을_빼도_바뀌는_최대픽셀차: maxDelta,
  고도대: BANDS.map(([lo, hi]) => ({
    고도대: lo + '~' + hi + '°',
    전부: bandOf(전부, lo, hi),
    스카이돔뺌: bandOf(하늘없이, lo, hi),
    지면_태양쪽: bandOf(하늘없이, lo, hi),
    지면_반대쪽: bandOf(반대쪽, lo, hi),
  })),
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'horizon.html'), html);
console.log('생성 완료: horizon.html');
