/**
 * 공항 시정(박무·안개)을 하늘 연무에 반영 — 2026-11-27.
 * 기기: 박무가 심하게 끼었는데(공항 시정 4~13 km, BR/HZ) 하늘이 맑게 그려짐. 원인: 연무가 예보 시정(그날 24 km)과 모형 AOD 로만 정해지고 METAR 시정은 안 읽었음.
 *  1. METAR JSON `visib`(법정 마일 숫자 · "6+" · 원문 "8SM" · 4 자리 미터 · CAVOK)를 미터로 읽고, "이상" 보고는 visCapped.
 *  2. 공항 여러 곳의 시정을 로그 영역 거리 · 시간 무게로 모음 — 더 탁한 가까운 공항이 이기고, 상한 보고는 무게 절반, 가까운 공항이 없으면 null.
 *  3. aerosolOpticsFromObs: 관측 시정이 모형 AOD 보다 탁하면 그쪽(Koschmieder ×1.5 km), 더 맑으면 모형 값 그대로(관측이 연무를 줄이지는 않음).
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-v-'));
const entry = path.join(work, 'e.ts'), out = path.join(work, 'e.cjs');
fs.writeFileSync(entry, `import * as A from ${JSON.stringify(path.join(ROOT, 'src/utils/metar.ts'))}; import * as B from ${JSON.stringify(path.join(ROOT, 'src/utils/metarRing.ts'))}; import * as C from ${JSON.stringify(path.join(ROOT, 'src/utils/sunVisibility.ts'))}; (globalThis as any).__T = { A, B, C };`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--define:__DEV__=false', `--outfile=${out}`, '--log-level=error',
  `--alias:@react-native-async-storage/async-storage=${path.join(ROOT, 'tools/genus-ruler/shape/async-storage-stub.js')}`], { cwd: ROOT, stdio: 'inherit' });
require(out);
const { A, B, C } = globalThis.__T;
const SM = 1609.344;
const item = (icao, lat, lon, visib, raw, t = Date.UTC(2026, 10, 27, 8, 0)) => ({ icaoId: icao, lat, lon, obsTime: t / 1000, visib, rawOb: raw, clouds: [{ cover: 'BKN', base: 2800 }] });
console.log('[1] 읽기');
const r1 = A.parseMetarItem(item('RKSS', 37.55, 126.79, 3.11, 'METAR RKSS 270800Z 5000 BR BKN030'), 37.26, 127.07);
ok(r1 && Math.abs(r1.visM - 3.11 * SM) < 1 && r1.visCapped === false, 'visib 숫자 3.11 SM → ' + Math.round(r1.visM) + ' m');
const r2 = A.parseMetarItem(item('RKSO', 37.09, 127.03, '6+', 'METAR RKSO 270755Z 9999 BKN028'), 37.26, 127.07);
ok(r2 && r2.visCapped === true && Math.abs(r2.visM - 6 * SM) < 1, '"6+" 는 상한 보고(visCapped)');
const r3 = A.parseMetarItem(item('RKSO', 37.09, 127.03, undefined, 'METAR RKSO 270755Z AUTO 8SM BKN028'), 37.26, 127.07);
ok(r3 && Math.abs(r3.visM - 8 * SM) < 1, '원문 8SM 에서 읽음');
const r4 = A.parseMetarItem(item('RKSM', 37.44, 127.11, undefined, 'METAR RKSM 270800Z 26008KT 6000 HZ SCT030'), 37.26, 127.07);
ok(r4 && r4.visM === 6000 && r4.visCapped === false, '원문 6000 m 에서 읽음');
console.log('[2] 모으기');
const T = Date.UTC(2026, 10, 27, 7, 55);
const rs = [
  A.parseMetarItem(item('RKSS', 37.55, 126.79, 3.11, 'x', T), 37.26, 127.07),
  A.parseMetarItem(item('RKSM', 37.44, 127.11, 3.73, 'x', T), 37.26, 127.07),
  A.parseMetarItem(item('RKSO', 37.09, 127.03, 8, 'x', T), 37.26, 127.07),
  A.parseMetarItem(item('RKSG', 36.96, 127.03, '6+', 'x', T), 37.26, 127.07),
];
const f = B.visibilityFromReports(rs, T, 37.26, 127.07);
ok(f && f.used === 4, '4 곳 모음');
ok(f && f.visM > 3.11 * SM && f.visM < 8 * SM, '결과(' + Math.round(f.visM) + ' m)는 가장 탁한 곳과 가장 맑은 곳 사이');
const far = B.visibilityFromReports([A.parseMetarItem(item('RKPC', 33.5, 126.5, 3, 'x', T), 37.26, 127.07)], T, 37.26, 127.07);
ok(far === null, '먼 공항뿐이면 null(예보 그대로)');
ok(B.visibilityFromReports([], T, 37.26, 127.07) === null, '보고 없으면 null');
const old = B.visibilityFromReports(rs, T + 9 * 3600e3, 37.26, 127.07);
ok(old === null, '9 시간 지난 보고뿐이면 null');
const onlyCap = B.visibilityFromReports([A.parseMetarItem(item('RKSO', 37.09, 127.03, '6+', 'x', T), 37.26, 127.07)], T, 37.26, 127.07);
ok(onlyCap && onlyCap.visM >= 6 * SM - 1, '상한 보고만 있으면 그 값 이상으로 둠');
console.log('[3] 연무');
const base = C.aerosolOpticsFromObs({ visibility: 24000 });
const obs = C.aerosolOpticsFromObs({ visibility: 24000, visibilityObs: 5000 });
ok(obs && base && obs.aod > base.aod * 2, '관측 시정 5 km 면 AOD 가 예보 시정 24 km 때의 2 배 넘게 (' + base.aod.toFixed(2) + ' → ' + obs.aod.toFixed(2) + ')');
ok(Math.abs(obs.aod - (3.912 / 5) * 1.5) < 1e-9, 'Koschmieder ×1.5 km 와 일치');
const clear = C.aerosolOpticsFromObs({ aod550: 0.5, visibilityObs: 40000 });
ok(clear && clear.aod === 0.5, '관측이 더 맑아도 모형 AOD 를 줄이지 않음');
const none = C.aerosolOpticsFromObs({ visibilityObs: 80000 });
ok(none === null, '60 km 넘는 시정은 쓰지 않음');
console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
