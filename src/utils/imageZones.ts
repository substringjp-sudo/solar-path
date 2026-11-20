/**
 * imageZones.ts — 그림 파일을 작게 줄여 RGBA 로 읽는 Skia 이음새(촬영 결과 비교의 "차이 짚기", docs/SANDBOX_MODE_PLAN.md 8.7).
 * 계산은 `resultCompare.ts`(순수)가 합니다. 이 파일은 Skia 가 있는 기기에서만 돌고, 못 읽으면 null 을 돌려 차이 줄만 빠집니다.
 */
import { Skia, AlphaType, ColorType, ImageFormat, rect, type SkCanvas, type SkImage } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';

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

const drawCover = (canvas: SkCanvas, img: SkImage, dx: number, dy: number, dw: number, dh: number) => {
  const iw = img.width();
  const ih = img.height();
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) * 0.5;
  const sy = (ih - sh) * 0.5;
  canvas.drawImageRect(img, rect(sx, sy, sw, sh), rect(dx, dy, dw, dh), Skia.Paint());
};

/** 실제 사진과 예측 그림을 비교 방식(반씩/겹침/위아래)대로 한 장의 JPEG 파일로 합성해 저장합니다. */
export async function exportCompareImage(
  photoUri: string,
  simUri: string,
  mode: 'split' | 'overlay' | 'stack',
  split = 0.5,
): Promise<string | null> {
  try {
    const [encA, encB] = await Promise.all([
      photoUri.startsWith('data:') ? Skia.Data.fromBase64(photoUri.split(';base64,')[1] ?? '') : Skia.Data.fromURI(photoUri),
      simUri.startsWith('data:') ? Skia.Data.fromBase64(simUri.split(';base64,')[1] ?? '') : Skia.Data.fromURI(simUri),
    ]);
    const imgA = Skia.Image.MakeImageFromEncoded(encA);
    const imgB = Skia.Image.MakeImageFromEncoded(encB);
    if (!imgA || !imgB) return null;

    const W = 1200;
    const panelH = 744;
    const gap = mode === 'stack' ? 12 : 0;
    const H = mode === 'stack' ? panelH * 2 + gap : panelH;
    const surface = Skia.Surface.Make(W, H);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('#0B1120'));

    if (mode === 'stack') {
      drawCover(canvas, imgA, 0, 0, W, panelH);
      drawCover(canvas, imgB, 0, panelH + gap, W, panelH);
    } else if (mode === 'overlay') {
      drawCover(canvas, imgA, 0, 0, W, panelH);
      const p = Skia.Paint();
      p.setAlphaf(0.5);
      const iw = imgB.width(), ih = imgB.height();
      const sc = Math.max(W / iw, panelH / ih);
      const sw = W / sc, sh = panelH / sc;
      canvas.drawImageRect(imgB, rect((iw - sw) * 0.5, (ih - sh) * 0.5, sw, sh), rect(0, 0, W, panelH), p);
    } else {
      const splitX = Math.max(40, Math.min(W - 40, Math.round(W * split)));
      drawCover(canvas, imgB, 0, 0, W, panelH);
      canvas.save();
      canvas.clipRect(rect(0, 0, splitX, panelH), 1, true);
      drawCover(canvas, imgA, 0, 0, W, panelH);
      canvas.restore();
      const linePaint = Skia.Paint();
      linePaint.setColor(Skia.Color('#F8FAFC'));
      canvas.drawRect(rect(splitX - 2, 0, 4, panelH), linePaint);
    }

    surface.flush();
    const b64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 92);
    if (!b64) return null;
    const outUri = `${FileSystem.cacheDirectory}compare_${Date.now()}.jpg`;
    await FileSystem.writeAsStringAsync(outUri, b64, { encoding: FileSystem.EncodingType.Base64 });
    return outUri;
  } catch {
    return null;
  }
}
