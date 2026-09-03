/**
 * **하늘 사진만 남기고, 내가 눈으로 확인할 수 있게 한 장에 모읍니다.**
 *
 * 157장을 한 장씩 열어 볼 수는 없습니다. 그렇다고 안 보고 쓰면 안 됩니다 —
 * 첫 표본에서 검색이 비행기 날개·건물·책 표지를 물어 왔고, 눈으로 확인하기
 * 전에는 그게 하늘 통계인 줄 알았을 것입니다.
 *
 * 그래서 두 단계입니다:
 *   1) 자동 선별 — 지면·초목·실루엣이 많이 든 것을 떨궈 냅니다.
 *   2) 접촉인화(contact sheet) — 살아남은 것을 격자로 붙여 **눈으로** 봅니다.
 *
 * 사용: node tools/photo-ref/screen-candidates.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const jpeg = require(path.join(__dirname, '../qr-report/node_modules/jpeg-js'));
const { PNG } = require(path.join(__dirname, '../qr-report/node_modules/pngjs'));
const { rgb2hsv } = require('./sky-stats');

const UA = 'BeforeGlow-SkyResearch/1.0 (https://github.com/substringjp-sudo/solar-path)';
const DIR = path.join(__dirname, '../../.harness/photoref');
const RAW = path.join(DIR, 'raw');

const download = (url, dest) => new Promise((res, rej) => {
  https.get(url, { headers: { 'User-Agent': UA } }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
      return download(r.headers.location, dest).then(res, rej);
    if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode));
    const f = fs.createWriteStream(dest);
    r.pipe(f); f.on('finish', () => f.close(() => res()));
  }).on('error', rej);
});

/** 한 행이 "하늘이 아닌" 정도 — 초목(초록·채도)과 실루엣(아주 어두움). */
function rowNonSky(data, W, y) {
  let bad = 0, n = 0;
  for (let x = 0; x < W; x += 2) {
    const p = (y * W + x) * 4;
    const { h, s, v } = rgb2hsv(data[p], data[p + 1], data[p + 2]);
    if ((h > 60 && h < 170 && s > 0.22) || v < 0.10) bad++;
    n++;
  }
  return bad / Math.max(1, n);
}

/**
 * **지평선을 자동으로 찾습니다.**
 *
 * 135장에 손으로 자르는 값을 넣을 수는 없고, 안 자르면 길·집·나무가 하늘
 * 통계에 섞입니다. 위에서 아래로 훑어 "하늘 아님"이 처음 25% 를 넘는 행을
 * 찾고, 거기서 조금 더 올려 자릅니다.
 *
 * 위쪽 몇 행이 이미 하늘이 아니면(캔버스 가장자리·나뭇가지) 그 사진은
 * 버립니다 — 지평선을 못 믿습니다.
 */
function skyFraction(data, W, H) {
  const first = rowNonSky(data, W, Math.floor(H * 0.02));
  if (first > 0.25) return 0;
  for (let y = Math.floor(H * 0.05); y < H; y += 2) {
    if (rowNonSky(data, W, y) > 0.25) return Math.max(0, y / H - 0.03);
  }
  return 1.0;
}

/** 자른 하늘 안에서 아주 어두운(실루엣) 화소 비율. */
function darkFrac(data, W, H, sky) {
  const h = Math.round(H * sky);
  let d = 0, n = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < W; x += 2) {
    const p = (y * W + x) * 4;
    if (rgb2hsv(data[p], data[p + 1], data[p + 2]).v < 0.10) d++;
    n++;
  }
  return d / Math.max(1, n);
}

/** 8x8 평균 해시 — 거의 같은 사진을 걸러내는 용도로 충분합니다. */
function aHash(data, W, H, sky) {
  const h = Math.round(H * sky), g = [];
  for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
    let sum = 0, n = 0;
    for (let y = Math.floor(by * h / 8); y < Math.floor((by + 1) * h / 8); y += 3)
      for (let x = Math.floor(bx * W / 8); x < Math.floor((bx + 1) * W / 8); x += 3) {
        const p = (y * W + x) * 4;
        sum += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]; n++;
      }
    g.push(sum / Math.max(1, n));
  }
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  return g.map(v => (v > mean ? 1 : 0));
}
const hamming = (a, b) => a.reduce((s, v, i) => s + (v !== b[i] ? 1 : 0), 0);

