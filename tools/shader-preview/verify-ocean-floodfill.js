/**
 * 내륙 0m 가짜 호수 방지(광역 외해 연결 Flood-Fill 마스크) 검증 (브라우저 없음).
 * 사용: node tools/shader-preview/verify-ocean-floodfill.js
 *
 * 검사 항목:
 *  [1] computeConnectedSeaMask: 고립 내륙 0m/-1.5m 분지, 외해 연결 해안·만, 방조제 뒤 간척지(-0.8m),
 *      0m 하천 경계 접촉, 깊은 내해(≥400px & ≤-15m), 결측 투명 타일(alpha=0, -32768m)
 *  [2] demGlsl / makeDemUniforms / loadDemPatch: zoom ≤ 10 광역 패치 seaTexture 생성·해제, zoom > 10 생략,
 *      readRenderTargetPixels 미지원 렌더러 폴백
 *  [3] TerrainField & SeaPlane 셰이더 구문·전처리기·유니폼·setPatch 왕복 배선
 *  [4] waterMask createWaterMask2DTexture: 내륙 5km 0m 단독 표본 방어 및 바다/waterFrac 정상 판정
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log('  PASS: ' + msg);
  } else {
    fail++;
    console.log('  FAIL: ' + msg);
  }
};

function encodeTerrarium(rgba, size, x, y, elevM, alpha = 255) {
  const raw = Math.max(0, Math.min(0xffffff, Math.round((elevM + 32768) * 256)));
  const o = (y * size + x) * 4;
  rgba[o] = (raw >> 16) & 255;
  rgba[o + 1] = (raw >> 8) & 255;
  rgba[o + 2] = raw & 255;
  rgba[o + 3] = alpha;
}

function fillElev(rgba, size, fn) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const res = fn(x, y);
      if (res === null) {
        const o = (y * size + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = rgba[o + 3] = 0;
      } else {
        encodeTerrarium(rgba, size, x, y, res, 255);
      }
    }
  }
}

function countNonZero(arr) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > 0) c++;
  return c;
}

function balancedBraces(s) {
  let d = 0;
  for (const ch of s) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
    if (d < 0) return false;
  }
  return d === 0;
}

function balancedPreproc(s) {
  let d = 0;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (/^#if(def|ndef)?\b/.test(t)) d++;
    else if (/^#endif\b/.test(t)) d--;
    if (d < 0) return false;
  }
  return d === 0;
}

function findDuplicateUniforms(s) {
  const seen = new Map();
  const dups = [];
  for (const line of s.split('\n')) {
    const m = line.match(/^\s*uniform\s+\w+\s+(\w+)\s*;/);
    if (!m) continue;
    const name = m[1];
    seen.set(name, (seen.get(name) ?? 0) + 1);
    if (seen.get(name) === 2) dups.push(name);
  }
  return dups;
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-floodfill-'));
  const entry = path.join(work, 'entry.ts');
  const stub = path.join(work, 'rn-stub.js');
  const bundle = path.join(work, 'bundle.cjs');
  fs.writeFileSync(
    stub,
    'module.exports = { Platform: { OS: "web" }, Image: {}, documentDirectory: null, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };',
  );
  fs.writeFileSync(entry, `
    import * as THREE from 'three';
    import * as demTiles from ${JSON.stringify(path.join(ROOT, 'src/utils/demTiles.ts'))};
    import * as terrainField from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/TerrainField.ts'))};
    import * as seaPlane from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/SeaPlane.ts'))};
    import * as waterMask from ${JSON.stringify(path.join(ROOT, 'src/utils/waterMask.ts'))};
    (globalThis as any).__OCEAN_MOD = { THREE, ...demTiles, ...terrainField, ...seaPlane, ...waterMask };
  `);
  execFileSync(
    'npx',
    [
      'esbuild', entry, '--bundle', '--format=cjs', '--platform=node',
      '--define:__DEV__=false', '--loader:.png=empty',
      `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`, `--alias:expo-file-system/legacy=${stub}`,
      `--outfile=${bundle}`, '--log-level=warning',
    ],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } },
  );
  require(bundle);
  const M = globalThis.__OCEAN_MOD;
  const { THREE } = M;

  console.log('\n[1] computeConnectedSeaMask 외해 연결 판정 단위 검증');
  {
    const S = 64;
    const rgba = new Uint8Array(S * S * 4);

    // 1a) 고립 내륙 0m / -1.5m 저지대
    fillElev(rgba, S, (x, y) => (x >= 22 && x < 42 && y >= 22 && y < 42 ? (x === 32 && y === 32 ? -1.5 : 0.0) : 25.0));
    const inlandOnly = M.computeConnectedSeaMask(rgba, S);
    ok(inlandOnly !== null && countNonZero(inlandOnly) === 0,
      `고립 내륙 0m/-1.5m 저지대 → 바다 화소 0개 (실측 ${inlandOnly ? countNonZero(inlandOnly) : 'null'})`);

    // 1b) 외해(-25m, x=0 경계 연결) + 만(x<24, y=30..34) + 1 texel 팽창 + 고립 내륙 -1m 분지
    fillElev(rgba, S, (x, y) => {
      if (x < 18) return -25 + x; // -25m .. -8m
      if (x < 20) return 0.0;     // 0m 갯벌 가장자리
      if (x < 25 && y >= 30 && y < 34) return -3.0; // 만
      if (x >= 45 && x < 53 && y >= 10 && y < 18) return -1.0; // 고립 내륙 함몰지
      return 12.0;
    });
    const coast = M.computeConnectedSeaMask(rgba, S);
    ok(coast[32 * S + 5] === 255 && coast[32 * S + 23] === 255, '외해 및 연결된 만 내부는 바다(255)');
    ok(coast[10 * S + 20] === 255 && coast[10 * S + 21] === 0, '해안 1 texel(x=20)만 팽창(255)하고 x=21 부터는 육지(0)');
    let inlandHits = 0;
    for (let y = 10; y < 18; y++) for (let x = 45; x < 53; x++) if (coast[y * S + x] > 0) inlandHits++;
    ok(inlandHits === 0, `해안과 단절된 내륙 -1m 분지(45..52)는 전부 육지(0) (오탐 ${inlandHits})`);

    // 1c) 2px 방조제(+3.5m, x=20..21) 뒤 간척지(-0.8m, x=22..44)
    fillElev(rgba, S, (x) => {
      if (x < 20) return -15.0;
      if (x <= 21) return 3.5;
      if (x < 45) return -0.8;
      return 10.0;
    });
    const polder = M.computeConnectedSeaMask(rgba, S);
    ok(polder[32 * S + 10] === 255, '방조제 바깥 외해(x=10)는 바다(255)');
    ok(polder[32 * S + 20] === 255 && polder[32 * S + 21] === 0, '방조제 외측 1px(x=20)까지만 팽창, x=21 에서 차단');
    let polderHits = 0;
    for (let y = 0; y < S; y++) for (let x = 22; x < 45; x++) if (polder[y * S + x] > 0) polderHits++;
    ok(polderHits === 0, `방조제 뒤 간척지(-0.8m) 오탐 0개 (실측 ${polderHits})`);

    // 1d) 경계에 닿는 0.0m 평평한 하천 (수심 <= -2m 없음)
    fillElev(rgba, S, (_x, y) => (y >= 28 && y < 32 ? 0.0 : 15.0));
    const river = M.computeConnectedSeaMask(rgba, S);
    ok(countNonZero(river) === 0, `경계에 닿은 0.0m 얕은 하천 → 바다 오탐 0개 (실측 ${countNonZero(river)})`);

    // 1e) 육지에 둘러싸인 깊은 내해 (24x24 = 576px, -20m)
    fillElev(rgba, S, (x, y) => (x >= 20 && x < 44 && y >= 20 && y < 44 ? -20.0 : 20.0));
    const enclosed = M.computeConnectedSeaMask(rgba, S);
    ok(enclosed[32 * S + 32] === 255 && enclosed[0] === 0,
      '깊고 큰 내해(576px, -20m)는 바다(255)로 보존하고 바깥 육지 경계는 0 유지');

    // 1f) 결측 투명 타일(alpha=0 -> -32768m 함정) 방어
    const blank = new Uint8Array(S * S * 4);
    ok(M.computeConnectedSeaMask(blank, S) === null, '완전 공백 RGBA(alpha=0) → null(레거시 폴백)');
    fillElev(rgba, S, (x, y) => {
      if (x < 16) return null; // 결측 타일
      if (x < 24 && y >= 20 && y < 40) return 0.0; // 결측 타일에 붙은 내륙 0m 저지대
      return 15.0;
    });
    const missingEdge = M.computeConnectedSeaMask(rgba, S);
    ok(missingEdge !== null && countNonZero(missingEdge) === 0,
      '결측 외곽 타일(alpha=0)이 -32768m 외해 시드로 번지지 않음');
  }

  console.log('\n[2] loadDemPatch · demGlsl · makeDemUniforms 검증');
  {
    const glsl = M.demGlsl('demFar');
    ok(
      glsl.includes('uniform sampler2D uDemFarSeaTex;') &&
      glsl.includes('uniform float uDemFarSeaValid;') &&
      glsl.includes('float demFar_seaAt(vec2 groundM)'),
      'demGlsl("demFar") 이 SeaTex / SeaValid / demFar_seaAt 를 선언',
    );

    const makeStubRenderer = (withReadPixels) => {
      let currentTarget = null;
      const renderer = {
        getRenderTarget: () => currentTarget,
        setRenderTarget: (t) => { currentTarget = t; },
        render: () => {},
      };
      if (withReadPixels) {
        renderer.readRenderTargetPixels = (target, _x, _y, w, h, buf) => {
          // 왼쪽 반(x < w/2)은 -20m 바다, x=w/2..w/2+1 은 +3.5m 방조제, 오른쪽은 -0.5m 간척지/내륙
          fillElev(buf, w, (x) => (x < w / 2 ? -20.0 : x < w / 2 + 2 ? 3.5 : -0.5));
        };
      }
      return renderer;
    };

    const dummyTex = () => {
      const t = new THREE.DataTexture(new Uint8Array(256 * 256 * 4), 256, 256, THREE.RGBAFormat);
      t.needsUpdate = true;
      return t;
    };

    // 2a) 광역 패치 (radiusM = 60000 -> zoom <= 10)
    M.clearDemCache();
    const rendererOk = makeStubRenderer(true);
    const widePatch = await M.loadDemPatch(37.3, 126.6, 60000, {
      renderer: rendererOk,
      loadTexture: async () => dummyTex(),
      tileUrl: (z, x, y) => `mem://${z}/${x}/${y}`,
    });
    ok(widePatch !== null && widePatch.zoom <= 10, `광역 패치 zoom=${widePatch?.zoom} (≤ 10)`);
    ok(widePatch?.seaTexture?.isDataTexture === true, '광역 패치에 DataTexture seaTexture 생성');
    ok(
      widePatch.seaTexture.minFilter === THREE.NearestFilter &&
      widePatch.seaTexture.magFilter === THREE.NearestFilter &&
      widePatch.seaTexture.wrapS === THREE.ClampToEdgeWrapping &&
      widePatch.seaTexture.flipY === false,
      'seaTexture 필터·래핑·flipY=false 규약 일치',
    );
    const sz = widePatch.seaTexture.image.width;
    const bytes = widePatch.seaTexture.image.data;
    const seaLeft = bytes[(Math.floor(sz / 2) * sz + Math.floor(sz * 0.25)) * 4];
    const landRight = bytes[(Math.floor(sz / 2) * sz + Math.floor(sz * 0.75)) * 4];
    ok(seaLeft === 255 && landRight === 0, `loadDemPatch 실측 픽셀 바다=${seaLeft} / 방조제 너머 내륙=${landRight}`);

    // 2b) 고해상도 패치 (radiusM = 3000 -> zoom > 10)
    const finePatch = await M.loadDemPatch(37.3, 126.6, 3000, {
      renderer: rendererOk,
      loadTexture: async () => dummyTex(),
      tileUrl: (z, x, y) => `mem://${z}/${x}/${y}`,
    });
    ok(finePatch !== null && finePatch.zoom > 10 && finePatch.seaTexture === null,
      `근거리 고줌(zoom=${finePatch?.zoom}) 패치는 seaTexture 를 만들지 않음 (null)`);

    // 2c) readRenderTargetPixels 미지원 렌더러 폴백
    M.clearDemCache();
    const rendererNoRead = makeStubRenderer(false);
    const noReadPatch = await M.loadDemPatch(37.3, 126.6, 60000, {
      renderer: rendererNoRead,
      loadTexture: async () => dummyTex(),
      tileUrl: (z, x, y) => `mem://${z}/${x}/${y}`,
    });
    ok(noReadPatch !== null && noReadPatch.seaTexture === null,
      'readRenderTargetPixels 미지원 시 예외 없이 seaTexture=null 로 안전 폴백');

    // 2d) makeDemUniforms & dispose 전파
    const uNull = M.makeDemUniforms(null, 'demFar');
    ok(uNull.uDemFarSeaValid.value === 0 && uNull.uDemFarSeaTex.value === null,
      'makeDemUniforms(null) → uDemFarSeaValid=0 (기존 테스트 호환)');
    const uWide = M.makeDemUniforms(widePatch, 'demFar');
    ok(uWide.uDemFarSeaValid.value === 1 && uWide.uDemFarSeaTex.value === widePatch.seaTexture,
      'makeDemUniforms(widePatch) → uDemFarSeaValid=1 및 seaTexture 연결');

    let disposedSea = false;
    const origDispose = widePatch.seaTexture.dispose.bind(widePatch.seaTexture);
    widePatch.seaTexture.dispose = () => { disposedSea = true; origDispose(); };
    widePatch.dispose();
    finePatch.dispose();
    noReadPatch.dispose();
    ok(disposedSea === true, 'DemPatch.dispose() 가 seaTexture.dispose() 호출');
    M.clearDemCache();
  }

  console.log('\n[3] TerrainField & SeaPlane 셰이더 · 유니폼 · setPatch 검증');
  {
    ok(balancedBraces(M.FIELD_VERT) && balancedBraces(M.FIELD_FRAG), 'TerrainField 셰이더 중괄호 균형');
    ok(balancedPreproc(M.FIELD_VERT) && balancedPreproc(M.FIELD_FRAG), 'TerrainField 전처리기(#if/#endif) 균형');
    ok(balancedBraces(M.SEA_VERT) && balancedBraces(M.SEA_FRAG), 'SeaPlane 셰이더 중괄호 균형');
    ok(balancedPreproc(M.SEA_VERT) && balancedPreproc(M.SEA_FRAG), 'SeaPlane 전처리기(#if/#endif) 균형');

    const tfDups = findDuplicateUniforms(M.FIELD_FRAG);
    const spDups = findDuplicateUniforms(M.SEA_FRAG);
    ok(tfDups.length === 0 && spDups.length === 0,
      `중복 uniform 선언 없음 (TerrainField=${tfDups.length}, SeaPlane=${spDups.length})`);

    ok(
      M.FIELD_FRAG.includes('isSeaZone') &&
      M.FIELD_FRAG.includes('isSeaZone && vElevM <= 0.0') &&
      M.FIELD_FRAG.includes('(uDemValid > 0.5 && isSeaZone)'),
      'TerrainField: 내륙 0m discard 차단 및 갯벌 wetM/wet 게이트 포함',
    );
    ok(
      M.SEA_FRAG.includes('seaMask_seaAt(vGround.xz)') &&
      M.SEA_FRAG.includes('if (vWater < 0.5 || seaZone < 0.5) discard;'),
      'SeaPlane: SEA_FRAG 에서 동일 이진 마스크로 내륙 수면 차단 (경계 구멍 방지)',
    );

    const seaTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    seaTex.needsUpdate = true;
    const fineTex = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat);
    fineTex.needsUpdate = true;
    const fakePatch = (withSea) => ({
      texture: fineTex,
      originTileX: 0, originTileY: 0, zoom: withSea ? 9 : 13,
      blockTiles: 3, tileSpanM: withSea ? 60000 : 3000,
      observerU: 1.5, observerV: 1.5, coverage: 1,
      seaTexture: withSea ? seaTex : null,
      dispose: () => {},
    });

    const tf = M.createTerrainField({});
    const sp = M.createSeaPlane({});
    ok(tf.material.uniforms.uDemFarSeaValid.value === 0 && sp.material.uniforms.uSeaMaskSeaValid.value === 0,
      '초기 패치 없음 시 *SeaValid=0 (기존 동작 유지)');

    const pFine = fakePatch(false);
    const pWide = fakePatch(true);
    tf.setPatch(pFine, pFine, pWide);
    sp.setPatch(pFine, pWide);
    ok(
      tf.material.uniforms.uDemFarSeaValid.value === 1 &&
      tf.material.uniforms.uDemFarSeaTex.value === seaTex &&
      tf.material.uniforms.uDemSeaValid.value === 0 &&
      tf.material.uniforms.uDemFarDespike.value === 1,
      'TerrainField.setPatch(..., farPatch) 가 uDemFarSeaTex/Valid 및 despike 를 정확히 반영',
    );
    ok(
      sp.material.uniforms.uSeaMaskSeaValid.value === 1 &&
      sp.material.uniforms.uSeaMaskSeaTex.value === seaTex &&
      sp.material.uniforms.uDemSeaValid.value === 0,
      'SeaPlane.setPatch(..., maskPatch) 가 uSeaMaskSeaTex/Valid 를 정확히 반영',
    );

    tf.setPatch(pFine, pFine, null);
    sp.setPatch(pFine, null);
    ok(
      tf.material.uniforms.uDemFarSeaValid.value === 0 &&
      tf.material.uniforms.uDemFarSeaTex.value === null &&
      sp.material.uniforms.uSeaMaskSeaValid.value === 0 &&
      sp.material.uniforms.uSeaMaskSeaTex.value === null,
      'null 광역 패치 전달 시 *SeaValid=0 · *SeaTex=null 로 복귀',
    );

    tf.dispose();
    sp.dispose();
    seaTex.dispose();
    fineTex.dispose();
  }

  console.log('\n[4] waterMask 예비 원반 내륙 0m 방어 검증');
  {
    const AZ = 31;
    // y=63, x=96 → 동쪽(u≈+0.51, v≈0, r≈0.51 > beachR)
    const sampleEastIdx = (63 * 128 + 96) * 4;

    const inlandElevs = new Array(AZ * 3);
    for (let i = 0; i < AZ; i++) {
      inlandElevs[i * 3 + 0] = 0.0;  // 5km 내륙 평야 0m
      inlandElevs[i * 3 + 1] = 18.0; // 15km 육지
      inlandElevs[i * 3 + 2] = 45.0; // 40km 육지
    }
    const dryWf = new Array(AZ).fill(0.0);
    const wmInland = M.createWaterMask2DTexture({
      latitude: 37.5, longitude: 127.0, observerElevation: 0,
      elevations: inlandElevs, waterFrac: dryWf,
    });
    ok(wmInland.texture.image.data[sampleEastIdx] === 0,
      `내륙 e5=0m 단독(e15=+18m, e40=+45m, wf=0) → 수면=0 (실측 ${wmInland.texture.image.data[sampleEastIdx]})`);
    wmInland.dispose();

    const seaElevs = [...inlandElevs];
    for (let i = 0; i < AZ; i++) {
      seaElevs[i * 3 + 1] = -12.0; // 15km 진짜 바다
      seaElevs[i * 3 + 2] = -35.0; // 40km 진짜 바다
    }
    const wmSea = M.createWaterMask2DTexture({
      latitude: 37.25, longitude: 126.5, observerElevation: 2,
      elevations: seaElevs, waterFrac: dryWf,
    });
    ok(wmSea.texture.image.data[sampleEastIdx] === 255,
      `외해 연결(e5=0m, e15=-12m, e40=-35m) → 수면=255 (실측 ${wmSea.texture.image.data[sampleEastIdx]})`);
    wmSea.dispose();

    const eastWf = new Array(AZ).fill(0.0);
    eastWf[7] = 0.8;
    eastWf[8] = 0.8;
    const wmWfOnly = M.createWaterMask2DTexture({
      latitude: 37.25, longitude: 126.5, observerElevation: 2,
      waterFrac: eastWf,
    });
    ok(wmWfOnly.texture.image.data[sampleEastIdx] === 255,
      `waterFrac 전용(elevations 생략) 모드 → 동쪽 수면=255 (실측 ${wmWfOnly.texture.image.data[sampleEastIdx]})`);
    wmWfOnly.dispose();
  }

  console.log(`\npass ${pass} / fail ${fail}`);
  if (fail > 0) process.exit(1);
})();
