/**
 * LearnScreen.tsx — **02 데이터**: 현재 선택된 시각의 기상·천체 해설과 이후 발생할 이벤트,
 * 그리고 16일 예보·근거 데이터·결과가 나온 과정을 한 페이지에서 보여줍니다.
 *
 *   선택 시각 해설 & 이후 이벤트 → 앞으로 16일 → 근거 데이터 → 결과가 나온 과정 → 낮과 밤의 경계
 *
 * 기본적으로 01 하늘에서 선택한 시각(`currentTime`)을 기준으로 날씨·대기·천체를 해설하고
 * 그 시각 직후부터 이어지는 기상 및 천체 이벤트를 시간순으로 보여줍니다.
 * 앞으로 16일 표에서 다른 날의 일출·일몰 칸을 누르면 그 시각의 해설로 전환되며,
 * 언제든 "하늘 화면 선택 시각 해설로 돌아가기" 버튼으로 복귀할 수 있습니다.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Platform, View, Text, ScrollView, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3, type Language } from '../../utils/i18n';
import { radius, space, type, TOUCH } from '../../theme/tokens';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { Chip, PressScale } from '../ui';
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
import { TodaySection } from './TodaySection';
import { ForecastSection, dayLabel, showsScore } from './ForecastSection';
import { DataSection } from './DataSection';
import { WhySection } from './WhySection';

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
    case 'today': return L3(language, '지금 해설 · 일정', 'Now & Schedule', '現在解説・予定');
    case 'forecast': return L3(language, '앞으로 16일', 'Next 16 days', 'これから16日');
    case 'data': return L3(language, '근거 데이터', 'Data', '根拠データ');
    case 'why': return L3(language, '결과가 나온 과정', 'How it is made', '結果が出るまで');
    default: return L3(language, '낮과 밤의 경계', 'Day and night', '昼と夜の境目');
  }
};

export const LearnScreen: React.FC<LearnScreenProps> = ({ isActive, setCurrentTime, onOpenSky, entry = null }) => {
  const color = useThemeColors(); const styles = useStyles();
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

  // 네이티브 탭 전환 시 화면 슬라이드 애니메이션이 먼저 부드럽게 재생되도록 무거운 예보·지평선·과제 연산을 전환 직후로 지연합니다.
  const [computeReady, setComputeReady] = useState(Platform.OS === 'web' ? isActive : false);
  useEffect(() => {
    if (Platform.OS === 'web') { setComputeReady(isActive); return undefined; }
    if (!isActive) { setComputeReady(false); return undefined; }
    const task = InteractionManager.runAfterInteractions(() => setComputeReady(true));
    return () => task.cancel();
  }, [isActive]);

  const { days, forecast, load, get, now, inputFor, pathFor, stampFor, ringFor, elevM } = useForecastDays({ fetch: isActive, compute: computeReady });

  // ── 현재 선택된 시각(`currentTime`)과 16일 표에서 따로 고른 시각(`customPickedTimeMs`) ──
  const [customPickedTimeMs, setCustomPickedTimeMs] = useState<number | null>(null);
  const entryNonce = entry?.nonce ?? 0;
  const [pick, setPick] = useState<LearnPick | null>(null);
  const seenEntry = useRef<number | null>(null);

  // 01 하늘의 currentTime이 바뀌면 customPickedTimeMs를 해제하고 그 날짜의 가장 가까운 일출/일몰 칸에 pick을 맞춥니다.
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
    // 평소에는 01 하늘에서 선택된 시각(`currentTime`)이 속한 날과 가장 가까운 일출/일몰로 pick을 동기화합니다.
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

  // 별 보기처럼 시각이 필요한 주제가 쓸 시각(한밤에 별 카드로 들어온 길). 앞으로 16일에서 날을 다시 고르면 지웁니다.
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

  const picked = useMemo(() => pickedEvent(days, pick), [days, pick]);
  const day = picked?.day ?? null;
  const event: ForecastEvent | null = picked?.event ?? null;
  const side: EventSide = pick?.side ?? 'sunset';
  const isToday = !!day && days.length > 0 && sameNoon(day.noonMs, days[0].noonMs);
  // 근거 데이터 시각: 현재 해설 중인 선택 시각(`inspectedTimeMs`)
  const atMs = inspectedTimeMs;
  const at = inspectedTime;
  const path = useMemo(() => {
    const r = ringFor(inspectedTime);
    if (r && r.length > 0 && !r[0]?.isFallback) return r;
    return event ? pathFor(event) : forecast;
  }, [ringFor, inspectedTime, event, pathFor, forecast]);
  const eventInput = useMemo(() => (event ? inputFor(event) : null), [event, inputFor]);

  // ── 오늘 구역의 값 ──────────────────────────────────────────────────────
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

  // ── 결과가 나온 과정의 입력 ─────────────────────────────────────────────
  const [scene, setScene] = useState<{ horizon: HorizonProfile | null; st: SceneState | null }>({ horizon: null, st: null });
  useEffect(() => {
    if (!computeReady) return;
    const h = getPrimarySky();
    setScene({ horizon: h?.getHorizonProfile?.() ?? null, st: h?.getRenderState?.()?.scene ?? null });
  }, [computeReady, entryNonce]);

  // 별 보기가 쓰는 밤 불빛 지도(받아 두었으면 바로, 아니면 이 페이지가 열릴 때 한 번)
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

  // ── 현재 선택 시각의 기상·천체 종합 해설 & 이후 발생할 이벤트 타임라인 ──
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

  // ── 위치 · 눌렀을 때 ────────────────────────────────────────────────────
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

  return (
    <View style={styles.root}>
      <View style={styles.chipBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {LEARN_SECTIONS.map(s => (
            <Chip key={s} label={sectionName(s, language)} on={activeSection === s} onPress={() => scrollTo(s)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} onScroll={onScroll} scrollEventThrottle={64}>
        <View style={styles.head}>
          <Text style={styles.pageTitle} accessibilityRole="header">{L3(language, '데이터', 'Data', 'データ')}</Text>
          <Text style={styles.sub}>
            {[place, L3(language, '선택 시각 기상 · 천체 종합 해설과 예보 근거', 'Weather & celestial briefing for selected time and forecast data', '選択時刻の気象・天体解説と予報の根拠')].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {!hasLocation && (
          <Text style={styles.sub}>{L3(language, '위치를 먼저 정해 주세요. 위쪽 장소 버튼으로 고를 수 있어요.', 'Pick a location first with the place button at the top.', '先に場所を決めてください。上の場所ボタンで選べます。')}</Text>
        )}

        <View onLayout={onLayoutOf('today')}>
          <TodaySection
            language={language}
            tz={tz}
            isToday={isToday}
            dateLabel={inspectedDateLabel}
            timeLabel={inspectedTimeLabel}
            isCustomPickedTime={customPickedTimeMs != null && Math.abs(customPickedTimeMs - currentTimeMs) > 60_000}
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
          />
        </View>

        <View onLayout={onLayoutOf('forecast')}>
          <ForecastSection
            days={days} load={load} hasForecast={!!forecast} onRetry={() => get(true)}
            pick={pick} onPick={onPickDay} tz={tz} language={language}
          />
        </View>

        <View onLayout={onLayoutOf('data')}>
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

        <View onLayout={onLayoutOf('why')}>
          <WhySection
            language={language} results={results} openTopic={topicReq.topic} entryNonce={topicReq.nonce}
            notes={notes} onOpenData={() => scrollTo('data')}
          />
        </View>

        <View onLayout={onLayoutOf('globe')} style={styles.globe}>
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
  chips: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl * 3 + 20, gap: space.xl },
  head: { gap: space.xxs },
  pageTitle: { ...type.title, fontSize: 20, color: color.text },
  sub: { ...type.body, color: color.textDim },
  sectionTitle: { ...type.title, color: color.text },
  globe: { gap: space.sm },
  outlineBtn: {
    minHeight: TOUCH, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
  },
  outlineBtnText: { ...type.bodyStrong, color: color.text },
  sandboxBtn: {
    minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sandboxText: { ...type.bodyStrong },
}));
