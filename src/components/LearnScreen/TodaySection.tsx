/**
 * TodaySection.tsx — 데이터 페이지 최상단의 **선택 시각 종합 해설(기상·대기·천체)** 및
 * **이후 발생할 기상·천체 이벤트 타임라인** 구역.
 *
 * 1. 가장 먼저 **현재 선택된 시각(`selectedTime`)의 날씨·대기 해설**과 **실시간 천체·관측 상태(태양·박명·노을, 달, 별·은하수 한계등급, 행성)**를 풀어 설명합니다.
 * 2. 이어서 **그 시각 직후부터 시간순으로 발생할 기상 변화 및 천체 이벤트**를 예보와 결합해 해설합니다.
 * 3. 각 이벤트 카드에서 "이 시각 하늘 보기"를 누르면 01 하늘을 해당 시각으로 열고, "계산 과정"을 누르면 아래 결과가 나온 과정(`WhySection`)의 해당 주제를 펼칩니다.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronRight, Cloud, Compass, Eye, Moon, Sparkles, Sun, Wind } from 'lucide-react-native';
import { L3, type Language } from '../../utils/i18n';
import { radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import { VERDICT_ORDER, verdictColor, verdictLevel, verdictWord, localHHMM } from '../SunsetSimulation/PredictionCard';
import { ScoreGraph } from '../SkyScreen/ScoreGraph';
import type { EventSide, ForecastEvent } from '../../utils/sunForecast';
import type { SkyEventItem } from '../../utils/skyEvents';
import type { ScorePoint, ScoreWindow } from '../../utils/scoreSeries';
import type { LearnTopic } from '../../utils/learnSections';
import type { TimeBriefing, UpcomingCategory, UpcomingTimelineEvent } from '../../utils/timeBriefing';
import { Fold } from './Collapsible';

interface Props {
  language: Language;
  /** 관측지 UTC 오프셋(시간) */
  tz: number;
  /** 고른 날이 오늘인가 */
  isToday: boolean;
  /** "11/19 (목)" */
  dateLabel: string;
  /** 현재 해설 기준 시각 문자열 ("23:28") */
  timeLabel: string;
  /** 16일 표에서 다른 칸을 골라 01 하늘의 선택 시각과 달라졌는지 여부 */
  isCustomPickedTime?: boolean;
  /** 01 하늘의 원래 선택 시각 문자열 ("11/19 (목) 23:28") */
  skyTimeLabel?: string;
  /** 01 하늘의 현재 선택 시각으로 되돌리기 */
  onResetToSkyTime?: () => void;
  side: EventSide;
  /** 고른 날의 대표 일출·일몰 사건 (노을 점수 그래프 및 보조 참조용) */
  event: ForecastEvent | null;
  direction: string | null;
  items: SkyEventItem[];
  /** 시간대별 노을 점수 그래프 */
  graph: { win: ScoreWindow; points: ScorePoint[] } | null;
  /** 현재 선택 시각의 기상·천체 종합 브리핑 */
  briefing: TimeBriefing | null;
  /** 선택 시각 이후 발생할 기상·천체 이벤트 타임라인 */
  upcomingEvents: UpcomingTimelineEvent[];
  /** 01 하늘을 그 시각으로 엽니다 */
  onOpenSky: (ms?: number) => void;
  onOpenTopic: (t: LearnTopic) => void;
}

