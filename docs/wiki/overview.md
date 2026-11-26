# 개요 — BeforeGlow(solar-path)가 무엇이고 어떻게 짜였나

한 줄: 예보 자료로 "몇 시에 어느 쪽을 보면 어떤 하늘(노을 · 구름 · 별)인지"를 3D로 미리 보여 주는 Expo(React Native) 앱. 갱신: 2026-11-26

## 지금 상태
- 이름: 저장소 `solar-path`, 앱 이름 BeforeGlow(`package.json` name `beforeglow`, Expo 54). iOS · Android.
- 화면: 탭 **데이터 · 시뮬레이션 · 샌드박스 · 사진 · 천체**(전문가 모드). 하늘은 볼륨(부피) 렌더 + 지형 · 건물 · 바다. 지도 · 지구본으로 이어서 확대 · 축소.
- 하늘 엔진: takram `three-clouds`/`three-atmosphere`(Bruneton 대기 표, 파장 15개)를 패치해서 씀 — 구름 종류(genus) · 흐름(flow) · 세포 · 미세물리 · 물리 빛.
- 자료: Open-Meteo(ecmwf+icon) 고리 예보 91점 × 3층, 위성 일사(DNI), 공항 METAR, 과거 예보 보관(historical) — [기상 자료](weather-data.md).

## 원칙(출처에서 반복되는 것)
- **정직한 인상주의**: 하늘을 완벽히 재현할 수 없으니, 확신하는 것만 선명하게(선명도 ∝ 확신도). `SKY_REBUILD_PLAN §1 · §7 · §8`
- **자(ruler) 먼저**: 고치기 전에 잴 지표와 문턱을 먼저 정하고(동결), 렌더를 보고 문턱을 바꾸지 않음. `tools/genus-ruler/*/RULER-*.md`
- **실험은 기본 끔**: 새 경로는 옵션으로 넣고 기본 꺼 두며, 끄면 셰이더 글자 · 날씨 바이트가 그대로(바이트 동일). 판정이 서면 기본 켬.
- **하드코딩보다 물리**: 고도별 특수 스위치 · 손값 대신 일반 물리 계산으로(사용자 결정, 2026-11-25). [결정](decisions.md)
- **실기기 · 사진이 최종 자**: 하네스는 근사. 기기 캡처와 같은 시각 사진을 나란히 놓고 판단.

## 코드 지도(큰 덩어리)
| 영역 | 위치 |
|---|---|
| 하늘 3D 장면 · 옵션 · 개발 패널 연결 | `src/components/SkyScene3D/SkyScene3D.tsx` |
| 볼륨 구름 엔진 | `src/components/VolumetricProbe/` — [구름 배치](cloud-placement.md) · [모양](cloud-shape.md) · [빛](cloud-lighting.md) · [미세물리](cloud-microphysics.md) |
| 예보 → 장면 입력 | `src/components/VolumetricProbe/liveScene.ts`, `src/utils/weather.ts`, `src/utils/macroField.ts` |
| 화면 · 탭 · 패널 | `src/components/SkyScreen/`, `src/components/AppHeader.tsx` |
| 상태 저장 | `src/store/useCelestialStore.ts`(zustand persist — skySettings 는 저장 안 함) |
| 디자인 토큰 | `src/theme/tokens.ts` — [화면 · 디자인](ui-ia.md) |
| 판정 · 하네스 | `tools/shader-preview/verify-*.js`(약 200개), `tools/genus-ruler/`, `tools/web-repro/` — [하네스 · 판정](harness-verification.md) |

## 출처
`docs/SKY_REBUILD_PLAN.md`(중심 기록, §1~§181), `docs/SANDBOX_MODE_PLAN.md`(§1~§26), `docs/IA_REDESIGN.md`, `docs/DESIGN_SYSTEM.md`, README.md. 전체 지도는 [출처 지도](sources.md).
