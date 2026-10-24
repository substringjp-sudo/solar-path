/**
 * §157 직달일사 → 구름 광학두께(`src/utils/dniOpticalDepth.ts`) 합격 판정. esbuild 로 순수 모듈만 묶음.
 *   node tools/shader-preview/verify-dni-depth.js
 *  [1] 맑은 하늘 DNI: 해 38° 에서 500~700 W/m², 10° 에서 250~400, 해 아래 0; AOD 가 크면 작아짐.
 *  [2] τ: DNI = 맑음 → 0; 10/24 서울(29 W/m², 해 38°, AOD 0.11) → 2.5~3.5; 300 W/m² → 0.5~1; 바닥 아래(5 W/m²) → 포화값; 해 5° 아래·DNI 없음 → null.
 *  [3] 단조: 같은 해 고도에서 DNI 가 줄수록 τ 가 늘어남.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dni-'));
  const out = path.join(outDir, 'dni.mjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/utils/dniOpticalDepth.ts'), '--bundle', '--format=esm', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
  const D = await import('file://' + out);
  console.log('[1] 맑은 하늘 DNI');
  const c38 = D.clearSkyDni(38), c10 = D.clearSkyDni(10);
  ok(c38 > 500 && c38 < 700, `해 38°: ${c38.toFixed(0)} W/m²`);
  ok(c10 > 250 && c10 < 400, `해 10°: ${c10.toFixed(0)} W/m²`);
  ok(D.clearSkyDni(-2) === 0, '해 아래 0');
  ok(D.clearSkyDni(38, 0.5) < c38 * 0.7, `AOD 0.5 에서 ${D.clearSkyDni(38, 0.5).toFixed(0)} < 0.7 × 맑음`);
  console.log('[2] τ');
  ok(D.cloudOpticalDepthFromDni(c38, 38) === 0, '맑음 → 0');
  const t = D.cloudOpticalDepthFromDni(29, 38, 0.11);
  ok(t > 2.5 && t < 3.5, `서울 10/24 DNI 29 → τ ${t.toFixed(2)}`);
  const t300 = D.cloudOpticalDepthFromDni(300, 38);
  ok(t300 > 0.5 && t300 < 1, `DNI 300 → τ ${t300.toFixed(2)} (얇은 베일, 시트 아님)`);
  ok(D.cloudOpticalDepthFromDni(5, 38) === D.DNI_TAU_SATURATED, `바닥 아래 → 포화 ${D.DNI_TAU_SATURATED}`);
  ok(D.cloudOpticalDepthFromDni(100, 3) === null && D.cloudOpticalDepthFromDni(undefined, 40) === null, '해 5° 아래·DNI 없음 → null');
  console.log('[3] 단조');
  let mono = true, prev = -1;
  for (const d of [600, 400, 200, 100, 50, 25, 10]) { const v = D.cloudOpticalDepthFromDni(d, 38); if (v < prev) mono = false; prev = v; }
  ok(mono, 'DNI 가 줄수록 τ 증가');
  console.log(`\n${pass}/${pass + fail} 통과`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
