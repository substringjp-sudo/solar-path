#!/usr/bin/env bash
# eval-grain2.sh — RULER-grain2 판정 진행(옛 RULER-grain 의 렌더·판정 코드를 그대로 쓰고 G2 하늘·G3 만 grain2.py 로 다시 매김).
#   tools/genus-ruler/grain2/eval-grain2.sh test | photos | aa | freeze | rejudge K | round K | final [ADOPT [--drop-last|--add ARM]] | refreport K | eye
# 순서(RULER-grain2 §5): test → photos → aa(동결 전 검증) → freeze(받아들임이면 동결 파일을 만듦) → [동결 커밋] → rejudge 1 → rejudge 2 → round 3 … 5 → final → eye
# 환경: OUT(기본 .harness/volsky-grain/out) · CUMCAP(기본 1.40) · G0BUNDLE(기본 $OUT/judge/g0-bundle.json). 판정 JSON 은 $OUT/judge2 에 쓰고 손으로 고치지 않습니다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GR="$ROOT/tools/genus-ruler/grain"; G2D="$ROOT/tools/genus-ruler/grain2"
OUT="${OUT:-$ROOT/.harness/volsky-grain/out}"
R="$OUT/r"; JD="$OUT/judge"; J2="$OUT/judge2"
CUMCAP="${CUMCAP:-1.40}"; DEVH=2340
G0BUNDLE="${G0BUNDLE:-$JD/g0-bundle.json}"
mkdir -p "$J2"; cd "$ROOT"
PY="python3 $GR/grain.py"; CACHE="$J2/clip-cache.json"
PIN="taskset -c ${CLIP_CPU:-3}"   # CLIP 점수는 늘 한 코어에서(스레드 수가 결과에 닿지 않게; clipCfg 에 affinity 기록)
PY2="$PIN python3 $G2D/grain2.py"
SC="$GR/scenes-grain.json"
FROZEN="$G2D/FROZEN.json"

