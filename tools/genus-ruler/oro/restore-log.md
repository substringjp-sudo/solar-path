# 대기 1회차 자료 복원 기록(계획 §2)

복원이 며칠에 걸치므로 날짜별로 적습니다. 위성 운량 값·held 영상·F2/F3 로그는 열지 않았습니다. 수만 적습니다.

## 2026-11-04
| 단계 | 결과 | 파일 |
|---|---|---|
| R1 DEM | 66/66 타일, 실패 0. z6 9 곳, hamburg z5. 타일마다 sha256·ETag·version-id | `dem-manifest.json`, `fetch-dem.py` |
| R2 MODIS 은행 | 121 장면(+ 거른 9) | `.harness/macro/sat`(커밋 안 함) |
| R3 지문 F1·F2 | F1 이름 121/121(빠짐·더함 0, index 오류 0). F2 사분위 수치 잎 767/767 같음 | `restore-fingerprints.json`, `oro-fingerprint.py` |
| R4 탐침 | 서울 best_match 에 BLH·SHF·CAPE·T850 있음(24/24). ecmwf_ifs025 는 BLH·SHF 없음, icon_seamless 는 BLH 없음. best_match 의 T850·Z700·700 hPa 바람 00~05Z 매시 유한. 가중 1.6(16 변수×모델)·1.0 | `probe-r4.json`, `probe-sounding.py` |
| R5 탐측 | **1/10**(busan, 가중 76.5). denver 요청이 먼저 SSL 끊김, 다시 보내자 일일 429(공유 IP). 나머지 9 곳은 2026-11-05 00:00 UTC 리셋 뒤 사이트 단위로 이어 받음 | `sounding-manifest.json`(부분), `fetch-sounding.py` |
| R6 실제 NWP 고리 | 10/10(blend·lm) | `ring/nwp/blend/*`(커밋 안 함) |
| R7 지문 F3 | T 를 쓰지 않는 다섯 열이 held 97/97 장면에서 같음(esbuild 0.28.2) | `restore-fingerprints.json` |
| R8 CMR 시각 | 60/60 질의(10 사이트 × Aqua·Terra × 기간 3). held DAY 사이트-날 수(달별) Aqua 2026 239~248, Terra 228~247 → VIIRS 대체 안 함 | `regime/sat-times.json.gz`, `regime/fetch-sat-times.py` |
| R9 레이어 탐침 | Aqua·Terra TrueColor 둘 다 200 image/png(64 px, 서울 2026-06-15). 영상은 디코드·저장하지 않음 | `regime/probe-layers.json`, `regime/probe-layers.py` |

- **위성 통과 시각 표류**(CMR 메타만, 지방 평균 태양시 사분위)
  - Aqua: 2025 14.40 h(13.90~14.85) → 2026 봄 14.93 h → 2026 여름·가을 **15.17 h(14.67~15.63)**.
  - Terra: 2025 9.60 h → 2026 봄 9.25 h → 2026 여름·가을 **9.02 h(8.57~9.52)**.
  - RULER-regime 의 "~13:30(Aqua)·~09:40(Terra)" 은 2026 자료에 맞지 않습니다. 통과 시각 탐측 보간은 CMR 시각을 그대로 쓰므로 판정 식은 바뀌지 않지만, 오후 경계층 무너짐과 노을 작동 비율 설명은 이 시각으로 고쳐 적어야 합니다.
- **main 합치기(S1)**: origin/main(98affae·a8a4f61)을 합쳤습니다(115fbe2). 하네스 묶기는 `volsky/build.sh`(react-native·expo-file-system 대체, PNG 빈 모듈). 합치기 전 두 번·후 두 번 B0_app·P0_seoul 의 rgb·alpha md5 가 모두 같습니다(`merge-aa.json`, 묶음 md5 는 다름: 대체 모듈과 main 코드).
  - `tools/shader-preview/stage-esm.js` 는 tsc 출력의 맨 지정자 가운데 three·suncalc·date-fns 만 바꿉니다. 합친 뒤 `utils/demTileCache.js` 에 `from 'react-native'`·`require(...)` 가 그대로 남아, `demTiles.js` 를 부르는 미리보기 도구(약 34 개 `build-*.js`)는 브라우저에서 모듈을 못 풉니다(구조로 확인, 브라우저 실행은 안 함). 오로·레짐 판정 도구는 이 둘을 부르지 않으므로 고치지 않고 적어 둡니다.
  - 예전 esbuild 명령(대체 모듈 없음)으로 `volsky/entry.ts`·`tsun/entry-tsun.ts`·`tsun/entry-gpuwin.ts` 를 묶으면 합친 뒤 셋 다 실패합니다(확인함). 그래서 동결된 grain 의 `eval-grain.sh` 와 tsun 의 `run-tsun.sh`·`gpu-window.sh` 는 지금 그대로는 돌지 않습니다. 둘 다 닫힌 캠페인이라 고치지 않습니다. 다시 돌릴 때는 같은 대체 인자를 붙입니다.

