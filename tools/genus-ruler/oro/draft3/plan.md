# atmos 1회차 계획 — 자료 복원 → 두 자 동결 → 구현 → 판정 — **초안 3판 고침 1(동결 준비 점검 반영 · 동결 전), 2026-11-04**

범위(사용자 결정 §171.3): C3 + C1(옵션 `macroOro`)과 C4(옵션 `regime`)를 같은 회차에 다루고 판정은 따로 합니다.
- C3 + C1 은 산악 장면에서만 작동하고 나머지는 바이트 같음입니다.

**판**
1. 1판(103aa7a).
2. 3 관점 검토(`oro/draft1/review-{validity,statistics,procedure}.md`).
3. 사용자 결정 D1~D10(2026-11-04, a027662).
4. 2판(07e368c).
5. 2판 재검토 3 개(`oro/draft2/recheck-{validity,statistics,procedure}.md`, 07e368c·5bc1ec4).
6. 사용자 결정 D11~D14(2026-11-04, 37787e1).
7. **이 3판**. 고침 1 은 3판 동결 준비 점검 세 문서(`oro/draft3/ready-{validity,statistics,procedure}.md`, 7db26c0·bb3b3e2)와 복원 기록의 잰 값을 받았습니다(§8 '동결 준비 점검 답').

**자**
- 2판(커밋 07e368c, 동결 전): `tools/genus-ruler/oro/RULER-oro.md`, `tools/genus-ruler/regime/RULER-regime.md`, 계획 `oro/draft2/plan.md`.
- 3판 고침 1(동결 전): `tools/genus-ruler/oro/RULER-oro.md`, `tools/genus-ruler/regime/RULER-regime.md`, 이 계획. 3판 원문은 7db26c0 입니다(scratchpad `atmos1/*.v3.md` 와 바이트 같음).
- 근거: `oro/draft1/{code-map,data-plan,method}.md`·`bench/`·`stat/`, `oro/draft2/recheck-sims/`, 3판 모의 `oro/draft3/v3-sims/`(simD·simE), 점검 모의 `oro/draft3/ready-sims/`·`ready-proc/`(모두 MODIS 없음).
- 검토 답은 §7(2판)·§8(3판)에 있습니다.

**꼬리표**: 자와 같습니다.

## 0. 지금(2026-11-04)
- **가지**: `claude/eloquent-clarke-73zhgy` @ 8c88acf(고침 1 전). 3판 자·계획(7db26c0), 동결 준비 점검 세 문서(7db26c0·bb3b3e2), 복원 결과와 복원 기록(`oro/restore-log.md`)까지 커밋돼 있습니다.
  - main(98affae·a8a4f61, 앱 커밋 2 개: 날짜 선택기, DEM 타일 캐시, 역지오코딩)을 S1 에서 합쳤습니다(합친 커밋 115fbe2, §1 S1).
    - 하네스 묶기는 `volsky/build.sh`(ece32b1: react-native·expo-file-system 대체 모듈, PNG 빈 모듈, esbuild 0.28.2)입니다. 대체 없는 예전 esbuild 명령으로 `volsky/entry.ts`·`tsun/entry-tsun.ts`·`tsun/entry-gpuwin.ts` 를 묶으면 합친 뒤 셋 다 실패합니다 [measured].
    - `tools/shader-preview/stage-esm.js` 는 합친 뒤 `utils/demTileCache.js` 에 맨 `'react-native'` 를 남깁니다(구조로 확인, 기록만 하고 고치지 않음). 오로·레짐 도구는 `demTiles`·`demCpu` 를 import 하지 않습니다.
  - DEM 관련 사항은 둘입니다.
    - `demTiles.ts` 가 `demTileCache.ts`(react-native·expo-file-system)를 top-level 에서 import 합니다.
    - 받기에 실패하면 **어떤 z/x/y 에든 z0 세계 타일 URI** 를 돌려줍니다 → 틀린 지형이 조용히 들어옵니다.
  - `demCpu.loadCpuDemBlock` 은 캐시를 거치지 않아 안전합니다.
- **복원 상태**(2026-11-04, `oro/restore-log.md`) [measured]
  - R2 MODIS 은행·R6 실제 NWP 고리: **끝남**. 커밋된 스크립트(`macro/fetch-sat.py`·`ring/fetch-nwp-ring.py`)로 `.harness/`(gitignore)에 받았습니다.
  - R1 DEM: **커밋**(679f460). `oro/fetch-dem.py`·`oro/dem-manifest.json`, 66/66, 실패 0, z6 9 곳·hamburg z5.
  - R3 F1·F2·R7 F3: **끝**(`oro/restore-fingerprints.json`).
    - F1: 이름 121/121(빠짐·더함 0), `index.json` 의 skip 9·error 0.
    - F2: 사분위 수치 잎 767/767 같음.
    - F3: held 97/97 장면에서 T 없는 다섯 열이 모두 같음(esbuild 0.28.2).
  - R4: **끝**(`oro/probe-r4.json`, 서울 2026-09-05).
    - best_match 에 BLH·SHF·CAPE·T850 이 있음(24/24 유한). ecmwf_ifs025 는 BLH·SHF 가, icon_seamless 는 BLH 가 없음.
    - best_match 의 T850·Z700·700 hPa 바람이 00~05Z 매시 유한.
    - `X-RateLimit-Cost` 1.6(16 변수×모델)·1.0(4 변수) → 위치·하루마다 max(1, V/10) 이 맞음(§2.1 가중 셈).
  - R5: **1/10**(busan, 가중 76.5, 3,672 h, 70 변수). 다음 곳(denver)은 SSL 끊김 뒤 다시 보내자 일일 429(공유 IP)라 멈췄습니다. 나머지 9 곳은 2026-11-05 00:00 UTC 리셋 뒤 사이트 단위로 잇습니다(`oro/sounding-manifest.json` 은 부분).
    - 70 변수는 자의 ≈ 69 의 상위 집합입니다: 전체·중층 운량을 더 받고, `freezing_level_height` 는 보관만 합니다(판정에 안 씀).
    - `oro/fetch-sounding.py` 는 커밋됐고 `--models` 를 받습니다. manifest 이름은 `--manifest` 를 주지 않으면 `--out` 에서 만듭니다: `sounding.json` → `sounding-manifest.json`, `sounding-ecmwf.json` → `sounding-ecmwf-manifest.json`, `sounding-oro-ext1.json` → `sounding-oro-ext1-manifest.json`.
  - R8: **끝**(`regime/sat-times.json.gz`, 60/60 질의 = 10 사이트 × Aqua·Terra × 기간 3: p2026 06~10, p2026spring 04~05, p2025 06~10. 3판은 둘만 씀).
    - held DAY 사이트-날(달별): Aqua 2026 239~248, Terra 228~247 → Aqua 가 Terra 의 절반 아래인 달이 없어 VIIRS 대체 없음.
    - 통과 지방 평균 태양시 사분위: Aqua 2026-06~10 15.17 h(14.67~15.63), 2026 봄 14.93, 2025 14.40. Terra 2026-06~10 9.02 h(8.57~9.52), 2026 봄 9.25, 2025 9.60. ~13:30·~09:40 이 아닙니다(RULER-regime 고침 1 §0.4).
  - R9: **끝**(`regime/probe-layers.json`). MODIS Aqua·Terra TrueColor 둘 다 HTTP 200 image/png, 디코드하지 않음.
  - 누구도 MODIS 운량 값·held 영상을 열지 않습니다. 복원 로그도 열지 않습니다.
  - 남은 것: R5 9 곳(11-05 리셋 뒤), R11(그 뒤, R5 와 ≥ 1 시간 띄움, §2.2), 필요하면 R10.
- **커밋 파일 가운데 열지 않는 것**: `ring/modis-times.json`(121 키)은 키만 씁니다. `macro/sat-quartiles.json`·`ring/gate-*-held.json` 은 장면별 위성 값이 있어 열지 않습니다.
- **도구**
  - node v22.23.4, `node_modules` 없음. `npm ci` 는 하네스 렌더·G1·G5·G10 에만 필요합니다.
  - esbuild 는 lockfile 에 없음 → 판을 고정합니다(`npx esbuild@<판>`). 복원 F3 와 S1 묶기는 0.28.2 입니다.
  - numpy 2.5.3·Pillow 12.3.0, scipy 없음. 두 자 모두 numpy 만 씁니다. 이전 FROZEN 은 numpy 2.4.6 이었으니 새 판을 기록합니다.
- **탐침**(2026-11-03, 호스트당 1 요청)
  - GIBS·Terrarium·Open-Meteo forecast·previous-runs 는 200.
  - historical 은 429(공유 IP 의 일일 한도 소진, 리셋 2026-11-04 00:00:47Z).

