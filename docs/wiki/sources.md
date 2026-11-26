# 출처 지도 — 원본 문서 → 위키 쪽

원본은 바꾸지 않는 기록. 위키 쪽은 결론만. 갱신: 2026-11-26

| 원본 | 줄 | 다루는 것 | 위키 쪽 |
|---|---|---|---|
| `SKY_REBUILD_PLAN.md` | 11.8k | 중심 기록 §1~§181 — 하늘 재건 전체 | 거의 모든 쪽 |
| `SANDBOX_MODE_PLAN.md` | 1.2k | 샌드박스 모드 §1~§23, 구름 세포 §24, 구름 빛 §25, 가장자리 §26 | [화면](ui-ia.md) · [빛](cloud-lighting.md) · [모양](cloud-shape.md) · [미세물리](cloud-microphysics.md) |
| `COASTLINE_PLAN.md` | 1.2k | 해안선 · 지면 기하 | [지형](terrain-ground.md) |
| `CLOUD_TEXTURE_PLAN.md` | 0.9k | 구름 질감 · 공간 주파수 | [모양](cloud-shape.md) |
| `OVERCAST_DESIGN.md` | 0.7k | 흐린 날 배치 · 계층 | [배치](cloud-placement.md) |
| `GROUND_PLAN.md` | 0.6k | 땅 · 지평선 아래 | [지형](terrain-ground.md) |
| `CLOUD_VARIETY_PLAN.md` | 0.5k | 운형 다양성 6단계 | [배치](cloud-placement.md) |
| `ATMOS_DYNAMICS_SURVEY.md` | 0.4k | 격자 안 대기 동역학 조사 | [배치](cloud-placement.md) · [기상](weather-data.md) |
| `DESIGN_SYSTEM.md` | 0.3k | 디자인 언어 · 토큰 | [화면](ui-ia.md) |
| `IA_REDESIGN.md` | 0.3k | 정보 구조 | [화면](ui-ia.md) |
| `TWILIGHT.md` | 0.3k | 박명 곡선 · 오존 | [하늘](sky-atmosphere.md) |
| `FLOW_CHEAP_MATH_SURVEY.md` | 0.3k | 흐름 모형 싼 수학 조사 | [배치](cloud-placement.md) |
| `STATIC_SLOTS_PLAN.md` | 0.1k | 정적 슬롯 | [기상](weather-data.md) |
| `AR_VISION_PLAN.md` | 0.1k | 산 · 해 · 달로 자세 보정 | [AR](ar-camera.md) |
| `WAVE_FIELD_DESIGN.md` | 0.1k | 파동 합성 장 · billow · farSun(§11) | [배치](cloud-placement.md) · [빛](cloud-lighting.md) |
| `CLOUD_PHYSICS.md` | 0.1k | 노을 구름 광학 공식 | [빛](cloud-lighting.md) · [하늘](sky-atmosphere.md) |
| `SKY_TIMELINE.md` | 0.1k | 하루치 사전 계산 | [기상](weather-data.md) |
| `UI_AUDIT_2026-09-29.md` | 0.1k | 인터페이스 점검 | [화면](ui-ia.md) |
| `RELEASE_CHECK_2026-09-30.md` | 0.1k | 출시 점검 | [화면](ui-ia.md) |
| `MORPH_PLAN.md` | 0.1k | 연속 형태 생성기 | [배치](cloud-placement.md) |
| `CAMERA_FULLSCREEN_CHECK.md` | 0.05k | 촬영 전체 화면 기기 확인 | [AR](ar-camera.md) |
| `docs/evidence/` | — | 비교 이미지 · 사진 | 각 쪽 |
| `tools/genus-ruler/*/RULER-*.md` | — | 동결한 자 | [하네스](harness-verification.md) |

## SKY_REBUILD_PLAN 절 묶음(빠른 찾기)
- §1~§10 원칙 · 측정 · 단계 / §11~§12 바람 · 달빛 / §13~§17 실기 차이 · 노을 대비 · 해상도 / §18~§26 구름 크기 · 조명 · 방위 · 고도 축
- §27~§40 근거리 볼륨 · 실기 지적 · 2-stream / §41~§55 모양 · 그림자 · 방위 규약 · 썸네일 · 운량 면적
- §56~§72 기상 자료 · 위성 보정 · 무작위 검증 / §73~§80 지도 · 구 · 캐시 · 카나리아
- §81~§96 운해 · 박명 · 달빛 · 구름 속 · 두 번 그리기 / §97~§122 도트 · 여행 예보 · 부챗살 · 스치는 햇빛 · 겹침 · 지구본 · 위성 편향 · 톤
- §123~§141 볼륨 구름 · 종류 · 표시 곡선 · 분광 대기 · 흐름 · 미세물리 · 뼈대 / §142~§166 전환 · 막대 · 태양 원반 · 바람 · 거시 격자 · 관측 · 16일 · 과거 재현
- §169~§181 질감 · 대기 동역학 · 좌표 버그 · 박명 사진 · T_sun · 조명 결함
