// 하늘 아래 끝 찾기: 위에서부터 줄마다 "하늘 같은" 화소 비율 — 밝고(위 10% 줄 중앙 휘도의 0.45배 이상) 초록·갈색이 아닌 것.
// 비율이 0.7 아래로 3줄 연속 떨어지는 첫 줄을 하늘 끝으로 봅니다.
const J = require('/home/user/solar-path/node_modules/jimp-compact');
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
async function skyBottom(file) {
  const im = await J.read(file); const { data, width: W, height: H } = im.bitmap;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.2126 * lin(data[i * 4]) + 0.7152 * lin(data[i * 4 + 1]) + 0.0722 * lin(data[i * 4 + 2]);
  const top = []; for (let y = 0; y < Math.max(1, Math.floor(H * 0.1)); y++) for (let x = 0; x < W; x++) top.push(L[y * W + x]);
  top.sort((a, b) => a - b); const ref = top[top.length >> 1];
  let bad = 0, bottom = H;
  for (let y = 0; y < H; y++) {
    let ok = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const greenish = g > r * 1.08 && g > b * 1.02;
      const brownish = r > b * 1.35 && g > b * 1.15 && L[y * W + x] < ref * 0.8;
      if (L[y * W + x] > ref * 0.45 && !greenish && !brownish) ok++;
    }
    if (ok / W < 0.7) { if (++bad >= 3) { bottom = y - 2; break; } } else bad = 0;
  }
  return { W, H, bottom, frac: +(bottom / H).toFixed(3) };
}
module.exports = { skyBottom };
