/**
 * **하늘 이벤트 알림 계획이 천체력과 맞는가** (2026-09-30) — 판정. 브라우저가 필요 없습니다.
 *
 * 사용자: "알림설정을 만들어서 일출일몰외에도 다양한 이벤트를 알림하면 좋을거같아."
 * `planSkyNotifications` 는 무엇을 언제 알릴지만 정하는 순수 함수입니다. 먼저 정한 줄(서울):
 *  1. 전부 끄면 계획이 비어 있다.
 *  2. 골든아워 저녁 알림의 이벤트 시각에 해 고도가 6°(±0.3°), 아침은 일출(−0.83° ±0.3°).
 *  3. 블루아워 저녁은 해 −4°(±0.3°), 아침은 −6°(±0.3°).
 *  4. 월출 알림 시각에 달은 막 떠오른다: 고도 +0.133° ±0.3°, 10분 뒤엔 더 높다.
 *  5. 은하수 알림은 보름 무렵(2026-09-26 전후 이틀)엔 없고, 그믐 무렵(2026-10-10)엔 있다 —
 *     하늘 시트와 같은 판단.
 *  6. 모든 알림은 지금 이후, 보내는 시각 = 이벤트 − 미리 알림 분, 가까운 순, id 는 겹치지 않는다.
 *  7. 전부 켜면 개수가 한도(budget) 이하이고, 한도로 잘릴 때 가까운 것이 남는다.
 *  8. 영어·일본어 알림 제목·본문에 한글이 없다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-notification-plan.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const P = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'notificationPlan.js'));
  const SunCalc = require(path.join(__dirname, '..', '..', 'node_modules', 'suncalc'));
  // 해는 앱의 태양력으로 잽니다 — 알림이 쓰는 그 해입니다. 출몰이 그 위치 함수의 근이라
  // 문턱을 0.01° 로 조였습니다. SunCalc 시절엔 getTimes 와 getPosition 이 서로 0.2° 어긋나
  // 0.3° 를 둬야 했습니다(solarPosition.ts 머리말).
  const { sunPosition } = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'solarPosition.js'));
  const LAT = 37.4863, LON = 127.0443, TZ = 9, D = 180 / Math.PI;
  const base = { ...P.DEFAULT_NOTIF_PREFS };
  const off = Object.fromEntries(P.SKY_NOTIF_KINDS.map(k => [k, false]));
  const plan = (now, prefs, extra = {}) => P.planSkyNotifications({ latitude: LAT, longitude: LON, now: new Date(now), prefs: { ...base, ...off, ...prefs }, language: 'ko', tzOffsetHours: TZ, ...extra });
  const sunAlt = (d) => sunPosition(d, LAT, LON).altitude * D;
  const moonAlt = (d) => SunCalc.getMoonPosition(d, LAT, LON).altitude * D;
  const NOW = '2026-09-30T03:00:00Z'; // 서울 정오
  const hasHangul = (s) => /[가-힣]/.test(s);

  console.log('\n[1] 전부 끄면 비어 있다');
  ok(plan(NOW, {}).length === 0, '계획 0개');

  console.log('\n[2] 골든아워 — 저녁 해 6°, 아침 일출');
  {
    const L = plan(NOW, { golden: true });
    const pm = L.filter(n => n.id.endsWith('-pm')), am = L.filter(n => n.id.endsWith('-am'));
    console.log(`      저녁 ${pm.length}개 해 고도 ${pm.map(n => sunAlt(n.eventAt).toFixed(2)).join(' ')}`);
    console.log(`      아침 ${am.length}개 해 고도 ${am.map(n => sunAlt(n.eventAt).toFixed(2)).join(' ')}`);
    ok(pm.length >= 6 && pm.every(n => Math.abs(sunAlt(n.eventAt) - 6) < 0.01), '저녁 골든아워 시작은 해 6°');
    ok(am.length >= 6 && am.every(n => Math.abs(sunAlt(n.eventAt) + 0.833) < 0.01), '아침 골든아워 시작은 일출');
  }

  console.log('\n[3] 블루아워 — 저녁 −4°, 아침 −6°');
  {
    const L = plan(NOW, { blue: true });
    const pm = L.filter(n => n.id.endsWith('-pm')), am = L.filter(n => n.id.endsWith('-am'));
    console.log(`      저녁 ${pm.map(n => sunAlt(n.eventAt).toFixed(2)).join(' ')} · 아침 ${am.map(n => sunAlt(n.eventAt).toFixed(2)).join(' ')}`);
    ok(pm.length >= 6 && pm.every(n => Math.abs(sunAlt(n.eventAt) + 4) < 0.01), '저녁 블루아워는 해 −4°');
    ok(am.length >= 6 && am.every(n => Math.abs(sunAlt(n.eventAt) + 6) < 0.01), '아침 블루아워는 해 −6°');
  }

  console.log('\n[4] 월출 — 달이 막 떠오르는 시각');
  {
    const L = plan(NOW, { moonrise: true });
    console.log(`      ${L.length}개 · 고도 ${L.map(n => moonAlt(n.eventAt).toFixed(2)).join(' ')}`);
    ok(L.length >= 5, '일주일에 월출 알림 5개 이상(월출 없는 날 있을 수 있음)');
    ok(L.every(n => Math.abs(moonAlt(n.eventAt) - 0.133) < 0.3 && moonAlt(new Date(n.eventAt.getTime() + 600e3)) > moonAlt(n.eventAt)), '이벤트 시각에 고도 +0.13° 근처이고 오르는 중');
  }

  console.log('\n[5] 은하수 — 보름엔 없고 그믐엔 있다');
  {
    const full = plan('2026-09-24T03:00:00Z', { milkyway: true }, { days: 5 });
    const newm = plan('2026-10-08T03:00:00Z', { milkyway: true }, { days: 5 });
    console.log(`      보름 무렵 ${full.length}개 · 그믐 무렵 ${newm.length}개`);
    ok(full.length === 0, '9/24~28 은하수 알림 없음');
    ok(newm.length >= 3, '10/8~12 은하수 알림 3개 이상');
  }

  console.log('\n[6] 시각·순서·id');
  {
    const lead = 30;
    const L = plan(NOW, { golden: true, blue: true, moonrise: true, crescent: true, milkyway: true, planets: true, leadMin: lead }, { budget: 999 });
    const now = new Date(NOW).getTime();
    ok(L.every(n => n.fireAt.getTime() > now), '모든 알림이 지금 이후');
    ok(L.every(n => n.eventAt.getTime() - n.fireAt.getTime() === lead * 60e3), `보내는 시각 = 이벤트 − ${lead}분`);
    ok(L.every((n, i) => i === 0 || L[i - 1].fireAt <= n.fireAt), '보내는 시각 순');
    ok(new Set(L.map(n => n.id)).size === L.length, `id ${L.length}개가 모두 다르다`);
    console.log('      종류별 ' + P.SKY_NOTIF_KINDS.map(k => `${k} ${L.filter(n => n.kind === k).length}`).join(' · '));
  }

  console.log('\n[7] 한도');
  {
    const all = { golden: true, blue: true, moonrise: true, crescent: true, milkyway: true, planets: true };
    const big = plan(NOW, all, { budget: 999 }), cut = plan(NOW, all, { budget: 12 }), def = plan(NOW, all);
    console.log(`      한도 없음 ${big.length}개 · 기본 ${def.length}개 · 한도 12 → ${cut.length}개`);
    ok(def.length <= 40, '기본 한도 40 이하');
    ok(cut.length === 12 && cut.every((n, i) => n.id === big[i].id), '잘릴 때 가까운 12개가 남는다');
  }

  console.log('\n[8] 번역');
  {
    const all = { golden: true, blue: true, moonrise: true, crescent: true, milkyway: true, planets: true };
    for (const language of ['en', 'ja']) {
      const L = P.planSkyNotifications({ latitude: LAT, longitude: LON, now: new Date('2026-10-08T03:00:00Z'), prefs: { ...base, ...all }, language, tzOffsetHours: TZ, budget: 999 });
      ok(L.length > 0 && L.every(n => !hasHangul(n.title + n.body)), `${language}: ${L.length}개 모두 한글 없음`);
    }
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
