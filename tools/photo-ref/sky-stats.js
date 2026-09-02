/**
 * **사진과 렌더를 같은 자로 재는 지표들.**
 *
 * "현실감이 없다"는 지적을 숫자로 바꾸는 곳입니다. 이 파일 하나를 사진
 * 쪽(measure-photos.js)과 렌더 쪽(build-photo-match.js)이 **같이** 씁니다 —
 * 렌더 습작 HTML 에는 이 소스가 그대로 삽입되므로 구현이 갈라질 수 없습니다.
 *
 * ## 두 가지 함정을 피합니다
 *
 * 1. **분할(segmentation)을 안 합니다.** "구름 화소"와 "하늘 화소"를 가르는
 *    규칙은 맑은 하늘에서 되는 것이 흐린 하늘에서 깨집니다. 여기 지표는
 *    전부 분할 없이 화면 전체에서 나옵니다.
 * 2. **크기를 맞춥니다.** 국소대비는 화소 크기에 직접 좌우됩니다. 1280px
 *    사진과 300px 렌더를 그냥 비교하면 사진이 무조건 더 거칠게 나옵니다.
 *    두 쪽 다 `resampleTo(NORM_W)` 로 같은 폭에 맞춘 뒤 잽니다.
 *
 * ## 색 공간
 *
 * 사진(JPEG)도 렌더(readPixels, 톤매핑 뒤)도 **sRGB 인코딩된 표시값**입니다.
 * 사용자가 보는 것이 그것이므로 이 공간에서 비교하는 게 맞습니다 —
 * 선형 광량으로 되돌리지 않습니다.
 */

/** 국소대비를 비교 가능하게 만드는 공통 폭. 렌더 습작(300px)과 비슷하게. */
const NORM_W = 320;

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx > 0 ? d / mx : 0, v: mx };
}
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * 상자 필터로 폭 NORM_W 에 맞춥니다. 단순 최근접이면 잔무늬가 그대로 남아
 * 국소대비가 원본 해상도에 다시 끌려갑니다 — 평균을 내야 축소가 됩니다.
 */
function resampleTo(data, W, H, outW) {
  if (W <= outW) return { data, W, H };
  const sc = W / outW;
  const outH = Math.max(1, Math.round(H / sc));
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * sc), y1 = Math.min(H, Math.floor((y + 1) * sc));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * sc), x1 = Math.min(W, Math.floor((x + 1) * sc));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < Math.max(y0 + 1, y1); sy++)
        for (let sx = x0; sx < Math.max(x0 + 1, x1); sx++) {
          const p = (sy * W + sx) * 4;
          r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
        }
      const q = (y * outW + x) * 4;
      out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
    }
  }
  return { data: out, W: outW, H: outH };
}

/**
 * @param data RGBA, **위가 y=0** (readPixels 는 뒤집혀 오므로 부르는 쪽에서 뒤집을 것)
 * @param opts.skyFrac 위에서부터 하늘인 비율 (지면·건물을 잘라 냅니다)
 */
