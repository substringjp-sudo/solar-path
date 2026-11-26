# 구름 미세물리 — 소광 · 세로 단면 · 광학 두께 τ

한 줄: 종류와 기온 · 기압에서 액체수(LWC) · 물방울 크기 → 소광 β → 기둥 광학 두께 τ. 2026-11-26 부터 기본 켬. 갱신: 2026-11-26

## 지금 상태
- `volumetricPhysics` 기본 **true**(PR #166). 개발 패널 칩 이름 "물리 밀도". 얼음 광학(physicsIce, "얼음 무리")은 끔.
- 단열 단면 h^(2/3): 밑면이 옅고 위로 짙음 → 아래에서 올려다본 몸통에 그늘이 생김(그늘이 없던 주된 원인은 총량보다 세로 단면).
- **렌더 보정(PR #167, `physicsRenderComp` 기본 켬)**: 날씨 무늬 · 모양 잡음 · 깎기가 구름 속 밀도를 깎는 몫을 되돌림.
  남는 몫(머리 위 기둥 τ 중앙값 ÷ tauRendered): 층적운 0.41, 고적운 0.38, 적운 0.20 → 배율 1/몫(최대 2.5). 판 구름은 1.
- 개발 패널 상태 줄에 층별 `종류 두께m τ`(tauRendered) 표시(PR #167).

## 핵심 수치 · 식
- LCL ≈ 125 m·(T − Td). 습윤단열 감률 Γm, 응결률 (cp/Lv)(Γd − Γm). 실제 LWC = f_ad · LWC_ad.
- r_eff = 1.08·(3 LWC / (4π ρw N))^(1/3), β = 1.5·LWC/(ρw r_eff). τ ≈ 3·LWP / (2 ρw r_e).
- 종류별: sc f_ad 0.6 · N 250 /cm³, ac 0.7 · 150, st 0.8 · 200, ns 0.15 · 150, cu 대류(f_ad = max(0.15, e^(−h/1.2 km))) · 400.
- 기둥 τ(표준대기, 렌더 봉투 전 → 후): sc 750 m 52.9→44.7, cu 1600 m 172→75, ac 400 m 12.4→7.9, st 400 m 24.6→23.1, as 1500 m 3.5→3.4.
  두께 300 m 층적운 ≈ 11.8→10.0, 500 m ≈ 27→23 (τ ∝ H^(5/3) 꼴).
- 옛 프리셋(손값 densityScale)의 기둥 τ = 0.597·ds·H: sc 98, cu 210, ac 29, st 48, as 134 — 미세물리보다 두꺼움(고층운은 40 배).
- 실제 층적운 LWP 50~150 g/m² → τ 약 7~22.

## 코드
`src/components/VolumetricProbe/cloudPhysics.ts`(layerPhysics · adiabaticLWC · effRadiusLiquid · GENUS_MICRO), `volumetricScene.ts`(physShape · PHYS_RENDER_KEEP · physRenderComp),
예보 층 두께는 `liveScene.ts`(예보 덱 두께 clamp 300~3000 m), 상태 줄은 `SkyScene3D.tsx`(layerOpticsNote).

## 측정 요령
- 머리 위(EL 89°) 렌더의 알파로 τ = −ln(1−α). **takram 낮은 품질은 투과율 1 % 근처에서 행진을 끝내 알파가 잘림** → `debugDensityMul` 0.02~0.05 로 낮춰 선형 구간에서 재고 나눔.
- 디버그 색 채널로 잴 때는 톤매핑 LINEAR(job.tone 0) · 노출을 고려해 채널 포화를 피할 것(포화로 잘못 읽은 적 있음, §25.9).

## 남은 일
- 기기에서 상태 줄 τ 로 실제 값 확인(얇은 예보 덱이면 해 둘레가 하얗게 빛남).
- 운량-면적 자(§127)로 면적 다시 맞추기, 고적운 세포 크기.

## 출처
`docs/SKY_REBUILD_PLAN.md §135 · §136 · §137 · §141 · §158`, `docs/SANDBOX_MODE_PLAN.md §25.4 · §25.7 · §25.9`, `tools/genus-ruler/flow/RULER-physics2.md · RULER-physics3.md`.
