import React, { useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE, Polygon, Overlay } from 'react-native-maps';
import type { CloudTopViewImage } from './useCloudTopView';
import { Sun } from 'lucide-react-native';
import { IsochronePoint } from '../../utils/celestial';
import { SunOverlay } from '../../utils/solarGeometry';
import { RadarFrame, radarColor, windArrow } from '../../utils/cloudRadar';

interface MapCanvasProps {
  lat: number;
  lon: number;
  hasLocation: boolean;
  subsolar: IsochronePoint;
  terminator: { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] };
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  nightPolygonCoords?: Array<Array<{ latitude: number; longitude: number }>>;
  onRegionChangeComplete?: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void;
  /** 처음 뜰 때 볼 곳(`MapCanvas.tsx` 참고). */
  startRegion?: { latitude: number; longitude: number; longitudeDelta: number };
  theme: any;
  selectedDate?: Date;
  /** 좁은 축척에서만 들어옵니다. null 이면 등치선이 제 일을 하는 구간입니다. */
  sunOverlay?: SunOverlay | null;
  /** 구름 레이더. 축척이 창 밖이거나 자료가 없으면 null 입니다. */
  radar?: RadarFrame | null;
  topView?: CloudTopViewImage | null;
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
  startRegion,
  theme,
  selectedDate,
  sunOverlay = null,
  radar = null,
  topView = null,
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
      // ⚠ 세로 폭은 경도 폭·cos(위도) 로 줍니다 — 세로로 긴 화면에서는 이것이
      //   가로보다 먼저 차지 않아 **경도 폭이 축척을 정합니다**. 구에서 돌아올 때
      //   구와 같은 축척이어야 땅 크기가 안 튑니다.
      initialRegion={startRegion ? {
        latitude: startRegion.latitude,
        longitude: startRegion.longitude,
        latitudeDelta: Math.min(170, startRegion.longitudeDelta * Math.max(0.1, Math.cos(startRegion.latitude * Math.PI / 180))),
        longitudeDelta: startRegion.longitudeDelta,
      } : {
        latitude: lat,
        longitude: lon,
        latitudeDelta: 60,
        longitudeDelta: 60,
      }}
      rotateEnabled={false}
      pitchEnabled={false}
      onRegionChangeComplete={handleRegionChangeComplete}
    >
      {/* ── 구름 레이더 (맨 아래) ────────────────────────────────────────
             ⚠ 매끈하게 칠하지 않고 **자료가 가진 고리·방위 칸 그대로** 그립니다.
             바깥 칸은 방위 폭이 199km 입니다 — 부드럽게 보간하면 실제보다 수십
             배 많이 아는 것처럼 보입니다(`cloudRadar.ts`). */}
      {/* ── 시뮬레이션 보기(§120 B) — 하늘 탭의 구름을 위에서 본 한 장 ─────────
             그림은 관측점 중심 동·북 km 평면인데 겹은 위경도 사각형이라, 세로(위도 1° =
             111.2km)는 맞고 가로는 원반 위·아래 끝에서 cos(위도) 차만큼(서울 ±3.2° 에서 약 4%)
             어긋납니다. ⚠ 기기에서 아직 못 봤습니다(웹 미리보기 지도에는 겹이 없음). */}
      {topView && (
        <Overlay
          image={{ uri: topView.uri }}
          bounds={[
            [lat + topView.rangeKm / 111.2, lon - topView.rangeKm / (111.32 * Math.cos(lat * Math.PI / 180))],
            [lat - topView.rangeKm / 111.2, lon + topView.rangeKm / (111.32 * Math.cos(lat * Math.PI / 180))],
          ]}
        />
      )}
      {!topView && radar && radar.cells.map((c, i) => (
        <Polygon
          key={`radar-${i}`}
          coordinates={c.polygon}
          fillColor={radarColor(c.coverPct)}
          strokeColor="rgba(148, 163, 184, 0.10)"
          strokeWidth={0.5}
          geodesic
        />
      ))}
      {/* 바람 — 구름이 **가는 쪽**입니다(`toBearingDeg`). 기상 관례의
             '불어오는 쪽'을 그대로 그리면 구름이 반대로 갑니다. */}
      {radar?.wind && (
        <Polyline
          coordinates={windArrow(lat, lon, radar.wind.toBearingDeg, radar.wind.speedKmh)}
          strokeColor="rgba(125, 211, 252, 0.9)"
          strokeWidth={2.5}
          geodesic
        />
      )}

      {/* 자료가 여기서 끝난다는 것을 눈에 보이게 합니다. */}
      {radar && (
        <Polyline
          coordinates={radar.edge}
          strokeColor="rgba(148, 163, 184, 0.45)"
          strokeWidth={1.5}
          lineDashPattern={[5, 6]}
          geodesic
        />
      )}

      {/* 밤 그림자 영역 오버레이 (d3-geoCircle 기반 곡선 폴리곤) */}
      {!sunOverlay && nightPolygonCoords && nightPolygonCoords.map((coords, index) => (
        <Polygon
          key={`night-polygon-${index}`}
          coordinates={coords}
          fillColor="rgba(11, 18, 32, 0.38)"
          strokeColor="transparent"
          strokeWidth={0}
          geodesic
        />
      ))}

      {/* 1. 시간별 서브 등시선들 (allTerminators) - 고성능 선형 폴리라인 렌더링
             ⚠ 좁은 축척에서는 끕니다. 화면 폭이 1° 아래면 안에서 일출 시각이
             5분도 안 벌어져 30분 간격 선이 0~1개만 남습니다(§73). 그 자리는
             아래 태양 오버레이가 맡습니다. */}
      {!sunOverlay && allTerminators && allTerminators.map((term, idx) => (
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
      {!sunOverlay && terminator.sunrise.filter((segment) => segment.length >= 2).map((segment, i) => {
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
      {!sunOverlay && terminator.sunset.filter((segment) => segment.length >= 2).map((segment, i) => {
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

      {!sunOverlay && (
        <Marker coordinate={{ latitude: subsolar.latitude, longitude: subsolar.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.sunMarker}>
            <Sun size={14} color="#78350F" fill="#FFD700" />
          </View>
        </Marker>
      )}

      {/* ── 태양 오버레이 (좁은 축척) ──────────────────────────────────
             등고도선 한 줄과, 그 **법선** 위의 태양 방향들입니다.
             둘의 직교는 우연이 아니라 기하입니다(`solarGeometry.ts`). */}
      {sunOverlay && (
        <>
          {sunOverlay.riseRay && (
            <Polyline
              coordinates={sunOverlay.riseRay}
              strokeColor="rgba(251, 146, 60, 0.55)"
              strokeWidth={2}
              lineDashPattern={[6, 5]}
              geodesic
            />
          )}
          {sunOverlay.setRay && (
            <Polyline
              coordinates={sunOverlay.setRay}
              strokeColor="rgba(248, 113, 113, 0.55)"
              strokeWidth={2}
              lineDashPattern={[6, 5]}
              geodesic
            />
          )}
          <Polyline
            coordinates={sunOverlay.isoLine}
            strokeColor="#38BDF8"
            strokeWidth={2.5}
            geodesic
          />
          {/* 해가 떠 있으면 실선, 지평선 아래면 흐린 점선 */}
          <Polyline
            coordinates={sunOverlay.nowRay}
            strokeColor={sunOverlay.fan.nowAlt > 0 ? '#FB923C' : 'rgba(251, 146, 60, 0.35)'}
            strokeWidth={3.5}
            lineDashPattern={sunOverlay.fan.nowAlt > 0 ? undefined : [7, 6]}
            geodesic
          />
          {sunOverlay.riseRay && (
            <Marker coordinate={sunOverlay.riseRay[1]} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.fanLabelRise}>
                <Text style={styles.fanLabelText}>
                  일출 {Math.round(sunOverlay.fan.riseAz ?? 0)}°
                </Text>
              </View>
            </Marker>
          )}
          {sunOverlay.setRay && (
            <Marker coordinate={sunOverlay.setRay[1]} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.fanLabelSet}>
                <Text style={styles.fanLabelText}>
                  일몰 {Math.round(sunOverlay.fan.setAz ?? 0)}°
                </Text>
              </View>
            </Marker>
          )}
          <Marker coordinate={sunOverlay.nowRay[1]} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.fanLabelNow}>
              <Text style={styles.fanLabelText}>
                {sunOverlay.fan.nowAlt > 0 ? '지금' : '지평선 아래'} {Math.round(sunOverlay.fan.nowAz)}°
              </Text>
            </View>
          </Marker>
        </>
      )}

      {/* ⚠ 직하점은 좁은 축척에서 늘 화면 밖입니다 — 안 그립니다. */}
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
  fanLabelRise: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(234, 88, 12, 0.85)',
    borderWidth: 0.8,
    borderColor: '#7C2D12',
  },
  fanLabelSet: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(190, 18, 60, 0.85)',
    borderWidth: 0.8,
    borderColor: '#4C0519',
  },
  fanLabelNow: {
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 6,
    backgroundColor: '#FB923C',
    borderWidth: 0.8,
    borderColor: '#7C2D12',
  },
  fanLabelText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: 'bold',
  },
  isolineLabelText: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: 'bold',
  },
});
