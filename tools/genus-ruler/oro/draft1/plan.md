# atmos 1회차 계획 — 자료 복원 → 두 자 동결 → 구현 → 판정(초안, 2026-11-04)

범위(사용자 결정 §171.3): C3 + C1(옵션 `macroOro`)과 C4(옵션 `regime`)를 같은 회차에 다루고 판정은 따로 합니다.
- C3 + C1 은 산악 장면에서만 작동하고 나머지는 바이트 같음입니다.
- 자 초안은 scratchpad `atmos1/RULER-oro.md` 와 `atmos1/RULER-regime.md` 입니다. 근거는 `code-map.md`·`data-plan.md`·`method.md`·`bench/` 입니다.

## 0. 지금
- **가지**: `claude/eloquent-clarke-73zhgy` @ a04b3ff.
  - main(a8a4f61)이 앱 커밋 2 개 앞섭니다(날짜 선택기, DEM 타일 캐시, 역지오코딩).
  - DEM 관련 사항은 둘입니다.
    - `demTiles.ts` 가 `demTileCache.ts`(react-native·expo-file-system)를 top-level 에서 import 합니다.
    - 받기에 실패하면 **어떤 z/x/y 에든 z0 세계 타일 URI** 를 돌려줍니다 → 틀린 지형이 조용히 들어옵니다.
  - `demCpu.loadCpuDemBlock` 은 캐시를 거치지 않아 안전합니다.
- **사라진 것**: `.harness/`(MODIS 은행, `sat-nwp-*`, syn 출력), `ring/nwp/` 원자료.
- **남은 것**: fetch 스크립트, `ring/modis-times.json`(121 키), `macro/sat-quartiles.json`, `ring/gate-*-held.json`. 뒤의 둘은 장면별 위성 값이 있어 열지 않습니다.
- **도구**
  - node v22.23.4, `node_modules` 없음(`npm ci` 필요는 하네스 렌더와 G1·G5).
  - esbuild 는 lockfile 에 없음 → 판을 고정합니다(`npx esbuild@<판>`).
  - numpy 2.5.3·Pillow 12.3.0, scipy 없음. 두 자 모두 numpy 만 씁니다. 이전 FROZEN 은 numpy 2.4.6 이었으니 새 판을 기록합니다.
- **탐침**(호스트당 1 요청)
  - GIBS·Terrarium·Open-Meteo forecast·previous-runs 는 200.
  - **historical 은 429**(공유 IP 의 일일 한도 소진, 리셋 2026-11-04 00:00:47Z).

## 1. 순서 한눈에
| 단계 | 무엇 | 선행 | 산출 |
|---|---|---|---|
| S0 | 사용자 결정 D1~D6 받기(§4) | — | 자 2판의 전제 |
| S1 | 자료 복원(§2) | 없음(MODIS·DEM 은 지금도 됨, Open-Meteo 는 리셋 뒤) | 은행·탐측·고리·DEM, 지문 F1~F3 |
| S2 | 동결 전 도구와 점검 | S1 | `oro_ref.py`·G6 방향 시험·`oro-apply.json`·n·G7. `regime_ref.py`·`regime-list.json`·J2·dev a |
| S3 | 3 관점 검토 → 2판 → 동결. **oro 먼저**, regime 은 위성 무늬를 받은 뒤 따로 | S2 | `FROZEN.json` 두 개 |
| S4 | 구현(§3) | S3 | 앱·하네스 코드, 옵션 기본 0 |
| S5 | 가드 → 판정 한 번 | S4 | `gate-oro-held.json`·`gate-regime-held.json`, 자 §10·§11 |
| S6 | 눈 판정 → 기본값은 사용자가 | S5 합격 | 계획서 새 절 |

