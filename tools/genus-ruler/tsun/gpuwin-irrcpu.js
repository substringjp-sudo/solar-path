/**
 * §180 L7irrprobe CPU 쪽 — GPU 탐침(gpuwin-irrentry.ts)이 읽어 온 값과 같은 식의 CPU 이식, 기준표 대조, 출렁임·과밝음·산란 자르기 지표.
 * 브라우저 없음 · 부작용 없음(require 해도 아무것도 돌지 않음). gpuwin-irrprobe.js(실행기)와 gpuwin-irrtest.js(마른 시험)가 씀.
 *
 * (a) GPU vs CPU 이식: CPU 는 **GPU 에서 texelFetch 로 읽어 온 같은 표**로 lightingFix.ts 의 GetIrradiance 끔/켬 식을 계산(uv 계산은 float32 흉내,
 *     쌍선형은 float64) — 차이 = 셰이더 산술·하드웨어 필터 정밀도만. 기대 [estimate]: 필터 가중치가 float 이면 ~1e−6, 8 비트 급이면 ~1e−3.
 * (b) 세밀 기준(fixtures/irradiance-app15.json fine: μs 505 절점 · r 0/4/8/12 km — 산란 표 μs 128 칸으로 다시 계산): μs 는 절점 사이 log 선형,
 *     r 은 이웃 두 행 선형(GPU 와 같은 r 처리 — μs 보간만 가름). 절점 치우침 b = GPU 표 절점 Y ÷ 기준 절점 Y(앱 산란 표 32 칸 몫 — 이 고침 밖)를
 *     따로 재고 q = E ÷ (기준 · b(e)) 로 보간만의 오차를 봄(verify-lighting-fixes.js (d)(4) 와 같은 정의).
 * 출렁임: 텍셀마다(높이 행마다) ln q 의 1.8° 창(37 걸음 × 0.05°, μs 한 칸 ≈ 1.82°/cos e) 봉우리 간격 최댓값 — 기준 있는 지표.
 *         + 기준 없는 지표: gpuwin-lib pulsing(ln Y − 국소 2차 맞춤 ±1.5°, L3twilight 과 같은 정의).
 * 문턱은 이 파일에 고정(lightingFix.ts 값을 그대로 믿지 않음 — 시험이 대조).
 */
'use strict';
const G = require('./gpuwin-lib');

const PIN = { FLOOR: 1e-30, RAMP_LO: Math.LN2, RAMP_HI: 2 * Math.LN2 };
/** 기본 탐침 인자(실행기가 페이지에 넘김 — 열쇠에 들어감). */
const DEFAULT_PARAMS = Object.freeze({
  heightsKm: [0, 2, 5, 7.4], eFrom: -12, eTo: 10, eStep: 0.05,
  bands: [[-12, -10], [-10, -6], [-6, -3], [-3, 0], [0, 2], [2, 5], [5, 10]], eOver: -9.4, winSteps: 37,
  aerial: { grid: [80, 60], deckKm: 7.4, elBands: [[6, 10], [5, 15]] },
});
const F = Math.fround;
const Yof = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** e 격자(°) — 소수 오차 없이(k 배). */
function eGrid(p = DEFAULT_PARAMS) {
  const n = Math.round((p.eTo - p.eFrom) / p.eStep) + 1, out = [];
  for (let k = 0; k < n; k++) out.push(+(p.eFrom + k * p.eStep).toFixed(6));
  return out;
}
/** GPU 에 넘기는 μs(float32 로 반올림 — CPU 도 같은 값). */
const muOf = e => F(Math.sin((e * Math.PI) / 180));

/** 표: RGBA(stride 4, GPU 읽기) 또는 RGB(stride 3, 고정표). at(j 행 = r, i 열 = μs, c). */
function makeTable(arr, W, H, stride = 4) { return { arr, W, H, stride, at: (j, i, c) => arr[(j * W + i) * stride + c] }; }