### 0.1 복원 기록과 노출 등급(재검토 절차 N4)
- **왜**: 복원은 1판·2판 명령으로 했습니다. `fetch-sat.py` 는 장면마다 처리 결과(`cover` 포함)를 표준 출력에 찍습니다(`fetch-sat.py:111`). 1판 F3 의 `macro.py --gate` 는 held 사분위를 찍습니다. 그런 값이 화면에 나왔다면, 그 뒤에 사람이 고른 손잡이는 사전 등록이라 할 수 없습니다.
- **적을 것**(복원을 돌린 사람·세션이, 값을 보지 않고): 단계(R1·R2·R6 …), 명령 그대로, 시작·끝 시각(UTC), 표준 출력·오류가 간 자리와 그 sha256, 그 출력을 화면에서 본 사람이 있는지, 있으면 무엇이었는지(장면별인지 집계인지, held 인지 dev 인지). `macro.py --gate` 를 돌렸는지도 적습니다.
- **노출 등급**: 없음 / dev 만 / held 집계 / held 장면별 / 모름(두 자와 같은 다섯). 기록이 채워지기 전까지는 '모름' 이고, 모름은 held 장면별과 같게 다룹니다(보수적).
- **귀결**(세부는 각 자: RULER-oro 3판 §0.1, RULER-regime 3판 §0.2)
  - **held 장면별 또는 모름**: 그 시각 뒤에는 비기계적 바꿈(§4.2 의 조건부 물음, 측정 뒤 재검토로 바꾸는 규칙)을 하지 않고 3판대로 동결합니다. 조건부 물음은 묻지 않고 3판 규칙(D15 = 동결 뒤 확장 함, D16 = (가) 그대로 동결)으로 갑니다. 기계적 규칙(n 셈·동결 전 확장·주 지표·기간·a 고르기 등)은 그대로 돕니다. 두 자의 동결 기록과 판정 꼬리표에 "동결 전 held 장면별 노출(계획 §0.1)" 을 붙입니다.
  - **held 집계**: 바꿈을 할 수 있습니다. 대신 "동결 전 held 운량 집계 노출(계획 §0.1)" 꼬리표를 붙입니다.
  - **dev 만**: 적기만 합니다(dev 운량은 손잡이에 쓰지 않음).
  - **없음**: 그대로.
  - D11~D14 는 이미 받았고 답이 모두 2판 권장안과 같습니다. 그래서 노출 기록이 나와도 결정 때문에 움직인 손잡이는 없습니다.
  - 3판과 그 동결 준비 점검 세 문서(커밋)의 고칠 글은 등급과 무관하게 한 번 받습니다. 모두 MODIS 값·영상·held 파일·복원 로그를 열지 않고 MODIS 없는 수로만 썼습니다. 그 뒤의 바꿈은 위 귀결을 따릅니다.
- **기록**(2026-11-04, 8c88acf): `oro/restore-log.md` 의 '노출 기록' 표. 노출 등급은 **없음**(dev·held 모두)입니다 [measured].
  - MODIS 운량 값·held 영상·F2/F3 로그가 화면에 나온 적이 없습니다. 화면에 나온 것은 끝 코드·수·NWP 받기 오류 줄뿐입니다.
  - R2 표준 출력(장면마다 `cover`)은 로그 파일로 갔고 열지 않았습니다. F2 표준 출력(`f2.log`)은 열지 않았고, F3 실행 로그(`f3-run.log`)는 줄 수(`grep -c .`, 121)와 `grep -i "esbuild\|error"`(맞는 줄 없음)만 했습니다(`oro/restore-log.md`).
- 로그 파일은 이 기록을 쓸 때도 열지 않습니다. 자리와 sha256 만 적습니다.
- 등급과 시각은 두 자의 §0.4·§0.5 와 FROZEN `decisions` 에 적습니다.

## 1. 순서 한눈에
- **상태(2026-11-05 12:06 KST)**: oro 는 S4 에서 **동결**하고 RULER-oro §5.2 줄 ② **미결**(c1 미달: n 4, 날짜 블록 4, 사이트 2, 한 사이트 몫 0.75)로 닫았습니다(`oro/FROZEN.json`, RULER-oro §10.1·§10.3). D15 아니오·D16 (가)(2026-11-05, a8c0806).
  - 짝짓기·T 읽기·lock·판정 실행은 없습니다. c1 은 MODIS 없이 정해지고 판정 때 줄어들 수만 있기 때문입니다(RULER-oro §2.8 ②③).
  - S6·S7·S8 의 oro 몫은 하지 않습니다(`macroOro` 안 만듦, C3 는 앱에 없음, oro 의 G1 기준 `g1-baseline.json` 도 재지 않음). G1 기준 커밋과 `g1-baseline-regime.json` 은 regime(S5) 몫으로 남습니다.
  - **다음은 regime(S5)** 입니다. 그 선행 'oro 동결 커밋' 은 이 동결 커밋(`oro/FROZEN.json` 을 더한 커밋)으로 채워집니다.

| 단계 | 무엇 | 선행 | 산출 | 지키는 것 |
|---|---|---|---|---|
| S0 | 사용자 결정 D1~D14 **받음**(2026-11-04, a027662·37787e1, §4.1). 2판 재검토 3 개 → 이 3판. 조건부 물음 D15·D16 은 조건이 생겨 **받음**(2026-11-05, a8c0806: D15 아니오, D16 (가), §4.2, oro 몫) | — | 자 3판의 전제 | P10·p12·N1 |
| S1 | main 합치기 + volsky 묶기에 `demTileCache` 대체(별칭 또는 빈 모듈) + 하네스 A/A + 합치기 전후 B0_app·P0_seoul rgb·alpha md5 같음. 그 위에 G1 측정 도구만 더한 **G1 기준 커밋**. **합치기·묶기·A/A 끝**: 115fbe2(origin/main a8a4f61), `volsky/build.sh`(ece32b1), `oro/merge-aa.json` — 합치기 전 A/A·후 A/A·전 = 후 md5 가 B0_app·P0_seoul 의 rgb·alpha 모두 같음(묶음 md5 는 다름: 대체 모듈과 main 코드), chromium 'Google Chrome for Testing 153.0.8010.12', SwiftShader 플래그는 그 파일에. G1 기준 커밋은 아직 | S0 | 합친 커밋, G1 기준 커밋(G1 기준·`old`·`runtime` 의 기준) | P10·p8·q7 |
| S2 | 자료 복원: R1(커밋)·R2·R3·R4·R6·R7·R8·R9 **끝**, R5 **10/10**(나머지 9 곳은 11-05 09:32~10:34 KST), R11 받지 않음(oro ecmwf 팔 '못 잼'), R10 은 필요할 때. 복원 기록(§0.1, 노출 등급 dev 만 — held 없음) | 없음(R4·R5·R10·R11 은 한도 안에서) | 은행·탐측·고리·DEM, F1~F3, `restore-fingerprints.json`, `regime/sat-times.json.gz`, 복원 기록(`oro/restore-log.md`) | P2·P3·P8·p1·p2·N4 |
| S3 | oro 동결 전 측정 — 아래 목록 | S1·S2 | 위 파일들 | P4~P7·P11·O-B3 |
| S4 | oro 3판 §0 에 잰 값 → (규칙이 바뀌면 그 차이만 짧게 재검토) → oro `FROZEN.json`·**동결 커밋**. 동결 문턱은 아래. **끝(2026-11-05)**: 규칙 바뀜 없음(S3-design 이 넘긴 짧은 재검토 항목은 하지 않음, RULER-oro §9.1 ⑧), 동결하고 §5.2 줄 ② **미결**(c1 미달)로 닫음. FROZEN sha256 `a507e949…`, rulerHash `63957b8c…`, 동결 커밋 = `FROZEN.json` 을 더한 커밋 | S3(D15·D16 의 답 받음) | oro FROZEN, RULER-oro §0.5·§10.1·§10.3 | P4·p12·N1 |
| S5 | regime 동결 전 — 아래 순서. **다음 단계** | S4 — oro 동결 커밋은 이 동결 커밋으로 채워짐(임시 N_R 은 S2 뒤 언제든) | regime FROZEN | P8·P9·R-B1·R-B4·p11e·N1 |
| S6 | 구현(§3), 합친 main 위에서. 옵션 기본 0. oro 몫은 **하지 않음**(oro 미결, `macroOro` 안 만듦), regime 몫은 S5 뒤 | S5 | 앱·하네스 코드 | — |
| S7 | 가드 → 판정 한 번 — 아래 목록. oro 몫은 **하지 않음**(oro 미결) | S6 | `gate-regime-held.json`, RULER-regime §11(oro 몫 없음) | P1·P4·p6·N3 |
| S8 | 눈 판정 → 기본값은 사용자가. oro 몫은 **없음**(합격 아님) | S7 합격 | 계획서 새 절 | V5·p4·M7·m11 |

