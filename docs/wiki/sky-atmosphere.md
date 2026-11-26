# 하늘 · 대기 · 노을 색 · 박명

한 줄: Bruneton 사전계산 대기(파장 15개)로 하늘색 · 해 조도, 표시 곡선 · 화이트밸런스로 카메라 같은 색. 갱신: 2026-11-26

## 지금 상태(출처 목차 · 머리 문장 요약 — 본문 대조 필요)
- 대기 표: takram three-atmosphere(Bruneton). 3파장 표는 박명이 자주색으로 뜸 → **15파장 분광 표**(§128, `spectralAtmosphere.ts`). 하네스 `load` 인자는 3파장이라 쓰지 말 것.
- 박명 곡선: 해 진 직후 너무 빨리 어두워지던 것 — 다중산란 척도고도, 오존 τ 밴드 적분(TWILIGHT.md).
- 노을 색: 대비 · 방위각 감쇠(반대편 번짐 막기, §24) · 고도 축(따뜻함은 단일산란 · 지렛대는 에어로졸, §26) · 초록 · 카키 기 제거(§16).
- 스치는 햇빛: 둥근 대기를 지나는 광선, 자리마다 다른 해 고도(§105 · §106). 해 쪽 먼 구름 가림(§103).
- 표시 곡선: AgX · ACES · Neutral 을 사진 밝기비로 잼(§125), 앱은 ACES. 색상 보존 톤 곡선(§122). 카메라 화이트밸런스(§89 · §30).
- 미세먼지 · 연무(§146), 태양 원반 보임 조건 · 분광 색(§151 · §152), 장면 측광 노출은 해 보고 안 넣음(§107). 자동 노출 표 `AUTO_EXPOSURE_POINTS`(해 고도별).
- 지금 남은 것: 해 진 뒤 분홍은 '아치 빛'(§174) — T_sun · 아치 빛은 하네스 전용 도구, 기본 끔(§176~§181).

## 코드
`spectralAtmosphere.ts`, `spectralTables.ts`, `volumetricScene.ts`(autoExposure · ToneMapping), `src/utils/atmosphere.ts`(옛 하늘 모형), `src/utils/sunVisibility.ts`, `lightingFix.ts`, `cloudTsun*.ts` · `archQuad.ts` · `tsunAtlas.ts`(하네스 전용).

## 출처
`docs/TWILIGHT.md`, `docs/CLOUD_PHYSICS.md`, `docs/SKY_REBUILD_PLAN.md §4 · §14 · §16 · §20 · §22 · §24 · §26 · §30 · §31 · §38 · §44 · §89~§91 · §103~§108 · §122 · §125 · §128 · §146 · §151 · §152 · §174~§181`.
