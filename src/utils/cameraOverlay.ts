/**
 * cameraOverlay.ts — 촬영 화면(전체 화면 카메라) 위에 해 경로 · 출몰 표시 · 방위 눈금을 그리기 위한 계산
 * (2026-10-25, 디자인 2단 · 촬영 화면 전체 화면).
 *
 * ## 미리보기 화각
 *
 * 카메라 미리보기는 화면을 **가득 채웁니다(cover)**. 폰을 세로로 들면 센서 그림은 3:4(가로:세로)이고
 * 화면은 그보다 길쭉하므로(390×692 ≈ 0.56) 세로가 꽉 차고 가로 양옆이 잘립니다. 그래서 화면에 보이는
 * 가로 화각은 센서 짧은 변 화각보다 좁습니다:
 *
 *   tan(세로/2) = tan(센서 긴 변/2) / 배율,   tan(가로/2) = tan(세로/2) × (화면 폭 / 화면 높이)
 *
 * (화면이 3:4 보다 넓으면 반대로 가로가 꽉 찹니다.) 센서 화각은 사진 EXIF 로 잰 값(`measuredHfov`, 세로로
 * 든 사진의 가로 = 짧은 변)이 있으면 그것, 없으면 주 카메라 흔한 값 26mm 환산의 짧은 변 화각(약 53°)입니다.
 * ⚠ 이 기본값과 "cover" 는 **기기에서 확인해야 합니다**(docs/CAMERA_FULLSCREEN_CHECK.md).
 *
 * ## 투영
 *
 * `arVision.project` 그대로 — 화면 인식 보정이 쓰는 핀홀 모형과 같은 식이라, 보정이 맞으면 그림도 맞습니다.
 */
import { project, intrinsicsFromHfov, hfovFromFocal35, apparentAltitude, dirFromAzEl, cameraBasis, type Attitude, type Intrinsics } from './arVision';
import { sunPosition, sunTimes } from './solarPosition';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 주 카메라 흔한 값(26mm 환산, 4:3)의 짧은 변 화각(도). 세로로 든 사진의 가로 화각입니다. */
export const DEFAULT_SENSOR_SHORT_FOV_DEG = hfovFromFocal35(26, 3, 4);
/** 센서 그림의 짧은 변 / 긴 변(4:3). */
export const SENSOR_ASPECT = 3 / 4;

export interface PreviewOptics {
  k: Intrinsics;
  /** 화면에 보이는 가로 · 세로 화각(도) */
  hFovDeg: number;
  vFovDeg: number;
}

/** 화면을 가득 채운(cover) 세로 미리보기의 내부변수. */
export function previewOptics(
  screenW: number,
  screenH: number,
  sensorShortFovDeg: number = DEFAULT_SENSOR_SHORT_FOV_DEG,
  magnification = 1,
): PreviewOptics {
  const tanShort = Math.tan((sensorShortFovDeg / 2) * D2R) / Math.max(1, magnification);
  const tanLong = tanShort / SENSOR_ASPECT;
  const screenAspect = screenW / screenH;
  // 화면이 센서보다 길쭉하면 세로가 꽉 차고 가로가 잘립니다(보통의 폰). 아니면 반대.
  const [tanH, tanV] = screenAspect <= SENSOR_ASPECT
    ? [tanLong * screenAspect, tanLong]
    : [tanShort, tanShort / screenAspect];
  const hFovDeg = 2 * Math.atan(tanH) * R2D;
  return { k: intrinsicsFromHfov(screenW, screenH, hFovDeg), hFovDeg, vFovDeg: 2 * Math.atan(tanV) * R2D };
}

export interface PathPoint { t: number; az: number; alt: number }

/** 그날(`date` 에서 가장 가까운 정오의 하루) 해의 자리 — 겉보기 고도, `stepMin` 분 간격. */
export function sunDayPath(date: Date, lat: number, lon: number, stepMin = 5): PathPoint[] {
  const noon = sunTimes(date, lat, lon).solarNoon.getTime();
  const out: PathPoint[] = [];
  for (let m = -12 * 60; m <= 12 * 60; m += stepMin) {
    const t = noon + m * 60_000;
    const p = sunPosition(new Date(t), lat, lon);
    out.push({ t, az: p.azimuth * R2D + 180, alt: apparentAltitude(p.altitude * R2D) });
  }
  return out;
}

/**
 * 하루 경로를 화면 선분으로. 지평선 아래(`minAlt` 미만) · 카메라 뒤 · 화면에서 한참 벗어난 점에서 끊습니다.
 * 반환은 선분 목록(각 선분은 점 둘 이상).
 */
export function projectPath(
  path: PathPoint[],
  att: Attitude,
  k: Intrinsics,
  minAlt = -1,
): { x: number; y: number }[][] {
  const basis = cameraBasis(att);
  const margin = Math.max(k.width, k.height);
  const segs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of path) {
    const q = p.alt >= minAlt ? project(dirFromAzEl(p.az, p.alt), att, k, basis) : null;
    const ok = q && q.x > -margin && q.x < k.width + margin && q.y > -margin && q.y < k.height + margin;
    if (ok) cur.push(q!);
    else { if (cur.length > 1) segs.push(cur); cur = []; }
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

/** 한 방향의 화면 자리(카메라 뒤면 null). */
export const projectAzAlt = (azDeg: number, altDeg: number, att: Attitude, k: Intrinsics) =>
  project(dirFromAzEl(azDeg, altDeg), att, k);

/** 다음 출몰(지금 이후 가장 가까운 일출 또는 일몰). 극지의 백야 · 극야면 null. */
export function nextSunEvent(now: Date, lat: number, lon: number): { type: 'sunrise' | 'sunset'; at: Date } | null {
  const cands: { type: 'sunrise' | 'sunset'; at: Date }[] = [];
  for (const dd of [0, 1]) {
    const tm = sunTimes(new Date(now.getTime() + dd * 86_400_000), lat, lon);
    for (const type of ['sunrise', 'sunset'] as const) {
      const at = tm[type];
      if (at && Number.isFinite(at.getTime()) && at.getTime() > now.getTime()) cands.push({ type, at });
    }
  }
  cands.sort((a, b) => a.at.getTime() - b.at.getTime());
  return cands[0] ?? null;
}
