/**
 * LayerControlModal.tsx
 *
 * 3D 시뮬레이션 뷰의 천체 및 환경 레이어(해, 달, 별, 은하수, 행성, 구름, 궤적/그림자)를
 * 각각 ON/OFF 선택하고, 도트 모드와 별의 밝기·한계등급을 조절하는 팝업 컴포넌트.
 */
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Modal, ScrollView, Alert } from 'react-native';
import { LayerState, SkySettings } from '../SkyScene3D/SkyScene3D';
import type { FarStatus } from '../SkyScreen/SandboxPanel';
import { GenericSlider } from '../GenericSlider';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t, L3, type Language } from '../../utils/i18n';
import { estimateLightPollution } from '../../utils/cityLightMap';
import { getCachedNightLights, loadNightLights } from '../../utils/nightLightsAsset';
import { Sun, Moon, Sparkles, Star, Cloud, Navigation, X, Milestone, Building, Building2, Info } from 'lucide-react-native';
import { color as DARK, dataColor as DARK_DATA, radius, mono, tint } from '../../theme/tokens';
import { PressScale } from '../ui';
import { OVERLAY_THEME } from '../../theme/useTheme';

interface LayerControlModalProps {
  visible: boolean;
  onClose: () => void;
  layers: LayerState;
  onToggleLayer: (key: keyof LayerState) => void;
  skySettings: SkySettings;
  onChangeSkySettings: (next: Partial<SkySettings>) => void;
  far?: { status: FarStatus | null; onLoad: () => void };
  theme: any;
}

const fmtMB = (b: number) => `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB`;

const BRIGHT_MIN = 0.2;
const BRIGHT_MAX = 2.0;
/** 샌드박스 수동 노출(EV) 슬라이더 범위 — 해 30° 맑은 하늘 기준 0, 밤(약 +10 EV)까지. */
const EXPO_EV_MIN = -4;
const EXPO_EV_MAX = 12;

function skyQualityLabel(mag: number, L: Language): string {
  if (mag < 3.6) return t('skyQ_city', L);
  if (mag < 4.4) return t('skyQ_urban', L);
  if (mag < 5.2) return t('skyQ_suburb', L);
  if (mag < 6.0) return t('skyQ_rural', L);
  return t('skyQ_dark', L);
}

