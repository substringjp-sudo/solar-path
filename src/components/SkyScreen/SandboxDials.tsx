/**
 * SandboxDials.tsx — 샌드박스의 **세로 막대(높이 · 줌)** 와 **이동 조이스틱**(docs/SANDBOX_MODE_PLAN.md 2.2, 목업 2번).
 * 계산(로그 눈금 · 눈금에 붙이기 · 반올림 · 조이스틱 방향과 반복 간격)은 `utils/sandboxDials.ts` 에서 하고, 여기는 손가락을 받아 그립니다.
 *
 *  - 세로 막대: 누르거나 끌면 그 높이의 값이 됩니다. 놓을 때 눈금 가까이면 그 눈금 값으로 붙습니다. 끄는 동안은 12 번/초 안쪽으로만 값을 내보냅니다
 *    (값이 바뀔 때마다 하늘 화면 전체가 다시 그려지므로).
 *  - 조이스틱: 민 방향으로 누르고 있는 동안 걸음 크기만큼씩 반복해서 움직입니다. 방향은 나침반 기준(위 = 북). `relative` 면 글만 "앞" 으로 바뀝니다 — 시선 기준으로
 *    돌리는 일은 부르는 쪽(`SandboxPanel`)이 `onMove` 로 받은 걸음을 돌려서 합니다.
 *  - 읽음 줄(`ViewReadout`): 지금 시선의 방위 · 앙각 · 눈 높이. 장면이 시선을 알려 주는 함수(`getView`)를 5 번/초 읽고, 읽을 만큼 바뀔 때만 다시 그립니다.
 *  - 손가락 자리는 **바깥 누름 영역**에서 읽고(그림은 `pointerEvents="none"`) 화면 좌표(`moveX`/`moveY`)로 잇습니다 — `ScrubTrack` 머리말의
 *    `locationX` 가 닿은 자식 기준으로 어긋나는 결함을 피합니다.
 *  - 스크린리더: 막대는 올리기·내리기가 한 눈금씩, 조이스틱은 북·동·남·서 동작이 한 걸음씩입니다.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import {
  EYE_RANGE, EYE_TICKS, ZOOM_RANGE, ZOOM_TICKS,
  clampKnob, fmtAz, fmtEl, fmtEye, fmtZoom, roundEye, roundZoom, snapValue, stepMove, stepToTick, stickIntervalMs, stickState, tFromY, tToValue, valueToT, viewDiffers, yFromT,
  type DialRange, type StickState, type ViewAzEl,
} from '../../utils/sandboxDials';

type Lang = 'ko' | 'en' | 'ja';
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const gestureBlock = (on: boolean) => useCelestialStore.getState().setGestureBlocked(on);

/** 끄는 동안 값을 내보내는 가장 빠른 속도(ms). 마지막(손을 뗄 때) 값은 항상 내보냅니다. */
const DIAL_EMIT_MS = 80;

// ── 세로 막대 하나 ───────────────────────────────────────────────────────────

interface DialProps {
  label: string;
  valueText: string;
  /** 지금 위치 0(아래) ~ 1(위) */
  t: number;
  tickTs: readonly number[];
  onChange: (t: number, final: boolean) => void;
  onStep: (dir: 1 | -1) => void;
  accessibilityLabel: string;
  height?: number;
}

const DIAL_W = 36;
const KNOB = 18;

