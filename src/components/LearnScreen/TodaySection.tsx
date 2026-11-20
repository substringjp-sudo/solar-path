/**
 * TodaySection.tsx — 학습 페이지의 **오늘**(고른 날) 구역(docs/SANDBOX_MODE_PLAN.md 13.2, 목업 21).
 *
 * 먼저 보이는 것: 판정 · 점수 · 해 뜨고 지는 시각과 방향 · 한 줄 이유, 그리고 하늘 일정 중 **추천 이벤트**(일몰·일출 판정, 초승달, 은하수, 행성).
 * 접어 둔 것: 시간대별 점수 그래프, 일반 일정(해·달 출몰 시각).
 *
 * 하늘 일정 줄을 누르면 아래 **결과가 나온 과정**의 그 줄에 맞는 주제가 펼쳐집니다(`learnSections.topicForEventId`).
 * "하늘에서 보기" 는 01 하늘을 그 시각으로 엽니다(옛 02 예보에서 칸을 누르면 하던 일).
 *
 * 줄 · 그래프 값은 부모(`LearnScreen`)가 셉니다 — 이 부품은 그리기만 합니다. 이름은 "오늘"이지만 고른 날이 오늘이 아니면 "고른 날" 입니다.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { translateSunsetDesc, L3, type Language } from '../../utils/i18n';
import { radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import { VERDICT_ORDER, verdictColor, verdictLevel, verdictWord, localHHMM } from '../SunsetSimulation/PredictionCard';
import { ScoreGraph } from '../SkyScreen/ScoreGraph';
import type { EventSide, ForecastEvent } from '../../utils/sunForecast';
import type { SkyEventItem } from '../../utils/skyEvents';
import type { ScorePoint, ScoreWindow } from '../../utils/scoreSeries';
import { splitSkyEvents, topicForEventId, type LearnTopic } from '../../utils/learnSections';
import { showsScore } from './ForecastSection';
import { Fold } from './Collapsible';

interface Props {
  language: Language;
  /** 관측지 UTC 오프셋(시간) */
  tz: number;
  /** 고른 날이 오늘인가 — 머리 글자("오늘" / "고른 날")를 정합니다. */
  isToday: boolean;
  /** "11/19 (목)" */
  dateLabel: string;
  side: EventSide;
  /** 고른 쪽 사건. 없으면(극지 · 예보 없음) 판정 대신 안내를 보입니다. */
  event: ForecastEvent | null;
  /** "서쪽 하늘" 같은 방향 말(모르면 null) */
  direction: string | null;
  /** 하늘 일정(`buildSkyEvents`) — 추천은 먼저, 일반은 접습니다. */
  items: SkyEventItem[];
  /** 시간대별 점수(접어 둠). null 이면 그래프 줄을 아예 안 그립니다. */
  graph: { win: ScoreWindow; points: ScorePoint[] } | null;
  /** 01 하늘을 그 시각으로 엽니다(ms 를 주면 그 시각, 안 주면 가장 붉을 때). */
  onOpenSky: (ms?: number) => void;
  onOpenTopic: (t: LearnTopic) => void;
}

