/**
 * SandboxMasterDial.tsx — 샌드박스 통합 7항목(날짜 · 시간 · 노출 · 줌 · 높이 · ISO · 셔터) 원통형 다이얼 슬라이더.
 *
 * 구조:
 *  1. 상단 7개 항목 셀 바: 각 항목의 이름과 현재 값을 한눈에 보여주고, 탭해서 아래 다이얼이 조작할 대상을 선택합니다.
 *  2. 중앙 현재 선택 항목 읽음 & 우측 빠른 액션 칩(지금 · 달력 · Auto/초기화).
 *  3. 하단 원통형 다이얼 트랙: 위에서 내려다본 카메라 다이얼처럼 촘촘한 눈금이 원통 투영(sin 압축 + cos^2.4 투명도 감쇠)으로
 *     그려지며, 좌우 스와이프로 선택된 항목을 드르륵(햅틱) 조절합니다.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Calendar, RotateCcw } from 'lucide-react-native';
import { color as DARK, mono } from '../../theme/tokens';
import { ACTIVE_CHIP_TEXT, GLASS, TEXT } from '../../theme/glassTokens';
import { GlassChip } from './GlassChip';
import { glassTextShadow } from './GlassSurface';
import { markDragEnd } from './dragGuard';
import { emitScrubTime } from '../../utils/liveClock';
import { hapticTick, hapticTickMajor } from '../../utils/haptics';
import {
  dateLabel,
  dateShort,
  dragTimeMs,
  markerX,
  PX_PER_HOUR,
  rulerBand,
  RULER_WIDTH,
  timeText,
  type ScoreSample,
} from '../../utils/timeRuler';
import {
  EYE_RANGE,
  fmtEye,
  fmtZoom,
  roundEye,
  roundZoom,
  tToValue,
  valueToT,
  type DialRange,
} from '../../utils/sandboxDials';
import {
  ISO_STEPS,
  SHUTTER_STEPS,
  shutterLabel,
  type ExposureAdvice,
} from '../../utils/exposureAdvice';
import { L3, type Language } from '../../utils/i18n';

export type SandboxDialParam = 'date' | 'time' | 'ev' | 'zoom' | 'height' | 'iso' | 'shutter';

const ZOOM_DIAL_RANGE: DialRange = { min: 0.6, max: 20 };
const ZOOM_MAJOR_MARKS = [0.6, 1, 1.5, 2, 3, 5, 10, 20] as const;
const EYE_MAJOR_MARKS = [1.6, 5, 10, 30, 100, 300] as const;
const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const TRACK_H = 40;

export interface SandboxMasterDialProps {
  language: Language;
  timeMs: number;
  tz: number;
  nowMs: number;
  live?: boolean;
  showNow?: boolean;
  onNow?: () => void;
  onOpenCalendar?: () => void;
  onTimeDragStart?: () => void;
  onTimeChange: (ms: number) => void;
  onTimeCommit?: (ms: number) => void;
  onDateDragStart?: () => void;
  onDatePreview: (ms: number) => void;
  onDateCommit?: (ms: number) => void;
  sunsetMs?: number | null;
  sunsetLabel?: string;
  scoreSamples?: readonly ScoreSample[] | null;
  exposure: number;
  onExposureChange: (ev: number) => void;
  zoomX: number;
  onZoomChange: (x: number) => void;
  eyeHeightM: number;
  onEyeHeightChange: (m: number) => void;
  manualIso: number | null;
  onIsoChange: (iso: number | null) => void;
  manualShutterS: number | null;
  onShutterChange: (s: number | null) => void;
  expoAdvice: ExposureAdvice | null;
}

interface DialTickItem {
  key: string | number;
  /** 정규화 선형 오프셋 (-1.15 ~ +1.15) */
  u: number;
  kind: 'major' | 'mid' | 'minor';
  label?: string;
}

/**
 * 위에서 내려다본 원통형 다이얼 투영:
 * 중심(u=0)에서는 간격이 넓고 선명하며, 양끝(|u|->1)으로 갈수록 원통 곡면을 따라 간격이 좁아지고 투명도가 크게 낮아집니다.
 */
