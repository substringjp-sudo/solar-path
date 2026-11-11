# atmos 1회차 계획 — 자료 복원 → 두 자 동결 → 구현 → 판정 — **초안 2판, 2026-11-04**

범위(사용자 결정 §171.3): C3 + C1(옵션 `macroOro`)과 C4(옵션 `regime`)를 같은 회차에 다루고 판정은 따로 합니다.
- C3 + C1 은 산악 장면에서만 작동하고 나머지는 바이트 같음입니다.

**판**
1. 1판(103aa7a).
2. 3 관점 검토(`oro/draft1/review-{validity,statistics,procedure}.md`).
3. 사용자 결정 D1~D10(2026-11-04, a027662).
4. **이 2판**.

**자**
- 1판(커밋): `tools/genus-ruler/oro/RULER-oro.md`, `tools/genus-ruler/regime/RULER-regime.md`.
- 2판: scratchpad `atmos1/RULER-regime.v2.md`(이 계획과 함께 씀). RULER-oro 2판은 따로 씁니다.
- 근거: `oro/draft1/{code-map,data-plan,method}.md`·`bench/`·`stat/`.
- 검토 답은 §7 에 있습니다.

**꼬리표**: 자와 같습니다.

## 0. 지금(2026-11-04)
- **가지**: `claude/eloquent-clarke-73zhgy` @ a027662. 1판 자·검토·결정 기록까지 커밋돼 있습니다.
  - main(a8a4f61)이 앱 커밋 2 개 앞섭니다(날짜 선택기, DEM 타일 캐시, 역지오코딩). 아직 합치지 않았습니다.
  - DEM 관련 사항은 둘입니다.
    - `demTiles.ts` 가 `demTileCache.ts`(react-native·expo-file-system)를 top-level 에서 import 합니다.
    - 받기에 실패하면 **어떤 z/x/y 에든 z0 세계 타일 URI** 를 돌려줍니다 → 틀린 지형이 조용히 들어옵니다.
  - `demCpu.loadCpuDemBlock` 은 캐시를 거치지 않아 안전합니다.
- **복원 진행 중**
  - MODIS 은행(R2)과 NWP 고리(R6)를 지금 `.harness/`(gitignore)에 다시 받고 있습니다.
  - 누구도 MODIS 운량 값과 held 영상을 열지 않습니다. 표준 출력은 로그로 가고 읽지 않습니다.
  - 1판 명령으로 시작했으므로, 2판의 복원 규칙(§2.4)을 지금부터 그대로 적용합니다. 이미 지킨 것과 어긴 것은 oro 2판 §0.1 에 사실대로 적습니다. 예: `macro.py --gate` 를 이미 돌렸다면 그 표준 출력을 봤는지.
- **남은 것**: fetch 스크립트, `ring/modis-times.json`(121 키), `macro/sat-quartiles.json`, `ring/gate-*-held.json`. 뒤의 둘은 장면별 위성 값이 있어 열지 않습니다.
- **도구**
  - node v22.23.4, `node_modules` 없음. `npm ci` 는 하네스 렌더·G1·G5·G10 에만 필요합니다.
  - esbuild 는 lockfile 에 없음 → 판을 고정합니다(`npx esbuild@<판>`).
  - numpy 2.5.3·Pillow 12.3.0, scipy 없음. 두 자 모두 numpy 만 씁니다. 이전 FROZEN 은 numpy 2.4.6 이었으니 새 판을 기록합니다.
- **탐침**(2026-11-03, 호스트당 1 요청)
  - GIBS·Terrarium·Open-Meteo forecast·previous-runs 는 200.
  - historical 은 429(공유 IP 의 일일 한도 소진, 리셋 2026-11-04 00:00:47Z).

## 1. 순서 한눈에
| 단계 | 무엇 | 선행 | 산출 | 지키는 것 |
|---|---|---|---|---|
| S0 | 사용자 결정 D1~D10 **받음**(2026-11-04, §4.1). 1판 3 관점 검토 끝남 → 이 2판. D11~D14 를 묻습니다(§4.2) | — | 자 2판의 전제 | P10·p12 |
| S1 | main 합치기 + volsky 묶기에 `demTileCache` 대체(별칭 또는 빈 모듈) + 하네스 A/A + 합치기 전후 B0_app·P0_seoul rgb·alpha md5 같음 | S0 | 합친 커밋(G1 기준·`old`·`runtime` 의 기준) | P10·p8 |
| S2 | 자료 복원 R1~R7(**진행 중**), R8 CMR 시각(모든 후보 기간), R9 GIBS 레이어 탐침만(§2) | 없음(R4~R6 은 한도 리셋 뒤) | 은행·탐측·고리·DEM, F1~F3, `restore-fingerprints.json`, `sat-times.json` | P2·P3·P8·p1·p2 |
| S3 | oro 동결 전 측정 — 아래 목록 | S1·S2 | 위 파일들 | P4~P7·P11·O-B3 |
| S4 | oro 2판 §0 에 잰 값 → (규칙이 바뀌면 그 차이만 짧게 재검토) → oro `FROZEN.json`·**동결 커밋** | S3 | oro FROZEN | P4·p12 |
| S5 | regime 동결 전 — 아래 순서 | S4(임시 N_R 은 S2 뒤 언제든) | regime FROZEN | P8·P9·R-B4·p11e |
| S6 | 구현(§3), 합친 main 위에서. 옵션 기본 0. oro 몫은 S4 뒤, regime 몫은 S5 뒤 | S4·S5 | 앱·하네스 코드 | — |
| S7 | 가드 → 판정 한 번 — 아래 목록 | S6 | `gate-oro-held.json`·`gate-regime-held.json`, 자 §10·§11 | P1·P4·p6 |
| S8 | 눈 판정 → 기본값은 사용자가 | S7 합격 | 계획서 새 절 | V5·p4·M7·m11 |

