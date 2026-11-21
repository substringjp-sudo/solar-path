/**
 * **월식 촬영 계획(`src/utils/eclipsePlan.ts`)이 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요.
 * 월식 자체(접촉 시각 · 크기)는 `verify-lunar-eclipse.js` 가 NASA 목록으로 이미 판정했다. 여기서는 그 위에 쌓은 **단계 시간표 · 관측지 가시성 · 단계별 노출 추천 · 지금 단계**를 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 함수: `planEclipse(e: LunarEclipse, latDeg, lonDeg)` → `{ stages, visible, visibleFromMs, visibleToMs }` 또는 입력이 틀리면(식 null · 위경도가 숫자 아님) null.
 *   `stages`: 시간 순서의 단계 `{ key, startMs, endMs, visible }`, key 는 'penumbral' | 'partial' | 'total'. 개기식은 5 단계(반그림자 p1→u1, 부분 u1→u2, 개기 u2→u3, 부분 u3→u4, 반그림자 u4→p4), 부분식은 3 단계(p1→u1, u1→u4, u4→p4), 반그림자식은 1 단계(p1→p4). 이웃 단계는 끝 = 다음 시작으로 이어진다.
 *   `visible`(단계): 그 단계 안에서 달이 **한 순간이라도** 수평선 위(보이는 고도 > 0)이면 true. `visible`(전체) = 어느 한 단계라도 true. `visibleFromMs/ToMs` = 식 구간(p1~p4) 안에서 달이 수평선 위인 처음 · 마지막 때(없으면 null).
 * 기준 1(단계 구조): 2025-03-14 개기 5 단계, 길이 = NASA 목록(부분 218.3 분 = 두 부분 단계 + 개기 합, 개기 65.4 분, 반그림자 362.6 분 전체) ±2 분(반그림자는 ±3 분). 2026-08-28 부분식 3 단계, 2027-07-18 스치는 반그림자식 1 단계.
 * 기준 2(가시성): 달은 **해의 반대쪽 점 근처**(황위 ≤ 0.6°, 시차 ≤ 1°)라, 독립 손계산으로 해의 반대점 고도를 쓴다(해 위치는 천문 연감의 단순식 L = 280.460 + 0.9856474 d, 반대점 적경 · 적위, GMST = 18.6974 + 24.0657098 d 시). 허용 오차: 고도 ±1.7° 상당 → 수평선 통과 시각 ±12 분. 손계산(2026-11-21, node 로 계산):
 *    - 뉴욕(40.71, −74.0) 2025-03-14: 식 전 구간에서 반대점 고도 +17.8° ~ +51.6° → 전 단계 보임, `visibleFromMs` = p1(이미 떠 있음), `visibleToMs` = p4.
 *    - 도쿄(35.68, 139.69) 2025-03-14: 가장 깊은 때 −20.8°, 달이 가장 깊은 때 + 105 분(08:43 UT)쯤 뜸 → 그 앞 단계(반그림자 · 부분 · 개기)는 안 보이고 뒤쪽 부분(+105 분은 u4 = +109 분 전)과 반그림자 끝만 보임. `visibleFromMs` ≈ 가장 깊은 때 + 105 분(±12 분).
 *    - 런던(51.5, −0.12) 2025-09-07: 가장 깊은 때 −2.4°, +16 분에 뜸(18:28 UT) → 개기 단계(u2 ≈ −41 분 ~ u3 ≈ +41 분)는 그 뒤쪽이 보여 **보임**, 그 앞의 반그림자 · 부분 단계는 보이지 않음. `visibleFromMs` ≈ 가장 깊은 때 + 16 분(±12 분).
 *    - 도쿄 2025-09-07: 처음엔 위로 올라 있고(+46.7°) 가장 깊은 때 +25.2° → +160 분에 −5.9° (달이 지는 중, 지는 때 ≈ +140 분) → `visibleFromMs` = p1, `visibleToMs` ≈ 가장 깊은 때 + 140 분(±12 분).
 *    - 경계의 정의: `visibleFromMs/ToMs` 에서 달의 보이는 고도(굴절 포함)는 0 ±0.1° 이다(10 초 간격 이분법).
 * 기준 3(단계별 노출, 지침): 달 밝기를 EV100 로 놓는다 — 보름달 ≈ 14(맑은 날 "달 16 규칙" ISO 100 f/11 1/125 = EV100 13.9 ≈ 14). 반그림자 · 부분 단계는 밝은 쪽 기준으로 EV 14(어두운 쪽은 안 노출), 개기 단계는 가장자리(u2 · u3 근처) EV 8, 가운데(가장 깊은 때) EV 4(보름달보다 약 10 단 어두움 — 단하인 L=2 의 개기 월식 값, 에스페낙의 월식 노출표와 같은 규모).
 *   추천은 `adviseMoonExposure(ev100)` = `{ iso, shutterS, shutterText }`: 조리개 f/1.8(`exposureAdvice` 와 같은 상수), ISO 는 **가장 낮은 값부터** 올려서 셔터를 0.5 초 이하(달이 초당 15″ 움직이는 번짐을 막음)로 하고 나머지 계산은 `exposureAdvice` 와 같은 1/3 단 표준 셔터. 손계산(node): EV 14 → t = 3.24 ÷ 2^14 = 1/5057 초 → 표 안 가장 가까운 로그 거리 1/4000, ISO 100 / EV 8 → 3.24 ÷ 256 = 1/79 → 1/80, ISO 100 / EV 4 → 3.24 ÷ 16 = 0.2025 초 → 1/5(0.2), ISO 100 / EV 0 → 3.24 초 > 0.5 → ISO 를 올려 0.5 초 이하로: ISO 800 → t = 3.24 × 100 ÷ 800 = 0.405 → 0.4 초(ISO 640 이면 0.506 초 > 0.5 라 안 됨).
 *   `stageExposure(key)` = 단계 별 `{ brightEv, darkEv, bright: advice, dark: advice }`(penumbral · partial: 둘 다 EV 14, total: bright EV 8 · dark EV 4).
 * 기준 4(지금 단계): `stageAt(plan, nowMs)` = 식 구간 앞이면 `{ phase: 'before', stage: null, next: 첫 단계, remainingMs: p1 − now }`, 단계 안이면 `{ phase: 'in', stage, next: 다음 단계 | null, remainingMs: 단계 끝 − now }`, 식 구간 뒤면 `{ phase: 'after', stage: null, next: null, remainingMs: 0 }`. 경계 시각은 새 단계에 속한다(start ≤ t < end).
 * 동치 변이(2026-11-21 기록): 표본 간격 2 분 → 200 분은 판정이 못 가린다. 식 구간(약 6 시간) 안에서 달은 한 번 뜨거나 지므로 양 끝 두 표본만으로도 같은 경계를 찾기 때문이다(지평선 위에 한가운데만 뜨는 극지는 해당 없음). 간격은 극지 가까운 곳의 안전망이다.
 * 기준 5(틀린 입력): 식 null → null, 위도 NaN → null, 경도 Infinity → null. 개기 아닌 식의 노출은 별도 없음(단계 key 만 다름).
 */
