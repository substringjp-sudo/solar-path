/**
 * **대기 흡수·경로** 합격 판정 (`src/utils/atmosphere.ts`, `sunsetPhysics.ts`).
 *
 * 브라우저를 안 씁니다 — 여기서 재는 것은 렌더가 아니라 **복사휘도 자체**라,
 * 톤매핑과 노출을 거치기 전 값을 그대로 봅니다. 화면으로만 재면 색이
 * 틀린 것과 노출이 틀린 것이 구분되지 않습니다.
 *
 * 이 판정이 지키는 성질은 넷입니다.
 *
 *  1. **노을은 붉고 박명은 파랗다.** 이 전환이 이 앱의 전부입니다.
 *  2. **어디에서도 초록으로 뜨지 않는다.** 오랫동안 있던 결함입니다 —
 *     박명 지평선이 올리브색이었습니다.
 *  3. **시선 경로 오존이 실제로 작동한다.** 지평선에서만 적색을 깎고
 *     천정에서는 거의 아무것도 하지 않아야 합니다(오존층이 산란 공기보다
 *     위에 있으므로).
 *  4. **습도가 노을을 무디게 한다.** 수증기는 가시광에서 직접 흡수하지
 *     않고, 에어로졸을 불려서 색을 바꿉니다.
 *
 * 준비: node tools/shader-preview/stage-node.js
 * 사용: node tools/shader-preview/verify-atmosphere.js
 */
const A = require('/tmp/atmbuild/atmosphere.js');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

const SUN_AZ = 268;
const p = A.makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: 60,
});
/** 시선(방위 오프셋, 고도)에서 본 하늘. azOff 180 = 태양 반대편. */
const sky = (sunAlt, elev, azOff, alt = 0) =>
  A.skyRadiance(elev, A.angularSeparationDeg(SUN_AZ + azOff, elev, SUN_AZ, sunAlt), sunAlt, p, alt);
const green = (c) => (2 * c.g) / Math.max(1e-12, c.r + c.b);
const rb = (c) => c.r / Math.max(1e-12, c.b);

console.log('== 노을 → 박명 전환 ==');
/**
 * ⚠ 예전에는 "시민박명(-6°) 지평선이 파래짐 (R/B < 0.6)"을 **태양 방향**
 * (azOff=0)에서 요구했습니다. 실제로는 그 반대입니다 — 사진 3장(EXIF로
 * 확인한 태양고도 -1.9°~+1.4°, 전부 태양 방향)이 전부 따뜻한 색이고,
 * docs/TWILIGHT.md 5-E절도 태양 -4° 지평선의 목표를 rgb(241,199,0)(금색)로
 * 적어 뒀고, 5-G절은 -8°에서도 목표가 "탁한 주황"이라 남겨 뒀습니다.
 * 파란 것은 태양 **반대편**(지구 그림자대/금성대)이지 태양 쪽이 아닙니다
 * — 태양 방향 지평선은 잔광(afterglow)으로 한동안 따뜻하게 남습니다.
 * docs/SKY_REBUILD_PLAN.md 16절에 진단을 남겼습니다.
 */
const 일몰 = sky(0, 3, 0);
const 박명태양쪽 = sky(-6, 3, 0);
const 박명반대편천정 = sky(-6, 60, 180);
console.log(`  태양 0°  지평 R/B ${rb(일몰).toFixed(2)}   태양 -6° 지평·태양쪽 R/B ${rb(박명태양쪽).toFixed(2)}` +
  `   태양 -6° 천정·반대편 R/B ${rb(박명반대편천정).toFixed(2)}`);
ok(rb(일몰) > 3, `일몰 지평선이 뚜렷하게 붉음 (R/B ${rb(일몰).toFixed(2)})`);
// "박명은 파랗다"는 참이지만 **하늘 전체**에 대한 말이지 태양 쪽 지평선에
// 대한 말이 아닙니다. 파란 것은 천정·태양 반대편입니다.
ok(rb(박명반대편천정) < 0.3, `시민박명 천정·반대편이 파래짐 (R/B ${rb(박명반대편천정).toFixed(2)})`);
// 태양 쪽 지평선은 시민박명에도 여전히 따뜻해야 합니다(잔광).
ok(rb(박명태양쪽) > 1.2, `시민박명에도 태양쪽 지평선은 따뜻하다 (R/B ${rb(박명태양쪽).toFixed(2)})`);
// 그래도 일몰의 진한 붉은기보다는 훨씬 옅어야 "전환"이 있는 것입니다.
ok(rb(일몰) / rb(박명태양쪽) > 8, `전환이 실제로 일어남 (${(rb(일몰) / rb(박명태양쪽)).toFixed(0)}배)`);

