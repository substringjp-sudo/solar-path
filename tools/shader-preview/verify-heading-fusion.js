/**
 * **방위각 융합** 합격 판정. 브라우저가 필요 없습니다 — 순수 논리입니다.
 *
 * 실기 보고: "동쪽을 바라보면 북쪽이라고 뜬다(90도쯤 차이). 지자기 초기화도
 * 잘 동작 안 하는 것 같고 8자로 흔들어도 그렇게까지 잘 맞지는 않는다."
 *
 * ## 예전 논리를 여기 그대로 옮겨 나란히 돌립니다
 *
 * 고친 쪽만 재면 "좋아졌다" 를 말할 수 없습니다. `SunCamera.tsx` 에 있던
 * 예전 식(첫 표본 즉시 채택 · 보정률 0.001 · 자이로 도착 확인 없음)을
 * 그대로 옮겨 **같은 센서 열**을 먹입니다.
 *
 * ⚠ 옛 식은 판정 안에만 있습니다. 앱에서 지웠으므로 여기 사본이 낡을 수
 * 있는데, 그래도 괜찮습니다 — 이 판정이 지키는 것은 "옛 식이 지금도
 * 살아 있는가" 가 아니라 **"새 식이 옛 식이 틀렸던 자리에서 맞는가"**
 * 입니다.
 *
 * 사용: node tools/shader-preview/verify-heading-fusion.js
 *      (stage-esm.js 를 먼저 돌려야 합니다 — 앱 모듈을 임포트합니다)
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const wrap180 = (d) => ((d + 540) % 360) - 180;
const wrap360 = (d) => ((d % 360) + 360) % 360;

/** 예전 SunCamera 의 오프셋 논리 — 비교용 사본입니다. */
function makeOld() {
  let rawGyro = 0;           // ⚠ 0 으로 시작합니다. 이것이 경주의 원인입니다.
  let offset = 0, init = false, hasGyro = false;
  return {
    pushGyro(h) { rawGyro = h; hasGyro = true; },
    pushMagnetic(h) {
      let raw = wrap180(h - rawGyro);
      if (!init) { offset = raw; init = true; }
      else { offset = offset + wrap180(raw - offset) * 0.001; }
    },
    heading() { return hasGyro ? wrap360(rawGyro + offset) : null; },
  };
}