export const VerticalDial: React.FC<DialProps> = ({ label, valueText, t, tickTs, onChange, onStep, accessibilityLabel, height = 150 }) => {
  const cb = useRef({ onChange, onStep, height });
  cb.current = { onChange, onStep, height };
  const tRef = useRef(t);
  tRef.current = t;
  const startT = useRef(0);
  const lastEmit = useRef(0);

  const emit = (v: number, final: boolean) => {
    const now = Date.now();
    if (!final && now - lastEmit.current < DIAL_EMIT_MS) return;
    lastEmit.current = now;
    cb.current.onChange(clamp01(v), final);
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      gestureBlock(true);
      const y = e.nativeEvent.locationY;
      startT.current = Number.isFinite(y) ? tFromY(y - KNOB / 2, cb.current.height) : tRef.current;
      lastEmit.current = 0;
      emit(startT.current, false);
    },
    onPanResponderMove: (_e, g) => emit(startT.current - g.dy / cb.current.height, false),
    onPanResponderRelease: (_e, g) => { gestureBlock(false); emit(startT.current - g.dy / cb.current.height, true); },
    onPanResponderTerminate: (_e, g) => { gestureBlock(false); emit(startT.current - g.dy / cb.current.height, true); },
  })).current;

  const y = yFromT(t, height);
  return (
    <View style={styles.dialCol}>
      <Text style={styles.dialLabel}>{label}</Text>
      <View
        {...pan.panHandlers}
        style={{ width: DIAL_W, height: height + KNOB }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => cb.current.onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        {/* 트랙은 위아래로 손잡이 반지름(KNOB / 2)만큼 안쪽에서 시작합니다 — 손잡이가 끝에 가도 위 이름과 아래 값 글자를 가리지 않게. */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: KNOB / 2, bottom: KNOB / 2 }]}>
          <View style={[styles.track, { left: (DIAL_W - 6) / 2, height }]} />
          <View style={[styles.trackFill, { left: (DIAL_W - 6) / 2, top: y, height: Math.max(0, height - y) }]} />
          {tickTs.map((k, i) => (
            <View key={i} style={[styles.tick, { top: yFromT(k, height) - 0.5 }]} />
          ))}
          <View style={[styles.knob, { left: (DIAL_W - KNOB) / 2, top: y - KNOB / 2 }]} />
        </View>
      </View>
      <Text style={styles.dialValue}>{valueText}</Text>
    </View>
  );
};

// ── 높이 · 줌 한 쌍 ──────────────────────────────────────────────────────────

interface PairProps {
  language: Lang;
  eyeHeightM: number;
  onEyeHeight: (m: number) => void;
  zoomX: number;
  onZoom: (x: number) => void;
}

const tOf = (v: number, r: DialRange) => valueToT(v, r);

export const DialPair: React.FC<PairProps> = ({ language, eyeHeightM, onEyeHeight, zoomX, onZoom }) => {
  const eyeTicks = useMemo(() => EYE_TICKS.map(k => tOf(k, EYE_RANGE)), []);
  const zoomTicks = useMemo(() => ZOOM_TICKS.map(k => tOf(k, ZOOM_RANGE)), []);
  const eyeLabel = L3(language, '높이', 'Height', '高さ');
  const zoomLabel = L3(language, '줌', 'Zoom', 'ズーム');
  return (
    <View style={styles.pair} pointerEvents="box-none">
      <VerticalDial
        label={eyeLabel}
        valueText={fmtEye(eyeHeightM)}
        t={tOf(eyeHeightM, EYE_RANGE)}
        tickTs={eyeTicks}
        onChange={(t, final) => { const v = roundEye(tToValue(t, EYE_RANGE)); onEyeHeight(final ? snapValue(v, EYE_RANGE, EYE_TICKS) : v); }}
        onStep={(dir) => onEyeHeight(stepToTick(eyeHeightM, EYE_TICKS, dir))}
        accessibilityLabel={L3(language, '눈 높이', 'Eye height', '目の高さ')}
      />
      <VerticalDial
        label={zoomLabel}
        valueText={fmtZoom(zoomX)}
        t={tOf(zoomX, ZOOM_RANGE)}
        tickTs={zoomTicks}
        onChange={(t, final) => { const v = roundZoom(tToValue(t, ZOOM_RANGE)); onZoom(final ? snapValue(v, ZOOM_RANGE, ZOOM_TICKS) : v); }}
        onStep={(dir) => onZoom(stepToTick(zoomX, ZOOM_TICKS, dir))}
        accessibilityLabel={L3(language, '망원 배율', 'Telephoto zoom', '望遠倍率')}
      />
    </View>
  );
};

// ── 이동 조이스틱 ────────────────────────────────────────────────────────────

interface StickProps {
  language: Lang;
  /** 한 걸음의 크기(m) */
  stepM: number;
  /** 동쪽(+) · 북쪽(+) 미터 */
  onMove: (eastM: number, northM: number) => void;
  /** 시선 기준으로 쓰는 중 — 위쪽 글이 "N" 대신 "앞", 스크린리더 동작이 앞으로 · 오른쪽으로 · 뒤로 · 왼쪽으로. */
  relative?: boolean;
}

const STICK = 96;
const STICK_KNOB = 38;
const TRAVEL = (STICK - STICK_KNOB) / 2;
const OFF: StickState = { active: false, east: 0, north: 0, mag: 0 };

