import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EARTH_RADIUS_M } from '../utils/earth';
import {
  StyleSheet, View, Text, BackHandler,
  Dimensions, Platform, Alert, ActivityIndicator, Image, PanResponder, ScrollView, Pressable, Vibration, StatusBar
} from 'react-native';
import Constants from 'expo-constants';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
import { localDateString } from '../utils/localDate';
import { weatherCacheKey, findEntry, findNearestEntry } from '../utils/cachePolicy';
import { poseFromRotation, compassToCameraHeading, type DevicePose } from '../utils/devicePose';
import { pickTerrainForLocation, fallbackTerrain } from '../utils/terrainPick';
import { findPresetTerrain } from '../utils/presetTerrains';
import { scenePrediction } from '../utils/scenePrediction';
import { canGlow, lowCloudWindow, peakWindow, sampleScores, scoreWindow } from '../utils/scoreSeries';
import { createHeadingFusion, type HeadingFusionStatus } from '../utils/headingFusion';
import { analyzeFrame, attitudeFromEuler, intrinsicsFromHfov, apparentAltitude, wrap360, type Attitude, type HorizonProfile } from '../utils/arVision';
import { loadHorizon, frameFromPhoto, hfovFromExif } from '../utils/arVisionNative';
import * as MediaLibrary from 'expo-media-library';
import { Magnetometer, DeviceMotion } from 'expo-sensors';
import * as Location from 'expo-location';
import { X, Camera, RotateCcw, Sun, Check, RefreshCw, Star, QrCode, Moon, Lock, Unlock, Crosshair, Layers, Compass, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Skia, rect, PaintStyle, ImageFormat } from '@shopify/react-native-skia';
import { buildSimReportPayload, encodeSimReportPayload } from '../utils/simReport';
import { resolveLayerWinds } from '../utils/skyColumn';
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
import { type SkyRenderState } from './SkyScene3D';
import { getPrimarySky } from './SkyScene3D/primarySky';
import { PressScale } from './ui';
import { color, radius, space, type, TOUCH } from '../theme/tokens';
import { SunPathOverlay } from './SunPathOverlay';
import { hapticShutter, hapticError } from '../utils/haptics';
import { previewOptics, sunDayPath, nextSunEvent, DEFAULT_SENSOR_SHORT_FOV_DEG } from '../utils/cameraOverlay';
import {
  getAstroCapabilitiesAsync,
  isAstroCameraAvailable,
  renderAstroStackPreviewAsync,
  stopAstroSessionAsync,
  type AstroCameraCapabilities,
} from '../../modules/astro-camera';
import { analyzeAstroWindow, type AstroWindowAnalysis } from '../utils/astroForecast';
import { buildSkyTimeline, type SkyTimeline } from '../utils/skyTimeline';
import {
  runAstroCaptureStack,
  type AstroCaptureProgress,
  type AstroCaptureRunResult,
} from '../utils/astroCapturePipeline';
import {
  astroChipLabel,
  computeAstroSimExposureParams,
  createDefaultAstroSettings,
  evaluateDirectionGuide,
  planAstroShotSummary,
  type AstroSettingsState,
  type CameraTabMode,
  type DirectionGuideState,
  type DirectionTarget,
} from '../utils/astroCameraUi';
import { AstroForecastBanner } from './AstroCamera/AstroForecastBanner';
import { AstroSettingsPanel } from './AstroCamera/AstroSettingsPanel';
import { AstroCaptureNightOverlay, type AstroNightPhase } from './AstroCamera/AstroCaptureNightOverlay';
import { AstroResultView } from './AstroCamera/AstroResultView';
import { DirectionGuideOverlay } from './AstroCamera/DirectionGuideOverlay';
import { captureKeyFor, modeList } from '../utils/modeStrip';
import { TimelapsePanel, kindLabel as timelapseKindLabel } from './AstroCamera/TimelapsePanel';
import { ResultCompare } from './ResultCompare';
import { forecastLine, sunFractionInPhoto } from '../utils/resultCompare';
import { useTimelapseRun } from '../hooks/useTimelapseRun';
import { clockLabel, previewTimeAt, savedSoFar, shotPlan, videoClock, type TimelapseKind, type TimelapsePlan } from '../utils/timelapsePlan';
import { FrameAccumulator } from '../utils/frameComposite';
import { RunExtras, ScreenOffCover } from './AstroCamera/RunExtras';
import { TimelapseRunCard } from './AstroCamera/TimelapseRunCard';
import { GlassSurface, glassTextShadow } from './glass/GlassSurface';
import { useRunDevice } from '../hooks/useRunDevice';
import { readSmallRgba } from '../utils/imageZones';
import { lumaFromRgba, photoStops } from '../utils/runCurve';
import { exposureStops } from '../utils/exposureCurve';
import { tabForMode, type CaptureModeKey } from '../utils/captureMode';
import { sceneSummary } from '../utils/savedScenes';
import { ExposureCells } from './AstroCamera/ExposureCells';
import { CameraFrame } from './AstroCamera/CameraFrame';
import { Scrim } from './glass/Scrim';
import { GlassChip } from './glass/GlassChip';
import { GlassIconButton } from './glass/GlassIconButton';
import { TEXT } from '../theme/glassTokens';
import { adviseExposure } from '../utils/exposureAdvice';
import { autoStartDue, autoStartState } from '../utils/autoStart';
import { lensLine } from '../utils/lensInfo';
import { EclipseCard } from './AstroCamera/EclipseCard';
import { eclipseEventFor } from '../utils/eclipseEvent';
import { stageAt } from '../utils/eclipsePlan';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/**
 * 촬영 결과 화면의 QR 한 변(pt). 시선·구름판 상태를 실어 모듈이 93칸 안팎입니다 — 캡처를 1080px
 * 에서 절반쯤 줄여 보내도 모듈 하나가 3px 넘게 남도록 화면 폭의 60% 안에서 크게 잡습니다.
 */
/** 카메라 안 모드 줄의 모드들. 이벤트(월식)는 식이 있을 때만 끝에 붙습니다. */
const CAMERA_STRIP_MODES = modeList(false);
const CAMERA_STRIP_MODES_EVENT = modeList(true);

const QR_RESULT_SIZE_PT = Math.min(220, Math.round(SCREEN_WIDTH * 0.6));

export type CameraViewMode = 'camera' | 'blend' | 'sim';

