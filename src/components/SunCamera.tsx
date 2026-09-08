import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EARTH_RADIUS_M } from '../utils/earth';
import {
  StyleSheet, View, Text, TouchableOpacity, Modal,
  Dimensions, Platform, Alert, ActivityIndicator, Image, PanResponder, ScrollView
} from 'react-native';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Magnetometer, DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';
import Svg, { Circle, Path, Line, Text as SvgText, Defs, LinearGradient, Stop, Rect, Polygon } from 'react-native-svg';
import { X, Camera, RotateCcw, Sun, Aperture, Check, RefreshCw, Star, QrCode } from 'lucide-react-native';
import { Skia, rect, PaintStyle, ImageFormat } from '@shopify/react-native-skia';
import { buildSimReportPayload, encodeSimReportPayload } from '../utils/simReport';
import { resolveLayerWinds } from '../utils/skyColumn';
import { SimReportQR } from './SkyScreen/SimReportQR';


import {
  getSunScreenPosition,
  getDaySunTrajectory,
  analyzeScene,
  EnhancementParams,
  GoldenTimeInfo,
  ScreenPoint,
} from '../utils/sunCamera';
import { getSunPosition, getMoonPosition, getCelestialEvents } from '../utils/celestial';
import { getCalculatedStars, CONSTELLATION_LINES_DATA } from '../utils/celestialStarsData';
import { getCalculatedMilkyWay } from '../utils/celestialMilkyWayData';
import { getCalculatedPlanets } from '../utils/celestialPlanets';
import { generate29GridPoints, computeCloudCellData } from '../utils/cloudMatrix';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { useCelestialStore, MyPhoto } from '../store/useCelestialStore';
import { auth } from '../config/firebase';
import { predictSunset } from '../utils/sunsetPhysics';
import { getInterpolatedWeather, fetchSunsetWeather } from '../utils/weather';
import { t, Language, translateSunsetDesc } from '../utils/i18n';
import { PostDetailModal } from './PostDetailModal';
import { SkyScene3D, type SkyScene3DHandle } from './SkyScene3D';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CAM_PREVIEW_HEIGHT = Math.round(SCREEN_WIDTH * (3 / 4));

interface SunCameraProps {
  visible: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  currentTime: Date;
  goldenTimeInfo: GoldenTimeInfo;
}

