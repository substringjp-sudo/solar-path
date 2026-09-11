/**
 * **지도에서 위치를 옮기는 문과 자리** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/locationPick.ts` 머리말에 있습니다.
 *
 * ## 이 자가 지키려는 것
 *
 * 1. **문턱이 위도 함수다** — 도수로 박으면 고위도에서 크게 틀립니다.
 * 2. **탭의 뜻이 축척을 따라 뒤집힌다** — 그게 롱프레스를 몰라도 메뉴를
 *    발견하게 하는 장치입니다. 한쪽으로 굳으면 그 장치가 죽습니다.
 * 3. **상단 줄이 안 겹친다** — 배지 너비 상한이 실제로 일을 하는지,
 *    그리고 상한이 없으면 정말 부딪히는지(음성 대조)까지 봅니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-location-pick.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'locationPick.js'));
  const {
    canPickLocation, locationTapAction, kmPerLonDeg, PICK_MAX_VIEW_KM,
    topButtonsWidth, solarBadgeMaxWidth, polarInsetWidth, bottomLeftMaxWidth,
    TOP_BTN_SIZE, TOP_BTN_GAP, TOP_EDGE, TOP_MIN_CLEARANCE,
  } = M;

  const SEOUL = 37.4863;
  /** 실측한 태양 배지 너비(px) — 목업을 앱과 같은 치수로 그려 쟀습니다. */
  const BADGE_MEASURED = 213;
  const BUTTONS = 3;               // 안내 · 투영 · 위치

  // ── [1] 문턱이 km 이고 위도를 따르는가 ────────────────────────────
  console.log('\n[1] 고를 수 있는 축척');
  {
    console.log(`      문턱 ${PICK_MAX_VIEW_KM}km — 지형 표본의 가장 바깥 고리`);
    for (const la of [0, 37.4863, 60]) {
      const deg = PICK_MAX_VIEW_KM / kmPerLonDeg(la);
      console.log(`        위도 ${String(la).padStart(7)}° → ${deg.toFixed(3)}° 까지 고를 수 있음`);
    }
    ok(canPickLocation(0.3, SEOUL), `0.3°(26km)는 고를 수 있다`);
    ok(!canPickLocation(0.6, SEOUL), `0.6°(53km)는 못 고른다`);
    ok(!canPickLocation(30, SEOUL), `30° 는 당연히 못 고른다`);

    // ⚠ 같은 도수라도 위도에 따라 갈려야 합니다.
    const d = 0.5;
    console.log(`      같은 ${d}° 가 — 적도: ${canPickLocation(d, 0) ? '가능' : '불가'}`
              + ` · 서울: ${canPickLocation(d, SEOUL) ? '가능' : '불가'}`
              + ` · 60°N: ${canPickLocation(d, 60) ? '가능' : '불가'}`);
    ok(!canPickLocation(d, 0) && canPickLocation(d, 60),
       `같은 도수라도 위도에 따라 갈린다 — 문턱이 km 이지 도가 아니다`);

    // 경계에서 정확히 갈리는가.
    const edge = PICK_MAX_VIEW_KM / kmPerLonDeg(SEOUL);
    ok(canPickLocation(edge * 0.999, SEOUL) && !canPickLocation(edge * 1.001, SEOUL),
       `경계(${edge.toFixed(3)}°)에서 정확히 갈린다`);
  }

  // ── [2] ⚠ 탭의 뜻이 뒤집히는가 ────────────────────────────────────
  //    이게 없으면 저장한 곳 목록이 영영 안 발견될 수 있습니다.
  console.log('\n[2] 탭의 뜻 — 축척을 따라 뒤집히는가');
  {
    ok(locationTapAction(0.3, SEOUL) === 'move', `좁으면 탭 = 한가운데로 이동`);
    ok(locationTapAction(3, SEOUL) === 'menu', `넓으면 탭 = 메뉴`);
    ok(locationTapAction(200, SEOUL) === 'menu', `구 축척에서도 메뉴`);

    // 두 뜻이 **둘 다 실제로 나오는가** — 한쪽으로 굳으면 발견 장치가 죽습니다.
    const seen = new Set();
    for (let d = 0.02; d <= 360; d *= 1.2) seen.add(locationTapAction(d, SEOUL));
    console.log(`      0.02°~360° 를 훑으면 나오는 뜻: ${[...seen].join(' · ')}`);
    ok(seen.size === 2, `두 뜻이 모두 실제로 나온다 — 줌만 빼면 메뉴를 만난다`);

    // 한 번만 바뀌어야 합니다(오락가락하면 안 됨).
    let flips = 0, prev = null;
    for (let d = 0.02; d <= 360; d *= 1.02) {
      const a = locationTapAction(d, SEOUL);
      if (prev !== null && a !== prev) flips++;
      prev = a;
    }
    ok(flips === 1, `축척을 넓히는 동안 한 번만 바뀐다 (${flips}회)`);
  }

  // ── [3] ⚠ 상단 줄이 안 겹치는가 ───────────────────────────────────
  console.log('\n[3] 상단 줄 자리 — 배지와 버튼');
  {
    const w3 = topButtonsWidth(BUTTONS);
    console.log(`      버튼 ${BUTTONS}개가 오른쪽에서 ${w3}px (= ${TOP_EDGE} + ${BUTTONS}×${TOP_BTN_SIZE} + ${BUTTONS - 1}×${TOP_BTN_GAP})`);
    // 지금 코드의 right 값(10 · 48 · 86)과 맞아야 합니다.
    ok(w3 === 10 + 3 * 32 + 2 * 6, `버튼 폭 계산이 right 10·48·86 과 맞는다 (${w3}px)`);

    for (const sw of [320, 360, 390, 430]) {
      const cap = solarBadgeMaxWidth(sw, BUTTONS);
      const btnLeft = sw - w3;
      const badgeRight = TOP_EDGE + cap;
      console.log(`        폭 ${sw}px → 배지 상한 ${cap}px · 버튼 시작 ${btnLeft} · 배지 끝 ${badgeRight}`
                + ` → ${badgeRight <= btnLeft ? '틈 ' + (btnLeft - badgeRight) + 'px' : '겹침!'}`);
      ok(badgeRight + TOP_MIN_CLEARANCE <= btnLeft + TOP_MIN_CLEARANCE,
         `폭 ${sw}px 에서 안 겹친다`);
    }

    // ⚠ **음성 대조** — 상한이 없으면 정말 부딪히는가.
    //    안 부딪힌다면 이 상한은 아무 일도 안 하는 것입니다.
    const btnLeft320 = 320 - w3;
    const overlap320 = TOP_EDGE + BADGE_MEASURED - btnLeft320;
    console.log(`      상한 없이 실측 배지(${BADGE_MEASURED}px)를 그대로 두면 — 폭 320px 에서 ${overlap320}px 겹침`);
    ok(overlap320 > 0, `상한이 없으면 320px 에서 실제로 겹친다 — 상한이 공허하지 않다`);
    ok(solarBadgeMaxWidth(320, BUTTONS) < BADGE_MEASURED,
       `상한이 실측 배지보다 좁다 — 320px 에서 실제로 잘라 낸다`);

    // 큰 화면에서는 자를 필요가 없어야 합니다(공연히 줄이지 않기).
    ok(solarBadgeMaxWidth(430, BUTTONS) > BADGE_MEASURED,
       `큰 화면에서는 상한이 배지보다 넓다 — 공연히 안 줄인다`);

    // 버튼이 늘면 상한이 줄어야 합니다.
    ok(solarBadgeMaxWidth(360, 4) < solarBadgeMaxWidth(360, 3),
       `버튼이 하나 늘면 상한이 줄어든다`);
    // 아주 좁은 화면에서도 0 이나 음수가 되면 안 됩니다.
    ok(solarBadgeMaxWidth(200, BUTTONS) >= 80, `아주 좁아도 바닥(80px)을 지킨다`);
  }


  // ── [4] ⚠ 왼쪽 아래 세로줄 — 제가 만든 겹침의 고침 ─────────────────
  //    구름 읽기값(left:10,bottom:10)과 범례(left:10,bottom:8)가 같은
  //    자리였습니다. 고침은 둘을 한 세로줄에 넣고 너비를 묶는 것입니다.
  console.log('\n[4] 왼쪽 아래 세로줄 — 오른쪽 아래 인셋과 안 부딪히는가');
  {
    /** 지도 몸통은 화면에서 좌우 여백(16×2)을 뺀 폭입니다. */
    const mapOf = sw => sw - 32;
    for (const sw of [320, 360, 390, 430]) {
      const mw = mapOf(sw);
      const inset = polarInsetWidth(sw);
      const cap = bottomLeftMaxWidth(mw, sw, true);
      const gap = mw - TOP_EDGE - cap - inset - TOP_EDGE;
      console.log(`        폭 ${sw}px → 지도 ${mw} · 인셋 ${inset.toFixed(0)} · 세로줄 상한 ${cap.toFixed(0)}`
                + ` → 인셋까지 틈 ${gap.toFixed(0)}px`);
      ok(gap >= TOP_MIN_CLEARANCE - 1e-9, `폭 ${sw}px 에서 인셋과 안 부딪힌다`);
      // ⚠ 바닥(120px)이 물리면 상한이 거짓말이 됩니다 — 실제 기기 폭에서는
      //    한 번도 안 물려야 합니다.
      ok(cap > 120, `폭 ${sw}px 에서 바닥이 안 물린다 (${cap.toFixed(0)}px)`);
    }

    // ⚠ **음성 대조** — 인셋을 안 세는 상한을 쓰면 정말 파고드는가.
    //    안 파고든다면 인셋 항은 아무 일도 안 하는 것입니다.
    const sw = 390, mw = mapOf(sw);
    const naive = bottomLeftMaxWidth(mw, sw, false);
    const intrude = TOP_EDGE + naive - (mw - polarInsetWidth(sw) - TOP_EDGE);
    console.log(`      인셋을 안 세면 — 폭 ${sw}px 에서 ${intrude.toFixed(0)}px 파고듦`);
    ok(intrude > 0, `인셋을 안 세면 실제로 파고든다 — 인셋 항이 공허하지 않다`);
    ok(bottomLeftMaxWidth(mw, sw, true) < naive, `인셋이 뜨면 상한이 줄어든다`);

    // 인셋이 없을 때 공연히 줄이지 않아야 합니다.
    ok(naive === mw - 2 * TOP_EDGE, `인셋이 없으면 좌우 여백만 뺀다 (${naive}px)`);

    // 인셋 크기가 화면을 따라 갈리는가(상수로 박으면 큰 화면에서 헛돕니다).
    console.log(`      인셋 폭 — 320px: ${polarInsetWidth(320).toFixed(0)} ·`
              + ` 390px: ${polarInsetWidth(390).toFixed(0)} · 태블릿 1024px: ${polarInsetWidth(1024).toFixed(0)}`);
    ok(polarInsetWidth(320) < polarInsetWidth(390), `작은 화면에서 인셋이 더 작다`);
    ok(polarInsetWidth(1024) === polarInsetWidth(400), `큰 화면에서는 132px 로 포화한다 — 무한정 안 커진다`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