function skyStats(data, W, H, opts) {
  const skyFrac = (opts && opts.skyFrac) || 1.0;

  // 1) 하늘만 남기고 자릅니다.
  const cropH = Math.max(2, Math.round(H * skyFrac));
  const crop = new Uint8Array(W * cropH * 4);
  crop.set(data.subarray(0, W * cropH * 4));

  // 2) 같은 폭으로 맞춥니다 — 국소대비를 비교 가능하게 하는 유일한 방법.
  const r = resampleTo(crop, W, cropH, NORM_W);
  const d = r.data, w = r.W, h = r.H;

  const lums = new Float64Array(w * h);
  const sats = new Float64Array(w * h);
  let sumL = 0, sumS = 0, sumV = 0;
  let hx = 0, hy = 0, hn = 0;
  let blown = 0, vivid = 0, clipped = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4, R = d[p], G = d[p + 1], B = d[p + 2];
    const L = lumOf(R, G, B); lums[i] = L; sumL += L;
    const { h: hu, s, v } = rgb2hsv(R, G, B);
    sats[i] = s; sumS += s; sumV += v;
    if (s > 0.05) { const a = hu * Math.PI / 180; hx += Math.cos(a); hy += Math.sin(a); hn++; }
    if (v > 0.95 && s < 0.10) blown++;   // 새하얗게 날아간 구름
    if (s > 0.60) vivid++;               // 원색에 가까운 화소
    // **채널 클리핑** — 한 채널만 천장에 닿으면 나머지는 계속 내려가므로
    // 채도가 억지로 올라가고 색상까지 밀립니다. 원색 화소가 쏟아지는
    // 그림에서 이 값이 같이 크면, 원인은 색 계산이 아니라 잘림입니다.
    if (R >= 254 || G >= 254 || B >= 254) clipped++;
  }
  const meanL = sumL / (w * h);

  // 대비 — 평균으로 나눠 밝기와 분리합니다(어두운 밤 장면과도 견줄 수 있게).
  let varL = 0;
  for (let i = 0; i < w * h; i++) { const dv = lums[i] - meanL; varL += dv * dv; }
  const rms = Math.sqrt(varL / (w * h)) / Math.max(1, meanL);

  // 국소대비 — 이웃 화소 밝기차. "구름 대비가 세다"가 여기서 잡힙니다.
  let loc = 0, ln = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x;
    loc += Math.abs(lums[i] - lums[i + 1]) + Math.abs(lums[i] - lums[i + w]); ln += 2;
  }
  const local = (loc / ln) / Math.max(1, meanL);

  const sortedL = Array.from(lums).sort((a, b) => a - b);
  const q = f => sortedL[Math.min(sortedL.length - 1, Math.floor(sortedL.length * f))];
  const span = (q(0.95) - q(0.05)) / Math.max(1, q(0.50));

  // 색상 원형 표준편차 — 색상각은 360도에서 이어지므로 산술 편차를 쓰면
  // 빨강 부근이 0도와 359도로 갈려 거짓으로 커집니다.
  const Rlen = hn ? Math.sqrt(hx * hx + hy * hy) / hn : 1;
  const hueSd = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(1e-6, Rlen)))) * 180 / Math.PI;
  let meanHue = hn ? Math.atan2(hy / hn, hx / hn) * 180 / Math.PI : 0;
  if (meanHue < 0) meanHue += 360;

  // 세로 채도비 — 위 25% 대 아래 25%. 실제 하늘은 지평선으로 갈수록
  // 공기가 두꺼워져 **채도가 크게 떨어집니다**(에어리얼 퍼스펙티브).
  const bandS = (y0, y1) => {
    let s = 0, n = 0;
    for (let y = Math.round(h * y0); y < Math.round(h * y1); y++)
      for (let x = 0; x < w; x++) { s += sats[y * w + x]; n++; }
    return s / Math.max(1, n);
  };
  const sTop = bandS(0, 0.25), sBot = bandS(0.75, 1.0);

  const r2 = v => +v.toFixed(3);
  return {
    채도:     r2(sumS / (w * h)),
    상단채도: r2(sTop),
    하단채도: r2(sBot),
    채도기울기: r2(sBot / Math.max(0.01, sTop)),   // <1 이면 지평선이 흐려짐 = 자연스러움
    대비:     r2(rms),
    국소대비: r2(local),
    밝기폭:   r2(span),
    색상:     +meanHue.toFixed(1),
    색상편차: +hueSd.toFixed(1),
    흰포화:   r2(blown / (w * h)),
    채널클립: r2(clipped / (w * h)),
    원색:     r2(vivid / (w * h)),
    평균휘도: +meanL.toFixed(1),
  };
}



// ── 구름 크기와 모양 — 각도 기준 파워 스펙트럼 ──────────────────────────
//
// 지금까지 잰 것은 전부 **색**이었습니다. "구름크기·구름모양이 비슷한가"는
// 다른 자가 필요합니다.
//
// 핵심은 **화소가 아니라 각도**로 재는 것입니다. 같은 적운도 광각으로 찍으면
// 작게, 망원으로 찍으면 크게 찍힙니다. 실제로 첫 표본에 300mm(화각 6.9°)로
// 찍은 박명 사진이 있었는데, 우리 렌더(62°)와 화소로 견줬다면 구름 크기가
// 9배 어긋난 채로 "맞다/틀리다"를 말했을 것입니다.
//
// 두 가지를 냅니다:
//   구름각크기 — 파워의 절반이 실리는 파장(도). "얼마나 큰가".
//   무늬기울기 — log-log 스펙트럼 기울기 β. "얼마나 거친가/부드러운가".
//                β 가 크면 큰 덩어리 위주(부드러움), 작으면 잔무늬가 많음.

/** 제자리 복소 FFT (radix-2). N 은 2의 거듭제곱. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const SPEC_N = 256;   // 스펙트럼용 정사각 표본 크기

/**
 * @param opts.fovDeg  사진/렌더의 **가로** 화각. 없으면 각도 지표를 안 냅니다.
 * @param opts.skyFrac 위에서부터 하늘인 비율
 */
