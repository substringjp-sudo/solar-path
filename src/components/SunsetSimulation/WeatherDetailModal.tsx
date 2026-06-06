import React, { useMemo, useState } from 'react';
import {
  StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView,
  Dimensions, Platform, FlatList
} from 'react-native';
import { X, Cloud, Compass, Globe, Info } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { CloudPathData, CloudData } from '../../utils/weather';
import { formatLocalTime, getLocalTimeAtLocation } from '../../utils/timezone';
import { useCelestialStore } from '../../store/useCelestialStore';
import { CLOUD_TEMPLATES, CloudPresetName } from './Visualizer';

interface CloudBookEntry {
  name: CloudPresetName;
  krName: string;
  altitudeType: 'high' | 'mid' | 'low';
  altitudeRange: string;
  summary: string;
  origin: string;
  sunsetEffect: string;
  physics: {
    thickness: string;
    scattering: string;
    shadow: string;
  };
}

const CLOUD_BOOK_DATA: CloudBookEntry[] = [
  {
    name: 'Cirrus',
    krName: '권운 (새털구름)',
    altitudeType: 'high',
    altitudeRange: '6km 이상',
    summary: '빙결정으로 이루어진 희고 가는 실이나 깃털 모양의 구름입니다.',
    origin: '상층의 건조한 바람과 한랭한 기온 상태에서 수증기가 직접 빙결정으로 승화하여 생겨납니다.',
    sunsetEffect: '태양이 지평선 아래로 내려간 뒤에도 가장 오랫동안 햇빛을 받아 불타는 듯한 선홍빛 노을을 넓게 퍼뜨립니다.',
    physics: {
      thickness: '매우 얇음 (두께 4%)',
      scattering: '최상 (투과율 95%)',
      shadow: '거의 없음 (대비 5%)'
    }
  },
  {
    name: 'Cirrocumulus',
    krName: '권적운 (비늘구름)',
    altitudeType: 'high',
    altitudeRange: '6km 이상',
    summary: '작은 조개껍데기나 물고기 비늘 모양의 흰 구름 조각들이 떼를 지어 덮은 구름입니다.',
    origin: '상층 대기 불안정으로 약한 대류 현상이 생겨 수증기가 국소적으로 뭉쳐 얼어붙으며 정렬됩니다.',
    sunsetEffect: '노을빛을 받아 미세하게 쪼개진 림 라이트와 다채로운 색조 변화가 하늘을 대단히 수려하게 장식합니다.',
    physics: {
      thickness: '얇음 (두께 16%)',
      scattering: '높음 (투과율 80%)',
      shadow: '약함 (대비 20%)'
    }
  },
  {
    name: 'Cirrostratus',
    krName: '권층운 (햇무리구름)',
    altitudeType: 'high',
    altitudeRange: '6km 이상',
    summary: '온 하늘을 하얀 베일처럼 넓게 뒤덮어 햇무리나 달무리를 만드는 얇은 안개성 구름입니다.',
    origin: '온난전선 전면에서 넓은 대기 상층이 완만하게 상승하면서 얇고 평평한 얼음 입자 층이 만들어집니다.',
    sunsetEffect: '하늘 전체에 부드러운 붉은색 파스텔 톤 필터를 씌운 듯 넓게 퍼지는 은은한 그라데이션 노을을 선사합니다.',
    physics: {
      thickness: '매우 얇음 (두께 12%)',
      scattering: '매우 높음 (투과율 85%)',
      shadow: '거의 없음 (대비 15%)'
    }
  },
  {
    name: 'Altocumulus',
    krName: '고적운 (양떼구름)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km',
    summary: '양 떼가 밭이랑에 모여 있는 것 같은 둥글둥글한 구름 뭉치들의 배열입니다.',
    origin: '중층 대기가 국소적으로 불안정해 대류 기류가 형성되며 수증기가 중형 크기 물방울로 응결됩니다.',
    sunsetEffect: '노을빛이 구름 덩어리 사이로 여과되어 웅장한 빛내림(Crepuscular rays)과 강렬한 외곽 불꽃 테두리를 연출합니다.',
    physics: {
      thickness: '보통 (두께 40%)',
      scattering: '보통 (투과율 70%)',
      shadow: '보통 (대비 40%)'
    }
  },
  {
    name: 'Altostratus',
    krName: '고층운 (차일구름)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km',
    summary: '하늘 전체에 장막을 치듯 균일한 짙은 회청색을 드리우는 넓은 평면 구름입니다.',
    origin: '광범위한 중층 대기층이 서서히 대규모 상승하면서 대기 전반에 물방울과 얼음 알갱이가 응결되어 발달합니다.',
    sunsetEffect: '태양의 직접광을 강하게 가려 흐리게 만들며, 몽환적이고 다소 차분한 회보라색~어두운 적색 톤을 유도합니다.',
    physics: {
      thickness: '다소 두꺼움 (두께 55%)',
      scattering: '낮음 (투과율 60%)',
      shadow: '다소 짙음 (대비 50%)'
    }
  },
  {
    name: 'Nimbostratus',
    krName: '난층운 (비구름)',
    altitudeType: 'mid',
    altitudeRange: '2 ~ 6km (하층까지 확장)',
    summary: '하늘 전체를 짙은 회색으로 덮어 지속적인 비나 눈을 내리게 하는 두껍고 어두운 구름입니다.',
    origin: '저기압이나 활성화된 전선 주위에서 매우 두터운 기류가 강력하게 장시간 강제 상승할 때 생성됩니다.',
    sunsetEffect: '대부분의 햇빛을 흡수 차단하여 노을의 붉은 광선이 거의 보이지 않고 하늘이 어두운 잿빛으로 탁해집니다.',
    physics: {
      thickness: '두꺼움 (두께 75%)',
      scattering: '매우 낮음 (투과율 30%)',
      shadow: '짙음 (대비 80%)'
    }
  },
  {
    name: 'Stratocumulus',
    krName: '층적운 (물결뭉게구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하',
    summary: '낮게 깔린 크고 둥그스름한 덩어리들이 서로 밀집해 물결 모양 층을 이루는 구름입니다.',
    origin: '저고도의 바람과 기류의 복잡한 섭동이나 상승 기류 상단의 억제로 구름층이 수평으로 퍼져 발달합니다.',
    sunsetEffect: '구름 아랫부분에 깊은 회색 그림자가 지는 동시에, 갈라진 틈 사이로 주황색 노을빛이 강하게 대비되는 입체감을 만듭니다.',
    physics: {
      thickness: '두꺼움 (두께 80%)',
      scattering: '낮음 (투과율 40%)',
      shadow: '매우 짙음 (대비 82%)'
    }
  },
  {
    name: 'Stratus',
    krName: '층운 (안개구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하',
    summary: '지표면 가까이에 안개처럼 아주 낮고 균일하게 형성된 얇은 판상의 구름층입니다.',
    origin: '밤 사이 지표면의 복사 냉각 혹은 온난다습한 공기가 차가운 대지나 해면과 접촉하여 서서히 식어 생겨납니다.',
    sunsetEffect: '지평선 주변을 뿌옇게 가로막으며 노을의 강렬한 노란빛이 대기 속에서 넓고 부드럽게 산란되도록 만듭니다.',
    physics: {
      thickness: '보통 (두께 30~65%)',
      scattering: '보통 (투과율 50~70%)',
      shadow: '보통 (대비 30~60%)'
    }
  },
  {
    name: 'Cumulus',
    krName: '적운 (뭉게구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하',
    summary: '하늘 높이 탐스럽게 뭉게뭉게 피어오른 맑은 날의 대표적인 하얀 솜사탕 구름입니다.',
    origin: '태양열에 의해 불균일하게 가열된 지표면 공기가 상승 기류를 타고 오르며 물방울로 뭉쳐 자라납니다.',
    sunsetEffect: '둥글게 발달한 외곽을 따라 아주 눈부신 황금빛 림 라이트와 짙은 주황빛 음영 대비가 극도의 입체감을 완성합니다.',
    physics: {
      thickness: '두꺼움 (두께 70%)',
      scattering: '낮음 (투과율 45%)',
      shadow: '짙음 (대비 72%)'
    }
  },
  {
    name: 'Cumulonimbus',
    krName: '적란운 (소나기구름)',
    altitudeType: 'low',
    altitudeRange: '2km 이하 (최대 12km 상공까지 수직 발달)',
    summary: '소나기와 뇌우를 동반하며 하늘 높이 탑이나 모루 형태로 거대하게 솟구친 먹구름 산입니다.',
    origin: '대기가 극도로 불안정하여 초강력 상승 기류가 응결된 물방울과 빙결정을 성층권 하부 경계선까지 수직으로 폭발시키듯 밀어올려 생성됩니다.',
    sunsetEffect: '태양빛을 철저히 막는 거대한 암흑 벽이 되지만, 가장 높은 구름 꼭대기 모루 끝자락은 찬란히 불타는 장관을 연출합니다.',
    physics: {
      thickness: '최대 (두께 100%)',
      scattering: '최저 (투과율 20%)',
      shadow: '최대 (대비 98%)'
    }
  }
];

