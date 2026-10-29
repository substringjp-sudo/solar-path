#!/usr/bin/env bash
# §180 GPU 창 실행기 — RULER-grain C0 가 끝난 뒤(R1 앞) 한 명령으로, RULER-grain 과정과 겹치지 않게, 순서대로:
#   (1) §178 렌더 확인 L1~L6(lighting-render-check.js, entry-gpuwin 번들) → (2) T_sun B1 컴파일·링크(모든 변형 × low·medium·high, 진단 2~7 거부,
#   아틀라스 결정성) → (3) WP7(P1 아틀라스 읽기 대조 · P2 G-A 막힘 기록 · P3 합성 덮개) → (4) B0(REF 시간 → 가위 대체 경로·감시 시간 배율 결정,
#   비용 T/C0ps ≤ 1.15, 비용 A/A, 바닥 페이지) → (5) B2(R-A_T 후보 쪽 · REF_v2 진단·그림 · REF 검증) → 보고·요약 JSON.
#   판정 회차 없음 · 후보 손잡이는 합성 단위에만(사진 장면은 후보 손잡이에 보이지 않음 — 2026-10-28 사용자 결정).
#
#   tools/genus-ruler/tsun/gpu-window.sh run       창 전체(지킴 → 잠금 → 준비 → 단계들 → 보고). 다시 부르면 끝난 단계는 건너뜀(이어 돌리기).
#   tools/genus-ruler/tsun/gpu-window.sh prep      번들 둘(HEAD 에서, GW_ROOT 아래 자기 폴더 — .harness/ 아님)·잡 목록·잡 점검만(CPU, 브라우저 없음)
#   tools/genus-ruler/tsun/gpu-window.sh plan      단계·명령 줄·출력 경로·시간 어림만 찍음(prep 뒤)
#   tools/genus-ruler/tsun/gpu-window.sh status    단계 표지 요약
#   GW_DRY=1 … run                                  흐름 전체를 돌리되 브라우저를 띄우는 명령은 찍기만(지킴·잠금·예산·순서 시험)
#
# 환경(기본값):
#   GW_ROOT(scratchpad/gpuwin) · GW_OUT($GW_ROOT/out) · GW_STEPS(쉼표 목록, 비면 전부) · GW_SKIP_STEPS · GW_CHUNK_MIN(55, ≤ 60 — run-tsun --max-min)
#   GW_BUDGET_MIN(1440 — 창 전체, 지킴이 빈 뒤부터) · GW_UNTIL(ISO 시각 — 이 시각을 넘을 수 있는 덩어리는 시작하지 않음, 다음 grain 단계 2 시간 전 등)
#   GW_MAX_WAIT_MIN(720 — 처음 지킴 기다림) · GW_POLL_S(60) · GW_STABLE(2 — 연속으로 빈 횟수) · GW_ON_GRAIN(stop|wait — 단계 사이에 grain 이 보이면)
#   GW_HOLD(1 — 단계 사이에 'gpu-window-hold genus-ruler/volsky/run.js' 표지 과정을 둬 동결 eval-grain.sh guard_concurrent 가 창을 보게)
#   GW_ALLOW_DIRTY(auto|0|1 — auto: 고친 파일이 §180 준비 파일뿐이면 --allow-dirty 를 넘기고 run.json 에 diff sha 를 남김) · GW_PGREP(가짜 pgrep, 시험)
#   GW_LOCK(/tmp/gpu-window.lock — 창 하나만) · TSUN_LOCK(/tmp/run-tsun.lock — run-tsun·조명 확인 덩어리 잠금, run-tsun 과 같음)
# 종료: 0 끝 · 2 거부(잠금·더러운 트리·준비 실패) · 75 grain 과정 때문에 멈춤/기다림 한도 · 76 예산·GW_UNTIL 로 멈춤(다시 부르면 이어 감)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SCR=/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad
GW_ROOT=${GW_ROOT:-$SCR/gpuwin}
OUT=${GW_OUT:-$GW_ROOT/out}
JOBS=$GW_ROOT/jobs; LOGS=$OUT/logs; STEPSD=$OUT/steps; PREPM=$GW_ROOT/prep.json   # 잡·번들·준비 표지는 GW_ROOT(시험 GW_OUT 들이 같이 씀)
BT=$GW_ROOT/bundle-tsun; BL=$GW_ROOT/bundle-light; CHK=$GW_ROOT/check
CHUNK=${GW_CHUNK_MIN:-55}; BUDGET=${GW_BUDGET_MIN:-1440}; UNTIL=${GW_UNTIL:-}
MAXWAIT=${GW_MAX_WAIT_MIN:-720}; POLL=${GW_POLL_S:-60}; STABLE=${GW_STABLE:-2}; ON_GRAIN=${GW_ON_GRAIN:-stop}
HOLD=${GW_HOLD:-1}; ALLOW=${GW_ALLOW_DIRTY:-auto}; DRY=${GW_DRY:-0}
GW_LOCK=${GW_LOCK:-/tmp/gpu-window.lock}; TL=${TSUN_LOCK:-/tmp/run-tsun.lock}
TAG=genus-ruler/volsky/run.js
LIB="node $HERE/gpuwin-lib.js"
NICE="nice -n 19"
HOLD_NAME="gpu-window-hold $TAG (tsun GPU window — tools/genus-ruler/tsun/gpu-window.sh)"
# 단계: 이름|종류|인자… (순서 = 실행 순서). 종류 light = lighting-render-check.js 단계 · tsun = run-tsun 잡 파일|출력 폴더|깃발 · post · decide.
STEPS=(
  "L1compile|light|L1compile" "L2deck|light|L2deck" "L3twilight|light|L3twilight" "L4sunset|light|L4sunset" "L5cross12|light|L5cross12" "L6frametime|light|L6frametime"
  "post-light|post|light"
  "B1low|tsun|b1-low.json|B1-low|" "B1medium|tsun|b1-medium.json|B1-medium|" "B1high|tsun|b1-high.json|B1-high|"
  "B1refuse|tsun|b1-refuse.json|B1-refuse|" "B1det|tsun|b1-det.json|B1-det|"
  "post-b1|post|b1"
  "W7atlas|light|W7atlas" "W7emu|tsun|w7-emu.json|W7-emu|"
  "B0time|tsun|b0-time.json|B0-time|" "B0decide|decide|"
  "B0cost|tsun|b0-cost.json|B0-cost|" "B0costaa1|tsun|b0-costaa-1.json|B0-costaa-1|" "B0costaa2|tsun|b0-costaa-2.json|B0-costaa-2|"
  "B0floor|tsun|b0-floor.json|B0-floor|scale,refgate"
  "post-b0|post|b0"
  "B2t|tsun|b2-t.json|B2|" "B2ref|tsun|b2-ref.json|B2|scale,refgate" "B2refval|tsun|b2-refval.json|B2|scale,refgate"
  "post-b2|post|b2" "post-w7|post|w7"
)
# 더러운 트리 허용 목록(auto) — §180 준비 파일과 문서만
ALLOWLIST_RE='^(tools/genus-ruler/tsun/(gpu-window\.sh|gpuwin-[a-z]+\.(js|mjs|py|ts)|lighting-render-check\.js|entry-gpuwin\.ts|entry-tsun\.ts)|docs/SKY_REBUILD_PLAN\.md)$'

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOGS/gpu-window.log"; }
die() { log "ERROR: $*"; exit "${2:-2}"; }
# 쓰기 전에 경로 점검(.harness/ · grain · volsky · src · 동결 후보 tsun 파일 아래 금지)
$LIB paths-ok "$OUT" "$GW_ROOT" "$BT" "$BL" "$CHK" "$JOBS" || { echo "gpu-window: output paths refused" >&2; exit 2; }
mkdir -p "$OUT" "$LOGS" "$STEPSD" "$JOBS"
case "$CHUNK" in ''|*[!0-9]*) die "GW_CHUNK_MIN must be an integer";; esac
[ "$CHUNK" -ge 10 ] && [ "$CHUNK" -le 60 ] || die "GW_CHUNK_MIN must be in [10, 60] (chunks ≤ 60 min)"
case "$ON_GRAIN" in stop|wait) ;; *) die "GW_ON_GRAIN must be stop|wait";; esac

