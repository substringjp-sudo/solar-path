# 셰이더 미리보기 하네스

3D 하늘 셰이더를 **실제로 렌더해서 눈으로 보기 위한** 개발 도구입니다.

## 왜 필요한가

이 저장소의 웹 번들은 Zustand에 포함된 Redux DevTools 코드의 `import.meta`
때문에 파싱되지 않습니다. 앱 전체를 띄울 수 없으니 셰이더를 볼 방법이 없었고,
그 상태로 작업하면 "물리는 맞는데 예쁜지는 아무도 모르는" 코드가 쌓입니다.

이 하네스는 앱을 우회해 셰이더만 떼어냅니다.
`Skydome.ts` / `SunMesh.ts` / `CloudField.ts`에서 GLSL 문자열을 **소스 그대로**
추출하므로, 여기서 보이는 것이 앱에서 보이는 것과 같습니다.
셰이더를 다시 옮겨 적지 않는 것이 핵심입니다 — 그러면 미리보기가 거짓말을 합니다.

## 사용법

### 전체 한 번에

```bash
npm run verify:sky                 # 준비 → 미리보기 생성 → 서버 → 판정 23종
npm run verify:sky -- genus rain   # 이름에 이 문자열이 든 판정만
npm run verify:sky -- --no-build   # 미리보기 재생성 없이 판정만 (빠름)
```

판정마다 **한 줄**(통과 개수)만 찍고, 실패한 것만 자세히 펼칩니다. 종료
코드는 실패한 판정 수라 훅·CI에 그대로 물릴 수 있습니다.

⚠ **셰이더를 고친 뒤에는 스테이징을 다시 해야 합니다.** 안 그러면 미리보기가
옛 코드를 그리고, "고쳤는데 화면이 그대로"를 한참 들여다보게 됩니다.
`run-all.js`는 `--no-build` 여도 스테이징만은 **항상** 돌리므로 이 함정을
피합니다. 아래처럼 손으로 이어 붙일 때는 직접 챙기세요.

### 손으로 (한 가지만 볼 때)

```bash
# 1) /tmp 산출물과 브라우저용 ESM 준비 — 판정 스크립트들이 이걸 require 합니다
node tools/shader-preview/stage-node.js
node tools/shader-preview/stage-esm.js

# 2) 미리보기 HTML 생성
node tools/shader-preview/build-preview.js

# 3) 정적 서버 (file://는 ES 모듈 CORS에 막힙니다)
cd "$(node -p "require('./tools/shader-preview/paths').PREVIEW")" && python3 -m http.server 8123

# 4) 헤드리스 Chromium으로 스크린샷
node tools/shader-preview/shoot.js
```

산출물이 어디로 가는지는 `tools/shader-preview/paths.js` 한 곳에서 정합니다
(기본 `.harness/`, `SKY_PREVIEW_DIR`로 바꿀 수 있음). 예전에는 24개 스크립트가
**그것을 처음 적은 세션의 UUID**를 각자 문자열로 박아 두고 있었습니다.

헤드리스 Chromium은 SwiftShader로 WebGL을 지원합니다
(`--use-gl=swiftshader --enable-unsafe-swiftshader`).

## 확인되는 것

- **셰이더 컴파일 여부** — GLSL ES 1.0은 선언 후 사용이 강제됩니다.
  공유 청크에 함수를 추가할 때 순서를 어기면 여기서 바로 잡힙니다.
- **여러 태양 고도에서의 실제 색** — 물리 검증만으로는 알 수 없는 부분입니다.

## 밤하늘 미리보기 (별 · 은하수 · 궤적 리본)

```bash
node tools/shader-preview/stage-esm.js            # SkyScene3D 모듈을 브라우저용 ESM으로 준비
node tools/shader-preview/build-night-preview.js  # 넓은 화각 4컷
node tools/shader-preview/build-night-preview.js --close  # 좁은 화각 4컷 (별 색·크기 판단용)
# preview 디렉터리에서 python3 -m http.server 8123 을 띄운 뒤 shoot 스크립트로 촬영
```

`build-preview.js`가 셰이더 문자열만 소스에서 뽑아 쓰는 데 반해, 밤하늘 쪽은
`stage-esm.js`가 **StarField / MilkyWayBand / CelestialPathMesh 모듈 자체를**
tsc로 ESM 변환해 브라우저에 넣습니다. import 경로만 vendor/상대경로로 고치고
로직은 건드리지 않으므로, 미리보기에서 도는 지오메트리 생성·좌표 변환·행성
계산이 앱과 완전히 같은 코드입니다.

`vendor/date-fns.js`는 `addHours`/`startOfDay`만 담은 최소 shim입니다 —
동작은 date-fns와 같지만, 미리보기 외의 용도로 쓰지 마세요.

## 강화 구름 격자 A/B (`grid.html`)

```bash
node tools/shader-preview/verify-cloud-grid.js     # 어댑터 수치 검증 (23개)
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-grid-preview.js    # 2×2 A/B
node tools/shader-preview/shoot.js grid.html grid-preview.png
```

