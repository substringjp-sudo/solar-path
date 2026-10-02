/**
 * **해 위치·출몰이 하늘과 맞는가** — 판정. 브라우저가 필요 없습니다.
 *
 * 앱의 태양력(`src/utils/solarPosition.ts`)을 앱 밖의 자, PyEphem 표
 * (`fixtures/sun-ephem.json`, 만드는 법은 옆의 `sun-ephem.py`)에 댑니다.
 *
 * 먼저 정한 줄:
 *  1. 위치 — 표 387점에서 기하 고도 0.01°, 방위 0.02° 안 (고도 85° 아래만; 천정 근처 방위는 무딤).
 *  2. 출몰 — 8곳 × 6일의 일출·일몰 96개가 PyEphem 과 **각으로** 0.01° 안(시각 차 × 그 순간 해가 움직이는 빠르기).
 *     ⚠ 처음엔 "3초 안" 으로 정했고 **걸렸습니다**: 레이캬비크 하지 일몰이 4.1초. 그날 해는 분에
 *     0.045° 만 내려가서, 각으로는 0.003° — 1 의 위치 정밀도 그대로입니다. 시각 문턱은 해가
 *     비스듬히 지는 고위도에서 같은 각 오차를 몇 배로 부풀리므로 각으로 고쳐 잽니다.
 *  3. 출몰은 **같은 위치 함수의 근** — 그 순간 sunPosition 의 고도가 −0.833° ± 0.0005°.
 *     3D 해와 앱이 알리는 일몰이 정의상 같은 순간이라는 뜻입니다.
 *  4. 하루 고르기는 SunCalc 과 같다 — 2026년 한 해를 7시간 걸음으로 훑어 날이 밀린 곳이 없다.
 *  5. 백야·극야는 SunCalc 처럼 Invalid Date.
 *  6. 후쿠이 2026-10-02 17:31 JST — 기하 고도 0.53° ± 0.01°.
 *
 * 대조(옛 SunCalc 은 걸려야 합니다 — 자가 공허하지 않다는 증거):
 *  A. SunCalc.getPosition 은 1 의 문턱을 10배 넘게 어긋난다.
 *  B. SunCalc.getTimes 는 2 의 문턱을 10배 넘게 어긋난다.
 *  C. SunCalc.getTimes 의 일몰은 제 getPosition 이 −0.833° 를 지나는 순간과 다르다(3 이 잡는 결함).
 *  D. 후쿠이 17:31 의 SunCalc 고도는 0.73° 근처다 — 6 이 잡는 결함.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-solar-position.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'solarPosition.js'));
  const SunCalc = require(path.join(__dirname, '..', '..', 'node_modules', 'suncalc'));
  const REF = require('./fixtures/sun-ephem.json');
  const D = 180 / Math.PI;
  const azDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  console.log(`  자: ${REF.source}`);

  // ── [1] 위치 ─────────────────────────────────────────────────────────
  console.log('\n[1] 위치 — PyEphem 표와 견줌');
  {
    let alt = 0, altAt = '', az = 0, azAt = '', altSC = 0, n = 0;
    for (const r of REF.positions) {
      const t = new Date(r.iso);
      const p = S.sunPosition(t, r.lat, r.lon);
      const da = Math.abs(p.altitude * D - r.altDeg);
      if (da > alt) { alt = da; altAt = `${r.place} ${r.iso}`; }
      if (r.altDeg < 85) {
        const dz = azDiff(p.azimuth * D + 180, r.azDeg);
        if (dz > az) { az = dz; azAt = `${r.place} ${r.iso}`; }
      }
      altSC = Math.max(altSC, Math.abs(SunCalc.getPosition(t, r.lat, r.lon).altitude * D - r.altDeg));
      n++;
    }
    console.log(`      ${n}점 — 고도 최대 ${alt.toFixed(4)}° (${altAt}) · 방위 최대 ${az.toFixed(4)}° (${azAt})`);
    console.log(`      대조 SunCalc: 고도 최대 ${altSC.toFixed(4)}°`);
    ok(alt < 0.01, `고도가 0.01° 안 (${alt.toFixed(4)}°)`);
    ok(az < 0.02, `방위가 0.02° 안 (${az.toFixed(4)}°)`);
    ok(altSC > 0.1, `대조 A — SunCalc 은 걸린다 (${altSC.toFixed(3)}° > 0.1°)`);
  }

  // ── [2]·[3] 출몰 ─────────────────────────────────────────────────────
  console.log('\n[2] 일출·일몰 — PyEphem 과 견줌');
  {
    let worst = 0, worstAt = '', worstDeg = 0, worstDegAt = '', worstSC = 0, worstSCDeg = 0, root = 0, n = 0;
    for (const e of REF.events) {
      if (e.none) continue;
      const noon = new Date(e.noonIso);
      const T = S.sunTimes(noon, e.lat, e.lon);
      const C = SunCalc.getTimes(noon, e.lat, e.lon);
      for (const [k, ref] of [['sunset', e.setIso], ['sunrise', e.riseIso]]) {
        const tRef = new Date(ref).getTime();
        // 그 순간 해가 내려가는(올라가는) 빠르기 — 도/초
        const rate = Math.abs(S.sunPosition(new Date(tRef + 30e3), e.lat, e.lon).altitude
                            - S.sunPosition(new Date(tRef - 30e3), e.lat, e.lon).altitude) * D / 60;
        const d = Math.abs(T[k].getTime() - tRef) / 1000;
        if (d > worst) { worst = d; worstAt = `${e.place} ${k} ${ref}`; }
        if (d * rate > worstDeg) { worstDeg = d * rate; worstDegAt = `${e.place} ${k} ${ref}`; }
        const dSC = Math.abs(C[k].getTime() - tRef) / 1000;
        worstSC = Math.max(worstSC, dSC);
        worstSCDeg = Math.max(worstSCDeg, dSC * rate);
        root = Math.max(root, Math.abs(S.sunPosition(T[k], e.lat, e.lon).altitude * D + 0.833));
        n++;
      }
    }
    console.log(`      ${n}개 — 시각 최대 ${worst.toFixed(1)}초 (${worstAt})`);
    console.log(`              각으로 최대 ${worstDeg.toFixed(4)}° (${worstDegAt})`);
    console.log(`      대조 SunCalc.getTimes: 시각 최대 ${worstSC.toFixed(0)}초 · 각으로 ${worstSCDeg.toFixed(3)}°`);
    ok(worstDeg < 0.01, `출몰이 각으로 0.01° 안 (${worstDeg.toFixed(4)}°)`);
    ok(worstSCDeg > 0.1, `대조 B — SunCalc.getTimes 는 걸린다 (${worstSCDeg.toFixed(3)}° > 0.1°)`);
    console.log('\n[3] 출몰은 같은 위치 함수의 근인가');
    console.log(`      그 순간의 고도 − (−0.833°): 최대 ${root.toExponential(1)}°`);
    ok(root < 5e-4, `일몰 순간 3D 해의 중심이 정확히 −0.833° 에 있다`);
    // 대조 C — SunCalc 의 두 함수는 서로 맞지 않습니다.
    const lat = 36.0209, lon = 136.2894, noon = new Date('2026-10-02T03:00:00Z');
    const set = SunCalc.getTimes(noon, lat, lon).sunset;
    const altThen = SunCalc.getPosition(set, lat, lon).altitude * D;
    let lo = set.getTime() - 600e3, hi = set.getTime() + 600e3;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (SunCalc.getPosition(new Date(m), lat, lon).altitude * D > -0.833) lo = m; else hi = m; }
    const gap = (set.getTime() - lo) / 1000;
    console.log(`      대조 SunCalc 후쿠이 10/2: getTimes 일몰에 getPosition 고도 ${altThen.toFixed(3)}° · 제 −0.833° 통과보다 ${gap.toFixed(0)}초 늦음`);
    ok(Math.abs(gap) > 30, `대조 C — SunCalc 의 일몰과 3D 해가 갈라져 있었다 (${gap.toFixed(0)}초)`);
  }

  // ── [4] 하루 고르기 ──────────────────────────────────────────────────
  console.log('\n[4] 어느 날의 출몰인가 — SunCalc 과 같은 날');
  {
    let worst = 0, worstAt = '', n = 0;
    const places = [[36.02, 136.29], [37.57, 126.98], [51.51, -0.13], [-33.87, 151.21], [40.71, -74.01], [21.31, -157.86], [-54.8, -68.3], [1.35, 103.82]];
    for (const [la, lo] of places) {
      for (let h = 0; h < 365 * 24; h += 7) {
        const d = new Date(Date.UTC(2026, 0, 1) + h * 3600e3);
        const a = S.sunTimes(d, la, lo).solarNoon, b = SunCalc.getTimes(d, la, lo).solarNoon;
        const diff = Math.abs(a - b) / 1000;
        if (diff > worst) { worst = diff; worstAt = `${la},${lo} ${d.toISOString()}`; }
        n++;
      }
    }
    console.log(`      ${n}번 — 남중 차 최대 ${worst.toFixed(0)}초 (${worstAt})`);
    ok(worst < 300, `날이 밀린 곳이 없다 (최대 ${worst.toFixed(0)}초 — 하루 밀리면 86400초)`);
  }

  // ── [5] 극지 ─────────────────────────────────────────────────────────
  console.log('\n[5] 백야·극야');
  {
    const summer = S.sunTimes(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6);
    const winter = S.sunTimes(new Date('2026-12-21T12:00:00Z'), 78.2, 15.6);
    const sc = SunCalc.getTimes(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6);
    console.log(`      스발바르 하지 일출 ${summer.sunrise} · 동지 일출 ${winter.sunrise} · SunCalc 하지 ${sc.sunrise}`);
    ok(isNaN(summer.sunrise) && isNaN(summer.sunset), `백야엔 일출·일몰이 Invalid Date`);
    ok(isNaN(winter.sunrise) && isNaN(winter.sunset), `극야엔 일출·일몰이 Invalid Date`);
    ok(!isNaN(summer.solarNoon), `그래도 남중은 있다`);
    const blue = S.sunCrossings(new Date('2026-10-02T03:00:00Z'), 36.0209, 136.2894, -4);
    ok(Math.abs(S.sunPosition(blue.set, 36.0209, 136.2894).altitude * D + 4) < 5e-4, `임의 고도(−4°) 통과도 같은 근이다`);
  }

  // ── [6] 후쿠이 사진 시각 ─────────────────────────────────────────────
  console.log('\n[6] 후쿠이 2026-10-02 17:31 JST');
  {
    const t = new Date('2026-10-02T08:31:00Z');
    const a = S.sunPosition(t, 36.0209, 136.2894).altitude * D;
    const sc = SunCalc.getPosition(t, 36.0209, 136.2894).altitude * D;
    const ref = REF.positions.find(r => r.place === 'fukui-photo' && r.iso.startsWith('2026-10-02T08:31')).altDeg;
    console.log(`      기하 고도: 앱 ${a.toFixed(3)}° · PyEphem ${ref.toFixed(3)}° · SunCalc ${sc.toFixed(3)}°`);
    ok(Math.abs(a - 0.53) < 0.01, `앱의 해가 0.53° 에 있다 (${a.toFixed(3)}°)`);
    ok(Math.abs(sc - 0.73) < 0.01, `대조 D — SunCalc 은 0.73° (${sc.toFixed(3)}°)`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
