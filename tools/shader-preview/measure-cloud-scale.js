/**
 * 구름의 **각크기**를 잽니다 — 색이 아니라 공간 주파수.
 *
 * Why: 실제 하늘과 앱을 나란히 놓았을 때 남은 차이가 색이 아니라 조각 크기라는
 * 것을 알아냈는데, "굵어 보인다"로는 고쳤는지 알 수가 없습니다. 이 프로젝트에서
 * 눈 대신 숫자로 재는 습관이 이미 세 번 오류를 잡았으므로(docs/TWILIGHT.md,
 * 이 디렉터리의 README) 여기서도 재는 방법을 먼저 고정합니다.
 *
 * 무엇을 재나: `CloudDeck.ts`의 FRAG에 있는 fbm/holeCut 식을 **소스에서 상수를
 * 읽어** JS로 옮겨 계산하고, 고도 45° 원을 따라 방위 360°를 훑으며 알파가
 * 0↔1을 넘나드는 횟수를 셉니다. 교차 횟수를 대권 길이로 나누면 조각 하나의
 * 평균 각크기가 나옵니다.
 *
 * 렌더가 아니라 순수 계산이라 서버도 크로미움도 필요 없습니다.
 *
 * 기준값 (2026-08 측정, 개선 전):
 *   운량 0.39 → 42.4°   운량 0.60 → 28.3°   운량 0.80 → 25.5°
 * 목표 (docs/CLOUD_TEXTURE_PLAN.md §6): 고적운 장면에서 1~3°.
 *
 * 사용: node tools/shader-preview/measure-cloud-scale.js
 */
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '../..');

// ── 셰이더 소스에서 상수를 읽어옵니다 ─────────────────────────────────────
// 여기 숫자를 손으로 베끼면 셰이더를 고쳤을 때 측정이 조용히 거짓말을 합니다.
const deckSrc = fs.readFileSync(
  path.join(SRC, 'src/components/SkyScene3D/CloudDeck.ts'), 'utf8');

const grab = (re, label) => {
  const m = deckSrc.match(re);
  if (!m) throw new Error(`CloudDeck.ts에서 ${label}를 찾지 못했습니다 — 식이 바뀌었나요?`);
  return parseFloat(m[1]);
};

