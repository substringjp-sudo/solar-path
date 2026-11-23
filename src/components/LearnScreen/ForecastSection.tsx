/**
 * ForecastSection.tsx — 데이터 페이지 **③ 앞으로 16일** 7열 달력 구역.
 *
 * - 7열(월~일) 달력 각 칸에 **일출 · 일몰 점수 둘 다**와 밤 **별 점수**를 함께 보입니다.
 * - 멀수록 신뢰도가 낮아지는 경향을 투명도 + 아래 신뢰도 막대로 나타냅니다.
 * - 칸을 누르면 상세 카드가 열리고 페이지 전체(지금 · 원리 · 근거)가 그 날로 전환됩니다.
 */
import React, { useMemo } from 'react';
import { ActivityIndicator, Switch, Text, View } from 'react-native';
import { RotateCw, Sunrise, Sunset } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3, type Language } from '../../utils/i18n';
import { mono, radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useDataColors, useThemeColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import { localHHMM, verdictColor, verdictWord } from '../SunsetSimulation/PredictionCard';
import type { ForecastDay } from '../../utils/sunForecast';
import type { CloudPathData } from '../../utils/weather';
import type { ForecastLoadState } from '../../hooks/useForecastDays';
import type { AccuracyTier } from '../../utils/timeBar';
import { sameNoon, type LearnPick } from '../../utils/learnSections';
import { buildCalendarDays, type CalendarDayCell } from '../../utils/learnNoteData';
import { Fold } from './Collapsible';

interface Props {
  days: ForecastDay[];
  load: ForecastLoadState;
  hasForecast: boolean;
  onRetry: () => void;
  pick: LearnPick | null;
  onPick: (p: LearnPick) => void;
  tz: number;
  language: Language;
  forecast?: CloudPathData[] | null;
  ringFor?: (d: Date) => CloudPathData[] | null;
  lat?: number;
  lon?: number;
  elevM?: number;
  lightPollutionMag?: number | null;
  onOpenSky?: (ms: number) => void;
}

const WEEKDAYS_FULL: Record<'ko' | 'en' | 'ja', string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
};

const DOW_HEADERS: Record<'ko' | 'en' | 'ja', string[]> = {
  ko: ['월', '화', '수', '목', '금', '토', '일'],
  en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  ja: ['月', '火', '水', '木', '金', '土', '日'],
};

