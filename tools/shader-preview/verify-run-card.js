/**
 * **타임랩스 촬영 중 카드의 밝기 곡선 · 배터리 줄(`src/utils/runCurve.ts`)이 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 촬영 중 카드(목업 12)의 "예측 대 실제 밝기 곡선"은 두 선을 **같은 눈금(단, 첫 장면 대비 몇 단)** 위에 겹쳐 그립니다.
 *   예측 = 장면(맑은 하늘) 밝기의 단 변화(`exposureCurve.exposureStops`), 실제 = **찍은 사진의 평균 밝기**의 단 변화. 자동 노출이 장면을 따라가면 실제는 0 근처에 머물고,
 *   따라가지 못하면(너무 어두움 · 노출 한계) 예측을 따라 내려갑니다 — 그 차이를 눈으로 보게 하는 것이 목적이고, 둘이 같아야 한다는 뜻이 아닙니다.
 *
 *  1. `lumaFromRgba(rgba)`: 평균 **선형 밝기** 0 ~ 1. 화소마다 채널을 (v ÷ 255)^2.2 로 선형화하고 Rec.709 계수(0.2126 · 0.7152 · 0.0722)로 합친 뒤 화소 평균. 알파는 무시.
 *     흰 화소 [255,255,255,255] → 1, 검은 화소 → 0, 흰 + 검은 두 화소 → 0.5, 순수 빨강 [255,0,0,255] → 0.2126, 회색 128 → (128 ÷ 255)^2.2 = 0.2196(손계산: ln(0.50196) = −0.68923, × 2.2 = −1.51631, e^ = 0.21957).
 *     빈 목록 · 4 의 배수가 아닌 길이 → null.
 *  2. `photoStops(밝기 목록, 바닥 = 0.002)`: 첫 **유효한** 값(숫자)을 기준(0)으로 log2(max(값, 바닥) ÷ max(기준, 바닥)). 유효하지 않은 칸은 null 그대로.
 *     [0.2, 0.1, 0.05] → [0, −1, −2]. [0.2, 0.0001] → [0, log2(0.002 ÷ 0.2) = −6.644](바닥에서 멈춤). [null, 0.2, 0.4] → [null, 0, +1]. 빈 목록 → 빈 목록. 전부 null → 전부 null.
     기준 값도 바닥으로 자른다: [0.0001, 0.2] → [0, log2(0.2 ÷ 0.002) = +6.644](기준 0.0001 이 바닥 0.002 로 올려져 비교됨).
 *  3. `curvePaths(예측 단 목록(균등 간격), 실제 [{ f(0 ~ 1 구간 위치), stops }], 폭, 높이)` = { pred, actual }: 점 글자 "x,y x,y …". 두 선이 **한 눈금**: 모든 유효한 값의 최댓값이 위(0), 최솟값이 아래(높이). 모두 같으면 가운데.
 *     예측 x 는 i × 폭 ÷ (n − 1), 실제 x 는 f × 폭(f 는 0 ~ 1 로 자름). null 은 건너뜀. 점이 둘 미만이면 그 선은 빈 글자(점 하나는 선이 아니다).
 *     예측 [0, −5, −10], 실제 [{f:0,stops:0},{f:0.5,stops:−4},{f:1,stops:null}], 100 × 20 → pred "0,0 50,10 100,20", actual "0,0 50,8"(눈금이 −10 ~ 0 이라 −4 → 8).
 *     실제가 예측보다 아래로 더 내려가면(예: 실제 −12) 눈금이 −12 까지 넓어져 예측도 그 눈금에 맞춰진다.
 *  4. `batteryLine(수준 0 ~ 1 | null, 충전 중, 절전 모드, 언어)`: 수준이 없으면 빈 글자. "배터리 62%"(반올림), 충전 중이면 뒤에 " · 충전 중", 절전 모드면 뒤에 " · 절전 모드"(둘 다면 충전 중 먼저). 영어 "Battery 62% · Charging · Low power", 일본어 "バッテリー 62% · 充電中 · 省電力".
 *     `batteryLow(수준, 충전 중)` = 수준이 15 % 이하이고 충전 중이 아닐 때 참(수준 없음 → 거짓). 정확히 0.15 는 참, 0.151 은 거짓.
 *  5. 한계(화면에도 적지 않고 PR 에 적는다): 기기 **온도**는 Expo 가 주는 API 가 없어 칸을 만들지 않는다(지어내지 않음).
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, t = 1e-3) => typeof a === 'number' && Math.abs(a - b) <= t;

(async () => {
  let R = null;
  try { R = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'runCurve.js')); } catch { R = null; }
  const f = (n) => (R && R[n] ? R[n] : () => 'none');

  console.log('\n[1] lumaFromRgba');
  const lu = f('lumaFromRgba');
  ok(near(lu([255, 255, 255, 255]), 1, 1e-9) && near(lu([0, 0, 0, 255]), 0, 1e-9), '흰 1 · 검정 0');
  ok(near(lu([255, 255, 255, 255, 0, 0, 0, 255]), 0.5, 1e-9), '흰 + 검정 → 0.5');
  ok(near(lu([255, 0, 0, 255]), 0.2126, 1e-6), '순수 빨강 0.2126');
  ok(near(lu([128, 128, 128, 255]), 0.2196, 1e-3), '회색 128 → 0.2196(감마 2.2)');
  ok(near(lu([255, 255, 255, 0]), 1, 1e-9), '알파는 무시');
  ok(lu([]) === null && lu([1, 2, 3]) === null, '빈 목록 · 4 의 배수가 아니면 null');

  console.log('\n[2] photoStops');
  const ps = f('photoStops');
  const a = ps([0.2, 0.1, 0.05]);
  ok(Array.isArray(a) && near(a[0], 0, 1e-9) && near(a[1], -1, 1e-9) && near(a[2], -2, 1e-9), '[0.2, 0.1, 0.05] → [0, −1, −2]');
  const b = ps([0.2, 0.0001]);
  ok(Array.isArray(b) && near(b[1], Math.log2(0.002 / 0.2), 1e-9) && near(b[1], -6.644, 1e-3), '바닥 0.002 에서 멈춤(−6.644)');
  const c = ps([null, 0.2, 0.4]);
  ok(Array.isArray(c) && c[0] === null && near(c[1], 0, 1e-9) && near(c[2], 1, 1e-9), '첫 유효한 값이 기준');
  const d0 = ps([0.0001, 0.2]);
  ok(Array.isArray(d0) && near(d0[0], 0, 1e-9) && near(d0[1], 6.644, 1e-3), '기준도 바닥으로 자름: [0.0001, 0.2] → [0, +6.644]');
  ok(Array.isArray(ps([])) && ps([]).length === 0 && Array.isArray(ps([null, null])) && ps([null, null]).every((v) => v === null), '빈 목록 · 전부 null');

  console.log('\n[3] curvePaths');
  const cp = f('curvePaths');
  const r1 = cp([0, -5, -10], [{ f: 0, stops: 0 }, { f: 0.5, stops: -4 }, { f: 1, stops: null }], 100, 20);
  ok(r1 && r1.pred === '0,0 50,10 100,20' && r1.actual === '0,0 50,8', '예측 "0,0 50,10 100,20", 실제 "0,0 50,8"(−4 → 8)');
  const r2 = cp([0, -5, -10], [{ f: 0, stops: 0 }, { f: 1, stops: -12 }], 100, 20);
  ok(r2 && r2.actual === '0,0 100,20' && r2.pred === '0,0 50,8.33 100,16.67', '실제가 −12 까지 내려가면 눈금이 넓어져 예측도 맞춰짐');
  const r3 = cp([0, 0, 0], [{ f: 0, stops: 0 }, { f: 1, stops: 0 }], 100, 20);
  ok(r3 && r3.pred === '0,10 50,10 100,10' && r3.actual === '0,10 100,10', '모두 같으면 가운데');
  const r4 = cp([0, -2], [{ f: 0.5, stops: -1 }], 100, 20);
  ok(r4 && r4.actual === '' && r4.pred === '0,0 100,20', '점 하나뿐인 실제는 빈 글자');
  const r5 = cp([0, -2], [{ f: -1, stops: 0 }, { f: 2, stops: -2 }], 100, 20);
  ok(r5 && r5.actual === '0,0 100,20', 'f 는 0 ~ 1 로 자름');

  console.log('\n[4] batteryLine · batteryLow');
  const bl = f('batteryLine'), lo = f('batteryLow');
  ok(bl(0.62, false, false, 'ko') === '배터리 62%' && bl(0.624, false, false, 'ko') === '배터리 62%' && bl(0.625, false, false, 'ko') === '배터리 63%', '반올림');
  ok(bl(0.62, true, false, 'ko') === '배터리 62% · 충전 중' && bl(0.08, false, true, 'ko') === '배터리 8% · 절전 모드' && bl(0.5, true, true, 'ko') === '배터리 50% · 충전 중 · 절전 모드', '충전 중 · 절전 모드 글');
  ok(bl(0.5, true, true, 'en') === 'Battery 50% · Charging · Low power' && bl(0.5, true, true, 'ja') === 'バッテリー 50% · 充電中 · 省電力', '영어 · 일본어');
  ok(bl(null, false, false, 'ko') === '' && bl(NaN, false, false, 'ko') === '', '수준이 없으면 빈 글자');
  ok(lo(0.15, false) === true && lo(0.151, false) === false && lo(0.05, true) === false && lo(null, false) === false, '15 % 이하이고 충전 중이 아닐 때만');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
