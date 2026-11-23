/**
 * DataSection.tsx — 데이터 페이지 **근거 데이터 · 출처** 구역.
 *
 * 목업 ④ 하단의 `원본 데이터 · 출처` 표처럼 현재 선택 시각의 원자료 핵심 줄(운량·기온/이슬점·습도/시정·바람·에어로졸)을
 * 먼저 요약해 보여주고, 상세 고리 정보와 전체 원본 JSON은 접어 둡니다.
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
  tz: number;
  latitude: number;
  longitude: number;
  at: Date;
  path: CloudPathData[] | null;
  prediction: { score: number; quality: string } | null;
  downloadedAtMs: number | null;
  source: 'ring' | 'forecast' | null;
  isRefreshing: boolean;
  refreshError: string | null;
  onForceRefresh?: () => void;
}

const dash = '—';
const num = (v: number | null | undefined, digits = 0, unit = '') =>
  v != null && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : dash;

export const DataSection: React.FC<Props> = ({
  language,
  tz,
  latitude,
  longitude,
  at,
  path,
  prediction,
  downloadedAtMs,
  source,
  isRefreshing,
  refreshError,
  onForceRefresh,
}) => {
  const color = useThemeColors();
  const styles = useStyles();
  const [rawSnapshot, setRawSnapshot] = useState<RawWeatherSnapshot | null>(getLastRawWeather());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setRawSnapshot(getLastRawWeather());
    return subscribeRawWeather((snap) => {
      setRawSnapshot(snap);
      setNowMs(Date.now());
    });
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dateStr = useMemo(() => localDateString(at), [at]);
  const info = useMemo(
    () =>
      resolveWeatherDownloadInfo({
        cacheEntry: downloadedAtMs ? { timestamp: downloadedAtMs, data: path ?? [] } : null,
        rawSnapshot,
        pathData: path,
        targetDateStr: dateStr,
        latitude,
        longitude,
      }),
    [downloadedAtMs, path, rawSnapshot, dateStr, latitude, longitude],
  );
  const matchingRaw = info.hasMatchingRawSnapshot ? rawSnapshot : null;

  const obs = useMemo(() => (path?.length ? getInterpolatedWeather(path, at)[0] : undefined), [path, at]);
  const winds = useMemo(() => layerWindsFrom(obs), [obs]);
  const hasWind = !!(winds?.low || winds?.mid || winds?.high);

  const rawHourly: any = matchingRaw?.mainForecast?.hourly || path?.[0]?.hourly;
  const rawIndex = useMemo(() => {
    if (!rawHourly?.time || !Array.isArray(rawHourly.time)) return -1;
    const ms = at.getTime();
    let best = 0;
    let min = Infinity;
    for (let i = 0; i < rawHourly.time.length; i++) {
      const d = Math.abs(ms - new Date(rawHourly.time[i]).getTime());
      if (d < min) {
        min = d;
        best = i;
      }
    }
    return best;
  }, [rawHourly, at]);

  const rawJson = useMemo(() => {
    const obj = matchingRaw?.mainForecast || (path?.[0]?.hourly ? { observerHourly: path[0].hourly } : null);
    if (!obj) return null;
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }, [matchingRaw, path]);

  const clock =
    info.downloadedAtMs != null
      ? `${formatWeatherDownloadClock(info.downloadedAtMs)} · ${formatWeatherDownloadAge(info.downloadedAtMs, nowMs, language)}`
      : info.sourceKind === 'fallback'
        ? L3(language, '합성 맑음 폴백 (API 한도)', 'Synthetic fallback (rate limit)', '合成フォールバック (制限)')
        : L3(language, '아직 수신 기록 없음', 'Not downloaded yet', '未取得');

  const badge =
    source === 'forecast'
      ? L3(language, '16일 예보', '16-day forecast', '16日予報')
      : source === 'ring'
        ? info.sourceKind === 'network'
          ? L3(language, '신규 수신', 'Fresh', '新規取得')
          : L3(language, '캐시 보관분', 'Cached', 'キャッシュ')
        : info.sourceKind === 'fallback'
          ? L3(language, '폴백', 'Fallback', '代替')
          : null;

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
    w ? `${Math.round(w.bearingDeg)}° · ${w.speedKmh.toFixed(1)} km/h` : dash;

  const totCloud = obs?.total != null && Number.isFinite(obs.total)
    ? obs.total
    : obs ? Math.max(obs.low, obs.mid, obs.high) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          {L3(language, '원본 데이터 · 출처', 'Raw data · Source', '元データ・出典')}
        </Text>
        <Text style={styles.sub}>{L3(language, `${timeStr} 기준`, `At ${timeStr}`, `${timeStr} 時点`)}</Text>
      </View>

      {/* 수신 시각 + 새로고침 */}
      <View style={styles.card}>
        <View style={styles.syncRow}>
          <View style={styles.syncInfo}>
            <View style={styles.syncTitleRow}>
              <Clock size={12} color={color.accent} />
              <Text style={styles.micro}>{L3(language, '수신 시각', 'Downloaded', '取得時刻')}</Text>
              {!!badge && (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{badge}</Text>
                </View>
              )}
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
        {!!refreshError && <Text style={[styles.sub, { color: color.danger }]}>{refreshError}</Text>}
      </View>

      {/* 목업형 핵심 요약 테이블 */}
      {path ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>
              {L3(language, `${timeStr} 예보 원값`, `Raw forecast at ${timeStr}`, `${timeStr} の予報値`)}
            </Text>
            {prediction?.score != null && (
              <Text style={[styles.badge, { color: color.glow, backgroundColor: color.glowSoft }]}>
                {`${verdictWord(prediction.quality as any, language)} ${Math.round(prediction.score)}`}
              </Text>
            )}
          </View>
          <View style={styles.table}>
            {row(
              L3(language, '총운량 (하 / 중 / 상)', 'Clouds (L / M / H)', '雲量 (下 / 中 / 上)'),
              `${num(totCloud, 0, '%')} (${num(obs?.low, 0)} / ${num(obs?.mid, 0)} / ${num(obs?.high, 0)})`,
            )}
            {row(
              L3(language, '기온 / 이슬점', 'Temp / Dew point', '気温 / 露点'),
              `${num(obs?.t2mC, 1, '°C')} / ${num(obs?.td2mC, 1, '°C')}`,
            )}
            {row(
              L3(language, '습도 / 시정', 'Humidity / Vis', '湿度 / 視程'),
              `${num(obs?.humidity, 0, '%')} / ${obs?.visibility != null ? `${(obs.visibility / 1000).toFixed(1)} km` : dash}`,
            )}
            {row(
              L3(language, '850hPa 바람', '850hPa wind', '850hPa 風'),
              hasWind ? windText(winds?.low) : dash,
            )}
            {row(
              L3(language, '250hPa 제트', '250hPa jet', '250hPa 風'),
              hasWind ? windText(winds?.high) : dash,
            )}
            {row(
              L3(language, '에어로졸(AOD) / PM2.5', 'AOD550 / PM2.5', 'AOD550 / PM2.5'),
              `${obs?.aod550 != null ? obs.aod550.toFixed(2) : dash} / ${obs?.pm25 != null ? `${Math.round(obs.pm25)} µg/m³` : dash}`,
            )}
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.sub}>
            {L3(language, '이 시각을 계산한 예보 자료가 아직 없어요.', 'No forecast data loaded for this time yet.', 'この時刻の予報データはまだありません。')}
          </Text>
        </View>
      )}

      {/* 수집 원본 로우데이터 + 전체 JSON (접어 둠) */}
      {path && (
        <Collapsible
          title={L3(language, '수집 원본 · JSON 보기', 'Raw samples & JSON', '元データ・JSON')}
          right={source === 'forecast'
            ? L3(language, `${path.length}점`, `${path.length} pts`, `${path.length}地点`)
            : L3(language, `고리 ${path.length}점`, `${path.length} ring pts`, `${path.length}点`)}
        >
          <View style={styles.table}>
            {row(L3(language, '관측점 위경도', 'Observer lat / lon', '緯度経度'), `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`)}
            {row(L3(language, '대상 일자', 'Date', '対象日'), dateStr)}
            {row(L3(language, '강수 / 직달일사', 'Rain / DNI', '降水 / 直達日射'), `${obs?.precipitation != null ? `${obs.precipitation.toFixed(1)}mm` : '0.0mm'} / ${obs?.directNormalIrradiance != null ? `${Math.round(obs.directNormalIrradiance)} W/m²` : dash}`)}
            {rawHourly && rawIndex >= 0 && row('cloud_cover (L/M/H)', `${cellRaw('cloud_cover_low', 'low')} / ${cellRaw('cloud_cover_mid', 'mid')} / ${cellRaw('cloud_cover_high', 'high')}`)}
          </View>
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
      )}

      <Text style={styles.sourceFoot}>
        {L3(language, 'Open-Meteo · 지형 고도는 DEM 직접 계산', 'Open-Meteo · Terrain horizon computed from DEM', 'Open-Meteo・地形稜線はDEM直接計算')}
      </Text>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  title: { ...type.title, fontSize: 16, color: color.text },
  sub: { ...type.body, color: color.textDim },
  micro: { ...type.micro, color: color.textDim },
  card: { backgroundColor: color.fill, borderRadius: radius.md, padding: space.md, gap: space.xs },
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
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
  },
  refreshBtnOff: { opacity: 0.6 },
  refreshText: { ...type.bodyStrong, color: color.accent },
  table: { gap: space.xs + 2 },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingBottom: 4,
  },
  tableLabel: { ...type.body, fontSize: 12.5, color: color.textDim, flexShrink: 1 },
  tableVal: { fontFamily: mono, fontSize: 12, color: color.text, flexShrink: 0, maxWidth: '58%', textAlign: 'right' },
  jsonViewer: { maxHeight: 260, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: '#05070D', padding: 10 },
  jsonText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10, color: '#A5B4FC', lineHeight: 15 },
  sourceFoot: { fontSize: 11.5, color: color.textMute },
}));
