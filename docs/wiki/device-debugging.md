# 기기 디버깅 — 개발 패널 · 상태 줄 · 설정

한 줄: 기기 화면만으로 원인을 가르려면 개발 패널의 상태 줄과 칩을 본다. 갱신: 2026-11-26

## 개발 패널 여는 법
전문가 모드에서 머리줄의 **슬라이더 모양 단추(레이어)를 길게 누름**(짧게 누르면 레이어 창). `AppHeader.tsx` hdr-layers → `SkyScreen` openDev → `DevTuningPanel`.

## 상태 줄 읽기
- `볼륨: 동작 중 · 저 sc 27% · 중 — · 상 ci 69% · 해 24.8° · 빔 100% · τ 0.0 · METAR …` — liveScene 요약(예보 종류 · 운량 · 해 고도 · 저 · 중층 빔 투과 · DNI τ · METAR 운저).
- (PR #167) 끝에 `층 sc 300m τ10 / …` — 층별 렌더 두께와 미세물리 tauRendered. **τ 가 한 자리 수면 해 둘레 구름은 하얗게 빛남**(얇음).
- `33fps(30ms) · 구름 ×0.25 · 날씨 1.2s · 대기 10s(15파장)` — 구름 해상도 배율. **'자동' 칩이 켜져 있으면 고른 해상도(.5 · 1)보다 자동이 우선**.

## 칩(기본값)
L/M/H 품질(기기 low) · 해상도 · 뭉게 혹(billow) · 흐린 날 채우기(fill) · 위치별 햇빛(accurateSun) · 노을 그림자(low-sun shadow) · 먼 구름 가림(farSun) · 지형 대기 진단 ·
흐린 날 밝기 · 운량 격자 0/1/2(macro) · **물리 밀도(physics, 기본 켬)** · 얼음 무리(physicsIce) · 흐름(flow) · 층별 바람(flowUv) · 연속 형태(morph) · 산란 자르기(clampInscatter) · 박명 조도(irradianceLogMu) · 촬영 화면 볼륨.

## 설정 저장
`skySettings` 는 zustand persist 의 partialize 에 **없음** → 앱을 다시 켜면 코드 기본값. 기본값은 `SkyScene3D.tsx` 와 `useCelestialStore.ts` 두 곳에 있음(둘 다 바꿀 것).

## 기기에 보낼 확인 요청 요령
- 같은 시각 · 같은 방향에서 칩 하나만 끄고 켜서 두 장. 구름이 있는 시각(시간 막대)과 구름이 많이 보이는 방향.
- 계산 과정의 **구름 모양** 화면(종류 · 운량 · 높이 · 바람)을 함께 — 하네스 재현 입력.
- 사진은 EXIF 시각을 확인(앱 화면과 시각이 다르면 비교가 틀림 — 07:33 사진 대 08:13 화면).

## 출처
`docs/SANDBOX_MODE_PLAN.md §25.5~§25.9`, `src/components/SkyScreen/DevTuningPanel.tsx`, `src/components/SkyScene3D/SkyScene3D.tsx`.


## 텍스처 단위 한도(MAX_TEXTURE_IMAGE_UNITS 16) — 2026-11-26
- 증상: 구름 그늘이 사라지고 M 품질에서 화면이 검은 · 흰 블록으로 깨짐. 개발 패널 VOL 줄 끝 `텍스처 N/16` 에서 N 이 16 을 넘음(L 18, M `?`).
- 원인: 구름 패스(CloudsMaterial)와 대기 합성(EffectMaterial)의 조각 셰이더가 쓰는 샘플러가 기기 한도를 넘음. 하네스(SwiftShader)는 한도가 커서 재현 안 됨 — **진짜 GPU 에서는 `FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)`**(맥북 M4 에서 재현).
- 고침: 세포 RGB + 가장자리 A 한 장(`noiseTile`), 거시 문턱 표 `vec4[64]` uniform, 거시 A|B 가로 한 장(`macroPairTexture`), 깊이 판 읽기 제거(장면이 비어 늘 "없음"). H(17)는 한도 16 이면 M 으로.
- 점검: 새 텍스처를 구름 · 합성 셰이더에 더하면 **하네스 샘플러 수**(`run-desktop.js` 가 장면마다 찍음)가 L · M 16 이하인지 확인. 데스크탑(진짜 GPU)에서 돌릴 것.
