#!/bin/sh
# §179 RULER-tsun 하네스(WP8 — ruler-delta B1·B2·B3) — **예약된 기계 창에서만**(RULER-grain 렌더와 동시에 돌리지 않음, B4·U8).
#
#   sh tools/genus-ruler/tsun/run-tsun.sh build <폴더>
#       entry-tsun.ts 를 esbuild 로 두 번(<폴더>/app.js 와 <폴더>/.again/app.js) 묶어 sha256 이 같은지 보고 <폴더>/bundle.json 에 적음
#       (sha · esbuild 판 · git HEAD · 작업 트리 깨끗한지). 다르면 종료 코드 1. Chromium 은 띄우지 않음.
#       판정·보정 렌더용 번들 폴더는 .harness/volsky-tsun(RULER-tsun §5.0 ①) — 이 스크립트는 폴더를 인자로만 받음(기본 없음).
#   sh tools/genus-ruler/tsun/run-tsun.sh run <번들 폴더> jobs.json outDir W H [gen|load]
#       ruler-delta B2 의 띄우기 줄: nice -n 19 · --guard-tag genus-ruler/volsky/run.js(동결 eval-grain.sh 가 이 덩어리를 봄) · 덩어리 ≤ 110 분.
#       종료 코드 3(시간 한도)이면 같은 줄을 다시 부르면 이어 그림(<잡>.meta.json 의 sha 가 같은 잡은 건너뜀). 자기 지킴·잠금은 run-tsun.js 가 함.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
cmd="$1"; shift || true
case "$cmd" in
  build)
    OUT="$1"; [ -n "$OUT" ] || { echo "usage: run-tsun.sh build <폴더>" >&2; exit 2; }
    mkdir -p "$OUT/.again"
    for d in "$OUT" "$OUT/.again"; do
      (cd "$ROOT" && nice -n 19 npx esbuild tools/genus-ruler/tsun/entry-tsun.ts --bundle --format=esm --outfile="$d/app.js" \
        --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"' --log-level=warning)
    done
    A=$(sha256sum "$OUT/app.js" | cut -d' ' -f1); B=$(sha256sum "$OUT/.again/app.js" | cut -d' ' -f1)
    V=$(cd "$ROOT" && npx esbuild --version)
    HEAD=$(git -C "$ROOT" rev-parse HEAD); DIRTY=$(git -C "$ROOT" status --porcelain | wc -l)
    printf '{"bundleSha256":"%s","again":"%s","same":%s,"esbuild":"%s","gitHead":"%s","dirtyFiles":%s,"entry":"tools/genus-ruler/tsun/entry-tsun.ts"}\n' \
      "$A" "$B" "$([ "$A" = "$B" ] && echo true || echo false)" "$V" "$HEAD" "$DIRTY" > "$OUT/bundle.json"
    cat "$OUT/bundle.json"
    [ "$A" = "$B" ] || { echo "run-tsun.sh: two builds differ" >&2; exit 1; } ;;
  run)
    BUNDLE="$1"; JOBS="$2"; OUTD="$3"; W="$4"; H="$5"; ATM="${6:-gen}"
    [ -n "$H" ] || { echo "usage: run-tsun.sh run <번들 폴더> jobs.json outDir W H [gen|load]" >&2; exit 2; }
    # 한 번 = 한 덩어리(≤ 110 분). 종료 코드 3 이면 남은 잡이 있음 — 예약 창 안에서 사람이 다시 부름(창을 넘겨 저절로 이어 돌지 않게).
    VROOT="$BUNDLE" exec nice -n 19 node "$HERE/run-tsun.js" --guard-tag genus-ruler/volsky/run.js --max-min 110 "$JOBS" "$OUTD" "$W" "$H" "$ATM" ;;
  *) echo "usage: run-tsun.sh build <폴더> | run <번들 폴더> jobs.json outDir W H [gen|load]" >&2; exit 2 ;;
esac
