/**
 * **앱 머리줄 유리(`src/utils/headerLayout.ts`)의 자리 · 재질 · 글자 대비가 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 머리줄은 이제 **하늘 화면 위에 떠 있습니다**(절대 위치). 하늘 탭에서는 3D 하늘이 머리줄 뒤까지 이어지고(유리의 흐림이 그 하늘을 흐리게 함), 학습 · 기록 탭은 불투명한 화면이라 내용이 머리줄 아래에서 시작합니다.
 *
 *  1. 높이: 위 여백 4(`space.xs`) + 줄 40(`TOUCH`) + 아래 여백 4 = `HEADER_HEIGHT` 48. (예전에는 같은 값이 흐름 안에서 자리를 차지했다 — 숫자는 그대로, 겹쳐 놓는 방식만 바뀜.)
 *  2. `headerMaterial(탭)`: 'sky' → 'glass', 'learn' · 'log' → 'solid'(불투명 화면 위라 흐림이 비출 것이 없고, 밝은 테마에서는 유리 위 흰 글자 대비가 모자라 — 아래 5번 — 기존 테마 상자를 쓴다). 모르는 탭 · undefined → 'solid'.
 *  3. `contentInsetTop(탭)`: 'sky' → 0(하늘이 머리줄 뒤까지), 그 밖 → `HEADER_HEIGHT`(48). 모르는 탭 → 48.
 *  4. `belowHeader(기준 top)` = 기준 + `HEADER_HEIGHT`: 하늘 화면 위에 떠 있는 것들(읽음 줄 12 → 60, 고른 대상 패널 64 → 112, 알림 줄 56 → 104, 구름 레이더 HUD 50 → 98, 렌즈 배지 52 → 100, 방위 눈금 6 → 54). 숫자가 아니면 `HEADER_HEIGHT`.
 *  5. 글자 대비(WCAG 2, 손계산: 파이썬으로 같은 식을 풀어 둔 값, 허용 오차 0.02). 가장 밝은 배경은 연무 #E9E2D6, 글자 #F1F5F9, 유리 칠 rgb(18,22,34) 알파 0.44, 위 막은 [0 → 0.55, 1 → 0] 150 px 이라 머리줄 높이 y 에서 알파 = 0.55 × (1 − y/150):
 *     · 하늘 탭 머리줄(위 막 위): y 4 → 8.80 · y 24 → 7.60 · y 44 → 6.57. 켜진 탭(하늘색 0.20 덧칠): y 4 → 6.41 · y 44 → 5.12. 모두 4.5 이상.
 *     · 위 막 없이 연무 위 유리(밝은 테마의 불투명 화면에 유리를 얹은 경우): 3.21 로 4.5 에 못 미친다 → 그래서 학습 · 기록 탭은 'solid' 이다(위 2번이 이 숫자에서 나옴).
 *  6. 연결(소스 읽기, 기기에서는 아직 못 봄): `AppHeader` 는 절대 위치 · 높이 `HEADER_HEIGHT` · 하늘 탭에서만 `GlassSurface`(탭 묶음 · 장소 · 설정)와 글자 #F1F5F9, 탭에 `accessibilityRole="tab"` · selected.
 *     `TabNavigator` 는 세 쪽에 `contentInsetTop(탭)` 를 위 여백으로. 하늘 위에 떠 있는 것은 `belowHeader` 로 내린다: `SkyFrame` 읽음 줄, `SkyScreen` 의 3D 설정 단추 · 고른 대상 패널 · 알림 줄 · 추적 알약, `SkyScene3D` 의 `topInset` (구름 레이더 HUD 알약 · `ViewfinderOverlay` 의 렌즈 배지 · 방위 눈금), `SkyScreen` 이 `topInset={HEADER_HEIGHT}` 를 넘김.
 */
