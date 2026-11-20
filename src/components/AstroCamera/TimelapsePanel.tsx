/**
 * TimelapsePanel.tsx — **타임랩스 설정 시트**(docs/SANDBOX_MODE_PLAN.md 8.3.1 · 목업 9). 아래에서 올라오는 어두운 시트입니다.
 *
 * 구간 칩(일몰 60분 · 일출 60분 · 낮에서 밤으로 150분)과 영상 길이 칩(5 · 10 · 20 · 30초)을 고르면 한 줄 요약("12초마다 301장 · 영상 10초 · 360배속")과 저장 공간 어림이 보입니다.
 * "미리보기"는 3D 시뮬레이션이 그 구간을 영상 길이만큼 재생합니다(촬영 없이). "지금 시작"은 지금부터 그 총 시간 동안 간격마다 사진을 찍어 앨범에 저장합니다.
 * 영상(MP4) 만들기는 아직 없습니다: 사진 묶음으로 저장합니다. 계산은 `utils/timelapsePlan.ts`.
 */
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import { planSummary, planTimelapse, presetWindow, type PresetKind, type TimelapseKind, type TimelapsePlan } from '../../utils/timelapsePlan';

export const VIDEO_SEC_CHOICES = [5, 10, 20, 30] as const;
const PRESETS: readonly PresetKind[] = ['sunset', 'sunrise', 'day-to-night'];
const KINDS: readonly TimelapseKind[] = ['plain', 'stacked', 'trail'];
export const STACK_CHOICES = [2, 4, 8] as const;

interface Props {
  visible: boolean;
  language: Language;
  /** 해가 뜨고 지는 시각(ms). 구간 미리보기의 기준입니다. 모르면 null(지금부터 재생). */
  events: { sunrise: number | null; sunset: number | null };
  /** 지금 시각(ms). */
  nowMs: number;
  onPreview: (plan: TimelapsePlan, startMs: number, endMs: number) => void;
  onStart: (plan: TimelapsePlan) => void;
  onClose: () => void;
}

const kindLabel = (k: TimelapseKind, l: Language): string => {
  if (k === 'plain') return L3(l, '일반', 'Plain', '通常');
  if (k === 'stacked') return L3(l, '밝게 합성', 'Bright stack', '明るく合成');
  return L3(l, '궤적 누적', 'Trails', '軌跡の累積');
};
const kindDesc = (k: TimelapseKind, l: Language): string => {
  if (k === 'plain') return L3(l, '한 장이 영상 한 프레임이에요.', 'Each photo is one video frame.', '1枚が動画の1フレームです。');
  if (k === 'stacked') return L3(l, '여러 장을 한 프레임으로 합쳐 밤을 밝고 깨끗하게 만들어요.', 'Several photos merge into one bright, clean frame for night scenes.', '複数枚を1フレームに合成し、夜を明るくきれいにします。');
  return L3(l, '처음 장부터 계속 쌓아 별 궤적이 점점 그려져요. 마지막 프레임이 별 일주 사진이에요.', 'Photos keep stacking so star trails draw in; the last frame is the star-trail photo.', '最初から積み重ねて星の軌跡が少しずつ描かれます。最後のフレームが星の軌跡写真です。');
};

const presetLabel = (k: PresetKind, l: Language): string => {
  if (k === 'sunset') return L3(l, '일몰 60분', 'Sunset 60 min', '日没 60分');
  if (k === 'sunrise') return L3(l, '일출 60분', 'Sunrise 60 min', '日の出 60分');
  return L3(l, '낮에서 밤으로 150분', 'Day to night 150 min', '昼から夜へ 150分');
};

