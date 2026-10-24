#!/bin/bash
# 2차 수집(§158): 2026-10-10 ~ 10-23, 블록 03·06·07·08·10·11·16, 이틀씩, 요청 사이 8초(ogimet 부하).
cd "$(dirname "$0")"; mkdir -p raw2
for blk in 03 06 07 08 10 11 16; do
  for d in "20261010 20261011" "20261012 20261013" "20261014 20261015" "20261016 20261017" "20261018 20261019" "20261020 20261021" "20261022 20261023"; do
    set -- $d; f=raw2/b$blk-$1.csv
    [ -s $f ] && continue
    curl -sS -m 240 "https://www.ogimet.com/cgi-bin/getsynop?block=$blk&begin=${1}0000&end=${2}2359" > $f || echo "FAIL $blk $1" >> raw2/fetch.err
    sleep 8
  done
done
echo DONE > raw2/fetch.done
