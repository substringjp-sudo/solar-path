/**
 * §165 볼륨 장면 캐시 키(`src/components/VolumetricProbe/sceneKey.ts`) 합격 판정 — esbuild 로 순수 모듈만 묶음.
 *   node tools/shader-preview/verify-scene-key.js
 *  [1] τ 구간: DNI 없음·해 5° 아래 → 'n'; τ 0.5 → '0'; 1.5 → '1'; 3 → '2'.
 *  [2] 같은 시간 버킷·같은 운량에서 DNI 가 "맑음" → "가려짐" 으로 바뀌면 키가 바뀐다(해 ≥ 5°); 해 5° 아래면 바뀌지 않는다. τ 의 해 고도는 장면 시각의 SunCalc.
 *  [3] 비 0.25 → 0.3 (ns 문턱) 키가 바뀐다; 0.1 → 0.2 는 바뀌지 않는다; 0 → 0.1 은 바뀐다.
 *  [4] 중층 덱(단면)이 0.5 km 이상 움직이면 키가 바뀐다; 운량 2 %p 차이는 바뀌지 않는다(5 % 눈금).
 *  [5] 시간 버킷·METAR 식별이 키에 남아 있고, 장면 시각이 METAR ±90 분 창을 벗어나면 키가 바뀐다.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skey-'));
  const out = path.join(outDir, 'skey.mjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/sceneKey.ts'), '--bundle', '--format=esm', '--platform=node', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
  const K = await import('file://' + out);
  const H = [110, 320, 540, 760, 990, 1460, 1950, 2470, 3010, 4200, 5570, 7180, 9160, 10360, 11780];
  const prof = (midAt) => H.map(h => (h >= midAt && h < midAt + 700 ? 85 : (h >= 1400 && h < 2000 ? 90 : 0)));
  const obs = (over = {}) => ({ low: 90, mid: 85, high: 0, total: 91, precipitation: 0.25, directNormalIrradiance: 9, profileHeightM: H, profileCoverPct: prof(2400), distance: 0, azimuthOffset: 0, ...over });
  const base = { sceneMs: Date.UTC(2026, 9, 25, 22, 27), lat: 37.4852, lon: 127.0367, elevM: 29, metarId: '', metarTimeMs: null, sample: { low: 50, mid: 40, high: 0 } };   // 해 ≈ 6.2°(SunCalc)
  const key = (o, b = {}) => K.volSceneKey({ ...base, ...b, obs: o });
  console.log('[1] τ 구간');
  ok(K.tauBucket(null) === 'n' && K.tauBucket(0.5) === '0' && K.tauBucket(1.5) === '1' && K.tauBucket(2.9) === '1' && K.tauBucket(3) === '2', 'n/0/1/2 경계');
  console.log('[2] DNI');
  ok(key(obs({ directNormalIrradiance: 9 })) !== key(obs({ directNormalIrradiance: 400 })), '해 6.25°: DNI 9 ↔ 400 → 키 다름');
  const dawn = { sceneMs: Date.UTC(2026, 9, 25, 22, 10) };   // 해 ≈ 3°(5° 아래) → τ 없음
  ok(key(obs({ directNormalIrradiance: 9 }), dawn) === key(obs({ directNormalIrradiance: 400 }), dawn), '해 5° 아래: τ 없음 → 키 같음');
  ok(key(obs({ directNormalIrradiance: undefined })) === key(obs({ directNormalIrradiance: undefined, satDirectNormalIrradiance: undefined })), 'DNI 없음 → n (같음)');
  console.log('[3] 강수 플래그');
  ok(key(obs({ precipitation: 0.25 })) !== key(obs({ precipitation: 0.3 })), '0.25 → 0.3 (ns 문턱) 키 다름');
  ok(key(obs({ precipitation: 0.1 })) === key(obs({ precipitation: 0.2 })), '0.1 → 0.2 키 같음');
  ok(key(obs({ precipitation: 0 })) !== key(obs({ precipitation: 0.1 })), '0 → 0.1 키 다름');
  console.log('[4] 덱·운량 눈금');
  ok(key(obs({ profileCoverPct: prof(2400) })) !== key(obs({ profileCoverPct: prof(3500) })), '중층 덱 2.4 → 3.5 km 키 다름');
  ok(key(obs({ mid: 85 })) === key(obs({ mid: 86 })), '중층 85 → 86 % 키 같음(5 % 눈금)');
  ok(key(obs({ mid: 85 })) !== key(obs({ mid: 90 })), '중층 85 → 90 % 키 다름');
  console.log('[5] 버킷·METAR');
  ok(key(obs(), { sceneMs: base.sceneMs + 3600000 }) !== key(obs()), '시간 버킷 +1 h 키 다름');
  ok(key(obs(), { metarId: 'RKSO@1' }) !== key(obs()), 'METAR 식별 키 다름');
  const mt = base.sceneMs - 60 * 60000;
  ok(key(obs(), { metarId: 'RKSO@1', metarTimeMs: mt }) !== key(obs(), { metarId: 'RKSO@1', metarTimeMs: mt, sceneMs: base.sceneMs + 40 * 60000 }), 'METAR 창(±90 분) 안 → 밖: 키 다름');
  console.log(`\n${pass}/${pass + fail} 통과`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
