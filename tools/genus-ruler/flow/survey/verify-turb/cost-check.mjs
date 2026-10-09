import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('./cloudFlow.cjs');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const p = { ...F.FLOW_DEFAULTS, seed: 7 };
const core = F.newFlowCore(p.n); { const t0 = now(); const it = F.flowCoreSteps(p, 24, core); while (!it.next().done) {} console.log(`flow core 64^2: ${(now() - t0).toFixed(1)} ms`); }
const TS = 256, T = new Float32Array(TS * TS).map(() => Math.random()); F.normalizeTemplate(T);
const S = 512, f = new Float32Array(S * S);
const w = { wQ: 1, wZ: 0.4, wT: 0.4, lag: 0.4, wW: 0.3, waveK: [3, 0], wavePhase: 0.3 };
for (let r = 0; r < 3; r++) { const t0 = now(); const it = F.flowComposeSteps(core, T, TS, S, w, f); while (!it.next().done) {} console.log(`compose 512^2 (5 fetches + cos) run ${r}: ${(now() - t0).toFixed(1)} ms`); }
const A = new Float32Array(64 * 64).map(() => Math.random()), out = new Float32Array(S * S);
for (let r = 0; r < 3; r++) { const t0 = now(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) out[y * S + x] = F.bilinearPeriodic(A, 64, (x + 0.5) / S, (y + 0.5) / S); console.log(`+1 bilinear fetch 64^2 @512^2 run ${r}: ${(now() - t0).toFixed(1)} ms`); }
// inline 2-tap fbm-style periodic noise (cloudGenus periodicNoise ~ 4 taps + smoothstep) x2 octaves x2 taps per texel
const n0 = 64, g = new Float32Array(n0 * n0).map(() => Math.random());
const pn = (u, v, n) => { const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const at = (i, j) => g[(((j % n) + n) % n) * n0 + (((i % n) + n) % n)]; const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1); const ab = a + (b - a) * sx; return ab + (c + (d - c) * sx - ab) * sy; };
for (let r = 0; r < 2; r++) { const t0 = now(); let s = 0; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = (x + 0.5) / S, v = (y + 0.5) / S; s += pn(u, v, 32) + 0.5 * pn(u, v, 64) + pn(u * 1.3, v, 32) + 0.5 * pn(u * 1.3, v, 64); } console.log(`2 taps x 2 octaves live noise @512^2 run ${r}: ${(now() - t0).toFixed(1)} ms`); }
// 64^2 FFT timing and a 100-step Swift-Hohenberg-style loop estimate
{ const n = 64, re = new Float64Array(n * n).map(() => Math.random()), im = new Float64Array(n * n); const t0 = now(); for (let k = 0; k < 20; k++) { F.fft2(re, im, n, false); F.fft2(re, im, n, true); } console.log(`fft2 64^2 pair x20: ${(now() - t0).toFixed(1)} ms -> SH 100 steps ~ ${((now() - t0) * 5).toFixed(0)} ms + pointwise`); }
{ const n = 128, re = new Float64Array(n * n).map(() => Math.random()), im = new Float64Array(n * n); const t0 = now(); for (let k = 0; k < 20; k++) { F.fft2(re, im, n, false); F.fft2(re, im, n, true); } console.log(`fft2 128^2 pair x20: ${(now() - t0).toFixed(1)} ms -> SH 100 steps ~ ${((now() - t0) * 5).toFixed(0)} ms`); }