- **동결 문턱**(재검토 절차 N1)
  - oro(S4): D11~D13(받음), 복원 기록(§0.1)의 등급, 그리고 조건이 생겼으면 D15(동결 전 확장 뒤에도 c1 미달)·D16(`power-oro.json` 0.10 에서 동시 통과 < 0.2)의 답이 있어야 합니다. 부분 자료로는 동결하지 않습니다(§2.2). → 모두 채움(등급 dev 만, D15·D16 받음, 탐측 10/10·고리 10/10), 2026-11-05 동결.
  - regime(S5): D14(받음), oro 동결 커밋(이 동결 커밋으로 채워짐), regime 3판 §10.1 ①~⑨ 의 산출이 있어야 합니다. D15·D16 은 regime 에 닿지 않습니다.
- **S3 목록**
  - `oro-base.mjs`(B = `buildMacroField(…).base`, Float32), `oro_ref.py`, G6 전부(oro 3판 §7 — 판정 경로 끝-끝·대조 시험 포함).
  - `dem-/sounding-/bank-/ring-manifest.json`, `oro-inputs.json`, `oro-apply.json`.
  - n 셈 한 번(c1: n ≥ 20 과 D13 의 날짜 블록·사이트 바닥. 필요하면 동결 전 확장 10-23·27·31).
  - G7, `power-oro.json`(D11~D13 을 받은 규칙 하나로), `g1-baseline.json`(G1 기준 커밋, `macro: 1, macroN: 128` 잡). → oro 의 G1 기준은 **하지 않음**(oro 미결로 구현이 없음, RULER-oro §9.1 ⑦). 나머지는 끝(RULER-oro §0.5).
- **S5 순서**
  1. `regime_ref.py` 로 임시 N_R 을 셉니다. 모자라면 R10 확장 탐측(2025-06~10)을 받고 기간을 정합니다.
  2. 최종 `regime-list.json` 과 `regime-shift-axes.json`(지형 깃발은 동결 `oro_ref.py`)을 **함께 커밋**합니다.
  3. `power-regime.json`(P1 두 null·P2 층·J3 '과장 없음' 확인) → `texture-test.py`(A_null·r(a)·ΔI_mech(a)) → `render-tile.mjs`·J2(세 a 모두).
  4. C4 위성(dev·held)을 **받기만** 합니다.
  5. dev 스칼라 → a(내림)·마스크 점검·고른 a 의 J2 조건(`dev-choice.json`).
  6. 3판 §0.4 에 잰 값 → (재검토) → regime `FROZEN.json`·동결 커밋.
- **S7 목록**
  - oro: G1~G5·G8·G9 → 해시를 §10.2 에 → `oro.py --judge` → 곧바로 커밋. → **하지 않음**(oro 미결로 닫음).
  - regime: G1~G10 → 해시를 §11.2 에 → `regime.py --judge`(수 한 줄 → P1(두 null)·P2·J3, 값은 결과 파일에만) → 곧바로 커밋.
  - **두 판정 공통**(재검토 절차 N3)
    - 참값(T·held 위성)을 읽기 전에 판정·대조·보고·민감도의 입력이 모두 있고 manifest·FROZEN 해시와 맞는지 봅니다. 없으면 lock 없이 멈춥니다. 없는 팔을 '못 잼' 으로 두는 것은 보고 팔일 때만, 읽기 전에 기록하고 고릅니다.
    - lock 은 참값을 처음 읽기 직전에 씁니다. 표준 출력에는 진행 표시만 찍습니다.
    - 읽은 뒤 멈추면 출력은 열지 않고 sha256 만 적습니다. 코드·입력을 바꾸지 않고 환경만 고쳐 돌 수 있으면 `judge.lock.1` 로 한 번만 다시 돕니다. 코드·입력을 바꿔야 하면 짝짓기 뒤 결함 규칙(판정 경로면 무효(미결))입니다.
- **S8 장면**
  - oro 3 장면: 그 가운데 ≥ 2 개는 노을이고, 고르는 규칙은 oro 3판 §5.2 입니다. → **없음**(oro 미결).
  - C4: ROLL 5 + 대조 1. 노을·낮 ROLL 비율과, 붙었으면 지형 꼬리표를 먼저 보입니다.
  - '모르겠다' 는 C4·`macroOro` 를 고르지 않은 것으로 셉니다.
- 동결과 판정 사이에는 main 을 합치지 않습니다.

## 2. 자료 복원(커밋 파일은 덮지 않음)
### 2.1 단계
| # | 무엇 | 명령·규칙 | Open-Meteo 가중 | 그 밖 | 시간 |
|---|---|---|---|---|---|
| R1 | DEM(**커밋, 66/66**) | `tools/genus-ruler/oro/fetch-dem.py`: z6(hamburg z5) 3×3 블록 + ±450 km, 타일 66 개, sha256·ETag·version-id 목록. 679f460 에 커밋 | 0 | 6 MB | 끝 |
| R2 | MODIS 은행(**끝**) | 커밋된 `fetch-sat.py .harness/macro/sat --sites dev`, 그다음 `--sites all`. 표준 출력은 **읽지 않음**. `index.json` 은 지문 스크립트가 `skip`·`error` 키만 읽음. 복원 기록 §0.1 | 0 | GIBS 130 장, 30 MB | 끝 |
| R3 | 지문 F1·F2(**끝**: F1 121/121, skip 9·error 0 · F2 767/767 같음) | F1 은 두 갈래(아래). F2 = `macro.py --truth … --out .harness/oro/sat-quartiles-restore.json > .harness/oro/f2.log`(읽지 않음) 대 `sat-quartiles.json` 의 **같은 수만** | 0 | — | 끝 |
| R4 | 탐침(**끝**, `probe-r4.json`) | 서울(dev) 1 요청. 확인 셋은 아래 | ≈ 2(잰 값 1.6 + 1.0) | — | 끝 |
| R5 | 관측점 탐측(**1/10**, busan) | 새 `fetch-sounding.py`(커밋): 10 사이트 × 1 요청, best_match, 2026-06-01 ~ 10-31, ≈ 69 변수(실제 70, §0), `wind_speed_unit=ms`. **요청 사이 ≥ 10 s**. `--start/--end/--out`·`--models` 인자를 둡니다(확장·R11 이 스크립트를 고치지 않게) | ≈ 754(잰 값 76.5/곳) | 10 MB | 일일 429 로 멈춤, 9 곳은 11-05 00:00 UTC 리셋 뒤 |
| R6 | 실제 NWP 고리(**끝**) | 커밋된 `fetch-nwp-ring.py --tag blend`(+ `-lm`). 무료 변형: latest·m1h·p1h | ≈ 3,185(쓴 것) | 90 MB | 끝 |
| R7 | 지문 F3(T 없음, **끝**: held 97/97 다섯 열 같음) | 아래 | 0 | 35 MB | 끝 |
| R8 | C4 시각(**끝**, 60/60) | 새 `fetch-sat-times.py`: CMR MYD03·MOD03, 사이트 × 위성 × 후보 기간 2 개(2026-06~10 · 2025-06~10) ≈ 40 질의(쪽 나눔). 평균 태양일 창. 시각·폴리곤·DAY 깃발만 저장. 먼저 Aqua 2026 granule 수(달별 수만). 실제로는 2판 후보 2026-04~05 까지 기간 3 개 60 질의를 받았고, 3판은 둘만 씀. VIIRS 대체 없음(§0) | 0 | — | 끝 |
| R9 | C4 레이어 탐침(**끝**: Aqua·Terra 200 image/png) | 레이어마다 64 px 1 장(내용 보지 않음). **C4 영상은 S5(oro 동결 뒤)에 받음** | 0 | — | 끝 |
| R10 | C4 확장 탐측(필요할 때만) | 임시 N_R < 60 일 때만, held 8 곳, 2025-06-01 ~ 10-31 하나. 같은 `fetch-sounding.py --start … --end … --out sounding-regime-ext.json`. manifest 는 `--out` 에서 만든 `oro/sounding-regime-ext-manifest.json`(RULER-regime §2.2·§10.2 와 같은 이름, 점검 절차 q-a) | ≈ 603 | — | 2 분 |
| R11 | oro ecmwf 탐측(oro 3판 §2.5 ④, §6 민감도 팔; **남음**, R5 9 곳 뒤 ≥ 1 시간 띄워) | `fetch-sounding.py --models ecmwf_ifs025 --start 2026-06-01 --end 2026-10-31 --out sounding-ecmwf.json` 10 요청(재검토 절차 P4). `sounding-ecmwf-manifest.json`(동결), 장면 값은 `oro-inputs.json` 에. 동결 전에 받지 못하면 그 팔은 '못 잼' | ≈ 750 | — | 2 분 |

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
  - 확인함 [measured]: R4 하루 요청이 16 변수×모델 1.6, 4 변수 1.0 이라 위치마다 max(1, V/10)(하루)입니다. R5 busan(70 변수, 153 일)의 76.5 = 7 × 153/14 도 이 식과 맞습니다 [computed].
