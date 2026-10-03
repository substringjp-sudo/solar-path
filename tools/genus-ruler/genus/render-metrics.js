const J = require('/home/user/solar-path/node_modules/jimp-compact');
const { cloudMetrics } = require('./metrics.js');
(async () => {
  for (const f of process.argv.slice(2)) {
    const [file, frac] = f.split(':');
    const im = await J.read(file);
    im.crop(0, 0, im.bitmap.width, Math.floor(im.bitmap.height * (+frac || 0.78))).resize(320, J.AUTO);
    console.log(file.split('/').pop(), JSON.stringify(cloudMetrics(im.bitmap.data, im.bitmap.width, im.bitmap.height)));
  }
})();
