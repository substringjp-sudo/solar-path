const API = 'https://commons.wikimedia.org/w/api.php?action=query&format=json';
const UA = 'solar-path-photoref/1.0 (research)';
const CATS = process.argv.slice(2);
(async () => {
  const titles = CATS.map(c => 'Category:' + c).join('|');
  const r = await fetch(API + '&prop=categoryinfo&titles=' + encodeURIComponent(titles), { headers: { 'User-Agent': UA } });
  const d = await r.json();
  for (const p of Object.values(d.query.pages)) console.log(p.title, p.missing !== undefined ? 'MISSING' : JSON.stringify(p.categoryinfo));
})();
