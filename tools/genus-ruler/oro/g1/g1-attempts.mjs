/**
 * g1-attempts.mjs — g1-render 호출(invocation) 기록(S3-design.md G1 build note 19, fix G1-REC).
 *
 * 호출 id: `<pid>-<시작 ISO 시각>-<무작위 16 진 8 자>` — g1-render 프로세스 하나에 하나. b.json 의 invocation.id 와
 *   stepRuns[step].invocation 에 적힘.
 * 기록 파일: .harness/oro/g1/render-attempts.jsonl(덧붙이기만; 고치거나 지우지 않음). g1-render 는 호출마다 두 줄을 씀:
 *   {event: 'start', invocation, pid, startedAt, commit, argv, steps, out, work, swiftshaderThreads, waitIdle}   — 인자를 풀기 전에
 *   {event: 'end', invocation, endedAt, exitCode, signal, error, commit, commitAtEnd, completed: [{step, start, end}],
 *    md5: {step: {job: {rgb, alpha}}}, bundle, load: {step: …}, flags: {aa, keysMatchRun1, controlMatchesMergeAA}, mismatches: [...]}
 *   — 끝날 때(정상·die·잡히지 않은 예외·SIGINT/SIGTERM/SIGHUP). SIGKILL 이면 start 만 남음(끝 없음 = 끊긴 시도).
 * attemptsAtCommit: g1-baseline 의 status.renderAttempts — 그 커밋들에서 시작한 호출 전부(어떤 --out 이든), b.json 을 만든 호출의
 *   마지막 줄까지만(그 뒤에 덧붙은 시도는 그 기준과 무관하므로 빼서, 같은 조각에서 다시 모으면 바이트 같음).
 *   커밋들 = 잰 커밋 + 조각들·조립의 커밋 + b.json 을 만든 호출이 시작한 커밋(g1-baseline 이 모음; 모두 앱·하네스가 바이트 같은
 *   커밋). 도는 사이 스냅샷 커밋이 끼어 a 와 b 의 커밋이 달라져도 b 를 만든 호출과 그 커밋의 다른 시도가 빠지지 않게.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './g1-lib.mjs';
import { mismatchSummary } from './g1-png.mjs';

export const ATTEMPTS_REL = '.harness/oro/g1/render-attempts.jsonl';
export const ATTEMPTS_FILE = path.join(ROOT, ATTEMPTS_REL);
export const INVOCATION_RE = /^(\d+)-(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)-([0-9a-f]{8})$/;

export function newInvocationId(pid = process.pid, at = new Date()) {
  return `${pid}-${at.toISOString()}-${crypto.randomBytes(4).toString('hex')}`;
}
/** 한 줄 덧붙이기(O_APPEND; 줄 하나는 한 write). */
export function appendAttempt(rec, file = ATTEMPTS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, JSON.stringify(rec) + '\n'); } finally { fs.closeSync(fd); }
}
/** 기록 읽기: 줄마다 JSON(깨진 줄은 bad 로 셈만). */
export function readAttempts(file = ATTEMPTS_FILE) {
  if (!fs.existsSync(file)) return { recs: [], bad: 0 };
  const recs = []; let bad = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && typeof r.invocation === 'string' && (r.event === 'start' || r.event === 'end')) recs.push(r); else bad++; } catch { bad++; }
  }
  return { recs, bad };
}
/** id → {start, end, last}(last = 그 호출의 마지막 줄 번호). */
export function invocations(recs) {
  const m = new Map();
  recs.forEach((r, i) => {
    if (!m.has(r.invocation)) m.set(r.invocation, { start: null, end: null, first: i, last: i });
    const x = m.get(r.invocation);
    x[r.event] = r; x.last = i;
  });
  return m;
}
const md5Only = o => Object.fromEntries(Object.keys(o ?? {}).sort().map(n => [n, { rgb: o[n]?.rgb ?? null, alpha: o[n]?.alpha ?? null }]));
export const stepMd5 = md5Only;

/** b.json 의 호출이 기록에 정상 끝(exit 0)으로 있고, 그 끝 줄의 md5 가 b.json 의 그 단계 md5 와 같은지. */
export function invocationLogged(B, recs, steps) {
  const id = B?.invocation?.id;
  if (typeof id !== 'string') return false;
  const x = invocations(recs).get(id);
  if (!x || !x.start || !x.end || x.end.exitCode !== 0) return false;
  return steps.every(s => B[s] && x.end.md5 && x.end.md5[s] && JSON.stringify(md5Only(x.end.md5[s])) === JSON.stringify(md5Only(B[s])));
}

const safeSummary = m => { try { return mismatchSummary(m); } catch { return 'malformed mismatch record'; } };
/** b.json 을 만든 호출(bIds)이 기록에서 시작한 커밋들(start 줄의 commit; 없으면 뺌). */
export function invocationCommits(recs, bIds) {
  const inv = invocations(recs);
  return [...new Set(bIds.map(id => inv.get(id)?.start?.commit).filter(c => typeof c === 'string'))].sort();
}
/** status.renderAttempts: commits(문자열 하나 또는 배열)에서 시작한 호출들(기록 차례), b.json 을 만든 호출(들)의 마지막 줄까지. */
export function attemptsAtCommit(recs, commits, bIds, bOut) {
  const at = new Set([commits].flat().filter(c => typeof c === 'string'));
  const inv = invocations(recs);
  const known = bIds.filter(id => inv.has(id));
  const cutoff = known.length ? Math.max(...known.map(id => inv.get(id).last)) : recs.length - 1;
  const rows = [];
  for (const [id, x] of inv) {
    if (!x.start || x.first > cutoff || !at.has(x.start.commit)) continue;
    const end = x.end && x.last <= cutoff ? x.end : null;
    rows.push({
      id, commit: x.start.commit, startedAt: x.start.startedAt, out: x.start.out ?? null, steps: (x.start.steps ?? []).join(','),
      completed: end ? (end.completed ?? []).map(c => c.step).join(',') : '',
      exit: end ? end.exitCode : null, signal: end ? end.signal ?? null : null,
      mismatches: end ? (Array.isArray(end.mismatches) ? end.mismatches : []).map(safeSummary).sort() : [],
      usedForThisBaseline: bIds.includes(id),
    });
  }
  return {
    log: ATTEMPTS_REL, commits: [...at].sort(), upToInvocationLogged: known.length === bIds.length && bIds.length > 0,
    n: rows.length, samePart: rows.filter(r => r.out === bOut).length,
    rendered: rows.filter(r => r.completed.split(',').some(s => ['run1', 'run2', 'control', 'keys'].includes(s))).length,
    withMismatch: rows.filter(r => r.mismatches.length).length,
    attempts: rows,
  };
}
