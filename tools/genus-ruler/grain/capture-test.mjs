#!/usr/bin/env node
/**
 * capture-test.mjs — RULER-grain 하네스 캡처의 순수 함수·글자 사본 시험(브라우저 없음).
 *   node --experimental-strip-types --no-warnings tools/genus-ruler/grain/capture-test.mjs
 * 대조: takram bayer.ts·cloudsResolve.frag·CloudsMaterial.ts(Bayer 표·오프셋), SceneComposer.ts(잡음 제거·캣멀롬 GLSL 글자),
 * volumetricScene.ts(백색 잡음 LCG·옵션 기본값), takram 셰이더 원문(비용 변형 앵커), uniforms.ts(층 균일변수 재포장 이름).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const C = await import(path.join(HERE, 'capture-core.ts'));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, info); } };

// 1. Bayer 표 = takram bayer.ts
const bayerTs = read('node_modules/@takram/three-clouds/src/bayer.ts');
const tk = bayerTs.match(/bayerIndices: readonly number\[\] = \[([\s\S]*?)\]/)[1].split(',').map(s => +s.trim()).filter(Number.isFinite);
ok('bayer = takram bayerIndices', JSON.stringify(tk) === JSON.stringify(C.BAYER), JSON.stringify(tk));
// 2. 해석 셰이더 표 bayerIndices[x][y] (GLSL ivec4[4], 열 = x) 와 bayerPos 가 같은 자리
const res = read('node_modules/@takram/three-clouds/src/shaders/cloudsResolve.frag');
const rows = [...res.match(/const ivec4\[4\] bayerIndices = ivec4\[4\]\(([\s\S]*?)\);/)[1].matchAll(/ivec4\(([^)]*)\)/g)].map(m => m[1].split(',').map(Number));
let gl = true;
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { const v = rows[x][y]; const [bx, by] = C.bayerPos(v); if (bx !== x || by !== y) gl = false; }
ok('bayerPos = cloudsResolve bayerIndices[x%4][y%4]', gl);
// 3. CloudsMaterial 의 오프셋(bayerOffsets[frame]) 이 같은 텍셀 가운데
for (let v = 0; v < 16; v++) {
  let i = -1; for (let k = 0; k < 16; k++) if (tk[k] === v) i = k;
  const off = [((i % 4) + 0.5) / 4, (Math.floor(i / 4) + 0.5) / 4], [bx, by] = C.bayerPos(v);
  ok('bayerOffsets ' + v, Math.abs(off[0] - (bx + 0.5) / 4) < 1e-12 && Math.abs(off[1] - (by + 0.5) / 4) < 1e-12);
}
ok('CloudsMaterial uses bayerOffsets[frame]', /bayerOffsets\[frame\]/.test(read('node_modules/@takram/three-clouds/src/CloudsMaterial.ts')));
// 4. 반정밀도: 정수 ≤ 2048 정확, 왕복 상대 오차 ≤ 2^-11
const lut = C.halfLut();
let intOk = true; for (let n = 0; n <= 2048; n++) if (lut[C.toHalf(n)] !== n) intOk = false;
ok('half: integers 0..2048 exact', intOk);
let worst = 0; for (let k = 0; k < 20000; k++) { const x = Math.exp((Math.random() - 0.5) * 16); const y = lut[C.toHalf(x)]; worst = Math.max(worst, Math.abs(y - x) / x); }
ok('half: round trip rel err ≤ 2^-11 (정규 범위)', worst <= 2 ** -11 + 1e-9, worst);
ok('half: 1500.5 → 1500 (짝수 반올림)', lut[C.toHalf(1500.5)] === 1500);
ok('half: NaN 유지', Number.isNaN(lut[C.toHalf(NaN)]));
// 5. scatterQuarter: 16 프레임에 텍셀마다 정확히 1 표본, 자리가 맞음
{
  const cw = 13, ch = 10, lw = Math.ceil(cw / 4), lh = Math.ceil(ch / 4), nT = cw * ch;
  const sY = new Float64Array(nT), sY2 = new Float64Array(nT), sA = new Float64Array(nT), sA2 = new Float64Array(nT), n = new Uint16Array(nT);
  let placeOk = true;
  for (let f = 1; f <= 16; f++) {
    const px = new Float32Array(lw * lh * 4), [bx, by] = C.bayerPos(f % 16);
    for (let Y = 0; Y < lh; Y++) for (let X = 0; X < lw; X++) { const i = (Y * lw + X) * 4, x = 4 * X + bx, y = 4 * Y + by; px[i] = x + 100 * y; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0.5; }
    const before = Float64Array.from(sY);
    C.scatterQuarter(px, lw, lh, f, cw, ch, sY, sY2, sA, sA2, n);
    for (let j = 0; j < nT; j++) if (sY[j] !== before[j]) { const x = j % cw, y = Math.floor(j / cw); if (Math.abs((sY[j] - before[j]) - 0.2126 * (x + 100 * y)) > 1e-3) placeOk = false; }
  }
  ok('scatter: 16 frames → every texel exactly 1', n.every(v => v === 1), Array.from(n).join(''));
  ok('scatter: sample lands on its own texel', placeOk);
}
// 6. meanStd(ddof 1) · flipRows
{
  const xs = [1, 2, 4, 7], s = xs.reduce((a, b) => a + b), s2 = xs.reduce((a, b) => a + b * b);
  const [m, sd] = C.meanStd(s, s2, 4), mm = s / 4, v = xs.reduce((a, b) => a + (b - mm) ** 2, 0) / 3;
  ok('meanStd ddof1', Math.abs(m - mm) < 1e-12 && Math.abs(sd - Math.sqrt(v)) < 1e-12);
  ok('meanStd n<2 → NaN sd', Number.isNaN(C.meanStd(3, 9, 1)[1]));
  const a = new Float32Array([1, 2, 3, 4, 5, 6]), f = C.flipRows(a, 3, 2, 1);
  ok('flipRows', JSON.stringify(Array.from(f)) === '[4,5,6,1,2,3]');
}
// 7. 백색 잡음 LCG = 앱 makeWhiteNoise3D(씨앗 12345, 1664525·1013904223, 위 8비트)
{
  const vs = read('src/components/VolumetricProbe/volumetricScene.ts');
  const body = vs.match(/function makeWhiteNoise3D\(\)[\s\S]*?\n}/)[0];
  ok('app LCG constants', /let s = 12345;/.test(body) && /s = \(s \* 1664525 \+ 1013904223\) >>> 0; data\[i\] = s >>> 24;/.test(body));
  const d = new Uint8Array(1000); C.fillWhiteNoise(d, 12345);
  let s = 12345, same = true; for (let i = 0; i < 1000; i++) { s = (s * 1664525 + 1013904223) >>> 0; if (d[i] !== s >>> 24) same = false; }
  ok('fillWhiteNoise(12345) = app texture', same);
  const e = new Uint8Array(1000); C.fillWhiteNoise(e, 777);
  ok('fillWhiteNoise(777) differs', e.some((v, i) => v !== d[i]));
}
// 8. 층화 오프셋: ss 4·res 0.5 → 캔버스 ±0.25·±0.75(구름 텍셀 ±0.125·±0.375), 평균 0, 16 칸
{
  const o = Array.from({ length: 16 }, (_, k) => C.stratumOffset(k, 4, 0.5));
  const xs = new Set(o.map(v => v[0])), mx = o.reduce((a, v) => a + v[0], 0) / 16, my = o.reduce((a, v) => a + v[1], 0) / 16;
  ok('strata 16 distinct', new Set(o.map(v => v.join(','))).size === 16);
  ok('strata x levels', JSON.stringify([...xs].sort((a, b) => a - b)) === JSON.stringify([-0.75, -0.25, 0.25, 0.75]));
  ok('strata mean 0', Math.abs(mx) < 1e-12 && Math.abs(my) < 1e-12);
  ok('strata period ss²', JSON.stringify(C.stratumOffset(16, 4, 0.5)) === JSON.stringify(C.stratumOffset(0, 4, 0.5)));
}
// 9. 잡음 제거·캣멀롬 GLSL 사본 = SceneComposer 원문(글자 그대로)
{
  const sc = read('src/components/SkyScene3D/SceneComposer.ts'), cap = fs.readFileSync(path.join(HERE, 'capture.ts'), 'utf8');
  const lit = (src, name) => (src.match(new RegExp('(?:export )?const ' + name + ' = `([\\s\\S]*?)`;')) || [])[1];
  ok('DENOISE_GLSL copy identical', lit(sc, 'DENOISE_GLSL') != null && lit(sc, 'DENOISE_GLSL') === lit(cap, 'DENOISE_GLSL_COPY'));
  ok('CATMULL_GLSL copy identical', lit(sc, 'CATMULL_GLSL') != null && lit(sc, 'CATMULL_GLSL') === lit(cap, 'CATMULL_GLSL_COPY'));
  // 비용 변형 앵커: takram 원문(구름 패스) 안에 있어야 함(살아 있는 글자에서 정확히 1 번은 실행 때 applyCostPatch 가 throw 로 지킴)
  const frag = read('node_modules/@takram/three-clouds/src/shaders/clouds.frag') + read('node_modules/@takram/three-clouds/src/shaders/clouds.glsl');
  const costBlock = cap.slice(cap.indexOf('export const COST_PATCH'), cap.indexOf('export function applyCostPatch'));
  const anchors = [...costBlock.matchAll(/\[\s*'((?:[^'\\]|\\.)*)',\s*'(?:[^'\\]|\\.)*'\s*\]/g)].map(m => m[1].replace(/\\n/g, '\n'));
  ok('cost patch anchors parsed', anchors.length === 6, anchors.length);
  for (const a of anchors) ok('cost anchor in takram source: ' + a.slice(0, 40).replace(/\n/g, '⏎'), frag.includes(a));
  // 층 균일변수 재포장 목록 ⊆ takram uniforms.ts
  const un = read('node_modules/@takram/three-clouds/src/uniforms.ts');
  const rep = cap.match(/REPACKED_LAYER_UNIFORMS = \[([\s\S]*?)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  for (const r of rep) ok('repacked uniform exists in takram uniforms.ts: ' + r, un.includes(r));
}
// 10. entry.ts: 하네스 옵션 기본값 키 ⊆ 앱 기본값 키, 다른 값 목록(기록)
{
  const en = read('tools/genus-ruler/volsky/entry.ts'), vs = read('src/components/VolumetricProbe/volumetricScene.ts');
  const keys = s => [...s.matchAll(/(\w+):/g)].map(m => m[1]);
  const jb = keys(en.match(/JOB_BASE_OPTIONS: Partial<VolumetricOptions> = \{([\s\S]*?)\};/)[1]);
  const df = keys(vs.match(/export const DEFAULT_VOLUMETRIC_OPTIONS: VolumetricOptions = \{([\s\S]*?)\};/)[1]);
  ok('JOB_BASE_OPTIONS keys ⊆ DEFAULT_VOLUMETRIC_OPTIONS', jb.every(k => df.includes(k)), jb.filter(k => !df.includes(k)).join(','));
  ok('entry.ts grain hook guarded', /if \(job\.grain\) return runGrain\(/.test(en) && /job\.grain \? grainBaseOptions\(/.test(en) && /if \(job\.grain\) checkGrainMaterial\(/.test(en));
}
console.log(`capture-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
