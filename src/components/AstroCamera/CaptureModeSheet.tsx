/**
 * CaptureModeSheet.tsx — **촬영 모드 고르기**(docs/SANDBOX_MODE_PLAN.md 10.3, 목업 16). 카메라 위로 올라오는 어두운 시트입니다.
 *
 * 맨 위 "지금 권하는 것" 카드 하나(권하는 이유 포함), 아래로 일반 · 천체 장노출 · 타임랩스 · 이벤트. 줄마다 결과물 종류를 적습니다.
 * 지금 앱에 있는 모드(일반 · 천체 장노출)만 누를 수 있고, 나머지는 흐린 "준비 중" 줄입니다. 계산은 `utils/captureMode.ts`.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, Check, Moon, Sparkles, Timer, X } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import { CAPTURE_MODES, modeDesc, modeLabel, modeResultTag, recommendReason, sheetRows, tabForMode, type CameraTab, type CaptureModeKey } from '../../utils/captureMode';

interface Props {
  visible: boolean;
  language: Language;
  /** 머리줄 오른쪽에 보일 지금 시각("16:42"). 모르면 생략. */
  nowLabel?: string;
  /** 지금 열려 있는 카메라 탭 */
  currentTab: CameraTab;
  /** 지금 권하는 모드(해 고도 · 샌드박스에서 넘어온 장면의 시각으로 정합니다) */
  recommended: CaptureModeKey;
  /** 열 수 있는 모드를 골랐을 때(일반 · 천체 장노출은 카메라 탭, 타임랩스는 자체 패널) */
  onPick: (key: CaptureModeKey) => void;
  onClose: () => void;
}

/** 모드 줄의 아이콘(목업 16). 천체 · 이벤트는 달 · 별빛 색을 씁니다. */
const ICONS: Record<CaptureModeKey, { Icon: React.ComponentType<{ size?: number; color?: string }>; tint: string }> = {
  normal: { Icon: Camera, tint: DARK.text },
  astro: { Icon: Sparkles, tint: '#A78BFA' },
  timelapse: { Icon: Timer, tint: DARK.glow },
  event: { Icon: Moon, tint: DARK.moon },
};

export const CaptureModeSheet: React.FC<Props> = ({ visible, language, nowLabel, currentTab, recommended, onPick, onClose }) => {
  const { rows } = sheetRows(recommended);
  const reason = recommendReason(recommended, language);
  const pick = (k: CaptureModeKey) => {
    if (!CAPTURE_MODES.find(m => m.key === k)?.ready) return;
    onPick(k);
    onClose();
  };
  const soon = L3(language, '준비 중', 'Coming soon', '準備中');
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{L3(language, '촬영 모드', 'Capture mode', '撮影モード')}</Text>
            {nowLabel ? <Text style={styles.now}>{`${L3(language, '지금', 'Now', '今')} ${nowLabel}`}</Text> : null}
            <OverlayButton onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} style={styles.closeBtn}>
              <X size={16} color={DARK.text} />
            </OverlayButton>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.label}>{L3(language, '지금 권하는 것', 'RECOMMENDED NOW', '今おすすめ')}</Text>
            <Pressable
              onPress={() => pick(recommended)}
              accessibilityRole="button"
              accessibilityLabel={`${L3(language, '권하는 모드', 'Recommended mode', 'おすすめモード')}: ${modeLabel(recommended, language)}`}
              style={styles.recCard}
            >
              <Text style={styles.recName}>{modeLabel(recommended, language)}</Text>
              <Text style={styles.recDesc}>{modeDesc(recommended, language)}</Text>
              {reason ? <Text style={styles.recReason}>{reason}</Text> : null}
            </Pressable>
            <Text style={[styles.label, { marginTop: 10 }]}>{L3(language, '모드', 'MODES', 'モード')}</Text>
            {rows.map(r => {
              const tab = tabForMode(r.key);
              const active = tab !== null && tab === currentTab;
              return (
                <Pressable
                  key={r.key}
                  disabled={!r.ready}
                  onPress={() => pick(r.key)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !r.ready, selected: active }}
                  accessibilityLabel={`${modeLabel(r.key, language)}${r.ready ? '' : `, ${soon}`}`}
                  style={[styles.row, active && styles.rowOn, !r.ready && styles.rowOff]}
                >
                  <View style={styles.iconCell}>{React.createElement(ICONS[r.key].Icon, { size: 22, color: ICONS[r.key].tint })}</View>
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{modeLabel(r.key, language)}</Text>
                    <Text style={styles.desc}>{modeDesc(r.key, language)}</Text>
                  </View>
                  <View style={styles.tagCol}>
                    <Text style={styles.tag}>{modeResultTag(r.key, language)}</Text>
                    {active ? <Check size={14} color={DARK.accent} /> : null}
                  </View>
                </Pressable>
              );
            })}
            <Text style={styles.footnote}>{L3(language, '샌드박스에서 이 장면 찍기로 오면 그 장면에 맞는 모드가 먼저 열려요.', 'Coming from the sandbox with “Shoot this scene”, the mode that fits that scene opens first.', 'サンドボックスの「このシーンを撮る」から来ると、そのシーンに合うモードが先に開きます。')}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: DARK.scrim },
  sheet: {
    maxHeight: '80%', backgroundColor: DARK.panel, borderColor: DARK.border, borderWidth: 1,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: 12,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: DARK.borderStrong, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  now: { flex: 1, textAlign: 'right', fontFamily: mono, fontSize: 11, color: DARK.textDim },
  title: { fontSize: 16, fontWeight: '800', color: DARK.text },
  iconCell: { width: 28, alignItems: 'center' },
  tagCol: { alignItems: 'flex-end', gap: 2 },
  tag: { fontFamily: mono, fontSize: 11, color: DARK.textMute },
  footnote: { fontSize: 11, color: DARK.textMute, marginTop: 6 },
  closeBtn: { width: 32, height: 32 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 0.8, color: DARK.textMute },
  recCard: { gap: 3, padding: 12, backgroundColor: DARK.accentSoft, borderColor: DARK.accentLine, borderWidth: 1, borderRadius: radius.md },
  recName: { fontSize: 15, fontWeight: '800', color: DARK.text },
  recDesc: { fontSize: 12, color: DARK.textDim },
  recReason: { fontSize: 11, color: DARK.textDim },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: DARK.fill, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.md },
  rowOn: { borderColor: DARK.accent },
  rowOff: { opacity: 0.5 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 14, fontWeight: '700', color: DARK.text },
  desc: { fontSize: 11, color: DARK.textDim },
  soon: { fontFamily: mono, fontSize: 10, color: DARK.textMute },
});
