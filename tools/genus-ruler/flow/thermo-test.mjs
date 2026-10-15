#!/usr/bin/env node
/**
 * thermo-test.mjs — §135 열역학 입력(`weather.ts: fetchThermoProfile` · `attachThermo`)의 단위 테스트. 네트워크 없이 fetch 를 가짜로 둡니다.
 *   node tools/genus-ruler/flow/thermo-test.mjs
 * 검사: 요청 URL(변수 33개·예보/아카이브 구분) · 값 파싱(null → NaN) · 지원 안 되는 응답은 null 로 캐시하고 두 번 두드리지 않음 ·
 * 시각 축이 어긋날 때 NaN 으로 채움 · 같은 날 같은 칸 재요청은 캐시.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/t1';
fs.mkdirSync(OUT, { recursive: true });
const BUNDLE = path.join(OUT, 'weather.cjs');
execFileSync('npx', ['esbuild', path.join(ROOT, 'src/utils/weather.ts'), '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', `--outfile=${BUNDLE}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const W = require(BUNDLE);

const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`); };

const hours = Array.from({ length: 24 }, (_, i) => `2026-10-12T${String(i).padStart(2, '0')}:00`);
const urls = [];
let mode = 'full';
globalThis.fetch = async (url) => {
  urls.push(String(url));
  const h = { time: hours };
  const all = String(url).split('hourly=')[1].split('&')[0].split(',');
  for (const k of all) {
    if (mode === 'archive' && (k === 'cape' || k === 'freezing_level_height' || /^(temperature|relative_humidity)_\d+hPa$/.test(k))) h[k] = hours.map(() => null);
    else if (k === 'cape') h[k] = hours.map((_, i) => (i === 5 ? null : 100 + i));
    else h[k] = hours.map((_, i) => 10 + i * 0.5);
  }
  if (mode === 'none') for (const k of all) h[k] = hours.map(() => null);
  return { ok: true, status: 200, json: async () => ({ hourly: h }) };
};
const D = new Date('2026-10-12T03:00:00Z');

// 1) 예보 경로
{
  const t = await W.fetchThermoProfile(37.57, 126.98, D);
  const u = urls[0];
  const vars = u.split('hourly=')[1].split('&')[0].split(',');
  check('thermo URL uses the forecast API with 33 variables', u.includes('api.open-meteo.com/v1/forecast') && vars.length === 33, `${vars.length} variables`);
  check('thermo URL has surface + 15 temperature + 13 humidity variables', vars.includes('temperature_2m') && vars.includes('dew_point_2m') && vars.includes('cape') && vars.includes('freezing_level_height') && vars.includes('boundary_layer_height')
    && vars.filter(v => /^temperature_\d+hPa$/.test(v)).length === 15 && vars.filter(v => /^relative_humidity_\d+hPa$/.test(v)).length === 13, '');
  check('thermo parses arrays: 15 temperature levels × 24 h, 13 humidity levels × 24 h', t && t.profileTempC.length === 15 && t.profileRhPct.length === 13 && t.profileTempC[0].length === 24, '');
  check('thermo maps null → NaN (cape at hour 5)', Number.isNaN(t.capeJkg[5]) && t.capeJkg[6] === 106, `cape[5]=${t.capeJkg[5]} cape[6]=${t.capeJkg[6]}`);
  const n = urls.length; await W.fetchThermoProfile(37.57, 126.98, D);
  check('same cell and day is served from the cache (no second request)', urls.length === n, `${urls.length - n} extra requests`);
}
// 2) 아카이브 경로(5일 넘은 과거): 서핑 변수만 값이 있고 나머지는 NaN
{
  mode = 'archive';
  const old = new Date(Date.now() - 20 * 86400000);
  const t = await W.fetchThermoProfile(35.1, 129.0, old);
  const u = urls[urls.length - 1];
  check('thermo uses the archive API for dates older than 5 days', u.includes('archive-api.open-meteo.com'), '');
  check('archive: surface values kept, upper-air fields NaN', t && t.t2mC.every(Number.isFinite) && t.capeJkg.every(Number.isNaN) && t.profileTempC.every(a => a.every(Number.isNaN)), '');
}
// 3) 값이 하나도 없으면 null 로 캐시
{
  mode = 'none';
  const t1 = await W.fetchThermoProfile(33.5, 126.5, D); const n = urls.length;
  const t2 = await W.fetchThermoProfile(33.5, 126.5, D);
  check('all-null response → null, cached so it is not requested again', t1 === null && t2 === null && urls.length === n, `${urls.length - n} extra requests`);
}
// 4) attachThermo: 같은 시각 축 / 어긋난 시각 축
{
  mode = 'full';
  const t = await W.fetchThermoProfile(36.0, 127.5, D);
  const same = { time: hours.slice(), timeMs: [], low: [], mid: [], high: [] };
  W.attachThermo(same, t);
  check('attachThermo on the same time axis copies values through', same.t2mC[7] === t.t2mC[7] && same.profileTempC[3][7] === t.profileTempC[3][7] && same.profileRhPct[12].length === 24, '');
  const shifted = { time: ['2026-10-11T23:00', ...hours.slice(0, 5)], timeMs: [], low: [], mid: [], high: [] };
  W.attachThermo(shifted, t);
  check('attachThermo on a shifted axis maps by time string and fills missing hours with NaN', Number.isNaN(shifted.t2mC[0]) && shifted.t2mC[1] === t.t2mC[0] && shifted.t2mC[5] === t.t2mC[4], `t2m[0]=${shifted.t2mC[0]} t2m[1]=${shifted.t2mC[1]}`);
}
const nFail = results.filter(r => !r).length;
console.log(`\n${results.length - nFail}/${results.length} passed${nFail ? ` — ${nFail} FAILED` : ''}`);
process.exit(nFail ? 1 : 0);