- **SHF 민감도**(선택): 모델 지정 요청 icon_seamless·gfs_seamless, 10 곳 ≈ 110. 예산이 남는 날에만 받습니다.

### 2.2 순서·한도·부분 자료
- **순서**(재검토 절차 q6 — 사실대로)
  - Open-Meteo 가중 0: R1(커밋)·R3·R8·R9 는 언제든.
  - R6·R4·R7 은 끝났습니다. 남은 Open-Meteo 단계는 R5 9 곳(요청 사이 ≥ 10 s, 2026-11-05 00:00 UTC 리셋 뒤) → R11 입니다. R4 의 가중 확인은 끝났습니다(§2.1 가중 셈).
  - R11 은 고리(R6)가 끝나고 **1 시간 넘게 지난 뒤**, 되도록 다음 날 리셋 직후에 받습니다(oro 3판). R5 와도 다른 시간에 둡니다.
  - R10 은 R11 과 다른 시간에, 되도록 다음 날 리셋 직후에 받습니다.
- **분당 600**
  - R5 는 75 가중 요청을 10 s 마다 보내 ≈ 450/분입니다. 한꺼번에 보내면 754 라 걸립니다(p1).
  - R11 도 요청 사이 ≥ 10 s 입니다.
- **시간당 5,000**: R4·R5 ≈ 756, R11 ≈ 750, R10 ≈ 603 은 각자 다른 시간에 둡니다. R6(≈ 3,185)을 쓴 시간에는 붙이지 않습니다.
- **하루 10,000(공유 IP)**
  - R6 을 쓴 날에 R4·R5 를 더하면 ≈ 3,940(39 %)입니다. R11 까지 같은 날이면 ≈ 4,700(47 %)입니다.
  - R11·R10 과 oro 확장(고리 사이트당 ≈ 91, 산악 ≤ 6 곳 ≈ 550)은 되도록 다음 날로 둡니다.
- **429 규칙**(p1)
  - 일일 429(본문에 'Daily') → 멈추고, 다음 리셋 뒤 사이트 단위로 잇습니다.
  - 분·시간 429 → 1 시간 뒤 다시 돌립니다(`fetch-nwp-ring.py` 는 60 s × 3 뒤 코드 2 로 끝남).
- **GIBS·CMR·Terrarium**
  - GIBS: 순차, 요청 사이 ≥ 0.5 s. 429·5xx 이면 60 s × 3, 그다음 멈추고 다음 시간에 캐시로 잇습니다.
  - CMR: 질의 사이 ≥ 1 s, `page_size=2000`, 실패 3 번이면 멈춥니다.
  - Terrarium: 순차 66 장(끝).
- **부분 자료로는 동결하지 않습니다.**
  - DEM 66/66, 탐측 10/10(확장은 8/8), 고리 10/10, CMR 질의 전부가 있어야 합니다.
  - MODIS 은행은 F1 두 갈래를 따릅니다.
  - C4 영상 받기 실패는 3 번 다시 돌린 뒤 이름만 적고 뺍니다.
  - 복원이 며칠에 걸치면 날짜를 기록합니다.
- **동결 뒤 `.harness/` 가 또 사라지면**
  - 같은 명령으로 다시 받고 manifest 를 견줍니다(`bank-`·`ring-`·`texture-manifest.json`). 탐측은 `--out sounding-refetchN.json` 으로 받아(manifest 는 그 이름에서) 원 manifest 와 사이트별 sha256 만 견주고(RULER-oro §2.9), `fetch-texture.py` 는 `texture-manifest-refetchN.json` 에 씁니다(RULER-regime §2.3). 동결 manifest 는 덮지 않습니다(점검 절차 q-a).
  - oro 판정은 원자료가 아니라 커밋된 `oro-inputs.json` 을 읽어 B 가 바뀌지 않습니다.
  - 참값이 달라진 장면은 이름·수를 적고 그대로 판정합니다(참값 판은 ΔC·레짐 목록·렌더와 무관).

### 2.3 확장(개수만 보고)
- **oro**
  - 확장 여부는 F1~F3·탐측 10/10·고리 10/10 이 끝난 뒤 한 번 셉니다(P7). 기준은 oro 3판 c1 입니다: n ≥ 20, 날짜 블록 ≥ 8, 사이트 ≥ 3, 한 사이트 ≤ 50 %(D13 받음).
  - **동결 전**: 10-23·10-27·10-31.
    - 영상: `fetch-sat.py .harness/oro/sat-ext --sites held --dates 2026-10-23:2026-10-31:4 > .harness/oro/fetch-sat-ext.log`(로그는 읽지 않음). `.harness/macro/sat` 에 더 받으면 `index.json` 이 덮이므로 새 폴더입니다.
    - 시각: `fetch-modis-time.py --scenes .harness/oro/sat-ext --out tools/genus-ruler/oro/modis-times-ext.json`(새 파일, 동결 대상).
    - 고리: `fetch-nwp-ring.py --scenes .harness/oro/sat-ext --times <위 파일> --tag blend-ext --start 2026-10-23 --end 2026-10-31`.
    - 추가 장면은 통과 시각 해 고도 ≥ 20° 인 것만 씁니다(m4).
  - **동결 뒤**(첫 날은 앞선 확장(동결 전·pre2)의 마지막 날 + 4 일, 그 뒤 4 일 간격, 12-31 까지. pre2 가 없으면 10-31 + 4 = 11-04 — 점검 절차 q-d, RULER-oro §2.7 과 같은 규칙) — 동결 전 확장 뒤에도 c1 이 모자라고 **D15 가 '예'** 일 때만(§4.2). §0.1 노출 규칙에 걸리면 묻지 않고 확장합니다(oro 3판 §2.7)
    - N 번째 동결 뒤 확장(N = 1, 2, …)은 앞 확장의 폴더·파일·태그를 다시 쓰지 않습니다(재검토 절차 P7).
      - 영상: `fetch-sat.py .harness/oro/sat-extN --sites held --dates <첫 날>:<끝 날>:4 > .harness/oro/fetch-sat-extN.log`(읽지 않음).
      - 시각: `fetch-modis-time.py --scenes .harness/oro/sat-extN --out tools/genus-ruler/oro/modis-times-extN.json`(새 파일).
      - 고리: `fetch-nwp-ring.py --scenes .harness/oro/sat-extN --times tools/genus-ruler/oro/modis-times-extN.json --tag blend-extN --start <첫 날> --end <끝 날>`.
      - 탐측: `fetch-sounding.py --start <첫 날 − 21 일> --end <끝 날> --out sounding-oro-extN.json --manifest tools/genus-ruler/oro/sounding-manifest-extN.json`(점검 절차 q-a, RULER-oro §2.7 과 같음; `--manifest` 가 없으면 `sounding-oro-extN-manifest.json` 이 됨). z_snow 는 이 파일 하나로 셉니다.
      - 이유: `fetch-modis-time.py` 는 `--out` 파일에 덧써서 동결 파일을 바꿉니다(`:57·93`). `fetch-nwp-ring.py` 는 같은 태그의 원자료가 있으면 다시 받지 않아, 새 날짜가 모두 'missing' 으로 빠집니다(`:75·86`). 같은 폴더의 `index.json` 은 덮입니다(`fetch-sat.py:113`).
    - 같은 동결 코드로 `oro-apply-extN`·`oro-inputs-extN`·`sounding-manifest-extN`·`ring-manifest-extN`·`bank-manifest-extN`·`cmr-geom-extN`·`modis-times-extN` 을 만듭니다.
    - **짝짓기 전에** `FROZEN-extN.json` 을 별도로 커밋합니다.
    - 12-31 까지 모자라면 미결입니다.
  - **D15 가 '아니오' 이면** 동결 뒤 확장은 없고, 그대로 동결해 판정 때 c1 미달 = 미결로 닫습니다.
  - D16 의 (나)(검정력 때문에 동결 전 확장을 11-04 뒤로 이음)는 `sat-pre2`·`modis-times-pre2.json`·`blend-pre2`·`sounding-oro-pre2.json` 처럼 `extN` 과 겹치지 않는 이름을 씁니다(oro 3판 §4.7).
- **regime**
  - 임시 N_R(MODIS 없음) < 60 이면 2025-06~10 월을 더합니다(R10·R8). D5 의 "6~10 월" 안입니다. 2판의 2026-04~05 월은 D5 밖이라 지웠습니다(재검토 타당성 m8(b)).
  - 모두 regime 동결 전에 끝냅니다. **동결 뒤에는 확장하지 않고**, 대상 수가 모자라면 미결입니다(R-B4).
  - A_sat 등 위성에서 나온 수는 확장에 쓰지 않습니다.

