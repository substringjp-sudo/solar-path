# 격자 안 대기 동역학: 예보 자료로 공기의 상승·골마루·구름 자리를 되살리는 연구·알고리즘 조사 (2026-10-28)

> "결국 큰 격자 안에서 다시 최대한 유사하게 공기의 대류나 분포를 모델링하는 게 중요해 보이지? 기압·온도·습도·풍속·풍향을 근거로 내부에서 공기가 어떤 모양으로 골과 마루를 만들고, 이것들이 겹쳐서 구름이 생길 공간이 될지를 시뮬레이션할 수 있게 해야 하는데, 바람의 벡터장으로 미분방정식을 풀거나 푸리에 변환으로 대기밀도장 방정식을 만들어 풀 수 있는 연구·논문·알고리즘을 찾아볼까?"
> 대상: `src/utils/macroField.ts`(128² × 6 km, 768 km 상자), `src/utils/weather.ts` 고리 91 점, `src/components/VolumetricProbe/cloudMorph.ts`·`cloudSkeleton.ts`, 실패한 `cloudFlow.ts`(§130~131, 기본 꺼짐), `src/utils/demCpu.ts`.
> 방법: 5 각도(자료·기상 진단·그래픽스·수치·저장소 지도) 조사, 그중 3 각도(기상·그래픽스·수치)를 적대 검증. Open-Meteo 실측은 수원 2026-10-28/29(전선 통과, 48 h, ECMWF 0.25° 11×11 격자를 참값으로)와 후쿠이 73 점 고리(48 h). 비용은 node 22 실측.
> 폰 환산: 프로젝트 관례는 Hermes ≈ node × 3~10. 검증에서 `node --jitless`(해석기 대용, Hermes 아님)가 이 루프들에서 JIT 대비 × 13~37 이었음. Hermes 는 실측 못 함. 그래서 표에는 **node / jitless** 를 같이 적음. 폰 비용은 기기 실측 전까지 그 사이 어딘가로 읽을 것.
> 검토(적대 검증이 고친 것): ① 균일 U·N 의 Smith 1980 해는 **갇힌 풍하파 열을 못 만듦**(층 구조 필요), 5~10 km 파는 6 km 격자의 나이퀴스트 12 km 아래. ② PDF 결합기에서 μ 하나만 다시 풀면 **상자 평균만** 지켜짐, 국소 재정규화가 필요. ③ Santellanes 2021 의 90 % 는 훈련 자료 값, 독립 자료는 69~76 %. ④ 이류 보정 시간 보간은 앱의 1 h 간격에서 운량 이득 ≈ 0(3 h 이상에서만). ⑤ 스펙트럼 너징은 앱에 예보되는 상태가 없어 불필요. ⑥ Vimont 2.5-D·Dobashi 되먹임·Goswami 열기포는 시제품 → 참고로 강등. ⑦ "그래픽스 논문은 자리를 검증 안 함"은 틀림(Cyclogenesis 2024 는 자료 경계조건 + 태풍 경로 비교). 조사·검증 원문: 스크래치 `atmos/{data,meteo,graphics,numerics,repo}.md`·`verify-*.md`, 측정 스크립트 `atmos/bench/`(검증분은 `bench/vg/`·`bench/vn/`).

## §1 한 줄 결론과 지도

**결론**: 격자 안에서 대류를 처음부터 다시 풀 필요는 없습니다. 원시방정식은 예보 모델이 9~25 km 에서 이미 풀었고, 그 해(연직속도 w, 층별 습도 RH)는 Open-Meteo 에서 변수 몇 개로 바로 받습니다.
91 점 고리로 다시 풀면 더 나빠집니다(운동학 ω 의 상관 0.99/0.92/0.64/−0.23 at 850/700/500/300 hPa, R = 130 km). 진짜 빈틈은 방정식이 아니라 **표본**입니다: 고리로 Barnes 하면 모델 자기 w 분산의 9~14 %, 운량 분산의 37~72 % 만 재현됩니다.
예보보다 작은 규모에서 **자리까지** 자료로 정할 수 있는 건 지형에 묶인 것뿐입니다(바람받이 모자구름·풍하 갬·풍하파). 경계층 롤·세포·적운은 **자리가 아니라 레짐·간격·방향만** 탐측으로 정해집니다.
그래서 권하는 방향은 다섯 층입니다: L0 모델 자기 장을 더 받기(RH700/850 먼저, w 는 레짐 손잡이) → L1 지형 선형 FFT 해(Smith 1980 + Smith & Barstad 2004, 사용자가 말한 "푸리에로 푸는 대기밀도장" 그 자체) → L2 탐측 레짐 지도 → L3 예보 운량을 지키는 통계 구름 결합기 → L4 실제 바람으로 시간 이동·변형(예보에 묶어서).

### 1.1 사용자의 생각에 대한 답

| 생각 | 문헌·실측이 말하는 것 | 판정 |
|---|---|---|
| 바람 벡터장으로 미분방정식을 푼다 | 원시방정식·QG 는 예보가 이미 풂. 고리에서 연속식으로 다시 구한 ω 는 하층만 맞음(위 상관). 850 hPa 기온을 실제 바람으로 2-D 자유 이류하면 1 h 에 1.50 K, 그대로 두면 0.66 K(더 나빠짐). 대신 궤적 방정식(ODE)으로 무늬를 실제 바람에 태우면 3 h 늘임 중앙 1.37·p90 1.96, 면적 0.65~1.40 배 → "모임"이 생김 | 방정식은 예보에 맡기고, ODE 는 **이동·변형**에만(L4) |
| 푸리에 변환으로 대기밀도장 방정식을 푼다 | Smith 1980: 성층 흐름이 지형을 넘을 때 연직 변위 η̂(k,l,z) = ĥ(k,l)·e^{imz}, m 은 분산관계 m² = ((k²+l²)/k²)(N²/U² − k²). 밀도 섭동 ρ' = −(dρ̄/dz)·η 이므로 이것이 곧 밀도장의 푸리에 해. 실제 DEM 에서 64² 3.2 ms / 34 ms, 128² 6.7 / 149 ms | **1회차**(L1) |
| 골·마루가 겹쳐 구름이 생길 공간 | 종관 골·마루(500 hPa 파)는 파장 ≥ 1000 km, 로스비 반경 NH/f ≈ 1000 km 로 768 km 상자보다 큼. QG ω 를 풀면 상자 안은 몇 cm/s 짜리 한 덩이(16.9 ms node) → 이미 예보 운량 안에 있음. "겹침"이 위치를 정하는 건 선형 모드 중첩이 지형에 위상 고정될 때(지형파)뿐 | 종관은 예보 그대로, 중첩은 지형파에서 |
| 기압·온도·습도·풍속·풍향을 근거로 | 지금 고리에는 운량·RH2m·DNI·TCWV·강수·시정뿐. 바람·기온·지오퍼텐셜·층 습도는 **관측점 한 곳**에만 있음(`weather.ts:760`·`:854`). 코드 주석 그대로 "하늘 전체에 이류 벡터 하나" | L0 자료 보강이 먼저 |

### 1.2 지도: 무엇은 자료로 정해지고 무엇은 아닌가

| 물리 | 규모 | 자리까지 자료로? | 방법 | 판정 | 층 |
|---|---|---|---|---|---|
| 종관 골·마루, 대규모 상승 | ≥ 500~1000 km | 예, 이미 예보 운량·RH 안 | 받은 값 그대로 | 다시 풀지 않음 | L0 |
| 모델 w(전선·저기압 상승) | 유효 50~100 km(ECMWF), 20~40 km(JMA) | 예보에 있음, 고리가 못 잡음 | 모델 w 직접 받기, 레짐 손잡이 | 시제품 | L0·L2 |
| 전선 띠 방향 | 100~500 km | 예 | 온도풍(850→250 시어) 방향, 이미 `macroField` anisoDirDeg | 새 계산 없음 | L1 |
| 지형 상승·풍하 갬 | 우리 격자에서 12~80 km | **예(지형에 위상 고정)** | Smith 1980 η + Smith & Barstad 응결 | **1회차** | L1 |
| 갇힌 풍하파·렌즈구름 열 | 5~35 km | 예, 단 층별 U(z)·N(z) 와 1.5~2 km 격자 필요 | 층상 Taylor–Goldstein FFT | 2회차 이후 | L1 |
| 경계층 롤·세포 | 2~10 km | 자리 아니오, 레짐·간격·방향 예 | 탐측 문턱 선택기 | 채택(다듬기) | L2 |
| 층적운 MCC | 10~50 km | 자리 아니오, 크기 예(30~40·zi) | 이미 `cloudSkeleton` | 그대로 | L2 |
| 개별 적운 | 0.4~5 km | 아니오(대류 규모 오차 ~1 h 포화) | 통계·무작위 | 그대로 | L3 |
| KH 물결 | 0.5~5 km | 아니오(기압면 간격이 얇은 시어층을 못 풂) | — | 참고 | — |
| 해안·해풍 수렴선 | 10~50 km | 아마 예(육지·바다 가열에 고정) | 이번 조사 범위 밖 | 열린 질문 | — |
| 예보 시각 사이 이동 | 시간당 30~70 km | 상층은 예, 저층은 아니오 | 이류 보정 보간(간격 ≥ 3 h) | 조건부 시제품 | L4 |
| 무늬의 늘임·모임 | 50~300 km 변형 | 모양만(자리 아님) | 실제 바람 라벨맵 | 시제품 | L4 |

