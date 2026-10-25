/**
 * §160 관측 덮어쓰기(METAR `src/utils/metar.ts` · 위성 일사 `src/utils/satelliteIrradiance.ts`) 합격 판정. esbuild 로 순수 모듈만 묶음.
 *   node tools/shader-preview/verify-observation-override.js [--live]   (--live: aviationweather.gov·satellite-api 에 실제로 물어 파싱 확인)
 *  [1] METAR 파싱: 고마쓰 "SCT015 BKN030 BKN050 −SHRA" → 층 3, 비; 인천 CAVOK → 구름 없음 1,524 m 아래; 가장 가까운 공항 고르기.
 *  [2] 하늘 요약: SCT015 BKN030 → 저층 44 %·밑면 457 m, 중층(BKN030 은 914 m 라 저층) 없음; FEW020 BKN080 → 저 19 %, 중 69 %(누적 벗김); OVC005 → 저 100 %.
 *  [3] 덮어쓰기 창: 보고 60 분 전·30 km → 적용, 2 시간 뒤 → 무시, 80 km → 무시; 적용 후 저층·밑면·강수가 관측값, 원본은 불변.
 *  [4] CAVOK 는 저층 0 으로 하고 단면 2 km 아래를 비움; 날씨 없음 + 예보 강수 0.5 → 0.05.
 *  [5] 위성 DNI 고르기: 관측 있으면 관측(source sat), 없으면 예보(fc), 둘 다 없으면 null; attach 는 시각 문자열로 맞추고 짝 없는 시각 null.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'));
  const bundle = async (src, name) => {
    const out = path.join(outDir, name);
    execFileSync('npx', ['esbuild', path.join(ROOT, src), '--bundle', '--format=esm', '--define:__DEV__=false', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
    return import('file://' + out);
  };
  const M = await bundle('src/utils/metar.ts', 'metar.mjs');
  const S = await bundle('src/utils/satelliteIrradiance.ts', 'sat.mjs');
  const T0 = Date.parse('2026-10-25T14:00:00Z');
  const items = [
    { icaoId: 'RJNK', lat: 36.39, lon: 136.41, obsTime: T0 / 1000, rawOb: 'METAR RJNK 251400Z 09006KT 9999 -SHRA SCT015 BKN030 BKN050 18/18 Q1018', clouds: [{ cover: 'SCT', base: 1500 }, { cover: 'BKN', base: 3000 }, { cover: 'BKN', base: 5000 }], wxString: '-SHRA', temp: 18, dewp: 18 },
    { icaoId: 'RKSI', lat: 37.46, lon: 126.44, obsTime: T0 / 1000, rawOb: 'METAR RKSI 251400Z 04007KT CAVOK 18/13 Q1019', clouds: [{ cover: 'CAVOK' }], wxString: null },
    { icaoId: 'RKSS', lat: 37.56, lon: 126.79, obsTime: T0 / 1000, rawOb: 'METAR RKSS 251400Z 08008KT CAVOK 19/12 Q1019', clouds: [{ cover: 'CAVOK' }] },
    { icaoId: 'RKSS', lat: 37.56, lon: 126.79, obsTime: T0 / 1000 - 1800, rawOb: 'METAR RKSS 251330Z 08008KT FEW020 19/12 Q1019', clouds: [{ cover: 'FEW', base: 2000 }] },
  ];
  console.log('[1] 파싱');
  const k = M.parseMetarItem(items[0], 36.5, 136.5);
  ok(k && k.layers.length === 3 && k.layers[0].cover === 'SCT' && k.layers[0].baseFtAgl === 1500 && k.wx === '-SHRA', `고마쓰: 층 ${k?.layers.length}, wx ${k?.wx}`);
  const i = M.parseMetarItem(items[1], 37.46, 126.44);
  ok(i && i.layers.length === 0 && i.clearBelowM === 1524, `인천 CAVOK → clearBelowM ${i?.clearBelowM}`);
  const seoul = M.pickNearestMetar(items, 37.57, 126.98);   // 서울 시청 → 김포(RKSS) 가 인천보다 가깝고, 최신 보고(14:00)
  ok(seoul && seoul.icao === 'RKSS' && seoul.timeMs === T0 && seoul.distanceKm < 20, `서울 → ${seoul?.icao} ${seoul?.distanceKm.toFixed(0)} km, 최신 보고 선택`);
  console.log('[2] 하늘 요약');
  const sk = M.metarSky(k);
  ok(sk.lowCoverPct === 75 && near(sk.lowBaseKmAgl, 0.457, 0.001) && sk.raining && !sk.snowing, `SCT015 BKN030 BKN050: 저 ${sk.lowCoverPct}% 밑면 ${(sk.lowBaseKmAgl * 1000).toFixed(0)} m 비 ${sk.raining}`);
  const two = M.metarSky({ ...k, layers: [{ cover: 'FEW', baseFtAgl: 2000 }, { cover: 'BKN', baseFtAgl: 8000 }], wx: null });
  ok(two.lowCoverPct === 19 && near(two.midCoverPct, 69.1, 0.5), `FEW020 BKN080: 저 ${two.lowCoverPct}% 중 ${two.midCoverPct?.toFixed(1)}% (누적 75 에서 저층 19 벗김)`);
  const ovc = M.metarSky({ ...k, layers: [{ cover: 'OVC', baseFtAgl: 500 }], wx: null });
  ok(ovc.lowCoverPct === 100 && ovc.midCoverPct === null, `OVC005: 저 100 %, 중층 알 수 없음`);
  const cav = M.metarSky(i);
  ok(cav.lowCoverPct === 0 && cav.midCoverPct === null && cav.lowBaseKmAgl === null, `CAVOK: 저 0 %, 중층 모름`);
  console.log('[3] 덮어쓰기 창');
  const obs = { low: 24, mid: 50, high: 100, lowDeckBaseKm: 1.2, lowDeckTopKm: 1.9, precipitation: 0, distance: 0, azimuthOffset: 0, directNormalIrradiance: 400 };
  const ov = M.applyMetarToObs(obs, { ...k, distanceKm: 30 }, T0 - 60 * 60_000, 100);
  ok(ov && ov.obs.low === 75 && near(ov.obs.lowDeckBaseKm, 0.557, 0.001) && near(ov.obs.lowDeckTopKm, 0.557 + 0.7, 0.001) && ov.obs.precipitation === 0.5, `60 분 전·30 km → 저 ${ov?.obs.low}% 밑면 ${ov?.obs.lowDeckBaseKm?.toFixed(3)} km 윗면 ${ov?.obs.lowDeckTopKm?.toFixed(3)} 강수 ${ov?.obs.precipitation}`);
  ok(obs.low === 24 && obs.lowDeckBaseKm === 1.2, '원본 obs 불변');
  ok(M.applyMetarToObs(obs, { ...k, distanceKm: 30 }, T0 + 2 * 3600_000, 100) === null, '2 시간 뒤 → 무시');
  ok(M.applyMetarToObs(obs, { ...k, distanceKm: 80 }, T0, 100) === null, '80 km → 무시');
  ok(M.applyMetarToObs(obs, null, T0, 100) === null, 'METAR 없음 → null');
  console.log('[4] CAVOK·강수');
  const obs2 = { ...obs, low: 60, precipitation: 0.5, profileHeightM: [200, 800, 1500, 3000, 5000], profileCoverPct: [10, 60, 40, 30, 0] };
  const ov2 = M.applyMetarToObs(obs2, { ...i, distanceKm: 10 }, T0, 50);
  ok(ov2 && ov2.obs.low === 0 && ov2.obs.lowDeckBaseKm === undefined && ov2.obs.profileCoverPct.join() === '0,0,0,30,0' && ov2.obs.precipitation === 0.05, `CAVOK: 저 ${ov2?.obs.low}%, 단면 ${ov2?.obs.profileCoverPct.join()}, 강수 ${ov2?.obs.precipitation}`);
  ok(ov2 && /METAR RKSI 10 km 14:00Z/.test(ov2.note), `요약: ${ov2?.note}`);
  console.log('[5] 위성 DNI');
  ok(S.pickDni({ directNormalIrradiance: 400, satDirectNormalIrradiance: 29 }).dni === 29 && S.pickDni({ directNormalIrradiance: 400, satDirectNormalIrradiance: 29 }).source === 'sat', '관측 있으면 관측');
  ok(S.pickDni({ directNormalIrradiance: 400 }).source === 'fc' && S.pickDni({ directNormalIrradiance: 400, satDirectNormalIrradiance: null }).dni === 400, '관측 없으면 예보');
  ok(S.pickDni({}).source === null, '둘 다 없으면 null');
  const hourly = { time: ['2026-10-25T10:00', '2026-10-25T11:00', '2026-10-25T12:00'] };
  S.attachSatelliteIrradiance(hourly, { time: ['2026-10-25T09:00', '2026-10-25T10:00', '2026-10-25T11:00'], dni: [100, 200, null], ghi: [50, 60, 70], observedUntilMs: 1 });
  ok(hourly.satDirectNormalIrradiance.join() === '200,,' && hourly.satShortwaveRadiation.join() === '60,70,', `attach: DNI ${JSON.stringify(hourly.satDirectNormalIrradiance)} GHI ${JSON.stringify(hourly.satShortwaveRadiation)}`);
  if (process.argv.includes('--live')) {
    console.log('[6] 실제 API');
    const m = await M.fetchNearestMetar(37.57, 126.98);
    ok(m && m.icao && Number.isFinite(m.timeMs), `서울 METAR: ${m?.icao} ${m?.raw}`);
    const s = await S.fetchSatelliteIrradiance(37.57, 126.98, new Date());
    ok(!s || (s.time.length > 0 && s.observedUntilMs > 0), `위성 일사: ${s ? `${s.time.length} 시각, 마지막 ${new Date(s.observedUntilMs).toISOString()}` : '없음(밤·결측이면 정상)'}`);
  }
  console.log(`\n${pass}/${pass + fail} 통과`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
