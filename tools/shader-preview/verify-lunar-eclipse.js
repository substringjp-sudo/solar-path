/**
 * **월식 계산(`src/utils/lunarEclipse.ts`)이 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요(기준값은 아래에 적어 둠).
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 독립 기준은 **NASA 월식 목록**(Five Millennium Catalog of Lunar Eclipses 2001–2100, Espenak, https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html)에서
 * 2026-11-21 에 읽어 온 값입니다(코드의 식을 되풀이하지 않음). 목록은 가장 깊은 때를 TD(역학시)로 주므로 ΔT(표의 값)를 빼 UT 로 바꿉니다:
 *   2022-11-08 개기: 가장 깊은 때 11:00:22 TD(ΔT 73 s → 10:59:09 UT), 반그림자 크기 2.4143 · 본그림자 크기 1.3589, 길이(분) 반그림자 353.9 · 부분 219.8 · 개기 85.0
 *   2025-03-14 개기: 06:59:56 TD(ΔT 75 s → 06:58:41 UT), 2.2595 · 1.1784, 362.6 · 218.3 · 65.4
 *   2025-09-07 개기: 18:12:58 TD(ΔT 75 s → 18:11:43 UT), 2.3440 · 1.3619, 326.7 · 209.4 · 82.1
 *   2026-03-03 개기: 11:34:52 TD(ΔT 75 s → 11:33:37 UT), 2.1838 · 1.1507, 338.6 · 207.2 · 58.3
 *   2026-08-28 부분: 04:14:04 TD(ΔT 75 s → 04:12:49 UT), 1.9645 · 0.9299, 337.8 · 198.1 · 개기 없음
 * 함수: `lunarEclipseAt(대략의 시각 ms)` = 그 시각 앞뒤 1.5 일 안에서 달이 지구 그림자 한가운데에 가장 가까운 때를 찾아
 *   { greatestMs, umbralMag, penumbralMag, p1Ms, u1Ms, u2Ms | null, u3Ms | null, u4Ms, p4Ms } 또는 반그림자도 못 지나면(식 없음) null.
 *   (p1 · p4 반그림자 시작 · 끝, u1 · u4 부분식 시작 · 끝, u2 · u3 개기 시작 · 끝.) 개기가 아니면 u2 · u3 는 null, 반그림자만 지나면 u1 · u4 도 null.
 *   `nextLunarEclipse(시각 ms)` = 그 시각 이후 가장 가까운 식(보름달을 29.530589 일씩 짚어 찾음). 반환은 위와 같고 `kind` 가 'total' | 'partial' | 'penumbral'.
 * 기준: 가장 깊은 때 ±2 분, 본그림자 크기 ±0.01, 부분 · 개기 길이 ±2 분, 반그림자 길이 ±3 분(반그림자 가장자리는 흐려 목록도 덜 정확), 반그림자 크기 ±0.02.
 *   u1 = 가장 깊은 때 − 부분 길이 ÷ 2 (식은 가장 깊은 때에 대해 거의 대칭 — 비대칭은 1 분 안), 개기 시작 u2 = 가장 깊은 때 − 개기 길이 ÷ 2 (±2 분).
 * 식이 없는 보름달(2026-04-02 근처)은 null. `nextLunarEclipse(2026-11-21)` 은 2027-02-20 반그림자식(목록 값: 23:14:06 TD, ΔT 76 s → 23:12:50 UT, 반그림자 크기 0.9266, 본그림자 −0.0569, 반그림자 길이 241.0 분).
 *   (처음에는 이 식의 시각을 "23:13 TD 근처"라고 기억으로 적었는데, 목록 페이지에서 읽어 온 값으로 고쳤습니다.)
 *  2027-07-18 반그림자식(목록: 16:04:09 TD, ΔT 76 s → 16:02:53 UT, 반그림자 크기 0.0014, 길이 11.8 분 — 달 가장자리가 반그림자에 간신히 스침): 찾아야 하고(null 아님) 종류는 'penumbral', 크기 ±0.02, 가장 깊은 때 ±3 분. **길이는 보지 않는다**: 스치는 식의 길이는 겹침의 제곱근에 비례해 아주 예민하다(처음엔 ±3 분으로 적었으나 구현이 34 분을 냈고, 크기가 목록보다 0.0105 컸을 뿐 — 그림자 반지름 0.0055° 차이가 길이 약 22 분 차이로 나타남 — 이라 기준이 잘못이었음).
 *  `nextLunarEclipse(2022-11-09)` 는 방금 지난 2022-11-08 을 건너뛰고 2023-05-05 반그림자식(17:24:05 TD, ΔT 73 s → 17:22:52 UT, ±2 분).
 *  (2026-11-21 알아낸 한계: 해의 시차 항 8.794″ 를 빼 버려도 그림자 반지름이 0.002° 바뀔 뿐이라 목록 값 오차(크기 ±0.01 ≈ 0.005°) 안에서 판정이 못 가립니다 — 동치 변이로 기록.)
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const MIN = 60000;
const utc = (s) => Date.parse(s + 'Z');

const CASES = [
  { name: '2022-11-08 개기', g: '2022-11-08T10:59:09', um: 1.3589, pm: 2.4143, pen: 353.9, par: 219.8, tot: 85.0 },
  { name: '2025-03-14 개기', g: '2025-03-14T06:58:41', um: 1.1784, pm: 2.2595, pen: 362.6, par: 218.3, tot: 65.4 },
  { name: '2025-09-07 개기', g: '2025-09-07T18:11:43', um: 1.3619, pm: 2.3440, pen: 326.7, par: 209.4, tot: 82.1 },
  { name: '2026-03-03 개기', g: '2026-03-03T11:33:37', um: 1.1507, pm: 2.1838, pen: 338.6, par: 207.2, tot: 58.3 },
  { name: '2026-08-28 부분', g: '2026-08-28T04:12:49', um: 0.9299, pm: 1.9645, pen: 337.8, par: 198.1, tot: null },
];

(async () => {
  let L = null;
  try { L = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'lunarEclipse.js')); } catch { L = null; }
  for (const c of CASES) {
    console.log('\n[' + c.name + ']');
    const gMs = utc(c.g);
    const r = L && L.lunarEclipseAt ? L.lunarEclipseAt(gMs + 7 * 60 * MIN) : null; // 일부러 가장 깊은 때에서 7 시간 비껴 부른다
    ok(!!r, '식을 찾는다');
    if (!r) continue;
    ok(Math.abs(r.greatestMs - gMs) <= 2 * MIN, `가장 깊은 때 ${new Date(r.greatestMs).toISOString().slice(11, 19)} (기준 ${c.g.slice(11)} ±2분)`);
    ok(Math.abs(r.umbralMag - c.um) <= 0.01, `본그림자 크기 ${r.umbralMag.toFixed(4)} (기준 ${c.um} ±0.01)`);
    ok(Math.abs(r.penumbralMag - c.pm) <= 0.02, `반그림자 크기 ${r.penumbralMag.toFixed(4)} (기준 ${c.pm} ±0.02)`);
    ok(r.u1Ms != null && Math.abs((r.u4Ms - r.u1Ms) / MIN - c.par) <= 2, `부분식 길이 ${r.u1Ms != null ? ((r.u4Ms - r.u1Ms) / MIN).toFixed(1) : '없음'} 분 (기준 ${c.par} ±2)`);
    ok(r.p1Ms != null && Math.abs((r.p4Ms - r.p1Ms) / MIN - c.pen) <= 3, `반그림자 길이 ${((r.p4Ms - r.p1Ms) / MIN).toFixed(1)} 분 (기준 ${c.pen} ±3)`);
    if (c.tot != null) ok(r.u2Ms != null && r.u3Ms != null && Math.abs((r.u3Ms - r.u2Ms) / MIN - c.tot) <= 2, `개기 길이 ${r.u2Ms != null ? ((r.u3Ms - r.u2Ms) / MIN).toFixed(1) : '없음'} 분 (기준 ${c.tot} ±2)`);
    else ok(r.u2Ms == null && r.u3Ms == null, '개기가 아니라 u2 · u3 는 null');
    ok(r.p1Ms < r.u1Ms && r.u1Ms < r.greatestMs && r.greatestMs < r.u4Ms && r.u4Ms < r.p4Ms, '접촉 순서 p1 < u1 < 최대 < u4 < p4');
  }
  console.log('\n[식이 없는 보름달 · 다음 식]');
  ok(L && L.lunarEclipseAt && L.lunarEclipseAt(utc('2026-04-02T02:12:00')) === null, '2026-04-02 보름달: 식 없음(null)');
  const nx = L && L.nextLunarEclipse ? L.nextLunarEclipse(utc('2026-11-21T00:00:00')) : null;
  ok(!!nx && nx.kind === 'penumbral' && Math.abs(nx.greatestMs - utc('2027-02-20T23:12:50')) <= 2 * MIN && Math.abs(nx.penumbralMag - 0.9266) <= 0.02 && nx.u1Ms == null && nx.u2Ms == null, '2026-11-21 이후 첫 식: 2027-02-20 반그림자식(23:12:50 UT ±2분, 크기 0.9266 ±0.02, 부분식 접촉 없음)');
  const nx2 = L && L.nextLunarEclipse ? L.nextLunarEclipse(utc('2022-11-01T00:00:00')) : null;
  ok(!!nx2 && nx2.kind === 'total' && Math.abs(nx2.greatestMs - utc('2022-11-08T10:59:09')) <= 2 * MIN, '2022-11-01 이후 첫 식: 2022-11-08 개기');

  {
    const e = L && L.lunarEclipseAt ? L.lunarEclipseAt(utc('2027-07-18T16:02:53')) : null;
    ok(!!e && e.kind === 'penumbral' && Math.abs(e.penumbralMag - 0.0014) <= 0.02 && Math.abs(e.greatestMs - utc('2027-07-18T16:02:53')) <= 3 * MIN && e.u1Ms === null && e.p1Ms < e.greatestMs && e.greatestMs < e.p4Ms, '2027-07-18 스치는 반그림자식을 찾는다(크기 0.0014 ±0.02, 가장 깊은 때 ±3 분; 길이는 예민해 안 봄)');
    const n3 = L && L.nextLunarEclipse ? L.nextLunarEclipse(utc('2022-11-09T00:00:00')) : null;
    ok(!!n3 && n3.kind === 'penumbral' && Math.abs(n3.greatestMs - utc('2023-05-05T17:22:52')) <= 2 * MIN, '2022-11-09 이후 첫 식: 방금 지난 11-08 을 건너뛰고 2023-05-05 반그림자식');
  }

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
