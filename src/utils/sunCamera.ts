import SunCalc from 'suncalc';
import { startOfDay, addMinutes } from 'date-fns';

// ──────────────────────────────────────────
// 1. 골든타임(일출/일몰 전후 2.5시간) 활성 여부
// ──────────────────────────────────────────

export interface GoldenTimeInfo {
  isActive: boolean;
  type: 'sunrise' | 'sunset' | null;
  eventTime: Date | null;
  minutesToEvent: number; // 음수 = 이벤트 전, 양수 = 이벤트 후
}

// 골든타임 기준 임계값 상수 (분 단위)
export const SUNRISE_PRE_MINUTES = -60;  // 일출 전 1시간 (밤쪽)
export const SUNRISE_POST_MINUTES = 90;  // 일출 후 1.5시간 (낮쪽)
export const SUNSET_PRE_MINUTES = -90;   // 일몰 전 1.5시간 (낮쪽)
export const SUNSET_POST_MINUTES = 60;   // 일몰 후 1시간 (밤쪽)

export const getGoldenTimeInfo = (currentTime: Date, lat: number, lng: number): GoldenTimeInfo => {
  // 어제, 오늘, 내일 3일의 일출/일몰 시각을 모두 계산
  const days = [-1, 0, 1].map(offset => {
    const d = new Date(currentTime);
    d.setDate(d.getDate() + offset);
    return SunCalc.getTimes(d, lat, lng);
  });

  const nowMs = currentTime.getTime();
  const sunrises: Date[] = [];
  const sunsets: Date[] = [];

  days.forEach(t => {
    if (t.sunrise && !isNaN(t.sunrise.getTime())) sunrises.push(t.sunrise);
    if (t.sunset && !isNaN(t.sunset.getTime())) sunsets.push(t.sunset);
  });

  // 현재 시간과 가장 가까운 일출 찾기
  let nearestSunrise: Date | null = null;
  let minDiffSunrise = Infinity;
  for (const sr of sunrises) {
    const diff = Math.abs(nowMs - sr.getTime());
    if (diff < minDiffSunrise) {
      minDiffSunrise = diff;
      nearestSunrise = sr;
    }
  }

  // 현재 시간과 가장 가까운 일몰 찾기
  let nearestSunset: Date | null = null;
  let minDiffSunset = Infinity;
  for (const ss of sunsets) {
    const diff = Math.abs(nowMs - ss.getTime());
    if (diff < minDiffSunset) {
      minDiffSunset = diff;
      nearestSunset = ss;
    }
  }

  const minutesToSunrise = nearestSunrise ? (nowMs - nearestSunrise.getTime()) / 60000 : Infinity;
  const minutesToSunset = nearestSunset ? (nowMs - nearestSunset.getTime()) / 60000 : Infinity;

  // 일출 골든타임 체크: 밤쪽(전) 1시간, 낮쪽(후) 1.5시간
  const isSunriseActive = minutesToSunrise >= SUNRISE_PRE_MINUTES && minutesToSunrise <= SUNRISE_POST_MINUTES;

  // 일몰 골든타임 체크: 낮쪽(전) 1.5시간, 밤쪽(후) 1시간
  const isSunsetActive = minutesToSunset >= SUNSET_PRE_MINUTES && minutesToSunset <= SUNSET_POST_MINUTES;

  if (isSunriseActive && isSunsetActive) {
    // 혹시라도 겹치면 더 가까운 이벤트를 선택
    if (Math.abs(minutesToSunrise) < Math.abs(minutesToSunset)) {
      return {
        isActive: true,
        type: 'sunrise',
        eventTime: nearestSunrise,
        minutesToEvent: minutesToSunrise,
      };
    } else {
      return {
        isActive: true,
        type: 'sunset',
        eventTime: nearestSunset,
        minutesToEvent: minutesToSunset,
      };
    }
  }

  if (isSunriseActive && nearestSunrise) {
    return {
      isActive: true,
      type: 'sunrise',
      eventTime: nearestSunrise,
      minutesToEvent: minutesToSunrise,
    };
  }

  if (isSunsetActive && nearestSunset) {
    return {
      isActive: true,
      type: 'sunset',
      eventTime: nearestSunset,
      minutesToEvent: minutesToSunset,
    };
  }

  // 매칭되지 않는 경우에도 디버깅 및 UI 편의를 위해 가장 가까운 이벤트를 탑재해 전달
  const isSunriseCloser = Math.abs(minutesToSunrise) < Math.abs(minutesToSunset);
  const nearestEvent = isSunriseCloser ? nearestSunrise : nearestSunset;
  const nearestMinutes = isSunriseCloser ? minutesToSunrise : minutesToSunset;
  const nearestType = isSunriseCloser ? 'sunrise' : 'sunset';

  return {
    isActive: false,
    type: nearestType as any,
    eventTime: nearestEvent,
    minutesToEvent: nearestMinutes,
  };
};

