/**
 * **"이 장면 찍기"와 촬영 모드 시트의 이음새(소스 검사)** — 샌드박스 → 카메라 넘김과 카메라의 모드 시트 연결. 브라우저 · 네트워크 불필요.
 * 계산은 `verify-capture-mode.js` 가 잰다. 여기서는 연결이 끊기지 않았는지만 소스에서 본다(카메라는 실기기에서만 돈다).
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20)
 *  1. 저장소: `cameraScene`(처음 null)과 `setCameraScene` 이 있고, **저장하지 않는다**(`partialize` 에 `cameraScene` 이 없다).
 *  2. 하늘 화면: `shootScene` 이 지금 장면을 `readScene('')` 로 읽어(못 읽으면 아무것도 안 함) 저장소 `setCameraScene` 에 넣고 `onCameraPress` 를 부른다. 장면 줄(`SceneBar`)을 그리는 두 곳 모두 `onShoot={shootScene}` 을 건다.
 *  3. 장면 줄: `onShoot` 은 선택 항목이고, 있을 때만 "이 장면 찍기" 단추(영어 "Shoot", 일본어 "撮る")를 그린다.
 *  4. 카메라: 보이는 동안 넘어온 장면이 있으면 장면의 방위 · 앙각으로 방향 안내 목표(`lockedTarget`)를 잡고 `tabForMode(modeForScene(장면))` 으로 탭을 연다. (2026-11-21 추가: 새 화면 틀 스위치 `uiFrameV2` 가 켜져 있으면 시각과 상관없이 `tabForMode('normal')`, 곧 사진 탭에서 시작한다 — 사용자 결정 "시뮬레이션 · 샌드박스 · 촬영 모드로 들어가면 먼저 일반 사진 모드, 보던 방향이 가이드". 꺼져 있으면 지금처럼 시각에 맞는 모드.)
 *     같은 날 SceneBar 는 새 틀의 "장면" 칸에도 써서 세 곳이 되었다. 카메라가 사라질 때 장면을 지운다.
 *     위쪽 줄에 장면 이름과 요약이 보이고 "장면 지우기" 단추가 목표와 장면을 함께 지운다.
 *  5. 모드 시트: 탭 묶음 끝 "모드" 단추가 시트를 열고, 권하는 모드는 장면이 있으면 `modeForScene(장면)` 없으면 `recommendMode(해 고도)`. 고르면 `pickMode` 가 탭(`setCameraTab`) 또는 타임랩스 패널을 연다.
 *     (2026-11-20 정정: 타임랩스가 들어오며 시트는 탭이 아니라 모드 키를 돌려준다. 열 수 있는 모드만 고르게 하는 기준은 그대로.)
 *  6. 시트: `sheetRows` 로 줄을 만들고, 못 여는 모드(탭이 null)는 `disabled` 이며 누르면 아무 일도 없다(`tabForMode` 가 null 이면 반환). 글은 `captureMode` 의 `modeLabel` · `modeDesc` · `recommendReason` 만 쓴다.
 *  7. 목업 16 모양(2026-11-20, 목업을 읽고 맞춤, 구현보다 먼저 박음): 시트 맨 위에 손잡이 막대(너비 40 · 높이 4), 머리줄은 "촬영 모드"와 오른쪽 "지금 HH:mm"(`nowLabel`),
 *     "지금 권하는 것" 카드는 `accentSoft` 바탕에 `accentLine` 테두리로 이름 · 결과물 설명 · 이유 한 줄, 모드 줄은 아이콘 칸(28)과 이름 · 설명, 오른쪽 `modeResultTag` 글, 맨 아래에 "샌드박스에서 이 장면 찍기로 오면 그 장면에 맞는 모드가 먼저 열려요." 한 줄.
 *     카메라는 `nowLabel` 로 `clockLabel(currentTime, 시간대)` 를 넘긴다.
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
ok((sky.match(/onShoot=\{shootScene\}/g) || []).length === 1 && (sky.match(/<SceneBar /g) || []).length === 1, 'SceneBar 는 새 틀의 "장면" 칸 한 곳만 남고 onShoot 을 건다(2026-11-21: 옛 화면의 정보 패널 · 따로 뜬 줄 두 곳은 옛 UI 와 함께 지움)');

console.log('\n[3] 장면 줄');
ok(/onShoot\?: \(\) => void;/.test(bar) && /\{onShoot && \(/.test(bar) && /L3\(language, '이 장면 찍기', 'Shoot', '撮る'\)/.test(bar), 'onShoot 선택 항목, 있을 때만 "이 장면 찍기" 단추');

console.log('\n[5] 카메라 안 모드 줄(새 화면 틀, 2026-11-21)');
ok(/<ModeStrip\s+mode=\{timelapseOpen \? 'timelapse' : cameraTab === 'astro' \? 'astro' : 'photo'\}\s+modes=\{CAMERA_STRIP_MODES\}/.test(cam) && !/uiFrameV2/.test(cam), '모드 줄은 늘 보이고(스위치는 2026-11-21 에 없앰), 지금 모드는 타임랩스 · 천체 · 사진');
ok(/if \(m === 'simulation' \|\| m === 'sandbox'\) \{ useCelestialStore\.getState\(\)\.setExpertMode\(m === 'sandbox'\); onClose\(\); return; \}\s+const key = captureKeyFor\(m\);\s+if \(key\) pickMode\(key\);/.test(cam), '하늘 쪽을 고르면 전문가 모드를 맞추고 카메라를 닫고, 카메라 쪽은 기존 pickMode 로');
ok(/const CAMERA_STRIP_MODES = modeList\(false\);/.test(cam) && /: L3\(language, '사진 ▾', 'Photo ▾', '写真 ▾'\)/.test(cam) && !/노을 ▾/.test(cam), '이벤트 없는 모드 목록, 위 알약은 "노을" 대신 "사진"');

console.log('\n[4] 카메라');
ok(/useEffect\(\(\) => \{\s+if \(!visible \|\| !cameraScene\) return;\s+setLockedTarget\(\{ azDeg: cameraScene\.azDeg, elDeg: cameraScene\.elDeg \}\);\s+(?:\/\/[^\n]*\n\s+)?const tab = tabForMode\('normal'\);\s+if \(tab\) setCameraTab\(tab\);\s+\}, \[visible, cameraScene\]\);/.test(cam), '장면의 방위 · 앙각으로 목표를 잡고 사진(일반) 탭에서 시작한다(시각과 상관없이; 2026-11-21 에 옛 분기를 지움)');
ok(/useEffect\(\(\) => \(\) => \{ useCelestialStore\.getState\(\)\.setCameraScene\(null\); \}, \[\]\);/.test(cam), '카메라가 사라질 때 장면을 지운다');
ok(/\{cameraScene && \(/.test(cam) && /cameraScene\.name/.test(cam) && /sceneSummary\(cameraScene,/.test(cam) && /setLockedTarget\(null\); useCelestialStore\.getState\(\)\.setCameraScene\(null\);/.test(cam) && /'장면 지우기', 'Clear scene'/.test(cam), '장면 줄(이름 · 요약)과 "장면 지우기"(목표와 장면을 함께)');

console.log('\n[5] 모드 시트 연결');
ok(/onPress=\{\(\) => setModeSheetOpen\(true\)\}/.test(cam) && /<CaptureModeSheet[\s\S]*?recommended=\{cameraScene \? modeForScene\(cameraScene\) : recommendMode\(sunPos\.altitude\)\}[\s\S]*?onPick=\{pickMode\}/.test(cam) && /const tab = tabForMode\(key\);\s+if \(tab\) setCameraTab\(tab\);/.test(cam), '"모드" 단추가 시트를 열고, 권하는 모드와 고른 탭 연결');

console.log('\n[6] 시트');
ok(/sheetRows\(recommended\)/.test(sheet) && /disabled=\{!r\.ready\}/.test(sheet) && /if \(!CAPTURE_MODES\.find\(m => m\.key === k\)\?\.ready\) return;\s+onPick\(k\);/.test(sheet), 'sheetRows 로 줄, 못 여는 모드는 disabled 이고 눌러도 반환(ready 가 아니면)');
ok(/modeLabel\(/.test(sheet) && /modeDesc\(/.test(sheet) && /recommendReason\(/.test(sheet) && /'준비 중', 'Coming soon', '準備中'/.test(sheet), '글은 captureMode 에서, 못 여는 줄에 "준비 중"');

console.log('\n[7] 목업 16 모양');
ok(/width: 40, height: 4/.test(sheet) && /styles\.handle/.test(sheet) && /nowLabel/.test(sheet) && /L3\(language, '지금', 'Now', '今'\)/.test(sheet), '손잡이 막대와 머리줄의 "지금 HH:mm"');
ok(/recCard: \{[^}]*backgroundColor: DARK\.accentSoft[^}]*borderColor: DARK\.accentLine/.test(sheet) && /recommendReason\(recommended, language\)/.test(sheet), '권하는 카드: accentSoft 바탕 · accentLine 테두리 · 이유 한 줄');
ok(/modeResultTag\(r\.key, language\)/.test(sheet) && /ICONS: Record<CaptureModeKey,/.test(sheet) && /샌드박스에서 이 장면 찍기로 오면 그 장면에 맞는 모드가 먼저 열려요\./.test(sheet), '줄: 아이콘 · 결과물 글, 맨 아래 안내');
ok(/nowLabel=\{clockLabel\(currentTime\.getTime\(\), tzHours\)\}/.test(cam), '카메라가 nowLabel 을 넘긴다');

console.log('\n[8] 노출 추천 칸 · 자동 시작(2026-11-21)');
{
  const cells = read('src', 'components', 'AstroCamera', 'ExposureCells.tsx');
  const hookAt = cam.indexOf('const [autoStartAt, setAutoStartAt]');
  const earlyAt = cam.indexOf('if (!visible) return null;');
  ok(hookAt > 0 && earlyAt > 0 && hookAt < earlyAt, '자동 시작 훅은 `if (!visible) return null` 앞에 있다(훅 순서)');
  ok(/if \(autoStartAt != null && autoStartDue\(autoStartAt, autoNowMs\)\) \{\s+setAutoStartAt\(null\);\s+handleCaptureRef\.current\(\);/.test(cam), '예약 시각이 되면 예약을 지우고 한 장 찍는다');
  ok(/if \(!visible \|\| !cameraScene \|\| cameraTab !== 'sunset'\) return undefined;/.test(cam) && /setAutoStartAt\(null\);\s+\}, \[visible, cameraScene, cameraTab\]\)/.test(cam), '1초 시계는 사진 탭에서 장면이 있을 때만, 그 밖이면 예약을 지운다');
  ok(/autoState\.kind === 'wait'\) setAutoStartAt\(autoStartAt == null \? cameraScene\.timeMs : null\);\s+else handleCapturePress\(\);/.test(cam) && /autoState\.kind !== 'far'/.test(cam), '장면 줄: 기다릴 때는 자동 시작 켜고 끄기, 지났으면 지금 시작, 2시간 넘으면 단추 없음');
  ok(/<ExposureCells language=\{language\} advice=\{expoAdvice\} lensMm=\{lensInfoText\.mmText\} lensText=\{lensInfoText\.lensText\} \/>/.test(cam) && /\{cameraTab === 'sunset' && \(\s+<ExposureCells/.test(cam), '사진 탭에서만 추천 칸(렌즈 · ISO · 셔터 · WB)');
  ok(/adviseExposure\(sunPos\.altitude\)/.test(cam) && /lensLine\(optics\.vFovDeg, W \/ Math\.max\(1, stageLayoutH\)\)/.test(cam), '해 고도로 노출 추천, 화각과 화면 비율로 렌즈 줄');
  ok(/wbLabel\(advice\.wb, language\)/.test(cells) && /추천 · 맑은 하늘 기준 어림/.test(cells) && /삼각대 권장/.test(cells), '칸 글: WB 이름, "추천 · 맑은 하늘 기준 어림", 삼각대 권장 알림');
}

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
