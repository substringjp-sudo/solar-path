/**
 * **학습 페이지의 접는 규칙 · 고른 날 · 줄 누름 연결이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/learnSections.ts` 는 학습 페이지(02 학습)에서 무엇을 먼저 보이고 무엇을 접을지, 들어올 때 어느 날을 고를지,
 * 하늘 일정 줄을 누르면 어느 과정 주제를 열지를 정합니다(docs/SANDBOX_MODE_PLAN.md 13.2, 13.3).
 *
 * 먼저 정한 줄(실행 전):
 *  1. 고른 날 우선순위: 01 하늘 카드에서 왔으면(focus) 그 날·쪽 > 앞으로 가장 좋은 때(점수 최고, 이미 지난 것 제외) > 오늘(일몰이 있으면 일몰, 없으면 일출).
 *     날이 없으면 null. focus 가 받은 날에 없으면 다음 우선순위로 넘어간다. 정오는 반나절 안이면 같은 날.
 *  2. 고른 날의 사건: 고른 쪽의 사건을 돌려주고, 그 쪽 사건이 없으면 event 만 null(날은 있음). 고른 날이 목록에 없으면 null.
 *  3. 하늘 일정 줄 → 주제: f_sunrise · f_sunset → score, g_sunrise → sunrise, g_sunset → sunset,
 *     f_crescent · f_milkyway · f_planets · g_moonrise · g_moonset → stars, 모르는 id → score.
 *  4. 하늘 일정 접기: featured 는 먼저, general 은 접는다. 순서는 그대로. featured 가 하나도 없으면 전부 보이고 접는 것은 없다.
 *  6. (2026-11-23 개편 2) 구역 순서는 지금(today) → 앞으로 16일(forecast) → 원리(why) → 근거 데이터(data) → 낮과 밤(globe). 구역마다 이름표(`zoneBadge`)와 범위 글(`zoneRange`)이
 *     세 언어로 있고(en · ja 에 한글 없음), 화면(LearnScreen)이 같은 순서로 `ZoneHead` 를 그리고 오늘 구역 안 "앞으로 24시간" 에도 `ZoneHead` 가 있다.
 *  5. 16일 표 접기: high · past 는 먼저, medium · low · none 은 접는다. 순서는 그대로.
 *     먼저 보일 묶음이 없으면 첫 묶음을 보이고 나머지를 접는다. 묶음이 없으면 둘 다 빈 목록.
 *  6. 과정 항목의 머리 줄(`topicHeadline`): 값과 한 줄 이유를 단계 카드에서 고른다. 값이 없으면 null(지어내지 않는다).
 *     - 값: 노을 점수 · 해 뜨는 시각 · 해 지는 시각은 result 모양 카드의 result 글, 별 보기는 id 'limit' 카드의 막대 글(bar.display),
 *       구름 모양은 id 'genus' 카드의 행 값을 " · " 로 이은 것. 그 카드가 없거나 글이 비면 null.
 *     - 한 줄 이유: key 가 참인 첫 카드의 note(비어 있으면 건너뜀). 없으면 별 보기는 'limit' 카드의 note, 나머지는 맺음말(footnote).
 *       그것도 비면 null.
 *     - 결과 전체가 null 이면(자료 없음) 값 · 이유 모두 null.
 *     - 같은 카드 목록이라도 주제가 다르면 다른 카드를 고른다(주제를 무시하고 첫 result 카드를 쓰지 않는다).
 *  7. 주제 → 단계 카드(`calcTopic.buildTopicResult`): 주제마다 맞는 만드는 함수를 부르고, 없는 입력은 지어내지 않는다.
 *     - 해 뜨는 시각 · 해 지는 시각은 날짜와 장소만으로 만든다(수평선 프로필이 없어도 평평한 수평선으로 카드 4장). 제목은 서로 다르다(뜨는 쪽 · 지는 쪽).
 *     - 넘겨준 시각 글꼴(fmtTime)을 쓴다: 결과 카드의 글이 그 글꼴로 시작한다(기기 시간대로 되돌아가지 않는다).
 *     - 노을 점수 · 별 보기 · 구름 모양은 입력이 null 이면 결과도 null(자료 없음을 숨기거나 맑다고 지어내지 않는다).
 *     - 같은 날짜라도 위도가 다르면 결과가 달라진다(입력을 무시하지 않는다).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-learn-sections.js
 */
