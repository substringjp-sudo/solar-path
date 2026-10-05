/**
 * DevTuningPanel.tsx
 *
 * 하늘 렌더링 값을 **실제 하늘과 나란히 놓고** 맞추기 위한 개발자 패널.
 *
 * Why 필요한가: 노출·대비·감광은 물리로 정해지지 않습니다. 톤매핑과 눈 순응이
 * 끼어 있어서 선형 복사휘도를 절반으로 줄여도 화면은 거의 안 바뀔 수 있고
 * 반대도 됩니다. 결국 눈으로 맞추는 수밖에 없는데, 그때마다 상수를 고치고
 * 다시 빌드하면 감을 잡을 수가 없습니다.
 *
 * 그래서 패널은 **화면을 가리지 않아야** 합니다. 오른쪽 절반만 쓰고 배경을
 * 반투명으로 둬서, 슬라이더를 움직이는 동안 왼쪽에서 하늘이 바뀌는 것을
 * 볼 수 있게 했습니다.
 *
 * 맞춘 값은 "코드로 복사"로 뽑아 `skyTuning.ts`의 DEFAULT_TUNING에 반영하는
 * 흐름입니다 — 튜닝 결과가 코드로 돌아가야 다음 실행에도 같은 하늘이 나옵니다.
 * (그래서 일부러 저장하지 않습니다. 기기에만 남으면 남들은 다른 하늘을 봅니다.)
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  PanResponder,
  Platform,
} from 'react-native';
import { RotateCcw, Code2, X, CloudSun } from 'lucide-react-native';
import {
  getTuning,
  setTuning,
  resetTuning,
  subscribeTuning,
  tuningAsCode,
  tuningDiff,
  TUNING_GROUPS,
  DEFAULT_TUNING,
  type SkyTuning,
  type TuningField,
} from '../../utils/skyTuning';
import { useCelestialStore } from '../../store/useCelestialStore';
import { getVolumetricStatus, subscribeVolumetricStatus, type VolumetricStatus } from '../VolumetricProbe/volumetricStatus';
// 볼륨 구름 시험 화면(§123)은 개발용 빌드와 볼륨 미리보기 빌드(EXPO_PUBLIC_VOLUMETRIC_SKY=1)에서만 —
// 출시 번들에 takram·postprocessing 을 싣지 않으려고 이 조건 안에서만 불러옵니다(Metro 가 __DEV__ 와
// EXPO_PUBLIC_* 를 상수로 접어 출시 빌드에서는 이 require 를 지웁니다).
const VOLUMETRIC_BUILD = process.env.EXPO_PUBLIC_VOLUMETRIC_SKY === '1';
const VolumetricProbe: React.FC<{ visible: boolean; onClose: () => void }> | null = __DEV__ || VOLUMETRIC_BUILD
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../VolumetricProbe/VolumetricProbe').VolumetricProbe
  : null;

const TRACK_W = 148;

/**
 * 슬라이더 하나.
 *
 * `GenericSlider`를 쓰지 않는 이유: 여기서는 드래그 중에도 값이 **즉시**
 * 반영돼야 합니다(그게 이 패널의 전부입니다). 그리고 부모를 리렌더시키면
 * 3D 씬까지 다시 그려지므로, 값은 로컬 state로만 들고 스토어에는 직접 씁니다.
 */
