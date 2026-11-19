/**
 * **01 하늘의 쉬운 말(`skyWords.ts`)이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * 구름 한 줄이 실제 운량과 다르게 말하거나 해 방향이 반대쪽을 가리키면 "쉬운 말" 이 틀린 안내가 됩니다.
 * 기준은 코드의 식이 아니라 **손으로 적은 문턱 표와 나침반 방위의 정의**(북 0 · 동 90 · 남 180 · 서 270, 여덟 방위는 45° 간격)입니다.
 *
 * 먼저 정한 줄(돌려 보기 전):
 *  1. 운량 문턱: 9.99 → 없음 / 10 → 조금 / 34.99 → 조금 / 35 → 보통 / 64.99 → 보통 / 65 → 많음 / 89.99 → 많음 / 90 → 가득.
 *  2. 구름 한 줄(ko): 목업 장면(낮은 20 · 중간 5 · 높은 70) → "낮은 구름 조금 · 높은 구름 많음". 목업 같은 판정 장면(4 · 18 · 63) → "중간 구름 조금 · 높은 구름 보통".
 *     10 % 미만인 층은 말하지 않는다. 전부 10 % 미만이면 "구름이 거의 없어요". 전부 100 % 면 세 층 모두 "가득". 층 순서는 낮은 → 중간 → 높은.
 *  3. 값 없음: 층 값이 NaN · null · undefined 인 층은 건너뛴다(맑다고 지어내지 않음). 하나도 없으면 null, 입력이 null · undefined 여도 null.
 *     한 층만 값이 있고 그것이 10 % 미만이면 "거의 없어요"(값이 있는 층이 있으므로), 값이 있는 층만 말한다.
 *  4. en · ja: 같은 층 · 같은 단계를 말한다(en "Few low clouds · Many high clouds", ja "低い雲 少し · 高い雲 多い"). en · ja 글에 한글이 없고 NaN · undefined 가 없다.
 *  5. 방위: 정확한 8방위(0 북 · 45 북동 · 90 동 · … · 315 북서)가 각각 그 말. 경계는 시계 방향 쪽(22.5 → 북동, 337.5 → 북). 22.4 → 북, 359 → 북, 360 → 북, −90 → 서, 630 → 서(= 270).
 *     한 줄: ko "서쪽 하늘", en "western sky", ja "西の空". NaN · Infinity 는 null.
 *  6. 실제 서울 2026-11-21 일몰 방위(SunCalc 의 일몰 시각의 해 방위, 앱과 다른 구현)가 "남서쪽 하늘" 이거나 "서쪽 하늘" 이다(겨울 일몰은 서남서 약 245°).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-sky-words.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');
const SunCalc = require('suncalc');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const W = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'skyWords.js'));

  console.log('\n[1] 운량 문턱');
  {
    const want = [[9.99, 'none'], [10, 'few'], [34.99, 'few'], [35, 'some'], [64.99, 'some'], [65, 'many'], [89.99, 'many'], [90, 'full'], [0, 'none'], [100, 'full']];
    ok(want.every(([p, l]) => W.coverLevel(p) === l), `문턱: ${want.map(([p]) => `${p}→${W.coverLevel(p)}`).join(' ')}`);
  }

  console.log('\n[2] 구름 한 줄(ko)');
  {
    ok(W.cloudSummary({ low: 20, mid: 5, high: 70 }, 'ko') === '낮은 구름 조금 · 높은 구름 많음', `목업 장면: "${W.cloudSummary({ low: 20, mid: 5, high: 70 }, 'ko')}"`);
    ok(W.cloudSummary({ low: 4, mid: 18, high: 63 }, 'ko') === '중간 구름 조금 · 높은 구름 보통', `판정 목업 장면(4·18·63): "${W.cloudSummary({ low: 4, mid: 18, high: 63 }, 'ko')}"`);
    ok(W.cloudSummary({ low: 9, mid: 0, high: 3 }, 'ko') === '구름이 거의 없어요', '전부 10 % 미만이면 "구름이 거의 없어요"');
    ok(W.cloudSummary({ low: 100, mid: 100, high: 100 }, 'ko') === '낮은 구름 가득 · 중간 구름 가득 · 높은 구름 가득', '전부 100 % 면 세 층 모두 가득(층 순서 낮은 → 중간 → 높은)');
    ok(W.cloudSummary({ low: 90, mid: 65, high: 35 }, 'ko') === '낮은 구름 가득 · 중간 구름 많음 · 높은 구름 보통', '경계값 90 · 65 · 35 는 위 단계');
  }

  console.log('\n[3] 값 없음');
  {
    ok(W.cloudSummary({ low: NaN, mid: undefined, high: null }, 'ko') === null && W.cloudSummary({}, 'ko') === null && W.cloudSummary(null, 'ko') === null && W.cloudSummary(undefined, 'ko') === null, '층 값이 하나도 없으면 null');
    ok(W.cloudSummary({ low: NaN, mid: 5, high: undefined }, 'ko') === '구름이 거의 없어요', '값이 있는 층(중간 5 %)만 보고 말한다: 거의 없음');
    ok(W.cloudSummary({ low: undefined, mid: undefined, high: 80 }, 'ko') === '높은 구름 많음', '값이 있는 층만 말한다(높은 80 %)');
  }

  console.log('\n[4] en · ja');
  {
    const en = W.cloudSummary({ low: 20, mid: 5, high: 70 }, 'en'), ja = W.cloudSummary({ low: 20, mid: 5, high: 70 }, 'ja');
    ok(en === 'Few low clouds · Many high clouds' && ja === '低い雲 少し · 高い雲 多い', `en "${en}" · ja "${ja}"`);
    const all = [];
    for (const L of ['en', 'ja']) for (const c of [{ low: 20, mid: 5, high: 70 }, { low: 0, mid: 0, high: 0 }, { low: 100, mid: 100, high: 100 }, { low: 40, mid: 60, high: 95 }]) all.push(W.cloudSummary(c, L), W.skyDirection(250, L));
    ok(all.every(t => t && !/[가-힣]/.test(t) && !/NaN|undefined|Infinity/.test(t)), 'en · ja 글에 한글 · NaN · undefined 가 없다');
    ok(W.cloudSummary({ low: 0, mid: 0, high: 0 }, 'en') === 'Almost no clouds' && W.cloudSummary({ low: 0, mid: 0, high: 0 }, 'ja') === '雲はほとんどありません', '맑은 하늘 en · ja');
  }

  console.log('\n[5] 방위');
  {
    const ko8 = ['북쪽', '북동쪽', '동쪽', '남동쪽', '남쪽', '남서쪽', '서쪽', '북서쪽'];
    ok([0, 45, 90, 135, 180, 225, 270, 315].every((a, i) => W.compassIndex(a) === i && W.skyDirection(a, 'ko') === `${ko8[i]} 하늘`), '정확한 8방위 각각');
    ok(W.compassIndex(22.4) === 0 && W.compassIndex(22.5) === 1 && W.compassIndex(337.5) === 0 && W.compassIndex(337.4) === 7 && W.compassIndex(359) === 0 && W.compassIndex(360) === 0 && W.compassIndex(-90) === 6 && W.compassIndex(630) === 6, `경계 22.4 → ${W.compassIndex(22.4)}, 22.5 → ${W.compassIndex(22.5)}, 337.5 → ${W.compassIndex(337.5)}, −90 → ${W.compassIndex(-90)}, 630 → ${W.compassIndex(630)}`);
    ok(W.skyDirection(270, 'ko') === '서쪽 하늘' && W.skyDirection(270, 'en') === 'western sky' && W.skyDirection(270, 'ja') === '西の空', '한 줄 세 언어');
    ok(W.skyDirection(NaN, 'ko') === null && W.skyDirection(Infinity, 'en') === null, 'NaN · Infinity 는 null');
  }

  console.log('\n[6] 실제 일몰 방위');
  {
    const noon = new Date('2026-11-21T03:00:00Z');
    const t = SunCalc.getTimes(noon, 37.5665, 126.978).sunset;
    const az = SunCalc.getPosition(t, 37.5665, 126.978).azimuth * 180 / Math.PI + 180;   // SunCalc 은 남쪽 0 · 서쪽 +
    const word = W.skyDirection(az, 'ko');
    ok(/^(남서쪽|서쪽) 하늘$/.test(word), `서울 11월 일몰 방위 ${az.toFixed(1)}° → "${word}"`);
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
