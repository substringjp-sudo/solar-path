# CLAUDE.md — 이 저장소에서 일하는 에이전트에게

## 먼저 읽을 것
1. `docs/wiki/index.md` — 주제별 위키(LLM wiki). 지금 무엇이 참인지, 코드가 어디 있는지, 남은 일.
2. `docs/wiki/decisions.md` — 사용자와 정한 방향(한국어로 답, 비교 이미지, 하드코딩보다 물리, 실험은 기본 끔 등).
3. 깊이 들어갈 때만 원본 계획 문서(`docs/*.md`) 해당 절. 원본은 시간순 기록이라 길다(SKY_REBUILD_PLAN 1만 2천 줄).

## 위키 유지(작업 끝날 때마다)
- 바꾼 주제의 위키 쪽에서 **지금 상태 · 수치 · 코드 · 남은 일**을 고치고, `docs/wiki/log.md` 맨 위에 한 줄.
- 열린 문제가 생기거나 끝나면 `docs/wiki/open-issues.md` 를 고침.
- 새 주제면 쪽을 만들고 `index.md` 에 줄을 더함. 형식 · 규칙은 `docs/wiki/README.md`.
- 원본 계획 문서에는 하던 대로 새 절을 쓰고(기록), 위키에는 결론만 옮김.

## 기본 점검
- 타입: `npx tsc --noEmit -p .`
- 구름 판정: `node tools/shader-preview/verify-cloud-light.js` · `verify-cloud-edge.js` · `verify-cloud-cells.js`
- 볼륨 하네스: `bash tools/genus-ruler/volsky/build.sh` 후 `node tools/genus-ruler/volsky/run.js jobs.json outDir W H` — 함정은 `docs/wiki/harness-verification.md`.
- **볼륨 하네스는 사용자 맥북(실제 GPU, 폰과 비슷한 한도)에서 돌리는 것이 기본**: `node tools/genus-ruler/volsky/run-desktop.js jobs.json outDir W H`(맥북 `_host`). 컨테이너 SwiftShader(`run.js`)는 텍스처 단위 한도 같은 기기 제약을 가려서 보조로만 쓴다.
