#!/usr/bin/env node
/**
 * downscale-run.mjs — 위성 장면(fetch-sat.py)의 고리 90 값만 보고 src/utils/macroField.ts 로 256² 운량을 만듭니다(§156, GPU 없음).
 * 기준 C0(지금 앱: 관측점 값 + 능선 회귀 기울기 두 수, macroWeatherField.ts)도 같이 냅니다.
 *
 *   node tools/genus-ruler/macro/downscale-run.mjs <sceneDir> <outDir> [--variant fit|prior] [--seed 7] [--steps 0]
 *
 * 출력: outDir/<name>.syn.json { beta, betaFit, ms, syn: base64 u8 256², base: …, c0: …, ring: … }, outDir/run.json(요약).
 * --steps N 이면 AR(1) 15 분 걸음을 N 번 돌린 장도 syn15[] 로 냅니다(자 M8).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const [sceneDir, outDir, ...rest] = process.argv.slice(2);
if (!sceneDir || !outDir) { console.error('usage: downscale-run.mjs sceneDir outDir'); process.exit(2); }
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const variant = opt('--variant', 'fit'), seed = +opt('--seed', '7'), steps = +opt('--steps', '0');
fs.mkdirSync(outDir, { recursive: true });
const entry = path.join(outDir, 'entry.ts');
fs.writeFileSync(entry, `export * as M from '${path.join(ROOT, 'src/utils/macroField.ts')}';\nexport * as W from '${path.join(ROOT, 'src/utils/macroWeatherField.ts')}';\n`);
const BUNDLE = path.join(outDir, 'macro.cjs');
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=warning'], { cwd: ROOT, stdio: 'inherit' });
if (/from\s*["']three["']|require\(["']three["']\)/.test(fs.readFileSync(BUNDLE, 'utf8'))) throw new Error('bundle pulls in three.js');
const require = createRequire(import.meta.url);
const { M, W } = require(BUNDLE);

const u8 = f => Buffer.from(Uint8Array.from(f, v => Math.round(Math.min(1, Math.max(0, v)) * 255))).toString('base64');
const files = fs.readdirSync(sceneDir).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
const summary = [];
for (const f of files) {
  const sc = JSON.parse(fs.readFileSync(path.join(sceneDir, f), 'utf8'));
  const samples = M.samplesFromRing(sc.ring.map(r => ({ distance: r.dist, azimuthOffset: r.az, cover: r.cover * 100 })));
  const n = sc.grid, cellKm = sc.cellKm;
  const t0 = Date.now();
  const fld = M.buildMacroField(samples, { n, cellKm, seed, betaFromPriorOnly: variant === 'prior' });
  const ms = Date.now() - t0;
  // C0: 지금 앱 — 관측점 운량 + 기울기(100 km 당) 두 수, [0,1] 로 자름
  const pts = sc.ring.map(r => ({ distance: r.dist, azimuthOffset: r.az, low: r.cover * 100, mid: 0, high: 0 }));
  const mw = W.buildMacroWeatherField(pts, 180, 45);
  const obs = sc.ring[0].cover, gx = mw.low.gradXPer100Km, gy = mw.low.gradYPer100Km;
  const c0 = new Float32Array(n * n), half = (n * cellKm) / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = (x + 0.5) * cellKm - half, py = (y + 0.5) * cellKm - half;
    c0[y * n + x] = Math.min(1, Math.max(0, obs + (gx * px + gy * py) / 100));
  }
  const out = { name: sc.site + '_' + sc.date, n, cellKm, beta: fld.beta, betaFit: fld.betaFit, ms, msDetail: fld.ms,
    syn: u8(fld.cover), base: u8(fld.base), c0: u8(c0), lambdaRes: Array.from({ length: 8 }, (_, i) => fld.lambdaRes[(n / 2) * n + n / 2 + i * 16]) };
  if (steps > 0) {
    out.syn15 = [];
    for (let s = 0; s < steps; s++) {
      M.stepMacroState(fld.state, 15 * 60);
      const f2 = M.buildMacroField(samples, { n, cellKm, seed, betaFromPriorOnly: variant === 'prior' }, fld.state);
      out.syn15.push(u8(f2.cover));
    }
  }
  fs.writeFileSync(path.join(outDir, out.name + '.syn.json'), JSON.stringify(out));
  summary.push({ name: out.name, beta: out.beta, betaFit: out.betaFit, ms });
  console.log(out.name, 'beta', fld.beta.toFixed(2), 'fit', fld.betaFit == null ? 'null' : fld.betaFit.toFixed(2), 'ms', ms, JSON.stringify(fld.ms));
}
fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify({ variant, seed, steps, scenes: summary }, null, 1));
