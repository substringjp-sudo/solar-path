/**
 * DataSection.tsx — 학습 페이지의 **근거 데이터** 구역(옛 01 하늘 시트의 "기상 정보" 탭을 옮겼습니다. docs/SANDBOX_MODE_PLAN.md 13.2).
 *
 * 고른 칸의 점수를 센 예보 자료를 그대로 보여 줍니다. 항목마다 중요한 것만 먼저 보이고 나머지는 접습니다.
 *  - 먼저 보임: 다운로드 시점(과 다시 받기), 그 시각의 구름 층별 수치와 노을 점수.
 *  - 접어 둠: 지표 환경 및 광학 지표, 고도별 풍향 · 풍속, 360° 고리 샘플, 수집 원본 로우데이터(요청 값 · 원본 배열 · 전체 JSON).
 *
 * 옛 화면과 달라진 것:
 *  - "가공 데이터 / 로우데이터" 두 탭이 없어졌습니다. 로우데이터는 접는 줄 하나입니다.
 *  - 시각은 01 하늘이 보던 시각이 아니라 **고른 칸의 가장 붉을 때**입니다(`at`). 점수 · 자료 · 시각이 한 칸에서 나와 서로 어긋나지 않습니다.
 *  - "강제 갱신" 은 16일 예보를 새로 받습니다(`onForceRefresh`). 01 하늘이 쓰는 주변 360° 예보와는 따로입니다.
 *  - 글자와 색이 디자인 시스템 토큰을 따릅니다(옛 화면은 어두운 색을 직접 적어 밝은 모드에서 읽기 어려웠습니다).
 *
 * 값을 지어내지 않습니다: 자료가 없으면 "—", 받지 못했으면 그렇다고 적습니다.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native';
import { Clock, RefreshCw } from 'lucide-react-native';
import { getInterpolatedWeather, getLastRawWeather, layerWindsFrom, subscribeRawWeather, type CloudPathData, type RawWeatherSnapshot } from '../../utils/weather';
import { formatWeatherDownloadAge, formatWeatherDownloadClock, resolveWeatherDownloadInfo } from '../../utils/cachePolicy';
import { localDateString } from '../../utils/localDate';
import { L3, type Language } from '../../utils/i18n';
import { mono, radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import { localHHMM, verdictWord } from '../SunsetSimulation/PredictionCard';
import { Collapsible, Fold } from './Collapsible';

interface Props {
  language: Language;
  /** 관측지 UTC 오프셋(시간) */
  tz: number;
  latitude: number;
  longitude: number;
  /** 근거를 센 시각 — 고른 칸의 가장 붉을 때. 칸이 없으면 고른 날 정오. */
  at: Date;
  /** 그 칸을 센 예보 자료. 없으면 null(받는 중 · 받지 못함). */
  path: CloudPathData[] | null;
  /** 그 칸의 노을 예측. 점수를 보일 수 없는 칸(앞날 · 예보 없음)이면 null. */
  prediction: { score: number; quality: string } | null;
  /** 그 자료를 받은 시각(ms). 모르면 null. */
  downloadedAtMs: number | null;
  /** 어느 자료로 셌는가: 주변 360° 예보(링) · 16일 예보. */
  source: 'ring' | 'forecast' | null;
  isRefreshing: boolean;
  refreshError: string | null;
  onForceRefresh?: () => void;
}

const dash = '—';
const num = (v: number | null | undefined, digits = 0, unit = '') => (v != null && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : dash);

