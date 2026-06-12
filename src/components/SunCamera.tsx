import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, Modal, Animated,
  Dimensions, Platform, Alert, ActivityIndicator, Image
} from 'react-native';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Magnetometer, DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';
import Svg, { Circle, Path, Line, Text as SvgText, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { X, Camera, RotateCcw, Sun, Aperture, Check, RefreshCw, Star } from 'lucide-react-native';
import { Skia, rect, PaintStyle, ImageFormat } from '@shopify/react-native-skia';
import { generateSimulationImage } from '../utils/simulationImage';


import {
  getSunScreenPosition,
  getDaySunTrajectory,
  analyzeScene,
  EnhancementParams,
  GoldenTimeInfo,
  ScreenPoint,
  TrajectoryPoint,
} from '../utils/sunCamera';
import { getSunPosition } from '../utils/celestial';
import * as ImageManipulator from 'expo-image-manipulator';
import { useCelestialStore } from '../store/useCelestialStore';
import { auth } from '../config/firebase';
import { predictSunset } from '../utils/sunsetPhysics';
import { getInterpolatedWeather } from '../utils/weather';
import { t, Language, translateSunsetDesc } from '../utils/i18n';

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
  lang: Language
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

export const SunCamera: React.FC<SunCameraProps> = ({
  visible, onClose, latitude, longitude, currentTime, goldenTimeInfo,
}) => {
  const { width: W, height: H } = Dimensions.get('window');
  const { uploadAndPostPhoto, weatherCacheList, language } = useCelestialStore();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');

  // ── 센서 융합: Rotation Matrix 기반 정밀 Heading + Pitch 동시 추출 ──
  // Why: Heading(Location.watchHeadingAsync)과 Pitch(DeviceMotion.beta)를
  //      별도 센서 소스에서 비동기 수집하면 타이밍 디싱크로 AR 위치가 어긋남.
  //      DeviceMotion의 Euler angles(α,β,γ)에서 Rotation Matrix를 재구성하여
  //      카메라 전방 벡터를 직접 추출 → 동일 샘플에서 heading + pitch 동시 계산.
  const [deviceAzimuth, setDeviceAzimuth] = useState(0);
  const [devicePitch, setDevicePitch] = useState(0);
  const [hasInterference, setHasInterference] = useState(false);

  // 센서 실시간 Ref (리렌더 없이 최신값 유지)
  const deviceAzimuthRef = useRef(0);
  const devicePitchRef = useRef(0);

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
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureResult, setCaptureResult] = useState<string | null>(null);

  // 촬영 후 미리보기 상태
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [simPreviewUri, setSimPreviewUri] = useState<string | null>(null);

  // 점수 입력 상태
  const [landscapeScore, setLandscapeScore] = useState<number>(5);
  const [weatherScore, setWeatherScore] = useState<number>(5);

  // 업로드 중 상태
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // 촬영 당시 메타데이터 상태
  const [capturedWeatherInfo, setCapturedWeatherInfo] = useState<any>(null);
  const [capturedSimSample, setCapturedSimSample] = useState<any>(null);


  // 현재 태양 위치
  const sunPos = useMemo(() => {
    return getSunPosition(currentTime, latitude, longitude);
  }, [currentTime, latitude, longitude]);

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
  //      Rotation Matrix R = Rz(α)·Rx(β)·Ry(γ) 에서 카메라 전방 벡터를 직접 추출하면
  //      어떤 기기 자세에서도 정확한 heading/pitch를 얻을 수 있다.
  useEffect(() => {
    if (!visible) return;
    DeviceMotion.setUpdateInterval(16); // ~60fps for smooth AR tracking
    const sub = DeviceMotion.addListener((data) => {
      if (!data.rotation) return;

      const { alpha: aRad, beta: bRad, gamma: gRad } = data.rotation;

      // === W3C DeviceOrientation Rotation Matrix 재구성 ===
      // R = Rz(α) · Rx(β) · Ry(γ), 카메라 forward = (0, 0, -1) in device frame
      const sa = Math.sin(aRad), ca = Math.cos(aRad);
      const sb = Math.sin(bRad), cb = Math.cos(bRad);
      const sg = Math.sin(gRad), cg = Math.cos(gRad);

      // forward vector in Earth frame: R * (0, 0, -1)
      const fx = -(ca * sg + sa * sb * cg);
      const fy = -(sa * sg - ca * sb * cg);
      const fz = -(cb * cg);

      // Heading (방위각): atan2(East 성분, North 성분)
      const rawHeading = (Math.atan2(fx, fy) * 180 / Math.PI + 360) % 360;
      rawGyroHeadingRef.current = rawHeading;

      // 진북 보정 오프셋 적용
      const calibratedHeading = (rawHeading + northOffsetRef.current + 360) % 360;

      // Pitch (고도각): 수직 성분의 asin (양수 = 위를 향함)
      const rawPitch = Math.asin(Math.max(-1, Math.min(1, -fz))) * 180 / Math.PI;

      // === One Euro Filter 적용 ===
      const dt = 0.016; // 60fps
      const state = filterRef.current;

      if (!state.initialized) {
        const azRad = calibratedHeading * Math.PI / 180;
        state.prevAzX = Math.cos(azRad);
        state.prevAzY = Math.sin(azRad);
        state.prevPitch = rawPitch;
        state.initialized = true;
      }

      // --- Heading filter (2D 단위벡터, 360° 경계 튐 방지) ---
      const azRad = calibratedHeading * Math.PI / 180;
      const tx = Math.cos(azRad);
      const ty = Math.sin(azRad);

      // DeviceMotion은 이미 자이로 융합이라 노이즈가 적음 → 필터를 가볍게
      const dcutoff = 1.0;
      const minCutoff_az = 0.8;   // 자이로 융합 데이터에 맞게 완화 (0.08 → 0.8)
      const beta_az = 0.4;        // 빠른 회전 추종 (0.015 → 0.4)

      const dxX = (tx - state.prevAzX) / dt;
      const alphaDx = (2 * Math.PI * dt * dcutoff) / (1 + 2 * Math.PI * dt * dcutoff);
      state.prevAzDx += (dxX - state.prevAzDx) * alphaDx;

      const cutoffX = minCutoff_az + beta_az * Math.abs(state.prevAzDx);
      const alphaX = (2 * Math.PI * dt * cutoffX) / (1 + 2 * Math.PI * dt * cutoffX);
      state.prevAzX += (tx - state.prevAzX) * alphaX;

      const dxY = (ty - state.prevAzY) / dt;
      state.prevAzDy += (dxY - state.prevAzDy) * alphaDx;

      const cutoffY = minCutoff_az + beta_az * Math.abs(state.prevAzDy);
      const alphaY = (2 * Math.PI * dt * cutoffY) / (1 + 2 * Math.PI * dt * cutoffY);
      state.prevAzY += (ty - state.prevAzY) * alphaY;

      const filteredAz = (Math.atan2(state.prevAzY, state.prevAzX) * 180 / Math.PI + 360) % 360;

      // --- Pitch filter ---
      const minCutoff_p = 0.6;    // 자이로 데이터에 맞게 완화 (0.15 → 0.6)
      const beta_p = 0.3;         // 빠른 추종 (0.02 → 0.3)

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
            // 점진적 보정: 자이로 장기 드리프트만 천천히 교정 (tau ≈ 5초)
            let diff = rawOffset - northOffsetRef.current;
            diff = ((diff + 540) % 360) - 180;
            northOffsetRef.current += diff * 0.02;
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

  // 센서 캘리브레이션 초기화
  const handleCalibrate = useCallback(() => {
    filterRef.current.initialized = false;
    northOffsetInitialized.current = false; // 진북 보정도 리셋
    Alert.alert(t('calibratedTitle', language), t('calibratedMsg', language));
  }, [language]);

  // 오프셋 없이 물리 장치 방위각/고도각 그대로 사용
  const effectiveAz = useMemo(() => {
    return (deviceAzimuth + 360) % 360;
  }, [deviceAzimuth]);

  const effectivePitch = useMemo(() => {
    return Math.max(-90, Math.min(90, devicePitch));
  }, [devicePitch]);

  // 태양의 화면 좌표 계산
  const sunScreenPos = useMemo((): ScreenPoint => {
    return getSunScreenPosition(
      effectiveAz,
      effectivePitch,
      sunPos.azimuth,
      sunPos.altitude,
      60, // 수평 FOV (대부분의 스마트폰 카메라)
      80, // 수직 FOV
    );
  }, [effectiveAz, effectivePitch, sunPos.azimuth, sunPos.altitude]);

  // 태양 궤적의 화면 좌표 변환
  const trajectoryScreenPoints = useMemo(() => {
    return trajectory.map(pt => ({
      ...pt,
      screen: getSunScreenPosition(effectiveAz, effectivePitch, pt.azimuth, pt.altitude, 60, 80),
    }));
  }, [trajectory, effectiveAz, effectivePitch]);

  // 궤적 SVG 경로 생성
  const trajectoryPathD = useMemo(() => {
    if (trajectoryScreenPoints.length < 2) return '';

    let path = '';
    let lastX = 0;
    let isDrawing = false;

    trajectoryScreenPoints.forEach((p) => {
      // 카메라 뒤쪽에 있는 유령 좌표(NaN)는 그리거나 연결하지 않고 선을 끊습니다.
      if (isNaN(p.screen.x) || isNaN(p.screen.y)) {
        isDrawing = false;
        return;
      }

      const px = p.screen.x * W;
      const py = p.screen.y * H;

      if (!isDrawing) {
        path += ` M ${px.toFixed(1)} ${py.toFixed(1)}`;
        isDrawing = true;
      } else {
        // 탄젠트 무한 발산 임계점 등에서 화면 양 끝으로 순간이동하는 현상 감지
        const isScreenJump = Math.abs(px - lastX) > W * 1.5;

        if (isScreenJump) {
          path += ` M ${px.toFixed(1)} ${py.toFixed(1)}`;
        } else {
          path += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
        }
      }

      lastX = px;
    });

    return path.trim();
  }, [trajectoryScreenPoints, W, H]);
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

      // 날씨 데이터 추출 로직
      let humidity = 50;
      let pm25 = 22;
      let description = currentEnhancement.description || 'Clear';
      let cloudRatio = 0.5;

      const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371000;
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

      if (nearestWeather && nearestWeather.data && nearestWeather.data.length > 0) {
        const interpolated = getInterpolatedWeather(nearestWeather.data, currentTime);
        if (interpolated && interpolated.length > 0) {
          const obs = interpolated[0];
          humidity = obs.humidity != null ? Math.round(obs.humidity) : 50;
          
          const maxCloud = Math.max(obs.low ?? 0, obs.mid ?? 0, obs.high ?? 0);
          cloudRatio = maxCloud / 100;
          
          const prediction = predictSunset(
            nearestWeather.data,
            currentTime,
            sunPos.altitude,
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
      }

      // Skia 워터마크 스탬프 찍기
      const stampedUri = await stampPhoto(
        photo.uri,
        latitude,
        longitude,
        sunPos.altitude,
        humidity,
        pm25,
        description,
        language
      );

      // EXIF 메타데이터 구성 (태양 위치 물리값 및 이미지 인핸스먼트 지표 결합)
      const metadata = {
        UserComment: JSON.stringify({
          source: 'SolarPath AR Camera',
          timestamp: new Date().toISOString(),
          location: { latitude, longitude },
          sun: { altitude: sunPos.altitude, azimuth: sunPos.azimuth },
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

      // 1. 백그라운드에서 시뮬레이션 예측 이미지 생성
      // seed: 촬영 위치 + 시각 기반으로 매번 다른 구름 배치 생성
      let simUri = '';
      try {
        const seed = Math.round(latitude * 1000 + longitude * 100 + currentTime.getTime() / 60000);
        simUri = await generateSimulationImage(
          sunPos.altitude,
          cloudRatio,
          seed
        );
      } catch (simErr) {
        console.error('Failed to generate simulation image:', simErr);
      }

      // 2. 메타데이터 수집
      const weatherInfo = {
        humidity,
        pm25,
        description
      };

      const simulationSample = {
        brightness: currentEnhancement.brightness,
        contrast: currentEnhancement.contrast,
        saturation: currentEnhancement.saturation,
        warmth: currentEnhancement.warmth,
        sunAltitude: sunPos.altitude,
        sunAzimuth: sunPos.azimuth
      };

      // 3. 임시 상태에 저장하여 프리뷰 화면 전환
      setCapturedWeatherInfo(weatherInfo);
      setCapturedSimSample(simulationSample);
      setPreviewUri(stampedUri);
      setSimPreviewUri(simUri);
      
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
    setIsUploading(true);

    try {
      // 1. 휴대폰 갤러리에 저장
      let savedToLibrary = false;
      if (mediaPermission?.granted) {
        await MediaLibrary.saveToLibraryAsync(previewUri);
        savedToLibrary = true;
      } else {
        const { granted } = await requestMediaPermission();
        if (granted) {
          await MediaLibrary.saveToLibraryAsync(previewUri);
          savedToLibrary = true;
        } else {
          Alert.alert(t('permissionRequired', language), t('galleryPermissionRequiredMsg', language));
          setIsUploading(false);
          return;
        }
      }

      // 2. 서버 업로드 및 지도 데이터베이스 연동
      const user = auth.currentUser;
      if (user && savedToLibrary) {
        // expo-image-manipulator를 통한 대폭 압축 및 리사이징 (width 600, compress 0.4)
        const manipulated = await ImageManipulator.manipulateAsync(
          previewUri,
          [{ resize: { width: 600 } }],
          { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG }
        );

        // 시뮬레이션 사진 압축
        let manipulatedSimUri = undefined;
        if (simPreviewUri) {
          try {
            const manipulatedSim = await ImageManipulator.manipulateAsync(
              simPreviewUri,
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
        const uploadedLocationName = await uploadAndPostPhoto(
          manipulated.uri,
          latitude,
          longitude,
          locationName,
          landscapeScore,
          weatherScore,
          capturedWeatherInfo,
          capturedSimSample,
          manipulatedSimUri
        );
        Alert.alert(t('uploadSuccess', language), t('uploadSuccessWithLocation', language).replace('{location}', uploadedLocationName));
      } else if (!user) {
        Alert.alert(t('saveSuccess', language), t('saveSuccessMsg', language));
      }

      // 성공 후 상태 초기화 및 닫기
      setCaptureResult(previewUri);
      setTimeout(() => {
        setCaptureResult(null);
        setPreviewUri(null);
        setSimPreviewUri(null);
        setIsUploading(false);
        onClose(); // 업로드 완료 후 카메라 화면 닫기
      }, 1500);

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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {previewUri ? (
          // 촬영 후 미리보기 & 평가 입력 화면
          <View style={styles.previewContainer}>
            <Text style={styles.previewTitle}>{t('recordSunset', language)}</Text>
            
            {/* 이미지 비교 영역 */}
            <View style={styles.compareImagesRow}>
              <View style={styles.compareImageWrapper}>
                <Image source={{ uri: previewUri }} style={styles.compareImage} />
                <Text style={styles.compareImageLabel}>{t('actualLandscape', language)}</Text>
              </View>
              {simPreviewUri ? (
                <View style={styles.compareImageWrapper}>
                  <Image source={{ uri: simPreviewUri }} style={styles.compareImage} />
                  <Text style={styles.compareImageLabel}>{t('simulationPrediction', language)}</Text>
                </View>
              ) : null}
            </View>

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

            {/* 제어 버튼 영역 */}
            <View style={styles.previewBtnRow}>
              <TouchableOpacity 
                style={styles.previewRetakeBtn} 
                onPress={() => {
                  setPreviewUri(null);
                  setSimPreviewUri(null);
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
          </View>
        ) : (
          // 기존 카메라 뷰 및 AR 오버레이
          <>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={cameraFacing}
            />

            {/* AR 오버레이 */}
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              {currentEnhancement.warmth > 0 && (
                <>
                  <Defs>
                    <LinearGradient id="sunsetGlow" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor="#FF8C00" stopOpacity={Math.min(0.12, currentEnhancement.warmth * 0.2)} />
                      <Stop offset="50%" stopColor="#FF4500" stopOpacity={Math.min(0.18, currentEnhancement.warmth * 0.3)} />
                      <Stop offset="100%" stopColor="#8A2BE2" stopOpacity={Math.min(0.08, currentEnhancement.warmth * 0.15)} />
                    </LinearGradient>
                  </Defs>
                  <Rect width={W} height={H} fill="url(#sunsetGlow)" />
                </>
              )}

              {trajectoryPathD.length > 0 && (
                <Path
                  d={trajectoryPathD}
                  stroke="rgba(255,215,0,0.35)"
                  strokeWidth={2}
                  strokeDasharray="6,4"
                  fill="none"
                />
              )}

              {trajectoryScreenPoints
                .filter((_, i) => i % 6 === 0)
                .filter(p => p.screen.isVisible)
                .map((p, i) => {
                  const px = p.screen.x * W;
                  const py = p.screen.y * H;
                  const hour = p.time.getHours();
                  return (
                    <React.Fragment key={`tick-${i}`}>
                      <Circle cx={px} cy={py} r={3} fill="rgba(255,215,0,0.5)" />
                      <SvgText
                        x={px}
                        y={py - 10}
                        fill="rgba(255,255,255,0.7)"
                        fontSize={10}
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {`${hour}:00`}
                      </SvgText>
                    </React.Fragment>
                  );
                })}

              {(() => {
                const horizonY = getSunScreenPosition(effectiveAz, effectivePitch, effectiveAz, 0, 60, 80).y * H;
                if (horizonY > 0 && horizonY < H) {
                  return (
                    <Line
                      x1={0} y1={horizonY} x2={W} y2={horizonY}
                      stroke="rgba(255,255,255,0.15)"
                      strokeWidth={1}
                      strokeDasharray="10,5"
                    />
                  );
                }
                return null;
              })()}

              {sunScreenPos.isVisible && sunPos.altitude > -5 && (
                <>
                  <Circle
                    cx={sunScreenPos.x * W}
                    cy={sunScreenPos.y * H}
                    r={30}
                    fill="rgba(255,200,50,0.12)"
                  />
                  <Circle
                    cx={sunScreenPos.x * W}
                    cy={sunScreenPos.y * H}
                    r={18}
                    fill="rgba(255,215,0,0.2)"
                  />
                  <Circle
                    cx={sunScreenPos.x * W}
                    cy={sunScreenPos.y * H}
                    r={8}
                    fill="#FFD700"
                    stroke="rgba(255,160,0,0.6)"
                    strokeWidth={2}
                  />
                  <SvgText
                    x={sunScreenPos.x * W}
                    y={sunScreenPos.y * H + 28}
                    fill="#FFD700"
                    fontSize={11}
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {`${sunPos.altitude.toFixed(1)}°`}
                  </SvgText>
                </>
              )}
            </Svg>

            {hasInterference && (
              <View style={styles.warningBanner}>
                <Text style={styles.warningText}>
                  ⚠️ Magnetic Interference! Move your phone in an "8" shape to calibrate.
                </Text>
              </View>
            )}

            {/* 상단 HUD */}
            <View style={styles.topHud}>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <X size={24} color="#FFF" />
              </TouchableOpacity>

              <View style={styles.eventBadge}>
                <Sun size={14} color={eventColor} />
                <Text style={[styles.eventText, { color: eventColor }]}>
                  {eventLabel} {isBeforeEvent ? `${minutesBefore}m before` : `${minutesBefore}m after`}
                </Text>
              </View>

              <View style={styles.compassBadge}>
                <Text style={styles.compassText}>
                  {Math.round(effectiveAz)}° | {Math.round(effectivePitch)}°↑
                </Text>
              </View>
            </View>

            {/* 보정 정보 패널 */}
            <View style={styles.enhancementPanel}>
              <View style={[styles.enhancementBadge, { borderColor: getSceneColor(currentEnhancement.sceneType) }]}>
                <Aperture size={12} color={getSceneColor(currentEnhancement.sceneType)} />
                <Text style={styles.enhancementText}>{currentEnhancement.description}</Text>
              </View>
              <View style={styles.enhancementDetails}>
                <EnhancementIndicator label="Brightness" value={currentEnhancement.brightness} />
                <EnhancementIndicator label="Contrast" value={currentEnhancement.contrast - 1} />
                <EnhancementIndicator label="Saturation" value={currentEnhancement.saturation - 1} />
                <EnhancementIndicator label="Warmth" value={currentEnhancement.warmth} />
              </View>
            </View>



            {/* 하단 컨트롤 */}
            <View style={styles.bottomControls}>
              <TouchableOpacity style={styles.sideBtn} onPress={handleCalibrate}>
                <RotateCcw size={22} color="#FFF" />
                <Text style={styles.sideBtnText}>Calibrate</Text>
              </TouchableOpacity>

              {(() => {
                const isCaptureDisabled = isCapturing || !goldenTimeInfo.isActive;
                return (
                  <>
                    {!goldenTimeInfo.isActive && (
                      <Text style={styles.captureDisabledHint}>
                        {goldenTimeInfo.type === 'sunrise'
                          ? `일출 골든타임 밖 (±60–90min)`
                          : `일몰 골든타임 밖 (±60–90min)`}
                      </Text>
                    )}
                    <TouchableOpacity
                      style={[styles.captureBtn, isCaptureDisabled && { opacity: 0.3 }]}
                      onPress={handleCapture}
                      disabled={isCaptureDisabled}
                      activeOpacity={0.7}
                    >
                      {isCapturing ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <View style={styles.captureBtnInner} />
                      )}
                    </TouchableOpacity>
                  </>
                );
              })()}

              <TouchableOpacity 
                style={styles.sideBtn} 
                onPress={() => setCameraFacing(prev => prev === 'back' ? 'front' : 'back')}
              >
                <RefreshCw size={22} color="#FFF" />
                <Text style={styles.sideBtnText}>Flip</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* 촬영 성공 오버레이 */}
        {captureResult && (
          <View style={styles.captureOverlay}>
            <Check size={48} color="#4CAF50" />
            <Text style={styles.captureSuccessText}>업로드 성공!</Text>
          </View>
        )}
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

// 보정 수치 인디케이터
const EnhancementIndicator: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const percent = Math.round(value * 100);
  const color = percent > 0 ? '#FFD700' : percent < 0 ? '#6BA3FF' : '#888';
  const sign = percent > 0 ? '+' : '';

  return (
    <View style={styles.indicator}>
      <Text style={styles.indicatorLabel}>{label}</Text>
      <Text style={[styles.indicatorValue, { color }]}>{sign}{percent}%</Text>
    </View>
  );
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
  enhancementPanel: {
    position: 'absolute',
    bottom: 160,
    left: 16,
    right: 16,
    alignItems: 'center',
    gap: 8,
  },
  enhancementBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  enhancementText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  enhancementDetails: {
    flexDirection: 'row',
    gap: 16,
  },
  indicator: {
    alignItems: 'center',
    gap: 2,
  },
  indicatorLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  indicatorValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  bottomControls: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  sideBtn: {
    alignItems: 'center',
    gap: 6,
    minWidth: 60,
  },
  sideBtnText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  captureBtnInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF',
  },
  captureDisabledHint: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    color: 'rgba(255,200,80,0.9)',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
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
});