guard_concurrent() {   # 옛 것 + 다른 grain 렌더(대기 표 생성이 준비 한도를 넘음)
  if [ "${FORCE:-0}" != "1" ] && pgrep -f '^node .*genus-ruler/(volsky/run|grain/run-grain)\.js' >/dev/null; then
    echo "다른 하네스 렌더가 돌고 있음 — 동시에 돌리지 않음. FORCE=1 로 무시." >&2; exit 2
  fi
}
render() {   # 옛 eval-grain.sh 의 render 와 같음(두 캔버스, 60 분 덩어리, 3 = 남음, 그 밖의 0 아닌 코드는 멈춤)
  local jobs="$1"; guard_concurrent
  for canvas in "390 584" "1080 $DEVH"; do
    while true; do
      set +e; node "$GR/run-grain.js" --atmos gen --max-min 60 "$jobs" "$R" $canvas; rc=$?; set -e
      [ $rc -eq 3 ] && continue
      [ $rc -eq 0 ] && break
      echo "run-grain 종료 코드 $rc ($jobs, $canvas) — <잡>/error.txt 를 확인하고 다시 부르면 이어 그림" >&2; exit $rc
    done
  done
  node -e '
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const [jobsF, R, bundle] = process.argv.slice(1);
let J = JSON.parse(fs.readFileSync(jobsF, "utf8")); J = J.jobs || J;
const B = crypto.createHash("sha256").update(fs.readFileSync(bundle)).digest("hex");
const bad = [];
for (const j of J) {
  const m = path.join(R, j.name, "meta.json");
  if (!fs.existsSync(m)) { bad.push(j.name + ":없음"); continue; }
  const mm = JSON.parse(fs.readFileSync(m, "utf8"));
  if (mm.jobSha256 !== crypto.createHash("sha256").update(JSON.stringify(j)).digest("hex")) bad.push(j.name + ":잡");
  else if (mm.bundleSha256 !== B) bad.push(j.name + ":번들");
  else if (mm.mode === "capture" && !mm.captureOk) bad.push(j.name + ":captureOk");
}
if (bad.length) { console.error("렌더 빠짐·어긋남 " + bad.length + ": " + bad.slice(0, 5).join(" ")); process.exit(5); }
' "$jobs" "$R" "$ROOT/.harness/volsky-grain/app.js"
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
require_frozen() {   # 동결 커밋 그대로인지(이 자·옛 자·런타임 해시, HEAD 에 있음, 작업 트리 깨끗) — 아니면 판정하지 않음
  git cat-file -e "HEAD:tools/genus-ruler/grain2/FROZEN.json" 2>/dev/null || { echo "FROZEN.json 이 HEAD 에 없음 — 동결 커밋 전에는 판정하지 않음" >&2; exit 6; }
  [ -z "$(git status --porcelain --untracked-files=all -- "$G2D")" ] || { echo "grain2/ 에 커밋 안 된 변경·새 파일 — 판정하지 않음" >&2; exit 6; }
  $PIN python3 - "$FROZEN" "$ROOT" "$JD" "$G0BUNDLE" <<'EOF'
import json, hashlib, os, sys
F, ROOT, JD, G0B = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], sys.argv[4]
h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest() if os.path.exists(p) else None  # noqa: E731
GR2 = os.path.join(ROOT, 'tools/genus-ruler')
want = {'grain2.py', 'grain2-test.py', 'grain2-photos.py', 'eval-grain2.sh', 'make-jobs-aa.py', 'aa-jobs.json', 'run-aa.sh', 'chain-r2.sh',
        'g3-near.json', 'aa-grain2-report.json', 'grain2-photos.json', 'grain2-test.txt', 'RULER-grain2.md'}
bad = [] if set(F['files']) == want else ['files 목록']
bad += [n for n, v in F['files'].items() if h(os.path.join(GR2, 'grain2', n)) != v and n != 'RULER-grain2.md']
bad += [n for n, v in F['old'].items() if h(os.path.join(GR2, n)) != v]
rt = {'app.js': os.path.join(ROOT, '.harness/volsky-grain/app.js'), 'judge/calib-grain.json': os.path.join(JD, 'calib-grain.json'), 'g0bundle': G0B}
bad += [n for n, p in rt.items() if h(p) != F['runtime'][n]]
sys.path.insert(0, os.path.join(GR2, 'grain2'))
import grain2  # noqa: E402
if grain2.clip_cfg()[0] != F['clipCfg']:
    bad.append('clipCfg')
import scipy  # noqa: E402
if scipy.__version__ != F['versions']['scipy']:
    bad.append('scipy')
if bad:
    print('동결과 다름: %s' % bad, file=sys.stderr); sys.exit(6)
EOF
}
old_gate() {     # 옛 가드 그대로(기록) — 옛 eval-grain.sh 의 gate_arm 과 같은 인자
  local K="$1" base="$2" arm="$3" pre="$4"
  $PY --ext --scenes "$SC" --renders "$R" --base "$base" --cand "$arm" --calib "$JD/calib-grain.json" \
    --g0bundle "$G0BUNDLE" --out "$pre/ext-R$K-$arm.json"
  $PY --gate --scenes "$SC" --renders "$R" --base "$base" --cand "$arm" --round "$K" --ref "$R" \
    --calib "$JD/calib-grain.json" --external "$pre/ext-R$K-$arm.json" --c0 C0 --cumcap "$CUMCAP" --out "$pre/gate-R$K-$arm.json"
}
new_gate() { $PY2 --rejudge --old "$1" --scenes "$SC" --renders "$R" --cache "$CACHE" --out "$2"; }
stamp() {        # grain.py 가 쓴 채택 파일에 이 자의 이름·해시를 덧붙임(스크립트가 씀, 손으로 안 고침)
  python3 - "$1" "$G2D/grain2.py" <<'EOF'
import json, hashlib, sys
p = sys.argv[1]; d = json.load(open(p))
d['ruler2'] = 'RULER-grain2'; d['grain2Sha256'] = hashlib.sha256(open(sys.argv[2], 'rb').read()).hexdigest()
json.dump(d, open(p, 'w'), indent=1)
EOF
}
adopt_k() {      # judge2 의 새 게이트로 채택(옛 grain.py --adopt 그대로)
  local K="$1"; shift; local ain="$1"; shift
  [ "$#" -gt 0 ] || { echo "게이트 없음 — 채택하지 않음" >&2; exit 2; }
  $PY --adopt --round "$K" --gates "$@" ${ain:+--adopt-in "$ain"} --out "$J2/adopt-R$K.json"; stamp "$J2/adopt-R$K.json"
}
stop_rule() {    # 옛 멈춤 규칙(§5.4) — 걸리면 종료 코드 10(다음 라운드 전에 사용자에게 묻기)
  local K="$1"; local nb
  nb=$(python3 -c "import json; a=json.load(open('$J2/adopt-R$K.json'))['adopted']; print(a[-1]['arm'] if a else 'C0')")
  $PY --stop --scenes "$SC" --renders "$R" --base "$nb" --ref "$R" --out "$J2/stop-R$K.json"
  python3 -c "import json,sys; d=json.load(open('$J2/stop-R$K.json')); sys.exit(10 if d['stop'] else 0)" \
    || { echo "멈춤 규칙: 새 기준의 제품 단위 80 % 이상이 보이지 않음 — 다음 라운드 전에 사용자에게 묻기" >&2; exit 10; }
}
prev_ok() {      # 앞 라운드가 judge2 에서 끝났고(채택·멈춤 파일) 멈춤 규칙에 안 걸림
  local K="$1"
  [ -f "$J2/adopt-R$((K-1)).json" ] && [ -f "$J2/stop-R$((K-1)).json" ] || { echo "judge2 의 R$((K-1)) 이 아직 안 끝남" >&2; exit 2; }
  python3 -c "import json,sys; sys.exit(10 if json.load(open('$J2/stop-R$((K-1)).json'))['stop'] else 0)" || { echo "R$((K-1)) 멈춤 규칙 — 사용자에게 묻기" >&2; exit 10; }
}
arms_of() { python3 -c "import json; d=json.load(open('$1')); print(' '.join(a for a in d['roundArms']['$2'] if a != 'E2c'))"; }

