/**
 * **저장한 장면의 계산이 맞는가** — `src/utils/savedScenes.ts`. 브라우저 · 네트워크가 필요 없습니다. 장면 저장(docs/SANDBOX_MODE_PLAN.md 12.3, 목업 20)의 순수 로직입니다.
 *
 * 장면은 자리 · 눈 높이 · 보는 방향 · 줌 · 날짜와 시각 · 고른 대상을 이 기기에만 저장합니다(날씨는 저장하지 않고 열 때 새로 받습니다).
 * 저장소에서 읽은 값은 앱이 버전이 바뀌거나 파일이 깨져도 화면을 망가뜨리지 않아야 하므로, 읽을 때 한 번 더 정리합니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 * 독립 기준은 손으로 푼 값입니다: 시각은 2026-11-24T09:12:00Z(시간대 +9 로 11.24 18:12), 눈 높이 · 줌 반올림은 막대와 같은 규칙(`verify-sandbox-dials.js` 가 이미 박은 값),
 * 방위 말은 8 방위 각 45° 폭에 북이 337.5~22.5.
 *
 *  1. 값 정리(`makeScene`): 저장하는 값은 화면에 적히는 값과 같게 정리한다. 위도 · 경도는 소수 여섯째 자리(약 0.1 m)로 반올림하고 위도는 −90~90 으로 자르고 경도는 −180 이상 180 미만으로 감는다
 *     (190 → −170, 180 → −180, −181 → 179). 눈 높이는 범위(1.6~300 m)로 자르고 막대와 같은 반올림(31.4 → 31, 1.64 → 1.6, 400 → 300). 줌은 범위(1~20×)와 같은 반올림(7.26 → 7.3, 25 → 20, 0.5 → 1).
 *     방위는 0 이상 360 미만 한 자리(−10 → 350, 359.96 → 0, 128.44 → 128.4), 앙각은 −90~90 한 자리(95 → 90, 6.94 → 6.9). 시각과 저장 시각은 그대로. 숫자가 하나라도 NaN · 무한대면 null(저장하지 않는다).
 *     음의 0 은 0 으로 적는다(JSON 으로 적으면 "0" 이 되어 읽을 때 달라 보이지 않게).
 *  2. 이름: 앞뒤 공백을 자르고 안쪽 공백 묶음은 한 칸으로, 제어 문자는 뺀다. 40 글자(코드 포인트)를 넘으면 40 글자에서 자른다(한글 · 이모지도 한 글자로 센다). 비면 기본 이름
 *     "11.24 18:12 장면"(그 시각을 시간대 tz 로 본 월.일 시:분 + " 장면". 영어 "Scene 11.24 18:12", 일본어 "11.24 18:12 のシーン").
 *  3. 요약 글(`sceneSummary`): "11.24 18:12 · 눈 31 m · 방위 128° · 20×". 눈 높이는 10 m 미만이면 한 자리("1.6 m"), 줌은 정수가 아니면 한 자리("7.3×"), 방위는 정수로 반올림하고 360 이 되면 0.
 *     같은 날(그 시간대 달력 기준)이면 날짜 대신 "오늘 17:04". 자정 경계: 23:59:59 의 장면은 다음 날 00:00:00 에는 오늘이 아니다. 시간대 −5 · +5.5 에서도 시각이 맞다(+5.5 에서 09:12Z → 14:42).
 *     영어는 "Eye" · "Az" · "Today", 일본어는 "目" · "方位" · "今日".
 *  4. 메모 글(`sceneNote`): 고른 대상이 있으면 건물은 "건물 · 555 m"(영어 "Building", 일본어 "建物"), 땅은 "지형 지점 · 3.1 km"(1 km 미만은 "850 m"). 대상이 없으면 하늘 글:
 *     해가 지평선 가까이(고도 −8°~8°, 경계 포함)이고 시선이 해와 60° 안(경계 포함, 방위는 한 바퀴를 돌아 잼)이면 "일몰 · 오른쪽 하늘"(지는 중) 또는 "일출 · 정면 하늘"(뜨는 중), 아니면 시선의 방위 말("남서쪽 하늘").
 *     (2026-11-20 정정: 해 쪽을 나침반이 아니라 보는 사람 기준으로 말한다. 해와 시선의 각 d = 해 방위 − 시선 방위, 한 바퀴를 돌아 −180~180, 오른쪽이 +. |d| ≤ 15° 정면, d > 15° 오른쪽, d < −15° 왼쪽(경계 포함은 정면).
 *      영어 "Ahead" · "Right side" · "Left side", 일본어 "正面の空" · "右の空" · "左の空". 북쪽 지방에서 해가 북서로 져도 나침반 말과 어긋나지 않게 하려는 것.)
 *     방위 말은 8 방위: 북 337.5~22.5, 북동 22.5~67.5, … 경계는 위쪽 방위로(22.5 → 북동쪽, 337.5 → 북쪽). 해를 모르면(null) 방위 말만.
 *  5. 목록: 새로 저장하면 맨 앞(최신순). 50 개가 차면 51 번째는 거절(`reason` 'full')하고 목록은 그대로. 같은 id 는 거절('duplicate'). 이름 바꾸기는 정리한 이름으로, 비면 바꾸지 않고(목록 그대로),
 *     없는 id 도 그대로. 지우기는 그 id 만 뺀다. 원본 목록을 바꾸지 않는다(불변).
 *  6. 읽어 들이기(`sanitizeScenes`): 배열이 아니면 빈 목록. 숫자가 빠졌거나 NaN 이거나 문자열인 장면과 id 가 없는 장면은 버리고, 범위를 벗어난 값은 1 번처럼 자르고, 중복 id 는 앞의 것만, 50 개를 넘으면
 *     앞 50 개만 남긴다. 고른 대상이 망가졌으면 대상만 없애고 장면은 남긴다. 이미 정리된 목록은 그대로(멱등)이고, JSON 으로 적었다 읽어도 같다.
 *  7. 고른 대상 오가기: `targetFromPicked(고른 건물)` = 지붕 한가운데의 위경도 · 해발 · 거리와 건물 다섯 수치(높이 · 밑동 해발 · 꼭대기 해발 · 발자국 긴 변 · 짧은 변), 땅은 고른 점, 위경도를 모르면 null.
 *     `pendingTargetFromScene(장면)` 로 얻은 것을 `rebuildPicked` 에 넣으면(새 눈에서 본 점 tp 를 줄 때) 건물은 같은 높이 · 해발 · 발자국과 새 점으로 다시 만들어지고 땅은 새 점 그대로다. 대상이 없는 장면은 null.
 *  8. 그 시각 해의 자리(`sunNoteAt(시각, 위도, 경도)` = { altDeg, azDeg(나침반 0 이상 360 미만), rising }): 서울(37.5665°N, 126.978°E)의 2026-12-21 에서, 그날 고도가 가장 높은 때(1 분 간격으로 훑어 찾는다)의
 *     고도는 손으로 푼 90° − (37.5665° + 23.44°) = 28.99° 에서 ±0.3° 안, 방위는 남쪽 180° 에서 ±1° 안이다. 그 30 분 뒤는 지는 중(rising 거짓), 3 시간 전은 뜨는 중(참)이고 방위가 100°~180°(동쪽과 남쪽 사이),
 *     3 시간 뒤는 지는 중이고 방위가 180°~260°. 한밤(현지 자정)은 고도가 −25° 아래. 시각 · 자리가 숫자가 아니면 null.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-saved-scenes.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
const J = (x) => JSON.stringify(x);

const T0 = Date.UTC(2026, 10, 24, 9, 12, 0);   // 2026-11-24T09:12:00Z = 시간대 +9 로 11.24 18:12
const BASE = { latitude: 37.5665, longitude: 126.978, eyeHeightM: 31, azDeg: 128.4, elDeg: 6.9, zoomX: 20, timeMs: T0, target: null };

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  let S = null, P = null;
  try { S = await U('savedScenes.js'); } catch { S = null; }
  try { P = await U('pickedTarget.js'); } catch { P = null; }
  ok(!!S && typeof S.makeScene === 'function' && typeof S.sanitizeScenes === 'function' && typeof S.sceneSummary === 'function', 'savedScenes 가 있다');
  if (!S || typeof S.makeScene !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }
  const mk = (over = {}, o = {}) => S.makeScene({ ...BASE, ...over }, { name: o.name ?? '남산', nowMs: o.nowMs ?? T0, id: o.id ?? 'a', tzHours: o.tz ?? 9, lang: o.lang ?? 'ko' });

  // ── 1 값 정리
  console.log('\n[1] 값 정리');
  {
    const a = mk({ latitude: 37.56654321, longitude: 126.97800019 });
    ok(a && a.latitude === 37.566543 && a.longitude === 126.978, `위도 · 경도는 소수 여섯째 자리: ${a && a.latitude}, ${a && a.longitude}`);
    ok(mk({ latitude: 95 }).latitude === 90 && mk({ latitude: -95 }).latitude === -90, '위도는 −90~90 으로 자른다');
    const lons = [190, 180, -181, -180, 540, 0].map(x => mk({ longitude: x }).longitude);
    ok(J(lons) === J([-170, -180, 179, -180, -180, 0]), `경도는 −180 이상 180 미만으로 감는다: ${lons}`);
    const eyes = [31.4, 1.64, 400, 0.5, 9.96, 103, 297.4].map(x => mk({ eyeHeightM: x }).eyeHeightM);
    ok(J(eyes) === J([31, 1.6, 300, 1.6, 10, 105, 295]), `눈 높이는 범위로 자르고 막대와 같은 반올림: ${eyes}`);
    const zs = [7.26, 25, 0.5, 20, 1, 12.3].map(x => mk({ zoomX: x }).zoomX);
    ok(J(zs) === J([7.3, 20, 1, 20, 1, 12.5]), `줌은 범위로 자르고 같은 반올림: ${zs}`);
    const azs = [-10, 359.96, 128.44, 360, 725].map(x => mk({ azDeg: x }).azDeg);
    ok(J(azs) === J([350, 0, 128.4, 0, 5]), `방위는 0 이상 360 미만 한 자리: ${azs}`);
    const els = [95, -95, 6.94, -0.04].map(x => mk({ elDeg: x }).elDeg);
    ok(els[0] === 90 && els[1] === -90 && els[2] === 6.9 && Object.is(els[3], 0), `앙각은 −90~90 한 자리, 음의 0 은 0: ${els}`);
    ok(a.timeMs === T0 && a.savedAtMs === T0 && a.id === 'a' && a.target === null, '시각 · 저장 시각 · id 는 그대로');
    const bad = [{ latitude: NaN }, { longitude: Infinity }, { eyeHeightM: NaN }, { azDeg: -Infinity }, { elDeg: NaN }, { zoomX: NaN }, { timeMs: NaN }].map(o => mk(o));
    ok(bad.every(x => x === null), '숫자가 하나라도 NaN · 무한대면 null');
  }

  // ── 2 이름
  console.log('\n[2] 이름');
  {
    const n = (raw, o) => mk({}, { name: raw, ...o }).name;
    ok(n('  탄천   둔치  ') === '탄천 둔치', '앞뒤 공백을 자르고 안쪽 공백 묶음은 한 칸으로');
    ok(n('가\u0000나\u001f다\u007f') === '가나다', '제어 문자는 뺀다');
    const long = '가'.repeat(41), emoji = '🌅'.repeat(45);
    ok(Array.from(n(long)).length === 40 && n(long) === '가'.repeat(40), '40 글자를 넘으면 40 글자에서 자른다(한글)');
    ok(Array.from(n(emoji)).length === 40, '이모지도 한 글자로 센다');
    ok(n('') === '11.24 18:12 장면' && n('   ') === '11.24 18:12 장면', '비면 기본 이름 "11.24 18:12 장면"');
    ok(n('', { lang: 'en' }) === 'Scene 11.24 18:12' && n('', { lang: 'ja' }) === '11.24 18:12 のシーン', '영어 · 일본어 기본 이름');
    ok(n('', { tz: 5.5 }) === '11.24 14:42 장면' && n('', { tz: -5 }) === '11.24 04:12 장면', '기본 이름의 시각은 시간대를 따른다(+5.5 → 14:42, −5 → 04:12)');
  }

  // ── 3 요약 글
  console.log('\n[3] 요약 글');
  {
    const sc = mk();
    const sum = (s, o = {}) => S.sceneSummary(s, { nowMs: o.nowMs ?? T0 + 86400e3, tzHours: o.tz ?? 9, lang: o.lang ?? 'ko' });
    ok(sum(sc) === '11.24 18:12 · 눈 31 m · 방위 128° · 20×', `"${sum(sc)}"`);
    ok(sum(mk({ eyeHeightM: 1.6, zoomX: 7.3, azDeg: 359.6 })) === '11.24 18:12 · 눈 1.6 m · 방위 0° · 7.3×', '눈 1.6 m · 줌 7.3× · 방위 359.6 → 0°');
    const t1704 = Date.UTC(2026, 10, 24, 8, 4, 0);
    ok(sum(mk({ timeMs: t1704 }), { nowMs: Date.UTC(2026, 10, 24, 2, 0, 0) }) === '오늘 17:04 · 눈 31 m · 방위 128° · 20×', '같은 날이면 "오늘 17:04"');
    const lateNight = mk({ timeMs: Date.UTC(2026, 10, 24, 14, 59, 59) });
    ok(sum(lateNight, { nowMs: Date.UTC(2026, 10, 24, 14, 59, 59) }).startsWith('오늘 23:59'), '23:59:59 의 장면은 그 순간에는 오늘');
    ok(sum(lateNight, { nowMs: Date.UTC(2026, 10, 24, 15, 0, 0) }).startsWith('11.24 23:59'), '다음 날 00:00:00 에는 오늘이 아니다');
    ok(sum(sc, { tz: 5.5 }).startsWith('11.24 14:42') && sum(sc, { tz: -5 }).startsWith('11.24 04:12'), '시간대 +5.5 → 14:42, −5 → 04:12');
    ok(sum(sc, { lang: 'en' }) === '11.24 18:12 · Eye 31 m · Az 128° · 20×' && sum(sc, { lang: 'ja' }) === '11.24 18:12 · 目 31 m · 方位 128° · 20×', '영어 · 일본어');
    const today = sum(mk({ timeMs: t1704 }), { nowMs: Date.UTC(2026, 10, 24, 2, 0, 0), lang: 'en' });
    ok(today.startsWith('Today 17:04') && sum(mk({ timeMs: t1704 }), { nowMs: Date.UTC(2026, 10, 24, 2, 0, 0), lang: 'ja' }).startsWith('今日 17:04'), '영어 "Today" · 일본어 "今日"');
  }

  // ── 4 메모 글
  console.log('\n[4] 메모 글');
  {
    const bld = { kind: 'building', latitude: 37.5126, longitude: 127.1026, elevM: 593, distM: 5400, building: { heightM: 555.4, baseElevM: 38, topElevM: 593, longM: 80, shortM: 60 } };
    const ter = (d) => ({ kind: 'terrain', latitude: 37.55, longitude: 127.1, elevM: 80, distM: d });
    const note = (target, sun, lang = 'ko', az = 245) => S.sceneNote(mk({ target, azDeg: az }), sun, lang);
    ok(note(bld, null) === '건물 · 555 m' && note(bld, null, 'en') === 'Building · 555 m' && note(bld, null, 'ja') === '建物 · 555 m', '건물 대상: "건물 · 555 m"');
    ok(note(ter(3100), null) === '지형 지점 · 3.1 km' && note(ter(850), null) === '지형 지점 · 850 m' && note(ter(1000), null) === '지형 지점 · 1.0 km', '땅 대상: 3.1 km · 850 m · 1.0 km');
    ok(note(ter(3100), null, 'en') === 'Terrain point · 3.1 km' && note(ter(3100), null, 'ja') === '地形の点 · 3.1 km', '영어 · 일본어');
    const setting = (alt, az = 250) => ({ altDeg: alt, azDeg: az, rising: false });
    ok(note(null, setting(-0.5)) === '일몰 · 정면 하늘', '해가 지평선 가까이 지는 중, 해 250° 시선 245°(+5°) → "일몰 · 정면 하늘"');
    ok(note(null, { altDeg: 1, azDeg: 100, rising: true }, 'ko', 90) === '일출 · 정면 하늘', '뜨는 중 → "일출 · 정면 하늘"');
    ok(note(null, setting(8)) === '일몰 · 정면 하늘' && note(null, setting(8.01)) === '남서쪽 하늘' && note(null, setting(-8)) === '일몰 · 정면 하늘' && note(null, setting(-8.01)) === '남서쪽 하늘', '고도 ±8° 경계 포함, 그 밖은 시선 방위 말만');
    ok(note(null, setting(0, 305), 'ko', 245) === '일몰 · 오른쪽 하늘' && note(null, setting(0, 305.5), 'ko', 245) === '남서쪽 하늘', '시선이 해와 60° 안(경계 포함)이어야 한다');
    ok(note(null, setting(0, 185), 'ko', 245) === '일몰 · 왼쪽 하늘' && note(null, setting(0, 184.5), 'ko', 245) === '남서쪽 하늘', '왼쪽도 60° 경계 포함');
    ok(note(null, setting(0, 260), 'ko', 245) === '일몰 · 정면 하늘' && note(null, setting(0, 260.5), 'ko', 245) === '일몰 · 오른쪽 하늘' && note(null, setting(0, 230), 'ko', 245) === '일몰 · 정면 하늘' && note(null, setting(0, 229.5), 'ko', 245) === '일몰 · 왼쪽 하늘', '정면은 ±15°(경계 포함)');
    ok(note(null, { altDeg: 0, azDeg: 20, rising: true }, 'ko', 350) === '일출 · 오른쪽 하늘', '각은 한 바퀴를 돌아 잰다(시선 350°, 해 20° → 오른쪽 30°)');
    ok(note(null, { altDeg: 0, azDeg: 350, rising: true }, 'ko', 20) === '일출 · 왼쪽 하늘', '반대로 시선 20°, 해 350° → 왼쪽 30°');
    ok(note(null, null) === '남서쪽 하늘', '해를 모르면 방위 말만');
    const words = [0, 22.4, 22.5, 67.4, 67.5, 90, 135, 180, 225, 270, 315, 337.4, 337.5, 359].map(a => note(null, null, 'ko', a));
    ok(J(words) === J(['북쪽 하늘', '북쪽 하늘', '북동쪽 하늘', '북동쪽 하늘', '동쪽 하늘', '동쪽 하늘', '남동쪽 하늘', '남쪽 하늘', '남서쪽 하늘', '서쪽 하늘', '북서쪽 하늘', '북서쪽 하늘', '북쪽 하늘', '북쪽 하늘']),
       `8 방위 말과 경계(22.5 → 북동, 337.5 → 북): ${words.join(' / ')}`);
    ok(note(null, setting(0), 'en', 245) === 'Sunset · Ahead' && note(null, setting(0, 280), 'en', 245) === 'Sunset · Right side' && note(null, setting(0, 210), 'en', 245) === 'Sunset · Left side' && note(null, setting(0), 'ja', 245) === '日没 · 正面の空' && note(null, setting(0, 280), 'ja', 245) === '日没 · 右の空' && note(null, setting(0, 210), 'ja', 245) === '日没 · 左の空' && note(null, null, 'en', 245) === 'Southwest sky', '영어 · 일본어 하늘 글');
  }

  // ── 5 목록
  console.log('\n[5] 목록');
  {
    const sc = (id, name = id) => mk({}, { id, name });
    const r1 = S.addScene([], sc('a')), r2 = S.addScene(r1.list, sc('b'));
    ok(r1.ok && r2.ok && J(r2.list.map(s => s.id)) === J(['b', 'a']), '새로 저장하면 맨 앞(최신순)');
    const original = [sc('a'), sc('b')], snap = J(original);
    S.addScene(original, sc('c')); S.renameScene(original, 'a', '새 이름'); S.removeScene(original, 'a');
    ok(J(original) === snap, '원본 목록을 바꾸지 않는다(불변)');
    const dup = S.addScene(r2.list, sc('a', '또'));
    ok(!dup.ok && dup.reason === 'duplicate' && J(dup.list) === J(r2.list), '같은 id 는 거절(duplicate)하고 목록은 그대로');
    let list = [];
    for (let i = 0; i < 50; i++) list = S.addScene(list, sc('s' + i)).list;
    const full = S.addScene(list, sc('extra'));
    ok(list.length === 50 && !full.ok && full.reason === 'full' && full.list.length === 50 && !full.list.some(s => s.id === 'extra'), '50 개가 차면 51 번째는 거절(full)하고 목록은 그대로');
    const rn = S.renameScene(r2.list, 'a', '  탄천   둔치 ');
    ok(rn.find(s => s.id === 'a').name === '탄천 둔치' && rn.find(s => s.id === 'b').name === 'b', '이름 바꾸기는 정리한 이름으로');
    ok(J(S.renameScene(r2.list, 'a', '   ')) === J(r2.list) && J(S.renameScene(r2.list, 'zzz', '이름')) === J(r2.list), '이름이 비면, 없는 id 면 그대로');
    ok(J(S.removeScene(r2.list, 'a').map(s => s.id)) === J(['b']) && S.removeScene(r2.list, 'zzz').length === 2, '지우기는 그 id 만 뺀다');
    const ids = new Set(Array.from({ length: 200 }, (_, i) => S.nextSceneId(T0 + i, () => (i * 0.37) % 1)));
    ok(ids.size === 200 && [...ids].every(x => typeof x === 'string' && x.length > 0 && x.length <= 40), 'nextSceneId 는 겹치지 않고 짧다(200 개)');
  }

  // ── 6 읽어 들이기
  console.log('\n[6] 읽어 들이기');
  {
    const good = (id, over = {}) => ({ ...mk({}, { id, name: id }), ...over });
    ok(J(S.sanitizeScenes(null)) === '[]' && J(S.sanitizeScenes({})) === '[]' && J(S.sanitizeScenes('x')) === '[]' && J(S.sanitizeScenes(undefined)) === '[]', '배열이 아니면 빈 목록');
    const raw = [
      good('ok1'),
      { ...good('noLat'), latitude: undefined },
      { ...good('nan'), eyeHeightM: NaN },
      { ...good('str'), zoomX: '20' },
      { ...good('noId'), id: '' },
      42, null, 'x',
      good('ok1', { name: '중복' }),
      good('far', { latitude: 120, longitude: 200, eyeHeightM: 999, zoomX: 99, azDeg: -90, elDeg: 200 }),
      good('badTarget', { target: { kind: 'terrain', latitude: 'x', longitude: 1, elevM: 1, distM: 1 } }),
      good('goodTarget', { target: { kind: 'building', latitude: 37.5, longitude: 127.1, elevM: 593, distM: 5400, building: { heightM: 555, baseElevM: 38, topElevM: 593, longM: 80, shortM: 60 } } }),
    ];
    const out = S.sanitizeScenes(raw);
    ok(J(out.map(s => s.id)) === J(['ok1', 'far', 'badTarget', 'goodTarget']), `깨진 것 · 중복은 버린다: ${out.map(s => s.id)}`);
    const far = out.find(s => s.id === 'far');
    ok(far.latitude === 90 && far.longitude === -160 && far.eyeHeightM === 300 && far.zoomX === 20 && far.azDeg === 270 && far.elDeg === 90, '범위를 벗어난 값은 1 번처럼 자른다');
    ok(out.find(s => s.id === 'ok1').name === 'ok1', '중복 id 는 앞의 것만 남긴다');
    ok(out.find(s => s.id === 'badTarget').target === null && out.find(s => s.id === 'goodTarget').target.building.heightM === 555, '대상이 망가졌으면 대상만 없애고 장면은 남긴다');
    const many = Array.from({ length: 60 }, (_, i) => good('m' + i));
    ok(S.sanitizeScenes(many).length === 50 && S.sanitizeScenes(many)[49].id === 'm49', '50 개를 넘으면 앞 50 개만');
    ok(J(S.sanitizeScenes(out)) === J(out), '이미 정리된 목록은 그대로(멱등)');
    ok(J(S.sanitizeScenes(JSON.parse(J(out)))) === J(out), 'JSON 으로 적었다 읽어도 같다');
  }

  // ── 7 고른 대상 오가기
  console.log('\n[7] 고른 대상 오가기');
  {
    const tp = { azDeg: 128.4, elDeg: 5.9, distM: 5400, elevM: 593, eastM: 4200, southM: -3300, latitude: 37.5126, longitude: 127.1026, visible: true, marginM: 12 };
    const hit = { ...tp, latitude: 37.5100, longitude: 127.1000, elevM: 40, distM: 5000 };
    const b = { heightM: 555, baseElevM: 38, topElevM: 593, longM: 80, shortM: 60, angularHeightDeg: 5.8, snapped: false, hitPoint: hit, topPoint: tp };
    const pb = { kind: 'building', eyeElevM: 33.6, ...hit, building: b };
    const tb = S.targetFromPicked(pb);
    ok(tb && tb.kind === 'building' && tb.latitude === 37.5126 && tb.longitude === 127.1026 && tb.elevM === 593 && tb.distM === 5400, '건물은 누른 곳을 골랐어도 지붕 한가운데의 위경도 · 해발 · 거리');
    ok(J(tb.building) === J({ heightM: 555, baseElevM: 38, topElevM: 593, longM: 80, shortM: 60 }), '건물 다섯 수치만 기억한다');
    const pt = { kind: 'terrain', eyeElevM: 33.6, ...tp, latitude: 37.55, longitude: 127.1, elevM: 80, distM: 3100 };
    const tt = S.targetFromPicked(pt);
    ok(tt && tt.kind === 'terrain' && tt.latitude === 37.55 && tt.elevM === 80 && tt.distM === 3100 && tt.building === undefined, '땅은 고른 점 그대로, 건물 칸 없음');
    ok(S.targetFromPicked({ ...pt, latitude: null, longitude: null }) === null && S.targetFromPicked(null) === null, '위경도를 모르면 · 대상이 없으면 null');
    const sceneB = mk({ target: tb }), sceneT = mk({ target: tt }), sceneN = mk({});
    const pendB = S.pendingTargetFromScene(sceneB), pendT = S.pendingTargetFromScene(sceneT);
    ok(pendB && pendB.kind === 'building' && pendB.latitude === 37.5126 && pendB.elevM === 593 && pendB.building && pendB.building.heightM === 555, '장면에서 되살린 대기 대상(건물)');
    ok(pendT && pendT.kind === 'terrain' && pendT.building === undefined && S.pendingTargetFromScene(sceneN) === null, '땅 대상 · 대상 없음(null)');
    if (P && typeof P.rebuildPicked === 'function') {
      const tp2 = { azDeg: 200, elDeg: 3, distM: 1500, elevM: 593, eastM: -500, southM: 1400, latitude: 37.5126, longitude: 127.1026, visible: true, marginM: 5, eyeElevM: 33.6 };
      const rb = P.rebuildPicked(pendB.kind, pendB.building, tp2);
      ok(rb.kind === 'building' && rb.azDeg === 200 && rb.distM === 1500 && rb.building.heightM === 555 && rb.building.baseElevM === 38 && rb.building.topElevM === 593 && rb.building.longM === 80 && rb.building.shortM === 60 && rb.building.snapped === true,
         '건물은 같은 높이 · 해발 · 발자국과 새 점으로 다시 만들어진다');
      const rt = P.rebuildPicked(pendT.kind, pendT.building, tp2);
      ok(rt.kind === 'terrain' && rt.azDeg === 200 && rt.building === undefined, '땅은 새 점 그대로');
    } else ok(false, 'pickedTarget 이 있다');
  }

  // ── 8 그 시각 해의 자리
  console.log('\n[8] 그 시각 해의 자리');
  {
    const LAT = 37.5665, LON = 126.978;
    const day0 = Date.UTC(2026, 11, 21, 0, 0, 0);
    let best = null;
    for (let m = 0; m < 1440; m++) { const r = S.sunNoteAt(day0 + m * 60000, LAT, LON); if (r && (!best || r.altDeg > best.r.altDeg)) best = { t: day0 + m * 60000, r }; }
    const wantAlt = 90 - (LAT + 23.44);
    ok(best && near(best.r.altDeg, wantAlt, 0.3), `동지 남중 고도 ${best && best.r.altDeg.toFixed(2)}° = 손으로 푼 ${wantAlt.toFixed(2)}° ± 0.3`);
    ok(best && near(best.r.azDeg, 180, 1), `남중 방위 ${best && best.r.azDeg.toFixed(2)}° ≈ 180° ± 1`);
    const at = (dt) => S.sunNoteAt(best.t + dt * 60000, LAT, LON);
    const after = at(30), before = at(-180), later = at(180), night = S.sunNoteAt(Date.UTC(2026, 11, 21, 15, 0, 0), LAT, LON);
    ok(after.rising === false && before.rising === true && later.rising === false, `남중 30 분 뒤 지는 중, 3 시간 전 뜨는 중, 3 시간 뒤 지는 중`);
    ok(before.azDeg > 100 && before.azDeg < 180 && later.azDeg > 180 && later.azDeg < 260, `3 시간 전 방위 ${before.azDeg.toFixed(1)}°(100~180), 3 시간 뒤 ${later.azDeg.toFixed(1)}°(180~260)`);
    ok(night.altDeg < -25 && night.azDeg >= 0 && night.azDeg < 360, `한밤 고도 ${night.altDeg.toFixed(1)}° < −25, 방위는 0~360`);
    ok(S.sunNoteAt(NaN, LAT, LON) === null && S.sunNoteAt(day0, NaN, LON) === null && S.sunNoteAt(day0, LAT, Infinity) === null, '시각 · 자리가 숫자가 아니면 null');
  }

  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { fail++; console.log('  FAIL: 예외 — ' + (e && e.stack || e)); console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); });
