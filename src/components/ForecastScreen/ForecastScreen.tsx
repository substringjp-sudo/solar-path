/**
 * ForecastScreen.tsx — **02 예보**: 앞으로 16일, 날마다 일출 · 일몰 판정(2026-10-25, 디자인 2단).
 *
 * 01 하늘은 한 순간을 깊게 보여 주고, 여기는 "언제 나가면 좋은가" 를 한눈에 보여 줍니다.
 *
 *  - 판정 · 점수 · 시각은 01 하늘 요약 줄과 **같은 식**입니다(`sunForecast.eventVerdict` → `glowPeak` →
 *    `scenePrediction`). 그날 링을 받아 두었으면 링으로 세어 숫자까지 같습니다.
 *  - 확실도는 색이 아니라 **무늬**입니다(개정 A3): 3일 안은 꽉 찬 칸 + 점수, 7일 안은 빗금, 16일 안은 점선
 *    (참고). 앞날일수록 점수를 숨기는 것은 숫자가 실제보다 정확해 보이지 않게 하려는 것입니다.
 *  - 칸을 누르면 그 출몰의 "가장 붉을 때" 로 01 하늘을 엽니다.
 *  - 예보가 없는 출몰(모델이 끝난 날 · 받지 못함)은 "예보 없음" 입니다. 맑다고 지어내지 않습니다.
 *  - 이 탭을 처음 열 때만 받습니다(요청 1건, 한 시간 캐시). 앱을 켤 때 받지 않습니다.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { Bell, BellOff, RotateCw, Sunrise, Sunset } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3, type Language } from '../../utils/i18n';
import { radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';
import { PressScale, PrimaryButton } from '../ui';
import { placeLabel } from '../AppHeader';
import { VERDICT_ORDER, verdictColor, verdictLevel, verdictWord, localHHMM } from '../SunsetSimulation/PredictionCard';
import {
  bestUpcoming,
  buildForecastDays,
  fetchSunForecast,
  cachedSunForecast,
  observerElevationFrom,
  type ForecastDay,
  type ForecastEvent,
} from '../../utils/sunForecast';
import { localDateString } from '../../utils/localDate';
import { hapticError } from '../../utils/haptics';
import { sameBucket } from '../../utils/weatherCacheKey';
import type { AccuracyTier } from '../../utils/timeBar';
import type { CloudPathData } from '../../utils/weather';

interface ForecastScreenProps {
  /** 탭이 보이는가 — 보일 때만 받고 셉니다. */
  isActive: boolean;
  setCurrentTime: (time: Date) => void;
  /** 칸을 누르면 01 하늘로 */
  onOpenSky: () => void;
}

type LoadState = { kind: 'idle' | 'loading' | 'ready' } | { kind: 'error'; rateLimited: boolean };

const WEEKDAYS: Record<'ko' | 'en' | 'ja', string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
};

