/**
 * modules/astro-camera/index.ts
 *
 * Android Camera2 기반 수동 장노출(RAW_SENSOR / YUV) 및 네이티브 float 누적기 TypeScript 브리지.
 * 네이티브 빌드가 포함되지 않은 환경(Web · 미빌드 개발 클라이언트)에서는 안전하게 unavailable을 반환합니다.
 */
import { requireOptionalNativeModule } from 'expo';

export interface AstroCameraCapabilities {
  available: boolean;
  cameraId: string;
  hardwareLevel: number;
  rawSupported: boolean;
  manualSensorSupported: boolean;
  minExposureMs: number;
  maxExposureMs: number;
  minIso: number;
  maxIso: number;
  focalLengthMm: number;
  focal35mm: number;
  hfovDeg: number;
  minZoomRatio?: number;
  maxZoomRatio?: number;
  sensorOrientation: number;
  supportsFocusDistance: boolean;
  rawWidth: number;
  rawHeight: number;
  yuvWidth: number;
  yuvHeight: number;
}

export interface AstroSessionInfo {
  cameraId: string;
  format: 'raw16' | 'yuv';
  streamWidth: number;
  streamHeight: number;
  outputWidth: number;
  outputHeight: number;
  focal35mm: number;
  hfovDeg: number;
  sensorOrientation: number;
}

export interface AstroSubFrame {
  frameId: number;
  framePath: string;
  format: 'raw16' | 'yuv';
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  thumbLuma: Uint8Array;
  exposureMs: number;
  iso: number;
  startTimeMs: number;
  endTimeMs: number;
  midTimeMs: number;
}

export interface AstroStackFinalizeResult {
  uri: string;
  width: number;
  height: number;
  acceptedFrames: number;
  estimatedSkyFloor: number;
}

export interface RearLensInfo {
  cameraId: string;
  logicalCameraId?: string;
  physicalCameraId?: string;
  focalLengthMm: number;
  focal35mm: number;
  hfovDeg: number;
  zoomRatio?: number;
  minZoomRatio?: number;
  maxZoomRatio?: number;
}

interface AstroCameraNative {
  getRearLensesAsync(): Promise<RearLensInfo[]>;
  getCapabilitiesAsync(facing?: string, cameraId?: string): Promise<AstroCameraCapabilities>;
  startSessionAsync(opts: {
    facing?: 'back' | 'front';
    cameraId?: string;
    preferRaw?: boolean;
    maxLongEdge?: number;
  }): Promise<AstroSessionInfo>;
  captureSubFrameAsync(opts: {
    exposureMs?: number;
    iso?: number;
    focusDistance?: number;
    lockFocusInfinity?: boolean;
    deviceRotationDeg?: number;
    wbGains?: [number, number, number];
    zoomRatio?: number;
  }): Promise<AstroSubFrame>;
  stopSessionAsync(): Promise<void>;
  beginStackAsync(opts: { width: number; height: number }): Promise<{ width: number; height: number }>;
  addStackFrameAsync(opts: {
    framePath: string;
    weight: number;
    homographyUv0ToK: number[];
    skyLimitNormY?: number[];
    keepFixedGround?: boolean;
  }): Promise<{ added: boolean; acceptedFrames: number }>;
  finalizeStackAsync(opts: {
    format?: 'png' | 'jpeg';
    stretchGain?: number;
    asinhStrength?: number;
    subtractBlackPercentile?: number;
    jpegQuality?: number;
  }): Promise<AstroStackFinalizeResult>;
  renderStackPreviewAsync(opts: {
    maxLongEdge?: number;
    stretchGain?: number;
    asinhStrength?: number;
    subtractBlackPercentile?: number;
    jpegQuality?: number;
    monochromeRed?: boolean;
  }): Promise<AstroStackFinalizeResult | null>;
}

const NativeAstroCamera = requireOptionalNativeModule<AstroCameraNative>('AstroCamera');

