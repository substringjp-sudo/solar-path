/**
 * AR 화면 보정의 **앱 쪽 연결** — 사진·DEM 타일을 픽셀로 풀고, 지평선을 준비합니다.
 *
 * 계산은 전부 `arVision.ts`(판정됨)에 있고, 여기는 React Native 에 기대는 부분만 둡니다:
 *  - Skia 로 JPEG/PNG → RGBA (`decodeRgba`)
 *  - expo-image-manipulator 로 사진을 분석 크기(가로 240)로 줄이기 — EXIF 방향도 이때 바로잡힙니다
 *  - 사진 EXIF 의 35mm 환산 초점거리 → 실제 화각
 *
 * ⚠ 이 파일은 기기에서만 돕니다. 판정은 같은 계산을 pngjs 로 풀어 잽니다(`verify-ar-vision.js`).
 */
import { Skia, AlphaType, ColorType } from '@shopify/react-native-skia';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  horizonProfileAsync, hfovFromFocal35,
  type HorizonProfile, type RgbFrame,
} from './arVision';
import { loadCpuDemBlock, combineSamplers, type TileDecoder } from './demCpu';

/** 분석 화면 가로 화소. 판정과 같은 크기(240 × 세로 비율)입니다. */
export const VISION_FRAME_WIDTH = 240;
/** 눈높이(m). 지형 격자(`TerrainField`)와 같은 값. */
const EYE_HEIGHT_M = 1.6;
/** 지평선 블록 — 앱의 지형 격자와 같은 배치(촘촘 3km · 성긴 60km). */
const FINE_RADIUS_M = 3000;
const COARSE_RADIUS_M = 60000;

/** 이미지(file:// · https://) → RGBA. 실패하면 null. */
export async function decodeRgba(uri: string): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  try {
    const encoded = await Skia.Data.fromURI(uri);
    const img = Skia.Image.MakeImageFromEncoded(encoded);
    if (!img) return null;
    const width = img.width(), height = img.height();
    const px = img.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!px || !(px instanceof Uint8Array)) return null;
    return { width, height, data: px };
  } catch {
    return null;
  }
}

/** DEM 타일 디코더(256×256 RGBA). */
export const skiaTileDecoder: TileDecoder = async (url) => {
  const r = await decodeRgba(url);
  return r && r.width === 256 && r.height === 256 ? r.data : null;
};

const horizonCache = new Map<string, Promise<HorizonProfile | null>>();

/**
 * 이 자리의 DEM 지평선. 같은 자리(소수 셋째 자리, 약 100m)면 다시 안 구합니다.
 * 휴대폰에서 몇 초 걸리므로 화면이 열릴 때 미리 불러 둡니다(쉬어 가며 구해 JS 스레드를 안 막음).
 */
export function loadHorizon(lat: number, lon: number): Promise<HorizonProfile | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = horizonCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const [fine, coarse] = await Promise.all([
      loadCpuDemBlock(lat, lon, FINE_RADIUS_M, skiaTileDecoder),
      loadCpuDemBlock(lat, lon, COARSE_RADIUS_M, skiaTileDecoder),
    ]);
    if (!fine && !coarse) return null;
    const elev = combineSamplers(fine?.elevAtGround ?? null, coarse?.elevAtGround ?? null);
    const ground = elev(0, 0);
    const eye = Math.max(0, ground ?? 0) + EYE_HEIGHT_M;
    return horizonProfileAsync(elev, eye);
  })().catch(() => null);
  horizonCache.set(key, job);
  // 실패는 캐시에 남기지 않습니다 — 망이 돌아오면 다시 받게.
  job.then(v => { if (!v) horizonCache.delete(key); });
  return job;
}

/**
 * 사진 → 분석 화면(가로 240, RGBA). 줄이면서 EXIF 방향이 바로잡혀, 폰을 세워 찍은 사진은
 * 위가 폰의 윗변입니다.
 */
export async function frameFromPhoto(uri: string): Promise<RgbFrame | null> {
  try {
    const small = await ImageManipulator.manipulateAsync(
      uri, [{ resize: { width: VISION_FRAME_WIDTH } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    const d = await decodeRgba(small.uri);
    if (!d) return null;
    return { width: d.width, height: d.height, data: d.data, channels: 4 };
  } catch {
    return null;
  }
}

/**
 * 사진 EXIF 에서 이 화면의 **가로** 화각(도). 35mm 환산 초점거리가 없으면 null.
 * `SunCamera` 의 `BASE_CAMERA_FOV_DEG`(근거 없는 60°)를 대신할 실측값입니다.
 */
export function hfovFromExif(exif: Record<string, unknown> | undefined | null, width: number, height: number): number | null {
  if (!exif) return null;
  const raw = exif.FocalLengthIn35mmFilm ?? exif.FocalLenIn35mmFilm ?? exif['{Exif}FocalLenIn35mmFilm'];
  const f35 = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (!Number.isFinite(f35) || f35 < 8 || f35 > 400) return null;
  return hfovFromFocal35(f35, width, height);
}