export const MoveStick: React.FC<StickProps> = ({ language, stepM, onMove, relative = false }) => {
  const cb = useRef({ stepM, onMove });
  cb.current = { stepM, onMove };
  const state = useRef<StickState>(OFF);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const center = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const loop = () => {
    timer.current = null;
    const s = state.current;
    if (!s.active) return;
    const m = stepMove(s, cb.current.stepM);
    cb.current.onMove(m.eastM, m.northM);
    timer.current = setTimeout(loop, stickIntervalMs(s.mag));
  };
  const stop = () => {
    state.current = OFF;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setKnob({ x: 0, y: 0 });
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const track = (moveX: number, moveY: number) => {
    const dx = moveX - center.current.x, dy = moveY - center.current.y;
    setKnob(clampKnob(dx, dy, TRAVEL));
    const was = state.current.active;
    state.current = stickState(dx, dy, TRAVEL);
    if (state.current.active && !was && !timer.current) loop();   // 움직이기 시작하는 순간 바로 한 걸음
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e, g) => {
      gestureBlock(true);
      const ne = e.nativeEvent;
      // 누른 자리와 누름 영역 안 자리의 차로 중심의 화면 좌표를 얻습니다(그림은 터치를 안 받으므로 누름 영역 기준).
      center.current = { x: ne.pageX - ne.locationX + STICK / 2, y: ne.pageY - ne.locationY + STICK / 2 };
      track(g.x0, g.y0);
    },
    onPanResponderMove: (_e, g) => track(g.moveX, g.moveY),
    onPanResponderRelease: () => { gestureBlock(false); stop(); },
    onPanResponderTerminate: () => { gestureBlock(false); stop(); },
  })).current;

  const dirs: { name: string; label: string; e: number; n: number }[] = relative ? [
    { name: 'north', label: L3(language, '앞으로', 'Forward', '前へ'), e: 0, n: 1 },
    { name: 'east', label: L3(language, '오른쪽으로', 'Right', '右へ'), e: 1, n: 0 },
    { name: 'south', label: L3(language, '뒤로', 'Back', '後ろへ'), e: 0, n: -1 },
    { name: 'west', label: L3(language, '왼쪽으로', 'Left', '左へ'), e: -1, n: 0 },
  ] : [
    { name: 'north', label: L3(language, '북쪽으로', 'North', '北へ'), e: 0, n: 1 },
    { name: 'east', label: L3(language, '동쪽으로', 'East', '東へ'), e: 1, n: 0 },
    { name: 'south', label: L3(language, '남쪽으로', 'South', '南へ'), e: 0, n: -1 },
    { name: 'west', label: L3(language, '서쪽으로', 'West', '西へ'), e: -1, n: 0 },
  ];
  return (
    <View
      {...pan.panHandlers}
      style={styles.stick}
      accessible
      accessibilityLabel={L3(language, '위치 이동 조이스틱', 'Move joystick', '位置移動ジョイスティック')}
      accessibilityHint={relative
        ? L3(language, '누르고 밀면 보는 방향 기준으로 움직입니다', 'Press and push to move relative to where you look', '押して倒すと視線を基準に動きます')
        : L3(language, '누르고 밀면 그 방향으로 움직입니다', 'Press and push to move that way', '押して倒すとその方向へ動きます')}
      accessibilityActions={dirs.map(d => ({ name: d.name, label: d.label }))}
      onAccessibilityAction={(e) => { const d = dirs.find(x => x.name === e.nativeEvent.actionName); if (d) cb.current.onMove(d.e * cb.current.stepM, d.n * cb.current.stepM); }}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.crossV} />
        <View style={styles.crossH} />
        <Text style={styles.north}>{relative ? L3(language, '앞', 'Fwd', '前') : 'N'}</Text>
        <View style={[styles.stickKnob, { left: (STICK - STICK_KNOB) / 2 + knob.x, top: (STICK - STICK_KNOB) / 2 + knob.y }]} />
      </View>
    </View>
  );
};

// ── 시선 읽음 줄 ─────────────────────────────────────────────────────────────

interface ReadoutProps {
  language: Lang;
  /** 장면이 알려 주는 지금 시선(방위 · 앙각). 아직 못 알려 주면 null. */
  getView: () => ViewAzEl | null;
  /** 눈 높이(m, 땅 위) */
  eyeHeightM: number;
  /** 시선을 읽는 간격(ms) */
  intervalMs?: number;
}