const UNAVAILABLE_CAPS: AstroCameraCapabilities = {
  available: false,
  cameraId: '',
  hardwareLevel: -1,
  rawSupported: false,
  manualSensorSupported: false,
  minExposureMs: 0,
  maxExposureMs: 0,
  minIso: 100,
  maxIso: 3200,
  focalLengthMm: 0,
  focal35mm: 24,
  hfovDeg: 65,
  minZoomRatio: 1,
  maxZoomRatio: 5,
  sensorOrientation: 90,
  supportsFocusDistance: false,
  rawWidth: 0,
  rawHeight: 0,
  yuvWidth: 0,
  yuvHeight: 0,
};

export function isAstroCameraAvailable(): boolean {
  return NativeAstroCamera !== null;
}

export async function getRearLensesAsync(): Promise<RearLensInfo[]> {
  if (!NativeAstroCamera?.getRearLensesAsync) return [];
  try {
    return await NativeAstroCamera.getRearLensesAsync();
  } catch {
    return [];
  }
}

export async function getAstroCapabilitiesAsync(
  facing: 'back' | 'front' = 'back',
  cameraId?: string,
): Promise<AstroCameraCapabilities> {
  if (!NativeAstroCamera) return UNAVAILABLE_CAPS;
  try {
    return await NativeAstroCamera.getCapabilitiesAsync(facing, cameraId);
  } catch {
    return UNAVAILABLE_CAPS;
  }
}

export async function startAstroSessionAsync(opts: {
  facing?: 'back' | 'front';
  cameraId?: string;
  preferRaw?: boolean;
  maxLongEdge?: number;
} = {}): Promise<AstroSessionInfo> {
  if (!NativeAstroCamera) {
    throw new Error('AstroCamera native module is not available in this build');
  }
  return NativeAstroCamera.startSessionAsync(opts);
}

export async function captureAstroSubFrameAsync(opts: {
  exposureMs: number;
  iso: number;
  focusDistance?: number;
  lockFocusInfinity?: boolean;
  deviceRotationDeg?: number;
  wbGains?: [number, number, number];
  zoomRatio?: number;
}): Promise<AstroSubFrame> {
  if (!NativeAstroCamera) {
    throw new Error('AstroCamera native module is not available in this build');
  }
  return NativeAstroCamera.captureSubFrameAsync(opts);
}

export async function stopAstroSessionAsync(): Promise<void> {
  if (!NativeAstroCamera) return;
  await NativeAstroCamera.stopSessionAsync();
}

export async function beginAstroStackAsync(width: number, height: number): Promise<void> {
  if (!NativeAstroCamera) {
    throw new Error('AstroCamera native module is not available in this build');
  }
  await NativeAstroCamera.beginStackAsync({ width, height });
}

export async function addAstroStackFrameAsync(opts: {
  framePath: string;
  weight: number;
  homographyUv0ToK: number[];
  skyLimitNormY?: number[];
  keepFixedGround?: boolean;
}): Promise<{ added: boolean; acceptedFrames: number }> {
  if (!NativeAstroCamera) {
    throw new Error('AstroCamera native module is not available in this build');
  }
  return NativeAstroCamera.addStackFrameAsync(opts);
}

export async function renderAstroStackPreviewAsync(opts: {
  maxLongEdge?: number;
  stretchGain?: number;
  asinhStrength?: number;
  subtractBlackPercentile?: number;
  jpegQuality?: number;
  monochromeRed?: boolean;
} = {}): Promise<AstroStackFinalizeResult | null> {
  if (!NativeAstroCamera) return null;
  return NativeAstroCamera.renderStackPreviewAsync(opts);
}

export async function finalizeAstroStackAsync(opts: {
  format?: 'png' | 'jpeg';
  stretchGain?: number;
  asinhStrength?: number;
  subtractBlackPercentile?: number;
  jpegQuality?: number;
} = {}): Promise<AstroStackFinalizeResult> {
  if (!NativeAstroCamera) {
    throw new Error('AstroCamera native module is not available in this build');
  }
  return NativeAstroCamera.finalizeStackAsync(opts);
}
