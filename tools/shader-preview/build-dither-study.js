/**
 * **디더 습작** — 밴딩을 어디서 흩어야 하는가.
 *
 * 넓고 완만한 그라데이션에서는 인접 픽셀의 참값 차가 1/255보다 작습니다.
 * 그러면 여러 픽셀이 같은 정수로 내려앉아 **평평한 띠**가 되고, 띠 사이에
 * 계단이 보입니다. 노을 하늘이 정확히 그 조건입니다.
 *
 * 네 칸을 나란히 놓습니다. 스카이돔 셰이더 안에서 뿌리는 예전 방식과,
 * 후처리 마지막 패스에서 뿌리는 새 방식이 **같은 일을 하지 않기** 때문입니다
 * — 스카이돔은 분리 해상도 합성에서 절반 해상도로 그려진 뒤 확대되고,
 * 화면 양자화는 그 확대 뒤에 일어납니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-dither-study.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 420;
// 시선을 태양 반대쪽 높은 하늘로 둡니다 — 구조물 없이 그라데이션만 남는
// 곳이라야 밴딩이 무엇 때문인지 헷갈리지 않습니다.
const VIEW_AZ = 90, VIEW_ELEV = 32, FOV_DEG = 34;
const SUN_ALT = -4.0, SUN_AZ = 268;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.8);
   padding:5px 8px;border-radius:5px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>디더 — 밴딩을 어디서 흩는가 (박명 ${SUN_ALT}°, 태양 반대쪽 하늘, 구름 없음)</h3>
<p class="sub">위: 실제 화면(디더는 1단계 미만이라 육안으로는 같아 보입니다). 아래: <b>세로 미분을 64배 증폭</b> — 밴딩은 가로줄 등고선으로, 디더는 고른 잡음으로 나타납니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import {
  createSceneComposer, assignLayer, DEFAULT_BLOOM, DEFAULT_GOD_RAYS, DEFAULT_DITHER,
  LAYER_SOFT_SKY,
} from './app/components/SkyScene3D/SceneComposer.js';
import { makeAtmosphereParams } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH*2;
const ctx2d = canvas.getContext('2d');

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240, betaMie: 0.09, humidityPct: 60,
});
const skydome = createSkydome();
scene.add(skydome.mesh);
assignLayer(skydome.mesh, LAYER_SOFT_SKY);
updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);

// 블룸과 광선은 끕니다 — 밴딩만 보려는 화면에 구조를 얹으면 평탄구간
// 측정이 그 구조를 재게 됩니다.
const composer = createSceneComposer(TW, TH, 2,
  { ...DEFAULT_BLOOM, strength: 0 }, { ...DEFAULT_GOD_RAYS, strength: 0 }, 0);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(domeDither, finalDither) {
  skydome.material.uniforms.uDither.value = domeDither;
  composer.setDither(finalDither);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  composer.render(renderer, scene, cam);
  const buf = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

function paint(buf, x) {
  const img = ctx2d.createImageData(TW, TH);
  for (let y = 0; y < TH; y++) {
    const src = (TH-1-y)*TW*4, dst = y*TW*4;
    for (let i = 0; i < TW*4; i++) img.data[dst+i] = buf[src+i];
  }
  ctx2d.putImageData(img, x, 0);
}

/**
 * 밴딩은 1단계 차이라 화면 그대로로는 안 보입니다. 세로 미분을 크게
 * 증폭하면 계단이 **가로줄 등고선**으로 드러납니다 — 디더가 들으면 그
 * 등고선이 고른 잡음으로 흩어집니다. 지표와 같은 것을 눈으로 봅니다.
 */
const AMP = 64;
function paintDerivative(buf, x) {
  const img = ctx2d.createImageData(TW, TH);
  for (let y = 0; y < TH; y++) {
    const sy = TH-1-y;
    for (let px = 0; px < TW; px++) {
      const a = buf[((sy>0?sy-1:sy)*TW+px)*4+1], b = buf[(sy*TW+px)*4+1];
      const v = Math.max(0, Math.min(255, 128 + (b-a)*AMP));
      const d = (y*TW+px)*4;
      img.data[d] = img.data[d+1] = img.data[d+2] = v;
      img.data[d+3] = 255;
    }
  }
  ctx2d.putImageData(img, x, TH);
}

