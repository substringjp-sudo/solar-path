/**
 * 박명 곡선 검증 — "해 지고 너무 빨리 어두워진다" 회귀 방지.
 *
 * 이 검증이 지키려는 성질은 **절대 밝기가 아니라 곡선의 모양**입니다.
 * 실제 박명은 완만하게 시작해서 점점 가팔라집니다. 수정 전 구현은 정반대로,
 * 지평선을 넘는 1도에서 5배 떨어지고 그 뒤로 평평해졌습니다 (절벽 → 평지).
 */
global.__DEV__ = false;
const A = require('/tmp/atmbuild/atmosphere.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const p = A.makeAtmosphereParams({
  visibilityM: 30000, humidityPct: 55, latitude: 37.5, dayOfYear: 214,
});
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const horizon = a => lum(A.skyRadiance(0.5, 5, a, p));
const zenith = a => lum(A.skyRadiance(88, 90, a, p));

console.log('== 지구 그림자 기하 ==');
// R(sec δ − 1). 표준 박명 기하와 맞아야 합니다.
for (const [dep, expect] of [[1, 0.97], [2, 3.88], [4, 15.5], [6, 34.9]]) {
  const h = A.earthShadowHeightKm(dep);
  ok(Math.abs(h - expect) / expect < 0.03, `δ=${dep}° → 그림자 ${h.toFixed(2)}km (기대 ~${expect})`);
}
ok(A.earthShadowHeightKm(0) === 0, 'δ=0° → 0km');
ok(A.earthShadowHeightKm(-5) === 0, '음수 복각은 0으로 클램프');

console.log('\n== 지평선 넘기 (핵심 — 절벽이 없어야 함) ==');
const h0 = horizon(0), hm1 = horizon(-1);
const dropAtHorizon = h0 / hm1;
console.log(`  0° → -1° 감소: ${dropAtHorizon.toFixed(2)}배 (수정 전 5.09배)`);
ok(dropAtHorizon < 1.6, `지평선 통과가 완만함 (${dropAtHorizon.toFixed(2)}배 < 1.6)`);
// 0°는 낮과 이어지는 지점이므로 값이 변하면 안 됩니다.
ok(A.earthShadowLit(0) === 1 && A.earthShadowLit(0.5) === 1, '지평선 위는 감쇠 없음 (낮 렌더 불변)');

console.log('\n== 곡선 모양: 완만하게 시작해 가팔라질 것 ==');
// 도당 감소율이 단조 증가해야 합니다 (= 비율이 단조 감소).
const alts = [0, -1, -2, -3, -4, -5, -6];
const ratios = [];
for (let i = 1; i < alts.length; i++) ratios.push(horizon(alts[i]) / horizon(alts[i - 1]));
console.log('  도당 잔존율: ' + ratios.map(r => r.toFixed(3)).join(' → '));
// 단일산란이 지배하는 구간(0 ~ -5°)에서는 잔존율이 단조 감소해야 합니다.
// 그 아래에는 다중산란 꼬리가 인계받는 변곡점이 있고, 거기서 잔존율이
// 다시 살짝 올라갑니다 — 물리적으로 맞는 모양이라 단조를 요구하지 않습니다.
let monotone = true;
for (let i = 1; i < ratios.length - 1; i++) if (ratios[i] > ratios[i - 1] + 1e-6) monotone = false;
ok(monotone, '단일산란 구간에서 감소가 점점 가팔라짐');
ok(ratios[0] > 0.6, `일몰 직후 1도는 완만 (잔존율 ${ratios[0].toFixed(3)})`);
// 어느 1도 구간에서도 절벽이 없어야 합니다. 이게 원래 불만의 핵심입니다.
const worst = Math.min(...ratios);
ok(worst > 0.35, `어느 1도 구간에도 절벽 없음 (최저 잔존율 ${worst.toFixed(3)} > 0.35)`);