const path = require('path');
const { PREVIEW } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const MIN = 60000;
const utc = (s) => Date.parse(s + 'Z');

(async () => {
  const L = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'lunarEclipse.js')).catch(() => null);
  const P = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'eclipsePlan.js')).catch(() => null);
  const e1 = L.lunarEclipseAt(utc('2025-03-14T06:58:41'));
  const e2 = L.lunarEclipseAt(utc('2025-09-07T18:11:43'));

  console.log('[1] 단계 구조');
  const NY = P && P.planEclipse ? P.planEclipse(e1, 40.71, -74.0) : null;
  ok(!!NY && NY.stages.map(s => s.key).join() === 'penumbral,partial,total,partial,penumbral', '2025-03-14 개기: 반그림자 · 부분 · 개기 · 부분 · 반그림자');
  if (NY) {
    const st = NY.stages;
    ok(st.every((s, i) => i === 0 || s.startMs === st[i - 1].endMs) && st[0].startMs === e1.p1Ms && st[4].endMs === e1.p4Ms, '이웃 단계가 이어지고 p1 ~ p4 를 채운다');
    const len = (a, b) => (b - a) / MIN;
    ok(Math.abs(len(st[2].startMs, st[2].endMs) - 65.4) <= 2 && Math.abs(len(st[1].startMs, st[3].endMs) - 218.3) <= 2 && Math.abs(len(st[0].startMs, st[4].endMs) - 362.6) <= 3, '개기 65.4 · 부분 전체 218.3 · 반그림자 전체 362.6 분(NASA)');
  }
  const par = P && P.planEclipse ? P.planEclipse(L.lunarEclipseAt(utc('2026-08-28T04:12:49')), 35.68, 139.69) : null;
  ok(!!par && par.stages.map(s => s.key).join() === 'penumbral,partial,penumbral', '2026-08-28 부분식: 3 단계');
  const pen = P && P.planEclipse ? P.planEclipse(L.lunarEclipseAt(utc('2027-07-18T16:02:53')), 35.68, 139.69) : null;
  ok(!!pen && pen.stages.length === 1 && pen.stages[0].key === 'penumbral', '2027-07-18 스치는 반그림자식: 1 단계');

  console.log('\n[2] 관측지 가시성(해의 반대점 손계산)');
  ok(!!NY && NY.visible && NY.stages.every(s => s.visible) && NY.visibleFromMs === e1.p1Ms && NY.visibleToMs === e1.p4Ms, '뉴욕 2025-03-14: 전 단계 보임, 처음 = p1 · 끝 = p4');
  const TK = P.planEclipse(e1, 35.68, 139.69);
  ok(!!TK && TK.visible && TK.stages[2].visible === false && TK.stages[0].visible === false && Math.abs(TK.visibleFromMs - (e1.greatestMs + 105 * MIN)) <= 12 * MIN, '도쿄 2025-03-14: 개기까지 안 보이고 가장 깊은 때 + 105 분 ±12 분부터 보임');
  const LD = P.planEclipse(e2, 51.5, -0.12);
  ok(!!LD && LD.stages[0].visible === false && LD.stages.find(s => s.key === 'total').visible === true && Math.abs(LD.visibleFromMs - (e2.greatestMs + 16 * MIN)) <= 12 * MIN, '런던 2025-09-07: 반그림자는 안 보이고 개기는 보임, 가장 깊은 때 + 16 분 ±12 분부터');
  const TK2 = P.planEclipse(e2, 35.68, 139.69);
  ok(!!TK2 && TK2.visibleFromMs === e2.p1Ms && Math.abs(TK2.visibleToMs - (e2.greatestMs + 140 * MIN)) <= 12 * MIN, '도쿄 2025-09-07: 처음부터 보이고 가장 깊은 때 + 140 분 ±12 분에 짐');
  // 정의 확인: 보이는 구간의 경계에서 달의 보이는 고도가 0(±0.1°, 10 초 간격 이분법 → 0.04° 안)이다.
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'moonPosition.js'));
  const altAt = (ms, lat, lon) => M.getMoonPositionPrecise(new Date(ms), lat, lon).altitude * 180 / Math.PI;
  ok(Math.abs(altAt(LD.visibleFromMs, 51.5, -0.12)) <= 0.1 && Math.abs(altAt(TK2.visibleToMs, 35.68, 139.69)) <= 0.1 && Math.abs(altAt(TK.visibleFromMs, 35.68, 139.69)) <= 0.1, '보이는 구간 경계의 보이는 고도 0 ±0.1°(런던 · 도쿄 두 경우)');

  console.log('\n[3] 단계별 노출(손계산)');
  const A = (ev) => P.adviseMoonExposure(ev);
  const a14 = A(14), a8 = A(8), a4 = A(4), a0 = A(0);
  ok(a14.iso === 100 && Math.abs(a14.shutterS - 1 / 4000) < 1e-9, 'EV 14 → ISO 100, 1/4000');
  ok(a8.iso === 100 && Math.abs(a8.shutterS - 1 / 80) < 1e-9, 'EV 8 → ISO 100, 1/80');
  ok(a4.iso === 100 && Math.abs(a4.shutterS - 0.2) < 1e-9 && a4.shutterText === '1/5', 'EV 4 → ISO 100, 1/5');
  ok(a0.iso === 800 && Math.abs(a0.shutterS - 0.4) < 1e-9, 'EV 0 → ISO 800, 0.4 초(셔터 0.5 초 이하로 ISO 를 올림)');
  const sx = P.stageExposure;
  ok(sx('penumbral').brightEv === 14 && sx('penumbral').darkEv === 14 && sx('partial').brightEv === 14 && sx('total').brightEv === 8 && sx('total').darkEv === 4, '단계별 EV: 반그림자 · 부분 14, 개기 8 ~ 4');
  ok(sx('total').dark.shutterText === '1/5' && sx('total').bright.shutterText === '1/80' && sx('partial').bright.shutterText === '1/4000', '단계별 추천이 위 손계산과 같다');

  console.log('\n[4] 지금 단계');
  const t0 = NY.stages[0].startMs, tt = NY.stages[2].startMs;
  const bef = P.stageAt(NY, t0 - 10 * MIN);
  ok(bef.phase === 'before' && bef.stage === null && bef.next.key === 'penumbral' && bef.remainingMs === 10 * MIN, '식 전: before, 다음 = 반그림자, 남은 10 분');
  const inn = P.stageAt(NY, tt + 5 * MIN);
  ok(inn.phase === 'in' && inn.stage.key === 'total' && inn.next.key === 'partial' && Math.abs(inn.remainingMs - (NY.stages[2].endMs - tt - 5 * MIN)) < 1, '개기 안: in, 다음 = 부분, 남은 = 단계 끝까지');
  const edge = P.stageAt(NY, tt);
  ok(edge.stage.key === 'total', '경계 시각은 새 단계(start ≤ t < end)');
  const last = P.stageAt(NY, NY.stages[4].endMs - 1);
  ok(last.phase === 'in' && last.stage.key === 'penumbral' && last.next === null, '마지막 단계: 다음 없음');
  const aft = P.stageAt(NY, NY.stages[4].endMs);
  ok(aft.phase === 'after' && aft.stage === null && aft.next === null && aft.remainingMs === 0, '식 뒤: after');

  console.log('\n[5] 틀린 입력 · 안 보이는 곳');
  ok(P.planEclipse(null, 10, 10) === null && P.planEclipse(e1, NaN, 10) === null && P.planEclipse(e1, 10, Infinity) === null, '식 null · 위도 NaN · 경도 Infinity → null');
  // 가장 깊은 때 반대점 고도가 −21° 인 도쿄(2025-03-14)는 일부 보임이므로, 전 구간 아래인 곳: 달이 식 내내 지평선 아래인 자리를 손계산으로 찾는다.
  const RAD = Math.PI / 180;
  const antiAlt = (ms, lat, lon) => {
    const d = ms / 86400000 + 2440587.5 - 2451545;
    const g = (357.528 + 0.9856003 * d) * RAD, lam = (280.460 + 0.9856474 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, eps = (23.439 - 4e-7 * d) * RAD;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) + Math.PI, dec = -Math.asin(Math.sin(eps) * Math.sin(lam));
    const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24 * 15;
    const H = (gmst + lon) * RAD - ra, phi = lat * RAD;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
  };
  let hidden = null;
  for (const lon of [-170, -150, -120, 60, 80, 100]) {
    let mx = -99; for (let t = e1.p1Ms; t <= e1.p4Ms; t += 5 * MIN) mx = Math.max(mx, antiAlt(t, 0, lon));
    if (mx < -5) { hidden = lon; break; }
  }
  const HD = hidden === null ? null : P.planEclipse(e1, 0, hidden);
  ok(hidden !== null && !!HD && HD.visible === false && HD.visibleFromMs === null && HD.visibleToMs === null && HD.stages.every(s => !s.visible), `달이 식 내내 지평선 아래인 곳(적도, 경도 ${hidden}°): visible false · 처음 · 끝 null · 전 단계 안 보임`);

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
