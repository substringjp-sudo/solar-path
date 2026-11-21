/**
 * **머리줄 탭 이름** — `src/utils/tabLabels.ts` 와 `AppHeader.tsx`. 브라우저 · 네트워크 불필요.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 사용자 결정: 탭 메뉴에 숫자를 붙이지 않고, 학습은 "데이터"로)
 *  1. `tabLabel(id, 언어)`: 'sky' → 하늘 · SKY · 空, 'learn' → 데이터 · DATA · データ, 'log' → 기록 · LOG · 記録. 숫자 앞붙임이 없다(`/^\\d/` 로 시작하는 글이 없다).
 *  2. 세 언어에서 세 탭의 이름이 서로 다르다.
 *  3. 머리줄(`AppHeader`)은 `tabLabel` 로 글을 만들고 `code`(01 · 02 · 03)를 글에 붙이지 않는다. 탭 id 와 순서(sky · learn · log)는 그대로다.
 *  4. 데이터 화면 제목(`LearnScreen`)도 같은 이름이다: 한국어 "데이터", 영어 "Data", 일본어 "データ".
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-tab-labels.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW, REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

(async () => {
  let T = null;
  try { T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'tabLabels.js')); } catch { T = null; }
  ok(!!T && typeof T.tabLabel === 'function', 'tabLabels 가 있다');
  if (!T || typeof T.tabLabel !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }
  const L = (l) => ['sky', 'learn', 'log'].map(id => T.tabLabel(id, l));
  console.log('\n[1~2] 이름');
  ok(JSON.stringify(L('ko')) === JSON.stringify(['하늘', '데이터', '기록']), `한국어: ${L('ko')}`);
  ok(JSON.stringify(L('en')) === JSON.stringify(['SKY', 'DATA', 'LOG']) && JSON.stringify(L('ja')) === JSON.stringify(['空', 'データ', '記録']), `영어 · 일본어: ${L('en')} / ${L('ja')}`);
  ok(['ko', 'en', 'ja'].every(l => !L(l).some(s => /^\d/.test(s))), '숫자 앞붙임이 없다');
  ok(['ko', 'en', 'ja'].every(l => new Set(L(l)).size === 3), '세 탭의 이름이 서로 다르다');
  console.log('\n[3~4] 쓰는 곳');
  const hdr = read('src', 'components', 'AppHeader.tsx');
  ok(/tabLabel\(tab\.id, language\)/.test(hdr) && !/\$\{tab\.code\}/.test(hdr), '머리줄은 tabLabel 로 글을 만들고 code 를 붙이지 않는다');
  ok(/export type AppTab = 'learn' \| 'sky';/.test(hdr) && /id: 'learn'[\s\S]*id: 'sky'/.test(hdr), '탭 id 와 순서(learn → sky)가 맞다');
  const learn = read('src', 'components', 'LearnScreen', 'LearnScreen.tsx');
  ok(/L3\(language, '데이터', 'Data', 'データ'\)/.test(learn), '데이터 화면 제목');
  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
