/**
 * **AR 시뮬레이터에 산이 실릴 자료가 가는가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 결함(사용자 보고): "촬영 결과 화면의 3D 시뮬레이션에 지형이 안 나온다."
 *
 * 원인: `SunCamera` 가 `sim.terrain` 으로 `{ observerElevation: 50 }` 만
 * 넘겼습니다. `SkyScene3D` 는 `sim.terrain.bandAngles` 가 있어야 산줄기를
 * 만드는데, 그 문이 늘 닫혀 있었습니다.
 *
 * 이 판정은 **씬이 쓰는 것과 같은 조건식**(`canDrawTerrainBands`)으로 물어봅니다 —
 * "고른 지형이 정말 산을 그리게 하는가".
 *
 * 사용: node tools/shader-preview/verify-terrain-pick.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

// 저장된 지형각은 어느 곡률 모델로 쟀는지(`curvatureModel`)를 달고 있고, 지금 모델과 다르면 `pickTerrainForLocation` 이 쓰지 않습니다
// (지형 시선 굴절 PR). 그래서 "정상" 자료는 지금 모델을 달아 둡니다.
let CURRENT_MODEL;
const realTerrain = (lat, lon, model = CURRENT_MODEL) => ({
  latitude: lat, longitude: lon,
  data: {
    bandAngles: [0, 10, 20, 30], bandDistancesKm: [5, 15, 40],
    waterFrac: [0, 0, 0.2, 0], observerElevation: 41,
    ...(model !== null ? { curvatureModel: model } : {}),   // null = 모델 표시 없는 옛 저장 자료
  },
});

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'terrainPick.js'));
  const { pickTerrainForLocation, canDrawTerrainBands, fallbackTerrain, isCurrentTerrainModel } = M;
  const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'earth.js'));
  CURRENT_MODEL = E.TERRAIN_CURVATURE_MODEL;

  console.log('\n[1] 결함 재현 — 예전에 넘기던 것으로는 산이 안 그려진다');
  {
    const old = { observerElevation: 50 };
    ok(canDrawTerrainBands(old) === false,
       '`{ observerElevation: 50 }` 은 산줄기 조건을 **못 넘는다** — 이게 원인이었다');
    ok(canDrawTerrainBands(fallbackTerrain()) === false,
       '대비책도 마찬가지다 (자료가 없으니 당연하다 — 조용히 넘어가지 않게 못 박는다)');
  }

  console.log('\n[2] 캐시에서 고르면 산이 그려진다');
  {
    const cache = [realTerrain(37.4863, 127.0443)];
    const picked = pickTerrainForLocation(cache, 37.4863, 127.0443);
    ok(picked !== null, '같은 자리의 캐시를 고른다');
    ok(canDrawTerrainBands(picked), '고른 지형은 산줄기 조건을 넘는다');
    ok(picked.observerElevation === 41, '관측점 고도도 실제 값이 온다 (박아 둔 50 이 아니라)');
  }

  console.log('\n[2b] 곡률 모델이 다른 저장 자료는 쓰지 않는다');
  {
    ok(typeof CURRENT_MODEL === 'string' && CURRENT_MODEL.length > 0, `지금 모델 이름이 있다 (${CURRENT_MODEL})`);
    ok(isCurrentTerrainModel(realTerrain(37, 127).data) === true, '지금 모델을 단 자료는 현재 것이다');
    ok(isCurrentTerrainModel(realTerrain(37, 127, 'old-flat-earth').data) === false, '다른 모델(예전 자료)은 현재 것이 아니다');
    ok(isCurrentTerrainModel(realTerrain(37, 127, null).data) === false, '모델 표시가 없는 옛 저장 자료도 현재 것이 아니다');
    ok(isCurrentTerrainModel(null) === false && isCurrentTerrainModel(undefined) === false, '자료가 없으면 현재 것이 아니다');
    ok(pickTerrainForLocation([realTerrain(37.4863, 127.0443, 'old-flat-earth')], 37.4863, 127.0443) === null,
       '같은 자리라도 옛 곡률 모델로 쟀던 캐시는 고르지 않는다(수평선과 어긋나 산·바다 판정이 틀어짐)');
    const mixed = [realTerrain(37.4863, 127.0443, 'old-flat-earth'), realTerrain(37.4863, 127.0443)];
    const got = pickTerrainForLocation(mixed, 37.4863, 127.0443);
    ok(got !== null && got.curvatureModel === CURRENT_MODEL, '옛 것과 지금 것이 같이 있으면 지금 것을 고른다');
  }

  console.log('\n[3] 허용 오차');
  {
    const cache = [realTerrain(37.5000, 127.0000)];
    ok(pickTerrainForLocation(cache, 37.5400, 127.0400) !== null, '0.04° 는 같은 자리로 본다');
    ok(pickTerrainForLocation(cache, 37.6000, 127.0000) === null, '0.10° 는 다른 자리다');
    ok(pickTerrainForLocation(cache, 37.5000, 127.2000) === null, '경도만 멀어도 다른 자리다');
  }

  console.log('\n[4] 없을 때 조용히 죽지 않는다');
  {
    ok(pickTerrainForLocation([], 37.5, 127.0) === null, '빈 캐시 → null');
    ok(pickTerrainForLocation(null, 37.5, 127.0) === null, 'null 캐시 → null');
    ok(pickTerrainForLocation(undefined, 37.5, 127.0) === null, 'undefined 캐시 → null');
    ok(pickTerrainForLocation([realTerrain(37.5, 127)], NaN, 127) === null, '좌표가 NaN → null');
  }

  console.log('\n[5] 여러 자리가 담겨 있어도 맞는 것을 고른다');
  {
    const cache = [realTerrain(35.1, 129.0), realTerrain(37.4863, 127.0443), realTerrain(33.4, 126.5)];
    const picked = pickTerrainForLocation(cache, 37.49, 127.05);
    ok(picked !== null && canDrawTerrainBands(picked), '서울 자리를 고르고 산이 그려진다');
    ok(pickTerrainForLocation(cache, 35.12, 129.02) !== null, '부산 자리도 고른다');
    ok(pickTerrainForLocation(cache, 40.0, 100.0) === null, '아무 데도 안 맞으면 null');
  }

  console.log('\n[6] 태양 추적 지평선·산 능선 가림 판정');
  {
    const { terrainHorizonDegAtAz, isSunVisibleAboveHorizon } = M;
    ok(terrainHorizonDegAtAz(null, 240) === 0, '지형이 없으면 0°');
    ok(terrainHorizonDegAtAz({ panoramicAngles: [10, 10], isFallback: true }, 180) === 0, 'fallback 지형은 0°');
    const hillTerrain = { panoramicAngles: [0, 0, 6, 0, 0], minAz: 0, maxAz: 360 };
    ok(Math.abs(terrainHorizonDegAtAz(hillTerrain, 180) - 6) < 1e-6, '180° 산 능선 6° 보간');
    ok(Math.abs(terrainHorizonDegAtAz(hillTerrain, 135) - 3) < 1e-6, '90°(0°)·180°(6°) 중간 135° 는 3°');
    ok(isSunVisibleAboveHorizon(0.0, 0.27, 0) === true, '지평선에 반쯤 걸린 태양은 보인다');
    ok(isSunVisibleAboveHorizon(-0.35, 0.27, 0) === false, '지평선 아래로 완전히 지면 안 보인다');
    ok(isSunVisibleAboveHorizon(5.6, 0.5, 6) === true, '6° 산 위로 원반 윗부분이 걸리면 보인다');
    ok(isSunVisibleAboveHorizon(5.4, 0.5, 6) === false, '6° 산 뒤로 완전히 넘어가면 안 보인다');
    ok(isSunVisibleAboveHorizon(2.0, 0.5, 0, false) === false, '시각 가시성이 false 면 안 보인다');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