const path = require('path');
const fs = require('fs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, t = 0.02) => typeof a === 'number' && Math.abs(a - b) <= t;

(async () => {
  let H = null, G = null;
  try { H = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'headerLayout.js')); } catch { H = null; }
  try { G = await import('file://' + path.join(PREVIEW, 'app', 'theme', 'glassTokens.js')); } catch { G = null; }
  const f = (n, ...a) => (H && H[n] ? (typeof H[n] === 'function' ? H[n](...a) : H[n]) : 'none');

  console.log('\n[1] 높이');
  ok(f('HEADER_HEIGHT') === 48 && f('HEADER_PAD_TOP') === 4 && f('HEADER_ROW') === 40 && f('HEADER_PAD_BOTTOM') === 4, '4 + 40 + 4 = 48');

  console.log('\n[2] headerMaterial');
  ok(f('headerMaterial', 'sky') === 'glass' && f('headerMaterial', 'learn') === 'solid' && f('headerMaterial', 'log') === 'solid' && f('headerMaterial', 'x') === 'solid' && f('headerMaterial', undefined) === 'solid', '하늘 → 유리, 학습 · 기록 · 모르는 탭 → 불투명');

  console.log('\n[3] contentInsetTop');
  ok(f('contentInsetTop', 'sky') === 0 && f('contentInsetTop', 'learn') === 48 && f('contentInsetTop', 'log') === 48 && f('contentInsetTop', 'x') === 48, '하늘 0, 나머지 48');

  console.log('\n[4] belowHeader');
  ok(f('belowHeader', 12) === 60 && f('belowHeader', 64) === 112 && f('belowHeader', 56) === 104 && f('belowHeader', 50) === 98 && f('belowHeader', 52) === 100 && f('belowHeader', 6) === 54, '12 → 60 · 64 → 112 · 56 → 104 · 50 → 98 · 52 → 100 · 6 → 54');
  ok(f('belowHeader', NaN) === 48 && f('belowHeader', undefined) === 48, '숫자가 아니면 48');

  console.log('\n[5] 글자 대비');
  if (G) {
    const haze = [0xE9, 0xE2, 0xD6], text = [0xF1, 0xF5, 0xF9];
    const scrimAt = (y) => G.scrimAlpha(G.SCRIM_TOP.stops, y / G.SCRIM_TOP.heightPx);
    const bd = (y) => G.glassBackdrop(haze, scrimAt(y), true);
    ok(near(G.contrastRatio(text, bd(4)), 8.80) && near(G.contrastRatio(text, bd(24)), 7.60) && near(G.contrastRatio(text, bd(44)), 6.57), '하늘 탭 머리줄 위 글자 대비: y 4 · 24 · 44 → 8.80 · 7.60 · 6.57');
    const act = (y) => G.blendRGB(bd(y), G.GLASS.tintRGB, G.GLASS.tintAlpha);
    ok(near(G.contrastRatio(text, act(4)), 6.41) && near(G.contrastRatio(text, act(44)), 5.12), '켜진 탭(덧칠): y 4 → 6.41, y 44 → 5.12');
    ok([4, 14, 24, 34, 44].every((y) => G.contrastRatio(text, bd(y)) >= 4.5 && G.contrastRatio(text, act(y)) >= 4.5), '머리줄 전 구간에서 보통 글자 4.5 이상');
    ok(near(G.contrastRatio(text, G.blendRGB(haze, G.GLASS.fillRGB, G.GLASS.fillAlpha)), 3.21) && G.contrastRatio(text, G.blendRGB(haze, G.GLASS.fillRGB, G.GLASS.fillAlpha)) < 4.5, '위 막 없이 연무 위 유리는 3.21 로 4.5 미만(그래서 학습 · 기록은 불투명)');
  } else { ok(false, '유리 값을 못 읽음'); ok(false, '켜진 탭'); ok(false, '전 구간'); ok(false, '막 없는 경우'); }

  console.log('\n[6] 연결(소스 읽기)');
  {
    const hdr = read('src', 'components', 'AppHeader.tsx');
    const tabs = read('src', 'components', 'TabNavigator.tsx');
    const frame = read('src', 'components', 'SkyScreen', 'SkyFrame.tsx');
    const sky = read('src', 'components', 'SkyScreen', 'SkyScreen.tsx');
    const scene = read('src', 'components', 'SkyScene3D', 'SkyScene3D.tsx');
    const vf = read('src', 'components', 'SkyScene3D', 'ViewfinderOverlay.tsx');
    ok(/header: \{\s+position: 'absolute',\s+top: 0,\s+left: 0,\s+right: 0,\s+zIndex: 100,\s+height: HEADER_HEIGHT,/.test(hdr) && /<View style=\{styles\.header\} pointerEvents="box-none">/.test(hdr), '머리줄: 절대 위치, 높이 HEADER_HEIGHT, 빈 곳은 손가락이 하늘로 통과(box-none)');
    ok(/const glass = headerMaterial\(activeTab\) === 'glass';/.test(hdr) && /<GlassSurface testID="hdr-tabs" style=\{g!\.navToggle\}>/.test(hdr) && (hdr.match(/<GlassSurface style=\{StyleSheet\.absoluteFill\} \/>/g) || []).length >= 2 && (hdr.match(/\{ color: TEXT \}, glassTextShadow/g) || []).length === 2, '하늘 탭에서만 유리(탭 묶음 · 장소 · 설정), 글자는 #F1F5F9 + 그림자');
    ok(/accessibilityRole="tab"\s+accessibilityState=\{\{ selected: isActive \}\}\s+aria-selected=\{isActive\}/.test(hdr), '탭 단추에 tab 역할과 선택 상태(웹 하네스가 aria-selected 로 읽으므로 둘 다)');
    ok(/paddingTop: contentInsetTop\('learn'\)/.test(tabs) && /paddingTop: contentInsetTop\('sky'\)/.test(tabs), 'TabNavigator: 데이터 · 하늘 두 쪽 모두 contentInsetTop');
    ok(/readout: \{ position: 'absolute', left: 10, right: 10, top: belowHeader\(12\)/.test(frame), 'SkyFrame 읽음 줄은 머리줄 아래(12 → 60)');
    ok(/top: belowHeader\(12\),\s+right: 12/.test(sky) && /objectPanelTop: \{[^}]*top: belowHeader\(64\)/.test(sky) && /bannerTop: \{ bottom: undefined, top: belowHeader\(56\) \}/.test(sky) && /trackingBadge: \{\s+position: 'absolute',\s+top: belowHeader\(12\)/.test(sky), 'SkyScreen: 3D 설정 단추 · 고른 대상 패널 · 알림 줄 · 추적 알약이 머리줄 아래');
    ok(/topInset=\{HEADER_HEIGHT\}/.test(sky) && /\{ top: 50 \+ topInset \}/.test(scene) && /topInset=\{topInset\}/.test(scene) && /\{ top: 52 \+ topInset \}/.test(vf) && /\{ top: 6 \+ topInset \}/.test(vf), '3D 장면의 topInset: 구름 레이더 HUD(50) · 렌즈 배지(52) · 방위 눈금(6) 을 그만큼 내림');
  }

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
