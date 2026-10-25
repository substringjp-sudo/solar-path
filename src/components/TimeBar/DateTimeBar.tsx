/**
 * DateTimeBar.tsx — 화면 아래의 **날짜 + 시간 막대 한 벌**(옛 날짜 슬라이더 + `TimeSlider` 를 합침, §143).
 *
 *   ┌ [‹] [달력 2026.10.16 (금)      ● SIM] [›] [⌄] ┐   ← 1행: 날짜. ⌄ 는 1년 막대를 펼칩니다
 *   │ [‹‹] ━━━ 날짜(1년) 트랙 — 펼쳤을 때만 ━━━ [››] │
 *   │ [‹] ━━━ 시간(하루) 트랙: 낮·노을·밤 + 정확도 띠 ━━━ [›] │   ← 2행: 시각
 *   │ [● +2일 ⓘ] [⚡ 지금] [━━━━━━ 촬영 ━━━━━━] │   ← 3행: 정확도 칩 · 지금(SIM 일 때) · 주 버튼
 *   └────────────────────────────────────────────┘
 *
 * - **누르는 것은 모두 40(touch).** 예전 한 줄 배치(22~28px 버튼 7개)는 시스템 최소 크기에 못 미쳐 세 줄로 나눴습니다.
 *   "지금"·"촬영"은 해 색(sun) 채움이었는데, sun 은 데이터 색이라 "지금"은 보조 버튼, "촬영"은 주 버튼(accent)입니다.
 *
 * - **정확도 띠.** 두 트랙 모두 위에 "지금으로부터 얼마나 떨어졌나"(리드타임) 띠가 있습니다. 색이 아니라 **무늬**로
 *   가릅니다(디자인 개정 A3): 과거(재분석) · 3일 안 = 꽉 찬 선, 7일 안 = 긴 점선, 16일 안 = 짧은 점선, 자료 없음 = 옅은 선.
 *   칸 사이는 정확한 시각에서 끊습니다.
 * - **일몰 앞뒤 확대.** 시간 줄 끝의 해 단추를 누르면 막대가 일몰(밤이고 일출 전이면 일출) 앞뒤 3시간으로 좁아집니다.
 *   노을이 몰리는 몇십 분이 하루 막대에서는 몇 px 뿐이었습니다. 단추로 범위를 벗어나면 하루로 돌아갑니다.
 *   범례는 칩(ⓘ)을 누르면 펼쳐집니다. 등급의 근거와 한계는 `utils/timeBar.ts` 머리말에 적었습니다.
 * - **데이터 기간.** 날씨를 받을 수 있는 끝(지금 + 16일)이 날짜 트랙에서 색이 끊기는 자리이고, 칩이 그 날짜를 적습니다.
 * - **한 칸씩.** ±1일 · ±1시간 · ±1년. 누르고 있으면 반복합니다(시간·날짜는 빠르게, 연도는 천천히).
 *   2/29 는 평년에서 2/28, 시간은 자정을 넘으면 날짜가 같이 갑니다.
 * - **가볍게.** 손잡이는 네이티브로 움직이고, 앱 전체 상태(시각)는 손을 움직이는 동안 초당 약 11번만 바꿉니다
 *   (`createCommitThrottle`). 손을 떼면 마지막 값이 바로 나갑니다.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { Calendar, Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft, ChevronsRight, Info, Sunrise, Sunset, Zap } from 'lucide-react-native';
import { PressScale, PrimaryButton } from '../ui';
import { ScrubTrack } from './ScrubTrack';
import { crossesMarker, hapticTick } from '../../utils/haptics';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3 } from '../../utils/i18n';
import { radius, space, type, tint, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';
import {
  MS_HOUR, MS_MIN, TIER_LEAD_HOURS, FORECAST_DAYS, DATA_START_MS,
  type AccuracyTier, type TierSegment,
  tierAt, dataWindow, yearTierSegments, tierSegmentsBetween, nowPctInYear,
  dayIndexPct, daysInYear, shiftDays, shiftHours, shiftYears, withLocalDayOfYear, withLocalMinutes, localDayStartMs,
  dayPhaseSegments, minuteInDay, createCommitThrottle,
} from '../../utils/timeBar';

export type ScrubKind = 'date' | 'time';

export interface BarEvents {
  sunrise?: Date | null; sunset?: Date | null; moonrise?: Date | null; moonset?: Date | null;
}

interface Props {
  currentTime: Date;
  /** 사용자가 고른 시각 — `scrub` 이 있으면 손잡이를 끄는 중(날씨 요청을 미루는 쪽이 구분합니다). */
  onPick: (time: Date, meta?: { scrub?: ScrubKind }) => void;
  onSlidingStart?: (kind: ScrubKind) => void;
  onSlidingComplete?: (kind: ScrubKind) => void;
  isTimeMachineEnabled: boolean;
  onNow: () => void;
  onOpenDatePicker?: () => void;
  onCameraPress?: () => void;
  events?: BarEvents | null;
  /** 절기 표시(날짜 트랙 위 점) */
  seasonPcts?: { key: string; pct: number; color: string }[];
}

