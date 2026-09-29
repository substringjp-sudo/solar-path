/**
 * LayerControlModal.tsx
 *
 * 3D 시뮬레이션 뷰의 천체 및 환경 레이어(해, 달, 별, 은하수, 행성, 구름, 궤적/그림자)를
 * 각각 ON/OFF 선택하고, 도트 모드와 별의 밝기·한계등급을 조절하는 팝업 컴포넌트.
 */
import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { LayerState, SkySettings, PIXEL_ART_CHOICES } from '../SkyScene3D/SkyScene3D';
import { GenericSlider } from '../GenericSlider';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t, type Language } from '../../utils/i18n';
import { Sun, Moon, Sparkles, Star, Cloud, Navigation, X, Milestone, Tag, Building2 } from 'lucide-react-native';
import { color, radius, mono } from '../../theme/tokens';

interface LayerControlModalProps {
  visible: boolean;
  onClose: () => void;
  layers: LayerState;
  onToggleLayer: (key: keyof LayerState) => void;
  skySettings: SkySettings;
  onChangeSkySettings: (next: Partial<SkySettings>) => void;
  theme: any;
}

const MAG_MIN = 3.0;
const MAG_MAX = 6.5;
const BRIGHT_MIN = 0.2;
const BRIGHT_MAX = 2.0;

function skyQualityLabel(mag: number, L: Language): string {
  if (mag < 3.6) return t('skyQ_city', L);
  if (mag < 4.4) return t('skyQ_urban', L);
  if (mag < 5.2) return t('skyQ_suburb', L);
  if (mag < 6.0) return t('skyQ_rural', L);
  return t('skyQ_dark', L);
}
const PIX_KEY: Record<number, 'pixOff' | 'pixFine' | 'pixMid' | 'pixBold'> = { 0: 'pixOff', 256: 'pixFine', 160: 'pixMid', 96: 'pixBold' };