// ──────────────────────────────────────────
// 2. 태양 위치 → 화면 좌표 변환
// ──────────────────────────────────────────

export interface ScreenPoint {
  x: number; // 0~1 비율 (왼쪽=0, 오른쪽=1)
  y: number; // 0~1 비율 (위=0, 아래=1)
  isVisible: boolean; // 카메라 FOV 내에 있는지
}

/**
 * 디바이스 방향(자이로) 기준으로 태양의 화면 좌표를 계산한다.
 * Perspective (탄젠트) 투영 사용 — 선형 투영보다 정확.
 *
 * deviceAzimuth: 디바이스가 바라보는 방위각 (0=북, 시계방향, 도)
 * devicePitch:   디바이스의 수직 기울기 (0=수평, 양수=위를 향함, 도)
 * sunAzimuth:    태양의 방위각 (0=북, 시계방향, 도)
 * sunAltitude:   태양의 고도 (도)
 * hFov:          카메라 수평 시야각 (도)
 * vFov:          카메라 수직 시야각 (도)
 */
export const getSunScreenPosition = (
  deviceAzimuth: number,
  devicePitch: number,
  sunAzimuth: number,
  sunAltitude: number,
  hFov: number = 60,
  vFov: number = 80
): ScreenPoint => {
  const toRad = Math.PI / 180;

  // 방위각 차이: 태양 - 카메라, -180~+180 범위
  let azDiff = sunAzimuth - deviceAzimuth;
  azDiff = ((azDiff + 540) % 360) - 180;

  // 고도 차이: 태양 - 카메라 피치, -180~+180 범위로 정규화
  let altDiff = sunAltitude - devicePitch;
  altDiff = ((altDiff + 540) % 360) - 180;

  // 1. 카메라 뒤쪽 반구(후방 85도 이상 차이)에 위치하는 경우 렌더링 배제 (대칭 투영 왜곡 방지)
  if (Math.abs(azDiff) >= 85 || Math.abs(altDiff) >= 85) {
    return { x: NaN, y: NaN, isVisible: false };
  }

  // Perspective 투영: tan 기반으로 가장자리 왜곡 없이 정확한 화면 위치 계산
  const halfHFovRad = (hFov / 2) * toRad;
  const halfVFovRad = (vFov / 2) * toRad;

  const xNorm = Math.tan(azDiff * toRad) / Math.tan(halfHFovRad);
  // 화면 y: 위가 0, 아래가 1 → 고도가 높을수록 y가 작아야 함
  const yNorm = -Math.tan(altDiff * toRad) / Math.tan(halfVFovRad);

  const x = 0.5 + xNorm * 0.5;
  const y = 0.5 + yNorm * 0.5;

  const isVisible = x >= -0.1 && x <= 1.1 && y >= -0.1 && y <= 1.1;

  return { x, y, isVisible };
};

// ──────────────────────────────────────────
// 3. 하루 태양 궤적 (방위각, 고도 배열)
// ──────────────────────────────────────────

export interface TrajectoryPoint {
  azimuth: number;
  altitude: number;
  time: Date;
}

export const getDaySunTrajectory = (date: Date, lat: number, lng: number): TrajectoryPoint[] => {
  const dayStart = startOfDay(date);
  const points: TrajectoryPoint[] = [];

  // 10분 간격으로 하루 태양 위치 계산 (altitude > -5인 것만)
  for (let m = 0; m <= 1440; m += 10) {
    const t = addMinutes(dayStart, m);
    const pos = SunCalc.getPosition(t, lat, lng);
    const azimuth = (pos.azimuth * 180 / Math.PI) + 180;
    const altitude = pos.altitude * 180 / Math.PI;

    if (altitude > -5) {
      points.push({ azimuth, altitude, time: t });
    }
  }

  return points;
};

// ──────────────────────────────────────────
// 4. 장면 분석 기반 적응형 보정 파라미터
// ──────────────────────────────────────────

export interface EnhancementParams {
  brightness: number;    // -1 ~ 1 (0 = 변경 없음)
  contrast: number;      // 0.5 ~ 2.0 (1 = 변경 없음)
  saturation: number;    // 0.5 ~ 2.0 (1 = 변경 없음)
  warmth: number;        // -0.3 ~ 0.3 (0 = 변경 없음, 양수 = 따뜻하게)
  sceneType: 'overcast' | 'partial_sun' | 'clear_golden' | 'dramatic';
  description: string;   // 사용자에게 보여줄 보정 설명
}

