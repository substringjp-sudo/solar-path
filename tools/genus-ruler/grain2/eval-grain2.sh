#!/usr/bin/env bash
# eval-grain2.sh — RULER-grain2 판정 진행(옛 RULER-grain 의 렌더·판정 코드를 그대로 쓰고 G2 하늘·G3 만 grain2.py 로 다시 매김).
#   tools/genus-ruler/grain2/eval-grain2.sh test | aa | rejudge K | round K | final [ADOPT [--drop-last|--add ARM]] | refreport K | eye
# 순서(RULER-grain2 §5): test → aa(동결 전 검증) → [동결 커밋] → rejudge 1 → rejudge 2(옛 eval-grain.sh round 2 가 끝난 뒤) → round 3 … round 5 → final → eye
# 환경: OUT(기본 .harness/volsky-grain/out) · CUMCAP(기본 1.40) · G0BUNDLE(옛 자와 같음). 판정 JSON 은 $OUT/judge2 에 쓰고 손으로 고치지 않습니다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GR="$ROOT/tools/genus-ruler/grain"; G2D="$ROOT/tools/genus-ruler/grain2"
OUT="${OUT:-$ROOT/.harness/volsky-grain/out}"
R="$OUT/r"; JD="$OUT/judge"; J2="$OUT/judge2"
CUMCAP="${CUMCAP:-1.40}"; DEVH=2340
mkdir -p "$J2"; cd "$ROOT"
PY="python3 $GR/grain.py"; PY2="python3 $G2D/grain2.py"; CACHE="$J2/clip-cache.json"
SC="$GR/scenes-grain.json"

guard_concurrent() {
  if [ "${FORCE:-0}" != "1" ] && pgrep -f 'genus-ruler/volsky/run.js' >/dev/null; then
    echo "다른 하네스(volsky/run.js)가 돌고 있음 — 동시에 돌리지 않음. FORCE=1 로 무시." >&2; exit 2
  fi
}
render() {   # 옛 eval-grain.sh 의 render 와 같음(두 캔버스, 60 분 덩어리, 종료 코드 3 = 남음)
  local jobs="$1"; guard_concurrent
  for canvas in "390 584" "1080 $DEVH"; do
    while true; do
      set +e; node "$GR/run-grain.js" --atmos gen --max-min 60 "$jobs" "$R" $canvas; rc=$?; set -e
      [ $rc -eq 3 ] && continue
      [ $rc -eq 0 ] || [ $rc -eq 4 ] || { echo "run-grain 실패 $rc" >&2; exit $rc; }
      break
    done
  done
}
select_jobs() { local out="$1" jobs="$2"; shift 2; $PY --select "$jobs" "$@" --order unit --out "$out"; }
calib_args() {   # 옛 eval-grain.sh 의 calib_args 를 그대로 부름(같은 사다리)
  bash -c "source <(sed -n '/^calib_args() {/,/^}/p' '$GR/eval-grain.sh'); JD='$JD'; calib_args"
}
base_of() {      # 라운드 K 의 기준 팔(옛 round 단계의 BASE 식과 같음 — 채택 파일만 judge2 에서)
  python3 - "$1" "$2" "$JD/calib-grain.json" <<'EOF'
import json, sys, os
p, k, cal = sys.argv[1], int(sys.argv[2]), sys.argv[3]
if not p: print('C0'); sys.exit()
ad = json.load(open(p))['adopted']
rer = os.path.exists(cal) and json.load(open(cal)).get('bkReuse') is False
print(('B%d' % (k - 1)) if (ad and rer) else (ad[-1]['arm'] if ad else 'C0'))
EOF
}
old_gate() {     # 옛 가드 그대로(기록) — 옛 eval-grain.sh 의 gate_arm 과 같은 인자
  local K="$1" base="$2" arm="$3" pre="$4"
  $PY --ext --scenes "$SC" --renders "$R" --base "$base" --cand "$arm" --calib "$JD/calib-grain.json" \
    ${G0BUNDLE:+--g0bundle "$G0BUNDLE"} --out "$pre/ext-R$K-$arm.json"
  $PY --gate --scenes "$SC" --renders "$R" --base "$base" --cand "$arm" --round "$K" --ref "$R" \
    --calib "$JD/calib-grain.json" --external "$pre/ext-R$K-$arm.json" --c0 C0 --cumcap "$CUMCAP" --out "$pre/gate-R$K-$arm.json"
}
new_gate() { $PY2 --rejudge --old "$1" --scenes "$SC" --renders "$R" --cache "$CACHE" --out "$2"; }
adopt_stop() {   # judge2 의 새 게이트로 채택(옛 grain.py --adopt 그대로) → 멈춤 규칙
  local K="$1"; shift; local ain="$1"; shift
  $PY --adopt --round "$K" --gates "$@" ${ain:+--adopt-in "$ain"} --out "$J2/adopt-R$K.json"
}
stop_rule() {
  local K="$1"; local nb
  nb=$(python3 -c "import json; a=json.load(open('$J2/adopt-R$K.json'))['adopted']; print(a[-1]['arm'] if a else 'C0')")
  $PY --stop --scenes "$SC" --renders "$R" --base "$nb" --ref "$R" --out "$J2/stop-R$K.json"
  python3 -c "import json,sys; d=json.load(open('$J2/stop-R$K.json')); sys.exit(10 if d['stop'] else 0)" \
    || { echo "멈춤 규칙: 새 기준의 제품 단위 80 % 이상이 보이지 않음 — 다음 라운드 전에 사용자에게 묻기" >&2; exit 10; }
}
arms_of() { python3 -c "import json; d=json.load(open('$1')); print(' '.join(a for a in d['roundArms']['$2'] if a != 'E2c'))"; }