case "${1:-}" in
  test)
    $PIN python3 "$G2D/grain2-test.py" --r1 "$GR" --clip | tee "$J2/grain2-test.txt" ;;
  photos)
    $PIN python3 "$G2D/grain2-photos.py" --cache "$CACHE" --out "$J2/grain2-photos.json" ;;
  aa)
    ! pgrep -f '^(taskset .*)?python3 .*grain2-photos\.py|^node .*judge/aa-grain2\.json' >/dev/null || { echo "사진 검증 또는 A/A 렌더가 아직 돎" >&2; exit 2; }
    node -e '
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const [jobsF, R] = process.argv.slice(1); const J = JSON.parse(fs.readFileSync(jobsF, "utf8")); const bad = [];
for (const j of J) {
  const m = path.join(R, j.name, "meta.json"); const o = path.join(R, j.name.replace(/__AA[0-9]+$/, ""), "meta.json");
  if (!fs.existsSync(m) || !fs.existsSync(o)) { bad.push(j.name + ":없음"); continue; }
  const mm = JSON.parse(fs.readFileSync(m, "utf8")), oo = JSON.parse(fs.readFileSync(o, "utf8"));
  if (mm.jobSha256 !== crypto.createHash("sha256").update(JSON.stringify(j)).digest("hex")) bad.push(j.name + ":잡");
  if (mm.bundleSha256 !== oo.bundleSha256) bad.push(j.name + ":번들");
  if (!mm.captureOk) bad.push(j.name + ":captureOk");
}
if (bad.length) { console.error("A/A 렌더 빠짐·어긋남 " + bad.length + ": " + bad.slice(0, 5).join(" ")); process.exit(5); }
' "$G2D/aa-jobs.json" "$R"
    GRAIN2_TMP="$J2/ctl" $PY2 --aa --scenes "$SC" --renders "$R" --cache "$CACHE" --out "$J2/aa-grain2-report.json" --near-out "$J2/g3-near.json" ;;
  freeze)
    # 받아들임(§4)이 모두 참이고 보고서들이 지금 코드로 만들어졌으면 동결 파일을 grain2/ 에 만듦 — 그다음 커밋(커밋이 동결)
    $PIN python3 - "$J2" "$G2D" "$ROOT" "$JD" "$G0BUNDLE" <<'EOF'
import json, hashlib, os, shutil, sys, glob
J2, D, ROOT, JD, G0B = sys.argv[1:6]
h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()  # noqa: E731
sys.path.insert(0, D)
import grain2  # noqa: E402
rep = json.load(open(os.path.join(J2, 'aa-grain2-report.json')))
ph = json.load(open(os.path.join(J2, 'grain2-photos.json')))
near = json.load(open(os.path.join(J2, 'g3-near.json')))
t = json.loads(open(os.path.join(J2, 'grain2-test.txt')).read().strip().splitlines()[-1])
cur = grain2.provenance()
checks = {'aaAccept': bool(rep['accept']['all'] and grain2.aa_accept(rep) == rep['accept']), 'photos': ph['accept'] is True,
          'test': t['fail'] == 0 and t['clip'] is True and t['r1'] is True,
          'provAA': rep.get('provenance') == cur, 'provPhotos': ph.get('provenance') == cur, 'provTest': t.get('provenance') == cur,
          'near': near['clipCfg'] == cur['clipCfg'] and near['near'] == rep['g3']['near']}
