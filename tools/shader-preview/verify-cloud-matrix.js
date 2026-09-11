/**
 * **구름 격자가 실제 자료에서 나오는가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * ## 무엇을 고쳤길래 이 자가 필요한가
 *
 * 예전 `computeCloudCellData` 는 운량·구름종류·풍속·풍향을 **위경도 해시**에서
 * 냈습니다(`Math.sin(lat*12.9898 + lon*78.233 + …)`). 날씨를 받는 경로가 아예
 * 없었는데 화면에는 "웅장한 적란운"·"희귀 렌즈구름" 이 떴습니다.
 *
 * ## 이 자의 핵심 판정
 *
 * **같은 날씨면 어디서든 같은 답이 나와야 합니다.** 해시는 좌표가 바뀌면 값이
 * 바뀌므로 이 한 줄을 절대 통과할 수 없습니다. 그래서 이것이 "해시가 정말
 * 없어졌는가" 를 재는 자입니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-cloud-matrix.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'cloudMatrix.js'));
  const { classifyCloud, buildCloudCells, generate29GridPoints, RADIAL_GRID_DEFINITIONS } = M;

  // ── [1] 구름 종류를 물리로 가리는가 ────────────────────────────────
  console.log('\n[1] 층별 운량·강수 → 구름 종류');
  {
    const cb = classifyCloud({ low: 80, mid: 70, high: 60, precipitationMm: 6 });
    console.log(`      저80 중70 상60 비6mm  → ${cb.name}`);
    ok(cb.type === 'cumulonimbus' && cb.isSpecial, `깊은 대류 + 센 비 → 적란운`);

    const ns = classifyCloud({ low: 90, mid: 60, high: 10, precipitationMm: 1 });
    console.log(`      저90 중60 상10 비1mm  → ${ns.name}`);
    ok(ns.type === 'stratus', `약한 비 → 비구름`);

    const ci = classifyCloud({ low: 5, mid: 10, high: 70 });
    console.log(`      저 5 중10 상70 비없음 → ${ci.name}`);
    ok(ci.type === 'cirrus', `상층 우세 → 털구름`);

    const st = classifyCloud({ low: 85, mid: 10, high: 5 });
    console.log(`      저85 중10 상 5 비없음 → ${st.name}`);
    ok(st.type === 'stratus', `저층이 덮고 위가 빔 → 층운`);

    const cu = classifyCloud({ low: 30, mid: 25, high: 10 });
    console.log(`      저30 중25 상10 비없음 → ${cu.name}`);
    ok(cu.type === 'fair_cumulus', `그 밖 → 뭉게구름`);

    const clear = classifyCloud({ low: 0, mid: 0, high: 0 });
    ok(clear.type === 'fair_cumulus' && !clear.isSpecial, `맑으면 특별 구름이 아니다`);
  }

  // ── [2] ⚠ 못 가리는 것은 안 말하는가 ──────────────────────────────
  console.log('\n[2] 렌즈구름을 함부로 말하지 않는가');
  {
    let emitted = 0, n = 0;
    for (let lo = 0; lo <= 100; lo += 5)
      for (let mi = 0; mi <= 100; mi += 5)
        for (let hi = 0; hi <= 100; hi += 20)
          for (const p of [0, 0.5, 3, 12]) {
            const c = classifyCloud({ low: lo, mid: mi, high: hi, precipitationMm: p });
            if (c.type === 'lenticularis') emitted++;
            n++;
          }
    console.log(`      ${n}가지 조합에서 렌즈구름이 나온 횟수: ${emitted}`);
    ok(emitted === 0, `산악파를 못 재므로 렌즈구름이라 안 한다 (예전엔 seed>0.62 면 그렇게 불렀다)`);
  }

  // ── [3] ⚠⚠ 해시가 정말 없어졌는가 ─────────────────────────────────
  //    같은 날씨라면 좌표가 달라도 같은 답이어야 합니다.
  console.log('\n[3] 해시가 없어졌는가 — 같은 날씨면 어디서든 같은 답');
  {
    const weather = () => ({ low: 55, mid: 20, high: 15, total: 62, precipitationMm: 0 });
    const places = [[37.4863, 127.0443], [-33.87, 151.21], [64.15, -21.94], [0.0, 0.0]];
    const covers = [], types = [];
    for (const [la, lo] of places) {
      const cells = buildCloudCells(generate29GridPoints(la, lo), weather, { speedKmh: 20, bearingDeg: 270 });
      covers.push(cells[0].cloudCover);
      types.push(cells[0].cloudType);
    }
    console.log(`      네 곳의 운량: ${covers.join(' · ')}`);
    console.log(`      네 곳의 종류: ${types.join(' · ')}`);
    ok(new Set(covers).size === 1, `같은 날씨면 좌표가 달라도 운량이 같다 — 해시라면 여기서 갈린다`);
    ok(new Set(types).size === 1, `종류도 같다`);

    // 그리고 **날씨가 바뀌면** 답이 바뀌어야 합니다(양방향 대조).
    const a = buildCloudCells(generate29GridPoints(37.4863, 127.0443),
      () => ({ low: 10, mid: 5, high: 60, total: 62 }), null)[0];
    const b = buildCloudCells(generate29GridPoints(37.4863, 127.0443),
      () => ({ low: 90, mid: 10, high: 0, total: 92 }), null)[0];
    console.log(`      같은 자리, 다른 날씨: ${a.cloudName} (${a.cloudCover}) vs ${b.cloudName} (${b.cloudCover})`);
    ok(a.cloudType !== b.cloudType && a.cloudCover !== b.cloudCover,
       `같은 자리라도 날씨가 다르면 답이 다르다 — 상수로 굳지도 않았다`);
  }

  // ── [4] 자료가 방향을 실제로 나르는가 ─────────────────────────────
  console.log('\n[4] 방향이 있는 하늘을 그대로 나르는가');
  {
    // 동쪽만 흐린 하늘.
    const sample = (brg) => {
      const east = Math.sin(brg * Math.PI / 180);
      const total = Math.max(0, Math.min(100, 50 + 45 * east));
      return { low: total, mid: 0, high: 0, total, precipitationMm: 0 };
    };
    const cells = buildCloudCells(generate29GridPoints(37.4863, 127.0443), sample, null);
    const east = cells.filter(c => c.bearingDeg > 45 && c.bearingDeg < 135);
    const west = cells.filter(c => c.bearingDeg > 225 && c.bearingDeg < 315);
    const avg = a => a.reduce((s, c) => s + c.cloudCover, 0) / a.length;
    console.log(`      동쪽 ${avg(east).toFixed(2)} · 서쪽 ${avg(west).toFixed(2)}`);
    ok(avg(east) > avg(west) + 0.4, `동쪽이 흐린 하늘이 동쪽으로 나온다`);
  }

  // ── [5] 바람을 칸마다 지어내지 않는가 ─────────────────────────────
  console.log('\n[5] 바람');
  {
    const cells = buildCloudCells(generate29GridPoints(37.4863, 127.0443),
      () => ({ low: 40, mid: 10, high: 10, total: 45 }), { speedKmh: 33, bearingDeg: 118 });
    const dirs = new Set(cells.map(c => c.windBearingDeg));
    const spds = new Set(cells.map(c => c.windSpeedKmh));
    console.log(`      칸 ${cells.length}개 — 서로 다른 풍향 ${dirs.size}가지 · 풍속 ${spds.size}가지`);
    ok(dirs.size === 1 && spds.size === 1,
       `칸마다 다른 바람을 지어내지 않는다 (관측점 값 하나뿐이므로)`);
    ok(cells[0].windBearingDeg === 118 && cells[0].windSpeedKmh === 33, `준 값을 그대로 쓴다`);

    const none = buildCloudCells(generate29GridPoints(0, 0),
      () => ({ low: 0, mid: 0, high: 0, total: 0 }), null);
    ok(none[0].windSpeedKmh === 0, `바람 자료가 없으면 0 — 있는 척하지 않는다`);
  }

  // ── [6] 자료 없는 칸은 버리는가 ───────────────────────────────────
  console.log('\n[6] 자료 없는 칸');
  {
    const cells = buildCloudCells(generate29GridPoints(37.4863, 127.0443),
      (brg, dist) => (dist > 100 ? null : { low: 50, mid: 0, high: 0, total: 50 }), null);
    const far = cells.filter(c => c.distanceKm > 100);
    console.log(`      100km 밖을 null 로 주면 → 만들어진 칸 ${cells.length}개, 그중 100km 밖 ${far.length}개`);
    ok(far.length === 0, `자료가 없는 칸은 안 만든다`);
    ok(cells.length > 0, `자료가 있는 칸은 만든다`);
  }

  // ── [7] 격자 ──────────────────────────────────────────────────────
  console.log('\n[7] 29점 격자');
  {
    const g = generate29GridPoints(37.4863, 127.0443);
    const want = 1 + RADIAL_GRID_DEFINITIONS.slice(1).reduce((s, d) => s + d.count, 0);
    console.log(`      ${g.length}점 (정의상 ${want}점)`);
    ok(g.length === want, `정의한 수와 같다`);
    ok(g[0].distanceKm === 0, `첫 점이 관측점`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
