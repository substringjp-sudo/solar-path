import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EARTH_RADIUS_M } from '../utils/earth';
import {
  StyleSheet, View, Text, Modal,
  Dimensions, Platform, Alert, ActivityIndicator, Image, PanResponder, ScrollView
} from 'react-native';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
import { localDateString } from '../utils/localDate';
import { weatherCacheKey, findEntry, findNearestEntry } from '../utils/cachePolicy';
import { poseFromRotation, compassToCameraHeading, type DevicePose } from '../utils/devicePose';
import { pickTerrainForLocation, fallbackTerrain } from '../utils/terrainPick';
import { findPresetTerrain } from '../utils/presetTerrains';
import { scenePrediction } from '../utils/scenePrediction';
import { createHeadingFusion, type HeadingFusionStatus } from '../utils/headingFusion';
import { analyzeFrame, attitudeFromEuler, intrinsicsFromHfov, apparentAltitude, wrap360, type Attitude, type HorizonProfile } from '../utils/arVision';
import { loadHorizon, frameFromPhoto, hfovFromExif } from '../utils/arVisionNative';
import * as MediaLibrary from 'expo-media-library';
import { Magnetometer, DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';
import { X, Camera, RotateCcw, Sun, Check, RefreshCw, Star, QrCode } from 'lucide-react-native';
import { Skia, rect, PaintStyle, ImageFormat } from '@shopify/react-native-skia';
import { buildSimReportPayload, encodeSimReportPayload } from '../utils/simReport';
import { resolveLayerWinds } from '../utils/skyColumn';
import { isTimelineUsable, dateKeyOf } from '../utils/skyTimeline';
import { SimReportQR } from './SkyScreen/SimReportQR';


import {
  analyzeScene,
  GoldenTimeInfo,
} from '../utils/sunCamera';
import { getSunPosition, getMoonPosition, getCelestialEvents } from '../utils/celestial';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { useCelestialStore, MyPhoto } from '../store/useCelestialStore';
import { auth } from '../config/firebase';
import { predictSunset } from '../utils/sunsetPhysics';
import { getInterpolatedWeather, fetchDayWeatherRing } from '../utils/weather';
import { t, Language, translateSunsetDesc, L3 } from '../utils/i18n';
import { PostDetailModal } from './PostDetailModal';
import { SkyScene3D, type SkyScene3DHandle, type SkyRenderState } from './SkyScene3D';
import { PressScale } from './ui';
import { color, radius, space, type, TOUCH } from '../theme/tokens';
import { SunPathOverlay } from './SunPathOverlay';
import { hapticShutter, hapticError } from '../utils/haptics';
import { previewOptics, sunDayPath, nextSunEvent, DEFAULT_SENSOR_SHORT_FOV_DEG } from '../utils/cameraOverlay';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/**
 * 촬영 결과 화면의 QR 한 변(pt). 시선·구름판 상태를 실어 모듈이 93칸 안팎입니다 — 캡처를 1080px
 * 에서 절반쯤 줄여 보내도 모듈 하나가 3px 넘게 남도록 화면 폭의 60% 안에서 크게 잡습니다.
 */
const QR_RESULT_SIZE_PT = Math.min(220, Math.round(SCREEN_WIDTH * 0.6));

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
  pm25: number | null,
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
      paintBorder.setColor(Skia.Color(color.sun));
      canvas.drawRRect(Skia.RRectXY(rect(boxX, boxY, boxW, boxH), 16, 16), paintBorder);

      let currY = boxY + fontSize * 1.8;
      const stepY = fontSize * 1.35;

      paintText.setColor(Skia.Color(color.sun));
      canvas.drawText('SOLAR PATH HUD', boxX + 16, currY, paintText, fontHeader);

      currY += stepY * 1.1;
      paintText.setColor(Skia.Color(color.text));
      const locLabel = L3(lang, '위치', 'Location', '位置');
      canvas.drawText(`${locLabel}: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`, boxX + 16, currY, paintText, font);

      currY += stepY;
      const altLabel = L3(lang, '태양 고도', 'Sun Alt', '太陽高度');
      canvas.drawText(`${altLabel}: ${sunAlt.toFixed(1)}°`, boxX + 16, currY, paintText, font);

      currY += stepY;
      const humLabel = L3(lang, '습도', 'Humidity', '湿度');
      const dustLabel = L3(lang, '초미세먼지', 'PM2.5', 'PM2.5');
      canvas.drawText(`${humLabel}: ${humidity}%  |  ${dustLabel}: ${pm25 != null ? `${pm25}㎍` : '—'}`, boxX + 16, currY, paintText, font);

      currY += stepY;
      paintText.setColor(Skia.Color('#00FFCC'));
      const condLabel = L3(lang, '하늘 상태', 'Sky Condition', '空の状態');
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


/** 아래 도킹 단추(아이콘 칸 40 + 글자) 크기 · 셔터 지름 · 위 여백 — "예측 보기" 칸 자리 계산과 스타일이 함께 씁니다. */
const DOCK_BTN_W = 64;
const DOCK_BTN_H = 60;
const DOCK_PAD_TOP = 16;
const SHUTTER = 72;
/** 노출 막대 길이(px) — 끌기 계산과 스타일이 같은 값. */
const EXPOSURE_TRACK_H = 160;

export const SunCamera: React.FC<SunCameraProps> = ({
  visible, onClose, latitude, longitude, currentTime, goldenTimeInfo,
}) => {
  const { width: W, height: H } = Dimensions.get('window');
  // 전체 화면 카메라 — 무대(카메라) + 아래 도킹. 무대 크기는 3D 예측의 GL 크기이기도 해서 바뀌지 않게 둡니다.
  const TOP_INSET = Platform.OS === 'ios' ? 52 : 32;
  const DOCK_H = Platform.OS === 'ios' ? 152 : 136;
  const stageH = H - DOCK_H;
  /** 방위 눈금 · 배율 줄의 자리(무대 아래에서) */
  const RULER_FROM_BOTTOM = 112;
  const ZOOM_FROM_BOTTOM = 64;
  /** "예측 보기" 단추의 살아 있는 3D 칸 — 도킹 스타일(dockBtn 64 · 칸 40 · 좌우 16)과 맞춘 자리 */
  const THUMB = TOUCH;
  const thumbX = W - space.lg - DOCK_BTN_W + (DOCK_BTN_W - THUMB) / 2;
  const thumbY = stageH + DOCK_PAD_TOP + (SHUTTER - DOCK_BTN_H) / 2;

  const { uploadAndPostPhoto, weatherCacheList, addWeatherCache, terrainCacheList, language } = useCelestialStore();
  // 하늘 화면과 같은 레이어·하늘 설정으로 그립니다(스토어 공유).
  const skyLayers = useCelestialStore(s => s.skyLayers);
  const skySettings = useCelestialStore(s => s.skySettings);
  // 카메라 화면 내 3D 시뮬레이터도 메인과 동일한 볼륨 하늘로 통일합니다.
  const camSkySettings = useMemo(() => ({
    ...skySettings,
    volumetricSky: true,
  }), [skySettings]);
  // 하늘 화면이 만든 하루치 하늘(360° 고리 기상). 같은 장소·날짜일 때만 씁니다 — 아니면 카메라가 따로 받은
  // 360° 고리 기상(camInterpolated, 절대 방위 = 중심 0)으로 그립니다.
  const sharedTimeline = useCelestialStore(s => s.skyTimeline);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions({ writeOnly: true });
  const cameraRef = useRef<CameraView>(null);

  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const [zoom, setZoom] = useState(0); // 0 (1.0x) ~ 1 (5.0x)
  const [exposure, setExposure] = useState(0); // -1.0 ~ 1.0 (디폴트 0)

  // 줌 배율 M: 1.0x (zoom=0) ~ 5.0x (zoom=1)
  const currentMagnification = useMemo(() => {
    return 1.0 + zoom * 4.0;
  }, [zoom]);

  // 화각은 이제 **화면을 채운 미리보기**에서 셉니다(`cameraOverlay.previewOptics`). 예전에는 세로 60° 를 근거 없이
  // 박아 4:3 상자의 시뮬레이터에 넘겼습니다(SKY_REBUILD_PLAN 49.3절). 지금은 센서 짧은 변 화각 — 화면 보정이
  // 사진 EXIF 로 잰 값(`measuredHfov`), 없으면 26mm 환산 기본값 — 에 cover 자르기와 배율을 반영합니다.
  // ⚠ 기본값과 cover 는 기기에서 확인해야 합니다(docs/CAMERA_FULLSCREEN_CHECK.md).

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
  const EXPOSURE_SLIDER_HEIGHT = EXPOSURE_TRACK_H;
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
  const [hasInterference, setHasInterference] = useState(false);

  // 센서 실시간 Ref (리렌더 없이 최신값 유지)
  const deviceAzimuthRef = useRef(0);
  const devicePitchRef = useRef(0);
  const deviceRotationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  /**
   * 가장 최근 기기 자세. 나침반 값을 **카메라 기준**으로 옮기는 데 씁니다 —
   * `watchHeadingAsync` 는 상단 모서리 방위를 주므로 그대로 쓰면 하늘을 겨눌 때
   * 180° 뒤집힙니다(`utils/devicePose.ts`).
   */
  const posePoseRef = useRef<DevicePose | null>(null);

  // 자기계 raw Ref
  const magRef = useRef({ x: 0, y: 0, z: 0 });

  // ── 자이로·자기 방위 융합 ────────────────────────────────────────────
  //
  // ⚠ 예전에는 이 논리가 여기 흩어져 있었고 결함이 넷 있었습니다:
  //   ① rawGyroHeadingRef 가 0 으로 시작하는데 자기 콜백이 자이로 도착을
  //      확인 안 하고 첫 표본으로 오프셋을 확정 — 자기 쪽이 먼저 오면
  //      통째로 어긋납니다(판정에서 46.4° 재현).
  //   ② 폰이 누워 있어 방위가 무의미한 자세도 그대로 씨앗으로 씀.
  //   ③ 표본 하나로 확정.
  //   ④ 보정률 0.001 — 잘못 잡히면 표본 1000개(2~3분) 동안 그대로.
  //      "8자로 흔들어도 잘 안 맞는다" 가 이것입니다.
  // 이제 utils/headingFusion 이 맡고, 가짜 센서 열로 판정합니다
  // (verify-heading-fusion.js).
  const fusionRef = useRef(createHeadingFusion());
  // ── 화면 인식 보정 (docs/AR_VISION_PLAN.md) ──
  // 원시 회전값(보정 전 α)과 자이로 속도 — 사진을 찍는 순간의 센서 자세를 기록하려고 둡니다.
  const rawRotationRef = useRef<{ a: number; b: number; g: number } | null>(null);
  const angularSpeedRef = useRef(0);
  const horizonRef = useRef<HorizonProfile | null>(null);
  const [visionStatus, setVisionStatus] = useState<string | null>(null);
  const [isVisionRunning, setIsVisionRunning] = useState(false);
  /** 사진 EXIF 로 잰 이 폰 카메라의 가로 화각(세로로 든 사진 기준). 표시만 합니다. */
  const [measuredHfov, setMeasuredHfov] = useState<number | null>(null);
  const [headingStatus, setHeadingStatus] = useState<HeadingFusionStatus | null>(null);

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

  // 촬영 후 미리보기 상태
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [simPreviewUri, setSimPreviewUri] = useState<string | null>(null);
  /** 3D 썸네일을 못 만든 이유. 칸을 조용히 지우지 않고 여기 적습니다. */
  const [simPreviewError, setSimPreviewError] = useState<string | null>(null);
  /** §165 셔터 때 볼륨 하늘이 준비 전이어서 스냅샷을 쓰지 않음 — 카드 머리글을 "3D 준비 중" 으로 */
  const [simNotReady, setSimNotReady] = useState(false);
  /** 스냅샷 직전 GL 버퍼 밝기(0~255, −1 = 못 쟀음). 검은 썸네일 진단용. */
  const [simBufferMean, setSimBufferMean] = useState<number>(-1);
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

  // ── 이 자리·이 날짜의 날씨 ──
  // ⚠ 예전에는 `weatherCacheList[0]` — **가장 최근에 저장된 항목** — 을 그대로 썼습니다.
  //   캐시는 새 항목을 앞에 넣으므로, 다른 곳(예: 전날 본 여행지)을 마지막으로 봤으면
  //   그곳 날씨로 카메라 하늘을 그렸고, 날짜가 어긋나면 보간이 비어 구름 0 인 맑은 밤이
  //   됐습니다(마쓰모토 흐린 보름밤에 카메라만 별이 보이던 것, §99).
  //   SkyScreen 과 같은 규칙(자리 0.05°, 같은 날짜)으로 고르고, 없으면 받아서 캐시에 넣습니다.
  const camDateStr = localDateString(currentTime);
  // 이 자리 것이 없으면 같은 날짜의 가장 가까운(30km 안) 예보로 그리고, 이 자리 것은 따로 받습니다
  // (§115 — 5km 옮기자 날씨를 못 찾아 흐린 밤이 별하늘이 됐습니다).
  const camExactWeather = useMemo(() => {
    const hit = findEntry(weatherCacheList as any, latitude, longitude, camDateStr) as any;
    return hit && Array.isArray(hit.data) && hit.data.length > 0 ? hit.data : null;
  }, [weatherCacheList, latitude, longitude, camDateStr]);
  const camWeatherData = useMemo(() => {
    if (camExactWeather) return camExactWeather;
    const near = findNearestEntry(weatherCacheList as any, latitude, longitude, camDateStr) as any;
    return near && Array.isArray(near.data) && near.data.length > 0 ? near.data : null;
  }, [camExactWeather, weatherCacheList, latitude, longitude, camDateStr]);
  // 받기 상태는 ref 로 둡니다 — 효과가 다시 돌 때(GPS 흔들림 등) 진행 중인 요청을 버리거나 같은 요청을
  // 거듭 보내지 않게. 실패하면 1분 뒤 다시 시도합니다. 예전에는 한 번 실패하면 그 자리·날짜로는 다시
  // 안 받아, 호숫가에서 통신이 한 번 끊긴 뒤로 촬영하기 하늘이 계속 맑았습니다(§115).
  const camWeatherInflightRef = useRef('');
  const camWeatherFailedAtRef = useRef<Record<string, number>>({});
  const camWeatherRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [camWeatherRetryTick, setCamWeatherRetryTick] = useState(0);
  useEffect(() => () => { if (camWeatherRetryTimerRef.current) clearTimeout(camWeatherRetryTimerRef.current); }, []);
  useEffect(() => {
    if (!visible || camExactWeather || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if (latitude === 0 && longitude === 0) return;
    const key = weatherCacheKey(latitude, longitude, camDateStr);
    if (camWeatherInflightRef.current === key) return;   // 이미 받는 중 (429 방지)
    const RETRY_MS = 60_000;
    const scheduleRetry = (ms: number) => {
      if (camWeatherRetryTimerRef.current) clearTimeout(camWeatherRetryTimerRef.current);
      camWeatherRetryTimerRef.current = setTimeout(() => setCamWeatherRetryTick(t => t + 1), ms);
    };
    const failedAt = camWeatherFailedAtRef.current[key];
    if (failedAt && Date.now() - failedAt < RETRY_MS) { scheduleRetry(RETRY_MS - (Date.now() - failedAt)); return; }
    camWeatherInflightRef.current = key;
    const at = new Date(currentTime.getTime());
    const lat = latitude, lon = longitude;
    // ⚠ 하늘 화면과 **같은 함수**(360° 고리, `fetchDayWeatherRing`)로 받습니다. 예전에는 해 방향 ±20° 부채꼴
    //   (`fetchSunsetWeather`)이라, 해에서 먼 쪽을 보면 구름이 비었고(카메라는 어느 쪽이나 봅니다) 같은 칸 키에 하늘
    //   화면의 고리와 서로 다른 모양의 자료가 먼저 들어가 두 화면의 구름이 갈라질 수 있었습니다.
    const fail = () => { camWeatherFailedAtRef.current[key] = Date.now(); scheduleRetry(RETRY_MS); };
    fetchDayWeatherRing(lat, lon, at)
      .then(data => {
        if (!Array.isArray(data) || data.length === 0 || (data as any)[0]?.isFallback) { fail(); return; }
        delete camWeatherFailedAtRef.current[key];
        // 받은 자리 좌표로 넣습니다 — 그 사이 옮겼어도 틀린 자리에 붙지 않습니다.
        addWeatherCache({ key, data, timestamp: Date.now(), latitude: lat, longitude: lon } as any);
      })
      .catch(err => { console.warn('[SunCamera] weather fetch failed:', err); fail(); })
      .finally(() => { if (camWeatherInflightRef.current === key) camWeatherInflightRef.current = ''; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, camExactWeather, latitude, longitude, camDateStr, camWeatherRetryTick]);

  // ── 오프스크린 시뮬레이터용 29개 다지점 공간 샘플링 시뮬레이션 상태 ──
  const cameraSimState = useMemo(() => {
    const pathData = camWeatherData ?? undefined;
    // ⚠ 예전에는 `terrain: { observerElevation: 50 }` 만 넘겼습니다. 그러면
    //   `SkyScene3D` 가 `sim.terrain.bandAngles` 를 못 찾아 `createTerrainBands`
    //   를 **아예 안 부릅니다** — AR 시뮬레이터와 촬영 썸네일에 산이 통째로
    //   안 나오던 원인입니다(§62). SkyScreen 과 **같은 스토어 캐시**를 봅니다.
    //   캐시가 없으면 예전처럼 빈 지형으로 물러납니다(산만 안 나올 뿐 나머지는 그립니다).
    // 하늘 화면과 같은 순서로 고릅니다: 내장 프리셋 → 캐시. (예전에는 프리셋을 건너뛰어, 프리셋이
    // 있는 자리에서 두 화면의 산이 달랐습니다.)
    const cachedTerrain = findPresetTerrain(latitude, longitude)
      ?? pickTerrainForLocation(terrainCacheList as any, latitude, longitude);
    return {
      pathData,
      azimuth: dynamicEventAzimuths.sunset,
      eventTime: currentTime,
      terrain: cachedTerrain ?? fallbackTerrain(),
    };
  }, [camWeatherData, currentTime, dynamicEventAzimuths.sunset, terrainCacheList, latitude, longitude]);

  // 3D 시뮬레이터 전달용 노을 예측 결과
  // SkyScene3D 가 읽는 모양(location.coords)으로 — 하늘 화면이 넘기는 expo-location 객체와 같은 꼴.
  const camSceneLocation = useMemo(
    () => ({ coords: { latitude, longitude } }),
    [latitude, longitude]
  );

  // 하늘 화면과 **같은 식**(scenePrediction) — 예전에는 시정 15km·습도 50%·고도 0 을 박았습니다.
  const camInterpolated = useMemo(
    () => (camWeatherData ? getInterpolatedWeather(camWeatherData, currentTime) : []),
    [camWeatherData, currentTime]
  );
  const camDateKey = dateKeyOf(currentTime);
  const camTimeline = useMemo(
    () => (isTimelineUsable(sharedTimeline, latitude, longitude, currentTime) ? sharedTimeline : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 날짜가 바뀔 때만 다시 봅니다
    [sharedTimeline, latitude, longitude, camDateKey]
  );
  const currentPrediction = useMemo(() => scenePrediction({
    pathData: camWeatherData ?? [],
    time: currentTime,
    sunAltDeg: sunPos.altitude,
    sunAzDeg: sunPos.azimuth,
    obs: camInterpolated[0],
    latitude,
    observerElevM: Number(cameraSimState.terrain?.observerElevation) || undefined,
  }), [camWeatherData, currentTime, sunPos.altitude, sunPos.azimuth, camInterpolated, latitude, cameraSimState.terrain?.observerElevation]);

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
      rawRotationRef.current = { a: aRad, b: bRad, g: gRad };
      const rr = dm.rotationRate;
      if (rr) angularSpeedRef.current = Math.hypot(rr.alpha ?? 0, rr.beta ?? 0, rr.gamma ?? 0);

      // W3C Rotation Matrix: R = Rz(α) * Rx(β) * Ry(γ)
      const sa = Math.sin(aRad), ca = Math.cos(aRad);
      const sb = Math.sin(bRad), cb = Math.cos(bRad);
      const sg = Math.sin(gRad), cg = Math.cos(gRad);

      // 카메라 전방 벡터 (화면 반대쪽 = -Z축)
      const fwdX = -(ca * sg + sa * sb * cg);
      const fwdY = -(sa * sg - ca * sb * cg);
      const fwdZ = -(cb * cg);

      // 나침반 값을 옮길 때 쓰도록 자세를 담아 둡니다.
      posePoseRef.current = poseFromRotation(aRad, bRad, gRad);

      // Raw heading (자이로 기준, 0=북, 시계방향)
      const rawHeading = (Math.atan2(fwdX, fwdY) * 180 / Math.PI + 360) % 360;
      // 전방 벡터의 **수평 길이** — 이게 짧으면(폰을 눕혀 천정·바닥을 보면)
      // 방위가 수치적으로 무의미하므로 융합이 그 표본을 씨앗으로 안 씁니다.
      const horiz = Math.sqrt(fwdX * fwdX + fwdY * fwdY);
      fusionRef.current.pushGyro(rawHeading, horiz);

      // 진북 보정 적용
      const calibratedHeading = fusionRef.current.heading() ?? rawHeading;

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
      const radOffset = (((fusionRef.current.status().offsetDeg) * Math.PI) / 180);
      const calibratedAlpha = (aRad + radOffset + 2 * Math.PI) % (2 * Math.PI);
      
      const currentRotation = {
        alpha: calibratedAlpha,
        beta: bRad,
        gamma: gRad,
      };
      deviceRotationRef.current = currentRotation;
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
          // ⚠ trueHeading 을 못 받으면 **자북**입니다 — 한국에서 약 8° 어긋
          //   납니다. 융합에 그 사실을 그대로 넘겨 화면이 알릴 수 있게 합니다.
          const isTrue = data.trueHeading !== -1;
          const rawCompass = isTrue ? data.trueHeading : data.magHeading;

          // ⚠ 이 값은 **기기 상단 모서리**의 방위입니다(expo-location 이
          //   getOrientation()[0] 을 그대로 넘깁니다). 카메라가 지평선 위를
          //   보면 상단 모서리가 뒤로 넘어가 180° 뒤집히므로, 자세에서 두 방위의
          //   차이를 꺼내 **카메라 기준으로 옮겨** 넣습니다. 폰을 정확히 세워
          //   나침반이 0/0 이 되는 자세면 null 이고, 그때는 아예 안 씁니다.
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
      if (subscription) {
        subscription.remove();
      }
    };
  }, [visible]);

  // 센서 캘리브레이션 초기화 (기본)
  const handleCalibrate = useCallback(() => {
    filterRef.current.initialized = false;
    fusionRef.current.reset();
    setHeadingStatus(fusionRef.current.status());
    Alert.alert(t('calibratedTitle', language), t('calibratedMsg', language));
  }, [language]);

  // ── 화면 인식 보정 — 산 능선·해·달로 방위를 맞춥니다 (docs/AR_VISION_PLAN.md) ─────────
  // 화면이 열리면 이 자리의 DEM 지평선을 미리 구해 둡니다(몇 초, 쉬어 가며).
  useEffect(() => {
    if (!visible || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    let cancelled = false;
    loadHorizon(latitude, longitude).then(h => { if (!cancelled) horizonRef.current = h; });
    return () => { cancelled = true; };
  }, [visible, latitude, longitude]);

  /** 사진을 찍는 **순간**의 센서 자세 — 방위는 지금 화면이 쓰는 융합 방위, 앙각·기울기는 원시 회전. */
  const sensorAttitudeNow = useCallback((): Attitude | null => {
    const raw = rawRotationRef.current;
    const heading = fusionRef.current.heading();
    if (!raw || heading == null) return null;
    const att = attitudeFromEuler(raw.a, raw.b, raw.g);
    return { ...att, yawDeg: heading };
  }, []);

  /**
   * 사진 한 장으로 보정을 풀고, 믿을 만하면 방위에 적용합니다. 반환: 사용자에게 보일 한 줄.
   * ⚠ 사진은 폰을 **세로로** 든 것만 씁니다 — 가로로 들면 저장된 사진이 돌아가 있어 화면 축과
   *   센서 축이 어긋납니다. 1배율만 씁니다(EXIF 초점거리가 디지털 줌을 반영하지 않을 수 있음).
   */
  const runVisionOnPhoto = useCallback(async (
    uri: string, exif: Record<string, unknown> | undefined, sensor: Attitude, speedDegS: number, when: Date,
  ): Promise<string> => {
    if (cameraFacing !== 'back') return L3(language, '뒤 카메라에서만 됩니다', 'Works with the back camera only', '背面カメラでのみ使えます');
    if (zoom > 0.001) return L3(language, '1배율에서만 됩니다', 'Works at 1× zoom only', '1倍ズームでのみ使えます');
    if (Math.abs(sensor.rollDeg) > 30) return L3(language, '폰을 세로로 들어 주세요', 'Hold the phone upright', 'スマホを縦に持ってください');
    if (speedDegS > 15) return L3(language, '폰을 멈춘 채 찍어 주세요', 'Hold still while shooting', '静止して撮影してください');
    const frame = await frameFromPhoto(uri);
    if (!frame) return L3(language, '사진을 읽지 못했습니다', "Couldn't read the photo", '写真を読み取れませんでした');
    const hfov = hfovFromExif(exif, frame.width, frame.height);
    if (hfov) setMeasuredHfov(hfov);
    const k = intrinsicsFromHfov(frame.width, frame.height, hfov ?? 66);
    const sun = getSunPosition(when, latitude, longitude);
    const moon = getMoonPosition(when, latitude, longitude);
    const a = analyzeFrame({
      frame, intrinsics: k, sensor, horizon: horizonRef.current,
      bodies: [
        { kind: 'sun', azDeg: wrap360(sun.azimuth), altDeg: apparentAltitude(sun.altitude) },
        { kind: 'moon', azDeg: wrap360(moon.azimuth), altDeg: moon.altitude },
      ],
    });
    const r = a.result;
    if (!r.yawObservable || r.confidence < 0.5) {
      if (!horizonRef.current && !a.body) return L3(language, '지형 자료를 아직 받는 중이거나, 해·달이 안 보입니다', 'Terrain still loading, or no Sun/Moon in view', '地形データの取得中か、太陽・月が見えません');
      return r.reason ? `${L3(language, '방위를 확정하지 못했습니다', 'Could not fix the heading', '方位を確定できませんでした')} — ${r.reason}` : L3(language, '방위를 확정하지 못했습니다', 'Could not fix the heading', '方位を確定できませんでした');
    }
    const now = fusionRef.current.heading();
    if (now == null) return L3(language, '방위 센서가 아직 준비되지 않았습니다', 'Heading sensor not ready yet', '方位センサーの準備中です');
    // 찍은 뒤 폰이 돌아갔어도 됩니다 — 보정은 방위 **오프셋**에 대한 것이라 지금 방위에 더합니다.
    fusionRef.current.snapTo(wrap360(now + r.dYaw));
    setHeadingStatus(fusionRef.current.status());
    const sunW = L3(language, '해', 'Sun', '太陽'), moonW = L3(language, '달', 'Moon', '月'), ridgeW = L3(language, '능선', 'ridgeline', '稜線');
    const by = a.body ? (a.body.kind === 'sun' ? sunW : moonW) + (r.samples ? ` + ${ridgeW}` : '') : ridgeW;
    const dy = `${r.dYaw >= 0 ? '+' : ''}${r.dYaw.toFixed(1)}°`;
    return L3(language, `${by}으로 방위를 ${dy} 맞췄습니다`, `Heading corrected ${dy} using ${by}`, `${by}で方位を${dy}補正しました`);
  }, [cameraFacing, zoom, latitude, longitude, language]);

  useEffect(() => {
    if (!visionStatus || isVisionRunning) return;
    const t = setTimeout(() => setVisionStatus(null), 5000);
    return () => clearTimeout(t);
  }, [visionStatus, isVisionRunning]);

  /** "화면 보정" 버튼 — 저화질로 한 장 찍어 바로 맞춥니다(셔터음 한 번). */
  const handleVisionCalibrate = useCallback(async () => {
    if (!cameraRef.current || isVisionRunning || isCapturing) return;
    setIsVisionRunning(true);
    setVisionStatus(L3(language, '화면을 읽는 중…', 'Reading the view…', '画面を解析中…'));
    try {
      const sensor = sensorAttitudeNow();
      const speed = angularSpeedRef.current;
      const when = new Date();
      if (!sensor) { setVisionStatus(L3(language, '방위 센서가 아직 준비되지 않았습니다', 'Heading sensor not ready yet', '方位センサーの準備中です')); return; }
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, exif: true, shutterSound: false });
      if (!photo?.uri) { setVisionStatus(L3(language, '사진을 찍지 못했습니다', "Couldn't take a photo", '写真を撮れませんでした')); return; }
      setVisionStatus(await runVisionOnPhoto(photo.uri, photo.exif, sensor, speed, when));
    } catch (e) {
      setVisionStatus(L3(language, '화면 보정에 실패했습니다', 'Auto-align failed', '画面補正に失敗しました'));
    } finally {
      setIsVisionRunning(false);
    }
  }, [isVisionRunning, isCapturing, sensorAttitudeNow, runVisionOnPhoto, language]);

  // ── Sun-Snap Calibration (태양 위치 기반 정밀 AR 보정) ──────────────────────────
  // 사용자가 화면 중앙에 태양(또는 일몰 방향)을 맞추고 탭하면
  // 실제 천문학적 태양 방위각(sunPos.azimuth)으로 AR 오버레이를 ±1° 이내로 정밀 맞춤.
  const handleSunSnap = useCallback(() => {
    const trueSunAz = sunPos.azimuth; // SunCalc 계산 방위각
    // 정답을 아는 경우라 오프셋을 바로 못 박습니다. 그 뒤로는 자기계가
    // 천천히만 끌어갑니다(융합이 그렇게 잡아 둡니다).
    fusionRef.current.snapTo(trueSunAz);
    setHeadingStatus(fusionRef.current.status());

    Alert.alert(
      L3(language, 'Sun-Snap 보정 완료', 'Sun-Snap calibrated', 'Sun-Snap 補正完了'),
      L3(language,
        `태양 실제 방위각(${Math.round(trueSunAz)}°)에 AR 시뮬레이션을 맞췄습니다.`,
        `AR overlay locked to the Sun's true azimuth (${Math.round(trueSunAz)}°).`,
        `AR表示を太陽の実際の方位(${Math.round(trueSunAz)}°)に合わせました。`),
      [{ text: L3(language, '확인', 'OK', 'OK') }]
    );
  }, [sunPos.azimuth, language]);

  // 오프셋 없이 물리 장치 방위각/고도각 사용 (전면 카메라 전환 시 전면 렌즈 시점에 맞춤)
  const effectiveAz = useMemo(() => {
    const baseAz = cameraFacing === 'front' ? deviceAzimuth + 180 : deviceAzimuth;
    return (baseAz % 360 + 360) % 360;
  }, [deviceAzimuth, cameraFacing]);

  const effectivePitch = useMemo(() => {
    const basePitch = cameraFacing === 'front' ? -devicePitch : devicePitch;
    return Math.max(-90, Math.min(90, basePitch));
  }, [devicePitch, cameraFacing]);

  // ── 전체 화면 카메라 위 그림(2026-10-25) ──
  /** 3D 예측을 무대에 펼쳤나(아니면 "예측 보기" 단추 칸 안의 작은 살아 있는 그림). */
  const [showPrediction, setShowPrediction] = useState(false);
  const tzHours = useCelestialStore(s => s.timezoneOffsetHours) ?? 0;
  const optics = useMemo(
    () => previewOptics(W, stageH, measuredHfov ?? DEFAULT_SENSOR_SHORT_FOV_DEG, currentMagnification),
    [W, stageH, measuredHfov, currentMagnification],
  );
  const sunDayPathPts = useMemo(
    () => sunDayPath(currentTime, latitude, longitude),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 하루에 한 번
    [camDateStr, latitude, longitude],
  );
  /** 지평선에 표시할 출몰 — 골든 타임이면 그 출몰(지났어도), 아니면 다음 출몰. */
  const markerEvent = useMemo(() => {
    const ev = goldenTimeInfo.isActive && goldenTimeInfo.type && goldenTimeInfo.eventTime
      ? { type: goldenTimeInfo.type, at: goldenTimeInfo.eventTime }
      : nextSunEvent(currentTime, latitude, longitude);
    return ev ? { ...ev, az: getSunPosition(ev.at, latitude, longitude).azimuth } : null;
  }, [goldenTimeInfo.isActive, goldenTimeInfo.type, goldenTimeInfo.eventTime, currentTime, latitude, longitude]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;

    hapticShutter();
    setIsCapturing(true);

    try {
      // ── 3D 스냅샷을 **사진보다 먼저** 찍습니다 ────────────────────────
      //
      // ⚠ 예전에는 takePictureAsync 가 끝난 뒤에 찍었습니다. 그런데 사진
      //   촬영은 1~3초가 걸리고 그동안 카메라가 GPU·표면을 크게 물어
      //   GL 컨텍스트가 잠깐 뺏길 수 있습니다. 그러면 스냅샷이 던지고,
      //   부르는 쪽은 null 을 받아 **썸네일 칸을 통째로 안 그렸습니다.**
      //   먼저 찍으면 그 창을 아예 안 지나고, 덤으로 3D 장면이 셔터를
      //   누른 **그 순간**의 방위·고도를 담습니다 — 원래 의도한 것입니다.
      let simUri = '';
      let simFailReason: string | null = null;
      // ⚠ 스냅샷 **직전의 GL 버퍼 밝기**를 같이 들고 옵니다. 저장된 그림이
      //   검을 때 "그린 것이 검다"와 "스냅샷 경로가 잃는다"를 가르는 유일한
      //   단서입니다 — 실기에서 썸네일이 검게 나온 뒤 넣었습니다.
      let simBufMean = -1;
      // 스냅샷과 **같은 순간**의 시선·구름판 상태 — QR 에 실어 기기 화면을 그대로 되살립니다.
      let simRenderState: SkyRenderState | null = null;
      // §165 볼륨 장면이 **적용돼 그려진 뒤에만** 찍습니다. 카메라 화면은 열릴 때마다 대기 표를 새로 만드는데, 그 전에 찍으면
      //   옛 하늘(파란 하늘 + 빌보드 구름)이 "3D 예측" 으로 저장됩니다(수원 2026-10-26 07:27 카드). 최대 3 초 기다리고,
      //   그래도 준비 전이면 스냅샷을 쓰지 않고 카드에 "3D 준비 중" 을 적습니다 — 틀린 그림보다 빈 칸이 낫습니다.
      //   사진을 늦추지는 않습니다(셔터 느낌과 실제 노출이 어긋남) — 준비 전이면 지금은 건너뛰고, 사진 뒤 재시도(아래 1.)에서 한 번 더 봅니다.
      let simNotReadyPhase: string | null = null;
      {
        const sky = sky3dRef.current;
        if (sky) {
          simRenderState = sky.getRenderState();
          if (sky.isVolumetricReady()) {
            simUri = (await sky.takeSnapshot({ format: 'jpeg', compress: 0.85 })) ?? '';
            simBufMean = sky.getLastBufferMean();
            if (!simUri) simFailReason = sky.getLastSnapshotError();
          } else {
            simNotReadyPhase = simRenderState?.volPhase ?? 'unknown';
          }
        } else {
          simFailReason = L3(language, '3D 화면이 아직 준비되지 않음', '3D view not ready yet', '3D画面の準備ができていません');
        }
      }

      // 화면 인식 보정용 — 셔터를 누른 순간의 센서 자세
      const visionSensor = sensorAttitudeNow();
      const visionSpeed = angularSpeedRef.current;
      const visionWhen = new Date();

      // EXIF 활성화하여 촬영
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        exif: true,
      });

      if (!photo?.uri) {
        hapticError();
        Alert.alert(t('takePhotoError', language), t('takePhotoErrorMsg', language));
        setIsCapturing(false);
        return;
      }

      // 찍은 사진으로도 방위를 맞춥니다 — 기다리지 않습니다(저장 흐름을 늦추지 않게).
      if (visionSensor) {
        runVisionOnPhoto(photo.uri, photo.exif, visionSensor, visionSpeed, visionWhen)
          .then(msg => setVisionStatus(msg))
          .catch(() => {});
      }

      // 촬영 시점의 실제 물리 시각 강제 (타임머신 시간으로 인해 더미 대낮이 그려지는 오류 수정)
      const captureTime = new Date();
      const currentSunPos = getSunPosition(captureTime, latitude, longitude);

      // 날씨 데이터 추출 로직
      let humidity = 50;
      // 대기질 API 의 실제 PM2.5(µg/m³). 받지 못하면 null — 예전처럼 β 에서 지어내지 않습니다
      // (예전 식 `β × 280` 은 측정값이 아니었는데 사진 도장에 µg 단위로 찍혔습니다).
      let pm25: number | null = null;
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
          const weatherData = await fetchDayWeatherRing(latitude, longitude, captureTime);
          if (weatherData && weatherData.length > 0 && !(weatherData as any)[0]?.isFallback) {
            // 예전에는 +9시간을 박아 넣어 한국 밖에서는 엉뚱한 날짜가 나왔고,
            // 같은 키를 만드는 useCelestialStore 와도 어긋났습니다(§59).
            const dateStr = localDateString(captureTime);
            const newCacheItem = {
              // ⚠ 스토어와 **같은 함수**로 만듭니다. 한쪽만 고치면 §59 의
              //   "키가 어긋난다" 가 그대로 재발합니다.
              key: weatherCacheKey(latitude, longitude, dateStr),
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
            0,
            undefined,
            currentSunPos.azimuth
          );
          if (prediction) {
            pm25 = obs.pm25 != null && Number.isFinite(obs.pm25) ? Math.round(obs.pm25) : null;
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

      // 1. 셔터 직전에 못 찍었으면 여기서 한 번 더 시도합니다.
      // ⚠ await 뒤에는 ref 를 다시 읽습니다 — 기다리는 동안 카메라를 닫으면 null 입니다.
      {
        const sky = sky3dRef.current;
        if (!simUri && sky) {
          if (sky.isVolumetricReady()) {
            simNotReadyPhase = null;
            simRenderState = sky.getRenderState();
            simUri = (await sky.takeSnapshot({ format: 'jpeg', compress: 0.85 })) ?? '';
            simBufMean = sky.getLastBufferMean();
            if (simUri) simFailReason = null;
            else simFailReason = sky.getLastSnapshotError() ?? simFailReason;
          } else {
            simNotReadyPhase = sky.getRenderState()?.volPhase ?? 'unknown';
          }
        }
      }
      if (!simUri && simNotReadyPhase) {
        // 상태별 사유: creating/updating 은 '준비 중', failed 는 '실패'(기다려도 안 됨), running 인데 장면이 없으면 '예보 대기'.
        simFailReason = simNotReadyPhase === 'failed'
          ? L3(language, '볼륨 하늘 생성 실패 — 하늘 화면의 개발 패널에서 사유 확인', 'Volumetric sky failed — see dev panel on the sky screen', 'ボリューム空の生成に失敗 — 空画面の開発パネルで理由を確認')
          : simNotReadyPhase === 'running'
            ? L3(language, '볼륨 하늘은 켜졌지만 예보 장면이 아직 없음', 'Volumetric sky on, but no forecast scene yet', 'ボリューム空は有効だが予報シーンがまだない')
            : L3(language, `볼륨 하늘이 아직 만들어지지 않음(${simNotReadyPhase})`, `Volumetric sky not ready yet (${simNotReadyPhase})`, `ボリューム空がまだ準備できていません(${simNotReadyPhase})`);
      }
      // ⚠ **스토어의 currentSimulationUri 를 대체품으로 쓰지 않습니다.**
      //   그 값은 `generateSimulationImage` 가 만드는데, 지금 그 함수는
      //   `getSafeBase64JpegPixel()` 을 그대로 돌려주는 **더미**입니다 —
      //   1×1 화소 JPEG 한 장. 그걸 cover 로 늘려 "3D 시뮬레이션 예측"
      //   이라고 붙이면 단색 사각형을 예측 결과라고 내보이는 셈입니다.
      //   못 찍었으면 못 찍었다고 적는 편이 낫습니다.
      if (!simUri && !simFailReason) simFailReason = L3(language, '알 수 없는 이유로 스냅샷 실패', 'Snapshot failed for an unknown reason', '不明な理由でスナップショットに失敗');

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
            // 예전에는 0 을 박아 두어 보고서만 보고는 산 위 관측인지 알 수 없었습니다.
            observerElevM: Number(cameraSimState.terrain?.observerElevation) || 0,
            sunAltDeg: currentSunPos.altitude,
            sunAzDeg: currentSunPos.azimuth,
            obs: obsData,
            windSpeedKmh: windsInfo.winds.low.speedKmh,
            windBearingDeg: windsInfo.winds.low.bearingDeg,
            windSynthetic: !windsInfo.measured,
            view: simRenderState?.view,
            slab: simRenderState?.slab,
            volPhase: simRenderState?.volPhase,
            scene: simRenderState?.scene,
            glMean: simBufMean,
          })
        );
      } catch (qrErr) {
        console.warn('[SunCamera] Failed to build QR payload:', qrErr);
      }

      // 4. 임시 상태에 저장하여 프리뷰 화면 전환
      setCapturedWeatherInfo(weatherInfo);
      setCapturedSimSample(simulationSample);
      setPreviewUri(stampedUri);
      setSimPreviewUri(simUri || null);
      setSimPreviewError(simUri ? null : simFailReason);
      setSimNotReady(!simUri && simNotReadyPhase != null && simNotReadyPhase !== 'failed');
      setSimBufferMean(simBufMean);
      setCapturedQrData(qrPayload);
      
      // 초기 점수 리셋
      setLandscapeScore(5);
      setWeatherScore(5);
      
      setIsCapturing(false);

    } catch (error) {
      console.warn('[SunCamera] Capture error:', error);
      hapticError();
      Alert.alert(t('takePhotoError', language), t('takePhotoErrorMsg', language));
      setIsCapturing(false);
    }
  }, [isCapturing, currentEnhancement, latitude, longitude, sunPos, weatherCacheList, currentTime, language, sensorAttitudeNow, runVisionOnPhoto, cameraSimState]);

  // 업로드 및 공유 처리
  const handleUpload = useCallback(async () => {
    if (!previewUri || isUploading) return;

    // 0. 엄격한 로그인 인증 상태 검증
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        L3(language, '로그인 필요', 'Login required', 'ログインが必要です'),
        L3(language,
          '게시물을 등록하려면 로그인이 필요합니다. 로그인 후 다시 시도해 주세요.',
          'Please log in to upload and share posts.',
          '投稿するにはログインが必要です。ログイン後にもう一度お試しください。')
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
          // ⚠ 예전에는 이름을 못 받으면 '서울특별시' 로 채웠습니다 — 어디서 찍었든. 좌표로 적습니다.
          locationName: uploadedLocationName || locationName,
          weatherInfo: capturedWeatherInfo,
          simulationLocalUri: manipulatedSimUri,
          isPublic: false, // 초기 상태 비공개
        });
      } catch (uploadErr: any) {
        console.error('[SunCamera] Server upload failed:', uploadErr);
        hapticError();
        Alert.alert(
          L3(language, '업로드 오류', 'Upload error', 'アップロードエラー'),
          `${L3(language, '사진을 올리지 못했습니다', 'Failed to upload photo', '写真をアップロードできませんでした')}: ${uploadErr.message || uploadErr}`
        );
      }

      // 성공 후 프리뷰 초기화
      setPreviewUri(null);
      setSimPreviewUri(null);
      setCapturedQrData(null);
      setIsUploading(false);

    } catch (uploadError: any) {
      console.error('[SunCamera] Upload failed:', uploadError);
      hapticError();
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
          <Camera size={64} color={color.sun} />
          <Text style={styles.permissionTitle}>{L3(language, '카메라 권한이 필요합니다', 'Camera permission required', 'カメラの許可が必要です')}</Text>
          <Text style={styles.permissionDesc}>
            {L3(language, '카메라 위에 해 경로를 겹쳐 보여 주려면 카메라가 필요합니다.', 'The camera is needed to show the Sun’s path over the live view.', 'カメラ映像に太陽の軌道を重ねるにはカメラが必要です。')}
          </Text>
          <PressScale style={styles.permissionBtn} onPress={requestCameraPermission}>
            <Text style={styles.permissionBtnText}>{L3(language, '허용하기', 'Allow', '許可する')}</Text>
          </PressScale>
          <PressScale style={styles.closeTextBtn} onPress={onClose}>
            <Text style={styles.closeTextBtnText}>{t('close', language)}</Text>
          </PressScale>
        </View>
      </Modal>
    );
  }

  if (!visible) return null;

  const hhmmAt = (d: Date) => {
    const l = new Date(d.getTime() + tzHours * 3_600_000);
    return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
  };
  // 위쪽 가운데 — "일몰까지 31분". 세 시간 넘게 남았으면 출몰 시각만.
  const countdown = (() => {
    if (!markerEvent) return null;
    const word = t(markerEvent.type, language);
    const m = Math.round((markerEvent.at.getTime() - currentTime.getTime()) / 60_000);
    const a = Math.abs(m);
    if (a >= 180) return { label: word, value: hhmmAt(markerEvent.at) };
    const h = Math.floor(a / 60), mm = a % 60;
    const value = h === 0
      ? L3(language, `${a}분`, `${a} min`, `${a}分`)
      : L3(language, `${h}시간 ${mm}분`, `${h} h ${mm} m`, `${h}時間${mm}分`);
    const label = m >= 0
      ? L3(language, `${word}까지`, `${word} in`, `${word}まで`)
      : L3(language, `${word} 뒤`, `Since ${word.toLowerCase()}`, `${word}から`);
    return { label, value };
  })();
  // 카메라 자세 — 방위·앙각은 화면이 쓰는 값, 기울기는 원시 회전에서(센서가 바뀔 때마다 다시 그려집니다).
  const overlayAttitude: Attitude = (() => {
    const r = rawRotationRef.current;
    return { yawDeg: effectiveAz, pitchDeg: effectivePitch, rollDeg: r ? attitudeFromEuler(r.a, r.b, r.g).rollDeg : 0 };
  })();
  const headingTone = headingStatus?.seeded && headingStatus.trueNorth ? color.success : color.warning;
  const headingWord = !headingStatus?.seeded
    ? L3(language, '보정 중', 'Calibrating', '補正中')
    : headingStatus.trueNorth
      ? L3(language, '보정됨', 'Calibrated', '補正済み')
      : L3(language, '자북 기준', 'Magnetic N', '磁北基準');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {previewUri ? (
          // 촬영 후 미리보기 & 평가 입력 화면
          <View style={{ flex: 1, backgroundColor: color.bg }}>
            <ScrollView 
              contentContainerStyle={styles.previewScrollContent} 
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.previewTitle}>{t('recordSunset', language)}</Text>
              
              {/* 이미지 비교 영역 (촬영 결과물 & 시뮬레이션 예측) */}
              <View style={styles.compareImagesRow}>
                <View style={styles.compareImageWrapper}>
                  <Image source={{ uri: previewUri }} style={styles.compareImage} />
                  <Text style={styles.compareImageLabel}>{t('actualLandscape', language)}</Text>
                </View>
                {/* ⚠ 칸을 **조용히 지우지 않습니다.** 예전에는 simPreviewUri 가
                    없으면 이 칸을 통째로 안 그려서, 화면에서는 아무 설명 없이
                    시뮬레이터 썸네일만 사라졌습니다. 이제 자리를 지키고 왜
                    없는지 적습니다. */}
                <View style={styles.compareImageWrapper}>
                  {simPreviewUri ? (
                    <Image source={{ uri: simPreviewUri }} style={styles.compareImage} />
                  ) : (
                    <View style={styles.compareImageMissing}>
                      <Text style={styles.compareImageMissingText}>
                        {simNotReady
                          ? L3(language, '3D 준비 중', '3D not ready', '3D準備中')
                          : L3(language, '3D 스냅샷을 못 찍었습니다', '3D snapshot unavailable', '3Dスナップショットを取得できませんでした')}
                      </Text>
                      {simPreviewError ? (
                        <Text style={styles.compareImageMissingReason} numberOfLines={3}>
                          {simPreviewError}
                        </Text>
                      ) : null}
                    </View>
                  )}
                  <Text style={styles.compareImageLabel}>{L3(language, '3D 시뮬레이션 예측', '3D simulation', '3Dシミュレーション予測')}</Text>
                  {/* ⚠ 썸네일이 검게 나올 때를 가르는 단서. 스냅샷 직전 GL
                      버퍼의 가운데 밝기입니다 — 0 에 가까우면 그린 것 자체가
                      검은 것이고, 0 이 아닌데 그림이 검으면 스냅샷 경로가
                      잃는 것입니다. 원인을 못 박으면 지웁니다. */}
                  {simBufferMean >= 0 && (
                    <View style={styles.simBufBadge} pointerEvents="none">
                      <Text style={styles.simBufBadgeText}>GL {simBufferMean.toFixed(0)}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* 날씨 정보 QR 리포트 카드 */}
              {capturedQrData && (
                <View style={styles.weatherQrCard}>
                  <View style={styles.weatherQrHeader}>
                    <QrCode size={15} color={color.accent} />
                    <Text style={styles.weatherQrTitle}>
                      {L3(language, '기상 분석 리포트 QR', 'Weather report QR', '気象レポートQR')}
                    </Text>
                  </View>
                  <View style={styles.weatherQrBody}>
                    <View style={styles.qrPlateWrapper}>
                      <SimReportQR data={capturedQrData} size={QR_RESULT_SIZE_PT} />
                    </View>
                    <View style={styles.weatherQrMetaList}>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>{L3(language, '기상 상태', 'Sky', '空の状態')}</Text>
                        <Text style={styles.metaValue}>
                          {capturedWeatherInfo ? translateSunsetDesc(capturedWeatherInfo.description, language) : 'Clear'}
                        </Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>{L3(language, '습도 / 초미세먼지', 'Hum / PM2.5', '湿度 / PM2.5')}</Text>
                        <Text style={styles.metaValue}>
                          {capturedWeatherInfo?.humidity ?? 50}% · {capturedWeatherInfo?.pm25 != null ? `${capturedWeatherInfo.pm25}㎍` : '—'}
                        </Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>{L3(language, '태양 고도 / 방위', 'Sun Alt / Az', '太陽高度 / 方位')}</Text>
                        <Text style={styles.metaValue}>
                          {capturedSimSample ? `${Math.round(capturedSimSample.sunAltitude)}° / ${Math.round(capturedSimSample.sunAzimuth)}°` : '-'}
                        </Text>
                      </View>
                      <Text style={styles.qrExplanationText}>
                        {L3(language,
                          'QR 코드로 촬영 당시의 관측 기상과 3D 물리 파라미터를 그대로 복원할 수 있습니다.',
                          'Scan the QR to restore the exact weather input and solar angles.',
                          'QRコードで撮影時の気象と3Dの物理パラメータをそのまま復元できます。')}
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
                      <PressScale key={num} onPress={() => setLandscapeScore(num)}>
                        <Star
                          size={28}
                          color={num <= landscapeScore ? color.sun : color.borderStrong}
                          fill={num <= landscapeScore ? color.sun : 'transparent'}
                        />
                      </PressScale>
                    ))}
                  </View>
                  <Text style={styles.scoreNumberText}>{landscapeScore} / 5</Text>
                </View>
  
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreLabel}>{t('weatherScoreLabel', language)}</Text>
                  <View style={styles.starsContainer}>
                    {[1, 2, 3, 4, 5].map((num) => (
                      <PressScale key={num} onPress={() => setWeatherScore(num)}>
                        <Sun
                          size={28}
                          color={num <= weatherScore ? '#FF7043' : color.borderStrong}
                          fill={num <= weatherScore ? '#FF7043' : 'transparent'}
                        />
                      </PressScale>
                    ))}
                  </View>
                  <Text style={styles.scoreNumberText}>{weatherScore} / 5</Text>
                </View>
                
                {capturedWeatherInfo && (
                  <View style={styles.weatherSummary}>
                    <Text style={styles.weatherSummaryText}>
                      {t('humidityLabel', language)} {capturedWeatherInfo.humidity}%  |  {t('dustLabel', language)} {capturedWeatherInfo.pm25 != null ? `${capturedWeatherInfo.pm25}㎍` : '—'}  |  {t('weatherLabel', language)} {translateSunsetDesc(capturedWeatherInfo.description, language)}
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
                <PressScale 
                  style={styles.previewRetakeBtn} 
                  onPress={() => {
                    setPreviewUri(null);
                    setSimPreviewUri(null);
                    setCapturedQrData(null);
                  }}
                  disabled={isUploading}
                >
                  <RefreshCw size={18} color={color.text} style={{ marginRight: 8 }} />
                  <Text style={styles.previewRetakeText}>{t('retake', language)}</Text>
                </PressScale>
  
                <PressScale 
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
                </PressScale>
              </View>
            </ScrollView>
          </View>
        ) : (
          // 전체 화면 카메라(2026-10-25, 디자인 2단). 예전에는 카메라와 3D 시뮬을 위아래 4:3 상자로 나눠 둘 다 작았고
          // 카메라 위에 해 경로가 없었습니다. 이제 카메라가 화면을 채우고 그 위에 해 경로를 겹칩니다(`SunPathOverlay`).
          // 3D 예측은 **같은 크기로 늘 붙어 있고**(GL 버퍼 크기를 바꾸지 않게) 평소에는 "예측 보기" 단추 안으로 줄여 둡니다.
          <View style={styles.liveRoot}>
            <View style={[styles.stage, { height: stageH }]}>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={cameraFacing}
                zoom={zoom}
              />
              {/* 소프트웨어 노출 — 카메라 그림에만 */}
              {exposure !== 0 && (
                <View
                  style={[StyleSheet.absoluteFill, { backgroundColor: exposure < 0 ? `rgba(0, 0, 0, ${Math.abs(exposure) * 0.7})` : `rgba(255, 255, 255, ${exposure * 0.4})` }]}
                  pointerEvents="none"
                />
              )}
              <View style={StyleSheet.absoluteFill} {...pinchPanResponder.panHandlers} pointerEvents="box-none" />
              {cameraFacing === 'back' && !showPrediction && (
                <SunPathOverlay
                  width={W}
                  height={stageH}
                  optics={optics}
                  attitude={overlayAttitude}
                  path={sunDayPathPts}
                  sun={{ az: sunPos.azimuth, alt: apparentAltitude(sunPos.altitude) }}
                  sunLabel={`${L3(language, '태양', 'Sun', '太陽')} ${apparentAltitude(sunPos.altitude) >= 0 ? '+' : ''}${apparentAltitude(sunPos.altitude).toFixed(1)}°`}
                  event={markerEvent ? { az: markerEvent.az, label: `${t(markerEvent.type, language)} ${hhmmAt(markerEvent.at)}` } : null}
                  rulerY={stageH - RULER_FROM_BOTTOM}
                />
              )}
            </View>

            {/* 아래 도킹 — 화면 보정 · 방위 맞춤 · 셔터 · 예측 보기 */}
            <View style={[styles.dock, { height: DOCK_H }]}>
              {/* 누르면 능선·해·달로 방위를 맞춥니다. 길게 누르면 Sun-Snap(해를 가운데 두고 그 방위로 고정). */}
              <PressScale
                style={styles.dockBtn}
                onPress={handleVisionCalibrate}
                onLongPress={handleSunSnap}
                disabled={isVisionRunning}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '화면 보정 — 길게 누르면 해에 맞춤', 'Auto-align — long press to snap to the Sun', '画面補正 — 長押しで太陽に合わせる')}
              >
                <View style={[styles.dockIcon, isVisionRunning && { opacity: 0.5 }]}>
                  {isVisionRunning ? <ActivityIndicator size="small" color={color.sun} /> : <Sun size={18} color={color.sun} />}
                </View>
                <Text style={styles.dockLabel} numberOfLines={1}>{L3(language, '화면 보정', 'Align', '画面補正')}</Text>
              </PressScale>

              <PressScale style={styles.dockBtn} onPress={handleCalibrate} accessibilityRole="button" accessibilityLabel={L3(language, '방위 맞춤', 'Calibrate heading', '方位補正')}>
                <View style={styles.dockIcon}><RotateCcw size={18} color={color.text} /></View>
                <Text style={styles.dockLabel} numberOfLines={1}>{L3(language, '방위 맞춤', 'Heading', '方位補正')}</Text>
              </PressScale>

              <PressScale
                style={[styles.shutter, isCapturing && { opacity: 0.5 }]}
                onPress={handleCapture}
                disabled={isCapturing}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '셔터', 'Shutter', 'シャッター')}
              >
                <View style={styles.shutterInner}>
                  {isCapturing ? <ActivityIndicator size="small" color={color.onAccent} /> : <Camera size={22} color={color.onAccent} />}
                </View>
              </PressScale>

              {/* 예측 보기 — 아이콘 칸이 살아 있는 3D 예측(아래 simWrap 이 그 자리로 줄어듭니다). */}
              <PressScale
                style={styles.dockBtn}
                onPress={() => setShowPrediction(v => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: showPrediction }}
                accessibilityLabel={showPrediction ? L3(language, '카메라 보기', 'Show camera', 'カメラを表示') : L3(language, '예측 보기', 'Show prediction', '予測を表示')}
              >
                <View style={styles.dockIcon}>
                  {showPrediction && <Camera size={18} color={color.text} />}
                </View>
                <Text style={styles.dockLabel} numberOfLines={1}>{showPrediction ? L3(language, '카메라', 'Camera', 'カメラ') : L3(language, '예측 보기', 'Predict', '予測')}</Text>
              </PressScale>
            </View>

            {/* 3D 예측 — 크기는 늘 무대 크기, 평소에는 단추 칸 안으로 줄여 잘라 둡니다. 누르기는 받지 않습니다. */}
            <View pointerEvents="none" style={showPrediction ? [styles.simWrapFull, { width: W, height: stageH }] : [styles.simWrapThumb, { left: thumbX, top: thumbY }]}>
              <View style={[{ position: 'absolute', width: W, height: stageH }, showPrediction
                ? { left: 0, top: 0 }
                : { left: (THUMB - W) / 2, top: (THUMB - stageH) / 2, transform: [{ scale: THUMB / W }] }]}>
                <SkyScene3D
                  ref={sky3dRef}
                  sim={cameraSimState}
                  currentTime={currentTime}
                  sunAltitude={sunPos.altitude}
                  sunAzimuth={sunPos.azimuth}
                  prediction={currentPrediction}
                  // ⚠ SkyScene3D 는 위치를 expo-location 모양(location.coords.latitude)으로 읽습니다.
                  //   예전에는 { latitude, longitude } 를 넘겨 전부 undefined 가 됐고, 카메라 3D 는
                  //   서울(37.5, 127) 기본값으로 달·별·대기·수역 마스크를 그리고 DEM 지형은 아예
                  //   안 받았습니다 — 하늘 화면과 땅·하늘색이 다르던 원인 하나입니다(§112).
                  location={camSceneLocation}
                  interpolatedWeather={camInterpolated}
                  timeline={camTimeline}
                  layers={skyLayers}
                  skySettings={camSkySettings}
                  theme={{ accent: color.accent }}
                  cameraAzimuthProp={effectiveAz}
                  cameraElevationProp={effectivePitch}
                  // 미리보기와 같은 세로 화각 — 카메라와 3D 가 같은 하늘 넓이를 보여야 견줄 수 있습니다.
                  fovProp={optics.vFovDeg}
                  fullScreen={true}
                  hideHudOverlay={true}
                  hideCompassBar={true}
                  isActive={visible}
                />
              </View>
            </View>

            {/* 무대 위 조작 — 3D 예측을 펼쳐도 위에 남습니다. */}
            <View style={[styles.hud, { height: stageH }]} pointerEvents="box-none">
              <View style={[styles.topRow, { top: TOP_INSET }]} pointerEvents="box-none">
                <PressScale style={styles.hudBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close', language)}>
                  <X size={18} color={color.text} />
                </PressScale>
                {countdown && (
                  <View style={styles.countdown}>
                    <View style={[styles.dot, { backgroundColor: color.sun }]} />
                    <Text style={styles.countdownLabel}>{countdown.label}</Text>
                    <Text style={styles.countdownValue}>{countdown.value}</Text>
                  </View>
                )}
                <View style={styles.azBox}>
                  <Text style={styles.microText}>{`AZ ${Math.round(effectiveAz)}°`}</Text>
                  <Text style={styles.microText}>{`ALT ${effectivePitch >= 0 ? '+' : ''}${effectivePitch.toFixed(1)}°`}</Text>
                </View>
              </View>

              <View style={[styles.statusCol, { top: TOP_INSET + TOUCH + space.sm }]} pointerEvents="none">
                <View style={styles.badge}>
                  {showPrediction ? (
                    <>
                      <Text style={styles.badgeText}>{L3(language, '3D 예측', '3D prediction', '3D予測')}</Text>
                      <Text style={styles.microText}>{`${L3(language, '화각', 'FOV', '画角')} ${Math.round(optics.vFovDeg)}°`}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.badgeText}>{L3(language, '실제 카메라', 'Live camera', '実カメラ')}</Text>
                      <View style={[styles.dot, { backgroundColor: headingTone }]} />
                      <Text style={styles.microText}>{headingWord}</Text>
                    </>
                  )}
                </View>
                {hasInterference && (
                  <View style={styles.banner}>
                    <Text style={[styles.bannerText, { color: color.warning }]}>
                      {L3(language, '자기 간섭! 폰을 8자로 움직여 주세요', 'Magnetic interference! Move the phone in a figure 8', '磁気干渉!スマホを8の字に動かしてください')}
                    </Text>
                  </View>
                )}
                {/* ⚠ 방위 보정 상태 — "지자기 초기화가 잘 동작 안 하는 것 같다" 는 되고 있는지 볼 길이 없어서
                    나온 말입니다. 왜 못 잡는지(자이로 없음 / 폰이 누워 있음), 자북만 받는지를 적습니다. */}
                {visionStatus && (
                  <View style={styles.banner}>
                    <Text style={styles.bannerText}>
                      {`${visionStatus}${measuredHfov ? ` · ${L3(language, '카메라 화각', 'Camera FOV', 'カメラ画角')} ${measuredHfov.toFixed(0)}°` : ''}`}
                    </Text>
                  </View>
                )}
                {headingStatus && !headingStatus.seeded && (
                  <View style={styles.banner}>
                    <Text style={styles.bannerText}>
                      {headingStatus.lastReject === 'ill-pose'
                        ? L3(language, '방위 보정 중 — 폰을 세워 지평선을 향해 주세요', 'Calibrating — hold the phone upright toward the horizon', '方位補正中 — スマホを立てて地平線に向けてください')
                        : headingStatus.lastReject === 'no-gyro' || !headingStatus.hasGyro
                          ? L3(language, '자이로 신호를 기다리는 중', 'Waiting for motion sensor', 'ジャイロ信号を待っています')
                          : L3(language, `방위 보정 중 (${headingStatus.seedCount}/8)`, `Calibrating heading (${headingStatus.seedCount}/8)`, `方位補正中 (${headingStatus.seedCount}/8)`)}
                    </Text>
                  </View>
                )}
                {headingStatus && headingStatus.seeded && !headingStatus.trueNorth && (
                  <View style={styles.banner}>
                    <Text style={styles.bannerText}>
                      {L3(language, '자북 기준입니다 — 약 8° 어긋납니다. 화면 보정을 길게 눌러 해에 맞추세요', 'Magnetic north only (~8° off). Long-press Align to snap to the Sun', '磁北基準です — 約8°ずれます。画面補正を長押しして太陽に合わせてください')}
                    </Text>
                  </View>
                )}
              </View>

              {/* 노출 — 오른쪽 세로 막대 */}
              <View style={[styles.exposure, { top: TOP_INSET + TOUCH + 64 }]}>
                <Sun size={12} color={color.sun} />
                <View style={styles.exposureTrackBox} {...exposurePanResponder.panHandlers}>
                  <View style={styles.exposureLine} />
                  <View style={[styles.exposureFill, { height: `${((exposure + 1) / 2) * 100}%` }]} />
                  <View style={[styles.exposureThumb, { bottom: `${((exposure + 1) / 2) * 100}%` }]} />
                </View>
                <Text style={styles.microText}>{`${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)}`}</Text>
              </View>

              {/* 배율 · 카메라 전환 */}
              <View style={[styles.zoomRow, { top: stageH - ZOOM_FROM_BOTTOM }]} pointerEvents="box-none">
                <View style={styles.zoomGroup} accessibilityRole="radiogroup">
                  {[1, 2, 3, 5].map((mag) => {
                    const sel = Math.abs(currentMagnification - mag) < 0.25;
                    return (
                      <PressScale
                        key={mag}
                        style={[styles.zoomBtn, sel && styles.zoomBtnOn]}
                        onPress={() => setMagnification(mag)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: sel }}
                      >
                        <Text style={[styles.zoomText, sel && { color: color.accent }]}>{sel ? `${currentMagnification.toFixed(1)}x` : `${mag}x`}</Text>
                      </PressScale>
                    );
                  })}
                </View>
                <PressScale
                  style={styles.hudBtn}
                  onPress={() => setCameraFacing(prev => prev === 'back' ? 'front' : 'back')}
                  accessibilityRole="button"
                  accessibilityLabel={L3(language, '앞뒤 카메라 바꾸기', 'Switch camera', 'カメラ切替')}
                >
                  <RefreshCw size={16} color={color.text} />
                </PressScale>
              </View>
            </View>
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



