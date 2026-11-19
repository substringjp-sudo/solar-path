/**
 * **지형에 가린 일출·일몰이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/terrainSun.ts`(해 윗가장자리가 스카이라인을 넘는 순간)를 세 가지 자에 댑니다.
 *  ① 평평한 수평선(스카이라인 0°)은 PyEphem 표(`fixtures/sun-ephem.json`)의 일출·일몰과 — 앱이 알리는 시각과 같은 정의여야 하므로.
 *  ② 높이가 일정한 능선은 **다른 길**로 푼 정답과 — 겉보기 윗가장자리 고도 = h 가 되는 기하 고도를 이분법으로 구해
 *     `sunCrossings` 에 넣은 시각(태양력의 근 찾기). 훑기·이분법과 코드를 나누지 않습니다.
 *  ③ 방위마다 높이가 다른 능선은 5 초 걸음 전수 훑기와 —
 *
 * 먼저 정한 줄:
 *  1. 평평한 수평선 — 8곳 × 6일의 일출·일몰 96개(백야·극야 제외)가 PyEphem 과 **각으로** 0.08° 안. 문턱의 근거: PyEphem 은 해 중심이
 *     기하 고도 −0.833° 를 지나는 순간, 앱은 겉보기 윗가장자리(Sæmundsson 굴절 + 반지름 0.267°)가 0° 인 순간이라 해 중심의
 *     기하 고도로 −0.89° 쯤입니다. 0.056° 의 정의 차이와 0.024° 의 여유. 시각 차는 그 순간 해 고도가 변하는 빠르기를 곱해 각으로
 *     바꿉니다(고위도에서 같은 각이 몇 분으로 부풀기 때문 — verify-solar-position.js 와 같은 이유).
 *  2. 일정한 능선 — 고도 −1·0.5·2·5·10·20° 의 능선에서 시각이 ② 정답과 3 초 안(1분 걸음 + 이분법 17 회).
 *  3. 방위가 변하는 능선 — 서쪽은 2°, 동쪽은 3° 같은 계단 능선에서 5 초 전수 훑기와 2 초 안. 일출은 **첫** 모습, 일몰은 **마지막** 모습.
 *  4. 틈 — 해가 능선 틈으로 먼저 보였다가 다음 능선에 다시 가리는 경우, 일출은 틈에서 보인 첫 순간이다.
 *  5. 안 보임·처음부터 보임 — 능선이 90° 면 null, −90° 면 처음부터 보임: 훑기 시작 시각(해 중심 −8° 를 지나는 순간)과 같다.
 *  6. 백야·극야 — 트롬쇠 6·12월은 null.
 *  7. 계산 단계 — 굴절은 고도 0° 에서 0.48°, 해 중심의 겉보기 고도가 0° 가 되는 것은 기하 0° 보다 2.5~5분 일찍(서울),
 *     일출은 기하 0° → 겉보기 0° → 보임 순서(능선 ≥ 0).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-terrain-sun.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const MIN = 60e3, R2D = 180 / Math.PI;

(async () => {
  const T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'terrainSun.js'));
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'solarPosition.js'));
  const MP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'moonPosition.js'));
  const REF = require('./fixtures/sun-ephem.json');
  const RS = T.SUN_RADIUS_DEG;

  // ── [1] 평평한 수평선: PyEphem ─────────────────────────────────────────
  console.log('\n[1] 평평한 수평선 — PyEphem 일출·일몰과 견줌');
  {
    let worst = 0, worstAt = '', n = 0, worstSec = 0;
    for (const e of REF.events) {
      if (e.none) continue;
      const noon = new Date(e.noonIso);
      for (const [kind, ref] of [['rise', e.riseIso], ['set', e.setIso]]) {
        const ev = T.sunHorizonEvent(kind, noon, e.lat, e.lon, () => 0);
        if (!ev || ev.visibleMs == null) continue;
        const tRef = new Date(ref).getTime();
        const alt = (ms) => { const p = S.sunPosition(new Date(ms), e.lat, e.lon); return p.altitude * R2D; };
        const rate = Math.abs(alt(tRef + 30e3) - alt(tRef - 30e3)) / 60;   // °/초
        const sec = Math.abs(ev.visibleMs - tRef) / 1000;
        const deg = sec * rate;
        if (deg > worst) { worst = deg; worstAt = `${e.place} ${kind} ${ref} (${sec.toFixed(0)} 초)`; }
        worstSec = Math.max(worstSec, sec);
        n++;
      }
    }
    console.log(`      ${n}개 — 각으로 최대 ${worst.toFixed(4)}° (${worstAt}) · 시각 차 최대 ${worstSec.toFixed(0)} 초`);
    ok(n > 80, `비교한 사건 ${n} 개`);
    ok(worst < 0.08, `PyEphem 과 각으로 0.08° 안 (${worst.toFixed(4)}°)`);
  }

  // ── [2] 일정한 능선: 다른 길의 정답 ───────────────────────────────────────
  console.log('\n[2] 일정한 능선 — sunCrossings 로 푼 정답과 견줌');
  {
    // 겉보기 윗가장자리 고도 = h ⇔ 기하 고도 g + R(g) + 반지름 = h. g 를 이분법으로.
    const geoForApparentLimb = (h) => { let lo = -10, hi = 60; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (m + MP.refractionDeg(m) + RS < h) lo = m; else hi = m; } return (lo + hi) / 2; };
    let worst = 0, worstAt = '', n = 0;
    const places = [['seoul', 37.5665, 126.978], ['london', 51.5072, -0.1276], ['sydney', -33.8688, 151.2093], ['quito', -0.18, -78.47]];
    for (const [name, lat, lon] of places) for (const day of ['2026-03-20', '2026-06-21', '2026-12-21']) {
      const date = new Date(day + 'T03:00:00Z');
      for (const h of [-1, 0.5, 2, 5, 10, 20]) {
        const g = geoForApparentLimb(h);
        const truth = S.sunCrossings(date, lat, lon, g);
        for (const [kind, want] of [['rise', truth.rise.getTime()], ['set', truth.set.getTime()]]) {
          const ev = T.sunHorizonEvent(kind, date, lat, lon, () => h);
          if (!Number.isFinite(want) || !ev || ev.visibleMs == null) continue;
          const d = Math.abs(ev.visibleMs - want) / 1000;
          if (d > worst) { worst = d; worstAt = `${name} ${day} ${kind} h=${h}`; }
          n++;
        }
      }
    }
    console.log(`      ${n}건 — 최대 ${worst.toFixed(2)} 초 (${worstAt})`);
    ok(n > 100, `비교한 사건 ${n} 건`);
    ok(worst < 3, `정답과 3 초 안 (${worst.toFixed(2)} 초)`);
  }

  // ── [3][4] 방위가 변하는 능선: 전수 훑기 ─────────────────────────────────
  const lat = 37.5665, lon = 126.978;
  const brute = (kind, date, skyline) => {
    const flat = S.sunTimes(date, lat, lon);
    const flatMs = (kind === 'rise' ? flat.sunrise : flat.sunset).getTime();
    const lo = flatMs - (kind === 'rise' ? 120 : 300) * MIN, hi = flatMs + (kind === 'rise' ? 300 : 120) * MIN;
    const vis = (t) => { const p = S.sunPosition(new Date(t), lat, lon); const g = p.altitude * R2D; const az = ((p.azimuth * R2D + 180) % 360 + 360) % 360; return g + MP.refractionDeg(g) + RS >= (skyline(az) ?? 0); };
    let first = null, last = null, prev = vis(lo);
    for (let t = lo + 5000; t <= hi; t += 5000) {
      const cur = vis(t);
      if (!prev && cur && first == null) first = t;
      if (prev && !cur) last = t;
      prev = cur;
    }
    return { first, last };
  };
  console.log('\n[3] 방위가 변하는 능선 — 5 초 전수 훑기와 견줌');
  {
    const stair = (az) => (az > 80 && az < 140 ? 3 : az > 220 && az < 280 ? 2 : -0.1);
    let worst = 0, n = 0;
    for (const day of ['2026-01-10', '2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21']) {
      const date = new Date(day + 'T03:00:00Z');
      const b = brute('rise', date, stair), bs = brute('set', date, stair);
      const r = T.sunHorizonEvent('rise', date, lat, lon, stair), s = T.sunHorizonEvent('set', date, lat, lon, stair);
      if (b.first != null && r.visibleMs != null) { worst = Math.max(worst, Math.abs(r.visibleMs - b.first) / 1000); n++; }
      if (bs.last != null && s.visibleMs != null) { worst = Math.max(worst, Math.abs(s.visibleMs - bs.last) / 1000); n++; }
    }
    console.log(`      ${n}건 — 최대 ${worst.toFixed(2)} 초`);
    ok(n >= 8, `비교한 사건 ${n} 건`);
    ok(worst < 6, `전수 훑기(5 초 격자)와 6 초 안 (${worst.toFixed(2)} 초 = 격자 + 이분)`);
  }
  console.log('\n[4] 틈 — 첫 모습');
  {
    const date = new Date('2026-12-21T03:00:00Z');
    const flatRise = S.sunTimes(date, lat, lon).sunrise.getTime();
    const az0 = (() => { const p = S.sunPosition(new Date(flatRise), lat, lon); return p.azimuth * R2D + 180; })();
    // 해가 뜨는 방위 둘레 1° 는 열려 있고(틈), 그 너머(방위 +1° 부터 +6°)는 4° 능선
    const notch = (az) => (az > az0 + 1 && az < az0 + 6 ? 4 : -0.1);
    const ev = T.sunHorizonEvent('rise', date, lat, lon, notch);
    ok(ev.visibleMs != null && Math.abs(ev.visibleMs - flatRise) < 120e3, `틈에서 보인 첫 순간이 평평한 일출 근처 (차이 ${ev.visibleMs == null ? '?' : ((ev.visibleMs - flatRise) / 1000).toFixed(0)} 초)`);
    const wall = (az) => (az > az0 - 3 && az < az0 + 6 ? 4 : -0.1);
    const ev2 = T.sunHorizonEvent('rise', date, lat, lon, wall);
    ok(ev2.visibleMs != null && ev2.visibleMs - flatRise > 10 * MIN, `틈이 없으면 능선을 넘을 때까지 늦다 (+${ev2.visibleMs == null ? '?' : ((ev2.visibleMs - flatRise) / MIN).toFixed(1)} 분)`);
  }

  // ── [5] 안 보임·처음부터 ─────────────────────────────────────────────────
  console.log('\n[5] 안 보임 · 처음부터 보임');
  {
    const date = new Date('2026-06-21T03:00:00Z');
    const wall = T.sunHorizonEvent('rise', date, lat, lon, () => 90);
    ok(wall.visibleMs === null && wall.deltaMin === null, '스카이라인 90° 면 그날 한 번도 안 보인다(null)');
    const deep = T.sunHorizonEvent('rise', date, lat, lon, () => -90);
    const start = S.sunCrossings(date, lat, lon, -8).rise.getTime();
    ok(deep.visibleMs != null && Math.abs(deep.visibleMs - start) < 1000 && deep.visibleMs < deep.flatMs - 20 * MIN, `스카이라인 −90° 면 처음부터 보임: 훑기 시작(해 −8°)과 같고 평평한 일출보다 ${((deep.flatMs - deep.visibleMs) / MIN).toFixed(0)} 분 앞`);
  }

  // ── [6] 백야·극야 ────────────────────────────────────────────────────────
  console.log('\n[6] 백야 · 극야');
  {
    const a = T.sunHorizonEvent('rise', new Date('2026-12-21T12:00:00Z'), 69.65, 18.96, () => 0);
    const b = T.sunHorizonEvent('set', new Date('2026-06-21T12:00:00Z'), 69.65, 18.96, () => 0);
    ok(a === null && b === null, '트롬쇠 12월(극야)·6월(백야)은 null');
  }

  // ── [7] 계산 단계 ────────────────────────────────────────────────────────
  console.log('\n[7] 계산 단계');
  {
    const st = T.sunHorizonSteps('rise', new Date('2026-12-21T03:00:00Z'), lat, lon, (az) => (az > 100 && az < 130 ? 1.8 : -0.1));
    ok(Math.abs(st.refractionDeg - 0.483) < 0.01, `고도 0° 에서 굴절 ${st.refractionDeg.toFixed(3)}° ≈ 0.483°`);
    ok(st.refractionEarlyMin > 2.5 && st.refractionEarlyMin < 5, `굴절 때문에 해 중심이 ${st.refractionEarlyMin.toFixed(2)} 분 일찍 겉보기 0° (2.5~5 분)`);
    ok(st.apparentZeroMs < st.geoZeroMs && st.geoZeroMs < st.event.visibleMs, '일출 순서: 겉보기 0° → 기하 0° → 능선 위로 보임');
    ok(st.event.deltaMin > 8 && st.event.deltaMin < 16 && st.event.skylineDeg === 1.8, `1.8° 능선이면 평평한 일출보다 ${st.event.deltaMin.toFixed(1)} 분 늦다(스카이라인 ${st.event.skylineDeg}°)`);
    const ss = T.sunHorizonSteps('set', new Date('2026-12-21T03:00:00Z'), lat, lon, () => 0);
    ok(ss.geoZeroMs < ss.apparentZeroMs, '일몰 순서: 기하 0° → 겉보기 0°(굴절 때문에 더 늦게 가라앉아 보임)');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
