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

export const MapCanvas: React.FC<MapCanvasProps> = React.memo(({
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
  const handleRegionChangeComplete = (newRegion: any) => {
    onRegionChangeComplete?.(newRegion);
  };

  // 시간을 HH:MM 포맷으로 만드는 함수
  const formatTime = (date?: Date) => {
    if (!date) return '';
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const mainTimeStr = selectedDate ? formatTime(selectedDate) : '';

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
      {nightPolygonCoords && nightPolygonCoords.map((coords, index) => (
        <Polygon
          key={`night-polygon-${index}`}
          coordinates={coords}
          fillColor="rgba(11, 18, 32, 0.38)"
          strokeColor="transparent"
          strokeWidth={0}
          geodesic
        />
      ))}

      {/* 1. 시간별 서브 등시선들 (allTerminators) - 고성능 선형 폴리라인 렌더링 */}
      {allTerminators && allTerminators.map((term, idx) => (
        <React.Fragment key={`sub-term-${idx}`}>
          {term.sunrise.filter((segment) => segment.length >= 2).map((segment, i) => (
            <Polyline
              key={`sub-sunrise-${idx}-${i}`}
              coordinates={segment}
              strokeColor="rgba(251, 146, 60, 0.18)"
              strokeWidth={1.1}
              geodesic
            />
          ))}
          {term.sunset.filter((segment) => segment.length >= 2).map((segment, i) => (
            <Polyline
              key={`sub-sunset-${idx}-${i}`}
              coordinates={segment}
              strokeColor="rgba(248, 113, 113, 0.18)"
              strokeWidth={1.1}
              geodesic
            />
          ))}
        </React.Fragment>
      ))}

      {/* 2. 현재 선택된 시간의 메인 일출/일몰선 */}
      {terminator.sunrise.filter((segment) => segment.length >= 2).map((segment, i) => {
        const eqPt = segment.length > 0 ? segment[Math.floor(segment.length / 2)] : null;
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
        const eqPt = segment.length > 0 ? segment[Math.floor(segment.length / 2)] : null;
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
});

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
