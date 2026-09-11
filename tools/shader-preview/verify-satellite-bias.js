/**
 * **위성 보정이 제 곡선대로 도는가** 합격 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/satelliteBias.ts` 머리말에 있습니다.
 * 여기서는 **30일·10지역으로 잰 최적 감쇠와 이 코드가 맞는지**를 봅니다.
 *
 * 사용: node tools/shader-preview/verify-satellite-bias.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, t) => Math.abs(a - b) <= t;

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'satelliteBias.js'));
  const { clearSkyGHI, tauFromCover, coverFromTau, dampingForLead,
          estimateBias, applyBias, MAX_LEAD_HOURS, BIAS_CLAMP } = M;

  console.log('\n[1] τ ↔ 운량 왕복');
  {
    for (const p of [0, 10, 37, 50, 80, 100]) {
      const back = coverFromTau(tauFromCover(p));
      if (!near(back, p, 0.01)) { ok(false, `${p}% → τ → ${back.toFixed(2)}%`); }
    }
    ok(true, '0·10·37·50·80·100% 가 그대로 돌아온다');
    ok(near(tauFromCover(0), 1, 1e-9), '운량 0 → τ 1 (맑음)');
    ok(near(tauFromCover(100), 0.25, 1e-9), '운량 100 → τ 0.25 (완전흐림)');
  }

  console.log('\n[2] 감쇠 곡선이 잰 최적값과 맞는가');
  {
    // 잰 최적 감쇠: +0h 1.0 · +1h 0.5~0.7 · +2h 0.3 · +3h 0.3 · +5h 0.1
    const want = [[0, 1.0, 0.01], [1, 0.6, 0.15], [2, 0.3, 0.12], [3, 0.2, 0.12], [5, 0.1, 0.08]];
    for (const [h, target, tol] of want) {
      const d = dampingForLead(h);
      console.log(`      +${h}h → 감쇠 ${d.toFixed(2)} (잰 최적 ${target})`);
      ok(near(d, target, tol), `+${h}h 감쇠가 잰 값 언저리다 (${d.toFixed(2)} 대 ${target})`);
    }
  }

  console.log('\n[3] 너무 앞서면 아예 안 쓴다  ← +8h 에서 되레 나빠졌다');
  {
    ok(dampingForLead(MAX_LEAD_HOURS + 0.1) === 0, `${MAX_LEAD_HOURS}h 를 넘으면 감쇠 0`);
    ok(dampingForLead(8) === 0, '+8h 는 안 쓴다');
    ok(applyBias(50, 0.3, 8) === 50, '안 쓸 때는 원래 값 그대로');
    ok(dampingForLead(NaN) === 0, 'NaN 이면 안 쓴다');
    ok(dampingForLead(-1) === 1, '과거(음수)는 관측이 있으니 온전히 쓴다');
  }

  console.log('\n[4] 편향 부호 — 양수면 "예보가 실제보다 맑다"');
  {
    const cz = 0.7, cs = clearSkyGHI(cz);
    // 예보는 맑다(운량 10%)는데 위성은 어둡다 → 예보가 너무 맑음 → 양수
    const b1 = estimateBias([{ forecastCoverPct: 10, observedGHI: cs * 0.3, clearSkyGHI: cs }]);
    ok(b1 > 0.3, `예보 맑음 + 실제 어두움 → 양수 편향 (${b1.toFixed(3)})`);
    // 반대
    const b2 = estimateBias([{ forecastCoverPct: 95, observedGHI: cs * 0.98, clearSkyGHI: cs }]);
    ok(b2 < -0.3, `예보 흐림 + 실제 맑음 → 음수 편향 (${b2.toFixed(3)})`);
    // 맞으면 0 근처
    const b3 = estimateBias([{ forecastCoverPct: 50, observedGHI: cs * tauFromCover(50), clearSkyGHI: cs }]);
    ok(Math.abs(b3) < 0.01, `맞으면 0 근처 (${b3.toFixed(4)})`);
  }

  console.log('\n[5] 한계와 안전장치');
  {
    const cz = 0.7, cs = clearSkyGHI(cz);
    const huge = estimateBias([{ forecastCoverPct: 0, observedGHI: 0, clearSkyGHI: cs }]);
    ok(Math.abs(huge) <= BIAS_CLAMP + 1e-9, `한 번의 큰 어긋남도 ±${BIAS_CLAMP} 로 잘린다 (${huge.toFixed(3)})`);
    ok(estimateBias([]) === null, '표본이 없으면 null');
    ok(estimateBias([{ forecastCoverPct: 50, observedGHI: 10, clearSkyGHI: 20 }]) === null,
       '태양이 너무 낮으면(맑은하늘 < 80) 버린다 — 잡음이 크다');
    ok(applyBias(50, null, 0) === 50, '편향이 null 이면 원래 값');
    const c = applyBias(50, 0.3, 0);
    ok(c >= 0 && c <= 100, `보정 결과가 0~100 안에 든다 (${c.toFixed(1)})`);
    ok(applyBias(0, -0.35, 0) <= 100 && applyBias(100, 0.35, 0) >= 0, '양 끝에서도 안 넘친다');
  }

  console.log('\n[6] 실제로 맑은 쪽/흐린 쪽으로 옮기는가');
  {
    const before = 30;
    const darker = applyBias(before, +0.2, 0);   // 예보가 너무 맑았다 → 더 흐리게
    const lighter = applyBias(before, -0.2, 0);  // 예보가 너무 흐렸다 → 더 맑게
    console.log(`      운량 ${before}% → 편향 +0.2 이면 ${darker.toFixed(1)}% · −0.2 이면 ${lighter.toFixed(1)}%`);
    ok(darker > before, '양수 편향이면 운량이 는다 (예보가 너무 맑았으므로)');
    ok(lighter < before, '음수 편향이면 운량이 준다');
    ok(applyBias(before, 0.2, 3) < darker, '앞선 시간이 길수록 덜 옮긴다');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
