#!/bin/bash
# 탐색용(반해상도 195×292) 묶음 — 판정은 최종 후보만 정식 해상도로 다시 냅니다.
N=$1; X=$2; AZS=${3:-"200 110 20"}
B="lat=36.5679&lon=136.6774&h=103&iso=2026-10-03T03:00:00Z&el=20&fov=60&frames=48&ev=10&march=%5B6%2C250%2C1.6%5D&w=195&hpx=292"
for az in $AZS; do PAGE=index2.html timeout 2400 node shoot.js "$B&az=$az&$X" $N-$az.png > $N-$az.log 2>&1 & done; wait
