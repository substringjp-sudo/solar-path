/**
 * 반경 1km 건물 고도 매스(buildingTiles + BuildingField) 및 레이어 ON/OFF 토글 검증.
 * 사용: node tools/shader-preview/verify-buildings.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const http = require('http');

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
      SKIRT_DEPTH_M,
      WINDOW_CELL_M,
      estimateBuildingHeightM,
      estimateBuildingMinHeightM,
      triangulatePolygonXZ,
      buildMergedBuildingGeometry,
      createBuildingThreeGeometry,
      fetchNearbyBuildings,
    } from ${JSON.stringify(path.join(ROOT, 'src/utils/buildingTiles.ts'))};
    import { decodeMvtTile, fetchMvtTileRaw, fetchUrbanMask, lonLatToTileXY, extractOuterRings, tilePointToLonLat } from ${JSON.stringify(path.join(ROOT, 'src/utils/mvtTiles.ts'))};
    import { createTerrainField } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/TerrainField.ts'))};
    import {
      createBuildingField,
      updateBuildingFieldEye,
      computeNightWindowRate,
      computeNightWindowGlow,
    } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/BuildingField.ts'))};
    import { LAYER_TERRAIN_DIST, LAYER_TERRAIN_LIT } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/SceneComposer.ts'))};
    (globalThis as any).__BLD_MOD = {
      THREE,
      BUILDING_RADIUS_M,
      SKIRT_DEPTH_M,
      WINDOW_CELL_M,
      estimateBuildingHeightM,
      estimateBuildingMinHeightM,
      triangulatePolygonXZ,
      buildMergedBuildingGeometry,
      createBuildingThreeGeometry,
      fetchNearbyBuildings,
      decodeMvtTile,
      fetchMvtTileRaw,
      fetchUrbanMask,
      lonLatToTileXY,
      extractOuterRings,
      tilePointToLonLat,
      createTerrainField,
      createBuildingField,
      updateBuildingFieldEye,
      computeNightWindowRate,
      computeNightWindowGlow,
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
  ok(Math.abs(minY - (-M.SKIRT_DEPTH_M)) < 1e-5 && Math.abs(maxY - 16.0) < 1e-5,
    `기초 스커트(-${M.SKIRT_DEPTH_M.toFixed(1)}m) ~ 옥상(16.0m) 높이 범위 확인: [${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);
  ok(roofUpCount === 6 && wallHorizCount >= 48,
    `지붕 +Y 법선(${roofUpCount}v) & 18m 세분화 외벽 단위법선(${wallHorizCount}v) 검증`);
  ok(groundAligned, '한 건물의 모든 정점이 동일 지반 중심(aGroundPos) 공유 → 경사지에서도 옥상 수평 유지');

  const geo = M.createBuildingThreeGeometry(merged);
  const wallAttr = geo.getAttribute('aWallCoord');
  let wallVerts = 0, roofMarked = 0;
  for (let i = 0; i < merged.vertexCount; i++) {
    if (Math.abs(merged.normals[i * 3 + 1]) > 0.5) {
      if (wallAttr.getX(i) < 0) roofMarked++;
    } else {
      wallVerts++;
    }
  }
  ok(wallAttr?.count === merged.vertexCount && wallVerts > 0 && roofMarked === 6,
    `aWallCoord 외벽/지붕 분리 바인딩 확인 (wall=${wallVerts}v, roofExcluded=${roofMarked}v)`);
  geo.dispose();

  // 최소 MVT v2 바이너리 인코더 (네트워크 없이 decodeMvtTile · fetchNearbyBuildings · fetchUrbanMask 실증)
  const varint = (n) => {
    const out = [];
    while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    out.push(n & 0x7f);
    return out;
  };
  const zz = (n) => (n < 0 ? -n * 2 - 1 : n * 2);
  const pbStr = (fn, s) => {
    const b = Buffer.from(s, 'utf8');
    return [...varint((fn << 3) | 2), ...varint(b.length), ...b];
  };
  const pbBytes = (fn, arr) => [...varint((fn << 3) | 2), ...varint(arr.length), ...arr];
  const pbPacked = (fn, ints) => {
    const body = ints.flatMap((v) => varint(v));
    return pbBytes(fn, body);
  };
  const encPolyGeom = (pts) => {
    const ints = [((pts.length === 0 ? 0 : 1) << 3) | 1];
    let px = 0, py = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i === 1) ints.push(((pts.length - 1) << 3) | 2);
      ints.push(zz(pts[i][0] - px), zz(pts[i][1] - py));
      px = pts[i][0]; py = pts[i][1];
    }
    ints.push((1 << 3) | 7);
    return ints;
  };
  const pbDoubleVal = (d) => {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(d, 0);
    return [...pbBytes(1 /* dummy replaced */, [...b])];
  };
  const pbValDouble = (d) => {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(d, 0);
    return [...varint((3 << 3) | 1), ...b];
  };
  const makeMvtLayer = (name, keys, vals, feats) => [
    ...pbStr(1, name),
    ...feats.flatMap((f) => pbBytes(2, f)),
    ...keys.flatMap((k) => pbStr(3, k)),
    ...vals.flatMap((v) => pbBytes(4, v)),
    ...varint((5 << 3) | 0), ...varint(4096),
  ];
  const sqBld = encPolyGeom([[1900, 1900], [2020, 1900], [2020, 2020], [1900, 2020]]);
  const featBld = [...pbPacked(2, [0, 0]), ...varint((3 << 3) | 0), ...varint(3), ...pbPacked(4, sqBld)];
  const layerBld = makeMvtLayer('building', ['render_height'], [pbValDouble(28)], [featBld]);

  const sqUrban = encPolyGeom([[1024, 1024], [3072, 1024], [3072, 3072], [1024, 3072]]);
  const featUrban = [...pbPacked(2, [0, 0]), ...varint((3 << 3) | 0), ...varint(3), ...pbPacked(4, sqUrban)];
  const layerLu = makeMvtLayer('landuse', ['class'], [pbStr(1, 'commercial')], [featUrban]);

  const sqPark = encPolyGeom([[2400, 2400], [2800, 2400], [2800, 2800], [2400, 2800]]);
  const featPark = [...pbPacked(2, []), ...varint((3 << 3) | 0), ...varint(3), ...pbPacked(4, sqPark)];
  const layerPk = makeMvtLayer('park', [], [], [featPark]);

  const mvtTileBytes = new Uint8Array([
    ...pbBytes(3, layerBld),
    ...pbBytes(3, layerLu),
    ...pbBytes(3, layerPk),
  ]);
  const decTest = M.decodeMvtTile(mvtTileBytes, new Set(['building', 'landuse', 'park']));
  ok(decTest.building?.features.length === 1 && decTest.building.features[0].props.render_height === 28 &&
     decTest.landuse?.features[0]?.props.class === 'commercial' && decTest.park?.features.length === 1,
    '순수 TS MVT 프로토버프 디코더: building(28m)·landuse(commercial)·park 정확한 해석');

  let fetchCalls = 0;
  let forceFail = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchCalls++;
    if (forceFail) throw new Error('network down');
    if (String(url).endsWith('/planet')) {
      return { ok: true, json: async () => ({ tiles: ['https://mock.mvt/{z}/{x}/{y}.pbf'] }) };
    }
    if (String(url).includes('.pbf')) {
      return { ok: true, arrayBuffer: async () => mvtTileBytes.buffer.slice(mvtTileBytes.byteOffset, mvtTileBytes.byteOffset + mvtTileBytes.byteLength) };
    }
    return { ok: true, json: async () => ({ elements: [bNear] }) };
  };
  try {
    // 1) 실패 시 캐시 잠금 없이 throw 해 재시도가 가능해야 함
    forceFail = true;
    let threwOnFail = false;
    try { await M.fetchNearbyBuildings(35.100, 129.000, { radiusM: 500 }); }
    catch { threwOnFail = true; }
    ok(threwOnFail, '모든 건물 소스 실패 시 빈 null 캐시 잠금 대신 예외 전파 (재시도 가능)');

    // 2) MVT 정상 응답 시 28m 건물 병합 + 위치 캐시 히트 검증
    forceFail = false;
    const tile14 = M.lonLatToTileXY(37.5665, 126.978, 14);
    const llMid = M.tilePointToLonLat(tile14.x, tile14.y, 14, 1960, 1960, 4096);
    const callsBefore = fetchCalls;
    const f1 = await M.fetchNearbyBuildings(llMid.lat + 0.002, llMid.lon - 0.002, { radiusM: 800 });
    const callsAfterF1 = fetchCalls;
    const f2 = await M.fetchNearbyBuildings(llMid.lat + 0.002, llMid.lon - 0.002, { radiusM: 800 });
    let f1MaxY = 0;
    if (f1) for (let i = 0; i < f1.vertexCount; i++) f1MaxY = Math.max(f1MaxY, f1.positions[i * 3 + 1]);
    ok(f1 !== null && f1.buildingCount >= 1 && Math.abs(f1MaxY - 28) < 1e-3 && callsAfterF1 > callsBefore,
      `MVT 1차 소스 건물(28m) 생성 확인 (buildings=${f1?.buildingCount}, calls=${callsAfterF1 - callsBefore})`);
    ok(f2 === f1 && fetchCalls === callsAfterF1, '동일 버킷 2차 호출 네트워크 0회 및 캐시 즉시 반환');

    // 3) 도시 토지이용 마스크(상업지역 235+ vs 공원 0 carve) 검증
    const tile13 = M.lonLatToTileXY(37.5665, 126.978, 13);
    const llMask = M.tilePointToLonLat(tile13.x, tile13.y, 13, 2048, 2048, 4096);
    const urban = await M.fetchUrbanMask(llMask.lat, llMask.lon, { halfM: 1800, size: 128 });
    const llPark = M.tilePointToLonLat(tile13.x, tile13.y, 13, 2600, 2600, 4096);
    const dxP = (llPark.lon - llMask.lon) * 111320 * Math.cos(llMask.lat * Math.PI / 180);
    const dzP = -(llPark.lat - llMask.lat) * 111320;
    const colP = Math.max(0, Math.min(127, Math.floor((dxP + 1800) / 3600 * 128)));
    const rowP = Math.max(0, Math.min(127, Math.floor((dzP + 1800) / 3600 * 128)));
    const urbanVal = urban ? urban.data[50 * 128 + 50] : -1;
    const parkVal = urban ? urban.data[rowP * 128 + colP] : -1;
    ok(urban !== null && urbanVal > 180 && parkVal < 60,
      `fetchUrbanMask: 상업지 포장=${urbanVal} vs 도심 공원 녹지=${parkVal}`);
  } finally {
    globalThis.fetch = origFetch;
  }

  // 4) React Native 환경 바이너리 XHR(responseType='arraybuffer') 경로 검증
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origXHR = globalThis.XMLHttpRequest;
  let xhrUsed = false;
  let xhrRespType = '';
  let rnFetchCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('.pbf')) rnFetchCalled = true;
    return { ok: true, json: async () => ({ tiles: ['https://mock.mvt/{z}/{x}/{y}.pbf'] }) };
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { product: 'ReactNative' },
  });
  globalThis.XMLHttpRequest = class MockXHR {
    constructor() {
      this.status = 0;
      this.responseType = '';
      this.response = null;
      this.timeout = 0;
      this.onload = null;
      this.onerror = null;
      this.ontimeout = null;
    }
    open(_method, url) { this._url = url; }
    addEventListener() {}
    abort() {}
    send() {
      xhrUsed = true;
      xhrRespType = this.responseType;
      this.status = 200;
      this.response = mvtTileBytes.buffer.slice(mvtTileBytes.byteOffset, mvtTileBytes.byteOffset + mvtTileBytes.byteLength);
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  try {
    const rnBytes = await M.fetchMvtTileRaw({ z: 14, x: 9999, y: 8888 });
    ok(xhrUsed && xhrRespType === 'arraybuffer' && !rnFetchCalled && rnBytes.length === mvtTileBytes.length,
      `RN 환경 MVT 바이너리 수신 시 XMLHttpRequest(arraybuffer) 직접 사용 (bytes=${rnBytes.length})`);
  } finally {
    globalThis.fetch = origFetch;
    if (origXHR === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = origXHR;
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete globalThis.navigator;
  }

  console.log('\n[2b] TerrainField 도시 바닥 회색 알베도 셰이더 · setUrbanMask · setFarUrban 검증');
  const tf = M.createTerrainField({ observerElevM: 20 });
  const tfMat = tf.material;
  const tfLitMat = tf.litMesh.material;
  ok(balancedBraces(tfMat.fragmentShader) && balancedIfdefs(tfMat.fragmentShader), 'TerrainField FRAGMENT 괄호/#ifdef 균형');
  ok(tfLitMat.fragmentShader.includes('uUrbanTex') && tfLitMat.fragmentShader.includes('urbLitAlb') && tfMat.fragmentShader.includes('albUrban'),
    'TerrainField 일반/볼륨 패스 모두 도시 회색 지반 셰이더(albUrban/urbLitAlb) 포함');
  const dupCheck = new Set();
  let tfDups = 0;
  for (const line of tfMat.fragmentShader.split('\n')) {
    const m = line.match(/^\s*uniform\s+\w+\s+(\w+)\s*;/);
    if (m) { if (dupCheck.has(m[1])) tfDups++; dupCheck.add(m[1]); }
  }
  ok(tfDups === 0, `TerrainField 중복 uniform 0건 (실측 ${tfDups})`);
  tf.setFarUrban(0.8);
  ok(Math.abs(tf.material.uniforms.uFarUrban.value - 0.8) < 1e-6, 'setFarUrban 전달 확인');
  tf.setUrbanMask({ size: 4, halfM: 2000, data: new Uint8Array(16).fill(220) });
  ok(tf.material.uniforms.uUrbanValid.value === 1 && tf.material.uniforms.uUrbanHalfM.value === 2000,
    'setUrbanMask RGBA DataTexture 업로드 및 활성화 확인');
  tf.setUrbanMask(null);
  ok(tf.material.uniforms.uUrbanValid.value === 0, 'setUrbanMask(null) 해제 확인');
  tf.dispose();

  console.log('\n[3] BuildingField 셰이더 · 4패스(main/dist/lit/window) · 2시 이후 1% 내림 규약');
  const r20 = M.computeNightWindowRate(20);
  const r23 = M.computeNightWindowRate(23);
  const r00 = M.computeNightWindowRate(0);
  const r01 = M.computeNightWindowRate(1);
  const r02 = M.computeNightWindowRate(2);
  const r03 = M.computeNightWindowRate(3.5);
  ok(Math.abs(r20 - 0.46) < 1e-6 && r23 < r20 && r23 > r00 && r01 < r00 && r01 > 0.01 &&
     Math.abs(r02 - 0.01) < 1e-6 && Math.abs(r03 - 0.01) < 1e-6,
    `심야 점등 비율 단조 감소 및 02시 이후 1% 유지 (20h=${r20.toFixed(2)}, 23h=${r23.toFixed(2)}, 0h=${r00.toFixed(2)}, 1h=${r01.toFixed(2)}, 2h=${r02.toFixed(2)}, 3.5h=${r03.toFixed(2)})`);
  ok(Math.floor(24 * r02) === 0 && Math.floor(1200 * r02) === 12,
    '건물별 floor 내림: 시골 24창문=0개 소등 vs 도심 1200창문=12개(1%) 유지');
  ok(M.computeNightWindowGlow(20, true) === 0 &&
     M.computeNightWindowGlow(-2, true) > 0 && M.computeNightWindowGlow(-2, true) < 1 &&
     M.computeNightWindowGlow(-10, true) === 1 && M.computeNightWindowGlow(-10, false) === 0,
    '태양 고도/도시불빛 연동: 주간=0, 박명=페이드, 야간=1, 도시불빛 OFF=0');

  const bf = M.createBuildingField({ eyeHeightM: 1.6 });
  ok(bf.mesh.visible === false && bf.distMesh.visible === false && bf.litMesh.visible === false && bf.windowMesh.visible === false,
    '초기 상태는 4개 메시 모두 visible=false');
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
  ok(litMat.fragmentShader.includes('#elif defined(TERRAIN_LIT_OUT)') && !/TERRAIN_LIT_OUT[\s\S]*vec3 alb\s*=/.test(litMat.fragmentShader.split('#else')[0]),
    'TERRAIN_LIT_OUT 분기 독립 및 vec3 alb 중복 선언 제거');

  const s0 = bf.geomSerial();
  bf.setBuildings(merged);
  ok(bf.geomSerial() === s0 + 1 && bf.hasGeometry(), 'setBuildings 후 geomSerial 증가 및 hasGeometry()=true');
  ok(bf.mesh.visible === false && bf.distMesh.visible === false && bf.litMesh.visible === false,
    '옵션 OFF 상태에서 데이터 적재만으로는 표시되지 않음');

  bf.setVisible(true);
  bf.setWindowLighting(r20, 0);
  ok(bf.mesh.visible === true && bf.distMesh.visible === true && bf.litMesh.visible === true && bf.windowMesh.visible === false,
    '옵션 ON + 주간(glow=0) → 실루엣 3메시 ON, windowMesh 는 자동 스킵(visible=false)');
  bf.setWindowLighting(r20, 1);
  ok(bf.windowMesh.visible === true,
    '야간(glow=1) → windowMesh 활성화(visible=true)');

  const cam = new M.THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(12, 34, -56);
  M.updateBuildingFieldEye(bf, cam);
  ok(bf.mesh.position.distanceTo(cam.position) < 1e-6 &&
     bf.distMesh.position.distanceTo(cam.position) < 1e-6 &&
     bf.windowMesh.position.distanceTo(cam.position) < 1e-6,
    'updateBuildingFieldEye 가 카메라 원점을 4메시에 동기화');

  bf.setVisible(false);
  ok(bf.mesh.visible === false && bf.distMesh.visible === false && bf.litMesh.visible === false && bf.windowMesh.visible === false,
    '옵션 OFF 전환 → 4개 메시 모두 즉시 visible=false');

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
     sceneSrc.includes('fetchUrbanMask(bldLat, bldLng') &&
     sceneSrc.includes('location?.coords?.latitude ?? 37.5665') &&
     sceneSrc.includes('buildingField.windowMesh') &&
     sceneSrc.includes('setWindowLighting(') &&
     sceneSrc.includes('setUrbanMask(mask)') && sceneSrc.includes('setFarUrban(') &&
     sceneSrc.includes('buildingRetryTimerRef') &&
     sceneSrc.includes('buildingFieldRef.current?.setPatch(patch, patch, maskPatch)') &&
     sceneSrc.includes('buildingFieldRef.current.dispose()'),
    'SkyScene3D 조건부 건물 조회/재시도, 창문 야간점등 배선, 서울 폴백, 도시 지반 마스크, DEM 동기화 및 해제 완비');
  ok(stageSrc.includes('BuildingField.ts') && stageSrc.includes('buildingTiles.ts') && stageSrc.includes('mvtTiles.ts'),
    'tools/shader-preview/stage-esm.js 스테이징 목록 포함');

  const chromeBin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(chromeBin)) {
    console.log('\n[5] 실제 Chrome WebGL2 4패스(main/dist/lit MRT/야간 창문) 셰이더 컴파일 · 2시 이후 1% 내림 검증');
    const glWork = fs.mkdtempSync(path.join(os.tmpdir(), 'bld-gl-verify-'));
    const glEntry = path.join(glWork, 'entry.ts');
    const glBundle = path.join(glWork, 'bundle.js');
    fs.writeFileSync(glEntry, `
      import * as THREE from 'three';
      import { buildMergedBuildingGeometry } from ${JSON.stringify(path.join(ROOT, 'src/utils/buildingTiles.ts'))};
      import {
        createBuildingField,
        updateBuildingFieldEye,
        computeNightWindowRate,
        computeNightWindowGlow,
      } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/BuildingField.ts'))};
      import { createTerrainField, updateTerrainFieldEye } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/TerrainField.ts'))};
      import { createSceneComposer, LAYER_MID, LAYER_TERRAIN_DIST, LAYER_TERRAIN_LIT, assignLayer } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/SceneComposer.ts'))};
      (window as any).__runGlVerify = async () => {
        const shaderLogs: string[] = [];
        const origErr = console.error;
        console.error = (...a: any[]) => { shaderLogs.push(a.map(String).join(' ')); origErr(...a); };
        const W = 160, H = 160;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
        renderer.setSize(W, H, false);
        const gl = renderer.getContext();
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, 1, 0.2, 1000);
        camera.position.set(0, 1.6, 0);
        camera.lookAt(80, 1.6 + 8, 0);
        const tf = createTerrainField({ rings: 32, spokes: 48, farM: 3000, eyeHeightM: 1.6, observerElevM: 20 });
        scene.add(tf.mesh); assignLayer(tf.mesh, LAYER_MID);
        scene.add(tf.distMesh); assignLayer(tf.distMesh, LAYER_TERRAIN_DIST);
        scene.add(tf.litMesh); assignLayer(tf.litMesh, LAYER_TERRAIN_LIT);
        tf.mesh.visible = true;
        const bf = createBuildingField({ eyeHeightM: 1.6, observerElevM: 20 });
        bf.mesh.renderOrder = -0.475;
        scene.add(bf.mesh); assignLayer(bf.mesh, LAYER_MID);
        bf.windowMesh.renderOrder = -0.468;
        scene.add(bf.windowMesh); assignLayer(bf.windowMesh, LAYER_MID);
        scene.add(bf.distMesh); assignLayer(bf.distMesh, LAYER_TERRAIN_DIST);
        scene.add(bf.litMesh); assignLayer(bf.litMesh, LAYER_TERRAIN_LIT);

        const cityTower = buildMergedBuildingGeometry([{
          tags: { height: '96' }, // 약 180m 둘레(56열) × 30층 = 1680 창문
          geometry: [
            { lat: 37.5665 + 0.00025, lon: 126.9780 + 0.0007 },
            { lat: 37.5665 + 0.00025, lon: 126.9780 + 0.0012 },
            { lat: 37.5665 - 0.00025, lon: 126.9780 + 0.0012 },
            { lat: 37.5665 - 0.00025, lon: 126.9780 + 0.0007 },
          ],
        }], 37.5665, 126.9780, 1000);
        const ruralHouse = buildMergedBuildingGeometry([{
          tags: { height: '6.4' }, // 약 26m 둘레(8열) × 2층 = 16 창문 (<100 → 2시 이후 floor 0)
          geometry: [
            { lat: 37.5665 + 0.00003, lon: 126.9780 + 0.0003 },
            { lat: 37.5665 + 0.00003, lon: 126.9780 + 0.00037 },
            { lat: 37.5665 - 0.00003, lon: 126.9780 + 0.00037 },
            { lat: 37.5665 - 0.00003, lon: 126.9780 + 0.0003 },
          ],
        }], 37.5665, 126.9780, 1000);

        const composer = createSceneComposer(W, H, 1);
        composer.setTerrainDistance(true);
        const quadMat = new THREE.ShaderMaterial({
          uniforms: { t: { value: null as THREE.Texture | null } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'precision highp float; uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }',
        });
        const quadScene = new THREE.Scene();
        quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));
        const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const sync = (depthOnly: number, sunAlt: number) => {
          for (const h of [tf, bf]) {
            h.material.uniforms.uObsElevM.value = 20;
            h.material.uniforms.uEyeHeightM.value = 1.6;
            h.material.uniforms.uDepthOnly.value = depthOnly;
            h.material.uniforms.uSunAltDeg.value = sunAlt;
            h.material.uniforms.uSunAltRad.value = sunAlt * Math.PI / 180;
            h.material.uniforms.uSunAzRad.value = 2.0;
          }
          updateTerrainFieldEye(tf, camera);
          updateBuildingFieldEye(bf, camera);
        };

        bf.setBuildings(null); bf.setVisible(false); bf.setWindowLighting(0.46, 0); sync(1, 25);
        composer.setTerrainLit(true);
        composer.prepareTerrainDistance(renderer, scene, camera, 'base');
        quadMat.uniforms.t.value = composer.terrainLitTexture();
        renderer.setRenderTarget(null);
        renderer.render(quadScene, ortho);
        const baseLit = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, baseLit);

        bf.setBuildings(cityTower); bf.setVisible(true); sync(1, 25);
        composer.setTerrainLit(true);
        composer.prepareTerrainDistance(renderer, scene, camera, 'lit');
        const errLit = gl.getError();
        quadMat.uniforms.t.value = composer.terrainLitTexture();
        renderer.setRenderTarget(null);
        renderer.render(quadScene, ortho);
        const bldLit = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, bldLit);

        composer.setTerrainLit(false);
        composer.prepareTerrainDistance(renderer, scene, camera, 'dist');
        const errDist = gl.getError();

        // 야간 창문 패스: buildingField.mesh(depth only) 후 windowMesh(AdditiveBlending) 검증
        const countWindowPx = (bldData: typeof cityTower, rate: number, glow: number) => {
          bf.setBuildings(bldData);
          bf.setVisible(true);
          bf.setWindowLighting(rate, glow);
          sync(1, glow > 0 ? -15 : 25);
          renderer.setRenderTarget(null);
          renderer.setClearColor(0x000000, 1);
          renderer.clear(true, true, true);
          camera.layers.set(LAYER_MID);
          renderer.render(scene, camera);
          const px = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let count = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i] > 8 || px[i+1] > 8 || px[i+2] > 8) count++;
          }
          return { count, err: gl.getError() };
        };

        const cityEve = countWindowPx(cityTower, computeNightWindowRate(21), computeNightWindowGlow(-15, true));
        const city2am = countWindowPx(cityTower, computeNightWindowRate(2.5), computeNightWindowGlow(-15, true));
        const cityDay = countWindowPx(cityTower, computeNightWindowRate(21), computeNightWindowGlow(25, true));
        const ruralEve = countWindowPx(ruralHouse, computeNightWindowRate(21), computeNightWindowGlow(-15, true));
        const rural2am = countWindowPx(ruralHouse, computeNightWindowRate(2.5), computeNightWindowGlow(-15, true));

        let diffLit = 0;
        for (let i = 0; i < bldLit.length; i += 4) {
          if (Math.abs(bldLit[i] - baseLit[i]) + Math.abs(bldLit[i+1] - baseLit[i+1]) + Math.abs(bldLit[i+2] - baseLit[i+2]) > 2) diffLit++;
        }
        return { errLit, errDist, diffLit, cityEve, city2am, cityDay, ruralEve, rural2am, shaderLogs };
      };
    `);
    execFileSync(
      'npx',
      [
        'esbuild', glEntry, '--bundle', '--format=iife', '--platform=browser',
        '--define:__DEV__=false', '--loader:.png=empty',
        `--alias:three=${path.join(ROOT, 'node_modules/three')}`,
        `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`, `--alias:expo-file-system/legacy=${stub}`,
        `--outfile=${glBundle}`, '--log-level=error',
      ],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } },
    );
    const glHtml = `<!DOCTYPE html><html><body><script>${fs.readFileSync(glBundle, 'utf8')}</script><script>window.__runGlVerify().then(r=>fetch('/done',{method:'POST',body:JSON.stringify(r)})).catch(e=>fetch('/done',{method:'POST',body:JSON.stringify({fatal:String(e)})}));</script></body></html>`;
    let doneRes;
    const glDone = new Promise(r => { doneRes = r; });
    const srv = http.createServer((req, res) => {
      if (req.url === '/done' && req.method === 'POST') {
        let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { res.end('ok'); doneRes(JSON.parse(b)); });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(glHtml);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const profDir = path.join(glWork, 'prof');
    fs.mkdirSync(profDir);
    const chrome = spawn(chromeBin, [
      '--headless', `--user-data-dir=${profDir}`, '--no-first-run', '--disable-background-networking',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
      `http://127.0.0.1:${srv.address().port}/`,
    ], { stdio: 'ignore' });
    const glRes = await Promise.race([glDone, new Promise(r => setTimeout(() => r({ timeout: true }), 15000))]);
    chrome.kill('SIGKILL');
    srv.close();
    setTimeout(() => { try { fs.rmSync(glWork, { recursive: true, force: true }); } catch {} }, 100);
    ok(!glRes.fatal && !glRes.timeout && glRes.shaderLogs?.length === 0 &&
       glRes.errLit === 0 && glRes.errDist === 0 && glRes.diffLit > 100 &&
       glRes.cityEve?.err === 0 && glRes.city2am?.err === 0 && glRes.rural2am?.err === 0,
      `WebGL2 4패스 컴파일 및 MRT rtLit 건물 출력 확인 (diffLit=${glRes.diffLit}, logs=${glRes.shaderLogs?.length})`);
    ok(glRes.cityEve?.count > 50 && glRes.city2am?.count > 0 && glRes.city2am?.count < glRes.cityEve?.count * 0.25 && glRes.cityDay?.count === 0,
      `WebGL2 도심 타워 야간 창문: 저녁21h=${glRes.cityEve?.count}px → 새벽2:30(1%)=${glRes.city2am?.count}px / 주간=${glRes.cityDay?.count}px`);
    ok(glRes.ruralEve?.count > 0 && glRes.rural2am?.count === 0,
      `WebGL2 시골 소형 주택 내림 소등: 저녁21h=${glRes.ruralEve?.count}px → 새벽2:30(floor=0)=${glRes.rural2am?.count}px`);
  }

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
