/**
 * **디스크 캐시를 언제 믿고 무엇을 다시 받을지** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/cachePolicy.ts` 머리말에 있습니다.
 *
 * ## 이 자가 지키려는 것
 *
 * 1. **지형은 나이를 안 본다** — 산은 안 움직입니다. 여기에 만료가 끼면
 *    근거 없이 요청만 늘어납니다.
 * 2. **날씨는 지나간 시각을 안 받는다** — 그리고 그 절약이 **실제로 있는지**,
 *    자르지 않으면 정말 더 받는지(음성 대조)까지 봅니다.
 * 3. **이어 붙이기가 시각을 어긋내지 않는다** — 짝이 안 맞는 배열은 아예
 *    손대지 않아야 합니다. 여기서 틀리면 값이 조용히 엉뚱한 시각에 붙습니다.
 * 4. **지문이 공허하지 않다** — 값 하나만 바뀌어도 잡아야 하고, 같은 내용이면
 *    반드시 같아야 합니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-cache-policy.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'cachePolicy.js'));
  const {
    weatherCacheKey, terrainCacheKey, findEntry, upsertEntry, needTerrainFetch,
    refetchWindow, localHourIfToday, spliceHourly, fingerprint, unchanged,
    MAX_CACHE_ENTRIES, LOOKUP_TOLERANCE_DEG, GRID_BUCKET_DEG,
  } = M;

  const LAT = 35.3606, LON = 136.1875;   // 사용자가 사진 찍은 곳 근처
  const kmToLon = (km, lat) => km / (111.32 * Math.cos(lat * Math.PI / 180));
  const entry = (key, lat, lon, ts = 0, data = null) =>
    ({ key, latitude: lat, longitude: lon, timestamp: ts, data });

  // ── [1] ⚠ 키가 격자만큼 굵은가 ───────────────────────────────────
  //    옛 스토어 키는 toFixed(4) = 11m 라, 11m 만 움직여도 칸을 새로 먹었습니다.
  console.log('\n[1] 캐시 키 — 11m 가 아니라 격자 칸인가');
  {
    console.log(`      버킷 ${GRID_BUCKET_DEG}° ≈ ${(GRID_BUCKET_DEG * 111.32).toFixed(1)}km`);
    for (const m of [11, 100, 500]) {
      const lon2 = LON + kmToLon(m / 1000, LAT);
      const oldDiffers = LON.toFixed(4) !== lon2.toFixed(4);
      const newSame = weatherCacheKey(LAT, LON, '2026-09-22') === weatherCacheKey(LAT, lon2, '2026-09-22');
      console.log(`        ${String(m).padStart(4)}m 이동 — 옛 키(11m): ${oldDiffers ? '갈림' : '같음'} · 새 키: ${newSame ? '같음' : '갈림'}`);
    }
    const lon11 = LON + kmToLon(0.011, LAT);
    ok(LON.toFixed(4) !== lon11.toFixed(4),
       `옛 키는 11m 에서 실제로 갈렸다 — 고칠 것이 있었다`);
    ok(weatherCacheKey(LAT, LON, '2026-09-22') === weatherCacheKey(LAT, lon11, '2026-09-22'),
       `새 키는 11m 에서 같다 — 칸을 헛되이 안 먹는다`);
    // 그렇다고 아무거나 뭉치면 안 됩니다.
    const lonFar = LON + kmToLon(20, LAT);
    ok(weatherCacheKey(LAT, LON, '2026-09-22') !== weatherCacheKey(LAT, lonFar, '2026-09-22'),
       `20km 떨어지면 키가 갈린다 — 아무거나 뭉치지 않는다`);
    // 날짜가 다르면 갈려야 합니다(날씨는 날짜를 탑니다).
    ok(weatherCacheKey(LAT, LON, '2026-09-22') !== weatherCacheKey(LAT, LON, '2026-09-23'),
       `날씨 키는 날짜를 탄다`);
    // ⚠ 지형 키는 날짜를 타면 안 됩니다 — 그러면 매일 다시 받습니다.
    ok(!terrainCacheKey(LAT, LON).includes('2026'),
       `지형 키에는 날짜가 없다 — 있으면 매일 다시 받는다`);
  }

  // ── [2] ⚠ 지형은 나이를 안 보는가 ────────────────────────────────
  console.log('\n[2] 지형 — 오래돼도 그대로 쓰는가');
  {
    const list = [entry(terrainCacheKey(LAT, LON), LAT, LON, 0)];   // 1970년 것
    ok(!needTerrainFetch(list, LAT, LON),
       `1970년에 받은 지형도 다시 안 받는다 — 산은 안 움직인다`);
    const YEAR = 365 * 24 * 3600_000;
    const old = [entry(terrainCacheKey(LAT, LON), LAT, LON, Date.now() - 10 * YEAR)];
    ok(!needTerrainFetch(old, LAT, LON), `10년 된 지형도 다시 안 받는다`);
    // 그래도 **다른 자리**면 받아야 합니다 — 안 그러면 캐시가 거짓말입니다.
    ok(needTerrainFetch(list, LAT + 1, LON), `자리가 다르면 받는다`);
    ok(needTerrainFetch([], LAT, LON), `캐시가 비면 받는다`);
    // 어림 경계
    const inTol = LAT + LOOKUP_TOLERANCE_DEG * 0.9;
    const outTol = LAT + LOOKUP_TOLERANCE_DEG * 1.1;
    ok(!needTerrainFetch(list, inTol, LON) && needTerrainFetch(list, outTol, LON),
       `어림(${LOOKUP_TOLERANCE_DEG}° ≈ ${(LOOKUP_TOLERANCE_DEG * 111.32).toFixed(1)}km) 경계에서 갈린다`);
  }

  // ── [3] ⚠ 날씨 — 지나간 시각을 안 받는가 ─────────────────────────
  console.log('\n[3] 날씨 다시 받을 창 — 지난 시각을 빼는가');
  {
    const D = '2026-09-22';
    for (const h of [0, 6, 12, 17, 23]) {
      const w = refetchWindow(D, h);
      console.log(`        현지 ${String(h).padStart(2)}시 → ${w.startHour.slice(11)}~${w.endHour.slice(11)}`
                + `  ${String(w.hours).padStart(2)}시간치  (안 받는 몫 ${(w.saved * 100).toFixed(0)}%)`);
    }
    const at17 = refetchWindow(D, 17);
    ok(at17.hours === 7, `17시면 7시간치만 받는다 (17~23시)`);
    ok(at17.startHour === `${D}T17:00`, `지금 시각 자체는 포함한다 — 아직 안 끝났다`);

    // ⚠ **음성 대조** — 안 자르면 정말 더 받는가. 아니면 이 창은 공허합니다.
    const whole = refetchWindow(D, null);
    console.log(`      자를 근거가 없으면(오늘이 아님) → ${whole.hours}시간치 전부`);
    ok(whole.hours === 24, `대상이 오늘이 아니면 하루 전체를 받는다`);
    ok(at17.hours < whole.hours,
       `17시 창(${at17.hours})이 전체(${whole.hours})보다 **실제로 작다** — 절약이 공허하지 않다`);

    // 단조 — 늦을수록 덜 받아야 합니다.
    let mono = true;
    for (let h = 1; h <= 23; h++) if (refetchWindow(D, h).hours > refetchWindow(D, h - 1).hours) mono = false;
    ok(mono, `늦은 시각일수록 받는 양이 줄기만 한다`);

    // 0시에는 절약이 없어야 합니다 — 있다고 하면 거짓말입니다.
    ok(refetchWindow(D, 0).hours === 24 && refetchWindow(D, 0).saved === 0,
       `0시에는 아낄 것이 없다 (24시간치, 절약 0%)`);
    // 23시에도 최소 1시간은 받아야 합니다(빈 요청 금지).
    ok(refetchWindow(D, 23).hours === 1, `23시에도 1시간치는 받는다 — 빈 요청을 안 만든다`);
    // 범위 밖 입력에 안 깨져야 합니다.
    ok(refetchWindow(D, -5).hours === 24 && refetchWindow(D, 99).hours === 1,
       `범위를 벗어난 시각에도 안 깨진다`);
  }

  // ── [4] 오늘인지 가리기 (시간대를 타는가) ────────────────────────
  console.log('\n[4] 대상이 오늘인가 — 시간대를 제대로 타는가');
  {
    // 2026-09-22 15:00 UTC = 도쿄 09-23 00:00, 런던 09-22 16:00
    const ms = Date.UTC(2026, 8, 22, 15, 0);
    const tokyo = localHourIfToday('2026-09-23', ms, 9);
    const london = localHourIfToday('2026-09-22', ms, 1);
    console.log(`      UTC 09-22 15:00 → 도쿄(+9) 09-23 ${tokyo}시 · 런던(+1) 09-22 ${london}시`);
    ok(tokyo === 0, `도쿄에서는 이미 09-23 0시다`);
    ok(london === 16, `런던에서는 아직 09-22 16시다`);
    ok(localHourIfToday('2026-09-22', ms, 9) === null,
       `도쿄에서 09-22 는 이미 어제 — 자를 근거가 없으니 null`);
    ok(localHourIfToday('2026-09-25', ms, 9) === null, `미래 날짜도 null`);
  }

  // ── [5] ⚠ 이어 붙이기가 시각을 어긋내지 않는가 ───────────────────
  //    여기서 틀리면 값이 조용히 엉뚱한 시각에 붙습니다 — 가장 나쁜 실패입니다.
  console.log('\n[5] 이어 붙이기');
  {
    const T = h => `2026-09-22T${String(h).padStart(2, '0')}:00`;
    const cached = {
      time: Array.from({ length: 24 }, (_, h) => T(h)),
      low: Array.from({ length: 24 }, (_, h) => h),
      mid: Array.from({ length: 24 }, () => 50),
    };
    const fresh = { time: [T(20), T(21), T(22), T(23)], low: [900, 901, 902, 903] };
    const merged = spliceHourly(cached, fresh);

    ok(merged.low.slice(0, 20).every((v, i) => v === i), `지난 0~19시는 캐시 값 그대로다`);
    ok(merged.low.slice(20).join() === '900,901,902,903', `20~23시는 새 값으로 덮인다`);
    ok(merged.time.length === 24 && merged.low.length === 24, `길이가 안 변한다`);
    ok(merged.mid.every(v => v === 50), `새로 안 받은 변수는 안 건드린다`);

    // ⚠ 순서가 뒤섞여 와도 **시각으로** 붙어야 합니다(위치로 붙이면 안 됨).
    const shuffled = { time: [T(23), T(20), T(22), T(21)], low: [993, 990, 992, 991] };
    const m2 = spliceHourly(cached, shuffled);
    ok(m2.low[20] === 990 && m2.low[21] === 991 && m2.low[22] === 992 && m2.low[23] === 993,
       `순서가 뒤섞여 와도 시각에 맞춰 붙는다 — 위치로 붙이지 않는다`);

    // ⚠ 짝이 안 맞으면 **아예 손대지 않아야** 합니다.
    const ragged = { time: [T(20), T(21)], low: [1, 2, 3, 4, 5] };
    const m3 = spliceHourly(cached, ragged);
    ok(m3.low.every((v, i) => v === i), `길이가 안 맞는 배열은 통째로 무시한다 — 반쯤 섞지 않는다`);

    // 캐시에 없는 시각은 새로 만들지 않습니다(배열 길이가 늘면 시각과 어긋납니다).
    const outside = { time: ['2026-09-23T05:00'], low: [777] };
    const m4 = spliceHourly(cached, outside);
    ok(m4.low.length === 24 && !m4.low.includes(777), `캐시에 없는 시각은 안 붙인다`);
  }

  // ── [6] ⚠ 지문이 공허하지 않은가 ─────────────────────────────────
  console.log('\n[6] 지문 — 바뀐 것을 실제로 잡는가');
  {
    const base = { time: ['a', 'b'], low: [10, 20], mid: [1, 2] };
    ok(unchanged(base, JSON.parse(JSON.stringify(base))), `같은 내용이면 같은 지문`);

    // ⚠ **음성 대조** — 값 하나만 바뀌어도 잡아야 합니다.
    const off = { ...base, low: [10, 21] };
    ok(!unchanged(base, off), `값 하나(20→21)만 달라도 다른 지문 — 지문이 공허하지 않다`);
    ok(!unchanged(base, { ...base, low: [10, 20.0001] }), `소수점 넷째 자리도 잡는다`);
    ok(!unchanged(base, { ...base, mid: [2, 1] }), `순서가 바뀌면 다른 지문`);
    ok(!unchanged(base, { ...base, extra: [0] }), `필드가 늘면 다른 지문`);

    // 키 적는 순서는 영향이 없어야 합니다(같은 내용인데 다르다고 하면 헛요청).
    ok(unchanged({ a: 1, b: 2 }, { b: 2, a: 1 }), `키 순서는 지문에 영향이 없다`);
    // null 과 0 을 구별해야 합니다 — 예보에서 뜻이 다릅니다.
    ok(!unchanged({ v: [null] }, { v: [0] }), `null 과 0 을 구별한다`);

    // 충돌률 — 실제 크기(35점×24시간)에서 서로 다른 1,000판이 다 달라야 합니다.
    //
    // ⚠ 처음에 값을 `% 101` 로 만들어 **판이 101개밖에 없었습니다.** 지문은
    //   101개를 101개로 정확히 갈랐는데 자가 "1,000 중 101" 이라며 불합격을
    //   줬습니다. 틀린 건 지문이 아니라 제 시험 자료였습니다. 판이 정말로
    //   1,000개 다른지 **먼저 확인**하고 셉니다.
    const mk = n => Array.from({ length: 35 }, (_, p) => ({
      distance: p,
      hourly: { low: Array.from({ length: 24 }, (_, h) => (h * 7 + p * 3 + n * 131) % 100000) },
    }));
    const bodies = new Set(), seen = new Set();
    for (let n = 0; n < 1000; n++) {
      bodies.add(JSON.stringify(mk(n)));
      seen.add(fingerprint(mk(n)));
    }
    console.log(`      만든 판 ${bodies.size}개(서로 다름) → 서로 다른 지문 ${seen.size}개`);
    ok(bodies.size === 1000, `시험 자료가 정말 1,000판 다 다르다 — 자부터 확인한다`);
    ok(seen.size === bodies.size, `서로 다른 판은 모두 다른 지문 — 충돌 0`);

    // 그리고 **같은 판은 반드시 같아야** 합니다(안 그러면 매번 헛요청).
    let stable = true;
    for (let n = 0; n < 200; n++) if (fingerprint(mk(n)) !== fingerprint(mk(n))) stable = false;
    ok(stable, `같은 판은 몇 번 재도 같은 지문`);
  }

  // ── [7] 칸 관리 ──────────────────────────────────────────────────
  console.log('\n[7] 캐시 칸');
  {
    let list = [];
    for (let i = 0; i < 15; i++) list = upsertEntry(list, entry(`k${i}`, LAT, LON, i));
    ok(list.length === MAX_CACHE_ENTRIES, `칸 수를 지킨다 (${list.length}/${MAX_CACHE_ENTRIES})`);
    ok(list[0].key === 'k14', `가장 새것이 앞에 온다`);
    // 같은 키는 칸을 더 먹지 않고 갱신돼야 합니다.
    const before = list.length;
    list = upsertEntry(list, entry('k14', LAT, LON, 999));
    ok(list.length === before && list[0].timestamp === 999,
       `같은 키는 칸을 더 안 먹고 값만 갱신된다`);
    ok(list.filter(e => e.key === 'k14').length === 1, `중복이 안 남는다`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
