/**
 * SkyFrame.tsx — 하늘 화면의 새 틀(목업 "4차 b" · "5차: 모드 줄", 새 화면 틀 실험 스위치가 켜졌을 때만).
 *
 * 맨 아래 고정부는 위에서부터 칩 줄 · 시간 자 · 셔터 줄 · 모드 줄이고, 그 위에 펼친 영역이 얹힙니다(`glass/DockSheet`).
 *  - 시뮬레이션: 칩 `어제 · 오늘 · 내일 · 날짜`. "날짜"를 누르면 일주일 줄이 펼쳐지고, 끝까지 펼치면 `simBody`(점수 · 그래프 · 다가오는 좋은 순간)가 이어집니다.
 *  - 샌드박스: 칩 `이동 · 보기 · 장면 · 도구`. 칩을 누르면 그 칩의 내용이 펼쳐지고, 같은 칩을 다시 누르면 접힙니다.
 *  - 모드 줄: 시뮬레이션 · 샌드박스 · 사진 · 천체 · 타임랩스. 카메라 쪽 모드로 가면 `onSwitch` 가 사진에 내린 결과(보던 방향이 가이드)를 받습니다.
 * 시각을 바꾸는 일은 모두 `onSlideStart` → `onPick` → `onSlideEnd` 로 알립니다("time" 은 하루 안에서 끄는 것, "date" 는 날짜가 바뀌는 것 — 하늘 화면이 날씨를 새로 받는 때가 다릅니다).
 * 안의 내용(`simBody` · `sandbox.*`)은 부르는 쪽이 넣습니다: 기존 조작부를 그대로 재사용합니다.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bookmark } from 'lucide-react-native';
import { DockSheet } from '../glass/DockSheet';
import { GlassChip } from '../glass/GlassChip';
import { GlassSurface, glassTextShadow } from '../glass/GlassSurface';
import { ModeStrip } from '../glass/ModeStrip';
import { Scrim } from '../glass/Scrim';
import { TimeRuler } from '../glass/TimeRuler';
import { color as DARK } from '../../theme/tokens';
import { TEXT } from '../../theme/glassTokens';
import type { DockStage } from '../../utils/dockStages';
import { chipLabel, chipsFor, modeList, switchMode, type AppMode, type ChipId, type ModeSwitch } from '../../utils/modeStrip';
import { dateShort, dayOffset, shiftDays, weekStrip } from '../../utils/timeRuler';
import { L3 } from '../../utils/i18n';

type Lang = 'ko' | 'en' | 'ja';
export type SlideKind = 'time' | 'date';
export type FrameMode = 'simulation' | 'sandbox';

interface Props {
  language: Lang;
  tz: number;
  /** 지금(오늘 · 어제 · 내일을 가르는 기준) */
  nowMs: number;
  timeMs: number;
  onSlideStart: (kind: SlideKind) => void;
  onPick: (ms: number, kind: SlideKind) => void;
  onSlideEnd: (kind: SlideKind) => void;
  /** "지금" 단추 */
  onNow: () => void;
  sunsetMs?: number | null;
  sunsetLabel?: string;
  mode: FrameMode;
  /** 모드 줄에서 모드를 바꿨을 때. 카메라 쪽이면 `sw.mode` 는 사진이고 `sw.guide` 가 보던 방향입니다. */
  onSwitch: (sw: ModeSwitch) => void;
  /** 지금 보는 방향(가이드가 됨). 못 읽으면 null. */
  getView: () => { azDeg: number; elDeg: number } | null;
  /** 맨 위 읽음 줄 글 */
  readout: string;
  /** 시뮬레이션을 끝까지 펼쳤을 때 보이는 내용 */
  simBody?: React.ReactNode;
  /** 샌드박스 칩별 펼친 내용 */
  sandbox?: Partial<Record<'move' | 'view' | 'scene' | 'tools', React.ReactNode>>;
  /** 셔터: 이 장면 찍기 */
  onShoot: () => void;
  /** 오른쪽 아래: 장면 저장 */
  onSaveScene?: () => void;
  /** 달력 창 열기("날짜" 펼침 안의 "달력") */
  onOpenCalendar?: () => void;
}

