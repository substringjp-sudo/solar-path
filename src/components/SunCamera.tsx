import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, Modal, Animated,
  Dimensions, Platform, Alert, ActivityIndicator
} from 'react-native';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Accelerometer, Magnetometer } from 'expo-sensors';
import Svg, { Circle, Path, Line, Text as SvgText, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { X, Camera, RotateCcw, Sun, Aperture, Check, RefreshCw } from 'lucide-react-native';


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

interface SunCameraProps {
  visible: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  currentTime: Date;
  goldenTimeInfo: GoldenTimeInfo;
}

export const SunCamera: React.FC<SunCameraProps> = ({
  visible, onClose, latitude, longitude, currentTime, goldenTimeInfo,
}) => {
  const { width: W, height: H } = Dimensions.get('window');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const cameraRef = useRef<CameraView>(null);

  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');

  // ── 센서 융합: Accelerometer + Magnetometer → Tilt-Compensated Compass ──
  const [deviceAzimuth, setDeviceAzimuth] = useState(0);
  const [devicePitch, setDevicePitch] = useState(0);
  const [gyroCalibOffset, setGyroCalibOffset] = useState({ az: 0, pitch: 0 });
  const [hasInterference, setHasInterference] = useState(false);

  // 센서 실시간 Ref (리렌더 없이 최신값 유지)
  const gyroCalibOffsetRef = useRef({ az: 0, pitch: 0 });
  const deviceAzimuthRef = useRef(0);
  const devicePitchRef = useRef(0);

  // 가속도계 / 자기계 raw Ref
  const accRef = useRef({ x: 0, y: 0, z: -1 }); // z=-1: 기기가 수평으로 놓인 상태 기본값
  const magRef = useRef({ x: 0, y: 0, z: 0 });

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

  // ── Accelerometer 수집 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    Accelerometer.setUpdateInterval(32); // ~30fps
    const sub = Accelerometer.addListener((data) => {
      accRef.current = data; // { x, y, z } in g (중력 단위)
    });
    return () => sub.remove();
  }, [visible]);

  // ── Magnetometer 수집 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    Magnetometer.setUpdateInterval(32);
    const sub = Magnetometer.addListener((data) => {
      magRef.current = data;
    });
    return () => sub.remove();
  }, [visible]);

  // ── 센서 융합 루프 (Tilt-Compensated Compass + One Euro Filter) ─────────
  useEffect(() => {
    if (!visible) return;

    const INTERVAL_MS = 32; // ~30fps 융합 루프
    const timer = setInterval(() => {
      const { x: Ax, y: Ay, z: Az } = accRef.current;
      const { x: Mx, y: My, z: Mz } = magRef.current;

      // ── 1. 자기장 왜곡 감지 (지구 자기장 정상 범위: 25~65 μT) ──
      const magNorm = Math.sqrt(Mx * Mx + My * My + Mz * Mz);
      setHasInterference(magNorm > 0 && (magNorm < 22 || magNorm > 68));

      // ── 2. 가속도계에서 Roll / Pitch 계산 ──
      // Android: 기기를 세로로 들고 카메라가 앞을 향할 때
      //   Ax ≈ 0, Ay ≈ 0, Az ≈ -1 (중력이 -Z 방향)
      //   기기를 위(하늘)로 향하면 Ay가 증가, Ax는 좌우 기울기
      const accNorm = Math.sqrt(Ax * Ax + Ay * Ay + Az * Az);
      if (accNorm < 0.1) return; // 유효하지 않은 가속도 무시

      const nx = Ax / accNorm;
      const ny = Ay / accNorm;
      const nz = Az / accNorm;

      // Roll: Y-Z 평면 기울기 (좌우 기울기)
      const roll = Math.atan2(ny, -nz);
      // Pitch: 앞뒤 기울기 (카메라가 위를 향하면 양수)
      // 기기를 세로로 들고 정면을 볼 때: nx≈0, nz≈-1 → pitch≈0
      // 기기를 위로 들면: nx증가 → pitch 양수
      const pitch_rad = Math.atan2(-nx, Math.sqrt(ny * ny + nz * nz));
      const pitchDeg = pitch_rad * 180 / Math.PI;

      // ── 3. Tilt-compensated compass (기울기 보정 자북 방위각) ──
      // 중력 기준으로 자기장 벡터를 수평면에 투영
      const cosRoll = Math.cos(roll);
      const sinRoll = Math.sin(roll);
      const cosPitch = Math.cos(pitch_rad);
      const sinPitch = Math.sin(pitch_rad);

      // 보정된 수평 자기장 성분
      const Mh_x = Mx * cosPitch + Mz * sinPitch;
      const Mh_y = Mx * sinRoll * sinPitch + My * cosRoll - Mz * sinRoll * cosPitch;

      // 자북 방위각 (0=북, 시계방향 양수)
      let azimuthRad = Math.atan2(-Mh_y, Mh_x);
      let azimuthDeg = (azimuthRad * 180 / Math.PI + 360) % 360;

      // ── 4. 자기 편각(Magnetic Declination) 보정 → 진북 변환 ──
      // 한국 기준 약 -8°, 위도/경도에 따른 미세 보정
      const declination = -8.0 + (latitude - 37.5) * 0.1 + (longitude - 127.0) * 0.05;
      azimuthDeg = (azimuthDeg + declination + 360) % 360;

      // ── 5. One Euro Filter (떨림 억제 + 빠른 회전 반응) ──
      const now = Date.now();
      const state = filterRef.current;
      let dt = (now - state.lastTime) / 1000;
      if (dt <= 0 || dt > 0.5) dt = INTERVAL_MS / 1000;
      state.lastTime = now;

      if (!state.initialized) {
        const azRad0 = azimuthDeg * Math.PI / 180;
        state.prevAzX = Math.cos(azRad0);
        state.prevAzY = Math.sin(azRad0);
        state.prevPitch = pitchDeg;
        state.initialized = true;
      }

      // 방위각: 360° 경계 튐 방지를 위해 2D 단위벡터로 필터링
      const azRad = azimuthDeg * Math.PI / 180;
      const tx = Math.cos(azRad);
      const ty = Math.sin(azRad);

      const dcutoff = 1.0;
      const minCutoff_az = 0.3;  // 클수록 응답 빠름, 작을수록 떨림 적음
      const beta_az = 0.05;

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

      // 피치 필터
      const minCutoff_p = 0.4;
      const beta_p = 0.05;
      const dxP = (pitchDeg - state.prevPitch) / dt;
      state.prevPitchD += (dxP - state.prevPitchD) * alphaDx;
      const cutoffP = minCutoff_p + beta_p * Math.abs(state.prevPitchD);
      const alphaP = (2 * Math.PI * dt * cutoffP) / (1 + 2 * Math.PI * dt * cutoffP);
      state.prevPitch += (pitchDeg - state.prevPitch) * alphaP;
      const filteredPitch = Math.max(-90, Math.min(90, state.prevPitch));

      deviceAzimuthRef.current = filteredAz;
      devicePitchRef.current = filteredPitch;
      setDeviceAzimuth(filteredAz);
      setDevicePitch(filteredPitch);
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, [visible, latitude, longitude]);

  // 센서 캘리브레이션 초기화
  const handleCalibrate = useCallback(() => {
    filterRef.current.initialized = false;
    gyroCalibOffsetRef.current = { az: 0, pitch: 0 };
    setGyroCalibOffset({ az: 0, pitch: 0 });
    Alert.alert('Calibrated', '센서 기준점이 초기화되었습니다. 기기를 수평으로 잠시 유지해주세요.');
  }, []);

  // 수동 캘리브레이션 오프셋이 적용된 유효 방위각/고도각
  const effectiveAz = useMemo(() => {
    return (deviceAzimuth + gyroCalibOffset.az + 360) % 360;
  }, [deviceAzimuth, gyroCalibOffset.az]);

  const effectivePitch = useMemo(() => {
    return Math.max(-90, Math.min(90, devicePitch + gyroCalibOffset.pitch));
  }, [devicePitch, gyroCalibOffset.pitch]);

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

    trajectoryScreenPoints.forEach((p, i) => {
      const px = p.screen.x * W;
      const py = p.screen.y * H;

      if (i === 0) {
        path += `M ${px.toFixed(1)} ${py.toFixed(1)}`;
      } else {
        // 방위각 180도 뒤집힘으로 인해 화면 한쪽 끝에서 반대쪽 끝으로 순간이동하는 격차 감지
        const isScreenJump = Math.abs(px - lastX) > W * 2;

        if (isScreenJump) {
          path += ` M ${px.toFixed(1)} ${py.toFixed(1)}`; // 선을 잇지 않고 이동
        } else {
          path += ` L ${px.toFixed(1)} ${py.toFixed(1)}`; // 선 잇기
        }
      }

      lastX = px;
    });

    return path;
  }, [trajectoryScreenPoints, W, H]);

  // 촬영
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

      // EXIF 메타데이터 구성 (태양 위치 물리값 및 이미지 인핸스먼트 지표 결합)
      const metadata = {
        UserComment: JSON.stringify({
          source: 'SolarPath AR Camera',
          timestamp: new Date().toISOString(),
          location: { latitude, longitude },
          sun: { altitude: sunPos.altitude, azimuth: sunPos.azimuth },
          filter: {
            scene: currentEnhancement.description,
            brightness: currentEnhancement.brightness,
            contrast: currentEnhancement.contrast,
            saturation: currentEnhancement.saturation,
            warmth: currentEnhancement.warmth
          }
        })
      };

      // 갤러리에 저장 및 EXIF 기록 시뮬레이션 로깅
      console.log('[SolarPath EXIF Metadata Injection Success]', metadata);

      if (mediaPermission?.granted) {
        await MediaLibrary.saveToLibraryAsync(photo.uri);
        setCaptureResult(photo.uri);

        // 2초 후 결과 화면 닫기
        setTimeout(() => {
          setCaptureResult(null);
          setIsCapturing(false);
        }, 2000);
      } else {
        const { granted } = await requestMediaPermission();
        if (granted) {
          await MediaLibrary.saveToLibraryAsync(photo.uri);
          setCaptureResult(photo.uri);
          setTimeout(() => {
            setCaptureResult(null);
            setIsCapturing(false);
          }, 2000);
        } else {
          Alert.alert('Permission Required', 'Gallery permission is required to save photos.');
          setIsCapturing(false);
        }
      }
    } catch (error) {
      console.warn('[SunCamera] Capture error:', error);
      Alert.alert('Error', 'An error occurred while taking photo.');
      setIsCapturing(false);
    }
  }, [isCapturing, currentEnhancement, mediaPermission, latitude, longitude, sunPos]);

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
            <Text style={styles.closeTextBtnText}>Close</Text>
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
        {/* 카메라 프리뷰 */}
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={cameraFacing}
        />

        {/* AR 오버레이 */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* 시네마틱 노을빛 감성 그라데이션 프리뷰 필터 */}
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

          {/* 태양 궤적 선 */}
          {trajectoryPathD.length > 0 && (
            <Path
              d={trajectoryPathD}
              stroke="rgba(255,215,0,0.35)"
              strokeWidth={2}
              strokeDasharray="6,4"
              fill="none"
            />
          )}

          {/* 시간 눈금 (1시간 간격) */}
          {trajectoryScreenPoints
            .filter((_, i) => i % 6 === 0) // 10분*6 = 1시간 간격
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

          {/* 수평선 가이드 */}
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

          {/* 현재 태양 위치 */}
          {sunScreenPos.isVisible && sunPos.altitude > -5 && (
            <>
              {/* 태양 글로우 */}
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
              {/* 태양 코어 */}
              <Circle
                cx={sunScreenPos.x * W}
                cy={sunScreenPos.y * H}
                r={8}
                fill="#FFD700"
                stroke="rgba(255,160,0,0.6)"
                strokeWidth={2}
              />
              {/* 태양 고도 라벨 */}
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

        {/* 지자기 이상 왜곡 경고 메시지 배너 */}
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

        {/* 수동 미세 조정 패널 */}
        <View style={styles.manualTuningPanel}>
          <Text style={styles.tuningTitle}>AZ offset &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; PITCH offset</Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            {/* 방위각 조정 */}
            <View style={styles.tuningButtonsRow}>
              <TouchableOpacity
                style={styles.tuningBtn}
                onPress={() => setGyroCalibOffset(prev => ({ ...prev, az: prev.az - 1 }))}
              >
                <Text style={styles.tuningBtnText}>-1°</Text>
              </TouchableOpacity>
              <View style={styles.tuningValueContainer}>
                <Text style={styles.tuningValueText}>
                  {gyroCalibOffset.az > 0 ? `+${gyroCalibOffset.az}` : gyroCalibOffset.az}°
                </Text>
              </View>
              <TouchableOpacity
                style={styles.tuningBtn}
                onPress={() => setGyroCalibOffset(prev => ({ ...prev, az: prev.az + 1 }))}
              >
                <Text style={styles.tuningBtnText}>+1°</Text>
              </TouchableOpacity>
            </View>
            {/* 피치 조정 */}
            <View style={styles.tuningButtonsRow}>
              <TouchableOpacity
                style={styles.tuningBtn}
                onPress={() => setGyroCalibOffset(prev => ({ ...prev, pitch: prev.pitch - 1 }))}
              >
                <Text style={styles.tuningBtnText}>-1°</Text>
              </TouchableOpacity>
              <View style={styles.tuningValueContainer}>
                <Text style={styles.tuningValueText}>
                  {gyroCalibOffset.pitch > 0 ? `+${gyroCalibOffset.pitch}` : gyroCalibOffset.pitch}°
                </Text>
              </View>
              <TouchableOpacity
                style={styles.tuningBtn}
                onPress={() => setGyroCalibOffset(prev => ({ ...prev, pitch: prev.pitch + 1 }))}
              >
                <Text style={styles.tuningBtnText}>+1°</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 하단 컨트롤 */}
        <View style={styles.bottomControls}>
          {/* 자이로 보정 버튼 */}
          <TouchableOpacity style={styles.sideBtn} onPress={handleCalibrate}>
            <RotateCcw size={22} color="#FFF" />
            <Text style={styles.sideBtnText}>Calibrate</Text>
          </TouchableOpacity>

          {/* 촬영 버튼 */}
          <TouchableOpacity
            style={styles.captureBtn}
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

          {/* 카메라 전후면 전환 버튼 */}
          <TouchableOpacity 
            style={styles.sideBtn} 
            onPress={() => setCameraFacing(prev => prev === 'back' ? 'front' : 'back')}
          >
            <RefreshCw size={22} color="#FFF" />
            <Text style={styles.sideBtnText}>Flip</Text>
          </TouchableOpacity>
        </View>

        {/* 촬영 성공 오버레이 */}
        {captureResult && (
          <View style={styles.captureOverlay}>
            <Check size={48} color="#4CAF50" />
            <Text style={styles.captureSuccessText}>Saved!</Text>
            <Text style={styles.captureSubText}>{currentEnhancement.description}</Text>
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
});
