// RULER-tsun 엔진 해: src/utils/solarPosition.ts 를 typescript 로 메모리에서 옮겨 sunPosition(NOAA) 을 씀. SunCalc 금지.
//   nice -n 19 node sun-tsun.cjs > sun-tsun.json
const ts = require('/home/user/solar-path/node_modules/typescript');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = '/home/user/solar-path/src/utils/solarPosition.ts';
const src = fs.readFileSync(SRC, 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', out)(m, m.exports, require);
const S = m.exports; const D = 180 / Math.PI;
function pos(iso, lat, lon) { const p = S.sunPosition(new Date(iso), lat, lon); return { alt: +(p.altitude * D).toFixed(4), az: +(((p.azimuth * D) + 180) % 360).toFixed(4) }; }
const res = { src: SRC, src_sha256: crypto.createHash('sha256').update(src).digest('hex'), photos: {}, ra: {} };
res.photos.P1 = pos('2026-10-02T18:22:21.793+09:00', 36.046, 136.278);
res.photos.P2 = pos('2026-10-05T17:53:43.772+09:00', 34.97342, 138.77713);
res.photos.P3 = pos('2026-10-05T17:14:28.847+09:00', 34.97342, 138.77713);
// R-A scenes: Heda quay, 2026-10-05 evening; find times for target sun altitudes by bisection (engine sun).
function solve(lat, lon, day, target) {
  let a = Date.parse(day + 'T06:00:00Z'), b = Date.parse(day + 'T10:30:00Z'); // falling sun in the evening (JST 15:00-19:30)
  for (let i = 0; i < 60; i++) { const c = (a + b) / 2; const al = S.sunPosition(new Date(c), lat, lon).altitude * D; if (al > target) a = c; else b = c; }
  const t = new Date(Math.round((a + b) / 2 / 1000) * 1000); return { iso: t.toISOString(), ...pos(t.toISOString(), lat, lon) };
}
for (const s of [15, 8, 4, 1.1, -1.0, -2.5, -4.0, -6.9, -9.8]) res.ra['heda_' + s] = solve(34.97342, 138.77713, '2026-10-05', s);
for (const s of [-2.5, -4.0, -9.84]) res.ra['fukui_' + s] = solve(36.046, 136.278, '2026-10-02', s);
// high-sun guard times (afternoon, Heda)
function solveUp(lat, lon, day, target) {
  let a = Date.parse(day + 'T03:00:00Z'), b = Date.parse(day + 'T08:00:00Z');
  for (let i = 0; i < 60; i++) { const c = (a + b) / 2; const al = S.sunPosition(new Date(c), lat, lon).altitude * D; if (al > target) a = c; else b = c; }
  const t = new Date(Math.round((a + b) / 2 / 1000) * 1000); return { iso: t.toISOString(), ...pos(t.toISOString(), lat, lon) };
}
const hi = {};
for (const s of [45, 30, 12.1, 11.9]) hi['heda_' + s] = solveUp(34.97342, 138.77713, '2026-10-05', s);
res.high = hi;
res.note = 'engine NOAA sunPosition (geometric, no refraction); never SunCalc (reads ~0.2 deg high)';
console.log(JSON.stringify(res, null, 1));