export const LayerControlModal: React.FC<LayerControlModalProps> = ({
  visible,
  onClose,
  layers,
  onToggleLayer,
  skySettings,
  onChangeSkySettings,
  theme,
}) => {
  const language = useCelestialStore(st => st.language);
  const isDark = theme?.isDark ?? true;
  const bgColor = theme?.card || theme?.cardBackground || theme?.background || (isDark ? '#0f172a' : '#ffffff');
  const textColor = theme?.text ?? (isDark ? '#f8fafc' : '#0f172a');
  const subTextColor = theme?.subText ?? (isDark ? '#94a3b8' : '#64748b');
  const borderColor = theme?.border ?? (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(203, 213, 225, 0.8)');

  const layerItems: { key: keyof LayerState; label: string; icon: any; iconBg: string }[] = [
    { key: 'sun', label: t('sunLabel', language), icon: <Sun size={18} color="#eab308" />, iconBg: 'rgba(234, 179, 8, 0.15)' },
    { key: 'moon', label: t('moonLabel', language), icon: <Moon size={18} color={color.accent} />, iconBg: 'rgba(56, 189, 248, 0.15)' },
    { key: 'stars', label: t('layerStars', language), icon: <Sparkles size={18} color="#a78bfa" />, iconBg: 'rgba(167, 139, 250, 0.15)' },
    { key: 'milkyway', label: t('layerMilky', language), icon: <Milestone size={18} color="#c4b5fd" />, iconBg: 'rgba(196, 181, 253, 0.15)' },
    { key: 'planets', label: t('layerPlanets', language), icon: <Star size={18} color="#f43f5e" />, iconBg: 'rgba(244, 63, 94, 0.15)' },
    { key: 'clouds', label: t('layerClouds', language), icon: <Cloud size={18} color={color.textDim} />, iconBg: 'rgba(148, 163, 184, 0.15)' },
    { key: 'cityLights', label: t('layerCity', language), icon: <Building2 size={18} color="#f59e0b" />, iconBg: 'rgba(245, 158, 11, 0.15)' },
    { key: 'paths', label: t('layerPaths', language), icon: <Navigation size={18} color="#22c55e" />, iconBg: 'rgba(34, 197, 94, 0.15)' },
  ];

  const brightnessPct = ((skySettings.starBrightness - BRIGHT_MIN) / (BRIGHT_MAX - BRIGHT_MIN)) * 100;
  const magPct = ((skySettings.starMagLimit - MAG_MIN) / (MAG_MAX - MAG_MIN)) * 100;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[
            styles.modalContainer,
            {
              backgroundColor: bgColor,
              borderColor: borderColor,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>{t('layerTitle', language)}</Text>
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' }]}>
              <X size={16} color={subTextColor} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.subTitle, { color: subTextColor }]}>
            {t('layerSubtitle', language)}
          </Text>

          {/* ON/OFF 레이어 항목 리스트 (고정 높이 내 스크롤) */}
          <View style={styles.layerListContainer}>
            <ScrollView style={styles.layerScrollList} showsVerticalScrollIndicator={true} nestedScrollEnabled={true}>
              <View style={styles.list}>
                {layerItems.map((item) => {
                  const isOn = layers[item.key];
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[
                        styles.layerRow,
                        {
                          borderColor: isOn ? '#3b82f6' : borderColor,
                          backgroundColor: isOn
                            ? (isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.08)')
                            : (isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'),
                        },
                      ]}
                      onPress={() => onToggleLayer(item.key)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.rowLeft}>
                        <View style={[styles.iconChip, { backgroundColor: item.iconBg }]}>
                          {item.icon}
                        </View>
                        <Text style={[styles.layerLabel, { color: textColor, fontWeight: isOn ? '700' : '500' }]}>
                          {item.label}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.togglePill,
                          isOn
                            ? styles.toggleOn
                            : { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)' },
                        ]}
                      >
                        <Text style={[styles.toggleText, { color: isOn ? '#ffffff' : subTextColor }]}>
                          {isOn ? 'ON' : 'OFF'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View style={[styles.divider, { backgroundColor: borderColor }]} />

          {/* 하단 고정 조절 슬라이더 영역 */}
          <View style={styles.sliderSection}>
            {/* 도트 모드(§97) — 하늘을 낮은 해상도로 그려 네모 화소 그대로 보여 줍니다. */}
            <View style={[styles.layerRow, { borderColor, backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)' }]}>
              <Text style={[styles.layerLabel, { color: textColor, fontWeight: skySettings.pixelArtRows > 0 ? '700' : '500' }]}>
                {t('dotMode', language)}
              </Text>
              <View style={styles.segment}>
                {PIXEL_ART_CHOICES.map((c) => {
                  const on = skySettings.pixelArtRows === c.rows;
                  return (
                    <TouchableOpacity
                      key={c.rows}
                      style={[
                        styles.togglePill,
                        on ? styles.toggleOn : { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)' },
                      ]}
                      onPress={() => onChangeSkySettings({ pixelArtRows: c.rows })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.toggleText, { color: on ? '#ffffff' : subTextColor }]}>{PIX_KEY[c.rows] ? t(PIX_KEY[c.rows], language) : c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.sliderBlock}>
              <View style={styles.sliderHeader}>
                <Text style={[styles.sliderLabel, { color: textColor }]}>{t('starBrightness', language)}</Text>
                <Text style={[styles.sliderValue, { color: subTextColor }]}>
                  ×{skySettings.starBrightness.toFixed(2)}
                </Text>
              </View>
              <GenericSlider
                value={Math.max(0, Math.min(100, brightnessPct))}
                onChange={(p: number) =>
                  onChangeSkySettings({
                    starBrightness: BRIGHT_MIN + (p / 100) * (BRIGHT_MAX - BRIGHT_MIN),
                  })
                }
                theme={theme}
                fillColor="#a78bfa"
                knobColor="#ede9fe"
              >
                <Text style={[styles.knobText, { color: '#1e1b4b' }]}>
                  ×{skySettings.starBrightness.toFixed(2)}
                </Text>
              </GenericSlider>
            </View>

            <View style={styles.sliderBlock}>
              <View style={styles.sliderHeader}>
                <Text style={[styles.sliderLabel, { color: textColor }]}>{t('skyHere', language)}</Text>
                <Text style={[styles.sliderValue, { color: subTextColor }]}>
                  {t('magUnit', language).replace('{m}', skySettings.starMagLimit.toFixed(1))} · {skyQualityLabel(skySettings.starMagLimit, language)}
                </Text>
              </View>
              <GenericSlider
                value={Math.max(0, Math.min(100, magPct))}
                onChange={(p: number) =>
                  onChangeSkySettings({
                    starMagLimit: MAG_MIN + (p / 100) * (MAG_MAX - MAG_MIN),
                  })
                }
                theme={theme}
                fillColor="#38bdf8"
                knobColor="#e0f2fe"
              >
                <Text style={[styles.knobText, { color: '#0c4a6e' }]}>
                  {t('magUnit', language).replace('{m}', skySettings.starMagLimit.toFixed(1))}
                </Text>
              </GenericSlider>
              <Text style={[styles.sliderHint, { color: subTextColor }]}>
                {t('skyNote', language)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: color.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
    borderRadius: radius.lg,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: radius.lg,
  },
  subTitle: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 16,
  },
  layerListContainer: {
    maxHeight: 220,
  },
  layerScrollList: {
    flexGrow: 0,
  },
  list: {
    gap: 8,
    paddingRight: 4,
  },
  sliderSection: {
    gap: 4,
  },
  layerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  layerLabel: {
    fontSize: 13,
  },
  segment: {
    flexDirection: 'row',
    gap: 4,
  },
  togglePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.md,
  },
  toggleOn: {
    backgroundColor: '#3b82f6',
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    marginTop: 18,
    marginBottom: 12,
    opacity: 0.6,
  },
  sliderBlock: {
    marginTop: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  sliderValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  sliderHint: {
    fontSize: 11,
    marginTop: 4,
    lineHeight: 15,
  },
  knobText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
