#!/bin/bash
# G1 기준(RULER-oro L748·L862, S3-design.md §8)을 처음부터 잽니다 — 같은 컨테이너에서 하나씩, 1 시간 반쯤.
#
#   bash tools/genus-ruler/oro/g1/g1-run.sh [--final] [--out <g1-baseline.json>]
#
# 참조하는 build note 는 모두 S3-design.md '### G1 baseline tooling' 아래의 번호(G1 build note N)입니다.
# 놀고 있는 컨테이너에서만(G1 build note 19): g1-render 는 그리는 단계마다 loadavg < 1.0 이고 pcpu ≥ 50 인 남의 프로세스가 없을 때까지
# 40 분까지 기다리고(--wait-idle 2400), 아니면 exit 3. 다른 무거운 일과 함께 돌리지 마십시오.
# 한 번의 g1-render 호출(build·run1·run2·control·keys)이 b.json 하나를 만듭니다(fix G1-REC): 호출 id 가 단계마다 적히고, 호출마다
#   .harness/oro/g1/render-attempts.jsonl 에 시작·끝 줄이 덧붙습니다(덧붙이기만). --steps 로 이어 그린 b.json 은 --final 이 받지 않습니다
#   (renderSingleInvocation). 다시 잴 때는 이 스크립트 전체를 다시 돌립니다(b.json 을 지우고 새로).
# SwiftShader 일꾼 1 개(--swiftshader-threads 1): 일꾼이 여럿이면 P0_seoul·산악 장면의 지평선 몇 화소가 스레드 일정에 따라 1 단계씩
#   갈립니다(ee0ad83b/bc8cd61f/…, g1det 조사). run1·run2·keys 는 일꾼 1 개로 늘 같게 그리고, control 은 merge-aa 를 잰 기본 일꾼 수로
#   그립니다(g1-render 머리말). 일꾼 1 개는 기본보다 3 배쯤 느려 전체 1 시간 반쯤. 기준과 S7 의 뒤 렌더는 같은 일꾼 수여야 합니다.
# --final: G1 기준 커밋(115fbe2 + ece32b1 + G1 도구만 더한 커밋, 11-05 탐측 뒤 oro-inputs.json 커밋됨)에서 FROZEN runtime 에 넣을 판을
#   잴 때. g1-baseline.mjs 가 status.final 이 아니면 쓰지 않고 exit 1(G1 build note 20).
# --out: g1-baseline.json 을 쓸 곳(기본 tools/genus-ruler/oro/g1-baseline.json — FROZEN files 에 해시가 있는 파일). 임시 측정은
#   .harness/oro/g1/ 아래로(예: --out .harness/oro/g1/g1-baseline-interim.json; g1-test --baseline 로 시험).
#
#   1. g1-md5.mjs    (a) oro-inputs.json 의 장면(121 + 확장) × 3 밴드 buildMacroField md5(모드 1)와 AR(1) 15 걸음(모드 2) — oro-inputs.json 고리만
#   2. g1-jobs.mjs   (b) 잡 파일 tools/genus-ruler/oro/g1/jobs-g1.json(B0_app·P0_seoul·산악 둘, macro 1·macroN 128·고리 입력)
#   3. g1-render.mjs (b)(c) volsky/build.sh → run.js 두 번(A/A) → 대조(원래 B0_app·P0_seoul = oro/merge-aa.json) → 날씨 키
#   4. g1-live.mjs   (d) liveScene 요청 가로채기 시험
#   5. g1-baseline.mjs   조각을 모아 tools/genus-ruler/oro/g1-baseline.json(어긋나면 쓰지 않음)
# 조각과 그림은 .harness/oro/g1/ 에(무시되는 폴더). 커밋하지 않습니다.
set -euo pipefail
FINAL=()
OUT=tools/genus-ruler/oro/g1-baseline.json
while [ $# -gt 0 ]; do
  case "$1" in
    --final) FINAL=(--final); shift ;;
    --out) [ $# -ge 2 ] || { echo "g1-run.sh: --out needs a value" >&2; exit 2; }; OUT="$2"; shift 2 ;;
    *) echo "g1-run.sh: unknown argument $1 (allowed: --final, --out <file>)" >&2; exit 2 ;;
  esac
done
cd "$(dirname "$0")/../../../.."
G=tools/genus-ruler/oro/g1
P=.harness/oro/g1/parts
IN=tools/genus-ruler/oro/oro-inputs.json
mkdir -p "$P"
rm -f "$P/a.json" "$P/b.json" "$P/d.json"
node $G/g1-md5.mjs --inputs $IN --out $P/a.json
node $G/g1-jobs.mjs --inputs $IN --out $G/jobs-g1.json --control .harness/oro/g1/jobs-control.json
node $G/g1-render.mjs --jobs $G/jobs-g1.json --control .harness/oro/g1/jobs-control.json --out $P/b.json --swiftshader-threads 1 --wait-idle 2400
node $G/g1-live.mjs --out $P/d.json
node $G/g1-baseline.mjs --parts $P --jobs $G/jobs-g1.json --inputs $IN --out "$OUT" "${FINAL[@]}"
