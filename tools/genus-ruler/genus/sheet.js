const J = require('/home/user/solar-path/node_modules/jimp-compact');
const { skyBottom } = require('./sky.js');
const fs = require('fs');
(async () => {
  const P = JSON.parse(fs.readFileSync('genus-photos.json', 'utf8'));
  const g = process.argv[2], from = +(process.argv[3] || 0), n = +(process.argv[4] || 40);
  const list = P[g].slice(from, from + n);
  const C = 8, TW = 200, TH = 150;
  const out = new J(C * TW, Math.ceil(list.length / C) * TH, 0x202020ff);
  for (const [k, q] of list.entries()) {
    if (!q.file || !fs.existsSync(q.file)) continue;
    const sb = q.sky ?? (q.sky = await skyBottom(q.file));
    const im = await J.read(q.file); const s = Math.min(TW / im.bitmap.width, TH / im.bitmap.height);
    im.scale(s);
    const yb = Math.min(im.bitmap.height - 1, Math.round(sb.bottom * s));
    for (let x = 0; x < im.bitmap.width; x++) { im.setPixelColor(0xff00ffff, x, yb); if (yb > 0) im.setPixelColor(0xff00ffff, x, yb - 1); }
    // 번호 띠
    const idx = from + k; for (let y = 0; y < 10; y++) for (let x = 0; x < 6 + (idx % 10) * 3; x++) im.setPixelColor(0xffff00ff, x, y);
    out.composite(im, (k % C) * TW, Math.floor(k / C) * TH);
  }
  fs.writeFileSync('genus-photos.json', JSON.stringify(P, null, 1));
  await out.writeAsync(`sheet-${g}-${from}.png`);
  console.log(g, from, list.length);
})();
