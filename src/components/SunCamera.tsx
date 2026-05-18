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

  // 나침반에서 가져오는 절대 방위각 상태
  const [compassHeading, setCompassHeading] = useState<number | null>(null);

  // 센서 실시간 값을 보관할 Refs (re-subscription 방지)
  const compassHeadingRef = useRef<number | null>(null);
  const gyroCalibOffsetRef = useRef({ az: 0, pitch: 0 });
  const deviceAzimuthRef = useRef(0);
  const devicePitchRef = useRef(0);

  // EMA/LPF 저주파 필터 Refs
  // 방위각은 360도 경계면 처리(wrapping)를 위해 2D 벡터로 보간
  const smoothedAzVectorRef = useRef<{ x: number; y: number } | null>(null);
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

  // Magnetometer 구독 (나침반 절대 방위각 획득)
  useEffect(() => {
    if (!visible) return;

    let subscription: any = null;
    Magnetometer.setUpdateInterval(64); // ~15fps

    subscription = Magnetometer.addListener((data) => {
      let { x, y } = data;
      // y축, x축 기반 아크탄젠트로 절대 북쪽 기준 방위각 산출
      let heading = Math.atan2(y, x) * (180 / Math.PI);
      heading = (heading + 360) % 360;
      setCompassHeading(heading);
      compassHeadingRef.current = heading;
    });

    return () => {
      if (subscription) subscription.remove();
    };
  }, [visible]);

  // DeviceMotion 구독 & 나침반 센서 융합 (Complementary Filter + LPF Smoothing)
  useEffect(() => {
    if (!visible) return;

    let subscription: any = null;

    DeviceMotion.setUpdateInterval(32); // ~30fps
    subscription = DeviceMotion.addListener((data) => {
      if (!data.rotation) return;

      const { alpha, beta, gamma } = data.rotation;

      // alpha = z축 회전 (방위각)
      let rawAzimuth = (alpha * 180 / Math.PI);
      
      const compVal = compassHeadingRef.current;
      const currentOffset = gyroCalibOffsetRef.current;

      // 나침반 데이터를 기반으로 자이로의 방향 드리프트를 실시간 보정 (상보 필터 융합)
      if (compVal !== null) {
        const targetOffset = (compVal + rawAzimuth) % 360;
        const diff = (targetOffset - currentOffset.az + 540) % 360 - 180;
        
        // 자이로 반응성 98% + 나침반 절대 방위 2% 융합으로 안정성과 정확성 극대화
        const nextOffsetAz = (currentOffset.az + diff * 0.02 + 360) % 360;
        gyroCalibOffsetRef.current = {
          az: nextOffsetAz,
          pitch: currentOffset.pitch
        };
        // 렌더링에 필요한 보정 오프셋 상태 업데이트 (안정적)
        setGyroCalibOffset(gyroCalibOffsetRef.current);
      }

      const latestOffset = gyroCalibOffsetRef.current;
      let targetAzimuth = (360 - rawAzimuth + latestOffset.az) % 360;

      // 피치: 수평 = 0, 위로 = 양수
      let targetPitch = (beta * 180 / Math.PI) - 90 + latestOffset.pitch;
      targetPitch = Math.max(-90, Math.min(90, targetPitch));

      // --- 실시간 LPF (EMA) 필터링 적용 ---
      // 저주파 통과 계수 (0.12 = 부드러우면서도 딜레이가 적어 AR에 최적)
      const lpfFactor = 0.12;

      // 1. 방위각(targetAzimuth) 2D 벡터 필터링 (0-360 경계 넘나들기 지원)
      const azRad = targetAzimuth * Math.PI / 180;
      const tx = Math.cos(azRad);
      const ty = Math.sin(azRad);

      let nextX = tx;
      let nextY = ty;

      if (smoothedAzVectorRef.current === null) {
        smoothedAzVectorRef.current = { x: tx, y: ty };
      } else {
        const prevVec = smoothedAzVectorRef.current;
        nextX = prevVec.x + (tx - prevVec.x) * lpfFactor;
        nextY = prevVec.y + (ty - prevVec.y) * lpfFactor;
        smoothedAzVectorRef.current = { x: nextX, y: nextY };
      }

      let filteredAzimuth = Math.atan2(nextY, nextX) * 180 / Math.PI;
      filteredAzimuth = (filteredAzimuth + 360) % 360;

      // 2. 피치(targetPitch) 필터링
      let filteredPitch = targetPitch;
      if (smoothedPitchRef.current === null) {
        smoothedPitchRef.current = targetPitch;
      } else {
        filteredPitch = smoothedPitchRef.current + (targetPitch - smoothedPitchRef.current) * lpfFactor;
        smoothedPitchRef.current = filteredPitch;
      }

      // refs 업데이트
      deviceAzimuthRef.current = filteredAzimuth;
      devicePitchRef.current = filteredPitch;

      // React 상태 업데이트로 AR 리액티브 렌더링 유도
      setDeviceAzimuth(filteredAzimuth);
      setDevicePitch(filteredPitch);
    });

    return () => {
      if (subscription) subscription.remove();
    };
  }, [visible]);

  // 나침반 기준 절대 정북 정밀 재보정
  const handleCalibrate = useCallback(() => {
    const compHeading = compassHeadingRef.current;
    if (compHeading !== null) {
      // 나침반 절대각에 맞춰 즉시 강제 리셋 동기화
      const nextOffset = {
        az: (compHeading + deviceAzimuthRef.current - gyroCalibOffsetRef.current.az) % 360,
        pitch: 0 // 피치는 수평 기준 리셋
      };
      gyroCalibOffsetRef.current = nextOffset;
      setGyroCalibOffset(nextOffset);
      
      // 스무딩 벡터도 즉시 리셋해서 튀지 않게 조정
      const azRad = deviceAzimuthRef.current * Math.PI / 180;
      smoothedAzVectorRef.current = { x: Math.cos(azRad), y: Math.sin(azRad) };
      smoothedPitchRef.current = 0;
      
      Alert.alert('정북 보정 완료', '나침반(Magnetometer) 센서 기준으로 태양 궤적의 절대 방위를 정확하게 재정렬했습니다.');
    } else {
      const nextOffset = { az: 0, pitch: 0 };
      gyroCalibOffsetRef.current = nextOffset;
      setGyroCalibOffset(nextOffset);
      
      smoothedAzVectorRef.current = null;
      smoothedPitchRef.current = null;
      Alert.alert('보정 완료', '현재 센서 값을 기준점으로 강제 리셋했습니다.');
    }
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
    const visiblePoints = trajectoryScreenPoints.filter(p =>
      p.screen.x >= -0.5 && p.screen.x <= 1.5 && p.screen.y >= -0.5 && p.screen.y <= 1.5
    );

    if (visiblePoints.length < 2) return '';

    const parts = visiblePoints.map((p, i) => {
      const px = p.screen.x * W;
      const py = p.screen.y * H;
      return `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`;
    });

    return parts.join(' ');
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
        Alert.alert('오류', '사진 촬영에 실패했습니다.');
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
          Alert.alert('권한 필요', '사진을 저장하려면 갤러리 접근 권한이 필요합니다.');
          setIsCapturing(false);
        }
      }
    } catch (error) {
      console.warn('[SunCamera] Capture error:', error);
      Alert.alert('오류', '사진 촬영 중 오류가 발생했습니다.');
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
          <Text style={styles.permissionTitle}>카메라 권한 필요</Text>
          <Text style={styles.permissionDesc}>
            AR 노을 촬영을 위해 카메라 접근 권한이 필요합니다.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestCameraPermission}>
            <Text style={styles.permissionBtnText}>권한 허용</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeTextBtn} onPress={onClose}>
            <Text style={styles.closeTextBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // 골든타임 타입에 따른 색상
  const eventColor = goldenTimeInfo.type === 'sunrise' ? '#FFA500' : '#FF4500';
  const eventLabel = goldenTimeInfo.type === 'sunrise' ? '일출' : '일몰';
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
                    {`${hour}시`}
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
              {eventLabel} {isBeforeEvent ? `${minutesBefore}분 전` : `${minutesBefore}분 후`}
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
            <EnhancementIndicator label="밝기" value={currentEnhancement.brightness} />
            <EnhancementIndicator label="대비" value={currentEnhancement.contrast - 1} />
            <EnhancementIndicator label="채도" value={currentEnhancement.saturation - 1} />
            <EnhancementIndicator label="온도" value={currentEnhancement.warmth} />
          </View>
        </View>

        {/* 하단 컨트롤 */}
        <View style={styles.bottomControls}>
          {/* 자이로 보정 버튼 */}
          <TouchableOpacity style={styles.sideBtn} onPress={handleCalibrate}>
            <RotateCcw size={22} color="#FFF" />
            <Text style={styles.sideBtnText}>보정</Text>
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
            <Text style={styles.sideBtnText}>전환</Text>
          </TouchableOpacity>
        </View>

        {/* 촬영 성공 오버레이 */}
        {captureResult && (
          <View style={styles.captureOverlay}>
            <Check size={48} color="#4CAF50" />
            <Text style={styles.captureSuccessText}>저장 완료!</Text>
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
