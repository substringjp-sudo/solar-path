#!/bin/bash
# G1 기준(RULER-oro L748·L862, S3-design.md §8)을 처음부터 잽니다 — 같은 컨테이너에서 하나씩, 30 분쯤.
#
#   bash tools/genus-ruler/oro/g1/g1-run.sh [--final]
#
# 놀고 있는 컨테이너에서만(build note 19): g1-render 는 그리는 단계마다 loadavg < 1.0 이고 pcpu ≥ 50 인 남의 프로세스가 없을 때까지
# 15 분까지 기다리고, 아니면 exit 3. 다른 무거운 일과 함께 돌리지 마십시오(P0_seoul rgb 가 부하에서 bc8cd61f… 로 갈림).
# --final: G1 기준 커밋(115fbe2 + ece32b1 + G1 도구만 더한 커밋, 11-05 탐측 뒤 oro-inputs.json 커밋됨)에서 FROZEN runtime 에 넣을 판을
#   잴 때. g1-baseline.mjs 가 status.final 이 아니면 쓰지 않고 exit 1(build note 20).
#
#   1. g1-md5.mjs    (a) 121 장면 × 3 밴드 buildMacroField md5(모드 1)와 AR(1) 15 걸음(모드 2) — oro-inputs.json 고리만
#   2. g1-jobs.mjs   (b) 잡 파일 tools/genus-ruler/oro/g1/jobs-g1.json(B0_app·P0_seoul·산악 둘, macro 1·macroN 128·고리 입력)
#   3. g1-render.mjs (b)(c) volsky/build.sh → run.js 두 번(A/A) → 대조(원래 B0_app·P0_seoul = oro/merge-aa.json) → 날씨 키
#   4. g1-live.mjs   (d) liveScene 요청 가로채기 시험
#   5. g1-baseline.mjs   조각을 모아 tools/genus-ruler/oro/g1-baseline.json(어긋나면 쓰지 않음)
# 조각과 그림은 .harness/oro/g1/ 에(무시되는 폴더). 커밋하지 않습니다.
set -euo pipefail
FINAL=()
case "${1:-}" in
  '') ;;
  --final) FINAL=(--final) ;;
  *) echo "g1-run.sh: unknown argument $1 (allowed: --final)" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/../../../.."
G=tools/genus-ruler/oro/g1
P=.harness/oro/g1/parts
IN=tools/genus-ruler/oro/oro-inputs.json
mkdir -p "$P"
rm -f "$P/a.json" "$P/b.json" "$P/d.json"
node $G/g1-md5.mjs --inputs $IN --out $P/a.json
node $G/g1-jobs.mjs --inputs $IN --out $G/jobs-g1.json --control .harness/oro/g1/jobs-control.json
node $G/g1-render.mjs --jobs $G/jobs-g1.json --control .harness/oro/g1/jobs-control.json --out $P/b.json
node $G/g1-live.mjs --out $P/d.json
node $G/g1-baseline.mjs --parts $P --jobs $G/jobs-g1.json --inputs $IN --out tools/genus-ruler/oro/g1-baseline.json "${FINAL[@]}"
