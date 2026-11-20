/**
 * ForecastSection.tsx — 학습 페이지의 **앞으로 16일** 구역(옛 02 예보 화면을 옮겼습니다. docs/SANDBOX_MODE_PLAN.md 13.2).
 *
 * 날마다 일출 · 일몰 판정 표입니다. 판정 · 점수 · 시각은 01 하늘 요약 줄과 같은 식에서 나옵니다(`sunForecast.eventVerdict`).
 * 확실도는 색이 아니라 **무늬**입니다(개정 A3): 3일 안은 꽉 찬 칸 + 점수, 7일 안은 빗금, 16일 안은 점선(참고).
 * 앞날일수록 점수를 숨기는 것은 숫자가 실제보다 정확해 보이지 않게 하려는 것입니다.
 *
 * 달라진 것(옛 02 예보 화면과):
 *  - **3일 안만 먼저** 보이고 7일 안과 16일 안은 "7일 안과 16일 안 보기" 로 접어 둡니다(`learnSections.splitForecastGroups`).
 *  - 칸을 누르면 01 하늘을 여는 대신 **그 칸이 고른 날**이 되어 아래 오늘 · 근거 · 과정이 그 날로 바뀝니다.
 *    01 하늘에서 그 시각을 보는 길은 오늘 구역의 "하늘에서 보기" 입니다.
 *  - "좋음 이상 알림 켜기"는 화면 아래 고정 줄이 아니라 이 구역 끝에 있습니다.
 */
import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, useWindowDimensions } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { Bell, BellOff, RotateCw, Sunrise, Sunset } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3, type Language } from '../../utils/i18n';
import { radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';
import { PressScale, PrimaryButton } from '../ui';
import { VERDICT_ORDER, verdictColor, verdictLevel, verdictWord, localHHMM } from '../SunsetSimulation/PredictionCard';
import type { ForecastDay, ForecastEvent, EventSide } from '../../utils/sunForecast';
import type { ForecastLoadState } from '../../hooks/useForecastDays';
import type { AccuracyTier } from '../../utils/timeBar';
import { sameNoon, splitForecastGroups, type LearnPick } from '../../utils/learnSections';
import { Fold } from './Collapsible';

interface Props {
  days: ForecastDay[];
  load: ForecastLoadState;
  /** 16일 예보 자료를 받아 두었는가(받는 중 문구를 보일지 정함) */
  hasForecast: boolean;
  onRetry: () => void;
  pick: LearnPick | null;
  onPick: (p: LearnPick) => void;
  tz: number;
  language: Language;
}

const WEEKDAYS: Record<'ko' | 'en' | 'ja', string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
};

