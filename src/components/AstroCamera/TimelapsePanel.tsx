/**
 * TimelapsePanel.tsx — **타임랩스 설정 시트**(docs/SANDBOX_MODE_PLAN.md 8.3.1 · 목업 9). 아래에서 올라오는 **유리 시트**입니다(2026-11-21: 흐림 유리 + 글자 #F1F, 칩은 유리 칩).
 *
 * 구간 칩(일몰 60분 · 일출 60분 · 낮에서 밤으로 150분)과 영상 길이 칩(5 · 10 · 20 · 30초)을 고르면 한 줄 요약("12초마다 301장 · 영상 10초 · 360배속")과 저장 공간 어림이 보입니다.
 * "미리보기"는 3D 시뮬레이션이 그 구간을 영상 길이만큼 재생합니다(촬영 없이). "지금 시작"은 지금부터 그 총 시간 동안 간격마다 사진을 찍어 앨범에 저장합니다.
 * 영상(MP4) 만들기는 아직 없습니다: 사진 묶음으로 저장합니다. 계산은 `utils/timelapsePlan.ts`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import Svg, { Polyline } from 'react-native-svg';
import { GlassChip } from '../glass/GlassChip';
import { GlassSurface, glassTextShadow } from '../glass/GlassSurface';
import { TEXT } from '../../theme/glassTokens';
import { mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import { exposureLine, exposureStops, exposureSummary } from '../../utils/exposureCurve';
import { MIN_INTERVAL_S, STACK_RANGE, clockLabel, planTimelapse, windowLabel, type TimelapseKind, type TimelapsePlan } from '../../utils/timelapsePlan';

export const VIDEO_SEC_CHOICES = [5, 10, 20, 30] as const;
export const DURATION_MIN_CHOICES = [10, 30, 60, 300] as const;
export type DurationMinChoice = (typeof DURATION_MIN_CHOICES)[number];
const KINDS: readonly TimelapseKind[] = ['plain', 'stacked', 'trail'];

interface Props {
  visible: boolean;
  /** true 면 Modal · 외곽 시트 없이 CameraFrame 확장 패널 본문만 렌더링 */
  inline?: boolean;
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
  onPreview?: (plan: TimelapsePlan, startMs: number, endMs: number) => void;
  onStart?: (plan: TimelapsePlan) => void;
  startLabel?: string;
  initialPlan?: TimelapsePlan | null;
  onPlanChange?: (plan: TimelapsePlan) => void;
  onClose: () => void;
  /** 현재 세팅 요약 문자열이 바뀔 때 알림(줌 아래 칩 라벨 표시용) */
  onSummaryChange?: (label: string) => void;
}

export const kindLabel = (k: TimelapseKind, l: Language): string => {
  if (k === 'plain') return L3(l, '노을', 'Sunset', '夕焼け');
  if (k === 'stacked') return L3(l, '천체', 'Astro', '天体');
  return L3(l, '궤적', 'Trails', '軌跡');
};
const kindDesc = (k: TimelapseKind, l: Language): string => {
  if (k === 'plain') return L3(l, '한 장이 영상 한 프레임이에요.', 'Each photo is one video frame.', '1枚が動画の1フレームです。');
  if (k === 'stacked') return L3(l, '구간과 영상 길이에 맞춰 여러 장을 한 프레임으로 자동 합성해 밤하늘을 밝고 깨끗하게 만들어요.', 'Automatically merges multiple shots per frame based on window and video length for bright, clean night skies.', '区間と動画の長さに合わせて複数枚を1フレームに自動合成し、夜空を明るくきれいにします。');
  return L3(l, '처음 장부터 계속 쌓아 별 궤적이 점점 그려져요. 마지막 프레임이 별 일주 사진이에요.', 'Photos keep stacking so star trails draw in; the last frame is the star-trail photo.', '最初から積み重ねて星の軌跡が少しずつ描かれます。最後のフレームが星の軌跡写真です。');
};

export const durationLabel = (min: number, l: Language): string => {
  if (min === 10) return L3(l, '10분', '10m', '10分');
  if (min === 30) return L3(l, '30분', '30m', '30分');
  if (min === 60) return L3(l, '1시간', '1h', '1時間');
  if (min === 300) return L3(l, '5시간', '5h', '5時間');
  return `${min}${L3(l, '분', 'm', '分')}`;
};

/** 구간(분)과 영상 길이(초)로 한 프레임에 합칠 장수를 자동 계산합니다. */
export const autoStackSize = (totalMin: number, videoSec: number, fps: number = 30): number => {
  const raw = Math.floor((totalMin * 60) / (Math.max(1, videoSec * fps) * MIN_INTERVAL_S));
  return Math.max(STACK_RANGE.min, Math.min(STACK_RANGE.max, raw));
};

