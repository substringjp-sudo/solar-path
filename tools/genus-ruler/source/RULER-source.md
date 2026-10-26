# RULER-source — 과거 재현 자료원 전환: archive(ERA5·IFS 분석 이어붙임) → 과거 예보 보관(historical-forecast-api) (2026-10-25 동결, 구현·측정 전)

사용자: "과거를 재현하고 미래를 예측하는 시뮬레이션이 주 기능이다. 기상 수치로 한다." → 설계 판정단(2026-10-25) 네 관점이 모두 1 순위로 꼽은 항목. 초안을 3 관점(검증 통계·자료 엔지니어·유지보수)이 비판한 뒤 고친 판. 바뀐 곳은 §7 에.

## 0. 지금
- 살아 있는 과거 분기는 셋: `fetchDayWeatherRing`(weather.ts L1362, 고리 91 점·`BLEND_MODELS_PARAM`), `fetchThermoProfile`(L1047, 관측점·모델 미지정), `fetchLayerWinds`(L1137, 관측점·모델 미지정). `fetchSunsetWeather`(L400) 는 호출부가 없는 죽은 경로(해석기만 끼우고 측정하지 않음).
- 셋 모두 `Math.ceil((Date.now() − target)/일) > 5` 면 `archive-api` 로 간다. **archive 는 모델 미지정 best_match = IFS HRES 9 km 분석 + ERA5 + ERA5-Land 이어붙임**(문서)이라 "ERA5 25 km" 가 아니다 — 이 문서는 `archive` 라 부른다.
- archive 경로의 손실: CAPE·결빙고도·기압면 기온 15 면·RH 13 면·기압면 운량 단면·지오포텐셜·층별 바람(850/600/250)이 없다. `fetchLayerWinds` 는 `missing level` 로 통째로 null, `fetchThermoProfile` 은 지상 기온·이슬점·경계층만 값(§135.3). → 밑면·두께·LCL·역전·이류 바람이 상수로 물러난다. 과거 장면이 지금 장면보다 한 등급 낮은 입력으로 그려진다.
- 분기가 **순간(ms) 차** 라 같은 현지 날짜의 09 시와 21 시가 다른 자료원으로 갈 수 있고(캐시 키는 날짜 단위라 먼저 받은 쪽이 이김), 같은 날짜가 보는 시점에 따라 바뀐다.
- 음성 캐시: `thermoCache.set(key, null)`·`windCache.set(key, null)` 이 429·403·네트워크 오류까지 날짜 단위·TTL 없이 기억한다.
- 429 면 `createClearSkyFallback` 이 맑은 하늘을 지어내 캐시한다(L1380~, `isFallback: true`). 범위 밖이지만 §4 에 적는다.
- Open-Meteo 과거 예보 보관(`historical-forecast-api.open-meteo.com/v1/forecast`): 같은 모델의 그날 예보(각 런의 첫 몇 시간 이어붙임, forecast past_days 와 같은 구성)를 같은 변수·같은 접미사 형식으로 준다. 보관 시작(문서, 2026-10-25): ecmwf_ifs025 2024-02-03 · ICON global/eu/d2 2022-11-24 · ecmwf_ifs(HRES 9 km) 2017-01-01 · jma_msm 2016-01-01 · hrrr 2018-01-01. 경고 "모델 버전 변화로 장기 시계열에 부적합". 요금 FAQ 는 historical 을 Professional 전용으로 적지만 archive·satellite·historical 모두 지금 키 없이 응답(2026-10-25 탐침 jma_msm 2025-10-10 200). **일일 한도는 forecast 와 공유**(2026-10-25 19:50Z forecast 429 일 때 historical 도 429).

## 1. 질문
(a) 과거 날짜를 보관으로 그리면 지금(≤ 5 일) 경로와 **같은 입력**이 되는가. (b) 현실(위성 관측 일사)에 archive 보다 가깝거나 같은가. (c) 열역학·단면·층별 바람이 채워지는가. (d) 자료원 경계(날 경계)에서 하늘이 튀지 않는가. (e) **≤ −6 일인 날짜는 언제 봐도 같은 자료원**이고 −5~0 일은 past_days 구간임이 보이는가(자료원은 now 의 단조 함수: forecast → historical 로 한 번, 한 방향).