print('freeze checks', checks)
if not all(checks.values()):
    print('받아들임 아님 또는 보고서가 지금 코드와 다름 — 동결하지 않고 사용자에게 보고', file=sys.stderr); sys.exit(7)
import scipy, numpy, PIL, onnxruntime  # noqa: E401,E402
src = {n: os.path.join(J2, n) for n in ('aa-grain2-report.json', 'g3-near.json', 'grain2-photos.json', 'grain2-test.txt')}
files = ['grain2.py', 'grain2-test.py', 'grain2-photos.py', 'eval-grain2.sh', 'make-jobs-aa.py', 'aa-jobs.json', 'run-aa.sh', 'chain-r2.sh', 'RULER-grain2.md']
F = {'files': {**{n: h(os.path.join(D, n)) for n in files}, **{n: h(p) for n, p in src.items()}},
     'old': {n: h(os.path.join(D, '..', n)) for n in ('grain/grain.py', 'grain/eval-grain.sh', 'grain/scenes-grain.json', 'grain/make-jobs-grain.mjs',
             'grain/run-grain.js', 'grain/calib-grain.json', 'grain/g0-bundle.json', 'flow/fm.py', 'clip/judge2.py', 'clip/prompts2.json',
             'clip/tokenizer.json', 'clip/vision_model_quantized.onnx', 'clip/text_model_quantized.onnx')},
     'runtime': {'app.js': h(os.path.join(ROOT, '.harness/volsky-grain/app.js')), 'judge/calib-grain.json': h(os.path.join(JD, 'calib-grain.json')), 'g0bundle': h(G0B)},
     'versions': {'scipy': scipy.__version__, 'numpy': numpy.__version__, 'PIL': PIL.__version__, 'onnxruntime': onnxruntime.__version__},
     'clipCfg': cur['clipCfg'], 'near': near['near'],
     'r2JudgeFilesAtFreeze': sorted(os.path.basename(p) for p in glob.glob(os.path.join(JD, '*-R2*')) if os.path.basename(p).split('-')[0] in ('gate', 'ext', 'adopt', 'stop'))}
json.dump(F, open(os.path.join(D, 'FROZEN.json.tmp'), 'w'), indent=1)
for n, p in src.items():
    shutil.copy(p, os.path.join(D, n))
