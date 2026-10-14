#!/usr/bin/env bash
# run-phys3.sh — jobs-phys3.json 을 그립니다. 출력 폴더에 이미 .png·.alpha.png 가 둘 다 있는 잡은 건너뛰어(컨테이너가 재시작돼도) 이어 그립니다.
#   bash tools/genus-ruler/flow/run-phys3.sh <출력 폴더> [jobs.json]
# 번들은 먼저 묶을 것: npx esbuild tools/genus-ruler/volsky/entry.ts --bundle --format=esm --outfile=.harness/volsky/app.js --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"'
set -euo pipefail
OUT=$1
H=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$H/../../.." && pwd)
JOBS=${2:-$H/jobs-phys3.json}
mkdir -p "$OUT"
RESUME="$OUT/jobs-resume.json"
node -e "
const fs=require('fs');const jobs=JSON.parse(fs.readFileSync('$JOBS'));
const ok=n=>fs.existsSync('$OUT/'+n+'.png')&&fs.existsSync('$OUT/'+n+'.alpha.png');
const rest=jobs.filter(j=>!ok(j.name));
fs.writeFileSync('$RESUME',JSON.stringify(rest));
console.log('jobs',jobs.length,'done',jobs.length-rest.length,'to render',rest.length);
if(!rest.length) process.exit(3);"  || { [ $? -eq 3 ] && echo "모두 그려져 있음" && exit 0; exit 1; }
cd "$ROOT"
node tools/genus-ruler/volsky/run.js "$RESUME" "$OUT" 390 584 gen
