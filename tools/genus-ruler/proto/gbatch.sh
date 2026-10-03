#!/bin/bash
# 후보 렌더 묶음(genus 페이지): ./gbatch.sh 이름 "종류쿼리" [방향들] — 48프레임, 기준 조건 그대로. 방향들은 병렬.
N=$1; X=$2; AZS=${3:-"200 110 20"}
B="lat=36.5679&lon=136.6774&h=103&iso=2026-10-03T03:00:00Z&el=20&fov=60&frames=48&ev=10&march=%5B6%2C250%2C1.6%5D"
for az in $AZS; do PAGE=index2.html timeout 2400 node shoot.js "$B&az=$az&$X" $N-$az.png > $N-$az.log 2>&1 & done; wait
