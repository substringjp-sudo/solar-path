/**
 * **수직 발달 — 다양한 크기** (docs/CLOUD_VARIETY_PLAN.md 5단계).
 *
 * ## 무엇이 문제였나
 *
 * 빌보드 각크기가 **상수**였습니다 (저층 14° × 0.75~1.25). 그래서 40km 밖
 * 적운과 5km 앞 적운이 화면에서 같은 크기였습니다 — 크기가 거리를 말해 주지
 * 못하니 "다양한 크기"가 있을 수 없었습니다. 게다가 적운 템플릿 다섯 개가
 * 전부 가로가 긴 판(종횡비 2.3~5.6)이라 솟은 탑이 나올 방법이 없었습니다.
 *
 * ## 어떻게 재나
 *
 * 두 가지를 따로 봅니다.
 *
 * **(A) 기하** — 렌더 없이 배치 결과(`built.instances`)를 읽습니다.
 * 습도·강수를 바꿔 가며 밑면 고도·연직 각크기·종횡비가 어떻게 움직이는지.
 * 여기서 확인할 것:
 *   - 밑면 고도가 습도에 반응하는가 (Espy 응결고도)
 *   - 같은 하늘 안에서 각크기가 **거리에 따라** 갈리는가
 *   - 대류가 강해지면 종횡비가 1 아래로 내려가는가 (탑형 실루엣)
 *   - 한 하늘 안에서 밑면 고도는 **하나**인가 (평평한 밑면)
 *
 * **(B) 화면** — 약한 대류와 강한 대류를 같은 카메라로 렌더해 나란히.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-tower-preview.js
 *       node tools/shader-preview/verify-tower.js
 */
const fs = require('fs');
const path = require('path');
const PREVIEW =
  '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';

const TW = 520, TH = 420, VIEW_AZ = 250, VIEW_ELEV = 16, FOV_DEG = 62;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 3 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.4}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>수직 발달 — 약한 대류 / 강한 대류 (둘 다 태양 18°, 역광) / 강한 대류 + 태양 45° (세로 조명 기울기가 보이는 배치)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { bakeCloudAtlas } from './app/components/SkyScene3D/cloudAtlas.js';
import { createCloudField, updateCloudField } from './app/components/SkyScene3D/CloudField.js';
import { buildCloudInstances } from './app/components/SkyScene3D/cloudPlacement.js';
import { makeAtmosphereParams } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, FOV_DEG=${FOV_DEG};

const canvas = document.getElementById('c');
canvas.width = TW*3; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW*3, TH, false);

const atlas = bakeCloudAtlas(renderer);
const field = createCloudField(atlas, 400);
const scene = new THREE.Scene();
scene.add(field.mesh);

const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
function ring(humidity, precip, low) {
  const one = (d, az) => ({ distance:d, azimuthOffset:az, low, mid:0, high:0,
                            humidity, precipitation:precip, visibility:20000 });
  const out = [one(0,0)];
  for (const az of RING_AZ) for (const d of RING_D) out.push(one(d,az));
  return out;
}

const SUN_AZ = 250;
const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 200, betaMie: 0.08,
});

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

/** 배치 결과의 기하 요약. 렌더가 아니라 숫자를 읽습니다. */
function geometry(built) {
  const cu = built.instances.filter(c => c.altitudeKm < 8);
  if (cu.length === 0) return null;
  const angOf = (c) => 2 * Math.atan(c.sizeY / 2 / c.shellRadius) * 180 / Math.PI;
  const angs = cu.map(angOf);
  const asp = cu.map(c => c.aspect);
  // 밑면 고도 = 조명 고도 − 두께/2 는 알 수 없으므로, 각크기와 중심
  // 고도각에서 되돌립니다: 밑면각 = 중심각 − 각크기/2.
  const baseElev = cu.map((c,i) => c.elevationDeg - angs[i]/2);
  const bases = cu.map(c => c.baseKm);
  const tops = cu.map(c => c.topKm);
  const q = (arr, p) => { const a=[...arr].sort((x,y)=>x-y); return a[Math.floor(a.length*p)]; };
  return {
    개수: cu.length,
    각크기: { 최소:+Math.min(...angs).toFixed(2), 최대:+Math.max(...angs).toFixed(2),
             중앙:+q(angs,0.5).toFixed(2) },
    종횡비: { 최소:+Math.min(...asp).toFixed(2), 최대:+Math.max(...asp).toFixed(2),
             중앙:+q(asp,0.5).toFixed(2) },
    밑면각: { 최소:+Math.min(...baseElev).toFixed(2), 최대:+Math.max(...baseElev).toFixed(2) },
    // 밑면 고도는 응결고도 하나에서 나오므로 방향이 달라도 **같아야** 합니다.
    밑면고도: { 최소:+Math.min(...bases).toFixed(3), 최대:+Math.max(...bases).toFixed(3) },
    운정고도: { 최소:+Math.min(...tops).toFixed(2), 최대:+Math.max(...tops).toFixed(2) },
  };
}

