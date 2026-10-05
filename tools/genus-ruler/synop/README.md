# 예보 → 구름 종류 자 (§126 C4)

유럽 유인 관측소의 SYNOP 구름 종류 보고(8NhCLCMCH)를 정답으로, Open-Meteo 같은 시각 예보에서 종류를 맞히는 규칙
(`src/utils/cloudGenusForecast.ts`)을 잽니다. 조건은 `RULER-genus-forecast.md`(자료를 보기 전에 고정).

1. `fetch.sh` — ogimet 에서 블록·날짜별 SYNOP 를 `raw/` 로 받습니다(요청 사이 8초).
2. 관측소 좌표: NOAA `nsd_bbsss.txt` 를 같은 폴더에 둡니다.
3. `python3 pair.py` — 유인(ix 1·2·3)·8그룹 있는 보고만 골라 Open-Meteo forecast(past_days 범위)와 짝지어 `pairs.jsonl`.
4. `python3 evalgenus.py` — 초안 문턱으로 보고. `python3 evalgenus.py tune` — 홀수 날로 문턱 격자 탐색, 짝수 날로 보고,
   `tuned-thresholds.json`. 규칙 본문은 TS 와 같은 식으로 옮겨 두었으니 둘을 같이 고칩니다.

주의: SYNOP 1절은 `AAXX YYGGi IIiii iRixhVV Nddff …` 순서라 8그룹은 **다섯째 그룹 뒤**에서 찾습니다(Nddff 가 8 로 시작하는
경우를 8그룹으로 잘못 읽기 쉽습니다).
