/**
 * **MP4 네이티브 모듈(`modules/mp4-encoder`)의 이음새(소스 검사 + 컴파일 검사)** — TS 브리지 · Kotlin 모듈 · Java 인코더 · 설정. 브라우저 불필요.
 * 계산은 `verify-mp4-plan.js`. 실제 인코딩은 실기기에서만 돌아서 **여기서는 이름 · 인자 · 시각 식 · 정리 순서가 맞는지와 Java 가 안드로이드 프레임워크에 대해 컴파일되는지만** 봅니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21)
 *  1. 브리지: `requireOptionalNativeModule(...)('Mp4Encoder')`, `isMp4EncoderAvailable()` 는 모듈이 있을 때만 true, `encodeFramesToMp4Async` 는 모듈이 없으면 던진다(조용히 성공하지 않는다).
 *  2. 이름 맞춤: 브리지의 모듈 이름 · 함수 이름 · 인자 키(frames · outPath · width · height · fps · bitrate)가 Kotlin 모듈의 `Name(...)` · `AsyncFunction(...)` · `opts[...]` 와 같다. `expo-module.config.json` 이 Kotlin 클래스를 가리키고, `build.gradle` 의 namespace 가 패키지와 같다. 플랫폼은 안드로이드만.
 *  3. Kotlin: 한 번에 하나만(`busy` 를 잡고 `finally` 에서 푼다), 실패는 `promise.reject`, 인자가 빠지면 `ERR_ARGS`, `file://` 접두사를 뗀다, `Mp4FrameEncoder(width, height, fps, bitrate).encode(` 를 부른다.
 *  4. Java 인코더: 입력 Surface(`COLOR_FormatSurface` · `createInputSurface`) · H.264 · 뮤서에 쓸 때 시각을 `frameTimeUs(writtenFrames, fps)` 로 덮어씀. 시각 식은 `(index * 1_000_000L) / fps` 로 JS `frameTimeUs` 의 `floor(i × 10⁶ ÷ fps)` 와 같다(음이 아닌 정수에서 정수 나눗셈 = 내림). 코덱 설정 버퍼(`BUFFER_FLAG_CODEC_CONFIG`)는 쓰지 않고, 끝은 `signalEndOfInputStream` 뒤 `drain(true)`, `finally` 에서 코덱 · Surface · 뮤서를 정리하고 실패하면 반쪽 파일을 지운다. 크기는 짝수만(생성자 검사), fps 1 ~ 60.
 *  5. 컴파일: `tools/mp4-encoder/compile-check.sh` 가 `COMPILE OK`(안드로이드 14 프레임워크 jar 가 `/tmp/android-all-14.jar` 에 있을 때만 돌린다. 없으면 이 항목은 건너뛰고 알린다 — 실패로 세지 않음).
 *
 *   node tools/shader-preview/verify-mp4-module.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { REPO_ROOT } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const read = (...p) => { try { return fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8'); } catch { return ''; } };
const M = ['modules', 'mp4-encoder'];
const ts = read(...M, 'index.ts');
const kt = read(...M, 'android', 'src', 'main', 'java', 'com', 'pplaner', 'mp4encoder', 'Mp4EncoderModule.kt');
const java = read(...M, 'android', 'src', 'main', 'java', 'com', 'pplaner', 'mp4encoder', 'Mp4FrameEncoder.java');
const cfg = read(...M, 'expo-module.config.json');
const gradle = read(...M, 'android', 'build.gradle');
const plan = read('src', 'utils', 'mp4Plan.ts');

console.log('[1] 브리지');
ok(/requireOptionalNativeModule<[^>]+>\('Mp4Encoder'\)/.test(ts) && /return NativeMp4Encoder !== null;/.test(ts), "모듈 이름 'Mp4Encoder', 있을 때만 available");
ok(/if \(!NativeMp4Encoder\) \{\s*throw new Error\(/.test(ts) && /return NativeMp4Encoder\.encodeAsync\(opts\);/.test(ts), '모듈이 없으면 던지고, 있으면 encodeAsync 를 부른다');

console.log('\n[2] 이름 맞춤');
ok(/Name\("Mp4Encoder"\)/.test(kt) && /AsyncFunction\("encodeAsync"\)/.test(kt), 'Kotlin Name · AsyncFunction 이 브리지와 같다');
const keys = ['frames', 'outPath', 'width', 'height', 'fps', 'bitrate'];
ok(keys.every(k => new RegExp(`opts\\["${k}"\\]`).test(kt) && new RegExp(`\\b${k}: `).test(ts)), '인자 키 6 개가 브리지와 Kotlin 에 모두 있다');
ok(/"modules": \["com\.pplaner\.mp4encoder\.Mp4EncoderModule"\]/.test(cfg) && /"platforms": \["android"\]/.test(cfg) && /^package com\.pplaner\.mp4encoder$/m.test(kt) && /class Mp4EncoderModule : Module\(\)/.test(kt), '모듈 설정이 Kotlin 클래스를 가리킨다(안드로이드만)');
ok(/namespace "com\.pplaner\.mp4encoder"/.test(gradle) && /^package com\.pplaner\.mp4encoder;$/m.test(java), 'build.gradle namespace = 패키지');

console.log('\n[3] Kotlin');
ok(/busy\.compareAndSet\(false, true\)/.test(kt) && /finally \{\s*busy\.set\(false\)/.test(kt) && /ERR_BUSY/.test(kt), '한 번에 하나만: 잡고 finally 에서 푼다');
ok(/promise\.reject\("ERR_ENCODE"/.test(kt) && /promise\.reject\("ERR_ARGS"/.test(kt) && /removePrefix\("file:\/\/"\)/.test(kt) && /Mp4FrameEncoder\(width, height, fps, bitrate\)\.encode\(/.test(kt), 'ERR_ARGS · ERR_ENCODE · file:// 접두사 · 인코더 호출');

console.log('\n[4] Java 인코더');
ok(/COLOR_FormatSurface/.test(java) && /createInputSurface\(\)/.test(java) && /MIMETYPE_VIDEO_AVC/.test(java), '입력 Surface · H.264');
ok(/return \(index \* 1_000_000L\) \/ fps;/.test(java) && /info\.presentationTimeUs = frameTimeUs\(writtenFrames, fps\);/.test(java) && /Math\.floor\(\(i \* 1_000_000\) \/ fps\)/.test(plan), '시각 식이 JS 와 같고 뮤서에 쓸 때 덮어쓴다');
ok(/BUFFER_FLAG_CODEC_CONFIG\) != 0\) info\.size = 0;/.test(java), '코덱 설정 버퍼는 쓰지 않는다');
ok(/signalEndOfInputStream\(\);\s*drain\(true\);/.test(java), '끝 신호 뒤 drain(true)');
ok(/finally \{\s*release\(\);\s*if \(!ok\)/.test(java) && /out\.delete\(\)/.test(java) && /muxer\.stop\(\)/.test(java) && /inputSurface\.release\(\)/.test(java) && /codec\.release\(\)/.test(java), 'finally 에서 정리하고 실패하면 반쪽 파일을 지운다');
ok(/\(width & 1\) != 0 \|\| \(height & 1\) != 0/.test(java) && /fps < 1 \|\| fps > 60/.test(java), '크기는 짝수만 · fps 1 ~ 60');

console.log('\n[5] 컴파일');
const JAR = process.env.ANDROID_ALL_JAR || '/tmp/android-all-14.jar';
if (fs.existsSync(JAR) && fs.statSync(JAR).size > 1e6) {
  let out = '';
  try { out = execSync('sh tools/mp4-encoder/compile-check.sh', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  ok(/COMPILE OK/.test(out) && !/warning: \[|error:/.test(out), 'Java 가 안드로이드 14 프레임워크에 대해 컴파일된다(경고도 없음)');
} else {
  console.log('  SKIP: 프레임워크 jar 가 없어 컴파일 검사를 건너뜀(tools/mp4-encoder/compile-check.sh 가 내려받음)');
}

console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