const stampPhoto = async (
  uri: string,
  lat: number,
  lon: number,
  sunAlt: number,
  humidity: number,
  pm25: number,
  description: string,
  lang: Language,
  exposure: number = 0
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
      paintBorder.setColor(Skia.Color('#FFD700'));
      canvas.drawRRect(Skia.RRectXY(rect(boxX, boxY, boxW, boxH), 16, 16), paintBorder);

      let currY = boxY + fontSize * 1.8;
      const stepY = fontSize * 1.35;

      paintText.setColor(Skia.Color('#FFD700'));
      canvas.drawText('SOLAR PATH HUD', boxX + 16, currY, paintText, fontHeader);

      currY += stepY * 1.1;
      paintText.setColor(Skia.Color('#FFFFFF'));
      const locLabel = lang === 'ko' ? '위치' : 'Location';
      canvas.drawText(`${locLabel}: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`, boxX + 16, currY, paintText, font);

      currY += stepY;
      const altLabel = lang === 'ko' ? '태양 고도' : 'Sun Alt';
      canvas.drawText(`${altLabel}: ${sunAlt.toFixed(1)}°`, boxX + 16, currY, paintText, font);

      currY += stepY;
      const humLabel = lang === 'ko' ? '습도' : 'Humidity';
      const dustLabel = lang === 'ko' ? '미세먼지' : 'PM2.5';
      canvas.drawText(`${humLabel}: ${humidity}%  |  ${dustLabel}: ${pm25}㎍`, boxX + 16, currY, paintText, font);

      currY += stepY;
      paintText.setColor(Skia.Color('#00FFCC'));
      const condLabel = lang === 'ko' ? '하늘 상태' : 'Sky Condition';
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

const getAzimuthCardinal = (az: number): string => {
  const norm = (az % 360 + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return 'N';
  if (norm >= 22.5 && norm < 67.5) return 'NE';
  if (norm >= 67.5 && norm < 112.5) return 'E';
  if (norm >= 112.5 && norm < 157.5) return 'SE';
  if (norm >= 157.5 && norm < 202.5) return 'S';
  if (norm >= 202.5 && norm < 247.5) return 'SW';
  if (norm >= 247.5 && norm < 292.5) return 'W';
  return 'NW';
};

export const SunCamera: React.FC<SunCameraProps> = ({
  visible, onClose, latitude, longitude, currentTime, goldenTimeInfo,
}) => {
  const { width: W, height: H } = Dimensions.get('window');
  // 스크롤 없이 단일 화면에 상단 카메라 + 눈금자 + 하단 시뮬레이터가 4:3으로 딱 맞게 들어가도록 가용 높이 계산
  const topReserved = Platform.OS === 'ios' ? 74 : 56;
  const bottomReserved = Platform.OS === 'ios' ? 96 : 80;
  const RULER_HEIGHT = 26;
  const GAP_HEIGHT = 8;
  const availH = H - topReserved - bottomReserved - (RULER_HEIGHT + GAP_HEIGHT);
  const maxBoxH = Math.floor(availH / 2);
  const BOX_HEIGHT = Math.min(Math.round(W * (3 / 4)), maxBoxH);
  const BOX_WIDTH = Math.round(BOX_HEIGHT * (4 / 3));
  const CAM_HEIGHT = BOX_HEIGHT;
  const CAM_WIDTH = BOX_WIDTH;

  const { uploadAndPostPhoto, weatherCacheList, addWeatherCache, language, currentSimulationUri } = useCelestialStore();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const [zoom, setZoom] = useState(0); // 0 (1.0x) ~ 1 (5.0x)
  const [exposure, setExposure] = useState(0); // -1.0 ~ 1.0 (디폴트 0)

  // 줌 배율 M: 1.0x (zoom=0) ~ 5.0x (zoom=1)
  const currentMagnification = useMemo(() => {
    return 1.0 + zoom * 4.0;
  }, [zoom]);

  // 카메라 화각(FOV, 기본 1x일 때 60°) 연동
  const currentFov = useMemo(() => {
    const baseFovRad = (60 * Math.PI) / 180;
    const tanHalf = Math.tan(baseFovRad / 2) / currentMagnification;
    return (2 * Math.atan(tanHalf) * 180) / Math.PI;
  }, [currentMagnification]);

  // 배율 직접 설정 헬퍼 (1x, 2x, 3x)
  const setMagnification = useCallback((mag: number) => {
    const clampedMag = Math.max(1.0, Math.min(5.0, mag));
    setZoom((clampedMag - 1.0) / 4.0);
  }, []);

  const initialZoom = useRef(0);
  const initialDistance = useRef(0);

  // 1. Pinch Zoom PanResponder
  const pinchPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
    onPanResponderGrant: (evt) => {
      const touches = evt.nativeEvent.touches;
      if (touches.length === 2) {
        initialZoom.current = zoom;
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        initialDistance.current = Math.sqrt(dx * dx + dy * dy);
      }
    },
    onPanResponderMove: (evt) => {
      const touches = evt.nativeEvent.touches;
      if (touches.length === 2 && initialDistance.current > 0) {
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const scale = distance / initialDistance.current;
        const deltaZoom = (scale - 1) * 0.3; // 감도 조절
        const newZoom = Math.max(0, Math.min(1, initialZoom.current + deltaZoom));
        setZoom(newZoom);
      }
    },
    onPanResponderRelease: () => {
      initialDistance.current = 0;
    },
    onPanResponderTerminate: () => {
      initialDistance.current = 0;
    }
  }), [zoom]);

  // 2. Exposure Vertical Slider PanResponder
  const EXPOSURE_SLIDER_HEIGHT = 160;
  const startExposure = useRef(0);
  const exposurePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      const { locationY } = evt.nativeEvent;
      const ratio = Math.max(0, Math.min(1, (EXPOSURE_SLIDER_HEIGHT - locationY) / EXPOSURE_SLIDER_HEIGHT));
      const initialVal = ratio * 2 - 1;
      startExposure.current = initialVal;
      setExposure(initialVal);
    },
    onPanResponderMove: (evt, gestureState) => {
      const delta = -(gestureState.dy / EXPOSURE_SLIDER_HEIGHT) * 2;
      const nextExposure = Math.max(-1, Math.min(1, startExposure.current + delta));
      setExposure(nextExposure);
    }
  }), []);

  // ── 센서 융합: Rotation Matrix 기반 정밀 Heading + Pitch 동시 추출 ──
  // Why: Heading(Location.watchHeadingAsync)과 Pitch(DeviceMotion.beta)를
  //      별도 센서 소스에서 비동기 수집하면 타이밍 디싱크로 AR 위치가 어긋남.
  //      DeviceMotion의 Euler angles(α,β,γ)에서 Rotation Matrix를 재구성하여
  //      카메라 전방 벡터를 직접 추출 → 동일 샘플에서 heading + pitch 동시 계산.
  const [deviceAzimuth, setDeviceAzimuth] = useState(0);
  const [devicePitch, setDevicePitch] = useState(0);
  const [deviceRotation, setDeviceRotation] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [hasInterference, setHasInterference] = useState(false);

  // 센서 실시간 Ref (리렌더 없이 최신값 유지)
  const deviceAzimuthRef = useRef(0);
  const devicePitchRef = useRef(0);
  const deviceRotationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });

  // 자기계 raw Ref
  const magRef = useRef({ x: 0, y: 0, z: 0 });

  // Rotation Matrix에서 추출한 보정 전 heading (진북 오프셋 계산에 사용)
  const rawGyroHeadingRef = useRef(0);
  // gyro heading → 진북 방위각 보정 오프셋
  const northOffsetRef = useRef(0);
  const northOffsetInitialized = useRef(false);

  // One Euro Filter 상태 Ref
  const filterRef = useRef({
    prevAzX: 1, prevAzY: 0,   // cos(0), sin(0)
    prevAzDx: 0, prevAzDy: 0,
    prevPitch: 0, prevPitchD: 0,
    lastTime: 0,
    initialized: false,
  });

  // 촬영 상태
  const sky3dRef = useRef<SkyScene3DHandle>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureResult, setCaptureResult] = useState<string | null>(null);

  // 촬영 후 미리보기 상태
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [simPreviewUri, setSimPreviewUri] = useState<string | null>(null);
  const [capturedQrData, setCapturedQrData] = useState<string | null>(null);

  // 점수 입력 상태
  const [landscapeScore, setLandscapeScore] = useState<number>(5);
  const [weatherScore, setWeatherScore] = useState<number>(5);

  // 업로드 중 상태
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // 촬영 당시 메타데이터 상태
  const [capturedWeatherInfo, setCapturedWeatherInfo] = useState<any>(null);
  const [capturedSimSample, setCapturedSimSample] = useState<any>(null);
  const [uploadedPhotoForModal, setUploadedPhotoForModal] = useState<MyPhoto | null>(null);



  // 현재 태양 위치
  const sunPos = useMemo(() => {
    return getSunPosition(currentTime, latitude, longitude);
  }, [currentTime, latitude, longitude]);

  // 현재 달 위치
  const moonPos = useMemo(() => {
    return getMoonPosition(currentTime, latitude, longitude);
  }, [currentTime, latitude, longitude]);

  // 현재 5대 행성 위치
  const planetsPos = useMemo(() => {
    return getCalculatedPlanets(latitude, longitude, currentTime);
  }, [latitude, longitude, currentTime]);

  // 현재 오프라인 주요 별 위치
  const starsPos = useMemo(() => {
    return getCalculatedStars(latitude, longitude, currentTime);
  }, [latitude, longitude, currentTime]);

  // 현재 은하수 궤적 위치
  const milkyWayPos = useMemo(() => {
    return getCalculatedMilkyWay(latitude, longitude, currentTime);
  }, [latitude, longitude, currentTime]);

  // 주변 200km 반경 29개 구름 셀 위치
  const cloudCellsPos = useMemo(() => {
    const grid = generate29GridPoints(latitude, longitude);
    return grid.map(pt => computeCloudCellData(pt, 0));
  }, [latitude, longitude]);

  // ── 동적 일몰/일출 방위각 계산 (현재 날짜 & 위도/경도 물리계산 기준) ──
  const dynamicEventAzimuths = useMemo(() => {
    const events = getCelestialEvents(currentTime, latitude, longitude);
    const sunrisePos = getSunPosition(events.sunrise, latitude, longitude);
    const sunsetPos = getSunPosition(events.sunset, latitude, longitude);
    return {
      sunrise: sunrisePos.azimuth,
      sunset: sunsetPos.azimuth,
    };
  }, [currentTime, latitude, longitude]);

  // ── 오프스크린 시뮬레이터용 29개 다지점 공간 샘플링 시뮬레이션 상태 ──
  const cameraSimState = useMemo(() => {
    const pathData = weatherCacheList && weatherCacheList.length > 0 ? weatherCacheList[0].data : undefined;
    return {
      pathData,
      azimuth: dynamicEventAzimuths.sunset,
      eventTime: currentTime,
      terrain: { observerElevation: 50 },
    };
  }, [weatherCacheList, currentTime, dynamicEventAzimuths.sunset]);

  // 3D 시뮬레이터 전달용 노을 예측 결과
  const currentPrediction = useMemo(() => {
    return predictSunset(
      weatherCacheList && weatherCacheList.length > 0 ? weatherCacheList[0].data : [],
      currentTime,
      sunPos.altitude,
      15000,
      50,
      latitude,
      0
    );
  }, [weatherCacheList, currentTime, sunPos.altitude, latitude]);

  // 하루 태양 궤적
  const trajectory = useMemo(() => {
    return getDaySunTrajectory(currentTime, latitude, longitude);
  }, [currentTime, latitude, longitude]);

  // 적응형 보정 파라미터 계산 (실시간 업데이트)
  const currentEnhancement = useMemo(() => {
    return analyzeScene(
      sunPos.altitude,
      goldenTimeInfo.minutesToEvent,
      0.5, // 기본 구름 비율 (날씨 캐시에서 가져올 수 있음)
      null,
    );
  }, [sunPos.altitude, goldenTimeInfo.minutesToEvent]);

  // ── DeviceMotion: Rotation Matrix로 Heading + Pitch 동시 추출 ──────────────
  // Why: β 하나만 쓰면 roll(γ)을 무시하여 폰을 옆으로 기울이면 pitch가 부정확.
  //      Euler angles → Rotation Matrix 재구성하여 카메라 전방 벡터(-Z)의
  //      방위각과 앙각을 직접 계산 → 폰 회전 방향과 무관하게 정확한 pitch 유지.
  useEffect(() => {
    if (!visible) return;

    DeviceMotion.setUpdateInterval(16); // 60Hz 갱신
    const sub = DeviceMotion.addListener((dm) => {
      if (!dm.rotation) return;
      const { alpha: aRad, beta: bRad, gamma: gRad } = dm.rotation;

      // W3C Rotation Matrix: R = Rz(α) * Rx(β) * Ry(γ)
      const sa = Math.sin(aRad), ca = Math.cos(aRad);
      const sb = Math.sin(bRad), cb = Math.cos(bRad);
      const sg = Math.sin(gRad), cg = Math.cos(gRad);

      // 카메라 전방 벡터 (화면 반대쪽 = -Z축)
      const fwdX = -(ca * sg + sa * sb * cg);
      const fwdY = -(sa * sg - ca * sb * cg);
      const fwdZ = -(cb * cg);

      // Raw heading (자이로 기준, 0=북, 시계방향)
      const rawHeading = (Math.atan2(fwdX, fwdY) * 180 / Math.PI + 360) % 360;
      rawGyroHeadingRef.current = rawHeading;

      // 진북 보정 적용
      const calibratedHeading = (rawHeading + northOffsetRef.current + 360) % 360;

      // Raw pitch: 카메라 전방 벡터의 수평면 대비 앙각
      const horizDist = Math.sqrt(fwdX * fwdX + fwdY * fwdY);
      const rawPitch = Math.atan2(fwdZ, horizDist) * 180 / Math.PI;

      // --- One Euro Filter ---
      const now = Date.now();
      const state = filterRef.current;

      if (!state.initialized) {
        state.prevAzX = Math.cos(calibratedHeading * Math.PI / 180);
        state.prevAzY = Math.sin(calibratedHeading * Math.PI / 180);
        state.prevAzDx = 0;
        state.prevAzDy = 0;
        state.prevPitch = rawPitch;
        state.prevPitchD = 0;
        state.lastTime = now;
        state.initialized = true;

        deviceAzimuthRef.current = calibratedHeading;
        setDeviceAzimuth(calibratedHeading);
        devicePitchRef.current = rawPitch;
        setDevicePitch(rawPitch);
        return;
      }

      const dt = Math.max((now - state.lastTime) / 1000, 0.001);
      state.lastTime = now;

      // --- Azimuth filter ---
      const minCutoff_az = 0.15;
      const beta_az = 0.05;
      const dcutoff = 1.0;

      const tx = Math.cos(calibratedHeading * Math.PI / 180);
      const ty = Math.sin(calibratedHeading * Math.PI / 180);

      const dxX = (tx - state.prevAzX) / dt;
      const dyY = (ty - state.prevAzY) / dt;
      const alphaDx = (2 * Math.PI * dt * dcutoff) / (1 + 2 * Math.PI * dt * dcutoff);
      state.prevAzDx += (dxX - state.prevAzDx) * alphaDx;
      state.prevAzDy += (dyY - state.prevAzDy) * alphaDx;

      const speedAz = Math.sqrt(state.prevAzDx * state.prevAzDx + state.prevAzDy * state.prevAzDy);
      const cutoffAz = minCutoff_az + beta_az * speedAz;
      const alphaX = (2 * Math.PI * dt * cutoffAz) / (1 + 2 * Math.PI * dt * cutoffAz);
      const alphaY = (2 * Math.PI * dt * cutoffAz) / (1 + 2 * Math.PI * dt * cutoffAz);

      state.prevAzX += (tx - state.prevAzX) * alphaX;
      state.prevAzY += (ty - state.prevAzY) * alphaY;

      const filteredAz = (Math.atan2(state.prevAzY, state.prevAzX) * 180 / Math.PI + 360) % 360;

      // --- Pitch filter ---
      const minCutoff_p = 0.15;
      const beta_p = 0.05;

      const dxP = (rawPitch - state.prevPitch) / dt;
      const alphaDxP = (2 * Math.PI * dt * dcutoff) / (1 + 2 * Math.PI * dt * dcutoff);
      state.prevPitchD += (dxP - state.prevPitchD) * alphaDxP;

      const cutoffP = minCutoff_p + beta_p * Math.abs(state.prevPitchD);
      const alphaP = (2 * Math.PI * dt * cutoffP) / (1 + 2 * Math.PI * dt * cutoffP);
      state.prevPitch += (rawPitch - state.prevPitch) * alphaP;

      const filteredPitch = Math.max(-90, Math.min(90, state.prevPitch));

      // Update refs and trigger re-render
      deviceAzimuthRef.current = filteredAz;
      setDeviceAzimuth(filteredAz);
      devicePitchRef.current = filteredPitch;
      setDevicePitch(filteredPitch);

      // 진북 보정 각도로 보정된 3D Rotation Matrix 각도 세트 전개
      const radOffset = (northOffsetRef.current * Math.PI) / 180;
      const calibratedAlpha = (aRad + radOffset + 2 * Math.PI) % (2 * Math.PI);
      
      const currentRotation = {
        alpha: calibratedAlpha,
        beta: bRad,
        gamma: gRad,
      };
      deviceRotationRef.current = currentRotation;
      setDeviceRotation(currentRotation);
    });
    return () => sub.remove();
  }, [visible]);

  // ── Magnetometer 수집 (자기장 왜곡만 감지) ──────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    Magnetometer.setUpdateInterval(100); // 왜곡 검출은 10Hz 정도로 충분
    const sub = Magnetometer.addListener((data) => {
      magRef.current = data;
      const { x: Mx, y: My, z: Mz } = data;
      
      // 자기장 왜곡 감지 (지구 자기장 정상 범위: 25~65 μT)
      const magNorm = Math.sqrt(Mx * Mx + My * My + Mz * Mz);
      setHasInterference(magNorm > 0 && (magNorm < 22 || magNorm > 68));
    });
    return () => sub.remove();
  }, [visible]);

  // ── Location Heading: 진북 보정 오프셋만 계산 ─────────────────────────────────
  // Why: DeviceMotion alpha가 진북 기준이 아닌 플랫폼을 대비하여
  //      자기계 heading과의 차이(offset)를 천천히 추적. 자이로 장기 드리프트도 교정.
  //      heading 자체는 DeviceMotion에서 이미 추출하므로 여기서는 보정만 수행.
  useEffect(() => {
    if (!visible) return;

    let subscription: Location.LocationSubscription | null = null;

    const startWatching = async () => {
      try {
        subscription = await Location.watchHeadingAsync((data) => {
          const heading = data.trueHeading !== -1 ? data.trueHeading : data.magHeading;

          // gyro heading(보정 전)과 magnetometer heading의 차이로 오프셋 계산
          const rawGyroHeading = rawGyroHeadingRef.current;
          let rawOffset = heading - rawGyroHeading;
          rawOffset = ((rawOffset + 540) % 360) - 180; // -180~180 정규화

          if (!northOffsetInitialized.current) {
            // 최초 캘리브레이션: 즉시 적용
            northOffsetRef.current = rawOffset;
            northOffsetInitialized.current = true;
          } else {
            // 점진적 보정: 지자기 센서 순간 노이즈 차단을 위해 보정률을 0.001로 극단적 억제
            let diff = rawOffset - northOffsetRef.current;
            diff = ((diff + 540) % 360) - 180;
            northOffsetRef.current += diff * 0.001;
          }
        });
      } catch (err) {
        console.warn('[SunCamera] watchHeadingAsync error:', err);
      }
    };

    startWatching();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [visible]);

  // 센서 캘리브레이션 초기화 (기본)
  const handleCalibrate = useCallback(() => {
    filterRef.current.initialized = false;
    northOffsetInitialized.current = false; // 진북 보정도 리셋
    Alert.alert(t('calibratedTitle', language), t('calibratedMsg', language));
  }, [language]);

  // ── Sun-Snap Calibration (태양 위치 기반 정밀 AR 보정) ──────────────────────────
  // 사용자가 화면 중앙에 태양(또는 일몰 방향)을 맞추고 탭하면
  // 실제 천문학적 태양 방위각(sunPos.azimuth)으로 AR 오버레이를 ±1° 이내로 정밀 맞춤.
  const handleSunSnap = useCallback(() => {
    const rawHeading = rawGyroHeadingRef.current;
    const trueSunAz = sunPos.azimuth; // SunCalc 계산 방위각

    let offset = trueSunAz - rawHeading;
    offset = ((offset + 540) % 360) - 180;

    northOffsetRef.current = offset;
    northOffsetInitialized.current = true;

    Alert.alert(
      '☀️ Sun-Snap 보정 완료',
      `태양 실제 방위각(${Math.round(trueSunAz)}°)에 AR 시뮬레이션이 정밀 고정되었습니다.`,
      [{ text: '확인' }]
    );
  }, [sunPos.azimuth]);

  // 오프셋 없이 물리 장치 방위각/고도각 사용 (전면 카메라 전환 시 전면 렌즈 시점에 맞춤)
  const effectiveAz = useMemo(() => {
    const baseAz = cameraFacing === 'front' ? deviceAzimuth + 180 : deviceAzimuth;
    return (baseAz % 360 + 360) % 360;
  }, [deviceAzimuth, cameraFacing]);

  const effectivePitch = useMemo(() => {
    const basePitch = cameraFacing === 'front' ? -devicePitch : devicePitch;
    return Math.max(-90, Math.min(90, basePitch));
  }, [devicePitch, cameraFacing]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;

    setIsCapturing(true);

    try {
      // EXIF 활성화하여 촬영
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        exif: true,
      });

      if (!photo?.uri) {
        Alert.alert('Error', 'Failed to take photo.');
        setIsCapturing(false);
        return;
      }

      // 촬영 시점의 실제 물리 시각 강제 (타임머신 시간으로 인해 더미 대낮이 그려지는 오류 수정)
      const captureTime = new Date();
      const currentSunPos = getSunPosition(captureTime, latitude, longitude);

      // 날씨 데이터 추출 로직
      let humidity = 50;
      let pm25 = 22;
      let description = currentEnhancement.description || 'Clear';

      const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = EARTH_RADIUS_M;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      let nearestWeather = null;
      let minDist = Infinity;
      const TIME_LIMIT = 1800000; // 30분
      for (const item of weatherCacheList) {
        const dist = getDistanceMeters(latitude, longitude, item.latitude, item.longitude);
        const age = Date.now() - item.timestamp;
        if (dist < minDist && age <= TIME_LIMIT) {
          minDist = dist;
          nearestWeather = item;
        }
      }

      // 1. 캐시가 없는 경우 실시간으로 날씨 정보를 불러와 캐시에 저장
      if (!nearestWeather) {
        try {
          if (__DEV__) {
            console.log('[SunCamera] No valid weather cache. Fetching weather on the fly...');
          }
          const weatherData = await fetchSunsetWeather(latitude, longitude, currentSunPos.azimuth, false, captureTime);
          if (weatherData && weatherData.length > 0) {
            const dateStr = new Date(captureTime.getTime() + (9 * 3600 * 1000)).toISOString().split('T')[0];
            const newCacheItem = {
              key: `w_${latitude.toFixed(4)}_${longitude.toFixed(4)}_${dateStr}`,
              data: weatherData,
              timestamp: Date.now(),
              latitude,
              longitude
            };
            addWeatherCache(newCacheItem);
            nearestWeather = newCacheItem;
          }
        } catch (fetchErr) {
          console.warn('[SunCamera] Failed to fetch weather on the fly:', fetchErr);
        }
      }

      let prediction: any = null;

      if (nearestWeather && nearestWeather.data && nearestWeather.data.length > 0) {
        const interpolated = getInterpolatedWeather(nearestWeather.data, captureTime);
        if (interpolated && interpolated.length > 0) {
          const obs = interpolated[0];
          humidity = obs.humidity != null ? Math.round(obs.humidity) : 50;
          
          prediction = predictSunset(
            nearestWeather.data,
            captureTime,
            currentSunPos.altitude,
            obs.visibility,
            obs.humidity,
            latitude,
            0
          );
          if (prediction) {
            const beta = prediction.factors?.aerosolBeta ?? 0.08;
            pm25 = Math.round(beta * 280);
            description = prediction.description || 'Clear';
          }
        }
      } else {
        // 2. 날씨 정보를 가져오는 데 최종 실패한 경우에도, 현재 시간의 태양 고도에 상응하는
        // 물리 기반의 맑은 하늘(Clear) 예측 그라데이션 값을 생성하여 더미 대신 정상 시뮬레이션 렌더링을 유도
        prediction = predictSunset(
          [],
          captureTime,
          currentSunPos.altitude,
          15000, // 기본 시정 15km
          50,    // 기본 습도 50%
          latitude,
          0
        );
        if (prediction) {
          description = prediction.description || 'Clear';
        }
      }

      // Skia 워터마크 스탬프 찍기
      const stampedUri = await stampPhoto(
        photo.uri,
        latitude,
        longitude,
        currentSunPos.altitude,
        humidity,
        pm25,
        description,
        language,
        exposure
      );

      // EXIF 메타데이터 구성 (태양 위치 물리값 및 이미지 인핸스먼트 지표 결합)
      const metadata = {
        UserComment: JSON.stringify({
          source: 'SolarPath AR Camera',
          timestamp: captureTime.toISOString(),
          location: { latitude, longitude },
          sun: { altitude: currentSunPos.altitude, azimuth: currentSunPos.azimuth },
          filter: {
            scene: description,
            brightness: currentEnhancement.brightness,
            contrast: currentEnhancement.contrast,
            saturation: currentEnhancement.saturation,
            warmth: currentEnhancement.warmth
          }
        })
      };

      // 갤러리에 저장 및 EXIF 기록 시뮬레이션 로깅
      if (__DEV__) {
        console.log('[SolarPath EXIF Metadata Injection Success]', metadata);
      }

      // 1. 현재 3D 시뮬레이션 화면 스냅샷 직접 캡처 (실제 촬영 방위/고도/화각 동기화)
      let simUri = '';
      if (sky3dRef.current) {
        try {
          const snapUri = await sky3dRef.current.takeSnapshot({ format: 'jpeg', compress: 0.85 });
          if (snapUri) {
            simUri = snapUri;
          }
        } catch (simGenErr) {
          console.warn('[SunCamera] Failed to capture 3D simulation snapshot:', simGenErr);
        }
      }
      if (!simUri && currentSimulationUri) {
        simUri = currentSimulationUri;
      }

      // 2. 메타데이터 수집 (로우 기상데이터, 보간 구름데이터, 좌표, 시각 일괄 패키징)
      const weatherInfo = {
        humidity,
        pm25,
        description,
        latitude,
        longitude,
        timestamp: captureTime.getTime(),
        rawWeatherData: nearestWeather ? nearestWeather.data : null,
        interpolatedWeatherData: nearestWeather ? getInterpolatedWeather(nearestWeather.data, captureTime) : []
      };

      const simulationSample = {
        brightness: currentEnhancement.brightness,
        contrast: currentEnhancement.contrast,
        saturation: currentEnhancement.saturation,
        warmth: currentEnhancement.warmth,
        sunAltitude: currentSunPos.altitude,
        sunAzimuth: currentSunPos.azimuth
      };

      // 3. 기상 정보 QR 페이로드 생성
      let qrPayload: string | null = null;
      try {
        const obsData = nearestWeather && nearestWeather.data ? getInterpolatedWeather(nearestWeather.data, captureTime)[0] : undefined;
        const windsInfo = resolveLayerWinds(obsData);
        qrPayload = encodeSimReportPayload(
          buildSimReportPayload({
            simTimeMs: captureTime.getTime(),
            latitude,
            longitude,
            observerElevM: 0,
            sunAltDeg: currentSunPos.altitude,
            sunAzDeg: currentSunPos.azimuth,
            obs: obsData,
            windSpeedKmh: windsInfo.winds.low.speedKmh,
            windBearingDeg: windsInfo.winds.low.bearingDeg,
            windSynthetic: !windsInfo.measured,
          })
        );
      } catch (qrErr) {
        console.warn('[SunCamera] Failed to build QR payload:', qrErr);
      }

      // 4. 임시 상태에 저장하여 프리뷰 화면 전환
      setCapturedWeatherInfo(weatherInfo);
      setCapturedSimSample(simulationSample);
      setPreviewUri(stampedUri);
      setSimPreviewUri(simUri);
      setCapturedQrData(qrPayload);
      
      // 초기 점수 리셋
      setLandscapeScore(5);
      setWeatherScore(5);
      
      setIsCapturing(false);

    } catch (error) {
      console.warn('[SunCamera] Capture error:', error);
      Alert.alert(t('takePhotoError', language), t('takePhotoErrorMsg', language));
      setIsCapturing(false);
    }
  }, [isCapturing, currentEnhancement, latitude, longitude, sunPos, weatherCacheList, currentTime, language]);

  // 업로드 및 공유 처리
  const handleUpload = useCallback(async () => {
    if (!previewUri || isUploading) return;

    // 0. 엄격한 로그인 인증 상태 검증
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        language === 'ko' ? '로그인 필요' : 'Login Required',
        language === 'ko'
          ? '게시물을 등록하려면 정식 로그인이 필요합니다. 로그인 후 다시 시도해 주세요.'
          : 'Please log in to upload and share posts.'
      );
      return;
    }

    setIsUploading(true);

    try {
      // 1. 휴대폰 갤러리에 저장 시도
      let finalSaveUri = previewUri;

      if (previewUri.startsWith('data:')) {
        try {
          const base64Data = previewUri.split(';base64,')[1];
          const tempFileUri = `${FileSystem.cacheDirectory}stamped_photo_${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(tempFileUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          finalSaveUri = tempFileUri;
        } catch (fsErr) {
          console.error('[SunCamera] Failed to write temp file:', fsErr);
          throw new Error('Failed to create local image file for saving.');
        }
      }

      if (mediaPermission?.granted) {
        try {
          await MediaLibrary.saveToLibraryAsync(finalSaveUri);
        } catch (memErr) {
          console.warn('[SunCamera] MediaLibrary save failed, continuing server upload:', memErr);
        }
      } else {
        const { granted } = await requestMediaPermission();
        if (granted) {
          try {
            await MediaLibrary.saveToLibraryAsync(finalSaveUri);
          } catch (memErr) {
            console.warn('[SunCamera] MediaLibrary save failed:', memErr);
          }
        }
      }

      // 2. 서버 업로드 및 지도 데이터베이스 연동
      // expo-image-manipulator를 통한 대폭 압축 및 리사이징 (width 600, compress 0.4)
      const manipulated = await ImageManipulator.manipulateAsync(
        finalSaveUri,
        [{ resize: { width: 600 } }],
        { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG }
      );

      // 시뮬레이션 사진 압축
      let manipulatedSimUri = undefined;
      if (simPreviewUri) {
        try {
          let finalSimSaveUri = simPreviewUri;
          if (simPreviewUri.startsWith('data:')) {
            const simBase64Data = simPreviewUri.split(';base64,')[1];
            const tempSimFileUri = `${FileSystem.cacheDirectory}sim_photo_${Date.now()}.jpg`;
            await FileSystem.writeAsStringAsync(tempSimFileUri, simBase64Data, {
              encoding: FileSystem.EncodingType.Base64,
            });
            finalSimSaveUri = tempSimFileUri;
          }

          const manipulatedSim = await ImageManipulator.manipulateAsync(
            finalSimSaveUri,
            [{ resize: { width: 400 } }],
            { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
          );
          manipulatedSimUri = manipulatedSim.uri;
        } catch (simCompressErr) {
          console.warn('Failed to compress simulation image:', simCompressErr);
          manipulatedSimUri = simPreviewUri;
        }
      }

      const locationName = `AR Sunset at ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;
      let uploadedLocationName = '';
      try {
        uploadedLocationName = await uploadAndPostPhoto(
          manipulated.uri,
          latitude,
          longitude,
          locationName,
          landscapeScore,
          weatherScore,
          capturedWeatherInfo,
          capturedSimSample,
          manipulatedSimUri,
          deviceAzimuthRef.current,
          devicePitchRef.current
        );

        // 3. 업로드 성공 즉시 게시물 상세 미리보기 모달 100% 팝업!
        setUploadedPhotoForModal({
          id: `temp_${Date.now()}`,
          latitude,
          longitude,
          imageUrl: manipulated.uri,
          timestamp: Date.now(),
          locationName: uploadedLocationName || '서울특별시',
          weatherInfo: capturedWeatherInfo,
          simulationLocalUri: manipulatedSimUri,
          isPublic: false, // 초기 상태 비공개
        });
      } catch (uploadErr: any) {
        console.error('[SunCamera] Server upload failed:', uploadErr);
        Alert.alert(
          language === 'ko' ? '업로드 오류' : 'Upload Error',
          `Failed to upload photo: ${uploadErr.message || uploadErr}`
        );
      }

      // 성공 후 프리뷰 초기화
      setPreviewUri(null);
      setSimPreviewUri(null);
      setCapturedQrData(null);
      setIsUploading(false);

    } catch (uploadError: any) {
      console.error('[SunCamera] Upload failed:', uploadError);
      Alert.alert(t('uploadFailed', language), t('uploadFailedMsg', language) + (uploadError.message || 'Unknown error'));
      setIsUploading(false);
    }
  }, [previewUri, simPreviewUri, landscapeScore, weatherScore, capturedWeatherInfo, capturedSimSample, mediaPermission, requestMediaPermission, latitude, longitude, uploadAndPostPhoto, onClose, isUploading, language]);

  // 권한 요청
  useEffect(() => {
    if (visible && !cameraPermission?.granted) {
      requestCameraPermission();
    }
  }, [visible]);

  if (!visible) return null;

  if (!cameraPermission?.granted) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={styles.permissionContainer}>
          <Camera size={64} color="#FFD700" />
          <Text style={styles.permissionTitle}>Camera Permission Required</Text>
          <Text style={styles.permissionDesc}>
            Camera access is required for AR Sun tracking.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestCameraPermission}>
            <Text style={styles.permissionBtnText}>Allow Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeTextBtn} onPress={onClose}>
            <Text style={styles.closeTextBtnText}>{t('close', language)}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // 골든타임 타입에 따른 색상
  const eventColor = goldenTimeInfo.type === 'sunrise' ? '#FFA500' : '#FF4500';
  const eventLabel = goldenTimeInfo.type === 'sunrise' ? 'Sunrise' : 'Sunset';
  const minutesBefore = Math.abs(Math.round(goldenTimeInfo.minutesToEvent));
  const isBeforeEvent = goldenTimeInfo.minutesToEvent < 0;

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {previewUri ? (
          // 촬영 후 미리보기 & 평가 입력 화면
          <View style={{ flex: 1, backgroundColor: '#0A0A0F' }}>
            <ScrollView 
              contentContainerStyle={styles.previewScrollContent} 
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.previewTitle}>{t('recordSunset', language)}</Text>
              
              {/* 이미지 비교 영역 (촬영 결과물 & 시뮬레이션 예측) */}
              <View style={styles.compareImagesRow}>
                <View style={styles.compareImageWrapper}>
                  <Image source={{ uri: previewUri }} style={styles.compareImage} />
                  <Text style={styles.compareImageLabel}>📷 {t('actualLandscape', language)}</Text>
                </View>
                {simPreviewUri ? (
                  <View style={styles.compareImageWrapper}>
                    <Image source={{ uri: simPreviewUri }} style={styles.compareImage} />
                    <Text style={styles.compareImageLabel}>🔮 {language === 'ko' ? '3D 시뮬레이션 예측' : '3D Simulation'}</Text>
                  </View>
                ) : null}
              </View>

              {/* 날씨 정보 QR 리포트 카드 */}
              {capturedQrData && (
                <View style={styles.weatherQrCard}>
                  <View style={styles.weatherQrHeader}>
                    <QrCode size={15} color="#00E5FF" />
                    <Text style={styles.weatherQrTitle}>
                      {language === 'ko' ? '기상 분석 리포트 QR' : 'Weather Report QR'}
                    </Text>
                  </View>
                  <View style={styles.weatherQrBody}>
                    <View style={styles.qrPlateWrapper}>
                      <SimReportQR data={capturedQrData} />
                    </View>
                    <View style={styles.weatherQrMetaList}>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>{language === 'ko' ? '기상 상태' : 'Sky'}</Text>
                        <Text style={styles.metaValue}>
                          {capturedWeatherInfo ? translateSunsetDesc(capturedWeatherInfo.description, language) : 'Clear'}
                        </Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>{language === 'ko' ? '습도 / 미세먼지' : 'Hum / PM2.5'}</Text>
                        <Text style={styles.metaValue}>
                          {capturedWeatherInfo?.humidity ?? 50}% · {capturedWeatherInfo?.pm25 ?? 20}㎍
                        </Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>{language === 'ko' ? '태양 고도 / 방위' : 'Sun Alt / Az'}</Text>
                        <Text style={styles.metaValue}>
                          {capturedSimSample ? `${Math.round(capturedSimSample.sunAltitude)}° / ${Math.round(capturedSimSample.sunAzimuth)}°` : '-'}
                        </Text>
                      </View>
                      <Text style={styles.qrExplanationText}>
                        {language === 'ko' 
                          ? 'QR 코드로 촬영 당시의 관측 기상과 3D 물리 파라미터를 그대로 복원할 수 있습니다.' 
                          : 'Scan QR to restore exact atmospheric input and solar angles.'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
  
              {/* 별점 평가 카드 */}
              <View style={styles.scoreCard}>
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreLabel}>{t('landscapeScoreLabel', language)}</Text>
                  <View style={styles.starsContainer}>
                    {[1, 2, 3, 4, 5].map((num) => (
                      <TouchableOpacity key={num} onPress={() => setLandscapeScore(num)}>
                        <Star
                          size={28}
                          color={num <= landscapeScore ? '#FFD700' : 'rgba(255,255,255,0.25)'}
                          fill={num <= landscapeScore ? '#FFD700' : 'transparent'}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.scoreNumberText}>{landscapeScore} / 5</Text>
                </View>
  
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreLabel}>{t('weatherScoreLabel', language)}</Text>
                  <View style={styles.starsContainer}>
                    {[1, 2, 3, 4, 5].map((num) => (
                      <TouchableOpacity key={num} onPress={() => setWeatherScore(num)}>
                        <Sun
                          size={28}
                          color={num <= weatherScore ? '#FF7043' : 'rgba(255,255,255,0.25)'}
                          fill={num <= weatherScore ? '#FF7043' : 'transparent'}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.scoreNumberText}>{weatherScore} / 5</Text>
                </View>
                
                {capturedWeatherInfo && (
                  <View style={styles.weatherSummary}>
                    <Text style={styles.weatherSummaryText}>
                      {t('humidityLabel', language)} {capturedWeatherInfo.humidity}%  |  {t('dustLabel', language)} {capturedWeatherInfo.pm25}㎍  |  {t('weatherLabel', language)} {translateSunsetDesc(capturedWeatherInfo.description, language)}
                    </Text>
                  </View>
                )}
              </View>
  
              {/* 신변보호 및 사생활보호 업로드 고지 */}
              <View style={styles.privacyNoticeContainer}>
                <Text style={styles.privacyNoticeText}>
                  {t('privacyUploadNotice', language)}
                </Text>
              </View>
  
              {/* 제어 버튼 영역 */}
              <View style={styles.previewBtnRow}>
                <TouchableOpacity 
                  style={styles.previewRetakeBtn} 
                  onPress={() => {
                    setPreviewUri(null);
                    setSimPreviewUri(null);
                    setCapturedQrData(null);
                  }}
                  disabled={isUploading}
                >
                  <RefreshCw size={18} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.previewRetakeText}>{t('retake', language)}</Text>
                </TouchableOpacity>
  
                <TouchableOpacity 
                  style={styles.previewUploadBtn} 
                  onPress={handleUpload}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <>
                      <Check size={18} color="#000" style={{ marginRight: 8 }} />
                      <Text style={styles.previewUploadText}>{t('saveAndUpload', language)}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        ) : (
          // 스크롤 없는 풀스크린 맞춤형 4:3 듀얼 뷰 레이아웃
          <View style={styles.fullscreenContainer}>
            {/* 1. 상단 고정 통합 HUD 바 */}
            <View style={styles.topHudBar}>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={22} color="#FFF" />
              </TouchableOpacity>

              <View style={styles.eventBadge}>
                <Sun size={13} color={eventColor} />
                <Text style={[styles.eventText, { color: eventColor }]}>
                  {goldenTimeInfo.isActive
                    ? `${eventLabel} ${isBeforeEvent ? `${minutesBefore}m before` : `${minutesBefore}m after`}`
                    : `${eventLabel} Ready`}
                </Text>
              </View>

              <View style={styles.compassBadge}>
                <Text style={styles.compassText}>
                  {Math.round(effectiveAz)}° | {Math.round(effectivePitch)}°↑
                </Text>
              </View>
            </View>

            {hasInterference && (
              <View style={styles.warningBannerFloating}>
                <Text style={styles.warningText}>
                  ⚠️ Magnetic Interference! Move phone in "8" shape
                </Text>
              </View>
            )}

            {/* 2. 가운데 듀얼 4:3 뷰 영역 (화면 높이에 정확히 맞춰져 스크롤 불필요) */}
            <View style={styles.dualViewCenter}>
              {/* 상단 4:3 실제 카메라 박스 */}
              <View style={[styles.cameraBox, { width: BOX_WIDTH, height: BOX_HEIGHT }]}>
                <CameraView
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  facing={cameraFacing}
                  zoom={zoom}
                />

                {/* 소프트웨어 노출 조절 오버레이 */}
                {exposure < 0 && (
                  <View 
                    style={[
                      StyleSheet.absoluteFill, 
                      { backgroundColor: `rgba(0, 0, 0, ${Math.abs(exposure) * 0.7})` }
                    ]} 
                    pointerEvents="none" 
                  />
                )}
                {exposure > 0 && (
                  <View 
                    style={[
                      StyleSheet.absoluteFill, 
                      { backgroundColor: `rgba(255, 255, 255, ${exposure * 0.4})` }
                    ]} 
                    pointerEvents="none" 
                  />
                )}

                {/* 핀치 제스처 인식을 위한 오버레이 */}
                <View 
                  style={StyleSheet.absoluteFill} 
                  {...pinchPanResponder.panHandlers} 
                  pointerEvents="box-none" 
                />

                {/* 카메라 뷰 헤더 (좌: 뷰 이름, 우: 보정 프리셋 배지) */}
                <View style={styles.cameraHeaderOverlay} pointerEvents="none">
                  <View style={styles.viewHeaderBadge}>
                    <Camera size={11} color="#FFD700" />
                    <Text style={styles.viewHeaderText}>REAL CAMERA (4:3)</Text>
                  </View>
                  <View style={[styles.enhancementBadgeCompact, { borderColor: getSceneColor(currentEnhancement.sceneType) }]}>
                    <Aperture size={10} color={getSceneColor(currentEnhancement.sceneType)} />
                    <Text style={styles.enhancementTextCompact}>{currentEnhancement.description}</Text>
                  </View>
                </View>

                {/* 줌 퀵 프리셋 버튼 바 (1x, 2x, 3x, 5x) 및 실시간 배율 배지 */}
                <View style={styles.zoomQuickRow} pointerEvents="box-none">
                  {[1, 2, 3, 5].map((mag) => {
                    const isSelected = Math.abs(currentMagnification - mag) < 0.25;
                    return (
                      <TouchableOpacity
                        key={mag}
                        style={[styles.zoomQuickBtn, isSelected && styles.zoomQuickBtnActive]}
                        onPress={() => setMagnification(mag)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.zoomQuickText, isSelected && styles.zoomQuickTextActive]}>
                          {mag}x
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <View style={styles.zoomLiveBadge}>
                    <Text style={styles.zoomLiveText}>{currentMagnification.toFixed(1)}x</Text>
                  </View>
                </View>

                {/* 우측 슬림 노출 조절 슬라이더 */}
                <View style={styles.exposureSliderWrapper}>
                  <Sun size={10} color="#FFD700" style={styles.exposureIconTop} />
                  <View 
                    style={styles.exposureSliderTrackContainer}
                    {...exposurePanResponder.panHandlers}
                  >
                    <View style={styles.exposureTrack} />
                    <View 
                      style={[
                        styles.exposureActiveBar, 
                        { height: `${((exposure + 1) / 2) * 100}%` }
                      ]} 
                    />
                    <View 
                      style={[
                        styles.exposureKnob, 
                        { bottom: `${((exposure + 1) / 2) * 100}%`, marginBottom: -5 }
                      ]} 
                    />
                  </View>
                  <Sun size={8} color="rgba(255,255,255,0.4)" style={styles.exposureIconBottom} />
                </View>
              </View>

              {/* 시뮬레이터 밖 전용 나침반 눈금자 (Compass Ruler) */}
              <View style={[styles.compassRulerBar, { width: BOX_WIDTH, height: RULER_HEIGHT }]}>
                <Svg width={BOX_WIDTH} height={RULER_HEIGHT}>
                  <Rect width={BOX_WIDTH} height={RULER_HEIGHT} fill="rgba(8, 12, 22, 0.88)" rx={6} />
                  {(() => {
                    const centerX = BOX_WIDTH / 2;
                    const pxPerDeg = (BOX_WIDTH - 24) / 70;
                    const ticks = [];
                    for (let offset = -40; offset <= 40; offset += 5) {
                      const tickDeg = Math.round((effectiveAz + offset) / 5) * 5;
                      const normDeg = (tickDeg % 360 + 360) % 360;
                      const x = centerX + (tickDeg - effectiveAz) * pxPerDeg;
                      if (x < 6 || x > BOX_WIDTH - 6) continue;

                      const isCardinal = normDeg % 45 === 0;
                      const isTen = normDeg % 10 === 0;

                      let label = '';
                      if (normDeg === 0) label = 'N';
                      else if (normDeg === 45) label = 'NE';
                      else if (normDeg === 90) label = 'E';
                      else if (normDeg === 135) label = 'SE';
                      else if (normDeg === 180) label = 'S';
                      else if (normDeg === 225) label = 'SW';
                      else if (normDeg === 270) label = 'W';
                      else if (normDeg === 315) label = 'NW';

                      const strokeColor = isCardinal 
                        ? (normDeg === 0 ? '#FF5252' : '#00E5FF') 
                        : (isTen ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)');
                      const tickH = isCardinal ? 8 : (isTen ? 5 : 3.5);

                      ticks.push(
                        <React.Fragment key={`ruler-${tickDeg}`}>
                          <Line
                            x1={x}
                            y1={RULER_HEIGHT - tickH}
                            x2={x}
                            y2={RULER_HEIGHT}
                            stroke={strokeColor}
                            strokeWidth={isCardinal ? 1.5 : 0.9}
                          />
                          {label !== '' && (
                            <SvgText
                              x={x}
                              y={RULER_HEIGHT - tickH - 2}
                              fill={normDeg === 0 ? '#FF5252' : '#00E5FF'}
                              fontSize={8}
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              {label}
                            </SvgText>
                          )}
                          {label === '' && isTen && (
                            <SvgText
                              x={x}
                              y={RULER_HEIGHT - tickH - 2}
                              fill="rgba(255,255,255,0.45)"
                              fontSize={7}
                              textAnchor="middle"
                            >
                              {normDeg}°
                            </SvgText>
                          )}
                        </React.Fragment>
                      );
                    }
                    return ticks;
                  })()}
                  {/* 중앙 포인터 인디케이터 */}
                  <Polygon
                    points={`${BOX_WIDTH / 2 - 4},0 ${BOX_WIDTH / 2 + 4},0 ${BOX_WIDTH / 2},5`}
                    fill="#FFD700"
                  />
                  <Line
                    x1={BOX_WIDTH / 2}
                    y1={0}
                    x2={BOX_WIDTH / 2}
                    y2={RULER_HEIGHT}
                    stroke="#FFD700"
                    strokeWidth={1}
                    strokeDasharray="2,2"
                  />
                </Svg>
                {/* 중앙 현재 방위각 배지 */}
                <View style={styles.compassCenterBadge} pointerEvents="none">
                  <Text style={styles.compassCenterText}>
                    {Math.round(effectiveAz)}° {getAzimuthCardinal(effectiveAz)}
                  </Text>
                </View>
              </View>

              {/* 하단 4:3 시뮬레이터 박스 (실시간 동기화) */}
              <View style={[styles.simBox, { width: BOX_WIDTH, height: BOX_HEIGHT }]}>
                <SkyScene3D
                  ref={sky3dRef}
                  sim={cameraSimState}
                  currentTime={currentTime}
                  sunAltitude={sunPos.altitude}
                  sunAzimuth={sunPos.azimuth}
                  prediction={currentPrediction}
                  location={{ latitude, longitude }}
                  interpolatedWeather={weatherCacheList && weatherCacheList.length > 0 ? getInterpolatedWeather(weatherCacheList[0].data, currentTime) : []}
                  theme={{ accent: '#FF9800' }}
                  cameraAzimuthProp={effectiveAz}
                  cameraElevationProp={effectivePitch}
                  fovProp={currentFov}
                  fullScreen={true}
                  hideHudOverlay={true}
                  hideCompassBar={true}
                  isActive={visible}
                />

                {/* 시뮬레이터 헤더 오버레이 배지 (가림/중복 없이 좌측 배지와 우측 단일 FOV 배지 분리) */}
                <View style={styles.simHeaderOverlay} pointerEvents="none">
                  <View style={[styles.viewHeaderBadge, { backgroundColor: 'rgba(0, 160, 255, 0.25)', borderColor: '#00E5FF' }]}>
                    <Aperture size={10} color="#00E5FF" />
                    <Text style={[styles.viewHeaderText, { color: '#00E5FF', fontSize: 9 }]}>3D SIM</Text>
                  </View>
                  <View style={styles.fovBadge}>
                    <Text style={styles.fovBadgeText}>FOV {Math.round(currentFov)}°</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* 3. 하단 고정 컨트롤 바 */}
            <View style={styles.bottomControlsBar}>
              <TouchableOpacity style={styles.sideBtn} onPress={handleSunSnap}>
                <Sun size={22} color="#FFD700" />
                <Text style={[styles.sideBtnText, { color: '#FFD700', fontWeight: '800' }]}>Sun-Snap</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.sideBtn} onPress={handleCalibrate}>
                <RotateCcw size={18} color="#FFF" />
                <Text style={styles.sideBtnText}>Calibrate</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.captureBtn, isCapturing && { opacity: 0.5 }]}
                onPress={handleCapture}
                disabled={isCapturing}
                activeOpacity={0.7}
              >
                {isCapturing ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <View style={styles.captureBtnInner} />
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.sideBtn} 
                onPress={() => setCameraFacing(prev => prev === 'back' ? 'front' : 'back')}
              >
                <RefreshCw size={18} color="#FFF" />
                <Text style={styles.sideBtnText}>Flip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 촬영 성공 오버레이 */}
        {captureResult && (
          <View style={styles.captureOverlay}>
            <Check size={48} color="#4CAF50" />
            <Text style={styles.captureSuccessText}>업로드 성공!</Text>
          </View>
        )}


        {/* 게시물 미리보기 & 자동 공개 SNS 공유 모달 */}
        <PostDetailModal
          visible={!!uploadedPhotoForModal}
          photo={uploadedPhotoForModal}
          onClose={() => {
            setUploadedPhotoForModal(null);
            onClose(); // 상세 모달 닫을 때 카메라 모달도 함께 클로즈
          }}
        />
      </View>
    </Modal>
  );
};

// 장면 유형별 색상
const getSceneColor = (sceneType: EnhancementParams['sceneType']): string => {
  switch (sceneType) {
    case 'clear_golden': return '#FFD700';
    case 'dramatic': return '#FF6B3F';
    case 'partial_sun': return '#FFA64D';
    case 'overcast': return '#9AA1AA';
  }
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    gap: 16,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFF',
    marginTop: 16,
  },
  permissionDesc: {
    fontSize: 14,
    color: '#AAA',
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionBtn: {
    backgroundColor: '#FFD700',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 30,
    marginTop: 12,
  },
  permissionBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
  },
  closeTextBtn: {
    marginTop: 12,
    padding: 12,
  },
  closeTextBtnText: {
    color: '#888',
    fontSize: 14,
  },
  topHud: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },
  eventText: {
    fontSize: 13,
    fontWeight: '800',
  },
  compassBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  compassText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  sideBtn: {
    alignItems: 'center',
    gap: 4,
    minWidth: 56,
  },
  sideBtnText: {
    color: '#FFF',
    fontSize: 10.5,
    fontWeight: '700',
  },
  captureBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3.5,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  captureBtnInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFF',
  },
  captureOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  captureSuccessText: {
    color: '#4CAF50',
    fontSize: 24,
    fontWeight: '900',
  },
  captureSubText: {
    color: '#AAA',
    fontSize: 13,
  },
  warningBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 96,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(211, 47, 47, 0.85)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    zIndex: 150,
  },
  warningText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  manualTuningPanel: {
    position: 'absolute',
    bottom: 230,
    left: 40,
    right: 40,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  tuningTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tuningButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  tuningBtn: {
    width: 42,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tuningBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  tuningValueContainer: {
    minWidth: 40,
    alignItems: 'center',
  },
  tuningValueText: {
    color: '#FFD700',
    fontSize: 13,
    fontWeight: '800',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    paddingBottom: 40,
  },
  previewScrollContent: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  previewTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  compareImagesRow: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
  },
  compareImageWrapper: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: 16,
    backgroundColor: '#1E1E2A',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  compareImage: {
    flex: 1,
    resizeMode: 'cover',
  },
  compareImageLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 6,
  },
  weatherQrCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.25)',
    marginVertical: 10,
    gap: 10,
  },
  weatherQrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  weatherQrTitle: {
    color: '#00E5FF',
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  weatherQrBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qrPlateWrapper: {
    backgroundColor: '#FFF',
    padding: 4,
    borderRadius: 8,
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  weatherQrMetaList: {
    flex: 1,
    gap: 5,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  metaLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
    fontWeight: '600',
  },
  metaValue: {
    color: '#FFF',
    fontSize: 10.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  qrExplanationText: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 9,
    lineHeight: 12.5,
    marginTop: 2,
  },
  scoreCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 18,
    marginVertical: 12,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scoreLabel: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
    minWidth: 70,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  scoreNumberText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '900',
    minWidth: 40,
    textAlign: 'right',
  },
  weatherSummary: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
  },
  weatherSummaryText: {
    color: '#AAA',
    fontSize: 11,
    fontWeight: '600',
  },
  previewBtnRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
  },
  previewRetakeBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewRetakeText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  previewUploadBtn: {
    flex: 2,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFD700',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewUploadText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '900',
  },
  privacyNoticeContainer: {
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 82, 82, 0.25)',
    marginVertical: 10,
  },
  privacyNoticeText: {
    color: '#FF8A80',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  zoomIndicatorContainer: {
    position: 'absolute',
    top: '15%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    zIndex: 200,
  },
  zoomIndicatorText: {
    color: '#FFD700',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  exposureSliderWrapper: {
    position: 'absolute',
    right: 12,
    top: '20%',
    height: 140,
    width: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    zIndex: 20,
  },
  exposureIconTop: {
    marginBottom: 2,
  },
  exposureIconBottom: {
    marginTop: 2,
  },
  exposureSliderTrackContainer: {
    flex: 1,
    width: 24,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  exposureTrack: {
    position: 'absolute',
    width: 3,
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 1.5,
  },
  exposureActiveBar: {
    position: 'absolute',
    bottom: 0,
    width: 3,
    backgroundColor: '#FFD700',
    borderRadius: 1.5,
  },
  exposureKnob: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FFD700',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  arLayerChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(22, 19, 26, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  arLayerChipActive: {
    backgroundColor: 'rgba(255, 140, 0, 0.85)',
    borderColor: '#FF8C00',
  },
  arLayerChipText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    fontWeight: 'bold',
  },
  arLayerChipTextActive: {
    color: '#FFF',
    fontWeight: '900',
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topHudBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 52 : 36,
    paddingBottom: 4,
    zIndex: 50,
  },
  warningBannerFloating: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 96 : 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 100,
  },
  dualViewCenter: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  cameraBox: {
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  simBox: {
    backgroundColor: '#03050C',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.25)',
  },
  cameraHeaderOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 15,
  },
  viewHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 0.8,
    borderColor: 'rgba(255, 215, 0, 0.5)',
  },
  viewHeaderText: {
    color: '#FFD700',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  enhancementBadgeCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 0.8,
    gap: 4,
  },
  enhancementTextCompact: {
    color: '#FFF',
    fontSize: 9.5,
    fontWeight: '700',
  },
  simHeaderOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 15,
  },
  fovBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 0.8,
    borderColor: 'rgba(0, 229, 255, 0.5)',
  },
  fovBadgeText: {
    color: '#00E5FF',
    fontSize: 9.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  zoomQuickRow: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    padding: 3,
    borderRadius: 14,
    borderWidth: 0.8,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    zIndex: 20,
  },
  zoomQuickBtn: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 8,
  },
  zoomQuickBtnActive: {
    backgroundColor: '#FFD700',
  },
  zoomQuickText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    fontWeight: '800',
  },
  zoomQuickTextActive: {
    color: '#000',
    fontWeight: '900',
  },
  zoomLiveBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderLeftWidth: 0.8,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  zoomLiveText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  compassRulerBar: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 6,
    borderWidth: 0.8,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#080C16',
  },
  compassCenterBadge: {
    position: 'absolute',
    top: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 0.6,
    borderColor: 'rgba(255, 215, 0, 0.4)',
  },
  compassCenterText: {
    color: '#FFD700',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  bottomControlsBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
    zIndex: 50,
  },
});
