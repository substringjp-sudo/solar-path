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

module.exports = { REPO_ROOT, SCRATCH, PREVIEW, PORT, ORIGIN };