const WEEKDAYS = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
} as const;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 지금 시각을 분 단위로 따라가는 값 — 정확도 띠의 "지금" 위치. */
function useNowMs(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 누르면 한 칸, 누르고 있으면 반복하는 작은 버튼. */
const StepButton: React.FC<{
  onStep: () => void; icon: React.ReactNode; label: string; slow?: boolean;
}> = ({ onStep, icon, label, slow }) => {
  const styles = useStyles();
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledByPressIn = useRef(false);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stop, []);
  const start = () => {
    stop();
    let n = 0;
    const tick = () => {
      stepRef.current();
      n++;
      // 오래 누르면 빨라집니다(연도는 처음부터 느리게).
      const gap = slow ? 260 : n > 12 ? 55 : n > 5 ? 85 : 120;
      timer.current = setTimeout(tick, gap);
    };
    timer.current = setTimeout(tick, 380);
  };
  return (
    <PressScale
      onPressIn={() => { handledByPressIn.current = true; stepRef.current(); start(); }}
      onPressOut={stop}
      // 스크린리더의 "활성화" 는 pressIn 없이 onPress 만 부릅니다.
      onPress={() => { if (!handledByPressIn.current) stepRef.current(); handledByPressIn.current = false; }}
      accessibilityLabel={label}
      style={styles.stepBtn}
    >
      {icon}
    </PressScale>
  );
};

/**
 * 정확도(리드타임) 등급은 **색이 아니라 무늬**입니다(디자인 개정 A3). 예전에는 달 · 성공 · 경고 · 노을 색을
 * 빌려 칠해, 노을색이 "정확도 낮음"을 뜻하는 자리가 생겼습니다.
 *   지난 날 · 3일 안 = 꽉 찬 선 · 7일 안 = 긴 점선 · 16일 안 = 짧은 점선 · 자료 없음 = 옅은 선
 */
const TIER_DASH: Record<AccuracyTier, string | undefined> = { past: undefined, high: undefined, medium: '6 3', low: '2 3', none: undefined };
const TIER_OPACITY: Record<AccuracyTier, number> = { past: 1, high: 1, medium: 1, low: 1, none: 0.3 };

/** 0~100 위의 등급 띠(무늬). 폭을 재서 점선 길이가 화면 폭과 상관없이 같게 그립니다. */
const TierBand: React.FC<{ segs: TierSegment[]; color: string; height: number }> = ({ segs, color, height }) => {
  const [w, setW] = useState(0);
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height }} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {segs.map((s, i) => (
            <Line
              key={`${s.tier}-${i}`}
              x1={(s.from / 100) * w} x2={(s.to / 100) * w} y1={height / 2} y2={height / 2}
              stroke={color} strokeWidth={height} strokeDasharray={TIER_DASH[s.tier]} strokeOpacity={TIER_OPACITY[s.tier]}
            />
          ))}
        </Svg>
      )}
    </View>
  );
};

