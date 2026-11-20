/**
 * **촬영 결과 비교(목업 5)의 순수 계산이 맞는가** — `src/utils/resultCompare.ts`. 브라우저 · 네트워크 불필요.
 * (계획 8.7: 크게 비교하기 — 반씩 · 겹침 · 위아래, 차이 짚기 — 하늘을 왼쪽 · 가운데 · 오른쪽 · 해 근처로 나눠 밝기와 색을 비교해 짧게 알림, 그때 예보 한 줄.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 * 픽셀은 RGBA 한 줄 배열(0~255)이다. 밝기 lum = (0.2126·R + 0.7152·G + 0.0722·B) / 255(감마를 풀지 않은 단순 가중), 붉기 red = (R − B) / 255. 한 영역의 값은 그 영역 픽셀의 평균.
 *
 *  1. 영역 나누기(`zoneStats(rgba, w, h, sun?)` → { left, center, right, sun? }, 각 { lum, red }): 픽셀의 열 번호 i 로 왼쪽 = i·3/w < 1, 가운데 = 1 이상 2 미만, 오른쪽 = 2 이상. 세로는 나누지 않는다.
 *     해 근처 `sun` = { x, y }(가로 · 세로 비율 0~1)를 주면, 픽셀 중심 (i + 0.5, j + 0.5) 이 해 자리 (x·w, y·h) 에서 0.2·w 이내인 픽셀의 평균(다른 영역과 겹쳐도 센다). 해를 안 주면 sun 칸은 없다.
 *     6 × 3 픽셀: 열 0~1 은 (200, 100, 50), 열 2~3 은 (100, 100, 100), 열 4~5 는 (30, 60, 120). 아래 시험은 손으로 계산한 값으로 잰다(허용오차 1e-3).
 *     (왼쪽 lum = (42.52 + 71.52 + 3.61)/255 = 0.46137, red = 150/255 = 0.58824. 가운데 lum = 100/255 = 0.39216, red = 0. 오른쪽 lum = (6.378 + 42.912 + 8.664)/255 = 0.22727, red = (30 − 120)/255 = −0.35294.)
 *     입력 길이가 w·h·4 와 다르거나 w · h 가 1 미만이면 null.
 *  2. 차이 줄(`diffLines(사진 영역, 예측 영역, 언어)`): 영역마다 dLum = 사진 − 예측, dRed = 사진 − 예측. |dLum| ≥ 0.08 이면 "밝기" 줄, |dRed| ≥ 0.08 이면 "색" 줄을 만든다(경계 포함).
 *     줄 = "{영역} 하늘이 예측보다 어두움/밝음" · "{영역} 하늘이 예측보다 덜 붉음/더 붉음". 영역 이름 한국어는 왼쪽 · 가운데 · 오른쪽 · 해 근처. 크기(|값|)가 큰 순으로 최대 3 줄. 같으면(크기를 소수 여섯째 자리로 반올림해 견준다) 영역 순서(왼쪽 · 가운데 · 오른쪽 · 해 근처), 밝기가 색보다 먼저.
 *     하나도 없으면 한 줄 "예측과 비슷해요"(영어 "Close to the prediction", 일본어 "予測に近いです"). 영어 · 일본어 줄도 있고 한국어와 모두 다르다.
 *     예: 해 근처 사진 lum 0.30, 예측 0.45 → dLum −0.15 → "해 근처 하늘이 예측보다 어두움".
 *  3. 나누는 위치(`clampSplit(x, 너비)`): 손잡이 위치 비율 x / 너비를 0.05 ~ 0.95 로 자른다(손잡이가 끝에 붙어 못 잡게 되는 것을 막는다). 너비가 0 이하거나 숫자가 아니면 0.5. x = 0 → 0.05, x = 너비 → 0.95, x = 너비/2 → 0.5, 음수 → 0.05.
 *  4. 그때 예보 한 줄(`forecastLine(상태 글, 해 고도, 해 방위, 언어)`): 한국어 "맑음 · 해 고도 8° · 방위 245°", 영어 "Clear · Sun alt 8° · az 245°", 일본어 "晴れ · 太陽高度 8° · 方位 245°". 고도 · 방위는 반올림한 정수, 방위는 0 이상 360 미만(−10 → 350, 360 → 0). 숫자가 아니면 그 칸은 뺀다(상태 글만 남기거나, 상태 글도 없으면 null).
 *  5. 해가 사진의 어디인가(2026-11-20, "해 근처" 비교 연결, 구현보다 먼저 박음): `sunFractionInPhoto(해 방위, 해 고도, 자세 { yawDeg, pitchDeg, rollDeg }, 센서 짧은 변 화각, 배율)` = { x, y }(사진 가로 · 세로 비율 0~1, 왼쪽 위가 0, 0) 또는 null.
 *     사진은 세로로 든 3:4(가로 3 · 세로 4)의 핀홀 그림이다. 짧은 변(가로) 화각 H, 배율 m 이면 tan(H'/2) = tan(H/2) / max(1, m) 로 좁아진다(촬영 화면의 `previewOptics` 와 같은 식).
 *     손으로 푼 값: 카메라가 해 쪽을 정확히 보면(yaw = 해 방위, pitch = 해 고도, roll 0) (0.5, 0.5). H = 60°, pitch 0, 해가 고도 0 에서 오른쪽으로 15° → x = 0.5 + tan15° / (2·tan30°) = 0.5 + 0.267949/1.154701 = 0.732051, y = 0.5.
 *     같은 H 에서 해가 방위는 같고 고도가 10° 위(pitch 0) → x = 0.5, y = 0.5 − (tan10°·fy)/4, fy = (3/2)/tan30° = 2.598076, tan10° = 0.176327 → 0.5 − 0.458106/4 = 0.385473(1e-4).
 *     배율 2 이면 tan(H'/2) = 0.288675: 오른쪽 15° → x = 0.5 + 0.267949/(2·0.288675) = 0.964102(1e-4).
 *     해가 카메라 뒤(방위 180° 차)거나 사진 밖(x 또는 y 가 0 미만 · 1 초과, 예: H 60° 에서 오른쪽 40° → x = 1.2267)이면 null. 숫자가 아닌 입력이 있어도 null. 경계(정확히 0 또는 1)는 안.
 *     한계: 롤(roll)은 자세에 넣어 투영하지만 기기 센서의 부호 약속은 이 판정이 재지 않는다(롤 0 만 잰다). 시뮬레이션 그림도 같은 시선 · 화각이라고 보고 같은 자리를 쓴다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-result-compare.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
const J = JSON.stringify;

(async () => {
  let R = null;
  try { R = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'resultCompare.js')); } catch { R = null; }
  ok(!!R && typeof R.zoneStats === 'function' && typeof R.diffLines === 'function' && typeof R.clampSplit === 'function' && typeof R.forecastLine === 'function', 'resultCompare 가 있다');
  if (!R || typeof R.zoneStats !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  console.log('\n[1] zoneStats');
  const px = (w, h, f) => { const a = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a.push(...f(i, j), 255); return a; };
  const img = px(6, 3, (i) => (i < 2 ? [200, 100, 50] : i < 4 ? [100, 100, 100] : [30, 60, 120]));
  const z = R.zoneStats(img, 6, 3);
  ok(near(z.left.lum, 0.46137, 1e-3) && near(z.left.red, 0.58824, 1e-3), `왼쪽 lum ${z.left.lum.toFixed(5)} red ${z.left.red.toFixed(5)}`);
  ok(near(z.center.lum, 0.39216, 1e-3) && near(z.center.red, 0, 1e-9), `가운데 lum ${z.center.lum.toFixed(5)}`);
  ok(near(z.right.lum, 0.22727, 1e-3) && near(z.right.red, -0.35294, 1e-3), `오른쪽 lum ${z.right.lum.toFixed(5)} red ${z.right.red.toFixed(5)}`);
  ok(z.sun === undefined, '해를 안 주면 sun 칸이 없다');
  const zs = R.zoneStats(img, 6, 3, { x: 5 / 6, y: 0.5 });   // 해 자리 x = 5, 반지름 1.2 → 열 4~5(중심 4.5, 5.5)가 안, 열 3(3.5)은 밖(거리 1.5)
  ok(near(zs.sun.lum, 0.22727, 1e-3) && near(zs.sun.red, -0.35294, 1e-3), `해 근처(오른쪽 끝) 평균 lum ${zs.sun.lum.toFixed(5)}`);
  const zm = R.zoneStats(img, 6, 3, { x: 0.5, y: 0.5 });     // 해 자리 x = 3, 반지름 1.2 → 열 2(2.5, 거리 0.5)와 열 3(3.5)이 안, 열 1 · 4(거리 1.5)는 밖
  ok(near(zm.sun.lum, 0.39216, 1e-3), `해 근처(가운데): 가운데 색만 ${zm.sun.lum.toFixed(5)}`);
  ok(R.zoneStats([1, 2, 3, 4], 2, 2) === null && R.zoneStats(img, 0, 3) === null && R.zoneStats(img, 6, 0) === null, '길이가 맞지 않거나 w · h 가 1 미만이면 null');

  console.log('\n[2] diffLines');
  const S = (lum, red) => ({ lum, red });
  const mkz = (l, c, r, s) => ({ left: l, center: c, right: r, ...(s ? { sun: s } : {}) });
  const same = mkz(S(0.4, 0.1), S(0.4, 0.1), S(0.4, 0.1));
  ok(J(R.diffLines(same, same, 'ko')) === J(['예측과 비슷해요']), '차이가 없으면 "예측과 비슷해요"');
  const p1 = mkz(S(0.4, 0.1), S(0.4, 0.1), S(0.4, 0.1), S(0.30, 0.1)), s1 = mkz(S(0.4, 0.1), S(0.4, 0.1), S(0.4, 0.1), S(0.45, 0.1));
  ok(J(R.diffLines(p1, s1, 'ko')) === J(['해 근처 하늘이 예측보다 어두움']), `해 근처 −0.15: ${J(R.diffLines(p1, s1, 'ko'))}`);
  const p2 = mkz(S(0.48, 0.1), S(0.4, 0.1), S(0.4, 0.1)), s2 = mkz(S(0.40, 0.1), S(0.4, 0.1), S(0.4, 0.1));
  ok(J(R.diffLines(p2, s2, 'ko')) === J(['왼쪽 하늘이 예측보다 밝음']), '경계 0.08 포함(밝음)');
  const p3 = mkz(S(0.479, 0.1), S(0.4, 0.1), S(0.4, 0.1));
  ok(J(R.diffLines(p3, s2, 'ko')) === J(['예측과 비슷해요']), '0.079 는 비슷');
  const p4 = mkz(S(0.4, -0.05), S(0.4, 0.1), S(0.4, 0.1)), s4 = mkz(S(0.4, 0.15), S(0.4, 0.1), S(0.4, 0.1));
  ok(J(R.diffLines(p4, s4, 'ko')) === J(['왼쪽 하늘이 예측보다 덜 붉음']) && J(R.diffLines(s4, p4, 'ko')) === J(['왼쪽 하늘이 예측보다 더 붉음']), '색: 덜 붉음 · 더 붉음');
  // 크기순 최대 3 줄: 가운데 밝기 +0.30, 오른쪽 색 −0.20, 왼쪽 밝기 −0.10, 해 근처 밝기 +0.09 → 가운데 밝기, 오른쪽 색, 왼쪽 밝기(해 근처는 잘림)
  const pm = mkz(S(0.30, 0), S(0.70, 0), S(0.40, 0), S(0.49, 0)), sm = mkz(S(0.40, 0), S(0.40, 0), S(0.40, 0.20), S(0.40, 0));
  ok(J(R.diffLines(pm, sm, 'ko')) === J(['가운데 하늘이 예측보다 밝음', '오른쪽 하늘이 예측보다 덜 붉음', '왼쪽 하늘이 예측보다 어두움']), `크기순 최대 3 줄: ${J(R.diffLines(pm, sm, 'ko'))}`);
  // 같은 크기면 영역 순서 · 밝기 먼저: 왼쪽 밝기 +0.1, 왼쪽 색 +0.1, 가운데 밝기 +0.1
  const pt = mkz(S(0.5, 0.2), S(0.5, 0), S(0.4, 0)), st = mkz(S(0.4, 0.1), S(0.4, 0), S(0.4, 0));
  ok(J(R.diffLines(pt, st, 'ko')) === J(['왼쪽 하늘이 예측보다 밝음', '왼쪽 하늘이 예측보다 더 붉음', '가운데 하늘이 예측보다 밝음']), `같은 크기: 영역 순서, 밝기가 색보다 먼저: ${J(R.diffLines(pt, st, 'ko'))}`);
  ok(R.diffLines(same, same, 'en')[0] === 'Close to the prediction' && R.diffLines(same, same, 'ja')[0] === '予測に近いです', '영어 · 일본어 "비슷"');
  const o = ['ko', 'en', 'ja'].map(l => R.diffLines(p1, s1, l)[0]);
  ok(new Set(o).size === 3 && o.every(Boolean), `세 언어 줄이 서로 다르다: ${o.join(' / ')}`);

  console.log('\n[3] clampSplit');
  ok(R.clampSplit(0, 300) === 0.05 && R.clampSplit(300, 300) === 0.95 && R.clampSplit(150, 300) === 0.5 && R.clampSplit(-20, 300) === 0.05 && R.clampSplit(999, 300) === 0.95, '0.05 ~ 0.95');
  ok(R.clampSplit(10, 0) === 0.5 && R.clampSplit(NaN, 300) === 0.5 && R.clampSplit(10, NaN) === 0.5, '너비가 0 이하 · 숫자가 아니면 0.5');

  console.log('\n[4] forecastLine');
  ok(R.forecastLine('맑음', 8.2, 245.4, 'ko') === '맑음 · 해 고도 8° · 방위 245°' && R.forecastLine('Clear', 8, 245, 'en') === 'Clear · Sun alt 8° · az 245°' && R.forecastLine('晴れ', 8, 245, 'ja') === '晴れ · 太陽高度 8° · 方位 245°', '세 언어');
  ok(R.forecastLine('맑음', 8, -10, 'ko') === '맑음 · 해 고도 8° · 방위 350°' && R.forecastLine('맑음', 8, 360, 'ko') === '맑음 · 해 고도 8° · 방위 0°', '방위 0 이상 360 미만');
  ok(R.forecastLine('맑음', NaN, NaN, 'ko') === '맑음' && R.forecastLine('', 8, 245, 'ko') === '해 고도 8° · 방위 245°' && R.forecastLine('', NaN, NaN, 'ko') === null, '숫자가 아닌 칸은 뺀다, 전부 없으면 null');

  console.log('\n[5] sunFractionInPhoto');
  const att = (yaw, pitch = 0) => ({ yawDeg: yaw, pitchDeg: pitch, rollDeg: 0 });
  const c = R.sunFractionInPhoto(250, 8, att(250, 8), 60, 1);
  ok(c && near(c.x, 0.5, 1e-9) && near(c.y, 0.5, 1e-9), '해 쪽을 정확히 보면 가운데');
  const rt = R.sunFractionInPhoto(115, 0, att(100, 0), 60, 1);
  ok(rt && near(rt.x, 0.732051, 1e-5) && near(rt.y, 0.5, 1e-9), `오른쪽 15°: x ${rt && rt.x.toFixed(6)}`);
  const up = R.sunFractionInPhoto(100, 10, att(100, 0), 60, 1);
  ok(up && near(up.x, 0.5, 1e-9) && near(up.y, 0.385473, 1e-4), `위 10°: y ${up && up.y.toFixed(6)}`);
  const m2 = R.sunFractionInPhoto(115, 0, att(100, 0), 60, 2);
  ok(m2 && near(m2.x, 0.964102, 1e-4), `배율 2: x ${m2 && m2.x.toFixed(6)}`);
  ok(R.sunFractionInPhoto(280, 0, att(100, 0), 60, 1) === null, '카메라 뒤는 null');
  ok(R.sunFractionInPhoto(140, 0, att(100, 0), 60, 1) === null, '사진 밖(오른쪽 40°)은 null');
  ok(R.sunFractionInPhoto(NaN, 0, att(100, 0), 60, 1) === null && R.sunFractionInPhoto(100, 0, att(NaN, 0), 60, 1) === null && R.sunFractionInPhoto(100, 0, att(100, 0), NaN, 1) === null, '숫자가 아니면 null');
  const lt = R.sunFractionInPhoto(85, 0, att(100, 0), 60, 1);
  ok(lt && near(lt.x, 0.267949, 1e-5), `왼쪽 15°: x ${lt && lt.x.toFixed(6)}`);

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