function projectCylinderTick(u: number, width: number): { x: number; scale: number; opacity: number } | null {
  if (!Number.isFinite(u) || Math.abs(u) > 1.04) return null;
  const clamped = Math.max(-1, Math.min(1, u));
  const theta = clamped * (Math.PI * 0.465);
  const sinT = Math.sin(theta) / Math.sin(Math.PI * 0.465);
  const cosT = Math.max(0, Math.cos(theta));
  const x = width / 2 + sinT * (width / 2 - 8);
  const scale = 0.38 + 0.62 * Math.pow(cosT, 1.15);
  const opacity = Math.pow(cosT, 2.45);
  return { x, scale, opacity };
}

function nearestStepIndex(steps: readonly number[], val: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(Math.log(Math.max(1e-6, val) / Math.max(1e-6, steps[i])));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export const SandboxMasterDial: React.FC<SandboxMasterDialProps> = React.memo(({
  language,
  timeMs,
  tz,
  nowMs,
  live = false,
  showNow = false,
  onNow,
  onOpenCalendar,
  onTimeDragStart,
  onTimeChange,
  onTimeCommit,
  onDateDragStart,
  onDatePreview,
  onDateCommit,
  sunsetMs = null,
  sunsetLabel,
  scoreSamples = null,
  exposure,
  onExposureChange,
  zoomX,
  onZoomChange,
  eyeHeightM,
  onEyeHeightChange,
  manualIso,
  onIsoChange,
  manualShutterS,
  onShutterChange,
  expoAdvice,
}) => {
  const [width, setWidth] = useState(RULER_WIDTH);
  const [activeParam, setActiveParam] = useState<SandboxDialParam>('time');
  const [dialDragging, setDialDragging] = useState(false);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [liveNowMs, setLiveNowMs] = useState<number>(() => Date.now());
  const spinAnim = useRef(new Animated.Value(0)).current;

  const isLiveTicking = live && scrubMs === null && Math.abs(timeMs - liveNowMs) <= 65_000;

  useEffect(() => {
    if (!isLiveTicking) return;
    setLiveNowMs(Date.now());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const now = Date.now();
      const delay = 1000 - (now % 1000) + 16;
      timer = setTimeout(() => {
        setLiveNowMs(Date.now());
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLiveTicking]);

  useEffect(() => {
    if (!isLiveTicking) {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
      return;
    }
    spinAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 3600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [isLiveTicking, spinAnim]);

  const displayMs = scrubMs ?? (isLiveTicking ? liveNowMs : timeMs);
  const effIso = manualIso ?? expoAdvice?.iso ?? 100;
  const effShutterS = manualShutterS ?? expoAdvice?.shutterS ?? (1 / 125);

  const stateRef = useRef({
    activeParam,
    displayMs,
    timeMs,
    live,
    exposure,
    zoomX,
    eyeHeightM,
    effIso,
    effShutterS,
    manualIso,
    manualShutterS,
    onTimeDragStart,
    onTimeChange,
    onTimeCommit,
    onDateDragStart,
    onDatePreview,
    onDateCommit,
    onExposureChange,
    onZoomChange,
    onEyeHeightChange,
    onIsoChange,
    onShutterChange,
  });
  stateRef.current = {
    activeParam,
    displayMs,
    timeMs,
    live,
    exposure,
    zoomX,
    eyeHeightM,
    effIso,
    effShutterS,
    manualIso,
    manualShutterS,
    onTimeDragStart,
    onTimeChange,
    onTimeCommit,
    onDateDragStart,
    onDatePreview,
    onDateCommit,
    onExposureChange,
    onZoomChange,
    onEyeHeightChange,
    onIsoChange,
    onShutterChange,
  };

  const dragStartRef = useRef<{
    param: SandboxDialParam;
    ms: number;
    ev: number;
    zoomT: number;
    eyeT: number;
    isoIdx: number;
    shutterIdx: number;
    lastQuant: number;
    lastEmitTs: number;
  }>({
    param: 'time',
    ms: timeMs,
    ev: 0,
    zoomT: 0,
    eyeT: 0,
    isoIdx: 0,
    shutterIdx: 0,
    lastQuant: 0,
    lastEmitTs: 0,
  });

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const st = stateRef.current;
          const startMs = st.live ? Date.now() : st.timeMs;
          const isoIdx = nearestStepIndex(ISO_STEPS, st.effIso);
          const shutterIdx = nearestStepIndex(SHUTTER_STEPS, st.effShutterS);
          dragStartRef.current = {
            param: st.activeParam,
            ms: startMs,
            ev: st.exposure,
            zoomT: valueToT(st.zoomX, ZOOM_DIAL_RANGE),
            eyeT: valueToT(st.eyeHeightM, EYE_RANGE),
            isoIdx,
            shutterIdx,
            lastQuant:
              st.activeParam === 'time'
                ? Math.floor(startMs / (5 * MIN_MS))
                : st.activeParam === 'date'
                  ? 0
                  : st.activeParam === 'ev'
                    ? Math.round(st.exposure * 10)
                    : st.activeParam === 'zoom'
                      ? Math.round(valueToT(st.zoomX, ZOOM_DIAL_RANGE) * 40)
                      : st.activeParam === 'height'
                        ? Math.round(valueToT(st.eyeHeightM, EYE_RANGE) * 40)
                        : st.activeParam === 'iso'
                          ? isoIdx
                          : shutterIdx,
            lastEmitTs: 0,
          };
          setDialDragging(true);
          if (st.activeParam === 'time') {
            setScrubMs(startMs);
            st.onTimeDragStart?.();
          } else if (st.activeParam === 'date') {
            setScrubMs(startMs);
            st.onDateDragStart?.();
          }
        },
        onPanResponderMove: (_, g) => {
          const st = stateRef.current;
          const ds = dragStartRef.current;
          const now = Date.now();

          if (ds.param === 'time') {
            const ms = dragTimeMs(ds.ms, g.dx, { pxPerHour: 96, snapMin: 1 });
            const q = Math.floor(ms / (5 * MIN_MS));
            if (q !== ds.lastQuant) {
              const prevH = Math.floor((ds.lastQuant * 5) / 60);
              const nextH = Math.floor((q * 5) / 60);
              if (prevH !== nextH) hapticTickMajor();
              else hapticTick();
              ds.lastQuant = q;
            }
            setScrubMs(ms);
            emitScrubTime(ms);
            if (now - ds.lastEmitTs >= 40) {
              ds.lastEmitTs = now;
              st.onTimeChange(ms);
            }
            return;
          }

          if (ds.param === 'date') {
            // 손가락을 왼쪽(-dx)으로 밀면 다음 날(+step)
            const daySteps = Math.max(-30, Math.min(30, Math.round(-g.dx / 26)));
            if (daySteps !== ds.lastQuant) {
              if (daySteps % 7 === 0) hapticTickMajor();
              else hapticTick();
              ds.lastQuant = daySteps;
              const nextMs = ds.ms + daySteps * DAY_MS;
              setScrubMs(nextMs);
              emitScrubTime(nextMs);
              st.onDatePreview(nextMs);
            }
            return;
          }

          if (ds.param === 'ev') {
            const rawEv = Math.max(-2.0, Math.min(2.0, ds.ev - g.dx / 72));
            const snappedEv = Math.round(rawEv * 10) / 10;
            const q = Math.round(snappedEv * 10);
            if (q !== ds.lastQuant) {
              if (q % 5 === 0) hapticTickMajor();
              else hapticTick();
              ds.lastQuant = q;
              st.onExposureChange(Object.is(snappedEv, -0) ? 0 : snappedEv);
            }
            return;
          }

          if (ds.param === 'zoom') {
            const nextT = Math.max(0, Math.min(1, ds.zoomT - g.dx / 240));
            // 프리셋 줌 눈금 근처에서는 자석처럼 스냅
            let magnetPreset: number | null = null;
            let bestDist = 0.026;
            for (const preset of ZOOM_MAJOR_MARKS) {
              const pt = valueToT(preset, ZOOM_DIAL_RANGE);
              const d = Math.abs(nextT - pt);
              if (d < bestDist) {
                bestDist = d;
                magnetPreset = preset;
              }
            }
            const val = magnetPreset ?? roundZoom(tToValue(nextT, ZOOM_DIAL_RANGE));
            const q = magnetPreset != null ? 10000 + Math.round(magnetPreset * 10) : Math.round(nextT * 45);
            if (q !== ds.lastQuant) {
              if (magnetPreset != null || q % 9 === 0) hapticTickMajor();
              else hapticTick();
              ds.lastQuant = q;
              if (magnetPreset != null) {
                ds.lastEmitTs = now;
                st.onZoomChange(val);
                return;
              }
            }
            if (now - ds.lastEmitTs >= 32) {
              ds.lastEmitTs = now;
              st.onZoomChange(val);
            }
            return;
          }

          if (ds.param === 'height') {
            const nextT = Math.max(0, Math.min(1, ds.eyeT - g.dx / 240));
            const q = Math.round(nextT * 45);
            if (q !== ds.lastQuant) {
              if (q % 9 === 0) hapticTickMajor();
              else hapticTick();
              ds.lastQuant = q;
            }
            if (now - ds.lastEmitTs >= 32) {
              ds.lastEmitTs = now;
              const val = roundEye(tToValue(nextT, EYE_RANGE));
              st.onEyeHeightChange(val);
            }
            return;
          }

          if (ds.param === 'iso') {
            const deltaSteps = Math.round(-g.dx / 18);
            const idx = Math.max(0, Math.min(ISO_STEPS.length - 1, ds.isoIdx + deltaSteps));
            if (idx !== ds.lastQuant) {
              if (idx % 3 === 0) hapticTickMajor();
              else hapticTick();
              ds.lastQuant = idx;
              st.onIsoChange(ISO_STEPS[idx]);
            }
            return;
          }

          if (ds.param === 'shutter') {
            const deltaSteps = Math.round(-g.dx / 14);
            const idx = Math.max(0, Math.min(SHUTTER_STEPS.length - 1, ds.shutterIdx + deltaSteps));
            if (idx !== ds.lastQuant) {
              if (idx % 3 === 0) hapticTickMajor();
              else hapticTick();
              ds.lastQuant = idx;
              st.onShutterChange(SHUTTER_STEPS[idx]);
            }
          }
        },
        onPanResponderRelease: (_, g) => {
          markDragEnd();
          setDialDragging(false);
          const st = stateRef.current;
          const ds = dragStartRef.current;
          if (ds.param === 'time') {
            const finalMs = dragTimeMs(ds.ms, g.dx, { pxPerHour: 96, snapMin: 1 });
            setScrubMs(null);
            st.onTimeChange(finalMs);
            st.onTimeCommit?.(finalMs);
          } else if (ds.param === 'date') {
            const daySteps = Math.max(-30, Math.min(30, Math.round(-g.dx / 26)));
            const finalMs = ds.ms + daySteps * DAY_MS;
            setScrubMs(null);
            st.onDatePreview(finalMs);
            st.onDateCommit?.(finalMs);
          } else if (ds.param === 'zoom') {
            const nextT = Math.max(0, Math.min(1, ds.zoomT - g.dx / 240));
            st.onZoomChange(roundZoom(tToValue(nextT, ZOOM_DIAL_RANGE)));
          } else if (ds.param === 'height') {
            const nextT = Math.max(0, Math.min(1, ds.eyeT - g.dx / 240));
            st.onEyeHeightChange(roundEye(tToValue(nextT, EYE_RANGE)));
          }
        },
        onPanResponderTerminate: () => {
          markDragEnd();
          setDialDragging(false);
          setScrubMs(null);
        },
      }),
    [],
  );

  // ── 7개 항목 현재 표시 텍스트 ──
  const dateValText = useMemo(() => {
    const d = new Date(displayMs + tz * HOUR_MS);
    return `${d.getUTCMonth() + 1}.${String(d.getUTCDate()).padStart(2, '0')}`;
  }, [displayMs, tz]);
  const timeValText = useMemo(() => timeText(displayMs, tz, false), [displayMs, tz]);
  const evValText = `${exposure > 0 ? '+' : ''}${exposure.toFixed(1)}`;
  const zoomValText = fmtZoom(zoomX);
  const heightValText = fmtEye(eyeHeightM).replace(' m', 'm');
  const isoValText = manualIso != null ? String(manualIso) : `${effIso}A`;
  const shutterValText = manualShutterS != null ? shutterLabel(manualShutterS) : `${shutterLabel(effShutterS)}A`;

  const paramTabs: ReadonlyArray<{
    id: SandboxDialParam;
    label: string;
    value: string;
    modified: boolean;
  }> = [
    {
      id: 'date',
      label: L3(language, '날짜', 'DATE', '日付'),
      value: dateValText,
      modified: Math.abs(displayMs - nowMs) > DAY_MS * 0.8,
    },
    {
      id: 'time',
      label: L3(language, '시간', 'TIME', '時間'),
      value: timeValText,
      modified: !isLiveTicking && Math.abs(displayMs - nowMs) > 65_000,
    },
    {
      id: 'ev',
      label: L3(language, '노출', 'EV', '露出'),
      value: evValText,
      modified: Math.abs(exposure) >= 0.05,
    },
    {
      id: 'zoom',
      label: L3(language, '줌', 'ZOOM', 'ズーム'),
      value: zoomValText,
      modified: Math.abs(zoomX - 1) >= 0.05,
    },
    {
      id: 'height',
      label: L3(language, '높이', 'HGT', '高さ'),
      value: heightValText,
      modified: Math.abs(eyeHeightM - 1.6) >= 0.15,
    },
    {
      id: 'iso',
      label: 'ISO',
      value: isoValText,
      modified: manualIso != null,
    },
    {
      id: 'shutter',
      label: L3(language, '셔터', 'SHTR', 'SS'),
      value: shutterValText,
      modified: manualShutterS != null,
    },
  ];

  // ── 활성 항목에 따른 촘촘한 다이얼 눈금 생성 ──
  const dialTicks = useMemo<DialTickItem[]>(() => {
    const out: DialTickItem[] = [];
    if (activeParam === 'time') {
      // 반경 ±2.5시간, 5분 간격으로 매우 촘촘하게 (총 61개 눈금)
      const spanMs = 2.5 * HOUR_MS;
      const stepMs = 5 * MIN_MS;
      const off = tz * HOUR_MS;
      const centerSnap = isLiveTicking ? displayMs : Math.round(displayMs / MIN_MS) * MIN_MS;
      const lo = centerSnap - spanMs;
      const hi = centerSnap + spanMs;
      let t = Math.ceil((lo + off) / stepMs) * stepMs - off;
      for (; t <= hi; t += stepMs) {
        const u = (t - centerSnap) / spanMs;
        const d = new Date(t + off);
        const m = d.getUTCMinutes();
        const kind = m === 0 ? 'major' : m % 15 === 0 ? 'mid' : 'minor';
        const label = m === 0 ? `${String(d.getUTCHours()).padStart(2, '0')}:00` : undefined;
        out.push({ key: t, u, kind, label });
      }
      return out;
    }

    if (activeParam === 'date') {
      // ±7일 (6시간 단위 보조 눈금 + 자정마다 날짜 주요 눈금)
      for (let q = -28; q <= 28; q++) {
        const u = q / 14;
        if (Math.abs(u) > 1.04) continue;
        const isDay = q % 4 === 0;
        const dayShift = q / 4;
        const targetMs = displayMs + dayShift * DAY_MS;
        out.push({
          key: `d${q}`,
          u,
          kind: isDay ? 'major' : q % 2 === 0 ? 'mid' : 'minor',
          label: isDay && Math.abs(dayShift) <= 3 ? dateShort(targetMs, tz, language).split(' ')[0] : undefined,
        });
      }
      return out;
    }

    if (activeParam === 'ev') {
      // -2.0 ~ +2.0 EV, 0.1 EV 단위 눈금 (총 41개)
      for (let i = -20; i <= 20; i++) {
        const v = i / 10;
        const u = (v - exposure) / 1.5;
        if (Math.abs(u) > 1.04) continue;
        const isMajor = i % 5 === 0;
        out.push({
          key: `ev${i}`,
          u,
          kind: isMajor ? 'major' : 'minor',
          label: isMajor ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : undefined,
        });
      }
      return out;
    }

    if (activeParam === 'zoom') {
      const curT = valueToT(zoomX, ZOOM_DIAL_RANGE);
      const totalSub = 60;
      for (let i = 0; i <= totalSub; i++) {
        const t = i / totalSub;
        const u = (t - curT) / 0.45;
        if (Math.abs(u) > 1.04) continue;
        let nearMajor: number | null = null;
        for (const m of ZOOM_MAJOR_MARKS) {
          if (Math.abs(valueToT(m, ZOOM_DIAL_RANGE) - t) < 0.5 / totalSub) {
            nearMajor = m;
            break;
          }
        }
        out.push({
          key: `z${i}`,
          u,
          kind: nearMajor != null ? 'major' : i % 3 === 0 ? 'mid' : 'minor',
          label: nearMajor != null ? fmtZoom(nearMajor) : undefined,
        });
      }
      return out;
    }

    if (activeParam === 'height') {
      const curT = valueToT(eyeHeightM, EYE_RANGE);
      const totalSub = 60;
      for (let i = 0; i <= totalSub; i++) {
        const t = i / totalSub;
        const u = (t - curT) / 0.45;
        if (Math.abs(u) > 1.04) continue;
        let nearMajor: number | null = null;
        for (const m of EYE_MAJOR_MARKS) {
          if (Math.abs(valueToT(m, EYE_RANGE) - t) < 0.5 / totalSub) {
            nearMajor = m;
            break;
          }
        }
        out.push({
          key: `h${i}`,
          u,
          kind: nearMajor != null ? 'major' : i % 3 === 0 ? 'mid' : 'minor',
          label: nearMajor != null ? `${nearMajor}m` : undefined,
        });
      }
      return out;
    }

    if (activeParam === 'iso') {
      const curIdx = nearestStepIndex(ISO_STEPS, effIso);
      // 각 스텝 사이에 보조 눈금 2개씩 넣어 촘촘한 다이얼 구성
      for (let sub = 0; sub <= (ISO_STEPS.length - 1) * 2; sub++) {
        const stepPos = sub / 2;
        const u = (stepPos - curIdx) / 5.5;
        if (Math.abs(u) > 1.04) continue;
        const isStep = sub % 2 === 0;
        const idx = sub / 2;
        const isMajor = isStep && idx % 3 === 0;
        out.push({
          key: `iso${sub}`,
          u,
          kind: isMajor ? 'major' : isStep ? 'mid' : 'minor',
          label: isMajor ? String(ISO_STEPS[idx]) : undefined,
        });
      }
      return out;
    }

    // shutter
    const curIdx = nearestStepIndex(SHUTTER_STEPS, effShutterS);
    for (let i = 0; i < SHUTTER_STEPS.length; i++) {
      const u = (i - curIdx) / 9;
      if (Math.abs(u) > 1.04) continue;
      const isMajor = i % 3 === 0;
      out.push({
        key: `sh${i}`,
        u,
        kind: isMajor ? 'major' : 'minor',
        label: i % 6 === 0 ? shutterLabel(SHUTTER_STEPS[i]) : undefined,
      });
    }
    return out;
  }, [activeParam, displayMs, tz, isLiveTicking, language, exposure, zoomX, eyeHeightM, effIso, effShutterS]);

  const trackCenterMs = isLiveTicking ? displayMs : Math.round(displayMs / MIN_MS) * MIN_MS;
  const band = useMemo(
    () => (activeParam === 'time' && scoreSamples ? rulerBand(scoreSamples, trackCenterMs, width, PX_PER_HOUR) : []),
    [activeParam, scoreSamples, trackCenterMs, width],
  );
  const mx = useMemo(
    () => (activeParam === 'time' && sunsetMs != null ? markerX(trackCenterMs, sunsetMs, width, PX_PER_HOUR) : null),
    [activeParam, sunsetMs, trackCenterMs, width],
  );

  // ── 현재 선택된 항목의 중앙 읽음 문자열 ──
  const activeHeadline = useMemo(() => {
    switch (activeParam) {
      case 'date':
        return `${dateLabel(displayMs, nowMs, tz, language)} · ${dateShort(displayMs, tz, language)}`;
      case 'time':
        return timeText(displayMs, tz, isLiveTicking);
      case 'ev':
        return `${L3(language, '노출 보정', 'Exposure', '露出補正')} ${exposure > 0 ? '+' : ''}${exposure.toFixed(1)} EV`;
      case 'zoom': {
        const mm = Math.round(24 * zoomX);
        return `${fmtZoom(zoomX)} · ≈ ${mm}mm`;
      }
      case 'height':
        return `${L3(language, '카메라 높이', 'Eye Height', 'カメラ高さ')} ${fmtEye(eyeHeightM)}`;
      case 'iso':
        return `ISO ${effIso}${manualIso == null ? ` (${L3(language, '자동', 'Auto', '自動')})` : ''}`;
      case 'shutter':
        return `${shutterLabel(effShutterS)}${manualShutterS == null ? ` (${L3(language, '자동', 'Auto', '自動')})` : ''}`;
    }
  }, [activeParam, displayMs, nowMs, tz, language, isLiveTicking, exposure, zoomX, eyeHeightM, effIso, manualIso, effShutterS, manualShutterS]);

  return (
    <View
      testID="sandbox-master-dial"
      style={styles.wrap}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width) || RULER_WIDTH)}
    >
      {/* 1. 슬라이더 위 7개 항목(날짜 · 시간 · 노출 · 줌 · 높이 · ISO · 셔터) 선택 바 */}
      <View style={styles.paramStrip}>
        {paramTabs.map(tab => {
          const selected = activeParam === tab.id;
          return (
            <Pressable
              key={tab.id}
              testID={`sb-dial-tab-${tab.id}`}
              onPress={() => {
                hapticTick();
                setActiveParam(tab.id);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[
                styles.paramTab,
                selected && styles.paramTabActive,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.paramLabel,
                  selected && styles.paramLabelActive,
                  tab.modified && !selected && styles.paramLabelModified,
                  glassTextShadow,
                ]}
              >
                {tab.label}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.paramValue,
                  selected && styles.paramValueActive,
                  tab.modified && !selected && styles.paramValueModified,
                  glassTextShadow,
                ]}
              >
                {tab.value}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 2. 선택된 항목 중앙 큰 숫자 + 우측 보조 버튼(달력 / 지금 / Auto 초기화) */}
      <View style={styles.readoutRow}>
        <View style={styles.leftActions}>
          {activeParam === 'date' && onOpenCalendar ? (
            <GlassChip
              testID="ruler-date"
              icon={<Calendar size={12} color={TEXT} />}
              label={L3(language, '달력', 'Calendar', 'カレンダー')}
              onPress={onOpenCalendar}
            />
          ) : null}
        </View>

        <View pointerEvents="none" style={styles.centerReadout}>
          <Text testID="ruler-digits" style={[styles.headlineText, isLiveTicking && activeParam === 'time' ? styles.headlineLive : null, glassTextShadow]}>
            {activeHeadline}
          </Text>
        </View>

        <View style={styles.rightActions}>
          {(activeParam === 'time' || activeParam === 'date') && showNow && onNow ? (
            <GlassChip testID="ruler-now" label={L3(language, '지금', 'Now', '今')} onPress={onNow} />
          ) : null}
          {activeParam === 'ev' && Math.abs(exposure) >= 0.05 ? (
            <GlassChip
              label="0 EV"
              icon={<RotateCcw size={11} color={TEXT} />}
              onPress={() => { hapticTick(); onExposureChange(0); }}
            />
          ) : null}
          {activeParam === 'zoom' && Math.abs(zoomX - 1) >= 0.05 ? (
            <GlassChip
              label="1×"
              icon={<RotateCcw size={11} color={TEXT} />}
              onPress={() => { hapticTick(); onZoomChange(1); }}
            />
          ) : null}
          {activeParam === 'height' && Math.abs(eyeHeightM - 1.6) >= 0.15 ? (
            <GlassChip
              label="1.6m"
              icon={<RotateCcw size={11} color={TEXT} />}
              onPress={() => { hapticTick(); onEyeHeightChange(1.6); }}
            />
          ) : null}
          {activeParam === 'iso' && manualIso != null ? (
            <GlassChip
              label="Auto"
              icon={<RotateCcw size={11} color={TEXT} />}
              onPress={() => { hapticTick(); onIsoChange(null); }}
            />
          ) : null}
          {activeParam === 'shutter' && manualShutterS != null ? (
            <GlassChip
              label="Auto"
              icon={<RotateCcw size={11} color={TEXT} />}
              onPress={() => { hapticTick(); onShutterChange(null); }}
            />
          ) : null}
        </View>
      </View>

      {/* 3. 위에서 본 원통형 다이얼 트랙 (촘촘한 눈금 + 양끝 코사인 투명도 감쇠) */}
      <View
        testID="ruler-track"
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={activeHeadline}
        style={styles.track}
      >
        {/* 다이얼 원통 상·하단 림 가이드라인 */}
        <View pointerEvents="none" style={styles.dialRimTop} />
        <View pointerEvents="none" style={styles.dialRimBottom} />

        {band.map((b, i) => {
          const midU = (((b.x0 + b.x1) / 2) - width / 2) / Math.max(1, width / 2);
          const p = projectCylinderTick(midU, width);
          return (
            <View
              key={`b${i}`}
              testID="ruler-band"
              pointerEvents="none"
              style={[
                styles.band,
                {
                  bottom: dialDragging ? 31 : 24,
                  left: b.x0,
                  width: b.x1 - b.x0,
                  opacity: b.alpha * (p?.opacity ?? 0.2),
                },
              ]}
            />
          );
        })}

        {dialTicks.map(t => {
          const p = projectCylinderTick(t.u, width);
          if (!p || p.opacity <= 0.015) return null;
          const baseH = t.kind === 'major' ? 18 : t.kind === 'mid' ? 12 : 7;
          const baseA = t.kind === 'major' ? 0.96 : t.kind === 'mid' ? 0.68 : 0.42;
          const tickW = t.kind === 'major' ? 1.8 : t.kind === 'mid' ? 1.3 : 1.0;
          const activeScale = dialDragging ? 1.0 : 0.78;
          return (
            <React.Fragment key={t.key}>
              <View
                pointerEvents="none"
                style={[
                  styles.tick,
                  {
                    bottom: dialDragging ? 13 : 7,
                    left: p.x - tickW / 2,
                    width: tickW,
                    height: baseH * p.scale * activeScale,
                    backgroundColor: `rgba(241,245,249,${baseA * p.opacity * (dialDragging ? 1 : 0.85)})`,
                  },
                ]}
              />
              {t.label && p.opacity > 0.14 ? (
                <Text
                  pointerEvents="none"
                  numberOfLines={1}
                  style={[
                    styles.tickLabel,
                    {
                      left: p.x - 24,
                      opacity: p.opacity * (dialDragging ? 1 : 0.78),
                      transform: [{ scale: 0.75 + 0.25 * p.scale }],
                    },
                    glassTextShadow,
                  ]}
                >
                  {t.label}
                </Text>
              ) : null}
            </React.Fragment>
          );
        })}

        {mx !== null ? (() => {
          const sunU = (mx - width / 2) / Math.max(1, width / 2);
          const p = projectCylinderTick(sunU, width);
          if (!p) return null;
          return (
            <>
              <View pointerEvents="none" style={[styles.sunset, { bottom: dialDragging ? 27 : 20, left: p.x - 4, opacity: p.opacity }]} />
              {dialDragging && sunsetLabel ? (
                <Text pointerEvents="none" style={[styles.sunsetLabel, { left: p.x + 8, opacity: p.opacity }, glassTextShadow]}>
                  {sunsetLabel}
                </Text>
              ) : null}
            </>
          );
        })() : null}

        {/* 가운데 고정 포인터 핀 */}
        <View pointerEvents="none" style={[styles.pin, { bottom: dialDragging ? 11 : 5, left: width / 2 - 1.5 }]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    paddingTop: 2,
  },
  paramStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    gap: 3,
    marginBottom: 4,
  },
  paramTab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
  },
  paramTabActive: {
    borderColor: 'rgba(56, 189, 248, 0.75)',
    backgroundColor: `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha * 0.9})`,
  },
  paramLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(241,245,249,0.58)',
    letterSpacing: 0.2,
  },
  paramLabelActive: {
    color: ACTIVE_CHIP_TEXT,
    fontWeight: '800',
  },
  paramLabelModified: {
    color: DARK.accent,
  },
  paramValue: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '600',
    color: TEXT,
    marginTop: 1,
  },
  paramValueActive: {
    color: ACTIVE_CHIP_TEXT,
    fontWeight: '800',
  },
  paramValueModified: {
    color: DARK.accent,
  },
  readoutRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingHorizontal: 12,
    marginBottom: 1,
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 2,
  },
  centerReadout: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headlineText: {
    fontFamily: mono,
    fontSize: 13.5,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: 0.3,
  },
  headlineLive: {
    color: DARK.accent,
  },
  rightActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 2,
  },
  track: {
    height: TRACK_H,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  dialRimTop: {
    position: 'absolute',
    top: 3,
    left: 28,
    right: 28,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(241,245,249,0.12)',
  },
  dialRimBottom: {
    position: 'absolute',
    bottom: 2,
    left: 28,
    right: 28,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(241,245,249,0.16)',
  },
  tick: {
    position: 'absolute',
    borderRadius: 1,
  },
  tickLabel: {
    position: 'absolute',
    bottom: 0,
    width: 48,
    textAlign: 'center',
    fontFamily: mono,
    fontSize: 8.5,
    fontWeight: '600',
    color: TEXT,
  },
  band: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    backgroundColor: DARK.glow,
  },
  pin: {
    position: 'absolute',
    top: 3,
    width: 2.5,
    borderRadius: 2,
    backgroundColor: DARK.accent,
  },
  sunset: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: DARK.sun,
  },
  sunsetLabel: {
    position: 'absolute',
    top: 1,
    fontSize: 9,
    fontWeight: '600',
    color: TEXT,
  },
});
