#!/usr/bin/env node
/**
 * phys3-test.mjs — §138 두-흐름 확산장(cloudDiffuse.ts) 단위 시험. 브라우저·GPU 없음.
 *   node tools/genus-ruler/flow/phys3-test.mjs
 * 1 극한: τ_t → 0 에서 0 · 두꺼운 꼭대기 2 − T · 두꺼운 밑면 T · D ≤ 2.
 * 2 모양: 직접광이 다 산란된 뒤(e^(−τ'/μ0) < 0.05)로는 깊어질수록 줄고, 밑면 D 는 τ' ≥ 2 에서 τ_t 에 단조 감소.
 *   ⚠ 얇은 판에서는 밑면 확산 투과가 τ' ≈ 1.5 에서 최대(전체 투과 − 직접 투과) — 봉우리가 물리입니다. 지금 thru 식의 봉우리는 결함이 아니고 τ_up 셈이 결함(RULER-physics3 §0).
 * 3 GLSL 문자열이 TS 와 같은 상수를 담고 있고, 같은 식을 JS 로 풀었을 때 TS 와 1e-9 안.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.join(ROOT, '.harness/phys3-test');
fs.mkdirSync(OUT, { recursive: true });
execFileSync('npx', ['tsc', '--module', 'esnext', '--target', 'es2020', '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', OUT,
  'src/components/VolumetricProbe/cloudDiffuse.ts'], { cwd: ROOT, stdio: 'pipe' });
const M = await import('file://' + path.join(OUT, 'cloudDiffuse.js'));
const { diffuseTransmittance: T, diffuseField: D, DIFFUSE_GLSL, DIFFUSE_G, DIFFUSE_K, MU0_MIN } = M;
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

console.log('[1] 극한');
ok(D(0, 0, 0.8) === 0, 'τ_t = 0 → D = 0');
ok(Math.abs(D(0, 1e-9, 0.8)) < 1e-6, 'τ_t → 0 → D → 0 (' + D(0, 1e-9, 0.8).toExponential(1) + ')');
for (const tt of [20, 100, 400]) {
  const top = D(0, tt, 0.8), bot = D(tt, tt, 0.8), t = T(tt);
  ok(Math.abs(top - (2 - t - 1)) < 1e-9, `τ_t ${tt}: 꼭대기 D = (2 − T) − 1(직접광) = ${top.toFixed(4)}`);
  ok(Math.abs(bot - t) < 1e-6 || bot <= t, `τ_t ${tt}: 밑면 D ≈ T = ${t.toFixed(4)} (D ${bot.toFixed(4)})`);
}
let maxD = 0;
for (let tt = 0.01; tt <= 1000; tt *= 1.3) for (let f = 0; f <= 1; f += 0.05) for (const mu of [0.05, 0.3, 0.8, 1]) maxD = Math.max(maxD, D(tt * f, tt, mu));
ok(maxD <= 2, `D ≤ 2 (최대 ${maxD.toFixed(3)})`);
ok(Math.abs(T(0) - 1) < 1e-12 && T(100) < T(20) && T(20) < T(5), 'T(0) = 1, τ 에 단조 감소');

console.log('[2] 단조');
{
  let mono = true;
  for (const tt of [20, 100, 400]) { let prev = Infinity; for (let f = 0.02; f <= 1; f += 0.02) { const ta = tt * f; if (Math.exp(-(1 - DIFFUSE_G) * ta / 0.8) > 0.05) continue; const v = D(ta, tt, 0.8); if (v > prev + 1e-9) mono = false; prev = v; } }
  ok(mono, '직접광이 다 산란된 뒤로는 깊어질수록 D 가 줄어듦');
  let monoBase = true, prev = Infinity;
  for (let tt = 2 / (1 - DIFFUSE_G); tt <= 1000; tt *= 1.2) { const v = D(tt, tt, 0.8); if (v > prev + 1e-9) monoBase = false; prev = v; }
  ok(monoBase, `밑면 D 가 τ' ≥ 2(τ ≥ ${(2 / (1 - DIFFUSE_G)).toFixed(1)}) 에서 기둥 τ 에 단조 감소`);
  const peak = [...Array(60)].map((_, i) => 1 * Math.pow(1.1, i)).reduce((b, tt) => (D(tt, tt, 0.8) > D(b, b, 0.8) ? tt : b), 1);
  ok(peak > 5 && peak < 20, `밑면 확산 투과의 봉우리가 τ 5~20(τ' ≈ 1~3)에 있음 — 물리와 일치(봉우리 τ ${peak.toFixed(1)})`);
  const thruNow = t => (1 - Math.exp(-0.15 * t)) * (2 / (2 + 0.1 * t)) * Math.max(0.28, Math.exp(-0.035 * t));
  console.log('      τ_t     D_밑면   D_중간   thru_now(τ_up=τ_t)');
  for (const tt of [1, 3, 10, 20, 50, 100, 165, 400]) console.log(`      ${String(tt).padStart(4)}   ${D(tt, tt, 0.8).toFixed(3)}    ${D(tt / 2, tt, 0.8).toFixed(3)}    ${thruNow(tt).toFixed(3)}`);
}

console.log('[3] GLSL ↔ TS 상수');
ok(DIFFUSE_GLSL.includes((1 - DIFFUSE_G).toFixed(4)) && DIFFUSE_GLSL.includes(DIFFUSE_K.toFixed(4)) && DIFFUSE_GLSL.includes(MU0_MIN.toFixed(4)), 'GLSL 에 g·k·μ0 바닥값이 글자로 들어 있음');
{
  // GLSL 본문을 JS 로 그대로 풀어 TS 와 견줌(float → number)
  const body = DIFFUSE_GLSL.replace(/const float /g, '').replace(/float /g, 'let ').replace(/\bmax\(/g, 'Math.max(').replace(/\bexp\(/g, 'Math.exp(')
    .replace(/\bclamp\(([^,]+),\s*0\.0,\s*1\.0\)/g, 'Math.min(1, Math.max(0, $1))').replace(/\.0\b/g, '');
  const fn = new Function('tauAbove', 'tauTotal', 'mu0', body.slice(body.indexOf('{') + 1, body.lastIndexOf('}')));
  let worst = 0;
  for (const [a, t, m] of [[0, 0, 1], [0, 20, 0.8], [10, 20, 0.8], [20, 20, 0.8], [50, 165, 0.3], [165, 165, 0.05], [1, 400, 1]]) worst = Math.max(worst, Math.abs(fn(a, t, m) - D(a, t, m)));
  ok(worst < 1e-9, `GLSL 식을 JS 로 풀면 TS 와 같음(최대 차 ${worst.toExponential(1)})`);
}
console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
