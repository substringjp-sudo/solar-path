#!/usr/bin/env node
/**
 * g1-live.mjs — G1(d)(자 L748 "(d) 두 옵션이 0 인 앱 경로에서 망 요청 목록(URL·순서), 장면 재구성 횟수, 새 타이머 수(`liveScene`
 * 단위 시험에서 요청을 가로챔). D6·D14 의 별도 요청(바람·운량·강수·일사)이 목록에 없어야 함"; S3-design.md §8 (d)).
 *
 *   node tools/genus-ruler/oro/g1/g1-live.mjs --out <d.json>
 *
 * 무엇을 돌리나(앱 모듈 그대로, 작업 트리의 src — 깨끗한지 git status --porcelain 으로 적음):
 *   esbuild 0.28.2 로 weather.ts(fetchDayWeatherRing·fetchWeatherCanary·getInterpolatedWeather), metar.ts(fetchNearestMetar),
 *   liveScene.ts(buildLiveScene), sceneKey.ts(volSceneKey) 를 묶고(--define:__DEV__=false, 앱 tsconfig), 다음을 앱의 차례로 부릅니다.
 *     1. SkyScreen 의 날씨 받기: Promise.all([fetchWeatherCanary(lat, lon, t, signal), fetchDayWeatherRing(lat, lon, t, false, signal)])
 *     2. SkyScene3D 의 METAR 첫 받기: fetchNearestMetar(lat, lon, signal)
 *     3. SkyScene3D 의 볼륨 장면 고리(장면 시각 05:00~19:00 KST, 5 분 간격 169 칸): weather = getInterpolatedWeather(path, t),
 *        qKey(앱 식, 설정 = 두 옵션 0) 가 바뀌거나 volSceneKey({sceneMs, lat, lon, elevM, metarId, metarTimeMs, obs: weather[0],
 *        sample: weather[min(4, len−1)]}) 가 바뀌면 buildLiveScene({…, ...OPTIONS}) — 그 횟수가 '장면 재구성 횟수'.
 *   옵션 OPTIONS = {macroOro: 0, regime: 0} 를 buildLiveScene 인자와 설정(qKey)에 함께 넣습니다(기준 커밋에는 없는 이름이라 무시됨).
 * 가로채기(모듈을 불러오기 전에 겁니다):
 *   - globalThis.fetch → 가짜(URL 을 차례대로 적고 Open-Meteo 꼴의 결정적 합성 응답; METAR 는 빈 목록). http/https/net/tls/dns 와
 *     XMLHttpRequest·WebSocket 은 부르면 적고 실패(진짜 망은 한 번도 안 나감 — 시험이 확인).
 *   - 시계: TZ = Asia/Seoul, Date.now()·new Date() = 고정 '지금'(2026-10-15T00:30:00Z). 결과가 벽시계에 매이지 않게.
 *   - 타이머: setTimeout·setInterval·setImmediate 를 감싸 만든 수·지운 수·불린 수·끝에 남은 수를 셈. '새 타이머 수' = 만든 수 합.
 * 출력(--out, 키 정렬 JSON): {requests:[{url}], rebuilds, timers, timersDetail, d6d14Requests, realNetwork, …}. 검사 줄을 찍고
 * 모두 통과면 exit 0, 아니면 1(2 = 인자·묶기 오류).
 */
// ── 시계·시간대(무엇보다 먼저) ──
process.env.TZ = 'Asia/Seoul';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { ESBUILD, ROOT, SKY_SCENE, canonicalJson, die as die0, extractQKey, forbiddenPath, gitPorcelain, parseArgs, sha256 } from './g1-lib.mjs';

const TOOL = 'g1-live';
const die = (m, c) => die0(TOOL, m, c);
export const OPTIONS = { macroOro: 0, regime: 0 };
export const FIXTURE = {
  lat: 37.5, lon: 127.0, elevM: 50,          // SkyScene3D 기본(vLat 37.5, vLon 127.0, vElev 50)
  nowIso: '2026-10-15T00:30:00Z',            // 고정 '지금' = 날씨 받는 시각(오늘 → forecast 자료원)
  startIso: '2026-10-14T20:00:00Z', endIso: '2026-10-15T10:00:00Z', stepMin: 5,   // 05:00~19:00 KST
  az: 129, el: 35, fov: 75, altitudeM: 2, tz: 'Asia/Seoul',
};
/** D6·D14 별도 요청의 꼴(자 §3.7): 925/700/500 hPa·10 m 바람, 또는 위성 API 가 아닌 곳의 일사. */
const D6_VARS = ['wind_speed_925hPa', 'wind_direction_925hPa', 'wind_speed_700hPa', 'wind_direction_700hPa',
  'wind_speed_500hPa', 'wind_direction_500hPa', 'wind_speed_10m', 'wind_direction_10m'];
