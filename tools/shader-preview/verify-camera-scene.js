/**
 * **"이 장면 찍기"와 촬영 모드 시트의 이음새(소스 검사)** — 샌드박스 → 카메라 넘김과 카메라의 모드 시트 연결. 브라우저 · 네트워크 불필요.
 * 계산은 `verify-capture-mode.js` 가 잰다. 여기서는 연결이 끊기지 않았는지만 소스에서 본다(카메라는 실기기에서만 돈다).
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20)
 *  1. 저장소: `cameraScene`(처음 null)과 `setCameraScene` 이 있고, **저장하지 않는다**(`partialize` 에 `cameraScene` 이 없다).
 *  2. 하늘 화면: `shootScene` 이 지금 장면을 `readScene('')` 로 읽어(못 읽으면 아무것도 안 함) 저장소 `setCameraScene` 에 넣고 `onCameraPress` 를 부른다. 장면 줄(`SceneBar`)을 그리는 두 곳 모두 `onShoot={shootScene}` 을 건다.
 *  3. 장면 줄: `onShoot` 은 선택 항목이고, 있을 때만 "이 장면 찍기" 단추(영어 "Shoot", 일본어 "撮る")를 그린다.
 *  4. 카메라: 보이는 동안 넘어온 장면이 있으면 장면의 방위 · 앙각으로 방향 안내 목표(`lockedTarget`)를 잡고 `tabForMode(modeForScene(장면))` 으로 탭을 연다. 카메라가 사라질 때 장면을 지운다.
 *     위쪽 줄에 장면 이름과 요약이 보이고 "장면 지우기" 단추가 목표와 장면을 함께 지운다.
 *  5. 모드 시트: 탭 묶음 끝 "모드" 단추가 시트를 열고, 권하는 모드는 장면이 있으면 `modeForScene(장면)` 없으면 `recommendMode(해 고도)`. 고르면 `pickMode` 가 탭(`setCameraTab`) 또는 타임랩스 패널을 연다.
 *     (2026-11-20 정정: 타임랩스가 들어오며 시트는 탭이 아니라 모드 키를 돌려준다. 열 수 있는 모드만 고르게 하는 기준은 그대로.)
 *  6. 시트: `sheetRows` 로 줄을 만들고, 못 여는 모드(탭이 null)는 `disabled` 이며 누르면 아무 일도 없다(`tabForMode` 가 null 이면 반환). 글은 `captureMode` 의 `modeLabel` · `modeDesc` · `recommendReason` 만 쓴다.
 *
 *   node tools/shader-preview/verify-camera-scene.js
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

const store = read('src', 'store', 'useCelestialStore.ts');
const sky = read('src', 'components', 'SkyScreen', 'SkyScreen.tsx');
const bar = read('src', 'components', 'SkyScreen', 'SceneBar.tsx');
const cam = read('src', 'components', 'SunCamera.tsx');
const sheet = read('src', 'components', 'AstroCamera', 'CaptureModeSheet.tsx');

console.log('[1] 저장소');
ok(/cameraScene: SavedScene \| null;/.test(store) && /setCameraScene: \(scene: SavedScene \| null\) => void;/.test(store) && /cameraScene: null,/.test(store) && /setCameraScene: \(scene\) => set\(\{ cameraScene: scene \}\)/.test(store), 'cameraScene(처음 null) · setCameraScene');
const part = (store.match(/partialize: \(state\) => \(\{[\s\S]*?\n      \}\)/) || [''])[0];
ok(part.length > 50 && !/cameraScene/.test(part), '저장하지 않는다(partialize 에 없음)');

console.log('\n[2] 하늘 화면');
const shoot = (sky.match(/const shootScene = \(\) => \{[\s\S]*?\n  \};\n/) || [''])[0];
ok(/const sc = readScene\(''\);\s+if \(!sc\) return;\s+useCelestialStore\.getState\(\)\.setCameraScene\(sc\);\s+onCameraPress\?\.\(\);/.test(shoot), 'shootScene: 읽고(못 읽으면 그만) → 저장소에 넣고 → onCameraPress');
ok((sky.match(/onShoot=\{shootScene\}/g) || []).length === 2 && (sky.match(/<SceneBar /g) || []).length === 2, 'SceneBar 두 곳 모두 onShoot 을 건다');

console.log('\n[3] 장면 줄');
ok(/onShoot\?: \(\) => void;/.test(bar) && /\{onShoot && \(/.test(bar) && /L3\(language, '이 장면 찍기', 'Shoot', '撮る'\)/.test(bar), 'onShoot 선택 항목, 있을 때만 "이 장면 찍기" 단추');

console.log('\n[4] 카메라');
ok(/useEffect\(\(\) => \{\s+if \(!visible \|\| !cameraScene\) return;\s+setLockedTarget\(\{ azDeg: cameraScene\.azDeg, elDeg: cameraScene\.elDeg \}\);\s+const tab = tabForMode\(modeForScene\(cameraScene\)\);\s+if \(tab\) setCameraTab\(tab\);\s+\}, \[visible, cameraScene\]\);/.test(cam), '장면의 방위 · 앙각으로 목표를 잡고 시각에 맞는 탭을 연다');
ok(/useEffect\(\(\) => \(\) => \{ useCelestialStore\.getState\(\)\.setCameraScene\(null\); \}, \[\]\);/.test(cam), '카메라가 사라질 때 장면을 지운다');
ok(/\{cameraScene && \(/.test(cam) && /cameraScene\.name/.test(cam) && /sceneSummary\(cameraScene,/.test(cam) && /setLockedTarget\(null\); useCelestialStore\.getState\(\)\.setCameraScene\(null\);/.test(cam) && /'장면 지우기', 'Clear scene'/.test(cam), '장면 줄(이름 · 요약)과 "장면 지우기"(목표와 장면을 함께)');

console.log('\n[5] 모드 시트 연결');
ok(/onPress=\{\(\) => setModeSheetOpen\(true\)\}/.test(cam) && /<CaptureModeSheet[\s\S]*?recommended=\{cameraScene \? modeForScene\(cameraScene\) : recommendMode\(sunPos\.altitude\)\}[\s\S]*?onPick=\{pickMode\}/.test(cam) && /const tab = tabForMode\(key\);\s+if \(tab\) setCameraTab\(tab\);/.test(cam), '"모드" 단추가 시트를 열고, 권하는 모드와 고른 탭 연결');

console.log('\n[6] 시트');
ok(/sheetRows\(recommended\)/.test(sheet) && /disabled=\{!r\.ready\}/.test(sheet) && /if \(!CAPTURE_MODES\.find\(m => m\.key === k\)\?\.ready\) return;\s+onPick\(k\);/.test(sheet), 'sheetRows 로 줄, 못 여는 모드는 disabled 이고 눌러도 반환(ready 가 아니면)');
ok(/modeLabel\(/.test(sheet) && /modeDesc\(/.test(sheet) && /recommendReason\(/.test(sheet) && /'준비 중', 'Coming soon', '準備中'/.test(sheet), '글은 captureMode 에서, 못 여는 줄에 "준비 중"');

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