## §2 무엇을 알 수 있고 무엇은 모르는가

### 2.1 규모

| 것 | 크기 | 출처 |
|---|---|---|
| ECMWF IFS 0.25° 기압면 | 28 × 22 km(37°N), 3시간(매시는 Open-Meteo 시간 보간) | Open-Meteo ECMWF 문서 |
| ECMWF IFS HRES 9 km | 기압면 없음 | 실측 |
| ICON(동아시아) | 13 km, 기압면 w 없음 | 실측 |
| JMA MSM | 지상 0.05° 매시, 기압면 0.1°(≈ 11 km) 3시간 16층 | JMA 문서 |
| 블렌드 유효 해상도 | IFS 63~72 km, ICON ~91 km, MSM ~35 km | 저장소 §166.7 |
| w 이상치 상관 | ECMWF 15~40 km 0.43~0.60, 40~60 km 0.14~0.23, 90 km ≈ 0. JMA 15~25 km 0.20~0.38, 40~60 km ≈ 0 | 실측(한 사례) |
| T850·바람 상관 | 15~25 km 0.95, 40~60 km 0.7 | 실측 |
| RH700/500 상관 | 15~40 km 0.84~0.96, 40~60 km 0.67~0.79 | 실측 |
| 운량(저·중·상) 상관 | 40~60 km 0.5~0.7, 90~130 km 0.06~0.38 | 실측 |
| 고리 호 간격 | 5 km 고리 5.2, 10 km 5.2, 30 km 15.7, 70 km 36.7, 130 km 68, 200 km 105, 280 km 147, 380 km 199 km | 2πr/방위수 |
| 고리 안 고유 ECMWF 격자점 | 91 중 69(관측점 + 5 km 고리 = 1 점, 10 km = 2 점, 30 km = 8 점) | 실측 |
| 거시 격자 | 6 km 칸, 나이퀴스트 12 km, 768 km 상자 | `volumetricScene.ts:1119` |
| 타일 | 24 km 주기, 256² | `volumetricScene.ts:273` |
| 화면에서 보이는 면적 | 저층 운량 면적의 90 % 가 관측점 15 km 안(중층 71 %, 상층 45 %) | §166.5 |

읽는 법: 머리 위 저층 구름은 거의 다 **모델 격자 한 칸 안**입니다. 그 안의 자리는 어떤 방정식으로도 자료에서 나오지 않습니다(지형 제외). 6 km 거시 격자는 자료가 담은 정보(35~90 km)보다 이미 촘촘합니다.

### 2.2 예측 가능성 한계

- 대류 규모 오차는 ~1 h 안에 포화. 이어 균형 조정 ~2π/f(37°N 에서 19.8 h), 그 뒤 경압 성장(Zhang et al. 2007; Sun & Zhang 2016). 습윤 대류가 중규모 스펙트럼 기울기를 −3 에서 −5/3 쪽으로 바꿈.
- 강수 무늬 수명: 제자리 ~4 h, 흐름 따라가면 ~7 h, 64 km 넘는 규모만 보면 ~8 h(Germann & Zawadzki 2002, 2003 학회).
- 500 km 아래는 관성중력파가 지배(Callies, Ferrari & Bühler 2014) → 균형 모델(QG·SQG)로는 작은 규모 구름 자리를 만들 수 없음.
- 저장소 실측 상한(RULER-ringtruth §8.2, held 68 장면): 실제 NWP 고리 corr50 0.563 [0.499, 0.626] vs 위성 대용 고리 0.770. corr12 0.248 vs 0.649. 보간을 고정해도 0.591 → **예보 값 자체**가 50 km 배치의 주된 한계. jma_msm(5 km)은 Δcorr50 −0.027 로 고리 표본으로는 도움 안 됨.
- 리드: 낮 GHI 투과율 skill 0.717(L0) → 0.516(L3) → 0.199(L6). 0.5 교차 79 h.

### 2.3 강제된 자리 vs 확률적인 자리

| 구름 | 무엇이 자리를 정하나 | 우리 자료로 할 수 있는 것 |
|---|---|---|
| 전선·골 앞 층운·난층운 | 대규모 상승(QG 강제, 전선 순환) | 예보 운량에 이미 있음. 고리가 130 km 밖에서 덜 잡을 뿐(C9 표본 개선) |
| 산 위 모자구름, 풍하 갬(푄) | 지형 × 바람 × 안정도 | **결정적**. DEM + 관측점 U·N 으로 계산(C3) |
| 풍하파 줄구름·렌즈구름 | 지형 + 층별 Scorer 매개변수 | 결정적이나 층 구조와 촘촘한 격자 필요(C10) |
| 해풍 수렴선 | 해안선 × 일사 | 아마 결정적. 이번엔 미조사 |
| 롤(구름길)·세포(벌집) | 경계층 불안정 + 시어. 위치는 자발적 대칭 깨짐 | 레짐·파장·방향만(C4). Santellanes: 롤 U_CBL 평균 9.1, 세포 3.5, 무조직 5.9 m/s |
| 닫힌·열린 MCC | 경계층 깊이·이슬비 | 크기만(λ ≈ 30~40·zi). 열림/닫힘 유형은 대규모 기상에 둔감(Wood & Hartmann 2006) |
| 개별 적운 | 열기포 무작위 | 통계만(크기 분포·간격) |

정직한 한 줄: **6 km 칸마다 "여기 구름"을 정할 정보는 지형 밖에서는 없습니다.** 나머지는 예보 양을 지키면서 모양·레짐·움직임을 자료에 맞추는 일입니다.

## §3 자료: Open-Meteo 가 실제로 주는 것

### 3.1 모델별 실측(2026-10-28 수원, 일부 후쿠이; historical-forecast-api 는 2026-10-18·2026-09-10·2023-06-15)

| 모델 | 기압면 w | 기압면 RH·T·Z·바람 | 층 운량 | 지상 대류 변수 | 보관 시작 |
|---|---|---|---|---|---|
| `ecmwf_ifs025` | ○ (m/s) | ○ 13층(1000~50, **800 없음**), 3시간 | RH 의 고정 함수 | CAPE ○. CIN·LI·BLH·결빙고도·열속·시정 × | 2024-02-03 |
| `ecmwf_ifs`(HRES 9 km) | × | × 기압면 자체 없음 | — | — | — |
| `icon_seamless` | × (null, 단위 'undefined') | ○ (단 2023-06-15 보관은 전부 null) | RH 의 고정 함수 | CIN ○, SHF ○(음수 = 상향) | 2022-11-24 |
| `gfs_seamless`·`gfs025` | ○ | ○ 44층(10 hPa 까지) | RH 만의 함수 아님 | SHF ○(양수 = 상향), CIN ○, LI ○ | 기압면 2021-03-23 |
| `jma_seamless`·`jma_msm` | ○ | ○ 0.1° 3시간 16층. Z 는 ≈ 9.81 m 계단 | Sundqvist 1989 근사(문서) | CAPE·CIN·LI·BLH·TCWV × | 2016-01-01 |
| ukmo·cma·ecmwf_aifs025 | ○ | ○ | — | — | — |
| gem·arpege | × | ○ | — | — | — |
| `kma_*` | 모든 변수 null(KIM 이전 중 갱신 중단) | — | — | — | — |
| `best_match`(수원) | jma_seamless 와 값이 같음 | 같음 | — | — | — |

