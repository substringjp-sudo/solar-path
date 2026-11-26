# 기상 자료 — 예보 · 관측 · 캐시

한 줄: Open-Meteo 고리 예보(91점 × 3층)를 받아 캐시하고, 위성 DNI · METAR 로 지금 시각을 보정한다. 갱신: 2026-11-26

## 지금 상태(출처 목차 · 머리 문장 요약 — 본문 대조 필요)
- **모델**: ecmwf + icon 두 개(§57 · §58 — 셋에서 호출 수 때문에 둘로). 총운량도 받음(§60). 요청 날짜 UTC 버그 고침(§59).
- **고리(ring)**: 관측점 둘레 9 각도 × 10 거리 + 관측점 = 91점, 고 · 중 · 저 3층(§166). 해 방향 부채꼴 요청은 삭제. 고리 사이 보간 검토(§80).
- **받기 효율**: 병목은 TLS 핸드셰이크(§69). 저장장치 캐시 · 바뀐 것만 받기(§77), 카나리아 — 한 점만 보고 나머지를 건너뜀(§78 · §79).
- **보정**: 위성 일사로 τ 편향 보정(§70, τ 오차 −45 %), 경로 · 층별로 나눔(§121). 지금 시각은 관측(위성 DNI · 공항 METAR 운저, §160).
- **과거 재현**: archive → 과거 예보 보관(historical forecast)으로(§163), NWP 고리 참값 은행 · 리드 곡선(§164). 여행 예보 정확도 재기(§98).
- **바람**: 층별 바람 실측(§11), 구름 늘어남은 바람이 아니라 시어에서(§109).
- 거시 운량 격자 · 대기 동역학 조사: [구름 배치](cloud-placement.md).

## 코드
`src/utils/weather.ts`(fetchDayWeatherRing 등), `src/utils/macroField.ts`, `liveScene.ts`(buildLiveScene · summary 상태 줄), `tools/weather-truth/`.

## 출처
`docs/SKY_REBUILD_PLAN.md §11 · §56~§60 · §65~§72 · §77~§80 · §98 · §121 · §156 · §160~§166 · §170 · §171`, `docs/ATMOS_DYNAMICS_SURVEY.md`, `docs/SKY_TIMELINE.md`, `docs/STATIC_SLOTS_PLAN.md`.
