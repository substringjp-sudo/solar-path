/**
 * LearnScreen.tsx — **02 학습**: 데이터의 근거와 결과가 나온 과정을 한 페이지에서(2026-11-20, docs/SANDBOX_MODE_PLAN.md 13 장).
 *
 * 예전에는 같은 성격의 설명이 다섯 곳에 흩어져 있었습니다(시트의 이벤트 목록 · 시트의 기상 정보 · 02 예보 16일 · 왜 그런가요 창).
 * 이 페이지가 모두 모읍니다. 위에서 아래로 한 번에 읽고, 위의 칩은 구역으로 건너뛰는 목차입니다.
 *
 *   오늘(고른 날) → 앞으로 16일 → 근거 데이터 → 결과가 나온 과정 → 낮과 밤의 경계
 *
 * **항목마다 중요한 정보만 먼저 보이고, 부차적인 정보는 접어 둡니다**(사용자 결정 2026-11-20). 접는 규칙은 `utils/learnSections.ts` 한 곳입니다.
 *
 * 페이지는 **고른 날 하나**를 따라갑니다(그 날의 일출 또는 일몰). 들어올 때는 온 곳의 날로 맞춰지고(`LearnEntry.focus`),
 * 앞으로 16일에서 칸을 누르면 그 날로 바뀝니다. 여기서 날을 바꿔도 01 하늘의 시간은 바뀌지 않습니다(01 하늘에서 보기를 누를 때만).
 * 오늘 · 근거 · 과정이 **같은 칸**(`inputFor` / `pathFor`)에서 나와 점수와 자료가 서로 어긋나지 않습니다.
 *
 * 구름 모양만은 고른 날이 아니라 **01 하늘이 지금 그린 그림**입니다(장면 핸들). 그 그림의 시각을 줄 위에 적습니다.
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
import { sunPosition } from '../../utils/solarPosition';
import { getCelestialEvents } from '../../utils/celestial';
import { buildSkyEvents } from '../../utils/skyEvents';
import { skyDirection } from '../../utils/skyWords';
import { dayScoreSeries } from '../../utils/dayScoreSeries';
import { starArgsFor, hourlyCovers, starWeatherOf } from '../../utils/starTonight';
import { estimateLightPollution, type NightLights } from '../../utils/cityLightMap';
import { getCachedNightLights, loadNightLights } from '../../utils/nightLightsAsset';
import { buildTopicResult, type TopicResult } from '../../utils/calcTopic';
import { cloudSceneUsable } from '../../utils/calcSteps';
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
    case 'today': return L3(language, '오늘', 'Today', '今日');
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

  // ── 고른 날 ─────────────────────────────────────────────────────────────
  const entryNonce = entry?.nonce ?? 0;
  const [pick, setPick] = useState<LearnPick | null>(null);
  const seenEntry = useRef<number | null>(null);
  useEffect(() => {
    if (days.length === 0) return;
    // 처음이거나, 고른 날이 새 목록에 없거나, 새로 들어온 길이면 그 길(없으면 앞으로 가장 좋은 때)의 날로 맞춥니다.
    if (!pick || !pickedEvent(days, pick) || seenEntry.current !== entryNonce) {
      seenEntry.current = entryNonce;
      setPick(defaultPick(days, now, entry?.focus ?? null));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, now, entryNonce]);

  // 별 보기처럼 시각이 필요한 주제가 쓸 시각(한밤에 별 카드로 들어온 길). 앞으로 16일에서 날을 다시 고르면 지웁니다.
  const [pinnedAt, setPinnedAt] = useState<number | null>(entry?.at ?? null);
  useEffect(() => { setPinnedAt(entry?.at ?? null); }, [entry?.nonce]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onPickDay = (p: LearnPick) => { setPinnedAt(null); setPick(p); };

  const picked = useMemo(() => pickedEvent(days, pick), [days, pick]);
  const day = picked?.day ?? null;
  const event: ForecastEvent | null = picked?.event ?? null;
  const side: EventSide = pick?.side ?? 'sunset';
  const isToday = !!day && days.length > 0 && sameNoon(day.noonMs, days[0].noonMs);
  // 근거를 센 시각: 그 칸의 가장 붉을 때(없으면 고른 날 정오)
  const atMs = event ? (event.peakAt ?? event.at).getTime() : day?.noonMs ?? now.getTime();
  const at = useMemo(() => new Date(atMs), [atMs]);
  const path = event ? pathFor(event) : null;
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
    // 앞날(7일 밖)은 점수를 숨깁니다 — 줄에도 숫자를 달지 않습니다.
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
  // 01 하늘이 그린 장면(땅 프로필 · 구름 그림). 이 페이지가 열릴 때마다, 새 길로 들어올 때마다 다시 읽습니다.
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

  const starArgs = useMemo(() => {
    if (!day || lat == null || lon == null) return null;
    const p = path ?? forecast;
    // 그 시각의 예보가 받아 둔 시간 범위 밖이면 "모름" 으로 둡니다(가장자리 값을 지어 쓰지 않음).
    const weatherAt = (when: Date) => {
      const h = p?.[0]?.hourly;
      const times = h?.timeMs ?? h?.time?.map((x: string) => new Date(x).getTime());
      return p && hourlyCovers(times, when.getTime()) ? starWeatherOf(getInterpolatedWeather(p, when)[0]) : null;
    };
    return starArgsFor({
      date: new Date(pinnedAt ?? day.noonMs), lat, lon, elevM: elevM ?? 0, weatherAt,
      lightPollutionMag: nightLights ? estimateLightPollution(nightLights, lat, lon).magLimit : null,
    });
  }, [day, pinnedAt, lat, lon, path, forecast, elevM, nightLights]);

  const cloudArgs = useMemo(() => {
    const st = scene.st;
    if (!st) return null;
    const when = new Date(st.t);
    const p = ringFor(when);
    const obs = p?.length ? getInterpolatedWeather(p, when)[0] : undefined;
    const alt = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { scene: st, altKm: { low: alt(obs?.layerAltLowKm), mid: alt(obs?.layerAltMidKm), high: alt(obs?.layerAltHighKm) }, winds: layerWindsFrom(obs) };
  }, [scene.st, ringFor]);

  const fmtTime = useCallback((ms: number) => localHHMM(new Date(ms), tz), [tz]);
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
  // 구름 모양 줄 위의 안내: 01 하늘이 그린 시각. 그 시각이 고른 칸의 시각과 30분 넘게 다르면(`cloudSceneUsable`) 다르다고 덧붙입니다.
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
  // 다른 화면에서 구역을 가리키고 들어오면 그 구역으로(구역의 위치는 그려진 뒤에야 알 수 있어 잠깐 기다립니다).
  // 길마다 한 번만, 받은 날이 처음 들어와 높이가 바뀐 뒤 한 번 더 맞춥니다. 나중에 머리 탭으로 돌아올 때는 맞추지 않습니다.
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
    setCurrentTime(ms != null ? new Date(ms) : (event?.peakAt ?? event?.at ?? at));
    onOpenSky();
  };
  const openTopic = (t: LearnTopic) => {
    setTopicReq({ topic: t, nonce: Date.now() });
    scrollTo('why');
  };
  const openSandbox = () => { setExpertMode(true); onOpenSky(); };

  const dateLabel = day ? dayLabel(day.noonMs, tz, language) : '';
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
            {[place, L3(language, '데이터의 근거와 결과가 나온 과정', 'The data behind it and how results are made', 'データの根拠と結果が出るまで')].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {!hasLocation && (
          <Text style={styles.sub}>{L3(language, '위치를 먼저 정해 주세요. 위쪽 장소 버튼으로 고를 수 있어요.', 'Pick a location first with the place button at the top.', '先に場所を決めてください。上の場所ボタンで選べます。')}</Text>
        )}

        <View onLayout={onLayoutOf('today')}>
          <TodaySection
            language={language} tz={tz} isToday={isToday} dateLabel={dateLabel} side={side}
            event={event} direction={direction} items={items} graph={graph}
            onOpenSky={openSky} onOpenTopic={openTopic}
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