### 2.4 오염 막기
- **표준 출력과 영상**
  - fetch-sat·fetch-texture 의 표준 출력은 읽지 않습니다.
  - `index.json` 은 `skip`·`error` 키만 읽습니다. held `*.png` 를 열지 않습니다.
  - 복원된 `.harness/` 의 로그는 열지 않고, §0.1 기록은 자리와 sha256 만으로 씁니다.
- **지울 것과 실행 금지**
  - 장면 사본의 `cover`·`trueGrid` 는 허용 목록으로 지웁니다.
  - `eval-ringtruth.py` 는 실행하지 않습니다.
  - `fetch-modis-time.py`·`macro.py` 는 `--out` 을 붙일 때만 돌립니다. `macro.py --gate` 는 복원 단계에서 돌리지 않습니다.
- **지문**: F2 표준 출력은 로그로 보냅니다. F3 는 T 를 읽지 않는 스크립트로 합니다. 지문 스크립트는 수만 찍습니다.
- **C4**
  - C4 위성은 dev·held 모두 oro 동결 커밋 뒤에 받습니다. oro dev 날짜와 겹치는 dev 를 지키려는 것입니다.
  - held 는 받기만 하고, 스칼라·집계는 regime 동결 뒤 판정 때 한 번 계산합니다. 판정의 수 한 줄도 결과 파일에만 씁니다.
  - `regime-list.json`·`regime-shift-axes.json` 은 어떤 위성 스칼라보다 먼저 함께 커밋합니다.
  - CMR 은 시각·폴리곤·DAY 깃발만 남깁니다.
- **노출이 있었으면**: §0.1 의 등급에 따른 귀결을 따릅니다.

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
| O6(D6·D14) | `src/utils/weather.ts` | 아래 | 기존 요청 URL·캐시 키 바이트 같음 · G1(d) · null 이면 a = 0, 레짐 NA |
| O7 | `tools/genus-ruler/oro/`(`oro-run.mjs`·`oro-core-test.mjs`·`oro.py`), `tools/genus-ruler/volsky/entry.ts`. `oro.py` 는 oro FROZEN `files`(동결 파일은 S3·S5 에서 완성, 동결 뒤 고치지 않음) | esbuild 판 고정 번들(three 검사 포함), 허용 목록 입력, 판정 한 번(읽기 전 확인·lock·멈춤 규칙) | G5·G8, tsc 0 |

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
- **O6 내용**(D6·D14 받음)
  - 관측점 **별도 요청 하나**입니다. 변수는 925/700/500 hPa·10 m 바람, 저·상층 운량, 강수·일사(`precipitation`·`shortwave_radiation`, D14)이고, `elevation` 을 보관합니다.
  - 자기 null 캐시를 둡니다. 기존 URL·캐시 키는 그대로입니다.
  - **`macroOro` 나 `regime` 이 켜졌을 때만 보냅니다**(P11, D14 결정 문구).
  - RULER-regime 3판 §3.1 의 앱 입력(바람·운량·강수·일사·`elevation`)은 이 요청에서 옵니다.
  - 가중은 호출당 +1.2 입니다(별도 요청은 최소 1, 두 변수 +0.2) [computed].
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
| W1 | 새 `src/components/VolumetricProbe/blRegime.ts`(순수) | zi(BLH, 아니면 공기 덩이법) · p_sfc(Z 단면) · U_CBL(높이 가중) · 시어(0.1 zi ~ zi) · 대류 대용 · NA 규칙 · 나무 · θ_CBL(약풍이면 시어 축). 입력은 D6 별도 요청(D14 변수 포함)과 기존 열역학 요청 | = `regime_ref.py`(G7, 경계 여유) |
| W2 | `cloudGenus.ts` | cu·sc 저층 레인 **셰이더 표본 좌표**(`getGlobeUv` 가 낸 접평면 좌표)에 det 1 사상 M. 조각은 켤 때만 넣고("끄면 원문"), ROLL 일 때만 `L.opts.regime`. CPU FIELDS 전역 늘임은 금지(이음매) | G1~G5·G8·G10, J2 |
| W3 | `volumetricScene.ts`·`liveScene.ts`·`SkyScene3D.tsx`·`volsky/entry.ts` | 옵션 `regime`, `weatherPlan` 은 ROLL 일 때만 붙임, D6 입력 배선, 개발 설정, 키에는 켜졌을 때만 | 날씨 키·`qKey` 바이트 같음, G1(d) |
| W4 | 새 `tools/genus-ruler/regime/`(`fetch-sat-times.py`·`fetch-texture.py`·`texture.py`·`texture-test.py`·`regime_ref.py`(시간 이동 축표 포함)·`regime-test.py`·`render-tile.mjs`·`regime.py`) + 하네스 지도 시야 패스(G10). 도구 여덟(`fetch-sat-times.py`·`fetch-texture.py`·`texture.py`·`texture-test.py`·`regime_ref.py`·`regime-test.py`·`render-tile.mjs`·`regime.py`)은 모두 regime FROZEN `files`(RULER-regime §10.2; 동결 파일은 S3·S5 에서 완성, 동결 뒤 고치지 않음) | 위성과 렌더에 같은 지표 코드(500 m 맞춤). 렌더는 CPU 세계 창(M 적용). G10 패스는 앱 틀 경로(ECEF p → `getGlobeUv`)를 지나고 틀·regime 균일변수를 앱 재질에서 복사(재검토 절차 P9) | 합성 롤·세포 지표 · A_null 표 · r(a)·ΔI_mech(a) · G6 프레임 시간 · G10 (a) 무늬·(b) 배선 |

### 3.3 공통
- **main 합치기(D8)**: S1 에서, 곧 동결 전 측정·해시·G1 기준을 만들기 전에 합칩니다(P10).
  - 같은 커밋 묶음에서 volsky 묶기에 `demTileCache` 대체(별칭 또는 빈 모듈)를 넣습니다. import 사슬은 `volsky/entry.ts` → `volumetricScene.ts` → `TerrainField.ts` → `demTiles.ts` 입니다.
  - 합치기 전후로 B0_app·P0_seoul 의 rgb·alpha md5 가 같음을 확인합니다.
  - 그 위에 G1 측정 도구(md5 스크립트, `liveScene` 요청 가로채기 시험)만 더한 **G1 기준 커밋**을 만듭니다. 앱 코드 변경은 없습니다(재검토 절차 q7).
  - G1 기준 커밋을 두 FROZEN 의 G1 기준·`old`·`runtime` 해시의 기준으로 적습니다. 두 자의 `g1-baseline*.json` 은 이 커밋에서 잽니다.
  - `tools/shader-preview/build-*.js` 등 `demTiles`·`demCpu` 를 import 하는 도구 번들(~34 개)은 `stage-esm.js` 가 `utils/demTileCache.js` 에 맨 `'react-native'` 를 남겨 브라우저에서 모듈을 못 풉니다(구조로 확인, 기록만 하고 고치지 않음, §0). 오로·레짐 판정 도구는 그 둘을 import 하지 않습니다.
- **문서**: 계획서에 새 절(1회차 착수·자 동결·결과)을 둡니다. D1 대로 조사서 §6 의 "두 고도 평균" 문구 옆에 정정 메모를 붙입니다. D13 으로 좁힌 합격 문구도 같은 메모에 적습니다.

