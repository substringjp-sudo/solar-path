/**
 * GlassRepro — 유리 부품(GlassSurface · Scrim · GlassChip · TimeRuler · ModeStrip · DockSheet)을 한 화면에 모아 웹 하네스에서 눌러 보는 장면(2026-11-21).
 * 주소 # 뒤 JSON: { glass: 1, w, h, lang, sky: 'haze' | 'dusk' | 'night', stage, mode, event }.
 * 일어난 일은 window.__glass 에 남습니다: { stage, mode, timeMs, switches: [{ mode, guideOp, guide }], commits: [ms], shutter, dates, nows }.
 * 판정: tools/web-repro/verify-glass-parts.js
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bookmark, MapPin, Settings } from 'lucide-react-native';
import { GlassChip } from '../../src/components/glass/GlassChip';
import { GlassSurface, glassTextShadow } from '../../src/components/glass/GlassSurface';
import { Scrim } from '../../src/components/glass/Scrim';
import { TimeRuler } from '../../src/components/glass/TimeRuler';
import { ModeStrip } from '../../src/components/glass/ModeStrip';
import { DockSheet } from '../../src/components/glass/DockSheet';
import { TEXT } from '../../src/theme/glassTokens';
import { chipLabel, chipsFor, modeList, switchMode, type AppMode } from '../../src/utils/modeStrip';
import { dateShort, weekStrip } from '../../src/utils/timeRuler';
import { tabLabel } from '../../src/utils/tabLabels';
import type { DockStage } from '../../src/utils/dockStages';

const SKY: Record<string, string> = {
  haze: 'linear-gradient(180deg, #b8c0d6 0%, #d9dde6 45%, #e9e2d6 60%, #e9e2d6 100%)',
  dusk: 'linear-gradient(180deg, #2b3a66 0%, #8f6a8a 55%, #e0a070 100%)',
  night: 'linear-gradient(180deg, #070A12 0%, #0d1428 100%)',
};

export function GlassRepro({ W, H, Q }: { W: number; H: number; Q: any }) {
  const lang = (Q.lang ?? 'ko') as 'ko' | 'en' | 'ja';
  const tz = 9;
  const C = Date.UTC(2026, 10, 21, 8, 4);
  const [stage, setStage] = React.useState<DockStage>(Q.stage ?? 'min');
  const [mode, setMode] = React.useState<AppMode>(Q.mode ?? 'simulation');
  const [timeMs, setTimeMs] = React.useState(C);
  const log = React.useRef<any>({ switches: [], commits: [], shutter: 0, dates: 0, nows: 0 });
  (globalThis as any).__glass = { stage, mode, timeMs, ...log.current };
  const modes = modeList(!!Q.event);
  const view = { azDeg: 159, elDeg: 13 };
  const onPick = (target: AppMode) => { const sw = switchMode(mode, target, view); log.current.switches.push(sw); setMode(sw.mode); };

  const chips = chipsFor(mode);
  const week = weekStrip(timeMs, C, tz, lang);
  return (
    <View testID="glass-root" style={[styles.root, { width: W, height: H }, { backgroundImage: SKY[Q.sky ?? 'haze'] } as any]}>
      <Scrim edge="top" />
      <View style={styles.header}>
        <GlassSurface testID="hdr-tabs" style={styles.tabs}>
          {(['sky', 'learn', 'log'] as const).map((id, i) => (
            <GlassChip key={id} flat label={tabLabel(id, lang)} active={i === 0} onPress={() => {}} style={styles.tab} />
          ))}
        </GlassSurface>
        <View style={{ flex: 1 }} />
        <GlassChip testID="hdr-place" label="강남구" icon={<MapPin size={16} color={TEXT} />} onPress={() => {}} />
        <GlassChip testID="hdr-settings" label="" icon={<Settings size={18} color={TEXT} />} onPress={() => {}} accessibilityLabel="설정" style={styles.round} />
      </View>
      <View style={styles.readout}>
        <GlassChip testID="readout" mono label={`159° S · ${mode === 'simulation' ? '해 EL 13.0°' : 'EL 13.0° · 눈 1.6 m'}`} />
      </View>

      <DockSheet
        stage={stage}
        onStageChange={setStage}
        language={lang}
        screenH={H}
        expanded={mode === 'simulation' ? (
          <View testID="expanded-week" style={styles.week}>
            {week.map(w => (
              <Pressable key={w.offset} testID={`week-${w.day}`} accessibilityRole="button" aria-pressed={w.selected} accessibilityLabel={`${w.weekday} ${w.day}`} onPress={() => setTimeMs(w.ms)} style={styles.weekPress}>
                <GlassSurface active={w.selected} style={styles.weekCell}>
                  <Text style={[styles.weekDay, glassTextShadow]}>{w.weekday}</Text>
                  <Text style={[styles.weekNum, glassTextShadow]}>{w.day}</Text>
                </GlassSurface>
              </Pressable>
            ))}
          </View>
        ) : (
          <GlassSurface testID="expanded-panel" style={styles.panel}>
            <Text style={[styles.panelText, glassTextShadow]}>{mode === 'sandbox' ? '이동 · 보기 · 장면 · 도구' : '카메라 설정'}</Text>
          </GlassSurface>
        )}
      >
        <View testID="chips-row" style={styles.chips}>
          {chips
            ? chips.map(c => <GlassChip key={c} testID={`chip-${c}`} label={chipLabel(c, lang)} active={c === 'today'} onPress={() => { if (c === 'date') setStage('mid'); }} />)
            : ['.5', '1×', '2', '5'].map(z => <GlassChip key={z} testID={`chip-zoom-${z}`} label={z} mono active={z === '1×'} onPress={() => {}} style={styles.zoom} />)}
        </View>
        <TimeRuler
          timeMs={timeMs}
          tz={tz}
          nowMs={C}
          language={lang}
          onChange={setTimeMs}
          onCommit={(ms) => { log.current.commits.push(ms); }}
          sunsetMs={Date.UTC(2026, 10, 21, 8, 17)}
          sunsetLabel="일몰 17:17"
          dateText={mode === 'simulation' ? dateShort(timeMs, tz, lang) : undefined}
          onDatePress={() => { log.current.dates++; setStage('mid'); }}
          onNow={() => { log.current.nows++; setTimeMs(C); }}
        />
        <View testID="shutter-row" style={styles.shutterRow}>
          <View testID="thumb" style={styles.thumb} />
          <Pressable testID="shutter" accessibilityRole="button" accessibilityLabel="촬영" onPress={() => { log.current.shutter++; }} style={styles.shutterRing}>
            <View style={styles.shutter} />
          </Pressable>
          <GlassChip testID="scene-save" label="" icon={<Bookmark size={20} color={TEXT} />} onPress={() => {}} accessibilityLabel="장면 저장" style={styles.round48} />
        </View>
        <ModeStrip mode={mode} modes={modes} language={lang} onPick={onPick} />
      </DockSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative', overflow: 'hidden', backgroundColor: '#b8c0d6' },
  header: { position: 'absolute', left: 10, right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabs: { flexDirection: 'row', padding: 3, borderRadius: 24, gap: 2 },
  tab: { minHeight: 40, paddingHorizontal: 10 },
  round: { width: 44, minHeight: 44, borderRadius: 22, paddingHorizontal: 0 },
  readout: { position: 'absolute', left: 10, right: 10, top: 64, alignItems: 'center' },
  week: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 8, justifyContent: 'center' },
  weekPress: { flex: 1, minWidth: 0 },
  weekCell: { minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2 },
  weekDay: { color: TEXT, fontSize: 11, fontWeight: '600' },
  weekNum: { color: TEXT, fontSize: 16, fontWeight: '800' },
  panel: { marginHorizontal: 10, marginBottom: 8, padding: 14, borderRadius: 16, flex: 1 },
  panelText: { color: TEXT, fontSize: 13, fontWeight: '700' },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
  zoom: { minWidth: 40, paddingHorizontal: 0, borderRadius: 20 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  thumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#c8774a', borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)' },
  shutterRing: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#38BDF8' },
  round48: { width: 48, minHeight: 48, borderRadius: 24, paddingHorizontal: 0 },
});