## 노출 기록(RULER-oro 3판 §0.1·§0.5, 계획 3판 §0.1)
대화 기록(세션 jsonl)에서 복원 명령과 화면에 나온 출력을 다시 확인해 적습니다.

| 단계 | 명령(요지) | 화면에 나온 것 | 위성 값 노출 |
|---|---|---|---|
| R2 | `fetch-sat.py .harness/macro/sat --sites all > scratchpad/restore/r2-sat.log 2>&1`(2026-11-04T00:53Z, 백그라운드) | `R2 exit 0`, `ls … \| wc -l` = 122(장면 121 + index) | 없음. `r2-sat.log`(장면마다 `cover` 가 찍힘)는 열지 않음 |
| R6 | `fetch-nwp-ring.py --tag blend > r6-nwp-stdout.log 2> r6-nwp-stderr.log`(같은 명령 줄) | `R6 exit 0`, 121, stderr 에서 `HTTP\|ERR\|한도\|403` 줄 5 개(JSON 끊김·SSL EOF·연결 재설정, 모두 NWP 받기 오류) | 없음(NWP 고리만) |
| F1 | `oro-fingerprint.py --f1` | 파일·키·공통 수, index 의 skip 참 9·error 참 0 | 없음(수만; skip 9 는 130 − 121 로 이미 알려진 수) |
| F2 | `oro-fingerprint.py --f2`(macro.py 표준 출력은 `.harness/oro/f2.log`) | 수치 잎 767/767 같음 | 없음. `f2.log` 는 열지 않음 |
| F3 | `oro-fingerprint.py --f3`(downscale 출력은 `.harness/oro/f3-run.log`) | 97/97 같음, 열별 수 | 없음. `f3-run.log` 는 `grep -c .`(줄 수 121)와 `grep -i "esbuild\|error"`(맞는 줄 없음, 아무것도 안 나옴)만 함 |
| R4·R5 | Open-Meteo 관측점 요청 | 상태·가중·null 수 | 해당 없음(위성 아님) |
| R8 | CMR MYD03·MOD03 | 질의별 granule 수, 달별 DAY 날 수, 통과 시각 사분위 | 해당 없음(시각·폴리곤·주야 깃발만) |
| R9 | GIBS 64 px 두 장 | 상태·형식·바이트 수 | 없음(디코드·저장 안 함) |

- **노출 등급(2026-11-04 복원 단계): 없음**(dev·held 모두). `index.json` 은 항목 수(130)와 skip·error 참 개수만 읽었습니다.
- **추가 기록(2026-11-04 S3b, dev 만)**: G1 기준 도구를 만들던 에이전트가 탐색 중 `macro/jobs-macro.json`(RULER-macro §9 하네스 잡, 서울 2026-09-05 "위성 고리")에서 **dev 장면 층 운량 값 하나(0.43)** 를 화면에 찍었다고 스스로 밝혔습니다. 그 고리는 MODIS 에서 왔을 수 있습니다. held 값·장면 JSON·은행 PNG·금지 파일은 열지 않았다고 적었습니다.
  - 그래서 등급은 **dev 만** 입니다. RULER-oro 3판 §0.1 대로 dev 만 나온 기록은 적기만 합니다(dev 는 손잡이에 쓰지 않음). held 판정·규칙 바꿈에는 영향이 없습니다.
- 자 초안 작성·재검토·점검 워크플로 에이전트는 각 문서의 '안 본 것' 에 `.harness`·로그를 열지 않았다고 적었습니다.
