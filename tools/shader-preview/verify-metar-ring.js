/**
 * 공항 여러 곳의 METAR 로 거시 운량 고리를 보정하는 식(`src/utils/metarRing.ts`) 판정 — 2026-11-27. 브라우저 · 네트워크 불필요.
 * 기기 07:13 서울: 성남 RKSM 관측 BKN030(저층 75 %) ↔ 예보 고리 저층 7 % → 화면에 구름이 1.2 % 만 남음(하네스). 고리를 관측으로 옮김.
 *  1. 관측 바로 위 고리 점은 관측 쪽으로 크게 이동(잔차의 W/(W+W0) = 91 %), 3L(150 km) 넘게 먼 점은 거의 그대로.
 *  2. 시간 무게: 보고 ±90 분은 1, 240 분에서 0, 사이 단조 감소(한 번에 끊기지 않음). 240 분 넘으면 보정 없음.
 *  3. 층: 저층만 말하는 관측(CLR)은 중층 고리를 바꾸지 않음. 중층 값이 있으면 중층도 옮김. 상층은 늘 그대로.
 *  4. 공항 여럿: 가까운 쪽이 더 끌어당김. 같은 공항의 여러 보고는 장면 시각에 가까운 하나만.
 *  5. 원본 고리는 바뀌지 않음(캐시 보호). 값은 0~1 로 잘림. 보고 없음 → 같은 객체.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'metarring-v-'));
const entry = path.join(work, 'e.ts'), out = path.join(work, 'e.cjs');
fs.writeFileSync(entry, `import * as R from ${JSON.stringify(path.join(ROOT, 'src/utils/metarRing.ts'))}; import * as M from ${JSON.stringify(path.join(ROOT, 'src/utils/metar.ts'))}; (globalThis as any).__R = { R, M };`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', '--define:__DEV__=false', `--outfile=${out}`, '--log-level=error',
  `--alias:@react-native-async-storage/async-storage=${path.join(ROOT, 'tools/genus-ruler/shape/async-storage-stub.js')}`], { cwd: ROOT, stdio: 'inherit' });
require(out);
const { R, M } = globalThis.__R;

const LAT = 37.5, LON = 127.05;
const T0 = Date.UTC(2026, 10, 26, 22, 0);
const mk = (icao, dLatKm, dLonKm, layers, o = {}) => ({ icao, lat: LAT + dLatKm / 110.57, lon: LON + dLonKm / (111.32 * Math.cos(LAT * Math.PI / 180)), distanceKm: Math.hypot(dLatKm, dLonKm), timeMs: T0, raw: '', layers, clearBelowM: null, wx: null, ...o });
const ringOf = (low, mid = 0.2, high = 0.7) => {
  const pts = [];
  for (const dist of [8, 28, 80, 180, 360]) for (let az = 0; az < 360; az += 45) pts.push({ distance: dist, azimuthOffset: az });
  return { low: pts.map(p => ({ ...p, cover: low })), mid: pts.map(p => ({ ...p, cover: mid })), high: pts.map(p => ({ ...p, cover: high })) };
};
const near = (a, b, e) => Math.abs(a - b) <= e;
const nearest = (ring, x, y) => ring.low.reduce((best, p) => { const a = p.azimuthOffset * Math.PI / 180, px = p.distance * Math.sin(a), py = p.distance * Math.cos(a); const d = Math.hypot(px - x, py - y); return d < best.d ? { d, c: p.cover } : best; }, { d: 1e9, c: 0 });

const bkn = mk('RKSM', -7, 6, [{ cover: 'BKN', baseFtAgl: 3000 }]);   // 성남: 저 75 %, 8 km
const sceneMs = T0 + 13 * 60_000;
const base = ringOf(0.07);
const fixed = R.correctMacroRing(base, [bkn], sceneMs, LAT, LON);

console.log('\n[1] 거리');
const at = nearest(fixed.ring, bkn.lon === 0 ? 0 : (bkn.lon - LON) * 111.32 * Math.cos(LAT * Math.PI / 180), (bkn.lat - LAT) * 110.57);
ok(fixed.used === 1 && at.c > 0.07 + 0.91 * (0.75 - 0.07) * 0.8, `관측 가까운 고리 점 ${base.low[0].cover.toFixed(2)} → ${at.c.toFixed(2)} (관측 0.75)`);
const far = fixed.ring.low.filter(p => p.distance >= 360);
ok(far.every(p => p.cover < 0.1), `360 km 점은 거의 그대로(최대 ${Math.max(...far.map(p => p.cover)).toFixed(3)})`);
const byD = [8, 28, 80, 180, 360].map(d => Math.max(...fixed.ring.low.filter(p => p.distance === d).map(p => p.cover)));
ok(byD.every((v, i) => i === 0 || v <= byD[i - 1] + 1e-9), `거리 ↑ → 보정 ↓: ${byD.map(v => v.toFixed(2)).join(' → ')}`);

console.log('\n[2] 시간');
const ws = [0, 30, 90, 120, 150, 200, 240, 300].map(m => R.metarTimeWeight(m));
ok(ws[0] === 1 && ws[2] === 1 && ws[6] === 0 && ws[7] === 0 && ws.every((w, i) => i === 0 || w <= ws[i - 1]), `무게 ${ws.map(w => w.toFixed(2)).join(', ')}`);
const lateOf = m => Math.max(...R.correctMacroRing(base, [bkn], T0 + m * 60_000, LAT, LON).ring.low.map(p => p.cover));
const lateSeq = [0, 90, 120, 180, 239].map(lateOf);
ok(lateSeq.every((v, i) => i === 0 || v <= lateSeq[i - 1] + 1e-9) && lateSeq[0] > 0.5 && lateSeq[4] < 0.12, `보정이 시간에 따라 이어서 줄어듦: ${lateSeq.map(v => v.toFixed(2)).join(' → ')}`);
const gone = R.correctMacroRing(base, [bkn], T0 + 250 * 60_000, LAT, LON);
ok(gone.used === 0 && gone.ring === base, '240 분 넘으면 보정 없음(같은 객체)');

console.log('\n[3] 층');
const clr = mk('RKSO', -45, 10, [], { clearBelowM: 3660 });   // 자동 CLR: metarSky 가 저층 0 · 중층 0 으로 읽음(3.7 km 아래 구름 없음)
const clrFix = R.correctMacroRing(ringOf(0.3, 0.4), [clr], sceneMs, LAT, LON);
ok(Math.min(...clrFix.ring.low.map(p => p.cover)) < 0.1 && Math.min(...clrFix.ring.mid.map(p => p.cover)) < 0.2, `CLR: 근처 저층 ${Math.min(...clrFix.ring.low.map(p => p.cover)).toFixed(2)} · 중층 ${Math.min(...clrFix.ring.mid.map(p => p.cover)).toFixed(2)} 로 내려감`);
const cavok = mk('RKXX', -45, 10, [], { clearBelowM: 1524 });   // CAVOK: 저층 0, 중층은 모름 → 중층 고리 그대로
const cavFix = R.correctMacroRing(ringOf(0.3, 0.4), [cavok], sceneMs, LAT, LON);
ok(Math.min(...cavFix.ring.low.map(p => p.cover)) < 0.1 && cavFix.ring.mid.every(p => near(p.cover, 0.4, 1e-9)), 'CAVOK: 저층만 내려가고 중층 고리는 그대로');
const lowOnly = R.correctMacroRing(ringOf(0.1, 0.4), [bkn], sceneMs, LAT, LON);
ok(lowOnly.ring.mid.every(p => near(p.cover, 0.4, 1e-9)), 'BKN030 은 저층만 말함 → 중층 고리 그대로');
ok(lowOnly.ring.high === undefined || lowOnly.ring.high.every((p, i) => p.cover === 0.7), '상층 고리는 늘 그대로');

console.log('\n[4] 공항 여럿 · 같은 공항 여러 보고');
const fewFar = mk('RKSS', 17, -18, [{ cover: 'FEW', baseFtAgl: 2500 }]);   // 김포: 저 19 %, 24 km
const both = R.correctMacroRing(ringOf(0.07), [bkn, fewFar], sceneMs, LAT, LON);
const nearBkn = nearest(both.ring, (bkn.lon - LON) * 111.32 * Math.cos(LAT * Math.PI / 180), (bkn.lat - LAT) * 110.57).c;
const nearFew = nearest(both.ring, (fewFar.lon - LON) * 111.32 * Math.cos(LAT * Math.PI / 180), (fewFar.lat - LAT) * 110.57).c;
ok(both.used === 2 && nearBkn > nearFew, `성남 쪽 ${nearBkn.toFixed(2)} > 김포 쪽 ${nearFew.toFixed(2)}`);
const old = { ...bkn, timeMs: T0 - 3 * 3600_000, layers: [{ cover: 'OVC', baseFtAgl: 1000 }] };
const picked = R.nearestReportPerStation([old, bkn], sceneMs);
ok(picked.length === 1 && picked[0].timeMs === T0, '같은 공항은 장면 시각에 가까운 보고 하나만');

console.log('\n[5] 불변 · 잘림 · 없음');
const frozen = JSON.stringify(base);
R.correctMacroRing(base, [bkn], sceneMs, LAT, LON);
ok(JSON.stringify(base) === frozen, '원본 고리 불변');
const lowClr = R.correctMacroRing(ringOf(0.02), [clr], sceneMs, LAT, LON);
ok(lowClr.ring.low.every(p => p.cover >= 0 && p.cover <= 1), '0~1 로 잘림');
ok(R.correctMacroRing(base, [], sceneMs, LAT, LON).ring === base && R.correctMacroRing(base, null, sceneMs, LAT, LON).used === 0, '보고 없음 → 같은 객체');

console.log('\n[6] 관측점 덮어쓰기 창(metarWindowWeight)');
ok(M.metarWindowWeight(60, 30) === 1 && M.metarWindowWeight(90, 60) === 1, '창 안은 1');
ok(near(M.metarWindowWeight(165, 30), 0.5, 1e-9) && near(M.metarWindowWeight(0, 90), 0.5, 1e-9) && M.metarWindowWeight(240, 10) === 0 && M.metarWindowWeight(0, 120) === 0, '꼬리: 165 분 0.5 · 90 km 0.5 · 끝 0');
console.log(fail ? `\nFAILURES — pass ${pass} / fail ${fail}` : `\nALL PASS — ${pass}`);
process.exit(fail ? 1 : 0);
