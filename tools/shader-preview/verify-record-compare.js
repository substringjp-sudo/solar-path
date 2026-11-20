/**
 * **03 기록의 종류 거르기와 "예측이 얼마나 맞았나" 요약의 순수 계산이 맞는가** — `src/utils/recordCompare.ts`. 브라우저 · 네트워크 불필요.
 * (계획 10.3 "03 기록(17)": 노을 · 별 · 타임랩스 거르기 칩, 위에 최근 피드백 요약, 칸마다 왼쪽 사진 · 오른쪽 예측. 8.7: 구름 양 · 색 칩.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 * 피드백 값: 구름 양 `cloud` = 'more'(실제가 더 많음) · 'same'(비슷) · 'less'(실제가 더 적음), 색 `color` = 'redder'(더 붉음) · 'same'(비슷) · 'weaker'(덜 붉음). 둘 다 선택 항목.
 *
 *  1. 종류(`photoKind(사진)`): 사진에 `kind`('sunset' · 'astro' · 'timelapse')가 있으면 그것. 없으면 찍은 시각(`timestamp`)과 자리(`latitude` · `longitude`)의 해 고도로 정한다: 고도 ≤ −6° 면 'astro', 아니면 'sunset'.
 *     서울(37.5665°N, 126.978°E) 2026-12-21 17:30 KST(고도 약 −2°)에 찍은 사진 → 'sunset', 18:30 KST(약 −10°) → 'astro', 한낮 12:00 KST → 'sunset'. `kind` 가 'timelapse' 면 시각과 상관없이 'timelapse'.
 *     시각이나 자리가 숫자가 아니면(그리고 kind 도 없으면) 'sunset'.
 *  2. 거르기(`filterByKind(사진들, 'all' | 'sunset' | 'astro' | 'timelapse')`): 'all' 은 그대로 모두, 나머지는 그 종류만. 순서는 그대로, 원본은 바꾸지 않는다.
 *  3. 요약(`compareSummary(사진들, 언어)`): 사진들은 최신순으로 이미 정렬되어 있다. **피드백(`compare`)이 하나라도 있는 최근 10 장**을 본다(`SUMMARY_WINDOW` = 10). n = 그 장수.
 *     구름 비슷 수 a = 그중 cloud === 'same', 색 비슷 수 b = color === 'same'. n = 0 이면 null.
 *     한국어 "최근 3번 중 구름 양 2번 비슷, 색 1번 비슷", 영어 "Last 3: cloud amount matched 2×, color matched 1×", 일본어 "直近3回: 雲の量が2回一致、色が1回一致".
 *     피드백이 없는 사진은 세지 않는다(n 에도 안 들어간다). 11 장이면 가장 오래된 한 장은 빠진다.
 *  4. 치우침(`compareBias(사진들)`) = { cloud, color } 각각 'more' · 'less' · null / 'redder' · 'weaker' · null: 같은 최근 10 장 안에서 그 값이 **응답한 수의 60% 이상이고 응답이 3 번 이상**이면 그 값, 아니면 null.
 *     (예: cloud 응답 5 번 중 'more' 3 번 → 60% 라 'more'. 5 번 중 2 번 → null. 응답 2 번이면 둘 다 'more' 라도 null. 색 응답 4 번 중 'redder' 2 번은 50% 라 null, 3 번은 75% 라 'redder'. 처음 시험 자료에 응답 3 번 중 2 번(66.7%)을 null 이라고 적었는데 66.7% 는 60% 이상이라 기준을 잘못 적용한 것이었고, 자료를 4 번 중 2 번으로 고쳤습니다. 기준은 그대로입니다.) 'same' 이 60% 이상이면 null(치우침 아님).
 *  5. 치우침 글(`biasLine(치우침, 언어)`): cloud 'more' → "예측이 구름을 적게 보는 편이에요", 'less' → "예측이 구름을 많이 보는 편이에요", color 'redder' → "예측이 덜 붉게 나오는 편이에요", 'weaker' → "예측이 더 붉게 나오는 편이에요".
 *     둘 다 있으면 " · "로 잇는다. 둘 다 null 이면 null. 영어 · 일본어도 있고 서로 다르다.
 *  6. 피드백 합치기(`mergeCompare(이전, 새 값)`): 새 값에 있는 칸만 덮어쓴다(이전 { cloud:'same', color:'redder' } 에 { color:'same' } → { cloud:'same', color:'same' }). 같은 값을 다시 고르면 그 칸이 꺼진다(undefined): 이전 { cloud:'same' } 에 { cloud:'same' } → {}.
 *     이전이 없으면(undefined) 새 값 그대로. 원본을 바꾸지 않는다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-record-compare.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;
const KST = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
const SEOUL = { latitude: 37.5665, longitude: 126.978 };

(async () => {
  let R = null;
  try { R = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'recordCompare.js')); } catch { R = null; }
  ok(!!R && typeof R.photoKind === 'function' && typeof R.compareSummary === 'function' && typeof R.mergeCompare === 'function', 'recordCompare 가 있다');
  if (!R || typeof R.photoKind !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  console.log('\n[1] 종류');
  const at = (h, mi, extra = {}) => ({ id: 'x', timestamp: KST(2026, 12, 21, h, mi), ...SEOUL, ...extra });
  ok(R.photoKind(at(17, 30)) === 'sunset' && R.photoKind(at(18, 30)) === 'astro' && R.photoKind(at(12, 0)) === 'sunset', '17:30 sunset, 18:30 astro, 12:00 sunset');
  ok(R.photoKind(at(18, 30, { kind: 'sunset' })) === 'sunset' && R.photoKind(at(12, 0, { kind: 'timelapse' })) === 'timelapse' && R.photoKind(at(12, 0, { kind: 'astro' })) === 'astro', 'kind 가 있으면 그것');
  ok(R.photoKind({ id: 'y', timestamp: NaN, latitude: 1, longitude: 1 }) === 'sunset' && R.photoKind({ id: 'y', timestamp: 1e12, latitude: NaN, longitude: 1 }) === 'sunset', '숫자가 아니면 sunset');

  console.log('\n[2] 거르기');
  const list = [at(17, 30, { id: 'a' }), at(18, 30, { id: 'b' }), at(12, 0, { id: 'c', kind: 'timelapse' }), at(12, 0, { id: 'd' })];
  const copy = J(list);
  ok(J(R.filterByKind(list, 'all').map(p => p.id)) === J(['a', 'b', 'c', 'd']) && J(R.filterByKind(list, 'sunset').map(p => p.id)) === J(['a', 'd']) && J(R.filterByKind(list, 'astro').map(p => p.id)) === J(['b']) && J(R.filterByKind(list, 'timelapse').map(p => p.id)) === J(['c']), 'all · sunset · astro · timelapse');
  ok(J(list) === copy, '원본을 바꾸지 않는다');

  console.log('\n[3] 요약');
  // (변이 시험에서 색 'same' 대신 'redder' 를 세도 통과해, 시험 자료의 색을 'weaker' 로 바꿔 구분되게 했습니다. 기준은 그대로.)
  const ph = (id, compare) => ({ id, timestamp: 1e12, ...SEOUL, compare });
  const three = [ph('1', { cloud: 'same', color: 'weaker' }), ph('2', { cloud: 'same', color: 'same' }), ph('3', { cloud: 'more' }), ph('4', undefined)];
  ok(R.compareSummary(three, 'ko') === '최근 3번 중 구름 양 2번 비슷, 색 1번 비슷', `한국어: ${R.compareSummary(three, 'ko')}`);
  ok(R.compareSummary(three, 'en') === 'Last 3: cloud amount matched 2×, color matched 1×' && R.compareSummary(three, 'ja') === '直近3回: 雲の量が2回一致、色が1回一致', '영어 · 일본어');
  ok(R.compareSummary([ph('a', undefined), ph('b', {})], 'ko') === null && R.compareSummary([], 'ko') === null, '피드백이 없으면 null({} 도 없는 것)');
  const eleven = Array.from({ length: 11 }, (_, i) => ph('p' + i, i === 10 ? { cloud: 'same', color: 'same' } : { cloud: 'more' }));
  ok(R.compareSummary(eleven, 'ko') === '최근 10번 중 구름 양 0번 비슷, 색 0번 비슷', `최근 10 장만(가장 오래된 한 장은 빠진다): ${R.compareSummary(eleven, 'ko')}`);
  ok(R.SUMMARY_WINDOW === 10, 'SUMMARY_WINDOW = 10');

  console.log('\n[4~5] 치우침');
  const bias = (c, k) => R.compareBias([...c.map((v, i) => ph('c' + i, v === null ? undefined : { cloud: v })), ...k.map((v, i) => ph('k' + i, { color: v }))]);
  ok(bias(['more', 'more', 'more', 'same', 'same'], []).cloud === 'more' && bias(['more', 'more', 'same', 'same', 'less'], []).cloud === null, '5 번 중 3 번 more → more, 2 번 → null');
  ok(bias(['more', 'more'], []).cloud === null && bias(['less', 'less', 'less'], []).cloud === 'less', '응답 2 번이면 null, 3 번 모두 less → less');
  ok(bias([], ['same', 'same', 'same']).color === null && bias([], ['redder', 'redder', 'same', 'same']).color === null && bias([], ['redder', 'redder', 'redder', 'same']).color === 'redder' && bias([], ['weaker', 'weaker', 'weaker']).color === 'weaker', 'same 이 많으면 null, 50% 는 null, 75% redder, weaker 100%');
  ok(R.biasLine({ cloud: 'more', color: null }, 'ko') === '예측이 구름을 적게 보는 편이에요' && R.biasLine({ cloud: 'less', color: null }, 'ko') === '예측이 구름을 많이 보는 편이에요' && R.biasLine({ cloud: null, color: 'redder' }, 'ko') === '예측이 덜 붉게 나오는 편이에요' && R.biasLine({ cloud: null, color: 'weaker' }, 'ko') === '예측이 더 붉게 나오는 편이에요', '한국어 치우침 글 넷');
  ok(R.biasLine({ cloud: 'more', color: 'weaker' }, 'ko') === '예측이 구름을 적게 보는 편이에요 · 예측이 더 붉게 나오는 편이에요' && R.biasLine({ cloud: null, color: null }, 'ko') === null, '둘 다 있으면 " · ", 없으면 null');
  ok(R.biasLine({ cloud: 'more', color: null }, 'en') && R.biasLine({ cloud: 'more', color: null }, 'ja') && new Set(['ko', 'en', 'ja'].map(l => R.biasLine({ cloud: 'more', color: null }, l))).size === 3, '영어 · 일본어 있고 서로 다르다');

  console.log('\n[6] 합치기');
  ok(J(R.mergeCompare({ cloud: 'same', color: 'redder' }, { color: 'same' })) === J({ cloud: 'same', color: 'same' }), '새 값의 칸만 덮어쓴다');
  ok(J(R.mergeCompare({ cloud: 'same' }, { cloud: 'same' })) === J({}) && J(R.mergeCompare(undefined, { cloud: 'more' })) === J({ cloud: 'more' }), '같은 값을 다시 고르면 꺼진다, 이전이 없으면 새 값 그대로');
  const prev = { cloud: 'same' }; R.mergeCompare(prev, { cloud: 'more' });
  ok(J(prev) === J({ cloud: 'same' }), '원본을 바꾸지 않는다');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