`verify-cloud-grid.js`는 `/tmp/skybuild` 의 CommonJS 산출물을 씁니다:

```bash
npx tsc --module commonjs --target es2020 --moduleResolution node --skipLibCheck \
  --resolveJsonModule --outDir /tmp/skybuild \
  src/utils/skyColumn.ts src/utils/atmosphere.ts \
  src/utils/cloudGrid.ts src/utils/cloudGridAdapter.ts
```

(리포에는 이 작업과 무관한 기존 타입 오류가 있어 tsc가 0으로 끝나지 않습니다.
tsc는 오류가 있어도 emit하므로 산출물은 정상입니다. 프로젝트 tsconfig 기준
`npx tsc --noEmit`은 통과합니다.)

**같은 "진짜 하늘"을 두 관측 밀도로 본 결과를 나란히 렌더합니다** — 왼쪽이
기본 팬(5레이 × 7고리), 오른쪽이 강화 격자(7레이 × 10고리). 진짜 하늘에는
기본 팬의 고리 간격(30→70km)보다 촘촘한 구조와 ±20° 밖의 구조를 일부러
심어 뒀습니다. 어댑터가 일을 하면 오른쪽에만 그 구조가 나타납니다.

`window.__stats` 에 층·거리대·방위대별 운량이 들어 있어, 화면에서 본 것과
수치를 대조할 수 있습니다. 결과 해석은 `docs/IA_REDESIGN.md` §8.

## 박명 곡선 A/B (`twilight.html`)

```bash
node tools/shader-preview/verify-twilight.js      # 곡선 모양 검증 (26개)
node tools/shader-preview/build-twilight-preview.js
node tools/shader-preview/shoot.js twilight.html twilight-preview.png
```

태양 고도 +2°~-12°를 8컷으로 훑어 **해가 진 뒤 얼마나 빨리 어두워지는지**를
눈으로 봅니다. 수치만으로는 판단할 수 없는 부분입니다 — 톤매핑과 눈 순응
(`ADAPT_*`)이 표시 단계에서 밝기를 다시 주무르므로, 선형 복사휘도가 절반이 돼도
화면은 거의 안 바뀔 수 있고 그 반대도 됩니다.

`build-twilight-preview.js`는 **수정 전 `atmosphere.ts`로도 돌아갑니다**
(`earthShadowLit`이 없으면 0으로 두고 화면 밝기만 비교). 그래서 이런 A/B가 됩니다:

```bash
git show origin/main:src/utils/atmosphere.ts > /tmp/old.ts
# atmosphere.ts를 교체해가며 각각 렌더 → 화면 밝기를 직접 비교
```

배경과 측정 결과는 `docs/TWILIGHT.md`.

## 사전 계산 타임라인 (`verify-timeline.js`)

```bash
npx tsc --module commonjs --target es2020 --moduleResolution node --skipLibCheck \
  --resolveJsonModule --esModuleInterop --allowSyntheticDefaultImports \
  --outDir /tmp/tlbuild src/utils/skyTimeline.ts
ln -sfn /home/user/solar-path/node_modules /tmp/node_modules   # suncalc 해결용
node tools/shader-preview/verify-timeline.js
```

네트워크를 타지 않도록 `fetchDayWeatherRing`을 합성 링으로 교체한 뒤 돌립니다.
핵심 검사는 **키프레임 시각에서 사전 계산 결과가 직접 계산과 정확히 일치하는가**
입니다 — 여기가 어긋나면 "빠르지만 다른 하늘"이 됩니다.
배경은 `docs/SKY_TIMELINE.md`.

## ⚠ 셰이더 상수를 uniform으로 바꿀 때

`ATMOSPHERE_GLSL`의 표시·감광·박명 상수는 개발자 튜닝을 위해 **uniform**입니다
(`src/utils/skyTuning.ts`). 여기 빌더들은 앱과 달리 머티리얼을 손으로 만들기
때문에, uniform을 안 넘기면 **GL 기본값 0**이 되어 셰이더가 조용히 죽습니다 —
에러 없이 하늘만 밋밋한 회색이 됩니다. 이 세션에서 두 번 겪었습니다.

그래서 모든 빌더가 `TUNE_UNIFORMS`를 심고 모든 `ShaderMaterial`에 펼쳐 넣습니다:

```js
const TUNE_UNIFORMS=${JSON.stringify(A.makeTuningUniforms())};
...
new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS, /* 나머지 */}})
```

새 uniform을 추가하면 `makeTuningUniforms`에만 넣으면 자동으로 따라옵니다.
확인법: 흐린날 8컷의 화면 밝기가 218.1 / 200.2 / 172.9 / 107.2 근처인가.

## 오존 τ 유도 (`derive-ozone-tau.js`)

```bash
node tools/shader-preview/derive-ozone-tau.js
```

`atmosphere.ts`의 `OZONE_TAU`가 어디서 나왔는지 재현합니다. O3 Chappuis
흡수단면적을 CIE 등색함수 × D65 × sRGB 변환에 걸어 **채널 유효 τ**를 적분합니다.