# ───── 표지 과정(창 내내 eval-grain.sh 가 보게; 자식 단계 직전에 내리고 끝나면 다시 — 자식은 스스로 같은 태그를 들고 뜸) ─────
HOLD_PID=""
hold_start() { [ "$HOLD" = 1 ] || return 0; [ -z "$HOLD_PID" ] || return 0; bash -c "exec -a \"$HOLD_NAME\" sleep 4200" & HOLD_PID=$!; }
hold_stop() { [ -n "$HOLD_PID" ] || return 0; kill "$HOLD_PID" 2>/dev/null; wait "$HOLD_PID" 2>/dev/null; HOLD_PID=""; }
trap 'hold_stop' EXIT
trap 'hold_stop; log "interrupted"; exit 130' INT TERM HUP

# ───── 시간 ─────
T_START=""
now_s() { date -u +%s; }
budget_ok() {   # budget_ok MINUTES — 다음 덩어리(최대 MINUTES 분)를 시작해도 되는지
  local need=$1 el=$(( ( $(now_s) - T_START ) / 60 ))
  [ $(( el + need )) -le "$BUDGET" ] || { log "budget: ${el} min used + ${need} > GW_BUDGET_MIN ${BUDGET}"; return 1; }
  if [ -n "$UNTIL" ]; then local u; u=$(date -u -d "$UNTIL" +%s 2>/dev/null) || die "bad GW_UNTIL $UNTIL"
    [ $(( $(now_s) + need * 60 )) -le "$u" ] || { log "budget: a ${need}-min chunk would end after GW_UNTIL $UNTIL"; return 1; }; fi
  return 0
}

