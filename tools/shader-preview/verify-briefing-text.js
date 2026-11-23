/**
 * **데이터 페이지 "지금" · "앞으로 24시간" 해설 문구가 짧고 끊김 없이 읽히는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/timeBriefing.ts` 가 만드는 모든 글(`buildTimeBriefing` · `buildUpcomingTimeline`)을 합성 예보(서울, 2026-11-23)로 여러 장면에서 뽑아 읽습니다.
 * 목업에서 정한 말투: 개조식(짧게 끊는 말, "구름 두꺼움 · 빛 차단"), 공손한 긴 서술(~합니다 · ~입니다) 금지. 같은 뜻을 두 번 말하거나 문장이 중간에서 끊기지 않을 것.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 장면 — 낮 · 골든아워 · 블루아워 · 천문 박명 · 밤, 날씨 자료가 온전한 때(기온 · 이슬점 · 바람 · 강수 있음)와 모자란 때(기온 · 바람 없음), 세 언어.
 *  2. 끊김 없음 — 어느 글도 연결어미/쉼표/가운뎃점으로 끝나지 않는다(ko: 하고 · 이고 · 며 · 으며 · 고 · , · ·). 앞뒤 공백, 이중 공백, 개행, " ." · " ,", "))" · ")(" · "((" 이 없다.
 *     (처음 뽑았을 때 시정 문장이 "…시정이 양호하고" 로 끝나는 것이 실제로 있었다: 바람 자료가 없으면 뒷문장이 안 붙는다.)
 *  3. 말투(ko) — 해설 · 설명 글에 합니다 · 입니다 · 습니다 · 됩니다 · 니다 로 끝나는 문장이 없다. 한 줄 길이: 기상 해설 ≤ 130자, 나머지 해설 · 이벤트 설명 ≤ 110자(예보 덧붙임 제외).
 *  4. 예보 덧붙임 — 이벤트 설명의 날씨 덧붙임은 모두 " · 예보: " 한 모양이다("(예보 기상: …)" 와 "· 예보 기상: …" 두 모양이 섞여 있던 것을 하나로). en 은 " · Forecast: ", ja 는 " · 予報: ".
 *  5. 같은 말 반복 없음(en) — "visibility is N km (visibility is …)" 처럼 낱말이 괄호 안에서 되풀이되지 않는다.
 *  6. NaN · undefined · Infinity 가 없고 en · ja 글에 한글이 없다.
 */