- **S3 목록**
  - `oro-base.mjs`(B = `buildMacroField(…).base`, Float32), `oro_ref.py`, G6 (a)~(f)(판정 경로 끝-끝 포함).
  - `dem-/sounding-/bank-/ring-manifest.json`, `oro-inputs.json`, `oro-apply.json`.
  - n 셈 한 번(필요하면 동결 전 확장 10-23·27·31).
  - G7, `power-oro.json`, `g1-baseline.json`(합친 뒤 바꾸기 전 커밋, `macro: 1, macroN: 128` 잡).
- **S5 순서**
  1. `regime_ref.py` 로 임시 N_R 을 셉니다. 모자라면 R10 확장 탐측을 받고 기간을 정합니다.
  2. 최종 `regime-list.json`(지형 깃발은 동결 `oro_ref.py`)을 **커밋**합니다.
  3. `power-regime.json` → `texture-test.py`·`render-tile.mjs`·J2.
  4. C4 위성(dev·held)을 **받기만** 합니다.
  5. dev 스칼라·a·마스크 점검을 합니다.
  6. 2판 §0.4 에 잰 값 → (재검토) → regime `FROZEN.json`·동결 커밋.
- **S7 목록**
  - oro: G1~G5·G8 → 해시를 §10.2 에 → `oro.py --judge`(lock) → 곧바로 커밋.
  - regime: G1~G10 → 해시를 §11.2 에 → `regime.py --judge`(수 한 줄 → P1·P2·J3) → 곧바로 커밋.
- **S8 장면**
  - oro 3 장면: 그 가운데 ≥ 2 개는 노을이고, 고르는 규칙은 oro 2판 §5.2 입니다.
  - C4: ROLL 5 + 대조 1. 노을·낮 ROLL 비율을 먼저 보입니다.
  - '모르겠다' 는 C4·`macroOro` 를 고르지 않은 것으로 셉니다.
- 동결과 판정 사이에는 main 을 합치지 않습니다.

## 2. 자료 복원(커밋 파일은 덮지 않음)
### 2.1 단계
| # | 무엇 | 명령·규칙 | Open-Meteo 가중 | 그 밖 | 시간 |
|---|---|---|---|---|---|
| R1 | DEM | 새 `tools/genus-ruler/oro/fetch-dem.py`: z6(hamburg z5) 3×3 블록 + ±450 km, 타일 66 개, sha256·ETag·version-id 목록 | 0 | 6 MB | 1 분 |
| R2 | MODIS 은행(**진행 중**) | `fetch-sat.py .harness/macro/sat --sites dev`, 그다음 `--sites all`. 표준 출력은 로그로, **읽지 않음**. `index.json` 은 지문 스크립트가 `skip`·`error` 키만 읽음 | 0 | GIBS 130 장, 30 MB | 5~15 분 |
| R3 | 지문 F1·F2 | F1 은 두 갈래(아래). F2 = `macro.py --truth … --out .harness/oro/sat-quartiles-restore.json > .harness/oro/f2.log`(읽지 않음) 대 `sat-quartiles.json` 의 **같은 수만** | 0 | — | 1 분 |
| R4 | 탐침 | 서울(dev) 1 요청. 확인 셋은 아래 | ≈ 2 | — | 초 |
| R5 | 관측점 탐측 | 새 `fetch-sounding.py`: 10 사이트 × 1 요청, best_match, 2026-06-01 ~ 10-31, ≈ 69 변수, `wind_speed_unit=ms`. **요청 사이 ≥ 10 s**. `--start/--end/--out` 인자를 둡니다(동결 뒤 확장이 스크립트를 고치지 않게) | ≈ 754 | 10 MB | 3 분 |
| R6 | 실제 NWP 고리(**진행 중**) | R5 뒤 60 s. `fetch-nwp-ring.py --tag blend`(+ `-lm`). 무료 변형: latest·m1h·p1h | ≈ 3,185 | 90 MB | 12~17 분 |
| R7 | 지문 F3(T 없음) | 아래 | 0 | 35 MB | 2 분 |
| R8 | C4 시각 | 새 `fetch-sat-times.py`: CMR MYD03·MOD03, 사이트 × 위성 × 후보 기간 3 개(2026-06~10 · 2026-04~05 · 2025-06~10) ≈ 60 질의(쪽 나눔). 평균 태양일 창. 시각·폴리곤·DAY 깃발만 저장. 먼저 Aqua 2026 granule 수(달별 수만) | 0 | — | 수 분 |
| R9 | C4 레이어 탐침 | 레이어마다 64 px 1 장(내용 보지 않음). **C4 영상은 S5(oro 동결 뒤)에 받음** | 0 | — | 초 |
| R10 | C4 확장 탐측(필요할 때만) | 임시 N_R < 60 일 때만, held 8 곳. 같은 `fetch-sounding.py --start … --end … --out sounding-regime-ext{1,2}.json` | ≈ 241(2026-04~05) + ≈ 603(2025-06~10) | — | 2 분 |

