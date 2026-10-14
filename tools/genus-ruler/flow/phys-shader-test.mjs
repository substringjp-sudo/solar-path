#!/usr/bin/env node
/**
 * phys-shader-test.mjs — §136 "끄면 그대로"를 셰이더 글자 수준에서(GPU 없이) 확인합니다.
 *   node tools/genus-ruler/flow/phys-shader-test.mjs [--base <커밋>]      (기본 커밋 dbd7fea = §136 이전 패치)
 * takram CloudsEffect 의 구름·그림자 패스 셰이더에 (a) 기준 커밋의 patchGenusShader·patchFlowShader, (b) 지금 코드의 같은 두 패치를 걸어
 * 글자 단위로 견주고, setGenusPhysics 의 켬/끔/다시 켬을 확인합니다. 렌더로는 부동소수점 반올림 차이(삽입 코드가 죽은 가지로 있어도 화소가 몇백 개 달라짐)가
 * 보여서, 끈 상태의 셰이더 문자열이 같아야 한다는 조건을 둡니다.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const baseRef = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'dbd7fea';
const SRC = path.join(ROOT, 'src/components/VolumetricProbe');
const OUT = path.join(ROOT, '.harness/shader-id');
const OLD = path.join(OUT, 'old');
fs.mkdirSync(OLD, { recursive: true });
// 기준 커밋의 두 파일을 가져와, 형제 모듈(cloudFlow 등)은 지금 것을 절대 경로로, 서로는 old/ 안에서 참조
for (const f of ['cloudGenus.ts', 'cloudFlowShader.ts']) {
  let t = execFileSync('git', ['show', `${baseRef}:src/components/VolumetricProbe/${f}`], { cwd: ROOT, encoding: 'utf8' });
  t = t.replace(/from '\.\/(cloudGenus|cloudFlowShader)'/g, "from './$1'").replace(/from '\.\/(?!cloudGenus'|cloudFlowShader')/g, `from '${SRC}/`);
  fs.writeFileSync(path.join(OLD, f), t);
}
fs.writeFileSync(path.join(OUT, 'entry.ts'), `
import { PerspectiveCamera } from 'three';
import { CloudsEffect } from '@takram/three-clouds';
import { patchGenusShader as patchOld } from './old/cloudGenus';
import { patchFlowShader as patchFlowOld } from './old/cloudFlowShader';
import { patchGenusShader as patchNew, setGenusPhysics } from '${SRC}/cloudGenus';
import { patchFlowShader as patchFlowNew } from '${SRC}/cloudFlowShader';
type M = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
const mk = () => { const c = new CloudsEffect(new PerspectiveCamera()); return [c.cloudsPass.currentMaterial, c.shadowPass.currentMaterial] as unknown as M[]; };
const [oc, os] = mk(), [nc, ns] = mk();
for (const m of [oc, os]) { patchOld(m as never); patchFlowOld(m as never); }
for (const m of [nc, ns]) { patchNew(m as never); patchFlowNew(m as never); }
const r: Record<string, boolean | number> = {};
r.cloudsOffIdentical = oc.fragmentShader === nc.fragmentShader;
r.shadowOffIdentical = os.fragmentShader === ns.fragmentShader;
r.baseLen = nc.fragmentShader.length;
setGenusPhysics(nc as never, [], false); setGenusPhysics(ns as never, [], false);
r.cloudsOffAfterCallIdentical = oc.fragmentShader === nc.fragmentShader;
r.shadowOffAfterCallIdentical = os.fragmentShader === ns.fragmentShader;
setGenusPhysics(nc as never, [{ halo: 0.5, powder: 0 }], true); setGenusPhysics(ns as never, [{ halo: 0.5, powder: 0 }], true);
r.cloudsOnInjected = nc.fragmentShader.includes('genusHaloPhase') && nc.fragmentShader.includes('genusPhysOn > 0.5') && 'genusPhysOn' in nc.uniforms;
r.cloudsOnLenDelta = nc.fragmentShader.length - oc.fragmentShader.length;
r.shadowOnUnchanged = os.fragmentShader === ns.fragmentShader && !('genusPhysOn' in ns.uniforms);
r.haloUniformSet = (nc.uniforms.genusHalo.value as { x: number }).x === 0.5;
setGenusPhysics(nc as never, [], false);
r.cloudsRestoredAfterOff = oc.fragmentShader === nc.fragmentShader;
setGenusPhysics(nc as never, [{ halo: 0.3, powder: 1 }], true);
r.cloudsReOn = nc.fragmentShader.includes('genusHaloPhase') && (nc.uniforms.genusHalo.value as { x: number }).x === 0.3;
console.log(JSON.stringify(r));
`);
execFileSync('npx', ['esbuild', path.join(OUT, 'entry.ts'), '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', `--outfile=${path.join(OUT, 'out.cjs')}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
const r = JSON.parse(execFileSync('node', [path.join(OUT, 'out.cjs')], { encoding: 'utf8' }).trim().split('\n').pop());
const results = [];
const check = (name, ok, d) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${d ?? ''}`); };
check(`끈 구름 패스 셰이더 = ${baseRef} 과 글자 그대로`, r.cloudsOffIdentical, `${r.baseLen} 자`);
check(`끈 그림자 패스 셰이더 = ${baseRef} 과 글자 그대로`, r.shadowOffIdentical);
check('setGenusPhysics(끔) 를 불러도 그대로', r.cloudsOffAfterCallIdentical && r.shadowOffAfterCallIdentical);
check('켬: 구름 패스에만 삽입(무리·가루)·균일변수 생김', r.cloudsOnInjected && r.shadowOnUnchanged, `+${r.cloudsOnLenDelta} 자`);
check('켬: 층 무리 값이 균일변수로', r.haloUniformSet);
check('끔: 삽입 전 원문으로 복귀', r.cloudsRestoredAfterOff);
check('다시 켬: 삽입·값 갱신', r.cloudsReOn);
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