## 2. 자료 복원(먼저 — 커밋 파일은 덮지 않음)
| # | 무엇 | 명령 | Open-Meteo 가중 | 그 밖 | 시간 |
|---|---|---|---|---|---|
| R1 | DEM | 새 `tools/genus-ruler/oro/fetch-dem.py`: z6(hamburg z5) 3×3 블록 + ±450 km, 타일 66 개, sha256·ETag·version-id 목록 | 0 | 6 MB | 1 분 |
| R2 | MODIS 은행 | `fetch-sat.py .harness/macro/sat --sites dev`, 그다음 `--sites all`. 표준 출력은 로그로, **읽지 않음** | 0 | GIBS 130 장, 30 MB | 5~15 분 |
| R3 | 지문 F1·F2 | 이름 = 121 키·빠진 9 장면, `macro.py --truth … --out <새 파일>` 대 `sat-quartiles.json` 의 **같은 수만** | 0 | — | 1 분 |
| R4 | 탐침 | 서울(dev) 1 요청: best_match·ecmwf_ifs025·icon_seamless·gfs_seamless 에서 BLH·SHF·CAPE·T850 이 있는지, `X-RateLimit-Cost` | ≈ 2 | — | 초 |
| R5 | 관측점 탐측 | 새 `fetch-sounding.py`: 10 사이트 × 1 요청, best_match, 2026-06-01 ~ 10-31, ≈ 69 변수, `wind_speed_unit=ms` | ≈ 750 | 10 MB | 3 분 |
| R6 | 실제 NWP 고리 | `fetch-nwp-ring.py --tag blend`(+ `-lm`). 무료 변형: latest·m1h·p1h | ≈ 3,185 | 90 MB | 12~17 분 |
| R7 | 지문 F3 | `downscale-run.mjs`(esbuild 판 고정) → `macro.py --gate … --out <새 파일>` → NWP 열만 비교, **수만** | 0 | 35 MB | 2 분 |
| R8 | C4 시각 | 새 도구: CMR MYD03·MOD03, 사이트 × 위성 20 질의(쪽 나눔). 먼저 Aqua 2026 granule 수 탐침 | 0 | — | 수 분 |
| R9 | C4 위성 무늬 | 새 `fetch-texture.py`: 기하 거름 뒤 ~1,000 장(96 km, 250 m). 스칼라만 쓰고 held 영상은 열지 않음 | 0 | 일시 ~200 MB | 30~60 분 |

- **가중 셈**
  - 셈은 위치마다 max(1, V/10) × max(1, D/14) 입니다. V = 변수 × 모델입니다.
  - RULER-ringtruth 의 고리 3,200 과 맞습니다. 조사서 §3.2 의 식(max 안의 곱)은 이보다 작게 나오니, R4 의 헤더로 확인합니다.
- **하루 몫**: R4~R6 ≈ 3,940(일일 10,000 의 39 %), 시간당 5,000 아래입니다.
  - 공유 IP 라 리셋 직후 R4 → R5 → R6 순서로 갑니다(싼 것 먼저).
  - 일일 429 가 나면 사이트 단위로 다음 날 잇습니다.
- **확장(개수만 보고)**
  - oro n < 20 이면: 산악 held 사이트에 10-23·10-27·10-31 을 받습니다(GIBS 18 장 이하, 고리 사이트당 ≈ 91, CMR 은 새 파일).
  - C4 P1 대상이 15 보다 적으면: 2026-04~05 월, 다음 2025-06~10 월을 받습니다(탐측 사이트당 ≈ 30~75 더).
- **오염 막기**
  - fetch-sat·fetch-texture 의 표준 출력은 읽지 않습니다. held `*.png` 를 열지 않습니다.
  - 장면 사본의 `cover`·`trueGrid` 는 허용 목록으로 지웁니다.
  - `fetch-modis-time.py`·`eval-ringtruth.py` 는 실행하지 않습니다. `macro.py` 는 늘 `--out` 을 붙입니다.
  - 지문 스크립트는 수만 찍습니다.

## 3. 작업 묶음(동결 뒤)
### 3.1 C3 + C1(`macroOro`, 기본 0)
| WP | 파일 | 내용 | 시험 |
|---|---|---|---|
| O0(선택) | `src/utils/macroField.ts` | 모드 1(`noise === false`)에서 버리는 `synthesizeLatent` 를 건너뜁니다(밴드당 ~10.8 ms node). `state`·`beta` 는 그대로 돌려줍니다 | 121 장면 × 3 밴드 출력과 모드 1 → 2 전환 뒤 상태가 바이트 같음 |
| O1 | 새 `src/utils/oroLift.ts`(순수, `cloudFlow` 의 `fft2` 만 import) | h_eff(고역·창·막힘) · η_w · 탐측 → V_ref·N·H_w·κ·s_rel · 차 꼴 결합기 · 적용 판정 A1~A6 | TS = 동결 `oro_ref.py`(G5) · F ≡ 0 → `array_equal` · 방향 G6 |
| O2 | 새 `src/utils/oroDem.ts`(순수) | Terrarium 디코드 → 등장방형 6 km 칸 평균, h = max(0, ·), 덮음 깃발. 파이썬 짝은 자 쪽 | 자의 DEM 격자와 같음 |
| O3 | `src/utils/macroField.ts` | `MacroFieldOptions.oro?: { F }` — 모드 1 에서만 결합기. 없으면 지금 줄(`cover.set(base)`) 그대로 | G1(a) |
| O4 | `src/components/VolumetricProbe/volumetricScene.ts` | 옵션 `macroOro`(+ `DEFAULT_VOLUMETRIC_OPTIONS`), 입력 `oro?`, `macro` 객체에 F 캐시, 저·중 밴드만, 모드 2 는 끔, D7 대로 이류 처리 | G1·G2·G4 |
| O5 | `liveScene.ts`·`SkyScene3D.tsx` | DEM 은 `demCpu.loadCpuDemBlock`(디코드 주입, 캐시 없음)으로 받고 덮음이 1 이 아니면 끔. 도착하면 장면을 다시 열쇠로 묶음(튐 없이 다음 재구성에 반영). 개발 설정과 `qKey` | 오프라인·결측 = 끔 경로 바이트 |
| O6(D6) | `src/utils/weather.ts` | 관측점 **별도 요청**(925/700/500 hPa·10 m 바람, 상·저층 운량), 자기 null 캐시. 기존 URL·캐시 키는 그대로 | 기존 요청 URL 바이트 같음 · null 이면 a = 0 |
| O7 | `tools/genus-ruler/oro/`(`oro-run.mjs`·`oro-core-test.mjs`·`oro.py`), `tools/genus-ruler/volsky/entry.ts` | esbuild 판 고정 번들(three 검사 포함), 허용 목록 입력, 판정 한 번. `JOB_BASE_OPTIONS` 에 `macroOro: 0` | G5·G8, tsc 0 |

