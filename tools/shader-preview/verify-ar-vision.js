/**
 * **AR 화면 보정** 판정 (`src/utils/arVision.ts`). `build-ar-vision.js` 의 짝.
 *
 * 앱 렌더러가 **정답 자세**로 그린 화면에, 일부러 틀린 센서 자세를 붙여 보정을 돌립니다.
 *
 * ## 화면이 두 벌인 이유
 *
 * 렌더러의 지형 격자는 봉우리를 꼭짓점 사이에서 낮게 그립니다(§94, 최대 0.35° · 먼 격자는
 * 더). 그 화면으로만 재면 **알고리즘**이 아니라 **렌더러의 능선 오차**를 잽니다 — 처음 판이
 * 그랬습니다(요네자와 한 장면이 DEM 과 5.6화소 어긋나 방위를 5.5° 틀리게 풂).
 *
 *  - **정확 화면**: 렌더의 하늘·지형 색을 쓰되, 지형 부분을 열마다 **DEM 능선에 정확히**
 *    옮겨 붙인 것. 알고리즘이 할 수 있는 만큼을 잽니다(정확도).
 *  - **렌더 화면**: 그대로. 실제 카메라도 DEM 과 어긋납니다(나무·연무·DEM 의 30m 뭉갬).
 *    여기서는 **틀린 값을 확신하지 않는가**(안전성)만 봅니다.
 *
 * ## 자
 *
 * - 능선 찾기(정확 화면): 열마다 찾은 경계 후보(둘) 중 가까운 것과 DEM 능선의 차, 중앙값 ≤ 0.7화소.
 * - 해 찾기: 온전히 보이는 해는 2화소 안에서 찾고, 능선에 걸린 해는 "걸림" 으로 표시.
 * - 정확도(정확 화면): 센서 오차(방위 ±6~18°, 앙각·기울기 ≤ 1.5°)에서
 *     DEM 능선이 방위를 가려 주는 화면(DEM 만으로 따로 판단)의 80% 이상에서 방위를 풀고,
 *     풀었다고 하면 ≤ 0.5°. 앙각·기울기는 산에서는 고치지 않습니다(설계, 아래 주석).
 * - 안전성(렌더 화면): 방위를 풀었다고 한 것은 모두 1° 안.
 *
 * ## 대조 (자가 헛돌지 않는가)
 *
 * - 바다: 방위를 **못 푼다**고 해야 하고, 앙각·기울기는 풀어야 합니다. 해가 있으면 해로 방위를 풉니다.
 * - 엉뚱한 장소의 DEM 을 주면 믿을 만하다고 하지 않아야 합니다.
 * - 하늘만 보이면 능선으로 풀지 않아야 합니다.
 * - 나무·건물을 흉내 낸 기둥이 열의 25% 를 가려도 버텨야 합니다.
 * - 보정 없이 센서대로면 능선이 몇 화소씩 어긋나 있다 — 되돌린 것이 보정 덕.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');
const { makeCpuDem } = require('./dem-cpu');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

/**
 * 센서 오차 — [방위, 앙각, 기울기]. 결정적(난수 없음)이라 돌릴 때마다 같습니다.
 *
 * 방위는 크게(자기계는 수~수십 도 틀립니다), 앙각·기울기는 1.5° 안(가속도계 기울기는
 * 원래 그만큼 맞습니다). ⚠ 처음에는 앙각·기울기도 ±3° 로 넣었습니다. 실제 폰에서 안 나오는
 * 크기이고, 그만큼 흔들면 "방위를 옮기는 것" 과 "비탈을 기울이는 것" 이 구별되지 않아
 * 풀이에 기울기 사전값(σ 1.5°)을 두면서 오차도 현실 크기로 줄였습니다.
 */
