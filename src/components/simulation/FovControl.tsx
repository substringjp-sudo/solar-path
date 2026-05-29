import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Maximize } from 'lucide-react-native';
import { GenericSlider } from '../GenericSlider';
import { Theme } from '../../types/simulation';

interface FovControlProps {
  fov: number;
  onFovChange: (fov: number) => void;
  theme: Theme;
}

export const FovControl: React.FC<FovControlProps> = ({ 
  fov, 
  onFovChange, 
  theme 
}) => {
  return (
    <View style={[styles.zoomControl, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      <View style={styles.zoomHeader}>
        <View style={styles.zoomTitleRow}>
          <Maximize size={14} color={theme.accent} />
          <Text style={[styles.zoomTitle, { color: theme.text }]}>FIELD OF VIEW</Text>
        </View>
        <Text style={[styles.zoomValue, { color: theme.accent }]}>{Math.round(fov)}°</Text>
      </View>
      <View style={styles.zoomSliderWrapper}>
        <GenericSlider 
          value={((fov - 10) / 90) * 100} 
          onChange={(pct) => onFovChange(10 + (pct / 100) * 90)} 
          theme={theme}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  zoomControl: { 
    paddingVertical: 16, 
    paddingHorizontal: 20, 
    borderRadius: 32, 
    borderWidth: 1,
  },
  zoomHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 14 
  },
  zoomTitleRow: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  zoomTitle: { 
    fontSize: 10, 
    fontWeight: '900', 
    marginLeft: 8, 
    letterSpacing: 1.2 
  },
  zoomValue: { 
    fontSize: 16, 
    fontWeight: '900' 
  },
  zoomSliderWrapper: { 
    height: 28, 
    justifyContent: 'center' 
  },
});