/** Bruneton GetTextureCoordFromUnitRange — f32 = true 면 float32 산술 흉내(GPU uv 와 같은 반올림). */
function coord(x, n, f32 = true) { return f32 ? F(F(0.5 / n) + F(x * F(1 - F(1 / n)))) : 0.5 / n + x * (1 - 1 / n); }
/** GetIrradianceTextureUvFromRMuS(atm, bottom + h, μs) — GPU 가 r = bottom_radius + probeH 로 더하는 것까지. */
function uvOf(atm, hKm, mu, f32 = true) {
  if (!f32) return [coord(mu * 0.5 + 0.5, atm.W, false), coord(hKm / (atm.top - atm.bottom), atm.H, false)];
  const r = F(atm.bottom + hKm), xr = F(F(r - atm.bottom) / F(atm.top - atm.bottom)), xm = F(F(mu * 0.5) + 0.5);
  return [coord(xm, atm.W), coord(xr, atm.H)];
}
/** 하드웨어 쌍선형(ClampToEdge) — 예전 GetIrradiance. */
function bilinear(T, u, v) {
  const fx = u * T.W - 0.5, fy = v * T.H - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const cx = i => Math.max(0, Math.min(T.W - 1, i)), cy = j => Math.max(0, Math.min(T.H - 1, j));
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = T.at(cy(y0), cx(x0), c) * (1 - ax) + T.at(cy(y0), cx(x0 + 1), c) * ax;
    const b = T.at(cy(y0 + 1), cx(x0), c) * (1 - ax) + T.at(cy(y0 + 1), cx(x0 + 1), c) * ax;
    out[c] = a * (1 - ay) + b * ay;
  }
  return out;
}
const irrOldUv = (T, u, v) => bilinear(T, u, v);
/** §178 IRRADIANCE_LOG_MU(lightingFix.ts)를 줄 그대로 — 이웃 두 텍셀 가운데 fetch(r 축만 선형) · log 보간 · |ln B/A| 램프 가중 · 0·음수 이웃 채널은 선형. */
function irrNewUv(T, u, v) {
  const irrW = T.W;
  const irrX = Math.min(Math.max(u * irrW - 0.5, 0), irrW - 1);
  const irrI = Math.min(Math.floor(irrX), irrW - 2);
  const irrF = irrX - irrI;
  const A = bilinear(T, (irrI + 0.5) / irrW, v), B = bilinear(T, (irrI + 1.5) / irrW, v);
  return [0, 1, 2].map(c => {
    const lin = A[c] * (1 - irrF) + B[c] * irrF;
    const la = Math.log(Math.max(A[c], PIN.FLOOR)), lb = Math.log(Math.max(B[c], PIN.FLOOR));
    const lg = Math.exp(la * (1 - irrF) + lb * irrF);
    const pos = Math.min(A[c], B[c]) >= PIN.FLOOR ? 1 : 0;
    const w = Math.min(1, Math.max(0, (Math.abs(lb - la) - PIN.RAMP_LO) / (PIN.RAMP_HI - PIN.RAMP_LO)));
    return lin * (1 - pos * w) + lg * pos * w;
  });
}
const irrPort = { old: (T, atm, h, mu) => { const [u, v] = uvOf(atm, h, mu); return irrOldUv(T, u, v); }, new: (T, atm, h, mu) => { const [u, v] = uvOf(atm, h, mu); return irrNewUv(T, u, v); } };

