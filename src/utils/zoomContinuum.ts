/**
 * zoomContinuum.ts
 *
 * **하늘 → 상공 → 지도 → 지구본 줌이 한 줄로 이어지게 하는 순수 함수들.**
 *
 * ## 왜 따로 떼었는가
 *
 * 예전에는 진행도(0~3) → 고도·시야각·지도 폭을 푸는 식이 `SkyScene3D` 안에
 * 네 군데(손짓 이동·놓기·끊김·착륙 애니메이션) 복사돼 있었고, 서로 달랐습니다
 * (끊김 처리만 `/0.4` 가 빠져 고도가 2.5배 늦게 올라감, 단계 문턱 1.05 vs 1.35).
 * 그리고 3D 와 지도가 **서로 다른 축척**을 썼습니다 — 20 km 상공·세로 시야각 90°
 * 3D 화면은 세로 폰에서 땅 폭이 약 18 km 인데, 넘겨받는 지도는 0.08°(≈7 km)로
 * 시작해 바꾸는 순간 땅이 2.6 배 툭 커졌습니다.
 *
 * ## 이어 붙이는 원칙
 *
 * - **한 고도**: 진행도 → 고도 하나. 3D 카메라는 그 고도에서, 지도는 그 고도의
 *   **화면 땅 폭**(가로 시야각·화면비로 셈)을 경도 폭으로 씁니다. 지도에 넘어간
 *   뒤에는 고도가 가상으로 계속 오르고 지도 폭이 그대로 따라갑니다.
 * - **속도도 잇기**: 지상 1.6 m → 20 km 는 로그 고도에서 9.4 만큼이라 지도 단계
 *   (0.2° → 180°, 로그 6.8 을 1.6 진행도에)보다 훨씬 빠릅니다. 그대로 두면 넘기는
 *   순간 줌 속도가 4~5 배 뚝 떨어져 "걸리는" 느낌이 납니다. 로그 고도를 2차식으로
 *   두어 **넘기는 점에서 기울기가 지도 단계와 같게** 합니다(처음엔 빨리 떠오르고
 *   넘길 때쯤 지도 속도로 내려앉음).
 * - **넘기기 전에 내려다보기를 끝내기**: 시선 −90°·시야각 90°·북쪽 위 정렬을
 *   `P_TILT_END` 에서 끝내고, 그 뒤에 지도를 겹칩니다. 기울어진 화면과 평면 지도를
 *   겹치면 무엇을 맞춰도 어긋납니다.
 * - **북쪽 위**: 지도는 회전이 꺼져 있어(북쪽 위) 3D 도 내려다보는 동안 방위를
 *   0° 로 돌려 둡니다. 예전에는 −85° 에서 `camera.up` 을 바꿔 화면이 방위각만큼
 *   한 프레임에 돌았습니다.
 */

/** 0~1: 지상 시야각 30° → 120°. */
export const P_FOV_END = 1.0;
/** 이 진행도에서 내려다보기(시선 −90°·시야각 90°·북쪽 위)가 끝납니다. */
export const P_TILT_END = 1.28;
/** 지도를 미리 띄우는 진행도(타일이 넘기기 전에 받아지도록). 아직 투명합니다. */
export const P_MAP_MOUNT = 1.05;
/** 지도가 3D 위로 겹쳐 오르기 시작. */
export const P_FADE_START = 1.3;
/** 넘기는 점 — 지도가 다 덮고 3D 는 멈춥니다. 고도 = `HANDOFF_ALT_M`. */
export const P_HANDOFF = 1.38;
/** 구글 지도에서 지구본 구로 페이드 전환이 시작되는 진행도 */
export const P_GLOBE_FADE_START = 1.6;
/** 지구본 구로 완전 전환되는 진행도 */
export const P_GLOBE_FADE_END = 2.1;
export const P_MAX = 3.0;

export const EYE_ALT_M = 1.6;
export const HANDOFF_ALT_M = 20000;
/** 내려다볼 때의 세로 시야각(°). */
export const NADIR_FOV_DEG = 90;
/** 진행도 끝(P_MAX)의 지도 폭(경도, °). */
export const MAX_LON_DELTA = 180;

const RAD = Math.PI / 180;
const KM_PER_DEG = 111.32;

