/**
 * astroCapturePipeline.ts
 *
 * UI 없는 실제 야간 다중 프레임 촬영 + 지구 자전 역투영 + 별 미세 정합 + 구름 프레임 필터 실행기.
 *
 * 흐름:
 *  1) 네이티브 세션 오픈(RAW_SENSOR 우선, 미지원 기기 YUV_420_888)
 *  2) 방위/고도 기반 NPF 점상 서브셔터 상한 이내로 4~10분 목표 노출을 N개 서브프레임으로 분할
 *  3) 각 프레임마다 썸네일 별 피크 추출 → 지구 자전 3×3 호모그래피 + 별 미세 정합 + 구름 통과 품질 판단
 *  4) 네이티브 32-bit float 버퍼에 선형 누적 → 최종 Asinh 스트레칭 PNG/JPEG 출력
 */
import {
  addAstroStackFrameAsync,
  beginAstroStackAsync,
  captureAstroSubFrameAsync,
  finalizeAstroStackAsync,
  getAstroCapabilitiesAsync,
  isAstroCameraAvailable,
  renderAstroStackPreviewAsync,
  startAstroSessionAsync,
  stopAstroSessionAsync,
  type AstroStackFinalizeResult,
} from '../../modules/astro-camera';
import { intrinsicsFromHfov, type Attitude, type HorizonProfile } from './arVision';
import {
  assessCaptureShake,
  type CaptureShakeAssessment,
} from './astroCameraUi';
import { recommendedSubExposureSec } from './astroForecast';
import {
  computeCelestialHomographyPx,
  computeSkyMaskRows,
  detectStarPeaks,
  estimateResidualAlignment,
  evaluateFrameQuality,
  mat3Identity,
  medianSkyBrightness,
  type FrameQualityResult,
  type StarPeak,
} from './astroStackMath';

export type AstroCaptureMode = 'tracked' | 'trails';

export interface AstroCapturePlanInput {
  mode: AstroCaptureMode;
  totalExposureSec: number;
  iso?: number;
  /** 사용자 지정 1장 셔터(초). 없으면 NPF 점상 상한 + 기기 허용치로 자동 선택. */
  subExposureSec?: number;
  latitudeDeg: number;
  longitudeDeg: number;
  /** 카메라 지향 자세(가능하면 프레임마다 읽을 콜백 사용). */
  getAttitudeNow: () => Attitude;
  horizon?: HorizonProfile | null;
  preferRaw?: boolean;
  keepFixedGround?: boolean;
  lockFocusInfinity?: boolean;
  maxTrailPx?: number;
  deviceRotationDeg?: number;
  /** 구름 스쳐 지나간 프레임 자동 감쇠/탈락 (기본 tracked 시 true, trails 시 false). */
  rejectCloudyFrames?: boolean;
  outputFormat?: 'png' | 'jpeg';
  stretchGain?: number;
  asinhStrength?: number;
  /** 서브프레임 촬영 동안 누적된 최대 자이로 회전 속도(°/s) 읽기 + 리셋 콜백. */
  consumeGyroPeakDegPerSec?: () => number;
  /** 중간 미리보기 적색 암적응 출력 여부 (기본 true). */
  getPreviewMonochromeRed?: () => boolean;
  /** N프레임마다 비파괴 중간 합성 미리보기 생성 (기본 1, 0이면 끔). */
  previewIntervalFrames?: number;
  /** 완전 취소 (스택 폐기). */
  shouldAbort?: () => boolean;
  /** 현재 프레임 이후 촬영을 멈추고 지금까지 쌓인 결과로 최종 합성. */
  shouldStopEarly?: () => boolean;
  onProgress?: (p: AstroCaptureProgress) => void;
}

export interface AstroCaptureProgress {
  frameIndex: number;
  totalFrames: number;
  acceptedFrames: number;
  rejectedFrames: number;
  format: 'raw16' | 'yuv';
  lastQuality: FrameQualityResult | null;
  lastErrorPx: number;
  previewUri: string | null;
  lastShake: CaptureShakeAssessment | null;
  shakeCount: number;
  elapsedSec: number;
  remainingSec: number;
}

export interface AstroCaptureRunResult extends AstroStackFinalizeResult {
  mode: AstroCaptureMode;
  totalFramesShot: number;
  rejectedFrames: number;
  cloudyRejectedFrames: number;
  motionRejectedFrames: number;
  subExposureSecUsed: number;
  actualDurationSec: number;
  stoppedEarly: boolean;
  rawFormatUsed: 'raw16' | 'yuv';
  shakeEvents: CaptureShakeAssessment[];
  frameReports: Array<{
    frameIndex: number;
    quality: FrameQualityResult;
    meanErrorPx: number;
    residualDxPx: number;
    residualDyPx: number;
    residualRotDeg: number;
    shake: CaptureShakeAssessment;
  }>;
}