const styles = StyleSheet.create({
  // ── 전체 화면 카메라(2026-10-25) ──
  liveRoot: { flex: 1, backgroundColor: '#000' },
  stage: { width: '100%', overflow: 'hidden', backgroundColor: '#000' },
  dock: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingTop: DOCK_PAD_TOP,
    backgroundColor: color.panel, borderTopWidth: 1, borderColor: color.border,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
  },
  dockBtn: { width: DOCK_BTN_W, height: DOCK_BTN_H, marginTop: (SHUTTER - DOCK_BTN_H) / 2, alignItems: 'center', gap: space.xs },
  dockIcon: {
    width: TOUCH, height: TOUCH, borderRadius: radius.xs, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  dockLabel: { ...type.label, color: color.text },
  shutter: {
    width: SHUTTER, height: SHUTTER, borderRadius: SHUTTER / 2, borderWidth: 3, borderColor: color.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
  simWrapFull: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', backgroundColor: '#03050C' },
  simWrapThumb: { position: 'absolute', width: TOUCH, height: TOUCH, overflow: 'hidden', borderRadius: radius.xs },
  hud: { position: 'absolute', left: 0, right: 0, top: 0 },
  topRow: { position: 'absolute', left: space.md, right: space.md, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  hudBtn: {
    width: TOUCH, height: TOUCH, borderRadius: radius.xs, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center',
  },
  countdown: {
    height: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, flexShrink: 1,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  countdownLabel: { ...type.body, color: color.textDim, flexShrink: 1 },
  countdownValue: { ...type.display, color: color.text },
  azBox: {
    height: TOUCH, justifyContent: 'center', paddingHorizontal: space.sm,
    borderRadius: radius.xs, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay,
  },
  microText: { ...type.micro, color: color.textDim },
  statusCol: { position: 'absolute', left: space.md, right: TOUCH + space.md * 2, gap: space.xs, alignItems: 'flex-start' },
  badge: {
    height: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm,
    borderRadius: radius.xs, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay,
  },
  badgeText: { ...type.label, color: color.text },
  banner: {
    paddingHorizontal: space.sm, paddingVertical: space.xs,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay,
  },
  bannerText: { ...type.label, color: color.text },
  exposure: {
    position: 'absolute', right: space.md, width: TOUCH, paddingVertical: space.sm, gap: space.sm, alignItems: 'center',
    borderRadius: radius.xs, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay,
  },
  exposureTrackBox: { height: EXPOSURE_TRACK_H, width: TOUCH, alignItems: 'center' },
  exposureLine: { position: 'absolute', top: 0, bottom: 0, width: 4, borderRadius: 2, backgroundColor: color.border },
  exposureFill: { position: 'absolute', bottom: 0, width: 4, borderRadius: 2, backgroundColor: color.sun },
  exposureThumb: {
    position: 'absolute', width: 20, height: 20, marginBottom: -10, borderRadius: 10,
    borderWidth: 2, borderColor: color.sun, backgroundColor: color.panelRaised,
  },
  zoomRow: { position: 'absolute', left: space.md, right: space.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoomGroup: { flexDirection: 'row', gap: space.sm },
  zoomBtn: {
    width: 48, height: TOUCH, borderRadius: radius.xs, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.overlay, alignItems: 'center', justifyContent: 'center',
  },
  zoomBtnOn: { borderColor: color.accentLine, backgroundColor: color.accentSoft },
  zoomText: { ...type.label, color: color.text },

  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: color.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    gap: 16,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: color.text,
    marginTop: 16,
  },
  permissionDesc: {
    fontSize: 13,
    color: color.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionBtn: {
    backgroundColor: color.sun,
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
    color: color.textDim,
    fontSize: 13,
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
  captureSubText: {
    color: color.textDim,
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
  manualTuningPanel: {
    position: 'absolute',
    bottom: 230,
    left: 40,
    right: 40,
    alignItems: 'center',
    backgroundColor: color.scrim,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: color.borderStrong,
  },
  tuningTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
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
    backgroundColor: color.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tuningBtnText: {
    color: color.text,
    fontSize: 13,
    fontWeight: '800',
  },
  tuningValueContainer: {
    minWidth: 40,
    alignItems: 'center',
  },
  tuningValueText: {
    color: color.sun,
    fontSize: 13,
    fontWeight: '800',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: color.bg,
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
    color: color.text,
    fontSize: 16,
    fontWeight: '800',
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
    borderColor: color.border,
  },
  compareImage: {
    flex: 1,
    resizeMode: 'cover',
  },
  simBufBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  simBufBadgeText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  compareImageMissing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  compareImageMissingText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  compareImageMissingReason: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    textAlign: 'center',
  },
  compareImageLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: color.scrim,
    color: color.text,
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
    color: color.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // QR 을 위, 설명을 아래로 둡니다 — QR 에 시선·구름판 상태가 실려 촘촘해져서, 옆줄에 두던
  // 128pt 로는 줄어든 캡처에서 못 읽었습니다(QR_RESULT_SIZE_PT).
  weatherQrBody: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  qrPlateWrapper: {
    backgroundColor: color.text,
    padding: 4,
    borderRadius: 8,
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  weatherQrMetaList: {
    alignSelf: 'stretch',
    gap: 5,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.fill,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  metaLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontWeight: '700',
  },
  metaValue: {
    color: color.text,
    fontSize: 11,
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
    backgroundColor: color.fill,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: color.border,
    gap: 18,
    marginVertical: 12,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scoreLabel: {
    color: color.text,
    fontSize: 13,
    fontWeight: '800',
    minWidth: 70,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  scoreNumberText: {
    color: color.sun,
    fontSize: 13,
    fontWeight: '800',
    minWidth: 40,
    textAlign: 'right',
  },
  weatherSummary: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderColor: color.borderStrong,
    alignItems: 'center',
  },
  weatherSummaryText: {
    color: color.textDim,
    fontSize: 11,
    fontWeight: '700',
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
    borderColor: color.borderStrong,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewRetakeText: {
    color: color.text,
    fontSize: 16,
    fontWeight: '800',
  },
  previewUploadBtn: {
    flex: 2,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.sun,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewUploadText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
  },
  privacyNoticeContainer: {
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: color.dangerSoft,
    marginVertical: 10,
  },
  privacyNoticeText: {
    color: '#FF8A80',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  zoomIndicatorContainer: {
    position: 'absolute',
    top: '15%',
    alignSelf: 'center',
    backgroundColor: color.scrim,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.borderStrong,
    zIndex: 200,
  },
  zoomIndicatorText: {
    color: color.sun,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  arLayerChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(22, 19, 26, 0.75)',
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  arLayerChipActive: {
    backgroundColor: 'rgba(255, 140, 0, 0.85)',
    borderColor: '#FF8C00',
  },
  arLayerChipText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 13,
    fontWeight: '700',
  },
  arLayerChipTextActive: {
    color: color.text,
    fontWeight: '800',
  },

});
