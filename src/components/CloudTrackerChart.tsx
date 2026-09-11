import React, { useState, useMemo, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Platform, PanResponder, ScrollView } from 'react-native';
import Svg, { Circle, Line, Text as SvgText, G, Path, Defs, RadialGradient, Stop, ClipPath, Rect, LinearGradient } from 'react-native-svg';
import { Cloud, Zap, Wind, Eye, CloudRain, CloudLightning, MapPin, Sun, Sparkles } from 'lucide-react-native';
import SunCalc from 'suncalc';
import {
  generate29GridPoints,
  CloudCellData,
  CloudTypeCategory,
  buildRadarEchoBlob,
  RadarEchoBlob,
} from '../utils/cloudMatrix';
import { buildCloudCellsFromRing } from '../utils/cloudRadar';
import { fetchDayWeatherRing, CloudPathData } from '../utils/weather';

interface CloudTrackerChartProps {
  theme: any;
  latitude: number;
  longitude: number;
  currentTime?: Date;
}

function getBearingCardinal(deg: number): string {
  const norm = (deg % 360 + 360) % 360;
  const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(norm / 22.5) % 16;
  return cardinals[idx];
}

function makeSectorBeamPath(cx: number, cy: number, r: number, bearingDeg: number, spanDeg = 34): string {
  const halfSpan = spanDeg / 2;
  const startRad = ((bearingDeg - halfSpan - 90) * Math.PI) / 180;
  const endRad = ((bearingDeg + halfSpan - 90) * Math.PI) / 180;

  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);

  return `M ${cx.toFixed(1)},${cy.toFixed(1)} L ${x1.toFixed(1)},${y1.toFixed(1)} A ${r.toFixed(1)},${r.toFixed(1)} 0 0,1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
}

function makeRimArcPath(cx: number, cy: number, r: number, bearingDeg: number, spanDeg = 34): string {
  const halfSpan = spanDeg / 2;
  const startRad = ((bearingDeg - halfSpan - 90) * Math.PI) / 180;
  const endRad = ((bearingDeg + halfSpan - 90) * Math.PI) / 180;

  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);

  return `M ${x1.toFixed(1)},${y1.toFixed(1)} A ${r.toFixed(1)},${r.toFixed(1)} 0 0,1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

export interface CloudHighlight {
  id: string;
  cell: CloudCellData;
  type: 'sunset' | 'special' | 'front';
  badgeText: string;
  color: string;
  glowColor: string;
  bearingDeg: number;
  beamPath: string;
  rimPath: string;
}