## 2. 설계(구현 내용 고정)
- 순수 모듈 `src/utils/weatherSource.ts`(fetch·three 없음): `weatherSourceFor(targetDateStr, todayDateStr, kind)` → `{ origin, baseUrl, modelParam }`.
  - `leadDays` = 대상 현지 달력 날짜 − 오늘 현지 달력 날짜(정수 일, 시각 무시; `localDateString` 과 같은 기기 현지 날짜). `leadDays ≥ −5` → `forecast`. `leadDays ≤ −6` → 보관 시작일 검사: 날짜 ≥ 2024-02-03 → `historical`(블렌드 `ecmwf_ifs025,icon_seamless`), 2022-11-24 ~ 2024-02-02 → `historical-icon`(icon_seamless 단독), 그 전 → `archive`. 하루는 한 자료원으로만 그린다.
  - `kind`: `ring` 은 블렌드(또는 icon 단독) 모델 파라미터, `thermo`·`winds` 는 **모델 미지정**(best_match, 지금과 같음) — base URL 만 바뀐다. 변수 집합은 forecast 와 동일(요청 가중 불변).
  - 네 함수는 `nowMs?: number` 인자를 받아 기본 `Date.now()`(테스트 주입).
- 캐시 키는 **바꾸지 않는다**(`ring_<bucket>_<date>`, `w_…`, thermo/wind 키). 출처는 자료 안 새 필드 `CloudPathData.origin?: 'forecast' | 'historical' | 'historical-icon' | 'archive' | 'archive-fallback' | 'synthetic'`(기존 `source: 'standard' | 'ultra-short'` 는 모델 등급 뜻 그대로). 같은 (칸, 날짜) 캐시가 있으면 origin 이 무엇이든 그대로 쓴다(S1 이 동일성을 보증). 옛 항목(origin 없음)은 `legacy` 로 읽는다. `CACHE_SCHEMA_VERSION` 유지. liveScene 요약·개발 패널이 origin 을 보인다.
- 후퇴: **403 만** 즉시 `archive` 로 후퇴하고 세션 플래그 `historicalForbidden` 으로 기억(한도 소모 방지), 후퇴 자료의 origin 은 `archive-fallback`. **429 는 기억하지 않고** 지금처럼 간다(고리는 synthetic, thermo/winds 는 null). 403·429·네트워크 오류·타임아웃은 **음성 캐시하지 않는다**(날짜 단위 음성 캐시는 200 인데 값이 전부 null 일 때만).
- 400 재시도는 두지 않는다(Open-Meteo 는 모르는 변수 이름에만 400, 모델에 없는 변수는 null 배열 — 조용한 null 은 S3 가 잡는다).
- 2017-01-01 ~ 2022-11-23 의 `ecmwf_ifs`(HRES) 단독 보관은 쓰지 않는다(블렌드와 분포가 다른 모델을 한 경로에 섞지 않음; 다음 자 후보). icon 단독 구간의 뜻: τ 오차 19.3(블렌드 16.8 보다 나쁨), 짙은 흐림 편향 +8.1 은 블렌드 +10.3 보다 오히려 작다(§56).
- 보관 최신일: S1 탐침에서 오늘 −1 … −7 중 처음 non-null 인 날 N 을 적는다. −6 일이 null 이면 해석기 경계를 그 N 으로 상수화하고 §2 에 적는다.

