/**
 * LayerControlModal.tsx
 *
 * 3D 시뮬레이션 뷰의 천체 및 환경 레이어(해, 달, 별, 은하수, 행성, 구름, 궤적/그림자)를
 * 각각 ON/OFF 선택하고, 도트 모드와 별의 밝기·한계등급을 조절하는 팝업 컴포넌트.
 */
import React from 'react';
import { StyleSheet, View, Text, Modal, ScrollView } from 'react-native';
import { LayerState, SkySettings, PIXEL_ART_CHOICES } from '../SkyScene3D/SkyScene3D';
import { GenericSlider } from '../GenericSlider';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t, type Language } from '../../utils/i18n';
import { Sun, Moon, Sparkles, Star, Cloud, Navigation, X, Milestone, Tag, Building2 } from 'lucide-react-native';
import { color, radius, mono, tint, dataColor } from '../../theme/tokens';
import { PressScale } from '../ui';

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
  const bgColor = theme?.card || theme?.cardBackground || theme?.background || (isDark ? color.panel : color.text);
  const textColor = theme?.text ?? (isDark ? color.text : color.panel);
  const subTextColor = theme?.subText ?? (isDark ? color.textDim : color.textMute);
  const borderColor = theme?.border ?? (isDark ? color.border : 'rgba(203, 213, 225, 0.8)');

  const layerItems: { key: keyof LayerState; label: string; icon: any; iconBg: string }[] = [
    { key: 'sun', label: t('sunLabel', language), icon: <Sun size={18} color={color.sun} />, iconBg: tint(color.sun) },
    { key: 'moon', label: t('moonLabel', language), icon: <Moon size={18} color={color.moon} />, iconBg: tint(color.moon) },
    { key: 'stars', label: t('layerStars', language), icon: <Sparkles size={18} color={dataColor.stars} />, iconBg: tint(dataColor.stars) },
    { key: 'milkyway', label: t('layerMilky', language), icon: <Milestone size={18} color={dataColor.milkyway} />, iconBg: tint(dataColor.milkyway) },
    { key: 'planets', label: t('layerPlanets', language), icon: <Star size={18} color={dataColor.planets} />, iconBg: tint(dataColor.planets) },
    { key: 'clouds', label: t('layerClouds', language), icon: <Cloud size={18} color={color.cloud} />, iconBg: tint(color.cloud) },
    { key: 'cityLights', label: t('layerCity', language), icon: <Building2 size={18} color={dataColor.cityLights} />, iconBg: tint(dataColor.cityLights) },
    { key: 'paths', label: t('layerPaths', language), icon: <Navigation size={18} color={dataColor.paths} />, iconBg: tint(dataColor.paths) },
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
      <PressScale
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <PressScale
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
            <PressScale onPress={onClose} style={[styles.closeBtn, { backgroundColor: isDark ? color.border : 'rgba(0, 0, 0, 0.05)' }]}>
              <X size={16} color={subTextColor} />
            </PressScale>
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
                    <PressScale
                      key={item.key}
                      style={[
                        styles.layerRow,
                        {
                          borderColor: isOn ? color.accentLine : borderColor,
                          backgroundColor: isOn
                            ? color.accentSoft
                            : (isDark ? color.fill : 'rgba(0, 0, 0, 0.02)'),
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
                            : { backgroundColor: isDark ? color.border : 'rgba(0, 0, 0, 0.08)' },
                        ]}
                      >
                        <Text style={[styles.toggleText, { color: isOn ? color.onAccent : subTextColor }]}>
                          {isOn ? 'ON' : 'OFF'}
                        </Text>
                      </View>
                    </PressScale>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View style={[styles.divider, { backgroundColor: borderColor }]} />

          {/* 하단 고정 조절 슬라이더 영역 */}
          <View style={styles.sliderSection}>
            {/* 도트 모드(§97) — 하늘을 낮은 해상도로 그려 네모 화소 그대로 보여 줍니다. */}
            <View style={[styles.layerRow, { borderColor, backgroundColor: isDark ? color.fill : 'rgba(0, 0, 0, 0.02)' }]}>
              <Text style={[styles.layerLabel, { color: textColor, fontWeight: skySettings.pixelArtRows > 0 ? '700' : '500' }]}>
                {t('dotMode', language)}
              </Text>
              <View style={styles.segment}>
                {PIXEL_ART_CHOICES.map((c) => {
                  const on = skySettings.pixelArtRows === c.rows;
                  return (
                    <PressScale
                      key={c.rows}
                      style={[
                        styles.togglePill,
                        on ? styles.toggleOn : { backgroundColor: isDark ? color.border : 'rgba(0, 0, 0, 0.08)' },
                      ]}
                      onPress={() => onChangeSkySettings({ pixelArtRows: c.rows })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.toggleText, { color: on ? color.text : subTextColor }]}>{PIX_KEY[c.rows] ? t(PIX_KEY[c.rows], language) : c.label}</Text>
                    </PressScale>
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
                fillColor={dataColor.stars}
                knobColor={color.panelRaised}
              >
                <Text style={[styles.knobText, { color: dataColor.stars }]}>
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
                fillColor={color.accent}
                knobColor={color.panelRaised}
              >
                <Text style={[styles.knobText, { color: color.accent }]}>
                  {t('magUnit', language).replace('{m}', skySettings.starMagLimit.toFixed(1))}
                </Text>
              </GenericSlider>
              <Text style={[styles.sliderHint, { color: subTextColor }]}>
                {t('skyNote', language)}
              </Text>
            </View>
          </View>
        </PressScale>
      </PressScale>
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
    backgroundColor: color.accent,
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
