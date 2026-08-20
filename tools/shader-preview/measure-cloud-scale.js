/**
 * **개선 전 덱의 각크기 기준값을 재현합니다** (docs/CLOUD_TEXTURE_PLAN.md).
 *
 * ⚠ 이 스크립트는 **지금 덱을 재지 않습니다.** 2단계에서 투영과 문턱 식이
 * 통째로 바뀌었기 때문입니다. 지금 덱은 `verify-deck-scale.js`로 재세요 —
 * 그쪽은 `CloudDeck.ts`를 실제로 임포트해 렌더된 픽셀에서 잽니다.
 *
 * 그래도 남겨 두는 이유: **개선 전후를 같은 정의로 나란히 놓기 위해서**입니다.
 * "42.4°였다"가 재현 가능해야 "지금 2.5°다"가 의미를 갖습니다.
 *
 * 원래는 `CloudDeck.ts`에서 상수를 읽어 왔습니다. 2단계가 그 식들을 지우면서
 * 읽기가 실패했는데, 그건 감시가 제대로 동작한 것입니다. 이제 과거 값이므로
 * **그때 값을 고정**해 둡니다 — 소스를 읽으면 오히려 거짓말이 됩니다.
 *
 * ## 그때 무엇이 문제였나
 *
 * 세밀한 무늬가 **없는 게 아니라 문턱을 넘을 힘이 없었습니다.** 옥타브 3이
 * 1.40°짜리 무늬를 갖고 있었지만 진폭이 문턱창의 22%뿐이라 구멍을 뚫지도
 * 막지도 못했습니다. 문턱을 넘는 것은 11.5°짜리 옥타브 0 하나뿐이었습니다.
 *
 * 사용: node tools/shader-preview/measure-cloud-scale.js
 */

// ── 2026-08, 2단계 이전 `CloudDeck.ts` FRAG의 상수 ────────────────────────
//   vec2  uv      = (hdir / hlen) * rad * 5.2;
//   float holes   = fbm(uv * 1.5);
//   float holeCut = smoothstep(0.68 - vCover * 0.50, 0.96 - vCover * 0.50, holes);
//   p = rot * p * 2.02;   // fbm lacunarity
const UV_SCALE = 5.2;
const HOLE_FREQ = 1.5;
const HOLE_LO = 0.68;
const HOLE_HI = 0.96;
const HOLE_SLOPE = 0.50;
const LACUNARITY = 2.02;

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

console.log('※ 2단계 이전 덱의 재현입니다. 지금 덱은 verify-deck-scale.js 로 재세요.\n');
console.log('그때 상수: uv×%s, fbm×%s, 문턱 %s~%s (창 %s), lacunarity %s',
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

// **주기와 조각을 나눠 적습니다.**
// 교차 두 번이 조각 하나 + 틈 하나 = 한 주기입니다. WMO가 정의하는 것은
// 조각 쪽(= 주기 × 실제 덮은 면적)이라, 둘을 섞으면 개선 전후 비교가
// 사과 대 오렌지가 됩니다. verify-deck-scale.js도 같은 정의를 씁니다.
console.log('운량 │ 교차 │   주기 │ 실제 면적 │   조각 │ WMO 고적운 1~5° 대비');
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
  const periodDeg = crossings > 0 ? (2 * arcDeg) / crossings : Infinity;

  // 이 운량에서 덱이 **실제로** 덮는 면적 (§1-D의 계통 오차 포함)
  let sum = 0, n = 0;
  const M = 200;
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const ux = ((i / M) * 2 - 1) * UV_SCALE * HOLE_FREQ;
      const uy = ((j / M) * 2 - 1) * UV_SCALE * HOLE_FREQ;
      sum += smoothstep(lo, hi, fbm(ux, uy));
      n++;
    }
  }
  const area = sum / n;
  const elementDeg = Number.isFinite(periodDeg) ? periodDeg * area : Infinity;
  results.push({ cover, periodDeg, elementDeg, area });
  const times = elementDeg / 3; // WMO 고적운 상한 근처(3°)와 비교
  console.log('%s │ %s │ %s° │ %s │ %s° │ %s',
    cover.toFixed(2), String(crossings).padStart(4),
    periodDeg.toFixed(1).padStart(6), area.toFixed(3).padStart(9),
    Number.isFinite(elementDeg) ? elementDeg.toFixed(2).padStart(6) : '     ∞',
    Number.isFinite(times) ? times.toFixed(1) + '배 굵음' : '조각이 안 생김');
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

console.log('\n기준값 (개선 전, 2026-08): 운량 0.39 → 주기 42.4°, 조각 5.85°');
console.log('2단계 후 (verify-deck-scale.js): 주기 4.8~7.5°, 조각 1.63~2.97°');
console.log('이 스크립트는 **예전 덱 식**을 재현합니다 — 지금 덱은 여기가 아니라');
console.log('verify-deck-scale.js 로 재세요. 두 수치를 나란히 두려고 남겨 둡니다.');
