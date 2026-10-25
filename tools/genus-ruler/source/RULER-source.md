# RULER-source — 과거 재현 자료원 전환: ERA5 → 과거 예보 보관(historical-forecast-api) (2026-10-25 초안, 구현·측정 전에 고정)

사용자: "과거를 재현하고 미래를 예측하는 시뮬레이션이 주 기능이다. 기상 수치로 한다." → 설계 판정단(2026-10-25) 네 관점이 모두 1 순위로 꼽은 항목.

## 0. 지금
- `src/utils/weather.ts` 네 요청(`fetchSunsetWeather` L401, `fetchThermoProfile` L1048, `fetchLayerWinds` L1138, `fetchDayWeatherRing` L1363)이 각자 `diffDays = ceil((Date.now() − target)/일) > 5` 면 `archive-api`(ERA5 25 km) 로 간다.
- ERA5 경로는 변수가 줄고(총·3층 운량·시정·RH2m·DNI·강수만), CAPE·결빙고도·경계층·기압면 기온·RH 는 단위 `undefined` 로 와서 전부 NaN(§135.3) → 밑면·두께·LCL·역전이 상수로 물러난다. 과거 장면이 지금 장면보다 한 등급 낮은 입력으로 그려진다.
- 분기 기준이 `Date.now()` 라 **같은 과거 날짜가 보는 시점에 따라 다른 자료원**으로 그려진다(오늘 −4 일은 forecast past_days, 내일은 archive). 시뮬레이터의 재현성 결함.
- 429 면 `createClearSkyFallback` 이 맑은 하늘을 지어내 캐시한다(L1380~). 이번 자의 범위 밖이지만 §4 에 적는다.
- Open-Meteo 과거 예보 보관(`historical-forecast-api.open-meteo.com/v1/forecast`)은 같은 모델의 그날 예보(짧은 리드 이어붙임)를 같은 변수로 준다. 보관 시작: ecmwf_ifs025 2024-02-03 · icon(global/eu/d2) 2022-11-24 · jma_msm 2016-01-01 · hrrr 2018-01-01 · ecmwf hres 9 km 2017-01-01(문서, 2026-10-25 확인). 2026-10-25 탐침: jma_msm 2025-10-10 응답 200.

## 1. 질문
과거 날짜를 과거 예보 보관으로 그리면 (a) 지금(≤ 5 일) 경로와 **같은 입력**이 되는가, (b) 현실(위성 관측 일사)에 ERA5 보다 가까운가, (c) 열역학·단면이 채워지는가, (d) 자료원 경계에서 하늘이 튀지 않는가, (e) 같은 날짜가 언제 봐도 같은 자료원으로 그려지는가.

## 2. 설계(구현 내용을 여기서 고정)
- `weatherSourceFor(targetDate, nowMs, lat, lon)` 한 해석기: `lead = target − now`.
  - `lead ≥ −5 일` → `forecast`(지금과 같음, past_days 영역 포함).
  - `lead < −5 일` 이고 날짜 ≥ 요청 모델의 보관 시작일 → `historical`. 블렌드 요청(`BLEND_MODELS_PARAM` = ecmwf_ifs025 + icon_seamless)은 **둘 다** 보관에 있는 날(≥ 2024-02-03)만 블렌드, 2022-11-24 ~ 2024-02-02 는 icon_seamless 단독(출처 태그 `historical-icon`), 그 전 → `era5`.
  - 지역 모델(`getLocalHighResModel`: hrrr·icon_d2)은 그 모델 보관 시작일을 따로 둔다.
