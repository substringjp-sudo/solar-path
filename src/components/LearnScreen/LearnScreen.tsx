/**
 * LearnScreen.tsx — **02 데이터 ("하늘 읽는 노트")**:
 *
 * 위에서 아래로 시간 순서의 4+1 층 카드로 읽습니다:
 *   ① 지금(파란 실선) · ② 앞으로 24시간(주황 점선) → ③ 앞으로 16일(보라 점선) → ④ 원리(청록/초록) → 근거 데이터 · 낮과 밤
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Platform, View, Text, ScrollView, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3, type Language } from '../../utils/i18n';
import { mono, radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import { placeLabel } from '../AppHeader';
import { useAdministrativeArea } from '../../utils/reverseGeocode';
import { localHHMM, verdictWord } from '../SunsetSimulation/PredictionCard';
import { useForecastDays } from '../../hooks/useForecastDays';
import { getPrimarySky } from '../SkyScene3D/primarySky';
import type { SkyScene3DHandle } from '../SkyScene3D/SkyScene3D';
import { getInterpolatedWeather, layerWindsFrom } from '../../utils/weather';
import { sunPosition, sunTimes } from '../../utils/solarPosition';
import { getCelestialEvents } from '../../utils/celestial';
import { buildSkyEvents } from '../../utils/skyEvents';
import { skyDirection } from '../../utils/skyWords';
import { dayScoreSeries } from '../../utils/dayScoreSeries';
import { starArgsFor, hourlyCovers, starWeatherOf } from '../../utils/starTonight';
import { estimateLightPollution, type NightLights } from '../../utils/cityLightMap';
import { getCachedNightLights, loadNightLights } from '../../utils/nightLightsAsset';
import { buildTopicResult, type TopicResult } from '../../utils/calcTopic';
import { cloudSceneUsable } from '../../utils/calcSteps';
import { buildTimeBriefing, buildUpcomingTimeline } from '../../utils/timeBriefing';
import type { EventSide, ForecastEvent } from '../../utils/sunForecast';
import type { HorizonProfile } from '../../utils/horizon';
import {
  LEARN_SECTIONS, LEARN_TOPICS, defaultPick, pickedEvent, sameNoon,
  type LearnEntry, type LearnPick, type LearnSection, type LearnTopic,
} from '../../utils/learnSections';
import {
  buildCloudTrend6h,
  buildComfortGauges,
  buildLiveSkyMap,
  buildMoonStripInfo,
  buildStarGaugeSummary,
  buildTimeline24hData,
} from '../../utils/learnNoteData';
import { TodaySection } from './TodaySection';
import { ForecastSection, dayLabel, showsScore } from './ForecastSection';
import { DataSection } from './DataSection';
import { WhySection } from './WhySection';
import { ZoneHead } from './ZoneHead';

interface LearnScreenProps {
  /** 탭이 보이는가 — 보일 때만 받고 셉니다. */
  isActive: boolean;
  /** "하늘에서 보기" 가 01 하늘의 시각을 이 시각으로 맞춥니다. */
  setCurrentTime: (time: Date) => void;
  /** 01 하늘로 */
  onOpenSky: () => void;
  /** 다른 화면에서 들어온 길(구역 · 주제 · 날). 들어올 때마다 `nonce` 가 달라집니다. */
  entry?: LearnEntry | null;
}

type SceneState = NonNullable<NonNullable<ReturnType<SkyScene3DHandle['getRenderState']>>['scene']>;

const sectionName = (s: LearnSection, language: Language) => {
  switch (s) {
    case 'today': return L3(language, '지금', 'Now', '今');
    case 'forecast': return L3(language, '16일', '16d', '16日');
    case 'why': return L3(language, '원리', 'Why', '仕組み');
    case 'data': return L3(language, '근거', 'Data', '根拠');
    default: return L3(language, '낮·밤', 'Day/Night', '昼夜');
  }
};

const sectionSub = (s: LearnSection, language: Language) => {
  switch (s) {
    case 'today': return L3(language, '눈앞 하늘', 'Right now', '目の前の空');
    case 'forecast': return L3(language, '길게', 'Outlook', '長期予報');
    case 'why': return L3(language, '이유', 'Formula', '理由');
    case 'data': return L3(language, '원본 수치', 'Raw data', '元データ');
    default: return L3(language, '경계선', 'Terminator', '境界');
  }
};

