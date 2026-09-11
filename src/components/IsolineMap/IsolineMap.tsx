import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, useWindowDimensions } from 'react-native';
import { Calendar, Clock, Info, Sun, Sunrise, Sunset, Compass, Globe, MapPin, Crosshair, Star, Hash } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { getSunPosition, getCelestialEvents, getSubsolarPoint, getTerminatorSegments } from '../../utils/celestial';
import { buildSunOverlay, isIsolineScale } from '../../utils/solarGeometry';
import { buildRadarFrame, isRadarScale } from '../../utils/cloudRadar';
import { fetchDayWeatherRing, CloudPathData } from '../../utils/weather';
import { localDateString } from '../../utils/localDate';
import { mapModeFor, globeProgress, deltaForStretch, GLOBE_STRETCH } from '../../utils/mapProjection';
import { canPickLocation, locationTapAction, solarBadgeMaxWidth, bottomLeftMaxWidth } from '../../utils/locationPick';
import * as Location from 'expo-location';
import { LandSilhouette } from './LandSilhouette';
import { formatLocalTime, getLocalTimeAtLocation } from '../../utils/timezone';
import { t } from '../../utils/i18n';
import { IsolineControls } from './IsolineControls';
import { IsolineGuideModal } from './IsolineGuideModal';
import { MapCanvas } from './MapCanvas';
import { MapGlobe } from './MapGlobe';
import { SunAzimuthView } from '../MapScreen/SunAzimuthView';
import * as d3 from 'd3-geo';

interface IsolineMapProps {
  theme: any;
  currentTime: Date;
  isActive: boolean;
  /** 좌표 직접 입력 — 기존 위치 선택 모달을 엽니다. 폼을 새로 만들지 않습니다. */
  onOpenPicker?: () => void;
}

const AUTOPLAY_TICK_MS = 150;
const AUTOPLAY_STEP_MINUTES = 20;

