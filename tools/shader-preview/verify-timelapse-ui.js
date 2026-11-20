/**
 * **타임랩스 화면(설정 시트 · 연속 촬영 · 미리보기)의 이음새(소스 검사)** — `TimelapsePanel` · `useTimelapseRun` · `SunCamera`. 브라우저 · 네트워크 불필요.
 * 계산은 `verify-timelapse-plan.js` 가 잰다. 카메라는 실기기에서만 돌아 여기서는 연결이 끊기지 않았는지만 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20)
 *  1. 모드 시트에서 타임랩스를 고르면 타임랩스 시트(`TimelapsePanel`)가 열린다(`pickMode('timelapse')` → `setTimelapseOpen(true)`). 별 일주 · 이벤트는 못 연다(captureMode 가 정한다).
 *  2. 타임랩스 시트: 구간 칩 셋(일몰 · 일출 · 낮에서 밤으로)과 영상 길이 칩 넷(5 · 10 · 20 · 30 초), `planTimelapse` 로 요약 · 저장 공간 · 간격이 짧아 올렸다는 글을 보이고, "미리보기"와 "지금 시작"을 부른다.
 *     영상 만들기가 아직 없다는 글("준비 중")이 시트에 있다(사진 묶음으로 저장한다고 숨기지 않는다).
 *  3. 연속 촬영 훅: 시작 시각 기준으로 다음 장을 잡고(`nextDelayMs`), 한 장마다 `shoot()` 를 부르며, 연속 3 번 실패하면 멈추고 `error`, 마지막 장을 찍으면 끝난다. 마치기(`stop`)는 타이머를 지우고 찍은 사진은 남긴다. 사라질 때 타이머를 지운다.
 *  4. 카메라: 한 장은 `takePictureAsync` 로 찍어 `MediaLibrary.saveToLibraryAsync` 로 저장한다. 시작 전에 사진 저장 권한을 확인하고 없으면 시작하지 않는다. 시작하면 실제 카메라 화면(`setViewMode('camera')`)으로 둔다.
 *  5. 촬영 중 줄: 찍은 장수 / 전체 · 남은 시간(분:초) · "화면을 켜 두세요"(화면이 꺼지지 않게 하는 부품이 없으므로 알린다)와 "마치기". 연속 실패로 멈추면 그렇게 알리고, 끝나면 몇 장이 저장됐는지 알린다.
 *  6. 미리보기: 3D 시뮬레이션(`setViewMode('sim')`)이 `previewTimeAt` 으로 구간을 `onTimeChange` 에 영상 길이만큼 흘리고, 끝나거나 멈추면 원래 시각으로 돌아온다. 줄에 "미리보기 재생 중"과 멈추기 단추.
 *
 *   node tools/shader-preview/verify-timelapse-ui.js
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

const cam = read('src', 'components', 'SunCamera.tsx');
const panel = read('src', 'components', 'AstroCamera', 'TimelapsePanel.tsx');
const hook = read('src', 'hooks', 'useTimelapseRun.ts');

console.log('[1] 모드 시트에서 열기');
ok(/if \(key === 'timelapse'\) \{ setTimelapseOpen\(true\); return; \}/.test(cam) && /<TimelapsePanel[\s\S]*?visible=\{timelapseOpen\}/.test(cam), '타임랩스를 고르면 타임랩스 시트가 열린다');

console.log('\n[2] 타임랩스 시트');
ok(/const PRESETS: readonly PresetKind\[\] = \['sunset', 'sunrise', 'day-to-night'\];/.test(panel) && /VIDEO_SEC_CHOICES = \[5, 10, 20, 30\] as const;/.test(panel), '구간 칩 셋 · 영상 길이 칩 넷');
ok(/planTimelapse\(\{ totalMin, videoSec, fps: 30 \}\)/.test(panel) && /planSummary\(plan, language\)/.test(panel) && /plan\.estimateMB/.test(panel) && /plan\.clamped === 'interval'/.test(panel), 'planTimelapse 로 요약 · 저장 공간 · 간격 올림 안내');
ok(/onPreview\(plan, startMs, endMs\)/.test(panel) && /onStart\(plan\)/.test(panel) && /영상 만들기는 준비 중이에요\./.test(panel), '미리보기 · 지금 시작을 부르고, 영상 만들기는 준비 중이라고 적는다');

console.log('\n[3] 연속 촬영 훅');
ok(/nextDelayMs\(s\.startMs, s\.plan\.intervalS, index, Date\.now\(\)\)/.test(hook) && /ok = await shootRef\.current\(\)/.test(hook), '시작 시각 기준으로 다음 장을 잡고 한 장마다 shoot');
ok(/MAX_CONSECUTIVE_FAILS = 3/.test(hook) && /streak\.current >= MAX_CONSECUTIVE_FAILS\) \{ publish\(\{ \.\.\.next, running: false, error: true \}\)/.test(hook) && /index \+ 1 >= after\.plan\.frames\) \{ publish\(\{ \.\.\.next, running: false \}\)/.test(hook), '연속 3 번 실패하면 멈춤(error), 마지막 장이면 끝');
ok(/const stop = useCallback\(\(\) => \{\s+clear\(\);\s+const s = live\.current;\s+if \(s\) publish\(\{ \.\.\.s, running: false \}\);/.test(hook) && /useEffect\(\(\) => \(\) => \{ clear\(\); \}, \[\]\);/.test(hook), '마치기는 타이머를 지우고 상태만 멈춘다, 사라질 때 타이머를 지운다');

console.log('\n[4] 카메라: 한 장 찍고 저장');
ok(/const photo = await cameraRef\.current\.takePictureAsync\(\{ quality: 0\.6, shutterSound: false \}\);\s+await MediaLibrary\.saveToLibraryAsync\(photo\.uri\);\s+return true;/.test(cam), '찍어서 앨범에 저장하고 true');
ok(/if \(!granted\) \{\s+Alert\.alert\([\s\S]*?return;\s+\}\s+setViewMode\('camera'\);\s+timelapse\.start\(plan\);/.test(cam), '권한이 없으면 시작하지 않고, 있으면 실제 카메라 화면으로 두고 시작');

console.log('\n[5] 촬영 중 줄');
ok(/timelapse\.run\.taken\}\/\$\{timelapse\.run\.plan\.frames\}/.test(cam) && /timelapse\.progress\.remainingS \/ 60/.test(cam) && /'화면을 켜 두세요'/.test(cam) && /onPress=\{timelapse\.run\.running \? timelapse\.stop : timelapse\.dismiss\}/.test(cam), '장수 / 전체 · 남은 분:초 · 화면 안내 · 마치기(끝나면 닫기)');
ok(/timelapse\.run\.error/.test(cam) && /타임랩스가 멈췄어요/.test(cam) && /타임랩스 끝/.test(cam), '연속 실패로 멈춤과 끝남을 알린다');

console.log('\n[6] 미리보기');
ok(/setViewMode\('sim'\);\s+setPreviewing\(true\);/.test(cam) && /onTimeChange\(new Date\(previewTimeAt\(startMs, endMs, plan\.targetVideoSec, elapsed\)\)\);\s+if \(elapsed >= plan\.targetVideoSec\) stopPreview\(\);/.test(cam), '3D 시뮬레이션으로 바꾸고 구간을 영상 길이만큼 흘린다');
ok(/if \(previewOrigin\.current\) \{ onTimeChange\?\.\(previewOrigin\.current\); previewOrigin\.current = null; \}/.test(cam) && /\{previewing && \(/.test(cam) && /'미리보기 멈추기'/.test(cam), '끝나거나 멈추면 원래 시각으로 돌아오고, 줄에 멈추기 단추');

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
