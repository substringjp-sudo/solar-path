/**
 * 공항 여러 곳을 모아 낮은 · 중간 구름을 정함 — 2026-11-28.
 * 기기: 날이 맑은데 구름이 많이 그려지고 하늘이 어둡고 누렇게(채우기 판) 나옴. 가장 가까운 성남(RKSM)이 BKN060(75%)이고 김포 CAVOK · 인천 FEW · 오산 SCT · 평택 FEW 로 이웃은 맑음~산재였는데,
 * 가까운 한 곳만 보고 낮은 구름을 75% 로 덮어썼음.
 *  1. 이웃과 크게 다른 한 곳(BKN 75%)이 가까워도 모은 낮은 구름은 그 값보다 한참 낮음(오늘 재현 31%).
 *  2. 공항이 한 곳뿐이면 그 곳의 값 그대로(예전과 같음).
 *  3. 모두 같은 말을 하면 그 값.
 *  4. 중간 층도 같은 방식(없음 보고는 0 으로 섞임), 낮은 층 밑면은 구름이 있는 공항만의 평균.
 *  5. 강수는 가장 가까운 공항 것 — 평균하지 않음.
 *  6. 먼 공항(150 km 밖)뿐이면 null, 보고가 오래되면 null.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skyf-v-'));
const entry = path.join(work, 'e.ts'), out = path.join(work, 'e.cjs');
fs.writeFileSync(entry, `import * as A from ${JSON.stringify(path.join(ROOT, 'src/utils/metar.ts'))}; import * as B from ${JSON.stringify(path.join(ROOT, 'src/utils/metarRing.ts'))}; (globalThis as any).__T = { A, B };`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--define:__DEV__=false', `--outfile=${out}`, '--log-level=error',
  `--alias:@react-native-async-storage/async-storage=${path.join(ROOT, 'tools/genus-ruler/shape/async-storage-stub.js')}`], { cwd: ROOT, stdio: 'inherit' });
require(out);
const { A, B } = globalThis.__T;
const LAT = 37.4979, LON = 127.0276;   // 강남
const T = Date.UTC(2026, 10, 28, 3, 0);
const rep = (icao, lat, lon, clouds, extra = {}) => A.parseMetarItem({ icaoId: icao, lat, lon, obsTime: T / 1000, clouds, rawOb: '', wxString: extra.wx ?? null, visib: 6 }, LAT, LON);
const withClear = (icao, lat, lon) => A.parseMetarItem({ icaoId: icao, lat, lon, obsTime: T / 1000, clouds: [{ cover: 'CAVOK' }], rawOb: 'CAVOK', visib: 6 }, LAT, LON);
const RKSM = rep('RKSM', 37.445, 127.113, [{ cover: 'BKN', base: 6000 }, { cover: 'BKN', base: 25000 }]);
const RKSS = withClear('RKSS', 37.558, 126.791);
const RKSI = rep('RKSI', 37.469, 126.451, [{ cover: 'FEW', base: 3500 }, { cover: 'SCT', base: 7000 }]);
const RKSO = rep('RKSO', 37.090, 127.030, [{ cover: 'FEW', base: 4800 }, { cover: 'SCT', base: 7000 }]);
const RKSG = rep('RKSG', 36.96, 127.03, [{ cover: 'FEW', base: 6000 }, { cover: 'SCT', base: 7000 }]);
console.log('[1] 이웃과 다른 한 곳');
const f = B.fusedSkyFromReports([RKSM, RKSS, RKSI, RKSO, RKSG], T, LAT, LON);
ok(f && f.used === 5, '5 곳 모음');
ok(f && f.sky.lowCoverPct < 45 && f.sky.lowCoverPct > 10, '낮은 구름 ' + (f && f.sky.lowCoverPct.toFixed(0)) + '% — 성남 한 곳 75% 가 아님, 20~40% 대');
ok(A.metarSky(RKSM).lowCoverPct === 75, '(성남 한 곳은 75%)');
console.log('[2] 한 곳뿐');
const one = B.fusedSkyFromReports([RKSM], T, LAT, LON);
ok(one && one.sky.lowCoverPct === 75 && one.sky.midCoverPct === A.metarSky(RKSM).midCoverPct, '한 곳이면 그 곳 그대로');
console.log('[3] 모두 같은 말');
const same = B.fusedSkyFromReports([rep('A', 37.5, 127.0, [{ cover: 'BKN', base: 3000 }]), rep('B', 37.6, 127.1, [{ cover: 'BKN', base: 3000 }])], T, LAT, LON);
ok(same && Math.abs(same.sky.lowCoverPct - 75) < 1e-9, '모두 BKN 이면 75%');
console.log('[4] 중간 · 밑면');
ok(f && f.sky.midCoverPct != null, '중간 층도 모음(' + (f && f.sky.midCoverPct != null && f.sky.midCoverPct.toFixed(0)) + '%)');
ok(f && f.sky.lowBaseKmAgl != null && f.sky.lowBaseKmAgl > 1.0 && f.sky.lowBaseKmAgl < 1.9, '낮은 층 밑면 ' + (f && f.sky.lowBaseKmAgl && Math.round(f.sky.lowBaseKmAgl * 1000)) + ' m (구름 있는 공항 평균)');
console.log('[5] 강수');
const rainy = rep('RKSM', 37.445, 127.113, [{ cover: 'BKN', base: 3000 }], { wx: 'RA' });
const r5 = B.fusedSkyFromReports([rainy, RKSS, RKSI], T, LAT, LON);
ok(r5 && r5.sky.raining === true, '가장 가까운 공항의 비 보고를 따름');
const r5b = B.fusedSkyFromReports([RKSM, RKSS, RKSI], T, LAT, LON);
ok(r5b && r5b.sky.raining === false, '가장 가까운 공항에 비가 없으면 없음');
console.log('[6] 없음');
ok(B.fusedSkyFromReports([], T, LAT, LON) === null, '보고 없으면 null');
ok(B.fusedSkyFromReports([rep('FAR', 33.5, 126.5, [{ cover: 'BKN', base: 3000 }])], T, LAT, LON) === null, '먼 공항뿐이면 null');
ok(B.fusedSkyFromReports([RKSM, RKSS], T + 9 * 3600e3, LAT, LON) === null, '9 시간 지난 보고뿐이면 null');
console.log('[7] 연결');
const src = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/liveScene.ts'), 'utf8');
ok(/fusedSkyFromReports\(a\.metars/.test(src) && /applyMetarToObs\(obsRaw, a\.metar, a\.date\.getTime\(\), a\.heightM, skyFix \? \{ sky: skyFix\.sky \} : \{\}\)/.test(src), '장면이 모은 하늘을 덮어쓰기에 넘김');
console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