/** 고정표(fixtures/irradiance-app15.json) 풀기 — coarse 16×64 · fine 4×505(rows 0/4/8/12 km). */
function loadFixture(fx) {
  const f64 = b64 => { const b = Buffer.from(b64, 'base64'); return Float64Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)); };
  return { coarse: makeTable(f64(fx.coarse), fx.coarseShape[1], fx.coarseShape[0], 3), fine: makeTable(f64(fx.fine), fx.fineShape[1], fx.fineShape[0], 3), rowKm: 4 };
}
/** 세밀 기준 한 행(j): 505 절점 사이 log 선형(둘 다 양수일 때, 아니면 선형) — verify-lighting-fixes rowFine 과 같은 식. */
function fineRow(Fn, j, mu) {
  const x = mu * 0.5 + 0.5, t = x * (Fn.W - 1), i = Math.max(0, Math.min(Math.floor(t), Fn.W - 2)), f = t - i;
  return [0, 1, 2].map(c => { const a = Fn.at(j, i, c), b = Fn.at(j, i + 1, c); return a > PIN.FLOOR && b > PIN.FLOOR ? Math.exp(Math.log(a) * (1 - f) + Math.log(b) * f) : a * (1 - f) + b * f; });
}
/** 높이 h(km)의 기준: 이웃 두 세밀 행 사이 선형(GPU 의 r 축과 같은 처리). 행 밖이면 null. */
function refAt(fx, hKm, mu) {
  const x = hKm / fx.rowKm, j0 = Math.min(Math.floor(x), fx.fine.H - 2), f = x - j0;
  if (j0 < 0 || f > 1 + 1e-9) return null;
  const a = fineRow(fx.fine, j0, mu), b = fineRow(fx.fine, j0 + 1, mu);
  return a.map((v, c) => v * (1 - f) + b[c] * f);
}
/** 표 T(GPU)의 절점 k 값을 높이 h 에서(r 축 하드웨어 선형과 같은 가중). */
function nodeAt(T, atm, hKm, k) {
  const [, v] = uvOf(atm, hKm, 0); const fy = v * T.H - 0.5, y0 = Math.max(0, Math.floor(fy)), ay = fy - Math.floor(fy), y1 = Math.min(T.H - 1, y0 + 1);
  return [0, 1, 2].map(c => T.at(y0, k, c) * (1 - ay) + T.at(y1, k, c) * ay);
}

/** 창 봉우리 간격(ln) 최댓값 — 값 배열 xs(이미 band 안), 창 win 걸음. */
function windowP2P(xs, win) {
  let pp = 0, n = 0;
  for (let k = 0; k + win <= xs.length; k++) {
    const w = xs.slice(k, k + win).filter(Number.isFinite);
    if (w.length < win * 0.8) continue;
    pp = Math.max(pp, Math.max(...w) - Math.min(...w)); n++;
  }
  return n ? pp : null;
}
const relErr = (g, c) => Math.abs(g - c) / Math.max(Math.abs(c), 1e-30);
const pct = x => (x == null ? null : +(x * 100).toFixed(3));

/**
 * 조도 탐침 분석. raw = { atm:{bottom, top, W, H}, heightsKm, es, mus, table(Float32 RGBA W×H), irr:{old, new}(Float32 RGBA N×nh) }.
 * fxd = loadFixture(...) 또는 null(기준 없음 — 보고만).
 */
