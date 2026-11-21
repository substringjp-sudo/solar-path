/**
 * **유리 재질 · 위아래 어두운 막의 값이 글자를 읽을 수 있게 하는가** — `src/theme/glassTokens.ts`. 브라우저 · 네트워크 불필요.
 * (목업 "4차 b": 테두리 없는 옅은 유리, 시간 자는 상자 없이 눈금만, 밝은 하늘에서도 읽히게 아래쪽 어두운 그라데이션과 글자 그림자.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 글자 색 #F1F5F9, 유리 칠 rgb(18, 22, 34). 대비는 WCAG 2 상대 휘도 비 (L1 + 0.05) / (L2 + 0.05). 어두운 막과 유리는 sRGB 값에서 알파 섞기(CSS 와 같게).
 * 가장 밝은 배경은 **연무 #E9E2D6**(목업 하늘의 지평선 쪽 연무, 휘도 0.77)로 잡는다. 순백(구름 윗면 · 해 원반)은 작은 면이라 따로 눈으로 본다(아래 7번).
 * 아래 숫자는 이 스크립트 밖에서 파이썬으로 손계산해 둔 값이다(허용 오차 0.02).
 *
 *  1. 값: 유리 칠 알파 0.44(흐림 있음) · 0.50(흐림 없음 = 안드로이드 기본 대체), 흐림 22 px · 채도 1.5, 위 가장자리 안쪽 선 rgba(255,255,255,0.16), 글자 그림자 0 1px 3px rgba(0,0,0,0.65), 켜진 칩 색 덧칠 알파 0.20(하늘색 56,189,248),
 *     글자색 #F1F5F9(`TEXT`), 켜진 칩의 글자도 #F1F5F9(하늘색 글자 아님 — 이유는 5번).
 *  2. 아래 막(`SCRIM_BOTTOM`) 정지점 [위치 0~1 → 검정 알파]: [0 → 0, 0.18 → 0.30, 0.55 → 0.58, 1 → 0.72]. 사이는 직선. 위 막(`SCRIM_TOP`): [0 → 0.55, 1 → 0], 높이 150 px.
 *     `scrimAlpha(정지점, 위치)`: 0.21 → 0.3227, 0.40 → 0.4665, 0.50 → 0.5422, 0.60 → 0.5956, 0.92 → 0.6951(아래 막). 위 막은 y 10 → 0.51333(= 0.55 · 140/150; 처음 0.5100 으로 잘못 적었다가 손으로 다시 곱해 바로잡음), 위치가 범위 밖이면 양 끝 값, 숫자가 아니면 0.
 *  3. 섞기: `blendRGB(바탕, 색, 알파)` = 바탕 · (1 − 알파) + 색 · 알파(채널마다). `contrastRatio(a, b)`: 검정 · 흰색 → 21, 같은 색 → 1, 순서를 바꿔도 같다.
 *  4. 글자 대비(연무 위, 손계산). 아래 막 위치는 아래 묶음 높이에서의 비율:
 *     · 유리 칩 안 글자(칩 줄 위치 0.21): 5.77, (0.32): 6.80. · 막 위의 맨 글자: 시간 숫자(0.40): 3.98, 눈금 글자(0.50): 5.10, (0.60): 6.13, 모드 줄(0.92): 8.74.
 *     · 위쪽 유리(머리줄 · 읽음 줄)의 y 10 · 33 · 56 · 86 px: 8.42 · 7.12 · 6.02 · 4.88(흐림 없음 알파 0.50 이면 9.15 · 7.87 · 6.78 · 5.59).
 *     기준 문턱: 보통 글자 4.5 이상, 큰 글자(굵은 18.66 px 이상 = 시간 숫자 22 px)는 3 이상. 위 값이 모두 문턱을 넘고, 일부러 알파를 낮추면(유리 0.30 · 아래 막 0.5 배) 문턱 밑으로 떨어지는 칸이 있어야 한다(기준이 느슨하지 않다는 증거).
 *  5. 켜진 칩(유리 + 하늘색 0.20 덧칠, 연무 위 칩 줄 0.21)의 #F1F5F9 글자 대비 4.64 로 4.5 를 넘는다. 같은 자리 하늘색 글자(#38BDF8)는 2.95 로 4.5 에 못 미치므로 쓰지 않는다. 덧칠이 0.40 이면 3.70 으로 떨어진다.
 *  6. 어두운 밤(#070A12) 위에서는 모든 칸이 17 이상(어두운 배경에서 흰 글자는 걱정 없음).
 *  7. `scrimStops(정지점, 개수)`: SVG 그라데이션용 { offset, opacity } 목록. 개수 5 이면 offset 0 · 0.25 · 0.5 · 0.75 · 1 이고, 각 opacity 는 그 offset 에서의 `scrimAlpha` 와 같다(아래 막은 첫 값 0, 끝 값 0.72).
 *     `glassFill(흐림 있음?)`: 'rgba(18, 22, 34, 0.44)' · 'rgba(18, 22, 34, 0.5)'. `glassBackdrop(바탕, 막 알파, 흐림 있음?)` = 바탕에 검정 막을 섞고 그 위에 유리 칠을 섞은 색.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-glass-tokens.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t;

(async () => {
  let G = null;
  try { G = await import('file://' + path.join(PREVIEW, 'app', 'theme', 'glassTokens.js')); } catch { G = null; }
  ok(!!G && typeof G.scrimAlpha === 'function' && typeof G.contrastRatio === 'function' && typeof G.glassBackdrop === 'function', 'glassTokens 가 있다');
  if (!G || typeof G.scrimAlpha !== 'function' || typeof G.contrastRatio !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  console.log('\n[1] 값');
  ok(G.GLASS.fillAlpha === 0.44 && G.GLASS.flatAlpha === 0.5 && G.GLASS.blurPx === 22 && G.GLASS.saturate === 1.5 && G.GLASS.tintAlpha === 0.2, '알파 · 흐림 · 채도 · 덧칠');
  ok(J(G.GLASS.fillRGB) === J([18, 22, 34]) && J(G.GLASS.tintRGB) === J([56, 189, 248]) && G.GLASS.highlight === 'rgba(255,255,255,0.16)', '칠 · 덧칠 색 · 위 가장자리 선');
  ok(J(G.GLASS.textShadow) === J({ x: 0, y: 1, blur: 3, color: 'rgba(0,0,0,0.65)' }) && G.TEXT === '#F1F5F9' && G.ACTIVE_CHIP_TEXT === '#F1F5F9', '글자 그림자 · 글자색 · 켜진 칩 글자색');

  console.log('\n[2] 막');
  ok(J(G.SCRIM_BOTTOM) === J([[0, 0], [0.18, 0.30], [0.55, 0.58], [1, 0.72]]) && J(G.SCRIM_TOP.stops) === J([[0, 0.55], [1, 0]]) && G.SCRIM_TOP.heightPx === 150, '정지점');
  const B = (f) => G.scrimAlpha(G.SCRIM_BOTTOM, f);
  ok(near(B(0.21), 0.3227, 1e-4) && near(B(0.40), 0.4665, 1e-4) && near(B(0.50), 0.5422, 1e-4) && near(B(0.60), 0.5956, 1e-4) && near(B(0.92), 0.6951, 1e-4), '아래 막 알파 손계산');
  ok(near(G.scrimAlpha(G.SCRIM_TOP.stops, 10 / 150), 0.51333, 1e-5) && B(-1) === 0 && B(2) === 0.72 && B(NaN) === 0 && G.scrimAlpha(G.SCRIM_TOP.stops, 2) === 0, '위 막, 범위 밖은 양 끝, 숫자가 아니면 0');

  console.log('\n[3] 섞기 · 대비');
  ok(J(G.blendRGB([0, 0, 0], [255, 255, 255], 0.5)) === J([127.5, 127.5, 127.5]) && J(G.blendRGB([10, 20, 30], [200, 100, 0], 0)) === J([10, 20, 30]), 'blendRGB');
  ok(near(G.contrastRatio([0, 0, 0], [255, 255, 255]), 21, 1e-9) && near(G.contrastRatio([9, 9, 9], [9, 9, 9]), 1, 1e-9) && G.contrastRatio([10, 20, 30], [200, 210, 220]) === G.contrastRatio([200, 210, 220], [10, 20, 30]), 'contrastRatio');

  console.log('\n[4] 글자 대비(연무 위)');
  const HAZE = [0xe9, 0xe2, 0xd6], NIGHT = [0x07, 0x0a, 0x12], TXT = [0xf1, 0xf5, 0xf9];
  const atBottom = (bd, f, glass, blur = true) => { const b = G.blendRGB(bd, [0, 0, 0], B(f)); return glass ? G.blendRGB(b, G.GLASS.fillRGB, blur ? G.GLASS.fillAlpha : G.GLASS.flatAlpha) : b; };
  const cr = (bg) => G.contrastRatio(TXT, bg);
  const chip21 = cr(atBottom(HAZE, 0.21, true)), chip32 = cr(atBottom(HAZE, 0.32, true));
  ok(near(chip21, 5.77) && near(chip32, 6.80), `유리 칩 0.21 · 0.32: ${chip21.toFixed(2)} · ${chip32.toFixed(2)} (손계산 5.77 · 6.80)`);
  const dig = cr(atBottom(HAZE, 0.40, false)), r50 = cr(atBottom(HAZE, 0.50, false)), r60 = cr(atBottom(HAZE, 0.60, false)), strip = cr(atBottom(HAZE, 0.92, false));
  ok(near(dig, 3.98) && near(r50, 5.10) && near(r60, 6.13) && near(strip, 8.74), `막 위 맨 글자 숫자 · 눈금 · 모드 줄: ${[dig, r50, r60, strip].map(v => v.toFixed(2))} (손계산 3.98 · 5.10 · 6.13 · 8.74)`);
  const topc = (y, blur) => cr(G.blendRGB(G.blendRGB(HAZE, [0, 0, 0], G.scrimAlpha(G.SCRIM_TOP.stops, y / G.SCRIM_TOP.heightPx)), G.GLASS.fillRGB, blur ? G.GLASS.fillAlpha : G.GLASS.flatAlpha));
  const tops = [10, 33, 56, 86].map(y => topc(y, true)), topsFlat = [10, 33, 56, 86].map(y => topc(y, false));
  ok(J(tops.map((v, i) => near(v, [8.42, 7.12, 6.02, 4.88][i]))) === J([true, true, true, true]) && J(topsFlat.map((v, i) => near(v, [9.15, 7.87, 6.78, 5.59][i]))) === J([true, true, true, true]), `위쪽 유리 y 10 · 33 · 56 · 86: ${tops.map(v => v.toFixed(2))} · 흐림 없음 ${topsFlat.map(v => v.toFixed(2))}`);
  ok([chip21, chip32, r50, r60, strip, ...tops, ...topsFlat].every(v => v >= 4.5) && dig >= 3, '보통 글자는 4.5 이상, 시간 숫자(큰 글자)는 3 이상');
  const weakGlass = cr(G.blendRGB(G.blendRGB(HAZE, [0, 0, 0], B(0.21)), G.GLASS.fillRGB, 0.3));
  const weakScrimRuler = cr(G.blendRGB(HAZE, [0, 0, 0], B(0.50) * 0.5));
  const weakTop = cr(G.blendRGB(G.blendRGB(HAZE, [0, 0, 0], G.scrimAlpha(G.SCRIM_TOP.stops, 86 / 150) * 0.5), G.GLASS.fillRGB, 0.3));
  ok(weakGlass < 4.5 && weakScrimRuler < 4.5 && weakTop < 4.5, `기준이 느슨하지 않다: 유리 0.30 이면 칩 ${weakGlass.toFixed(2)}, 막을 절반으로 줄이면 눈금 ${weakScrimRuler.toFixed(2)} · 위쪽 ${weakTop.toFixed(2)} 가 4.5 밑`);

  console.log('\n[5] 켜진 칩');
  const base21 = atBottom(HAZE, 0.21, true);
  const on = cr(G.blendRGB(base21, G.GLASS.tintRGB, G.GLASS.tintAlpha));
  const accentText = G.contrastRatio([0x38, 0xbd, 0xf8], base21);
  const on40 = cr(G.blendRGB(base21, G.GLASS.tintRGB, 0.4));
  ok(near(on, 4.64) && on >= 4.5, `켜진 칩 #F1F5F9 글자: ${on.toFixed(2)} (손계산 4.64)`);
  ok(near(accentText, 2.95) && accentText < 4.5 && near(on40, 3.70) && on40 < 4.5, `하늘색 글자 ${accentText.toFixed(2)}(손계산 2.95) · 덧칠 0.40 이면 ${on40.toFixed(2)}(3.70) — 둘 다 4.5 밑이라 쓰지 않는다`);

  console.log('\n[6] 밤');
  const nightAll = [atBottom(NIGHT, 0.21, true), atBottom(NIGHT, 0.40, false), atBottom(NIGHT, 0.60, false), atBottom(NIGHT, 0.92, false)].map(cr);
  ok(nightAll.every(v => v >= 17), `밤 위 모든 칸 17 이상: ${nightAll.map(v => v.toFixed(1))}`);

  console.log('\n[7] 그라데이션 · 칠 글');
  const st = G.scrimStops(G.SCRIM_BOTTOM, 5);
  ok(st.length === 5 && J(st.map(s => s.offset)) === J([0, 0.25, 0.5, 0.75, 1]) && st.every(s => near(s.opacity, B(s.offset), 1e-9)) && st[0].opacity === 0 && st[4].opacity === 0.72, 'scrimStops: 5 개, offset 0~1, 값은 scrimAlpha 와 같다');
  ok(G.glassFill(true) === 'rgba(18, 22, 34, 0.44)' && G.glassFill(false) === 'rgba(18, 22, 34, 0.5)', 'glassFill');
  const gb = G.glassBackdrop(HAZE, 0.5, true), gb2 = G.blendRGB(G.blendRGB(HAZE, [0, 0, 0], 0.5), [18, 22, 34], 0.44);
  ok(J(gb) === J(gb2), 'glassBackdrop = 바탕 → 검정 막 → 유리 칠 순서');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
