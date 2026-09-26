/**
 * **직달과 하늘빛이 같은 단위인가** (§104) — 맑은 날 수평면의 확산 비율로 잽니다.
 *
 * 사용자: "해가 높이 떠있을때에는 공기 전체에서 빛을 받지만 노을질때가 돼서 멀어졌을 때에는
 * 공기에서 난반사되는 빛이 적어지는거 아니야?"
 *
 * 하늘빛(`skyRadiance`)은 산란에 `skyExposure`(22)를 곱해 나옵니다. 직달(`beamAtAltitude`)은 대기
 * 밖 햇빛을 1 로 둔 투과율입니다. 구름·지면이 두 값을 **그대로 더하면** 하늘빛이 22배 셉니다.
 *
 * 자: 맑은 날 수평면 확산 비율 kd = DHI / (DNI·sin h + DHI). 앱이 구름에 넘기는 그대로의 직달
 * (`SOLAR_BEAM_SCALE` 배 — 지형이 먼저 쓰던 그 상수)로 계산해 맑은 하늘 모형의 대략값 둘레 넓은 띠에 드는지 봅니다.
 *
 *   맑은 하늘 모형(Bird · Ineichen–Perez, 해면, 탁도 보통)의 대략값:
 *     h 60° → kd ≈ 0.11    h 30° → ≈ 0.18    h 10° → ≈ 0.4
 *   띠(재기 전에 정함):  60°: 0.06~0.20   30°: 0.10~0.30   10°: 0.25~0.60
 *
 * 대조: 배율을 1 로(예전처럼) 두면 띠를 벗어나야 합니다 — 자가 그 결함을 봅니다.
 * 참고: 해 쪽 수직면(노을 구름 옆면)의 직달 몫도 찍습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/verify-light-units.js
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const A = await import(pathToFileURL(path.join(PREVIEW, 'app/utils/atmosphere.js')).href);
  const { makeAtmosphereParams, beamAtAltitude, skyRadiance, angularSeparationDeg } = A;
  const gainNow = A.SOLAR_BEAM_SCALE;   // 직달 눈금 — 지형(groundLighting)과 구름(updateCloudSlab)이 같이 씁니다
  const atm = makeAtmosphereParams({ latitude: 37.5, observerElevM: 30, dayOfYear: 200, humidityPct: 60, visibilityM: 20000 });
  const Y = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const D = Math.PI / 180, SUNAZ = 270;
  const dhiOf = (h) => {
    let s = 0;
    for (let e = 1; e < 90; e += 2) for (let a = 0; a < 360; a += 6) {
      const L = Y(skyRadiance(e, angularSeparationDeg(a, e, SUNAZ, h), h, atm));
      s += L * Math.sin(e * D) * Math.cos(e * D) * (2 * D) * (6 * D);
    }
    return s;
  };
  const kdOf = (h, gain) => { const dni = Y(beamAtAltitude(h, 0, atm)) * gain, dhi = dhiOf(h); return dhi / (dni * Math.sin(h * D) + dhi); };
  const BANDS = { 60: [0.06, 0.20], 30: [0.10, 0.30], 10: [0.25, 0.60] };

  console.log(`직달 눈금 SOLAR_BEAM_SCALE = ${gainNow} (참고: 하늘 산란 이득 skyExposure = ${(await import(pathToFileURL(path.join(PREVIEW, 'app/utils/skyTuning.js')).href)).getTuning().skyExposure})`);
  console.log('   해     kd(지금)   kd(배율 1, 예전)   띠');
  const rows = {};
  for (const h of [60, 30, 10]) { rows[h] = { now: kdOf(h, gainNow), old: kdOf(h, 1) };
    console.log(`  ${String(h).padStart(3)}°    ${rows[h].now.toFixed(3)}      ${rows[h].old.toFixed(3)}          ${BANDS[h][0]}~${BANDS[h][1]}`); }
  console.log('\n== 지금 ==');
  for (const h of [60, 30, 10]) ok(rows[h].now >= BANDS[h][0] && rows[h].now <= BANDS[h][1], `해 ${h}°: 확산 비율이 맑은 하늘 모형 띠 안 (${rows[h].now.toFixed(3)})`);
  console.log('\n== 대조 (배율 1 은 띠를 벗어난다) ==');
  ok([60, 30].every(h => rows[h].old > BANDS[h][1]), `배율 1 이면 하늘빛이 너무 세다 (60° ${rows[60].old.toFixed(3)} · 30° ${rows[30].old.toFixed(3)})`);

  // 참고: 해 쪽 수직면(1.5km 구름 옆면)의 직달 몫
  console.log('\n참고 — 해 쪽 수직면(구름 옆면, 1.5km)의 직달 몫:');
  for (const h of [30, 5, 0, -1]) {
    const dip = Math.acos(6371 / 6372.5) / D, eC = h + dip;
    const dir = Y(beamAtAltitude(h, 1.5, atm)) * gainNow * Math.max(0, Math.cos(eC * D));
    let sky = 0;
    for (let e = 1; e < 90; e += 2) for (let a = -90; a < 90; a += 4) {
      const L = Y(skyRadiance(e, angularSeparationDeg(SUNAZ + a, e, SUNAZ, h), h, atm, 1.5));
      sky += L * Math.cos(e * D) * Math.cos(a * D) * Math.cos(e * D) * (2 * D) * (4 * D);
    }
    console.log(`  해 ${String(h).padStart(3)}°  직달 몫 ${(100 * dir / (dir + sky)).toFixed(0)}%`);
  }
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
