#!/usr/bin/env node
/**
 * 하네스가 쓰는 /tmp 산출물을 **전부 한 번에** 만듭니다.
 *
 * ## 왜 필요한가
 *
 * 검사 스크립트들은 `/tmp/atmbuild`, `/tmp/cellbuild`, `/tmp/skybuild`,
 * `/tmp/tlbuild`에 있는 CommonJS 산출물을 `require`합니다. 그 산출물을
 * 만드는 명령은 README에만 적혀 있고 **어떤 스크립트도 실행하지 않았습니다.**
 *
 * /tmp가 비워지면(컨테이너 재시작, 디스크 정리, node_modules 재설치) 하네스
 * 11종이 전부 `Cannot find module '/tmp/…'`로 죽는데, 그 메시지만 봐서는
 * 무엇을 다시 돌려야 하는지 알 수 없습니다 — README의 세 군데에 흩어져
 * 있으니까요. 실제로 한 번 그렇게 죽어서 한 사이클을 통째로 날렸습니다.
 *
 * `stage-esm.js`(브라우저용 ESM)와 짝이 되는 CommonJS 쪽 준비입니다.
 * 둘 다 돌리면 하네스 전체가 실행 가능한 상태가 됩니다:
 *
 *   node tools/shader-preview/stage-node.js
 *   node tools/shader-preview/stage-esm.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const SRC = '/home/user/solar-path';

// tsc 공통 플래그. 개별 작업이 필요한 것만 덧붙입니다.
const BASE = ['--module', 'commonjs', '--target', 'es2020',
  '--moduleResolution', 'node', '--skipLibCheck', '--resolveJsonModule'];
const INTEROP = ['--esModuleInterop', '--allowSyntheticDefaultImports'];

const JOBS = [
  { out: '/tmp/atmbuild', extra: INTEROP,
    // GLSL 문자열을 Node에서 읽기 위해. build-preview / build-twilight 등이 씁니다.
    // starCatalog는 verify-celestial.js가 같은 디렉터리에서 require합니다.
    files: ['src/utils/atmosphere.ts', 'src/utils/starCatalog.ts',
            'src/utils/celestialCoords.ts'],
    check: 'atmosphere.js' },
  { out: '/tmp/cellbuild', extra: [],
    files: ['src/utils/cloudCellField.ts'],
    check: 'cloudCellField.js' },
  { out: '/tmp/skybuild', extra: [],
    files: ['src/utils/skyColumn.ts', 'src/utils/atmosphere.ts',
            'src/utils/cloudGrid.ts', 'src/utils/cloudGridAdapter.ts'],
    check: 'skyColumn.js' },
  { out: '/tmp/tlbuild', extra: INTEROP,
    files: ['src/utils/skyTimeline.ts'],
    check: 'skyTimeline.js' },
];

for (const job of JOBS) {
  fs.rmSync(job.out, { recursive: true, force: true });
  // tsc는 타입 오류가 있어도 emit합니다. 리포에는 이 작업과 무관한 기존
  // 오류가 있으므로 종료 코드가 아니라 **산출물 존재**로 판단합니다
  // (stage-esm.js와 같은 방침).
  try {
    execFileSync('npx', ['tsc', ...BASE, ...job.extra, '--outDir', job.out, ...job.files],
      { cwd: SRC, stdio: 'pipe' });
  } catch (e) {
    // 아래에서 검증합니다.
  }
  if (!fs.existsSync(`${job.out}/utils/${job.check}`) &&
      !fs.existsSync(`${job.out}/${job.check}`)) {
    throw new Error(`${job.out} 에 ${job.check} 가 생기지 않았습니다`);
  }
  console.log(`${job.out}  ← ${job.files.length}개`);
}

// verify-timeline.js가 suncalc를 /tmp 기준으로 해석합니다.
try {
  fs.rmSync('/tmp/node_modules', { force: true });
  fs.symlinkSync(`${SRC}/node_modules`, '/tmp/node_modules', 'dir');
} catch (e) {
  if (e.code !== 'EEXIST') throw e;
}
console.log('/tmp/node_modules  ← 심볼릭 링크 (suncalc 해결용)');
console.log('\n준비 완료. 이어서: node tools/shader-preview/stage-esm.js');
