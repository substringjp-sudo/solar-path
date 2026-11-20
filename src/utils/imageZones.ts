/**
 * imageZones.ts — 그림 파일을 작게 줄여 RGBA 로 읽는 Skia 이음새(촬영 결과 비교의 "차이 짚기", docs/SANDBOX_MODE_PLAN.md 8.7).
 * 계산은 `resultCompare.ts`(순수)가 합니다. 이 파일은 Skia 가 있는 기기에서만 돌고, 못 읽으면 null 을 돌려 차이 줄만 빠집니다.
 */
import { Skia, AlphaType, ColorType, rect } from '@shopify/react-native-skia';

export const ZONE_GRID = { width: 24, height: 12 } as const;

/** file:// · https:// · data: 그림 → width × height RGBA(줄여서). 실패하면 null. */
export async function readSmallRgba(uri: string, width: number = ZONE_GRID.width, height: number = ZONE_GRID.height): Promise<Uint8Array | null> {
  try {
    const encoded = uri.startsWith('data:') ? Skia.Data.fromBase64(uri.split(';base64,')[1] ?? '') : await Skia.Data.fromURI(uri);
    const img = Skia.Image.MakeImageFromEncoded(encoded);
    if (!img) return null;
    const surface = Skia.Surface.Make(width, height);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.drawImageRect(img, rect(0, 0, img.width(), img.height()), rect(0, 0, width, height), Skia.Paint());
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    return px instanceof Uint8Array ? px : null;
  } catch {
    return null;
  }
}
