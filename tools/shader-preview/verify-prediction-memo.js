/**
 * 노을 예측 메모(위키 optimization-review D2, 2026-11-26) 판정 — 값이 예전과 똑같은가.
 *  1. 메모가 돌려준 점수 · 품질 · 요인 = 메모 없이 새로 센 값(predictSunset 직접), 9 시간 창 10 분 · 3 분 간격 전부.
 *  2. 같은 입력이면 같은 객체(두 번째부터 계산 안 함), 입력 하나라도 다르면 다시 셈.
 *  3. 예보 배열이 바뀌면(새 객체) 메모를 쓰지 않음.
 *  4. 메모는 예보마다 512 개까지.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pred-v-'));
const entry = path.join(work, 'e.ts'), out = path.join(work, 'e.cjs');
const src = (f) => JSON.stringify(path.join(ROOT, 'src/utils', f));
fs.writeFileSync(entry, `import * as P from ${src('scenePrediction.ts')}; import * as S from ${src('sunsetPhysics.ts')}; import * as SP from ${src('solarPosition.ts')}; import * as W from ${src('weather.ts')}; import * as F from ${src('sunForecast.ts')};
(globalThis as any).__M = { P, S, SP, W, F };`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--define:__DEV__=false', `--outfile=${out}`, '--log-level=error',
  `--alias:@react-native-async-storage/async-storage=${path.join(ROOT, 'tools/genus-ruler/shape/async-storage-stub.js')}`], { cwd: ROOT, stdio: 'inherit' });
require(out);
const { P, S, SP, W, F } = globalThis.__M;

const TZ = 9, LAT = 37.28, LON = 126.57, ELEV = 120;
const now = new Date('2026-10-25T09:00:00+09:00');
const bearings = F.sideBearings(LAT, LON, F.localNoons(now, TZ, 16));
const pts = F.forecastPoints(LAT, LON, bearings);
const t0 = new Date('2026-10-25T00:00:00+09:00').getTime();
const pad = (n) => String(n).padStart(2, '0');
const ls = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; };
const times = Array.from({ length: 4 * 24 }, (_, h) => ls(t0 + h * 3600e3));
const mk = () => F.pathFromResponse(pts, pts.map((p, i) => ({ hourly: { time: times,
  cloud_cover_low: times.map((_, h) => Math.round(30 + 25 * Math.sin(h / 5 + i))), cloud_cover_mid: times.map((_, h) => Math.round(40 + 30 * Math.sin(h / 7 + i))),
  cloud_cover_high: times.map((_, h) => Math.round(50 + 35 * Math.sin(h / 3 + i))), relative_humidity_2m: times.map(() => 85) } })));
const fc = mk();
const DEG = 180 / Math.PI;
const args = (path, t) => { const sp = SP.sunPosition(t, LAT, LON); return { pathData: path, time: t, sunAltDeg: sp.altitude * DEG, sunAzDeg: sp.azimuth * DEG + 180, obs: W.getInterpolatedWeather(path, t)[0], latitude: LAT, observerElevM: ELEV }; };
const fresh = (a) => { const doy = Math.floor((a.time.getTime() - Date.UTC(a.time.getUTCFullYear(), 0, 0)) / 86400000); return S.predictSunset(a.pathData, a.time, a.sunAltDeg, a.obs?.visibility, a.obs?.humidity, a.latitude, a.observerElevM, doy, a.sunAzDeg); };
const ev = SP.sunTimes(new Date(t0 + 36 * 3600e3), LAT, LON).sunset.getTime();

console.log('\n[1] 메모 값 = 새로 센 값');
{
  let n = 0, bad = 0;
  for (const step of [10, 3]) for (let m = -270; m <= 270; m += step) {
    const a = args(fc, new Date(ev + m * 60e3));
    const got = P.scenePrediction(a), again = P.scenePrediction(a), want = fresh(a);
    n++;
    if (JSON.stringify(got) !== JSON.stringify(want) || JSON.stringify(again) !== JSON.stringify(want)) bad++;
  }
  ok(n > 200 && bad === 0, `${n} 시각 모두 같음(다름 ${bad})`);
}
console.log('\n[2] 같은 입력이면 같은 객체, 하나라도 다르면 다시 셈');
{
  const a = args(fc, new Date(ev + 7 * 60e3));
  const p1 = P.scenePrediction(a), p2 = P.scenePrediction({ ...a, time: new Date(a.time.getTime()) });
  ok(p1 === p2, '시각 객체가 달라도 같은 ms 면 같은 객체');
  const p3 = P.scenePrediction({ ...a, observerElevM: 1500 });
  ok(p3 !== p1 && JSON.stringify(p3) === JSON.stringify(fresh({ ...a, observerElevM: 1500 })), '관측 높이가 다르면 다시 셈(값 = 새로 센 값)');
  const p4 = P.scenePrediction({ ...a, obs: { ...a.obs, humidity: 40 } });
  ok(p4 !== p1 && JSON.stringify(p4) === JSON.stringify(fresh({ ...a, obs: { ...a.obs, humidity: 40 } })), '습도가 다르면 다시 셈');
}
console.log('\n[3] 예보 배열이 바뀌면 메모를 쓰지 않음');
{
  const fc2 = mk();
  const a1 = args(fc, new Date(ev)), a2 = args(fc2, new Date(ev));
  ok(P.scenePrediction(a1) !== P.scenePrediction(a2), '새 예보 객체 → 새로 셈');
}
console.log('\n[4] 메모 크기 512 까지 · 오래된 것부터 버림');
{
  const fc3 = mk();
  const first = args(fc3, new Date(ev - 600 * 60e3));
  const p0 = P.scenePrediction(first);
  for (let k = 1; k <= 512; k++) P.scenePrediction(args(fc3, new Date(ev - 600 * 60e3 + k * 60e3)));
  const p0b = P.scenePrediction(first);
  ok(p0b !== p0 && JSON.stringify(p0b) === JSON.stringify(p0), '513 번째가 들어오면 첫 것은 버려지고 다시 세도 값 같음');
}
console.log('\n[5] 시간(참고)');
{
  const fc4 = mk();
  const run = () => { const s = performance.now(); for (let m = -15; m <= 30; m += 3) P.scenePrediction(args(fc4, new Date(ev + m * 60e3))); return performance.now() - s; };
  const a = run(), b = run();
  console.log(`  판정 줄 16 시각: 처음 ${a.toFixed(2)} ms, 다시 ${b.toFixed(2)} ms`);
}
console.log(fail ? `\nFAILURES — pass ${pass} / fail ${fail}` : `\nALL PASS — ${pass}`);
process.exit(fail ? 1 : 0);