const path = require('path');
const { PREVIEW } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const TB = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'timeBriefing.js'));
  const t0 = Date.parse('2026-11-23T00:00:00+09:00');
  const hours = Array.from({ length: 72 }, (_, i) => t0 + i * 3600e3);
  const mkPt = (d, off, o) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: {
    time: hours.map(h => new Date(h).toISOString()), timeMs: hours,
    low: hours.map(() => o.low), mid: hours.map(() => o.mid), high: hours.map(() => o.high),
    humidity: hours.map(() => 79), visibility: hours.map(() => o.vis ?? 11000), precipitation: hours.map((_, i) => (o.rain && i >= 20 && i < 30 ? 0.8 : 0)),
    temperature: hours.map(() => 10.2), dewPoint: hours.map(() => (o.dewClose ? 9.2 : 8.8)),
    ...(o.full ? { windULow: hours.map(() => 20), windVLow: hours.map(() => -60), windUMid: hours.map(() => 30), windVMid: hours.map(() => -80), windUHigh: hours.map(() => 90), windVHigh: hours.map(() => -200) } : {}),
    directNormalIrradiance: hours.map(() => 200), totalColumnWaterVapour: hours.map(() => 18) } });
  const ringOf = (o) => [mkPt(0, 0, o), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mkPt(d, a, o)))];
  const fmt = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);
  const times = ['2026-11-23T14:02', '2026-11-23T16:45', '2026-11-23T17:40', '2026-11-23T18:20', '2026-11-23T21:00', '2026-11-24T02:00'];
  const variants = [{ low: 40, mid: 87, high: 99, full: true, rain: true, dewClose: true }, { low: 5, mid: 5, high: 5, full: true }, { low: 40, mid: 87, high: 99 }, { low: 0, mid: 10, high: 60, vis: 25000, full: true }];

  const items = [];   // { lang, kind, key, text }
  for (const lang of ['ko', 'en', 'ja']) for (const o of variants) for (const t of times) {
    const ring = ringOf(o);
    const args = { selectedTime: new Date(t + ':00+09:00'), lat: 37.5665, lon: 126.978, elevM: 40, language: lang, ringFor: () => ring, forecast: ring, days: [], lightPollutionMag: 3.6 };
    const b = TB.buildTimeBriefing(args);
    for (const k of ['weatherSummaryTitle', 'weatherNarrative', 'sunTitle', 'sunNarrative', 'moonTitle', 'moonNarrative', 'starTitle', 'starNarrative', 'planetsTitle', 'planetsNarrative'])
      items.push({ lang, kind: k === 'weatherNarrative' ? 'wx' : 'brief', key: k, text: b[k] });
    for (const m of b.weatherMetrics) items.push({ lang, kind: 'metric', key: m.id, text: m.sub ?? '' });
    const ev = TB.buildUpcomingTimeline({ ...args, fmtTime: fmt });
    for (const e of ev) { items.push({ lang, kind: 'event', key: e.id.split('_')[0], text: e.description }); items.push({ lang, kind: 'title', key: e.id.split('_')[0], text: e.title }); }
  }
  console.log(`  (뽑은 글 ${items.length} 개)`);
  const uniq = (arr) => [...new Set(arr)];
  const show = (xs) => uniq(xs).slice(0, 3).map(s => `"${s.slice(0, 70)}…"`).join(' / ');

  console.log('\n[2] 끊김 없음');
  {
    const bad = items.filter(i => i.text && (/(^\s|\s$|\s\s|\n| [.,]|\)\)|\)\(|\(\()/.test(i.text) || (i.lang === 'ko' && /(하고|이고|으며|며|고|,|·)$/.test(i.text.trim())) || /[,、·]$/.test(i.text.trim())));
    ok(bad.length === 0, `연결어미 · 쉼표 · 가운뎃점으로 끝나거나 공백 · 괄호가 이상한 글 ${bad.length} 개${bad.length ? ': ' + show(bad.map(b => b.text.slice(-40))) : ''}`);
  }
  console.log('\n[3] 말투(ko)');
  {
    const ko = items.filter(i => i.lang === 'ko' && ['wx', 'brief', 'event'].includes(i.kind));
    const polite = ko.filter(i => /(합니다|입니다|습니다|됩니다|니다)[.\s)]|(니다)$/.test(i.text));
    ok(polite.length === 0, `공손한 긴 서술 글 ${polite.length} 개${polite.length ? ': ' + show(polite.map(p => p.text)) : ''}`);
    const body = (t) => t.split(' · 예보')[0];
    const tooLong = ko.filter(i => body(i.text).length > (i.kind === 'wx' ? 130 : 110));
    ok(tooLong.length === 0, `길이 초과 글 ${tooLong.length} 개${tooLong.length ? ': ' + show(tooLong.map(p => `${body(p.text).length}자 ${p.text}`)) : ''}`);
  }
  console.log('\n[4] 예보 덧붙임');
  {
    const ev = items.filter(i => i.kind === 'event');
    const mark = { ko: '예보', en: 'Forecast', ja: '予報' };
    const withNote = ev.filter(i => /예보 기상|予想気象|\((Forecast|예보|予報)/.test(i.text) || (/(Forecast: |예보: |予報: )/.test(i.text) && !i.text.includes(` · ${mark[i.lang]}: `)));
    ok(withNote.length === 0, `덧붙임이 " · 예보: " 한 모양이 아닌 글 ${withNote.length} 개${withNote.length ? ': ' + show(withNote.map(w => w.text.slice(-70))) : ''}`);
    ok(ev.some(i => i.text.includes(` · ${mark[i.lang]}: `)), '덧붙임이 실제로 붙는 글이 있다(검사가 비어 있지 않다)');
  }
  console.log('\n[5] 같은 말 반복(en)');
  {
    const bad = items.filter(i => i.lang === 'en' && /visibility is [\d.]+ km \(visibility/.test(i.text));
    ok(bad.length === 0, `"visibility … (visibility …)" 반복 ${bad.length} 개`);
  }
  console.log('\n[6] 글');
  {
    const bad = items.filter(i => /NaN|undefined|Infinity/.test(i.text));
    ok(bad.length === 0, `NaN · undefined · Infinity ${bad.length} 개`);
    const han = items.filter(i => i.lang !== 'ko' && /[가-힣]/.test(i.text));
    ok(han.length === 0, `en · ja 글에 한글 ${han.length} 개${han.length ? ': ' + show(han.map(h => h.text)) : ''}`);
  }
  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
