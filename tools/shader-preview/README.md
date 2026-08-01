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