const ERRORS = [[12, 1, -0.8], [-18, -1.2, 1], [6, -0.5, 0.6], [-7, 1.5, -1.2]];
/**
 * 방위 구별력(도)이 이만큼 되는 시야만 "풀 수 있어야 할 화면" 으로 셉니다 — 분석 화면의
 * **화소 하나**(가로 화각 60° ÷ 240화소 = 0.25°). 다른 방위로 옮긴 능선이 화소 하나보다 덜
 * 어긋나면 화소 단위 감지로는 원래 못 가립니다.
 * ⚠ 처음에는 근거 없이 0.15° 로 두었고, 그 경계에 걸린 시야 셋(요네자와 320° · 덕유산 0° ·
 *   240°, 모두 0.15°)이 못 풀어 80% 를 못 넘었습니다. 화소 기준으로 바꾸면 요네자와 200°(0.23°)
 *   도 빠지는데, 그 시야는 정확 화면에서 방위를 4.8° 틀리게 풀려다 **유보한** 곳입니다 — 빠진
 *   것이 문턱 덕이라는 점을 여기 남깁니다.
 */
const IDENT_MIN = 0.25;

(async () => {
  const V = await import('file://' + path.join(PREVIEW, 'app/utils/arVision.js'));
  const cfg = JSON.parse(fs.readFileSync(path.join(PREVIEW, 'ar-vision.json'), 'utf8'));
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/ar-vision.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);
  const { W, H, HFOV } = st;
  const K = V.intrinsicsFromHfov(W, H, HFOV);

  // 앱이 쓸 CPU DEM(`demCpu.ts`)이 판정의 참조 구현(`dem-cpu.js`)과 같은 값을 내는가.
  // 디코드는 pngjs 로 대신합니다(앱은 Skia).
  {
    const D = await import('file://' + path.join(PREVIEW, 'app/utils/demCpu.js'));
    let maxDiff = 0, nPts = 0, nullMismatch = 0, hMax = 0;
    for (const s of cfg.sites) {
      const dir = path.join(PREVIEW, s.dir);
      const load = async (zoom) => D.loadCpuDemBlock(s.lat, s.lon, zoom === s.zFine ? cfg.FINE_M : cfg.FAR_M,
        async (url) => { const f = path.join(dir, url.split('/').pop()); return fs.existsSync(f) ? Uint8Array.from(PNG.sync.read(fs.readFileSync(f)).data) : null; },
        { tileUrl: (z, x, y) => `${z}_${x}_${y}.png` });
      const fineApp = await load(s.zFine), farApp = await load(s.zFar);
      const refF = makeCpuDem({ demDir: dir, zoom: s.zFine, lat: s.lat, lon: s.lon });
      const refC = makeCpuDem({ demDir: dir, zoom: s.zFar, lat: s.lat, lon: s.lon });
      for (let i = 0; i < 400; i++) {
        const ang = i * 2.3999, rr = 50 + (i * 137.5) % 50000;
        const e = rr * Math.cos(ang), so = rr * Math.sin(ang);
        for (const [a, r] of [[fineApp.elevAtGround, refF.elevAtGround], [farApp.elevAtGround, refC.elevAtGround]]) {
          const va = a(e, so), vr = r(e, so);
          if ((va == null) !== (vr == null)) { nullMismatch++; continue; }
          if (va == null) continue;
          nPts++; maxDiff = Math.max(maxDiff, Math.abs(va - vr));
        }
      }
      const appH = V.horizonProfile(D.combineSamplers(fineApp.elevAtGround, farApp.elevAtGround), s.eyeM);
      const refH = V.horizonProfile((e, so) => refF.elevAtGround(e, so) ?? refC.elevAtGround(e, so), s.eyeM);
      for (let i = 0; i < appH.elevDeg.length; i++) hMax = Math.max(hMax, Math.abs(appH.elevDeg[i] - refH.elevDeg[i]));
    }
    ok(nPts > 1000 && maxDiff < 1e-6 && nullMismatch === 0 && hMax < 1e-6,
      `앱의 CPU DEM(demCpu.ts)이 참조와 같다 — ${nPts}점 최대 차 ${maxDiff.toExponential(1)}m, 블록 안팎 불일치 ${nullMismatch}, 지평선 최대 차 ${hMax.toExponential(1)}°`);
  }

  const horizons = {};
  for (const s of cfg.sites) {
    const dir = path.join(PREVIEW, s.dir);
    const fine = makeCpuDem({ demDir: dir, zoom: s.zFine, lat: s.lat, lon: s.lon });
    const far = makeCpuDem({ demDir: dir, zoom: s.zFar, lat: s.lat, lon: s.lon });
    horizons[s.key] = V.horizonProfile((e, so) => fine.elevAtGround(e, so) ?? far.elevAtGround(e, so), s.eyeM);
  }
  const H_ = (f) => horizons[f.site];

  // ── 정확 화면: 지형을 열마다 DEM 능선에 옮겨 붙입니다 ──
  const exactFrame = (f) => {
    const out = new Uint8Array(W * H * 3);
    const bsis = V.cameraBasis(f.att);
    const hp = H_(f);
    for (let x = 0; x < W; x++) {
      let rTop = H; // 렌더에서 지형이 시작하는 행
      for (let y = 0; y < H; y++) if (f.mask[y * W + x]) { rTop = y; break; }
      // DEM 이 말하는 첫 지형 행(화소 가운데 기준)
      let dTop = H;
      for (let y = 0; y < H; y++) { const d = V.unproject(x + 0.5, y + 0.5, f.att, K, bsis); if (d.el < V.horizonAt(hp, d.az)) { dTop = y; break; } }
      for (let y = 0; y < H; y++) {
        let sy;
        if (y < dTop) sy = Math.min(y, Math.max(0, rTop - 1));                 // 하늘: 렌더의 하늘을 아래로 늘림
        else sy = rTop < H ? Math.min(H - 1, rTop + (y - dTop)) : y;            // 지형: 렌더의 지형을 DEM 능선부터
        const i = (sy * W + x) * 3, o = (y * W + x) * 3;
        out[o] = f.rgb[i]; out[o + 1] = f.rgb[i + 1]; out[o + 2] = f.rgb[i + 2];
      }
    }
    return { width: W, height: H, channels: 3, data: out };
  };
  const renderFrame = (f) => ({ width: W, height: H, channels: 3, data: Uint8Array.from(f.rgb) });
  const add = (a, e) => ({ yawDeg: a.yawDeg + e[0], pitchDeg: a.pitchDeg + e[1], rollDeg: a.rollDeg + e[2] });

  /**
   * 이 시야의 DEM 능선이 **방위를 가려 줄 수 있나**(도) — 풀이와 무관하게 DEM 만으로.
   *
   * 능선을 δ(≥1.5°) 만큼 옮긴 뒤 앙각·기울기(= 상수 + 기울기 직선)로 최대한 맞췄을 때 남는
   * 잔차의 최솟값. 작으면 다른 방위도 똑같이 들어맞는 능선이라 **못 푸는 것이 정답**입니다.
   * ⚠ 처음에는 "직선을 뺀 능선 표준편차" 로 모양을 쟀는데, 그건 옮긴 능선이 기울기로
   *   흉내 내지는 경우를 못 봐서 요네자와의 모호한 시야 셋을 "풀 수 있어야 할 화면" 에 넣었습니다.
   */
  const identOf = (f) => {
    const half = HFOV / 2 - 3;
    const xs = []; for (let a = -half; a <= half; a += 0.5) xs.push(a);
    const base = xs.map(a => V.horizonAt(H_(f), f.att.yawDeg + a));
    let best = Infinity;
    for (let d = -20; d <= 20; d += 0.25) {
      if (Math.abs(d) < 1.5) continue;
      const diff = xs.map((a, i) => V.horizonAt(H_(f), f.att.yawDeg + a + d) - base[i]);
      const mx = xs.reduce((q, v) => q + v, 0) / xs.length, my = diff.reduce((q, v) => q + v, 0) / diff.length;
      let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (diff[i] - my); sxx += (xs[i] - mx) ** 2; }
      const sl = sxy / sxx; let r = 0; for (let i = 0; i < xs.length; i++) r += (diff[i] - my - sl * (xs[i] - mx)) ** 2;
      best = Math.min(best, Math.sqrt(r / xs.length));
    }
    return best;
  };
  const shapeOf = (f) => {
    const half = HFOV / 2 - 3;
    const xs = [], ys = [];
    for (let a = -half; a <= half; a += 0.5) { xs.push(a); ys.push(V.horizonAt(H_(f), f.att.yawDeg + a)); }
    const mx = xs.reduce((p2, v) => p2 + v, 0) / xs.length, my = ys.reduce((p2, v) => p2 + v, 0) / ys.length;
    let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const sl = sxy / sxx; let r = 0; for (let i = 0; i < xs.length; i++) r += (ys[i] - my - sl * (xs[i] - mx)) ** 2;
    return Math.sqrt(r / xs.length);
  };

  const detect = (f, fr) => {
    const inFrame = f.sunPx && f.sunPx.x > 0 && f.sunPx.x < W && f.sunPx.y > 0 && f.sunPx.y < H;
    const disc = inFrame ? V.detectBrightDisc(fr, { near: { x: f.sunPx.x, y: f.sunPx.y, radius: 80 } }) : null;
    const mask = disc ? [[disc.x - 16, disc.x + 16]] : [];
    return { disc, mask, sky: V.detectSkyline(fr, { maskColumns: mask }), inFrame };
  };
  const solve = (f, fr, det, sensor, horizon, useSun = true) => {
    const points = [];
    if (useSun && det.disc && !det.disc.partial) points.push({ x: det.disc.x, y: det.disc.y, azDeg: f.sun.az, elDeg: f.sun.alt });
    return V.solveAttitude({ intrinsics: K, sensor, horizon, skyline: det.sky, points });
  };

  // ── 접촉 인화 (정확 화면 · 렌더 화면) ──
  const sheet = new PNG({ width: W * 6, height: H * Math.ceil(st.frames.length / 6) * 2 });
  const put = (img, x, y, r, g, bl) => { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const o = (y * img.width + x) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255; };
  const rowsPerSet = Math.ceil(st.frames.length / 6);

  console.log('\n== 찾기 ==');
  const E = st.frames.map((f, idx) => {
    const ex = exactFrame(f), rf = renderFrame(f);
    const dE = detect(f, ex), dR = detect(f, rf);
    const pred = V.predictSkyline(H_(f), f.att, K);
    const diffs = [];
    // 열마다 두 후보(가장 센 경계 · 위에서 처음 나오는 경계) 중 DEM 에 가까운 것.
    // ⚠ 처음에는 가장 센 경계 하나만 쟀고, 연무에 흐린 먼 능선 밑의 지면 경계를 잡은 장면이
    //   23화소까지 어긋났습니다. 어느 쪽이 능선인지는 화면만으로 못 가르므로 찾기는 둘을
    //   넘기고 풀이가 고르게 바꿨습니다 — 여기서도 그 둘 중 가까운 것을 잽니다.
    //
    // ⚠ 경계가 **보이는 열**만 셉니다(DEM 능선 위 3화소와 아래 3화소의 밝기 차 ≥ 4/255).
    //   요네자와 30° 는 1.26화소로 걸렸는데, 열을 찍어 보니 140~220열은 능선 바로 아래 먼 지형이
    //   하늘과 거의 같은 밝기(하늘 195 · 지형 193)였습니다 — 연무에 묻혀 **안 보이는** 능선이라 어떤
    //   감지기도 못 찾습니다. 안 보이는 열이 틀린 풀이로 이어지지 않는지는 정확도·안전성 절이 봅니다.
    const lumE = (x, y) => { const i = (y * W + x) * 3; return (0.2126 * ex.data[i] + 0.7152 * ex.data[i + 1] + 0.0722 * ex.data[i + 2]) / 255; };
    let hiddenCols = 0;
    for (let x = 0; x < W; x++) {
      if (!(pred[x] > 4 && pred[x] < H - 4)) continue;
      const y0 = Math.round(pred[x]);
      let a = 0, c2 = 0; for (let t = 1; t <= 3; t++) { a += lumE(x, y0 - t); c2 += lumE(x, y0 + t - 1); }
      if (Math.abs(a - c2) / 3 < 4 / 255) { hiddenCols++; continue; }
      const c = [dE.sky.row[x], dE.sky.alt ? dE.sky.alt[x] : NaN].filter(Number.isFinite);
      if (c.length) diffs.push(Math.min(...c.map(v => Math.abs(v - pred[x]))));
    }
    diffs.sort((a, c) => a - c);
    const draw = (fr, det, set) => {
      const ox = (idx % 6) * W, oy = (Math.floor(idx / 6) + set * rowsPerSet) * H;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; put(sheet, ox + x, oy + y, fr.data[i], fr.data[i + 1], fr.data[i + 2]); }
      for (let x = 0; x < W; x++) {
        if (pred[x] >= 0 && pred[x] < H) put(sheet, ox + x, oy + Math.round(pred[x]), 0, 255, 0);
        if (Number.isFinite(det.sky.row[x])) put(sheet, ox + x, oy + Math.round(det.sky.row[x]), 255, 0, 0);
      }
      if (det.disc) for (let t = -4; t <= 4; t++) { put(sheet, ox + Math.round(det.disc.x) + t, oy + Math.round(det.disc.y), 255, 0, 255); put(sheet, ox + Math.round(det.disc.x), oy + Math.round(det.disc.y) + t, 255, 0, 255); }
    };
    draw(ex, dE, 0); draw(rf, dR, 1);
    // DEM 능선 자리에 밝기 경계가 실제로 있나 — 위 3화소와 아래 3화소의 밝기 차(0~1)의 열 중앙값.
    // 연무에 묻힌 먼 능선은 여기가 거의 0 이라 어떤 감지기도 못 찾습니다.
    const lum = (x, y) => { const i = (y * W + x) * 3; return (0.2126 * ex.data[i] + 0.7152 * ex.data[i + 1] + 0.0722 * ex.data[i + 2]) / 255; };
    const cs = [];
    for (let x = 0; x < W; x++) {
      const y0 = Math.round(pred[x]);
      if (!(y0 >= 4 && y0 < H - 4)) continue;
      let a = 0, c2 = 0; for (let t = 1; t <= 3; t++) { a += lum(x, y0 - t); c2 += lum(x, y0 + t - 1); }
      cs.push(Math.abs(a - c2) / 3);
    }
    cs.sort((a, c2) => a - c2);
    const edge = cs.length ? cs[cs.length >> 1] : 0;
    return { f, ex, rf, dE, dR, med: diffs.length ? diffs[diffs.length >> 1] : NaN, n: diffs.length, hiddenCols, shape: shapeOf(f), ident: identOf(f), edge };
  });
  fs.writeFileSync(path.join(PREVIEW, '..', 'ar-vision-sheet.png'), PNG.sync.write(sheet));
  for (const e of E) console.log(`  ${e.f.site.padEnd(9)} [${e.f.att.yawDeg},${e.f.att.pitchDeg},${e.f.att.rollDeg}]  능선 차 ${Number.isFinite(e.med) ? e.med.toFixed(2) : '—'}px (${e.n}열${e.hiddenCols ? ` · 안 보이는 열 ${e.hiddenCols}` : ''}) · 능선 모양 ${e.shape.toFixed(2)}° · 방위 구별력 ${e.ident.toFixed(2)}° · 경계 ${(e.edge * 255).toFixed(1)}`
    + (e.dE.inFrame ? ` · 해 ${e.dE.disc ? (e.dE.disc.partial ? '걸림' : Math.hypot(e.dE.disc.x - e.f.sunPx.x, e.dE.disc.y - e.f.sunPx.y).toFixed(1) + 'px') : '못 찾음'}` : ''));
  // 경계 값(아래 표)은 DEM 능선 자리의 위·아래 밝기 차 — 보이는 능선인지 확인하려고 찍습니다.
  // ⚠ 덕유산 북쪽이 2.9화소로 걸렸을 때 "경계가 안 보인다" 고 짐작했는데, 재 보니 37/255 로 뚜렷했고
  //   부호가 반대(연무 낀 먼 산이 하늘보다 밝음)였습니다. 그래서 자를 바꾸지 않고 감지를 고쳤습니다.
  const withSky = E.filter(e => e.n >= 30);
  ok(withSky.every(e => e.med <= 0.7), `정확 화면: 찾은 능선이 DEM 능선과 맞는다 — 중앙값 ≤ 0.7화소 (최대 ${Math.max(...withSky.map(e => e.med)).toFixed(3)}px, ${withSky.length}장)`);
  const suns = E.filter(e => e.dE.inFrame);
  const sunFull = suns.filter(e => e.dE.disc && !e.dE.disc.partial);
  const sunGood = sunFull.filter(e => Math.hypot(e.dE.disc.x - e.f.sunPx.x, e.dE.disc.y - e.f.sunPx.y) <= 2);
  const sunMissing = suns.filter(e => !e.dE.disc);
  ok(sunMissing.length === 0 && sunGood.length === sunFull.length && sunFull.length >= 3,
    `화면 안의 해: 온전한 해는 2화소 안(${sunGood.length}/${sunFull.length}), 걸린 해는 걸림 표시(${suns.length - sunFull.length - sunMissing.length}), 못 찾음 ${sunMissing.length}`);

  console.log('\n== 정확도 (정확 화면) ==');
  const land = E.filter(e => e.f.site !== 'haeundae');
  const shaped = land.filter(e => e.ident >= IDENT_MIN);
  let yawN = 0, yawOK = 0, tiltN = 0, tiltOK = 0, total = 0, worst = { y: 0, p: 0, r: 0 };
  for (const e of land) for (const er of ERRORS) {
    const r = solve(e.f, e.ex, e.dE, add(e.f.att, er), H_(e.f));
    const ry = Math.abs(V.wrap180(r.dYaw + er[0]));
    const rp = Math.abs(r.dPitch + er[1]), rr = Math.abs(r.dRoll + er[2]);
    if (e.ident >= IDENT_MIN) { total++; if (r.yawObservable) yawN++; else if (process.env.WHY) console.log(`    · 못 풂 ${e.f.site} [${e.f.att.yawDeg}] 오차 [${er}] 원방위 ${Number.isFinite(r.rawYaw) ? Math.abs(V.wrap180(r.rawYaw + er[0])).toFixed(2) : '-'} 인라이어 ${r.inlierFrac.toFixed(2)} 잔차 ${r.residualDeg.toFixed(3)} 구별 ${r.yawDistinct.toFixed(2)} 차 ${r.yawGap.toFixed(3)} ${r.reason || ''}`); }
    if (process.env.WHY && r.yawObservable) console.log(`    · 풂 ${e.f.site} [${e.f.att.yawDeg}] 남은 ${ry.toFixed(2)} 구별 ${r.yawDistinct.toFixed(2)} 차 ${r.yawGap.toFixed(3)}`);
    if (process.env.WHY && r.tiltObservable && (rp > 0.3 || rr > 0.3)) console.log(`    · 기울기 ✗ ${e.f.site} [${e.f.att.yawDeg}] 오차 [${er}] 앙각 ${rp.toFixed(2)} 기울기 ${rr.toFixed(2)} 인라이어 ${r.inlierFrac.toFixed(2)}`);
    if (r.yawObservable) { if (ry <= 0.5) yawOK++; else console.log(`    ✗ ${e.f.site} [${e.f.att.yawDeg}] 오차 [${er}] 남은 방위 ${ry.toFixed(2)}°`); worst.y = Math.max(worst.y, ry); }
    if (r.tiltObservable) { tiltN++; if (rp <= 0.3 && rr <= 0.3) tiltOK++; worst.p = Math.max(worst.p, rp); worst.r = Math.max(worst.r, rr); }
  }
  const claimed = land.length * ERRORS.length;
  ok(yawN >= total * 0.8, `DEM 능선이 방위를 가려 주는 화면(구별력 ≥ ${IDENT_MIN}°, ${shaped.length}/${land.length}장)의 80% 이상에서 방위를 푼다 (${yawN}/${total})`);
  let claimsAll = 0;
  for (const e of land) for (const er of ERRORS) { const r = solve(e.f, e.ex, e.dE, add(e.f.att, er), H_(e.f)); if (r.yawObservable) claimsAll++; }
  ok(yawOK === claimsAll, `방위를 풀었다고 하면 0.5° 안이다 (${yawOK}/${claimsAll}, 최악 ${worst.y.toFixed(2)}°)`);
  // ⚠ 처음 자는 "산 화면의 80% 에서 앙각·기울기를 0.3° 안으로" 였습니다. 재 보니 산 능선의
  //   기울기는 절반쯤만 고쳐졌고(1.0° → 0.38°) 연무 화면은 앙각을 0.8° 틀려, 산에서는 기울기를
  //   **안 고치기로** 했습니다(arVision.ts). 자도 그 설계를 잽니다 — 산에서는 0건, 바다는 아래 대조.
  ok(tiltN === 0, `산 화면에서는 앙각·기울기를 고치지 않는다 — 센서 그대로 (${tiltN}/${claimed})`);

  console.log('\n== 안전성 (렌더 화면 — DEM 과 어긋난 그대로) ==');
  let rClaims = 0, rBad = 0, rWorst = 0;
  for (const e of land) for (const er of ERRORS) {
    const r = solve(e.f, e.rf, e.dR, add(e.f.att, er), H_(e.f));
    if (!r.yawObservable) continue;
    rClaims++;
    const ry = Math.abs(V.wrap180(r.dYaw + er[0]));
    rWorst = Math.max(rWorst, ry);
    if (ry > 1.0) { rBad++; console.log(`    ✗ ${e.f.site} [${e.f.att.yawDeg}] 오차 [${er}] 남은 방위 ${ry.toFixed(2)}°`); }
  }
  ok(rBad === 0, `렌더 화면에서 방위를 풀었다고 한 것은 모두 1° 안 (${rClaims - rBad}/${rClaims}, 최악 ${rWorst.toFixed(2)}°) · 푼 비율 ${(rClaims / claimed * 100).toFixed(0)}%`);

  console.log('\n== 대조 ==');
  const sea = E.filter(e => e.f.site === 'haeundae');
  let seaYaw = 0, seaTiltOK = 0, seaN = 0, seaSunOK = 0, seaSunN = 0;
  for (const e of sea) for (const er of ERRORS) {
    const r = solve(e.f, e.ex, e.dE, add(e.f.att, er), H_(e.f), false);
    seaN++;
    if (r.yawObservable) seaYaw++;
    if (r.tiltObservable && Math.abs(r.dPitch + er[1]) <= 0.3 && Math.abs(r.dRoll + er[2]) <= 0.3) seaTiltOK++;
    if (e.dE.disc && !e.dE.disc.partial) {
      seaSunN++;
      const rs = solve(e.f, e.ex, e.dE, add(e.f.att, er), H_(e.f), true);
      if (rs.yawObservable && Math.abs(V.wrap180(rs.dYaw + er[0])) <= 0.5) seaSunOK++;
    }
  }
  ok(seaYaw === 0, `바다(해 안 씀): 방위를 풀었다고 하지 않는다 (${seaYaw}/${seaN})`);
  ok(seaTiltOK === seaN, `바다: 앙각·기울기는 0.3° 안으로 푼다 (${seaTiltOK}/${seaN})`);
  ok(seaSunN > 0 && seaSunOK === seaSunN, `바다 + 해: 해로 방위를 0.5° 안으로 (${seaSunOK}/${seaSunN})`);
  {
    let claim = 0, n = 0;
    for (const e of land) {
      const other = e.f.site === 'yonezawa' ? 'gurye' : 'yonezawa';
      const r = solve(e.f, e.ex, e.dE, add(e.f.att, ERRORS[0]), horizons[other], false);
      if (process.env.WHY) console.log(`    · 엉뚱 DEM ${e.f.site} 구별 ${r.yawDistinct.toFixed(2)} 차 ${r.yawGap.toFixed(3)} 인라이어 ${r.inlierFrac.toFixed(2)} 잔차 ${r.residualDeg.toFixed(3)}`);
      n++;
      if (r.yawObservable) claim++;
    }
    ok(claim === 0, `엉뚱한 장소의 DEM 이면 방위를 풀었다고 하지 않는다 (${claim}/${n})`);
  }
  {
    const e = land[0];
    const sensor = { ...e.f.att, pitchDeg: 60 };
    const pred = V.predictSkyline(H_(e.f), sensor, K);
    const r = V.solveAttitude({ intrinsics: K, sensor, horizon: H_(e.f), skyline: { row: new Float32Array(W).fill(NaN), strength: new Float32Array(W) }, points: [] });
    ok(r.source === 'none' && pred.every(v => v === H), `하늘만 보이면 능선으로 풀지 않는다 (${r.source}${r.reason ? ' — ' + r.reason : ''})`);
  }
  {
    let n = 0, good = 0, base = 0;
    for (const e of land) {
      const fr = exactFrame(e.f);
      const pred = V.predictSkyline(H_(e.f), e.f.att, K);
      for (let blk = 0; blk < 4; blk++) {
        const x0 = (blk * 61 + 13) % (W - 20), wdt = Math.round(W * 0.0625);
        for (let x = x0; x < Math.min(W, x0 + wdt); x++) {
          const top = Math.max(0, Math.round((pred[x] >= 0 && pred[x] < H ? pred[x] : H * 0.6) - 18 - (blk % 2) * 12));
          for (let y = top; y < H; y++) { const o = (y * W + x) * 3; fr.data[o] = 25; fr.data[o + 1] = 30; fr.data[o + 2] = 22; }
        }
      }
      const det = detect(e.f, fr);
      const r0 = solve(e.f, e.ex, e.dE, add(e.f.att, ERRORS[1]), H_(e.f));
      if (r0.yawObservable) base++;
      const r = solve(e.f, fr, det, add(e.f.att, ERRORS[1]), H_(e.f));
      if (process.env.WHY && r0.yawObservable && !r.yawObservable) console.log(`    · 가림에 못 풂 ${e.f.site} [${e.f.att.yawDeg}] 원방위 ${Math.abs(V.wrap180(r.rawYaw + ERRORS[1][0])).toFixed(2)} 인라이어 ${r.inlierFrac.toFixed(2)} 잔차 ${r.residualDeg.toFixed(3)} 구별 ${r.yawDistinct.toFixed(2)} 차 ${r.yawGap.toFixed(3)}`);
      if (!r.yawObservable) continue;
      n++;
      // 방위만 봅니다 — 산에서는 앙각·기울기를 일부러 안 고칩니다(위 정확도 절).
      if (Math.abs(V.wrap180(r.dYaw + ERRORS[1][0])) <= 0.5) good++;
    }
    ok(n >= base * 0.7 && good === n, `나무·건물 기둥이 25% 를 가려도 — 풀었다고 하면 맞다 (${good}/${n}), 가리기 전 ${base}장 중 ${n}장을 푼다`);
  }
  {
    const e = land.find(x => x.ident >= IDENT_MIN) ?? land[0], er = ERRORS[0];
    const ps = V.predictSkyline(H_(e.f), add(e.f.att, er), K), pt = V.predictSkyline(H_(e.f), e.f.att, K);
    let d = 0, n = 0;
    for (let x = 0; x < W; x++) if (ps[x] >= 0 && ps[x] < H && pt[x] >= 0 && pt[x] < H) { d += Math.abs(ps[x] - pt[x]); n++; }
    ok(n > 0 && d / n > 3, `보정 없이 센서대로면 능선이 ${n ? (d / n).toFixed(1) : '—'}화소 어긋난다 (대조)`);
  }
  {
    const cal = V.createVisionCalibrator();
    const er = ERRORS[0];
    const e = land.find(x => solve(x.f, x.ex, x.dE, add(x.f.att, er), H_(x.f)).yawObservable);
    const r = solve(e.f, e.ex, e.dE, add(e.f.att, er), H_(e.f));
    for (let i = 0; i < 5; i++) cal.push(r, 40, i * 300);
    const moving = cal.correction();
    for (let i = 0; i < 12; i++) cal.push(r, 1, 2000 + i * 300);
    const still = cal.correction();
    ok(moving.dYaw === 0 && cal.status().locked && Math.abs(V.wrap180(still.dYaw + er[0])) <= 0.6,
      `빨리 돌릴 땐 안 받고, 멈추면 잠긴다 (움직일 때 ${moving.dYaw.toFixed(2)}° → 멈춘 뒤 남은 오차 ${Math.abs(V.wrap180(still.dYaw + er[0])).toFixed(2)}°)`);
  }

  console.log(`\n접촉 인화: .harness/ar-vision-sheet.png — 위 ${rowsPerSet}줄 정확 화면, 아래 ${rowsPerSet}줄 렌더 화면 (빨강 찾은 능선 · 초록 DEM 능선 · 자홍 찾은 해)`);
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
