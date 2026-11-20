/**
 * WhySection.tsx — 학습 페이지의 **결과가 나온 과정** 구역(옛 "왜 그런가요" 창을 옮겼습니다. docs/SANDBOX_MODE_PLAN.md 13.2).
 *
 * 주제 다섯(노을 점수 · 해 뜨는 시각 · 해 지는 시각 · 별 보기 · 구름 모양)이 접는 줄로 이어집니다.
 *  - 먼저 보임: 항목 이름, 결과 값(`topicHeadline`), 한 줄 이유.
 *  - 접어 둠: 단계 카드(`StepCardView`)와 맺음말.
 * 점수 숫자나 하늘 일정 줄을 눌러 들어오면 그 주제가 펼쳐진 채 시작합니다(`openTopic` + `entryNonce`).
 *
 * 카드는 `LearnScreen` 이 `buildTopicResult` 로 미리 만들어 줍니다. 이 부품은 그리기만 합니다.
 * 입력이 없는 주제(예보 없음 · 구름 그림 없음 …)는 펼칠 것이 없으므로 이유만 보이는 줄입니다.
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
import { Collapsible } from './Collapsible';

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

/** 입력이 없어 만들지 못했을 때의 이유(옛 계산 과정 창의 문구와 같은 뜻). */
const missingOf = (t: LearnTopic, language: Language) => {
  switch (t) {
    case 'score': return L3(language, '이 칸의 예보가 아직 없어서 점수가 나온 단계를 보여 줄 수 없어요.', 'There is no forecast for this cell yet, so the steps of the score cannot be shown.', 'このマスの予報がまだないので、スコアが出た段階を表示できません。');
    case 'stars': return L3(language, '이 날 밤의 별 보기 조건을 셀 자료가 아직 없어요.', 'There is not enough data yet to work out stargazing conditions for that night.', 'その夜の星空の条件を計算するデータがまだありません。');
    case 'cloud': return L3(language, '01 하늘이 아직 구름을 그리지 않았어요. 01 하늘을 한 번 열어 주세요.', 'The 01 Sky has not drawn clouds yet. Open 01 Sky once.', '01 空がまだ雲を描いていません。01 空を一度開いてください。');
    default: return L3(language, '이 날 이 위치에서는 해가 뜨거나 지는 순간이 없어요(백야 또는 극야).', 'No sunrise or sunset here on this day (midnight sun or polar night).', 'この日この場所では日の出・日の入りがありません(白夜または極夜)。');
  }
};

export const WhySection: React.FC<Props> = ({ language, results, openTopic, entryNonce, notes, onOpenData }) => {
  const color = useThemeColors(); const styles = useStyles();
  // 펼침은 이 부품이 쥡니다. 들어올 때마다(`entryNonce`) 들어온 주제만 펼치고, 손으로 접고 펼친 것은 그대로 따릅니다.
  const [opened, setOpened] = useState<Partial<Record<LearnTopic, boolean>>>(() => (openTopic ? { [openTopic]: true } : {}));
  useEffect(() => {
    if (openTopic) setOpened({ [openTopic]: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryNonce]);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{L3(language, '결과가 나온 과정', 'How the results are made', '結果が出るまで')}</Text>
        <Text style={styles.sub}>{L3(language, '항목을 누르면 단계가 펼쳐져요', 'Tap an item to see the steps', '項目を押すと段階が開きます')}</Text>
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
            {r.cards.map((c, i) => <StepCardView key={c.id} index={i + 1} card={c} language={language} inset />)}
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
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  title: { ...type.title, color: color.text },
  sub: { ...type.body, color: color.textDim },
  noteLine: { ...type.body, color: color.textDim },
  footnote: { fontSize: 11, color: color.textMute },
  emptyCard: { backgroundColor: color.panel, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  emptyHead: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  emptyTitle: { ...type.title, fontSize: 16, color: color.text },
  emptyValue: { ...type.body, color: color.textMute },
  dataBtn: {
    minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft,
  },
  dataBtnText: { ...type.bodyStrong },
}));
