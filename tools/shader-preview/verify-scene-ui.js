/**
 * **장면 저장이 저장소 · 하늘 화면 · 시트에 제대로 이어졌는가** — 앱 소스 정규식 판정(브라우저 · 네트워크 불필요). 장면 저장(docs/SANDBOX_MODE_PLAN.md 12.3).
 *
 * 계산은 `verify-saved-scenes.js`, 화면이 그 계산을 보여 주고 누른 대로 움직이는 것은 `tools/web-repro/verify-scene-sheet.js` 가 잽니다.
 * 이 판정은 그 둘이 보지 못하는 **이음새**(저장소가 목록을 저장하고 읽을 때 정리하는가, 하늘 화면이 지금 장면을 제대로 읽고 열 때 순서대로 맞추는가, 줄 · 시트가 제자리에 붙었는가)를 박습니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다. 계획 문서 12.3 과 목업 2번 · 20번에서 옮겼습니다)
 *
 *  1. 저장소: `savedScenes`(처음 빈 목록)가 상태에 있고 **저장 목록(partialize)에 들어간다**(이 기기에만, 앱을 껐다 켜도 남는다). 장면 · 줄 · 지우기 · 이름 바꾸기는 순수 로직(`addScene` · `renameScene` ·
 *     `removeScene`)으로 하고 가득 차거나 같은 id 면 저장소를 바꾸지 않은 채 이유를 돌려준다. 읽어 들일 때 `sanitizeScenes` 로 정리하는 병합(merge)이 있고 나머지는 기본 병합(`...current, ...persisted`)과 같다.
 *  2. 저장하는 것은 정확히 이름 · 자리 · 눈 높이 · 방향(방위와 앙각) · 줌 · 시각 · 고른 대상(+ id · 저장 시각)이다. **날씨는 저장하지 않는다**(키에 weather · forecast · cloud 가 없다).
 *  3. 하늘 화면이 지금 장면을 읽는 길(`readScene`): 시선은 장면의 `getRenderState().view` 의 방위 · 앙각, 자리는 눈이 움직이는 중이면 `getEyeState().eye` 아니면 저장된 위치, 눈 높이는 `eyeH`, 줌은 `teleX`,
 *     시각은 `currentTime`, 고른 대상은 `targetFromPicked(picked)`. 시선을 못 읽으면(장면이 안 올라옴) 저장하지 않는다(`'unavailable'`). 저장 결과는 저장함 · 가득 참(`'full'`) · 읽지 못함 셋이다.
 *  4. 열기(`openScene`)는 이 순서로 한 번에 맞춘다: 시트 닫기 · 대기 중이던 대상 접기 · 고른 대상 지우기 → 눈 높이 · 줌 · 시각 · 자리(`setSpot`) → 시선(`setCameraView(방위, 앙각)` — 화각은 줌이 정하므로 넘기지 않는다) →
 *     고른 대상이 있었으면 새 자리의 지형이 오는 대로(0.5 초마다, 최대 120 번 = 1 분) `targetFromLatLon` 으로 점을 구해 `rebuildPicked` 로 다시 만든다. 대상을 새로 고르거나 지우면 되살리던 대상은 접는다.
 *  5. 자리: 고른 대상이 있으면 객체 정보 패널 안(`sceneRow`)에, 없으면 아래에 따로 한 줄(`boxed`). 둘 다 전문가 모드 · 지상 · 카메라 화면이 아닐 때만. 따로 뜨는 줄은 **아래 시트 손잡이(`PEEK_HEIGHT` 40 px) 바로 위**
 *     (`bottom: PEEK_HEIGHT + 8`)에 두고 시트가 열려 있으면 숨긴다. 시트는 전문가 모드일 때만 열려 있다(`visible={sceneSheetOpen && expertMode}`).
 *     (처음에는 줄을 객체 정보 패널과 같은 자리(`objectPanel`, `bottom: 12`)에 두었습니다. 레이아웃을 다시 읽어 보니 시트 손잡이는 무대 맨 아래 40 px 이고 그 자리가 손잡이를 덮어 고른 대상이 없을 때 시트를 끌어올릴 수 없게 되므로
 *      기준을 위처럼 고쳤습니다. 고른 대상이 있을 때 패널이 손잡이를 덮는 것은 원래 그랬던 동작입니다.)
 *     줄의 "장면 저장" · "모두 N" 은 시트를, 칩은 그 장면을 바로 연다. 시트의 열기는 `openScene`, 이름 바꾸기 · 지우기는 저장소 동작으로 이어진다.
 *  6. 시트: 요약 · 대상 글은 `sceneSummary` · `sceneNote`(해 위치는 `sunNoteAt`)로 만들고, 지우기는 경고창(`Alert`) 대신 줄 안에서 한 번 더 묻는다(어느 화면에서나 같게 동작하고 확인할 수 있다).
 *  7. 하네스에 `scenes:1` 이 있다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-scene-ui.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW, REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

(async () => {
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'savedScenes.js'));
  const store = read('src', 'store', 'useCelestialStore.ts');
  const sky = read('src', 'components', 'SkyScreen', 'SkyScreen.tsx');
  const sheet = read('src', 'components', 'SkyScreen', 'SceneSheet.tsx');
  const bar = read('src', 'components', 'SkyScreen', 'SceneBar.tsx');
  const harness = read('tools', 'web-repro', 'App.tsx');

  console.log('\n[1] 저장소');
  ok(/savedScenes: SavedScene\[\];/.test(store) && /savedScenes: \[\],/.test(store), '상태에 savedScenes 가 있고 처음은 빈 목록');
  const part = (store.match(/partialize: \(state\) => \(\{[\s\S]*?\}\),/) || [''])[0];
  ok(/savedScenes: state\.savedScenes,/.test(part), '저장 목록(partialize)에 들어간다');
  ok(/addSavedScene: \(scene\) => \{\s*const r = addScene\(get\(\)\.savedScenes, scene\);\s*if \(r\.ok\) set\(\{ savedScenes: r\.list \}\);\s*return r;/.test(store), '추가: 순수 로직으로 하고 거절이면 저장소를 바꾸지 않은 채 이유를 돌려준다');
  ok(/renameSavedScene: \(id, name\) => set\(\(st\) => \(\{ savedScenes: renameScene\(st\.savedScenes, id, name\) \}\)\)/.test(store) && /removeSavedScene: \(id\) => set\(\(st\) => \(\{ savedScenes: removeScene\(st\.savedScenes, id\) \}\)\)/.test(store), '이름 바꾸기 · 지우기도 순수 로직으로');
  ok(/merge: \(persisted, current\) => \{\s*const p = \(persisted \?\? \{\}\) as Partial<CelestialState>;\s*return \{ \.\.\.current, \.\.\.p, savedScenes: sanitizeScenes\(p\.savedScenes\) \};/.test(store), '읽어 들일 때 정리하는 병합(나머지는 기본 병합과 같다)');

  console.log('\n[2] 저장하는 것');
  {
    const sc = S.makeScene({ latitude: 37.5, longitude: 127, eyeHeightM: 1.6, azDeg: 10, elDeg: 5, zoomX: 1, timeMs: 1e12, target: null }, { name: 'a', nowMs: 1e12, id: 'x', tzHours: 9, lang: 'ko' });
    const keys = Object.keys(sc).sort().join(',');
    ok(keys === ['aligned', 'azDeg', 'elDeg', 'eyeHeightM', 'id', 'latitude', 'longitude', 'name', 'savedAtMs', 'target', 'timeMs', 'zoomX'].sort().join(','), `키: ${keys}`);
    ok(!/weather|forecast|cloud/i.test(keys), '날씨 · 예보 · 구름은 저장하지 않는다');
  }

  console.log('\n[3] 지금 장면 읽기와 저장');
  const readFn = (sky.match(/const readScene = \(name: string\): SavedScene \| null => \{[\s\S]*?\n  \};/) || [''])[0];
  ok(/const view = sceneRef\.current\?\.getRenderState\?\.\(\)\?\.view;\s*if \(!view\) return null;/.test(readFn), '시선은 getRenderState().view, 못 읽으면 null');
  ok(/const spot = sceneRef\.current\?\.getEyeState\?\.\(\)\.eye \?\? \{ latitude, longitude \};/.test(readFn), '자리: 눈이 움직이는 중이면 눈의 자리, 아니면 저장된 위치');
  ok(/eyeHeightM: eyeH, azDeg: view\.az, elDeg: view\.el, zoomX: teleX, timeMs: currentTime\.getTime\(\), target: targetFromPicked\(picked\)/.test(readFn), '눈 높이 · 방위 · 앙각 · 줌 · 시각 · 고른 대상');
  const saveFn = (sky.match(/const saveScene = \(name: string\): SaveResult => \{[\s\S]*?\n  \};/) || [''])[0];
  ok(/if \(!sc\) return 'unavailable';/.test(saveFn) && /addSavedScene\(sc\)/.test(saveFn) && /r\.ok \? 'saved' : r\.reason === 'full' \? 'full' : 'unavailable'/.test(saveFn), '못 읽으면 unavailable, 저장함 · 가득 참');

  console.log('\n[4] 열기');
  const openFn = (sky.match(/const openScene = \(sc: SavedScene\) => \{[\s\S]*?\n  \};\n/) || [''])[0];
  const order = ['setSceneSheetOpen(false)', 'stopScenePoll()', 'pendingSceneTargetRef.current = null', 'setPicked(null)', 'setEyeH(sc.eyeHeightM)', 'setTeleX(sc.zoomX)', 'setCurrentTime(new Date(sc.timeMs))', 'setSpot({ latitude: sc.latitude, longitude: sc.longitude })', 'setCameraView?.(sc.azDeg, sc.elDeg)', 'pendingTargetFromScene(sc)'];
  const idx = order.map(o => openFn.indexOf(o));
  ok(idx.every(i => i >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]), `순서: ${order.map(o => o.split('(')[0]).join(' → ')}`);
  ok(!/setCameraView\?\.\(sc\.azDeg, sc\.elDeg,/.test(openFn), '화각은 넘기지 않는다(줌이 정한다)');
  ok(/const aligned = sc\.aligned;/.test(openFn) && /if \(aligned && np\) \{\s+alignedBodyRef\.current = aligned;\s+alignedViewRef\.current = true;\s+sceneRef\.current\?\.setCameraView\?\.\(np\.azDeg, np\.elDeg, 14, \{ centerOffsetYFrac: ALIGN_VIEW_OFFSET_Y \}\);/.test(openFn), '해 · 달에 맞춰 저장한 장면은 대상을 다시 잡은 뒤 같은 맞춤(화각 14°, 시야 중심 올림)을 다시 한다');
  ok(/aligned: alignedBodyRef\.current/.test(sky) && /alignedBodyRef\.current = hit\.body;/.test(sky) && /if \(!picked\) alignedBodyRef\.current = null;/.test(sky), '저장할 때 걸어 둔 천체를 읽고, 걸 때 기억하고, 대상이 지워지면 지운다');
  ok(/setInterval\(\(\) => \{/.test(openFn) && /\}, 500\);/.test(openFn) && /\+\+tries > 120/.test(openFn) && /targetFromLatLon\?\.\(w\.latitude, w\.longitude, w\.elevM\)/.test(openFn) && /const np = rebuildPicked\(w\.kind, w\.building, tp\);\s+setPicked\(np\);/.test(openFn), '대상: 0.5 초마다 최대 120 번 targetFromLatLon → rebuildPicked');
  ok(/onPickTarget=\{\(t\) => \{ pendingSceneTargetRef\.current = null; setPicked\(t\); \}\}/.test(sky) && /onClear=\{\(\) => \{ pendingSceneTargetRef\.current = null; setPicked\(null\); \}\}/.test(sky), '대상을 새로 고르거나 지우면 되살리던 대상은 접는다');

  console.log('\n[5] 자리');
  ok(!/sceneRow/.test(sky) && !/sceneRow/.test(fs.readFileSync(path.join(REPO_ROOT, 'src', 'components', 'SkyScreen', 'ObjectInfoPanel.tsx'), 'utf8')), '객체 정보 패널의 sceneRow 와 아래 따로 뜬 SceneBar 줄은 옛 UI 와 함께 지움(2026-11-21): 장면 저장 · 열기는 새 틀의 "장면" 칸이 맡는다');
  ok(/scene: <SceneBar language=\{language\} scenes=\{savedScenes\} onSave=\{\(\) => setSceneSheetOpen\(true\)\} onOpen=\{openScene\} onAll=\{\(\) => setSceneSheetOpen\(true\)\} onShoot=\{shootScene\} \/>/.test(sky) && !/<SceneBar boxed/.test(sky), '새 틀의 "장면" 칸 안에 SceneBar(장면 저장 · 저장한 장면 · 이 장면 찍기)');
  ok(/sceneBar: \{ position: 'absolute', left: 12, right: 12, bottom: 72, zIndex: 22 \},/.test(sky), '그 자리는 bottom: 72 (하단 툴독 위)');
  ok(/<SceneSheet\s+visible=\{sceneSheetOpen\}/.test(sky) && /onOpen=\{openScene\}/.test(sky) && /renameSavedScene\(id, n\)/.test(sky) && /removeSavedScene\(id\)/.test(sky), '시트는 "장면 저장"을 누르면 열리고(옛 화면의 전문가 모드 조건은 없앰), 열기 · 이름 바꾸기 · 지우기가 이어진다');

  console.log('\n[6] 시트');
  ok(/sceneSummary\(s, ctx\)/.test(sheet) && /sceneNote\(s, sunNoteAt\(s\.timeMs, s\.latitude, s\.longitude\), language\)/.test(sheet), '요약 · 대상 글은 순수 로직으로, 해 위치는 sunNoteAt');
  ok(!/Alert/.test(sheet) && /지울까요\?/.test(sheet) && /setConfirmId\(s\.id\)/.test(sheet) && /onRemove\(s\.id\); setConfirmId\(null\)/.test(sheet), '지우기는 경고창 없이 줄 안에서 한 번 더 묻는다');
  ok(/SAVED_SCENE_MAX/.test(sheet) && /SCENE_NAME_MAX/.test(sheet) && /장면이 가득 찼어요/.test(sheet), '가득 참 안내 · 이름 길이 제한');
  ok(/accessibilityLabel=\{`\$\{L3\(language, '열기', 'Open', '開く'\)\}: \$\{s\.name\}`\}/.test(sheet) && /accessibilityLabel=\{`\$\{L3\(language, '장면 열기', 'Open scene', 'シーンを開く'\)\}: \$\{s\.name\}`\}/.test(bar), '스크린리더 글에 장면 이름이 들어간다(시트의 열기 · 줄의 칩)');

  console.log('\n[7] 하네스');
  ok(/if \(Q\.scenes\) return <ScenesRepro W=\{W\} H=\{H\} \/>;/.test(harness), 'scenes:1');

  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { fail++; console.log('  FAIL: 예외 — ' + (e && e.stack || e)); console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); });
