/**
 * 밤 불빛 지도(cityLightMap) 기반 구름 3등급 반사 + 별/은하수 광해 자동 밝기 조절 검증.
 * 사용: node tools/shader-preview/verify-light-pollution.js
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
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'light-poll-'));
  const entry = path.join(work, 'runner.ts');
  const stub = path.join(work, 'rn-stub.js');
  const bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(
    stub,
    'module.exports = { Platform: { OS: "web" }, Image: {}, documentDirectory: null, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };',
  );
  fs.writeFileSync(entry, `
    import * as THREE from 'three';
    import { decodeGrayPng, cityLightField, estimateLightPollution, CITY_REF_LOCAL } from ${JSON.stringify(path.join(ROOT, 'src/utils/cityLightMap.ts'))};
    import { effectiveMagLimit } from ${JSON.stringify(path.join(ROOT, 'src/utils/moonlight.ts'))};
    import { createStarField, updateStarField } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/StarField.ts'))};
    import { createMilkyWayBand } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/MilkyWayBand.ts'))};
    (globalThis as any).__LP_MOD = { THREE, decodeGrayPng, cityLightField, estimateLightPollution, CITY_REF_LOCAL, effectiveMagLimit, createStarField, updateStarField, createMilkyWayBand };
  `);
  execFileSync(
    'npx',
    [
      'esbuild', entry, '--bundle', '--format=cjs', '--platform=node',
      '--define:__DEV__=false', `--alias:react-native=${stub}`,
      `--outfile=${bundle}`, '--log-level=warning',
    ],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } },
  );
  require(bundle);
  const M = globalThis.__LP_MOD;

  console.log('\n[1] 실제 NASA Black Marble 밤 불빛 지도(lights_01deg.png) 광해/구름 반사 검증');
  const pngBytes = fs.readFileSync(path.join(ROOT, 'assets/nightlights/lights_01deg.png'));
  const map = M.decodeGrayPng(new Uint8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength));
  ok(map.w === 3600 && map.h === 1800, `밤 불빛 지도 디코드 크기 ${map.w}x${map.h}`);

  const pacific = M.cityLightField(map, 25.0, 160.0);
  const inje = M.cityLightField(map, 38.07, 128.35);
  const suburb50 = M.cityLightField(map, 37.90, 127.35);
  const gamagori = M.cityLightField(map, 34.8155, 137.2331);
  const seoul = M.cityLightField(map, 37.5665, 126.9780);

  const centerOf = (f) => {
    const mid = Math.floor(f.n / 2);
    return f.patch[mid * f.n + mid];
  };

  ok(pacific.magLimit === 6.5 && pacific.skyGlow === 0 && pacific.maxPatch === 0,
    `태평양 한복판: magLimit=${pacific.magLimit.toFixed(1)}, skyGlow=${pacific.skyGlow.toFixed(3)}, maxPatch=${pacific.maxPatch.toFixed(3)} (3등급 기준에서도 구름 반사 0)`);
  ok(inje.magLimit >= 5.8 && inje.skyGlow < 0.05 && centerOf(inje) < 1e-3,
    `인제 오지: magLimit=${inje.magLimit.toFixed(1)}, skyGlow=${inje.skyGlow.toFixed(3)}, 관측점 구름=${centerOf(inje).toFixed(4)}`);
  ok(centerOf(suburb50) < 0.15 && suburb50.maxPatch > 0.7 && suburb50.magLimit > seoul.magLimit + 1.0,
    `서울 50km 외곽: 머리 위 구름=${centerOf(suburb50).toFixed(2)} (어두움), 서울 방면 구름 maxPatch=${suburb50.maxPatch.toFixed(2)} (반사), 별=${suburb50.magLimit.toFixed(1)}등급`);
  ok(gamagori.magLimit > 3.5 && gamagori.magLimit < 5.0 && gamagori.skyGlow > 0.15 && gamagori.skyGlow < 0.5,
    `가마고리(지방 시가지): magLimit=${gamagori.magLimit.toFixed(1)}, skyGlow=${gamagori.skyGlow.toFixed(3)}`);
  ok(seoul.magLimit <= 3.3 && seoul.pollution > 0.9 && seoul.skyGlow > 0.95 && centerOf(seoul) > 0.9,
    `서울 도심: magLimit=${seoul.magLimit.toFixed(1)}, pollution=${seoul.pollution.toFixed(3)}, 구름 중심=${centerOf(seoul).toFixed(2)}`);
  ok(seoul.magLimit < gamagori.magLimit && gamagori.magLimit < suburb50.magLimit && suburb50.magLimit < inje.magLimit && inje.magLimit < pacific.magLimit,
    `별 한계 등급 단조 순서: 서울(${seoul.magLimit.toFixed(1)}) < 가마고리(${gamagori.magLimit.toFixed(1)}) < 서울외곽(${suburb50.magLimit.toFixed(1)}) < 인제(${inje.magLimit.toFixed(1)}) < 태평양(${pacific.magLimit.toFixed(1)})`);

  const estSeoul = M.estimateLightPollution(map, 37.5665, 126.9780);
  ok(Math.abs(estSeoul.magLimit - seoul.magLimit) < 1e-6 && Math.abs(estSeoul.pollution - seoul.pollution) < 1e-6,
    'estimateLightPollution(UI/별용)과 cityLightField(볼륨 구름용) 결과 100% 일치');

  console.log('\n[2] StarField · MilkyWay 광해 감쇠 셰이더 검증');
  const sf = M.createStarField();
  const mw = M.createMilkyWayBand();
  ok(balancedBraces(sf.material.vertexShader) && balancedBraces(sf.material.fragmentShader), 'StarField 셰이더 중괄호 균형');
  ok(balancedBraces(mw.material.vertexShader) && balancedBraces(mw.material.fragmentShader), 'MilkyWayBand 셰이더 중괄호 균형');
  ok(sf.material.vertexShader.includes('skyClarity') && sf.material.vertexShader.includes('lpGain'),
    'StarField 정점 셰이더에 uMagLimit 기반 밝기/대비 감쇠(skyClarity * lpGain) 포함');

  // 셰이더 수식 수치 검증: 시리우스(-1.46) 및 2등성(2.0)이 도심(3.0) vs 암천(6.5)에서 실제로 밝기가 달라지는지 확인
  const starVisAt = (aMag, uMagLimit, aKind = 0) => {
    const smoothstep = (e0, e1, x) => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const t = Math.max(0, Math.min(1, (6.5 - aMag) / (6.5 + 1.46)));
    let norm = Math.pow(t, 1.15) * smoothstep(uMagLimit + 0.35, uMagLimit - 0.35, aMag);
    const clarity = Math.max(0, Math.min(1, (uMagLimit - 3.0) / 3.5));
    const starC = 0.38 + (1.10 - 0.38) * Math.pow(clarity, 0.75);
    const planC = 0.62 + (1.05 - 0.62) * clarity;
    const lpGain = aKind > 0.5 ? planC : starC;
    return norm * lpGain;
  };
  const siriusSeoul = starVisAt(-1.46, seoul.magLimit);
  const siriusDark = starVisAt(-1.46, pacific.magLimit);
  const polSeoul = starVisAt(2.0, seoul.magLimit);
  const polDark = starVisAt(2.0, pacific.magLimit);
  const faintSeoul = starVisAt(4.0, seoul.magLimit);
  const faintDark = starVisAt(4.0, pacific.magLimit);
  ok(siriusSeoul > 0.3 && siriusDark > siriusSeoul * 2.5,
    `밝은 1등성도 도심 vs 암천에서 실제 밝기 차이: 시리우스 도심=${siriusSeoul.toFixed(2)}, 암천=${siriusDark.toFixed(2)}`);
  ok(polDark > polSeoul * 2.5 && faintSeoul === 0 && faintDark > 0.25,
    `북극성(2등급) 도심=${polSeoul.toFixed(2)} vs 암천=${polDark.toFixed(2)}, 4등성 도심=${faintSeoul.toFixed(2)} vs 암천=${faintDark.toFixed(2)}`);

  const eq = new M.THREE.Matrix3();
  M.updateStarField(sf, { equToHorizon: eq, sunAltDeg: -20, brightness: 1.2, magLimit: inje.magLimit, pixelRatio: 2 });
  ok(Math.abs(sf.material.uniforms.uMagLimit.value - inje.magLimit) < 1e-6 &&
     Math.abs(sf.material.uniforms.uBrightness.value - 1.2) < 1e-6,
    'updateStarField uniform(uMagLimit / uBrightness) 정상 전달');
  sf.dispose();
  mw.dispose();

  console.log('\n[3] volumetricScene · SkyScene3D · LayerControlModal · i18n 통합 배선 확인');
  const volSrc = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'), 'utf8');
  const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/components/SkyScene3D/SkyScene3D.tsx'), 'utf8');
  const modalSrc = fs.readFileSync(path.join(ROOT, 'src/components/SunsetSimulation/LayerControlModal.tsx'), 'utf8');
  const i18nSrc = fs.readFileSync(path.join(ROOT, 'src/utils/i18n.ts'), 'utf8');

  ok(volSrc.includes('CITY_REF_LOCAL') && volSrc.includes('f.skyGlow') && volSrc.includes('Math.max(cityA, 0.0012)'),
    'volumetricScene: 3등급 기준 refBaseCd + 빛지도 skyGlow/patch 감쇠 및 야간 노출 바닥 유지');
  ok(sceneSrc.includes('const volCityLightNow = cityLightsEnabled && nightLightsRef.current ? 1.0 : 0;') &&
     sceneSrc.includes('lightEstForStars ? lightEstForStars.magLimit') &&
     sceneSrc.includes('cachedMoonBaseMagRef.current'),
    'SkyScene3D: 구름 3등급(1.0) 고정 + 별/암순응 빛지도 연동 + 등급 캐시 즉시 무효화');
  ok(!modalSrc.includes('starMagLimit') && modalSrc.includes('estimateLightPollution') && modalSrc.includes('detectedMag'),
    'LayerControlModal: 수동 등급 슬라이더 제거 및 빛지도 기반 자동 등급 표시');
  ok((i18nSrc.match(/밤 불빛 지도의 광해 기준|night-lights map|夜光マップの光害基準/g) || []).length === 3,
    'i18n 3개 언어(ko/en/ja) 안내 문구(skyNote) 업데이트');

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