// vec2 uv = (hdir / hlen) * rad * 5.2;
const UV_SCALE = grab(/\*\s*rad\s*\*\s*([\d.]+)\s*;/, 'uv 스케일');
// float holes = fbm(uv * 1.5);
const HOLE_FREQ = grab(/holes\s*=\s*fbm\(uv\s*\*\s*([\d.]+)\)/, 'holeCut 주파수');
// float holeCut = smoothstep(0.68 - vCover * 0.50, 0.96 - vCover * 0.50, holes);
const HOLE_LO = grab(/holeCut\s*=\s*smoothstep\(([\d.]+)\s*-\s*vCover/, 'holeCut 하단');
const HOLE_HI = grab(/holeCut\s*=\s*smoothstep\([\d.]+\s*-\s*vCover\s*\*\s*[\d.]+,\s*([\d.]+)/, 'holeCut 상단');
const HOLE_SLOPE = grab(/holeCut\s*=\s*smoothstep\([\d.]+\s*-\s*vCover\s*\*\s*([\d.]+)/, 'holeCut 기울기');
// p = rot * p * 2.02;
const LACUNARITY = grab(/p\s*=\s*rot\s*\*\s*p\s*\*\s*([\d.]+)\s*;/, 'fbm lacunarity');

// ── GLSL 식을 그대로 옮깁니다 ─────────────────────────────────────────────
const fract = x => x - Math.floor(x);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

function noise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = px - ix, fy = py - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** 옥타브 기여를 따로 돌려주는 fbm (CloudDeck.ts와 같은 회전 행렬·감쇠) */
function fbmOctaves(px, py) {
  const out = [];
  let amp = 0.5, x = px, y = py;
  for (let i = 0; i < 4; i++) {
    out.push({ amp, val: amp * noise(x, y) });
    const nx = 0.80 * x + 0.60 * y;
    const ny = -0.60 * x + 0.80 * y;
    x = nx * LACUNARITY;
    y = ny * LACUNARITY;
    amp *= 0.5;
  }
  return out;
}
const fbm = (x, y) => fbmOctaves(x, y).reduce((s, o) => s + o.val, 0);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// uv 1단위가 몇 도인가 — rad는 고도 90° 구간에 걸쳐 0→1, uv 반지름은 0→UV_SCALE
const DEG_PER_UV = 90 / UV_SCALE;
const WINDOW = HOLE_HI - HOLE_LO;

console.log('읽어온 상수: uv×%s, fbm×%s, 문턱 %s~%s (창 %s), lacunarity %s',
  UV_SCALE, HOLE_FREQ, HOLE_LO, HOLE_HI, WINDOW.toFixed(2), LACUNARITY);
console.log('uv 1단위 = %s°\n', DEG_PER_UV.toFixed(1));

// ── 1) 옥타브 분해 — 어느 옥타브가 문턱을 넘을 힘이 있나 ──────────────────
console.log('== holeCut이 쓰는 fbm의 옥타브별 각크기 ==');
console.log('옥타브 │  각크기 │   진폭 │ 문턱창 대비 │ 문턱을 넘나');
for (let i = 0; i < 4; i++) {
  const deg = DEG_PER_UV / HOLE_FREQ / Math.pow(LACUNARITY, i);
  const amp = 0.5 / Math.pow(2, i);
  const ratio = amp / WINDOW;
  console.log('  %d    │ %s° │ %s │ %s%% │ %s',
    i, deg.toFixed(2).padStart(6), amp.toFixed(4),
    (ratio * 100).toFixed(0).padStart(8),
    ratio >= 1 ? '예 — 구멍을 뚫고 막음' : '아니오 — 가장자리만 울림');
}

// ── 2) 실측 — 알파가 실제로 열리고 닫히는 주기 ────────────────────────────
console.log('\n== 실측: 고도 45° 원을 따라 알파 0↔1 교차 ==');
const ELEV = 45;
const rad = (90 - ELEV) / 90;
const arcDeg = 360 * Math.cos((ELEV * Math.PI) / 180); // 대권 기준 실제 각거리
const N = 20000;

console.log('운량 │ 교차 │ 평균 조각 크기 │ 실제(고적운 1~3°) 대비');
const results = [];
for (const cover of [0.2, 0.39, 0.6, 0.8, 0.95]) {
  const lo = HOLE_LO - cover * HOLE_SLOPE;
  const hi = HOLE_HI - cover * HOLE_SLOPE;
  let crossings = 0, prev = null;
  for (let k = 0; k < N; k++) {
    const az = (k / N) * 2 * Math.PI;
    const ux = Math.cos(az) * rad * UV_SCALE * HOLE_FREQ;
    const uy = Math.sin(az) * rad * UV_SCALE * HOLE_FREQ;
    const open = smoothstep(lo, hi, fbm(ux, uy)) > 0.5;
    if (prev !== null && open !== prev) crossings++;
    prev = open;
  }
  const featureDeg = crossings > 0 ? (2 * arcDeg) / crossings : Infinity;
  results.push({ cover, featureDeg });
  const times = featureDeg / 2; // 실제 1~3°의 중앙값 2°와 비교
  console.log('%s │ %s │ %s° │ %s배 굵음',
    cover.toFixed(2), String(crossings).padStart(4),
    featureDeg.toFixed(1).padStart(14),
    Number.isFinite(times) ? times.toFixed(0).padStart(4) : '  ∞');
}

// ── 3) 통과 면적비가 운량을 따라가는가 ────────────────────────────────────
// 39%가 화면에서 39%로 보이려면 문턱 통과 면적이 운량과 같아야 합니다.
console.log('\n== 통과 면적비 vs 운량 (39%가 39%로 보이나) ==');
console.log('운량 │ 실제 통과 면적 │ 오차');
const M = 400;
for (const cover of [0.2, 0.39, 0.6, 0.8]) {
  const lo = HOLE_LO - cover * HOLE_SLOPE;
  const hi = HOLE_HI - cover * HOLE_SLOPE;
  let sum = 0, n = 0;
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const ux = ((i / M) * 2 - 1) * UV_SCALE * HOLE_FREQ;
      const uy = ((j / M) * 2 - 1) * UV_SCALE * HOLE_FREQ;
      sum += smoothstep(lo, hi, fbm(ux, uy));
      n++;
    }
  }
  const frac = sum / n;
  const err = frac - cover;
  console.log('%s │ %s │ %s%s',
    cover.toFixed(2), frac.toFixed(3).padStart(14),
    err >= 0 ? '+' : '', (err * 100).toFixed(1) + '%p');
}

console.log('\n기준값(개선 전, 2026-08): 운량 0.39 → 42.4°');
console.log('목표: docs/CLOUD_TEXTURE_PLAN.md §6 — 고적운 장면에서 1~3°');
