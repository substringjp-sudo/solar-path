/**
 * **지상 ↔ 지도 ↔ 구 전환이 끊기지 않는가** 판정(§153). 브라우저가 필요 없습니다.
 *
 * 사용: node tools/shader-preview/verify-globe-transition.js   (esbuild 로 순수 모듈만 묶어 씁니다 — stage-esm 불필요)
 *
 *  [1] 형태 0 의 구 겹 = 구글 타일(웹 메르카토르)과 화면 자리가 같음 — 겹 바꾸기 구간에서 땅이 두 겹으로 안 번짐.
 *  [2] 형태 1 = d3 정사영 그대로. 한가운데 축척은 형태와 상관없이 같음(가운데 땅이 제자리).
 *  [3] 형태가 진행도에 대해 연속·단조, 프레임 사이 화면 자리가 튀지 않음. 역투영이 정투영을 되돌림.
 *  [4] 겹 바꾸기가 형태 바꾸기보다 먼저 끝남(구 겹이 다 덮은 뒤에야 휘기 시작).
 *  [5] 손을 뗀 뒤 — 겹침 구간 안에서 멈추지 않음, 밖이면 그대로, 움직이던 쪽을 따름, 감속 곡선의 첫 기울기 = 손가락 속도.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'globetr-'));
  const entry = path.join(outDir, 'entry.ts');
  fs.writeFileSync(entry, [
    `export * as Z from '${path.join(ROOT, 'src/utils/zoomContinuum.ts')}';`,
    `export * as M from '${path.join(ROOT, 'src/utils/mapProjection.ts')}';`,
    `export * as G from '${path.join(ROOT, 'src/utils/globeMorph.ts')}';`,
    `export * as d3 from 'd3-geo';`,
  ].join('\n'));
  const out = path.join(outDir, 'bundle.mjs');
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--outfile=' + out, '--log-level=error',
    '--resolve-extensions=.ts,.js,.mjs', '--alias:d3-geo=' + path.join(ROOT, 'node_modules/d3-geo')], { cwd: ROOT, stdio: 'inherit' });
  const { Z, M, G, d3 } = await import('file://' + out);
  const RAD = Math.PI / 180;
  const W = 390, H = 844;
  const proj = (morph, lat0, lon0, R) => {
    const base = morph >= 1 ? d3.geoOrthographic() : d3.geoProjection(G.morphRaw(morph, lat0));
    return base.scale(R).translate([W / 2, H / 2]).rotate([-lon0, -lat0]).clipAngle(G.morphClipAngle(morph, lat0));
  };
  /** 구글 타일(웹 메르카토르) 화면 자리 — 폭 W 에 경도 Δλ. */
  const tile = (lat0, lon0, dLon, lon, lat) => {
    const k = W / (dLon * RAD);
    const y = (p) => Math.log(Math.tan(Math.PI / 4 + p * RAD / 2));
    return [W / 2 + k * (lon - lon0) * RAD, H / 2 - k * (y(lat) - y(lat0))];
  };
  const CENTERS = [[37.5, 127], [0, 30], [59.9, 10.7], [-34, 151]];

  console.log('[1] 형태 0 = 타일');
  for (const [lat0, lon0] of CENTERS) {
    for (const dLon of [Z.VEC_FADE_LO_DEG, Z.VEC_FADE_HI_DEG, Z.MORPH_LO_DEG]) {
      const R = M.globeRadiusForDelta(lat0, dLon, W);
      const P = proj(0, lat0, lon0, R);
      let worst = 0;
      for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
        const lon = lon0 + i * dLon / 8, lat = Math.max(-80, Math.min(80, lat0 + j * dLon / 8));
        const a = P([lon, lat]), b = tile(lat0, lon0, dLon, lon, lat);
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      ok(worst < 0.5, `(${lat0}, ${lon0}) 폭 ${dLon}°: 최대 어긋남 ${worst.toFixed(3)} px`);
    }
  }

  console.log('[2] 형태 1 = 정사영, 한가운데 축척 일치');
  for (const [lat0, lon0] of CENTERS) {
    const R = 900;
    const P1 = proj(1, lat0, lon0, R), PO = d3.geoOrthographic().scale(R).translate([W / 2, H / 2]).rotate([-lon0, -lat0]).clipAngle(90);
    const a = P1([lon0 + 20, lat0 + 10]), b = PO([lon0 + 20, lat0 + 10]);
    ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, `(${lat0}, ${lon0}) 정사영과 같음`);
    // 한가운데에서 북쪽·동쪽 0.01° 의 화면 거리가 형태와 상관없이 같음
    let spread = 0;
    const ref = [];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const P = proj(t, lat0, lon0, R);
      const c = P([lon0, lat0]);
      const n = P([lon0, lat0 + 0.01]);
      const e = P([lon0 + 0.01, lat0]);
      const v = [Math.hypot(n[0] - c[0], n[1] - c[1]), Math.hypot(e[0] - c[0], e[1] - c[1]), Math.hypot(c[0] - W / 2, c[1] - H / 2)];
      if (!ref.length) ref.push(...v);
      spread = Math.max(spread, Math.abs(v[0] / ref[0] - 1), Math.abs(v[1] / ref[1] - 1), v[2]);
    }
    ok(spread < 1e-3, `(${lat0}, ${lon0}) 한가운데 자리·축척이 형태마다 같음(최대 차 ${spread.toExponential(1)})`);
  }

  console.log('[3] 연속·단조, 역투영');
  for (const [lat0] of [[37.5], [0], [59.9]]) {
    const aspect = W / H;
    let prevM = -1, mono = true, worstStep = 0, worstPx = 0;
    for (let p = Z.P_HANDOFF; p <= Z.P_MAX; p += 0.002) {
      const d = Z.lonDeltaForProgress(p, lat0, aspect);
      const m = Z.globeMorphForLonDelta(d);
      if (m < prevM - 1e-12) mono = false;
      if (prevM >= 0) {
        worstStep = Math.max(worstStep, m - prevM);
        // 같은 축척에서 형태만 바꿨을 때 화면 가장자리(동쪽 40%·북쪽 20%) 점이 움직인 px
        const R = M.globeRadiusForDelta(lat0, d, W);
        const pt = [127 + d * 0.4, Math.max(-80, Math.min(80, lat0 + d * 0.2))];
        const a = proj(prevM, lat0, 127, R)(pt), b = proj(m, lat0, 127, R)(pt);
        if (a && b) worstPx = Math.max(worstPx, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      prevM = m;
    }
    ok(mono, `위도 ${lat0}: 형태가 진행도에 대해 단조`);
    ok(worstStep < 0.02 && worstPx < 6, `위도 ${lat0}: 진행도 0.002 걸음마다 형태 변화 ≤ ${worstStep.toFixed(4)}, 가장자리 점 ≤ ${worstPx.toFixed(2)} px`);
  }
  for (const t of [0, 0.3, 0.5, 0.7, 1]) {
    const P = proj(t, 37.5, 127, 700);
    let worst = 0;
    for (const [lo, la] of [[127, 37.5], [140, 45], [110, 20], [100, 60], [150, 10]]) {
      const s = P([lo, la]); const g = P.invert(s);
      worst = Math.max(worst, d3.geoDistance(g, [lo, la]) / RAD);
    }
    ok(worst < 1e-4, `형태 ${t}: 역투영 오차 ${worst.toExponential(1)}°`);
  }

  console.log('[4] 겹 바꾸기가 형태 바꾸기보다 먼저');
  ok(Z.VEC_FADE_HI_DEG < Z.MORPH_LO_DEG, `겹 끝 ${Z.VEC_FADE_HI_DEG}° < 형태 시작 ${Z.MORPH_LO_DEG}°`);
  ok(Z.globeLayerOpacityForLonDelta(Z.VEC_FADE_LO_DEG) === 0 && Z.globeLayerOpacityForLonDelta(Z.VEC_FADE_HI_DEG) === 1, '겹 불투명도 0 → 1');
  ok(Z.globeMorphForLonDelta(Z.MORPH_LO_DEG) === 0 && Z.globeMorphForLonDelta(Z.MORPH_HI_DEG) === 1, '형태 0 → 1');
  {
    const lat = 37.5, aspect = W / H;
    ok(Z.progressForLonDelta(Z.VEC_FADE_LO_DEG, lat, aspect) > Z.P_HANDOFF, '겹 바꾸기는 지도 단계 안(넘기는 점 뒤)');
    ok(Z.lonDeltaForProgress(Z.P_MAX, lat, aspect) >= Z.MORPH_HI_DEG, '진행도 끝에서 완전한 구');
  }

  console.log('[4b] 섞인 형태의 테두리(극 바로 앞)가 화면 밖 — 극을 품은 다각형이 곧은 띠로 칠해지지 않게');
  for (const aspect of [0.43, 0.46, 0.75, 1.43]) {
    const w = 400, h = w / aspect;
    let worst = null;
    // 위도 75° 까지(지도 한가운데가 그보다 극에 가까우면 섞이는 동안 화면 모서리에 자른 자리가 조금 보입니다).
    // 테두리가 지평(90°)에서 1.5° 안이면 자른 게 아니라 구의 둘레 그 자체라 셈하지 않습니다.
    for (let lat0 = -75; lat0 <= 75; lat0 += 5) {
      for (const f of [0, 0.25, 0.5, 0.75, 0.999]) {
        const dLon = Z.MORPH_LO_DEG * Math.pow(Z.MORPH_HI_DEG / Z.MORPH_LO_DEG, f);
        const m = Z.globeMorphForLonDelta(dLon);
        if (m >= 1) continue;
        const R = M.globeRadiusForDelta(lat0, dLon, w);
        const P = (morph => (morph >= 1 ? d3.geoOrthographic() : d3.geoProjection(G.morphRaw(morph, lat0)))
          .scale(R).translate([w / 2, h / 2]).rotate([-127, -lat0]))(m);
        if (G.morphClipAngle(m, lat0) > 88.5) continue;
        const th = G.morphClipAngle(m, lat0) * RAD;
        const c = [127 * RAD, lat0 * RAD];
        for (let b = 0; b < 360; b += 2) {
          // 한가운데에서 방위 b 로 th 만큼 간 점
          const br = b * RAD;
          const la = Math.asin(Math.sin(c[1]) * Math.cos(th) + Math.cos(c[1]) * Math.sin(th) * Math.cos(br));
          const lo = c[0] + Math.atan2(Math.sin(br) * Math.sin(th) * Math.cos(c[1]), Math.cos(th) - Math.sin(c[1]) * Math.sin(la));
          const q = P([lo / RAD, la / RAD]);
          if (q && q[0] > 0 && q[0] < w && q[1] > 0 && q[1] < h) { worst = worst ?? `위도 ${lat0} 폭 ${dLon.toFixed(1)}° 방위 ${b}°`; }
        }
      }
    }
    ok(!worst, `화면비 ${aspect}: 테두리가 화면 안에 든 경우 ${worst ?? '없음'}`);
  }

  console.log('[4c] 지도 단계 내내 구 손잡이 반지름이 실제 축척(구 maxRadius 1e7 안) — 끌기 속도·줌 범위가 안 잘림(§154)');
  {
    let worst = 0;
    for (const aspect of [0.43, 0.75, 1.43]) for (let lat = -75; lat <= 75; lat += 5) {
      const R = M.globeRadiusForDelta(lat, Z.lonDeltaForProgress(Z.P_HANDOFF, lat, aspect), 430);
      worst = Math.max(worst, R);
    }
    ok(worst < 1e7, `넘기는 점의 최대 반지름 ${Math.round(worst)} px < 1e7 (예전 상한 20000)`);
  }
  ok(Z.progressFromPinch(Z.P_MAX, 1e-6) === 0, '두 손가락 한 번으로 지구본 끝에서 지상(0)까지 갈 수 있음');

  console.log('[5] 손을 뗀 뒤');
  for (const [lat0] of [[37.5], [0], [59.9]]) {
    const aspect = W / H;
    let stuck = 0;
    const bands = Z.crossfadeBands(lat0, aspect);
    for (let p = 0; p <= Z.P_MAX; p += 0.001) {
      for (const r of [-2, -0.5, 0, 0.5, 2]) {
        const s = Z.settleProgress(Z.flingProgress(p, r), lat0, aspect, r);
        for (const [lo, hi] of bands) if (s > lo + 1e-9 && s < hi - 1e-9) stuck++;
      }
    }
    ok(stuck === 0, `위도 ${lat0}: 겹침 구간 안에서 멈춘 경우 ${stuck}`);
    const [lo, hi] = bands[1];
    const mid = (lo + hi) / 2;
    ok(Z.settleProgress(mid, lat0, aspect, 0.3) === hi && Z.settleProgress(mid, lat0, aspect, -0.3) === lo, `위도 ${lat0}: 가운데에서는 움직이던 쪽 끝으로`);
    ok(Z.settleProgress(lo + 0.1 * (hi - lo), lat0, aspect, 0) === lo, `위도 ${lat0}: 가까운 끝으로`);
  }
  ok(Z.settleProgress(0.5, 37.5, W / H, 0) === 0.5 && Z.settleProgress(2.6, 37.5, W / H, 0) === 2.6, '겹침 구간 밖이면 그대로(지상 0.5·구 2.6)');
  ok(Z.flingProgress(1, 100) === 1 + Z.FLING_MAX_RATE * Z.FLING_TAU_S && Z.flingProgress(0.05, -3) === 0, '미끄러짐은 속도 상한·0~끝 안');
  {
    const from = 1.6, to = 1.75, rate = 1.2;   // 길이 상한(650 ms)에 안 걸리는 경우
    const D = Z.settleDurationMs(from, to, rate) / 1000;
    const h = 1e-4;
    const slope = (to - from) * (Z.easeOutCubic(h / D) - Z.easeOutCubic(0)) / h;
    ok(Math.abs(slope / rate - 1) < 0.01, `첫 기울기 ${slope.toFixed(3)}/s = 손가락 속도 ${rate}/s`);
    ok(Z.settleDurationMs(1, 1, 0) === 0, '갈 거리가 없으면 애니메이션 없음');
  }
  ok(Z.pinchRateFromSamples([{ t: 1000, p: 1.5 }, { t: 1100, p: 1.6 }], 1110) > 0.99, '표본 속도 1/s');
  ok(Z.pinchRateFromSamples([{ t: 1000, p: 1.5 }, { t: 1100, p: 1.6 }], 1300) === 0, '멈췄다 떼면 0');

  console.log(`\n${pass}/${pass + fail} 통과`);
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