## 3. 자(측정 — 오프라인 Python + 앱 검증 스크립트; 9 곳 = RULER-macro 사이트 중 위성 GHI 가 있는 seoul·kanazawa·osaka·busan·shanghai·sapporo·lisbon·sydney·hamburg, denver 는 GOES 미통합으로 제외)
- **S0 사전 탐침(측정 첫 호출)**: ① historical `models=ecmwf_ifs025,icon_seamless` 1 곳 1 일 91 점 고리 요청이 배열 91 개·접미사 두 열·15 s 안 응답인지. ② `models=icon_seamless&start_date=2022-11-24` 가 non-null 인지(아니면 `icon_global` 로 대체해 §2 에 적음). ③ 보관 최신일 N. ④ forecast 가 429 인 같은 분에 historical·archive 가 200 인지(한도 풀 공유 여부; 2026-10-25 는 공유로 관측).
- **S1 동일성(확인 항목)**: 9 곳 × 겹치는 날(오늘 −3 ~ −5, 보관이 주는 날만) 관측점: 3 층 운량 24 시각 |Δ| ≤ 1 %p 비율 ≥ 95 %; DNI 는 해 ≥ 15° 시각만 |Δ| ≤ max(5 W/m², 1 %) ≥ 95 %; 강수는 둘 중 하나라도 ≥ 0.1 mm 인 시각만 |Δ| ≤ 0.1 mm ≥ 90 %. 둘 중 하나가 null 인 시각은 분모에서 빼고 수를 보고(null 비율 > 5 % 면 실패). S1-b: thermo 33 변수·winds 27 변수를 forecast past_days 와 historical 에서 같은 날 받아 유한 값 |Δ| ≤ 0.1(°C·%p·km/h) 비율 ≥ 95 %. 같은 구성(런별 첫 시각 이어붙임)이라 통과가 기대값이고, 떨어지면 "재처리·모델 버전 차" 로 해석해 크기·변수를 적는다.
- **S2 현실성(판정 항목)**: 9 곳 × 2026-09-01 ~ 09-30, 창 가운데(끝 −30 분) 태양고도 ≥ 15°, 맑은 GHI 창 평균 ≥ 226 W/m². 측정 전용 요청으로 `shortwave_radiation` 을 historical(두 모델 평균)·archive B0(모델 미지정 = 앱 경로)·archive B1(`models=era5`, 보고만) 에서 받고, 위성 GHI(satellite-api archive)와 같은 분모(Haurwitz 창 평균 `clearSkyGHIMean`)로 τ 화. 곳마다 **맑음 배율 = 위성 τ 상위 5 %** 하나를 세 자료원에 같이 쓴다. 주 지표 **τ MAE × 100**(§56 눈금), 보조 짙은 흐림(τ_sat < 0.45) 편향·상관 r. Δ = MAE(historical) − MAE(B0) 를 **날 블록 부트스트랩**(블록 = 달력 날짜, 그날의 모든 곳 포함, 1,000 회) 95 % 구간으로. 보조 보고: 5~15° 구간 MAE(Haurwitz 한계 주석). 검정력: ≈ 30 날 블록, Δ MAE 1.0 의 SE ≈ 0.4~0.5.
- **S3 완전성**: 같은 곳·같은 날(S1 겹침 날)에서 forecast 와 historical 의 변수군별 유한 비율을 쌍으로: (a) CAPE·결빙고도 (b) 기압면 기온 15 면·RH 13 면 (c) 기압면 운량 단면·지오포텐셜 15 면 (d) 층별 바람 3 층 (e) 경계층·지상 기온·이슬점 (f) 시정. 군마다 historical ≥ forecast − 2 %p. archive 도 군별로 같은 표에(예상 (a)~(d) 0 %, (e) 100 %).
- **S4 이음새**: 날 경계(23:00 → 00:00) 3 층 운량 |Δ| 를 센다. 같은 자료원 연속 이틀 쌍(historical/historical, archive/archive 각 9 곳 × 10 쌍) 대 자료원이 바뀌는 쌍(forecast/historical: 오늘 −5/−6; historical/archive: 2024-02-03/02; historical-icon/archive: 2022-11-24/23, 9 곳). 중앙값 비(교차/동일) 와 부트스트랩 구간; 서머타임 전환일(유럽 10-25, 미국 11-01) 경계는 뺀다. 비 > 1.5 인 경계에만 ±6 h 혼합을 후속 등록. 해안 지점 비율을 함께 적는다(격자 차 → 셀 선택 차).
- **S5 재현성·테스트**: `tools/shader-preview/verify-weather-source.js`(esbuild 로 weatherSource.ts 만 묶음): 날짜 경계(−5/−6)·같은 날짜의 00:30·12:00·23:30 → 같은 origin·단조성(forecast → historical 로만)·모델 시작일 표·kind 별 modelParam·403/429 사상·한국 현지 00~09 시 날짜 표. `tools/genus-ruler/flow/thermo-test.mjs` 2) 를 historical 로 고쳐 포함. `scene-from-forecast.ts` 의 기기 캡처 재현이 historical 로 바뀜을 §163 에 적는다.
- 비용 기록: S0 ≈ 91 + 3, S1 9 곳 × 3 일 × 2 끝점 × 3 종류 ≈ 160, S2 위성 9 × 30/14 ≈ 20 + forecast·archive 각 ≈ 20, S3 는 S1 응답 재사용, S4 9 곳 × 6 경계 × 2 ≈ 110. 합 ≈ 450. 측정은 앱을 쓰지 않는 시간(UTC 자정 뒤)에, resume 가능하게.

