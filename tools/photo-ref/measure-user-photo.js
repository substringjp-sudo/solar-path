/**
 * **사용자가 찍은 사진을 잽니다** — QR 로 조건을 아는 유일한 실측 표본.
 *
 * 위키미디어 사진은 언제·어디서·어떤 예보였는지 모릅니다. 사용자의 사진은
 * 같은 순간의 QR(태양 고도·방위·층별 운량)이 붙어 있어, **그 입력을 넣은
 * 렌더와 1:1 로** 견줄 수 있는 유일한 자료입니다.
 *
 * 폰 사진은 세로로 저장된 가로 사진이라 돌립니다 — 어느 쪽이 지면인지는
 * 눈으로 봐야 알기에 방향을 인자로 받습니다.
 *
 * ⚠ 세로 방향으로 삐죽 든 것(가로수·건물·가로등)은 행 단위 자르기로 못
 *   잡습니다. 실제로 첫 판에서 나무 실루엣이 "어두운쪽채도"를 0.277 로
 *   끌어올려, 그늘진 구름이 회색인지 보려던 지표가 나뭇잎을 재고 있었습니다.
 *   그래서 좌우도 잘라 냅니다.
 *
 * 사용: node tools/photo-ref/measure-user-photo.js <이미지> <cw|ccw|none> <y0,y1,x0,x1>
 */
const fs = require('fs');
const path = require('path');
const jpeg = require(path.join(__dirname, '../qr-report/node_modules/jpeg-js'));
const { skyStats, lightingStats, warmthProfile } = require('./sky-stats');

function rotate(data, W, H, dir) {
  if (dir === 'none') return { data, W, H };
  const nW = H, nH = W;
  const out = new Uint8Array(nW * nH * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4;
    const nx = dir === 'cw' ? (nW - 1 - y) : y;
    const ny = dir === 'cw' ? x : (nH - 1 - x);
    const dst = (ny * nW + nx) * 4;
    out[dst] = data[s]; out[dst+1] = data[s+1]; out[dst+2] = data[s+2]; out[dst+3] = 255;
  }
  return { data: out, W: nW, H: nH };
}

const file = process.argv[2];
const dir = process.argv[3] || 'cw';
const box = (process.argv[4] || '0,0.7,0,1').split(',').map(Number);
const [y0, y1, x0, x1] = box;
const img = jpeg.decode(fs.readFileSync(file), { useTArray: true });
const r = rotate(img.data, img.width, img.height, dir);

// 창을 떼어 냅니다 — 위아래뿐 아니라 좌우도.
const cx0 = Math.round(r.W * x0), cx1 = Math.round(r.W * x1);
const cy0 = Math.round(r.H * y0), cy1 = Math.round(r.H * y1);
const cW = cx1 - cx0, cH = cy1 - cy0;
const cut = new Uint8Array(cW * cH * 4);
for (let y = 0; y < cH; y++)
  cut.set(r.data.subarray(((cy0 + y) * r.W + cx0) * 4, ((cy0 + y) * r.W + cx1) * 4), y * cW * 4);
console.log(`${path.basename(file)}  ${img.width}x${img.height} → 창 ${cW}x${cH}`);
const s = skyStats(cut, cW, cH, { skyFrac: 1 });
const l = lightingStats(cut, cW, cH, { skyFrac: 1 });
console.log('  색   채도', s.채도, ' 국소대비', s.국소대비, ' 대비', s.대비);
console.log('  조명 ', JSON.stringify(l));
console.log('  따뜻함 프로파일 (위→아래):', JSON.stringify(warmthProfile(cut, cW, cH, { skyFrac: 1, bands: 5 })));

if (process.env.DUMP_PNG) {
  const { PNG } = require(path.join(__dirname, '../qr-report/node_modules/pngjs'));
  const png = new PNG({ width: cW, height: cH });
  png.data.set(cut);
  png.pack().pipe(fs.createWriteStream(process.env.DUMP_PNG));
}