# ───── 지킴 ─────
guard_between() {   # 자식 단계 직전: grain 과정이 보이면 GW_ON_GRAIN 에 따라 멈춤/기다림
  local excl=""; [ -n "$HOLD_PID" ] && excl="--exclude-pid $HOLD_PID"
  $LIB guard --once $excl >>"$LOGS/gpu-window.log" 2>&1; local rc=$?
  [ $rc -eq 0 ] && return 0
  [ $rc -eq 10 ] || die "guard error (pgrep) rc $rc" 2
  if [ "$ON_GRAIN" = wait ]; then log "grain process appeared — waiting (GW_ON_GRAIN=wait)"; hold_stop
    $LIB guard --wait --max-wait-min "$MAXWAIT" --poll-s "$POLL" --stable "$STABLE" 2>&1 | tee -a "$LOGS/gpu-window.log"; [ "${PIPESTATUS[0]}" -eq 0 ] || finish 75 "grain still running after ${MAXWAIT} min"
    hold_start; return 0; fi
  finish 75 "a RULER-grain process appeared between steps — stopping (GW_ON_GRAIN=stop); re-run to resume"
}

# ───── 단계 표지 ─────
marker() { echo "$STEPSD/$1.json"; }
mark() {   # mark ID STATUS INSHA RC STARTED CHUNKS NOTE
  [ "$DRY" = 1 ] && { log "[dry] marker $1 → $2"; return 0; }
  $LIB marker-write --marker "$(marker "$1")" --id "$1" --status "$2" --input-sha "$3" --rc "$4" --started "$5" --chunks "$6" --note "$7"
}
skip_if_done() { [ "$DRY" = 1 ] && return 1; $LIB marker-ok --marker "$(marker "$1")" --input-sha "$2"; }
want_step() {
  local id=$1
  if [ -n "${GW_STEPS:-}" ]; then case ",$GW_STEPS," in *",$id,"*) ;; *) return 1;; esac; fi
  case ",${GW_SKIP_STEPS:-}," in *",$id,"*) return 1;; esac
  return 0
}