- **하네스**
  - volsky 로 B0_app·P0_seoul·산악 장면 2 개를 그려 G1·G2 바이트를 확인합니다.
  - 눈 판정용 기기 재현 3 장면을 그립니다.
- **비용**: 판정은 CPU 몇 분입니다. 렌더는 `npm ci` 와 기존 하네스 환경이 필요합니다.

### 3.2 C4(`regime`, 기본 0)
| WP | 파일 | 내용 | 시험 |
|---|---|---|---|
| R1 | 새 `src/components/VolumetricProbe/blRegime.ts`(순수) | zi(BLH, 아니면 공기 덩이법), U_CBL, 시어, 대류 대용, 나무, θ_CBL | = `regime_ref.py`(G7) |
| R2 | `cloudGenus.ts` | cu·sc 저층 레인 **셰이더 표본 좌표**에 det 1 사상 M. 조각은 켤 때만 넣고("끄면 원문"), ROLL 일 때만 `L.opts.regime`. CPU FIELDS 전역 늘임은 금지(이음매) | G1~G5·G8, J2 |
| R3 | `volumetricScene.ts`·`liveScene.ts`·`SkyScene3D.tsx`·`volsky/entry.ts` | 옵션 `regime`, `weatherPlan` 은 ROLL 일 때만 붙임, 입력 배선, 개발 설정, `JOB_BASE_OPTIONS` | 날씨 키 바이트 같음 |
| R4 | 새 `tools/genus-ruler/regime/`(`fetch-texture.py`·CMR 시각·`texture.py`·`texture-test.py`·`regime_ref.py`·`render-tile.mjs`) | 위성과 렌더에 같은 지표 코드. 렌더는 CPU 세계 창(M 적용)을 250 m 로 표본 | 합성 롤·세포 지표 · G6 프레임 시간 |

### 3.3 공통
- **main 합치기(D8)**: 구현 전에 합치기를 권합니다.
  - 합친 뒤에는 `demTiles`·`demCpu` 를 import 하는 도구 번들(`tools/shader-preview/build-*.js` 등 ~34 개)이 react-native 를 끌어올 수 있습니다(미확인). 오로·레짐 도구는 그 둘을 import 하지 않습니다.
- **문서**: 계획서에 새 절(1회차 착수·자 동결·결과)을 둡니다. D1 이 받아들여지면 조사서 §6 의 "두 고도 평균" 문구 옆에 정정 메모를 붙입니다.