## 4. 합격·행동
- S1·S3·S5 통과 + S2 구간 **상한 < +1.0**(비악화) 이면 전환(기본값 켬). 구간 하한 < −1.0 이면 "개선" 으로 적는다. 상한 ≥ +1.0 이면 코드는 두되 플래그로 끄고 보고.
- S4 비 > 1.5 인 경계는 후속 혼합 등록(이번엔 보고만).
- 영구 403 시나리오: 개발 패널에 최근 20 요청의 origin 분포를 보이고 `archive-fallback` 이 50 % 넘으면 보고.
- 429 합성 맑음 후퇴는 바꾸지 않되 `origin: 'synthetic'` 을 붙여 보이게 한다("자료 없음" UI 는 사용자 결정 뒤).

## 5. 사전 예측
- S1 ≥ 99 %(같은 구성). S1-b ≥ 97 %.
- S2 historical τ MAE 15~18(§56 ecmwf+icon 16.8 근처); archive B0 는 처음 재는 값 — 수치 예측 없음, 방향만 "historical ≤ B0"(archive 의 최근 날짜는 IFS 분석이라 비슷할 수도). 구간 상한 < +1.0 통과 예상.
- S3 (a)~(d) historical ≥ 95 %, archive 0 %. S4 교차/동일 비 1.0~1.3(S1 이 통과하면 −5/−6 경계는 구성상 없음).
- 함정: 요금 FAQ(403 → 즉시 archive 후퇴·보고). 모델 버전 변화 계단(측정 불가, 위험으로 선언). 2024-02 이전 icon 단독 → origin 태그로 보임. timezone=auto 다지점 시간대 경계(덴버 동쪽 고리)는 기존 결함·범위 밖.

## 6. 바뀔 파일
`src/utils/weatherSource.ts`(새), `src/utils/weather.ts`(세 함수 + 죽은 팬 경로에 해석기, `nowMs`, origin, 음성 캐시·403 플래그), `src/components/VolumetricProbe/liveScene.ts`(요약에 origin), `tools/shader-preview/verify-weather-source.js`(새), `tools/genus-ruler/flow/thermo-test.mjs`, `tools/genus-ruler/source/measure-source.py`(S1~S4), docs §163.

## 7. 초안 → 동결에서 바뀐 것(3 관점 비판, 2026-10-25)
era5 → archive(best_match 이어붙임) 이름·기준선 B0/B1; ms 차 → 달력 날짜 차·단조성; 캐시 키 접두 → 키 불변 + origin 필드; thermo/winds 모델 미지정 유지; DNI·강수 상대 오차 → 절대 문턱·분모 규칙; S2 상관 → τ MAE 주 지표·배율 하나·날 블록 구간·9 곳; S3 군별 쌍 비교; S4 날 경계·동일/교차 쌍·영구 경계 포함; 403 만 후퇴·429 비기억·음성 캐시 제한; 400 재시도 삭제; 보관 최신일 탐침; icon 단독 설명 수정; 죽은 팬 경로 표기; 한도 풀 공유 관측 추가.

