# 화면 · 정보 구조 · 디자인 · 샌드박스

한 줄: 탭은 공간 프레임(지금 하늘 · 지도 · 지구본)으로 묶고, 유리 재질 HUD 와 한 곳의 디자인 토큰을 쓴다. 갱신: 2026-11-26

## 지금 상태
- **정보 구조**: 문제는 3D 가 2D 를 먹은 게 아니라 표면이 7개였던 것 → 공간 프레임으로 정리(IA_REDESIGN). 등치선 · 태양경로 · 구름 레이더를 지도로 합침(§73 · §74), 줌이 지도 → 구(지구본)로(§75 · §119 · §120 · §153 · §154).
- **디자인 언어**: 값은 `src/theme/tokens.ts` 한 곳. 원칙 다섯 · 색은 역할로 · 재질 네 겹 · 말투 · 접근성 점검표(DESIGN_SYSTEM).
- **샌드박스 모드**(2026-11-19~): 두 모드, 객체 고르기(건물 · 지형), 자리와 시간 찾기, 계산 과정 보기(해 뜨는 시각 · 노을 점수 · 별 보기 · 구름 모양 주제), 학습 페이지 하나로, 조이스틱 연속 이동 · 높이 · 줌 막대, 장면 저장, 유리 HUD · 접는 아래 막대 · 모드 줄(SANDBOX_MODE_PLAN §1~§23).
- **데이터 페이지**: 점수 · 한계등급 가감 막대. 앱 켜기 줄이기(저장 계층).
- **개발 패널**: 전문가 모드에서 머리줄 슬라이더 단추 **길게 누름** — [기기 디버깅](device-debugging.md).
- 출시 점검(2026-09-30), 인터페이스 점검(2026-09-29).

## 코드
`src/components/SkyScreen/`(SkyScreen · DevTuningPanel · SandboxShootPanel …), `src/components/AppHeader.tsx`, `src/theme/tokens.ts`, `src/store/useCelestialStore.ts`.

## 출처
`docs/IA_REDESIGN.md`, `docs/DESIGN_SYSTEM.md`, `docs/SANDBOX_MODE_PLAN.md §1~§23`, `docs/UI_AUDIT_2026-09-29.md`, `docs/RELEASE_CHECK_2026-09-30.md`, `docs/SKY_REBUILD_PLAN.md §73~§76 · §97 · §119 · §120 · §142 · §143 · §153 · §154`.
