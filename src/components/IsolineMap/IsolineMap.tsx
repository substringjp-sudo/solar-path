import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Info, Sun, Sunrise, Sunset, Compass, Globe, Crosshair, Star, Hash } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { getSunPosition, getCelestialEvents, getSubsolarPoint, getTerminatorSegments } from '../../utils/celestial';
import { buildSunOverlay, isIsolineScale } from '../../utils/solarGeometry';
import { buildRadarFrame, isRadarScale, isGlobeRadarScale } from '../../utils/cloudRadar';
import { fetchDayWeatherRing, CloudPathData } from '../../utils/weather';
import { localDateString } from '../../utils/localDate';
import {
  mapModeFor, globeProgress, deltaForStretch, nextGlobeLatch, globeRadiusForDelta, deltaForGlobeRadius,
  globeFitRadius, GLOBE_EXIT_STRETCH, SILHOUETTE_STRETCH,
} from '../../utils/mapProjection';
import { canPickLocation, locationTapAction, solarBadgeMaxWidth, bottomLeftMaxWidth } from '../../utils/locationPick';
import * as Location from 'expo-location';
import { LandSilhouette } from './LandSilhouette';
import { formatLocalTime, getLocalTimeAtLocation } from '../../utils/timezone';
import { t, L3 } from '../../utils/i18n';
import { IsolineControls } from './IsolineControls';
import { IsolineGuideModal } from './IsolineGuideModal';
import { MapCanvas } from './MapCanvas';
import { MapGlobe } from './MapGlobe';
import { useCloudTopView } from './useCloudTopView';
import { SunAzimuthView } from '../MapScreen/SunAzimuthView';
import * as d3 from 'd3-geo';
import { color, radius, mono, dataColor } from '../../theme/tokens';
import { PressScale, OverlayButton, Reveal } from '../ui';

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
  /**
   * ⚠ 헤더의 날짜(‹ › · 달력)를 바꿔도 지도는 **처음 연 날짜에 머물렀습니다**(점검 2026-09-29).
   * `selectedDate` 를 처음 한 번만 `currentTime` 에서 받았기 때문입니다. 헤더가 시각을
   * **건너뛰면**(30분 넘게) 지도도 따라갑니다. 실시간으로 흐르는 1분 단위 변화는 따라가지
   * 않습니다 — 그러면 지도의 시각 슬라이더를 만지는 족족 되돌려집니다.
   */
  const lastHeaderTimeRef = useRef(currentTime.getTime());
  useEffect(() => {
    const t = currentTime.getTime();
    const jumped = Math.abs(t - lastHeaderTimeRef.current) > 30 * 60 * 1000;
    lastHeaderTimeRef.current = t;
    if (jumped) {
      setIsPlaying(false);
      setSelectedDate(new Date(t));
    }
  }, [currentTime]);
  const [guideVisible, setGuideVisible] = useState(false);
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const [longitudeDelta, setLongitudeDelta] = useState(60);
  /** 실루엣을 지도와 **같은 자리**에 그리려면 중심 좌표까지 있어야 합니다. */
  // ⚠ 지도는 `initialRegion` 으로 **사용자 위치**에서 시작합니다. 여기에
  //   서울을 박아 두면 첫 `onRegionChangeComplete` 전까지 실루엣·구·"한가운데로"
  //   가 전부 엉뚱한 곳을 가리킵니다. 같은 값에서 출발시킵니다.
  const [region, setRegion] = useState({ latitude: lat, longitude: lon, longitudeDelta: 60 });
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  /**
   * 구로 그리는 중인가 — 축척이 정하되 **직전 상태를 기억합니다**(§119).
   *
   * ⚠ 예전에는 구로 넘어가면 지도가 내려가 `longitudeDelta` 를 더는 알려 주지
   *   않아, 구에서 **다시 지도로 돌아올 길이 없었습니다.** 처음 여는 축척
   *   (화면 폭 60°)이 서울에서 이미 구라서 탭을 열면 늘 구에 갇혔습니다. 이제
   *   구도 손을 뗄 때 한가운데와 축척을 알려 주고(`onGlobeView`), 같은 문턱으로
   *   돌아옵니다.
   */
  const [globeOn, setGlobeOn] = useState(() => nextGlobeLatch(false, lat, 60));

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ⚠ 디바운스를 **안 거친** 최신 중심. 십자선은 지도 한가운데에 그려지므로
   * 늘 실제 중심을 가리키는데, `region` 상태는 350ms 뒤에야 따라옵니다. 그
   * 사이에 📍를 누르면 **십자선이 가리킨 곳이 아닌 직전 중심**으로 갑니다.
   * "보고 누르게 한다" 는 약속이 거기서 깨지므로 이 ref 를 씁니다.
   */
  const liveRegionRef = useRef({ latitude: lat, longitude: lon });

  const handleRegionChangeComplete = useCallback((r: { latitude: number; longitude: number; longitudeDelta: number }) => {
    liveRegionRef.current = { latitude: r.latitude, longitude: r.longitude };
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
  // ⚠ 구도 손을 뗄 때 같은 축척(`longitudeDelta`)으로 알려 주므로 한 자로 셉니다.
  const step = useMemo(() => {
    if (longitudeDelta >= 180) return 240; // 4시간
    if (longitudeDelta >= 90) return 120;  // 2시간
    if (longitudeDelta >= 40) return 60;   // 1시간
    return 30;                             // 30분
  }, [longitudeDelta]);

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
    () => (!globeOn ? buildSunOverlay(selectedDate, lat, lon, longitudeDelta) : null),
    [globeOn, selectedDate, lat, lon, longitudeDelta],
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
  /**
   * 구에서는 원반이 몇 px 인가로 정합니다(§120). 구의 반지름은 구가 손을 뗄 때
   * 알려 준 축척에서 되찾습니다 — 같은 식(`globeRadiusForDelta`)이라 어긋나지 않습니다.
   */
  const globeRadiusNow = globeOn
    ? globeRadiusForDelta(region.latitude, longitudeDelta, bodySize.width || width)
    : 0;
  const wantRadar = isToday && (globeOn ? isGlobeRadarScale(globeRadiusNow) : isRadarScale(longitudeDelta, lat));

  useEffect(() => {
    if (!wantRadar) return;
    let alive = true;
    fetchDayWeatherRing(lat, lon, new Date())
      .then(r => { if (alive) setRing(r); })
      .catch(err => console.warn('레이더용 구름 고리를 못 받았습니다:', err));
    return () => { alive = false; };
  }, [wantRadar, lat, lon]);

  /**
   * 구름을 무엇으로 보나 — 자료 칸(레이더) · 하늘 탭의 구름을 위에서 본 것(시뮬레이션, §120 B).
   * 구와 평면 지도(네이티브 지도 겹) 둘 다에 얹습니다. 웹 미리보기 지도는 겹이 없어 구에서만.
   */
  const [cloudView, setCloudView] = useState<'radar' | 'sim'>('radar');

  const radar = useMemo(
    () => (wantRadar
      ? buildRadarFrame(ring, lat, lon, selectedDate.getTime(), longitudeDelta,
        globeOn ? { globeRadiusPx: globeRadiusNow } : undefined)
      : null),
    [wantRadar, ring, lat, lon, selectedDate, longitudeDelta, globeOn, globeRadiusNow],
  );
  // ⚠ 구에서는 원반이 폭 100px 남짓에서 지도로 넘어가 무늬가 작게만 보입니다. 그래서 평면
  //   지도의 레이더 축척에도 같은 그림을 얹습니다(네이티브 지도 겹).
  const topView = useCloudTopView(ring, selectedDate.getTime(), cloudView === 'sim' && !!radar);

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
  /**
   * ⚠ 구에서 **돌리기만 했을 때**는 지도로 나가지 않습니다. 같은 반지름이라도
   *   한가운데가 적도로 오면 늘어남이 1.8 아래라, 이것이 없으면 적도로 끌어
   *   놓는 순간 지도로 바뀌었습니다. 나가는 것은 확대로만 합니다.
   */
  const globeHoldRef = useRef(false);
  useEffect(() => {
    const hold = globeHoldRef.current;
    globeHoldRef.current = false;
    setGlobeOn(prev => (prev && hold ? true : nextGlobeLatch(prev, region.latitude, longitudeDelta)));
  }, [region.latitude, longitudeDelta]);
  const showGlobe = globeOn;
  /** 구가 부풀어 오르는 진행도 0~1. 모서리 반지름을 여기에 이어 둡니다. 구에서는 늘 원입니다. */
  const morph = useMemo(
    () => (showGlobe ? 1 : globeProgress(region.latitude, longitudeDelta)),
    [showGlobe, region.latitude, longitudeDelta],
  );
  // ⚠ 구에서 줌을 당겨 돌아온 직후(늘어남 1.8~2.0)는 실루엣 띠입니다 — 같은 그림체로 내려옵니다.
  const showSilhouette = !showGlobe && autoMode !== 'tiles';

  /**
   * 카드 모서리 반지름과, 네 구석의 버튼·글씨가 물러설 거리.
   *
   * ⚠ 구로 갈수록 카드가 둥글어져(아래 `borderRadius`) 구석에 놓인 배지·범례·
   *   버튼이 **깎여 나갔습니다**(§120 에서 구에 레이더 읽기값을 띄우며 드러남).
   *   반지름 r 인 모서리에서 상자 귀퉁이가 호의 45° 점에 닿으려면 두 변에서
   *   r·(1 − 1/√2) ≈ 0.293r 물러서면 됩니다 — 상자의 나머지는 호 안쪽입니다.
   */
  //
  //   처음에는 물러서기만 했는데, 구에서 반지름이 짧은 변의 절반(181px)까지 커져
  //   물러설 거리가 53px 이 되자 **위쪽 배지와 버튼이 서로 겹쳤습니다**(웹 실측).
  //   그래서 반지름에 상한을 둡니다 — 구 자체가 둥글므로 카드까지 원이 될 까닭이
  //   없습니다. §75.5 의 "원이 부풀어 오른다" 는 모서리가 14 → 44px 로 둥글어지는
  //   것으로 줄었습니다.
  const CARD_RADIUS_MAX = 44;
  const cardRadius = Math.min(
    14 + morph * (CARD_RADIUS_MAX - 14),
    Math.min(bodySize.width, bodySize.height) / 2 || 14,
  );
  const cornerInset = Math.max(10, 0.293 * cardRadius);
  const inset = cornerInset - 10;

  /**
   * 지도가 다시 뜰 때 볼 곳. ⚠ 지도는 `initialRegion` 을 **처음 뜰 때만** 읽으므로,
   * 구에서 돌아올 때 구가 보던 곳을 여기에 담아 둡니다(예전에는 늘 사용자 위치·
   * 화면 폭 60° 로 떴습니다). 지도가 떠 있는 동안은 바꿀 까닭이 없어 모드가
   * 바뀔 때만 새로 잡습니다.
   */
  const mapStart = useMemo(
    () => ({ latitude: region.latitude, longitude: region.longitude, longitudeDelta }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showGlobe],
  );

  /** 구의 반지름 범위(px). 작게는 구 둘레가 화면에 다 들고, 크게는 지도로 돌아가는 문턱을 조금 넘습니다. */
  const globeRange = useMemo(() => {
    const W = bodySize.width || width;
    const fit = globeFitRadius(W, bodySize.height || width);
    const exitDelta = deltaForStretch(region.latitude, GLOBE_EXIT_STRETCH);
    const exitR = exitDelta ? globeRadiusForDelta(region.latitude, exitDelta, W) : fit * 6;
    return { min: fit * 0.6, max: Math.max(fit * 2, exitR * 1.6) };
  }, [bodySize.width, bodySize.height, width, region.latitude]);

  /** 구에서 손을 뗄 때 — 구가 보던 한가운데와 같은 축척의 지도 폭을 상태로 올립니다. */
  const onGlobeView = useCallback((v: { latitude: number; longitude: number; radius: number; zoomedIn: boolean }) => {
    const W = bodySize.width || width;
    globeHoldRef.current = !v.zoomedIn;
    const d = Math.min(360, deltaForGlobeRadius(v.latitude, v.radius, W));
    liveRegionRef.current = { latitude: v.latitude, longitude: v.longitude };
    setLongitudeDelta(d);
    setRegion({ latitude: v.latitude, longitude: v.longitude, longitudeDelta: d });
  }, [bodySize.width, width]);

  /**
   * 구 ↔ 지도 버튼. 지금 보이는 것의 반대로 갑니다 — 구로 갈 때는 구 둘레가
   * 다 보이는 축척, 지도로 갈 때는 타일이 뜨는 축척입니다. 둘 다 **같은
   * 한가운데**에서 넘어갑니다.
   */
  const toggleGlobe = useCallback(() => {
    const W = bodySize.width || width;
    const H = bodySize.height || width;
    const { latitude, longitude } = liveRegionRef.current;
    let d: number;
    if (showGlobe) {
      d = (deltaForStretch(latitude, SILHOUETTE_STRETCH) ?? 40) * 0.9;
    } else {
      d = Math.min(360, deltaForGlobeRadius(latitude, globeFitRadius(W, H), W));
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setLongitudeDelta(d);
    setRegion({ latitude, longitude, longitudeDelta: d });
    setGlobeOn(!showGlobe);
  }, [showGlobe, bodySize.width, bodySize.height, width]);

  /**
   * 한가운데를 집을 수 있는 축척인가. 문턱은 **지형 표본의 가장 바깥 고리
   * (40km)** 입니다 — 그보다 넓으면 중앙 한 점이 지형보다 거칠어집니다.
   * ⚠ 3D 구에서는 화면 중앙이 지구 위 한 점이 아니므로 아예 못 고릅니다.
   */
  const pickable = !showGlobe && canPickLocation(longitudeDelta, region.latitude);
  /** 배지가 버튼 줄 밑으로 파고들지 않게 자릅니다(320px 기기에서 21px 겹칩니다). */
  // ⚠ 화면 폭이 아니라 **카드 폭**으로 잽니다. 카드는 좌우 여백(14px × 2)만큼 좁아, 화면 폭으로
  //   재면 360px 기기에서 배지가 📍 버튼을 덮었습니다(점검 2026-09-29, 웹 실측).
  const badgeMaxWidth = useMemo(
    () => solarBadgeMaxWidth(bodySize.width || width - 28, 3),
    [bodySize.width, width],
  );
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
    const { latitude, longitude } = liveRegionRef.current;
    setLocation({ coords: { latitude, longitude } } as any);
    setLocMenuOpen(false);
  }, [setLocation]);

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

  // 등시선 하루치는 **관측지 현지 자정**부터 셉니다 — 라벨이 현지 시각(00:00, 04:00…)으로 읽힙니다.
  const tzMs = (timezoneOffsetHours ?? 0) * 3600000;
  const dateKey = new Date(selectedDate.getTime() + tzMs).toISOString().slice(0, 10);
  const allTerminators = useMemo(() => {
    // 좁은 축척에서는 안 그리므로 만들지도 않습니다 — 하루치 터미네이터를
    // 48번 계산하는 일이라 그냥 두면 값만 버립니다.
    if (!isIsolineScale(longitudeDelta) && !globeOn) return [];
    const list = [];
 
    const base = new Date(new Date(dateKey).getTime() - tzMs);

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
  }, [dateKey, step, longitudeDelta, globeOn, tzMs]);

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

  const handleSlidingStart = () => setIsPlaying(false);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* ⚠ 예전의 "선택된 날짜 · 선택된 시각(UTC)" 줄은 뺐습니다 — 헤더 날짜·아래 슬라이더와 같은
             값을 세 번째로 보여 주던 것이라, 그 자리를 지도에 돌려줍니다(점검 2026-09-29). */}
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
            borderRadius: cardRadius,
          },
        ]}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          // 구로 여는 첫 화면은 구 둘레가 다 보이는 축척으로 — 화면 폭 60° 그대로면
          // 서울에서 구가 카드보다 커서 잘린 채 시작합니다. 칸 크기를 알아야 셀 수 있어
          // 첫 배치 때 한 번만 합니다.
          if (bodySize.width === 0 && w > 0 && globeOn) {
            const d = Math.min(360, deltaForGlobeRadius(region.latitude, globeFitRadius(w, h), w));
            setLongitudeDelta(d);
            setRegion(r => ({ ...r, longitudeDelta: d }));
          }
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
            startRegion={mapStart}
            theme={theme}
            selectedDate={selectedDate}
            sunOverlay={sunOverlay}
            radar={radar}
            topView={topView}
          />
        ) : bodySize.width > 0 && (
          <MapGlobe
            subsolar={subsolar}
            terminator={terminator}
            allTerminators={allTerminators}
            lat={lat}
            lon={lon}
            hasLocation={!!location}
            theme={theme}
            isActive={isActive}
            width={bodySize.width}
            height={bodySize.height}
            initialCenter={region}
            initialRadius={globeRadiusForDelta(region.latitude, longitudeDelta, bodySize.width)}
            minRadius={globeRange.min}
            maxRadius={globeRange.max}
            onViewChange={onGlobeView}
            radar={radar}
            topView={topView}
            selectedDate={selectedDate}
          />
        )}

        {/* ── 중간 띠: 타일을 덮고 육지 윤곽만 ────────────────────────────
               구로 가기 전에 그림체를 먼저 맞춰 둡니다(`LandSilhouette`). */}
        {showSilhouette && bodySize.width > 0 && (
          <LandSilhouette region={region} width={bodySize.width} height={bodySize.height} theme={theme} />
        )}

        {/* 오른쪽 위 보기 조작 — 하늘 탭 레이어 버튼과 같은 `OverlayButton`. 켜진 상태(구 보기 ·
               위치 고르기 가능)는 강조 재질로 보입니다. 자리(10 · 48 · 86)는 `locationPick.topButtonsWidth(3)` 와 맞물립니다. */}
        <OverlayButton
          onPress={toggleGlobe}
          active={showGlobe}
          accessibilityLabel={showGlobe ? L3(language, '지도로 보기', 'Flat map', '地図で見る') : L3(language, '지구본으로 보기', 'Globe', '地球儀で見る')}
          style={[styles.overlayPos, { top: 10 + inset, right: 48 + inset }]}
        >
          {!showGlobe ? <Globe size={16} color={color.text} /> : <Compass size={16} color={color.accent} />}
        </OverlayButton>

        <OverlayButton
          onPress={() => setGuideVisible(true)}
          accessibilityLabel={L3(language, '도움말', 'Help', 'ヘルプ')}
          style={[styles.overlayPos, { top: 10 + inset, right: 10 + inset }]}
        >
          <Info size={16} color={color.text} />
        </OverlayButton>

        {/* ── 위치 옮기기 ────────────────────────────────────────────────
               탭의 뜻이 축척을 따라 바뀝니다 — 좁으면 한가운데로, 넓으면
               메뉴(`locationPick.ts`). 꾹 누르기는 어디서나 메뉴입니다.
               조준점 — 헤더의 📍(위치 변경 창)와 다른 일을 하므로 다른 모양으로(점검 2026-09-29). */}
        <OverlayButton
          onPress={onLocationTap}
          onLongPress={() => setLocMenuOpen(true)}
          delayLongPress={350}
          active={pickable}
          accessibilityLabel={L3(language, '위치 옮기기', 'Move location', '位置を移動')}
          style={[styles.overlayPos, { top: 10 + inset, right: 86 + inset }]}
        >
          <Crosshair size={16} color={pickable ? color.accent : color.text} />
        </OverlayButton>

        {/* 바깥을 누르면 닫힙니다 — 안 그러면 메뉴가 지도를 계속 가립니다. */}
        {locMenuOpen && (
          <PressScale
            style={styles.locBackdrop}
            activeOpacity={1}
            onPress={() => setLocMenuOpen(false)}
          />
        )}

        {locMenuOpen && (
          <Reveal style={[styles.locMenu, { top: 48 + inset, right: 10 + inset, backgroundColor: color.overlay, borderColor: color.border }]}>
            <PressScale style={styles.locMenuItem} onPress={moveToGps} activeOpacity={0.7}>
              <Crosshair size={13} color={theme.accent} />
              <Text style={[styles.locMenuText, { color: theme.text }]} numberOfLines={1}>
                {t('isolineMoveHere', language)}
              </Text>
            </PressScale>

            {savedLocations.slice(0, 5).map((loc) => (
              <PressScale
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
              </PressScale>
            ))}

            {onOpenPicker && (
              <PressScale
                style={styles.locMenuItem}
                activeOpacity={0.7}
                onPress={() => { setLocMenuOpen(false); onOpenPicker(); }}
              >
                <Hash size={13} color={theme.subText} />
                <Text style={[styles.locMenuText, { color: theme.subText }]} numberOfLines={1}>
                  {t('isolineEnterCoords', language)}
                </Text>
              </PressScale>
            )}
          </Reveal>
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
        <View style={[styles.solarOverlay, { top: 10 + inset, left: 10 + inset, backgroundColor: color.overlay, borderColor: color.border, maxWidth: badgeMaxWidth - 2 * inset }]}>
          <View style={styles.solarOverlayItem}>
            <Sun size={11} color={color.sun} />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {sunPosAtSelected.altitude.toFixed(0)}° / {sunPosAtSelected.azimuth.toFixed(0)}°
            </Text>
          </View>
          <View style={[styles.solarOverlayDivider, { backgroundColor: theme.border }]} />
          <View style={styles.solarOverlayItem}>
            <Sunrise size={11} color={dataColor.sunrise} />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {formatLocalTime(localSunrise, 'HH:mm')}
            </Text>
          </View>
          <View style={[styles.solarOverlayDivider, { backgroundColor: theme.border }]} />
          <View style={styles.solarOverlayItem}>
            <Sunset size={11} color={color.glow} />
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
        <View style={[styles.bottomLeft, { left: 10 + inset, bottom: 8 + inset, maxWidth: bottomLeftWidth - inset }]}>
          {radar && (
            <View style={[styles.cloudReadout, { backgroundColor: color.overlay, borderColor: color.border }]}>
              <Text style={[styles.cloudReadoutTitle, { color: theme.text }]} numberOfLines={1}>
                {radar.observerClass.name}
              </Text>
              <Text style={[styles.cloudReadoutSub, { color: theme.subText }]} numberOfLines={1}>
                {t('radarLayers', language).replace('{l}', String(Math.round(radar.observerLayers.low))).replace('{m}', String(Math.round(radar.observerLayers.mid))).replace('{h}', String(Math.round(radar.observerLayers.high)))}
                {radar.observerLayers.precipitationMm > 0
                  ? '  ' + t('radarRain', language).replace('{x}', radar.observerLayers.precipitationMm.toFixed(1))
                  : ''}
              </Text>
              <Text style={[styles.cloudReadoutSub, { color: theme.subText }]} numberOfLines={1}>
                {radar.wind
                  ? t('radarWind', language).replace('{b}', String(Math.round(radar.wind.toBearingDeg))).replace('{s}', String(Math.round(radar.wind.speedKmh)))
                  : t('radarNoWind', language)}
              </Text>
            </View>
          )}
          <View style={[styles.legend, { backgroundColor: color.overlay, borderColor: color.border }]}>
            {radar && (
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: 'rgba(226,232,240,0.75)' }]} />
                <Text style={[styles.legendText, { color: theme.subText }]}>
                  {topView
                    ? t('radarLegendSim', language)
                    : t('radarLegendCells', language).replace('{k}', String(Math.round(radar.outerSpacingKm)))}
                </Text>
              </View>
            )}
            {/* 자료 칸 ↔ 하늘 탭의 구름을 위에서 본 것. 웹 미리보기 지도는 겹이 없어 구에서만. */}
            {radar && (Platform.OS !== 'web' || showGlobe) && (
              <PressScale
                onPress={() => setCloudView(v => (v === 'radar' ? 'sim' : 'radar'))}
                style={[styles.legendItem, styles.cloudViewToggle, { borderColor: theme.border }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.legendText, { color: theme.text }]}>
                  {t(cloudView === 'radar' ? 'radarShowSim' : 'radarShowCells', language)}
                </Text>
              </PressScale>
            )}
            {isLocalScale ? (
              <>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: dataColor.altitude }]} />
                  <Text style={[styles.legendText, { color: theme.subText }]}>{t('legendAltLine', language)}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: dataColor.azimuth }]} />
                  <Text style={[styles.legendText, { color: theme.subText }]}>{t('legendAzimuth', language)}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: dataColor.sunrise }]} />
                  <Text style={[styles.legendText, { color: theme.subText }]}>{t('isolineSunriseLine', language)}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: dataColor.sunset }]} />
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
          <View style={[styles.polarInset, { right: 10 + inset, bottom: 10 + inset, backgroundColor: color.overlay, borderColor: color.border }]}>
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
    borderRadius: radius.lg,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  headerIconWrap: {
    width: 26,
    height: 26,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  headerValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  mapCard: {
    flex: 1,
    width: '100%',
    borderRadius: radius.lg,
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
    borderRadius: radius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
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
    borderRadius: radius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  overlayPos: { position: 'absolute', zIndex: 10 },
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
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
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
  locMenuText: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
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
    borderRadius: radius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
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
    // ⚠ 줄바꿈을 허락해야 maxWidth 가 먹습니다. 안 그러면 항목들이 줄지 않고 상자 밖으로
    //   넘쳐 360px 기기에서 📍 버튼을 덮었습니다(점검 2026-09-29, 웹 실측).
    flexWrap: 'wrap',
    rowGap: 3,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    gap: 8,
    zIndex: 10,
  },
  solarOverlayItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  solarOverlayText: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: mono,
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
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 1,
  },
  cloudReadoutTitle: { fontSize: 11, fontWeight: '800' },
  cloudReadoutSub: { fontSize: 9, fontFamily: mono },
  polarInset: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    borderRadius: radius.md,
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
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
  },
  cloudViewToggle: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
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
    fontSize: 9,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.2,
  },
  bottomControls: {
    marginTop: 6,
  },
});
