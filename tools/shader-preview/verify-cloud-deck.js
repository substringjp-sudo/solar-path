/**
 * **관측자가 구름층 위에 있을 때의 기하** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/cloudDeck.ts` 머리말에 있습니다.
 *
 * ## 이 자가 지키려는 것
 *
 * 1. **층 아래에서 예전과 같은 답** — 안 그러면 운해를 얻고 하늘을 잃습니다.
 * 2. **층 위에서 아래 반구를 채운다** — 운해는 띠가 아니라 바닥입니다.
 * 3. **먼 가장자리가 맞다** — 판별식이 0 되는 각이 껍질의 지평선입니다.
 * 4. **수치가 믿을 만하다** — 왕복이 맞는가, 그리고 순진한 근의 공식과
 *    어디서부터 갈리는가. ⚠ 처음엔 "순진한 식이 무너진다" 를 단언으로 걸었다가
 *    **자에게 반증당했습니다** — 물리 구간에서는 둘이 같습니다.
 * 5. **관측자가 층을 가로지를 때 안 튄다** — 위아래가 이어져야 합니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-cloud-deck.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const R = 6371;

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'cloudDeck.js'));
  const { deckHit, deckElevationDeg, deckHorizonDipDeg, isAboveLayer, isCloudSea, CLOUD_SEA_MIN_COVER } = M;
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'skyColumn.js'));
  const { elevationToDistanceKm, elevationFromDistanceDeg } = S;

  const OBS = 1.6, DECK = 1.2;   // 사용자의 상황: 해발 1,600m · 운해 윗면 1,200m

  // ── [1] ⚠ 층 아래에서는 예전 코드와 같아야 한다 ───────────────────
  //    여기가 어긋나면 운해를 얻는 대신 **평지의 하늘을 잃습니다.**
  console.log('\n[1] 관측자가 층 아래 — 기존 기하와 같은가');
  {
    let worst = 0, worstAt = null;
    for (const alt of [1.5, 4.5, 10]) {
      for (let e = 0.5; e <= 89; e += 0.5) {
        const old = elevationToDistanceKm(e, alt);
        const now = deckHit(e, alt, 0);
        if (!now) { worst = Infinity; worstAt = `${alt}km @ ${e}°`; break; }
        const rel = Math.abs(now.arcKm - old) / Math.max(1e-6, old);
        if (rel > worst) { worst = rel; worstAt = `${alt}km @ ${e}° (${old.toFixed(3)} vs ${now.arcKm.toFixed(3)})`; }
      }
    }
    console.log(`      관측자 0m · 고도각 0.5~89° · 층 3개 → 최대 상대차 ${(worst * 100).toExponential(2)}%  ${worstAt}`);
    ok(worst < 1e-9, `관측자가 땅에 있으면 기존 elevationToDistanceKm 와 같다`);

    // 역함수도 같아야 합니다.
    let wr = 0;
    for (const alt of [1.5, 4.5, 10]) {
      for (const d of [1, 5, 20, 80, 300]) {
        wr = Math.max(wr, Math.abs(deckElevationDeg(d, alt, 0) - elevationFromDistanceDeg(d, alt)));
      }
    }
    console.log(`      역함수 최대차 ${wr.toExponential(2)}°`);
    ok(wr < 1e-9, `역함수도 기존 elevationFromDistanceDeg 와 같다`);
  }

  // ── [2] 수치 — 왕복이 맞는가, 순진한 식과는 어디서 갈리는가 ─────────
  //    ⚠ 처음엔 "순진한 식은 자릿수가 날아간다" 를 걸었는데 반증당했습니다.
  console.log('\n[2] 수치 안정성 — 순진한 뺄셈과 견주기');
  {
    /** 근의 공식을 **그대로** 쓴 것 — 가까운 근을 뺄셈으로 냅니다. */
    const naive = (elevDeg, altKm, obsKm) => {
      const A = R + altKm, B = R + obsKm;
      const e = elevDeg * Math.PI / 180;
      const disc = A * A - B * B * Math.cos(e) * Math.cos(e);
      if (disc < 0) return null;
      return -B * Math.sin(e) - Math.sqrt(disc);     // 가까운 근을 뺄셈으로
    };
    console.log(`      관측자 ${OBS * 1000}m · 구름 ${DECK * 1000}m`);
    console.log(`      ${'내려본 각'.padStart(10)} ${'안정한 식'.padStart(12)} ${'순진한 뺄셈'.padStart(13)} ${'상대차'.padStart(10)}`);
    let maxRel = 0;
    for (const e of [-5, -11.315, -30, -60, -89]) {
      const st = deckHit(e, DECK, OBS);
      const nv = naive(e, DECK, OBS);
      const rel = Math.abs(nv - st.slantKm) / st.slantKm;
      maxRel = Math.max(maxRel, rel);
      console.log(`      ${(e + '°').padStart(10)} ${st.slantKm.toFixed(6).padStart(12)} ${nv.toFixed(6).padStart(13)} ${(rel * 100).toFixed(3).padStart(9)}%`);
    }
    /* ⚠ 처음에 여기에 `maxRel > 1e-4` 를 걸었습니다 — "순진한 식이 무너진다".
     *    **자가 반증했습니다(0.000%).** 무너진 건 코드가 아니라 제 손계산의
     *    유효숫자였습니다. 사실은 그 반대라서, 이제 **둘이 같다**를 못 박습니다.
     *    이게 중요한 이유: 이 식을 나중에 누가 순진한 쪽으로 바꿔도 물리
     *    구간에서는 안 틀린다는 뜻이고, 그러면 여기 복잡함의 근거는 수치가
     *    아니라 **고도차 0 근처의 견고함**뿐입니다. 그 경계도 같이 잽니다.
     */
    ok(maxRel < 1e-6, `물리 구간(고도차 ${((OBS - DECK) * 1000).toFixed(0)}m)에서는 순진한 식과 같다 (${maxRel.toExponential(1)})`);

    // 어디서부터 갈리는가 — 고도차를 줄여 가며.
    const naiveRel = dhKm => {
      const obs = DECK + dhKm;
      const st = deckHit(-5, DECK, obs), nv = naive(-5, DECK, obs);
      return Math.abs(nv - st.slantKm) / st.slantKm;
    };
    console.log(`      고도차별 상대차 — 1000m: ${naiveRel(1).toExponential(1)}`
              + ` · 1m: ${naiveRel(0.001).toExponential(1)}`
              + ` · 1cm: ${naiveRel(0.00001).toExponential(1)}`);
    ok(naiveRel(0.00001) > naiveRel(1),
       `고도차가 줄수록 순진한 식이 나빠진다 — 근과 곱을 쓰는 유일한 근거`);

    // 안정한 식은 **왕복**이 맞아야 합니다 — 그게 정답의 증거입니다.
    let wr = 0;
    for (let e = -89; e <= -0.7; e += 0.1) {
      const h = deckHit(e, DECK, OBS);
      if (!h) continue;
      wr = Math.max(wr, Math.abs(deckElevationDeg(h.arcKm, DECK, OBS) - e));
    }
    console.log(`      왕복(각→거리→각) 최대 오차 ${wr.toExponential(2)}°`);
    ok(wr < 1e-6, `각→거리→각 왕복이 맞는다 — 안정한 식이 옳다`);
  }

  // ── [3] ⚠ 운해가 아래 반구를 채우는가 ─────────────────────────────
  console.log('\n[3] 운해 — 띠가 아니라 바닥인가');
  {
    const edge = deckHorizonDipDeg(DECK, OBS);
    // ⚠ 가장자리 **바로 아래**를 물어야 합니다. `-edge + …` 는 가장자리 위라
    //    안 닿고, 예전에 여기서 undefined 가 찍혔습니다.
    const edgeHit = deckHit(-edge - 1e-4, DECK, OBS);
    console.log(`      먼 가장자리 ${edge.toFixed(3)}° 아래 · 거리 ${edgeHit ? edgeHit.arcKm.toFixed(1) : '닿지 않음'}km`);
    ok(edgeHit !== null && edgeHit.arcKm > 50, `가장자리 바로 아래가 먼 거리다 (${edgeHit?.arcKm.toFixed(1)}km)`);
    ok(Math.abs(edge - Math.acos((R + DECK) / (R + OBS)) * 180 / Math.PI) < 1e-9,
       `가장자리가 acos(A/B) 와 같다 (${edge.toFixed(3)}°)`);

    // −90°(발밑)부터 가장자리까지 **전부** 닿아야 합니다.
    let hitCount = 0, total = 0;
    for (let e = -89.5; e <= -edge - 0.01; e += 0.25) { total++; if (deckHit(e, DECK, OBS)) hitCount++; }
    console.log(`      가장자리~발밑 사이 ${total}개 각 중 닿는 각 ${hitCount}개`);
    ok(hitCount === total, `가장자리 아래는 전부 구름에 닿는다 — 아래 반구가 바닥이다`);

    // ⚠ 가장자리 **위**로는 안 닿아야 합니다. 닿는다면 없는 구름을 그립니다.
    let above = 0;
    for (let e = -edge + 0.02; e <= 60; e += 0.25) if (deckHit(e, DECK, OBS)) above++;
    console.log(`      가장자리 위쪽에서 닿는 각: ${above}개 (0이어야 함)`);
    ok(above === 0, `가장자리 위로는 시선이 구름에 안 닿는다 — 없는 구름을 안 그린다`);

    // 내려다본 각이 커지면 거리가 줄어야 합니다(단조).
    let mono = true, prev = Infinity;
    for (let e = -edge - 0.05; e >= -89; e -= 0.25) {
      const h = deckHit(e, DECK, OBS);
      if (!h) { mono = false; break; }
      if (h.arcKm > prev + 1e-9) mono = false;
      prev = h.arcKm;
    }
    ok(mono, `더 아래를 볼수록 더 가까운 구름을 본다`);

    // 손으로 잰 값과 맞는가 (수평 2km 앞 구름면은 약 11.3° 아래).
    const e2 = deckElevationDeg(2.0, DECK, OBS);
    console.log(`      수평 2km 앞 구름면 → ${e2.toFixed(2)}° (손계산 −11.3°)`);
    ok(Math.abs(e2 + 11.3) < 0.2, `2km 앞이 −11.3° 근처다`);
  }

  // ── [4] ⚠ 층을 가로지를 때 안 튀는가 ──────────────────────────────
  //    관측자가 구름 높이를 지나가는 순간 화면이 뒤집히면 안 됩니다.
  console.log('\n[4] 관측자가 층 높이를 가로지를 때');
  {
    const D = 1.2;
    console.log(`      구름 ${D * 1000}m 고정 · 관측자 고도를 올려 가며 수평 5km 앞 구름면의 고도각`);
    let prev = null, jumped = 0;
    const rows = [];
    for (let o = 0.9; o <= 1.5; o += 0.05) {
      const e = deckElevationDeg(5, D, o);
      rows.push([o, e]);
      if (prev !== null && Math.abs(e - prev) > 3.0) jumped++;
      prev = e;
    }
    for (const [o, e] of rows.filter((_, i) => i % 3 === 0)) {
      console.log(`        관측자 ${(o * 1000).toFixed(0).padStart(4)}m → ${e.toFixed(2).padStart(7)}°`);
    }
    ok(jumped === 0, `고도를 올려도 각이 안 튄다 (한 걸음 3° 넘는 점프 ${jumped}회)`);
    // 부호가 정확히 층 높이에서 갈려야 합니다.
    ok(deckElevationDeg(5, D, D - 0.01) > 0 && deckElevationDeg(5, D, D + 0.01) < 0,
       `관측자가 층보다 낮으면 올려다보고, 높으면 내려다본다`);
    ok(Math.abs(deckElevationDeg(5, D, D)) < 0.05,
       `관측자가 층과 같은 높이면 거의 수평 (${deckElevationDeg(5, D, D).toFixed(3)}°)`);
    ok(isAboveLayer(D, D + 0.01) && !isAboveLayer(D, D - 0.01), `isAboveLayer 가 경계에서 갈린다`);
  }

  // ── [5] 운해 판별 ────────────────────────────────────────────────
  console.log('\n[5] 운해 판별 — 운량과 고도 둘 다 보는가');
  {
    ok(isCloudSea(0.9, DECK, OBS), `저층운 90% + 층이 아래 → 운해`);
    ok(!isCloudSea(0.9, 2.5, OBS), `층이 관측자보다 위면 운해가 아니다 (그냥 흐림)`);
    ok(!isCloudSea(0.2, DECK, OBS), `운량 20% 면 운해가 아니다 — 구멍이 숭숭한 건 바다가 아니다`);
    ok(!isCloudSea(0.9, DECK, 0.05), `해발 50m 관측자는 운해를 볼 수 없다`);
    console.log(`      운량 문턱 ${(CLOUD_SEA_MIN_COVER * 100).toFixed(0)}%`);
    ok(isCloudSea(CLOUD_SEA_MIN_COVER, DECK, OBS) && !isCloudSea(CLOUD_SEA_MIN_COVER - 0.01, DECK, OBS),
       `문턱에서 정확히 갈린다`);
  }

  // ── [6] 극단값에 안 깨지는가 ──────────────────────────────────────
  console.log('\n[6] 극단값');
  {
    ok(deckHit(-90, DECK, OBS) !== null, `발밑(−90°)도 닿는다`);
    const straightDown = deckHit(-90, DECK, OBS);
    console.log(`      발밑 직하 거리 ${straightDown.slantKm.toFixed(4)}km (고도차 ${(OBS - DECK).toFixed(3)}km)`);
    ok(Math.abs(straightDown.slantKm - (OBS - DECK)) < 1e-6,
       `발밑 거리가 고도차와 같다 — 기하가 자명한 곳에서 맞는다`);
    ok(Math.abs(straightDown.arcKm) < 1e-6, `발밑의 수평 거리는 0`);
    ok(deckHit(0, DECK, OBS) === null, `정확히 수평으로 보면 아래 구름에 안 닿는다`);
    ok(deckHit(89, 10, 0) !== null, `평지에서 천정 근처 상층운은 닿는다`);
    ok(deckHorizonDipDeg(DECK, 0) === 0, `층 아래에 있으면 가장자리가 0`);
    ok(deckHorizonDipDeg(2.5, OBS) === 0, `층이 위에 있으면 가장자리가 0`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
