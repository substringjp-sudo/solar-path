/**
 * frameComposite.ts — 타임랩스 **합치기** Skia 이음새(docs/SANDBOX_MODE_PLAN.md 8.2, 사용자 정리 2026-11-20).
 * 어느 장에서 합치고 저장하는지는 `timelapsePlan.shotPlan`(순수)이 정하고, 이 파일은 그림을 겹쳐 파일로 내보내는 일만 합니다. Skia 가 있는 기기에서만 돕니다.
 *
 *  - 'average'(밝게 합성): n 번째 장을 투명도 1/n 으로 덮어 **누적 평균**을 만듭니다(잡음이 줄고 밝은 부분이 고르게 남음).
 *  - 'lighten'(궤적 누적): 채널마다 밝은 쪽을 남기는 블렌드로 겹칩니다(별이 지나간 자리가 선으로 남음).
 *  - 작업 크기: 첫 장의 긴 변을 `MAX_EDGE` 로 줄입니다(원본 1200 만 화소를 통째로 쌓으면 메모리가 위험하므로). 결과는 줄인 크기의 JPEG 입니다.
 * 한계: 실기기 확인 전. EXIF 회전을 Skia 가 알아서 적용한다고 보고 있고, 안 되면 사진이 눕습니다.
 */
import { Skia, BlendMode, ImageFormat, rect, type SkSurface } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';

export type AccumulateMode = 'average' | 'lighten';
/** 합치는 그림의 긴 변(px). */
export const MAX_EDGE = 2048;

export class FrameAccumulator {
  private surface: SkSurface | null = null;
  private w = 0;
  private h = 0;
  /** 지금까지 쌓은 장수 */
  count = 0;

  constructor(private readonly mode: AccumulateMode) {}

  /** 그림 한 장을 쌓습니다. 못 읽으면 false(쌓이지 않음). */
  async add(uri: string): Promise<boolean> {
    try {
      const data = await Skia.Data.fromURI(uri);
      const img = Skia.Image.MakeImageFromEncoded(data);
      if (!img) return false;
      if (!this.surface) {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width(), img.height()));
        this.w = Math.max(1, Math.round(img.width() * scale));
        this.h = Math.max(1, Math.round(img.height() * scale));
        this.surface = Skia.Surface.Make(this.w, this.h);
        if (!this.surface) return false;
      }
      const paint = Skia.Paint();
      const first = this.count === 0;
      if (this.mode === 'average') paint.setAlphaf(first ? 1 : 1 / (this.count + 1));
      else if (!first) paint.setBlendMode(BlendMode.Lighten);
      this.surface.getCanvas().drawImageRect(img, rect(0, 0, img.width(), img.height()), rect(0, 0, this.w, this.h), paint);
      this.surface.flush();
      this.count += 1;
      return true;
    } catch {
      return false;
    }
  }

  /** 지금까지 쌓은 그림을 임시 JPEG 파일로 내보냅니다(경로). 쌓은 것이 없거나 실패하면 null. */
  async saveToFile(): Promise<string | null> {
    if (!this.surface || this.count === 0) return null;
    try {
      const base64 = this.surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 92);
      const path = `${FileSystem.cacheDirectory}timelapse_${Date.now()}_${this.count}.jpg`;
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      return path;
    } catch {
      return null;
    }
  }

  /** 쌓은 것을 비웁니다(밝게 합성이 한 묶음을 저장한 뒤). 크기는 다음 첫 장에서 다시 정합니다. */
  reset(): void {
    this.surface = null;
    this.count = 0;
  }
}
