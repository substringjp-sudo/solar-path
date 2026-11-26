# 구름 모양 · 질감 — 경계 · 잡음 · 알갱이

한 줄: 날씨 무늬가 덩어리를 정하고, 셰이더의 문턱 · 모양 잡음 · 깎기 · 가장자리 fBm 이 경계와 속을 만든다. 갱신: 2026-11-26

## 지금 상태
- **밀도 식(종류 모형)**: `d = clamp((lw − (1 − hs))·edge, 0, 1)` — lw 날씨 값, hs 세로 단면(돔 · 렌즈), edge 경사. 흐름 모형에선 d × lw^densPow, 그 위에 깎기(erode) · 찢기(carve) · 결(grain/wisp).
  깎기는 가까운 곳(발자국 0.25~1.2 km), 찢기는 2.5~12 km 까지만.
- **takram 낮은 품질(기기 기본 'low')**: shapeDetail · turbulence 꺼짐 — 세부 잡음이 없어 경계가 매끈해지기 쉬움.
- **가장자리 기본 거칠기(PR #167, `edgeRough` 기본 0.5)**: 문턱을 주기 fBm(2 km 타일, 옥타브 500~31 m, 세기 ∝ 파장^0.3)으로 흔듦. 맑은 하늘(lw = 0)은 그대로, 층 표류를 따라감, 모든 종류 공통.
  첫 시도(4 km · 파장^0.7)는 경계를 km 단위로 옮겨 세포 틈을 메웠음.
- **질감 계획**: "붓을 캔버스보다 작게" — 실제 사진과의 차이는 색이 아니라 공간 주파수(CLOUD_TEXTURE_PLAN, 6단계 완료).
- **가장자리 흰 알갱이(sparkle grain)**: 진단 · 제거(§140), 알갱이 자 RULER-grain(§169).
- 밑면 둥글게: 적운 · 층적운 base 0.3(§145). 고적운 입체감 · 투명도(§148).

## 핵심 수치
- 렌더가 구름 속 밀도를 남기는 몫(미세물리 tauRendered 대비 중앙값): sc 0.41, ac 0.38, cu 0.20 → [미세물리](cloud-microphysics.md) 렌더 보정.
- 가장자리 거칠기 면적 변화(불투명 > 0.5): 동쪽 0.911→0.922, 머리 위 0.339→0.394(0.5).

## 코드
`cloudEdge.ts`(makeEdgeNoiseData · patchEdgeShader · edgeModulate), `cloudCells.ts`, `cloudGenus.ts`(GRAIN_* · injectGrainErode), `cloudFlowShader.ts`(gErodeAmt · gCarveAmt · genusWisp).

## 남은 일
- 경계 거칠기의 면적 영향 → 운량-면적 자.
- 기기 low 품질에서 세부 잡음을 켤지(비용: 가까운 표본마다 3D 텍스처 한 번 더).

## 출처
`docs/SANDBOX_MODE_PLAN.md §24 · §26`, `docs/CLOUD_TEXTURE_PLAN.md`, `docs/SKY_REBUILD_PLAN.md §41 · §45 · §124 · §135 · §140 · §145 · §148 · §169`, `docs/WAVE_FIELD_DESIGN.md §8`.
