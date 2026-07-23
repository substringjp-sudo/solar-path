import React, { useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE, Polygon } from 'react-native-maps';
import { Sun } from 'lucide-react-native';
import { IsochronePoint } from '../../utils/celestial';

interface MapCanvasProps {
  lat: number;
  lon: number;
  hasLocation: boolean;
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  nightPolygonCoords?: Array<Array<{ latitude: number; longitude: number }>>;
  onRegionChangeComplete?: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void;
  theme: any;
  selectedDate?: Date;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  lat,
  lon,
  hasLocation,
  subsolar,
  terminator,
  allTerminators = [],
  nightPolygonCoords = [],
  onRegionChangeComplete,
  theme,
  selectedDate,
}) => {
  const [currentRegion, setCurrentRegion] = useState({
    latitude: lat,
    longitude: lon,
    latitudeDelta: 60,
    longitudeDelta: 60,
  });

  const handleRegionChangeComplete = (newRegion: any) => {
    setCurrentRegion(newRegion);
    onRegionChangeComplete?.(newRegion);
  };

  // 뷰포트 가시 범위를 구합니다. 경위도 래핑 마진(80%) 부여
  const marginLat = currentRegion.latitudeDelta * 0.8;
  const marginLon = currentRegion.longitudeDelta * 0.8;
  const minLat = currentRegion.latitude - currentRegion.latitudeDelta / 2 - marginLat;
  const maxLat = currentRegion.latitude + currentRegion.latitudeDelta / 2 + marginLat;
  const minLon = currentRegion.longitude - currentRegion.longitudeDelta / 2 - marginLon;
  const maxLon = currentRegion.longitude + currentRegion.longitudeDelta / 2 + marginLon;

  // 특정 선/다각형 세그먼트가 화면 바운더리에 포함되는지 판단하는 고성능 판별기
  const isSegmentVisible = (segment: Array<{ latitude: number; longitude: number }>) => {
    return segment.some(pt => {
      if (pt.latitude < minLat || pt.latitude > maxLat) return false;
      
      // 경도 래핑을 고려한 범위 체크
      if (minLon <= maxLon) {
        return pt.longitude >= minLon && pt.longitude <= maxLon;
      } else {
        // 뷰포트가 날짜변경선(180도)에 걸친 케이스
        return pt.longitude >= minLon || pt.longitude <= maxLon;
      }
    });
  };

  // 적도(위도 0도)에 가장 인접한 좌표를 찾는 함수
  const getEquatorPoint = (segment: Array<{ latitude: number; longitude: number }>) => {
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
  };

  // 시간을 HH:MM 포맷으로 만드는 함수
  const formatTime = (date?: Date) => {
    if (!date) return '';
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  return (
    <MapView
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFillObject}
      initialRegion={{
        latitude: lat,
        longitude: lon,
        latitudeDelta: 60,
        longitudeDelta: 60,
      }}
      rotateEnabled={false}
      pitchEnabled={false}
      onRegionChangeComplete={handleRegionChangeComplete}
    >
      {/* 밤 그림자 영역 오버레이 (d3-geoCircle 기반 곡선 폴리곤) */}
      {nightPolygonCoords && nightPolygonCoords.map((coords, index) => 
        isSegmentVisible(coords) ? (
          <Polygon
            key={`night-polygon-${index}`}
            coordinates={coords}
            fillColor="rgba(11, 18, 32, 0.38)"
            strokeColor="transparent"
            strokeWidth={0}
            geodesic
          />
        ) : null
      )}

      {/* 1. 시간별 서브 등시선들 (allTerminators) */}
      {allTerminators && allTerminators.map((term, idx) => {
        const timeStr = formatTime(term.time);
        return (
          <React.Fragment key={`sub-term-${idx}`}>
            {term.sunrise.filter((segment) => segment.length >= 2).map((segment, i) => {
              const visible = isSegmentVisible(segment);
              if (!visible) return null;
              const eqPt = getEquatorPoint(segment);
              return (
                <React.Fragment key={`sub-sunrise-${idx}-${i}`}>
                  <Polyline
                    coordinates={segment}
                    strokeColor="rgba(251, 146, 60, 0.18)"
                    strokeWidth={1.1}
                    geodesic
                  />
                  {eqPt && (
                    <Marker coordinate={{ latitude: eqPt.latitude, longitude: eqPt.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
                      <View style={styles.isolineLabelSunrise}>
                        <Text style={styles.isolineLabelText}>{timeStr}</Text>
                      </View>
                    </Marker>
                  )}
                </React.Fragment>
              );
            })}
            {term.sunset.filter((segment) => segment.length >= 2).map((segment, i) => {
              const visible = isSegmentVisible(segment);
              if (!visible) return null;
              const eqPt = getEquatorPoint(segment);
              return (
                <React.Fragment key={`sub-sunset-${idx}-${i}`}>
                  <Polyline
                    coordinates={segment}
                    strokeColor="rgba(248, 113, 113, 0.18)"
                    strokeWidth={1.1}
                    geodesic
                  />
                  {eqPt && (
                    <Marker coordinate={{ latitude: eqPt.latitude, longitude: eqPt.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
                      <View style={styles.isolineLabelSunset}>
                        <Text style={styles.isolineLabelText}>{timeStr}</Text>
                      </View>
                    </Marker>
                  )}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}

      {/* 2. 현재 선택된 시간의 메인 일출/일몰선 */}
      {terminator.sunrise.filter((segment) => segment.length >= 2).map((segment, i) => {
        const visible = isSegmentVisible(segment);
        if (!visible) return null;
        const eqPt = getEquatorPoint(segment);
        const mainTimeStr = selectedDate ? formatTime(selectedDate) : '';
        return (
          <React.Fragment key={`sunrise-${i}`}>
            <Polyline
              coordinates={segment}
              strokeColor="#FFA500"
              strokeWidth={2.5}
              geodesic
            />
            {eqPt && mainTimeStr ? (
              <Marker coordinate={{ latitude: eqPt.latitude, longitude: eqPt.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.mainLabelSunrise}>
                  <Text style={styles.isolineLabelText}>{mainTimeStr}</Text>
                </View>
              </Marker>
            ) : null}
          </React.Fragment>
        );
      })}
      {terminator.sunset.filter((segment) => segment.length >= 2).map((segment, i) => {
        const visible = isSegmentVisible(segment);
        if (!visible) return null;
        const eqPt = getEquatorPoint(segment);
        const mainTimeStr = selectedDate ? formatTime(selectedDate) : '';
        return (
          <React.Fragment key={`sunset-${i}`}>
            <Polyline
              coordinates={segment}
              strokeColor="#FF4500"
              strokeWidth={2.5}
              geodesic
            />
            {eqPt && mainTimeStr ? (
              <Marker coordinate={{ latitude: eqPt.latitude, longitude: eqPt.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.mainLabelSunset}>
                  <Text style={styles.isolineLabelText}>{mainTimeStr}</Text>
                </View>
              </Marker>
            ) : null}
          </React.Fragment>
        );
      })}

      <Marker coordinate={{ latitude: subsolar.latitude, longitude: subsolar.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
        <View style={styles.sunMarker}>
          <Sun size={14} color="#78350F" fill="#FFD700" />
        </View>
      </Marker>

      {hasLocation && (
        <Marker coordinate={{ latitude: lat, longitude: lon }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={[styles.userMarker, { borderColor: theme.accent }]}>
            <View style={[styles.userMarkerCore, { backgroundColor: theme.accent }]} />
          </View>
        </Marker>
      )}
    </MapView>
  );
};

const styles = StyleSheet.create({
  sunMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFD700',
    borderWidth: 2,
    borderColor: '#B45309',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userMarkerCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  isolineLabelSunrise: {
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 5,
    backgroundColor: 'rgba(251, 146, 60, 0.72)',
    borderWidth: 0.5,
    borderColor: '#EA580C',
  },
  isolineLabelSunset: {
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 5,
    backgroundColor: 'rgba(244, 63, 94, 0.72)',
    borderWidth: 0.5,
    borderColor: '#BE123C',
  },
  mainLabelSunrise: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#EA580C',
    borderWidth: 0.8,
    borderColor: '#7C2D12',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  mainLabelSunset: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#BE123C',
    borderWidth: 0.8,
    borderColor: '#4C0519',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  isolineLabelText: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: 'bold',
  },
});
