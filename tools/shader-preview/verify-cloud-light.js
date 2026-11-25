/**
 * **구름 빛이 고도 문턱 · 하드코딩 없이 물리 계산으로 정해지는가** — 판정(계획 문서 §25). 브라우저 불필요.
 *
 * 배경(§25): 해 뜰 무렵 앱 구름이 고른 주황이던 원인은 "붉은 가장자리 빛"(해 쪽 두께로 거의 줄지 않는 붉은 직사광 0.14 배)과
 * 하늘빛까지 해 색으로 곱하던 노을색 곱하기였다. 그 아래에는 takram 해 쪽 행진이 550 m 밖에 걷지 않는 문제(구름층을 빠져나가지 못함)와
 * 조각구름 그늘의 하늘빛 경험식(몬테카를로 대비 0.06~0.28 배)이 있었다.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 하드코딩 제거 — 셰이더 패치에 붉은 가장자리 항(gRim)이 없고, 노을색(gWarmChroma)은 직사광 몫(gSunPart)에만 곱한다.
 *  2. 다른 패치의 앵커 보존 — takram 해 직사광 줄(얼음 무리 ICE_RAD · T_sun I-2 앵커)이 원문 그대로 남는다.
 *  3. 해 쪽 추적 — 기하급수(1.6 배) N 걸음의 합이 꼭대기까지 거리와 같다(N = 6 · 8, 거리 0.5 · 6 · 30 km, 상대 오차 1e-9).
 *  4. 판 확산 비중 — 운량 ≤ 0.6 → 0, ≥ 0.95 → 1, 그 사이 단조 증가.
 *  5. 그늘 하늘빛 — 두-흐름 확산 투과 + 충돌 전 항 근사가 몬테카를로(판, g 0.85, 구름 밑에서 천정 휘도, 평면 조도 1)의 0.3~1.5 배 안
 *     (τ 3 · 10 · 20 · 40; 몬테카를로 값은 scratchpad mc2.py 광자 20만 결과를 적어 둠). 그리고 단위: takram skyIrradiance 는 평면 조도 × 2π
 *     (GetSunAndSkyScalarIrradiance) 이므로 셰이더 계수는 1/(2π)² 이어야 한다(§25.6 — 1/2π 하나만 두어 2π 배 밝았음).
 *  6. 셰이더 — genusMarchSun(꼭대기까지) 이 있고, 켜지면 그림자 지도 자기 그늘을 끄며, 가벼운 날씨 읽기(gLite)가 결 비틀기 · 세포만 건너뛰고
 *     일찍 멈추기 두께가 24 다.
 *  7. 장면 연결 — cloudLight 기본 'physical', 켜지면 takram 해 쪽 행진 0 걸음, 빛줄기가 꺼진 품질에서 그림자 지도 패스 건너뜀, 끌기 중 6 걸음.
 *     그늘 하늘빛(skyPhys) 켬(§25.6 단위 고친 뒤).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

function build() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-light-v-'));
  const entry = path.join(work, 'runner.ts'), stub = path.join(work, 'rn-stub.js'), bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(stub, 'module.exports = { Platform: { OS: "web" }, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };');
  fs.writeFileSync(entry, `import * as G from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'))};
    (globalThis as any).__G = G;`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--loader:.png=empty',
    `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`, `--outfile=${bundle}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
  globalThis.expo = { NativeModule: class {}, EventEmitter: class {}, SharedObject: class {} };
  require(bundle);
  return globalThis.__G;
}

(() => {
  const G = build();
  const genus = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'), 'utf8');
  const scene = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'), 'utf8');

  console.log('\n[1] 하드코딩 제거 · [2] 앵커 보존');
  ok(!/float gRim\b|0\.14 \* gRim/.test(genus), '붉은 가장자리 항(gRim) 없음');
  ok(/radiance \+= gSunPart \* \(gWarmChroma - vec3\(1\.0\)\);/.test(genus) && !/radiance \*= mix\(vec3\(1\.0\), gWarmChroma/.test(genus), '노을색은 직사광 몫에만(하늘빛에는 곱하지 않음)');
  ok(genus.includes("src.replace(sunLine, sunLine + '\\n      vec3 gSunPart = radiance;')") && !/opticalDepth \* dbg/.test(genus), '해 직사광 줄 원문 유지(ICE_RAD · T_sun I-2 앵커)');
  ok(!/\bdbg[A-Z]\w*/.test(genus), '진단 균일변수(dbg*) 없음');

  console.log('\n[3] 해 쪽 추적 걸음');
  {
    let bad = 0;
    for (const n of [6, 8]) for (const d of [500, 6000, 30000]) {
      const s0 = G.sunMarchFirstStep(d, n); let sum = 0, st = s0;
      for (let i = 0; i < n; i++) { sum += st; st *= 1.6; }
      if (Math.abs(sum - d) / d > 1e-9) bad++;
    }
    ok(bad === 0, `N 걸음 합 = 꼭대기까지 거리 (어긋남 ${bad})`);
  }

  console.log('\n[4] 판 확산 비중');
  {
    const w = [0, 0.3, 0.6, 0.7, 0.8, 0.9, 0.95, 1].map(G.deckWeight);
    ok(w[0] === 0 && w[1] === 0 && w[2] === 0 && w[6] === 1 && w[7] === 1, `운량 ≤ 0.6 → 0, ≥ 0.95 → 1 (${w.map(x => x.toFixed(2)).join(' ')})`);
    ok(w.every((x, i) => i === 0 || x >= w[i - 1]), '단조 증가');
  }

  console.log('\n[5] 그늘 하늘빛(구름 밑에서 천정, 하늘 조도 1)');
  {
    // 몬테카를로(판, g 0.85, ω 1, 광자 20만 × 입사각 5개): scratchpad phys/mc2.py.
    const MC = { 3: 0.2278, 10: 0.1822, 20: 0.1228, 40: 0.0711 };
    let inBand = 0; const rows = [];
    for (const [t, ref] of Object.entries(MC)) {
      // 밑면(x = 1): J = E_h · [T(τ) + e^(−2(1−g)τ)] / 2π, E_h = 평면 조도 1
      const approx = (G.diffuseTransmission(+t) + Math.exp(-2 * 0.15 * +t)) / (2 * Math.PI);
      const r = approx / ref;
      if (r >= 0.3 && r <= 1.5) inBand++;
      rows.push(`τ${t} ${r.toFixed(2)}`);
    }
    ok(inBand === 4, `근사/몬테카를로 ∈ [0.3, 1.5]: ${rows.join(' · ')}`);
    const k = (1 / (2 * Math.PI)) ** 2;
    const m = genus.match(/float gSkyPhys = \(.*\) \* \$\{\(INV_2PI \* INV_2PI\)\.toFixed\(6\)\}/);
    ok(!!m, `단위: 셰이더 계수 1/(2π)² = ${k.toFixed(6)} (takram 하늘 조도 = 평면 × 2π)`);
  }

  console.log('\n[6] 셰이더');
  ok(/float genusMarchSun\(/.test(genus) && /dTop = clamp\(\(maxHeight - h0\) \/ mu/.test(genus), '꼭대기까지 기하로 정한 해 쪽 추적');
  ok(/if \(height < shadowTopHeight && genusSunTopN < 0\.5\)/.test(genus), '켜지면 그림자 지도 자기 그늘 끔');
  ok(/gWispFade0 = \(1\.0 - smoothstep\(3500\.0, 15000\.0, gFoot0\)\) \* \(1\.0 - gLite\)/.test(genus) && /dot\(cellAmp, vec4\(1\.0\)\) > 0\.0 && gLite < 0\.5/.test(genus), '가벼운 읽기: 결 비틀기 · 세포만 건너뜀');
  ok(!/genusLifeW <= 0\.0 \|\| gLite|genusSheetOn > 0\.5 && gLite/.test(genus), '생애 섞기 · 둘째 무늬판은 건너뛰지 않음(모양을 정함)');
  ok(G.SUN_MARCH_EARLY_TAU === 24, '일찍 멈추기 두께 24');

  console.log('\n[7] 장면 연결');
  ok(/cloudLight: 'physical'/.test(scene), "기본 cloudLight 'physical'");
  ok(/if \(physLight\(\)\) \{ clouds\.clouds\.maxIterationCountToSun = 0; return; \}/.test(scene), '켜지면 takram 해 쪽 행진 0 걸음');
  ok(/if \(!\(physLight\(\) && !clouds\.lightShafts\)\) orig\(r, f, d\)/.test(scene), '빛줄기가 꺼지면 그림자 지도 패스 건너뜀');
  ok(/sunTopN: isInteracting \? 6 : 8/.test(scene), '끌기 중 6 걸음, 평소 8 걸음');
  ok(/skyPhys: true, deck: true/.test(scene), '그늘 하늘빛 켬(§25.6 단위 고친 뒤)');

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
