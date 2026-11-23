/**
 * UpcomingCards.tsx — 01 하늘 시트의 **"다가오는 좋은 순간" 카드**(docs/SANDBOX_MODE_PLAN.md 2.4, 목업 1번).
 *
 * 내일·모레 가운데 하루마다 더 좋은 출몰을 작은 카드로 보여 주고(`utils/upcomingMoments.ts`), 누르면 02 학습의 그 날로 갑니다.
 * 카드 하나는 세 줄입니다: 날(내일 · 모레) / 일출 · 일몰 + 판정 / 가장 붉을 때. 맨 앞에 "오늘 밤 별 보기" 카드가 올 수 있습니다(`starMoment`): 오늘 밤 / 별 보기 / 시작 시각~.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { makeStyles, useDataColors, useThemeColors } from '../../theme/useTheme';
import { color as DARK, dataColor as DARK_DATA, radius, space, type, type Palette } from '../../theme/tokens';
import { PressScale } from '../ui';
import { L3 } from '../../utils/i18n';
import { verdictColor, verdictWord, localHHMM } from '../SunsetSimulation/PredictionCard';
import type { StarMoment, UpcomingMoment } from '../../utils/upcomingMoments';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  moments: readonly UpcomingMoment[];
  /** "오늘 밤 별 보기" 카드(목업의 첫 카드). 없으면 안 그립니다. */
  star?: StarMoment | null;
  language: Lang;
  /** 관측지 UTC 오프셋(시간) */
  tzHours: number;
  onPress: (m: UpcomingMoment) => void;
  /** 별 보기 카드를 누르면 — 02 학습의 별 보기 과정을 엽니다. */
  onStarPress?: () => void;
  forceDark?: boolean;
}

export const UpcomingCards: React.FC<Props> = ({ moments, star, language, tzHours, onPress, onStarPress, forceDark = false }) => {
  const themeColor = useThemeColors();
  const themeData = useDataColors();
  const themeStyles = useStyles();
  const color = forceDark ? DARK : themeColor;
  const dataColor = forceDark ? DARK_DATA : themeData;
  const styles = forceDark ? darkStyles : themeStyles;
  const starTime = star ? (star.fromNow ? L3(language, '지금부터', 'From now', '今から') : `${localHHMM(new Date(star.timeMs), tzHours)}~`) : '';
  // 카드가 셋이면 한 장이 좁아집니다(360 폭 폰에서 약 104px). 안쪽 좌우 여백을 줄여 "Sunset Good" 같은 한 줄이 들어가게 합니다.
  const dense = moments.length + (star ? 1 : 0) >= 3;
  const cardStyle = dense ? [styles.card, styles.cardDense] : styles.card;
  return (
    <View style={styles.row}>
      {star && (
        <PressScale
          key="stars"
          style={cardStyle}
          onPress={onStarPress}
          accessibilityRole="button"
          accessibilityLabel={`${L3(language, '오늘 밤 별 보기', 'Stargazing tonight', '今夜の星空')} ${starTime} — ${L3(language, '계산 과정 보기', 'See how it is computed', '計算の過程を見る')}`}
        >
          <Text style={styles.day}>{L3(language, '오늘 밤', 'Tonight', '今夜')}</Text>
          <Text style={styles.main} numberOfLines={2}>{L3(language, '별 보기', 'Stargazing', '星空')}</Text>
          <Text style={styles.time}>{starTime}</Text>
        </PressScale>
      )}
      {moments.map(m => {
        const day = m.dayOffset === 1 ? L3(language, '내일', 'Tomorrow', '明日') : L3(language, '모레', 'In 2 days', '明後日');
        const side = m.side === 'sunrise' ? L3(language, '일출', 'Sunrise', '日の出') : L3(language, '일몰', 'Sunset', '日の入り');
        const word = verdictWord(m.quality, language);
        const time = localHHMM(new Date(m.timeMs), tzHours);
        return (
          <PressScale
            key={m.id}
            style={cardStyle}
            onPress={() => onPress(m)}
            accessibilityRole="button"
            accessibilityLabel={`${day} ${side} ${word}, ${time} — ${L3(language, '02 학습에서 보기', 'See it in 02 Learn', '02 学習で見る')}`}
          >
            <Text style={styles.day}>{day}</Text>
            <Text style={styles.main} numberOfLines={2}>
              {`${side} `}
              <Text style={{ color: verdictColor(m.quality, dataColor, color) }}>{word}</Text>
            </Text>
            <Text style={styles.time}>{time}</Text>
          </PressScale>
        );
      })}
    </View>
  );
};

const makeCardStyles = (color: Palette) => ({
  row: { flexDirection: 'row' as const, gap: space.sm },
  card: {
    flex: 1, minWidth: 0, minHeight: 64, justifyContent: 'center' as const, gap: space.xxs,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill,
  },
  cardDense: { paddingHorizontal: space.sm },
  day: { ...type.micro, color: color.textDim },
  main: { ...type.bodyStrong, color: color.text },
  time: { ...type.label, color: color.textDim },
});

const useStyles = makeStyles(makeCardStyles);
const darkStyles = makeCardStyles(DARK);
