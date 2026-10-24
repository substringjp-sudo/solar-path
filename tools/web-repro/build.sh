#!/bin/sh
# 앱 SkyScene3D 를 웹 번들로 묶어 .harness/web-repro 에 둡니다. package.json 의 main 을 잠깐 바꿨다 되돌립니다.
set -e
cd "$(dirname "$0")/../.."
cp package.json .harness/package.json.bak
node -e "const p=require('./package.json');p.main='tools/web-repro/index.js';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
trap 'cp .harness/package.json.bak package.json' EXIT
npx expo export --platform web --output-dir .harness/web-repro
mkdir -p .harness/web-repro/assets && cp node_modules/@takram/three-atmosphere/assets/*.bin .harness/web-repro/assets/
B=$(ls .harness/web-repro/_expo/static/js/web/ | head -1)
cat > .harness/web-repro/repro.html <<HTML
<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head>
<body><div id="root"></div><script type="module" src="/_expo/static/js/web/$B"></script></body></html>
HTML
echo "repro: .harness/web-repro/repro.html"