export const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
export const smoothstep = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
/** (−180, 180] 로 감습니다. */
export const wrap180 = (deg: number) => { const d = ((deg + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };

const cosLat = (latDeg: number) => Math.max(0.1, Math.cos(latDeg * RAD));

/** 세로 시야각 `fovV`, 화면비 `aspect`(가로/세로), 고도에서 화면 가로가 담는 땅 폭(km). */
export const footprintWidthKm = (altM: number, fovVDeg: number, aspect: number) =>
  (2 * altM * Math.tan((fovVDeg * RAD) / 2) * aspect) / 1000;

/** 땅 폭(km) → 그 위도의 경도 폭(°). */
export const lonDeltaForWidthKm = (widthKm: number, latDeg: number) => widthKm / (KM_PER_DEG * cosLat(latDeg));

/** 넘기는 점의 지도 폭(°) — 20 km 내려다보기 화면의 땅 폭. */
export const handoffLonDelta = (latDeg: number, aspect: number) =>
  lonDeltaForWidthKm(footprintWidthKm(HANDOFF_ALT_M, NADIR_FOV_DEG, aspect), latDeg);

/** 지도 단계의 로그 줌 속도(진행도 1 당 ln 배율). */
export const mapZoomRate = (latDeg: number, aspect: number) =>
  Math.log(MAX_LON_DELTA / Math.min(MAX_LON_DELTA * 0.999, handoffLonDelta(latDeg, aspect))) / (P_MAX - P_HANDOFF);

/**
 * 진행도 → 카메라 고도(m). 0~1 은 지상, 1~P_HANDOFF 는 로그 고도 2차식(넘기는 점에서
 * 값·기울기가 지도와 같음), 그 뒤는 지도 폭을 따라가는 **가상** 고도입니다.
 */
export const altitudeForProgress = (p: number, latDeg: number, aspect: number): number => {
  if (p <= P_FOV_END) return EYE_ALT_M;
  const m = mapZoomRate(latDeg, aspect);
  const sh = P_HANDOFF - P_FOV_END;
  if (p >= P_HANDOFF) return HANDOFF_ALT_M * Math.exp(m * (p - P_HANDOFF));
  const L = Math.log(HANDOFF_ALT_M / EYE_ALT_M);
  const s = p - P_FOV_END;
  // ln alt = ln 1.6 + b s + c s²,  ln alt(sh) = ln 20000,  기울기(sh) = m
  let c = (sh * m - L) / (sh * sh);
  let b = m - 2 * c * sh;
  if (c > 0) { c = 0; b = L / sh; }   // 지도 속도가 비정상적으로 빠르면(이론상만) 직선
  return EYE_ALT_M * Math.exp(b * s + c * s * s);
};

/** 내려다보기 섞임 0→1 (P_FOV_END → P_TILT_END, 부드럽게). */
export const tiltBlend = (p: number) => smoothstep((p - P_FOV_END) / (P_TILT_END - P_FOV_END));

export interface CameraPose {
  altitudeM: number;
  /** 세로 시야각(°). */
  fovDeg: number;
  /** 시선 고도각(°). */
  elevDeg: number;
  /** 시선 방위각(°, 0 = 북, 시계 방향). */
  azDeg: number;
  /** three.js 좌표(+Y 위, −Z 북, +X 동)의 화면 위쪽 벡터 — 시선과 수직, 끊김 없음. */
  up: [number, number, number];
}

/** 시선(고도각 e, 방위 a)에 수직인 화면 위쪽. e=0 → +Y, e=−90° → 방위 a 쪽 수평. */
export const cameraUp = (elevDeg: number, azDeg: number): [number, number, number] => {
  const e = elevDeg * RAD, a = azDeg * RAD;
  return [-Math.sin(e) * Math.sin(a), Math.cos(e), Math.sin(e) * Math.cos(a)];
};

/**
 * 진행도 → 3D 카메라 자세. `groundFov`·`groundElev`·`groundAz` 는 지상에서 사용자가
 * 둔 값(지상 시야각은 진행도 0~1 이 정하므로 `groundFov` 는 외부 주입 FOV 용).
 */
export const cameraPoseForProgress = (
  p: number, groundElev: number, groundAz: number, latDeg: number, aspect: number,
  groundFov: number = 30 + clamp01(p) * 90,
): CameraPose => {
  const t = tiltBlend(p);
  const elevDeg = groundElev + (-90 - groundElev) * t;
  const fovDeg = p <= P_FOV_END ? groundFov : 120 + (NADIR_FOV_DEG - 120) * t;
  const azDeg = ((groundAz + wrap180(0 - groundAz) * t) % 360 + 360) % 360;
  return {
    altitudeM: altitudeForProgress(Math.min(p, P_HANDOFF), latDeg, aspect),
    fovDeg, elevDeg, azDeg, up: cameraUp(elevDeg, azDeg),
  };
};

/**
 * 진행도 → 지도 폭(경도, °). 넘기는 점 앞(겹치는 동안)은 3D 의 지금 고도에서 내려다본
 * 땅 폭, 뒤는 가상 고도의 땅 폭 = 넘기는 점 폭에서 지수로 P_MAX 의 180° 까지.
 * 지도를 미리 띄우는 구간(P_MAP_MOUNT~P_FADE_START)은 겹치기 시작하는 폭에 둡니다.
 */
export const lonDeltaForProgress = (p: number, latDeg: number, aspect: number): number => {
  const q = Math.max(p, P_FADE_START);
  const alt = altitudeForProgress(q, latDeg, aspect);
  return Math.min(MAX_LON_DELTA, lonDeltaForWidthKm(footprintWidthKm(alt, NADIR_FOV_DEG, aspect), latDeg));
};

/** `lonDeltaForProgress` 의 역(넘기는 점 뒤에서만) — 구·지도에서 손으로 바꾼 축척을 진행도로. */
export const progressForLonDelta = (lonDelta: number, latDeg: number, aspect: number): number => {
  const d0 = handoffLonDelta(latDeg, aspect);
  if (lonDelta <= d0) return P_HANDOFF;
  const p = P_HANDOFF + Math.log(lonDelta / d0) / mapZoomRate(latDeg, aspect);
  return Math.min(P_MAX, p);
};

/** 지도 층 불투명도 — 3D 위로 겹쳐 오릅니다. */
export const mapOpacityForProgress = (p: number) => smoothstep((p - P_FADE_START) / (P_HANDOFF - P_FADE_START));
/** 3D 를 그릴 필요가 있는가 — 지도가 완전히 덮으면 멈춥니다. */
export const glVisibleForProgress = (p: number) => p < P_HANDOFF;
/** 지구본 구 불투명도 — 구글 지도 위로 1.6 → 2.1 구간 동안 부드럽게 페이드인합니다. */
export const globeOpacityForProgress = (p: number) =>
  smoothstep((p - P_GLOBE_FADE_START) / (P_GLOBE_FADE_END - P_GLOBE_FADE_START));

/**
 * 줌인으로 넘기는 점에 다가갈 때 지도 한가운데를 관측점으로 데려옵니다. 진행도가
 * `pPrev → pNew` 로 줄어든 몫만큼 남은 거리를 줄여 **넘기는 점에서 정확히 관측점**
 * (3D 카메라 바로 아래)이 됩니다. 줌아웃·넘기는 점 아래에서는 그대로 둡니다.
 */
export const homeCenterStep = (
  center: { latitude: number; longitude: number },
  home: { latitude: number; longitude: number },
  pPrev: number, pNew: number,
): { latitude: number; longitude: number } => {
  if (!(pNew < pPrev)) return center;
  const k = pPrev <= P_HANDOFF ? 1 : clamp01((pPrev - pNew) / (pPrev - P_HANDOFF));
  if (k <= 0) return center;
  return {
    latitude: center.latitude + (home.latitude - center.latitude) * k,
    longitude: wrap180(center.longitude + wrap180(home.longitude - center.longitude) * k),
  };
};

/** 손짓 배율 → 진행도 변화. 오므리기(ratio > 1)가 줌아웃입니다. */
export const PINCH_GAIN = 0.28;
export const progressFromPinch = (startProgress: number, distRatio: number) =>
  Math.max(0, Math.min(P_MAX, startProgress + Math.log(distRatio) * PINCH_GAIN));