function attitudeDeltaDeg(a: Attitude, b: Attitude): number {
  const dyaw = Math.abs((((b.yawDeg - a.yawDeg + 540) % 360) + 360) % 360 - 180);
  const dpitch = Math.abs(b.pitchDeg - a.pitchDeg);
  return Math.hypot(dyaw, dpitch);
}

function withAbortAndTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMsg: string,
  shouldAbort?: () => boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(abortPoller);
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error(timeoutMsg))), timeoutMs);
    const abortPoller = setInterval(() => {
      if (shouldAbort?.()) done(() => reject(new Error('ASTRO_ABORTED')));
    }, 200);
    work.then(
      res => done(() => resolve(res)),
      err => done(() => reject(err)),
    );
  });
}

export async function runAstroCaptureStack(
  input: AstroCapturePlanInput,
): Promise<AstroCaptureRunResult> {
  if (!isAstroCameraAvailable()) {
    throw new Error('네이티브 AstroCamera 모듈이 포함되지 않은 빌드입니다.');
  }

  const caps = await getAstroCapabilitiesAsync('back');
  if (!caps.available) {
    throw new Error('Android Camera2 장치를 찾을 수 없습니다.');
  }

  const startAtt = input.getAttitudeNow();
  const subRec = recommendedSubExposureSec({
    focal35mm: caps.focal35mm,
    latitudeDeg: input.latitudeDeg,
    azDeg: startAtt.yawDeg,
    elDeg: startAtt.pitchDeg,
    maxTrailPx: input.maxTrailPx ?? 1.5,
    deviceMaxExposureSec: Math.max(1, caps.maxExposureMs / 1000),
  });

  // 별 궤적 모드는 구름/노이즈만 덜 타게 기기 최대치 근처(예: 10~15초)로 길게 끊고,
  // 추적 합성은 점상 상한(recommendedSec)을 넘지 않게 분할합니다.
  const maxDeviceSec = Math.max(1, caps.maxExposureMs / 1000);
  const autoSubSec =
    input.mode === 'tracked'
      ? Math.max(1, Math.min(subRec.recommendedSec, maxDeviceSec))
      : Math.max(2, Math.min(15, maxDeviceSec));

  const subExposureSecUsed = Math.max(
    Math.max(0.2, caps.minExposureMs / 1000),
    Math.min(maxDeviceSec, input.subExposureSec ?? autoSubSec),
  );
  const totalFrames = Math.max(1, Math.round(input.totalExposureSec / subExposureSecUsed));
  const iso = Math.max(caps.minIso, Math.min(caps.maxIso, input.iso ?? 1600));
  const rejectCloudy = input.rejectCloudyFrames ?? input.mode === 'tracked';
  const keepFixedGround = input.keepFixedGround ?? input.mode === 'tracked';

  let sessionStarted = false;
  let stackStarted = false;

  try {
    let session = await withAbortAndTimeout(
      startAstroSessionAsync({
        facing: 'back',
        preferRaw: input.preferRaw ?? true,
      }),
      10000,
      '카메라 세션 시작 시간 초과 (10초)',
      input.shouldAbort,
    );
    sessionStarted = true;

    let refTime = new Date();
    let refAtt = startAtt;
    let refStars: StarPeak[] = [];
    let refSkyMedian = 0;
    let thumbIntrinsics = intrinsicsFromHfov(240, 180, session.hfovDeg);
    let skyMaskPx: Float32Array | undefined;
    let skyMaskNormY: number[] | undefined;

    let acceptedFrames = 0;
    let rejectedFrames = 0;
    let cloudyRejectedFrames = 0;
    let motionRejectedFrames = 0;
    let stoppedEarly = false;
    let latestPreviewUri: string | null = null;
    const shakeEvents: CaptureShakeAssessment[] = [];
    const frameReports: AstroCaptureRunResult['frameReports'] = [];
    const runStartWallMs = Date.now();
    const previewEvery = input.previewIntervalFrames ?? 1;

    for (let idx = 0; idx < totalFrames; idx++) {
      if (input.shouldAbort?.()) {
        throw new Error('ASTRO_ABORTED');
      }
      if (input.shouldStopEarly?.() && acceptedFrames > 0) {
        stoppedEarly = true;
        break;
      }

      const attBefore = input.getAttitudeNow();
      input.consumeGyroPeakDegPerSec?.(); // 직전 대기 구간 회전값 비우기
      const subTimeoutMs = Math.max(15000, subExposureSecUsed * 1000 + 12000);
      const captureOpts = {
        exposureMs: subExposureSecUsed * 1000,
        iso,
        lockFocusInfinity: input.lockFocusInfinity ?? true,
        focusDistance: 0,
        deviceRotationDeg: input.deviceRotationDeg ?? 0,
      };
      let sub: Awaited<ReturnType<typeof captureAstroSubFrameAsync>>;
      try {
        sub = await withAbortAndTimeout(
          captureAstroSubFrameAsync(captureOpts),
          subTimeoutMs,
          `서브프레임 촬영 응답 시간 초과 (${Math.round(subTimeoutMs / 1000)}초)`,
          input.shouldAbort,
        );
      } catch (capErr: any) {
        if (
          idx === 0 &&
          session.format === 'raw16' &&
          capErr?.message !== 'ASTRO_ABORTED' &&
          !input.shouldAbort?.()
        ) {
          // 일부 기기에서 RAW_SENSOR 단독 스트림이 타임아웃/실패할 경우 YUV로 1회 자동 폴백
          await stopAstroSessionAsync().catch(() => {});
          sessionStarted = false;
          session = await withAbortAndTimeout(
            startAstroSessionAsync({ facing: 'back', preferRaw: false }),
            10000,
            'YUV 폴백 카메라 세션 시작 시간 초과 (10초)',
            input.shouldAbort,
          );
          sessionStarted = true;
          thumbIntrinsics = intrinsicsFromHfov(240, 180, session.hfovDeg);
          sub = await withAbortAndTimeout(
            captureAstroSubFrameAsync(captureOpts),
            subTimeoutMs,
            `YUV 폴백 서브프레임 촬영 응답 시간 초과 (${Math.round(subTimeoutMs / 1000)}초)`,
            input.shouldAbort,
          );
        } else {
          throw capErr;
        }
      }
      if (input.shouldAbort?.()) {
        throw new Error('ASTRO_ABORTED');
      }
      const attAfter = input.getAttitudeNow();
      const gyroPeakDegPerSec = input.consumeGyroPeakDegPerSec?.() ?? 0;
      // 단일 서브프레임 노출 동안의 순수 자세 변화만 비교 (장시간 나침반 표류 오경보 방지)
      const frameAttDelta = attitudeDeltaDeg(attBefore, attAfter);
      const frameDate = new Date(sub.midTimeMs);

      if (!stackStarted) {
        await beginAstroStackAsync(sub.width, sub.height);
        stackStarted = true;
        refTime = frameDate;
        refAtt = attBefore;
        thumbIntrinsics = intrinsicsFromHfov(sub.thumbWidth, sub.thumbHeight, session.hfovDeg);
        if (input.horizon) {
          skyMaskPx = computeSkyMaskRows(input.horizon, refAtt, thumbIntrinsics);
          skyMaskNormY = Array.from(skyMaskPx, (y) =>
            Math.max(0, Math.min(1, y / sub.thumbHeight)),
          );
        }
      }

      const stars = detectStarPeaks({
        luma: sub.thumbLuma,
        width: sub.thumbWidth,
        height: sub.thumbHeight,
        skyLimitY: skyMaskPx,
        maxStars: 36,
      });
      const skyMed = medianSkyBrightness(sub.thumbLuma, sub.thumbWidth, sub.thumbHeight, skyMaskPx);

      if (idx === 0) {
        refStars = stars;
        refSkyMedian = Math.max(skyMed, 1e-3);
      }

      let homographyUv = mat3Identity();
      let meanErrorPx = 0;
      let residualDxPx = 0;
      let residualDyPx = 0;
      let residualRotDeg = 0;
      let matchedStars = stars.length;

      // trails 모드에서도 별 정합 오차를 계측해 삼각대 흔들림/이동 경고를 감지하고,
      // 실제 이미지 변형은 tracked 모드일 때만 적용한다.
      if (idx > 0) {
        const priorPx = computeCelestialHomographyPx({
          t0: refTime,
          tk: frameDate,
          latitudeDeg: input.latitudeDeg,
          longitudeDeg: input.longitudeDeg,
          attitude0: refAtt,
          attitudeK: attBefore,
          intrinsics0: thumbIntrinsics,
        });
        const aligned = estimateResidualAlignment({
          priorPx0ToK: priorPx,
          refStars,
          frameStars: stars,
          width: sub.thumbWidth,
          height: sub.thumbHeight,
        });
        if (input.mode === 'tracked') {
          homographyUv = aligned.homographyUv0ToK;
        }
        meanErrorPx = aligned.meanErrorPx;
        residualDxPx = aligned.residualDxPx;
        residualDyPx = aligned.residualDyPx;
        residualRotDeg = aligned.residualRotDeg;
        matchedStars = aligned.matchedStars;
      }

      let quality: FrameQualityResult =
        idx === 0 || !rejectCloudy
          ? {
              weight: 1,
              accepted: true,
              starCount: stars.length,
              matchedRatio: 1,
              skyMedian: skyMed,
              reason: 'ok',
            }
          : evaluateFrameQuality({
              refStars,
              refSkyMedian,
              frameStars: stars,
              frameSkyMedian: skyMed,
              alignment: {
                homographyPx0ToK: mat3Identity(),
                homographyUv0ToK: homographyUv,
                residualDxPx,
                residualDyPx,
                residualRotDeg,
                matchedStars,
                meanErrorPx,
              },
            });

      const shake = assessCaptureShake({
        frameIndex: idx + 1,
        gyroPeakDegPerSec,
        attitudeDeltaDeg: frameAttDelta,
        alignmentErrorPx: meanErrorPx,
        matchedStars,
        qualityReason: quality.reason,
      });
      if (shake.severity !== 'none') {
        shakeEvents.push(shake);
        // tracked 모드에서 물리적 센서 충격이 컸으면 별 퍼짐을 막기 위해 해당 서브프레임을 제외
        if (input.mode === 'tracked' && shake.severity === 'severe' && idx > 0) {
          quality = { ...quality, accepted: false, weight: 0, reason: 'excess_drift' };
        }
      }

      const addRes = await addAstroStackFrameAsync({
        framePath: sub.framePath,
        weight: quality.accepted ? quality.weight : 0,
        homographyUv0ToK: Array.from(homographyUv),
        skyLimitNormY: skyMaskNormY,
        keepFixedGround,
      });

      if (addRes.added && quality.accepted) {
        acceptedFrames = addRes.acceptedFrames;
      } else {
        rejectedFrames++;
        if (quality.reason === 'cloud_blocked' || quality.reason === 'too_few_stars') cloudyRejectedFrames++;
        else if (quality.reason === 'excess_drift') motionRejectedFrames++;
      }

      if (
        previewEvery > 0 &&
        acceptedFrames > 0 &&
        ((idx + 1) % previewEvery === 0 || idx === totalFrames - 1)
      ) {
        const previewRes = await renderAstroStackPreviewAsync({
          maxLongEdge: 640,
          stretchGain: input.stretchGain ?? 1.8,
          asinhStrength: input.asinhStrength ?? 10.0,
          subtractBlackPercentile: 0.2,
          monochromeRed: input.getPreviewMonochromeRed?.() ?? true,
        }).catch(() => null);
        if (previewRes?.uri) latestPreviewUri = previewRes.uri;
      }

      frameReports.push({
        frameIndex: idx,
        quality,
        meanErrorPx,
        residualDxPx,
        residualDyPx,
        residualRotDeg,
        shake,
      });

      const elapsedSec = (Date.now() - runStartWallMs) / 1000;
      const avgFrameWallSec = elapsedSec / (idx + 1);
      const remainingSec = Math.max(0, (totalFrames - (idx + 1)) * avgFrameWallSec);

      input.onProgress?.({
        frameIndex: idx + 1,
        totalFrames,
        acceptedFrames,
        rejectedFrames,
        format: session.format,
        lastQuality: quality,
        lastErrorPx: meanErrorPx,
        previewUri: latestPreviewUri,
        lastShake: shake.severity !== 'none' ? shake : null,
        shakeCount: shakeEvents.length,
        elapsedSec,
        remainingSec,
      });

      if (input.shouldStopEarly?.() && acceptedFrames > 0) {
        stoppedEarly = true;
        break;
      }
    }

    if (input.shouldAbort?.()) {
      throw new Error('ASTRO_ABORTED');
    }

    if (!stackStarted || acceptedFrames === 0) {
      throw new Error('유효한 프레임이 누적되지 않았습니다 (구름 또는 촬영 중단).');
    }

    const fin = await finalizeAstroStackAsync({
      format: input.outputFormat ?? 'png',
      stretchGain: input.stretchGain ?? 1.8,
      asinhStrength: input.asinhStrength ?? 10.0,
      subtractBlackPercentile: 0.2,
    });
    stackStarted = false;

    return {
      ...fin,
      mode: input.mode,
      totalFramesShot: frameReports.length,
      rejectedFrames,
      cloudyRejectedFrames,
      motionRejectedFrames,
      subExposureSecUsed,
      actualDurationSec: Math.round((Date.now() - runStartWallMs) / 1000),
      stoppedEarly,
      rawFormatUsed: session.format,
      shakeEvents,
      frameReports,
    };
  } finally {
    if (sessionStarted) {
      await stopAstroSessionAsync().catch(() => {});
    }
  }
}
