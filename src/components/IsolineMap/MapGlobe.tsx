import React, { useEffect, useState, useRef, useMemo, useCallback, useImperativeHandle } from 'react';
import { StyleSheet, View, PanResponder } from 'react-native';
import Svg, { Circle, Path, G, Defs, RadialGradient, Stop, Text as SvgText, Rect, Image as SvgImage, ClipPath } from 'react-native-svg';
import * as d3 from 'd3-geo';
import { WORLD_LAND } from '../../utils/worldLand';
import { useCelestialStore } from '../../store/useCelestialStore';
import { IsochronePoint } from '../../utils/celestial';
import { RadarFrame, radarColor, windArrow } from '../../utils/cloudRadar';
import type { CloudTopViewImage } from './useCloudTopView';
import { dataColor } from '../../theme/tokens';

interface MapGlobeProps {
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  lat?: number;
  lon?: number;
  hasLocation?: boolean;
  theme: any;
  isActive?: boolean;
  /** 그릴 칸의 크기(px). 지도 카드와 같은 크기여야 지도와 축척이 맞습니다. */
  width: number;
  height: number;
  /** 처음 볼 곳 — 지도에서 넘어왔으면 지도가 보던 한가운데입니다. */
  initialCenter: { latitude: number; longitude: number };
  /** 처음 반지름(px) — 지도에서 넘어왔으면 지도와 같은 축척(`globeRadiusForDelta`). */
  initialRadius: number;
  minRadius: number;
  maxRadius: number;
  /** 손을 뗄 때마다 지금 보는 한가운데와 반지름을 알립니다(지도로 돌아갈지 여기서 정합니다). */
  onViewChange?: (v: { latitude: number; longitude: number; radius: number; zoomedIn: boolean }) => void;
  /** 구름 레이더 — 평면 지도와 **같은 칸**을 구 위에 씌웁니다(§120). */
  radar?: RadarFrame | null;
  /** 시뮬레이션 보기(§120 B) — 있으면 레이더 칸 대신 이 그림을 관측점 둘레에 얹습니다. */
  topView?: CloudTopViewImage | null;
  selectedDate?: Date;
  /** 특정 위치 롱프레스 시 해당 위경도 전달 */
  onSelectLocation?: (coord: { latitude: number; longitude: number }) => void;
  /** 길게 눌러 고른(아직 확인 전) 자리 — 핀으로 보입니다. */
  pickPin?: { latitude: number; longitude: number } | null;
  /** 달 직하점(`getSublunarPoint`) — 있으면 달을 그 자리에 위상 모양으로 그립니다. */
  sublunar?: IsochronePoint | null;
  /** 달 밝은 부분 비율 0~1(`getMoonPhase`). */
  moonFraction?: number;
  /**
   * 보이는가. false 면 손잡이(`setView`)로 받은 축척·한가운데를 **기억만** 하고 다시 그리지 않습니다 —
   * 지도 단계에서 미리 띄워 둔 구가 프레임마다 육지 경로를 풀지 않게. true 가 되는 순간 기억한 값으로 한 번 그립니다.
   */
  visible?: boolean;
}

/**
 * 날짜변경선에서 잘린 조각을 다시 잇습니다. 평면 지도용으로 ±180° 에서 끊어 둔
 * 선이라, 구에서는 그 자리에 틈이 생깁니다. 끝과 시작이 5° 안이면 한 선입니다.
 */
