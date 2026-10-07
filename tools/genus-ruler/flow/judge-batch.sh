#!/usr/bin/env bash
# judge-batch.sh — RULER-flow 의 측면 자·가드를 한 번에(§130).
#   bash tools/genus-ruler/flow/judge-batch.sh <렌더 폴더> <후보 C1|C2|C3> [C0 기준 renders.json]
# 하는 일: fm.py --renders(측면 지표) → --gate(○/× 표, 불만 군별 실패 수, --ref 로 C0 대비) · CLIP J1(ruler2.py, Cu/Ac/Ci/Sc)
#   · cu 밝기비(skyratio.js, 위 78 %) · 박명 색(twilight-hue.py, 있으면). 결과는 <폴더>/judge-<후보>.txt 와 renders-<후보>.json.
set -u
DIR=${1:?render dir}; C=${2:?candidate}; REF=${3:-}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); F=$ROOT/tools/genus-ruler/flow; OUT=$DIR/judge-$C.txt
{
  echo "== $C  ($DIR)  $(date -u +%FT%TZ)"
  python3 $F/fm.py --renders "$DIR" --out "$DIR/renders-$C.json" --glob "${C}_*_*.png" | grep -v '^skip' | tail -n +1 >/dev/null
  if [ -n "$REF" ]; then python3 $F/fm.py --gate $F/photo-flow-quartiles.json "$DIR/renders-$C.json" --ref "$REF" --out "$DIR/gate-$C.json";
  else python3 $F/fm.py --gate $F/photo-flow-quartiles.json "$DIR/renders-$C.json" --out "$DIR/gate-$C.json"; fi
  echo; echo "== CLIP J1 (ruler2.py)"
  ( cd $ROOT/tools/genus-ruler/clip && python3 ruler2.py "Cu=$DIR/${C}_cu_{az}.png" "AcCc=$DIR/${C}_ac_{az}.png" "Ci=$DIR/${C}_ci_{az}.png" "Sc=$DIR/${C}_sc85_{az}.png" "Sc=$DIR/${C}_sc25_{az}.png" 2>/dev/null )
  echo; echo "== cu P(Cu) 4종 판정기(가드 ≥ 0.83, RULER-cu-ao)"
  ( cd $ROOT/tools/genus-ruler/clip && python3 ruler.py "Cu=$DIR/${C}_cu_{az}.png" 2>/dev/null | tail -1 )
  echo; echo "== cu 밝은 쪽/하늘 · 어두운 쪽/하늘 · 포화(위 78 %)  [가드 2.47~6.70 · 1.02~2.61]"
  node $ROOT/tools/genus-ruler/genus/skyratio.js "$DIR/${C}_cu_200.png" "$DIR/${C}_cu_110.png" "$DIR/${C}_cu_20.png" 2>/dev/null
  if ls "$DIR"/${C}_tw*.png >/dev/null 2>&1; then
    echo; echo "== 박명 자주·푸른 비율(가드: 자주 ≤ 0.10, 푸른 ≥ 0.10)"
    for f in "$DIR"/${C}_tw*.png; do case "$f" in *.alpha.png) continue;; esac; echo -n "$(basename $f) "; python3 $ROOT/tools/genus-ruler/genus/twilight-hue.py --horizon "$f" 2>/dev/null | tail -1; done
  fi
} | tee "$OUT"