interface SunCameraProps {
  visible: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  currentTime: Date;
  onTimeChange?: (nextTime: Date) => void;
  isTimeMachineEnabled?: boolean;
  onResetTime?: () => void;
  goldenTimeInfo: GoldenTimeInfo;
  onViewModeChange?: (mode: CameraViewMode) => void;
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

/** 노출 막대 길이(px) — 끌기 계산과 스타일이 같은 값. */
const EXPOSURE_TRACK_H = 160;

export const SunCamera: React.FC<SunCameraProps> = ({
  visible,
  onClose,
  latitude,
  longitude,
  currentTime,
  onTimeChange,
  isTimeMachineEnabled = false,
  onResetTime,
  goldenTimeInfo,
  onViewModeChange,
}) => {
  const { width: W, height: H } = Dimensions.get('window');
  // 전체 화면 카메라 — 안드로이드에서는 App.tsx의 paddingTop(statusBarHeight)과 동일하게 알림바 아래부터 시작해
  // SkyScene3D와 장노출 스냅샷(longExpPreviewUri)의 시작 y좌표·높이(위상)를 1px 오차 없이 일치시킨다.
  const androidStatusBarH = Platform.OS === 'android'
    ? (Constants.statusBarHeight || StatusBar.currentHeight || 0)
    : 0;
  const TOP_INSET = Platform.OS === 'ios'
    ? Math.max(Constants.statusBarHeight ?? 44, 48) + 10
    : 12;
  const [rootH, setRootH] = useState(H);
  // 유리 막대(고정부 + 손잡이 줄)의 높이 — 카메라가 화면 전체를 채우므로 막대 위에 떠 있는 것(천체 설정 · 방위 눈금)을 그만큼 올립니다.
  const [dockInset, setDockInset] = useState(150);
  const [stageLayoutH, setStageLayoutH] = useState(Math.max(240, H - 220));
  const stageLayoutHRef = useRef(stageLayoutH);
  stageLayoutHRef.current = stageLayoutH;
  /** 방위 눈금 자리(무대 아래에서) */
  const RULER_FROM_BOTTOM = 44;

  const { uploadAndPostPhoto, weatherCacheList, addWeatherCache, terrainCacheList, language } = useCelestialStore();
  // 3D 예측은 하늘 화면의 장면을 공유해 그립니다(primarySky.ts).
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions({ writeOnly: true });
  const cameraRef = useRef<CameraView>(null);

  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const cameraFacingRef = useRef<CameraType>(cameraFacing);
  cameraFacingRef.current = cameraFacing;
  const [zoom, setZoom] = useState(0); // 0 (1.0x) ~ 1 (5.0x)
  const [exposure, setExposure] = useState(0); // -1.0 ~ 1.0 (디폴트 0)

  // 뷰 모드 ('camera': 실카메라, 'blend': 카메라+3D 반투명 겹쳐보기, 'sim': 60fps 3D 시뮬)
  const [viewMode, setViewMode] = useState<CameraViewMode>('camera');
  const viewModeRef = useRef<CameraViewMode>(viewMode);
  viewModeRef.current = viewMode;
  useEffect(() => {
    onViewModeChange?.(viewMode);
  }, [viewMode, onViewModeChange]);

  // 방향 고정(Freeze): 폰을 내려도 고정된 방위/앙각에서 배율·시간·장노출 프리뷰를 탐색 가능
  const [frozenView, setFrozenView] = useState<{ azDeg: number; elDeg: number; rollDeg: number } | null>(null);
  const frozenViewRef = useRef(frozenView);
  frozenViewRef.current = frozenView;
  const [isInteracting, setIsInteracting] = useState(false);

  // 줌 배율 M: 1.0x (zoom=0) ~ 5.0x (zoom=1)
  const currentMagnification = useMemo(() => {
    return 1.0 + zoom * 4.0;
  }, [zoom]);

  // 배율 직접 설정 헬퍼 (1x, 2x, 3x, 5x)
  const setMagnification = useCallback((mag: number) => {
    const clampedMag = Math.max(1.0, Math.min(5.0, mag));
    setZoom((clampedMag - 1.0) / 4.0);
  }, []);

  const initialZoom = useRef(0);
  const initialDistance = useRef(0);
  const panStartView = useRef<{ azDeg: number; elDeg: number; rollDeg: number } | null>(null);
  const opticsRef = useRef({ hFovDeg: 50, vFovDeg: 65, simVFovDeg: 85 });

  // 1. Pinch Zoom + 1-finger Pan (시뮬/방향고정 시 터치 드래그로 구도 미세 조정)
  const stagePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => {
      if (evt.nativeEvent.touches.length === 2) return true;
      if (evt.nativeEvent.touches.length === 1 && (viewModeRef.current !== 'camera' || frozenViewRef.current !== null)) {
        return true;
      }
      return false;
    },
    onMoveShouldSetPanResponder: (evt, gs) => {
      if (evt.nativeEvent.touches.length === 2) return true;
      if (
        evt.nativeEvent.touches.length === 1 &&
        (viewModeRef.current !== 'camera' || frozenViewRef.current !== null) &&
        (Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3)
      ) {
        return true;
      }
      return false;
    },
    onPanResponderGrant: (evt) => {
      setIsInteracting(true);
      const touches = evt.nativeEvent.touches;
      if (touches.length === 2) {
        initialZoom.current = zoom;
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        initialDistance.current = Math.sqrt(dx * dx + dy * dy);
        panStartView.current = null;
      } else if (touches.length === 1 && (viewModeRef.current !== 'camera' || frozenViewRef.current !== null)) {
        const curAz = frozenViewRef.current
          ? frozenViewRef.current.azDeg
          : ((cameraFacingRef.current === 'front' ? deviceAzimuthRef.current + 180 : deviceAzimuthRef.current) % 360 + 360) % 360;
        const curEl = frozenViewRef.current
          ? frozenViewRef.current.elDeg
          : Math.max(-90, Math.min(90, cameraFacingRef.current === 'front' ? -devicePitchRef.current : devicePitchRef.current));
        const start = { azDeg: curAz, elDeg: curEl, rollDeg: 0 };
        panStartView.current = start;
        if (!frozenViewRef.current) {
          setFrozenView(start);
        }
      }
    },
    onPanResponderMove: (evt, gs) => {
      const touches = evt.nativeEvent.touches;
      if (touches.length === 2 && initialDistance.current > 0) {
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const scale = distance / initialDistance.current;
        const deltaZoom = (scale - 1) * 0.3;
        const newZoom = Math.max(0, Math.min(1, initialZoom.current + deltaZoom));
        setZoom(newZoom);
      } else if (touches.length === 1 && panStartView.current) {
        const degPerPxX = opticsRef.current.hFovDeg / Math.max(1, W);
        const degPerPxY = opticsRef.current.vFovDeg / Math.max(1, stageLayoutHRef.current);
        const nextAz = ((panStartView.current.azDeg - gs.dx * degPerPxX) % 360 + 360) % 360;
        const nextEl = Math.max(-45, Math.min(85, panStartView.current.elDeg + gs.dy * degPerPxY));
        setFrozenView({ azDeg: nextAz, elDeg: nextEl, rollDeg: 0 });
        if (viewModeRef.current !== 'camera') {
          getPrimarySky()?.setCameraView?.(nextAz, nextEl, opticsRef.current.simVFovDeg, {
            rollDeg: 0,
            centerOffsetYFrac: centerOffsetYFracRef.current,
          });
        }
      }
    },
    onPanResponderRelease: () => {
      initialDistance.current = 0;
      panStartView.current = null;
      setIsInteracting(false);
    },
    onPanResponderTerminate: () => {
      initialDistance.current = 0;
      panStartView.current = null;
      setIsInteracting(false);
    }
  }), [zoom, W]);

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
    onPanResponderMove: (_evt, gestureState) => {
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
  const gyroBaselineRef = useRef(0);
  const smoothedGyroRef = useRef(0);
  const gyroBurstPeakRef = useRef(0);
  const lastUiSensorMsRef = useRef(0);
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
  const [isCapturing, setIsCapturing] = useState(false);
  const isCapturingRef = useRef(false);
  isCapturingRef.current = isCapturing;

  // 천체 모드 상태 · 야간 암적응 촬영 화면 · 천체 전용 결과
  const [cameraTab, setCameraTab] = useState<CameraTabMode>('sunset');
  // 새 화면 틀(실험, 설정의 "실험")이 켜져 있으면 셔터 아래에 모드 줄이 섭니다(docs/SANDBOX_MODE_PLAN.md 18 · 21절).
  const [astroSettings, setAstroSettings] = useState<AstroSettingsState>(() => createDefaultAstroSettings());
  const [astroCaps, setAstroCaps] = useState<AstroCameraCapabilities>({
    available: false, cameraId: '', hardwareLevel: -1, rawSupported: false, manualSensorSupported: false,
    minExposureMs: 100, maxExposureMs: 30000, minIso: 100, maxIso: 6400,
    focalLengthMm: 4.5, focal35mm: 24, hfovDeg: 65, sensorOrientation: 90,
    supportsFocusDistance: false, rawWidth: 0, rawHeight: 0, yuvWidth: 0, yuvHeight: 0,
  });
  const [astroNightPhase, setAstroNightPhase] = useState<AstroNightPhase | null>(null);
  const [astroCountdownSec, setAstroCountdownSec] = useState(0);
  const [astroProgress, setAstroProgress] = useState<AstroCaptureProgress | null>(null);
  const [astroMonochromeRed, setAstroMonochromeRed] = useState(true);
  const astroMonochromeRedRef = useRef(true);
  astroMonochromeRedRef.current = astroMonochromeRed;
  const [astroStopEarlyReq, setAstroStopEarlyReq] = useState(false);
  const astroAbortRef = useRef(false);
  const astroStopEarlyRef = useRef(false);
  const astroCountdownSkipRef = useRef(false);
  const [astroResult, setAstroResult] = useState<AstroCaptureRunResult | null>(null);
  const [astroResultIso, setAstroResultIso] = useState(1600);
  const [astroSaving, setAstroSaving] = useState(false);
  const [astroSaved, setAstroSaved] = useState(false);
  const [astroTimeline, setAstroTimeline] = useState<SkyTimeline | null>(null);
  const cameraTabRef = useRef(cameraTab);
  cameraTabRef.current = cameraTab;
  const astroSettingsRef = useRef(astroSettings);
  astroSettingsRef.current = astroSettings;
  const astroBusyRef = useRef(false);
  astroBusyRef.current = astroNightPhase !== null;
  const [lockedTarget, setLockedTarget] = useState<DirectionTarget | null>(null);
  // 샌드박스 "이 장면 찍기"로 넘어온 장면: 그 시각에 맞는 모드를 먼저 열고, 장면의 시선 방향으로 안내합니다(계획 12.3, 목업 4). 카메라를 닫으면 지웁니다.
  const cameraScene = useCelestialStore(s => s.cameraScene);
  const [topInfoExpanded, setTopInfoExpanded] = useState(false);
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);
  const [timelapseMode, setTimelapseMode] = useState(false);
  const [tlSummaryLabel, setTlSummaryLabel] = useState<string>('');
  const [camStage, setCamStage] = useState<'min' | 'mid' | 'full'>('min');
  // 월식 이벤트 모드: 켜짐 계산은 10 분 · 위경도 0.1° 단위로만 다시 하고, 남은 시간만 매초 갱신한다.
  const [eclipseOn, setEclipseOn] = useState(false);
  const [eclipseTick, setEclipseTick] = useState(() => Date.now());
  useEffect(() => {
    if (!visible || !cameraScene) return;
    setLockedTarget({ azDeg: cameraScene.azDeg, elDeg: cameraScene.elDeg });
    // 시각과 상관없이 사진(일반)에서 시작하고, 보던 방향이 가이드가 됩니다(docs/SANDBOX_MODE_PLAN.md 18절).
    const tab = tabForMode('normal');
    if (tab) setCameraTab(tab);
  }, [visible, cameraScene]);
  useEffect(() => () => { useCelestialStore.getState().setCameraScene(null); }, []);

  // ── 타임랩스(계획 8.3.1, 목업 9 · 12): 사진 묶음으로 앨범에 저장합니다(영상 만들기는 아직 없습니다) ──
  // 종류에 따라 장마다 `shotPlan` 이 정하는 대로: 일반은 그대로 저장, 밝게 합성은 묶음에 쌓았다가 묶음마다 저장, 궤적 누적은 겹치고 매번 누적 그림을 저장.
  const tlKindRef = useRef<{ kind: TimelapseKind; stackSize: number }>({ kind: 'plain', stackSize: 1 });
  const tlAccRef = useRef<FrameAccumulator | null>(null);
  const saveComposite = useCallback(async (): Promise<boolean> => {
    const acc = tlAccRef.current;
    const file = acc ? await acc.saveToFile() : null;
    if (!file) return false;
    try { await MediaLibrary.saveToLibraryAsync(file); return true; }
    finally { FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {}); }
  }, []);
  // 촬영 중 카드의 "실제 밝기": 찍은 장마다 사진 평균 밝기(선형 0~1)를 재 둡니다(`runCurve`).
  const [tlLumas, setTlLumas] = useState<Array<number | null>>([]);
  const [screenOff, setScreenOff] = useState(false);
  const shootFrame = useCallback(async (index: number, isLast: boolean): Promise<boolean> => {
    if (!cameraRef.current) return false;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.6, shutterSound: false });
    {
      const rgba = await readSmallRgba(photo.uri).catch(() => null);
      const luma = rgba ? lumaFromRgba(rgba) : null;
      setTlLumas(prev => { const n = prev.slice(); n[index] = luma; return n; });
    }
    const { kind, stackSize } = tlKindRef.current;
    const p = shotPlan(kind, stackSize, index, isLast);
    let ok = true;
    if (p.saveRaw) await MediaLibrary.saveToLibraryAsync(photo.uri);
    if (p.accumulate) {
      if (!tlAccRef.current) tlAccRef.current = new FrameAccumulator(kind === 'trail' ? 'lighten' : 'average');
      ok = await tlAccRef.current.add(photo.uri);
      if (ok && p.flush) ok = await saveComposite();
      if (p.reset) tlAccRef.current.reset();
    }
    FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
    return ok;
  }, [saveComposite]);
  // 마지막 장 없이 끝나면(마치기 · 연속 실패) 합치다 만 묶음을 마저 저장합니다(밝게 합성만, 누적은 매번 저장해 둠).
  const endTimelapse = useCallback(async () => {
    const acc = tlAccRef.current;
    if (acc && acc.count > 0 && tlKindRef.current.kind === 'stacked') await saveComposite().catch(() => false);
    tlAccRef.current = null;
  }, [saveComposite]);
  const timelapse = useTimelapseRun(shootFrame, endTimelapse);
  // 찍는 동안 화면이 꺼지지 않게 하고 배터리를 읽습니다. "화면 끄고 계속"이면 화면을 어둡게(검은 덮개).
  const runBattery = useRunDevice(!!timelapse.run?.running, screenOff);
  useEffect(() => { if (!timelapse.run?.running) setScreenOff(false); }, [timelapse.run?.running]);
  const startTimelapse = useCallback(async (plan: TimelapsePlan) => {
    const granted = mediaPermission?.granted || (await requestMediaPermission()).granted;
    if (!granted) {
      Alert.alert(L3(language, '사진 저장 권한이 필요해요', 'Photo permission needed', '写真の保存権限が必要です'));
      return;
    }
    setViewMode('camera');
    tlKindRef.current = { kind: plan.kind, stackSize: plan.stackSize };
    tlAccRef.current = null;
    setTlLumas([]);
    setScreenOff(false);
    timelapse.start(plan);
  }, [mediaPermission, requestMediaPermission, timelapse, language]);
  // 미리보기: 3D 시뮬레이션이 구간을 영상 길이만큼 재생합니다. 끝나면 원래 시각으로 돌아옵니다.
  const [previewing, setPreviewing] = useState(false);
  /** 미리보기 읽음 "0:06 / 0:12" (정수 초가 바뀔 때만 다시 그림). */
  const [previewClock, setPreviewClock] = useState('0:00 / 0:00');
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewOrigin = useRef<Date | null>(null);
  const stopPreview = useCallback(() => {
    if (previewTimer.current) { clearInterval(previewTimer.current); previewTimer.current = null; }
    if (previewOrigin.current) { onTimeChange?.(previewOrigin.current); previewOrigin.current = null; }
    setPreviewing(false);
  }, [onTimeChange]);
  const playPreview = useCallback((plan: TimelapsePlan, startMs: number, endMs: number) => {
    if (!onTimeChange) return;
    if (previewTimer.current) clearInterval(previewTimer.current);
    if (!previewOrigin.current) previewOrigin.current = currentTime;
    setViewMode('sim');
    setPreviewing(true);
    setPreviewClock(videoClock(0, plan.targetVideoSec));
    const t0 = Date.now();
    previewTimer.current = setInterval(() => {
      const elapsed = (Date.now() - t0) / 1000;
      onTimeChange(new Date(previewTimeAt(startMs, endMs, plan.targetVideoSec, elapsed)));
      setPreviewClock(videoClock(elapsed, plan.targetVideoSec));
      if (elapsed >= plan.targetVideoSec) stopPreview();
    }, 100);
  }, [onTimeChange, currentTime, stopPreview]);
  useEffect(() => () => { if (previewTimer.current) clearInterval(previewTimer.current); }, []);
  const pickMode = (key: CaptureModeKey) => {
    if (key === 'event') { setTimelapseMode(false); setEclipseOn(true); setCameraTab('astro'); return; }
    setEclipseOn(false);
    if (key === 'timelapse') { setTimelapseMode(true); return; }
    setTimelapseMode(false);
    const tab = tabForMode(key);
    if (tab) setCameraTab(tab);
  };
  const [vibrationGuideOn, setVibrationGuideOn] = useState(true);
  const [guideState, setGuideState] = useState<DirectionGuideState | null>(null);
  const onTargetHystRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      astroAbortRef.current = true;
      setViewMode('camera');
      setFrozenView(null);
      setLongExpPreviewUri(null);
      setIsLongExpRendering(false);
    }
  }, [visible]);
  useEffect(() => () => { astroAbortRef.current = true; Vibration.cancel(); }, []);
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (astroNightPhase !== null) {
        astroAbortRef.current = true;
        return true;
      }
      Vibration.cancel();
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, astroNightPhase, onClose]);

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
  /** 해가 찍은 사진의 어디인지(가로 · 세로 비율). 셔터 순간의 자세로 구하고, 모르면 null(해 근처 비교가 빠집니다). */
  const [capturedSunXY, setCapturedSunXY] = useState<{ x: number; y: number } | null>(null);
  const [uploadedPhotoForModal, setUploadedPhotoForModal] = useState<MyPhoto | null>(null);



  // 현재 태양 위치
  const sunPos = useMemo(() => {
    return getSunPosition(currentTime, latitude, longitude);
  }, [currentTime, latitude, longitude]);
  const eclipseBucket = Math.floor(currentTime.getTime() / 600000);
  const eclipseLat = Math.round(latitude * 10) / 10, eclipseLon = Math.round(longitude * 10) / 10;
  const eclipseBase = useMemo(
    () => eclipseEventFor(eclipseBucket * 600000, eclipseLat, eclipseLon),
    [eclipseBucket, eclipseLat, eclipseLon],
  );
  useEffect(() => { if (!eclipseBase) setEclipseOn(false); }, [eclipseBase]);
  useEffect(() => {
    if (!eclipseOn) return;
    setEclipseTick(Date.now());
    const id = setInterval(() => setEclipseTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [eclipseOn]);
  const eclipseEvent = eclipseBase ? { ...eclipseBase, now: stageAt(eclipseBase.plan, eclipseTick) } : null;

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

  // 하늘 화면과 **같은 식**(scenePrediction) — 예전에는 시정 15km·습도 50%·고도 0 을 박았습니다.
  const camInterpolated = useMemo(
    () => (camWeatherData ? getInterpolatedWeather(camWeatherData, currentTime) : []),
    [camWeatherData, currentTime]
  );

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
      if (rr) {
        const inst = Math.hypot(rr.alpha ?? 0, rr.beta ?? 0, rr.gamma ?? 0);
        angularSpeedRef.current = inst;
        // 정지 상태 MEMS 자이로 DC 오프셋을 천천히 추적해 순수 충격분만 추출
        if (inst < 1.8) {
          gyroBaselineRef.current = gyroBaselineRef.current * 0.96 + inst * 0.04;
        }
        const netSpeed = Math.max(0, inst - gyroBaselineRef.current);
        smoothedGyroRef.current = smoothedGyroRef.current * 0.7 + netSpeed * 0.3;
        if (smoothedGyroRef.current > gyroBurstPeakRef.current) {
          gyroBurstPeakRef.current = smoothedGyroRef.current;
        }
      }

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

      // 60Hz Ref 는 즉시 갱신하고, 무거운 React UI 트리는 ~15Hz(66ms)로만 반영해 뷰파인더 버벅임을 차단
      deviceAzimuthRef.current = filteredAz;
      devicePitchRef.current = filteredPitch;
      if (now - lastUiSensorMsRef.current >= 66) {
        lastUiSensorMsRef.current = now;
        setDeviceAzimuth(filteredAz);
        setDevicePitch(filteredPitch);
      }

      // 진북 보정 각도로 보정된 3D Rotation Matrix 각도 세트 전개
      const radOffset = (((fusionRef.current.status().offsetDeg) * Math.PI) / 180);
      const calibratedAlpha = (aRad + radOffset + 2 * Math.PI) % (2 * Math.PI);
      
      const currentRotation = {
        alpha: calibratedAlpha,
        beta: bRad,
        gamma: gRad,
      };
      deviceRotationRef.current = currentRotation;

      // 'blend' / 'sim' 모드에서 방향 고정이 켜져 있지 않으면 60fps로 SkyScene3D 시선 즉시 동기화
      if (viewModeRef.current !== 'camera' && !frozenViewRef.current) {
        const liveAz = cameraFacingRef.current === 'front' ? (filteredAz + 180) % 360 : filteredAz;
        const liveEl = cameraFacingRef.current === 'front' ? -filteredPitch : filteredPitch;
        const liveRoll = attitudeFromEuler(aRad, bRad, gRad).rollDeg;
        getPrimarySky()?.setCameraView?.(liveAz, liveEl, opticsRef.current.simVFovDeg, {
          rollDeg: liveRoll,
          centerOffsetYFrac: centerOffsetYFracRef.current,
        });
      }
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

  // ── 통합 뷰 전환 & 방향 고정(Freeze) & 배율/장노출 프리뷰 ──
  const displayAz = frozenView ? frozenView.azDeg : effectiveAz;
  const displayEl = frozenView ? frozenView.elDeg : effectivePitch;
  const displayRoll = frozenView
    ? frozenView.rollDeg
    : (rawRotationRef.current ? attitudeFromEuler(rawRotationRef.current.a, rawRotationRef.current.b, rawRotationRef.current.g).rollDeg : 0);
  const centerOffsetYFrac = rootH > 0 && stageLayoutH > 0 ? (rootH - stageLayoutH) / (2 * rootH) : 0;
  const centerOffsetYFracRef = useRef(0);
  centerOffsetYFracRef.current = centerOffsetYFrac;

  const remoteViewNowRef = useRef<() => { az: number; el: number; fov: number }>(() => ({ az: 0, el: 0, fov: 60 }));
  const remoteViewNow = useCallback(() => remoteViewNowRef.current(), []);
  const tzHours = useCelestialStore(s => s.timezoneOffsetHours) ?? 0;

  // 타임랩스 시트의 "가장 붉음" 구간: 일몰 둘레 9시간을 하늘 화면과 같은 예측(`scenePrediction`)으로 10분마다 훑어 점수가 가장 높은 덩어리를 찾습니다.
  // 시트가 열려 있고 일몰이 겨눠질 때만 셉니다. 받아 둔 예보 시각 밖의 표본은 비웁니다(없는 값을 짓지 않음).
  const tlSunsetMs = goldenTimeInfo.type === 'sunset' && goldenTimeInfo.eventTime ? goldenTimeInfo.eventTime.getTime() : null;
  const tlPeak = useMemo(() => {
    if (!timelapseMode || !tlSunsetMs || !camWeatherData || camWeatherData.length === 0) return null;
    const h = camWeatherData[0]?.hourly as any;
    const times: number[] | undefined = h?.timeMs ?? h?.time?.map((x: string) => new Date(x).getTime());
    const covered = (ms: number) => !!times?.length && ms >= times[0] && ms <= times[times.length - 1];
    const win = scoreWindow(tlSunsetMs, 'sunset', tzHours);
    const points = sampleScores(win, 10, (tm) => {
      const sp = getSunPosition(tm, latitude, longitude);
      const alt = sp.altitude;
      if (!canGlow(alt)) return 0;
      if (!covered(tm.getTime())) return null;
      const obs = getInterpolatedWeather(camWeatherData, tm)[0];
      return scenePrediction({ pathData: camWeatherData, time: tm, sunAltDeg: alt, sunAzDeg: sp.azimuth, obs, latitude, observerElevM: Number(cameraSimState.terrain?.observerElevation) || undefined })?.score ?? null;
    });
    return peakWindow(points);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelapseMode, tlSunsetMs, camWeatherData, latitude, longitude, tzHours]);

  // 낮은 구름이 두꺼운 구간(일몰 ±90분): 같은 10분 표본에서 보간한 낮은 구름 %가 60 이상 이어진 가장 긴 구간. 예측을 부르지 않아 가볍습니다.
  const tlLowCloud = useMemo(() => {
    if (!timelapseMode || !tlSunsetMs || !camWeatherData || camWeatherData.length === 0) return null;
    const h = camWeatherData[0]?.hourly as any;
    const times: number[] | undefined = h?.timeMs ?? h?.time?.map((x: string) => new Date(x).getTime());
    const covered = (ms: number) => !!times?.length && ms >= times[0] && ms <= times[times.length - 1];
    const points = sampleScores(scoreWindow(tlSunsetMs, 'sunset', tzHours), 10, (tm) => {
      const ms = tm.getTime();
      if (Math.abs(ms - tlSunsetMs) > 90 * 60_000 || !covered(ms)) return null;
      const low = getInterpolatedWeather(camWeatherData, tm)[0]?.low;
      return typeof low === 'number' ? low : null;
    });
    return lowCloudWindow(points);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelapseMode, tlSunsetMs, camWeatherData, tzHours]);

  const tlSunAltAt = useCallback((ms: number) => getSunPosition(new Date(ms), latitude, longitude).altitude, [latitude, longitude]);

  // 촬영 중 카드의 예측 곡선: 시작부터 마지막 장까지 실제 시각의 해 고도를 25 칸으로 나눠 맑은 하늘 밝기의 단 변화로(`exposureCurve`).
  const runPred = useMemo(() => {
    const r = timelapse.run;
    if (!r) return [] as Array<number | null>;
    const span = Math.max(0, (r.plan.frames - 1) * r.plan.intervalS * 1000);
    const alts: number[] = [];
    for (let i = 0; i <= 24; i++) alts.push(getSunPosition(new Date(r.startMs + (span * i) / 24), latitude, longitude).altitude);
    return exposureStops(alts);
  }, [timelapse.run?.startMs, timelapse.run?.plan.frames, timelapse.run?.plan.intervalS, latitude, longitude]);
  const runActual = useMemo(() => {
    const r = timelapse.run;
    if (!r) return [];
    const stops = photoStops(tlLumas);
    const last = Math.max(1, r.plan.frames - 1);
    return stops.map((st, i) => ({ f: i / last, stops: st }));
  }, [tlLumas, timelapse.run?.plan.frames]);

  const optics = useMemo(
    () => previewOptics(W, stageLayoutH, measuredHfov ?? DEFAULT_SENSOR_SHORT_FOV_DEG, currentMagnification),
    [W, stageLayoutH, measuredHfov, currentMagnification],
  );
  // SkyScene3D는 전체 화면(W × rootH)으로 그려지므로, 가로 화각(hFovDeg)이 실카메라 스테이지(W × stageLayoutH)와 일치하도록 세로 FOV를 환산합니다.
  const simVFovDeg = useMemo(() => {
    const tanH = Math.tan(((optics.hFovDeg / 2) * Math.PI) / 180);
    const fullAspect = Math.max(1, rootH) / Math.max(1, W);
    const vRad = 2 * Math.atan(tanH * fullAspect);
    return Math.min(120, Math.max(10, (vRad * 180) / Math.PI));
  }, [optics.hFovDeg, rootH, W]);
  opticsRef.current = { hFovDeg: optics.hFovDeg, vFovDeg: optics.vFovDeg, simVFovDeg };

  remoteViewNowRef.current = () => {
    return { az: displayAz, el: displayEl, fov: simVFovDeg };
  };

  // 'blend' 또는 'sim' 모드에서 고정 시선/배율/스테이지 중심 변화 시 SkyScene3D 카메라 동기화
  useEffect(() => {
    if (!visible || viewMode === 'camera') {
      getPrimarySky()?.clearCameraLensOverride?.();
      return;
    }
    getPrimarySky()?.setCameraView?.(displayAz, displayEl, simVFovDeg, {
      rollDeg: displayRoll,
      centerOffsetYFrac,
    });
    return () => {
      getPrimarySky()?.clearCameraLensOverride?.();
    };
  }, [visible, viewMode, displayAz, displayEl, simVFovDeg, displayRoll, centerOffsetYFrac]);

  // 천체 모드 진입 시 Android Camera2 정적 성능(raw 지원 · 노출/ISO 범위 · 초점거리) 조회
  useEffect(() => {
    if (!visible || cameraTab !== 'astro') return;
    let cancelled = false;
    getAstroCapabilitiesAsync('back').then(caps => {
      if (!cancelled) setAstroCaps(caps);
    });
    return () => { cancelled = true; };
  }, [visible, cameraTab]);

  // 천체 모드 30분 앞당김 구름 타임라인(3분 간격 11프레임) 계산
  useEffect(() => {
    if (!visible || cameraTab !== 'astro' || !camWeatherData || camWeatherData.length === 0) return;
    let cancelled = false;
    const obsElev = Number(cameraSimState.terrain?.observerElevation) || 0;
    buildSkyTimeline({
      latitude,
      longitude,
      date: currentTime,
      observerElevM: obsElev,
      stepMinutes: 3,
      windowStartMs: currentTime.getTime(),
      windowDurationMin: 30,
      pathData: camWeatherData,
      isCancelled: () => cancelled,
      language,
    }).then(tl => {
      if (!cancelled) setAstroTimeline(tl);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, cameraTab, camWeatherData, currentTime, latitude, longitude, cameraSimState.terrain?.observerElevation, language]);

  const astroShotSummary = useMemo(
    () => planAstroShotSummary({
      settings: astroSettings,
      caps: astroCaps,
      latitudeDeg: latitude,
      azDeg: displayAz,
      elDeg: displayEl,
    }),
    [astroSettings, astroCaps, latitude, displayAz, displayEl],
  );

  const astroSimParams = useMemo(
    () => computeAstroSimExposureParams(astroSettings.durationSec, astroShotSummary.clampedIso),
    [astroSettings.durationSec, astroShotSummary.clampedIso],
  );
  const astroSimParamsRef = useRef(astroSimParams);
  astroSimParamsRef.current = astroSimParams;
  const astroResultRef = useRef(astroResult);
  astroResultRef.current = astroResult;
  const previewUriRef = useRef(previewUri);
  previewUriRef.current = previewUri;

  const astroAnalysis: AstroWindowAnalysis | null = useMemo(() => {
    if (cameraTab !== 'astro') return null;
    const obsData = camInterpolated[0];
    return analyzeAstroWindow({
      timeline: astroTimeline,
      view: {
        azDeg: displayAz,
        elDeg: displayEl,
        hfovDeg: optics.hFovDeg,
        vfovDeg: optics.vFovDeg,
      },
      startMs: currentTime.getTime(),
      exposureSec: astroSettings.durationSec,
      lookaheadMin: 30,
      layerWinds: resolveLayerWinds(obsData).winds,
    });
  }, [cameraTab, astroTimeline, camInterpolated, displayAz, displayEl, optics.hFovDeg, optics.vFovDeg, currentTime, astroSettings.durationSec]);

  // 목표 방향 진동·화면 가이드 루프 (안 맞으면 진동, 정렬 ≤2.5° 진입 시 진동 완전 정지)
  useEffect(() => {
    const active =
      visible &&
      viewMode === 'camera' &&
      !!lockedTarget &&
      !isCapturing &&
      astroNightPhase === null &&
      astroResult === null &&
      previewUri === null;

    if (!active || !lockedTarget) {
      Vibration.cancel();
      onTargetHystRef.current = false;
      if (!lockedTarget) setGuideState(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const step = () => {
      if (cancelled) return;
      const curAz =
        cameraFacing === 'front'
          ? (deviceAzimuthRef.current + 180) % 360
          : (deviceAzimuthRef.current + 360) % 360;
      const curEl = cameraFacing === 'front' ? -devicePitchRef.current : devicePitchRef.current;
      const g = evaluateDirectionGuide({
        currentAzDeg: curAz,
        currentElDeg: curEl,
        target: lockedTarget,
        wasOnTarget: onTargetHystRef.current,
      });
      onTargetHystRef.current = g.onTarget;
      setGuideState(g);

      if (!vibrationGuideOn || g.onTarget || g.pulseMs <= 0) {
        Vibration.cancel();
        timer = setTimeout(step, 180);
      } else {
        Vibration.vibrate(g.pulseMs);
        timer = setTimeout(step, g.intervalMs);
      }
    };
    step();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      Vibration.cancel();
    };
  }, [
    visible,
    viewMode,
    lockedTarget,
    vibrationGuideOn,
    isCapturing,
    astroNightPhase,
    astroResult,
    previewUri,
    cameraFacing,
  ]);

  // ── 천체 3D 시뮬 장노출 자동 프리뷰 (드래그/배율/설정/시각 변경 후 450ms 정지 시 렌더링) ──
  const [longExpPreviewUri, setLongExpPreviewUri] = useState<string | null>(null);
  const [isLongExpRendering, setIsLongExpRendering] = useState(false);
  const longExpFileRef = useRef<string | null>(null);
  const longExpReqIdRef = useRef(0);
  const displayAzRef = useRef(displayAz);
  displayAzRef.current = displayAz;
  const displayElRef = useRef(displayEl);
  displayElRef.current = displayEl;
  const longExpAzKey = frozenView ? Math.round(displayAz * 10) : Math.round(displayAz);
  const longExpElKey = frozenView ? Math.round(displayEl * 10) : Math.round(displayEl);

  const longExpTimeKey = isTimeMachineEnabled
    ? Math.floor(currentTime.getTime() / 60_000)
    : Math.floor(currentTime.getTime() / 300_000);

  useEffect(() => {
    // 조작 중이거나 천체+3D시뮬 모드가 아니면 이전 장노출 스틸을 즉시 걷어 60fps 3D가 보이게 합니다.
    const shouldRender =
      visible &&
      cameraTab === 'astro' &&
      viewMode === 'sim' &&
      !isInteracting &&
      astroNightPhase === null &&
      !astroResult &&
      !previewUri;

    longExpReqIdRef.current += 1;
    const reqId = longExpReqIdRef.current;

    if (!shouldRender) {
      setLongExpPreviewUri(null);
      setIsLongExpRendering(false);
      return;
    }

    const timer = setTimeout(async () => {
      const sky = getPrimarySky();
      if (!sky || reqId !== longExpReqIdRef.current) return;
      setIsLongExpRendering(true);
      try {
        const simMode =
          astroSettings.mode === 'tracked'
            ? (astroSettings.keepFixedGround ? 'tracked_fixed_ground' : 'tracked')
            : 'trails';
        const res = await sky.renderLongExposure(
          {
            az: displayAzRef.current,
            el: displayElRef.current,
            fov: simVFovDeg,
            rollDeg: displayRoll,
          },
          {
            mode: simMode,
            startTimeMs: currentTime.getTime(),
            durationSec: astroSettings.durationSec,
            steps: astroSimParams.stepsForPreview,
            exposureGain: astroSimParams.exposureGain,
            starBoost: astroSimParams.starBoost,
            shadowLift: astroSimParams.shadowLift,
            settleFrames: 4,
            requireReady: false,
            waitMs: 3000,
            format: 'jpeg',
            compress: 0.85,
          },
        );
        if (reqId !== longExpReqIdRef.current) return;
        if (res.uri) {
          const prev = longExpFileRef.current;
          longExpFileRef.current = res.uri;
          if (prev && prev !== res.uri) {
            FileSystem.deleteAsync(prev, { idempotent: true }).catch(() => {});
          }
          setLongExpPreviewUri(res.uri);
        }
      } finally {
        if (reqId === longExpReqIdRef.current) {
          setIsLongExpRendering(false);
        }
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [
    visible,
    cameraTab,
    viewMode,
    isInteracting,
    astroNightPhase,
    astroResult,
    previewUri,
    longExpAzKey,
    longExpElKey,
    displayRoll,
    simVFovDeg,
    astroSettings.mode,
    astroSettings.keepFixedGround,
    astroSettings.durationSec,
    astroSimParams.stepsForFinal,
    astroSimParams.exposureGain,
    astroSimParams.starBoost,
    astroSimParams.shadowLift,
    longExpTimeKey,
  ]);

  const handleToggleFreeze = useCallback(() => {
    if (viewMode === 'camera') {
      if (lockedTarget) {
        Vibration.cancel();
        setLockedTarget(null);
      } else {
        setLockedTarget({ azDeg: effectiveAz, elDeg: effectivePitch });
      }
      return;
    }
    if (frozenView) {
      setFrozenView(null);
      return;
    }
    setFrozenView({ azDeg: effectiveAz, elDeg: effectivePitch, rollDeg: 0 });
    setLockedTarget(null);
  }, [viewMode, lockedTarget, frozenView, effectiveAz, effectivePitch]);

  const handleGuideToFrozenView = useCallback(() => {
    if (!frozenView) return;
    setLockedTarget({ azDeg: frozenView.azDeg, elDeg: frozenView.elDeg });
    setFrozenView(null);
    setLongExpPreviewUri(null);
    setViewMode('camera');
  }, [frozenView]);

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
      // 2026-11-13 하늘 화면의 3D 장면을 빌려 이 시선으로 그립니다(primarySky.ts) — 카메라가 자기 3D 를 따로 만들던 것은
      //   대기·구름을 처음부터 다시 만들어 몹시 끊기고, 구름이 준비되기 전이라 늘 "준비 안 됨" 이었습니다.
      const simView = remoteViewNow();
      {
        const sky = getPrimarySky();
        if (sky) {
          const r = await sky.renderRemote(simView, { waitMs: 4000 });
          simRenderState = r.state;
          if (r.uri) { simUri = r.uri; simBufMean = sky.getLastBufferMean(); }
          else if (!r.ready) simNotReadyPhase = r.state?.volPhase ?? 'unknown';
          else simFailReason = r.error;
        } else {
          simFailReason = L3(language, '하늘 화면의 3D 가 없음 — 하늘 탭을 한 번 연 뒤 다시 시도', 'Sky screen 3D not available — open the Sky tab once and retry', '空画面の3Dがありません — 空タブを開いてから再試行');
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
        const sky = getPrimarySky();
        if (!simUri && sky) {
          const r = await sky.renderRemote(simView, { waitMs: 4000 });
          if (r.uri) { simNotReadyPhase = null; simRenderState = r.state; simUri = r.uri; simBufMean = sky.getLastBufferMean(); simFailReason = null; }
          else if (!r.ready) simNotReadyPhase = r.state?.volPhase ?? 'unknown';
          else simFailReason = r.error ?? simFailReason;
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
      setCapturedSunXY(visionSensor
        ? sunFractionInPhoto(currentSunPos.azimuth, currentSunPos.altitude, visionSensor, measuredHfov ?? DEFAULT_SENSOR_SHORT_FOV_DEG, currentMagnification)
        : null);
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
  }, [isCapturing, currentEnhancement, latitude, longitude, sunPos, weatherCacheList, currentTime, language, sensorAttitudeNow, runVisionOnPhoto, cameraSimState, measuredHfov, currentMagnification]);

  const handleAstroToggleRed = useCallback(() => {
    const next = !astroMonochromeRedRef.current;
    astroMonochromeRedRef.current = next;
    setAstroMonochromeRed(next);
    const sp = astroSimParamsRef.current;
    renderAstroStackPreviewAsync({
      maxLongEdge: 640,
      stretchGain: Math.min(2.6, sp.exposureGain * 0.85),
      asinhStrength: 10.0,
      subtractBlackPercentile: 0.2,
      monochromeRed: next,
    })
      .then(res => {
        if (res?.uri) {
          setAstroProgress(prev => (prev ? { ...prev, previewUri: res.uri } : prev));
        }
      })
      .catch(() => {});
  }, []);

  const handleAstroStart = useCallback(async () => {
    if (isCapturing || astroBusyRef.current) return;
    if (!isAstroCameraAvailable()) {
      Alert.alert(
        L3(language, '네이티브 천체 모듈 필요', 'Astro native module required', 'ネイティブ天体モジュールが必要'),
        L3(
          language,
          '16-bit Bayer RAW / 수동 장노출 합성은 Android 네이티브 빌드에서만 실행됩니다.',
          'Manual RAW long-exposure stacking requires the Android native build.',
          'RAW長時間露光の合成はAndroidネイティブビルドでのみ動作します。',
        ),
      );
      return;
    }

    Vibration.cancel();
    hapticShutter();
    astroAbortRef.current = false;
    astroStopEarlyRef.current = false;
    astroCountdownSkipRef.current = false;
    setAstroStopEarlyReq(false);
    setAstroProgress(null);
    setAstroResult(null);
    setSimPreviewUri(null);
    setSimPreviewError(null);
    setAstroSaved(false);
    setIsCapturing(true);

    // 1) CameraView를 먼저 내리고 검은색+빨간색 암적응 카운트다운 화면으로 전환
    const settingsSnap = { ...astroSettingsRef.current };
    const summarySnap = astroShotSummary;
    const simParamsSnap = computeAstroSimExposureParams(settingsSnap.durationSec, summarySnap.clampedIso);
    const delaySec = settingsSnap.countdownDelaySec;
    setAstroNightPhase('countdown');
    setAstroCountdownSec(delaySec);

    try {
      if (delaySec > 0) {
        const waitEnd = Date.now() + delaySec * 1000;
        while (Date.now() < waitEnd) {
          if (astroAbortRef.current) throw new Error('ASTRO_ABORTED');
          if (astroCountdownSkipRef.current) break;
          setAstroCountdownSec(Math.max(0.1, (waitEnd - Date.now()) / 1000));
          await new Promise(r => setTimeout(r, 120));
        }
      } else {
        // Android CameraView 언마운트가 Camera2 해제까지 닿도록 한 박자 양보
        await new Promise(r => setTimeout(r, 220));
      }
      if (astroAbortRef.current) throw new Error('ASTRO_ABORTED');

      setAstroNightPhase('capturing');
      gyroBurstPeakRef.current = 0;

      const startAtt = sensorAttitudeNow() ?? {
        yawDeg: effectiveAz,
        pitchDeg: effectivePitch,
        rollDeg: 0,
      };
      const startTimeMs = currentTime.getTime();
      const simMode =
        settingsSnap.mode === 'tracked'
          ? (settingsSnap.keepFixedGround ? 'tracked_fixed_ground' : 'tracked')
          : 'trails';
      const horizonSnap = horizonRef.current ?? await Promise.race([
        loadHorizon(latitude, longitude).catch(() => null),
        new Promise<null>(r => setTimeout(() => r(null), 1500)),
      ]);
      if (astroAbortRef.current) throw new Error('ASTRO_ABORTED');
      if (horizonSnap && !horizonRef.current) horizonRef.current = horizonSnap;

      const runRes = await runAstroCaptureStack({
        mode: settingsSnap.mode,
        totalExposureSec: settingsSnap.durationSec,
        iso: summarySnap.clampedIso,
        subExposureSec: summarySnap.subExposureSecUsed,
        latitudeDeg: latitude,
        longitudeDeg: longitude,
        getAttitudeNow: () =>
          sensorAttitudeNow() ?? { yawDeg: effectiveAz, pitchDeg: effectivePitch, rollDeg: 0 },
        horizon: horizonSnap,
        preferRaw: settingsSnap.preferRaw,
        keepFixedGround: settingsSnap.keepFixedGround,
        lockFocusInfinity: settingsSnap.lockFocusInfinity,
        maxTrailPx: settingsSnap.maxTrailPx,
        rejectCloudyFrames: settingsSnap.rejectCloudyFrames,
        outputFormat: 'png',
        stretchGain: Math.min(2.6, simParamsSnap.exposureGain * 0.85),
        asinhStrength: 10.0,
        consumeGyroPeakDegPerSec: () => {
          const peak = gyroBurstPeakRef.current;
          gyroBurstPeakRef.current = 0;
          return peak;
        },
        getPreviewMonochromeRed: () => astroMonochromeRedRef.current,
        previewIntervalFrames: 1,
        shouldAbort: () => astroAbortRef.current,
        shouldStopEarly: () => astroStopEarlyRef.current,
        onProgress: (p) => {
          setAstroProgress(p);
          if (p.lastShake?.severity === 'severe') hapticError();
        },
      });

      setAstroNightPhase('finalizing');

      // 시작 시선·시각·실제 노출시간 기준으로 3D 장노출 예측 스냅샷 생성 (별·달·구름 포함)
      let finalSimUri: string | null = null;
      let finalSimErr: string | null = null;
      const sky = getPrimarySky();
      if (sky) {
        const simRes = await sky.renderLongExposure(
          {
            az: startAtt.yawDeg,
            el: startAtt.pitchDeg,
            fov: simVFovDeg,
            rollDeg: startAtt.rollDeg,
          },
          {
            mode: simMode,
            startTimeMs,
            durationSec: Math.max(10, runRes.actualDurationSec || settingsSnap.durationSec),
            steps: simParamsSnap.stepsForFinal,
            exposureGain: simParamsSnap.exposureGain,
            starBoost: simParamsSnap.starBoost,
            shadowLift: simParamsSnap.shadowLift,
            settleFrames: 8,
            requireReady: false,
            waitMs: 5000,
            format: 'jpeg',
            compress: 0.9,
          },
        );
        finalSimUri = simRes.uri;
        finalSimErr = simRes.error;
      }

      setSimPreviewUri(finalSimUri);
      setSimPreviewError(finalSimErr);
      setAstroResultIso(summarySnap.clampedIso);
      setAstroResult(runRes);
      setAstroNightPhase(null);
    } catch (err: any) {
      setAstroNightPhase(null);
      if (err?.message !== 'ASTRO_ABORTED' && !astroAbortRef.current) {
        console.warn('[SunCamera] Astro capture error:', err);
        hapticError();
        Alert.alert(
          L3(language, '천체 촬영 오류', 'Astro Capture Error', '天体撮影エラー'),
          err?.message || L3(language, '촬영에 실패했습니다.', 'Capture failed.', '撮影に失敗しました。'),
        );
      }
    } finally {
      setIsCapturing(false);
    }
  }, [
    isCapturing,
    language,
    astroShotSummary,
    sensorAttitudeNow,
    effectiveAz,
    effectivePitch,
    currentTime,
    latitude,
    longitude,
    simVFovDeg,
  ]);

  const handleSaveAstroPng = useCallback(async () => {
    if (!astroResult || astroSaving || astroSaved) return;
    setAstroSaving(true);
    try {
      const granted = mediaPermission?.granted || (await requestMediaPermission()).granted;
      if (!granted) {
        Alert.alert(
          L3(language, '저장 권한 필요', 'Permission required', '保存権限が必要'),
          L3(language, '무손실 PNG를 저장하려면 사진 라이브러리 권한을 허용해 주세요.', 'Allow photo library permission to save the lossless PNG.', '無損失PNGの保存には写真ライブラリの権限が必要です。'),
        );
        return;
      }
      await MediaLibrary.saveToLibraryAsync(astroResult.uri);
      setAstroSaved(true);
      hapticShutter();
    } catch (e: any) {
      hapticError();
      Alert.alert(
        L3(language, 'PNG 저장 실패', 'Failed to save PNG', 'PNG保存失敗'),
        e?.message || 'Unknown error',
      );
    } finally {
      setAstroSaving(false);
    }
  }, [astroResult, astroSaving, astroSaved, mediaPermission, requestMediaPermission, language]);

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
  const scrubDayStartRef = useRef(0);
  useEffect(() => {
    if (visible && !cameraPermission?.granted) {
      requestCameraPermission();
    }
  }, [visible]);

  // 장면 줄의 "자동 시작": 장면 시각(앞으로의 실제 시각)이 되면 한 장 찍습니다(사진 탭에서만, 앱이 켜져 있는 동안).
  const [autoStartAt, setAutoStartAt] = useState<number | null>(null);
  const [autoNowMs, setAutoNowMs] = useState(() => Date.now());
  const handleCaptureRef = useRef(handleCapture);
  handleCaptureRef.current = handleCapture;
  useEffect(() => {
    if (!visible || !cameraScene || cameraTab !== 'sunset') return undefined;
    setAutoNowMs(Date.now());
    const id = setInterval(() => setAutoNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, cameraScene, cameraTab]);
  useEffect(() => {
    if (autoStartAt != null && autoStartDue(autoStartAt, autoNowMs)) {
      setAutoStartAt(null);
      handleCaptureRef.current();
    }
  }, [autoStartAt, autoNowMs]);
  useEffect(() => { if (!visible || !cameraScene || cameraTab !== 'sunset') setAutoStartAt(null); }, [visible, cameraScene, cameraTab]);
  const autoState = cameraScene && cameraTab === 'sunset' ? autoStartState(cameraScene.timeMs, autoNowMs) : null;
  const expoAdvice = useMemo(() => adviseExposure(sunPos.altitude), [sunPos.altitude]);
  const lensInfoText = useMemo(() => lensLine(optics.vFovDeg, W / Math.max(1, stageLayoutH)), [optics.vFovDeg, W, stageLayoutH]);

  if (!visible) return null;

  if (!cameraPermission?.granted) {
    return (
      <View style={[styles.overlayRoot, androidStatusBarH > 0 && { top: androidStatusBarH }]}>
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
      </View>
    );
  }

  const hhmmAt = (d: Date) => {
    const l = new Date(d.getTime() + tzHours * 3_600_000);
    return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
  };
  const localNowMs = currentTime.getTime() + tzHours * 3_600_000;
  const dayStartUtcMs = Math.floor(localNowMs / 86_400_000) * 86_400_000 - tzHours * 3_600_000;
  if (!isInteracting || scrubDayStartRef.current === 0) scrubDayStartRef.current = dayStartUtcMs;
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
  // 카메라 자세 — 방위·앙각·기울기는 현재 표시 시선(고정 시 frozenView, 아니면 실시간 센서)
  const overlayAttitude: Attitude = { yawDeg: displayAz, pitchDeg: displayEl, rollDeg: displayRoll };

  const handleCapturePress = handleCapture;
  const isTransparentStage = viewMode !== 'camera';

  return (
    <View
      style={[
        styles.overlayRoot,
        androidStatusBarH > 0 && { top: androidStatusBarH },
        isTransparentStage && !astroResult && astroNightPhase === null && !previewUri && { backgroundColor: 'transparent' },
      ]}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h > 0 && Math.abs(h - rootH) > 1) setRootH(h);
      }}
    >
      <View style={[styles.container, isTransparentStage && !astroResult && astroNightPhase === null && !previewUri && { backgroundColor: 'transparent' }]}>
        {astroResult ? (
          <AstroResultView
            result={astroResult}
            simPreviewUri={simPreviewUri}
            simError={simPreviewError}
            isoUsed={astroResultIso}
            isSaving={astroSaving}
            hasSaved={astroSaved}
            onSavePng={handleSaveAstroPng}
            onRetake={() => {
              setAstroResult(null);
              setSimPreviewUri(null);
              setSimPreviewError(null);
              setAstroSaved(false);
            }}
            language={language}
          />
        ) : astroNightPhase !== null ? (
          <AstroCaptureNightOverlay
            phase={astroNightPhase}
            mode={astroSettings.mode}
            summary={astroShotSummary}
            totalTargetDurationSec={astroSettings.durationSec}
            countdownRemainingSec={astroCountdownSec}
            progress={astroProgress}
            monochromeRed={astroMonochromeRed}
            onToggleMonochromeRed={handleAstroToggleRed}
            onSkipCountdown={() => { astroCountdownSkipRef.current = true; }}
            onStopEarlyAndSave={() => {
              astroStopEarlyRef.current = true;
              setAstroStopEarlyReq(true);
            }}
            onCancelAbort={() => {
              astroAbortRef.current = true;
              stopAstroSessionAsync().catch(() => {});
              setAstroNightPhase(null);
              setIsCapturing(false);
            }}
            stopEarlyRequested={astroStopEarlyReq}
            language={language}
          />
        ) : previewUri ? (
          // 촬영 후 미리보기 & 평가 입력 화면
          <View style={{ flex: 1, backgroundColor: color.bg }}>
            <ScrollView 
              contentContainerStyle={styles.previewScrollContent} 
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.previewTitle}>{t('recordSunset', language)}</Text>
              
              {/* 이미지 비교 영역: 크게 비교하기(반씩 · 겹침 · 위아래) + 차이 짚기 + 그때 예보 한 줄 (계획 8.7, 목업 5).
                  ⚠ 칸을 **조용히 지우지 않습니다.** 예전에는 simPreviewUri 가 없으면 이 칸을 통째로 안 그려서, 화면에서는 아무 설명 없이
                  시뮬레이터 썸네일만 사라졌습니다. 이제 자리를 지키고 왜 없는지 적습니다. */}
              <View style={{ position: 'relative' }}>
              <ResultCompare
                language={language}
                photoUri={previewUri}
                simUri={simPreviewUri}
                sunXY={capturedSunXY}
                forecast={forecastLine(
                  capturedWeatherInfo ? translateSunsetDesc(capturedWeatherInfo.description, language) : '',
                  capturedSimSample ? capturedSimSample.sunAltitude : NaN,
                  capturedSimSample ? capturedSimSample.sunAzimuth : NaN,
                  language,
                )}
                onOpenCalc={() => {
                  useCelestialStore.getState().requestOpenLearn({
                    section: 'why',
                    topic: 'score',
                    at: currentTime.getTime(),
                  });
                  onClose();
                }}
                missing={(
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
              />
              {/* ⚠ 썸네일이 검게 나올 때를 가르는 단서. 스냅샷 직전 GL 버퍼의 가운데 밝기입니다 — 0 에 가까우면 그린 것 자체가 검은 것이고,
                  0 이 아닌데 그림이 검으면 스냅샷 경로가 잃는 것입니다. 원인을 못 박으면 지웁니다. */}
              {simBufferMean >= 0 && (
                <View style={styles.simBufBadge} pointerEvents="none">
                  <Text style={styles.simBufBadgeText}>GL {simBufferMean.toFixed(0)}</Text>
                </View>
              )}
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
          <View style={[styles.liveRoot, isTransparentStage && { backgroundColor: 'transparent' }]}>
            <View
              style={[styles.stage, isTransparentStage && { backgroundColor: 'transparent' }]}
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                if (h > 0 && Math.abs(h - stageLayoutH) > 1) setStageLayoutH(h);
              }}
            >
              {viewMode !== 'sim' && astroNightPhase === null && !astroResult && !previewUri && (
                <View style={[StyleSheet.absoluteFill, viewMode === 'blend' && { opacity: 0.45 }]} pointerEvents="none">
                  <CameraView
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    facing={cameraFacing}
                    zoom={zoom}
                  />
                </View>
              )}
              {/* 천체 3D 시뮬레이션 정지 시 자동 장노출 프리뷰 — SkyScene3D와 동일한 전체 높이(rootH) 기준으로 배치해 잘림/들썩임 방지 */}
              {cameraTab === 'astro' && viewMode === 'sim' && longExpPreviewUri && (
                <Image
                  source={{ uri: longExpPreviewUri }}
                  style={{ position: 'absolute', top: 0, left: 0, width: W, height: rootH }}
                  resizeMode="cover"
                  fadeDuration={120}
                />
              )}
              {/* 소프트웨어 노출(밝기 부스트) — 카메라/겹쳐보기 그림에만 */}
              {viewMode !== 'sim' && exposure !== 0 && (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor:
                        exposure < 0
                          ? `rgba(0, 0, 0, ${Math.abs(exposure) * 0.7})`
                          : `rgba(255, 255, 255, ${exposure * (cameraTab === 'astro' ? 0.28 : 0.4)})`,
                    },
                  ]}
                  pointerEvents="none"
                />
              )}
              <View style={StyleSheet.absoluteFill} {...stagePanResponder.panHandlers} pointerEvents="auto" />
              {cameraFacing === 'back' && viewMode !== 'sim' && (
                <SunPathOverlay
                  width={W}
                  height={stageLayoutH}
                  optics={optics}
                  attitude={overlayAttitude}
                  path={sunDayPathPts}
                  sun={{ az: sunPos.azimuth, alt: apparentAltitude(sunPos.altitude) }}
                  sunLabel={`${L3(language, '태양', 'Sun', '太陽')} ${apparentAltitude(sunPos.altitude) >= 0 ? '+' : ''}${apparentAltitude(sunPos.altitude).toFixed(1)}°`}
                  event={markerEvent ? { az: markerEvent.az, label: `${t(markerEvent.type, language)} ${hhmmAt(markerEvent.at)}` } : null}
                  rulerY={stageLayoutH - dockInset - RULER_FROM_BOTTOM}
                />
              )}

              {/* 폰 연동 vs 손가락 수동 조작 시각 구분 프레임 */}
              {viewMode !== 'camera' && (
                frozenView ? (
                  <View style={styles.manualFrameOverlay} pointerEvents="none">
                    <View style={[styles.cornerBracket, styles.cornerTL]} />
                    <View style={[styles.cornerBracket, styles.cornerTR]} />
                    <View style={[styles.cornerBracket, styles.cornerBL]} />
                    <View style={[styles.cornerBracket, styles.cornerBR]} />
                  </View>
                ) : (
                  <View style={styles.liveCrosshairWrap} pointerEvents="none">
                    <View style={styles.liveCrosshairH} />
                    <View style={styles.liveCrosshairV} />
                    <View style={styles.liveCrosshairDot} />
                  </View>
                )
              )}

              {/* 무대 위 최소 상태 HUD (모드/방위 알약 · 보정 메뉴 · 카메라 전환) */}
              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                <Scrim edge="top" height={180} />
                <View style={[styles.topRow, { top: TOP_INSET }]} pointerEvents="box-none">
                  <Pressable
                    onPress={() => setTopInfoExpanded(v => !v)}
                    accessibilityRole="button"
                    aria-expanded={topInfoExpanded}
                    accessibilityLabel={L3(language, '촬영 정보 펼치기/접기', 'Toggle capture info', '撮影情報を開閉')}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }, { flexShrink: 1 }]}
                  >
                    <GlassSurface active={topInfoExpanded || (viewMode !== 'camera' && !!frozenView)} style={styles.modeAz}>
                      {cameraTab === 'astro' ? <Moon size={12} color={TEXT} /> : <Sun size={12} color={TEXT} />}
                      <Text style={styles.modeAzText} numberOfLines={1}>
                        {`AZ ${Math.round(displayAz)}° · ${displayEl >= 0 ? '+' : ''}${displayEl.toFixed(0)}°`}
                      </Text>
                      {topInfoExpanded ? <ChevronUp size={13} color={TEXT} /> : <ChevronDown size={13} color={TEXT} />}
                    </GlassSurface>
                  </Pressable>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <GlassChip
                      label={L3(language, '보정', 'Align', '補正')}
                      active={alignMenuOpen}
                      expanded={alignMenuOpen}
                      onPress={() => setAlignMenuOpen(v => !v)}
                      accessibilityLabel={L3(language, '화면·방위 보정', 'Align & Heading', '画面・方位補正')}
                      icon={(hasInterference || (headingStatus && !headingStatus.trueNorth))
                        ? <View style={[styles.dot, { backgroundColor: hasInterference ? color.danger : color.warning }]} />
                        : undefined}
                    />
                    {viewMode !== 'sim' && (
                      <GlassIconButton
                        icon={<RefreshCw size={15} color={TEXT} />}
                        onPress={() => setCameraFacing(prev => prev === 'back' ? 'front' : 'back')}
                        accessibilityLabel={L3(language, '앞뒤 카메라 바꾸기', 'Switch camera', 'カメラ切替')}
                      />
                    )}
                  </View>
                </View>

                {alignMenuOpen && (
                  <GlassSurface style={[styles.alignPopover, { top: TOP_INSET + 46 }]}>
                    {viewMode !== 'sim' && (
                      <PressScale
                        style={styles.alignPopoverBtn}
                        onPress={() => { setAlignMenuOpen(false); handleVisionCalibrate(); }}
                        onLongPress={() => { setAlignMenuOpen(false); handleSunSnap(); }}
                        disabled={isVisionRunning}
                      >
                        {isVisionRunning ? <ActivityIndicator size="small" color={TEXT} /> : <Sun size={14} color={TEXT} />}
                        <Text style={styles.alignPopoverText}>
                          {L3(language, '화면 보정 (길게: 해 맞춤)', 'Auto-align (hold: Sun)', '画面補正 (長押し: 太陽)')}
                        </Text>
                      </PressScale>
                    )}
                    <PressScale
                      style={styles.alignPopoverBtn}
                      onPress={() => { setAlignMenuOpen(false); handleCalibrate(); }}
                    >
                      <RotateCcw size={14} color={TEXT} />
                      <Text style={styles.alignPopoverText}>
                        {L3(language, '방위 맞춤 (나침반)', 'Calibrate heading', '方位補正')}
                      </Text>
                    </PressScale>
                  </GlassSurface>
                )}

                <View style={[styles.statusCol, { top: TOP_INSET + 38 + space.sm }]} pointerEvents="box-none">
                  {eclipseOn && eclipseEvent ? (
                    <EclipseCard event={eclipseEvent} language={language} tzHours={tzHours} />
                  ) : null}
                  {topInfoExpanded && viewMode !== 'camera' && (
                    <View style={styles.badge}>
                      {cameraTab === 'astro' && viewMode === 'sim' && isLongExpRendering ? (
                        <ActivityIndicator size="small" color={color.moon} style={{ transform: [{ scale: 0.7 }] }} />
                      ) : (
                        <Layers size={12} color={cameraTab === 'astro' ? color.moon : color.accent} />
                      )}
                      <Text style={[styles.badgeText, cameraTab === 'astro' && { color: color.moon }]}>
                        {cameraTab === 'astro' && viewMode === 'sim' && isLongExpRendering
                          ? L3(language, '장노출 렌더링 중…', 'Rendering preview…', '露光計算中…')
                          : viewMode === 'blend'
                            ? L3(language, '카메라+3D 겹침', 'Camera + 3D Blend', 'カメラ+3D')
                            : L3(language, '3D 시뮬레이션', '3D Simulation', '3Dシミュレーション')}
                      </Text>
                      <Text style={styles.microText}>
                        {`FOV ${Math.round(optics.vFovDeg)}°`}
                      </Text>
                    </View>
                  )}

                  {topInfoExpanded && cameraTab === 'sunset' && countdown && (
                    <View style={styles.countdownInline}>
                      <View style={[styles.dot, { backgroundColor: color.sun }]} />
                      <Text style={styles.countdownInlineLabel}>{countdown.label}</Text>
                      <Text style={styles.countdownInlineVal}>{countdown.value}</Text>
                    </View>
                  )}

                  {topInfoExpanded && cameraTab === 'astro' && (
                    <AstroForecastBanner
                      analysis={astroAnalysis}
                      durationSec={astroSettings.durationSec}
                      language={language}
                    />
                  )}
                  {cameraScene && (
                    <View style={styles.banner} accessibilityRole="summary">
                      <Text style={styles.bannerText} numberOfLines={2}>
                        {`${L3(language, '장면', 'Scene', 'シーン')} · ${cameraScene.name} · ${sceneSummary(cameraScene, { nowMs: Date.now(), tzHours, lang: language })}`}
                      </Text>
                      {autoState && autoState.kind !== 'far' && (
                        <Pressable
                          onPress={() => {
                            if (autoState.kind === 'wait') setAutoStartAt(autoStartAt == null ? cameraScene.timeMs : null);
                            else handleCapturePress();
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: autoStartAt != null }}
                          accessibilityLabel={autoState.kind === 'wait' ? L3(language, '자동 시작 켜고 끄기', 'Toggle auto start', '自動開始の切替') : L3(language, '지금 시작', 'Start now', '今すぐ開始')}
                          hitSlop={8}
                        >
                          <Text style={[styles.bannerText, { color: color.accent }]}>
                            {autoState.kind === 'wait'
                              ? `${autoStartAt != null ? L3(language, '자동 시작 중', 'Auto', '自動中') : L3(language, '자동 시작', 'Auto start', '自動開始')} ${autoState.text}`
                              : L3(language, '지금 시작', 'Start now', '今すぐ開始')}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => { Vibration.cancel(); setAutoStartAt(null); setLockedTarget(null); useCelestialStore.getState().setCameraScene(null); }}
                        accessibilityRole="button"
                        accessibilityLabel={L3(language, '장면 지우기', 'Clear scene', 'シーンを消す')}
                        hitSlop={8}
                      >
                        <X size={14} color={color.text} />
                      </Pressable>
                    </View>
                  )}
                  {previewing && (
                    <GlassSurface testID="tl-preview-banner" style={styles.glassBanner}>
                      <Text style={styles.glassBannerText}>{L3(language, '타임랩스 미리보기 재생 중', 'Playing timelapse preview', 'タイムラプスのプレビュー再生中')}{`  ${previewClock}`}</Text>
                      <Pressable onPress={stopPreview} accessibilityRole="button" accessibilityLabel={L3(language, '미리보기 멈추기', 'Stop preview', 'プレビューを止める')} hitSlop={8}>
                        <X size={16} color={TEXT} />
                      </Pressable>
                    </GlassSurface>
                  )}
                  {timelapse.run && timelapse.progress && (
                    // 목업 12(유리 카드, 2026-11-21): 제목 · 시작 · 지금 · REC, 값 칸(찍은 장 · 남은 시간 · 앨범), 밝기 곡선 · 배터리 · 화면 끄고 계속, 마치기. 끝나거나 멈추면 REC 는 사라지고 결과 글이 보입니다.
                    <TimelapseRunCard
                      language={language}
                      title={`${L3(language, '타임랩스', 'Timelapse', 'タイムラプス')} · ${timelapseKindLabel(timelapse.run.plan.kind, language)}`}
                      subtitle={`${clockLabel(timelapse.run.startMs, tzHours)} ${L3(language, '시작', 'started', '開始')} · ${L3(language, '지금', 'now', '今')} ${clockLabel(Date.now(), tzHours)}`}
                      running={timelapse.run.running}
                      error={timelapse.run.error}
                      taken={timelapse.run.taken}
                      frames={timelapse.run.plan.frames}
                      remaining={`${Math.floor(timelapse.progress.remainingS / 60)}:${String(timelapse.progress.remainingS % 60).padStart(2, '0')}`}
                      saved={savedSoFar(timelapse.run.plan, timelapse.run.taken)}
                      onFinish={timelapse.stop}
                      onDismiss={timelapse.dismiss}
                    >
                      <RunExtras
                        language={language}
                        pred={runPred}
                        actual={runActual}
                        battery={runBattery}
                        running={timelapse.run.running}
                        onScreenOff={() => setScreenOff(true)}
                      />
                    </TimelapseRunCard>
                  )}
                  {hasInterference && viewMode !== 'sim' && (
                    <View style={styles.banner}>
                      <Text style={[styles.bannerText, { color: color.warning }]}>
                        {L3(language, '자기 간섭! 폰을 8자로 움직여 주세요', 'Magnetic interference! Move the phone in a figure 8', '磁気干渉!スマホを8の字に動かしてください')}
                      </Text>
                    </View>
                  )}
                  {visionStatus && (
                    <View style={styles.banner}>
                      <Text style={styles.bannerText}>
                        {`${visionStatus}${measuredHfov ? ` · ${L3(language, '카메라 화각', 'Camera FOV', 'カメラ画角')} ${measuredHfov.toFixed(0)}°` : ''}`}
                      </Text>
                    </View>
                  )}
                </View>

                {/* 목표 방향 각도 맞추기 진동·원형 타깃 가이드 HUD */}
                {lockedTarget && guideState && viewMode === 'camera' && (
                  <DirectionGuideOverlay
                    target={lockedTarget}
                    guide={guideState}
                    optics={optics}
                    attitude={overlayAttitude}
                    vibrationEnabled={vibrationGuideOn}
                    onToggleVibration={() => setVibrationGuideOn(v => !v)}
                    onClearTarget={() => {
                      Vibration.cancel();
                      setLockedTarget(null);
                    }}
                    stageWidth={W}
                    stageHeight={stageLayoutH}
                    bottomInset={dockInset}
                    language={language}
                  />
                )}

                {/* 노출(노을 EV / 천체 프리뷰 밝기 부스트) — 오른쪽 세로 막대 */}
                {viewMode !== 'sim' && (
                  <View style={[styles.exposure, { top: TOP_INSET + 38 + space.sm }]}>
                    <Sun size={12} color={cameraTab === 'astro' ? color.moon : color.sun} />
                    <View style={styles.exposureTrackBox} {...exposurePanResponder.panHandlers}>
                      <View style={styles.exposureLine} />
                      <View
                        style={[
                          styles.exposureFill,
                          cameraTab === 'astro' && { backgroundColor: color.moon },
                          { height: `${((exposure + 1) / 2) * 100}%` },
                        ]}
                      />
                      <View
                        style={[
                          styles.exposureThumb,
                          cameraTab === 'astro' && { borderColor: color.moon },
                          { bottom: `${((exposure + 1) / 2) * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.microText}>
                      {cameraTab === 'astro'
                        ? `${exposure >= 0 ? '+' : ''}${Math.round(exposure * 100)}%`
                        : `${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)}`}
                    </Text>
                  </View>
                )}

              </View>
            </View>

            {/* 카메라의 새 틀(17절 4번 · 23절): 유리 막대 — 칩(줌 · 노출) · 시간 자(3D · 겹침일 때만) · 셔터 줄 · 모드 줄. 카메라는 화면 전체를 채웁니다. */}
            <CameraFrame
              language={language}
              chips={[
                ...[1, 2, 3, 5].map(mag => ({
                  id: `zoom-${mag}`,
                  label: Math.abs(currentMagnification - mag) < 0.25 ? `${currentMagnification.toFixed(1)}×` : `${mag}×`,
                  mono: true,
                  active: Math.abs(currentMagnification - mag) < 0.25,
                  onPress: () => setMagnification(mag),
                })),
                timelapseMode
                  ? { id: 'timelapse', label: tlSummaryLabel || L3(language, '노을 · 1시간 · 10초 · 12s', 'Sunset · 1h · 10s · 12s', '夕焼け · 1時間 · 10秒 · 12s'), mono: true, expands: true, openStage: 'full', accessibilityLabel: L3(language, '타임랩스 설정', 'Timelapse setup', 'タイムラプス設定') }
                  : cameraTab === 'astro'
                    ? { id: 'astro', label: astroChipLabel(astroSettings, astroShotSummary, language), mono: true, expands: true, openStage: 'full', accessibilityLabel: L3(language, '천체 설정', 'Astro settings', '天体設定') }
                    : { id: 'exposure', label: L3(language, '노출', 'Exposure', '露出'), expands: true },
              ]}
              panels={
                timelapseMode
                  ? {
                      timelapse: (
                        <TimelapsePanel
                          inline
                          visible
                          language={language}
                          events={{
                            sunrise: goldenTimeInfo.type === 'sunrise' && goldenTimeInfo.eventTime ? goldenTimeInfo.eventTime.getTime() : null,
                            sunset: goldenTimeInfo.type === 'sunset' && goldenTimeInfo.eventTime ? goldenTimeInfo.eventTime.getTime() : null,
                          }}
                          nowMs={currentTime.getTime()}
                          tzHours={tzHours}
                          peak={tlPeak}
                          lowCloud={tlLowCloud}
                          sunAltAt={tlSunAltAt}
                          onPreview={playPreview}
                          onStart={startTimelapse}
                          onClose={() => setCamStage('min')}
                          onSummaryChange={setTlSummaryLabel}
                        />
                      ),
                    }
                  : cameraTab === 'astro'
                    ? { astro: <AstroSettingsPanel settings={astroSettings} onChange={setAstroSettings} summary={astroShotSummary} caps={astroCaps} language={language} /> }
                    : { exposure: <ExposureCells language={language} advice={expoAdvice} lensMm={lensInfoText.mmText} lensText={lensInfoText.lensText} /> }
              }
              ruler={viewMode !== 'camera' && onTimeChange ? {
                timeMs: currentTime.getTime(),
                tz: tzHours,
                nowMs: Date.now(),
                onDragStart: () => setIsInteracting(true),
                onChange: (ms) => onTimeChange(new Date(ms)),
                onCommit: () => setIsInteracting(false),
                sunsetMs: goldenTimeInfo.type === 'sunset' && goldenTimeInfo.eventTime ? goldenTimeInfo.eventTime.getTime() : null,
                showNow: isTimeMachineEnabled,
                onNow: () => onResetTime?.(),
              } : null}
              left={
                <GlassChip
                  label=""
                  active={viewMode !== 'camera'}
                  icon={<Layers size={20} color={TEXT} />}
                  accessibilityLabel={L3(language, '보기 전환 (카메라 / 겹침 / 3D 시뮬)', 'Switch view mode', '表示モード切替')}
                  onPress={() => {
                    Vibration.cancel();
                    setViewMode(viewMode === 'camera' ? 'blend' : viewMode === 'blend' ? 'sim' : 'camera');
                  }}
                  style={{ width: 48, minHeight: 48, borderRadius: 24, paddingHorizontal: 0 }}
                />
              }
              right={(() => {
                const isAngleLocked = viewMode === 'camera' ? !!lockedTarget : !!frozenView;
                return (
                  <GlassChip
                    label=""
                    active={isAngleLocked}
                    icon={isAngleLocked ? (viewMode === 'camera' ? <Unlock size={20} color={TEXT} /> : <Compass size={20} color={TEXT} />) : <Lock size={20} color={TEXT} />}
                    accessibilityLabel={
                      viewMode === 'camera'
                        ? lockedTarget
                          ? L3(language, '저장한 목표 각도 해제', 'Clear saved camera angle', '保存した角度を解除')
                          : L3(language, '현재 본 각도를 저장해 두고 다시 맞추기', 'Save current angle to re-aim later', '現在の角度を記憶')
                        : frozenView
                          ? L3(language, '방향 고정 해제 — 실시간 폰 각도로 돌아가기', 'Unfreeze direction — return to live phone angle', '方向固定を解除')
                          : L3(language, '현재 방향 고정하기', 'Freeze current direction', '現在の方向を固定')
                    }
                    onPress={handleToggleFreeze}
                    style={{ width: 48, minHeight: 48, borderRadius: 24, paddingHorizontal: 0 }}
                  />
                );
              })()}
              shutterLabel={
                viewMode === 'sim'
                  ? frozenView
                    ? L3(language, '이 각도로 실제 카메라 맞추기', 'Aim real camera to this angle', 'この角度に実カメラを合わせる')
                    : L3(language, '실제 카메라로 전환', 'Switch to live camera', '実カメラへ切替')
                  : L3(language, '셔터', 'Shutter', 'シャッター')
              }
              shutterColor={cameraTab === 'astro' ? color.moon : undefined}
              shutterBusy={isCapturing && viewMode !== 'sim'}
              shutterInner={
                viewMode === 'sim' ? (
                  frozenView ? <Crosshair size={22} color={color.onAccent} /> : <Camera size={22} color={color.onAccent} />
                ) : isCapturing ? (
                  <ActivityIndicator size="small" color={color.onAccent} />
                ) : cameraTab === 'astro' ? (
                  <Moon size={22} color={color.onAccent} />
                ) : (
                  <Camera size={22} color={color.onAccent} />
                )
              }
              onShutter={() => {
                Vibration.cancel();
                if (viewMode === 'sim') {
                  if (frozenView) handleGuideToFrozenView();
                  else setViewMode('camera');
                  return;
                }
                if (timelapseMode) { setCamStage(s => (s === 'min' ? 'full' : 'min')); return; }
                if (cameraTab === 'astro') handleAstroStart();
                else handleCapturePress();
              }}
              stage={camStage}
              onStageChange={setCamStage}
              stripMode={timelapseMode ? 'timelapse' : eclipseOn ? 'event' : cameraTab === 'astro' ? 'astro' : 'photo'}
              stripModes={eclipseBase ? CAMERA_STRIP_MODES_EVENT : CAMERA_STRIP_MODES}
              onPickMode={(m) => {
                if (m === 'simulation' || m === 'sandbox') { useCelestialStore.getState().setExpertMode(m === 'sandbox'); onClose(); return; }
                const key = captureKeyFor(m);
                if (key) pickMode(key);
              }}
              onDockHeight={setDockInset}
            />
          </View>
        )}

        {/* 게시물 미리보기 & 자동 공개 SNS 공유 모달 */}
        <PostDetailModal
          visible={!!uploadedPhotoForModal}
          photo={uploadedPhotoForModal}
          onClose={() => {
            setUploadedPhotoForModal(null);
            onClose();
          }}
        />
      </View>
      {screenOff && timelapse.run?.running && (
        <ScreenOffCover language={language} taken={timelapse.run.taken} frames={timelapse.run.plan.frames} onWake={() => setScreenOff(false)} />
      )}
    </View>
  );
};



const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 500,
    backgroundColor: '#000',
  },
  // ── 전체 화면 카메라(2026-10-25) ──
  liveRoot: { flex: 1, backgroundColor: '#000' },
  stage: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#000' },
  topRow: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  countdownInline: {
    height: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm,
    borderRadius: radius.xs, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay,
  },
  countdownInlineLabel: { ...type.micro, color: color.textDim },
  countdownInlineVal: { ...type.label, color: color.text },
  dot: { width: 6, height: 6, borderRadius: 3 },
  modeAz: { minHeight: TOUCH, paddingHorizontal: 12, borderRadius: TOUCH / 2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  modeAzText: { ...type.micro, fontSize: 11, lineHeight: 14, color: TEXT, includeFontPadding: false, ...glassTextShadow },
  manualFrameOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    margin: 4,
    borderRadius: radius.md,
  },
  cornerBracket: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderColor: color.accent,
  },
  cornerTL: { top: -1.5, left: -1.5, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.md },
  cornerTR: { top: -1.5, right: -1.5, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.md },
  cornerBL: { bottom: -1.5, left: -1.5, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.md },
  cornerBR: { bottom: -1.5, right: -1.5, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.md },
  liveCrosshairWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveCrosshairH: {
    position: 'absolute',
    width: 22,
    height: 1,
    backgroundColor: 'rgba(74, 222, 128, 0.55)',
  },
  liveCrosshairV: {
    position: 'absolute',
    width: 1,
    height: 22,
    backgroundColor: 'rgba(74, 222, 128, 0.55)',
  },
  liveCrosshairDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.success,
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
  // 타임랩스 미리보기 띠(유리, 2026-11-21)
  glassBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: space.sm, paddingVertical: space.xs + 2, borderRadius: radius.md },
  glassBannerText: { ...type.label, color: TEXT, flexShrink: 1, ...glassTextShadow },
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
  alignPopover: { position: 'absolute', right: space.md, borderRadius: radius.sm, padding: 6, gap: 4, zIndex: 40 },
  alignPopoverBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, minHeight: TOUCH, borderRadius: radius.xs },
  alignPopoverText: { fontSize: 12, fontWeight: '700', color: TEXT, ...glassTextShadow },
});
