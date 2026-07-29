import React, { useState, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Platform, PanResponder } from 'react-native';
import Svg, { Circle, Line, Text as SvgText, G, Path } from 'react-native-svg';
import { Cloud, Zap, Wind, Eye, CloudRain, CloudLightning, MapPin, Sun } from 'lucide-react-native';
import { generate29GridPoints, computeCloudCellData, CloudCellData, CloudTypeCategory } from '../utils/cloudMatrix';

interface CloudTrackerChartProps {
  theme: any;
  latitude: number;
  longitude: number;
}

export const CloudTrackerChart: React.FC<CloudTrackerChartProps> = ({ theme, latitude, longitude }) => {
  const { width } = Dimensions.get('window');
  const chartSize = Math.min(width - 32, 350);
  const center = chartSize / 2;
  const maxRadius = chartSize / 2 - 28;

  // 연속 0분 ~ 60분 타임 슬라이더 값
  const [minutesOffset, setMinutesOffset] = useState<number>(0);
  const [selectedCell, setSelectedCell] = useState<CloudCellData | null>(null);

  // 29개 방사형 원형 격자 산출
  const baseGridPoints = useMemo(() => {
    return generate29GridPoints(latitude, longitude);
  }, [latitude, longitude]);

  // 연속 분 단위(0~60분) 물리 벡터 외삽 계산 29개 셀 데이터
  const cloudCells = useMemo(() => {
    return baseGridPoints.map(pt => computeCloudCellData(pt, Math.round(minutesOffset)));
  }, [baseGridPoints, minutesOffset]);

  // 특별 강조 구름 개수
  const specialCount = useMemo(() => {
    return cloudCells.filter(c => c.isSpecial).length;
  }, [cloudCells]);

  // 거리(0, 50, 100, 200km)를 SVG 픽셀 반경으로 변환
  const getRadiusForKm = (km: number) => {
    if (km === 0) return 0;
    if (km <= 50) return (km / 50) * (maxRadius * 0.3);
    if (km <= 100) return maxRadius * 0.3 + ((km - 50) / 50) * (maxRadius * 0.3);
    return maxRadius * 0.6 + (Math.min(km, 200) - 100) / 100 * (maxRadius * 0.4);
  };

  // 슬라이더 바 터치/드래그 PanResponder
  const sliderWidth = width - 64;
  const sliderPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = Math.max(0, Math.min(sliderWidth, evt.nativeEvent.locationX));
        const val = (x / sliderWidth) * 60;
        setMinutesOffset(val);
      },
      onPanResponderMove: (evt) => {
        const x = Math.max(0, Math.min(sliderWidth, evt.nativeEvent.locationX));
        const val = (x / sliderWidth) * 60;
        setMinutesOffset(val);
      },
    })
  ).current;

  const renderCloudTypeIcon = (type: CloudTypeCategory, size: number = 14, color: string = '#FFF') => {
    switch (type) {
      case 'cumulonimbus': return <CloudLightning size={size} color="#FFD700" />;
      case 'stratus': return <CloudRain size={size} color="#88C0D0" />;
      case 'cirrus': return <Sun size={size} color="#FFA500" />;
      case 'lenticularis': return <Cloud size={size} color="#B48EAD" />;
      case 'fair_cumulus': default: return <Cloud size={size} color={color} />;
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Status Header */}
      <View style={[styles.headerBadge, { backgroundColor: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.1)' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Cloud size={14} color="#88C0D0" />
          <Text style={styles.headerTitle}>200km 구름 시야 레이더</Text>
        </View>
        <View style={styles.specialBadge}>
          <Zap size={10} color="#FFD700" />
          <Text style={styles.specialBadgeText}>강조 포착: {specialCount}곳</Text>
        </View>
      </View>

      {/* Main Radar SVG Canvas */}
      <View style={[styles.chartWrapper, { width: chartSize, height: chartSize }]}>
        <Svg width={chartSize} height={chartSize}>
          {/* Radar Circles: 50km, 100km, 200km */}
          {[50, 100, 200].map((km) => {
            const r = getRadiusForKm(km);
            return (
              <G key={`ring-${km}`}>
                <Circle
                  cx={center}
                  cy={center}
                  r={r}
                  stroke="rgba(255, 255, 255, 0.12)"
                  strokeWidth={1}
                  strokeDasharray={km === 200 ? "4,4" : undefined}
                  fill="none"
                />
                <SvgText
                  x={center + 4}
                  y={center - r + 12}
                  fill="rgba(255,255,255,0.35)"
                  fontSize={9}
                  fontWeight="bold"
                >
                  {`${km}km`}
                </SvgText>
              </G>
            );
          })}

          {/* Cross lines (N-S, E-W) */}
          <Line x1={center} y1={20} x2={center} y2={chartSize - 20} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <Line x1={20} y1={center} x2={chartSize - 20} y2={center} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

          {/* Cardinal Labels */}
          <SvgText x={center} y={16} fill="#FF8C66" fontSize={11} fontWeight="bold" textAnchor="middle">N</SvgText>
          <SvgText x={chartSize - 12} y={center + 4} fill="rgba(255,255,255,0.5)" fontSize={10} textAnchor="middle">E</SvgText>
          <SvgText x={center} y={chartSize - 8} fill="rgba(255,255,255,0.5)" fontSize={10} textAnchor="middle">S</SvgText>
          <SvgText x={12} y={center + 4} fill="rgba(255,255,255,0.5)" fontSize={10} textAnchor="middle">W</SvgText>

          {/* 29 Radial Grid Points & Cloud Nodes */}
          {cloudCells.map((cell) => {
            const r = getRadiusForKm(cell.distanceKm);
            const rad = ((cell.bearingDeg - 90) * Math.PI) / 180;
            const cx = center + r * Math.cos(rad);
            const cy = center + r * Math.sin(rad);

            const isSelected = selectedCell?.id === cell.id;

            return (
              <G key={cell.id} onPress={() => setSelectedCell(cell)}>
                {/* Special Highlight Aura Ring */}
                {cell.isSpecial && (
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={16}
                    fill="rgba(255, 140, 0, 0.25)"
                    stroke="#FF8C00"
                    strokeWidth={1.5}
                  />
                )}

                {/* Node Circle */}
                <Circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 12 : cell.distanceKm === 0 ? 8 : 9}
                  fill={cell.distanceKm === 0 ? '#FF9800' : cell.isSpecial ? 'rgba(255, 120, 0, 0.5)' : 'rgba(255,255,255,0.15)'}
                  stroke={isSelected ? '#FFD700' : 'rgba(255,255,255,0.3)'}
                  strokeWidth={isSelected ? 2 : 1}
                />
              </G>
            );
          })}
        </Svg>
      </View>

      {/* Selected Cloud Info Banner */}
      {selectedCell ? (
        <View style={[styles.infoBanner, { backgroundColor: 'rgba(35, 30, 42, 0.9)', borderColor: selectedCell.isSpecial ? '#FF8C00' : 'rgba(255,255,255,0.15)' }]}>
          <View style={styles.bannerHeader}>
            <View style={styles.iconBox}>
              {renderCloudTypeIcon(selectedCell.cloudType, 18)}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>{selectedCell.cloudName}</Text>
              <Text style={styles.bannerSub}>
                거리: {selectedCell.distanceKm === 0 ? '내 위치' : `${selectedCell.distanceKm}km`} · 방위각: {selectedCell.bearingDeg}°
              </Text>
            </View>
            {selectedCell.isSpecial && (
              <View style={styles.specialTag}>
                <Text style={styles.specialTagText}>강조 포착</Text>
              </View>
            )}
          </View>
          <View style={styles.bannerMetaRow}>
            <View style={styles.metaItem}>
              <Wind size={12} color="#AAA" />
              <Text style={styles.metaText}>풍속: {selectedCell.windSpeedKmh}km/h ({selectedCell.windBearingDeg}°)</Text>
            </View>
            <View style={styles.metaItem}>
              <Eye size={12} color="#AAA" />
              <Text style={styles.metaText}>구름 비율: {Math.round(selectedCell.cloudCover * 100)}%</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.infoBanner, { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' }]}>
          <Text style={styles.placeholderText}>지도의 노드를 탭하면 상세 구름 예보가 표시됩니다.</Text>
        </View>
      )}

      {/* Smooth Continuous Time Slider */}
      <View style={[styles.timelineCard, { backgroundColor: 'rgba(22, 19, 26, 0.8)', borderColor: 'rgba(255,255,255,0.1)' }]}>
        <View style={styles.timelineHeader}>
          <Text style={styles.timelineTitle}>미래 구름 이동 예보 (슬라이딩 조작)</Text>
          <Text style={styles.timelineTimeText}>
            {Math.round(minutesOffset) === 0 ? '현재 (LIVE)' : `+${Math.round(minutesOffset)}분 후`}
          </Text>
        </View>

        {/* Continuous Slider Track */}
        <View style={styles.sliderContainer} {...sliderPanResponder.panHandlers}>
          <View style={styles.sliderTrack} />
          <View style={[styles.sliderFill, { width: `${(minutesOffset / 60) * 100}%` }]} />
          <View style={[styles.sliderThumb, { left: `${(minutesOffset / 60) * 100}%` }]} />
        </View>

        <View style={styles.sliderTicksRow}>
          <Text style={styles.tickLabel}>현재</Text>
          <Text style={styles.tickLabel}>+15m</Text>
          <Text style={styles.tickLabel}>+30m</Text>
          <Text style={styles.tickLabel}>+45m</Text>
          <Text style={styles.tickLabel}>+60m</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  specialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  specialBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '800',
  },
  chartWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 180,
    backgroundColor: 'rgba(15, 12, 20, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  infoBanner: {
    width: '100%',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerTitle: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  bannerSub: {
    color: '#AAA',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  specialTag: {
    backgroundColor: '#FF8C00',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  specialTagText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
  },
  bannerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: '#CCC',
    fontSize: 11,
    fontWeight: '600',
  },
  placeholderText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 4,
  },
  timelineCard: {
    width: '100%',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineTitle: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  timelineTimeText: {
    color: '#FF8C66',
    fontSize: 12,
    fontWeight: '900',
  },
  sliderContainer: {
    height: 32,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    width: '100%',
  },
  sliderFill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF8C66',
  },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFF',
    marginLeft: -10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  sliderTicksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  tickLabel: {
    color: '#777',
    fontSize: 9,
    fontWeight: '700',
  },
});
