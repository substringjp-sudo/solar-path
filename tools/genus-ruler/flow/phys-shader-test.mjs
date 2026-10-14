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
import { patchGenusShader as patchNew, setGenusPhysics, setGenusLightFloors, applyGenusFloors, setGenusDiffuse } from '${SRC}/cloudGenus';
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
// §137 — 레인이 실제로 쓰일 때만 삽입 · 끌 때 균일변수 제거 · 바닥값 치환 · 조합
{
  const [mc, ms] = mk();
  for (const m of [mc, ms]) { patchNew(m as never); patchFlowNew(m as never); }
  const base = mc.fragmentShader, baseShadow = ms.fragmentShader;
  const unameCount = () => Object.keys(mc.uniforms).length;
  const u0 = unameCount();
  setGenusPhysics(mc as never, [{ halo: 0, powder: 1 }, null, { halo: 0, powder: 1 }], true);   // 켰지만 쓰이는 레인 없음(물 구름만)
  r.inactiveLanesIdentical = mc.fragmentShader === base && unameCount() === u0 && !('genusPhysOn' in mc.uniforms);
  setGenusPhysics(mc as never, [{ halo: 0, powder: 0.3 }], true);                                // 가루만 줄인 레인도 '쓰임'
  r.powderOnlyInjected = mc.fragmentShader.includes('genusPhysOn > 0.5') && 'genusPhysOn' in mc.uniforms;
  setGenusPhysics(mc as never, [{ halo: 0.5, powder: 1 }], true);
  const haloText = mc.fragmentShader;
  r.haloOnlyInjected = haloText.includes('genusHaloPhase') && (mc.uniforms.genusPowderW.value as { x: number }).x === 1;
  setGenusPhysics(mc as never, [], true);                                                         // 레인이 사라지면(물 장면으로) 원문 + 균일변수 제거
  r.restoredAndUniformsRemoved = mc.fragmentShader === base && unameCount() === u0;
  // 바닥값
  const fl = applyGenusFloors(base, [0, 0]);
  const dd = (a: string, b: string) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++; return n; };
  r.floorsReplaced = fl !== base && fl.includes('max(vec4(0.0), exp(-genusAO * weather.depth))') && fl.includes('max(vec4(0.0), exp(-0.035 * gTau))') && base.length - fl.length === 2 && !base.includes('max(vec4(0.0), exp(-genusAO');
  r.floorsDefaultIdentical = applyGenusFloors(base, null) === base;
  r.floorsHalf = applyGenusFloors(base, [0.175, 0.14]).includes('max(vec4(0.175), exp(-genusAO') && applyGenusFloors(base, [0.175, 0.14]).includes('max(vec4(0.14), exp(-0.035');
  setGenusLightFloors(mc as never, [0, 0]); setGenusLightFloors(ms as never, [0, 0]);
  r.floorsCloudsApplied = mc.fragmentShader === fl;
  r.floorsShadowUntouched = ms.fragmentShader === baseShadow;
  setGenusPhysics(mc as never, [{ halo: 0.5, powder: 1 }], true);                                // 얼음 + 바닥값 동시
  r.iceAndFloors = mc.fragmentShader.includes('genusHaloPhase') && mc.fragmentShader.includes('max(vec4(0.0), exp(-genusAO');
  setGenusLightFloors(mc as never, null);                                                         // 바닥값만 끔 → 얼음은 남음
  r.floorsOffIceStays = mc.fragmentShader === haloText;
  setGenusPhysics(mc as never, [], false);
  r.allOffRestored = mc.fragmentShader === base && unameCount() === u0;
  // §138 확산광 후보 — 켤 때만 삽입, 끄면 원문, 그림자 패스 불변, 균일변수 수 불변
  setGenusDiffuse(mc as never, 0); setGenusDiffuse(ms as never, 0);
  r.diffOffIdentical = mc.fragmentShader === base && ms.fragmentShader === baseShadow;
  setGenusDiffuse(mc as never, 1); setGenusDiffuse(ms as never, 1);
  r.diff1 = mc.fragmentShader.includes('§138 L1') && mc.fragmentShader.includes('vec4 gTau = vec4(opticalDepth *') && !mc.fragmentShader.includes('weather.heightFraction, vec4(0.0)) * gLayerH') && ms.fragmentShader === baseShadow && unameCount() === u0;
  setGenusDiffuse(mc as never, 2); setGenusDiffuse(ms as never, 2);
  const t2 = mc.fragmentShader;
  r.diff2 = t2.includes('genusDiffuseField(') && t2.includes('§138 L2') && !t2.includes('gMultiScat') && !t2.includes('max(vec4(0.28)') && t2.includes('max(vec4(0.35), exp(-genusAO') && t2.split('float genusDiffuseField(').length === 2 && ms.fragmentShader === baseShadow && unameCount() === u0;
  setGenusDiffuse(mc as never, 3);
  const t3 = mc.fragmentShader;
  r.diff3 = t3.includes('§138 L3') && !t3.includes('max(vec4(0.35), exp(-genusAO') && t3.includes('genusDiffuseField(');
  setGenusLightFloors(mc as never, [0, 0]);                                                      // L3 + 바닥값: 앵커가 없어 바닥값은 조용히 무시
  r.diff3FloorsIgnored = mc.fragmentShader === t3;
  setGenusLightFloors(mc as never, null);
  setGenusPhysics(mc as never, [{ halo: 0.5, powder: 1 }], true);                                // L3 + 얼음 동시
  r.diff3Ice = mc.fragmentShader.includes('genusHaloPhase') && mc.fragmentShader.includes('§138 L3');
  setGenusPhysics(mc as never, [], false); setGenusDiffuse(mc as never, 0);
  r.diffAllOffRestored = mc.fragmentShader === base && unameCount() === u0;
  // GLSL 괄호 균형(컴파일 전 1차 검사)
  const bal = (t) => { let d = 0; for (const c of t) { if (c === '{') d++; else if (c === '}') d--; if (d < 0) return false; } return d === 0; };
  r.diffBraces = bal(t2) && bal(t3);
}
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
check('켰지만 쓰이는 레인이 없으면(물 구름만) 셰이더·균일변수가 끈 것과 같음', r.inactiveLanesIdentical);
check('가루만 줄인 레인도 삽입', r.powderOnlyInjected);
check('무리만 레인: 삽입, 가루 무게 1', r.haloOnlyInjected);
check('레인이 사라지면 원문 복귀 + 균일변수 제거(상태 해시가 처음 만든 장면과 같도록)', r.restoredAndUniformsRemoved);
check('바닥값 치환: 두 literal 만 바뀜(글자 수 −2), 기본 null 은 그대로, 반값도 됨', r.floorsReplaced && r.floorsDefaultIdentical && r.floorsHalf);
check('바닥값: 구름 패스에만 적용, 그림자 패스는 그대로', r.floorsCloudsApplied && r.floorsShadowUntouched);
check('얼음 + 바닥값 동시 · 바닥값만 끄면 얼음 유지 · 전부 끄면 원문', r.iceAndFloors && r.floorsOffIceStays && r.allOffRestored);
check('§138 확산광 0: 원문', r.diffOffIdentical);
check('§138 L1: τ_up 줄만 기둥 τ 로 바뀜, 그림자 패스·균일변수 수 불변', r.diff1);
check('§138 L2: thru 블록이 두-흐름으로 교체(바닥값 0.28 없음, 하늘빛 줄 그대로), 함수 한 번만 삽입', r.diff2);
check('§138 L3: 하늘빛 줄이 기둥 τ 감쇠로', r.diff3);
check('§138 L3 + 바닥값 치환은 무시 · L3 + 얼음 동시 · 전부 끄면 원문·균일변수 수', r.diff3FloorsIgnored && r.diff3Ice && r.diffAllOffRestored);
check('§138 L2·L3 중괄호 균형', r.diffBraces);
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
