#!/bin/bash
# A/A 복제 렌더가 끝나면 R2 를 이어 그림(동시에 돌리면 대기 표 생성이 900 s 준비 한도를 넘음)
cd /home/user/solar-path
while pgrep -f 'scratchpad/run-aa.sh' >/dev/null; do sleep 30; done
echo "aa done $(date -u +%H:%M:%S), starting R2" >> .harness/volsky-grain/out/chain.log
G0BUNDLE=/home/user/solar-path/.harness/volsky-grain/out/judge/g0-bundle.json exec bash tools/genus-ruler/grain/eval-grain.sh round 2 > .harness/volsky-grain/out/R2.log 2>&1 < /dev/null
