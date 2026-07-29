/**
 * EventRecommendBar.tsx
 * 
 * 추천(Recommended) 및 일반(General) 천문 이벤트를 가로 카루셀/칩 형태로 보여주는 컴포넌트.
 * 터치 시 해당 이벤트 발생 시각으로 시뮬레이션 시각을 이동시킵니다.
 */
import React from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { CelestialEventItem } from '../../utils/celestialEvents';
import { Sparkles, Sun, Sunset, Sunrise, Moon, Star } from 'lucide-react-native';

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

  const renderIcon = (type: CelestialEventItem['type']) => {
    switch (type) {
      case 'sunset':
        return <Sunset size={14} color="#f97316" />;
      case 'sunrise':
        return <Sunrise size={14} color="#fbbf24" />;
      case 'crescent_moon':
      case 'moonrise':
      case 'moonset':
        return <Moon size={14} color="#38bdf8" />;
      case 'milky_way':
        return <Sparkles size={14} color="#a78bfa" />;
      case 'planet':
        return <Star size={14} color="#f43f5e" />;
      default:
        return <Sun size={14} color="#eab308" />;
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {events.map((evt) => {
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
                  <Sparkles size={10} color="#fff" />
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
    marginVertical: 6,
  },
  scrollContent: {
    paddingHorizontal: 2,
    gap: 8,
  },
  card: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 120,
    justifyContent: 'center',
  },
  recommendedCard: {
    borderColor: 'rgba(168, 85, 247, 0.6)',
    backgroundColor: 'rgba(147, 51, 234, 0.15)',
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#9333ea',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 10,
    marginTop: 2,
    opacity: 0.8,
  },
});
