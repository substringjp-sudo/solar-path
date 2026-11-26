# 구름 빛 — 직사광 · 하늘빛 · 확산광 · 그늘

한 줄: 구름 색 = 들어온 빛의 색(물방울은 회색 Mie 산란). 직사광은 해 쪽 추적으로, 하늘빛 · 확산광은 위쪽 기둥 두께로 정함. 갱신: 2026-11-26

## 지금 상태(main, PR #167 병합 포함)
- **cloudLight 'physical'(기본, PR #163)** — 종류 모형(genus)이 켜졌을 때.
  - 해 쪽 직선 추적(`genusMarchSun`): 구름층 꼭대기까지 기하로 N 걸음(평소 8, 끌기 중 6). 고도 문턱 없음.
  - 그림자 지도(BSM)는 구름 자기 그늘에 안 씀 → 빛줄기 꺼진 품질(low)에서는 그림자 지도 패스 건너뜀.
  - 해 쪽 추적 전용 가벼운 날씨 읽기(`gLite`: 결 비틀기 · 세포 건너뜀), 두께 24 에서 멈춤.
  - 노을색(gWarmChroma)은 직사광 몫(gSunPart)에만. 붉은 가장자리 하드코딩(gRim) 삭제.
- **그늘 하늘빛(skyPhys)** — 위쪽 기둥 두께 τ_up 의 두-흐름 확산 투과:
  `J_sky = E_h · [D(τ_up, τ_tot; 2) + e^(−2(1−g)τ_up)] / 2π`, **E_h = skyIrradiance / 2π**(takram 의 skyIrradiance 는 평면 조도 × 2π).
  이 1/2π 를 빠뜨려 2π 배 밝았던 것을 PR #165 에서 고침(#164 는 임시로 끔).
- **판 확산 비중** `deckWeight(cover)`: 운량 0.6→0.95 에서 두-흐름 확산광(흐린 날 덱용)을 0→1 로 섞음. 판 구름 종류(thru)는 늘 1.
- **PR #167(§25.8)**: 해 쪽 첫 걸음 ≤ 40 m(`SUN_MARCH_FIRST_MAX_M`, 배율 `s = max(1.6, (dTop/40)^(1/(N−1)))`) — 해가 낮을 때 첫 걸음이 ~500 m 라 표면 100~200 m 를 놓치던 것.
  먼 거리 가림 지도(farSun)가 켜지면 추적 상한 12 km(`FAR_NEAR_KM`) — 12~40 km 그늘을 두 번 세던 것.
- **먼 거리 가림 지도(farSun, 기본 켬)**: 해 고도 10° 아래, 예보 고리로 12~420 km 해 쪽 광선의 층별 가림 → 해 조도에 곱함. `farSun.ts`
- **위치별 햇빛(accurateSun)**: 기기 91°(늘), 표본마다 해 조도.

## 핵심 수치
- takram 다중 산란 근사: 옥타브 8, a = b = c = 0.5. 위상: 이중 HG(0.7 / −0.2, 섞음 0.5).
- 두-흐름 확산 투과 `T(τ) = 1/(1 + 0.75(1−g)τ)`, g = 0.85. 판정 몬테카를로(판, 광자 20만) 대비 근사 0.41~0.81 배.
- 해 쪽 걸음 합 = 꼭대기까지 거리(상대 오차 1e-9) — `verify-cloud-light.js`.

## 코드
`src/components/VolumetricProbe/cloudGenus.ts`(GENUS_LIGHT_DECL · genusMarchSun · patchSunMarchLite · injectGenusDiffuse mode 4 · deckWeight · diffuseTransmission · sunMarchGrowth),
`volumetricScene.ts`(applyCloudLight · setSunMaxM · physLight), `cloudDiffuse.ts`, `farSun.ts`, `lightingFix.ts`(§178).

## 결정과 이유
- 고도별 특수 스위치(낮은 해 전용 그림자 지도 등) 대신 일반 그늘 계산으로(사용자, 2026-11-25).
- 가장자리 붉은빛은 하드코딩 말고 빛 계산에서 나오게.
- 비교 이미지를 결과마다 보여 줄 것.

## 남은 일
- 해 쪽 하늘이 더 밝은 비대칭(해를 가린 몸통이 해 쪽 하늘도 가림)은 하늘빛에 미반영.
- 노을색 곱하기는 ACES 보정용 임시 항 — 노출 · 톤 단계로 옮길지.
- 기기 프레임 시간 측정(하네스 SwiftShader 시간은 믿을 수 없음).
- 해 뜰 무렵 사진은 몸통 대부분이 분홍(작은 세포 사이로 빛) — 앱은 세포가 큰 덩어리로 붙어 몸통이 남색. 빛이 아니라 [모양](cloud-shape.md) 쪽.

## 출처
`docs/SANDBOX_MODE_PLAN.md §25 · §25.1~§25.9`, `docs/CLOUD_PHYSICS.md`, `docs/SKY_REBUILD_PLAN.md §36 · §38 · §40 · §46 · §47 · §103~§106 · §118 · §138 · §140 · §176~§181`, `docs/WAVE_FIELD_DESIGN.md §11`.