os.replace(os.path.join(D, 'FROZEN.json.tmp'), os.path.join(D, 'FROZEN.json'))
print('FROZEN.json 씀 — R2 판정 파일(동결 때):', F['r2JudgeFilesAtFreeze'], '— grain2/ 를 커밋하면 동결')
EOF
    ;;
  rejudge)
    # 옛 자가 이미 그리고 판정한 라운드(K = 1, 2): 옛 게이트(judge/) + 새 G2 하늘·G3 → judge2/
    require_frozen
    K="${2:?rejudge K}"; AIN=""; [ "$K" -ge 2 ] && AIN="$J2/adopt-R$((K-1)).json"
    [ -z "$AIN" ] || prev_ok "$K"
    [ -f "$JD/stop-R$K.json" ] || { echo "옛 round $K 이 아직 안 끝남(judge/stop-R$K.json 없음)" >&2; exit 2; }
    ! pgrep -f '^(bash|/bin/bash) .*genus-ruler/grain/eval-grain\.sh|^node .*genus-ruler/grain/run-grain\.js' >/dev/null || { echo "옛 렌더·판정이 아직 돌고 있음" >&2; exit 2; }
    BASE=$(base_of "$AIN" "$K")
    ARMS=$(arms_of "$JD/scenes-grain-R$K.json" "$K"); [ -n "$ARMS" ] || { echo "팔 없음" >&2; exit 2; }
    GATES=()
    for a in $ARMS; do
      OB=$(python3 -c "import json; print(json.load(open('$JD/gate-R$K-$a.json'))['base'])")
      [ "$OB" = "$BASE" ] || { echo "옛 게이트의 기준($OB) ≠ 새 사슬의 기준($BASE) — 멈추고 사용자에게 보고" >&2; exit 3; }
      new_gate "$JD/gate-R$K-$a.json" "$J2/gate-R$K-$a.json"; GATES+=("$J2/gate-R$K-$a.json")
    done
    adopt_k "$K" "$AIN" "${GATES[@]}"
    if [ "$K" = "1" ]; then
      python3 -c "import json,sys; sys.exit(3 if json.load(open('$J2/adopt-R1.json'))['adopted'] else 0)" || { echo "R1 이 새 자로 채택을 냄 — §5: 멈추고 보고" >&2; exit 3; }
    fi
    if [ "$K" = "2" ] && python3 -c "import json,sys; sys.exit(0 if 'E2c' in json.load(open('$J2/adopt-R2.json'))['conditionalNext'] else 1)"; then
      select_jobs "$J2/R2c.json" "$JD/jobs-grain-R2.json" set=heldout,hdev,guard,cost,state arm=E2c; render "$J2/R2c.json"
      mkdir -p "$J2/old"; old_gate 2 "$BASE" E2c "$J2/old"
      new_gate "$J2/old/gate-R2-E2c.json" "$J2/gate-R2-E2c.json"; GATES+=("$J2/gate-R2-E2c.json")
      adopt_k 2 "$AIN" "${GATES[@]}"
    fi
    stop_rule "$K" ;;
  round)
    # 새 사슬의 라운드(K ≥ 3): 옛 round 단계와 같되 채택·잡·판정 파일이 judge2/ 에서
    require_frozen
    K="${2:?round K}"; [ "$K" -ge 3 ] || { echo "K = 1, 2 는 rejudge" >&2; exit 2; }
    AIN="$J2/adopt-R$((K-1)).json"; prev_ok "$K"
    [ -f "$JD/calib-grain.json" ] || { echo "calib-grain.json 없음" >&2; exit 2; }; CA=$(calib_args)
    node "$GR/make-jobs-grain.mjs" --out "$J2/jobs-grain-R$K.json" --scenes-out "$J2/scenes-grain-R$K.json" --adopt "$AIN" $CA
    ARMS=$(arms_of "$J2/scenes-grain-R$K.json" "$K"); [ -n "$ARMS" ] || { echo "팔 없음" >&2; exit 2; }
    BASE=$(base_of "$AIN" "$K")
    select_jobs "$J2/R$K.json" "$J2/jobs-grain-R$K.json" set=heldout,hdev,guard,cost,state "arm=$(echo $BASE $ARMS | tr ' ' ',')"
    render "$J2/R$K.json"
    mkdir -p "$J2/old"; GATES=()
    for a in $ARMS; do old_gate "$K" "$BASE" "$a" "$J2/old"; new_gate "$J2/old/gate-R$K-$a.json" "$J2/gate-R$K-$a.json"; GATES+=("$J2/gate-R$K-$a.json"); done
    adopt_k "$K" "$AIN" "${GATES[@]}"
    stop_rule "$K" ;;
  refreport)
    K="${2:?round K}"; J="$J2/jobs-grain-R$K.json"; [ -f "$J" ] || J="$JD/jobs-grain-R$K.json"
    select_jobs "$J2/refrep-R$K.json" "$J" set=refReport; render "$J2/refrep-R$K.json" ;;
  final)
    require_frozen
    SRC="${2:-$J2/adopt-R5.json}"; shift $(( $# > 1 ? 2 : 1 ))
    $PY --adopt --round 6 --final --gates --adopt-in "$SRC" "$@" --out "$J2/adopt-final.json"; stamp "$J2/adopt-final.json"
    [ -f "$JD/calib-grain.json" ] || { echo "calib-grain.json 없음" >&2; exit 2; }; CA=$(calib_args)
    node "$GR/make-jobs-grain.mjs" --out "$J2/jobs-grain-final.json" --scenes-out "$J2/scenes-grain-final.json" --adopt "$J2/adopt-final.json" $CA
    select_jobs "$J2/final.json" "$J2/jobs-grain-final.json" set=heldout,hdev,guard,cost,state,confirm arm=C0,Bfinal; render "$J2/final.json"
    mkdir -p "$J2/old"
    $PY --ext --scenes "$SC" --renders "$R" --base C0 --cand Bfinal --calib "$JD/calib-grain.json" --adopt-in "$J2/adopt-final.json" \
      --g0bundle "$G0BUNDLE" --out "$J2/old/ext-final.json"
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
