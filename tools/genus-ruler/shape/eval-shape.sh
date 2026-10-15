#!/usr/bin/env bash
# eval-shape.sh — RULER-shape(§139) 판정을 한 번에. 렌더 폴더 = volsky 출력(<후보>_<장면>_<방위>.png + .alpha.png).
#   bash tools/genus-ruler/shape/eval-shape.sh <held-out 렌더 폴더>
# 후보: K0(보고) K0h(기준) K1 K2, 영가설 K0hn7171·K0hn8181. 규칙·문턱은 RULER-shape.md §4, 코드는 shape.py(S·P·G4), clip-labels.py(G1).
set -euo pipefail
D=$(cd "$1" && pwd)
H=$(cd "$(dirname "$0")" && pwd)
cd "$H"
echo "=== shape.py 해시 확인 ==="
python3 - <<PY
import json, hashlib
q = json.load(open('shape-photo-quartiles.json'))
h = hashlib.sha256(open('shape.py', 'rb').read()).hexdigest()
print('shape.py', h[:16], '사분위 파일에 적힌', q['shapeSha256'][:16], '일치' if h == q['shapeSha256'] else '⚠ 불일치 — 규칙 고정 뒤 shape.py 가 바뀜')
PY
echo; echo "=== 렌더 지표 ==="
python3 -I shape.py --renders "$D" --out "$D/shape-renders.json" --glob '*_*_[0-9]*.png' | tail -1
echo; echo "=== S(K1·K2 vs K0h, 영가설 여유·세 벌·뷰 부트스트랩) · P · G4 — K0 는 보고 ==="
python3 -I shape.py --gate shape-photo-quartiles.json "$D/shape-renders.json" --ref K0h --cands K1,K2,K3 --null K0hn7171,K0hn8181 --also K0 --out "$D/shape-gate.json" | grep -v '^wrote'
echo; echo "=== G1 CLIP 라벨: cu25·cu50(Cu 수) · sc85(층 묶음 수), 방위 35,300 ==="
for c in K0 K0h K1 K2 K3; do
  for sc in cu25s5151 cu50s5151 sc85s5151; do
    echo -n "$c $sc: "; python3 ../flow/clip-labels.py "$D" "${c}_${sc}_" 35,300 2>/dev/null | tail -1 || echo '(clip 없음)'
  done
done
echo; echo "=== G5 프레임 시간(K2 ≤ 1.3 × K1): results.json 의 ms 중앙값 ==="
python3 - "$D" <<'PY'
import json, sys, os, statistics
p = os.path.join(sys.argv[1], 'results.json')
if os.path.exists(p):
    R = json.load(open(p))
    for c in ["K0", "K0h", "K1", "K2", "K3"]:
        ms = [v['ms'] for k, v in R.items() if k.startswith(c + '_') and isinstance(v, dict) and isinstance(v.get('ms'), (int, float)) and v['ms'] > 1]
        print(c, 'n', len(ms), 'median ms', round(statistics.median(ms), 1) if ms else 'nan')
else:
    print('results.json 없음')
PY