/** 관측지 현지 날짜 "10/27 (화)" */
export const dayLabel = (noonMs: number, tz: number, language: Language) => {
  const l = new Date(noonMs + tz * 3_600_000);
  const wd = WEEKDAYS[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'][l.getUTCDay()];
  return `${l.getUTCMonth() + 1}/${l.getUTCDate()} (${wd})`;
};

/** 줄의 무리 — 그날 일몰(없으면 일출)의 등급. 지난 것은 3일 안에 넣습니다. */
const rowTier = (d: ForecastDay): AccuracyTier => {
  const t = (d.sunset ?? d.sunrise)?.tier ?? 'none';
  return t === 'past' ? 'high' : t;
};
export const showsScore = (tier: AccuracyTier) => tier === 'high' || tier === 'past';

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

export const ForecastSection: React.FC<Props> = ({ days, load, hasForecast, onRetry, pick, onPick, tz, language }) => {
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles();
  const goodOnly = useCelestialStore(s => !!s.notifPrefs?.goodOnly);
  const setNotifPref = useCelestialStore(s => s.setNotifPref);
  // 320 폭에서는 칸 · 날짜 칸을 줄여 시각이 칸 위로 겹치지 않게 합니다(반쪽 폭 약 100).
  const narrow = useWindowDimensions().width < 360;
  const cellW = narrow ? 10 : 14;

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
  const { shown, folded } = useMemo(() => splitForecastGroups(groups), [groups]);

  const sideWord = (e: ForecastEvent) => (e.side === 'sunrise'
    ? L3(language, '일출', 'Sunrise', '日の出')
    : L3(language, '일몰', 'Sunset', '日の入り'));

  const toggleGoodOnly = () => {
    const next = !goodOnly;
    setNotifPref('goodOnly', next);
    // 켜면 노을 · 일출 예보도 켭니다 — 거를 알림이 있어야 합니다.
    if (next) { setNotifPref('sunsetForecast', true); setNotifPref('sunriseForecast', true); }
  };

  const isPicked = (d: ForecastDay, side: EventSide) => !!pick && pick.side === side && sameNoon(d.noonMs, pick.noonMs);

  // 컴포넌트가 아니라 함수로 그립니다 — 렌더 안에서 컴포넌트를 만들면 그릴 때마다 칸이 새로 붙습니다.
  const renderHalf = (d: ForecastDay, e: ForecastEvent | null, date: string, key: string) => {
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
    const picked = isPicked(d, e.side);
    return (
      <PressScale
        key={key}
        style={[styles.half, picked && styles.halfPicked]}
        onPress={() => onPick({ noonMs: d.noonMs, side: e.side })}
        accessibilityRole="button"
        accessibilityState={{ selected: picked }}
        accessibilityLabel={`${date} ${sideWord(e)} ${word}${score ? ` ${score}` : ''}, ${time} — ${L3(language, '아래 근거와 과정을 이 날로 바꾸기', 'Show the data and steps below for this day', '下の根拠と過程をこの日にする')}`}
      >
        <View style={styles.halfTop}>
          <Text style={[styles.word, { color: tone }]} numberOfLines={1}>{word}</Text>
          {!!score && <Text style={styles.score}>{score}</Text>}
        </View>
        <View style={styles.halfBottom}>
          <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {VERDICT_ORDER.map((_, i) => <MeterCell key={i} on={i < n} tier={e.tier} tone={tone} off={color.border} w={cellW} />)}
          </View>
          <Text style={styles.time}>{picked ? `${time} · ${L3(language, '보는 중', 'viewing', '表示中')}` : time}</Text>
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

  const renderGroup = (g: { tier: AccuracyTier; label: string; rows: ForecastDay[] }) => (
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
            {renderHalf(d, d.sunrise, date, 'rise')}
            {renderHalf(d, d.sunset, date, 'set')}
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{L3(language, '앞으로 16일', 'Next 16 days', 'これから16日')}</Text>
        <Text style={styles.sub}>{L3(language, '일출과 일몰', 'Sunrise and sunset', '日の出と日の入り')}</Text>
      </View>
      <Text style={styles.sub}>
        {L3(language, '칸을 누르면 아래 근거와 과정이 그 날로 바뀌어요. 칸의 무늬가 성길수록 덜 확실해요.',
          'Tap a cell to show the data and steps below for that day. The sparser the pattern, the less certain.',
          'マスを押すと、下の根拠と過程がその日に変わります。模様が粗いほど確実さは低めです。')}
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
              ? L3(language, '요청이 많아 지금은 받지 못했습니다. 잠시 뒤에 다시 받아 주세요.', 'Too many requests right now. Try again in a moment.', 'リクエストが多く取得できませんでした。少し後でもう一度。')
              : L3(language, '16일 예보를 받지 못했습니다.', "Couldn't fetch the 16-day forecast.", '16日予報を取得できませんでした。')}
          </Text>
          <PressScale style={styles.retry} onPress={onRetry} accessibilityRole="button" accessibilityLabel={L3(language, '다시 받기', 'Retry', '再取得')}>
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

      {shown.map(renderGroup)}
      {folded.length > 0 && (
        <Fold label={L3(language, '7일 안과 16일 안 보기', 'Show 7-day and 16-day', '7日以内と16日以内を見る')} closeLabel={L3(language, '접기', 'Collapse', '閉じる')}>
          {folded.map(renderGroup)}
        </Fold>
      )}

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
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  title: { ...type.title, color: color.text },
  sub: { ...type.body, color: color.textDim },
  microLabel: { ...type.micro, color: color.textDim },
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
  halfPicked: { borderRadius: radius.sm, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft, paddingHorizontal: space.xs },
  halfTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  halfBottom: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  word: { ...type.bodyStrong, flexShrink: 1 },
  score: { ...type.label, color: color.text },
  meter: { flexDirection: 'row', gap: 2 },
  time: { ...type.label, color: color.textDim, flexShrink: 1 },
  noEvent: { ...type.body, color: color.textMute },
  secondary: {
    height: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill,
  },
  secondaryText: { ...type.bodyStrong, color: color.text },
  dockNote: { ...type.body, color: color.textDim, textAlign: 'center' },
}));