# ───── 더러운 트리 ─────
DIRTY_FLAG=""
dirty_policy() {
  local list n bad
  list=$(git -C "$ROOT" status --porcelain | sed 's/^...//')
  n=$(printf '%s' "$list" | grep -c . || true)
  [ "$n" -eq 0 ] && { DIRTY_FLAG=""; return 0; }
  case "$ALLOW" in
    1) DIRTY_FLAG="--allow-dirty" ;;
    0) die "working tree has $n changed/untracked file(s) — commit first or GW_ALLOW_DIRTY=1" 2 ;;
    auto) bad=$(printf '%s\n' "$list" | grep -Ev "$ALLOWLIST_RE" || true)
      [ -z "$bad" ] || die "working tree has changes outside the §180 allowlist (GW_ALLOW_DIRTY=1 to override):
$bad" 2
      DIRTY_FLAG="--allow-dirty" ;;
    *) die "GW_ALLOW_DIRTY must be auto|0|1" ;;
  esac
  log "dirty tree ($n file(s), all §180 prep files) — bundles get --allow-dirty; diff sha recorded in run.json"
}
tree_sha() { { git -C "$ROOT" rev-parse HEAD; git -C "$ROOT" diff HEAD; git -C "$ROOT" ls-files --others --exclude-standard | sort | while read -r f; do sha256sum "$ROOT/$f"; done; } | sha256sum | cut -c1-64; }