(async () => {
  const mod = await import('file://' + path.join(PREVIEW, 'app/utils/headingFusion.js'));
  const { createHeadingFusion } = mod;

  // ── 가짜 기기 ────────────────────────────────────────────────────────
  //
  // 자이로는 **임의의 기준**을 씁니다(iOS CMAttitude 의 xArbitraryZVertical
  // 처럼). 그래서 rawGyro = 참방위 - GYRO_REF 입니다. 오프셋이 하는 일이
  // 바로 그 GYRO_REF 를 되찾는 것입니다.
  const GYRO_REF = 137;                 // 아무 값이나 — 앱은 모릅니다
  const rawOf = (trueAz) => wrap360(trueAz - GYRO_REF);

  console.log('== ① 경주: 자기 표본이 자이로보다 먼저 오면 ==');
  //
  // 화면을 열자마자 watchHeadingAsync 가 DeviceMotion 보다 먼저 콜백하는
  // 경우입니다. 예전 코드는 rawGyroHeadingRef 가 아직 0 이라
  // offset = heading - 0 = heading 으로 잡습니다.
  {
    const TRUE_AZ = 90;                  // 동쪽을 봄
    const nw = createHeadingFusion();
    const od = makeOld();
    // 자기 표본이 먼저 여럿
    for (let i = 0; i < 3; i++) { nw.pushMagnetic(TRUE_AZ, true); od.pushMagnetic(TRUE_AZ); }
    // 그다음 자이로가 붙습니다
    for (let i = 0; i < 12; i++) {
      nw.pushGyro(rawOf(TRUE_AZ), 1.0); od.pushGyro(rawOf(TRUE_AZ));
      nw.pushMagnetic(TRUE_AZ, true);    od.pushMagnetic(TRUE_AZ);
    }
    const eNew = Math.abs(wrap180(nw.heading() - TRUE_AZ));
    const eOld = Math.abs(wrap180(od.heading() - TRUE_AZ));
    console.log(`  참 ${TRUE_AZ}°  →  새 ${nw.heading().toFixed(1)}° (오차 ${eNew.toFixed(1)}°)  ·  옛 ${od.heading().toFixed(1)}° (오차 ${eOld.toFixed(1)}°)`);
    ok(eOld > 30, `옛 논리는 크게 틀린다 (${eOld.toFixed(1)}°) — 실기의 "동쪽인데 북쪽"`);
    ok(eNew < 2, `새 논리는 맞는다 (${eNew.toFixed(1)}°)`);
    ok(nw.status().lastReject === null && nw.status().seeded, `자이로가 온 뒤에야 씨앗을 잡았다`);
  }

  console.log('\n== ② 자세: 폰을 눕힌 채 열면 ==');
  //
  // 전방 벡터가 바닥을 보면(수평 성분 ≈ 0) 방위는 수치적으로 무의미합니다.
  // 그 값으로 오프셋을 잡으면 안 됩니다.
  {
    const TRUE_AZ = 90;
    const nw = createHeadingFusion();
    // 눕힌 자세 — 수평 성분이 거의 0, 방위값도 엉뚱합니다.
    for (let i = 0; i < 10; i++) { nw.pushGyro(wrap360(311 + i), 0.04); nw.pushMagnetic(TRUE_AZ, true); }
    ok(!nw.status().seeded, `눕힌 자세에서는 씨앗을 안 잡는다 (버린 이유 ${nw.status().lastReject})`);
    ok(nw.status().lastReject === 'ill-pose', `버린 이유를 남긴다`);
    // 세우면 바로 잡힙니다.
    for (let i = 0; i < 10; i++) { nw.pushGyro(rawOf(TRUE_AZ), 1.0); nw.pushMagnetic(TRUE_AZ, true); }
    const e = Math.abs(wrap180(nw.heading() - TRUE_AZ));
    ok(nw.status().seeded && e < 2, `세우면 바로 맞는다 (${e.toFixed(1)}°)`);
  }

  console.log('\n== ③ 되돌리기: 잘못 잡힌 뒤 얼마나 빨리 회복하나 ==');
  //
  // "8자로 흔들어도 잘 안 맞는다" 의 정체입니다. 옛 보정률 0.001 은
  // 시정수가 표본 1000개 — 초당 5~10개면 2~3분입니다.
  {
    const TRUE_AZ = 90;
    const nw = createHeadingFusion();
    const od = makeOld();
    // 둘 다 90° 어긋난 상태로 잡히게 만듭니다.
    for (let i = 0; i < 10; i++) {
      nw.pushGyro(rawOf(TRUE_AZ), 1.0); od.pushGyro(rawOf(TRUE_AZ));
      nw.pushMagnetic(wrap360(TRUE_AZ + 90), true); od.pushMagnetic(wrap360(TRUE_AZ + 90));
    }
    // 이제 자기계가 제대로 말하기 시작합니다(8자 흔들기 뒤).
    let nwSteps = -1, odSteps = -1;
    for (let i = 1; i <= 1500; i++) {
      nw.pushGyro(rawOf(TRUE_AZ), 1.0); od.pushGyro(rawOf(TRUE_AZ));
      nw.pushMagnetic(TRUE_AZ, true);   od.pushMagnetic(TRUE_AZ);
      if (nwSteps < 0 && Math.abs(wrap180(nw.heading() - TRUE_AZ)) < 5) nwSteps = i;
      if (odSteps < 0 && Math.abs(wrap180(od.heading() - TRUE_AZ)) < 5) odSteps = i;
    }
    console.log(`  5° 안으로 들어오기까지 — 새 ${nwSteps}표본  ·  옛 ${odSteps < 0 ? '1500표본 안에 못 들어옴' : odSteps + '표본'}`);
    ok(nwSteps > 0 && nwSteps < 60, `새 논리는 금방 회복한다 (${nwSteps}표본)`);
    ok(odSteps < 0 || odSteps > 500, `옛 논리는 한참 걸린다 (${odSteps < 0 ? '1500+' : odSteps}표본)`);
  }

  console.log('\n== ④ 튐: 자기계가 한 번 크게 틀려도 끌려가지 않는다 ==');
  {
    const TRUE_AZ = 200;
    const nw = createHeadingFusion();
    for (let i = 0; i < 60; i++) { nw.pushGyro(rawOf(TRUE_AZ), 1.0); nw.pushMagnetic(TRUE_AZ, true); }
    const before = nw.heading();
    nw.pushGyro(rawOf(TRUE_AZ), 1.0); nw.pushMagnetic(wrap360(TRUE_AZ + 120), true);  // 한 번 튐
    const after = nw.heading();
    ok(Math.abs(wrap180(after - before)) < 1, `한 번 튄 표본은 거의 안 먹는다 (${Math.abs(wrap180(after-before)).toFixed(2)}°)`);
    // 다만 **연속으로** 같은 말을 하면 따라가야 합니다 — 진짜로 틀어진 경우.
    for (let i = 0; i < 30; i++) { nw.pushGyro(rawOf(TRUE_AZ), 1.0); nw.pushMagnetic(wrap360(TRUE_AZ + 120), true); }
    const moved = Math.abs(wrap180(nw.heading() - before));
    ok(moved > 60, `연속으로 같은 말을 하면 따라간다 (${moved.toFixed(1)}°)`);
  }

  console.log('\n== ⑤ 태양 스냅: 정답을 알면 즉시 맞춘다 ==');
  {
    const TRUE_AZ = 253;
    const nw = createHeadingFusion();
    for (let i = 0; i < 20; i++) { nw.pushGyro(rawOf(TRUE_AZ), 1.0); nw.pushMagnetic(wrap360(TRUE_AZ + 40), true); }
    nw.snapTo(TRUE_AZ);
    const e = Math.abs(wrap180(nw.heading() - TRUE_AZ));
    ok(e < 0.01, `스냅 직후 정확히 맞는다 (${e.toFixed(3)}°)`);
    // 스냅 뒤 자기계가 40° 틀린 말을 계속해도 천천히만 끌려가야 합니다.
    for (let i = 0; i < 20; i++) { nw.pushGyro(rawOf(TRUE_AZ), 1.0); nw.pushMagnetic(wrap360(TRUE_AZ + 40), true); }
    const drift = Math.abs(wrap180(nw.heading() - TRUE_AZ));
    ok(drift < 15, `스냅 뒤에는 자기계가 천천히만 끌어간다 (${drift.toFixed(1)}°)`);
  }

  console.log('\n== ⑥ 0°/360° 경계에서 평균이 안 튄다 ==');
  //
  // 씨앗을 산술평균으로 내면 359° 와 1° 의 평균이 180° 가 됩니다.
  // 원형 평균이라 그런 일이 없어야 합니다.
  {
    const TRUE_AZ = 0;
    const nw = createHeadingFusion();
    for (let i = 0; i < 12; i++) {
      nw.pushGyro(rawOf(TRUE_AZ), 1.0);
      nw.pushMagnetic(i % 2 === 0 ? 359 : 1, true);   // 참값 0° 를 둘러싼 표본
    }
    const e = Math.abs(wrap180(nw.heading() - 0));
    ok(e < 2, `경계를 넘나드는 표본의 평균이 0° 근처다 (${e.toFixed(2)}°)`);
  }

  console.log('\n== ⑦ 상태를 밖에서 볼 수 있다 ==');
  {
    const nw = createHeadingFusion();
    ok(nw.heading() === null, `자이로가 없으면 방위가 null (모른다고 말한다)`);
    const s0 = nw.status();
    ok(s0.hasGyro === false && s0.hasMagnetic === false && s0.seeded === false,
      `처음 상태가 '아무것도 안 왔음' 이다`);
    nw.pushMagnetic(100, false);
    ok(nw.status().lastReject === 'no-gyro' && nw.status().trueNorth === false,
      `자북만 받고 있으면 그렇게 알린다 (편각만큼 어긋남)`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
