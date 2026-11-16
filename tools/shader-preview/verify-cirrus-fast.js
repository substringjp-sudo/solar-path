/**
 * 권운(ci) 계산 경량화 · METAR 불필요 2차 재계산 차단 · 비동기 빌드 토큰(volBuildSeqRef) 검증.
 * 사용: node tools/shader-preview/verify-cirrus-fast.js
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

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cirrus-fast-'));
  const entry = path.join(work, 'runner.ts');
  const stub = path.join(work, 'rn-stub.js');
  const bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(stub, 'module.exports = { Platform: { OS: "web" }, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };');
  fs.writeFileSync(entry, `
    import { EffectComposer } from 'postprocessing';
    import { effectiveVolSceneKey, volSceneKey } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/sceneKey.ts'))};
    import { makeGenusWeather, makeGenusWeatherAsync, mergeFlowOpts, planFlowScene } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'))};
    import { createVolumetricScene } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'))};
    (globalThis as any).__CF_MOD = { EffectComposer, effectiveVolSceneKey, volSceneKey, makeGenusWeather, makeGenusWeatherAsync, mergeFlowOpts, planFlowScene, createVolumetricScene };
  `);
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=cjs', '--platform=node',
    '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"',
    '--loader:.png=empty', `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`,
    `--outfile=${bundle}`, '--log-level=warning',
  ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });

  globalThis.expo = { NativeModule: class {}, EventEmitter: class {}, SharedObject: class {} };
  require(bundle);
  const M = globalThis.__CF_MOD;

  console.log('\n[1] effectiveVolSceneKey: METAR 도착 시 불필요한 재계산 방지');
  const t0 = Date.UTC(2026, 10, 16, 8, 10);
  const baseObs = {
    low: 0, mid: 0, high: 80, total: 80, precipitation: 0, humidity: 48,
    windULow: 10, windVLow: 0, windUMid: 25, windVMid: 5, windUHigh: 55, windVHigh: 12,
  };
  const metarSame = {
    icao: 'RJGG', lat: 34.85, lon: 136.8, distanceKm: 18, timeMs: t0 - 15 * 60_000,
    raw: 'CAVOK', layers: [], clearBelowM: 1500, wx: null,
  };
  const kNoMetar = M.effectiveVolSceneKey({
    sceneMs: t0, lat: 34.8155, lon: 137.2331, elevM: 4, metarId: '', metar: null, obs: baseObs, sample: { low: 0, mid: 0, high: 80 },
  });
  const kMetarClear = M.effectiveVolSceneKey({
    sceneMs: t0, lat: 34.8155, lon: 137.2331, elevM: 4, metarId: '', metar: metarSame, obs: baseObs, sample: { low: 0, mid: 0, high: 80 },
  });
  ok(kNoMetar === kMetarClear, '창(±90m) 내여도 METAR 저·중층 변화가 없으면 effectiveVolSceneKey 동일 (재계산 0회)');

  const metarChanged = {
    icao: 'RJGG', lat: 34.85, lon: 136.8, distanceKm: 18, timeMs: t0 - 15 * 60_000,
    raw: 'BKN035', layers: [{ cover: 'BKN', baseFtAgl: 3500 }], clearBelowM: null, wx: null,
  };
  const kMetarLow = M.effectiveVolSceneKey({
    sceneMs: t0, lat: 34.8155, lon: 137.2331, elevM: 4, metarId: '', metar: metarChanged, obs: baseObs, sample: { low: 0, mid: 0, high: 80 },
  });
  ok(kMetarLow !== kNoMetar, 'METAR 가 저층 BKN 75% 를 실제 관측하면 키 변경됨');

  const kOutWindow = M.effectiveVolSceneKey({
    sceneMs: t0 + 180 * 60_000, lat: 34.8155, lon: 137.2331, elevM: 4, metarId: '', metar: metarChanged, obs: baseObs, sample: { low: 0, mid: 0, high: 80 },
  });
  const kOutNoMetar = M.effectiveVolSceneKey({
    sceneMs: t0 + 180 * 60_000, lat: 34.8155, lon: 137.2331, elevM: 4, metarId: '', metar: null, obs: baseObs, sample: { low: 0, mid: 0, high: 80 },
  });
  ok(kOutWindow === kOutNoMetar, 'METAR 창(±90m) 밖 미래 시각을 볼 때는 BKN METAR 여도 키 불변');

  console.log('\n[2] cirrusField 256x256 경량화 성능 · 결정론 · 비동기 sliceMs');
  const ciLayer = M.mergeFlowOpts({
    genus: 'ci', cover: 0.72,
    opts: { windU: 60, windV: 12, shearU: 30, shearV: 10, flowN: 0.012, shearDzKm: 4, flowVeil: 0.45, flowSeed: 77 },
  });
  const flow = M.planFlowScene([ciLayer], { n: 128, steps: 20, hours: 1.5, vrms: 2.2, psiEvery: 2, qMode: 2, qN: 128, qH: 0.75, s90: 4.5 });
  const tc0 = performance.now();
  const texCold = M.makeGenusWeather([ciLayer], 256, 24, 7, [], flow);
  const coldMs = performance.now() - tc0;
  const tw0 = performance.now();
  const texWarm = M.makeGenusWeather([M.mergeFlowOpts({
    genus: 'ci', cover: 0.55,
    opts: { windU: 55, windV: 18, shearU: 25, shearV: 8, flowN: 0.013, shearDzKm: 4, flowVeil: 0.35, flowSeed: 79 },
  })], 256, 24, 7, [], flow);
  const warmMs = performance.now() - tw0;
  ok(coldMs < 150 && warmMs < 100, `ci 256x256 생성 속도: cold=${coldMs.toFixed(1)}ms, warm=${warmMs.toFixed(1)}ms`);

  let eq = texCold.image.data.length === texWarm.image.data.length;
  const texDet = M.makeGenusWeather([ciLayer], 256, 24, 7, [], flow);
  for (let i = 0; i < texCold.image.data.length && eq; i++) {
    if (texCold.image.data[i] !== texDet.image.data[i]) eq = false;
  }
  ok(eq, '결정론: 동일 ci 입력 → 256x256 바이트 100% 일치');

  let aborted = false;
  const texAsync = await M.makeGenusWeatherAsync([M.mergeFlowOpts({
    genus: 'ci', cover: 0.65,
    opts: { windU: 45, windV: 15, shearU: 20, shearV: 10, flowN: 0.012, shearDzKm: 4, flowVeil: 0.5, flowSeed: 83 },
  })], 256, 24, 7, [], 24, () => aborted, flow, 0);
  ok(texAsync != null && texAsync.image.width === 256, 'makeGenusWeatherAsync(sliceMs=24) 정상 완주');

  console.log('\n[3] volumetricScene flowLaminar 캐시 키 · SkyScene3D volBuildSeqRef/METAR 배선');
  const W = 390, H = 584;
  const renderer = {
    getSize: v => v.set(W, H), getDrawingBufferSize: v => v.set(W, H), getPixelRatio: () => 1,
    getContext: () => ({ getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 }),
    outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1,
    capabilities: { logarithmicDepthBuffer: false, isWebGL2: true },
  };
  const vol = await M.createVolumetricScene(renderer, W, H, { genus: true, celestial: false, flow: true, flowUv: true, flowVrms: 2.2, precomputed: {} });
  const ciOnlyInput = {
    lat: 34.8, lon: 137.2, heightM: 4, az: 220, el: 15, fov: 65, date: new Date('2026-11-16T08:10:00Z'),
    layers: [{ genus: 'ci', cover: 0.7, baseKm: 9, band: 'high', opts: { windU: 55, windV: 10, shearU: 30, shearV: 10 } }],
  };
  const ok24 = await vol.setSceneAsync(ciOnlyInput, false, 24);
  ok(ok24 && vol.hasCachedScene(ciOnlyInput, false) === true, 'setSceneAsync(input, false, 24) 적재 및 hasCachedScene 히트');
  vol.setOptions({ flowVrms: 3.1 }, false);
  ok(vol.hasCachedScene(ciOnlyInput, false) === true, 'flowLaminar 전용(ci 단독) 장면은 유체 핵 flowVrms 변화에 키 재분리 안 함');

  const skySrc = fs.readFileSync(path.join(ROOT, 'src/components/SkyScene3D/SkyScene3D.tsx'), 'utf8');
  ok(skySrc.includes('volBuildSeqRef') && /if\s*\(volBuildSeqRef\.current\s*===\s*myBuildSeq\)\s*volPendingRef\.current\s*=\s*false/.test(skySrc),
    'SkyScene3D: volBuildSeqRef 로 진행 중 키 무효화 시에도 volPendingRef 데드락 없음');
  ok(skySrc.includes('effectiveVolSceneKey(') && !/fetchNearestMetar[\s\S]{0,400}volKeyRef\.current\s*=\s*''/.test(skySrc),
    'SkyScene3D: fetchNearestMetar 는 무조건 volKeyRef="" 하지 않고 effectiveVolSceneKey 로 실제 변화만 재빌드');
  ok(skySrc.includes('vol.setSceneAsync(built.input, isFast, isFirstCloudScene ? 24 : 12)'),
    'SkyScene3D: 첫 구름 씬(!volHasSceneRef)은 sliceMs=24로 첫 표시 지연 단축');

  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\npass ${pass} / fail ${fail}`);
  if (fail > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
