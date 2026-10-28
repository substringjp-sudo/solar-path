#!/usr/bin/env bash
# eval-grain.sh — RULER-grain 끝까지(동결 대상). 렌더(run-grain.js, 덩어리 ≤ 60 분·이어 그리기) → 지표 → 판정 → 채택.
#   tools/genus-ruler/grain/eval-grain.sh build | test | calibrate | g0 OLD_BUNDLE_DIR | c0 | round K | refreport K | final | eye
# 환경: OUT(렌더·판정 폴더, 기본 .harness/volsky-grain/out) · CUMCAP(누적 비용 상한, 기본 1.40 — §5.5 기기 frameMs 식) · FORCE=1(다른 하네스와 동시 실행 허용 안 함을 무시)
# 순서(§5.3): build → test → calibrate(개발 집합만) → [§11 커밋] → 손잡이 구현(§8.2) → g0(§12 커밋) → c0(멈춤 규칙) → round 1 … round 5
#             → final(확인 집합 Q 포함) → eye.
# 판정 JSON(gate-*·adopt-*·stop-*·confirm-*)은 이 스크립트가 만들고 손으로 고치지 않습니다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GR="$ROOT/tools/genus-ruler/grain"
OUT="${OUT:-$ROOT/.harness/volsky-grain/out}"
R="$OUT/r"            # 모든 렌더(C0·후보·기준·비용·상태) — grain.py 가 이름으로 찾음
JD="$OUT/judge"       # 판정 JSON·라운드 잡 목록
CUMCAP="${CUMCAP:-1.40}"
DEVH=2340
mkdir -p "$R" "$JD"
cd "$ROOT"
PY="python3 $GR/grain.py"

guard_concurrent() {
  if [ "${FORCE:-0}" != "1" ] && pgrep -f 'genus-ruler/volsky/run.js' >/dev/null; then
    echo "다른 하네스(volsky/run.js)가 돌고 있음 — 시간·결정성 때문에 동시에 돌리지 않음(§4.5). FORCE=1 로 무시." >&2; exit 2
  fi
}

# render JOBS.json — 두 캔버스(390×584, 1080×DEVH) 차례로, 덩어리 60 분씩 끝날 때까지(종료 코드 3 = 남음)
render() {
  local jobs="$1"
  guard_concurrent
  for canvas in "390 584" "1080 $DEVH"; do
    while true; do
      set +e; node "$GR/run-grain.js" --atmos gen --max-min 60 "$jobs" "$R" $canvas; rc=$?; set -e
      [ $rc -eq 3 ] && continue
      [ $rc -eq 0 ] && break
      echo "run-grain 종료 코드 $rc ($jobs, $canvas) — <잡>/error.txt 를 확인하고 다시 부르면 이어 그림" >&2; exit $rc
    done
  done
}

select_jobs() {   # select OUTFILE JOBS key=val ...
  local out="$1" jobs="$2"; shift 2
  $PY --select "$jobs" "$@" --order unit --out "$out"
}

calib_args() {    # calib-grain.json → make-jobs 인자(미리 정한 사다리만)
  python3 - "$JD/calib-grain.json" <<'EOF'
import json, sys
c = json.load(open(sys.argv[1]))
a = []
if c.get('refSs') in (2, 4): a += ['--ref-ss', str(c['refSs'])]
if (c.get('P2') or {}).get('use5m'): a += ['--ref-step', '5']
if c.get('warmHigh') in (16, 64): a += ['--warm-high', str(c['warmHigh'])]
if c.get('bkReuse') is False: a += ['--rerender-base']
print(' '.join(a))
EOF
}

