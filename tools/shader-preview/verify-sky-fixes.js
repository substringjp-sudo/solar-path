/**
 * 하늘/구름/연무 5개 계산 결함 수정 통합 검증 (브라우저 없음).
 * 사용: node tools/shader-preview/verify-sky-fixes.js
 *
 * 검사 항목:
 *  [1] cloudFlowShader: .x 하드코딩 및 공용 gUv0 뒤틀림 제거 · 층별 flowWispWarp / dW 가중 벡터
 *  [2] cloudGenus diffuse:4: genusBeamTransmittance 복원 · 고고도 빙정(>=6.5km) g=0.77 스케일(1.5333)
 *  [3] volumetricScene applyCloudAir: 불투명도 가중 cloudAirBaseKm · sunGap 연무 완화 · ci/cs 밀도 연동
 *  [4] volumetricScene volEvalHaze: 본체+전방 회절 이중 HG 위상함수(phFwd)
 *  [5] sunVisibility & liveScene: 시정 30~60km 확장 · hazeFromObs 해안 바닥값 · 다층 상층 차폐 beamTransmittance
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
  for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d--; if (d < 0) return false; }
  return d === 0;
};

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skyfixes-'));
  const entry = path.join(work, 'runner.ts');
  const stub = path.join(work, 'rn-stub.js');
  const bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(stub, 'module.exports = { Platform: { OS: "web" }, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };');
  fs.writeFileSync(entry, `
    import { Vector2 } from 'three';
    import { EffectComposer } from 'postprocessing';
    import { createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'))};
    import { hazeFromObs, buildLiveScene } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/liveScene.ts'))};
    import { ICE_DIFFUSE_SCALE } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudDiffuse.ts'))};
    import { aerosolOpticsFromObs } from ${JSON.stringify(path.join(ROOT, 'src/utils/sunVisibility.ts'))};
    (globalThis as any).__SKY_MOD = { Vector2, EffectComposer, createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS, hazeFromObs, buildLiveScene, ICE_DIFFUSE_SCALE, aerosolOpticsFromObs };
  `);
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=cjs', '--platform=node',
    '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"',
    '--loader:.png=empty', `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`,
    `--outfile=${bundle}`, '--log-level=warning',
  ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });
  globalThis.expo = { NativeModule: class {}, EventEmitter: class {}, SharedObject: class {} };
  require(bundle);
  const M = globalThis.__SKY_MOD;

  console.log('\n[1] · [2] · [4] createVolumetricScene 셰이더 조립(diffuse:4, flow:true) 및 균일변수');
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
    genus: true, celestial: false, flow: true, flowUv: true, precomputed: {},
  });
  vol.setOptions({ ...M.DEFAULT_VOLUMETRIC_OPTIONS, genus: true, celestial: false, flow: true, flowUv: true, diffuse: 4, macro: 1 }, false);

  const qrDate = new Date('2026-11-16T05:41:27.729Z');
  await vol.setScene({
    lat: 34.8155, lon: 137.2331, heightM: 4, az: 219.4, el: 15.2, fov: 67.3, date: qrDate,
    haze: { aod: 0.02, alpha: 1.3, g: 0.64, omega: 0.95 },
    layers: [
      { genus: 'cu', cover: 0.19, baseKm: 1.4, thicknessM: 900, band: 'low', opts: { sunGap: 0.9 } },
      { genus: null, cover: 0, baseKm: 4.5, band: 'mid' },
      { genus: 'ci', cover: 0.89, baseKm: 9.0, thicknessM: 1200, band: 'high', opts: { sunGap: 0.9, densityScale: 0.006, flowVeil: 0.9 } },
    ],
  });

  const cloudFrag = vol.debug.clouds.cloudsPass.currentMaterial.fragmentShader;
  const shadowFrag = vol.debug.clouds.shadowPass.currentMaterial.fragmentShader;
  const aerialPass = passes.find(p => (p.effects ?? []).some(e => typeof e.getFragmentShader === 'function' && e.getFragmentShader().includes('volBaseImage')));
  const aerialEffect = aerialPass.effects.find(e => typeof e.getFragmentShader === 'function' && e.getFragmentShader().includes('volBaseImage'));
  aerialPass.recompile();
  const mergedFrag = aerialPass.fullscreenMaterial.fragmentShader;

  ok(balancedBraces(cloudFrag) && balancedBraces(shadowFrag) && balancedBraces(mergedFrag), '구름·그림자·병합 대기 셰이더 중괄호 균형 및 EffectPass recompile 성공');
  ok(cloudFrag.includes('flowWispWarp') && !cloudFrag.includes('gWispMax'), '1번: flowWispWarp 레인별 분리 및 공용 gWispMax 제거');
  ok(cloudFrag.includes('gWwActive') && cloudFrag.includes('gGrainActive') && cloudFrag.includes('gDirV') && !cloudFrag.includes('step(1.01, genusGrain.x)'),
    '1번: sampleMedia 에서 .x 하드코딩 제거(활성 밀도 가중 gWwActive/gGrainActive 사용)');
  ok(cloudFrag.includes('sunIrradiance * gBeam * gMu0 * genusSunWeight(gMu0)'), '2번: diffuse:4 DIFFUSE_FIELD_GLSL 에 genusBeamTransmittance(gBeam) 복원');
  ok(cloudFrag.includes('step(vec4(6500.0), minLayerHeights)') && cloudFrag.includes(M.ICE_DIFFUSE_SCALE.toFixed(4)),
    `5번: 고고도(>=6.5km) 빙정층 Δ-Eddington 동등 스케일 ${M.ICE_DIFFUSE_SCALE.toFixed(4)} (g=0.77) 적용`);
  ok(mergedFrag.includes('phFwd') && mergedFrag.includes('gFwd'), '4번: volEvalHaze 이중 Henyey-Greenstein 전방 회절 피크 적용');

  console.log('\n[3] applyCloudAir 대표 고도(cloudAirBaseKm) 및 sunGap 동작');
  const baseKmQr = aerialEffect.uniforms.get('cloudAirBaseKm').value;
  ok(baseKmQr > 3.5 && baseKmQr < 7.5, `19% cu(1.4km) + 89% ci(9.0km) → 가중 대표 cloudAirBaseKm=${baseKmQr.toFixed(2)} km (기존 1.4 km 고정 해소)`);

  await vol.setScene({
    lat: 34.8155, lon: 137.2331, heightM: 4, az: 219.4, el: 15.2, fov: 67.3, date: qrDate,
    layers: [{ genus: 'sc', cover: 0.95, baseKm: 1.1, thicknessM: 750, band: 'low', opts: { sunGap: 0 } }],
  });
  const baseKmLowOnly = aerialEffect.uniforms.get('cloudAirBaseKm').value;
  ok(Math.abs(baseKmLowOnly - 1.1) < 0.05, `단일 저층 sc 95%(1.1km) → cloudAirBaseKm=${baseKmLowOnly.toFixed(2)} km 유지`);

  console.log('\n[5] sunVisibility 시정 60km · hazeFromObs 바닥 · 다층 beamTransmittance');
  const vis48 = M.aerosolOpticsFromObs({ visibility: 48240, humidity: 48 });
  ok(vis48 != null && Math.abs(vis48.aod - 0.1216) < 0.01, `시정 48.2km 추정 AOD=${vis48?.aod.toFixed(4)} (기존 30km 컷 null 해소)`);
  const qrHaze = M.hazeFromObs({ visibility: 48240, humidity: 48 });
  ok(qrHaze != null && qrHaze.aod >= 0.015 && qrHaze.aod <= 0.04, `청정 해안 QR 조건 hazeFromObs AOD=${qrHaze?.aod.toFixed(4)} (연무 꺼짐 해소)`);
  const dryHaze = M.hazeFromObs({ aod550: 0.03, visibility: 80000, humidity: 25 });
  ok(dryHaze === undefined, '극청정 건조 조건(AOD 0.03)은 연무 꺼짐 유지');

  const sceneStacked = M.buildLiveScene({
    lat: 37.5, lon: 127.0, heightM: 30, date: new Date('2026-10-15T03:00:00Z'),
    obs: { low: 40, mid: 85, high: 90, precipitation: 0, visibility: 22000, humidity: 65, directNormalIrradiance: 180 },
  });
  const lowLayer = sceneStacked.input.layers[0];
  ok((lowLayer?.opts?.beamTransmittance ?? 1) < 0.9, `중·상층 덮개 아래 저층 beamTransmittance 감쇠 (${lowLayer?.opts?.beamTransmittance})`);

  M.EffectComposer.prototype.addPass = origAdd;
  vol.dispose();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\npass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
