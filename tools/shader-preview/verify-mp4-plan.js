/**
 * **MP4 인코딩 계획(`src/utils/mp4Plan.ts`)이 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요.
 * 타임랩스 사진들을 영상으로 묶을 때 쓸 영상 크기 · 비트레이트 · 시간표 · 용량 어림입니다(계획 문서 8.5 "MP4 인코더", 23-9절). 네이티브 인코더(`modules/mp4-encoder`)는 이 값을 그대로 받아 씁니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 함수 `planMp4({ srcW, srcH, frames, fps, maxLongEdge? })` → `{ width, height, bitrate, durationSec, estimatedMB, tempMB, frames, fps }` 또는 null.
 *  - **크기**: 긴 변이 `maxLongEdge`(기본 1920)를 넘으면 그 비율로 줄이고(`s = min(1, maxLongEdge ÷ 긴 변)`), 가로 · 세로를 **짝수로 내림**(H.264 가 짝수를 요구). 손계산: 4000×3000 → 1920×1440 · 3000×4000 → 1440×1920 · 1920×1080 그대로 · 1001×563 → 1000×562(늘리지 않고 짝수로만) · 6000×4000 → 1920×1280 · 1080×1920 그대로 · 4032×3024 → 1920×1440.
 *  - **비트레이트**: `round(가로 × 세로 × fps × 0.07)`(움직임이 적은 타임랩스용, 픽셀당 0.07 비트)를 [1 000 000, 20 000 000] 로 자른다. 손계산: 1920×1080@30 = 4 354 560 · 1920×1440@30 = 5 806 080 · 1920×1280@30 = 5 160 960 · 1000×562@30 = 1 180 200 · 1280×720@24 = 1 548 288 · 4096×2304@60(`maxLongEdge` 4096) = 39 636 173 → 20 000 000 으로 잘림 · 320×180@5 = 20 160 → 1 000 000 으로 올림.
 *  - **길이 · 용량**: `durationSec = frames ÷ fps`(301장 @30 → 10.0333 초), `estimatedMB = 비트레이트 × 길이 ÷ 8 ÷ 10⁶`(1920×1080@30 301장 → 5.4613 MB, 1920×1440 → 7.2818 MB, 1280×720@24 240장 → 1.9354 MB). `tempMB` = 영상용으로 줄인 사진 임시 파일 합 = `frames × 가로 × 세로 × 0.25 바이트 ÷ 10⁶`(JPEG 품질 85 ≈ 0.25 B/픽셀 어림. 1920×1080 301장 → 156.04 MB, 4000×3000 → 1920×1440 301장 → 208.05 MB, 320×180 50장 → 0.72 MB).
 *  - 거부(null): 장수가 2 미만이거나 3600 초과, fps 가 1 ~ 60 의 정수가 아님, 원본 크기가 유한한 양수가 아님(0 · 음수 · NaN), `maxLongEdge` 가 16 미만.
 * 함수 `frameTimeUs(i, fps)` = `floor(i × 10⁶ ÷ fps)`(i 번째 프레임의 표시 시각, µs). 손계산(fps 30): 1 → 33 333 · 30 → 1 000 000 · 299 → 9 966 666 · 300 → 10 000 000. i 가 음수 · 정수 아님이거나 fps 가 틀리면 NaN.
 */