// 측정 영역 — 가장자리를 피해 매끈한 안쪽만.
const X0 = 40, X1 = TW-40, Y0 = 40, Y1 = TH-40;

/**
 * **평탄구간** — 세로로 훑을 때 같은 값이 이어지는 길이.
 *
 * 이것이 밴딩의 정의입니다. 참값은 계속 변하는데 정수로 내려앉으면서
 * 여러 픽셀이 한 값에 뭉치는 것. 디더가 들으면 이 길이가 1~2로 떨어집니다.
 *
 * ⚠ 초록 채널만 봅니다. 밴딩은 채널마다 따로 생기고, 밝기로 합치면
 * 세 채널의 계단이 서로 다른 자리에 있어 평탄구간이 짧아 **보입니다** —
 * 실제로는 각 채널이 여전히 띠져 있는데 지표만 좋아집니다.
 */
function plateaus(buf) {
  let runs = 0, total = 0, longest = 0;
  for (let x = X0; x < X1; x++) {
    let run = 1;
    for (let y = Y0+1; y < Y1; y++) {
      const a = buf[((y-1)*TW+x)*4+1], b = buf[(y*TW+x)*4+1];
      if (a === b) run++;
      else { runs++; total += run; if (run > longest) longest = run; run = 1; }
    }
    runs++; total += run; if (run > longest) longest = run;
  }
  return { 평균: +(total/runs).toFixed(2), 최장: longest };
}

/**
 * 디더의 **대가** — 국소 평균에서 벗어난 양. 디더는 잡음을 얹어 밴딩을
 * 사는 거래라, 얼마나 얹었는지 함께 봐야 고를 수 있습니다.
 */
function noise(buf) {
  let s = 0, n = 0;
  for (let y = Y0+1; y < Y1-1; y++) {
    for (let x = X0+1; x < X1-1; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) m += buf[((y+dy)*TW+x+dx)*4+1];
      const d = buf[(y*TW+x)*4+1] - m/9;
      s += d*d; n++;
    }
  }
  return +Math.sqrt(s/n).toFixed(3);
}

/**
 * 디더를 걸 수 있는 자리가 셋이고, **셋이 같은 일을 하지 않습니다.**
 *
 *  - 스카이돔 셰이더 안 (절반 해상도, 값은 연속)
 *  - 확대 패스 (원해상도, 쌍선형 보간이 만든 연속값을 다시 양자화)
 *  - 후처리 마지막 패스 (원해상도, 그러나 값은 **이미 8비트로 내려앉은 뒤**)
 *
 * 세 번째가 아무 일도 안 한다는 것을 재고 알았습니다 — 중간 렌더 타깃이
 * 8비트라 정수에 ±0.5를 얹고 반올림하면 같은 정수로 돌아옵니다.
 */
const CASES = [
  ['디더 없음', 0, 0],
  ['확대 패스만', 0, DEFAULT_DITHER],
  ['스카이돔 ×1 + 확대', 1, DEFAULT_DITHER],
  ['스카이돔 ×2 + 확대', 2, DEFAULT_DITHER],
];

const 결과 = CASES.map(([name, dd, fd], i) => {
  const buf = shoot(dd, fd);
  paint(buf, i*TW);
  paintDerivative(buf, i*TW);
  const pl = plateaus(buf);
  const nz = noise(buf);
  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (i*TW + 8 + 12) + 'px';
  d.style.top = '58px';
  d.innerHTML = name +
    '<br>평탄구간 평균 ' + pl.평균 +
    '<br>평탄구간 최장 ' + pl.최장 +
    '<br>잡음 ' + nz;
  labels.appendChild(d);
  return { 이름: name, 스카이돔디더: dd, 최종디더: fd, ...pl, 잡음: nz };
});

window.__stats = { glError: gl.getError(), 기본디더: DEFAULT_DITHER, 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'dither-study.html'), html);
console.log('생성 완료: dither-study.html');
