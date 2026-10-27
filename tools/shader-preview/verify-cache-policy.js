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
    CANARY_VARIABLE, canaryPrint, canarySaysSkip, canaryDistinctValues,
    canaryIsUsable, CANARY_MIN_DISTINCT, ringCacheKey, MAX_RING_ENTRIES,
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

  // ── [8] ⚠ 카나리아 — 한 점만 보고 건너뛰어도 되는가 ───────────────
  //
  //    발상: 35점은 같은 모델 런에서 오므로, 한 점이 안 바뀌었으면 나머지도
  //    안 바뀐 것. 원인(런)이 하나이기 때문입니다.
  //
  //    ⚠ 그런데 **변수를 잘못 고르면 조용히 틀립니다.** 여기가 그 판정입니다.
  console.log('\n[8] 카나리아 — 변수 고르기가 판을 가른다');
  {
    // 두 모델 런. 런이 바뀌면 **구름은 먼 곳에서 크게** 달라집니다.
    const runA = {
      obsCloud:  Array(24).fill(0),                                  // 관측점: 맑음
      farCloud:  Array.from({ length: 24 }, (_, h) => (h * 3) % 90),  // 380km 밖: 구름 있음
      obsTemp:   Array.from({ length: 24 }, (_, h) => 18.3 + Math.sin(h / 3.8) * 6.1),
    };
    const runB = {
      obsCloud:  Array(24).fill(0),                                  // ← 관측점은 **여전히 맑음**
      farCloud:  Array.from({ length: 24 }, (_, h) => (h * 7 + 40) % 90), // ← 먼 곳은 **갈렸다**
      obsTemp:   Array.from({ length: 24 }, (_, h) => 18.6 + Math.sin(h / 3.8) * 6.0),
    };

    const farChanged = !unchanged(runA.farCloud, runB.farCloud);
    console.log(`      런 A→B: 관측점 운량 ${unchanged(runA.obsCloud, runB.obsCloud) ? '그대로' : '갈림'}`
              + ` · 380km 밖 운량 ${farChanged ? '갈림' : '그대로'}`
              + ` · 관측점 기온 ${unchanged(runA.obsTemp, runB.obsTemp) ? '그대로' : '갈림'}`);
    ok(farChanged, `이 판에서 먼 곳 구름은 실제로 갈렸다 — 잡아내야 하는 상황이다`);

    // ⚠ **음성 대조 — cloud_cover 를 카나리아로 쓰면 거짓말합니다.**
    const cloudSaysSkip = canarySaysSkip(canaryPrint(runA.obsCloud), runB.obsCloud);
    console.log(`      cloud_cover 를 카나리아로 쓰면 → "${cloudSaysSkip ? '건너뛰어도 됨' : '받아야 함'}"`
              + `  ${cloudSaysSkip ? '← 거짓말! 먼 구름이 갈렸는데 옛 하늘을 그린다' : ''}`);
    ok(cloudSaysSkip,
       `cloud_cover 는 맑은 날 평평해서 **거짓 "안 바뀜"** 을 낸다 — 이래서 못 쓴다`);

    // 연속값은 안 속습니다.
    const tempSaysSkip = canarySaysSkip(canaryPrint(runA.obsTemp), runB.obsTemp);
    console.log(`      ${CANARY_VARIABLE} 를 카나리아로 쓰면 → "${tempSaysSkip ? '건너뛰어도 됨' : '받아야 함'}"`);
    ok(!tempSaysSkip, `연속값(${CANARY_VARIABLE})은 런이 갈리면 반드시 잡는다`);
    ok(CANARY_VARIABLE !== 'cloud_cover', `고른 변수가 cloud_cover 가 아니다`);

    // 런이 **안** 바뀌었으면 건너뛰어야 합니다 — 아니면 아무것도 안 아낍니다.
    ok(canarySaysSkip(canaryPrint(runA.obsTemp), runA.obsTemp.slice()),
       `런이 그대로면 건너뛴다 — 안 그러면 카나리아가 공허하다`);
    // 0.1°C 한 칸만 달라도 잡아야 합니다.
    const nudged = runA.obsTemp.slice(); nudged[13] += 0.1;
    ok(!canarySaysSkip(canaryPrint(runA.obsTemp), nudged), `0.1°C 한 칸도 잡는다`);
  }

  // ── [9] ⚠ 모르면 건너뛰지 않는가 ─────────────────────────────────
  //    여기서 true 로 기울면 첫 실행부터 빈 하늘을 그립니다.
  console.log('\n[9] 카나리아 — 모를 때는 반드시 받는가');
  {
    const series = Array.from({ length: 24 }, (_, h) => 10 + h * 0.3);
    ok(!canarySaysSkip(null, series), `저장된 지문이 없으면 받는다 (첫 실행)`);
    ok(!canarySaysSkip(undefined, series), `undefined 여도 받는다`);
    ok(!canarySaysSkip('', series), `빈 지문이면 받는다`);
    ok(!canarySaysSkip('abc', null), `카나리아 응답이 없으면(네트워크 실패) 받는다`);
    ok(!canarySaysSkip('abc', []), `빈 배열이면 받는다`);
  }

  // ── [10] ⚠ 평평한 카나리아는 스스로 물러나는가 ───────────────────
  //     변수를 잘 골라도 그날 자료가 평평할 수 있습니다(극지방의 기온 등).
  console.log('\n[10] 카나리아가 평평하면 스스로 물러나는가');
  {
    const flat = Array(24).fill(7.0);
    const twoVal = [...Array(12).fill(7.0), ...Array(12).fill(7.1)];
    const rich = Array.from({ length: 24 }, (_, h) => 7 + Math.sin(h / 3) * 4);
    console.log(`      가짓수 — 평평 ${canaryDistinctValues(flat)}`
              + ` · 두 값 ${canaryDistinctValues(twoVal)}`
              + ` · 정상 ${canaryDistinctValues(rich)}  (최소 ${CANARY_MIN_DISTINCT})`);
    ok(!canaryIsUsable(flat), `24시간이 한 값이면 카나리아로 안 쓴다`);
    ok(!canaryIsUsable(twoVal), `두 값뿐이어도 안 쓴다`);
    ok(canaryIsUsable(rich), `값이 고루 있으면 쓴다`);
    ok(!canaryIsUsable(rich.slice(0, 6)), `시각이 너무 적으면 안 쓴다`);
    ok(!canaryIsUsable(null), `응답이 없으면 안 쓴다`);
    // null 이 섞여도 안 깨져야 합니다.
    ok(canaryDistinctValues([1, null, 2, null, 3]) === 3, `null 은 가짓수에서 뺀다`);
  }

  // ── [11] ⚠ 보정된 값과 견주면 안 되는 이유 ───────────────────────
  //     캐시에 든 것은 위성 보정이 발린 뒤일 수 있습니다(applyBiasToPath 가 제자리에서
  //     덮어씀, §166 부터는 호출처가 없어 보류). 보정 세기는 관측 시각을 따라 계속 변합니다.
  console.log('\n[11] 보정된 값이 아니라 원본과 견주는가');
  {
    const raw = Array.from({ length: 24 }, (_, h) => (h * 4) % 80);
    // 같은 예보에 서로 다른 세기의 보정이 발린 두 판.
    const corrected = (bias) => raw.map(v => Math.max(0, Math.min(100, v * bias)));
    const t1 = corrected(0.92), t2 = corrected(0.88);   // 시간이 지나 보정이 달라짐

    console.log(`      예보 원본은 그대로인데, 보정본은 ${unchanged(t1, t2) ? '같음' : '달라짐'}`);
    ok(!unchanged(t1, t2),
       `보정본끼리는 예보가 그대로여도 달라진다 — 이걸로 견주면 늘 "바뀜"`);
    ok(canarySaysSkip(canaryPrint(raw), raw.slice()),
       `원본끼리 견주면 제대로 "안 바뀜" 이 나온다`);
    // 곧, 보정본으로 견줬다면 카나리아가 **한 번도 건너뛰지 못합니다.**
    ok(!canarySaysSkip(canaryPrint(t1), t2),
       `보정본으로 견줬다면 카나리아가 영영 일을 못 한다 — 그래서 원본 지문을 따로 둔다`);
  }

  // ── [12] ⚠ 구름 고리 — 키와 칸 수 ────────────────────────────────
  //
  //    고리 키도 `toFixed(3)` = **111m** 였습니다. §68 이 일몰 날씨를,
  //    §77 이 스토어를 고쳤는데 **고리만 남아 있었습니다** — 같은 부류의
  //    세 번째 자리입니다. 한 칸이 139KB 라 헛되이 다시 받으면 비쌉니다.
  console.log('\n[12] 구름 고리 — 키가 111m 가 아니라 격자 칸인가');
  {
    const D = '2026-09-23';
    for (const m of [111, 500, 2000]) {
      const lon2 = LON + kmToLon(m / 1000, LAT);
      const oldDiffers = LON.toFixed(3) !== lon2.toFixed(3);
      const newSame = ringCacheKey(LAT, LON, D) === ringCacheKey(LAT, lon2, D);
      console.log(`        ${String(m).padStart(4)}m 이동 — 옛 키(111m): ${oldDiffers ? '갈림' : '같음'}`
                + ` · 새 키: ${newSame ? '같음' : '갈림'}`);
    }
    const lon111 = LON + kmToLon(0.111, LAT);
    ok(LON.toFixed(3) !== lon111.toFixed(3),
       `옛 고리 키는 111m 에서 실제로 갈렸다 — 139KB 를 헛되이 다시 받았다`);
    ok(ringCacheKey(LAT, LON, D) === ringCacheKey(LAT, lon111, D),
       `새 고리 키는 111m 에서 같다`);
    ok(ringCacheKey(LAT, LON, D) !== ringCacheKey(LAT, LON + kmToLon(20, LAT), D),
       `20km 떨어지면 갈린다 — 아무거나 뭉치지 않는다`);
    ok(ringCacheKey(LAT, LON, D) !== ringCacheKey(LAT, LON, '2026-09-24'),
       `고리 키는 날짜를 탄다`);
    // 일몰 날씨 키와 **섞이면 안 됩니다** — 자료 모양이 다릅니다.
    ok(ringCacheKey(LAT, LON, D) !== weatherCacheKey(LAT, LON, D),
       `고리 키와 일몰 날씨 키가 안 겹친다 — 섞이면 모양이 다른 자료를 먹인다`);

    // 칸 수 — 실측 139KB 라 10칸이면 1.36MB 입니다.
    const RING_KB = 139;
    console.log(`      고리 한 칸 ${RING_KB}KB(실측) × ${MAX_RING_ENTRIES}칸`
              + ` = ${(RING_KB * MAX_RING_ENTRIES / 1024).toFixed(2)} MB`);
    ok(MAX_RING_ENTRIES < MAX_CACHE_ENTRIES,
       `고리 칸(${MAX_RING_ENTRIES})이 날씨 칸(${MAX_CACHE_ENTRIES})보다 적다 — 2.2배 크다`);
    ok(RING_KB * MAX_RING_ENTRIES / 1024 < 0.5,
       `고리 캐시가 0.5MB 아래다 (${(RING_KB * MAX_RING_ENTRIES / 1024).toFixed(2)} MB)`);
    ok(MAX_RING_ENTRIES >= 2, `그래도 두 자리 이상은 담는다 — 오가는 곳이 하나가 아니다`);
  }

  // §115 — 5km 옮기면 findEntry 가 못 찾아 촬영하기가 맑은 하늘을 그렸습니다(스와 호숫가).
  console.log('\n[§115] 가까운 같은 날 예보로 대신하기');
  {
    const { findNearestEntry } = M;
    const D = '2026-09-27';
    const A = entry(weatherCacheKey(36.0656, 138.0522, D), 36.0656, 138.0522, 0, 'A');       // 5.4km 떨어진 오늘
    const Y = entry(weatherCacheKey(36.0464, 138.109, '2026-09-26'), 36.0464, 138.109, 0, 'Y'); // 바로 여기, 어제
    const S = entry(weatherCacheKey(37.5, 127.0, D), 37.5, 127.0, 0, 'S');                    // 서울 오늘
    const list = [Y, S, A];
    ok(!findEntry(list, 36.0464, 138.109, D), `대조: 5km 옮기면 findEntry 는 오늘 것을 못 찾는다`);
    ok(findNearestEntry(list, 36.0464, 138.109, D)?.data === 'A', `가장 가까운 같은 날 예보를 고른다 — 바로 여기 있는 어제 것이 아니라`);
    ok(findNearestEntry(list, 35.1, 129.0, D) === undefined, `30km 밖(부산에서 서울)은 고르지 않는다`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