export const CloudTrackerChart: React.FC<CloudTrackerChartProps> = ({ theme, latitude, longitude, currentTime }) => {
  const { width, height } = Dimensions.get('window');
  const chartSize = Math.min(width - 32, Math.min(340, height * 0.38));
  const center = chartSize / 2;
  const maxRadius = chartSize / 2 - 24;

  // 연속 0분 ~ 60분 타임 슬라이더 값
  const [minutesOffset, setMinutesOffset] = useState<number>(0);
  const [selectedCell, setSelectedCell] = useState<CloudCellData | null>(null);

  /**
   * ⚠ 예전에는 여기가 **위경도 해시**였습니다 — 운량도 구름종류도 바람도
   *   `Math.sin(lat*12.9898 + lon*78.233 + …)` 에서 나왔고, 날씨를 받는 경로가
   *   아예 없었습니다. 이제 **이미 받아 둔 구름 고리**를 씁니다(캐시 적중이라
   *   추가 요청 없음).
   */
  const [ring, setRing] = useState<CloudPathData[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchDayWeatherRing(latitude, longitude, new Date())
      .then(r => { if (alive) setRing(r); })
      .catch(err => console.warn('구름 고리를 못 받았습니다:', err));
    return () => { alive = false; };
  }, [latitude, longitude]);

  /**
   * ⚠ 고리는 **시간별**입니다. 0~60분 슬라이더를 밀어도 같은 시간 안에서는
   *   그림이 안 바뀝니다 — 없는 시간 해상도를 지어내지 않습니다.
   */
  const cloudCells = useMemo(() => {
    const base = (currentTime ?? new Date()).getTime();
    return buildCloudCellsFromRing(ring, latitude, longitude, base + Math.round(minutesOffset) * 60000);
  }, [ring, latitude, longitude, currentTime, minutesOffset]);

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

  const radarScopeRadius = getRadiusForKm(200);

  // ── 3D CloudSlab 주파수 노이즈(FBM) 기반 유기적 2D 레이더 에코 블롭 산출 ────
  const echoBlobs = useMemo(() => {
    const scale = chartSize / 340;
    return cloudCells.map((cell) => {
      const r = getRadiusForKm(cell.distanceKm);
      const rad = ((cell.bearingDeg - 90) * Math.PI) / 180;
      const cx = center + r * Math.cos(rad);
      const cy = center + r * Math.sin(rad);
      return buildRadarEchoBlob(cell, cx, cy, scale);
    });
  }, [cloudCells, center, maxRadius, chartSize]);

  // ── 현재/가상 시각 기준 태양 위치 (노을 정렬 계산용) ─────────────────────────
  const targetTime = useMemo(() => {
    const base = currentTime || new Date();
    return new Date(base.getTime() + Math.round(minutesOffset) * 60 * 1000);
  }, [currentTime, minutesOffset]);

  const sunPos = useMemo(() => {
    const s = SunCalc.getPosition(targetTime, latitude, longitude);
    return {
      azimuthDeg: (s.azimuth * 180) / Math.PI + 180,
      altitudeDeg: (s.altitude * 180) / Math.PI,
    };
  }, [targetTime, latitude, longitude]);

  // ── 사용자가 관심 가질만한 구름 방향(Focus Sector Highlights) 산출 ──────────
  const highlights = useMemo<CloudHighlight[]>(() => {
    const candidates = cloudCells.filter(c => c.distanceKm > 0 && c.cloudCover > 0.15);
    if (candidates.length === 0) return [];

    const scored = candidates.map((cell) => {
      let score = 0;
      let type: 'sunset' | 'special' | 'front' = 'front';
      const cardinal = getBearingCardinal(cell.bearingDeg);
      let label = `${cardinal} 구름대`;

      // 1. 태양 방위각과의 정렬 (노을/골든아워 빛 반사 구름)
      const sunDiff = Math.abs(((cell.bearingDeg - sunPos.azimuthDeg + 180) % 360) - 180);
      const isSunAligned = sunDiff <= 48;
      const isGoldenTime = sunPos.altitudeDeg > -8 && sunPos.altitudeDeg < 25;

      if (isSunAligned && isGoldenTime) {
        score += 85 - sunDiff;
        if (cell.cloudType === 'cirrus') score += 20; // 털구름은 노을에 특히 아름다움
        type = 'sunset';
        label = `🌅 ${cardinal} 노을 뷰`;
      } else if (cell.cloudType === 'cumulonimbus' || cell.isSpecial) {
        score += 80;
        type = 'special';
        label = `⚡ ${cardinal} 적란운`;
      } else if (cell.cloudType === 'lenticularis') {
        score += 70;
        type = 'special';
        label = `🛸 ${cardinal} 렌즈구름`;
      } else {
        score += cell.cloudCover * 40;
        type = 'front';
        label = `💨 ${cardinal} 전선`;
      }

      return { cell, score, type, label };
    });

    scored.sort((a, b) => b.score - a.score);
    // 상위 최대 2개 추천 시야 방향 선정
    const top = scored.slice(0, 2);

    return top.map((item, idx) => {
      const isSunset = item.type === 'sunset';
      const isSpecial = item.type === 'special';
      const color = isSunset ? '#FB923C' : isSpecial ? '#EF4444' : '#38BDF8';
      const glowColor = isSunset ? 'rgba(251, 146, 60, 0.18)' : isSpecial ? 'rgba(239, 68, 68, 0.18)' : 'rgba(56, 189, 248, 0.14)';

      return {
        id: `hl-${item.cell.id}-${idx}`,
        cell: item.cell,
        type: item.type,
        badgeText: item.label,
        color,
        glowColor,
        bearingDeg: item.cell.bearingDeg,
        beamPath: makeSectorBeamPath(center, center, radarScopeRadius, item.cell.bearingDeg, 32),
        rimPath: makeRimArcPath(center, center, radarScopeRadius, item.cell.bearingDeg, 32),
      };
    });
  }, [cloudCells, sunPos, center, radarScopeRadius]);

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
          <Cloud size={14} color="#38BDF8" />
          <Text style={styles.headerTitle}>200km 주파수 합성 구름 레이더</Text>
        </View>
        <View style={styles.specialBadge}>
          <Zap size={10} color="#FFD700" />
          <Text style={styles.specialBadgeText}>특이 에코: {specialCount}곳</Text>
        </View>
      </View>

      {/* ── 추천 관심 구름 방향 칩 바 ─────────────────────────────── */}
      {highlights.length > 0 && (
        <View style={styles.highlightBar}>
          <View style={styles.highlightBarLabelRow}>
            <Sparkles size={11} color="#FFD700" />
            <Text style={styles.highlightBarTitle}>추천 시야:</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightScroll}>
            {highlights.map((hl) => {
              const isSelected = selectedCell?.id === hl.cell.id;
              return (
                <TouchableOpacity
                  key={hl.id}
                  style={[
                    styles.highlightChip,
                    {
                      borderColor: isSelected ? hl.color : 'rgba(255,255,255,0.18)',
                      backgroundColor: isSelected ? 'rgba(255,255,255,0.18)' : 'rgba(15,12,20,0.65)',
                    },
                  ]}
                  onPress={() => setSelectedCell(hl.cell)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.highlightChipText, { color: hl.color }]}>
                    {hl.badgeText}
                  </Text>
                  <Text style={styles.highlightChipSub}>
                    {hl.cell.distanceKm}km ({Math.round(hl.cell.cloudCover * 100)}%)
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Main Radar SVG Canvas */}
      <View style={[styles.chartWrapper, { width: chartSize, height: chartSize }]}>
        <Svg width={chartSize} height={chartSize}>
          <Defs>
            {/* 레이더 스코프 원판 배경 그라디언트 */}
            <RadialGradient id="radarBgGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#0B132B" stopOpacity="0.95" />
              <Stop offset="65%" stopColor="#080D1D" stopOpacity="0.96" />
              <Stop offset="100%" stopColor="#02040A" stopOpacity="0.98" />
            </RadialGradient>
            {/* 외곽 림 메탈릭 테두리 */}
            <LinearGradient id="radarRimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="rgba(56, 189, 248, 0.5)" />
              <Stop offset="50%" stopColor="rgba(148, 163, 184, 0.3)" />
              <Stop offset="100%" stopColor="rgba(56, 189, 248, 0.45)" />
            </LinearGradient>
            {/* 200km 한계원 클립 마스크 */}
            <ClipPath id="radarScopeClip">
              <Circle cx={center} cy={center} r={radarScopeRadius} />
            </ClipPath>
          </Defs>

          {/* ── 레이더 베이스 원판 ───────────────────────────────────── */}
          <Circle
            cx={center}
            cy={center}
            r={radarScopeRadius}
            fill="url(#radarBgGrad)"
            stroke="url(#radarRimGrad)"
            strokeWidth={1.8}
          />

          {/* ── 200km 내부 클리핑 레이어: 에코 + 격자 + 빔 ─────────── */}
          <G clipPath="url(#radarScopeClip)">
            {/* ── 0단계: 추천 관심 방향 부채꼴 스포트라이트 빔 ──────── */}
            {highlights.map((hl) => {
              const isSelected = selectedCell?.id === hl.cell.id;
              return (
                <Path
                  key={`beam-${hl.id}`}
                  d={hl.beamPath}
                  fill={hl.glowColor}
                  opacity={isSelected ? 0.95 : 0.65}
                  onPress={() => setSelectedCell(hl.cell)}
                />
              );
            })}

            {/* 동심원 거리 링 (50km, 100km, 200km) */}
            {[50, 100, 200].map((km) => {
              const r = getRadiusForKm(km);
              return (
                <G key={`ring-${km}`}>
                  <Circle
                    cx={center}
                    cy={center}
                    r={r}
                    stroke={km === 200 ? 'rgba(56,189,248,0.3)' : 'rgba(255, 255, 255, 0.12)'}
                    strokeWidth={km === 200 ? 1.5 : 1}
                    strokeDasharray={km === 100 ? '3 3' : undefined}
                    fill="none"
                  />
                  <SvgText
                    x={center + 5}
                    y={center - r + 12}
                    fill="rgba(255,255,255,0.4)"
                    fontSize={8.5}
                    fontWeight="700"
                  >
                    {`${km}km`}
                  </SvgText>
                </G>
              );
            })}

            {/* 십자 방위선 (N-S, E-W) 및 대각 보조선 */}
            <Line x1={center} y1={center - radarScopeRadius} x2={center} y2={center + radarScopeRadius} stroke="rgba(255,255,255,0.09)" strokeWidth={1} />
            <Line x1={center - radarScopeRadius} y1={center} x2={center + radarScopeRadius} y2={center} stroke="rgba(255,255,255,0.09)" strokeWidth={1} />
            <Line
              x1={center - radarScopeRadius * 0.707}
              y1={center - radarScopeRadius * 0.707}
              x2={center + radarScopeRadius * 0.707}
              y2={center + radarScopeRadius * 0.707}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth={0.8}
              strokeDasharray="2 4"
            />
            <Line
              x1={center - radarScopeRadius * 0.707}
              y1={center + radarScopeRadius * 0.707}
              x2={center + radarScopeRadius * 0.707}
              y2={center - radarScopeRadius * 0.707}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth={0.8}
              strokeDasharray="2 4"
            />

            {/* ── 1단계: 외곽 유기적 에코 블롭 (주파수 FBM 합성) ─────── */}
            {echoBlobs.map((blob) => {
              if (blob.cell.cloudCover <= 0.05) return null;
              return (
                <Path
                  key={`outer-${blob.id}`}
                  d={blob.outerPath}
                  fill={blob.outerColor}
                  opacity={0.88}
                />
              );
            })}

            {/* ── 2단계: 고반사도 코어 에코 (강수/두꺼운 운층) ────────── */}
            {echoBlobs.map((blob) => {
              if (!blob.corePath) return null;
              return (
                <Path
                  key={`core-${blob.id}`}
                  d={blob.corePath}
                  fill={blob.coreColor || '#FFFFFF'}
                  opacity={0.92}
                />
              );
            })}

            {/* ── 3단계: 추천 관심 구름 림 아크 강조 ────────────────── */}
            {highlights.map((hl) => {
              const isSelected = selectedCell?.id === hl.cell.id;
              return (
                <Path
                  key={`rim-${hl.id}`}
                  d={hl.rimPath}
                  fill="none"
                  stroke={hl.color}
                  strokeWidth={isSelected ? 4 : 2.5}
                  strokeLinecap="round"
                  opacity={0.9}
                />
              );
            })}

            {/* ── 4단계: 위험 특수 구름(적란운 등) 강조 글로우 ───────── */}
            {echoBlobs.map((blob) => {
              if (!blob.cell.isSpecial) return null;
              return (
                <Circle
                  key={`special-glow-${blob.id}`}
                  cx={blob.cx}
                  cy={blob.cy}
                  r={16}
                  fill="none"
                  stroke={blob.glowColor}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={0.85}
                />
              );
            })}
          </G>

          {/* ── 4단계: 관측자 위치 ('내 위치') 정가운데 표시 ─────────── */}
          <G>
            <Circle cx={center} cy={center} r={10} fill="rgba(56,189,248,0.15)" stroke="rgba(56,189,248,0.35)" strokeWidth={1} />
            <Circle cx={center} cy={center} r={3.5} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={1.2} />
          </G>

          {/* ── 5단계: 레이더 노드 인터랙션 핀/도트 ──────────────────── */}
          {echoBlobs.map((blob) => {
            const isSelected = selectedCell?.id === blob.id;
            const isCenter = blob.cell.distanceKm === 0;

            return (
              <G key={`interactive-${blob.id}`} onPress={() => setSelectedCell(blob.cell)}>
                {/* 터치 감도 확장을 위한 투명 타깃 */}
                <Circle cx={blob.cx} cy={blob.cy} r={18} fill="transparent" />

                {isSelected && (
                  <Circle
                    cx={blob.cx}
                    cy={blob.cy}
                    r={14}
                    fill="none"
                    stroke="#FFD700"
                    strokeWidth={2}
                  />
                )}

                {/* 중심 앵커 도트 */}
                {!isCenter && (
                  <Circle
                    cx={blob.cx}
                    cy={blob.cy}
                    r={isSelected ? 3.5 : 2.5}
                    fill={isSelected ? '#FFD700' : 'rgba(255, 255, 255, 0.75)'}
                    stroke="rgba(0, 0, 0, 0.6)"
                    strokeWidth={0.8}
                  />
                )}
              </G>
            );
          })}

          {/* ── 방위 레이블 ─────────────────────────────────────────── */}
          <SvgText x={center} y={15} fill="#38BDF8" fontSize={11} fontWeight="900" textAnchor="middle">N</SvgText>
          <SvgText x={chartSize - 12} y={center + 4} fill="rgba(255,255,255,0.7)" fontSize={10} fontWeight="700" textAnchor="middle">E</SvgText>
          <SvgText x={center} y={chartSize - 8} fill="rgba(255,255,255,0.7)" fontSize={10} fontWeight="700" textAnchor="middle">S</SvgText>
          <SvgText x={12} y={center + 4} fill="rgba(255,255,255,0.7)" fontSize={10} fontWeight="700" textAnchor="middle">W</SvgText>
        </Svg>
      </View>

      {/* ── 에코 반사도(dBZ) 컬러 범례 ──────────────────────────────── */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.legendText}>엷은 구름</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#34D399' }]} />
          <Text style={styles.legendText}>비구름(층운)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#F97316' }]} />
          <Text style={styles.legendText}>적운(두터움)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
          <Text style={styles.legendText}>적란운(위험)</Text>
        </View>
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
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    justifyContent: 'space-between',
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
  highlightBar: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 4,
    paddingHorizontal: 4,
    gap: 8,
  },
  highlightBarLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  highlightBarTitle: {
    color: '#FFD700',
    fontSize: 10.5,
    fontWeight: '800',
  },
  highlightScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 12,
  },
  highlightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 12,
    borderWidth: 1,
  },
  highlightChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  highlightChipSub: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 9.5,
    fontWeight: '600',
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
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 9.5,
    fontWeight: '600',
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
