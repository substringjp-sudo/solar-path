/**
 * 셀 텍스처를 **진짜 GL 컨텍스트에 올려** 확인합니다
 * (docs/CLOUD_TEXTURE_PLAN.md 1단계).
 *
 * ## 왜 이게 따로 필요한가
 *
 * `verify-cell-field.js`는 JS 배열의 면적비를 잽니다. 그런데 1단계의 핵심
 * 주장은 "**밉맵으로 축소해도** 운량이 유지된다"이고, 그건 GPU가 실제로
 * 우리가 넘긴 밉 체인을 쓸 때만 참입니다.
 *
 * 실제로 여기서 하나 잡았습니다. 레벨마다 평활화해 둬도 GPU의 **삼선형
 * 필터가 업로드 이후에** 값을 다시 평균 쪽으로 좁힙니다. 그래서 문턱을
 * 그대로 두면 축소할수록 운량이 모자랍니다 (측정: ×16에서 -5.55%p).
 * JS 배열만 봐서는 절대 보이지 않는 오차입니다.
 *
 * ## 무엇을 재고 어떻게 고치나
 *
 * 1. 표본값 v를 그대로 화면에 써서 읽어 **필터 후 표준편차 σ**를 잽니다.
 * 2. 원래 분포(균등, σ₀ = 1/√12)에 견준 수축률 s = σ/σ₀ 를 구합니다.
 * 3. 문턱을 그만큼 중앙으로 당깁니다:  t' = 0.5 + (t₀ - 0.5) · s
 *    필터가 좁힌 분포에서 같은 분위수를 집는 것이라 운량이 되돌아옵니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cell-gl-preview.js
 *       node tools/shader-preview/shoot.js cell-gl.html cell-gl-preview.png
 */
const fs = require('fs');
const path = require('path');
const CF = require('/tmp/cellbuild/cloudCellField.js');
const PREVIEW =
  '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';

// 축소율: 타일을 화면에 몇 번 반복해 그릴 것인가.
// 1이면 확대에 가깝고, 32면 한 픽셀이 여러 셀을 덮어 밉맵이 강하게 걸립니다.
const REPEATS = [1, 2, 4, 8, 16, 32];
const COVERS = [0.15, 0.39, 0.6, 0.85];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:1152px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>같은 텍스처를 축소율만 바꿔 렌더 — 운량 0.39가 유지되는가 (보정 후)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudCellTexture } from './app/components/SkyScene3D/cloudCellTexture.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const REPEATS = ${JSON.stringify(REPEATS)};
const COVERS = ${JSON.stringify(COVERS)};
const CELL_GLSL = ${JSON.stringify(CF.CELL_FIELD_GLSL)};
const COLS = 3, ROWS = 2, TW = 376, TH = 376;

const canvas = document.getElementById('c');
canvas.width = COLS * TW; canvas.height = ROWS * TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(COLS * TW, ROWS * TH, false);

const t0 = performance.now();
const cell = createCloudCellTexture();          // ← 앱과 같은 코드
const bakeMs = performance.now() - t0;

const maxAniso = renderer.capabilities.getMaxAnisotropy();
cell.texture.anisotropy = maxAniso;
cell.texture.needsUpdate = true;