# ───── 준비(CPU): 번들 둘 · 잡 목록 · 잡 점검 ─────
build_light() {   # entry-gpuwin 을 두 번 묶어 같은지(run-tsun.sh build 와 같은 bundle.json 꼴)
  mkdir -p "$BL/.again"
  for d in "$BL" "$BL/.again"; do
    (cd "$ROOT" && $NICE npx esbuild tools/genus-ruler/tsun/entry-gpuwin.ts --bundle --format=esm --outfile="$d/app.js" \
      --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"' --log-level=warning) || return 1
  done
  local A B V H D
  A=$(sha256sum "$BL/app.js" | cut -d' ' -f1); B=$(sha256sum "$BL/.again/app.js" | cut -d' ' -f1)
  V=$(cd "$ROOT" && npx esbuild --version); H=$(git -C "$ROOT" rev-parse HEAD); D=$(git -C "$ROOT" status --porcelain | wc -l)
  printf '{"bundleSha256":"%s","again":"%s","same":%s,"esbuild":"%s","gitHead":"%s","dirtyFiles":%s,"entry":"tools/genus-ruler/tsun/entry-gpuwin.ts"}\n' \
    "$A" "$B" "$([ "$A" = "$B" ] && echo true || echo false)" "$V" "$H" "$D" > "$BL/bundle.json"
  [ "$A" = "$B" ]
}
prep() {
  local sha; sha=$(tree_sha)
  if $LIB marker-ok --marker "$PREPM" --input-sha "$sha" && [ -f "$JOBS/manifest.json" ] && [ -f "$BT/app.js" ] && [ -f "$BL/app.js" ] && [ -f "$CHK/gpuwin-check.cjs" ]; then log "prep: up to date (tree ${sha:0:16})"; return 0; fi
  local t0; t0=$(date -u +%FT%TZ)
  log "prep: bundles → $BT, $BL; jobs → $JOBS"
  $NICE sh "$HERE/run-tsun.sh" build "$BT" >"$LOGS/prep-bundle-tsun.log" 2>&1 || die "tsun bundle build failed (see $LOGS/prep-bundle-tsun.log)"
  build_light >"$LOGS/prep-bundle-light.log" 2>&1 || die "light bundle build failed (see $LOGS/prep-bundle-light.log)"
  $NICE python3 -I "$HERE/gpuwin-jobs.py" --outdir "$JOBS" >"$LOGS/prep-jobs.log" 2>&1 || die "job generation failed (see $LOGS/prep-jobs.log)"
  mkdir -p "$CHK"
  (cd "$ROOT" && $NICE npx esbuild tools/genus-ruler/tsun/gpuwin-check.ts --bundle --platform=node --format=cjs --outfile="$CHK/gpuwin-check.cjs" \
    --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"' --log-level=warning) >"$LOGS/prep-check.log" 2>&1 || die "check build failed"
  $NICE node "$CHK/gpuwin-check.cjs" --jobs "$JOBS" --chunk-min "$CHUNK" >>"$LOGS/prep-check.log" 2>&1 || die "job check failed (see $LOGS/prep-check.log)"
  $LIB marker-write --marker "$PREPM" --id prep --status done --input-sha "$sha" --rc 0 --started "$t0" --chunks 0 --note "tsun $(head -c 90 "$BT/bundle.json") · light $(head -c 90 "$BL/bundle.json")"
  log "prep: ok"
}

# ───── 단계 실행 ─────
jobs_wh() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0]; const c=j.canvas||[j.W,j.H]; console.log(c[0]+" "+c[1])' "$1"; }
dec_get() { node -e 'try{const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=d[process.argv[2]]; console.log(v===undefined||v===null?"":v)}catch{console.log("")}' "$OUT/decisions.json" "$1"; }
tsun_cmd() {   # tsun_cmd JOBFILE OUTDIR W H EXTRA… — 찍기·시험에도 쓰는 정확한 줄
  echo "$NICE node $HERE/run-tsun.js --guard-tag $TAG --max-min $CHUNK --lock $TL --root $BT $DIRTY_FLAG $5 $1 $2 $3 $4 gen"
}
light_cmd() { echo "$NICE node $HERE/lighting-render-check.js --guard-tag $TAG --stage $1 --root $BL --scenes $JOBS/light-scenes.json --out $OUT/L --max-min 60 --lock $TL $DIRTY_FLAG"; }
STOP_RC=0
run_child() {   # run_child LOGFILE CMD… — 표지 내림 → 지킴 → 실행 → 표지 올림
  local lf=$1; shift
  hold_stop
  guard_between
  if [ "$DRY" = 1 ]; then echo "[dry] $*" | tee -a "$lf" "$LOGS/gpu-window.log" >/dev/null; hold_start; return "${GW_DRY_RC:-0}"; fi
  "$@" >>"$lf" 2>&1; local rc=$?
  hold_start
  return $rc
}
step_light() {
  local id=$1 st=$2 lf="$LOGS/$1.log" sha t0 rc
  sha=$($LIB input-sha "$BL/app.js" "$BL/bundle.json" "$JOBS/light-scenes.json" "$HERE/lighting-render-check.js" "$HERE/gpuwin-lib.js")
  if skip_if_done "$id" "$sha"; then log "$id: done earlier — skip"; return 0; fi
  budget_ok 60 || finish 76 "budget/GW_UNTIL reached before $id"
  t0=$(date -u +%FT%TZ); log "$id: start"
  # shellcheck disable=SC2046
  run_child "$lf" $(light_cmd "$st"); rc=$?
  case $rc in 0) mark "$id" done "$sha" 0 "$t0" 1 "" ;; 2) guard_between; mark "$id" refused "$sha" 2 "$t0" 1 "see $lf" ;; 3) mark "$id" timeout "$sha" 3 "$t0" 1 "stage hit 60 min" ;; *) mark "$id" failed "$sha" "$rc" "$t0" 1 "see $lf" ;; esac
  log "$id: rc $rc"
}
step_tsun() {
  local id=$1 jf="$JOBS/$2" od="$OUT/$3" flags=$4 lf="$LOGS/$1.log" extra="" sha t0 rc wh n0 n1 chunks=0 stall=0 status=""
  [ -f "$jf" ] || die "$id: missing job file $jf (prep?)"
  local deps=("$jf" "$BT/app.js" "$BT/bundle.json" "$HERE/run-tsun.js" "$HERE/run-tsun-lib.js")
  case ",$flags," in *,scale,*|*,refgate,*) deps+=("$OUT/decisions.json") ;; esac
  sha=$($LIB input-sha "${deps[@]}")
  if skip_if_done "$id" "$sha"; then log "$id: done earlier — skip"; return 0; fi
  t0=$(date -u +%FT%TZ)
  if [[ ",$flags," == *,refgate,* ]] && [ "$DRY" != 1 ]; then
    [ -f "$OUT/decisions.json" ] || { mark "$id" blocked "$sha" -1 "$t0" 0 "no decisions.json (B0time/B0decide not done)"; log "$id: blocked (no B0 decision)"; return 0; }
    if [ "$(dec_get refBlocked)" = true ]; then mark "$id" blocked "$sha" -1 "$t0" 0 "B0: $(dec_get reasons)"; log "$id: blocked by B0 decision"; return 0; fi
  fi
  if [[ ",$flags," == *,scale,* ]]; then local s; s=$(dec_get watchdogScale); [ -n "$s" ] && extra="--watchdog-scale $s"; fi
  wh=$(jobs_wh "$jf"); mkdir -p "$od"
  ndone() { [ "$DRY" = 1 ] && { echo $chunks; return; }; $LIB count-done --dir "$od" --jobs "$jf"; }
  log "$id: start ($(basename "$jf") → $od, canvas $wh${extra:+, $extra})"
  while :; do
    budget_ok "$CHUNK" || { mark "$id" partial "$sha" 76 "$t0" "$chunks" "budget"; finish 76 "budget/GW_UNTIL reached during $id"; }
    n0=$(ndone)
    # shellcheck disable=SC2046,SC2086
    run_child "$lf" $(tsun_cmd "$jf" "$od" $wh "$extra"); rc=$?
    chunks=$((chunks + 1)); n1=$(ndone)
    [ "$DRY" = 1 ] && [ $chunks -ge 3 ] && [ $rc -eq 3 ] && { status=dry-chunks; break; }   # 시험: 남은 잡 흉내(rc 3)는 세 덩어리에서 멈춤
    case $rc in
      0) status=done; break ;;
      4) status=done-failures; break ;;
      3|5|6) if [ "$n1" -gt "$n0" ]; then stall=0; else stall=$((stall + 1)); fi
         [ $stall -ge 2 ] && { status=stalled; break; }
         log "$id: chunk $chunks rc $rc (done $n0 → $n1) — next chunk" ;;
      2) guard_between; status=refused; break ;;
      *) status=failed; break ;;
    esac
  done
  mark "$id" "$status" "$sha" "$rc" "$t0" "$chunks" "see $lf"
  log "$id: $status (rc $rc, $chunks chunk(s))"
}
step_post() { local lf="$LOGS/post-$1.log"; if [ "$DRY" = 1 ]; then log "[dry] post $1"; return 0; fi; $NICE node "$HERE/gpuwin-post.mjs" "$1" --out "$OUT" --jobs "$JOBS" >>"$lf" 2>&1 || log "post $1 failed (see $lf)"; }
step_decide() {
  [ "$DRY" = 1 ] && { log "[dry] decide-b0"; return 0; }
  $LIB decide-b0 --dir "$OUT/B0-time" --out "$OUT/decisions.json" --chunk-min "$CHUNK" >>"$LOGS/B0decide.log" 2>&1 || log "decide-b0 failed"
  log "B0 decision: $(cat "$OUT/decisions.json" 2>/dev/null | head -c 600)"
  $LIB estimate --manifest "$JOBS/manifest.json" --decisions "$OUT/decisions.json" --chunk-min "$CHUNK" --json "$OUT/estimate-after-B0.json" | tee -a "$LOGS/gpu-window.log"
}
finish() {   # finish RC MSG — 보고·요약을 쓰고 끝냄(중간에 멈추면 보고를 한 번 더 — 끝까지 간 경우는 단계들이 이미 씀)
  local rc=$1; shift; [ $# -gt 0 ] && log "$*"
  hold_stop
  if [ "$DRY" != 1 ]; then
    [ "$rc" -ne 0 ] && for p in light b1 b0 b2 w7; do $NICE node "$HERE/gpuwin-post.mjs" "$p" --out "$OUT" --jobs "$JOBS" >>"$LOGS/post-$p.log" 2>&1 || true; done
    $NICE node "$HERE/gpuwin-post.mjs" summary --out "$OUT" --jobs "$JOBS" --estimate "$OUT/estimate.json" >>"$LOGS/post-summary.log" 2>&1 || true
    log "summary: $OUT/gpu-window-summary.json"
  fi
  exit "$rc"
}
run_steps() {
  for s in "${STEPS[@]}"; do
    IFS='|' read -r id kind a b c <<<"$s"
    want_step "$id" || { log "$id: not selected"; continue; }
    case $kind in
      light) step_light "$id" "$a" ;;
      tsun) step_tsun "$id" "$a" "$b" "$c" ;;
      post) step_post "$a" ;;
      decide) step_decide ;;
    esac
  done
}

