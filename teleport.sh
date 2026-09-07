#!/usr/bin/env bash
# ==============================================================================
# BeforeGlow Instant Teleport & Capture Script
# Usage:
#   ./teleport.sh [preset|lat] [lon] [time] [az] [el] [fov] [date]
#
# Examples:
#   ./teleport.sh daebu
#   ./teleport.sh daebu 18:30 260 0 60
#   ./teleport.sh 37.262579 126.559687 18:30 260 0 60
#   ./teleport.sh jeongdongjin 06:15 85 0 60
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DEV=$(adb devices | grep -v "List" | grep "device$" | head -n 1 | awk '{print $1}')
if [ -z "$TARGET_DEV" ]; then
  DEVICE_IP="192.168.0.228:46055"
  echo "📡 ADB 디바이스 연결 시도: $DEVICE_IP..."
  adb connect "$DEVICE_IP" || true
  sleep 0.5
  TARGET_DEV=$(adb devices | grep -v "List" | grep "device$" | head -n 1 | awk '{print $1}')
fi
ADB_CMD="adb -s $TARGET_DEV"
ARTIFACT_DIR="/Users/yunhyeongseob/.gemini/antigravity-ide/brain/2d5c0e98-81e8-4033-83f9-6997356ab90d"
OUT_FILE="${SCRIPT_DIR}/teleport_result.png"
ARTIFACT_OUT="${ARTIFACT_DIR}/teleport_result.png"

# 2. 파라미터 파싱
ARG1="${1:-daebu}"
TIME="18:30"
AZ="260"
EL="0"
FOV="60"
DATE=""
LAT=""
LON=""
PRESET=""

# 숫자(위도)인지 프리셋 이름인지 판별
if [[ "$ARG1" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
  LAT="$ARG1"
  LON="${2:-126.559687}"
  TIME="${3:-$TIME}"
  AZ="${4:-$AZ}"
  EL="${5:-$EL}"
  FOV="${6:-$FOV}"
  DATE="${7:-}"
else
  PRESET="$ARG1"
  TIME="${2:-$TIME}"
  AZ="${3:-$AZ}"
  EL="${4:-$EL}"
  FOV="${5:-$FOV}"
  DATE="${6:-}"
fi

# 3. 딥링크 URI 구성
if [ -n "$PRESET" ]; then
  URI="beforeglow://teleport?preset=${PRESET}&time=${TIME}&az=${AZ}&el=${EL}&fov=${FOV}"
else
  URI="beforeglow://teleport?lat=${LAT}&lon=${LON}&time=${TIME}&az=${AZ}&el=${EL}&fov=${FOV}"
fi

if [ -n "$DATE" ]; then
  URI="${URI}&date=${DATE}"
fi

echo "🚀 [Teleport] 워프 전송: $URI"

# 4. 앱으로 인텐트 발송 (앱이 백그라운드이거나 포그라운드일 때 모두 즉시 워프)
$ADB_CMD shell am start -W -a android.intent.action.VIEW -d "\"$URI\"" > /dev/null

# 5. 지형/날씨 데이터 패칭 및 Three.js 씬 렌더링 안정화 대기
WAIT_SEC=4.5
echo "⏳ [Render] 지형/날씨/3D 씬 렌더링 대기 (${WAIT_SEC}s)..."
sleep "$WAIT_SEC"

# 6. 스크린샷 캡처 및 저장
echo "📸 [Capture] 화면 캡처 중..."
$ADB_CMD exec-out screencap -p > "$OUT_FILE"

if [ -d "$ARTIFACT_DIR" ]; then
  cp "$OUT_FILE" "$ARTIFACT_OUT"
fi

FILE_SIZE=$(wc -c < "$OUT_FILE" | tr -d ' ')
echo "✅ [Done] 캡처 완료 ($FILE_SIZE bytes)"
echo "🖼️  프로젝트 경로: $OUT_FILE"
if [ -d "$ARTIFACT_DIR" ]; then
  echo "🖼️  아티팩트 경로: $ARTIFACT_OUT"
fi