const TuneSlider: React.FC<{
  field: TuningField;
  value: number;
  onChange: (v: number) => void;
}> = ({ field, value, onChange }) => {
  const [dragging, setDragging] = useState(false);
  const span = field.max - field.min;

  const setFromX = useCallback(
    (x: number) => {
      const t = Math.max(0, Math.min(1, x / TRACK_W));
      const raw = field.min + t * span;
      const snapped = Math.round(raw / field.step) * field.step;
      onChange(Math.max(field.min, Math.min(field.max, snapped)));
    },
    [field, span, onChange]
  );

  const pan = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // 패널 안에서는 씬 회전·탭 스와이프에 뺏기면 안 됩니다.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: evt => {
        useCelestialStore.getState().setGestureBlocked(true);
        setDragging(true);
        setFromX(evt.nativeEvent.locationX);
      },
      onPanResponderMove: evt => setFromX(evt.nativeEvent.locationX),
      onPanResponderRelease: () => {
        useCelestialStore.getState().setGestureBlocked(false);
        setDragging(false);
      },
      onPanResponderTerminate: () => {
        useCelestialStore.getState().setGestureBlocked(false);
        setDragging(false);
      },
    })
  ).current;

  const frac = Math.max(0, Math.min(1, (value - field.min) / span));
  const changed = Math.abs(value - (DEFAULT_TUNING[field.key] as number)) > 1e-9;

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={[styles.label, changed && styles.labelChanged]} numberOfLines={1}>
          {field.label}
          {field.live ? '' : ' ·재배치'}
        </Text>
        <Text style={[styles.value, changed && styles.valueChanged]}>
          {field.step >= 1 ? value.toFixed(0) : value.toFixed(2)}
        </Text>
      </View>
      <View style={styles.track} {...pan.panHandlers}>
        <View style={styles.trackBg} />
        <View style={[styles.trackFill, { width: frac * TRACK_W }]} />
        <View style={[styles.knob, { left: frac * TRACK_W - 6 }, dragging && styles.knobActive]} />
      </View>
      <Text style={styles.hint} numberOfLines={1}>{field.hint}</Text>
    </View>
  );
};