/** 관측지 현지 날짜 "10/27 (화)" */
export const dayLabel = (noonMs: number, tz: number, language: Language) => {
  const l = new Date(noonMs + tz * 3_600_000);
  const wd = WEEKDAYS_FULL[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'][l.getUTCDay()];
  return `${l.getUTCMonth() + 1}/${l.getUTCDate()} (${wd})`;
};

export const showsScore = (tier: AccuracyTier) => tier === 'high' || tier === 'past';

export const ForecastSection: React.FC<Props> = ({
  days,
  load,
  hasForecast,
  onRetry,
  pick,
  onPick,
  tz,
  language,
  forecast = null,
  ringFor = () => null,
  lat,
  lon,
  elevM = 0,
  lightPollutionMag = null,
  onOpenSky,
}) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();
  const goodOnly = useCelestialStore(s => !!s.notifPrefs?.goodOnly);
  const setNotifPref = useCelestialStore(s => s.setNotifPref);

  const cal = useMemo(() => {
    if (lat == null || lon == null || days.length === 0) {
      return { cells: [] as CalendarDayCell[], leadingBlanks: 0, topDates: [] as CalendarDayCell[] };
    }
    return buildCalendarDays({
      days,
      forecast,
      ringFor,
      lat,
      lon,
      elevM,
      tzHours: tz,
      lightPollutionMag,
      language,
    });
  }, [days, forecast, ringFor, lat, lon, elevM, tz, lightPollutionMag, language]);

  const toggleGoodOnly = () => {
    const next = !goodOnly;
    setNotifPref('goodOnly', next);
    if (next) {
      setNotifPref('sunsetForecast', true);
      setNotifPref('sunriseForecast', true);
    }
  };

  const selectedCell = useMemo(
    () => (pick ? cal.cells.find(c => sameNoon(c.noonMs, pick.noonMs)) ?? null : null),
    [cal.cells, pick],
  );

  // 7열 달력 행으로 분할
  const calendarRows = useMemo(() => {
    const slots: Array<CalendarDayCell | null> = [
      ...Array.from({ length: cal.leadingBlanks }, () => null),
      ...cal.cells,
    ];
    while (slots.length % 7 !== 0) slots.push(null);
    const rows: Array<Array<CalendarDayCell | null>> = [];
    for (let i = 0; i < slots.length; i += 7) rows.push(slots.slice(i, i + 7));
    return rows;
  }, [cal.cells, cal.leadingBlanks]);

  const dowHeaders = DOW_HEADERS[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'];
  const topHeadline =
    cal.topDates.length > 0
      ? L3(
          language,
          `좋은 날 ${cal.topDates.map(d => `${d.label}(${d.dowLabel})`).join(' · ')}`,
          `Best days ${cal.topDates.map(d => `${d.label} (${d.dowLabel})`).join(' · ')}`,
          `おすすめの日は ${cal.topDates.map(d => `${d.label}(${d.dowLabel})`).join(' · ')}`,
        )
      : L3(language, '앞으로 16일 일출 · 일몰 · 별 흐름', '16-day sunrise, sunset & star outlook', 'これから16日の日の出・日の入り・星');

  const reliabilityText = (tier: CalendarDayCell['tier']) =>
    tier === 'high'
      ? L3(language, '예보 신뢰 높음', 'High forecast confidence', '予報信頼度 高')
      : tier === 'medium'
        ? L3(language, '예보 신뢰 보통', 'Moderate confidence', '予報信頼度 中')
        : L3(language, '경향만 참고', 'Rough trend only', '傾向のみ参考');

  const riseShort = L3(language, '출', 'R', '出');
  const setShort = L3(language, '몰', 'S', '入');

  return (
    <View style={styles.wrap}>
      <Text style={styles.headline}>{topHeadline}</Text>
      <Text style={styles.lead}>
        {L3(
          language,
          '칸 안의 일출·일몰 숫자는 노을 점수, 점은 밤 별 점수. 칸을 탭하면 페이지 전체가 그 날짜로 바뀝니다.',
          'Each cell shows sunrise & sunset glow scores plus night star score. Tap any day to inspect it.',
          '各マスの数値は日の出・日の入りの夕焼けスコア、丸は星スコア。タップするとページ全体がその日に切り替わります。',
        )}
      </Text>

      {load.kind === 'loading' && !hasForecast && (
        <View style={styles.status}>
          <ActivityIndicator size="small" color={color.textDim} />
          <Text style={styles.statusText}>{L3(language, '16일 예보를 받는 중', 'Fetching the 16-day forecast', '16日予報を取得中')}</Text>
        </View>
      )}
      {load.kind === 'error' && (
        <View style={styles.status}>
          <Text style={[styles.statusText, { flex: 1 }]}>
            {load.rateLimited
              ? L3(language, '요청이 많아 지금은 받지 못했습니다.', 'Rate limited right now.', 'リクエストが多く取得できませんでした。')
              : L3(language, '16일 예보를 받지 못했습니다.', "Couldn't fetch the 16-day forecast.", '16日予報を取得できませんでした。')}
          </Text>
          <PressScale style={styles.retry} onPress={onRetry} accessibilityRole="button">
            <RotateCw size={14} color={color.text} />
            <Text style={styles.retryText}>{L3(language, '다시 받기', 'Retry', '再取得')}</Text>
          </PressScale>
        </View>
      )}

      {/* 7열 달력 그리드 */}
      {calendarRows.length > 0 && (
        <View style={styles.calGrid}>
          <View style={styles.calRow}>
            {dowHeaders.map((h, i) => (
              <Text key={i} style={styles.dowCell}>{h}</Text>
            ))}
          </View>

          {calendarRows.map((row, ri) => (
            <View key={`wk-${ri}`} style={styles.calRow}>
              {row.map((cell, ci) => {
                if (!cell) return <View key={`empty-${ri}-${ci}`} style={styles.cellEmpty} />;
                const picked = !!pick && sameNoon(cell.noonMs, pick.noonMs);
                const confOp = cell.tier === 'high' ? 1 : cell.tier === 'medium' ? 0.72 : 0.48;
                const rVal = cell.sunrise?.score != null ? Math.round(cell.sunrise.score) : null;
                const sVal = cell.sunset?.score != null ? Math.round(cell.sunset.score) : null;
                const tintOp = cell.maxGlowScore != null ? Math.min(0.28, (cell.maxGlowScore / 100) * 0.24 * confOp + 0.04) : 0.04;

                return (
                  <PressScale
                    key={cell.noonMs}
                    style={[
                      styles.cell,
                      {
                        backgroundColor: `rgba(165, 180, 252, ${tintOp.toFixed(2)})`,
                        borderColor: picked ? color.accent : cell.isTop ? color.moon : cell.isToday ? color.accentLine : color.border,
                        borderWidth: picked || cell.isTop ? 1.8 : 1,
                      },
                    ]}
                    onPress={() => {
                      const defaultSide = (sVal ?? -1) >= (rVal ?? -1) ? 'sunset' : 'sunrise';
                      onPick({ noonMs: cell.noonMs, side: defaultSide });
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: picked }}
                    accessibilityLabel={`${cell.label} ${riseShort} ${rVal ?? '-'} ${setShort} ${sVal ?? '-'}`}
                  >
                    <Text style={[styles.cellDate, cell.isToday && { color: color.accent, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                      {cell.label}
                    </Text>

                    <View style={[styles.dualScoreRow, { opacity: confOp }]}>
                      <Text style={[styles.dualVal, { color: dataColor.sunrise }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {`${riseShort}${rVal ?? '—'}`}
                      </Text>
                      <Text style={[styles.dualVal, { color: dataColor.sunset }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                        {`${setShort}${sVal ?? '—'}`}
                      </Text>
                    </View>

                    <View style={styles.starMiniRow}>
                      <View
                        style={[
                          styles.starDot,
                          {
                            backgroundColor: color.moon,
                            opacity: cell.starScore != null ? 0.3 + (cell.starScore / 100) * 0.7 : 0.2,
                          },
                        ]}
                      />
                      <Text style={styles.starMiniVal} numberOfLines={1}>
                        {cell.starScore != null ? cell.starScore : '—'}
                      </Text>
                    </View>
                  </PressScale>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {/* 선택된 날 상세 카드 (일출 · 일몰 둘 다 표시) */}
      {selectedCell && (
        <View style={[styles.selCard, { borderColor: color.moon }]}>
          <View style={styles.selHead}>
            <Text style={styles.selTitle}>{`${selectedCell.label} (${selectedCell.dowLabel})`}</Text>
            <Text style={styles.selMeta}>{reliabilityText(selectedCell.tier)}</Text>
          </View>

          {([
            { ev: selectedCell.sunrise, side: 'sunrise' as const, label: L3(language, '일출', 'Sunrise', '日の出'), icon: <Sunrise size={13} color={dataColor.sunrise} /> },
            { ev: selectedCell.sunset, side: 'sunset' as const, label: L3(language, '일몰', 'Sunset', '日の入り'), icon: <Sunset size={13} color={dataColor.sunset} /> },
          ]).map(({ ev, side, label, icon }) => {
            const activeSide = pick?.side === side;
            const time = ev ? localHHMM(ev.peakAt ?? ev.at, tz) : '—';
            const word = ev?.quality ? verdictWord(ev.quality, language) : L3(language, '예보 없음', 'No forecast', '予報なし');
            const tone = ev?.quality ? verdictColor(ev.quality, dataColor, color) : color.textMute;
            const score = ev?.score != null ? `${Math.round(ev.score)}` : '—';
            return (
              <View
                key={side}
                style={[styles.selSideRow, activeSide && { borderColor: color.accentLine, backgroundColor: color.accentSoft }]}
              >
                <PressScale
                  style={styles.selSideInfo}
                  onPress={() => onPick({ noonMs: selectedCell.noonMs, side })}
                >
                  {icon}
                  <Text style={styles.selSideLabel}>{label}</Text>
                  <Text style={styles.selSideTime}>{time}</Text>
                  <Text style={[styles.selSideVerdict, { color: tone }]}>{`${word} ${score}`}</Text>
                </PressScale>
                {ev && onOpenSky && (
                  <PressScale
                    style={[styles.go3dBtn, { borderColor: color.moon }]}
                    onPress={() => onOpenSky((ev.peakAt ?? ev.at).getTime())}
                  >
                    <Text style={[styles.go3dText, { color: color.moon }]}>3D ▸</Text>
                  </PressScale>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* 신뢰도 막대 */}
      <View style={styles.confBlock}>
        <View style={styles.confLab}>
          <Text style={styles.confText}>{L3(language, '예보 신뢰도', 'Forecast confidence', '予報信頼度')}</Text>
          <Text style={styles.confText}>{L3(language, '높음(3일) → 낮음(16일)', 'High (3d) → Low (16d)', '高(3日) → 低(16日)')}</Text>
        </View>
        <Svg width="100%" height={8} viewBox="0 0 320 8">
          <Defs>
            <LinearGradient id="confGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={color.moon} stopOpacity={1} />
              <Stop offset="1" stopColor={color.moon} stopOpacity={0.18} />
            </LinearGradient>
          </Defs>
          <Rect width={320} height={8} rx={4} fill="url(#confGrad)" />
        </Svg>
      </View>

      {/* 좋음 이상 알림 스위치 1줄 */}
      <View style={styles.swRow}>
        <Text style={styles.swLabel}>
          {L3(language, '좋음 이상(점수 60↑) 알림', 'Alert on good days (60+)', '「良い」以上(60点↑)で通知')}
        </Text>
        <Switch
          value={goodOnly}
          onValueChange={toggleGoodOnly}
          trackColor={{ false: color.borderStrong, true: color.moon }}
          thumbColor={color.panelRaised}
          accessibilityLabel={L3(language, '좋음 이상 알림', 'Good-or-better alerts', '「良い」以上で通知')}
        />
      </View>

      <Fold
        label={L3(language, '16일 예보 읽는 법', 'How to read the 16-day calendar', '16日カレンダーの見方')}
        closeLabel={L3(language, '접기', 'Collapse', '閉じる')}
      >
        <Text style={styles.foldText}>
          {L3(
            language,
            '3일까지는 층별 구름양이 비교적 정확하고, 7일이 넘어가면 고기압·기압골 통과 전후의 큰 흐름만 참고하는 편이 좋습니다.',
            'Cloud layers stay reliable out to 3 days; beyond day 7, treat scores as broad synoptic trends rather than exact timing.',
            '3日以内は層別雲量の精度が高く、7日以降は高気圧・気圧の谷の大きな流れを見る目安としてご活用ください。',
          )}
        </Text>
      </Fold>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.sm + 2 },
  headline: { fontSize: 17, fontWeight: '700', lineHeight: 24, color: color.text },
  lead: { ...type.body, fontSize: 12.5, color: color.textDim, lineHeight: 18 },

  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH },
  statusText: { ...type.body, color: color.textDim },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  retryText: { ...type.bodyStrong, color: color.text },

  calGrid: { gap: 4 },
  calRow: { flexDirection: 'row', gap: 4 },
  dowCell: { flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '600', color: color.textMute, paddingVertical: 2 },
  cellEmpty: { flex: 1 },
  cell: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 2,
    alignItems: 'center',
    gap: 2,
  },
  cellDate: { fontFamily: mono, fontSize: 10, color: color.textDim },
  dualScoreRow: { alignItems: 'center', gap: 1 },
  dualVal: { fontFamily: mono, fontSize: 10.5, fontWeight: '700', lineHeight: 13 },
  starMiniRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  starDot: { width: 5, height: 5, borderRadius: 2.5 },
  starMiniVal: { fontFamily: mono, fontSize: 9.5, color: color.textDim },

  selCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    backgroundColor: color.fill,
    padding: space.sm + 2,
    gap: 6,
  },
  selHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  selTitle: { ...type.bodyStrong, fontSize: 13, color: color.text },
  selMeta: { fontSize: 11, color: color.textMute },
  selSideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: color.panel,
  },
  selSideInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  selSideLabel: { fontSize: 12, fontWeight: '700', color: color.text },
  selSideTime: { fontFamily: mono, fontSize: 12, color: color.textDim },
  selSideVerdict: { fontSize: 12, fontWeight: '700', marginLeft: 'auto' },
  go3dBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  go3dText: { fontSize: 11, fontWeight: '700' },

  confBlock: { gap: 4, marginTop: 2 },
  confLab: { flexDirection: 'row', justifyContent: 'space-between' },
  confText: { fontSize: 11, color: color.textDim },

  swRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: 2,
  },
  swLabel: { fontSize: 13, color: color.text, fontWeight: '600' },
  foldText: { fontSize: 12.5, color: color.textDim, lineHeight: 18 },
}));