- **F1 두 갈래**(R3)
  - 받기 오류(`error`) → 같은 명령을 다시 돌립니다(받은 장면은 캐시로 건너뜀). 3 번 뒤에도 남으면 그 이름만 적고 뺍니다.
  - 내용 차이(이름 집합 ≠ 121 키) → 판정 후보 = 남은 장면 ∩ 121 키. 빠진 이름·수를 `restore-fingerprints.json` 에 적고 '복원 은행' 으로 진행합니다.
  - F1~F3 결과로 손잡이·문턱·장면 규칙을 바꾸지 않습니다.
- **R4 확인 셋**
  - best_match·ecmwf_ifs025·icon_seamless·gfs_seamless 에서 BLH·SHF·CAPE·T850 이 있는지.
  - best_match 의 T850·Z700·700 hPa 바람이 00~05Z 매시 유한한지(p2).
  - `X-RateLimit-Cost`.
- **F3(R7)**
  - 1 단계: `downscale-run.mjs .harness/macro/sat-nwp-blend .harness/oro/syn-blend --variant prior > .harness/oro/f3-run.log`(esbuild 판 고정).
  - 2 단계: 동결 파일이 될 `oro-fingerprint.py --f3` 가 `macro.py` 의 `beta_of`·`ring_values` 만 불러, 고리와 syn 출력으로 다섯 열(`ringRmse`·`ringRmseBase`·`betaSyn`·`betaC0`·`partialSyn`)을 계산합니다.
  - 출력은 커밋된 `gate-blend-held.json` 과 같은 수 /97 한 줄뿐입니다.
  - **`macro.py --gate` 는 복원 단계에서 돌리지 않습니다.**
- **가중 셈**
  - 셈은 위치마다 max(1, V/10) × max(1, D/14) 입니다. V = 변수 × 모델입니다.
  - RULER-ringtruth 의 고리 3,200 과 맞습니다. 조사서 §3.2 의 식(max 안의 곱)은 이보다 작게 나오니, R4 의 헤더로 확인합니다.
- **SHF 민감도**(선택): 모델 지정 요청 icon_seamless·gfs_seamless, 10 곳 ≈ 110. 예산이 남는 날에만 받습니다.

### 2.2 순서·한도·부분 자료
- **순서**
  - Open-Meteo 가중 0: R1·R2·R3·R8·R9 는 언제든.
  - 한도 리셋 직후: R4 → R5(요청 사이 ≥ 10 s) → 60 s → R6(사이트 사이 60 s) → R7.
  - R10 은 R6 이 끝나고 **1 시간 넘게 지난 뒤**, 되도록 다음 날 리셋 직후에 받습니다.
- **분당 600**
  - R5 는 75 가중 요청을 10 s 마다 보내 ≈ 450/분입니다. 한꺼번에 보내면 754 라 걸립니다(p1).
  - R6 은 318.5 가중 요청을 60 s 마다 보냅니다.
- **시간당 5,000**: R4~R6 ≈ 3,940 은 한 시간 안에 듭니다. R10 을 같은 시간에 붙이면 ≈ 4,784 라 공유 IP 에서 위험합니다 → 분리합니다.
- **하루 10,000(공유 IP)**
  - 첫날은 ≈ 3,940(39 %)입니다.
  - R10 과 oro 확장(고리 사이트당 ≈ 91, 산악 ≤ 6 곳 ≈ 550)은 다음 날로 둡니다.
- **429 규칙**(p1)
  - 일일 429(본문에 'Daily') → 멈추고, 다음 리셋 뒤 사이트 단위로 잇습니다.
  - 분·시간 429 → 1 시간 뒤 다시 돌립니다(`fetch-nwp-ring.py` 는 60 s × 3 뒤 코드 2 로 끝남).
- **GIBS·CMR·Terrarium**
  - GIBS: 순차, 요청 사이 ≥ 0.5 s. 429·5xx 이면 60 s × 3, 그다음 멈추고 다음 시간에 캐시로 잇습니다.
  - CMR: 질의 사이 ≥ 1 s, `page_size=2000`, 실패 3 번이면 멈춥니다.
  - Terrarium: 순차 66 장.
- **부분 자료로는 동결하지 않습니다.**
  - DEM 66/66, 탐측 10/10(확장은 8/8), 고리 10/10, CMR 질의 전부가 있어야 합니다.
  - MODIS 은행은 F1 두 갈래를 따릅니다.
  - C4 영상 받기 실패는 3 번 다시 돌린 뒤 이름만 적고 뺍니다.
  - 복원이 며칠에 걸치면 날짜를 기록합니다.
- **동결 뒤 `.harness/` 가 또 사라지면**
  - 같은 명령으로 다시 받고 manifest 를 견줍니다(`bank-`·`ring-`·`texture-manifest.json`).
  - oro 판정은 원자료가 아니라 커밋된 `oro-inputs.json` 을 읽어 B 가 바뀌지 않습니다.
  - 참값이 달라진 장면은 이름·수를 적고 그대로 판정합니다(참값 판은 ΔC·레짐 목록·렌더와 무관).