case "${1:-}" in
  test)
    python3 "$G2D/grain2-test.py" --r1 "$GR" --clip ;;
  aa)
    $PY2 --aa --scenes "$SC" --renders "$R" --cache "$CACHE" --out "$J2/aa-grain2.json" ;;
  rejudge)
    # 옛 자가 이미 그리고 판정한 라운드(K = 1, 2): 옛 게이트(judge/) + 새 G2 하늘·G3 → judge2/
    K="${2:?rejudge K}"; AIN=""; [ "$K" -ge 2 ] && AIN="$J2/adopt-R$((K-1)).json"
    [ -z "$AIN" ] || [ -f "$AIN" ] || { echo "judge2/adopt-R$((K-1)).json 먼저" >&2; exit 2; }
    BASE=$(base_of "$AIN" "$K")
    GATES=()
    for a in $(arms_of "$JD/scenes-grain-R$K.json" "$K"); do
      OB=$(python3 -c "import json; print(json.load(open('$JD/gate-R$K-$a.json'))['base'])")
      [ "$OB" = "$BASE" ] || { echo "옛 게이트의 기준($OB) ≠ 새 사슬의 기준($BASE) — rejudge 대신 round $K 로" >&2; exit 3; }
      new_gate "$JD/gate-R$K-$a.json" "$J2/gate-R$K-$a.json"; GATES+=("$J2/gate-R$K-$a.json")
    done
    adopt_stop "$K" "$AIN" "${GATES[@]}"
    if [ "$K" = "2" ] && python3 -c "import json,sys; sys.exit(0 if 'E2c' in json.load(open('$J2/adopt-R2.json'))['conditionalNext'] else 1)"; then
      select_jobs "$J2/R2c.json" "$JD/jobs-grain-R2.json" set=heldout,hdev,guard,cost,state arm=E2c; render "$J2/R2c.json"
      mkdir -p "$J2/old"; old_gate 2 "$BASE" E2c "$J2/old"
      new_gate "$J2/old/gate-R2-E2c.json" "$J2/gate-R2-E2c.json"; GATES+=("$J2/gate-R2-E2c.json")
      adopt_stop 2 "$AIN" "${GATES[@]}"
    fi
    stop_rule "$K" ;;
  round)
    # 새 사슬의 라운드(K ≥ 3): 옛 round 단계와 같되 채택·잡·판정 파일이 judge2/ 에서
    K="${2:?round K}"; [ "$K" -ge 3 ] || { echo "K = 1, 2 는 rejudge" >&2; exit 2; }
    AIN="$J2/adopt-R$((K-1)).json"; [ -f "$AIN" ] || { echo "$AIN 먼저" >&2; exit 2; }
    node "$GR/make-jobs-grain.mjs" --out "$J2/jobs-grain-R$K.json" --scenes-out "$J2/scenes-grain-R$K.json" --adopt "$AIN" $(calib_args)
    ARMS=$(arms_of "$J2/scenes-grain-R$K.json" "$K"); BASE=$(base_of "$AIN" "$K")
    select_jobs "$J2/R$K.json" "$J2/jobs-grain-R$K.json" set=heldout,hdev,guard,cost,state "arm=$(echo $BASE $ARMS | tr ' ' ',')"
    render "$J2/R$K.json"
    mkdir -p "$J2/old"; GATES=()
    for a in $ARMS; do old_gate "$K" "$BASE" "$a" "$J2/old"; new_gate "$J2/old/gate-R$K-$a.json" "$J2/gate-R$K-$a.json"; GATES+=("$J2/gate-R$K-$a.json"); done
    adopt_stop "$K" "$AIN" "${GATES[@]}"
    stop_rule "$K" ;;
  refreport)
    K="${2:?round K}"; J="$J2/jobs-grain-R$K.json"; [ -f "$J" ] || J="$JD/jobs-grain-R$K.json"
    select_jobs "$J2/refrep-R$K.json" "$J" set=refReport; render "$J2/refrep-R$K.json" ;;
  final)
    SRC="${2:-$J2/adopt-R5.json}"; shift $(( $# > 1 ? 2 : 1 ))
    $PY --adopt --round 6 --final --gates --adopt-in "$SRC" "$@" --out "$J2/adopt-final.json"
    node "$GR/make-jobs-grain.mjs" --out "$J2/jobs-grain-final.json" --scenes-out "$J2/scenes-grain-final.json" --adopt "$J2/adopt-final.json" $(calib_args)
    select_jobs "$J2/final.json" "$J2/jobs-grain-final.json" set=heldout,hdev,guard,cost,state,confirm arm=C0,Bfinal; render "$J2/final.json"
    mkdir -p "$J2/old"
    $PY --ext --scenes "$SC" --renders "$R" --base C0 --cand Bfinal --calib "$JD/calib-grain.json" --adopt-in "$J2/adopt-final.json" \
      ${G0BUNDLE:+--g0bundle "$G0BUNDLE"} --out "$J2/old/ext-final.json"
    $PY --gate --scenes "$SC" --renders "$R" --base C0 --cand Bfinal --round 6 --ref "$R" --calib "$JD/calib-grain.json" \
      --external "$J2/old/ext-final.json" --c0 C0 --cumcap "$CUMCAP" --adopt-in "$J2/adopt-final.json" --out "$J2/old/gate-final.json"
    new_gate "$J2/old/gate-final.json" "$J2/gate-final.json"
    $PY --confirm --scenes "$SC" --renders "$R" --base C0 --cand Bfinal --adopt-in "$J2/adopt-final.json" --calib "$JD/calib-grain.json" --out "$J2/confirm.json" ;;
  eye)
    J="$J2/jobs-grain-final.json"; [ -f "$J" ] || J="$GR/jobs-grain.json"
    select_jobs "$J2/eye.json" "$J" set=eye; render "$J2/eye.json" ;;
  *)
    sed -n '2,5p' "$0"; exit 2 ;;
esac