/** 칩·범례의 작은 견본 — 띠와 같은 무늬. */
const TierSwatch: React.FC<{ tier: AccuracyTier; color: string; width?: number; height?: number }> = ({ tier, color, width = 16, height = 4 }) => (
  <Svg width={width} height={height}>
    <Line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke={color} strokeWidth={height} strokeDasharray={TIER_DASH[tier]} strokeOpacity={TIER_OPACITY[tier]} />
  </Svg>
);

/** 일몰(일출) 앞뒤 3시간 — 노을이 몰리는 몇십 분이 막대의 넓은 몫을 차지하게 확대합니다. */
const ZOOM_SPAN_MIN = 180;
function eventWindow(minutes: number, sunriseMin: number | null, sunsetMin: number | null) {
  const side: 'sunrise' | 'sunset' = sunriseMin != null && minutes < sunriseMin ? 'sunrise' : 'sunset';
  const at = side === 'sunrise' ? sunriseMin : sunsetMin;
  if (at == null) return null;
  const start = Math.max(0, Math.min(1440 - ZOOM_SPAN_MIN, side === 'sunset' ? at - 120 : at - 60));
  return { side, at, from: start, to: start + ZOOM_SPAN_MIN };
}

export const DateTimeBar: React.FC<Props> = ({
  currentTime, onPick, onSlidingStart, onSlidingComplete, isTimeMachineEnabled, onNow, onOpenDatePicker,
  onCameraPress, events, seasonPcts = [],
}) => {
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles();
  const language = useCelestialStore(s => s.language);
  const tz = useCelestialStore(s => s.timezoneOffsetHours) ?? 0;
  const tzLabel = useCelestialStore(s => s.timezoneLabel);
  const nowMs = useNowMs();
  // 정확도 띠는 10분 단위로만 다시 셉니다(분마다 지금이 움직여도 눈에 안 보입니다).
  const nowBucket = Math.floor(nowMs / (10 * MS_MIN)) * (10 * MS_MIN);
  const [legendOpen, setLegendOpen] = useState(false);
  const [showYearTrack, setShowYearTrack] = useState(false);

  const tMs = currentTime.getTime();
  const year = new Date(tMs + tz * MS_HOUR).getUTCFullYear();
  const dayStart = localDayStartMs(tMs, tz);
  const minutes = Math.floor((tMs - dayStart) / MS_MIN);

  const bandColor = color.textDim;

  // ── 시간 막대 범위: 하루(기본) 또는 일몰·일출 앞뒤 3시간 ───────────────────
  const evMin = (d?: Date | null) => minuteInDay(d ? d.getTime() : null, dayStart);
  const sunriseMin = evMin(events?.sunrise), sunsetMin = evMin(events?.sunset);
  const [zoom, setZoom] = useState(false);
  const zoomWin = eventWindow(minutes, sunriseMin, sunsetMin);
  const range = zoom && zoomWin ? { from: zoomWin.from, to: zoomWin.to } : { from: 0, to: 1440 };
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const pctOfMin = (m: number) => ((m - range.from) / (range.to - range.from)) * 100;
  const zoomArmedAt = useRef(0);

  // ── 최신 값은 ref 로(손잡이·반복 버튼의 콜백이 낡은 값을 보지 않게) ──────────────
  const tRef = useRef(tMs);
  const busyRef = useRef(0);               // 손잡이를 쥐었거나 반복 중인 동안 props 로 덮지 않습니다.
  if (!busyRef.current) tRef.current = tMs;
  const yearRef = useRef(year);
  yearRef.current = year;
  const tzRef = useRef(tz);
  tzRef.current = tz;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const dateThrottle = useRef(createCommitThrottle<number>(ms => onPickRef.current(new Date(ms), { scrub: 'date' }), 90)).current;
  const timeThrottle = useRef(createCommitThrottle<number>(ms => onPickRef.current(new Date(ms), { scrub: 'time' }), 90)).current;

  const apply = useCallback((ms: number) => {
    tRef.current = ms;
    onPickRef.current(new Date(ms));
  }, []);
  // 단추는 반복해도 busy 를 잡습니다 — 다음 렌더의 props 가 한 칸 전 값이라도 이어서 셉니다.
  const stepBusyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const step = useCallback((fn: (t: number) => number) => {
    busyRef.current++;
    if (stepBusyTimer.current) clearTimeout(stepBusyTimer.current);
    apply(fn(tRef.current));
    stepBusyTimer.current = setTimeout(() => { busyRef.current = Math.max(0, busyRef.current - 1); stepBusyTimer.current = null; }, 500);
  }, [apply]);
  useEffect(() => () => { if (stepBusyTimer.current) clearTimeout(stepBusyTimer.current); }, []);

  // ── 트랙 값·글자 ─────────────────────────────────────────────────────────
  const datePct = dayIndexPct(tMs, tz);
  const timePct = Math.max(0, Math.min(100, ((minutes - range.from) / (range.to - range.from - 1)) * 100));
  const dayLabel = useCallback((pct: number) => {
    const idx = Math.round((pct / 100) * (daysInYear(yearRef.current) - 1));
    const d = new Date(Date.UTC(yearRef.current, 0, 1 + idx));
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }, []);
  const minuteAtPct = (pct: number) => {
    const r = rangeRef.current;
    return Math.max(r.from, Math.min(r.to - 1, r.from + Math.floor((pct / 100) * (r.to - r.from))));
  };
  const timeLabel = useCallback((pct: number) => {
    const m = minuteAtPct(pct);
    return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  }, []);

  const onDateScrub = useCallback((pct: number) => {
    const idx = Math.round((pct / 100) * (daysInYear(yearRef.current) - 1));
    const ms = withLocalDayOfYear(tRef.current, tzRef.current, yearRef.current, idx);
    tRef.current = ms;
    dateThrottle.push(ms);
  }, [dateThrottle]);
  // 끄는 동안 일출 · 일몰 표시를 지나면 가볍게 한 번 떱니다(§8.4). 첫 칸은 기준만 잡습니다.
  const markerMinsRef = useRef<(number | null)[]>([]);
  markerMinsRef.current = [sunriseMin, sunsetMin];
  const lastScrubMinRef = useRef<number | null>(null);
  const onTimeScrub = useCallback((pct: number) => {
    const m = minuteAtPct(pct);
    const prev = lastScrubMinRef.current;
    if (prev != null && crossesMarker(prev, m, markerMinsRef.current)) hapticTick();
    lastScrubMinRef.current = m;
    const ms = withLocalMinutes(tRef.current, tzRef.current, m);
    tRef.current = ms;
    timeThrottle.push(ms);
  }, [timeThrottle]);

  // ── 띠 ──────────────────────────────────────────────────────────────────
  const yearSegs = useMemo(() => yearTierSegments(year, tz, nowBucket), [year, tz, nowBucket]);
  const daySegs = useMemo(() => {
    const a = dayStart + range.from * MS_MIN, b = dayStart + range.to * MS_MIN;
    return tierSegmentsBetween(a, b, nowBucket, t => ((t - a) / (b - a)) * 100);
  }, [dayStart, nowBucket, range.from, range.to]);
  const nowYearPct = nowPctInYear(nowMs, year, tz);
  const nowMin = (nowMs - dayStart) / MS_MIN;
  const nowDayPct = nowMin >= range.from && nowMin <= range.to ? pctOfMin(nowMin) : null;

  // 낮·노을·밤 — 노을 무렵만 해 색(데이터), 낮·밤은 중립(예전 낮 = accent, 밤 = 리터럴 #1A237E).
  const phaseSegs = useMemo(() => dayPhaseSegments(sunriseMin, sunsetMin)
    .map(sg => ({ ...sg, from: Math.max(sg.from, range.from), to: Math.min(sg.to, range.to) }))
    .filter(sg => sg.to > sg.from), [sunriseMin, sunsetMin, range.from, range.to]);
  const phaseColor = { night: color.border, golden: color.sun, day: tint(color.textDim, 0.45) } as const;
  const hourTicks = range.to - range.from >= 1440
    ? [360, 720, 1080]
    : Array.from({ length: 4 }, (_, i) => (Math.ceil(range.from / 60) + i) * 60).filter(m => m > range.from && m < range.to);
  // 확대 중에 단추로 범위를 벗어나면 하루로 돌아갑니다(켠 직후의 한 박자는 건너뜀).
  useEffect(() => {
    if (zoom && zoomWin && Date.now() - zoomArmedAt.current > 600 && (minutes < zoomWin.from || minutes >= zoomWin.to)) setZoom(false);
  }, [zoom, minutes, zoomWin?.from, zoomWin?.to]);
  const toggleZoom = () => {
    if (zoom || !zoomWin) { setZoom(false); return; }
    zoomArmedAt.current = Date.now();
    setZoom(true);
    if (minutes < zoomWin.from || minutes >= zoomWin.to) step(() => dayStart + zoomWin.at * MS_MIN);
  };
  const markers = [
    { key: 'sr', m: sunriseMin, c: dataColor.sunrise, up: true },
    { key: 'ss', m: sunsetMin, c: dataColor.sunset, up: false },
    { key: 'mr', m: evMin(events?.moonrise), c: color.textDim, up: true },
    { key: 'ms', m: evMin(events?.moonset), c: color.textDim, up: false },
  ].filter(x => x.m != null) as { key: string; m: number; c: string; up: boolean }[];

  // ── 글자 ────────────────────────────────────────────────────────────────
  const l = new Date(tMs + tz * MS_HOUR);
  const weekday = WEEKDAYS[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'][l.getUTCDay()];
  const dateTextShort = `${l.getUTCFullYear()}.${pad2(l.getUTCMonth() + 1)}.${pad2(l.getUTCDate())}`;
  const dateText = `${dateTextShort} (${weekday})`;
  // 320px 폭에서는 40 버튼 셋 사이에 날짜가 다 들어가지 않아 요일을 뺍니다(스크린리더 값에는 그대로).
  const narrow = useWindowDimensions().width < 360;

  const tier = tierAt(tMs, nowMs);
  const leadH = (tMs - nowMs) / MS_HOUR;
  const win = dataWindow(nowMs);
  const winEnd = new Date(win.toMs + tz * MS_HOUR);
  const winEndText = `${winEnd.getUTCMonth() + 1}/${winEnd.getUTCDate()}`;
  const leadText = leadH < 48 ? `+${Math.max(0, Math.round(leadH))}${L3(language, '시간', 'h', '時間')}` : `+${Math.round(leadH / 24)}${L3(language, '일', 'd', '日')}`;
  const tierName: Record<AccuracyTier, string> = {
    past: L3(language, '과거', 'Past', '過去'),
    high: L3(language, '높음', 'High', '高'),
    medium: L3(language, '보통', 'Medium', '中'),
    low: L3(language, '낮음', 'Low', '低'),
    none: L3(language, '자료 없음', 'No data', 'データなし'),
  };
  const caption = (() => {
    switch (tier) {
      case 'past': return L3(language, '과거 · 재분석', 'Past · reanalysis', '過去 · 再解析');
      case 'none': return tMs < DATA_START_MS
        ? L3(language, '1940년 이전 · 천문만', 'Before 1940 · astronomy only', '1940年以前 · 天体のみ')
        : L3(language, '예보 한계 너머 · 천문만', 'Beyond forecast · astronomy only', '予報限界以降 · 天体のみ');
      default: return L3(language, `예보 ${leadText} · 정확도 ${tierName[tier]}`, `Forecast ${leadText} · ${tierName[tier]}`, `予報 ${leadText} · 精度 ${tierName[tier]}`);
    }
  })();

  const legend: { tier: AccuracyTier; text: string }[] = [
    { tier: 'past', text: L3(language, '과거 재분석', 'Past', '過去') },
    { tier: 'high', text: L3(language, `~${TIER_LEAD_HOURS.high / 24}일 높음`, `≤${TIER_LEAD_HOURS.high / 24}d high`, `~${TIER_LEAD_HOURS.high / 24}日 高`) },
    { tier: 'medium', text: L3(language, `~${TIER_LEAD_HOURS.medium / 24}일 보통`, `≤${TIER_LEAD_HOURS.medium / 24}d med`, `~${TIER_LEAD_HOURS.medium / 24}日 中`) },
    { tier: 'low', text: L3(language, `~${FORECAST_DAYS}일 낮음`, `≤${FORECAST_DAYS}d low`, `~${FORECAST_DAYS}日 低`) },
    { tier: 'none', text: L3(language, '자료 없음', 'No data', 'なし') },
  ];

  const adjustDate = useCallback((dir: 1 | -1) => step(t => shiftDays(t, dir)), [step]);
  const adjustTime = useCallback((dir: 1 | -1) => step(t => shiftHours(t, dir)), [step]);

  return (
    <View style={styles.wrap}>
      <View style={styles.main}>
        {/* ── 1행: 날짜 — 하루 앞뒤 · 날짜(달력) · 1년 막대 펼침. 누르는 것은 모두 40(touch) ── */}
        <View style={styles.headerRow}>
          <StepButton
            label={L3(language, '하루 전', '1 day back', '1日前')}
            onStep={() => adjustDate(-1)}
            icon={<ChevronLeft size={16} color={color.textDim} />}
          />
          <PressScale
            onPress={onOpenDatePicker}
            style={styles.dateBadge}
            accessibilityLabel={L3(language, '날짜 고르기', 'Pick a date', '日付を選ぶ')}
          >
            <Calendar size={14} color={color.accent} />
            <Text style={styles.dateText} numberOfLines={1}>{narrow ? dateTextShort : dateText}</Text>
            <View style={styles.liveTag}>
              <View style={[styles.liveDot, { backgroundColor: isTimeMachineEnabled ? color.warning : color.success }]} />
              <Text style={styles.liveText}>{isTimeMachineEnabled ? 'SIM' : 'LIVE'}</Text>
            </View>
          </PressScale>
          <StepButton
            label={L3(language, '하루 뒤', '1 day forward', '1日後')}
            onStep={() => adjustDate(1)}
            icon={<ChevronRight size={16} color={color.textDim} />}
          />
          <PressScale
            onPress={() => setShowYearTrack(v => !v)}
            style={[styles.stepBtn, showYearTrack && styles.stepBtnOn]}
            accessibilityLabel={L3(language, '1년 막대 펼치기', 'Toggle year slider', '1年スライダ切替')}
            accessibilityState={{ selected: showYearTrack }}
          >
            {showYearTrack ? (
              <ChevronUp size={16} color={color.accent} />
            ) : (
              <ChevronDown size={16} color={color.textDim} />
            )}
          </PressScale>
        </View>

        {/* ── 펼침 1년 날짜 트랙 (토글 시 노출) ─────────────────────── */}
        {showYearTrack && (
          <View style={styles.yearTrackContainer}>
            <StepButton
              slow
              label={L3(language, '1년 전', '1 year back', '1年前')}
              onStep={() => step(t => shiftYears(t, tzRef.current, -1))}
              icon={<ChevronsLeft size={16} color={color.textDim} />}
            />
            <View style={{ flex: 1 }}>
              <ScrubTrack
                value={datePct}
                formatLabel={dayLabel}
                onScrub={onDateScrub}
                onScrubStart={() => { busyRef.current++; onSlidingStart?.('date'); }}
                onScrubEnd={() => { dateThrottle.flush(); busyRef.current = Math.max(0, busyRef.current - 1); onSlidingComplete?.('date'); }}
                onAdjust={adjustDate}
                accessibilityLabel={L3(language, '날짜', 'Date', '日付')}
                accessibilityValue={dateText}
                height={40}
                trackHeight={5}
              >
                <View style={styles.trackClip}>
                  <TierBand segs={yearSegs} color={bandColor} height={5} />
                </View>
                {seasonPcts.map(s => (
                  <View key={s.key} style={[styles.season, { left: `${s.pct}%`, backgroundColor: s.color }]} />
                ))}
                {nowYearPct != null && <View style={[styles.nowTick, { left: `${nowYearPct}%`, top: -4, height: 13 }]} />}
              </ScrubTrack>
            </View>
            <StepButton
              slow
              label={L3(language, '1년 뒤', '1 year forward', '1年後')}
              onStep={() => step(t => shiftYears(t, tzRef.current, 1))}
              icon={<ChevronsRight size={16} color={color.textDim} />}
            />
          </View>
        )}

        {/* ── 2행: 풀와이드 24시간 시간 트랙 ──────────────────────────── */}
        <View style={styles.timeRow}>
          <StepButton
            label={L3(language, '1시간 전', '1 hour back', '1時間前')}
            onStep={() => adjustTime(-1)}
            icon={<ChevronLeft size={16} color={color.textDim} />}
          />
          <View style={{ flex: 1 }}>
            <ScrubTrack
              value={timePct}
              formatLabel={timeLabel}
              onScrub={onTimeScrub}
              onScrubStart={() => { lastScrubMinRef.current = null; busyRef.current++; onSlidingStart?.('time'); }}
              onScrubEnd={() => { timeThrottle.flush(); busyRef.current = Math.max(0, busyRef.current - 1); onSlidingComplete?.('time'); }}
              onAdjust={adjustTime}
              accessibilityLabel={L3(language, '시각', 'Time', '時刻')}
              accessibilityValue={`${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`}
              height={40}
              trackTop={22}
              trackHeight={5}
            >
              {/* 낮·노을·밤 */}
              <View style={styles.trackClip}>
                {phaseSegs.map((s, i) => (
                  <View key={i} style={{ position: 'absolute', left: `${pctOfMin(s.from)}%`, width: `${pctOfMin(s.to) - pctOfMin(s.from)}%`, top: 0, height: 5, backgroundColor: phaseColor[s.phase] }} />
                ))}
              </View>
              {/* 정확도 띠 — 낮·노을·밤 줄 위 */}
              <View style={[styles.trackClip, { top: -7, height: 3 }]}>
                <TierBand segs={daySegs} color={bandColor} height={3} />
              </View>
              {hourTicks.map(m => <View key={m} style={[styles.hourTick, { left: `${pctOfMin(m)}%` }]} />)}
              {markers.filter(m => m.m >= range.from && m.m <= range.to).map(m => (
                <View key={m.key} style={[styles.eventMark, { left: `${pctOfMin(m.m)}%`, backgroundColor: m.c }, m.up ? { top: -10 } : { top: 7 }]} />
              ))}
              {nowDayPct != null && <View style={[styles.nowTick, { left: `${nowDayPct}%`, top: -9, height: 17 }]} />}
            </ScrubTrack>
          </View>
          <StepButton
            label={L3(language, '1시간 뒤', '1 hour forward', '1時間後')}
            onStep={() => adjustTime(1)}
            icon={<ChevronRight size={16} color={color.textDim} />}
          />
          {zoomWin && (
            <PressScale
              onPress={toggleZoom}
              style={[styles.stepBtn, zoom && styles.stepBtnOn]}
              accessibilityLabel={zoomWin.side === 'sunset'
                ? L3(language, '일몰 앞뒤 3시간 확대', 'Zoom to 3 h around sunset', '日の入り前後3時間を拡大')
                : L3(language, '일출 앞뒤 3시간 확대', 'Zoom to 3 h around sunrise', '日の出前後3時間を拡大')}
              accessibilityState={{ selected: zoom }}
            >
              {zoomWin.side === 'sunset'
                ? <Sunset size={16} color={zoom ? color.accent : color.textDim} />
                : <Sunrise size={16} color={zoom ? color.accent : color.textDim} />}
            </PressScale>
          )}
        </View>

        {/* ── 정확도 상세 범례 (열렸을 때) — 아래 칩을 누르면 펼쳐집니다 ───── */}
        {legendOpen && (
          <View style={styles.legend}>
            {legend.map(x => (
              <View key={x.tier} style={styles.legendItem}>
                <TierSwatch tier={x.tier} color={bandColor} width={14} height={4} />
                <Text style={styles.legendText}>{x.text}</Text>
              </View>
            ))}
            <Text style={[styles.legendText, { width: '100%' }]}>
              {L3(language, `날씨 자료: 1940년 ~ ${winEndText}(+${FORECAST_DAYS}일). 등급은 지금과의 거리 기준(실측 정확도 아님)`,
                `Weather data: 1940 – ${winEndText} (+${FORECAST_DAYS}d). Tiers are by distance from now, not measured accuracy`,
                `天気データ: 1940年 ~ ${winEndText}(+${FORECAST_DAYS}日)。等級は今からの距離(実測精度ではない)`)}
            </Text>
          </View>
        )}

        {/* ── 3행: 상태와 주 동작 — 정확도 칩 · 지금으로(SIM 일 때만) · 촬영(이 화면의 주 버튼) ── */}
        <View style={styles.actionRow}>
          <PressScale
            onPress={() => setLegendOpen(v => !v)}
            style={styles.chip}
            accessibilityLabel={L3(language, '정확도 범례', 'Accuracy legend', '精度の凡例')}
            accessibilityState={{ expanded: legendOpen }}
          >
            <TierSwatch tier={tier} color={bandColor} width={14} height={4} />
            <Text style={styles.chipText} numberOfLines={1}>{leadText}</Text>
            <Info size={12} color={color.textDim} />
          </PressScale>

          {isTimeMachineEnabled && (
            <PressScale
              style={styles.nowBtn}
              onPress={onNow}
              accessibilityLabel={L3(language, '지금으로', 'Back to now', '今に戻る')}
            >
              <Zap size={12} color={color.accent} />
              <Text style={styles.nowBtnText}>{L3(language, '지금', 'NOW', '今')}</Text>
            </PressScale>
          )}

          {onCameraPress && (
            <PrimaryButton
              label={L3(language, '촬영', 'Capture', '撮影')}
              onPress={onCameraPress}
              icon={<Camera size={16} color={color.onAccent} />}
              style={styles.captureBtn}
            />
          )}
        </View>
      </View>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  main: { gap: space.sm },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dateBadge: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: TOUCH,
    paddingHorizontal: space.sm,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  dateText: { ...type.label, color: color.text, flexShrink: 1 },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: 'auto' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { ...type.micro, color: color.textDim },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: TOUCH,
    paddingHorizontal: space.sm,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  chipText: { ...type.label, color: color.textDim },

  /** 보조 동작 — 해 색(sun)은 데이터 색이라 버튼 바탕에 쓰지 않습니다. 주 버튼은 아래 촬영 하나. */
  nowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  nowBtnText: { ...type.label, color: color.text },
  captureBtn: { flex: 1 },

  yearTrackContainer: { flexDirection: 'row', alignItems: 'center', gap: space.xs },

  stepBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  stepBtnOn: { borderColor: color.accentLine, backgroundColor: color.accentSoft },

  trackClip: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 2, overflow: 'hidden', backgroundColor: color.border },
  season: { position: 'absolute', width: 4, height: 4, top: 0.5, marginLeft: -2, borderRadius: 1 },
  nowTick: { position: 'absolute', width: 2, marginLeft: -1, backgroundColor: color.text, borderRadius: 1, opacity: 0.9 },
  hourTick: { position: 'absolute', width: 1, height: 8, top: -2, marginLeft: -0.5, backgroundColor: color.borderStrong },
  eventMark: { position: 'absolute', width: 7, height: 7, marginLeft: -3.5, borderRadius: radius.sm },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4, paddingBottom: 3 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { ...type.micro, color: color.textDim },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
}));