### 2.3 확장(개수만 보고)
- **oro**
  - 확장 여부는 oro 2판 규칙이 정해지고, F1~F3·탐측 10/10·고리 10/10 이 끝난 뒤 한 번 셉니다(P7). 기준은 oro 2판 c1 입니다(n ≥ 20 과, D13 이 받아들여지면 날짜 블록·사이트 바닥).
  - **동결 전**: 10-23·10-27·10-31.
    - 영상은 `.harness/oro/sat-ext/` 에 받습니다. 같은 폴더에 받으면 `index.json` 이 덮입니다.
    - 시각: `fetch-modis-time.py --scenes .harness/oro/sat-ext --out tools/genus-ruler/oro/modis-times-ext.json`(새 파일, 동결 대상).
    - 고리: `fetch-nwp-ring.py --scenes .harness/oro/sat-ext --times <위 파일> --tag blend-ext --start 2026-10-23 --end 2026-10-31`.
    - 추가 장면은 통과 시각 해 고도 ≥ 20° 인 것만 씁니다(m4).
  - **동결 뒤**(11-04 부터 4 일 간격, 12-31 까지)
    - 같은 동결 코드로 `oro-apply-extN`·`oro-inputs-extN`·`sounding-manifest-extN`·`bank-manifest-extN` 을 만듭니다. 탐측은 `fetch-sounding.py --start/--end/--out` 으로 받습니다.
    - **짝짓기 전에** `FROZEN-extN.json` 을 별도로 커밋합니다.
    - 12-31 까지 모자라면 미결입니다.
- **regime**
  - 임시 N_R(MODIS 없음) < 60 이면 2026-04~05 월, 다음 2025-06~10 월을 더합니다(R10·R8).
  - 모두 regime 동결 전에 끝냅니다. **동결 뒤에는 확장하지 않고**, 대상 수가 모자라면 미결입니다(R-B4).
  - A_sat 등 위성에서 나온 수는 확장에 쓰지 않습니다.

### 2.4 오염 막기
- **표준 출력과 영상**
  - fetch-sat·fetch-texture 의 표준 출력은 읽지 않습니다.
  - `index.json` 은 `skip`·`error` 키만 읽습니다. held `*.png` 를 열지 않습니다.
- **지울 것과 실행 금지**
  - 장면 사본의 `cover`·`trueGrid` 는 허용 목록으로 지웁니다.
  - `eval-ringtruth.py` 는 실행하지 않습니다.
  - `fetch-modis-time.py`·`macro.py` 는 `--out` 을 붙일 때만 돌립니다. `macro.py --gate` 는 복원 단계에서 돌리지 않습니다.
- **지문**: F2 표준 출력은 로그로 보냅니다. F3 는 T 를 읽지 않는 스크립트로 합니다. 지문 스크립트는 수만 찍습니다.
- **C4**
  - C4 위성은 dev·held 모두 oro 동결 커밋 뒤에 받습니다. oro dev 날짜와 겹치는 dev 를 지키려는 것입니다.
  - held 는 받기만 하고, 스칼라·집계는 regime 동결 뒤 판정 때 한 번 계산합니다.
  - CMR 은 시각·폴리곤·DAY 깃발만 남깁니다.

## 3. 작업 묶음(동결 뒤)
### 3.1 C3 + C1(`macroOro`, 기본 0)
| WP | 파일 | 내용 | 시험 |
|---|---|---|---|
| O0 | `src/utils/macroField.ts` | **이번 회차에서 뺍니다**(p7). 모드 1 합성 건너뛰기를 하려면 동결 전 별도 커밋·별도 바이트 확인으로만 합니다. G1 실패의 원인이 둘로 갈리지 않게 하려는 것입니다 | — |
| O1 | 새 `src/utils/oroLift.ts`(순수, `cloudFlow` 의 `fft2` 만 import) | h_eff(고역·창·막힘) · η_w · 탐측 → V_ref·N·H_w·κ·s_rel · 차 꼴 결합기 · 적용 판정 A1~A6 | TS = 동결 `oro_ref.py`(G5) · F ≡ 0 → `array_equal` · 방향 G6 |
| O2 | 새 `src/utils/oroDem.ts`(순수) | Terrarium 디코드 → 등장방형 6 km 칸 평균, h = max(0, ·), 덮음 깃발. 파이썬 짝은 자 쪽 | 자의 DEM 격자와 같음. 타일 하나를 기기(또는 RN 시험) 디코드 = 파이썬(p10) |
| O3 | `src/utils/macroField.ts` | `MacroFieldOptions.oro?: { F }` — 모드 1 에서만 결합기. 없으면 지금 줄(`cover.set(base)`) 그대로 | G1(a) |
| O4 | `src/components/VolumetricProbe/volumetricScene.ts` | 아래 | G1·G2·G4 |
| O5 | `liveScene.ts`·`SkyScene3D.tsx` | 아래 | 오프라인·결측 = 끔 경로 바이트. G2: 도착 경로(아래) |
| O6(D6) | `src/utils/weather.ts` | 아래 | 기존 요청 URL·캐시 키 바이트 같음 · G1(d) · null 이면 a = 0, 레짐 NA |
| O7 | `tools/genus-ruler/oro/`(`oro-run.mjs`·`oro-core-test.mjs`·`oro.py`), `tools/genus-ruler/volsky/entry.ts` | esbuild 판 고정 번들(three 검사 포함), 허용 목록 입력, 판정 한 번(lock) | G5·G8, tsc 0 |