case "${1:-}" in
  build)
    # 동결 명령(§10): 깨끗한 작업 트리의 커밋에서
    npx esbuild tools/genus-ruler/volsky/entry.ts --bundle --format=esm --outfile=.harness/volsky-grain/app.js \
      --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"' --log-level=warning
    sha256sum .harness/volsky-grain/app.js
    git status --porcelain -- src tools/genus-ruler/volsky tools/genus-ruler/grain | head ;;
  test)
    node --experimental-strip-types --no-warnings "$GR/capture-test.mjs"
    python3 "$GR/grain-test.py" --out "$JD/grain-test.json" ;;
  g0)
    # §12 손잡이 구현 뒤·판정 렌더 전: 측정 번들(동결, 폴더 $2 의 app.js)과 손잡이 번들(.harness/volsky-grain/app.js)로 같은 잡을 그려 비교.
    OLD="${2:?측정 번들 폴더(app.js)}"; J="$GR/jobs-grain.json"
    select_jobs "$JD/g0.json" "$J" set=g0state,g0cap
    guard_concurrent
    node "$GR/run-grain.js" --root "$OLD" --atmos gen "$JD/g0.json" "$OUT/g0a" 390 584
    node "$GR/run-grain.js" --atmos gen "$JD/g0.json" "$OUT/g0b" 390 584
    $PY --g0 --a "$OUT/g0a" --b "$OUT/g0b" --out "$JD/g0-bundle.json"
    echo "G0BUNDLE=$JD/g0-bundle.json 로 round 를 부름(손잡이 팔의 G0 에 들어감)" ;;
  calibrate)
    # 탐침(§8.3) — 개발 집합(시드 4242)·C0·기준만 지표. 후보는 상태 해시만. P3 는 한 페이지(따로), P8B 는 다른 페이지(따로).
    J="$GR/jobs-grain.json"
    select_jobs "$JD/p3.json" "$J" set=probe3;   guard_concurrent; node "$GR/run-grain.js" --atmos gen "$JD/p3.json" "$R" 390 584
    select_jobs "$JD/p.json" "$J" set=probe; render "$JD/p.json"
    select_jobs "$JD/pb.json" "$J" set=probeB;   render "$JD/pb.json"
    select_jobs "$JD/pd.json" "$J" set=probeDev; render "$JD/pd.json"
    $PY --calibrate --scenes "$GR/scenes-grain.json" --renders "$R" --out "$JD/calib-grain.json"
    node "$GR/make-jobs-grain.mjs" --out "$JD/jobs-grain-cal.json" --scenes-out "$JD/scenes-grain-cal.json" $(calib_args)
    echo "보정 끝 — calib-grain.json 의 숫자를 RULER-grain §11 에 적고 커밋한 뒤 c0." ;;
  c0)
    J="$JD/jobs-grain-cal.json"; [ -f "$J" ] || { echo "calibrate 먼저" >&2; exit 2; }
    select_jobs "$JD/c0.json" "$J" set=heldout,hdev,guard,cost,state arm=C0; render "$JD/c0.json"
    select_jobs "$JD/ref.json" "$J" set=ref arm=C0; render "$JD/ref.json"
    $PY --stop --scenes "$GR/scenes-grain.json" --renders "$R" --base C0 --ref "$R" --out "$JD/stop-C0.json"
    python3 -c "import json,sys; d=json.load(open('$JD/stop-C0.json')); sys.exit(10 if d['stop'] else 0)" \
      || { echo "멈춤 규칙: C0 제품 단위의 80 % 이상이 보이지 않음 — R1 전에 사용자에게 묻기(새 기기 캡처와 함께)" >&2; exit 10; } ;;
  round)
    K="${2:?round K}"
    ADOPT_IN=""; [ "$K" -ge 2 ] && ADOPT_IN="$JD/adopt-R$((K-1)).json"
    node "$GR/make-jobs-grain.mjs" --out "$JD/jobs-grain-R$K.json" --scenes-out "$JD/scenes-grain-R$K.json" ${ADOPT_IN:+--adopt "$ADOPT_IN"} $(calib_args)
    ARMS=$(python3 -c "import json; d=json.load(open('$JD/scenes-grain-R$K.json')); print(' '.join(a for a in d['roundArms']['$K'] if a != 'E2c'))")
    BASE=$(python3 - "$ADOPT_IN" "$K" <<'EOF'
import json, sys
p, k = sys.argv[1], int(sys.argv[2])
if not p: print('C0'); sys.exit()
ad = json.load(open(p))['adopted']
import os
rer = os.path.exists(os.path.join(os.path.dirname(p), 'calib-grain.json')) and json.load(open(os.path.join(os.path.dirname(p), 'calib-grain.json'))).get('bkReuse') is False
print(('B%d' % (k - 1)) if (ad and rer) else (ad[-1]['arm'] if ad else 'C0'))
EOF
)
    select_jobs "$JD/R$K.json" "$JD/jobs-grain-R$K.json" set=heldout,hdev,guard,cost,state "arm=$(echo $BASE $ARMS | tr ' ' ',')"
    render "$JD/R$K.json"
    gate_arm() {
      local arm="$1"
      $PY --ext --scenes "$GR/scenes-grain.json" --renders "$R" --base "$BASE" --cand "$arm" --calib "$JD/calib-grain.json" \
        ${G0BUNDLE:+--g0bundle "$G0BUNDLE"} --out "$JD/ext-R$K-$arm.json"
      $PY --gate --scenes "$GR/scenes-grain.json" --renders "$R" --base "$BASE" --cand "$arm" --round "$K" --ref "$R" \
        --calib "$JD/calib-grain.json" --external "$JD/ext-R$K-$arm.json" --c0 C0 --cumcap "$CUMCAP" --out "$JD/gate-R$K-$arm.json"
    }
    GATES=()
    for a in $ARMS; do gate_arm "$a"; GATES+=("$JD/gate-R$K-$a.json"); done
    $PY --adopt --round "$K" --gates "${GATES[@]}" ${ADOPT_IN:+--adopt-in "$ADOPT_IN"} --out "$JD/adopt-R$K.json"
    if [ "$K" = "2" ] && python3 -c "import json,sys; sys.exit(0 if 'E2c' in json.load(open('$JD/adopt-R2.json'))['conditionalNext'] else 1)"; then
      select_jobs "$JD/R2c.json" "$JD/jobs-grain-R$K.json" set=heldout,hdev,guard,cost,state arm=E2c; render "$JD/R2c.json"
      gate_arm E2c; GATES+=("$JD/gate-R2-E2c.json")
      $PY --adopt --round 2 --gates "${GATES[@]}" ${ADOPT_IN:+--adopt-in "$ADOPT_IN"} --out "$JD/adopt-R2.json"
    fi
    NEWBASE=$(python3 -c "import json; a=json.load(open('$JD/adopt-R$K.json'))['adopted']; print(a[-1]['arm'] if a else 'C0')")
    $PY --stop --scenes "$GR/scenes-grain.json" --renders "$R" --base "$NEWBASE" --ref "$R" --out "$JD/stop-R$K.json" ;;
  refreport)
    K="${2:?round K}"
    select_jobs "$JD/refrep-R$K.json" "$JD/jobs-grain-R$K.json" set=refReport; render "$JD/refrep-R$K.json" ;;
  final)
    $PY --adopt --round 6 --final --gates --adopt-in "$JD/adopt-R5.json" --out "$JD/adopt-final.json"
    node "$GR/make-jobs-grain.mjs" --out "$JD/jobs-grain-final.json" --scenes-out "$JD/scenes-grain-final.json" --adopt "$JD/adopt-final.json" $(calib_args)
    select_jobs "$JD/final.json" "$JD/jobs-grain-final.json" set=heldout,hdev,guard,cost,state,confirm arm=C0,Bfinal; render "$JD/final.json"
    $PY --ext --scenes "$GR/scenes-grain.json" --renders "$R" --base C0 --cand Bfinal --calib "$JD/calib-grain.json" --out "$JD/ext-final.json"
    $PY --gate --scenes "$GR/scenes-grain.json" --renders "$R" --base C0 --cand Bfinal --round 6 --ref "$R" --calib "$JD/calib-grain.json" \
      --external "$JD/ext-final.json" --c0 C0 --cumcap "$CUMCAP" --adopt-in "$JD/adopt-final.json" --out "$JD/gate-final.json"
    $PY --confirm --scenes "$GR/scenes-grain.json" --renders "$R" --base C0 --cand Bfinal --adopt-in "$JD/adopt-final.json" --calib "$JD/calib-grain.json" --out "$JD/confirm.json" ;;
  eye)
    J="$JD/jobs-grain-final.json"; [ -f "$J" ] || J="$GR/jobs-grain.json"
    select_jobs "$JD/eye.json" "$J" set=eye; render "$JD/eye.json" ;;
  *)
    sed -n '2,6p' "$0"; exit 2 ;;
esac