function analyzeIrr(raw, fxd, p = DEFAULT_PARAMS) {
  const atm = raw.atm, T = makeTable(raw.table, atm.W, atm.H, 4), N = raw.es.length, hs = raw.heightsKm;
  const gpuAt = (v, j, i) => { const a = raw.irr[v], k = (j * N + i) * 4; return [a[k], a[k + 1], a[k + 2]]; };
  const out = { heightsKm: hs, n: N, eRange: [raw.es[0], raw.es[N - 1]], gpuVsCpu: {}, perHeight: [], notes: [] };
  // (a) GPU vs CPU 이식(같은 표) — 채널별 상대 차, |c| < 1e−25 는 셈에서 뺌(0 근처)
  for (const v of ['old', 'new']) {
    let mx = 0, at = null, n = 0, over3 = 0, over2 = 0, skipped = 0; const all = [];
    let mxY = 0;
    for (let j = 0; j < hs.length; j++) for (let i = 0; i < N; i++) {
      const g = gpuAt(v, j, i), c = irrPort[v](T, atm, hs[j], raw.mus[i]);
      for (let ch = 0; ch < 3; ch++) {
        if (!(Math.abs(c[ch]) >= 1e-25)) { skipped++; continue; }
        const d = relErr(g[ch], c[ch]); n++; all.push(d);
        if (d > mx) { mx = d; at = { h: hs[j], e: raw.es[i], ch: 'RGB'[ch], gpu: g[ch], cpu: c[ch] }; }
        if (d > 1e-3) over3++; if (d > 1e-2) over2++;
      }
      const cy = Yof(c); if (cy > 1e-25) mxY = Math.max(mxY, relErr(Yof(g), cy));
    }
    all.sort((a, b) => a - b);
    out.gpuVsCpu[v] = { maxRel: mx, maxRelY: mxY, p99Rel: all.length ? all[Math.floor(0.99 * (all.length - 1))] : null, medianRel: all.length ? all[Math.floor(all.length / 2)] : null,
      n, skippedNearZero: skipped, nOver1e3: over3, nOver1e2: over2, worst: at };
  }
  // 낮(해 ≥ +1°): 새 = 예전(같은 식이 되어야) — GPU 와 CPU 둘 다
  {
    let g = 0, c = 0;
    for (let j = 0; j < hs.length; j++) for (let i = 0; i < N; i++) {
      if (raw.es[i] < 1 - 1e-9) continue;
      const go = gpuAt('old', j, i), gn = gpuAt('new', j, i), co = irrPort.old(T, atm, hs[j], raw.mus[i]), cn = irrPort.new(T, atm, hs[j], raw.mus[i]);
      for (let ch = 0; ch < 3; ch++) { if (go[ch] > 1e-25) g = Math.max(g, relErr(gn[ch], go[ch])); if (co[ch] > 1e-25) c = Math.max(c, relErr(cn[ch], co[ch])); }
    }
    out.dayNewVsOld = { gpuMaxRel: g, cpuMaxRel: c, note: '해 ≥ +1°: 이웃 텍셀 비 < 2 → 가중 0 → 예전 선형과 같은 식(CPU 0, GPU 는 두 fetch 의 필터 정밀도만)' };
  }
  // (b) 높이마다 기준 대조·출렁임·과밝음
  const kOver = raw.es.findIndex(e => Math.abs(e - p.eOver) < 1e-6);
  for (let j = 0; j < hs.length; j++) {
    const h = hs[j], row = { hKm: h, variants: {} };
    const Ys = { old: [], new: [] };
    for (let i = 0; i < N; i++) for (const v of ['old', 'new']) Ys[v].push(Yof(gpuAt(v, j, i)));
    // 기준 없는 지표(L3twilight 과 같은 정의 — ln Y − 국소 2차 맞춤 ±1.5°)
    for (const v of ['old', 'new']) row.variants[v] = { fitPulsing: G.pulsing(raw.es.map((e, i) => ({ e, Y: Ys[v][i] })), p.bands) };
    const hasRef = fxd && refAt(fxd, h, 0) !== null;
    if (hasRef) {
      const R = raw.es.map((e, i) => Yof(refAt(fxd, h, raw.mus[i])));
      const bNode = k => { const n = Yof(nodeAt(T, atm, h, k)), r = Yof(refAt(fxd, h, 2 * k / (atm.W - 1) - 1)); return n > 0 && r > 0 ? n / r : NaN; };
      const kOf = mu => { const x = (mu * 0.5 + 0.5) * (atm.W - 1), k = Math.min(Math.floor(x), atm.W - 2); return [k, x - k]; };
      const bInterp = mu => { const [k, f] = kOf(mu), a = bNode(k), b = bNode(k + 1); return Math.exp(Math.log(a) * (1 - f) + Math.log(b) * f); };
      const bMax = mu => { const [k] = kOf(mu); return Math.max(bNode(k), bNode(k + 1)); };
      for (const v of ['old', 'new']) {
        const r = Ys[v].map((y, i) => (R[i] > 1e-30 ? y / R[i] : NaN));
        const q = r.map((x, i) => x / bInterp(raw.mus[i]));
        const lq = q.map(x => (x > 0 ? Math.log(x) : NaN));
        const bands = p.bands.map(([lo, hi]) => {
          const idx = raw.es.map((e, i) => i).filter(i => raw.es[i] >= lo - 1e-9 && raw.es[i] <= hi + 1e-9);
          const qs = idx.map(i => q[i]).filter(Number.isFinite), rs = idx.map(i => r[i]).filter(Number.isFinite);
          const pp = windowP2P(idx.map(i => lq[i]), p.winSteps);
          const over = Math.max(...idx.map(i => r[i] / bMax(raw.mus[i])).filter(Number.isFinite));
          return { band: [lo, hi], n: qs.length, rMin: rs.length ? Math.min(...rs) : null, rMax: rs.length ? Math.max(...rs) : null, qMin: qs.length ? Math.min(...qs) : null, qMax: qs.length ? Math.max(...qs) : null,
            p2pLn: pp, p2pPct: pp == null ? null : pct(Math.exp(pp) - 1), overMax: Number.isFinite(over) ? over : null };
        });
        row.variants[v].ref = { bands, at: kOver >= 0 ? { e: raw.es[kOver], r: r[kOver], q: q[kOver], over: r[kOver] / bMax(raw.mus[kOver]), nodeBias: bInterp(raw.mus[kOver]) } : null };
      }
      row.pulsingGain = p.bands.map((b, k) => { const o = row.variants.old.ref.bands[k].p2pLn, n = row.variants.new.ref.bands[k].p2pLn; return { band: b, old: o, new: n, gain: o != null && n ? o / n : null }; });
      row.nodeBiasAtOver = kOver >= 0 ? bInterp(raw.mus[kOver]) : null;
    } else row.ref = 'no fine reference at this height (fixture rows 0..12 km)';
    out.perHeight.push(row);
  }
  if (!fxd) out.notes.push('no fixture — reference metrics skipped');
  return out;
}

