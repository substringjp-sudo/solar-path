// 구름 형태 지표 — 사진·렌더에 같은 함수를 씁니다. 노출·배율에 덜 휘둘리는 비율 지표만.
// 입력: RGBA(sRGB 8비트) 버퍼, 너비, 높이(하늘 영역만 잘라 넘김). 너비 320 으로 맞춰 넘기는 것을 전제로 합니다.
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LUT = new Float32Array(256).map((_, i) => lin(i));

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { let s = 0, n = 0;
    for (let x = -r; x < W + r; x++) {
      if (x + r < W && x + r >= 0) { s += src[y * W + x + r]; n++; }
      if (x - r - 1 >= 0) { s -= src[y * W + x - r - 1]; n--; }
      if (x >= 0 && x < W) tmp[y * W + x] = s / n;
    } }
  for (let x = 0; x < W; x++) { let s = 0, n = 0;
    for (let y = -r; y < H + r; y++) {
      if (y + r < H && y + r >= 0) { s += tmp[(y + r) * W + x]; n++; }
      if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * W + x]; n--; }
      if (y >= 0 && y < H) out[y * W + x] = s / n;
    } }
  return out;
}
const q = (a, f) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))]; };

function cloudMetrics(data, W, H) {
  const N = W * H, L = new Float32Array(N), nrbr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = LUT[data[i * 4]], g = LUT[data[i * 4 + 1]], b = LUT[data[i * 4 + 2]];
    L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    nrbr[i] = (b - r) / Math.max(1e-6, b + r);
  }
  // 구름 마스크: 파랑 우세(NRBR)가 맑은 하늘보다 뚜렷이 낮은 곳. 맑은 하늘이 없으면(흐림) 전부 구름.
  const p95 = q(nrbr, 0.95);
  const allCloud = p95 < 0.15;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = allCloud || nrbr[i] < 0.5 * p95 ? 1 : 0;
  // 화면 가장자리·포화(흰 날림) 화소는 명암 지표에서 뺍니다.
  const sat = new Uint8Array(N);
  for (let i = 0; i < N; i++) sat[i] = data[i * 4] >= 250 && data[i * 4 + 1] >= 250 && data[i * 4 + 2] >= 250 ? 1 : 0;
  let nc = 0; for (let i = 0; i < N; i++) nc += mask[i];
  const cloudFrac = nc / N;

  // M3 구름 속 명암 폭(하위 10% ÷ 상위 90%)
  const Lc = []; for (let i = 0; i < N; i++) if (mask[i] && !sat[i]) Lc.push(L[i]);
  const shadeRange = Lc.length > 200 ? q(Lc, 0.1) / Math.max(1e-6, q(Lc, 0.9)) : NaN;

  // M4 큰 덩어리 비율 — 구름 속 로그휘도의 분산 중 8px 흐림 뒤에 남는 몫(320 폭 기준 8px ≈ 화면 2.5%).
  const logL = new Float32Array(N); for (let i = 0; i < N; i++) logL[i] = Math.log(Math.max(1e-5, L[i]));
  // 하늘 화소가 흐림에 섞이지 않도록 마스크 정규화 흐림(구름 화소만 평균) — v1 은 하늘이 섞여 1 을 넘기도 했습니다.
  const mf = Float32Array.from(mask), lm = logL.map((v, i) => v * mask[i]);
  const blN = boxBlur(lm, W, H, 8), blD = boxBlur(mf, W, H, 8);
  const bl = blN.map((v, i) => v / Math.max(1e-6, blD[i]));
  let m = 0, n = 0; for (let i = 0; i < N; i++) if (mask[i]) { m += logL[i]; n++; }
  m /= Math.max(1, n);
  let vAll = 0, vCoarse = 0, mb = 0; for (let i = 0; i < N; i++) if (mask[i]) mb += bl[i]; mb /= Math.max(1, n);
  for (let i = 0; i < N; i++) if (mask[i]) { vAll += (logL[i] - m) ** 2; vCoarse += (bl[i] - mb) ** 2; }
  const coarseFrac = n > 200 && vAll > 0 ? vCoarse / vAll : NaN;

  // M5 결 방향성 — 로그휘도 기울기의 구조 텐서 일관성(2px 흐림 후), 구름 화소에서.
  const s2 = boxBlur(logL, W, H, 1);
  let jxx = 0, jyy = 0, jxy = 0, cohW = 0;
  const gx = new Float32Array(N), gy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; gx[i] = (s2[i + 1] - s2[i - 1]) / 2; gy[i] = (s2[i + W] - s2[i - W]) / 2;
  }
  const Jxx = boxBlur(gx.map((v, i) => v * v), W, H, 6), Jyy = boxBlur(gy.map(v => v * v), W, H, 6), Jxy = boxBlur(gx.map((v, i) => v * gy[i]), W, H, 6);
  for (let i = 0; i < N; i++) if (mask[i]) {
    const a = Jxx[i], d = Jyy[i], b = Jxy[i], tr = a + d; if (tr < 1e-8) continue;
    const disc = Math.sqrt((a - d) ** 2 + 4 * b * b); jxx += disc; jyy += tr; cohW++;
  }
  const coherence = cohW > 200 ? jxx / jyy : NaN;

  // M2 윤곽 프랙탈 차원 — 연결 성분의 둘레-면적(구름이 화면 경계에 닿지 않는 조각만, 면적 ≥ 20).
  let fractalD = NaN, nComp = 0;
  if (!allCloud && cloudFrac > 0.02 && cloudFrac < 0.9) {
    const lab = new Int32Array(N).fill(-1); const comps = [];
    for (let s = 0; s < N; s++) if (mask[s] && lab[s] < 0) {
      const stack = [s]; lab[s] = comps.length; let area = 0, per = 0, edge = false;
      while (stack.length) { const i = stack.pop(); area++; const x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx;
          if (!mask[j]) { per++; continue; } if (lab[j] < 0) { lab[j] = comps.length; stack.push(j); } } }
      comps.push({ area, per, edge, id: comps.length });
    }
    const ok = comps.filter(c => !c.edge && c.area >= 20);
    nComp = ok.length;
    if (ok.length >= 6) {
      const xs = ok.map(c => Math.log(c.area)), ys = ok.map(c => Math.log(c.per));
      const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      let sxy = 0, sxx = 0; for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
      if (sxx > 0.5) fractalD = 2 * sxy / sxx;   // P ∝ A^(D/2)
    }
  }

  // M7 밑면/윗면 밝기비 — 조각마다 외접 상자의 아래 1/3 행 평균 L ÷ 위 1/3 행 평균 L 의 중앙값.
  // 두꺼운 구름은 밑이 어둡습니다(부피 단서). 화면 아래 끝에 닿은 조각(밑이 잘림)과 작은 조각은 뺍니다.
  let baseTop = NaN, nBT = 0;
  if (!allCloud && cloudFrac > 0.02 && cloudFrac < 0.9) {
    const lab = new Int32Array(N).fill(-1); const boxes = [];
    for (let s = 0; s < N; s++) if (mask[s] && lab[s] < 0) {
      const stack = [s]; const id = boxes.length; lab[s] = id; const b = { y0: H, y1: -1, area: 0, bottom: false };
      while (stack.length) { const i = stack.pop(); b.area++; const x = i % W, y = (i / W) | 0;
        if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; if (y === H - 1) b.bottom = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx;
          if (mask[j] && lab[j] < 0) { lab[j] = id; stack.push(j); } } }
      boxes.push(b);
    }
    const st = boxes.map(() => ({ t: 0, nt: 0, b: 0, nb: 0 }));
    for (let i = 0; i < N; i++) { const id = lab[i]; if (id < 0 || sat[i]) continue; const bx = boxes[id];
      const hgt = bx.y1 - bx.y0 + 1; if (hgt < 9) continue; const y = (i / W) | 0, f = (y - bx.y0) / hgt;
      if (f < 1 / 3) { st[id].t += L[i]; st[id].nt++; } else if (f >= 2 / 3) { st[id].b += L[i]; st[id].nb++; } }
    const r = [];
    boxes.forEach((bx, id) => { const s0 = st[id]; if (bx.bottom || bx.area < 60 || s0.nt < 10 || s0.nb < 10) return;
      r.push((s0.b / s0.nb) / Math.max(1e-6, s0.t / s0.nt)); });
    nBT = r.length; if (r.length >= 1) baseTop = q(r, 0.5);
  }

  // M6 가장자리 선명도 — 경계 화소의 |∇L| 평균 ÷ (구름 평균 L − 하늘 평균 L).
  let edgeSharp = NaN;
  if (!allCloud && cloudFrac > 0.02 && cloudFrac < 0.95) {
    let sc = 0, ncl = 0, ss = 0, nsk = 0, ge = 0, ne = 0;
    for (let i = 0; i < N; i++) { if (mask[i]) { sc += L[i]; ncl++; } else { ss += L[i]; nsk++; } }
    const contrast = Math.abs(sc / ncl - ss / nsk);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x;
      if (mask[i] && (!mask[i + 1] || !mask[i - 1] || !mask[i + W] || !mask[i - W])) {
        ge += Math.hypot((L[i + 1] - L[i - 1]) / 2, (L[i + W] - L[i - W]) / 2); ne++; } }
    if (ne > 50 && contrast > 1e-4) edgeSharp = (ge / ne) / contrast;
  }
  return { cloudFrac: +cloudFrac.toFixed(3), shadeRange: +shadeRange.toFixed(3), coarseFrac: +coarseFrac.toFixed(3),
    coherence: +coherence.toFixed(3), fractalD: +fractalD.toFixed(3), nComp, edgeSharp: +edgeSharp.toFixed(3), baseTop: +baseTop.toFixed(3), nBT, allCloud };
}
module.exports = { cloudMetrics };
