/**
 * **실제 하늘 사진의 지표를 뽑습니다** — 렌더가 맞춰야 할 과녁.
 *
 * 준비: node tools/photo-ref/harvest-candidates.js
 *       node tools/photo-ref/screen-candidates.js
 * 사용: node tools/photo-ref/measure-photos.js
 *
 * 결과: .harness/photoref/photo-stats.json
 *
 * 색 지표(채도·대비·국소대비)와 **크기·모양 지표**(구름각크기·무늬기울기)를
 * 같이 냅니다. 뒤의 둘은 사진마다 화각이 달라 각도로 환산해야 의미가 있고,
 * 그래서 EXIF 에 35mm 환산 초점거리가 있는 사진만 씁니다.
 */
const fs = require('fs');
const path = require('path');
const jpeg = require(path.join(__dirname, '../qr-report/node_modules/jpeg-js'));
const { skyStats, angularSpectrum } = require('./sky-stats');

const DIR = path.join(__dirname, '../../.harness/photoref');
const RAW = path.join(DIR, 'raw');
const shots = JSON.parse(fs.readFileSync(path.join(DIR, 'screened.json'), 'utf8'));

const rows = [];
for (const m of shots) {
  const p = path.join(RAW, m.file);
  if (!fs.existsSync(p)) continue;
  let img;
  try { img = jpeg.decode(fs.readFileSync(p), { useTArray: true }); } catch { continue; }
  const s = skyStats(img.data, img.width, img.height, { skyFrac: m.sky });
  const sp = angularSpectrum(img.data, img.width, img.height,
    { skyFrac: m.sky, fovDeg: m.fovDeg });
  if (!sp) continue;
  rows.push({ file: m.file, tag: m.tag, 화각: m.fovDeg, ...s, ...sp });
}

const byTag = {};
for (const r of rows) (byTag[r.tag] ??= []).push(r);

/** 중앙값 — 한두 장의 별난 사진이 과녁을 끌고 가지 않게 평균 대신 씁니다. */
const med = (a, k) => {
  const v = a.map(x => x[k]).filter(x => Number.isFinite(x)).sort((p, q) => p - q);
  return v.length ? +(v[Math.floor(v.length / 2)]).toFixed(3) : 0;
};
const KEYS = ['채도', '상단채도', '하단채도', '채도기울기', '대비', '국소대비',
              '밝기폭', '색상편차', '흰포화', '원색', '채널클립',
              '구름각크기', '무늬기울기'];

const target = {};
for (const [tag, a] of Object.entries(byTag)) {
  target[tag] = { 표본수: a.length };
  for (const k of KEYS) target[tag][k] = med(a, k);
}

const W = (v, n) => String(v).padStart(n);
console.log('조건별 **중앙값** — 하늘 부분만, 폭 320 으로 맞춘 뒤\n');
console.log('  조건          n   채도  기울기  대비  국소   구름각크기  무늬기울기  화각중앙');
for (const [tag, t] of Object.entries(target)) {
  const fovs = byTag[tag].map(r => r.화각).sort((a, b) => a - b);
  console.log(`  ${tag.padEnd(13)}${W(t.표본수,2)} ${W(t.채도,6)} ${W(t.채도기울기,6)} ` +
    `${W(t.대비,5)} ${W(t.국소대비,6)} ${W(t.구름각크기,10)}° ${W(t.무늬기울기,10)} ` +
    `${W(fovs[Math.floor(fovs.length/2)],8)}°`);
}
fs.writeFileSync(path.join(DIR, 'photo-stats.json'), JSON.stringify({ rows, target }, null, 2));
console.log(`\n→ ${path.join(DIR, 'photo-stats.json')}`);