export const LayerControlModal: React.FC<LayerControlModalProps> = ({
  visible,
  onClose,
  layers,
  onToggleLayer,
  skySettings,
  onChangeSkySettings,
  far,
}) => {
  const language = useCelestialStore(st => st.language);
  const expertMode = useCelestialStore(st => st.expertMode);
  const location = useCelestialStore(st => st.location);
  const [detectedMag, setDetectedMag] = useState<number | null>(() => {
    const m = getCachedNightLights();
    if (!m || !location) return null;
    return estimateLightPollution(m, location.coords.latitude, location.coords.longitude).magLimit;
  });

  useEffect(() => {
    if (!visible || !location) return;
    const lat = location.coords.latitude;
    const lon = location.coords.longitude;
    const cached = getCachedNightLights();
    if (cached) {
      setDetectedMag(estimateLightPollution(cached, lat, lon).magLimit);
      return;
    }
    let alive = true;
    loadNightLights().then((m) => {
      if (!alive || !m) return;
      setDetectedMag(estimateLightPollution(m, lat, lon).magLimit);
    });
    return () => { alive = false; };
  }, [visible, location?.coords.latitude, location?.coords.longitude]);

  const layerItems: { key: keyof LayerState; label: string; icon: any; iconBg: string }[] = [
    { key: 'sun', label: t('sunLabel', language), icon: <Sun size={16} color={DARK.sun} />, iconBg: tint(DARK.sun, 0.14) },
    { key: 'moon', label: t('moonLabel', language), icon: <Moon size={16} color={DARK.moon} />, iconBg: tint(DARK.moon, 0.14) },
    { key: 'stars', label: t('layerStars', language), icon: <Sparkles size={16} color={DARK_DATA.stars} />, iconBg: tint(DARK_DATA.stars, 0.14) },
    { key: 'milkyway', label: t('layerMilky', language), icon: <Milestone size={16} color={DARK_DATA.milkyway} />, iconBg: tint(DARK_DATA.milkyway, 0.14) },
    { key: 'planets', label: t('layerPlanets', language), icon: <Star size={16} color={DARK_DATA.planets} />, iconBg: tint(DARK_DATA.planets, 0.14) },
    { key: 'clouds', label: t('layerClouds', language), icon: <Cloud size={16} color={DARK.cloud} />, iconBg: tint(DARK.cloud, 0.14) },
    { key: 'cityLights', label: t('layerCity', language), icon: <Building2 size={16} color={DARK_DATA.cityLights} />, iconBg: tint(DARK_DATA.cityLights, 0.14) },
    { key: 'buildings', label: t('layerBuildings', language), icon: <Building size={16} color={DARK_DATA.qOvercast} />, iconBg: tint(DARK_DATA.qOvercast, 0.14) },
    { key: 'paths', label: t('layerPaths', language), icon: <Navigation size={16} color={DARK_DATA.paths} />, iconBg: tint(DARK_DATA.paths, 0.14) },
  ];

  const brightnessPct = ((skySettings.starBrightness - BRIGHT_MIN) / (BRIGHT_MAX - BRIGHT_MIN)) * 100;

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
          style={styles.modalContainer}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('layerTitle', language)}</Text>
            <PressScale onPress={onClose} style={styles.closeBtn}>
              <X size={16} color={DARK.text} />
            </PressScale>
          </View>
          <Text style={styles.subTitle}>
            {t('layerSubtitle', language)}
          </Text>

          {/* ON/OFF 레이어 항목 리스트 (고정 높이 내 스크롤) */}
          <View style={styles.layerListContainer}>
            <ScrollView style={styles.layerScrollList} showsVerticalScrollIndicator={true} nestedScrollEnabled={true}>
              <View style={styles.list}>
                {layerItems.map((item) => {
                  const isOn = layers[item.key];
                  return (
                    <React.Fragment key={item.key}>
                      <PressScale
                        style={[
                          styles.layerRow,
                          {
                            borderColor: isOn ? DARK.accentLine : DARK.border,
                            backgroundColor: isOn ? DARK.accentSoft : DARK.fill,
                          },
                        ]}
                        onPress={() => onToggleLayer(item.key)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.rowLeft}>
                          <View style={[styles.iconChip, { backgroundColor: item.iconBg }]}>
                            {item.icon}
                          </View>
                          <Text style={[styles.layerLabel, { fontWeight: isOn ? '700' : '500' }]}>
                            {item.label}
                          </Text>
                          {item.key === 'buildings' && (
                            <PressScale
                              onPress={(e) => {
                                e.stopPropagation?.();
                                Alert.alert(
                                  item.label,
                                  L3(
                                    language,
                                    '대략적인 건물 분포를 확인하기 위한 참고용 기능입니다. 주요 건물 위주로 표시될 수 있으며, 실제 건물의 형태·높이와는 다를 수 있습니다.',
                                    'This is a reference view for approximate building distribution. Only major buildings may appear, and shapes or heights may differ from reality.',
                                    'おおよその建物分布を確認するための参考表示です。主要な建物のみ表示される場合があり、実際の建物の形や高さとは異なることがあります。',
                                  ),
                                );
                              }}
                              hitSlop={8}
                              style={{ marginLeft: 4, padding: 2 }}
                            >
                              <Info size={14} color={DARK.textDim} />
                            </PressScale>
                          )}
                        </View>
                        <View
                          style={[
                            styles.togglePill,
                            isOn ? styles.toggleOn : styles.toggleOff,
                          ]}
                        >
                          <Text style={[styles.toggleText, { color: isOn ? DARK.onAccent : DARK.textDim }]}>
                            {isOn ? 'ON' : 'OFF'}
                          </Text>
                        </View>
                      </PressScale>
                      {item.key === 'buildings' && expertMode && far && (
                        <View style={styles.farCard}>
                          <View style={styles.farTopRow}>
                            <Text style={styles.farTitle}>
                              {L3(language, '먼 건물 (1~30 km)', 'Far buildings (1–30 km)', '遠くの建物 (1〜30 km)')}
                            </Text>
                            <PressScale
                              onPress={far.status?.state === 'loading' ? undefined : far.onLoad}
                              activeOpacity={0.7}
                              style={[
                                styles.farBtn,
                                {
                                  backgroundColor: far.status?.state === 'loading' ? DARK.fill : DARK.accent,
                                },
                              ]}
                            >
                              <Text style={[styles.farBtnText, { color: far.status?.state === 'loading' ? DARK.textDim : DARK.onAccent }]}>
                                {far.status?.state === 'loading'
                                  ? L3(language, '받는 중…', 'Loading…', '読込中…')
                                  : far.status?.state === 'done'
                                    ? (far.status.truncated
                                      ? L3(language, '더 불러오기', 'Load more', 'さらに読む')
                                      : L3(language, '다시 받기', 'Reload', '再読込'))
                                    : L3(language, '보는 방향 불러오기', 'Load view', '視線方向を読む')}
                              </Text>
                            </PressScale>
                          </View>
                          <Text style={styles.farStatus} numberOfLines={2}>
                            {far.status?.state === 'loading' && `${far.status.tilesDone}/${far.status.tilesTotal}${L3(language, '장', ' tiles', '枚')} · ${fmtMB(far.status.bytes)}`}
                            {far.status?.state === 'done' && `${L3(language, '건물', 'Buildings', '建物')} ${far.status.buildings ?? 0}${L3(language, '채', '', '棟')} · ${fmtMB(far.status.bytes)}${far.status.truncated ? ` · ${L3(language, '한도에서 멈춤 (다시 누르면 이어 받아요)', 'paused at limit (tap again to continue)', '上限で停止（もう一度押すと続きを読みます）')}` : ''}${far.status.failed ? ` · ${L3(language, `실패 ${far.status.failed}장`, `${far.status.failed} failed`, `失敗${far.status.failed}枚`)}` : ''}`}
                            {far.status?.state === 'off' && L3(language, '지형을 아직 못 받았어요', 'Terrain is not loaded yet', '地形をまだ受信していません')}
                            {far.status?.state === 'error' && L3(language, '받지 못했어요', 'Could not load', '読み込めませんでした')}
                            {!far.status && L3(language, '샌드박스 전용 · 현재 보는 방향의 먼 랜드마크를 불러옵니다', 'Sandbox only · loads distant landmarks in the current view direction', 'サンドボックス専用・現在の視線方向の遠いランドマークを読み込みます')}
                          </Text>
                        </View>
                      )}
                    </React.Fragment>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View style={styles.divider} />

          {/* 하단 고정 조절 슬라이더 영역 */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderBlock}>
              <View style={styles.sliderHeader}>
                <Text style={styles.sliderLabel}>{t('starBrightness', language)}</Text>
                <Text style={styles.sliderValue}>
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
                theme={OVERLAY_THEME}
                fillColor={DARK.accent}
                knobColor={DARK.panelRaised}
              >
                <Text style={styles.knobText}>
                  ×{skySettings.starBrightness.toFixed(2)}
                </Text>
              </GenericSlider>
            </View>

            {expertMode && (
              <View style={styles.sliderBlock}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.sliderLabel}>{language === 'ko' ? '샌드박스 노출' : 'Sandbox exposure'}</Text>
                  <Text style={styles.sliderValue}>
                    {(skySettings.sandboxExposureEv ?? 0) >= 0 ? '+' : ''}{(skySettings.sandboxExposureEv ?? 0).toFixed(1)} EV
                  </Text>
                </View>
                <GenericSlider
                  value={Math.max(0, Math.min(100, (((skySettings.sandboxExposureEv ?? 0) - EXPO_EV_MIN) / (EXPO_EV_MAX - EXPO_EV_MIN)) * 100))}
                  onChange={(p: number) =>
                    onChangeSkySettings({
                      sandboxExposureEv: Math.round((EXPO_EV_MIN + (p / 100) * (EXPO_EV_MAX - EXPO_EV_MIN)) * 2) / 2,
                    })
                  }
                  theme={OVERLAY_THEME}
                  fillColor={DARK.accent}
                  knobColor={DARK.panelRaised}
                >
                  <Text style={styles.knobText}>
                    {(skySettings.sandboxExposureEv ?? 0) >= 0 ? '+' : ''}{(skySettings.sandboxExposureEv ?? 0).toFixed(1)}
                  </Text>
                </GenericSlider>
                <Text style={styles.sliderHint}>
                  {language === 'ko'
                    ? '샌드박스는 자동 노출 없이 고정 노출입니다. 0 = 해 30° 맑은 낮 기준, 밤에는 +8 ~ +10 정도.'
                    : 'Sandbox uses a fixed exposure (no auto). 0 = clear daylight at 30° sun; around +8 to +10 at night.'}
                </Text>
              </View>
            )}

            <View style={styles.sliderBlock}>
              <View style={[styles.sliderHeader, { marginBottom: 4 }]}>
                <Text style={styles.sliderLabel}>{t('skyHere', language)}</Text>
                <Text style={[styles.sliderValue, { color: DARK.accent }]}>
                  {detectedMag != null
                    ? `${t('magUnit', language).replace('{m}', detectedMag.toFixed(1))} · ${skyQualityLabel(detectedMag, language)}`
                    : '—'}
                </Text>
              </View>
              <Text style={styles.sliderHint}>
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
    backgroundColor: DARK.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
    backgroundColor: DARK.panel,
    borderColor: DARK.borderStrong,
    borderRadius: radius.lg,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 14,
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
    color: DARK.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: DARK.fill,
    borderWidth: 1,
    borderColor: DARK.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subTitle: {
    fontSize: 12,
    color: DARK.textDim,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 16,
  },
  layerListContainer: {
    maxHeight: 224,
  },
  layerScrollList: {
    flexGrow: 0,
  },
  list: {
    gap: 8,
    paddingRight: 4,
  },
  sliderSection: {
    gap: 6,
  },
  layerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: DARK.border,
    backgroundColor: DARK.fill,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  layerLabel: {
    fontSize: 13,
    color: DARK.text,
  },
  segment: {
    flexDirection: 'row',
    gap: 4,
  },
  segmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  togglePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  toggleOn: {
    backgroundColor: DARK.accent,
  },
  toggleOff: {
    backgroundColor: DARK.fill,
    borderWidth: 1,
    borderColor: DARK.border,
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
  },
  divider: {
    height: 1,
    backgroundColor: DARK.border,
    marginTop: 14,
    marginBottom: 12,
  },
  sliderBlock: {
    marginTop: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: DARK.text,
  },
  sliderValue: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: mono,
    color: DARK.textDim,
  },
  sliderHint: {
    fontSize: 11,
    color: DARK.textDim,
    marginTop: 4,
    lineHeight: 15,
  },
  knobText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: -0.2,
    color: DARK.accent,
  },
  farCard: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: DARK.border,
    backgroundColor: DARK.fill,
    gap: 6,
  },
  farTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  farTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: DARK.text,
  },
  farBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  farBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  farStatus: {
    fontSize: 11,
    lineHeight: 15,
    color: DARK.textDim,
  },
});