/**
 * 지금 시선의 방위 · 앙각과 눈 높이를 한 줄로(목업 2번 위 줄의 "AZ 128.4° EL 6.9°"). 시선은 장면 손잡이(`getView`)에서 `intervalMs` 마다 읽되,
 * 읽을 만큼(0.05°) 바뀔 때만 상태를 바꿔 이 줄만 다시 그립니다 — 하늘 화면 전체가 다시 그려지지 않습니다.
 */
export const ViewReadout: React.FC<ReadoutProps> = ({ language, getView, eyeHeightM, intervalMs = 200 }) => {
  const get = useRef(getView);
  get.current = getView;
  const [v, setV] = useState<ViewAzEl | null>(() => get.current());
  useEffect(() => {
    const tick = () => {
      const n = get.current();
      setV(p => (viewDiffers(p, n) ? (n ? { az: n.az, el: n.el } : null) : p));
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  const azT = v ? fmtAz(v.az) : '—';
  const elT = v ? fmtEl(v.el) : '—';
  const eyeLabel = L3(language, '눈', 'EYE', '目');
  return (
    <View
      style={styles.readout}
      accessible
      accessibilityLabel={L3(
        language,
        `시선 방위 ${azT}도, 앙각 ${elT}도, 눈 높이 ${fmtEye(eyeHeightM)}`,
        `View azimuth ${azT} degrees, elevation ${elT} degrees, eye height ${fmtEye(eyeHeightM)}`,
        `視線の方位 ${azT}度、仰角 ${elT}度、目の高さ ${fmtEye(eyeHeightM)}`,
      )}
    >
      <Text style={[styles.readoutText, styles.readoutAz]}>{v ? `AZ ${azT}°` : 'AZ —'}</Text>
      <Text style={[styles.readoutText, styles.readoutEl]}>{v ? `EL ${elT}°` : 'EL —'}</Text>
      <Text style={styles.readoutText}>{`${eyeLabel} ${fmtEye(eyeHeightM)}`}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pair: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    paddingHorizontal: 6, paddingVertical: 6,
    backgroundColor: DARK.overlay, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.sm,
  },
  dialCol: { alignItems: 'center', gap: 2 },
  dialLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 0.6, color: DARK.textMute },
  dialValue: { fontFamily: mono, fontSize: 10, fontWeight: '700', color: DARK.text },
  track: { position: 'absolute', top: 0, width: 6, borderRadius: 3, backgroundColor: DARK.border },
  trackFill: { position: 'absolute', width: 6, borderRadius: 3, backgroundColor: DARK.accentLine },
  tick: { position: 'absolute', left: 4, right: 4, height: 1, backgroundColor: DARK.borderStrong },
  knob: { position: 'absolute', width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: DARK.accent, borderColor: '#04121C', borderWidth: 2 },
  stick: {
    width: STICK, height: STICK, borderRadius: STICK / 2,
    backgroundColor: DARK.overlay, borderColor: DARK.border, borderWidth: 1,
  },
  crossV: { position: 'absolute', left: STICK / 2 - 0.5, top: 10, bottom: 10, width: 1, backgroundColor: DARK.border },
  crossH: { position: 'absolute', top: STICK / 2 - 0.5, left: 10, right: 10, height: 1, backgroundColor: DARK.border },
  readout: {
    flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 8,
    paddingHorizontal: 6, paddingVertical: 4,
    backgroundColor: DARK.overlay, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.xs,
  },
  readoutText: { fontFamily: mono, fontSize: 11, color: DARK.text },
  // 숫자 길이가 달라도 줄 폭이 흔들리지 않게(등폭 글꼴 기준 9 글자)
  readoutAz: { minWidth: 62 },
  readoutEl: { minWidth: 62 },
  north: { position: 'absolute', top: 2, left: 0, right: 0, textAlign: 'center', fontFamily: mono, fontSize: 9, fontWeight: '700', color: DARK.textDim },
  stickKnob: { position: 'absolute', width: STICK_KNOB, height: STICK_KNOB, borderRadius: STICK_KNOB / 2, backgroundColor: DARK.accent, borderColor: '#04121C', borderWidth: 2, opacity: 0.92 },
});
