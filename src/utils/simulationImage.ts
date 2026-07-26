import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import React from 'react';

/**
 * Visualizer 컴포넌트 View Ref를 react-native-view-shot으로 스냅샷 캡처하여
 * data URI (JPG base64) 문자열로 반환합니다.
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

/**
 * 하위 호환성을 위해 남아있는 wrapper 함수.
 * Visualizer Ref가 존재하면 해당 뷰를 캡처합니다.
 */
export const generateSimulationImage = async (
  _sunAltitude: number,
  _cloudRatio: number,
  _seed: number = 0,
  _prediction?: any
): Promise<string> => {
  // 메인 시뮬레이션 Visualizer 뷰 스냅샷으로 전환되었으므로 경고 없이 반환
  return '';
};

export const saveSimulationImageToCache = async (
  base64DataUri: string,
  filename: string
): Promise<string | null> => {
  if (!base64DataUri || !base64DataUri.startsWith('data:')) return null;
  try {
    const base64 = base64DataUri.split(';base64,')[1];
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

