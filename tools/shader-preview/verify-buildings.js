/**
 * 반경 1km 건물 고도 매스(buildingTiles + BuildingField) 및 레이어 ON/OFF 토글 검증.
 * 사용: node tools/shader-preview/verify-buildings.js
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

const balancedIfdefs = (s) => {
  let d = 0;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (/^#if(n?def)?\b/.test(t)) d++;
    else if (/^#endif\b/.test(t)) d--;
    if (d < 0) return false;
  }
  return d === 0;
};

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'buildings-verify-'));
  const entry = path.join(work, 'runner.ts');
  const stub = path.join(work, 'rn-stub.js');
  const bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(
    stub,
    'module.exports = { Platform: { OS: "web" }, Image: {}, documentDirectory: null, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };',
  );
  fs.writeFileSync(entry, `
    import * as THREE from 'three';
    import {
      BUILDING_RADIUS_M,
      estimateBuildingHeightM,
      estimateBuildingMinHeightM,
      triangulatePolygonXZ,
      buildMergedBuildingGeometry,
      createBuildingThreeGeometry,
      fetchNearbyBuildings,
    } from ${JSON.stringify(path.join(ROOT, 'src/utils/buildingTiles.ts'))};
    import { createBuildingField, updateBuildingFieldEye } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/BuildingField.ts'))};
    import { LAYER_TERRAIN_DIST, LAYER_TERRAIN_LIT } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/SceneComposer.ts'))};
    (globalThis as any).__BLD_MOD = {
      THREE,
      BUILDING_RADIUS_M,
      estimateBuildingHeightM,
      estimateBuildingMinHeightM,
      triangulatePolygonXZ,
      buildMergedBuildingGeometry,
      createBuildingThreeGeometry,
      fetchNearbyBuildings,
      createBuildingField,
      updateBuildingFieldEye,
      LAYER_TERRAIN_DIST,
      LAYER_TERRAIN_LIT,
    };
  `);
  execFileSync(
    'npx',
    [
      'esbuild', entry, '--bundle', '--format=cjs', '--platform=node',
      '--define:__DEV__=false', '--loader:.png=empty',
      `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`, `--alias:expo-file-system/legacy=${stub}`,
      `--outfile=${bundle}`, '--log-level=warning',
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') },
    },
  );
  require(bundle);
  const M = globalThis.__BLD_MOD;

  console.log('\n[1] 공통 높이 추정 (height → building:levels → building 분류 기본값)');
  ok(M.BUILDING_RADIUS_M === 1000, `BUILDING_RADIUS_M = ${M.BUILDING_RADIUS_M}m`);
  ok(Math.abs(M.estimateBuildingHeightM({ height: '42.5 m' }) - 42.5) < 1e-6, '명시 height(m) 우선 적용');
  ok(Math.abs(M.estimateBuildingHeightM({ height: '100 ft' }) - 30.48) < 1e-3, '피트(ft) 단위 변환 (100 ft -> 30.48m)');
  ok(Math.abs(M.estimateBuildingHeightM({ 'building:levels': '10' }) - 32.0) < 1e-6, '층수(10층 × 3.2m = 32m)');
  ok(Math.abs(M.estimateBuildingHeightM({ 'building:levels': '5', 'roof:levels': '1' }) - 18.2) < 1e-6, '층수 + 지붕층 보정(5*3.2 + 2.2 = 18.2m)');
  ok(M.estimateBuildingHeightM({ building: 'apartments' }) === 24 && M.estimateBuildingHeightM({ building: 'house' }) === 6.5,
    '건물 종류 기본값(apartments=24m, house=6.5m)');
  ok(M.estimateBuildingHeightM({ building: 'yes' }) === 9 && M.estimateBuildingHeightM(undefined) === 9,
    '미상 건물 공통 기본 높이 9m');
  ok(M.estimateBuildingMinHeightM({ min_height: '6m' }) === 6, '필로티 min_height 파싱');

  console.log('\n[2] Ear-clipping 삼각분할 · 1km 반경 필터 · 경사지 aGroundPos / -3m 스커트 / 법선');
  const lShape = [
    { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 },
    { x: 10, z: 10 }, { x: 10, z: 20 }, { x: 0, z: 20 },
  ];
  const lTris = M.triangulatePolygonXZ(lShape);
  ok(lTris.length === (lShape.length - 2) * 3, `오목 L자 6각 폴리곤 삼각분할 인덱스 수 = ${lTris.length} (기대 12)`);

  const centerLat = 37.5665, centerLon = 126.9780;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
  const makeBox = (id, dEastM, dNorthM, w, d, tags) => {
    const dl1 = dEastM / mPerDegLon, dl2 = (dEastM + w) / mPerDegLon;
    const dp1 = dNorthM / mPerDegLat, dp2 = (dNorthM + d) / mPerDegLat;
    return {
      id,
      tags,
      geometry: [
        { lat: centerLat + dp1, lon: centerLon + dl1 },
        { lat: centerLat + dp1, lon: centerLon + dl2 },
        { lat: centerLat + dp2, lon: centerLon + dl2 },
        { lat: centerLat + dp2, lon: centerLon + dl1 },
        { lat: centerLat + dp1, lon: centerLon + dl1 },
      ],
    };
  };

  const bNear = makeBox(1, 200, 100, 60, 20, { 'building:levels': '5' }); // 60m 길 변 -> 18m 세분화 대상
  const bFar = makeBox(2, 1150, 0, 20, 20, { height: '50' });           // > 1km -> 제외 대상
  const bUnderFoot = makeBox(3, -1, -1, 2, 2, { height: '10' });        // < 2m -> 자기 발밑 제외 대상

  const merged = M.buildMergedBuildingGeometry([bNear, bFar, bUnderFoot], centerLat, centerLon, M.BUILDING_RADIUS_M);
  ok(merged !== null && merged.buildingCount === 1,
    `반경 필터링: 1km 밖(1150m)·발밑(<2m) 제외 후 1동만 병합 (실제 ${merged?.buildingCount})`);

  let minY = Infinity, maxY = -Infinity;
  let roofUpCount = 0, wallHorizCount = 0;
  let groundAligned = true;
  const gx0 = merged.groundPos[0], gz0 = merged.groundPos[1];
  for (let i = 0; i < merged.vertexCount; i++) {
    const y = merged.positions[i * 3 + 1];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    const ny = merged.normals[i * 3 + 1];
    const nx = merged.normals[i * 3], nz = merged.normals[i * 3 + 2];
    if (ny > 0.99) roofUpCount++;
    else if (Math.abs(ny) < 1e-4 && Math.abs(Math.hypot(nx, nz) - 1) < 1e-4) wallHorizCount++;
    if (Math.abs(merged.groundPos[i * 2] - gx0) > 1e-4 || Math.abs(merged.groundPos[i * 2 + 1] - gz0) > 1e-4) {
      groundAligned = false;
    }
  }
  ok(Math.abs(minY - (-3.0)) < 1e-5 && Math.abs(maxY - 16.0) < 1e-5,
    `기초 스커트(-3.0m) ~ 옥상(16.0m) 높이 범위 확인: [${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);
  ok(roofUpCount === 6 && wallHorizCount >= 48,
    `지붕 +Y 법선(${roofUpCount}v) & 18m 세분화 외벽 단위법선(${wallHorizCount}v) 검증`);
  ok(groundAligned, '한 건물의 모든 정점이 동일 지반 중심(aGroundPos) 공유 → 경사지에서도 옥상 수평 유지');

  let fetchCalls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return { ok: true, json: async () => ({ elements: [bNear] }) };
  };
  try {
    const f1 = await M.fetchNearbyBuildings(37.566, 126.978, { radiusM: 1000 });
    const f2 = await M.fetchNearbyBuildings(37.566, 126.978, { radiusM: 1000 });
    ok(f1 !== null && f2 !== null && fetchCalls === 1,
      `fetchNearbyBuildings LRU 캐시 동작 확인 (2회 호출 중 네트워크 1회: ${fetchCalls})`);
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('\n[3] BuildingField 셰이더 · 3패스(main/dist/lit) · ON/OFF 토글 규약');
  const bf = M.createBuildingField({ eyeHeightM: 1.6 });
  ok(bf.mesh.visible === false && bf.distMesh.visible === false && bf.litMesh.visible === false,
    '초기 상태는 3개 메시 모두 visible=false');
  ok(bf.distMesh.layers.isEnabled(M.LAYER_TERRAIN_DIST) && bf.litMesh.layers.isEnabled(M.LAYER_TERRAIN_LIT),
    'distMesh/litMesh 가 LAYER_TERRAIN_DIST / LAYER_TERRAIN_LIT 레이어에 배치됨');

  const reqUniforms = [
    'uObsElevM', 'uEyeHeightM', 'uDepthOnly', 'uOvercast', 'uSurfaceIrr',
    'uSunRadiance', 'uMoonRadiance', 'uExposure', 'uHazeRadiance',
    'uBeta', 'uAngstrom', 'uElevScale', 'uOzoneDU',
  ];
  ok(reqUniforms.every((k) => k in bf.material.uniforms), '지형/조명 필수 uniform 전체 보유');

  const mat = bf.material;
  const distMat = bf.distMesh.material;
  const litMat = bf.litMesh.material;
  ok(balancedBraces(mat.vertexShader) && balancedIfdefs(mat.vertexShader), 'BuildingField VERTEX 셰이더 괄호/#ifdef 균형');
  ok(balancedBraces(mat.fragmentShader) && balancedIfdefs(mat.fragmentShader), 'BuildingField FRAGMENT 셰이더 괄호/#ifdef 균형');
  ok(litMat.fragmentShader.includes('pc_fragColor1') && litMat.fragmentShader.includes('pc_fragColor2') &&
     distMat.fragmentShader.includes('terrainDistEncode'), 'TERRAIN_DIST_OUT / TERRAIN_LIT_OUT MRT 계약 포함');

  const s0 = bf.geomSerial();
  bf.setBuildings(merged);
  ok(bf.geomSerial() === s0 + 1 && bf.hasGeometry(), 'setBuildings 후 geomSerial 증가 및 hasGeometry()=true');
  ok(bf.mesh.visible === false && bf.distMesh.visible === false && bf.litMesh.visible === false,
    '옵션 OFF 상태에서 데이터 적재만으로는 표시되지 않음');

  bf.setVisible(true);
  ok(bf.mesh.visible === true && bf.distMesh.visible === true && bf.litMesh.visible === true,
    '옵션 ON + 데이터 있음 → 3개 메시 모두 visible=true');

  const cam = new M.THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(12, 34, -56);
  M.updateBuildingFieldEye(bf, cam);
  ok(bf.mesh.position.distanceTo(cam.position) < 1e-6 && bf.distMesh.position.distanceTo(cam.position) < 1e-6,
    'updateBuildingFieldEye 가 카메라 원점을 3메시에 동기화');

  bf.setVisible(false);
  ok(bf.mesh.visible === false && bf.distMesh.visible === false && bf.litMesh.visible === false,
    '옵션 OFF 전환 → 3개 메시 모두 즉시 visible=false');

  bf.setVisible(true);
  bf.setBuildings(null);
  ok(bf.hasGeometry() === false && bf.mesh.visible === false && bf.distMesh.visible === false && bf.litMesh.visible === false,
    '데이터 없음(null) 전환 시 ON 상태여도 빈 메시 숨김');
  bf.dispose();

  console.log('\n[4] UI · Store · SkyScene3D · i18n · web stage 배선 확인');
  const storeSrc = fs.readFileSync(path.join(ROOT, 'src/store/useCelestialStore.ts'), 'utf8');
  const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/components/SkyScene3D/SkyScene3D.tsx'), 'utf8');
  const modalSrc = fs.readFileSync(path.join(ROOT, 'src/components/SunsetSimulation/LayerControlModal.tsx'), 'utf8');
  const i18nSrc = fs.readFileSync(path.join(ROOT, 'src/utils/i18n.ts'), 'utf8');
  const stageSrc = fs.readFileSync(path.join(ROOT, 'tools/shader-preview/stage-esm.js'), 'utf8');

  ok(/buildings:\s*false/.test(storeSrc) && /buildings:\s*false/.test(sceneSrc),
    '기본 레이어 설정(useCelestialStore & SkyScene3D DEFAULT_LAYERS) buildings: false');
  ok(modalSrc.includes("key: 'buildings'") && modalSrc.includes("t('layerBuildings'"),
    'LayerControlModal 에 buildings 토글 항목 추가');
  ok((i18nSrc.match(/layerBuildings:/g) || []).length === 3,
    'i18n 3개 언어(ko/en/ja) 모두 layerBuildings 정의');
  ok(sceneSrc.includes('if (!bldEnabled)') && sceneSrc.includes('fetchNearbyBuildings(bldLat, bldLng') &&
     sceneSrc.includes('buildingFieldRef.current?.setPatch(patch, patch, maskPatch)') &&
     sceneSrc.includes('buildingFieldRef.current.dispose()'),
    'SkyScene3D 조건부 Overpass 요청(OFF시 미요청), DEM 동기화, 3패스 통합 및 해제 완비');
  ok(stageSrc.includes('BuildingField.ts') && stageSrc.includes('buildingTiles.ts'),
    'tools/shader-preview/stage-esm.js 스테이징 목록 포함');

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