렌더가 아니라 순수 계산이므로 서버도 크로미움도 필요 없습니다.
`OZONE_TAU`를 손대려면 여기부터 보세요 — 그 값은 눈으로 맞춘 아트 상수가
아니라 유도된 물리량입니다. 배경은 `docs/TWILIGHT.md` §5.

## 구름 각크기 측정 (`measure-cloud-scale.js`)

```bash
node tools/shader-preview/measure-cloud-scale.js
```

구름의 **색이 아니라 공간 주파수**를 잽니다. `CloudDeck.ts`의 FRAG에서
상수를 **소스로부터 읽어** fbm/holeCut 식을 JS로 재현하고, 두 가지를 냅니다:

1. **조각 각크기** — 고도 45° 원을 따라 알파가 0↔1을 넘나드는 주기
2. **통과 면적비** — 운량 대비 실제로 덮은 하늘 면적

렌더가 아니라 순수 계산이라 서버도 크로미움도 필요 없습니다.
상수를 하드코딩하지 않으므로 셰이더를 고치면 측정도 따라옵니다.

기준값(2026-08, 개선 전):

| 지표 | 값 | 목표 |
|---|---|---|
| 조각 각크기 (운량 0.39) | 42.4° | 1~3° |
| 통과 면적비 오차 | -25.2%p | ±2%p |

배경과 설계는 `docs/CLOUD_TEXTURE_PLAN.md`.

## 셀 필드 (1단계) — `verify-cell-field.js` · `verify-cell-gl.js`

```bash
npx tsc --module commonjs --target es2020 --moduleResolution node \
  --skipLibCheck --outDir /tmp/cellbuild src/utils/cloudCellField.ts
node tools/shader-preview/verify-cell-field.js     # 순수 TS (10개)
node tools/shader-preview/build-cell-preview.js    # 무늬를 눈으로
node tools/shader-preview/shoot.js cell.html cell-preview.png

node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-cell-gl-preview.js
node tools/shader-preview/verify-cell-gl.js        # GL 경로 (11개)
```

**두 개가 따로 있는 이유가 핵심입니다.** `verify-cell-field.js`는 JS 배열의
면적비를 봅니다. 그런데 1단계의 주장은 "축소해도 운량이 유지된다"이고, 그건
GPU가 우리 밉 체인을 실제로 쓸 때만 참입니다. 실제로 GL 쪽 검사가 JS 검사가
전부 통과한 상태에서 **-11.29%p** 오차를 잡아냈습니다 — 삼선형 필터가 업로드
이후에 분포를 다시 좁히기 때문입니다.

⚠ **수축률(`MIP_SHRINK_*`)을 다시 맞출 때는 반드시 `cell_sample`(두 번 뽑기)
경로로 재세요.** 한 번 뽑기로 재서 맞추면 운량 0.85 꼬리에서 어긋납니다.
측정 경로와 출하 경로가 같아야 합니다.

확인법: 실사용 축소 범위(텍셀/픽셀 ≤ 12)에서 오차가 1%p 아래인가.

## 덱 각크기 (2단계) — `verify-deck-scale.js`

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-deck-scale-preview.js
node tools/shader-preview/verify-deck-scale.js          # 8개
node tools/shader-preview/shoot.js deck-scale.html deck-scale.png
```

`CloudDeck.ts`를 **그대로 임포트해** 씬을 만들고 렌더된 픽셀에서 잽니다.
셰이더 식을 옮겨 적지 않는 것이 핵심입니다 — 그러면 측정이 거짓말을 합니다.

⚠ **반투명 층을 색 문턱으로 재지 마세요.** 가장자리 반투명 픽셀과 그늘진
구름이 섞여 운량이 과소 계상됩니다(처음에 0.39가 0.25로 나왔습니다).
검정·흰 두 배경으로 두 번 그려 알파를 분리합니다:
`a = 1 - (over_white - over_black)`.

⚠ **운량은 입체각으로 가중하세요.** 픽셀 가중이면 카메라를 천정 쪽에 오래
둔 스윕이 천정을 과대 반영합니다. 고도대 [lo,hi]의 몫은 `sin(hi) - sin(lo)`.

`measure-cloud-scale.js`는 이제 **2단계 이전 덱의 재현**입니다(상수 고정).
개선 전후를 같은 정의로 나란히 두려고 남겨 뒀습니다 — 지금 덱은 여기서
재세요.

| 지표 (운량 0.39, 고적운) | 개선 전 | 2단계 후 |
|---|---|---|
| 조각 각크기 | 5.87° | 1.63~2.97° |
| 주기 | 42.4° | 4.8~7.5° |
| 운량 오차 (고도 10° 이상) | -25.2%p | -1.05%p |

## 덱 방향별 조명 (3단계) — `verify-deck-ambient.js`

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-deck-ambient-preview.js
node tools/shader-preview/verify-deck-ambient.js        # 7개
node tools/shader-preview/shoot.js deck-ambient.html deck-ambient.png
```

