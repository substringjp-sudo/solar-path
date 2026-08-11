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
