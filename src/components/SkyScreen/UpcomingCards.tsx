/**
 * UpcomingCards.tsx — 01 하늘 시트의 **"다가오는 좋은 순간" 카드**(docs/SANDBOX_MODE_PLAN.md 2.4, 목업 1번).
 *
 * 내일·모레 가운데 하루마다 더 좋은 출몰을 작은 카드로 보여 주고(`utils/upcomingMoments.ts`), 누르면 02 예보의 그 칸으로 갑니다.
 * 카드 하나는 세 줄입니다: 날(내일 · 모레) / 일출 · 일몰 + 판정 / 가장 붉을 때.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { makeStyles, useDataColors, useThemeColors } from '../../theme/useTheme';
import { radius, space, type } from '../../theme/tokens';
import { PressScale } from '../ui';
import { L3 } from '../../utils/i18n';
import { verdictColor, verdictWord, localHHMM } from '../SunsetSimulation/PredictionCard';
import type { UpcomingMoment } from '../../utils/upcomingMoments';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  moments: readonly UpcomingMoment[];
  language: Lang;
  /** 관측지 UTC 오프셋(시간) */
  tzHours: number;
  onPress: (m: UpcomingMoment) => void;
}

export const UpcomingCards: React.FC<Props> = ({ moments, language, tzHours, onPress }) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {moments.map(m => {
        const day = m.dayOffset === 1 ? L3(language, '내일', 'Tomorrow', '明日') : L3(language, '모레', 'In 2 days', '明後日');
        const side = m.side === 'sunrise' ? L3(language, '일출', 'Sunrise', '日の出') : L3(language, '일몰', 'Sunset', '日の入り');
        const word = verdictWord(m.quality, language);
        const time = localHHMM(new Date(m.timeMs), tzHours);
        return (
          <PressScale
            key={m.id}
            style={styles.card}
            onPress={() => onPress(m)}
            accessibilityRole="button"
            accessibilityLabel={`${day} ${side} ${word}, ${time} — ${L3(language, '02 예보에서 보기', 'See it in 02 Forecast', '02 予報で見る')}`}
          >
            <Text style={styles.day}>{day}</Text>
            <Text style={styles.main} numberOfLines={1}>
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

const useStyles = makeStyles((color) => ({
  row: { flexDirection: 'row', gap: space.sm },
  card: {
    flex: 1, minWidth: 0, minHeight: 64, justifyContent: 'center', gap: space.xxs,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill,
  },
  day: { ...type.micro, color: color.textDim },
  main: { ...type.bodyStrong, color: color.text },
  time: { ...type.label, color: color.textDim },
}));