export function isD6D14(url) {
  let u; try { u = new URL(url); } catch { return false; }
  const vars = (u.searchParams.get('hourly') ?? '').split(',').filter(Boolean);
  if (vars.some(v => D6_VARS.includes(v))) return true;
  return vars.includes('shortwave_radiation') && !/^satellite-api\./.test(u.hostname);
}

// ── 합성 응답(결정적) ──
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const stdZ = p => 44330.8 * (1 - Math.pow(p / 1013.25, 0.190263));
function synthValue(v, i, h) {
  const w = 0.5 + 0.5 * Math.sin(0.08 * h + 0.53 * i + 6.283 * hash(v));   // 하루에 ≈ 2 rad — 시간마다 키가 바뀌지는 않게 완만하게
  const lvl = v.match(/_(\d+)hPa$/), p = lvl ? +lvl[1] : null;
  const r = (lo, hi, dp = 1) => Math.round((lo + (hi - lo) * w) * 10 ** dp) / 10 ** dp;
  if (v.startsWith('geopotential_height_')) return Math.round(stdZ(p) + 20 * (w - 0.5));
  if (v.startsWith('temperature_') && p) return r(15 - 6.5 * stdZ(p) / 1000 - 3, 15 - 6.5 * stdZ(p) / 1000 + 3);
  if (v.startsWith('cloud_cover')) return Math.round(100 * Math.max(0, Math.min(1, 1.4 * w - 0.2)));
  if (v.startsWith('relative_humidity')) return r(35, 95, 0);
  if (v.startsWith('wind_speed')) return r(5, 60);
  if (v.startsWith('wind_direction')) return r(0, 359, 0);
  if (v === 'temperature_2m') return r(9, 21);
  if (v === 'dew_point_2m') return r(3, 12);
  if (v === 'cape') return r(0, 400, 0);
  if (v === 'freezing_level_height') return r(3000, 4200, 0);
  if (v === 'boundary_layer_height') return r(200, 1500, 0);
  if (v === 'visibility') return r(15000, 40000, 0);
  if (v === 'direct_normal_irradiance' || v === 'shortwave_radiation') return h % 24 >= 7 && h % 24 <= 17 ? r(50, 750, 0) : 0;
  if (v === 'total_column_integrated_water_vapour') return r(10, 40);
  if (v === 'precipitation') return w > 0.85 ? r(0, 1.5) : 0;
  if (v === 'aerosol_optical_depth') return r(0.08, 0.45, 2);
  if (v === 'dust') return r(0, 15, 0);
  if (v === 'pm2_5') return r(5, 40, 0);
  if (v === 'pm10') return r(10, 60, 0);
  return r(0, 100);
}
function hoursOf(start, end) {
  const out = [];
  for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end; d = new Date(d.getTime() + 86400000))
    for (let hh = 0; hh < 24; hh++) out.push(`${d.toISOString().slice(0, 10)}T${String(hh).padStart(2, '0')}:00`);
  return out;
}
export function synthResponse(url) {
  const u = new URL(url);
  if (u.hostname === 'aviationweather.gov') return [];
  const lats = (u.searchParams.get('latitude') ?? '').split(',').filter(Boolean).map(Number);
  const lons = (u.searchParams.get('longitude') ?? '').split(',').filter(Boolean).map(Number);
  const vars = (u.searchParams.get('hourly') ?? '').split(',').filter(Boolean);
  const models = (u.searchParams.get('models') ?? '').split(',').filter(Boolean);
  const time = hoursOf(u.searchParams.get('start_date'), u.searchParams.get('end_date'));
  const one = i => {
    const hourly = { time };
    for (const v of vars) {
      if (models.length) for (const [mi, m] of models.entries()) hourly[`${v}_${m}`] = time.map((_, h) => synthValue(v, i + 7 * mi, h));
      else hourly[v] = time.map((_, h) => synthValue(v, i, h));
    }
    return { latitude: lats[i], longitude: lons[i], utc_offset_seconds: 32400, timezone: 'Asia/Seoul', hourly };
  };
  return lats.length > 1 ? lats.map((_, i) => one(i)) : one(0);
}

