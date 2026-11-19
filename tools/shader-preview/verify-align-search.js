/**
 * **해·달 걸기 탐색이 빠짐없고 정확한가** — 판정. 브라우저가 필요 없습니다.
 *
 * `src/utils/alignSearch.ts`(구면 추적)를 astronomy-engine 의 **전수 조사**(`fixtures/align-ref.json`,
 * 만드는 법은 `moon-ref.js`: 1 분 격자로 300 일을 훑어 허용 반경 안에 든 구간마다 가장 가까운 순간)에 댑니다.
 * 구면 추적은 "건너뛴 만큼은 절대 못 들어온다" 는 속도 한계에 기대므로, 놓침이 없는지가 핵심입니다.
 *
 * 먼저 정한 줄(8 건: 서울·레이캬비크·시드니·키토·도쿄, 해와 달):
 *  1. 놓침·덤 없음 — 표의 접근마다 60 초 안에 앱이 찾은 접근이 하나씩 있고, 앱이 찾은 접근마다 표에 짝이 있다.
 *     (허용 반경 끝 0.02° 안쪽은 두 달력의 0.003° 차이로 들고 나므로 양쪽에서 뺍니다.)
 *  2. 정밀 — 접근 시각 차 60 초 안(표가 1 분 격자 정제), 가장 가까운 각 차 0.01° 안.
 *  3. 방향 부호 — 물체가 대상의 오른쪽 위에 있으면 dAz > 0, dEl > 0.
 *  4. 묶음 — 이어진 날을 한 묶음으로, 가장 가까운 것을 대표로.
 *  5. 보이지 않는 곳 — 앙각 −30° 대상(해·달이 못 가는 곳)은 빈 목록.
 *  6. 취소·진행 — `isCancelled` 가 서면 끝까지 가지 않고, 끝까지 가면 진행이 1 로 끝난다.
 *  7. 빠르다 — 400 일 달 탐색이 2 초 안(구면 추적은 보통 0.1 초).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-align-search.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const RAD = Math.PI / 180;

(async () => {
  const AS = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'alignSearch.js'));
  const MP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'moonPosition.js'));
  const REF = require('./fixtures/align-ref.json');
  console.log(`  자: ${REF.source}`);

  // ── [1][2] 전수 조사와 견줌 ──────────────────────────────────────────────
  console.log('\n[1] 전수 조사와 견줌');
  let missed = 0, extra = 0, worstDt = 0, worstDs = 0, nRef = 0, nOurs = 0, worstAt = '';
  for (const c of REF.cases) {
    const from = Date.parse(c.fromIso);
    const hits = await AS.searchAlignments({
      body: c.body, latitude: c.lat, longitude: c.lon, eyeElevM: 0, target: c.target, fromMs: from, days: c.days, epsDeg: c.epsDeg,
    });
    const edge = c.epsDeg - 0.02;
    const refRuns = c.runs.filter(r => r.sepDeg <= edge).map(r => ({ t: Date.parse(r.iso), s: r.sepDeg }));
    const mine = hits.filter(h => h.sepDeg <= edge);
    nRef += refRuns.length; nOurs += mine.length;
    let caseMissed = 0, caseExtra = 0;
    for (const r of refRuns) {
      const h = mine.find(x => Math.abs(x.timeMs - r.t) < 20 * 60e3);
      if (!h) { missed++; caseMissed++; continue; }
      const dt = Math.abs(h.timeMs - r.t) / 1000, ds = Math.abs(h.sepDeg - r.s);
      if (dt > worstDt) { worstDt = dt; worstAt = `${c.place} ${c.body} ${c.target.azDeg}/${c.target.elDeg} ${new Date(r.t).toISOString()}`; }
      worstDs = Math.max(worstDs, ds);
    }
    for (const h of mine) if (!refRuns.some(r => Math.abs(h.timeMs - r.t) < 20 * 60e3)) { extra++; caseExtra++; }
    console.log(`      ${c.place} ${c.body} ${c.target.azDeg}°/${c.target.elDeg}° ε${c.epsDeg}° — 표 ${refRuns.length} · 앱 ${mine.length} · 놓침 ${caseMissed} · 덤 ${caseExtra}`);
  }
  ok(missed === 0 && extra === 0, `8 건 ${nRef} 접근 — 놓침 ${missed}, 덤 ${extra} (앱 ${nOurs})`);
  console.log('\n[2] 정밀');
  ok(worstDt <= 60, `시각 차 최대 ${worstDt.toFixed(0)} 초 ≤ 60 초 (${worstAt})`);
  ok(worstDs <= 0.01, `가장 가까운 각 차 최대 ${worstDs.toFixed(4)}° ≤ 0.01°`);

  // ── [3] 방향 부호 ────────────────────────────────────────────────────
  console.log('\n[3] 방향 부호');
  {
    const lat = 37.5665, lon = 126.978;
    // 달이 높이(15°~60°) 떠 있는 시각을 골라 시험합니다 — 지평선 밑이면 접근이 걸러집니다.
    let t0 = Date.parse('2026-12-03T00:00:00Z');
    while (true) {
      const a = MP.getMoonPositionPrecise(new Date(t0), lat, lon, 0).altitude / RAD;
      if (a > 15 && a < 60) break;
      t0 += 10 * 60e3;
    }
    const moon = MP.getMoonPositionPrecise(new Date(t0), lat, lon, 0);
    const az = moon.azimuth / RAD + 180, alt = moon.altitude / RAD;
    // 대상을 달의 왼쪽 아래에 두면, 달은 대상의 오른쪽 위
    const tgt = { azDeg: az - 0.3 / Math.cos(alt * RAD), elDeg: alt - 0.2 };
    const hits = await AS.searchAlignments({ body: 'moon', latitude: lat, longitude: lon, target: tgt, fromMs: t0 - 6 * 3600e3, days: 0.5, epsDeg: 1.5 });
    const h = hits.find(x => Math.abs(x.timeMs - t0) < 3 * 3600e3);
    ok(!!h, '그 시각 둘레에서 접근을 찾는다');
    if (h) {
      const dAtT0 = Math.hypot(0.3, 0.2);
      ok(h.sepDeg <= dAtT0 + 1e-6, `찾은 최접근 ${h.sepDeg.toFixed(3)}° 은 그 시각의 거리 ${dAtT0.toFixed(3)}° 이하`);
      // 같은 시각의 부호를 따로 잰다: 달이 대상 오른쪽 위
      const q = await AS.searchAlignments({ body: 'moon', latitude: lat, longitude: lon, target: tgt, fromMs: t0 - 60e3, days: 2 / 1440, epsDeg: 1.5 });
      const hq = q[0];
      ok(!!hq && hq.dAzDeg > 0 && hq.dElDeg > 0, `달은 대상의 오른쪽(+${hq ? hq.dAzDeg.toFixed(2) : '?'}°)·위(+${hq ? hq.dElDeg.toFixed(2) : '?'}°)`);
    }
  }

  // ── [4] 묶음 ─────────────────────────────────────────────────────────
  console.log('\n[4] 묶음');
  {
    const mk = (d, sep) => ({ body: 'sun', timeMs: d * 86400e3, sepDeg: sep, dAzDeg: 0, dElDeg: 0, azDeg: 0, altDeg: 0, diskDeg: 0.53, sunAltDeg: 0 });
    const g = AS.groupAlignments([mk(1, 0.9), mk(2, 0.4), mk(3, 0.7), mk(20, 0.5), mk(21, 0.2), mk(60, 0.8)]);
    ok(g.length === 3, `1~3 일 / 20~21 일 / 60 일 → ${g.length} 묶음`);
    ok(g[0].best.sepDeg === 0.4 && g[0].count === 3 && g[1].best.sepDeg === 0.2 && g[2].count === 1, '대표는 묶음 안에서 가장 가까운 접근, 개수가 맞다');
    ok(AS.groupAlignments([]).length === 0, '빈 입력은 빈 목록');
  }

  // ── [5] 보이지 않는 곳 ────────────────────────────────────────────────
  console.log('\n[5] 못 가는 곳');
  {
    const sun = await AS.searchAlignments({ body: 'sun', latitude: 37.5, longitude: 127, target: { azDeg: 180, elDeg: -30 }, fromMs: Date.parse('2026-11-19T00:00:00Z'), days: 365, epsDeg: 1 });
    const moon = await AS.searchAlignments({ body: 'moon', latitude: 37.5, longitude: 127, target: { azDeg: 180, elDeg: -30 }, fromMs: Date.parse('2026-11-19T00:00:00Z'), days: 365, epsDeg: 1 });
    ok(sun.length === 0 && moon.length === 0, `앙각 −30° 대상: 해 ${sun.length}건 · 달 ${moon.length}건`);
  }

  // ── [6] 취소·진행 ─────────────────────────────────────────────────────
  console.log('\n[6] 취소·진행');
  {
    let last = -1, calls = 0;
    await AS.searchAlignments({ body: 'moon', latitude: 37.5, longitude: 127, target: { azDeg: 250, elDeg: 10 }, fromMs: Date.parse('2026-11-19T00:00:00Z'), days: 3000, epsDeg: 2 },
      { onProgress: (f) => { last = f; calls++; } });
    ok(last === 1, `끝까지 가면 진행이 1 로 끝난다 (마지막 ${last}, ${calls} 번 알림)`);
    let n = 0;
    const part = await AS.searchAlignments({ body: 'moon', latitude: 37.5, longitude: 127, target: { azDeg: 250, elDeg: 10 }, fromMs: Date.parse('2026-11-19T00:00:00Z'), days: 36500, epsDeg: 2 },
      { isCancelled: () => ++n > 1 });
    ok(part.length < 500, `취소하면 100 년 분량을 끝까지 돌지 않는다 (${part.length}건에서 멈춤)`);
  }

  // ── [7] 속도 ─────────────────────────────────────────────────────────
  console.log('\n[7] 속도');
  {
    const t = Date.now();
    await AS.searchAlignments({ body: 'moon', latitude: 37.5, longitude: 127, target: { azDeg: 200, elDeg: 30 }, fromMs: Date.parse('2026-11-19T00:00:00Z'), days: 400, epsDeg: 1 });
    const ms = Date.now() - t;
    ok(ms < 2000, `달 400 일 탐색 ${ms} ms < 2000 ms`);
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
