#!/usr/bin/env bash
set -e

echo "🧹 빌드 및 임시 파일 정리 시작..."

# 1. Android 빌드 산출물 및 Gradle 캐시 정리
if [ -d "./android" ]; then
  echo "📱 Android 빌드 캐시 및 산출물 삭제 중..."
  rm -rf ./android/app/build
  rm -rf ./android/build
  rm -rf ./android/.gradle
  echo "  - android/app/build, android/build, android/.gradle 삭제 완료"
fi

# 2. Expo 및 Metro 캐시 정리
if [ -d "./.expo" ]; then
  echo "📦 Expo 캐시(.expo) 삭제 중..."
  rm -rf ./.expo
  echo "  - .expo 삭제 완료"
fi

# 3. 배포/번들 산출물 디렉토리(dist) 정리
if [ -d "./dist" ]; then
  echo "📁 dist 디렉토리 삭제 중..."
  rm -rf ./dist
  echo "  - dist 삭제 완료"
fi

# 4. 루트 디렉토리의 APK / AAB 파일 정리
echo "🗑️ 생성된 APK/AAB 패키지 파일 정리 중..."
find . -maxdepth 1 -name "*.apk" -type f -delete 2>/dev/null || true
find . -maxdepth 1 -name "*.aab" -type f -delete 2>/dev/null || true

# 5. 임시 로그 파일 정리
find . -maxdepth 1 -name "*logcat*.txt" -type f -delete 2>/dev/null || true

echo ""
echo "✨ 모든 빌드 산출물과 임시 파일이 깨끗하게 정리되었습니다!"
exit 0
