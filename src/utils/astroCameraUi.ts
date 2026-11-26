/**
 * astroCameraUi.ts
 *
 * 천체 촬영 뷰파인더 · 야간 암적응(검은색+빨간색) 화면 · 흔들림 감지 · 3D 장노출
 * 파라미터 계산을 위한 순수 TypeScript 헬퍼.
 *
 * 왜 분리했는가:
 *  - SunCamera.tsx 비대화를 막고, Node 검증 스크립트(verify-astro-camera-ui.js)에서
 *    UI 레이아웃 수치/카운트다운/흔들림 경보/노출 스케일링을 직접 검증하기 위함이다.
 */
import { recommendedSubExposureSec } from './astroForecast';
import type { FrameQualityResult } from './astroStackMath';

export type FrameQualityReason = FrameQualityResult['reason'];
export type AstroCaptureMode = 'tracked' | 'trails';

export interface AstroCameraCapsLike {
  available: boolean;
  rawSupported: boolean;
  minExposureMs: number;
  maxExposureMs: number;
  minIso: number;
  maxIso: number;
  focal35mm: number;
}

export interface AstroCaptureReportInput {
  cloudyRejectedFrames: number;
  motionRejectedFrames: number;
  shakeEvents: CaptureShakeAssessment[];
  frameReports: Array<{
    quality: { accepted: boolean };
    meanErrorPx: number;
  }>;
}

export type CameraTabMode = 'sunset' | 'astro';
export type CountdownDelaySec = 0 | 3 | 5 | 10;

export interface AstroSettingsState {
  mode: AstroCaptureMode;
  /** 목표 총 노출 시간 (초). 예: 240(4분) ~ 600(10분). */
  durationSec: number;
  iso: number;
  /** null 이면 NPF 권장 서브셔터 자동 사용. */
  manualSubExposureSec: number | null;
  preferRaw: boolean;
  rejectCloudyFrames: boolean;
  keepFixedGround: boolean;
  lockFocusInfinity: boolean;
  countdownDelaySec: CountdownDelaySec;
  maxTrailPx: number;
}

export interface AstroSimExposureParams {
  exposureGain: number;
  starBoost: number;
  shadowLift: number;
  stepsForPreview: number;
  stepsForFinal: number;
}

export interface AstroShotSummary {
  clampedIso: number;
  subExposureSecUsed: number;
  autoRecommendedSec: number;
  totalFrames: number;
  effectiveTotalSec: number;
  rawActive: boolean;
  declinationDeg: number;
  trailDegTotal: number;
}

export type ShakeSeverity = 'none' | 'mild' | 'severe';

export interface CaptureShakeAssessment {
  severity: ShakeSeverity;
  frameIndex: number;
  reason: 'vibration' | 'tripod_shift' | 'excess_motion' | 'ok';
  peakDegPerSec: number;
  attitudeDeltaDeg: number;
  alignmentErrorPx: number;
}

/** OLED 암적응 보호용 순수 적색 + 검정 팔레트 (녹/청 서브픽셀 방출 ≤ 32). */
export const ASTRO_NIGHT_PALETTE = {
  bg: '#000000',
  surface: '#0B0000',
  surfaceRaised: '#170202',
  border: '#5C0B0B',
  borderStrong: '#B91414',
  primary: '#E01919',
  bright: '#FF1E1E',
  dim: '#991010',
  muted: '#7F0C0C',
  warnBg: '#260303',
} as const;

export const ISO_PRESETS = [400, 800, 1600, 3200, 6400] as const;
export const COUNTDOWN_PRESETS_SEC: readonly CountdownDelaySec[] = [0, 3, 5, 10];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function createDefaultAstroSettings(): AstroSettingsState {
  return {
    mode: 'tracked',
    durationSec: 300, // 기본 5분 (4~10분 범위)
    iso: 1600,
    manualSubExposureSec: null,
    preferRaw: true,
    rejectCloudyFrames: true,
    keepFixedGround: true,
    lockFocusInfinity: true,
    countdownDelaySec: 3,
    maxTrailPx: 1.5,
  };
}

/**
 * 선택한 노출 시간(초)과 ISO에 비례해 3D 장노출 시뮬레이션 밝기·별 증폭 배율을 계산한다.
 * 뷰파인더에서 노출시간을 늘리면 3D 예측에도 별·은하수·달·구름 누적 밝기가 비례해 반영된다.
 */