- 네 요청 모두 base URL·모델 파라미터를 해석기에서 받는다. 변수 집합은 forecast 와 **동일**. 보관 API 가 특정 변수로 400 을 내면 그 변수만 빼고 **한 번** 재시도(없는 값은 NaN).
- 캐시 키(메모리·디스크 `cachePolicy`/`ringCacheKey`)에 출처 접두 `fc_` / `hf_` / `hfi_` / `era_`. `CloudPathData.source` 에 `'historical' | 'historical-icon' | 'era5'` 를 추가해 요약·개발 패널에 보이게.
- 403·429 → `era5` 로 후퇴(보관 전용), 후퇴도 실패하면 지금 동작 유지. 후퇴 여부를 출처 태그에 남긴다(`era5-fallback`).
- 지역 모델 교체(jma_msm 등)·앙상블은 이 자 밖(RULER-ringtruth 뒤).

## 3. 자(측정, 구현 뒤 — 오프라인 Python + 앱 검증 스크립트)
- **S1 동일성**: 10 곳(RULER-macro 사이트) × 겹치는 날(지금 −3 ~ −5 일, forecast past_days 와 보관이 둘 다 주는 날) 관측점 24 시각: 3 층 운량 |Δ| ≤ 1 %p 비율 ≥ 95 %, DNI·강수 |Δ| ≤ 1 % 비율 ≥ 95 %. 목적: 보관이 "그날의 예보" 와 같은 자료임을 확인. (past_days 쪽은 최신 런이 덮어쓰므로 완전 동일은 아님 — 그 차이 크기도 보고.)
- **S2 현실성**: 10 곳 × 2026-09-01 ~ 09-30 낮 시각(해 ≥ 15°): 예보 GHI / 맑은 GHI(Haurwitz 창 평균, `satelliteBias.clearSkyGHIMean`) ↔ 위성 관측 GHI 투과율(satellite-api archive) 상관. historical ≥ ERA5 + 0.05 이면 통과, ERA5 − 0.05 미만이면 보류. ERA5 는 `shortwave_radiation` 이 있다. 보조: 총운량 ↔ 위성 투과율 상관.
- **S3 완전성**: historical 경로에서 CAPE·경계층·기압면 기온·RH·운량 단면의 유한 비율 ≥ 95 %(ERA5 는 0 %).
- **S4 이음새**: 자료원 경계(−5 일) 양쪽 1 시간의 3 층 운량 점프 중앙값 ≤ 같은 자료원 안 연속 시각 점프 중앙값 × 1.5.
- **S5 재현성**: 해석기 단위 테스트 — 같은 날짜·다른 now 에서 (−5 일 경계 밖이면) 같은 자료원; 경계·시작일·후퇴 표.
- 비용: 변수 동일이라 요청 가중 변화 0. 측정용 호출: S1 10 곳 × 3 일 × 2 끝점, S2 10 곳 × 30 일 × 3 끝점(forecast 보관·ERA5·위성) ≈ 수십~백 가중.

## 4. 합격·행동
- S1·S3·S5 통과 + S2 비악화(≥ ERA5 − 0.05) 면 전환(기본값). S2 가 그보다 나쁘면 코드는 두되 플래그로 끄고 보고.
- S4 가 실패하면 경계 ±6 시간을 두 자료원으로 선형 혼합(후속).
- 429 때 맑은 하늘을 지어내는 후퇴는 이 자에서 바꾸지 않되, `source: 'synthetic'` 태그만 붙여 요약에 보이게 한다(사용자 결정 뒤 "자료 없음" UI).

## 5. 사전 예측
- S1 ≥ 97 %(같은 모델·런 이어붙임; past_days 쪽이 최신 런이라 1~3 %p 차 가능).
- S2 historical 0.72~0.78, ERA5 0.65~0.72(§56 류 수치에서 유추). S3 ≥ 98 %. S4 통과.
- 함정: 요금 FAQ 가 historical 을 Professional 전용으로 적음(archive·satellite 도 그렇지만 지금 동작) — 첫 요청 403 이면 즉시 era5 후퇴, 보고에 명시. 모델 버전 변화로 장기 통계 비정상(문서 경고). 2024-02 이전은 icon 단독(짙은 흐림 편향 +8.1, §56) — 출처 태그로 보이게.
