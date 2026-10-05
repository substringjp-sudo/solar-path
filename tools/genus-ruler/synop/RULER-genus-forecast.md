# 예보 → 구름 종류 규칙의 자 (C4) — 자료를 맞춰 보기 전에 고정 (2026-10-04)

## 정답
유럽 유인 관측소(ix 1·2·3)의 SYNOP 8NhCLCMCH, 블록 03·06·07·08·10·11·16, 2026-09-26 ~ 10-03, 모든 시각.
CL → {none:0, Cu:1·2, Cb:3·9, Sc:4·5·8, St:6·7} / CM → {none:0, As:1·2, Ac:3~9} / CH → {none:0, Ci:1~4, Cs:5~8, Cc:9}.
'/'(관측 불가)는 뺍니다.

## 입력
Open-Meteo forecast API(best_match, past_days)의 관측소 좌표·그 시각 값:
cloud_cover_low/mid/high, precipitation, cape, lifted_index, weather_code, temperature_2m, dew_point_2m,
relative_humidity_2m, is_day, 기압면 1000~300hPa 운량·지오퍼텐셜 고도(앱이 쓰는 PROFILE_LEVELS 와 같은 면).
앱이 받는 것과 같은 변수만 씁니다. 관측소 높이는 nsd_bbsss 의 값.

## 평가 집합
- 저층: 모델 저층 운량 ≥ 20% 이고 CL 알려진 시각. 4분류 {Cu, Sc, St, Cb}. (CL=0 인데 모델 ≥20% 인 시각은 '운량 오차'라 종류 평가에서 뺍니다.)
- 중층: 모델 중층 ≥ 20% 이고 CM ∈ {As, Ac}. 2분류.
- 상층: 모델 상층 ≥ 20% 이고 CH ∈ {Ci, Cs}. 2분류(Cc 는 드물어 Ci 로 묶음).

## 나누기
홀수 날(27·29·1·3)로 문턱을 정하고, **짝수 날(26·28·30·2)로만 보고**합니다.

## 합격
- 저층 4분류 정확도가 "가장 흔한 종류로 전부 찍기"보다 **10%p 이상** 높고, Cu·St 재현율이 각각 ≥ 0.30.
- 중층·상층 2분류 정확도가 다수 찍기보다 5%p 이상 높음.
- 못 넘으면 규칙을 그대로 쓰되 문서에 '자를 못 넘음'을 적고, 앱에서는 종류 확신이 낮을 때 기본(Sc/Ac/Ci)으로 둡니다.

## 규칙 초안(물리 선험, 문턱만 홀수 날로 조정)
- 저층: Cb = cape 크고(≥ T_cape) 강수·소나기 코드(80~99) 또는 LI ≤ T_li. 아니면 St = 밑면(저층 덱 밑 − 지면, 또는 LCL)이 낮고(≤ T_base) 운량 ≥ T_stcov 이고 대류 약함. 아니면 Cu = 대류(cape ≥ T_cu 또는 LI ≤ T_licu)·낮·운량 < T_cucov. 나머지 Sc.
- 중층: As = 중층 운량 ≥ T_ascov 이고(강수 > 0 또는 중층 습윤 면 ≥ T_levels). 아니면 Ac.
- 상층: Cs = 상층 운량 ≥ T_cscov. 아니면 Ci.
