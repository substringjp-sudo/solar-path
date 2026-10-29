/**
 * §180 GPU 창 잡 점검(node, 브라우저 없음) — gpu-window.sh prep·dry 가 esbuild 로 묶어 돌립니다(<GW_ROOT>/check/gpuwin-check.cjs).
 * 렌더하는 묶음과 **같은 함수**로 잡을 미리 봅니다: entry-tsun 의 checkTsunJob(잡 필드·손잡이 9 개 명시·팔 불변식·진단 이름) ·
 * cloudTsun validateTsunOptions(setOptions 가 부르는 점검 — 진단 2~7 은 'not implemented' throw 가 기대값) · 모르는 옵션 키(grain checkGrainOptions 와 같은 규칙) ·
 * run-tsun-lib 의 품질 섞기·같은 이름·감시 시간(새 덩어리 첫 잡으로도 시작할 수 있는지 — 아니면 덩어리가 진전 없이 되풀이됨).
 *
 *   node gpuwin-check.cjs --jobs DIR [--chunk-min 55] [--watchdog-scale 1]   → 종료 0 / 1(문제) · 파일마다 한 줄 + 끝에 JSON 요약
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkTsunJob } from './tsun-harness';
import { validateTsunOptions, TSUN_OPTIONS_OFF } from '../../../src/components/VolumetricProbe/cloudTsun';
import { DEFAULT_VOLUMETRIC_OPTIONS } from '../../../src/components/VolumetricProbe/volumetricScene';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const L = require('./run-tsun-lib') as {
  mixedQualities: (j: unknown[]) => string[]; duplicateNames: (j: unknown[]) => string[];
  watchdogMs: (job: unknown, scale: number, o: { W: number; H: number; first: boolean }) => number; startsWithinChunk: (e: number, wd: number, m: number) => boolean;
};

type AnyRec = Record<string, unknown>;
const argv = process.argv.slice(2);
const get = (k: string, d: string | null = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const dir = get('--jobs');
if (!dir) { console.error('usage: gpuwin-check.cjs --jobs DIR [--chunk-min 55] [--watchdog-scale 1]'); process.exit(2); }
const chunkMin = Number(get('--chunk-min', '55')), scale = Number(get('--watchdog-scale', '1'));
/** entry-tsun JOB_BASE_OPTIONS 중 점검에 닿는 값(genus·diffuse) — 렌더 때와 같은 합침 순서: 앱 기본 → 하네스 기본 → 잡. */
const BASE = { genus: true, diffuse: 0 };
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { files: Record<string, { n: number; W?: number; H?: number }>; debugRefused: number[] };
const problems: string[] = [];
const summary: AnyRec = {};
for (const [fn, info] of Object.entries(man.files)) {
  if (!info.n) continue;
  const jobs = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')) as AnyRec[];
  const expectRefuse = fn === 'b1-refuse.json';
  const mixed = L.mixedQualities(jobs), dups = L.duplicateNames(jobs);
  if (mixed.length) problems.push(`${fn}: mixed qualities ${mixed.join('/')}`);
  if (dups.length) problems.push(`${fn}: duplicate names ${dups.slice(0, 5).join(', ')}`);
  let kinds: Record<string, number> = {}, refused = 0, maxWdMin = 0;
  for (const j of jobs) {
    const name = String(j.name);
    let kind: string;
    try { kind = checkTsunJob(j); } catch (e) { problems.push(`${fn}: ${name}: checkTsunJob — ${(e as Error).message}`); continue; }
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    const o = (j.options ?? {}) as AnyRec;
    const unknown = Object.keys(o).filter(k => !(k in DEFAULT_VOLUMETRIC_OPTIONS));
    if (unknown.length) problems.push(`${fn}: ${name}: unknown option(s) ${unknown.join(', ')}`);
    const knobs = Object.keys(TSUN_OPTIONS_OFF).filter(k => !(k in o));
    if (knobs.length) problems.push(`${fn}: ${name}: knob(s) not explicit ${knobs.join(', ')}`);
    let threw: string | null = null;
    try { validateTsunOptions({ ...DEFAULT_VOLUMETRIC_OPTIONS, ...BASE, ...o } as never); } catch (e) { threw = (e as Error).message; }
    if (expectRefuse) {
      if (!threw || !/not implemented/.test(threw)) problems.push(`${fn}: ${name}: expected a 'not implemented' refusal, got ${threw ?? 'no throw'}`);
      else refused++;
    } else if (threw) problems.push(`${fn}: ${name}: validateTsunOptions — ${threw}`);
    const W = Number((j.canvas as number[] | undefined)?.[0] ?? j.W ?? info.W), H = Number((j.canvas as number[] | undefined)?.[1] ?? j.H ?? info.H);
    const wd = L.watchdogMs(j, scale, { W, H, first: true });
    maxWdMin = Math.max(maxWdMin, wd / 60000);
    if (!L.startsWithinChunk(0, wd, chunkMin)) problems.push(`${fn}: ${name}: watchdog ${(wd / 60000).toFixed(1)} min (first job) does not fit a ${chunkMin}-min chunk — the step would stall`);
  }
  summary[fn] = { n: jobs.length, kinds, refused, maxWatchdogMin: +maxWdMin.toFixed(2) };
  console.log(`${fn.padEnd(20)} n ${String(jobs.length).padStart(4)}  ${JSON.stringify(kinds)}${expectRefuse ? `  refused ${refused}/${jobs.length}` : ''}  max watchdog ${maxWdMin.toFixed(1)} min`);
}
console.log(JSON.stringify({ ok: problems.length === 0, problems: problems.slice(0, 50), nProblems: problems.length, chunkMin, watchdogScale: scale, summary }));
process.exit(problems.length ? 1 : 0);