- w 단위·부호: m/s, 0.01 반올림, 양수 = 상승(문서에 부호 없음. 경험: r(w700, 강수) = +0.34, r(w700, RH700) = +0.29). ECMWF 는 ω(Pa/s)를 층 기온으로 바꿈. 0.01 m/s ≈ 0.068 Pa/s ≈ 2.4 hPa/h(500 hPa). 정확히 0 인 값: 925~300 hPa 에서 8.5~18 %, 1000 hPa 에서 27~41 %.
- 층 운량은 ECMWF·ICON·JMA 에서 RH 의 거의 고정 함수: RH 76 % → 10 %, 86 → 30, 94 → ~56, 99 → 81, 100 → 100(약 60 개 RH 값 중 5 개만 둘 이상의 운량). `C = 1 − sqrt((1−RH)/(1−RH_c))`, RH_c ≈ 0.75 꼴. → **층 운량을 따로 받을 이유 없음, RH 가 연속판**.
- 격자점 선택: Open-Meteo 는 공간 보간을 안 하고 격자점 값을 줌. 기본 `cell_selection=land` 에서 ECMWF 고리 91 점 중 9 점이 최근접 격자점이 아니었고 오프셋 평균 7~10 km, 최대 22 km(JMA 2~3.6 km).
- 앱 재현 날짜별 공백(`weatherSource.ts:10-11`): ≥ 2024-02-03 historical 블렌드(ECMWF w ○). 2022-11-24 ~ 2024-02-02 historical-icon(ICON 단독, w ×, 2023-06-15 에는 기압면 전부 null → jma_seamless·gfs_seamless 로 메꿔야). 그 전은 archive(ERA5, 기압면 지원 미검증). 관측점 요청은 `best_match`(`weatherSource.ts:55`).
- 고리 응답마다 점별 `elevation` 이 오지만 앱은 버림.

### 3.2 요청 가중 비용(가중 = Σ 위치 max(1, V/10, V/10·D/14), V = 변수 × 모델; 한 번 받으면 1~2 일분)

| 추가 | 가중/요청 | 비고 |
|---|---|---|
| 지금 고리(8 변수 × 2 모델 × 91 점) | 145.6 | `weather.ts:1116`, `modelBlend.ts:44` |
| 블렌드 고리에 변수 1 개 | +18.2 | RH850+RH700 = +36.4 |
| ECMWF 전용 별도 요청, 중복 뺀 69 점, 변수 ≤ 10 | +69 | 변수 4 개 이상이면 블렌드에 붙이는 것보다 쌈. null 캐시로 고장 격리(`weather.ts:736-738`·`843-850` 방식) |
| 관측점 w 15층 | +1.5(3.3 → 4.8) | |
| 관측점 바람 925/700/500 | +0.6 | Scorer·CBL 바람 |
| 관측점 SHF | +0.1 | ICON·GFS 만, 부호 반대 |
| 고리 u,v at 850·500(블렌드 4 변수) | +72.8 | 라벨맵용 |
| 고유 격자 해쪽 쐐기 ±20°, 380 km, 0.25° | 83 | 0.5° 면 22 |
| 0.5° 원판 r ≤ 380 km | 181 | |
| 0.25° 원판 / 768 km 상자 | 733 / 945 | 한 요청이 분당 600 을 넘음 → 나눠야(가중 호출로 세는지는 미검증) |
| 하루 한도 10,000 | 지금 ~68 위치-일/일 | +69 / +185 / +740 이면 47 / 30 / 11 |

### 3.3 고리에서 유도할 수 있는 것과 그 오차(모두 고리에 바람·T·Z 를 추가해야 함)

| 양 | 방법 | 실측 오차 | 판정 |
|---|---|---|---|
| 발산 D | 선적분 D ≈ (2/R)·mean(V_r) = LSQ 평면 | R ≥ 30 km 에서 두 방법 0.3e-5 s⁻¹ 안 일치, 격자 중심차분과 맞음. R = 10 km 는 격자점 2 개라 불량(D 절댓값 100~2000e-5). rms(850) 2.9 / 1.9 / 1.2 / 0.67 / 0.33 / 0.33 e-5 (R 30~380). 격자 발산과 r 0.62~0.72 | 면적 평균만 |
| 와도 ζ | 같은 꼴(접선 성분) | 격자와 r 0.78~0.87. rms 4.5 → 0.8 e-5 | 같음 |
| 변형 | 2차 방위 조화 | 격자 참값과 r 0.80~0.87, 크기 13 % 안 | 라벨맵 입력으로 충분 |
| 운동학 ω | 연속식 적분 + O'Brien 보정 | 6층 R 130: r 0.99/0.92/0.64/−0.23. 12층 + O'Brien: 300/200 hPa 에서 0.82~0.86 / 0.72~0.80. 중층 오차는 여전히 신호의 60~80 %. JMA 는 700 hPa r −0.49~0.28 | 모델 w 가 있으니 대체용만 |
| 같은 층 수렴 → 상승 | — | r ≈ 0(0.21 / −0.11 / −0.04 / 0.03) | 쓰면 안 됨 |
| 지균풍·QG | Z 평면 맞춤 | Vg500 vs 실제 rms 2.4~3.9 m/s(R 70~280). Z 1 m 반올림 잡음이 ζ_g 에 30 km 간격 1.6e-4 s⁻¹(신호보다 큼), 130 km 0.9e-5. JMA Z 는 9.8 m 계단 | R ≥ 130 km 만 |
| 850 기온이류 | −V·∇T | 국지 dT/dt 와 r −0.23~0.15 | 쓸모 없음 |
| 모델 자기 장을 Barnes 로 재현(135 km 안 비고리 55 점, 설명분산) | 앱 σ = max(6, 0.6·간격) | w700 0.14, w500 0.09, T850 0.70, 바람850 0.68, RH 0.49~0.82, 운량 0.37~0.72 | **w 는 고리로 표본 불가** |

## §4 후보 표(살아남은 것)

순위 = 자료에 충실한 **보이는 이득 / ms**. C1 은 그 자체로는 안 보이고 C3·C6 의 통로라 C3 와 묶어 1 위.

