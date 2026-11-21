/**
 * **카메라 위 줄(닫기 · 모드/방위 알약 · 보정 · 앞뒤 전환 · 보정 메뉴)의 유리 옮김(소스 검사)** — `GlassIconButton` · `SunCamera`.
 * 브라우저 불필요. 웹 하네스는 SunCamera 를 못 띄워 연결은 소스로만 본다(계획 문서 §23-4).
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21)
 *  1. `GlassIconButton`(새): 유리 면(`GlassSurface`) 안의 아이콘 단추. 크기는 `TOUCH`(40) 이상, 눌림 역할 `button` 과 이름(`accessibilityLabel`)을 가진다. 켜짐(`active`)은 `GlassSurface active`.
 *  2. 카메라 위 줄에서 닫기 · 앞뒤 전환은 `GlassIconButton` 이다. 옛 `styles.hudBtn` 은 더 쓰지 않고 스타일도 지운다.
 *  3. 모드/방위 알약은 `GlassSurface` 위에 놓는다. 글자는 모두 `TEXT` + `glassTextShadow` 이고(모드 글자를 해 · 달 색으로 칠하지 않는다. 해 · 달은 아이콘 색으로만 구분), 눌림 높이는 `TOUCH` 이상. 얼린 보기는 `GlassSurface active`.
 *  4. "보정" 은 `GlassChip`(켜짐 = 메뉴 열림)이고 간섭 · 진북 아님 점은 칩의 아이콘 자리에 둔다.
 *  5. 보정 메뉴(팝오버)는 `GlassSurface` 이고 글자는 `TEXT`. 단추 높이는 눌림 40 이상(`minHeight` 40).
 *  6. 안 쓰게 된 옛 스타일 `hudBtn` · `azBox` · `azBoxFrozen` · `topPillBtn` · `topPillText` · `alignPopoverText` 의 옛 색(`color.overlay` 바탕)은 없다.
 *  7. 순서: 기존 동작을 그대로 부른다(`onClose`, `setModeSheetOpen(true)`, `setAlignMenuOpen`, `handleVisionCalibrate`/`handleSunSnap`/`handleCalibrate`, `setCameraFacing`).
 *
 *   node tools/shader-preview/verify-camera-top-glass.js
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => { try { return fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8'); } catch { return ''; } };

const btn = read('src', 'components', 'glass', 'GlassIconButton.tsx');
const cam = read('src', 'components', 'SunCamera.tsx');
const top = (cam.match(/무대 위 최소 상태 HUD[\s\S]*?<View style=\{\[styles\.statusCol/) || [''])[0];
const styleBlock = (cam.match(/const styles = StyleSheet\.create\(\{[\s\S]*$/) || [''])[0];

console.log('[1] GlassIconButton');
ok(/GlassSurface/.test(btn) && /TOUCH/.test(btn) && /accessibilityRole="button"/.test(btn) && /accessibilityLabel/.test(btn) && /active/.test(btn), '유리 면 · TOUCH · 역할 button · 이름 · active');
ok(/width: TOUCH/.test(btn) && /height: TOUCH/.test(btn), '40 × 40');

console.log('\n[2] 닫기 · 앞뒤 전환');
ok(top.length > 200, '카메라 위 줄 블록을 찾았다');
ok(/<GlassIconButton[\s\S]*?onPress=\{onClose\}/.test(top) && /<GlassIconButton[\s\S]*?setCameraFacing\(prev => prev === 'back' \? 'front' : 'back'\)/.test(top), '닫기 · 앞뒤 전환이 GlassIconButton 이고 기존 동작을 부른다');
ok(!/styles\.hudBtn/.test(cam) && !/^\s*hudBtn:/m.test(styleBlock), 'hudBtn 사용과 스타일이 없다');

console.log('\n[3] 모드/방위 알약');
const i0 = top.indexOf('setModeSheetOpen(true)');
const pillWide = top.slice(i0, top.indexOf('<GlassChip', i0));
ok(/<GlassSurface[^>]*active=\{viewMode !== 'camera' && !!frozenView\}/.test(pillWide) && /setModeSheetOpen\(true\)/.test(pillWide), '알약이 GlassSurface 이고 얼림이면 active, 누르면 모드 시트');
ok(/TEXT/.test(pillWide) && /modeAzText:[^}]*color: TEXT[^}]*glassTextShadow/.test(styleBlock) && !/color: cameraTab === 'astro' \? color\.moon : color\.sun/.test(pillWide) && !/color\.accent/.test(pillWide), '글자는 TEXT 한 색(해 · 달 색 글자 없음)');
ok(/minHeight: TOUCH|height: TOUCH/.test(styleBlock.match(/modeAz:\s*\{[^}]*\}/) ? styleBlock.match(/modeAz:\s*\{[^}]*\}/)[0] : '') , '알약 높이 TOUCH 이상(modeAz 스타일)');

console.log('\n[4] 보정 칩');
ok(/<GlassChip[\s\S]*?active=\{alignMenuOpen\}[\s\S]*?setAlignMenuOpen\(v => !v\)/.test(top) || /<GlassChip[\s\S]*?setAlignMenuOpen\(v => !v\)[\s\S]*?active=\{alignMenuOpen\}/.test(top), '보정이 GlassChip(active = 메뉴 열림)이고 메뉴를 토글');
ok(/icon=\{[\s\S]*?hasInterference/.test(top), '간섭 · 진북 아님 점이 칩 아이콘 자리');

console.log('\n[5] 보정 메뉴');
const pop = (cam.match(/\{alignMenuOpen && \([\s\S]*?\n                \)\}/) || [''])[0];
ok(/<GlassSurface[^>]*styles\.alignPopover/.test(pop) && /handleVisionCalibrate\(\)/.test(pop) && /handleSunSnap\(\)/.test(pop) && /handleCalibrate\(\)/.test(pop), '메뉴가 GlassSurface 이고 세 동작을 그대로 부른다');
ok(/alignPopoverText:[^}]*color: TEXT/.test(styleBlock) && /alignPopoverBtn:[^}]*minHeight: TOUCH/.test(styleBlock), '메뉴 글자 TEXT · 단추 minHeight TOUCH');

console.log('\n[6] 옛 스타일');
ok(!/azBox:\s*\{/.test(styleBlock) && !/azBoxFrozen:/.test(styleBlock) && !/topPillBtn:/.test(styleBlock) && !/topPillText:/.test(styleBlock), 'azBox · azBoxFrozen · topPillBtn · topPillText 스타일이 없다');
ok(!/alignPopover:\s*\{[^}]*color\.overlay/.test(styleBlock), '메뉴 바탕이 옛 overlay 색이 아니다');

console.log('\n[7] 사용 안 하는 옛 이름');
ok(!/styles\.azBox\b/.test(cam) && !/styles\.topPill/.test(cam), 'azBox · topPill 참조가 없다');

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
