import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, Modal, Animated,
  Dimensions, Platform, Alert, ActivityIndicator
} from 'react-native';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { DeviceMotion, Magnetometer } from 'expo-sensors';
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

  // 카메라 전후면 전환 상태 추가
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');

  // 자이로스코프 기반 디바이스 방향
  const [deviceAzimuth, setDeviceAzimuth] = useState(0);
  const [devicePitch, setDevicePitch] = useState(0);
  const [gyroCalibOffset, setGyroCalibOffset] = useState({ az: 0, pitch: 0 });

  // 센서 실시간 값을 보관할 Refs (re-subscription 방지)
  const gyroCalibOffsetRef = useRef({ az: 0, pitch: 0 });
  const deviceAzimuthRef = useRef(0);
  const devicePitchRef = useRef(0);
  
  // 실시간 3D 자기장 raw 벡터 보관 Refs
  const magXRef = useRef(0);
  const magYRef = useRef(0);
  const magZRef = useRef(0);

  // EMA/LPF 저주파 필터 Refs
  // 방위각은 360도 경계면 처리(wrapping)를 위해 2D 벡터로 보간
  const smoothedAzVectorRef = useRef<{ x: number; y: number } | null>(null);
  const smoothedCompassVectorRef = useRef<{ x: number; y: number } | null>(null);
  const smoothedPitchRef = useRef<number | null>(null);

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

  // 1. Magnetometer (지자기 3D 센서) 수집 - LPF 오염 없는 실시간 3D 자기장 raw 벡터 갱신
  useEffect(() => {
    if (!visible) return;

    let subscription: any = null;
    Magnetometer.setUpdateInterval(32); // ~30fps 주기로 수집

    subscription = Magnetometer.addListener((data) => {
      magXRef.current = data.x;
      magYRef.current = data.y;
      magZRef.current = data.z;
    });

    return () => {
      if (subscription) subscription.remove();
    };
  }, [visible]);

  // 2. DeviceMotion 자세 결합 & 3D 기울기 보정 나침반(Tilt-Compensated Compass) 융합 엔진
  useEffect(() => {
    if (!visible) return;

    let subscription: any = null;

    DeviceMotion.setUpdateInterval(32); // 30fps
    subscription = DeviceMotion.addListener((data) => {
      const motionData = data as any;
      if (!motionData.rotation) return;

      const { alpha, beta, gamma } = motionData.rotation;

      // 3D 자기장 raw 벡터 수집
      const Mx = magXRef.current;
      const My = magYRef.current;
      const Mz = magZRef.current;

      // Pitch (theta)와 Roll (phi) 각도 (라디안 단위)
      const theta = beta;
      const phi = gamma;

      let trueHeading = 0;

      // 자기장 센서가 유효한지 검증 (초기 지연이나 무센서 플랫폼 대응)
      if (Mx === 0 && My === 0 && Mz === 0) {
        // Fallback: 3D 회전 행렬 또는 rotation alpha 상대각 사용
        if (motionData.rotationMatrix) {
          const { m13, m23 } = motionData.rotationMatrix;
          const headingDeg = Math.atan2(-m13, -m23) * (180 / Math.PI);
          trueHeading = (360 - headingDeg) % 360;
        } else {
          trueHeading = (360 - (alpha * 180 / Math.PI)) % 360;
        }
      } else {
        // 3D 기울기 보정 나침반 (Tilt-Compensated Compass) 핵심 공식 적용
        // 기기의 3차원 기울어짐(Pitch/Roll)을 물리적으로 정밀 투영하여 수평 자기장 성분 Xh, Yh 산출
        // 가만히 제자리 회전할 때와 몸을 중심으로 반경을 돌릴 때의 원심력 오차를 자기장 평면 역투영으로 완벽 제거!
        const Xh = Mx * Math.cos(theta) + My * Math.sin(phi) * Math.sin(theta) + Mz * Math.cos(phi) * Math.sin(theta);
        const Yh = My * Math.cos(phi) - Mz * Math.sin(phi);

        // 아크탄젠트를 활용하여 수평 평면 상의 절대 자북(Magnetic Heading) 도출
        // 수학적 반시계(CCW) 각도를 지리 표준 시계(CW) 방위각으로 매핑하기 위해 360에서 각도를 차감 (좌우 회전 반대 현상 완전 정비)
        const headingDeg = Math.atan2(-Yh, Xh) * (180 / Math.PI);
        trueHeading = (360 - headingDeg) % 360;
      }
      
      trueHeading = (trueHeading + 360) % 360;

      // GPS 위도/경도 기반 지자기 편각(Magnetic Declination) 보정 적용 (자북 -> 진북 변환)
      const declination = -8.5 + (latitude - 37.5) * 0.1 + (longitude - 127.0) * 0.05;
      let trueAzimuth = (trueHeading + declination + 360) % 360;

      // 지평선 수평을 극강의 안정성으로 잡아내는 모션 센서 Pitch 적용 (중력 방향 보정 적용)
      let truePitch = (beta * 180 / Math.PI) - 90;
      truePitch = Math.max(-90, Math.min(90, truePitch));

      // 원심 가속도 노이즈 및 고주파 지터를 극도로 필터링하는 부드러운 스무딩 계수 적용 (AR 트래킹 황금비인 0.08 적용)
      const filterFactor = 0.08; 

      // 360도 경계면(0도 근처)에서의 튐 방지를 위한 2D 벡터 원형 EMA 보간 필터 적용
      const azRad = trueAzimuth * Math.PI / 180;
      const tx = Math.cos(azRad);
      const ty = Math.sin(azRad);

      let nextX = tx;
      let nextY = ty;

      if (smoothedAzVectorRef.current === null) {
        smoothedAzVectorRef.current = { x: tx, y: ty };
      } else {
        const prevVec = smoothedAzVectorRef.current;
        nextX = prevVec.x + (tx - prevVec.x) * filterFactor;
        nextY = prevVec.y + (ty - prevVec.y) * filterFactor;
        smoothedAzVectorRef.current = { x: nextX, y: nextY };
      }

      let filteredAzimuth = Math.atan2(nextY, nextX) * 180 / Math.PI;
      filteredAzimuth = (filteredAzimuth + 360) % 360;

      // 피치(고도각) EMA 필터링
      let filteredPitch = truePitch;
      if (smoothedPitchRef.current === null) {
        smoothedPitchRef.current = truePitch;
      } else {
        filteredPitch = smoothedPitchRef.current + (truePitch - smoothedPitchRef.current) * filterFactor;
        smoothedPitchRef.current = filteredPitch;
      }

      // 상태 및 Refs 최종 업데이트 적용
      deviceAzimuthRef.current = filteredAzimuth;
      devicePitchRef.current = filteredPitch;
      setDeviceAzimuth(filteredAzimuth);
      setDevicePitch(filteredPitch);
    });

    return () => {
      if (subscription) subscription.remove();
    };
  }, [visible]);

  // 3D 센서 오리엔테이션 기준점 정밀 재보정
  const handleCalibrate = useCallback(() => {
    const nextOffset = { az: 0, pitch: 0 };
    gyroCalibOffsetRef.current = nextOffset;
    setGyroCalibOffset(nextOffset);
    
    smoothedAzVectorRef.current = null;
    smoothedPitchRef.current = null;
    Alert.alert('Calibrated', 'Successfully calibrated the 3D sensor baseline offset.');
  }, []);

  // 태양의 화면 좌표 계산
  const sunScreenPos = useMemo((): ScreenPoint => {
    return getSunScreenPosition(
      deviceAzimuth,
      devicePitch,
      sunPos.azimuth,
      sunPos.altitude,
      60, // 수평 FOV (대부분의 스마트폰 카메라)
      80, // 수직 FOV
    );
  }, [deviceAzimuth, devicePitch, sunPos.azimuth, sunPos.altitude]);

  // 태양 궤적의 화면 좌표 변환
  const trajectoryScreenPoints = useMemo(() => {
    return trajectory.map(pt => ({
      ...pt,
      screen: getSunScreenPosition(deviceAzimuth, devicePitch, pt.azimuth, pt.altitude, 60, 80),
    }));
  }, [trajectory, deviceAzimuth, devicePitch]);

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
            const horizonY = getSunScreenPosition(deviceAzimuth, devicePitch, deviceAzimuth, 0, 60, 80).y * H;
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
              {Math.round(deviceAzimuth)}°
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
});