층당 uniform 하나였던 덱 조명을 방향별 정점 속성으로 바꾼 것을 확인합니다.
JS 콜백만 부르면 정점 속성 배선(aAmbientUp → vAmbientUp)이 실제로
맞물렸는지 알 수 없으므로, 태양 고도 6°·mid층 운량 0.97에서 카메라를
태양 방위와 그 반대 방위로 돌려 **렌더된 화면 평균색**을 비교합니다.

기준값: 태양 쪽 R/B 1.133, 반대쪽 R/B 0.948 (비율 1.195). 예전(방향 무관
uniform)이었다면 1.000이었을 값입니다.

## 빌보드 운형 제한 (5단계) — `verify-billboard-genus.js`

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-overcast-preview.js
node tools/shader-preview/verify-billboard-genus.js      # 8개
```

새 미리보기 없이 `build-overcast-preview.js`가 이미 남기는
`window.__stats[].genera`(그 장면에서 실제로 배치된 빌보드 운형 집합)를
읽습니다. 흐림 8/8과 권층운 장면에서 빌보드가 0장인지, 그 외 장면의
운형이 전부 Cumulus/Cumulonimbus뿐인지 확인합니다.

## 준비 — `stage-node.js` / `stage-esm.js`

```bash
node tools/shader-preview/stage-node.js   # /tmp/{atm,cell,sky,tl}build + suncalc 링크
node tools/shader-preview/stage-esm.js    # 브라우저용 ESM + vendor
```

검사 스크립트가 `/tmp`의 CommonJS 산출물을 require합니다. 예전에는 그
명령이 이 문서 세 군데에만 적혀 있어서, /tmp가 비워지면(컨테이너 재시작,
디스크 정리, `npm install`) 하네스 11종이 전부
`Cannot find module '/tmp/…'`로 죽는데 무엇을 다시 돌려야 하는지 알기
어려웠습니다. 이제 위 두 줄이면 됩니다.

`three`는 `node_modules`에서 가져옵니다 — 앱이 실제로 쓰는 버전과 같아야
하고, 미리 받아둔 사본에 기대면 사본이 사라졌을 때 브라우저에서만 404가 나
"__stats가 없습니다"라는 엉뚱한 증상으로 나타납니다.

## 지역별 예보 보존 — `verify-region-cover.js`

```bash
node tools/shader-preview/stage-node.js
node tools/shader-preview/verify-region-cover.js       # 11개
```

운량장에 **서로 잡아당기는 두 가지**를 동시에 요구합니다: (1) 각 지역의
예보값이 그 지역의 평균으로 나올 것, (2) 한 지역 안에도 파란 구멍과 짙은
덩어리가 있을 것. 2를 세게 하면 1이 깨집니다.

실제로 깨진 적이 있습니다 — 층 평균 하나로 U자를 만들고 예보 차이를 더한 뒤
[0,1]로 자르면 **클램프가 지역 평균을 파괴**해 예보 5%인 지역이 화면에서
**26%** 로 나왔습니다. `verify-overcast`의 운량 보존 검사는 **하늘 전체
평균**만 보므로 이걸 못 잡습니다 — 한쪽이 부풀고 다른 쪽이 눌리면 전체
평균은 멀쩡하니까요. 그래서 이 검사가 따로 있습니다.

기준값: 지역 구간별 최대 오차 3.2%p, 하늘 전체 0.16%p, 흐린 지역 − 맑은
지역 0.826, 균일 입력에서 표준편차 0.226 / 맑음 4.3% / 꽉참 4.9%.

⚠ 구조 쪽 문턱을 올리고 싶으면 **세 지표를 함께** 보세요. 노이즈를 잘게
하면 구조는 늘지만 타임라인 5분 키프레임 사이에 무늬가 뒤바뀌어 구름이
명멸합니다(`verify-timeline`이 잡습니다). 경계표는 파일 안 주석에.

## 문법 검사 — `check-syntax.js`

```bash
node tools/shader-preview/check-syntax.js
```

빌더는 `.js` 라 `tsc --noEmit` 이 안 봅니다. 그런데 GLSL을 백틱 템플릿에
담고 있어서, 그 안 주석에 백틱을 하나 쓰면 문자열이 거기서 끊겨
`SyntaxError: Unexpected identifier` 가 납니다. 오류 메시지가 원인과 멀어
매번 한참 헤맵니다 — 이 세션에서만 세 번 겪었습니다. `node --check` 는
그걸 정확히, 오탐 없이 잡습니다.

## 바다와 윤슬 — `verify-water.js`

```bash
node tools/shader-preview/build-water-preview.js
node tools/shader-preview/shoot.js water.html water.png
node tools/shader-preview/verify-water.js              # 10개
```

서쪽 절반이 바다인 관측점에서 태양 쪽과 **반대쪽**을 둘 다 찍습니다.
물은 알베도가 0.06이라 반대쪽에서 육지보다 어둡고, 스치는 각에서는 프레넬로
하늘을 비춰 태양 쪽에서 밝습니다 — **그 대비가 물의 전부**라 한쪽만 보면
"물을 그냥 밝게 칠했다"와 구분이 안 됩니다.

기준값: 육지 70.3 / 태양 쪽 124.5 / 반대쪽 50.2. 윤슬 폭 2m/s 4.9° →
8m/s 11.2°.

⚠ **봉우리 높이로 판정하지 마세요.** 선형에서는 약풍이 더 뾰족해야 하지만
화면에서는 반대로 나옵니다 (ACES가 좁고 밝은 봉우리를 더 압축). 자기 바닥
에서 고정 높이만큼 올라온 **폭**만 톤 곡선에 안 휘둘립니다.

## 지평선 아래 (땅) — `verify-horizon.js`

```bash
node tools/shader-preview/build-horizon-preview.js
node tools/shader-preview/shoot.js horizon.html horizon.png
node tools/shader-preview/verify-horizon.js            # 9개
```

앱과 **같은 모듈**(`Skydome.ts`, `TerrainRing.ts`)을 임포트해 같은 순서로
씬에 넣고, 요소를 하나씩 빼가며 지평선을 가로지르는 세로줄을 읽습니다.

⚠ **renderOrder 숫자를 읽어 검산하면 이런 건 안 잡힙니다.** 지면 원반은
매 프레임 색까지 갱신되면서 **한 픽셀도 화면에 안 나오고** 있었습니다
(빼도 최대 픽셀차 **1**/255). 지면이 먼저 깊이 없이 그려지고, 스카이돔이
`depthTest: false`로 전체 구를 칠하며 덮었기 때문입니다. 씬에서 **빼 보고
화면이 바뀌는지**를 봐야 합니다.

기준값: 지면 원반을 빼면 최대 픽셀차 175, 지평선 아래 휘도가 위의 36%,
채도 4%(하늘이었을 때 47%).

배경과 설계는 `docs/GROUND_PLAN.md`.

## 한 화면 안의 좌우 대비 — `verify-one-screen.js`

```bash
node tools/shader-preview/build-one-screen-preview.js
node tools/shader-preview/shoot.js one-screen.html one-screen.png
node tools/shader-preview/verify-one-screen.js         # 11개
```

`verify-region-cover.js`가 보장하는 것은 **360° 하늘 전체**의 지역 보존입니다
— "동쪽을 보면 흐리고 서쪽을 보면 맑다". 그건 **한 프레임 안에서** 좌우가
갈린다는 뜻이 아닙니다. 화각 60° 안에는 기상 링의 방위가 2~3개밖에 안
들어오니까요(링이 30° 간격). 그래서 렌더된 한 프레임의 픽셀에서 따로 잽니다.

기준값 (서쪽 0% / 동쪽 95% 경계를 정면으로):

| 구간 | 왼쪽 | 오른쪽 | 차이 |
|---|---|---|---|
| 전체 | 9.1% | 54.0% | **45.0%p** |
| 천정 쪽 | 18.1% | 61.3% | 43.2%p |
| 지평선 쪽 | 1.8% | 35.5% | 33.7%p |

균일 48% 대조군은 전체 −5.8%p. 대조군이 없으면 좌우 차이가 기상 때문인지
노이즈 때문인지 구분할 수 없습니다.

## 조각 입체 음영 — `verify-cell-relief.js`

```bash
node tools/shader-preview/build-cell-relief-preview.js
node tools/shader-preview/shoot.js cell-relief.html cell-relief.png
node tools/shader-preview/verify-cell-relief.js          # 11개
```

조각마다 밝은 면과 그늘 면이 생기는지 봅니다. 세기를 끄고 켤 손잡이가
없으므로 **차등 검사**입니다: 입체감이 `0.30 + 0.55 × (태양이 낮을수록 1)`로
스케일되므로 같은 장면을 태양 5°와 70°로 찍어 구름 픽셀 안의 국소(7×7)
밝기 표준편차 비를 봅니다.

대조군은 층운(`cellStrength = 0`, WMO 정의상 요소가 없는 구름)입니다.
이게 없으면 "태양을 낮췄더니 대비가 커졌다"가 입체감 때문인지 그냥
노을빛 때문인지 구분할 수 없습니다.

기준값: 고적운 ×2.61, 층운 ×0.85.

⚠ 불투명 문턱을 0.85로 두면 **층운이 한 점도 안 잡힙니다** — 조각이 없어
알파가 운량 그대로(0.62)라 문턱을 못 넘습니다. 그러면 대조군 비가 0/0이
되어 비교가 거저 통과합니다. 문턱을 0.50으로 낮추고, 대조군에도 표본이
있는지 따로 단언합니다.

## 권운 결 방향 (6단계) — `verify-cirrus-aniso.js`

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-cirrus-aniso-preview.js
node tools/shader-preview/shoot.js cirrus-aniso.html cirrus-aniso.png
node tools/shader-preview/verify-cirrus-aniso.js         # 11개
```