## 4. 사용자 결정(동결 전)
| # | 질문 | 권장 | 이유 |
|---|---|---|---|
| D1 | 조사서 §6 의 "η(1.5)·η(3.0) 평균" 을 S&B 기둥 변위 η_w 로 바꿀까 | 바꿈(두 고도는 민감도 팔) | 두 고도 평균은 U ≈ 4.8~5.7 m/s 에서 0 이 되고 흔한 바람에서 부호가 뒤집힙니다. 예보 오차 ±20 % 에 무늬 재현 −0.10~0.69 대 η_w ≥ 0.97 [computed] |
| D2 | oro 판정 집합: held 적용 장면 전부(closest) + 단일 통과 일관성 조항, 장면 수는 동결 전에 개수만 보고 확장 | 예 | 단일 통과만이면 n 17~27 → 미결 위험 |
| D3 | 바람 뒤집기 대조 G-rev 와 결빙고도 눈 가림을 합격 조항에 | 예 | 눈·계곡 안개는 바람에 짝수라 지워짐 |
| D4 | C4 범위: ROLL 늘임만(a ≤ 2, 축 = 경계층 바람, 간격·연직·줄 띠 없음), 세포·무질서는 기록만 | 예 | §139.4 "기둥", §139.3 "롤 띠 과장" |
| D5 | C4 참값: Aqua + Terra 250 m, 6~10 월 매일, 대체는 VIIRS | 예 | 9~10 월 13 날짜로는 P1 n < 15 |
| D6 | **앱의 관측점 날씨 요청에 기압면 바람(925/700/500 hPa)·10 m 바람·상·저층 운량을 더해도 될까**(별도 요청 + 자기 null 캐시, 기존 요청 그대로) | 예(관측점 요청 1 회당 +≈ 0.7 가중) | 없으면 oro 는 850 hPa 만(덴버는 땅속 → 적용 안 됨) 쓰고, C4 는 850 hPa 를 경계층 바람으로 씀. 두 자를 그 입력으로 다시 적어야 함 |
| D7 | 지형에 묶인 ΔC 와 `setMacroDrift`(텍스처 전체를 −UΔt 로 미는 것) | 적용 장면에서만 60 s 마다 C(t) = 결합기(밀린 B, 고정 F) 로 CPU 재구성(밴드당 수 ms), 그 텍스처의 이류는 0 | 그대로 두면 10 m/s 에서 30 분에 18 km 어긋남 — 강제 규모(12~80 km)와 같음. A 채널 레인은 밴드 둘을 못 담음 |
| D8 | main 을 구현 전에 합칠까, DEM 은 `demCpu`(캐시 없음)로만 | 예 | z0 후퇴 |
| D9 | `macroOro` 는 모드 2(V 잡음)에서 끔 | 예 | AR(1) 사슬·상태 보호, 판정 범위 밖 |
| D10 | 타일 운량 상한(`macroTileCover`)은 이번에 그대로(바람받이 증가는 화면에서 잘림) | 예 | 날씨 키·타일 바이트 보호. 합격 뒤 다음 회차 후보 |

## 5. 위험
| 위험 | 영향 | 줄이기 |
|---|---|---|
| Open-Meteo 일일 한도를 공유 IP 가 먼저 씀 | 복원 하루 이상 늦음 | 리셋 직후, 싼 것 먼저, 사이트 단위 resume |
| GIBS 재처리로 은행이 바뀜 | 이전 자와 수치가 어긋남 | F2·F3, "복원 은행" 이름, B 는 이 자가 다시 만듦 |
| 방향·부호 실수(행 남/북, 오는/부는 바람, FFT 부호, fastscape v) | ρ 부호가 조용히 뒤집힘 | G6 합성·알려진 산 시험을 동결 전에 |
| 눈·안개 착시 | 거짓 합격 | 가림 + G-rev |
| n < 20 / P1 < 15 | 미결 | 동결 전 개수 확장 규칙 |
| best_match 모델 차(동아시아 JMA: BLH·CAPE 없음, 3 시간 기압면), SHF 부호 불명 | C4 입력 결측·잡음 | 공기 덩이 zi, 대류 대용, 기록 |
| Aqua 2026 공급·드리프트 미확인 | C4 참값 공백 | R8 탐침, Terra + VIIRS 대체를 동결 전에 결정 |
| 바이트 같음이 깨짐(JSON 키 `0`/`null`, 난수 소비, 셰이더 원문) | 모든 장면이 바뀜 | 옵션이 꺼지면 필드를 붙이지 않음, `JOB_BASE_OPTIONS`, G1·G2 md5 |
| 폰 비용(Hermes ≈ node × 3~10, jitless × 13~37) | 장면 열 때 지연 | F 캐시·입력이 바뀔 때만, 필요하면 64² |
| DEM 비동기 도착으로 하늘이 튐 | 눈에 띄는 변화 | 다음 재구성에 반영, 오프라인이면 끔 경로 |
| C4 전역 늘임 이음매 | 타일 경계 선 | 셰이더 표본 변환 + G5 |
| §139.4 선례(K0 선호) | 채택 안 될 수 있음 | 받아들임 — 옵션만 남김 |
| 커밋 파일 덮어쓰기(`fetch-modis-time`·`eval-ringtruth`·`macro.py` 기본 출력) | 기록 오염 | 실행 금지·`--out` |

## 6. 비용 요약
| 항목 | 양 |
|---|---|
| Open-Meteo | ≈ 3,940(첫날) + 확장 ≤ 1,000 |
| GIBS | MODIS 은행 130 + C4 ~1,000 + 확장 |
| AWS Terrarium | 66 타일 |
| 디스크 | < 0.5 GB(일시 ~0.3 GB 포함) |
| CPU | 판정·부트스트랩 수 분. 하네스 렌더는 G1·G2·G6·눈용 수십 장 |
| 사람 | 결정 D1~D10 한 번, 눈 판정 두 번(oro 3 장면, C4 3 + 1 장면) |
