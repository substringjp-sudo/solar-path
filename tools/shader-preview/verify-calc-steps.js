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
 *     두 해가 30초 안으로 겹치면 하나만, 스카이라인이 0.3° 도 안 되면 "능선" 이 아니라 "낮은 지평선" 이라고 쓴다.
 *  5. 일출과 일몰은 말이 다르다(보이기 시작 ↔ 사라짐, 일찍 ↔ 늦게까지), 극야는 null.
 *  6. 아래 한 줄 — 늦은 분이 계산의 deltaMin 을 반올림한 값, 같은 정도면 "거의 같아요".
 *  7. 글 — NaN · undefined · Infinity 가 어느 글에도 없고, en · ja 글에 한글이 없다.
 *  8. 노을 점수 카드 — 5 장(예보·지도·투과·구름 종류·점수)이 `predictSunset` 의 breakdown 과 맞다: 예보 줄 = 입력, 막대 = 해 쪽 경로 투과율,
 *     점수 카드의 두 몫 합 = 점수(±1), 지도 칸의 방위 = 해 방위 + 링의 상대 방위, 해 쪽 구름·맑음·낮(key 없음, 이유를 아래 글이)·breakdown 없음 분기.
 *     key 는 날씨·해 쪽 빛의 길 가운데 15% 넘게 깎은 더 큰 쪽(둘 다 적게 깎고 점수가 60 미만이면 구름 단계).
 *
 *  9. 별 보기 카드 — `buildStarCards` 가 모델(`starLimit`)의 값을 거짓 없이 그린다. 물리 자체는 `verify-star-visibility.js` 가, 입력 모으기는 `verify-star-tonight.js` 가 본다.
 *     a. 모양: 어두운 밤이면 구름 · 달빛 · 빛 공해 · 연무(metric) + 보이는 별(bar) 5 장, 해가 −18° 보다 얕으면 구름 다음에 박명이 끼어 6 장.
 *     b. 숫자: 카드의 줄어든 등급이 모델의 단계별 값과 같고(소수 1자리), 시작 6.5 에서 보이는 줄어듦을 다 빼면 마지막 한계와 0.25 등급 안
 *        (네 단계 반올림 4 × 0.05 와 마지막 반올림 0.05). 막대 값은 (한계 − 1)/5.5(0~1), 글은 "N.N 등급까지".
 *     c. key: 0.3 등급 이상 줄인 단계 가운데 가장 큰 하나만 key. 달이 센 밤은 달빛, 도시 하늘은 빛 공해, 뿌연 날은 연무, 박명 속은 박명. 다 맑거나 줄어듦이 모두 0.3 미만이면 아무것도 key 아님.
 *        (돌려 보기 전에 정한 보완: 줄어듦이 0.1 등급 같은 밤에도 단계 하나가 "문제" 로 짚이는 것은 거짓 강조라 문턱을 둔다.)
 *     d. 구름: 모름이면 "모름"·줄 없음·"예보가 없어요". 20 % 이하 좋음 · 50 % 이하 보통 · 그 위 나쁨과 색조. 구름은 한계등급을 바꾸지 않는다(0 % 와 100 % 의 막대 값이 같다).
 *     e. 달빛: 달이 없으면 "없음" · "지평선 아래" · "영향이 없어요", 떠 있으면 밝은 면 %와 고도 줄.
 *        영향이 작은 단계(줄어듦 0.15 등급 미만, 짚이지 않을 때)는 "영향이 작아요" 류로 말하고 "밝혀요/가려져요" 라고 하지 않는다: 달빛 · 빛 공해 · 박명. 크면(0.15 이상) 원래 글.
 *     f. 달 진 뒤: 달이 떠 있고 모델의 "달 없는 한계" 가 0.3 등급 넘게 좋아질 때만 "달이 지는 HH:MM 뒤에는 N.N 등급까지" 가 붙고 N.N 은 모델 값, 4.5 이상이면 은하수 권유가 붙는다. 달이 이미 없거나 좋아짐이 0.3 미만이면 붙지 않는다. en · ja 도 같은 사실을 말한다.
 *     g. 빛 공해·연무: 자료가 없으면 "모름" 과 이유 글(맑은 대기로 셌다/지도를 못 읽었다), 있으면 줄(빛 지도 한계 · AOD · 시정+어림 AOD · 습도 · PM2.5)이 입력과 같다.
 *        빛 지도를 못 읽었으면(lightPollutionMag null) 보이는 별 글 끝에 "도시에서는 이보다 덜 보일 수 있어요" 류 안내가 붙고(세 언어), 있으면 안 붙는다. 모르는 것을 좋게 말하지 않는다.
 *     h. 글: NaN · undefined · Infinity 없음, en · ja 에 한글 없음. 아래 글에 출처(Krisciunas)가 있다.
 *     i. 사슬: `starArgsFor`(서울 12-21 저녁) → `buildStarCards`. 어두운 곳 값(빛 지도 6.2)이면 달 지는 시각 글이 `moonSetMs`·모델 값과 같다.
 *        서울 실제 빛 지도 값(3.6)에서는 달이 져도 좋아짐이 0.3 등급 미만이면 글이 없고(규칙 f), 이상이면 있다(양쪽 모두 모델 값에서 따진다).
 *        (처음 적을 때는 도시 하늘에서도 글이 붙는다고 잘못 짚었다. 규칙 f 가 먼저이므로 기대를 고쳤다.)
 *
 * 10. 구름 모양 카드(2026-11-20) — `buildCloudShapeCards` 가 장면이 그린 값과 예보의 높이 · 바람을 거짓 없이 그린다(장면의 그림 자체는 이 판정이 안 본다).
 *     a. 모양: 카드 4 장, 계획 표(9.4.1)의 순서로 id 가 layers · thick · wind · genus, 모두 rows 모양. 제목은 세 언어 모두 있다.
 *     b. 층별 비율: 낮은 · 중간 · 높은 줄이 입력의 정수 반올림과 같고(14.6 → 15) "전체" 줄은 total 이 있을 때만 붙는다. 글 첫머리가 `cloudSummary` 의 한 줄이다(쉬운 말 자체는 `verify-sky-words.js` 가 본다).
 *     c. 종류: 열 가지 기호(cu cg cb sc st ns ac as ci cs)가 손으로 적은 이름과 같다(ko 적운 · 웅대적운 · 적란운 · 층적운 · 층운 · 난층운 · 고적운 · 고층운 · 권운 · 권층운,
 *        en cumulus · cumulus congestus · cumulonimbus · stratocumulus · stratus · nimbostratus · altocumulus · altostratus · cirrus · cirrostratus, ja 積雲 · 雄大積雲 · 積乱雲 · 層積雲 · 層雲 · 乱層雲 · 高積雲 · 高層雲 · 巻雲 · 巻層雲).
 *        "-" 는 없음 · none · なし, 모르는 기호는 그 기호 그대로(없는 이름을 지어내지 않음). "sc/as/-" 는 낮은 · 중간 · 높은 순서로 읽는다.
 *     d. 바람: 불어오는 방위를 여덟 방위 말로(손으로: 0 북 · 22.4 북 · 22.5 북동 · 45 북동 · 90 동 · 135 남동 · 180 남 · 225 남서 · 270 서 · 315 북서 · 337.4 북서 · 337.5 북 · 359.9 북).
 *        속도는 정수 반올림("시속 12 km", 11.6 → 12), 글의 "한 시간에 낮은 층 구름은 약 N km" 의 N 이 낮은 층 속도의 반올림과 같다. 바람이 null 이면 "바람 모름" 한 줄과 자료가 없다는 글만(수치를 지어내지 않음).
 *     e. 두께: 높이 줄은 `N.N km`(소수 한 자리) 또는 "모름", 광학 두께 줄은 `N.N` 또는 "모름". 광학 두께가 없으면 글이 이유("해가 낮거나 직사광 자료가 없어")를 말하고,
 *        높이를 하나라도 알면 "높은 구름일수록 해가 진 뒤에도 빛을 받아요" 가 붙고 모두 모르면 안 붙는다.
 *     f. 정직: 종류 카드 글이 규칙이 "그럴듯한 기본값" 이라고 말한다("정확히 맞히기는 어려워요" 류). 유인 관측소 보고와 맞춰 본 자(RULER-genus-forecast)에서 자를 못 넘었기 때문이다.
 *     g. 글: NaN · undefined · Infinity 가 없고, en · ja 에 한글이 없다(입력 격자 전체).
 *     h. 장면 시각: `cloudSceneUsable(장면 시각, 보는 시각)` 은 30분 이내(경계 포함)면 true, 30분 1초면 false, 못 읽는 시각 글이면 false.
 *     i. 앱 연결(소스): 계산 과정 틀에 topic 'cloud' 칩과 `getCloudArgs`(없으면 "구름 그림이 아직 없어서" 알림), `SkyScreen` 이 장면의 `getRenderState().scene` 과 `cloudSceneUsable` 로 입력을 만들고
 *        구름 한 줄을 누르면 구름 모양 주제가 열린다. 주제 칩 줄은 줄바꿈이 된다(칩이 다섯이 되어 390 폭에서 마지막 칩 "구름 모양" 이 잘렸습니다 — 화면을 보고 추가한 기준).
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
    const flatPic = C.buildSunHorizonCards({ ...base, kind: 'rise', language: 'ko' }).cards[2].sky;
    ok(flatPic.suns.length === 1 && flatPic.suns[0].kind === 'visible', '평평한 수평선이면 해 하나만(두 해가 겹침)');
    const lowTerrain = C.buildSunHorizonCards({ ...base, kind: 'set', language: 'ko', skyline: () => -0.05, profile: prof }).cards[2].sky;
    ok(/낮은 지평선/.test(lowTerrain.caption) && !/능선/.test(lowTerrain.caption), `땅 자료가 있어도 낮으면 "${lowTerrain.caption}"`);
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

  // ── [8] 노을 점수 ───────────────────────────────────────────────────────
  console.log('\n[8] 노을 점수 카드');
  {
    const SP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'sunsetPhysics.js'));
    const mk = (low, mid, high, d, off) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['2026-11-19T17:00'], timeMs: [Date.parse('2026-11-19T17:00:00+09:00')], low: [low], mid: [mid], high: [high], directNormalIrradiance: [300], totalColumnWaterVapour: [18], precipitation: [0], visibility: [20000], humidity: [55] } });
    const T0 = new Date('2026-11-19T17:00:00+09:00');
    // 링: 관측점 + 거리 4 겹 × 해 기준 방위 4 방향. sunLow 는 해 쪽(0°) 줄의 낮은 구름 %.
    const ringPath = (lo, mi, hi, sunLow, sunLowDist = 60) => [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mk(a === 0 && d === sunLowDist ? sunLow : (a === 0 ? 0 : lo * 0.8), mi, hi, d, a)))];
    const flat = (path) => path.map(p => ({ distance: p.distance, azimuthOffset: p.azimuthOffset, low: p.hourly.low[0], mid: p.hourly.mid[0], high: p.hourly.high[0] }));
    const QW = { Epic: '훌륭함', Great: '좋음', Fair: '보통', Muted: '아쉬움', Overcast: '흐림' };
    const run = (lo, mi, hi, sunLow, alt, lang = 'ko', kind = 'sunset') => {
      const path = ringPath(lo, mi, hi, sunLow);
      const pred = SP.predictSunset(path, T0, alt, 20000, 55, 37.5, 30, 323, 250);
      return { pred, out: C.buildSunsetScoreCards({ prediction: pred, ring: flat(path), time: T0, eventMs: T0.getTime(), sunAzDeg: 250, kind, language: lang, fmtTime: fmt, qualityWord: (q) => QW[q] }) };
    };
    const good = run(4, 18, 63, 0, 0.5);
    ok(good.out && good.out.cards.map(c => c.id).join() === 'forecast,map,path,cloudtype,score' && good.out.cards.map(c => c.shape).join() === 'rows,map,bar,rows,result', '카드 5 장: 예보(rows) · 지도(map) · 투과(bar) · 구름 종류(rows) · 점수(result)');
    const f = good.out.cards[0].rows.map(r => r.value).join('|');
    ok(f.startsWith('4 %|18 %|63 %|55 %'), `예보 줄이 입력과 같다 (${f})`);
    const sc = good.out.cards[4];
    ok(sc.result === `${QW[good.pred.quality]} ${good.pred.score}` && good.out.score === good.pred.score, `점수 카드 "${sc.result}" = 예측의 판정·점수`);
    const parts = sc.rows.map(r => parseInt(r.value, 10));
    ok(Math.abs(parts[0] + parts[1] - good.pred.score) <= 1 && sc.note === '', `두 몫 ${parts[0]} + ${parts[1]} 가 점수 ${good.pred.score} 와 ±1 (반올림)`);
    const m = good.out.cards[1].map;
    ok(m.cells.length === 16 && m.ringsKm.join() === '30,60,100,200' && m.maxKm === 200 && m.cells.every(c => c.azDeg >= 0 && c.azDeg < 360), `지도 칸 ${m.cells.length} 개, 거리 고리 ${m.ringsKm.join('·')} km`);
    const sunCell = m.cells.find(c => c.distKm === 60 && Math.abs(c.azDeg - 250) < 1e-6);
    ok(!!sunCell, '해 방위(250°) 쪽 칸이 지도에 해 방위로 놓인다');
    const bar = good.out.cards[2].bar;
    ok(Math.abs(bar.value - good.pred.factors.pathClarity) < 1e-12 && bar.display === `${Math.round(bar.value * 100)} %`, `막대 값 ${bar.display} = 해 쪽 경로 투과율`);

    const blocked = run(10, 10, 10, 90, 0.5);
    ok(/60 km/.test(blocked.out.cards[1].note) && /낮은/.test(blocked.out.cards[1].note) && /90 %/.test(blocked.out.cards[1].note), `해 쪽 60 km 낮은 구름 90% 를 지도 글이 짚는다 ("${blocked.out.cards[1].note.slice(0, 36)}…")`);
    ok(blocked.out.keyId === 'path' && blocked.out.cards[2].key === true && /가장 크게 깎은/.test(blocked.out.cards[2].note), `해 쪽 길이 막히면 투과 단계가 key (keyId ${blocked.out.keyId})`);
    ok(good.out.keyId === 'path' && /가장 크게 깎은/.test(good.out.cards[2].note), `목업과 같은 장면(낮은 4 · 중간 18 · 높은 63): 투과 단계가 key (${good.out.keyId})`);
    const wet = run(95, 80, 10, 0, 0.5);
    ok(wet.out.keyId === 'forecast' && wet.out.cards[0].key === true, `두껍게 흐린 날은 예보 단계가 key (${wet.out.keyId})`);
    const clear = run(0, 0, 0, 0, 1);
    ok(/거의 맑아요/.test(clear.out.cards[1].note) && /구름이 거의 없어요/.test(clear.out.cards[3].note) && clear.out.cards[3].rows[0].value === '거의 없음', '맑은 하늘이면 지도·구름 종류 글이 맑다고 말한다');
    const noon = run(10, 10, 10, 0, 40);
    ok(noon.out.keyId === null && /해 고도가 40°/.test(noon.out.footnote) && /너무 높아/.test(noon.out.footnote), `낮에는 key 없음, 아래 글이 이유를 말한다 ("${noon.out.footnote.slice(0, 30)}…")`);
    ok(good.pred.breakdown && C.buildSunsetScoreCards({ prediction: { score: 0, quality: 'Muted' }, ring: [], time: T0, sunAzDeg: 0, kind: 'sunset', language: 'ko', fmtTime: fmt, qualityWord: (q) => q }) === null, 'breakdown 이 없으면 null');
    ok(good.out.title === '노을 점수가 나오기까지' && good.out.eventLabel === `일몰 ${fmt(T0.getTime())}`, `제목·부제 "${good.out.title}" / "${good.out.eventLabel}"`);
    const dawn = run(4, 18, 63, 0, 0.5, 'ko', 'sunrise');
    ok(dawn.out.title === '새벽 노을 점수가 나오기까지', '일출 쪽이면 제목이 새벽 노을');

    let badTxt = 0, hanOther = 0;
    for (const L of ['ko', 'en', 'ja']) for (const args of [[4, 18, 63, 0, 0.5], [10, 10, 10, 90, 0.5], [0, 0, 0, 0, 1], [10, 10, 10, 0, 40]]) {
      const o = run(...args, L).out;
      const txt = JSON.stringify(o);
      if (/NaN|undefined|Infinity/.test(txt.replace(/"eventLabel":null/, ''))) badTxt++;
      if (L !== 'ko' && /[가-힣]/.test(txt.replace(/"result":"[^"]*"/g, ''))) hanOther++;   // result 의 판정 단어는 앱의 번역을 따르므로 이 시험의 한글 표(QW)가 섞입니다
    }
    ok(badTxt === 0, '세 언어 · 네 장면의 글에 NaN · undefined · Infinity 가 없다');
    ok(hanOther === 0, 'en · ja 글에 한글이 없다(판정 단어 제외)');
  }

  // ── [9] 별 보기 ─────────────────────────────────────────────────────────
  console.log('\n[9] 별 보기 카드');
  {
    const SV = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'starVisibility.js'));
    const ST = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'starTonight.js'));
    const TIME = Date.parse('2026-12-21T10:21:00Z');
    const sIn = (o) => ({ cloudPct: 10, sunAltDeg: -30, moonAltDeg: -20, moonIllum: 0.5, lightPollutionMag: 6.0, aod550: 0.05, ...o });
    const sRun = (o, ex = {}, lang = 'ko') => {
      const input = sIn(o);
      return { input, r: SV.starLimit(input), out: C.buildStarCards({ language: lang, timeMs: TIME, input, cloudKnown: true, moonSetMs: null, fmtTime: fmt, ...ex }) };
    };
    const card = (x, id) => x.out.cards.find(c => c.id === id);
    const fm = (d) => `${d <= -0.05 ? '−' : ''}${Math.abs(d).toFixed(1)}`;
    const num = (str) => parseFloat(String(str).replace('−', '-'));

    // a. 모양
    const dark = sRun({});
    ok(dark.out.cards.map(c => c.id).join() === 'cloud,moon,light,haze,limit' && dark.out.cards.map(c => c.shape).join() === 'metric,metric,metric,metric,bar', `어두운 밤: ${dark.out.cards.map(c => c.id).join()}`);
    const twi = sRun({ sunAltDeg: -10 });
    ok(twi.out.cards.map(c => c.id).join() === 'cloud,twilight,moon,light,haze,limit', `박명 속(해 −10°): ${twi.out.cards.map(c => c.id).join()}`);
    ok(sRun({ sunAltDeg: -18 }).out.cards.every(c => c.id !== 'twilight'), '해 −18° 면 박명 카드가 없다');
    ok(dark.out.title === '별 보기 조건' && dark.out.eventLabel === fmt(TIME) && dark.out.limitMag === dark.r.limitMag, `제목 "${dark.out.title}" · 부제 "${dark.out.eventLabel}"`);

    // b. 숫자
    const strong = sRun({ moonAltDeg: 50, moonIllum: 0.9, lightPollutionMag: 5.5, aod550: 0.2 }, { moonSetMs: TIME + 6 * 3600e3, sunAltAtMoonSetDeg: -30 });
    const deltas = { moon: strong.r.moon.deltaMag, light: strong.r.light.deltaMag, haze: strong.r.haze.deltaMag };
    ok(card(strong, 'moon').result === `${fm(deltas.moon)} 등급` && card(strong, 'light').result === `${fm(deltas.light)} 등급` && card(strong, 'haze').result === `${fm(deltas.haze)} 등급`,
      `줄어든 등급 달 ${card(strong, 'moon').result} · 빛 ${card(strong, 'light').result} · 연무 ${card(strong, 'haze').result} 가 모델의 단계별 값`);
    const lim = card(strong, 'limit');
    ok(lim.bar.display === `${strong.r.limitMag.toFixed(1)} 등급까지` && Math.abs(lim.bar.value - Math.max(0, Math.min(1, (strong.r.limitMag - 1) / 5.5))) < 1e-12, `막대 "${lim.bar.display}" 값 ${lim.bar.value.toFixed(3)}`);
    const shown = ['moon', 'light', 'haze'].reduce((a, id) => a + num(card(strong, id).result), 0);
    ok(Math.abs(6.5 + shown - num(lim.bar.display)) <= 0.25, `6.5 + 보이는 줄어듦 ${shown.toFixed(1)} = ${(6.5 + shown).toFixed(1)} 가 마지막 ${lim.bar.display} 와 0.25 안`);
    const val = (c) => (c && /^[−-]?\d/.test(c.result) ? num(c.result) : 0);   // "없음" 은 줄어듦 0
    const twSum = ['twilight', 'moon', 'light', 'haze'].reduce((a, id) => a + val(card(twi, id)), 0);
    ok(Math.abs(6.5 + twSum - num(card(twi, 'limit').bar.display)) <= 0.25, `박명 장면도 합이 맞는다: 6.5 + ${twSum.toFixed(1)} = ${(6.5 + twSum).toFixed(1)} → ${card(twi, 'limit').bar.display}`);

    // c. key
    const keyIds = (x) => x.out.cards.filter(c => c.key).map(c => c.id);
    const scen = [
      ['달이 센 밤', sRun({ moonAltDeg: 55, moonIllum: 0.95, lightPollutionMag: 6.2, aod550: 0.05 }), 'moon'],
      ['도시 하늘', sRun({ lightPollutionMag: 3.2, aod550: 0.05 }), 'light'],
      ['뿌연 날', sRun({ lightPollutionMag: 6.4, aod550: 0.9 }), 'haze'],
      ['박명 속', sRun({ sunAltDeg: -10, lightPollutionMag: 6.2, aod550: 0.05 }), 'twilight'],
    ];
    for (const [name, x, want] of scen) ok(keyIds(x).join() === want && x.out.keyId === want, `${name}: key ${keyIds(x).join() || '없음'} (기대 ${want}), keyId ${x.out.keyId}`);
    const allClear = sRun({ lightPollutionMag: 6.5, aod550: 0.05 });
    ok(keyIds(allClear).length === 0 && allClear.out.keyId === null, '다 맑은 밤: key 없음');
    const smallOnly = sRun({ lightPollutionMag: 6.5, aod550: 0.12 });
    ok(smallOnly.r.haze.deltaMag < -0.05 && smallOnly.r.haze.deltaMag > -0.3 && keyIds(smallOnly).length === 0 && smallOnly.out.keyId === null, `줄어듦이 0.3 미만(연무 ${smallOnly.r.haze.deltaMag.toFixed(2)})이면 아무 단계도 짚지 않는다`);

    // d. 구름
    const c0 = C.buildStarCards({ language: 'ko', timeMs: TIME, input: sIn({}), cloudKnown: false, moonSetMs: null, fmtTime: fmt });
    const cc = c0.cards[0];
    ok(cc.id === 'cloud' && cc.tone === 'plain' && cc.result === '모름' && cc.rows.length === 0 && /예보가 없어요/.test(cc.note), `구름 모름: "${cc.result}" · 줄 ${cc.rows.length} · "${cc.note}"`);
    const tone = (p) => { const x = sRun({ cloudPct: p }); const c = card(x, 'cloud'); return `${c.result}/${c.tone}/${c.rows[0].value}`; };
    ok(tone(10) === '좋음/good/10 %' && tone(20) === '좋음/good/20 %' && tone(35) === '보통/warn/35 %' && tone(50) === '보통/warn/50 %' && tone(80) === '나쁨/bad/80 %', `구름 10 · 20 · 35 · 50 · 80 % → ${[10, 20, 35, 50, 80].map(tone).join(' , ')}`);
    ok(card(sRun({ cloudPct: 0 }), 'limit').bar.value === card(sRun({ cloudPct: 100 }), 'limit').bar.value, '구름 0 % 와 100 % 의 한계등급 막대가 같다(구름은 등급을 안 바꾼다)');
    ok(/^구름이 많아 대부분 가려져요/.test(card(sRun({ cloudPct: 90 }), 'limit').note) && !/구름이 많아/.test(card(sRun({ cloudPct: 10 }), 'limit').note), '구름이 많을 때만 보이는 별 글이 그 말로 시작한다');

    // e. 달빛
    const mn = card(dark, 'moon');
    ok(mn.result === '없음' && mn.rows.length === 1 && mn.rows[0].value === '지평선 아래' && /영향이 없어요/.test(mn.note), `달이 없을 때: "${mn.result}" / "${mn.rows[0].value}" / "${mn.note}"`);
    const ms = card(strong, 'moon');
    ok(ms.rows.map(r => `${r.label} ${r.value}`).join(' | ') === '밝은 면 90 % | 고도 50°', `달이 떠 있을 때 줄: ${ms.rows.map(r => `${r.label} ${r.value}`).join(' | ')}`);

    // e2. 영향이 작을 때의 글
    const lowLight = card(sRun({ lightPollutionMag: 6.4, aod550: 0.05 }), 'light');   // 달이 없으면 줄어듦 = 6.5 − 한계 → 6.4 는 −0.1
    ok(/영향이 작아요/.test(lowLight.note) && !/밝혀요/.test(lowLight.note), `빛 공해가 작으면(${lowLight.result}) "${lowLight.note}"`);
    const midLight = sRun({ lightPollutionMag: 5.6, aod550: 0.9 });
    ok(keyIds(midLight).join() === 'haze' && /도시 불빛이 하늘을 밝혀요/.test(card(midLight, 'light').note), `빛 공해가 크지만 가장 크진 않으면(${card(midLight, 'light').result}) 원래 글: "${card(midLight, 'light').note}"`);
    const faintMoon = card(sRun({ moonAltDeg: 30, moonIllum: 0.05 }), 'moon');
    ok(faintMoon.rows.length === 2 && /영향이 작아요/.test(faintMoon.note) && !/가려져요/.test(faintMoon.note), `가는 달은(${faintMoon.result}) "${faintMoon.note}"`);
    const midMoon = card(sRun({ moonAltDeg: 20, moonIllum: 0.4, lightPollutionMag: 4.0, aod550: 0.05 }), 'moon');
    ok(/가려져요|가장 많이/.test(midMoon.note), `달 영향이 어느 정도면(${midMoon.result}) 원래 글 "${midMoon.note}"`);
    const twiLate = sRun({ sunAltDeg: -17.8, lightPollutionMag: 6.5 });   // 기본 빛 지도 6.0 은 0.5 등급을 깎아 key 가 되므로 6.5 로 둔다
    ok(card(twiLate, 'twilight') && twiLate.r.twilight.deltaMag > -0.15 && /거의 다 내려가/.test(card(twiLate, 'twilight').note) && keyIds(twiLate).length === 0, `해 −17.8° 박명(${card(twiLate, 'twilight').result}): "${card(twiLate, 'twilight').note}" · key 없음`);
    ok(/아직 충분히 내려가지 않아/.test(card(twi, 'twilight').note), '해 −10° 박명은 "아직 충분히 내려가지 않아" 글');

    // f. 달 진 뒤
    const SETMS = TIME + 6 * 3600e3;
    const after = SV.limitWithoutMoon({ ...strong.input, sunAltDeg: -30 });
    ok(after - strong.r.limitMag >= 0.3 && lim.note.includes(`달이 지는 ${fmt(SETMS)} 뒤에는 ${after.toFixed(1)} 등급까지 보여요.`), `꼬리: "${lim.note.slice(-34)}" (모델 ${after.toFixed(2)})`);
    const dk = sRun({ moonAltDeg: 55, moonIllum: 0.95, lightPollutionMag: 6.4, aod550: 0.05 }, { moonSetMs: SETMS, sunAltAtMoonSetDeg: -30 });
    const afterDk = SV.limitWithoutMoon({ ...dk.input, sunAltDeg: -30 });
    ok(afterDk >= 4.5 && /은하수는 달이 진 뒤를 권해요/.test(card(dk, 'limit').note), `어두운 곳이라 달이 진 뒤 ${afterDk.toFixed(1)} 등급이면 은하수 권유가 붙는다`);
    ok(!/달이 지는/.test(card(strong, 'limit').note.replace(lim.note, '')) && !/달이 지는/.test(card(dark, 'limit').note), '달이 이미 없을 때는 꼬리가 없다');
    const noSet = sRun({ moonAltDeg: 50, moonIllum: 0.9 }, { moonSetMs: null });
    ok(!/달이 지는/.test(card(noSet, 'limit').note), 'moonSetMs 가 null 이면 꼬리가 없다(밤새 안 진다)');
    const dusk = sRun({ moonAltDeg: 50, moonIllum: 0.9, lightPollutionMag: 5.5 }, { moonSetMs: SETMS, sunAltAtMoonSetDeg: -5 });
    const afterDusk = SV.limitWithoutMoon({ ...dusk.input, sunAltDeg: -5 });
    ok(afterDusk - dusk.r.limitMag < 0.3 && !/달이 지는/.test(card(dusk, 'limit').note), `달이 박명에 지면(해 −5°) 좋아짐 ${(afterDusk - dusk.r.limitMag).toFixed(2)} 등급이라 꼬리가 없다`);
    const faint = sRun({ moonAltDeg: 30, moonIllum: 0.05, lightPollutionMag: 6.0 }, { moonSetMs: SETMS, sunAltAtMoonSetDeg: -30 });
    const afterFaint = SV.limitWithoutMoon({ ...faint.input, sunAltDeg: -30 });
    ok(afterFaint - faint.r.limitMag < 0.3 && !/달이 지는/.test(card(faint, 'limit').note), `가는 달은 좋아짐 ${(afterFaint - faint.r.limitMag).toFixed(2)} 등급이라 꼬리가 없다`);
    const en = sRun({ moonAltDeg: 50, moonIllum: 0.9, lightPollutionMag: 5.5, aod550: 0.2 }, { moonSetMs: SETMS, sunAltAtMoonSetDeg: -30 }, 'en');
    const ja = sRun({ moonAltDeg: 50, moonIllum: 0.9, lightPollutionMag: 5.5, aod550: 0.2 }, { moonSetMs: SETMS, sunAltAtMoonSetDeg: -30 }, 'ja');
    ok(card(en, 'limit').note.includes(`After the moon sets at ${fmt(SETMS)}, stars to magnitude ${after.toFixed(1)} show.`), 'en 도 같은 시각·등급을 말한다');
    ok(card(ja, 'limit').note.includes(`月が沈む${fmt(SETMS)}以降は${after.toFixed(1)}等級まで見えます。`), 'ja 도 같은 시각·등급을 말한다');

    // g. 빛 공해 · 연무
    const lpNone = sRun({ lightPollutionMag: null });
    const lc = card(lpNone, 'light');
    ok(lc.result === '모름' && lc.rows.length === 0 && /못 읽어/.test(lc.note), `빛 지도 없음: "${lc.result}" · "${lc.note}"`);
    const lcv = card(sRun({ lightPollutionMag: 3.2 }), 'light');
    ok(lcv.rows.length === 1 && lcv.rows[0].label === '빛 지도 기준 한계' && lcv.rows[0].value === '3.2 등급', `빛 지도 값 줄: ${lcv.rows[0].label} ${lcv.rows[0].value}`);
    const hz = (o) => card(sRun({ aod550: null, visibilityM: null, ...o }), 'haze');
    const h1 = hz({ aod550: 0.3 });
    ok(h1.rows[0].label === '에어로졸' && h1.rows[0].value === 'AOD 0.30', `AOD 줄: ${h1.rows[0].label} ${h1.rows[0].value}`);
    const h2 = hz({ visibilityM: 12000 });
    ok(h2.rows[0].label === '시정' && h2.rows[0].value === '12 km' && h2.rows[1].label === '어림 AOD' && h2.rows[1].value === SV.aodFromVisibility(12000).toFixed(2), `시정만 있으면: ${h2.rows.map(r => `${r.label} ${r.value}`).join(' | ')}`);
    const h3 = hz({});
    ok(h3.result === '모름' && h3.rows.length === 0 && /맑은 대기로 셌어요/.test(h3.note), `연무 자료 없음: "${h3.result}" · "${h3.note}"`);
    const h4 = hz({ aod550: 0.1, humidityPct: 70, pm25: 18 });
    ok(h4.rows.map(r => `${r.label} ${r.value}`).join(' | ') === 'AOD 에어로졸 0.10 | 습도 70 % | PM2.5 18 µg/m³'.replace('AOD 에어로졸', '에어로졸 AOD'), `습도·PM2.5 줄: ${h4.rows.map(r => `${r.label} ${r.value}`).join(' | ')}`);
    ok(card(sRun({ aod550: 0.05 }), 'haze').note === '대기가 맑아 영향이 작아요.' && /연무가 별빛을 줄여요/.test(card(sRun({ aod550: 0.9 }), 'haze').note), '연무 글이 맑음/뿌연 정도에 따라 다르다');

    // g2. 빛 지도를 못 읽었을 때의 한계 안내
    const cav = (lang, lp) => card(sRun({ lightPollutionMag: lp }, {}, lang), 'limit').note;
    ok(/도시에서는 이보다 덜 보일 수 있어요\.$/.test(cav('ko', null)) && /fewer stars may show in a city\.$/.test(cav('en', null)) && /街中ではこれより少なくなることがあります。$/.test(cav('ja', null)), '빛 지도가 없으면 세 언어 모두 글 끝에 "도시에서는 덜 보일 수 있다" 안내');
    ok(!/도시에서는 이보다/.test(cav('ko', 5.5)) && !/in a city/.test(cav('en', 5.5)), '빛 지도가 있으면 그 안내가 없다');

    // h. 글
    let badTxt = 0, hanOther = 0, noSrc = 0;
    const kinds = [{}, { sunAltDeg: -10 }, { moonAltDeg: 55, moonIllum: 0.9, aod550: 0.9, lightPollutionMag: 3.2 }, { lightPollutionMag: null, aod550: null, visibilityM: 9000, humidityPct: 80, pm25: 30, cloudPct: 90 }];
    for (const L of ['ko', 'en', 'ja']) for (const o of kinds) for (const known of [true, false]) {
      const x = sRun(o, { moonSetMs: SETMS, sunAltAtMoonSetDeg: -30, cloudKnown: known }, L);
      const txt = JSON.stringify(x.out);
      if (/NaN|undefined|Infinity/.test(txt)) badTxt++;
      if (L !== 'ko' && /[가-힣]/.test(txt)) hanOther++;
      if (!/Krisciunas/.test(x.out.footnote)) noSrc++;
    }
    ok(badTxt === 0, '세 언어 · 네 장면 · 구름 있음/없음의 글에 NaN · undefined · Infinity 가 없다');
    ok(hanOther === 0, 'en · ja 글에 한글이 없다');
    ok(noSrc === 0, '아래 글이 모두 출처(Krisciunas & Schaefer)를 밝힌다');

    // i. 사슬
    const seoulAt = (lp) => ST.starArgsFor({ date: new Date('2026-12-21T03:00:00Z'), lat: 37.5665, lon: 126.978, elevM: 38, weatherAt: () => ({ cloudPct: 25, aod550: 0.1, humidityPct: 55 }), lightPollutionMag: lp });
    const dkSeoul = seoulAt(6.2);   // 어두운 곳을 가정(서울 자리의 실제 빛 지도 값은 아래)
    const chain = C.buildStarCards({ ...dkSeoul, language: 'ko', fmtTime: fmt });
    ok(chain.cards.map(c => c.id).join() === 'cloud,moon,light,haze,limit' && card({ out: chain }, 'moon').result !== '없음', `서울 12-21 저녁(해 ${dkSeoul.input.sunAltDeg.toFixed(0)}° · 달 ${dkSeoul.input.moonAltDeg.toFixed(0)}°): 카드 ${chain.cards.map(c => c.id).join()}`);
    const afterChain = SV.limitWithoutMoon({ ...dkSeoul.input, sunAltDeg: dkSeoul.sunAltAtMoonSetDeg });
    const limChain = card({ out: chain }, 'limit').note;
    ok(chain.eventLabel === fmt(dkSeoul.timeMs) && limChain.includes(`달이 지는 ${fmt(dkSeoul.moonSetMs)} 뒤에는 ${afterChain.toFixed(1)} 등급까지`), `달 지는 ${fmt(dkSeoul.moonSetMs)} · 부제 ${chain.eventLabel} · "${limChain.slice(-40)}"`);
    const cityS = seoulAt(3.6);
    const cityOut = C.buildStarCards({ ...cityS, language: 'ko', fmtTime: fmt });
    const gain = SV.limitWithoutMoon({ ...cityS.input, sunAltDeg: cityS.sunAltAtMoonSetDeg }) - SV.starLimit(cityS.input).limitMag;
    ok(/달이 지는/.test(card({ out: cityOut }, 'limit').note) === (gain >= 0.3), `서울의 실제 빛 지도 값(3.6)은 달이 져도 ${gain.toFixed(2)} 등급 좋아져 ${gain >= 0.3 ? '꼬리가 붙는다' : '0.3 미만이라 꼬리가 없다'}`);
  }

  console.log('\n[10] 구름 모양 카드');
  {
    const fs = require('fs');
    const { REPO_ROOT } = require('./paths');
    const SW = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'skyWords.js'));
    const sc0 = { low: 14.6, mid: 10, high: 70, total: 80, genus: 'sc/as/-', tau: 1.84 };
    const W0 = { low: { speedKmh: 11.6, bearingDeg: 315 }, mid: { speedKmh: 30.2, bearingDeg: 270 }, high: { speedKmh: 71.5, bearingDeg: 225 } };
    const build = (o = {}, L = 'ko') => C.buildCloudShapeCards({ language: L, scene: sc0, altKm: { low: 1.24, mid: 4.5, high: 8.96 }, winds: W0, ...o });
    const cc = (r, id) => r.cards.find(c => c.id === id);
    const ko = build();

    ok(ko.cards.map(c => c.id).join() === 'layers,thick,wind,genus' && ko.cards.every(c => c.shape === 'rows') && ['ko', 'en', 'ja'].every(L => build({}, L).title && build({}, L).cards.every(c => c.title && c.note)),
       '(a) 카드 4 장 layers · thick · wind · genus, 모두 rows, 세 언어 모두 제목과 글이 있다');

    const lay = cc(ko, 'layers');
    ok(lay.rows.map(r => `${r.label} ${r.value}`).join('|') === '낮은 층 15 %|중간 층 10 %|높은 층 70 %|전체 80 %' &&
       cc(build({ scene: { ...sc0, total: undefined } }), 'layers').rows.length === 3 && lay.note.startsWith(SW.cloudSummary({ low: 14.6, mid: 10, high: 70 }, 'ko')),
       `(b) 층별 줄 "${lay.rows.map(r => r.value).join(' · ')}", total 이 없으면 3 줄, 글 첫머리가 cloudSummary("${SW.cloudSummary({ low: 14.6, mid: 10, high: 70 }, 'ko')}")`);

    const NAMES = {
      ko: { cu: '적운', cg: '웅대적운', cb: '적란운', sc: '층적운', st: '층운', ns: '난층운', ac: '고적운', as: '고층운', ci: '권운', cs: '권층운' },
      en: { cu: 'cumulus', cg: 'cumulus congestus', cb: 'cumulonimbus', sc: 'stratocumulus', st: 'stratus', ns: 'nimbostratus', ac: 'altocumulus', as: 'altostratus', ci: 'cirrus', cs: 'cirrostratus' },
      ja: { cu: '積雲', cg: '雄大積雲', cb: '積乱雲', sc: '層積雲', st: '層雲', ns: '乱層雲', ac: '高積雲', as: '高層雲', ci: '巻雲', cs: '巻層雲' },
    };
    const wrongNames = [];
    for (const L of ['ko', 'en', 'ja']) for (const [code, name] of Object.entries(NAMES[L])) {
      const v = cc(build({ scene: { ...sc0, genus: `${code}/-/-` } }, L), 'genus').rows[0].value;
      if (v !== name) wrongNames.push(`${L} ${code}: ${v}(기대 ${name})`);
    }
    const g = cc(build({ scene: { ...sc0, genus: 'sc/as/-' } }), 'genus').rows.map(r => r.value).join('|');
    const gNone = cc(build({ scene: { ...sc0, genus: '-' } }, 'en'), 'genus').rows.map(r => r.value).join('|');
    const gJa = cc(build({ scene: { ...sc0, genus: '-/-/-' } }, 'ja'), 'genus').rows.map(r => r.value).join('|');
    const gUnknown = cc(build({ scene: { ...sc0, genus: 'zz/ci/-' } }), 'genus').rows.map(r => r.value).join('|');
    ok(wrongNames.length === 0 && new Set(Object.values(NAMES.ko)).size === 10 && g === '층적운|고층운|없음' && gNone === 'none|none|none' && gJa === 'なし|なし|なし' && gUnknown === 'zz|권운|없음',
       `(c) 열 가지 기호 × 세 언어 이름이 손으로 적은 표와 같고${wrongNames.length ? ' 어긋남: ' + wrongNames.join(', ') : ''}, "sc/as/-" → ${g}, "-" → ${gNone}, 모르는 기호 "zz" 는 그대로 → ${gUnknown}`);

    const bear = [[0, '북쪽'], [22.4, '북쪽'], [22.5, '북동쪽'], [45, '북동쪽'], [90, '동쪽'], [135, '남동쪽'], [180, '남쪽'], [225, '남서쪽'], [270, '서쪽'], [315, '북서쪽'], [337.4, '북서쪽'], [337.5, '북쪽'], [359.9, '북쪽']];
    const badBear = bear.filter(([b, w]) => cc(build({ winds: { low: { speedKmh: 10, bearingDeg: b }, mid: W0.mid, high: W0.high } }), 'wind').rows[0].value !== `${w}에서 시속 10 km`).map(([b, w]) => b);
    const wind = cc(ko, 'wind');
    const windNone = build({ winds: null });
    ok(badBear.length === 0 && wind.rows[0].value === '북서쪽에서 시속 12 km' && wind.rows[1].value === '서쪽에서 시속 30 km' && wind.rows[2].value === '남서쪽에서 시속 72 km' && /약 12 km/.test(wind.note) &&
       cc(windNone, 'wind').rows.length === 1 && cc(windNone, 'wind').rows[0].value === '모름' && /자료가 없어요/.test(cc(windNone, 'wind').note) && !/약 \d/.test(cc(windNone, 'wind').note),
       `(d) 불어오는 방위 13 경우${badBear.length ? ' 어긋남 ' + badBear.join(',') : ''}, 속도 반올림(11.6→12 · 30.2→30 · 71.5→72), 글의 "약 12 km" = 낮은 층 반올림, 바람이 null 이면 "모름" 한 줄과 자료 없음 글(수치 없음)`);

    const th = cc(ko, 'thick');
    const thNone = cc(build({ scene: { ...sc0, tau: undefined }, altKm: { low: null, mid: null, high: null } }), 'thick');
    ok(th.rows.map(r => r.value).join('|') === '1.2 km|4.5 km|9.0 km|1.8' && /높은 구름일수록/.test(th.note) && /값이 클수록/.test(th.note) &&
       thNone.rows.map(r => r.value).join('|') === '모름|모름|모름|모름' && /해가 낮거나 직사광 자료가 없어/.test(thNone.note) && !/높은 구름일수록/.test(thNone.note),
       `(e) 높이 "${th.rows.slice(0, 3).map(r => r.value).join(' · ')}" · 광학 두께 "${th.rows[3].value}", 모르면 모두 "모름" + 이유 글 + 높이 문장 없음`);

    ok(/정확히 맞히기는 어려워요/.test(cc(ko, 'genus').note) && /그럴듯한/.test(cc(ko, 'genus').note) && /hard/.test(cc(build({}, 'en'), 'genus').note) && /plausible/.test(cc(build({}, 'en'), 'genus').note),
       '(f) 종류 카드 글이 규칙은 그럴듯한 기본값이고 정확히 맞히기는 어렵다고 밝힌다(ko · en)');

    let bad = [];
    const grid = [];
    for (const low of [0, 4.4, 50, 100]) for (const tau of [undefined, 0, 1.84, 30]) for (const genus of ['-', 'sc/as/ci', 'cb/-/cs', 'xx/yy/zz']) for (const winds of [null, W0]) for (const total of [undefined, 55]) grid.push({ scene: { low, mid: 20, high: 80, total, genus, tau }, winds });
    for (const L of ['ko', 'en', 'ja']) for (const g of grid) {
      const r = build(g, L);
      const t = JSON.stringify(r);
      if (/NaN|undefined|Infinity|null/.test(t)) bad.push(`${L} ${JSON.stringify(g.scene)} ${/NaN|undefined|Infinity|null/.exec(t)[0]}`);
      if (L !== 'ko' && /[가-힣]/.test(t)) bad.push(`${L} 한글`);
    }
    ok(bad.length === 0, `(g) 입력 격자 ${grid.length * 3} 경우에서 NaN · undefined · Infinity · null 글이 없고 en · ja 에 한글이 없다${bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''}`);

    const T0 = Date.parse('2026-11-19T10:00:00Z');
    ok(C.CLOUD_SCENE_MAX_GAP_MS === 30 * 60e3 && C.cloudSceneUsable(new Date(T0).toISOString(), T0) === true && C.cloudSceneUsable(new Date(T0 - 1800e3).toISOString(), T0) === true && C.cloudSceneUsable(new Date(T0 + 1800e3).toISOString(), T0) === true &&
       C.cloudSceneUsable(new Date(T0 - 1801e3).toISOString(), T0) === false && C.cloudSceneUsable(new Date(T0 + 1801e3).toISOString(), T0) === false && C.cloudSceneUsable('not a date', T0) === false && C.cloudSceneUsable(new Date(T0).toISOString(), NaN) === false,
       '(h) cloudSceneUsable: 30분 이내(경계 포함) true, 30분 1초 false, 못 읽는 시각 글 · NaN false');

    // 2026-11-20: 계산 과정 창(CalcStepsModal)이 학습 페이지의 "결과가 나온 과정" 구역으로 옮겨 갔습니다. 같은 불변식을 새 연결에서 읽습니다.
    const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, 'src', ...p), 'utf8');
    const learn = read('components', 'LearnScreen', 'LearnScreen.tsx');
    const why = read('components', 'LearnScreen', 'WhySection.tsx');
    const topic = read('utils', 'calcTopic.ts');
    const sky = read('components', 'SkyScreen', 'SkyScreen.tsx');
    const cloudMemo = (learn.match(/const cloudArgs = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/) || [''])[0];
    ok(/if \(topic === 'cloud'\) \{\s*return a\.cloudArgs \? buildCloudShapeCards\(\{ \.\.\.a\.cloudArgs, language \}\) : null;/.test(topic) &&
       /getRenderState\?\.\(\)\?\.scene/.test(learn) && /layerWindsFrom\(obs\)/.test(cloudMemo) && /new Date\(st\.t\)/.test(cloudMemo) &&
       /cloudSceneUsable\(scene\.st\.t, atMs\)/.test(learn) &&
       /구름을 그리지 않았어요/.test(why) && /LEARN_TOPICS\.map\(topic =>/.test(why) &&
       /<GlassChip label=\{cloudCaption\} onPress=\{\(\) => learnAt\(currentTime, isSunriseSide \? 'sunrise' : 'sunset', 'why', 'cloud'\)\}/.test(sky),
       '(i) 앱 연결: 만들기 길이 cloud 입력이 없으면 null, 학습 페이지가 장면 상태와 그 그림의 시각 층별 바람으로 입력을 만들고 고른 칸의 시각과 다르면 알리며, 구름 한 줄(새 틀의 유리 칩; 옛 CloudCaption 은 2026-11-21 에 지움)을 누르면 학습의 구름 모양으로 간다');
    ok(/<ScrollView horizontal showsHorizontalScrollIndicator=\{false\}[^>]*>\s*\{LEARN_SECTIONS\.map/.test(learn),
       '(i) 구역 칩 줄이 가로로 밀린다(칩 다섯이 390 폭에서 잘리지 않게; 옛 주제 칩 줄바꿈과 같은 뜻)');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
