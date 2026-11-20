/**
 * **03 기록 화면(종류 거르기 · 요약 · 사진/예측 반반 칸)과 피드백 칩의 이음새(소스 검사)** — `Gallery` · `CompareChips` · `PostDetailModal` · 저장소. 브라우저 · 네트워크 불필요.
 * 계산은 `verify-record-compare.js` 가 잰다. 여기서는 연결이 끊기지 않았는지만 소스에서 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20)
 *  1. 저장소: 사진(`MyPhoto`)에 `kind`(선택)와 `compare`(선택)가 있고, `setPhotoCompare(사진 id, 새 값)` 가 이전 값과 `mergeCompare` 로 합쳐 지역 목록을 먼저 고치고 서버(Firestore)에도 `compare` 로 쓴다(서버 실패는 경고만, 화면은 그대로).
 *  2. 피드백 칩(`CompareChips`): 구름 양 셋(실제가 더 많음 · 비슷 · 더 적음)과 색 셋(더 붉음 · 비슷 · 덜 붉음), 켜진 칩은 `selected` 로 알리고 누르면 `onChange({ cloud })` 또는 `onChange({ color })`.
 *  3. 사진 상세(`PostDetailModal`): 내 사진에서만(`isMyPhoto`) 예측 정확도 카드 안에 칩이 있고, 누르면 지역 상태를 먼저 `mergeCompare` 로 고치고 `setPhotoCompare` 를 부른다.
 *  4. 03 기록(`Gallery`): 종류 칩 넷(전체 · 노을 · 별 · 타임랩스)이 `filterByKind` 로 거른다(내 사진 · 전체 사진 둘 다). "내 사진" 탭에서 요약(`compareSummary`)이 있으면 "예측이 얼마나 맞았나" 카드와 치우침 글(`biasLine`)이 위에 보인다.
 *     요약은 종류 거르기와 상관없이 내 사진 전체의 최근 것으로 만든다. 예측 그림이 있는 칸은 왼쪽 반 사진 · 오른쪽 반 예측으로 그린다.
 *
 *   node tools/shader-preview/verify-record-ui.js
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

const store = read('src', 'store', 'useCelestialStore.ts');
const chips = read('src', 'components', 'CompareChips.tsx');
const modal = read('src', 'components', 'PostDetailModal.tsx');
const gal = read('src', 'components', 'Gallery.tsx');

console.log('[1] 저장소');
ok(/kind\?: PhotoKind;\s+\/\*\* 한 번 누르는 피드백[^\n]*\n\s+compare\?: PhotoCompare;/.test(store), 'MyPhoto 에 kind · compare(선택)');
const act = (store.match(/setPhotoCompare: async \(photoId: string, next: PhotoCompare\) => \{[\s\S]*?\n      \},\n/) || [''])[0];
ok(/const merged = mergeCompare\(prev, next\);\s+set\(\(state\) => \(\{\s+myPhotos: state\.myPhotos\.map\(p => p\.id === photoId \? \{ \.\.\.p, compare: merged \} : p\),/.test(act) && /updateDoc\(userPhotoRef, \{ compare: merged \}\)/.test(act) && /console\.warn\('\[setPhotoCompare\]/.test(act), '합쳐서 지역 목록을 먼저 고치고 서버에도 쓴다(실패는 경고만)');

console.log('\n[2] 피드백 칩');
ok(/'실제가 더 많음'/.test(chips) && /'더 적음'/.test(chips) && /'더 붉음'/.test(chips) && /'덜 붉음'/.test(chips) && (chips.match(/'비슷'/g) || []).length === 2, '구름 양 셋 · 색 셋');
ok(/onChange\(\{ cloud: c\.v \}\)/.test(chips) && /onChange\(\{ color: c\.v \}\)/.test(chips) && /accessibilityState=\{\{ selected: on \}\}/.test(chips), '누르면 onChange, 켜진 칩은 selected');

console.log('\n[3] 사진 상세');
ok(/\{isMyPhoto && \(\s+<View style=\{styles\.feedbackCard\}>[\s\S]*?<CompareChips language=\{language\} value=\{currentCompare\} onChange=\{handleCompare\} \/>/.test(modal), '내 사진에서만, 예측 정확도 카드 안에 칩');
ok(/setCurrentCompare\(prev => mergeCompare\(prev, next\)\);\s+if \(photo\?\.id\) await setPhotoCompare\(photo\.id, next\);/.test(modal), '지역 상태를 먼저 고치고 setPhotoCompare');

console.log('\n[4] 03 기록');
ok(/\(\['all', 'sunset', 'astro', 'timelapse'\] as const\)\.map\(k => \(/.test(gal) && /filterByKind\(Array\.from\(mergedMap\.values\(\)\)\.sort\(\(a, b\) => b\.timestamp - a\.timestamp\), kindFilter\)/.test(gal) && /return filterByKind\(globalPhotos, kindFilter\);/.test(gal), '종류 칩 넷, 내 사진 · 전체 사진 모두 filterByKind');
ok(/compareSummary\(mine, language\)/.test(gal) && /biasLine\(compareBias\(mine\), language\)/.test(gal) && /galleryFilter === 'mine' && summary\.text/.test(gal) && /'예측이 얼마나 맞았나'/.test(gal), '내 사진 탭에서 요약 카드와 치우침 글');
ok(/const mine = \[\.\.\.\(myPhotos \|\| \[\]\)\]\.sort/.test(gal), '요약은 종류 거르기와 상관없이 내 사진 전체에서');
ok(/simUri \? \(\s+\/\/[^\n]*\n\s+<View style=\{\[styles\.galleryImage, styles\.splitRow\]\}>\s+<Image source=\{\{ uri: photoUri \}\}[^\n]*\n\s+<Image source=\{\{ uri: simUri \}\}/.test(gal), '예측 그림이 있으면 왼쪽 사진 · 오른쪽 예측 반반 칸');

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
