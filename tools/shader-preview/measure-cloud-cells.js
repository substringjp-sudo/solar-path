/**
 * measure-cloud-cells.js — **지금 날씨 텍스처의 구름 조각 크기 · 스펙트럼 · 빈칸을 잰다**(계획 문서 §24, 1단계 측정). 판정이 아니라 자(ruler)입니다.
 *
 * 앱과 같은 길로 텍스처를 만듭니다: `mergeFlowOpts` → `planFlowScene`(앱 기본값 n 64 · steps 20 · hours 0.5 · vrms 2 · qMode 0 · s90 0)
 * → `makeGenusWeather(layers, 256, 24 km)`. 층 하나(채널 R)만 넣고 운량을 바꿔 가며 잽니다.
 *
 * 재는 값(층 채널 값 v > 0 을 구름으로):
 *  - cover: 구름 칸 비율(입력 운량과 비교), holes: 운량이 높을 때 빈 칸 비율
 *  - 조각(4-이웃, 주기 경계): 개수, 등가 지름 중앙값(km), 면적 가중 평균 지름(km), 가장 큰 조각의 몫
 *  - 크기 분포 기울기: 면적 ≥ 4칸 조각의 N(>A) ∝ A^−β 의 β (자연 구름은 대략 0.6~1.0)
 *  - 무리 짓기: Clark–Evans R = 실제 최근접 거리 평균 / 무작위 기대값(0.5/√밀도). < 1 무리, ≈ 1 무작위, > 1 고른 배치
 *  - 스펙트럼: 구름 마스크(0/1)의 방사 평균 파워. 봉우리 파장(km, 2 칸 주기 이상) · 파장 < 2 km 파워 몫
 *  - 덩이 두께: 조각마다 최대 v/255 의 중앙값
 *
 * 실행: node tools/shader-preview/measure-cloud-cells.js [out.json]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const S = 256, TILE_KM = 24, PX_KM = TILE_KM / S;

function buildModule() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-cells-'));
  const entry = path.join(work, 'runner.ts');
  const stub = path.join(work, 'rn-stub.js');
  const bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(stub, 'module.exports = { Platform: { OS: "web" }, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };');
  fs.writeFileSync(entry, `
    import { makeGenusWeather, mergeFlowOpts, planFlowScene } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'))};
    (globalThis as any).__CC = { makeGenusWeather, mergeFlowOpts, planFlowScene };
  `);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false',
    '--loader:.png=empty', `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`, `--outfile=${bundle}`, '--log-level=error'],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });
  globalThis.expo = { NativeModule: class {}, EventEmitter: class {}, SharedObject: class {} };
  require(bundle);
  return globalThis.__CC;
}

// ── 측정 ────────────────────────────────────────────────────────────────
function components(mask, n) {
  const lab = new Int32Array(n * n).fill(-1); const comps = []; const stack = new Int32Array(n * n);
  for (let s0 = 0; s0 < n * n; s0++) {
    if (!mask[s0] || lab[s0] >= 0) continue;
    const id = comps.length; let top = 0; stack[top++] = s0; lab[s0] = id;
    const px = [];
    while (top) {
      const p = stack[--top]; px.push(p); const x = p % n, y = (p / n) | 0;
      const nb = [((x + 1) % n) + y * n, ((x + n - 1) % n) + y * n, x + ((y + 1) % n) * n, x + ((y + n - 1) % n) * n];
      for (const q of nb) if (mask[q] && lab[q] < 0) { lab[q] = id; stack[top++] = q; }
    }
    comps.push(px);
  }
  return { lab, comps };
}
const circMean = (vals, n) => { let c = 0, s = 0; for (const v of vals) { c += Math.cos(2 * Math.PI * v / n); s += Math.sin(2 * Math.PI * v / n); } return ((Math.atan2(s, c) / (2 * Math.PI)) * n + n) % n; };

function fft1(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function radialSpectrum(field, n) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  let mean = 0; for (let i = 0; i < n * n; i++) mean += field[i]; mean /= n * n;
  for (let i = 0; i < n * n; i++) re[i] = field[i] - mean;
  const rr = new Float64Array(n), ri = new Float64Array(n);
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { rr[x] = re[y * n + x]; ri[x] = im[y * n + x]; } fft1(rr, ri, false); for (let x = 0; x < n; x++) { re[y * n + x] = rr[x]; im[y * n + x] = ri[x]; } }
  for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) { rr[y] = re[y * n + x]; ri[y] = im[y * n + x]; } fft1(rr, ri, false); for (let y = 0; y < n; y++) { re[y * n + x] = rr[y]; im[y * n + x] = ri[y]; } }
  const P = new Float64Array(n / 2), C = new Float64Array(n / 2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const kx = x <= n / 2 ? x : x - n, ky = y <= n / 2 ? y : y - n, k = Math.round(Math.hypot(kx, ky));
    if (k >= 1 && k < n / 2) { P[k] += re[y * n + x] ** 2 + im[y * n + x] ** 2; C[k]++; }
  }
  for (let k = 1; k < n / 2; k++) P[k] = C[k] ? P[k] / C[k] * (2 * Math.PI * k) : 0;   // 방사 합(둘레 가중) — 파장별 에너지
  return P;
}

function measure(data, ch = 0) {
  const n = S, v = new Float32Array(n * n), mask = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) { v[i] = data[i * 4 + ch] / 255; mask[i] = data[i * 4 + ch] > 0 ? 1 : 0; }
  let cov = 0; for (let i = 0; i < n * n; i++) cov += mask[i]; cov /= n * n;
  const { comps } = components(mask, n);
  const areasKm2 = comps.map(c => c.length * PX_KM * PX_KM);
  const diam = areasKm2.map(a => 2 * Math.sqrt(a / Math.PI)).sort((a, b) => a - b);
  const totalA = areasKm2.reduce((s, a) => s + a, 0) || 1;
  const big = comps.filter(c => c.length >= 4);
  // 크기 분포 기울기(로그 N(>A) 대 로그 A, 최소제곱)
  let beta = null;
  if (big.length >= 8) {
    const A = big.map(c => c.length).sort((a, b) => b - a); const xs = [], ys = [];
    A.forEach((a, i) => { xs.push(Math.log(a)); ys.push(Math.log(i + 1)); });
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let num = 0, den = 0; for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    beta = den > 0 ? -num / den : null;
  }
  // Clark–Evans (조각 ≥ 4칸 중심, 주기 경계)
  let R = null;
  if (big.length >= 5) {
    const cen = big.map(c => [circMean(c.map(p => p % n), n), circMean(c.map(p => (p / n) | 0), n)]);
    let sum = 0;
    for (let i = 0; i < cen.length; i++) { let best = Infinity; for (let j = 0; j < cen.length; j++) { if (i === j) continue; let dx = Math.abs(cen[i][0] - cen[j][0]), dy = Math.abs(cen[i][1] - cen[j][1]); dx = Math.min(dx, n - dx); dy = Math.min(dy, n - dy); best = Math.min(best, Math.hypot(dx, dy)); } sum += best; }
    R = (sum / cen.length) / (0.5 / Math.sqrt(cen.length / (n * n)));
  }
  const P = radialSpectrum(mask, n);
  let pk = 1; for (let k = 2; k < n / 2; k++) if (P[k] > P[pk]) pk = k;
  let tot = 0, fine = 0; for (let k = 1; k < n / 2; k++) { tot += P[k]; if (TILE_KM / k < 2) fine += P[k]; }
  const thick = big.map(c => c.reduce((m, p) => Math.max(m, v[p]), 0)).sort((a, b) => a - b);
  return {
    cover: +cov.toFixed(4), holes: +(1 - cov).toFixed(4), n: comps.length, nBig: big.length,
    dMedKm: diam.length ? +diam[diam.length >> 1].toFixed(3) : null,
    dAreaWKm: +(areasKm2.reduce((s, a) => s + a * 2 * Math.sqrt(a / Math.PI), 0) / totalA).toFixed(2),
    largestFrac: +(Math.max(0, ...areasKm2) / totalA).toFixed(3),
    beta: beta == null ? null : +beta.toFixed(2), clarkEvans: R == null ? null : +R.toFixed(2),
    peakKm: +(TILE_KM / pk).toFixed(2), fineFrac: +(fine / (tot || 1)).toFixed(3),
    blobMaxMed: thick.length ? +thick[thick.length >> 1].toFixed(2) : null,
  };
}

// ── 장면 ────────────────────────────────────────────────────────────────
const APP_FLOW = { n: 64, steps: 20, hours: 0.5, vrms: 2, psiEvery: 2, qMode: 0, qN: 128, qH: 0.5, s90: 0 };
const WIND = { windU: 30, windV: 10, shearU: 25, shearV: 8 };   // km/h — 사진 날과 비슷한 서풍 계열(대략값)
const SEEDS = [7, 11, 23];

if (require.main === module) {
  const M = buildModule();
  const rows = [];
  const run = (genus, cover, extra = {}) => {
    const per = SEEDS.map(seed => {
      const L = M.mergeFlowOpts({ genus, cover, opts: { ...WIND, flowSeed: seed, ...extra } });
      const flow = M.planFlowScene([L], APP_FLOW);
      const t0 = Date.now();
      const tex = M.makeGenusWeather([L], S, TILE_KM, seed, [], flow);
      const ms = Date.now() - t0;
      return { ...measure(tex.image.data, 0), ms };
    });
    const avg = (k) => { const xs = per.map(p => p[k]).filter(x => x != null); return xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3) : null; };
    const r = { genus, coverIn: cover, ...Object.fromEntries(Object.keys(per[0]).map(k => [k, avg(k)])), holesMax: Math.max(...per.map(p => p.holes)) };
    rows.push(r);
  };
  for (const g of ['ac', 'sc']) for (const c of [0, 0.1, 0.3, 0.5, 0.7, 0.95, 1]) run(g, c);
  for (const g of ['ns', 'st', 'as']) run(g, 1);
  const cols = ['genus', 'coverIn', 'cover', 'holesMax', 'n', 'nBig', 'dMedKm', 'dAreaWKm', 'largestFrac', 'beta', 'clarkEvans', 'peakKm', 'fineFrac', 'blobMaxMed', 'ms'];
  console.log(cols.join('\t'));
  for (const r of rows) console.log([r.genus, r.coverIn, r.cover, r.holesMax, r.n, r.nBig, r.dMedKm, r.dAreaWKm, r.largestFrac, r.beta, r.clarkEvans, r.peakKm, r.fineFrac, r.blobMaxMed, r.ms].join('\t'));
  const out = process.argv[2];
  if (out) fs.writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), tileKm: TILE_KM, S, flow: APP_FLOW, wind: WIND, seeds: SEEDS, rows }, null, 1));
}

module.exports = { measure, radialSpectrum, components };
