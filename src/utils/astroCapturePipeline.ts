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
  startAstroSessionAsync,
  stopAstroSessionAsync,
  type AstroStackFinalizeResult,
} from '../../modules/astro-camera';
import { intrinsicsFromHfov, type Attitude, type HorizonProfile } from './arVision';
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
  maxTrailPx?: number;
  deviceRotationDeg?: number;
  /** 구름 스쳐 지나간 프레임 자동 감쇠/탈락 (기본 tracked 시 true, trails 시 false). */
  rejectCloudyFrames?: boolean;
  outputFormat?: 'png' | 'jpeg';
  stretchGain?: number;
  asinhStrength?: number;
  shouldAbort?: () => boolean;
  onProgress?: (p: AstroCaptureProgress) => void;
}

export interface AstroCaptureProgress {
  frameIndex: number;
  totalFrames: number;
  acceptedFrames: number;
  format: 'raw16' | 'yuv';
  lastQuality: FrameQualityResult | null;
  lastErrorPx: number;
}

export interface AstroCaptureRunResult extends AstroStackFinalizeResult {
  mode: AstroCaptureMode;
  totalFramesShot: number;
  rejectedFrames: number;
  subExposureSecUsed: number;
  rawFormatUsed: 'raw16' | 'yuv';
  frameReports: Array<{
    frameIndex: number;
    quality: FrameQualityResult;
    meanErrorPx: number;
    residualDxPx: number;
    residualDyPx: number;
    residualRotDeg: number;
  }>;
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
    const session = await startAstroSessionAsync({
      facing: 'back',
      preferRaw: input.preferRaw ?? true,
    });
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
    const frameReports: AstroCaptureRunResult['frameReports'] = [];

    for (let idx = 0; idx < totalFrames; idx++) {
      if (input.shouldAbort?.()) break;

      const attBefore = input.getAttitudeNow();
      const sub = await captureAstroSubFrameAsync({
        exposureMs: subExposureSecUsed * 1000,
        iso,
        lockFocusInfinity: true,
        focusDistance: 0,
        deviceRotationDeg: input.deviceRotationDeg ?? 0,
      });
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

      if (idx > 0 && input.mode === 'tracked') {
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
        homographyUv = aligned.homographyUv0ToK;
        meanErrorPx = aligned.meanErrorPx;
        residualDxPx = aligned.residualDxPx;
        residualDyPx = aligned.residualDyPx;
        residualRotDeg = aligned.residualRotDeg;
        matchedStars = aligned.matchedStars;
      }

      const quality: FrameQualityResult =
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

      const addRes = await addAstroStackFrameAsync({
        framePath: sub.framePath,
        weight: quality.accepted ? quality.weight : 0,
        homographyUv0ToK: Array.from(homographyUv),
        skyLimitNormY: skyMaskNormY,
        keepFixedGround,
      });

      if (addRes.added && quality.accepted) acceptedFrames = addRes.acceptedFrames;
      else rejectedFrames++;

      frameReports.push({
        frameIndex: idx,
        quality,
        meanErrorPx,
        residualDxPx,
        residualDyPx,
        residualRotDeg,
      });

      input.onProgress?.({
        frameIndex: idx + 1,
        totalFrames,
        acceptedFrames,
        format: session.format,
        lastQuality: quality,
        lastErrorPx: meanErrorPx,
      });
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
      subExposureSecUsed,
      rawFormatUsed: session.format,
      frameReports,
    };
  } finally {
    if (sessionStarted) {
      await stopAstroSessionAsync().catch(() => {});
    }
  }
}
