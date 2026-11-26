/**
 * 예보 보간 메모 · 이분 탐색(위키 optimization-review D1, 2026-11-26) 판정 — 값이 예전과 똑같은가.
 *  1. bracketIndex 가 예전 선형 탐색(while times[i+1] < t) 과 모든 경우에 같은 칸.
 *  2. 같은 예보 · 같은 시각이면 같은 배열(메모), 다른 예보 객체로 새로 세도 값이 같음.
 *  3. 메모는 예보마다 8 개까지.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'interp-v-'));
const entry = path.join(work, 'e.ts'), out = path.join(work, 'e.cjs');
fs.writeFileSync(entry, `import * as W from ${JSON.stringify(path.join(ROOT, 'src/utils/weather.ts'))}; (globalThis as any).__W = W;`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--define:__DEV__=false', `--outfile=${out}`, '--log-level=error',
  `--alias:@react-native-async-storage/async-storage=${path.join(ROOT, 'tools/genus-ruler/shape/async-storage-stub.js')}`], { cwd: ROOT, stdio: 'inherit' });
require(out);
const W = globalThis.__W;

console.log('\n[1] 이분 탐색 = 예전 선형 탐색');
{
  const lin = (times, t) => { let i = 0; while (i < times.length - 1 && times[i + 1] < t) i++; return i; };
  let bad = 0;
  for (let n = 1; n <= 50; n++) {
    const times = Array.from({ length: n }, (_, k) => 1000 + k * 3600);
    for (let t = 0; t < 1000 + n * 3600 + 5000; t += 397) if (W.bracketIndex(times, t) !== lin(times, t)) bad++;
    for (const t of times) { if (W.bracketIndex(times, t) !== lin(times, t)) bad++; if (W.bracketIndex(times, t + 1) !== lin(times, t + 1)) bad++; }
  }
  ok(bad === 0, `불일치 ${bad}`);
}

console.log('\n[2] 메모 · 값 동일');
{
  const H = 3600000, t0 = Date.UTC(2026, 10, 26, 0);
  const mk = () => Array.from({ length: 5 }, (_, k) => ({ distance: k * 10, azimuthOffset: k * 40, hourly: {
    time: Array.from({ length: 48 }, (_, h) => new Date(t0 + h * H).toISOString()), timeMs: Array.from({ length: 48 }, (_, h) => t0 + h * H),
    high: Array.from({ length: 48 }, (_, h) => (h * 7 + k) % 100), mid: Array.from({ length: 48 }, (_, h) => (h * 13 + k) % 100), low: Array.from({ length: 48 }, (_, h) => (h * 5 + k * 3) % 100) } }));
  const A = mk(), B = mk();
  const d = new Date(t0 + 13.4 * H);
  const a1 = W.getInterpolatedWeather(A, d), a2 = W.getInterpolatedWeather(A, new Date(d.getTime()));
  ok(a1 === a2, '같은 예보 · 같은 시각이면 같은 결과(다시 세지 않음)');
  ok(JSON.stringify(a1) === JSON.stringify(W.getInterpolatedWeather(B, d)), '다른 예보 객체(같은 값)로 새로 센 값과 같음');
  for (let m = 0; m < 20; m++) W.getInterpolatedWeather(A, new Date(t0 + m * 60000));
  ok(W.getInterpolatedWeather(A, d) !== a1 && JSON.stringify(W.getInterpolatedWeather(A, d)) === JSON.stringify(a1), '메모 8 개를 넘으면 오래된 것은 버리고 다시 세도 값 같음');
}
console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
process.exit(fail ? 1 : 0);
