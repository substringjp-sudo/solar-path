// 구름 종류별 참고 사진(낮) 수집 — Commons 분류에서, 올린 사람당 최대 MAXU 장, 해질녘·밤 제목은 뺍니다.
const fs = require('fs');
const API = 'https://commons.wikimedia.org/w/api.php?action=query&format=json';
const UA = 'solar-path-photoref/1.0 (research)';
const GENUS = {
  Cu: ['Cumulus humilis clouds', 'Cumulus mediocris clouds'],
  AcCc: ['Altocumulus stratiformis clouds', 'Altocumulus floccus clouds', 'Altocumulus clouds', 'Cirrocumulus clouds'],
  Ci: ['Cirrus fibratus clouds', 'Cirrus uncinus clouds', 'Cirrus clouds'],
  StSc: ['Stratocumulus clouds', 'Stratus clouds'],
};
const MAXU = 8, PER = 140;
const BAD = /sunset|sunrise|dusk|dawn|night|moon|twilight|afterglow|abend|morgen|夕|朝|silhouette|airplane|aircraft|contrail|rainbow|lightning|map|diagram|satellite|from space|from above|aerial|from plane|from aircraft|window/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(q) { for (let i = 0; i < 5; i++) { try { const r = await fetch(API + q, { headers: { 'User-Agent': UA } }); if (r.ok) return r.json(); } catch {} await sleep(1500 * 2 ** i); } return {}; }
(async () => {
  const out = {};
  for (const [g, cats] of Object.entries(GENUS)) {
    const pages = [];
    for (const c of cats) {
      let cont = '';
      for (let k = 0; k < 6; k++) {
        const d = await api(`&generator=categorymembers&gcmtype=file&gcmlimit=200&gcmtitle=${encodeURIComponent('Category:' + c)}&prop=imageinfo&iiprop=url|user|size|mime&iiurlwidth=640${cont}`);
        for (const p of Object.values(d.query?.pages || {})) pages.push({ ...p, cat: c });
        if (!d.continue) break; cont = '&gcmcontinue=' + encodeURIComponent(d.continue.gcmcontinue); await sleep(300);
      }
    }
    // 섞어서(제목 해시) 고르게 — 연작이 앞에 몰리지 않게
    const h = s => { let x = 2166136261; for (const ch of s) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
    pages.sort((a, b) => h(a.title) - h(b.title));
    const perUser = {}, seen = new Set(), pick = [];
    for (const p of pages) {
      const ii = p.imageinfo?.[0]; if (!ii || ii.mime !== 'image/jpeg' || seen.has(p.title)) continue;
      if (BAD.test(p.title)) continue;
      if (ii.width < 800 || ii.height < 500) continue;
      perUser[ii.user] = (perUser[ii.user] || 0) + 1; if (perUser[ii.user] > MAXU) continue;
      seen.add(p.title); pick.push({ title: p.title, cat: p.cat, user: ii.user, w: ii.width, h: ii.height, thumb: ii.thumburl, url: ii.descriptionurl });
      if (pick.length >= PER) break;
    }
    fs.mkdirSync('thumbs/' + g, { recursive: true });
    let n = 0;
    for (const [i, q] of pick.entries()) {
      const f = `thumbs/${g}/${String(i).padStart(3, '0')}.jpg`; q.file = f;
      if (fs.existsSync(f)) { n++; continue; }
      for (let k = 0; k < 4; k++) { try { const r = await fetch(q.thumb, { headers: { 'User-Agent': UA } }); if (r.ok) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); n++; break; } } catch {} await sleep(1000 * 2 ** k); }
      await sleep(150);
    }
    out[g] = pick;
    console.log(g, 'candidates', pages.length, 'picked', pick.length, 'downloaded', n, 'users', Object.keys(perUser).length);
  }
  fs.writeFileSync('genus-photos.json', JSON.stringify(out, null, 1));
})();
