#!/usr/bin/env node
/**
 * run-all.js
 *
 * 하네스 전체를 한 번에: 준비 → 미리보기 생성 → 서버 → 판정 → 요약.
 *
 * ## 왜 필요한가
 *
 * 이 순서는 지금까지 README의 여러 곳에 흩어져 있었고, 매번 손으로
 * 이어 붙여야 했습니다. 그러면 두 가지가 반복됩니다:
 *
 *  - **준비를 빠뜨림.** `/tmp` 산출물이나 ESM 스테이징이 없으면 판정
 *    11종이 `Cannot find module`로 죽는데, 그 메시지로는 무엇을 다시
 *    돌려야 하는지 알 수 없습니다.
 *  - **셰이더를 고치고 스테이징을 안 함.** `stage-esm.js`를 다시 안 돌리면
 *    미리보기는 **옛 셰이더**를 그립니다. 그래 놓고 "고쳤는데 화면이 그대로"를
 *    한참 들여다보게 됩니다 — 실제로 한 사이클을 그렇게 날렸습니다.
 *
 * 그리고 판정 출력은 전부 합치면 수백 줄인데, 정작 알고 싶은 것은
 * **어느 것이 몇 개 통과했는가** 한 줄씩입니다. 실패한 것만 자세히 펼칩니다.
 *
 * ## 사용
 *
 *   node tools/shader-preview/run-all.js            전체
 *   node tools/shader-preview/run-all.js genus rain 이름에 이 문자열이 든 판정만
 *   node tools/shader-preview/run-all.js --no-build 미리보기 재생성 없이 판정만
 *
 * 종료 코드는 실패한 판정 수(없으면 0)라 CI·훅에 그대로 물릴 수 있습니다.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { PREVIEW, PORT, ORIGIN } = require('./paths');

const HERE = __dirname;
const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const filters = args.filter(a => !a.startsWith('--'));

const listScripts = (prefix) =>
  fs
    .readdirSync(HERE)
    .filter(f => f.startsWith(prefix) && f.endsWith('.js'))
    .sort();

const matchesFilter = (name) =>
  filters.length === 0 || filters.some(f => name.includes(f));

function runNode(script, { quiet = true } = {}) {
  return execFileSync(process.execPath, [path.join(HERE, script)], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** 서버가 실제로 응답할 때까지 기다립니다. 고정 sleep은 느리거나 모자랍니다. */
function waitForServer(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${ORIGIN}/`, res => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('정적 서버가 뜨지 않았습니다'));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

(async () => {
  const t0 = Date.now();

  // ── 1) 준비 ──────────────────────────────────────────────────────────
  // 셰이더를 고쳤는데 스테이징을 안 하면 미리보기가 옛 코드를 그립니다.
  // 그래서 --no-build 여도 스테이징은 **항상** 돕니다.
  process.stdout.write('준비: CommonJS 산출물… ');
  runNode('stage-node.js');
  process.stdout.write('ESM 모듈… ');
  runNode('stage-esm.js');
  console.log('완료');

  // ── 2) 미리보기 생성 ─────────────────────────────────────────────────
  if (!noBuild) {
    const builders = listScripts('build-');
    let failed = 0;
    for (const b of builders) {
      try {
        runNode(b);
      } catch (err) {
        failed++;
        console.log(`  ✗ ${b}\n${String(err.stderr || err.message).trim().split('\n').slice(0, 4).map(l => '      ' + l).join('\n')}`);
      }
    }
    console.log(`미리보기 ${builders.length - failed}/${builders.length} 생성${failed ? ` (실패 ${failed})` : ''}`);
  }

  // ── 3) 정적 서버 ─────────────────────────────────────────────────────
  // file:// 로는 ES 모듈이 CORS에 막힙니다.
  fs.mkdirSync(PREVIEW, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: PREVIEW,
    stdio: 'ignore',
    detached: false,
  });
  const stopServer = () => { try { server.kill('SIGTERM'); } catch { /* 이미 죽음 */ } };
  process.on('exit', stopServer);
  process.on('SIGINT', () => { stopServer(); process.exit(130); });

  try {
    await waitForServer();
  } catch (err) {
    stopServer();
    console.error(err.message);
    process.exit(1);
  }
  console.log(`서버 ${ORIGIN}  (${PREVIEW})\n`);

  // ── 4) 판정 ──────────────────────────────────────────────────────────
  const verifiers = listScripts('verify-').filter(matchesFilter);
  const failures = [];
  let totalAssertions = 0;

  for (const v of verifiers) {
    let out = '';
    let ok = true;
    try {
      out = runNode(v);
    } catch (err) {
      ok = false;
      out = String(err.stdout || '') + String(err.stderr || '');
    }
    // 판정마다 요약 문구가 조금씩 다릅니다 ("pass N / fail 0" 또는
    // "총 N개 중 통과 N, 실패 0"). 둘 다에서 통과 수를 뽑습니다.
    const m = out.match(/pass (\d+) \/ fail (\d+)/) || out.match(/통과 (\d+), 실패 (\d+)/);
    const passed = m ? Number(m[1]) : 0;
    totalAssertions += passed;
    console.log(`${ok ? '✅' : '❌'} ${v.padEnd(30)} ${m ? `${passed}개 통과` : '요약 없음'}`);
    if (!ok) failures.push({ v, out });
  }

  stopServer();

  // ── 5) 요약 — 실패한 것만 펼칩니다 ────────────────────────────────────
  console.log(
    `\n판정 ${verifiers.length - failures.length}/${verifiers.length}` +
      `  단언 ${totalAssertions}개 통과  (${((Date.now() - t0) / 1000).toFixed(0)}초)`
  );

  for (const { v, out } of failures) {
    console.log(`\n──── ${v} ────`);
    const lines = out.split('\n').filter(l => /FAIL|Error|실패|❌/.test(l));
    console.log((lines.length ? lines : out.split('\n').slice(-25)).join('\n'));
  }

  process.exit(failures.length);
})();
