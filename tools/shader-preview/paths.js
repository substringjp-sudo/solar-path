/**
 * paths.js
 *
 * 하네스가 산출물을 쓰는 자리 한 곳.
 *
 * ## 왜 뽑아냈나
 *
 * 24개 스크립트가 각자 이 경로를 **문자열로 박아** 두고 있었습니다:
 *
 *   /tmp/claude-0/-home-user-solar-path/<세션 UUID>/scratchpad/preview
 *
 * 그 UUID는 그것을 처음 적은 세션의 것입니다. 다음 세션은 자기 스크래치패드가
 * 따로 있으므로, 하네스는 **죽은 세션의 디렉터리**에 쓰고 그 자리를 서빙하게
 * 됩니다. 돌긴 도는데 산출물이 엉뚱한 곳에 쌓이고, 경로를 고치려면 24군데를
 * 함께 고쳐야 했습니다.
 *
 * 이제 한 곳입니다. `SKY_PREVIEW_DIR` 환경변수가 있으면 그걸 쓰고, 없으면
 * 저장소 안의 `.harness/` 로 떨어집니다 — 세션과 무관하고, git이 무시합니다.
 */
const path = require('path');

/** 저장소 루트 (이 파일 기준 두 단계 위) */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * 산출물 루트.
 *
 * 스크래치패드를 쓰고 싶으면 `SKY_PREVIEW_DIR`로 넘기세요. 기본값을 저장소
 * 안(`.harness/`)에 둔 이유는 **어느 세션에서 돌려도 같은 자리**여야 하기
 * 때문입니다. `.gitignore`에 들어 있어 커밋되지 않습니다.
 */
const SCRATCH = process.env.SKY_PREVIEW_DIR || path.join(REPO_ROOT, '.harness');

/** 미리보기 HTML·에셋을 서빙하는 디렉터리 */
const PREVIEW = path.join(SCRATCH, 'preview');

/** 정적 서버 포트. 미리보기 페이지와 판정 스크립트가 같은 값을 써야 합니다. */
const PORT = Number(process.env.SKY_PREVIEW_PORT || 8123);

const ORIGIN = `http://localhost:${PORT}`;

/**
 * ⚠ **스테이징이 낡았으면 큰 소리로 알립니다.**
 *
 * 하네스는 앱 소스를 직접 읽지 않고 `stage-esm.js` 가 떠 놓은
 * `<PREVIEW>/app/` 사본을 읽습니다. `run-all.js` 는 늘 스테이징부터 하지만
 * **낱개 `build-*` 는 안 합니다.** 그래서 앱 상수를 고치고 낱개로 재면
 * 화면이 안 움직이고, 그걸 "그 상수는 영향이 없다" 로 읽게 됩니다.
 *
 * 실제로 한 세션에서 두 번 당했습니다. SEA_FAR_M 을 60km/200km 로 오가며
 * 세 번 잰 값이 전부 같아 A/B 결론을 뒤집을 뻔했고, 되돌린 뒤 다시 재다가
 * 이번엔 사본에 없는 유니폼을 건드려 페이지가 죽었습니다.
 *
 * 막지는 않습니다 — 스테이징을 일부러 안 하는 경우(자료만 바꾼 A/B)가
 * 있습니다. 다만 **모르고 지나가지는 못하게** 합니다.
 */
function warnIfStale() {
  const fs = require('fs');
  const APP = path.join(PREVIEW, 'app');
  if (!fs.existsSync(APP)) return;   // 아직 한 번도 안 떴으면 할 말이 없습니다.
  let staged = Infinity;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else staged = Math.min(staged, fs.statSync(f).mtimeMs);
    }
  };
  walk(APP);
  const newer = [];
  const scan = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) scan(f);
      else if (/\.tsx?$/.test(e.name) && fs.statSync(f).mtimeMs > staged) {
        newer.push(path.relative(REPO_ROOT, f));
      }
    }
  };
  const SRC = path.join(REPO_ROOT, 'src');
  if (!fs.existsSync(SRC)) return;
  scan(SRC);
  if (!newer.length) return;
  process.stderr.write(
    '\n⚠ 스테이징이 낡았습니다 — 하네스는 ' + path.relative(REPO_ROOT, APP)
    + ' 의 사본을 읽습니다.\n'
    + '  그보다 새 앱 소스 ' + newer.length + '개: '
    + newer.slice(0, 4).join(', ') + (newer.length > 4 ? ' …' : '') + '\n'
    + '  앱을 고친 뒤라면 먼저: node tools/shader-preview/stage-esm.js\n\n');
}
warnIfStale();

module.exports = { REPO_ROOT, SCRATCH, PREVIEW, PORT, ORIGIN };