(async () => {
  const hashes = {};
  const cands = JSON.parse(fs.readFileSync(path.join(DIR, 'candidates.json'), 'utf8'));
  fs.mkdirSync(RAW, { recursive: true });

  const kept = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const file = path.join(RAW, `c${String(i).padStart(3, '0')}.jpg`);
    if (!fs.existsSync(file)) {
      try { await download(c.thumb, file); } catch { continue; }
    }
    let img;
    try { img = jpeg.decode(fs.readFileSync(file), { useTArray: true }); } catch { continue; }
    const sky = skyFraction(img.data, img.width, img.height);
    // 하늘이 위쪽 40% 도 안 되면 하늘 사진이라 하기 어렵습니다.
    if (sky < 0.40) continue;
    // 행 단위 지평선 찾기는 **세로로 삐죽 든 것**을 못 잡습니다 — 나무·전봇대가
    // 그렇습니다. 자른 뒤 아주 어두운 화소가 많으면 실루엣이 든 것입니다.
    if (darkFrac(img.data, img.width, img.height, sky) > 0.06) continue;
    // 비슷한 사진이 몰리면 과녁이 그쪽으로 기웁니다 — 실제로 같은 자리에서
    // 찍은 분홍 노을이 8장 들어와 노을 과녁을 통째로 끌고 갈 뻔했습니다.
    // ⚠ 조건별로 나눠서 봅니다. 전역으로 두면 밋밋한 흐린 하늘끼리 해시가
    // 몰리면서 **다른 조건의 사진까지** 잡아먹습니다 — 실제로 노을이 18 → 3
    // 장으로 줄고 박명이 통째로 사라졌습니다.
    const h = aHash(img.data, img.width, img.height, sky);
    const hs = (hashes[c.tag] ??= []);
    if (hs.some(x => hamming(x, h) <= 6)) continue;
    hs.push(h);
    kept.push({ ...c, file: path.basename(file), sky: +sky.toFixed(3) });
  }
  fs.writeFileSync(path.join(DIR, 'screened.json'), JSON.stringify(kept, null, 2));
  const byTag = {};
  for (const k of kept) byTag[k.tag] = (byTag[k.tag] || 0) + 1;
  console.log('자동 선별 통과:', Object.entries(byTag).map(([k, v]) => `${k} ${v}`).join('  '));
  console.log(`${cands.length} → ${kept.length}장`);

  // ── 접촉인화 ─────────────────────────────────────────────────────────
  const TH = 150, COLS = 10;
  const groups = {};
  for (const k of kept) (groups[k.tag] ??= []).push(k);
  for (const [tag, list] of Object.entries(groups)) {
    const rows = Math.ceil(list.length / COLS);
    const png = new PNG({ width: COLS * TH, height: rows * TH });
    png.data.fill(20);
    list.forEach((k, idx) => {
      let img;
      try { img = jpeg.decode(fs.readFileSync(path.join(RAW, k.file)), { useTArray: true }); }
      catch { return; }
      const ox = (idx % COLS) * TH, oy = Math.floor(idx / COLS) * TH;
      // **자른 뒤**를 붙입니다 — 실제로 재는 것이 이 화면이라야 확인이 됩니다.
      const ch = Math.max(1, Math.round(img.height * k.sky));
      for (let y = 0; y < TH; y++) for (let x = 0; x < TH; x++) {
        const sx = Math.floor(x * img.width / TH), sy = Math.floor(y * ch / TH);
        const s = (sy * img.width + sx) * 4, d = ((oy + y) * COLS * TH + ox + x) * 4;
        png.data[d] = img.data[s]; png.data[d+1] = img.data[s+1];
        png.data[d+2] = img.data[s+2]; png.data[d+3] = 255;
      }
    });
    const out = path.join(DIR, `sheet-${tag}.png`);
    png.pack().pipe(fs.createWriteStream(out));
    console.log(`  ${tag}: ${list.length}장 → sheet-${tag}.png  (칸 번호 = 목록 순서)`);
  }
})();
