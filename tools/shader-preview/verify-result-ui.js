/**
 * **촬영 결과 비교 화면의 이음새(소스 검사)** — `ResultCompare` · `imageZones` · `SunCamera` · `PostDetailModal`. 브라우저 · 네트워크 불필요.
 * 계산은 `verify-result-compare.js` 가 잰다. 카메라와 Skia 는 실기기에서만 돌아 여기서는 연결이 끊기지 않았는지만 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20)
 *  1. `ResultCompare`: 방식 셋(반씩 · 겹침 · 위아래)을 탭으로 고른다(처음은 반씩). 반씩은 손잡이 위치를 `clampSplit` 으로 자른 비율로 사진을 잘라 보이고, 겹침은 예측을 사진 위에 투명도 0.5 로, 위아래는 사진 위 · 예측 아래.
 *  2. 차이 짚기: 두 그림을 `readSmallRgba` 로 작게 읽어 `zoneStats` → `diffLines` 로 줄을 만든다. 하나라도 못 읽으면 줄만 빠지고 화면은 그대로다(비교 그림은 보인다). 그림이 바뀌면 다시 계산하고, 사라진 뒤 늦게 온 결과는 버린다(`alive`).
 *  3. 예측 그림이 없으면 사진과 `missing`(왜 없는지 안내)을 보이고 비교 방식은 그리지 않는다(칸을 조용히 지우지 않는다).
 *  4. 그림 읽기(`imageZones`): `data:` 그림은 base64 로, 그 밖은 `fromURI` 로 읽고, 24 × 12 로 줄여 RGBA(`Unpremul`)를 돌려준다. 실패는 null.
 *  5. 촬영 직후 화면(`SunCamera`): 예전 두 장 나란히 대신 `ResultCompare` 를 쓰고, 예측이 없을 때의 안내(`simNotReady` · `simPreviewError`)와 GL 밝기 표식은 그대로 남긴다. 예보 한 줄은 `forecastLine` 으로 만든다.
 *  6. 03 기록의 사진 상세(`PostDetailModal`): 사진과 예측이 모두 있으면 `ResultCompare`, 아니면 예전 낱장 그림(사진만 · 예측만)을 그대로 보인다.
 *  7. "해 근처" 비교 연결(2026-11-20, 구현보다 먼저 박음): 촬영 직후(`SunCamera`)는 셔터 순간의 자세(`visionSensor`)가 있으면 `sunFractionInPhoto(해 방위, 해 고도, 자세, 센서 화각(`measuredHfov` 또는 기본값), 배율)` 로 해 자리를 구해 `capturedSunXY` 에 두고(자세를 모르면 null),
 *     `ResultCompare` 에 `sunXY` 로 넘긴다. 촬영 함수의 의존 목록에 화각과 배율이 들어 있다(낡은 값을 쓰지 않게).
 *     03 기록의 사진 상세(`PostDetailModal`)는 `deviceAzimuth` · `devicePitch` 가 숫자이고 `simulationSample` 이 있을 때만 `sunFractionInPhoto` 로 구한다(배율 1 · 롤 0). 그렇지 않으면 null.
 *     (6 번의 "둘 다 있으면 ResultCompare" 시험은 `sunXY` 를 함께 넘기도록 식만 넓혔고 기준은 그대로.)
 *
 *   node tools/shader-preview/verify-result-ui.js
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

const rc = read('src', 'components', 'ResultCompare.tsx');
const iz = read('src', 'utils', 'imageZones.ts');
const cam = read('src', 'components', 'SunCamera.tsx');
const modal = read('src', 'components', 'PostDetailModal.tsx');

console.log('[1] 방식 셋');
ok(/COMPARE_MODES: readonly CompareMode\[\] = \['split', 'overlay', 'stack'\];/.test(rc) && /useState<CompareMode>\('split'\)/.test(rc), '반씩 · 겹침 · 위아래, 처음은 반씩');
ok(/setSplit\(clampSplit\(e\.nativeEvent\.locationX, widthRef\.current\)\)/.test(rc) && /width: width \* split/.test(rc), '반씩: 손잡이 위치를 clampSplit 으로 잘라 그 비율로 사진을 보인다');
ok(/opacity: 0\.5/.test(rc) && /mode === 'overlay'/.test(rc) && /mode === 'stack'/.test(rc), '겹침 0.5, 위아래');

console.log('\n[2] 차이 짚기');
ok(/readSmallRgba\(photoUri\), readSmallRgba\(simUri\)/.test(rc) && /zoneStats\(a, ZONE_GRID\.width, ZONE_GRID\.height, sun\)/.test(rc) && /setLines\(diffLines\(za, zb, language\)\)/.test(rc), '작게 읽어 zoneStats → diffLines');
ok(/if \(!alive \|\| !a \|\| !b\) return;/.test(rc) && /return \(\) => \{ alive = false; \};/.test(rc) && /\}, \[photoUri, simUri, sunXY\?\.x, sunXY\?\.y, language\]\);/.test(rc), '못 읽으면 줄만 빠지고, 그림이 바뀌면 다시, 늦은 결과는 버린다');

console.log('\n[3] 예측이 없을 때');
ok(/!simUri \? \(\s+<View onLayout=\{onLayout\}>\s+<Image source=\{\{ uri: photoUri \}\}[^\n]*\n\s+\{missing\}/.test(rc), '사진과 missing 안내, 비교 방식은 그리지 않는다');

console.log('\n[4] 그림 읽기');
ok(/uri\.startsWith\('data:'\) \? Skia\.Data\.fromBase64\(uri\.split\(';base64,'\)\[1\] \?\? ''\) : await Skia\.Data\.fromURI\(uri\)/.test(iz) && /ZONE_GRID = \{ width: 24, height: 12 \}/.test(iz) && /AlphaType\.Unpremul/.test(iz) && /\} catch \{\s+return null;/.test(iz), 'data: 는 base64, 그 밖은 fromURI, 24 × 12 RGBA(Unpremul), 실패는 null');

console.log('\n[5] 촬영 직후 화면');
ok(/<ResultCompare\s+language=\{language\}\s+photoUri=\{previewUri\}\s+simUri=\{simPreviewUri\}/.test(cam) && /forecast=\{forecastLine\(/.test(cam), 'ResultCompare 에 사진 · 예측 · 예보 한 줄');
ok(/simNotReady/.test(cam.slice(cam.indexOf('<ResultCompare'), cam.indexOf('<ResultCompare') + 1800)) && /simPreviewError/.test(cam.slice(cam.indexOf('<ResultCompare'), cam.indexOf('<ResultCompare') + 1800)) && /GL \{simBufferMean\.toFixed\(0\)\}/.test(cam), '예측이 없을 때 안내와 GL 표식이 남아 있다');

console.log('\n[6] 사진 상세');
ok(/return pu && su \? <ResultCompare language=\{language\} photoUri=\{pu\} simUri=\{su\} sunXY=\{sunXY\} \/> : null;/.test(modal) && /return photoUri && !hasSim \? \(/.test(modal) && /return simUri && !hasPhoto \? \(/.test(modal), '둘 다 있으면 ResultCompare, 사진만 · 예측만이면 낱장 그림');

console.log('\n[7] 해 근처 연결');
ok(/setCapturedSunXY\(visionSensor\s+\? sunFractionInPhoto\(currentSunPos\.azimuth, currentSunPos\.altitude, visionSensor, measuredHfov \?\? DEFAULT_SENSOR_SHORT_FOV_DEG, currentMagnification\)\s+: null\);/.test(cam) && /sunXY=\{capturedSunXY\}/.test(cam) && /cameraSimState, measuredHfov, currentMagnification\]\);/.test(cam), '촬영 직후: 자세가 있으면 해 자리를 구해 ResultCompare 에 넘기고, 의존 목록에 화각 · 배율');
ok(/typeof photo\.deviceAzimuth === 'number' && typeof photo\.devicePitch === 'number' && smp\s+\? sunFractionInPhoto\(smp\.sunAzimuth, smp\.sunAltitude, \{ yawDeg: photo\.deviceAzimuth, pitchDeg: photo\.devicePitch, rollDeg: 0 \}, DEFAULT_SENSOR_SHORT_FOV_DEG, 1\)\s+: null;/.test(modal) && /sunXY=\{sunXY\}/.test(modal), '사진 상세: 방위 · 앙각이 숫자이고 예측 표본이 있을 때만(배율 1 · 롤 0)');

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
