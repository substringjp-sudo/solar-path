/**
 * **조이스틱 화면이 구동기와 장면에 제대로 이어졌는가** — 앱 소스 정규식 판정(브라우저 · 네트워크 불필요). 연속 이동 조이스틱 3단계(docs/SANDBOX_MODE_PLAN.md 12.2).
 *
 * 계산은 `verify-joystick-motion.js` · `verify-joystick-driver.js` 가, 실제 손가락 · 장면에서의 동작은 `tools/web-repro/verify-joystick-panel.js` 가 잽니다.
 * 이 판정은 그 둘이 보지 못하는 **이음새**(패널이 구동기를 부르는가, 장면 손잡이가 저장소와 어떻게 이어지는가, 예전 걸음 단위 이동이 남아 있지 않은가)를 박습니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다. 조이스틱 시안 "샌드박스 이동 중"과 사용자 승인 사항에서 옮겼습니다)
 *
 *  1. 모드 칩: 패널이 `MOVE_MODES`(걷기 · 자전거 · 차 · 비행 순서)마다 칩을 그리고, 지금 모드의 칩이 켜져 있으며(`active`), 누르면 `onMode(모드)` 를 부른다. 글자는 걷기 · 자전거 · 차 · 비행(영어 Walk · Bike · Car · Fly, 일본어 徒歩 · 自転車 · 車 · 飛行),
 *     스크린리더 글에는 모드 이름 · 최고 속도 · 쓰임이 들어간다. 모듈의 `MOVE_MODES` 는 정확히 walk · bike · car · fly 순서다.
 *  2. 안내 글: 칩 아래에 "끝까지 밀면 N m/s"(N = 지금 모드의 최고 속도 `MODE_MAX_SPEED_MPS[mode]`; 영어 · 일본어 포함)가 있다.
 *  3. 지금 속도: 구동기가 내보내는 속도를 `formatSpeed` 로 적고("지금 속도" 글머리), 스크린리더 글에도 같은 값이 들어간다. 움직이는 동안에는 강조 색.
 *  4. 구동기 연결: 패널이 `useJoystickDriver` 를 모드 · 기준(`ref`) · 시선 방위와 함께 부르고, 손잡이의 `onStick` · `onNudge` 에 구동기의 `onStick` · `nudge` 를 넘긴다.
 *     "내 위치로" 단추는 **구동기를 먼저 접고**(`driver.cancel()`) 위치를 바꾼다. 장면의 눈 · 저장은 `drive`(`getOrigin` · `setEye` · `clearEye` · `commit`, 그리고 손잡이를 새로 쥘 때 부르는 선택 항목 `onGrab`)로만 닿는다.
 *     (2026-11-20 정정: "여기로 가기" 가 들어오며 `onGrab` 이 붙었다. 쥐는 순간 가던 걸음을 그 자리에서 끝내 옛 자리로 튀지 않게 하려는 것이라, 이름 목록만 넓히고 "drive 로만 닿는다"는 기준은 그대로.)
 *  5. 예전 걸음 단위 이동이 남지 않는다: 예전 조이스틱에만 있던 이름(`MOVE_STEP_CHOICES_M` · `stepMove` · `stickIntervalMs` · `rotateByView` · `moveStepM`)이 앱 소스(`src/`) 전체와 하네스(`tools/web-repro/App.tsx`)에 없고
 *     (`joystickMotion.ts` 의 "옛 조이스틱은 … `sandboxDials.stepMove`" 같은 옛 동작을 설명하는 머리글만 뺀다), 흔한 이름(`stepM` · `onStep` · `onMove`)은 조이스틱 파일(패널 · 하늘 화면 · 손잡이 · 하네스)에 없다.
 *     (처음에는 흔한 이름까지 `src/` 전체를 단어로 훑었다가 무관한 것 — 세로 막대와 시간 막대의 `onStep`, 구름 · 봉우리 계산의 `stepM` — 이 걸려 거짓으로 실패했습니다. 기준의 뜻은 "예전 조이스틱의 걸음 단위가 남지 않는다"였으므로 위처럼 범위를 좁혔습니다.)
 *  6. 움직이는 동안에는 건물 받기 막대를 숨기고(그동안은 받지 않으므로), 멈춘 뒤에만 보인다. 막대는 장면이 알려 주는 진행(`getLoad`)을 읽고 `loadBar` 로 글을 만든다.
 *  7. "내 위치 아님" 거리는 움직이는 동안 눈의 자리에서 실시간으로(`distanceM(home, eye)`), 멈춘 뒤에는 저장된 위치 기준(`awayM`)이다.
 *  8. 하늘 화면(`SkyScreen`): 모드의 처음 값은 걷기. `drive` 의 `getOrigin` 은 **저장소에서 바로** 저장된 위치를 읽고(방금 확정한 값이 오도록), `setEye` 는 장면의 `setEyeLocation`, `clearEye` 는 `clearEyeLocation`,
 *     `commit` 은 위치를 저장하는 `setSpot`(= `setLocation` 의 좌표 + 시각 도장)이다. `getLoad` 는 장면의 `getBuildingProgress`, `home` 은 기기 위치. "내 위치로"는 움직이던 눈을 먼저 그 자리로 옮긴 다음 위치를 바꾼다
 *     (옛 자리로 번쩍 되돌아가지 않게).
 *  9. 훅(`useJoystickDriver`): 프레임 순환(`requestAnimationFrame`)에서 `advance` 를 부르고, `step.eye` 가 있으면 `setEye`, `done === 'commit'` 이면 `commit`, `'cancel'` 이면 `clearEye` 를 부르며, 읽음 갱신은 `readoutDue` 로 거른다.
 *     움직이는 동안(`step.moving`)에만 다음 프레임을 부르고, 사라질 때 아직 움직이는 중이면 그 자리를 확정한다.
 * 10. 장면(`SkyScene3D`): 핸들에 `getBuildingProgress` 가 있고, 건물을 받기 시작할 때 loading, 끝나면 · 캐시를 쓰면 · 레이어를 끄면 idle, 실패하면 retry 로 둔다. `fetchNearbyBuildings` 에 `onProgress` 를 넘긴다.
 *     `buildingTiles` 는 타일 하나가 끝날 때마다(성공이든 실패든) 끝난 수와 전체를 알리고, 예비 경로(Overpass)로 넘어가면 전체를 모른다고(`total: 0`) 알린다.
 * 11. 손잡이(`MoveStick`): 타이머가 없다(걸음 반복 제거). 쥐고 움직일 때마다 `onStick(stickState(...))`, 놓으면 꺼진 상태, 쥔 채로 사라져도 놓은 것으로 알린다. 스크린리더 동작은 `onNudge` 를 부른다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-joystick-ui.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW, REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

(async () => {
  const J = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'joystickMotion.js'));
  const panel = read('src', 'components', 'SkyScreen', 'SandboxPanel.tsx');
  const dials = read('src', 'components', 'SkyScreen', 'SandboxDials.tsx');
  const sky = read('src', 'components', 'SkyScreen', 'SkyScreen.tsx');
  const hook = read('src', 'hooks', 'useJoystickDriver.ts');
  const scene = read('src', 'components', 'SkyScene3D', 'SkyScene3D.tsx');
  const tiles = read('src', 'utils', 'buildingTiles.ts');
  const harness = read('tools', 'web-repro', 'App.tsx');

  console.log('\n[1] 모드 칩');
  ok(JSON.stringify(J.MOVE_MODES) === JSON.stringify(['walk', 'bike', 'car', 'fly']), 'MOVE_MODES = walk · bike · car · fly (이 순서)');
  ok(/\{MOVE_MODES\.map\(m => \(/.test(panel) && /active=\{m === mode\}/.test(panel) && /onPress=\{\(\) => onMode\(m\)\}/.test(panel), '패널이 MOVE_MODES 마다 칩을 그리고, 지금 모드가 켜져 있고, 누르면 onMode(모드)');
  const names = ['걷기', '자전거', '차', '비행', 'Walk', 'Bike', 'Car', 'Fly', '徒歩', '自転車', '車', '飛行'];
  const modeText = (panel.match(/const MODE_TEXT[\s\S]*?\n\};/) || [''])[0];
  ok(names.every(n => modeText.includes(`'${n}'`)), '글자: 걷기 · 자전거 · 차 · 비행 / Walk · Bike · Car · Fly / 徒歩 · 自転車 · 車 · 飛行');
  ok(/accessibilityLabel=\{`\$\{modeName\(m, language\)\}, \$\{L3\(language, '최고', 'max', '最高'\)\} \$\{MODE_MAX_SPEED_MPS\[m\]\} m\/s, \$\{modeUse\(m, language\)\}`\}/.test(panel), '스크린리더 글: 이름 · 최고 속도 · 쓰임');

  console.log('\n[2] 안내 글');
  ok(/끝까지 밀면 \$\{MODE_MAX_SPEED_MPS\[mode\]\} m\/s/.test(panel) && /Full push = \$\{MODE_MAX_SPEED_MPS\[mode\]\} m\/s/.test(panel) && /いっぱいに倒すと \$\{MODE_MAX_SPEED_MPS\[mode\]\} m\/s/.test(panel), '"끝까지 밀면 N m/s" (N = 지금 모드의 최고 속도, 영어 · 일본어도)');

  console.log('\n[3] 지금 속도');
  ok(/const \{ moving, speed, eye \} = driver\.readout;/.test(panel) && /\{formatSpeed\(speed\)\}<\/Text>/.test(panel) && /'지금 속도'/.test(panel), '구동기의 속도를 formatSpeed 로 적고 "지금 속도" 글머리를 단다');
  ok(/accessibilityLabel=\{`\$\{L3\(language, '지금 속도', 'Current speed', '現在の速度'\)\} \$\{formatSpeed\(speed\)\}`\}/.test(panel) && /moving && \{ color: DARK\.accent \}/.test(panel), '스크린리더 글에 같은 값, 움직이는 동안 강조 색');

  console.log('\n[4] 구동기 연결');
  ok(/useJoystickDriver\(\{ \.\.\.drive, mode, ref, getHeading: \(\) => getView\?\.\(\)\?\.az \?\? null \}\)/.test(panel), '패널이 useJoystickDriver 를 drive · 모드 · 기준 · 시선 방위와 함께 부른다');
  ok(/<MoveStick[^>]*onStick=\{driver\.onStick\}[^>]*onNudge=\{driver\.nudge\}/.test(panel), '손잡이의 onStick · onNudge 에 구동기의 onStick · nudge 를 넘긴다');
  ok(/onPress=\{\(\) => \{ driver\.cancel\(\); onHome\(\); \}\}/.test(panel), '"내 위치로" 는 구동기를 먼저 접고 위치를 바꾼다');
  ok(/drive: Pick<DriverHost, 'getOrigin' \| 'setEye' \| 'clearEye' \| 'commit' \| 'onGrab'>;/.test(panel), '장면 · 저장소에는 drive(getOrigin · setEye · clearEye · commit · onGrab)로만 닿는다');

  console.log('\n[5] 예전 걸음 단위 이동이 남지 않는다');
  const uniq = /MOVE_STEP_CHOICES_M|\bstepMove\b|stickIntervalMs|rotateByView|moveStepM/;
  const common = /\bstepM\b|\bonStep\b|\bonMove\b/;
  const files = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else if (/\.(tsx?|js)$/.test(n.name)) files.push(f); } };
  walk(path.join(REPO_ROOT, 'src'));
  const uniqHits = files.filter(f => !f.endsWith(path.join('utils', 'joystickMotion.ts')) && uniq.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(REPO_ROOT, f));
  const stickBlock = (dials.match(/export const MoveStick[\s\S]*?\n\};/) || [''])[0];
  const commonHits = [['SandboxPanel.tsx', panel], ['SkyScreen.tsx', sky], ['MoveStick(SandboxDials.tsx)', stickBlock], ['tools/web-repro/App.tsx', harness], ['useJoystickDriver.ts', hook]].filter(([, t]) => common.test(t)).map(([n]) => n);
  ok(uniqHits.length === 0 && !uniq.test(harness), `예전 조이스틱에만 있던 이름이 src/ 전체와 하네스에 없다${uniqHits.length ? ' — 남은 곳: ' + uniqHits.join(', ') : ''}`);
  ok(commonHits.length === 0, `흔한 이름(stepM · onStep · onMove)이 조이스틱 파일에 없다${commonHits.length ? ' — 남은 곳: ' + commonHits.join(', ') : ''}`);

  console.log('\n[6] 건물 받기 막대');
  ok(/\{getLoad && !moving && <LoadBarView language=\{language\} getLoad=\{getLoad\} \/>\}/.test(panel), '움직이는 동안에는 숨기고 멈춘 뒤에만 보인다');
  ok(/const b = loadBar\(get\.current\(\), language\);/.test(panel) && /setInterval\(tick, 250\)/.test(panel), '장면의 진행(getLoad)을 4 번/초 읽어 loadBar 로 글을 만든다');

  console.log('\n[7] 내 위치 아님 거리');
  ok(/const away = home && eye \? distanceM\(home, eye\) : awayM;/.test(panel), '움직이는 동안 눈의 자리에서 실시간, 멈춘 뒤 저장된 위치 기준');

  console.log('\n[8] 하늘 화면');
  ok(/useState<MoveMode>\('walk'\)/.test(sky) && /mode=\{moveMode\}/.test(sky) && /onMode=\{changeMoveMode\}/.test(sky) && /setMoveMode\(m\);/.test(sky), '모드의 처음 값은 걷기, 모드 바꾸기는 changeMoveMode 를 거쳐 setMoveMode 로 간다');
  ok(/eyeForMode\(moveMode, m, eyeH, flyStashRef\.current\)/.test(sky) && /if \(r\.eyeH !== eyeH\) setEyeH\(r\.eyeH\);/.test(sky), '모드를 바꿀 때 eyeForMode 로 눈 높이를 고친다(비행 100 m, 돌아오면 되돌림)');
  ok(/useGlide\(\{/.test(sky) && /onGrab: glide\.finish/.test(sky) && /glide\.cancel\(\);\n\s+sceneRef\.current\?\.setEyeLocation\?\.\(homeCoords/.test(sky), '여기로 가기: 조이스틱을 쥘 때 그 자리에서 끝내고, 내 위치로 가기 전에 접는다');
  ok(/onGo=\{\(\) => \{\s+const pt = targetPointOf\(picked\);\s+if \(pt\) glide\.start\(\{ latitude: pt\.latitude, longitude: pt\.longitude \}\);/.test(sky) && /<Text style=\{styles\.actionText\}>\{L3\(language, '여기로 가기', 'Go here', 'ここへ行く'\)\}/.test(read('src', 'components', 'SkyScreen', 'ObjectInfoPanel.tsx')), '고른 점의 위경도로 glide.start, 단추 글자 "여기로 가기"');
  ok(/getOrigin: \(\) => \{\s*const c = useCelestialStore\.getState\(\)\.location\?\.coords \?\? \{ latitude, longitude \};/.test(sky), 'getOrigin 은 저장소에서 바로 저장된 위치를 읽는다');
  ok(/setEye: \(p\) => sceneRef\.current\?\.setEyeLocation\?\.\(p\.latitude, p\.longitude\)/.test(sky) && /clearEye: \(\) => sceneRef\.current\?\.clearEyeLocation\?\.\(\)/.test(sky) && /commit: setSpot/.test(sky), 'setEye → setEyeLocation, clearEye → clearEyeLocation, commit → setSpot');
  ok(/const setSpot = \(p: \{ latitude: number; longitude: number \}\) => \{\s*useCelestialStore\.getState\(\)\.setLocation\(\{\s*coords: \{ latitude: p\.latitude, longitude: p\.longitude, altitude: 0, accuracy: 0, altitudeAccuracy: 0, heading: 0, speed: 0 \},\s*timestamp: Date\.now\(\),/.test(sky), 'setSpot = setLocation(좌표 + 시각 도장)');
  ok(/getLoad=\{\(\) => sceneRef\.current\?\.getBuildingProgress\?\.\(\) \?\? null\}/.test(sky) && /home=\{homeCoords\}/.test(sky), 'getLoad → getBuildingProgress, home = 기기 위치');
  ok(/onHome=\{\(\) => \{\s*if \(!homeCoords\) return;[\s\S]*?sceneRef\.current\?\.setEyeLocation\?\.\(homeCoords\.latitude, homeCoords\.longitude\);\s*setSpot\(homeCoords\);/.test(sky), '"내 위치로" 는 눈을 먼저 그 자리로 옮긴 다음 위치를 바꾼다');

  console.log('\n[9] 훅');
  ok(/const raf = \(cb: \(\) => void\): number => \(typeof requestAnimationFrame === 'function'/.test(hook) && /timer\.current = raf\(\(\) => frame\.current\(\)\)/.test(hook), '프레임 순환은 requestAnimationFrame');
  ok(/const step = advance\(state\.current, dt, \{ stick: stick\.current, mode: h\.mode, ref: h\.ref, headingDeg: h\.getHeading\(\) \}, h\.getOrigin\(\)\);/.test(hook), '프레임마다 advance(상태, dt, 입력, 저장된 위치)');
  ok(/if \(step\.eye\) h\.setEye\(step\.eye\);/.test(hook) && /if \(step\.done === 'commit' && step\.commit\) h\.commit\(step\.commit\);/.test(hook) && /else if \(step\.done === 'cancel'\) h\.clearEye\(\);/.test(hook), '눈 → setEye, 확정 → commit, 접힘 → clearEye');
  ok(/if \(readoutDue\(lastPub\.current, t, force\)\)/.test(hook) && /const force = step\.moving !== wasMoving\.current;/.test(hook), '읽음 갱신은 readoutDue 로 거르고 시작 · 끝에서는 강제');
  ok(/if \(step\.moving\) schedule\(\);/.test(hook) && /if \(e\) hostRef\.current\.commit\(e\);/.test(hook), '움직이는 동안에만 다음 프레임을 부르고, 사라질 때 움직이는 중이면 확정');

  console.log('\n[10] 장면');
  ok(/getBuildingProgress\?: \(\) => LoadProgress;/.test(scene) && /getBuildingProgress: \(\): LoadProgress => \(\{ \.\.\.buildingProgressRef\.current \}\)/.test(scene), '핸들에 getBuildingProgress');
  const eff = (scene.match(/const bldEnabled = Boolean\(layers\.buildings\);[\s\S]*?\}, \[bldLat, bldLng, bldEnabled,/) || [''])[0];
  ok(/buildingProgressRef\.current = \{ phase: 'loading', done: 0, total: 0 \};\s*fetchNearbyBuildings/.test(eff), '받기 시작할 때 loading');
  ok((eff.match(/buildingProgressRef\.current = \{ phase: 'idle', done: 0, total: 0 \}/g) || []).length === 3, '끝나면 · 캐시를 쓰면 · 레이어를 끄면 idle (세 곳)');
  ok(/buildingProgressRef\.current = \{ phase: 'retry', done: 0, total: 0 \};/.test(eff), '실패하면 retry');
  ok(/onProgress: \(p\) => \{ if \(!controller\.signal\.aborted\) buildingProgressRef\.current = \{ phase: 'loading', done: p\.done, total: p\.total \}; \}/.test(eff), 'onProgress 로 loading 진행을 갱신(중단된 요청은 무시)');
  const mvt = (tiles.match(/async function fetchBuildingsFromMvt[\s\S]*?const okTiles/) || [''])[0];
  ok(/onProgress\?\.\(\{ done, total: tiles\.length \}\);\s*const results/.test(mvt) && /\} finally \{\s*done \+= 1;\s*onProgress\?\.\(\{ done, total: tiles\.length \}\);/.test(mvt), '처음에 전체 수를, 타일 하나가 끝날 때마다(성공이든 실패든) 끝난 수를 알린다');
  ok(/opts\.onProgress\?\.\(\{ done: 0, total: 0 \}\);/.test(tiles) && /fetchBuildingsFromMvt\(lat, lon, radiusM, ctl\.signal, opts\.onProgress\)/.test(tiles), '예비 경로로 넘어가면 전체를 모른다고(total 0) 알린다');

  console.log('\n[11] 손잡이');
  const stick = (dials.match(/export const MoveStick[\s\S]*?\n\};/) || [''])[0];
  ok(!/setTimeout|setInterval/.test(stick), '타이머가 없다(걸음 반복 제거)');
  ok(/cb\.current\.onStick\(stickState\(dx, dy, TRAVEL\)\)/.test(stick) && /cb\.current\.onStick\(OFF\)/.test(stick) && /useEffect\(\(\) => \(\) => \{ if \(held\.current\) cb\.current\.onStick\(OFF\); \}, \[\]\);/.test(stick), '쥐고 움직일 때마다 상태를 알리고, 놓으면 꺼진 상태, 쥔 채로 사라져도 놓은 것으로 알린다');
  ok(/if \(d\) cb\.current\.onNudge\(\{ east: d\.e, north: d\.n \}\);/.test(stick), '스크린리더 동작은 onNudge');

  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { fail++; console.log('  FAIL: 예외 — ' + (e && e.message)); console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); });
