/**
 * 흐린 날 채우기 덱 두께(`liveScene.deckTauFromGhi`) 판정 — 2026-11-27.
 * 기기: 미래 시각(내일)에 채우기 덱이 켜지면 위성 일사가 없어 기본 밀도(τ 58~64)로 떨어져, 예보 직달일사가 "해 맑음"(τ 0)인데도 하늘이 짙은 회색.
 * 고침: 위성 GHI 가 없으면 예보 GHI(`shortwaveRadiation`)로 같은 두-흐름 식을 씀.
 *  1. 위성 GHI 가 있으면 위성(source 'sat'), 둘 다 있어도 위성이 우선.
 *  2. 위성이 없고 예보 GHI 가 있으면 예보(source 'fc') — 같은 GHI 면 위성과 같은 τ · T.
 *  3. 예보 GHI 가 맑은 하늘에 가까우면 덱이 얇아짐(τ 하한 5), 어두우면 두꺼워짐(단조).
 *  4. 둘 다 없거나 해 10° 아래면 null(기본 밀도).
 *  5. 예보 요청에 shortwave_radiation 이 있고 관측점 hourly 와 보간 값에 실림.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-v-'));
const entry = path.join(work, 'e.ts'), out = path.join(work, 'e.cjs');
fs.writeFileSync(entry, `import * as L from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/liveScene.ts'))}; (globalThis as any).__L = L;`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--define:__DEV__=false', `--outfile=${out}`, '--log-level=error',
  `--alias:@react-native-async-storage/async-storage=${path.join(ROOT, 'tools/genus-ruler/shape/async-storage-stub.js')}`], { cwd: ROOT, stdio: 'inherit' });
require(out);
const L = globalThis.__L;
const date = new Date('2026-11-27T02:06:00Z');   // 서울 11:06, 해 ~29°
const LAT = 37.5, LON = 127.05;
const f = (o) => L.deckTauFromGhi(o, date, LAT, LON);

console.log('\n[1~2] 출처');
const a = f({ satShortwaveRadiation: 200, shortwaveRadiation: 450 });
const b = f({ shortwaveRadiation: 200 });
const c = f({ satShortwaveRadiation: 200 });
ok(a && a.source === 'sat' && Math.abs(a.tau - c.tau) < 1e-9, `위성 우선(τ ${a && a.tau})`);
ok(b && b.source === 'fc' && Math.abs(b.tau - c.tau) < 1e-9 && b.T === c.T, `예보 GHI 로 같은 식(τ ${b && b.tau}, T ${b && b.T})`);

console.log('\n[3] 단조 · 얇은 쪽');
const ghis = [80, 150, 250, 350, 450, 550];
const taus = ghis.map(g => f({ shortwaveRadiation: g }).tau);
ok(taus.every((t, i) => i === 0 || t <= taus[i - 1]), `GHI ↑ → τ ↓: ${ghis.map((g, i) => `${g}→${taus[i]}`).join(', ')}`);
ok(taus[taus.length - 1] <= 10, `맑은 하늘에 가까운 예보 일사면 얇은 덱(τ ${taus[taus.length - 1]}) — 전에는 기본 τ 58~64`);

console.log('\n[4] 없음');
ok(f({}) === null, '일사 없음 → null');
ok(L.deckTauFromGhi({ shortwaveRadiation: 200 }, new Date('2026-11-27T08:20:00Z'), LAT, LON) === null, '해 10° 아래 → null');

console.log('\n[5] 예보 요청 · 실어 나름');
const w = fs.readFileSync(path.join(ROOT, 'src/utils/weather.ts'), 'utf8');
ok((w.match(/direct_normal_irradiance,shortwave_radiation,/g) || []).length === 2, '고리 예보 두 요청(예보 · 보관)에 shortwave_radiation');
ok(/hourly\.shortwaveRadiation = rh\.shortwave_radiation/.test(w) && /shortwaveRadiation: interpolateOpt\(p\.hourly\.shortwaveRadiation\)/.test(w), '관측점 hourly 와 보간 값에 실림');
console.log(fail ? `\nFAILURES — pass ${pass} / fail ${fail}` : `\nALL PASS — ${pass}`);
process.exit(fail ? 1 : 0);
