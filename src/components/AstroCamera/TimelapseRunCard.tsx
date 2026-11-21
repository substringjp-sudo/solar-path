/**
 * TimelapseRunCard.tsx — **타임랩스 촬영 중 카드**(목업 12, docs/SANDBOX_MODE_PLAN.md 23절). 유리 면 위에 글자는 모두 #F1F5F9.
 * 제목 · 시작 · 지금 · REC, 값 칸(찍은 장 · 남은 시간 · 앨범), 가운데에 `children`(밝기 곡선 · 배터리 · 화면 끄고 계속), 아래 한 줄 알림, 오른쪽 위 "마치기"(찍는 중) · 닫기(끝난 뒤).
 * 값을 계산하지 않습니다 — 부르는 쪽(`SunCamera`)이 `useTimelapseRun` 과 `timelapsePlan` 으로 만든 값을 받습니다. 예전에는 `SunCamera` 안에 있었습니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { GlassChip } from '../glass/GlassChip';
import { GlassSurface, glassTextShadow } from '../glass/GlassSurface';
import { TEXT } from '../../theme/glassTokens';
import { color, mono } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';

interface Props {
  language: Language;
  /** "타임랩스 · 밝게 합성" */
  title: string;
  /** "16:40 시작 · 지금 16:52" */
  subtitle: string;
  running: boolean;
  /** 연속 실패로 멈춤 */
  error: boolean;
  taken: number;
  frames: number;
  /** 남은 시간 "12:31" */
  remaining: string;
  /** 앨범에 저장된 그림 수 */
  saved: number;
  onFinish: () => void;
  onDismiss: () => void;
  children?: React.ReactNode;
}

export const TimelapseRunCard: React.FC<Props> = ({ language, title, subtitle, running, error, taken, frames, remaining, saved, onFinish, onDismiss, children }) => {
  const cells = [
    { id: 'taken', label: L3(language, '찍은 장', 'Shots', '撮影'), value: `${taken}/${frames}` },
    { id: 'left', label: L3(language, '남은 시간', 'Left', '残り'), value: remaining },
    { id: 'album', label: L3(language, '앨범', 'Album', 'アルバム'), value: String(saved) },
  ];
  const note = error
    ? L3(language, `타임랩스가 멈췄어요 · ${taken}장 찍음`, `Timelapse stopped · ${taken} shots`, `タイムラプス停止 · ${taken}枚撮影`)
    : running
      ? L3(language, '화면을 켜 두세요', 'Keep the screen on', '画面をつけたままに')
      : L3(language, `타임랩스 끝 · ${saved}장 앨범에 저장`, `Timelapse done · ${saved} saved to album`, `タイムラプス終了 · ${saved}枚をアルバムに保存`);
  return (
    <GlassSurface testID="tl-run" style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text>
        </View>
        {running ? <View style={styles.rec}><View style={styles.recDot} /><Text style={styles.recText}>REC</Text></View> : null}
        {running
          ? <GlassChip testID="tl-finish" label={L3(language, '마치기', 'Finish', '終了')} onPress={onFinish} accessibilityLabel={L3(language, '마치기', 'Finish', '終了')} />
          : <GlassChip testID="tl-dismiss" label="" icon={<X size={16} color={TEXT} />} onPress={onDismiss} accessibilityLabel={L3(language, '닫기', 'Dismiss', '閉じる')} style={styles.round} />}
      </View>
      <View style={styles.cells}>
        {cells.map(c => (
          <View key={c.id} testID={`tl-cell-${c.id}`} style={styles.cell}>
            <Text style={styles.cellLabel}>{c.label}</Text>
            <Text style={styles.cellValue}>{c.value}</Text>
          </View>
        ))}
      </View>
      {children}
      <Text testID="tl-note" style={styles.note} numberOfLines={2}>{note}</Text>
    </GlassSurface>
  );
};

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: 6, padding: 10, borderRadius: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: TEXT, fontSize: 13, fontWeight: '700', ...glassTextShadow },
  sub: { color: TEXT, fontSize: 11, fontFamily: mono, ...glassTextShadow },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.danger },
  recText: { color: TEXT, fontSize: 12, fontWeight: '700', fontFamily: mono, ...glassTextShadow },
  round: { width: 40, minHeight: 40, borderRadius: 20, paddingHorizontal: 0 },
  cells: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, minWidth: 0, padding: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  cellLabel: { color: TEXT, fontSize: 10, fontFamily: mono, ...glassTextShadow },
  cellValue: { color: TEXT, fontSize: 13, fontWeight: '700', fontFamily: mono, ...glassTextShadow },
  note: { color: TEXT, fontSize: 11, ...glassTextShadow },
});