// mode 0: 표본값 v를 그대로 출력 (분포 측정용)
// mode 1: 보정한 문턱으로 구름/하늘
const mat = new THREE.ShaderMaterial({
  uniforms: {
    uCell: { value: cell.texture },
    uCover: { value: 0.39 },
    uRepeat: { value: 1.0 },
    uMode: { value: 0.0 },
    uTexelsPerPixel: { value: 1.0 },
    uRaw: { value: 0.0 },
    uTwoTap: { value: 1.0 },
  },
  vertexShader: \`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  \`,
  fragmentShader: CELL_GLSL + \`
    precision highp float;
    uniform sampler2D uCell;
    uniform float uCover, uRepeat, uMode, uTexelsPerPixel, uRaw, uTwoTap;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv * uRepeat;
      // uTwoTap이 0이면 한 번만(예전 방식), 1이면 출하될 cell_sample.
      // 분포 측정(mode 0)도 **출하 경로 그대로** 뽑아야 합니다. 한 번 뽑기로
      // 재서 맞춘 수축률을 두 번 뽑기에 쓰면 꼬리에서 어긋납니다 (겪었습니다).
      float v = uTwoTap > 0.5
        ? cell_sample(uCell, uv, vec4(1.0,0.0,0.0,0.0), vec4(0.0,1.0,0.0,0.0))
        : texture2D(uCell, uv).r;
      if (uMode < 0.5) { gl_FragColor = vec4(v, v, v, 1.0); return; }
      // uRaw가 1이면 보정 없이 1-cover, 0이면 **출하될 함수**로 문턱을 구합니다.
      float t = uRaw > 0.5 ? (1.0 - uCover) : cell_threshold(uCover, uTexelsPerPixel);
      float a = step(t, v);
      vec3 sky = vec3(0.180, 0.427, 0.588);
      vec3 cloud = vec3(0.949, 0.929, 0.894);
      gl_FragColor = vec4(mix(sky, cloud, a), 1.0);
    }
  \`,
  depthTest: false, depthWrite: false,
});

const scene = new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

const gl = renderer.getContext();
const SIGMA0 = 1 / Math.sqrt(12);   // 균등분포 [0,1)의 표준편차

function renderTile(x, y, repeat, mode, cover, raw, twoTap) {
  mat.uniforms.uTwoTap.value = twoTap === false ? 0 : 1;
  mat.uniforms.uRepeat.value = repeat;
  mat.uniforms.uMode.value = mode;
  mat.uniforms.uCover.value = cover;
  mat.uniforms.uRaw.value = raw ? 1 : 0;
  // 화면 픽셀 하나가 덮는 텍셀 수 — stage 2에서는 투영에서 해석적으로 나옵니다.
  mat.uniforms.uTexelsPerPixel.value = (cell.size * repeat) / TW;
  renderer.setViewport(x, y, TW, TH);
  renderer.setScissor(x, y, TW, TH);
  renderer.setScissorTest(true);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4 * TW * TH);
  gl.readPixels(x, y, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}

// ── 1) 축소율별로 필터 후 분포를 잽니다 ────────────────────────────────
const shrink = {};
for (const rep of REPEATS) {
  const buf = renderTile(0, 0, rep, 0, 0.39, false, true);
  let sum = 0, sum2 = 0, n = 0;
  for (let p = 0; p < TW * TH; p++) {
    const v = buf[p * 4] / 255;
    sum += v; sum2 += v * v; n++;
  }
  const mean = sum / n;
  const sigma = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  shrink[rep] = { mean: +mean.toFixed(4), sigma: +sigma.toFixed(4), s: +(sigma / SIGMA0).toFixed(4) };
}

// ── 2) 보정 전/후 운량을 비교합니다 ────────────────────────────────────
const table = [];
for (const cover of COVERS) {
  for (const rep of REPEATS) {
    const measure = (raw, twoTap) => {
      const buf = renderTile(0, 0, rep, 1, cover, raw, twoTap);
      let cloud = 0;
      for (let p = 0; p < TW * TH; p++) if (buf[p * 4] > 143) cloud++;
      return cloud / (TW * TH);
    };
    const before = measure(true, true);     // 보정 없음
    const after = measure(false, true);     // 출하될 cell_sample + cell_threshold()
    const oneTap = measure(false, false);   // 한 번만 뽑았을 때 (비교용)
    table.push({
      운량: cover, 반복: rep,
      텍셀당픽셀: +((cell.size * rep) / TW).toFixed(2),
      측정s: shrink[rep].s,
      보정전오차pp: +((before - cover) * 100).toFixed(2),
      보정후오차pp: +((after - cover) * 100).toFixed(2),
      한번뽑기오차pp: +((oneTap - cover) * 100).toFixed(2),
    });
  }
}

// ── 3) 보이는 그림은 보정 후 운량 0.39로 그립니다 ──────────────────────
const labels = document.getElementById('labels');
REPEATS.forEach((rep, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x = col * TW, y = (ROWS - 1 - row) * TH;
  renderTile(x, y, rep, 1, 0.39, false, true);
  const row2 = table.find(r => r.운량 === 0.39 && r.반복 === rep);
  const d = document.createElement('div');
  d.className = 'lbl';
  d.style.left = (x + 20) + 'px';
  d.style.top = (row * TH + 36) + 'px';
  d.textContent = '텍셀/픽셀 ' + row2.텍셀당픽셀 +
    '  보정전 ' + row2.보정전오차pp + '%p → 보정후 ' + row2.보정후오차pp + '%p';
  labels.appendChild(d);
});

const glErr = gl.getError();
window.__stats = {
  굽기ms: Math.round(bakeMs), 이방성최대: maxAniso, glError: glErr,
  수축률: shrink, 표: table,
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cell-gl.html'), html);
console.log('생성 완료: cell-gl.html');
