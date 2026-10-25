/**
 * §163 자료원 해석기(`src/utils/weatherSource.ts`) 합격 판정 — RULER-source §3 S5. esbuild 로 순수 모듈만 묶음.
 *   node tools/shader-preview/verify-weather-source.js
 *  [1] 날짜 경계: 오늘 −5 → forecast, −6 → historical, 미래·오늘 → forecast.
 *  [2] 같은 날짜의 00:30·12:00·23:30(기기 현지 날짜 문자열이 같음) → 같은 origin; 한국 현지 00~09 시 날짜 표(UTC 전날)는 호출부 localDateString 몫 — 여기서는 문자열만 본다.
 *  [3] 단조성: 날짜 D 를 now 가 지나가며 보면 forecast → historical 로 한 번만 바뀌고 되돌아가지 않는다.
 *  [4] 모델 시작일 표: 2024-02-03 이상 historical(블렌드), 2022-11-24 ~ 2024-02-02 historical-icon(icon 단독), 그 전 archive.
 *  [5] kind: ring/fan 은 모델 파라미터, point 는 빈 문자열(모델 미지정). fan 의 modelParam 덮어쓰기.
 *  [6] 403 사상: historicalForbidden 이면 historical·historical-icon 자리가 archive-fallback(archive URL, 모델 없음); forecast·archive 는 불변.
 *  [7] archiveFallbackOf · isArchiveOrigin · leadDaysBetween(월 경계·연 경계).
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsrc-'));
  const out = path.join(outDir, 'ws.mjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/utils/weatherSource.ts'), '--bundle', '--format=esm', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
  const S = await import('file://' + out);
  const today = '2026-10-25';
  const f = (d, kind = 'ring', opts) => S.weatherSourceFor(d, today, kind, opts);
  console.log('[1] 날짜 경계');
  ok(f('2026-10-20').origin === 'forecast' && f('2026-10-20').leadDays === -5, '오늘 −5 → forecast');
  ok(f('2026-10-19').origin === 'historical' && f('2026-10-19').leadDays === -6, '오늘 −6 → historical');
  ok(f('2026-10-25').origin === 'forecast' && f('2026-11-05').origin === 'forecast', '오늘·미래 → forecast');
  ok(f('2026-10-19').baseUrl === S.HISTORICAL_URL && f('2026-10-20').baseUrl === S.FORECAST_URL, 'URL 이 자료원을 따른다');
  console.log('[2] 하루는 한 자료원');
  ok(['00:30', '12:00', '23:30'].every(() => f('2026-10-19').origin === 'historical'), '같은 날짜 문자열 → 같은 origin(시각은 해석기에 들어오지 않음)');
  console.log('[3] 단조성');
  const D = '2026-09-30'; const seq = [];
  for (let k = 0; k <= 12; k++) { const now = new Date(Date.UTC(2026, 8, 30 + k)).toISOString().slice(0, 10); seq.push(S.weatherSourceFor(D, now, 'ring').origin); }
  const firstHist = seq.indexOf('historical');
  ok(firstHist === 6 && seq.slice(0, 6).every(o => o === 'forecast') && seq.slice(6).every(o => o === 'historical'), `now 가 지나가며: ${seq.join(',')}`);
  console.log('[4] 모델 시작일 표');
  ok(f('2024-02-03').origin === 'historical' && f('2024-02-03').modelParam === '&models=ecmwf_ifs025,icon_seamless', '2024-02-03 → historical 블렌드');
  ok(f('2024-02-02').origin === 'historical-icon' && f('2024-02-02').modelParam === '&models=icon_seamless', '2024-02-02 → historical-icon');
  ok(f('2022-11-24').origin === 'historical-icon' && f('2022-11-23').origin === 'archive', '2022-11-24 경계');
  ok(f('2019-05-01').origin === 'archive' && f('2019-05-01').modelParam === '' && f('2019-05-01').baseUrl === S.ARCHIVE_URL, '그 전 → archive, 모델 없음');
  console.log('[5] kind');
  ok(f('2026-10-19', 'point').modelParam === '' && f('2024-02-02', 'point').modelParam === '' && f('2026-10-25', 'point').modelParam === '', 'point 는 모델 미지정');
  ok(f('2026-10-25', 'fan', { modelParam: '&models=hrrr' }).modelParam === '&models=hrrr', 'fan 모델 덮어쓰기');
  console.log('[6] 403 사상');
  const fb = f('2026-10-19', 'ring', { historicalForbidden: true });
  ok(fb.origin === 'archive-fallback' && fb.baseUrl === S.ARCHIVE_URL && fb.modelParam === '', 'historical → archive-fallback');
  ok(f('2024-02-02', 'ring', { historicalForbidden: true }).origin === 'archive-fallback', 'historical-icon → archive-fallback');
  ok(f('2026-10-20', 'ring', { historicalForbidden: true }).origin === 'forecast' && f('2019-05-01', 'ring', { historicalForbidden: true }).origin === 'archive', 'forecast·archive 는 불변');
  console.log('[7] 보조 함수');
  ok(S.leadDaysBetween('2026-11-01', '2026-10-25') === 7 && S.leadDaysBetween('2026-01-01', '2025-12-31') === 1 && S.leadDaysBetween('2026-02-28', '2026-03-01') === -1, 'leadDaysBetween 월·연 경계');
  const afb = S.archiveFallbackOf(f('2026-10-19'));
  ok(afb.origin === 'archive-fallback' && afb.leadDays === -6 && S.isArchiveOrigin('archive') && S.isArchiveOrigin('archive-fallback') && !S.isArchiveOrigin('historical'), 'archiveFallbackOf · isArchiveOrigin');
  S.setHistoricalForbidden(true); ok(S.isHistoricalForbidden() === true, '세션 플래그'); S.setHistoricalForbidden(false);
  console.log(`\n${pass}/${pass + fail} 통과`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
