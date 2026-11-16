/**
 * 박명/일몰 2D 원거리 구름 덱 · farAirShade 지구 차폐 · 4×4 Bayer 시간 업스케일 수렴 검증 (브라우저 없음).
 * 사용: node tools/shader-preview/verify-twilight-far2d.js
 *
 * 검사 항목:
 *  [1] applyFarSun: 일몰 후(sunAlt < -0.5°) 지구가 막아 centerT[3]=0 여도 farAirShade=0 유지 (회색 벽 방지) / 낮(>= +0.8°) 흐림 정상 동작
 *  [2] aerialPass 셰이더: volEvalFarLayer 2D 텍스처·거시 격자 적층, premultiplied 합성/연무 식, 중괄호·전처리기 균형, low/high 샘플러 수 <= 16
 *  [3] applyFar2DState & syncFar2DDrift: 활성 층 높은→낮은 내림차순 정렬, 마스크·얼음 플래그·farCutKm, setDate 시 정렬 슬롯 드리프트 동기화, 맑은 하늘 초기화
 *  [4] SkyScene3D.tsx: temporalUpscale 16프레임 수렴을 위해 모든 settle 지점 및 시각 변경(dateChanged)·슬라이더 해제에서 volSettleRef >= 18 확보
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS: ' + msg); }
  else { fail++; console.log('  FAIL: ' + msg); }
};

const balancedBraces = (s) => {
  let d = 0;
  for (const ch of s) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
    if (d < 0) return false;
  }
  return d === 0;
};

const balancedIfdefs = (s) => {
  let d = 0;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (/^#if\b|^#ifdef\b|^#ifndef\b/.test(t)) d++;
    else if (/^#endif\b/.test(t)) d--;
    if (d < 0) return false;
  }
  return d === 0;
};

// ShaderMaterial/EffectPass.recompile 결과가 실제로 활성(정의된 #ifdef 내)로 선언/참조한 고유 sampler 수 계산
const countActiveSamplers = (fragSrc, definesObj = {}) => {
  const has = (k) => k in definesObj && definesObj[k] !== undefined;
  const evalCond = (ex) => {
    if (ex === '0') return false;
    if (ex === 'DEPTH_PACKING == 3201') return definesObj.DEPTH_PACKING === 3201;
    if (/^defined\s*\(\s*(\w+)\s*\)$/.test(ex)) return has(ex.match(/^defined\s*\(\s*(\w+)\s*\)$/)[1]);
    if (/^!\s*defined\s*\(\s*(\w+)\s*\)$/.test(ex)) return !has(ex.match(/^!\s*defined\s*\(\s*(\w+)\s*\)$/)[1]);
    if (/defined\(/.test(ex)) {
      return ex.split('||').some(p => /!\s*defined\((\w+)\)/.test(p) ? !has(p.match(/defined\((\w+)\)/)[1]) : has(p.match(/defined\((\w+)\)/)[1]));
    }
    return true;
  };
  const stack = [{ active: true, anyTaken: true }];
  const decls = new Set();
  const body = [];
  for (const rawLine of fragSrc.split('\n')) {
    const line = rawLine.trim();
    if (/^#ifdef\s+(\w+)/.test(line)) {
      const a = stack[stack.length - 1].active && has(line.match(/^#ifdef\s+(\w+)/)[1]);
      stack.push({ active: a, anyTaken: a });
      continue;
    }
    if (/^#ifndef\s+(\w+)/.test(line)) {
      const a = stack[stack.length - 1].active && !has(line.match(/^#ifndef\s+(\w+)/)[1]);
      stack.push({ active: a, anyTaken: a });
      continue;
    }
    if (/^#if\s+(.+)/.test(line)) {
      const a = stack[stack.length - 1].active && evalCond(line.slice(3).trim());
      stack.push({ active: a, anyTaken: a });
      continue;
    }
    if (/^#elif\s+(.+)/.test(line)) {
      const top = stack[stack.length - 1];
      const parent = stack[stack.length - 2].active;
      const a = parent && !top.anyTaken && evalCond(line.slice(5).trim());
      top.active = a;
      top.anyTaken = top.anyTaken || a;
      continue;
    }
    if (/^#else\b/.test(line)) {
      const top = stack[stack.length - 1];
      const parent = stack[stack.length - 2].active;
      top.active = parent && !top.anyTaken;
      top.anyTaken = true;
      continue;
    }
    if (/^#endif\b/.test(line)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (!stack[stack.length - 1].active) continue;
    const m = line.match(/^uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler(?:2D|3D|Cube|2DArray)\s+(\w+)/);
    if (m) decls.add(m[1]);
    else if (!line.startsWith('#define') && !line.startsWith('//')) body.push(line);
  }
  const bodyStr = body.join('\n');
  const used = [...decls].filter(n => new RegExp('\\b' + n + '\\b').test(bodyStr));
  return { declared: decls.size, used: used.length, usedList: used };
};

const makeOvercastRing = (cover) => {
  const pts = [];
  for (let i = 0; i < 36; i++) {
    pts.push({ distance: 120, azimuthOffset: i * 10, cover });
    pts.push({ distance: 260, azimuthOffset: i * 10 + 5, cover });
  }
  return { low: pts, mid: pts, high: pts };
};

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-far2d-'));
  const entry = path.join(work, 'runner.ts');
  const stub = path.join(work, 'rn-stub.js');
  const bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(stub, 'module.exports = { Platform: { OS: "web" }, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };');
  fs.writeFileSync(entry, `
    import { Vector3, Vector4, Matrix4 } from 'three';
    import { EffectComposer } from 'postprocessing';
    import { createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'))};
    (globalThis as any).__TW_MOD = { Vector3, Vector4, Matrix4, EffectComposer, createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS };
  `);
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=cjs', '--platform=node',
    '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"',
    '--loader:.png=empty', `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`,
    `--outfile=${bundle}`, '--log-level=warning',
  ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });

  globalThis.expo = { NativeModule: class {}, EventEmitter: class {}, SharedObject: class {} };
  require(bundle);
  const M = globalThis.__TW_MOD;

  const W = 390, H = 584;
  const gl = { getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 };
  const renderer = {
    getSize: (v) => v.set(W, H), getDrawingBufferSize: (v) => v.set(W, H), getPixelRatio: () => 1,
    getContext: () => gl, outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1,
    capabilities: { logarithmicDepthBuffer: false, isWebGL2: true },
  };
  const passes = [];
  const origAdd = M.EffectComposer.prototype.addPass;
  M.EffectComposer.prototype.addPass = function (p, i) { passes.push(p); return origAdd.call(this, p, i); };

  const vol = await M.createVolumetricScene(renderer, W, H, {
    genus: true, celestial: false, flow: true, flowUv: true, macro: 1, farSun: true, maxRayKm: 100, precomputed: {},
  });
  vol.setOptions({
    ...M.DEFAULT_VOLUMETRIC_OPTIONS,
    genus: true, celestial: false, flow: true, flowUv: true, diffuse: 4, macro: 1, farSun: true, maxRayKm: 100,
  }, false);

  const aerialPass = passes.find(p => (p.effects ?? []).some(e => typeof e.getFragmentShader === 'function' && e.getFragmentShader().includes('volBaseImage')));
  const aerialEffect = aerialPass.effects.find(e => typeof e.getFragmentShader === 'function' && e.getFragmentShader().includes('volBaseImage'));
  const cloudMat = vol.debug.clouds.cloudsPass.currentMaterial;

  console.log('\n[1] 일몰 후 vs 낮 저고도 farAirShade 지구 차폐 방어');
  const macroRing = makeOvercastRing(0.92);
  // 2026-11-16 17:10 JST = 08:10Z (Gamagori: 해 고도 < -4°, 스크린샷 재현)
  const sunsetDate = new Date('2026-11-16T08:10:00Z');
  await vol.setScene({
    lat: 34.8155, lon: 137.2331, heightM: 4, az: 230, el: 14, fov: 67.3, date: sunsetDate,
    haze: { aod: 0.03, alpha: 1.3, g: 0.64, omega: 0.95 },
    macro: macroRing,
    layers: [
      { genus: 'cu', cover: 0.25, baseKm: 1.4, thicknessM: 900, band: 'low', opts: { windU: 18, windV: -6 } },
      { genus: 'ci', cover: 0.70, baseKm: 9.0, thicknessM: 1200, band: 'high', opts: { windU: 60, windV: 12 } },
      { genus: 'ac', cover: 0.45, baseKm: 4.2, thicknessM: 600, band: 'mid', opts: { windU: -12, windV: 24 } },
    ],
  });
  const farShadeSunset = aerialEffect.uniforms.get('farAirShade').value;
  const farInfoSunset = vol.farInfo();
  const lastSunset = vol.lastScene();
  const aerCloudShade = aerialEffect.uniforms.get('cloudAirShade').value;
  const passCloudShade = cloudMat.uniforms.cloudAirShadeC.value;
  ok(lastSunset && lastSunset.sunAltDeg < -4, `Gamagori 17:10 JST 태양 고도=${lastSunset?.sunAltDeg?.toFixed(2)}° (< -4°)`);
  ok(farInfoSunset && farInfoSunset.tAirHere === 0, `원시 지구 차단으로 farSun centerT[3]=${farInfoSunset?.tAirHere}`);
  ok(farShadeSunset === 0, `일몰 후 farAirShade=${farShadeSunset} (기존 1.0 회색 벽 결함 해소)`);
  ok(Math.abs(passCloudShade - aerCloudShade) < 1e-6, `cloudAirShadeC(${passCloudShade.toFixed(3)})가 farAirShade=1.0 에 의해 부풀지 않음`);

  // 낮 저고도 흐림(2026-11-16 16:22 JST = 07:22Z, 해 약 +2°~+3°, 일몰 전)
  const dayDate = new Date('2026-11-16T07:22:00Z');
  vol.setDate(dayDate);
  const farShadeDay = aerialEffect.uniforms.get('farAirShade').value;
  const farInfoDay = vol.farInfo();
  const lastDay = vol.lastScene();
  ok(lastDay && lastDay.sunAltDeg >= 0.8 && lastDay.sunAltDeg < 10, `낮 저고도 태양 고도=${lastDay?.sunAltDeg?.toFixed(2)}° (0.8°..10°)`);
  ok(farInfoDay && farInfoDay.tAirHere < 0.5 && farShadeDay > 0.3, `낮 흐린 하늘 farSun tAirHere=${farInfoDay?.tAirHere?.toFixed(3)} → farAirShade=${farShadeDay.toFixed(3)} (> 0.3 정상 작동)`);

  console.log('\n[2] aerialPass 셰이더 구문 · 합성식 · low/high 활성 샘플러 한도');
  for (const q of ['low', 'high']) {
    vol.setQuality(q);
    aerialPass.recompile();
    const frag = aerialPass.fullscreenMaterial.fragmentShader;
    const defs = { ...(aerialPass.fullscreenMaterial.defines ?? {}), HAS_OVERLAY: 1 };
    const samplers = countActiveSamplers(frag, defs);
    ok(balancedBraces(frag) && balancedIfdefs(frag), `${q}: 중괄호·전처리기 균형`);
    ok(samplers.used <= 16, `${q}: EffectPass(HAS_OVERLAY 포함) 사용 샘플러 ${samplers.used} <= 16 (선언 ${samplers.declared})`);
  }
  vol.setQuality('low');
  aerialPass.recompile();
  const finalFrag = aerialPass.fullscreenMaterial.fragmentShader;
  ok(/volEvalFarLayer/i.test(finalFrag) && /farWeatherTex/i.test(finalFrag) && /farMacroTex/i.test(finalFrag) && /farMacroLut/i.test(finalFrag),
    '2D 원거리 투영에 실제 날씨 타일·거시 고리 텍스처·LUT 샘플링 사용');
  ok(finalFrag.includes('outputColor.rgb = fOv.rgb + skyVis * (1.0 - accA) + accRgb * (1.0 - fOv.a)'),
    'premultiplied 2D 구름을 3D 오버레이(fOv) 뒤로 이중 alpha 곱셈 없이 정확히 합성');
  ok(finalFrag.includes('vec3 hClPart = hOv.rgb + fCloudRgb;'),
    '연무 패스 hClPart 가 이미 premultiplied 된 fCloudRgb 를 재곱셈 없이 분리');

  console.log('\n[3] 2D 원거리 층 내림차순 적층 정렬 · 마스크 · 드리프트 동기화 · 초기화');
  const bVec = aerialEffect.uniforms.get('farBaseKm').value;
  const bases = [bVec.x, bVec.y, bVec.z, bVec.w];
  ok(Math.abs(bases[0] - 9.0) < 0.05 && Math.abs(bases[1] - 4.2) < 0.05 && Math.abs(bases[2] - 1.4) < 0.05 && bases[3] < -0.5,
    `역순 입력(1.4, 9.0, 4.2) → 높은→낮은 정렬 farBaseKm=[${bases.map(n => n.toFixed(2)).join(', ')}]`);

  const iceVec = aerialEffect.uniforms.get('farIce').value;
  ok(iceVec.x === 1 && iceVec.y === 0 && iceVec.z === 0, `정렬 슬롯 빙정 플래그 farIce=[${iceVec.x}, ${iceVec.y}, ${iceVec.z}]`);

  const wMask = aerialEffect.uniforms.get('farWeatherMask').value.elements;
  const mMask = aerialEffect.uniforms.get('farMacroMask').value.elements;
  // 원래 lane: 0=cu(1.4km, low=row0), 1=ci(9.0km, high=row2), 2=ac(4.2km, mid=row1)
  // 정렬 슬롯: 0->lane1(row1/high row2), 1->lane2(row2/mid row1), 2->lane0(row0/low row0)
  ok(wMask[0 * 4 + 1] === 1 && wMask[1 * 4 + 2] === 1 && wMask[2 * 4 + 0] === 1,
    'farWeatherMask 열 0,1,2 가 정렬 슬롯의 원래 레인(1=ci, 2=ac, 0=cu) 을 정확히 가리킴');
  ok(mMask[0 * 4 + 2] === 1 && mMask[1 * 4 + 1] === 1 && mMask[2 * 4 + 0] === 1,
    'farMacroMask 열 0,1,2 가 고리 밴드(2=high, 1=mid, 0=low) 를 정확히 가리킴');

  ok(aerialEffect.uniforms.get('farWeatherOn').value === 1 && aerialEffect.uniforms.get('farMacroOn').value === 1,
    'farWeatherOn=1 · farMacroOn=1 활성');
  ok(aerialEffect.uniforms.get('farOriginKm').value.length() > 6300,
    `farOriginKm 지구 반경 좌표(${aerialEffect.uniforms.get('farOriginKm').value.length().toFixed(1)} km > 6300)`);
  ok(Math.abs(aerialEffect.uniforms.get('farCutKm').value - 100) < 0.01, 'farCutKm=100 (clouds.maxRayDistance 연동)');

  vol.setOptions({ maxRayKm: 150 }, false);
  ok(Math.abs(aerialEffect.uniforms.get('farCutKm').value - 150) < 0.01, 'setOptions(maxRayKm:150) → farCutKm=150 동적 갱신');
  vol.setOptions({ maxRayKm: 100 }, false);

  const duBefore = aerialEffect.uniforms.get('farDriftU').value.clone();
  const mduBefore = aerialEffect.uniforms.get('farMacroDriftU').value.clone();
  vol.setDate(sunsetDate, sunsetDate.getTime() / 1000 + 600);
  const duAfter = aerialEffect.uniforms.get('farDriftU').value;
  const mduAfter = aerialEffect.uniforms.get('farMacroDriftU').value;
  const gdu = cloudMat.uniforms.genusDriftU.value;
  // 정렬 슬롯 0=lane1(gdu.y), 슬롯 1=lane2(gdu.z), 슬롯 2=lane0(gdu.x)
  ok(Math.abs(duAfter.x - duBefore.x) > 1e-3 && Math.abs(mduAfter.x - mduBefore.x) > 1,
    `+600초 드리프트 후 farDriftU/farMacroDriftU 이동 (dx=${(duAfter.x - duBefore.x).toFixed(4)}, dKm=${(mduAfter.x - mduBefore.x).toFixed(2)})`);
  ok(Math.abs(duAfter.x - gdu.y) < 1e-6 && Math.abs(duAfter.y - gdu.z) < 1e-6 && Math.abs(duAfter.z - gdu.x) < 1e-6,
    'setDate 후 farDriftU 정렬 슬롯(0=ci:y, 1=ac:z, 2=cu:x) 이 cloudsPass genusDriftU 와 일치');

  // 맑은 하늘 전환 시 2D 구름 슬롯 전부 비활성(-1) 초기화
  await vol.setScene({
    lat: 34.8155, lon: 137.2331, heightM: 4, az: 230, el: 14, fov: 67.3, date: sunsetDate,
    layers: [],
  });
  ok(aerialEffect.uniforms.get('farBaseKm').value.x < -0.5, '맑은 하늘(layers:[]) 전환 시 farBaseKm.x < -0.5 로 2D 덱 비활성');

  console.log('\n[4] SkyScene3D.tsx temporalUpscale 16프레임 수렴 카운터 (volSettleRef >= 18)');
  const skySrc = fs.readFileSync(path.join(ROOT, 'src/components/SkyScene3D/SkyScene3D.tsx'), 'utf8');
  const lowSettleMatches = [...skySrc.matchAll(/volSettleRef\.current\s*=\s*(?:Math\.max\([^,]+,\s*)?(\d+)\s*\)?/g)]
    .map(m => Number(m[1]));
  ok(lowSettleMatches.length >= 8 && lowSettleMatches.every(n => n >= 18),
    `모든 volSettleRef 지정값 >= 18 (${lowSettleMatches.join(', ')})`);
  ok(/const\s+dateChanged\s*=\s*vMs\s*!==\s*lastVolDateSyncRef\.current\.vMs[\s\S]{0,400}if\s*\(dateChanged\)\s*volSettleRef\.current\s*=\s*Math\.max\(volSettleRef\.current,\s*18\)/.test(skySrc),
    '시각 이동(dateChanged) 시 volSettleRef >= 18 트리거로 4×4 Bayer 잔여 구멍 방지');
  ok(/if\s*\(!isSliding\s*&&\s*wasSliding\)[\s\S]{0,260}volSettleRef\.current\s*=\s*Math\.max\(volSettleRef\.current,\s*18\)/.test(skySrc),
    '슬라이더 해제(!isSliding && wasSliding) 시 volSettleRef >= 18 트리거');

  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\npass ${pass} / fail ${fail}`);
  if (fail > 0) process.exit(1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
