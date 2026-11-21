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
import Svg, { Polyline } from 'react-native-svg';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import { exposureLine, exposureStops, exposureSummary } from '../../utils/exposureCurve';
import { clockLabel, planTimelapse, presetWindow, windowLabel, type PresetKind, type TimelapseKind, type TimelapsePlan } from '../../utils/timelapsePlan';

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
  /** 시각 글을 읽을 시간대(시간) */
  tzHours: number;
  /** 가장 붉은 구간(일몰 둘레 점수가 높은 덩어리). 모르면 null(줄을 안 그림). */
  peak?: { fromMs: number; toMs: number } | null;
  /** 낮은 구름(지평선 가림)이 두꺼운 구간(일몰 둘레). 모르면 null(줄을 안 그림). */
  lowCloud?: { fromMs: number; toMs: number } | null;
  /** 시각(ms) → 그때 해 고도(°). 있으면 구간의 "예측 노출 곡선"(맑은 하늘 기준 어림)을 그립니다. */
  sunAltAt?: ((ms: number) => number) | null;
  onPreview: (plan: TimelapsePlan, startMs: number, endMs: number) => void;
  onStart: (plan: TimelapsePlan) => void;
  onClose: () => void;
}

export const kindLabel = (k: TimelapseKind, l: Language): string => {
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

export const TimelapsePanel: React.FC<Props> = ({ visible, language, events, nowMs, tzHours, peak = null, lowCloud = null, sunAltAt = null, onPreview, onStart, onClose }) => {
  const [preset, setPreset] = useState<PresetKind>('sunset');
  const [videoSec, setVideoSec] = useState<number>(10);
  const [kind, setKind] = useState<TimelapseKind>('plain');
  const [stackSize, setStackSize] = useState<number>(4);
  const eventMs = preset === 'sunrise' ? events.sunrise : events.sunset;
  const win = useMemo(() => (eventMs !== null ? presetWindow(preset, eventMs) : null), [preset, eventMs]);
  const totalMin = win?.totalMin ?? presetWindow(preset, 0)!.totalMin;
  const plan = useMemo(() => planTimelapse({ totalMin, videoSec, fps: 30, kind, stackSize }), [totalMin, videoSec, kind, stackSize]);
  // 예측 노출 곡선: 구간을 25 칸으로 나눈 해 고도 → 첫 장면 대비 단 수(맑은 하늘 기준 어림, 구름 · 지형 반영 안 함)
  const expo = useMemo(() => {
    if (!win || !sunAltAt) return null;
    const alts: number[] = [];
    for (let i = 0; i <= 24; i++) alts.push(sunAltAt(win.startMs + ((win.endMs - win.startMs) * i) / 24));
    const stops = exposureStops(alts);
    const sum = exposureSummary(stops);
    return sum ? { line: exposureLine(stops, 120, 24), total: sum.total } : null;
  }, [win, sunAltAt]);
  const preview = () => {
    const startMs = win ? win.startMs : nowMs;
    const endMs = win ? win.endMs : nowMs + totalMin * 60000;
    onPreview(plan, startMs, endMs);
    onClose();
  };
  const start = () => { onStart(plan); onClose(); };
  // 목업 9: 부제는 구간("16:40 ~ 18:10"), 값 칸 넷, 그 아래 한 줄("시작 16:40 · 촬영 90분 · 종류")
  const subtitle = win ? windowLabel(win.startMs, win.endMs, tzHours) : `${L3(language, '지금부터', 'From now', '今から')} ${totalMin}${L3(language, '분', ' min', '分')}`;
  const startShown = win ? win.startMs : nowMs;
  const cells = [
    { label: L3(language, '간격', 'Interval', '間隔'), value: `${plan.intervalS % 1 === 0 ? plan.intervalS : plan.intervalS.toFixed(1)} s` },
    { label: L3(language, '찍는 장', 'Shots', '撮影枚数'), value: String(plan.frames) },
    { label: L3(language, '영상', 'Video', '動画'), value: `${Math.round(plan.videoSec)} s` },
    { label: L3(language, '저장', 'Saved', '保存'), value: String(plan.savedFrames) },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title}>{L3(language, '타임랩스', 'Timelapse', 'タイムラプス')}</Text>
              <Text style={styles.subtitle}>{`${kindLabel(kind, language)} · ${subtitle}`}</Text>
            </View>
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
              <View style={styles.cellRow}>
                {cells.map(c => (
                  <View key={c.label} style={styles.cell}>
                    <Text style={styles.cellLabel}>{c.label}</Text>
                    <Text style={styles.cellValue}>{c.value}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.summary}>{`${L3(language, '시작', 'Start', '開始')} ${clockLabel(startShown, tzHours)} · ${L3(language, '촬영', 'Shoot', '撮影')} ${totalMin}${L3(language, '분', ' min', '分')} · ${L3(language, '저장 약', 'About', '保存 約')} ${plan.estimateMB} MB`}</Text>
              {expo && expo.line ? (
                <View style={styles.expoRow}>
                  <Svg width={120} height={24} accessibilityLabel={L3(language, '예측 노출 곡선', 'Predicted exposure curve', '予測露出カーブ')}>
                    <Polyline points={expo.line} fill="none" stroke={DARK.accent} strokeWidth={2} />
                  </Svg>
                  <Text style={styles.expoText}>{`${L3(language, '밝기', 'Light', '明るさ')} ${expo.total > 0 ? '+' : '−'}${Math.abs(expo.total).toFixed(1)}${L3(language, '단', ' stops', '段')} · ${L3(language, '맑은 하늘 기준 어림', 'clear-sky estimate', '快晴の目安')}`}</Text>
                </View>
              ) : null}
              {lowCloud && preset === 'sunset' ? (
                <Text style={styles.lowCloudLine}>{`${L3(language, '낮은 구름 두꺼움', 'Low cloud thick', '低い雲が厚い')} ${windowLabel(lowCloud.fromMs, lowCloud.toMs, tzHours)}`}</Text>
              ) : null}
              {peak && preset === 'sunset' ? (
                <Text style={styles.peakLine}>{`${L3(language, '가장 붉을 때', 'Reddest', '最も赤い時')} ${windowLabel(peak.fromMs, peak.toMs, tzHours)}`}</Text>
              ) : null}
              {plan.clamped === 'interval' ? (
                <Text style={styles.note}>{L3(language, '간격이 너무 짧아 2초로 맞췄어요. 영상이 조금 짧아져요.', 'Interval raised to 2 s, so the video comes out shorter.', '間隔が短すぎるため2秒にしました。動画は少し短くなります。')}</Text>
              ) : null}
              {kind === 'stacked' ? (
                <Text style={styles.note}>{L3(language, `${plan.stackSize}장씩 합쳐 ${plan.savedFrames}장을 앨범에 저장해요. 찍은 원본은 합친 뒤 지워요.`, `Every ${plan.stackSize} shots merge into one; ${plan.savedFrames} images go to your album. The raw shots are discarded after merging.`, `${plan.stackSize}枚ずつ合成して${plan.savedFrames}枚をアルバムに保存します。元の写真は合成後に消します。`)}</Text>
              ) : kind === 'trail' ? (
                <Text style={styles.note}>{L3(language, `찍을 때마다 겹친 누적 그림 ${plan.savedFrames}장을 앨범에 저장해요. 마지막 장이 별 일주 사진이에요.`, `A cumulative image is saved to your album after every shot (${plan.savedFrames}); the last one is the star-trail photo.`, `撮影のたびに累積画像を保存します(${plan.savedFrames}枚)。最後の1枚が星の軌跡写真です。`)}</Text>
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
  subtitle: { fontFamily: mono, fontSize: 11, color: DARK.textDim },
  cellRow: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, minWidth: 0, backgroundColor: DARK.fill, padding: 6, borderRadius: radius.xs },
  cellLabel: { fontFamily: mono, fontSize: 9, color: DARK.textMute },
  cellValue: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: DARK.text },
  closeBtn: { width: 32, height: 32 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 0.8, color: DARK.textMute },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { width: 'auto', height: 32, paddingHorizontal: 10 },
  chipText: { fontSize: 12, fontWeight: '700', color: DARK.text },
  card: { gap: 4, marginTop: 8, padding: 10, backgroundColor: DARK.fill, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.md },
  summary: { fontFamily: mono, fontSize: 12, color: DARK.text },
  expoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  expoText: { flex: 1, fontFamily: mono, fontSize: 11, color: DARK.textDim },
  lowCloudLine: { fontFamily: mono, fontSize: 12, color: DARK.textDim },
  peakLine: { fontFamily: mono, fontSize: 12, color: DARK.glow },
  note: { fontSize: 11, color: DARK.textDim },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, height: 38 },
  btnText: { fontSize: 13, fontWeight: '800', color: DARK.text },
});
