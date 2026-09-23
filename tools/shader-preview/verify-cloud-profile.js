/**
 * **구름이 있는 높이를 단면에서 뽑는가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 결함: 앱이 층 높이를 `{low:1.5, mid:4.5, high:10.0}` km 로 박아 씁니다.
 * Open-Meteo 는 16개 기압면에 운량과 실제 고도를 주는데도요.
 *
 * 사용: node tools/shader-preview/verify-cloud-profile.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

/** 시간별 묶음을 흉내 냅니다. levels = [[hPa, 고도m, 운량%], …] */
const mkHourly = (levels) => {
  const h = { time: ['t0'] };
  for (const [p, z, c] of levels) {
    h[`cloud_cover_${p}hPa`] = [c];
    h[`geopotential_height_${p}hPa`] = [z];
  }
  return h;
};

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'cloudProfile.js'));
  const { extractProfile, layerAltitudes, lowDeck, lclKm, FALLBACK_ALT_KM } = M;

  console.log('\n[1] 실기에서 본 그대로 — 상층운이 9,652m 인데 앱은 10,000m 에 그렸다');
  {
    // 도곡동 실측(icon): 300hPa 만 11%, 나머지 0
    const lv = extractProfile(mkHourly([
      [1000, 185, 0], [850, 1562, 0], [700, 3167, 0], [500, 5852, 0],
      [400, 7556, 0], [300, 9652, 11], [200, 12400, 0], [100, 16679, 0],
    ]), 0);
    ok(lv.length === 8, `8개 면을 읽었다 (${lv.length})`);
    const a = layerAltitudes(lv);
    ok(near(a.highKm, 9.652, 0.001), `상층 높이가 **9.652km** 로 나온다 (박아 둔 ${FALLBACK_ALT_KM.high}km 가 아니라)`);
    ok(a.highFromProfile === true, '상층은 단면에서 나왔다고 표시한다');
    ok(near(a.lowKm, FALLBACK_ALT_KM.low) && a.lowFromProfile === false,
       '구름 없는 저층은 예전 상수로 물러난다 — 그릴 게 없으니 높이도 뜻이 없다');
    ok(near(a.midKm, FALLBACK_ALT_KM.mid) && a.midFromProfile === false, '중층도 마찬가지');
  }

  console.log('\n[2] 같은 "상층운" 이라도 높이가 달라진다  ← 박아 두면 못 담는 것');
  {
    const low = layerAltitudes(extractProfile(mkHourly([[400, 7556, 80], [300, 9652, 0], [200, 12400, 0]]), 0));
    const high = layerAltitudes(extractProfile(mkHourly([[400, 7556, 0], [300, 9652, 0], [200, 12400, 80]]), 0));
    console.log(`      400hPa 에 있을 때 ${low.highKm.toFixed(2)}km · 200hPa 에 있을 때 ${high.highKm.toFixed(2)}km`);
    ok(near(low.highKm, 7.556, 0.001) && near(high.highKm, 12.4, 0.001), '각각 제 높이로 나온다');
    ok(Math.abs(high.highKm - low.highKm) > 4.8,
       `둘의 차이가 ${(high.highKm - low.highKm).toFixed(2)}km — 상수 하나로는 못 담는다`);
  }

  console.log('\n[3] 운량으로 가중한다 (단순 평균이 아니다)');
  {
    // 같은 밴드에 두 면: 8km 에 90%, 12km 에 10% → 8km 쪽으로 쏠려야
    const a = layerAltitudes(extractProfile(mkHourly([[400, 8000, 90], [200, 12000, 10]]), 0));
    const plainMean = 10.0;
    console.log(`      가중 ${a.highKm.toFixed(2)}km · 단순평균이면 ${plainMean.toFixed(2)}km`);
    ok(near(a.highKm, 8.4, 0.01), `구름이 많은 쪽으로 쏠린다 (${a.highKm.toFixed(2)}km)`);
    ok(Math.abs(a.highKm - plainMean) > 1.5, '단순 평균과 뚜렷이 다르다 — 가중이 실제로 걸린다');
  }

  console.log('\n[4] 층 경계 (높이로 가른다)');
  {
    const a = layerAltitudes(extractProfile(mkHourly([
      [925, 800, 50],    // 저층
      [700, 3200, 50],   // 중층
      [300, 9600, 50],   // 상층
    ]), 0));
    ok(near(a.lowKm, 0.8, 0.001) && a.lowFromProfile, `저층 ${a.lowKm.toFixed(2)}km`);
    ok(near(a.midKm, 3.2, 0.001) && a.midFromProfile, `중층 ${a.midKm.toFixed(2)}km`);
    ok(near(a.highKm, 9.6, 0.001) && a.highFromProfile, `상층 ${a.highKm.toFixed(2)}km`);
  }

  console.log('\n[5] 자료가 모자라면 조용히 죽지 않는다');
  {
    ok(extractProfile(null, 0).length === 0, 'null → 빈 단면');
    ok(extractProfile({}, 0).length === 0, '빈 묶음 → 빈 단면');
    const a = layerAltitudes([]);
    ok(near(a.lowKm, FALLBACK_ALT_KM.low) && near(a.midKm, FALLBACK_ALT_KM.mid) && near(a.highKm, FALLBACK_ALT_KM.high),
       '빈 단면 → 세 층 모두 예전 상수');
    ok(!a.lowFromProfile && !a.midFromProfile && !a.highFromProfile, '전부 "단면 아님" 으로 표시한다');
    // 고도는 있는데 운량이 null 인 면은 버린다
    const partial = extractProfile({ time:['t'], cloud_cover_300hPa:[null], geopotential_height_300hPa:[9600] }, 0);
    ok(partial.length === 0, '운량이 null 인 면은 안 쓴다');
  }

  console.log('\n[6] 이슬점 → 적운 밑면(LCL)');
  {
    ok(near(lclKm(23.2, 12.2), 1.375, 0.001), `실기 값(23.2/12.2) → ${lclKm(23.2,12.2).toFixed(3)}km`);
    ok(lclKm(20, 19) < 0.2, `습하면 낮다 (${lclKm(20,19).toFixed(3)}km)`);
    ok(lclKm(35, 5) > 3.5, `건조하면 높다 (${lclKm(35,5).toFixed(3)}km)`);
    ok(lclKm(15, 16) === 0, '포화(이슬점이 기온보다 높음)면 0 — 안개');
    ok(lclKm(null, 12) === null && lclKm(20, undefined) === null, '값이 없으면 null');
  }

  console.log('\n[7] 저층 덱의 밑면·윗면 (§82 — 운해의 윗면)');
  {
    // 실측 단면(2026-09-23 09시, 36.0°N 127.8°E, best_match) — 얇은 층운.
    const real = extractProfile(mkHourly([
      [1000, 157, 0], [975, 373, 0], [950, 598, 27], [925, 834, 46], [900, 1059, 6],
      [850, 1549, 0], [800, 2059, 0], [750, 2594, 0], [700, 3168, 0],
    ]), 0);
    const d = lowDeck(real);
    const a = layerAltitudes(real);
    ok(d && near(d.baseKm, (373 + 598) / 2000, 0.001) && near(d.topKm, (834 + 1059) / 2000, 0.001),
       `실측: 밑면 ${d && d.baseKm.toFixed(3)} · 윗면 ${d && d.topKm.toFixed(3)}km (950·925hPa 가 반값 이상, 900hPa 6% 는 아님)`);
    // ⚠ 예전 판(가중 평균 + 1.6km)이면 윗면이 얼마였나 — 이게 고친 이유입니다.
    const legacyTop = a.lowKm + 1.6;
    ok(legacyTop - d.topKm > 1.2,
       `예전 판의 윗면 ${legacyTop.toFixed(2)}km 보다 ${(legacyTop - d.topKm).toFixed(2)}km 낮다 — 1,600m 산은 덱 **위**다`);
    ok(d.topKm < 1.6 && legacyTop > 1.6, '1,600m 관측자: 새 윗면으로는 위, 예전 판으로는 속');

    // 반값 경계 — 봉우리 60 이면 30 은 들고 29 는 뺀다
    const mk = (c950, c925, c900) => lowDeck(extractProfile(mkHourly([
      [975, 400, 0], [950, 600, c950], [925, 800, c925], [900, 1000, c900], [850, 1500, 0],
    ]), 0));
    ok(near(mk(0, 60, 30).topKm, 1.25, 1e-9), '봉우리의 절반(30/60)인 면은 덱에 든다');
    ok(near(mk(0, 60, 29).topKm, 0.9, 1e-9), '절반 미만(29/60)인 면은 안 든다');

    // 윗면이 저층 밴드(2km)를 넘어도 이어진다 — 층적운 윗면 2.2km
    const sc = lowDeck(extractProfile(mkHourly([
      [925, 800, 10], [850, 1500, 80], [800, 2050, 70], [750, 2600, 0],
    ]), 0));
    ok(near(sc.topKm, (2050 + 2600) / 2000, 1e-9), `윗면이 2km 밴드를 넘어 ${sc.topKm.toFixed(3)}km — 봉우리만 밴드 안`);

    // 봉우리가 밴드 밖(중층)뿐이면 저층 덱은 없다
    ok(lowDeck(extractProfile(mkHourly([[850, 1500, 0], [700, 3100, 90]]), 0)) === null,
       '저층이 비고 중층만 있으면 null — 중층을 운해로 착각하지 않는다');
    ok(lowDeck([]) === null, '빈 단면 → null');

    // 가장자리 면 — 이웃이 없으면 반 간격(125m)으로
    const edge = lowDeck(extractProfile(mkHourly([[1000, 150, 80], [975, 370, 0]]), 0));
    ok(near(edge.baseKm, 0.025, 1e-9) && near(edge.topKm, 0.26, 1e-9),
       `맨 아래 면이 흐리면 밑면 = 그 면 − 125m (${edge.baseKm.toFixed(3)}) — 안개에 가깝다`);

    // 정렬이 뒤섞여 들어와도 같은 답
    const shuffled = [...real].reverse();
    const d2 = lowDeck(shuffled);
    ok(near(d2.topKm, d.topKm, 1e-12) && near(d2.baseKm, d.baseKm, 1e-12), '면 순서가 뒤집혀 와도 같다');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
