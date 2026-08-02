/**
 * EventRecommendBar.tsx
 * 
 * 2D 태양 시뮬레이터 전용 이벤트 추천 바.
 * 태양 관련 이벤트(일출, 일몰)만 콤팩트하고 슬림하게 노출하여 타임라인 레이아웃이 화면 밖으로 넘치지 않게 합니다.
 */
import React from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { CelestialEventItem } from '../../utils/celestialEvents';
import { Sparkles, Sun, Sunset, Sunrise } from 'lucide-react-native';

interface EventRecommendBarProps {
  events: CelestialEventItem[];
  currentTime: Date;
  onSelectEvent: (time: Date) => void;
  theme: any;
}

export const EventRecommendBar: React.FC<EventRecommendBarProps> = ({
  events,
  currentTime,
  onSelectEvent,
  theme,
}) => {
  if (!events || events.length === 0) return null;

  // 2D 태양 시뮬레이터는 태양 관련 이벤트 (일출, 일몰)만 필터링하여 표시
  const solarEvents = events.filter(evt => evt.type === 'sunrise' || evt.type === 'sunset');
  const displayEvents = solarEvents.length > 0 ? solarEvents : events.slice(0, 2);

  const renderIcon = (type: CelestialEventItem['type']) => {
    switch (type) {
      case 'sunset':
        return <Sunset size={12} color="#f97316" />;
      case 'sunrise':
        return <Sunrise size={12} color="#fbbf24" />;
      default:
        return <Sun size={12} color="#eab308" />;
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {displayEvents.map((evt) => {
          const isRecommended = evt.category === 'recommended';
          const isSelected = Math.abs(evt.time.getTime() - currentTime.getTime()) < 10 * 60 * 1000;

          return (
            <TouchableOpacity
              key={evt.id}
              style={[
                styles.card,
                { backgroundColor: theme.glass, borderColor: theme.border },
                isRecommended && styles.recommendedCard,
                isSelected && { borderColor: theme.accent, backgroundColor: 'rgba(59, 130, 246, 0.25)' },
              ]}
              onPress={() => onSelectEvent(evt.time)}
              activeOpacity={0.75}
            >
              {isRecommended && (
                <View style={styles.recommendedBadge}>
                  <Sparkles size={8} color="#fff" />
                  <Text style={styles.badgeText}>{evt.badge || '추천'}</Text>
                </View>
              )}
              <View style={styles.cardHeader}>
                {renderIcon(evt.type)}
                <Text style={[styles.title, { color: theme.text }]}>{evt.title}</Text>
              </View>
              <Text style={[styles.subtitle, { color: theme.subText }]}>{evt.subtitle}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 2,
  },
  scrollContent: {
    paddingHorizontal: 2,
    gap: 6,
  },
  card: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 95,
    justifyContent: 'center',
  },
  recommendedCard: {
    borderColor: 'rgba(249, 115, 22, 0.5)',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f97316',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 2,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#fff',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 9,
    marginTop: 1,
    opacity: 0.85,
  },
});
