/**
 * §166 고리 이음매 복사본(방위 180° → −180°) 판정 — esbuild 로 `macroField.ts` 만 묶음.
 *   node tools/shader-preview/verify-ring-seam.js
 *  [1] `fetchDayWeatherRing` 은 91점에 −180° 복사본 8개를 더해 99개를 돌려줍니다(WeatherFan 감김용). 같은 자리가 두 번 들어가면
 *      남쪽 표본이 두 배가 되고 `sampleSpacingKm` 의 방위 간격이 줄어 Barnes 커널이 좁아집니다 — 99 점 그대로는 91 점보다 좁다(음성 대조).
 *  [2] `dropSeamCopies` 는 같은 거리에서 180° 점이 있는 −180° 점만 빼서 91 점을 돌려주고, 간격이 91 점 자료와 소수점까지 같다.
 *  [3] 180° 점 없이 −180° 점만 있으면 그대로 둔다(복사본이 아니다). 입력 순서·나머지 점은 그대로.
 *  [4] 끝에서 끝: 99 점 고리로 `buildLiveScene` 을 부르면 거시 격자 입력(저·중·상)이 91 점이다(복사본이 렌더러까지 가지 않는다).
 *  [5] 남쪽이 흐린 고리에서 99 점과 91 점 입력의 층 계획(거시 기울기·빔 투과)이 같다 — 두 번째 자리(`buildMacroWeatherField`)도 걸러짐.
 *      음성 대조: 걸러내지 않은 99 점을 `buildMacroWeatherField` 에 바로 넣으면 기울기가 달라진다.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-'));
  const out = path.join(outDir, 'macro.mjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/utils/macroField.ts'), '--bundle', '--format=esm', '--platform=node', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
  const M = await import('file://' + out);
  // 앱의 고리(weather.ts RING): 관측점 + 5 km 6방위 + 10~380 km 12방위. 방위는 −180~180 로 표기.
  const wrap = a => (a > 180 ? a - 360 : a);   // 0·30·…·150·180·−150·…·−30 (weather.ts RING_AZIMUTHS 와 같은 표기: 180 은 그대로)
  const ring91 = [{ distance: 0, azimuthOffset: 0, cover: 0.5 }];
  for (const a of [0, 60, 120, 180, -120, -60]) ring91.push({ distance: 5, azimuthOffset: a, cover: 0.5 });
  for (const d of [10, 30, 70, 130, 200, 280, 380]) for (let a = 0; a < 360; a += 30) ring91.push({ distance: d, azimuthOffset: wrap(a), cover: 0.5 });
  const copies = ring91.filter(p => p.azimuthOffset === 180).map(p => ({ ...p, azimuthOffset: -180 }));
  const ring99 = [...ring91, ...copies];
  const spacing = pts => M.sampleSpacingKm(M.samplesFromRing(pts.map(p => ({ ...p, cover: p.cover * 100 }))));
  const byDist = (pts, sp) => { const o = {}; pts.forEach((p, i) => { o[p.distance] = sp[i]; }); return o; };
  console.log('[1] 복사본이 있으면 간격이 좁아진다');
  ok(ring91.length === 91 && ring99.length === 99 && copies.length === 8, `고리 ${ring91.length}점 + 복사본 ${copies.length} = ${ring99.length}`);
  const s91 = byDist(ring91, spacing(ring91)), s99 = byDist(ring99, spacing(ring99));
  ok(s99[380] < s91[380] && s99[130] < s91[130] && s99[5] < s91[5], `99 점 간격이 더 좁다: 380 km ${s99[380].toFixed(1)} < ${s91[380].toFixed(1)}, 5 km ${s99[5].toFixed(2)} < ${s91[5].toFixed(2)}`);
  console.log('[2] dropSeamCopies');
  const fixed = M.dropSeamCopies(ring99);
  ok(fixed.length === 91 && fixed.every((p, i) => p === ring91[i]), '91점 · 같은 순서 · 같은 객체');
  const sFix = byDist(fixed, spacing(fixed));
  ok(Object.keys(s91).every(k => Math.abs(s91[k] - sFix[k]) < 1e-12), '간격이 91 점 자료와 같다');
  console.log('[3] 복사본이 아닌 −180° 점');
  const lone = [{ distance: 0, azimuthOffset: 0 }, { distance: 10, azimuthOffset: -180 }, { distance: 10, azimuthOffset: 0 }];
  ok(M.dropSeamCopies(lone).length === 3, '같은 거리에 180° 점이 없으면 −180° 점을 둔다');
  const mixed = [{ distance: 10, azimuthOffset: 180 }, { distance: 10, azimuthOffset: -180 }, { distance: 30, azimuthOffset: -180 }];
  const mx = M.dropSeamCopies(mixed);
  ok(mx.length === 2 && mx[0].azimuthOffset === 180 && mx[1].distance === 30, '거리마다 따로 판단한다(10 km 복사본만 뺌)');
  console.log('[4] buildLiveScene 끝에서 끝');
  const entry = path.join(outDir, 'entry.ts'), out2 = path.join(outDir, 'live.mjs');
  fs.writeFileSync(entry, `export { buildLiveScene } from '${ROOT}/src/components/VolumetricProbe/liveScene';\nexport { getInterpolatedWeather } from '${ROOT}/src/utils/weather';\nexport { buildMacroWeatherField } from '${ROOT}/src/utils/macroWeatherField';\n`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', '--define:__DEV__=false', '--outfile=' + out2], { cwd: ROOT, stdio: 'ignore' });
  const L = await import('file://' + out2);
  const t0 = Date.UTC(2026, 9, 25, 22, 0);   // 수원 07:00 KST 근처
  const hrs = Array.from({ length: 24 }, (_, i) => i);
  const timeMs = hrs.map(h => t0 + (h - 22) * 3600000), time = timeMs.map(ms => new Date(ms).toISOString().slice(0, 13) + ':00');
  const mk = (p, lowOf = () => 60) => ({ distance: p.distance, azimuthOffset: p.azimuthOffset, source: 'standard', origin: 'forecast',
    hourly: { time, timeMs, low: hrs.map(() => lowOf(p)), mid: hrs.map(() => 30), high: hrs.map(() => 10), total: hrs.map(() => 70), directNormalIrradiance: hrs.map(() => 200), visibility: hrs.map(() => 20000), humidity: hrs.map(() => 60), precipitation: hrs.map(() => 0) } });
  const date = new Date(t0 + 22 * 3600000 + 30 * 60000);
  const path99 = ring99.map(p => mk(p)), iw = L.getInterpolatedWeather(path99, date);
  const built = L.buildLiveScene({ lat: 37.4852, lon: 127.0367, heightM: 29, date, pathData: path99, interpolatedWeather: iw });
  const m = built.input.macro;
  ok(iw.length === 99, `보간 결과는 99 점(WeatherFan 용으로 그대로)`);
  ok(m && m.low.length === 91 && m.mid.length === 91 && m.high.length === 91, `거시 입력 저·중·상 = ${m && m.low.length}·${m && m.mid.length}·${m && m.high.length} 점(복사본 8 개 빠짐)`);
  ok(m && !m.low.some(q => q.azimuthOffset === -180), '거시 입력에 −180° 점이 없다');
  console.log('[5] 두 번째 자리(buildMacroWeatherField)까지 — 남쪽이 흐린 고리');
  const south = p => (p.distance > 0 && Math.abs(p.azimuthOffset) >= 120 ? 95 : 15);
  const p91 = ring91.map(p => mk(p, south)), p99 = ring99.map(p => mk(p, south));
  const iw91 = L.getInterpolatedWeather(p91, date), iw99 = L.getInterpolatedWeather(p99, date);
  const b91 = L.buildLiveScene({ lat: 37.4852, lon: 127.0367, heightM: 29, date, pathData: p91, interpolatedWeather: iw91 });
  const b99 = L.buildLiveScene({ lat: 37.4852, lon: 127.0367, heightM: 29, date, pathData: p99, interpolatedWeather: iw99 });
  const sunAz = 120, sunAlt = 10;
  const raw91 = L.buildMacroWeatherField(iw91, sunAz, sunAlt), raw99 = L.buildMacroWeatherField(iw99, sunAz, sunAlt);
  ok(Math.abs(raw91.low.gradYPer100Km - raw99.low.gradYPer100Km) > 1e-4, `음성 대조: 걸러내지 않으면 남북 기울기가 다르다 (${raw91.low.gradYPer100Km.toFixed(4)} vs ${raw99.low.gradYPer100Km.toFixed(4)})`);
  ok(JSON.stringify(b91.input.layers) === JSON.stringify(b99.input.layers) && b91.summary === b99.summary, '앱 경로(buildLiveScene)의 층 계획·요약은 91 점과 99 점이 같다');
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
