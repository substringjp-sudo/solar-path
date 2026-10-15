#!/usr/bin/env bash
# eval-phys3.sh — RULER-physics3(§138) 판정을 한 번에. 렌더 폴더 = volsky 출력(<후보>_<장면>_<방위>.png + .alpha.png).
#   bash tools/genus-ruler/flow/eval-phys3.sh <held-out 렌더 폴더>
# 후보: L0(기준) L1 L2 L3. 판정 규칙·문턱은 RULER-physics3.md, 코드는 phys3.py(RC·G4)·phys2.py(R1·R2·R3c, 고정)·clip-labels.py(G1')·twilight-hue.py(G2).
set -euo pipefail
D=$(cd "$1" && pwd)
H=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$H/../../.." && pwd)
cd "$H"
echo "=== phys3.py 해시 확인 ==="
python3 - <<PY
import json, hashlib
q = json.load(open('phys3-photo-quartiles.json'))
h = hashlib.sha256(open('phys3.py', 'rb').read()).hexdigest()
print('phys3.py', h[:16], '사분위 파일에 적힌', q['phys3Sha256'][:16], '일치' if h == q['phys3Sha256'] else '⚠ 불일치 — 규칙 고정 뒤 phys3.py 가 바뀜')
PY
echo; echo "=== RC 그늘 색 · G4 면적 (phys3) ==="
python3 -I phys3.py --renders "$D" --out "$D/phys3-renders.json" --glob '*_*_[0-9]*.png' | tail -1
python3 -I phys3.py --gate phys3-photo-quartiles.json "$D/phys3-renders.json" --ref L0 --cands L1,L2,L3 --out "$D/phys3-gate.json" | grep -v '^wrote'
echo; echo "=== R1·R2·R3c (phys2, §137 과 같은 규칙; 폭 320 = 판정, 260·208 = 보고) ==="
for w in 320 260 208; do
  python3 phys2.py --renders "$D" --out "$D/phys2-renders-w$w.json" --glob '*_*_[0-9]*.png' --width $w | tail -1
done
for w in 320 260 208; do
  echo "--- 폭 $w"; python3 phys2.py --gate phys2-photo-quartiles.json "$D/phys2-renders-w$w.json" --ref L0 --cands L1,L2,L3 --out "$D/phys2-gate-w$w.json" | grep -v '^wrote'
done
echo; echo "=== R1 밝기비·어두움비 따로(장면별, 폭 320) ==="
python3 - "$D/phys2-renders-w320.json" <<'PY'
import json, sys
R = json.load(open(sys.argv[1]))['renders']
for sc in ['cu', 'ac', 'ci', 'sc25', 'sc85']:
    for k in ['brightRatio', 'darkRatio']:
        row = []
        for c in ['L0', 'L1', 'L2', 'L3']:
            v = R.get(c, {}).get(sc, {}).get('az', {})
            row.append(c + ':' + ' '.join('%.2f' % v[a][k] if isinstance(v[a].get(k), (int, float)) else 'nan' for a in sorted(v)))
        print('%-5s %-12s' % (sc, k), ' | '.join(row))
PY
echo; echo "=== G1' CLIP 라벨: AcCc(ac) · Ci(ci), 방위 35,190,320 ==="
for c in L0 L1 L2 L3; do
  [ -f "$D/${c}_ac_35.png" ] && python3 clip-labels.py AcCc "$D/${c}_ac_{az}.png" 35,190,320 | sed "s/^/$c /" || true
  [ -f "$D/${c}_ci_35.png" ] && python3 clip-labels.py Ci "$D/${c}_ci_{az}.png" 35,190,320 | sed "s/^/$c /" || true
done 2>/dev/null
echo; echo "=== G2 박명(twilight-hue --horizon): 자주 ≤ 0.10 · 푸른 ≥ 0.10 · L q50 이 L0 의 0.5~2.0 배 ==="
for s in tw1734 tw1746; do for c in L0 L1 L2 L3; do [ -f "$D/${c}_${s}_0.png" ] && python3 "$ROOT/tools/genus-ruler/genus/twilight-hue.py" --horizon "$D/${c}_${s}_0.png"; done; done