export const LearnScreen: React.FC<LearnScreenProps> = ({ isActive, setCurrentTime, onOpenSky, entry = null }) => {
  const color = useThemeColors();
  const styles = useStyles();
  const language = useCelestialStore(s => s.language);
  const location = useCelestialStore(s => s.location);
  const tz = useCelestialStore(s => s.timezoneOffsetHours) ?? 0;
  const savedLocations = useCelestialStore(s => s.savedLocations);
  const setExpertMode = useCelestialStore(s => s.setExpertMode);
  const currentTime = useCelestialStore(s => s.currentTime);

  const lat = location?.coords?.latitude;
  const lon = location?.coords?.longitude;
  const adminName = useAdministrativeArea(lat, lon);
  const place = placeLabel(lat, lon, savedLocations, adminName);

  const [computeReady, setComputeReady] = useState(Platform.OS === 'web' ? isActive : false);
  useEffect(() => {
    if (Platform.OS === 'web') { setComputeReady(isActive); return undefined; }
    if (!isActive) { setComputeReady(false); return undefined; }
    const task = InteractionManager.runAfterInteractions(() => setComputeReady(true));
    return () => task.cancel();
  }, [isActive]);

  const { days, forecast, fetchedAt, load, get, now, inputFor, pathFor, stampFor, ringFor, elevM } = useForecastDays({ fetch: isActive, compute: computeReady });

  const [customPickedTimeMs, setCustomPickedTimeMs] = useState<number | null>(null);
  const entryNonce = entry?.nonce ?? 0;
  const [pick, setPick] = useState<LearnPick | null>(null);
  const seenEntry = useRef<number | null>(null);

  const currentTimeMs = currentTime instanceof Date ? currentTime.getTime() : Date.now();
  useEffect(() => {
    setCustomPickedTimeMs(null);
  }, [currentTimeMs]);

  useEffect(() => {
    if (days.length === 0) return;
    if (seenEntry.current !== entryNonce && entry?.focus) {
      seenEntry.current = entryNonce;
      const p = defaultPick(days, now, entry.focus);
      setPick(p);
      const pe = pickedEvent(days, p);
      if (pe?.event) {
        setCustomPickedTimeMs((pe.event.peakAt ?? pe.event.at).getTime());
      }
      return;
    }
    if (!customPickedTimeMs) {
      const targetNoon = new Date(currentTimeMs);
      targetNoon.setHours(12, 0, 0, 0);
      const matchedDay = days.find(d => sameNoon(d.noonMs, targetNoon.getTime())) ?? days[0];
      if (matchedDay) {
        let side: EventSide = 'sunset';
        if (lat != null && lon != null) {
          const st = sunTimes(new Date(currentTimeMs), lat, lon);
          const dRise = Math.abs(currentTimeMs - st.sunrise.getTime());
          const dSet = Math.abs(currentTimeMs - st.sunset.getTime());
          side = dRise < dSet ? 'sunrise' : 'sunset';
        }
        setPick({ noonMs: matchedDay.noonMs, side });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, now, entryNonce, currentTimeMs, customPickedTimeMs]);

  const [pinnedAt, setPinnedAt] = useState<number | null>(entry?.at ?? null);
  useEffect(() => { setPinnedAt(entry?.at ?? null); }, [entry?.nonce]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onPickDay = (p: LearnPick) => {
    setPinnedAt(null);
    setPick(p);
    const pe = pickedEvent(days, p);
    if (pe?.event) {
      setCustomPickedTimeMs((pe.event.peakAt ?? pe.event.at).getTime());
    } else if (pe?.day) {
      setCustomPickedTimeMs(pe.day.noonMs);
    }
  };
  const onResetToSkyTime = useCallback(() => {
    setCustomPickedTimeMs(null);
  }, []);

  const inspectedTimeMs = customPickedTimeMs ?? currentTimeMs;
  const inspectedTime = useMemo(() => new Date(inspectedTimeMs), [inspectedTimeMs]);
  const isCustomPicked = customPickedTimeMs != null && Math.abs(customPickedTimeMs - currentTimeMs) > 60_000;

  const picked = useMemo(() => pickedEvent(days, pick), [days, pick]);
  const day = picked?.day ?? null;
  const event: ForecastEvent | null = picked?.event ?? null;
  const side: EventSide = pick?.side ?? 'sunset';
  const isToday = !!day && days.length > 0 && sameNoon(day.noonMs, days[0].noonMs);
  const atMs = inspectedTimeMs;
  const at = inspectedTime;
  const path = useMemo(() => {
    const r = ringFor(inspectedTime);
    if (r && r.length > 0 && !r[0]?.isFallback) return r;
    return event ? pathFor(event) : forecast;
  }, [ringFor, inspectedTime, event, pathFor, forecast]);
  const eventInput = useMemo(() => (event ? inputFor(event) : null), [event, inputFor]);

  const direction = useMemo(() => (
    event && lat != null && lon != null
      ? skyDirection(sunPosition(event.at, lat, lon).azimuth * (180 / Math.PI) + 180, language)
      : null
  ), [event, lat, lon, language]);
  const items = useMemo(() => {
    if (!day || lat == null || lon == null) return [];
    const date = new Date(day.noonMs);
    const pred = (e: ForecastEvent | null) => (e && e.quality && e.score != null && showsScore(e.tier) ? { score: e.score, quality: e.quality } : null);
    return buildSkyEvents({
      date, latitude: lat, longitude: lon,
      events: getCelestialEvents(date, lat, lon),
      sunsetPrediction: pred(day.sunset),
      sunrisePrediction: pred(day.sunrise),
      language,
    });
  }, [day, lat, lon, language]);
  const graph = useMemo(() => (
    event && path && lat != null && lon != null ? dayScoreSeries(path, event.at, event.side, lat, lon, tz, elevM) : null
  ), [event, path, lat, lon, tz, elevM]);

  const [scene, setScene] = useState<{ horizon: HorizonProfile | null; st: SceneState | null }>({ horizon: null, st: null });
  useEffect(() => {
    if (!computeReady) return;
    const h = getPrimarySky();
    setScene({ horizon: h?.getHorizonProfile?.() ?? null, st: h?.getRenderState?.()?.scene ?? null });
  }, [computeReady, entryNonce]);

  const [nightLights, setNightLights] = useState<NightLights | null>(() => getCachedNightLights());
  useEffect(() => {
    if (nightLights || !isActive) return;
    let alive = true;
    loadNightLights().then(m => { if (alive && m) setNightLights(m); });
    return () => { alive = false; };
  }, [nightLights, isActive]);

  const lightPollutionMag = useMemo(() => (
    nightLights && lat != null && lon != null ? estimateLightPollution(nightLights, lat, lon).magLimit : null
  ), [nightLights, lat, lon]);

  const fmtTime = useCallback((ms: number) => localHHMM(new Date(ms), tz), [tz]);

  const briefing = useMemo(() => {
    if (!computeReady || lat == null || lon == null) return null;
    return buildTimeBriefing({
      selectedTime: inspectedTime,
      lat,
      lon,
      elevM: elevM ?? 0,
      language,
      ringFor,
      forecast,
      days,
      lightPollutionMag,
    });
  }, [computeReady, inspectedTime, lat, lon, elevM, language, ringFor, forecast, days, lightPollutionMag]);

  const upcomingEvents = useMemo(() => {
    if (!computeReady || lat == null || lon == null) return [];
    return buildUpcomingTimeline({
      selectedTime: inspectedTime,
      lat,
      lon,
      elevM: elevM ?? 0,
      language,
      ringFor,
      forecast,
      days,
      lightPollutionMag,
      fmtTime,
    });
  }, [computeReady, inspectedTime, lat, lon, elevM, language, ringFor, forecast, days, lightPollutionMag, fmtTime]);

  // ── 목업 기반 시각화 데이터 계산 (실제 예보 · 천문 기반) ─────────────────
  const liveSkyMap = useMemo(() => (
    computeReady && lat != null && lon != null ? buildLiveSkyMap(path, inspectedTime, lat, lon, language) : null
  ), [computeReady, lat, lon, path, inspectedTime, language]);

  const cloudTrend = useMemo(() => (
    computeReady ? buildCloudTrend6h(path, inspectedTimeMs, language) : null
  ), [computeReady, path, inspectedTimeMs, language]);

  const moonStrip = useMemo(() => (
    computeReady && lat != null && lon != null
      ? buildMoonStripInfo(inspectedTime, lat, lon, elevM ?? 0, tz, language)
      : null
  ), [computeReady, inspectedTime, lat, lon, elevM, tz, language]);

  const starSummary = useMemo(() => (
    computeReady && lat != null && lon != null
      ? buildStarGaugeSummary(path, inspectedTime, lat, lon, elevM ?? 0, lightPollutionMag, language)
      : null
  ), [computeReady, path, inspectedTime, lat, lon, elevM, lightPollutionMag, language]);

  const inspectedObs = useMemo(() => (
    path?.length ? getInterpolatedWeather(path, inspectedTime)[0] : undefined
  ), [path, inspectedTime]);

  const gauges = useMemo(() => (
    computeReady && inspectedObs ? buildComfortGauges(inspectedObs, language) : []
  ), [computeReady, inspectedObs, language]);

  const timeline24h = useMemo(() => (
    computeReady && lat != null && lon != null
      ? buildTimeline24hData({
          baseMs: inspectedTimeMs,
          tzHours: tz,
          lat,
          lon,
          elevM: elevM ?? 0,
          ringFor,
          forecast,
          lightPollutionMag,
          events: upcomingEvents,
          language,
        })
      : null
  ), [computeReady, lat, lon, inspectedTimeMs, tz, elevM, ringFor, forecast, lightPollutionMag, upcomingEvents, language]);

  const starArgs = useMemo(() => {
    if (!day || lat == null || lon == null) return null;
    const p = path ?? forecast;
    const weatherAt = (when: Date) => {
      const h = p?.[0]?.hourly;
      const times = h?.timeMs ?? h?.time?.map((x: string) => new Date(x).getTime());
      return p && hourlyCovers(times, when.getTime()) ? starWeatherOf(getInterpolatedWeather(p, when)[0]) : null;
    };
    return starArgsFor({
      date: new Date(pinnedAt ?? inspectedTimeMs), lat, lon, elevM: elevM ?? 0, weatherAt,
      lightPollutionMag,
    });
  }, [day, pinnedAt, inspectedTimeMs, lat, lon, path, forecast, elevM, lightPollutionMag]);

  const cloudArgs = useMemo(() => {
    const st = scene.st;
    if (!st) return null;
    const when = new Date(st.t);
    const p = ringFor(when);
    const obs = p?.length ? getInterpolatedWeather(p, when)[0] : undefined;
    const alt = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { scene: st, altKm: { low: alt(obs?.layerAltLowKm), mid: alt(obs?.layerAltMidKm), high: alt(obs?.layerAltHighKm) }, winds: layerWindsFrom(obs) };
  }, [scene.st, ringFor]);

  const qualityWord = useCallback((q: string) => verdictWord(q as any, language), [language]);
  const results = useMemo(() => {
    const out = {} as Record<LearnTopic, TopicResult | null>;
    for (const t of LEARN_TOPICS) {
      out[t] = lat == null || lon == null || !day ? null : buildTopicResult(t, {
        language, date: new Date(day.noonMs), latitude: lat, longitude: lon, fmtTime,
        horizon: scene.horizon, scoreInput: eventInput, starArgs, cloudArgs, qualityWord,
      });
    }
    return out;
  }, [day, lat, lon, language, fmtTime, scene.horizon, eventInput, starArgs, cloudArgs, qualityWord]);

  const notes = useMemo(() => {
    if (!scene.st) return undefined;
    const when = fmtTime(new Date(scene.st.t).getTime());
    const same = cloudSceneUsable(scene.st.t, atMs);
    return {
      cloud: L3(language,
        `01 하늘이 지금 그린 ${when} 의 구름이에요.${same ? '' : ' 고른 칸의 시각과는 달라요.'}`,
        `The clouds the 01 Sky drew for ${when}.${same ? '' : ' That is not the time of the cell you picked.'}`,
        `01 空が描いた ${when} の雲です。${same ? '' : ' 選んだマスの時刻とは異なります。'}`),
    };
  }, [scene.st, language, fmtTime, atMs]);

  const conceptContext = useMemo(() => {
    const winds = layerWindsFrom(inspectedObs);
    return {
      lowPct: inspectedObs?.low ?? null,
      midPct: inspectedObs?.mid ?? null,
      highPct: inspectedObs?.high ?? null,
      windLowKmh: winds?.low?.speedKmh ?? null,
      windHighKmh: winds?.high?.speedKmh ?? null,
      t2mC: inspectedObs?.t2mC ?? null,
      td2mC: inspectedObs?.td2mC ?? null,
      visKm: inspectedObs?.visibility != null && Number.isFinite(inspectedObs.visibility) ? inspectedObs.visibility / 1000 : null,
      moonPct: moonStrip?.pct ?? null,
      sunDeltaLabel: results.sunset?.eventLabel ?? results.sunrise?.eventLabel ?? null,
    };
  }, [inspectedObs, moonStrip, results]);

  const [topicReq, setTopicReq] = useState<{ topic: LearnTopic | null; nonce: number }>({ topic: entry?.topic ?? null, nonce: entryNonce });
  useEffect(() => {
    if (entry) setTopicReq({ topic: entry.topic ?? null, nonce: entry.nonce });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.nonce]);

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<LearnSection, number>>>({});
  const [activeSection, setActiveSection] = useState<LearnSection>('today');
  const scrollTo = useCallback((s: LearnSection) => {
    const y = offsets.current[s];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    setActiveSection(s);
  }, []);
  const onLayoutOf = (s: LearnSection) => (e: LayoutChangeEvent) => { offsets.current[s] = e.nativeEvent.layout.y; };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y + 24;
    let cur: LearnSection = 'today';
    for (const s of LEARN_SECTIONS) if ((offsets.current[s] ?? Infinity) <= y) cur = s;
    setActiveSection(prev => (prev === cur ? prev : cur));
  };

  const hasDays = days.length > 0;
  const scrolledKey = useRef('');
  useEffect(() => {
    if (!entry?.section || !isActive) return;
    const key = `${entry.nonce}:${hasDays}`;
    if (scrolledKey.current === key) return;
    scrolledKey.current = key;
    const id = setTimeout(() => scrollTo(entry.section as LearnSection), 200);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.nonce, isActive, hasDays]);

  const openSky = (ms?: number) => {
    setCurrentTime(ms != null ? new Date(ms) : inspectedTime);
    onOpenSky();
  };
  const openTopic = (t: LearnTopic) => {
    setTopicReq({ topic: t, nonce: Date.now() });
    scrollTo('why');
  };
  const openSandbox = () => { setExpertMode(true); onOpenSky(); };

  const inspectedDateLabel = dayLabel(inspectedTimeMs, tz, language);
  const inspectedTimeLabel = fmtTime(inspectedTimeMs);
  const skyTimeLabel = `${dayLabel(currentTimeMs, tz, language)} ${fmtTime(currentTimeMs)}`;
  const hasLocation = lat != null && lon != null;

  const legendTone = (s: LearnSection) => {
    switch (s) {
      case 'today': return { fg: color.accent, dashed: false };
      case 'forecast': return { fg: color.moon, dashed: true };
      case 'why': return { fg: color.success, dashed: false };
      default: return { fg: color.textDim, dashed: true };
    }
  };

  const fetchedClock = fetchedAt != null ? fmtTime(fetchedAt) : null;

  return (
    <View style={styles.root}>
      {/* 상단 4색 바로가기 스트립 (verify-calc-steps 가로 ScrollView 규칙 유지) */}
      <View style={styles.chipBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {LEARN_SECTIONS.map(s => {
            const on = activeSection === s;
            const { fg, dashed } = legendTone(s);
            return (
              <PressScale
                key={s}
                style={[
                  styles.legendCard,
                  { borderColor: on ? fg : color.borderStrong, borderStyle: dashed ? 'dashed' : 'solid' },
                  on && { backgroundColor: color.fill },
                ]}
                onPress={() => scrollTo(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.legendTitle, { color: fg }]}>{sectionName(s, language)}</Text>
                <Text style={styles.legendSub} numberOfLines={1}>{sectionSub(s, language)}</Text>
              </PressScale>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} onScroll={onScroll} scrollEventThrottle={64}>
        {/* 제목줄 + clockbar */}
        <View style={styles.head}>
          <Text style={styles.pageTitle} accessibilityRole="header">{L3(language, '데이터', 'Data', 'データ')}</Text>
          <Text style={styles.sub}>
            {[place, `${inspectedDateLabel} ${inspectedTimeLabel}`].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.clockbar}>
            <View style={[styles.selpill, isCustomPicked && { backgroundColor: color.fill, borderColor: color.moon }]}>
              <Text style={[styles.selpillText, { color: isCustomPicked ? color.moon : color.accent }]}>
                {isCustomPicked
                  ? `${L3(language, '선택', 'Picked', '選択')} · ${inspectedDateLabel} ${inspectedTimeLabel}`
                  : `${L3(language, '선택 시각 · 지금', 'Time · Now', '時刻・今')} ${inspectedTimeLabel}`}
              </Text>
            </View>
            <PressScale
              style={styles.miniBtn}
              onPress={isCustomPicked ? onResetToSkyTime : () => openSky(currentTimeMs)}
              accessibilityRole="button"
            >
              <Text style={styles.miniBtnText}>
                {isCustomPicked
                  ? L3(language, '01 하늘 시각으로', 'Sync 01 Sky', '01 空の時刻へ')
                  : L3(language, '01 하늘에서 보기', 'Open in 01 Sky', '01 空で見る')}
              </Text>
            </PressScale>
            <PressScale
              style={styles.miniBtn}
              onPress={() => get(true)}
              accessibilityRole="button"
            >
              <Text style={styles.miniBtnText}>
                {load.kind === 'loading'
                  ? L3(language, '받는 중…', 'Refreshing…', '取得中…')
                  : fetchedClock
                    ? `${L3(language, '새로고침', 'Refresh', '更新')} · ${fetchedClock}`
                    : L3(language, '새로고침', 'Refresh', '更新')}
              </Text>
            </PressScale>
          </View>
        </View>

        {!hasLocation && (
          <Text style={styles.sub}>{L3(language, '위치를 먼저 정해 주세요. 위쪽 장소 버튼으로 고를 수 있어요.', 'Pick a location first with the place button at the top.', '先に場所を決めてください。上の場所ボタンで選べます。')}</Text>
        )}

        {/* ① 지금 · ② 24시간 */}
        <View onLayout={onLayoutOf('today')} style={[styles.zoneCard, { borderColor: color.accent }]}>
          <ZoneHead zone="today" language={language} />
          <TodaySection
            language={language}
            tz={tz}
            isToday={isToday}
            dateLabel={inspectedDateLabel}
            timeLabel={inspectedTimeLabel}
            isCustomPickedTime={isCustomPicked}
            skyTimeLabel={skyTimeLabel}
            onResetToSkyTime={onResetToSkyTime}
            side={side}
            event={event}
            direction={direction}
            items={items}
            graph={graph}
            briefing={briefing}
            upcomingEvents={upcomingEvents}
            onOpenSky={openSky}
            onOpenTopic={openTopic}
            cloudTrend={cloudTrend}
            moonStrip={moonStrip}
            starSummary={starSummary}
            liveSkyMap={liveSkyMap}
            gauges={gauges}
            timeline24h={timeline24h}
          />
        </View>

        {/* ③ 16일 달력 */}
        <View onLayout={onLayoutOf('forecast')} style={[styles.zoneCard, styles.zoneDashed, { borderColor: color.moon }]}>
          <ZoneHead zone="forecast" language={language} />
          <ForecastSection
            days={days} load={load} hasForecast={!!forecast} onRetry={() => get(true)}
            pick={pick} onPick={onPickDay} tz={tz} language={language}
            forecast={forecast} ringFor={ringFor} lat={lat} lon={lon} elevM={elevM ?? 0}
            lightPollutionMag={lightPollutionMag} onOpenSky={openSky}
          />
        </View>

        {/* ④ 원리 · 워터폴 · 학습 탭 · 용어 칩 */}
        <View onLayout={onLayoutOf('why')} style={[styles.zoneCard, { borderColor: color.success }]}>
          <ZoneHead zone="why" language={language} />
          <WhySection
            language={language} results={results} openTopic={topicReq.topic} entryNonce={topicReq.nonce}
            notes={notes} onOpenData={() => scrollTo('data')}
            conceptContext={conceptContext} onOpenSky={() => openSky(inspectedTimeMs)}
          />
        </View>

        {/* ⑤ 근거 데이터 · 출처 */}
        <View onLayout={onLayoutOf('data')} style={[styles.zoneCard, styles.zoneSubtle, { borderColor: color.borderStrong }]}>
          <ZoneHead zone="data" language={language} />
          {hasLocation && (
            <DataSection
              language={language} tz={tz} latitude={lat as number} longitude={lon as number} at={at} path={path}
              prediction={event && eventInput && showsScore(event.tier) ? { score: eventInput.prediction.score, quality: eventInput.prediction.quality } : null}
              downloadedAtMs={event ? stampFor(event) : null}
              source={event?.source ?? null}
              isRefreshing={load.kind === 'loading'}
              refreshError={load.kind === 'error' ? (load.rateLimited
                ? L3(language, '요청이 많아 지금은 받지 못했습니다. 잠시 뒤에 다시 받아 주세요.', 'Too many requests right now. Try again in a moment.', 'リクエストが多く取得できませんでした。少し後でもう一度。')
                : L3(language, '16일 예보를 받지 못했습니다.', "Couldn't fetch the 16-day forecast.", '16日予報を取得できませんでした。')) : null}
              onForceRefresh={() => get(true)}
            />
          )}
        </View>

        {/* 낮과 밤의 경계 */}
        <View onLayout={onLayoutOf('globe')} style={[styles.zoneCard, styles.zoneSubtle, { borderColor: color.borderStrong }]}>
          <Text style={styles.sectionTitle} accessibilityRole="header">{L3(language, '낮과 밤의 경계', 'Day and night', '昼と夜の境目')}</Text>
          <Text style={styles.sub}>
            {L3(language,
              '지구는 늘 반쪽만 해를 받아요. 낮과 밤의 경계선이 지나는 곳에서 해가 뜨고 져요. 하늘 화면에서 두 손가락을 오므리면 지구본이 나오고, 그 경계선과 지금 해가 비추는 곳을 볼 수 있어요.',
              'The Earth is always lit on one half. Sunrise and sunset happen where the day and night boundary passes. In the Sky screen, pinch in with two fingers to see the globe, that boundary and where the sun shines now.',
              '地球は常に半分だけが日を受けています。昼と夜の境目が通るところで日の出と日の入りが起こります。空の画面で二本指でつまむように縮めると地球儀が出て、その境目と今太陽が照らす場所を見られます。')}
          </Text>
          <PressScale style={styles.outlineBtn} onPress={() => onOpenSky()} accessibilityRole="button"
            accessibilityLabel={L3(language, '하늘에서 지구본 보기', 'See the globe in the sky', '空で地球儀を見る')}>
            <Text style={styles.outlineBtnText}>{L3(language, '하늘에서 지구본 보기', 'See the globe in the sky', '空で地球儀を見る')}</Text>
          </PressScale>
        </View>

        <PressScale style={styles.sandboxBtn} onPress={openSandbox} accessibilityRole="button"
          accessibilityLabel={L3(language, '샌드박스에서 바꿔 보기', 'Try it in the sandbox', 'サンドボックスで変えてみる')}>
          <Text style={[styles.sandboxText, { color: color.accent }]}>{L3(language, '샌드박스에서 바꿔 보기', 'Try it in the sandbox', 'サンドボックスで変えてみる')}</Text>
        </PressScale>
      </ScrollView>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  root: { flex: 1, backgroundColor: color.bg },
  chipBar: { borderBottomWidth: 1, borderBottomColor: color.border, backgroundColor: color.bg },
  chips: { paddingHorizontal: space.md, paddingVertical: space.xs + 2, gap: 6 },
  legendCard: {
    minWidth: 74,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: color.panel,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 1,
  },
  legendTitle: { fontSize: 12, fontWeight: '700' },
  legendSub: { fontSize: 10.5, color: color.textDim },

  scroll: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.xl * 3 + 20, gap: space.lg },
  head: { gap: space.xs },
  pageTitle: { ...type.title, fontSize: 20, color: color.text },
  sub: { ...type.body, color: color.textDim },

  clockbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 2 },
  selpill: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
  },
  selpillText: { fontFamily: mono, fontSize: 11.5, fontWeight: '700' },
  miniBtn: {
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.panel,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 4,
    minHeight: 28,
    justifyContent: 'center',
  },
  miniBtnText: { fontSize: 11.5, color: color.textDim, fontWeight: '600' },

  zoneCard: {
    backgroundColor: color.panel,
    borderWidth: 2,
    borderRadius: 16,
    padding: space.md + 2,
    gap: space.md,
  },
  zoneDashed: { borderStyle: 'dashed' },
  zoneSubtle: { borderWidth: 1 },

  sectionTitle: { ...type.title, color: color.text },
  outlineBtn: {
    minHeight: TOUCH,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  outlineBtnText: { ...type.bodyStrong, color: color.text },
  sandboxBtn: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sandboxText: { ...type.bodyStrong },
}));