## 8. 결과(2026-10-26 00:43~02:02Z, `measure-source.py` → `source-results.json`; raw/ 535 응답, 프록시 끊김 ~60 회 재시도)
| 항목 | 결과 | 판정 |
|---|---|---|
| S0 탐침 | forecast·historical·archive 풀 모두 200(한도 풀림). historical 최신일 = 오늘 −1. `icon_seamless&start_date=2022-11-24` non-null. 블렌드 보관 91 점 고리 1 요청: 배열 91·접미사 두 열·2.5 s | 통과 |
| S1 동일성 | 9 곳 × 겹치는 날 관측점 3 층 운량 \|Δ\| ≤ 1 %p **100 %**(n 2,088), null 0. DNI(해 ≥ 15°) 100 %(n 236). 강수 100 %(n 177) | 통과(예측 ≥ 99 %) |
| S1b 열역학·바람 | \|Δ\| ≤ 0.1 **100 %**(n 47,736; 기압면 바람·시정·기온 전부) | 통과(예측 ≥ 97 %) |
| S2 현실성(위성 GHI 투과율, 9 곳 × 9 월, 창 2,534) | **historical MAE 10.9 pp**, archive B0 12.0 pp, era5 B1 13.3 pp. 어두운 창(τ_sat < 0.45) 편향 hf +5.8 / B0 +11.7(archive 가 더 흐리게). r 0.875 / 0.817 / 0.807. **Δ(hf − B0) = −1.12 pp, 날짜 블록 30 부트스트랩 95 % [−1.66, −0.60]** | 상한 < +1.0 → 전환 유지, 하한 < −1.0 → **개선** |
| S3 완전성 | historical 변수군 (a)~(f) 유한 비율 전부 1.0(forecast 와 같음). archive 는 (e) 경계층·지상만 1.0, (a) CAPE·결빙고도 (b) 기압면 기온·RH (c) 기압면 운량·지오포텐셜 (d) 층별 바람 (f) 시정 전부 0 | 통과(예측대로) |
| S4 이음새(날 경계 3 층 운량 \|Δ\| 중앙값) | 같은 자료원: hf 2.0 %p(n 264) · ar 1.0(n 270). 경계: **fc/hf 1.5 → 비 0.75** [0.4, 2.5](n 30) · hf/ar 7.5 → 비 3.75 [0.2, 11.3] · hfi/ar 4.0 → 비 2.0 [0, 16.6](n 27) | −5/−6 경계 매끈(예측대로). **2024-02-03(보관 → archive) 경계 비 > 1.5 → 후속 혼합 등록(보고만)** |
| S5 재현성 | `verify-weather-source.js` 18/18 · `thermo-test.mjs` 13/13 | 통과 |

- **행동(§4)**: S1·S3·S5 통과 + S2 상한 −0.60 < +1.0 → 전환 **기본값 유지**. 하한 −1.66 < −1.0 → "개선" 으로 적는다: 5 일 넘은 과거를 보관 예보로 그리면 위성 대비 투과율 오차가 archive 보다 1.1 pp 작고 어두운 날 편향이 절반이다. 곳별로 7/9 에서 보관이 낫다(서울 −0.5·시드니 −0.1 은 archive 가 근소 우세).
- 사전 예측 대조(§5): S2 historical MAE 15~18 예측 → 실제 10.9(§56 의 16.8 과 표본·곳이 달라 수치는 낮고 방향 "historical ≤ B0" 는 맞음). S4 교차/동일 비 1.0~1.3 예측 → fc/hf 0.75(맞음), hf/ar 3.75(보관 전·후가 다른 모델이라 당연한 계단 — 다음 자: 2024-02-03 주변 며칠을 두 자료원 혼합으로 잇는 후보).
- 한계: S4 경계 쌍이 27~30 개라 구간이 넓다. 429 Minutely 로 S1 시각 2 건(seoul 10-23 고리, kanazawa 10-23 바람)이 빠졌으나 비율에는 영향 없음(n 2,088).