export const SkyFrame: React.FC<Props> = ({
  language, tz, nowMs, timeMs, onSlideStart, onPick, onSlideEnd, onNow, sunsetMs = null, sunsetLabel, mode, onSwitch, getView,
  readout, simBody, sandbox, onShoot, onSaveScene, onOpenCalendar,
}) => {
  const [stage, setStage] = React.useState<DockStage>('min');
  const [active, setActive] = React.useState<ChipId | null>(null);
  const modes = React.useMemo(() => modeList(false), []);
  const off = dayOffset(timeMs, nowMs, tz);

  const setStageSafe = (s: DockStage) => { setStage(s); if (s === 'min') setActive(null); };
  const jumpDay = (target: number) => {
    onSlideStart('date');
    onPick(shiftDays(timeMs, target - off), 'date');
    onSlideEnd('date');
  };
  const onChip = (c: ChipId) => {
    if (c === 'yesterday') return jumpDay(-1);
    if (c === 'today') return jumpDay(0);
    if (c === 'tomorrow') return jumpDay(1);
    // 날짜 · 이동 · 보기 · 장면 · 도구: 그 칸을 펼치고, 같은 칸을 다시 누르면 접는다.
    if (active === c && stage !== 'min') { setStageSafe('min'); return; }
    setActive(c);
    setStage(s => (s === 'min' ? 'mid' : s));
  };

  const pickMode = (target: AppMode) => {
    const sw = switchMode(mode, target, getView());
    setStageSafe('min');
    onSwitch(sw);
  };

  const week = weekStrip(timeMs, nowMs, tz, language);
  const chips = chipsFor(mode) ?? [];
  const chipActive = (c: ChipId): boolean => {
    if (c === 'yesterday') return off === -1;
    if (c === 'today') return off === 0;
    if (c === 'tomorrow') return off === 1;
    return active === c && stage !== 'min';
  };

  let expanded: React.ReactNode = null;
  if (mode === 'simulation') {
    expanded = (
      <View style={styles.simWrap}>
        <View testID="week-strip" style={styles.week}>
          {week.map(w => (
            <Pressable
              key={w.offset}
              testID={`week-${w.day}`}
              accessibilityRole="button"
              accessibilityLabel={`${w.weekday} ${w.day}`}
              aria-pressed={w.selected}
              onPress={() => { onSlideStart('date'); onPick(w.ms, 'date'); onSlideEnd('date'); }}
              style={styles.weekPress}
            >
              <GlassSurface active={w.selected} style={styles.weekCell}>
                <Text style={[styles.weekDay, glassTextShadow]}>{w.weekday}</Text>
                <Text style={[styles.weekNum, glassTextShadow]}>{w.day}</Text>
              </GlassSurface>
            </Pressable>
          ))}
        </View>
        {onOpenCalendar ? (
          <View style={styles.calRow}>
            <GlassChip testID="calendar" label={L3(language, '달력에서 고르기', 'Open calendar', 'カレンダーで選ぶ')} onPress={onOpenCalendar} />
          </View>
        ) : null}
        {stage === 'full' && simBody ? (
          <ScrollView testID="sim-body" style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>{simBody}</ScrollView>
        ) : null}
      </View>
    );
  } else if (active && active !== 'date' && sandbox?.[active as 'move' | 'view' | 'scene' | 'tools']) {
    expanded = (
      <GlassSurface testID={`panel-${active}`} style={styles.panel}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.panelContent}>{sandbox[active as 'move' | 'view' | 'scene' | 'tools']}</ScrollView>
      </GlassSurface>
    );
  }

  return (
    <>
      <Scrim edge="top" />
      <View testID="frame-readout" pointerEvents="none" style={styles.readout}>
        <GlassChip mono label={readout} />
      </View>
      <DockSheet stage={stage} onStageChange={setStageSafe} language={language} expanded={expanded}>
        <View testID="chips-row" style={styles.chips}>
          {chips.map(c => (
            <GlassChip key={c} testID={`chip-${c}`} label={chipLabel(c, language)} active={chipActive(c)} expanded={c === 'date' || mode === 'sandbox' ? chipActive(c) : undefined} onPress={() => onChip(c)} />
          ))}
        </View>
        <TimeRuler
          timeMs={timeMs}
          tz={tz}
          nowMs={nowMs}
          language={language}
          onDragStart={() => onSlideStart('time')}
          onChange={(ms) => onPick(ms, 'time')}
          onCommit={() => onSlideEnd('time')}
          sunsetMs={sunsetMs}
          sunsetLabel={sunsetLabel}
          dateText={mode === 'simulation' ? dateShort(timeMs, tz, language) : undefined}
          onDatePress={() => { setActive('date'); setStage(s => (s === 'min' ? 'mid' : s)); }}
          onNow={onNow}
        />
        <View testID="shutter-row" style={styles.shutterRow}>
          <View testID="thumb" style={styles.thumb} />
          <Pressable testID="shutter" accessibilityRole="button" accessibilityLabel={L3(language, '이 장면 찍기', 'Shoot this scene', 'このシーンを撮る')} onPress={onShoot} style={styles.shutterRing}>
            <View style={styles.shutter} />
          </Pressable>
          <GlassChip
            testID="scene-save"
            label=""
            icon={<Bookmark size={20} color={TEXT} />}
            onPress={onSaveScene}
            accessibilityLabel={L3(language, '장면 저장', 'Save scene', 'シーン保存')}
            style={styles.round48}
          />
        </View>
        <ModeStrip mode={mode} modes={modes} language={language} onPick={pickMode} />
      </DockSheet>
    </>
  );
};

const styles = StyleSheet.create({
  readout: { position: 'absolute', left: 10, right: 10, top: 12, alignItems: 'center' },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
  simWrap: { flex: 1 },
  week: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
  weekPress: { flex: 1, minWidth: 0 },
  weekCell: { minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2 },
  weekDay: { color: TEXT, fontSize: 11, fontWeight: '600' },
  weekNum: { color: TEXT, fontSize: 16, fontWeight: '800' },
  calRow: { alignItems: 'center', paddingBottom: 8 },
  body: { flex: 1, marginHorizontal: 10 },
  bodyContent: { paddingBottom: 12, gap: 10 },
  panel: { marginHorizontal: 10, marginBottom: 8, borderRadius: 16, flex: 1 },
  panelContent: { padding: 12 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  thumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#2b3a66', borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)' },
  shutterRing: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 64, height: 64, borderRadius: 32, backgroundColor: DARK.accent },
  round48: { width: 48, minHeight: 48, borderRadius: 24, paddingHorizontal: 0 },
});
