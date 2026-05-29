import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, Linking, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Info, ExternalLink } from 'lucide-react-native';
import { FactorBar } from './FactorBar';
import { qualityColor } from './utils';
import { SunsetPrediction } from '../../utils/sunsetPhysics';

interface SimulationModalsProps {
  showPredictInfo: boolean;
  setShowPredictInfo: (show: boolean) => void;
  showSources: boolean;
  setShowSources: (show: boolean) => void;
  prediction: SunsetPrediction | null;
  weatherSource?: string;
  theme: any;
}

export const SimulationModals: React.FC<SimulationModalsProps> = ({
  showPredictInfo,
  setShowPredictInfo,
  showSources,
  setShowSources,
  prediction,
  weatherSource,
  theme
}) => {
  return (
    <>
      <Modal
        visible={showPredictInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPredictInfo(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.bg, borderColor: theme.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Sunset Quality Detail</Text>
              <TouchableOpacity onPress={() => setShowPredictInfo(false)}>
                <Text style={[styles.closeText, { color: theme.accent }]}>닫기</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sourceList}>
              <FactorBar label="Rayleigh Scattering (Vibrancy)" value={prediction?.factors.beamRedness || 0} color={qualityColor(prediction?.quality || '')} theme={theme} />
              <FactorBar label="Lower Atmosphere Clarity" value={prediction?.factors.pathClarity || 0} color="#4682B4" theme={theme} />
              <FactorBar label="Aerosol Glow Index" value={prediction?.factors.overheadGlow || 0} color="#FFD700" theme={theme} />
              <FactorBar label="Cloud Coverage (Inverted)" value={1 - (prediction?.factors.overheadOvercast || 0)} color="#8E8E93" theme={theme} />
              <FactorBar label="Precipitation Risk" value={1 - (prediction?.factors.aerosolBeta || 0)} color="#FF4D4D" theme={theme} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSources}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSources(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={theme.bg === '#08080C' ? 'dark' : 'light'} style={[styles.modalContent, { borderColor: theme.border, backgroundColor: theme.glass }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>데이터 출처 정보</Text>
              <TouchableOpacity onPress={() => setShowSources(false)}>
                <Text style={[styles.closeText, { color: theme.accent }]}>닫기</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sourceList}>
              <View style={styles.sourceSection}>
                <Text style={[styles.sourceCategory, { color: theme.accent }]}>GEOSPATIAL</Text>
                <TouchableOpacity 
                  style={[styles.sourceItem, { backgroundColor: theme.glass, borderColor: theme.border }]}
                  onPress={() => Linking.openURL('https://open-meteo.com/en/docs/elevation-api')}
                >
                  <View style={styles.sourceContent}>
                    <Text style={[styles.sourceLabel, { color: theme.text }]}>지형 고도 (DEM)</Text>
                    <Text style={[styles.sourceDesc, { color: theme.subText }]}>Open-Meteo Elevation API</Text>
                  </View>
                  <ExternalLink size={14} color={theme.subText} />
                </TouchableOpacity>
              </View>

              <View style={styles.sourceSection}>
                <Text style={[styles.sourceCategory, { color: theme.accent }]}>METEOROLOGY</Text>
                <TouchableOpacity 
                  style={[styles.sourceItem, { backgroundColor: theme.glass, borderColor: theme.border }]}
                  onPress={() => Linking.openURL('https://open-meteo.com/')}
                >
                  <View style={styles.sourceContent}>
                    <Text style={[styles.sourceLabel, { color: theme.text }]}>기상 및 구름 예측</Text>
                    <Text style={[styles.sourceDesc, { color: theme.subText }]}>
                      {weatherSource === 'ultra-short' ? '기상청(KMA) 초단기예보 API' : 'Open-Meteo Weather API'}
                    </Text>
                  </View>
                  <ExternalLink size={14} color={theme.subText} />
                </TouchableOpacity>
              </View>

              <View style={styles.sourceSection}>
                <Text style={[styles.sourceCategory, { color: theme.accent }]}>ASTRONOMY</Text>
                <View style={[styles.sourceItemNonClickable, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.sourceContent}>
                    <Text style={[styles.sourceLabel, { color: theme.text }]}>태양 궤적 및 방위각</Text>
                    <Text style={[styles.sourceDesc, { color: theme.subText }]}>SunCalc Library</Text>
                  </View>
                </View>
              </View>
            </View>
            <Text style={[styles.attribution, { color: theme.subText }]}>Sunset trajectory and meteorological modeling based on open-source datasets.</Text>
          </BlurView>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', borderRadius: 32, borderWidth: 1, padding: 24, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  closeText: { fontSize: 15, fontWeight: '700' },
  sourceList: { gap: 12 },
  sourceSection: { marginBottom: 16 },
  sourceCategory: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginBottom: 10, opacity: 0.6 },
  sourceItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  sourceItemNonClickable: { padding: 16, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  sourceContent: { flex: 1 },
  sourceLabel: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  sourceDesc: { fontSize: 12, opacity: 0.5 },
  attribution: { fontSize: 11, textAlign: 'center', opacity: 0.4, marginTop: 24, fontStyle: 'italic' },
});