export const TodaySection: React.FC<Props> = ({
  language,
  tz,
  dateLabel,
  timeLabel,
  isCustomPickedTime = false,
  skyTimeLabel,
  onResetToSkyTime,
  event,
  graph,
  briefing,
  upcomingEvents,
  onOpenSky,
  onOpenTopic,
}) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();
  const [graphOpen, setGraphOpen] = useState(false);

  const categoryColor = (cat: UpcomingCategory): string => {
    switch (cat) {
      case 'weather': return color.accent;
      case 'sun': return dataColor.good;
      case 'twilight': return '#7E9CFF';
      case 'moon': return '#E5C07B';
      case 'star': return '#B392F0';
      case 'planet': return '#56D4DD';
      case 'eclipse': return '#F97583';
      default: return color.textDim;
    }
  };

  const shownUpcoming = upcomingEvents.slice(0, 5);
  const foldedUpcoming = upcomingEvents.slice(5);

  const glow = briefing?.glowVerdict ?? null;
  const glowTone = glow?.quality ? verdictColor(glow.quality, dataColor, color) : color.textMute;
  const glowLevel = glow?.quality ? verdictLevel(glow.quality) : 0;
  const glowWord = glow?.quality ? verdictWord(glow.quality, language) : null;

  const renderUpcomingCard = (ev: UpcomingTimelineEvent) => {
    const catTone = categoryColor(ev.category);
    const evTimeStr = localHHMM(new Date(ev.timeMs), tz);
    const qTone = ev.quality ? verdictColor(ev.quality, dataColor, color) : null;
    const qWord = ev.quality ? verdictWord(ev.quality, language) : null;

    return (
      <View key={ev.id} style={styles.timelineCard}>
        <View style={styles.timelineTopRow}>
          <View style={styles.timelineTimeWrap}>
            <Text style={styles.timelineTime}>{evTimeStr}</Text>
            <View style={styles.relativePill}>
              <Text style={styles.relativePillText}>{ev.relativeLabel}</Text>
            </View>
          </View>
          <View style={[styles.catBadge, { borderColor: catTone }]}>
            <Text style={[styles.catBadgeText, { color: catTone }]}>{ev.categoryLabel}</Text>
          </View>
        </View>

        <View style={styles.timelineTitleRow}>
          <Text style={styles.timelineTitle}>{ev.title}</Text>
          {qWord && qTone ? (
            <Text style={[styles.timelineVerdict, { color: qTone }]}>
              {`${qWord}${ev.score != null ? ` ${ev.score}` : ''}`}
            </Text>
          ) : (
            !!ev.badge && <Text style={styles.timelineBadgeText}>{ev.badge}</Text>
          )}
        </View>

        <Text style={styles.timelineDesc}>{ev.description}</Text>

        <View style={styles.timelineActions}>
          <PressScale
            style={styles.timelineActionBtn}
            onPress={() => onOpenSky(ev.timeMs)}
            accessibilityRole="button"
            accessibilityLabel={`${evTimeStr} ${ev.title} — ${L3(language, '이 시각 하늘 보기', 'View sky at this time', 'この時刻の空を見る')}`}
          >
            <Compass size={13} color={color.accent} />
            <Text style={[styles.timelineActionText, { color: color.accent }]}>
              {L3(language, '이 시각 하늘 보기', 'View in Sky', 'この時刻の空を見る')}
            </Text>
          </PressScale>

          <PressScale
            style={styles.timelineActionBtn}
            onPress={() => onOpenTopic(ev.topic)}
            accessibilityRole="button"
            accessibilityLabel={`${ev.title} — ${L3(language, '계산 과정 보기', 'See calculation steps', '計算過程を見る')}`}
          >
            <Text style={styles.timelineSecondaryActionText}>
              {L3(language, '계산 과정', 'How it works', '計算過程')}
            </Text>
            <ChevronRight size={13} color={color.textDim} />
          </PressScale>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      {/* ── 헤더: 선택된 시각 & 상태 배지 ── */}
      <View style={styles.headerBlock}>
        <View style={styles.headTop}>
          <Text style={styles.title} accessibilityRole="header">
            {L3(language, '선택 시각 기상 · 천체 해설', 'Selected Time Weather & Sky Briefing', '選択時刻の気象・天体解説')}
          </Text>
          {briefing && (
            <View style={styles.phasePill}>
              <Text style={styles.phasePillText}>{briefing.phaseBadge}</Text>
            </View>
          )}
        </View>
        <Text style={styles.timeSub}>
          {`${dateLabel} ${timeLabel} ${L3(language, '기준', 'snapshot', '時点')}`}
        </Text>

        {isCustomPickedTime && onResetToSkyTime && (
          <PressScale
            style={styles.resetSkyTimeBtn}
            onPress={onResetToSkyTime}
            accessibilityRole="button"
            accessibilityLabel={L3(language, '하늘 화면의 현재 선택 시각으로 되돌리기', 'Return to selected time in Sky screen', '空画面の選択時刻に戻す')}
          >
            <Text style={styles.resetSkyTimeText}>
              {L3(
                language,
                `하늘 화면 선택 시각(${skyTimeLabel ?? ''}) 해설로 돌아가기`,
                `Return to Sky screen time (${skyTimeLabel ?? ''})`,
                `空画面の選択時刻(${skyTimeLabel ?? ''})に戻る`
              )}
            </Text>
          </PressScale>
        )}
      </View>

      {briefing ? (
        <>
          {/* ── 1. 현재 선택 시각의 기상 · 대기 해설 카드 ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Cloud size={16} color={color.accent} />
              <Text style={styles.cardSectionTitle}>
                {L3(language, '지금 기상 · 대기 해설', 'Weather & Atmosphere Now', '現在の気象・大気解説')}
              </Text>
            </View>

            <Text style={styles.headline}>{briefing.weatherSummaryTitle}</Text>
            <Text style={styles.narrativeText}>{briefing.weatherNarrative}</Text>

            {briefing.weatherMetrics.length > 0 && (
              <View style={styles.metricGrid}>
                {briefing.weatherMetrics.map(m => (
                  <View key={m.id} style={styles.metricCell}>
                    <Text style={styles.metricLabel} numberOfLines={1}>{m.label}</Text>
                    <Text style={styles.metricValue} numberOfLines={1}>{m.value}</Text>
                    {!!m.sub && <Text style={styles.metricSub} numberOfLines={1}>{m.sub}</Text>}
                  </View>
                ))}
              </View>
            )}

            <View style={styles.cardFooterRow}>
              <PressScale
                style={styles.topicLinkBtn}
                onPress={() => onOpenTopic('cloud')}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '구름 모양과 대기 계산 과정 보기', 'See cloud & atmosphere calculation', '雲の形と大気の計算過程を見る')}
              >
                <Wind size={13} color={color.textDim} />
                <Text style={styles.topicLinkText}>
                  {L3(language, '구름 · 대기 분석 과정 보기', 'Cloud & air analysis steps', '雲・大気の分析過程を見る')}
                </Text>
                <ChevronRight size={13} color={color.textDim} />
              </PressScale>
            </View>
          </View>

          {/* ── 2. 현재 선택 시각의 천체 · 빛 · 관측 해설 카드 ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Sparkles size={16} color={color.accent} />
              <Text style={styles.cardSectionTitle}>
                {L3(language, '지금 천체 · 빛 · 관측 해설', 'Celestial & Observation Status', '現在の天体・光・観測解説')}
              </Text>
            </View>

            {/* (A) 태양 · 박명 · 노을 상태 */}
            <View style={styles.celestialBlock}>
              <View style={styles.celestialHeadRow}>
                <Sun size={15} color={dataColor.good} />
                <Text style={styles.celestialBlockTitle}>{briefing.sunTitle}</Text>
              </View>

              {glow && glowWord && (
                <View style={styles.glowBanner}>
                  <View style={styles.scoreRow}>
                    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      {VERDICT_ORDER.map((_, i) => (
                        <View key={i} style={[styles.cell, { backgroundColor: i < glowLevel ? glowTone : color.border }]} />
                      ))}
                    </View>
                    <Text style={[styles.word, { color: glowTone }]}>{glowWord}</Text>
                    {glow.score != null && <Text style={styles.score}>{`${glow.score}${L3(language, '점', ' pts', '点')}`}</Text>}
                    <Text style={styles.glowSideTag}>
                      {glow.side === 'sunrise'
                        ? L3(language, '일출 노을 예측', 'Sunrise glow', '朝焼け予測')
                        : L3(language, '일몰 노을 예측', 'Sunset glow', '夕焼け予測')}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={styles.narrativeText}>{briefing.sunNarrative}</Text>

              {graph && (
                <>
                  <PressScale
                    style={styles.inlineToggle}
                    onPress={() => setGraphOpen(o => !o)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: graphOpen }}
                    accessibilityLabel={L3(language, '시간대별 노을 점수 변화 보기', 'Glow score by time of day', '時間帯別の焼けスコア変化')}
                  >
                    {graphOpen ? <ChevronDown size={14} color={color.accent} /> : <ChevronRight size={14} color={color.accent} />}
                    <Text style={styles.inlineToggleText}>
                      {L3(language, '시간대별 노을 점수 변화 그래프', 'Glow score curve by time', '時間帯別の焼けスコア推移グラフ')}
                    </Text>
                  </PressScale>
                  {graphOpen && (
                    <ScoreGraph
                      points={graph.points}
                      window={graph.win}
                      nowMs={briefing.timeMs}
                      tzHours={tz}
                      language={language}
                      onPickTime={(ms) => onOpenSky(ms)}
                    />
                  )}
                </>
              )}
            </View>

            <View style={styles.divider} />

            {/* (B) 달 위치 · 위상 · 달빛 영향 */}
            <View style={styles.celestialBlock}>
              <View style={styles.celestialHeadRow}>
                <Moon size={15} color="#E5C07B" />
                <Text style={styles.celestialBlockTitle}>{briefing.moonTitle}</Text>
              </View>
              <Text style={styles.narrativeText}>{briefing.moonNarrative}</Text>
            </View>

            <View style={styles.divider} />

            {/* (C) 별 · 은하수 관측 한계등급 */}
            <View style={styles.celestialBlock}>
              <View style={styles.celestialHeadRow}>
                <Eye size={15} color="#B392F0" />
                <Text style={styles.celestialBlockTitle}>{briefing.starTitle}</Text>
              </View>
              <Text style={styles.narrativeText}>{briefing.starNarrative}</Text>
            </View>

            <View style={styles.divider} />

            {/* (D) 지평선 위 행성 */}
            <View style={styles.celestialBlock}>
              <View style={styles.celestialHeadRow}>
                <Compass size={15} color="#56D4DD" />
                <Text style={styles.celestialBlockTitle}>{briefing.planetsTitle}</Text>
              </View>
              <Text style={styles.narrativeText}>{briefing.planetsNarrative}</Text>
            </View>

            <View style={styles.cardActionRow}>
              <PressScale
                style={styles.skyBtn}
                onPress={() => onOpenSky(briefing.timeMs)}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '01 하늘에서 이 시각 보기', 'See this moment in 01 Sky', '01 空でこの時刻を見る')}
              >
                <Text style={styles.skyBtnText}>
                  {L3(language, '하늘 화면에서 이 시각 보기', 'Open this time in 3D Sky', '3D空画面でこの時刻を見る')}
                </Text>
              </PressScale>

              <PressScale
                style={styles.topicLinkBtn}
                onPress={() => onOpenTopic(briefing.phaseKind === 'night' || briefing.phaseKind === 'astronomical' ? 'star' : 'score')}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '천체 및 점수 계산 과정 보기', 'See celestial & score calculation steps', '天体とスコアの計算過程を見る')}
              >
                <Text style={styles.topicLinkText}>
                  {L3(language, '점수 · 한계등급 계산 과정', 'Score & mag steps', 'スコア・等級の計算過程')}
                </Text>
                <ChevronRight size={13} color={color.textDim} />
              </PressScale>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.headline}>
            {event ? L3(language, '이 시각의 데이터를 불러오는 중이에요.', 'Loading data for this time.', 'この時刻のデータを読み込み中です。') : L3(language, '위치를 먼저 선택해 주세요.', 'Pick a location first.', '先に場所を選択してください。')}
          </Text>
        </View>
      )}

      {/* ── 3. 선택 시각 이후 발생할 기상 · 천체 이벤트 타임라인 ── */}
      {upcomingEvents.length > 0 && (
        <View style={styles.timelineSection}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineSectionTitle} accessibilityRole="header">
              {L3(language, '이어서 발생할 기상 · 천체 이벤트', 'Upcoming Weather & Celestial Events', '続いて起こる気象・天体イベント')}
            </Text>
            <Text style={styles.sub}>
              {L3(
                language,
                `${timeLabel} 이후 24시간 동안 일어날 기상 변화와 태양·달·별·행성 일정을 시간순으로 해설합니다.`,
                `Chronological weather shifts and solar, lunar, stellar, and planetary events over the 24 hours after ${timeLabel}.`,
                `${timeLabel}以降24時間の気象変化と太陽・月・星・惑星の予定を時系列で解説します。`
              )}
            </Text>
          </View>

          <View style={styles.timelineList}>
            {shownUpcoming.map(renderUpcomingCard)}
            {foldedUpcoming.length > 0 && (
              <Fold
                label={L3(
                  language,
                  `이후 이벤트 ${foldedUpcoming.length}개 더 보기`,
                  `Show ${foldedUpcoming.length} more upcoming events`,
                  `以降のイベントをあと${foldedUpcoming.length}件見る`
                )}
                closeLabel={L3(language, '접기', 'Collapse', '閉じる')}
              >
                {foldedUpcoming.map(renderUpcomingCard)}
              </Fold>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.md },
  headerBlock: { gap: space.xxs },
  headTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.xs },
  title: { ...type.title, color: color.text },
  timeSub: { ...type.bodyStrong, color: color.accent },
  sub: { ...type.body, color: color.textDim },
  phasePill: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  phasePillText: { ...type.label, color: color.accent },
  resetSkyTimeBtn: {
    marginTop: space.xxs,
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: color.fill,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  resetSkyTimeText: { ...type.label, color: color.accent },
  card: {
    backgroundColor: color.panel,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  cardSectionTitle: { ...type.label, color: color.accent },
  headline: { ...type.bodyStrong, fontSize: 16, color: color.text },
  narrativeText: { ...type.body, color: color.text, lineHeight: 21 },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: space.xxs,
  },
  metricCell: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: color.fill,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    gap: 2,
  },
  metricLabel: { ...type.micro, color: color.textDim },
  metricValue: { ...type.bodyStrong, fontSize: 15, color: color.text },
  metricSub: { ...type.micro, color: color.textDim },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: space.xxs,
  },
  celestialBlock: { gap: space.xs },
  celestialHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  celestialBlockTitle: { ...type.bodyStrong, color: color.text, flex: 1 },
  divider: { height: 1, backgroundColor: color.border, marginVertical: 2 },
  glowBanner: {
    backgroundColor: color.fill,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  meter: { flexDirection: 'row', gap: 3, alignSelf: 'center' },
  cell: { width: 10, height: 15, borderRadius: 2 },
  word: { fontSize: 17, fontWeight: '800' },
  score: { ...type.bodyStrong, fontSize: 16, color: color.text },
  glowSideTag: { ...type.micro, color: color.textDim, marginLeft: 'auto' },
  inlineToggle: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  inlineToggleText: { ...type.label, color: color.accent },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
  skyBtn: {
    minHeight: TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
  },
  skyBtnText: { ...type.bodyStrong, color: color.accent },
  topicLinkBtn: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  topicLinkText: { ...type.label, color: color.textDim },
  timelineSection: { gap: space.sm, marginTop: space.xs },
  timelineHeader: { gap: space.xxs },
  timelineSectionTitle: { ...type.title, color: color.text },
  timelineList: { gap: space.sm },
  timelineCard: {
    backgroundColor: color.panel,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: color.border,
  },
  timelineTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  timelineTimeWrap: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  timelineTime: { ...type.title, fontSize: 17, color: color.text },
  relativePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: color.fill,
  },
  relativePillText: { ...type.micro, color: color.accent },
  catBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  catBadgeText: { ...type.micro, fontWeight: '700' },
  timelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  timelineTitle: { ...type.bodyStrong, fontSize: 15, color: color.text, flex: 1 },
  timelineVerdict: { ...type.bodyStrong, fontSize: 14 },
  timelineBadgeText: { ...type.label, color: color.textDim },
  timelineDesc: { ...type.body, color: color.textDim, lineHeight: 20 },
  timelineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  timelineActionBtn: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  timelineActionText: { ...type.label, fontWeight: '700' },
  timelineSecondaryActionText: { ...type.label, color: color.textDim },
}));
