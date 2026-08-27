/**
 * **바다와 윤슬** (docs/GROUND_PLAN.md 4·5단계).
 *
 * ## 무엇을 보나
 *
 * 서쪽 절반이 바다, 동쪽 절반이 육지인 관측점을 만들어 태양이 지는 서쪽을
 * 봅니다. 네 컷을 나란히 둡니다:
 *
 *   1. 육지만 — 물이 없을 때 (비교 기준)
 *   2. 바다 · 바람 2 m/s — 좁고 날카로운 윤슬 기둥
 *   3. 바다 · 바람 8 m/s — 넓고 부드러운 띠
 *   4. 바다 · 태양 반대쪽 — 윤슬이 없는 물은 어둡다
 *
 * ## 왜 이렇게 재나
 *
 * 물이 강력한 이유는 알베도가 낮은데(0.06) **정반사 방향에서만 아주 높다**는
 * 대비입니다. 그러니 검사는 두 가지여야 합니다 — 태양 쪽에 기둥이 서는가,
 * 그리고 **반대쪽은 어두운가.** 하나만 보면 "물 전체를 밝게 칠했다"와
 * 구분이 안 됩니다.
 *
 * 풍속 의존은 Cox-Munk(σ² = 0.003 + 0.00512·U)의 유일한 관측 가능한 결과라,
 * 그게 실제로 걸렸는지 보는 가장 직접적인 검사입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-water-preview.js
 *       node tools/shader-preview/shoot.js water.html water.png
 *       node tools/shader-preview/verify-water.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const SUN_ALT = 3;
const SUN_AZ = 270;
const VIEW_ELEV = -2.5;
// ⚠ 화각이 좁으면 윤슬 폭을 못 잽니다. Cox-Munk 경사 표준편차는
// σ = sqrt(0.003 + 0.00512·U) 이고, 방위 폭은 대략 그 두 배입니다 —
// 2m/s에서 약 13°, 8m/s에서 약 24°. 화각 24°로 찍으면 둘 다 프레임을
// 채워 버려 "폭이 안 변한다"로 보입니다 (실측 0.515 vs 0.565).
const FOV_DEG = 70;
const TW = 400, TH = 300;
const OBS_ELEV_M = 30;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 36}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>바다와 윤슬 — 태양 고도 ${SUN_ALT}°, 관측 고도 ${OBS_ELEV_M}m (화각 ${FOV_DEG}°)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createGroundPlane, createTerrainBands, makeWaterTexture,
         setGroundHorizon, seaHorizonDipDeg,
         updateGroundColors, updateTerrainBands }
  from './app/components/SkyScene3D/TerrainRing.js';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, angularSeparationDeg }
  from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const SUN_ALT = ${SUN_ALT}, SUN_AZ = ${SUN_AZ}, VIEW_ELEV = ${VIEW_ELEV};
const FOV_DEG = ${FOV_DEG}, TW = ${TW}, TH = ${TH}, OBS_ELEV_M = ${OBS_ELEV_M};

const canvas = document.getElementById('c');
canvas.width = TW * 4; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(TW * 4, TH, false);

const atmosphere = makeAtmosphereParams({
  visibilityM: 30000, humidityPct: 65, latitude: 37.5, dayOfYear: 214 });

// 서쪽(방위 180~360)이 바다, 동쪽이 육지.
const SAMPLES = 31;
const DIST = [5, 15, 40];
const waterFrac = [];
for (let i = 0; i < SAMPLES; i++) {
  const az = (i / SAMPLES) * 360;
  waterFrac.push(az > 185 && az < 355 ? 1 : 0);
}
const noWater = waterFrac.map(() => 0);
// 육지 쪽 능선 (바다 쪽은 createTerrainBands가 접습니다).
const bandAngles = DIST.map((d, j) => {
  const H = [180, 500, 1200][j];
  const out = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const h = Math.max(0, H * (0.6 + 0.5 * Math.sin(t * 3 + j)));
    out.push(Math.atan2(h, d * 1000) * 180 / Math.PI);
  }
  return out;
});

const sky = createSkydome();
const ground = createGroundPlane();
setGroundHorizon(ground, OBS_ELEV_M);
const bandsLand = createTerrainBands(bandAngles, DIST, undefined, noWater);
const bandsSea = createTerrainBands(bandAngles, DIST, undefined, waterFrac);

updateSkydome(sky, SUN_ALT, SUN_AZ, atmosphere, 1.0);

let sr = 0, sg = 0, sb = 0, sw = 0;
for (const e of [10, 30, 50, 75]) {
  const w = Math.sin(e * Math.PI / 180);
  for (let a = 0; a < 6; a++) {
    const az = (a * 360) / 6;
    const L = skyRadiance(e, angularSeparationDeg(az, e, SUN_AZ, SUN_ALT), SUN_ALT, atmosphere);
    sr += L.r * w; sg += L.g * w; sb += L.b * w; sw += w;
  }
}
const skyMean = { r: sr / sw, g: sg / sw, b: sb / sw };
const beam = beamAtAltitude(SUN_ALT, 0, atmosphere);
const hazeAt = (az, elev) =>
  skyRadiance(elev, angularSeparationDeg(az, elev, SUN_AZ, SUN_ALT), SUN_ALT, atmosphere);
const horizonSky = skyRadiance(0.6,
  angularSeparationDeg(SUN_AZ, 0.6, SUN_AZ, SUN_ALT), SUN_ALT, atmosphere);

const seaTex = makeWaterTexture(waterFrac);

updateTerrainBands(bandsLand, SUN_ALT, {
  skyMean, hazeAt, beam, sunTransmittance: 1,
  betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom, elevScale: atmosphere.elevScale });
updateTerrainBands(bandsSea, SUN_ALT, {
  skyMean, hazeAt, beam, sunTransmittance: 1,
  betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom, elevScale: atmosphere.elevScale });

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);
cam.up.set(0, 1, 0);
const er = VIEW_ELEV * Math.PI / 180;
const aim = (azDeg) => {
  const a = azDeg * Math.PI / 180;
  cam.lookAt(100 * Math.cos(er) * Math.sin(a), 100 * Math.sin(er), -100 * Math.cos(er) * Math.cos(a));
  cam.updateMatrixWorld(true);
};

const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(cfg, label, x) {
  updateGroundColors(ground, SUN_ALT, 0, {
    skyMean, beam, sunTransmittance: 1, sunAzimuthDeg: SUN_AZ,
    waterTex: cfg.water ? seaTex : null,
    betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom,
    elevScale: atmosphere.elevScale,
    windSpeedMs: cfg.wind,
  });
  aim(cfg.viewAz);

  const scene = new THREE.Scene();
  scene.add(ground);
  scene.add(sky.mesh);
  scene.add((cfg.water ? bandsSea : bandsLand).group);

  renderer.setClearColor(0x000000, 1);
  renderer.setViewport(x, 0, TW, TH);
  renderer.setScissor(x, 0, TW, TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);
  const b = new Uint8Array(4 * TW * TH);
  gl.readPixels(x, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, b);

  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 8) + 'px'; d.style.top = '34px';
  d.textContent = label;
  labels.appendChild(d);
  return b;
}

const 육지   = shoot({ water: 0, wind: 5, viewAz: SUN_AZ }, '육지 (물 없음)', 0);
const 바다약 = shoot({ water: 1, wind: 2, viewAz: SUN_AZ }, '바다 · 바람 2m/s', TW);
const 바다강 = shoot({ water: 1, wind: 8, viewAz: SUN_AZ }, '바다 · 바람 8m/s', TW * 2);
const 반대쪽 = shoot({ water: 1, wind: 5, viewAz: (SUN_AZ + 180) % 360 }, '바다 · 태양 반대쪽', TW * 3);

// ── 측정 ────────────────────────────────────────────────────────────────────
const lum = (buf, px, py) => {
  const p = (py * TW + px) * 4;
  return 0.2126 * buf[p] + 0.7152 * buf[p + 1] + 0.0722 * buf[p + 2];
};

const tanHalf = Math.tan(FOV_DEG * Math.PI / 360);
const m = cam.matrixWorld.elements;
const upv = new THREE.Vector3(m[4], m[5], m[6]);
const fwd = new THREE.Vector3(-m[8], -m[9], -m[10]);
const elevOfRow = (py) => {
  const ny = ((py + 0.5) / TH) * 2 - 1;
  const d = fwd.clone().addScaledVector(upv, ny * tanHalf).normalize();
  return Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
};

// 수면(지평선 아래)만 봅니다.
function surface(buf) {
  const rows = [];
  for (let py = 0; py < TH; py++) if (elevOfRow(py) < -0.4) rows.push(py);
  return rows;
}
const ROWS = surface(육지);

/**
 * 수면 전체를 세로 평균한 가로 프로파일 (열 = 방위).
 */
