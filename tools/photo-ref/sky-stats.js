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

if (typeof module !== 'undefined' && module.exports)
  module.exports = { skyStats, resampleTo, rgb2hsv, NORM_W };
