# 구름 배치 — 종류 · 층 · 운량 · 흐름 · 세포

한 줄: 예보 층별 운량 → 종류(genus) 판정 → 층 높이 · 두께 → 흐름 모형이 그린 날씨 무늬 → 세포 · 가장자리로 쪼갬. 갱신: 2026-11-26

## 지금 상태
- **층**: 저 · 중 · 상 3층(+ 흐린 날 채우기 fill · 모루 cbanvil 채널). 층 높이는 예보 단면에서(§67, 박아 둔 1.5/4.5/10 km 폐기). 저층 덱 두께는 예보 clamp 300~3000 m.
- **종류 판정**: 예보 변수 → `renderGenusFor` 등(liveScene). 규칙은 자(RULER-genus2)를 못 넘은 상태로 일부만 고침(§159). 예: 상층 100 % 인데 맑게 그리던 것은 DNI 로 두께 보정(§158).
- **운량 → 면적**: 예보 운량이 화면 면적이 되도록 자(§54 · §127 운량-면적 자, `cover-area-avg` 판정).
- **흐름 모형(flow, 기본 켬)**: 기압장을 삼각함수로 합성해 한 장의 날씨 무늬(§130). 층별 바람 표류 · 시어 기울임(flowUv). 2회차: 수분장 간헐성 · 프랙탈 해안선(§131).
- **거시 운량 격자(macro)**: 고리 예보 → 연속 운량 격자(스펙트럼 다운스케일링, §156). 좌표 20 km 남쪽 버그 고침(§173).
- **세포 무늬(cells, 기본 켬, PR #162)**: 고적운 · 층적운을 세포로 끊음. 8×8 주기 Voronoi 타일을 셰이더에서 읽음. 파장 λ = 2.75 × 층 두께, 운량 0.7→0.95 에서 사라짐(흐린 날 손대지 않음).
- **뼈대(skeleton)**: 종류별 발생 원리 → 밑면 · 꼭대기 · 열기둥 자리(§139). **연속 형태(morph)**, **파동 장(wave)**, **표면 혹(billow)**: 하네스 시제품, 기본 끔(billow 는 기기 설정 켬).
- **흐린 날**: 덱 구멍 · 빌보드 예산 문제를 풀고 fill 층으로 채움(OVERCAST_DESIGN). 판 구름(st · as · ns)은 판 확산.

## 코드
`liveScene.ts`(buildLiveScene: 예보 → 층), `cloudGenus.ts`(GENUS 표 · patchGenusShader), `cloudFlow.ts`/`cloudFlowShader.ts`(GENUS_FLOW 표 — flowErode · flowCarve · flowWisp …),
`cloudCells.ts`, `macroShader.ts` + `src/utils/macroField.ts`, `cloudSkeleton.ts`, `cloudMorph.ts`, `cloudWave.ts`, `cloudBillow.ts`.

## 남은 일
- 해 뜰 무렵 사진은 고적운이 작은 세포 · 틈으로 나뉘는데 앱은 큰 덩어리로 붙음(§25.8 남은 차이).
- 종류 규칙은 자를 못 넘음 — 신뢰도 낮음(§159).
- 가장자리 거칠기가 옅은 막을 문턱 위로 올려 면적이 조금 늘어남(§26) — 운량-면적 자로 다시 맞출 것.

## 출처
`docs/SKY_REBUILD_PLAN.md §5 · §18 · §19 · §21 · §25 · §41 · §54 · §67 · §109 · §124 · §126 · §127 · §130 · §131 · §135 · §139 · §141 · §144 · §147 · §155 · §156 · §158 · §159 · §172 · §173`,
`docs/CLOUD_VARIETY_PLAN.md`, `docs/OVERCAST_DESIGN.md`, `docs/MORPH_PLAN.md`, `docs/WAVE_FIELD_DESIGN.md`, `docs/FLOW_CHEAP_MATH_SURVEY.md`, `docs/ATMOS_DYNAMICS_SURVEY.md`, `docs/SANDBOX_MODE_PLAN.md §24`.
(§130 이전 절 다수는 목차 요약 — 본문 미확인)
