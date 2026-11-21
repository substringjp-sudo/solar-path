/**
 * CameraFrame.tsx — 카메라의 **새 틀**(docs/SANDBOX_MODE_PLAN.md 17절 4번 · 23절). 하늘 화면의 `SkyFrame` 과 같은 부품(유리 막대 · 칩 · 시간 자 · 셔터 · 모드 줄)을 씁니다.
 *
 * 카메라가 화면 전체를 채우고 그 위에 이 막대가 뜹니다(아래 막이 깔려 밝은 하늘에서도 글자가 읽힘). 맨 위부터: 칩 줄(줌 · 노출 …) → 시간 자(3D 시뮬레이션 · 겹침일 때만; 실제 카메라는 지금 시각이라 바꿀 수 없음)
 * → 셔터 줄(왼쪽 · 오른쪽 둥근 칩, 가운데 큰 셔터) → 모드 줄. 칩을 누르면 그 칸의 `panels[id]` 가 펼쳐지고(같은 칩을 다시 누르면 접힘), 손잡이를 누르거나 밀어도 펼치고 접습니다.
 * 계산은 `dockStages` · `modeStrip` · `timeRuler` 가 하고, 이 파일은 놓는 일만 합니다(웹 하네스 `camframe:1`, 판정 `tools/web-repro/verify-camera-frame.js`).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GlassChip } from '../glass/GlassChip';
import { DockSheet } from '../glass/DockSheet';
import { GlassSurface } from '../glass/GlassSurface';
import { ModeStrip } from '../glass/ModeStrip';
import { TimeRuler } from '../glass/TimeRuler';
import type { DockStage } from '../../utils/dockStages';
import type { AppMode } from '../../utils/modeStrip';
import { L3, type Language } from '../../utils/i18n';
import { color as DARK } from '../../theme/tokens';

export interface CameraChipSpec {
  id: string;
  label: string;
  active?: boolean;
  /** 눌렀을 때 `panels[id]` 를 펼칩니다. 아니면 `onPress` 만 부릅니다. */
  expands?: boolean;
  mono?: boolean;
  /** 처음 눌러 펼칠 때의 단계(기본 mid). 긴 패널(천체 설정)은 'full'. */
  openStage?: 'mid' | 'full';
  onPress?: () => void;
  accessibilityLabel?: string;
}

export interface CameraRulerProps {
  timeMs: number;
  tz: number;
  nowMs: number;
  onDragStart?: () => void;
  onChange: (ms: number) => void;
  onCommit?: () => void;
  sunsetMs?: number | null;
  sunsetLabel?: string;
  showNow?: boolean;
  onNow?: () => void;
}

interface Props {
  language: Language;
  chips: readonly CameraChipSpec[];
  panels?: Record<string, React.ReactNode>;
  /** 있으면 시간 자를 그립니다(3D 시뮬레이션 · 겹침일 때만). */
  ruler?: CameraRulerProps | null;
  /** 셔터 줄 왼쪽 · 오른쪽 둥근 칩 */
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** 셔터 */
  shutterLabel: string;
  shutterInner: React.ReactNode;
  shutterBusy?: boolean;
  /** 셔터 안쪽 색(기본 하늘색, 천체는 달빛 색) */
  shutterColor?: string;
  onShutter: () => void;
  stripMode: AppMode;
  stripModes: readonly AppMode[];
  onPickMode: (m: AppMode) => void;
  /** 고정부 + 손잡이 줄의 높이가 정해지면(px) 알립니다 — 막대 위에 떠 있는 것을 올리는 데 씁니다. */
  onDockHeight?: (h: number) => void;
  /** 하네스용: 화면 높이를 직접 넘김 */
  screenH?: number;
  /** 하네스용: 펼침 단계를 밖에서 */
  stage?: DockStage;
  onStageChange?: (s: DockStage) => void;
}

