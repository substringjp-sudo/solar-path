#!/usr/bin/env node
/**
 * 하네스 스크립트의 **문법**만 빠르게 훑습니다.
 *
 * 왜 필요한가: 빌더들은 `.js` 라 `tsc --noEmit` 이 안 봅니다. 그런데 이 파일들은
 * GLSL을 백틱 템플릿에 담고 있고, 그 안 주석에 백틱을 하나 쓰면 문자열이
 * 거기서 끊겨 `SyntaxError: Unexpected identifier` 가 납니다. 오류 메시지가
 * 원인과 멀어서 매번 한참 헤맵니다 — 이 세션에서만 세 번 겪었습니다.
 *
 * `node --check` 는 그걸 정확히, 오탐 없이 잡습니다.
 * (TS 파일은 `tsc --noEmit` 이 같은 오류를 TS1005로 잡아 줍니다.)
 *
 * 사용: node tools/shader-preview/check-syntax.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname);
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
const bad = [];

for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(DIR, f)], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stderr?.toString() || e.message).split('\n').slice(0, 4).join('\n');
    bad.push(`${f}\n${msg}`);
  }
}

if (bad.length) {
  console.log(`문법 오류 ${bad.length}건:\n`);
  for (const b of bad) console.log(b + '\n');
  process.exit(1);
}
console.log(`OK — 하네스 ${files.length}개 문법 이상 없음`);
