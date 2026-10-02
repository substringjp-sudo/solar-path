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
  const { clearSkyGHI, clearSkyGHIMean, tauFromCover, coverFromTau, dampingForLead,
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

  console.log('\n[7] 창평균 맑은하늘 — 일사가 시간평균이라 분모도 창에서 평균해야 한다');
  {
    // 서울 9월 하루를 가짜 태양으로 흉내 냅니다. 정오 12:00, 일출 06:00,
    // 일몰 18:00 인 사인 곡선 — 실제 천문이 아니라 **모양만** 씁니다.
    const H = 3600_000;
    const noon = Date.parse('2026-09-11T12:00:00Z');
    const cosZAt = ms => {
      const h = (ms - noon) / H;                       // 정오에서 몇 시간
      return Math.cos((h / 6) * (Math.PI / 2));        // ±6h 에서 0
    };
    const at = h => {
      const ms = noon + h * H;
      return { inst: clearSkyGHI(cosZAt(ms)), mean: clearSkyGHIMean(ms, cosZAt) };
    };

    const morning = at(-4);   // 08:00 — 해가 오르는 중
    const evening = at(+4);   // 16:00 — 해가 지는 중
    const midday  = at(0);    // 12:00 — 꼭대기

    console.log(`      08:00 순간 ${morning.inst.toFixed(0)} / 창평균 ${morning.mean.toFixed(0)}  (${(morning.inst / morning.mean).toFixed(2)}배)`);
    console.log(`      12:00 순간 ${midday.inst.toFixed(0)} / 창평균 ${midday.mean.toFixed(0)}  (${(midday.inst / midday.mean).toFixed(2)}배)`);
    console.log(`      16:00 순간 ${evening.inst.toFixed(0)} / 창평균 ${evening.mean.toFixed(0)}  (${(evening.inst / evening.mean).toFixed(2)}배)`);

    // ⚠ **양방향**입니다 — 한쪽으로만 치우치는 보정이 아닙니다.
    ok(morning.inst > morning.mean * 1.1,
       `오르는 중엔 순간이 창평균보다 크다 → 순간으로 나누면 아침을 흐리게 읽는다 (${(morning.inst / morning.mean).toFixed(2)}배)`);
    ok(evening.inst < evening.mean * 0.9,
       `지는 중엔 순간이 창평균보다 작다 → 순간으로 나누면 **일몰을 맑게** 읽는다 (${(evening.inst / evening.mean).toFixed(2)}배)`);
    ok(near(midday.inst / midday.mean, 1, 0.1),
       `꼭대기에서는 둘이 거의 같다 (${(midday.inst / midday.mean).toFixed(2)}배) — 차이는 태양이 빠르게 움직일 때만 난다`);

    // 창 안이 전부 밤이면 0 이어야 합니다.
    ok(clearSkyGHIMean(noon - 8 * H, cosZAt) === 0, '창이 전부 밤이면 0');
    // 창평균은 창 안 순간값들의 최대와 최소 사이에 들어야 합니다.
    const lo = Math.min(clearSkyGHI(cosZAt(noon - 5 * H)), clearSkyGHI(cosZAt(noon - 4 * H)));
    const hi = Math.max(clearSkyGHI(cosZAt(noon - 5 * H)), clearSkyGHI(cosZAt(noon - 4 * H)));
    ok(morning.mean >= lo && morning.mean <= hi, `창평균이 창 안 값 사이에 든다 (${lo.toFixed(0)} ≤ ${morning.mean.toFixed(0)} ≤ ${hi.toFixed(0)})`);
  }

  // ── 거리와 층 (2026-10-02 후쿠이) ─────────────────────────────────────
  // 무엇을 왜 재었는지는 satelliteBias.ts 머리말 "거리와 층" 과 tools/weather-truth/measure-bias-distance.js.
  const { weightForDistance, columnCover, allocateColumnBias, coverResolution, correctCloudAt,
          BIAS_DECAY_KM, SAT_TAU_NOISE, MODEL_COVER_SIGMA } = M;
  const colTau = c => tauFromCover(columnCover(c.low, c.mid, c.high));

  console.log('\n[8] 거리 감쇠 — 관측점은 그대로, 멀수록 덜');
  {
    ok(weightForDistance(0) === 1, '관측점(0km)은 1 — 관측점 이득은 그대로');
    ok(near(weightForDistance(BIAS_DECAY_KM), Math.exp(-1), 1e-12), `${BIAS_DECAY_KM}km 에서 e⁻¹`);
    ok(weightForDistance(380) < weightForDistance(130) && weightForDistance(130) < weightForDistance(10),
       `멀수록 작다 (10km ${weightForDistance(10).toFixed(2)} · 130km ${weightForDistance(130).toFixed(2)} · 380km ${weightForDistance(380).toFixed(2)})`);
    ok(weightForDistance(NaN) === 1 && weightForDistance(-5) === 1, '거리를 모르면(NaN·음수) 관측점처럼 1');
  }

  console.log('\n[9] 층 배분 — 기둥 τ 가 정확히 Δτ 만큼, 모델이 둔 구름에 비례해');
  {
    const base = { low: 20, mid: 10, high: 40 };
    for (const d of [0.05, -0.05, 0.2]) {
      const out = allocateColumnBias(base, d);
      ok(near(colTau(base) - colTau(out), d, 1e-9),
         `Δτ ${d >= 0 ? '+' : ''}${d}: 그리는 기둥 τ 가 정확히 그만큼 옮는다 (${colTau(base).toFixed(4)} → ${colTau(out).toFixed(4)})`);
    }
    const up = allocateColumnBias(base, 0.1);
    ok(near(up.low / base.low, up.high / base.high, 1e-9) && near(up.mid / base.mid, up.high / base.high, 1e-9),
       `세 층에 같은 배수 (×${(up.low / base.low).toFixed(3)})`);
    const zero = allocateColumnBias({ low: 0, mid: 0, high: 45 }, 0.2);
    ok(zero.low === 0 && zero.mid === 0 && zero.high > 45, `0% 층은 0% 그대로 — 저층 0 · 중층 0 · 상층 45 → ${zero.high.toFixed(1)}`);
    const empty = allocateColumnBias({ low: 0, mid: 0, high: 0 }, 0.3);
    ok(empty.low === 0 && empty.mid === 0 && empty.high === 0, '맑은 기둥(전부 0)에는 아무것도 안 만든다');
    // 목표가 완전 흐림(τ 0.25)이면 가장 큰 층이 100% 가 되는 데서 멈춥니다 — 작은 층은 비례만큼만.
    const sat = allocateColumnBias({ low: 2, mid: 0, high: 60 }, 0.75);
    ok(near(sat.high, 100, 1e-6) && sat.low < 4, `완전 흐림 목표: 상층 60 → 100, 저층 2 → ${sat.low.toFixed(2)} (100 으로 부풀지 않음)`);
    ok(allocateColumnBias(base, 0).low === 20 && allocateColumnBias(base, NaN).high === 40, 'Δτ 0·NaN 이면 그대로');
    // 음성 대조: 예전처럼 층마다 같은 Δτ 를 주면 기둥은 그 몇 배를 옮깁니다.
    const per = { low: applyBias(20, 0.05, 0), mid: applyBias(10, 0.05, 0), high: applyBias(40, 0.05, 0) };
    const shift = colTau(base) - colTau(per);
    ok(shift > 2 * 0.05, `대조 — 층마다 Δτ 0.05 를 따로 주면 기둥은 ${shift.toFixed(3)} 옮는다(${(shift / 0.05).toFixed(1)}배)`);
  }

  console.log('\n[10] 위성이 가려낼 수 있는 몫 — 맑은 쪽은 0, 흐린 쪽은 1');
  {
    const r = SAT_TAU_NOISE / MODEL_COVER_SIGMA;
    const g = [0, 10, 20, 30, 40, 60, 100].map(coverResolution);
    console.log(`      g(0/10/20/30/40/60/100%) = ${g.map(x => x.toFixed(2)).join(' / ')}  (r = ${r.toFixed(4)})`);
    ok(g[0] === 0 && g[1] < 0.05 && g[6] > 0.99, '맑은 기둥 0 · 10% 는 거의 0 · 완전 흐림은 거의 1');
    ok(g.every((x, i) => i === 0 || x >= g[i - 1]), '기둥이 짙을수록 몫이 커진다(단조)');
    // 걸리는 양의 상한: Δτ 를 몫만큼 걸면 기둥 운량이 움직이는 양은 어디서나 Δτ/(2r) 를 넘지 않습니다.
    // (선형 근사의 성질이라 작은 Δτ 로 봅니다.)
    let worst = 0;
    for (let T = 1; T <= 99; T += 1) {
      const dT = 0.002, c = { low: T, mid: 0, high: 0 };
      const out = allocateColumnBias(c, dT * coverResolution(T));
      worst = Math.max(worst, (columnCover(out.low, out.mid, out.high) - T) / 100 / dT);
    }
    ok(worst <= (1 / (2 * r)) * 1.02, `기둥이 움직이는 양 ≤ Δτ/(2r) — 최대 ${worst.toFixed(2)} 배 (한계 ${(1 / (2 * r)).toFixed(2)})`);
  }

  console.log('\n[11] 한 점·한 시각 — 관측점 총운량은 예전 식 그대로, 멀리·맑은 쪽은 덜');
  {
    const c = { low: 1, mid: 0, high: 29, total: 32.5 };
    const at0 = correctCloudAt(c, 0.0179, 1, 0);
    ok(near(at0.total, applyBias(32.5, 0.0179, 1), 1e-12), `관측점 총운량 = applyBias 그대로 (${at0.total.toFixed(2)}%)`);
    ok(at0.high > 29 && at0.low < 1.3 && at0.mid === 0, `후쿠이 관측점: 상층 29 → ${at0.high.toFixed(1)} · 저층 1 → ${at0.low.toFixed(2)} · 중층 0 그대로`);
    const far = correctCloudAt(c, 0.0179, 1, 380);
    ok(far.high < at0.high && far.high > 29, `380km 에서는 덜 (상층 ${far.high.toFixed(2)} < ${at0.high.toFixed(2)})`);
    const clear = correctCloudAt({ low: 1, mid: 0, high: 1, total: 4 }, 0.0179, 1, 10);
    ok(clear.low - 1 < 0.1 && clear.high - 1 < 0.1,
       `맑은 기둥(저 1 · 상 1)은 +0.1%p 안 (저층 ${clear.low.toFixed(3)}) — 예전 방식이면 ${applyBias(1, 0.0179, 1).toFixed(0)}%`);
    const none = correctCloudAt(c, null, 1, 0);
    ok(none.low === 1 && none.high === 29 && none.total === 32.5, '편향이 없으면 그대로');
    const late = correctCloudAt(c, 0.2, 8, 0);
    ok(late.high === 29 && late.total === 32.5, '앞선 시간이 한계(6h)를 넘으면 그대로');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