export const TodaySection: React.FC<Props> = ({ language, tz, isToday, dateLabel, side, event, direction, items, graph, onOpenSky, onOpenTopic }) => {
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles();
  const [graphOpen, setGraphOpen] = useState(false);
  const { shown, folded } = splitSkyEvents(items);

  const sideWord = side === 'sunrise' ? L3(language, '일출', 'Sunrise', '日の出') : L3(language, '일몰', 'Sunset', '日の入り');
  const q = event?.quality ?? null;
  const tone = q ? verdictColor(q, dataColor, color) : color.textMute;
  const n = q ? verdictLevel(q) : 0;
  const word = q ? verdictWord(q, language) : L3(language, '예보 없음', 'No forecast', '予報なし');
  const score = event && q && showsScore(event.tier) && event.score != null ? Math.round(event.score) : null;
  // 일몰 · 일출 시각과 "가장 붉을 때" 는 다른 시각입니다(보통 일몰 10~20분 전). 머리 줄은 출몰 시각, 가장 붉을 때는 따로 적습니다.
  const eventTime = event ? localHHMM(event.at, tz) : null;
  const peak = event?.peakAt ? localHHMM(event.peakAt, tz) : null;
  const reason = event?.description ? translateSunsetDesc(event.description, language) : '';

  const row = (it: SkyEventItem) => (
    <PressScale
      key={it.id}
      style={styles.eventRow}
      onPress={() => onOpenTopic(topicForEventId(it.id))}
      accessibilityRole="button"
      accessibilityLabel={`${localHHMM(it.time, tz)} ${it.title}${it.badge ? ` ${it.badge}` : ''} — ${L3(language, '아래 과정에서 이유 보기', 'See why in the steps below', '下の過程で理由を見る')}`}
    >
      <Text style={styles.eventTime}>{localHHMM(it.time, tz)}</Text>
      <Text style={styles.eventTitle} numberOfLines={1}>{it.title}</Text>
      {!!it.badge && <Text style={styles.eventBadge} numberOfLines={1}>{it.badge}</Text>}
      <ChevronRight size={14} color={color.textMute} />
    </PressScale>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{isToday ? L3(language, '오늘', 'Today', '今日') : L3(language, '고른 날', 'Picked day', '選んだ日')}</Text>
        <Text style={styles.sub}>{dateLabel}</Text>
      </View>

      <View style={styles.card}>
        {event && q ? (
          <>
            <View style={styles.scoreRow}>
              <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {VERDICT_ORDER.map((_, i) => <View key={i} style={[styles.cell, { backgroundColor: i < n ? tone : color.border }]} />)}
              </View>
              <Text style={[styles.word, { color: tone }]}>{word}</Text>
              {score != null && <Text style={styles.score}>{score}</Text>}
            </View>
            <Text style={styles.headline}>{`${sideWord} ${eventTime}${direction ? ` · ${direction}` : ''}`}</Text>
            {!!peak && <Text style={styles.sub}>{`${L3(language, '가장 붉을 때', 'Peak glow', '一番赤い時')} ${peak}`}</Text>}
            {!!reason && <Text style={styles.sub}>{reason}</Text>}
          </>
        ) : (
          <>
            <Text style={styles.headline}>{`${sideWord} · ${event ? word : L3(language, '출몰 없음', 'None', 'なし')}`}</Text>
            <Text style={styles.sub}>
              {event
                ? L3(language, '이 시각의 예보가 아직 없어요.', 'There is no forecast for this time yet.', 'この時刻の予報はまだありません。')
                : L3(language, '이 날 이 위치에서는 해가 뜨거나 지는 순간이 없어요.', 'No sunrise or sunset here on this day.', 'この日この場所では日の出・日の入りがありません。')}
            </Text>
          </>
        )}

        {graph && (
          <>
            <PressScale
              style={styles.inlineToggle}
              onPress={() => setGraphOpen(o => !o)}
              accessibilityRole="button"
              accessibilityState={{ expanded: graphOpen }}
              accessibilityLabel={L3(language, '시간대별 점수 보기', 'Score by time of day', '時間帯別スコア')}
            >
              {graphOpen ? <ChevronDown size={14} color={color.accent} /> : <ChevronRight size={14} color={color.accent} />}
              <Text style={styles.inlineToggleText}>{L3(language, '시간대별 점수 보기', 'Score by time of day', '時間帯別スコア')}</Text>
            </PressScale>
            {graphOpen && (
              <ScoreGraph
                points={graph.points}
                window={graph.win}
                nowMs={(event?.peakAt ?? event?.at)?.getTime() ?? graph.win.fromMs}
                tzHours={tz}
                language={language}
                onPickTime={(ms) => onOpenSky(ms)}
              />
            )}
          </>
        )}

        {event && (
          <PressScale
            style={styles.skyBtn}
            onPress={() => onOpenSky()}
            accessibilityRole="button"
            accessibilityLabel={L3(language, '01 하늘에서 그 시각 보기', 'See that time in 01 Sky', '01 空でその時刻を見る')}
          >
            <Text style={styles.skyBtnText}>{L3(language, '하늘에서 보기', 'See it in the sky', '空で見る')}</Text>
          </PressScale>
        )}
      </View>

      {items.length > 0 && (
        <View style={styles.list}>
          <View style={styles.listHead}>
            <Text style={styles.micro}>{L3(language, '하늘 일정', 'Sky schedule', '空の予定')}</Text>
            <Text style={styles.sub}>{L3(language, '누르면 아래 과정에서 이유가 열려요', 'Tap to see why in the steps below', '押すと下の過程で理由が開きます')}</Text>
          </View>
          {shown.map(row)}
          {folded.length > 0 && (
            <Fold
              label={L3(language, `일정 ${folded.length}개 더 보기`, `${folded.length} more`, `予定をあと${folded.length}件見る`)}
              closeLabel={L3(language, '접기', 'Collapse', '閉じる')}
            >
              {folded.map(row)}
            </Fold>
          )}
        </View>
      )}
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  title: { ...type.title, color: color.text },
  sub: { ...type.body, color: color.textDim },
  micro: { ...type.micro, color: color.textDim },
  card: { backgroundColor: color.panel, borderRadius: radius.md, padding: space.md, gap: space.xs },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  meter: { flexDirection: 'row', gap: 3, alignSelf: 'center' },
  cell: { width: 12, height: 18, borderRadius: 2 },
  word: { fontSize: 22, fontWeight: '800' },
  score: { ...type.title, fontSize: 22, color: color.text },
  headline: { ...type.bodyStrong, fontSize: 16, color: color.text },
  inlineToggle: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  inlineToggleText: { ...type.body, color: color.accent },
  skyBtn: {
    minHeight: TOUCH, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
  },
  skyBtnText: { ...type.bodyStrong, color: color.text },
  list: { gap: space.xs },
  listHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.xs },
  eventRow: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: color.fill,
  },
  eventTime: { ...type.label, color: color.text, width: 48 },
  eventTitle: { ...type.body, color: color.text, flex: 1 },
  eventBadge: { ...type.label, color: color.textDim, flexShrink: 1 },
}));
