#!/bin/sh
# Mp4FrameEncoder.java 를 안드로이드 프레임워크 jar 에 대해 컴파일만 해 봅니다(실행은 못 함 — 실기기에서만 돎).
# jar 는 Maven Central 의 org.robolectric:android-all(안드로이드 14 프레임워크 전체)입니다. 저장소에 넣지 않고 /tmp 에 받습니다.
set -e
JAR="${ANDROID_ALL_JAR:-/tmp/android-all-14.jar}"
if [ ! -s "$JAR" ]; then
  echo "downloading android-all (137 MB)..."
  curl -sSf -m 600 -o "$JAR" https://repo1.maven.org/maven2/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar
fi
OUT="$(mktemp -d)"
SRC="$(dirname "$0")/../../modules/mp4-encoder/android/src/main/java/com/pplaner/mp4encoder"
# 프레임워크 jar 자체의 주석 경고(UnsupportedAppUsage)와 JVM 안내는 걸러서, 우리 코드의 경고 · 오류만 남깁니다.
LOG="$(javac -Xlint:all -source 8 -target 8 -cp "$JAR" -d "$OUT" "$SRC"/*.java 2>&1 || true)"
echo "$LOG" | grep -v "JAVA_TOOL_OPTIONS\|UnsupportedAppUsage\|bootstrap class path\|source value 8\|target value 8\|To suppress warnings\|^[0-9]* warnings\?$" || true
if [ -f "$OUT/com/pplaner/mp4encoder/Mp4FrameEncoder.class" ]; then echo "COMPILE OK"; else echo "COMPILE FAILED"; rm -rf "$OUT"; exit 1; fi
rm -rf "$OUT"
