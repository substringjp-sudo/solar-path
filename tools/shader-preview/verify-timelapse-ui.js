/**
 * **타임랩스 화면(설정 시트 · 연속 촬영 · 미리보기)의 이음새(소스 검사)** — `TimelapsePanel` · `useTimelapseRun` · `SunCamera`. 브라우저 · 네트워크 불필요.
 * 계산은 `verify-timelapse-plan.js` 가 잰다. 카메라는 실기기에서만 돌아 여기서는 연결이 끊기지 않았는지만 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20)
 *  1. 모드 시트에서 타임랩스를 고르면 타임랩스 시트(`TimelapsePanel`)가 열린다(`pickMode('timelapse')` → `setTimelapseOpen(true)`). 별 일주 · 이벤트는 못 연다(captureMode 가 정한다).
 *  2. 타임랩스 시트: 종류 칩 셋(일반 · 밝게 합성 · 궤적 누적, 합성이면 2 · 4 · 8장씩 칩)과 종류 설명, 구간 칩 셋(일몰 · 일출 · 낮에서 밤으로)과 영상 길이 칩 넷(5 · 10 · 20 · 30 초), `planTimelapse` 로 값 칸 · 저장 공간 · 간격이 짧아 올렸다는 글을 보이고(2026-11-20 목업 9 에 맞춰 한 줄 요약 `planSummary` 대신 값 칸 네 개로 바꿨다. 요약 · 저장 공간 · 올림 안내를 보인다는 기준은 그대로), "미리보기"와 "지금 시작"을 부른다.
 *     영상 만들기가 아직 없다는 글("준비 중")이 시트에 있다(사진 묶음으로 저장한다고 숨기지 않는다). 합성 · 누적은 어떻게 저장하는지 글로 알린다(밝게 합성: "찍은 원본은 합친 뒤 지워요", 궤적 누적: "마지막 장이 별 일주 사진이에요").
 *     (2026-11-20 정정: 처음에는 "합성은 준비 중이에요" 글을 기준으로 적었다. 실제로 합치는 일이 들어와 이 글은 위의 저장 설명으로 바뀌었고, 감추지 않고 알린다는 기준은 그대로.)
 *  3. 연속 촬영 훅: 시작 시각 기준으로 다음 장을 잡고(`nextDelayMs`), 한 장마다 `shoot()` 를 부르며, 연속 3 번 실패하면 멈추고 `error`, 마지막 장을 찍으면 끝난다. 마치기(`stop`)는 타이머를 지우고 찍은 사진은 남긴다. 사라질 때 타이머를 지운다.
 *  4. 카메라: 한 장은 `takePictureAsync` 로 찍고, `shotPlan` 이 정하는 대로 저장한다(일반 = 그 장을 `MediaLibrary.saveToLibraryAsync`, 합성 · 누적 = `FrameAccumulator` 에 쌓고 `flush` 인 장에서 합친 그림을 저장, `reset` 이면 비움). 쓰고 난 임시 파일은 지운다. 시작 전에 사진 저장 권한을 확인하고 없으면 시작하지 않는다. 시작하면 실제 카메라 화면(`setViewMode('camera')`)으로 둔다.
 *  4b. 합치다 만 묶음: 마치기 · 연속 실패로 끝나면(`onEnd`) 밝게 합성에서 쌓인 장이 있으면 그 묶음을 마저 저장하고 쌓은 그림을 치운다. 훅은 끝났을 때(마지막 장 · 마치기 · 연속 실패) 각각 한 번 `onEnd('done' | 'stopped' | 'error')` 를 부른다.
 *  4c. 합치는 부품(`FrameAccumulator`, Skia): 밝게 합성은 n 번째 장을 투명도 1/n 으로 덮어 누적 평균(첫 장은 1), 궤적 누적은 첫 장 뒤로 밝은 쪽을 남기는 블렌드(`BlendMode.Lighten`)로 겹친다. 합치는 그림의 긴 변은 2048 로 줄이고, 내보내기는 JPEG 92 를 임시 파일(Base64)로 쓰며 못 읽거나 못 쓰면 false · null 을 돌려준다(throw 하지 않는다). 비우면(`reset`) 크기를 다시 정한다.
 *  2b. 목업 9 모양(2026-11-20, 목업을 읽고 맞춤): 머리줄은 "타임랩스" 제목과 부제(구간을 알면 `windowLabel`("16:40 ~ 18:10"), 모르면 "지금부터 N분"). 요약 한 줄 대신 **값 칸 네 개**(간격 · 찍는 장수 · 영상 · 저장 장수)를 모노 글꼴 칸으로 보이고,
 *     그 아래 한 줄 "시작 HH:mm · 촬영 N분 · 종류". 시트는 `tzHours` 를 받는다.
 *  2c. 목업 12 모양(촬영 중): 위쪽 줄이 카드로 — 제목 "타임랩스 · 종류", 부제 "HH:mm 시작 · 지금 HH:mm", 빨간 점 REC, 값 칸(찍은 장수 / 전체 · 남은 시간 · 앨범 저장 수), 오른쪽 "마치기". 끝나거나 멈추면 점과 REC 는 사라지고 결과 글이 보인다.
 *  5. 촬영 중 줄: 찍은 장수 / 전체 · 남은 시간(분:초) · "화면을 켜 두세요"(화면이 꺼지지 않게 하는 부품이 없으므로 알린다)와 "마치기". 연속 실패로 멈추면 그렇게 알리고, 끝나면 몇 장이 저장됐는지 알린다.
 *  6. (2026-11-21: 줄에 `videoClock` 읽음 "0:06 / 0:12" 가 붙는다.) 미리보기: 3D 시뮬레이션(`setViewMode('sim')`)이 `previewTimeAt` 으로 구간을 `onTimeChange` 에 영상 길이만큼 흘리고, 끝나거나 멈추면 원래 시각으로 돌아온다. 줄에 "미리보기 재생 중"과 멈추기 단추.
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
ok(/planTimelapse\(\{ totalMin, videoSec, fps: 30, kind, stackSize \}\)/.test(panel) && /const KINDS: readonly TimelapseKind\[\] = \['plain', 'stacked', 'trail'\];/.test(panel) && /STACK_CHOICES = \[2, 4, 8\] as const;/.test(panel) && /찍은 원본은 합친 뒤 지워요/.test(panel) && /마지막 장이 별 일주 사진이에요/.test(panel) && /const cells = \[/.test(panel) && /plan\.estimateMB/.test(panel) && /plan\.clamped === 'interval'/.test(panel), 'planTimelapse 로 요약 · 저장 공간 · 간격 올림 안내');
ok(/onPreview\(plan, startMs, endMs\)/.test(panel) && /onStart\(plan\)/.test(panel) && /영상 만들기는 준비 중이에요\./.test(panel), '미리보기 · 지금 시작을 부르고, 영상 만들기는 준비 중이라고 적는다');

console.log('\n[3] 연속 촬영 훅');
ok(/nextDelayMs\(s\.startMs, s\.plan\.intervalS, index, Date\.now\(\)\)/.test(hook) && /ok = await shootRef\.current\(index, index \+ 1 >= cur\.plan\.frames\)/.test(hook), '시작 시각 기준으로 다음 장을 잡고 한 장마다 shoot');
ok(/MAX_CONSECUTIVE_FAILS = 3/.test(hook) && /streak\.current >= MAX_CONSECUTIVE_FAILS\) \{ publish\(\{ \.\.\.next, running: false, error: true \}\)/.test(hook) && /index \+ 1 >= after\.plan\.frames\) \{ publish\(\{ \.\.\.next, running: false \}\)/.test(hook), '연속 3 번 실패하면 멈춤(error), 마지막 장이면 끝');
ok(/const stop = useCallback\(\(\) => \{\s+clear\(\);\s+const s = live\.current;\s+if \(s\) \{ publish\(\{ \.\.\.s, running: false \}\); if \(s\.running\) void onEndRef\.current\?\.\('stopped'\); \}/.test(hook) && /useEffect\(\(\) => \(\) => \{ clear\(\); \}, \[\]\);/.test(hook), '마치기는 타이머를 지우고 상태만 멈춘다, 사라질 때 타이머를 지운다');

console.log('\n[4] 카메라: 한 장 찍고 저장');
ok(/const photo = await cameraRef\.current\.takePictureAsync\(\{ quality: 0\.6, shutterSound: false \}\);\s+const \{ kind, stackSize \} = tlKindRef\.current;\s+const p = shotPlan\(kind, stackSize, index, isLast\);\s+let ok = true;\s+if \(p\.saveRaw\) await MediaLibrary\.saveToLibraryAsync\(photo\.uri\);/.test(cam), '찍고 shotPlan 에 따라 그대로 저장');
ok(/if \(p\.accumulate\) \{[\s\S]*?new FrameAccumulator\(kind === 'trail' \? 'lighten' : 'average'\)[\s\S]*?ok = await tlAccRef\.current\.add\(photo\.uri\);\s+if \(ok && p\.flush\) ok = await saveComposite\(\);\s+if \(p\.reset\) tlAccRef\.current\.reset\(\);\s+\}\s+FileSystem\.deleteAsync\(photo\.uri, \{ idempotent: true \}\)/.test(cam), '쌓기(합성 = 평균, 누적 = 밝은 쪽), flush 에서 저장, reset 에서 비움, 원본 임시 파일은 지움');
ok(/if \(!granted\) \{\s+Alert\.alert\([\s\S]*?return;\s+\}\s+setViewMode\('camera'\);\s+tlKindRef\.current = \{ kind: plan\.kind, stackSize: plan\.stackSize \};\s+tlAccRef\.current = null;\s+timelapse\.start\(plan\);/.test(cam), '권한이 없으면 시작하지 않고, 있으면 실제 카메라 화면으로 두고 시작');

ok(/if \(acc && acc\.count > 0 && tlKindRef\.current\.kind === 'stacked'\) await saveComposite\(\)\.catch\(\(\) => false\);\s+tlAccRef\.current = null;/.test(cam) && /useTimelapseRun\(shootFrame, endTimelapse\)/.test(cam), '끝나면 덜 쌓인 합성 묶음을 저장하고 쌓은 그림을 치운다');
ok(/void onEndRef\.current\?\.\('error'\)/.test(hook) && /void onEndRef\.current\?\.\('done'\)/.test(hook) && /void onEndRef\.current\?\.\('stopped'\)/.test(hook), '훅이 끝날 때 done · stopped · error 를 알린다');

const fc = read('src', 'utils', 'frameComposite.ts');
ok(/paint\.setAlphaf\(first \? 1 : 1 \/ \(this\.count \+ 1\)\)/.test(fc) && /else if \(!first\) paint\.setBlendMode\(BlendMode\.Lighten\)/.test(fc), '합성은 투명도 1/n 누적 평균, 누적은 첫 장 뒤로 Lighten');
ok(/MAX_EDGE = 2048/.test(fc) && /Math\.min\(1, MAX_EDGE \/ Math\.max\(img\.width\(\), img\.height\(\)\)\)/.test(fc) && /encodeToBase64\(ImageFormat\.JPEG, 92\)/.test(fc) && (fc.match(/catch \{\s+return (false|null);/g) || []).length === 2 && /reset\(\): void \{\s+this\.surface = null;\s+this\.count = 0;/.test(fc), '긴 변 2048, JPEG 92, 실패는 false · null, reset 은 크기를 다시 정한다');

console.log('\n[2b] 목업 9 모양');
ok(/windowLabel\(win\.startMs, win\.endMs, tzHours\)/.test(panel) && /tzHours: number;/.test(panel) && /'지금부터', 'From now', '今から'/.test(panel), '부제: 구간을 알면 windowLabel, 모르면 "지금부터 N분"');
ok(/CELLS = \[/.test(panel) || /cells\.map\(/.test(panel), '값 칸을 칸 목록으로 그린다');
ok(/'간격', 'Interval', '間隔'/.test(panel) && /'찍는 장', 'Shots', '撮影枚数'/.test(panel) && /'영상', 'Video', '動画'/.test(panel) && /'저장', 'Saved', '保存'/.test(panel) && /clockLabel\(startShown, tzHours\)/.test(panel), '칸 넷(간격 · 찍는 장 · 영상 · 저장)과 "시작 HH:mm" 한 줄');
ok(/tzHours=\{tzHours\}/.test(cam), '카메라가 tzHours 를 넘긴다');

console.log('\n[2c] 목업 12 모양');
ok(/timelapse\.run\.running \? \(\s+<View style=\{styles\.recRow\}><View style=\{styles\.recDot\} \/><Text style=\{styles\.recText\}>REC<\/Text><\/View>\s+\) : null/.test(cam) && /recDot: \{[^}]*backgroundColor: color\.danger/.test(cam), '촬영 중에만 빨간 REC 점(끝나면 사라진다)');
ok(/'시작', 'started', '開始'/.test(cam) && /clockLabel\(timelapse\.run\.startMs, tzHours\)/.test(cam) && /clockLabel\(Date\.now\(\), tzHours\)/.test(cam), '부제 "HH:mm 시작 · 지금 HH:mm"');
ok(/'찍은 장', 'Shots', '撮影'/.test(cam) && /'남은 시간', 'Left', '残り'/.test(cam) && /'앨범', 'Album', 'アルバム'/.test(cam), '값 칸: 찍은 장 · 남은 시간 · 앨범');

console.log('\n[5] 촬영 중 줄');
ok(/timelapse\.run\.taken\}\/\$\{timelapse\.run\.plan\.frames\}/.test(cam) && /timelapse\.progress\.remainingS \/ 60/.test(cam) && /'화면을 켜 두세요'/.test(cam) && /onPress=\{timelapse\.run\.running \? timelapse\.stop : timelapse\.dismiss\}/.test(cam), '장수 / 전체 · 남은 분:초 · 화면 안내 · 마치기(끝나면 닫기)');
ok(/timelapse\.run\.error/.test(cam) && /타임랩스가 멈췄어요/.test(cam) && /타임랩스 끝/.test(cam), '연속 실패로 멈춤과 끝남을 알린다');

console.log('\n[6] 미리보기');
ok(/setViewMode\('sim'\);\s+setPreviewing\(true\);/.test(cam) && /onTimeChange\(new Date\(previewTimeAt\(startMs, endMs, plan\.targetVideoSec, elapsed\)\)\);\s+if \(elapsed >= plan\.targetVideoSec\) stopPreview\(\);/.test(cam), '3D 시뮬레이션으로 바꾸고 구간을 영상 길이만큼 흘린다');
ok(/if \(previewOrigin\.current\) \{ onTimeChange\?\.\(previewOrigin\.current\); previewOrigin\.current = null; \}/.test(cam) && /\{previewing && \(/.test(cam) && /'미리보기 멈추기'/.test(cam), '끝나거나 멈추면 원래 시각으로 돌아오고, 줄에 멈추기 단추');
ok(/setPreviewClock\(videoClock\(0, plan\.targetVideoSec\)\);/.test(cam) && /setPreviewClock\(videoClock\(elapsed, plan\.targetVideoSec\)\);/.test(cam) && /\{`  \$\{previewClock\}`\}<\/Text>/.test(cam), '미리보기 줄에 "0:06 / 0:12" 읽음(시작에 0 으로, 재생 중 지난 초로 갱신, 줄 글 뒤에 붙임; 2026-11-21 추가)');

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
