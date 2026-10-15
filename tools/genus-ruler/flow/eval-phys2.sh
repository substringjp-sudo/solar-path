#!/usr/bin/env bash
# eval-phys2.sh — RULER-physics2(§137) 판정을 한 번에. 렌더 폴더 = volsky 출력(<후보>_<장면>_<방위>.png + .alpha.png).
#   bash tools/genus-ruler/flow/eval-phys2.sh <held-out 렌더 폴더>
# 후보: P0 P1 P2 H1 H2 (낮 장면·무리 장면) · F0 F1 K0 K1 G0 G1 T0 T1 (D1 진단). 판정 규칙·문턱은 RULER-physics2.md, 코드는 phys2.py(해시 동결).
set -euo pipefail
D=$(cd "$1" && pwd)
H=$(cd "$(dirname "$0")" && pwd)
cd "$H"
echo "=== phys2.py 해시 확인 ==="
python3 - <<PY
import json, hashlib
q = json.load(open('phys2-photo-quartiles.json'))
h = hashlib.sha256(open('phys2.py', 'rb').read()).hexdigest()
print('phys2.py', h[:16], '사분위 파일에 적힌', q['phys2Sha256'][:16], '일치' if h == q['phys2Sha256'] else '⚠ 불일치 — 규칙 고정 뒤 phys2.py 가 바뀜')
PY
echo; echo "=== 지표 계산(폭 320 · 260 · 208) ==="
for w in 320 260 208; do
  python3 phys2.py --renders "$D" --out "$D/phys2-renders-w$w.json" --glob '*_*_[0-9]*.png' --width $w | tail -1
done
echo; echo "=== 규칙 R1·R2·R3c·G4 — P1·P2 vs P0 (폭 320 = 판정, 260·208 = 민감도: 결론이 바뀌면 '불확정') ==="
for w in 320 260 208; do
  echo "--- 폭 $w"; python3 phys2.py --gate phys2-photo-quartiles.json "$D/phys2-renders-w$w.json" --ref P0 --cands P1,P2 --out "$D/phys2-gate-w$w.json" | grep -v '^wrote'
done
echo; echo "=== 해 둘레 무리(haloGain) · H·HA·대조 ==="
python3 phys2.py --halo "$D" --fov 60
echo; echo "=== H1 권운 가드: 밝기비·어두움비(R1 ci 칸)·면적 — H1·H2 vs P0 ==="
python3 phys2.py --gate phys2-photo-quartiles.json "$D/phys2-renders-w320.json" --ref P0 --cands H1,H2 | grep -E "===|R1|G4"
echo; echo "=== CLIP 라벨(G1'·HC): AcCc(P0·P1) · Ci(P0·P1·P2·H1·H2), 방위 5,160,290 ==="
for c in P0 P1; do [ -f "$D/${c}_ac_5.png" ] && python3 clip-labels.py AcCc "$D/${c}_ac_{az}.png" 5,160,290 | sed "s/^/$c /" || true; done 2>/dev/null
for c in P0 P1 P2 H1 H2; do [ -f "$D/${c}_ci_5.png" ] && python3 clip-labels.py Ci "$D/${c}_ci_{az}.png" 5,160,290 | sed "s/^/$c /" || true; done 2>/dev/null
echo; echo "=== D1 조명 진단 ==="
python3 phys2.py --diag "$D/phys2-renders-w320.json"
