# RULER-ringtruth — 실제 NWP 고리 ↔ 현실 기준선 + 리드 타임 곡선 (2026-10-25 초안, 짝짓기 전에 고정)

설계 판정단(2026-10-25) 2 순위. RULER-macro(§156)의 corr50 0.77·corr12 0.57 은 위성 마스크의 7 km 평균을 '예보' 로 넣은 **NWP 오차 0** 조건의 상한이다. 실제 예보 고리의 공간 배치가 현실과 얼마나 맞는지는 한 번도 재지 않았고, 리드별 품질은 §98 에서 관측점 총운량·3 일까지 한 번뿐이다. 이후 모든 합격선(지역 모델 채택, 잡음 모드, 리드별 렌더, 시간바 등급)의 기준선이 여기서 나온다.

## 1. 질문
- Q1 실제 과거 예보 보관 고리 90 점(총운량)으로 Barnes 격자를 만들면 MODIS 참값과 corr50·corr12 가 얼마인가. 대용 입력(0.77/0.57) 과 C0(관측점 + 기울기) 와의 차는.
- Q2 리드 0~7 일에 따라 총운량·GHI 투과율의 위성 대비 기술이 어떻게 떨어지는가. 어느 리드에서 기후값과 같아지는가 → 시간바 등급(72/168 h, '실측 아님')을 숫자로.
- Q3 (예산이 남으면) 모델별 Q1: ecmwf_ifs025·icon_seamless 단독, 한·일 장면은 jma_msm. 공간 배치를 가장 잘 맞히는 모델은(채택은 별도 자).

## 2. 정답·입력
- **Q1 정답**: `.harness/macro/sat` 130 장면(dev 서울·가나자와 24+ / held 8 곳 97+, 2026-09-01 ~ 10-22, 4 일 간격) 의 `trueGrid` 256² × 3 km(MODIS Terra 진색 흰 정도 마스크, RULER-macro §2). **입력**: historical-forecast-api, 장면 날짜 하루, `hourly=cloud_cover`(총운량, MODIS 마스크가 총운량이므로), 고리 91 점(관측점 + RING 90), 모델 블렌드 `ecmwf_ifs025,icon_seamless` 평균(앱 `blendHourly` 와 같게; 2024-02 이후라 둘 다 있음). 시각: MODIS Terra 통과 ≈ 현지 10:30 → UTC 변환 뒤 **앞뒤 정시 두 값을 선형 보간**(운량은 순간값). 장면 JSON 의 `ring[].cover` 를 이 값으로 바꾼 사본을 `sceneDir-nwp/` 에 쓰고 `downscale-run.mjs --variant prior`(Barnes 모드) → `macro.py --gate`.
- **Q2 정답**: satellite-api archive `shortwave_radiation`(관측 GHI, 직전 1 h 평균) 10 곳, 2026-08-01 ~ 10-23. **입력**: previous-runs-api `shortwave_radiation_previous_day0..7` 와 `cloud_cover_previous_day0..7`(총운량만 지원) 같은 10 곳·기간, best_match. 투과율 = GHI / 맑은 GHI(Haurwitz 창 평균, 해 ≥ 15°) — 둘 다 같은 창 평균량이라 시간 의미가 맞는다. 기후값 = 같은 자리·같은 시각대의 기간 평균 투과율.
- 요청 가중(문서: 변수 10 개·14 일 단위로 분수 계산, 지점은 지점 수만큼): Q1 장면당 91 지점 × 1 → 91, 130 장면 ≈ 11,800 → **held 97 장면부터**, 하루 한도에 걸리면 다음 날 이어서(resume). Q2 10 곳 × 16 변수 × 84 일 ≈ 10 × 1.6 × 6 = 96. Q3 는 Q1 의 모델 수만큼 곱(한·일 5 곳 held 장면만, +jma_msm·+단독 2 = 약 2,700).
- 나누기: Q1 은 held 로 보고(dev 는 손잡이 확인용). Q2 는 8/1~9/15 로 기후값·문턱을 정하고 9/16~10/23 로 보고.

## 3. 지표
- Q1: macro.py 그대로(corr50Base·corr12Base·meanErrBaseDisc·ringRmseTrue(고리 값 ↔ 참값 상자 평균 = NWP 점 오차)·partial). 세 입력을 나란히: 대용(지금 자) / 실제 NWP / C0.
- Q2: 리드 L 별 상관 r(L), MAE(L), 기술 skill(L) = 1 − MSE(L)/MSE(기후값). 총운량도 같은 식(위성 투과율을 Kasten–Czeplak 역함수로 운량화해 비교).
- 모든 상관은 **날 블록 부트스트랩**(같은 날 시각들의 자기상관) 으로 95 % 구간을 붙인다.

## 4. 판정(사전) — 이 자는 기준선 보고가 목적이라 합격/불합격이 아니라 **행동 규칙**
- Q1 실제 corr50 < 0.50 이면 §156 "고리 값 그대로" 접근이 현실 배치를 못 따라가는 것 → RULER-macro 의 모든 합격선을 실제 기준으로 재등록하고, 거시 격자의 λ_res 하한을 모델 격자(11~25 km)로 둔다(macroField `modelGridKm`).
- Q1 실제 corr50 ≥ 0.50 이면 지금 기본(Barnes) 유지, 수치만 §156 에 추가.
- Q2 skill(L) 이 0.5 아래로 떨어지는 L → 시간바 high→medium 경계, 0.2 아래 → medium→low, 0.05 아래 → none. 지금 72 h / 168 h 와 다르면 `TIER_LEAD_HOURS` 를 바꾼다(실측 표기).
- Q3 한·일 장면에서 jma_msm corr50 ≥ 블렌드 + 0.05 이고 |meanErrDisc| ≤ 블렌드 + 0.03 이면 "무늬만 빌리기(양은 블렌드)" 후보로 다음 자에 등록. 그 외는 블렌드 유지.

## 5. 사전 예측
- Q1 실제 corr50 0.55~0.65(대용 0.77), corr12 0.35~0.45(대용 0.57), ringRmseTrue 0.25~0.30, C0 와의 차 +0.10 유지.
- Q2 skill: L0 0.50, L1 0.45, L2 0.38, L3 0.30, L5 0.15, L7 0.05 → high ≤ 2 일, medium ≤ 5 일, 그 뒤 low. 총운량은 GHI 보다 skill 0.05 낮을 것.
- Q3 jma_msm 무늬 이득 +0.03 미만(안 넘음).
- 함정: 10:30 통과 시각 ±30 분·정시 보간; MODIS 마스크의 눈·해빙 오탐(RULER-macro 와 같은 한계); 위성 결측·밤 없음(Q2 는 낮만 — 밤 리드 기술은 METAR 자가 맡음); 요금 FAQ(previous-runs 는 무료 표에 없음 — 첫 요청 403 이면 Q2 를 previous-runs 없이 historical 리드 0 만으로 축소); 한도 공유 IP.