## 4. 사용자 결정
### 4.1 받은 결정(2026-11-04 — D1~D10 a027662, D11~D14 37787e1, `oro/draft1/decisions-2026-11-04.md`)
| # | 결정 | 내용 | 3판에서 반영한 곳 |
|---|---|---|---|
| D1 | 예(권장대로) | 조사서 §6 의 "η(1.5)·η(3.0) 평균" 을 S&B 수증기 가중 기둥 변위 η_w 로 바꿈. 두 고도 평균은 민감도 팔 | RULER-oro §0.3·§3.3·§6, 조사서 정정 메모(§3.3) |
| D2 | 예(권장대로) | oro 판정 집합 = held 적용 장면 전부(closest) + 단일 통과 일관성 조항. 장면 수는 동결 전에 개수만 보고 확장 | RULER-oro §2.7·§5.1. 일관성 조항 c6 은 D12 로 보고만이 됨. 동결 뒤 확장은 D2 보다 넓어, 조건이 생기면 D15 로 묻습니다 |
| D3 | 예(권장대로) | 바람 뒤집기 대조 G-rev 와 결빙고도 눈 가림을 합격 조항에 | RULER-oro c3·§4.1. 이유는 "계곡 안개·고른 눈선은 짝수라 G-rev 가 지움. 비탈 방향 잔설·밝기는 홀수라 21 일 눈 기억 가림(z_snow = 21 일 z_0°C 최솟값)이 맡음. 짝 차는 같은 상자 집합에서" 입니다. 21 일 가림은 결빙고도 가림의 정의를 고친 것입니다(V2). 사이트 고정 홀수 무늬는 D13 의 G-shuf 가 맡습니다 |
| D4 | 예(권장대로) | C4 범위: ROLL 늘임만, a ≤ 2, 축 = 경계층 바람, 간격·연직·줄 띠 없음, 세포·무질서는 기록만 | RULER-regime 3판 §0.5·§1·§4(a 는 dev 과녁 아래로 내림) |
| D5 | 예(권장대로) | C4 참값: Aqua + Terra 250 m, 6~10 월 매일, 대체는 VIIRS | RULER-regime 3판 §2.1(하루 한 위성, Aqua 먼저)·§5(500 m 맞춤). 확장도 6~10 월(2025)로만 |
| D6 | **예** | 앱 관측점 날씨에 925/700/500 hPa·10 m 바람과 저·상층 운량을 **별도 요청 + 자기 null 캐시**로 더함. 기존 요청 URL·캐시 키는 그대로 | O6. 옵션이 켜졌을 때만 보냄(P11) |
| D7 | **예** | 적용 장면에서만 지형에 묶인 ΔC 를 60 s 마다 CPU 에서 다시 만들고 그 텍스처의 이류는 0. 다른 장면은 지금과 같음 | O4·G2 |
| D8 | 예(권장대로) | 구현 전에 main 합치기, DEM 은 `demCpu`(캐시 없음)로만 | §3.3·S1. 합치기를 동결 전 측정 앞(S1)으로 당김(구현 전이라는 결정 안에서 더 이르게, P10) |
| D9 | 예(권장대로) | `macroOro` 는 모드 2(V 잡음)에서 끔 | O4 |
| D10 | 예(권장대로) | 타일 운량 상한(`macroTileCover`)은 이번에 그대로 | O4. 이유: 날씨 키·타일 바이트 보호. 그래서 RULER-oro 는 보이는 쪽(c8)을 합격 조항에 둡니다(V3, D13). 합격 뒤 다음 회차 후보 |
| D11 | **예**("엄격하게") | oro c2·c3 에 날짜 블록 부호 뒤집기 정확 검정(한쪽 p ≤ 0.025)을 L95 와 함께 요구 | RULER-oro 3판 §4.7·c2·c3, `power-oro.json`. '아니오' 대체 글은 쓰지 않음 |
| D12 | **예**("보고만") | 단일 통과 일관성 조항 c6 은 보고만(합격에 안 씀) | RULER-oro 3판 c6·§4.6. `power-oro.json` 의 동시 통과에서 c6 을 뺌 |
| D13 | **예**("엄격하게") | c2b 진폭(ΔMSE_W ≤ 0), G-shuf 날짜 섞기 대조, c8 보이는 쪽, c1 바닥(날짜 블록 ≥ 8·사이트 ≥ 3·한 사이트 ≤ 50 %)을 합격 조항으로 | RULER-oro 3판 c1·c2b·c3b·c8, 계획 §2.3 의 c1 셈·S3, 조사서 정정 메모(§3.3) |
| D14 | **예**("더 넣기") | D6 별도 요청에 강수·일사(`precipitation`·`shortwave_radiation`)를 더함. 그 요청은 `macroOro` 나 `regime` 이 켜졌을 때만 보냄 | O6(가중 +1.2), RULER-regime 3판 §0.5·§3.1(앱 입력이 이 요청에서 옴)·G1(d)·§10.1 ⓪ |

### 4.2 남은 결정 — 받아야 할 것은 없음, 조건부 물음 둘(oro 몫)
D11~D14 를 받아 동결 전에 꼭 받아야 할 결정은 없습니다. 아래 둘은 **조건이 생길 때만** oro 동결(S4) 전에 묻습니다(RULER-oro 3판 §2.7·§4.7). regime 동결(S5)은 막지 않습니다.

| # | 묻는 조건 | 질문 | 권장 | 이유 | 아니오이면 |
|---|---|---|---|---|---|
| D15 | 동결 전 확장(10-23~31) 뒤에도 c1(n ≥ 20, D13 바닥)이 모자람 | oro 의 **동결 뒤 확장**(첫 날 = 앞선 확장(동결 전·pre2)의 마지막 날 + 4 일, pre2 가 없으면 11-04; 4 일 간격, 12-31 까지; 짝짓기 전에 개수만 보고 `FROZEN-extN` 커밋)을 할까. D2 의 "장면 수는 동결 전에 개수만 보고 확장" 보다 넓습니다(재검토 타당성 m8(a)) | 예 | c1 을 넘을 기회를 늘립니다. 짝짓기 전에 개수만 보고 정하므로 순차 검정이 아닙니다(통계 재검토 §4). 비용: 판정 범위에 11~12 월(낮은 해·이른 눈) 장면이 들어옵니다. 해 고도 ≥ 20° 만 씁니다 | 그대로 동결하고 판정 때 c1 미달 = 미결로 닫음. 동결 뒤 확장 글(oro §2.7, 계획 §2.3)은 쓰이지 않음 |
| D16 | `power-oro.json` 에서 참 중앙 ρ 0.10 의 동시 통과 확률 < 0.2 | 셋 가운데 무엇으로 갈까: (가) 그대로 동결 · (나) 동결 전 확장을 11-04 뒤로 이어 한 번 더 셈(`*-pre2` 이름) · (다) D11·D13 의 답을 다시 정함 | (가) | 검정력은 꼬리표('작음'·'못 가름')와 `power-oro.json` 으로 기록됩니다. (나)·(다)는 결과를 보지 않은 채 할 수 있지만 범위를 넓히거나 받은 결정을 되돌립니다 | — (셋 가운데 고름) |

- §0.1 의 노출 등급이 held 장면별이나 모름이고 그 시각이 물음보다 앞서면, 묻지 않고 3판 규칙으로 갑니다: D15 는 확장 함, D16 은 (가). 두 물음은 held 값과 무관하게 개수·검정력 규칙만 정하기 때문입니다.
- 물음을 하게 되면 답과 날짜를 이 표 아래와 oro FROZEN `decisions` 에 적습니다.
- 같은 안내에 "D3 의 눈 가림은 21 일 눈 기억(정의 고침, V2)" 을 한 줄로 함께 알립니다(§8 타당성 N1).