- **O4 내용**
  - 옵션 `macroOro`(+ `DEFAULT_VOLUMETRIC_OPTIONS`)과 입력 `oro?` 를 둡니다. `macro` 객체에 F 를 캐시합니다.
  - 저·중 밴드만 바꾸고, 모드 2 에서는 끕니다(D9). 타일 운량 상한은 그대로입니다(D10).
  - **이류(D7)**
    - 적용 장면에서만 60 s 마다 C(t) = 결합기(−UΔt 로 민 B, 지형에 고정된 F)를 CPU 에서 다시 만듭니다(밴드당 수 ms). 그 텍스처의 `setMacroDrift` 이류는 0 입니다.
    - 비적용 장면은 지금 그대로입니다(같은 drift 균일변수·기준 시각).
- **O5 내용**
  - DEM 은 `demCpu.loadCpuDemBlock`(디코드 주입, 캐시 없음)으로 받습니다. 덮음이 1 이 아니면 끕니다.
  - 도착하면 장면을 다시 열쇠로 묶습니다(튐 없이 다음 재구성에 반영). 개발 설정과 `qKey` 에는 켜졌을 때만 붙습니다.
  - G2 도착 경로: DEM·새 탐측이 첫 `applyScene` 뒤에 와도, a = 0 장면의 텍스처·렌더, 모드 2 상태, drift 기준 시각이 같아야 합니다.
- **O6 내용**
  - 관측점 **별도 요청**입니다. 변수는 925/700/500 hPa·10 m 바람, 저·상층 운량이고, `elevation` 을 보관합니다. D14 가 예이면 강수·일사를 더합니다.
  - 자기 null 캐시를 둡니다. 기존 URL·캐시 키는 그대로입니다.
  - **`macroOro` 나 `regime` 이 켜졌을 때만 보냅니다**(P11).
  - 가중은 호출당 +1.0 입니다(별도 요청은 최소 1). D14 가 예이면 +1.2 입니다 [computed].
- **하네스**
  - `JOB_BASE_OPTIONS` 에 `macroOro: 0`·`regime: 0` 을 둡니다.
  - G1 잡은 `macro: 1, macroN: 128` 과 고리 입력을 적습니다. 없으면 G1 무효입니다.
  - 먼저 A/A 를 합니다. 같은 컨테이너·chromium 판·SwiftShader 플래그로 그리고, 판을 기록합니다.
  - volsky 로 B0_app·P0_seoul·산악 장면 2 개를 그려 G1·G2 바이트를 확인합니다.
  - 눈 판정용 기기 재현 장면을 그립니다.
- **비용**: 판정은 CPU 몇 분입니다. 렌더는 `npm ci` 와 기존 하네스 환경이 필요합니다.

### 3.2 C4(`regime`, 기본 0)
| WP | 파일 | 내용 | 시험 |
|---|---|---|---|
| W1 | 새 `src/components/VolumetricProbe/blRegime.ts`(순수) | zi(BLH, 아니면 공기 덩이법) · p_sfc(Z 단면) · U_CBL(높이 가중) · 시어(0.1 zi ~ zi) · 대류 대용 · NA 규칙 · 나무 · θ_CBL(약풍이면 시어 축) | = `regime_ref.py`(G7, 경계 여유) |
| W2 | `cloudGenus.ts` | cu·sc 저층 레인 **셰이더 표본 좌표**에 det 1 사상 M. 조각은 켤 때만 넣고("끄면 원문"), ROLL 일 때만 `L.opts.regime`. CPU FIELDS 전역 늘임은 금지(이음매) | G1~G5·G8·G10, J2 |
| W3 | `volumetricScene.ts`·`liveScene.ts`·`SkyScene3D.tsx`·`volsky/entry.ts` | 옵션 `regime`, `weatherPlan` 은 ROLL 일 때만 붙임, D6 입력 배선, 개발 설정, 키에는 켜졌을 때만 | 날씨 키·`qKey` 바이트 같음, G1(d) |
| W4 | 새 `tools/genus-ruler/regime/`(`fetch-sat-times.py`·`fetch-texture.py`·`texture.py`·`texture-test.py`·`regime_ref.py`·`regime-test.py`·`render-tile.mjs`·`regime.py`) + 하네스 지도 시야 패스(G10) | 위성과 렌더에 같은 지표 코드(500 m 맞춤). 렌더는 CPU 세계 창(M 적용) | 합성 롤·세포 지표 · A_null 표 · G6 프레임 시간 · G10 |

### 3.3 공통
- **main 합치기(D8)**: S1 에서, 곧 동결 전 측정·해시·G1 기준을 만들기 전에 합칩니다(P10).
  - 같은 커밋 묶음에서 volsky 묶기에 `demTileCache` 대체(별칭 또는 빈 모듈)를 넣습니다. import 사슬은 `volsky/entry.ts` → `volumetricScene.ts` → `TerrainField.ts` → `demTiles.ts` 입니다.
  - 합치기 전후로 B0_app·P0_seoul 의 rgb·alpha md5 가 같음을 확인합니다.
  - 합친 커밋을 G1 기준 커밋, `old`, `runtime` 해시의 기준으로 두 FROZEN 에 적습니다.
  - `tools/shader-preview/build-*.js` 등 `demTiles`·`demCpu` 를 import 하는 도구 번들(~34 개)이 react-native 를 끌어오는지는 확인하고 기록합니다(미확인). 오로·레짐 판정 도구는 그 둘을 import 하지 않습니다.