export const CameraFrame: React.FC<Props> = ({
  language, chips, panels, ruler = null, left, right, shutterLabel, shutterInner, shutterBusy = false, shutterColor, onShutter,
  stripMode, stripModes, onPickMode, onDockHeight, screenH, stage: stageProp, onStageChange,
}) => {
  const [stageState, setStageState] = React.useState<DockStage>('min');
  const stage = stageProp ?? stageState;
  const [active, setActive] = React.useState<string | null>(null);
  const firstPanelId = React.useMemo(
    () => chips.find(c => c.expands && panels?.[c.id])?.id ?? Object.keys(panels ?? {}).find(k => panels?.[k]) ?? null,
    [chips, panels],
  );
  React.useEffect(() => {
    setActive(null);
    if (stageProp == null) setStageState('min');
  }, [stripMode, stageProp]);

  const setStage = (s: DockStage) => {
    (onStageChange ?? setStageState)(s);
    if (s === 'min') {
      setActive(null);
    } else if ((!active || !panels?.[active]) && firstPanelId) {
      setActive(firstPanelId);
    }
  };

  const onChip = (c: CameraChipSpec) => {
    if (!c.expands || !panels?.[c.id]) { c.onPress?.(); return; }
    if (active === c.id && stage !== 'min') { setStage('min'); return; }
    setActive(c.id);
    if (stage === 'min') setStage(c.openStage ?? 'mid');
    c.onPress?.();
  };
  const activeKey = (active && panels?.[active]) ? active : firstPanelId;
  const isOpen = (c: CameraChipSpec) => !!c.expands && activeKey === c.id && stage !== 'min';

  const panel = activeKey ? panels?.[activeKey] : null;
  // 패널은 펼친 영역이 정해 준 최대 높이 안에서 그려지고, 길면 안쪽에서 스크롤됩니다(막대의 고정부 쪽으로 삐져나오지 않게).
  const expanded = panel ? (maxH: number) => (
    <GlassSurface testID={`panel-${activeKey}`} style={[styles.panel, { maxHeight: Math.max(96, maxH - 8) }]}>
      <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.panelContent}>{panel}</ScrollView>
    </GlassSurface>
  ) : null;

  const zoomChips = chips.filter(c => c.id.startsWith('zoom-'));
  const subChips = chips.filter(c => !c.id.startsWith('zoom-'));
  const renderChip = (c: CameraChipSpec) => (
    <GlassChip
      key={c.id}
      testID={`chip-${c.id}`}
      label={c.label}
      mono={c.mono}
      active={c.active || isOpen(c)}
      expanded={c.expands ? isOpen(c) : undefined}
      accessibilityLabel={c.accessibilityLabel}
      onPress={() => onChip(c)}
    />
  );

  return (
    <DockSheet stage={stage} onStageChange={setStage} language={language} expanded={expanded} screenH={screenH} fitContent onFixedHeight={onDockHeight}>
      {chips.length > 0 ? (
        <View testID="chips-row" style={styles.chipsCol}>
          {zoomChips.length > 0 ? <View style={styles.chips}>{zoomChips.map(renderChip)}</View> : null}
          {subChips.length > 0 ? <View style={styles.chips}>{subChips.map(renderChip)}</View> : null}
        </View>
      ) : null}
      {ruler ? (
        <TimeRuler
          timeMs={ruler.timeMs}
          tz={ruler.tz}
          nowMs={ruler.nowMs}
          language={language}
          onDragStart={ruler.onDragStart}
          onChange={ruler.onChange}
          onCommit={ruler.onCommit}
          sunsetMs={ruler.sunsetMs}
          sunsetLabel={ruler.sunsetLabel}
          showNow={ruler.showNow}
          onNow={ruler.onNow}
        />
      ) : null}
      <View testID="shutter-row" style={styles.shutterRow}>
        <View style={styles.side}>{left}</View>
        <Pressable
          testID="shutter"
          accessibilityRole="button"
          accessibilityLabel={shutterLabel}
          disabled={shutterBusy}
          onPress={onShutter}
          style={[styles.shutterRing, shutterBusy && { opacity: 0.5 }]}
        >
          <View style={[styles.shutterInner, shutterColor ? { backgroundColor: shutterColor } : null]}>{shutterInner}</View>
        </Pressable>
        <View style={styles.side}>{right}</View>
      </View>
      <ModeStrip mode={stripMode} modes={stripModes} language={language} onPick={onPickMode} />
    </DockSheet>
  );
};

/** 막대의 칩 줄이 비어 있을 때를 대비한 안내 글(접근성용). */
export const cameraFrameLabel = (language: Language): string => L3(language, '카메라 조작', 'Camera controls', 'カメラ操作');

const styles = StyleSheet.create({
  chipsCol: { alignItems: 'center', gap: 6 },
  chips: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10 },
  panel: { marginHorizontal: 10, marginBottom: 8, borderRadius: 16, maxHeight: '100%' },
  panelScroll: { flexShrink: 1 },
  panelContent: { padding: 12, gap: 8 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  side: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: DARK.accent, alignItems: 'center', justifyContent: 'center' },
});