## 5. 위험
| 위험 | 영향 | 줄이기 |
|---|---|---|
| Open-Meteo 일일 한도를 공유 IP 가 먼저 씀 | 남은 탐측 하루 이상 늦음 | 리셋 직후, 싼 것 먼저, 사이트 단위 resume, R10·oro 확장은 다음 날 |
| 분·시간 한도(600/분, 5,000/시) | 429 로 중단 | R5·R11 요청 사이 ≥ 10 s, R4·R5·R10·R11 은 R6 과 다른 시간, 서로도 다른 시간 |
| GIBS 재처리로 은행이 바뀜 | 이전 자와 수치가 어긋남 | F2·F3, "복원 은행" 이름, B 는 이 자가 다시 만듦 |
| 복원 중 MODIS 누설(1판 명령의 `fetch-sat.py` 표준 출력 `cover`, `macro.py --gate`) | §0.1 사전 등록 기록이 거짓, 누설 뒤 고른 손잡이 | 복원 기록·노출 등급(§0.1): 장면별·모름이면 그 뒤 비기계적 바꿈 없음, 집계면 꼬리표. 로그는 열지 않음 |
| C4 위성이 oro 동결 전에 들어옴 | oro held·dev 누설 | C4 영상은 oro 동결 뒤에만(P8) |
| 동결 뒤 입력이 사라짐(컨테이너 교체) | 재현 불가, B 가 조용히 바뀜 | `oro-inputs.json` 커밋, manifest 들, 다시 받으면 견줌(P4) |
| 동결 뒤 확장이 동결 파일을 덮거나 새 날짜가 조용히 빠짐 | 판정이 돌지 않음 / n 이 안 늘어 미결 | 확장마다 새 폴더·`--out`·`--tag`, `pre2`·`extN` 이름 분리(§2.3, P7). D15 가 아니오면 확장 없음 |
| 방향·부호 실수(행 남/북, 오는/부는 바람, FFT 부호, fastscape v, 셰이더 θ 부호) | ρ 부호·롤 축이 조용히 뒤집힘 | oro G6 판정 경로 끝-끝, regime G10 — 앱 틀 경로(`getGlobeUv`·틀 균일변수)를 지나고 배선 시험(P9) |
| 짝짓기 뒤 결함 발견 | 결과를 보고 고침 | 그 판정은 무효(미결), 판정 경로 결함은 합격·불합격 쪽을 가리지 않음, 새 날짜로만 다시(P1·q2) |
| 판정 도중 멈춤(lock 은 남고 출력은 없음) | 다시 돌릴 규칙이 없어 즉흥 판단 | 참값을 읽기 전 확인, lock 은 첫 읽기 직전, 출력은 열지 않고 sha256, 환경만 고쳐 한 번 다시(N3) |
| 눈·안개 착시 | 거짓 합격 | 21 일 눈 기억 가림 + G-rev + G-shuf, c4·c5 도 가림 뒤(V2) |
| 검정력 부족(oro 효과 0.05 에서 0.16~0.24, regime P1 ≈ 0.25) | 불합격을 '효과 없음' 으로 오독 | 꼬리표('작음'·'못 가름'), `power-*.json` 동결(m5·O-B3) |
| C4 두 각의 쏠림·계절에 함께 도는 쏠림·산악 풍하파 | P1 거짓 합격 / 거짓 불합격 | 층 안 순열 ∧ 같은 사이트 ROLL 날 시간 이동(simE), 지형 나눔(P1·P2)·결과와 무관한 지형 꼬리표(V6·R-B1) |
| C4 J3 '과장 없음' 이 생성기와 무관하게 떨어짐 | 맞는 C4 가 J3 에서 탈락 | a 내림 + 주 블록 U95(중앙 δ) ≤ ln 1.40(simD), D_λ·D_I 여백에서 기계적 변화를 뺌(V7·N3·R-B2) |
| n < 20 / P1 대상 < 30 | 미결 | 동결 전 개수 확장 규칙(oro·regime), oro 동결 뒤 확장은 조건부 물음 D15 |
| best_match 모델 차(동아시아 JMA: BLH·CAPE 없음, 3 시간 기압면), SHF 부호 불명 | C4 입력 결측·잡음 | 공기 덩이 zi, 대류 대용, ±3 h NA 규칙(p2), R4 매시 탐침 |
| Aqua 2026 공급·드리프트(R8 로 확인: 공급 이어짐, 통과 ≈ 15:10, VIIRS 대체 없음, §0) | C4 참값 공백 | 해결됨. 늦은 통과로 해 고도 < 20° 인 장면은 규칙대로 NONE(RULER-regime §0.1) |
| main 합치기로 하네스 번들이 깨짐 | G1 공회전 또는 재동결 | 동결 전 S1 에서 합치고 묶기 고침, 전후 md5, G1 기준 커밋(P10·q7) |
| 끔 = 바이트 같음이 빈 시험(잡에 `macro` 없음, 새 요청이 옵션과 무관하게 나감) | '바이트 같음' 이 빈말 | G1 잡 `macro: 1`, G1(d) 요청 목록, D6 요청(D14 변수 포함)은 옵션 켜짐에만(P11) |
| 바이트 같음이 깨짐(JSON 키 `0`/`null`, 난수 소비, 셰이더 원문) | 모든 장면이 바뀜 | 옵션이 꺼지면 필드를 붙이지 않음, `JOB_BASE_OPTIONS`, G1·G2 md5 |
| 폰 비용(Hermes ≈ node × 3~10, jitless × 13~37) | 장면 열 때 지연 | F 캐시·입력이 바뀔 때만, D7 재구성은 60 s 에 한 번, 필요하면 64² |
| DEM 비동기 도착으로 하늘이 튐 | 눈에 띄는 변화 | 다음 재구성에 반영, 오프라인이면 끔 경로, G2 도착 경로 |
| C4 전역 늘임 이음매 · CPU 모사 ≠ 셰이더 | 타일 경계 선 · 앱이 안 보이는 것을 판정 | 셰이더 표본 변환 + G5 · G10 |
| §139.4 선례(K0 선호) | 채택 안 될 수 있음 | 받아들임 — 옵션만 남김 |
| 커밋 파일 덮어쓰기(`eval-ringtruth`, `fetch-modis-time`·`macro.py` 기본 출력, `index.json` 덮임) | 기록 오염 | 실행 금지·`--out`·확장은 다른 폴더(P7) |

## 6. 비용 요약
| 항목 | 양 |
|---|---|
| Open-Meteo | R6 ≈ 3,185(썼음) + R4·R5 ≈ 756 + R11 ≈ 750 + R10 ≤ 603 + oro 확장 ≤ 1,000 + SHF 민감도 ≈ 110(선택) |
| GIBS | MODIS 은행 130(받았음) + C4 ≈ 600~1,000(대류 장면·다른 위성·NONE 20 %, 확장 포함) + oro 확장 ≤ 18 |
| CMR | 60 질의(받았음: 10 사이트 × Aqua·Terra × 기간 3, VIIRS 대체 없음) |
| AWS Terrarium | 66 타일(받았음) |
| 디스크 | < 1 GB(C4 원영상 포함) |
| CPU | 판정·부트스트랩·순열·시간 이동·`power-*.json` 모의 수십 분. 하네스 렌더는 A/A·G1·G2·G6·G10·눈용 수십 장 |
| 사람 | 복원 기록(§0.1) 한 번, 조건이 생기면 D15·D16 한 번, 눈 판정 두 번(oro 3 장면, C4 5 + 1 장면) |

## 7. 검토 답 2(계획 몫, 1판 → 2판)
2판의 답을 그대로 둡니다(기록). 한 줄만 고쳤습니다(통계 재검토 m8, 아래 P-B2). 3판에서 바뀐 것은 §8 에 있습니다.

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
  - D3 이유에 "같은 상자 집합" 을 적었습니다. oro 2판은 S∪ = S ∪ S_rev 로 정했습니다(통계 O-B1, 타당성 m1 은 S 판을 민감도로).
  - 달리 한 점: D2 의 "단일 통과 일관성 조항" 은 사용자 결정이라 계획이 고치지 않고 **D12** 로 물었습니다.
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

## 8. 검토 답 3(계획 몫, 2판 재검토 → 3판)
**표시**: §7 과 같습니다. 대상은 `oro/draft2/recheck-{validity,statistics,procedure}.md` 가운데 계획에 닿는 '부분'·'새 차단'·작은 결함입니다. RULER-regime 몫은 그 자 3판 §13, RULER-oro 몫은 oro 3판이 답합니다.

**타당성(recheck-validity)**
- **N1(계획 몫) 해결**: D11~D14 를 받은 결정으로 §4.1 에 적고 §4.2 에서 지웠습니다. D13 '아니오' 의 대체 문구는 쓰이지 않아 지웠습니다.
  - 달리 한 점: 재검토는 D13 질문에 "21 일 눈 기억 가림" 을 더하라고 했습니다. 그 정의 고침은 2판 §4.1 D3 행에 이미 적혀 있었고, D11~D14 는 그 2판 계획을 두고 받은 답입니다. 그래서 새 결정으로 만들지 않고 D3 행에 남깁니다. 조건부 물음(§4.2)을 하게 되면 그 안내에, 아니면 S4 동결 보고에 "D3 의 눈 가림은 21 일 눈 기억" 을 한 줄로 함께 알립니다.
- **m7 해결**: S7 의 oro 가드에 G9 를 넣었습니다.
- **m8 해결**
  - (a) oro 동결 뒤 확장은 D2 보다 넓어 **D15** 로 올렸습니다. oro 3판과 같게 조건부 물음입니다 — 동결 전 확장 뒤에도 c1 이 모자랄 때만 묻습니다(§4.2). oro 3판의 다른 사용자 물음(검정력 갈래)도 **D16** 으로 같은 표에 두었습니다.
  - (b) regime 확장은 2025-06~10 하나입니다(D5 의 6~10 월 안). R8 후보 기간·R10·비용을 고쳤습니다.
- **V6·V7·N3**: RULER-regime 3판 §13. 계획은 §5 행만 바꿨습니다.
- **§4 ⑦(모의 다시)**: S5 ③ 의 `power-regime.json` 에 두 null·P2 층·새 J3 규칙을 넣었습니다.

**통계(recheck-statistics)**
- **N1(계획 몫) 해결**: 위 타당성 N1 과 같습니다. 세 문서의 결정 목록이 D1~D14 받음, 조건부 물음 D15·D16(oro 몫)으로 같습니다.
- **O-B2 남은 것**: D11 '아니오' 대체 글이 oro 와 계획에서 달랐습니다. D11 = 예라 쓰이지 않으므로 계획에서 지웠습니다.
- **P-B2(일부) 해결**: D12·D13 이 받은 결정이 되어 oro 의 합격 규칙과 `power-oro.json` 의 규칙이 하나로 정해집니다(S3).
- **m8 해결**: §7 P-B2 의 "S 로 둘지 S∪S_rev 로 둘지는 oro 2판이 정합니다" 를 "oro 2판은 S∪ = S ∪ S_rev 로 정했습니다" 로 고쳤습니다.
- **R-B1·R-B2·m6·m7**: RULER-regime 3판 §13. 계획은 S5 순서와 §5 행만 바꿨습니다.