카메라·운량·층을 고정한 채 `windBearingDeg`만 0°/90°로 바꿔 두 번 렌더하고,
알파장의 방향별 기울기 에너지 비(Gx/Gy)가 뒤집히는지 봅니다. 화면 세로축이
원근 단축을 크게 먹지만 그 편향은 두 컷에 똑같이 걸리므로 **비의 비**에서
상쇄됩니다 — 투영을 따로 보정하지 않아도 되는 이유입니다.

권적운(등방, `cellAspect = 1`)을 같은 방식으로 찍어 대조군으로 씁니다.
이게 없으면 "바람을 돌렸더니 뭔가 달라졌다"가 이방성 때문인지 그냥 다른
무늬가 걸린 것인지 구분할 수 없습니다.

기준값: 권운 ×7.7, 권적운 ×1.04.

**수치만 보면 안 되는 사례입니다.** `cellAspect = 20`(낙하줄 하나의 물리
비율)일 때 이 검사는 ×55로 더 화려하게 통과했지만, 그림은 필라멘트가
아니라 끊기지 않는 블라인드였습니다. 배율이 모든 옥타브에 한꺼번에 걸려
큰 덩어리까지 20배로 늘어난 탓입니다. 그래서 `프리셋 종횡비` 단언에
**위쪽 한계**가 있습니다 — 자세한 것은 docs/CLOUD_TEXTURE_PLAN.md §15.