cmd=${1:-help}
case "$cmd" in
  prep)
    exec 9>"$GW_LOCK"; flock -n 9 || die "another gpu-window is running (lock $GW_LOCK)"
    dirty_policy; prep
    $LIB estimate --manifest "$JOBS/manifest.json" --chunk-min "$CHUNK" --json "$OUT/estimate.json" ;;
  plan)
    [ -f "$JOBS/manifest.json" ] || die "run prep first"
    DIRTY_FLAG=$( ( dirty_policy >/dev/null 2>&1; echo "$DIRTY_FLAG" ) || echo '<dirty-tree-refused>' )
    for s in "${STEPS[@]}"; do IFS='|' read -r id kind a b c <<<"$s"; want_step "$id" || continue
      case $kind in
        light) echo "$id: $(light_cmd "$a")" ;;
        tsun) echo "$id: $(tsun_cmd "$JOBS/$a" "$OUT/$b" $(jobs_wh "$JOBS/$a") "$([[ ",$c," == *,scale,* ]] && echo '--watchdog-scale <B0>')")  [${c:-}]" ;;
        post) echo "$id: node gpuwin-post.mjs $a --out $OUT --jobs $JOBS" ;;
        decide) echo "$id: gpuwin-lib.js decide-b0 --dir $OUT/B0-time --out $OUT/decisions.json" ;;
      esac; done
    $LIB estimate --manifest "$JOBS/manifest.json" --chunk-min "$CHUNK" ;;
  status)
    for f in "$STEPSD"/*.json; do [ -f "$f" ] && node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log((m.id||"").padEnd(14), (m.status||"").padEnd(14), "rc", m.rc, "chunks", m.chunks, m.writtenAt, m.note||"")' "$f"; done ;;
  run)
    exec 9>"$GW_LOCK"; flock -n 9 || die "another gpu-window is running (lock $GW_LOCK)"
    pkill -f '^gpu-window-hold ' 2>/dev/null || true   # 죽은 창이 남긴 표지(잠금을 얻었으니 우리 것이 아님)
    log "gpu-window: waiting until no RULER-grain process (pattern '$(node -e 'console.log(require(process.argv[1]).GRAIN_PATTERN)' "$HERE/run-tsun-lib.js")', ≤ ${MAXWAIT} min, stable ×${STABLE})"
    $LIB guard --wait --max-wait-min "$MAXWAIT" --poll-s "$POLL" --stable "$STABLE" 2>&1 | tee -a "$LOGS/gpu-window.log"
    [ "${PIPESTATUS[0]}" -eq 0 ] || { log "grain still running after ${MAXWAIT} min (or pgrep error) — not starting"; exit 75; }
    T_START=$(now_s)
    hold_start
    dirty_policy; prep
    $LIB estimate --manifest "$JOBS/manifest.json" --chunk-min "$CHUNK" --json "$OUT/estimate.json" | tee -a "$LOGS/gpu-window.log"
    node -e 'const fs=require("fs"); const [o,h,t,df,b1,b2,dry]=process.argv.slice(1); let bt=null,bl=null; try{bt=JSON.parse(fs.readFileSync(b1+"/bundle.json","utf8"))}catch{} try{bl=JSON.parse(fs.readFileSync(b2+"/bundle.json","utf8"))}catch{}
      fs.writeFileSync(o+"/run.json", JSON.stringify({startedAt:new Date().toISOString(), gitHead:h, treeSha:t, allowDirty:df==="--allow-dirty", bundles:{tsun:bt, light:bl}, dry:dry==="1", env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("GW_")))}, null, 1))' \
      "$OUT" "$(git -C "$ROOT" rev-parse HEAD)" "$(tree_sha)" "$DIRTY_FLAG" "$BT" "$BL" "$DRY"
    run_steps
    finish 0 "gpu-window: all selected steps processed" ;;
  *) sed -n '2,24p' "$0"; exit 2 ;;
esac