const joinOnSphere = (segments: IsochronePoint[][]): [number, number][][] => {
  const lines = segments.filter(s => s.length >= 2).map(s => s.map(p => [p.longitude, p.latitude] as [number, number]));
  let merged = true;
  while (merged && lines.length > 1) {
    merged = false;
    for (let i = 0; i < lines.length && !merged; i++) {
      for (let j = 0; j < lines.length && !merged; j++) {
        if (i === j) continue;
        const a = lines[i], b = lines[j];
        if (d3.geoDistance(a[a.length - 1], b[0]) < 5 * Math.PI / 180) {
          lines[i] = a.concat(b);
          lines.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return lines;
};

/**
 * 부모가 리렌더 없이 구를 움직입니다 — 하늘 탭의 줌이 손가락 이벤트마다 반지름(지도와 같은
 * 축척)과 한가운데를 넘깁니다. 구 안의 손짓처럼 한 프레임에 한 번으로 모아 그립니다.
 */
export interface MapGlobeHandle {
  setView: (v: { radius?: number; center?: { latitude: number; longitude: number } }) => void;
}

export const MapGlobe = React.memo(React.forwardRef<MapGlobeHandle, MapGlobeProps>(({
  subsolar,
  terminator,
  allTerminators = [],
  lat,
  lon,
  hasLocation = false,
  theme,
  isActive = true,
  width,
  height,
  initialCenter,
  initialRadius,
  minRadius,
  maxRadius,
  onViewChange,
  radar = null,
  topView = null,
  selectedDate,
  onSelectLocation,
  pickPin = null,
  sublunar = null,
  moonFraction = 0.5,
  visible = true,
}, ref) => {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const CX = W / 2;
  const CY = H / 2;

  const clampR = (r: number) => Math.max(minRadius, Math.min(maxRadius, r));
  const [scale, setScale] = useState(() => clampR(initialRadius));
  const RADIUS = scale;

  const [isInteracting, setIsInteracting] = useState(false);

  // d3 의 rotate 는 [-경도, -위도] 가 화면 한가운데로 옵니다.
  const [rotate, setRotate] = useState<[number, number]>(
    [-initialCenter.longitude, -Math.max(-89, Math.min(89, initialCenter.latitude))],
  );
  const mapData = WORLD_LAND;

  // ⚠ PanResponder 는 한 번만 만듭니다. 그 안에서 props·상태를 직접 읽으면
  //   **처음 그린 때의 값**에 묶입니다(탭이 비활성일 때 떠 있던 구는 영영
  //   손을 안 받았습니다). 모두 ref 로 읽습니다.
  const live = useRef({ rotate, scale, isActive, onViewChange, minRadius, maxRadius, onSelectLocation, visible });
  live.current.isActive = isActive && visible;
  live.current.visible = visible;
  /** 숨은 동안 손잡이로 받은 값이 아직 그려지지 않았는가 — 그동안은 상태로 live 를 덮어쓰지 않습니다. */
  const hiddenDirty = useRef(false);
  live.current.onViewChange = onViewChange;
  live.current.minRadius = minRadius;
  live.current.maxRadius = maxRadius;
  live.current.onSelectLocation = onSelectLocation;

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartLocRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartLocRef.current = null;
  };

  // 손가락 움직임마다 상태를 바꾸면 한 프레임에 여러 번 육지 경로를 다시
  // 풉니다. 한 프레임에 한 번으로 모읍니다.
  const frame = useRef<number | null>(null);
  /**
   * 하늘 탭의 줌이 손잡이로 구를 움직이는 동안(손가락은 하늘 탭 것이라 `isInteracting` 이 false)에도
   * 24 시간 등시선 48 줄과 이름표를 프레임마다 다시 풀어 버벅였습니다. 손잡이로 움직이는 동안은
   * 그것들을 빼고, 마지막 움직임 뒤 0.2 초가 지나면 한 번 그립니다.
   */
  const [settled, setSettled] = useState(true);
  const movingRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    frame.current = null;
    hiddenDirty.current = false;
    if (movingRef.current) setSettled(false);
    setRotate(live.current.rotate);
    setScale(live.current.scale);
  };
  const schedule = () => {
    if (!live.current.visible) { hiddenDirty.current = true; return; }
    if (frame.current !== null) return;
    frame.current = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(flush)
      : (setTimeout(flush, 16) as unknown as number);
  };
  useEffect(() => () => {
    if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);
  // 숨었다가 보이는 순간, 숨은 동안 받은 축척·한가운데로 곧바로 그립니다(한 프레임 늦으면 옛 자리가 번쩍임).
  useEffect(() => {
    if (visible && hiddenDirty.current) flush();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    setView: ({ radius, center }) => {
      if (radius !== undefined && Number.isFinite(radius)) {
        live.current.scale = Math.max(live.current.minRadius, Math.min(live.current.maxRadius, radius));
      }
      if (center) {
        live.current.rotate = [-center.longitude, -Math.max(-89, Math.min(89, center.latitude))];
      }
      if (live.current.visible) {
        movingRef.current = true;
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null;
          movingRef.current = false;
          setSettled(true);
        }, 200);
      }
      schedule();
    },
  }), []);

  const startRotate = useRef<[number, number]>([0, 0]);
  const startX = useRef(0);
  const startY = useRef(0);

  const initialPinchDist = useRef<number | null>(null);
  const initialScaleRef = useRef<number>(scale);
  /** 이번 손짓을 시작할 때의 반지름 — 손을 뗄 때 확대했는지 가립니다. */
  const gestureStartScale = useRef<number>(scale);

  const getTouchDistance = (touches: any[]) => {
    const [t1, t2] = touches;
    if (!t1 || !t2) return 0;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const invertScreenCoord = (px: number, py: number): [number, number] | null => {
    const proj = d3.geoOrthographic()
      .scale(live.current.scale)
      .translate([CX, CY])
      .rotate(live.current.rotate)
      .clipAngle(90);
    const inv = proj.invert ? proj.invert([px, py]) : null;
    if (!inv || isNaN(inv[0]) || isNaN(inv[1])) return null;
    const dist = d3.geoDistance(inv, [-live.current.rotate[0], -live.current.rotate[1]]);
    if (dist > Math.PI / 2) return null;
    return inv;
  };

  const endGesture = () => {
    clearLongPress();
    useCelestialStore.getState().setGestureBlocked(false);
    setIsInteracting(false);
    initialPinchDist.current = null;
    if (frame.current !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
      flush();
    }
    const [l, p] = live.current.rotate;
    let lonC = -l;
    lonC = ((lonC + 180) % 360 + 360) % 360 - 180;
    live.current.onViewChange?.({ latitude: -p, longitude: lonC, radius: live.current.scale,
      zoomedIn: live.current.scale > gestureStartScale.current * 1.001 });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !!live.current.isActive,
      onMoveShouldSetPanResponder: () => !!live.current.isActive,
      // 바깥(탭 넘기기 등)이 손을 빼앗지 못하게 합니다.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        useCelestialStore.getState().setGestureBlocked(true);
        setIsInteracting(true);
        gestureStartScale.current = live.current.scale;
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          clearLongPress();
          initialPinchDist.current = getTouchDistance(touches);
          initialScaleRef.current = live.current.scale;
        } else {
          startX.current = evt.nativeEvent.pageX;
          startY.current = evt.nativeEvent.pageY;
          startRotate.current = [...live.current.rotate];
          initialPinchDist.current = null;

          const locX = evt.nativeEvent.locationX;
          const locY = evt.nativeEvent.locationY;
          touchStartLocRef.current = { x: locX, y: locY };
          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = setTimeout(() => {
            if (touchStartLocRef.current && live.current.onSelectLocation) {
              const inverted = invertScreenCoord(locX, locY);
              if (inverted) {
                live.current.onSelectLocation({ longitude: inverted[0], latitude: inverted[1] });
              }
            }
          }, 600);
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          clearLongPress();
          if (initialPinchDist.current === null) {
            initialPinchDist.current = getTouchDistance(touches);
            initialScaleRef.current = live.current.scale;
            return;
          }
          const currentDist = getTouchDistance(touches);
          if (currentDist > 0 && initialPinchDist.current > 0) {
            const ratio = currentDist / initialPinchDist.current;
            live.current.scale = Math.max(live.current.minRadius,
              Math.min(live.current.maxRadius, initialScaleRef.current * ratio));
            schedule();
          }
        } else {
          if (initialPinchDist.current !== null) {
            // 두 손가락에서 한 손가락으로 — 여기서 끌기를 새로 시작합니다.
            startX.current = evt.nativeEvent.pageX;
            startY.current = evt.nativeEvent.pageY;
            startRotate.current = [...live.current.rotate];
            initialPinchDist.current = null;
            clearLongPress();
            return;
          }
          const dx = evt.nativeEvent.pageX - startX.current;
          const dy = evt.nativeEvent.pageY - startY.current;
          if (Math.hypot(dx, dy) > 7) {
            clearLongPress();
          }
          // ⚠ 예전에는 0.28°/px 로 고정이라, 확대하면 땅이 손가락보다 몇 배
          //   빨리 달아났습니다. 한가운데에서 1px = 1/R 라디안이므로 이렇게
          //   두면 손가락 밑의 땅이 손가락을 따라옵니다.
          //   가로는 한가운데 위도의 cos 로 나눕니다 — 경도 1° 가 그 위도에서는
          //   cosφ 만큼 짧은 땅이라, 안 나누면 서울에서 손가락의 79% 만 따라왔습니다.
          const k = 180 / (Math.PI * live.current.scale);
          const cosPhi = Math.max(0.2, Math.cos(startRotate.current[1] * Math.PI / 180));
          const nextLambda = startRotate.current[0] + dx * k / cosPhi;
          const nextPhi = Math.max(-89, Math.min(89, startRotate.current[1] - dy * k));
          live.current.rotate = [nextLambda, nextPhi];
          schedule();
        }
      },
      onPanResponderRelease: endGesture,
      onPanResponderTerminate: endGesture,
    })
  ).current;
  if (frame.current === null && !hiddenDirty.current) {
    live.current.rotate = rotate;
    live.current.scale = scale;
  }

  const projection = useMemo(() => {
    return d3.geoOrthographic()
      .scale(RADIUS)
      .translate([CX, CY])
      .rotate(rotate)
      .clipAngle(90);
  }, [rotate, RADIUS, CX, CY]);

  const geoPath = useMemo(() => {
    return d3.geoPath().projection(projection);
  }, [projection]);

  const graticulePath = useMemo(() => {
    return geoPath(d3.geoGraticule()());
  }, [geoPath]);

  const landPath = useMemo(() => {
    if (!mapData) return null;
    return geoPath(mapData as any);
  }, [mapData, geoPath]);

  const nightCirclePath = useMemo(() => {
    const lat_anti = -subsolar.latitude;
    let lon_anti = subsolar.longitude + 180;
    lon_anti = ((lon_anti + 180) % 360 + 360) % 360 - 180;

    try {
      const circleGeoJSON = d3.geoCircle().center([lon_anti, lat_anti]).radius(90)();
      return geoPath(circleGeoJSON);
    } catch (e) {
      return null;
    }
  }, [subsolar, geoPath]);

  /**
   * 등시선을 구 위에 그립니다. d3 가 구의 가장자리(지평)에서 선을 정확히 자르고,
   * 날짜변경선은 `joinOnSphere` 가 이어 둡니다. 예전에는 점마다 보이는지 따로
   * 재고 ±178.5° 를 빼서, 가장자리에서 선이 한 칸씩 모자랐고 날짜변경선에 틈이
   * 났습니다.
   */
  /**
   * 레이더 칸을 구 위 경로로. ⚠ d3 는 구면 다각형의 **감긴 방향**으로 안팎을
   * 가립니다 — 반대로 감기면 칸이 아니라 **칸을 뺀 지구 전체**가 칠해집니다.
   * 넓이가 반구(2π)를 넘으면 뒤집어 둡니다. 감긴 방향은 칸이 바뀔 때만 셉니다.
   */
  const radarRings = useMemo(() => {
    if (!radar) return null;
    const toRing = (pts: { latitude: number; longitude: number }[]) => {
      const ring = pts.map(p => [p.longitude, p.latitude] as [number, number]);
      const f = ring[0], l = ring[ring.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      const poly = { type: 'Polygon', coordinates: [ring] } as any;
      if (d3.geoArea(poly) > 2 * Math.PI) ring.reverse();
      return poly;
    };
    return {
      cells: radar.cells.map(c => ({ geo: toRing(c.polygon), fill: radarColor(c.coverPct) })),
      edge: { type: 'LineString', coordinates: radar.edge.map(p => [p.longitude, p.latitude]) } as any,
      wind: radar.wind && lat !== undefined && lon !== undefined
        ? { type: 'LineString', coordinates: windArrow(lat, lon, radar.wind.toBearingDeg, radar.wind.speedKmh)
            .map(p => [p.longitude, p.latitude]) } as any
        : null,
    };
  }, [radar, lat, lon]);

  const radarPaths = useMemo(() => {
    if (!radarRings) return null;
    return {
      cells: radarRings.cells.map(c => ({ d: geoPath(c.geo), fill: c.fill })),
      edge: geoPath(radarRings.edge),
      wind: radarRings.wind ? geoPath(radarRings.wind) : null,
    };
  }, [radarRings, geoPath]);

  /**
   * 위에서 본 그림을 구 위에 놓는 아핀 변환. 그림은 관측점 중심 **동·북 km 평면**
   * (한 변 2·rangeKm)입니다. 관측점과 그 동·북으로 50km 떨어진 두 점을 투영해 그 자리의
   * 야코비안을 얻고, 그림 전체를 거기에 겁니다.
   *
   * ⚠ 원반 반경 360km 는 지구 중심각 3.2° 라, 구 한가운데 가까이서는 이 근사가 화소 한 칸
   *   안쪽입니다. 원반이 **가장자리(지평)** 로 갈수록 먼 쪽이 더 눌려야 하는데 아핀은 고르게
   *   눌러, 먼 쪽이 조금 커 보입니다. 원반 중심이 지평 너머로 가면 안 그립니다.
   */
  const topViewXform = useMemo(() => {
    if (!topView || lat === undefined || lon === undefined) return null;
    const c0: [number, number] = [lon, lat];
    if (d3.geoDistance(c0, [-rotate[0], -rotate[1]]) > Math.PI / 2 * 0.97) return null;
    const step = (bearingDeg: number, km: number): [number, number] => {
      const d = km / 6371, b = bearingDeg * Math.PI / 180, p1 = lat * Math.PI / 180;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
      const l2 = lon * Math.PI / 180 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      return [l2 * 180 / Math.PI, p2 * 180 / Math.PI];
    };
    const C = projection(c0), E = projection(step(90, 50)), N = projection(step(0, 50));
    if (!C || !E || !N) return null;
    const je = [(E[0] - C[0]) / 50, (E[1] - C[1]) / 50];
    const jn = [(N[0] - C[0]) / 50, (N[1] - C[1]) / 50];
    const Rk = topView.rangeKm;
    const S = 1;   // 그림을 1×1 로 놓고 변환에 크기를 싣습니다.
    // 그림 (u, v) ∈ [0,1]² → 동 = (2u−1)R, 북 = (1−2v)R → 화면 = C + je·동 + jn·북
    const a = je[0] * 2 * Rk / S, b = je[1] * 2 * Rk / S;
    const cc = -jn[0] * 2 * Rk / S, d = -jn[1] * 2 * Rk / S;
    const e = C[0] - je[0] * Rk + jn[0] * Rk, f = C[1] - je[1] * Rk + jn[1] * Rk;
    return `matrix(${a} ${b} ${cc} ${d} ${e} ${f})`;
  }, [topView, lat, lon, rotate, projection]);

  const makeTerminatorPath = useCallback((segments: IsochronePoint[][]) => {
    const lines = joinOnSphere(segments);
    if (lines.length === 0) return null;
    return geoPath({ type: 'MultiLineString', coordinates: lines } as any) || null;
  }, [geoPath]);

  // 적도(위도 0도)에 가장 인접한 좌표를 찾는 함수
  const getEquatorPoint = useCallback((segment: IsochronePoint[]) => {
    if (segment.length === 0) return null;
    let best = segment[0];
    let minDiff = Math.abs(best.latitude);
    for (const pt of segment) {
      const diff = Math.abs(pt.latitude);
      if (diff < minDiff) {
        minDiff = diff;
        best = pt;
      }
    }
    return best;
  }, []);

  // 시간을 HH:MM 으로 — **관측지 현지 시각**(지도 조작부와 같은 기준, 점검 2026-09-29).
  const tzHours = useCelestialStore(st => st.timezoneOffsetHours) ?? 0;
  const formatTime = useCallback((date: Date) => {
    const l = new Date(date.getTime() + tzHours * 3600000);
    const hours = String(l.getUTCHours()).padStart(2, '0');
    const minutes = String(l.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }, [tzHours]);

  const sunrisePath = useMemo(() => makeTerminatorPath(terminator.sunrise), [terminator.sunrise, makeTerminatorPath]);
  const sunsetPath = useMemo(() => makeTerminatorPath(terminator.sunset), [terminator.sunset, makeTerminatorPath]);

  // 메인 일출/일몰선의 적도 시간 표시 포인트 계산
  const mainSunriseLabelPt = useMemo(() => {
    if (!terminator.sunrise || terminator.sunrise.length === 0) return null;
    const allPts = terminator.sunrise.reduce((acc: IsochronePoint[], val) => acc.concat(val), []);
    const eqPt = getEquatorPoint(allPts);
    if (eqPt) {
      const dist = d3.geoDistance([eqPt.longitude, eqPt.latitude], [-rotate[0], -rotate[1]]);
      if (dist < Math.PI / 2) {
        const pos = projection([eqPt.longitude, eqPt.latitude]);
        if (pos) return { x: pos[0], y: pos[1] };
      }
    }
    return null;
  }, [terminator.sunrise, getEquatorPoint, rotate, projection]);

  const mainSunsetLabelPt = useMemo(() => {
    if (!terminator.sunset || terminator.sunset.length === 0) return null;
    const allPts = terminator.sunset.reduce((acc: IsochronePoint[], val) => acc.concat(val), []);
    const eqPt = getEquatorPoint(allPts);
    if (eqPt) {
      const dist = d3.geoDistance([eqPt.longitude, eqPt.latitude], [-rotate[0], -rotate[1]]);
      if (dist < Math.PI / 2) {
        const pos = projection([eqPt.longitude, eqPt.latitude]);
        if (pos) return { x: pos[0], y: pos[1] };
      }
    }
    return null;
  }, [terminator.sunset, getEquatorPoint, rotate, projection]);

  const showSubTerminators = settled && !isInteracting && visible;
  const subTerminatorPaths = useMemo(() => {
    if (!allTerminators || !showSubTerminators) return [];
    return allTerminators.map((term, idx) => {
      const sunrise = makeTerminatorPath(term.sunrise);
      const sunset = makeTerminatorPath(term.sunset);

      let sunriseLabelPt = null;
      let sunsetLabelPt = null;

      if (term.sunrise && term.sunrise.length > 0) {
        const allSunrisePts = term.sunrise.reduce((acc: IsochronePoint[], val) => acc.concat(val), []);
        const eqPt = getEquatorPoint(allSunrisePts);
        if (eqPt) {
          const dist = d3.geoDistance([eqPt.longitude, eqPt.latitude], [-rotate[0], -rotate[1]]);
          if (dist < Math.PI / 2) {
            const pos = projection([eqPt.longitude, eqPt.latitude]);
            if (pos) {
              sunriseLabelPt = { x: pos[0], y: pos[1] };
            }
          }
        }
      }

      if (term.sunset && term.sunset.length > 0) {
        const allSunsetPts = term.sunset.reduce((acc: IsochronePoint[], val) => acc.concat(val), []);
        const eqPt = getEquatorPoint(allSunsetPts);
        if (eqPt) {
          const dist = d3.geoDistance([eqPt.longitude, eqPt.latitude], [-rotate[0], -rotate[1]]);
          if (dist < Math.PI / 2) {
            const pos = projection([eqPt.longitude, eqPt.latitude]);
            if (pos) {
              sunsetLabelPt = { x: pos[0], y: pos[1] };
            }
          }
        }
      }

      return {
        sunrise,
        sunset,
        sunriseLabelPt,
        sunsetLabelPt,
        label: formatTime(term.time),
        key: `sub-term-paths-${idx}`
      };
    });
  }, [allTerminators, showSubTerminators, makeTerminatorPath, rotate, projection, getEquatorPoint, formatTime]);

  const sunMarker = useMemo(() => {
    const pt: [number, number] = [subsolar.longitude, subsolar.latitude];
    const dist = d3.geoDistance(pt, [-rotate[0], -rotate[1]]);
    if (dist < Math.PI / 2) {
      const pos = projection(pt);
      if (pos) {
        return { x: pos[0], y: pos[1], visible: true };
      }
    }
    return { x: 0, y: 0, visible: false };
  }, [subsolar, rotate, projection]);

  /**
   * 달 — 직하점에 위상 모양으로. 밝은 쪽은 **해 직하점 쪽**(달에서 해 쪽으로 가는 대원 방향)을 봅니다.
   * 화면에서의 그 방향은 달 자리에서 해 쪽으로 대원을 따라 조금 간 점을 투영해 얻습니다.
   * 밝은 부분: 해 쪽 반원 + 명암 경계 반타원(가로 반지름 r·|2f−1|, 반달보다 차면 어두운 쪽으로 부풂).
   */
  const MOON_R = 7;
  const moonMarker = useMemo(() => {
    if (!sublunar) return null;
    const pt: [number, number] = [sublunar.longitude, sublunar.latitude];
    if (d3.geoDistance(pt, [-rotate[0], -rotate[1]]) >= Math.PI / 2) return null;
    const pos = projection(pt);
    if (!pos) return null;
    const toSun = d3.geoInterpolate(pt, [subsolar.longitude, subsolar.latitude]);
    let angleDeg = 0;
    for (const t of [0.02, 0.005]) {
      const q = projection(toSun(t));
      if (q && Math.hypot(q[0] - pos[0], q[1] - pos[1]) > 1e-3) {
        angleDeg = Math.atan2(q[1] - pos[1], q[0] - pos[0]) * 180 / Math.PI;
        break;
      }
    }
    const f = Math.max(0, Math.min(1, moonFraction));
    const r = MOON_R;
    const rx = Math.abs(2 * f - 1) * r;
    // 해 쪽 = +x. 위(0,−r) → 해 쪽 반원 → 아래(0,r) → 명암 경계 반타원 → 위.
    const lit = f < 0.005 ? null
      : f > 0.995 ? 'full'
      : `M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx} ${r} 0 0 ${f > 0.5 ? 1 : 0} 0 ${-r} Z`;
    return { x: pos[0], y: pos[1], angleDeg, lit };
  }, [sublunar, subsolar, moonFraction, rotate, projection]);

  const myLocationMarker = useMemo(() => {
    if (!hasLocation || lat === undefined || lon === undefined) {
      return { x: 0, y: 0, visible: false };
    }
    const pt: [number, number] = [lon, lat];
    const dist = d3.geoDistance(pt, [-rotate[0], -rotate[1]]);
    if (dist < Math.PI / 2) {
      const pos = projection(pt);
      if (pos) {
        return { x: pos[0], y: pos[1], visible: true };
      }
    }
    return { x: 0, y: 0, visible: false };
  }, [lat, lon, hasLocation, rotate, projection]);

  const pickMarker = useMemo(() => {
    if (!pickPin) return null;
    const pt: [number, number] = [pickPin.longitude, pickPin.latitude];
    if (d3.geoDistance(pt, [-rotate[0], -rotate[1]]) >= Math.PI / 2) return null;
    const pos = projection(pt);
    return pos ? { x: pos[0], y: pos[1] } : null;
  }, [pickPin, rotate, projection]);

  const strokeColor = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';

  return (
    <View style={styles.container}>
      <View style={[styles.canvasWrapper, { width: W, height: H }]} {...panResponder.panHandlers}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <Defs>
            <RadialGradient id="globeShadow" cx="30%" cy="30%" rx="70%" ry="70%">
              <Stop offset="0%" stopColor={theme.dark ? '#1a273b' : '#cce0ff'} stopOpacity="1" />
              <Stop offset="70%" stopColor={theme.dark ? '#0c121e' : '#6b92cc'} stopOpacity="1" />
              <Stop offset="100%" stopColor={theme.dark ? '#03050a' : '#334c73'} stopOpacity="1" />
            </RadialGradient>
            <RadialGradient id="sunMarkerGlow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
              <Stop offset="30%" stopColor={dataColor.sunrise} stopOpacity="0.8" />
              <Stop offset="100%" stopColor={dataColor.sunrise} stopOpacity="0" />
            </RadialGradient>
          </Defs>

          <Circle cx={CX} cy={CY} r={RADIUS} fill="url(#globeShadow)" />

          {landPath && (
            <Path
              d={landPath}
              fill={theme.dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.25)'}
              stroke={theme.dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)'}
              strokeWidth={0.5}
            />
          )}

          {graticulePath && (
            <Path
              d={graticulePath}
              fill="none"
              stroke={strokeColor}
              strokeWidth={0.5}
            />
          )}

          {/* ── 구름 레이더 — 평면 지도와 같은 칸, 같은 색(§120) ──────────
                 자료가 가진 고리·방위 칸 그대로입니다. 매끈하게 칠하지 않습니다. */}
          {topView && topViewXform && (
            <>
              <Defs>
                <ClipPath id="globeClip">
                  <Circle cx={CX} cy={CY} r={RADIUS} />
                </ClipPath>
              </Defs>
              <G clipPath="url(#globeClip)">
                <SvgImage href={topView.uri} x={0} y={0} width={1} height={1}
                  preserveAspectRatio="none" transform={topViewXform} />
              </G>
            </>
          )}
          {!topView && radarPaths && radarPaths.cells.map((c, i) => c.d && (
            <Path key={`radar-${i}`} d={c.d} fill={c.fill} stroke="rgba(148, 163, 184, 0.10)" strokeWidth={0.5} />
          ))}
          {radarPaths?.wind && (
            <Path d={radarPaths.wind} fill="none" stroke="rgba(125, 211, 252, 0.9)" strokeWidth={2} />
          )}
          {radarPaths?.edge && (
            <Path d={radarPaths.edge} fill="none" stroke="rgba(148, 163, 184, 0.45)" strokeWidth={1.2} strokeDasharray="5 6" />
          )}

          {nightCirclePath && (
            <Path
              d={nightCirclePath}
              fill="rgba(3, 7, 18, 0.38)"
              stroke="none"
            />
          )}
          {/* 시간별 서브 등시선 (allTerminators) - 조작 중(isInteracting)일 때는 성능 극대화를 위해 렌더 생략 */}
          {subTerminatorPaths.map((paths) => (
            <React.Fragment key={paths.key}>
              {paths.sunrise && (
                <Path
                  d={paths.sunrise}
                  fill="none"
                  stroke="rgba(251, 146, 60, 0.18)"
                  strokeWidth={0.8}
                />
              )}
              {paths.sunset && (
                <Path
                  d={paths.sunset}
                  fill="none"
                  stroke="rgba(248, 113, 113, 0.18)"
                  strokeWidth={0.8}
                />
              )}

              {/* 시간별 보조 일출선 시간 표시 */}
              {paths.sunriseLabelPt && (
                <SvgText
                  x={paths.sunriseLabelPt.x}
                  y={paths.sunriseLabelPt.y}
                  fill="rgba(251, 146, 60, 0.72)"
                  fontSize="7.5"
                  fontWeight="bold"
                  textAnchor="middle"
                  dy={2.5}
                >
                  {paths.label}
                </SvgText>
              )}
              {/* 시간별 보조 일몰선 시간 표시 */}
              {paths.sunsetLabelPt && (
                <SvgText
                  x={paths.sunsetLabelPt.x}
                  y={paths.sunsetLabelPt.y}
                  fill="rgba(244, 63, 94, 0.72)"
                  fontSize="7.5"
                  fontWeight="bold"
                  textAnchor="middle"
                  dy={2.5}
                >
                  {paths.label}
                </SvgText>
              )}
            </React.Fragment>
          ))}

          {sunrisePath && (
            <Path
              d={sunrisePath}
              fill="none"
              stroke={dataColor.sunrise}
              strokeWidth={1.8}
            />
          )}
          {sunsetPath && (
            <Path
              d={sunsetPath}
              fill="none"
              stroke="#BA55D3"
              strokeWidth={1.8}
            />
          )}

          {/* 메인 일출/일몰선 적도 시간 라벨 */}
          {mainSunriseLabelPt && selectedDate && (
            <G>
              <Rect
                x={mainSunriseLabelPt.x - 12}
                y={mainSunriseLabelPt.y - 6}
                width={24}
                height={12}
                rx={3.5}
                fill="#EA580C"
              />
              <SvgText
                x={mainSunriseLabelPt.x}
                y={mainSunriseLabelPt.y}
                fill="#FFFFFF"
                fontSize="8"
                fontWeight="bold"
                textAnchor="middle"
                dy={3.2}
              >
                {formatTime(selectedDate)}
              </SvgText>
            </G>
          )}

          {mainSunsetLabelPt && selectedDate && (
            <G>
              <Rect
                x={mainSunsetLabelPt.x - 12}
                y={mainSunsetLabelPt.y - 6}
                width={24}
                height={12}
                rx={3.5}
                fill="#BE123C"
              />
              <SvgText
                x={mainSunsetLabelPt.x}
                y={mainSunsetLabelPt.y}
                fill="#FFFFFF"
                fontSize="8"
                fontWeight="bold"
                textAnchor="middle"
                dy={3.2}
              >
                {formatTime(selectedDate)}
              </SvgText>
            </G>
          )}

          {sunMarker.visible && (
            <G>
              <Circle cx={sunMarker.x} cy={sunMarker.y} r={16} fill="url(#sunMarkerGlow)" />
              <Circle cx={sunMarker.x} cy={sunMarker.y} r={5} fill="#FFFFFF" stroke={dataColor.sunrise} strokeWidth={1} />
            </G>
          )}

          {moonMarker && (
            <G transform={`translate(${moonMarker.x} ${moonMarker.y}) rotate(${moonMarker.angleDeg})`}>
              <Circle cx={0} cy={0} r={MOON_R + 5} fill="rgba(226, 232, 240, 0.12)" />
              <Circle cx={0} cy={0} r={MOON_R} fill="#1E293B" stroke="rgba(226, 232, 240, 0.55)" strokeWidth={0.8} />
              {moonMarker.lit === 'full'
                ? <Circle cx={0} cy={0} r={MOON_R} fill="#E2E8F0" />
                : moonMarker.lit && <Path d={moonMarker.lit} fill="#E2E8F0" />}
            </G>
          )}

          {myLocationMarker.visible && (
            <G>
              <Circle cx={myLocationMarker.x} cy={myLocationMarker.y} r={9} fill="rgba(56, 189, 248, 0.25)" />
              <Circle cx={myLocationMarker.x} cy={myLocationMarker.y} r={4.5} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={1} />
            </G>
          )}

          {pickMarker && (
            <G>
              <Circle cx={pickMarker.x} cy={pickMarker.y} r={11} fill="rgba(14, 165, 233, 0.25)" />
              <Circle cx={pickMarker.x} cy={pickMarker.y} r={5} fill="#0EA5E9" stroke="#FFFFFF" strokeWidth={1.5} />
            </G>
          )}

          <Circle cx={CX} cy={CY} r={RADIUS} fill="none" stroke={theme.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)'} strokeWidth={1} />
        </Svg>
      </View>
    </View>
  );
}));

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