function angularSpectrum(data, W, H, opts) {
  const fovDeg = opts && opts.fovDeg;
  if (!fovDeg) return null;
  const cropH = Math.max(2, Math.round(H * (opts.skyFrac || 1)));
  const S = Math.min(W, cropH);
  if (S < 64) return null;

  // 정사각 조각이 하늘에서 몇 도를 덮는가 — 원근투영이라 화각/폭 로 나누면
  // 넓은 화각에서 틀립니다. 초점거리(화소)로 되돌려 정확히 구합니다.
  const focalPx = (W / 2) / Math.tan(fovDeg * Math.PI / 360);
  const angW = 2 * Math.atan((S / 2) / focalPx) * 180 / Math.PI;

  // 위쪽 가운데에서 정사각을 떼어 SPEC_N 으로 상자필터 축소합니다.
  const x0 = Math.floor((W - S) / 2);
  const g = new Float64Array(SPEC_N * SPEC_N);
  const step = S / SPEC_N;
  for (let y = 0; y < SPEC_N; y++) for (let x = 0; x < SPEC_N; x++) {
    let sum = 0, n = 0;
    const sy0 = Math.floor(y * step), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * step));
    const sx0 = Math.floor(x * step), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * step));
    for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
      const p = ((sy) * W + x0 + sx) * 4;
      sum += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]; n++;
    }
    g[y * SPEC_N + x] = sum / Math.max(1, n);
  }

  // 평균을 빼고 한(Hann) 창을 씌웁니다 — 안 씌우면 가장자리 불연속이
  // 스펙트럼 전체에 십자 무늬로 새어 들어옵니다.
  let mean = 0;
  for (let i = 0; i < g.length; i++) mean += g[i];
  mean /= g.length;
  const win = new Float64Array(SPEC_N);
  for (let i = 0; i < SPEC_N; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (SPEC_N - 1)));
  const re = [], im = [];
  for (let y = 0; y < SPEC_N; y++) {
    re.push(new Float64Array(SPEC_N)); im.push(new Float64Array(SPEC_N));
    for (let x = 0; x < SPEC_N; x++) re[y][x] = (g[y * SPEC_N + x] - mean) * win[y] * win[x];
  }
  for (let y = 0; y < SPEC_N; y++) fft(re[y], im[y]);
  const cr = new Float64Array(SPEC_N), ci = new Float64Array(SPEC_N);
  for (let x = 0; x < SPEC_N; x++) {
    for (let y = 0; y < SPEC_N; y++) { cr[y] = re[y][x]; ci[y] = im[y][x]; }
    fft(cr, ci);
    for (let y = 0; y < SPEC_N; y++) { re[y][x] = cr[y]; im[y][x] = ci[y]; }
  }

  // 반지름별 평균 파워.
  const half = SPEC_N / 2;
  const P = new Float64Array(half), C = new Float64Array(half);
  for (let y = 0; y < SPEC_N; y++) {
    const fy = y < half ? y : y - SPEC_N;
    for (let x = 0; x < SPEC_N; x++) {
      const fx = x < half ? x : x - SPEC_N;
      const r = Math.round(Math.sqrt(fx * fx + fy * fy));
      if (r < 1 || r >= half) continue;
      P[r] += re[y][x] * re[y][x] + im[y][x] * im[y][x]; C[r]++;
    }
  }
  for (let r = 1; r < half; r++) if (C[r]) P[r] /= C[r];

  // JPEG 압축과 축소가 만드는 잔무늬를 피해 윗쪽 1/4 은 버립니다.
  const rMax = Math.floor(half / 4);
  let tot = 0;
  for (let r = 1; r <= rMax; r++) tot += P[r] * r;      // 고리 넓이 가중
  let acc = 0, r50 = rMax;
  for (let r = 1; r <= rMax; r++) {
    acc += P[r] * r;
    if (acc >= tot * 0.5) { r50 = r; break; }
  }
  // 반지름 r 은 "정사각 하나에 몇 주기" → 도 단위 파장 = angW / r
  const 구름각크기 = angW / Math.max(1, r50);

  // log-log 기울기 — 신호가 있는 구간에서만.
  const lo = Math.max(2, Math.round(rMax * 0.12)), hi = rMax;
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let r = lo; r <= hi; r++) {
    if (!(P[r] > 0)) continue;
    const X = Math.log(r), Y = Math.log(P[r]);
    n++; sx += X; sy += Y; sxx += X * X; sxy += X * Y;
  }
  const beta = n > 3 ? -(n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx) : 0;

  return {
    구름각크기: +구름각크기.toFixed(2),
    무늬기울기: +beta.toFixed(2),
    조각각폭: +angW.toFixed(1),
  };
}


