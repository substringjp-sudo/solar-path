/**
 * `SHAPE_MEAN` · `SHAPE_SIG_RATIO` 를 **하늘 평균**에 맞춥니다 (2026-10-01). `build-cover-area-avg.js` 를 씁니다.
 *
 * 문턱 식(CloudSlab `slab_layer_thickness`): q = σ(1.702·(f − μ)/s), 구름 ⇔ q > 1 − c.
 *   ⇔ f > μ + s·g(c),  g(c) = logit(1 − c)/1.702.
 * 그래서 지금 상수(μ₀, s₀)로 여러 운량 c 에서 잰 하늘 평균 면적 A(c) 는 모양장 누적분포 F 의 점
 *   (x = μ₀ + s₀·g(c),  F = 1 − A(c)) 를 줍니다. 목표 "A(c) = c" 는 μ + s·g(c) = F⁻¹(1 − c) 이므로,
 * 목표 운량들에서 F⁻¹(1 − c) 를 g(c) 에 직선으로 맞추면 기울기가 s, 절편이 μ 입니다.
 * 근사(층마다 운량을 흔드는 느린 항·군집, 두께 문턱)는 남으므로 한 번 더 재서 고칩니다.
 *
 * **맞추기는 짝수 흐름 시각으로만** 합니다(방위 8 다). 확인(verify-cover-area-avg.js)은 홀수 시각으로 — 맞춘 자료로
 * 채점하지 않습니다.
 *
 * 사용: node tools/shader-preview/fit-cover-area-avg.js   (미리보기 서버 8123, stage-esm·build 먼저)
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

const S0 = 0.16;
// 시작점: 지금 코드의 상수. CUR 환경변수(JSON)로 다른 데서 시작할 수 있습니다(한 번 더 고칠 때).
const CUR = process.env.CUR ? JSON.parse(process.env.CUR) : { mean: { low: 0.597, mid: 0.377, high: 0.515 }, sig: { low: 0.654, mid: 0.652, high: 0.986 } };
const ROUNDS = +(process.env.ROUNDS || 2);
const PROBE = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.97];
// 맞추기: 짝수 시각 12개 × 방위 4. 확인(verify)은 홀수 시각 × 다른 방위 4 — 느린 항이 커서 두 시각으로는
// 평균이 안 잡혔습니다(흐름 0·12시로 맞춘 값이 6·18시에서 저층 25% → 0.29 대 0.51).
const FIT_DRIFTS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
// ⚠ 방위를 나눠 맞추면(0/90/180/270 → 확인 45/135/…) 상층이 확인에서 0.17 어긋났습니다 — 권운 줄무늬가 바람에
// 누워 있어 보는 방위에 따라 면적이 실제로 다릅니다. 앱은 모든 방위를 보므로 방위는 8개 다 쓰고 시각으로만 나눕니다.
const FIT_AZS = [0, 45, 90, 135, 180, 225, 270, 315];
const TARGET = [0.1, 0.25, 0.5, 0.75, 0.9];
const g = c => Math.log((1 - c) / c) / 1.702;

async function measure(page, consts, covers, drifts) {
  const enc = o => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(',');
  const url = `${ORIGIN}/cover-area-avg.html?drifts=${drifts.join(',')}&azs=${FIT_AZS.join(',')}&covers=${covers.join(',')}&mean=${enc(consts.mean)}&sig=${enc(consts.sig)}`;
  await page.goto(url, { timeout: 600000 });
  await page.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 3600000, polling: 1000 });
  const errs = await page.evaluate(() => window.__errors);
  if (errs.length) throw new Error(errs[0]);
  return page.evaluate(() => window.__out);
}

function fitLayer(points, mu0, s0) {
  // points: [{cover, area016}] → F 점들
  const F = points.map(p => ({ x: mu0 + s0 * g(p.cover), F: 1 - p.area016 })).sort((a, b) => a.x - b.x);
  // 단조화(누적 최대) — 잡음으로 거꾸로 선 점을 펴 줍니다.
  for (let i = 1; i < F.length; i++) F[i].F = Math.max(F[i].F, F[i - 1].F);
  const inv = (y) => {
    if (y <= F[0].F) return F[0].x;
    if (y >= F[F.length - 1].F) return F[F.length - 1].x;
    for (let i = 1; i < F.length; i++) if (y <= F[i].F) {
      const a = F[i - 1], b = F[i]; return b.F === a.F ? b.x : a.x + (b.x - a.x) * (y - a.F) / (b.F - a.F);
    }
    return F[F.length - 1].x;
  };
  const xs = TARGET.map(g), ys = TARGET.map(c => inv(1 - c));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const s = sxy / sxx; return { mu: my - s * mx, s };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage();
  let consts = JSON.parse(JSON.stringify(CUR));
  for (let round = 0; round < ROUNDS; round++) {
    const out = await measure(page, consts, PROBE, FIT_DRIFTS);
    const next = { mean: {}, sig: {} };
    for (const L of ['low', 'mid', 'high']) {
      const pts = out.filter(o => o.layer === L);
      const mu0 = consts.mean[L], s0 = S0 * consts.sig[L];
      const { mu, s } = fitLayer(pts, mu0, s0);
      next.mean[L] = +mu.toFixed(4); next.sig[L] = +(s / S0).toFixed(4);
      console.error(`[${round}] ${L}: 면적 ${TARGET.map(c => pts.find(p => p.cover === c).area016.toFixed(3)).join(' ')} → μ ${mu.toFixed(4)} · 폭비 ${(s / S0).toFixed(4)}`);
    }
    consts = next;
  }
  const fin = await measure(page, consts, TARGET, FIT_DRIFTS);
  for (const L of ['low', 'mid', 'high']) console.error(`최종(맞춘 흐름) ${L}: ${TARGET.map(c => fin.find(p => p.layer === L && p.cover === c).area016.toFixed(3)).join(' ')}`);
  console.log(JSON.stringify(consts));
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
