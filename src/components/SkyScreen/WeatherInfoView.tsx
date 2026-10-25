/**
 * WeatherInfoView.tsx
 *
 * 현재 수집한 날씨 정보의 원본 로우데이터(Raw Data)와,
 * 이를 1차 가공하여 시뮬레이션 및 노을 예측에 사용하는 데이터(Processed Data)를
 * 시각화하여 보여주는 패널입니다.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import {
  Cloud,
  Wind,
  Eye,
  Droplets,
  Sun,
  Flame,
  Activity,
  Code2,
  ChevronDown,
  ChevronUp,
  Compass,
  Layers,
  Thermometer,
} from 'lucide-react-native';
import {
  CloudData,
  CloudPathData,
  layerWindsFrom,
  getLastRawWeather,
  subscribeRawWeather,
  RawWeatherSnapshot,
} from '../../utils/weather';
import { SunsetPrediction } from '../../utils/sunsetPhysics';
import { useThemeColors } from '../../theme/useTheme';
import { radius, mono } from '../../theme/tokens';
import { t, Language } from '../../utils/i18n';

interface WeatherInfoViewProps {
  currentTime: Date;
  interpolatedWeather: CloudData[];
  pathData: CloudPathData[];
  prediction?: SunsetPrediction | null;
  latitude: number;
  longitude: number;
  theme: any;
  language: Language;
}

export const WeatherInfoView: React.FC<WeatherInfoViewProps> = ({
  currentTime,
  interpolatedWeather,
  pathData,
  prediction,
  latitude,
  longitude,
  theme,
  language,
}) => {
  const color = useThemeColors();
  const [subTab, setSubTab] = useState<'processed' | 'raw'>('processed');
  const [rawSnapshot, setRawSnapshot] = useState<RawWeatherSnapshot | null>(getLastRawWeather());
  const [showFullJson, setShowFullJson] = useState(false);

  useEffect(() => {
    setRawSnapshot(getLastRawWeather());
    const unsubscribe = subscribeRawWeather((snap) => {
      setRawSnapshot(snap);
    });
    return unsubscribe;
  }, []);

  // 관측점 (distance === 0) 현재 시각 보간 데이터
  const obs = interpolatedWeather[0] as CloudData | undefined;
  const winds = useMemo(() => layerWindsFrom(obs), [obs]);

  const hh = String(currentTime.getHours()).padStart(2, '0');
  const mm = String(currentTime.getMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${mm}`;

  // Raw 데이터에서 현재 시각에 가장 가까운 시간 인덱스 데이터 찾기
  const rawHourlyData = rawSnapshot?.mainForecast?.hourly || pathData[0]?.hourly;
  const rawCurrentIndex = useMemo(() => {
    if (!rawHourlyData?.time || !Array.isArray(rawHourlyData.time)) return -1;
    const currentMs = currentTime.getTime();
    let bestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < rawHourlyData.time.length; i++) {
      const ms = new Date(rawHourlyData.time[i]).getTime();
      const diff = Math.abs(currentMs - ms);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [rawHourlyData, currentTime]);

  const rawJsonString = useMemo(() => {
    const targetObj = rawSnapshot?.mainForecast || (pathData[0]?.hourly ? { observerHourly: pathData[0].hourly } : null);
    if (!targetObj) return null;
    try {
      return JSON.stringify(targetObj, null, 2);
    } catch {
      return String(targetObj);
    }
  }, [rawSnapshot, pathData]);

  return (
    <View style={styles.container}>
      {/* 서브 탭: 가공 데이터 vs 로우데이터 */}
      <View style={[styles.subTabContainer, { backgroundColor: theme.panelRaised || 'rgba(255,255,255,0.06)' }]}>
        <TouchableOpacity
          style={[styles.subTabButton, subTab === 'processed' && styles.subTabButtonActive]}
          onPress={() => setSubTab('processed')}
          activeOpacity={0.8}
        >
          <Activity size={13} color={subTab === 'processed' ? color.accent : color.textDim} style={{ marginRight: 6 }} />
          <Text style={[styles.subTabText, subTab === 'processed' && styles.subTabTextActive]}>
            {t('weatherProcessed', language)}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.subTabButton, subTab === 'raw' && styles.subTabButtonActive]}
          onPress={() => setSubTab('raw')}
          activeOpacity={0.8}
        >
          <Code2 size={13} color={subTab === 'raw' ? color.accent : color.textDim} style={{ marginRight: 6 }} />
          <Text style={[styles.subTabText, subTab === 'raw' && styles.subTabTextActive]}>
            {t('weatherRaw', language)}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 1차 가공 데이터 뷰 */}
      {subTab === 'processed' && (
        <View style={styles.section}>
          {/* 헤더 요약 */}
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.glass || 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleGroup}>
                <Flame size={14} color={color.glow} style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {timeStr} 시점 가공 분석치
                </Text>
              </View>
              {prediction?.score != null && (
                <View style={[styles.scoreBadge, { backgroundColor: color.glowSoft }]}>
                  <Text style={[styles.scoreBadgeText, { color: color.glow }]}>
                    노을 점수 {Math.round(prediction.score)}점 ({prediction.quality})
                  </Text>
                </View>
              )}
            </View>

            {/* 구름 4단 수치 */}
            <View style={styles.grid4}>
              <View style={styles.gridItem}>
                <Text style={[styles.gridLabel, { color: color.textDim }]}>저층운</Text>
                <Text style={[styles.gridValue, { color: theme.text }]}>
                  {obs?.low != null ? `${Math.round(obs.low)}%` : '—'}
                </Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={[styles.gridLabel, { color: color.textDim }]}>중층운</Text>
                <Text style={[styles.gridValue, { color: theme.text }]}>
                  {obs?.mid != null ? `${Math.round(obs.mid)}%` : '—'}
                </Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={[styles.gridLabel, { color: color.textDim }]}>고층운</Text>
                <Text style={[styles.gridValue, { color: color.accent }]}>
                  {obs?.high != null ? `${Math.round(obs.high)}%` : '—'}
                </Text>
              </View>
              <View style={styles.gridItem}>
                <Text style={[styles.gridLabel, { color: color.textDim }]}>총운량</Text>
                <Text style={[styles.gridValue, { color: theme.text }]}>
                  {obs?.total != null ? `${Math.round(obs.total)}%` : '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* 대기 환경 및 물리량 */}
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.glass || 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleGroup}>
                <Thermometer size={14} color={color.sun} style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>지표 환경 및 광학 지표</Text>
              </View>
            </View>

            <View style={styles.table}>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: color.textDim }]}>기온 / 노점온도</Text>
                <Text style={[styles.tableVal, { color: theme.text }]}>
                  {obs?.t2mC != null ? `${obs.t2mC.toFixed(1)}°C` : '—'} / {obs?.td2mC != null ? `${obs.td2mC.toFixed(1)}°C` : '—'}
                </Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: color.textDim }]}>상대습도 / 시정</Text>
                <Text style={[styles.tableVal, { color: theme.text }]}>
                  {obs?.humidity != null ? `${Math.round(obs.humidity)}%` : '—'} / {obs?.visibility != null ? `${(obs.visibility / 1000).toFixed(1)}km` : '—'}
                </Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: color.textDim }]}>강수량 / 직달일사(DNI)</Text>
                <Text style={[styles.tableVal, { color: theme.text }]}>
                  {obs?.precipitation != null ? `${obs.precipitation.toFixed(1)}mm` : '0.0mm'} / {obs?.directNormalIrradiance != null ? `${Math.round(obs.directNormalIrradiance)} W/m²` : '—'}
                </Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: color.textDim }]}>에어로졸(AOD550) / 수증기량</Text>
                <Text style={[styles.tableVal, { color: theme.text }]}>
                  {obs?.aod550 != null ? obs.aod550.toFixed(2) : '—'} / {obs?.totalColumnWaterVapour != null ? `${obs.totalColumnWaterVapour.toFixed(1)}mm` : '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* 층별 바람 벡터 */}
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.glass || 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleGroup}>
                <Wind size={14} color={color.accent} style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>고도별 풍향 · 풍속 (불어오는 쪽)</Text>
              </View>
            </View>

            <View style={styles.windGrid}>
              <View style={styles.windItem}>
                <Text style={[styles.windLabel, { color: color.textDim }]}>저층 (1000~850hPa)</Text>
                <Text style={[styles.windValue, { color: theme.text }]}>
                  {winds?.low ? `${Math.round(winds.low.bearingDeg)}° · ${winds.low.speedKmh.toFixed(1)} km/h` : '—'}
                </Text>
              </View>
              <View style={styles.windItem}>
                <Text style={[styles.windLabel, { color: color.textDim }]}>중층 (700~500hPa)</Text>
                <Text style={[styles.windValue, { color: theme.text }]}>
                  {winds?.mid ? `${Math.round(winds.mid.bearingDeg)}° · ${winds.mid.speedKmh.toFixed(1)} km/h` : '—'}
                </Text>
              </View>
              <View style={styles.windItem}>
                <Text style={[styles.windLabel, { color: color.textDim }]}>고층 (300~200hPa)</Text>
                <Text style={[styles.windValue, { color: theme.text }]}>
                  {winds?.high ? `${Math.round(winds.high.bearingDeg)}° · ${winds.high.speedKmh.toFixed(1)} km/h` : '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* 360° 전방위 고리 샘플링 요약 */}
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.glass || 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleGroup}>
                <Layers size={14} color="#A78BFA" style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>360° 전방위 고리 샘플</Text>
              </View>
              <Text style={[styles.badgeText, { color: '#A78BFA' }]}>
                {pathData.length}개 지점 격자
              </Text>
            </View>
            <Text style={[styles.descText, { color: color.textDim }]}>
              관측점 중심 반경 380km 둘레의 97개 방위 샘플 포인트를 실측하여 하늘 3D 돔 및 등치선 지도에 동기화하고 있습니다.
            </Text>
          </View>
        </View>
      )}

      {/* 수집 원본 로우데이터 뷰 */}
      {subTab === 'raw' && (
        <View style={styles.section}>
          {/* 요청 메타데이터 */}
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.glass || 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleGroup}>
                <Compass size={14} color={color.sun} style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>수집 요청 파라미터</Text>
              </View>
              <Text style={[styles.badgeText, { color: color.sun }]}>Open-Meteo API</Text>
            </View>

            <View style={styles.table}>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: color.textDim }]}>관측점 위경도</Text>
                <Text style={[styles.tableVal, { color: theme.text }]}>
                  {latitude.toFixed(4)}°N, {longitude.toFixed(4)}°E
                </Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: color.textDim }]}>대상 일자</Text>
                <Text style={[styles.tableVal, { color: theme.text }]}>
                  {rawSnapshot?.targetDate || currentTime.toISOString().slice(0, 10)}
                </Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={[styles.tableLabel, { color: color.textDim }]}>수집 시각 (로컬)</Text>
                <Text style={[styles.tableVal, { color: theme.text }]}>
                  {rawSnapshot?.fetchedAt ? new Date(rawSnapshot.fetchedAt).toLocaleTimeString() : '캐시 로드됨'}
                </Text>
              </View>
            </View>
          </View>

          {/* 현재 시각 기준 원본 배열 항목 값 */}
          {rawHourlyData && rawCurrentIndex >= 0 && (
            <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.glass || 'rgba(255,255,255,0.03)' }]}>
              <View style={styles.cardHeader}>
                <View style={styles.headerTitleGroup}>
                  <Code2 size={14} color={color.accent} style={{ marginRight: 6 }} />
                  <Text style={[styles.cardTitle, { color: theme.text }]}>
                    원본 배열 [{rawCurrentIndex}] ({rawHourlyData.time?.[rawCurrentIndex] || timeStr})
                  </Text>
                </View>
              </View>

              <View style={styles.table}>
                <View style={styles.tableRow}>
                  <Text style={[styles.tableLabel, { color: color.textDim }]}>cloud_cover_low</Text>
                  <Text style={[styles.tableVal, { color: theme.text }]}>
                    {rawHourlyData.cloud_cover_low?.[rawCurrentIndex] ?? rawHourlyData.low?.[rawCurrentIndex] ?? '—'}
                  </Text>
                </View>
                <View style={styles.tableRow}>
                  <Text style={[styles.tableLabel, { color: color.textDim }]}>cloud_cover_mid</Text>
                  <Text style={[styles.tableVal, { color: theme.text }]}>
                    {rawHourlyData.cloud_cover_mid?.[rawCurrentIndex] ?? rawHourlyData.mid?.[rawCurrentIndex] ?? '—'}
                  </Text>
                </View>
                <View style={styles.tableRow}>
                  <Text style={[styles.tableLabel, { color: color.textDim }]}>cloud_cover_high</Text>
                  <Text style={[styles.tableVal, { color: color.accent }]}>
                    {rawHourlyData.cloud_cover_high?.[rawCurrentIndex] ?? rawHourlyData.high?.[rawCurrentIndex] ?? '—'}
                  </Text>
                </View>
                <View style={styles.tableRow}>
                  <Text style={[styles.tableLabel, { color: color.textDim }]}>cloud_cover</Text>
                  <Text style={[styles.tableVal, { color: theme.text }]}>
                    {rawHourlyData.cloud_cover?.[rawCurrentIndex] ?? rawHourlyData.total?.[rawCurrentIndex] ?? '—'}
                  </Text>
                </View>
                <View style={styles.tableRow}>
                  <Text style={[styles.tableLabel, { color: color.textDim }]}>precipitation</Text>
                  <Text style={[styles.tableVal, { color: theme.text }]}>
                    {rawHourlyData.precipitation?.[rawCurrentIndex] ?? '0'}
                  </Text>
                </View>
                <View style={styles.tableRow}>
                  <Text style={[styles.tableLabel, { color: color.textDim }]}>direct_normal_irradiance</Text>
                  <Text style={[styles.tableVal, { color: theme.text }]}>
                    {rawHourlyData.direct_normal_irradiance?.[rawCurrentIndex] ?? rawHourlyData.directNormalIrradiance?.[rawCurrentIndex] ?? '—'}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* 전체 Raw JSON 뷰어 (접기/펼치기) */}
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.glass || 'rgba(255,255,255,0.03)' }]}>
            <TouchableOpacity
              style={styles.cardHeader}
              onPress={() => setShowFullJson(v => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.headerTitleGroup}>
                <Code2 size={14} color="#94A3B8" style={{ marginRight: 6 }} />
                <Text style={[styles.cardTitle, { color: theme.text }]}>
                  {showFullJson ? t('rawJsonHide', language) : t('rawJsonToggle', language)}
                </Text>
              </View>
              {showFullJson ? <ChevronUp size={16} color={color.textDim} /> : <ChevronDown size={16} color={color.textDim} />}
            </TouchableOpacity>

            {showFullJson && (
              <ScrollView
                style={[styles.jsonViewer, { backgroundColor: '#05070D', borderColor: theme.border }]}
                horizontal
                showsHorizontalScrollIndicator={true}
              >
                <Text style={styles.jsonText} selectable={true}>
                  {rawJsonString || t('weatherNoData', language)}
                </Text>
              </ScrollView>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingBottom: 24,
  },
  subTabContainer: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
    marginBottom: 12,
  },
  subTabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: radius.sm,
  },
  subTabButtonActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
  },
  subTabText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
  },
  subTabTextActive: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  section: {
    gap: 10,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  scoreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  scoreBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  descText: {
    fontSize: 11,
    lineHeight: 16,
  },
  grid4: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  gridItem: {
    flex: 1,
    alignItems: 'center',
  },
  gridLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  gridValue: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: mono,
  },
  table: {
    gap: 6,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableLabel: {
    fontSize: 12,
  },
  tableVal: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: mono,
  },
  windGrid: {
    gap: 8,
  },
  windItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  windLabel: {
    fontSize: 12,
  },
  windValue: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: mono,
  },
  jsonViewer: {
    maxHeight: 280,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 10,
    marginTop: 6,
  },
  jsonText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#A5B4FC',
    lineHeight: 15,
  },
});
