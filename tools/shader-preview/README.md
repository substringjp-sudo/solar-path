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
