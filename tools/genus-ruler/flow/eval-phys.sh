#!/usr/bin/env bash
# eval-phys.sh — RULER-physics(§136) 판정을 한 번에: R1·R2(phys.py), R3(fm.py density 군), H(무리), G1(CLIP), G2(박명), G4(면적).
#   bash tools/genus-ruler/flow/eval-phys.sh <렌더 폴더>      (폴더 = volsky 출력: <P?>_<장면>_<방위>.png + .alpha.png)
set -euo pipefail
D=$(cd "$1" && pwd)
H=$(cd "$(dirname "$0")" && pwd)
cd "$H"
echo "=== R1·R2·G4 (phys.py) ==="
python3 phys.py --renders "$D" --out "$D/phys-renders.json" --glob 'P?_*_[0-9]*.png' > "$D/phys-renders.log"
python3 phys.py --gate phys-photo-quartiles.json "$D/phys-renders.json" --ref P0 --out "$D/phys-gate.json"
echo; echo "=== R3 (fm.py density 군: st·as·ns·sc85) ==="
for s in st as ns sc85; do
  python3 fm.py --renders "$D" --out "$D/fm-$s.json" --glob "P?_${s}_*.png" > /dev/null
  python3 fm.py --gate photo-flow-quartiles.json "$D/fm-$s.json" --out "$D/fm-gate-$s.json" > /dev/null
done
python3 - "$D" <<'EOF'
import json, sys
D = sys.argv[1]
tot = {}
for s in ['st', 'as', 'ns', 'sc85']:
    R = json.load(open(f'{D}/fm-gate-{s}.json'))['report']
    for cand, scenes in sorted(R.items()):
        for scene, e in scenes.items():
            d = e['perGroup']['density']
            rows = [r for r in e['rows'] if r['group'] == 'density' and r['ok'] is not None]
            print('%-3s %-5s density 실패 %d/%d  %s' % (cand, scene, d['fail'], d['n'], '  '.join('%s %.3g %s %s' % (r['metric'], r['value'], r['threshold'], '○' if r['ok'] else '×') for r in rows)))
            t = tot.setdefault(cand, [0, 0]); t[0] += d['fail']; t[1] += d['n']
for c, (f, n) in sorted(tot.items()):
    print('%-3s R3 실패 합 %d/%d' % (c, f, n))
EOF
echo; echo "=== H 무리 (halo 장면) ==="
python3 phys.py --halo "$D"/P?_halo_0.png --fov 60
echo; echo "=== G2 박명 색 ==="
python3 ../genus/twilight-hue.py --horizon "$D"/P?_tw1734.png "$D"/P?_tw1746.png
echo; echo "=== G1 CLIP J1 (AcCc·Ci) ==="
cd ../clip
for c in P0 P1 P2; do
  [ -f "$D/${c}_ac_200.png" ] || continue
  echo "-- $c"
  python3 ruler2.py "AcCc=$D/${c}_ac_{az}.png" "Ci=$D/${c}_ci_{az}.png" 2>/dev/null
done