export const timelapseChipLabel = (plan: TimelapsePlan, l: Language): string => {
  const iv = `${plan.intervalS % 1 === 0 ? plan.intervalS : plan.intervalS.toFixed(1)}s`;
  const base = `${kindLabel(plan.kind, l)} · ${durationLabel(plan.totalMin, l)} · ${Math.round(plan.targetVideoSec)}${L3(l, '초', 's', '秒')} · ${iv}`;
  return plan.kind === 'stacked'
    ? `${base} · ${plan.stackSize}${L3(l, '장합성', '×stack', '枚合成')}`
    : base;
};

export const TimelapsePanel: React.FC<Props> = ({ visible, inline = false, language, events, nowMs, tzHours, peak = null, lowCloud = null, sunAltAt = null, onPreview, onStart, startLabel, initialPlan = null, onPlanChange, onClose, onSummaryChange }) => {
  const [totalMin, setTotalMin] = useState<DurationMinChoice>(() => (
    initialPlan && (DURATION_MIN_CHOICES as readonly number[]).includes(initialPlan.totalMin)
      ? (initialPlan.totalMin as DurationMinChoice)
      : 60
  ));
  const [videoSec, setVideoSec] = useState<number>(() => initialPlan?.targetVideoSec ?? 10);
  const [kind, setKind] = useState<TimelapseKind>(() => initialPlan?.kind ?? 'plain');
  useEffect(() => {
    if (!initialPlan) return;
    if ((DURATION_MIN_CHOICES as readonly number[]).includes(initialPlan.totalMin)) {
      setTotalMin(initialPlan.totalMin as DurationMinChoice);
    }
    setVideoSec(initialPlan.targetVideoSec);
    setKind(initialPlan.kind);
  }, [initialPlan]);
  const stackSize = kind === 'stacked' ? autoStackSize(totalMin, videoSec, 30) : 1;
  const plan = useMemo(() => planTimelapse({ totalMin, videoSec, fps: 30, kind, stackSize }), [totalMin, videoSec, kind, stackSize]);
  useEffect(() => { onPlanChange?.(plan); }, [plan, onPlanChange]);
  const win = useMemo(() => {
    if (kind === 'plain' && events.sunset !== null) {
      const before = Math.round(totalMin / 3);
      return { startMs: events.sunset - before * 60000, endMs: events.sunset + (totalMin - before) * 60000, totalMin };
    }
    return { startMs: nowMs, endMs: nowMs + totalMin * 60000, totalMin };
  }, [kind, events.sunset, totalMin, nowMs]);

  const chipSummary = useMemo(() => timelapseChipLabel(plan, language), [plan, language]);
  useEffect(() => { onSummaryChange?.(chipSummary); }, [chipSummary, onSummaryChange]);
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
    if (!onPreview) return;
    const startMs = win ? win.startMs : nowMs;
    const endMs = win ? win.endMs : nowMs + totalMin * 60000;
    onPreview(plan, startMs, endMs);
    onClose();
  };
  const start = () => { onStart?.(plan); onClose(); };
  // 목업 9: 부제는 구간("16:40 ~ 18:10"), 값 칸 넷, 그 아래 한 줄("시작 16:40 · 촬영 90분 · 종류")
  const subtitle = win ? windowLabel(win.startMs, win.endMs, tzHours) : `${L3(language, '지금부터', 'From now', '今から')} ${totalMin}${L3(language, '분', ' min', '分')}`;
  const startShown = win ? win.startMs : nowMs;
  const cells = [
    { label: L3(language, '간격', 'Interval', '間隔'), value: `${plan.intervalS % 1 === 0 ? plan.intervalS : plan.intervalS.toFixed(1)} s` },
    { label: L3(language, '찍는 장', 'Shots', '撮影枚数'), value: String(plan.frames) },
    ...(kind === 'stacked' ? [{ label: L3(language, '프레임 합성', 'Per frame', '1フレーム'), value: `${plan.stackSize}${L3(language, '장', '×', '枚')}` }] : []),
    { label: L3(language, '영상', 'Video', '動画'), value: `${Math.round(plan.videoSec)} s` },
    { label: L3(language, '저장', 'Saved', '保存'), value: String(plan.savedFrames) },
  ];
  const chipsOf = <T extends string | number>(items: readonly T[], isOn: (v: T) => boolean, set: (v: T) => void, label: (v: T) => string, id: (v: T) => string) => (
    <View style={styles.chips}>
      {items.map(v => (
        <GlassChip key={String(v)} testID={id(v)} label={label(v)} active={isOn(v)} onPress={() => set(v)} accessibilityLabel={label(v)} />
      ))}
    </View>
  );
  const body = (
    <>
      <Text style={styles.label}>{L3(language, '종류', 'TYPE', '種類')}</Text>
      {chipsOf(KINDS, v => kind === v, setKind, v => kindLabel(v, language), v => `tl-kind-${v}`)}
      <Text style={styles.note}>{kindDesc(kind, language)}</Text>
      <Text style={[styles.label, { marginTop: 8 }]}>{L3(language, '구간', 'WINDOW', '区間')}</Text>
      {chipsOf(DURATION_MIN_CHOICES, v => totalMin === v, setTotalMin, v => durationLabel(v, language), v => `tl-dur-${v}`)}
      <Text style={[styles.label, { marginTop: 8 }]}>{L3(language, '영상 길이', 'VIDEO LENGTH', '動画の長さ')}</Text>
      {chipsOf(VIDEO_SEC_CHOICES, v => videoSec === v, setVideoSec, v => `${v}${L3(language, '초', ' s', '秒')}`, v => `tl-video-${v}`)}
      <View testID="tl-card" style={styles.card}>
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
              <Polyline points={expo.line} fill="none" stroke={TEXT} strokeWidth={2} />
            </Svg>
            <Text style={styles.expoText}>{`${L3(language, '밝기', 'Light', '明るさ')} ${expo.total > 0 ? '+' : '−'}${Math.abs(expo.total).toFixed(1)}${L3(language, '단', ' stops', '段')} · ${L3(language, '맑은 하늘 기준 어림', 'clear-sky estimate', '快晴の目安')}`}</Text>
          </View>
        ) : null}
        {lowCloud && kind === 'plain' ? (
          <Text style={styles.lowCloudLine}>{`${L3(language, '낮은 구름 두꺼움', 'Low cloud thick', '低い雲が厚い')} ${windowLabel(lowCloud.fromMs, lowCloud.toMs, tzHours)}`}</Text>
        ) : null}
        {peak && kind === 'plain' ? (
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
      {(onPreview || onStart) && (
        <View style={styles.actions}>
          {onPreview && (
            <GlassChip testID="tl-preview" label={L3(language, '미리보기', 'Preview', 'プレビュー')} onPress={preview} accessibilityLabel={L3(language, '미리보기: 시뮬레이션으로 재생', 'Preview: play the simulation', 'プレビュー: シミュレーションで再生')} style={styles.btn} />
          )}
          {onStart && (
            <GlassChip testID="tl-start" label={startLabel ?? L3(language, '지금 시작', 'Start now', '今すぐ開始')} active onPress={start} accessibilityLabel={startLabel ?? L3(language, '지금 시작: 지금부터 촬영', 'Start now', '今すぐ開始')} style={styles.btn} />
          )}
        </View>
      )}
    </>
  );

  if (inline) return <View style={styles.inlineWrap}>{body}</View>;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} />
        {/* 유리 시트(2026-11-21): 카메라가 비치는 흐림 유리 위에 글자는 모두 #F1F5F9. 켜진 칩은 하늘색 덧칠. */}
        <GlassSurface testID="tl-sheet" style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title}>{L3(language, '타임랩스', 'Timelapse', 'タイムラプス')}</Text>
              <Text style={styles.subtitle}>{`${kindLabel(kind, language)} · ${subtitle}`}</Text>
            </View>
            <GlassChip testID="tl-close" label="" icon={<X size={18} color={TEXT} />} onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} style={styles.closeBtn} />
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {body}
          </ScrollView>
        </GlassSurface>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  inlineWrap: { gap: 4 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '80%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 16, fontWeight: '800', color: TEXT, ...glassTextShadow },
  subtitle: { fontFamily: mono, fontSize: 11, color: TEXT, ...glassTextShadow },
  cellRow: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, minWidth: 0, backgroundColor: 'rgba(255,255,255,0.08)', padding: 6, borderRadius: radius.sm },
  cellLabel: { fontFamily: mono, fontSize: 10, color: TEXT, ...glassTextShadow },
  cellValue: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: TEXT, ...glassTextShadow },
  closeBtn: { width: 44, minHeight: 44, borderRadius: 22, paddingHorizontal: 0 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 6 },
  label: { fontFamily: mono, fontSize: 10, letterSpacing: 0.8, color: TEXT, ...glassTextShadow },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  card: { gap: 4, marginTop: 8, padding: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.md },
  summary: { fontFamily: mono, fontSize: 12, color: TEXT, ...glassTextShadow },
  expoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  expoText: { flex: 1, fontFamily: mono, fontSize: 11, color: TEXT, ...glassTextShadow },
  lowCloudLine: { fontFamily: mono, fontSize: 12, color: TEXT, ...glassTextShadow },
  peakLine: { fontFamily: mono, fontSize: 12, color: TEXT, ...glassTextShadow },
  note: { fontSize: 11, color: TEXT, ...glassTextShadow },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, minHeight: 44, borderRadius: 22 },
});
