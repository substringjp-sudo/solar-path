/**
 * simulationImage.ts — 위젯이 쓰는 기본 그림(1×1 JPEG) 하나만 남겼습니다.
 *
 * 예전에는 여기에 노을 시뮬레이션 그림을 만들어 알림 · 위젯에 붙이는 함수들(generateSimulationImage ·
 * saveSimulationImageToCache · compressToWidgetSizes)이 있었는데, 그림을 만드는 함수가 1×1 픽셀을 돌려주는 빈 껍데기라
 * 앱을 켤 때마다 예보 찾기 · 노을 예측 · 파일 쓰기 · 이미지 리사이즈 세 번이 **결과 없이** 돌았습니다(2026-11-23 지움).
 */

/**
 * 안드로이드 RemoteViews 호환용 초경량 1x1 / 2x2 JPEG Base64 픽셀 생성기
 */
export function getSafeBase64JpegPixel(): string {
  // 안드로이드 ImageWidget이 100% 읽는 1x1 보라/주황 노을 픽셀 JPEG Base64
  return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
}
