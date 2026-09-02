/**
 * **화각을 아는 하늘 사진만 골라냅니다.**
 *
 * 구름 "크기"는 화면에서 몇 화소가 아니라 하늘에서 몇 도입니다. 화각을 모르면
 * 사진과 렌더를 비교할 때 렌즈를 비교하는 셈이 됩니다 — 실제로 첫 표본에
 * 300mm(화각 6.9°)로 찍은 박명 사진이 들어 있었습니다. 우리 렌더는 62° 라
 * 그대로 비교하면 구름 크기가 9배 어긋납니다.
 *
 * 그래서 **EXIF 의 FocalLengthIn35mmFilm 이 있는 것만** 받습니다. 초점거리와
 * 크롭 팩터로 환산할 수도 있지만 기종별 센서 크기를 추정해야 해서 조용히
 * 틀리기 쉽습니다. 여기서는 애매하면 버립니다.
 *
 * 위키미디어 **썸네일은 EXIF 를 지웁니다.** 그래서 화각은 API 의 metadata
 * 에서 받고, 그림은 썸네일로 받습니다.
 *
 * 사용: node tools/photo-ref/harvest-candidates.js
 * 결과: .harness/photoref/candidates.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = 'BeforeGlow-SkyResearch/1.0 (https://github.com/substringjp-sudo/solar-path)';
const OUT = path.join(__dirname, '../../.harness/photoref');

// 전천후 격자의 칸들을 덮는 검색어입니다.
const QUERIES = [
  ['day-cumulus',   ['cumulus humilis blue sky', 'fair weather cumulus sky',
                     'cumulus mediocris sky', 'Cumulus clouds blue sky']],
  ['day-cirrus',    ['cirrus fibratus sky', 'cirrus uncinus sky', 'cirrostratus halo sky']],
  ['day-zenith',    ['altocumulus stratiformis', 'cirrocumulus undulatus',
                     'altocumulus perlucidus']],
  // ⚠ 흐린 하늘은 **자유 검색으로 뽑으면 안 됩니다.** 검색어를 넓혔더니
  // 43장 중 대부분이 노을·박명이었고, 눈으로 안 봤으면 그 과녁으로 튜닝할
  // 뻔했습니다. 아래는 대신 큐레이션된 분류(category)에서 가져옵니다.
  ['day-overcast',  []],
  ['sunset',        ['sunset clouds sky', 'altocumulus sunset', 'sunset cirrus sky',
                     'coucher de soleil nuages']],
  ['twilight',      ['civil twilight sky clouds', 'blue hour sky clouds',
                     'afterglow twilight sky', 'nautical twilight sky']],
  ['night',         ['night sky clouds moonlight', 'moonlit clouds night sky']],
];

const get = u => new Promise((res, rej) => {
  https.get(u, { headers: { 'User-Agent': UA } }, r => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => res(b));
  }).on('error', rej);
});

const API = 'https://commons.wikimedia.org/w/api.php?action=query&format=json';

// 큐레이션된 분류 — 자유 검색보다 훨씬 정확합니다. 사람이 "이건 층적운"이라고
// 넣어 둔 것이라, 검색 순위가 엉뚱한 노을을 물어 오는 일이 없습니다.
const CATEGORIES = [
  ['day-overcast', 'Category:Stratocumulus opacus'],
  ['day-overcast', 'Category:Nimbostratus'],
  ['day-overcast', 'Category:Altostratus'],
  ['day-overcast', 'Category:Stratus (cloud)'],
  ['day-overcast', 'Category:Overcast'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const found = [];
  const seen = new Set();
  for (const [tag, terms] of QUERIES) {
    for (const term of terms) {
      let d;
      try {
        d = JSON.parse(await get(`${API}&generator=search&gsrnamespace=6&gsrlimit=25`
          + `&gsrsearch=${encodeURIComponent(term)}`
          + `&prop=imageinfo&iiprop=url|metadata|extmetadata|size&iiurlwidth=1200`));
      } catch { continue; }
      for (const p of Object.values(d.query?.pages || {})) {
        if (seen.has(p.title)) continue;
        const ii = p.imageinfo?.[0];
        if (!ii || !/\.jpe?g$/i.test(p.title)) continue;
        const md = ii.metadata || [];
        const f35 = md.find(x => x.name === 'FocalLengthIn35mmFilm');
        const v = f35 && Number(f35.value);
        if (!v || v < 8 || v > 400) continue;          // 없거나 말이 안 되면 버림
        seen.add(p.title);
        found.push({
          tag, title: p.title, focal35: v,
          fovDeg: +(2 * Math.atan(36 / (2 * v)) * 180 / Math.PI).toFixed(1),
          width: ii.width, height: ii.height,
          thumb: ii.thumburl.split('?')[0],
          license: ii.extmetadata?.LicenseShortName?.value ?? '?',
          url: ii.descriptionurl,
        });
      }
    }
    console.log(`  ${tag.padEnd(13)} ${found.filter(f => f.tag === tag).length}장 (화각 있음)`);
  }

  for (const [tag, cat] of CATEGORIES) {
    let d;
    try {
      d = JSON.parse(await get(`${API}&generator=categorymembers&gcmtype=file&gcmlimit=60`
        + `&gcmtitle=${encodeURIComponent(cat)}`
        + `&prop=imageinfo&iiprop=url|metadata|extmetadata|size&iiurlwidth=1200`));
    } catch { continue; }
    let n = 0;
    for (const p of Object.values(d.query?.pages || {})) {
      if (seen.has(p.title)) continue;
      const ii = p.imageinfo?.[0];
      if (!ii || !/\.jpe?g$/i.test(p.title)) continue;
      const f35 = (ii.metadata || []).find(x => x.name === 'FocalLengthIn35mmFilm');
      const v = f35 && Number(f35.value);
      if (!v || v < 8 || v > 400) continue;
      seen.add(p.title); n++;
      found.push({ tag, title: p.title, focal35: v,
        fovDeg: +(2 * Math.atan(36 / (2 * v)) * 180 / Math.PI).toFixed(1),
        width: ii.width, height: ii.height, thumb: ii.thumburl.split('?')[0],
        license: ii.extmetadata?.LicenseShortName?.value ?? '?', url: ii.descriptionurl });
    }
    console.log(`  ${cat.padEnd(34)} +${n}장`);
  }
  fs.writeFileSync(path.join(OUT, 'candidates.json'), JSON.stringify(found, null, 2));
  console.log(`\n총 ${found.length}장 → candidates.json`);
  const fovs = found.map(f => f.fovDeg).sort((a, b) => a - b);
  console.log(`화각 범위 ${fovs[0]}° ~ ${fovs[fovs.length - 1]}°  (중앙값 ${fovs[Math.floor(fovs.length/2)]}°)`);
})();