- **문서**: 계획서에 새 절(1회차 착수·자 동결·결과)을 둡니다. D1 대로 조사서 §6 의 "두 고도 평균" 문구 옆에 정정 메모를 붙입니다.

## 4. 사용자 결정
### 4.1 받은 결정(2026-11-04, a027662 `oro/draft1/decisions-2026-11-04.md`)
| # | 결정 | 내용 | 2판에서 반영한 곳 |
|---|---|---|---|
| D1 | 예(권장대로) | 조사서 §6 의 "η(1.5)·η(3.0) 평균" 을 S&B 수증기 가중 기둥 변위 η_w 로 바꿈. 두 고도 평균은 민감도 팔 | RULER-oro §0.3·§3.3·§6, 조사서 정정 메모(§3.3) |
| D2 | 예(권장대로) | oro 판정 집합 = held 적용 장면 전부(closest) + 단일 통과 일관성 조항. 장면 수는 동결 전에 개수만 보고 확장 | RULER-oro §2.7·§5.1. 통계 검토 O-B3 이 일관성 조항(c6)을 보고만으로 바꾸기를 권함 → **D12** 로 묻습니다 |
| D3 | 예(권장대로) | 바람 뒤집기 대조 G-rev 와 결빙고도 눈 가림을 합격 조항에 | RULER-oro c3·§4.1. 이유는 "계곡 안개·고른 눈선은 짝수라 G-rev 가 지움. 비탈 방향 잔설·밝기는 홀수라 21 일 눈 기억 가림(z_snow = 21 일 z_0°C 최솟값)이 맡음. 짝 차는 같은 상자 집합에서" 입니다. 21 일 가림은 결빙고도 가림의 정의를 고친 것입니다(V2). 새 조항 G-shuf 는 **D13** |
| D4 | 예(권장대로) | C4 범위: ROLL 늘임만, a ≤ 2, 축 = 경계층 바람, 간격·연직·줄 띠 없음, 세포·무질서는 기록만 | RULER-regime 2판 §0.5·§1·§4 |
| D5 | 예(권장대로) | C4 참값: Aqua + Terra 250 m, 6~10 월 매일, 대체는 VIIRS | RULER-regime 2판 §2.1(하루 한 위성, Aqua 먼저)·§5(500 m 맞춤) |
| D6 | **예** | 앱 관측점 날씨에 925/700/500 hPa·10 m 바람과 저·상층 운량을 **별도 요청 + 자기 null 캐시**로 더함. 기존 요청 URL·캐시 키는 그대로 | O6. 2판: 옵션이 켜졌을 때만 보냄(P11). 강수·일사 추가는 **D14** |
| D7 | **예** | 적용 장면에서만 지형에 묶인 ΔC 를 60 s 마다 CPU 에서 다시 만들고 그 텍스처의 이류는 0. 다른 장면은 지금과 같음 | O4·G2 |
| D8 | 예(권장대로) | 구현 전에 main 합치기, DEM 은 `demCpu`(캐시 없음)로만 | §3.3·S1. 2판은 합치기를 동결 전 측정 앞(S1)으로 당깁니다. 구현 전이라는 결정 안에서 더 이르게 한 것입니다(P10) |
| D9 | 예(권장대로) | `macroOro` 는 모드 2(V 잡음)에서 끔 | O4 |
| D10 | 예(권장대로) | 타일 운량 상한(`macroTileCover`)은 이번에 그대로 | O4. 이유: 날씨 키·타일 바이트 보호. 그래서 RULER-oro 는 보이는 쪽(c8: ρ^vis·풍하 대비)을 합격 조항에 둡니다(V3). 합격 뒤 다음 회차 후보 |

### 4.2 남은 결정(동결 전에 받아야 함)
| # | 질문 | 권장 | 이유 | 아니오이면 |
|---|---|---|---|---|
| D11 | oro c2·c3 에 날짜 블록 부호 뒤집기 정확 검정(한쪽 p ≤ 0.025)을 L95 와 함께 요구할까 | 예 | 블록이 ≤ 16 개라 백분위 L95 의 실제 오류율이 3.5~6 % 입니다(사이트 SD 0.10 이면 7~11 %). 정확 검정은 1.7~1.9 % 입니다. 검정력은 0.55 → 0.42(효과 0.10) [computed, O-B2] | L95 만. 그 오류율을 oro §5.3 에 적음 |
| D12 | D2 의 단일 통과 일관성 조항(c6)을 보고만으로 바꿀까 | 예 | null 에서 0.49 로 통과해 거짓 합격을 막지 못하고, 효과 0.05 에서 동시 검정력만 깎습니다 [computed, O-B3] | c6 을 1판 그대로 판정 조항으로 둠 |
| D13 | oro 2판이 받는 검토 조항이 조사서 §6 의 합격 문구를 좁히는 것을 받아들일까: c2b 진폭(ΔMSE_W ≤ 0, V1) · G-shuf 날짜 섞기(V2) · c8 보이는 쪽(V3) · c1 바닥(날짜 블록 ≥ 8·사이트 ≥ 3·한 사이트 ≤ 50 %, O-B2) | 예 | 각각 거짓 합격 길을 막습니다(진폭 과대, 사이트 고정 무늬, 앱에서 안 보이는 쪽만 맞음, 한 사이트 착시) | 그 조항은 동결 전에 보고만으로 내림 |
| D14 | C4 입력: D6 별도 요청에 강수·일사(`precipitation`·`shortwave_radiation`) 2 변수를 더할까 | 예 | 지금 앱의 관측점 요청에는 둘이 없습니다. 강수는 고리 0 번(블렌드)뿐이고, 일사는 없습니다. 자(best_match 관측점)와 앱이 같은 출처여야 G7 이 뜻을 가집니다. 호출당 가중 +0.2 [computed] | 동결 전에 RULER-regime §3.1 의 두 입력을 고리 0 번 값으로 다시 적고 짧게 재검토 |