function shoot(label, x, humidity, precip, low, SUN_ALT) {
  const built = buildCloudInstances({
    atlas, currentTime: new Date('2026-08-26T09:00:00Z'),
    sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ, atmosphere,
    weather: ring(humidity, precip, low), maxTotal: 320,
  });
  updateCloudField(field, atlas, built.instances, SUN_AZ, SUN_ALT, {
    horizonGlow: { r: 1.1, g: 0.7, b: 0.45 },
    zenithSky: { r: 0.30, g: 0.45, b: 0.80 },
    betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom,
    elevScale: atmosphere.elevScale,
    cloudDiffuse: built.optics.diffuseToGround,
  });

  const grab = (bg) => {
    renderer.setClearColor(bg,1);
    renderer.setViewport(x,0,TW,TH);
    renderer.setScissor(x,0,TW,TH);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, cam);
    const b = new Uint8Array(4*TW*TH);
    gl.readPixels(x,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,b);
    return b;
  };
  const kb = grab(0x000000), kw = grab(0xffffff);

  // 구름이 있는 픽셀의 **세로 분포**. 탑이면 위아래로 길게 퍼집니다.
  let n=0, sumY=0, sumY2=0;
  const colTop = new Int32Array(TW).fill(-1);
  const colBot = new Int32Array(TW).fill(-1);
  for (let py=0; py<TH; py++) for (let px=0; px<TW; px++) {
    const p = py*TW+px;
    const a = 1 - (kw[p*4+1]-kb[p*4+1])/255;
    if (a < 0.35) continue;
    n++; sumY += py; sumY2 += py*py;
    if (colBot[px] < 0 || py < colBot[px]) colBot[px] = py;
    if (py > colTop[px]) colTop[px] = py;
  }
  // 가장 높이 솟은 기둥과 그 자리
  let tallest = 0, tallestX = -1;
  for (let px=0; px<TW; px++) if (colTop[px] >= 0) {
    const h = colTop[px] - colBot[px];
    if (h > tallest) { tallest = h; tallestX = px; }
  }
  const degPerPx = FOV_DEG / TH;

  // ── 세로 조명 기울기 ──────────────────────────────────────────────────
  //
  // 솟은 탑은 꼭대기가 햇빛을 받고 밑동이 그늘입니다. 가장 높은 기둥
  // 주변에서 위 1/3과 아래 1/3의 밝기를 견줍니다. 좌우로 폭을 조금 둬야
  // 한 열의 우연에 휘둘리지 않습니다.
  let 위합=0, 위수=0, 아래합=0, 아래수=0;
  if (tallestX >= 0 && tallest > 20) {
    const x0 = Math.max(0, tallestX-14), x1 = Math.min(TW, tallestX+15);
    const y0 = colBot[tallestX], y1 = colTop[tallestX];
    const t1 = y0 + (y1-y0)/3, t2 = y0 + 2*(y1-y0)/3;
    for (let py=y0; py<=y1; py++) for (let px=x0; px<x1; px++) {
      const p = py*TW+px;
      const a = 1 - (kw[p*4+1]-kb[p*4+1])/255;
      if (a < 0.6) continue;
      const L = (0.2126*kb[p*4] + 0.7152*kb[p*4+1] + 0.0722*kb[p*4+2]) / a;
      // WebGL 읽기는 아래가 y=0 이므로 py가 클수록 화면 위(꼭대기)입니다.
      if (py > t2) { 위합+=L; 위수++; }
      else if (py < t1) { 아래합+=L; 아래수++; }
    }
  }

  renderer.setClearColor(0x2b6c9c,1);
  renderer.setViewport(x,0,TW,TH);
  renderer.setScissor(x,0,TW,TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const g = geometry(built);
  const d = document.createElement('div');
  d.className='lbl';
  d.style.left=(x+10+12)+'px'; d.style.top='34px';
  d.innerHTML = label +
    '<br>빌보드 ' + (g?g.개수:0) + '장' +
    '<br>각크기 ' + (g?g.각크기.최소+'~'+g.각크기.최대+'° (중앙 '+g.각크기.중앙+'°)':'-') +
    '<br>종횡비 중앙 ' + (g?g.종횡비.중앙:'-') +
    '<br>밑면 ' + (g?g.밑면고도.최소+'~'+g.밑면고도.최대+'km':'-') +
    '  운정 ' + (g?g.운정고도.최소+'~'+g.운정고도.최대+'km':'-') +
    '<br>가장 높은 기둥 ' + (tallest*degPerPx).toFixed(1) + '°' +
    '<br>꼭대기/밑동 밝기 ' + (아래수 && 위수 ? (위합/위수/(아래합/아래수)).toFixed(2) : '-');
  labels.appendChild(d);
  const 꼭대기 = 위수 ? 위합/위수 : 0, 밑동 = 아래수 ? 아래합/아래수 : 0;
  return { 기하: g, 화면세로: +(tallest*degPerPx).toFixed(2), 구름픽셀: n,
           꼭대기밝기: +꼭대기.toFixed(1), 밑동밝기: +밑동.toFixed(1),
           세로대비: +(밑동 > 1 ? 꼭대기/밑동 : 0).toFixed(3) };
}

const 약한대류 = shoot('약한 대류 · 태양 18°', 0, 55, 0, 40, 18);
const 강한대류 = shoot('강한 대류 · 태양 18° (역광)', TW, 88, 0.7, 40, 18);
// 태양이 구름과 **같은 고도**에 있으면 조명 축이 세로가 아니라 옆입니다.
// 게다가 카메라가 태양 방위를 보고 있으면 역광이라 기울기 자체가 없습니다.
// 세로 기울기는 태양이 구름보다 **위**에 있을 때 생깁니다.
const 강한대류_높은태양 = shoot('강한 대류 · 태양 45°', TW*2, 88, 0.7, 40, 45);

const glErr = gl.getError();
window.__stats = { glError: glErr, 약한대류, 강한대류, 강한대류_높은태양 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length?'SHADER_ERR':'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'tower.html'), html);
console.log('생성 완료: tower.html');