/**
 * 이미지 픽셀 데이터를 분석하여 장면에 적합한 보정 파라미터를 반환한다.
 * 실제 이미지 바이너리 분석이 어려운 환경에서는 태양 고도/구름 정보로 추론한다.
 *
 * sunAltitude: 현재 태양 고도 (도)
 * minutesToEvent: 일출/일몰까지 남은 분 (음수 = 이벤트 전)
 * cloudCover: 구름 비율 (0~1, 0=맑음, 1=완전 흐림) - weather 데이터에서 가져옴
 * avgBrightness: 프리뷰 이미지의 평균 밝기 (0~255), 사용 가능한 경우
 */
export const analyzeScene = (
  sunAltitude: number,
  minutesToEvent: number,
  cloudCover: number = 0.5,
  avgBrightness: number | null = null,
): EnhancementParams => {
  // 1) 장면 유형 분류
  let sceneType: EnhancementParams['sceneType'];

  if (cloudCover > 0.85) {
    sceneType = 'overcast';
  } else if (cloudCover > 0.4 && cloudCover <= 0.85) {
    // 구름이 있지만 해가 보이는 드라마틱한 하늘
    sceneType = 'dramatic';
  } else if (Math.abs(minutesToEvent) < 30) {
    // 일출/일몰 직전직후 30분: 골든아워 피크
    sceneType = 'clear_golden';
  } else {
    sceneType = 'partial_sun';
  }

  // 2) 장면별 적응형 보정
  switch (sceneType) {
    case 'overcast': {
      // 구름만 가득한 날: 보정 최소화, 약간의 대비만 추가
      return {
        brightness: 0.02,
        contrast: 1.05,
        saturation: 1.0,
        warmth: 0,
        sceneType,
        description: '흐린 하늘 — 자연스러운 톤 유지',
      };
    }

    case 'dramatic': {
      // 구름 사이로 해가 보이는 드라마틱 장면
      // 하이라이트를 올리고 그림자를 낮춰 구름의 부피감 강조
      const altFactor = Math.max(0, Math.min(1, (15 - Math.abs(sunAltitude)) / 15));
      const contrastBoost = 1.15 + (altFactor * 0.15); // 1.15 ~ 1.30

      // 밝기 분석이 가능한 경우 추가 조정
      let brightnessAdj = -0.06;
      if (avgBrightness !== null) {
        if (avgBrightness > 180) {
          // 과노출 방지: 밝기 더 낮춤
          brightnessAdj = -0.12;
        } else if (avgBrightness < 80) {
          // 너무 어두운 장면: 밝기 살짝 올림
          brightnessAdj = 0.03;
        }
      }

      return {
        brightness: brightnessAdj,
        contrast: contrastBoost,
        saturation: 1.15 + (altFactor * 0.1),
        warmth: 0.08 + (altFactor * 0.07),
        sceneType,
        description: '드라마틱 구름 — 대비 강화, 구름 부피감 극대화',
      };
    }

    case 'clear_golden': {
      // 맑은 골든아워: 따뜻한 톤, 부드러운 채도 부스트
      const proximity = Math.max(0, 1 - Math.abs(minutesToEvent) / 30); // 0~1

      let brightnessAdj = -0.04;
      if (avgBrightness !== null) {
        if (avgBrightness > 200) {
          brightnessAdj = -0.15; // 태양 직접 노출 억제
        } else if (avgBrightness > 160) {
          brightnessAdj = -0.08;
        }
      }

      return {
        brightness: brightnessAdj,
        contrast: 1.1 + (proximity * 0.1),
        saturation: 1.1 + (proximity * 0.15),
        warmth: 0.1 + (proximity * 0.12),
        sceneType,
        description: '골든아워 — 따뜻한 색감, 부드러운 채도 강화',
      };
    }

    case 'partial_sun':
    default: {
      // 해가 보이는 일반 장면
      let brightnessAdj = -0.03;
      if (avgBrightness !== null && avgBrightness > 180) {
        brightnessAdj = -0.1;
      }

      return {
        brightness: brightnessAdj,
        contrast: 1.08,
        saturation: 1.05,
        warmth: 0.05,
        sceneType,
        description: '맑은 하늘 — 밸런스 보정',
      };
    }
  }
};

/**
 * expo-image-manipulator용 Action 배열로 변환한다.
 * brightness/contrast 같은 커스텀 값을 manipulator가 지원하는 범위로 매핑한다.
 */
export const getManipulatorActions = (params: EnhancementParams) => {
  // expo-image-manipulator는 기본적으로 crop/resize/rotate/flip만 지원하므로
  // 보정은 GL 쉐이더나 별도 처리가 필요함.
  // 여기서는 보정 파라미터를 반환하여 네이티브 단에서 적용할 수 있도록 한다.
  return {
    // 이미지 리사이즈 (고해상도 유지)
    resize: { width: 3840 },
    // 보정 메타데이터
    enhancement: params,
  };
};
