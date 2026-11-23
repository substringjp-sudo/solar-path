import { Skia, rect, PaintStyle, ImageFormat } from '@shopify/react-native-skia';
import { Language, translateSunsetDesc, L3 } from '../utils/i18n';
import { color } from '../theme/tokens';

export const stampPhoto = async (
  uri: string,
  lat: number,
  lon: number,
  sunAlt: number,
  humidity: number,
  pm25: number | null,
  description: string,
  lang: Language,
  exposure: number = 0,
  wbTint: string | null = null
): Promise<string> => {
  try {
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return uri;

    const w = image.width();
    const h = image.height();

    const surface = Skia.Surface.Make(w, h);
    if (!surface) return uri;

    const canvas = surface.getCanvas();
    canvas.drawImage(image, 0, 0);

    // 소프트웨어 노출 보정 처리 (사진 저장물에 오버레이 합성)
    if (exposure !== 0) {
      const paintExposure = Skia.Paint();
      if (exposure < 0) {
        paintExposure.setColor(Skia.Color(`rgba(0, 0, 0, ${Math.abs(exposure) * 0.7})`));
      } else {
        paintExposure.setColor(Skia.Color(`rgba(255, 255, 255, ${exposure * 0.4})`));
      }
      canvas.drawRect(rect(0, 0, w, h), paintExposure);
    }

    // 수동 화이트밸런스(WB) 틴트 보정 (소프트웨어 폴백 및 iOS용)
    if (wbTint) {
      const paintWb = Skia.Paint();
      paintWb.setColor(Skia.Color(wbTint));
      canvas.drawRect(rect(0, 0, w, h), paintWb);
    }

    const fontSize = Math.max(14, w * 0.016);
    const fontMgr = Skia.FontMgr.System();
    const fontSystem = fontMgr.matchFamilyStyle('sans-serif', { weight: 700 });

    if (fontSystem) {
      const font = Skia.Font(fontSystem, fontSize);
      const fontHeader = Skia.Font(fontSystem, fontSize * 1.25);

      const paintText = Skia.Paint();
      paintText.setAntiAlias(true);

      const boxW = w * 0.38;
      const boxH = fontSize * 7.5;
      const boxX = w - boxW - (w * 0.04);
      const boxY = h - boxH - (h * 0.05);

      const paintBox = Skia.Paint();
      paintBox.setColor(Skia.Color('rgba(5, 5, 12, 0.65)'));
      canvas.drawRRect(Skia.RRectXY(rect(boxX, boxY, boxW, boxH), 16, 16), paintBox);

      const paintBorder = Skia.Paint();
      paintBorder.setStyle(PaintStyle.Stroke);
      paintBorder.setStrokeWidth(2);
      paintBorder.setColor(Skia.Color(color.sun));
      canvas.drawRRect(Skia.RRectXY(rect(boxX, boxY, boxW, boxH), 16, 16), paintBorder);

      let currY = boxY + fontSize * 1.8;
      const stepY = fontSize * 1.35;

      paintText.setColor(Skia.Color(color.sun));
      canvas.drawText('SOLAR PATH HUD', boxX + 16, currY, paintText, fontHeader);

      currY += stepY * 1.1;
      paintText.setColor(Skia.Color(color.text));
      const locLabel = L3(lang, '위치', 'Location', '位置');
      canvas.drawText(`${locLabel}: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`, boxX + 16, currY, paintText, font);

      currY += stepY;
      const altLabel = L3(lang, '태양 고도', 'Sun Alt', '太陽高度');
      canvas.drawText(`${altLabel}: ${sunAlt.toFixed(1)}°`, boxX + 16, currY, paintText, font);

      currY += stepY;
      const humLabel = L3(lang, '습도', 'Humidity', '湿度');
      const dustLabel = L3(lang, '초미세먼지', 'PM2.5', 'PM2.5');
      canvas.drawText(`${humLabel}: ${humidity}%  |  ${dustLabel}: ${pm25 != null ? `${pm25}㎍` : '—'}`, boxX + 16, currY, paintText, font);

      currY += stepY;
      paintText.setColor(Skia.Color('#00FFCC'));
      const condLabel = L3(lang, '하늘 상태', 'Sky Condition', '空の状態');
      const translatedDesc = translateSunsetDesc(description, lang);
      canvas.drawText(`${condLabel}: ${translatedDesc}`, boxX + 16, currY, paintText, font);
    }

    const snapshot = surface.makeImageSnapshot();
    const base64Bytes = snapshot.encodeToBase64(ImageFormat.JPEG, 90);
    return `data:image/jpeg;base64,${base64Bytes}`;
  } catch (err) {
    console.error('Failed to stamp photo with Skia:', err);
    return uri;
  }
};
