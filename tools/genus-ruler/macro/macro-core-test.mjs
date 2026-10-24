#!/usr/bin/env node
/**
 * macro-core-test.mjs — src/utils/macroField.ts 단위 테스트(§156). esbuild 로 CJS 묶음(three 없음).
 *   node tools/genus-ruler/macro/macro-core-test.mjs
 * (1) 상수 표본 → Barnes 격자가 그 상수, 합성 운량도 그 상수(아나모포시스 기대값 보존) (2) 범위 0~1·NaN 없음 (3) 결정론
 * (4) 분해능 지도: 가운데 < 15 km, 350 km 밖 > 150 km (5) AR(1): 큰 파장은 거의 그대로, 작은 파장은 많이 바뀜; 분산 보존
 * (6) 상수 50 % 의 전체 분산이 잠재 분산 1 에 맞음 (7) 평균 보존: 임의 고리 값으로 만든 격자의 7 km 평균이 고리 값과 RMSE ≤ 0.06 (8) 시간
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-'));
const BUNDLE = path.join(OUT, 'macroField.cjs');
execFileSync('npx', ['esbuild', path.join(ROOT, 'src/utils/macroField.ts'), '--bundle', '--format=cjs', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=warning'], { cwd: ROOT, stdio: 'inherit' });
if (/from\s*["']three["']|require\(["']three["']\)/.test(fs.readFileSync(BUNDLE, 'utf8'))) throw new Error('bundle pulls in three.js');
const M = createRequire(import.meta.url)(BUNDLE);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const RING = [[5, [0, 60, 120, 180, -120, -60]], ...[10, 30, 70, 130, 200, 280, 380].map(d => [d, [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30]])];
const ringPts = fn => {
  const pts = [{ distance: 0, azimuthOffset: 0, cover: fn(0, 0) }];
  for (const [d, azs] of RING) for (const az of azs) pts.push({ distance: d, azimuthOffset: az, cover: fn(d * Math.sin(az * Math.PI / 180), d * Math.cos(az * Math.PI / 180)) });
  return pts;
};
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const n = 256, cellKm = 3;

console.log('[1] 상수 표본');
for (const c of [0, 30, 100]) {
  const f = M.buildMacroField(M.samplesFromRing(ringPts(() => c)), { n, cellKm });
  const b = mean(f.base), m = mean(f.cover);
  ok(Math.abs(b - c / 100) < 1e-6, `상수 ${c}%: Barnes 평균 ${b.toFixed(4)}`);
  ok(Math.abs(m - c / 100) < 0.01, `상수 ${c}%: 합성 평균 ${m.toFixed(4)} (기대값 보존)`);
  if (c === 0) ok(f.cover.every(v => v === 0), '0 % 는 모든 칸 0');
  if (c === 100) ok(f.cover.every(v => v === 1), '100 % 는 모든 칸 1');
}

console.log('[2] 범위·NaN · [3] 결정론 · [4] 분해능');
const grad = (x, y) => Math.min(100, Math.max(0, 50 + x * 0.15 + 20 * Math.sin(y / 60)));
const f1 = M.buildMacroField(M.samplesFromRing(ringPts(grad)), { n, cellKm });
const f2 = M.buildMacroField(M.samplesFromRing(ringPts(grad)), { n, cellKm });
ok(f1.cover.every(v => v >= 0 && v <= 1), '0~1 안');
ok(f1.cover.every((v, i) => v === f2.cover[i]), '같은 입력 → 같은 바이트');
const at = (x, y) => f1.lambdaRes[(Math.round(n / 2 + y / cellKm)) * n + Math.round(n / 2 + x / cellKm)];
ok(at(0, 0) < 15, `가운데 λ_res ${at(0, 0).toFixed(1)} km < 15`);
ok(at(370, 0) > 150, `370 km 밖 λ_res ${at(370, 0).toFixed(1)} km > 150`);

console.log('[5] AR(1)');
{
  const st = f1.state;
  const re0 = Float64Array.from(st.re), im0 = Float64Array.from(st.im);
  M.stepMacroState(st, 15 * 60);
  const L = n * cellKm;
  const corrAt = lamLo => {
    let sxy = 0, sxx = 0, syy = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const kx = x < n / 2 ? x : x - n, ky = y < n / 2 ? y : y - n, kr = Math.hypot(kx, ky); if (kr < 0.5) continue;
      const lam = L / kr; if (lam < lamLo || lam >= lamLo * 2) continue;
      const i = y * n + x;
      sxy += re0[i] * st.re[i] + im0[i] * st.im[i]; sxx += re0[i] ** 2 + im0[i] ** 2; syy += st.re[i] ** 2 + st.im[i] ** 2;
    }
    return { corr: sxy / Math.sqrt(sxx * syy), varRatio: syy / sxx };
  };
  const small = corrAt(6), large = corrAt(96);
  ok(small.corr < 0.7 && large.corr > 0.85, `15 분: 6–12 km 상관 ${small.corr.toFixed(2)} < 0.7, 96–192 km 상관 ${large.corr.toFixed(2)} > 0.85`);
  ok(Math.abs(small.varRatio - 1) < 0.1 && Math.abs(large.varRatio - 1) < 0.1, `분산 보존 ${small.varRatio.toFixed(3)} / ${large.varRatio.toFixed(3)}`);
  const f3 = M.buildMacroField(M.samplesFromRing(ringPts(grad)), { n, cellKm }, st);
  ok(Math.abs(mean(f3.cover) - mean(f1.cover)) < 0.03, `걸음 뒤 평균 차 ${(mean(f3.cover) - mean(f1.cover)).toFixed(4)}`);
}

console.log('[6] 잠재 잡음 분산 · [7] 평균 보존');
{
  // 상수 50 % 에서 μ = g⁻¹(0.5) = 0 → cover = clamp(½ + Z/w) 의 분산은 Z 분산 1 일 때 정해짐. 가운데/바깥 분산이 비슷한가.
  const f = M.buildMacroField(M.samplesFromRing(ringPts(() => 50)), { n, cellKm });
  const m = mean(f.cover); let v = 0; for (const c of f.cover) v += (c - m) ** 2; v /= f.cover.length;
  ok(v > 0.08 && v < 0.3, `상수 50 % 의 전체 분산 ${v.toFixed(4)} (잠재 분산 1 → clamp(½+Z) 분산 ≈ 0.18)`);
  const rnd = (() => { let a = 12345; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  const pts = ringPts((x, y) => Math.min(100, Math.max(0, 50 + 40 * Math.sin(x / 90) * Math.cos(y / 70) + (rnd() - 0.5) * 30)));
  const g = M.buildMacroField(M.samplesFromRing(pts), { n, cellKm });
  // 표본이 대표하는 넓이(이웃 간격 ≈ λ_res/2, 최소 7 km) 로 평균한 값을 고리 자리에서
  const half = n * cellKm / 2;
  let se = 0;
  for (const p of pts) {
    const a = p.azimuthOffset * Math.PI / 180, px = p.distance * Math.sin(a), py = p.distance * Math.cos(a);
    const cx = Math.round((px + half) / cellKm - 0.5), cy = Math.round((py + half) / cellKm - 0.5);
    const lr = g.lambdaRes[Math.min(n - 1, Math.max(0, cy)) * n + Math.min(n - 1, Math.max(0, cx))];
    const r = Math.max(1, Math.round(Math.max(7, lr / 2) / cellKm / 2));
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= n || y >= n) continue; s += g.cover[y * n + x]; c++; }
    se += (s / c - p.cover / 100) ** 2;
  }
  const rmse = Math.sqrt(se / pts.length);
  // 잡음 없는 Barnes 만의 RMSE(표본에 ±15 % 흔들림을 넣어 Barnes 평활 자체가 얼마나 못 맞히는지)
  let seB = 0;
  for (const p of pts) {
    const a = p.azimuthOffset * Math.PI / 180, px = p.distance * Math.sin(a), py = p.distance * Math.cos(a);
    const cx = Math.round((px + half) / cellKm - 0.5), cy = Math.round((py + half) / cellKm - 0.5);
    const lr = g.lambdaRes[Math.min(n - 1, Math.max(0, cy)) * n + Math.min(n - 1, Math.max(0, cx))];
    const r = Math.max(1, Math.round(Math.max(7, lr / 2) / cellKm / 2));
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= n || y >= n) continue; s += g.base[y * n + x]; c++; }
    seB += (s / c - p.cover / 100) ** 2;
  }
  const rmseB = Math.sqrt(seB / pts.length);
  ok(rmseB <= 0.08, `Barnes 만: 고리 자리 λ_res/2 창 평균 RMSE ${rmseB.toFixed(3)} ≤ 0.08`);
  ok(rmse <= rmseB + 0.06, `잡음 더한 뒤: RMSE ${rmse.toFixed(3)} ≤ Barnes + 0.06 (잡음은 창 안에서 다 평균되지 않음)`);
  ok(g.ms.total < 400, `시간 ${g.ms.total} ms (barnes ${g.ms.barnes}, synth ${g.ms.synth})`);
}
console.log('[8] 문턱 표(macroShader.macroThresholdTable): 목표 운량마다 d > s 면적 = 목표');
{
  const B2 = path.join(OUT, 'macroShader.cjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/macroShader.ts'), '--bundle', '--format=cjs', '--platform=node', '--external:three', `--outfile=${B2}`, '--log-level=warning'], { cwd: ROOT, stdio: 'inherit' });
  const Module = createRequire(import.meta.url)('node:module');
  const origLoad = Module._load;
  Module._load = function (req, ...a) { if (req === 'three') return { DataTexture: class {}, LinearFilter: 0, NoColorSpace: '', ClampToEdgeWrapping: 0, RGBAFormat: 0, UnsignedByteType: 0, Matrix4: class { constructor() { this.elements = new Array(16).fill(0); } }, Vector4: class { set() { return this; } } }; return origLoad.call(this, req, ...a); };
  const MS = createRequire(import.meta.url)(B2);
  const S = 64, tile = new Uint8Array(S * S * 4);
  // 채널 0: 운량 0.6 의 타일(값 1..255 고르게), 채널 1: 운량 0.2
  const r = (() => { let a = 99; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  for (let i = 0; i < S * S; i++) { tile[i * 4] = r() < 0.6 ? 1 + Math.floor(r() * 255) : 0; tile[i * 4 + 1] = r() < 0.2 ? 1 + Math.floor(r() * 255) : 0; }
  const area = (ch, sByte) => { let c = 0; for (let i = 0; i < S * S; i++) if (tile[i * 4 + ch] > sByte) c++; return c / (S * S); };
  let worst = 0;
  for (const ch of [0, 1]) {
    const T = MS.macroThresholdTable(tile, S, ch);
    const cover = area(ch, 0);
    for (let c = 0; c < MS.MACRO_LUT_N; c++) {
      const target = c / (MS.MACRO_LUT_N - 1);
      const got = area(ch, Math.round(T[c] * 255));
      const want = target >= cover ? cover : target;
      worst = Math.max(worst, Math.abs(got - want));
    }
    ok(T[MS.MACRO_LUT_N - 1] === 0 && T[0] === 1, `채널 ${ch}(운량 ${cover.toFixed(2)}): 표 끝 s(1)=0, s(0)=1`);
  }
  ok(worst <= 1 / 255 + 1 / (S * S) * 20, `면적 오차 최대 ${worst.toFixed(4)} (바이트 한 칸 안)`);
}
console.log(`\n${pass}/${pass + fail} 통과`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
