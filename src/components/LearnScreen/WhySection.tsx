/**
 * WhySection.tsx — 데이터 페이지 **④ 원리** 구역.
 *
 * - 상단 세그먼트 토글(`노을 점수 | 별 한계등급`)을 기본 펼침 상태로 두어 들어가자마자 가감 막대(WaterfallBars) +
 *   단계 줄(WaterfallSteps)이 즉시 보입니다.
 * - 이어서 5개 주제(`LEARN_TOPICS`) 상세 카드, 원리 학습 5종 탭, ? 용어 칩 4종, 오늘의 하늘 공부로 이어집니다.
 */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { L3, type Language } from '../../utils/i18n';
import { radius, space, type } from '../../theme/tokens';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import { StepCardView } from '../CalcSteps/StepCards';
import type { TopicResult } from '../../utils/calcTopic';
import { LEARN_TOPICS, topicHeadline, type LearnTopic } from '../../utils/learnSections';
import { Collapsible, Fold } from './Collapsible';
import { WaterfallBars, WaterfallSteps } from './WaterfallBars';
import { LearnConceptCards, type ConceptContext } from './LearnConceptCards';

interface Props {
  language: Language;
  /** 주제마다의 결과. 입력이 없으면 null. */
  results: Record<LearnTopic, TopicResult | null>;
  /** 펼친 채 시작할 주제(점수 숫자 · 하늘 일정 줄에서 들어온 길). 없으면 모두 접힘. */
  openTopic: LearnTopic | null;
  /** 들어올 때마다 바뀌는 값 — 같은 주제로 다시 들어와도 다시 펼칩니다. */
  entryNonce: number;
  /** 주제 위에 붙이는 안내 한 줄(구름 모양의 "01 하늘이 그린 시각" 같은 것) */
  notes?: Partial<Record<LearnTopic, string>>;
  /** 단계에서 근거 데이터로 이어지는 길(점수 주제 끝의 단추) */
  onOpenData?: () => void;
  /** 원리 학습 5종 · 용어 4종에 넘기는 live 문맥 */
  conceptContext?: ConceptContext;
  /** 3D 하늘 화면 열기 */
  onOpenSky?: () => void;
}

const nameOf = (t: LearnTopic, language: Language) => {
  switch (t) {
    case 'score': return L3(language, '노을 점수', 'Glow score', '夕焼けスコア');
    case 'sunrise': return L3(language, '해 뜨는 시각', 'Sunrise', '日の出');
    case 'sunset': return L3(language, '해 지는 시각', 'Sunset', '日の入り');
    case 'stars': return L3(language, '별 보기', 'Stargazing', '星空');
    default: return L3(language, '구름 모양', 'Cloud shapes', '雲の形');
  }
};

/** 입력이 없어 만들지 못했을 때의 이유(verify-calc-steps 검사와 동일한 문구 유지). */
const missingOf = (t: LearnTopic, language: Language) => {
  switch (t) {
    case 'score': return L3(language, '이 칸의 예보가 아직 없어서 점수가 나온 단계를 보여 줄 수 없어요.', 'There is no forecast for this cell yet, so the steps of the score cannot be shown.', 'このマスの予報がまだないので、スコアが出た段階を表示できません。');
    case 'stars': return L3(language, '이 날 밤의 별 보기 조건을 셀 자료가 아직 없어요.', 'There is not enough data yet to work out stargazing conditions for that night.', 'その夜の星空の条件を計算するデータがまだありません。');
    case 'cloud': return L3(language, '01 하늘이 아직 구름을 그리지 않았어요. 01 하늘을 한 번 열어 주세요.', 'The 01 Sky has not drawn clouds yet. Open 01 Sky once.', '01 空がまだ雲を描いていません。01 空を一度開いてください。');
    default: return L3(language, '이 날 이 위치에서는 해가 뜨거나 지는 순간이 없어요(백야 또는 극야).', 'No sunrise or sunset here on this day (midnight sun or polar night).', 'この日この場所では日の出・日の入りがありません(白夜または極夜)。');
  }
};

