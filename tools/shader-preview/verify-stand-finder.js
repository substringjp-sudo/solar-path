/**
 * **서 있을 자리 찾기가 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/standFinder.ts` 는 대상 점에 해·달을 원하는 크기로 거는 자리와 때를 찾습니다. 두 가지로 견줍니다.
 *  - **앞으로 검산**: 찾은 자리마다, 그 자리에 서서 본 대상 점의 방위·겉보기 앙각을 따로 짠 삼각법으로 다시 구해 해·달(`bodySky`)과 견줍니다.
 *    방위는 0.01° 안, 앙각 차는 ε 안, 원반과 같은 크기(대상 길이 L 의 시각 크기 ÷ 원반 지름)는 2% 안.
 *  - **빠짐없이**: 같은 식을 0.25 분(15 초) 걸음으로 전부 걸으며 "ε 안으로 드는 구간"을 세어(느린 정답) 찾은 후보와 일대일로 맞춥니다.
 *    구간마다 후보가 하나, 후보는 모두 어느 구간 안, 시각 차 2 분 안. 놓침 0, 덤 0 이어야 합니다.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 평지(해발 12 m): 달 · 해, 꼭대기 50 m 에 원반 크기, 20 일. 앞으로 검산 · 빠짐없이.
 *  2. 경사진 땅(동으로 오름, 물결): 같은 두 가지. 자리의 지반 높이가 실제로 앙각을 바꾸는지.
 *  3. 크기: 전체 높이 555 m 면 비스듬한 거리가 약 61 km(원반 0.52° 기준, 1 km 안), 비율 0.5 면 두 배 멀리.
 *     실제 달로 걸면 원반이 0.4895~0.5586° 라 56.9~65.0 km, 그 거리에서 탑 꼭대기가 보이는 앙각이 0.5° 안쪽이라 달은 지평선 가까이.
 *  4. 가림: 서 있을 자리와 대상 사이에 산이 있으면 `visible: false`, 없으면 true. 산이 있는 세계에서 후보 수는 같고 표시만 갈린다.
 *  5. 물: `isWater` 가 참인 자리는 기본으로 빼고 `includeWater` 면 `onWater: true` 로 넣는다. 자료 밖(null)인 자리는 건너뛰되 죽지 않는다.
 *  6. 묶음: 12 시간 안의 후보는 한 묶음, 대표는 보이는 것 먼저 그다음 어긋남이 작은 것.
 *  7. 빠르다: 90 일이 2 초 안(구면 추적 걸음). 진행률은 늘기만 하고 1 에서 끝나며, 취소하면 지금까지를 돌려준다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-stand-finder.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

(async () => {
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'standFinder.js'));
  const A = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'alignSearch.js'));
  const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'earth.js'));
  const drop = E.curvatureDropM;

  const LAT = 37.5126, LON = 127.1026;
  const T_ELEV = 575;                       // 꼭대기 해발(m)
  const FROM = Date.parse('2026-11-19T00:00:00Z');
  const K = 111320;                         // 위도 1° 의 m (앱의 평면 근사와 같음)
  const REFF = E.EARTH_RADIUS_EFFECTIVE_M;  // 굴절을 넣은 유효 반지름(7/6 R)
  // 틀(원점 = 대상의 위경도)의 지상 좌표(동, 남 m) → 위경도: 앱이 지형·건물에 쓰는 평면 근사와 같은 식
  const framePos = (e, s) => ({ lat: LAT - s / K, lon: LON + e / (K * Math.cos(LAT * D2R)) });
  const base = (over = {}) => ({
    body: 'moon', target: { latitude: LAT, longitude: LON, elevM: T_ELEV }, targetXZ: { eastM: 0, southM: 0 },
    origin: { latitude: LAT, longitude: LON },
    sizeM: 50, fromMs: FROM, days: 20, epsDeg: 0.25, ground: () => 12, ...over,
  });

  // 느린 정답: 0.25 분 걸음으로 걸으며 ε 안으로 드는 구간을 센다.
  // 식은 여기서 따로 짠다: 서 있을 자리를 위경도의 닫힌 식으로 놓고(앱 장면의 평면 규칙: 자리에서 본 대상의 방위·거리가 d), 해·달은 **그 자리에서** 잰다.
  // 자리와 달 방위가 서로 물려 있어 네 번 되풀이한다(구현은 두 번).
  const bruteRuns = (q, stepMin = 0.25) => {
    const eps = q.epsDeg ?? 0.25, eye = q.eyeAboveGroundM ?? 1.6, ratio = q.sizeRatio ?? 1, T = q.target;
    const runs = [];
    let cur = null;
    const end = q.fromMs + q.days * 86400e3;
    for (let t = q.fromMs; t < end; t += stepMin * 60e3) {
      let sky = A.bodySky(q.body, t, T.latitude, T.longitude, T.elevM);
      let inside = false;
      if (sky.altDeg > -1.5) {
        let lat = T.latitude, lon = T.longitude, d = 0, g = null;
        for (let k = 0; k < 4; k++) {
          d = (q.sizeM / (2 * Math.tan((sky.diskDeg * ratio * D2R) / 2))) * Math.cos(sky.altDeg * D2R);
          const a = sky.azDeg * D2R;
          lat = T.latitude - (d * Math.cos(a)) / K;
          lon = T.longitude - (d * Math.sin(a)) / (K * Math.cos(lat * D2R));
          const e = (lon - q.origin.longitude) * K * Math.cos(q.origin.latitude * D2R), s = -(lat - q.origin.latitude) * K;
          g = q.ground(e, s);
          sky = A.bodySky(q.body, t, lat, lon, (g ?? T.elevM) + eye);
        }
        if (g != null) {
          const el = Math.atan2(T.elevM - (g + eye) - drop(d), d) * R2D;
          inside = sky.altDeg > -1.5 && Math.abs(sky.altDeg - el) <= eps;
        }
      }
      if (inside) { if (!cur) cur = { a: t, b: t }; else cur.b = t; } else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    return runs;
  };

  const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  // 앞으로 검산: 서 있을 자리를 위경도로 바꿔 거기서 본 대상 점을 두 가지 길로 다시 구한다 — 해·달은 그 자리에서 잰다(`bodySky`).
  //  (a) 앱 장면의 평면 규칙: 자리에서 본 대상의 동·북 오프셋 = (경도 차 × K × cos(자리 위도), 위도 차 × K). 방위가 해·달 방위와 같고 거리가 d 여야 한다.
  //  (b) 구면 위 벡터: 호 길이와 처음 방위는 하버사인, 눈과 대상은 유효 반지름 위의 점이라 대상의 앙각은 atan2(수직, 수평).
  //      구현의 낙차 식(d²/2R)과 따로 풀기 때문에, 달을 대상 위치에서 재고 있었다면 땅이 휜 만큼(d/R) 어긋나 여기서 걸린다.
  const forwardCheck = (q, h) => {
    const eye = q.eyeAboveGroundM ?? 1.6, T = q.target;
    const P = framePos(h.eastM, h.southM);
    const g = q.ground(h.eastM, h.southM);
    const hEye = g + eye;
    const eT = (T.longitude - P.lon) * K * Math.cos(P.lat * D2R), nT = (T.latitude - P.lat) * K;
    const dPlanar = Math.hypot(eT, nT);
    const azScene = ((Math.atan2(eT, nT) * R2D) + 360) % 360;
    const f1 = P.lat * D2R, f2 = T.latitude * D2R, dl = (T.longitude - P.lon) * D2R;
    const hav = Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    const arc = 2 * E.EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(hav)));
    const azSphere = ((Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * R2D) + 360) % 360;
    const th = arc / REFF;
    const elVec = Math.atan2((REFF + T.elevM) * Math.cos(th) - (REFF + hEye), (REFF + T.elevM) * Math.sin(th)) * R2D;
    const sky = A.bodySky(q.body, h.timeMs, P.lat, P.lon, hEye);
    const skyAtT = A.bodySky(q.body, h.timeMs, T.latitude, T.longitude, T.elevM);
    const r = Math.hypot(dPlanar, T.elevM - hEye);
    const sizeAng = 2 * Math.atan(q.sizeM / (2 * r)) * R2D;
    const want = sky.diskDeg * (q.sizeRatio ?? 1);
    return {
      dAzScene: Math.abs(wrap180(azScene - sky.azDeg)),
      dAzSphere: Math.abs(wrap180(azSphere - sky.azDeg)),
      dAlt: Math.abs(sky.altDeg - elVec),
      sizeErr: Math.abs(sizeAng / want - 1),
      dDist: Math.abs(dPlanar - h.distM),
      tilt: skyAtT.altDeg - sky.altDeg, arc, d: dPlanar,
    };
  };

  const compare = (label, q, hits, runs) => {
    let worstAz = 0, worstEl = 0, worstSize = 0, worstDist = 0;
    for (const h of hits) { const c = forwardCheck(q, h); worstAz = Math.max(worstAz, c.dAzScene); worstEl = Math.max(worstEl, c.dAlt); worstSize = Math.max(worstSize, c.sizeErr); worstDist = Math.max(worstDist, c.dDist); }
    ok(hits.length > 0, `${label}: 후보 ${hits.length} 개`);
    ok(worstAz < 0.005 && worstEl <= (q.epsDeg ?? 0.25) + 0.002 && worstSize < 0.02 && worstDist < 1, `${label}: 앞으로 검산 — 방위 차 최대 ${worstAz.toFixed(4)}° · 앙각 차(구면 벡터) 최대 ${worstEl.toFixed(4)}° (ε ${q.epsDeg ?? 0.25}°) · 크기 차 최대 ${(worstSize * 100).toFixed(2)}% · 거리 차 최대 ${worstDist.toFixed(2)} m`);
    let missed = 0, extra = 0;
    for (const r of runs) { const c = (r.a + r.b) / 2; if (!hits.some(h => h.timeMs >= r.a - 2 * 60e3 && h.timeMs <= r.b + 2 * 60e3 && Math.abs(h.timeMs - c) <= 2 * 60e3 + (r.b - r.a) / 2)) missed++; }
    for (const h of hits) if (!runs.some(r => h.timeMs >= r.a - 2 * 60e3 && h.timeMs <= r.b + 2 * 60e3)) extra++;
    ok(missed === 0 && extra === 0 && hits.length === runs.length, `${label}: 느린 정답과 일대일 — 구간 ${runs.length} · 후보 ${hits.length} · 놓침 ${missed} · 덤 ${extra}`);
  };

  // ── [1] 평지 ──
  console.log('\n[1] 평지 — 달 · 해');
  {
    const q = base();
    const hits = await S.findStandPoints(q);
    compare('달 평지', q, hits, bruteRuns(q));
    const d0 = hits[0].distM, slant = S.neededSlantDistanceM(50, hits[0].diskDeg);
    ok(Math.abs(d0 - slant * Math.cos(hits[0].altDeg * D2R)) < 1, `자리까지 지상 거리 ${d0.toFixed(0)} m = 비스듬한 거리 ${slant.toFixed(0)} m × cos(고도)`);
    ok(hits.every(h => h.visible && !h.onWater && h.groundElevM === 12), '평지라 모두 보이고 물이 아니다');
    const qs = base({ body: 'sun' });
    const hs = await S.findStandPoints(qs);
    compare('해 평지', qs, hs, bruteRuns(qs));
  }

  // ── [2] 경사진 땅 ──
  console.log('\n[2] 경사진 땅(동으로 오르고 물결)');
  {
    const slope = (e, s) => 12 + 0.02 * e + 6 * Math.sin(s / 900) + 4 * Math.cos(e / 700);
    const q = base({ ground: slope });
    const hits = await S.findStandPoints(q);
    compare('달 경사', q, hits, bruteRuns(q));
    ok(hits.some(h => Math.abs(h.groundElevM - 12) > 3), `자리의 지반 높이가 실제로 다르다(평지 12 m 아닌 자리 ${hits.filter(h => Math.abs(h.groundElevM - 12) > 3).length} 곳) — 지반이 앙각 조건을 바꾼다`);
    const flatHits = await S.findStandPoints(base());
    const sameTimes = hits.filter(h => flatHits.some(f => Math.abs(f.timeMs - h.timeMs) < 60e3)).length;
    ok(sameTimes < hits.length, '평지와 경사지의 후보 시각이 다르다(경사가 시각을 옮긴다)');
  }

  // ── [3] 크기 ──
  console.log('\n[3] 크기 → 거리');
  {
    const r555 = S.neededSlantDistanceM(555, 0.52);
    ok(Math.abs(r555 - 61150) < 600, `전체 높이 555 m, 원반 0.52°: 비스듬한 거리 ${(r555 / 1000).toFixed(1)} km (61 km ± 0.6)`);
    ok(Math.abs(S.neededSlantDistanceM(50, 0.52) - 5510) < 60, `꼭대기 50 m: ${(S.neededSlantDistanceM(50, 0.52) / 1000).toFixed(2)} km (5.5 km)`);
    ok(Math.abs(S.neededSlantDistanceM(50, 0.52, 0.5) / S.neededSlantDistanceM(50, 0.52, 1) - 2) < 0.01, '비율 0.5(원반이 대상의 절반 크기)면 두 배 멀리');
    // 달 원반은 먼 쪽(406,700 km)에서 0.4895°, 가까운 쪽(356,400 km)에서 0.5586°. 높이 555 m 를 그 크기로 걸면
    // 비스듬한 거리는 555 / (2·tan(원반/2)) = 56.9 ~ 65.0 km. 탑이 이 거리에서 보이는 앙각은 0.5° 안쪽이라 달은 지평선 가까이에 있고 cos(고도) ≈ 1.
    const q = base({ sizeM: 555, days: 6 });
    const hits = await S.findStandPoints(q);
    const lo = 555 / (2 * Math.tan(0.5586 * D2R / 2)), hi = 555 / (2 * Math.tan(0.4895 * D2R / 2));
    ok(Math.abs(lo - 56930) < 100 && Math.abs(hi - 64960) < 100, `달 크기 양 끝에서 비스듬한 거리 ${(lo / 1000).toFixed(1)} ~ ${(hi / 1000).toFixed(1)} km`);
    ok(hits.length > 0 && hits.every(h => h.distM > lo * 0.999 && h.distM < hi * 1.001), `전체 높이로 걸면 자리가 ${(lo / 1000).toFixed(1)}~${(hi / 1000).toFixed(1)} km 안이다 (${hits.map(h => (h.distM / 1000).toFixed(1)).join(', ')} km)`);
    ok(hits.every(h => h.altDeg < 1.5), `그 거리에서는 달이 지평선 가까이(고도 1.5° 아래)에 있다 (최대 ${Math.max(...hits.map(h => h.altDeg)).toFixed(2)}°)`);
  }

  // ── [3b] 둥근 땅 ──
  console.log('\n[3b] 먼 거리에서는 땅이 휜다 — 해·달은 서 있는 자리에서 잰다');
  {
    // 서 있는 자리 P 의 수직은 대상 위치 T 의 수직과 호/지구반지름(rad)만큼 틀어져 있고, P 는 해·달 방위의 반대쪽이라 달이 그만큼 낮게 보입니다.
    // 5.5 km 에서 0.049°(걸림 허용 0.25° 의 5분의 1), 61 km 에서 0.55°(원반 한 지름). 달을 T 에서 재면 61 km 의 서 있는 자리에서는 달이 지평선 아래에 놓입니다.
    // 이 검사는 달을 서 있는 자리에서 쟀는지 가리는 독립 길입니다: 대상 점의 앙각을 구면 벡터로 따로 구해 달과 견줍니다.
    // 앱의 평면 규칙으로 놓은 자리에서 본 대상의 방위와 구면 위 처음 방위의 차: 자리가 대상에서 d 만큼 어느 방위에 있든 훑어 최악을 센다
    // (자오선이 모이는 몫. 5.5 km 에서 0.021°, 62 km 에서 0.235°, 65 km 에서 0.246°).
    const worstConvergence = (d) => {
      let worst = 0;
      for (let a = 0; a < 360; a += 0.5) {
        const lat = LAT - (d * Math.cos(a * D2R)) / K, lon = LON - (d * Math.sin(a * D2R)) / (K * Math.cos(lat * D2R));
        const f1 = lat * D2R, f2 = LAT * D2R, dl = (LON - lon) * D2R;
        const az = ((Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * R2D) + 360) % 360;
        worst = Math.max(worst, Math.abs(wrap180(az - a)));
      }
      return worst;
    };
    for (const [label, size, days, tolTilt] of [['꼭대기 50 m · 5.5 km', 50, 30, 0.02], ['전체 555 m · 61 km', 555, 30, 0.12]]) {
      const q = base({ sizeM: size, days });
      const hits = await S.findStandPoints(q);
      const maxSph = worstConvergence(Math.max(...hits.map(h => h.distM))) * 1.02 + 0.001;
      let wSph = 0, wScene = 0, wAlt = 0, tiltErr = 0, minAlt = Infinity, maxAlt = -Infinity, tiltMax = 0;
      for (const h of hits) {
        const c = forwardCheck(q, h);
        wSph = Math.max(wSph, c.dAzSphere); wScene = Math.max(wScene, c.dAzScene); wAlt = Math.max(wAlt, c.dAlt);
        const expectTilt = (c.arc / E.EARTH_RADIUS_M) * R2D;
        tiltErr = Math.max(tiltErr, Math.abs(c.tilt - expectTilt)); tiltMax = Math.max(tiltMax, expectTilt);
        minAlt = Math.min(minAlt, h.altDeg); maxAlt = Math.max(maxAlt, h.altDeg);
      }
      ok(hits.length > 0, `${label}: 후보 ${hits.length} 곳`);
      ok(tiltErr < tolTilt, `${label}: 대상 위치에서 잰 달 고도 − 서 있는 자리에서 잰 달 고도 = 호 / 지구 반지름 (최대 ${tiltMax.toFixed(3)}°, 차이 최대 ${tiltErr.toFixed(3)}° < ${tolTilt}°) — 굴절 차 포함`);
      ok(wScene < 0.005 && wAlt <= 0.25 + 0.002, `${label}: 앱 장면의 방위 차 최대 ${wScene.toFixed(4)}° · 대상 앙각(구면 벡터)과 달 고도 차 최대 ${wAlt.toFixed(4)}° (허용 0.25°)`);
      ok(wSph <= maxSph, `${label}: 구면 실제 방위와의 차 최대 ${wSph.toFixed(3)}° ≤ 분석적 최악 ${maxSph.toFixed(3)}° (앱의 평면 세계가 자오선 수렴을 무시하는 몫; 이 거리 범위에서 방위를 다 훑어 센 값 + 2%)`);
      if (size === 555) ok(minAlt > -0.2 && maxAlt < 1.0, `${label}: 서 있는 자리의 달 고도가 지평선 위 ${minAlt.toFixed(2)}° ~ ${maxAlt.toFixed(2)}° 안(대상 꼭대기 앙각 약 0.29° ± 0.25°) — 달이 지평선 아래로 가지 않는다`);
    }
  }

  // ── [4] 가림 ──
  console.log('\n[4] 땅이 가림');
  {
    // 대상에서 남서쪽 2.6 km 에 길게 선 능선(해발 +250 m, 폭 0.4 km): 그 너머 자리는 대상 꼭대기를 못 본다
    const ridge = (e, s) => 12 + 250 * Math.exp(-(((e * 0.7071 - s * 0.7071) + 0) ** 2 + 0) / (2 * 1e30)) * 0 + 250 * Math.exp(-((((-e) * 0.7071 + s * 0.7071) - 2600) ** 2) / (2 * 200 ** 2));
    const q = base({ ground: ridge, days: 30 });
    const withRidge = await S.findStandPoints(q);
    const noRidge = await S.findStandPoints(base({ days: 30 }));
    ok(withRidge.length > 0 && withRidge.some(h => !h.visible) && withRidge.some(h => h.visible), `산이 있으면 보이는 자리와 가려진 자리가 섞인다 (보임 ${withRidge.filter(h => h.visible).length} · 가림 ${withRidge.filter(h => !h.visible).length})`);
    ok(noRidge.length > 0 && noRidge.every(h => h.visible), '산이 없으면 모두 보인다');
  }

  // ── [5] 물 · 자료 밖 ──
  console.log('\n[5] 물과 자료 밖');
  {
    const water = (e, s) => s > 0;   // 대상의 남쪽 반은 물
    const dry = await S.findStandPoints(base({ isWater: water, days: 30 }));
    const wet = await S.findStandPoints(base({ isWater: water, days: 30 }), { includeWater: true });
    ok(dry.length > 0 && dry.every(h => !h.onWater && h.southM <= 0), `물 자리를 빼면 남은 ${dry.length} 곳이 모두 땅(남쪽 반 아님)`);
    ok(wet.length > dry.length && wet.filter(h => h.onWater).length === wet.length - dry.length, `includeWater 면 물 자리가 onWater 로 들어온다 (+${wet.length - dry.length})`);
    let threw = false, partial = [];
    try { partial = await S.findStandPoints(base({ ground: (e) => (e < -2000 ? null : 12), days: 30 })); } catch (e) { threw = true; }
    ok(!threw && partial.every(h => h.eastM >= -2000), `자료 밖(서쪽 2 km 너머) 자리는 건너뛰고 죽지 않는다 (${partial.length} 곳, 모두 자료 안)`);
    const none = await S.findStandPoints(base({ ground: () => null, days: 5 }));
    ok(none.length === 0, '자료가 아예 없으면 후보 0');
  }

  // ── [6] 묶음 ──
  console.log('\n[6] 묶음');
  {
    const mk = (hours, err, visible) => ({ timeMs: FROM + hours * 3600e3, errDeg: err, visible });
    const g = S.groupStandHits([mk(1, 0.2, true), mk(3, 0.05, true), mk(40, 0.1, false), mk(41, 0.2, true), mk(100, 0.3, true)]);
    ok(g.length === 3 && g[0].count === 2 && g[0].best.timeMs === FROM + 3 * 3600e3, '4 시간 안 둘이 한 묶음, 대표는 어긋남이 작은 것');
    ok(g[1].count === 2 && g[1].best.visible === true && g[1].best.timeMs === FROM + 41 * 3600e3, '보이는 것이 어긋남이 작은 가려진 것보다 먼저 대표가 된다');
    ok(g[2].count === 1 && S.groupStandHits([]).length === 0, '혼자인 후보는 한 묶음, 빈 목록은 빈 목록');
    ok(S.groupStandHits([mk(0, 0.1, true), mk(11, 0.1, true), mk(23, 0.1, true)]).length === 3, '11~12 시간 간격(뜨는 쪽과 지는 쪽)은 합치지 않는다');
    ok(S.groupStandHits([mk(0, 0.1, true), mk(4, 0.1, true), mk(8.1, 0.1, true)]).length === 2, '경계: 4 시간 간격은 한 묶음, 4.1 시간은 따로');
    {
      // 평지 90 일: 후보가 모두 6 시간 넘게 떨어져 있어 묶어도 줄지 않는다(뜨는 쪽 하루 한 번, 지는 쪽 하루 한 번)
      const hits = await S.findStandPoints(base({ days: 90 }));
      const alt = (ms) => A.bodySky('moon', ms, LAT, LON, T_ELEV).altDeg;
      const rising = hits.filter(h => alt(h.timeMs + 60e3) - alt(h.timeMs - 60e3) > 0).length;
      const gaps = hits.slice(1).map((h, i) => (h.timeMs - hits[i].timeMs) / 3600e3);
      ok(S.groupStandHits(hits).length === hits.length && Math.min(...gaps) > 6, `평지 90 일 ${hits.length} 곳: 최소 간격 ${Math.min(...gaps).toFixed(1)} h 로 묶어도 그대로`);
      const expectedPasses = 2 * 90 / 1.0351;   // 하루 = 24.84 h(달의 하루) 라 90 일에 뜸 · 짐이 각각 약 87 번
      ok(Math.abs(rising - hits.length / 2) <= 1 && Math.abs(hits.length - expectedPasses) <= 3, `뜨는 쪽 ${rising} · 지는 쪽 ${hits.length - rising}, 기대 ${expectedPasses.toFixed(1)} 곳(달의 하루 24.84 h)`);
    }
  }

  // ── [7] 속도 · 진행 · 취소 ──
  console.log('\n[7] 속도와 진행');
  {
    const progress = [];
    const t0 = performance.now();
    const hits = await S.findStandPoints(base({ days: 90 }), { onProgress: f => progress.push(f) });
    const ms = performance.now() - t0;
    ok(ms < 2000, `90 일 ${ms.toFixed(0)} ms (2 초 안), 후보 ${hits.length}`);
    ok(progress.length >= 1 && progress.every((f, i) => i === 0 || f >= progress[i - 1]) && progress[progress.length - 1] === 1, `진행률이 늘기만 하고 1 에서 끝난다 (${progress.length} 번)`);
    let calls = 0;
    const cut = await S.findStandPoints(base({ days: 90 }), { isCancelled: () => ++calls > 1 });
    ok(cut.length <= hits.length, `취소하면 지금까지만 돌려준다 (${cut.length} ≤ ${hits.length})`);
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
