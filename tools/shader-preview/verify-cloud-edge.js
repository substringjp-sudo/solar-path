/**
 * **구름 가장자리 기본 거칠기(§26)** 판정 — 브라우저 불필요.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 잡음 타일 — 256² 주기 타일, 평균 0.5 ± 0.02, 표준편차 0.12~0.2, 이음매 없음(왼·오른 가장자리 차이 ≤ 안쪽 이웃 차이의 2 배).
 *  2. 여러 크기 — 타일을 2·4·8 배로 줄인(평균 낸) 판에도 표준편차가 남음(큰 옥타브), 원본은 이웃 차이가 있음(고운 옥타브).
 *  3. CPU 식 — 맑은 하늘(lw = 0)은 그대로, 0..1 로 자름, 세기 0 이면 그대로, 구름 속(lw = 1, n 0.5 둘레)은 1 근처.
 *  4. 셰이더 — 세포 패치처럼 흐름 문장(gCloudMask) 앞에 끼우고, 날씨 값 0 인 레인은 읽지 않으며, 층 표류를 따라감.
 *  5. 장면 — 세포 다음에 두 패스 모두 패치, 기본 세기 EDGE_ROUGH_DEFAULT, 종류 모형이 꺼지면 0.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

function build() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-edge-v-'));
  const entry = path.join(work, 'runner.ts'), bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(entry, `import * as E from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudEdge.ts'))};\n(globalThis as any).__E = E;`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', `--outfile=${bundle}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
  require(bundle);
  return globalThis.__E;
}

(() => {
  const E = build();
  const N = E.EDGE_TILE_PX, d = E.makeEdgeNoiseData();
  const at = (x, y) => d[((y + N) % N) * N + ((x + N) % N)] / 255;
  const stats = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return { m, sd: Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) }; };

  console.log('\n[1] 잡음 타일');
  const all = Array.from(d, x => x / 255), st = stats(all);
  ok(d.length === N * N, `크기 ${N}²`);
  ok(Math.abs(st.m - 0.5) <= 0.02 && st.sd >= 0.12 && st.sd <= 0.2, `평균 ${st.m.toFixed(3)} · 표준편차 ${st.sd.toFixed(3)}`);
  let seam = 0, inner = 0;
  for (let y = 0; y < N; y++) { seam += Math.abs(at(N - 1, y) - at(0, y)); inner += Math.abs(at(N / 2, y) - at(N / 2 + 1, y)); }
  ok(seam <= 2 * inner, `이음매 차이 ${(seam / N).toFixed(4)} ≤ 2 × 안쪽 ${(inner / N).toFixed(4)}`);

  console.log('\n[2] 여러 크기');
  const coarse = f => { const r = []; for (let y = 0; y < N; y += f) for (let x = 0; x < N; x += f) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += at(x + i, y + j); r.push(s / (f * f)); } return stats(r).sd; };
  const sds = [2, 4, 8].map(coarse);
  ok(sds.every(s => s > 0.05), `줄인 판 표준편차 ${sds.map(s => s.toFixed(3)).join(' · ')} > 0.05`);
  ok(inner / N > 0.002, `이웃 차이 ${(inner / N).toFixed(4)} > 0.002(고운 옥타브)`);

  console.log('\n[3] CPU 식');
  ok(E.edgeModulate(0, 0.9, 0.5) === 0, '맑은 하늘 그대로');
  ok(E.edgeModulate(0.4, 0.7, 0) === 0.4, '세기 0 이면 그대로');
  ok(E.edgeModulate(0.99, 1, 0.8) === 1 && E.edgeModulate(0.05, 0, 0.8) === 0, '0..1 로 자름');
  ok(Math.abs(E.edgeModulate(0.4, 0.7, 0.5) - 0.5) < 1e-9, '경계 이동 = 세기 × (n − 0.5)');

  console.log('\n[4] 셰이더');
  const src = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/cloudEdge.ts'), 'utf8');
  ok(src.includes("const ANCHOR = '  vec4 gCloudMask = smoothstep(vec4(0.0), vec4(1.5 / 255.0), localWeather);';"), '흐름 문장 앞에 끼움');
  ok((src.match(/if \(localWeather\.[xyzw] > 0\.0\) eN\.[xyzw] = textureLod\(noiseTile/g) || []).length === 4, '날씨 값 0 인 레인은 읽지 않음(4 레인)');
  ok((src.match(/genusDriftKmU\.[xyzw], genusDriftKmV\.[xyzw]/g) || []).length === 4, '층 표류를 따라감');
  ok(/step\(vec4\(1e-6\), localWeather\)/.test(src), '맑은 하늘은 그대로(셰이더)');

  console.log('\n[5] 장면');
  const scene = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'), 'utf8');
  const iCell = scene.indexOf('patchCellShader(clouds.shadowPass'), iEdge = scene.indexOf('patchEdgeShader(clouds.cloudsPass');
  ok(iCell > 0 && iEdge > iCell && scene.includes('patchEdgeShader(clouds.shadowPass'), '세포 다음, 두 패스 모두');
  ok(/edgeRough: EDGE_ROUGH_DEFAULT/.test(scene), '기본 세기 EDGE_ROUGH_DEFAULT');
  ok(/setEdgeRough\(m as never, opt\.genus \? opt\.edgeRough : 0\)/.test(scene), '종류 모형이 꺼지면 0');

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
