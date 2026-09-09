/**
 * **AR 방위각 눈금 — 시뮬레이터가 그리는 각과 앱이 믿는 각이 같은가.**
 *
 * 실기 보고: "카메라랑 시뮬레이터를 동시에 돌렸을 때 특히 방위각이 차이가
 * 많이 난다."
 *
 * ## 코드를 읽으면 한 화면 안에 방위각 규약이 **둘**입니다
 *
 * `SunCamera.tsx` 는 카메라 상자와 시뮬레이터 상자를 4:3 으로 위아래
 * 나란히 놓고, 그 아래 나침반 눈금자를 답니다. 그런데
 *
 *  - **시뮬레이터** — `camera.fov = currentFov` (three.js 의 fov 는 **세로**
 *    화각). 1배에서 60°, 상자 가로세로비 4:3 이므로 가로 화각은
 *    `2·atan(tan(30°)·4/3) = 75.6°` 입니다.
 *  - **나침반 눈금자** — `pxPerDeg = (BOX_WIDTH - 24) / 70`. **70° 상수**이고
 *    `currentFov` 를 아예 안 봅니다.
 *
 * 곧 같은 화소가 시뮬레이터에서는 75.6°/폭, 눈금자에서는 70°/폭 을 뜻합니다.
 * 게다가 눈금자는 **선형**인데 원근 투영은 `x ∝ tan θ` 라 가장자리로 갈수록
 * 더 벌어지고, `currentFov` 는 핀치 줌에 따라 변하는데 눈금자는 안 변합니다.
 *
 * ## 자 — 태양을 표적으로 화소당 각을 직접 잽니다
 *
 * 태양을 하늘에 두고 **카메라 방위만** 돌려 태양이 화면 어디에 찍히는지
 * 무게중심으로 찾습니다. 그러면 렌더러가 실제로 쓰는 사상을 화소로 얻습니다
 * (투영 행렬을 믿지 않고 그려진 화소를 잽니다).
 *
 * 견주는 대상 셋:
 *  ① 렌더가 실제로 놓은 자리
 *  ② 나침반 눈금자가 놓았을 자리 — 선형 70°
 *  ③ 올바른 원근 사상 — `x = (W/2)·tan θ / tan(가로화각/2)`
 *
 * ② 와 ① 의 차이를 **각으로 되돌려** 적습니다. 그것이 사용자가 화면에서
 * 보는 어긋남입니다.
 *
 * ⚠ 이 자는 **센서를 안 봅니다.** 자기 편각·자이로 드리프트·최초 보정은
 * 기기가 있어야 재는 것이고, 여기서 재는 것은 그것과 무관하게 **코드만으로
 * 이미 어긋나 있는 몫**입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-ar-azimuth.js
 *       node tools/shader-preview/verify-ar-azimuth.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

// 앱과 같은 4:3 상자. 실제 폭은 기기마다 다르지만 비만 같으면 각은 같습니다.
const TW = 480, TH = 360;
// 앱 기본값: 1배에서 세로 화각 60°.
const BASE_FOV = 60;
// 앱의 나침반 눈금자 상수 — SunCamera.tsx: pxPerDeg = (BOX_WIDTH - 24) / 70
const RULER_SPAN_DEG = 70;
const RULER_PAD_PX = 24;
// 재는 방위 어긋남(도). 앱 눈금자는 ±40° 까지 그립니다.
const OFFSETS = [0, 5, 10, 15, 20, 25, 30, 35];
// 배율 — 앱은 1~5배 (currentMagnification = 1 + zoom*4)
const MAGS = [1, 2, 5];

// ⚠ **고도 0 이라야 합니다.** 처음엔 고도 12° 로 뒀는데, 광축이 위로
// 기운 채 방위만 돌리면 시선이 원뿔을 그려 태양이 화면 **가로선을 안
// 따라갑니다** — 30° 어긋남에서 렌더 152px 대 이상 180px 로 벌어졌고,
// 그게 결함인 줄 알 뻔했습니다. 나침반 눈금자도 지평선 줄이므로 고도 0
// 에서 견주는 것이 맞습니다.
const SUN_ALT = 0;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px}
 h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px}
 .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>AR 방위각 눈금 — 렌더 대 나침반 눈금자</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
// ⚠ **태양을 표적으로 쓰면 안 됩니다.** 처음엔 태양 원반을 표적으로 삼았는데,
//   고도 0 에서는 지평선 발광이 원반만큼 밝아 밝기 문턱으로 자른 덩어리가
//   지평선 띠와 뭉쳐 화면 폭의 1/3 을 넘었습니다(검출 실패). 고도를 올리면
//   이번엔 광축이 기울어 방위 회전이 화면 가로선을 안 따릅니다. 그래서
//   **전용 표적**을 답니다 — 순수 초록 구슬. 하늘은 어느 시각에도 초록이
//   우세하지 않으므로 색만으로 확실히 갈립니다.
import { makeAtmosphereParams } from './app/utils/atmosphere.js';
// ⚠ **앱의 진짜 함수**를 씁니다 — 베껴 오면 앱만 고치고 하네스는 옛 식을
//   그대로 재서 "고쳤는데 수치가 그대로"가 됩니다.
import { horizontalFovDeg, azimuthOffsetToPx, pxToAzimuthOffset }
  from './app/utils/arProjection.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH}, BASE_FOV=${BASE_FOV};
const RULER_SPAN_DEG=${RULER_SPAN_DEG}, RULER_PAD_PX=${RULER_PAD_PX};
const OFFSETS=${JSON.stringify(OFFSETS)}, MAGS=${JSON.stringify(MAGS)};
const SUN_ALT=${SUN_ALT};
const SUN_AZ = 250;

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240,
  humidityPct: 55, visibilityM: 40000,
});
const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);
const MARK_DIST = 500;
const MARK_HALF_DEG = 0.75;                       // 반각 — 태양(0.27°)보다 조금 큼
const mark = new THREE.Mesh(
  new THREE.SphereGeometry(MARK_DIST * Math.tan(MARK_HALF_DEG*Math.PI/180), 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, depthWrite: false }));
mark.renderOrder = 999;
// 표적은 고도 0 — 나침반 눈금자가 지평선 줄이므로 거기서 견줍니다.
mark.position.set(MARK_DIST*Math.sin(SUN_AZ*Math.PI/180), 0, -MARK_DIST*Math.cos(SUN_AZ*Math.PI/180));
scene.add(mark);

/** 앱과 같은 식으로 배율에서 세로 화각을 냅니다 (SunCamera.tsx: currentFov). */
function fovForMag(mag){
  const tanHalf = Math.tan((BASE_FOV * Math.PI / 180) / 2) / mag;
  return 2 * Math.atan(tanHalf) * 180 / Math.PI;
}

