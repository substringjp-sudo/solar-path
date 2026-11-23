import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { DeviceMotion, Magnetometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { poseFromRotation, compassToCameraHeading, type DevicePose } from '../utils/devicePose';
import { createHeadingFusion, type HeadingFusionStatus } from '../utils/headingFusion';
import { t, type Language } from '../utils/i18n';

interface OneEuroSensorState {
  prevAzX: number;
  prevAzY: number;
  prevAzDx: number;
  prevAzDy: number;
  prevPitch: number;
  prevPitchD: number;
  lastTime: number;
  initialized: boolean;
}

const ONE_EURO_MIN_CUTOFF = 0.15;
const ONE_EURO_BETA = 0.05;
const ONE_EURO_DERIV_CUTOFF = 1.0;

function oneEuroAlpha(dt: number, cutoff: number): number {
  const twoPiDtC = 2 * Math.PI * dt * cutoff;
  return twoPiDtC / (1 + twoPiDtC);
}

/** W3C Rotation Matrix Rz(a)*Rx(b)*Ry(g)에서 카메라 전방(-Z) 벡터와 원시 방위/앙각을 추출. */
function extractCameraForward(aRad: number, bRad: number, gRad: number) {
  const sa = Math.sin(aRad), ca = Math.cos(aRad);
  const sb = Math.sin(bRad), cb = Math.cos(bRad);
  const sg = Math.sin(gRad), cg = Math.cos(gRad);

  const fwdX = -(ca * sg + sa * sb * cg);
  const fwdY = -(sa * sg - ca * sb * cg);
  const fwdZ = -(cb * cg);

  const horiz = Math.sqrt(fwdX * fwdX + fwdY * fwdY);
  const rawHeading = (Math.atan2(fwdX, fwdY) * 180 / Math.PI + 360) % 360;
  const rawPitch = Math.atan2(fwdZ, horiz) * 180 / Math.PI;
  return { horiz, rawHeading, rawPitch };
}

function stepOneEuroFilter(
  state: OneEuroSensorState,
  calibratedHeading: number,
  rawPitch: number,
  nowMs: number,
): { az: number; pitch: number; wasFirst: boolean } {
  if (!state.initialized) {
    state.prevAzX = Math.cos(calibratedHeading * Math.PI / 180);
    state.prevAzY = Math.sin(calibratedHeading * Math.PI / 180);
    state.prevAzDx = 0;
    state.prevAzDy = 0;
    state.prevPitch = rawPitch;
    state.prevPitchD = 0;
    state.lastTime = nowMs;
    state.initialized = true;
    return { az: calibratedHeading, pitch: rawPitch, wasFirst: true };
  }

  const dt = Math.max((nowMs - state.lastTime) / 1000, 0.001);
  state.lastTime = nowMs;

  const alphaD = oneEuroAlpha(dt, ONE_EURO_DERIV_CUTOFF);

  const tx = Math.cos(calibratedHeading * Math.PI / 180);
  const ty = Math.sin(calibratedHeading * Math.PI / 180);
  state.prevAzDx += ((tx - state.prevAzX) / dt - state.prevAzDx) * alphaD;
  state.prevAzDy += ((ty - state.prevAzY) / dt - state.prevAzDy) * alphaD;
  const speedAz = Math.hypot(state.prevAzDx, state.prevAzDy);
  const alphaAz = oneEuroAlpha(dt, ONE_EURO_MIN_CUTOFF + ONE_EURO_BETA * speedAz);
  state.prevAzX += (tx - state.prevAzX) * alphaAz;
  state.prevAzY += (ty - state.prevAzY) * alphaAz;
  const az = (Math.atan2(state.prevAzY, state.prevAzX) * 180 / Math.PI + 360) % 360;

  state.prevPitchD += ((rawPitch - state.prevPitch) / dt - state.prevPitchD) * alphaD;
  const alphaP = oneEuroAlpha(dt, ONE_EURO_MIN_CUTOFF + ONE_EURO_BETA * Math.abs(state.prevPitchD));
  state.prevPitch += (rawPitch - state.prevPitch) * alphaP;
  const pitch = Math.max(-90, Math.min(90, state.prevPitch));

  return { az, pitch, wasFirst: false };
}

export function useSunCameraSensors(args: {
  visible: boolean;
  language: Language;
  onMotionSample?: (azDeg: number, pitchDeg: number, aRad: number, bRad: number, gRad: number) => void;
}) {
  const { visible, language, onMotionSample } = args;
  const onMotionSampleRef = useRef(onMotionSample);
  onMotionSampleRef.current = onMotionSample;

  const [deviceAzimuth, setDeviceAzimuth] = useState(0);
  const [devicePitch, setDevicePitch] = useState(0);
  const [hasInterference, setHasInterference] = useState(false);
  const [headingStatus, setHeadingStatus] = useState<HeadingFusionStatus | null>(null);

  const deviceAzimuthRef = useRef(0);
  const devicePitchRef = useRef(0);
  const deviceRotationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const posePoseRef = useRef<DevicePose | null>(null);
  const magRef = useRef({ x: 0, y: 0, z: 0 });
  const fusionRef = useRef(createHeadingFusion());

  const rawRotationRef = useRef<{ a: number; b: number; g: number } | null>(null);
  const angularSpeedRef = useRef(0);
  const gyroBaselineRef = useRef(0);
  const smoothedGyroRef = useRef(0);
  const gyroBurstPeakRef = useRef(0);
  const lastUiSensorMsRef = useRef(0);

  const filterRef = useRef<OneEuroSensorState>({
    prevAzX: 1,
    prevAzY: 0,
    prevAzDx: 0,
    prevAzDy: 0,
    prevPitch: 0,
    prevPitchD: 0,
    lastTime: 0,
    initialized: false,
  });

  // DeviceMotion 60Hz: Rotation Matrix -> Heading + Pitch + One Euro Filter
  useEffect(() => {
    if (!visible) return;

    DeviceMotion.setUpdateInterval(16);
    const sub = DeviceMotion.addListener((dm) => {
      if (!dm.rotation) return;
      const { alpha: aRad, beta: bRad, gamma: gRad } = dm.rotation;
      rawRotationRef.current = { a: aRad, b: bRad, g: gRad };

      const rr = dm.rotationRate;
      if (rr) {
        const inst = Math.hypot(rr.alpha ?? 0, rr.beta ?? 0, rr.gamma ?? 0);
        angularSpeedRef.current = inst;
        if (inst < 1.8) {
          gyroBaselineRef.current = gyroBaselineRef.current * 0.96 + inst * 0.04;
        }
        const netSpeed = Math.max(0, inst - gyroBaselineRef.current);
        smoothedGyroRef.current = smoothedGyroRef.current * 0.7 + netSpeed * 0.3;
        if (smoothedGyroRef.current > gyroBurstPeakRef.current) {
          gyroBurstPeakRef.current = smoothedGyroRef.current;
        }
      }

      const { horiz, rawHeading, rawPitch } = extractCameraForward(aRad, bRad, gRad);
      posePoseRef.current = poseFromRotation(aRad, bRad, gRad);
      fusionRef.current.pushGyro(rawHeading, horiz);
      const calibratedHeading = fusionRef.current.heading() ?? rawHeading;

      const now = Date.now();
      const { az, pitch, wasFirst } = stepOneEuroFilter(filterRef.current, calibratedHeading, rawPitch, now);

      deviceAzimuthRef.current = az;
      devicePitchRef.current = pitch;

      if (wasFirst) {
        setDeviceAzimuth(az);
        setDevicePitch(pitch);
        return;
      }

      // 무거운 React UI 트리는 ~15Hz(66ms)로만 갱신
      if (now - lastUiSensorMsRef.current >= 66) {
        lastUiSensorMsRef.current = now;
        setDeviceAzimuth(az);
        setDevicePitch(pitch);
      }

      const radOffset = (fusionRef.current.status().offsetDeg * Math.PI) / 180;
      deviceRotationRef.current = {
        alpha: (aRad + radOffset + 2 * Math.PI) % (2 * Math.PI),
        beta: bRad,
        gamma: gRad,
      };

      onMotionSampleRef.current?.(az, pitch, aRad, bRad, gRad);
    });
    return () => sub.remove();
  }, [visible]);

  // Magnetometer 10Hz: 자기장 왜곡만 감지
  useEffect(() => {
    if (!visible) return;
    Magnetometer.setUpdateInterval(100);
    const sub = Magnetometer.addListener((data) => {
      magRef.current = data;
      const magNorm = Math.hypot(data.x, data.y, data.z);
      setHasInterference(magNorm > 0 && (magNorm < 22 || magNorm > 68));
    });
    return () => sub.remove();
  }, [visible]);

  // Location Heading: 진북 보정 오프셋만 계산
  useEffect(() => {
    if (!visible) return;
    let subscription: Location.LocationSubscription | null = null;

    const startWatching = async () => {
      try {
        subscription = await Location.watchHeadingAsync((data) => {
          const isTrue = data.trueHeading !== -1;
          const rawCompass = isTrue ? data.trueHeading : data.magHeading;
          const pose = posePoseRef.current;
          const camHeading = pose ? compassToCameraHeading(rawCompass, pose) : null;
          if (camHeading !== null) {
            fusionRef.current.pushMagnetic(camHeading, isTrue);
            setHeadingStatus(fusionRef.current.status());
          }
        });
      } catch (err) {
        console.warn('[SunCamera] watchHeadingAsync error:', err);
      }
    };

    startWatching();
    return () => {
      if (subscription) subscription.remove();
    };
  }, [visible]);

  const handleCalibrate = useCallback(() => {
    filterRef.current.initialized = false;
    fusionRef.current.reset();
    setHeadingStatus(fusionRef.current.status());
    Alert.alert(t('calibratedTitle', language), t('calibratedMsg', language));
  }, [language]);

  return {
    deviceAzimuth,
    devicePitch,
    hasInterference,
    headingStatus,
    setHeadingStatus,
    deviceAzimuthRef,
    devicePitchRef,
    deviceRotationRef,
    posePoseRef,
    magRef,
    fusionRef,
    rawRotationRef,
    angularSpeedRef,
    gyroBurstPeakRef,
    handleCalibrate,
  };
}
