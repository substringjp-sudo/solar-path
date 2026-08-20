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

```bash
# 1) atmosphere.ts를 CommonJS로 트랜스파일 (GLSL 문자열을 Node에서 읽기 위해)
npx tsc src/utils/atmosphere.ts --outDir /tmp/atmbuild --module commonjs \
  --target es2020 --moduleResolution node --skipLibCheck --resolveJsonModule \
  --esModuleInterop --allowSyntheticDefaultImports

# 2) 미리보기 HTML 생성
node tools/shader-preview/build-preview.js

# 3) 정적 서버 (file://는 ES 모듈 CORS에 막힙니다)
cp node_modules/three/build/three.module.js <preview-dir>/
cd <preview-dir> && python3 -m http.server 8123

# 4) 헤드리스 Chromium으로 스크린샷
node tools/shader-preview/shoot.js
```

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
