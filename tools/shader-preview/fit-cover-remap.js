/**
 * CloudSlab `COVER_REMAP`(예보 운량 → 문턱에 넣는 운량 역표)을 **하늘 평균 면적**에 맞춥니다 (2026-10-02).
 * `build-cover-area-avg.js` 를 씁니다(하늘 화소만 셈 — 지평선 밑 화소는 분모에서 뺍니다).
 *
 * 1) 항등 표(remap=identity)로 촘촘한 운량에서 면적 곡선 A(c) 를 잽니다.
 * 2) 마디 T(COVER_KNOTS)마다 R(T) = A⁻¹(T) — 곡선을 단조로 펴고 선형 보간.
 * 3) R 을 넣고 마디에서 다시 재어, 어긋남 e = A_R(T) − T 를 A 의 기울기로 나눠 한 번 고칩니다
 *    (넣는 값이 cvSlow·군집·세로 단계와 곱해지므로 한 번에 정확히 뒤집히지 않습니다).
 *
 * **맞추기는 짝수 자리로만**(아래 POS, 방위 4 · 고도 3). 확인은 `verify-cover-area-avg.js` 가 홀수 자리로 합니다.
 * 먼저 정한 것: 확인 문턱 ±0.06 은 그대로, 맞춘 자료로 채점하지 않습니다.
 *
 * 사용: node tools/shader-preview/fit-cover-remap.js > remap.json   (미리보기 서버 8123, stage-esm·build 먼저)
 *   CURVE=파일.json  — 1) 의 결과(같은 짝수 자리·항등 표로 잰 [{layer,cover,area016}])가 이미 있으면 건너뜁니다.
 *   ROUNDS=n        — 3) 을 몇 번 할지(기본 1).
 */
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

const KNOTS = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];   // CloudSlab COVER_KNOTS 와 같아야 합니다
const DENSE = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.905, 0.91, 0.92, 0.93, 0.94, 0.95];
// 표본: 자리 96 개 중 짝수 48(자리마다 흐름 k 시간 · 바람 방위 250°+k·137.5° — build-cover-area-avg 의 pos).
// ⚠ 처음에는 흐름 시각(짝수 12)만 바꿨습니다. 맞춘 시각에서는 소수 셋째 자리까지 맞았지만 홀수 시각 확인에서
//   상층이 0.14 넘쳤습니다 — 천정 쪽 시야는 구름 칸 몇 개만 보여 시각마다 0.06~0.95 로 흔들리고, 바람 한 줄
//   위의 자리라 잡음 격자 주기와 겹쳐 서로 독립도 아니었습니다. 자리를 넓혀 평균을 잡습니다.
const POS = 'pos=96&set=even';
const AZS = [0, 90, 180, 270];
const LAYERS = ['low', 'mid', 'high'];
const ROUNDS = +(process.env.ROUNDS || 1);

async function measure(page, remap, covers) {
  const r = remap === 'identity' ? 'identity' : LAYERS.map(L => `${L}:${remap[L].map(v => v.toFixed(4)).join('|')}`).join(';');
  await page.goto(`${ORIGIN}/cover-area-avg.html?${POS}&azs=${AZS.join(',')}&covers=${covers.join(',')}&remap=${encodeURIComponent(r)}`, { waitUntil: 'commit', timeout: 600000 });
  await page.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 7200000, polling: 2000 });
  const errs = await page.evaluate(() => window.__errors);
  if (errs.length) throw new Error(errs[0]);
  return page.evaluate(() => window.__out);
}

// 단조로 편 곡선 [(c, A)] — (0,0)·(1,1) 포함
function curveOf(rows, L) {
  const pts = [{ c: 0, a: 0 }, ...rows.filter(o => o.layer === L).map(o => ({ c: o.cover, a: o.area016 })), { c: 1, a: 1 }]
    .sort((x, y) => x.c - y.c);
  for (let i = 1; i < pts.length; i++) pts[i].a = Math.max(pts[i].a, pts[i - 1].a);
  return pts;
}
const inv = (pts, a) => {
  for (let i = 1; i < pts.length; i++) if (a <= pts[i].a) {
    const p = pts[i - 1], q = pts[i];
    return q.a === p.a ? p.c : p.c + (q.c - p.c) * (a - p.a) / (q.a - p.a);
  }
  return 1;
};
const slope = (pts, c) => {
  for (let i = 1; i < pts.length; i++) if (c <= pts[i].c) return Math.max(0.05, (pts[i].a - pts[i - 1].a) / (pts[i].c - pts[i - 1].c));
  return 1;
};
const monotone = (v) => { const o = v.slice(); o[0] = 0; o[o.length - 1] = 1; for (let i = 1; i < o.length; i++) o[i] = Math.min(1, Math.max(o[i], o[i - 1] + 1e-4)); o[o.length - 1] = 1; return o; };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage();
  const base = process.env.CURVE ? JSON.parse(fs.readFileSync(process.env.CURVE, 'utf8')) : await measure(page, 'identity', DENSE);
  const curves = Object.fromEntries(LAYERS.map(L => [L, curveOf(base, L)]));
  let remap = Object.fromEntries(LAYERS.map(L => [L, monotone(KNOTS.map(T => inv(curves[L], T)))]));
  for (const L of LAYERS) console.error(`1차 ${L}: ${remap[L].map(v => v.toFixed(3)).join(' ')}`);
  const inner = KNOTS.slice(1, -1);
  for (let round = 0; round < ROUNDS; round++) {
    const got = await measure(page, remap, inner);
    for (const L of LAYERS) {
      const next = remap[L].slice();
      inner.forEach((T, j) => {
        const a = got.find(o => o.layer === L && o.cover === T).area016;
        next[j + 1] = remap[L][j + 1] - (a - T) / slope(curves[L], remap[L][j + 1]);
      });
      console.error(`[${round}] ${L} 면적 ${inner.map(T => got.find(o => o.layer === L && o.cover === T).area016.toFixed(3)).join(' ')}`);
      remap[L] = monotone(next);
    }
  }
  const fin = await measure(page, remap, inner);
  for (const L of LAYERS) console.error(`최종(맞춘 시각) ${L}: ${inner.map(T => `${T}→${fin.find(o => o.layer === L && o.cover === T).area016.toFixed(3)}`).join(' ')}`);
  console.log(JSON.stringify(Object.fromEntries(LAYERS.map(L => [L, remap[L].map(v => +v.toFixed(4))]))));
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
