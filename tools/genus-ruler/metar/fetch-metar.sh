#!/usr/bin/env bash
# RULER-metar 정답 수집 — Iowa State Mesonet ASOS 보관(공개)에서 한국·일본 공항 METAR, 2026-10-10 ~ 10-23 UTC → raw/KR.csv, raw/JP.csv
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p raw
for net in KR__ASOS JP__ASOS; do
  curl -sS -m 300 "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?network=$net&data=skyc1,skyl1,skyc2,skyl2,skyc3,skyl3,skyc4,skyl4,wxcodes,tmpf,dwpf,metar&year1=2026&month1=10&day1=10&year2=2026&month2=10&day2=24&tz=Etc/UTC&format=onlycomma&latlon=yes&missing=M&trace=T&report_type=3" -o "raw/${net%%__*}.csv"
  echo "$net $(wc -l < "raw/${net%%__*}.csv") lines"
done