/** GPU 표 vs 고정표 coarse(앱 표의 CPU 이식) — 같은 절점에서 Y 상대 차(twilight·day), GPU/고정표 비 중앙값. */
function tableVsFixture(raw, fxd) {
  if (!fxd) return null;
  const atm = raw.atm, T = makeTable(raw.table, atm.W, atm.H, 4), C = fxd.coarse;
  if (C.W !== atm.W || C.H !== atm.H) return { shapeMismatch: { gpu: [atm.H, atm.W], fixture: [C.H, C.W] } };
  const muLo = Math.sin((-12 * Math.PI) / 180), rows = [];
  let tw = 0, day = 0; const ratios = [];
  for (let j = 0; j < atm.H; j++) for (let i = 0; i < atm.W; i++) {
    const mu = 2 * i / (atm.W - 1) - 1; if (mu < muLo) continue;
    const g = Yof([0, 1, 2].map(c => T.at(j, i, c))), f = Yof([0, 1, 2].map(c => C.at(j, i, c)));
    if (!(f > 1e-30)) continue;
    const d = relErr(g, f); ratios.push(g / f);
    if (mu < 0) tw = Math.max(tw, d); else day = Math.max(day, d);
  }
  ratios.sort((a, b) => a - b);
  for (const j of [0, 1, 2]) rows.push({ row: j, km: j * 4, twilightNodes: [24, 26, 28, 30, 31].map(i => ({ e: +(Math.asin(2 * i / (atm.W - 1) - 1) * 180 / Math.PI).toFixed(2), gpuOverFixture: Yof([0, 1, 2].map(c => T.at(j, i, c))) / Yof([0, 1, 2].map(c => C.at(j, i, c))) })) });
  return { maxRelTwilight: tw, maxRelDay: day, medianRatio: ratios.length ? ratios[Math.floor(ratios.length / 2)] : null, p05: ratios[Math.floor(0.05 * (ratios.length - 1))], p95: ratios[Math.floor(0.95 * (ratios.length - 1))], rows,
    note: '고정표는 앱 15 파장 표의 CPU 이식(precompute) — GPU 표와 다르면 기준 지표의 절점 치우침 b 가 그 몫을 흡수(q 는 보간만)' };
}

/**
 * 산란 자르기 탐침 분석. raw.aerial = { gw, gh, el(Float32 gw×gh), hit(Uint8), raw, off, on, sky(Float32 RGBA) }.
 * raw = 산란 rgb + 투과율 평균 · off/on = 앱 줄(검은 불투명 덮개 → 산란 / max(산란, 0)) · sky = 같은 선의 맑은 하늘(끝 없음).
 */
