#!/bin/bash
# G1 기준(RULER-oro L748·L862, S3-design.md §8)을 처음부터 잽니다 — 같은 컨테이너에서 하나씩, 30 분쯤.
#
#   bash tools/genus-ruler/oro/g1/g1-run.sh
#
#   1. g1-md5.mjs    (a) 121 장면 × 3 밴드 buildMacroField md5(모드 1)와 AR(1) 15 걸음(모드 2) — oro-inputs.json 고리만
#   2. g1-jobs.mjs   (b) 잡 파일 tools/genus-ruler/oro/g1/jobs-g1.json(B0_app·P0_seoul·산악 둘, macro 1·macroN 128·고리 입력)
#   3. g1-render.mjs (b)(c) volsky/build.sh → run.js 두 번(A/A) → 대조(원래 B0_app·P0_seoul = oro/merge-aa.json) → 날씨 키
#   4. g1-live.mjs   (d) liveScene 요청 가로채기 시험
#   5. g1-baseline.mjs   조각을 모아 tools/genus-ruler/oro/g1-baseline.json(어긋나면 쓰지 않음)
# 조각과 그림은 .harness/oro/g1/ 에(무시되는 폴더). 커밋하지 않습니다.
set -euo pipefail
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
node $G/g1-baseline.mjs --parts $P --jobs $G/jobs-g1.json --inputs $IN --out tools/genus-ruler/oro/g1-baseline.json