| # | 이름 | 출처 | 무엇을 계산 | 입력(있음/없음) | 규모 | 비용 node / jitless | 화면 효과 | 실패 모드 | 이전 시도와 | 판정 | 순위 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C3 | 지형 선형 FFT: Smith 1980 변위 η + Smith & Barstad 2004 응결수 | Smith 1980 Tellus; Smith & Barstad 2004 JAS; Durran 2015; fastscape-lem 코드 | 바람받이 들림·풍하 내림 η(x,y,z), 기둥 응결수 q_c(아래 거리 U·τ_c ≈ 12 km 밀림) | 있음: DEM z6(~1.9 km px), 관측점 850 바람, N(T 15층). 없음: 공간에 따라 변하는 U·N | 거시 격자에서 12~80 km | 실측 64² 3.2 / 34 ms, 128² 6.7 / 149 ms(2 고도 + S&B), 256² 패딩 33.5 / 625 ms | 산 위 모자구름·두꺼운 밑면, 풍하 갬, DEM 지평선과 맞물림 | Nh/U > 1 막힘(후쿠이 2.4) → min(h, U/N) 자르기는 경험칙. 균일 U·N 은 갇힌 파열 없음. 겨울 계절풍 대류 경계층(N² ≤ 0) 무효. 임계층(후쿠이 21 UTC). 예보가 이미 푼 지형 이중 계산(s ≈ 8~11 km 걸러야). 바다·평지 0. 주기 상자 줄무늬(σ_min 감쇠로 고침) | cloudFlow 의 무작위 ψ0 대신 자료. 같은 `fft2`(`cloudFlow.ts:272`). 이전 문서에 없음 | 시제품, **1회차** | 1 |
| C1 | 통계(PDF) 구름 결합기 + 국소 재정규화 | Sommeria & Deardorff 1977; Tompkins 2002; Sundqvist et al. 1989; Tompkins 2008 강의 | C = Φ(Q̄ + κη), κ = 5.55e-4·q_s/σ_s [m⁻¹], Q̄ 를 ~47 km 발자국마다 다시 맞춰 예보 운량 보존 | 있음: 고리 층 운량, 관측점 RH·T. 없음: 고리 RH700/850(σ_s) | 6 km 칸, 효과 ≥ 12 km | 실측 1.7 / 41 ms(전역 μ 이분 30 걸음). 국소판 추정 +1~2 / +40 ms | 같은 양, 자리만 상승 쪽으로 | C = 0·1 에서 자유 없음. RH2m 대리 틀림. 가우스는 적운에 틀림(Beta·이중 가우스). μ 하나만 풀면 상자 평균만 지킴. 셰이더는 타일 운량 위로 못 더함(`macroShader.ts:99-118`) | `macroField` 의 Y = μ(x) + Z 가 Z 무작위인 같은 틀. FLOW A4 는 d 사상표로만 썼음 | 채택(통로) | 1(C3 와 묶음) |
| C4 | 경계층 조직 선택기(롤/세포/없음) | Santellanes et al. 2021; Weckwerth et al. 1997; Banghoff et al. 2020; Brümmer 1999 | 롤이면 U_CBL ≥ 6 m/s 또는 시어 > 2e-3 s⁻¹. 무조직이면 zi < 1100 m. 파장 2~10 km, 방향 = BL 바람 ±10°(최대 30°) | 있음: BLH, 850 바람. 없음: 925 바람·SHF(+0.3) | 2~10 km(타일) | ~0 | 바람 센 날 구름길, 잔잔하고 더운 날 벌집, 얕은 PBL 은 무질서 | 독립 자료 정확도 69~76 %. 무조직은 U 로 못 가림(무조직 50 중 18 이 U > 6). 오클라호마 여름 육상 자료. 동해 한기 유출은 다름 | `cloudSkeleton.ts:74` ROLL_MIN_MPS 5 → 6 + 시어·zi 문, `cloudMorph` aniso | 채택(다듬기) | 2 |
| C2 | 고리에 RH850·RH700 | Open-Meteo 실측; Sundqvist 1989 | 칸별 σ_s 와 "포화 여유"(맑지만 RH 높은 곳) | 없음 → +36.4 | 상관 40~60 km 0.67~0.79 | Barnes 공유 가중 1.1 ms/장(node) | 거의 포화된 맑은 공기에서만 지형·상승 구름이 생기고 마른 공기에선 안 생김 | 자리 정보 자체는 층 운량과 거의 같음(r(RH700, 중층운) 0.69) | 지금 RH2m 은 관측점만 남김(`weather.ts:1185-1187`) | 채택(2회차) | 3 |
| C5 | Scorer + 1-D Taylor–Goldstein 파 게이트 | Durran 2015; Scorer 1949 | 갇힘 조건 l_L² − l_U² > π²/(4H²), 공명 파장 경계 2π/l_L ~ 2π/l_U. 실제 λ 는 1-D 고유값 | 있음: T 15층. 없음: 바람 925/700/500(+0.6) | λ 2~35 km, 타일 층 | < 0.1 ms(고유값 1 ms 미만) | 파동 구름 줄 간격과 켬/끔을 자료로(후쿠이 03 UTC: 4.9 / 7.2 / 9.4 km, H > 1.44 km 충족) | 방향 시어·U ≈ 0 임계층. 바람 3층이라 U'' 거침. 한 기둥이 상자 전체 | FLOW A20·`cloudMorph` wave 손잡이를 자료로 | 시제품 | 4 |
| C9 | 고유 격자 쐐기 표본(cell_selection=nearest) | Open-Meteo 문서·요금; 실측 상관 길이 | 모델 w·RH·운량을 격자점에서 직접(해쪽 쐐기) | 없음 → 83(0.25° 쐐기) ~ 181(0.5° 원판) | 25~100 km | Barnes·쌍선형 10~40 ms node | 해쪽 25~100 km 띠·구멍·전선 가장자리가 모델 그대로 | 예산(위치-일 47 → 11). 분당 한도. 3시간 기압면. 보간 고정 corr50 0.591 → 예보 값 한계가 커서 이득 상한이 크지 않을 수 있음 | `macroField` 입력 교체 | 시제품 | 5 |
| C6 | 모델 w 레짐 손잡이 | Open-Meteo 실측 | 상승 → 판 쪽(convectivity c ↓, 두께 ↑), 하강 → 깨짐·얇아짐, 시간 경향 부호 | 없음: w700(+18.2 블렌드, 또는 C9·ECMWF 묶음) | ≥ 50~100 km | Barnes 공유 1.1 ms | 레짐·두께 미세 조정 | 자리 상관 약함(중층운 r 0.22, 시각별 −0.38~+0.28). ICON null. 0.01 양자화. 2022-11~2024-02 재현에 없음 | FLOW B2 의 Ekman·Zel'dovich 대신 실자료 | 시제품 | 6 |
| C7 | 실제 바람 라벨맵 변형 | Stam 2001; Lapeyre, Klein & Hua 1999; Methven & Hoskins 1999 | 지난 3~6 h 역방향 흐름맵 X(x)(발산 포함), 잡음과 타일 좌표를 X 로 읽음 | 없음: 고리 u,v 850·500(+72.8) | 변형 50~300 km, 보이는 건 타일 좌표 휨 1~5 km | 실측 9 걸음 64² 1.5 / 41 ms, 128² 10.9 / 187 ms | 늘임 중앙 1.37(p90 1.96)/3 h, 수렴대에서 35~50 % 압축 → 모이는 띠 | 자리는 여전히 무작위(등치선–늘임축 정렬 cos 2a 0.0~0.15, RH300 만 0.34). 6 h 넘으면 대리석 무늬. 셰이더가 타일을 x − D(x) 로 읽어야 보임 | cloudFlow 라벨맵 기계 재사용, ψ0 → 실제 바람, B2 "못 모임" 해결 | 시제품 | 7 |
| C8 | 이류 보정 프레임 보간(간격 ≥ 3 h 만) | Anagnostou & Krajewski 1999; Germann & Zawadzki 2002; Pulkkinen et al. 2019 | q(t) = (1−a)·q_A(x − U(t−t_A)) + a·q_B(x + U(t_B−t)) | 있음: 관측점 층 바람(단일 바람 ≈ 공간 바람) | 시간 | 균일 이동 128² 0.29 / 4.4 ms, 셰이더 ~0 | 상층 판이 사라졌다 나타나지 않고 미끄러짐 | 6 h 간격 ECMWF: RH500 12.3 → 7.0 %, 상층운 20.2 → 12.0 %(단 300 hPa 이동 600 km 라 궤적 100 % 고리 밖). 2 h 간격 ICON: 중층 8.50 → 8.23(평활 혼합 8.13), 상층 10.68 → 10.94 악화. 저층·T850 악화 | `weather.ts:1222` 점별 선형 교차 페이드 대체. texA/B 는 예보 프레임 아님(AR(1) 60 s) | 조건부 시제품 | 8 |
| C10 | 층상 3-D Taylor–Goldstein 풍하파 | Vosper 2003; Sharman & Wurtele 1983; Durran 2015 | U(z)·N(z) 층별 모드 해(σ → σ − iε 인과) | 있음: 탐측·DEM. 없음: 바람 층(+0.6), 1.5~2 km 격자 ~200 km 상자 | λ 5~35 km | 실측(8층, 2 고도) 64² 17 / 173 ms, 128² 64 / 671 ms | 산 뒤 평행 띠 구름 열(실험: 2층 → ~9 km 열, 균일 N → 없음) | 막힘 비선형. 수평 균일 가정. 비용. 타일 층으로 넣는 길 필요 | C3 확장, x-z 단면보다 ~100 배 쌈 | 시제품(2회차 이후, 캐시·GPU) | 9 |
| C11 | 오프라인 레짐 타일 | Schneider 2023(Nubis³); Garcia-Dorado et al. 2017 | 안정도·시어·습도 격자마다 오프라인 물리 모사 → 주기 타일 | 있음 | 24 km 타일 | 런타임 0, 오프라인 솔버 없음 | 레짐별 그럴듯한 형태 | 자리 아님. 반복. 레짐 섞기 뭉개짐 | 지금 genus 타일과 같은 틀 | 시제품(형태 전용) | 10 |

이미 있는 바탕(그대로 유지): 통계 축소(RainFARM·STEPS·pysteps 꼴) = 지금 `macroField`. 문헌·예측 한계가 이 바탕이 맞다고 말합니다. 동역학은 그 위에 **변형·프레임 보간·지형 강제**만 더합니다. 소품: pysteps 는 규모별 AR(2) 가 ~3 h 까지 자기상관을 맞춘다고 보고(AR(1) 대신 후보, 미측정).

### 4.1 참고만(쓸 조각이 있는 것)