**절차(recheck-procedure)**
- **N1 해결**: §1 에 동결 문턱을 두었습니다(oro: D11~D13 받음·복원 등급·조건이 생겼으면 D15·D16, regime: D14 받음·oro 동결). D11~D14 는 받았습니다.
- **N2(계획 몫) 해결**: S3 의 'G6 (a)~(f)' 를 'G6 전부(oro 3판 §7)' 로 바꿨습니다. 시험 이름이 oro 3판에서 더 늘어도 계획이 어긋나지 않게 하려는 것입니다.
- **N3(계획 몫) 해결**: S7 에 두 판정 공통의 읽기 전 확인·lock·멈춤 규칙을 두고, O7 시험 칸에도 적었습니다. 세부는 각 자(regime 3판 §10.3 ④).
- **N4 해결**: §0.1 복원 기록·노출 등급·귀결, §2.4, §5 행. 재검토 고칠 글(계획 P30 끝 문장)을 받고, 더해서 '모름' 등급(기록이 채워지기 전)을 장면별과 같게 둡니다.
- **P7(계획 몫, 부분) 해결**: §2.3 의 동결 뒤 확장에 확장마다 새 폴더·`--out`·`--tag`·탐측 명령과 manifest 목록(`ring-manifest-extN`·`cmr-geom-extN`·`modis-times-extN` 포함)을 두었습니다. 재검토 고칠 글 그대로이고, D15 에 달려 있습니다.
- **P4(계획 몫) 해결**: oro 판정의 `ecmwf_ifs025` 탐측을 R11 로 복원 표에 넣었습니다(oro 3판 §2.5 ④ 와 같은 명령·시각). `fetch-sounding.py` 에 `--models` 인자를 둡니다(R5).
- **P9(계획 몫) 해결**: W2·W4 에 앱 틀 경로와 균일변수 복사, 배선 시험을 적었습니다.
- **q6 해결**: §2.2 순서를 사실대로 고쳤습니다(R2·R6 끝, 남은 것 R4 → R5 → R7, R11·R10 은 다른 시간).
- **q7 해결**: S1·§3.3 에 G1 기준 커밋(측정 도구만 더함, 앱 코드 변경 없음)을 두었습니다.
- **q8(계획 몫) 해결**: S7 oro 가드에 G9, 머리 '자' 의 문구를 "2판은 07e368c 에 커밋" 으로. oro 의 "S2" 이름표는 oro 3판 몫입니다.
- P1·P2·P3·P5·P6·P8·P10·P11: 재검토 '해결'(또는 oro 몫) — 계획은 그대로입니다. N2 의 G6(f) 내용, q1~q5·q9 는 oro·regime 몫입니다.

**3판에서 더 고친 것(검토 밖)**
- §0 의 복원 상태를 사실대로 적었습니다: R2·R6 끝, R1 은 작업 트리(66/66, 커밋 전).
- §2.2 의 한도 셈을 남은 단계로 다시 했습니다(R6 을 쓴 날 ≈ 4,700).
- O6 에 D14 변수와 가중 +1.2 를 적었습니다.
- §3.3 문서 메모에 D13 으로 좁힌 합격 문구를 더했습니다.
- §4.1 표의 '반영한 곳' 을 3판 기준으로 고쳤습니다.

### 동결 준비 점검 답(3판 → 3판 고침 1)
**표시**: 위와 같습니다. 대상은 3판 동결 준비 점검 `oro/draft3/ready-{validity,statistics,procedure}.md`(7db26c0·bb3b3e2) 가운데 계획에 닿는 것입니다. **출처** '점검' = 점검 문서의 고칠 글을 받음, '잰 값' = 복원 기록·결과 파일의 수를 옮김(점검 아님, 규칙 바꿈 없음). 이 고침은 MODIS 값·영상, held 파일, 복원 로그를 열지 않고 썼습니다.

**절차(ready-procedure, '동결 불가: N5·N6')**
- **N6(차단, 계획 몫) 해결** — 출처 '점검'. §0.1 귀결 목록 뒤에 점검의 덧붙임 글 그대로를 넣었습니다: 3판과 그 점검 세 문서의 고칠 글은 등급과 무관하게 한 번 받고, 그 뒤의 바꿈은 귀결을 따릅니다. RULER-oro 3판 §0.1·RULER-regime 고침 1 §0.2 와 같은 뜻입니다.
- **q-c(차단 아님) 해결** — 출처 '점검'. §3 의 O7(`oro.py`)·W4(도구 여덟: `fetch-sat-times.py`·`fetch-texture.py`·`texture.py`·`texture-test.py`·`regime_ref.py`·`regime-test.py`·`render-tile.mjs`·`regime.py`, RULER-regime §10.2) 칸에 "(동결 파일은 S3·S5 에서 완성, 동결 뒤 고치지 않음)" 을 넣었습니다. 그래서 '동결 뒤' 작업 묶음이 동결 파일을 고쳐 확인 2 에 막히는 길이 없습니다.
- **q-d(차단 아님) 해결** — 출처 '점검'. §2.3 동결 뒤 확장의 첫 날 = 앞선 확장(동결 전·pre2)의 마지막 날 + 4 일입니다(RULER-oro §2.7 과 같은 규칙). pre2 가 없으면 11-04 이고, 둘을 함께 해도 같은 날짜를 두 번 받지 않습니다. §4.2 D15 질문 칸의 '11-04 부터' 도 이 규칙으로 고쳤습니다.
- **q-a(차단 아님, regime 몫의 계획 줄)** — 출처 '점검'. R10 에 manifest 이름 `oro/sounding-regime-ext-manifest.json`(`--out` 에서 만듦)을 적어 RULER-regime 고침 1 §2.2·§10.2 와 한 이름으로 맞췄습니다. `fetch-texture.py` 의 `texture-manifest-refetchN.json` 은 RULER-regime §2.3 몫입니다.
- **q-a(차단 아님, oro 몫의 계획 줄)** — 출처 '점검'. §2.3 동결 뒤 확장 탐측 명령에 `--manifest tools/genus-ruler/oro/sounding-manifest-extN.json` 을, §2.2 다시 받기에 `sounding-refetchN.json`·`texture-manifest-refetchN.json` 을 적어 RULER-oro 고침 1 §2.7·§2.9, RULER-regime 고침 1 §2.3 과 한 이름으로 맞췄습니다.
- **N5·q-b**: RULER-oro 몫(G6). 계획은 그대로입니다.

**타당성(ready-validity, '동결 불가: N4')**
- **N4**: RULER-oro 몫(c8 의 L⁻ 층, §4.4·G6(h)). 계획은 그대로입니다.

**통계(ready-statistics, '동결 가능')**
- 새 막는 결함이 없어 고칠 것이 없습니다.

**고침 1 점검(잰 값을 옮긴 뒤 남은 줄)**
- **해결** — 출처 '점검'. 고침 1 을 다시 본 점검의 고칠 글 그대로입니다. 규칙은 바꾸지 않았습니다.
  - 머리 '자'(3판 고침 1 은 작업 트리, 원문 7db26c0)·§2.2 순서(R6·R4·R7 끝, 남은 것 R5 9 곳 → R11)·§3.3(도구 번들의 react-native 는 구조로 확인)·§5 Aqua 행(R8 로 해결)·§6 CMR 행(60 질의, 대체 없음)을 §0·§2.1 의 잰 값과 맞췄습니다.
  - §0.1 '기록' 의 F2·F3 로그 문장을 `oro/restore-log.md` F3 행대로 고쳤습니다(`f3-run.log` 는 `grep -c .`·`grep -i "esbuild\|error"` 만).

**잰 값(점검 밖)** — 출처 '잰 값'(`oro/restore-log.md`·`restore-fingerprints.json`·`probe-r4.json`·`sounding-manifest.json`·`merge-aa.json`·`regime/sat-times.json.gz`·`regime/probe-layers.json`). 규칙은 바꾸지 않았습니다.
- §0: 가지, main 합침(115fbe2)과 묶기 영향, 복원 상태(R1 커밋, R3 F1·F2·R4·R7 F3·R8 60/60·R9 끝, R5 1/10 일일 429, R11 남음), esbuild 0.28.2.
- §0.1: 노출 등급 **없음**(`oro/restore-log.md` '노출 기록'). 그 뒤 S3b 에서 dev 장면 값 하나가 화면에 나와 지금은 **dev 만** 입니다(적기만 함).
- §1 S1(합치기·묶기·A/A 끝, `merge-aa.json`, G1 기준 커밋은 아직)·S2, §2.1 표의 상태 칸과 가중 셈 확인(max(1, V/10)).
