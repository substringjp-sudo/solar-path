import React from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { color, radius, mono } from '../theme/tokens';
import { makeStyles } from '../theme/useTheme';

interface InfoCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  theme: any;
}

export const InfoCard: React.FC<InfoCardProps> = ({ icon, label, value, subValue, theme }) => {
  const styles = useStyles();
  const { width } = Dimensions.get('window');
  return (
    <View style={[styles.card, { width: width * 0.3 }]}>
      <View style={[styles.iconContainer, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        {icon}
      </View>
      <View style={styles.content}>
        <Text style={[styles.label, { color: theme.subText }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.value, { color: theme.text }]}>{value}</Text>
        {subValue && <Text style={[styles.subValue, { color: theme.subText }]}>{subValue}</Text>}
      </View>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  card: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: radius.xs,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 1,
    fontFamily: mono,
  },
  value: {
    fontSize: 13,
    fontWeight: '900',
    fontFamily: mono,
  },
  subValue: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
    fontFamily: mono,
  },
}));