/** 관측지 현지 날짜 "10/27 (화)" */
const dayLabel = (noonMs: number, tz: number, language: Language) => {
  const l = new Date(noonMs + tz * 3_600_000);
  const wd = WEEKDAYS[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'][l.getUTCDay()];
  return `${l.getUTCMonth() + 1}/${l.getUTCDate()} (${wd})`;
};

/** 줄의 무리 — 그날 일몰(없으면 일출)의 등급. 지난 것은 3일 안에 넣습니다. */
const rowTier = (d: ForecastDay): AccuracyTier => {
  const t = (d.sunset ?? d.sunrise)?.tier ?? 'none';
  return t === 'past' ? 'high' : t;
};
const showsScore = (tier: AccuracyTier) => tier === 'high' || tier === 'past';

/** 판정 칸 하나 — 확실도를 무늬로(꽉 참 · 빗금 · 점선). */
const MeterCell: React.FC<{ on: boolean; tier: AccuracyTier; tone: string; off: string; w?: number; h?: number }> = ({
  on, tier, tone, off, w = 14, h = 6,
}) => {
  if (!on) return <View style={{ width: w, height: h, borderRadius: 2, backgroundColor: off }} />;
  if (showsScore(tier)) return <View style={{ width: w, height: h, borderRadius: 2, backgroundColor: tone }} />;
  if (tier === 'medium') {
    return (
      <Svg width={w} height={h}>
        <Rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={1.5} stroke={tone} strokeWidth={1} fill="none" />
        {[-6, -2, 2, 6, 10, 14].map(x => <Line key={x} x1={x} y1={h} x2={x + h} y2={0} stroke={tone} strokeWidth={1} />)}
      </Svg>
    );
  }
  return (
    <Svg width={w} height={h}>
      <Rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={1.5} stroke={tone} strokeWidth={1} strokeDasharray="2 2" fill="none" />
    </Svg>
  );
};

export const ForecastScreen: React.FC<ForecastScreenProps> = ({ isActive, setCurrentTime, onOpenSky }) => {
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles();
  const language = useCelestialStore(s => s.language);
  const location = useCelestialStore(s => s.location);
  const tz = useCelestialStore(s => s.timezoneOffsetHours) ?? 0;
  const savedLocations = useCelestialStore(s => s.savedLocations);
  const weatherCacheList = useCelestialStore(s => s.weatherCacheList);
  const terrainCacheList = useCelestialStore(s => s.terrainCacheList);
  const goodOnly = useCelestialStore(s => !!s.notifPrefs?.goodOnly);
  const setNotifPref = useCelestialStore(s => s.setNotifPref);

  // 320 폭에서는 칸 · 날짜 칸을 줄여 시각이 칸 위로 겹치지 않게 합니다(반쪽 폭 약 100).
  const narrow = useWindowDimensions().width < 360;
  const cellW = narrow ? 10 : 14;

  const lat = location?.coords?.latitude;
  const lon = location?.coords?.longitude;
  const place = placeLabel(lat, lon, savedLocations);

  const [forecast, setForecast] = useState<CloudPathData[] | null>(() =>
    lat != null && lon != null ? cachedSunForecast(lat, lon)?.path ?? null : null);
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' });
  // "지금" 은 탭을 열 때마다 새로 — 렌더마다 바꾸면 16일 판정을 매번 다시 셉니다.
  const [now, setNow] = useState(() => new Date());

  const get = useCallback((force: boolean) => {
    if (lat == null || lon == null) return () => {};
    const ctrl = new AbortController();
    setLoad({ kind: 'loading' });
    fetchSunForecast(lat, lon, new Date(), { force, signal: ctrl.signal, tzHours: tz })
      .then(d => { setForecast(d.path); setLoad({ kind: 'ready' }); })
      .catch(err => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return;
        hapticError();
        setLoad({ kind: 'error', rateLimited: String(err?.message) === 'RATE_LIMIT' });
      });
    return () => ctrl.abort();
  }, [lat, lon, tz]);

  useEffect(() => {
    if (!isActive) return;
    setNow(new Date());
    return get(false);
  }, [isActive, get]);

  const elev = lat != null && lon != null ? observerElevationFrom(terrainCacheList, lat, lon, location?.coords?.altitude) : undefined;
  const ringFor = useCallback((at: Date) => {
    if (lat == null || lon == null) return null;
    const dateStr = localDateString(at);
    const hit = weatherCacheList.find(c => c.key.includes(dateStr) && sameBucket(c.latitude, c.longitude, lat, lon));
    return (hit?.data as CloudPathData[] | undefined) ?? null;
  }, [weatherCacheList, lat, lon]);

  const days = useMemo(() => {
    if (lat == null || lon == null) return [];
    return buildForecastDays({ latitude: lat, longitude: lon, now, tzHours: tz, observerElevM: elev, forecast, ringFor });
  }, [lat, lon, now, tz, elev, forecast, ringFor]);
  const best = useMemo(() => bestUpcoming(days, now), [days, now]);
  const bestDay = best ? days.find(d => d.sunrise === best || d.sunset === best) : undefined;

  const groups = useMemo(() => {
    const order: { tier: AccuracyTier; label: string }[] = [
      { tier: 'high', label: L3(language, '3일 안', 'Next 3 days', '3日以内') },
      { tier: 'medium', label: L3(language, '7일 안', 'Within 7 days', '7日以内') },
      { tier: 'low', label: L3(language, '16일 안 · 참고', 'Within 16 days · rough', '16日以内・参考') },
    ];
    return order
      .map(g => ({ ...g, rows: days.filter(d => rowTier(d) === g.tier) }))
      .filter(g => g.rows.length > 0);
  }, [days, language]);

  const sideWord = (e: ForecastEvent) => (e.side === 'sunrise'
    ? L3(language, '일출', 'Sunrise', '日の出')
    : L3(language, '일몰', 'Sunset', '日の入り'));

  const open = (e: ForecastEvent) => {
    setCurrentTime(e.peakAt ?? e.at);
    onOpenSky();
  };

  const toggleGoodOnly = () => {
    const next = !goodOnly;
    setNotifPref('goodOnly', next);
    // 켜면 노을 · 일출 예보도 켭니다 — 거를 알림이 있어야 합니다.
    if (next) { setNotifPref('sunsetForecast', true); setNotifPref('sunriseForecast', true); }
  };

  // 컴포넌트가 아니라 함수로 그립니다 — 렌더 안에서 컴포넌트를 만들면 그릴 때마다 칸이 새로 붙습니다.
  const renderHalf = (e: ForecastEvent | null, date: string, key: string) => {
    if (!e) {
      return (
        <View key={key} style={styles.half}>
          <Text style={styles.noEvent}>{L3(language, '출몰 없음', 'None', 'なし')}</Text>
        </View>
      );
    }
    const q = e.quality;
    const tone = q ? verdictColor(q, dataColor, color) : color.textMute;
    const n = q ? verdictLevel(q) : 0;
    const word = q ? verdictWord(q, language) : L3(language, '예보 없음', 'No forecast', '予報なし');
    const score = q && showsScore(e.tier) && e.score != null ? String(Math.round(e.score)) : '';
    const time = localHHMM(e.peakAt ?? e.at, tz);
    return (
      <PressScale
        key={key}
        style={styles.half}
        onPress={() => open(e)}
        accessibilityRole="button"
        accessibilityLabel={`${date} ${sideWord(e)} ${word}${score ? ` ${score}` : ''}, ${time} — ${L3(language, '01 하늘에서 보기', 'open in 01 Sky', '01 空で見る')}`}
      >
        <View style={styles.halfTop}>
          <Text style={[styles.word, { color: tone }]} numberOfLines={1}>{word}</Text>
          {!!score && <Text style={styles.score}>{score}</Text>}
        </View>
        <View style={styles.halfBottom}>
          <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {VERDICT_ORDER.map((_, i) => <MeterCell key={i} on={i < n} tier={e.tier} tone={tone} off={color.border} w={cellW} />)}
          </View>
          <Text style={styles.time}>{time}</Text>
        </View>
      </PressScale>
    );
  };

  const todayNoon = days[0]?.noonMs;
  const subOf = (noonMs: number) => {
    if (todayNoon == null) return '';
    const i = Math.round((noonMs - todayNoon) / 86_400_000);
    return i === 0 ? L3(language, '오늘', 'Today', '今日') : i === 1 ? L3(language, '내일', 'Tomorrow', '明日') : '';
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">{L3(language, '다가오는 노을', 'Upcoming glow', 'これからの夕焼け')}</Text>
          <Text style={styles.sub}>
            {[place, L3(language, '16일 · 일출과 일몰', '16 days · sunrise and sunset', '16日・日の出と日の入り')].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {best && best.quality && (
          <PressScale
            style={styles.best}
            onPress={() => open(best)}
            accessibilityRole="button"
            accessibilityLabel={`${L3(language, '가장 좋은 때', 'Best upcoming', '一番良い時')}: ${dayLabel(bestDay?.noonMs ?? best.at.getTime(), tz, language)} ${sideWord(best)} ${verdictWord(best.quality, language)}`}
          >
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text style={styles.microLabel}>{L3(language, '가장 좋은 때', 'Best upcoming', '一番良い時')}</Text>
              <Text style={styles.bestText} numberOfLines={1}>
                {`${dayLabel(bestDay?.noonMs ?? best.at.getTime(), tz, language)} ${sideWord(best)} · `}
                <Text style={{ color: verdictColor(best.quality, dataColor, color) }}>{verdictWord(best.quality, language)}</Text>
                {showsScore(best.tier) && best.score != null ? <Text style={styles.bestScore}>{` ${Math.round(best.score)}`}</Text> : null}
              </Text>
            </View>
            <Text style={styles.time}>{localHHMM(best.peakAt ?? best.at, tz)}</Text>
          </PressScale>
        )}

        {load.kind === 'loading' && !forecast && (
          <View style={styles.status}>
            <ActivityIndicator size="small" color={color.textDim} />
            <Text style={styles.statusText}>{L3(language, '16일 예보를 받는 중', 'Fetching the 16-day forecast', '16日予報を取得中')}</Text>
          </View>
        )}
        {load.kind === 'error' && (
          <View style={styles.status}>
            <Text style={[styles.statusText, { flex: 1 }]}>
              {load.rateLimited
                ? L3(language, '요청이 많아 지금은 받지 못했습니다. 잠시 뒤에 다시 받아 주세요.', 'Too many requests right now. Try again in a moment.', 'リクエストが多く取得できませんでした。少し後でもう一度。')
                : L3(language, '16일 예보를 받지 못했습니다.', "Couldn't fetch the 16-day forecast.", '16日予報を取得できませんでした。')}
            </Text>
            <PressScale style={styles.retry} onPress={() => get(true)} accessibilityRole="button" accessibilityLabel={L3(language, '다시 받기', 'Retry', '再取得')}>
              <RotateCw size={14} color={color.text} />
              <Text style={styles.retryText}>{L3(language, '다시 받기', 'Retry', '再取得')}</Text>
            </PressScale>
          </View>
        )}

        <View style={styles.colHead}>
          <Text style={[styles.microLabel, styles.dateCol, narrow && styles.dateColNarrow]}>{L3(language, '날짜', 'Date', '日付')}</Text>
          <View style={styles.colHalf}>
            <Sunrise size={12} color={color.sun} />
            <Text style={styles.microLabel}>{L3(language, '일출', 'Sunrise', '日の出')}</Text>
          </View>
          <View style={styles.colHalf}>
            <Sunset size={12} color={color.glow} />
            <Text style={styles.microLabel}>{L3(language, '일몰', 'Sunset', '日の入り')}</Text>
          </View>
        </View>

        {groups.map(g => (
          <View key={g.tier}>
            <Text style={[styles.microLabel, styles.groupLabel]}>{g.label}</Text>
            {g.rows.map(d => {
              const date = dayLabel(d.noonMs, tz, language);
              const sub = subOf(d.noonMs);
              return (
                <View key={d.noonMs} style={styles.row}>
                  <View style={[styles.dateCol, narrow && styles.dateColNarrow]}>
                    <Text style={styles.date}>{date}</Text>
                    {!!sub && <Text style={styles.microLabel}>{sub}</Text>}
                  </View>
                  {renderHalf(d.sunrise, date, 'rise')}
                  {renderHalf(d.sunset, date, 'set')}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.dock}>
        {goodOnly ? (
          <PressScale style={styles.secondary} onPress={toggleGoodOnly} accessibilityRole="switch" accessibilityState={{ checked: true }}
            accessibilityLabel={L3(language, '좋음 이상만 알림 — 켜짐. 누르면 끕니다', 'Good-or-better alerts — on. Tap to turn off', '「良い」以上だけ通知 — オン。押すとオフ')}>
            <BellOff size={16} color={color.text} />
            <Text style={styles.secondaryText}>{L3(language, '좋음 이상만 알림 중 · 끄기', 'Alerting good days only · Turn off', '「良い」以上だけ通知中・オフにする')}</Text>
          </PressScale>
        ) : (
          <PrimaryButton
            label={L3(language, '좋음 이상 알림 켜기', 'Alert me on good days', '「良い」以上で通知')}
            icon={<Bell size={16} color={color.onAccent} />}
            onPress={toggleGoodOnly}
          />
        )}
        <Text style={styles.dockNote}>
          {L3(language, '일몰 2시간 전 · 일출 전날 밤 10시, 좋음 이상으로 판정된 날만 알립니다.',
            '2 h before sunset · 10 pm before sunrise, only when rated Good or better.',
            '日没2時間前・日の出前夜22時、「良い」以上の日だけ通知します。')}
        </Text>
      </View>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.md },
  head: { gap: space.xxs },
  title: { ...type.title, color: color.text },
  sub: { ...type.body, color: color.textDim },
  microLabel: { ...type.micro, color: color.textDim },
  best: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill,
  },
  bestText: { ...type.bodyStrong, color: color.text },
  bestScore: { ...type.label, color: color.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH },
  statusText: { ...type.body, color: color.textDim },
  retry: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, height: TOUCH, paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill,
  },
  retryText: { ...type.bodyStrong, color: color.text },
  colHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 24,
    borderBottomWidth: 1, borderBottomColor: color.borderStrong,
  },
  colHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dateCol: { width: 76, justifyContent: 'center' },
  dateColNarrow: { width: 64 },
  groupLabel: { paddingTop: space.sm, paddingBottom: space.xs },
  row: { flexDirection: 'row', gap: space.sm, minHeight: 52, borderBottomWidth: 1, borderBottomColor: color.border },
  date: { ...type.label, color: color.text },
  half: { flex: 1, minWidth: 0, minHeight: 52, justifyContent: 'center', gap: space.xs },
  halfTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  halfBottom: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  word: { ...type.bodyStrong, flexShrink: 1 },
  score: { ...type.label, color: color.text },
  meter: { flexDirection: 'row', gap: 2 },
  time: { ...type.label, color: color.textDim, flexShrink: 0 },
  noEvent: { ...type.body, color: color.textMute },
  dock: {
    paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm,
    backgroundColor: color.panel, borderTopWidth: 1, borderTopColor: color.border,
  },
  secondary: {
    height: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill,
  },
  secondaryText: { ...type.bodyStrong, color: color.text },
  dockNote: { ...type.body, color: color.textDim, textAlign: 'center' },
}));
