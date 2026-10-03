const J = require('/home/user/solar-path/node_modules/jimp-compact');
const fs = require('fs');
const { cloudMetrics } = require('./metrics.js');
(async () => {
  const P = JSON.parse(fs.readFileSync('genus-photos.json', 'utf8'));
  const S = JSON.parse(fs.readFileSync('selection.json', 'utf8'));
  const out = {};
  for (const [g, sel] of Object.entries(S)) {
    out[g] = [];
    for (const [idx, frac] of Object.entries(sel)) {
      const p = P[g][+idx]; if (!p?.file || !fs.existsSync(p.file)) continue;
      const im = await J.read(p.file);
      const h = Math.max(20, Math.floor(im.bitmap.height * Math.min(1, frac) * 0.97));
      im.crop(0, 0, im.bitmap.width, h).resize(320, J.AUTO);
      const m = cloudMetrics(im.bitmap.data, im.bitmap.width, im.bitmap.height);
      out[g].push({ idx: +idx, ...m });
    }
  }
  fs.writeFileSync('photo-genus-metrics.json', JSON.stringify(out, null, 1));
  const keys = ['cloudFrac', 'shadeRange', 'coarseFrac', 'coherence', 'fractalD', 'edgeSharp', 'baseTop'];
  const qq = (a, f) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(f * (a.length - 1))] : NaN; };
  for (const [g, rows] of Object.entries(out)) {
    console.log(g, 'n=' + rows.length, keys.map(k => { const v = rows.map(r => r[k]); return `${k} ${qq(v, .25).toFixed(2)}/${qq(v, .5).toFixed(2)}/${qq(v, .75).toFixed(2)} (n${v.filter(Number.isFinite).length})`; }).join(' | '));
  }
})();
