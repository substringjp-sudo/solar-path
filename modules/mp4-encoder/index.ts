/**
 * modules/mp4-encoder/index.ts
 *
 * 사진(JPEG) 목록을 H.264 MP4 로 묶는 안드로이드 네이티브 모듈의 TypeScript 브리지.
 * 네이티브 빌드가 포함되지 않은 환경(Web · iOS · 미빌드 개발 클라이언트)에서는 안전하게 unavailable 입니다 —
 * 그때는 앱이 지금처럼 사진 묶음으로 남깁니다. 크기 · 비트레이트는 `src/utils/mp4Plan.ts` 의 `planMp4` 가 정합니다.
 */
import { requireOptionalNativeModule } from 'expo';

interface Mp4EncoderNative {
  encodeAsync(opts: {
    frames: string[];
    outPath: string;
    width: number;
    height: number;
    fps: number;
    bitrate: number;
  }): Promise<{ path: string; frames: number }>;
}

const NativeMp4Encoder = requireOptionalNativeModule<Mp4EncoderNative>('Mp4Encoder');

export interface Mp4EncodeOptions {
  /** 사진 파일 주소(file:// 가 붙어도 됨). 순서대로 한 프레임씩. */
  frames: string[];
  /** 만들 MP4 파일 경로. 이미 있으면 덮어씁니다. */
  outPath: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export function isMp4EncoderAvailable(): boolean {
  return NativeMp4Encoder !== null;
}

/** 못 만들면(모듈 없음 · 인코더 실패) 던집니다. 모듈이 없을 때는 먼저 `isMp4EncoderAvailable()` 로 거르세요. */
export async function encodeFramesToMp4Async(opts: Mp4EncodeOptions): Promise<{ path: string; frames: number }> {
  if (!NativeMp4Encoder) {
    throw new Error('Mp4Encoder native module is not available in this build');
  }
  return NativeMp4Encoder.encodeAsync(opts);
}