console.log('\n== 단조성 & 경계 ==');
let mono = true;
for (let a = 10; a >= -18; a -= 0.5) if (horizon(a - 0.5) > horizon(a) + 1e-9) mono = false;
ok(mono, '태양이 내려갈수록 항상 어두워짐 (역전 없음)');
ok(A.earthShadowLit(A.TWILIGHT_END_DEG) === 0, `천문박명(${A.TWILIGHT_END_DEG}°)에서 완전 소등`);
ok(Math.abs(zenith(-18) - lum(A.NIGHT_SKY)) < 1e-6, '천문박명 이후는 밤하늘 바닥');

console.log('\n== 다중산란 꼬리 (박명이 -5°에서 끊기지 않을 것) ==');
ok(A.TWILIGHT_MS_SCALE_HEIGHT_KM > A.TWILIGHT_SCALE_HEIGHT_KM,
   `다중산란 척도고도가 더 큼 (${A.TWILIGHT_MS_SCALE_HEIGHT_KM} > ${A.TWILIGHT_SCALE_HEIGHT_KM})`);
for (const a of [-6, -8, -10]) {
  ok(A.earthShadowLitMS(a) > A.earthShadowLit(a),
     `${a}°: 다중산란 ${A.earthShadowLitMS(a).toFixed(4)} > 단일산란 ${A.earthShadowLit(a).toFixed(4)}`);
}
// 시민박명(-6°)은 밤하늘 바닥보다 확실히 밝아야 합니다.
const night = lum(A.NIGHT_SKY);
console.log(`  -6° 지평선 / 밤하늘 바닥 = ${(horizon(-6) / night).toFixed(1)}배`);
ok(horizon(-6) / night > 6, `시민박명에 잔광이 남음 (${(horizon(-6) / night).toFixed(1)}배 > 6)`);
ok(horizon(-8) / night > 2, `항해박명에도 흔적이 남음 (${(horizon(-8) / night).toFixed(1)}배 > 2)`);

console.log('\n== 실측 대조 ==');
// 천정휘도 0° → -6° 감소는 관측상 약 40배입니다.
//
// 우리 모델은 그 1/4쯤에 머뭅니다 — 다중산란 꼬리를 살리면 늦은 박명의
// 천정이 실제보다 밝게 남기 때문입니다. 꼬리를 줄이면 -6°/-8°가 배포본보다
// 어두워져서, 불만을 고치려다 회귀를 넣게 됩니다
// (TWILIGHT_MS_SCALE_HEIGHT_KM 주석의 측정표 참고).
//
// **이 검사가 지키는 것**: 알려진 한계를 고정해 둡니다. 꼬리를 더 키워
// 천정이 아예 안 어두워지는 방향으로 흘러가면 하한에 걸립니다.
const z = zenith(0) / zenith(-6);
console.log(`  천정 0° → -6°: ${z.toFixed(1)}배 (실측 약 40배 — 알려진 한계, 주석 참고)`);
ok(z > 8 && z < 80, `밤낮 구분이 유지됨 (${z.toFixed(1)}배)`);

console.log('\n== TS ↔ GLSL 상수 공유 ==');
// 셰이더는 TS 상수를 주입받아야 합니다. 숫자가 하드코딩되면 두 구현이 갈라집니다.
const glsl = A.ATMOSPHERE_GLSL;
ok(glsl.includes('atm_earthShadowLit'), 'GLSL에 atm_earthShadowLit 존재');
ok(glsl.includes('atm_earthShadowLitMS'), 'GLSL에 atm_earthShadowLitMS 존재');
ok(glsl.includes(String(A.TWILIGHT_SCALE_HEIGHT_KM)), '단일산란 척도고도가 주입됨');
ok(glsl.includes(String(A.TWILIGHT_MS_SCALE_HEIGHT_KM)), '다중산란 척도고도가 주입됨');
ok(!/pow\(twilight, ?2\.2\)/.test(glsl), '옛 임의 램프(pow(twilight,2.2))가 남아 있지 않음');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
