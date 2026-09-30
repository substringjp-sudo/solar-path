import React, { useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polyline as SvgPolyline, Circle, Polygon as SvgPolygon } from 'react-native-svg';
import { IsochronePoint } from '../../utils/celestial';
import { dataColor } from '../../theme/tokens';

interface MapCanvasProps {
  lat: number;
  lon: number;
  hasLocation: boolean;
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  nightPolygonCoords?: Array<Array<{ latitude: number; longitude: number }>>;
  onRegionChangeComplete?: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void;
  /** 처음 뜰 때 볼 곳(`MapCanvas.tsx` 참고). ⚠ 웹 미리보기는 전세계 고정 도법이라 안 씁니다. */
  startRegion?: { latitude: number; longitude: number; longitudeDelta: number };
  theme: any;
  selectedDate?: Date;
  /**
   * ⚠ 웹 미리보기는 **줌이 없는 전세계 고정 도법**이라 `longitudeDelta` 가
   * 안 바뀝니다. 그래서 이 값은 여기서는 늘 null 이고, 태양 오버레이는
   * 네이티브에서만 뜹니다. 받아만 두어 타입을 맞춥니다.
   */
  sunOverlay?: unknown;
  /** ⚠ 위와 같은 이유로 웹에서는 늘 null 입니다. */
  radar?: unknown;
  topView?: unknown;
}

// react-native-maps는 네이티브 전용 모듈이라 웹 번들링이 불가능하므로,
// 웹 미리보기에서는 react-native-svg 기반의 단순 등장방형(equirectangular) 도법으로 대체합니다.
export const MapCanvas: React.FC<MapCanvasProps> = ({
  lat,
  lon,
  hasLocation,
  subsolar,
  terminator,
  allTerminators = [],
  nightPolygonCoords = [],
  theme,
  selectedDate,
}) => {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const project = (point: IsochronePoint) => ({
    x: ((point.longitude + 180) / 360) * size.width,
    y: ((90 - point.latitude) / 180) * size.height,
  });

  const toSvgPoints = (segment: IsochronePoint[]) => segment.map((p) => { const { x, y } = project(p); return `${x},${y}`; }).join(' ');

  const subsolarXY = project(subsolar);
  const userXY = project({ latitude: lat, longitude: lon });

  return (
    <View style={styles.container} onLayout={onLayout}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#0B1220' }]} />
      {size.width > 0 && (
        <Svg width={size.width} height={size.height}>
          {[-60, -30, 0, 30, 60].map((gridLat) => (
            <Line
              key={`lat-${gridLat}`}
              x1={0}
              y1={project({ latitude: gridLat, longitude: 0 }).y}
              x2={size.width}
              y2={project({ latitude: gridLat, longitude: 0 }).y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          ))}
          {[-120, -60, 0, 60, 120].map((gridLon) => (
            <Line
              key={`lon-${gridLon}`}
              x1={project({ latitude: 0, longitude: gridLon }).x}
              y1={0}
              x2={project({ latitude: 0, longitude: gridLon }).x}
              y2={size.height}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          ))}

          {/* 밤 그림자 영역 오버레이 (곡선 폴리곤) */}
          {nightPolygonCoords && nightPolygonCoords.map((coords: any[], index: number) => (
            <SvgPolygon
              key={`night-polygon-${index}`}
              points={toSvgPoints(coords)}
              fill="rgba(11, 18, 32, 0.38)"
              stroke="transparent"
              strokeWidth={0}
            />
          ))}

          {/* 1. 하루 24시간의 얇고 투명한 배경 등시선 */}
          {allTerminators.map((tData, idx) => (
            <React.Fragment key={`bg-term-${idx}`}>
              {tData.sunrise.filter((s) => s.length >= 2).map((segment, i) => (
                <SvgPolyline
                  key={`bg-sunrise-${idx}-${i}`}
                  points={toSvgPoints(segment)}
                  fill="none"
                  stroke={dataColor.sunrise}
                  strokeWidth={0.8}
                  opacity={0.25}
                />
              ))}
              {tData.sunset.filter((s) => s.length >= 2).map((segment, i) => (
                <SvgPolyline
                  key={`bg-sunset-${idx}-${i}`}
                  points={toSvgPoints(segment)}
                  fill="none"
                  stroke={dataColor.sunset}
                  strokeWidth={0.8}
                  opacity={0.25}
                />
              ))}
            </React.Fragment>
          ))}

          {/* 2. 현재 선택된 시간의 메인 일출/일몰선 */}
          {terminator.sunrise.filter((segment) => segment.length >= 2).map((segment, i) => (
            <SvgPolyline key={`sunrise-${i}`} points={toSvgPoints(segment)} fill="none" stroke="#FFA500" strokeWidth={2} />
          ))}
          {terminator.sunset.filter((segment) => segment.length >= 2).map((segment, i) => (
            <SvgPolyline key={`sunset-${i}`} points={toSvgPoints(segment)} fill="none" stroke="#FF4500" strokeWidth={2} />
          ))}

          <Circle cx={subsolarXY.x} cy={subsolarXY.y} r={7} fill="#FFD700" stroke="#B45309" strokeWidth={2} />
          {hasLocation && (
            <Circle cx={userXY.x} cy={userXY.y} r={5} fill={theme.accent} stroke="#FFFFFF" strokeWidth={2} />
          )}
        </Svg>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
