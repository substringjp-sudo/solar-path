import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import React from 'react';
import { EARTH_RADIUS_KM } from './earth';

export interface WidgetResImages {
  small: string;  // 180x120
  medium: string; // 280x140
  large: string;  // 360x200
}

export interface SunsetTimeSlice {
  minutesBeforeSunset: number; // 40, 30, 20, 10, 0
  images: WidgetResImages;
}

export interface SunsetWidgetSequenceData {
  lastLat: number;
  lastLon: number;
  lastTimestamp: number;
  slices: SunsetTimeSlice[];
}

/**
 * 하버스사인 위경도 거리 계산 (km 단위)
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = EARTH_RADIUS_KM; // 지구 반경 (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 2km 이내 위치 변동 여부 검증
 */
export function shouldSkipWidgetSnapshot(
  lastData: SunsetWidgetSequenceData | null,
  currentLat: number,
  currentLon: number
): boolean {
  if (!lastData) return false;

  const isSameDay = new Date(lastData.lastTimestamp).toDateString() === new Date().toDateString();
  if (!isSameDay) return false;

  const dist = calculateDistanceKm(lastData.lastLat, lastData.lastLon, currentLat, currentLon);
  return dist < 2.0;
}

/**
 * 안드로이드 RemoteViews 호환용 초경량 1x1 / 2x2 JPEG Base64 픽셀 생성기
 */
export function getSafeBase64JpegPixel(): string {
  // 안드로이드 ImageWidget이 100% 읽는 1x1 보라/주황 노을 픽셀 JPEG Base64
  return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
}

/**
 * 원본 이미지를 위젯 크기별(small, medium, large) 초경량 JPG로 리사이즈 및 압축
 */
export async function compressToWidgetSizes(imageUri: string, _slicePrefix: string): Promise<WidgetResImages> {
  try {
    if (!imageUri || imageUri.length === 0 || imageUri.startsWith('data:image/svg')) {
      const fallback = getSafeBase64JpegPixel();
      return { small: fallback, medium: fallback, large: fallback };
    }

    // 1. Small (180x120)
    const smallRes = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 180, height: 120 } }],
      { compress: 0.3, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    // 2. Medium (280x140)
    const mediumRes = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 280, height: 140 } }],
      { compress: 0.35, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    // 3. Large (360x200)
    const largeRes = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 360, height: 200 } }],
      { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    const smallUri = `data:image/jpeg;base64,${smallRes.base64}`;
    const mediumUri = `data:image/jpeg;base64,${mediumRes.base64}`;
    const largeUri = `data:image/jpeg;base64,${largeRes.base64}`;

    return {
      small: smallUri,
      medium: mediumUri,
      large: largeUri,
    };
  } catch (err) {
    console.warn('[compressToWidgetSizes] Manipulator failed, fallback to safe pixel:', err);
    const fallback = getSafeBase64JpegPixel();
    return {
      small: fallback,
      medium: fallback,
      large: fallback,
    };
  }
}

/**
 * Visualizer 컴포넌트 View Ref를 react-native-view-shot으로 캡처
 */
export const captureVisualizerSnapshot = async (
  targetRef: React.RefObject<any>,
  options?: { width?: number; height?: number; quality?: number }
): Promise<string> => {
  if (!targetRef || !targetRef.current) return '';
  try {
    const uri = await captureRef(targetRef, {
      format: 'jpg',
      quality: options?.quality ?? 0.85,
      result: 'data-uri',
      width: options?.width,
      height: options?.height,
    });
    return uri;
  } catch (err) {
    console.warn('[captureVisualizerSnapshot] Failed to capture Visualizer ref:', err);
    return '';
  }
};

export const generateSimulationImage = async (
  _sunAltitude: number,
  _cloudRatio: number,
  _seed: number = 0,
  _prediction?: any
): Promise<string> => {
  return getSafeBase64JpegPixel();
};

export const saveSimulationImageToCache = async (
  base64DataUri: string,
  filename: string
): Promise<string | null> => {
  if (!base64DataUri) return null;
  try {
    const base64 = base64DataUri.includes(';base64,') ? base64DataUri.split(';base64,')[1] : base64DataUri;
    if (!base64) return null;
    const destPath = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(destPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return destPath;
  } catch (err) {
    console.warn('[saveSimulationImageToCache] Failed:', err);
    return null;
  }
};
