/**
 * **모델 섞기** 합격 판정. 브라우저가 필요 없습니다 — 순수 논리입니다.
 *
 * 고치려는 것(§56): 앱이 `models=` 를 안 붙여 `best_match` 를 받고 있었고,
 * 그것이 **짙게 흐린 하늘에서 τ 를 +34 만큼 맑은 쪽으로** 틀렸습니다.
 * ecmwf+icon 을 섞으면 +10.3 으로 줄어듭니다.
 *
 * 이 판정이 지키는 것 넷:
 *   1. 접미사(`_ecmwf_ifs025`)를 떼고 접미사 없는 이름으로 되돌리는가.
 *   2. **`best_match` 가 평균에 안 들어가는가.** 넣으면 짙은 흐림 편향이
 *      +10.3 → +18.1 로 되레 나빠지므로 이건 성능이 아니라 **정확성** 문제입니다.
 *   3. 한 모델이 그 시각에만 null 이면 나머지로 내고, 전부 null 이면 null 로
 *      두는가. **0 으로 메우면 "구름 없음" 이라고 거짓말합니다.**
 *   4. 둘 다 아예 안 주는 변수를 `FILL_MODEL` 로 메우는가 — 지금 큰 요청에는
 *      best_match 를 안 붙이므로(호출 수) 이 길은 안 쓰입니다. 논리 자체는
 *      맞고 나중에 다시 붙일 수 있으므로 판정을 남겨 둡니다. 시정은 지금
 *      `fetchLayerWinds` 의 관측점 1점 요청에서 받습니다.
 *
 * 사용: node tools/shader-preview/verify-model-blend.js
 *      (stage-esm.js 를 먼저 돌려야 합니다 — 앱 모듈을 임포트합니다)
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, tol = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= tol;

(async () => {
  const mod = await import(
    'file://' + path.join(PREVIEW, 'app', 'utils', 'modelBlend.js'));
  const { blendHourly, BLEND_MODELS, FILL_MODEL, BLEND_MODELS_PARAM } = mod;

  console.log('\n[1] 요청 파라미터');
  ok(BLEND_MODELS_PARAM.includes('ecmwf_ifs025'), 'ecmwf 를 요청한다');
  ok(BLEND_MODELS_PARAM.includes('icon_seamless'), 'icon 을 요청한다');
  ok(!BLEND_MODELS_PARAM.includes('best_match'),
     'best_match 를 **요청하지 않는다** — 변수가 10개를 넘으면 호출 수가 곱해진다');
  ok(BLEND_MODELS_PARAM.split(',').length === 2,
     '큰 요청에 붙는 모델은 둘뿐이다 (8변수 × 2 = 16 → 1.6회, 셋이면 24 → 2.4회)');
  ok(BLEND_MODELS.length === 2 && !BLEND_MODELS.includes('best_match'),
     '섞을 모델은 둘이고 best_match 는 그 안에 없다');

  console.log('\n[2] 접미사를 떼고 평균한다');
  {
    const out = blendHourly({
      time: ['2026-09-10T00:00', '2026-09-10T01:00'],
      cloud_cover_mid_ecmwf_ifs025: [80, 40],
      cloud_cover_mid_icon_seamless: [60, 20],
    });
    ok(Array.isArray(out.time) && out.time.length === 2, 'time 은 그대로 지나간다');
    ok(near(out.cloud_cover_mid[0], 70), '80 과 60 의 평균은 70');
    ok(near(out.cloud_cover_mid[1], 30), '40 과 20 의 평균은 30');
    ok(!('cloud_cover_mid_ecmwf_ifs025' in out), '접미사 붙은 이름은 안 남는다');
  }

  console.log('\n[3] best_match 는 평균에 안 들어간다  ← 핵심');
  {
    // 실제로 겪은 꼴: 짙게 흐린 하늘을 best_match 만 맑다고 말한다.
    const out = blendHourly({
      time: ['t'],
      cloud_cover_mid_ecmwf_ifs025: [90],
      cloud_cover_mid_icon_seamless: [86],
      cloud_cover_mid_best_match: [20],
    });
    ok(near(out.cloud_cover_mid[0], 88),
       'ecmwf 90 · icon 86 · best_match 20 → 88 (best_match 를 뺀 평균)');
    ok(!near(out.cloud_cover_mid[0], 65.333333333333336),
       '셋 다 섞은 65.3 이 아니다');
  }

  console.log('\n[4] null 을 다루는 법');
  {
    const out = blendHourly({
      time: ['a', 'b', 'c'],
      cloud_cover_low_ecmwf_ifs025: [50, null, null],
      cloud_cover_low_icon_seamless: [70, 30, null],
    });
    ok(near(out.cloud_cover_low[0], 60), '둘 다 있으면 평균');
    ok(near(out.cloud_cover_low[1], 30), '한쪽만 있으면 그 값 (0 으로 안 메운다)');
    ok(out.cloud_cover_low[2] === null,
       '둘 다 없으면 null — 0 으로 메우면 구름 없다고 거짓말이 된다');
  }

  console.log('\n[5] 대체 논리 (지금 큰 요청에는 안 쓰이지만 맞아야 한다)');
  {
    // 실기 확인: ecmwf·icon 은 visibility 를 24시간 전부 null 로 돌려준다.
    const out = blendHourly({
      time: ['a', 'b'],
      visibility_ecmwf_ifs025: [null, null],
      visibility_icon_seamless: [null, null],
      visibility_best_match: [22100, 19000],
    });
    ok(near(out.visibility[0], 22100) && near(out.visibility[1], 19000),
       '전부 null 인 두 모델 대신 best_match 값을 쓴다');
  }
  {
    const out = blendHourly({
      time: ['a'],
      total_column_integrated_water_vapour_ecmwf_ifs025: [24.5],
      total_column_integrated_water_vapour_icon_seamless: [null],
      total_column_integrated_water_vapour_best_match: [99],
    });
    ok(near(out.total_column_integrated_water_vapour[0], 24.5),
       '한 모델이라도 주면 best_match 로 안 넘어간다 (수증기: ecmwf 만 준다)');
  }

  console.log('\n[6] 모델을 안 붙인 응답은 그대로 지나간다 (아카이브 경로)');
  {
    const out = blendHourly({
      time: ['a'], cloud_cover_mid: [42], visibility: [15000],
    });
    ok(near(out.cloud_cover_mid[0], 42) && near(out.visibility[0], 15000),
       '접미사 없는 응답을 건드리지 않는다');
  }
  ok(blendHourly(null) === undefined, 'null 을 넣으면 undefined');
  ok(blendHourly(undefined) === undefined, 'undefined 를 넣으면 undefined');

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