// ── 가로채기 ──
export function installIntercepts(nowMs) {
  const log = { requests: [], realNetwork: [], timers: { setTimeout: 0, setInterval: 0, setImmediate: 0, cleared: 0, fired: 0 } };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
  }
  globalThis.Date = FakeDate;
  const pending = new Set();
  const orig = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, setImmediate: globalThis.setImmediate,
    clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval, clearImmediate: globalThis.clearImmediate };
  for (const kind of ['setTimeout', 'setInterval', 'setImmediate']) {
    globalThis[kind] = function (fn, ...rest) {
      log.timers[kind]++;
      let handle = null;
      const wrapped = typeof fn === 'function' ? function (...a) { log.timers.fired++; if (kind !== 'setInterval') pending.delete(handle); return fn.apply(this, a); } : fn;
      handle = orig[kind].call(globalThis, wrapped, ...rest);
      pending.add(handle);
      return handle;
    };
  }
  for (const [kind, base] of [['clearTimeout', 'clearTimeout'], ['clearInterval', 'clearInterval'], ['clearImmediate', 'clearImmediate']]) {
    globalThis[kind] = function (h) { if (h != null && pending.has(h)) { pending.delete(h); log.timers.cleared++; } return orig[base].call(globalThis, h); };
  }
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input && input.url);
    log.requests.push({ url });
    if (init && init.signal && init.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    const body = synthResponse(url);
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) };
  };
  const refuse = name => function () { log.realNetwork.push(name); throw new Error(`g1-live: real network refused (${name})`); };
  for (const [mod, names, tag] of [[http, ['request', 'get'], 'http'], [https, ['request', 'get'], 'https'], [net, ['connect', 'createConnection'], 'net'],
    [tls, ['connect'], 'tls'], [dns, ['lookup', 'resolve'], 'dns']]) for (const n of names) mod[n] = refuse(`${tag}.${n}`);
  globalThis.XMLHttpRequest = function () { log.realNetwork.push('XMLHttpRequest'); throw new Error('g1-live: XMLHttpRequest refused'); };
  globalThis.WebSocket = function () { log.realNetwork.push('WebSocket'); throw new Error('g1-live: WebSocket refused'); };
  const restore = () => { for (const h of pending) { orig.clearTimeout(h); orig.clearInterval(h); } globalThis.Date = RealDate; };
  return { log, pending, restore };
}

function buildBundle() {
  const dir = path.join(ROOT, '.harness', 'oro', 'g1', 'live');
  fs.mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, 'entry.ts');
  const abs = p => path.join(ROOT, p).split(path.sep).join('/');
  fs.writeFileSync(entry, [
    `export { fetchDayWeatherRing, fetchWeatherCanary, getInterpolatedWeather } from '${abs('src/utils/weather')}';`,
    `export { fetchNearestMetar } from '${abs('src/utils/metar')}';`,
    `export { buildLiveScene } from '${abs('src/components/VolumetricProbe/liveScene')}';`,
    `export { volSceneKey } from '${abs('src/components/VolumetricProbe/sceneKey')}';`, ''].join('\n'));
  const out = path.join(dir, 'live.cjs');
  const r = cp.spawnSync('npx', ['--yes', `esbuild@${ESBUILD}`, path.relative(ROOT, entry), '--bundle', '--format=cjs', '--platform=node',
    '--define:__DEV__=false', `--outfile=${path.relative(ROOT, out)}`, '--log-level=warning'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) die('esbuild failed', 2);
  const code = fs.readFileSync(out);
  return { file: out, sha256: sha256(code) };
}

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

