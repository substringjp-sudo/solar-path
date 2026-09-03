/**
 * **광각 왜곡 확인** — CloudSlab 이 아니라 **원근 카메라 자체**의 성질인지
 * 봅니다. 같은 반지름의 구를 격자무늬로 감싸고 화각만 바꿔 찍습니다.
 *
 * 앱은 표준 THREE.PerspectiveCamera(직선원근)를 씁니다 — 화면의 모든
 * 직선이 직선으로 남는 대신, 화각이 커질수록 **가장자리로 갈수록 같은
 * 각도 폭이 화면에서 점점 더 넓게 찍힙니다**(tan 함수라 90°에서 발산).
 * 90°가 이미 중심의 2배, 120°는 3배 가까이 늘어납니다 — 실제 스마트폰
 * 초광각은 광학+소프트웨어로 이 늘어남을 눌러서 찍으므로 렌더와
 * 다르게 보입니다.
 *
 * 사용: node tools/shader-preview/build-fov-check.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 480, TH = 480;
const FOVS = [60, 90, 120];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * FOVS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;background:rgba(6,10,16,.78);padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>직선원근 카메라의 화각별 가장자리 늘어남 — 격자무늬 구 하나, 화각만 바꿉니다</h3>
<p class="sub">모든 격자 칸은 실제로 같은 각도 폭(10°)입니다. 화면에서 넓이가 달라지면 카메라 탓입니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';

const TW=${TW}, TH=${TH};
const FOVS=${JSON.stringify(FOVS)};
const canvas = document.getElementById('c');
canvas.width = TW*FOVS.length; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:true, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f15);

// 10°×10° 체커 무늬를 절차적으로 굽습니다 (캔버스 텍스처).
const texCanvas = document.createElement('canvas');
texCanvas.width = 720; texCanvas.height = 360;  // 0.5°/px
const tctx = texCanvas.getContext('2d');
for (let y=0;y<360;y++) for (let x=0;x<720;x++){
  const lonDeg = x*0.5, latDeg = y*0.5 - 90;
  const cx = Math.floor(lonDeg/10), cy = Math.floor(latDeg/10);
  tctx.fillStyle = ((cx+cy)%2===0) ? '#e8dcc0' : '#3a5f8a';
  tctx.fillRect(x,y,1,1);
}
const tex = new THREE.CanvasTexture(texCanvas);
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(100, 128, 64),
  new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })
);
scene.add(sphere);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

FOVS.forEach((fov, i) => {
  const cam = new THREE.PerspectiveCamera(fov, TW/TH, 0.1, 500);
  cam.position.set(0,0,0);
  cam.lookAt(0, 0, -1);  // 격자 한 칸 경계가 화면 중앙에 오도록
  cam.updateMatrixWorld(true);
  renderer.setRenderTarget(null);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const img = ctx2d.createImageData(TW,TH);
  const flip = new Uint8ClampedArray(buf.length);
  for (let r=0;r<TH;r++) flip.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  img.data.set(flip);
  ctx2d.putImageData(img, i*TW, 0);
  const d = document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+8)+'px'; d.style.top='8px';
  d.innerHTML = 'FOV ' + fov + '°';
  labels.appendChild(d);
});

window.__errors = [];
document.title = 'DONE::OK::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'fov-check.html'), html);
console.log('생성 완료: fov-check.html');