| 이름 | 출처 | 왜 참고만 | 쓸 조각 |
|---|---|---|---|
| 운동학 ω + O'Brien | O'Brien 1970; Bellamy 1949; Davies-Jones 1993; Bony & Stevens 2019 | 모델 w 를 직접 받음. ICON 구간 대체도 jma·gfs w 가 나음 | 고리 발산 공식, 오차식 σ_D ≈ (2/R)·σ_vr/√N |
| QG ω·Q 벡터 | Hoskins, Draghici & Davies 1978; Rantanen et al. 2017(OZO) | L ≳ 1000 km > 상자. 상자 안은 몇 cm/s 한 덩이(16.9 ms node) | 설명용 겹그림 |
| 전선발생·F 벡터 | Keyser, Reeder & Reed 1988; Petterssen | 바깥 고리 간격 70~200 km 로 전선 기울기 못 풂. 띠 방향은 온도풍으로 공짜 | 0.7 ms / 13 ms 묶음 |
| 자유공간 그린 함수 분해 | Bishop 1996; Lynch 1989; Li, Chao & McWilliams 2006 | 반라그랑주는 u,v 를 그대로 씀 | 교훈: 비주기 바람의 주기 FFT 분해는 발산풍 오차 ~400 %(자유공간 3 %) |
| x-z 단면 부시네스크 | Garcia-Dorado et al. 2017; Harris et al. 2003 | 막힘 비선형 흐름의 업그레이드 길, GPU 전용(jitless 512×64 184 ms/걸음) | 오프라인 표(세포 간격 vs 안정도·시어) |
| Vimont 2.5-D 층 모델 | Vimont et al. 2020 | 결합 상수 λ·ν·μ 값이 논문에 없음, 인쇄된 부호는 안정 방향, 6 km 칸에선 격자점 대류. FFT 투영 128²×4 25.5 / 636 ms/걸음 | 기압면 = 층 배치 |
| Dobashi 되먹임·스펙트럼 너징 | Dobashi et al. 2008; Kawaguchi et al. 2015; von Storch et al. 2000; Miguez-Macho et al. 2004 | 앱에 예보되는 상태가 없음. 문헌 컷오프 1000~2500 km > 상자 | 시뮬을 넣는다면 ≥ 60 km 스펙트럼 너징 |
| Goswami 열기포 | Goswami & Neyret 2017 | 노출 면적 포함 200 개 1 h 176 ms / 4.0 s. 자리 무작위. 기저·꼭대기는 이미 있음 | 적운 수명 주기 |
| Stormscapes·Weatherscapes·Cyclogenesis·Thunderscapes | Hädrich 2020; Amador Herrera 2021, 2024; Hao 2025 | 데스크톱 GPU, 영역 10~30 km(Cyclogenesis ~200 km) | 자료 경계 강제가 그래픽스에서도 됨을 보임 |
| GALES | Schalkwijk et al. 2015 | 상한 참고(GPU 클러스터) | — |
| CorrDiff | Mardani et al. | 폰 불가 | "결정 평균 + 확률 잔차" 분해 지지 |
| 역영역 채움 궤적 | Methven & Hoskins 1999; Pierrehumbert & Roca 1998 | 수일 필요, 하루 안에 상자 밖 | — |
| MCC 크기, LCL·EIS | Wood & Hartmann 2006; Romps 2017; Wood & Bretherton 2006 | 이미 구현(`cloudSkeleton`·`cloudProfile`) | — |
| KH(Ri < 1/4) | Miles 1961; Howard 1961; Smyth 2004 | 기압면 간격으로 얇은 시어층 못 풂 | — |
| 질량 보존 지형 바람 | Sherman 1978; Wagenbrenner et al. 2016(WindNinja) | 검증이 놓친 것으로 올렸고 평가 안 함 | 지형 강제 w 의 다른 길 |
| Muth 2026(ICON-D2 → WebGPU) | Muth 2026 | 2.2 km 65층 입력에서도 아격자 배치는 절차적 | 확인용 |
| Webanck 2018 최적수송 보간 | Webanck et al. 2018 | 상세 미검증 | 시간 보간 대안 |

## §5 제안 구조

```
L0 자료 ──► L1 진단장(128² 또는 64²) ──► L3 결합기(운량 보존) ──► 거시 텍스처(저·중·상)
  │            η(지형), σ_s(RH_p)               C = Φ(Q̄ + κη), 국소 재정규화
  │
  └──────► L2 레짐(관측점 기둥 + w) ──► cloudMorph 손잡이 ──► 24 km 타일
L4 시간: 예보 프레임 사이 이동(간격 ≥ 3 h), 실제 바람 라벨맵 → 거시 텍스처·타일 좌표
```

선행 정리(시각 영향 없음 또는 결정 필요):
- 기본 모드 1(Barnes 만)인데 `buildMacroField` 가 `synthesizeLatent` 를 돌리고 버림(`macroField.ts:420-421`). 밴드당 ~10.8 ms node, 3 밴드 ~32 ms. `noise === false` 면 건너뛰기. 바이트 같음으로 확인.
- 옛 두 숫자 기울기(`macroWeatherField`)가 아직 셰이더에서 곱해짐(`cloudFlowShader.ts:101-103`, 입력 `liveScene.ts:155`·`189-190`). Barnes 문턱 위에 겹침. 새 장을 넣기 전에 끌지 정해야 함(§9 질문).

### L0 자료

- 입력: 관측점에 바람 925/700/500(+0.6), w 15층(+1.5), SHF(+0.1, 모델별 부호 정규화). 2회차부터 고리에 RH850·RH700(+36.4). 선택: ECMWF 전용 69 점 묶음(w700, w500, RH850/700/500, u·v850, T850; ≤ 10 변수, +69).
- 알고리즘: 변수 추가뿐. 재현 날짜별 모델 표: historical-icon 구간은 기압면을 `jma_seamless` 또는 `gfs_seamless` 에서.
- 비용: 위 가중표. CPU 는 Barnes 공유 가중이면 장당 ~1.1 ms node.
- 꽂는 자리: `weather.ts:760`(fetchThermoProfile)·`:854`(fetchLayerWinds), 고리 변수 목록 `weather.ts:1113`(보관)·`:1116`(예보), 점별 보관 `:1185-1187`(지금 RH2m 은 i === 0 만), 별도 요청·null 캐시는 `:736-738`·`:843-850` 꼴, 날짜별 출처 `weatherSource.ts:10-11`·`:55-62`. DEM 은 `demCpu.ts:53` `loadCpuDemBlock`(z6 블록 1.94 km px × 1490 km, 디코드 시간 미측정, 온라인 전용).
- cloudFlow 와 다른 점: 입력이 예보·지형 자료. 무작위 위상 없음.

### L1 진단장(상승·포화 여유)

- 입력: DEM, 관측점 U·V(850, 바람 층), N(z)(T 15층), f. 2회차부터 고리 RH_p.
- 알고리즘(C3): ① h 를 거시 격자로. ② 예보가 이미 푼 지형 빼기: ĥ_sub = ĥ·(1 − e^{−K²s²/2}), s = 10 km(반출력 λ ≈ 53 km). ③ 막힘: min(h, U/N)(민감도로 Sheppard 분할유선 H_s = h(1 − U/Nh)). ④ η̂ = ĥ_sub·e^{imz}, m = sgn(σ)·sqrt(((N² − σ²)/(σ² − f²))·K²), σ = Uk + Vl, σ² > N² 이면 감쇠 뿌리. ⑤ 낮은 고유진동수 감쇠 G ← G·σ²/(σ² + σ_min²), σ_min = 2πU/200 km. ⑥ z = 1.5·3.0 km 두 고도. ⑦ S&B: Ŝ = C_w·iσĥ/(1 − imH_w), q̂_c = τ_c·Ŝ/(1 + iστ_c). ⑧ 바람 방향·N 구간이 바뀔 때만 다시(캐시). 포화 여유: RH_p Barnes → σ_s(x) = q_s(RH − 1)/Φ⁻¹(C)(C < 0.45, RH < 0.97 일 때), 그 밖 0.15·q_s(사전 고정). 전선 띠: 새 계산 없음. 모델 w: L1 이 아니라 L2(자리 상관 약함).
- 비용: 64² 3.2 / 34 ms, 128² 6.7 / 149 ms. 폰은 64² 로 시작.
- 꽂는 자리: 새 파일 `src/utils/oroLift.ts`(순수 함수, 자 도구가 그대로 import). 호출은 밴드별 `buildMacroField` 앞(`volumetricScene.ts:882-894`). FFT 는 `cloudFlow.ts:272` `fft2` 재사용, 비주기 상자라 가장자리 창 + 감쇠(패딩 256² 는 33.5 / 625 ms 라 피함).
- cloudFlow 와 다른 점: 자료(DEM·탐측)에서 나온 장. η 는 연직 변위라 발산을 품음(마루 아래 수렴, 뒤 발산). 24 km 타일이 아니라 자료가 정하는 12~80 km 거시 격자에서.

### L2 레짐 지도

- 입력: CBL 평균 바람(925·850), 시어, zi(BLH), SHF, CAPE, 역전, Scorer/TG 게이트, w(관측점, 선택적으로 고리).
- 알고리즘: 롤 = U_CBL ≥ 6 또는 시어 > 2e-3. 무조직 = zi < 1100 m. 롤 방향 = BL 바람 ±10°, 파장 ∝ zi(2~10 km). 파 = 갇힘 조건 + C3 의 η 진폭 > 문턱일 때 켬, waveKm = TG 고유 파장. w > 0 → c ↓·두께 ↑, w < 0 → 깨짐 ↑.
- 비용: ~0.
- 꽂는 자리: `cloudMorph.ts:67-85` `morphParamsOf`(aniso `:79`, cellKm `:83`), `cloudSkeleton.ts:73-74`·`:186-188`. 상자 안 공간 변화는 거시 텍스처의 빈 알파 채널(`macroShader.ts:89`, 지금 상수 255)로 두 레인을 섞는 길(§9 질문).
- cloudFlow 와 다른 점: 무작위 위상 대신 탐측 문턱. 단 위치는 여전히 무작위임을 인정(통계만 자료).

### L3 아격자 통계 구름 결합기(운량 보존)