const path = require('path');
const fs = require('fs');
const { PREVIEW, REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const L = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'learnSections.js'));

  const H = 3_600_000, D = 24 * H;
  const noon0 = Date.UTC(2026, 10, 19, 3);   // 11.19 12:00 KST
  const now = new Date(noon0 - 4 * H);        // 11.19 08:00 KST
  const ev = (side, hoursFromNoon, score, quality, tier = 'high') => ({
    side, at: new Date(noon0 + hoursFromNoon * H), peakAt: new Date(noon0 + hoursFromNoon * H), score, quality, tier, source: 'forecast', description: null,
  });
  // 오늘(0): 일출은 이미 지남, 일몰 보통 48.  내일(1): 일출 좋음 72, 일몰 보통 44.  모레(2): 일출 없음, 일몰 훌륭함 90.
  const mk = (i, sunrise, sunset) => ({ noonMs: noon0 + i * D, sunrise, sunset });
  const days = [
    mk(0, ev('sunrise', -5, 30, 'Muted', 'past'), ev('sunset', 5, 48, 'Fair')),
    mk(1, ev('sunrise', 19, 72, 'Great'), ev('sunset', 29, 44, 'Fair')),
    mk(2, null, ev('sunset', 53, 90, 'Epic')),
  ];

  // ── [1] 고른 날 ──
  console.log('\n[1] 고른 날');
  {
    const p0 = L.defaultPick(days, now, { noonMs: days[1].noonMs, side: 'sunrise' });
    ok(p0 && p0.noonMs === days[1].noonMs && p0.side === 'sunrise', '01 하늘 카드에서 왔으면 그 날·쪽(내일 일출)');
    const p0b = L.defaultPick(days, now, { noonMs: days[1].noonMs + 3 * H, side: 'sunrise' });
    ok(p0b && p0b.noonMs === days[1].noonMs, '정오가 반나절 안으로 어긋나도 같은 날로 본다');
    const p1 = L.defaultPick(days, now, null);
    ok(p1 && p1.noonMs === days[2].noonMs && p1.side === 'sunset', '카드가 없으면 앞으로 가장 좋은 때(모레 일몰 90)');
    const p1b = L.defaultPick(days, now, { noonMs: days[2].noonMs, side: 'sunrise' });
    ok(p1b && p1b.noonMs === days[2].noonMs && p1b.side === 'sunset', 'focus 가 가리킨 칸이 없으면(모레 일출 없음) 다음 우선순위로 — 모레 일몰은 우연히 가장 좋은 때와 같다');
    const p1c = L.defaultPick(days, now, { noonMs: days[2].noonMs + 9 * D, side: 'sunset' });
    ok(p1c && p1c.noonMs === days[2].noonMs, 'focus 의 날이 받은 날에 없으면 가장 좋은 때로');
    // 가장 좋은 때가 없으면(점수 있는 앞날이 없음) 오늘 일몰
    const bare = [mk(0, null, ev('sunset', 5, null, null, 'none')), mk(1, null, ev('sunset', 29, null, null, 'none'))];
    const p2 = L.defaultPick(bare, now, null);
    ok(p2 && p2.noonMs === bare[0].noonMs && p2.side === 'sunset', '점수 있는 앞날이 없으면 오늘 일몰');
    const sunriseOnly = [mk(0, ev('sunrise', 19, null, null, 'none'), null)];
    const p3 = L.defaultPick(sunriseOnly, now, null);
    ok(p3 && p3.side === 'sunrise', '오늘 일몰이 없으면 일출');
    ok(L.defaultPick([], now, null) === null && L.defaultPick([], now, { noonMs: 1, side: 'sunset' }) === null, '받은 날이 없으면 null');
    // 이미 지난 가장 좋은 때는 고르지 않는다
    const past = [mk(0, null, ev('sunset', -6, 95, 'Epic', 'high')), mk(1, null, ev('sunset', 29, 40, 'Fair', 'high'))];
    const p4 = L.defaultPick(past, now, null);
    ok(p4 && p4.noonMs === past[1].noonMs, '이미 지난 점수 높은 칸(오늘 일몰 95)이 아니라 앞으로의 칸을 고른다');
  }

  // ── [2] 고른 날의 사건 ──
  console.log('\n[2] 고른 날의 사건');
  {
    const a = L.pickedEvent(days, { noonMs: days[1].noonMs, side: 'sunrise' });
    ok(a && a.day === days[1] && a.event === days[1].sunrise, '고른 쪽의 사건을 돌려준다(내일 일출)');
    const b = L.pickedEvent(days, { noonMs: days[2].noonMs, side: 'sunrise' });
    ok(b && b.day === days[2] && b.event === null, '그 쪽 사건이 없으면 날은 있고 event 만 null(모레 일출)');
    ok(L.pickedEvent(days, { noonMs: days[2].noonMs + 9 * D, side: 'sunset' }) === null, '고른 날이 목록에 없으면 null');
    ok(L.pickedEvent(days, null) === null, 'pick 이 없으면 null');
    ok(L.sameNoon(noon0, noon0 + 11.9 * H) && !L.sameNoon(noon0, noon0 + 12 * H), '같은 날 기준은 반나절 미만');
  }

  // ── [3] 줄 → 주제 ──
  console.log('\n[3] 하늘 일정 줄 → 과정 주제');
  {
    const t = L.topicForEventId;
    ok(t('f_sunset') === 'score' && t('f_sunrise') === 'score', '일몰·일출 판정 줄은 노을 점수');
    ok(t('g_sunrise') === 'sunrise' && t('g_sunset') === 'sunset', '일반 해 뜸·해 짐 줄은 해 뜨는·지는 시각');
    ok(['f_crescent', 'f_milkyway', 'f_planets', 'g_moonrise', 'g_moonset'].every(id => t(id) === 'stars'), '초승달·은하수·행성·달 출몰 줄은 별 보기');
    ok(t('zzz') === 'score' && t('') === 'score', '모르는 id 는 노을 점수');
  }

  // ── [4] 하늘 일정 접기 ──
  console.log('\n[4] 하늘 일정 접기');
  {
    const items = [
      { id: 'g_sunrise', category: 'general' }, { id: 'f_sunset', category: 'featured' }, { id: 'g_moonrise', category: 'general' },
      { id: 'f_milkyway', category: 'featured' }, { id: 'g_sunset', category: 'general' },
    ];
    const s = L.splitSkyEvents(items);
    ok(s.shown.map(e => e.id).join() === 'f_sunset,f_milkyway', `추천은 먼저, 순서 그대로: ${s.shown.map(e => e.id)}`);
    ok(s.folded.map(e => e.id).join() === 'g_sunrise,g_moonrise,g_sunset', `일반은 접는다, 순서 그대로: ${s.folded.map(e => e.id)}`);
    const onlyGen = L.splitSkyEvents([{ id: 'g_sunrise', category: 'general' }, { id: 'g_sunset', category: 'general' }]);
    ok(onlyGen.shown.length === 2 && onlyGen.folded.length === 0, '추천이 하나도 없으면 일반을 접지 않고 보인다');
    const none = L.splitSkyEvents([]);
    ok(none.shown.length === 0 && none.folded.length === 0, '줄이 없으면 둘 다 빈 목록');
    ok(s.shown.length + s.folded.length === items.length, '빠지거나 겹친 줄이 없다');
  }

  // ── [5] 16일 표 접기 ──
  console.log('\n[5] 16일 표 접기');
  {
    const g = (tier) => ({ tier, label: tier });
    const s = L.splitForecastGroups([g('high'), g('medium'), g('low')]);
    ok(s.shown.map(x => x.tier).join() === 'high' && s.folded.map(x => x.tier).join() === 'medium,low', '3일 안만 먼저, 7일 안과 16일 안은 접는다');
    const sp = L.splitForecastGroups([g('past'), g('high'), g('none')]);
    ok(sp.shown.map(x => x.tier).join() === 'past,high' && sp.folded.map(x => x.tier).join() === 'none', 'past 도 먼저 보인다, none 은 접는다');
    const noNear = L.splitForecastGroups([g('medium'), g('low')]);
    ok(noNear.shown.map(x => x.tier).join() === 'medium' && noNear.folded.map(x => x.tier).join() === 'low', '3일 안이 없으면 첫 묶음은 보이고 나머지를 접는다');
    const empty = L.splitForecastGroups([]);
    ok(empty.shown.length === 0 && empty.folded.length === 0, '묶음이 없으면 둘 다 빈 목록');
  }

  // ── [6] 과정 항목의 머리 줄 ──
  console.log('\n[6] 과정 항목의 머리 줄');
  {
    const card = (o) => ({ id: 'x', title: 't', shape: 'rows', note: '', ...o });
    const h = L.topicHeadline;
    ok(typeof h === 'function', 'topicHeadline 이 있다');
    if (typeof h === 'function') {
      const score = {
        title: 'T', footnote: '실제 대기는 더 복잡해요.',
        cards: [
          card({ id: 'forecast', note: '내 위치의 17시 예보예요.' }),
          card({ id: 'path', shape: 'bar', key: true, note: '해 쪽 길이 막혀 점수를 가장 크게 깎았어요.', bar: { value: 0.4, display: '40 %' } }),
          card({ id: 'score', shape: 'result', result: '좋음 72', note: '' }),
        ],
      };
      const a = h('score', score);
      ok(a.value === '좋음 72', `노을 점수의 값은 result 카드의 글: ${a.value}`);
      ok(a.reason === '해 쪽 길이 막혀 점수를 가장 크게 깎았어요.', `이유는 key 카드의 note: ${a.reason}`);

      const noKey = { ...score, cards: score.cards.map(c => ({ ...c, key: false })) };
      const b = h('score', noKey);
      ok(b.reason === '실제 대기는 더 복잡해요.', `key 카드가 없으면 이유는 맺음말: ${b.reason}`);

      const emptyKeyNote = { ...score, cards: [card({ id: 'a', key: true, note: '' }), ...score.cards] };
      ok(h('score', emptyKeyNote).reason === '해 쪽 길이 막혀 점수를 가장 크게 깎았어요.', 'note 가 빈 key 카드는 건너뛰고 다음 key 카드의 note 를 쓴다');

      const set = {
        title: 'S', footnote: '예보 일몰 17:40 와 거의 같아요.',
        cards: [card({ id: 'a', note: 'n1' }), card({ id: 'result', shape: 'result', result: '17:42 · 250.1°', note: '' })],
      };
      const c = h('sunset', set);
      ok(c.value === '17:42 · 250.1°' && c.reason === '예보 일몰 17:40 와 거의 같아요.', `해 지는 시각: 값은 result 카드, 이유는 맺음말(key 없음): ${c.value} / ${c.reason}`);
      ok(h('sunrise', set).value === '17:42 · 250.1°', '해 뜨는 시각도 result 카드의 글');

      const stars = {
        title: 'ST', footnote: '한계등급은 천정 하늘 밝기로 구한 값이에요.',
        cards: [
          card({ id: 'cloud', note: '구름이 별을 가려요.', key: true }),
          card({ id: 'limit', shape: 'bar', bar: { value: 0.7, display: '5.8 등급까지' }, note: '맨눈으로 은하수까지 보여요.', key: false }),
        ],
      };
      const d = h('stars', stars);
      ok(d.value === '5.8 등급까지', `별 보기의 값은 limit 카드의 막대 글: ${d.value}`);
      ok(d.reason === '구름이 별을 가려요.', `별 보기도 key 카드가 있으면 그 note: ${d.reason}`);
      const starsNoKey = { ...stars, cards: stars.cards.map(x => ({ ...x, key: false })) };
      ok(h('stars', starsNoKey).reason === '맨눈으로 은하수까지 보여요.', '별 보기에 key 카드가 없으면 limit 카드의 note');
      const starsNoLimit = { ...stars, cards: stars.cards.filter(x => x.id !== 'limit') };
      ok(h('stars', starsNoLimit).value === null, 'limit 카드가 없으면 별 보기의 값은 null');

      const cloud = {
        title: 'C', footnote: '실제 구름은 더 복잡해요.',
        cards: [
          card({ id: 'layers', note: '낮은 구름이 많아요.' }),
          card({ id: 'genus', shape: 'rows', rows: [{ label: '낮은', value: '층적운' }, { label: '중간', value: '없음' }, { label: '높은', value: '권운' }], note: '그럴듯한 종류를 골랐어요.' }),
        ],
      };
      const e = h('cloud', cloud);
      ok(e.value === '층적운 · 없음 · 권운', `구름 모양의 값은 genus 카드 행 값을 · 로 이은 것: ${e.value}`);
      ok(e.reason === '실제 구름은 더 복잡해요.', `구름 모양: key 카드가 없으면 맺음말: ${e.reason}`);

      // 주제를 무시하면 안 된다: 같은 카드 목록이라도 주제에 따라 값이 다르다.
      const mixed = { title: 'M', footnote: 'f', cards: [card({ id: 'result', shape: 'result', result: 'R', note: '' }), card({ id: 'limit', shape: 'bar', bar: { value: 1, display: 'L' }, note: '' }), card({ id: 'genus', rows: [{ label: 'a', value: 'G' }], note: '' })] };
      ok(h('score', mixed).value === 'R' && h('stars', mixed).value === 'L' && h('cloud', mixed).value === 'G', '같은 카드 목록에서 주제마다 다른 카드를 고른다');

      const n = h('score', null);
      ok(n.value === null && n.reason === null, '결과가 null 이면 값 · 이유 모두 null');
      const blank = { title: 'B', footnote: '', cards: [card({ id: 'score', shape: 'result', result: '', note: '' })] };
      const z = h('score', blank);
      ok(z.value === null && z.reason === null, '글이 빈 result 카드와 빈 맺음말은 null(빈 문자열을 돌려주지 않는다)');
    }
  }

  // ── [7] 주제 → 단계 카드 ──
  console.log('\n[7] 주제 → 단계 카드');
  {
    let T = null;
    try { T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'calcTopic.js')); } catch (e) { T = null; }
    ok(T && typeof T.buildTopicResult === 'function', 'buildTopicResult 가 있다');
    if (T && typeof T.buildTopicResult === 'function') {
      const date = new Date(Date.UTC(2026, 10, 20, 3));   // 2026-11-20 12:00 KST
      const base = { language: 'ko', date, latitude: 37.5665, longitude: 126.978, fmtTime: (ms) => `T${ms}` };
      const rise = T.buildTopicResult('sunrise', base);
      const set = T.buildTopicResult('sunset', base);
      ok(rise && set && rise.cards.length === 4 && set.cards.length === 4, '해 뜨는 · 지는 시각은 수평선 프로필 없이도 카드 4장');
      ok(rise && set && rise.title !== set.title && /뜨는/.test(rise.title) && /지는/.test(set.title),
        `제목이 서로 다르고 뜨는 쪽 · 지는 쪽이 맞다: ${rise && rise.title} / ${set && set.title}`);
      const resCard = (r) => r && r.cards.find(c => c.shape === 'result');
      ok(resCard(rise) && /^T\d+/.test(resCard(rise).result) && resCard(set) && /^T\d+/.test(resCard(set).result),
        `결과 카드의 글이 넘겨준 fmtTime 으로 시작한다: ${resCard(set) && resCard(set).result}`);
      ok(T.buildTopicResult('score', base) === null && T.buildTopicResult('score', { ...base, scoreInput: null }) === null, '노을 점수는 입력이 없으면 null');
      ok(T.buildTopicResult('stars', { ...base, starArgs: null }) === null, '별 보기는 입력이 없으면 null');
      ok(T.buildTopicResult('cloud', { ...base, cloudArgs: null }) === null, '구름 모양은 입력이 없으면 null');
      const north = T.buildTopicResult('sunset', { ...base, latitude: 10, longitude: 126.978 });
      ok(north && set && resCard(north).result !== resCard(set).result, '위도가 다르면 결과가 달라진다(입력을 무시하지 않는다)');
      const lat80 = T.buildTopicResult('sunrise', { ...base, latitude: 89, longitude: 0 });
      ok(lat80 === null || lat80.cards.length > 0, '극지에서도 던지지 않는다(null 이거나 카드가 있다)');
    }
  }

  // ── 6. 구역 순서 · 이름표 (2026-11-23 개편 2) ─────────────────────────────
  console.log('\n[6] 구역 순서 · 이름표');
  {
    ok(L.LEARN_SECTIONS.join() === 'today,forecast,why,data,globe', `구역 순서 (${L.LEARN_SECTIONS.join()})`);
    let miss = 0, han = 0;
    for (const sec of [...L.LEARN_SECTIONS, 'hours']) for (const lg of ['ko', 'en', 'ja']) {
      const b = L.zoneBadge(sec, lg), r = L.zoneRange(sec, lg);
      if (!b || !r) miss++;
      if (lg !== 'ko' && (/[가-힣]/.test(b) || /[가-힣]/.test(r))) han++;
    }
    ok(miss === 0, '다섯 구역과 앞으로 24시간 모두 이름표 · 범위 글이 세 언어로 있다');
    ok(han === 0, 'en · ja 이름표 · 범위에 한글이 없다');
    ok(L.zoneBadge('today', 'ko') === '지금' && L.zoneBadge('hours', 'ko') === '앞으로 24시간' && L.zoneBadge('forecast', 'ko') === '앞으로 16일' && L.zoneBadge('why', 'ko') === '원리' && L.zoneBadge('data', 'ko') === '근거 데이터', '한글 이름표: 지금 · 앞으로 24시간 · 앞으로 16일 · 원리 · 근거 데이터');
    const learn = fs.readFileSync(path.join(REPO_ROOT, 'src', 'components', 'LearnScreen', 'LearnScreen.tsx'), 'utf8');
    const today = fs.readFileSync(path.join(REPO_ROOT, 'src', 'components', 'LearnScreen', 'TodaySection.tsx'), 'utf8');
    const idx = ['<TodaySection', '<ForecastSection', '<WhySection', '<DataSection'].map(t => learn.indexOf(t));
    ok(idx.every(i => i > 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]), `화면이 지금 → 16일 → 원리 → 근거 데이터 순서로 그린다 (${idx})`);
    ok(['today', 'forecast', 'why', 'data'].every(k => new RegExp(`<ZoneHead zone="${k}"`).test(learn)) && /<ZoneHead zone="hours"/.test(today), '구역마다 ZoneHead (오늘 구역 안 앞으로 24시간 포함)');
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
