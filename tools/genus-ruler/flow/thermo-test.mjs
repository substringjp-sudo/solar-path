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
// §163: 자료원은 '오늘' 과의 달력 날짜 차로 정해지므로 테스트는 '지금' 을 주입합니다(D 당일 = forecast).
const NOW = Date.parse('2026-10-12T12:00:00Z');

// 1) 예보 경로
{
  const t = await W.fetchThermoProfile(37.57, 126.98, D, undefined, NOW);
  const u = urls[0];
  const vars = u.split('hourly=')[1].split('&')[0].split(',');
  check('thermo URL uses the forecast API with 33 variables', u.includes('api.open-meteo.com/v1/forecast') && vars.length === 33, `${vars.length} variables`);
  check('thermo URL has surface + 15 temperature + 13 humidity variables', vars.includes('temperature_2m') && vars.includes('dew_point_2m') && vars.includes('cape') && vars.includes('freezing_level_height') && vars.includes('boundary_layer_height')
    && vars.filter(v => /^temperature_\d+hPa$/.test(v)).length === 15 && vars.filter(v => /^relative_humidity_\d+hPa$/.test(v)).length === 13, '');
  check('thermo parses arrays: 15 temperature levels × 24 h, 13 humidity levels × 24 h', t && t.profileTempC.length === 15 && t.profileRhPct.length === 13 && t.profileTempC[0].length === 24, '');
  check('thermo maps null → NaN (cape at hour 5)', Number.isNaN(t.capeJkg[5]) && t.capeJkg[6] === 106, `cape[5]=${t.capeJkg[5]} cape[6]=${t.capeJkg[6]}`);
  const n = urls.length; await W.fetchThermoProfile(37.57, 126.98, D, undefined, NOW);
  check('same cell and day is served from the cache (no second request)', urls.length === n, `${urls.length - n} extra requests`);
}
// 2) §163 과거 경로(6 일 넘은 과거, 2024-02-03 이후): 과거 예보 보관 API, 모델 미지정. 가짜 응답은 archive 꼴(상층 null)로 두어 NaN 채움도 함께 검사.
{
  mode = 'archive';
  const old = new Date(NOW - 20 * 86400000);
  const t = await W.fetchThermoProfile(35.1, 129.0, old, undefined, NOW);
  const u = urls[urls.length - 1];
  check('thermo uses the historical-forecast API for dates older than 5 days (no models=)', u.includes('historical-forecast-api.open-meteo.com') && !u.includes('models='), '');
  check('null upper-air fields → NaN, surface values kept', t && t.t2mC.every(Number.isFinite) && t.capeJkg.every(Number.isNaN) && t.profileTempC.every(a => a.every(Number.isNaN)), '');
}
// 2b) §163 보관 API 가 403 이면 archive 로 후퇴하고 세션 동안 기억한다
{
  mode = 'full';
  const base = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('historical-forecast-api') ? (urls.push(String(url)), { ok: false, status: 403, json: async () => ({}) }) : base(url));
  const old = new Date(NOW - 30 * 86400000);
  const t = await W.fetchThermoProfile(36.0, 128.0, old, undefined, NOW);
  const last2 = urls.slice(-2);
  check('403 on historical → retried on archive-api and parsed', t && last2[0].includes('historical-forecast-api') && last2[1].includes('archive-api.open-meteo.com'), last2.map(x => x.split('?')[0]).join(' → '));
  const n = urls.length;
  await W.fetchThermoProfile(36.5, 128.5, old, undefined, NOW);
  check('forbidden flag remembered: next past request goes straight to archive-api', urls.length === n + 1 && urls[urls.length - 1].includes('archive-api.open-meteo.com'), '');
  globalThis.fetch = base;
}
// 2c) 2022-11-24 이전 과거는 archive(모델 미지정)
{
  mode = 'archive';
  const t = await W.fetchThermoProfile(35.2, 129.1, new Date('2021-06-01T03:00:00Z'), undefined, NOW);
  check('dates before 2022-11-24 use archive-api', urls[urls.length - 1].includes('archive-api.open-meteo.com') && t !== null, '');
}
// 3) 값이 하나도 없으면 null 로 캐시
{
  mode = 'none';
  const t1 = await W.fetchThermoProfile(33.5, 126.5, D, undefined, NOW); const n = urls.length;
  const t2 = await W.fetchThermoProfile(33.5, 126.5, D, undefined, NOW);
  check('all-null response → null, cached so it is not requested again', t1 === null && t2 === null && urls.length === n, `${urls.length - n} extra requests`);
}
// 4) attachThermo: 같은 시각 축 / 어긋난 시각 축
{
  mode = 'full';
  const t = await W.fetchThermoProfile(36.0, 127.5, D, undefined, NOW);
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