- 입력: Barnes 운량 C_base(x), η̄(x)(L1), κ(σ_s).
- 알고리즘(C1): C(x) = Φ(Q̄(x) + κ·η̄(x)), Q̄ = Φ⁻¹(C_base) 를 ±2.5 로 자름, κ = 5.55e-4·q_s/σ_s. 국소 재정규화: G * C = G * C_base(가우스 σ 20 km, 반치폭 ≈ 47 km) 가 되도록 Q̄ 를 뉴턴 2 번. 모드 2 에선 Y = μ(x) + a·η_n + sqrt(1 − a²)·Z, a 는 κ 에서. 근거 크기: 280 K 에서 d lnRH/dz = 5.55e-4 m⁻¹ → 100 m 들림 = RH +5.7 % = RH 0.9·C 0.3 에서 0.29 σ, 300 m = 0.87 σ.
- 비용: 1.7 / 41 ms(전역 이분), 국소판 추정 +1~2 / +40 ms.
- 꽂는 자리: `macroField.ts:428-431` cover 루프(모드 2), `noise === false` 분기 `cover.set(base)`(모드 1). 제약: 셰이더 문턱 표(`macroShader.ts:99-118`)는 타일 운량 위로 못 더함. 타일 운량 = max(관측, 150 km 안 p75). 모자구름이 그 위면 잘림.
- cloudFlow 와 다른 점: 예보 운량을 ~50 km 발자국에서 지킴. cloudFlow 는 운량과 무관했음.

### L4 시간 진화

- 입력: 예보 프레임(매시), 관측점 층 바람, 선택적으로 고리 u·v.
- 알고리즘: (a) 프레임 간격 ≥ 3 h(ECMWF 기압면 원래 간격, 빠른 시간 넘기기)일 때만 상층 RH·중상층 운량을 층 바람으로 이류 보정 보간, 이동량은 고리 안으로 자름. 저층·T 는 오일러 그대로. (b) 지형장은 정상 상태라 매시 U·N 이 바뀔 때만 재계산. 한 시간 동안 같은 자리가 맞음. (c) 고리 u·v 를 받으면 64² 9 걸음 라벨맵 → 32²~64² 변위 텍스처 → 셰이더가 타일을 x − D(x) 로. (d) 자유 예보 모델은 두지 않음: T850 자유 이류가 1 h 에 지속보다 나쁨. 예보 상태는 늘 예보 프레임에서. 그래서 너징도 불필요(ICON 에선 상층 습도는 라그랑주 지속이 이김. RH500 1 h 8.75 → 5.93).
- 비용: (a) 셰이더 ~0, (c) 1.5 / 41 ms(64²).
- 꽂는 자리: `weather.ts:1222` `getInterpolatedWeather`(지금 점별 선형), `macroShader.ts:162` `setMacroDrift`(지금 균일 이동), `volumetricScene.ts:1214`.
- cloudFlow 와 다른 점: 의사시간 0.5 h 의 무작위 흐름 대신 실제 시각·실제 바람. 발산 포함(det J ≠ 1).

## §6 1회차 제안: "지형 강제 R1"(자 먼저, 기본 꺼짐)

**범위**: C3(Smith 1980 + S&B, 128², 두 고도 1.5·3.0 km 평균) + C1(결합기, 국소 재정규화). σ_s 는 관측점 RH(850·700 평균)와 관측점 총운량에서 장면당 하나(역산 안 되면 0.15·q_s). 고리 요청은 안 바꿈. 앱 쪽은 `src/utils/oroLift.ts` 순수 함수 + 옵션 `macroOro: 0`(`volumetricScene.ts:400` 기본값, 꺼짐). 앱에선 저층에 1.5 km, 중층에 3.0 km 의 η 를 쓰고 상층은 그대로.

**보이는 차이**: 산악 장면에서 바람받이 쪽 거시 운량이 늘고 풍하 쪽이 줄어듦(12~80 km). 화면에선 산 너머 하늘의 갬과 산 위 구름 덩이.

**자(구현 전에 동결, `tools/genus-ruler/oro/RULER-oro.md`)**
- 참값: `.harness/macro/sat` MODIS 121 장면(256² × 3 km, Terra 아침 ~10:30 지방시), 판정은 held 97(8 곳). dev(서울·가나자와 24)는 파이프라인 확인만.
- 입력: 실제 NWP 고리(RULER-ringtruth §8.2 의 `sceneDir-nwp`, MODIS 시각 보간 총운량). 탐측·바람은 historical-forecast-api `best_match`(앱과 같음), 장면 시각. DEM 은 사이트별 Terrarium z6.
- 적용 장면(MODIS 보기 전에 정함): 가운데 ±90 km 의 h_sub rms ≥ 100 m, U850 ≥ 5 m/s, 850~700 hPa N² > 0, 500 hPa 아래에서 교차 바람 부호 반전 없음. 그 밖 장면은 a = 0 → 출력 바이트 같음(확인 항목).
- 주 지표: ρ_res = corr(ΔC, T − B). ΔC = 새 운량 − Barnes, T = MODIS, B = Barnes. 12 km 상자 평균, 가운데 ±90 km, ΔC 의 절댓값 ≥ 0.02 인 칸만. 뜻: "고친 방향이 참값이 틀린 방향과 같은가".
- 보조 지표: Δcorr12Base, Δcorr50Base, ΔmeanErr, 바람받이/풍하 대비(η 상위·하위 삼분위 칸의 MODIS 운량 차 부호 일치율).
- 합격(사전): 적용 held 장면 n ≥ 20 이고, ρ_res 중앙값 > 0 이며 날짜 블록 부트스트랩 95 % 하한 > 0, 그리고 Δcorr12 중앙값 ≥ 0(하한 ≥ −0.01), Δcorr50 ≥ −0.01, ΔmeanErr 절댓값 ≤ 0.01.
- 행동 규칙: 합격 → 옵션만 켜서 사용자 눈 판정(A/B 3 장면, §139.4 교훈). 그 전엔 기본 꺼짐 유지. 불합격 → 참고로 기록, 끔. n < 20 → 미결, 산악 사이트 MODIS 날짜를 2026-10-23 이후로 추가해 다시(새 장면 추가 규칙도 먼저 적음).
- 민감도(판정에 안 씀): s = 8·15 km, Sheppard 자르기, σ_s 0.1·0.2, 고도 1·2·3 km 평균, 64² vs 128².
- 사전 예측: 적용 장면은 held 의 25~40 %(9~10 월 아침, 바람 약함, 10:30 대류 경계층은 N² ≤ 0 로 빠짐). ρ_res 중앙값 +0.05~+0.15. Δcorr12 +0.00~+0.03. Δcorr50 ≈ 0. 합격 확률 반쯤.
- 함정: MODIS 눈 오탐(denver·sapporo 10 월), 얇은 권운 맹점, Terra 한 시각, 해석된 지형 이중 계산, 바다 장면은 0, 고리 점 `cell_selection=land` 오프셋.
- 비용: 관측점 요청 121 장면 × ~5 = ~600 가중. DEM 타일은 가중 없음. node 몇 분.
- 산출: `tools/genus-ruler/oro/{RULER-oro.md, oro-run.mjs, oro.py}`, 결과 `gate-oro-held.json`.

**같이 해도 되는 공짜 일**: 모드 1 의 버리는 합성 건너뛰기(밴드당 ~10.8 ms node 절약, 바이트 같음 확인만).

**대안 R1′(산악이 관심 밖이면)**: C4 레짐 선택기. 위치 참값이 없어 눈 판정과 통계 자(I_org·간격)뿐이고, RULER-genus2 에서 학습 모델이 다수결보다 +4.5 %p 뿐이었음을 감안해야 함.

## §7 기각한 것과 이유

