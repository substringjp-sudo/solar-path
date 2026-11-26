# 하네스 · 판정 — 기기 없이 재고 확인하는 법

한 줄: 판정 스크립트(`verify-*.js`)로 식 · 셰이더 글자를 검사하고, volsky 하네스로 앱과 같은 볼륨 장면을 헤드리스 크롬에서 그린다. 갱신: 2026-11-26

## 도구
| 도구 | 하는 일 | 쓰는 법 |
|---|---|---|
| `tools/shader-preview/verify-*.js`(약 200개) | 순수 함수 수치 · 셰이더 패치 글자 · 장면 연결을 검사. 브라우저 불필요한 것이 많음 | `node tools/shader-preview/verify-cloud-light.js` |
| volsky 하네스 `tools/genus-ruler/volsky/` | 앱의 `volumetricScene` 을 SwiftShader 크롬으로 그림 | `bash build.sh` 후 `node run.js jobs.json outDir W H` |
| `tools/genus-ruler/*/RULER-*.md` | 동결한 자(지표 · 문턱). 렌더 보고 문턱 바꾸지 않음 | 회차별 문서 |
| `tools/web-repro/` | 앱 SkyScene3D 를 웹으로 띄워 QR 장면 재현(§112) | |
| `tools/photo-ref/`, `tools/qr-report/`, `tools/weather-truth/` | 사진 대조 · QR 해독 · 예보 참값 | |

## volsky 잡(job) 필드
`input`(lat · lon · date · az · el · fov · layers[{genus, cover, baseKm, band, thicknessM, opts}]), `options`(volumetricScene 옵션 — physics · cloudLight · edgeRough · debugDensityMul …),
`material`(셰이더 균일변수 덮어쓰기, 예 genusSkyPhys · genusSunMaxM), `clouds`(CloudsEffect 속성 · `clouds.X` 재질 매개변수), `fill`(skyLightScale · groundBounceScale), `tone`(0 = LINEAR), `frames`, `res`, `quality`(앱 기본 low), `exposureScale`.
결과: `name.png`, `name.alpha.png`, `results.json`(physics: tauCore · tauRendered 등).
앱 기본에 맞추려면 options 를 SkyScene3D.tsx 의 `vol.setOptions({...})` 와 같게(accurateSunBelowDeg 91 · macro 1 · physics true …).

## 함정(실제로 밟은 것)
- **기본 환경은 맥북 실제 GPU**(2026-11-26 사용자 결정): `run-desktop.js`(Chrome, ANGLE Metal). 폰과 같은 `MAX_TEXTURE_IMAGE_UNITS`=16 이라 텍스처 초과가 그대로 재현되고, 장면당 약 2 초(컨테이너는 분 단위). 컨테이너 SwiftShader 는 한도가 커서 #174 문제를 가렸으니 보조로만. 필요: `npm install --no-save playwright`(맥북은 `NODE_PATH=/tmp/pwtool/node_modules`), 기기 장면 `jobs-device-1611.json`. 환경변수 `GPU=swiftshader` · `HEADFUL=1` · `BROWSER=chromium` · `NO_BUILD=1`.
- **SwiftShader 시간(ms)은 믿을 수 없음** — 그리기를 건너뜀. 성능은 정적 텍스처 읽기 수로 어림하고 기기에서 잴 것.
- **`load` 인자 = 3파장 대기 표** → 박명이 자주색. 앱은 15파장 — 쓰지 말 것.
- **알파는 takram 끝내기 문턱에서 잘림**(낮은 품질 투과율 ~1 %) → τ 를 재려면 `debugDensityMul` 로 밀도를 낮춰 선형 구간에서.
- **디버그 색 채널 포화**: 노출(해 고도 25°에서 ~7)을 곱하면 1 을 넘어 잘림 → tone 0 + 작은 배율.
- 프레임이 적으면 화소 알갱이가 많아 가장자리 판단이 어려움 → 확대 비교는 frames 64 · res 1.
- **takram 시간 업스케일은 표본을 평균하지 않음**(화소마다 마지막 표본 1 개) — PR #171 전에는 프레임을 늘려도 알갱이가 그대로(16 · 32 · 64 프레임 잡음 지표 13.1 같음). #171 부터 `cloudAccum`(기본 0.25)으로 누적.
- 기기와 하네스 차이: 기기는 예보 고리 · METAR · 두께로 층을 정함 — 하네스는 손으로 넣은 층. 같은 입력을 쓰려면 구름 모양 화면 값(종류 · 운량 · 높이)과 상태 줄 두께 · τ 를 옮길 것.
- 백그라운드 실행은 `( ... &)` 대신 도구의 백그라운드 실행을 쓸 것(조용히 죽은 적 있음).

## 판정 묶음(구름 쪽)
`verify-cloud-light.js`(26: 빛 · 걸음 · 단위 · 보정), `verify-cloud-edge.js`(16), `verify-cloud-cells.js`(17). 미리 실패하던 것: `verify-tsun-*`(충돌), `verify-cirrus-fast`(2개) — main 에서도 같음.

## 출처
`docs/SKY_REBUILD_PLAN.md §2 · §9 · §10 · §15 · §17 · §28 · §112 · §124 · §137 · §138 · §169 · §180`, `tools/genus-ruler/README.md`, `docs/SANDBOX_MODE_PLAN.md §25`.