function analyzeAerial(A, p = DEFAULT_PARAMS) {
  const n = A.gw * A.gh, rgb = (a, k) => [a[k * 4], a[k * 4 + 1], a[k * 4 + 2]];
  let offEqRaw = 0, onEqClamp = 0, nHit = 0;
  for (let k = 0; k < n; k++) {
    if (!A.hit[k]) continue; nHit++;
    const r = rgb(A.raw, k), o = rgb(A.off, k), c = rgb(A.on, k);
    for (let ch = 0; ch < 3; ch++) { offEqRaw = Math.max(offEqRaw, Math.abs(o[ch] - r[ch]) / Math.max(Math.abs(r[ch]), 1e-30)); onEqClamp = Math.max(onEqClamp, Math.abs(c[ch] - Math.max(r[ch], 0)) / Math.max(Math.abs(r[ch]), 1e-30)); }
  }
  const band = ([lo, hi]) => {
    const ks = []; for (let k = 0; k < n; k++) if (A.hit[k] && A.el[k] >= lo && A.el[k] <= hi) ks.push(k);
    const st = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? { min: s[0], p05: s[Math.floor(0.05 * (s.length - 1))], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] } : null; };
    const rawY = ks.map(k => Yof(rgb(A.raw, k))), offY = ks.map(k => Yof(rgb(A.off, k))), onY = ks.map(k => Yof(rgb(A.on, k))), skyY = ks.map(k => Yof(rgb(A.sky, k)));
    const anyNegCh = ks.filter(k => rgb(A.raw, k).some(x => x < 0)).length;
    return { band: [lo, hi], n: ks.length, rawY: st(rawY), fracNegY: ks.length ? rawY.filter(y => y < 0).length / ks.length : null, fracAnyNegChannel: ks.length ? anyNegCh / ks.length : null,
      offY: st(offY), onY: st(onY), onMinChannel: ks.length ? Math.min(...ks.flatMap(k => rgb(A.on, k))) : null, skyY: st(skyY),
      rawOverSky: st(ks.map((k, i) => (skyY[i] > 0 ? rawY[i] / skyY[i] : NaN))), transmittance: st(ks.map(k => A.raw[k * 4 + 3])) };
  };
  return { grid: [A.gw, A.gh], nHit, offEqualsRawMaxRel: offEqRaw, onEqualsMaxRawZeroMaxRel: onEqClamp, bands: p.aerial.elBands.map(band),
    expectation: '§177/§178: P1 6~10° 산란 Y/맑은 하늘 Y −0.10~−0.17(끔, 음수) → 켬 0(자르기), 원래 값(+0.05~+0.06)은 되살리지 않음' };
}

/** 요약 한 줄들(보고·로그용). */
function summarize(irr, aer, tvf) {
  const L = [];
  if (irr) {
    L.push(`GPU vs CPU-port max rel: old ${irr.gpuVsCpu.old.maxRel.toExponential(2)} · new ${irr.gpuVsCpu.new.maxRel.toExponential(2)} (p99 ${irr.gpuVsCpu.old.p99Rel?.toExponential(2)} / ${irr.gpuVsCpu.new.p99Rel?.toExponential(2)})`);
    for (const r of irr.perHeight) {
      if (!r.pulsingGain) { L.push(`h ${r.hKm} km: no ref`); continue; }
      const b = r.pulsingGain.find(x => x.band[0] === -10), o = r.variants.old.ref.at, n = r.variants.new.ref.at;
      L.push(`h ${r.hKm} km: pulsing −10..−6° p2p ${b && b.old != null ? (Math.exp(b.old) * 100 - 100).toFixed(1) : '?'} % → ${b && b.new != null ? (Math.exp(b.new) * 100 - 100).toFixed(1) : '?'} %` +
        ` · at ${o ? o.e : '?'}°: E/ref ${o ? o.r.toFixed(3) : '?'} → ${n ? n.r.toFixed(3) : '?'} (q ${o ? o.q.toFixed(3) : '?'} → ${n ? n.q.toFixed(3) : '?'})`);
    }
  }
  if (tvf && tvf.medianRatio != null) L.push(`GPU table / fixture coarse: median ${tvf.medianRatio.toFixed(4)} · max rel twilight ${tvf.maxRelTwilight.toExponential(2)} · day ${tvf.maxRelDay.toExponential(2)}`);
  if (aer) for (const b of aer.bands) L.push(`aerial el ${b.band.join('..')}°: n ${b.n} · raw Y min ${b.rawY?.min?.toExponential(2)} · frac<0 ${b.fracNegY?.toFixed(3)} · raw/sky median ${b.rawOverSky?.median?.toFixed(3)} · clamp-on min ch ${b.onMinChannel?.toExponential(2)}`);
  return L;
}

module.exports = { PIN, DEFAULT_PARAMS, Yof, eGrid, muOf, makeTable, coord, uvOf, bilinear, irrOldUv, irrNewUv, irrPort, loadFixture, fineRow, refAt, nodeAt, windowP2P,
  analyzeIrr, tableVsFixture, analyzeAerial, summarize };