function hProfile(buf) {
  const out = [];
  for (let px = 0; px < TW; px++) {
    let s = 0;
    for (const py of ROWS) s += lum(buf, px, py);
    out.push(s / ROWS.length);
  }
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const p육지 = hProfile(육지), p약 = hProfile(바다약), p강 = hProfile(바다강), p반 = hProfile(반대쪽);

// ── 풍속 의존을 어떻게 분리하나 ─────────────────────────────────────────────
//
// 두 번 헛짚었습니다.
//
// 1. "가장 밝은 행의 절반 문턱 폭"으로 쟀더니 풍속을 4배 올려도 0.43 → 0.43.
//    수면에서 가장 밝은 곳은 윤슬이 아니라 **수평선 거울 띠**이기 때문입니다 —
//    스치는 각에서 프레넬이 1에 가까워져 하늘을 그대로 비춥니다.
//
// 2. 두 풍속의 **차이**를 봤더니 중심이 음수(-9.3)로 나왔습니다. 에너지
//    보존이면 약풍이 중심에서 밝아야 하는데요. 원인은 **톤 곡선**입니다 —
//    ACES는 좁고 밝은 봉우리를 더 세게 압축하므로, 퍼진 쪽이 표시상 더
//    밝아집니다. 선형에서 성립하는 보존이 화면에서는 안 성립합니다.
//
// 그래서 **육지를 절대 기준**으로 씁니다. 같은 픽셀에서 물이 육지보다
// 뚜렷이 밝은 곳이 곧 윤슬이고, 그 방위 폭은 톤 곡선에 안 휘둘립니다.
// ⚠ 문턱을 **최댓값에 비례**시키면 안 됩니다. 봉우리가 높아지면 문턱도
// 같이 올라가 폭이 안 변하는 것처럼 보입니다 (실측 0.13 vs 0.155).
// 자기 바닥(프레임 가장자리 = 정반사에서 먼 방위)에서 고정 높이만큼
// 올라온 폭을 재야 "얼마나 퍼졌는가"가 나옵니다.
const EDGE = Math.round(TW * 0.12);
const baselineOf = (pw) =>
  mean(pw.slice(0, EDGE).concat(pw.slice(TW - EDGE)));
function glitterWidth(pw) {
  const base = baselineOf(pw);
  let n = 0;
  for (let i = 0; i < TW; i++) if (pw[i] - base > 25) n++;
  return n / TW;
}
function glitterPeak(pw) {
  return Math.max(...pw) - baselineOf(pw);
}

const glErr = gl.getError();
window.__stats = {
  glError: glErr,
  수평선내려앉음: +seaHorizonDipDeg(OBS_ELEV_M).toFixed(3),
  수면평균: {
    육지: +mean(p육지).toFixed(1),
    바다약: +mean(p약).toFixed(1),
    바다강: +mean(p강).toFixed(1),
    반대쪽: +mean(p반).toFixed(1),
  },
  프로파일: {
    육지: p육지.filter((_, i) => i % 25 === 0).map(v => +v.toFixed(0)),
    바다약: p약.filter((_, i) => i % 25 === 0).map(v => +v.toFixed(0)),
    바다강: p강.filter((_, i) => i % 25 === 0).map(v => +v.toFixed(0)),
  },
  윤슬: {
    바다약: { 폭: +glitterWidth(p약).toFixed(3), 봉우리: +glitterPeak(p약).toFixed(1) },
    바다강: { 폭: +glitterWidth(p강).toFixed(3), 봉우리: +glitterPeak(p강).toFixed(1) },
    반대쪽: { 폭: +glitterWidth(p반).toFixed(3), 봉우리: +glitterPeak(p반).toFixed(1) },
  },
  화각: FOV_DEG,
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'water.html'), html);
console.log('생성 완료: water.html');
