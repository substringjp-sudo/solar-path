/**
 * **계산 과정 보기의 단계 카드가 앱의 실제 계산과 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/calcSteps.ts`(해 뜨는 시각과 방향 카드)를 앱의 계산(`terrainSun.ts`·`solarPosition.ts`)과 합성 산(스카이라인)에 대어 봅니다.
 * 화면이 그릴 값이 화면 밖 계산과 갈라지면 "왜 그런가" 를 보여 주는 화면이 거짓말을 하게 되므로, 카드의 숫자가 계산 값과 같은지가 핵심입니다.
 *
 * 먼저 정한 줄:
 *  1. 모양 — 일출·일몰 모두 카드 4장: 해의 실제 위치(rows) · 대기 굴절(rows) · 지평선 높이(sky) · 결과(result).
 *  2. 숫자가 계산과 같다 — 1 장의 방위가 `sunHorizonSteps` 의 기하 0° 순간 방위, 2 장의 굴절 +0.48° 와 "약 3분", 4 장의 시각·방위가
 *     `sunHorizonEvent` 의 보이기 시작 순간.
 *  3. 능선 — 능선이 해 방위에서 평평한 수평선보다 1분 넘게 늦추면 3 장이 key(테두리), 능선 앙각·거리 글이 들어간다.
 *     평평한 수평선(땅 자료 없음)이면 usedTerrain=false, 지형 자료가 없다는 문장, key 아님.
 *  4. 하늘 그림 — 방위 범위 폭 44°, 윤곽 점이 방위 순서로 45 개, 고도 범위가 윤곽과 해 자리(평평한 때·보이기 시작)를 모두 담는다.
 *  5. 일출과 일몰은 말이 다르다(보이기 시작 ↔ 사라짐, 일찍 ↔ 늦게까지), 극야는 null.
 *  6. 아래 한 줄 — 늦은 분이 계산의 deltaMin 을 반올림한 값, 같은 정도면 "거의 같아요".
 *  7. 글 — NaN · undefined · Infinity 가 어느 글에도 없고, en · ja 글에 한글이 없다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-calc-steps.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const RAD = Math.PI / 180;

(async () => {
  const C = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'calcSteps.js'));
  const T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'terrainSun.js'));
  const H = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'horizon.js'));

  const lat = 37.5665, lon = 126.978;
  const date = new Date('2026-12-21T03:00:00Z');
  const fmt = (ms) => new Date(ms).toISOString().slice(11, 16);
  // 합성 스카이라인: 해 뜨는 방위(약 120°) 쪽에 능선 1.8°, 서쪽은 낮은 평지
  const ridge = (az) => (az > 100 && az < 135 ? 1.8 : -0.1);
  const mountain = (e, s) => 40 + 400 * Math.exp(-((e - 6000) ** 2) / (2 * 1200 ** 2)) * Math.exp(-(s ** 2) / (2 * 4000 ** 2));
  const prof = H.buildHorizonProfile(mountain, 41.6);
  const base = { date, lat, lon, fmtTime: fmt };
  const allText = (cards) => JSON.stringify(cards);

  console.log('\n[1] 모양');
  const rise = C.buildSunHorizonCards({ ...base, kind: 'rise', language: 'ko', skyline: ridge, profile: prof });
  const set = C.buildSunHorizonCards({ ...base, kind: 'set', language: 'ko', skyline: ridge, profile: prof });
  ok(rise && rise.cards.map(c => c.id).join() === 'geo,refraction,skyline,result' && rise.cards.map(c => c.shape).join() === 'rows,rows,sky,result', '일출: 카드 4 장 — 위치(rows) · 굴절(rows) · 지평선(sky) · 결과(result)');
  ok(set && set.cards.length === 4, '일몰도 카드 4 장');

  console.log('\n[2] 숫자가 계산과 같다');
  {
    const st = T.sunHorizonSteps('rise', date, lat, lon, ridge);
    const geo = rise.cards[0].rows;
    ok(geo[0].value === `${st.geoZeroAzDeg.toFixed(1)}°`, `1 장 방위 ${geo[0].value} = 계산의 기하 0° 순간 방위`);
    ok(geo[1].value.startsWith('0.0°') && geo[1].value.endsWith(fmt(st.geoZeroMs)), `1 장 고도·시각 "${geo[1].value}"`);
    const ref = rise.cards[1].rows;
    ok(ref[0].value === '+0.48°' && /3/.test(ref[1].value), `2 장 굴절 ${ref[0].value} · ${ref[1].value}`);
    const res = rise.cards[3].result;
    ok(res === `${fmt(st.event.visibleMs)} · ${st.event.azDeg.toFixed(1)}°`, `4 장 결과 "${res}" = 계산의 보이기 시작 순간`);
  }

  console.log('\n[3] 능선');
  {
    const c3 = rise.cards[2];
    ok(rise.usedTerrain && c3.key === true && /1\.8°/.test(c3.note) && /능선 1\.8°/.test(c3.sky.caption), `3 장은 key, 글에 능선 1.8° ("${c3.sky.caption}")`);
    ok(/km/.test(c3.sky.caption), `능선까지 거리가 캡션에 들어간다 ("${c3.sky.caption}")`);
    const flat = C.buildSunHorizonCards({ ...base, kind: 'rise', language: 'ko' });
    ok(flat.usedTerrain === false && !flat.cards[2].key && /지형 자료가 아직 없어/.test(flat.cards[2].note) && Math.abs(flat.deltaMin) < 0.5, `땅 자료가 없으면 평평한 수평선: usedTerrain=false, key 아님, 시각 차 ${flat.deltaMin.toFixed(2)} 분`);
  }

  console.log('\n[4] 하늘 그림');
  {
    const s = rise.cards[2].sky;
    ok(Math.abs(s.azRange[1] - s.azRange[0] - 44) < 1e-9 && s.skyline.length === 45 && s.skyline.every((p, i) => i === 0 || p[0] > s.skyline[i - 1][0]), '방위 범위 폭 44°, 윤곽 점 45 개가 방위 순');
    const allEl = [...s.skyline.map(p => p[1]), ...s.suns.map(x => x.el)];
    ok(s.elRange[0] <= Math.min(...allEl) && s.elRange[1] >= Math.max(...allEl), `고도 범위 [${s.elRange.map(v => v.toFixed(2))}] 가 윤곽과 해 자리를 모두 담는다`);
    ok(s.suns.length === 2 && s.suns[0].kind === 'flat' && s.suns[1].kind === 'visible' && s.suns[1].az > s.suns[0].az - 5, '해 자리 둘: 평평한 수평선 기준 · 실제로 보이기 시작');
    ok(s.suns[1].el >= 1.8 - 0.6, `보이기 시작하는 해 윗가장자리가 능선 근처(중심 고도 ${s.suns[1].el.toFixed(2)}°)`);
  }

  console.log('\n[5] 일출과 일몰');
  {
    ok(rise.cards[3].title === '보이기 시작' && set.cards[3].title === '사라짐', '결과 줄 이름이 다르다');
    ok(rise.cards[1].rows[1].label === '일찍' && set.cards[1].rows[1].label === '늦게까지', '굴절 줄 이름이 다르다');
    const polar = C.buildSunHorizonCards({ kind: 'rise', date: new Date('2026-12-21T12:00:00Z'), lat: 69.65, lon: 18.96, language: 'ko', fmtTime: fmt });
    ok(polar === null, '극야는 null');
  }

  console.log('\n[6] 아래 한 줄');
  {
    const dm = Math.round(rise.deltaMin);
    ok(new RegExp(`${dm}분 늦어요`).test(rise.footnote) && rise.footnote.includes(fmt(rise.flatMs)), `"${rise.footnote.slice(0, 40)}…" — ${dm}분 늦어요 + 예보 시각`);
    const flat = C.buildSunHorizonCards({ ...base, kind: 'rise', language: 'ko' });
    ok(/거의 같아요/.test(flat.footnote), '평평한 수평선이면 "거의 같아요"');
    const early = C.buildSunHorizonCards({ ...base, kind: 'set', language: 'ko', skyline: ridge2 });
    function ridge2(az) { return az > 225 && az < 255 ? 2 : -0.1; }
    ok(/일러요/.test(early.footnote), '일몰이 능선에 가려 앞당겨지면 "일러요"');
  }

  console.log('\n[7] 글');
  {
    const hangul = /[가-힣]/;
    let badNum = 0, hanInOther = 0;
    for (const L of ['ko', 'en', 'ja']) for (const kind of ['rise', 'set']) for (const sk of [ridge, undefined]) {
      const r = C.buildSunHorizonCards({ ...base, kind, language: L, skyline: sk, profile: sk ? prof : undefined });
      const txt = allText(r.cards) + r.title + r.footnote;
      if (/NaN|undefined|Infinity/.test(txt)) badNum++;
      if (L !== 'ko' && hangul.test(txt)) hanInOther++;
    }
    ok(badNum === 0, 'NaN · undefined · Infinity 가 어느 글에도 없다');
    ok(hanInOther === 0, 'en · ja 글에 한글이 없다');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
