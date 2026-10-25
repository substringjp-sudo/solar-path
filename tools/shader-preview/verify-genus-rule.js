/**
 * §159 구름 종류 규칙(`src/utils/cloudGenusForecast.ts`) — 2차 자(RULER-genus2)가 고친 ns 조건 합격 판정. esbuild 로 순수 모듈만 묶음.
 *   node tools/shader-preview/verify-genus-rule.js
 *  [1] 가랑비 0.1 mm · 저층 24 % → ns 가 아님(sc). 0.5 mm · 저층 24 % → 아직 ns 아님(덮개가 아님). 0.5 mm · 저층 90 % → ns.
 *  [2] 강수 0 → 저층 규칙 그대로(두께 0.6 km 이상·낮·운량 55 % 미만 → cu, 덮개 → sc).
 *  [3] 중·상층은 바뀌지 않음(중층 50 % → ac, 상층 100 % → ci; 두께 승격은 liveScene §158 몫).
 *  [4] 문턱 이름 보존(자 스크립트와 같은 이름): nsPrecip·nsCover·stBaseKm·cuThickKm·cuCover.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genus-'));
  const out = path.join(outDir, 'genus.mjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/utils/cloudGenusForecast.ts'), '--bundle', '--format=esm', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
  const G = await import('file://' + out);
  // 저층 덱: 900~1900 m 에 운량(두께 ≈ 1 km) — 적운 판정이 가능한 단면
  const deck = (c) => [[600, 0], [900, c], [1200, c], [1500, c], [1900, c], [2300, 0], [3000, 0], [4500, 0], [5500, 0], [7000, 0], [9000, 0]].map(([heightM, coverPct]) => ({ heightM, coverPct }));
  const base = { mid: 50, high: 100, profile: deck(60), groundM: 50, humidityPct: 80, isDay: true };
  console.log('[1] ns 조건');
  const drizzle = G.classifyGenus({ ...base, low: 24, precipitationMm: 0.1 });
  ok(drizzle.low !== 'ns', `0.1 mm·저층 24 % → ${drizzle.low} (ns 아님)`);
  const rain24 = G.classifyGenus({ ...base, low: 24, precipitationMm: 0.5 });
  ok(rain24.low !== 'ns', `0.5 mm·저층 24 % → ${rain24.low} (덮개 아님 → ns 아님)`);
  const rain90 = G.classifyGenus({ ...base, low: 90, profile: deck(95), precipitationMm: 0.5 });
  ok(rain90.low === 'ns', `0.5 mm·저층 90 % → ${rain90.low}`);
  const rain80 = G.classifyGenus({ ...base, low: 80, profile: deck(85), precipitationMm: 0.3 });
  ok(rain80.low === 'ns', `문턱 꼭 그 값(0.3 mm·80 %) → ${rain80.low}`);
  console.log('[2] 강수 0');
  const cu = G.classifyGenus({ ...base, low: 30, precipitationMm: 0 });
  ok(cu.low === 'cu', `저층 30 %·덱 두께 1 km·낮 → ${cu.low}`);
  const sc = G.classifyGenus({ ...base, low: 70, precipitationMm: 0 });
  ok(sc.low === 'sc', `저층 70 % → ${sc.low}`);
  const night = G.classifyGenus({ ...base, low: 30, precipitationMm: 0, isDay: false });
  ok(night.low === 'sc', `밤 저층 30 % → ${night.low}`);
  console.log('[3] 중·상층');
  ok(drizzle.mid === 'ac' && drizzle.high === 'ci', `중 50 % → ${drizzle.mid}, 상 100 % → ${drizzle.high}`);
  console.log('[4] 문턱 이름');
  ok(['nsPrecip', 'nsCover', 'stBaseKm', 'cuThickKm', 'cuCover'].every(k => k in G.GENUS_THRESHOLDS), '자 스크립트가 쓰는 문턱 이름 보존');
  ok(G.GENUS_THRESHOLDS.nsPrecip === 0.3 && G.GENUS_THRESHOLDS.nsCover === 80, `nsPrecip ${G.GENUS_THRESHOLDS.nsPrecip}·nsCover ${G.GENUS_THRESHOLDS.nsCover}`);
  console.log(`\n${pass}/${pass + fail} 통과`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