function makeCam(camAzDeg, fovDeg){
  const cam = new THREE.PerspectiveCamera(fovDeg, TW/TH, 0.1, 4000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  // 시선도 고도 0 — 방위 회전이 화면 가로선을 정확히 따릅니다.
  const ar=camAzDeg*Math.PI/180;
  cam.lookAt(100*Math.sin(ar), 0, -100*Math.cos(ar));
  cam.updateMatrixWorld(true);
  return { cam };
}

function shoot(camAzDeg, fovDeg){
  const { cam } = makeCam(camAzDeg, fovDeg);
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return { buf, cam };
}

const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/**
 * 태양 원반의 가로 무게중심(화소).
 *
 * ⚠ 하늘돔도 태양 쪽이 밝아 그냥 최대만 잡으면 후광에 끌립니다. 그래서
 *   **가장 밝은 값의 92% 위**만 무게로 씁니다 — 원반은 후광보다 훨씬
 *   밝으므로 그 문턱이면 원반만 남습니다. 남은 화소가 너무 적으면(원반이
 *   화면 밖) null 을 돌려 자가 조용히 거짓말하지 않게 합니다.
 */
/**
 * 초록 표적의 가로 무게중심(화소).
 *
 * 색으로 가르므로 밝기 문턱이 필요 없습니다. 표적이 화면 밖이거나
 * 가장자리에 잘리면 null 을 돌려 자가 조용히 거짓말하지 않게 합니다.
 */
function markCentroidX(buf){
  let sx = 0, n = 0, x0 = TW, x1 = -1, y0 = TH, y1 = -1;
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++){
    const i = (y*TW + x) * 4;
    const R = buf[i], G = buf[i+1], B = buf[i+2];
    if (G > 150 && G > R * 1.6 && G > B * 1.6) {
      sx += x; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (n < 12) return null;
  // 잘린 표적은 무게중심이 안쪽으로 끌립니다 — 버립니다.
  if (x0 <= 1 || x1 >= TW-2 || y0 <= 1 || y1 >= TH-2) return null;
  return { x: sx / n, 화소수: n };
}

function paint(buf, label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='240px'; c.style.height='180px';
  const cx=c.getContext('2d');
  const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
}

const 결과={};
for (const mag of MAGS){
  const fov = fovForMag(mag);
  // 이 상자에서 렌더가 실제로 덮는 가로 화각.
  const hFov = 2 * Math.atan(Math.tan(fov*Math.PI/180/2) * (TW/TH)) * 180/Math.PI;
  const rulerPxPerDeg = (TW - RULER_PAD_PX) / RULER_SPAN_DEG;
  const 칸 = [];
  for (const off of OFFSETS){
    // 카메라를 태양에서 off 만큼 **왼쪽**으로 돌리면 태양은 오른쪽으로 갑니다.
    const { buf, cam } = shoot(SUN_AZ - off, fov);
    if (mag === 1 && (off === 0 || off === 20 || off === 35)) paint(buf, '1배 ' + off + '°');
    const c = markCentroidX(buf);
    // ⚠ 자가 스스로를 검증합니다 — 같은 점을 three.js 투영 행렬로도 옮겨
    //   화소 무게중심과 맞는지 봅니다. 어긋나면 재는 쪽이 틀린 것입니다.
    const wv = new THREE.Vector3(
      100*Math.sin(SUN_AZ*Math.PI/180), 0, -100*Math.cos(SUN_AZ*Math.PI/180));
    wv.project(cam);
    const 투영x = (wv.x * 0.5) * TW;
    if (!c){ 칸.push({ 어긋남: off, 렌더x: null, 투영x: +투영x.toFixed(2) }); continue; }
    const dxRender = c.x - (TW/2);
    // ① **고치기 전** 눈금자가 놓았을 자리 — 선형 70° 상수.
    const dxRuler = off * rulerPxPerDeg;
    // ② **고친 뒤** 눈금자가 놓는 자리 — 앱과 같은 함수.
    const dxFixed = azimuthOffsetToPx(off, TW, hFov);
    // ③ 올바른 원근 사상(자 자신의 독립 계산 — ② 를 검산합니다).
    const dxIdeal = (TW/2) * Math.tan(off*Math.PI/180) / Math.tan(hFov*Math.PI/180/2);
    // 눈금자 화소를 렌더의 사상으로 되읽으면 몇 도인가 — 화면에서 보는 어긋남.
    const 눈금자가읽는각 = pxToAzimuthOffset(dxRuler, TW, hFov);
    const 고친눈금자각 = dxFixed === null ? null : pxToAzimuthOffset(dxFixed, TW, hFov);
    칸.push({
      어긋남: off,
      렌더x: +dxRender.toFixed(2),
      투영x: +투영x.toFixed(2),
      이상x: +dxIdeal.toFixed(2),
      눈금자x: +dxRuler.toFixed(2),
      고친눈금자x: dxFixed === null ? null : +dxFixed.toFixed(2),
      눈금자가읽는각: +눈금자가읽는각.toFixed(2),
      눈금오차도: +(눈금자가읽는각 - off).toFixed(2),
      고친오차도: 고친눈금자각 === null ? null : +(고친눈금자각 - off).toFixed(3),
    });
  }
  결과['배율'+mag] = { 세로화각:+fov.toFixed(2), 가로화각:+hFov.toFixed(2),
                      눈금자화각: RULER_SPAN_DEG, 칸 };
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'ar-azimuth.html'), html);
console.log('생성 완료: ar-azimuth.html');
