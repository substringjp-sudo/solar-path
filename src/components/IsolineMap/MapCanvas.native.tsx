import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Sun } from 'lucide-react-native';
import { IsochronePoint } from '../../utils/celestial';

interface MapCanvasProps {
  lat: number;
  lon: number;
  hasLocation: boolean;
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  theme: any;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({ lat, lon, hasLocation, subsolar, terminator, allTerminators = [], theme }) => {
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
    >
      {/* 1. 하루 24시간의 얇고 투명한 배경 등시선 */}
      {allTerminators.map((tData, idx) => (
        <React.Fragment key={`bg-term-${idx}`}>
          {tData.sunrise.filter(s => s.length >= 2).map((segment, i) => (
            <Polyline
              key={`bg-sunrise-${idx}-${i}`}
              coordinates={segment}
              strokeColor="rgba(255, 165, 0, 0.25)"
              strokeWidth={0.8}
              geodesic
            />
          ))}
          {tData.sunset.filter(s => s.length >= 2).map((segment, i) => (
            <Polyline
              key={`bg-sunset-${idx}-${i}`}
              coordinates={segment}
              strokeColor="rgba(255, 69, 0, 0.25)"
              strokeWidth={0.8}
              geodesic
            />
          ))}
        </React.Fragment>
      ))}

      {/* 2. 현재 선택된 시간의 메인 일출/일몰선 */}
      {terminator.sunrise.filter((segment) => segment.length >= 2).map((segment, i) => (
        <Polyline
          key={`sunrise-${i}`}
          coordinates={segment}
          strokeColor="#FFA500"
          strokeWidth={2.5}
          geodesic
        />
      ))}
      {terminator.sunset.filter((segment) => segment.length >= 2).map((segment, i) => (
        <Polyline
          key={`sunset-${i}`}
          coordinates={segment}
          strokeColor="#FF4500"
          strokeWidth={2.5}
          geodesic
        />
      ))}

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
});