export async function runPath(L, qKeyOf) {
  const F = FIXTURE, t0 = new Date(Date.parse(F.nowIso));
  const ctl = new AbortController();
  // 1. SkyScreen: 카나리아 + 고리(같이)
  const [canary, path_] = await Promise.all([
    L.fetchWeatherCanary(F.lat, F.lon, t0, ctl.signal).catch(() => null),
    L.fetchDayWeatherRing(F.lat, F.lon, t0, false, ctl.signal),
  ]);
  // 2. SkyScene3D: METAR 첫 받기
  const metar = await L.fetchNearestMetar(F.lat, F.lon, ctl.signal).catch(() => null);
  await flush();
  // 3. 볼륨 장면 고리
  const settings = Object.fromEntries(Object.entries(OPTIONS).map(([k, v]) => ['volumetric' + k[0].toUpperCase() + k.slice(1), v]));
  let lastQ = null, lastKey = null, rebuilds = 0, frames = 0, layersSig = [];
  const keyFieldChanges = {};   // volSceneKey 의 '|' 칸 번호 → 그 칸이 바뀐 재구성 수(진단)
  for (let ms = Date.parse(F.startIso); ms <= Date.parse(F.endIso); ms += F.stepMin * 60000) {
    frames++;
    const date = new Date(ms);
    const weather = L.getInterpolatedWeather(path_, date);
    const q = qKeyOf(settings);
    if (q !== lastQ) { lastQ = q; lastKey = null; }   // SkyScene3D: qKey 가 바뀌면 volKeyRef = ''
    const wLen = weather.length;
    const key = L.volSceneKey({
      sceneMs: ms, lat: F.lat, lon: F.lon, elevM: F.elevM,
      metarId: metar ? `${metar.icao}@${metar.timeMs}` : '', metarTimeMs: metar?.timeMs ?? null,
      obs: weather[0] ?? null, sample: weather[Math.min(4, Math.max(0, wLen - 1))],
    });
    if (key !== lastKey) {
      if (lastKey !== null) {
        const a = lastKey.split('|'), b = key.split('|');
        for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) keyFieldChanges[i] = (keyFieldChanges[i] ?? 0) + 1;
      }
      const built = L.buildLiveScene({
        lat: F.lat, lon: F.lon, heightM: F.elevM, date, pathData: path_, obs: weather[0] ?? null, interpolatedWeather: weather,
        az: F.az, el: F.el, fov: F.fov, altitudeM: F.altitudeM, metar, ...OPTIONS,
      });
      rebuilds++; lastKey = key;
      layersSig.push(built.input.layers.length + (built.input.macro ? 'm' : '-'));
    }
  }
  await flush();
  return { canaryOk: Array.isArray(canary), ringPoints: path_.length, metar: metar ? 'obs' : null, frames, rebuilds, layersSig, keyFieldChanges };
}

async function main() {
  const o = parseArgs(TOOL, process.argv.slice(2), { '--out': true });
  if (!o['--out']) die('--out is required');
  if (forbiddenPath(o['--out'])) die('--out: path refused');
  const dirty = gitPorcelain(['src']);
  const bundle = buildBundle();
  const skySrc = fs.readFileSync(path.join(ROOT, SKY_SCENE), 'utf8');
  const { fn: qKeyOf } = extractQKey(skySrc);
  const nowMs = Date.parse(FIXTURE.nowIso);
  const { log, pending, restore } = installIntercepts(nowMs);
  const L = createRequire(import.meta.url)(bundle.file);
  let info, err = null;
  try { info = await runPath(L, qKeyOf); } catch (e) { err = String((e && e.message) || e); }
  const pendingAtEnd = pending.size;
  restore();
  const t = log.timers;
  const out = {
    schema: 'g1-live/1', path: 'SkyScreen fetchWeatherCanary+fetchDayWeatherRing → SkyScene3D fetchNearestMetar → qKey/volSceneKey-driven buildLiveScene loop',
    options: OPTIONS, fixture: FIXTURE, bundle: { sha256: bundle.sha256, esbuild: ESBUILD, define: '__DEV__=false' }, srcClean: dirty.length === 0,
    requests: log.requests, rebuilds: info ? info.rebuilds : null, timers: t.setTimeout + t.setInterval + t.setImmediate,
    timersDetail: { ...t, pendingAtEnd }, d6d14Requests: log.requests.filter(r => isD6D14(r.url)).length, realNetwork: log.realNetwork,
    run: info ?? null, error: err,
  };
  fs.mkdirSync(path.dirname(path.resolve(o['--out'])), { recursive: true });
  fs.writeFileSync(path.resolve(o['--out']), canonicalJson(out));
  const checks = [
    ['ran without error', err === null, err ?? ''],
    ['src working tree clean', dirty.length === 0, `${dirty.length} dirty`],
    ['requests intercepted', log.requests.length > 0, `${log.requests.length} requests`],
    ['no real network', log.realNetwork.length === 0, `${log.realNetwork.length}`],
    ['no D6/D14 separate request', out.d6d14Requests === 0, `${out.d6d14Requests}`],
    ['scene rebuilt at least once', (info?.rebuilds ?? 0) >= 1, `${info?.rebuilds ?? '-'} rebuilds over ${info?.frames ?? '-'} frames`],
    ['every rebuilt scene carries the macro ring', !!info && info.layersSig.every(s => s.endsWith('m')), info ? info.layersSig.join(',') : ''],
    ['no timer left pending', pendingAtEnd === 0, `${pendingAtEnd} pending, ${out.timers} created`],
  ];
  let fail = 0;
  for (const [name, ok, detail] of checks) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); }
  console.log(`requests ${log.requests.length} rebuilds ${out.rebuilds} timers ${out.timers} out-sha256 ${sha256(Buffer.from(canonicalJson(out)))}`);
  process.exit(fail ? 1 : 0);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(new URL(import.meta.url).pathname)) main();