const path = require('path');
const { PREVIEW } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'mp4Plan.js')).catch(() => null);
  const P = (o) => (M && M.planMp4 ? M.planMp4({ frames: 301, fps: 30, ...o }) : null);

  console.log('[1] 크기(짝수 · 긴 변 1920)');
  const dim = (sw, sh, mx) => { const r = P({ srcW: sw, srcH: sh, maxLongEdge: mx }); return r ? `${r.width}x${r.height}` : 'null'; };
  ok(dim(4000, 3000) === '1920x1440' && dim(3000, 4000) === '1440x1920' && dim(4032, 3024) === '1920x1440', '4:3 사진(가로 · 세로 · 4032×3024)');
  ok(dim(1920, 1080) === '1920x1080' && dim(1080, 1920) === '1080x1920', '이미 1920 이하면 그대로');
  ok(dim(1001, 563) === '1000x562', '1001×563 → 1000×562(늘리지 않고 짝수로만)');
  ok(dim(6000, 4000) === '1920x1280', '6000×4000 → 1920×1280');

  console.log('\n[2] 비트레이트(0.07 비트/픽셀, 1 ~ 20 Mbps)');
  const br = (sw, sh, fps, mx) => { const r = P({ srcW: sw, srcH: sh, fps, maxLongEdge: mx }); return r ? r.bitrate : null; };
  ok(br(1920, 1080, 30) === 4354560 && br(4000, 3000, 30) === 5806080 && br(6000, 4000, 30) === 5160960 && br(1001, 563, 30) === 1180200 && br(1280, 720, 24) === 1548288, '1080p 4 354 560 · 1920×1440 5 806 080 · 1920×1280 5 160 960 · 1000×562 1 180 200 · 720p@24 1 548 288');
  ok(br(4096, 2304, 60, 4096) === 20000000, '4096×2304@60 은 20 Mbps 로 잘림');
  ok(br(320, 180, 5) === 1000000, '320×180@5 는 1 Mbps 로 올림');

  console.log('\n[3] 길이 · 용량');
  const a = P({ srcW: 1920, srcH: 1080 });
  ok(!!a && near(a.durationSec, 10.0333, 1e-3) && near(a.estimatedMB, 5.4613, 1e-3) && near(a.tempMB, 156.04, 0.01), '1080p 301장@30: 10.0333 초 · 5.4613 MB · 임시 156.04 MB');
  const b = P({ srcW: 4000, srcH: 3000 });
  ok(!!b && near(b.estimatedMB, 7.2818, 1e-3) && near(b.tempMB, 208.05, 0.01), '4000×3000 → 1920×1440: 7.2818 MB · 임시 208.05 MB');
  const c = P({ srcW: 1280, srcH: 720, fps: 24, frames: 240 });
  ok(!!c && near(c.durationSec, 10, 1e-9) && near(c.estimatedMB, 1.9354, 1e-3), '720p@24 240장: 10 초 · 1.9354 MB');
  const d = P({ srcW: 320, srcH: 180, fps: 5, frames: 50 });
  ok(!!d && near(d.tempMB, 0.72, 0.001) && near(d.estimatedMB, 1.25, 1e-9), '320×180@5 50장: 임시 0.72 MB · 1.25 MB(1 Mbps 로 올림)');

  console.log('\n[4] 거부');
  ok(P({ srcW: 1920, srcH: 1080, frames: 1 }) === null && P({ srcW: 1920, srcH: 1080, frames: 3601 }) === null && P({ srcW: 1920, srcH: 1080, frames: 3600 }) !== null, '장수 2 미만 · 3600 초과는 null, 3600 은 허용');
  ok(P({ srcW: 1920, srcH: 1080, fps: 0 }) === null && P({ srcW: 1920, srcH: 1080, fps: 61 }) === null && P({ srcW: 1920, srcH: 1080, fps: 29.5 }) === null && P({ srcW: 1920, srcH: 1080, fps: 60 }) !== null && P({ srcW: 1920, srcH: 1080, fps: 1 }) !== null, 'fps 는 1 ~ 60 정수');
  ok(P({ srcW: 0, srcH: 1080 }) === null && P({ srcW: -4, srcH: 1080 }) === null && P({ srcW: NaN, srcH: 1080 }) === null && P({ srcW: 1920, srcH: Infinity }) === null, '원본 크기가 양의 유한수가 아니면 null');
  ok(P({ srcW: 1920, srcH: 1080, maxLongEdge: 8 }) === null && P({ srcW: 1920, srcH: 1080, maxLongEdge: 16 }) !== null, 'maxLongEdge 16 미만은 null');

  console.log('\n[5] 프레임 시각(µs)');
  const T = M && M.frameTimeUs;
  ok(!!T && T(1, 30) === 33333 && T(30, 30) === 1000000 && T(299, 30) === 9966666 && T(300, 30) === 10000000 && T(0, 30) === 0, 'fps 30: 1 → 33333 · 30 → 1 000 000 · 299 → 9 966 666 · 300 → 10 000 000 · 0 → 0');
  ok(!!T && Number.isNaN(T(-1, 30)) && Number.isNaN(T(1.5, 30)) && Number.isNaN(T(1, 0)), '틀린 입력은 NaN');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