export const IsolineMap: React.FC<IsolineMapProps> = ({ theme, currentTime, isActive, onOpenPicker }) => {
  const { location, timezoneOffsetHours, language, savedLocations, setLocation } = useCelestialStore();
  const { width } = useWindowDimensions();
  const isTablet = width > 900;

  const lat = location?.coords.latitude ?? 37.5665;
  const lon = location?.coords.longitude ?? 126.9780;

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date(currentTime));
  const [isPlaying, setIsPlaying] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const [longitudeDelta, setLongitudeDelta] = useState(60);
  /** 실루엣을 지도와 **같은 자리**에 그리려면 중심 좌표까지 있어야 합니다. */
  // ⚠ 지도는 `initialRegion` 으로 **사용자 위치**에서 시작합니다. 여기에
  //   서울을 박아 두면 첫 `onRegionChangeComplete` 전까지 실루엣·구·"한가운데로"
  //   가 전부 엉뚱한 곳을 가리킵니다. 같은 값에서 출발시킵니다.
  const [region, setRegion] = useState({ latitude: lat, longitude: lon, longitudeDelta: 60 });
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [projectionType, setProjectionType] = useState<'2D' | '3D'>('2D');
  const [globeScale, setGlobeScale] = useState(150);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRegionChangeComplete = useCallback((r: { latitude: number; longitude: number; longitudeDelta: number }) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setLongitudeDelta(r.longitudeDelta);
      setRegion({ latitude: r.latitude, longitude: r.longitude, longitudeDelta: r.longitudeDelta });
    }, 350); // 350ms 디바운스
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // 탭이 비활성화되면(다른 탭으로 스와이프) 자동재생을 일시정지해 배터리/성능을 절약합니다.
  useEffect(() => {
    if (!isActive && isPlaying) setIsPlaying(false);
  }, [isActive]);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSelectedDate((prev) => new Date(prev.getTime() + AUTOPLAY_STEP_MINUTES * 60 * 1000));
    }, AUTOPLAY_TICK_MS);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const terminator = useMemo(() => getTerminatorSegments(selectedDate), [selectedDate]);
  const subsolar = useMemo(() => getSubsolarPoint(selectedDate), [selectedDate]);

  // 줌 레벨에 따라 제공될 등시선 시간 간격 (4시간, 2시간, 1시간, 30분) - 렉 방지용 하한선 30분 지정
  const step = useMemo(() => {
    if (projectionType === '2D') {
      if (longitudeDelta >= 180) return 240; // 4시간
      if (longitudeDelta >= 90) return 120;  // 2시간
      if (longitudeDelta >= 40) return 60;   // 1시간
      return 30;                             // 30분
    } else {
      if (globeScale <= 120) return 240;     // 4시간
      if (globeScale <= 250) return 120;     // 2시간
      if (globeScale <= 500) return 60;      // 1시간
      return 30;                             // 30분
    }
  }, [projectionType, longitudeDelta, globeScale]);

  /**
   * 좁은 축척에서 지도에 얹을 **태양 오버레이**. 넓으면 null 입니다.
   *
   * 등치선과 태양경로는 같은 기하의 두 표현입니다 — 등고도선은 직하점 중심의
   * 원이고, 태양 방위는 그 원의 법선입니다(`solarGeometry.ts`). 화면 폭이 1°
   * 아래로 내려가면 등치선은 화면 안에서 5분도 안 벌어져 뜻을 잃으므로,
   * 같은 기하를 **법선 쪽**으로 바꿔 보여 줍니다.
   *
   * ⚠ 3D 지구본에는 안 붙입니다 — 거기서는 축척이 늘 넓습니다.
   */
  const sunOverlay = useMemo(
    () => (projectionType === '2D' ? buildSunOverlay(selectedDate, lat, lon, longitudeDelta) : null),
    [projectionType, selectedDate, lat, lon, longitudeDelta],
  );
  const isLocalScale = sunOverlay !== null;

  /**
   * 구름 레이더 자료. **스토어가 이미 미리 받아 둔 고리**라 캐시 적중입니다 —
   * 지도를 연다고 요청이 늘지 않습니다.
   *
   * ⚠ **오늘 날짜만** 씁니다. 다른 날을 고르면 그 날짜의 고리를 새로 받게 되는데
   * 97점짜리 요청이라 슬라이더를 미는 동안 계속 나갑니다. 날짜를 옮기면 레이더는
   * 조용히 사라집니다.
   */
  const [ring, setRing] = useState<CloudPathData[] | null>(null);
  const isToday = useMemo(
    () => localDateString(selectedDate) === localDateString(new Date()),
    [selectedDate],
  );
  const wantRadar = isToday && projectionType === '2D' && isRadarScale(longitudeDelta, lat);

  useEffect(() => {
    if (!wantRadar) return;
    let alive = true;
    fetchDayWeatherRing(lat, lon, new Date())
      .then(r => { if (alive) setRing(r); })
      .catch(err => console.warn('레이더용 구름 고리를 못 받았습니다:', err));
    return () => { alive = false; };
  }, [wantRadar, lat, lon]);

  const radar = useMemo(
    () => (wantRadar ? buildRadarFrame(ring, lat, lon, selectedDate.getTime(), longitudeDelta) : null),
    [wantRadar, ring, lat, lon, selectedDate, longitudeDelta],
  );

  /**
   * 축척이 정하는 그리기 모드 — 타일 → 실루엣 → 구.
   *
   * 메르카토르는 넓힐수록 화면 위아래가 다른 배율이 됩니다. 늘어남이 2배를
   * 넘으면 평면이 거짓말을 시작하므로 구로 갑니다. ⚠ 그 지점은 **위도 함수**
   * 입니다 — 서울 33°, 적도 67°, 60°N 24°(`mapProjection.ts`).
   */
  const autoMode = useMemo(
    () => mapModeFor(region.latitude, longitudeDelta),
    [region.latitude, longitudeDelta],
  );
  /** 구가 부풀어 오르는 진행도 0~1. 모서리 반지름을 여기에 이어 둡니다. */
  const morph = useMemo(
    () => globeProgress(region.latitude, longitudeDelta),
    [region.latitude, longitudeDelta],
  );
  // 사용자가 버튼으로 3D 를 고르면 그대로 둡니다. 2D 일 때만 축척이 정합니다.
  const showGlobe = projectionType === '3D' || autoMode === 'globe';
  const showSilhouette = !showGlobe && autoMode === 'silhouette';

  /**
   * 한가운데를 집을 수 있는 축척인가. 문턱은 **지형 표본의 가장 바깥 고리
   * (40km)** 입니다 — 그보다 넓으면 중앙 한 점이 지형보다 거칠어집니다.
   * ⚠ 3D 구에서는 화면 중앙이 지구 위 한 점이 아니므로 아예 못 고릅니다.
   */
  const pickable = !showGlobe && canPickLocation(longitudeDelta, region.latitude);
  /** 배지가 버튼 줄 밑으로 파고들지 않게 자릅니다(320px 기기에서 21px 겹칩니다). */
  const badgeMaxWidth = useMemo(() => solarBadgeMaxWidth(width, 3), [width]);
  /**
   * 왼쪽 아래 세로줄(구름 읽기값 · 범례)의 너비 상한.
   *
   * ⚠ 이 둘은 예전에 **같은 자리**(left:10)에 절대 좌표로 놓여 겹쳤습니다.
   * 지금은 한 세로줄에 넣고 오른쪽 아래 인셋만큼 물러섭니다(`locationPick.ts`).
   */
  const bottomLeftWidth = useMemo(
    () => bottomLeftMaxWidth(bodySize.width || width, width, isLocalScale),
    [bodySize.width, width, isLocalScale],
  );

  const moveToCenter = useCallback(() => {
    setLocation({ coords: { latitude: region.latitude, longitude: region.longitude } } as any);
    setLocMenuOpen(false);
  }, [region.latitude, region.longitude, setLocation]);

  const moveToGps = useCallback(async () => {
    setLocMenuOpen(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(loc);
    } catch (e) {
      console.warn('현재 위치를 못 받았습니다:', e);
    }
  }, [setLocation]);

  /**
   * ⚠ 탭의 뜻이 축척을 따라 바뀝니다. 넓은 축척에서는 한가운데가 뜻이 없으므로
   * 그 자리를 메뉴가 대신 씁니다 — 덕분에 **숨은 롱프레스를 몰라도** 줌만 빼고
   * 한 번 누르면 메뉴를 만납니다(`locationPick.ts`).
   */
  const onLocationTap = useCallback(() => {
    if (showGlobe || locationTapAction(longitudeDelta, region.latitude) === 'menu') {
      setLocMenuOpen(o => !o);
    } else {
      moveToCenter();
    }
  }, [showGlobe, longitudeDelta, region.latitude, moveToCenter]);

  const dateKey = selectedDate.toISOString().slice(0, 10);
  const allTerminators = useMemo(() => {
    // 좁은 축척에서는 안 그리므로 만들지도 않습니다 — 하루치 터미네이터를
    // 48번 계산하는 일이라 그냥 두면 값만 버립니다.
    if (!isIsolineScale(longitudeDelta) && projectionType === '2D') return [];
    const list = [];
    const base = new Date(dateKey);
    base.setUTCHours(0, 0, 0, 0);
    
    for (let min = 0; min < 1440; min += step) {
      const time = new Date(base.getTime() + min * 60 * 1000);
      const segments = getTerminatorSegments(time);
      list.push({
        time,
        sunrise: segments.sunrise,
        sunset: segments.sunset
      });
    }
    return list;
  }, [dateKey, step, longitudeDelta, projectionType]);

  const nightPolygonCoords = useMemo(() => {
    try {
      // 구글맵 Polygon의 래핑 반전 특성에 대응하기 위해,
      // 안티포달 포인트 대신 태양 남중점(subsolar) 자체를 투사 원점으로 주어 바깥쪽(밤 영역)이 칠해지도록 유도합니다.
      const circleGeoJSON = d3.geoCircle().center([subsolar.longitude, subsolar.latitude]).radius(90)();
      if (!circleGeoJSON || !circleGeoJSON.coordinates) return [];

      const segments: Array<Array<{ latitude: number; longitude: number }>> = [];

      if (circleGeoJSON.type === 'Polygon') {
        circleGeoJSON.coordinates.forEach((ring: any) => {
          const seg = ring.map((pt: [number, number]) => ({
            longitude: pt[0],
            latitude: pt[1]
          }));
          if (seg.length > 0) segments.push(seg);
        });
      } else if (circleGeoJSON.type === 'MultiPolygon') {
        circleGeoJSON.coordinates.forEach((polygon: any) => {
          polygon.forEach((ring: any) => {
            const seg = ring.map((pt: [number, number]) => ({
              longitude: pt[0],
              latitude: pt[1]
            }));
            if (seg.length > 0) segments.push(seg);
          });
        });
      }
      return segments;
    } catch (e) {
      console.error('Failed to generate 2D night polygon:', e);
      return [];
    }
  }, [subsolar]);

  const sunPosAtSelected = useMemo(() => getSunPosition(selectedDate, lat, lon), [selectedDate, lat, lon]);
  const eventsAtSelected = useMemo(() => getCelestialEvents(selectedDate, lat, lon), [selectedDate, lat, lon]);

  const localSunrise = useMemo(() => getLocalTimeAtLocation(eventsAtSelected.sunrise, timezoneOffsetHours), [eventsAtSelected, timezoneOffsetHours]);
  const localSunset = useMemo(() => getLocalTimeAtLocation(eventsAtSelected.sunset, timezoneOffsetHours), [eventsAtSelected, timezoneOffsetHours]);

  const dayLengthLabel = useMemo(() => {
    const totalMin = Math.max(0, Math.round((eventsAtSelected.sunset.getTime() - eventsAtSelected.sunrise.getTime()) / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
  }, [eventsAtSelected]);

  const dateLabel = useMemo(() => {
    return `${selectedDate.getUTCFullYear()}.${String(selectedDate.getUTCMonth() + 1).padStart(2, '0')}.${String(selectedDate.getUTCDate()).padStart(2, '0')}`;
  }, [selectedDate]);

  const timeLabel = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(selectedDate.getUTCHours())}:${pad(selectedDate.getUTCMinutes())} UTC`;
  }, [selectedDate]);

  const handleSlidingStart = () => setIsPlaying(false);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={styles.headerRow}>
        <View style={[styles.headerChip, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <View style={[styles.headerIconWrap, { backgroundColor: theme.bg }]}>
            <Calendar size={14} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerLabel, { color: theme.subText }]} numberOfLines={1}>{t('isolineSelectedDate', language)}</Text>
            <Text style={[styles.headerValue, { color: theme.text }]} numberOfLines={1}>{dateLabel}</Text>
          </View>
        </View>
        <View style={[styles.headerChip, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <View style={[styles.headerIconWrap, { backgroundColor: theme.bg }]}>
            <Clock size={14} color="#38BDF8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerLabel, { color: theme.subText }]} numberOfLines={1}>{t('isolineSelectedTimeUtc', language)}</Text>
            <Text style={[styles.headerValue, { color: theme.text }]} numberOfLines={1}>{timeLabel}</Text>
          </View>
        </View>
      </View>

      {/* 가변 메인 프레임: 지도가 화면의 남은 높이를 꽉 채웁니다 */}
      <View 
        style={[
          styles.mapCard,
          {
            borderColor: theme.border,
            /**
             * ⚠ **사각형에서 원으로 이어집니다.** 모서리 반지름을 전환 진행도에
             * 묶어 두면, 구로 넘어갈 때 모양이 툭 바뀌지 않고 같은 원이 부풀어
             * 오르는 것으로 읽힙니다. 동네 축척에서는 진행도가 0 이라 평소의
             * 둥근 사각형 그대로입니다 — 화면을 낭비하지 않습니다.
             */
            borderRadius: 14 + morph * (Math.max(bodySize.width, bodySize.height) / 2 - 14),
          },
        ]}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setBodySize(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
        }}
        onTouchStart={() => useCelestialStore.getState().setGestureBlocked(true)}
        onTouchEnd={() => useCelestialStore.getState().setGestureBlocked(false)}
        onTouchCancel={() => useCelestialStore.getState().setGestureBlocked(false)}
      >
        {!showGlobe ? (
          <MapCanvas
            lat={lat}
            lon={lon}
            hasLocation={!!location}
            subsolar={subsolar}
            terminator={terminator}
            allTerminators={allTerminators}
            nightPolygonCoords={nightPolygonCoords}
            onRegionChangeComplete={handleRegionChangeComplete}
            theme={theme}
            selectedDate={selectedDate}
            sunOverlay={sunOverlay}
            radar={radar}
          />
        ) : (
          <MapGlobe
            subsolar={subsolar}
            terminator={terminator}
            allTerminators={allTerminators}
            lat={lat}
            lon={lon}
            hasLocation={!!location}
            theme={theme}
            isActive={isActive}
            initialScale={globeScale}
            selectedDate={selectedDate}
            onScaleChange={setGlobeScale}
          />
        )}

        {/* ── 중간 띠: 타일을 덮고 육지 윤곽만 ────────────────────────────
               구로 가기 전에 그림체를 먼저 맞춰 둡니다(`LandSilhouette`). */}
        {showSilhouette && bodySize.width > 0 && (
          <LandSilhouette region={region} width={bodySize.width} height={bodySize.height} theme={theme} />
        )}

        <TouchableOpacity
          onPress={() => setProjectionType((p) => (p === '2D' ? '3D' : '2D'))}
          style={[styles.projectionBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          {projectionType === '2D' ? (
            <Globe size={16} color={theme.text} />
          ) : (
            <Compass size={16} color={theme.accent} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setGuideVisible(true)}
          style={[styles.guideBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          <Info size={16} color={theme.text} />
        </TouchableOpacity>

        {/* ── 위치 옮기기 ────────────────────────────────────────────────
               탭의 뜻이 축척을 따라 바뀝니다 — 좁으면 한가운데로, 넓으면
               메뉴(`locationPick.ts`). 꾹 누르기는 어디서나 메뉴입니다. */}
        <TouchableOpacity
          onPress={onLocationTap}
          onLongPress={() => setLocMenuOpen(true)}
          delayLongPress={350}
          style={[styles.locBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          <MapPin size={16} color={pickable ? theme.accent : theme.text} />
        </TouchableOpacity>

        {/* 바깥을 누르면 닫힙니다 — 안 그러면 메뉴가 지도를 계속 가립니다. */}
        {locMenuOpen && (
          <TouchableOpacity
            style={styles.locBackdrop}
            activeOpacity={1}
            onPress={() => setLocMenuOpen(false)}
          />
        )}

        {locMenuOpen && (
          <View style={[styles.locMenu, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <TouchableOpacity style={styles.locMenuItem} onPress={moveToGps} activeOpacity={0.7}>
              <Crosshair size={13} color={theme.accent} />
              <Text style={[styles.locMenuText, { color: theme.text }]} numberOfLines={1}>
                {t('isolineMoveHere', language)}
              </Text>
            </TouchableOpacity>

            {savedLocations.slice(0, 5).map((loc) => (
              <TouchableOpacity
                key={loc.id}
                style={styles.locMenuItem}
                activeOpacity={0.7}
                onPress={() => {
                  setLocation({ coords: { latitude: loc.latitude, longitude: loc.longitude } } as any);
                  setLocMenuOpen(false);
                }}
              >
                <Star size={13} color={theme.subText} />
                <Text style={[styles.locMenuText, { color: theme.text }]} numberOfLines={1}>
                  {loc.name}
                </Text>
              </TouchableOpacity>
            ))}

            {onOpenPicker && (
              <TouchableOpacity
                style={styles.locMenuItem}
                activeOpacity={0.7}
                onPress={() => { setLocMenuOpen(false); onOpenPicker(); }}
              >
                <Hash size={13} color={theme.subText} />
                <Text style={[styles.locMenuText, { color: theme.subText }]} numberOfLines={1}>
                  {t('isolineEnterCoords', language)}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ⚠ 십자선이 없으면 "한가운데로" 는 장님 탭입니다 — 어디로 갈지
               보고 누르게 합니다. 고를 수 있는 축척에서만 뜹니다. */}
        {pickable && (
          <View style={styles.pickCross} pointerEvents="none">
            <View style={[styles.pickCrossH, { backgroundColor: theme.accent }]} />
            <View style={[styles.pickCrossV, { backgroundColor: theme.accent }]} />
          </View>
        )}

        {/* 지도 우측 상단 태양 정보 오버레이 배지 */}
        <View style={[styles.solarOverlay, { backgroundColor: theme.glass, borderColor: theme.border, maxWidth: badgeMaxWidth }]}>
          <View style={styles.solarOverlayItem}>
            <Sun size={11} color="#FFD700" />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {sunPosAtSelected.altitude.toFixed(0)}° / {sunPosAtSelected.azimuth.toFixed(0)}°
            </Text>
          </View>
          <View style={[styles.solarOverlayDivider, { backgroundColor: theme.border }]} />
          <View style={styles.solarOverlayItem}>
            <Sunrise size={11} color="#FFA500" />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {formatLocalTime(localSunrise, 'HH:mm')}
            </Text>
          </View>
          <View style={[styles.solarOverlayDivider, { backgroundColor: theme.border }]} />
          <View style={styles.solarOverlayItem}>
            <Sunset size={11} color="#FF4500" />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {formatLocalTime(localSunset, 'HH:mm')}
            </Text>
          </View>
        </View>

        {/* ── 왼쪽 아래 세로줄: 구름 읽기값 · 범례 ─────────────────────
               구름 읽기값은 차트 탭이 나르던 것 중 지도가 못 그리는 둘 —
               **구름 종류**와 **바람** — 입니다. 종류는 층별 운량과 강수로
               가립니다(`cloudMatrix.classifyCloud`). 예전에는 해시였습니다.

               ⚠ 이 둘이 예전에 **같은 자리**에 절대 좌표로 놓여 겹쳤습니다.
               이제 한 세로줄이 쌓으므로 한쪽 높이가 바뀌어도 안 부딪힙니다. */}
        <View style={[styles.bottomLeft, { maxWidth: bottomLeftWidth }]}>
          {radar && (
            <View style={[styles.cloudReadout, { backgroundColor: theme.glass, borderColor: theme.border }]}>
              <Text style={[styles.cloudReadoutTitle, { color: theme.text }]} numberOfLines={1}>
                {radar.observerClass.name}
              </Text>
              <Text style={[styles.cloudReadoutSub, { color: theme.subText }]} numberOfLines={1}>
                저 {Math.round(radar.observerLayers.low)} · 중 {Math.round(radar.observerLayers.mid)} · 상 {Math.round(radar.observerLayers.high)}
                {radar.observerLayers.precipitationMm > 0
                  ? `  비 ${radar.observerLayers.precipitationMm.toFixed(1)}mm`
                  : ''}
              </Text>
              <Text style={[styles.cloudReadoutSub, { color: theme.subText }]} numberOfLines={1}>
                {radar.wind
                  ? `구름 ${Math.round(radar.wind.toBearingDeg)}° 쪽으로 ${Math.round(radar.wind.speedKmh)}km/h`
                  : '바람 자료 없음'}
              </Text>
            </View>
          )}
          <View style={[styles.legend, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            {radar && (
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: 'rgba(226,232,240,0.75)' }]} />
                <Text style={[styles.legendText, { color: theme.subText }]}>
                  구름 · 바깥 칸 {Math.round(radar.outerSpacingKm)}km
                </Text>
              </View>
            )}
            {isLocalScale ? (
              <>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: '#38BDF8' }]} />
                  <Text style={[styles.legendText, { color: theme.subText }]}>등고도선</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: '#FB923C' }]} />
                  <Text style={[styles.legendText, { color: theme.subText }]}>태양 방위 (그 법선)</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: '#FFA500' }]} />
                  <Text style={[styles.legendText, { color: theme.subText }]}>{t('isolineSunriseLine', language)}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: '#FF4500' }]} />
                  <Text style={[styles.legendText, { color: theme.subText }]}>{t('isolineSunsetLine', language)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── 극좌표 인셋 ────────────────────────────────────────────────
               좁은 축척에서만 뜹니다. 지도 평면은 방위는 그려도 **고도**를
               못 그립니다 — 그건 이 원만 가진 값입니다. */}
        {isLocalScale && (
          <View style={[styles.polarInset, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <SunAzimuthView theme={theme} currentTime={selectedDate} compact />
          </View>
        )}

      </View>

      {/* 화면 최하단 시간/날짜 조작 컨트롤러 */}
      <View style={styles.bottomControls}>
        <IsolineControls
          selectedDate={selectedDate}
          onChangeDate={setSelectedDate}
          onSlidingStart={handleSlidingStart}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          theme={theme}
        />
      </View>

      <IsolineGuideModal visible={guideVisible} onClose={() => setGuideVisible(false)} theme={theme} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  headerChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  headerIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  headerValue: {
    fontSize: 12,
    fontWeight: '900',
  },
  mapCard: {
    flex: 1,
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    position: 'relative',
  },
  guideBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  /**
   * 위치 버튼 — 오른쪽 위 셋째 자리.
   *
   * `right: 86` 은 `locationPick.topButtonsWidth(3) === 118` 과 맞물립니다.
   * 여기를 옮기면 태양 배지 상한도 같이 틀어지므로 그쪽 상수도 고쳐야 합니다.
   */
  locBtn: {
    position: 'absolute',
    top: 10,
    right: 86,
    width: 32,
    height: 32,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  locBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 19,
  },
  locMenu: {
    position: 'absolute',
    top: 48,
    right: 10,
    minWidth: 150,
    maxWidth: 210,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    zIndex: 20,
  },
  locMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  locMenuText: { fontSize: 11.5, fontWeight: '600', flexShrink: 1 },
  /** 한가운데 십자선 — 어디로 옮겨질지 보여 줍니다. */
  pickCross: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9,
  },
  pickCrossH: { position: 'absolute', width: 18, height: 1.5, opacity: 0.9 },
  pickCrossV: { position: 'absolute', width: 1.5, height: 18, opacity: 0.9 },
  projectionBtn: {
    position: 'absolute',
    top: 10,
    right: 48,
    width: 32,
    height: 32,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  solarOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 8,
    zIndex: 10,
  },
  solarOverlayItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  solarOverlayText: {
    fontSize: 9.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.3,
  },
  solarOverlayDivider: {
    width: 1,
    height: 10,
    opacity: 0.4,
  },
  /**
   * 왼쪽 아래 세로줄. 읽기값과 범례를 **쌓아** 놓습니다.
   *
   * ⚠ 둘을 각자 `position:'absolute'` 로 놓으면 높이가 바뀔 때마다 손으로
   * 다시 맞춰야 하고, 실제로 한 번 겹쳤습니다. 너비 상한은 오른쪽 아래
   * 인셋을 피하도록 `locationPick.bottomLeftMaxWidth` 가 계산합니다.
   */
  bottomLeft: {
    position: 'absolute',
    left: 10,
    bottom: 8,
    alignItems: 'flex-start',
    gap: 6,
    zIndex: 10,
  },
  cloudReadout: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    gap: 1,
  },
  cloudReadoutTitle: { fontSize: 11, fontWeight: '800' },
  cloudReadoutSub: { fontSize: 9.5, fontFamily: 'monospace' },
  polarInset: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    overflow: 'hidden',
  },
  legend: {
    flexDirection: 'row',
    // 상한에 닿으면 줄바꿈합니다 — 안 그러면 인셋 밑으로 삐져나갑니다.
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendLine: {
    width: 10,
    height: 3,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 8.5,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.2,
  },
  bottomControls: {
    marginTop: 6,
  },
});