## 5. 위험
| 위험 | 영향 | 줄이기 |
|---|---|---|
| Open-Meteo 일일 한도를 공유 IP 가 먼저 씀 | 복원 하루 이상 늦음 | 리셋 직후, 싼 것 먼저, 사이트 단위 resume, R10·oro 확장은 다음 날 |
| 분·시간 한도(600/분, 5,000/시) | 429 로 중단 | R5 요청 사이 ≥ 10 s, R5–R6 사이 60 s, R10 은 R6 과 다른 시간 |
| GIBS 재처리로 은행이 바뀜 | 이전 자와 수치가 어긋남 | F2·F3, "복원 은행" 이름, B 는 이 자가 다시 만듦 |
| 복원 중 MODIS 누설(F2·F3 표준 출력, `index.json` 의 `cover`) | §0.1 사전 등록 기록이 거짓 | F3 는 T 없는 스크립트, F2 는 로그, `index.json` 은 `skip`·`error` 만, `macro.py --gate` 금지(P2) |
| C4 위성이 oro 동결 전에 들어옴 | oro held·dev 누설 | C4 영상은 oro 동결 뒤에만(P8) |
| 동결 뒤 입력이 사라짐(컨테이너 교체) | 재현 불가, B 가 조용히 바뀜 | `oro-inputs.json` 커밋, manifest 들, 다시 받으면 견줌(P4) |
| 방향·부호 실수(행 남/북, 오는/부는 바람, FFT 부호, fastscape v, 셰이더 θ 부호) | ρ 부호·롤 축이 조용히 뒤집힘 | oro G6 (a)~(f) 판정 경로 끝-끝, regime G10 |
| 짝짓기 뒤 결함 발견 | 결과를 보고 고침 | 그 판정은 무효(미결), 새 날짜로만 다시(P1) |
| 눈·안개 착시 | 거짓 합격 | 21 일 눈 기억 가림 + G-rev + G-shuf, c4·c5 도 가림 뒤(V2) |
| 검정력 부족(oro 효과 0.05 에서 0.16~0.24, regime P1 ≈ 0.3) | 불합격을 '효과 없음' 으로 오독 | 꼬리표('작음'·'못 가름'), `power-*.json` 동결(m5·O-B3) |
| C4 두 각의 쏠림·산악 풍하파 | P1 거짓 합격 / 거짓 불합격 | 층 안 순열, 지형 나눔·꼬리표(V6·R-B1) |
| n < 20 / P1 대상 < 30 | 미결 | 동결 전 개수 확장 규칙(oro·regime) |
| best_match 모델 차(동아시아 JMA: BLH·CAPE 없음, 3 시간 기압면), SHF 부호 불명 | C4 입력 결측·잡음 | 공기 덩이 zi, 대류 대용, ±3 h NA 규칙(p2), R4 매시 탐침 |
| Aqua 2026 공급·드리프트 미확인 | C4 참값 공백 | R8 탐침, CMR 수로 VIIRS 대체를 동결 전에 결정 |
| main 합치기로 하네스 번들이 깨짐 | G1 공회전 또는 재동결 | 동결 전 S1 에서 합치고 묶기 고침, 전후 md5(P10) |
| 끔 = 바이트 같음이 빈 시험(잡에 `macro` 없음, 새 요청이 옵션과 무관하게 나감) | '바이트 같음' 이 빈말 | G1 잡 `macro: 1`, G1(d) 요청 목록, D6 요청은 옵션 켜짐에만(P11) |
| 바이트 같음이 깨짐(JSON 키 `0`/`null`, 난수 소비, 셰이더 원문) | 모든 장면이 바뀜 | 옵션이 꺼지면 필드를 붙이지 않음, `JOB_BASE_OPTIONS`, G1·G2 md5 |
| 폰 비용(Hermes ≈ node × 3~10, jitless × 13~37) | 장면 열 때 지연 | F 캐시·입력이 바뀔 때만, D7 재구성은 60 s 에 한 번, 필요하면 64² |
| DEM 비동기 도착으로 하늘이 튐 | 눈에 띄는 변화 | 다음 재구성에 반영, 오프라인이면 끔 경로, G2 도착 경로 |
| C4 전역 늘임 이음매 · CPU 모사 ≠ 셰이더 | 타일 경계 선 · 앱이 안 보이는 것을 판정 | 셰이더 표본 변환 + G5 · G10 |
| §139.4 선례(K0 선호) | 채택 안 될 수 있음 | 받아들임 — 옵션만 남김 |
| 커밋 파일 덮어쓰기(`eval-ringtruth`, `fetch-modis-time`·`macro.py` 기본 출력, `index.json` 덮임) | 기록 오염 | 실행 금지·`--out`·확장은 다른 폴더(P7) |

