#!/bin/bash
# 블록별·이틀씩 SYNOP 수집(ogimet 부하를 줄이려 순차, 요청 사이 8초)
cd "$(dirname "$0")"; mkdir -p raw
for blk in 03 06 07 08 10 11 16; do
  for d in "20260926 20260927" "20260928 20260929" "20260930 20261001" "20261002 20261003"; do
    set -- $d; f=raw/b$blk-$1.csv
    [ -s $f ] && continue
    curl -sS -m 180 "https://www.ogimet.com/cgi-bin/getsynop?block=$blk&begin=${1}0000&end=${2}2359" > $f || echo "FAIL $blk $1" >> fetch.err
    sleep 8
  done
done
echo DONE > fetch.done
