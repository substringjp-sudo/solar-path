/**
 * **캐시 키가 날씨 격자만큼 굵은가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 결함: 키가 `lat.toFixed(3)` — 111m 였습니다. 날씨 격자는 한국 5.6km,
 * 가장 촘촘한 곳(미국)이 2.3km 입니다. 같은 칸 안에서 111m 만 움직여도
 * 36점을 통째로 다시 받았고, 왕복 한 번이 514~640ms 였습니다.
 *
 * 실기로 잰 것: 도곡동에서 동쪽으로 12km 를 옮겨도 값이 **같았습니다.**
 *
 * 사용: node tools/shader-preview/verify-weather-cache-key.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

/** 위도 37.5 에서 동쪽으로 km 만큼 간 경도 차(도). */
const kmToLonDeg = (km, lat) => km / (111.32 * Math.cos(lat * Math.PI / 180));
const kmToLatDeg = (km) => km / 111.32;

(async () => {
  const { gridBucket, sameBucket, GRID_BUCKET_DEG } = await import(
    'file://' + path.join(PREVIEW, 'app', 'utils', 'weatherCacheKey.js'));

  const LAT = 37.4863, LON = 127.0443;

  console.log(`\n[1] 버킷 크기 (${GRID_BUCKET_DEG}° ≈ ${(GRID_BUCKET_DEG*111.32).toFixed(1)}km 위도)`);
  {
    ok(GRID_BUCKET_DEG > 0.005, `111m(0.001°)보다 굵다 — 그게 결함이었다`);
    ok(GRID_BUCKET_DEG * 111.32 < 2.3,
       `가장 촘촘한 격자(캔자스 2.3km)보다 **아래**다 (${(GRID_BUCKET_DEG*111.32).toFixed(2)}km) — 자료를 안 잃는다`);
  }

  console.log('\n[2] 옛 키가 갈라내던 거리에서 이제 같은 칸이 된다');
  {
    for (const m of [50, 111, 300, 800]) {
      const lon2 = LON + kmToLonDeg(m / 1000, LAT);
      const oldSame = LAT.toFixed(3) === LAT.toFixed(3) && LON.toFixed(3) === lon2.toFixed(3);
      const newSame = sameBucket(LAT, LON, LAT, lon2);
      console.log(`      ${String(m).padStart(4)}m 동쪽 → 옛 키 ${oldSame ? '같음' : '**다름(재요청)**'} · 새 키 ${newSame ? '같음' : '다름'}`);
    }
    // ⚠ **한 점만 보고 "같은 칸" 이라 단언하면 안 됩니다.** 반올림 버킷은
    //   경계 효과가 있어 경계 바로 옆이면 1m 도 갈립니다. 처음에 "500m 북쪽도
    //   같은 칸" 이라고 썼다가 판정이 걸렸는데, **자가 틀린 것**이었습니다.
    //   성립하는 것은 분포입니다 — 가까운 점의 **몇 할이** 같은 칸인가.
    const shareRate = (km) => {
      let same = 0, n = 0;
      for (let i = 0; i < 400; i++) {
        const la = LAT + (i % 20 - 10) * 0.004;        // 여러 출발점에서
        const lo = LON + (Math.floor(i / 20) - 10) * 0.004;
        if (sameBucket(la, lo, la + kmToLatDeg(km), lo)) same++;
        n++;
      }
      return same / n;
    };
    for (const km of [0.111, 0.3, 0.5, 1.0]) {
      console.log(`      ${String(km * 1000).padStart(5)}m 북쪽 → 같은 칸인 비율 ${(shareRate(km) * 100).toFixed(0)}%`);
    }
    ok(shareRate(0.111) > 0.9, `111m 옆은 거의 늘 같은 칸이다 (${(shareRate(0.111)*100).toFixed(0)}%) — 옛 키는 **늘** 갈라져 다시 받았다`);
    ok(shareRate(0.5) > 0.6, `500m 옆도 대체로 같은 칸이다 (${(shareRate(0.5)*100).toFixed(0)}%)`);
    ok(shareRate(1.0) < shareRate(0.3), '멀수록 같은 칸일 확률이 준다 — 버킷이 실제로 자른다');
  }

  console.log('\n[3] 격자만큼 멀어지면 갈라진다 (무한정 뭉치지 않는다)');
  {
    ok(!sameBucket(LAT, LON, LAT + kmToLatDeg(5), LON), '5km 북쪽은 다른 칸');
    ok(!sameBucket(LAT, LON, LAT, LON + kmToLonDeg(5, LAT)), '5km 동쪽도 다른 칸');
  }

  console.log('\n[4] 같은 칸이면 **문자열이 같다** (키로 쓸 수 있다)');
  {
    const a = gridBucket(37.4863, 127.0443);
    const b = gridBucket(37.4871, 127.0449);
    ok(a === b, `${a} === ${b}`);
    ok(typeof a === 'string' && a.includes(','), `모양이 키로 쓸 만하다 (${a})`);
  }

  console.log('\n[5] 0 과 -0, 그리고 못 쓰는 값');
  {
    ok(gridBucket(0, 0) === gridBucket(-0, -0), '0 과 -0 이 같은 키다 — 안 그러면 적도·본초자오선에서 캐시가 둘로 갈린다');
    ok(gridBucket(NaN, 127) === 'na' && gridBucket(37, undefined) === 'na', '수가 아니면 "na"');
    ok(gridBucket(Infinity, 0) === 'na', '무한대도 "na"');
  }

  console.log('\n[6] 남·서반구에서도 갈린다');
  {
    ok(!sameBucket(-33.8688, 151.2093, -33.8688 - kmToLatDeg(5), 151.2093), '시드니에서 5km 남쪽은 다른 칸');
    // 여기서도 한 점을 못 박지 않습니다 — 경계 효과 때문입니다.
    let same = 0;
    for (let i = 0; i < 100; i++) {
      const la = -33.8688 + (i - 50) * 0.003;
      if (sameBucket(la, 151.2093, la - kmToLatDeg(0.3), 151.2093)) same++;
    }
    ok(same > 70, `시드니에서도 300m 는 대체로 같은 칸 (${same}/100)`);
    ok(!sameBucket(38.5, -98.0, 38.5, -98.0 - kmToLonDeg(5, 38.5)), '캔자스에서 서쪽 5km 는 다른 칸');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