export const WhySection: React.FC<Props> = ({
  language,
  results,
  openTopic,
  entryNonce,
  notes,
  onOpenData,
  conceptContext,
  onOpenSky,
}) => {
  const color = useThemeColors();
  const styles = useStyles();

  // 상단 워터폴 세그먼트: 노을 점수 ↔ 별 한계등급 (기본: 노을 점수 바로 펼침)
  const [segTopic, setSegTopic] = useState<'score' | 'stars'>(() => (openTopic === 'stars' ? 'stars' : 'score'));
  const [opened, setOpened] = useState<Partial<Record<LearnTopic, boolean>>>(() => (openTopic ? { [openTopic]: true } : {}));

  useEffect(() => {
    if (openTopic === 'stars' || openTopic === 'score') setSegTopic(openTopic);
    if (openTopic) setOpened({ [openTopic]: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryNonce]);

  const activeWfResult = results[segTopic];
  const wfHeadline = activeWfResult?.waterfall
    ? segTopic === 'score'
      ? L3(language, `노을 점수 ${Math.round(activeWfResult.waterfall.end)}, 뭐가 깎았나`, `Glow score ${Math.round(activeWfResult.waterfall.end)} breakdown`, `夕焼けスコア ${Math.round(activeWfResult.waterfall.end)} の内訳`)
      : L3(language, `별 한계등급 ${activeWfResult.waterfall.end.toFixed(1)}, 뭐가 지웠나`, `Star limit ${activeWfResult.waterfall.end.toFixed(1)} breakdown`, `限界等級 ${activeWfResult.waterfall.end.toFixed(1)} の内訳`)
    : L3(language, '점수가 나온 과정', 'How the score is made', 'スコアが出た過程');

  return (
    <View style={styles.wrap}>
      <Text style={styles.headline} accessibilityRole="header">{wfHeadline}</Text>

      {/* 노을 점수 | 별 한계등급 세그먼트 전환 + 기본 펼침 워터폴 */}
      <View style={styles.segRow}>
        {(['score', 'stars'] as const).map(k => {
          const on = segTopic === k;
          return (
            <PressScale
              key={k}
              style={[styles.segBtn, on && { backgroundColor: color.success }]}
              onPress={() => setSegTopic(k)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.segText, on && { color: color.onAccent }]}>
                {k === 'score'
                  ? L3(language, '노을 점수', 'Glow score', '夕焼けスコア')
                  : L3(language, '별 한계등급', 'Star limit', '星の限界等級')}
              </Text>
            </PressScale>
          );
        })}
      </View>

      {activeWfResult?.waterfall ? (
        <View style={styles.wfCard}>
          {!!activeWfResult.eventLabel && (
            <Text style={styles.sub}>{`${activeWfResult.title} · ${activeWfResult.eventLabel}`}</Text>
          )}
          <WaterfallBars waterfall={activeWfResult.waterfall} />
          <View style={styles.sep} />
          <WaterfallSteps waterfall={activeWfResult.waterfall} />
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.sub}>{missingOf(segTopic, language)}</Text>
        </View>
      )}

      {/* 5개 계산 과정 상세 아코디언 */}
      <View style={styles.head}>
        <Text style={styles.secLabel}>{L3(language, '주제별 상세 계산 · 탭', 'Detailed calculation by topic', 'トピック別の詳細計算')}</Text>
      </View>

      {LEARN_TOPICS.map(topic => {
        const r = results[topic];
        const name = nameOf(topic, language);
        if (!r) {
          return (
            <View key={topic} style={styles.emptyCard}>
              <View style={styles.emptyHead}>
                <Text style={styles.emptyTitle}>{name}</Text>
                <Text style={styles.emptyValue}>—</Text>
              </View>
              <Text style={styles.sub}>{missingOf(topic, language)}</Text>
            </View>
          );
        }
        const { value, reason } = topicHeadline(topic, r);
        const note = notes?.[topic];
        return (
          <Collapsible
            key={topic}
            big
            title={name}
            right={value ?? undefined}
            peek={reason ?? undefined}
            accent={openTopic === topic && !!opened[topic]}
            open={!!opened[topic]}
            onOpenChange={(o) => setOpened(prev => ({ ...prev, [topic]: o }))}
          >
            <Text style={styles.sub}>{r.eventLabel ? `${r.title} · ${r.eventLabel}` : r.title}</Text>
            {!!note && <Text style={styles.noteLine}>{note}</Text>}
            {r.waterfall ? (
              <Fold label={L3(language, '단계 카드 보기', 'See the calculation steps', '計算カードを見る')} closeLabel={L3(language, '접기', 'Fold', '閉じる')}>
                {r.cards.map((c, i) => <StepCardView key={c.id} index={i + 1} card={c} language={language} inset />)}
              </Fold>
            ) : (
              r.cards.map((c, i) => <StepCardView key={c.id} index={i + 1} card={c} language={language} inset />)
            )}
            <Text style={styles.footnote}>{r.footnote}</Text>
            {topic === 'score' && onOpenData && (
              <PressScale
                style={styles.dataBtn}
                onPress={onOpenData}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '이 점수에 쓴 근거 데이터 보기', 'See the data behind this score', 'このスコアに使った根拠データを見る')}
              >
                <Text style={[styles.dataBtnText, { color: color.accent }]}>{L3(language, '근거 데이터 보기', 'See the data', '根拠データを見る')}</Text>
              </PressScale>
            )}
          </Collapsible>
        );
      })}

      {/* 원리 학습 5종 탭 · ? 용어 칩 4종 · 오늘의 하늘 공부 */}
      <LearnConceptCards language={language} ctx={conceptContext} onOpenSky={onOpenSky} />
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.sm + 2 },
  headline: { fontSize: 18, fontWeight: '700', lineHeight: 24, color: color.text },
  segRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.borderStrong,
    overflow: 'hidden',
    backgroundColor: color.fill,
  },
  segBtn: { paddingHorizontal: 14, paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
  segText: { fontSize: 12, fontWeight: '700', color: color.textDim },
  wfCard: { backgroundColor: color.fill, borderRadius: radius.md, padding: space.md, gap: space.xs },
  head: { marginTop: space.xs },
  secLabel: { fontSize: 12, fontWeight: '700', color: color.textMute, letterSpacing: 0.4 },
  sub: { ...type.body, color: color.textDim },
  noteLine: { ...type.body, color: color.textDim },
  footnote: { fontSize: 11, color: color.textMute },
  sep: { height: 1, backgroundColor: color.border, marginVertical: space.xs },
  emptyCard: { backgroundColor: color.fill, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  emptyHead: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  emptyTitle: { ...type.title, fontSize: 16, color: color.text },
  emptyValue: { ...type.body, color: color.textMute },
  dataBtn: {
    minHeight: 40,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
  },
  dataBtnText: { ...type.bodyStrong },
}));