interface WeatherDetailModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
  pathData: CloudPathData[];
  interpolatedWeather: CloudData[];
  currentTime: Date;
  weatherSource: 'standard' | 'ultra-short' | 'fallback';
}

export const WeatherDetailModal: React.FC<WeatherDetailModalProps> = ({
  visible, onClose, theme, pathData, interpolatedWeather, currentTime, weatherSource
}) => {
  const { width: W, height: H } = Dimensions.get('window');
  const { timezoneOffsetHours } = useCelestialStore();
  const [activeTab, setActiveTab] = useState<'grid' | 'list'>('grid');
  const [activeAltitude, setActiveAltitude] = useState<'all' | 'low' | 'mid' | 'high'>('all');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [guideSubTab, setGuideSubTab] = useState<'basic' | 'encyclopedia'>('basic');
  const [expandedCloud, setExpandedCloud] = useState<string | null>(null);

  const angles = [-20, -10, 0, 10, 20];
  const distances = [380, 280, 200, 130, 70, 30, 10]; // Top to bottom (Far to Near)

  // 1. 5x7 그리드 매트릭스 변환
  const gridMatrix = useMemo(() => {
    if (!interpolatedWeather || interpolatedWeather.length < 36) return [];
    
    // interpolatedWeather의 첫 번째는 observer(0km)
    // 그 다음은 5개 각도 * 7개 거리 순
    const matrix: any[][] = [];
    
    distances.forEach((dist) => {
      const row: any[] = [];
      angles.forEach((ang) => {
        // angleIndex: 0~4, distanceIndex: 0~6
        const angleIdx = angles.indexOf(ang);
        const distIdx = [10, 30, 70, 130, 200, 280, 380].indexOf(dist);
        
        // 1 + angleIdx * 7 + distIdx
        const dataIdx = 1 + angleIdx * 7 + distIdx;
        const cellData = interpolatedWeather[dataIdx];
        row.push(cellData || { distance: dist, azimuthOffset: ang, low: 0, mid: 0, high: 0 });
      });
      matrix.push(row);
    });
    
    return matrix;
  }, [interpolatedWeather]);

  const observerPoint = useMemo(() => {
    return interpolatedWeather?.[0] || { low: 0, mid: 0, high: 0, visibility: 10000, humidity: 50 };
  }, [interpolatedWeather]);

  // 구름 농도에 따른 혼합 컬러 계산 (RGB)
  const getBlendColor = (low: number, mid: number, high: number) => {
    const sum = low + mid + high;
    if (sum === 0) return 'rgba(255, 255, 255, 0.05)';
    
    // 고층운(핑크), 중층운(보라), 저층운(블루) 가중치 혼합
    const r = Math.round((high * 255 + mid * 147 + low * 70) / sum);
    const g = Math.round((high * 105 + mid * 112 + low * 130) / sum);
    const b = Math.round((high * 180 + mid * 219 + low * 180) / sum);
    
    const maxVal = Math.max(low, mid, high);
    const opacity = 0.15 + (maxVal / 100) * 0.75; // 구름량에 따른 투명도 조절
    
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const getAltitudeColor = (val: number, type: 'low' | 'mid' | 'high') => {
    if (val === 0) return 'rgba(255, 255, 255, 0.05)';
    let r = 70, g = 130, b = 180; // low
    if (type === 'mid') {
      r = 147; g = 112; b = 219;
    } else if (type === 'high') {
      r = 255; g = 105; b = 180;
    }
    const opacity = 0.15 + (val / 100) * 0.75;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const getSourceModelName = () => {
    if (weatherSource === 'ultra-short') {
      return 'KMA LDAPS / HRRR (정밀 국지 초단기 모델)';
    }
    if (weatherSource === 'fallback') {
      return '임시 로컬 데이터 (기상 서버 연결 실패)';
    }
    return 'GFS / ECMWF Global Ensemble (표준 글로벌 모델)';
  };

  const formattedTime = useMemo(() => {
    const localTime = getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    return formatLocalTime(localTime, 'yyyy-MM-dd HH:mm');
  }, [currentTime, timezoneOffsetHours]);

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
        <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.card, borderColor: theme.border }]}>
          
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerTitleRow}>
              <Globe size={18} color={theme.accent} style={{ marginRight: 6 }} />
              <Text style={[styles.headerTitle, { color: theme.text }]}>기상 정밀 레이더 분석</Text>
              <TouchableOpacity 
                style={{ marginLeft: 8, padding: 4 }} 
                onPress={() => setShowInfoModal(true)}
                activeOpacity={0.7}
              >
                <Info size={15} color={theme.accent} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: theme.border }]} onPress={onClose}>
              <X size={16} color={theme.text} />
            </TouchableOpacity>
          </View>

          {/* Subtitle & Source Info */}
          <View style={styles.sourceMetaCard}>
            <Text style={[styles.metaText, { color: theme.subText }]}>
              분석 기준 시각 (현지): <Text style={{ color: theme.text, fontWeight: '700' }}>{formattedTime}</Text>
            </Text>
            <Text style={[styles.metaText, { color: theme.subText, marginTop: 2 }]}>
              수치 예보 모델: <Text style={{ color: theme.accent, fontWeight: '700' }}>{getSourceModelName()}</Text>
            </Text>
          </View>

          {/* Tab Selector */}
          <View style={[styles.tabContainer, { backgroundColor: theme.border }]}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'grid' && [styles.activeTabButton, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('grid')}
            >
              <Compass size={14} color={activeTab === 'grid' ? theme.accent : theme.subText} style={{ marginRight: 6 }} />
              <Text style={[styles.tabText, { color: activeTab === 'grid' ? theme.text : theme.subText }]}>레이더 그리드 맵</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'list' && [styles.activeTabButton, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('list')}
            >
              <Cloud size={14} color={activeTab === 'list' ? theme.accent : theme.subText} style={{ marginRight: 6 }} />
              <Text style={[styles.tabText, { color: activeTab === 'list' ? theme.text : theme.subText }]}>지점별 세부 수치</Text>
            </TouchableOpacity>
          </View>

          {/* Content Body */}
          {activeTab === 'grid' ? (
            <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
              
              {/* Radar Grid Map Visualization */}
              <View style={styles.radarCard}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>구름 분포 레이더 격자 (380km 범위)</Text>
                <Text style={[styles.sectionDesc, { color: theme.subText }]}>
                  가로는 관측 방향(좌-20° ~ 우+20°), 세로는 관측 거리(10km ~ 380km)를 의미합니다.
                </Text>

                {/* Altitude Filter Tabs */}
                <View style={[styles.altitudeTabContainer, { borderColor: theme.border }]}>
                  {(['all', 'low', 'mid', 'high'] as const).map((alt) => {
                    const label = alt === 'all' ? '통합' : alt === 'low' ? '저층운' : alt === 'mid' ? '중층운' : '고층운';
                    const activeColor = alt === 'low' ? '#4682B4' : alt === 'mid' ? '#9370DB' : alt === 'high' ? '#FF69B4' : theme.accent;
                    const isActive = activeAltitude === alt;
                    return (
                      <TouchableOpacity
                        key={alt}
                        style={[
                          styles.altitudeTabButton,
                          isActive && [styles.activeAltitudeTabButton, { borderBottomColor: activeColor }]
                        ]}
                        onPress={() => setActiveAltitude(alt)}
                      >
                        <Text style={[
                          styles.altitudeTabText,
                          { color: isActive ? theme.text : theme.subText, fontWeight: isActive ? '800' : '500' }
                        ]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* 5x7 Heatmap Grid */}
                <View style={styles.gridOuterContainer}>
                   {/* Y-axis Labels (Distance) */}
                   <View style={styles.yAxisLabels}>
                     {distances.map((dist) => (
                       <Text key={dist} style={[styles.yLabel, { color: theme.subText }]}>{dist}k</Text>
                     ))}
                   </View>

                  <View style={styles.gridInnerContainer}>
                    {/* Matrix Grid */}
                    <View style={styles.gridTable}>
                      {gridMatrix.map((row, rIdx) => (
                        <View key={rIdx} style={styles.gridRow}>
                          {row.map((cell, cIdx) => {
                            if (activeAltitude === 'all') {
                              return (
                                <View
                                  key={cIdx}
                                  style={[styles.gridCell, { borderColor: theme.border, height: 32, overflow: 'hidden' }]}
                                >
                                  <View style={styles.splitCellContainer}>
                                    <View style={[styles.splitCellSegment, { backgroundColor: getAltitudeColor(cell.high, 'high') }]} />
                                    <View style={[styles.splitCellSegment, { backgroundColor: getAltitudeColor(cell.mid, 'mid'), borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)' }]} />
                                    <View style={[styles.splitCellSegment, { backgroundColor: getAltitudeColor(cell.low, 'low') }]} />
                                  </View>
                                </View>
                              );
                            } else {
                              const cellVal = cell[activeAltitude];
                              const cellColor = getAltitudeColor(cellVal, activeAltitude);
                              return (
                                <View
                                  key={cIdx}
                                  style={[styles.gridCell, { backgroundColor: cellColor, borderColor: theme.border, height: 32, justifyContent: 'center', alignItems: 'center' }]}
                                >
                                  <Text style={styles.cellPercentageText}>
                                    {Math.round(cellVal)}%
                                  </Text>
                                </View>
                              );
                            }
                          })}
                        </View>
                      ))}
                    </View>

                    {/* X-axis Labels (Azimuth Offset) */}
                    <View style={styles.xAxisLabels}>
                      {angles.map((ang) => (
                        <Text key={ang} style={[styles.xLabel, { color: theme.subText }]}>
                          {ang > 0 ? `+${ang}°` : `${ang}°`}
                        </Text>
                      ))}
                    </View>
                  </View>
                </View>

                {/* Observer Dot Indicator */}
                <View style={[styles.observerIndicator, { borderTopColor: theme.border }]}>
                  <View style={[styles.observerDot, { backgroundColor: theme.accent }]} />
                  <Text style={[styles.observerLabelText, { color: theme.text }]}>
                    관측자 중심점 (0km):
                    <Text style={{ fontWeight: '800' }}>
                      {' '}저 {Math.round(observerPoint.low)}% | 중 {Math.round(observerPoint.mid)}% | 고 {Math.round(observerPoint.high)}%
                    </Text>
                  </Text>
                </View>
              </View>

              {/* Legends Section */}
              <View style={[styles.legendCard, { backgroundColor: theme.border }]}>
                <View style={styles.legendHeader}>
                  <Info size={13} color={theme.text} style={{ marginRight: 6 }} />
                  <Text style={[styles.legendTitle, { color: theme.text }]}>구름 고도 범례 및 색상 가이드</Text>
                </View>
                
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendColorBox, { backgroundColor: 'rgba(70, 130, 180, 0.8)' }]} />
                    <View style={styles.legendTextCol}>
                      <Text style={[styles.legendName, { color: theme.text }]}>저층운 (Low Clouds)</Text>
                      <Text style={[styles.legendDesc, { color: theme.subText }]}>고도 0 ~ 2km. 노을빛을 가리는 주된 원인.</Text>
                    </View>
                  </View>

                  <View style={styles.legendItem}>
                    <View style={[styles.legendColorBox, { backgroundColor: 'rgba(147, 112, 219, 0.8)' }]} />
                    <View style={styles.legendTextCol}>
                      <Text style={[styles.legendName, { color: theme.text }]}>중층운 (Mid Clouds)</Text>
                      <Text style={[styles.legendDesc, { color: theme.subText }]}>고도 2 ~ 6km. 노을 그림자를 만듦.</Text>
                    </View>
                  </View>

                  <View style={styles.legendItem}>
                    <View style={[styles.legendColorBox, { backgroundColor: 'rgba(255, 105, 180, 0.8)' }]} />
                    <View style={styles.legendTextCol}>
                      <Text style={[styles.legendName, { color: theme.text }]}>고층운 (High Clouds)</Text>
                      <Text style={[styles.legendDesc, { color: theme.subText }]}>고도 6km 이상. 붉은 빛을 반사해 노을 증폭.</Text>
                    </View>
                  </View>
                </View>
              </View>

            </ScrollView>
          ) : (
            // Raw list details for all 36 points
            <FlatList
              data={interpolatedWeather}
              keyExtractor={(item, index) => `${index}-${item.distance}-${item.azimuthOffset}`}
              style={styles.scrollBody}
              contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 16 }}
              renderItem={({ item, index }) => {
                const total = Math.round((item.low + item.mid + item.high) / 3);
                return (
                  <View style={[styles.listItem, { borderBottomColor: theme.border }]}>
                    <View style={styles.listItemLeft}>
                      <Text style={[styles.listIndex, { color: theme.subText }]}>#{index}</Text>
                      <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.listTitle, { color: theme.text }]}>
                          {item.distance === 0 ? '관측자 위치 (Observer)' : `${item.distance}km 지점`}
                        </Text>
                        {item.distance > 0 && (
                          <Text style={[styles.listSub, { color: theme.subText }]}>
                            방향 오프셋: {item.azimuthOffset > 0 ? `+${item.azimuthOffset}°` : `${item.azimuthOffset}°`}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.listItemRight}>
                      <View style={styles.cloudBadgeRow}>
                        <View style={[styles.cloudMiniBadge, { backgroundColor: 'rgba(70,130,180,0.15)' }]}>
                          <Text style={[styles.cloudMiniText, { color: '#4682B4' }]}>저 {Math.round(item.low)}%</Text>
                        </View>
                        <View style={[styles.cloudMiniBadge, { backgroundColor: 'rgba(147,112,219,0.15)' }]}>
                          <Text style={[styles.cloudMiniText, { color: '#9370DB' }]}>중 {Math.round(item.mid)}%</Text>
                        </View>
                        <View style={[styles.cloudMiniBadge, { backgroundColor: 'rgba(255,105,180,0.15)' }]}>
                          <Text style={[styles.cloudMiniText, { color: '#FF69B4' }]}>고 {Math.round(item.high)}%</Text>
                        </View>
                      </View>
                      <Text style={[styles.listTotalCloud, { color: theme.text }]}>평균 {total}%</Text>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {/* Footer Controls */}
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: theme.accent }]} onPress={onClose}>
              <Text style={styles.primaryBtnText}>분석 완료</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>

      {/* Sunset & Cloud Science Info Modal */}
      <Modal
        visible={showInfoModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowInfoModal(false)}
      >
        <View style={styles.infoOverlay}>
          <View style={[styles.infoModalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[styles.infoHeader, { borderBottomColor: theme.border }]}>
              <View style={styles.infoHeaderTitleRow}>
                <Info size={18} color={theme.accent} style={{ marginRight: 6 }} />
                <Text style={[styles.infoHeaderTitle, { color: theme.text }]}>노을 & 구름 가이드</Text>
              </View>
              <TouchableOpacity 
                style={[styles.infoCloseBtn, { backgroundColor: theme.border }]} 
                onPress={() => setShowInfoModal(false)}
              >
                <X size={14} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* Sub Tab Selector */}
            <View style={[styles.subTabContainer, { backgroundColor: theme.border }]}>
              <TouchableOpacity
                style={[styles.subTabButton, guideSubTab === 'basic' && [styles.activeSubTabButton, { backgroundColor: theme.card }]]}
                onPress={() => setGuideSubTab('basic')}
              >
                <Text style={[styles.subTabText, { color: guideSubTab === 'basic' ? theme.text : theme.subText, fontWeight: guideSubTab === 'basic' ? '800' : '600' }]}>
                  기본 가이드
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subTabButton, guideSubTab === 'encyclopedia' && [styles.activeSubTabButton, { backgroundColor: theme.card }]]}
                onPress={() => setGuideSubTab('encyclopedia')}
              >
                <Text style={[styles.subTabText, { color: guideSubTab === 'encyclopedia' ? theme.text : theme.subText, fontWeight: guideSubTab === 'encyclopedia' ? '800' : '600' }]}>
                  10종 구름 도감
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.infoScrollBody} showsVerticalScrollIndicator={false}>
              {guideSubTab === 'basic' ? (
                <>
                  {/* 1. 구름 종류 가이드 */}
                  <View style={styles.infoSection}>
                    <Text style={[styles.infoSectionTitle, { color: theme.accent }]}>☁️ 구름의 종류와 노을의 상관관계</Text>
                    <Text style={[styles.infoText, { color: theme.text }]}>
                      구름은 대기 중 떠 있는 고도에 따라 노을의 색과 형태를 크게 결정합니다.
                    </Text>
                    
                    <View style={styles.guideCard}>
                      <View style={styles.guideItem}>
                        <View style={[styles.guideColorIndicator, { backgroundColor: '#FF69B4' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.guideName, { color: theme.text }]}>고층운 (High Clouds · 6km 이상)</Text>
                          <Text style={[styles.guideDesc, { color: theme.subText }]}>
                            빙결정으로 이루어진 얇은 구름(권운 등)입니다. 지평선 아래로 해가 진 후에도 높은 고도 덕분에 오랜 시간 햇빛을 받아 붉은빛을 넓게 반사하고 증폭시킵니다.
                          </Text>
                        </View>
                      </View>

                      <View style={styles.guideItem}>
                        <View style={[styles.guideColorIndicator, { backgroundColor: '#9370DB' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.guideName, { color: theme.text }]}>중층운 (Mid Clouds · 2~6km)</Text>
                          <Text style={[styles.guideDesc, { color: theme.subText }]}>
                            고적운이나 고층운 등 물방울과 빙결정의 혼합 구름입니다. 하늘에 입체적인 틈새를 만들어 웅장한 하늘 그림자나 드라마틱한 빛내림(Crepuscular rays)을 형성합니다.
                          </Text>
                        </View>
                      </View>

                      <View style={styles.guideItem}>
                        <View style={[styles.guideColorIndicator, { backgroundColor: '#4682B4' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.guideName, { color: theme.text }]}>저층운 (Low Clouds · 0~2km)</Text>
                          <Text style={[styles.guideDesc, { color: theme.subText }]}>
                            적운, 층운 등 두껍고 지표에 가까운 구름입니다. 밀도가 높아 태양광을 가리기 쉬우며, 지평선 근처에 저층운이 빽빽하게 낄 경우 노을빛을 통째로 흡수해 흐려지게 만듭니다.
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* 2. 시뮬레이션 방법 */}
                  <View style={styles.infoSection}>
                    <Text style={[styles.infoSectionTitle, { color: theme.accent }]}>🎮 시뮬레이션 활용 방법</Text>
                    
                    <View style={styles.instructionStep}>
                      <Text style={[styles.stepNum, { color: theme.accent }]}>1</Text>
                      <Text style={[styles.stepText, { color: theme.text }]}>
                        <Text style={{ fontWeight: '800' }}>레이더 격자 맵 분석:</Text> 가로는 사용자가 바라보는 방위각 오프셋(좌-20° ~ 우+20°), 세로는 관측자와의 거리(10km ~ 380km)를 뜻합니다. 셀이 3층으로 나뉘어 있어 어떤 구름이 껴 있는지 입체적으로 파악할 수 있습니다.
                      </Text>
                    </View>
                    
                    <View style={styles.instructionStep}>
                      <Text style={[styles.stepNum, { color: theme.accent }]}>2</Text>
                      <Text style={[styles.stepText, { color: theme.text }]}>
                        <Text style={{ fontWeight: '800' }}>타임슬라이더 컨트롤:</Text> 하단의 시간 바를 좌우로 드래그하면 시뮬레이션의 가상 시각을 조정할 수 있습니다. 일출/일몰 시간 전후의 태양 고도각 변화에 맞춰 대기 굴절률과 그림자 길이가 실시간으로 예측 계산됩니다.
                      </Text>
                    </View>
                  </View>

                  {/* 3. 노을의 원리와 과학 */}
                  <View style={styles.infoSection}>
                    <Text style={[styles.infoSectionTitle, { color: theme.accent }]}>🔬 노을의 과학과 색의 변화</Text>
                    
                    <View style={[styles.scienceCard, { backgroundColor: theme.border }]}>
                      <Text style={[styles.scienceTitle, { color: theme.text }]}>레일리 산란 (Rayleigh Scattering)</Text>
                      <Text style={[styles.scienceText, { color: theme.subText }]}>
                        태양이 지평선 가까이 내려가면, 햇빛이 통과해야 하는 지구 대기층의 경로가 낮 동안보다 최대 10배 이상 길어집니다. 이 과정에서 파장이 짧은 파란색과 보라색 계열의 빛은 모두 공기 분자에 의해 도중에 산란되어 사라지고, 산란이 적고 파장이 긴 붉은색과 주황색 계열의 빛만 관측자에게 도달해 하늘이 붉게 보이게 됩니다.
                      </Text>
                      
                      <Text style={[styles.scienceTitle, { color: theme.text, marginTop: 12 }]}>대기 물질(에어로졸)과 습도의 영향</Text>
                      <Text style={[styles.scienceText, { color: theme.subText }]}>
                         대기 중의 적절한 미세먼지(PM2.5)나 염분 결정 등의 에어로졸은 산란을 활성화해 노을빛을 더 진하고 화려하게 만듭니다. 하지만 대기 오염이 지나쳐 미세먼지가 너무 많거나 공기 중 습도가 80% 이상으로 지나치게 축축할 경우, 빛의 흡수가 과도해져 채도가 낮고 어두운 회색조 노을이 관찰됩니다.
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.encyclopediaContainer}>
                  <Text style={[styles.infoSectionTitle, { color: theme.accent, marginBottom: 4 }]}>📖 기상학적 10종 운형 도감</Text>
                  <Text style={[styles.infoText, { color: theme.subText, marginBottom: 16 }]}>
                    태양빛을 시뮬레이션할 때 사용되는 실제 구름 실루엣 및 속성 데이터입니다. 카드를 눌러 상세 원리와 노을 영향을 확인하세요.
                  </Text>
                  
                  {CLOUD_BOOK_DATA.map((cloud) => {
                    const isExpanded = expandedCloud === cloud.name;
                    let viewWidth = 190;
                    let viewHeight = 48;
                    if (cloud.name === 'Cirrus' || cloud.name === 'Stratus') {
                      viewWidth = 220; viewHeight = 15;
                    } else if (cloud.name === 'Cirrostratus' || cloud.name === 'Altostratus' || cloud.name === 'Nimbostratus') {
                      viewWidth = 240; viewHeight = 24;
                    } else if (cloud.name === 'Cumulonimbus') {
                      viewWidth = 160; viewHeight = 100;
                    }
                    
                    const pathStr = CLOUD_TEMPLATES[cloud.name]?.[0] || "";
                    const badgeColor = cloud.altitudeType === 'high' ? '#FF69B4' : cloud.altitudeType === 'mid' ? '#9370DB' : '#4682B4';
                    const badgeText = cloud.altitudeType === 'high' ? '고층운' : cloud.altitudeType === 'mid' ? '중층운' : '저층운';
                    
                    return (
                      <View key={cloud.name} style={[styles.cloudBookCard, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.01)' }]}>
                        <TouchableOpacity
                          style={styles.cloudBookHeader}
                          activeOpacity={0.7}
                          onPress={() => setExpandedCloud(isExpanded ? null : cloud.name)}
                        >
                          <View style={[styles.miniSvgContainer, { backgroundColor: 'rgba(5, 5, 10, 0.4)', borderColor: theme.border }]}>
                            <Svg width="64" height="36" viewBox={`0 0 ${viewWidth} ${viewHeight}`} style={styles.miniSvg}>
                              <Path d={pathStr} fill="rgba(255,255,255,0.75)" />
                            </Svg>
                          </View>
                          
                          <View style={styles.cloudHeaderInfo}>
                            <View style={styles.cloudTitleRow}>
                              <Text style={[styles.cloudBookTitle, { color: theme.text }]}>{cloud.krName}</Text>
                              <View style={[styles.altitudeMiniBadge, { backgroundColor: `${badgeColor}20` }]}>
                                <Text style={[styles.altitudeMiniBadgeText, { color: badgeColor }]}>{badgeText}</Text>
                              </View>
                            </View>
                            <Text style={[styles.cloudBookSub, { color: theme.subText }]}>{cloud.name} | {cloud.altitudeRange}</Text>
                          </View>
                        </TouchableOpacity>
                        
                        {isExpanded && (
                          <View style={[styles.cloudBookDetails, { borderTopColor: theme.border }]}>
                            <Text style={[styles.detailDesc, { color: theme.text }]}>
                              💡 <Text style={{ fontWeight: '700' }}>특징:</Text> {cloud.summary}
                            </Text>
                            <Text style={[styles.detailDesc, { color: theme.text, marginTop: 6 }]}>
                              💨 <Text style={{ fontWeight: '700' }}>생성 원리:</Text> {cloud.origin}
                            </Text>
                            <Text style={[styles.detailDesc, { color: theme.text, marginTop: 6 }]}>
                              🌇 <Text style={{ fontWeight: '700' }}>노을 영향:</Text> {cloud.sunsetEffect}
                            </Text>
                            
                            <View style={styles.specsRow}>
                              <View style={[styles.specBadge, { backgroundColor: theme.border }]}>
                                <Text style={[styles.specBadgeText, { color: theme.text }]}>{cloud.physics.thickness}</Text>
                              </View>
                              <View style={[styles.specBadge, { backgroundColor: theme.border }]}>
                                <Text style={[styles.specBadgeText, { color: theme.text }]}>{cloud.physics.scattering}</Text>
                              </View>
                              <View style={[styles.specBadge, { backgroundColor: theme.border }]}>
                                <Text style={[styles.specBadgeText, { color: theme.text }]}>{cloud.physics.shadow}</Text>
                              </View>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>

            <View style={[styles.infoFooter, { borderTopColor: theme.border }]}>
              <TouchableOpacity 
                style={[styles.infoPrimaryBtn, { backgroundColor: theme.text }]} 
                onPress={() => setShowInfoModal(false)}
              >
                <Text style={[styles.infoPrimaryBtnText, { color: theme.card }]}>가이드 완료</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 10, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    height: '84%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourceMetaCard: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  metaText: {
    fontSize: 11,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 3,
    borderRadius: 10,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeTabButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  radarCard: {
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.01)',
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  sectionDesc: {
    fontSize: 10,
    marginTop: 4,
    lineHeight: 14,
    opacity: 0.6,
  },
  gridOuterContainer: {
    flexDirection: 'row',
    marginTop: 18,
    alignItems: 'flex-start',
  },
  yAxisLabels: {
    width: 32,
    justifyContent: 'space-between',
    height: 252, // Matches grid table height
    paddingVertical: 4,
  },
  yLabel: {
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
    paddingRight: 6,
  },
  gridInnerContainer: {
    flex: 1,
  },
  gridTable: {
    height: 252,
    justifyContent: 'space-between',
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 32,
  },
  gridCell: {
    flex: 1,
    marginHorizontal: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  cellPercentageText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 1,
  },
  xAxisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2.5,
  },
  xLabel: {
    fontSize: 8,
    fontWeight: '700',
    width: 32,
    textAlign: 'center',
  },
  observerIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  observerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  observerLabelText: {
    fontSize: 10,
    fontWeight: '600',
  },
  legendCard: {
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  legendTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  legendRow: {
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendColorBox: {
    width: 14,
    height: 14,
    borderRadius: 4,
    marginRight: 10,
  },
  legendTextCol: {
    flex: 1,
  },
  legendName: {
    fontSize: 10,
    fontWeight: '800',
  },
  legendDesc: {
    fontSize: 9,
    marginTop: 1.5,
    opacity: 0.7,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  listIndex: {
    fontSize: 10,
    fontWeight: '700',
    width: 24,
  },
  listTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  listSub: {
    fontSize: 9,
    marginTop: 2,
  },
  listItemRight: {
    alignItems: 'flex-end',
  },
  cloudBadgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  cloudMiniBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    borderRadius: 4,
  },
  cloudMiniText: {
    fontSize: 8,
    fontWeight: '800',
  },
  listTotalCloud: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#000',
  },
  altitudeTabContainer: {
    flexDirection: 'row',
    marginTop: 14,
    marginBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    gap: 4,
  },
  altitudeTabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeAltitudeTabButton: {
    // borderBottomColor will be applied dynamically
  },
  altitudeTabText: {
    fontSize: 11,
  },
  splitCellContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  splitCellSegment: {
    flex: 1,
    width: '100%',
  },
  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 10, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  infoModalCard: {
    width: '100%',
    height: '80%',
    borderRadius: 28,
    borderWidth: 1,
    overflow: 'hidden',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  infoHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  infoCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoScrollBody: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  infoSection: {
    marginBottom: 24,
  },
  infoSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 11,
    lineHeight: 16,
    opacity: 0.85,
  },
  guideCard: {
    marginTop: 10,
    gap: 12,
  },
  guideItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  guideColorIndicator: {
    width: 4,
    height: '90%',
    borderRadius: 2,
    marginTop: 2,
  },
  guideName: {
    fontSize: 11,
    fontWeight: '800',
  },
  guideDesc: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
    opacity: 0.8,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
  },
  stepNum: {
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  stepText: {
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  scienceCard: {
    borderRadius: 16,
    padding: 14,
    marginTop: 6,
  },
  scienceTitle: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  scienceText: {
    fontSize: 10,
    lineHeight: 14,
    opacity: 0.85,
  },
  infoFooter: {
    padding: 20,
    borderTopWidth: 1,
  },
  infoPrimaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoPrimaryBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  subTabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    padding: 3,
    borderRadius: 10,
  },
  subTabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeSubTabButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  subTabText: {
    fontSize: 12,
  },
  encyclopediaContainer: {
    paddingBottom: 24,
  },
  cloudBookCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  cloudBookHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  miniSvgContainer: {
    width: 68,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  miniSvg: {
    transform: [{ scale: 0.8 }],
  },
  cloudHeaderInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  cloudTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cloudBookTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  altitudeMiniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  altitudeMiniBadgeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  cloudBookSub: {
    fontSize: 10,
    marginTop: 2,
    opacity: 0.6,
  },
  cloudBookDetails: {
    borderTopWidth: 1,
    padding: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.005)',
  },
  detailDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  specsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 6,
  },
  specBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  specBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.85,
  },
});
