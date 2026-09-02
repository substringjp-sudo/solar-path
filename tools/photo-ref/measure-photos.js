/**
 * **실제 하늘 사진의 지표를 뽑습니다** — 렌더가 맞춰야 할 목표값.
 *
 * 준비: node tools/photo-ref/fetch-sky-refs.js
 * 사용: node tools/photo-ref/measure-photos.js
 *
 * 결과는 `.harness/photoref/photo-stats.json` 으로도 나갑니다 —
 * verify-photo-match.js 가 그 파일을 목표로 읽습니다.
 */
const fs = require('fs');
const path = require('path');
const jpeg = require(path.join(__dirname, '../qr-report/node_modules/jpeg-js'));
const { skyStats } = require('./sky-stats');

const DIR = path.join(__dirname, '../../.harness/photoref');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

const rows = [];
for (const m of manifest) {
  const p = path.join(DIR, m.file);
  if (!fs.existsSync(p)) continue;
  const img = jpeg.decode(fs.readFileSync(p), { useTArray: true });
  // JPEG 는 위가 y=0 입니다 — skyStats 가 기대하는 방향 그대로입니다.
  const s = skyStats(img.data, img.width, img.height, { skyFrac: m.sky });
  rows.push({ file: m.file, tag: m.tag, ...s });
}

const W = (s, n) => String(s).padStart(n);
console.log('사진 지표 — 하늘 부분만, 폭 320 으로 맞춘 뒤\n');
console.log('  조건          채도  상단  하단  기울기  대비  국소  밝기폭 색상  편차  흰포화 원색');
for (const r of rows) {
  console.log(`  ${r.tag.padEnd(13)}${W(r.채도,4)} ${W(r.상단채도,5)} ${W(r.하단채도,5)} `
    + `${W(r.채도기울기,6)} ${W(r.대비,5)} ${W(r.국소대비,5)} ${W(r.밝기폭,6)} `
    + `${W(r.색상,5)} ${W(r.색상편차,5)} ${W(r.흰포화,6)} ${W(r.원색,5)}`);
}

// 조건별 평균 — 렌더가 겨눌 과녁입니다.
const byTag = {};
for (const r of rows) (byTag[r.tag] ??= []).push(r);
const avg = (a, k) => +(a.reduce((s, x) => s + x[k], 0) / a.length).toFixed(3);
const target = {};
for (const [tag, a] of Object.entries(byTag)) {
  target[tag] = {};
  for (const k of ['채도','상단채도','하단채도','채도기울기','대비','국소대비',
                   '밝기폭','색상편차','흰포화','원색'])
    target[tag][k] = avg(a, k);
}
fs.writeFileSync(path.join(DIR, 'photo-stats.json'),
  JSON.stringify({ rows, target }, null, 2));
console.log(`\n조건별 평균 → ${path.join(DIR, 'photo-stats.json')}`);