## 층별 바람 — `verify-wind-data.js` · `verify-wind-drift.js`

```bash
node tools/shader-preview/stage-node.js
node tools/shader-preview/verify-wind-data.js            # 27개 (네트워크 불필요)

node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-wind-drift.js
node tools/shader-preview/shoot.js wind-drift.html wind-drift.png
node tools/shader-preview/verify-wind-drift.js           # 20개
```

두 개로 나뉜 이유는 **틀리는 자리가 두 곳**이고 서로 화면이 다르기
때문입니다.

`verify-wind-data.js` 는 픽셀을 안 봅니다. `global.fetch` 를 캔드 응답으로
바꿔치기하고 `fetchLayerWinds` 를 실제로 돌린 뒤, 그 성분을 `CloudData`
모양으로 옮겨 `layerWindsFrom` 으로 되돌립니다. 속도·방위가 원래 값으로
돌아오면 왕복이 맞는 것입니다. 350°/10° 이음매를 일부러 넣습니다 — 성분이
아니라 각도로 보간하면 여기서 반대로 돕니다. 요청을 실패시켜 `null` 이
돌아오고 `resolveLayerWinds` 가 `measured: false` 로 강등되는지도 봅니다.

`verify-wind-drift.js` 는 픽셀만 봅니다. 이 구간의 오류는 **조용합니다** —
uniform 이 0으로 남거나 부호가 뒤집혀도 구름은 여전히 그럴듯하게 흐릅니다.
그래서 네 가지를 잽니다:

1. 무풍 + 1시간 → 평균 휘도차가 **정확히 0**
2. `uWindLow/Mid/High` 교차 누출 0 (층별로 구운 운량장 3종 × 바람 3종)
3. 이동량 ∝ 풍속 — 10/20/40 km/h 에서 21.5 / 43.4 / 88.2 px (×2.02, ×4.11)
4. 방향 — 북쪽을 보고 서풍(270°)이면 화면 **오른쪽**(동)으로

⚠ 운량장을 **균일하게(0.5)** 굽습니다. 슬랩은 이류를 잔무늬 좌표에만 걸고
운량장은 그대로 두므로(이중 계산 방지), 운량장에 무늬가 있으면 그림이 강체
평행이동이 아니게 되어 SSD 최소점이 흐려집니다. 균일하게 두면 보이는
구조가 전부 잔무늬라 정확히 평행이동합니다.

⚠ 이동량은 **중앙 가로띠**(±40행)에서만 잽니다. 세로로 벗어날수록 그
방향의 지상 거리가 달라져 같은 바람이라도 픽셀 이동량이 달라집니다.
좁은 화각(30°)과 좁은 띠로 그 편차를 ~3.5%로 눌렀고, 비례 판정의 허용
오차(±12%)가 그 위에 얹혀 있습니다.

## 달빛 → 한계등급 — `verify-moonlight.js`

```bash
node tools/shader-preview/verify-moonlight.js       # 8개 (렌더 불필요)
```

`src/utils/moonlight.ts` 를 즉석에서 tsc로 CommonJS 빌드해 바로
`require` 합니다 — 픽셀도 예보 자료도 필요 없는 순수 계산이라 별도
스테이징이 없습니다. 경계(지평선 아래 손실 0, 삭은 항상 0), 크기
(보름달 중천 3~4등급 손실, 낮은 고도일수록 작음, opposition surge로
반달이 절반보다 밝음), 합성(광공해 바닥 아래로 이중 차감하지 않음)을
잽니다.

