import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

import { Theme, PressureLevelCloud } from '../../types/simulation';
import { CloudPathData, classifyClouds } from '../../utils/weather';

interface CloudGridProps {
  weatherData: CloudPathData[];
  time: Date;
  theme: Theme;
}

const getGenusLabel = (genus: string): string => {
  switch (genus) {
    case 'cirrus': return 'Ci';
    case 'cirrostratus': return 'Cs';
    case 'cumulonimbus': return 'Cb';
    case 'altostratus': return 'As';
    case 'altocumulus': return 'Ac';
    case 'stratocumulus': return 'Sc';
    case 'stratus': return 'St';
    case 'cumulus': return 'Cu';
    default: return 'CLR';
  }
};

export const CloudGrid: React.FC<CloudGridProps> = ({ 
  weatherData, 
  time, 
  theme 
}) => {
  const timeMs = time.getTime();

  // Filter 2D grid down to the 4 distances along the central sun path (azimuthOffset === 0)
  const centerData = weatherData.filter(p => {
    const offset = (p as any).azimuthOffset;
    return offset === undefined || offset === 0;
  });

  const displayData = centerData.length > 0 ? centerData : weatherData.slice(0, 4);

  return (
    <View style={styles.cloudGridCard}>
      {displayData.slice(0, 4).map((data, i) => {
        // Find nearest hourly index
        const times = data.hourly.timeMs;
        let idx = times.findIndex(t => t > timeMs);
        if (idx === -1) idx = times.length - 1;
        else if (idx > 0) {
          if (timeMs - times[idx-1] < times[idx] - timeMs) idx = idx - 1;
        }

        const pLevels = [1000, 925, 850, 700, 500, 300, 200];
        
        // Construct interpolated level properties to run classifier
        const currentLevels: PressureLevelCloud[] = pLevels.map(press => {
          const levels = data.hourly.pressureLevels;
          const cc = (levels && levels[`cloud_cover_${press}hPa`]?.[idx]) || 0;
          const temp = (levels && levels[`temperature_${press}hPa`]?.[idx]) || 0;
          const rh = (levels && levels[`relative_humidity_${press}hPa`]?.[idx]) || 0;
          
          // Fallbacks for heights if missing
          const standardHeightMap: Record<number, number> = {
            1000: 100, 925: 750, 850: 1500, 700: 3000, 500: 5500, 300: 9000, 200: 12000
          };
          const gh = (levels && levels[`geopotential_height_${press}hPa`]?.[idx]) || standardHeightMap[press];

          return {
            pressure: press,
            altitudeKm: gh / 1000,
            cloudCover: cc,
            humidity: rh,
            temperature: temp,
          };
        });

        const classified = classifyClouds(currentLevels);
        
        // Find the dominant cloud genus (biggest coverage * thickness)
        const dominant = classified
          .filter(c => c.genus !== 'clear')
          .sort((a, b) => (b.coverage * b.opticalThickness) - (a.coverage * a.opticalThickness))[0];
        
        const cloudLabel = dominant ? getGenusLabel(dominant.genus) : 'CLR';

        return (
          <View key={i} style={[styles.gridItem, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <Text style={[styles.gridDist, { color: theme.subText }]}>
              {data.distance === 0 ? 'LOC' : `${data.distance}k`}
            </Text>
            
            {/* 7-level vertical pressure profile */}
            <View style={styles.verticalProfile}>
              {currentLevels.map((lvl, pIdx) => {
                const cov = lvl.cloudCover;
                const opacity = cov / 100;
                // Color levels by height: red/pink for high (ice), yellow for mid, blue for low
                const barColor = lvl.pressure <= 300 ? '#FF7E67' : lvl.pressure <= 700 ? '#FCD12A' : '#5CA4FF';
                
                return (
                  <View 
                    key={pIdx} 
                    style={[
                      styles.profileCell, 
                      { 
                        backgroundColor: cov > 15 ? barColor : 'rgba(255,255,255,0.02)',
                        opacity: cov > 15 ? Math.max(0.25, opacity) : 0.2,
                        borderColor: cov > 15 ? 'rgba(255,255,255,0.1)' : 'transparent',
                      }
                    ]} 
                  />
                );
              })}
            </View>

            <Text style={[styles.cloudLabel, { color: dominant ? theme.accent : theme.subText }]}>
              {cloudLabel}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  cloudGridCard: { 
    flex: 1.8, 
    flexDirection: 'row', 
    gap: 6,
  },
  gridItem: { 
    flex: 1, 
    borderRadius: 16, 
    borderWidth: 1, 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  gridDist: { 
    fontSize: 9, 
    fontWeight: '900', 
    marginBottom: 4, 
    opacity: 0.5 
  },
  verticalProfile: {
    flexDirection: 'column-reverse', // 1000hPa is bottom, 200hPa is top
    gap: 3,
    height: 60,
    width: 14,
    justifyContent: 'center',
    marginVertical: 4,
  },
  profileCell: {
    flex: 1,
    borderRadius: 2,
    borderWidth: 0.5,
  },
  cloudLabel: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
});
