/**
 * **요청 날짜가 현지 날짜인가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 결함: 요청 날짜를 `toISOString().split('T')[0]`(UTC 날짜)로 만드는데
 * `timezone=auto` 라 API 는 현지시로 답합니다. 한국에서 현지 00:00~08:59
 * (일출 포함)를 겨냥하면 **전날**을 받아오고, 받은 배열에 겨냥한 시각이 없어
 * 마지막 시각으로 잘려 붙습니다.
 *
 * 이 판정은 문자열만 보지 않고 **결과까지** 잽니다 — 받은 하루치 배열에
 * 겨냥한 시각이 들어 있는가. 그게 진짜 증상이기 때문입니다.
 *
 * 시간대를 바꿔 가며 돌리려고 `process.env.TZ` 를 씁니다(Node 가 이후 Date
 * 연산에 반영합니다).
 *
 * 사용: node tools/shader-preview/verify-local-date.js
 *      (stage-esm.js 를 먼저 돌려야 합니다)
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

/** 예전 방식 — 비교용 사본입니다. */
const oldDateStr = (d) => d.toISOString().split('T')[0];

/** 하루치 시간별 배열을 흉내 냅니다: 그 현지 날짜의 00:00~23:00. */
const hoursOf = (dateStr) =>
  Array.from({ length: 24 }, (_, h) => `${dateStr}T${String(h).padStart(2, '0')}:00`);

/**
 * weather.ts 가 하는 대로 시각 문자열을 기기 현지시로 읽고, 겨냥한 시각이
 * **그 하루 안에** 드는지 봅니다(00:00 이상, 다음날 00:00 미만).
 *
 * ⚠ 처음에는 `<= 마지막 시각(23:00)` 으로 썼다가 판정이 스스로 틀렸습니다 —
 * 23:30 을 겨냥하면 **날짜가 맞아도** 거짓이 나왔습니다. 그건 날짜 결함이
 * 아니라 아래 [5]에서 따로 재는 **끝시각 문제**입니다. 자를 고쳤습니다.
 */
const containsTarget = (dateStr, target) => {
  const ms = hoursOf(dateStr).map(t => new Date(t).getTime());
  return target.getTime() >= ms[0] && target.getTime() < ms[ms.length - 1] + 3600_000;
};

(async () => {
  const { localDateString } = await import(
    'file://' + path.join(PREVIEW, 'app', 'utils', 'localDate.js'));

  console.log('\n[1] 실기에서 겪은 그대로 — 서울, 일출 무렵 07:00');
  {
    process.env.TZ = 'Asia/Seoul';
    const target = new Date('2026-09-10T07:00:00+09:00');
    ok(oldDateStr(target) === '2026-09-09', `옛 방식은 전날을 부른다 (${oldDateStr(target)})`);
    ok(localDateString(target) === '2026-09-10', `새 방식은 그날을 부른다 (${localDateString(target)})`);
    ok(containsTarget(oldDateStr(target), target) === false,
       '옛 날짜로 받은 배열에는 07:00 이 **없다** — 그래서 잘려 붙었다');
    ok(containsTarget(localDateString(target), target) === true,
       '새 날짜로 받은 배열에는 07:00 이 들어 있다');
  }

  console.log('\n[2] 대조 — 오후에는 옛 방식도 맞았다 (엉뚱한 데를 안 건드린다)');
  {
    process.env.TZ = 'Asia/Seoul';
    const target = new Date('2026-09-10T18:30:00+09:00');
    ok(oldDateStr(target) === '2026-09-10', '옛 방식도 18:30 에는 맞는다');
    ok(localDateString(target) === oldDateStr(target),
       '그런 시각에는 새 방식이 옛 방식과 같은 값을 낸다');
  }

  console.log('\n[3] 하루 24시간을 시간대별로 쓸어 본다');
  {
    const zones = ['Asia/Seoul', 'UTC', 'Europe/Berlin', 'America/Los_Angeles',
                   'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kathmandu'];
    let newBad = 0, oldBad = 0, oldBadByZone = {};
    for (const tz of zones) {
      process.env.TZ = tz;
      let bad = 0;
      for (let h = 0; h < 24; h++) {
        const t = new Date(2026, 8, 10, h, 30, 0);   // 기기 현지 9/10 h:30
        if (!containsTarget(localDateString(t), t)) newBad++;
        if (!containsTarget(oldDateStr(t), t)) { oldBad++; bad++; }
      }
      oldBadByZone[tz] = bad;
    }
    ok(newBad === 0, `새 방식은 ${zones.length}개 시간대 × 24시간 = 168 경우 모두 겨냥한 시각을 담는다`);
    ok(oldBad > 0, `옛 방식은 그중 ${oldBad} 경우에서 겨냥한 시각을 놓친다`);
    for (const [tz, n] of Object.entries(oldBadByZone)) {
      console.log(`      ${tz.padEnd(22)} 옛 방식이 놓치는 시간 ${n}/24`);
    }
    ok(oldBadByZone['Asia/Seoul'] === 9,
       '서울은 현지 00~08시 아홉 시간을 놓친다 — 일출이 여기 든다');
    ok(oldBadByZone['UTC'] === 0, 'UTC 기기에서는 옛 방식도 멀쩡하다 (그래서 안 드러났다)');
    ok(oldBadByZone['Pacific/Kiritimati'] === 14,
       '동쪽 끝(UTC+14)은 하루의 절반 넘게 놓친다');
    ok(oldBadByZone['America/Los_Angeles'] > 0,
       '서쪽 시간대는 반대 방향으로 어긋난다 — 한국만의 문제가 아니다');
  }

  console.log('\n[4] 월·연 경계');
  {
    process.env.TZ = 'Asia/Seoul';
    const t1 = new Date('2026-10-01T02:00:00+09:00');
    ok(localDateString(t1) === '2026-10-01', `달을 넘어도 맞는다 (${localDateString(t1)}, 옛 방식은 ${oldDateStr(t1)})`);
    const t2 = new Date('2027-01-01T03:00:00+09:00');
    ok(localDateString(t2) === '2027-01-01', `해를 넘어도 맞는다 (${localDateString(t2)}, 옛 방식은 ${oldDateStr(t2)})`);
    const t3 = new Date(2026, 8, 5, 9, 0, 0);
    ok(localDateString(t3) === '2026-09-05', '한 자리 월·일에 0 을 채운다');
  }

  console.log('\n[5] ⚠ 날짜를 고쳐도 남는 것 — 하루의 끝');
  {
    process.env.TZ = 'Asia/Seoul';
    const t = new Date(2026, 8, 10, 23, 30, 0);
    ok(localDateString(t) === '2026-09-10', '23:30 도 날짜는 옳게 나온다');
    const ms = hoursOf('2026-09-10').map(x => new Date(x).getTime());
    ok(t.getTime() > ms[ms.length - 1],
       '그러나 23:30 은 그날 마지막 표본(23:00)보다 뒤라 **오른쪽 이웃이 없다**');
    console.log('      → 하루치만 받는 한 23:00~24:00 은 보간이 아니라 끌기가 됩니다.');
    console.log('        고치려면 하루를 더 받아야 하는데, 그건 이 결함과 별개입니다.');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
