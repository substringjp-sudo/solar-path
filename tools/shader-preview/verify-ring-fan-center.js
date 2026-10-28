/**
 * §166 `buildCloudInstances` 가 360° 고리를 **절대 방위**로 읽는지 판정 — esbuild 로 `cloudPlacement.ts` 를 묶음.
 *   node tools/shader-preview/verify-ring-fan-center.js
 *  고리(`fetchDayWeatherRing`)의 `azimuthOffset` 은 절대 방위(0 = 북)인데, 사전 계산 타임라인이 없을 때의 경로는
 *  `WeatherFan(weather, sunAzDeg)` 로 읽어 고리를 해 방위만큼 돌려 놓았습니다. 동쪽만 흐린 고리로 보면:
 *  [1] 옛 동작(중심 = 해 방위 200°, 이제는 `weatherCenterAzDeg: 200` 으로 명시해야 남): 동쪽 90° 저층 운량 ≈ 0, 서쪽 270° 에 구름(음성 대조).
 *  [2] 중심을 안 주면(기본 0) 동쪽에 구름, 서쪽은 맑음 — 고리를 넘기면서 인자를 빠뜨려도 돌아가지 않는다.
 *  [3] `weatherCenterAzDeg: 0` 명시도 같다(앱 SkyScene3D 가 넘기는 값).
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanc-'));
  const out = path.join(outDir, 'cp.mjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/SkyScene3D/cloudPlacement.ts'), '--bundle', '--format=esm', '--platform=node', '--define:__DEV__=false', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
  const M = await import('file://' + out);
  const t0 = Date.UTC(2026, 9, 26, 0, 0), tm = t0 + 10 * 3600000;
  const mk = (distance, azimuthOffset, low) => ({ distance, azimuthOffset, source: 'standard', low, mid: 0, high: 0, total: low, precipitation: 0, humidity: 60, visibility: 20000, directNormalIrradiance: 200, time: new Date(tm).toISOString().slice(0, 13) + ':00', timeMs: tm });
  const RA = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
  const ring = [mk(0, 0, 0)];
  for (const d of [10, 30, 70, 130, 200, 280, 380]) for (const a of RA) ring.push(mk(d, a, (a >= 60 && a <= 120) ? 95 : 0));   // 동쪽만 흐림
  for (const p of ring.filter(p => p.azimuthOffset === 180)) ring.push({ ...p, azimuthOffset: -180 });                       // 이음매 복사본(앱과 같음)
  const atlas = { texture: {}, rects: new Map(), keys: [], dispose() {} };   // 배치 계산은 아틀라스 내용을 안 봅니다
  const run = extra => M.buildCloudInstances({ atlas, currentTime: new Date(tm), sunAltDeg: 30, sunAzDeg: 200, atmosphere: {}, weather: ring, maxTotal: 320, ...extra });
  const cover = (r, az) => { const s = r.samples.filter(x => x.layer === 'low' && Math.abs(((x.azimuthDeg - az + 540) % 360) - 180) < 8); return s.reduce((u, x) => u + x.cover, 0) / s.length; };
  const old = run({ weatherCenterAzDeg: 200 }), fixed = run({}), explicit0 = run({ weatherCenterAzDeg: 0 });
  console.log('[1] 옛 동작 — 해 방위 200° 를 0 으로 읽음');
  ok(cover(old, 90) < 0.02 && cover(old, 270) > 0.1, `동 ${cover(old, 90).toFixed(2)} · 서 ${cover(old, 270).toFixed(2)} (구름이 반대편으로 돌아가 있다)`);
  console.log('[2] 기본값(인자 없음)');
  ok(cover(fixed, 90) > 0.1 && cover(fixed, 270) < 0.02, `동 ${cover(fixed, 90).toFixed(2)} · 서 ${cover(fixed, 270).toFixed(2)}`);
  console.log('[3] 0 명시');
  ok(Math.abs(cover(explicit0, 90) - cover(fixed, 90)) < 1e-9 && Math.abs(cover(explicit0, 270) - cover(fixed, 270)) < 1e-9, '0 을 명시해도 기본값과 같다');
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
