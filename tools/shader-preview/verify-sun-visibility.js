/**
 * **태양 원반 가시성 물리의 순수 논리** 합격 판정(§151). 브라우저가 필요 없습니다.
 *
 * 사용: node tools/shader-preview/verify-sun-visibility.js   (esbuild 로 순수 모듈 하나만 묶어 씁니다 — stage-esm 불필요)
 *
 *  [1] Chapman 공기량 — 수직 1, 레일리 수평선 약 25~40, 에어로졸(H 1.5 km) 수평선이 레일리보다 큼, 고도가 내리면 단조 증가.
 *  [2] 원반 휘도 — 같은 연무에서 해가 낮아질수록, 같은 고도에서 AOD 가 클수록 단조 감소(투과율).
 *  [3] 원반/둘레 대비 R — 입자가 클수록(앞산란 g 큼)·AOD 클수록 작아짐. 해 쪽 단일산란 둘레빛은 T 에 안 달림(고도 불변 근사).
 *  [4] 눈부심 — 맑은 날 높은 해(원반 ≥ 1e8 cd/m²)는 1, 짙은 연무의 낮은 해(≤ 1e5)는 0.
 *  [6] 원반 색 — 고도가 내릴수록 초록·파랑이 붉은색 대비 단조 감소, 지평선에서 붉은색(g/r<0.35, b/r<0.02), 높은 맑은 해는 거의 흰색(g/r>0.9), 조대 입자(작은 α)는 덜 붉음.
 *  [5] 묻힘 — 매우 짙은 연무의 지평선 해는 distinct 0, 같은 고도의 맑은 날은 1.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunvis-'));
  const out = path.join(outDir, 'sunVisibility.mjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/utils/sunVisibility.ts'), '--bundle', '--format=esm', '--outfile=' + out], { cwd: ROOT, stdio: 'ignore' });
  const V = await import('file://' + out);
  const clean = { aod: 0.1, alpha: 1.3, g: 0.64, omega: 0.95 };
  const hazy = { aod: 0.6, alpha: 1.3, g: 0.64, omega: 0.94 };
  const heavy = { aod: 1.5, alpha: 1.2, g: 0.66, omega: 0.94 };
  const dust = { aod: 0.9, alpha: 0.4, g: 0.8, omega: 0.98 };

  console.log('[1] Chapman 공기량');
  ok(Math.abs(V.chapmanAirmass(8.4, 90) - 1) < 0.01, '수직 공기량 1');
  const mR0 = V.chapmanAirmass(8.4, 0), mA0 = V.chapmanAirmass(1.5, 0);
  ok(mR0 > 20 && mR0 < 45, `레일리 수평선 ${mR0.toFixed(1)} 가 20~45`);
  ok(mA0 > mR0, `에어로졸 수평선 ${mA0.toFixed(1)} > 레일리 ${mR0.toFixed(1)}`);
  let mono = true, prev = 0;
  for (const h of [90, 60, 30, 15, 8, 4, 2, 1, 0]) { const m = V.chapmanAirmass(1.5, h); if (m < prev) mono = false; prev = m; }
  ok(mono, '고도가 내릴수록 공기량 단조 증가');

  console.log('[2] 원반 휘도');
  let dec = true; let pl = Infinity;
  for (const h of [60, 30, 15, 8, 4, 2, 1, 0.5]) { const L = V.sunVisibility(h, 40, hazy).discLum; if (!(L < pl)) dec = false; pl = L; }
  ok(dec, '연무에서 해가 낮을수록 휘도 감소');
  ok(V.sunVisibility(15, 40, heavy).discLum < V.sunVisibility(15, 40, hazy).discLum && V.sunVisibility(15, 40, hazy).discLum < V.sunVisibility(15, 40, clean).discLum, '같은 고도에서 AOD 클수록 휘도 감소');

  console.log('[3] 원반/둘레 대비');
  ok(V.sunVisibility(30, 40, dust).contrast < V.sunVisibility(30, 40, hazy).contrast, '큰 입자(앞산란)일수록 대비 작음');
  ok(V.sunVisibility(30, 40, heavy).contrast < V.sunVisibility(30, 40, clean).contrast, 'AOD 클수록 대비 작음');

  console.log('[4] 눈부심');
  ok(V.sunVisibility(40, 40, clean).dazzle > 0.99, '맑은 날 높은 해 = 눈부심 1');
  ok(V.sunVisibility(4, 40, heavy).dazzle < 0.01, '짙은 연무 낮은 해 = 눈부심 0');

  console.log('[5] 묻힘');
  ok(V.sunVisibility(2, 40, heavy).distinct < 0.01, '짙은 연무 낮은 해는 둘레에 묻힘');
  ok(V.sunVisibility(2, 40, clean).distinct > 0.99, '같은 고도 맑은 날은 뚜렷');
  console.log('[6] 원반 색(분광 모형)');
  let cm = true, pg = 2;
  for (const h of [90, 60, 30, 15, 8, 4, 2, 1, 0.5]) { const c = V.sunVisibility(h, 40, hazy).rgb; if (!(c.g <= pg + 1e-9)) cm = false; pg = c.g; }
  ok(cm, '해가 낮을수록 초록/빨강 단조 감소(연무)');
  const cH = V.sunVisibility(0.5, 40, clean).rgb;
  ok(cH.r === 1 && cH.g < 0.35 && cH.b < 0.02, `맑은 날도 해가 지평선에 닿으면 붉은색 (g/r ${cH.g.toFixed(2)}, b/r ${cH.b.toFixed(3)})`);
  const cHigh = V.sunVisibility(60, 40, clean).rgb;
  ok(cHigh.g > 0.9 && cHigh.b > 0.7, `높은 맑은 해는 거의 흰색 (g/r ${cHigh.g.toFixed(2)}, b/r ${cHigh.b.toFixed(2)})`);
  ok(V.sunVisibility(4, 40, dust).rgb.g > V.sunVisibility(4, 40, hazy).rgb.g, '조대 입자(작은 Ångström α)는 같은 고도에서 덜 붉음');
  const pk = (h, a) => V.sunVisibility(h, 40, a).displayPeak;
  ok(pk(60, clean) > 10 && pk(1, clean) < 4, '눈부신 높은 해는 크게, 낮은 해는 낮은 배율(붉은 채널만 밝고 초록은 어둡게)');
  console.log(`\n${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