## 실기기 조건 — `verify-device-repro.js`

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-device-repro.js
node tools/shader-preview/shoot.js device-repro.html device-repro.png 25
node tools/shader-preview/verify-device-repro.js       # 11개
```

**이 판정이 생긴 이유가 이 하네스 전체에서 가장 중요한 교훈입니다.**

실기기 화면이 "기괴하다"는 보고를 받았을 때 `verify-cloud-slab.js` 는
8/8 통과 중이었습니다. 거짓 통과가 아니라 **재는 곳이 달랐습니다**:

| | 하네스가 재던 곳 | 실기기가 도는 곳 |
|---|---|---|
| 화각 | 62° | **60~120°** |
| 시선 고도 | 14° (천정 안 봄) | 25~35° → **천정이 화면 안** |
| 태양 고도 | +8 ~ −3° | **−42°, −36°, +25°** |
| 이류 | 0 ~ 0.03시간 | **0~24시간** |

네 축 모두 하네스가 한 번도 안 밟은 영역이고, 결함은 전부 거기 있었습니다.
그래서 이 습작의 입력은 지어낸 값이 아니라 **화면 QR 에서 디코드한
실측값**입니다 (`tools/qr-report/decode-report.js`). 캡처가 오면 그 QR 을
디코드해 여기 `SHOTS` 에 넣으면, 그 화면이 그대로 하네스에서 재현됩니다.

단언은 세 가지입니다:

1. **한밤중이 밤처럼 보이는가** — 광공해 0 이면 R/B < 0.55 (밤하늘은
   파랗습니다), 도시광을 최대로 켜도 R/B < 1.10. 예전 값은 **1.59** 였고
   그것이 태양 −42° 에서 하늘이 금색이던 이유입니다.
2. **한밤중이 대낮만큼 밝지 않은가** — 평균 휘도 < 130. 예전에는 밤 124~184,
   낮 145 로 사실상 같았습니다.
3. **인공 무늬가 서지 않는가** — 격자성 < 1.06.

### 곁딸린 진단 습작 (판정 없음)

- `build-zenith-diag.js` — 천정 방사 무늬의 출처를 가릅니다. 잔무늬를 끄는
  방법이 요령입니다: `heightPx` 를 일부러 3 으로 넘기면 화소 각크기가 커져
  셰이더가 스스로 잔무늬를 평균으로 녹입니다(det→0). 셰이더를 고치지 않고
  분리됩니다. 측정 결과 운량장을 완전히 균일하게 해도 방사성이 0.19 → 0.13
  으로 30%만 줄어, 원인이 운량 텍스처가 아니라 슬랩 잔무늬임이 갈렸습니다.
- `build-slab-ab.js` — PR #14 슬랩과 현재 슬랩을 **같은 페이지에서 같은
  입력으로** 나란히 그립니다. `src/components/SkyScene3D/CloudSlabPrev.ts`
  가 그때 사본이고, 앱은 임포트하지 않습니다. 이 비교가 "PR #14 은 밤에
  아무것도 안 그린다(휘도 0)"를 드러냈고, 되돌리기가 답이 아님을 정했습니다.

## 노을 대비 — `verify-sunset-gap.js`

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-sunset-gap.js
node tools/shader-preview/shoot.js sunset-gap.html sunset-gap.png 40
node tools/shader-preview/verify-sunset-gap.js       # 11개
```

`verify-cloud-slab.js` 의 **채도만으로는 이 그림이 안 지켜집니다.** 실제로
채도가 8/8 통과하는 동안 명암폭이 124 → 28 로 4.4배 무너졌고, 그게
"지평선쪽만 빛나고, 구름 틈으로 하늘이 보이고, 반대편에 그림자가 지는"
세 가지가 사라진 정체였습니다. 셋 다 대비 현상이라 평균에 안 잡힙니다.

지표 셋:

- **세로기울기** = 천정 밝기 ÷ 지평선 바로 위 밝기. 작을수록 지평선만 탑니다.
- **명암폭** = 하늘 화소 휘도의 p90 - p10.
- **색상변화** = 색상각의 **원형** 표준편차. 색상각은 360°에서 이어지므로
  산술 표준편차를 쓰면 빨강 부근이 0°와 359°로 갈려 거짓으로 커집니다.

기준선은 PR #14 슬랩(`CloudSlabPrev.ts`)을 같은 페이지에 같이 그려 둔
값입니다 — 절대 숫자가 아니라 **그 그림과의 거리**로 봅니다.

⚠ **볼륨 스텝 수는 두 지표를 반대로 움직입니다.** 3스텝이 명암폭은 12%
높지만(95.8 → 107.8) 세로기울기를 0.667 → 0.846 으로 크게 망칩니다. 앱은
1스텝을 씁니다 — 사용자가 첫 번째로 꼽은 "지평선쪽만 빛나면서"를 직접
재는 것이 세로기울기이기 때문입니다. 이 습작의 판정도 명암폭이 아니라
세로기울기로 씁니다.

