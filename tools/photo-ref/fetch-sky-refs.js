/**
 * **실제 하늘 사진을 내려받습니다** — 렌더의 잣대가 될 원본.
 *
 * "현실감이 없다"는 지적은 숫자가 없으면 취향 논쟁이 됩니다. 위키미디어
 * 공용에서 조건별로 사진을 받아 두고, `sky-stats.js` 가 렌더와 **같은
 * 알고리즘**으로 두 쪽을 재서 어디가 몇 % 다른지 말하게 합니다.
 *
 * 사진은 `.harness/photoref/` 로 갑니다 — gitignore 된 곳입니다. 저장소에는
 * **측정값만** 남기고 이미지는 남기지 않습니다(라이선스·용량). 아래 목록의
 * 파일명이 곧 출처라, 누구든 이 스크립트를 다시 돌리면 같은 사진을 받습니다.
 *
 * 사용: node tools/photo-ref/fetch-sky-refs.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '../../.harness/photoref');
const UA = 'BeforeGlow-SkyResearch/1.0 (https://github.com/substringjp-sudo/solar-path)';

// 전천후 격자(build-allsky-matrix.js)의 칸에 대응하는 조건들입니다.
//
// **제목을 정확히 박아 둡니다** — 검색으로 고르면 돌릴 때마다 다른 사진이
// 옵니다. 실제로 첫 판에서 검색이 비행기 날개·건물·책 표지를 물어 왔고,
// 눈으로 확인하기 전에는 그게 하늘 통계인 줄 알았을 것입니다.
//
// `sky` 는 **위에서부터 몇 %가 하늘인가** 입니다. 지면·건물·나무가 든
// 사진은 잘라 내야 통계가 하늘 것이 됩니다. 눈으로 보고 손으로 넣은
// 값이라, 사진을 바꾸면 이 값도 다시 봐야 합니다.
const WANTED = [
  ['day-cumulus',  'Clouds in the sky in August 2014.JPG',                  1.00],
  ['day-cumulus',  'White Cumulus Clouds against Blue Sky (2).jpg',         0.96],
  ['day-cirrus',   'Cirrus fibratus radiatus.jpg',                          0.72],
  ['day-zenith',   'Cirrocumulus, Altocumulus castellanus, and Altocumulus lenticularis.jpg', 0.88],
  ['day-overcast', 'Stratocumulus stratiformis opacus in Texas.jpg',        0.60],
  ['sunset',       'Altocumulus at sunset Galley Common June 13 2022 08.jpg', 0.85],
  ['sunset-hdr',   'Sunset over the Pacific Ocean from Maui, Hawaii.jpg',   0.58],
  ['twilight',     'Blue hour twilight in the Mojave desert, California 2017.jpg', 0.64],
  ['twilight',     'Nautical twilight sunset over Sandy Lake (DSCF3005).jpg', 0.30],
];

function api(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': UA } }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(b));
    }).on('error', rej);
  });
}
function download(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': UA } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
        return download(r.headers.location, dest).then(res, rej);
      if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode));
      const f = fs.createWriteStream(dest);
      r.pipe(f); f.on('finish', () => f.close(() => res()));
    }).on('error', rej);
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];
  let n = 0;
  for (const [tag, title, sky] of WANTED) {
    const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
      + '&titles=' + encodeURIComponent('File:' + title)
      + '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1024';
    let pages;
    try { pages = JSON.parse(await api(u)).query?.pages; } catch { pages = null; }
    const p = pages && Object.values(pages)[0];
    if (!p || p.missing !== undefined || !p.imageinfo) {
      console.log('  건너뜀(없음):', title); continue;
    }
    const ii = p.imageinfo[0];
    const lic = ii.extmetadata?.LicenseShortName?.value ?? '?';
    const artist = (ii.extmetadata?.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim();
    const file = `${tag}_${String(++n).padStart(2, '0')}.jpg`;
    try {
      await download(ii.thumburl.split('?')[0], path.join(OUT, file));
      manifest.push({ file, tag, sky, title: p.title, license: lic, artist,
                      url: ii.descriptionurl });
      console.log(`  ${file}  하늘 ${(sky*100).toFixed(0)}%  ← ${p.title}  [${lic}]`);
    } catch (e) { console.log('  실패:', p.title, e.message); }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length}장 → ${OUT}`);
})();