## 6. 비용 요약
| 항목 | 양 |
|---|---|
| Open-Meteo | ≈ 3,940(첫날) + R10 ≤ 844 + oro 확장 ≤ 1,000 + SHF 민감도 ≈ 110(선택) |
| GIBS | MODIS 은행 130 + C4 ≈ 600~1,000(대류 장면·다른 위성·NONE 20 %, 확장 포함) + oro 확장 ≤ 18 |
| CMR | ≈ 60 질의(+ VIIRS 대체면 ≈ 30) |
| AWS Terrarium | 66 타일 |
| 디스크 | < 1 GB(C4 원영상 포함) |
| CPU | 판정·부트스트랩·순열·`power-*.json` 모의 수십 분. 하네스 렌더는 A/A·G1·G2·G6·G10·눈용 수십 장 |
| 사람 | 결정 D11~D14 한 번, 눈 판정 두 번(oro 3 장면, C4 5 + 1 장면) |

## 7. 검토 답(계획 몫)
**표시**: 해결 · 달리 해결(이유) · 기각(이유). RULER-regime 몫은 그 자 §12, RULER-oro 몫은 oro 2판이 답합니다.

**타당성**
- **V2(계획 몫) 해결**: D3 이유 칸과 §5 행을 바꿨습니다.
- **V3(계획 몫) 해결**: D10 이유 칸을 바꿨습니다.
- **V5(계획 몫) 해결**: S8 에서 oro 눈 판정 3 장면 가운데 ≥ 2 개를 노을로 합니다.
- **V6·V7**: RULER-regime §12 에 답했습니다. 계획은 §5 행만 바꿨습니다.

**통계**
- **P-B1 해결**
  - S5 에서 regime 은 위성을 받기만 하고, 동결 전 스칼라는 dev 만입니다.
  - 확장은 MODIS 없는 N_R 로만 정합니다(§2.3).
  - R9 는 탐침만 합니다. 달리 한 점: dev 영상도 oro 동결 뒤로 미뤘습니다(더 엄격).
- **P-B2 해결**
  - S3·S5 산출에 `power-oro.json`·`power-regime.json` 이 있습니다.
  - D11 행을 두었습니다.
  - D3 이유에 "같은 상자 집합" 을 적었습니다. 집합을 S 로 둘지 S∪S_rev 로 둘지는 oro 2판이 정합니다. 타당성 m1 과 통계 O-B1 이 갈리기 때문입니다.
  - 달리 한 점: D2 의 "단일 통과 일관성 조항" 은 사용자 결정이라 계획이 고치지 않고 **D12** 로 묻습니다.
- **m5(계획 몫) 해결**: §5 에 검정력 행을 더했습니다.

**절차**
- **P2(계획 몫) 해결**: R3·R7·§2.4. `macro.py --gate` 는 복원 단계에서 금지합니다.
- **P3(계획 몫) 해결**: R3 의 F1 두 갈래.
- **P7(계획 몫) 해결**
  - §2.3: 셈 시점, 동결 전·뒤 규칙, `sat-ext/` 폴더.
  - `fetch-modis-time.py`·`macro.py` 는 `--out` 일 때만 돌립니다.
  - `fetch-sounding.py` 에 `--start/--end/--out` 을 둡니다.
- **P8 해결**: S2 에서는 탐침만, S5 에서 받기만, §2.4. 달리 한 점: 검토는 S1 에서 dev 를 허용했지만, dev 도 oro 동결 뒤로 미뤘습니다.
- **P10 해결**
  - S1 에서 합치고 volsky 묶기를 고칩니다. 전후 md5 를 확인하고, 동결~판정 사이에는 합치지 않습니다.
  - S0 은 D1~D10 받음이고, 남은 D11~D14 는 동결 전에 받습니다.
- **P11(계획 몫) 해결**: O5 의 G2 도착 경로, O6 은 옵션이 켜졌을 때만, 하네스 `macro: 1` 잡.
- **p1 해결**: §2.2 의 분·시간 한도와 429 규칙.
- **p2 해결**: R4 탐침, RULER-regime §2.2.
- **p4 해결**: S8 은 oro 2판 §5.2 규칙을 씁니다.
- **p7 해결**: O0 을 이번 회차에서 뺐습니다.
- **p8 해결**: S1 A/A, §3.1 하네스.
- **p10 해결**: O2 시험.
- **p12 해결**: 머리 '판', S0·S4·S5 의 "잰 값 → 짧은 재검토 → 동결".
- **P1·P4·P5·P6·p6**: 내용은 oro 2판의 몫입니다. 계획은 산출물(`oro-base.mjs`·`oro-inputs.json`·manifest 들·G6 (f)·lock)과 S7 순서만 맞췄습니다.

**2판에서 더 고친 것(검토 밖)**
- D6 가중을 고쳤습니다: 별도 요청은 최소 1 이라 1판의 +0.7 → +1.0 [computed].
- D14 를 새로 두었습니다(앱에 강수·일사 출처 없음).
- C4 영상을 대류 장면 위주로 줄였습니다.
- C4 작업 묶음 이름을 R1~R4 → W1~W4 로 바꿨습니다(복원 R1~R10 과 겹침).
- 진행 중인 복원에 2판 규칙을 적용하는 문장을 넣었습니다(§0).