export function computeAstroSimExposureParams(
  durationSec: number,
  iso: number,
): AstroSimExposureParams {
  const safeDur = Math.max(10, Math.min(3600, durationSec));
  const durationFactor = Math.log2(1 + safeDur / 60);
  const isoFactor = Math.pow(clamp(iso, 100, 12800) / 1600, 0.3);

  return {
    exposureGain: Number(clamp(0.95 + durationFactor * 0.62 * isoFactor, 1.0, 4.5).toFixed(2)),
    starBoost: Number(clamp(1.0 + durationFactor * 0.36 * isoFactor, 1.05, 3.2).toFixed(2)),
    shadowLift: 0.015,
    // 2026-11-18 표본을 늘림(사용자: 경량화를 너무 해 시간 사이 구름 움직임이 누적되지 않음). 예전 미리보기 12~32·최종 20~72 장은
    //   5 분에 12 장(25 초 간격)이라 별 궤적이 점선으로 끊기고 구름이 몇 벌로만 겹쳤음.
    stepsForPreview: Math.round(clamp(safeDur / 8, 24, 64)),
    stepsForFinal: Math.round(clamp(safeDur / 3, 60, 160)),
  };
}

/** 기기 하드웨어 성능과 지향 방향을 반영해 예상 서브셔터·장수·ISO 요약을 구한다. */
export function planAstroShotSummary(params: {
  settings: AstroSettingsState;
  caps: AstroCameraCapsLike;
  latitudeDeg: number;
  azDeg: number;
  elDeg: number;
}): AstroShotSummary {
  const { settings, caps, latitudeDeg, azDeg, elDeg } = params;
  const deviceMaxSec = caps.available ? Math.max(1, caps.maxExposureMs / 1000) : 30;
  const deviceMinSec = caps.available ? Math.max(0.2, caps.minExposureMs / 1000) : 0.2;

  const rec = recommendedSubExposureSec({
    focal35mm: caps.focal35mm > 0 ? caps.focal35mm : 24,
    latitudeDeg,
    azDeg,
    elDeg,
    maxTrailPx: settings.maxTrailPx,
    deviceMaxExposureSec: deviceMaxSec,
  });

  const autoSub =
    settings.mode === 'tracked'
      ? Math.max(1, Math.min(rec.recommendedSec, deviceMaxSec))
      : Math.max(2, Math.min(15, deviceMaxSec));

  const subExposureSecUsed = Number(
    clamp(settings.manualSubExposureSec ?? autoSub, deviceMinSec, deviceMaxSec).toFixed(1),
  );
  const totalFrames = Math.max(1, Math.round(settings.durationSec / subExposureSecUsed));
  const clampedIso = Math.round(clamp(settings.iso, caps.minIso, caps.maxIso));

  return {
    clampedIso,
    subExposureSecUsed,
    autoRecommendedSec: Number(autoSub.toFixed(1)),
    totalFrames,
    effectiveTotalSec: Math.round(totalFrames * subExposureSecUsed),
    rawActive: settings.preferRaw && (!caps.available || caps.rawSupported),
    declinationDeg: Number(rec.declinationDeg.toFixed(1)),
    trailDegTotal: Number(rec.trailDegAtExposure(settings.durationSec).toFixed(2)),
  };
}

/**
 * 서브프레임 촬영 중 자이로·자세 변동·별 정합 오차를 합쳐 결과물 영향 여부를 판정한다.
 * 별 매칭이 3개 미만(실내/구름)일 때는 기본 검색 반경(12px) 오차를 흔들림으로 오인하지 않는다.
 */