export const TimelapsePanel: React.FC<Props> = ({ visible, language, events, nowMs, onPreview, onStart, onClose }) => {
  const [preset, setPreset] = useState<PresetKind>('sunset');
  const [videoSec, setVideoSec] = useState<number>(10);
  const [kind, setKind] = useState<TimelapseKind>('plain');
  const [stackSize, setStackSize] = useState<number>(4);
  const eventMs = preset === 'sunrise' ? events.sunrise : events.sunset;
  const win = useMemo(() => (eventMs !== null ? presetWindow(preset, eventMs) : null), [preset, eventMs]);
  const totalMin = win?.totalMin ?? presetWindow(preset, 0)!.totalMin;
  const plan = useMemo(() => planTimelapse({ totalMin, videoSec, fps: 30, kind, stackSize }), [totalMin, videoSec, kind, stackSize]);
  const preview = () => {
    const startMs = win ? win.startMs : nowMs;
    const endMs = win ? win.endMs : nowMs + totalMin * 60000;
    onPreview(plan, startMs, endMs);
    onClose();
  };
  const start = () => { onStart(plan); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{L3(language, '타임랩스', 'Timelapse', 'タイムラプス')}</Text>
            <OverlayButton onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} style={styles.closeBtn}>
              <X size={16} color={DARK.text} />
            </OverlayButton>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.label}>{L3(language, '종류', 'TYPE', '種類')}</Text>
            <View style={styles.chips}>
              {KINDS.map(k => (
                <OverlayButton key={k} active={kind === k} onPress={() => setKind(k)} accessibilityLabel={kindLabel(k, language)} style={styles.chip}>
                  <Text style={[styles.chipText, kind === k && { color: DARK.accent }]}>{kindLabel(k, language)}</Text>
                </OverlayButton>
              ))}
            </View>
            <Text style={styles.note}>{kindDesc(kind, language)}</Text>
            {kind === 'stacked' ? (
              <View style={styles.chips}>
                {STACK_CHOICES.map(n => (
                  <OverlayButton key={n} active={stackSize === n} onPress={() => setStackSize(n)} accessibilityLabel={`${n}${L3(language, '장씩 합성', ' per frame', '枚ずつ')}`} style={styles.chip}>
                    <Text style={[styles.chipText, stackSize === n && { color: DARK.accent }]}>{`${n}${L3(language, '장씩', ' per frame', '枚ずつ')}`}</Text>
                  </OverlayButton>
                ))}
              </View>
            ) : null}
            <Text style={[styles.label, { marginTop: 8 }]}>{L3(language, '구간', 'WINDOW', '区間')}</Text>
            <View style={styles.chips}>
              {PRESETS.map(k => (
                <OverlayButton key={k} active={preset === k} onPress={() => setPreset(k)} accessibilityLabel={presetLabel(k, language)} style={styles.chip}>
                  <Text style={[styles.chipText, preset === k && { color: DARK.accent }]}>{presetLabel(k, language)}</Text>
                </OverlayButton>
              ))}
            </View>
            <Text style={[styles.label, { marginTop: 8 }]}>{L3(language, '영상 길이', 'VIDEO LENGTH', '動画の長さ')}</Text>
            <View style={styles.chips}>
              {VIDEO_SEC_CHOICES.map(v => (
                <OverlayButton key={v} active={videoSec === v} onPress={() => setVideoSec(v)} accessibilityLabel={`${v}${L3(language, '초', ' s', '秒')}`} style={styles.chip}>
                  <Text style={[styles.chipText, videoSec === v && { color: DARK.accent }]}>{`${v}${L3(language, '초', ' s', '秒')}`}</Text>
                </OverlayButton>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.summary}>{planSummary(plan, language)}</Text>
              <Text style={styles.note}>
                {`${L3(language, '저장 약', 'About', '保存 約')} ${plan.estimateMB} MB`}
              </Text>
              {plan.clamped === 'interval' ? (
                <Text style={styles.note}>{L3(language, '간격이 너무 짧아 2초로 맞췄어요. 영상이 조금 짧아져요.', 'Interval raised to 2 s, so the video comes out shorter.', '間隔が短すぎるため2秒にしました。動画は少し短くなります。')}</Text>
              ) : null}
              {kind !== 'plain' ? (
                <Text style={styles.note}>{L3(language, '합성은 준비 중이에요. 지금은 찍은 사진을 그대로 앨범에 저장해요.', 'Compositing is coming soon. For now the shots are saved as they are.', '合成は準備中です。今は撮った写真をそのまま保存します。')}</Text>
              ) : null}
              <Text style={styles.note}>{L3(language, '사진 묶음으로 앨범에 저장해요. 영상 만들기는 준비 중이에요.', 'Saved to your album as a photo set. Video export is coming soon.', 'アルバムに写真の束として保存します。動画化は準備中です。')}</Text>
            </View>
            <View style={styles.actions}>
              <OverlayButton onPress={preview} accessibilityLabel={L3(language, '미리보기: 시뮬레이션으로 재생', 'Preview: play the simulation', 'プレビュー: シミュレーションで再生')} style={styles.btn}>
                <Text style={styles.btnText}>{L3(language, '미리보기', 'Preview', 'プレビュー')}</Text>
              </OverlayButton>
              <OverlayButton onPress={start} accessibilityLabel={L3(language, '지금 시작: 지금부터 촬영', 'Start now', '今すぐ開始')} style={styles.btn}>
                <Text style={[styles.btnText, { color: DARK.accent }]}>{L3(language, '지금 시작', 'Start now', '今すぐ開始')}</Text>
              </OverlayButton>
            </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 16, fontWeight: '800', color: DARK.text },
  closeBtn: { width: 32, height: 32 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 0.8, color: DARK.textMute },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { width: 'auto', height: 32, paddingHorizontal: 10 },
  chipText: { fontSize: 12, fontWeight: '700', color: DARK.text },
  card: { gap: 4, marginTop: 8, padding: 10, backgroundColor: DARK.fill, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.md },
  summary: { fontFamily: mono, fontSize: 12, color: DARK.text },
  note: { fontSize: 11, color: DARK.textDim },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, height: 38 },
  btnText: { fontSize: 13, fontWeight: '800', color: DARK.text },
});