| 것 | 이유(측정) |
|---|---|
| 고리 표본 w 를 Barnes 로 격자화 | 135 km 안 설명분산 0.09~0.14. w 상관 길이 40~60 km(ECMWF)·15~25 km(JMA) ≪ 바깥 고리 간격 68~199 km |
| 고리 운동학 ω 를 주 입력으로 | 모델 w 를 변수 1 개로 받음. 다시 구하면 하층만 맞고 중층 오차 60~80 % |
| 같은 층 수렴 = 상승으로 쓰기 | 상관 ≈ 0 |
| SQG·SQG+1 전선 생성기 | 850 hPa 기온에서 역산한 바람이 실제 바람과 벡터 상관 0.01, 3 배 셈. 6 h 에 기울기 × 1.24 뿐, 12 h 에도 −5/3 못 감. RK3 한 걸음 9.5~10.9 ms node. 850 hPa 는 경계면이 아님. 500 km 아래는 파 지배(Callies 2014) |
| 2층 QG·준지균·비선형 균형 | 고리에 쓸 만한 지오퍼텐셜 없음(30 km 간격 잡음 1.6e-4). 시간 규모 ~20 h 이상. 예보가 이미 품 |
| 얕은물·역전층 모델 | 0.29 ms/걸음으로 싸지만 시작할 장이 없음. 수렴이 상승을 못 따라감 |
| Ekman 펌핑 | 0.22~2.2 cm/s(3 h 에 24~240 m), 종관 규모, 예보에 있음 |
| 자유 실행 2-D 이류 예보 | T850: 1 h 1.50 vs 지속 0.66 K, 3 h 4.14 vs 1.37 K. 연직 운동·일변화 빠짐 |
| 스펙트럼 너징(지금) | 예보되는 상태 없음. 문헌 컷오프 > 상자. 주기 FFT 는 비주기 상자에 틀림 |
| 주기 FFT 회전/발산 분해 | 비주기 바람에서 발산풍 오차 ~400 % |
| 균일 U·N 의 Smith 1980 로 풍하파 열 | 이론상 못 만듦(Durran 2015, x-z 실험으로 확인). 5~10 km 는 격자 아래 |
| 층 운량(cloud_cover_XhPa) 따로 받기 | ECMWF·ICON·JMA 는 RH 의 고정 함수 |
| 폰 런타임 2.5-D·3-D 구름 CFD | Vimont 128²×4 25.5 ms/걸음 node(636 jitless), x-z 512×64 184 ms/걸음 jitless, Stormscapes 계열은 데스크톱 GPU |
| 셀룰러 오토마타·CML | 이전 조사가 측정·기각(64² 에서 75~560 ms Hermes, 벽지 무늬), 자료 구조 없음 |
| CorrDiff 런타임 | 폰 추론 불가, 학습 모델 없음 |
| 역영역 채움 궤적 | 필라멘트에 수일 필요, 하루 안에 상자 밖 |

## §8 참고문헌

표기: [원문] 본문을 읽음 · [서지] Crossref·서지 기록만 확인 · [2차] 다른 문헌·코드로 확인 · [기억] 미확인.

**지형파·응결**
- Smith R.B. 1980, Linear theory of stratified hydrostatic flow past an isolated mountain, Tellus 32(4):348-364 [원문]
- Smith R.B. & Barstad I. 2004, A linear theory of orographic precipitation, J. Atmos. Sci. 61(12):1377-1391, doi 10.1175/1520-0469(2004)061<1377:ALTOOP>2.0.CO;2 [서지; 전달함수는 fastscape-lem/orographic-precipitation 코드로 2차 확인; AMS 본문 403]
- Durran D.R. 2015, Lee waves and mountain waves, Encyclopedia of Atmospheric Sciences 2nd ed., vol 4, 95-102, doi 10.1016/B978-0-12-382225-3.00202-4 [원문]
- Durran D.R. & Klemp J.B. 1982, On the effects of moisture on the Brunt–Väisälä frequency, J. Atmos. Sci. 39:2152-2158 [서지; 식 21 정오표 있음]
- Scorer R.S. 1949, Theory of waves in the lee of mountains, QJRMS 75:41-56 [서지]
- Vosper S.B. 2003, Development and testing of a high resolution mountain-wave forecasting system, Meteorol. Appl. 10(1):75-86 [서지]
- Sharman R.D. & Wurtele M.G. 1983, Ship waves and lee waves, J. Atmos. Sci. 40:396-427 [서지]
- Sheppard P.A. 1956, Airflow over mountains, QJRMS 82:528-529 [2차]
- Smith R.B. 1979, The influence of mountains on the atmosphere, Adv. Geophys. 21:87-230 [서지]; Smith R.B. 1989, Hydrostatic airflow over mountains, Adv. Geophys. 31:1-41 [기억]; Pierrehumbert R.T. & Wyman B. 1985, J. Atmos. Sci. 42:977-1003 [기억]
- fastscape-lem/orographic-precipitation(파이썬 구현, 분산관계·f·패딩) [원문]

**통계 구름 스킴·경계층 조직**
- Sommeria G. & Deardorff J.W. 1977, Subgrid-scale condensation in models of nonprecipitating clouds, J. Atmos. Sci. 34:344-355 [서지]
- Tompkins A.M. 2002, A prognostic parameterization for the subgrid-scale variability of water vapor and clouds in large-scale models and its use to diagnose cloud cover, J. Atmos. Sci. 59:1917-1942 [서지]
- Tompkins A. 2008, Cloud parameterization, ECMWF 교육 강의 슬라이드 [원문]
- Sundqvist H., Berge E. & Kristjánsson J.E. 1989, Mon. Wea. Rev. 117:1641-1657 [서지]
- Santellanes S.R., Young G.S., Stensrud D.J., Kumjian M.R. & Pan Y. 2021, Mon. Wea. Rev. 149(5):1305-1316 [원문]
- Weckwerth T.M., Wilson J.W., Wakimoto R.M. & Crook N.A. 1997, Mon. Wea. Rev. 125:505-526 [서지]
- Banghoff J.R. et al. 2020, Mon. Wea. Rev. 148(1):21-42, doi 10.1175/MWR-D-19-0136.1 [서지·초록]
- Brümmer B. 1999, Roll and cell convection in wintertime Arctic cold-air outbreaks, J. Atmos. Sci. 56:2613-2636 [서지]
- Wood R. & Hartmann D.L. 2006, J. Climate 19:1748-1764 [원문]; Wood R. & Bretherton C.S. 2006, J. Climate 19:6425-6432 [2차]
- Etling D. & Brown R.A. 1993, Boundary-Layer Meteorol. 65:215-248 [서지]; Atkinson B.W. & Zhang J.W. 1996, Rev. Geophys. 34:403-431 [서지]; Agee E.M., Chen T.S. & Dowell K.E. 1973, BAMS 54:1004-1012 [서지]; Agee 1987, Dyn. Atmos. Oceans 10:317-341 [기억]; Kuettner J. 1971, Tellus 23:404-425 [기억]; Tsuboki K. & Asai T. 2004, JMSJ 82(2):597-621 [서지, 제목 기억]
- Romps D.M. 2017, J. Atmos. Sci. 74(12):3891-3900 [서지]; Slingo J.M. 1987, QJRMS 113:899-927 [서지]

**운동학·종관 진단**
- Browning K.A. & Wexler R. 1968, J. Appl. Meteor. 7:105-113 [서지]; Davies-Jones R. 1993, Mon. Wea. Rev. 121:713-725 [서지]; Bony S. & Stevens B. 2019, J. Atmos. Sci. 76:767-783 [서지·초록]; Lenschow D.H., Savic-Jovcic V. & Stevens B. 2007, JTECH 24:2062-2072 [서지]
- O'Brien J.J. 1970, J. Appl. Meteor. 9:197-203 [서지; 본문 403, 공식은 진술된 가정에서 구현]; Bellamy J.C. 1949, BAMS 30:45-49 [서지]
- Hoskins B.J., Draghici I. & Davies H.C. 1978, A new look at the ω-equation, QJRMS 104:31-38, doi 10.1002/qj.49710443903 [원문]
- Rantanen M. et al. 2017, OZO v.1.0, Geosci. Model Dev. 10:827-841 [원문]; Trenberth K.E. 1978, Mon. Wea. Rev. 106:131-137 [기억]
- Keyser D., Reeder M.J. & Reed R.J. 1988, Mon. Wea. Rev. 116:762-780 [서지; 한 검증은 781 쪽까지로 읽음]; 정오표 Milrad et al. 2015, Wea. Forecasting 30:1404(doi 미확인); Petterssen 1936·Sawyer 1956·Eliassen 1962 [기억]; Hoskins B.J. & Bretherton F.P. 1972, J. Atmos. Sci. 29:11-37 [2차]
- Barnes S.L. 1964, J. Appl. Meteor. 3:396-409 [서지]
- Holton J.R., An Introduction to Dynamic Meteorology(Ekman) [기억]; Charney J.G. & Eliassen A. 1949, Tellus 1:38-54 [기억]

