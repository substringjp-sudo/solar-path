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