⚠ `readPixels` 는 **아래가 y=0** 입니다. 이 습작의 첫 판에서 "하늘"이라고
쓴 영역이 지면을 포함하고 상단 하늘을 빼는 바람에 세로기울기가 거꾸로
나왔습니다. 새 지표를 만들 때는 **먼저 뒤집힌 값이 나오는지** 확인하는 게
싸게 먹힙니다.

## 전천후 격자 — `build-allsky-matrix.js` (진단, 판정 없음)

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-allsky-matrix.js
node tools/shader-preview/shoot.js allsky-matrix.html allsky.png 55
```

날씨 3 × 방향 3 × 시각 4 = 36칸. 그림은 부분운 12칸만, 수치는 36칸 전부
`window.__stats` 에 있습니다.

**이 습작이 생긴 이유**: 노을 대비를 되찾으려고 체적 스텝을 3 → 1 로
바꿨더니 `vertShadow` 가 0.5 → 1.0 이 되어 밤 구름이 두 배 밝아졌고,
`verify-device-repro` 의 한밤중 단언 둘이 깨졌습니다. 한 장면만 보고
값을 정하면 반드시 다른 장면이 깨집니다.

첫 실행에서 바로 셋이 나왔습니다:

- **천정 12칸이 초점 나간 얼룩** — 격자성은 1.03 으로 정상이라 기존 지표가
  전혀 못 잡았습니다. 위를 보면 지상거리가 0 으로 수렴해 노이즈 좌표가 한
  점에 모입니다. ⚠ 옥타브를 더 켜는 것으로는 안 됩니다 (진폭이 절반씩
  줄어 8옥타브째 기여가 0.4%) — 셀보다 훨씬 잔 규모의 **독립 항**이
  필요합니다.
- **채도 부스트가 어두운 장면의 색을 날림** — `mix(l, cc, k>1)` 는 외삽이라
  휘도보다 낮은 채널이 음수로 밀립니다. R/B 가 27만까지 튑니다.
- **흐린 날 노을에 화면이 검음** — 구름을 한참 팠는데 슬랩 덮임이 0.093
  이었습니다. 9%만 그리는데 화면이 검으면 검은 것은 하늘돔입니다.

수치를 볼 때 주의: 이 격자는 `cover()` 를 **하늘돔을 끄고 검은 배경에
슬랩만** 그려서 잽니다. 검은 구름은 덮임 0 으로 나오므로, 덮임이 낮은데
휘도도 낮으면 "구름이 없다"가 아니라 "구름이 검다"일 수 있습니다.

## 앱 그림 vs 하네스 그림 — `verify-app-vs-harness.js`

```bash
node tools/shader-preview/stage-esm.js
node tools/shader-preview/build-app-vs-harness.js
node tools/shader-preview/shoot.js app-vs-harness.html app-vs-harness.png 90
node tools/shader-preview/verify-app-vs-harness.js      # 30개
```

**하네스는 원해상도로 곧장 그리고, 앱은 그렇지 않습니다.** 앱은 하늘·구름을
저해상도 버퍼에 그린 뒤 확대하며 블룸·박명광선·디더를 얹습니다. 그동안
모든 튜닝을 하네스 그림 위에서 했으므로, 그 차이를 재서 못으로 박습니다.

측정 결과 갈리는 것은 **선명도 하나뿐**이었습니다 — 색·휘도·채도는 배율과
후처리에 관계없이 소수점까지 같습니다:

| | 세부 (하네스 대비) | 렌더 비용 |
|---|---|---|
| 배율 2 · 이중선형 | 65~68% | 0.35배 |
| 배율 2 · Catmull-Rom (현행) | 75~80% | 0.35배 |
| 배율 1.5 | 84~87% | 0.53배 |
| 배율 1 | 98~100% | 0.97배 |

⚠ **이 표의 숫자를 단언에 박지 마세요.** 셰이더의 주파수 성분이 바뀌면
같이 움직입니다 — 경사 광로(19절)를 넣자 태양 -3° 칸이 78% → 75% 로
내려갔고, 그건 회귀가 아닙니다. 그래서 이 습작은 배율 2를 **두 번** 찍어
카트멀롬과 이중선형을 같은 프레임에서 견줍니다(합성기의
`setReconstruct('bilinear')`). 지켜야 하는 것은 "재구성 필터가 아직
카트멀롬인가" 하나이고, 그 이득은 어느 고도에서나 **+13~14%** 로 안정적입니다.

⚠ 이 시간은 **swiftshader(CPU 래스터라이저)** 값입니다. 실기기 GPU 의 절대
시간이 아니라 **배율 사이의 상대비**로만 읽으세요.

⚠ 이 습작은 배율마다 6번씩 다시 그려 시간을 재므로 **다른 것보다 느립니다**
(90초쯤). `shoot.js` 대기 시간을 넉넉히 주세요.

전환 직후 프레임도 함께 봅니다 — 앱은 프레임 시간을 보고 배율을 실시간으로
바꾸므로(적응 해상도), 렌더 타깃을 다시 만드는 그 프레임이 검게 나오면
화면이 깜빡입니다.