**수치·축소 모델·예측 가능성**
- Held I.M., Pierrehumbert R.T., Garner S.T. & Swanson K.L. 1995, J. Fluid Mech. 282:1-20 [원문]; Tulloch R. & Smith K.S. 2006, PNAS 103(40):14690-14694 [원문]; Tulloch & Smith 2009, J. Atmos. Sci. [서지, 권 미확인]; Callies J., Ferrari R. & Bühler O. 2014, PNAS 111(48):17033-17038 [서지]; Hakim G.J., Snyder C. & Muraki D.J. 2002, J. Atmos. Sci. 59:2405-2420 [서지]; Lapeyre G. & Klein P. 2006, J. Phys. Oceanogr. 36:165-176 [서지]
- Lapeyre G., Klein P. & Hua B.L. 1999, Phys. Fluids 11(12):3729-3737 [원문]
- Bishop C.H. 1996, J. Atmos. Sci. 53(2):241-252 [서지]; Lynch P. 1989, Mon. Wea. Rev. 117(7):1492-1500 [서지]; Bijlsma S.J., Hafkenscheid L.M. & Lynch P. 1986, Mon. Wea. Rev. 114:1547-1551 [서지]; Li Z., Chao Y. & McWilliams J.C. 2006, Mon. Wea. Rev. 134(11):3384-3394 [서지]
- Stam J. 2001, A simple fluid solver based on the FFT, J. Graphics Tools 6(2):43-52 [원문]; Selle A. et al. 2008, J. Sci. Comput. 35:350-371 [서지]; Staniforth A. & Côté J. 1991, Semi-Lagrangian integration schemes for atmospheric models: A review, Mon. Wea. Rev. 119(9):2206-2223 [서지]; Orszag 1971, J. Atmos. Sci. 28:1074 [2차]
- von Storch H., Langenberg H. & Feser F. 2000, Mon. Wea. Rev. 128(10):3664-3673 [서지]; Miguez-Macho G., Stenchikov G.L. & Robock A. 2004, J. Geophys. Res. 109, D13104 [서지]; Hoke J.E. & Anthes R.A. 1976, Mon. Wea. Rev. 104:1551-1556 [2차]; Davies H.C. 1976, QJRMS 102:405-418 [서지; 측면경계 완화 문헌, 역전층 얕은물의 근거 아님]; Lilly D.K. 1968, QJRMS 94:292-309 [기억]
- Rebora N. et al. 2006, RainFARM, J. Hydrometeor. 7(4):724-738 [서지]; Bowler N.E., Pierce C.E. & Seed A.W. 2006, STEPS, QJRMS 132:2127-2155 [서지]; Pulkkinen S. et al. 2019, Pysteps v1.0, Geosci. Model Dev. 12:4185-4219 [원문]
- Anagnostou E.N. & Krajewski W.F. 1999, JTECH 16(2):189-197 [서지]; Laroche S. & Zawadzki I. 1995, VET, JTECH [기억]
- Germann U. & Zawadzki I. 2002, Mon. Wea. Rev. 130(12):2859-2873 [서지]; 같은 저자, 31st Conf. on Radar Meteorology 2003, 4B.8 [원문]
- Zhang F., Bei N., Rotunno R., Snyder C. & Epifanio C.C. 2007, J. Atmos. Sci. 64(10):3579-3594 [초록]; Sun Y.Q. & Zhang F. 2016, J. Atmos. Sci. 73:1419-1438 [원문]; Lorenz E.N. 1969, Tellus 21:289-307 [서지]; Skamarock W.C. 2004, Mon. Wea. Rev. 132(12):3019-3032 [서지; "유효 해상도 7Δx" 는 2차 출처만]
- Methven J. & Hoskins B.J. 1999, J. Atmos. Sci. 56:3262-3285 [서지]; Pierrehumbert R.T. & Roca R. 1998, GRL 25:4537-4540 [서지]; Pierrehumbert, Brogniez & Roca 2007(The Global Circulation of the Atmosphere 의 장; arXiv 2507.08824) [원문]; Sutton R.T. et al. 1994, J. Atmos. Sci. 51:2995-3005 [참고목록만]
- Sherman C.A. 1978, J. Appl. Meteor. 17:312-319 [서지]; Wagenbrenner N.S. et al. 2016, Atmos. Chem. Phys. 16:5229-5241 [서지]
- Mardani M. et al., Residual corrective diffusion modeling for km-scale atmospheric downscaling, arXiv 2309.15214(Commun. Earth Environ. 2025, 권·번호 미확인) [초록]

**그래픽스**
- Vimont U. et al. 2020, Interactive meso-scale simulation of skyscapes, CGF 39(2):585-596, doi 10.1111/cgf.13954 [원문]
- Dobashi Y., Kusumoto K., Nishita T. & Yamamoto T. 2008, ACM TOG 27(3):94, doi 10.1145/1360612.1360693 [서지; 내용은 Kawaguchi 2015 로]; Kawaguchi T., Dobashi Y. & Yamamoto T. 2015, IEICE Trans. E98-D(11):2034-2037 [원문]; Zhang Z. et al. 2020, Graphical Models 111:101083 [서지]
- Goswami P. & Neyret F. 2017, VRIPHYS 2017 pp. 1-8, doi 10.2312/vriphys.20171078 [원문]
- Harris M.J., Baxter W.V. III, Scheuermann T. & Lastra A. 2003, Graphics Hardware 2003 pp. 92-101 [원문]; Harris M.J. 2003, PhD 학위논문 UNC TR03-040 [원문]
- Hädrich T. et al. 2020, Stormscapes, ACM TOG 39(6):175 [원문]; Amador Herrera J.A. et al. 2021, Weatherscapes, ACM TOG 40(6):204 [원문]; Amador Herrera J.A. et al. 2024, Cyclogenesis, ACM TOG 43(4):71 [원문]; Hao T. et al. 2025, Thunderscapes, Proc. ACM CGIT 8(1):7 [원문]
- Garcia-Dorado I. et al. 2017, ACM TOG 36(2):1-19 [원문]; Duarte R.P.M. & Gomes A.J.P. 2017, Computers & Graphics 67:103-114 [서지; 2014 선행 논문 원문]
- Schneider A. 2023, Nubis Cubed, SIGGRAPH Advances in Real-Time Rendering [원문]; Muth W. 2026, TU Wien 학사논문(weBIGeo) [원문]
- Dobashi Y. et al. 2000, SIGGRAPH pp. 19-28 [원문]; Miyazaki R. et al. 2001, Pacific Graphics pp. 363-372 [초록]; Schalkwijk J. et al. 2015, BAMS 96:715-723 [초록]; Webanck A. et al. 2018, CGF 37(2):431-442 [초록]; Dobashi, Yamamoto & Nishita 2006, CASA [인용만]; Dobashi Y. et al. 2017, Visual Informatics 1:1-8 [서지]
- Smyth W.D. 2004, QJRMS [존재만]; Miles 1961·Howard 1961, J. Fluid Mech. 10 [기억]

**자료원**
- Open-Meteo 문서: ECMWF·JMA·GFS·Historical Forecast API, `/en/docs`(cell_selection), 요금 페이지, substack "Weather Data for Multiple Locations" [원문]

**고친 인용(조사 원문과 다른 것)**
- arXiv 2207.09591 은 Yassin 2022 학위논문이고 대기 로스비수 이야기가 없음 → SQG 비판은 Callies et al. 2014 와 Tulloch & Smith 2009 로.
- "Harris 2D 128² 30 fps 이상"은 학위논문이 아니라 Harris et al. 2003(Graphics Hardware).
- Germann & Zawadzki 학회 논문은 31st Radar Conference(2003).
- Davies 1976 은 역전층 얕은물의 근거가 아님(Lilly 1968 이 맞는 고전).
- 2π/f 는 37°N 에서 19.8 h(17 h 는 45°N).
- Goswami & Neyret: 물리가 프레임 시간의 4~9 %, 7~235 fps(조사 원문은 4~6 %, 77~235).
- Santellanes 2021: 90 % 는 훈련 자료. 독립 자료 HCR 76 %·세포 71 %·가중 69 %. 72 % 는 두 변수(u*, SHF) MDA.
- Dobashi 2008 정지 규칙은 두 조건 모두(AND).
- Garcia-Dorado 2017 의 "4 % 미만"은 12 h 평균 운량 차(최대 10 %), 형태 일치가 아님.
- Muth 2026 의 KH 제외는 구현상 이유(셰이더 입력으로 N 계산 불가). KH 물리가 쓸모없다는 증거 아님.
- Vimont 2020 칸은 ~0.1 km(조사 원문 ~0.2 km).

## §9 열린 질문(사용자에게)

1. 1회차를 **산악 지형 강제**로 해도 될까요? 앱을 주로 쓰는 곳이 산 근처가 아니면 효과가 0 인 장면이 많습니다. 아니면 R1′(경계층 롤·세포 레짐, 눈 판정 위주)로 갈까요?
2. 요청 가중 예산: 관측점 바람 3층(+0.6)·w(+1.5)는 거의 공짜입니다. 2회차의 고리 RH850·RH700(+36.4, 하루 ~68 → ~56 위치-일)이나 해쪽 격자 쐐기(+83)까지 받아도 될까요?
3. 셰이더에 아직 곱해지는 옛 두 숫자 기울기(`cloudFlowShader.ts:101-103`)는 의도한 것인가요, 남은 찌꺼기인가요? 새 장을 넣으면 세 변조가 겹칩니다.
4. 과거 재현에서 2022-11-24 ~ 2024-02-02(ICON 단독) 구간은 기압면 자료가 없습니다. 그 구간의 층 바람·습도·w 를 JMA·GFS 에서 가져와도 될까요?
5. 해안 해풍 수렴선(10~50 km, 육지·바다에 고정)은 이번 조사에 없었습니다. 따로 조사할까요?
6. 시간 넘기기를 3 h 이상 간격으로 자주 쓰나요? 그래야 이류 보정 보간(C8)의 이득이 보입니다.