console.log('\n== 초록 치우침 — 어느 시각·어느 고도에서도 ==');
let 최대 = 0, 어디 = '';
for (const sunAlt of [6, 2, 0, -2, -4, -6, -9]) {
  for (const elev of [3, 20, 60]) {
    for (const azOff of [0, 180]) {
      const g = green(sky(sunAlt, elev, azOff));
      if (g > 최대) { 최대 = g; 어디 = `태양 ${sunAlt}° 고도 ${elev}° ${azOff ? '반대편' : '태양쪽'}`; }
    }
  }
}
console.log(`  가장 초록으로 뜬 곳: ${어디} — 2G/(R+B) = ${최대.toFixed(3)}`);
// 파란 쪽(<1)은 문제가 아닙니다. 초록은 **G가 R·B 양쪽을 이길 때**만 생깁니다.
ok(최대 < 1.45, `어디에서도 초록으로 뜨지 않음 (최대 ${최대.toFixed(2)}, ${어디})`);

console.log('\n== 시선 경로 오존 — 지평선에서만 들어야 한다 ==');
// 오존층은 22km, 산란을 만드는 공기 거의 전부보다 **위**입니다. 천정
// airlight는 오존을 통과하지 않으므로 거의 안 깎여야 하고, 지평선을 보는
// 시선은 오존층을 접선으로 가로지르므로 적색이 뚜렷이 깎여야 합니다.
const 낮지평 = sky(6, 3, 180), 낮천정 = sky(6, 60, 180);
console.log(`  낮 반대편  지평 R/B ${rb(낮지평).toFixed(3)}   천정 R/B ${rb(낮천정).toFixed(3)}`);
ok(rb(낮지평) > rb(낮천정), `지평선이 천정보다 붉게 남음 (경로가 길어 Mie가 이김)`);
ok(green(낮천정) < 1.2, `낮 천정이 중립~파랑 (${green(낮천정).toFixed(2)})`);

console.log('\n== 고도별 주변광 — 높은 구름은 다른 하늘을 본다 ==');
/**
 * 10km 권운은 지평선이 3.2° 내려앉은 하늘을 봅니다. 지상이 이미 박명일 때
 * 그 구름 **아래쪽**에는 아직 햇빛을 받는 공기가 펼쳐져 있습니다.
 *
 * ⚠ 처음에는 "10km에서 본 **위** 하늘이 더 따뜻하다"로 단언했다가 틀렸습니다.
 * 위는 오히려 더 파랗습니다 — 머리 위 공기가 얇아 Rayleigh가 이기고,
 * 실제로 높은 구름 위 하늘은 한낮에도 짙은 남색입니다. 의미가 있는 것은
 * **아래쪽** 주변광입니다.
 */
for (const sunAlt of [-4, -6]) {
  const 지상 = sky(sunAlt, 15, 0, 0);
  const 상층 = sky(sunAlt, 15, 0, 10);
  const 밝기 = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  console.log(`  태양 ${sunAlt}° 아래 15°  지상 R/B ${rb(지상).toFixed(3)} / 휘도 ${밝기(지상).toExponential(2)}` +
    `   10km R/B ${rb(상층).toFixed(3)} / 휘도 ${밝기(상층).toExponential(2)}`);
  ok(rb(상층) > rb(지상) * 1.5,
    `태양 ${sunAlt}°: 10km에서 내려다본 공기가 지상보다 따뜻함 (${rb(지상).toFixed(2)} → ${rb(상층).toFixed(2)})`);
  ok(밝기(상층) > 밝기(지상) * 2,
    `태양 ${sunAlt}°: 그 공기는 아직 밝음 (${(밝기(상층) / 밝기(지상)).toFixed(1)}배)`);
}

console.log('\n== 습도 — 에어로졸을 불려 노을을 무디게 ==');
const 건조 = A.makeAtmosphereParams({ latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: 50 });
const 습함 = A.makeAtmosphereParams({ latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: 97 });
console.log(`  β  ${건조.betaMie.toFixed(3)} → ${습함.betaMie.toFixed(3)}` +
  `   Ångström ${건조.angstrom.toFixed(2)} → ${습함.angstrom.toFixed(2)}`);
ok(습함.betaMie > 건조.betaMie * 1.8, `습하면 에어로졸이 굵게 자람 (${(습함.betaMie / 건조.betaMie).toFixed(1)}배)`);
ok(습함.angstrom < 건조.angstrom, `큰 입자가 늘어 파장 의존성이 줄어듦`);

// ⚠ 가시거리를 관측했다면 흡습 성장은 **이미 그 값 안에** 있습니다.
// 둘 다 곱하면 같은 물을 두 번 셉니다.
const 관측 = A.makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: 97, visibilityM: 30000,
});
const 관측건조 = A.makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: 50, visibilityM: 30000,
});
console.log(`  가시거리 30km를 알 때  β  ${관측건조.betaMie.toFixed(3)} → ${관측.betaMie.toFixed(3)}`);
ok(Math.abs(관측.betaMie - 관측건조.betaMie) < 1e-6,
  `가시거리를 알면 습도를 또 세지 않음 (β 동일)`);

console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
process.exit(fail === 0 ? 0 : 1);
