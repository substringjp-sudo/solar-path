/**
 * **월식 이벤트 모드의 연결(소스 검사)** — `SunCamera` · `CaptureModeSheet` · `EclipseCard`. 브라우저 불필요.
 * 계산은 `verify-eclipse-event.js` · `verify-eclipse-plan.js`, 카드 화면은 웹 `verify-eclipse-card.js` 가 판정했다. SunCamera 는 웹 하네스로 못 띄워 연결만 소스로 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21)
 *  1. 켜짐 계산은 10 분 단위 시각과 반올림한 위경도가 바뀔 때만 다시 한다(`useMemo` 안의 `eclipseEventFor`, 의존성에 `currentTime` 이 아니라 시각 묶음 값). 달 위치 탐색이 무거워 프레임마다 돌리면 안 된다. 남은 시간만 매초 `stageAt` 으로 갱신한다.
 *  2. 훅 순서: 새 훅(`useMemo` · `useState` · `useEffect`)은 `if (!visible) return null` 앞에 있다.
 *  3. 모드 줄 목록은 식이 있을 때만 이벤트를 넣는다(아래 4번이 `CAMERA_STRIP_MODES_EVENT = modeList(true)` 로 본다). 모드를 고르면(`pickMode('event')`) 이벤트 켬 + 천체 탭(달 촬영), 다른 모드를 고르면 이벤트 끔. 식이 사라지면(`eclipseBase` 가 null) 이벤트도 끈다.
 *  4. `stripMode` 는 이벤트가 켜졌을 때 'event'(타임랩스 · 천체 · 사진보다 우선하지 않고 타임랩스 열림 > 이벤트 > 천체 > 사진).
 *  5. 카드: 이벤트가 켜져 있고 식이 있으면 `<EclipseCard ...>` 를 상태 줄(`statusCol`) 안에 그린다.
 *  (동치 변이 기록: `CaptureModeSheet` 의 `eventReady` 기본값을 true 로 바꿔도 판정이 못 가린다 — SunCamera 가 늘 값을 넘기므로 동작이 같다. 그래서 기본값은 보지 않는다.)
 *  6. 모드 시트: `CaptureModeSheet` 가 `eventReady` 를 받아 이벤트 줄을 그 값으로 누를 수 있게 한다(식이 없으면 흐린 "준비 중").
 *
 *   node tools/shader-preview/verify-eclipse-wiring.js
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const cam = read('src', 'components', 'SunCamera.tsx');
const sheet = read('src', 'components', 'AstroCamera', 'CaptureModeSheet.tsx');
const early = cam.indexOf('if (!visible) return null');

console.log('[1] 켜짐 계산');
const memo = (cam.match(/const eclipseBase = useMemo\([\s\S]*?\n  \);?/) || [''])[0];
ok(/eclipseEventFor\(/.test(memo) && /\[[^\]]*eclipseBucket[^\]]*\]/.test(memo) && !/\[[^\]]*currentTime[^\]]*\]/.test(memo), 'eclipseBase = useMemo(eclipseEventFor, [시각 묶음 …]) — currentTime 이 의존성이 아니다');
ok(/Math\.floor\(currentTime\.getTime\(\) \/ 600000\)/.test(cam) && /toFixed\(1\)|Math\.round\([^)]*\* ?10\)/.test(cam), '시각 묶음 10 분 · 위경도 반올림');
ok(/stageAt\(eclipseBase\.plan,/.test(cam), '남은 시간은 stageAt 으로 매초 갱신');

console.log('\n[2] 훅 순서');
const idx = (re) => { const m = re.exec(cam); return m ? m.index : -1; };
ok(early > 0 && idx(/const eclipseBase = useMemo/) > 0 && idx(/const eclipseBase = useMemo/) < early && idx(/const \[eclipseOn, setEclipseOn\] = useState/) > 0 && idx(/const \[eclipseOn, setEclipseOn\] = useState/) < early && idx(/setEclipseTick/) > 0 && idx(/setEclipseTick/) < early, '새 훅이 early return 앞');

console.log('\n[3] 모드 고르기');
ok(/if \(key === 'event'\) \{[^}]*setEclipseOn\(true\)[^}]*setCameraTab\('astro'\)[^}]*\}/.test(cam), "이벤트를 고르면 켜고 천체 탭");
ok(/setEclipseOn\(false\)/.test((cam.match(/const pickMode = [\s\S]*?\n  \};/) || [''])[0]), '다른 모드를 고르면 이벤트 끔');
ok(/useEffect\(\(\) => \{ if \(!eclipseBase\) setEclipseOn\(false\); \}, \[eclipseBase\]\)/.test(cam), '식이 사라지면 끔');

console.log('\n[4] 모드 줄 표시');
ok(/stripMode=\{timelapseOpen \? 'timelapse' : eclipseOn \? 'event' : cameraTab === 'astro' \? 'astro' : 'photo'\}/.test(cam) && /stripModes=\{eclipseBase \? CAMERA_STRIP_MODES_EVENT : CAMERA_STRIP_MODES\}/.test(cam) && /CAMERA_STRIP_MODES_EVENT = modeList\(true\)/.test(cam), '타임랩스 > 이벤트 > 천체 > 사진, 이벤트 목록은 식이 있을 때만');

console.log('\n[5] 카드');
ok(/\{eclipseOn && eclipseEvent \? \(\s*<EclipseCard event=\{eclipseEvent\}/.test(cam) && cam.indexOf('<EclipseCard') > cam.indexOf('styles.statusCol'), 'statusCol 안에 EclipseCard');

console.log('\n[6] 모드 시트');
ok(/eventReady/.test(sheet) && /r\.key === 'event' \? eventReady : r\.ready/.test(sheet) && /eventReady=\{eclipseBase != null\}/.test(cam), '시트가 eventReady 로 이벤트 줄을 켠다');

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
