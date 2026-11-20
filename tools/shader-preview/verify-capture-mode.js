/**
 * **촬영 모드 고르기(목업 16)의 순수 계산이 맞는가** — `src/utils/captureMode.ts`. 브라우저 · 네트워크 불필요.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 * 독립 기준: 태양 고도 −6° 는 시민 박명이 끝나는 때(하늘이 어두워져 별이 보이기 시작). 서울(37.5665°N, 126.978°E) 2026-12-21 의 일몰은 약 17:17 KST, 시민 박명 끝은 약 17:52 KST(손으로 어림, 판정은 여유를 둔 시각만 쓴다).
 *
 *  1. 모드 네 개가 이 순서: 일반(normal) · 천체 장노출(astro) · 타임랩스(timelapse) · 이벤트(event).
 *     (2026-11-20 정정, 사용자 결정: 별 일주 모드는 타임랩스 안의 "궤적 누적" 종류로 합쳐져 모드 줄에서 없어졌다. 처음 기준은 다섯 모드였다.) 지금 앱에 있는 것(`ready` 참)은 일반과 천체 장노출뿐이고, 나머지 셋은 거짓(흐린 "준비 중" 줄).
 *     (2026-11-20 정정: 타임랩스가 들어와 타임랩스도 `ready` 참이 된다. 별 일주 · 이벤트는 그대로 거짓. 타임랩스는 카메라 탭이 아니라 자체 패널로 열리므로 `tabForMode` 는 여전히 null.)
 *  2. 카메라 탭으로 옮김(`tabForMode`): 일반 → 'sunset', 천체 장노출 → 'astro', 나머지 → null(아직 못 연다).
 *  3. 권하는 모드(`recommendMode(해 고도)`): 고도 > −6° 이면 일반, 고도 ≤ −6° 이면 천체 장노출(경계 −6 은 천체). 30 → 일반, −5.99 → 일반, −6 → 천체, −30 → 천체. 고도를 모르면(null · NaN · 무한대) 일반.
 *  4. 장면으로 권하기(`modeForScene({ timeMs, latitude, longitude })`): 서울 2026-12-21 한낮 12:00 KST → 일반, 17:30 KST(해 고도 약 −2°) → 일반, 18:30 KST(약 −10°) → 천체, 한밤 03:00 KST → 천체.
 *     자리나 시각이 숫자가 아니면 일반.
 *  5. 글(`modeLabel` · `modeDesc` · `recommendReason`): 한국어 · 영어 · 일본어가 모든 모드에서 비어 있지 않고 언어마다 다르다. 이름 한국어는 일반 · 천체 장노출 · 별 일주 · 타임랩스 · 이벤트.
 *     권하는 이유는 일반과 천체 장노출에만 있다(둘 외 모드는 권하지 않으므로 빈 글이 아니라 null).
 *  6. 모드 시트에 보일 줄(`sheetRows(권하는 모드)`): 맨 위 "권하는 것" 하나(권하는 모드), 아래로 네 모드 전부(권하는 것도 아래에 다시 있다), 각 줄에 모드 키 · ready · 권하는 것 여부.
 *  7. 모드 줄 오른쪽 결과물 글(`modeResultTag(키, 언어)`, 목업 16, 2026-11-20): 일반 "사진" · 천체 장노출 "쌓은 사진" · 타임랩스 "사진 묶음"(목업은 MP4 로 적었지만 이 앱은 아직 영상을 만들지 않아 사실대로 적는다) · 이벤트 "준비 중". 영어 "Photo" · "Stacked photo" · "Photo set" · "Coming soon", 일본어 "写真" · "積み重ね写真" · "写真の束" · "準備中".
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-capture-mode.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;
const KST = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
const SEOUL = { latitude: 37.5665, longitude: 126.978 };

(async () => {
  let C = null;
  try { C = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'captureMode.js')); } catch { C = null; }
  ok(!!C && typeof C.recommendMode === 'function' && typeof C.modeForScene === 'function' && typeof C.tabForMode === 'function', 'captureMode 가 있다');
  if (!C || typeof C.recommendMode !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  const keys0 = () => C.CAPTURE_MODES.map(m => m.key);
  console.log('\n[1~2] 모드와 탭');
  ok(J(C.CAPTURE_MODES.map(m => m.key)) === J(['normal', 'astro', 'timelapse', 'event']), '네 모드의 순서(별 일주는 타임랩스 안으로)');
  ok(J(C.CAPTURE_MODES.map(m => m.ready)) === J([true, true, true, false]), '지금 있는 것은 일반 · 천체 장노출 · 타임랩스, 이벤트는 아직');
  ok(C.tabForMode('normal') === 'sunset' && C.tabForMode('astro') === 'astro' && C.tabForMode('timelapse') === null && C.tabForMode('event') === null, '탭: 일반 → sunset, 천체 → astro, 나머지 null');

  console.log('\n[3] 권하는 모드');
  ok(C.recommendMode(30) === 'normal' && C.recommendMode(-5.99) === 'normal' && C.recommendMode(-6) === 'astro' && C.recommendMode(-30) === 'astro', '30 · −5.99 → 일반, −6 · −30 → 천체');
  ok(C.recommendMode(null) === 'normal' && C.recommendMode(NaN) === 'normal' && C.recommendMode(Infinity) === 'normal' && C.recommendMode(undefined) === 'normal', '모르면 일반');

  console.log('\n[4] 장면으로 권하기');
  const at = (h, mi) => C.modeForScene({ timeMs: KST(2026, 12, 21, h, mi), ...SEOUL });
  ok(at(12, 0) === 'normal' && at(17, 30) === 'normal' && at(18, 30) === 'astro' && at(3, 0) === 'astro', `한낮 · 17:30 일반, 18:30 · 03:00 천체: ${[at(12, 0), at(17, 30), at(18, 30), at(3, 0)]}`);
  ok(C.modeForScene({ timeMs: NaN, ...SEOUL }) === 'normal' && C.modeForScene({ timeMs: 1e12, latitude: NaN, longitude: 1 }) === 'normal', '숫자가 아니면 일반');

  ok(!keys0().includes('startrail') && C.modeLabel('timelapse', 'ko') === '타임랩스' && /궤적/.test(C.modeDesc('timelapse', 'ko')) && /trail/i.test(C.modeDesc('timelapse', 'en')) && /軌跡/.test(C.modeDesc('timelapse', 'ja')), '별 일주 줄이 없고, 타임랩스 결과물 글에 궤적(trail · 軌跡)이 들어 있다');

  console.log('\n[5] 글');
  const keys = C.CAPTURE_MODES.map(m => m.key);
  const langs = ['ko', 'en', 'ja'];
  const filled = (f) => keys.every(k => langs.every(l => typeof f(k, l) === 'string' && f(k, l).length > 0));
  const differ = (f) => keys.every(k => new Set(langs.map(l => f(k, l))).size === 3);
  ok(filled(C.modeLabel) && differ(C.modeLabel) && filled(C.modeDesc) && differ(C.modeDesc), '이름 · 결과물 글: 세 언어 모두 있고 서로 다르다');
  ok(J(keys.map(k => C.modeLabel(k, 'ko'))) === J(['일반', '천체 장노출', '타임랩스', '이벤트']), '한국어 이름');
  ok(langs.every(l => C.recommendReason('normal', l) && C.recommendReason('astro', l)) && new Set(langs.map(l => C.recommendReason('astro', l))).size === 3 && C.recommendReason('timelapse', 'ko') === null && C.recommendReason('event', 'en') === null, '권하는 이유는 일반 · 천체에만(나머지 null), 세 언어가 다르다');

  console.log('\n[6] 시트 줄');
  const rows = C.sheetRows('astro');
  ok(rows.recommended === 'astro' && J(rows.rows.map(r => r.key)) === J(keys) && rows.rows.filter(r => r.recommended).length === 1 && rows.rows.find(r => r.recommended).key === 'astro' && J(rows.rows.map(r => r.ready)) === J([true, true, true, false]), '맨 위 권하는 것 하나 + 네 줄 + 권하는 줄 표시');
  ok(C.sheetRows('normal').rows.find(r => r.recommended).key === 'normal', '일반을 권하면 일반 줄이 표시');

  console.log('\n[7] 결과물 글');
  const tag = (k, l) => C.modeResultTag(k, l);
  ok(J(['normal', 'astro', 'timelapse', 'event'].map(k => tag(k, 'ko'))) === J(['사진', '쌓은 사진', '사진 묶음', '준비 중']) && J(['normal', 'astro', 'timelapse', 'event'].map(k => tag(k, 'en'))) === J(['Photo', 'Stacked photo', 'Photo set', 'Coming soon']) && J(['normal', 'astro', 'timelapse', 'event'].map(k => tag(k, 'ja'))) === J(['写真', '積み重ね写真', '写真の束', '準備中']), '결과물 글 세 언어');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