export const DevTuningPanel: React.FC<{ visible: boolean; onClose: () => void }> = ({
  visible,
  onClose,
}) => {
  const [tuning, setLocal] = useState<SkyTuning>(getTuning());
  const [showCode, setShowCode] = useState(false);
  // 볼륨 구름 시험 화면(§123) — 이 기기에서 takram 대기·구름이 도는지 잽니다.
  const [showProbe, setShowProbe] = useState(false);
  // §126.7 볼륨 하늘 — 하늘 화면의 하늘돔·구름 슬랩을 takram 대기+볼륨 구름으로 바꿉니다
  // (개발 빌드·볼륨 미리보기 빌드 전용, 미리보기 빌드는 기본 켜짐 — SkyScene3D 와 같은 규칙).
  const volumetricSky = useCelestialStore(s => s.skySettings.volumetricSky ?? VOLUMETRIC_BUILD);

  // 볼륨 하늘 상태(준비 중·동작·실패 이유) — 폰에서는 콘솔을 못 보니 여기 보여 줍니다.
  const [volStatus, setVolStatus] = useState<VolumetricStatus>(getVolumetricStatus());
  const [, setTick] = useState(0);

  useEffect(() => subscribeTuning(setLocal), []);
  useEffect(() => subscribeVolumetricStatus(setVolStatus), []);
  // 준비 중에는 경과 초를 1초마다 갱신합니다.
  useEffect(() => {
    if (!visible || volStatus.phase !== 'creating') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [visible, volStatus.phase]);

  if (!visible) return null;

  const volLine = !VolumetricProbe ? null
    : volStatus.phase === 'creating' ? `볼륨: 준비 중 ${Math.round((Date.now() - volStatus.sinceMs) / 1000)}초`
    : volStatus.phase === 'running' ? `볼륨: 동작 중${volStatus.summary ? ' · ' + volStatus.summary : ''}`
    : volStatus.phase === 'failed' ? `볼륨 실패 — ${volStatus.error ?? '이유 모름'} (VOL 을 껐다 켜면 다시 시도)`
    : volumetricSky ? '볼륨: 대기 중' : '볼륨: 꺼짐';

  const changedCount = Object.keys(tuningDiff()).length;

  return (
    <View style={styles.panel} pointerEvents="box-none">
      {showProbe && VolumetricProbe && <VolumetricProbe visible onClose={() => setShowProbe(false)} />}
      <View style={styles.card}>
        {/* 1줄: 제목과 닫기 — 패널 폭(208)에 아이콘이 다 들어가지 않아 닫기 버튼이 화면 밖으로 밀렸습니다(폰 2026-10-05). */}
        <View style={styles.header}>
          <Text style={styles.title}>개발자 튜닝</Text>
          <Text style={styles.badge}>{changedCount > 0 ? `${changedCount}개 변경` : '기본값'}</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel="개발자 튜닝 닫기" hitSlop={8}>
            <X size={16} color="#E2E8F0" />
          </TouchableOpacity>
        </View>
        {/* 2줄: 도구 */}
        <View style={styles.header}>
          {VolumetricProbe && (
            <>
              <TouchableOpacity
                onPress={() => useCelestialStore.getState().setSkySettings({ volumetricSky: !volumetricSky })}
                style={[styles.iconBtn, volumetricSky && { backgroundColor: 'rgba(52,211,153,0.35)', borderRadius: 4 }]}
                accessibilityLabel="볼륨 하늘 켜기/끄기"
              >
                <Text style={{ fontSize: 10, fontWeight: '800', color: volumetricSky ? '#34D399' : '#94A3B8' }}>VOL</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowProbe(true)} style={styles.iconBtn} accessibilityLabel="볼륨 구름 시험">
                <CloudSun size={13} color="#94A3B8" />
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity onPress={() => setShowCode(v => !v)} style={styles.iconBtn}>
            <Code2 size={13} color={showCode ? '#34D399' : '#94A3B8'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={resetTuning} style={styles.iconBtn}>
            <RotateCcw size={13} color="#94A3B8" />
          </TouchableOpacity>
        </View>
        {volLine && (
          <Text style={[styles.volLine, volStatus.phase === 'failed' && { color: '#FCA5A5' }]} selectable>
            {volLine}
          </Text>
        )}

        {/* 맞춘 값을 소스에 되돌리기 위한 출력.
            클립보드 의존성을 넣지 않고, 길게 눌러 선택 복사할 수 있게 둡니다. */}
        {showCode && (
          <ScrollView style={styles.codeBox} horizontal={false}>
            <Text style={styles.codeText} selectable>
              {tuningAsCode()}
            </Text>
          </ScrollView>
        )}

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => useCelestialStore.getState().setGestureBlocked(true)}
          onScrollEndDrag={() => useCelestialStore.getState().setGestureBlocked(false)}
        >
          {TUNING_GROUPS.map(g => (
            <View key={g.title} style={styles.group}>
              <Text style={styles.groupTitle}>{g.title}</Text>
              {g.fields.map(f => (
                <TuneSlider
                  key={f.key}
                  field={f}
                  value={tuning[f.key] as number}
                  onChange={v => setTuning({ [f.key]: v } as Partial<SkyTuning>)}
                />
              ))}
            </View>
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // 오른쪽 절반만 씁니다 — 왼쪽에서 하늘이 바뀌는 걸 봐야 조정이 됩니다.
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 208,
    zIndex: 40,
  },
  card: {
    flex: 1,
    backgroundColor: 'rgba(6, 10, 20, 0.90)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(148, 163, 184, 0.25)',
    paddingHorizontal: 10,
    paddingTop: Platform.OS === 'ios' ? 46 : 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  title: { fontSize: 12, fontWeight: '900', color: '#F1F5F9' },
  badge: { fontSize: 9, fontWeight: '700', color: '#64748B' },
  iconBtn: { padding: 4 },
  volLine: { fontSize: 9, color: '#94A3B8', marginBottom: 6 },
  codeBox: {
    maxHeight: 130,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    padding: 6,
    marginBottom: 6,
  },
  codeText: {
    fontSize: 9,
    lineHeight: 13,
    color: '#86EFAC',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  scroll: { flex: 1 },
  group: { marginBottom: 10 },
  groupTitle: {
    fontSize: 9,
    fontWeight: '900',
    color: '#38BDF8',
    letterSpacing: 1,
    marginBottom: 4,
  },
  row: { marginBottom: 9 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 10, fontWeight: '700', color: '#CBD5E1', flex: 1 },
  labelChanged: { color: '#FBBF24' },
  value: {
    fontSize: 10,
    fontWeight: '900',
    color: '#94A3B8',
    fontVariant: ['tabular-nums'],
  },
  valueChanged: { color: '#FBBF24' },
  track: {
    width: TRACK_W,
    height: 22,
    justifyContent: 'center',
    marginTop: 2,
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.28)',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#38BDF8',
  },
  knob: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
  },
  knobActive: { backgroundColor: '#38BDF8', transform: [{ scale: 1.3 }] },
  hint: { fontSize: 8.5, color: '#64748B', marginTop: 1 },
});
