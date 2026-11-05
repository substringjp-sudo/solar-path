#!/bin/bash
# 볼륨 하늘 하네스 묶기(main 합친 뒤의 표준 명령).
#
#   bash tools/genus-ruler/volsky/build.sh [outfile=.harness/volsky/app.js] [더 붙일 esbuild 인자…]
#
# main 의 98affae 부터 demTiles.ts 가 demTileCache.ts 를 top-level 에서 부릅니다. 그 파일은
# react-native·expo-file-system/legacy·PNG require 를 쓰므로, 예전 명령(run.js 머리말)으로는 묶기가 실패합니다.
# 여기서는 두 패키지를 stubs/ 의 대체 모듈로 바꾸고 PNG 는 빈 모듈로 둡니다.
#   - react-native 대체는 Platform.OS = 'web' 이라 getDemTileUri 가 demTileUrl 을 그대로 돌려줍니다(앱의 웹 경로와 같음).
#   - 하네스 잡은 DEM 을 받지 않으므로 그림은 합치기 전과 같아야 합니다(합치기 전후 B0_app·P0_seoul md5 로 확인).
# esbuild 판은 0.28.2 로 고정합니다(lockfile 에 없음).
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=${1:-.harness/volsky/app.js}
shift || true
STUB=./tools/genus-ruler/volsky/stubs
exec npx --yes esbuild@0.28.2 tools/genus-ruler/volsky/entry.ts --bundle --format=esm --outfile="$OUT" \
  --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"' \
  --alias:react-native=$STUB/react-native.js --alias:expo-file-system=$STUB/expo-file-system \
  --loader:.png=empty "$@"
