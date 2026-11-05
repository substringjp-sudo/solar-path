#!/usr/bin/env node
/**
 * g1-jobs.mjs — G1(b) 하네스 잡 파일(자 L748, S3-design.md §8 (b)). volsky run.js 가 그대로 읽는 꼴입니다.
 *
 *   node tools/genus-ruler/oro/g1/g1-jobs.mjs --inputs <oro-inputs.json> --out <jobs.json> [--control <jobs.json>]
 *
 * 잡 넷(이 순서):
 *   B0_app    tools/genus-ruler/shape/jobs-overcast.json 의 B0_app 그대로 + 고리 입력 + G1 옵션
 *   P0_seoul  tools/genus-ruler/flow/jobs-phys-guards.json 의 P0_seoul 그대로 + 고리 입력 + G1 옵션
 *   M_<scene> 산악 장면 둘: oro-inputs 의 kanazawa 장면을 날짜순으로 정렬한 처음 둘(dev, A1 ✓ — §8 (b))
 * G1 옵션(잡마다, 자 L748 "options 에 macro: 1, macroN: 128 과 고리 입력"): {macro: 1, macroN: 128, macroOro: 0, regime: 0}
 *   을 원래 잡의 options 위에 덮습니다. macroOro·regime 은 기준 커밋에 없는 옵션이라 setOptions 가 담아 두기만 하고 아무것도 바꾸지 않으며,
 *   바꾼 뒤(G1 비교)에도 같은 잡 파일로 '두 옵션 0' 을 명시합니다(§8 Inputs).
 * 고리 입력(input.macro.{low,mid,high}) = oro-inputs 의 times.closest 고리(허용 목록: ringGeom·closest.ring·utc·site·lat·lon·date),
 *   점 = {distance: dist[i], azimuthOffset: az[i], cover: 분수 0~1(앱 MacroRingPoint, applyScene 이 ×100)}, 유한한 점만.
 *   - B0_app·P0_seoul: 서울 장면 가운데 closest 시각이 잡 시각과 가장 가까운 장면(같으면 이른 것). 잡의 그 밖의 입력은 그대로.
 *   - 산악 잡: 입력 = 장면 자리(lat·lon), 시각 = closest 시각, heightM 40, 시선·층 틀은 P0_seoul 의 것(az 129·el 35·fov 75,
 *     sc/ac/ci 층과 그 손잡이), 층 운량 = 그 밴드 고리 관측점(점 0) 값 — liveScene 처럼 관측점 운량이 층 운량이고 0 이면 종류 없는 층.
 *     thermo 없음(물리 꺼짐). frames·quality·res·out 은 P0_seoul 과 같음.
 * --control: 비교용 원래 잡(B0_app·P0_seoul, 손대지 않음)을 따로 씁니다(oro/merge-aa.json 의 md5 와 견줄 환경 확인용, G1 잡 아님).
 * 표준 출력: 잡 이름과 고리 장면만.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BANDS3, ROOT, canonicalJson, die as die0, forbiddenPath, parseArgs, pickRingInputs, ringPoints } from './g1-lib.mjs';

const TOOL = 'g1-jobs';
const die = (m, c) => die0(TOOL, m, c);
export const G1_OPTIONS = { macro: 1, macroN: 128, macroOro: 0, regime: 0 };
const SRC = {
  B0_app: 'tools/genus-ruler/shape/jobs-overcast.json',
  P0_seoul: 'tools/genus-ruler/flow/jobs-phys-guards.json',
};
const MOUNTAIN_SITE = 'kanazawa', N_MOUNTAIN = 2, MOUNTAIN_HEIGHT_M = 40, RING_SITE = 'seoul';

function loadJob(name) {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, SRC[name]), 'utf8'));
  const hit = list.filter(j => j && j.name === name);
  if (hit.length !== 1) die(`${SRC[name]}: expected exactly one job ${name}`);
  return hit[0];
}
const macroInput = s => Object.fromEntries(BANDS3.map(b => {
  const pts = ringPoints(s, b);
  if (!pts) die('ring band with < 12 finite points cannot carry a G1 ring input');
  return [b, pts];
}));

export function makeJobs(scenes) {
  const seoul = Object.keys(scenes).filter(k => scenes[k].site === RING_SITE).sort();
  if (!seoul.length) die(`no ${RING_SITE} scene in inputs`);
  const nearest = iso => {
    const t = Date.parse(iso);
    let best = null, bd = Infinity;
    for (const k of seoul) { const d = Math.abs(Date.parse(scenes[k].utc) - t); if (d < bd) { bd = d; best = k; } }   // 정렬 순서라 같으면 이른 장면
    return best;
  };
  const jobs = [], meta = {};
  for (const name of ['B0_app', 'P0_seoul']) {
    const j = JSON.parse(JSON.stringify(loadJob(name)));
    const rs = nearest(j.input.date);
    j.input.macro = macroInput(scenes[rs]);
    j.options = { ...(j.options ?? {}), ...G1_OPTIONS };
    jobs.push(j); meta[name] = { ringScene: rs, ringTime: 'closest' };
  }
  const tpl = loadJob('P0_seoul');
  const mount = Object.keys(scenes).filter(k => scenes[k].site === MOUNTAIN_SITE).sort().slice(0, N_MOUNTAIN);
  if (mount.length !== N_MOUNTAIN) die(`need ${N_MOUNTAIN} ${MOUNTAIN_SITE} scenes`);
  for (const k of mount) {
    const s = scenes[k];
    const layers = tpl.input.layers.map(L => {
      const i = BANDS3.indexOf(L.band);
      if (i < 0) die('template layer without band');
      const c0 = s.ring[L.band][0];
      const cover = Number.isFinite(c0) ? Math.min(1, Math.max(0, c0)) : 0;
      return cover > 0 ? { ...JSON.parse(JSON.stringify(L)), cover } : { genus: null, cover: 0, baseKm: L.baseKm, band: L.band };
    });
    jobs.push({
      name: `M_${k}`, frames: tpl.frames, quality: tpl.quality, res: tpl.res, out: tpl.out,
      options: { ...G1_OPTIONS },
      input: {
        lat: s.lat, lon: s.lon, heightM: MOUNTAIN_HEIGHT_M, date: new Date(Date.parse(s.utc)).toISOString(),
        az: tpl.input.az, el: tpl.input.el, fov: tpl.input.fov, layers, macro: macroInput(s),
      },
    });
    meta[`M_${k}`] = { ringScene: k, ringTime: 'closest' };
  }
  return { jobs, meta };
}

export function controlJobs() { return ['B0_app', 'P0_seoul'].map(loadJob); }

function main() {
  const o = parseArgs(TOOL, process.argv.slice(2), { '--inputs': true, '--out': true, '--control': true });
  if (!o['--inputs'] || !o['--out']) die('--inputs and --out are required');
  for (const k of ['--inputs', '--out', '--control']) if (o[k] && forbiddenPath(o[k])) die(`${k}: path refused (§0.1 forbidden pattern)`);
  const scenes = pickRingInputs(TOOL, JSON.parse(fs.readFileSync(path.resolve(o['--inputs']), 'utf8')), true);
  const { jobs, meta } = makeJobs(scenes);
  fs.mkdirSync(path.dirname(path.resolve(o['--out'])), { recursive: true });
  fs.writeFileSync(path.resolve(o['--out']), canonicalJson(jobs));
  if (o['--control']) { fs.mkdirSync(path.dirname(path.resolve(o['--control'])), { recursive: true }); fs.writeFileSync(path.resolve(o['--control']), canonicalJson(controlJobs())); }
  for (const j of jobs) console.log(`JOB ${j.name} ring ${meta[j.name].ringScene} ${meta[j.name].ringTime}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(new URL(import.meta.url).pathname)) main();
