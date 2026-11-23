/**
 * TodaySection.tsx — 데이터 페이지 상단 **① 지금**과 **② 앞으로 24시간** 구역.
 *
 * - ① 지금(파란 실선 틀): 결론 한 줄 · 지난 6시간 구름 추세 · 노을/별 원형 게이지 · 달/행성 칩 ·
 *   360° 구름 지도(+ 해 쪽 빛 통로) · 4종 3색 기준 띠 · 값 자세히(접기).
 * - ② 앞으로 24시간(주황 점선 틀): 낮/밤·점수 이중 곡선·구름 히트맵·번호 마커 SVG 타임라인 ·
 *   최고 순간 배너 · 탭 연동 이벤트 목록.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronRight, Cloud, Compass, Moon, Sparkles, Sun, Wind } from 'lucide-react-native';
import { L3, type Language } from '../../utils/i18n';
import { mono, radius, space, type } from '../../theme/tokens';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import { verdictColor, verdictWord, localHHMM } from '../SunsetSimulation/PredictionCard';
import { SkyMapView, SunLineStrip } from '../CalcSteps/StepCards';
import type { EventSide, ForecastEvent } from '../../utils/sunForecast';
import type { SkyEventItem } from '../../utils/skyEvents';
import type { ScorePoint, ScoreWindow } from '../../utils/scoreSeries';
import type { LearnTopic } from '../../utils/learnSections';
import type { TimeBriefing, UpcomingTimelineEvent } from '../../utils/timeBriefing';
import type {
  CloudTrend6h,
  GaugeBandSpec,
  LiveSkyMapSummary,
  MoonStripInfo,
  StarGaugeSummary,
  Timeline24hChartData,
} from '../../utils/learnNoteData';
import { ZoneHead } from './ZoneHead';
import { Fold } from './Collapsible';
import {
  CloudTrendBanner,
  ComfortGaugesView,
  MoonPlanetStrip,
  ScoreRingsRow,
  Timeline24hChart,
} from './LearnMockupVisuals';

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
  /** 목업 기반 시각화 확장 데이터 */
  cloudTrend?: CloudTrend6h | null;
  moonStrip?: MoonStripInfo | null;
  starSummary?: StarGaugeSummary | null;
  liveSkyMap?: LiveSkyMapSummary | null;
  gauges?: GaugeBandSpec[];
  timeline24h?: Timeline24hChartData | null;
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
  briefing,
  upcomingEvents,
  onOpenSky,
  onOpenTopic,
  cloudTrend,
  moonStrip,
  starSummary,
  liveSkyMap,
  gauges,
  timeline24h,
}) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();
  const [selectedEvIdx, setSelectedEvIdx] = useState<number | null>(1);

  // 노을 점수 도넛: 지금 브리핑 점수 우선, 없으면 선택 날 대표 이벤트 점수 사용
  const glowScore = briefing?.glowVerdict?.score ?? (event?.score != null ? Math.round(event.score) : null);
  const glowQuality = briefing?.glowVerdict?.quality ?? event?.quality ?? null;
  const glowWord = glowQuality ? verdictWord(glowQuality, language) : L3(language, '대기', 'N/A', '待機');
  const glowTone = glowQuality ? verdictColor(glowQuality, dataColor, color) : color.textMute;
  const glowSubSide = (briefing?.glowVerdict?.side ?? event?.side) === 'sunrise'
    ? L3(language, '일출', 'Sunrise', '日の出')
    : L3(language, '일몰', 'Sunset', '日の入り');

  const shownUpcoming = upcomingEvents.slice(0, 5);
  const foldedUpcoming = upcomingEvents.slice(5);

  const renderEventRow = (ev: UpcomingTimelineEvent, idx: number) => {
    const no = idx + 1;
    const active = selectedEvIdx === no;
    const evTimeStr = localHHMM(new Date(ev.timeMs), tz);
    const qTone = ev.quality ? verdictColor(ev.quality, dataColor, color) : null;
    const qWord = ev.quality ? verdictWord(ev.quality, language) : null;

    return (
      <View key={ev.id} style={styles.evRowOuter}>
        <PressScale
          style={[
            styles.evBtn,
            active && { borderColor: dataColor.sunrise, borderStyle: 'dashed', backgroundColor: color.glowSoft },
          ]}
          onPress={() => setSelectedEvIdx(no)}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
        >
          <View style={[styles.evNo, { backgroundColor: dataColor.sunrise }]}>
            <Text style={styles.evNoText}>{no}</Text>
          </View>
          <Text style={styles.evTime}>{evTimeStr}</Text>
          <View style={styles.evBody}>
            <View style={styles.evTitleLine}>
              <Text style={styles.evTitle} numberOfLines={1}>{ev.title}</Text>
              {qWord && qTone ? (
                <Text style={[styles.evBadge, { color: qTone }]}>
                  {`${qWord}${ev.score != null ? ` ${ev.score}` : ''}`}
                </Text>
              ) : !!ev.badge ? (
                <Text style={styles.evBadgeDim}>{ev.badge}</Text>
              ) : null}
            </View>
            <Text style={styles.evDesc} numberOfLines={2}>{ev.description}</Text>
          </View>
        </PressScale>

        <View style={styles.evSideActions}>
          <PressScale
            style={[styles.go3dBtn, { borderColor: dataColor.sunrise }]}
            onPress={() => onOpenSky(ev.timeMs)}
            accessibilityRole="button"
            accessibilityLabel={`${evTimeStr} ${ev.title} — ${L3(language, '이 시각 하늘 보기', 'View sky at this time', 'この時刻の空を見る')}`}
          >
            <Text style={[styles.go3dText, { color: dataColor.sunrise }]}>3D ▸</Text>
          </PressScale>
          <PressScale
            style={styles.calcMiniBtn}
            onPress={() => onOpenTopic(ev.topic)}
            accessibilityRole="button"
            accessibilityLabel={`${ev.title} — ${L3(language, '계산 과정', 'How it works', '計算過程')}`}
          >
            <ChevronRight size={13} color={color.textMute} />
          </PressScale>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      {/* ── ① 지금 구역 본문 ── */}
      {isCustomPickedTime && onResetToSkyTime && (
        <PressScale
          style={styles.resetSkyTimeBtn}
          onPress={onResetToSkyTime}
          accessibilityRole="button"
        >
          <Text style={styles.resetSkyTimeText}>
            {L3(
              language,
              `01 하늘 선택 시각(${skyTimeLabel ?? ''})으로 돌아가기`,
              `Return to 01 Sky time (${skyTimeLabel ?? ''})`,
              `01 空の選択時刻(${skyTimeLabel ?? ''})に戻る`,
            )}
          </Text>
        </PressScale>
      )}

      {briefing ? (
        <>
          <View style={styles.headBlock}>
            <Text style={styles.headline}>{briefing.weatherSummaryTitle}</Text>
            <Text style={styles.lead}>{briefing.weatherNarrative}</Text>
          </View>

          {cloudTrend && (
            <CloudTrendBanner
              trend={cloudTrend}
              language={language}
              onOpenSky={() => onOpenSky(briefing.timeMs)}
            />
          )}

          {starSummary && (
            <ScoreRingsRow
              glowScore={glowScore}
              glowWord={glowWord}
              glowSubLabel={glowSubSide}
              glowTone={glowTone}
              star={starSummary}
              language={language}
              onPressGlow={() => onOpenTopic('score')}
              onPressStar={() => onOpenTopic('stars')}
            />
          )}

          {moonStrip && (
            <MoonPlanetStrip
              moon={moonStrip}
              planets={briefing.visiblePlanets}
              language={language}
            />
          )}

          {/* 360° 구름 지도 · 해 방향 빛 통로 (바로 노출) */}
          {liveSkyMap && (
            <View style={styles.figCard}>
              <Text style={styles.secTitle}>
                {L3(language, '360° 구름 지도 · 해 방향 빛 통로', '360° cloud map · light path', '360°雲地図・光の通路')}
              </Text>
              <SkyMapView map={liveSkyMap.map} language={language} />
              <Text style={styles.figHint}>
                {L3(
                  language,
                  '읽는 법: 가운데가 나, 바깥으로 갈수록 먼 곳. 원이 크고 진할수록 구름 많음. 주황 선이 해 방향.',
                  'How to read: you are at center, farther rings are farther out. Larger, darker circles mean denser cloud; orange line points to Sun.',
                  '読み方: 中央が自分、外ほど遠く。丸が大きく濃いほど雲が多め。オレンジ線が太陽方向。',
                )}
              </Text>
              {liveSkyMap.map.sunLine && liveSkyMap.map.sunLine.length > 1 && (
                <SunLineStrip map={liveSkyMap.map} language={language} />
              )}
              <Text style={styles.figMech}>{liveSkyMap.summaryText}</Text>
              <View style={styles.link3d}>
                <Text style={styles.link3dText}>
                  {L3(language, '선택 시각의 3D 하늘에서 확인', 'Verify in 3D Sky at this time', '選択時刻の3D空で確認')}
                </Text>
                <PressScale
                  style={[styles.goBtn, { borderColor: color.accent }]}
                  onPress={() => onOpenSky(briefing.timeMs)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.goBtnText, { color: color.accent }]}>
                    {L3(language, '3D 하늘 ▸', '3D Sky ▸', '3D空 ▸')}
                  </Text>
                </PressScale>
              </View>
            </View>
          )}

          {/* 지금 값, 촬영에 괜찮은지 (4종 기준 띠) */}
          {gauges && gauges.length > 0 && (
            <View style={styles.gaugesSection}>
              <Text style={styles.secTitle}>
                {L3(language, '지금 값, 촬영에 괜찮은지', 'Shooting conditions now', '撮影条件の目安')}
              </Text>
              <ComfortGaugesView gauges={gauges} />
            </View>
          )}

          {/* 값 자세히 (긴 상세 설명은 접어서 깔끔하게) */}
          <Fold
            label={L3(language, '값 자세히 · 천체 해설', 'Detailed values & sky briefing', '詳しい値・天体解説')}
            closeLabel={L3(language, '접기', 'Collapse', '閉じる')}
          >
            <View style={styles.detailStack}>
              <View style={styles.detailItem}>
                <View style={styles.detailHead}>
                  <Sun size={14} color={dataColor.sunrise} />
                  <Text style={styles.detailTitle}>{briefing.sunTitle}</Text>
                </View>
                <Text style={styles.detailBody}>{briefing.sunNarrative}</Text>
              </View>
              <View style={styles.detailItem}>
                <View style={styles.detailHead}>
                  <Moon size={14} color={color.moon} />
                  <Text style={styles.detailTitle}>{briefing.moonTitle}</Text>
                </View>
                <Text style={styles.detailBody}>{briefing.moonNarrative}</Text>
              </View>
              <View style={styles.detailItem}>
                <View style={styles.detailHead}>
                  <Sparkles size={14} color={dataColor.stars} />
                  <Text style={styles.detailTitle}>{briefing.starTitle}</Text>
                </View>
                <Text style={styles.detailBody}>{briefing.starNarrative}</Text>
              </View>
              <View style={styles.detailItem}>
                <View style={styles.detailHead}>
                  <Compass size={14} color={color.accent} />
                  <Text style={styles.detailTitle}>{briefing.planetsTitle}</Text>
                </View>
                <Text style={styles.detailBody}>{briefing.planetsNarrative}</Text>
              </View>
              {briefing.weatherMetrics.length > 0 && (
                <View style={styles.metricRowGrid}>
                  {briefing.weatherMetrics.map(m => (
                    <View key={m.id} style={styles.metricMini}>
                      <Text style={styles.metricMiniLabel} numberOfLines={1}>{m.label}</Text>
                      <Text style={styles.metricMiniVal} numberOfLines={1}>{m.value}</Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.detailActions}>
                <PressScale style={styles.topicLinkBtn} onPress={() => onOpenSky()}>
                  <Cloud size={13} color={color.accent} />
                  <Text style={[styles.topicLinkText, { color: color.accent }]}>
                    {L3(language, '하늘 화면에서 보기', 'Open in Sky', '空画面で見る')}
                  </Text>
                </PressScale>
                <PressScale style={styles.topicLinkBtn} onPress={() => onOpenTopic('cloud')}>
                  <Wind size={13} color={color.textDim} />
                  <Text style={styles.topicLinkText}>
                    {L3(language, '구름 분석 과정', 'Cloud steps', '雲の計算過程')}
                  </Text>
                </PressScale>
              </View>
            </View>
          </Fold>
        </>
      ) : (
        <View style={styles.emptyBox}>
          <Text style={styles.lead}>
            {`${dateLabel} ${timeLabel} · `}
            {event
              ? L3(language, '이 시각의 데이터를 불러오는 중이에요.', 'Loading data for this time.', 'この時刻のデータを読み込み中です。')
              : L3(language, '위치를 먼저 선택해 주세요.', 'Pick a location first.', '先に場所を選択してください。')}
          </Text>
        </View>
      )}

      {/* ── ② 앞으로 24시간 (주황 점선 프레임) ── */}
      {(upcomingEvents.length > 0 || timeline24h) && (
        <View style={[styles.zoneSoon, { borderColor: dataColor.sunrise }]}>
          <ZoneHead zone="hours" language={language} />

          {timeline24h?.bestSummary && (
            <Text style={styles.soonHeadline}>{timeline24h.bestSummary}</Text>
          )}

          {timeline24h && (
            <Timeline24hChart
              data={timeline24h}
              selectedIndex={selectedEvIdx}
              onSelectMarker={(idx) => setSelectedEvIdx(idx)}
              language={language}
            />
          )}

          {timeline24h?.bestSummary && (
            <View style={[styles.bestBanner, { borderColor: dataColor.sunrise, backgroundColor: color.glowSoft }]}>
              <Text style={[styles.bestBannerText, { color: color.text }]}>
                <Text style={{ fontWeight: '700', color: dataColor.sunrise }}>★ </Text>
                {timeline24h.bestSummary}
              </Text>
            </View>
          )}

          {upcomingEvents.length > 0 && (
            <View style={styles.evListWrap}>
              <Text style={styles.secTitle}>
                {L3(language, '이벤트 순서 · 탭하면 그래프에 표시', 'Events · tap to highlight', 'イベント順・タップで表示')}
              </Text>
              <View style={styles.evList}>
                {shownUpcoming.map((ev, i) => renderEventRow(ev, i))}
              </View>
              {foldedUpcoming.length > 0 && (
                <Fold
                  label={L3(
                    language,
                    `이후 이벤트 ${foldedUpcoming.length}개 더 보기`,
                    `Show ${foldedUpcoming.length} more events`,
                    `あと${foldedUpcoming.length}件見る`,
                  )}
                  closeLabel={L3(language, '접기', 'Collapse', '閉じる')}
                >
                  <View style={styles.evList}>
                    {foldedUpcoming.map((ev, i) => renderEventRow(ev, i + shownUpcoming.length))}
                  </View>
                </Fold>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.md },
  headBlock: { gap: 4 },
  headline: { fontSize: 18, fontWeight: '700', lineHeight: 25, color: color.text },
  lead: { ...type.body, fontSize: 13, color: color.textDim, lineHeight: 19 },
  secTitle: { fontSize: 12, fontWeight: '700', color: color.textMute, letterSpacing: 0.4 },

  resetSkyTimeBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
  },
  resetSkyTimeText: { fontSize: 12, fontWeight: '700', color: color.accent },

  figCard: { backgroundColor: color.fill, borderRadius: radius.md, padding: space.sm + 2, gap: space.xs + 2 },
  figHint: { fontSize: 11.5, color: color.textMute, lineHeight: 16 },
  figMech: { fontSize: 13, fontWeight: '600', color: color.text, lineHeight: 18 },
  link3d: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  link3dText: { flex: 1, fontSize: 12, color: color.text },
  goBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, minHeight: 26, justifyContent: 'center' },
  goBtnText: { fontSize: 11, fontWeight: '700' },

  gaugesSection: { gap: space.xs + 2 },
  emptyBox: { backgroundColor: color.fill, borderRadius: radius.md, padding: space.md },

  detailStack: { gap: space.sm },
  detailItem: { gap: 3, paddingBottom: space.xs, borderBottomWidth: 1, borderBottomColor: color.border },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailTitle: { ...type.bodyStrong, fontSize: 12.5, color: color.text },
  detailBody: { fontSize: 12, color: color.textDim, lineHeight: 17 },
  metricRowGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricMini: {
    flexGrow: 1,
    minWidth: '30%',
    backgroundColor: color.panel,
    borderRadius: radius.sm,
    padding: 6,
    gap: 1,
  },
  metricMiniLabel: { fontSize: 10.5, color: color.textMute },
  metricMiniVal: { fontFamily: mono, fontSize: 12, fontWeight: '700', color: color.text },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  topicLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
  },
  topicLinkText: { fontSize: 12, fontWeight: '600', color: color.textDim },

  zoneSoon: {
    marginTop: space.xs,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    backgroundColor: color.panel,
    padding: space.md + 2,
    gap: space.md,
  },
  soonHeadline: { fontSize: 17, fontWeight: '700', lineHeight: 24, color: color.text },
  bestBanner: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  bestBannerText: { fontSize: 13, lineHeight: 18 },

  evListWrap: { gap: space.xs + 2 },
  evList: { gap: 6 },
  evRowOuter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  evBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: color.fill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  evNo: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  evNoText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  evTime: { fontFamily: mono, fontSize: 12, fontWeight: '600', color: color.text, width: 44, paddingTop: 2 },
  evBody: { flex: 1, minWidth: 0, gap: 2 },
  evTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  evTitle: { ...type.bodyStrong, fontSize: 13, color: color.text, flexShrink: 1 },
  evBadge: { fontSize: 11, fontWeight: '700' },
  evBadgeDim: { fontSize: 11, color: color.textDim },
  evDesc: { fontSize: 12, color: color.textDim, lineHeight: 16 },
  evSideActions: { gap: 4, alignItems: 'center' },
  go3dBtn: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minHeight: 28,
    justifyContent: 'center',
  },
  go3dText: { fontSize: 11, fontWeight: '700' },
  calcMiniBtn: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: color.fill,
  },
}));