export const DataSection: React.FC<Props> = ({ language, tz, latitude, longitude, at, path, prediction, downloadedAtMs, source, isRefreshing, refreshError, onForceRefresh }) => {
  const color = useThemeColors(); const styles = useStyles();
  const [rawSnapshot, setRawSnapshot] = useState<RawWeatherSnapshot | null>(getLastRawWeather());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setRawSnapshot(getLastRawWeather());
    return subscribeRawWeather((snap) => { setRawSnapshot(snap); setNowMs(Date.now()); });
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dateStr = useMemo(() => localDateString(at), [at]);
  const info = useMemo(() => resolveWeatherDownloadInfo({
    cacheEntry: downloadedAtMs ? { timestamp: downloadedAtMs, data: path ?? [] } : null,
    rawSnapshot,
    pathData: path,
    targetDateStr: dateStr,
    latitude,
    longitude,
  }), [downloadedAtMs, path, rawSnapshot, dateStr, latitude, longitude]);
  const matchingRaw = info.hasMatchingRawSnapshot ? rawSnapshot : null;

  // 고른 시각의 관측점(distance 0) 보간 값과 층별 바람
  const obs = useMemo(() => (path?.length ? getInterpolatedWeather(path, at)[0] : undefined), [path, at]);
  const winds = useMemo(() => layerWindsFrom(obs), [obs]);

  // 원본 배열에서 그 시각에 가장 가까운 칸
  const rawHourly: any = matchingRaw?.mainForecast?.hourly || path?.[0]?.hourly;
  const rawIndex = useMemo(() => {
    if (!rawHourly?.time || !Array.isArray(rawHourly.time)) return -1;
    const ms = at.getTime();
    let best = 0, min = Infinity;
    for (let i = 0; i < rawHourly.time.length; i++) {
      const d = Math.abs(ms - new Date(rawHourly.time[i]).getTime());
      if (d < min) { min = d; best = i; }
    }
    return best;
  }, [rawHourly, at]);
  const rawJson = useMemo(() => {
    const obj = matchingRaw?.mainForecast || (path?.[0]?.hourly ? { observerHourly: path[0].hourly } : null);
    if (!obj) return null;
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  }, [matchingRaw, path]);

  const clock = info.downloadedAtMs != null
    ? `${formatWeatherDownloadClock(info.downloadedAtMs)} · ${formatWeatherDownloadAge(info.downloadedAtMs, nowMs, language)}`
    : info.sourceKind === 'fallback'
      ? L3(language, '합성 맑음 폴백 (API 한도)', 'Synthetic fallback (rate limit)', '合成フォールバック (制限)')
      : L3(language, '아직 수신 기록 없음', 'Not downloaded yet', '未取得');
  const badge = source === 'forecast'
    ? L3(language, '16일 예보', '16-day forecast', '16日予報')
    : source === 'ring'
      ? (info.sourceKind === 'network' ? L3(language, '신규 수신', 'Fresh', '新規取得') : L3(language, '캐시 보관분', 'Cached', 'キャッシュ'))
      : info.sourceKind === 'fallback' ? L3(language, '폴백', 'Fallback', '代替') : null;

  const timeStr = localHHMM(at, tz);
  const cellRaw = (key: string, alt?: string) => {
    const v = rawHourly?.[key]?.[rawIndex] ?? (alt ? rawHourly?.[alt]?.[rawIndex] : undefined);
    return v == null ? dash : String(v);
  };

  const row = (label: string, value: string, accent = false) => (
    <View key={label} style={styles.tableRow}>
      <Text style={styles.tableLabel}>{label}</Text>
      <Text style={[styles.tableVal, accent && { color: color.accent }]}>{value}</Text>
    </View>
  );
  const windText = (w: { bearingDeg: number; speedKmh: number } | null | undefined) =>
    (w ? `${Math.round(w.bearingDeg)}° · ${w.speedKmh.toFixed(1)} km/h` : dash);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{L3(language, '근거 데이터', 'The data behind it', '根拠のデータ')}</Text>
        <Text style={styles.sub}>{L3(language, `${timeStr} 에 쓴 예보`, `Forecast used for ${timeStr}`, `${timeStr} に使った予報`)}</Text>
      </View>

      {/* 먼저 보임 1: 다운로드 시점과 다시 받기 */}
      <View style={styles.card}>
        <View style={styles.syncRow}>
          <View style={styles.syncInfo}>
            <View style={styles.syncTitleRow}>
              <Clock size={12} color={color.accent} />
              <Text style={styles.micro}>{L3(language, '다운로드 시점', 'Downloaded at', '取得時刻')}</Text>
              {!!badge && <View style={styles.pill}><Text style={styles.pillText}>{badge}</Text></View>}
            </View>
            <Text style={styles.syncValue} numberOfLines={2}>{clock}</Text>
          </View>
          {onForceRefresh && (
            <PressScale
              style={[styles.refreshBtn, isRefreshing && styles.refreshBtnOff]}
              onPress={onForceRefresh}
              disabled={isRefreshing}
              accessibilityRole="button"
              accessibilityLabel={L3(language, '16일 예보 다시 받기', 'Re-download the 16-day forecast', '16日予報を再取得')}
            >
              {isRefreshing ? <ActivityIndicator size="small" color={color.accent} /> : <RefreshCw size={14} color={color.accent} />}
              <Text style={styles.refreshText}>
                {isRefreshing ? L3(language, '받는 중…', 'Fetching…', '取得中…') : L3(language, '다시 받기', 'Refresh', '再取得')}
              </Text>
            </PressScale>
          )}
        </View>
        {refreshError
          ? <Text style={[styles.sub, { color: color.danger }]}>{refreshError}</Text>
          : <Text style={styles.sub}>{L3(language, '저장해 둔 것이 있어도 16일 예보를 새로 받습니다.', 'Downloads the 16-day forecast again even if one is saved.', '保存済みがあっても16日予報を取り直します。')}</Text>}
      </View>

      {/* 먼저 보임 2: 그 시각의 구름 층별 수치와 노을 점수 */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{L3(language, `${timeStr} 시점 가공 분석치`, `Processed values at ${timeStr}`, `${timeStr} 時点の加工値`)}</Text>
          {prediction?.score != null && (
            <Text style={[styles.badge, { color: color.glow, backgroundColor: color.glowSoft }]}>
              {L3(language, `노을 점수 ${Math.round(prediction.score)}점`, `Glow score ${Math.round(prediction.score)}`, `夕焼けスコア ${Math.round(prediction.score)}点`)}
              {` · ${verdictWord(prediction.quality as any, language)}`}
            </Text>
          )}
        </View>
        {path ? (
          <View style={styles.grid4}>
            {([
              [L3(language, '저층운', 'Low', '下層雲'), obs?.low, false],
              [L3(language, '중층운', 'Mid', '中層雲'), obs?.mid, false],
              [L3(language, '고층운', 'High', '上層雲'), obs?.high, true],
              [L3(language, '총운량', 'Total', '全雲量'), obs?.total, false],
            ] as const).map(([label, v, accent]) => (
              <View key={label} style={styles.gridItem}>
                <Text style={styles.micro}>{label}</Text>
                <Text style={[styles.gridValue, accent && { color: color.accent }]}>{num(v, 0, '%')}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.sub}>{L3(language, '이 칸을 센 예보 자료가 아직 없어요.', 'The forecast data for this cell is not available yet.', 'このマスを計算した予報データはまだありません。')}</Text>
        )}
      </View>

      {path && (
        <>
          <Collapsible title={L3(language, '지표 환경 및 광학 지표', 'Surface and optical values', '地表環境と光学指標')}>
            <View style={styles.table}>
              {row(L3(language, '기온 / 노점온도', 'Temp / dew point', '気温 / 露点'), `${num(obs?.t2mC, 1, '°C')} / ${num(obs?.td2mC, 1, '°C')}`)}
              {row(L3(language, '상대습도 / 시정', 'Humidity / visibility', '相対湿度 / 視程'), `${num(obs?.humidity, 0, '%')} / ${obs?.visibility != null ? `${(obs.visibility / 1000).toFixed(1)}km` : dash}`)}
              {row(L3(language, '강수량 / 직달일사', 'Rain / direct sun (DNI)', '降水量 / 直達日射'), `${obs?.precipitation != null ? `${obs.precipitation.toFixed(1)}mm` : '0.0mm'} / ${obs?.directNormalIrradiance != null ? `${Math.round(obs.directNormalIrradiance)} W/m²` : dash}`)}
              {row(L3(language, '에어로졸(AOD550) / 수증기량', 'Aerosol (AOD550) / water vapour', 'エアロゾル(AOD550) / 水蒸気量'), `${obs?.aod550 != null ? obs.aod550.toFixed(2) : dash} / ${num(obs?.totalColumnWaterVapour, 1, 'mm')}`)}
            </View>
          </Collapsible>

          <Collapsible title={L3(language, '고도별 풍향 · 풍속', 'Wind by altitude', '高度別の風向・風速')} peek={L3(language, '불어오는 쪽 기준', 'Direction the wind blows from', '吹いてくる方向')}>
            <View style={styles.table}>
              {row(L3(language, '저층 (1000~850hPa)', 'Low (1000–850 hPa)', '下層 (1000~850hPa)'), windText(winds?.low))}
              {row(L3(language, '중층 (700~500hPa)', 'Mid (700–500 hPa)', '中層 (700~500hPa)'), windText(winds?.mid))}
              {row(L3(language, '고층 (300~200hPa)', 'High (300–200 hPa)', '上層 (300~200hPa)'), windText(winds?.high))}
            </View>
          </Collapsible>

          <Collapsible
            title={L3(language, '360° 전방위 고리 샘플', '360° ring samples', '360°リングのサンプル')}
            right={L3(language, `${path.length}개 지점`, `${path.length} points`, `${path.length}地点`)}
          >
            <Text style={styles.sub}>
              {L3(language, '관측점 둘레의 방위마다 구름을 재서(최대 반경 380km) 하늘 3D 돔과 등치선 지도에 씁니다.',
                'Clouds are sampled in every direction around the observer (up to 380 km) and used by the 3D sky and the isoline map.',
                '観測点の周りの方位ごとに雲を測り(最大半径380km)、3D空と等値線地図に使います。')}
            </Text>
          </Collapsible>

          <Collapsible
            title={L3(language, '수집 원본 로우데이터', 'Raw collected data', '収集した元データ')}
            right="Open-Meteo"
          >
            <View style={styles.table}>
              {row(L3(language, '관측점 위경도', 'Observer lat / lon', '観測点の緯度経度'), `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`)}
              {row(L3(language, '대상 일자', 'Date', '対象日'), dateStr)}
              {row(L3(language, '수집 시각', 'Collected at', '取得時刻'), clock)}
            </View>
            {rawHourly && rawIndex >= 0 && (
              <View style={styles.table}>
                <Text style={styles.micro}>{`[${rawIndex}] ${rawHourly.time?.[rawIndex] ?? timeStr}`}</Text>
                {row('cloud_cover_low', cellRaw('cloud_cover_low', 'low'))}
                {row('cloud_cover_mid', cellRaw('cloud_cover_mid', 'mid'))}
                {row('cloud_cover_high', cellRaw('cloud_cover_high', 'high'), true)}
                {row('cloud_cover', cellRaw('cloud_cover', 'total'))}
                {row('precipitation', rawHourly.precipitation?.[rawIndex] != null ? String(rawHourly.precipitation[rawIndex]) : '0')}
                {row('direct_normal_irradiance', cellRaw('direct_normal_irradiance', 'directNormalIrradiance'))}
              </View>
            )}
            <Fold
              label={L3(language, '전체 JSON 보기', 'Show the full JSON', 'JSON 全体を見る')}
              closeLabel={L3(language, 'JSON 접기', 'Hide the JSON', 'JSON を閉じる')}
            >
              <ScrollView style={styles.jsonViewer} horizontal showsHorizontalScrollIndicator>
                <Text style={styles.jsonText} selectable>
                  {rawJson ?? L3(language, '받은 자료가 없어요', 'No data received', '受信したデータがありません')}
                </Text>
              </ScrollView>
            </Fold>
          </Collapsible>
        </>
      )}
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  title: { ...type.title, color: color.text },
  sub: { ...type.body, color: color.textDim },
  micro: { ...type.micro, color: color.textDim },
  card: { backgroundColor: color.panel, borderRadius: radius.md, padding: space.md, gap: space.xs },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  cardTitle: { ...type.bodyStrong, color: color.text, flexShrink: 1 },
  badge: { ...type.label, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, overflow: 'hidden' },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  syncInfo: { flex: 1, gap: 2 },
  syncTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  syncValue: { ...type.bodyStrong, color: color.text },
  pill: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  pillText: { ...type.micro, color: color.textDim },
  refreshBtn: {
    minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft,
  },
  refreshBtnOff: { opacity: 0.6 },
  refreshText: { ...type.bodyStrong, color: color.accent },
  grid4: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  gridItem: { flexGrow: 1, flexBasis: '22%', minWidth: 64, gap: 2 },
  gridValue: { fontFamily: mono, fontSize: 16, fontWeight: '700', color: color.text },
  table: { gap: space.xs },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md },
  tableLabel: { ...type.body, color: color.textDim, flexShrink: 1 },
  tableVal: { fontFamily: mono, fontSize: 12, color: color.text, flexShrink: 0, maxWidth: '60%', textAlign: 'right' },
  jsonViewer: { maxHeight: 280, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: '#05070D', padding: 10 },
  jsonText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10, color: '#A5B4FC', lineHeight: 15 },
}));