export function assessCaptureShake(input: {
  frameIndex: number;
  gyroPeakDegPerSec: number;
  attitudeDeltaDeg: number;
  alignmentErrorPx: number;
  matchedStars?: number;
  qualityReason: FrameQualityReason;
}): CaptureShakeAssessment {
  const peak = Number(Math.max(0, input.gyroPeakDegPerSec).toFixed(2));
  const attDelta = Number(Math.max(0, input.attitudeDeltaDeg).toFixed(2));
  const errPx = Number(Math.max(0, input.alignmentErrorPx).toFixed(2));
  const hasStarMatch = (input.matchedStars ?? 4) >= 3;

  if (peak >= 2.8) {
    return {
      severity: 'severe',
      frameIndex: input.frameIndex,
      reason: 'vibration',
      peakDegPerSec: peak,
      attitudeDeltaDeg: attDelta,
      alignmentErrorPx: errPx,
    };
  }
  if (attDelta >= 0.85) {
    return {
      severity: 'severe',
      frameIndex: input.frameIndex,
      reason: 'tripod_shift',
      peakDegPerSec: peak,
      attitudeDeltaDeg: attDelta,
      alignmentErrorPx: errPx,
    };
  }
  if (hasStarMatch && (input.qualityReason === 'excess_drift' || errPx >= 4.5)) {
    return {
      severity: 'severe',
      frameIndex: input.frameIndex,
      reason: 'excess_motion',
      peakDegPerSec: peak,
      attitudeDeltaDeg: attDelta,
      alignmentErrorPx: errPx,
    };
  }
  if (peak >= 1.2 || attDelta >= 0.35 || (hasStarMatch && errPx >= 2.2)) {
    return {
      severity: 'mild',
      frameIndex: input.frameIndex,
      reason: peak >= 1.2 ? 'vibration' : attDelta >= 0.35 ? 'tripod_shift' : 'excess_motion',
      peakDegPerSec: peak,
      attitudeDeltaDeg: attDelta,
      alignmentErrorPx: errPx,
    };
  }

  return {
    severity: 'none',
    frameIndex: input.frameIndex,
    reason: 'ok',
    peakDegPerSec: peak,
    attitudeDeltaDeg: attDelta,
    alignmentErrorPx: errPx,
  };
}

export interface DirectionTarget {
  azDeg: number;
  elDeg: number;
}

export interface DirectionGuideState {
  /** 천구 위 두 지향 벡터 사이의 3D 구면 각거리 (°). */
  errorDeg: number;
  /** 좌(-) / 우(+) 방위각 차이 (°). */
  deltaAzDeg: number;
  /** 아래(-) / 위(+) 고도각 차이 (°). */
  deltaElDeg: number;
  /** 허용 오차 진입 여부 (진입 시 진동 정지). */
  onTarget: boolean;
  /** 비정렬 시 진동 길이(ms), 정렬 시 0. */
  pulseMs: number;
  /** 비정렬 시 다음 진동까지 주기(ms), 정렬 시 0. */
  intervalMs: number;
}

export function wrapSignedDeg(deg: number): number {
  const w = (((deg + 180) % 360) + 360) % 360 - 180;
  return Number(w.toFixed(1));
}

/** 고고도·천정 부근에서도 방위각 왜곡 없이 실제 각도 차이를 재는 3D 구면 각거리. */
export function sphericalAngularDistanceDeg(
  az1Deg: number,
  el1Deg: number,
  az2Deg: number,
  el2Deg: number,
): number {
  const d2r = Math.PI / 180;
  const az1 = az1Deg * d2r;
  const el1 = el1Deg * d2r;
  const az2 = az2Deg * d2r;
  const el2 = el2Deg * d2r;

  const x1 = Math.cos(el1) * Math.sin(az1);
  const y1 = Math.cos(el1) * Math.cos(az1);
  const z1 = Math.sin(el1);

  const x2 = Math.cos(el2) * Math.sin(az2);
  const y2 = Math.cos(el2) * Math.cos(az2);
  const z2 = Math.sin(el2);

  const dot = clamp(x1 * x2 + y1 * y2 + z1 * z2, -1, 1);
  return Number(((Math.acos(dot) * 180) / Math.PI).toFixed(2));
}

/**
 * 목표 방향 대비 현재 카메라 방향의 정렬 상태와 삼각대 진동 가이드를 계산한다.
 * 진입(≤ 2.5°) 시 진동을 멈추고, 이탈(> 3.5°) 시 다시 울려 경계 떨림을 막는다.
 */
export function evaluateDirectionGuide(params: {
  currentAzDeg: number;
  currentElDeg: number;
  target: DirectionTarget;
  wasOnTarget: boolean;
  enterTolDeg?: number;
  exitTolDeg?: number;
}): DirectionGuideState {
  const enterTol = params.enterTolDeg ?? 2.5;
  const exitTol = params.exitTolDeg ?? 3.5;

  const errorDeg = sphericalAngularDistanceDeg(
    params.currentAzDeg,
    params.currentElDeg,
    params.target.azDeg,
    params.target.elDeg,
  );
  const deltaAzDeg = wrapSignedDeg(params.target.azDeg - params.currentAzDeg);
  const deltaElDeg = Number((params.target.elDeg - params.currentElDeg).toFixed(1));

  const onTarget = params.wasOnTarget ? errorDeg <= exitTol : errorDeg <= enterTol;
  if (onTarget) {
    return { errorDeg, deltaAzDeg, deltaElDeg, onTarget: true, pulseMs: 0, intervalMs: 0 };
  }

  const isFar = errorDeg > 12;
  return {
    errorDeg,
    deltaAzDeg,
    deltaElDeg,
    onTarget: false,
    pulseMs: isFar ? 75 : 40,
    intervalMs: isFar ? 320 : 580,
  };
}

