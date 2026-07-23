import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, PanResponder, Dimensions, Platform, ActivityIndicator } from 'react-native';
import Svg, { Circle, Path, G, Defs, RadialGradient, Stop, LinearGradient, Text as SvgText, Rect } from 'react-native-svg';
import * as d3 from 'd3-geo';
import * as topojson from 'topojson-client';
import { useCelestialStore } from '../../store/useCelestialStore';
import { IsochronePoint } from '../../utils/celestial';

interface MapGlobeProps {
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  lat?: number;
  lon?: number;
  hasLocation?: boolean;
  theme: any;
  isActive?: boolean;
  onScaleChange?: (scale: number) => void;
  initialScale?: number;
  selectedDate?: Date;
}

export const MapGlobe: React.FC<MapGlobeProps> = ({
  subsolar,
  terminator,
  allTerminators = [],
  lat,
  lon,
  hasLocation = false,
  theme,
  isActive = true,
  onScaleChange,
  initialScale = 150,
  selectedDate,
}) => {
  const { setGestureBlocked } = useCelestialStore();
  const { width } = Dimensions.get('window');
  
  const CANVAS_SIZE = width * 0.85;
  const CENTER = CANVAS_SIZE / 2;

  const [scale, setScale] = useState(initialScale);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  
  const RADIUS = scale;

  const [isInteracting, setIsInteracting] = useState(false);

  const [rotate, setRotate] = useState<[number, number]>([-subsolar.longitude, -subsolar.latitude]);
  const [mapData, setMapData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const rotateRef = useRef(rotate);
  rotateRef.current = rotate;

  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load map data');
        return res.json();
      })
      .then((data) => {
        const land = topojson.feature(data, data.objects.land);
        setMapData(land);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading world map atlas:', err);
        setLoading(false);
      });
  }, []);

  const startRotate = useRef<[number, number]>([0, 0]);
  const startX = useRef(0);
  const startY = useRef(0);

  const initialPinchDist = useRef<number | null>(null);
  const initialScaleRef = useRef<number>(150);

  const getTouchDistance = (touches: any[]) => {
    const [t1, t2] = touches;
    if (!t1 || !t2) return 0;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !!isActive,
      onMoveShouldSetPanResponder: () => !!isActive,
      onPanResponderGrant: (evt) => {
        setGestureBlocked(true);
        setIsInteracting(true);
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          initialPinchDist.current = getTouchDistance(touches);
          initialScaleRef.current = scaleRef.current;
        } else {
          startX.current = evt.nativeEvent.pageX;
          startY.current = evt.nativeEvent.pageY;
          startRotate.current = [...rotateRef.current];
          initialPinchDist.current = null;
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (initialPinchDist.current === null) {
            initialPinchDist.current = getTouchDistance(touches);
            initialScaleRef.current = scaleRef.current;
            return;
          }
          const currentDist = getTouchDistance(touches);
          if (currentDist > 0) {
            const ratio = currentDist / initialPinchDist.current;
            let targetScale = initialScaleRef.current * ratio;
            targetScale = Math.max(80, Math.min(1200, targetScale));
            setScale(targetScale);
            onScaleChange?.(targetScale);
          }
        } else {
          if (initialPinchDist.current !== null) {
            startX.current = evt.nativeEvent.pageX;
            startY.current = evt.nativeEvent.pageY;
            startRotate.current = [...rotateRef.current];
            initialPinchDist.current = null;
            return;
          }
          const dx = gestureState.dx;
          const dy = gestureState.dy;

          const sensitivity = 0.28; 
          let nextLambda = startRotate.current[0] + dx * sensitivity;
          let nextPhi = startRotate.current[1] - dy * sensitivity;

          nextPhi = Math.max(-80, Math.min(80, nextPhi));

          setRotate([nextLambda, nextPhi]);
        }
      },
      onPanResponderRelease: () => {
        setGestureBlocked(false);
        setIsInteracting(false);
        initialPinchDist.current = null;
      },
      onPanResponderTerminate: () => {
        setGestureBlocked(false);
        setIsInteracting(false);
        initialPinchDist.current = null;
      },
    })
  ).current;

  const projection = useMemo(() => {
    return d3.geoOrthographic()
      .scale(RADIUS)
      .translate([CENTER, CENTER])
      .rotate(rotate)
      .clipAngle(90);
  }, [rotate, RADIUS, CENTER]);

  const geoPath = useMemo(() => {
    return d3.geoPath().projection(projection);
  }, [projection]);

  const graticulePath = useMemo(() => {
    return geoPath(d3.geoGraticule()());
  }, [geoPath]);

  const landPath = useMemo(() => {
    if (!mapData) return null;
    return geoPath(mapData);
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

  const makeTerminatorPath = useCallback((segments: IsochronePoint[][]) => {
    let d = '';
    segments.forEach((segment) => {
      if (segment.length < 2) return;
      let isNew = true;
      segment.forEach((pt) => {
        // 날짜변경선(경도 ±180도) 부근 경계면 1.5도 이내는 3D 구면 꼬임 선 방지를 위해 제외합니다.
        if (Math.abs(pt.longitude) >= 178.5) {
          isNew = true;
          return;
        }
        const projected = projection([pt.longitude, pt.latitude]);
        if (projected) {
          const dist = d3.geoDistance([pt.longitude, pt.latitude], [-rotate[0], -rotate[1]]);
          if (dist < Math.PI / 2) {
            if (isNew) {
              d += `M${projected[0]} ${projected[1]}`;
              isNew = false;
            } else {
              d += ` L${projected[0]} ${projected[1]}`;
            }
          } else {
            isNew = true;
          }
        } else {
          isNew = true;
        }
      });
    });
    return d || null;
  }, [projection, rotate]);

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

  // 시간을 HH:MM 포맷으로 만드는 함수
  const formatTime = useCallback((date: Date) => {
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }, []);

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

  const subTerminatorPaths = useMemo(() => {
    if (!allTerminators) return [];
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
  }, [allTerminators, makeTerminatorPath, rotate, projection, getEquatorPoint, formatTime]);

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

  const strokeColor = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';

  return (
    <View style={styles.container}>
      <View style={[styles.canvasWrapper, { width: CANVAS_SIZE, height: CANVAS_SIZE }]} {...panResponder.panHandlers}>
        <Svg width={CANVAS_SIZE} height={CANVAS_SIZE} viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}>
          <Defs>
            <RadialGradient id="globeShadow" cx="30%" cy="30%" rx="70%" ry="70%">
              <Stop offset="0%" stopColor={theme.dark ? '#1a273b' : '#cce0ff'} stopOpacity="1" />
              <Stop offset="70%" stopColor={theme.dark ? '#0c121e' : '#6b92cc'} stopOpacity="1" />
              <Stop offset="100%" stopColor={theme.dark ? '#03050a' : '#334c73'} stopOpacity="1" />
            </RadialGradient>
            <RadialGradient id="sunMarkerGlow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
              <Stop offset="30%" stopColor="#FFA500" stopOpacity="0.8" />
              <Stop offset="100%" stopColor="#FFA500" stopOpacity="0" />
            </RadialGradient>
          </Defs>

          <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#globeShadow)" />

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

          {nightCirclePath && (
            <Path
              d={nightCirclePath}
              fill="rgba(3, 7, 18, 0.38)"
              stroke="none"
            />
          )}
          {/* 시간별 서브 등시선 (allTerminators) - 조작 중(isInteracting)일 때는 성능 극대화를 위해 렌더 생략 */}
          {!isInteracting && subTerminatorPaths.map((paths) => (
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
              stroke="#FFA500"
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
              <Circle cx={sunMarker.x} cy={sunMarker.y} r={5} fill="#FFFFFF" stroke="#FFA500" strokeWidth={1} />
            </G>
          )}

          {myLocationMarker.visible && (
            <G>
              <Circle cx={myLocationMarker.x} cy={myLocationMarker.y} r={9} fill="rgba(56, 189, 248, 0.25)" />
              <Circle cx={myLocationMarker.x} cy={myLocationMarker.y} r={4.5} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={1} />
            </G>
          )}

          <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={theme.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)'} strokeWidth={1} />
        </Svg>

        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator size="small" color={theme.text} />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
  },
  canvasWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loader: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
});