// ── 조명 분리 — "어느 부분이 어느 색으로 물드는가" ──────────────────────
//
// 사용자가 실제로 보고 싶다고 한 것은 구름의 정확한 모양이 아니라 **조명**
// 입니다: 뭉게구름의 태양면은 주황, 나머지는 보라, 어떤 구름은 통째로 회색,
// 상층운은 아직 흰색.
//
// 이걸 재려면 "구름 화소 / 하늘 화소"를 갈라야 할 것 같지만, 그 규칙은 맑은
// 날에 되는 것이 흐린 날에 깨집니다. 대신 **밝기와 색의 관계**를 봅니다 —
// 분할이 필요 없고, 말한 내용을 그대로 담습니다.
function lightingStats(data, W, H, opts) {
  const cropH = Math.max(2, Math.round(H * ((opts && opts.skyFrac) || 1)));
  const crop = new Uint8Array(W * cropH * 4);
  crop.set(data.subarray(0, W * cropH * 4));
  const r = resampleTo(crop, W, cropH, NORM_W);
  const d = r.data, w = r.W, h = r.H, n = w * h;

  const L = new Float64Array(n), Wm = new Float64Array(n), S = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4, R = d[p], G = d[p + 1], B = d[p + 2];
    L[i] = lumOf(R, G, B);
    // 따뜻함 — 밝기로 나눠 정규화합니다. 안 그러면 그냥 "밝다"가 잡힙니다.
    Wm[i] = (R - B) / Math.max(24, Math.max(R, Math.max(G, B)));
    S[i] = rgb2hsv(R, G, B).s;
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => L[a] - L[b]);
  const q = Math.max(1, Math.round(n * 0.20));
  const dark = idx.slice(0, q), bright = idx.slice(n - q);
  const avg = (list, arr) => list.reduce((s, i) => s + arr[i], 0) / list.length;

  const mL = L.reduce((a, b) => a + b, 0) / n, mW = Wm.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vL = 0, vW = 0;
  for (let i = 0; i < n; i++) {
    const dl = L[i] - mL, dw = Wm[i] - mW;
    cov += dl * dw; vL += dl * dl; vW += dw * dw;
  }
  const corr = cov / Math.max(1e-9, Math.sqrt(vL * vW));

  const r3 = v => +v.toFixed(3);
  return {
    밝은쪽따뜻함: r3(avg(bright, Wm)),
    어두운쪽따뜻함: r3(avg(dark, Wm)),
    따뜻함폭: r3(avg(bright, Wm) - avg(dark, Wm)),
    밝은쪽채도: r3(avg(bright, S)),
    어두운쪽채도: r3(avg(dark, S)),
    밝기따뜻함상관: r3(corr),
  };
}


/**
 * **고도각에 따른 따뜻함 프로파일.**
 *
 * "태양이 지는 부분은 황금색이지만 높은 고도는 하늘색" — 이 말을 그대로
 * 재는 자입니다. 화면을 가로 띠로 잘라 위(높은 고도)에서 아래(지평선)로
 * 따뜻함(R-B)을 냅니다. 실제 하늘은 위로 갈수록 급격히 차가워집니다.
 *
 * 띠는 화면 세로를 그냥 n 등분합니다 — 화각과 시선 고도를 알면 각 띠의
 * 고도각을 계산할 수 있으므로, 부르는 쪽에서 짝지어 읽으면 됩니다.
 */
function warmthProfile(data, W, H, opts) {
  const bands = (opts && opts.bands) || 5;
  const cropH = Math.max(2, Math.round(H * ((opts && opts.skyFrac) || 1)));
  const out = [];
  for (let b = 0; b < bands; b++) {
    const y0 = Math.round(cropH * b / bands), y1 = Math.round(cropH * (b + 1) / bands);
    let sw = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = 0; x < W; x += 2) {
      const p = (y * W + x) * 4, R = data[p], G = data[p + 1], B = data[p + 2];
      sw += (R - B) / Math.max(24, Math.max(R, Math.max(G, B)));
      n++;
    }
    out.push(+(sw / Math.max(1, n)).toFixed(3));
  }
  return out;   // [0] = 화면 위 = 높은 고도
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { skyStats, angularSpectrum, lightingStats, warmthProfile,
                     resampleTo, rgb2hsv, NORM_W };