/** 결과 리포트 화면용 요약 수치 계산. */
export function summarizeAstroCaptureResult(res: AstroCaptureReportInput) {
  const acceptedReports = res.frameReports.filter((r) => r.quality.accepted);
  const meanErrorPx =
    acceptedReports.length > 0
      ? acceptedReports.reduce((acc, r) => acc + r.meanErrorPx, 0) / acceptedReports.length
      : 0;
  return {
    meanErrorPx: Number(meanErrorPx.toFixed(2)),
    cloudyRejected: res.cloudyRejectedFrames,
    motionRejected: res.motionRejectedFrames,
    shakeCount: res.shakeEvents.length,
    severeShakeCount: res.shakeEvents.filter((s) => s.severity === 'severe').length,
  };
}

export function formatCountdownMMSS(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function formatDurationLabel(sec: number, lang: 'ko' | 'en' | 'ja'): string {
  const m = Math.round(sec / 60);
  if (sec < 60 || sec % 60 !== 0) {
    return lang === 'ko' ? `${Math.round(sec)}초` : lang === 'ja' ? `${Math.round(sec)}秒` : `${Math.round(sec)}s`;
  }
  return lang === 'ko' ? `${m}분` : lang === 'ja' ? `${m}分` : `${m}m`;
}

// ── 카메라 새 틀(2026-11-21, docs/SANDBOX_MODE_PLAN.md 23절): 막대의 천체 칩 · 설정 패널이 쓰는 계산 ──

type UiLang = 'ko' | 'en' | 'ja';

/** 시간 다이얼(초): 30초 ~ 30분(1800초) — 가로 스크롤 다이얼로 세밀하게 고릅니다. */
export const ASTRO_DURATION_CHIPS_SEC: readonly number[] = [30, 60, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1800];

/** 주어진 총 노출(초)에 가장 가까운 시간 칩. 같은 거리면 작은 쪽, 숫자가 아니면 480(8분). */
export function nearestDurationChip(sec: number): number {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return 480;
  let best = ASTRO_DURATION_CHIPS_SEC[0];
  for (const c of ASTRO_DURATION_CHIPS_SEC) if (Math.abs(c - sec) < Math.abs(best - sec)) best = c;
  return best;
}

/** 타이머 순환: 0 → 3 → 5 → 10 → 0. 모르는 값은 0. */
export function nextCountdown(cur: number): CountdownDelaySec {
  const idx = (COUNTDOWN_PRESETS_SEC as readonly number[]).indexOf(cur);
  return COUNTDOWN_PRESETS_SEC[(idx + 1) % COUNTDOWN_PRESETS_SEC.length];
}

/** 타이머 칩 글: 0 이면 "즉시"(en "0s" · ja "即時"), 아니면 "5s". */
export function countdownLabel(sec: number, lang: UiLang): string {
  if (sec === 0) return lang === 'ko' ? '즉시' : lang === 'ja' ? '即時' : '0s';
  return `${sec}s`;
}

/** 막대의 천체 칩 글: "별 궤적 · 8분 · ISO 3200 · 8s×60장". */
export function astroChipLabel(settings: Pick<AstroSettingsState, 'mode' | 'durationSec'>, summary: Pick<AstroShotSummary, 'clampedIso' | 'subExposureSecUsed' | 'totalFrames'>, lang: UiLang): string {
  const mode = settings.mode === 'tracked'
    ? (lang === 'ko' ? '별 추적' : lang === 'ja' ? '星追尾' : 'Track')
    : (lang === 'ko' ? '별 궤적' : lang === 'ja' ? '星軌跡' : 'Trails');
  const unit = lang === 'ko' ? '장' : lang === 'ja' ? '枚' : 'f';
  return `${mode} · ${formatDurationLabel(settings.durationSec, lang)} · ISO ${summary.clampedIso} · ${summary.subExposureSecUsed}s×${summary.totalFrames}${unit}`;
}
